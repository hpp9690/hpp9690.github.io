(() => {
  const shell = document.getElementById("anomaly");
  const zone = "Asia/Shanghai";
  const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
  const timeFormat = new Intl.DateTimeFormat("zh-CN", { timeZone: zone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const weekdayFormat = new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short" });
  const money = new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 });
  const safe = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const quoteFields = "f3,f5,f6,f12,f14,f124";
  const storageKey = "quantLens.sectorVolume.v1";
  const stockFeed = shell.querySelector("#anomalyFeed");
  const stockStatus = shell.querySelector("#anomalyState");
  const stockScope = shell.querySelector("#anomalyScope");
  const stockCount = shell.querySelector("#anomalyCount");
  stockFeed.insertAdjacentHTML("beforebegin", `
    <div class="tabs anomaly-view-tabs" role="group" aria-label="异动类型">
      <button type="button" data-anomaly-view="stocks" aria-pressed="true" class="active">个股异动</button>
      <button type="button" data-anomaly-view="boards" aria-pressed="false">板块异动 <span id="sectorAlertCount">0</span></button>
    </div>`);
  stockFeed.insertAdjacentHTML("afterend", `
    <div id="sectorAnomaly" hidden>
      <div class="sector-anomaly-toolbar">
        <p id="sectorAnomalyStatus" role="status">等待板块报价</p>
        <div>
          <label>板块 <select id="sectorAnomalyKind"><option value="">全部</option><option value="industry">行业</option><option value="concept">概念</option></select></label>
          <label>方向 <select id="sectorAnomalyDirection"><option value="">全部</option><option value="up">放量</option><option value="down">缩量</option></select></label>
        </div>
      </div>
      <div id="sectorAnomalyFeed" class="sector-anomaly-feed"></div>
      <p class="anomaly-foot">按相邻约 1 分钟的新增成交量速度比较。达到前窗 1.8 倍为放量，低于或等于 0.5 倍为缩量，前窗成交额需达到每分钟 500 万元。连续竞价期间约每 25 秒尝试刷新，午休后重新建立基线。</p>
    </div>`);
  const $ = (selector) => shell.querySelector(selector);
  const panel = $("#sectorAnomaly");
  const history = new Map(), directions = new Map(), cooldown = new Map(), warmed = new Set();
  let day = "", sessionStart = 0, alerts = [], busy = false, health = "idle", coverage = 0, total = 0, latest = 0, comparable = 0;

  function session(now) {
    const date = dayFormat.format(now);
    const morning = Date.parse(`${date}T09:30:00+08:00`);
    const afternoon = Date.parse(`${date}T13:00:00+08:00`);
    const weekday = weekdayFormat.format(now);
    if (weekday === "Sat" || weekday === "Sun") return { date, start: 0, end: 0 };
    if (now >= morning && now < morning + 120 * 60000) return { date, start: morning, end: morning + 120 * 60000 };
    if (now >= afternoon && now < afternoon + 117 * 60000) return { date, start: afternoon, end: afternoon + 117 * 60000 };
    return { date, start: 0, end: 0 };
  }

  function restore(date) {
    alerts = [];
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) || "{}");
      if (stored.date === date && Array.isArray(stored.alerts)) alerts = stored.alerts.filter((row) => row && /^BK\d+$/.test(row.code) &&
        ["up", "down"].includes(row.direction) && Number.isFinite(row.ratio) &&
        Number.isFinite(row.quoteAt) && Number.isFinite(row.seenAt)).slice(0, 60);
    } catch {}
    cooldown.clear();
    for (const alert of alerts) {
      const key = `${alert.code}:${alert.direction}`;
      cooldown.set(key, Math.max(cooldown.get(key) || 0, alert.seenAt));
    }
  }

  function synchronize(current) {
    if (day !== current.date) {
      day = current.date;
      restore(day);
    }
    if (sessionStart === current.start) return;
    sessionStart = current.start;
    history.clear();
    directions.clear();
    warmed.clear();
    latest = coverage = comparable = 0;
    health = "idle";
  }

  function nearestWindow(points, endAt) {
    let nearest, distance = Infinity;
    for (const point of points) {
      const elapsed = endAt - point.at;
      if (elapsed < 45000 || elapsed > 75000) continue;
      if (Math.abs(elapsed - 60000) < distance) {
        nearest = point;
        distance = Math.abs(elapsed - 60000);
      }
    }
    return nearest;
  }

  function observe(board, quote, now, current) {
    const at = Number(quote.f124) * 1000;
    const volume = Number(quote.f5), amount = Number(quote.f6);
    if (!Number.isFinite(at) || at < current.start || at >= current.end || at > now + 5000 || now - at > 75000 ||
        !Number.isFinite(volume) || volume <= 0 || !Number.isFinite(amount) || amount <= 0) return null;
    coverage++;
    latest = Math.max(latest, at);
    let points = history.get(board.code) || [];
    const last = points.at(-1);
    if (last && at <= last.at) {
      if (at === last.at && warmed.has(board.code)) comparable++;
      return null;
    }
    if (last && (volume < last.volume || amount < last.amount || at - last.at > 90000)) {
      points = [];
      directions.delete(board.code);
    }
    points = points.filter((point) => at - point.at <= 165000);
    const middle = nearestWindow(points, at);
    const before = middle && nearestWindow(points, middle.at);
    points.push({ at, volume, amount });
    history.set(board.code, points);
    if (!before) { warmed.delete(board.code); return null; }
    warmed.add(board.code);
    comparable++;
    const earlierSeconds = (middle.at - before.at) / 1000, recentSeconds = (at - middle.at) / 1000;
    const earlierRate = (middle.volume - before.volume) * 60 / earlierSeconds;
    const recentRate = (volume - middle.volume) * 60 / recentSeconds;
    const earlierAmount = (middle.amount - before.amount) * 60 / earlierSeconds;
    const recentAmount = (amount - middle.amount) * 60 / recentSeconds;
    // An unchanged counter can be a frozen feed. Wait for a verifiable new trade.
    if (earlierRate <= 0 || recentRate <= 0 || earlierAmount < 5000000 || recentAmount <= 0) return null;
    const ratio = recentRate / earlierRate;
    const direction = ratio >= 1.8 && recentAmount >= 5000000 ? "up" : ratio <= .5 ? "down" : "";
    if (!direction) { directions.delete(board.code); return null; }
    if (directions.get(board.code) === direction) return null;
    directions.set(board.code, direction);
    const key = `${board.code}:${direction}`;
    if ((cooldown.get(key) || 0) > now - 300000) return null;
    cooldown.set(key, now);
    return { ...board, name: quote.f14 || board.name, direction, ratio, quoteAt: at, seenAt: now,
      pct: Number.isFinite(Number(quote.f3)) ? Number(quote.f3) : null,
      earlierSeconds, recentSeconds, earlierRate, recentRate, recentAmount };
  }

  function render() {
    $("#sectorAlertCount").textContent = alerts.length;
    if (panel.hidden) return;
    const now = Date.now(), current = session(now);
    const scope = $("#sectorAnomalyKind").value, direction = $("#sectorAnomalyDirection").value;
    const filtered = alerts.filter((row) => (!scope || row.kind === scope) && (!direction || row.direction === direction));
    let status = "等待有效板块报价";
    if (!current.start) status = "非连续竞价时段 · 保留今日提醒";
    else if (health === "error") status = "板块报价暂不可用 · 等待下一轮";
    else if (coverage && latest && now - latest <= 75000) {
      status = `报价 ${timeFormat.format(latest)} · ${coverage}/${total} 个板块${comparable ? "" : " · 正在积累约 2 分钟基线"}`;
    } else if (latest) status = `报价已过 ${Math.round((now - latest) / 1000)} 秒 · 等待更新`;
    $("#sectorAnomalyStatus").textContent = status;
    $("#sectorAnomalyFeed").innerHTML = filtered.map((row) => {
      const label = row.direction === "up" ? "板块放量" : "板块缩量";
      const move = Number.isFinite(row.pct) ? `${row.pct > 0 ? "+" : ""}${row.pct.toFixed(2)}%` : "—";
      return `<button type="button" class="sector-alert-card" data-sector-alert="${safe(row.code)}" data-direction="${row.direction}" data-seen-at="${row.seenAt}">
        <span class="sector-alert-top"><b>${safe(row.name)}</b><small>${row.kind === "industry" ? "行业" : "概念"}</small><strong class="sector-alert-tag">${label}</strong></span>
        <span class="sector-alert-metrics"><b>${row.ratio.toFixed(2)}×</b> 前一窗速度 · 板块涨跌 ${move}</span>
        <span class="sector-alert-detail">${money.format(row.earlierRate)} → ${money.format(row.recentRate)} 手/分钟 · 近窗成交 ${money.format(row.recentAmount)} 元/分钟</span>
        <span class="sector-alert-detail">报价 ${timeFormat.format(row.quoteAt)} · 发现 ${timeFormat.format(row.seenAt)} · ${row.recentSeconds}/${row.earlierSeconds} 秒窗</span>
        <span class="sector-alert-link">查看成分股 ›</span>
      </button>`;
    }).join("") || '<div class="anomaly-empty">当前筛选暂无板块异动</div>';
  }

  async function poll() {
    const current = session(Date.now());
    synchronize(current);
    if (busy || !current.start) { render(); return; }
    busy = true;
    try {
      const directory = await window.QuantBoards.directory();
      const quotes = await window.QuantBoards.quotes(directory.boards.map((board) => `90.${board.code}`), quoteFields);
      const now = Date.now(), active = session(now);
      synchronize(active);
      if (active.start !== current.start || active.date !== current.date) return;
      total = directory.boards.length;
      coverage = comparable = 0;
      health = quotes.length ? "ready" : "error";
      const byCode = new Map(quotes.map((row) => [row.f12, row]));
      const found = [];
      for (const board of directory.boards) {
        const quote = byCode.get(board.code);
        if (!quote) continue;
        const alert = observe(board, quote, now, current);
        if (alert) found.push(alert);
      }
      if (found.length) {
        found.sort((a, b) => Math.abs(Math.log(b.ratio)) - Math.abs(Math.log(a.ratio)));
        alerts = [...found, ...alerts].slice(0, 60);
        try { localStorage.setItem(storageKey, JSON.stringify({ date: day, alerts })); } catch {}
        document.dispatchEvent(new CustomEvent("quant:sector-volume-alert", { detail: { alert: found[0], count: found.length } }));
      }
    } catch { health = "error"; }
    finally { busy = false; render(); }
  }

  function setView(view) {
    const board = view === "boards";
    panel.hidden = !board;
    stockFeed.hidden = stockStatus.hidden = stockScope.hidden = stockCount.hidden = board;
    shell.querySelectorAll("[data-anomaly-view]").forEach((button) => {
      const active = button.dataset.anomalyView === view;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    render();
  }
  $(".anomaly-view-tabs").addEventListener("click", (event) => {
    const button = event.target.closest("[data-anomaly-view]");
    if (button) setView(button.dataset.anomalyView);
  });
  panel.addEventListener("change", render);
  $("#sectorAnomalyFeed").addEventListener("click", (event) => {
    const button = event.target.closest("[data-sector-alert]");
    if (!button) return;
    const row = alerts.find((item) => item.code === button.dataset.sectorAlert &&
      item.direction === button.dataset.direction && item.seenAt === Number(button.dataset.seenAt));
    if (row) document.dispatchEvent(new CustomEvent("quant:open-board", { detail: row }));
  });
  document.addEventListener("quant:refresh-market", poll);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") poll(); });
  setInterval(poll, 25000);
  poll();
})();


