'use strict';

/* 词境 —— 纯前端版：数据在浏览器本地，模型直连，不依赖服务器 */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const Store = window.WordStore;
const Gen = window.WordGen;
const Export = window.WordExport;

let state = {
  words: [],
  articles: [],
  settings: { llm: {}, generator: {} },
  stats: { total: 0, mastered: 0, articles: 0 },
};

const ui = {
  selectedWords: new Set(),
  currentArticleId: null,
  busy: false,
};

/* ---------------- 基础工具 ---------------- */

let toastTimer = null;
function toast(msg, isError) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast' + (isError ? ' error' : '');
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, isError ? 5000 : 2600);
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function targetRegex(words) {
  const list = (words || []).map((w) => escapeRe(w.word || w)).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!list.length) return null;
  return new RegExp(`\\b(${list.join('|')})(s|es|ed|d|ing|ly)?\\b`, 'gi');
}

function highlight(text, words) {
  const re = targetRegex(words);
  const safe = esc(text);
  if (!re) return safe;
  return safe.replace(re, '<mark class="target">$&</mark>');
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function withBusy(btn, label, fn) {
  if (ui.busy) return Promise.resolve();
  ui.busy = true;
  const old = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span>${label}`;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      ui.busy = false;
      btn.disabled = false;
      btn.innerHTML = old;
    });
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 1000);
}

/* ---------------- 数据加载 ---------------- */

function refresh() {
  state.words = Store.listWords().map((w) => ({
    id: w.id,
    word: w.word,
    meaning: w.meaning,
    phonetic: w.phonetic,
    mastered: !!w.mastered,
    usedCount: (w.usedIn || []).length,
    createdAt: w.createdAt,
  }));
  state.articles = Store.load().articles;
  state.settings = Store.getSettings();
  state.stats = Store.stats();
  renderAll();
}

function renderAll() {
  renderStats();
  renderWordList();
  renderArticleList();
  renderSettings();
  renderSelects();
}

function renderStats() {
  const { total, mastered, articles } = state.stats;
  $('#stats').innerHTML = `
    <span>词库 <b>${total}</b></span>
    <span>已掌握 <b>${mastered}</b></span>
    <span>文章 <b>${articles}</b></span>`;
}

function renderSelects() {
  const levelSel = $('#gen-level');
  if (levelSel.options.length === 0) {
    levelSel.innerHTML = Object.keys(Gen.LEVELS)
      .map((k) => `<option value="${k}">${esc(Gen.LEVELS[k].name)}</option>`)
      .join('');
    levelSel.value = state.settings.generator.level || 'cet4';
  }

  const styleSel = $('#gen-style');
  if (styleSel.options.length === 0) {
    styleSel.innerHTML = Object.keys(Gen.STYLES)
      .map((k) => `<option value="${k}">${esc(Gen.STYLES[k].split('，')[0])}</option>`)
      .join('');
    styleSel.value = state.settings.generator.style || 'story';
  }

  if ($('#gen-per').value === '') $('#gen-per').value = state.settings.generator.wordsPerArticle || 12;
  if ($('#gen-density').value === '') $('#gen-density').value = state.settings.generator.wordsPerSentence || 3;
}

/* ---------------- 词库 ---------------- */

function renderWordList() {
  const q = $('#word-search').value.trim().toLowerCase();
  const filter = $('#word-filter').value;

  const list = state.words.filter((w) => {
    if (filter === 'new' && w.mastered) return false;
    if (filter === 'mastered' && !w.mastered) return false;
    if (q && !w.word.toLowerCase().includes(q) && !(w.meaning || '').toLowerCase().includes(q)) return false;
    return true;
  });

  const holder = $('#word-list');
  if (!list.length) {
    holder.innerHTML = `<div class="empty">${state.words.length ? '没有符合条件的单词' : '词库是空的 —— 把要背的单词粘到上面那个框里就行'}</div>`;
    return;
  }

  holder.innerHTML = list
    .map(
      (w) => `<div class="word-row ${w.mastered ? 'mastered' : ''}">
        <input type="checkbox" data-id="${w.id}" ${ui.selectedWords.has(w.id) ? 'checked' : ''}>
        <span class="w">${esc(w.word)}</span>
        <span class="p">${esc(w.phonetic || '')}</span>
        <span class="m">${esc(w.meaning || '—')}</span>
        ${w.usedCount ? `<span class="badge">用过 ${w.usedCount} 次</span>` : ''}
        ${w.mastered ? '<span class="badge">已掌握</span>' : ''}
        <button class="btn ghost" data-toggle="${w.id}">${w.mastered ? '取消掌握' : '标为掌握'}</button>
      </div>`
    )
    .join('');

  holder.querySelectorAll('input[type=checkbox]').forEach((cb) => {
    cb.onchange = () => {
      if (cb.checked) ui.selectedWords.add(cb.dataset.id);
      else ui.selectedWords.delete(cb.dataset.id);
    };
  });
  holder.querySelectorAll('[data-toggle]').forEach((btn) => {
    btn.onclick = () => {
      const w = state.words.find((x) => x.id === btn.dataset.toggle);
      Store.setMastered([w.id], !w.mastered);
      refresh();
    };
  });
}

/* ---------------- 文章 ---------------- */

function renderArticleList() {
  const holder = $('#article-list');
  if (!state.articles.length) {
    holder.innerHTML = `<div class="empty">还没有文章</div>`;
    return;
  }
  holder.innerHTML = state.articles
    .map(
      (a) => `<div class="article-item ${a.id === ui.currentArticleId ? 'active' : ''}" data-id="${a.id}">
        <h3>${esc(a.title)}</h3>
        <div class="meta">${fmtDate(a.createdAt)} · ${a.words.length} 词${a.engine === 'offline' ? ' · 离线模板' : ''}</div>
      </div>`
    )
    .join('');

  holder.querySelectorAll('.article-item').forEach((el) => {
    el.onclick = () => {
      ui.currentArticleId = el.dataset.id;
      renderArticleList();
      renderReader();
    };
  });
}

function renderReader() {
  const holder = $('#reader');
  const a = state.articles.find((x) => x.id === ui.currentArticleId);
  if (!a) {
    holder.className = 'reader';
    holder.innerHTML = `<div class="empty">左边选一篇文章开始读</div>`;
    return;
  }

  const body = a.paragraphs.map((p) => `<p>${highlight(p, a.words)}</p>`).join('');

  holder.className = 'reader';
  holder.innerHTML = `
    <h1>${esc(a.title)}</h1>
    <div class="reader-meta">
      ${fmtDate(a.createdAt)} · ${a.words.length} 个目标词 · 难度 ${esc((Gen.LEVELS[a.level] || {}).name || a.level || '-')}
      ${a.engine === 'offline' ? ' · <span title="没有配置模型，用内置模板拼接的示例">离线模板</span>' : ''}
      ${a.missing && a.missing.length ? ` · <span style="color:#b3261e">未覆盖：${esc(a.missing.join(', '))}</span>` : ''}
    </div>
    <div class="body">${body}</div>

    <div class="gloss">
      <h2>本文字词</h2>
      ${a.words
        .map(
          (w) => `<div class="gloss-item">
            <div class="head">
              <span class="w">${esc(w.word)}</span>
              <span class="p">${esc(w.phonetic || '')}</span>
              <span class="m">${esc(w.meaning || '')}</span>
            </div>
            ${w.sentence ? `<div class="s">${esc(w.sentence)}</div>` : ''}
          </div>`
        )
        .join('')}
    </div>

    <div class="reader-actions">
      <button class="btn primary" id="btn-quiz">遮挡自测</button>
      <button class="btn" data-export="md">Markdown</button>
      <button class="btn" data-export="docx">Word</button>
      <button class="btn" data-export="html">HTML</button>
      <button class="btn" data-export="txt">纯文本</button>
      <button class="btn ghost" id="btn-copy">复制全文</button>
      <button class="btn danger" id="btn-del-article">删除</button>
    </div>`;

  $('#btn-quiz').onclick = (e) => {
    holder.classList.toggle('quiz');
    e.target.textContent = holder.classList.contains('quiz') ? '显示全部' : '遮挡自测';
    holder.querySelectorAll('mark.target').forEach((m) => m.classList.remove('revealed'));
  };

  holder.querySelectorAll('mark.target').forEach((m) => {
    m.onclick = () => {
      if (holder.classList.contains('quiz')) m.classList.toggle('revealed');
    };
  });

  holder.querySelectorAll('[data-export]').forEach((btn) => {
    btn.onclick = () => doExport(a, btn.dataset.export);
  });

  $('#btn-copy').onclick = async () => {
    const text = `${a.title}\n\n${a.paragraphs.join('\n\n')}\n\n---\n` +
      a.words.map((w) => `${w.word} ${w.phonetic || ''} ${w.meaning || ''}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast('已复制到剪贴板');
    } catch (_) {
      toast('浏览器不允许自动复制，请长按选中复制', true);
    }
  };

  $('#btn-del-article').onclick = () => {
    if (!confirm('删除这篇文章？')) return;
    Store.removeArticle(a.id);
    ui.currentArticleId = null;
    refresh();
    renderReader();
    toast('已删除');
  };
}

