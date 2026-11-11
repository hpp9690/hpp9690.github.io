(() => {
  const zone = "Asia/Shanghai", cacheKey = "quantLens.concepts.v1";
  const $ = (selector, root = document) => root.querySelector(selector);
  const safe = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const compact = (value) => String(value || "").toLowerCase().replace(/[\s·\-_（）()]/g, "").replace(/概念|板块/g, "");
  const money = (value) => value >= 1e8 ? `${(value / 1e8).toFixed(2)}亿` : `${(value / 1e4).toFixed(0)}万`;
  const pct = (value) => `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
  const mainBoard = (code) => /^(000|001|002|003|600|601|603|605)/.test(code);
  const shell = document.createElement("section");
  shell.id = "concept";
  shell.dataset.module = "concept";
  shell.className = "concept-panel";
  shell.hidden = document.body.dataset.view !== "concept";
  shell.setAttribute("aria-label", "概念板块选股器");
  shell.innerHTML = `<div class="concept-head"><div><p class="eyebrow">CONCEPT STOCK SCREENER</p><h2>概念板块选股器</h2><p>搜索概念 → 查看全部成分股 → 按盘面强度筛选龙头候选。</p></div><span id="conceptHealth">正在读取板块目录</span></div><form id="conceptForm" class="concept-search"><input id="conceptQuery" type="search" autocomplete="off" placeholder="搜索概念，如 机器人、AI应用、PCB" aria-label="搜索概念板块"><button type="submit">搜索板块</button><button type="button" id="conceptReload">更新目录</button></form><div class="concept-presets"><button type="button" data-concept-example="机器人">机器人</button><button type="button" data-concept-example="AI应用">AI应用</button><button type="button" data-concept-example="PCB">PCB</button></div><div id="conceptMatches" class="concept-matches"></div><div id="conceptResult" class="concept-result" hidden><div class="concept-board-head"><div><p class="eyebrow">当前板块</p><h3 id="conceptBoardName">—</h3><p id="conceptBoardMeta">读取成分股中</p></div><span id="conceptBoardMove">—</span></div><div id="conceptLeaders" class="concept-leaders"></div><div class="concept-filters"><label>市场 <select id="conceptMarket"><option value="all">全部A股</option><option value="main">沪深主板</option><option value="growth">创业板</option><option value="star">科创板</option><option value="beijing">北交所</option></select></label><label>涨幅 <select id="conceptGain"><option value="-100">不限</option><option value="0">≥0%</option><option value="2">≥2%</option><option value="5">≥5%</option></select></label><label>成交额 <select id="conceptAmount"><option value="0">不限</option><option value="50000000">≥5000万</option><option value="200000000">≥2亿</option></select></label><label>排序 <select id="conceptSort"><option value="leader">盘面强度</option><option value="pct">涨幅</option><option value="amount">成交额</option><option value="turnover">换手率</option><option value="cap">流通市值</option></select></label></div><div id="conceptCount" class="concept-count"></div><div id="conceptStocks" class="concept-stocks"></div><button type="button" id="conceptMore" hidden>显示更多成分股</button><p class="concept-note">“盘面龙头候选”按板块内涨幅、成交额、换手和流通市值排序，不代表公司业务地位或后续涨幅。公开行情可能延迟、缺页或调整板块成分。</p></div>`;
  ($(".opportunity-panel") || $(".decision-desk"))?.after(shell);
  let boards = [], selected = null, members = [], boardBusy = false, filterLimit = 40, queryLimit = 36, catalogueAt = 0;
  try { const cached = JSON.parse(localStorage.getItem(cacheKey) || "{}"); if (Date.now() - cached.at < 6 * 3600000 && Array.isArray(cached.boards)) { boards = cached.boards; catalogueAt = cached.at; } } catch {}
  const request = async (params) => {
    const url = new URL("https://push2.eastmoney.com/api/qt/clist/get");
    url.search = new URLSearchParams({ po: "1", np: "1", fltt: "2", invt: "2", ...params, _: String(Date.now()) });
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(url, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = await response.json();
      if (!json.data || !Array.isArray(json.data.diff)) throw new Error("行情接口未返回列表");
      return { rows: json.data.diff, total: Number(json.data.total) || json.data.diff.length };
    } finally { clearTimeout(timer); }
  };
  const boardPage = (page) => request({ pn: String(page), pz: "100", fid: "f12", fs: "m:90+t:3", fields: "f12,f14,f3,f6,f104,f105,f106,f124" });
  const memberPage = (code, page) => request({ pn: String(page), pz: "100", fid: "f12", fs: `b:${code}`, fields: "f2,f3,f6,f8,f10,f12,f14,f20,f21,f124" });
  const renderMatches = () => {
    const query = compact($("#conceptQuery").value);
    const matches = boards.filter((x) => !query || compact(x.name).includes(query)).sort((a, b) => query ? Number(compact(b.name) === query) - Number(compact(a.name) === query) || b.pct - a.pct : b.pct - a.pct);
    $("#conceptMatches").innerHTML = matches.slice(0, queryLimit).map((x) => `<button type="button" data-board="${safe(x.code)}" class="${selected?.code === x.code ? "active" : ""}"><b>${safe(x.name)}</b><span class="${x.pct >= 0 ? "up" : "down"}">${pct(x.pct)}</span></button>`).join("") + (matches.length > queryLimit ? `<button type="button" data-more-boards="1">更多板块（共 ${matches.length} 个）</button>` : "") || `<div class="concept-empty">${boards.length ? "没有匹配的概念板块" : "正在读取概念板块目录"}</div>`;
    $("#conceptHealth").textContent = boards.length ? `已载入 ${boards.length} 个概念板块` : "概念板块目录暂不可用";
  };
  const loadBoards = async (force = false) => {
    if (!force && boards.length && Date.now() - catalogueAt < 15 * 60000) { renderMatches(); return; }
    $("#conceptHealth").textContent = "正在更新概念板块目录";
    try {
      const first = await boardPage(1), pages = Math.ceil(first.total / 100), rows = [...first.rows], failed = [];
      for (let start = 2; start <= pages; start += 4) {
        const nums = Array.from({ length: Math.min(4, pages - start + 1) }, (_, i) => start + i);
        const results = await Promise.allSettled(nums.map(boardPage));
        results.forEach((r, i) => { if (r.status === "fulfilled") rows.push(...r.value.rows); else failed.push(nums[i]); });
      }
      if (failed.length) { const retry = await Promise.allSettled(failed.map(boardPage)); retry.forEach((r) => { if (r.status === "fulfilled") rows.push(...r.value.rows); }); }
      const next = [...new Map(rows.filter((x) => /^BK\d+$/.test(x.f12 || "")).map((x) => [x.f12, { code: x.f12, name: x.f14, pct: Number(x.f3) || 0, up: Number(x.f104) || 0, down: Number(x.f105) || 0, at: Number(x.f124) * 1000 || 0 }])).values()];
      if (!next.length) throw new Error("板块目录为空");
      boards = next; catalogueAt = Date.now();
      try { localStorage.setItem(cacheKey, JSON.stringify({ at: catalogueAt, boards })); } catch {}
      renderMatches();
      if (boards.length < first.total) $("#conceptHealth").textContent = `已载入 ${boards.length}/${first.total} 个板块 · 部分目录缺页`;
    } catch { renderMatches(); $("#conceptHealth").textContent = boards.length ? `目录更新失败 · 使用缓存 ${boards.length} 个` : "板块目录读取失败，请重试"; }
  };
  const marketOf = (code) => mainBoard(code) ? "main" : /^(300|301)/.test(code) ? "growth" : /^(688|689)/.test(code) ? "star" : /^(4|8|9)/.test(code) ? "beijing" : "other";
  const percentile = (rows, key) => {
    const sorted = [...rows].sort((a, b) => a[key] - b[key]);
    return new Map(sorted.map((x, i) => [x.code, sorted.length <= 1 ? .5 : i / (sorted.length - 1)]));
  };
  const scoreMembers = (rows) => {
    const gain = percentile(rows, "pct"), amount = percentile(rows, "amount"), turnover = percentile(rows, "turnover"), cap = percentile(rows, "cap");
    return rows.map((x) => ({ ...x, score: Math.max(0, Math.round(35 * gain.get(x.code) + 30 * amount.get(x.code) + 20 * turnover.get(x.code) + 15 * cap.get(x.code) - (/ST|退/.test(x.name) ? 25 : 0))) }));
  };
  const renderMembers = () => {
    if (!selected) return;
    let watchCodes = new Set();
    try { watchCodes = new Set(JSON.parse(localStorage.getItem("quantLens.watchlist.v1") || "[]").map((x) => x.code)); } catch {}
    const market = $("#conceptMarket").value, minGain = Number($("#conceptGain").value), minAmount = Number($("#conceptAmount").value), sort = $("#conceptSort").value;
    const filtered = members.filter((x) => (market === "all" || marketOf(x.code) === market) && x.pct >= minGain && x.amount >= minAmount);
    const ordered = [...filtered].sort((a, b) => (b[sort === "leader" ? "score" : sort] - a[sort === "leader" ? "score" : sort]) || b.amount - a.amount || a.code.localeCompare(b.code));
    const leaders = [...filtered].filter((x) => !/ST|退/.test(x.name)).sort((a, b) => b.score - a.score).slice(0, 3);
    $("#conceptLeaders").innerHTML = leaders.length ? leaders.map((x, i) => `<article class="concept-leader"><small>盘面龙头候选 ${i + 1}</small><b>${safe(x.name)} <em>${safe(x.code)}</em></b><span>强度 ${x.score} · 涨幅 <i class="${x.pct >= 0 ? "up" : "down"}">${pct(x.pct)}</i> · 成交 ${money(x.amount)}</span></article>`).join("") : `<div class="concept-empty">当前筛选条件下暂无龙头候选</div>`;
    $("#conceptCount").textContent = `成分股 ${members.length} 只 · 当前筛选 ${filtered.length} 只 · 显示 ${Math.min(filterLimit, filtered.length)} 只`;
    $("#conceptStocks").innerHTML = ordered.slice(0, filterLimit).map((x, i) => `<article class="concept-stock"><span class="concept-rank">${i + 1}</span><div class="concept-stock-name"><b>${safe(x.name)}</b><small>${safe(x.code)}</small></div><span class="${x.pct >= 0 ? "up" : "down"}">${pct(x.pct)}</span><span>成交 ${money(x.amount)}</span><span>换手 ${x.turnover.toFixed(2)}%</span><strong>${x.score} 分</strong><button type="button" data-stock-open="${safe(x.code)}">详情</button><button type="button" data-stock-watch="${safe(x.code)}">${watchCodes.has(x.code) ? "★ 已关注" : "☆ 关注"}</button></article>`).join("") || `<div class="concept-empty">当前条件下暂无成分股</div>`;
    $("#conceptMore").hidden = ordered.length <= filterLimit;
  };
  const selectBoard = async (code) => {
    if (boardBusy) return;
    const board = boards.find((x) => x.code === code); if (!board) return;
    selected = board; boardBusy = true; members = []; filterLimit = 40;
    $("#conceptResult").hidden = false; $("#conceptBoardName").textContent = board.name;
    $("#conceptBoardMove").textContent = pct(board.pct);
    $("#conceptBoardMove").className = board.pct >= 0 ? "up" : "down";
    $("#conceptBoardMeta").textContent = "正在读取板块成分股…";
    $("#conceptLeaders").innerHTML = ""; $("#conceptStocks").innerHTML = "";
    renderMatches();
    try {
      const first = await memberPage(code, 1), pages = Math.ceil(first.total / 100), rows = [...first.rows], failed = [];
      for (let start = 2; start <= pages; start += 4) {
        const nums = Array.from({ length: Math.min(4, pages - start + 1) }, (_, i) => start + i);
        const results = await Promise.allSettled(nums.map((n) => memberPage(code, n)));
        results.forEach((r, i) => { if (r.status === "fulfilled") rows.push(...r.value.rows); else failed.push(nums[i]); });
      }
      if (failed.length) { const retry = await Promise.allSettled(failed.map((n) => memberPage(code, n))); retry.forEach((r) => { if (r.status === "fulfilled") rows.push(...r.value.rows); }); }
      const unique = [...new Map(rows.filter((x) => /^\d{6}$/.test(x.f12 || "")).map((x) => [x.f12, { code: x.f12, name: x.f14, pct: Number(x.f3) || 0, amount: Number(x.f6) || 0, turnover: Number(x.f8) || 0, cap: Number(x.f21) || 0, at: Number(x.f124) * 1000 || 0 }])).values()];
      members = scoreMembers(unique);
      const latest = Math.max(0, ...unique.map((x) => x.at));
      const stamp = latest ? new Date(latest).toLocaleString("zh-CN", { timeZone: zone }) : "时间未知";
      $("#conceptBoardMeta").textContent = `${stamp} 行情 · ${unique.length}/${first.total} 只成分股${unique.length < first.total ? " · 部分缺页" : ""} · 板块上涨 ${board.up} / 下跌 ${board.down}`;
      renderMembers();
    } catch { $("#conceptBoardMeta").textContent = "成分股读取失败，请重新选择板块"; $("#conceptStocks").innerHTML = `<div class="concept-empty">行情接口暂不可用</div>`; }
    finally { boardBusy = false; }
  };
  $("#conceptQuery").addEventListener("input", () => { queryLimit = 36; renderMatches(); });
  $("#conceptForm").addEventListener("submit", (event) => { event.preventDefault(); const query = compact($("#conceptQuery").value); if (!query) { renderMatches(); return; } const match = boards.find((x) => compact(x.name) === query) || boards.find((x) => compact(x.name).includes(query)); if (match) selectBoard(match.code); else renderMatches(); });
  $("#conceptReload").addEventListener("click", () => loadBoards(true));
  shell.addEventListener("click", (event) => {
    const preset = event.target.closest("[data-concept-example]"); if (preset) { $("#conceptQuery").value = preset.dataset.conceptExample; renderMatches(); const first = boards.find((x) => compact(x.name).includes(compact(preset.dataset.conceptExample))); if (first) selectBoard(first.code); return; }
    const board = event.target.closest("[data-board]"); if (board) { selectBoard(board.dataset.board); return; }
    if (event.target.closest("[data-more-boards]")) { queryLimit += 36; renderMatches(); return; }
    const open = event.target.closest("[data-stock-open]"); if (open) { const input = $("#stockSearch"), form = $("#lookupForm"); if (input && form) { document.dispatchEvent(new CustomEvent("quant:open-view", { detail: { id: "lookup" } })); input.value = open.dataset.stockOpen; form.requestSubmit(); } return; }
    const watch = event.target.closest("[data-stock-watch]"); if (watch) { const item = members.find((x) => x.code === watch.dataset.stockWatch); if (item) document.dispatchEvent(new CustomEvent("quant:watch-request", { detail: { code: item.code, name: item.name } })); }
  });
  ["conceptMarket", "conceptGain", "conceptAmount", "conceptSort"].forEach((id) => $("#" + id).addEventListener("change", () => { filterLimit = 40; renderMembers(); }));
  $("#conceptMore").addEventListener("click", () => { filterLimit += 40; renderMembers(); });
  document.addEventListener("quant:watchlist-changed", renderMembers);
  renderMatches(); loadBoards();
})();

