(() => {
  const zone = "Asia/Shanghai";
  const fields = "f2,f3,f5,f6,f8,f10,f12,f14,f17,f18,f100,f117,f124";
  const stampDate = (seconds) => seconds > 0 ? new Date(seconds * 1000).toLocaleDateString("en-CA", { timeZone: zone }) : "";
  const currentDate = () => new Date().toLocaleDateString("en-CA", { timeZone: zone });
  const shouldPoll = () => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
    const part = (type) => parts.find((x) => x.type === type)?.value || "";
    const minute = Number(part("hour")) * 60 + Number(part("minute"));
    return !["Sat", "Sun"].includes(part("weekday")) && ((minute >= 555 && minute < 690) || (minute >= 780 && minute < 900));
  };
  const mainBoard = (code) => /^(000|001|002|003|600|601|603|605)/.test(code);
  const normalize = (x) => ({ code: x.f12, name: x.f14, pct: Number(x.f3) || 0,
    amount: Number(x.f6) || 0, turnover: Number(x.f8) || 0, price: Number(x.f2) || 0,
    sector: x.f100 || "", floatCap: Number(x.f117) || 0, quoteAt: (Number(x.f124) || 0) * 1000 });
  const valid = (x) => /^\d{6}$/.test(x?.f12 || "") && !/^[NC]/.test(x.f14 || "") && Number(x.f2) > 0;
  const emitRows = (rows, source, total = 0) => {
    const fresh = rows.filter((x) => valid(x) && stampDate(Number(x.f124)) === currentDate());
    if (!fresh.length) return;
    const allStocks = fresh.map(normalize);
    document.dispatchEvent(new CustomEvent("quant:market-snapshot", { detail: {
      date: currentDate(), mode: "open", capturedAt: Date.now(), source, partial: true,
      scanned: allStocks.length, total, stocks: allStocks.filter((x) => mainBoard(x.code) && !/ST|退/.test(x.name)), allStocks
    } }));
  };
  const fetchJson = async (url) => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(url, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } finally { clearTimeout(timer); }
  };
  const page = async (number) => {
    const url = new URL("https://push2.eastmoney.com/api/qt/clist/get");
    url.search = new URLSearchParams({ pn: String(number), pz: "100", po: "1", np: "1", fltt: "2", invt: "2", fid: "f3", fs: "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23", fields, _: String(Date.now()) });
    const data = (await fetchJson(url)).data;
    if (!data || !Array.isArray(data.diff)) throw new Error("行情页为空");
    return { rows: data.diff, total: Number(data.total) || data.diff.length };
  };
  const health = (detail) => document.dispatchEvent(new CustomEvent("quant:market-health", { detail }));
  let fullBusy = false;
  const fullScan = async () => {
    if (fullBusy) return;
    fullBusy = true;
    health({ state: "scanning", capturedAt: Date.now() });
    try {
      const first = await page(1), count = Math.min(65, Math.ceil(first.total / 100));
      const byPage = new Map([[1, first.rows]]), missing = [];
      emitRows(first.rows, "full-batch", first.total);
      for (let start = 2; start <= count; start += 6) {
        const numbers = Array.from({ length: Math.min(6, count - start + 1) }, (_, i) => start + i);
        const results = await Promise.allSettled(numbers.map(page));
        results.forEach((result, i) => {
          if (result.status === "fulfilled") { byPage.set(numbers[i], result.value.rows); emitRows(result.value.rows, "full-batch", first.total); }
          else missing.push(numbers[i]);
        });
      }
      // Retry gaps once after the main pass, with lower concurrency.
      for (let start = 0; start < missing.length; start += 3) {
        const numbers = missing.slice(start, start + 3);
        const results = await Promise.allSettled(numbers.map(page));
        results.forEach((result, i) => {
          if (result.status === "fulfilled") { byPage.set(numbers[i], result.value.rows); emitRows(result.value.rows, "retry", first.total); }
        });
      }
      const raw = [...byPage.values()].flat();
      const unique = [...new Map(raw.filter(valid).map((x) => [x.f12, x])).values()];
      const sourceDate = stampDate(Math.max(0, ...unique.map((x) => Number(x.f124) || 0)));
      const allStocks = unique.map(normalize);
      const stocks = allStocks.filter((x) => mainBoard(x.code) && !/ST|退/.test(x.name));
      const missingPages = count - byPage.size, capturedAt = Date.now();
      document.dispatchEvent(new CustomEvent("quant:market-snapshot", { detail: {
        date: sourceDate, mode: sourceDate === currentDate() ? "open" : "review", capturedAt,
        source: "full", partial: false, scanned: unique.length, total: first.total, missingPages, stocks, allStocks
      } }));
      health({ state: "ready", capturedAt, date: sourceDate, scanned: unique.length, total: first.total, missingPages });
    } catch (error) {
      health({ state: "error", capturedAt: Date.now(), message: String(error?.message || error) });
    } finally { fullBusy = false; }
  };
  let watchBusy = false;
  const watchScan = async () => {
    if (watchBusy) return;
    let codes = [];
    try { codes = [...new Set(JSON.parse(localStorage.getItem("quantLens.watchlist.v1") || "[]").map((x) => x.code).filter((x) => /^\d{6}$/.test(x)))]; } catch {}
    if (!codes.length) return;
    watchBusy = true;
    try {
      for (let start = 0; start < codes.length; start += 50) {
        const secids = codes.slice(start, start + 50).map((code) => `${/^[69]/.test(code) ? 1 : 0}.${code}`).join(",");
        const url = new URL("https://push2.eastmoney.com/api/qt/ulist.np/get");
        url.search = new URLSearchParams({ secids, fields, fltt: "2", _: String(Date.now()) });
        emitRows((await fetchJson(url)).data?.diff || [], "watch");
      }
    } catch {} finally { watchBusy = false; }
  };
  fullScan(); watchScan();
  setInterval(() => { if (shouldPoll()) fullScan(); }, 90000);
  setInterval(() => { if (shouldPoll()) watchScan(); }, 15000);
  document.addEventListener("quant:watchlist-changed", watchScan);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { fullScan(); watchScan(); } });
})();

