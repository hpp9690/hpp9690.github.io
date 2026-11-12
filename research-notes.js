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
    <div class="research-head"><div><h2>研究笔记</h2><p>保存抖音分享链接、博主的操作思路和自己的核对结果。</p></div><button type="button" id="newResearchNote">新建笔记</button></div>
    <form id="researchNoteForm" hidden>
      <div class="research-note-fields">
        <label>标题 <input name="title" required maxlength="70" placeholder="例如：竞价参考金额增加"></label>
        <label>股票代码（可选） <input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="六位股票代码"></label>
        <label>抖音链接（可选） <input name="url" maxlength="500" placeholder="可粘贴视频链接或分享口令"></label>
        <label>核对状态 <select name="state">${Object.entries(states).map(([id, label]) => `<option value="${id}">${label}</option>`).join("")}</select></label>
        <label class="research-wide">方法或操作记录 <textarea name="method" required maxlength="1200" rows="3" placeholder="写下原作者描述的条件、时间和过程"></textarea></label>
        <label class="research-wide">核对与复盘 <textarea name="evidence" maxlength="1200" rows="3" placeholder="记下可核实的行情、公告或样本结果"></textarea></label>
      </div>
      <div class="research-row"><button type="submit" class="research-primary">保存笔记</button><button type="button" id="cancelResearchNote">取消</button></div>
    </form>
    <div class="research-row research-note-search"><label>查找笔记 <input id="findResearchNote" type="search" placeholder="标题、股票代码或关键词"></label><span id="researchNoteCount" class="research-badge"></span></div>
    <p class="research-status" role="status"></p><button type="button" id="restoreResearchNote" hidden>撤销删除</button>
    <div id="researchNotesList" class="research-notes-list"></div>
    <h3 class="research-sources-heading">抖音分享摘记</h3>
    <p class="research-foot">摘记依据公开简介，核对状态为待验证。笔记仅保存于当前浏览器。</p>
    <div class="research-notes-list">
      ${sources.map((source, index) => `<article class="research-note">
        <div class="research-row"><h4>${safe(source.title)}</h4><span class="research-badge">待验证</span></div>
        <p>${safe(source.method)}</p><p class="research-evidence">${safe(source.evidence)}</p>
        <div class="research-row research-note-actions"><a href="${source.url}" target="_blank" rel="noopener noreferrer">打开抖音原帖 ↗</a><button type="button" data-note-example="${index}">记为笔记</button></div>
      </article>`).join("")}
    </div>`;
  document.querySelector(".decision-desk").after(shell);
  const $ = (selector) => shell.querySelector(selector);
  const form = $("#researchNoteForm"), fields = form.elements;
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
    fields.state.value = states[note.state] ? note.state : "pending";
    form.hidden = false;
    fields.title.focus();
  }

  function render() {
    const query = $("#findResearchNote").value.trim().toLowerCase();
    const shown = entries.filter((note) => [note.title, note.code, note.method, note.evidence].some((value) => String(value ?? "").toLowerCase().includes(query)));
    $("#researchNoteCount").textContent = `${shown.length} 条`;
    $("#researchNotesList").innerHTML = shown.map((note) => {
      const url = sourceUrl(note.url);
      return `<article class="research-note">
        <div class="research-row"><h4>${safe(note.title)} ${note.code ? `<small>${safe(note.code)}</small>` : ""}</h4><span class="research-badge">${states[note.state] || states.pending}</span></div>
        <p>${safe(note.method)}</p>
        ${note.evidence ? `<p class="research-evidence">${safe(note.evidence)}</p>` : ""}
        <div class="research-row research-note-actions">
          ${url ? `<a href="${safe(url)}" target="_blank" rel="noopener noreferrer">打开抖音原帖 ↗</a>` : ""}
          <button type="button" data-edit-note="${safe(note.id)}">编辑</button>
          <button type="button" data-delete-note="${safe(note.id)}">删除</button>
        </div>
      </article>`;
    }).join("") || `<div class="research-empty">${query ? "没有匹配的笔记。" : "还没有笔记。可新建一条，或从下面的分享摘记开始。"}<\/div>`;
    $("#restoreResearchNote").hidden = !removed;
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const url = sourceUrl(fields.url.value);
    if (fields.url.value.trim() && !url) return status("请输入有效的抖音视频链接或分享文本。");
    const title = fields.title.value.trim(), method = fields.method.value.trim();
    if (!title || !method) return status("请填写标题和方法记录。");
    if (!editingId && entries.length >= 160) return status("笔记已达 160 条，可编辑或删除旧笔记后再添加。");
    const note = {
      id: editingId || crypto.randomUUID(), title, method, url, code: fields.code.value.trim(),
      state: fields.state.value, evidence: fields.evidence.value.trim()
    };
    entries = [note, ...entries.filter((item) => item.id !== note.id)];
    const saved = persist();
    form.hidden = true;
    render();
    status(saved ? "笔记已保存。" : "浏览器未能保存，笔记暂保留在页面中。");
    $("#newResearchNote").focus();
  });

  $("#newResearchNote").addEventListener("click", () => edit());
  $("#cancelResearchNote").addEventListener("click", () => { form.hidden = true; $("#newResearchNote").focus(); });
  $("#findResearchNote").addEventListener("input", render);
  $("#restoreResearchNote").addEventListener("click", () => {
    if (!removed) return;
    entries.unshift(removed);
    removed = null;
    status(persist() ? "已恢复笔记。" : "已恢复到页面，浏览器未能保存。");
    render();
  });
  shell.addEventListener("click", (event) => {
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


