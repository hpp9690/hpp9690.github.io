(() => {
  const panel = document.querySelector(".opportunity-panel");
  if (!panel) return;
  const rangeLabels = ["≤−5%", "−5至−2%", "−2至0%", "0%", "0至2%", "2至5%", "≥5%"];
  const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" });
  const timeFormat = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const number = new Intl.NumberFormat("zh-CN");
  const market = document.createElement("section");
  market.className = "terminal-market";
  market.dataset.module = "opportunity";
  market.setAttribute("aria-label", "A 股盘面概览");
  market.hidden = document.body.dataset.view !== "opportunity";
  market.innerHTML = `
    <article class="terminal-market-card">
      <div class="terminal-market-head">
        <div><h2>涨跌分布</h2><p id="marketChartStamp" role="status">等待读取行情</p></div>
        <div class="terminal-market-params">
          <label>范围<select id="marketChartUniverse"><option value="all">全部 A 股</option><option value="main">沪深主板</option></select></label>
          <label>单位<select id="marketChartUnit"><option value="count">股数</option><option value="share">占比</option></select></label>
        </div>
      </div>
      <div class="terminal-market-plot">
        <div class="terminal-market-ticks" aria-hidden="true"></div>
        <div class="terminal-market-range" aria-label="各涨跌区间"></div>
        <p class="terminal-market-empty">等待有效行情</p>
      </div>
    </article>
    <article class="terminal-market-card terminal-market-breadth">
      <div class="terminal-market-head"><h2>市场广度</h2><span id="marketBreadthScope">全部 A 股</span></div>
      <div class="terminal-breadth-body">
        <div class="terminal-breadth-ring" aria-hidden="true"><div><strong id="marketBreadthTotal">—</strong><span>有效报价</span></div></div>
        <dl class="terminal-breadth-legend"><div data-tone="up"><dt>上涨</dt><dd>—</dd></div>
          <div data-tone="flat"><dt>平盘</dt><dd>—</dd></div><div data-tone="down"><dt>下跌</dt><dd>—</dd></div></dl>
      </div>
      <div class="terminal-market-turnover"><span>样本成交额</span><strong id="marketBreadthAmount">—</strong></div>
    </article>`;
  panel.before(market);

  const $ = (selector) => market.querySelector(selector);
  const plot = $(".terminal-market-range");
  const axis = $(".terminal-market-ticks");
  const ring = $(".terminal-breadth-ring");
  const universe = $("#marketChartUniverse"), unit = $("#marketChartUnit");
  let snapshot, health;

  function band(value) {
    if (value <= -5) return 0;
    if (value <= -2) return 1;
    if (value < 0) return 2;
    if (value === 0) return 3;
    if (value < 2) return 4;
    return value < 5 ? 5 : 6;
  }

  function amount(value) {
    if (value >= 1e12) return `${number.format(Math.round(value / 1e10) / 100)} 万亿`;
    if (value >= 1e8) return `${number.format(Math.round(value / 1e8))} 亿`;
    return `${number.format(Math.round(value / 1e4))} 万`;
  }

  function render() {
    const useShare = unit.value === "share";
    const main = universe.value === "main";
    const rows = (main ? snapshot?.main : snapshot?.all) || [];
    const count = rows.length;
    const bands = Array(7).fill(0);
    let traded = 0;
    for (const row of rows) {
      bands[band(row.pct)]++;
      if (Number.isFinite(row.amount) && row.amount > 0) traded += row.amount;
    }
    const values = useShare ? bands.map((value) => count ? 100 * value / count : 0) : bands;
    const maxValue = Math.max(...values);
    const step = 10 ** Math.max(0, Math.floor(Math.log10(Math.max(1, maxValue / 4))));
    const rounded = Math.max(4, Math.ceil(maxValue / (4 * step)) * 4 * step);
    const cap = useShare ? Math.min(100, rounded) : rounded;
    const axisValue = (value) => useShare ? `${number.format(value)}%` : number.format(value);
    axis.innerHTML = count ? [cap, cap * .75, cap / 2, cap / 4, 0].map((value) => `<span>${axisValue(value)}</span>`).join("") : "";
    plot.innerHTML = rangeLabels.map((label, index) => {
      const tone = index < 3 ? "down" : index === 3 ? "flat" : "up";
      const value = count ? (useShare ? `${values[index].toFixed(1)}%` : number.format(bands[index])) : "—";
      const description = `${label}，${count ? number.format(bands[index]) + " 只" + (useShare ? "，占 " + value : "") : "暂无报价"}`;
      return `<div class="terminal-market-column" role="img" data-tone="${tone}" title="${description}" aria-label="${description}">
        <div class="terminal-market-column-track"><span style="--market-bar:${100 * values[index] / cap}%"><b>${value}</b></span></div><small>${label}</small>
      </div>`;
    }).join("");
    $(".terminal-market-empty").hidden = Boolean(count);
    const up = bands[4] + bands[5] + bands[6], flat = bands[3], down = count - up - flat;
    ring.style.setProperty("--breadth-up", `${count ? 100 * up / count : 0}%`);
    ring.style.setProperty("--breadth-flat", `${count ? 100 * (up + flat) / count : 0}%`);
    ring.classList.toggle("has-data", Boolean(count));
    $("#marketBreadthScope").textContent = main ? "沪深主板" : "全部 A 股";
    $("#marketBreadthTotal").textContent = count ? number.format(count) : "—";
    $("#marketBreadthAmount").textContent = count ? amount(traded) : "—";
    for (const [tone, total] of Object.entries({ up, flat, down })) {
      $(`.terminal-breadth-legend [data-tone="${tone}"] dd`).textContent = count ? number.format(total) : "—";
    }
    const caption = $("#marketChartStamp");
    if (!snapshot) {
      caption.textContent = health === "error" ? "市场行情暂不可用" : "等待读取行情";
      return;
    }
    const historical = snapshot.date !== dayFormat.format(Date.now());
    const stamp = `${historical ? snapshot.date.slice(5) + " " : ""}${timeFormat.format(snapshot.at)}`;
    const origin = snapshot.source === "cache" ? "缓存 " : historical ? "历史 " : "";
    const coverage = snapshot.total && snapshot.scanned < snapshot.total ? ` · 覆盖 ${snapshot.scanned}/${snapshot.total}` : "";
    caption.textContent = `${origin}报价 ${stamp} · ${count ? number.format(count) + " 只" : "当前范围暂无报价"}${coverage}`;
    caption.title = snapshot.total ? `全市场扫描 ${snapshot.scanned}/${snapshot.total}${snapshot.missingPages ? `，缺 ${snapshot.missingPages} 页` : ""}` : "";
  }

  document.addEventListener("quant:market-snapshot", ({ detail }) => {
    const at = detail?.quotedAt;
    if (detail?.partial !== false || !Array.isArray(detail.allStocks) || !Array.isArray(detail.stocks) ||
        !Number.isFinite(at) || at <= 0 || at - Date.now() > 5000 || Date.now() - at > 7 * 86400000 ||
        (snapshot && at < snapshot.at)) return;
    const date = dayFormat.format(at);
    const valid = (row) => Number.isFinite(row.pct) && Number.isFinite(row.quoteAt) && row.quoteAt > 0 &&
      row.quoteAt <= at && dayFormat.format(row.quoteAt) === date;
    const all = detail.allStocks.filter(valid);
    if (!all.length) return;
    snapshot = { at, date, all, main: detail.stocks.filter(valid), source: detail.source,
      scanned: detail.scanned, total: detail.total, missingPages: detail.missingPages };
    render();
  });
  document.addEventListener("quant:market-health", ({ detail }) => { health = detail.state; if (!snapshot) render(); });
  universe.addEventListener("change", render);
  unit.addEventListener("change", render);
  render();
})();

