(() => {
  const model = { ready: false, events: [], sessions: [], base: 0, source: "", start: "", end: "" };
  const zone = "Asia/Shanghai";
  const $ = (id) => document.getElementById(id);
  const mainBoard = (code) => /^(000|001|002|003|600|601|603|605)/.test(String(code || ""));
  const pct = (x) => `${(x * 100).toFixed(1)}%`;
  const shTime = () => {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" }).formatToParts(new Date());
    const get = (k) => parts.find((x) => x.type === k)?.value || "";
    return { date: `${get("year")}${get("month")}${get("day")}`, hhmm: Number(get("hour") + get("minute")), weekday: !["Sat", "Sun"].includes(get("weekday")) };
  };
  const safeJson = async (url) => { const r = await fetch(url, { cache: "no-store" }); if (!r.ok) throw new Error("行情接口暂不可用"); return r.json(); };
  const bucket = (n, cuts) => n < cuts[0] ? 0 : n < cuts[1] ? 1 : 2;
  const field = (x, a, b) => Number(x[a] ?? x[b] ?? 0) || 0;
  const timeBucket = (raw) => {
    const s = String(raw || 0).padStart(6, "0"), h = +s.slice(0, 2), m = +s.slice(2, 4), hm = h * 100 + m;
    return hm <= 925 ? 0 : hm < 1000 ? 1 : hm < 1130 ? 2 : hm < 1400 ? 3 : 4;
  };
  const features = (x, day, thresholds) => {
    const height = field(x, "lbc", "board");
    const cap = field(x, "ltsz", "floatCap"), fund = field(x, "fund", "sealFund");
    const sectorCount = field(x, "sectorCount", "sectorBreadth");
    const ztCount = field(day, "ztCount", "marketZt"), zbCount = field(day, "zbCount", "marketZb");
    const sealRate = ztCount + zbCount ? ztCount / (ztCount + zbCount) : 0;
    let mood = 1;
    if (ztCount <= thresholds.ztLow || sealRate <= thresholds.sealLow) mood = 0;
    else if (ztCount >= thresholds.ztHigh && sealRate >= thresholds.sealHigh) mood = 2;
    return {
      height: height <= 1 ? 0 : height === 2 ? 1 : 2,
      sealTime: timeBucket(field(x, "fbt", "sealTime")),
      broken: field(x, "zbc", "breaks") <= 0 ? 0 : field(x, "zbc", "breaks") === 1 ? 1 : 2,
      turnover: bucket(field(x, "hs", "turnover"), [3, 8]),
      queue: bucket(cap ? fund / cap * 100 : 0, [0.5, 2]),
      sector: sectorCount <= 1 ? 0 : sectorCount <= 3 ? 1 : 2,
      market: mood
    };
  };
  const factorWeights = { height: 1.5, sealTime: 0.8, broken: 1.2, turnover: 0.55, queue: 0.55, sector: 0.55, market: 0.7 };
  const factorNames = { height: ["首板", "2连板", "3板及以上"], sealTime: ["竞价/开盘即封", "9:30–10:00", "10:00–11:30", "11:30–14:00", "14:00后封板"], broken: ["未炸板", "炸板1次", "炸板2次以上"], turnover: ["换手低于3%", "换手3%–8%", "换手高于8%"], queue: ["封单/流通市值低于0.5%", "封单比0.5%–2%", "封单比高于2%"], sector: ["行业涨停1只", "行业涨停2–3只", "行业涨停4只以上"], market: ["偏弱", "中性", "偏强"] };
  function thresholdsFor(sessions) {
    const zt = sessions.map((s) => +s.ztCount || 0).sort((a, b) => a - b);
    const seal = sessions.map((s) => { const n = (+s.ztCount || 0) + (+s.zbCount || 0); return n ? (+s.ztCount || 0) / n : 0; }).sort((a, b) => a - b);
    const q = (a, p) => a.length ? a[Math.floor((a.length - 1) * p)] : 0;
    return { ztLow: q(zt, .25), ztHigh: q(zt, .75), sealLow: q(seal, .25), sealHigh: q(seal, .75) };
  }
  function canonicalize(data) {
    const sessions = (data.sessions || []).filter((s) => s && s.date).sort((a, b) => a.date.localeCompare(b.date));
    const thresholds = thresholdsFor(sessions);
    const events = [];
    for (const day of sessions) for (const x of day.stocks || []) {
      if (x.continued === null || x.continued === undefined || !mainBoard(x.c || x.code)) continue;
      events.push({ x, day, y: !!x.continued, f: features(x, day, thresholds) });
    }
    return { sessions, events, thresholds };
  }
  async function fetchPool(type, date) {
    const url = new URL(`https://push2ex.eastmoney.com/getTopic${type}Pool`);
    url.search = new URLSearchParams({ ut: "7eea3edcaed734bea9cbfc24409ed989", dpt: "wz.ztzt", Pageindex: "0", pagesize: "200", sort: "fbt:asc", date, _: String(Date.now()) });
    const json = await safeJson(url);
    if (json.rc !== 0) throw new Error("历史池读取失败");
    return { total: Number(json.data?.tc) || 0, pool: json.data?.pool || [] };
  }
  async function fetchRolling() {
    const now = shTime();
    const begin = new Date(); begin.setDate(begin.getDate() - 55);
    const beg = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(begin).replaceAll("-", "");
    const url = new URL("https://push2his.eastmoney.com/api/qt/stock/kline/get");
    url.search = new URLSearchParams({ secid: "1.000001", fields1: "f1,f2,f3,f4,f5,f6", fields2: "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61", klt: "101", fqt: "1", beg, end: now.date });
    const index = await safeJson(url);
    const dates = (index.data?.klines || []).map((k) => k.slice(0, 10).replaceAll("-", "")).slice(-15);
    if (dates.length < 10) throw new Error("历史交易日不足");
    const todayIsMarketDay = dates.at(-1) === now.date;
    const todayClosed = !todayIsMarketDay || now.hhmm >= 1505;
    const jobs = await Promise.all(dates.map(async (date) => {
      const [zt, zb] = await Promise.all([fetchPool("ZT", date), fetchPool("ZB", date)]);
      return { date, zt, zb };
    }));
    if (jobs.filter((s) => s.zt.total > 0).length < 8) throw new Error("近期历史池数据不足");
    const sessions = jobs.map((day, i) => {
      const main = day.zt.pool.filter((x) => mainBoard(x.c) && !/ST|退/i.test(x.n || ""));
      const sectors = {};
      for (const x of main) { const key = x.hybk || ""; sectors[key] = (sectors[key] || 0) + 1; }
      const stocks = main.map((x) => ({ c: x.c, n: x.n, lbc: +x.lbc || 1, fbt: +x.fbt || 0, zbc: +x.zbc || 0, fund: +x.fund || 0, amount: +x.amount || 0, ltsz: +x.ltsz || 0, hs: +x.hs || 0, hybk: x.hybk || "", sectorCount: sectors[x.hybk || ""] || 0, continued: null }));
      const next = jobs[i + 1];
      const nextIsClosed = !!next && (next.date !== now.date || todayClosed);
      if (nextIsClosed) {
        const nextCodes = new Set(next.zt.pool.map((x) => x.c));
        for (const x of stocks) x.continued = nextCodes.has(x.c);
      }
      return { date: day.date, ztCount: day.zt.total, zbCount: day.zb.total, multiCount: stocks.filter((x) => x.lbc > 1).length, highCount: stocks.filter((x) => x.lbc >= 3).length, stocks };
    });
    const ready = canonicalize({ sessions });
    if (ready.events.length < 100) throw new Error("近期有效样本不足");
    return { ...ready, source: "东方财富近14个交易日历史涨停/炸板池", start: ready.events[0].day.date, end: ready.events.at(-1).day.date };
  }
  async function load() {
    $("probModelStatus").textContent = "正在读取近14个交易日历史样本…";
    let fallback = null;
    try { fallback = canonicalize(await safeJson("limitup-history.json?v=1")); } catch {}
    try {
      const live = await fetchRolling();
      Object.assign(model, live, { ready: true });
    } catch (e) {
      if (!fallback || fallback.events.length < 100) {
        $("probModelStatus").textContent = "历史样本暂不可用，无法计算概率"; return;
      }
      Object.assign(model, fallback, { ready: true, source: "内置近期历史样本（实时接口暂不可用）", start: fallback.events[0].day.date, end: fallback.events.at(-1).day.date });
    }
    model.base = model.events.reduce((n, x) => n + (x.y ? 1 : 0), 0) / Math.max(1, model.events.length);
    const starts = `${model.start.slice(4, 6)}-${model.start.slice(6)}`, ends = `${model.end.slice(4, 6)}-${model.end.slice(6)}`;
    $("probModelStatus").textContent = `${model.source} · ${starts}–${ends}`;
    $("probSummaryStats").textContent = `主板总体次日再涨停：${pct(model.base)}（${model.events.filter((x) => x.y).length}/${model.events.length} 个涨停样本）`;
    document.dispatchEvent(new CustomEvent("continuation-ready"));
  }
  function estimate(stock, context = {}) {
    if (!model.ready || !mainBoard(stock.c)) return null;
    const thresholds = thresholdsFor(model.sessions);
    const currentDay = { ztCount: context.poolCount || 0, zbCount: context.brokenCount || 0 };
    const currentSector = (context.rows || []).filter((x) => x.hybk && x.hybk === stock.hybk && mainBoard(x.c) && !/ST|退/i.test(x.n || "")).length;
    const candidate = { ...stock, sectorCount: currentSector };
    const f = features(candidate, currentDay, thresholds);
    let weightSum = 0, winSum = 0, weightSq = 0, similarN = 0;
    for (const e of model.events) {
      let distance = 0;
      for (const key of Object.keys(factorWeights)) if (e.f[key] !== f[key]) distance += factorWeights[key];
      const w = Math.exp(-distance * .48);
      weightSum += w; weightSq += w * w; winSum += w * (e.y ? 1 : 0);
      if (distance <= 1.5) similarN++;
    }
    const priorN = 24, probability = (winSum + model.base * priorN) / (weightSum + priorN);
    const effectiveN = weightSq ? weightSum * weightSum / weightSq : 0;
    const margin = 1.645 * Math.sqrt(Math.max(.0001, probability * (1 - probability) / (effectiveN + priorN)));
    const factors = Object.keys(factorWeights).map((key) => {
      const rows = model.events.filter((e) => e.f[key] === f[key]);
      const wins = rows.filter((e) => e.y).length;
      return { key, name: key === "height" ? "连板高度" : key === "sealTime" ? "封板时间" : key === "broken" ? "炸板次数" : key === "turnover" ? "换手水平" : key === "queue" ? "封单/流通市值" : key === "sector" ? "同题材涨停家数" : "市场封板情绪", bucket: factorNames[key][f[key]], n: rows.length, wins, rate: wins / Math.max(1, rows.length), versus: wins / Math.max(1, rows.length) - model.base };
    });
    const similarRate = weightSum ? winSum / weightSum : model.base;
    return { probability, low: Math.max(0, probability - margin), high: Math.min(1, probability + margin), base: model.base, effectiveN, similarN, similarRate, factors, feature: f, start: model.start, end: model.end, events: model.events.length, wins: model.events.filter((e) => e.y).length, source: model.source, market: currentDay };
  }
  function summary() { return { ready: model.ready, events: model.events.length, wins: model.events.filter((e) => e.y).length, base: model.base, start: model.start, end: model.end, source: model.source }; }
  window.ContinuationModel = { load, estimate, summary, ready: () => model.ready };
  load();
})();

