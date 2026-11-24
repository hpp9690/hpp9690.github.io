(() => {
  const shell = document.getElementById("anomaly");
  const zone = "Asia/Shanghai";
  const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
  const timeFormat = new Intl.DateTimeFormat("zh-CN", { timeZone: zone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const weekdayFormat = new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short" });
  const safe = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const storageKey = "quantLens.sectorVolume.v1";
  const classification = window.QuantBoardGroups;
  const groupOf = (row) => classification.forBoard(row);
  const moveLabel = (row) => row.direction === "up" ? "放量" : "缩量";
  const isHot = (row) => row.kind === "concept" && Number.isFinite(row.hotAmount) && row.hotAmount > 0 && groupOf(row).id !== "market";
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
          <select id="sectorAnomalyKind" aria-label="板块类型"><option value="">重点总览</option><option value="industry">仅行业</option><option value="concept">仅热门概念</option></select>
          <select id="sectorAnomalyDirection" aria-label="放量或缩量"><option value="">全部方向</option><option value="up">放量</option><option value="down">缩量</option></select>
        </div>
      </div>
      <div id="sectorAnomalyFeed" class="sector-anomaly-feed"></div>
      <details class="market-panel-disclosure">
        <summary>放量和缩量怎么算</summary>
        <p>行业卡汇总当天触发的细分行业。倍率来自卡上标明的细分板块，表示最近约一分钟的新增成交量速度相对前一窗的变化。</p>
        <p>放量至少 1.8 倍，缩量至 0.5 倍或以下。前窗每分钟成交额至少 500 万元，放量时最近一窗也须达到此门槛。盘中约每 25 秒刷新。</p>
        <p>概念按触发时的当日成交额筛选。在有足够报价的主题中取前 20%，最多纳入 20 个；首页每类主题最多显示 1 个，共最多显示 3 个。</p>
      </details>
    </div>`);
  const $ = (selector) => shell.querySelector(selector);
  const panel = $("#sectorAnomaly");
  const feed = $("#sectorAnomalyFeed");
  const history = new Map(), directions = new Map(), cooldown = new Map(), warmed = new Set(), notificationAt = new Map();
  let day = "", sessionStart = 0, alerts = [], busy = false, health = "idle", coverage = 0, total = 0, latest = 0, comparable = 0;
  let hotReady = false;
  let renderedFeed = "";

  function retainAlerts(rows) {
    const unique = new Map();
    for (const row of rows) {
      if (row.kind !== "industry" && !isHot(row)) continue;
      const key = `${row.code}:${row.direction}`;
      if (!unique.has(key)) unique.set(key, row);
    }
    const saved = [...unique.values()];
    return [...saved.filter((row) => row.kind === "industry").slice(0, 320),
      ...saved.filter(isHot).slice(0, 100)].sort(newestFirst);
  }

  function newestFirst(a, b) {
    return b.seenAt - a.seenAt || Math.abs(Math.log(b.ratio)) - Math.abs(Math.log(a.ratio));
  }

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
      if (stored.date === date && Array.isArray(stored.alerts)) alerts = retainAlerts(stored.alerts.filter((row) =>
        row && /^BK\d+$/.test(row.code) && typeof row.name === "string" && ["up", "down"].includes(row.direction) &&
        Number.isFinite(row.ratio) && row.ratio > 0 && Number.isFinite(row.quoteAt) && Number.isFinite(row.seenAt)));
    } catch {}
    cooldown.clear();
    notificationAt.clear();
    for (const alert of alerts) {
      const key = `${alert.code}:${alert.direction}`;
      cooldown.set(key, Math.max(cooldown.get(key) || 0, alert.seenAt));
      const group = notificationKey(alert);
      notificationAt.set(group, Math.max(notificationAt.get(group) || 0, alert.seenAt));
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
    hotReady = false;
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
      pct: quote.f3 != null && String(quote.f3).trim() && Number.isFinite(Number(quote.f3)) ? Number(quote.f3) : null,
      earlierSeconds, recentSeconds, earlierRate, recentRate, recentAmount };
  }

  function activeConcepts(boards, quotes, now, current) {
    const ranked = [];
    for (const board of boards) {
      if (board.kind !== "concept" || groupOf(board).id === "market") continue;
      const quote = quotes.get(board.code);
      const at = Number(quote?.f124) * 1000, amount = Number(quote?.f6);
      if (Number.isFinite(at) && at >= current.start && at < current.end && at <= now + 5000 &&
          now - at <= 75000 && Number.isFinite(amount) && amount > 0) ranked.push([board.code, amount]);
    }
    hotReady = ranked.length >= 12;
    if (!hotReady) return new Map();
    ranked.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return new Map(ranked.slice(0, Math.min(20, Math.ceil(ranked.length / 5))));
  }

  function latestPerBoard(rows) {
    const latestRows = new Map();
    for (const row of rows) if (!latestRows.has(row.code)) latestRows.set(row.code, row);
    return [...latestRows.values()];
  }

  function popularConcepts(rows) {
    const topics = new Set();
    return rows.filter(isHot).sort((a, b) => b.hotAmount - a.hotAmount || newestFirst(a, b)).filter((row) => {
      const key = groupOf(row).id;
      if (topics.has(key)) return false;
      topics.add(key);
      return true;
    }).slice(0, 3);
  }

  function notificationKey(row) {
    return `${row.kind}:${groupOf(row).id}:${row.direction}`;
  }

  function alertButton(row, group, balance = "") {
    const name = classification.name(row);
    const label = `${moveLabel(row)} ${row.ratio.toFixed(2)}×`;
    const title = group ? (group.id === "market" ? "其他行业" : group.label) : name;
    const showRepresentative = group && title !== name;
    const quote = timeFormat.format(row.quoteAt);
    return `<button type="button" class="sector-alert-card${group ? " sector-group-primary" : ""}" data-sector-alert="${safe(row.code)}"
      data-direction="${row.direction}" data-seen-at="${row.seenAt}" aria-label="${safe(`${title} ${showRepresentative ? name + " " : ""}${label}，查看${name}成分股`)}">
      <span class="sector-alert-top"><b>${safe(title)}</b>${balance ? `<small>${balance}</small>` : ""}
      ${showRepresentative ? "" : `<strong class="sector-alert-tag">${label}</strong>`}</span>
      ${showRepresentative ? `<span class="sector-alert-metrics"><b>${safe(name)}</b><strong class="sector-alert-tag">${label}</strong></span>` : ""}
      <span class="sector-alert-meta"><span class="sector-alert-detail">报价 ${quote}</span><span class="sector-alert-link">成分股 ›</span></span>
    </button>`;
  }

  function industryCard({ group, rows }, open) {
    const key = group.id;
    const up = rows.filter((row) => row.direction === "up").length;
    const balance = rows.length > 1
      ? [up ? `放量 ${up}` : "", rows.length > up ? `缩量 ${rows.length - up}` : ""].filter(Boolean).join(" · ")
      : "";
    return `<article class="sector-group-card" data-sector-group="${key}">${alertButton(rows[0], group, balance)}
      ${rows.length > 1 ? `<details class="sector-group-details" data-sector-detail="${key}"${open.has(key) ? " open" : ""}>
        <summary>查看其他细分（${rows.length - 1}）</summary><div class="sector-group-members">${rows.slice(1).map((row) => alertButton(row)).join("")}</div>
      </details>` : ""}</article>`;
  }

  function section(kind, label, contents, empty) {
    return `<section class="sector-summary" data-sector-section="${kind}"><h3>${label}</h3>
      <div class="sector-summary-grid">${contents || `<div class="anomaly-empty">${empty}</div>`}</div></section>`;
  }

  function render() {
    const last = latestPerBoard(alerts);
    const groups = new Set(last.filter((row) => row.kind === "industry").map((row) => groupOf(row).id));
    const count = $("#sectorAlertCount");
    const totalDisplayed = groups.size + popularConcepts(last).length;
    count.textContent = totalDisplayed;
    count.hidden = !totalDisplayed;
    if (panel.hidden) return;
    const now = Date.now(), current = session(now);
    const scope = $("#sectorAnomalyKind").value, direction = $("#sectorAnomalyDirection").value;
    const filtered = direction ? last.filter((row) => row.direction === direction) : last;
    let status = "等待板块报价";
    if (!current.start) status = "盘中更新 · 保留今日提醒";
    else if (health === "error") status = "板块报价暂不可用";
    else if (coverage && latest && now - latest <= 75000) {
      status = `报价 ${timeFormat.format(latest)} · ${coverage}/${total} 个板块${comparable ? "" : " · 正在积累约 2 分钟基线"}`;
    } else if (latest) status = `报价已过 ${Math.round((now - latest) / 1000)} 秒 · 等待更新`;
    $("#sectorAnomalyStatus").textContent = status;
    const open = new Set([...feed.querySelectorAll("[data-sector-detail][open]")].map((node) => node.dataset.sectorDetail));
    const byGroup = new Map();
    for (const row of filtered) {
      if (row.kind !== "industry") continue;
      const group = groupOf(row);
      if (!byGroup.has(group.id)) byGroup.set(group.id, { group, rows: [] });
      byGroup.get(group.id).rows.push(row);
    }
    const industry = [...byGroup.values()].map((entry) => industryCard(entry, open));
    const industryCards = industry.slice(0, 6).join("") + (industry.length > 6
      ? `<details class="sector-summary-more" data-sector-detail="more-industries"${open.has("more-industries") ? " open" : ""}>
        <summary>更多行业（${industry.length - 6}）</summary><div class="sector-summary-grid">${industry.slice(6).join("")}</div></details>`
      : "");
    const concepts = popularConcepts(filtered).map((row) => alertButton(row)).join("");
    const conceptEmpty = current.start && health === "ready" && !hotReady ? "概念报价覆盖不足" : "暂无热门概念异动";
    const markup = (scope !== "concept" ? section("industry", "行业异动", industryCards, "暂无行业异动") : "") +
      (scope !== "industry" ? section("concept", "热门概念", concepts, conceptEmpty) : "");
    if (markup === renderedFeed) return;
    const active = feed.contains(document.activeElement) ? document.activeElement : null;
    const focused = active?.dataset;
    const focusDetail = active?.matches("summary") ? active.parentElement.dataset.sectorDetail : null;
    feed.innerHTML = renderedFeed = markup;
    if (focused) {
      const match = Array.from(feed.querySelectorAll("[data-sector-alert]")).find((button) =>
        button.dataset.sectorAlert === focused.sectorAlert);
      match?.focus({ preventScroll: true });
    }
    if (focusDetail) feed.querySelector(`[data-sector-detail="${focusDetail}"] > summary`)?.focus({ preventScroll: true });
  }

  async function poll(force = false) {
    const current = session(Date.now());
    synchronize(current);
    if (busy || !current.start) { render(); return; }
    busy = true;
    try {
      const { catalogue: directory, rows: quotes } = await window.QuantBoards.snapshot({ force });
      const now = Date.now(), active = session(now);
      synchronize(active);
      if (active.start !== current.start || active.date !== current.date) return;
      total = directory.boards.length;
      coverage = comparable = 0;
      health = quotes.length ? "ready" : "error";
      const byCode = new Map(quotes.map((row) => [row.f12, row]));
      const hot = activeConcepts(directory.boards, byCode, now, current);
      const found = [], breadth = [];
      for (const board of directory.boards) {
        const quote = byCode.get(board.code);
        if (!quote) continue;
        const industry = industryBreadth(board, quote, now, current);
        if (industry) breadth.push(industry);
        const alert = observe(board, quote, now, current);
        if (!alert) continue;
        if (alert.kind === "industry") found.push(alert);
        else if (hot.has(alert.code)) found.push({ ...alert, hotAmount: hot.get(alert.code) });
      }
      if (breadth.length) document.dispatchEvent(new CustomEvent("quant:sector-breadth", {
        detail: { date: current.date, boards: breadth }
      }));
      if (found.length) {
        found.sort(newestFirst);
        alerts = retainAlerts([...found, ...alerts]);
        try { localStorage.setItem(storageKey, JSON.stringify({ date: day, alerts })); } catch {}
        const conceptCodes = new Set(popularConcepts(latestPerBoard(alerts)).map((row) => row.code));
        const visible = found.filter((row) => row.kind === "industry" || conceptCodes.has(row.code));
        const alert = visible.find((row) => now - (notificationAt.get(notificationKey(row)) || 0) >= 300000);
        if (alert) {
          notificationAt.set(notificationKey(alert), now);
          document.dispatchEvent(new CustomEvent("quant:sector-volume-alert", { detail: { alert } }));
        }
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
  document.addEventListener("quant:refresh-market", () => poll(true));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") poll(); });
  setInterval(poll, 25000);
  poll();
})();


