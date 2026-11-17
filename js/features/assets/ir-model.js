/*
 * 資産管理:開示・決算(適時開示の要約と、決算発表予定日)のデータと計算(画面には触らない)
 *
 * 取ってくるのは、自分で用意した Google Apps Script(tools/gas/ir.gs)のウェブアプリ。URL は MT.secrets の irUrl。
 *   GET ?api=state&codes=1234,5678    集めた結果(開示・要約・決算発表予定日)。見張る銘柄も codes にそろう
 *   GET ?api=refresh&codes=…          すぐに確かめてから返す
 *   GET ?api=summarize&id=…           その開示を、いま要約する
 * 送るのは銘柄コードだけ(株数や金額は送らない)。
 *
 * 見張る銘柄 = 保有している国内株(コードが 4 文字の形のもの)+ 気になる銘柄(保有していないもの)
 *
 * assets.ir = {
 *   watch: [{ code, name, addedAt }],   // 気になる銘柄
 *   seen: [id],                         // 見た開示(新しい 600 件まで)
 *   since: { code: ISO },               // 見張り始めた時刻。これより前に出た開示は「見た」とみなす
 *   manualEarnings: { code: { date, label } }  // 手で入れた決算発表予定日(一覧に無いとき)
 * }
 * 取ってきた結果は端末ごとの表示設定(moneyTracker:ui:irCache)に置く(書き出しには含めない)。
 *
 * 表示の色:まだ見ていない開示があれば red、2 週間以内の決算だけなら yellow、どちらも無ければ null
 */
