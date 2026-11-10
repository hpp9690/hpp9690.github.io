(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const cards = [...document.querySelectorAll(".card")];
  const findCard = (title) => cards.find((card) => card.querySelector("h2")?.textContent.includes(title));
  const sections = [
    { id: "anomaly", label: "异动捕捉", el: null },
    { id: "lookup", label: "个股查询", el: $(".top-lookup") },
    { id: "auction", label: "竞价候选", el: $(".auction") },
    { id: "limitup", label: "涨停雷达", el: $(".limitup") },
    { id: "watchlist", label: "候选扫描", el: findCard("候选扫描") },
    { id: "guide", label: "评分逻辑", el: $(".guide") }
  ];

  sections.forEach(({ id, el }) => { if (el) { el.id = id; el.dataset.module = id; } });
  for (const selector of [".notice", ".toolbar", ".stats"]) {
    const el = $(selector);
    if (el) el.dataset.module = "watchlist";
  }

  const nav = document.createElement("nav");
  nav.className = "quick-nav";
  nav.setAttribute("aria-label", "功能快捷导航");
  nav.innerHTML = `<div class="quick-nav-inner"><div class="quick-links">${sections.map(({ id, label }) => `<button type="button" data-target="${id}" aria-controls="${id}">${label}</button>`).join("")}</div><div class="quick-actions"><button type="button" id="refreshAll">全部刷新</button><button type="button" id="focusMode" aria-pressed="false">精简模式</button></div></div>`;
  document.querySelector("header")?.after(nav);

  const validViews = new Set(sections.map((item) => item.id));
  const activateView = (id, { remember = true, scroll = true } = {}) => {
    if (!validViews.has(id)) id = "anomaly";
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
    const selected = document.getElementById(id);
    if (selected?.classList.contains("is-collapsed")) selected.querySelector(".section-toggle")?.click();
    if (remember && location.hash !== `#${id}`) history.pushState(null, "", `#${id}`);
    if (scroll) nav.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  document.addEventListener("quant:open-view", (event) => activateView(event.detail?.id));

  const desk = document.createElement("section");
  desk.className = "decision-desk";
  desk.setAttribute("aria-label", "今日决策工作台");
  desk.innerHTML = `<div class="desk-phase"><p class="eyebrow">TODAY'S TRADING DESK</p><div class="phase-line"><i id="phaseDot"></i><div><b id="phaseName">判断交易阶段</b><small id="phaseHint">根据当前时间给出操作顺序</small></div></div></div><div class="desk-center"><div class="desk-metrics"><span id="visibleSummary">候选载入中</span><span id="dataHealth">检查数据源</span></div><div class="workflow-actions" aria-label="快捷场景"><button type="button" data-workflow="auction">竞价强势</button><button type="button" data-workflow="first">首板机会</button><button type="button" data-workflow="multi">连板接力</button><button type="button" data-workflow="broken">炸板风险</button><button type="button" data-workflow="liquid">高流动性</button></div></div><div class="desk-watch"><button type="button" id="watchToggle" aria-expanded="false">★ 关注清单 <span id="watchCount">0</span></button><div class="watch-panel" id="watchPanel" hidden><div class="watch-panel-head"><b>重点观察</b><div><button type="button" id="copyWatch">复制代码</button><button type="button" id="clearWatch">清空</button></div></div><div id="watchItems"></div><p>星标仅保存在当前浏览器，不会自动交易。</p></div></div>`;
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

  const phaseMap = () => {
    const now = new Date(), day = now.getDay(), minute = now.getHours() * 60 + now.getMinutes();
    if (day === 0 || day === 6) return ["休市复盘", "整理关注清单，复核信号与风险", "closed"];
    if (minute < 9 * 60 + 15) return ["盘前准备", "先看竞价候选与昨日复盘，不把昨日行情当今日信号", "prepare"];
    if (minute < 9 * 60 + 25) return ["集合竞价", "重点看涨幅、成交额与撤单变化，09:20 前挂单可撤", "live"];
    if (minute < 9 * 60 + 30) return ["竞价确认", "保留候选，等待开盘承接，不抢最后一分钟信号", "confirm"];
    if (minute < 11 * 60 + 30) return ["盘中跟踪", "比较开盘承接、封板强度和炸板次数", "live"];
    if (minute < 13 * 60) return ["午间复核", "缩小候选池，复核上午风险信号", "pause"];
    if (minute < 15 * 60) return ["盘中跟踪", "关注回封、量能和市场情绪变化", "live"];
    return ["收盘复盘", "记录候选表现，为下一交易日准备观察清单", "closed"];
  };
  const updatePhase = () => {
    const [name, hint, tone] = phaseMap();
    $("#phaseName").textContent = name;
    $("#phaseHint").textContent = hint;
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
  const countRows = (selector) => [...document.querySelectorAll(selector)].filter((row) => !/暂无|等待|当前筛选|行情暂/.test(row.textContent)).length;
  const updateDeskMetrics = () => {
    const auctionCount = countRows("#auctionRows tr"), ztCount = countRows("#ztRows tr"), candidateCount = countRows("#rows tr");
    $("#visibleSummary").textContent = `竞价 ${auctionCount} · 涨停 ${ztCount} · 候选 ${candidateCount}`;
    const statuses = ["auctionUpdated", "ztUpdated", "updated"].map((id) => document.getElementById(id)?.textContent || "");
    const failed = statuses.filter((text) => /失败|不可用|超时|返回为空/.test(text)).length;
    const ready = statuses.filter((text) => /更新(?:于|\s)|竞价|开盘|复盘|盘中/.test(text)).length;
    const health = $("#dataHealth");
    health.textContent = failed ? `${failed} 个模块需重试` : ready ? `${ready}/3 数据模块有响应` : "数据载入中";
    health.className = failed ? "warn" : ready ? "ok" : "";
  };
  const dataRoots = ["auctionRows", "auctionMobile", "ztRows", "ztMobile", "rows", "mobile", "auctionUpdated", "ztUpdated", "updated", "error"].map((id) => document.getElementById(id)).filter(Boolean);
  const rowObserver = new MutationObserver(() => { decorateRows(); updateDeskMetrics(); });
  dataRoots.forEach((root) => rowObserver.observe(root, { childList: true, subtree: true, characterData: true }));
  decorateRows();
  updateDeskMetrics();
  document.addEventListener("quant:lookup-rendered", renderWatch);

  $("#watchToggle")?.addEventListener("click", () => {
    const panel = $("#watchPanel"), open = panel.hidden;
    panel.hidden = !open;
    $("#watchToggle").setAttribute("aria-expanded", String(open));
  });
  $("#watchItems")?.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-remove-watch]");
    if (remove) return toggleWatch(remove.dataset.removeWatch, watched.find((item) => item.code === remove.dataset.removeWatch)?.name);
    const stock = event.target.closest("[data-watch-code]");
    if (stock) searchStock(stock.dataset.watchCode);
  });
  $("#copyWatch")?.addEventListener("click", async () => {
    if (!watched.length) return showToast("关注清单还是空的");
    try { await navigator.clipboard.writeText(watched.map((item) => item.code).join(",")); showToast("股票代码已复制"); }
    catch { showToast("浏览器未允许复制，请手动选择"); }
  });
  $("#clearWatch")?.addEventListener("click", () => { watched = []; saveWatch(); renderWatch(); showToast("关注清单已清空"); });

  desk.addEventListener("click", (event) => {
    const action = event.target.closest("[data-workflow]");
    if (!action) return;
    const workflow = action.dataset.workflow;
    if (workflow === "auction") activateView("auction");
    if (workflow === "first" || workflow === "multi" || workflow === "broken") {
      activateView("limitup");
      document.querySelector(`[data-pool="${workflow === "broken" ? "zb" : "zt"}"]`)?.click();
      if (workflow !== "broken") document.querySelector(`[data-zt="${workflow}"]`)?.click();
    }
    if (workflow === "liquid") {
      activateView("watchlist");
      const amount = $("#amount");
      if (amount) { amount.value = "500000000"; amount.dispatchEvent(new Event("change", { bubbles: true })); }
      document.querySelector('[data-preset="defensive"]')?.click();
    }
    action.classList.add("selected");
    setTimeout(() => action.classList.remove("selected"), 1200);
  });

  nav.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-target]");
    if (!button) return;
    activateView(button.dataset.target);
  });

  const collapseKey = "quantLens.collapsedModules.v1";
  let collapsed = [];
  try { collapsed = JSON.parse(localStorage.getItem(collapseKey) || "[]"); } catch {}
  sections.filter(({ id, el }) => id !== "lookup" && el?.querySelector(".cardhead")).forEach(({ id, el }) => {
    const head = el.querySelector(".cardhead");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "section-toggle";
    button.setAttribute("aria-label", "折叠或展开此模块");
    const setState = (isCollapsed) => {
      el.classList.toggle("is-collapsed", isCollapsed);
      button.textContent = isCollapsed ? "展开" : "收起";
      button.setAttribute("aria-expanded", String(!isCollapsed));
    };
    setState(collapsed.includes(id));
    button.addEventListener("click", () => {
      setState(!el.classList.contains("is-collapsed"));
      collapsed = sections.filter((item) => item.el?.classList.contains("is-collapsed")).map((item) => item.id);
      try { localStorage.setItem(collapseKey, JSON.stringify(collapsed)); } catch {}
    });
    head.append(button);
  });

  const focusButton = $("#focusMode");
  let focusMode = localStorage.getItem("quantLens.focusMode") === "1";
  const applyFocusMode = () => {
    document.body.classList.toggle("focus-mode", focusMode);
    focusButton.textContent = focusMode ? "完整模式" : "精简模式";
    focusButton.setAttribute("aria-pressed", String(focusMode));
  };
  applyFocusMode();
  focusButton.addEventListener("click", () => {
    focusMode = !focusMode;
    try { localStorage.setItem("quantLens.focusMode", focusMode ? "1" : "0"); } catch {}
    applyFocusMode();
    showToast(focusMode ? "已进入精简模式" : "已恢复完整模式");
  });

  $("#refreshAll")?.addEventListener("click", () => {
    ["refresh", "auctionRefresh", "ztRefresh", "reviewRefresh"].forEach((id) => document.getElementById(id)?.click());
    showToast("行情与候选正在刷新");
  });

  document.addEventListener("click", (event) => {
    const refresh = event.target.closest("#refresh,#auctionRefresh,#ztRefresh,#reviewRefresh");
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

  const dock = document.createElement("div");
  dock.className = "floating-tools";
  dock.innerHTML = `<button type="button" id="quickSearch" aria-label="搜索股票">⌕</button><button type="button" id="backTop" aria-label="返回顶部">↑</button>`;
  document.body.append(dock);
  $("#quickSearch")?.addEventListener("click", () => {
    activateView("lookup");
    setTimeout(() => $("#stockSearch")?.focus(), 350);
  });
  $("#backTop")?.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));

  let scrollQueued = false;
  const updateScroll = () => {
    dock.classList.toggle("visible", scrollY > 500);
    scrollQueued = false;
  };
  addEventListener("scroll", () => {
    if (!scrollQueued) { scrollQueued = true; requestAnimationFrame(updateScroll); }
  }, { passive: true });
  updateScroll();

  addEventListener("keydown", (event) => {
    if (event.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "")) {
      event.preventDefault();
      activateView("lookup");
      $("#stockSearch")?.focus();
    }
    if (event.key === "Escape") {
      const suggestions = $("#suggestions");
      if (suggestions) suggestions.hidden = true;
      document.activeElement?.blur?.();
    }
  });
  const viewFromHash = () => location.hash.slice(1);
  activateView(validViews.has(viewFromHash()) ? viewFromHash() : "anomaly", { remember: false, scroll: false });
  addEventListener("popstate", () => activateView(viewFromHash(), { remember: false }));
  addEventListener("hashchange", () => activateView(viewFromHash(), { remember: false }));
})();

