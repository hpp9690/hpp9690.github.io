(() => {
  const quoteEndpoint = "https://push2.eastmoney.com/api/qt/ulist.np/get";
  const memberEndpoint = "https://datacenter-web.eastmoney.com/api/data/v1/get";
  const memberFields = "f2,f3,f6,f8,f12,f14,f21,f124";
  let directoryRequest;

  async function readJson(endpoint, params) {
    const url = new URL(endpoint, location.href);
    if (params) url.search = new URLSearchParams(params);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(url, { cache: params ? "no-store" : "default", signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } finally { clearTimeout(timeout); }
  }

  function directory() {
    if (!directoryRequest) {
      directoryRequest = readJson("board-directory.json?v=1").then((catalogue) => {
        const boards = catalogue.boards?.filter((item) => /^BK\d+$/.test(item.code) &&
          typeof item.name === "string" && ["industry", "concept"].includes(item.kind));
        if (!boards?.length) throw new Error("板块目录为空");
        return { date: catalogue.date, boards };
      }).catch((error) => { directoryRequest = null; throw error; });
    }
    return directoryRequest;
  }

  async function quoteBatch(secids, fields) {
    const result = await readJson(quoteEndpoint, { secids: secids.join(","), fltt: 2, fields, _: Date.now() });
    if (!Array.isArray(result?.data?.diff)) throw new Error("报价暂不可用");
    return result.data.diff;
  }

  async function quotes(secids, fields, batchSize = 200) {
    const batches = [];
    for (let start = 0; start < secids.length; start += batchSize) batches.push(secids.slice(start, start + batchSize));
    const rows = [];
    for (let start = 0; start < batches.length; start += 4) {
      const results = await Promise.allSettled(batches.slice(start, start + 4).map((batch) => quoteBatch(batch, fields)));
      for (const result of results) if (result.status === "fulfilled") rows.push(...result.value);
    }
    return rows;
  }

  async function memberPage(code, pageNumber) {
    const response = await readJson(memberEndpoint, {
      reportName: "RPT_F10_CORETHEME_BOARDTYPE",
      columns: "SECUCODE,SECURITY_CODE,SECURITY_NAME_ABBR,BOARD_CODE,BOARD_NAME",
      filter: `(BOARD_CODE="${code}")`, pageSize: 200, pageNumber,
      sortColumns: "SECURITY_CODE", sortTypes: 1, source: "HSF10", client: "PC"
    });
    const result = response?.result;
    if (!Array.isArray(result?.data)) throw new Error("成分股目录暂不可用");
    return result;
  }

  async function members(boardCode, onRoster) {
    if (!/^BK\d+$/.test(boardCode)) throw new Error("板块代码无效");
    const code = String(Number(boardCode.slice(2)));
    const first = await memberPage(code, 1);
    const membership = [...first.data];
    const pages = Math.min(40, Number(first.pages) || 1);
    for (let start = 2; start <= pages; start += 4) {
      const pending = Array.from({ length: Math.min(4, pages - start + 1) }, (_, i) => memberPage(code, start + i));
      const results = await Promise.allSettled(pending);
      for (const result of results) if (result.status === "fulfilled") membership.push(...result.value.data);
    }
    const unique = new Map();
    for (const entry of membership) {
      const symbol = entry?.SECURITY_CODE;
      if (!/^\d{6}$/.test(symbol) || String(entry.BOARD_CODE) !== code) continue;
      const market = /\.SH$/i.test(entry.SECUCODE || "") ? 1 : 0;
      unique.set(symbol, { code: symbol, name: entry.SECURITY_NAME_ABBR || symbol, secid: `${market}.${symbol}` });
    }
    const entries = [...unique.values()];
    if (!entries.length) throw new Error("成分股目录为空");
    const total = Number(first.count) || entries.length;
    onRoster?.({ rows: entries.map(({ code, name }) => ({ code, name, quoted: false })), total });
    const snapshots = await quotes(entries.map((entry) => entry.secid), memberFields);
    const byCode = new Map(snapshots.map((row) => [row.f12, row]));
    const missing = entries.filter((entry) => !byCode.has(entry.code)).slice(0, 200);
    if (missing.length) {
      const recovered = await quotes(missing.map((entry) => entry.secid), memberFields, 80);
      for (const row of recovered) byCode.set(row.f12, row);
    }
    const rows = entries.map((entry) => {
      const quote = byCode.get(entry.code);
      if (!(Number(quote?.f2) > 0) || !Number.isFinite(Number(quote.f3))) {
        return { code: entry.code, name: entry.name, quoted: false };
      }
      return {
        code: entry.code, name: quote.f14 || entry.name, quoted: true, pct: Number(quote.f3),
        amount: Number(quote.f6) || 0, turnover: Number(quote.f8) || 0,
        cap: Number(quote.f21) || 0, at: (Number(quote.f124) || 0) * 1000
      };
    });
    return { rows, total };
  }

  window.QuantBoards = { directory, quotes, members };
})();


