/**
 * 本地数据层 —— 全部存在浏览器 localStorage 里，不依赖任何服务器。
 * 浏览器与 Node 通用（Node 下需要注入一个 storage 实现，测试用）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./generate.js'), require('./words.js'));
  else root.WordStore = factory(root.WordGen, root.WordParse);
})(typeof self !== 'undefined' ? self : this, function (WordGen, WordParse) {
  'use strict';

  const KEY = 'wordscene.db.v1';

  const DEFAULT_DB = {
    version: 1,
    settings: {
      llm: { baseUrl: 'https://api.deepseek.com/v1', apiKey: '', model: 'deepseek-chat', temperature: 0.9 },
      generator: { wordsPerArticle: 12, level: 'cet4', style: 'story', wordsPerSentence: 3 },
    },
    words: [],
    articles: [],
  };

  let storage = null;
  let cache = null;

  function detectStorage() {
    if (storage) return storage;
    try {
      // 浏览器
      if (typeof localStorage !== 'undefined') {
        const probe = '__ws_probe__';
        localStorage.setItem(probe, '1');
        localStorage.removeItem(probe);
        storage = localStorage;
      }
    } catch (_) { /* 隐私模式等 */ }
    return storage;
  }

  function setStorage(impl) {
    storage = impl;
    cache = null;
  }

  function clone(o) {
    return JSON.parse(JSON.stringify(o));
  }

  function load() {
    if (cache) return cache;
    const st = detectStorage();
    if (!st) {
      cache = clone(DEFAULT_DB);
      return cache;
    }
    try {
      const raw = st.getItem(KEY);
      if (!raw) {
        cache = clone(DEFAULT_DB);
        save();
        return cache;
      }
      const parsed = JSON.parse(raw);
      cache = merge(clone(DEFAULT_DB), parsed);
    } catch (_) {
      cache = clone(DEFAULT_DB);
    }
    return cache;
  }

  function merge(base, patch) {
    if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch;
    const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
    for (const k of Object.keys(patch)) out[k] = merge(out[k], patch[k]);
    return out;
  }

  function save() {
    const st = detectStorage();
    if (!st || !cache) return false;
    try {
      st.setItem(KEY, JSON.stringify(cache));
      return true;
    } catch (err) {
      // 配额满了
      console.error('保存失败', err);
      return false;
    }
  }

  function uid(prefix) {
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function now() {
    return new Date().toISOString();
  }

  /* ---------------- settings ---------------- */

  function getSettings() {
    return load().settings;
  }

  function updateSettings(patch) {
    const db = load();
    db.settings = merge(db.settings, patch);
    save();
    return db.settings;
  }

  /* ---------------- words ---------------- */

  function normalize(w) {
    return String(w || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function addWords(list) {
    const db = load();
    const byWord = new Map(db.words.map((w) => [w.word, w]));
    const result = { added: 0, updated: 0, skipped: 0 };

    for (const item of list) {
      const key = normalize(item.word);
      if (!key || !/^[a-z][a-z' -]*$/.test(key)) {
        result.skipped++;
        continue;
      }
      const exist = byWord.get(key);
      if (exist) {
        let touched = false;
        for (const f of ['meaning', 'phonetic']) {
          if (!exist[f] && item[f]) { exist[f] = item[f]; touched = true; }
        }
        if (!exist.phonetic && item.phonetic) { exist.phonetic = item.phonetic; touched = true; }
        if (touched) result.updated++;
        else result.skipped++;
        continue;
      }
      const rec = {
        id: uid('w'),
        word: key,
        meaning: item.meaning || '',
        phonetic: item.phonetic || '',
        source: item.source || 'manual',
        mastered: false,
        usedIn: [],
        createdAt: now(),
      };
      db.words.push(rec);
      byWord.set(key, rec);
      result.added++;
    }

    save();
    return result;
  }

  function addWordsFromText(text) {
    const items = WordParse.parseWordLines(text);
    if (!items.length) {
      const err = new Error('没有识别到英文单词。每行一个词就行，也可以写成「abandon, v. 放弃」。');
      err.code = 'NO_WORDS';
      throw err;
    }
    return Object.assign({ parsed: items.length }, addWords(items));
  }

  function listWords() {
    return load().words.slice().sort((a, b) => a.word.localeCompare(b.word));
  }

  function setMastered(ids, mastered) {
    const db = load();
    const set = new Set(ids);
    let n = 0;
    for (const w of db.words) if (set.has(w.id)) { w.mastered = !!mastered; n++; }
    save();
    return n;
  }

  function removeWords(ids) {
    const db = load();
    const set = new Set(ids);
    const before = db.words.length;
    db.words = db.words.filter((w) => !set.has(w.id));
    save();
    return before - db.words.length;
  }

  function pickWords(count, opts) {
    const o = opts || {};
    const db = load();
    let pool = db.words.filter((w) => (o.includeMastered ? true : !w.mastered));
    if (o.excludeUsed !== false) {
      const used = new Set();
      for (const a of db.articles) for (const id of a.wordIds || []) used.add(id);
      const fresh = pool.filter((w) => !used.has(w.id));
      if (fresh.length >= count) pool = fresh;
    }
    pool.sort((a, b) => (a.usedIn || []).length - (b.usedIn || []).length || a.word.localeCompare(b.word));
    return pool.slice(0, count);
  }

  /* ---------------- articles ---------------- */

  function addArticle(a) {
    const db = load();
    const rec = Object.assign({ id: uid('a'), createdAt: now() }, a);
    db.articles.unshift(rec);
    for (const wid of rec.wordIds || []) {
      const w = db.words.find((x) => x.id === wid);
      if (w) {
        w.usedIn = w.usedIn || [];
        w.usedIn.push(rec.id);
      }
    }
    save();
    return rec;
  }

  function removeArticle(id) {
    const db = load();
    const before = db.articles.length;
    db.articles = db.articles.filter((a) => a.id !== id);
    for (const w of db.words) if (w.usedIn) w.usedIn = w.usedIn.filter((x) => x !== id);
    save();
    return before - db.articles.length;
  }

  /* ---------------- 生成 ---------------- */

  async function generate(body) {
    const db = load();
    const llm = db.settings.llm;
    const preset = db.settings.generator;

    const count = Math.max(1, Math.min(Number(body.count) || 1, 10));
    const per = Math.max(2, Math.min(Number(body.wordsPerArticle) || preset.wordsPerArticle || 12, 40));

    const picked = pickWords(count * per, {
      includeMastered: !!body.includeMastered,
      excludeUsed: body.excludeUsed !== false,
    });

    if (picked.length < 2) {
      const err = new Error('词库里可用的单词太少（至少 2 个）。先添加单词，或勾选「包含已掌握的词」。');
      err.code = 'TOO_FEW_WORDS';
      throw err;
    }

    const groups = [];
    for (let i = 0; i < picked.length; i += per) groups.push(picked.slice(i, i + per));

    const created = [];
    const errors = [];

    for (const group of groups) {
      try {
        const article = await WordGen.generateArticle(
          group,
          {
            level: body.level || preset.level,
            style: body.style || preset.style,
            wordsPerSentence: body.wordsPerSentence || preset.wordsPerSentence,
            extra: body.extra || '',
          },
          llm
        );

        created.push(
          addArticle({
            title: article.title,
            level: body.level || preset.level,
            style: body.style || preset.style,
            engine: article.engine,
            paragraphs: article.paragraphs,
            words: article.words,
            missing: article.missing,
            wordIds: group.map((w) => w.id),
            extra: body.extra || '',
          })
        );
      } catch (err) {
        errors.push({ words: group.map((w) => w.word), error: err.message, code: err.code });
      }
    }

    return {
      ok: created.length > 0,
      created,
      errors,
      usedCount: created.reduce((n, a) => n + a.words.length, 0),
    };
  }

  /* ---------------- 数据导入导出 ---------------- */

  function exportData() {
    return JSON.stringify(load(), null, 2);
  }

  function importData(text, mode) {
    const incoming = JSON.parse(text);
    if (!incoming || !Array.isArray(incoming.words)) throw new Error('这个文件不像是词境导出的数据（缺少 words 字段）');

    const db = load();
    if (mode === 'replace') {
      db.words = incoming.words;
      db.articles = Array.isArray(incoming.articles) ? incoming.articles : [];
      if (incoming.settings) db.settings = merge(db.settings, incoming.settings);
      save();
      return { replaced: true, words: db.words.length, articles: db.articles.length };
    }

    const before = db.words.length;
    const byWord = new Map(db.words.map((w) => [w.word, w]));
    for (const w of incoming.words) {
      if (!w || !w.word) continue;
      const key = normalize(w.word);
      if (byWord.has(key)) continue;
      const rec = Object.assign({}, w, { id: uid('w'), word: key });
      db.words.push(rec);
      byWord.set(key, rec);
    }
    save();
    return { replaced: false, added: db.words.length - before, words: db.words.length };
  }

  function clearAll() {
    cache = clone(DEFAULT_DB);
    save();
    return cache;
  }

  function stats() {
    const db = load();
    return {
      total: db.words.length,
      mastered: db.words.filter((w) => w.mastered).length,
      articles: db.articles.length,
    };
  }

  return {
    KEY,
    DEFAULT_DB,
    setStorage,
    load,
    save,
    getSettings,
    updateSettings,
    addWords,
    addWordsFromText,
    listWords,
    setMastered,
    removeWords,
    pickWords,
    removeArticle,
    generate,
    exportData,
    importData,
    clearAll,
    stats,
  };
});