function doExport(article, fmt) {
  const safeTitle = (article.title || 'article').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
  try {
    if (fmt === 'docx') {
      const bytes = Export.toDocx(article);
      download(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), `${safeTitle}.docx`);
    } else if (fmt === 'html') {
      download(new Blob([Export.toHtml(article)], { type: 'text/html;charset=utf-8' }), `${safeTitle}.html`);
    } else if (fmt === 'txt') {
      download(new Blob([Export.toText(article)], { type: 'text/plain;charset=utf-8' }), `${safeTitle}.txt`);
    } else {
      download(new Blob([Export.toMarkdown(article)], { type: 'text/markdown;charset=utf-8' }), `${safeTitle}.md`);
    }
    toast('已导出');
  } catch (err) {
    toast('导出失败：' + err.message, true);
  }
}

/* ---------------- 设置 ---------------- */

function renderSettings() {
  const llm = state.settings.llm || {};
  if (!$('#set-baseurl').value) $('#set-baseurl').value = llm.baseUrl || '';
  if (!$('#set-model').value) $('#set-model').value = llm.model || '';
  if (!$('#set-apikey').value) $('#set-apikey').value = llm.apiKey || '';
  renderStorageInfo();
}

function renderStorageInfo() {
  const el = $('#storage-info');
  if (!el) return;
  let bytes = 0;
  try {
    bytes = new Blob([Store.exportData()]).size;
  } catch (_) { /* ignore */ }
  el.textContent = `本地已存 ${state.stats.total} 个词、${state.stats.articles} 篇文章，约 ${(bytes / 1024).toFixed(1)} KB`;
}

