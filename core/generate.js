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
          '输出 JSON，字段如下：',
          '{',
          '  "title": "英文标题（不超过 10 词）",',
          '  "paragraphs": ["第一段", "第二段", "..."],',
          '  "words": [',
          '    {"word": "单词原形", "phonetic": "音标，不确定就留空", "meaning": "中文释义，含词性", "sentence": "文中出现该词的那一句原文"}',
          '  ]',
          '}',
        ].filter(Boolean).join('\n'),
      },
    ];
  }

  function extractJson(text) {
    if (!text) return null;
    let s = String(text).trim();
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
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

  function findSentence(text, word) {
    if (!word) return '';
    const re = new RegExp(`\\b${escapeRe(word)}\\w{0,3}\\b`, 'i');
    const sentences = String(text).split(/(?<=[.!?])\s+/);
    const hit = sentences.find((s) => re.test(s));
    return hit ? hit.trim() : '';
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
    generateArticle,
  };
});
