const markets = window.MARKETS || [];
const state = { marketId: "cn", kind: "all", query: "", sort: true, quotes: {}, loading: false, updatedAt: null };
const $ = (id) => document.getElementById(id);
const currency = { cn: "¥", hk: "HK$", us: "$", jp: "¥", kr: "₩" };

function signed(value) { return Number.isFinite(value) ? `${value > 0 ? "+" : ""}${value.toFixed(2)}%` : "—"; }
function cls(value) { return Number.isFinite(value) && value >= 0 ? "up" : "down"; }
function compact(value) { return Number.isFinite(value) ? new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(value) : "—"; }
function num(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function color(value) { if (!Number.isFinite(value)) return "#182130"; const strength = Math.min(Math.abs(value) / 4, 1); return value >= 0 ? `color-mix(in srgb,#ff5964 ${24 + strength * 56}%,#17202d)` : `color-mix(in srgb,#20c997 ${24 + strength * 56}%,#17202d)`; }
function market() { return markets.find((item) => item.id === state.marketId) || markets[0]; }

function parseQuote(key) {
  const raw = window[`v_${key}`];
  if (!raw) return null;
  const f = raw.split("~"), price = num(f[3]), previousClose = num(f[4]);
  const change = num(f[31]) ?? (price !== null && previousClose !== null ? price - previousClose : null);
  const changePercent = num(f[32]) ?? (change !== null && previousClose ? change / previousClose * 100 : null);
  return { key, price, previousClose, open: num(f[5]), high: num(f[33]), low: num(f[34]), change, changePercent, volume: num(f[6]), timestamp: f[30] || null };
}

function loadScript(keys) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.charset = "gbk";
    script.src = `https://qt.gtimg.cn/q=${keys.join(",")}&_=${Date.now()}`;
    script.onload = () => { script.remove(); resolve(); };
    script.onerror = () => { script.remove(); reject(new Error("行情源连接失败")); };
    document.head.appendChild(script);
  });
}

async function loadQuotes() {
  if (state.loading) return;
  state.loading = true; renderStatus();
  try {
    const keys = [...new Set(market().sectors.flatMap((sector) => sector.stocks.map((stock) => stock.key)))];
    const chunks = Array.from({ length: Math.ceil(keys.length / 45) }, (_, index) => keys.slice(index * 45, index * 45 + 45));
    await Promise.all(chunks.map(loadScript));
    state.quotes = Object.fromEntries(keys.map((key) => [key, parseQuote(key)]).filter(([, quote]) => quote));
    state.updatedAt = new Date();
    $("error").hidden = true;
  } catch (error) {
    $("error").textContent = `${error.message}。页面主体仍可浏览，请稍后点击刷新。`;
    $("error").hidden = false;
  } finally {
    state.loading = false; render();
  }
}

function sectorViews() {
  const views = market().sectors.map((sector) => {
    const rows = sector.stocks.map((stock) => ({ ...stock, quote: state.quotes[stock.key] }));
    const valid = rows.map((row) => row.quote?.changePercent).filter(Number.isFinite);
    return { ...sector, rows, available: valid.length, change: valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null };
  });
  if (state.sort) views.sort((a, b) => (b.change ?? -999) - (a.change ?? -999));
  return views;
}

function filteredViews(views) {
  const q = state.query.trim().toLowerCase();
  return views.filter((sector) => (state.kind === "all" || sector.kind === state.kind) && (!q || sector.name.toLowerCase().includes(q) || sector.note.toLowerCase().includes(q) || sector.stocks.some((stock) => `${stock.name}${stock.ticker}`.toLowerCase().includes(q))));
}

function renderNav() {
  $("marketNav").innerHTML = markets.map((item) => `<button class="market ${item.id === state.marketId ? "active" : ""}" data-market="${item.id}"><em>${item.flag}</em><span><b>${item.name}</b><small>${item.shortName}</small></span></button>`).join("");
}

function renderStatus() {
  const el = $("status");
  el.className = `status ${state.loading ? "" : state.updatedAt ? "ready" : ""}`;
  el.innerHTML = `<i></i><div><b>${state.loading ? "正在同步行情" : state.updatedAt ? "行情已同步" : "等待行情"}</b><small>${state.updatedAt ? state.updatedAt.toLocaleString("zh-CN", { hour12: false }) : "首次加载"}</small></div>`;
}

