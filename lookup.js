(()=>{
const $=id=>document.getElementById(id), input=$("stockSearch"), box=$("suggestions"), detail=$("stockDetail");
let timer, suggestionRequest, lookupVersion = 0;
const num=v=>Number.isFinite(+v)?+v:null, money=v=>v==null?"—":new Intl.NumberFormat("zh-CN",{notation:"compact",maximumFractionDigits:2}).format(v), signed=v=>v==null?"—":`${v>0?"+":""}${v.toFixed(2)}%`;
function closeSuggestions() {
  clearTimeout(timer);
  suggestionRequest?.abort();
  suggestionRequest = null;
  box.hidden = true;
}

function suggestionMessage(message) {
  const paragraph = document.createElement("p");
  paragraph.textContent = message;
  box.replaceChildren(paragraph);
  box.hidden = false;
}

async function suggest(query) {
  closeSuggestions();
  if (query.length < 2 || /^\d{6}$/.test(query)) return;
  const request = new AbortController();
  suggestionRequest = request;
  try {
    const url = new URL("https://searchapi.eastmoney.com/api/suggest/get");
    url.search = new URLSearchParams({ input: query, type: "14", count: "8" });
    const response = await fetch(url, { signal: request.signal });
    if (!response.ok) throw new Error("搜索暂不可用");
    const result = await response.json();
    if (suggestionRequest !== request || input.value.trim() !== query) return;
    const stocks = (result?.QuotationCodeTable?.Data || []).filter((item) => item.Classify === "AStock");
    if (!stocks.length) return suggestionMessage("没有匹配的 A 股");
    box.replaceChildren(...stocks.map((item) => {
      const button = document.createElement("button");
      const name = document.createElement("b"), identity = document.createElement("span");
      button.type = "button";
      name.textContent = item.Name;
      identity.textContent = `${item.Code} · ${item.SecurityTypeName}`;
      button.append(name, identity);
      button.addEventListener("click", () => {
        input.value = item.Code;
        closeSuggestions();
        input.focus();
        load(item.Code, item.MktNum);
      });
      return button;
    }));
    box.hidden = false;
  } catch {
    if (suggestionRequest === request) suggestionMessage("搜索接口暂不可用，可直接输入六位代码查询");
  } finally {
    if (suggestionRequest === request) suggestionRequest = null;
  }
}

input.addEventListener("input", () => {
  closeSuggestions();
  timer = setTimeout(() => suggest(input.value.trim()), 250);
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".lookup")) closeSuggestions();
});
input.closest(".lookup").addEventListener("keydown", (event) => {
  if (event.key === "Escape" && (!box.hidden || suggestionRequest)) {
    event.preventDefault();
    closeSuggestions();
    input.focus();
    return;
  }
  if (box.hidden || !["ArrowDown", "ArrowUp"].includes(event.key)) return;
  if (event.target !== input && !box.contains(event.target)) return;
  const choices = [...box.querySelectorAll("button")];
  if (!choices.length) return;
  event.preventDefault();
  const current = choices.indexOf(event.target);
  const next = event.key === "ArrowDown" ? current + 1 : current < 0 ? choices.length - 1 : current - 1;
  (choices[next] || input).focus();
});
$("lookupForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const query = input.value.trim();
  if (/^\d{6}$/.test(query)) {
    closeSuggestions();
    const market = !query.startsWith("920") && /^[569]/.test(query) ? "1" : "0";
    load(query, market);
  } else suggest(query);
});

function renderStockConcepts(section, rawConcepts) {
  const names = typeof rawConcepts === "string"
    ? [...new Set(rawConcepts.split(",").map((name) => name.trim()).filter((name) => name && name !== "-"))]
    : [];
  section.querySelector(".stock-concepts-count").textContent = names.length ? `${names.length} 个` : "";
  const list = section.querySelector(".stock-concepts-list");
  if (!names.length) {
    const status = document.createElement("p");
    status.className = "muted";
    status.textContent = "东方财富暂未返回该股的概念板块";
    list.append(status);
    return;
  }
  for (const name of names) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "stock-concept";
    button.textContent = name;
    button.addEventListener("click", () => {
      document.dispatchEvent(new CustomEvent("quant:open-concept", { detail: { name } }));
    });
    list.append(button);
  }
}

