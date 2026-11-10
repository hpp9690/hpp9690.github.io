(() => {
  const $ = (id) => document.getElementById(id);
  const zone = "Asia/Shanghai", storeKey = "quantLens.auctionReview.v1";
  const amountFmt = (n) => `${(n / 1e8).toFixed(n >= 1e8 ? 2 : 3)}亿`;
  const mainBoard = (code) => /^(000|001|002|003|600|601|603|605)/.test(code);
  const dateTime = () => {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(new Date());
    const get = (k) => parts.find((x) => x.type === k)?.value || "";
    const hhmm = Number(get("hour") + get("minute"));
    return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}`, hhmm, weekday: !["Sat", "Sun"].includes(get("weekday")) };
  };
  const phaseNow = () => {
    const t = dateTime();
    const mode = !t.weekday ? "review" : t.hhmm < 915 ? "pre" : t.hhmm < 925 ? "auction" : t.hhmm < 930 ? "final" : "open";
    return { ...t, active: mode === "auction" || mode === "final", early: t.hhmm < 920, mode };
  };
  const readHistory = () => { try { const x = JSON.parse(localStorage.getItem(storeKey) || "[]"); return Array.isArray(x) ? x : []; } catch { return []; } };
  const writeHistory = (x) => { try { localStorage.setItem(storeKey, JSON.stringify(x)); } catch {} };
  const pct = (n) => Number.isFinite(n) ? `${n > 0 ? "+" : ""}${n.toFixed(2)}%` : "—";
  function signal(s, liveAuction) {
    const change = s._scanPct, amount = s._scanAmount, turnover = s._scanTurnover, dist = Math.max(0, 10 - change);
    const score = Math.round(Math.max(0, Math.min(40, change * 4)) + Math.max(0, Math.min(35, Math.log10(Math.max(amount, 1) / 1e6) * 12)) + Math.max(0, Math.min(15, turnover * 3)) + Math.max(0, 10 - Math.max(0, dist) * 2));
    const tags = [];
    if (change >= 5) tags.push(liveAuction ? "竞价偏强" : "高开偏强"); if (amount >= 2e7) tags.push(liveAuction ? "竞价额较高" : "成交额较高"); if (turnover >= 1) tags.push("换手活跃"); if (dist <= 3) tags.push("接近涨停价");
    return { score, dist, tags: tags.join(" · ") || "继续观察" };
  }
  function render(list, phase) {
    const liveAuction = phase.mode === "auction" || phase.mode === "final";
    const rows = list.map((x) => ({ x, sig: signal(x, liveAuction) })).sort((a, b) => b.sig.score - a.sig.score).slice(0, 50);
    $("auctionPctLabel").textContent = liveAuction ? "竞价涨幅" : "开盘涨幅";
    $("auctionAmountLabel").textContent = liveAuction ? "竞价成交额" : "当前成交额";
    $("auctionTurnoverLabel").textContent = liveAuction ? "竞价换手" : "当前换手";
    const html = rows.map(({ x, sig }) => `<tr><td class="zt-row-main"><b>${x.f14}</b><small>${x.f12}</small></td><td class="score">${sig.score}</td><td class="${x._scanPct >= 0 ? "up" : "down"}">${pct(x._scanPct)}</td><td>${amountFmt(x._scanAmount)}</td><td>${x._scanTurnover.toFixed(2)}%</td><td>${sig.dist.toFixed(2)}%</td><td class="why">${sig.tags}</td></tr>`).join("");
    $("auctionRows").innerHTML = html || `<tr><td colspan="7" class="zt-empty">暂无符合条件的沪深主板候选</td></tr>`;
    $("auctionMobile").innerHTML = rows.map(({ x, sig }) => `<article class="row"><div class="rowtop"><b>${x.f14} <small>${x.f12}</small></b><span class="score">${sig.score} 分</span></div><div class="rowmeta"><span class="${x._scanPct >= 0 ? "up" : "down"}">${pct(x._scanPct)}</span><span>${liveAuction ? "竞价额" : "成交额"} ${amountFmt(x._scanAmount)}</span></div><div class="why">换手 ${x._scanTurnover.toFixed(2)}% · 距涨停 ${sig.dist.toFixed(2)}% · ${sig.tags}</div></article>`).join("") || `<div class="zt-empty">暂无符合条件的沪深主板候选</div>`;
    $("auctionPhase").textContent = phase.mode === "auction"
      ? (phase.early ? "09:15–09:20：委托仍可撤，竞价涨幅和金额可能失真；先作为观察名单。" : "09:20–09:25：委托不可撤，竞价信号相对更有参考性，但开盘仍可能变化。")
      : phase.mode === "final"
        ? "09:25–09:30：展示最终竞价结果，候选不会在竞价结束后消失。"
        : phase.mode === "review"
          ? "当前展示最近交易日开盘结果，仅用于复盘，不作为今日竞价信号。"
          : "竞价已结束：按开盘涨幅重新筛选，并用盘中成交额和换手率持续更新。";
    if ((phase.mode === "auction" && phase.hhmm >= 924) || phase.mode === "final") saveSnapshot(rows);
  }
  function saveSnapshot(rows) {
    const { date, time } = dateTime(), history = readHistory();
    if (history.some((d) => d.date === date)) return;
    const day = { date, capturedAt: time, stocks: rows.slice(0, 20).map(({ x, sig }) => ({ code: x.f12, name: x.f14, auctionPct: x._scanPct, amount: x._scanAmount, score: sig.score, openPct: null, openPrice: null, prevClose: null, lastPrice: null, lastPct: null, sampledAt: null })) };
    if (!day.stocks.length) return;
    history.unshift(day); writeHistory(history.slice(0, 10)); renderReview();
    $("reviewStatus").textContent = `${date} ${time} 已保存 ${day.stocks.length} 只候选 · 本地浏览器记录`;
  }
  function renderReview() {
    const history = readHistory();
    const items = history.flatMap((d) => d.stocks.map((s) => ({ ...s, date: d.date, capturedAt: d.capturedAt })));
    const body = items.map((s) => `<tr><td>${s.date}</td><td class="zt-row-main"><b>${s.name}</b><small>${s.code}</small></td><td>${pct(s.auctionPct)} / ${s.score}</td><td class="${s.openPct > 0 ? "up" : s.openPct < 0 ? "down" : ""}">${pct(s.openPct)}</td><td class="${s.lastPct > 0 ? "up" : s.lastPct < 0 ? "down" : ""}">${pct(s.lastPct)}</td><td>${s.sampledAt ? `最近快照 ${s.sampledAt}` : "等待开盘后行情"}</td></tr>`).join("");
    $("reviewRows").innerHTML = body || `<tr><td colspan="6" class="zt-empty">上线后等待交易日 09:24–09:25 自动保存竞价候选</td></tr>`;
    $("reviewMobile").innerHTML = items.map((s) => `<article class="row"><div class="rowtop"><b>${s.name} <small>${s.code}</small></b><span>${s.date}</span></div><div class="rowmeta"><span>竞价 ${pct(s.auctionPct)} · ${s.score} 分</span><span class="${s.openPct > 0 ? "up" : s.openPct < 0 ? "down" : ""}">开盘 ${pct(s.openPct)}</span></div><div class="why">相对开盘 ${pct(s.lastPct)} · ${s.sampledAt ? `最近快照 ${s.sampledAt}` : "等待开盘后行情"}</div></article>`).join("") || `<div class="zt-empty">上线后等待交易日 09:24–09:25 自动保存竞价候选</div>`;
    if (!history.length) $("reviewStatus").textContent = "候选快照只保存在当前浏览器";
  }
  let lastQuoteAt = 0, quoteBusy = false;
  async function updateReview(force = false) {
    const t = dateTime();
    if (!t.weekday || t.hhmm < 930 || (!force && Date.now() - lastQuoteAt < 60000) || quoteBusy) return;
    const history = readHistory(); if (!history.length) return;
    const targets = [...new Map(history.flatMap((d) => d.stocks.map((s) => [s.code, s])).map(([code, s]) => [code, s])).values()];
    if (!targets.length) return;
    quoteBusy = true; $("reviewStatus").textContent = "正在读取开盘后行情…";
    try {
      const quotes = new Map();
      for (let i = 0; i < targets.length; i += 50) {
        const chunk = targets.slice(i, i + 50), secids = chunk.map((s) => `${s.code.startsWith("6") ? 1 : 0}.${s.code}`).join(",");
        const url = new URL("https://push2.eastmoney.com/api/qt/ulist.np/get");
        url.search = new URLSearchParams({ fltt: "2", fields: "f2,f3,f12,f14,f17,f18", secids, _: String(Date.now()) });
        const res = await fetch(url, { cache: "no-store" }); if (!res.ok) throw new Error("quote");
        const json = await res.json(); for (const q of json.data?.diff || []) quotes.set(q.f12, q);
      }
      const sampled = `${t.time}`;
      for (const day of history) for (const s of day.stocks) {
        const q = quotes.get(s.code), open = +q?.f17 || 0, prev = +q?.f18 || 0, current = +q?.f2 || 0;
        if (!q || open <= 0 || prev <= 0 || current <= 0) continue;
        s.openPrice = s.openPrice || open; s.prevClose = s.prevClose || prev;
        s.openPct = (s.openPrice / s.prevClose - 1) * 100;
        s.lastPrice = current; s.lastPct = (current / s.openPrice - 1) * 100; s.sampledAt = sampled;
      }
      writeHistory(history); lastQuoteAt = Date.now(); renderReview();
      $("reviewStatus").textContent = `盘中表现已更新 ${sampled} · ${targets.length} 只历史候选`;
    } catch {
      $("reviewStatus").textContent = "行情暂不可用，可稍后手动刷新";
    } finally { quoteBusy = false; }
  }
  async function fetchPage(page) {
    const url = new URL("https://push2.eastmoney.com/api/qt/clist/get");
    url.search = new URLSearchParams({ pn: String(page), pz: "100", po: "1", np: "1", fltt: "2", invt: "2", fid: "f3", fs: "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23", fields: "f2,f3,f5,f6,f8,f10,f12,f14,f17,f18,f124", _: String(Date.now()) });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(url, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("quote");
      return (await response.json()).data?.diff || [];
    } finally { clearTimeout(timer); }
  }
  async function load() {
    const phase = phaseNow();
    if (phase.mode === "pre") {
      $("auctionUpdated").textContent = "竞价尚未开始";
      $("auctionPhase").textContent = "交易日 09:15 开始扫描；09:25 后自动保留并切换为开盘结果复盘。";
      $("auctionRows").innerHTML = `<tr><td colspan="7" class="zt-empty">09:15 前没有真实竞价数据，请勿把昨日行情当作今日信号</td></tr>`;
      $("auctionMobile").innerHTML = `<div class="zt-empty">09:15 前没有真实竞价数据</div>`;
      return;
    }
    $("auctionUpdated").textContent = "正在扫描多页行情";
    try {
      const pages = await Promise.allSettled([1, 2, 3, 4, 5, 6].map(fetchPage));
      const raw = pages.flatMap((x) => x.status === "fulfilled" ? x.value : []);
      if (!raw.length) throw new Error("empty");
      const deduped = [...new Map(raw.map((x) => [x.f12, x])).values()];
      const sourceDates = deduped.map((x) => +x.f124 || 0).filter(Boolean);
      const marketDate = sourceDates.length ? new Date(Math.max(...sourceDates) * 1000).toLocaleDateString("en-CA", { timeZone: zone }) : phase.date;
      const effective = marketDate === phase.date ? phase : { ...phase, mode: "review" };
      const liveAuction = effective.mode === "auction" || effective.mode === "final";
      const prepared = deduped.map((x) => {
        const open = +x.f17 || 0, prev = +x.f18 || 0;
        return { ...x, _scanPct: liveAuction ? (+x.f3 || 0) : (open > 0 && prev > 0 ? (open / prev - 1) * 100 : (+x.f3 || 0)), _scanAmount: +x.f6 || 0, _scanTurnover: +x.f8 || 0 };
      });
      const base = prepared.filter((x) => mainBoard(x.f12) && !/ST|退/.test(x.f14) && !/^[NC]/.test(x.f14));
      const minAmount = liveAuction ? 1e6 : 5e6;
      let list = base.filter((x) => x._scanPct >= 3 && x._scanPct <= 10.2 && x._scanAmount >= minAmount);
      let relaxed = false;
      if (!list.length) { list = base.filter((x) => x._scanPct >= 1.5 && x._scanPct <= 10.2 && x._scanAmount >= 5e5); relaxed = true; }
      render(list, effective);
      const time = new Date().toLocaleTimeString("zh-CN", { timeZone: zone });
      $("auctionUpdated").textContent = `${effective.mode === "review" ? marketDate + " 复盘" : "更新 " + time} · 扫描 ${deduped.length} 只 · ${list.length} 个${relaxed ? "宽松" : "严格"}候选`;
    } catch {
      $("auctionUpdated").textContent = "行情暂不可用";
      $("auctionRows").innerHTML = `<tr><td colspan="7" class="zt-empty">竞价行情接口暂时不可用，请稍后重试</td></tr>`;
    }
  }
  $("auctionRefresh").onclick = load;
  $("reviewRefresh").onclick = () => updateReview(true);
  renderReview(); load(); updateReview();
  setInterval(() => { load(); updateReview(); }, 30000);
})();
