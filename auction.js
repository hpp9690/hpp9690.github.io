(() => {
  const $ = (id) => document.getElementById(id);
  const zone = "Asia/Shanghai";
  const amountFmt = (n) => `${(n / 1e8).toFixed(n >= 1e8 ? 2 : 3)}亿`;
  const mainBoard = (code) => /^(000|001|002|003|600|601|603|605)/.test(code);
  const phaseNow = () => {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(new Date());
    const get = (k) => parts.find((x) => x.type === k)?.value || "";
    const hhmm = Number(get("hour") + get("minute"));
    const weekday = !["Sat", "Sun"].includes(get("weekday"));
    return { active: weekday && hhmm >= 915 && hhmm < 925, early: hhmm < 920, hhmm };
  };
  function signal(s) {
    const pct = +s.f3 || 0, amount = +s.f6 || 0, turnover = +s.f8 || 0, dist = 10 - pct;
    const pctScore = Math.max(0, Math.min(40, pct * 4));
    const amountScore = Math.max(0, Math.min(35, Math.log10(Math.max(amount, 1) / 1e6) * 12));
    const turnoverScore = Math.max(0, Math.min(15, turnover * 3));
    const distanceScore = Math.max(0, 10 - Math.max(0, dist) * 2);
    const score = Math.round(pctScore + amountScore + turnoverScore + distanceScore);
    const tags = [];
    if (pct >= 5) tags.push("竞价偏强");
    if (amount >= 2e7) tags.push("竞价额较高");
    if (turnover >= 1) tags.push("换手活跃");
    if (dist <= 3) tags.push("接近涨停价");
    return { score, dist, tags: tags.join(" · ") || "继续观察" };
  }
  function render(list, phase) {
    const rows = list.map((x) => ({ x, sig: signal(x) })).sort((a, b) => b.sig.score - a.sig.score).slice(0, 50);
    const html = rows.map(({ x, sig }) => `<tr><td class="zt-row-main"><b>${x.f14}</b><small>${x.f12}</small></td><td class="score">${sig.score}</td><td class="${+x.f3 >= 0 ? "up" : "down"}">${(+x.f3 || 0) > 0 ? "+" : ""}${(+x.f3 || 0).toFixed(2)}%</td><td>${amountFmt(+x.f6 || 0)}</td><td>${(+x.f8 || 0).toFixed(2)}%</td><td>${sig.dist.toFixed(2)}%</td><td class="why">${sig.tags}</td></tr>`).join("");
    $("auctionRows").innerHTML = html || `<tr><td colspan="7" class="zt-empty">暂无符合条件的沪深主板候选</td></tr>`;
    $("auctionMobile").innerHTML = rows.map(({ x, sig }) => `<article class="row"><div class="rowtop"><b>${x.f14} <small>${x.f12}</small></b><span class="score">${sig.score} 分</span></div><div class="rowmeta"><span class="${+x.f3 >= 0 ? "up" : "down"}">${(+x.f3 || 0) > 0 ? "+" : ""}${(+x.f3 || 0).toFixed(2)}%</span><span>竞价额 ${amountFmt(+x.f6 || 0)}</span></div><div class="why">换手 ${(+x.f8 || 0).toFixed(2)}% · 距涨停 ${sig.dist.toFixed(2)}% · ${sig.tags}</div></article>`).join("") || `<div class="zt-empty">暂无符合条件的沪深主板候选</div>`;
    $("auctionPhase").textContent = phase.early ? "09:15–09:20：委托仍可撤，竞价涨幅和金额可能失真；先作为观察名单。" : "09:20–09:25：委托不可撤，竞价信号相对更有参考性，但开盘仍可能变化。";
  }
  async function load() {
    const phase = phaseNow();
    if (!phase.active) {
      $("auctionUpdated").textContent = "当前非集合竞价时段";
      $("auctionPhase").textContent = "交易日 09:15–09:25 自动扫描；非竞价时段不把昨日行情冒充为盘前信号。";
      $("auctionRows").innerHTML = `<tr><td colspan="7" class="zt-empty">请在交易日 09:15–09:25 查看盘前竞价候选</td></tr>`;
      $("auctionMobile").innerHTML = `<div class="zt-empty">请在交易日 09:15–09:25 查看盘前竞价候选</div>`;
      return;
    }
    $("auctionUpdated").textContent = "正在扫描全市场";
    try {
      const url = new URL("https://push2.eastmoney.com/api/qt/clist/get");
      url.search = new URLSearchParams({ pn: "1", pz: "2000", po: "1", np: "1", fltt: "2", invt: "2", fid: "f3", fs: "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23", fields: "f2,f3,f6,f8,f10,f12,f14,f17,f18,f124", _: String(Date.now()) });
      const response = await fetch(url, { cache: "no-store" }); if (!response.ok) throw new Error();
      const data = await response.json();
      const list = (data.data?.diff || []).filter((x) => mainBoard(x.f12) && !/ST|退/.test(x.f14) && +x.f3 >= 3 && +x.f3 <= 10.2 && +x.f6 >= 5e6);
      render(list, phase);
      $("auctionUpdated").textContent = `更新 ${new Date().toLocaleTimeString("zh-CN", { timeZone: zone })} · ${list.length} 个观察标的`;
    } catch {
      $("auctionUpdated").textContent = "行情暂不可用";
      $("auctionRows").innerHTML = `<tr><td colspan="7" class="zt-empty">竞价行情接口暂时不可用，请稍后重试</td></tr>`;
    }
  }
  $("auctionRefresh").onclick = load;
  load();
  setInterval(load, 15000);
})();