/* ---------------- 标签页 ---------------- */

function bindTabs() {
  const activate = (name) => {
    const tab = $$('.tab').find((t) => t.dataset.tab === name);
    if (!tab) return;
    $$('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
    if (location.hash.slice(1) !== name) history.replaceState(null, '', '#' + name);
  };

  $$('.tab').forEach((tab) => {
    tab.onclick = () => activate(tab.dataset.tab);
  });

  const initial = location.hash.slice(1);
  if (initial) activate(initial);
}

/* ---------------- 事件 ---------------- */

function bindEvents() {
  $('#word-search').oninput = renderWordList;
  $('#word-filter').onchange = renderWordList;

  $('#btn-clear-input').onclick = () => {
    $('#manual-words').value = '';
    $('#manual-words').focus();
  };

  $('#btn-add-words').onclick = (e) => {
    withBusy(e.target, '添加中…', async () => {
      const text = $('#manual-words').value;
      if (!text.trim()) return toast('先输入单词', true);

      const out = Store.addWordsFromText(text);
      $('#manual-words').value = '';
      refresh();

      const status = $('#add-status');
      status.className = 'hint ok';
      status.textContent = `识别 ${out.parsed} 行，新增 ${out.added} 个，已存在 ${out.updated + out.skipped} 个`;
      toast(`新增 ${out.added} 个单词`);
    }).catch((err) => {
      const status = $('#add-status');
      status.className = 'hint error';
      status.textContent = err.message;
    });
  };

  $('#btn-mastered').onclick = () => {
    if (!ui.selectedWords.size) return toast('先勾选单词', true);
    Store.setMastered(Array.from(ui.selectedWords), true);
    ui.selectedWords.clear();
    refresh();
    toast('已标记为掌握');
  };

  $('#btn-delete-words').onclick = () => {
    if (!ui.selectedWords.size) return toast('先勾选单词', true);
    if (!confirm(`删除 ${ui.selectedWords.size} 个单词？`)) return;
    Store.removeWords(Array.from(ui.selectedWords));
    ui.selectedWords.clear();
    refresh();
    toast('已删除');
  };

  $('#btn-generate').onclick = (e) => {
    withBusy(e.target, '生成中…', async () => {
      const status = $('#gen-status');
      status.className = 'hint';
      const hasKey = Boolean(Store.getSettings().llm.apiKey);
      status.textContent = hasKey ? '正在调用模型…' : '未配置模型，将用离线模板生成…';

      const out = await Store.generate({
        count: Number($('#gen-count').value),
        wordsPerArticle: Number($('#gen-per').value),
        level: $('#gen-level').value,
        style: $('#gen-style').value,
        wordsPerSentence: Number($('#gen-density').value),
        extra: $('#gen-extra').value.trim(),
        includeMastered: $('#gen-include-mastered').checked,
        excludeUsed: $('#gen-fresh').checked,
      });

      refresh();

      if (out.created && out.created.length) {
        ui.currentArticleId = out.created[0].id;
        renderArticleList();
        renderReader();
        status.className = 'hint ok';
        status.textContent = `生成了 ${out.created.length} 篇，用了 ${out.usedCount} 个词`;
        $$('.tab').find((t) => t.dataset.tab === 'write').click();
        if (out.errors && out.errors.length) toast(`有 ${out.errors.length} 篇失败：${out.errors[0].error}`, true);
      } else {
        status.className = 'hint error';
        status.textContent = (out.errors && out.errors[0] && out.errors[0].error) || '生成失败';
      }
    }).catch((err) => {
      const status = $('#gen-status');
      status.className = 'hint error';
      status.textContent = err.message;
    });
  };

  $('#btn-save-settings').onclick = (e) => {
    withBusy(e.target, '保存中…', async () => {
      Store.updateSettings({
        llm: {
          baseUrl: $('#set-baseurl').value.trim(),
          model: $('#set-model').value.trim(),
          apiKey: $('#set-apikey').value.trim(),
        },
      });
      refresh();
      const s = $('#llm-status');
      s.className = 'hint ok';
      s.textContent = '已保存到本机，生成时会使用。';
    }).catch((err) => toast(err.message, true));
  };

  $('#btn-test-llm').onclick = (e) => {
    withBusy(e.target, '测试中…', async () => {
      const s = $('#llm-status');
      s.className = 'hint';
      s.textContent = '正在请求模型…';

      const llm = {
        baseUrl: $('#set-baseurl').value.trim(),
        model: $('#set-model').value.trim(),
        apiKey: $('#set-apikey').value.trim(),
        temperature: 0.9,
      };
      if (!llm.apiKey) {
        s.className = 'hint error';
        s.textContent = '还没有 API Key。填进上面的输入框再点「测试连接」。';
        return;
      }
      if (!llm.baseUrl) {
        s.className = 'hint error';
        s.textContent = 'Base URL 是空的，例如 https://api.deepseek.com/v1';
        return;
      }

      const out = await Gen.generateArticle(
        [{ word: 'abandon', meaning: 'v. 放弃', phonetic: '' }, { word: 'brave', meaning: 'adj. 勇敢的', phonetic: '' }],
        { level: 'junior', style: 'story', wordsPerSentence: 2, extra: '越短越好，只写一段。' },
        llm
      );
      s.className = 'hint ok';
      s.textContent = `模型可用（${llm.model}），已验证。别忘了点「保存」。示例：${out.paragraphs[0].slice(0, 160)}`;
    }).catch((err) => {
      const s = $('#llm-status');
      s.className = 'hint error';
      s.textContent = '失败：' + err.message;
    });
  };

  /* --- 数据备份 --- */

  $('#btn-export-data').onclick = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    download(new Blob([Store.exportData()], { type: 'application/json' }), `词境备份-${stamp}.json`);
    toast('已导出备份文件');
  };

  $('#btn-import-data').onclick = () => $('#import-file').click();

  $('#import-file').onchange = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const out = Store.importData(text, 'merge');
      refresh();
      toast(out.replaced ? `已替换为 ${out.words} 个词` : `导入完成，新增 ${out.added} 个词`);
    } catch (err) {
      toast('导入失败：' + err.message, true);
    } finally {
      e.target.value = '';
    }
  };

  $('#btn-clear-all').onclick = () => {
    if (!confirm('清空本机所有单词和文章？这个操作不能撤销，建议先导出备份。')) return;
    Store.clearAll();
    ui.currentArticleId = null;
    refresh();
    renderReader();
    toast('已清空');
  };
}

/* ---------------- 启动 ---------------- */

(function init() {
  bindTabs();
  bindEvents();
  refresh();

  if (!ui.currentArticleId && state.articles.length) {
    ui.currentArticleId = state.articles[0].id;
    renderArticleList();
    renderReader();
  }

  if (!state.words.length && !state.articles.length) {
    $('#manual-words').focus();
  }

  // 注册 service worker，让添加到主屏幕后能离线打开
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* 离线缓存失败不影响使用 */ });
  }
})();
