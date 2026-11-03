// ポケカ在庫の計算・旧データ変換のテスト(画面は対象外)。使うのは架空のデータだけ。
// 実行方法: node --test(リポジトリのいちばん上で)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

require('../js/core/util.js');
require('../js/core/store.js');
require('../js/features/monthly/model.js');
require('../js/features/payments/model.js');
require('../js/features/assets/model.js');
require('../js/features/inventory/model.js');
require('../js/features/inventory/legacy.js');
require('../js/features/sidejob/model.js');
require('../js/data/sample.js');

const { store, monthlyModel: M, inventoryModel: I, inventoryLegacy: L, sample } = globalThis.MT;
const NOW = new Date(2026, 10, 15);

function fixture() {
  const d = store.createEmpty(NOW);
  const inv = d.inventory;
  I.addPurchase(inv, '商品A', 2, 5000);
  I.addPurchase(inv, '商品B', 3, 1000);
  return { d, inv, a: I.findByName(inv, '商品A'), b: I.findByName(inv, '商品B') };
}

test('段階3(v3)のデータを v4 に移行しても、ほかの区画は変わらない', () => {
  const v3 = store.createEmpty(NOW);
  M.addItem(v3.monthly, 'cat_cash', '架空銀行');
  v3.assets.manual.push({ id: 'm1', name: '手入力', category: 'cash', value: 1000, cost: 1000 });
  delete v3.inventory;
  delete v3.sidejob;
  v3.schemaVersion = 3;
  const res = store.prepare(JSON.parse(JSON.stringify(v3)));
  assert.equal(res.ok, true);
  assert.equal(res.migrated, true);
  assert.equal(res.data.schemaVersion, store.SCHEMA_VERSION); // v4 以降まで続けて移行
  assert.equal(res.data.monthly.items[0].name, '架空銀行');
  assert.equal(res.data.assets.manual[0].name, '手入力');
  assert.deepEqual(res.data.inventory.items, []);
  assert.deepEqual(res.data.sidejob.records, []);
});

test('同じ商品名に追加すると、加重平均で購入単価を出し直す(売却優先度の既定は「最初に売る」)', () => {
  const { inv, a } = fixture();
  assert.equal(a.priority, 'first');
  const res = I.addPurchase(inv, '商品A', 1, 6500);
  assert.equal(res.merged, true);
  assert.equal(a.quantity, 3);
  assert.equal(a.unitCost, 5500);
  assert.deepEqual(I.previewPurchase(inv, '商品A', 1, 4300), { before: { quantity: 3, unitCost: 5500 }, after: { quantity: 4, unitCost: 5200 } });
  I.addPurchase(inv, '商品B', 1, 1500);
  assert.equal(I.findByName(inv, '商品B').unitCost, 1125);
});

test('+/− で個数を直せる(0 未満にはならない)', () => {
  const { inv, b } = fixture();
  assert.equal(I.adjustQuantity(inv, b.id, 1), true);
  assert.equal(b.quantity, 4);
  for (let i = 0; i < 4; i++) I.adjustQuantity(inv, b.id, -1);
  assert.equal(b.quantity, 0);
  assert.equal(I.adjustQuantity(inv, b.id, -1), false);
});

test('評価額:相場があれば個数 × 最新の相場、無ければ購入単価。予定利益は (相場 − 購入単価) × 在庫', () => {
  const { inv, a, b } = fixture();
  I.savePrice(inv, a.id, { date: '2026-10-01', price: 6000, store: '買取店A' });
  I.savePrice(inv, a.id, { date: '2026-11-01', price: 7200, store: '' });
  I.savePrice(inv, a.id, { date: '2026-09-01', price: 9999, store: '' }); // 古い日付は最新ではない
  assert.equal(I.latestPrice(a).price, 7200);
  const va = I.valuation(a);
  assert.deepEqual([va.value, va.expected, va.held], [14400, 4400, 10000]);
  const vb = I.valuation(b);
  assert.deepEqual([vb.value, vb.expected], [3000, 0]); // 相場なし
});

test('売却:在庫が足りなければ止め、売った時点の購入単価で確定利益を出し、直す・消すと個数が戻る', () => {
  const { inv, a } = fixture();
  assert.equal(I.saveSale(inv, a.id, { date: '2026-11-02', quantity: 3, price: 7000 }).ok, false);
  assert.equal(I.saveSale(inv, a.id, { date: '2026-11-02', quantity: 1, price: 7000 }).ok, true);
  assert.equal(a.quantity, 1);
  const sale = a.sales[0];
  assert.equal(sale.costAtSale, 5000);
  // あとで高く仕入れても、売った分の購入単価は変わらない
  I.addPurchase(inv, '商品A', 1, 9000);
  assert.equal(a.unitCost, 7000);
  assert.equal(I.valuation(a).realized, 2000);
  // 直す:個数 1 → 3(在庫 2 + 元の 1 = 3 まで売れる)
  assert.equal(I.saveSale(inv, a.id, { id: sale.id, date: '2026-11-02', quantity: 4, price: 7000 }).ok, false);
  assert.equal(I.saveSale(inv, a.id, { id: sale.id, date: '2026-11-03', quantity: 3, price: 7500 }).ok, true);
  assert.equal(a.quantity, 0);
  assert.equal(a.sales[0].costAtSale, 5000);
  assert.equal(I.valuation(a).realized, (7500 - 5000) * 3);
  // 消す:個数が戻る
  I.removeSale(inv, a.id, a.sales[0].id);
  assert.equal(a.quantity, 3);
  assert.equal(I.valuation(a).realized, 0);
});

