(() => {
  const quoteEndpoint = "https://push2.eastmoney.com/api/qt/ulist.np/get";
  const trendEndpoint = "https://push2.eastmoney.com/api/qt/stock/trends2/get";
  const constituentQuoteEndpoint = "https://qt.gtimg.cn/";
  const memberEndpoint = "https://datacenter-web.eastmoney.com/api/data/v1/get";
  const memberFields = "f2,f3,f6,f8,f12,f14,f21,f124";
  const boardFields = "f3,f5,f6,f12,f14,f104,f105,f106,f124";
  const trendRequests = new Map();
  let directoryRequest, boardRequest, boardResult;

  async function readData(endpoint, params, parse = (response) => response.json()) {
    const url = new URL(endpoint, location.href);
    if (params) url.search = new URLSearchParams(params);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(url, { cache: params ? "no-store" : "default", signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await parse(response);
    } finally { clearTimeout(timeout); }
  }

  function directory() {
    if (!directoryRequest) {
      directoryRequest = readData("board-directory.json?v=1").then((catalogue) => {
        const boards = catalogue.boards?.filter((item) => /^BK\d+$/.test(item.code) &&
          typeof item.name === "string" && ["industry", "concept"].includes(item.kind));
        if (!boards?.length) throw new Error("板块目录为空");
        return { date: catalogue.date, boards };
      }).catch((error) => { directoryRequest = null; throw error; });
    }
    return directoryRequest;
  }

  async function quoteBatch(secids, fields) {
    const result = await readData(quoteEndpoint, { secids: secids.join(","), fltt: 2, fields, _: Date.now() });
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

  function snapshot({ force = false } = {}) {
    if (boardRequest) return boardRequest;
    if (!force && boardResult && Date.now() - boardResult.receivedAt < 20000) return Promise.resolve(boardResult);
    boardRequest = directory().then(async (catalogue) => {
      const secids = catalogue.boards.map((board) => `90.${board.code}`);
      let rows = await quotes(secids, boardFields);
      if (!rows.length && !boardResult?.rows.length) {
        await new Promise((resolve) => setTimeout(resolve, 900));
        rows = await quotes(secids, boardFields);
      }
      const result = { catalogue, rows, receivedAt: Date.now() };
      boardResult = result;
      document.dispatchEvent(new CustomEvent("quant:board-quotes-snapshot", { detail: result }));
      return result;
    }).finally(() => { boardRequest = null; });
    return boardRequest;
  }

  async function memberPage(code, pageNumber) {
    const response = await readData(memberEndpoint, {
      reportName: "RPT_F10_CORETHEME_BOARDTYPE",
      columns: "SECUCODE,SECURITY_CODE,SECURITY_NAME_ABBR,BOARD_CODE,BOARD_NAME",
      filter: `(BOARD_CODE="${code}")`, pageSize: 200, pageNumber,
      sortColumns: "SECURITY_CODE", sortTypes: 1, source: "HSF10", client: "PC"
    });
    const result = response?.result;
    if (!Array.isArray(result?.data)) throw new Error("成分股目录暂不可用");
    return result;
  }

  function quoteNumber(value) {
    return (typeof value === "number" || (typeof value === "string" && value.trim())) ? Number(value) : NaN;
  }

  async function loadTrend(code) {
    const response = await readData(trendEndpoint, {
      secid: `90.${code}`, ndays: 1, iscr: 0, iscca: 0,
      fields1: "f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13",
      fields2: "f51,f52,f53,f54,f55,f56,f57,f58"
    });
    const data = response?.data;
    if (data?.code !== code || Number(data.market) !== 90 || !Array.isArray(data.trends)) return null;

    const localNow = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const today = localNow.toISOString().slice(0, 10);
    const currentMinute = localNow.getUTCHours() * 60 + localNow.getUTCMinutes();
    const points = new Map();
    let date = "";
    for (const line of data.trends) {
      if (typeof line !== "string") continue;
      const [stamp, , close] = line.split(",", 3);
      const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})$/.exec(stamp);
      if (!match) continue;
      const [, day, hh, mm] = match;
      const minute = Number(hh) * 60 + Number(mm);
      const morning = minute >= 570 && minute <= 690;
      const afternoon = minute >= 780 && minute <= 900;
      const price = quoteNumber(close);
      if (day < date || day > today || (day === today && minute > currentMinute) ||
          Number(mm) >= 60 || (!morning && !afternoon) || !Number.isFinite(price) || price <= 0) continue;
      if (day > date) {
        const midnight = new Date(`${day}T00:00:00Z`);
        if (!Number.isFinite(midnight.getTime()) || midnight.toISOString().slice(0, 10) !== day) continue;
        date = day;
        points.clear();
      }
      points.set(minute, { minute, price });
    }
    if (!points.size) return null;

    const preClose = quoteNumber(data.preClose);
    return {
      date, previousClose: Number.isFinite(preClose) && preClose > 0 ? preClose : null,
      points: [...points.values()].sort((a, b) => a.minute - b.minute)
    };
  }

  function trend(code) {
    if (!/^BK\d+$/.test(code)) return Promise.resolve(null);
    const cached = trendRequests.get(code);
    if (cached && Date.now() < cached.expiresAt) return cached.promise;
    const request = { expiresAt: Infinity };
    request.promise = loadTrend(code).catch(() => null).then((result) => {
      request.expiresAt = Date.now() + (result ? 30000 : 10000);
      return result;
    });
    for (const [key, item] of trendRequests) {
      if (Date.now() >= item.expiresAt) trendRequests.delete(key);
    }
    trendRequests.set(code, request);
    return request.promise;
  }

  function memberQuote({ code, name, price, pct, amount, turnover, cap, at, provider }) {
    const currentPrice = quoteNumber(price);
    if (!Number.isFinite(currentPrice) || currentPrice <= 0 || !Number.isFinite(at) || at <= 0) return null;
    const change = quoteNumber(pct);
    const amounts = [amount, turnover, cap].map(quoteNumber);
    if (!Number.isFinite(change) || amounts.some((value) => !Number.isFinite(value) || value < 0)) return null;
    return { code, name, quoted: true, pct: change, amount: amounts[0], turnover: amounts[1], cap: amounts[2], at, provider };
  }

  async function tencentQuoteBatch(entries) {
    const bySymbol = new Map(entries.map((entry) => [entry.tencentSymbol, entry]));
    const body = await readData(constituentQuoteEndpoint, { q: [...bySymbol.keys()].join(",") }, async (response) => {
      return new TextDecoder("gbk").decode(await response.arrayBuffer());
    });
    const rows = [];
    for (const match of body.matchAll(/v_((?:sh|sz|bj)\d{6})="([^"]*)";/g)) {
      const entry = bySymbol.get(match[1]);
      if (!entry) continue;
      const fields = match[2].split("~");
      const stamp = fields[30]?.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
      if (fields[2] !== entry.code || !stamp) continue;
      const [, year, month, day, hour, minute, second] = stamp;
      const row = memberQuote({
        code: entry.code, name: fields[1] || entry.name, price: fields[3], pct: fields[32],
        amount: fields[35]?.split("/")[2], turnover: fields[38], cap: Math.round(quoteNumber(fields[44]) * 100000000),
        at: Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`), provider: "tencent"
      });
      if (row) rows.push(row);
    }
    return rows;
  }

  async function recoverMemberQuotes(entries, byCode) {
    const missing = entries.filter((entry) => entry.tencentSymbol && !byCode.has(entry.code));
    const batchSize = 50;
    for (let start = 0; start < missing.length; start += batchSize * 4) {
      const group = missing.slice(start, start + batchSize * 4);
      const batches = [];
      for (let offset = 0; offset < group.length; offset += batchSize) {
        batches.push(tencentQuoteBatch(group.slice(offset, offset + batchSize)));
      }
      const results = await Promise.allSettled(batches);
      for (const result of results) {
        if (result.status !== "fulfilled") continue;
        for (const row of result.value) byCode.set(row.code, row);
      }
    }
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
      const product = /^(\d{6})\.(SH|SZ|BJ)$/i.exec(entry.SECUCODE || "");
      const exchange = product?.[1] === symbol ? product[2].toLowerCase() : null;
      const market = /\.SH$/i.test(entry.SECUCODE || "") ? 1 : 0;
      unique.set(symbol, { code: symbol, name: entry.SECURITY_NAME_ABBR || symbol, secid: `${market}.${symbol}`,
        tencentSymbol: exchange ? `${exchange}${symbol}` : null });
    }
    const entries = [...unique.values()];
    if (!entries.length) throw new Error("成分股目录为空");
    const total = Number(first.count) || entries.length;
    onRoster?.({ rows: entries.map(({ code, name }) => ({ code, name, quoted: false })), total });
    const snapshots = await quotes(entries.map((entry) => entry.secid), memberFields);
    const byCode = new Map();
    for (const quote of snapshots) {
      const entry = unique.get(quote.f12);
      if (!entry) continue;
      const row = memberQuote({
        code: entry.code, name: quote.f14 || entry.name, price: quote.f2, pct: quote.f3, amount: quote.f6,
        turnover: quote.f8, cap: quote.f21, at: Number(quote.f124) * 1000, provider: "eastmoney"
      });
      if (row) byCode.set(row.code, row);
    }
    await recoverMemberQuotes(entries, byCode);
    const rows = entries.map(({ code, name }) => byCode.get(code) ?? { code, name, quoted: false });
    return { rows, total };
  }

  window.QuantBoards = { directory, quotes, snapshot, members, trend };
})();


