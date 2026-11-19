(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const cards = [...document.querySelectorAll(".card")];
  const findCard = (title) => cards.find((card) => card.querySelector("h2")?.textContent.includes(title));
  const sections = [
    { id: "opportunity", label: "机会", primary: true, el: null },
    { id: "anomaly", label: "异动", primary: true, el: null },
    { id: "concept", label: "板块", primary: true, el: null },
    { id: "auction", label: "竞价", primary: true, el: $(".auction") },
    { id: "lookup", label: "查个股", primary: true, el: $(".top-lookup") },
    { id: "heatmap", label: "市场热力图", el: null },
    { id: "limitup", label: "涨停雷达", el: $(".limitup") },
    { id: "review", label: "信号复盘", el: null },
    { id: "watchlist", label: "候选扫描", el: findCard("候选扫描") },
    { id: "notes", label: "研究笔记", el: null },
    { id: "guide", label: "评分逻辑", el: $(".guide") }
  ];

  sections.forEach(({ id, el }) => { if (el) { el.id = id; el.dataset.module = id; } });
  for (const selector of [".toolbar", ".stats"]) {
    const el = $(selector);
    if (el) el.dataset.module = "watchlist";
  }
  const foldDetails = (panel, title, elements) => {
    const content = elements.filter(Boolean);
    if (!content.length) return;
    const disclosure = document.createElement("details");
    disclosure.className = "workspace-detail";
    const summary = document.createElement("summary");
    summary.textContent = title;
    disclosure.append(summary, ...content);
    panel.append(disclosure);
  };
  const auction = $(".auction"), limitup = $(".limitup");
  foldDetails(auction, "竞价复盘与说明", [
    $(".review-head", auction), $(".review-table", auction)?.closest(".tablewrap"),
    $("#reviewMobile", auction), $(".review-note", auction), $(".flow-note", auction)
  ]);
  foldDetails(limitup, "连板估计与说明", [$(".prob-summary", limitup), $(".flow-note", limitup)]);

  const nav = document.createElement("nav");
  nav.className = "quick-nav";
  nav.setAttribute("aria-label", "功能快捷导航");
  const navButton = ({ id, label }) => `<button type="button" data-target="${id}" aria-controls="${id}">${label}</button>`;
  nav.innerHTML = `<div class="quick-nav-inner">
    <div class="quick-links">${sections.filter((item) => item.primary).map(navButton).join("")}</div>
    <div class="workspace-more">
      <button type="button" id="workspaceMore" aria-expanded="false" aria-controls="workspaceMoreItems">更多 <span aria-hidden="true">⌄</span></button>
      <div id="workspaceMoreItems" class="workspace-more-items" hidden>${sections.filter((item) => !item.primary).map(navButton).join("")}</div>
    </div>
    <button type="button" id="workspaceFullscreen" hidden>全屏</button>
  </div>`;
  document.querySelector("header")?.after(nav);

  const validViews = new Set(sections.map((item) => item.id));
  const more = $("#workspaceMore", nav), moreItems = $("#workspaceMoreItems", nav);
  const setMoreOpen = (open) => {
    moreItems.hidden = !open;
    more.setAttribute("aria-expanded", String(open));
  };
  more.addEventListener("click", () => setMoreOpen(moreItems.hidden));
  document.addEventListener("click", (event) => {
    if (!moreItems.hidden && !event.target.closest(".workspace-more")) setMoreOpen(false);
  });
  const scrollBehavior = () => matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  const activateView = (id, { remember = true, scroll = true } = {}) => {
    if (!validViews.has(id)) id = "opportunity";
    document.body.dataset.view = id;
    document.querySelectorAll("[data-module]").forEach((panel) => {
      panel.hidden = panel.dataset.module !== id;
    });
    nav.querySelectorAll("[data-target]").forEach((button) => {
      const active = button.dataset.target === id;
      button.classList.toggle("active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    const current = sections.find((item) => item.id === id);
    more.classList.toggle("active", !current.primary);
    more.setAttribute("aria-label", current.primary ? "更多功能" : `更多功能，当前为${current.label}`);
    setMoreOpen(false);
    if (remember && location.hash !== `#${id}`) history.pushState(null, "", `#${id}`);
    document.dispatchEvent(new CustomEvent("quant:view-changed", { detail: { id } }));
    if (scroll) nav.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
  };
  document.addEventListener("quant:open-view", (event) => activateView(event.detail?.id));

  const desk = document.createElement("section");
  desk.className = "decision-desk";
  desk.setAttribute("aria-label", "行情状态和关注");
  desk.innerHTML = `<div class="desk-status">
    <div class="phase-line"><i id="phaseDot" aria-hidden="true"></i><b id="phaseName">交易时段</b></div>
    <span id="dataHealth">正在读取行情</span>
  </div>
  <div class="desk-watch">
    <button type="button" id="watchToggle" aria-expanded="false">☆ 关注 <span id="watchCount">0</span></button>
    <div class="watch-panel" id="watchPanel" hidden>
      <div class="watch-panel-head"><b>关注清单</b><div><button type="button" id="copyWatch">复制代码</button><button type="button" id="clearWatch">清空</button></div></div>
      <div id="watchItems"></div>
    </div>
  </div>`;
  nav.after(desk);

  const toast = document.createElement("div");
  toast.className = "ui-toast";
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  document.body.append(toast);
  let toastTimer;
  const showToast = (message) => {
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 1800);
  };

  const fullscreenButton = $("#workspaceFullscreen");
  const fullscreenTarget = document.documentElement;
  if (document.fullscreenEnabled && fullscreenTarget.requestFullscreen && document.exitFullscreen) {
    fullscreenButton.hidden = false;
    const updateFullscreenButton = () => {
      fullscreenButton.textContent = document.fullscreenElement === fullscreenTarget ? "退出全屏" : "全屏";
    };
    fullscreenButton.addEventListener("click", async () => {
      fullscreenButton.disabled = true;
      try {
        if (document.fullscreenElement === fullscreenTarget) await document.exitFullscreen();
        else await fullscreenTarget.requestFullscreen();
      } catch {
        showToast("无法进入或退出全屏，请使用浏览器菜单");
      } finally {
        updateFullscreenButton();
        fullscreenButton.disabled = false;
      }
    });
    document.addEventListener("fullscreenchange", updateFullscreenButton);
  }

  const tradingClock = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  });
  const phaseMap = () => {
    const parts = Object.fromEntries(tradingClock.formatToParts(new Date()).map(({ type, value }) => [type, value]));
    const minute = Number(parts.hour) * 60 + Number(parts.minute);
    if (parts.weekday === "Sun" || parts.weekday === "Sat") return ["休市", "closed"];
    if (minute < 9 * 60 + 15) return ["盘前", "prepare"];
    if (minute < 9 * 60 + 25) return ["集合竞价", "live"];
    if (minute < 9 * 60 + 30) return ["开盘前", "confirm"];
    if (minute < 11 * 60 + 30) return ["盘中", "live"];
    if (minute < 13 * 60) return ["午休", "pause"];
    if (minute < 14 * 60 + 57) return ["盘中", "live"];
    if (minute < 15 * 60) return ["收盘竞价", "confirm"];
    return ["已收盘", "closed"];
  };
  const updatePhase = () => {
    const [name, tone] = phaseMap();
    $("#phaseName").textContent = name;
    $("#phaseDot").className = tone;
  };
  updatePhase();
  setInterval(updatePhase, 30000);

  const watchKey = "quantLens.watchlist.v1";
  let watched = [];
  try {
    watched = JSON.parse(localStorage.getItem(watchKey) || "[]").filter((item) => /^\d{6}$/.test(item.code || ""));
  } catch {}
  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const saveWatch = () => {
    try { localStorage.setItem(watchKey, JSON.stringify(watched)); } catch {}
    document.dispatchEvent(new CustomEvent("quant:watchlist-changed"));
  };
  const searchStock = (code) => {
    const input = $("#stockSearch"), form = $("#lookupForm");
    if (!input || !form) return;
    activateView("lookup");
    input.value = code;
    form.requestSubmit();
    showToast(`正在打开 ${code} 个股详情`);
  };
  const renderWatch = () => {
    $("#watchCount").textContent = watched.length;
    $("#watchItems").innerHTML = watched.length ? watched.map((item) => `<div class="watch-item"><button type="button" data-watch-code="${item.code}"><b>${escapeHtml(item.name || item.code)}</b><small>${item.code}</small></button><button type="button" data-remove-watch="${item.code}" aria-label="移除 ${escapeHtml(item.name || item.code)}">×</button></div>`).join("") : `<div class="watch-empty">点击股票旁的 ☆ 加入重点观察</div>`;
    document.querySelectorAll(".watch-star[data-code],.lookup-watch[data-code]").forEach((button) => {
      const active = watched.some((item) => item.code === button.dataset.code);
      button.classList.toggle("active", active);
      const label = button.classList.contains("lookup-watch") ? (active ? "★ 已关注" : "☆ 加入关注") : (active ? "★" : "☆");
      if (button.textContent !== label) button.textContent = label;
      button.setAttribute("aria-pressed", String(active));
    });
  };
  const toggleWatch = (code, name) => {
    const index = watched.findIndex((item) => item.code === code);
    if (index >= 0) {
      watched.splice(index, 1);
      showToast(`已从关注清单移除 ${name || code}`);
    } else {
      watched.unshift({ code, name: name || code });
      watched = watched.slice(0, 30);
      showToast(`已关注 ${name || code}`);
    }
    saveWatch();
    renderWatch();
  };
  document.addEventListener("quant:watch-request", (event) => {
    const { code, name } = event.detail || {};
    if (/^\d{6}$/.test(code || "")) toggleWatch(code, name);
  });
  const identityFrom = (target) => {
    const code = target.querySelector("small")?.textContent.match(/\d{6}/)?.[0] || target.textContent.match(/\b\d{6}\b/)?.[0];
    const rawName = target.querySelector("b")?.childNodes?.[0]?.textContent || "";
    const name = rawName.replace(/^\d+\.\s*/, "").trim();
    return code ? { code, name } : null;
  };
  const decorateRows = () => {
    document.querySelectorAll(".zt-row-main,.stock,.rowtop").forEach((target) => {
      if (target.classList.contains("watch-enhanced")) return;
      const identity = identityFrom(target);
      if (!identity) return;
      target.classList.add("watch-enhanced");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "watch-star";
      button.dataset.code = identity.code;
      button.dataset.name = identity.name;
      button.setAttribute("aria-label", `关注 ${identity.name || identity.code}`);
      target.querySelector("b")?.append(button);
      const row = target.closest("tr,.row");
      if (row && (/追高|高位|风险/.test(row.textContent) || /[1-9]\d*次/.test(row.textContent))) {
        row.classList.add("needs-review");
        row.title = "需复核：含风险提示或炸板记录";
      }
    });
    renderWatch();
  };
  let marketHealth = null, lastCoverage = null;
  const updateDeskMetrics = () => {
    const health = $("#dataHealth");
    if (marketHealth?.state === "ready") lastCoverage = marketHealth;
    const scan = marketHealth?.state === "scanning" && lastCoverage ? lastCoverage : marketHealth;
    const ratio = scan?.total ? scan.scanned / scan.total : 0;
    const active = ["live", "confirm"].includes(phaseMap()[1]);
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
    const stale = scan?.state === "ready" && (scan.date !== today || (active && Date.now() - scan.capturedAt > 180000));
    if (marketHealth?.state === "error") health.textContent = "全市场行情暂不可用";
    else if (scan?.state === "ready") {
      health.textContent = `全市场 ${scan.scanned}/${scan.total}${scan.missingPages ? ` · 缺 ${scan.missingPages} 页` : ""}${stale ? " · 旧快照" : ""}`;
    } else health.textContent = marketHealth?.state === "scanning" ? "全市场扫描中" : "正在读取行情";
    health.className = marketHealth?.state === "error" || stale || (scan?.state === "ready" && ratio < .9) ? "warn" : "";
  };
  document.addEventListener("quant:market-health", (event) => { marketHealth = event.detail; updateDeskMetrics(); });
  setInterval(updateDeskMetrics, 15000);
  const dataRoots = ["auctionRows", "auctionMobile", "ztRows", "ztMobile", "rows", "mobile"].map((id) => document.getElementById(id)).filter(Boolean);
  const rowObserver = new MutationObserver(decorateRows);
  dataRoots.forEach((root) => rowObserver.observe(root, { childList: true, subtree: true, characterData: true }));
  decorateRows();
  updateDeskMetrics();
  document.addEventListener("quant:lookup-rendered", renderWatch);

  const watchToggle = $("#watchToggle"), watchPanel = $("#watchPanel");
  watchToggle.setAttribute("aria-controls", "watchPanel");
  const setWatchOpen = (open) => {
    watchPanel.hidden = !open;
    watchToggle.setAttribute("aria-expanded", String(open));
  };
  watchToggle.addEventListener("click", () => setWatchOpen(watchPanel.hidden));
  document.addEventListener("click", (event) => {
    if (!watchPanel.hidden && !event.target.closest(".desk-watch")) setWatchOpen(false);
  });
  $("#watchItems")?.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-remove-watch]");
    if (remove) return toggleWatch(remove.dataset.removeWatch, watched.find((item) => item.code === remove.dataset.removeWatch)?.name);
    const stock = event.target.closest("[data-watch-code]");
    if (stock) {
      setWatchOpen(false);
      searchStock(stock.dataset.watchCode);
    }
  });
  $("#copyWatch")?.addEventListener("click", async () => {
    if (!watched.length) return showToast("关注清单还是空的");
    try { await navigator.clipboard.writeText(watched.map((item) => item.code).join(",")); showToast("股票代码已复制"); }
    catch { showToast("浏览器未允许复制，请手动选择"); }
  });
  $("#clearWatch")?.addEventListener("click", () => { watched = []; saveWatch(); renderWatch(); showToast("关注清单已清空"); });

  nav.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-target]");
    if (!button) return;
    const id = button.dataset.target;
    const fromMore = moreItems.contains(button);
    activateView(id);
    if (id === "lookup") $("#stockSearch")?.focus({ preventScroll: true });
    else if (fromMore) more.focus({ preventScroll: true });
  });

  $("#refreshAll")?.addEventListener("click", () => {
    ["refresh", "auctionRefresh", "ztRefresh", "reviewRefresh"].forEach((id) => document.getElementById(id)?.click());
    document.dispatchEvent(new Event("quant:refresh-market"));
    showToast("行情与候选正在刷新");
  });

  document.addEventListener("click", (event) => {
    const refresh = event.target.closest("#refreshAll,#refresh,#auctionRefresh,#ztRefresh,#reviewRefresh");
    if (refresh) {
      refresh.classList.add("is-refreshing");
      setTimeout(() => refresh.classList.remove("is-refreshing"), 1200);
    }
    const star = event.target.closest(".watch-star,.lookup-watch");
    if (star) {
      toggleWatch(star.dataset.code, star.dataset.name);
      return;
    }
    if (event.target.closest("a,button,input,select")) return;
    const stockTarget = event.target.closest(".zt-row-main,.rowtop,.stock");
    if (!stockTarget) return;
    const code = stockTarget.textContent.match(/\b\d{6}\b/)?.[0];
    const input = $("#stockSearch"), form = $("#lookupForm");
    if (!code || !input || !form) return;
    activateView("lookup");
    input.value = code;
    form.requestSubmit();
    showToast(`正在打开 ${code} 个股详情`);
  });

  addEventListener("keydown", (event) => {
    if (event.defaultPrevented || $("dialog[open]")) return;
    const editing = document.activeElement?.matches("input, textarea, select, [contenteditable]");
    if (event.key === "/" && !editing && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      activateView("lookup");
      $("#stockSearch")?.focus();
    }
    if (event.key === "Escape" && !moreItems.hidden) {
      setMoreOpen(false);
      more.focus();
    } else if (event.key === "Escape" && !watchPanel.hidden) {
      setWatchOpen(false);
      watchToggle.focus();
    }
  });
  const viewFromHash = () => location.hash.slice(1);
  activateView(validViews.has(viewFromHash()) ? viewFromHash() : "opportunity", { remember: false, scroll: false });
  if (validViews.has(viewFromHash())) requestAnimationFrame(() => document.getElementById(viewFromHash())?.scrollIntoView({ block: "start" }));
  addEventListener("popstate", () => activateView(viewFromHash(), { remember: false }));
  addEventListener("hashchange", () => activateView(viewFromHash(), { remember: false }));
})();

