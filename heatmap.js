(() => {
  const $ = (selector) => document.querySelector(selector);
  const safe = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const amountText = (value) => value >= 1e8 ? `${(value / 1e8).toFixed(1)} 亿` : `${(value / 1e4).toFixed(0)} 万`;
  const pctText = (value) => `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
  const colors = { up3: "#b9414b", up2: "#963842", up1: "#6b343e", same: "#344454", down1: "#245b51", down2: "#277b66", down3: "#2d9b7d" };
  const colorFor = (pct) => pct >= 5 ? colors.up3 : pct >= 2 ? colors.up2 : pct > 0 ? colors.up1 : pct <= -5 ? colors.down3 : pct <= -2 ? colors.down2 : pct < 0 ? colors.down1 : colors.same;
  const band = (pct) => pct >= 9.5 ? "涨停附近" : pct >= 3 ? "强势上涨" : pct > 0 ? "温和上涨" : pct === 0 ? "平盘" : pct > -3 ? "温和下跌" : "明显下跌";
  const shell = document.createElement("section");
  shell.id = "heatmap";
  shell.className = "heatmap-panel";
  shell.dataset.module = "heatmap";
  shell.hidden = document.body.dataset.view !== "heatmap";
  shell.setAttribute("aria-label", "市场热力图");
  shell.innerHTML = `<div class="heatmap-heading"><div><p class="eyebrow">A-SHARE MARKET MAP</p><h2>市场热力图</h2><p>面积代表成交额，颜色代表涨跌幅；点板块看成分股，点股票看详情。</p></div><span id="heatmapUpdated">等待行情快照</span></div><div class="heatmap-toolbar"><div class="heatmap-modes" role="group" aria-label="热力图视角"><button type="button" data-heat-mode="sector" class="active">板块总览</button><button type="button" data-heat-mode="top">成交额前列</button><button type="button" data-heat-mode="watch">关注清单</button></div><label>查看板块 <select id="heatmapSector"><option value="">全部板块</option></select></label></div><div class="heatmap-meta"><span id="heatmapSummary">正在建立行情快照</span><div class="heatmap-legend" aria-label="红涨绿跌图例"><span class="down3">≤−5%</span><span class="down2">−5%～−2%</span><span class="down1">−2%～0</span><span class="same">0</span><span class="up1">0～2%</span><span class="up2">2%～5%</span><span class="up3">≥5%</span></div></div><div id="heatmapCanvas" class="heatmap-canvas"><div class="heatmap-empty">交易日 09:15 后开始读取沪深主板行情</div></div><p class="heatmap-note">同一面积口径下比较成交活跃度；色阶展示当日涨跌，不代表趋势持续性。公开行情可能延迟或缺页。</p><div id="heatmapTip" class="heatmap-tip" hidden></div>`;
  shell.querySelector(".heatmap-toolbar").insertAdjacentHTML("beforeend", `<div class="heatmap-settings"><label>市场 <select id="heatmapUniverse"><option value="all">A股全图</option><option value="main">沪深主板</option></select></label><label>面积 <select id="heatmapSize"><option value="amount">成交额</option><option value="floatCap">流通市值</option></select></label></div>`);
  shell.querySelector(".heatmap-toolbar").insertAdjacentHTML("afterend", `<div class="heatmap-breadth" id="heatmapBreadth" aria-live="polite"><span>上涨 —</span><span>平盘 —</span><span>下跌 —</span><span>成交额 —</span></div>`);
  shell.querySelector(".heatmap-heading").insertAdjacentHTML("beforeend", `<div class="heatmap-tools"><button type="button" id="heatmapFull">全屏盯盘</button><button type="button" id="heatmapExport">保存图片</button></div>`);
  shell.querySelector('[data-heat-mode="top"]').textContent = "权重前列";
  shell.querySelector(".heatmap-empty").textContent = "交易日 09:15 后开始读取 A 股行情";
  ($(".anomaly-panel") || $(".decision-desk"))?.after(shell);

  const canvas = $("#heatmapCanvas"), summary = $("#heatmapSummary"), sectorSelect = $("#heatmapSector"), tip = $("#heatmapTip");
  let snapshot = null, mode = "sector", selectedSector = "", sectors = [], tiles = [], universe = "all", sizeMetric = "amount";
  const watchedCodes = () => {
    try { return new Set(JSON.parse(localStorage.getItem("quantLens.watchlist.v1") || "[]").map((item) => item.code)); }
    catch { return new Set(); }
  };
  const weight = (item) => Math.max(1, Number(item[sizeMetric]) || 0);
  const weightedPct = (items) => {
    const total = items.reduce((sum, item) => sum + weight(item), 0);
    return total ? items.reduce((sum, item) => sum + item.pct * weight(item), 0) / total : 0;
  };
  const layout = (items, x, y, width, height, output = []) => {
    if (!items.length || width <= 0 || height <= 0) return output;
    if (items.length === 1) { output.push({ item: items[0], x, y, width, height }); return output; }
    const total = items.reduce((sum, item) => sum + weight(item), 0);
    let count = 1, left = weight(items[0]);
    while (count < items.length - 1 && left + weight(items[count]) <= total / 2) left += weight(items[count++]);
    const ratio = Math.max(.01, Math.min(.99, left / total));
    if (width >= height) {
      const firstWidth = width * ratio;
      layout(items.slice(0, count), x, y, firstWidth, height, output);
      layout(items.slice(count), x + firstWidth, y, width - firstWidth, height, output);
    } else {
      const firstHeight = height * ratio;
      layout(items.slice(0, count), x, y, width, firstHeight, output);
      layout(items.slice(count), x, y + firstHeight, width, height - firstHeight, output);
    }
    return output;
  };
  const updateSectorOptions = () => {
    const previous = selectedSector;
    sectorSelect.replaceChildren(new Option("全部板块", ""));
    sectors.forEach((sector) => sectorSelect.add(new Option(`${sector.name} · ${sector.stocks.length}只`, sector.name)));
    sectorSelect.value = sectors.some((sector) => sector.name === previous) ? previous : "";
    selectedSector = sectorSelect.value;
  };
  const buildSectors = (stocks) => {
    const withName = stocks.filter((item) => item.sector && item.sector !== "-").length;
    const useIndustry = withName >= stocks.length * .6;
    const groups = new Map();
    for (const item of stocks) {
      const name = useIndustry ? (item.sector && item.sector !== "-" ? item.sector : "未分类") : band(item.pct);
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(item);
    }
    return [...groups].map(([name, members]) => ({ name, stocks: members,
      amount: members.reduce((sum, item) => sum + (Number(item.amount) || 0), 0),
      floatCap: members.reduce((sum, item) => sum + (Number(item.floatCap) || 0), 0),
      pct: weightedPct(members), kind: "sector" })).sort((a, b) => weight(b) - weight(a));
  };
  const draw = () => {
    if (shell.hidden || canvas.clientWidth < 100) return;
    tip.hidden = true;
    if (!snapshot?.stocks?.length) {
      canvas.innerHTML = `<div class="heatmap-empty">暂无有效行情。交易日 09:15 后自动刷新；可稍后重试。</div>`;
      summary.textContent = "等待 A 股行情";
      return;
    }
    const stocks = universe === "all" ? snapshot.allStocks : snapshot.stocks;
    const up = stocks.filter((item) => item.pct > 0).length, down = stocks.filter((item) => item.pct < 0).length;
    const traded = stocks.reduce((sum, item) => sum + item.amount, 0);
    $("#heatmapBreadth").innerHTML = `<span class="heat-up">上涨 <b>${up}</b></span><span>平盘 <b>${stocks.length - up - down}</b></span><span class="heat-down">下跌 <b>${down}</b></span><span>成交额 <b>${amountText(traded)}</b></span>`;
    let items, kind, caption;
    if (mode === "watch") {
      items = stocks.filter((item) => watchedCodes().has(item.code)).sort((a, b) => weight(b) - weight(a));
      kind = "stock";
      caption = `关注清单 · 本次行情覆盖 ${items.length} 只`;
    } else if (mode === "top") {
      items = [...stocks].sort((a, b) => weight(b) - weight(a)).slice(0, 70);
      kind = "stock";
      caption = `${universe === "all" ? "A股全图" : "沪深主板"} · ${sizeMetric === "amount" ? "成交额" : "流通市值"}前 ${items.length} 只`;
    } else if (selectedSector) {
      const sector = sectors.find((item) => item.name === selectedSector);
      items = [...(sector?.stocks || [])].sort((a, b) => weight(b) - weight(a)).slice(0, 55);
      kind = "stock";
      caption = `${sector?.name || selectedSector} · 展示${sizeMetric === "amount" ? "成交额" : "流通市值"}前 ${items.length}/${sector?.stocks.length || 0} 只`;
    } else {
      items = sectors;
      kind = "sector";
      caption = `板块总览 · ${sectors.length} 个板块、${stocks.length} 只${universe === "all" ? "A股" : "主板股票"}`;
    }
    summary.textContent = `${caption} · 行情页 ${snapshot.scanned}/${snapshot.total}`;
    if (!items.length) {
      canvas.innerHTML = `<div class="heatmap-empty">${mode === "watch" ? "关注清单暂无本次行情覆盖的股票。可在个股查询中加入关注。" : "当前板块暂无股票。"}</div>`;
      return;
    }
    tiles = items;
    const width = canvas.clientWidth, height = canvas.clientHeight;
    const rectangles = layout([...items].sort((a, b) => weight(b) - weight(a)), 0, 0, width, height);
    canvas.innerHTML = rectangles.map(({ item, x, y, width: w, height: h }) => {
      const index = tiles.indexOf(item), compact = w < 95 || h < 62, tiny = w < 54 || h < 36;
      const label = kind === "sector" ? item.name : item.name || item.code;
      const size = amountText(weight(item)), pct = pctText(item.pct), sizeName = sizeMetric === "amount" ? "成交额" : "流通市值";
      return `<button type="button" class="heat-tile${compact ? " compact" : ""}${tiny ? " tiny" : ""}" data-heat-index="${index}" style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px;width:${w.toFixed(1)}px;height:${h.toFixed(1)}px;background:${colorFor(item.pct)}" title="${safe(`${label} · ${pct} · ${sizeName} ${size}`)}" aria-label="${safe(`${label}，涨跌幅 ${pct}，${sizeName} ${size}`)}"><b>${safe(label)}</b><span>${safe(pct)}</span></button>`;
    }).join("");
  };
  const setMode = (next) => {
    mode = next;
    selectedSector = "";
    sectorSelect.value = "";
    shell.querySelectorAll("[data-heat-mode]").forEach((button) => button.classList.toggle("active", button.dataset.heatMode === next));
    draw();
  };
  const rebuild = () => {
    if (!snapshot) return draw();
    sectors = buildSectors(universe === "all" ? snapshot.allStocks : snapshot.stocks);
    updateSectorOptions();
    shell.querySelector(".heatmap-heading p:last-child").textContent = `面积代表${sizeMetric === "amount" ? "成交额" : "流通市值"}，颜色代表涨跌幅；点板块看成分股，点股票看详情。`;
    shell.querySelector(".heatmap-note").textContent = `板块面积为成分股${sizeMetric === "amount" ? "成交额" : "流通市值"}之和，颜色为相同口径加权涨跌幅。公开行情可能延迟或缺页。`;
    draw();
  };
  shell.querySelectorAll("[data-heat-mode]").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.heatMode)));
  $("#heatmapUniverse").addEventListener("change", (event) => { universe = event.target.value; rebuild(); });
  $("#heatmapSize").addEventListener("change", (event) => { sizeMetric = event.target.value; rebuild(); });
  const fullButton = $("#heatmapFull");
  if (!shell.requestFullscreen || !document.exitFullscreen) fullButton.hidden = true;
  else fullButton.addEventListener("click", async () => {
    try { if (document.fullscreenElement === shell) await document.exitFullscreen(); else await shell.requestFullscreen(); }
    catch { fullButton.textContent = "全屏不可用"; }
  });
  document.addEventListener("fullscreenchange", () => {
    fullButton.textContent = document.fullscreenElement === shell ? "退出全屏" : "全屏盯盘";
    requestAnimationFrame(draw);
  });
  $("#heatmapExport").addEventListener("click", async () => {
    if (!snapshot || !tiles.length) return;
    const picture = document.createElement("canvas"), width = 1400, height = 900, top = 105;
    picture.width = width; picture.height = height;
    const context = picture.getContext("2d");
    if (!context) return;
    context.fillStyle = "#0b1018"; context.fillRect(0, 0, width, height);
    context.fillStyle = "#eef3f8"; context.font = "bold 28px sans-serif";
    context.fillText("A股市场热力图", 24, 40);
    context.fillStyle = "#9eafb9"; context.font = "16px sans-serif";
    context.fillText(`${summary.textContent} · ${$("#heatmapUpdated").textContent}`, 24, 72);
    const kind = mode === "sector" && !selectedSector ? "sector" : "stock";
    for (const { item, x, y, width: w, height: h } of layout([...tiles].sort((a, b) => weight(b) - weight(a)), 0, top, width, height - top - 30)) {
      context.fillStyle = colorFor(item.pct); context.fillRect(x + 2, y + 2, Math.max(0, w - 4), Math.max(0, h - 4));
      if (w < 66 || h < 40) continue;
      context.save(); context.beginPath(); context.rect(x + 4, y + 4, w - 8, h - 8); context.clip();
      context.textAlign = "center"; context.fillStyle = "#fff"; context.font = "bold 14px sans-serif";
      let name = kind === "sector" ? item.name : item.name || item.code;
      while (name.length > 1 && context.measureText(name).width > w - 14) name = name.slice(0, -1);
      const center = x + w / 2, middle = y + h / 2;
      context.fillText(name, center, middle - 3);
      if (h > 56) { context.font = "12px sans-serif"; context.fillText(pctText(item.pct), center, middle + 16); }
      context.restore();
    }
    context.textAlign = "left"; context.fillStyle = "#8c9bac"; context.font = "12px sans-serif";
    context.fillText(`面积：${sizeMetric === "amount" ? "成交额" : "流通市值"} · 红涨绿跌 · 数据仅供研究`, 24, height - 8);
    const blob = await new Promise((resolve) => picture.toBlob(resolve, "image/png"));
    if (!blob) return;
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = `A股热力图-${new Date().toISOString().slice(0, 16).replace(/[T:]/g, "-")}.png`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  });
  sectorSelect.addEventListener("change", () => {
    selectedSector = sectorSelect.value;
    mode = "sector";
    shell.querySelectorAll("[data-heat-mode]").forEach((button) => button.classList.toggle("active", button.dataset.heatMode === "sector"));
    draw();
  });
  canvas.addEventListener("click", (event) => {
    const button = event.target.closest(".heat-tile"), item = tiles[Number(button?.dataset.heatIndex)];
    if (!item) return;
    if (mode === "sector" && !selectedSector) {
      selectedSector = item.name;
      sectorSelect.value = selectedSector;
      draw();
      return;
    }
    document.dispatchEvent(new CustomEvent("quant:open-view", { detail: { id: "lookup" } }));
    const input = $("#stockSearch"), form = $("#lookupForm");
    if (input && form) { input.value = item.code; form.requestSubmit(); }
  });
  canvas.addEventListener("pointermove", (event) => {
    const button = event.target.closest(".heat-tile"), item = tiles[Number(button?.dataset.heatIndex)];
    if (!button || !item || event.pointerType === "touch") { tip.hidden = true; return; }
    const label = item.kind ? item.name : `${item.name} · ${item.code}`;
    tip.innerHTML = `<b>${safe(label)}</b><span>涨跌幅 ${safe(pctText(item.pct))}</span><span>成交额 ${safe(amountText(item.amount))}${sizeMetric === "floatCap" ? ` · 流通市值 ${safe(amountText(item.floatCap))}` : ""}</span><span>${item.kind ? `${item.stocks.length} 只股票` : `换手 ${Number(item.turnover || 0).toFixed(2)}% · 最新价 ${Number(item.price || 0).toFixed(2)}`}</span>`;
    tip.hidden = false;
    tip.style.left = `${Math.min(event.clientX + 16, innerWidth - tip.offsetWidth - 8)}px`;
    tip.style.top = `${Math.min(event.clientY + 16, innerHeight - tip.offsetHeight - 8)}px`;
  });
  canvas.addEventListener("pointerleave", () => { tip.hidden = true; });
  document.addEventListener("quant:market-snapshot", (event) => {
    const next = event.detail;
    if (!next?.stocks?.length) return;
    const incomingCoverage = Number(next.total) ? Number(next.scanned) / Number(next.total) : 0;
    const previousCoverage = snapshot?.total ? snapshot.scanned / snapshot.total : 0;
    const updated = $("#heatmapUpdated");
    if (snapshot && snapshot.date === next.date && previousCoverage >= .7 &&
        incomingCoverage < previousCoverage - .15 && Date.now() - snapshot.capturedAt < 180000) {
      updated.textContent = `本轮行情缺页 · 保留 ${new Date(snapshot.capturedAt).toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai" })} 较完整快照`;
      updated.classList.add("partial");
      return;
    }
    const validStock = (item) => /^\d{6}$/.test(item.code) && Number.isFinite(item.pct) && Number.isFinite(item.amount) && item.amount >= 0 && Number(item.price) > 0;
    const stocks = next.stocks.filter(validStock);
    const allStocks = Array.isArray(next.allStocks) ? next.allStocks.filter(validStock) : stocks;
    snapshot = { ...next, stocks, allStocks };
    updated.textContent = `${next.date} · ${next.mode === "review" ? "复盘" : "行情快照"} · ${new Date(next.capturedAt).toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai" })}`;
    updated.classList.toggle("partial", incomingCoverage < .8);
    rebuild();
  });
  document.addEventListener("quant:watchlist-changed", () => { if (mode === "watch") draw(); });
  document.addEventListener("quant:view-changed", (event) => { if (event.detail?.id === "heatmap") requestAnimationFrame(draw); else tip.hidden = true; });
  new ResizeObserver(() => { if (!shell.hidden) draw(); }).observe(canvas);
  draw();
})();

