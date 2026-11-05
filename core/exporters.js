/**
 * 导出：Markdown / HTML / 纯文本 / Word(.docx) —— 浏览器与 Node 通用（UMD）
 *
 * docx 用"不压缩"的 zip 直接拼（store 方式），不需要 zlib，浏览器里也能用。
 * 文件大一点（几十 KB），但兼容性和简单性更重要。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WordExport = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const enc = new TextEncoder();

  function escapeRe(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function wordRegex(words) {
    const list = (words || []).map((w) => escapeRe(w.word || w)).filter(Boolean);
    if (!list.length) return null;
    return new RegExp(`\\b(${list.join('|')})(s|es|ed|d|ing|ly)?\\b`, 'gi');
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function escapeXml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  }

  function dateLabel(d) {
    const dt = d ? new Date(d) : new Date();
    return dt.toLocaleDateString('zh-CN');
  }

  /* ---------------- Markdown ---------------- */

  function toMarkdown(article) {
    const lines = [];
    lines.push(`# ${article.title}`);
    lines.push('');
    lines.push(`> ${dateLabel(article.createdAt)} · ${article.words.length} 个目标词 · 难度 ${article.level || '-'}`);
    lines.push('');

    const re = wordRegex(article.words);
    for (const p of article.paragraphs) {
      lines.push(re ? p.replace(re, '**$&**') : p);
      lines.push('');
    }

    lines.push('---');
    lines.push('');
    lines.push('## 本文字词');
    lines.push('');
    lines.push('| 单词 | 音标 | 释义 | 文中例句 |');
    lines.push('| --- | --- | --- | --- |');
    for (const w of article.words) {
      const cell = (s) => String(s || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
      lines.push(`| **${cell(w.word)}** | ${cell(w.phonetic)} | ${cell(w.meaning)} | ${cell(w.sentence)} |`);
    }
    lines.push('');
    return lines.join('\n');
  }

  /* ---------------- HTML ---------------- */

  function toHtml(article) {
    const re = wordRegex(article.words);
    const body = article.paragraphs
      .map((p) => {
        const html = escapeHtml(p);
        return `<p>${re ? html.replace(re, '<mark class="target">$&</mark>') : html}</p>`;
      })
      .join('\n');

    const rows = article.words
      .map(
        (w) => `<tr>
      <td class="w">${escapeHtml(w.word)}</td>
      <td class="p">${escapeHtml(w.phonetic)}</td>
      <td>${escapeHtml(w.meaning)}</td>
      <td class="s">${escapeHtml(w.sentence)}</td>
    </tr>`
      )
      .join('\n');

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(article.title)}</title>
<style>
  body { max-width: 760px; margin: 48px auto; padding: 0 24px 80px;
         font: 17px/1.85 Georgia, "Songti SC", serif; color: #1c1c1e; background: #fdfcf9; }
  h1 { font-size: 30px; line-height: 1.3; margin-bottom: 6px; }
  .meta { color: #8a8a8e; font-size: 13px; margin-bottom: 28px; }
  p { margin: 0 0 18px; }
  mark.target { background: linear-gradient(transparent 62%, #ffe27a 62%); color: inherit; font-weight: 600; }
  h2 { font-size: 18px; margin: 40px 0 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; font-family: -apple-system, "Microsoft YaHei", sans-serif; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #e6e3dc; vertical-align: top; }
  th { color: #8a8a8e; font-weight: 600; font-size: 12px; text-transform: uppercase; }
  td.w { font-weight: 700; }
  td.p { color: #6b6b70; font-family: Georgia, serif; }
  td.s { color: #4a4a4f; font-size: 13px; }
  @media print { body { margin: 0; } mark.target { background: #f5f5f5; } }
</style>
</head>
<body>
  <h1>${escapeHtml(article.title)}</h1>
  <div class="meta">${dateLabel(article.createdAt)} · ${article.words.length} 个目标词 · 难度 ${escapeHtml(article.level || '-')}</div>
  ${body}
  <h2>本文字词</h2>
  <table>
    <thead><tr><th>单词</th><th>音标</th><th>释义</th><th>文中例句</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
</body>
</html>`;
  }

  /* ---------------- TXT ---------------- */

  function toText(article) {
    const out = [];
    out.push(article.title);
    out.push('='.repeat(Math.min(60, article.title.length)));
    out.push(`${dateLabel(article.createdAt)} · ${article.words.length} 个目标词`);
    out.push('');
    for (const p of article.paragraphs) {
      out.push(p);
      out.push('');
    }
    out.push('-'.repeat(40));
    out.push('单词表');
    out.push('');
    for (const w of article.words) {
      out.push(`${w.word}${w.phonetic ? '  ' + w.phonetic : ''}   ${w.meaning || ''}`);
      if (w.sentence) out.push(`    例：${w.sentence}`);
    }
    out.push('');
    return out.join('\n');
  }

  /* ---------------- zip（不压缩） ---------------- */

  const CRC_TABLE = (() => {
    const t = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[i] = c;
    }
    return t;
  })();

  function crc32(bytes) {
    let crc = -1;
    for (let i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xff];
    return (crc ^ -1) >>> 0;
  }

  function dosDateTime(d) {
    const dt = d || new Date();
    const time = ((dt.getHours() & 0x1f) << 11) | ((dt.getMinutes() & 0x3f) << 5) | (((dt.getSeconds() / 2) | 0) & 0x1f);
    const date = (((dt.getFullYear() - 1980) & 0x7f) << 9) | (((dt.getMonth() + 1) & 0x0f) << 5) | (dt.getDate() & 0x1f);
    return { time, date };
  }

  function zipStore(files) {
    const { time, date } = dosDateTime();
    const locals = [];
    const centrals = [];
    let offset = 0;

    for (const f of files) {
      const nameBytes = enc.encode(f.name);
      const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
      const crc = crc32(data);

      const local = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x0800, true);
      lv.setUint16(8, 0, true); // 0 = store
      lv.setUint16(10, time, true);
      lv.setUint16(12, date, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      local.set(nameBytes, 30);

      const central = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(central.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, time, true);
      cv.setUint16(14, date, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      central.set(nameBytes, 46);

      locals.push(local, data);
      centrals.push(central);
      offset += local.length + data.length;
    }

    const centralSize = centrals.reduce((n, c) => n + c.length, 0);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);

    const parts = [...locals, ...centrals, eocd];
    const total = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let pos = 0;
    for (const p of parts) {
      out.set(p, pos);
      pos += p.length;
    }
    return out;
  }

  /* ---------------- DOCX ---------------- */

  function run(text, opts) {
    const o = opts || {};
    const props = [
      o.bold ? '<w:b/>' : '',
      o.italic ? '<w:i/>' : '',
      `<w:sz w:val="${o.size || 22}"/><w:szCs w:val="${o.size || 22}"/>`,
      o.color ? `<w:color w:val="${o.color}"/>` : '',
      '<w:rFonts w:ascii="Georgia" w:hAnsi="Georgia" w:eastAsia="Microsoft YaHei"/>',
    ].join('');
    return `<w:r><w:rPr>${props}</w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
  }

  function para(content, opts) {
    const o = opts || {};
    const pPr = [
      `<w:spacing w:before="${o.before || 0}" w:after="${o.after === undefined ? 160 : o.after}" w:line="${o.spacing || 360}" w:lineRule="auto"/>`,
      o.indent ? `<w:ind w:firstLine="${o.indent}"/>` : '',
      o.jc ? `<w:jc w:val="${o.jc}"/>` : '',
    ].join('');
    return `<w:p><w:pPr>${pPr}</w:pPr>${content}</w:p>`;
  }

  function runsFor(text, re) {
    if (!re) return run(text);
    const parts = [];
    let last = 0;
    const rx = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    let m;
    while ((m = rx.exec(text)) !== null) {
      if (m.index > last) parts.push(run(text.slice(last, m.index)));
      parts.push(run(m[0], { bold: true }));
      last = m.index + m[0].length;
      if (m.index === rx.lastIndex) rx.lastIndex++;
    }
    if (last < text.length) parts.push(run(text.slice(last)));
    return parts.length ? parts.join('') : run(text);
  }

  function toDocx(article) {
    const re = wordRegex(article.words);
    const body = [];

    body.push(para(run(article.title, { bold: true, size: 40 }), { after: 80, spacing: 300 }));
    body.push(
      para(
        run(`${dateLabel(article.createdAt)} · ${article.words.length} 个目标词 · 难度 ${article.level || '-'}`,
          { size: 18, color: '8A8A8E' }),
        { after: 320 }
      )
    );

    for (const p of article.paragraphs) {
      body.push(para(runsFor(p, re), { after: 200 }));
    }

    body.push(para(run('本文字词', { bold: true, size: 28 }), { before: 320, after: 160 }));

    for (const w of article.words) {
      const head = `${w.word}${w.phonetic ? '  ' + w.phonetic : ''}`;
      body.push(para(run(head, { bold: true, size: 22, color: '1C1C1E' }), { after: 20, spacing: 280 }));
      if (w.meaning) body.push(para(run(w.meaning, { size: 20 }), { after: 20, spacing: 280 }));
      if (w.sentence) body.push(para(run(w.sentence, { size: 20, italic: true, color: '4A4A4F' }), { after: 180, spacing: 280 }));
    }

    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${body.join('\n    ')}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1418" w:right="1418" w:bottom="1418" w:left="1418" w:header="851" w:footer="992" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;

    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

    const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

    const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault><w:rPr>
      <w:rFonts w:ascii="Georgia" w:hAnsi="Georgia" w:eastAsia="Microsoft YaHei"/>
      <w:sz w:val="22"/><w:szCs w:val="22"/>
    </w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault>
  </w:docDefaults>
</w:styles>`;

    return zipStore([
      { name: '[Content_Types].xml', data: contentTypes },
      { name: '_rels/.rels', data: rels },
      { name: 'word/document.xml', data: documentXml },
      { name: 'word/_rels/document.xml.rels', data: docRels },
      { name: 'word/styles.xml', data: styles },
    ]);
  }

  return { toMarkdown, toHtml, toText, toDocx, zipStore, crc32 };
});
