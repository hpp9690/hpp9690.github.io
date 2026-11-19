(() => {
  const key = "quantLens.researchNotes.v1";
  const sources = [
    {
      title: "均线、价格区间与量价观察",
      url: "https://www.douyin.com/video/7678572740153276863",
      method: "作者在公开视频简介中分享了先用均线观察趋势，再看价格区间和量价配合的思路。",
      evidence: "先定义均线周期、价格区间的起止点和放量口径，记录满足条件与失败的样本。"
    },
    {
      title: "盘前计划与盘后复盘",
      url: "https://www.douyin.com/video/7685027209110714246",
      method: "作者在公开视频简介中描述了盘前写计划、盘中按预设条件执行、盘后回看过程的做法。",
      evidence: "保留盘前原计划和时间戳，盘后标记哪些条件触发、哪些偏离计划，并记录结果。"
    }
  ];
  const states = { pending: "待核对", checked: "已核对来源", reviewed: "已完成复盘" };
  const safe = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

  function sourceUrl(text) {
    const match = String(text || "").match(/https?:\/\/[^\s<>]+/);
    if (!match) return "";
    try {
      const url = new URL(match[0].replace(/[，。；！）》）]+$/, ""));
      if (!["douyin.com", "www.douyin.com", "v.douyin.com"].includes(url.hostname) || url.username || url.password || url.port) return "";
      url.protocol = "https:";
      return url.href;
    } catch { return ""; }
  }

  const shell = document.createElement("section");
  shell.id = "notes";
  shell.dataset.module = "notes";
  shell.className = "card research-panel";
  shell.hidden = document.body.dataset.view !== "notes";
  shell.innerHTML = `
    <div class="research-head">
      <h2>研究笔记</h2>
      <button type="button" id="newResearchNote" aria-controls="researchNoteForm" aria-expanded="false">新建笔记</button>
    </div>
    <form id="researchNoteForm" hidden>
      <div class="research-note-fields">
        <label class="research-wide">标题 <input name="title" required maxlength="70"></label>
        <label class="research-wide">笔记 <textarea name="method" required maxlength="1200" rows="3"></textarea></label>
      </div>
      <details class="note-options">
        <summary>来源与复盘（可选）</summary>
        <div class="research-note-fields">
          <label>股票代码 <input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="六位股票代码"></label>
          <label>抖音链接 <input name="url" maxlength="500" placeholder="链接或分享文字"></label>
          <label>核对状态 <select name="state">${Object.entries(states).map(([id, label]) => `<option value="${id}">${label}</option>`).join("")}</select></label>
          <label class="research-wide">复盘记录 <textarea name="evidence" maxlength="1200" rows="3"></textarea></label>
        </div>
      </details>
      <div class="research-row research-note-actions">
        <button type="submit" class="research-primary">保存</button>
        <button type="button" id="cancelResearchNote">取消</button>
      </div>
    </form>
    <div id="researchNoteSearch" hidden>
      <div class="research-row research-note-search">
        <input id="findResearchNote" type="search" aria-label="查找笔记" placeholder="查找笔记">
        <span id="researchNoteCount" class="research-badge"></span>
      </div>
    </div>
    <p class="research-status" role="status"></p><button type="button" id="restoreResearchNote" hidden>撤销删除</button>
    <div id="researchNotesList" class="research-notes-list"></div>
    <details class="notes-disclosure">
      <summary>抖音参考</summary>
      <p class="research-foot">根据公开简介整理，待验证。</p>
      <div class="research-notes-list note-source-list">
        ${sources.map((source, index) => `<article class="research-note">
          <h4>${safe(source.title)}</h4>
          <p>${safe(source.method)}</p>
          <p class="research-evidence">${safe(source.evidence)}</p>
          <div class="research-row research-note-actions">
            <a href="${source.url}" target="_blank" rel="noopener noreferrer">原帖 ↗</a>
            <button type="button" data-note-example="${index}">记为笔记</button>
          </div>
        </article>`).join("")}
      </div>
    </details>
    <p class="research-foot">笔记保存在当前浏览器。</p>`;
  document.querySelector(".decision-desk").after(shell);
  const $ = (selector) => shell.querySelector(selector);
  const form = $("#researchNoteForm"), fields = form.elements;
  const newButton = $("#newResearchNote"), options = $(".note-options"), search = $("#findResearchNote");
  let entries = [], editingId = null, removed = null;
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "[]");
    if (Array.isArray(saved)) entries = saved.filter((item) => item && typeof item.id === "string" && typeof item.title === "string");
  } catch {}

  function persist() {
    try { localStorage.setItem(key, JSON.stringify(entries)); return true; }
    catch { return false; }
  }

  function status(message) { $(".research-status").textContent = message; }

  function edit(note = {}) {
    editingId = note.id ?? null;
    form.reset();
    for (const field of ["title", "code", "url", "method", "evidence"]) fields[field].value = note[field] || "";
    fields.state.value = Object.hasOwn(states, note.state) ? note.state : "pending";
    options.open = Boolean(note.code || note.url || note.evidence || fields.state.value !== "pending");
    status("");
    form.hidden = false;
    newButton.setAttribute("aria-expanded", "true");
    fields.title.focus();
  }

  function closeEditor() {
    form.hidden = true;
    newButton.setAttribute("aria-expanded", "false");
    newButton.focus();
  }

  function render() {
    if (!entries.length) search.value = "";
    $("#researchNoteSearch").hidden = !entries.length;
    const query = search.value.trim().toLowerCase();
    const shown = entries.filter((note) => [note.title, note.code, note.method, note.evidence].some((value) => String(value ?? "").toLowerCase().includes(query)));
    $("#researchNoteCount").textContent = `${shown.length} 条`;
    $("#researchNotesList").innerHTML = shown.map((note) => {
      const url = sourceUrl(note.url);
      const stockCode = /^\d{6}$/.test(note.code || "") ? note.code : "";
      const state = Object.hasOwn(states, note.state) ? states[note.state] : states.pending;
      return `<details class="research-note">
        <summary class="note-summary">
          <span class="note-summary-title">${safe(note.title)}</span>
          ${stockCode ? ` <small>${stockCode}</small>` : ""}
          <span class="research-badge">${state}</span>
        </summary>
        <p>${safe(note.method)}</p>
        ${note.evidence ? `<p class="research-evidence">${safe(note.evidence)}</p>` : ""}
        <div class="research-row research-note-actions">
          ${url ? `<a href="${safe(url)}" target="_blank" rel="noopener noreferrer">原帖 ↗</a>` : ""}
          ${stockCode ? `<button type="button" data-note-code="${stockCode}">查看个股</button>` : ""}
          <button type="button" data-edit-note="${safe(note.id)}">编辑</button>
          <button type="button" data-delete-note="${safe(note.id)}">删除</button>
        </div>
      </details>`;
    }).join("") || `<div class="research-empty">${query ? "没有匹配的笔记" : "还没有笔记"}</div>`;
    $("#restoreResearchNote").hidden = !removed;
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const url = sourceUrl(fields.url.value);
    if (fields.url.value.trim() && !url) {
      options.open = true;
      fields.url.focus();
      return status("请输入有效的抖音链接或分享文字。");
    }
    const title = fields.title.value.trim(), method = fields.method.value.trim();
    if (!title || !method) return status("请填写标题和笔记。");
    if (!editingId && entries.length >= 160) return status("笔记已达 160 条，可编辑或删除旧笔记后再添加。");
    const note = {
      id: editingId || crypto.randomUUID(), title, method, url, code: fields.code.value.trim(),
      state: fields.state.value, evidence: fields.evidence.value.trim()
    };
    entries = [note, ...entries.filter((item) => item.id !== note.id)];
    const saved = persist();
    closeEditor();
    render();
    status(saved ? "笔记已保存。" : "浏览器未能保存，笔记暂保留在页面中。");
  });

  form.addEventListener("invalid", (event) => {
    if (options.contains(event.target)) options.open = true;
  }, true);
  newButton.addEventListener("click", () => {
    if (form.hidden) edit();
    else fields.title.focus();
  });
  $("#cancelResearchNote").addEventListener("click", closeEditor);
  search.addEventListener("input", render);
  $("#restoreResearchNote").addEventListener("click", () => {
    if (!removed) return;
    entries.unshift(removed);
    removed = null;
    status(persist() ? "已恢复笔记。" : "已恢复到页面，浏览器未能保存。");
    render();
  });
  shell.addEventListener("click", (event) => {
    const stock = event.target.closest("[data-note-code]");
    if (stock) {
      document.dispatchEvent(new CustomEvent("quant:open-view", { detail: { id: "lookup" } }));
      document.getElementById("stockSearch").value = stock.dataset.noteCode;
      document.getElementById("lookupForm").requestSubmit();
      return;
    }
    const example = event.target.closest("[data-note-example]");
    if (example) return edit(sources[Number(example.dataset.noteExample)]);
    const editor = event.target.closest("[data-edit-note]");
    if (editor) {
      const note = entries.find((item) => item.id === editor.dataset.editNote);
      if (note) edit(note);
      return;
    }
    const remove = event.target.closest("[data-delete-note]");
    if (!remove) return;
    removed = entries.find((item) => item.id === remove.dataset.deleteNote);
    if (!removed) return;
    entries = entries.filter((item) => item.id !== removed.id);
    status(persist() ? "已删除笔记，可撤销。" : "已从页面移除，浏览器未能保存。");
    render();
  });
  document.addEventListener("quant:open-notes", (event) => {
    const { code, name } = event.detail || {};
    document.dispatchEvent(new CustomEvent("quant:open-view", { detail: { id: "notes" } }));
    edit({ code, title: name ? `${name} 观察笔记` : "" });
  });
  render();
})();


