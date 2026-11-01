/*
 * 月末記録:データの形と計算・操作(画面には触らない)
 *
 * monthly = {
 *   categories: [{ id, name }],                       // 区分。配列の順番がそのまま表示順
 *   items:      [{ id, categoryId, name, lastUpdated }], // 項目。区分内の表示順は配列の順番
 *   records: {
 *     "YYYY-MM": {
 *       values:    { [itemId]: 円の整数 },
 *       confirmed: { [itemId]: "YYYY-MM-DD" },  // 入力・確認した日。無い値は「前月からのコピー(未確認)」
 *       memo: ""
 *     }
 *   }
 * }
 */
(function (root) {
  'use strict';
  const MT = (root.MT = root.MT || {});
  const U = MT.util;

  const NAME_MAX = 40;
  const MEMO_MAX = 1000;

  const DEFAULT_CATEGORIES = [
    { id: 'cat_cash', name: '現金(銀行口座)' },
    { id: 'cat_invest', name: '投資(証券口座など)' },
    { id: 'cat_deposit', name: '預かり金' },
  ];

  function create() {
    return {
      categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
      items: [],
      records: {},
    };
  }

  function createRecord() {
    return { values: {}, confirmed: {}, memo: '' };
  }

  function cleanName(s) {
    return String(s == null ? '' : s)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, NAME_MAX);
  }

  // ---- 読み出し・計算 ----

  /** 記録がある年月(古い順) */
  function months(m) {
    return Object.keys(m.records).filter(U.isYM).sort();
  }

  function latestMonth(m) {
    const list = months(m);
    return list.length ? list[list.length - 1] : null;
  }

  /** ym より前で、いちばん近い記録の年月 */
  function prevRecordKey(m, ym) {
    let prev = null;
    for (const k of months(m)) {
      if (k < ym) prev = k;
      else break;
    }
    return prev;
  }

  /** ym より後で、いちばん近い記録の年月 */
  function nextRecordKey(m, ym) {
    return months(m).find((k) => k > ym) || null;
  }

  function findItem(m, id) {
    return m.items.find((it) => it.id === id) || null;
  }

  function findCategory(m, id) {
    return m.categories.find((c) => c.id === id) || null;
  }

  /** 区分ごとにまとめた表示順 [{ category, items }] */
  function groups(m) {
    return m.categories.map((c) => ({ category: c, items: m.items.filter((it) => it.categoryId === c.id) }));
  }

  /** 表示順に並べた全項目 */
  function orderedItems(m) {
    return groups(m).flatMap((g) => g.items);
  }

  function nextItemId(m, itemId) {
    const list = orderedItems(m);
    const i = list.findIndex((it) => it.id === itemId);
    return i >= 0 && i < list.length - 1 ? list[i + 1].id : null;
  }

  function getValue(m, ym, itemId) {
    const r = m.records[ym];
    if (!r) return null;
    const v = r.values[itemId];
    return Number.isInteger(v) ? v : null;
  }

  function isConfirmed(m, ym, itemId) {
    const r = m.records[ym];
    return !!(r && r.confirmed[itemId]);
  }

  /** 前月からコピーしたまま、まだ確認していない値か */
  function isCarried(m, ym, itemId) {
    return getValue(m, ym, itemId) !== null && !isConfirmed(m, ym, itemId);
  }

  function sumItems(m, ym, items) {
    let total = 0;
    for (const it of items) total += getValue(m, ym, it.id) || 0;
    return total;
  }

  function categoryTotal(m, ym, categoryId) {
    return sumItems(
      m,
      ym,
      m.items.filter((it) => it.categoryId === categoryId)
    );
  }

  /** 総資産 = 区分に属するすべての項目の合計 */
  function monthTotal(m, ym) {
    return sumItems(m, ym, orderedItems(m));
  }

  /** 直前の記録との差。最初の月は null */
  function monthDiff(m, ym) {
    const prev = prevRecordKey(m, ym);
    if (!prev) return null;
    const prevTotal = monthTotal(m, prev);
    const total = monthTotal(m, ym);
    return { prev, prevTotal, total, diff: total - prevTotal };
  }

  /** その月の入力状況 */
  function monthStatus(m, ym) {
    const st = { confirmed: 0, carried: 0, empty: 0, total: 0 };
    for (const it of orderedItems(m)) {
      st.total++;
      if (getValue(m, ym, it.id) === null) st.empty++;
      else if (isConfirmed(m, ym, it.id)) st.confirmed++;
      else st.carried++;
    }
    return st;
  }

  /** 最新の月で、まだ入力・確認していない項目の id */
  function staleItemIds(m) {
    const latest = latestMonth(m);
    const ids = new Set();
    for (const it of m.items) {
      if (!latest || !isConfirmed(m, latest, it.id) || getValue(m, latest, it.id) === null) ids.add(it.id);
    }
    return ids;
  }

  /** 新しく月を作るときの初期候補:先月 → 今月 → 途中の抜け → 今月 */
  function suggestNewMonth(m, now = new Date()) {
    const cur = U.currentYM(now);
    const prev = U.ymAdd(cur, -1);
    if (!m.records[prev]) return prev;
    if (!m.records[cur]) return cur;
    const first = months(m)[0];
    for (let ym = U.ymAdd(prev, -1); first && ym > first; ym = U.ymAdd(ym, -1)) {
      if (!m.records[ym]) return ym;
    }
    return cur;
  }

  /** グラフ用:区分ごとの系列 */
  function seriesByCategory(m, monthList) {
    return m.categories.map((c) => ({
      key: c.id,
      label: c.name,
      values: monthList.map((ym) => categoryTotal(m, ym, c.id)),
    }));
  }

  /** グラフ用:項目ごとの系列(表示順) */
  function seriesByItem(m, monthList) {
    return orderedItems(m).map((it) => ({
      key: it.id,
      label: it.name,
      values: monthList.map((ym) => getValue(m, ym, it.id) || 0),
    }));
  }

  // ---- 書き換え(store.update の中で呼ぶ) ----

  /**
   * 月を追加する。copy が true なら、近い記録(前の月、無ければ後の月)の値を
   * 「未確認」の状態で写す。
   */
  function addMonth(m, ym, { copy = true } = {}) {
    if (!U.isYM(ym)) throw new Error('年月の形式が正しくありません: ' + ym);
    if (m.records[ym]) return { created: false, copiedFrom: null };
    const rec = createRecord();
    let copiedFrom = null;
    if (copy) {
      copiedFrom = prevRecordKey(m, ym) || nextRecordKey(m, ym);
      if (copiedFrom) {
        for (const it of m.items) {
          const v = getValue(m, copiedFrom, it.id);
          if (v !== null) rec.values[it.id] = v;
        }
      }
    }
    m.records[ym] = rec;
    return { created: true, copiedFrom };
  }

  function deleteMonth(m, ym) {
    delete m.records[ym];
  }

  /**
   * 金額を入れる(null なら消す)。入れた日を確認日・項目の最終更新日として残す。
   * 同じ金額で保存しても「確認した」扱いになる。
   */
  function setValue(m, ym, itemId, value, today) {
    const item = findItem(m, itemId);
    if (!item) return;
    const r = m.records[ym] || (m.records[ym] = createRecord());
    if (value === null) {
      delete r.values[itemId];
      delete r.confirmed[itemId];
      return;
    }
    if (!U.isYenValue(value)) throw new Error('金額が正しくありません');
    r.values[itemId] = value;
    r.confirmed[itemId] = today;
    item.lastUpdated = today;
  }

  /** 未確認(コピーしたまま)の値を、すべてそのまま確定する */
  function confirmCarried(m, ym, today) {
    const r = m.records[ym];
    if (!r) return 0;
    let n = 0;
    for (const it of m.items) {
      if (isCarried(m, ym, it.id)) {
        r.confirmed[it.id] = today;
        it.lastUpdated = today;
        n++;
      }
    }
    return n;
  }

  function setMemo(m, ym, memo) {
    const r = m.records[ym] || (m.records[ym] = createRecord());
    r.memo = String(memo == null ? '' : memo).slice(0, MEMO_MAX);
  }

  function moveInArray(arr, from, to) {
    if (from < 0 || to < 0 || from >= arr.length || to >= arr.length) return false;
    const [x] = arr.splice(from, 1);
    arr.splice(to, 0, x);
    return true;
  }

  function addCategory(m, name) {
    const c = { id: U.uid('cat'), name: cleanName(name) || '新しい区分' };
    m.categories.push(c);
    return c;
  }

  function renameCategory(m, id, name) {
    const c = findCategory(m, id);
    if (c && cleanName(name)) c.name = cleanName(name);
  }

  /** dir: -1 で上へ、+1 で下へ */
  function moveCategory(m, id, dir) {
    const i = m.categories.findIndex((c) => c.id === id);
    return i >= 0 && moveInArray(m.categories, i, i + dir);
  }

  /** 区分を削除する。中の項目と、その金額もすべて消える */
  function deleteCategory(m, id) {
    for (const it of m.items.filter((x) => x.categoryId === id)) deleteItem(m, it.id);
    m.categories = m.categories.filter((c) => c.id !== id);
  }

  function addItem(m, categoryId, name) {
    if (!findCategory(m, categoryId)) throw new Error('区分が見つかりません');
    const it = { id: U.uid('itm'), categoryId, name: cleanName(name) || '新しい項目', lastUpdated: null };
    m.items.push(it);
    return it;
  }

  function renameItem(m, id, name) {
    const it = findItem(m, id);
    if (it && cleanName(name)) it.name = cleanName(name);
  }

  /** 同じ区分の中で 1 つ上(-1)/下(+1)へ */
  function moveItem(m, id, dir) {
    const it = findItem(m, id);
    if (!it) return false;
    const siblings = m.items.filter((x) => x.categoryId === it.categoryId);
    const pos = siblings.indexOf(it);
    const target = siblings[pos + dir];
    if (!target) return false;
    const a = m.items.indexOf(it);
    const b = m.items.indexOf(target);
    m.items[a] = target;
    m.items[b] = it;
    return true;
  }

  /** 別の区分へ移す(移動先の最後に並ぶ) */
  function changeItemCategory(m, id, categoryId) {
    const it = findItem(m, id);
    if (!it || !findCategory(m, categoryId) || it.categoryId === categoryId) return false;
    m.items = m.items.filter((x) => x !== it);
    it.categoryId = categoryId;
    m.items.push(it);
    return true;
  }

  /** 項目を削除する。過去の月の金額も消える */
  function deleteItem(m, id) {
    m.items = m.items.filter((it) => it.id !== id);
    for (const ym of Object.keys(m.records)) {
      delete m.records[ym].values[id];
      delete m.records[ym].confirmed[id];
    }
  }

  // ---- 読み込み時の点検 ----

  function normalize(raw) {
    const out = { categories: [], items: [], records: {} };
    const seen = new Set();

    for (const c of Array.isArray(raw.categories) ? raw.categories : []) {
      if (!c || typeof c.id !== 'string' || !c.id || seen.has(c.id)) continue;
      seen.add(c.id);
      out.categories.push({ id: c.id, name: cleanName(c.name) || '名称未設定' });
    }

    const catIds = new Set(out.categories.map((c) => c.id));
    for (const it of Array.isArray(raw.items) ? raw.items : []) {
      if (!it || typeof it.id !== 'string' || !it.id || seen.has(it.id)) continue;
      let categoryId = it.categoryId;
      if (!catIds.has(categoryId)) {
        // 区分が見つからない項目は「未分類」に入れて残す
        let fallback = out.categories.find((c) => c.id === 'cat_uncategorized');
        if (!fallback) {
          fallback = { id: 'cat_uncategorized', name: '未分類' };
          out.categories.push(fallback);
          catIds.add(fallback.id);
        }
        categoryId = fallback.id;
      }
      seen.add(it.id);
      out.items.push({
        id: it.id,
        categoryId,
        name: cleanName(it.name) || '名称未設定',
        lastUpdated: U.isDateStr(it.lastUpdated) ? it.lastUpdated : null,
      });
    }

    const itemIds = new Set(out.items.map((it) => it.id));
    const records = raw.records && typeof raw.records === 'object' ? raw.records : {};
    for (const ym of Object.keys(records)) {
      const r = records[ym];
      if (!U.isYM(ym) || !r || typeof r !== 'object') continue;
      const rec = createRecord();
      const values = r.values && typeof r.values === 'object' ? r.values : {};
      const confirmed = r.confirmed && typeof r.confirmed === 'object' ? r.confirmed : {};
      for (const id of Object.keys(values)) {
        if (itemIds.has(id) && U.isYenValue(values[id])) {
          rec.values[id] = values[id];
          if (U.isDateStr(confirmed[id])) rec.confirmed[id] = confirmed[id];
        }
      }
      rec.memo = typeof r.memo === 'string' ? r.memo.slice(0, MEMO_MAX) : '';
      out.records[ym] = rec;
    }
    return out;
  }

  function hasContent(m) {
    return !!m && (m.items.length > 0 || Object.keys(m.records).length > 0);
  }

  function summarize(m) {
    const list = months(m);
    const range = list.length ? `(${U.ymLabel(list[0])}〜${U.ymLabel(list[list.length - 1])})` : '';
    return [`月末記録:項目 ${m.items.length}件・記録 ${list.length}か月分${range}`];
  }

  if (MT.store) {
    MT.store.defineSection('monthly', { create, normalize, hasContent, summarize });
  }

  MT.monthlyModel = {
    NAME_MAX,
    MEMO_MAX,
    create,
    normalize,
    months,
    latestMonth,
    prevRecordKey,
    nextRecordKey,
    findItem,
    findCategory,
    groups,
    orderedItems,
    nextItemId,
    getValue,
    isConfirmed,
    isCarried,
    categoryTotal,
    monthTotal,
    monthDiff,
    monthStatus,
    staleItemIds,
    suggestNewMonth,
    seriesByCategory,
    seriesByItem,
    addMonth,
    deleteMonth,
    setValue,
    confirmCarried,
    setMemo,
    addCategory,
    renameCategory,
    moveCategory,
    deleteCategory,
    addItem,
    renameItem,
    moveItem,
    changeItemCategory,
    deleteItem,
  };
})(typeof window !== 'undefined' ? window : globalThis);
