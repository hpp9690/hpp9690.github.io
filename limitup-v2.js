(() => {
  const $ = (id) => document.getElementById(id);
  const state = { pool: "zt", rows: [], ztRows: [], zbRows: [], filter: "all", sort: "board", poolCount: 0, brokenCount: 0 };
  const compact = (n) => new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(Number(n) || 0);
  const time = (n) => { const s = String(n || "").padStart(6, "0"); return `${s.slice(0, 2)}:${s.slice(2, 4)}:${s.slice(4)}`; };
  const pct = (x) => +x.zdp || 0;
  const mainBoard = (code) => /^(000|001|002|003|600|601|603|605)/.test(String(code || ""));
  const estimate = (x) => window.ContinuationModel?.estimate(x, { rows: state.ztRows, poolCount: state.poolCount, brokenCount: state.brokenCount });
  const probCell = (x) => {
    const p = estimate(x);
    return p ? `<button class="prob-button prob-open" data-code="${x.c}" aria-label="查看${x.n}次日连板概率拆解">${(p.probability * 100).toFixed(0)}%<small>约${Math.round(p.effectiveN)}个同类权重样本</small></button>` : `<span class="prob-unavailable">${mainBoard(x.c) ? "计算中" : "非主板样本"}</span>`;
  };
  const clue = (x) => { const link = `https://so.eastmoney.com/news/s?keyword=${encodeURIComponent(`${x.n} ${x.c} 涨停`)}`; const tag = x.hybk || "行业待补"; const boards = x.zttj?.days ? ` · ${x.zttj.days}天${x.zttj.ct}板` : ""; return `<span>${tag}${boards}</span> <a class="reason-link" href="${link}" target="_blank" rel="noopener">查资讯 ↗</a>`; };
  function renderSummary() {
    const s = window.ContinuationModel?.summary();
    if (!s?.ready) return;
    const rate = (100 * s.base).toFixed(1);
    $("probSummaryStats").textContent = `近14个可用交易日：${rate}%（${s.wins}/${s.events} 个主板涨停样本次日再涨停）`;
  }
  function render() {
    let rows = [...state.rows];
    if (state.pool === "zt" && state.filter === "first") rows = rows.filter((x) => +x.lbc === 1);
    if (state.pool === "zt" && state.filter === "multi") rows = rows.filter((x) => +x.lbc > 1);
    rows.sort((a, b) => {
      if (state.sort === "fund") return (+b.fund || 0) - (+a.fund || 0);
      if (state.sort === "time") return (+a.fbt || 0) - (+b.fbt || 0);
      if (state.sort === "prob") return (estimate(b)?.probability ?? -1) - (estimate(a)?.probability ?? -1);
      return (+b.lbc || 0) - (+a.lbc || 0);
    });
    const broken = state.pool === "zb";
    const label = (x) => broken ? `${x.zbc ?? 0} 次炸板` : `${x.lbc || 1} 连板`;
    $("ztBoardHeading").textContent = broken ? "炸板次数" : "连板";
    const rowHtml = rows.map((x) => `<tr><td class="zt-row-main"><b>${x.n}</b><small>${x.c}</small></td><td><b>${label(x)}</b><small>${x.zttj?.days ? `${x.zttj.days}天${x.zttj.ct}板` : ""}</small></td><td>${broken ? "—" : probCell(x)}</td><td class="${pct(x) >= 0 ? "up" : "down"}">${pct(x) > 0 ? "+" : ""}${pct(x).toFixed(2)}%</td><td>${time(x.fbt)}</td><td>${broken ? "—" : compact(x.fund)}</td><td>${x.zbc ?? "—"}次</td><td>${x.hybk || "—"}</td><td>${compact(x.amount)}</td><td class="cause">${clue(x)}</td></tr>`).join("");
    $("ztRows").innerHTML = rowHtml || `<tr><td colspan="10" class="zt-empty">${state.rows.length ? "当前筛选无股票" : broken ? "今日暂无炸板股" : "今日涨停池为空或数据暂不可用"}</td></tr>`;
    $("ztMobile").innerHTML = rows.map((x) => {
      const p = broken ? null : estimate(x);
      const prob = p ? `<button class="prob-button prob-open" data-code="${x.c}">${(p.probability * 100).toFixed(0)}%<small>次日再涨停估计</small></button>` : broken ? "" : `<span class="prob-unavailable">${mainBoard(x.c) ? "概率计算中" : "非主板样本"}</span>`;
      return `<article class="row"><div class="rowtop"><b>${x.n} <small>${x.c}</small></b><span class="${pct(x) >= 0 ? "up" : "down"}">${pct(x) > 0 ? "+" : ""}${pct(x).toFixed(2)}%</span></div><div class="rowmeta"><span><b>${label(x)}</b></span><span>触板 ${time(x.fbt)}</span><span>${broken ? "" : `封单 ${compact(x.fund)}`}</span></div>${prob}<div class="why">${clue(x)} · 成交额 ${compact(x.amount)}</div></article>`;
    }).join("") || `<div class="zt-empty">${broken ? "今日暂无炸板股" : "今日涨停池为空"}</div>`;
    renderSummary();
  }
  function explain(code) {
    const x = state.ztRows.find((s) => s.c === code), p = x && estimate(x);
    if (!x || !p) return;
    $("probDialogTitle").textContent = `${x.n}（${x.c}）次日连板估计`;
    const factorHtml = p.factors.map((f) => `<article class="prob-factor"><b>${f.name}</b><span>${f.bucket} · 同组 ${f.wins}/${f.n} 次次日再涨停 <em>${(f.rate * 100).toFixed(1)}%</em></span><span>${f.versus >= 0 ? "高于" : "低于"}总体样本 ${(Math.abs(f.versus) * 100).toFixed(1)} 个百分点</span></article>`).join("");
    const research = `https://so.eastmoney.com/news/s?keyword=${encodeURIComponent(`${x.n} ${x.c} 涨停`)}`;
    $("probDetail").innerHTML = `<div class="prob-main-estimate"><strong>${(p.probability * 100).toFixed(1)}%</strong><span>相似历史案例估计<br>粗略80%参考区间 ${(p.low * 100).toFixed(1)}%–${(p.high * 100).toFixed(1)}%</span></div><div class="prob-detail-note">与本股特征接近的历史样本加权频率 ${(p.similarRate * 100).toFixed(1)}%；有效样本量约 ${Math.round(p.effectiveN)}，直接匹配 ${p.similarN} 个。总体基准 ${(p.base * 100).toFixed(1)}%（${p.wins}/${p.events}）。样本日期 ${p.start.slice(0,4)}-${p.start.slice(4,6)}-${p.start.slice(6)} 至 ${p.end.slice(0,4)}-${p.end.slice(4,6)}-${p.end.slice(6)}。</div><div class="prob-factors">${factorHtml}</div><div class="prob-detail-note"><b>消息与题材：</b>${x.hybk || "行业标签缺失"}。公开接口没有可靠结构化的个股公告/催化强度字段，因此不纳入估计；<a class="reason-link" href="${research}" target="_blank" rel="noopener">查看相关资讯 ↗</a><br><b>市场情绪：</b>当前涨停池 ${state.poolCount} 只、炸板池 ${state.brokenCount} 只；行业共振、封板时间、炸板次数、连板高度、换手及封单占流通市值已纳入相似样本分组。模型用近14个交易日短窗样本，市场状态变化和稀有情形会造成较大误差。该估计不是买入建议，也不代表次日收益。</div>`;
    $("probDialog").showModal();
  }
  async function fetchDay(type, ymd) {
    const url = new URL(`https://push2ex.eastmoney.com/getTopic${type}Pool`);
    url.search = new URLSearchParams({ ut: "7eea3edcaed734bea9cbfc24409ed989", dpt: "wz.ztzt", Pageindex: "0", pagesize: "200", sort: "fbt:asc", date: ymd, _: String(Date.now()) });
    const r = await fetch(url); if (!r.ok) throw new Error();
    const j = await r.json(); if (j.rc !== 0) throw new Error(); return j;
  }
  async function load() {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const get = (k) => parts.find((x) => x.type === k)?.value || "";
    const ymd = `${get("year")}${get("month")}${get("day")}`;
    const label = state.pool === "zt" ? "涨停池" : "炸板池";
    $("ztStatus").textContent = `正在读取 ${ymd} ${label}…`;
    try {
      const [zt, zb] = await Promise.all([fetchDay("ZT", ymd), fetchDay("ZB", ymd)]);
      state.ztRows = zt.data?.pool || []; state.zbRows = zb.data?.pool || [];
      state.poolCount = Number(zt.data?.tc) || state.ztRows.length;
      state.brokenCount = Number(zb.data?.tc) || state.zbRows.length;
      state.rows = state.pool === "zt" ? state.ztRows : state.zbRows;
      $("ztStatus").textContent = state.rows.length ? `${ymd} · ${label} ${state.rows.length} 只 · 盘中数据` : `今日暂无${label}（非交易时段或尚未开盘）`;
      $("ztUpdated").textContent = `更新于 ${new Date().toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai" })}`;
      document.dispatchEvent(new CustomEvent("quant:board-snapshot", { detail: {
        date: ymd, capturedAt: Date.now(),
        sealed: state.ztRows.map((x) => ({ code: x.c, name: x.n, boards: +x.lbc || 1, breaks: +x.zbc || 0 })),
        broken: state.zbRows.map((x) => ({ code: x.c, name: x.n, breaks: +x.zbc || 0 }))
      } }));
    } catch { state.rows = []; state.ztRows = []; state.zbRows = []; $("ztStatus").textContent = `${label}暂时无法连接，请稍后刷新`; }
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
  $("ztRefresh").onclick = load;
  $("probClose").onclick = () => $("probDialog").close();
  document.addEventListener("click", (event) => { const button = event.target.closest(".prob-open"); if (button) explain(button.dataset.code); });
  document.addEventListener("continuation-ready", render);
  load(); setInterval(load, 60000);
})();

