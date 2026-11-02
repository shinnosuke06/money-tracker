/*
 * 価格取得の URL や API キーなど、人に見せたくない設定の保存場所
 *  - データ本体(moneyTracker:data)とは別のキーに保存する
 *  - JSON の書き出しには、既定では含めない(設定で含めることもできる)
 *  - 「直前のデータに戻す」「すべて削除」でも消えない(設定の「URLとキーを消す」で消す)
 */
(function (root) {
  'use strict';
  const MT = (root.MT = root.MT || {});

  const KEY = 'moneyTracker:secrets';
  const FIELDS = ['priceUrl', 'finnhubKey'];

  function read() {
    try {
      const v = JSON.parse(root.localStorage.getItem(KEY));
      return v && typeof v === 'object' ? v : {};
    } catch (e) {
      return {};
    }
  }

  function clean(obj) {
    const out = {};
    for (const f of FIELDS) {
      const v = obj && typeof obj[f] === 'string' ? obj[f].trim().slice(0, 500) : '';
      if (v) out[f] = v;
    }
    return out;
  }

  MT.secrets = {
    FIELDS,
    /** @returns {{priceUrl?: string, finnhubKey?: string}} */
    get: () => clean(read()),
    has: () => Object.keys(clean(read())).length > 0,
    /** 一部だけ書き換える。空文字なら消す */
    set(patch) {
      const next = clean({ ...read(), ...patch });
      try {
        root.localStorage.setItem(KEY, JSON.stringify(next));
        return true;
      } catch (e) {
        return false;
      }
    },
    clear() {
      try {
        root.localStorage.removeItem(KEY);
      } catch (e) {
        /* 何もしない */
      }
    },
    clean,
  };
})(typeof window !== 'undefined' ? window : globalThis);
