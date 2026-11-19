(() => {
  const shell = document.getElementById("anomaly");
  const zone = "Asia/Shanghai";
  const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
  const timeFormat = new Intl.DateTimeFormat("zh-CN", { timeZone: zone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const weekdayFormat = new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short" });
  const money = new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 });
  const safe = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const quoteFields = "f3,f5,f6,f12,f14,f104,f105,f106,f124";
  const storageKey = "quantLens.sectorVolume.v1";
  const stockFeed = shell.querySelector("#anomalyFeed");
  const stockStatus = shell.querySelector("#anomalyState");
  const stockScope = shell.querySelector("#anomalyScope");
  const stockCount = shell.querySelector("#anomalyCount");
  const stockFoot = shell.querySelector(":scope > .anomaly-foot");
  const stockRules = document.createElement("details");
  stockRules.className = "market-panel-disclosure";
  stockRules.innerHTML = "<summary>提醒说明</summary>";
  stockFoot.before(stockRules);
  stockRules.append(stockFoot);
  stockFeed.insertAdjacentHTML("beforebegin", `
    <div class="tabs anomaly-view-tabs" role="group" aria-label="异动类型">
      <button type="button" data-anomaly-view="stocks" aria-pressed="true" class="active">个股异动</button>
      <button type="button" data-anomaly-view="boards" aria-pressed="false">板块异动 <span id="sectorAlertCount" hidden></span></button>
    </div>`);
  stockFeed.insertAdjacentHTML("afterend", `
    <div id="sectorAnomaly" hidden>
      <div class="sector-anomaly-toolbar">
        <p id="sectorAnomalyStatus" role="status">等待板块报价</p>
        <div>
          <select id="sectorAnomalyKind" aria-label="板块类型"><option value="">全部板块</option><option value="industry">行业</option><option value="concept">概念</option></select>
          <select id="sectorAnomalyDirection" aria-label="放量或缩量"><option value="">全部方向</option><option value="up">放量</option><option value="down">缩量</option></select>
        </div>
      </div>
      <div id="sectorAnomalyFeed" class="sector-anomaly-feed"></div>
      <details class="market-panel-disclosure">
        <summary>放量和缩量怎么算</summary>
        <p>比较相邻两个约 1 分钟时间段的新增成交量速度。达到前一段的 1.8 倍记为放量，降到 0.5 倍或以下记为缩量。</p>
        <p>前一段每分钟成交额至少 500 万元，放量时后一段也须达到此门槛。连续竞价期间约每 25 秒刷新，午休后重新积累基线。</p>
      </details>
    </div>`);
  const $ = (selector) => shell.querySelector(selector);
  const panel = $("#sectorAnomaly");
  const feed = $("#sectorAnomalyFeed");
  const history = new Map(), directions = new Map(), cooldown = new Map(), warmed = new Set();
  let day = "", sessionStart = 0, alerts = [], busy = false, health = "idle", coverage = 0, total = 0, latest = 0, comparable = 0;
  let renderedFeed = "";

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

  function industryBreadth(board, quote, now, current) {
    if (board.kind !== "industry") return null;
    const at = Number(quote.f124) * 1000;
    if (!Number.isFinite(at) || at < current.start || at >= current.end || at > now + 5000 || now - at > 75000) return null;
    const counts = [quote.f104, quote.f105, quote.f106];
    if (!counts.every((count) => /^\d+$/.test(String(count)))) return null;
    const [up, down, flat] = counts.map(Number);
    if (up + down + flat === 0) return null;
    return { name: quote.f14 || board.name, at, up, down, flat };
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
    const count = $("#sectorAlertCount");
    count.textContent = alerts.length;
    count.hidden = !alerts.length;
    if (panel.hidden) return;
    const now = Date.now(), current = session(now);
    const scope = $("#sectorAnomalyKind").value, direction = $("#sectorAnomalyDirection").value;
    const filtered = alerts.filter((row) => (!scope || row.kind === scope) && (!direction || row.direction === direction));
    let status = "等待板块报价";
    if (!current.start) status = "盘中更新 · 保留今日提醒";
    else if (health === "error") status = "板块报价暂不可用";
    else if (coverage && latest && now - latest <= 75000) {
      status = `报价 ${timeFormat.format(latest)} · ${coverage}/${total} 个板块${comparable ? "" : " · 正在积累约 2 分钟基线"}`;
    } else if (latest) status = `报价已过 ${Math.round((now - latest) / 1000)} 秒 · 等待更新`;
    $("#sectorAnomalyStatus").textContent = status;
    const markup = filtered.map((row) => {
      const label = row.direction === "up" ? "放量" : "缩量";
      const move = Number.isFinite(row.pct) ? `${row.pct > 0 ? "+" : ""}${row.pct.toFixed(2)}%` : "—";
      const speed = `${money.format(row.earlierRate)} → ${money.format(row.recentRate)} 手/分钟`;
      return `<button type="button" class="sector-alert-card" data-sector-alert="${safe(row.code)}" data-direction="${row.direction}" data-seen-at="${row.seenAt}">
        <span class="sector-alert-top"><b>${safe(row.name)}</b><small>${row.kind === "industry" ? "行业" : "概念"}</small><strong class="sector-alert-tag">${label} ${row.ratio.toFixed(2)}×</strong></span>
        <span class="sector-alert-metrics" title="${safe(speed)}">涨跌 ${move} · 近窗成交 ${money.format(row.recentAmount)} 元/分钟</span>
        <span class="sector-alert-meta">
          <span class="sector-alert-detail">报价 ${timeFormat.format(row.quoteAt)} · 发现 ${timeFormat.format(row.seenAt)}</span>
          <span class="sector-alert-link">成分股 ›</span>
        </span>
      </button>`;
    }).join("") || '<div class="anomaly-empty">暂无板块异动</div>';
    if (markup === renderedFeed) return;
    const focused = feed.contains(document.activeElement) ? document.activeElement.dataset : null;
    feed.innerHTML = renderedFeed = markup;
    if (focused) {
      const match = Array.from(feed.querySelectorAll("[data-sector-alert]")).find((button) =>
        button.dataset.sectorAlert === focused.sectorAlert && button.dataset.seenAt === focused.seenAt &&
          button.dataset.direction === focused.direction);
      match?.focus({ preventScroll: true });
    }
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
      const found = [], breadth = [];
      for (const board of directory.boards) {
        const quote = byCode.get(board.code);
        if (!quote) continue;
        const industry = industryBreadth(board, quote, now, current);
        if (industry) breadth.push(industry);
        const alert = observe(board, quote, now, current);
        if (alert) found.push(alert);
      }
      if (breadth.length) document.dispatchEvent(new CustomEvent("quant:sector-breadth", {
        detail: { date: current.date, boards: breadth }
      }));
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
    stockFeed.hidden = stockStatus.hidden = stockScope.hidden = stockCount.hidden = stockRules.hidden = board;
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
  feed.addEventListener("click", (event) => {
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


