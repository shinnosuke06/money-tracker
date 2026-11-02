/*
 * 旧・ポケカ管理アプリのバックアップ(.txt)を、新しい在庫の形に変換する
 *
 * 文字列の戻し方:
 *   先頭が "LZ:" → LZ-String の decompressFromBase64 で展開
 *   それ以外    → atob と decodeURIComponent で戻す
 * 中身の JSON から inventory だけを読む:
 *   { 商品名: { quantity, purchasePrice, history: [{ date, price, store }], sales: [{ date, quantity, price }] } }
 * lotteries / settings / suggests / productMasters / sheetMeta は読み込まない。
 */
(function (root) {
  'use strict';
  const MT = (root.MT = root.MT || {});
  const U = MT.util;
  const IM = MT.inventoryModel;

  const SKIP_KEYS = ['lotteries', 'settings', 'suggests', 'productMasters', 'sheetMeta'];

  const str = (v) => (v == null ? '' : String(v));

  /** "LZ:" で始まるか(LZ-String の読み込みが必要か) */
  function needsLz(textValue) {
    return /^﻿?\s*LZ:/.test(str(textValue));
  }

  /**
   * 文字列を JSON に戻す
   * @param {string} textValue
   * @param {{decompressFromBase64: Function}|null} lz LZ-String(先頭が "LZ:" のときだけ使う)
   * @returns {{ok: true, obj} | {ok: false, error: string}}
   */
  function decode(textValue, lz) {
    const t = str(textValue).replace(/^﻿/, '').trim();
    if (!t) return { ok: false, error: 'テキストが空です。' };
    let json = null;
    if (t.startsWith('LZ:')) {
      if (!lz) return { ok: false, error: '展開に必要な部品(LZ-String)を読み込めませんでした。インターネットに接続してから試してください。' };
      try {
        json = lz.decompressFromBase64(t.slice(3).trim());
      } catch (e) {
        json = null;
      }
      if (!json) return { ok: false, error: '"LZ:" のデータを展開できませんでした。バックアップの文字をすべてコピーしたか確認してください。' };
    } else {
      const tries = [
        () => decodeURIComponent(atob(t)),
        () => decodeURIComponent(escape(atob(t))),
        () => t, // そのままの JSON にも対応
      ];
      for (const f of tries) {
        try {
          const s = f();
          JSON.parse(s);
          json = s;
          break;
        } catch (e) {
          /* 次の方法を試す */
        }
      }
      if (!json) return { ok: false, error: 'バックアップを読み取れませんでした。旧・ポケカ管理アプリの書き出したテキストか確認してください。' };
    }
    let obj;
    try {
      obj = JSON.parse(json);
    } catch (e) {
      return { ok: false, error: '展開した中身が JSON ではありませんでした。' };
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, error: '旧・ポケカ管理アプリのバックアップの形ではありません。' };
    if (!obj.inventory || typeof obj.inventory !== 'object' || Array.isArray(obj.inventory)) return { ok: false, error: '在庫(inventory)が見つかりませんでした。' };
    return { ok: true, obj };
  }

  function toDate(v) {
    const m = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/.exec(str(v).trim());
    if (!m) return null;
    const out = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    return U.isDateStr(out) ? out : null;
  }

  function yen(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : null;
    const r = U.parseYen(str(v));
    return r.ok ? r.value : null;
  }

  /**
   * 変換する。今のデータ(current)は書き換えず、新しいデータ全体を返す。
   * 置き換えるのは在庫の商品だけ(反映先の設定は残す)。
   */
  function convert(obj, current) {
    const data = JSON.parse(JSON.stringify(current));
    const issues = [];
    const notes = [];
    const items = [];
    let prices = 0;
    let sales = 0;

    for (const [rawName, v] of Object.entries(obj.inventory)) {
      const name = str(rawName).replace(/\s+/g, ' ').trim().slice(0, IM.NAME_MAX);
      if (!name) {
        issues.push('名前が空の商品があったため、読み込みませんでした');
        continue;
      }
      const where = `商品「${name}」`;
      if (!v || typeof v !== 'object') {
        issues.push(`${where}:中身が読み取れないため、読み込みませんでした`);
        continue;
      }
      let quantity = yen(v.quantity);
      if (quantity == null || quantity < 0) {
        issues.push(`${where}:個数「${str(v.quantity)}」を読み取れないため 0 にしました`);
        quantity = 0;
      }
      let unitCost = typeof v.purchasePrice === 'number' ? v.purchasePrice : U.parseDecimal(str(v.purchasePrice), 2).value;
      if (unitCost == null || !(unitCost >= 0)) {
        if (v.purchasePrice != null && v.purchasePrice !== '') issues.push(`${where}:購入単価「${str(v.purchasePrice)}」を読み取れないため 0 にしました`);
        unitCost = 0;
      }
      const item = { name, quantity, unitCost, priority: 'first', prices: [], sales: [], memo: '' };
      (Array.isArray(v.history) ? v.history : []).forEach((h, i) => {
        const date = toDate(h && h.date);
        const price = yen(h && h.price);
        if (!date || price == null || price < 0) return issues.push(`${where}:相場の記録 ${i + 1}件目(${str(h && h.date)} ${str(h && h.price)})を読み取れませんでした`);
        item.prices.push({ date, price, store: str(h.store) });
        prices++;
      });
      (Array.isArray(v.sales) ? v.sales : []).forEach((s, i) => {
        const date = toDate(s && s.date);
        const q = yen(s && s.quantity);
        const price = yen(s && s.price);
        if (!date || !(q > 0) || price == null || price < 0) return issues.push(`${where}:売却の記録 ${i + 1}件目を読み取れませんでした`);
        item.sales.push({ date, quantity: q, price, costAtSale: unitCost });
        sales++;
      });
      items.push(IM.cleanItem(item));
    }

    const skipped = SKIP_KEYS.filter((k) => k in obj);
    if (skipped.length) notes.push(`次の項目は読み込みません:${skipped.join('、')}`);
    if (sales) notes.push('売却時点の購入単価は旧データに無いため、今の購入単価で記録しました(確定利益の計算に使います)');
    notes.push('売却優先度はすべて「最初に売る」にしました');

    data.inventory = { items, settings: data.inventory ? data.inventory.settings : IM.create().settings };
    return { data, report: { counts: { items: items.length, prices, sales }, issues, notes } };
  }

  MT.inventoryLegacy = { SKIP_KEYS, needsLz, decode, convert, toDate };
})(typeof window !== 'undefined' ? window : globalThis);
