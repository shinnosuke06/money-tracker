/*
 * Excel の過去記録の取り込み:表の読み取り(画面には触らない)
 *
 * 取り込める表:1 列目が項目名(カード名)、2 列目以降が月ごとの金額。
 *   - 貼り付け(Excel からコピーしたタブ区切り、またはカンマ区切り)と、CSV ファイル(UTF-8 / Shift_JIS)
 *   - 見出しの月名には頼らない。画面で「最初の月列の年月」を指定し、右へ 1 か月ずつ進める
 *     (見出しに「合計」「年間」「平均」を含む列は、オンにしたときだけ月として数える)
 *   - 金額:「1,234」「¥1,234」は整数、「-」と空欄は未入力、「0」は 0。
 *     マイナスは「-1,234」「△1,234」「▲1,234」「(1,234)」
 *   - 項目名が空の行と、記号(●など)だけの列は無視する。項目名の先頭の記号も外す
 */
(function (root) {
  'use strict';
  const MT = (root.MT = root.MT || {});
  const U = MT.util;

  const NAME_MAX = 40;
  // 行頭の印として使われる記号(金額のマイナスに使う △▲ と「-」は入れない)
  const MARKS = '●○◎◉◯■□◆◇★☆※・•＊*✓✔';
  const MARK_ONLY_RE = new RegExp(`^[${MARKS}\\s]+$`);
  const LEAD_MARK_RE = new RegExp(`^[${MARKS}\\s]+`);
  const SUMMARY_COL_RE = /合計|年間|平均/;
  // 見出しらしい値(年・月・日付・幅が足りないときの「#####」)
  const HEADERISH_RE = /[年月]|#{3,}|\d{4}[/.-]\d{1,2}/;
  const HEADER_NAME_RE = /^(項目|項目名|口座|口座名|名前|名称|科目|カード|カード名|年|月|年月)$/;

  /** 全角の英数字・記号を半角に(金額の読み取り用) */
  function toHalf(s) {
    return String(s)
      .replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .replace(/[，]/g, ',')
      .replace(/[．]/g, '.')
      .replace(/[（]/g, '(')
      .replace(/[）]/g, ')')
      .replace(/　/g, ' ');
  }

  // ---------------------------------------------------------------
  // 文字コード
  // ---------------------------------------------------------------

  /**
   * ファイルの中身(バイト列)を文字にする。encoding: 'auto' / 'utf-8' / 'shift_jis'
   * 自動のときは UTF-8 として読めなければ Shift_JIS にする。
   * @returns {{ok: true, text: string, encoding: string} | {ok: false, error: string}}
   */
  function decodeBytes(buf, encoding = 'auto') {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const tryDecode = (enc, fatal) => {
      try {
        return new TextDecoder(enc, { fatal }).decode(bytes);
      } catch (e) {
        return null;
      }
    };
    const done = (text, enc) => ({ ok: true, text: text.replace(/^﻿/, ''), encoding: enc });
    if (encoding === 'utf-8' || encoding === 'shift_jis') {
      const t = tryDecode(encoding, false);
      return t === null ? { ok: false, error: 'この文字コードでは読めませんでした。' } : done(t, encoding);
    }
    const utf8 = tryDecode('utf-8', true);
    if (utf8 !== null) return done(utf8, 'utf-8');
    const sjis = tryDecode('shift_jis', false);
    if (sjis !== null) return done(sjis, 'shift_jis');
    return { ok: false, error: 'ファイルの文字を読み取れませんでした。UTF-8 か Shift_JIS の CSV を選んでください。' };
  }

  // ---------------------------------------------------------------
  // 区切り文字の表(タブ区切り・カンマ区切り。"…" で囲んだ値も読む)
  // ---------------------------------------------------------------

  function detectDelimiter(text) {
    const lines = String(text).split(/\r?\n/).filter((l) => l.trim()).slice(0, 20);
    return lines.some((l) => l.includes('\t')) ? '\t' : ',';
  }

  /** テキストを行と列の二次元配列にする。最後の空行は落とす */
  function parseDelimited(text, delimiter) {
    const s = String(text == null ? '' : text).replace(/^﻿/, '');
    const delim = delimiter || detectDelimiter(s);
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    let i = 0;
    const endField = () => {
      row.push(field);
      field = '';
    };
    const endRow = () => {
      endField();
      rows.push(row);
      row = [];
    };
    while (i < s.length) {
      const c = s[i];
      if (quoted) {
        if (c === '"') {
          if (s[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          quoted = false;
          i++;
          continue;
        }
        field += c;
        i++;
        continue;
      }
      if (c === '"' && field === '') {
        quoted = true;
        i++;
      } else if (c === delim) {
        endField();
        i++;
      } else if (c === '\r' || c === '\n') {
        endRow();
        i += c === '\r' && s[i + 1] === '\n' ? 2 : 1;
      } else {
        field += c;
        i++;
      }
    }
    if (field !== '' || row.length) endRow();
    while (rows.length && rows[rows.length - 1].every((x) => String(x).trim() === '')) rows.pop();
    return rows;
  }

  // ---------------------------------------------------------------
  // 値の読み取り
  // ---------------------------------------------------------------

  /**
   * 金額のセルを読む。空欄・「-」は未入力(null)。小数は円に丸める。
   * @returns {{ok: true, value: number|null} | {ok: false}}
   */
  function parseAmount(raw) {
    let s = toHalf(raw == null ? '' : raw).trim();
    s = s.replace(/[\s,¥￥円\\]/g, '');
    if (s === '' || /^[-−－‐–—ー]+$/.test(s)) return { ok: true, value: null };
    let neg = false;
    const paren = /^\((.*)\)$/.exec(s);
    if (paren) {
      neg = true;
      s = paren[1];
    }
    if (/^[△▲]/.test(s)) {
      neg = !neg;
      s = s.slice(1);
    }
    if (/^[-−－‐–—]/.test(s)) {
      neg = !neg;
      s = s.slice(1);
    }
    if (!/^\d+(\.\d+)?$/.test(s)) return { ok: false };
    let v = Math.round(Number(s));
    if (neg) v = -v;
    if (v === 0) v = 0; // -0 を 0 に
    return U.isYenValue(v) ? { ok: true, value: v } : { ok: false };
  }

  /** 項目名:前後の空白と先頭の記号(●など)を外す */
  function cleanName(raw) {
    return String(raw == null ? '' : raw)
      .replace(/\s+/g, ' ')
      .trim()
      .replace(LEAD_MARK_RE, '')
      .trim()
      .slice(0, NAME_MAX);
  }

  /** 名前の照合用(空白を除き、英数字を半角に) */
  function nameKey(s) {
    return toHalf(s).replace(/\s+/g, '').toUpperCase();
  }

  // ---------------------------------------------------------------
  // 表の解釈
  // ---------------------------------------------------------------

  /**
   * 表を読み、項目名の列・月の列・見出しの行・データの行に分ける。
   * @param {string|string[][]} input テキスト、または行と列の配列
   * @returns {{ok: false, error: string} | {
   *   ok: true, nameCol: number, headerRows: number,
   *   columns: {col: number, header: string, summary: boolean, blank: boolean}[],
   *   rows: {line: number, name: string, values: (number|null)[], bad: {index: number, raw: string}[]}[],
   *   issues: string[], ignoredCols: number[] }}
   */
  function analyze(input) {
    const grid = Array.isArray(input) ? input : parseDelimited(input);
    const width = grid.reduce((w, r) => Math.max(w, r.length), 0);
    if (!grid.length || !width) return { ok: false, error: '表が空です。Excel で範囲を選んでコピーし、貼り付けてください。' };
    const cell = (r, c) => (grid[r] && grid[r][c] != null ? String(grid[r][c]).trim() : '');

    // 列の種類:空の列、記号だけの列
    const kinds = [];
    for (let c = 0; c < width; c++) {
      let filled = 0;
      let marks = 0;
      for (let r = 0; r < grid.length; r++) {
        const v = cell(r, c);
        if (!v) continue;
        filled++;
        if (MARK_ONLY_RE.test(v)) marks++;
      }
      kinds.push(filled === 0 ? 'empty' : marks === filled ? 'marks' : 'data');
    }
    const nameCol = kinds.indexOf('data');
    if (nameCol < 0) return { ok: false, error: '項目名の列が見つかりません。' };
    const cand = [];
    for (let c = nameCol + 1; c < width; c++) if (kinds[c] === 'data') cand.push(c);
    if (!cand.length) return { ok: false, error: '金額の列が見つかりません。2 列目以降に月ごとの金額がある表にしてください。' };
    const ignoredCols = kinds.map((k, c) => (k === 'marks' ? c : -1)).filter((c) => c >= 0);

    // 見出しの行:金額の入った最初の行より上
    const headerish = (r) => HEADER_NAME_RE.test(cleanName(cell(r, nameCol))) || cand.some((c) => HEADERISH_RE.test(cell(r, c)));
    let first = -1;
    for (let r = 0; r < grid.length && first < 0; r++) {
      if (!cleanName(cell(r, nameCol)) || headerish(r)) continue;
      if (cand.some((c) => {
        const a = parseAmount(cell(r, c));
        return a.ok && a.value !== null;
      })) first = r;
    }
    if (first < 0) return { ok: false, error: '金額の入った行が見つかりません。' };

    const columns = cand.map((c) => {
      const header = [];
      for (let r = 0; r < first; r++) if (cell(r, c)) header.push(cell(r, c));
      const text = header.join(' ');
      return { col: c, header: text, summary: SUMMARY_COL_RE.test(text), blank: true };
    });

    const rows = [];
    const issues = [];
    for (let r = first; r < grid.length; r++) {
      const name = cleanName(cell(r, nameCol));
      if (!name) continue; // 項目名が空の行は無視
      const values = [];
      const bad = [];
      columns.forEach((col, j) => {
        const raw = cell(r, col.col);
        const a = parseAmount(raw);
        if (a.ok) values.push(a.value);
        else {
          values.push(null);
          bad.push({ index: j, raw });
        }
        if (a.ok && a.value !== null) col.blank = false;
      });
      if (bad.length) {
        const sample = bad.slice(0, 3).map((b) => `「${b.raw.slice(0, 20)}」`).join('');
        issues.push(`${r + 1}行目「${name}」:読めない値 ${bad.length}件 ${sample} は空欄として扱います`);
      }
      rows.push({ line: r + 1, name, values, bad });
    }
    if (!rows.length) return { ok: false, error: '取り込める行がありません。' };
    return { ok: true, nameCol, headerRows: first, columns, rows, issues, ignoredCols };
  }

  /** 列の既定のオン/オフ:「合計」などの列と、全部空欄の列はオフ */
  function defaultColumnsOn(columns) {
    return columns.map((c) => !c.summary && !c.blank);
  }

  /**
   * 列ごとの年月。startYM から、数える列に 1 か月ずつ割り当てる。
   * 「合計」などの列は、オンのときだけ数える(オフなら null)。
   */
  function assignMonths(columns, startYM, on) {
    let k = 0;
    return columns.map((c, j) => (c.summary && !on[j] ? null : U.ymAdd(startYM, k++)));
  }

  /**
   * 最初の月列の年月の初期値(画面で直してもらう前提の推測)。
   * 見出しに年と月があればそれ、月だけなら「金額のある最後の列が今月を超えない、いちばん新しい年」、
   * 何もなければ「金額のある最後の列が先月」になるようにする。
   */
  function guessStartYM(table, now = new Date()) {
    const cur = U.currentYM(now);
    const counted = table.columns.filter((c) => !c.summary);
    if (!counted.length) return U.ymAdd(cur, -1);
    let lastFilled = 0;
    counted.forEach((c, i) => {
      if (!c.blank) lastFilled = i;
    });
    const head = toHalf(counted[0].header);
    const ymMatch = /(\d{4})[/.-](\d{1,2})/.exec(head);
    const yMatch = /(\d{4})\s*年/.exec(head);
    const mMatch = /(\d{1,2})\s*月/.exec(head);
    const y = ymMatch ? Number(ymMatch[1]) : yMatch ? Number(yMatch[1]) : null;
    const m = ymMatch ? Number(ymMatch[2]) : mMatch ? Number(mMatch[1]) : null;
    if (m >= 1 && m <= 12 && y >= 1990 && y <= 2100) return U.makeYM(y, m);
    if (m >= 1 && m <= 12) {
      let ym = U.makeYM(U.splitYM(cur).y, m);
      while (U.ymAdd(ym, lastFilled) > cur) ym = U.ymAdd(ym, -12);
      return ym;
    }
    return U.ymAdd(cur, -1 - lastFilled);
  }

  MT.importTable = { decodeBytes, detectDelimiter, parseDelimited, parseAmount, cleanName, nameKey, analyze, defaultColumnsOn, assignMonths, guessStartYM };
})(typeof window !== 'undefined' ? window : globalThis);
