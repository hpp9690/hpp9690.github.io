(() => {
  const zone = "Asia/Shanghai", cacheKey = "quantLens.concepts.v1";
  const $ = (selector, root = document) => root.querySelector(selector);
  const safe = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const compact = (value) => String(value || "").toLowerCase().replace(/[\s·\-_（）()]/g, "").replace(/概念|板块/g, "");
  const money = (value) => value >= 1e8 ? `${(value / 1e8).toFixed(2)}亿` : `${(value / 1e4).toFixed(0)}万`;
  const pct = (value) => Number.isFinite(value) ? `${value > 0 ? "+" : ""}${value.toFixed(2)}%` : "—";
  const mainBoard = (code) => /^(000|001|002|003|600|601|603|605)/.test(code);
  const classification = window.QuantBoardGroups;
  const categories = classification.groups;
  const boardListLimit = 6;
  const shell = document.createElement("section");
  shell.id = "concept";
  shell.dataset.module = "concept";
  shell.className = "concept-panel";
  shell.hidden = document.body.dataset.view !== "concept";
  shell.setAttribute("aria-label", "板块");
  shell.innerHTML = `<div class="concept-head"><h2>板块总览</h2></div>
    <form id="conceptForm" class="concept-search">
      <input id="conceptQuery" type="search" autocomplete="off" placeholder="搜索板块，如机器人、PCB" aria-label="搜索行业或概念">
      <button type="submit">搜索</button>
    </form>
    <div id="boardCategoryHome" class="board-category-home">
      <div class="board-category-grid" aria-label="板块大类"></div>
      <details id="boardRanking" class="market-panel-disclosure">
        <summary>板块涨跌排行</summary>
        <section id="boardOverview" aria-label="板块涨跌排行"></section>
      </details>
    </div>
    <div id="boardCategoryDetail" class="board-category-detail" hidden>
      <div class="board-category-header">
        <button type="button" id="boardCategoryBack">‹ 全部大类</button>
        <h3 id="boardCategoryTitle" tabindex="-1"></h3><p id="boardCategoryDescription"></p>
      </div>
      <div class="board-category-tabs board-overview-switch" role="group" aria-label="大类内筛选"></div>
    </div>
    <p id="conceptHealth" class="board-catalogue-status" hidden></p>
    <div id="conceptMatches" class="concept-matches" hidden></div>
    <div id="conceptResult" class="concept-result" hidden>
      <div class="concept-board-head"><div><h3 id="conceptBoardName" tabindex="-1">—</h3><p id="conceptBoardMeta">读取成分股中</p></div><span id="conceptBoardMove">—</span></div>
      <div class="board-detail-charts">
        <figure id="conceptTrend" class="board-trend" hidden></figure>
        <div id="conceptBreadth" class="board-breadth" hidden></div>
      </div>
      <div id="conceptLeaders" class="concept-leaders"></div>
      <div class="concept-filters"><label>市场 <select id="conceptMarket"><option value="all">全部A股</option><option value="main">沪深主板</option><option value="growth">创业板</option><option value="star">科创板</option><option value="beijing">北交所</option></select></label><label>涨幅 <select id="conceptGain"><option value="-100">不限</option><option value="0">≥0%</option><option value="2">≥2%</option><option value="5">≥5%</option></select></label><label>成交额 <select id="conceptAmount"><option value="0">不限</option><option value="50000000">≥5000万</option><option value="200000000">≥2亿</option></select></label><label>排序 <select id="conceptSort"><option value="leader">盘面强度</option><option value="pct">涨幅</option><option value="amount">成交额</option><option value="turnover">换手率</option><option value="cap">流通市值</option></select></label></div>
      <div id="conceptCount" class="concept-count"></div><div id="conceptStocks" class="concept-stocks"></div>
      <button type="button" id="conceptMore" hidden>显示更多成分股</button>
      <details class="market-panel-disclosure"><summary>盘面强度说明</summary><p>龙头候选按板块内涨幅、成交额、换手和流通市值排序。公开行情可能延迟、缺页或调整板块成分。</p></details>
    </div>`;
  ($(".opportunity-panel") || $(".decision-desk"))?.after(shell);
  $("#conceptQuery").insertAdjacentHTML("afterend", `<button type="button" id="conceptClear" aria-label="清除搜索内容" hidden>×</button>`);
  $("#conceptBoardMove").insertAdjacentHTML("afterend", `<button type="button" id="conceptChange">返回总览</button>`);
  $(".concept-filters", shell).insertAdjacentHTML("beforebegin", `<div class="concept-sort-tabs" role="group" aria-label="成分股排序"><button type="button" data-concept-sort="leader" class="active" aria-pressed="true">综合</button><button type="button" data-concept-sort="pct" aria-pressed="false">涨幅</button><button type="button" data-concept-sort="amount" aria-pressed="false">成交</button><button type="button" data-concept-sort="turnover" aria-pressed="false">换手</button><button type="button" data-concept-sort="cap" aria-pressed="false">市值</button></div>`);
  $("#conceptSort").closest("label").hidden = true;
  $(".concept-filters", shell).insertAdjacentHTML("beforeend", `<button type="button" id="conceptReset">重置筛选</button>`);
  $("#conceptMatches").setAttribute("aria-live", "polite");
  $("#conceptHealth").setAttribute("role", "status");
  let boards = [], selected = null, members = [], filterLimit = 40, queryLimit = boardListLimit, catalogueAt = 0, selectionToken = 0, searchOpen = true, directoryReady = false;
  let category = null, categoryKind = "industry";
  let recentCodes = [];
  try { recentCodes = JSON.parse(localStorage.getItem("quantLens.conceptRecent.v1") || "[]").filter((x) => /^BK\d+$/.test(x)).slice(0, 5); } catch {}
  try { const cached = JSON.parse(localStorage.getItem(cacheKey) || "{}"); if (Date.now() - cached.at < 6 * 3600000 && Array.isArray(cached.boards)) { boards = cached.boards.map((board) => ({ ...board, kind: "concept" })); catalogueAt = cached.at; } } catch {}
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
  const kindLabel = (board) => board.kind === "industry" ? "行业" : "概念";
  const recentRank = (code) => recentCodes.includes(code) ? recentCodes.indexOf(code) : recentCodes.length;
  const categoryTerms = (group) => [group.label, ...group.aliases.split(" ")].map(compact);
  const matchesCategory = (query) => categories.filter((group) => categoryTerms(group).some((term) => term.includes(query)));
  const searchName = (board) => compact(classification.name(board));
  const searchRank = (board, query, raw) => {
    if (board.name.toLowerCase() === raw.trim().toLowerCase()) return 0;
    if ([searchName(board), ...classification.aliases(board).split(" ").map(compact)].includes(query)) return 1;
    return 2;
  };
  const matchesQuery = (query, raw) => boards.filter((board) => `${board.name} ${classification.name(board)} ${classification.aliases(board)}`
    .split(" ").some((term) => compact(term).includes(query))).sort((a, b) =>
    searchRank(a, query, raw) - searchRank(b, query, raw) || Number(b.kind === "industry") - Number(a.kind === "industry") ||
    a.name.localeCompare(b.name, "zh-CN"));
  const categoryButton = (group) => `<button type="button" class="board-category-card" data-category="${group.id}"><strong>${group.label}</strong><span>${group.preview}</span></button>`;
  const categoryBoards = (group) => boards.filter((board) => classification.forBoard(board) === group);
  const categoryKinds = [{ id: "industry", label: "行业" }, { id: "concept", label: "相关概念" }];
  $(".board-category-grid", shell).innerHTML = categories.map(categoryButton).join("");
  const renderMatches = () => {
    const raw = $("#conceptQuery").value;
    const query = compact(raw);
    const detail = searchOpen && category && !query;
    const showing = searchOpen && Boolean(query || category);
    const list = $("#conceptMatches"), status = $("#conceptHealth");
    $("#boardCategoryHome").hidden = !searchOpen || Boolean(query || category);
    $("#boardCategoryDetail").hidden = !detail;
    $("#conceptClear").hidden = !raw;
    list.hidden = status.hidden = !showing;
    if (!showing) return;
    const scoped = detail ? categoryBoards(category) : [];
    const market = detail && category.id === "market";
    const typeOf = market ? classification.marketSection : (board) => board.kind;
    if (detail) {
      $("#boardCategoryTitle").textContent = category.label;
      $("#boardCategoryDescription").textContent = category.preview;
      const tabs = $(".board-category-tabs", shell);
      const counts = new Map();
      for (const board of scoped) {
        const kind = typeOf(board);
        counts.set(kind, (counts.get(kind) || 0) + 1);
      }
      if (!counts.get(categoryKind) && counts.size) categoryKind = counts.keys().next().value;
      const active = tabs.contains(document.activeElement) ? document.activeElement.dataset.categoryKind : "";
      const markup = (market ? classification.marketSections : categoryKinds).filter((kind) => counts.has(kind.id))
        .map((kind) => `<button type="button" data-category-kind="${kind.id}" aria-pressed="${kind.id === categoryKind}">${kind.label} ${counts.get(kind.id)}</button>`).join("");
      tabs.innerHTML = markup;
      tabs.hidden = !markup;
      if (active) tabs.querySelector(`[data-category-kind="${active}"]`)?.focus({ preventScroll: true });
    }
    const priorityCodes = detail ? (categoryKind === "industry" ? category.industries.split(" ").map((code) => `BK${code}`)
      : category.featured || []) : [];
    const priority = (code) => priorityCodes.includes(code) ? priorityCodes.indexOf(code) : priorityCodes.length;
    const matches = query ? matchesQuery(query, raw) : scoped.filter((board) => typeOf(board) === categoryKind)
      .sort((a, b) => priority(a.code) - priority(b.code) || recentRank(a.code) - recentRank(b.code) || a.name.localeCompare(b.name, "zh-CN"));
    const matchingGroups = query ? matchesCategory(query).map(categoryButton).join("") : "";
    status.textContent = query && matches.length ? `细分板块 · ${matches.length} 个` : "";
    status.hidden = !status.textContent;
    const focused = list.contains(document.activeElement) ? document.activeElement.dataset : {};
    const boardCards = matches.slice(0, queryLimit).map((board) => {
      const quote = overview.quote(board);
      const label = classification.name(board);
      const parent = query ? ` · ${classification.forBoard(board).label}` : "";
      return `<button type="button" data-board="${safe(board.code)}" title="${safe(board.name)}">
        <b>${safe(label)} <small>${kindLabel(board)}${safe(parent)}</small></b>
        <span class="${quote ? quote.pct >= 0 ? "up" : "down" : "muted"}">${quote ? pct(quote.pct) : "成分股 ›"}</span></button>`;
    }).join("");
    list.innerHTML = matchingGroups + boardCards + (matches.length > queryLimit ? `<button type="button" data-more-boards>继续查看 · ${matches.length - queryLimit} 个</button>` : "")
      || `<div class="concept-empty">${boards.length ? "暂无匹配的板块" : directoryReady ? "板块目录暂不可用" : "正在读取板块目录"}</div>`;
    if (focused.board) list.querySelector(`[data-board="${focused.board}"]`)?.focus({ preventScroll: true });
    if (focused.category) list.querySelector(`[data-category="${focused.category}"]`)?.focus({ preventScroll: true });
  };
  const overview = window.QuantBoardOverview.mount($("#boardOverview"), {
    onSelect: (board) => selectBoard(board.code, board)
  });
  const mergeBoards = (entries) => {
    const merged = new Map(boards.map((board) => [board.code, board]));
    for (const board of entries) merged.set(board.code, board);
    boards = [...merged.values()];
  };
  const fetchBoards = async () => {
    try {
      const first = await boardPage(1), pages = Math.ceil(first.total / 100), rows = [...first.rows], failed = [];
      for (let start = 2; start <= pages; start += 4) {
        const nums = Array.from({ length: Math.min(4, pages - start + 1) }, (_, i) => start + i);
        const results = await Promise.allSettled(nums.map(boardPage));
        results.forEach((r, i) => { if (r.status === "fulfilled") rows.push(...r.value.rows); else failed.push(nums[i]); });
      }
      if (failed.length) { const retry = await Promise.allSettled(failed.map(boardPage)); retry.forEach((r) => { if (r.status === "fulfilled") rows.push(...r.value.rows); }); }
      const next = [...new Map(rows.filter((x) => /^BK\d+$/.test(x.f12 || "") && typeof x.f14 === "string")
        .map((x) => [x.f12, { code: x.f12, name: x.f14, kind: "concept" }])).values()];
      if (!next.length) throw new Error("板块目录为空");
      mergeBoards(next);
      try { localStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), boards: next })); } catch {}
    } catch {}
    finally { catalogueAt = Date.now(); renderMatches(); }
  };
  let catalogueRequest;
  const loadBoards = () => {
    if (catalogueRequest) return catalogueRequest;
    if (Date.now() - catalogueAt < 15 * 60000) {
      renderMatches();
      return Promise.resolve();
    }
    catalogueRequest = fetchBoards().finally(() => { catalogueRequest = null; });
    return catalogueRequest;
  };
  const marketOf = (code) => mainBoard(code) ? "main" : /^(300|301)/.test(code) ? "growth" : /^(688|689)/.test(code) ? "star" : /^(4|8|9)/.test(code) ? "beijing" : "other";
  const percentile = (rows, key) => {
    const sorted = [...rows].sort((a, b) => a[key] - b[key]);
    return new Map(sorted.map((x, i) => [x.code, sorted.length <= 1 ? .5 : i / (sorted.length - 1)]));
  };
  const scoreMembers = (rows) => {
    const quoted = rows.filter((row) => row.quoted);
    const gain = percentile(quoted, "pct"), amount = percentile(quoted, "amount"), turnover = percentile(quoted, "turnover"), cap = percentile(quoted, "cap");
    return rows.map((x) => ({ ...x, score: x.quoted
      ? Math.max(0, Math.round(35 * gain.get(x.code) + 30 * amount.get(x.code) + 20 * turnover.get(x.code) + 15 * cap.get(x.code) - (/ST|退/.test(x.name) ? 25 : 0)))
      : null }));
  };
  const renderMembers = () => {
    if (!selected) return;
    let watchCodes = new Set();
    try { watchCodes = new Set(JSON.parse(localStorage.getItem("quantLens.watchlist.v1") || "[]").map((x) => x.code)); } catch {}
    const market = $("#conceptMarket").value, minGain = Number($("#conceptGain").value), minAmount = Number($("#conceptAmount").value), sort = $("#conceptSort").value;
    const filtered = members.filter((x) => (market === "all" || marketOf(x.code) === market) &&
      (x.quoted ? x.pct >= minGain && x.amount >= minAmount : minGain === -100 && minAmount === 0));
    const field = sort === "leader" ? "score" : sort;
    const ordered = [...filtered].sort((a, b) => Number(b.quoted) - Number(a.quoted) ||
      (b[field] - a[field]) || b.amount - a.amount || a.code.localeCompare(b.code));
    const quoted = filtered.filter((x) => x.quoted);
    const leaders = quoted.filter((x) => !/ST|退/.test(x.name)).sort((a, b) => b.score - a.score).slice(0, 3);
    const gainLeader = [...quoted].sort((a, b) => b.pct - a.pct)[0], amountLeader = [...quoted].sort((a, b) => b.amount - a.amount)[0];
    $("#conceptLeaders").innerHTML = leaders.length ? leaders.map((x, i) => `<article class="concept-leader"><small>盘面龙头候选 ${i + 1}</small><b>${safe(x.name)} <em>${safe(x.code)}</em></b><span>强度 ${x.score} · 涨幅 <i class="${x.pct >= 0 ? "up" : "down"}">${pct(x.pct)}</i> · 成交 ${money(x.amount)}</span></article>`).join("") + `<div class="concept-roles"><span>涨幅领先：<b>${safe(gainLeader.name)}</b> ${pct(gainLeader.pct)}</span><span>成交核心：<b>${safe(amountLeader.name)}</b> ${money(amountLeader.amount)}</span></div>` : `<div class="concept-empty">当前筛选条件下暂无龙头候选</div>`;
    $("#conceptCount").textContent = `成分股 ${members.length} 只 · 当前筛选 ${filtered.length} 只 · 显示 ${Math.min(filterLimit, filtered.length)} 只`;
    $("#conceptStocks").innerHTML = ordered.slice(0, filterLimit).map((x, i) => `<article class="concept-stock"><span class="concept-rank">${i + 1}</span><div class="concept-stock-name"><b>${safe(x.name)}</b><small>${safe(x.code)}</small></div><span class="${x.quoted ? (x.pct >= 0 ? "up" : "down") : "muted"}">${pct(x.pct)}</span><span>成交 ${x.quoted ? money(x.amount) : "—"}</span><span>换手 ${x.quoted ? x.turnover.toFixed(2) + "%" : "—"}</span><strong>${x.quoted ? x.score + " 分" : "待报价"}</strong><button type="button" data-stock-open="${safe(x.code)}">详情</button><button type="button" data-stock-watch="${safe(x.code)}">${watchCodes.has(x.code) ? "★ 已关注" : "☆ 关注"}</button></article>`).join("") || `<div class="concept-empty">当前条件下暂无成分股</div>`;
    $("#conceptMore").hidden = ordered.length <= filterLimit;
  };
  const loadMembers = async (code, onRoster) => {
    try { return await window.QuantBoards.members(code, onRoster); }
    catch {
      const first = await memberPage(code, 1), pages = Math.ceil(first.total / 100), rows = [...first.rows], failed = [];
      for (let start = 2; start <= pages; start += 4) {
        const nums = Array.from({ length: Math.min(4, pages - start + 1) }, (_, i) => start + i);
        const results = await Promise.allSettled(nums.map((number) => memberPage(code, number)));
        results.forEach((result, i) => {
          if (result.status === "fulfilled") rows.push(...result.value.rows);
          else failed.push(nums[i]);
        });
      }
      if (failed.length) {
        const retries = await Promise.allSettled(failed.map((page) => memberPage(code, page)));
        retries.forEach((result) => { if (result.status === "fulfilled") rows.push(...result.value.rows); });
      }
      const unique = new Map();
      for (const x of rows) {
        if (!/^\d{6}$/.test(x.f12 || "")) continue;
        const quoted = Number(x.f2) > 0 && Number.isFinite(Number(x.f3));
        unique.set(x.f12, quoted ? { code: x.f12, name: x.f14, quoted, pct: Number(x.f3),
          amount: Number(x.f6) || 0, turnover: Number(x.f8) || 0, cap: Number(x.f21) || 0, at: Number(x.f124) * 1000 || 0 }
          : { code: x.f12, name: x.f14, quoted });
      }
      return { rows: [...unique.values()], total: first.total };
    }
  };
  const selectBoard = async (code, suppliedBoard) => {
    const board = suppliedBoard || boards.find((x) => x.code === code); if (!board) return;
    const token = ++selectionToken;
    selected = board; members = []; filterLimit = 40; searchOpen = false;
    $("#conceptReset").click();
    if (board.kind !== "industry") {
      recentCodes = [code, ...recentCodes.filter((x) => x !== code)].slice(0, 5);
      try { localStorage.setItem("quantLens.conceptRecent.v1", JSON.stringify(recentCodes)); } catch {}
    }
    const name = classification.name(board);
    $("#conceptQuery").value = name;
    $("#conceptChange").textContent = category ? `返回${category.label}` : "返回总览";
    $("#conceptResult").hidden = false; $("#conceptBoardName").textContent = name;
    const quote = Number.isFinite(board.pct) ? board : overview.quote(board);
    const showMove = (value, at) => {
      const move = $("#conceptBoardMove");
      move.textContent = pct(value);
      move.className = Number.isFinite(value) ? (value >= 0 ? "up" : "down") : "muted";
      move.title = at ? `板块报价 ${new Date(at).toLocaleString("zh-CN", { timeZone: zone })}` : "";
    };
    showMove(quote?.pct, quote?.at);
    window.QuantBoardOverview.showBreadth($("#conceptBreadth"), []);
    window.QuantBoardOverview.showTrend($("#conceptTrend"), null);
    window.QuantBoards.trend(code).then((trend) => {
      if (token === selectionToken) window.QuantBoardOverview.showTrend($("#conceptTrend"), trend);
    }).catch(() => {});
    $("#conceptBoardMeta").textContent = "正在读取板块成分股…";
    $("#conceptLeaders").innerHTML = `<div class="concept-loading">正在计算板块盘面强度…</div>`;
    $("#conceptStocks").innerHTML = `<div class="concept-loading">正在读取成分股…</div>`;
    $("#conceptResult").setAttribute("aria-busy", "true");
    renderMatches();
    $("#conceptBoardName").focus({ preventScroll: true });
    if (!quote) {
      window.QuantBoards.quotes([`90.${code}`], "f12,f3,f124").then((rows) => {
        const value = rows.find((row) => row.f12 === code);
        if (token !== selectionToken || value?.f3 == null || value.f3 === "" || !Number.isFinite(Number(value.f3))) return;
        showMove(Number(value.f3), (Number(value.f124) || 0) * 1000);
      }).catch(() => {});
    }
    const showMembers = (result, loadingQuotes = false) => {
      if (token !== selectionToken) return;
      members = scoreMembers(result.rows);
      const latest = Math.max(0, ...members.map((x) => x.at || 0));
      const stamp = latest ? `报价 ${new Date(latest).toLocaleString("zh-CN", { timeZone: zone })}` : "报价时间未知";
      const quoted = members.filter((x) => x.quoted).length;
      const tencent = members.filter((x) => x.quoted && x.provider === "tencent").length;
      const quoteStatus = loadingQuotes ? "正在读取个股报价" : `已取报价 ${quoted} 只 · ${stamp}${tencent ? ` · 腾讯补充 ${tencent} 只` : ""}`;
      $("#conceptBoardMeta").textContent = `${members.length}/${result.total} 只成分股 · ${quoteStatus}${members.length < result.total ? " · 部分缺页" : ""}`;
      window.QuantBoardOverview.showBreadth($("#conceptBreadth"), members);
      renderMembers();
    };
    try {
      const result = await loadMembers(code, (roster) => showMembers(roster, true));
      showMembers(result);
    } catch { if (token === selectionToken) { $("#conceptBoardMeta").textContent = "成分股读取失败，请重新选择板块"; $("#conceptStocks").innerHTML = `<div class="concept-empty">行情接口暂不可用</div>`; } }
    finally { if (token === selectionToken) $("#conceptResult").removeAttribute("aria-busy"); }
  };
  const revealSearch = (clear = false) => {
    searchOpen = true; queryLimit = boardListLimit;
    if (clear) $("#conceptQuery").value = "";
    $("#conceptResult").hidden = true;
    renderMatches();
  };
  const openCategory = (id) => {
    const group = categories.find((entry) => entry.id === id);
    if (!group) return;
    selectionToken++;
    selected = null;
    if (group.direct) {
      const board = boards.find((entry) => entry.code === group.direct) ||
        { code: group.direct, name: group.label, kind: "industry" };
      category = null;
      selectBoard(board.code, board);
      return;
    }
    category = group;
    categoryKind = group.id === "market" ? "indices" : "industry";
    revealSearch(true);
    $("#boardCategoryTitle").focus({ preventScroll: true });
  };
  document.addEventListener("quant:open-board", (event) => {
    const board = event.detail;
    if (!/^BK\d+$/.test(board?.code || "") || typeof board.name !== "string") return;
    category = null;
    document.dispatchEvent(new CustomEvent("quant:open-view", { detail: { id: "concept" } }));
    selectBoard(board.code, board);
  });
  document.addEventListener("quant:open-concept", async (event) => {
    const name = event.detail?.name?.trim();
    if (!name) return;
    category = null;
    const findBoard = () => boards.find((board) => board.kind === "concept" && board.name === name);
    document.dispatchEvent(new CustomEvent("quant:open-view", { detail: { id: "concept" } }));
    const board = findBoard();
    if (board) {
      selectBoard(board.code);
      return;
    }
    const query = $("#conceptQuery");
    const token = selectionToken;
    query.value = name;
    revealSearch();
    await directoryTask;
    if (!findBoard()) await loadBoards();
    if (token !== selectionToken || query.value !== name || document.body.dataset.view !== "concept") return;
    const refreshedBoard = findBoard();
    if (refreshedBoard) selectBoard(refreshedBoard.code);
  });
  $("#conceptQuery").addEventListener("input", () => {
    revealSearch();
    if ($("#conceptQuery").value.trim()) loadBoards();
  });
  $("#conceptQuery").addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" && !$("#conceptMatches").hidden) {
      const first = $("#conceptMatches [data-category], #conceptMatches [data-board]");
      if (first) { event.preventDefault(); first.focus(); }
    }
    if (event.key === "Escape" && selected) { searchOpen = false; $("#conceptQuery").value = classification.name(selected); $("#conceptResult").hidden = false; renderMatches(); $("#conceptBoardName").focus(); }
  });
  $("#conceptMatches").addEventListener("keydown", (event) => {
    const choices = [...$("#conceptMatches").querySelectorAll("[data-category],[data-board]")], index = choices.indexOf(document.activeElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); (choices[index + (event.key === "ArrowDown" ? 1 : -1)] || choices[event.key === "ArrowDown" ? 0 : choices.length - 1])?.focus(); }
    if (event.key === "Escape") { event.preventDefault(); $("#conceptQuery").focus(); }
  });
  $("#conceptForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const value = $("#conceptQuery").value, query = compact(value);
    if (!query) { renderMatches(); return; }
    const group = categories.find((entry) => categoryTerms(entry).includes(query));
    if (group) { openCategory(group.id); return; }
    await directoryTask;
    let match = matchesQuery(query, value)[0];
    if (!match) {
      await loadBoards();
      match = matchesQuery(query, value)[0];
    }
    if ($("#conceptQuery").value !== value) return;
    if (match) selectBoard(match.code);
    else renderMatches();
  });
  $("#conceptClear").addEventListener("click", () => { revealSearch(true); $("#conceptQuery").focus(); });
  $("#conceptChange").addEventListener("click", () => {
    selectionToken++;
    selected = null;
    revealSearch(true);
    if (category) $("#boardCategoryTitle").focus({ preventScroll: true });
    else $("#conceptQuery").focus({ preventScroll: true });
  });
  $("#boardCategoryBack").addEventListener("click", () => {
    const previous = category;
    category = null;
    revealSearch(true);
    if (previous) $(`#boardCategoryHome [data-category="${previous.id}"]`)?.focus({ preventScroll: true });
  });
  $("#conceptReset").addEventListener("click", () => {
    $("#conceptMarket").value = "all"; $("#conceptGain").value = "-100"; $("#conceptAmount").value = "0"; $("#conceptSort").value = "leader";
    shell.querySelectorAll("[data-concept-sort]").forEach((x) => { const active = x.dataset.conceptSort === "leader"; x.classList.toggle("active", active); x.setAttribute("aria-pressed", String(active)); });
    filterLimit = 40; renderMembers();
  });
  shell.addEventListener("click", (event) => {
    const group = event.target.closest("[data-category]");
    if (group) { openCategory(group.dataset.category); return; }
    const tab = event.target.closest("[data-category-kind]");
    if (tab) {
      categoryKind = tab.dataset.categoryKind;
      queryLimit = boardListLimit;
      renderMatches();
      if (categoryKind !== "industry") loadBoards();
      return;
    }
    const sort = event.target.closest("[data-concept-sort]"); if (sort) { $("#conceptSort").value = sort.dataset.conceptSort; shell.querySelectorAll("[data-concept-sort]").forEach((x) => { const active = x === sort; x.classList.toggle("active", active); x.setAttribute("aria-pressed", String(active)); }); filterLimit = 40; renderMembers(); return; }
    const board = event.target.closest("[data-board]"); if (board) { selectBoard(board.dataset.board); return; }
    if (event.target.closest("[data-more-boards]")) {
      const firstNew = queryLimit;
      queryLimit += 12;
      renderMatches();
      $("#conceptMatches").querySelectorAll("[data-board]")[firstNew]?.focus();
      return;
    }
    const open = event.target.closest("[data-stock-open]"); if (open) { const input = $("#stockSearch"), form = $("#lookupForm"); if (input && form) { document.dispatchEvent(new CustomEvent("quant:open-view", { detail: { id: "lookup" } })); input.value = open.dataset.stockOpen; form.requestSubmit(); } return; }
    const watch = event.target.closest("[data-stock-watch]"); if (watch) { const item = members.find((x) => x.code === watch.dataset.stockWatch); if (item) document.dispatchEvent(new CustomEvent("quant:watch-request", { detail: { code: item.code, name: item.name } })); }
  });
  ["conceptMarket", "conceptGain", "conceptAmount", "conceptSort"].forEach((id) => $("#" + id).addEventListener("change", () => { filterLimit = 40; renderMembers(); }));
  $("#conceptMore").addEventListener("click", () => { filterLimit += 40; renderMembers(); });
  document.addEventListener("quant:watchlist-changed", renderMembers);
  document.addEventListener("quant:board-quotes-snapshot", (event) => { overview.accept(event.detail); renderMatches(); });
  document.addEventListener("quant:view-changed", (event) => { if (event.detail?.id === "concept") overview.refresh(); });
  document.addEventListener("quant:refresh-market", () => { if (!shell.hidden) overview.refresh(true); });
  const directoryTask = window.QuantBoards.directory().then(({ boards: entries }) => {
    mergeBoards(entries);
  }).catch(() => {}).finally(() => {
    directoryReady = true;
    renderMatches();
  });
  renderMatches();
  if (!shell.hidden) overview.refresh();
})();

