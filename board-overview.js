(() => {
  const zone = "Asia/Shanghai";
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
  const stamp = new Intl.DateTimeFormat("zh-CN", {
    timeZone: zone, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  });
  const cacheKey = "quantLens.boardOverview.v1";
  const cacheAge = 7 * 86400000;
  const kinds = { industry: "行业", concept: "概念" };
  const direction = (value) => value > 0 ? "up" : value < 0 ? "down" : "flat";
  const percent = (value) => `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;

  function number(value) {
    return (typeof value === "number" || (typeof value === "string" && value.trim())) &&
      Number.isFinite(Number(value)) ? Number(value) : null;
  }

  function fromSnapshot(catalogue, rows) {
    const now = Date.now();
    const groups = { industry: new Map(), concept: new Map() };
    const byCode = new Map(catalogue.boards.map((board) => [board.code, board]));
    for (const row of rows) {
      const board = byCode.get(row.f12);
      const pct = number(row.f3), at = (number(row.f124) || 0) * 1000;
      if (!board || pct === null || !at || at > now + 5000 || now - at > cacheAge) continue;
      const group = groups[board.kind];
      if (at < (group.get(board.code)?.at || 0)) continue;
      group.set(board.code, { ...board, pct, at });
    }
    return Object.fromEntries(Object.entries(groups).map(([kind, group]) => {
      const latest = Math.max(0, ...[...group.values()].map((board) => board.at));
      const records = latest ? [...group.values()].filter((board) => day.format(board.at) === day.format(latest)) : [];
      const total = catalogue.boards.filter((board) => board.kind === kind).length;
      return [kind, { records, latest, total }];
    }));
  }

  function cache() {
    try {
      const stored = JSON.parse(localStorage.getItem(cacheKey) || "{}");
      for (const kind of Object.keys(kinds)) {
        const group = stored[kind];
        if (!Number.isFinite(group?.latest) || Date.now() - group.latest > cacheAge || group.latest > Date.now() ||
            !group.records?.length || !group.records.every((row) => row && row.kind === kind &&
              /^BK\d+$/.test(row.code) && typeof row.name === "string" && Number.isFinite(row.pct) &&
              Number.isFinite(row.at) && row.at <= group.latest)) delete stored[kind];
        else group.cached = true;
      }
      return stored;
    } catch { return {}; }
  }

  function mount(host, { onSelect }) {
    const stored = cache();
    let kind = "industry", phase = "waiting", lastSnapshot;
    host.className = "board-overview";
    host.innerHTML = `
      <div class="board-overview-head"><span id="boardOverviewStatus" role="status"></span></div>
      <div class="board-overview-toolbar">
        <div class="board-overview-switch" role="group" aria-label="板块分类">
          <button type="button" data-board-kind="industry" aria-pressed="true">行业</button>
          <button type="button" data-board-kind="concept" aria-pressed="false">概念</button>
        </div>
      </div>
      <div class="board-overview-grid" id="boardOverviewChart" aria-label="板块涨跌排行"></div>`;
    const grid = host.querySelector("#boardOverviewChart");
    const status = host.querySelector("#boardOverviewStatus");

    function makeColumn(label, rows, scale, empty) {
      const column = document.createElement("section");
      column.className = "board-overview-column";
      const title = document.createElement("h3");
      title.textContent = label;
      const list = document.createElement("div");
      list.className = "board-overview-rows";
      for (const row of rows) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "board-overview-row";
        button.dataset.chartBoard = row.code;
        button.dataset.direction = direction(row.pct);
        button.setAttribute("aria-label", `${row.name} ${percent(row.pct)}，查看成分股`);
        button.innerHTML = '<span class="board-overview-name"></span><span class="board-overview-track" aria-hidden="true"><span class="board-overview-fill"></span></span><strong class="board-overview-value"></strong>';
        button.querySelector(".board-overview-name").textContent = row.name;
        button.querySelector(".board-overview-value").textContent = percent(row.pct);
        button.style.setProperty("--board-bar-width", `${100 * Math.abs(row.pct) / scale}%`);
        list.append(button);
      }
      if (!rows.length) {
        const message = document.createElement("div");
        message.className = "board-overview-empty";
        message.textContent = empty;
        list.append(message);
      }
      column.append(title, list);
      return column;
    }

    function render() {
      const group = stored[kind];
      if (group && Date.now() - group.latest < cacheAge) {
        const rows = [...group.records].sort((a, b) => b.pct - a.pct || a.code.localeCompare(b.code));
        const quotes = day.format(group.latest) === day.format(Date.now()) ? "报价" : "历史报价";
        status.textContent = `${quotes} ${stamp.format(group.latest)} · ${kinds[kind]} ${rows.length}/${group.total}${group.cached ? " · 缓存" : ""}`;
        const scale = Math.max(...rows.map((row) => Math.abs(row.pct)), .01);
        const focus = grid.contains(document.activeElement) ? document.activeElement.dataset.chartBoard : "";
        grid.replaceChildren(
          makeColumn("涨幅领先", rows.filter((row) => row.pct > 0).slice(0, 5), scale, "暂无上涨板块"),
          makeColumn("跌幅领先", rows.filter((row) => row.pct < 0).slice(-5).reverse(), scale, "暂无下跌板块")
        );
        if (focus) grid.querySelector(`[data-chart-board="${focus}"]`)?.focus({ preventScroll: true });
      } else {
        status.textContent = phase === "error" ? "板块报价暂不可用" : "正在读取板块报价";
        const empty = document.createElement("div");
        empty.className = "board-overview-empty";
        empty.textContent = phase === "error" ? "可以搜索板块或从目录查看成分股。" : "收到报价后显示板块涨跌排行。";
        grid.replaceChildren(empty);
      }
    }

    function accept(snapshot) {
      if (snapshot === lastSnapshot || !Array.isArray(snapshot?.catalogue?.boards) || !Array.isArray(snapshot.rows)) return;
      lastSnapshot = snapshot;
      phase = "error";
      const { catalogue, rows } = snapshot;
      const groups = fromSnapshot(catalogue, rows);
      for (const type of Object.keys(kinds)) {
        const group = groups[type];
        const previous = stored[type];
        if (group.records.length && group.latest >= (previous?.latest || 0)) stored[type] = group;
        else if (previous) previous.cached = true;
      }
      try { localStorage.setItem(cacheKey, JSON.stringify(stored)); } catch {}
      render();
    }

    host.addEventListener("click", (event) => {
      const tab = event.target.closest("[data-board-kind]");
      if (tab && tab.dataset.boardKind !== kind) {
        kind = tab.dataset.boardKind;
        host.querySelectorAll("[data-board-kind]").forEach((button) => button.setAttribute("aria-pressed", String(button === tab)));
        render();
      }
      const row = event.target.closest("[data-chart-board]");
      const board = row && stored[kind]?.records.find((record) => record.code === row.dataset.chartBoard);
      if (board) onSelect(board);
    });
    render();

    return {
      accept,
      quote(board) {
        const group = stored[board.kind];
        return group && Date.now() - group.latest < cacheAge ? group.records.find((row) => row.code === board.code) : null;
      },
      refresh(force = false) {
        window.QuantBoards.snapshot({ force }).then(accept).catch(() => { phase = "error"; render(); });
      }
    };
  }

  function showBreadth(host, members) {
    const latest = Math.max(0, ...members.filter((row) => row.quoted).map((row) => row.at || 0));
    const rows = latest ? members.filter((row) => row.quoted && row.at > 0 && Number.isFinite(row.pct) &&
      day.format(row.at) === day.format(latest)) : [];
    host.hidden = !rows.length;
    if (!rows.length) { host.replaceChildren(); return; }
    const counts = { up: 0, flat: 0, down: 0 };
    for (const row of rows) counts[direction(row.pct)]++;
    const labels = { up: "上涨", flat: "平盘", down: "下跌" };
    host.innerHTML = `<div class="board-breadth-labels"><b>成分股涨跌</b>${Object.keys(counts).map((tone) =>
      `<span data-direction="${tone}">${labels[tone]} ${counts[tone]}</span>`).join("")}</div>
      <div class="board-breadth-track" aria-hidden="true">${Object.keys(counts).map((tone) =>
        `<span data-direction="${tone}" style="--board-share:${100 * counts[tone] / rows.length}%"></span>`).join("")}</div>
      <small>同日报价 ${rows.length}/${members.length} 只 · ${stamp.format(latest)}</small>`;
  }

  const chartObservers = new WeakMap();
  const tradingMinute = (minute) => minute <= 690 ? minute - 570 : minute - 660;
  const clockLabel = (minute) => `${Math.floor(minute / 60)}:${String(minute % 60).padStart(2, "0")}`;

  function showTrend(host, trend) {
    chartObservers.get(host)?.disconnect();
    chartObservers.delete(host);
    host.hidden = !trend || !(trend.previousClose > 0) || trend.points.length < 2;
    host.replaceChildren();
    if (host.hidden) return;
    const { date, previousClose, points } = trend;
    const values = points.map(({ price }) => (price / previousClose - 1) * 100);
    const last = values.at(-1), ceiling = Math.max(.1, ...values.map(Math.abs));
    host.innerHTML = `<figcaption><b>板块分时</b><strong data-direction="${direction(last)}">${percent(last)}</strong></figcaption>
      <canvas></canvas><div class="board-trend-axis" aria-hidden="true"><span>09:30</span><span>11:30 / 13:00</span><span>15:00</span></div>
      <small>${date} ${clockLabel(points.at(-1).minute)} · 相对昨收</small>`;
    const canvas = host.querySelector("canvas");
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", `${date} 板块相对昨收，最低 ${percent(Math.min(...values))}，最高 ${percent(Math.max(...values))}，最新 ${percent(last)}`);
    const draw = () => {
      const width = canvas.clientWidth, height = canvas.clientHeight;
      if (!width || !height) return;
      const scale = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const colors = getComputedStyle(host);
      ctx.scale(scale, scale);
      const pad = 5, middle = height / 2;
      const x = (minute) => pad + tradingMinute(minute) * (width - pad * 2) / 240;
      const y = (value) => middle - value / ceiling * (middle - pad);
      ctx.strokeStyle = colors.getPropertyValue("--line");
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(pad, middle);
      ctx.lineTo(width - pad, middle);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = colors.getPropertyValue("--accent-strong");
      ctx.lineWidth = 1.6;
      ctx.lineJoin = "round";
      ctx.beginPath();
      points.forEach(({ minute }, i) => {
        if (i) ctx.lineTo(x(minute), y(values[i]));
        else ctx.moveTo(x(minute), y(values[i]));
      });
      ctx.stroke();
    };
    draw();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(draw);
      observer.observe(canvas);
      chartObservers.set(host, observer);
    }
  }

  window.QuantBoardOverview = { mount, showBreadth, showTrend };
})();

