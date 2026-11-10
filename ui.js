(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const cards = [...document.querySelectorAll(".card")];
  const findCard = (title) => cards.find((card) => card.querySelector("h2")?.textContent.includes(title));
  const sections = [
    { id: "lookup", label: "个股查询", el: $(".top-lookup") },
    { id: "auction", label: "竞价候选", el: $(".auction") },
    { id: "limitup", label: "涨停雷达", el: $(".limitup") },
    { id: "watchlist", label: "候选扫描", el: findCard("候选扫描") },
    { id: "guide", label: "评分逻辑", el: $(".guide") }
  ].filter((item) => item.el);

  sections.forEach(({ id, el }) => { el.id = id; el.dataset.module = id; });

  const nav = document.createElement("nav");
  nav.className = "quick-nav";
  nav.setAttribute("aria-label", "功能快捷导航");
  nav.innerHTML = `<div class="scroll-progress" aria-hidden="true"><i></i></div><div class="quick-nav-inner"><div class="quick-links">${sections.map(({ id, label }) => `<button type="button" data-target="${id}">${label}</button>`).join("")}</div><div class="quick-actions"><button type="button" id="refreshAll">全部刷新</button><button type="button" id="focusMode" aria-pressed="false">精简模式</button></div></div>`;
  document.querySelector("header")?.after(nav);

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

  nav.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-target]");
    if (!button) return;
    const target = document.getElementById(button.dataset.target);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  const collapseKey = "quantLens.collapsedModules.v1";
  let collapsed = [];
  try { collapsed = JSON.parse(localStorage.getItem(collapseKey) || "[]"); } catch {}
  sections.filter(({ id, el }) => id !== "lookup" && el.querySelector(".cardhead")).forEach(({ id, el }) => {
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
      collapsed = sections.filter((item) => item.el.classList.contains("is-collapsed")).map((item) => item.id);
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
    if (event.target.closest("a,button,input,select")) return;
    const stockTarget = event.target.closest(".zt-row-main,.rowtop,.stock");
    if (!stockTarget) return;
    const code = stockTarget.textContent.match(/\b\d{6}\b/)?.[0];
    const input = $("#stockSearch"), form = $("#lookupForm");
    if (!code || !input || !form) return;
    input.value = code;
    document.getElementById("lookup")?.scrollIntoView({ behavior: "smooth", block: "start" });
    form.requestSubmit();
    showToast(`正在打开 ${code} 个股详情`);
  });

  const dock = document.createElement("div");
  dock.className = "floating-tools";
  dock.innerHTML = `<button type="button" id="quickSearch" aria-label="搜索股票">⌕</button><button type="button" id="backTop" aria-label="返回顶部">↑</button>`;
  document.body.append(dock);
  $("#quickSearch")?.addEventListener("click", () => {
    document.getElementById("lookup")?.scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(() => $("#stockSearch")?.focus(), 350);
  });
  $("#backTop")?.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));

  const linkButtons = [...nav.querySelectorAll("button[data-target]")];
  const observer = new IntersectionObserver((entries) => {
    const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!visible) return;
    linkButtons.forEach((button) => button.classList.toggle("active", button.dataset.target === visible.target.id));
  }, { rootMargin: "-24% 0px -64%", threshold: [0, 0.15, 0.4] });
  sections.forEach(({ el }) => observer.observe(el));

  let scrollQueued = false;
  const updateScroll = () => {
    const max = document.documentElement.scrollHeight - innerHeight;
    nav.querySelector(".scroll-progress i").style.transform = `scaleX(${max > 0 ? Math.min(1, scrollY / max) : 0})`;
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
      document.getElementById("lookup")?.scrollIntoView({ behavior: "smooth", block: "start" });
      $("#stockSearch")?.focus();
    }
    if (event.key === "Escape") {
      const suggestions = $("#suggestions");
      if (suggestions) suggestions.hidden = true;
      document.activeElement?.blur?.();
    }
  });
})();

