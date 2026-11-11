(()=>{
const $=id=>document.getElementById(id), input=$("stockSearch"), box=$("suggestions"), detail=$("stockDetail");
let timer, suggestionRequest;
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
    load(query, /^(5|6|9)/.test(query) ? "1" : "0");
  } else suggest(query);
});
async function load(code,market){detail.innerHTML="<p class='muted'>正在读取个股数据…</p>";const secid=`${market}.${code}`,base="https://push2.eastmoney.com/api/qt/stock/";try{const [quote,flow,kline]=await Promise.all([get(`${base}get`,{secid,fields:"f43,f44,f45,f46,f47,f48,f57,f58,f60,f169,f170,f168,f162,f167,f116,f117,f171",fltt:2,invt:2}),get(`${base}fflow/kline/get`,{secid,lmt:1,klt:101,fields1:"f1,f2,f3,f7",fields2:"f51,f52,f53,f54,f55,f56,f57,f58"}),get("https://push2his.eastmoney.com/api/qt/stock/kline/get",{secid,klt:101,fqt:1,lmt:30,fields1:"f1,f2,f3,f4,f5,f6",fields2:"f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61"})]);if(!quote?.data)throw Error("未找到股票或暂时无行情");const d=quote.data,flowLine=flow?.data?.klines?.at(-1)?.split(",")||[],bars=(kline?.data?.klines||[]).map(x=>x.split(",").map(Number)),closes=bars.map(x=>x[2]).filter(Number.isFinite),ma=n=>closes.length>=n?closes.slice(-n).reduce((a,b)=>a+b,0)/n:null,net=flowLine.slice(1).map(Number),netMain=net.length?net[0]:null;detail.innerHTML=`<div class="detail-title"><div><h3>${d.f58} <small>${d.f57}</small></h3><span class="muted">东方财富行情 · ${d.f86||"更新时间以数据源为准"}</span></div><b class="${+d.f170>=0?"up":"down"}">${signed(num(d.f170))}</b></div><div class="metrics"><div><small>最新价</small><b>${num(d.f43)?.toFixed(2)??"—"}</b></div><div><small>成交额</small><b>${money(num(d.f48))}</b></div><div><small>换手率</small><b>${num(d.f168)?.toFixed(2)??"—"}%</b></div><div><small>市值</small><b>${money(num(d.f116))}</b></div><div><small>市盈率</small><b>${num(d.f162)?.toFixed(2)??"—"}</b></div><div><small>市净率</small><b>${num(d.f167)?.toFixed(2)??"—"}</b></div><div><small>主力净流入</small><b class="${netMain>=0?"up":"down"}">${netMain==null?"—":money(netMain)}</b></div><div><small>近${closes.length}日均线</small><b>${ma(5)==null?"—":`MA5 ${ma(5).toFixed(2)}`} ${ma(20)==null?"":`/ MA20 ${ma(20).toFixed(2)}`}</b></div></div><p class="flow-note">资金流取自东方财富日频资金流向最近记录；净流入是按其大单分类口径统计，不代表全部资金或后续走势。均线根据最近${closes.length}个日K线收盘价计算。</p>`}catch(err){detail.innerHTML=`<p class="error">${err.message||"数据读取失败"}。请确认代码正确，或稍后重试。</p>`}}
async function get(base,params){const u=new URL(base);u.search=new URLSearchParams({...params,ut:"fa5fd1943c7b386f172d6893dbbd1d0c",_:`${Date.now()}`});const r=await fetch(u);if(!r.ok)throw Error(`行情接口返回 ${r.status}`);return r.json()}
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

