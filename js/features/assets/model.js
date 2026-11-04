/*
 * 資産管理:データの形と計算・操作(画面には触らない)
 *
 * assets = {
 *   holdings: [{                      // 保有(株・投信)
 *     id, broker, account, type, code, name,
 *     quantity,                       // 数量。投資信託は「口数 ÷ 1万」
 *     avgPrice,                       // 平均取得単価(円)。投資信託は 1万口あたり
 *     price,                          // 現在の単価(円)。国内株・投資信託
 *     priceUsd,                       // 現在の株価(ドル)。米国株(円は USD/JPY を掛けて出す)
 *     priceAt, priceSource,           // 価格の日時と出どころ(auto / manual / import / sample)
 *     lastError, lastTriedAt,         // 直近の取得に失敗したときの理由と日時
 *     sellPriority,                   // first / ifNeeded / keep(段階5の取り崩し案で使う)
 *     nisaUnsure,                     // 旧アプリの "NISA"(新旧が不明)なら true
 *     memo,
 *     dividend: { perShare, months: [1..12], memo },        // 1回あたりの1株配当(米国株はドル)、支払月
 *     benefit:  { content, minShares, recordMonths, arriveMonths } // 優待
 *   }],
 *   manual: [{ id, name, category, value, cost, updatedAt, sellPriority, memo }],
 *       // 手入力の資産。含み損益 = value − cost
 *   history: [{ date: "YYYY-MM-DD", total, gain, byBroker: { 名前: 円 }, missing, edited? }],
 *       // edited: 手で直した記録なら true
 *   historyTrash: [{ id, reason, at, entry }],
 *       // 削除・修正前の履歴(新しい順・最大 200 件)。reason:deleted(削除)/ edited(修正前)/ replaced(置き換え前)
 *       // entry は history の 1 件と同じ形。「元に戻す」で history に戻せる
 *   fx: { rate, source, at },         // 直近の更新で使った USD/JPY(auto / manual)
 *   lastUpdateAt,
 *   settings: { taxRate, fxManual, fxCode, reflect: { groupBy, map, manualMap } },
 *       // groupBy:broker(証券会社ごと)/ account(口座区分ごと)/ brokerType(証券会社×種別)
 *   recent: { broker, account, type } // 前回の入力(追加のときの初期値)
 * }
 *
 * 金額(評価額・取得額・損益など)は円の整数に丸める。数量と単価は小数を持てる。
 * 合計はすべて rows()(資産 1 件ずつの評価の一覧)から計算するので、どの切り口でも合計が一致する。
 */
