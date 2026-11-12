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
  shell.setAttribute("aria-label", "潜在机会雷达");
  shell.innerHTML = `<div class="opportunity-head"><div><p class="eyebrow">EARLY OPPORTUNITY RADAR</p><h2>潜在机会雷达</h2><p>先看尚未大涨、但价格与成交正在增强的股票。观察分用于排序，不表示上涨概率。</p></div><span id="opportunityStatus">等待有效行情</span></div><div class="opportunity-controls"><button type="button" data-opp-filter="all" class="active">全部候选</button><button type="button" data-opp-filter="confirmed">动能增强</button><button type="button" data-opp-filter="watch">我的关注</button><span id="opportunityCoverage">等待全市场覆盖数据</span></div><div id="opportunityList" class="opportunity-list"><div class="opportunity-empty">盘中取得有效行情后开始初筛；同一只股票有前后两次有效报价时再判断动能。</div></div><p class="opportunity-foot">需保持页面打开。公开行情可能延迟或缺页；候选应结合公告、板块和风险再次核查。</p>`;
  document.querySelector(".decision-desk")?.after(shell);
  shell.querySelector(".opportunity-controls").insertAdjacentHTML("beforeend", '<button type="button" data-open-review>信号复盘</button>');
  const sample = new Map(), candidates = new Map();
  let marketDate = clock().date, filter = "all", coverage = null, lastQuoteAt = 0, renderTimer;
  const timeFormat = new Intl.DateTimeFormat("zh-CN", { timeZone: zone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const watched = () => { try { return new Set(JSON.parse(localStorage.getItem("quantLens.watchlist.v1") || "[]").map((x) => x.code)); } catch { return new Set(); } };
  const amountText = (amount) => amount >= 1e8 ? `${(amount / 1e8).toFixed(2)}亿` : `${(amount / 1e4).toFixed(0)}万`;
  const render = () => {
    const t = clock(), now = Date.now(), watch = watched(), active = live(t);
    const rows = [...candidates.values()].filter((x) => active && x.date === t.date && now - x.at <= 90000 && (filter !== "confirmed" || x.confirmed) && (filter !== "watch" || watch.has(x.code)))
      .sort((a, b) => Number(b.confirmed) - Number(a.confirmed) || b.score - a.score).slice(0, 24);
    const age = lastQuoteAt ? Math.max(0, Math.round((now - lastQuoteAt) / 1000)) : null;
    const status = !active ? "非连续竞价时段" : age === null ? "等待有效报价"
      : age > 90 ? `最近报价已过 ${age} 秒` : `展示 ${rows.length} 只 · 最新报价 ${timeFormat.format(lastQuoteAt)}`;
    document.getElementById("opportunityStatus").textContent = status;
    const scan = coverage?.state === "ready" ? `全市场扫描 ${coverage.scanned}/${coverage.total}${coverage.missingPages ? ` · 缺 ${coverage.missingPages} 页` : ""}`
      : coverage?.state === "error" ? "全市场扫描失败" : "全市场扫描中";
    document.getElementById("opportunityCoverage").textContent = `机会范围 沪深主板 · ${scan}`;
    document.getElementById("opportunityList").innerHTML = rows.length ? rows.map((x) => `<article class="opportunity-item"><div class="opportunity-main"><div><b>${safe(x.name)}</b><small>${safe(x.code)} · ${safe(x.sector || "行业待确认")}</small></div><strong>${x.score}<small>观察分</small></strong></div><div class="opportunity-facts"><span class="${x.confirmed ? "opp-confirmed" : ""}">${x.confirmed ? "动能增强" : "初筛观察"}</span><span>涨幅 <b>${x.pct > 0 ? "+" : ""}${x.pct.toFixed(2)}%</b></span><span>成交额 ${amountText(x.amount)}</span><span>换手 ${x.turnover.toFixed(2)}%</span><span>更新 ${x.time}</span></div><p>${safe(x.reason)}</p><div class="opportunity-actions"><button type="button" data-opp-open="${safe(x.code)}">查看个股</button><button type="button" data-opp-watch="${safe(x.code)}">${watch.has(x.code) ? "★ 已关注" : "☆ 加入关注"}</button></div></article>`).join("") : `<div class="opportunity-empty">${filter === "watch" ? "关注清单暂无符合条件的股票" : filter === "confirmed" ? "暂无通过连续报价确认的增强信号" : "暂无符合条件的有效行情；可查看竞价候选或稍后刷新。"}</div>`;
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
      const reason = freshSignal ? `${Math.round(seconds)} 秒涨幅 +${move.toFixed(2)} 个百分点，新增成交 ${amountText(traded)}；继续核对板块和承接。` : confirmed ? last.reason : `涨幅 ${row.pct.toFixed(2)}%，成交额 ${amountText(row.amount)}；等待连续报价确认动能。`;
      candidates.set(row.code, { code: row.code, name: row.name, sector: row.sector, pct: row.pct, amount: row.amount, turnover: row.turnover, score, confirmed, confirmedAt: freshSignal ? at : last?.confirmedAt || 0, reason, time: timeFormat.format(at), at, date: t.date });
      if (freshSignal) document.dispatchEvent(new CustomEvent("quant:signal", {
        detail: { type: "momentum", code: row.code, name: row.name, price: Number(row.price), quoteAt: at, seenAt: now, reason }
      }));
    }
    queueRender();
  });
  document.addEventListener("quant:market-health", (event) => { if (event.detail?.state !== "scanning" || !coverage) coverage = event.detail; queueRender(); });
  document.addEventListener("quant:watchlist-changed", queueRender);
  document.addEventListener("quant:view-changed", (event) => { if (event.detail?.id === "opportunity") render(); });
  shell.addEventListener("click", (event) => {
    if (event.target.closest("[data-open-review]")) {
      document.dispatchEvent(new CustomEvent("quant:open-view", { detail: { id: "review" } }));
      return;
    }
    const mode = event.target.closest("[data-opp-filter]");
    if (mode) { filter = mode.dataset.oppFilter; shell.querySelectorAll("[data-opp-filter]").forEach((x) => x.classList.toggle("active", x === mode)); render(); return; }
    const watch = event.target.closest("[data-opp-watch]");
    if (watch) { const row = candidates.get(watch.dataset.oppWatch); if (row) document.dispatchEvent(new CustomEvent("quant:watch-request", { detail: { code: row.code, name: row.name } })); return; }
    const open = event.target.closest("[data-opp-open]");
    if (open) { const input = document.getElementById("stockSearch"), form = document.getElementById("lookupForm"); if (input && form) { document.dispatchEvent(new CustomEvent("quant:open-view", { detail: { id: "lookup" } })); input.value = open.dataset.oppOpen; form.requestSubmit(); } }
  });
  render(); setInterval(queueRender, 5000);
})();

