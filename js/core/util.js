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

  /** a − b の月数(例:ymDiff('2026-12', '2026-10') = 2) */
  function ymDiff(a, b) {
    const x = splitYM(a);
    const y = splitYM(b);
    return (x.y - y.y) * 12 + (x.m - y.m);
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
   * 式を計算する(eval は使わない)。使える記号:+ - * / ( ) と小数点。
   * @returns {number} 計算結果(小数のまま)
   */
  function evalExpression(src) {
    let i = 0;
    const fail = (msg) => {
      throw new Error(msg || '式を計算できません');
    };
    const peek = () => src[i];
    function number() {
      const m = /^\d+(\.\d+)?/.exec(src.slice(i));
      if (!m) fail();
      i += m[0].length;
      return Number(m[0]);
    }
    function factor(depth) {
      if (depth > 20) fail();
      const c = peek();
      if (c === '+') {
        i++;
        return factor(depth + 1);
      }
      if (c === '-') {
        i++;
        return -factor(depth + 1);
      }
      if (c === '(') {
        i++;
        const v = expr(depth + 1);
        if (peek() !== ')') fail('かっこが閉じていません');
        i++;
        return v;
      }
      return number();
    }
    function term(depth) {
      let v = factor(depth);
      while (peek() === '*' || peek() === '/') {
        const op = src[i++];
        const r = factor(depth);
        if (op === '*') v *= r;
        else {
          if (r === 0) fail('0 で割ることはできません');
          v /= r;
        }
      }
      return v;
    }
    function expr(depth) {
      let v = term(depth);
      while (peek() === '+' || peek() === '-') {
        const op = src[i++];
        const r = term(depth);
        v = op === '+' ? v + r : v - r;
      }
      return v;
    }
    const v = expr(0);
    if (i !== src.length || !Number.isFinite(v)) fail();
    return v;
  }

  /** 入力の表記ゆれ(全角・記号・カンマなど)をそろえる */
  function normalizeAmountText(raw) {
    let s = String(raw == null ? '' : raw);
    s = s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
    s = s.replace(/[,，、\s円¥￥]/g, '');
    s = s.replace(/^[▲△]/, '-');
    s = s
      .replace(/[−ー－‐–—]/g, '-')
      .replace(/[＋]/g, '+')
      .replace(/[×xX＊]/g, '*')
      .replace(/[÷／]/g, '/')
      .replace(/[（]/g, '(')
      .replace(/[）]/g, ')')
      .replace(/[．]/g, '.');
    return s;
  }

  /**
   * 金額入力の文字列を解釈する。
   * 全角数字・カンマ・「円」「¥」・マイナス記号(− ー ▲ など)を受け付ける。
   * 「1000+500」「1980*3」のような式も可(結果は四捨五入して整数にする)。
   * @returns {{ok: true, value: number|null, isExpression: boolean} | {ok: false, error: string}}
   *          value が null のときは「空欄」
   */
  function parseYen(raw) {
    const s = normalizeAmountText(raw);
    if (s === '') return { ok: true, value: null, isExpression: false };
    if (s.length > 200) return { ok: false, error: '式が長すぎます' };
    let v;
    let isExpression = false;
    if (/^-?\d+$/.test(s)) {
      v = Number(s);
    } else if (/^-?\d+\.\d*$/.test(s)) {
      return { ok: false, error: '数字で入力してください(小数は使えません)' };
    } else if (/^[\d+\-*/().]+$/.test(s)) {
      isExpression = true;
      try {
        v = evalExpression(s);
      } catch (e) {
        return { ok: false, error: e.message || '式を計算できません' };
      }
      v = v < 0 ? -Math.round(-v) : Math.round(v);
    } else {
      return { ok: false, error: '数字か式(例:1000+500)で入力してください' };
    }
    if (!Number.isSafeInteger(v) || Math.abs(v) > MAX_YEN) {
      return { ok: false, error: '金額が大きすぎます' };
    }
    return { ok: true, value: v === 0 ? 0 : v, isExpression }; // -0 を 0 にそろえる
  }

  /**
   * 小数を含む数(数量・単価など)を解釈する。式も可。maxDecimals 桁で四捨五入。
   * @returns {{ok: true, value: number|null, isExpression: boolean} | {ok: false, error: string}}
   */
  function parseDecimal(raw, maxDecimals = 4) {
    const s = normalizeAmountText(raw);
    if (s === '') return { ok: true, value: null, isExpression: false };
    if (s.length > 200) return { ok: false, error: '式が長すぎます' };
    let v;
    let isExpression = false;
    if (/^-?\d+(\.\d+)?$/.test(s)) v = Number(s);
    else if (/^[\d+\-*/().]+$/.test(s)) {
      isExpression = true;
      try {
        v = evalExpression(s);
      } catch (e) {
        return { ok: false, error: e.message || '式を計算できません' };
      }
    } else return { ok: false, error: '数字か式で入力してください' };
    if (!Number.isFinite(v) || Math.abs(v) > 1e12) return { ok: false, error: '数が大きすぎます' };
    const f = 10 ** maxDecimals;
    v = (v < 0 ? -Math.round(-v * f) : Math.round(v * f)) / f;
    return { ok: true, value: v === 0 ? 0 : v, isExpression };
  }

  const numberFormats = {};
  /** 小数つきの数を 3 桁区切りで(maxDecimals 桁まで) */
  function formatNumber(n, maxDecimals = 4) {
    if (!numberFormats[maxDecimals]) numberFormats[maxDecimals] = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: maxDecimals });
    return numberFormats[maxDecimals].format(n);
  }

  /** 金額を 1,000 円などの単位で切り上げる */
  function roundUp(n, unit) {
    return n <= 0 ? 0 : Math.ceil(n / unit) * unit;
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
    ymDiff,
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
    parseDecimal,
    formatNumber,
    evalExpression,
    roundUp,
    isYenValue,
    MAX_YEN,
    uid,
    prefs,
  };
})(typeof window !== 'undefined' ? window : globalThis);
