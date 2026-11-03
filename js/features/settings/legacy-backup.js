/*
 * 旧アプリのバックアップのテキストを読む共通部品(画面には触らない)
 *  - 書き方:「LZ:」で始まる圧縮(LZ-String の decompressFromBase64)、
 *    base64(atob + decodeURIComponent)、そのままの JSON(値が JSON の文字列になっている形も)、
 *    旧・支払い管理アプリのテキスト形式(【口座】【支払い】…の見出しとカンマ区切りの行)
 *  - 中身から、どの旧アプリのバックアップかを見分ける。
 *    取り込みのボタンを間違えたときに、どのボタンで読めばよいかを案内するために使う
 */
(function (root) {
  'use strict';
  const MT = (root.MT = root.MT || {});

  const KINDS = {
    payments: { label: '旧・支払い管理アプリ', button: '旧・支払い管理アプリのバックアップを読み込む' },
    assets: { label: '旧・資産管理アプリ', button: '旧・資産管理アプリのバックアップを読み込む' },
    sidejob: { label: '旧・副業管理アプリ', button: '旧・副業管理アプリのバックアップを読み込む' },
    inventory: { label: '旧・ポケカ管理アプリ', button: '旧・ポケカ管理アプリのバックアップを読み込む' },
    app: { label: 'このアプリ(マネートラッカー)の書き出しファイル', button: 'JSON ファイルを読み込む' },
  };
  // 旧・支払い管理アプリのキー(js/features/payments/legacy.js と同じ)
  const PAYMENT_KEYS = ['accounts', 'wallets', 'incomes', 'payments', 'history', 'specialPayments', 'memos', 'allocations'];

  /** 「LZ:」で始まるか(展開に LZ-String が要るか) */
  function needsLz(text) {
    return /^﻿?\s*LZ:/.test(String(text == null ? '' : text));
  }

  /**
   * テキストを中身(オブジェクト・配列)に戻す。
   * @param {string} text
   * @param {{decompressFromBase64: Function}|null} lz LZ-String(「LZ:」のときだけ使う)
   * @returns {{ok: true, obj: any} | {ok: false, error: string}}
   */
  function unwrap(text, lz) {
    const t = String(text == null ? '' : text).replace(/^﻿/, '').trim();
    if (!t) return { ok: false, error: 'テキストが空です。' };
    let body = t;
    if (t.startsWith('LZ:')) {
      if (!lz) return { ok: false, error: '"LZ:" で始まるデータの展開に必要な部品(LZ-String)を読み込めませんでした。インターネットに接続してから試してください。' };
      try {
        body = lz.decompressFromBase64(t.slice(3).trim());
      } catch (e) {
        body = null;
      }
      if (!body) return { ok: false, error: '"LZ:" のデータを展開できませんでした。バックアップの文字をすべてコピーしたか確認してください。' };
    }
    // 旧・支払い管理アプリのテキスト形式
    if (MT.paymentsLegacy && MT.paymentsLegacy.isSectionText(body)) return { ok: true, obj: MT.paymentsLegacy.parseSections(body) };
    const tries = [
      () => JSON.parse(body),
      () => JSON.parse(decodeURIComponent(root.atob(body))),
      () => JSON.parse(decodeURIComponent(escape(root.atob(body)))),
    ];
    for (const f of tries) {
      try {
        let v = f();
        if (typeof v === 'string') v = JSON.parse(v);
        return { ok: true, obj: v };
      } catch (e) {
        /* 次の方法を試す */
      }
    }
    return { ok: false, error: 'バックアップを読み取れませんでした。書き出したテキストをすべてコピーしたか確認してください。' };
  }

  /** 中身から、どのバックアップかを見分ける。分からなければ null */
  function identify(obj) {
    if (!obj || typeof obj !== 'object') return null;
    if (Array.isArray(obj)) return MT.sidejobLegacy && MT.sidejobLegacy.detect(obj) ? 'sidejob' : null;
    if (obj.app === 'money-tracker') return 'app';
    if ((obj.inventory && typeof obj.inventory === 'object' && !Array.isArray(obj.inventory)) || Array.isArray(obj.lotteries)) return 'inventory';
    if (Array.isArray(obj.holdings) || (typeof obj.holdings === 'string' && /^\s*\[/.test(obj.holdings))) return 'assets';
    if (Array.isArray(obj.jobs)) return 'sidejob';
    if (PAYMENT_KEYS.some((k) => k in obj)) return 'payments';
    return null;
  }

  /** 取り込みのボタンを間違えたときの案内 */
  function wrongKindMessage(kind, expected) {
    const k = KINDS[kind];
    const e = KINDS[expected];
    if (kind === 'app') return `これは${k.label}です(${e.label}のバックアップではありません)。設定の「${k.button}」から、ファイルを選んで読み込んでください。`;
    return `これは${k.label}のバックアップのようです(${e.label}のものではありません)。「${k.button}」から読み込んでください。`;
  }

  MT.legacyBackup = { KINDS, needsLz, unwrap, identify, wrongKindMessage };
})(typeof window !== 'undefined' ? window : globalThis);