test('集計:総支出・総予定利益・確定利益と、売却優先度別の評価額', () => {
  const { inv, a, b } = fixture();
  I.savePrice(inv, a.id, { date: '2026-11-01', price: 6000, store: '' });
  I.saveSale(inv, b.id, { date: '2026-11-01', quantity: 1, price: 1800 });
  I.updateItem(inv, b.id, { priority: 'keep' });
  const s = I.summary(inv);
  assert.equal(s.value, 12000 + 2000);
  assert.equal(s.spent, 10000 + 2000 + 1000); // 在庫の購入額 + 売った分の購入額
  assert.equal(s.expected, 2000);
  assert.equal(s.realized, 800);
  assert.equal(s.byPriority.get('first').value, 12000);
  assert.equal(s.byPriority.get('keep').value, 2000);
  assert.equal([...s.byPriority.values()].reduce((t, g) => t + g.value, 0), s.value);
});

test('名前を既存の名前に変えると、個数・相場履歴・売却履歴を 1 つに統合する', () => {
  const { inv, a, b } = fixture();
  I.savePrice(inv, a.id, { date: '2026-10-01', price: 6000, store: '' });
  I.savePrice(inv, b.id, { date: '2026-10-05', price: 1200, store: '' });
  I.saveSale(inv, b.id, { date: '2026-10-06', quantity: 1, price: 1300 });
  assert.equal(I.renameTarget(inv, b.id, '商品A').id, a.id);
  const res = I.rename(inv, b.id, '商品A');
  assert.deepEqual([res.merged, res.id], [true, a.id]);
  assert.equal(inv.items.length, 1);
  assert.equal(a.quantity, 4);
  assert.equal(a.unitCost, 3000); // (2×5000 + 2×1000) ÷ 4
  assert.equal(a.prices.length, 2);
  assert.equal(a.sales.length, 1);
  // 重ならない名前なら、名前を変えるだけ
  assert.equal(I.rename(inv, a.id, '商品A(改)').merged, false);
  assert.equal(a.name, '商品A(改)');
});

test('月末記録への反映:評価額の合計を、設定した項目に書き込む', () => {
  const { d, inv } = fixture();
  const item = M.addItem(d.monthly, 'cat_invest', 'コレクション');
  assert.equal(I.reflectPlan(d, '2026-11').itemId, null);
  inv.settings.reflectItemId = item.id;
  assert.equal(I.reflectToMonthly(d, '2026-11', '2026-11-30'), true);
  assert.equal(M.getValue(d.monthly, '2026-11', item.id), 13000);
  M.deleteItem(d.monthly, item.id);
  I.finalize(d);
  assert.equal(inv.settings.reflectItemId, null);
});

test('旧アプリ:atob + decodeURIComponent の形を戻し、inventory だけを読む', () => {
  const legacy = {
    inventory: {
      商品A: { quantity: 2, purchasePrice: 5000, history: [{ date: '2026/10/1', price: 6200, store: '買取店A' }, { date: 'いつか', price: 1 }], sales: [{ date: '2026/10/10', quantity: 1, price: 6500 }] },
      商品B: { quantity: 'x', purchasePrice: '1200', history: [], sales: [{ date: '2026-10-11', quantity: 0, price: 100 }] },
    },
    lotteries: [{ name: '抽選' }],
    settings: { a: 1 },
    sheetMeta: {},
  };
  const encoded = btoa(encodeURIComponent(JSON.stringify(legacy)));
  assert.equal(L.needsLz(encoded), false);
  const dec = L.decode(encoded, null);
  assert.equal(dec.ok, true);
  const { data, report } = L.convert(dec.obj, store.createEmpty(NOW));
  const items = data.inventory.items;
  assert.equal(items.length, 2);
  const a = items.find((x) => x.name === '商品A');
  assert.deepEqual([a.quantity, a.unitCost, a.prices.length, a.sales.length, a.sales[0].costAtSale, a.priority], [2, 5000, 1, 1, 5000, 'first']);
  assert.equal(a.prices[0].date, '2026-10-01');
  const b = items.find((x) => x.name === '商品B');
  assert.deepEqual([b.quantity, b.unitCost], [0, 1200]);
  for (const word of ['いつか', '「x」', '売却の記録']) assert.ok(report.issues.some((t) => t.includes(word)), word);
  assert.ok(report.notes.some((t) => t.includes('lotteries') && t.includes('settings') && t.includes('sheetMeta')));
  assert.equal(store.prepare(data).ok, true);
});

test('旧アプリ:先頭が "LZ:" なら LZ-String の decompressFromBase64 で展開する', () => {
  const json = JSON.stringify({ inventory: { 商品C: { quantity: 1, purchasePrice: 800, history: [], sales: [] } } });
  const calls = [];
  const fakeLz = { decompressFromBase64: (s) => (calls.push(s), s === 'PAYLOAD' ? json : null) };
  assert.equal(L.needsLz('LZ:PAYLOAD'), true);
  const dec = L.decode('LZ:PAYLOAD', fakeLz);
  assert.equal(dec.ok, true);
  assert.deepEqual(calls, ['PAYLOAD']);
  assert.equal(dec.obj.inventory['商品C'].purchasePrice, 800);
  assert.equal(L.decode('LZ:PAYLOAD', null).ok, false); // 部品が無ければ止める
  assert.equal(L.decode('LZ:BROKEN', fakeLz).ok, false);
  assert.equal(L.decode('not base64 !!', null).ok, false);
});

test('サンプル:在庫も入っていて、集計が一致する', () => {
  const d = store.prepare(sample.build(NOW)).data;
  const s = I.summary(d.inventory);
  assert.ok(d.inventory.items.length >= 3);
  assert.equal([...s.byPriority.values()].reduce((t, g) => t + g.value, 0), s.value);
});