(function (root) {
  'use strict';
  const MT = (root.MT = root.MT || {});
  const U = MT.util;
  const MM = MT.monthlyModel;

  const ACCOUNTS = [
    { id: 'tokutei', label: '特定', taxable: true },
    { id: 'ippan', label: '一般', taxable: true },
    { id: 'nisa_old', label: '旧NISA', taxable: false },
    { id: 'nisa_new', label: '新NISA', taxable: false },
  ];
  const TYPES = [
    { id: 'jp', label: '国内株' },
    { id: 'us', label: '米国株' },
    { id: 'fund', label: '投資信託' },
  ];
  const MANUAL_CATEGORIES = [
    { id: 'cash', label: '現金同等' },
    { id: 'invest', label: '投資' },
    { id: 'other', label: 'その他' },
  ];
  const PRIORITIES = [
    { id: 'first', label: '最初に売る' },
    { id: 'ifNeeded', label: '足りなければ売る' },
    { id: 'keep', label: '売りたくない' },
  ];
  // 円グラフ・集計の「種別」(保有の種別 + 手入力の区分)
  const KINDS = [...TYPES, ...MANUAL_CATEGORIES.map((c) => ({ id: `m_${c.id}`, label: `${c.label}(手入力)` }))];
  // 月末記録への反映のまとめ方
  const REFLECT_GROUPS = [
    { id: 'broker', label: '証券会社ごと' },
    { id: 'account', label: '口座区分ごと' },
    { id: 'brokerType', label: '証券会社×種別' },
  ];

  const DEFAULT_TAX = 0.20315;
  const US_WITHHOLDING = 0.1; // 米国株の配当にかかる米国の源泉税
  const MANUAL_BROKER = '手入力の資産';
  const NAME_MAX = 40;
  const MEMO_MAX = 1000;
  const HISTORY_MAX = 2000;
  const TRASH_MAX = 200;
  const TRASH_REASONS = [
    { id: 'deleted', label: '削除' },
    { id: 'edited', label: '修正前' },
    { id: 'replaced', label: '置き換え前' },
  ];

  const label = (list, id) => (list.find((x) => x.id === id) || { label: id }).label;
  const isTaxable = (account) => !!(ACCOUNTS.find((a) => a.id === account) || {}).taxable;

  function create() {
    return {
      holdings: [],
      manual: [],
      history: [],
      historyTrash: [],
      fx: { rate: null, source: null, at: null },
      lastUpdateAt: null,
      settings: { taxRate: DEFAULT_TAX, fxManual: null, fxCode: 'USDJPY', reflect: { groupBy: 'broker', map: {}, manualMap: {} } },
      recent: { broker: '', account: 'tokutei', type: 'jp' },
    };
  }

  // ---- 値の点検 ----

  const text = (s, max = NAME_MAX) =>
    String(s == null ? '' : s)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max);
  const memoText = (s) => String(s == null ? '' : s).slice(0, MEMO_MAX);
  const round = (v, digits) => {
    const f = 10 ** digits;
    return Math.round(v * f) / f;
  };
  const num = (v, { min = 0, digits = 4 } = {}) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v < 1e12 ? round(v, digits) : null);
  const yenInt = (v) => (U.isYenValue(v) ? v : null);
  const months = (arr) => [...new Set((Array.isArray(arr) ? arr : []).filter((m) => Number.isInteger(m) && m >= 1 && m <= 12))].sort((a, b) => a - b);
  const oneOf = (list, v, fallback) => (list.some((x) => x.id === v) ? v : fallback);
  const iso = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null);
  const id = (v, prefix) => (typeof v === 'string' && v ? v.slice(0, 64) : U.uid(prefix));

  /** コードをそろえる(全角→半角、前後の空白を取る、英字は大文字) */
  function normCode(code) {
    return String(code == null ? '' : code)
      .replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .trim()
      .toUpperCase()
      .slice(0, 20);
  }

  function cleanHolding(h) {
    const d = h.dividend && typeof h.dividend === 'object' ? h.dividend : {};
    const b = h.benefit && typeof h.benefit === 'object' ? h.benefit : {};
    return {
      id: id(h.id, 'hld'),
      broker: text(h.broker) || '(証券会社なし)',
      account: oneOf(ACCOUNTS, h.account, 'tokutei'),
      type: oneOf(TYPES, h.type, 'jp'),
      code: normCode(h.code),
      name: text(h.name) || normCode(h.code) || '銘柄',
      quantity: num(h.quantity, { digits: 6 }) || 0,
      avgPrice: num(h.avgPrice) || 0,
      price: num(h.price) || null,
      priceUsd: num(h.priceUsd) || null,
      priceAt: iso(h.priceAt),
      priceSource: ['auto', 'manual', 'import', 'sample'].includes(h.priceSource) ? h.priceSource : null,
      lastError: h.lastError ? text(h.lastError, 200) : null,
      lastTriedAt: iso(h.lastTriedAt),
      sellPriority: oneOf(PRIORITIES, h.sellPriority, 'ifNeeded'),
      nisaUnsure: h.nisaUnsure === true,
      memo: memoText(h.memo),
      dividend: { perShare: num(d.perShare), months: months(d.months), memo: memoText(d.memo) },
      benefit: {
        content: text(b.content, 200),
        minShares: num(b.minShares, { digits: 6 }) || null,
        recordMonths: months(b.recordMonths),
        arriveMonths: months(b.arriveMonths),
      },
    };
  }

  function cleanManual(m) {
    const value = yenInt(m.value) || 0;
    const cost = yenInt(m.cost);
    return {
      id: id(m.id, 'man'),
      name: text(m.name) || '資産',
      category: oneOf(MANUAL_CATEGORIES, m.category, 'other'),
      value,
      cost: cost == null ? value : cost,
      updatedAt: U.isDateStr(m.updatedAt) ? m.updatedAt : null,
      sellPriority: oneOf(PRIORITIES, m.sellPriority, 'keep'),
      memo: memoText(m.memo),
    };
  }

  function cleanHistoryEntry(e) {
    const byBroker = {};
    if (e.byBroker && typeof e.byBroker === 'object') {
      for (const [k, v] of Object.entries(e.byBroker)) if (U.isYenValue(v)) byBroker[text(k)] = v;
    }
    const out = { date: e.date, total: yenInt(e.total) || 0, gain: yenInt(e.gain), byBroker, missing: Number.isInteger(e.missing) && e.missing > 0 ? e.missing : 0 };
    if (e.edited === true) out.edited = true;
    return out;
  }

  function cleanTrash(t) {
    return { id: id(t.id, 'hdel'), reason: oneOf(TRASH_REASONS, t.reason, 'deleted'), at: iso(t.at), entry: cleanHistoryEntry(t.entry) };
  }

  const list = (arr) => (Array.isArray(arr) ? arr : []).filter((x) => x && typeof x === 'object');
  const uniqueById = (arr) => {
    const seen = new Set();
    return arr.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
  };

  function normalize(raw) {
    const a = create();
    a.holdings = uniqueById(list(raw.holdings).map(cleanHolding));
    a.manual = uniqueById(list(raw.manual).map(cleanManual));
    const hist = new Map();
    for (const e of list(raw.history)) if (U.isDateStr(e.date)) hist.set(e.date, cleanHistoryEntry(e));
    a.history = [...hist.values()].sort((x, y) => (x.date < y.date ? -1 : 1)).slice(-HISTORY_MAX);
    a.historyTrash = uniqueById(
      list(raw.historyTrash)
        .filter((t) => t.entry && typeof t.entry === 'object' && U.isDateStr(t.entry.date))
        .map(cleanTrash)
    ).slice(0, TRASH_MAX);
    const fx = raw.fx && typeof raw.fx === 'object' ? raw.fx : {};
    a.fx = { rate: num(fx.rate) || null, source: ['auto', 'manual'].includes(fx.source) ? fx.source : null, at: iso(fx.at) };
    a.lastUpdateAt = iso(raw.lastUpdateAt);
    const s = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
    const r = s.reflect && typeof s.reflect === 'object' ? s.reflect : {};
    const strMap = (m) => {
      const out = {};
      if (m && typeof m === 'object') for (const [k, v] of Object.entries(m)) if (typeof v === 'string' && v) out[text(k, 80)] = v; // 「証券会社|種別」のキーも入る長さ
      return out;
    };
    a.settings = {
      taxRate: typeof s.taxRate === 'number' && s.taxRate >= 0 && s.taxRate < 1 ? s.taxRate : DEFAULT_TAX,
      fxManual: num(s.fxManual) || null,
      fxCode: text(s.fxCode, 20) || 'USDJPY',
      reflect: { groupBy: oneOf(REFLECT_GROUPS, r.groupBy, 'broker'), map: strMap(r.map), manualMap: strMap(r.manualMap) },
    };
    const rec = raw.recent && typeof raw.recent === 'object' ? raw.recent : {};
    a.recent = { broker: text(rec.broker), account: oneOf(ACCOUNTS, rec.account, 'tokutei'), type: oneOf(TYPES, rec.type, 'jp') };
    return a;
  }

  /** 反映先(月末記録の項目)や手入力の資産が消えていたら、対応を外す */
  function finalize(d) {
    const a = d.assets;
    if (!a || !d.monthly) return;
    const items = new Set(d.monthly.items.map((it) => it.id));
    const manualIds = new Set(a.manual.map((m) => m.id));
    const r = a.settings.reflect;
    for (const k of Object.keys(r.map)) if (!items.has(r.map[k])) delete r.map[k];
    for (const k of Object.keys(r.manualMap)) if (!items.has(r.manualMap[k]) || !manualIds.has(k)) delete r.manualMap[k];
  }

  function hasContent(a) {
    return !!a && (a.holdings.length > 0 || a.manual.length > 0 || a.history.length > 0);
  }

  function summarize(a) {
    return [`資産管理:保有 ${a.holdings.length}件・手入力 ${a.manual.length}件・履歴 ${a.history.length}日分`];
  }

  // ---- 評価 ----

  const taxRate = (a) => a.settings.taxRate;

  /** 1 単位あたりの現在価格(円)。米国株はドル × USD/JPY。わからなければ null */
  function unitPriceYen(h, fxRate) {
    if (h.type === 'us') return h.priceUsd != null && fxRate ? h.priceUsd * fxRate : null;
    return h.price;
  }

  /**
   * 保有 1 件の評価。価格が無いものは value などを null にする(取得単価では代用しない)。
   * 課税口座(特定・一般)の含み益にだけ税をかける(含み損には税なし)。
   */
  function valuation(h, a) {
    const unit = unitPriceYen(h, a.fx.rate);
    const cost = Math.round(h.quantity * h.avgPrice);
    if (unit == null) return { value: null, cost, gain: null, tax: null, net: null, unit: null, missing: true };
    const value = Math.round(h.quantity * unit);
    const gain = value - cost;
    const tax = isTaxable(h.account) && gain > 0 ? Math.round(gain * taxRate(a)) : 0;
    return { value, cost, gain, tax, net: value - tax, unit, missing: false };
  }

  /** 手入力の資産の評価。「投資」区分の含み益にだけ税をかける */
  function manualValuation(m, a) {
    const gain = m.value - m.cost;
    const tax = m.category === 'invest' && gain > 0 ? Math.round(gain * taxRate(a)) : 0;
    return { value: m.value, cost: m.cost, gain, tax, net: m.value - tax, unit: null, missing: false };
  }

  /** 資産 1 件ずつの評価の一覧(保有 + 手入力)。集計はすべてここから */
  function rows(a) {
    const out = [];
    for (const h of a.holdings) {
      out.push({
        source: 'holding',
        id: h.id,
        name: h.name,
        code: h.code,
        broker: h.broker,
        account: h.account,
        kind: h.type,
        priority: h.sellPriority,
        stale: !!h.lastError,
        ...valuation(h, a),
      });
    }
    for (const m of a.manual) {
      out.push({ source: 'manual', id: m.id, name: m.name, code: '', broker: MANUAL_BROKER, account: 'manual', kind: `m_${m.category}`, priority: m.sellPriority, stale: false, ...manualValuation(m, a) });
    }
    return out;
  }

  function emptyGroup() {
    return { value: 0, cost: 0, gain: 0, tax: 0, net: 0, count: 0, missing: 0 };
  }

  function addTo(g, r) {
    g.count++;
    if (r.missing) {
      g.missing++;
      return;
    }
    g.value += r.value;
    g.cost += r.cost;
    g.gain += r.gain;
    g.tax += r.tax;
    g.net += r.net;
  }

  /**
   * 集計。価格未取得の銘柄は合計に入れず、件数(missing)だけ数える。
   * byBroker / byAccount / byKind / byPriority は、どれを足しても total と一致する。
   */
  function summary(a) {
    const rs = rows(a);
    const all = emptyGroup();
    const securities = emptyGroup();
    const group = (keyOf) => {
      const m = new Map();
      for (const r of rs) {
        const k = keyOf(r);
        if (!m.has(k)) m.set(k, emptyGroup());
        addTo(m.get(k), r);
      }
      return m;
    };
    for (const r of rs) {
      addTo(all, r);
      if (r.source === 'holding') addTo(securities, r);
    }
    const byAccount = group((r) => r.account);
    return {
      rows: rs,
      total: all.value,
      cost: all.cost,
      gain: all.gain,
      tax: all.tax,
      net: all.net,
      missing: all.missing,
      securities,
      byBroker: group((r) => r.broker),
      byAccount,
      byKind: group((r) => r.kind),
      byPriority: group((r) => r.priority),
      nisa: { nisa_old: byAccount.get('nisa_old') || emptyGroup(), nisa_new: byAccount.get('nisa_new') || emptyGroup() },
    };
  }

  /** 証券会社の一覧(入力の多い順 → 前回の選択を先頭に) */
  function brokers(a) {
    const count = new Map();
    for (const h of a.holdings) count.set(h.broker, (count.get(h.broker) || 0) + 1);
    const names = [...count.keys()].sort((x, y) => count.get(y) - count.get(x));
    if (a.recent.broker && names.includes(a.recent.broker)) names.splice(names.indexOf(a.recent.broker), 1), names.unshift(a.recent.broker);
    return names;
  }

  // ---- 履歴 ----

  /** その日の総資産と証券会社別の合計を保存(同じ日は上書き) */
  function saveHistory(a, date) {
    const s = summary(a);
    const byBroker = {};
    for (const [k, g] of s.byBroker) byBroker[k] = g.value;
    const entry = { date, total: s.total, gain: s.gain, byBroker, missing: s.missing };
    a.history = a.history.filter((e) => e.date !== date).concat(entry).sort((x, y) => (x.date < y.date ? -1 : 1)).slice(-HISTORY_MAX);
    return entry;
  }

  /** 今日より前の、いちばん新しい履歴 */
  function previousEntry(a, today) {
    for (let i = a.history.length - 1; i >= 0; i--) if (a.history[i].date < today) return a.history[i];
    return null;
  }

  // ---- 履歴を直す・削除・元に戻す ----

  const byDate = (x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0);

  /** 履歴 1 件を「削除・修正前の履歴」へ(新しいものを先頭に。多すぎたら古いものから消す) */
  function toTrash(a, entry, reason, now) {
    a.historyTrash.unshift({ id: U.uid('hdel'), reason, at: now.toISOString(), entry: cleanHistoryEntry(entry) });
    if (a.historyTrash.length > TRASH_MAX) a.historyTrash.length = TRASH_MAX;
  }

  /**
   * 履歴 1 件の日付と総資産を直す。直す前の記録は「削除・修正前の履歴」に残す(元に戻せる)
   * @returns {{ok: true, changed: boolean, date: string} | {ok: false, error: string}}
   */
  function editHistory(a, date, draft, now = new Date()) {
    const i = a.history.findIndex((e) => e.date === date);
    if (i < 0) return { ok: false, error: 'その日の履歴が見つかりません。' };
    const nextDate = draft.date;
    const total = draft.total;
    if (!U.isDateStr(nextDate)) return { ok: false, error: '日付を正しく入れてください。' };
    if (nextDate > U.todayStr(now)) return { ok: false, error: '今日より先の日付にはできません。' };
    if (!U.isYenValue(total) || total < 0) return { ok: false, error: '総資産は 0 円以上の金額で入れてください。' };
    if (nextDate !== date && a.history.some((e) => e.date === nextDate)) {
      return { ok: false, error: `${nextDate.replace(/-/g, '/')} の履歴がすでにあります。先にそちらを直すか、削除してください。` };
    }
    const old = a.history[i];
    if (old.total === total && nextDate === date) return { ok: true, changed: false, date };
    toTrash(a, old, 'edited', now);
    a.history[i] = { ...old, date: nextDate, total, edited: true };
    a.history.sort(byDate);
    return { ok: true, changed: true, date: nextDate };
  }

  /** 履歴を削除する(「削除・修正前の履歴」へ移す)。消した件数を返す */
  function removeHistory(a, dates, now = new Date()) {
    const set = new Set([].concat(dates));
    const removed = a.history.filter((e) => set.has(e.date));
    for (const e of removed) toTrash(a, e, 'deleted', now);
    a.history = a.history.filter((e) => !set.has(e.date));
    return removed.length;
  }

  /**
   * 「削除・修正前の履歴」の 1 件を履歴に戻す。
   * 同じ日の履歴があるときは、replace: true のときだけ置き換える(今の記録は「置き換え前」として残す)
   * @returns {{ok: true, date: string, replaced: boolean} | {ok: false, conflict?: object, error: string}}
   */
  function restoreHistory(a, trashId, { replace = false } = {}, now = new Date()) {
    const k = a.historyTrash.findIndex((t) => t.id === trashId);
    if (k < 0) return { ok: false, error: '戻す記録が見つかりません。' };
    const t = a.historyTrash[k];
    const j = a.history.findIndex((e) => e.date === t.entry.date);
    if (j >= 0 && !replace) return { ok: false, conflict: a.history[j], error: 'その日の履歴がすでにあります。' };
    a.historyTrash.splice(k, 1);
    if (j >= 0) toTrash(a, a.history.splice(j, 1)[0], 'replaced', now);
    a.history = a.history.concat({ ...t.entry }).sort(byDate).slice(-HISTORY_MAX);
    return { ok: true, date: t.entry.date, replaced: j >= 0 };
  }

  /** 「削除・修正前の履歴」を完全に消す(trashId を省くと全部)。消した件数を返す */
  function purgeTrash(a, trashId) {
    const before = a.historyTrash.length;
    a.historyTrash = trashId == null ? [] : a.historyTrash.filter((t) => t.id !== trashId);
    return before - a.historyTrash.length;
  }

  const SPIKE = 0.15; // 前後の両方と 15% 以上ちがい、向きが逆(飛び出た・落ち込んだ)
  const JUMP = 0.3; // 前回から 30% 以上の増減

  /**
   * 確かめたほうがよい履歴の目印。日付 → [{ id, text }]
   *   spike:前後と比べて飛び出ている / 落ち込んでいる
   *   jump:前回から急に増えた・減った(直前が spike のときは、元に戻っただけなので付けない)
   *   missing:前回より価格未取得の銘柄が多い(取得の失敗で合計が小さくなった可能性)
   *   zero:総資産が 0 円
   */
  function historyFlags(a) {
    const hs = a.history;
    const ratio = (from, to) => (from && from.total > 0 && to ? to.total / from.total - 1 : null);
    const spikes = hs.map((e, i) => {
      const r1 = ratio(hs[i - 1], e);
      const r2 = ratio(e, hs[i + 1]);
      return r1 !== null && r2 !== null && Math.abs(r1) >= SPIKE && Math.abs(r2) >= SPIKE && Math.sign(r1) !== Math.sign(r2) ? r1 : null;
    });
    const out = new Map();
    hs.forEach((e, i) => {
      const f = [];
      const prev = hs[i - 1];
      const r1 = ratio(prev, e);
      const pctText = (r) => `${r > 0 ? '+' : '−'}${Math.round(Math.abs(r) * 100)}%`;
      if (e.total === 0) f.push({ id: 'zero', text: '総資産が 0 円' });
      else if (spikes[i] !== null) f.push({ id: 'spike', text: spikes[i] > 0 ? `前後より高い(${pctText(spikes[i])})` : `前後より低い(${pctText(spikes[i])})` });
      else if (r1 !== null && Math.abs(r1) >= JUMP && spikes[i - 1] == null) f.push({ id: 'jump', text: `前回から急に${r1 > 0 ? '増加' : '減少'}(${pctText(r1)})` });
      if (prev && e.missing > prev.missing) f.push({ id: 'missing', text: `価格未取得が前回より多い(${e.missing}件)` });
      if (f.length) out.set(e.date, f);
    });
    return out;
  }

  // ---- 書き換え ----

  function saveHolding(a, draft) {
    const h = cleanHolding(draft);
    const i = a.holdings.findIndex((x) => x.id === h.id);
    if (i >= 0) a.holdings[i] = h;
    else a.holdings.push(h);
    a.recent = { broker: h.broker, account: h.account, type: h.type };
    return h.id;
  }

  function saveManual(a, draft) {
    const m = cleanManual(draft);
    const i = a.manual.findIndex((x) => x.id === m.id);
    if (i >= 0) a.manual[i] = m;
    else a.manual.push(m);
    return m.id;
  }

  /** 保有の並べ替え(同じ証券会社の中など、ids に入っている銘柄だけを並べ直す) */
  function reorderHoldings(a, ids) {
    a.holdings = U.reorderSubset(a.holdings, ids);
  }

  /** 証券会社の並べ替え(証券会社ごとにまとめ、中の順番はそのまま) */
  function reorderBrokers(a, brokers) {
    const rank = new Map((Array.isArray(brokers) ? brokers : []).map((b, i) => [b, i]));
    const at = (x) => (rank.has(x.broker) ? rank.get(x.broker) : rank.size);
    a.holdings = [...a.holdings].sort((x, y) => at(x) - at(y));
  }

  /** 手入力の資産の並べ替え */
  function reorderManual(a, ids) {
    a.manual = U.reorderSubset(a.manual, ids);
  }

  function removeHolding(a, hid) {
    a.holdings = a.holdings.filter((h) => h.id !== hid);
  }

  function removeManual(a, mid) {
    a.manual = a.manual.filter((m) => m.id !== mid);
    delete a.settings.reflect.manualMap[mid];
  }

  /** 買い増し後の数量と平均取得単価(加重平均) */
  function previewBuyMore(h, addQty, buyPrice) {
    const quantity = round(h.quantity + addQty, 6);
    if (!(quantity > 0)) return null;
    const avgPrice = round((h.quantity * h.avgPrice + addQty * buyPrice) / quantity, 4);
    return { quantity, avgPrice };
  }

  function buyMore(a, hid, addQty, buyPrice) {
    const h = a.holdings.find((x) => x.id === hid);
    const p = h && previewBuyMore(h, addQty, buyPrice);
    if (!p) return false;
    h.quantity = p.quantity;
    h.avgPrice = p.avgPrice;
    return true;
  }

  /** 手入力の資産:評価額・含み損益のどちらかを直したときに、もう片方を計算する */
  function recalcManual({ value, gain, cost }, changed) {
    if (changed === 'value' && value != null) return { value, cost, gain: cost == null ? 0 : value - cost };
    if (changed === 'gain' && gain != null && cost != null) return { value: cost + gain, cost, gain };
    return { value, cost, gain };
  }

  function setPriority(a, source, rid, priority) {
    const target = source === 'manual' ? a.manual.find((m) => m.id === rid) : a.holdings.find((h) => h.id === rid);
    if (target) target.sellPriority = oneOf(PRIORITIES, priority, target.sellPriority);
  }

  /** 旧 NISA / 新 NISA を決める(nisaUnsure を外す) */
  function setNisaAccount(a, hid, account) {
    const h = a.holdings.find((x) => x.id === hid);
    if (!h || (account !== 'nisa_old' && account !== 'nisa_new')) return;
    h.account = account;
    h.nisaUnsure = false;
  }

  // ---- 貼り付けでまとめて登録 ----

  /** コードから種別を推測(国内株:先頭が数字の 4 文字、投資信託:8 文字の英数字、米国株:英字) */
  function guessType(code) {
    const c = normCode(code);
    if (/^\d[0-9A-Z]{3}$/.test(c)) return 'jp';
    if (/^[0-9A-Z]{8}$/.test(c)) return 'fund';
    if (/^[A-Z][A-Z.-]{0,5}$/.test(c)) return 'us';
    return null;
  }

  /**
   * 「コード,銘柄名,数量,取得単価」の行を読む(タブ区切りも可。1 行目が見出しなら飛ばす)
   * @returns {{rows: {line, code, name, quantity, avgPrice, type, mergeWith, error}[]}}
   */
  function parsePaste(textValue, { a, broker, account, type = 'auto' }) {
    const lines = String(textValue || '').split(/\r?\n/);
    const out = [];
    lines.forEach((raw, i) => {
      const line = raw.trim();
      if (!line) return;
      const cells = (line.includes('\t') ? line.split('\t') : line.split(/[,，]/)).map((c) => c.trim());
      const row = { line: i + 1, code: '', name: '', quantity: null, avgPrice: null, type: null, mergeWith: null, error: null };
      if (cells.length < 4) {
        row.error = '「コード,銘柄名,数量,取得単価」の 4 つが必要です';
        out.push(row);
        return;
      }
      row.code = normCode(cells[0]);
      row.name = text(cells.slice(1, -2).join(','));
      const q = U.parseDecimal(cells[cells.length - 2], 6);
      const p = U.parseDecimal(cells[cells.length - 1], 4);
      if (!q.ok || q.value === null) {
        if (!out.length) return; // 1 行目の見出し
        row.error = '数量が読み取れません';
      } else if (q.value <= 0) row.error = '数量は 0 より大きくしてください';
      else if (!p.ok || p.value === null || p.value < 0) row.error = '取得単価が読み取れません';
      row.quantity = q.ok ? q.value : null;
      row.avgPrice = p.ok ? p.value : null;
      if (!row.code && !row.name) row.error = row.error || 'コードか銘柄名が必要です';
      row.type = type === 'auto' ? guessType(row.code) || 'jp' : type;
      if (!row.error) {
        const same = a.holdings.find((h) => h.broker === broker && h.account === account && h.type === row.type && h.code && h.code === row.code);
        if (same) row.mergeWith = same.id;
      }
      out.push(row);
    });
    return { rows: out };
  }

  /** 読んだ行を登録する(同じ銘柄があれば買い増しとして合算) */
  function applyPaste(a, parsedRows, { broker, account }) {
    let added = 0;
    let merged = 0;
    for (const r of parsedRows) {
      if (r.error) continue;
      if (r.mergeWith && buyMore(a, r.mergeWith, r.quantity, r.avgPrice)) merged++;
      else {
        saveHolding(a, { broker, account, type: r.type, code: r.code, name: r.name, quantity: r.quantity, avgPrice: r.avgPrice });
        added++;
      }
    }
    a.recent = { broker, account, type: a.recent.type };
    return { added, merged };
  }

  // ---- 価格の反映 ----

  function priceKey(h) {
    return `${h.type === 'us' ? 'us' : 'jp'}:${normCode(h.code)}`;
  }

  /**
   * 価格取得の結果を反映する。取得できなかった銘柄は前回の価格を残し、理由(lastError)を付ける。
   * report.prices: { [priceKey]: { ok: true, price } | { ok: false, reason } }
   */
  function applyPriceReport(a, report, now = new Date()) {
    const at = now.toISOString();
    for (const h of a.holdings) {
      const r = report.prices[priceKey(h)];
      if (!r) continue;
      h.lastTriedAt = at;
      if (r.ok) {
        if (h.type === 'us') h.priceUsd = r.price;
        else h.price = r.price;
        h.priceAt = at;
        h.priceSource = 'auto';
        h.lastError = null;
      } else h.lastError = r.reason;
    }
    if (report.fx) a.fx = { rate: report.fx.rate, source: report.fx.source, at };
    a.lastUpdateAt = at;
    return saveHistory(a, U.todayStr(now));
  }

  /** 価格を手入力する(米国株はドル) */
  function setManualPrice(a, hid, price, now = new Date()) {
    const h = a.holdings.find((x) => x.id === hid);
    if (!h) return;
    if (h.type === 'us') h.priceUsd = price;
    else h.price = price;
    h.priceAt = now.toISOString();
    h.priceSource = 'manual';
    h.lastError = null;
  }

  // ---- 配当・優待 ----

  /** 配当の税引後の割合(米国株は米国の源泉税 10% も引く。NISA は日本の税なし) */
  function dividendNetFactor(h, a) {
    let f = 1;
    if (h.type === 'us') f *= 1 - US_WITHHOLDING;
    if (isTaxable(h.account)) f *= 1 - taxRate(a);
    return f;
  }

  /** 1 回あたりの配当(円・税引前)。米国株は USD/JPY が無ければ null */
  function dividendPerPayment(h, a) {
    const ps = h.dividend.perShare;
    if (!ps || !h.quantity) return null;
    if (h.type === 'us') return a.fx.rate ? Math.round(ps * h.quantity * a.fx.rate) : null;
    return Math.round(ps * h.quantity);
  }

  /** 月別カレンダー(1〜12月):配当見込み(税引前・税引後)と、優待の権利確定・到着 */
  function dividendCalendar(a) {
    const cal = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, dividends: [], records: [], arrivals: [], gross: 0, net: 0 }));
    let gross = 0;
    let net = 0;
    let missingFx = false;
    for (const h of a.holdings) {
      const g = dividendPerPayment(h, a);
      if (h.dividend.perShare && h.dividend.months.length && g === null && h.type === 'us') missingFx = true;
      if (g !== null) {
        const n = Math.round(g * dividendNetFactor(h, a));
        for (const m of h.dividend.months) {
          const c = cal[m - 1];
          c.dividends.push({ id: h.id, name: h.name, gross: g, net: n });
          c.gross += g;
          c.net += n;
          gross += g;
          net += n;
        }
      }
      const b = h.benefit;
      if (b.content) {
        const short = b.minShares && h.quantity < b.minShares ? round(b.minShares - h.quantity, 6) : 0;
        const entry = { id: h.id, name: h.name, content: b.content, eligible: short === 0, short };
        for (const m of b.recordMonths) cal[m - 1].records.push(entry);
        for (const m of b.arriveMonths) cal[m - 1].arrivals.push(entry);
      }
    }
    return { months: cal, annual: { gross, net }, missingFx };
  }

  // ---- 月末記録への反映 ----

  /** 証券会社×種別のまとまりのキー(「証券A|jp」) */
  const brokerTypeKey = (broker, type) => `${broker}|${type}`;

  /**
   * 反映のまとまり(証券会社ごと / 口座区分ごと / 証券会社×種別)。手入力の資産は 1 件ずつ。
   * 証券会社×種別は、証券会社が出てきた順 → 種別(国内株・米国株・投資信託)の順に並べる。
   */
  function reflectGroups(a) {
    const s = summary(a);
    const by = a.settings.reflect.groupBy;
    const groups = [];
    if (by === 'brokerType') {
      const map = new Map();
      const brokerOrder = [];
      for (const r of s.rows) {
        if (r.source !== 'holding') continue;
        if (!brokerOrder.includes(r.broker)) brokerOrder.push(r.broker);
        const key = brokerTypeKey(r.broker, r.kind);
        if (!map.has(key)) map.set(key, { key, label: `${r.broker}・${label(TYPES, r.kind)}`, value: 0, missing: 0, broker: r.broker, type: r.kind });
        const g = map.get(key);
        if (r.missing) g.missing++;
        else g.value += r.value;
      }
      const typeOrder = (t) => TYPES.findIndex((x) => x.id === t);
      const sorted = [...map.values()].sort((x, y) => brokerOrder.indexOf(x.broker) - brokerOrder.indexOf(y.broker) || typeOrder(x.type) - typeOrder(y.type));
      for (const g of sorted) groups.push({ key: g.key, label: g.label, value: g.value, missing: g.missing });
    } else {
      const source = by === 'account' ? s.byAccount : s.byBroker;
      for (const [key, g] of source) {
        if (key === 'manual' || key === MANUAL_BROKER) continue;
        groups.push({ key, label: by === 'account' ? label(ACCOUNTS, key) : key, value: g.value, missing: g.missing });
      }
    }
    const manual = a.manual.map((m) => ({ key: m.id, label: m.name, value: m.value, missing: 0 }));
    return { groups, manual };
  }

  /** 反映の予定:月末記録の項目ごとに、足し合わせた評価額 */
  function reflectPlan(d, ym) {
    const a = d.assets;
    const { groups, manual } = reflectGroups(a);
    const r = a.settings.reflect;
    const targets = new Map();
    const unmapped = [];
    let missing = 0;
    const put = (itemId, g) => {
      if (!itemId || !MM.findItem(d.monthly, itemId)) return unmapped.push(g.label);
      if (!targets.has(itemId)) targets.set(itemId, { itemId, to: 0, sources: [] });
      const t = targets.get(itemId);
      t.to += g.value;
      t.sources.push(g.label);
      missing += g.missing;
    };
    for (const g of groups) put(r.map[g.key], g);
    for (const g of manual) if (r.manualMap[g.key]) put(r.manualMap[g.key], g);
    const out = [...targets.values()].map((t) => ({ ...t, name: MM.findItem(d.monthly, t.itemId).name, from: MM.getValue(d.monthly, ym, t.itemId) }));
    return { rows: out, unmapped, missing };
  }

  function reflectToMonthly(d, ym, today) {
    const plan = reflectPlan(d, ym);
    if (!plan.rows.length) return 0;
    if (!d.monthly.records[ym]) MM.addMonth(d.monthly, ym, { copy: true });
    for (const r of plan.rows) MM.setValue(d.monthly, ym, r.itemId, r.to, today);
    return plan.rows.length;
  }

  // ---- v2 → v3:資産管理を足す ----

  if (MT.store) {
    MT.store.defineSection('assets', { create, normalize, finalize, hasContent, summarize });
    MT.store.addMigration(2, (d) => {
      d.assets = create();
      d.schemaVersion = 3;
      return d;
    });
    // v9 → v10:資産の履歴を直す・削除・元に戻す(削除・修正前の履歴を入れる場所を足す。今の履歴はそのまま)
    MT.store.addMigration(9, (d) => {
      if (d.assets && typeof d.assets === 'object' && !Array.isArray(d.assets.historyTrash)) d.assets.historyTrash = [];
      d.schemaVersion = 10;
      return d;
    });
  }

  MT.assetsModel = {
    reorderHoldings,
    reorderBrokers,
    reorderManual,
    ACCOUNTS,
    TYPES,
    MANUAL_CATEGORIES,
    PRIORITIES,
    KINDS,
    REFLECT_GROUPS,
    DEFAULT_TAX,
    US_WITHHOLDING,
    MANUAL_BROKER,
    NAME_MAX,
    MEMO_MAX,
    label,
    isTaxable,
    create,
    normalize,
    finalize,
    normCode,
    cleanHolding,
    cleanManual,
    unitPriceYen,
    valuation,
    manualValuation,
    rows,
    summary,
    brokers,
    saveHistory,
    previousEntry,
    editHistory,
    removeHistory,
    restoreHistory,
    purgeTrash,
    historyFlags,
    TRASH_REASONS,
    TRASH_MAX,
    saveHolding,
    saveManual,
    removeHolding,
    removeManual,
    previewBuyMore,
    buyMore,
    recalcManual,
    setPriority,
    setNisaAccount,
    guessType,
    parsePaste,
    applyPaste,
    priceKey,
    applyPriceReport,
    setManualPrice,
    dividendNetFactor,
    dividendPerPayment,
    dividendCalendar,
    brokerTypeKey,
    reflectGroups,
    reflectPlan,
    reflectToMonthly,
  };
})(typeof window !== 'undefined' ? window : globalThis);
