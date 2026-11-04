/*
 * ポケカ在庫:データの形と計算・操作(画面には触らない)
 *
 * inventory = {
 *   items: [{
 *     id, name,                       // 商品名(重複しない。同じ名前にすると統合する)
 *     quantity,                       // 在庫の個数(整数)
 *     unitCost,                       // 購入単価(円。加重平均なので小数 2 桁まで持つ)
 *     priority,                       // 売却優先度 first / ifNeeded / keep(既定は first)
 *     prices: [{ id, date, price, store }],                 // 相場の記録(買取相場・買取店は任意)
 *     sales:  [{ id, date, quantity, price, costAtSale }],  // 売却の記録(costAtSale = 売った時点の購入単価)
 *     memo
 *   }],
 *   settings: { reflectItemId }       // 月末記録の反映先の項目
 * }
 *
 * 評価額 = 個数 × 最新の相場(相場が無ければ購入単価)。金額は円の整数に丸める。
 * 売却を足す・直す・消すと、在庫の個数もそれに合わせて動く(個数がマイナスになる変更は止める)。
 */
(function (root) {
  'use strict';
  const MT = (root.MT = root.MT || {});
  const U = MT.util;
  const MM = MT.monthlyModel;

  const PRIORITIES = [
    { id: 'first', label: '最初に売る' },
    { id: 'ifNeeded', label: '足りなければ売る' },
    { id: 'keep', label: '売りたくない' },
  ];
  const NAME_MAX = 60;
  const MEMO_MAX = 1000;

  const label = (id) => (PRIORITIES.find((p) => p.id === id) || { label: id }).label;

  function create() {
    return { items: [], settings: { reflectItemId: null } };
  }

  // ---- 値の点検 ----

  const text = (s, max = NAME_MAX) =>
    String(s == null ? '' : s)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max);
  const round2 = (v) => Math.round(v * 100) / 100;
  const intOr = (v, min, fallback) => (Number.isInteger(v) && v >= min && v < 1e9 ? v : fallback);
  const cost = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e12 ? round2(v) : 0);
  const id = (v, prefix) => (typeof v === 'string' && v ? v.slice(0, 64) : U.uid(prefix));
  const list = (arr) => (Array.isArray(arr) ? arr : []).filter((x) => x && typeof x === 'object');
  const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

  function cleanPrice(p) {
    return { id: id(p.id, 'prc'), date: p.date, price: p.price, store: text(p.store, 40) };
  }
  function cleanSale(s) {
    return { id: id(s.id, 'sale'), date: s.date, quantity: s.quantity, price: s.price, costAtSale: cost(s.costAtSale) };
  }

  function cleanItem(x) {
    return {
      id: id(x.id, 'inv'),
      name: text(x.name) || '商品',
      quantity: intOr(x.quantity, 0, 0),
      unitCost: cost(x.unitCost),
      priority: PRIORITIES.some((p) => p.id === x.priority) ? x.priority : 'first',
      prices: list(x.prices)
        .filter((p) => U.isDateStr(p.date) && Number.isInteger(p.price) && p.price >= 0 && U.isYenValue(p.price))
        .map(cleanPrice)
        .sort(byDate),
      sales: list(x.sales)
        .filter((s) => U.isDateStr(s.date) && Number.isInteger(s.quantity) && s.quantity > 0 && Number.isInteger(s.price) && s.price >= 0)
        .map(cleanSale)
        .sort(byDate),
      memo: String(x.memo == null ? '' : x.memo).slice(0, MEMO_MAX),
    };
  }

  /** 同じ名前の商品は 1 つにまとめる(読み込み時の点検) */
  function normalize(raw) {
    const inv = create();
    for (const x of list(raw.items).map(cleanItem)) {
      const same = inv.items.find((y) => y.name === x.name);
      if (same) mergeItems(same, x);
      else if (!inv.items.some((y) => y.id === x.id)) inv.items.push(x);
    }
    const s = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
    inv.settings.reflectItemId = typeof s.reflectItemId === 'string' && s.reflectItemId ? s.reflectItemId : null;
    return inv;
  }

  function finalize(d) {
    const inv = d.inventory;
    if (!inv || !d.monthly) return;
    if (inv.settings.reflectItemId && !MM.findItem(d.monthly, inv.settings.reflectItemId)) inv.settings.reflectItemId = null;
  }

  function hasContent(inv) {
    return !!inv && inv.items.length > 0;
  }

  function summarize(inv) {
    return [`ポケカ在庫:商品 ${inv.items.length}件`];
  }

  // ---- 計算 ----

  const find = (inv, iid) => inv.items.find((x) => x.id === iid) || null;
  const findByName = (inv, name) => inv.items.find((x) => x.name === text(name)) || null;

  /** 最新の相場(日付がいちばん新しいもの。同じ日なら後から記録したもの) */
  function latestPrice(item) {
    let best = null;
    for (const p of item.prices) if (!best || p.date >= best.date) best = p;
    return best;
  }

  /** 商品 1 件の評価 */
  function valuation(item) {
    const latest = latestPrice(item);
    const unit = latest ? latest.price : item.unitCost;
    const held = Math.round(item.quantity * item.unitCost); // 在庫の購入額
    const soldCost = item.sales.reduce((t, s) => t + Math.round(s.quantity * s.costAtSale), 0);
    const realized = item.sales.reduce((t, s) => t + Math.round(s.quantity * (s.price - s.costAtSale)), 0);
    return {
      latest,
      value: Math.round(item.quantity * unit),
      held,
      spent: held + soldCost, // この商品にかけたお金(在庫分 + 売った分)
      expected: latest ? Math.round((latest.price - item.unitCost) * item.quantity) : 0, // 予定利益
      realized, // 確定利益
      soldCount: item.sales.reduce((t, s) => t + s.quantity, 0),
    };
  }

  /** 集計:評価額・総支出・総予定利益・確定利益と、売却優先度別の評価額 */
  function summary(inv) {
    const rows = inv.items.map((item) => ({ item, ...valuation(item) }));
    const byPriority = new Map(PRIORITIES.map((p) => [p.id, { value: 0, count: 0, quantity: 0 }]));
    const t = { value: 0, held: 0, spent: 0, expected: 0, realized: 0, quantity: 0 };
    for (const r of rows) {
      for (const k of ['value', 'held', 'spent', 'expected', 'realized']) t[k] += r[k];
      t.quantity += r.item.quantity;
      const g = byPriority.get(r.item.priority);
      g.value += r.value;
      g.count++;
      g.quantity += r.item.quantity;
    }
    return { rows, ...t, byPriority };
  }

  // ---- 書き換え ----

  /** 仕入れを足す。同じ商品名があれば、加重平均で購入単価を出し直す */
  function addPurchase(inv, name, quantity, unitPrice) {
    const n = text(name);
    if (!n || !Number.isInteger(quantity) || quantity <= 0 || !(unitPrice >= 0)) return null;
    const item = findByName(inv, n);
    if (item) {
      const q = item.quantity + quantity;
      item.unitCost = round2((item.quantity * item.unitCost + quantity * unitPrice) / q);
      item.quantity = q;
      return { item, merged: true };
    }
    const created = cleanItem({ name: n, quantity, unitCost: unitPrice, priority: 'first' });
    inv.items.push(created);
    return { item: created, merged: false };
  }

  /** 加重平均のプレビュー */
  function previewPurchase(inv, name, quantity, unitPrice) {
    const item = findByName(inv, name);
    if (!item || !(quantity > 0)) return null;
    const q = item.quantity + quantity;
    return { before: { quantity: item.quantity, unitCost: item.unitCost }, after: { quantity: q, unitCost: round2((item.quantity * item.unitCost + quantity * unitPrice) / q) } };
  }

  /** +/− ボタン(個数の手直し。購入単価は変えない) */
  function adjustQuantity(inv, iid, delta) {
    const item = find(inv, iid);
    if (!item) return false;
    const q = item.quantity + delta;
    if (q < 0) return false;
    item.quantity = q;
    return true;
  }

  function updateItem(inv, iid, { quantity, unitCost, priority, memo }) {
    const item = find(inv, iid);
    if (!item) return;
    if (Number.isInteger(quantity) && quantity >= 0) item.quantity = quantity;
    if (unitCost >= 0) item.unitCost = round2(unitCost);
    if (PRIORITIES.some((p) => p.id === priority)) item.priority = priority;
    if (memo != null) item.memo = String(memo).slice(0, MEMO_MAX);
  }

  /** b を a にまとめる(個数・相場履歴・売却履歴・メモ。購入単価は個数で加重平均) */
  function mergeItems(a, b) {
    const q = a.quantity + b.quantity;
    if (q > 0) a.unitCost = round2((a.quantity * a.unitCost + b.quantity * b.unitCost) / q);
    else if (!a.unitCost) a.unitCost = b.unitCost;
    a.quantity = q;
    a.prices = a.prices.concat(b.prices).sort(byDate);
    a.sales = a.sales.concat(b.sales).sort(byDate);
    if (b.memo) a.memo = [a.memo, b.memo].filter(Boolean).join('\n').slice(0, MEMO_MAX);
    return a;
  }

  /** 同じ名前の商品が別にあるか(名前を変えると統合になるか) */
  function renameTarget(inv, iid, newName) {
    const n = text(newName);
    return inv.items.find((x) => x.id !== iid && x.name === n) || null;
  }

  /** 名前を変える。既にある名前なら、その商品に統合する */
  function rename(inv, iid, newName) {
    const item = find(inv, iid);
    const n = text(newName);
    if (!item || !n) return { ok: false };
    const target = renameTarget(inv, iid, n);
    if (!target) {
      item.name = n;
      return { ok: true, merged: false, id: item.id };
    }
    mergeItems(target, item);
    inv.items = inv.items.filter((x) => x !== item);
    return { ok: true, merged: true, id: target.id };
  }

  /** 商品の並べ替え */
  function reorderItems(inv, ids) {
    inv.items = U.reorderSubset(inv.items, ids);
  }

  function removeItem(inv, iid) {
    inv.items = inv.items.filter((x) => x.id !== iid);
  }

  function savePrice(inv, iid, { id: pid, date, price, store }) {
    const item = find(inv, iid);
    if (!item || !U.isDateStr(date) || !Number.isInteger(price) || price < 0) return false;
    const p = cleanPrice({ id: pid, date, price, store });
    const i = item.prices.findIndex((x) => x.id === p.id);
    if (i >= 0) item.prices[i] = p;
    else item.prices.push(p);
    item.prices.sort(byDate);
    return true;
  }

  function removePrice(inv, iid, pid) {
    const item = find(inv, iid);
    if (item) item.prices = item.prices.filter((p) => p.id !== pid);
  }

  /**
   * 売却を記録する(新規・修正)。在庫が足りなければ止める。
   * 新規は今の購入単価を costAtSale として残し、修正では元の costAtSale を引き継ぐ。
   * @returns {{ok: true} | {ok: false, error: string}}
   */
  function saveSale(inv, iid, { id: sid, date, quantity, price }) {
    const item = find(inv, iid);
    if (!item) return { ok: false, error: '商品が見つかりません' };
    if (!U.isDateStr(date)) return { ok: false, error: '日付を入れてください' };
    if (!Number.isInteger(quantity) || quantity <= 0) return { ok: false, error: '個数は 1 以上の整数で入れてください' };
    if (!Number.isInteger(price) || price < 0) return { ok: false, error: '売却単価を入れてください' };
    const old = sid ? item.sales.find((s) => s.id === sid) : null;
    const stock = item.quantity + (old ? old.quantity : 0);
    if (quantity > stock) return { ok: false, error: `在庫が足りません(売れるのは ${stock}個まで)` };
    item.quantity = stock - quantity;
    const sale = cleanSale({ id: sid, date, quantity, price, costAtSale: old ? old.costAtSale : item.unitCost });
    if (old) item.sales[item.sales.indexOf(old)] = sale;
    else item.sales.push(sale);
    item.sales.sort(byDate);
    return { ok: true };
  }

  /** 売却を消す(個数は戻る) */
  function removeSale(inv, iid, sid) {
    const item = find(inv, iid);
    const s = item && item.sales.find((x) => x.id === sid);
    if (!s) return false;
    item.quantity += s.quantity;
    item.sales = item.sales.filter((x) => x !== s);
    return true;
  }

  // ---- 月末記録への反映 ----

  function reflectPlan(d, ym) {
    const inv = d.inventory;
    const itemId = inv.settings.reflectItemId;
    const it = itemId ? MM.findItem(d.monthly, itemId) : null;
    const s = summary(inv);
    return { itemId: it ? it.id : null, name: it ? it.name : null, from: it ? MM.getValue(d.monthly, ym, it.id) : null, to: s.value };
  }

  function reflectToMonthly(d, ym, today) {
    const plan = reflectPlan(d, ym);
    if (!plan.itemId) return false;
    if (!d.monthly.records[ym]) MM.addMonth(d.monthly, ym, { copy: true });
    MM.setValue(d.monthly, ym, plan.itemId, plan.to, today);
    return true;
  }

  // ---- v3 → v4 ----
  // 在庫(inventory)と副業(sidejob)の区画は、読み込み時の点検(normalize)で空の状態から作られる。

  if (MT.store) {
    MT.store.defineSection('inventory', { create, normalize, finalize, hasContent, summarize });
    MT.store.addMigration(3, (d) => {
      d.schemaVersion = 4;
      return d;
    });
  }

  MT.inventoryModel = {
    reorderItems,
    PRIORITIES,
    NAME_MAX,
    label,
    create,
    normalize,
    finalize,
    cleanItem,
    find,
    findByName,
    latestPrice,
    valuation,
    summary,
    addPurchase,
    previewPurchase,
    adjustQuantity,
    updateItem,
    renameTarget,
    rename,
    removeItem,
    savePrice,
    removePrice,
    saveSale,
    removeSale,
    reflectPlan,
    reflectToMonthly,
  };
})(typeof window !== 'undefined' ? window : globalThis);
