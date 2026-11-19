(() => {
  const zone = "Asia/Shanghai";
  const minute = 60000, day = 24 * 60 * minute;
  const tencentKlineEndpoint = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get";
  const eastmoneyKlineEndpoint = "https://push2his.eastmoney.com/api/qt/stock/kline/get";
  const noticeEndpoint = "https://np-anotice-stock.eastmoney.com/api/security/ann";
  const dateFormat = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit"
  });
  const timeFormat = new Intl.DateTimeFormat("zh-CN", {
    timeZone: zone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  });
  const cache = new Map(), inFlight = new Set();
  const sectorQuotes = new Map();
  let requested = [], requestTimes = [], breadth = null;

  const unavailable = (text) => ({ status: "unavailable", text });
  const emit = () => document.dispatchEvent(new Event("quant:opportunity-evidence"));
  const isStock = (code) => typeof code === "string" && /^\d{6}$/.test(code);
  const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const signed = (n, digits = 1) => `${n > 0 ? "+" : ""}${n.toFixed(digits)}%`;

  async function fetchJson(endpoint, params) {
    const url = new URL(endpoint);
    url.search = new URLSearchParams(params);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5500);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } finally { clearTimeout(timeout); }
  }

  function technicalFromBars(bars, date, source) {
    if (!Array.isArray(bars) || !bars.length) return unavailable("前复权日线待更新");
    const closes = new Map();
    for (const line of bars) {
      const values = Array.isArray(line) ? line : typeof line === "string" ? line.split(",") : [];
      const [stamp, , close] = values;
      const price = Number(close);
      if (/^\d{4}-\d{2}-\d{2}$/.test(stamp) && stamp < date && Number.isFinite(price) && price > 0) {
        closes.set(stamp, price);
      }
    }
    const series = [...closes].sort(([a], [b]) => a.localeCompare(b));
    if (series.length < 25) return unavailable("已收盘的日线样本不足");
    const lastDate = series.at(-1)[0];
    if (Date.parse(date) - Date.parse(lastDate) > 10 * day) return unavailable(`日线最后更新于 ${lastDate}`);
    const values = series.map(([, price]) => price);
    return {
      status: "ready", date: lastDate, source,
      ma20: average(values.slice(-20)), previousMa20: average(values.slice(-25, -5))
    };
  }

  async function loadTechnical(code, date) {
    const market = /^(920|[48])/.test(code) ? "bj" : /^[569]/.test(code) ? "sh" : "sz";
    const symbol = `${market}${code}`;
    let primary;
    try {
      const result = await fetchJson(tencentKlineEndpoint, { param: `${symbol},day,,,60,qfq` });
      primary = technicalFromBars(result?.data?.[symbol]?.qfqday, date, "腾讯");
      if (primary.status === "ready") return primary;
    } catch { /* Try the second daily chart source independently. */ }
    try {
      const result = await fetchJson(eastmoneyKlineEndpoint, {
        secid: `${market === "sh" ? "1" : "0"}.${code}`, klt: 101, fqt: 1, lmt: 60, end: "20500101",
        fields1: "f1,f2,f3,f4,f5,f6", fields2: "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61"
      });
      const fallback = technicalFromBars(result?.data?.klines, date, "东方财富");
      if (fallback.status === "ready" || !primary) return fallback;
    } catch { /* The last available diagnostic is more specific than a network error. */ }
    return primary || unavailable("前复权日线暂不可用");
  }

  const noticeTopics = [
    {
      risk: /收到[^，。；]{0,28}立案告知书|(?:公司|本公司)(?:涉嫌[^，。；]{0,18})?被[^，。；]{0,20}立案调查/,
      relief: /(?:未|没有|尚未)收到[^，。；]{0,28}立案告知书|不予立案|撤销立案|终止调查|调查结束|调查结案/
    },
    {
      risk: /(?:被|将被|继续|叠加)?实施(?:退市风险警示|其他风险警示)|(?:公司|本公司)股票[^，。；]{0,18}(?:将被终止上市|终止上市暨|终止上市决定)|收到[^，。；]{0,24}终止上市决定/,
      relief: /(?:撤销|解除|(?:不会|不再|不予|未被|不会被|未|不)实施)(?:了|公司股票的)?(?:退市风险警示|其他风险警示)|不(?:会|被|再|涉及|构成|触及)终止上市/
    },
    {
      risk: /(?:公司|本公司)股票(?:(?:继续|临时|将)?停牌(?!前|期间)|自[^，。；]{0,18}起停牌|于[^，。；]{0,18}起停牌)/,
      relief: /复牌|不停牌|不会停牌|不涉及停牌|无须停牌|无需停牌|未停牌/
    }
  ];

  function noticeDate(row) {
    for (const value of [row.display_time, row.notice_date]) {
      if (typeof value !== "string") continue;
      const match = value.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}:\d{2}))?/);
      if (!match) continue;
      const at = Date.parse(`${match[1]}T${match[2] || "00:00:00"}+08:00`);
      if (Number.isFinite(at)) return { at, text: match[2] ? `${match[1].slice(5)} ${match[2].slice(0, 5)}` : match[1].slice(5) };
    }
    return null;
  }

  async function loadNotices(code, now) {
    const result = await fetchJson(noticeEndpoint, {
      sr: -1, page_size: 12, page_index: 1, ann_type: "A", client_source: "web",
      stock_list: code, f_node: 0, s_node: 0
    });
    if (!Array.isArray(result?.data?.list)) throw new Error("公司公告暂不可用");
    const notices = [];
    for (const row of result.data.list) {
      if (!/^AN\d+$/.test(row?.art_code) || typeof row.title !== "string" ||
          !Array.isArray(row.codes) || !row.codes.some((item) => item?.stock_code === code)) continue;
      const stamp = noticeDate(row);
      if (!stamp || stamp.at > now || now - stamp.at >= 7 * day) continue;
      notices.push({ row, stamp });
    }
    notices.sort((a, b) => b.stamp.at - a.stamp.at);
    const resolved = new Set();
    let riskNotice = null;
    for (const notice of notices) {
      for (const [index, topic] of noticeTopics.entries()) {
        if (topic.relief.test(notice.row.title)) resolved.add(index);
        else if (!resolved.has(index) && topic.risk.test(notice.row.title)) riskNotice ??= notice;
      }
    }
    const shown = riskNotice || notices[0];
    if (!shown) return { status: "ready", text: "数据源未返回近 7 日公司公告", risk: false };
    const title = shown.row.title.trim().slice(0, 140);
    return {
      status: "ready", text: `${shown.stamp.text} · ${title}`, risk: Boolean(riskNotice),
      url: `https://data.eastmoney.com/notices/detail/${code}/${shown.row.art_code}.html`
    };
  }

  function getEntry(code, date) {
    const item = cache.get(code);
    return item?.date === date ? item : null;
  }

  function expireAt(field, value, now) {
    if (value.status !== "ready") return now + 3 * minute;
    return now + (field === "technical" ? 60 : 8) * minute;
  }

  function pump() {
    const now = Date.now(), date = dateFormat.format(now);
    requestTimes = requestTimes.filter((time) => now - time < minute && time <= now);
    for (const code of requested) {
      if (inFlight.size >= 3 || requestTimes.length >= 8) break;
      if (inFlight.has(code)) continue;
      const previous = getEntry(code, date);
      const needsTechnical = !(previous?.technicalUntil > now);
      const needsNews = !(previous?.newsUntil > now);
      if (!needsTechnical && !needsNews) continue;
      const item = previous || { date };
      cache.delete(code);
      cache.set(code, item);
      if (cache.size > 240) cache.delete(cache.keys().next().value);
      inFlight.add(code);
      requestTimes.push(now);
      const jobs = [];
      const enqueue = (field, promise, fallback) => {
        jobs.push(promise.catch(() => unavailable(fallback)).then((value) => {
          item[field] = value;
          item[`${field}Until`] = expireAt(field, value, Date.now());
          emit();
        }));
      };
      if (needsTechnical) enqueue("technical", loadTechnical(code, date), "日线暂不可用");
      if (needsNews) enqueue("news", loadNotices(code, now), "公司公告暂不可用");
      Promise.allSettled(jobs).finally(() => {
        inFlight.delete(code);
        pump();
      });
    }
  }

  function request(rows) {
    requested = [...new Set((rows || []).map((row) => row.code).filter(isStock))].slice(0, 8);
    pump();
  }

  function sessionStart(date, time) {
    const morning = Date.parse(`${date}T09:30:00+08:00`);
    const afternoon = Date.parse(`${date}T13:00:00+08:00`);
    if (time >= morning && time < morning + 120 * minute) return morning;
    if (time >= afternoon && time < afternoon + 117 * minute) return afternoon;
    return null;
  }

  function onMarketSnapshot(event) {
    const detail = event.detail;
    if (!detail || detail.partial !== false || detail.source !== "full" || detail.mode !== "open") return;
    const { date, capturedAt, total, scanned, allStocks } = detail;
    const now = Date.now();
    const start = sessionStart(date, capturedAt);
    if (!start || date !== dateFormat.format(now) || sessionStart(date, now) !== start ||
        !Array.isArray(allStocks) || !(total > 0) || scanned / total < .9 ||
        !Number.isFinite(capturedAt) || now - capturedAt > 2 * minute || capturedAt - now > 5000 ||
        (breadth && capturedAt < breadth.capturedAt)) return;

    const codes = new Set(), sectors = new Map();
    let rising = 0, oldestQuote = capturedAt;
    for (const row of allStocks) {
      const at = Number(row?.quoteAt);
      if (!isStock(row?.code) || codes.has(row.code) || !Number.isFinite(row.pct) ||
          !Number.isFinite(at) || at < start || now - at > 2 * minute || at - now > 5000) continue;
      codes.add(row.code);
      if (row.pct > 0) rising++;
      oldestQuote = Math.min(oldestQuote, at);
      const name = String(row.sector || "").trim();
      if (!name || name === "-") continue;
      const sector = sectors.get(name) || { count: 0, rising: 0, rows: new Map() };
      sector.count++;
      if (row.pct > 0) sector.rising++;
      sector.rows.set(row.code, row.pct > 0);
      sectors.set(name, sector);
    }
    if (codes.size < Math.max(200, total * .8)) return;
    breadth = {
      date, start, capturedAt, sectors, share: rising / codes.size,
      validUntil: Math.min(capturedAt + 2 * minute, oldestQuote + 3 * minute)
    };
    emit();
  }

  function onSectorBreadth(event) {
    const { date, boards } = event.detail || {};
    const now = Date.now();
    const start = sessionStart(date, now);
    if (!start || date !== dateFormat.format(now) || !Array.isArray(boards)) return;
    let updated = false;
    for (const row of boards) {
      const name = String(row?.name || "").trim();
      if (!name || !Number.isFinite(row.at) || row.at < start || row.at - now > 5000 || now - row.at > 75000 ||
          ![row.up, row.down, row.flat].every((value) => Number.isInteger(value) && value >= 0) ||
          row.at <= (sectorQuotes.get(name)?.at || 0)) continue;
      sectorQuotes.set(name, { ...row, date });
      updated = true;
    }
    if (updated) emit();
  }

  function sentiment(row, date, now) {
    const name = String(row.sector || "").trim();
    if (!name || name === "-") return unavailable("行业分类缺失");
    const sector = breadth?.sectors.get(name);
    const count = sector ? sector.count - Number(sector.rows.has(row.code)) : 0;
    if (!breadth || breadth.date !== date || now >= breadth.validUntil ||
        sessionStart(date, now) !== breadth.start || count < 10) {
      const quote = sectorQuotes.get(name), start = sessionStart(date, now);
      if (!start || quote?.date !== date || quote.at < start || now - quote.at > 75000) return unavailable("行业广度待更新");
      const total = quote.up + quote.down + quote.flat;
      if (total < 11) return unavailable("该行业有效样本不足");
      return {
        status: "ready", positive: false,
        text: `行业 ${quote.up}/${total} 上涨 · ${timeFormat.format(quote.at)} · 全市场对照待更新`
      };
    }
    const rising = sector.rising - Number(sector.rows.get(row.code) === true);
    const share = rising / count;
    const positive = share >= .6 && share - breadth.share >= .1 - 1e-8;
    return {
      status: "ready", positive,
      text: `同业 ${rising}/${count} 上涨 · 全市场 ${Math.round(breadth.share * 100)}% 上涨 · ${timeFormat.format(breadth.capturedAt)}`
    };
  }

  function evaluate(row) {
    const now = Date.now(), date = row.date || dateFormat.format(now);
    const item = getEntry(row.code, date);
    const loading = inFlight.has(row.code);
    const data = (field, text) => item?.[`${field}Until`] > now ? item[field]
      : { status: loading ? "loading" : "unavailable", text: loading ? "核对中" : text };
    let technical = data("technical", "技术面待核对");
    if (technical.status === "ready") {
      const price = Number(row.price);
      if (Number.isFinite(price) && price > 0) {
        const distance = (price / technical.ma20 - 1) * 100;
        const trend = technical.ma20 - technical.previousMa20;
        const trendText = Math.abs(trend) < .005 ? "均线持平" : trend > 0 ? "均线上行" : "均线下行";
        technical = {
          status: "ready", positive: distance >= 0 && trend >= .005,
          text: `${technical.date.slice(5)} 前复权 MA20 ${technical.ma20.toFixed(2)} · 现价较均线 ${signed(distance)} · ${trendText} · ${technical.source}`
        };
      } else technical = unavailable("现价缺失，无法比较均线");
    }
    return { technical, news: { risk: false, ...data("news", "公司公告待核对") }, sentiment: sentiment(row, date, now) };
  }

  document.addEventListener("quant:market-snapshot", onMarketSnapshot);
  document.addEventListener("quant:sector-breadth", onSectorBreadth);
  window.QuantOpportunityEvidence = { request, evaluate };
})();

