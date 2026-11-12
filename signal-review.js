(() => {
  const key = "quantLens.signalReview.v1";
  const minute = 60000;
  const horizons = [5, 15, 30];
  const grace = 3 * minute;
  const types = {
    "auction-early": "竞价转强", "auction-strong": "竞价强势",
    momentum: "动能增强", surge: "短时拉升", volume: "放量走强"
  };
  const timeZone = "Asia/Shanghai";
  const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const timeFormat = new Intl.DateTimeFormat("zh-CN", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const safe = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const dayAt = (stamp = Date.now()) => dayFormat.format(stamp);
  const timeAt = (stamp) => Number.isFinite(stamp) && stamp > 0 ? timeFormat.format(stamp) : "—";
  const pct = (value) => `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
  const opening = (date) => Date.parse(`${date}T09:30:00+08:00`);

  function sessionEnd(date, stamp) {
    const open = opening(date);
    if (stamp >= open && stamp < open + 120 * minute) return open + 120 * minute;
    if (stamp >= open + 210 * minute && stamp < open + 327 * minute) return open + 327 * minute;
    return 0;
  }

  const shell = document.createElement("section");
  shell.id = "review";
  shell.dataset.module = "review";
  shell.className = "card research-panel";
  shell.hidden = document.body.dataset.view !== "review";
  shell.innerHTML = `
    <div class="research-head"><div><h2>信号复盘</h2><p>保存每只股票每天各类信号的首次触发，并跟踪之后的实际报价。</p></div><span class="research-badge" id="reviewSignalCount"></span></div>
    <div class="research-filters"><label>日期 <select id="reviewSignalDate"></select></label><label>信号 <select id="reviewSignalType"><option value="">全部</option>${Object.entries(types).map(([id, name]) => `<option value="${id}">${name}</option>`).join("")}</select></label></div>
    <div id="reviewSignalSummary" class="signal-review-summary"></div>
    <div id="reviewSignalList" class="signal-review-list"></div>
    <button type="button" id="reviewSignalMore" hidden>显示更多</button>
    <p class="research-foot" id="reviewSignalStatus"></p>`;
  document.querySelector(".decision-desk").after(shell);
  const $ = (selector) => shell.querySelector(selector);
  const dates = $("#reviewSignalDate");
  let records = [], saveTimer, renderTimer, storageError = false, limit = 60;
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "[]");
    if (Array.isArray(saved)) records = saved.filter((item) => item && types[item.type] && /^\d{6}$/.test(item.code) && Number.isFinite(item.seenAt));
  } catch {}
  const recordId = (item) => `${item.date}:${item.code}:${item.type}`;
  const known = new Set(records.map(recordId));
  let activeDay = dayAt(), byCode = new Map();

  function indexRecord(record) {
    if (record.date !== activeDay) return;
    if (!byCode.has(record.code)) byCode.set(record.code, []);
    byCode.get(record.code).push(record);
  }
  records.forEach(indexRecord);

  function persist() {
    clearTimeout(saveTimer);
    const cutoff = Date.now() - 30 * 24 * 60 * minute;
    records = records.filter((record) => record.seenAt >= cutoff).slice(0, 2400);
    try { localStorage.setItem(key, JSON.stringify(records)); storageError = false; }
    catch { storageError = true; }
  }

  function scheduleUpdate() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 300);
    if (shell.hidden || renderTimer) return;
    renderTimer = setTimeout(() => { renderTimer = null; render(); }, 160);
  }

  document.addEventListener("quant:signal", (event) => {
    const signal = event.detail;
    if (!signal || !types[signal.type] || !/^\d{6}$/.test(signal.code) ||
        !Number.isFinite(signal.price) || signal.price <= 0 ||
        !Number.isFinite(signal.seenAt) || !Number.isFinite(signal.quoteAt) ||
        signal.quoteAt <= 0 || signal.quoteAt > signal.seenAt + 5000) return;
    const date = dayAt(signal.seenAt);
    if (dayAt(signal.quoteAt) !== date) return;
    const auction = signal.type.startsWith("auction-");
    const open = opening(date);
    if (auction && (signal.quoteAt < open - 10 * minute || signal.quoteAt >= open - 5 * minute)) return;
    if (!auction && (!sessionEnd(date, signal.seenAt) || sessionEnd(date, signal.seenAt) !== sessionEnd(date, signal.quoteAt))) return;
    if (activeDay !== date) { activeDay = date; byCode = new Map(); }
    const record = {
      date, code: signal.code, name: signal.name || signal.code, type: signal.type,
      reason: String(signal.reason || "").slice(0, 160), quoteAt: signal.quoteAt, seenAt: signal.seenAt,
      price: signal.price, baseAt: auction ? null : signal.seenAt, basePrice: auction ? null : signal.price,
      peak: auction ? null : signal.price, drawdown: 0, lastAt: signal.quoteAt, results: {}
    };
    const id = recordId(record);
    if (known.has(id)) return;
    known.add(id);
    records.unshift(record);
    indexRecord(record);
    scheduleUpdate();
  });

  document.addEventListener("quant:market-snapshot", (event) => {
    const snapshot = event.detail;
    const now = Date.now();
    if (!snapshot || snapshot.mode === "review" || snapshot.date !== activeDay || activeDay !== dayAt(now) || !byCode.size) return;
    let changed = false;
    for (const row of snapshot.allStocks || snapshot.stocks || []) {
      const entries = byCode.get(row.code), at = Number(row.quoteAt), price = Number(row.price);
      if (!entries || !Number.isFinite(price) || price <= 0 || !Number.isFinite(at) || at > now + 5000) continue;
      const end = sessionEnd(activeDay, at);
      if (!end) continue;
      for (const record of entries) {
        if (at <= record.lastAt) continue;
        if (record.baseAt === null) {
          const open = opening(activeDay);
          if (at < open || at > open + grace) continue;
          Object.assign(record, { baseAt: at, basePrice: price, peak: price, lastAt: at });
          changed = true;
        }
        if (at < record.baseAt || end !== sessionEnd(activeDay, record.baseAt) || at > record.baseAt + 30 * minute + grace) continue;
        record.lastAt = at;
        if (at <= record.baseAt + 30 * minute) {
          const peak = Math.max(record.peak, price);
          const drawdown = Math.min(record.drawdown, (price / peak - 1) * 100);
          changed ||= !record.sampled || peak !== record.peak || drawdown !== record.drawdown;
          record.sampled = true;
          record.peak = peak;
          record.drawdown = drawdown;
        }
        for (const minutes of horizons) {
          const target = record.baseAt + minutes * minute;
          if (target >= end || record.results[minutes] || at < target || at > target + grace) continue;
          record.results[minutes] = { at, change: (price / record.basePrice - 1) * 100 };
          changed = true;
        }
      }
    }
    if (changed) scheduleUpdate();
  });

  function resultText(record, minutes, now) {
    const result = record.results?.[minutes];
    if (result) return `<b class="${result.change >= 0 ? "up" : "down"}" title="报价 ${timeAt(result.at)}">${pct(result.change)}</b><small>${timeAt(result.at)}</small>`;
    if (!record.baseAt) return `<b>${now <= opening(record.date) + grace ? "待开盘" : "缺开盘报价"}</b>`;
    const target = record.baseAt + minutes * minute;
    if (target >= sessionEnd(record.date, record.baseAt)) return "<b>跨时段</b>";
    return `<b>${now <= target + grace ? "待采样" : "缺报价"}</b>`;
  }

  function render() {
    const now = Date.now();
    const current = dates.value;
    const days = [...new Set([dayAt(now), ...records.map((record) => record.date)])].sort().reverse();
    if (Array.from(dates.options).map((option) => option.value).join() !== days.join()) {
      dates.replaceChildren(...days.map((date) => new Option(date, date)));
      if (days.includes(current)) dates.value = current;
    }
    const type = $("#reviewSignalType").value;
    const shown = records.filter((record) => record.date === dates.value && (!type || record.type === type));
    $("#reviewSignalCount").textContent = `${shown.length} 条`;
    $("#reviewSignalSummary").innerHTML = shown.length ? horizons.map((minutes) => {
      const changes = shown.map((record) => record.results?.[minutes]?.change).filter(Number.isFinite).sort((a, b) => a - b);
      const positive = changes.filter((change) => change > 0).length;
      const middle = Math.floor(changes.length / 2);
      const median = changes.length % 2 ? changes[middle] : (changes[middle - 1] + changes[middle]) / 2;
      const stats = changes.length ? `上涨 ${positive}/${changes.length} · 中位 ${pct(median)}` : "暂无有效采样";
      return `<div><small>+${minutes} 分钟 · 已采样 ${changes.length}/${shown.length}</small><b>${stats}</b></div>`;
    }).join("") : "";
    $("#reviewSignalList").innerHTML = shown.slice(0, limit).map((record) => `
      <article class="signal-review-card">
        <div class="research-row"><button type="button" data-review-code="${record.code}"><b>${safe(record.name)}</b> <small>${record.code}</small></button><span class="research-badge">${types[record.type]}</span></div>
        <p class="signal-stamps">报价 ${timeAt(record.quoteAt)} · 触发 ${timeAt(record.seenAt)} · ${record.type.startsWith("auction-") ? "竞价参考价" : "触发价"} ${record.price.toFixed(2)}</p>
        <p class="signal-reason">${safe(record.reason)}</p>
        ${record.type.startsWith("auction-") && record.baseAt ? `<p class="signal-stamps">开盘后首个有效报价 ${timeAt(record.baseAt)} · ${record.basePrice.toFixed(2)}</p>` : ""}
        <div class="signal-results">
          ${horizons.map((minutes) => `<div><small>+${minutes} 分钟</small>${resultText(record, minutes, now)}</div>`).join("")}
          <div><small>30 分钟内采样回落</small><b>${record.sampled ? pct(record.drawdown) : "—"}</b></div>
        </div>
      </article>`).join("") || '<div class="research-empty">这个日期还没有捕捉到相符的信号。打开页面时会自动记录新触发。</div>';
    $("#reviewSignalMore").hidden = shown.length <= limit;
    $("#reviewSignalStatus").textContent = storageError
      ? "浏览器未能保存记录，本次记录仍在页面中。"
      : "记录保存在当前浏览器，最多保留 30 天、2400 条。用目标时点后 3 分钟内首次采到的报价，跨午休或收盘的窗口单独标出。";
  }

  shell.addEventListener("change", () => { limit = 60; render(); });
  $("#reviewSignalMore").addEventListener("click", () => { limit += 60; render(); });
  $("#reviewSignalList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-review-code]");
    if (!button) return;
    document.dispatchEvent(new CustomEvent("quant:open-view", { detail: { id: "lookup" } }));
    document.getElementById("stockSearch").value = button.dataset.reviewCode;
    document.getElementById("lookupForm").requestSubmit();
  });
  document.addEventListener("quant:view-changed", (event) => { if (event.detail?.id === "review") render(); });
  addEventListener("pagehide", persist);
  setInterval(() => { if (!shell.hidden) render(); }, 15000);
  render();
})();


