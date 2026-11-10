(() => {
  const zone = "Asia/Shanghai";
  const $ = (selector) => document.querySelector(selector);
  const safe = (value) => String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const clock = () => {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(new Date());
    const get = (type) => parts.find((part) => part.type === type)?.value || "";
    return { date: `${get("year")}-${get("month")}-${get("day")}`, minutes: Number(get("hour")) * 60 + Number(get("minute")), weekday: get("weekday"), time: `${get("hour")}:${get("minute")}` };
  };
  const isMarketTime = (t) => !["Sat", "Sun"].includes(t.weekday) &&
    ((t.minutes >= 555 && t.minutes < 565) || (t.minutes >= 570 && t.minutes <= 690) || (t.minutes >= 780 && t.minutes <= 900));
  const shell = document.createElement("section");
  shell.className = "anomaly-panel";
  shell.setAttribute("aria-label", "异动捕捉");
  shell.innerHTML = `<div class="anomaly-heading"><div><p class="eyebrow">LIVE MOVEMENT RADAR</p><h2>异动捕捉 <span id="anomalyCount">0</span></h2><p id="anomalyState">正在建立连续行情基线</p></div><div class="anomaly-actions"><button type="button" id="anomalyScope" aria-pressed="false">全部股票</button><button type="button" id="anomalySound" aria-pressed="false">声音关闭</button><button type="button" id="anomalyDesktop">桌面提醒</button></div></div><div id="anomalyFeed" class="anomaly-feed" role="log" aria-live="polite" aria-relevant="additions"><div class="anomaly-empty">两次有效快照后，新的拉升、放量、封板和炸板会出现在这里。</div></div><p class="anomaly-foot">页面保持打开时监测；公开行情可能延迟或缺页。异动表示观察事件，不代表买卖点。</p>`;
  ($(".decision-desk") || $(".quick-nav"))?.after(shell);
  const title = document.title;
  let priorMarket = null, priorBoard = null, alerts = [], onlyWatch = false, soundOn = false;
  let lastMarketAt = 0, lastBoardAt = 0, unread = 0, coverage = "";
  const cooldown = new Map();
  const dayKey = (date) => `quantLens.anomaly.${date}`;
  const today = clock().date;
  try { alerts = JSON.parse(localStorage.getItem(dayKey(today)) || "[]").filter((x) => x && x.code && x.type).slice(0, 30); } catch {}
  for (const alert of alerts) {
    const at = Number(alert.at) || new Date(`${today}T${alert.time || "00:00"}:00+08:00`).getTime();
    if (Number.isFinite(at)) cooldown.set(`${today}:${alert.code}:${alert.type}`, Math.max(at, cooldown.get(`${today}:${alert.code}:${alert.type}`) || 0));
  }
  const watched = () => {
    try { return new Set(JSON.parse(localStorage.getItem("quantLens.watchlist.v1") || "[]").map((x) => x.code)); }
    catch { return new Set(); }
  };
  const persist = () => { try { localStorage.setItem(dayKey(clock().date), JSON.stringify(alerts.slice(0, 30))); } catch {} };
  const beep = () => {
    if (!soundOn) return;
    try {
      const context = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = context.createOscillator(), gain = context.createGain();
      oscillator.type = "sine"; oscillator.frequency.value = 720;
      gain.gain.setValueAtTime(.001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(.075, context.currentTime + .02);
      gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .16);
      oscillator.connect(gain); gain.connect(context.destination);
      oscillator.start(); oscillator.stop(context.currentTime + .17);
      oscillator.onended = () => context.close();
    } catch {}
  };
  const notifyDesktop = (alert) => {
    if (document.visibilityState === "visible" || !window.Notification || Notification.permission !== "granted") return;
    try { new Notification(`${alert.name} · ${alert.label}`, { body: alert.detail, tag: `${alert.code}-${alert.type}` }); } catch {}
  };
  const render = () => {
    const filtered = onlyWatch ? alerts.filter((x) => watched().has(x.code)) : alerts;
    $("#anomalyCount").textContent = filtered.length;
    $("#anomalyFeed").innerHTML = filtered.length ? filtered.map((x) => `<button type="button" class="anomaly-item ${x.level}" data-code="${safe(x.code)}"><span class="anomaly-time">${safe(x.time)}</span><span class="anomaly-name"><b>${safe(x.name)}</b><small>${safe(x.code)}</small></span><span class="anomaly-type">${safe(x.label)}</span><span class="anomaly-detail">${safe(x.detail)}</span></button>`).join("") : `<div class="anomaly-empty">${onlyWatch ? "关注清单暂无新异动" : "等待新的异动信号"}</div>`;
  };
  const status = () => {
    const t = clock(), active = isMarketTime(t), last = Math.max(lastMarketAt, lastBoardAt);
    const age = last ? Math.round((Date.now() - last) / 1000) : 0;
    const label = !active ? "非连续监测时段 · 保留当日记录" : !last ? "正在建立连续行情基线" : age > 120 ? `行情已 ${age} 秒未更新 · 请检查网络` : `监测中 · 最近快照 ${age} 秒前 · ${coverage ? coverage + " · " : ""}股票约30秒／涨停约60秒`;
    $("#anomalyState").textContent = label;
    shell.classList.toggle("stale", active && !!last && age > 120);
  };
  const add = (type, row, label, detail, level = "signal") => {
    const t = clock(), key = `${t.date}:${row.code}:${type}`;
    if ((cooldown.get(key) || 0) > Date.now() - 600000) return;
    cooldown.set(key, Date.now());
    const alert = { type, code: row.code, name: row.name || row.code, label, detail, level, time: t.time, at: Date.now() };
    alerts.unshift(alert); alerts = alerts.slice(0, 30);
    persist(); render(); beep(); notifyDesktop(alert);
    if (document.visibilityState !== "visible") { unread++; document.title = `(${unread}) ${title}`; }
  };
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { unread = 0; document.title = title; } });
  document.addEventListener("quant:market-snapshot", (event) => {
    const next = event.detail, t = clock();
    if (!next || next.date !== t.date || next.mode === "review" || !Array.isArray(next.stocks) || next.stocks.length < 30) return;
    lastMarketAt = Date.now();
    coverage = Number(next.total) ? `主板 ${next.stocks.length} 只 · 行情 ${next.scanned}/${next.total}` : "";
    status();
    const map = new Map(next.stocks.filter((x) => /^\d{6}$/.test(x.code) && Number.isFinite(x.pct) && Number.isFinite(x.amount)).map((x) => [x.code, x]));
    if (priorMarket && priorMarket.date === next.date && isMarketTime(t)) {
      const seconds = (next.capturedAt - priorMarket.at) / 1000;
      if (seconds >= 10 && seconds <= 100) for (const row of map.values()) {
        const before = priorMarket.rows.get(row.code);
        if (!before) continue;
        const move = row.pct - before.pct, traded = row.amount - before.amount;
        if (t.minutes >= 555 && t.minutes < 565) {
          if (t.minutes >= 560 && before.pct < 3 && row.pct >= 3 && row.amount >= 1000000)
            add("auction", row, "竞价转强", `涨幅 ${row.pct.toFixed(2)}% · 竞价额 ${(row.amount / 1e6).toFixed(1)} 百万`);
        } else if (t.minutes >= 570) {
          if (move >= 1.2 && traded >= 8000000 && row.pct >= 2)
            add("surge", row, "短时拉升", `${Math.round(seconds)} 秒涨幅变化 +${move.toFixed(2)} 个百分点 · 新增成交 ${(traded / 1e6).toFixed(1)} 百万`);
          else if (traded >= 20000000 && row.pct >= 1 && move >= .3)
            add("volume", row, "放量走强", `${Math.round(seconds)} 秒新增成交 ${(traded / 1e6).toFixed(1)} 百万 · 涨幅 ${row.pct.toFixed(2)}%`);
        }
      }
    }
    priorMarket = { date: next.date, at: next.capturedAt, rows: map };
  });
  document.addEventListener("quant:board-snapshot", (event) => {
    const next = event.detail, t = clock();
    if (!next || next.date !== t.date.replaceAll("-", "") || !Array.isArray(next.sealed) || !Array.isArray(next.broken)) return;
    lastBoardAt = Date.now(); status();
    const sealed = new Map(next.sealed.map((x) => [x.code, x]));
    const broken = new Map(next.broken.map((x) => [x.code, x]));
    if (priorBoard && priorBoard.date === next.date && isMarketTime(t) && t.minutes >= 570 &&
        next.capturedAt - priorBoard.at <= 150000) {
      for (const row of sealed.values()) if (!priorBoard.sealed.has(row.code))
        add("sealed", row, priorBoard.broken.has(row.code) ? "回封涨停" : "新封涨停", `${row.boards} 连板 · 炸板 ${row.breaks} 次`);
      for (const row of broken.values()) if (!priorBoard.broken.has(row.code))
        add("broken", row, "炸板风险", `炸板 ${row.breaks} 次 · 关注封单变化`, "risk");
    }
    priorBoard = { date: next.date, at: next.capturedAt, sealed, broken };
  });
  $("#anomalyScope")?.addEventListener("click", (event) => {
    onlyWatch = !onlyWatch;
    event.currentTarget.textContent = onlyWatch ? "只看关注" : "全部股票";
    event.currentTarget.setAttribute("aria-pressed", String(onlyWatch)); render();
  });
  $("#anomalySound")?.addEventListener("click", (event) => {
    soundOn = !soundOn;
    event.currentTarget.textContent = soundOn ? "声音开启" : "声音关闭";
    event.currentTarget.setAttribute("aria-pressed", String(soundOn));
  });
  $("#anomalyDesktop")?.addEventListener("click", async (event) => {
    if (!window.Notification) { event.currentTarget.textContent = "浏览器不支持"; return; }
    const permission = await Notification.requestPermission();
    event.currentTarget.textContent = permission === "granted" ? "桌面提醒已开启" : "桌面提醒未开启";
  });
  $("#anomalyFeed")?.addEventListener("click", (event) => {
    const code = event.target.closest("[data-code]")?.dataset.code;
    if (!code) return;
    const input = $("#stockSearch"), form = $("#lookupForm");
    if (input && form) { input.value = code; form.requestSubmit(); $("#lookup")?.scrollIntoView({ behavior: "smooth" }); }
  });
  render(); status(); setInterval(status, 10000);
})();

