(() => {
  const $ = (id) => document.getElementById(id);
  const state = { pool: "zt", rows: [], filter: "all", sort: "board" };
  const compact = (n) => new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(Number(n) || 0);
  const time = (n) => { const s = String(n || "").padStart(6, "0"); return `${s.slice(0, 2)}:${s.slice(2, 4)}:${s.slice(4)}`; };
  const clue = (x) => { const link = `https://so.eastmoney.com/news/s?keyword=${encodeURIComponent(`${x.n} ${x.c} 涨停`)}`; const tag = x.hybk || "行业待补"; const boards = x.zttj?.days ? ` · ${x.zttj.days}天${x.zttj.ct}板` : ""; return `<span>${tag}${boards}</span> <a class="reason-link" href="${link}" target="_blank" rel="noopener">查资讯 ↗</a>`; };
  function render() {
    let rows = [...state.rows];
    if (state.pool === "zt" && state.filter === "first") rows = rows.filter((x) => +x.lbc === 1);
    if (state.pool === "zt" && state.filter === "multi") rows = rows.filter((x) => +x.lbc > 1);
    rows.sort((a, b) => state.sort === "fund" ? (+b.fund || 0) - (+a.fund || 0) : state.sort === "time" ? (+a.fbt || 0) - (+b.fbt || 0) : (+b.lbc || 0) - (+a.lbc || 0));
    const broken = state.pool === "zb";
    const pct = (x) => +x.zdp || 0;
    const label = (x) => broken ? `${x.zbc ?? 0} 次炸板` : `${x.lbc || 1} 连板`;
    $("ztBoardHeading").textContent = broken ? "炸板次数" : "连板";
    const rowHtml = rows.map((x) => `<tr><td class="zt-row-main"><b>${x.n}</b><small>${x.c}</small></td><td><b>${label(x)}</b><small>${x.zttj?.days ? `${x.zttj.days}天${x.zttj.ct}板` : ""}</small></td><td class="${pct(x) >= 0 ? "up" : "down"}">${pct(x) > 0 ? "+" : ""}${pct(x).toFixed(2)}%</td><td>${time(x.fbt)}</td><td>${broken ? "—" : compact(x.fund)}</td><td>${x.zbc ?? "—"}次</td><td>${x.hybk || "—"}</td><td>${compact(x.amount)}</td><td class="cause">${clue(x)}</td></tr>`).join("");
    $("ztRows").innerHTML = rowHtml || `<tr><td colspan="9" class="zt-empty">${state.rows.length ? "当前筛选无股票" : broken ? "今日暂无炸板股" : "今日涨停池为空或数据暂不可用"}</td></tr>`;
    $("ztMobile").innerHTML = rows.map((x) => `<article class="row"><div class="rowtop"><b>${x.n} <small>${x.c}</small></b><span class="${pct(x) >= 0 ? "up" : "down"}">${pct(x) > 0 ? "+" : ""}${pct(x).toFixed(2)}%</span></div><div class="rowmeta"><span><b>${label(x)}</b></span><span>触板 ${time(x.fbt)}</span><span>${broken ? "" : `封单 ${compact(x.fund)}`}</span></div><div class="why">${clue(x)} · 成交额 ${compact(x.amount)}</div></article>`).join("") || `<div class="zt-empty">${broken ? "今日暂无炸板股" : "今日涨停池为空"}</div>`;
  }
  async function load() {
    const d = new Date(), ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    const label = state.pool === "zt" ? "涨停池" : "炸板池";
    $("ztStatus").textContent = `正在读取 ${ymd} ${label}…`;
    try {
      const url = new URL(`https://push2ex.eastmoney.com/${state.pool === "zt" ? "getTopicZTPool" : "getTopicZBPool"}`);
      url.search = new URLSearchParams({ ut: "7eea3edcaed734bea9cbfc24409ed989", dpt: "wz.ztzt", Pageindex: "0", pagesize: "200", sort: "fbt:asc", date: ymd, _: String(Date.now()) });
      const response = await fetch(url); if (!response.ok) throw new Error();
      const json = await response.json(); if (json.rc !== 0) throw new Error();
      state.rows = json.data?.pool || [];
      $("ztStatus").textContent = state.rows.length ? `${json.data.qdate || ymd} · ${label} ${state.rows.length} 只 · 盘中数据` : `今日暂无${label}（非交易时段或尚未开盘）`;
      $("ztUpdated").textContent = `更新于 ${new Date().toLocaleTimeString("zh-CN")}`;
    } catch { state.rows = []; $("ztStatus").textContent = `${label}暂时无法连接，请稍后刷新`; }
    render();
  }
  document.querySelectorAll("[data-pool]").forEach((button) => button.onclick = () => {
    state.pool = button.dataset.pool; state.filter = "all";
    document.querySelectorAll("[data-pool]").forEach((x) => x.classList.toggle("active", x === button));
    document.querySelectorAll("[data-zt]").forEach((x) => x.classList.toggle("active", x.dataset.zt === "all"));
    $("ztFilters").style.opacity = state.pool === "zt" ? "1" : ".45";
    $("ztFilters").style.pointerEvents = state.pool === "zt" ? "auto" : "none";
    load();
  });
  document.querySelectorAll("[data-zt]").forEach((button) => button.onclick = () => { state.filter = button.dataset.zt; document.querySelectorAll("[data-zt]").forEach((x) => x.classList.toggle("active", x === button)); render(); });
  $("ztSort").onchange = (event) => { state.sort = event.target.value; render(); };
  $("ztRefresh").onclick = load; load(); setInterval(load, 60000);
})();