(function (root) {
  'use strict';
  const MT = (root.MT = root.MT || {});
  const U = MT.util;

  const VERSION = 'ir-v1';
  const SEEN_MAX = 600;
  const WATCH_MAX = 50;
  const SOON_DAYS = 14;
  const FETCH_MIN_MINUTES = 10; // 開いたときに受け取るのは、前回から 10 分以上たっていたら
  const CACHE_KEY = 'irCache';

  const isJpCode = (c) => /^[0-9][0-9A-Z]{3}$/.test(String(c || ''));

  /** コードをそろえる(全角→半角・大文字。5 桁で末尾 0 は 4 桁に)。国内株の形でなければ '' */
  function normCode(v) {
    let s = String(v == null ? '' : v)
      .replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .trim()
      .toUpperCase()
      .replace(/\s/g, '');
    if (/^[0-9][0-9A-Z]{3}0$/.test(s)) s = s.slice(0, 4);
    return isJpCode(s) ? s : '';
  }

  function create() {
    return { watch: [], seen: [], since: {}, manualEarnings: {} };
  }

  function normalize(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const out = create();
    const seenCodes = new Set();
    for (const w of Array.isArray(r.watch) ? r.watch : []) {
      const code = normCode(w && w.code);
      if (!code || seenCodes.has(code) || out.watch.length >= WATCH_MAX) continue;
      seenCodes.add(code);
      out.watch.push({ code, name: String((w && w.name) || '').trim().slice(0, 40), addedAt: typeof w.addedAt === 'string' ? w.addedAt : null });
    }
    out.seen = [...new Set((Array.isArray(r.seen) ? r.seen : []).map(Number).filter((n) => Number.isSafeInteger(n) && n > 0))].slice(-SEEN_MAX);
    if (r.since && typeof r.since === 'object') {
      for (const [k, v] of Object.entries(r.since)) if (normCode(k) && typeof v === 'string' && !Number.isNaN(Date.parse(v))) out.since[normCode(k)] = v;
    }
    if (r.manualEarnings && typeof r.manualEarnings === 'object') {
      for (const [k, v] of Object.entries(r.manualEarnings)) {
        if (normCode(k) && v && U.isDateStr(v.date)) out.manualEarnings[normCode(k)] = { date: v.date, label: String(v.label || '').slice(0, 30) };
      }
    }
    return out;
  }

  /** 見張る銘柄:保有している国内株 + 気になる銘柄 */
  function stocks(a) {
    const out = [];
    const byCode = new Map();
    for (const h of a.holdings) {
      if (h.type !== 'jp') continue;
      const code = normCode(h.code);
      if (!code) continue;
      if (!byCode.has(code)) {
        const s = { code, name: h.name, kind: 'hold', holdings: [] };
        byCode.set(code, s);
        out.push(s);
      }
      byCode.get(code).holdings.push(h);
    }
    for (const w of a.ir.watch) {
      if (byCode.has(w.code)) continue;
      const s = { code: w.code, name: w.name || w.code, kind: 'watch', holdings: [] };
      byCode.set(w.code, s);
      out.push(s);
    }
    return out;
  }

  const codesParam = (a) => stocks(a).map((s) => s.code).join(',');

  // ---- 書き換え(store.update の中で呼ぶ) ----

  /** 気になる銘柄を足す。{ ok, error } */
  function addWatch(a, rawCode, name, now = new Date()) {
    const code = normCode(rawCode);
    if (!code) return { ok: false, error: '国内株の 4 けたのコード(例:1234、130A)を入れてください' };
    if (stocks(a).some((s) => s.code === code)) return { ok: false, error: 'その銘柄は、もう見ています' };
    if (a.ir.watch.length >= WATCH_MAX) return { ok: false, error: `気になる銘柄は ${WATCH_MAX}件までです` };
    a.ir.watch.push({ code, name: String(name || '').trim().slice(0, 40), addedAt: now.toISOString() });
    return { ok: true, code };
  }

  function removeWatch(a, code) {
    const before = a.ir.watch.length;
    a.ir.watch = a.ir.watch.filter((w) => w.code !== code);
    return a.ir.watch.length !== before;
  }

  function markSeen(a, ids) {
    const set = new Set(a.ir.seen);
    let n = 0;
    for (const id of [].concat(ids)) {
      const v = Number(id);
      if (Number.isSafeInteger(v) && v > 0 && !set.has(v)) {
        set.add(v);
        a.ir.seen.push(v);
        n++;
      }
    }
    if (a.ir.seen.length > SEEN_MAX) a.ir.seen = a.ir.seen.slice(-SEEN_MAX);
    return n;
  }

  function setManualEarnings(a, code, date, label) {
    if (!date) {
      delete a.ir.manualEarnings[code];
      return true;
    }
    if (!U.isDateStr(date)) return false;
    a.ir.manualEarnings[code] = { date, label: String(label || '').trim().slice(0, 30) };
    return true;
  }

  /**
   * 取ってきた結果を受け取ったとき:初めて見る銘柄の「見張り始めた時刻」を入れる(それより前の開示は見たことにする)。
   * 見張っていない銘柄の印は消す。変えたら true
   */
  function applyResponse(a, resp, now = new Date()) {
    let changed = false;
    const codes = new Set(stocks(a).map((s) => s.code));
    const at = resp && typeof resp.now === 'string' && !Number.isNaN(Date.parse(resp.now)) ? resp.now : now.toISOString();
    for (const c of codes) {
      if (!a.ir.since[c]) {
        a.ir.since[c] = at;
        changed = true;
      }
    }
    for (const c of Object.keys(a.ir.since)) {
      if (!codes.has(c)) {
        delete a.ir.since[c];
        changed = true;
      }
    }
    return changed;
  }

  // ---- 計算(取ってきた結果 data と合わせる) ----

  /** '2026-11-13 15:30'(日本時間)→ 時刻 */
  function atTime(at) {
    const m = String(at || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 9, +m[5]) : 0;
  }

  /** 見張っている銘柄の開示(新しい順) */
  function items(a, data) {
    if (!data || !Array.isArray(data.items)) return [];
    const codes = new Set(stocks(a).map((s) => s.code));
    return data.items.filter((it) => it && codes.has(it.code)).sort((x, y) => y.id - x.id);
  }

  /** まだ見ていない開示(見張り始める前に出たものは除く) */
  function unseen(a, data) {
    const seen = new Set(a.ir.seen);
    return items(a, data).filter((it) => {
      if (seen.has(it.id)) return false;
      const since = a.ir.since[it.code];
      return !since || atTime(it.at) >= Date.parse(since);
    });
  }

  const isUnseen = (a, it) => {
    if (a.ir.seen.includes(it.id)) return false;
    const since = a.ir.since[it.code];
    return !since || atTime(it.at) >= Date.parse(since);
  };

  /** 銘柄の決算発表予定日(手で入れたものを優先。今日より前は使わない) */
  function earningsOf(a, data, code, today = U.todayStr()) {
    const m = a.ir.manualEarnings[code];
    if (m && m.date >= today) return { date: m.date, label: m.label || '決算', manual: true };
    const e = data && data.earnings && data.earnings[code];
    if (e && U.isDateStr(e.date) && e.date >= today) return { date: e.date, label: e.label || '決算', manual: false };
    return null;
  }

  const daysUntil = (date, today = U.todayStr()) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);

  /** 2 週間以内の決算(近い順) */
  function soon(a, data, today = U.todayStr()) {
    return stocks(a)
      .map((s) => ({ stock: s, earnings: earningsOf(a, data, s.code, today) }))
      .filter((x) => x.earnings && daysUntil(x.earnings.date, today) <= SOON_DAYS)
      .sort((x, y) => (x.earnings.date < y.earnings.date ? -1 : 1));
  }

  /** 表示の色:red(まだ見ていない開示がある)/ yellow(2 週間以内の決算だけ)/ null */
  function level(a, data, today = U.todayStr()) {
    if (!data) return null;
    if (unseen(a, data).length) return 'red';
    if (soon(a, data, today).length) return 'yellow';
    return null;
  }

  /** 開いたときに受け取るか(URL があり、見張る銘柄があって、前回から 10 分以上・または銘柄が変わった) */
  function fetchDue(a, cache, url, now = new Date()) {
    if (!url || !stocks(a).length) return false;
    if (!cache || !cache.fetchedAt) return true;
    if (cache.codes !== codesParam(a)) return true;
    return now.getTime() - Date.parse(cache.fetchedAt) >= FETCH_MIN_MINUTES * 60000;
  }

  // ---- 取ってくる ----

  async function getJson(url, timeoutMs, fetchImpl) {
    const doFetch = fetchImpl || ((u, o) => root.fetch(u, o));
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    try {
      let res;
      try {
        res = await doFetch(url, { method: 'GET', signal: ctrl ? ctrl.signal : undefined, credentials: 'omit', cache: 'no-store', redirect: 'follow' });
      } catch (e) {
        throw new Error(e && e.name === 'AbortError' ? '時間切れになりました' : '通信できませんでした');
      }
      if (!res.ok) throw new Error(`取得できませんでした(HTTP ${res.status})`);
      let j;
      try {
        j = await res.json();
      } catch (e) {
        throw new Error('返事の形が読めません(URL が「開示・決算」の GAS のものか確かめてください)');
      }
      if (!j || j.version !== VERSION) throw new Error('「開示・決算」の GAS の返事ではありません(URL を確かめてください)');
      if (j.error) throw new Error(String(j.error).slice(0, 150));
      return j;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function buildUrl(base, params) {
    const u = new URL(base);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return u.toString();
  }

  /** 集めた結果を受け取る(refresh なら、すぐに確かめてから) */
  function fetchState({ url, codes, refresh = false, fetchImpl }) {
    return getJson(buildUrl(url, { api: refresh ? 'refresh' : 'state', codes }), refresh ? 120000 : 30000, fetchImpl);
  }

  /** その開示を、いま要約する */
  async function summarize({ url, id, fetchImpl }) {
    const j = await getJson(buildUrl(url, { api: 'summarize', id: String(id) }), 120000, fetchImpl);
    return j.item;
  }

  // ---- 取ってきた結果の置き場所(端末ごと) ----

  function loadCache() {
    const c = U.prefs.get(CACHE_KEY, null);
    return c && typeof c === 'object' && c.data && typeof c.data === 'object' ? c : null;
  }
  function saveCache(c) {
    U.prefs.set(CACHE_KEY, c);
  }

  MT.assetIr = {
    VERSION,
    SOON_DAYS,
    FETCH_MIN_MINUTES,
    WATCH_MAX,
    isJpCode,
    normCode,
    create,
    normalize,
    stocks,
    codesParam,
    addWatch,
    removeWatch,
    markSeen,
    setManualEarnings,
    applyResponse,
    atTime,
    items,
    unseen,
    isUnseen,
    earningsOf,
    daysUntil,
    soon,
    level,
    fetchDue,
    fetchState,
    summarize,
    loadCache,
    saveCache,
  };
})(typeof window !== 'undefined' ? window : globalThis);