function renderStockMetrics(metrics, note, quote, flow, kline) {
  const flowRows = flow?.data?.klines;
  const latestFlow = Array.isArray(flowRows) ? flowRows.at(-1) : null;
  const flowLine = typeof latestFlow === "string" ? latestFlow.split(",") : [];
  const netMain = flowLine.length > 1 ? num(flowLine[1]) : null;
  const bars = kline?.data?.klines;
  const closes = Array.isArray(bars)
    ? bars.filter((bar) => typeof bar === "string").map((bar) => Number(bar.split(",")[2])).filter(Number.isFinite)
    : [];
  const average = (days) => closes.length >= days
    ? closes.slice(-days).reduce((sum, value) => sum + value, 0) / days
    : null;
  const averages = [5, 20].flatMap((days) => {
    const value = average(days);
    return value === null ? [] : [`MA${days} ${value.toFixed(2)}`];
  });
  metrics.innerHTML = `
    <div><small>最新价</small><b>${num(quote.f43)?.toFixed(2) ?? "—"}</b></div>
    <div><small>成交额</small><b>${money(num(quote.f48))}</b></div>
    <div><small>换手率</small><b>${num(quote.f168) === null ? "—" : `${num(quote.f168).toFixed(2)}%`}</b></div>
    <div><small>市值</small><b>${money(num(quote.f116))}</b></div>
    <div><small>市盈率</small><b>${num(quote.f162)?.toFixed(2) ?? "—"}</b></div>
    <div><small>市净率</small><b>${num(quote.f167)?.toFixed(2) ?? "—"}</b></div>
    <div><small>主力净流入</small><b class="${netMain === null ? "" : netMain >= 0 ? "up" : "down"}">${money(netMain)}</b></div>
    <div><small>均线</small><b>${averages.join(" / ") || "—"}</b></div>`;
  note.textContent = "资金流取自东方财富日频资金流向最近记录；净流入是按其大单分类口径统计，不代表全部资金或后续走势。"
    + (closes.length ? `均线根据最近 ${closes.length} 个日 K 线收盘价计算。` : "");
}

async function load(code, market) {
  const version = ++lookupVersion;
  detail.innerHTML = "<p class='muted'>正在读取个股数据…</p>";
  const secid = `${market}.${code}`;
  const base = "https://push2.eastmoney.com/api/qt/stock/";
  try {
    const quoteRequest = get(`${base}get`, {
      secid, fltt: 2, invt: 2,
      fields: "f43,f48,f57,f58,f86,f116,f129,f162,f167,f168,f170"
    });
    const supplementary = Promise.allSettled([
      get(`${base}fflow/kline/get`, {
        secid, lmt: 1, klt: 101, fields1: "f1,f2,f3,f7", fields2: "f51,f52,f53,f54,f55,f56,f57,f58"
      }),
      get("https://push2his.eastmoney.com/api/qt/stock/kline/get", {
        secid, klt: 101, fqt: 1, lmt: 30, fields1: "f1,f2,f3,f4,f5,f6",
        fields2: "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61"
      })
    ]);
    const quote = (await quoteRequest)?.data;
    if (version !== lookupVersion) return;
    if (!quote?.f57 || !quote.f58) throw new Error("未找到股票或暂时无行情");
    detail.innerHTML = `
      <div class="detail-title">
        <div><h3></h3><span class="muted"></span></div><b></b>
      </div>
      <div class="metrics"></div>
      <section class="stock-concepts" aria-labelledby="stockConceptsHeading">
        <div class="stock-concepts-head">
          <h4 id="stockConceptsHeading">所属概念板块</h4>
          <span class="stock-concepts-count"></span>
        </div>
        <div class="stock-concepts-list"></div>
      </section>
      <p class="flow-note"></p>`;
    const heading = detail.querySelector("h3");
    const codeLabel = document.createElement("small");
    codeLabel.textContent = quote.f57;
    heading.append(`${quote.f58} `, codeLabel);
    const quoteTime = Number(quote.f86) * 1000;
    const quoteStamp = Number.isFinite(quoteTime) && quoteTime > 0
      ? new Date(quoteTime).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })
      : "更新时间以数据源为准";
    detail.querySelector(".detail-title .muted").textContent = `东方财富行情 · ${quoteStamp}`;
    const change = detail.querySelector(".detail-title > b");
    change.className = +quote.f170 >= 0 ? "up" : "down";
    change.textContent = signed(num(quote.f170));

    const metrics = detail.querySelector(".metrics");
    const note = detail.querySelector(".flow-note");
    renderStockMetrics(metrics, note, quote);
    renderStockConcepts(detail.querySelector(".stock-concepts"), quote.f129);

    const [flow, kline] = await supplementary;
    if (version !== lookupVersion) return;
    renderStockMetrics(metrics, note, quote, flow.value, kline.value);
  } catch (error) {
    if (version !== lookupVersion) return;
    const status = document.createElement("p");
    status.className = "error";
    status.textContent = `${error.message || "数据读取失败"}。请确认代码正确，或稍后重试。`;
    detail.replaceChildren(status);
  }
}

async function get(base, params) {
  const url = new URL(base);
  url.search = new URLSearchParams({ ...params, ut: "fa5fd1943c7b386f172d6893dbbd1d0c", _: Date.now() });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`行情接口返回 ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}
const detailObserver = new MutationObserver(() => {
  const title = detail.querySelector(".detail-title");
  if (!title || title.querySelector(".lookup-watch")) return;
  const heading = title.querySelector("h3"), code = heading?.querySelector("small")?.textContent.trim();
  if (!/^\d{6}$/.test(code || "")) return;
  const name = heading.childNodes[0]?.textContent.trim() || code;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "lookup-watch";
  button.dataset.code = code;
  button.dataset.name = name;
  button.setAttribute("aria-pressed", "false");
  button.textContent = "☆ 加入关注";
  const actions = document.createElement("div");
  actions.className = "detail-actions";
  const change = title.querySelector(":scope > b");
  if (change) { change.replaceWith(actions); actions.append(change, button); }
  else { actions.append(button); title.append(actions); }
  document.dispatchEvent(new CustomEvent("quant:lookup-rendered"));
});
detailObserver.observe(detail, { childList: true });
})();

