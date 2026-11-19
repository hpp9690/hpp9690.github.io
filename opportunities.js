(() => {
  const zone = "Asia/Shanghai";
  const safe = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const clock = () => {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" }).formatToParts(new Date());
    const part = (type) => parts.find((x) => x.type === type)?.value || "";
    return { date: `${part("year")}-${part("month")}-${part("day")}`, minute: Number(part("hour")) * 60 + Number(part("minute")), time: `${part("hour")}:${part("minute")}`, weekday: part("weekday") };
  };
  const live = (t) => !["Sat", "Sun"].includes(t.weekday) && ((t.minute >= 570 && t.minute < 690) || (t.minute >= 780 && t.minute < 897));
  const shell = document.createElement("section");
  shell.id = "opportunity";
  shell.className = "opportunity-panel";
  shell.dataset.module = "opportunity";
  shell.hidden = document.body.dataset.view !== "opportunity";
  shell.setAttribute("aria-label", "潜在机会");
  shell.innerHTML = `
    <div class="opportunity-head">
      <h2>潜在机会</h2>
      <span id="opportunityStatus">等待行情</span>
    </div>
    <div class="opportunity-controls">
      <button type="button" data-opp-filter="all" class="active" aria-pressed="true">全部</button>
      <button type="button" data-opp-filter="confirmed" aria-pressed="false">动能增强</button>
      <button type="button" data-opp-filter="watch" aria-pressed="false">我的关注</button>
      <button type="button" data-open-review>信号复盘</button>
    </div>
    <div id="opportunityList" class="opportunity-list"></div>
    <div class="opp-more"><button type="button" id="opportunityMore" aria-controls="opportunityList" hidden>显示更多</button></div>
    <details class="market-panel-disclosure opportunity-foot">
      <summary>筛选规则与行情覆盖</summary>
      <p id="opportunityCoverage">等待行情覆盖数据</p>
      <p>初筛关注涨幅在 0.3% 至 6% 之间的活跃股票。连续报价中涨幅增加至少 0.3 个百分点、成交额增加至少 200 万元时，可标为动能增强。</p>
      <p>观察分来自量价。技术与行业强弱辅助排序，有公告风险提示的候选会后移。请保持页面打开以持续接收行情。</p>
    </details>`;
  document.querySelector(".decision-desk")?.after(shell);
  const list = shell.querySelector("#opportunityList");
  const more = shell.querySelector("#opportunityMore");
  const sample = new Map(), candidates = new Map();
  const initialLimit = 8;
  let marketDate = clock().date, filter = "all", coverage = null, lastQuoteAt = 0, renderTimer, renderedList = "", visibleLimit = initialLimit;
  const timeFormat = new Intl.DateTimeFormat("zh-CN", { timeZone: zone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const watched = () => { try { return new Set(JSON.parse(localStorage.getItem("quantLens.watchlist.v1") || "[]").map((x) => x.code)); } catch { return new Set(); } };
  const amountText = (amount) => amount >= 1e8 ? `${(amount / 1e8).toFixed(2)}亿` : `${(amount / 1e4).toFixed(0)}万`;
  const ready = (entry) => entry?.status === "ready";
  const sourceLink = (value, code) => {
    if (!value) return "";
    try {
      const url = new URL(value);
      if (url.protocol === "https:") return ` <a href="${safe(url.href)}" data-opp-source="${code}" target="_blank" rel="noopener noreferrer">公告原文 ↗</a>`;
    } catch {}
    return "";
  };
  const renderEvidence = (row, evidence, risk) => {
    const support = ready(evidence?.technical) && evidence.technical.positive &&
      ready(evidence?.sentiment) && evidence.sentiment.positive;
    const tone = risk ? "risk" : support ? "support" : "neutral";
    const summary = risk ? "公告风险待核对" : support ? "技术与行业同向" : "技术 · 消息 · 情绪";
    const group = [
      { label: "技术", entry: evidence?.technical },
      { label: "消息", entry: evidence?.news },
      { label: "情绪", entry: evidence?.sentiment }
    ];
    return `<details class="opp-evidence" data-opp-evidence-card="${row.code}">
      <summary class="opp-evidence-summary" data-tone="${tone}" data-opp-evidence="${row.code}">${summary}</summary>
      <dl class="opp-evidence-grid">${group.map(({ label, entry }) => {
        const message = entry?.text || (entry?.status === "loading" ? "正在核对" : "暂无可用数据");
        return `<div><dt>${label}</dt><dd>${safe(message)}${sourceLink(entry?.url, row.code)}</dd></div>`;
      }).join("")}</dl>
    </details>`;
  };
  const render = () => {
    const t = clock(), now = Date.now(), watch = watched(), active = live(t);
    const baseRows = [...candidates.values()].filter((x) => active && x.date === t.date && now - x.at <= 90000 && (filter !== "confirmed" || x.confirmed) && (filter !== "watch" || watch.has(x.code)))
      .sort((a, b) => Number(b.confirmed) - Number(a.confirmed) || b.score - a.score).slice(0, 24);
    const expanded = new Set([...list.querySelectorAll(".opp-evidence[open]")].map((item) => item.dataset.oppEvidenceCard));
    const source = window.QuantOpportunityEvidence;
    if (!shell.hidden && source) {
      const prioritized = [
        ...baseRows.filter((row) => expanded.has(row.code)),
        ...baseRows.filter((row) => !expanded.has(row.code))
      ];
      source.request(prioritized.slice(0, initialLimit));
    }
    const rows = baseRows.map((row) => {
      const evidence = source?.evaluate(row);
      const risk = ready(evidence?.news) && evidence.news.risk === true;
      const adjustment = (ready(evidence?.technical) && evidence.technical.positive ? 4 : 0) +
        (ready(evidence?.sentiment) && evidence.sentiment.positive ? 3 : 0);
      return { row, evidence, risk, rank: row.score + adjustment };
    }).sort((a, b) => Number(a.risk) - Number(b.risk) || Number(b.row.confirmed) - Number(a.row.confirmed) || b.rank - a.rank);
    const age = lastQuoteAt ? Math.max(0, Math.round((now - lastQuoteAt) / 1000)) : null;
    const status = !active ? "盘中更新" : age === null ? "等待报价"
      : age > 90 ? `报价已过 ${age} 秒` : `${rows.length} 只 · 报价 ${timeFormat.format(lastQuoteAt)}`;
    document.getElementById("opportunityStatus").textContent = status;
    const scan = coverage?.state === "ready" ? `全市场扫描 ${coverage.scanned}/${coverage.total}${coverage.missingPages ? ` · 缺 ${coverage.missingPages} 页` : ""}`
      : coverage?.state === "error" ? "全市场扫描失败" : "全市场扫描中";
    document.getElementById("opportunityCoverage").textContent = `沪深主板 · ${scan}`;
    more.hidden = rows.length <= visibleLimit;
    if (!more.hidden) more.textContent = `显示更多（${rows.length - visibleLimit}）`;
    const markup = rows.length ? rows.slice(0, visibleLimit).map(({ row: x, evidence, risk }) => {
      const followed = watch.has(x.code);
      return `<article class="opportunity-item">
        <div class="opportunity-main">
          <button type="button" class="opp-stock-link" data-opp-open="${x.code}" aria-label="查看 ${safe(x.name || x.code)} 的个股详情">
            <b>${safe(x.name || x.code)} ›</b>
            <small>${x.code}${x.sector && x.sector !== "-" ? ` · ${safe(x.sector)}` : ""}</small>
          </button>
          <strong class="opp-change ${x.pct >= 0 ? "up" : "down"}">${x.pct > 0 ? "+" : ""}${x.pct.toFixed(2)}%</strong>
        </div>
        <div class="opportunity-facts">
          <span class="${x.confirmed ? "opp-confirmed" : ""}">${x.confirmed ? "动能增强" : "初筛"}</span>
          <span>成交 ${amountText(x.amount)}</span>
          <span>观察分 ${x.score}</span>
        </div>
        ${x.confirmed ? `<p class="opp-reason">${safe(x.reason)}</p>` : ""}
        ${renderEvidence(x, evidence, risk)}
        <div class="opportunity-actions opp-card-footer">
          <small>报价 ${x.time} · 换手 ${x.turnover.toFixed(2)}%</small>
          <button type="button" class="opp-watch-button" data-opp-watch="${x.code}" aria-pressed="${followed}">${followed ? "★ 已关注" : "☆ 关注"}</button>
        </div>
      </article>`;
    }).join("") : `<div class="opportunity-empty">${!active ? "等待盘中行情" : filter === "watch" ? "关注清单暂无候选" : filter === "confirmed" ? "暂无动能增强信号" : "暂无符合条件的股票"}</div>`;
    if (markup === renderedList) return;
    const focused = list.contains(document.activeElement) ? document.activeElement : null;
    const focusTarget = ["data-opp-open", "data-opp-watch", "data-opp-evidence", "data-opp-source"].find((attr) => focused?.hasAttribute(attr));
    const code = focusTarget ? focused.getAttribute(focusTarget) : "";
    list.innerHTML = renderedList = markup;
    list.querySelectorAll(".opp-evidence").forEach((item) => { item.open = expanded.has(item.dataset.oppEvidenceCard); });
    if (code) list.querySelector(`[${focusTarget}="${code}"]`)?.focus({ preventScroll: true });
  };
  const queueRender = () => {
    if (shell.hidden || renderTimer) return;
    renderTimer = setTimeout(() => { renderTimer = null; render(); }, 200);
  };
  document.addEventListener("quant:market-snapshot", (event) => {
    const next = event.detail, t = clock();
    if (!next || next.date !== t.date || next.mode === "review" || !live(t) || !Array.isArray(next.stocks)) return;
    if (marketDate !== t.date) { sample.clear(); candidates.clear(); lastQuoteAt = 0; marketDate = t.date; }
    const now = Date.now();
    const sessionStart = Date.parse(`${t.date}T${t.minute < 690 ? "09:30" : "13:00"}:00+08:00`);
    for (const row of next.stocks) {
      if (!/^\d{6}$/.test(row.code || "") || !Number.isFinite(row.pct) || !Number.isFinite(row.amount) || !Number.isFinite(row.turnover) || Number(row.price) <= 0 || /ST|退/.test(row.name || "")) continue;
      const at = Number(row.quoteAt);
      if (!Number.isFinite(at) || at < sessionStart || now - at > 90000 || at > now + 5000) continue;
      lastQuoteAt = Math.max(lastQuoteAt, at);
      const history = sample.get(row.code) || [];
      if (history.at(-1)?.at >= at) continue;
      const recent = history.filter((quote) => quote.at >= sessionStart && at - quote.at <= 180000);
      const before = recent.findLast((quote) => at - quote.at >= 8000);
      const seconds = before ? (at - before.at) / 1000 : 0;
      const move = before && seconds >= 8 && seconds <= 180 && row.amount >= before.amount ? row.pct - before.pct : 0;
      const traded = before && seconds >= 8 && seconds <= 180 ? Math.max(0, row.amount - before.amount) : 0;
      recent.push({ at, pct: row.pct, amount: row.amount });
      sample.set(row.code, recent);
      const minimum = t.minute < 600 ? 8e6 : 3e7;
      if (row.pct < .3 || row.pct > 6 || row.amount < minimum || row.turnover < .15 || row.turnover > 15) { candidates.delete(row.code); continue; }
      const last = candidates.get(row.code), freshSignal = move >= .3 - 1e-8 && traded >= 2e6;
      const confirmed = freshSignal || !!(last?.confirmed && at - last.confirmedAt <= 180000 && row.pct >= last.pct - .3);
      const score = Math.max(0, Math.min(100, Math.round(10 + Math.min(20, row.pct * 6) + Math.min(18, Math.log10(Math.max(row.amount, 1) / 1e6) * 10) + Math.min(12, row.turnover * 3) + (freshSignal ? Math.min(35, 15 + move * 20 + traded / 1e7 * 5) : confirmed ? 18 : 0) - (row.pct > 4.5 ? 10 : 0) - (row.turnover > 8 ? 10 : 0))));
      if (score < 32) { candidates.delete(row.code); continue; }
      const reason = freshSignal ? `${Math.round(seconds)} 秒涨幅 +${move.toFixed(2)} 个百分点 · 新增成交 ${amountText(traded)}` : confirmed ? last.reason : "";
      candidates.set(row.code, { code: row.code, name: row.name, sector: row.sector, price: Number(row.price), pct: row.pct, amount: row.amount, turnover: row.turnover, score, confirmed, confirmedAt: freshSignal ? at : last?.confirmedAt || 0, reason, time: timeFormat.format(at), at, date: t.date });
      if (freshSignal) document.dispatchEvent(new CustomEvent("quant:signal", {
        detail: { type: "momentum", code: row.code, name: row.name, price: Number(row.price), quoteAt: at, seenAt: now, reason }
      }));
    }
    queueRender();
  });
  document.addEventListener("quant:market-health", (event) => { if (event.detail?.state !== "scanning" || !coverage) coverage = event.detail; queueRender(); });
  document.addEventListener("quant:opportunity-evidence", queueRender);
  document.addEventListener("quant:watchlist-changed", queueRender);
  document.addEventListener("quant:view-changed", (event) => {
    if (event.detail?.id === "opportunity") render();
    else window.QuantOpportunityEvidence?.request([]);
  });
  list.addEventListener("toggle", (event) => {
    if (event.target.matches(".opp-evidence")) queueRender();
  }, true);
  more.addEventListener("click", () => {
    const firstNew = visibleLimit;
    visibleLimit += initialLimit;
    render();
    list.querySelectorAll("[data-opp-open]")[firstNew]?.focus();
  });
  shell.addEventListener("click", (event) => {
    if (event.target.closest("[data-open-review]")) {
      document.dispatchEvent(new CustomEvent("quant:open-view", { detail: { id: "review" } }));
      return;
    }
    const mode = event.target.closest("[data-opp-filter]");
    if (mode) {
      filter = mode.dataset.oppFilter;
      visibleLimit = initialLimit;
      shell.querySelectorAll("[data-opp-filter]").forEach((button) => {
        button.classList.toggle("active", button === mode);
        button.setAttribute("aria-pressed", String(button === mode));
      });
      render();
      return;
    }
    const watch = event.target.closest("[data-opp-watch]");
    if (watch) { const row = candidates.get(watch.dataset.oppWatch); if (row) document.dispatchEvent(new CustomEvent("quant:watch-request", { detail: { code: row.code, name: row.name } })); return; }
    const open = event.target.closest("[data-opp-open]");
    if (open) { const input = document.getElementById("stockSearch"), form = document.getElementById("lookupForm"); if (input && form) { document.dispatchEvent(new CustomEvent("quant:open-view", { detail: { id: "lookup" } })); input.value = open.dataset.oppOpen; form.requestSubmit(); } }
  });
  render(); setInterval(queueRender, 5000);
})();

