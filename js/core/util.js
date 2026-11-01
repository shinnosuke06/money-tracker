/*
 * 共通の小さな関数(日付・年月・金額)
 * DOM には触らないので、Node のテストからも読み込める。
 */
(function (root) {
  'use strict';
  const MT = (root.MT = root.MT || {});

  const pad2 = (n) => String(n).padStart(2, '0');
  const YM_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
  const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
  const MINUS = '−'; // 表示用のマイナス記号

  // ---- 日付・年月("YYYY-MM-DD" / "YYYY-MM" の文字列で扱う) ----

  function todayStr(now = new Date()) {
    return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  }

  function currentYM(now = new Date()) {
    return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
  }

  function isYM(s) {
    return typeof s === 'string' && YM_RE.test(s);
  }

  function isDateStr(s) {
    return typeof s === 'string' && DATE_RE.test(s);
  }

  function splitYM(ym) {
    return { y: Number(ym.slice(0, 4)), m: Number(ym.slice(5, 7)) };
  }

  function makeYM(y, m) {
    return `${y}-${pad2(m)}`;
  }

  /** ym に n か月足す(n は負でもよい) */
  function ymAdd(ym, n) {
    const { y, m } = splitYM(ym);
    const idx = y * 12 + (m - 1) + n;
    return makeYM(Math.floor(idx / 12), (idx % 12) + 1);
  }

  function lastDayOfYM(ym) {
    const { y, m } = splitYM(ym);
    const last = new Date(y, m, 0).getDate();
    return `${ym}-${pad2(last)}`;
  }

  /** "2026年10月" */
  function ymLabel(ym) {
    const { y, m } = splitYM(ym);
    return `${y}年${m}月`;
  }

  /** "10月" */
  function monthLabel(ym) {
    return `${splitYM(ym).m}月`;
  }

  /** "10/31"(今年以外は "2025/10/31") */
  function shortDate(dateStr, now = new Date()) {
    if (!isDateStr(dateStr)) return '';
    const [y, m, d] = dateStr.split('-').map(Number);
    return y === now.getFullYear() ? `${m}/${d}` : `${y}/${m}/${d}`;
  }

  // ---- 金額(円の整数) ----

  const nf = new Intl.NumberFormat('ja-JP');
  const MAX_YEN = 999999999999; // 1兆円未満

  /** 1234567 → "1,234,567" */
  function yen(n) {
    return n < 0 ? MINUS + nf.format(-n) : nf.format(n);
  }

  /** 差額用:"+12,345" / "−12,345" / "±0" */
  function yenSigned(n) {
    if (n > 0) return '+' + nf.format(n);
    if (n < 0) return MINUS + nf.format(-n);
    return '±0';
  }

  /** グラフの目盛り用:"1,200万" / "1.5億" */
  function yenCompact(n) {
    const abs = Math.abs(n);
    const sign = n < 0 ? MINUS : '';
    if (abs >= 1e8) return sign + (abs / 1e8).toLocaleString('ja-JP', { maximumFractionDigits: 2 }) + '億';
    if (abs >= 1e4) return sign + (abs / 1e4).toLocaleString('ja-JP', { maximumFractionDigits: 1 }) + '万';
    return sign + nf.format(abs);
  }

  /** 入力欄に入れる形(ASCII のマイナス) */
  function yenInput(n) {
    return (n < 0 ? '-' : '') + nf.format(Math.abs(n));
  }

  /** 0.0123 → "+1.2%" */
  function percentSigned(ratio) {
    const p = ratio * 100;
    const s = Math.abs(p).toFixed(1);
    if (s === '0.0') return '±0.0%';
    return (p > 0 ? '+' : MINUS) + s + '%';
  }

  /**
   * 金額入力の文字列を解釈する。
   * 全角数字・カンマ・「円」「¥」・各種マイナス記号(− ー ▲ など)を受け付ける。
   * @returns {{ok: true, value: number|null} | {ok: false, error: string}}
   *          value が null のときは「空欄」
   */
  function parseYen(raw) {
    let s = String(raw == null ? '' : raw);
    s = s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
    s = s.replace(/[,，、\s円¥￥]/g, '');
    s = s.replace(/^[−ー－‐▲△-]/, '-');
    if (s === '') return { ok: true, value: null };
    if (!/^-?\d+$/.test(s)) {
      return { ok: false, error: '数字で入力してください(小数は使えません)' };
    }
    const v = Number(s);
    if (!Number.isSafeInteger(v) || Math.abs(v) > MAX_YEN) {
      return { ok: false, error: '金額が大きすぎます' };
    }
    return { ok: true, value: v === 0 ? 0 : v }; // -0 を 0 にそろえる
  }

  function isYenValue(v) {
    return Number.isSafeInteger(v) && Math.abs(v) <= MAX_YEN;
  }

  // ---- その他 ----

  function uid(prefix) {
    let rand = '';
    if (root.crypto && root.crypto.getRandomValues) {
      const a = new Uint32Array(2);
      root.crypto.getRandomValues(a);
      rand = a[0].toString(36) + a[1].toString(36);
    } else {
      rand = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    }
    return `${prefix}_${Date.now().toString(36)}${rand.slice(0, 8)}`;
  }

  /** 端末ごとの表示設定(グラフの切り替えなど)。保存できなくても動作は続ける。 */
  const PREFS_PREFIX = 'moneyTracker:ui:';
  const prefs = {
    get(key, fallback) {
      try {
        const raw = root.localStorage.getItem(PREFS_PREFIX + key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        root.localStorage.setItem(PREFS_PREFIX + key, JSON.stringify(value));
      } catch (e) {
        /* 保存できなくても困らない設定なので無視 */
      }
    },
  };

  MT.util = {
    todayStr,
    currentYM,
    isYM,
    isDateStr,
    splitYM,
    makeYM,
    ymAdd,
    lastDayOfYM,
    ymLabel,
    monthLabel,
    shortDate,
    yen,
    yenSigned,
    yenCompact,
    yenInput,
    percentSigned,
    parseYen,
    isYenValue,
    MAX_YEN,
    uid,
    prefs,
  };
})(typeof window !== 'undefined' ? window : globalThis);
