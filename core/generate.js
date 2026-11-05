/**
 * 文章生成 —— 浏览器与 Node 通用（UMD）
 * 优先调 LLM（OpenAI 兼容接口），没配 Key 或调用失败时退回离线串词模板。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WordGen = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LEVELS = {
    primary: { name: '小学', hint: '小学高年级英语水平，句子短、词汇简单，每句不超过 10 词' },
    junior: { name: '初中', hint: '初中英语水平，简单句为主，少量并列句' },
    senior: { name: '高中', hint: '高中英语水平，可用从句，句式有变化' },
    cet4: { name: '四级', hint: '大学英语四级水平，自然地道，允许复杂句' },
    cet6: { name: '六级', hint: '大学英语六级水平，表达丰富，可用高级搭配' },
    ielts: { name: '雅思', hint: '雅思 6.5-7 分水平，学术但不生硬' },
  };

  const STYLES = {
    story: '连贯的小故事，有起承转合，有人物和情节',
    diary: '第一人称日记/随笔，口语化、有情绪',
    news: '新闻报道，客观叙述，像一则短消息',
    dialog: '一段两人对话，自然口语，有来有往',
    essay: '说明性或议论性短文，有观点和例证',
  };

  function buildPrompt(words, opts) {
    const { level = 'cet4', style = 'story', wordsPerSentence = 3, extra = '' } = opts || {};
    const lv = LEVELS[level] || LEVELS.cet4;
    const st = STYLES[style] || STYLES.story;
    const list = words.map((w) => w.word).join(', ');
    const withTranslation = Boolean(opts && opts.withTranslation);

    const schema = [
      '{',
      '  "title": "英文标题（不超过 10 词）",',
      '  "paragraphs": ["第一段", "第二段", "..."],',
      '  "words": [',
      '    {"word": "单词原形", "phonetic": "音标，不确定就留空", "meaning": "中文释义，含词性", "sentence": "文中出现该词的那一句原文"}',
      '  ]' + (withTranslation ? ',' : ''),
      ...(withTranslation
        ? [
            '  "translations": [',
            '    {"en": "原文的完整句子（逐句，不要合并）", "zh": "这句的中文翻译"}',
            '  ]',
          ]
        : []),
      '}',
    ];

    return [
      {
        role: 'system',
        content:
          '你是一位英语教学素材作者，专门为中文母语的学习者编写"串词短文"：' +
          '把一组他们记不住的英文单词，编进一篇自然、好读、有情境的短文里，让读者靠上下文记住词义。' +
          '你只输出 JSON，不输出任何解释或 Markdown 代码块。',
      },
      {
        role: 'user',
        content: [
          `请把下面这 ${words.length} 个单词全部用进一篇英语短文：`,
          list,
          '',
          '要求：',
          `1. 语言难度：${lv.hint}。`,
          `2. 文章形式：${st}。`,
          '3. 每个单词至少出现 1 次，用原形或其正常变形（时态、复数等）都可以，但不能换成本义词。',
          '4. 全文 250-450 词，分 3-5 段，每段 2-4 句。',
          `5. 平均每句大约包含 ${wordsPerSentence} 个目标词，句子之间要有逻辑连接，不要像造词练习那样硬凑。`,
          '6. 单词要在句子里承担真实语义，能让人从上下文猜出意思。',
          '7. 拼写必须完全正确。',
          extra ? `8. 额外要求：${extra}` : '',
          '',
          withTranslation
            ? '另外，把正文**每一句**的中文翻译放进 translations，en 必须与 paragraphs 里的原句一字不差（含标点），按出现顺序排列。'
            : '',
          '',
          '输出 JSON，字段如下：',
          ...schema,
        ].filter(Boolean).join('\n'),
      },
    ];
  }

  /** 从模型输出里抠出 JSON（对象或数组都行） */
  function extractJson(text) {
    if (!text) return null;
    let s = String(text).trim();
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();

    const braceAt = s.indexOf('{');
    const bracketAt = s.indexOf('[');
    let start = -1;
    let end = -1;

    if (bracketAt !== -1 && (braceAt === -1 || bracketAt < braceAt)) {
      start = bracketAt;
      end = s.lastIndexOf(']');
    } else {
      start = braceAt;
      end = s.lastIndexOf('}');
    }
    if (start === -1 || end === -1 || end <= start) return null;

    const slice = s.slice(start, end + 1);
    try {
      return JSON.parse(slice);
    } catch (_) {
      try {
        return JSON.parse(slice.replace(/,\s*([}\]])/g, '$1'));
      } catch (_) {
        return null;
      }
    }
  }

  async function callLLM(messages, llm) {
    const base = String(llm.baseUrl || '').replace(/\/+$/, '');
    const url = /\/chat\/completions$/.test(base) ? base : base + '/chat/completions';
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${llm.apiKey}`,
      },
      body: JSON.stringify({
        model: llm.model || 'deepseek-chat',
        messages,
        temperature: typeof llm.temperature === 'number' ? llm.temperature : 0.9,
        max_tokens: 2000,
      }),
      signal: AbortSignal.timeout(120000),
    });

    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) { /* ignore */ }

    if (!res.ok) {
      const msg = (json && (json.error?.message || json.message)) || text.slice(0, 300);
      const err = new Error(`模型接口返回 ${res.status}：${msg}`);
      err.code = 'LLM_HTTP_' + res.status;
      throw err;
    }
    const content = json?.choices?.[0]?.message?.content;
    if (!content) {
      const err = new Error('模型没有返回内容');
      err.code = 'LLM_EMPTY';
      throw err;
    }
    return content;
  }

  function escapeRe(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function containsWord(text, word) {
    return new RegExp(`\\b${escapeRe(word)}\\w{0,3}\\b`, 'i').test(text);
  }

  /** 不依赖 lookbehind 的分句（老版 iOS Safari 不支持 lookbehind） */
  function splitSentences(paragraph) {
    const s = String(paragraph || '');
    const out = [];
    let start = 0;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch !== '.' && ch !== '!' && ch !== '?') continue;

      let j = i + 1;
      while (j < s.length && /["'”’)\]]/.test(s[j])) j++;
      const nextIsBreak = j >= s.length || /\s/.test(s[j]);
      if (!nextIsBreak) continue;

      const piece = s.slice(start, j).trim();
      if (piece) out.push(piece);
      start = j;
      i = j - 1;
    }
    const tail = s.slice(start).trim();
    if (tail) out.push(tail);
    return out;
  }

  /** 比对句子用：去掉多余空格、统一引号、忽略大小写与末尾标点 */
  function sentenceKey(s) {
    return String(s || '')
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
      .replace(/[.!?,;:]+$/, '');
  }

  function findSentence(text, word) {
    if (!word) return '';
    const re = new RegExp(`\\b${escapeRe(word)}\\w{0,3}\\b`, 'i');
    const hit = splitSentences(text).find((s) => re.test(s));
    return hit ? hit.trim() : '';
  }

  function normalizeTranslations(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    const seen = new Set();
    for (const t of raw) {
      if (!t || typeof t !== 'object') continue;
      const en = String(t.en || t.sentence || t.text || '').trim();
      const zh = String(t.zh || t.translation || t.cn || '').trim();
      if (!en || !zh) continue;
      const key = sentenceKey(en);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ en, zh });
    }
    return out;
  }

  function normalizeArticle(raw, words, engine) {
    const paragraphs = Array.isArray(raw.paragraphs)
      ? raw.paragraphs.map((p) => String(p).trim()).filter(Boolean)
      : String(raw.text || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

    if (!paragraphs.length) throw new Error('模型返回的文章为空');

    const text = paragraphs.join('\n\n');
    const byWord = new Map(words.map((w) => [w.word.toLowerCase(), w]));

    const entries = (Array.isArray(raw.words) ? raw.words : []).map((e) => {
      const key = String(e.word || '').trim().toLowerCase();
      const src = byWord.get(key);
      return {
        word: key,
        phonetic: String(e.phonetic || (src && src.phonetic) || '').trim(),
        meaning: String(e.meaning || (src && src.meaning) || '').trim(),
        sentence: String(e.sentence || findSentence(text, key) || '').trim(),
      };
    });

    for (const w of words) {
      if (!entries.some((e) => e.word === w.word.toLowerCase())) {
        entries.push({
          word: w.word.toLowerCase(),
          phonetic: w.phonetic || '',
          meaning: w.meaning || '',
          sentence: findSentence(text, w.word),
        });
      }
    }

    return {
      title: String(raw.title || 'Untitled').trim(),
      paragraphs,
      words: entries,
      translations: normalizeTranslations(raw.translations),
      engine,
      text,
      missing: words.filter((w) => !containsWord(text, w.word)).map((w) => w.word),
    };
  }

  /* ---------------- 离线兜底 ---------------- */

  const POS_TEMPLATES = {
    n: [
      (w) => `The ${w} was the last thing she expected to find in that drawer.`,
      (w) => `Nobody could explain the ${w}, and the room went quiet.`,
      (w) => `He kept talking about the ${w} as if it were a person.`,
      (w) => `By morning the ${w} had become the only thing anyone remembered.`,
    ],
    v: [
      (w) => `She decided to ${w} before the sun came up.`,
      (w) => `They did not want to ${w}, but there was no other way.`,
      (w) => `I tried to ${w} anyway, and it turned out to be a mistake.`,
      (w) => `He was too tired to ${w}, so he sat down instead.`,
    ],
    adj: [
      (w) => `The room felt ${w} in the early morning light.`,
      (w) => `It was a ${w} answer, and everyone noticed.`,
      (w) => `She sounded ${w} on the phone, which surprised me.`,
      (w) => `The whole street looked ${w} after the rain.`,
    ],
    adv: [
      (w) => `He spoke ${w}, and nobody interrupted him.`,
      (w) => `She closed the door ${w} and stood still.`,
      (w) => `They finished the work ${w}, long before dark.`,
    ],
  };

  const FALLBACK_TEMPLATES = [
    (w) => `The word "${w}" was written on the board, and I copied it twice.`,
    (w) => `I still cannot remember what "${w}" means, though I have seen it often.`,
    (w) => `"${w}", she said slowly, as if testing the sound of it.`,
    (w) => `Every time I meet "${w}" in a text, I stop for a second.`,
  ];

  function guessPos(meaning) {
    const m = String(meaning || '').trim().toLowerCase();
    const hit = m.match(/^(n|vt|vi|v|adj|adv|prep|conj|pron|num|art|int)\./);
    if (!hit) return null;
    const tag = hit[1];
    if (tag === 'n') return 'n';
    if (tag === 'v' || tag === 'vt' || tag === 'vi') return 'v';
    if (tag === 'adj') return 'adj';
    if (tag === 'adv') return 'adv';
    return null;
  }

  function offlineArticle(words, opts) {
    const wordsPerSentence = Math.max(1, Math.min(5, Number((opts || {}).wordsPerSentence) || 3));
    const counters = { n: 0, v: 0, adj: 0, adv: 0, '': 0 };

    const sentences = words.map((w) => {
      const pos = guessPos(w.meaning) || '';
      const bank = POS_TEMPLATES[pos] || FALLBACK_TEMPLATES;
      const seq = counters[pos]++;
      return bank[seq % bank.length](w.word);
    });

    const paragraphs = [];
    const perPara = Math.max(2, wordsPerSentence * 2);
    for (let i = 0; i < sentences.length; i += perPara) {
      paragraphs.push(sentences.slice(i, i + perPara).join(' '));
    }
    if (!paragraphs.length) paragraphs.push('No words were provided.');

    const text = paragraphs.join('\n\n');
    return {
      title: `Practice Set: ${words.slice(0, 3).map((w) => w.word).join(', ')}`,
      paragraphs,
      words: words.map((w) => ({
        word: w.word,
        phonetic: w.phonetic || '',
        meaning: w.meaning || '',
        sentence: findSentence(text, w.word),
      })),
      engine: 'offline',
      text,
      missing: words.filter((w) => !containsWord(text, w.word)).map((w) => w.word),
    };
  }

  /**
   * 给没有释义的单词补上音标和中文释义（用模型，一次 40 个）。
   * 返回 { items: [{word, phonetic, meaning}], failed: [{word, error}] }
   */
  async function enrichWords(words, llm) {
    const list = (words || []).filter((w) => w && w.word);
    if (!list.length) return { items: [], failed: [] };
    if (!llm || !llm.apiKey || !llm.baseUrl) {
      const err = new Error('需要先配置模型才能自动补全释义');
      err.code = 'NO_LLM';
      throw err;
    }

    const items = [];
    const failed = [];

    for (let i = 0; i < list.length; i += 40) {
      const chunk = list.slice(i, i + 40);
      const messages = [
        {
          role: 'system',
          content:
            '你是英语词典编辑。给用户提供的英文单词标注 IPA 音标和中文释义。' +
            '只输出 JSON 数组，不要任何解释或代码块标记。',
        },
        {
          role: 'user',
          content: [
            '为下面每个单词给出：',
            '- phonetic：英式或美式 IPA，用 / / 包起来',
            '- meaning：中文释义，必须以词性缩写开头，如 "v. 放弃；抛弃"、"adj. 易碎的"；若有多个词性，用分号隔开',
            '',
            '单词列表：',
            chunk.map((w) => w.word).join(', '),
            '',
            '输出格式（数组长度必须与单词数量一致，顺序一致）：',
            '[{"word":"abandon","phonetic":"/əˈbændən/","meaning":"v. 放弃；抛弃"}]',
          ].join('\n'),
        },
      ];

      try {
        const content = await callLLM(messages, llm);
        const raw = extractJson(content);
        const arr = Array.isArray(raw) ? raw : raw && Array.isArray(raw.words) ? raw.words : [];
        const want = new Set(chunk.map((w) => w.word.toLowerCase()));

        for (const e of arr) {
          if (!e || typeof e !== 'object') continue;
          const key = String(e.word || '').trim().toLowerCase();
          if (!want.has(key)) continue;
          items.push({
            word: key,
            phonetic: String(e.phonetic || '').trim(),
            meaning: String(e.meaning || '').trim(),
          });
        }
      } catch (err) {
        for (const w of chunk) failed.push({ word: w.word, error: err.message });
      }
    }

    return { items, failed };
  }

  async function generateArticle(words, opts, llm) {
    if (!words.length) throw new Error('没有可用的单词');
    llm = llm || {};

    if (llm.apiKey && llm.baseUrl) {
      const content = await callLLM(buildPrompt(words, opts), llm);
      const raw = extractJson(content);
      if (!raw) {
        const err = new Error('模型返回的不是合法 JSON，可稍后重试或换一个模型');
        err.code = 'LLM_BAD_JSON';
        err.raw = content.slice(0, 500);
        throw err;
      }
      return normalizeArticle(raw, words, llm.model || 'llm');
    }

    return offlineArticle(words, opts);
  }

  return {
    LEVELS,
    STYLES,
    buildPrompt,
    extractJson,
    normalizeArticle,
    offlineArticle,
    findSentence,
    containsWord,
    splitSentences,
    sentenceKey,
    normalizeTranslations,
    enrichWords,
    generateArticle,
  };
});