function renderStats(views) {
  const valid = views.map((sector) => sector.change).filter(Number.isFinite);
  const avg = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
  const leader = views.find((sector) => Number.isFinite(sector.change));
  const laggard = [...views].reverse().find((sector) => Number.isFinite(sector.change));
  $("stats").innerHTML = `<article class="stat"><span>板块均值</span><strong class="${cls(avg)}">${signed(avg)}</strong><small>${valid.filter((v) => v > 0).length}/${valid.length || market().sectors.length} 个板块上涨</small></article><article class="stat"><span>领涨板块</span><strong>${leader?.name || "—"}</strong><small class="up">${signed(leader?.change)}</small></article><article class="stat"><span>领跌板块</span><strong>${laggard?.name || "—"}</strong><small class="down">${signed(laggard?.change)}</small></article><article class="stat"><span>数据口径</span><strong>代表股等权</strong><small>分钟级刷新 · 非官方行业指数</small></article>`;
}

function renderGrid(views) {
  const rows = filteredViews(views);
  $("grid").innerHTML = rows.map((sector) => `<button class="tile" data-sector="${sector.id}" style="background:${color(sector.change)}"><div class="tile-top"><span class="tile-name">${sector.name}<i class="badge">${sector.kind === "theme" ? "主题" : "行业"}</i></span><span>›</span></div><strong>${signed(sector.change)}</strong><small>${sector.note}</small><div class="strip">${sector.rows.map((stock) => `<span>${stock.name}<b class="${cls(stock.quote?.changePercent)}">${signed(stock.quote?.changePercent)}</b></span>`).join("")}</div></button>`).join("");
  $("empty").hidden = rows.length > 0;
}

function render() {
  const current = market(), industries = current.sectors.filter((item) => item.kind === "industry").length, themes = current.sectors.filter((item) => item.kind === "theme").length;
  renderNav(); renderStatus();
  $("session").textContent = `${current.timezone} · 交易时段 ${current.session}`;
  $("title").textContent = `${current.name}板块全景`;
  $("coverage").textContent = `覆盖 ${industries} 个行业与 ${themes} 个热门主题，点击板块查看代表股。`;
  const views = sectorViews(); renderStats(views); renderGrid(views);
  document.querySelectorAll("#kindFilter button").forEach((button) => button.classList.toggle("active", button.dataset.kind === state.kind));
}

function showSector(id) {
  const sector = sectorViews().find((item) => item.id === id); if (!sector) return;
  $("modalContent").innerHTML = `<span class="eyebrow">${market().name} · ${sector.kind === "theme" ? "热门主题" : "行业板块"}</span><h2>${sector.name}</h2><p class="sub">${sector.note} · ${sector.available}/${sector.stocks.length} 只股票有有效行情</p><div class="modal-score"><div><span>代表股等权涨跌</span><strong class="${cls(sector.change)}">${signed(sector.change)}</strong></div><span>自动刷新 60 秒</span></div><div class="stock-table"><div class="row head"><span>股票</span><span>最新价</span><span>涨跌幅</span><span>日内区间</span><span>成交量</span></div>${sector.rows.map((stock) => { const q = stock.quote; return `<div class="row"><span><b>${stock.name}</b><small>${stock.ticker}</small></span><span>${Number.isFinite(q?.price) ? `${currency[state.marketId]}${q.price.toLocaleString("zh-CN")}` : "—"}</span><span class="${cls(q?.changePercent)}">${signed(q?.changePercent)}</span><span>${q?.low ?? "—"} — ${q?.high ?? "—"}</span><span>${compact(q?.volume)}</span></div>`; }).join("")}</div><p class="note">板块涨跌为所列代表股的简单平均值，用于快速观察市场温度，不等同于交易所或数据商发布的正式行业指数。</p>`;
  $("modal").hidden = false; document.body.style.overflow = "hidden";
}

function closeModal() { $("modal").hidden = true; document.body.style.overflow = ""; }

$("marketNav").addEventListener("click", (event) => { const button = event.target.closest("[data-market]"); if (!button) return; state.marketId = button.dataset.market; state.kind = "all"; state.query = ""; $("search").value = ""; state.quotes = {}; render(); loadQuotes(); });
$("kindFilter").addEventListener("click", (event) => { const button = event.target.closest("[data-kind]"); if (!button) return; state.kind = button.dataset.kind; render(); });
$("grid").addEventListener("click", (event) => { const button = event.target.closest("[data-sector]"); if (button) showSector(button.dataset.sector); });
$("search").addEventListener("input", (event) => { state.query = event.target.value; renderGrid(sectorViews()); });
$("refresh").addEventListener("click", loadQuotes);
$("sort").addEventListener("click", () => { state.sort = !state.sort; $("sort").textContent = state.sort ? "按强弱排序" : "按行业排序"; render(); });
$("closeModal").addEventListener("click", closeModal);
$("modal").addEventListener("click", (event) => { if (event.target === $("modal")) closeModal(); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeModal(); });

render(); loadQuotes(); setInterval(loadQuotes, 60000);

