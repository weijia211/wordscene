/**
 * 单词解析 —— 浏览器与 Node 通用（UMD）
 *
 * 目标是"从哪儿复制的都能用"：单词 App、Excel、单词书、聊天记录……
 *
 *   abandon
 *   abandon, v. 放弃
 *   abandon\tv. 放弃
 *   abandon   v. 放弃
 *   1. abandon / 1) abandon / - abandon / • abandon
 *   abandon /əˈbændən/ v. 放弃
 *
 * 规则：每行取第一个英文词作为单词，其余文本去掉音标后当作释义；
 * 不以英文开头的行（中文说明、表头、空行）直接忽略。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WordParse = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function parseWordLines(raw) {
    const items = [];
    const lines = String(raw || '').split(/[\r\n]+/);

    for (let line of lines) {
      line = line.trim();
      if (!line) continue;
      if (line.startsWith('#')) continue;

      line = line.replace(/^\s*(?:\d{1,3}\s*[.)、]|[-*•·])\s*/, '').trim();
      if (!line) continue;

      const head = line.match(/^([a-zA-Z][a-zA-Z'’-]*)/);
      if (!head) continue;

      const word = head[1].replace(/’/g, "'").toLowerCase();
      let rest = line.slice(head[1].length);

      let phonetic = '';
      const ph = rest.match(/^\s*[\/\[]([^\/\]]{1,40})[\/\]]/);
      if (ph) {
        phonetic = ph[1].trim();
        rest = rest.slice(ph[0].length);
      }

      const meaning = rest.replace(/^[\s,，;；:：|\-–—]+/, '').replace(/\s+/g, ' ').trim();
      items.push({ word, meaning, phonetic, source: 'manual' });
    }

    return items;
  }

  return { parseWordLines };
});
