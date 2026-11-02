/*
 * 旧・副業管理アプリのバックアップ(JSON / .txt)を、新しい副業の形に変換する
 *
 * 3 つの形を自動で見分ける:
 *  ① [設定配列(6要素), 記録配列]
 *     設定 [A名, A基本額(万), A内容, B名, B基本額(万), B内容]
 *     記録 [yymmdd, 0=A/1=B, 金額(万), 0/1(入金確認), 内容(文字列、または 1=Aの既定内容 / 2=Bの既定内容)]
 *  ② [記録配列, 設定配列]
 *     記録 [id, "YYYY-MM-DD", "A"/"B", 金額(万), 入金確認, 内容]
 *  ③ { jobs: [{ id, date, company, amount, status, description }],
 *      settings: { companyA: { name, defaultAmount, defaultDesc }, companyB: {...} } }   status は "done" / "plan"
 * 万円の小数は、文字列のまま桁をずらして円の整数にする(0.1 の足し算の誤差を出さない)。
 * 過去の記録の内容は文章のまま残し、作業項目には分けない。
 */
(function (root) {
  'use strict';
  const MT = (root.MT = root.MT || {});
  const U = MT.util;
  const SM = MT.sidejobModel;

  const str = (v) => (v == null ? '' : String(v));

  function parse(textValue) {
    let obj;
    try {
      obj = JSON.parse(str(textValue).replace(/^﻿/, '').trim());
      if (typeof obj === 'string') obj = JSON.parse(obj);
    } catch (e) {
      return { ok: false, error: 'JSON として読み取れませんでした。バックアップの文字をすべてコピーしたか確認してください。' };
    }
    const format = detect(obj);
    if (!format) return { ok: false, error: '旧・副業管理アプリのバックアップの形ではありません(3 つの形のどれにも当てはまりません)。' };
    return { ok: true, obj, format };
  }

  const isScalar = (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v);
  const isSettingsArray = (s) => Array.isArray(s) && s.length >= 6 && s.slice(0, 6).every(isScalar);
  const isRecordArray = (r) => Array.isArray(r) && r.every(Array.isArray);

  /** 形を見分ける:'settingsFirst'(①)/ 'recordsFirst'(②)/ 'object'(③)/ null */
  function detect(obj) {
    if (obj && !Array.isArray(obj) && typeof obj === 'object' && Array.isArray(obj.jobs)) return 'object';
    if (Array.isArray(obj) && obj.length >= 2) {
      if (isSettingsArray(obj[0]) && isRecordArray(obj[1])) return 'settingsFirst';
      if (isRecordArray(obj[0]) && isSettingsArray(obj[1])) return 'recordsFirst';
    }
    return null;
  }

  /** 万円 → 円の整数(文字列で桁をずらすので誤差が出ない)。読めなければ null */
  function manToYen(v) {
    const s = str(v).trim().replace(/[,，万円]/g, '');
    const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
    if (!m) return null;
    const frac = (m[3] || '').padEnd(4, '0');
    let n = Number(m[2]) * 10000 + Number(frac.slice(0, 4));
    if (frac.length > 4 && Number(frac[4]) >= 5) n += 1; // 1 円未満は四捨五入
    n = m[1] ? -n : n;
    return U.isYenValue(n) ? n : null;
  }

  /** yymmdd(数値・文字列)→ "20yy-mm-dd" */
  function yymmdd(v) {
    const s = str(v).trim().padStart(6, '0');
    if (!/^\d{6}$/.test(s)) return null;
    const out = `20${s.slice(0, 2)}-${s.slice(2, 4)}-${s.slice(4, 6)}`;
    return U.isDateStr(out) ? out : null;
  }

  function isoDate(v) {
    const m = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/.exec(str(v).trim());
    if (!m) return null;
    const out = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    return U.isDateStr(out) ? out : null;
  }

  const truthy = (v) => v === 1 || v === true || v === '1' || v === 'true';

  /**
   * 変換する。今のデータ(current)は書き換えず、新しいデータ全体を返す。
   * 副業の区画(依頼元・記録・予定)は置き換える。
   */
  function convert(parsed, current) {
    const { obj, format } = parsed;
    const data = JSON.parse(JSON.stringify(current));
    const issues = [];
    const notes = [];
    const defs = { A: null, B: null }; // { name, base, desc }

    // ---- 設定 ----
    if (format === 'object') {
      const s = obj.settings && typeof obj.settings === 'object' ? obj.settings : {};
      for (const k of ['A', 'B']) {
        const c = s[`company${k}`];
        if (c && typeof c === 'object') defs[k] = { name: str(c.name).trim(), base: c.defaultAmount, desc: str(c.defaultDesc).trim() };
      }
    } else {
      const s = format === 'settingsFirst' ? obj[0] : obj[1];
      defs.A = { name: str(s[0]).trim(), base: s[1], desc: str(s[2]).trim() };
      defs.B = { name: str(s[3]).trim(), base: s[4], desc: str(s[5]).trim() };
    }

    // ---- 記録 ----
    const rows = []; // { id, date, key: 'A'|'B', amount, confirmed, content }
    const push = (where, row) => {
      if (!row.date) return issues.push(`${where}:日付を読み取れないため、読み込みませんでした`);
      if (!row.key) return issues.push(`${where}:依頼元が A か B か分からないため、読み込みませんでした`);
      if (row.amount == null) return issues.push(`${where}:金額を読み取れないため、読み込みませんでした`);
      rows.push(row);
    };
    const contentOf = (desc, where) => {
      if (desc === 1 || desc === '1') return defs.A ? defs.A.desc : '';
      if (desc === 2 || desc === '2') return defs.B ? defs.B.desc : '';
      if (typeof desc === 'string') return desc;
      if (desc == null) return '';
      issues.push(`${where}:内容「${str(desc)}」を読み取れないため空にしました`);
      return '';
    };

    if (format === 'settingsFirst') {
      obj[1].forEach((r, i) => {
        const where = `記録 ${i + 1}件目`;
        push(where, {
          id: `rec_l${i}`,
          date: yymmdd(r[0]),
          key: r[1] === 0 || r[1] === '0' ? 'A' : r[1] === 1 || r[1] === '1' ? 'B' : null,
          amount: manToYen(r[2]),
          confirmed: truthy(r[3]),
          content: contentOf(r[4], where),
        });
      });
    } else if (format === 'recordsFirst') {
      obj[0].forEach((r, i) => {
        const where = `記録 ${i + 1}件目`;
        const k = str(r[2]).trim().toUpperCase();
        push(where, {
          id: `rec_${str(r[0]) || `l${i}`}`,
          date: isoDate(r[1]),
          key: k === 'A' || k === 'B' ? k : null,
          amount: manToYen(r[3]),
          confirmed: truthy(r[4]),
          content: contentOf(r[5], where),
        });
      });
    } else {
      let plans = 0;
      obj.jobs.forEach((j, i) => {
        const where = `記録 ${i + 1}件目`;
        if (!j || typeof j !== 'object') return issues.push(`${where}:中身を読み取れないため、読み込みませんでした`);
        const c = str(j.company).trim();
        let key = null;
        if (/^(company)?A$/i.test(c) || (defs.A && c && c === defs.A.name)) key = 'A';
        else if (/^(company)?B$/i.test(c) || (defs.B && c && c === defs.B.name)) key = 'B';
        if (j.status !== 'done' && j.status !== 'plan') issues.push(`${where}:状態「${str(j.status)}」が分からないため「未確認」にしました`);
        if (j.status === 'plan') plans++;
        push(where, { id: `rec_${str(j.id) || `l${i}`}`, date: isoDate(j.date), key, amount: manToYen(j.amount), confirmed: j.status === 'done', content: contentOf(j.description, where) });
      });
      if (plans) notes.push(`状態が "plan" の記録 ${plans}件は「入金未確認」として読み込みました`);
    }

    // ---- 依頼元 ----
    const clients = [];
    const idOf = {};
    for (const k of ['A', 'B']) {
      const def = defs[k];
      const used = rows.some((r) => r.key === k);
      if (!used && !(def && def.name)) continue;
      const base = def ? manToYen(def.base) : 0;
      if (def && def.base != null && def.base !== '' && base == null) issues.push(`依頼元${k}:基本額「${str(def.base)}」を読み取れないため 0 にしました`);
      const c = SM.cleanClient({
        id: `cli_${k}`,
        name: (def && def.name) || `依頼元${k}`,
        baseAmount: base || 0,
        tasks: [],
        weekdays: [],
        memo: def && def.desc ? `旧アプリの既定の内容:${def.desc}` : '',
      });
      idOf[k] = c.id;
      clients.push(c);
    }
    if (clients.length) notes.push('作業項目と曜日パターンは旧データに無いため、「依頼元の設定」で登録してください(旧アプリの既定の内容は依頼元のメモに入れました)');

    const seen = new Set();
    const records = [];
    for (const r of rows) {
      let rid = r.id;
      while (seen.has(rid)) rid += '_';
      seen.add(rid);
      records.push(SM.cleanRecord({ id: rid, date: r.date, clientId: idOf[r.key], base: r.amount, items: [], content: r.content, memo: '', confirmed: r.confirmed }));
    }
    notes.push('過去の記録の内容は文章のまま残し、作業項目には分けていません');

    data.sidejob = { clients, records, schedule: {} };
    const total = records.reduce((t, r) => t + r.base, 0);
    return { data, report: { format, counts: { clients: clients.length, records: records.length, confirmed: records.filter((r) => r.confirmed).length, total }, issues, notes } };
  }

  MT.sidejobLegacy = { parse, detect, convert, manToYen, yymmdd };
})(typeof window !== 'undefined' ? window : globalThis);
