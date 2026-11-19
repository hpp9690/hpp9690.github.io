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
  const shortNumber = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });

  function money(value) {
    if (value >= 1e8) return `${shortNumber.format(value / 1e8)}亿元`;
    if (value >= 1e4) return `${shortNumber.format(value / 1e4)}万元`;
    return `${shortNumber.format(value)}元`;
  }

  function number(value) {
    return (typeof value === "number" || (typeof value === "string" && value.trim())) &&
      Number.isFinite(Number(value)) ? Number(value) : null;
  }

  const validAmount = (value) => Number.isFinite(value) && value >= 0;

  function fromSnapshot(catalogue, rows) {
    const now = Date.now();
    const groups = { industry: new Map(), concept: new Map() };
    const byCode = new Map(catalogue.boards.map((board) => [board.code, board]));
    for (const row of rows) {
      const board = byCode.get(row.f12);
      const pct = number(row.f3), at = (number(row.f124) || 0) * 1000;
      const amount = number(row.f6);
      if (!board || (pct === null && !validAmount(amount)) || !at || at > now + 5000 || now - at > cacheAge) continue;
      const group = groups[board.kind];
      if (at < (group.get(board.code)?.at || 0)) continue;
      group.set(board.code, { ...board, pct, amount: validAmount(amount) ? amount : null, at });
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
              /^BK\d+$/.test(row.code) && typeof row.name === "string" && (Number.isFinite(row.pct) || validAmount(row.amount)) &&
              Number.isFinite(row.at) && row.at <= group.latest)) delete stored[kind];
        else group.cached = true;
      }
      return stored;
    } catch { return {}; }
  }

  function mount(host, { onSelect }) {
    const stored = cache();
    let kind = "industry", metric = "pct", limit = 5, phase = "waiting", lastSnapshot;
    host.className = "board-overview";
    host.innerHTML = `
      <div class="board-overview-head"><span id="boardOverviewStatus" role="status"></span></div>
      <div class="board-overview-toolbar">
        <div class="board-overview-switch" role="group" aria-label="板块分类">
          <button type="button" data-board-kind="industry" aria-pressed="true">行业</button>
          <button type="button" data-board-kind="concept" aria-pressed="false">概念</button>
        </div>
        <div class="board-chart-params" role="group" aria-label="排行图表参数">
          <label class="board-chart-param"><span>指标</span><select data-board-ranking-metric><option value="pct">涨跌幅</option><option value="amount">成交额</option></select></label>
          <label class="board-chart-param"><span>显示</span><select data-board-ranking-limit><option value="5">前 5</option><option value="10">前 10</option></select></label>
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
        const value = row[metric];
        const formatted = metric === "amount" ? money(value) : percent(value);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "board-overview-row";
        button.dataset.chartBoard = row.code;
        button.dataset.direction = metric === "amount" ? "amount" : direction(value);
        button.title = row.name;
        button.setAttribute("aria-label", `${row.name} ${formatted}，查看成分股`);
        button.innerHTML = '<span class="board-overview-name"></span><span class="board-overview-track" aria-hidden="true"><span class="board-overview-fill"></span></span><strong class="board-overview-value"></strong>';
        button.querySelector(".board-overview-name").textContent = row.name;
        button.querySelector(".board-overview-value").textContent = formatted;
        button.style.setProperty("--board-bar-width", `${100 * Math.abs(value) / scale}%`);
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
      grid.dataset.metric = metric;
      grid.setAttribute("aria-label", metric === "amount" ? "板块成交额排行" : "板块涨跌排行");
      if (group && Date.now() - group.latest < cacheAge) {
        const rows = group.records.filter((row) => Number.isFinite(row[metric])).sort((a, b) =>
          b[metric] - a[metric] || a.code.localeCompare(b.code));
        const quotes = day.format(group.latest) === day.format(Date.now()) ? "报价" : "历史报价";
        status.textContent = `${quotes} ${stamp.format(group.latest)} · ${kinds[kind]} ${rows.length}/${group.total}${group.cached ? " · 缓存" : ""}`;
        const scale = Math.max(...rows.map((row) => Math.abs(row[metric])), .01);
        const focus = grid.contains(document.activeElement) ? document.activeElement.dataset.chartBoard : "";
        if (metric === "amount") {
          grid.replaceChildren(makeColumn("成交额领先", rows.slice(0, limit), scale, "暂无板块成交额报价"));
        } else {
          grid.replaceChildren(
            makeColumn("涨幅领先", rows.filter((row) => row.pct > 0).slice(0, limit), scale, "暂无上涨板块"),
            makeColumn("跌幅领先", rows.filter((row) => row.pct < 0).slice(-limit).reverse(), scale, "暂无下跌板块")
          );
        }
        if (focus) grid.querySelector(`[data-chart-board="${focus}"]`)?.focus({ preventScroll: true });
      } else {
        status.textContent = phase === "error" ? "板块报价暂不可用" : "正在读取板块报价";
        const empty = document.createElement("div");
        empty.className = "board-overview-empty";
        empty.textContent = phase === "error" ? "可以搜索板块或从目录查看成分股。" : "正在读取板块排行榜。";
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
    host.querySelector("[data-board-ranking-metric]").addEventListener("change", (event) => {
      metric = event.currentTarget.value;
      render();
    });
    host.querySelector("[data-board-ranking-limit]").addEventListener("change", (event) => {
      limit = Number(event.currentTarget.value);
      render();
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
  const trendPreferences = new WeakMap();
  const tradingSessions = {
    all: { label: "全天", start: 570, end: 900, labels: ["09:30", "11:30 / 13:00", "15:00"] },
    morning: { label: "上午", start: 570, end: 690, labels: ["09:30", "11:30"] },
    afternoon: { label: "下午", start: 780, end: 900, labels: ["13:00", "15:00"] }
  };
  const tradingMinute = (minute) => minute <= 690 ? minute - 570 : minute - 660;
  const clockLabel = (minute) => `${Math.floor(minute / 60)}:${String(minute % 60).padStart(2, "0")}`;

  function showTrend(host, trend) {
    chartObservers.get(host)?.disconnect();
    chartObservers.delete(host);
    host.hidden = !trend?.points?.length;
    host.replaceChildren();
    if (host.hidden) return;
    const { date, previousClose } = trend;
    const hasPreviousClose = Number.isFinite(previousClose) && previousClose > 0;
    const preference = trendPreferences.get(host) || { session: "all", metric: "pct" };
    trendPreferences.set(host, preference);
    host.innerHTML = `<figcaption><b>板块分时</b><strong class="board-trend-value"></strong></figcaption>
      <div class="board-chart-params" role="group" aria-label="分时图表参数">
        <label class="board-chart-param"><span>时段</span><select data-trend-session><option value="all">全天</option><option value="morning">上午</option><option value="afternoon">下午</option></select></label>
        <label class="board-chart-param"><span>指标</span><select data-trend-metric><option value="pct">涨跌幅</option><option value="price">指数点位</option></select></label>
      </div>
      <canvas role="img"></canvas><div class="board-trend-axis" aria-hidden="true"></div>
      <p class="board-trend-empty" role="status" hidden></p><small class="board-trend-meta"></small>`;
    const canvas = host.querySelector("canvas");
    const sessionSelect = host.querySelector("[data-trend-session]");
    const metricSelect = host.querySelector("[data-trend-metric]");
    const value = host.querySelector(".board-trend-value");
    const axis = host.querySelector(".board-trend-axis");
    const meta = host.querySelector(".board-trend-meta");
    const empty = host.querySelector(".board-trend-empty");
    sessionSelect.value = preference.session;
    metricSelect.querySelector('[value="pct"]').disabled = !hasPreviousClose;
    metricSelect.value = hasPreviousClose ? preference.metric : "price";
    let series;

    const draw = () => {
      if (!series) return;
      const width = canvas.clientWidth, height = canvas.clientHeight;
      if (!width || !height) return;
      const scale = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const colors = getComputedStyle(host);
      ctx.scale(scale, scale);
      const { start, end, low, high, baseline, points, values } = series;
      const pad = 5, span = tradingMinute(end) - tradingMinute(start);
      const x = (minute) => pad + (tradingMinute(minute) - tradingMinute(start)) * (width - pad * 2) / span;
      const y = (point) => pad + (high - point) * (height - pad * 2) / (high - low);
      if (baseline !== null && baseline >= low && baseline <= high) {
        ctx.strokeStyle = colors.getPropertyValue("--line");
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(pad, y(baseline));
        ctx.lineTo(width - pad, y(baseline));
        ctx.stroke();
        ctx.setLineDash([]);
      }
      const accent = colors.getPropertyValue("--accent-strong");
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.6;
      ctx.lineJoin = "round";
      ctx.beginPath();
      points.forEach(({ minute }, i) => {
        if (i && !(points[i - 1].minute <= 690 && minute >= 780)) ctx.lineTo(x(minute), y(values[i]));
        else ctx.moveTo(x(minute), y(values[i]));
      });
      ctx.stroke();
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(x(points.at(-1).minute), y(values.at(-1)), 2, 0, 2 * Math.PI);
      ctx.fill();
    };

    function update() {
      const session = tradingSessions[sessionSelect.value];
      const { start, end, labels } = session;
      const points = trend.points.filter(({ minute }) => minute >= start && minute <= end);
      const noData = !points.length;
      canvas.hidden = axis.hidden = value.hidden = noData;
      empty.hidden = !noData;
      series = null;
      if (noData) {
        empty.textContent = `暂无${session.label}分时数据`;
        meta.textContent = date;
        return;
      }

      const usePercent = metricSelect.value === "pct";
      const metricLabel = usePercent ? "相对昨收" : "指数点位";
      const format = usePercent ? percent : (point) => `${shortNumber.format(point)} 点`;
      const values = points.map(({ price }) => usePercent ? (price / previousClose - 1) * 100 : price);
      const min = Math.min(...values), max = Math.max(...values), last = values.at(-1);
      const ceiling = Math.max(.1, Math.abs(min), Math.abs(max));
      const padding = Math.max(.01, (max - min) * .06);
      series = { start, end, points, values, low: usePercent ? -ceiling : min - padding,
        high: usePercent ? ceiling : max + padding, baseline: usePercent ? 0 : previousClose };

      value.textContent = format(last);
      value.dataset.direction = usePercent ? direction(last) : "flat";
      axis.innerHTML = labels.map((label) => `<span>${label}</span>`).join("");
      meta.textContent = `${date} ${clockLabel(points.at(-1).minute)} · ${metricLabel}`;
      canvas.setAttribute("aria-label", `${date} ${session.label} ${metricLabel}，最低 ${format(min)}，最高 ${format(max)}，最新 ${format(last)}`);
      draw();
    }

    sessionSelect.addEventListener("change", () => { preference.session = sessionSelect.value; update(); });
    metricSelect.addEventListener("change", () => { preference.metric = metricSelect.value; update(); });
    update();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(draw);
      observer.observe(canvas);
      chartObservers.set(host, observer);
    }
  }

  window.QuantBoardOverview = { mount, showBreadth, showTrend };
})();

