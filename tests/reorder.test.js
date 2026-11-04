// 並べ替えのテスト(画面は対象外)。使うのは架空のデータだけ。
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
require('../js/features/future/model.js'); // v7 → v8 の移行
require('../js/features/monthly/model.js');
require('../js/features/payments/model.js');
require('../js/features/assets/model.js');
require('../js/features/inventory/model.js');
require('../js/features/sidejob/model.js');

const { util: U, store, paymentsModel: P, assetsModel: A, inventoryModel: I, sidejobModel: S } = globalThis.MT;

const NOW = new Date(2026, 10, 15); // 2026-11-15
const YM = '2026-11';
const names = (arr) => arr.map((x) => x.name);

test('reorderSubset:指定した要素だけを指定の順に並べ、ほかの要素の位置は変えない', () => {
  const arr = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }];
  assert.deepEqual(U.reorderSubset(arr, ['e', 'd', 'c', 'b', 'a']).map((x) => x.id), ['e', 'd', 'c', 'b', 'a']);
  // b・d だけを入れ替える(a・c・e はそのまま)
  assert.deepEqual(U.reorderSubset(arr, ['d', 'b']).map((x) => x.id), ['a', 'd', 'c', 'b', 'e']);
  // 無い id・重複は無視。元の配列は変えない
  assert.deepEqual(U.reorderSubset(arr, ['x', 'c', 'c', 'a']).map((x) => x.id), ['c', 'b', 'a', 'd', 'e']);
  assert.deepEqual(arr.map((x) => x.id), ['a', 'b', 'c', 'd', 'e']);
});

test('moveInArray:範囲外は動かさない', () => {
  const arr = [1, 2, 3];
  assert.equal(U.moveInArray(arr, 0, 2), true);
  assert.deepEqual(arr, [2, 3, 1]);
  assert.equal(U.moveInArray(arr, 0, 3), false);
  assert.equal(U.moveInArray(arr, -1, 0), false);
  assert.deepEqual(arr, [2, 3, 1]);
});

function paymentsFixture() {
  const p = P.create(NOW);
  p.month = YM;
  P.saveBill(p, { id: 'b27', name: '支払い27日', amount: 3000, dueDay: 27, category: 'fixed' });
  P.saveBill(p, { id: 'b10', name: '支払い10日', amount: 1000, dueDay: 10, category: 'fixed' });
  P.saveBill(p, { id: 'bnd', name: '日付なし', amount: 500, category: 'variable' });
  P.saveBill(p, { id: 'bend', name: '終了した支払い', amount: 700, dueDay: 5, category: 'fixed', endMonth: '2026-10' });
  P.saveBill(p, { id: 'b20', name: '支払い20日', amount: 2000, dueDay: 20, category: 'loan' });
  return p;
}

test('支払い:はじめは引き落とし日順(日付なしは最後)。並べ替えると、その順で表示する', () => {
  const p = paymentsFixture();
  assert.equal(p.billOrder, 'due');
  assert.deepEqual(names(P.activeBills(p, YM)), ['支払い10日', '支払い20日', '支払い27日', '日付なし']);

  P.reorderBills(p, ['bnd', 'b27', 'b10', 'b20']);
  assert.equal(p.billOrder, 'manual');
  assert.deepEqual(names(P.activeBills(p, YM)), ['日付なし', '支払い27日', '支払い10日', '支払い20日']);
  // 終了した支払いは、配列の中の位置が変わらない
  assert.equal(p.bills[3].id, 'bend');
  // 明細行(概要・口座ごとの引き落とし)も同じ順
  assert.deepEqual(
    P.lines(p, YM).filter((l) => l.source === 'bill').map((l) => l.id),
    ['bnd', 'b27', 'b10', 'b20']
  );
});

test('支払い:自分で並べた順のとき、新しい支払いは引き落とし日の位置に入る。日付順に戻せる', () => {
  const p = paymentsFixture();
  P.reorderBills(p, ['b10', 'b20', 'b27', 'bnd']);
  P.saveBill(p, { id: 'b15', name: '支払い15日', amount: 1500, dueDay: 15, category: 'fixed' });
  P.saveBill(p, { id: 'bnd2', name: '日付なし2', amount: 100, category: 'fixed' });
  assert.deepEqual(names(P.activeBills(p, YM)), ['支払い10日', '支払い15日', '支払い20日', '支払い27日', '日付なし', '日付なし2']);
  // 既存の支払いの編集では位置を変えない
  P.saveBill(p, { ...p.bills.find((b) => b.id === 'b10'), dueDay: 28 });
  assert.equal(P.activeBills(p, YM)[0].id, 'b10');

  P.reorderBills(p, [], 'due');
  assert.equal(p.billOrder, 'due');
  assert.deepEqual(names(P.activeBills(p, YM)), ['支払い15日', '支払い20日', '支払い27日', '支払い10日', '日付なし', '日付なし2']);
});

test('支払い:並びは保存して読み直しても残る。おかしな値は引き落とし日順にする', () => {
  const d = store.createEmpty(NOW);
  d.payments = paymentsFixture();
  P.reorderBills(d.payments, ['b27', 'b10']);
  const again = P.normalize(JSON.parse(JSON.stringify(d.payments)));
  assert.equal(again.billOrder, 'manual');
  assert.deepEqual(names(P.activeBills(again, YM)).slice(0, 2), ['支払い27日', '支払い10日']);
  assert.equal(P.normalize({ ...d.payments, billOrder: 'xyz' }).billOrder, 'due');
});

test('v6 のデータを開くと v7 になり、支払いは引き落とし日順のまま', () => {
  const v6 = store.createEmpty(NOW);
  v6.payments = paymentsFixture();
  delete v6.payments.billOrder;
  v6.schemaVersion = 6;
  const res = store.prepare(JSON.parse(JSON.stringify(v6)));
  assert.equal(res.ok, true);
  assert.equal(res.data.schemaVersion, store.SCHEMA_VERSION); // v7 を通って最新の版まで上がる
  assert.equal(res.data.payments.billOrder, 'due');
  assert.deepEqual(names(P.activeBills(res.data.payments, YM)), ['支払い10日', '支払い20日', '支払い27日', '日付なし']);
});

test('入金予定の並べ替え', () => {
  const p = P.create(NOW);
  for (const n of ['入金A', '入金B', '入金C']) P.saveIncome(p, { id: n, name: n, amount: 1000 });
  P.reorderIncomes(p, ['入金C', '入金A', '入金B']);
  assert.deepEqual(names(p.incomes), ['入金C', '入金A', '入金B']);
});

test('資産:同じ証券会社の中の並べ替えと、証券会社の並べ替え', () => {
  const a = A.create();
  const add = (id, broker) => a.holdings.push({ id, broker, name: id });
  add('x1', '証券A');
  add('y1', '証券B');
  add('x2', '証券A');
  add('z1', '証券C');
  add('y2', '証券B');
  A.reorderHoldings(a, ['x2', 'x1']);
  assert.deepEqual(names(a.holdings), ['x2', 'y1', 'x1', 'z1', 'y2']);
  A.reorderBrokers(a, ['証券C', '証券A', '証券B']);
  assert.deepEqual(names(a.holdings), ['z1', 'x2', 'x1', 'y1', 'y2']);
  a.manual.push({ id: 'm1', name: 'm1' }, { id: 'm2', name: 'm2' });
  A.reorderManual(a, ['m2', 'm1']);
  assert.deepEqual(names(a.manual), ['m2', 'm1']);
});

test('在庫と副業の依頼元の並べ替え', () => {
  const inv = I.create();
  inv.items.push({ id: 'i1', name: '商品1' }, { id: 'i2', name: '商品2' });
  I.reorderItems(inv, ['i2', 'i1']);
  assert.deepEqual(names(inv.items), ['商品2', '商品1']);
  const sj = S.create();
  sj.clients.push(S.cleanClient({ id: 'c1', name: '依頼元1' }), S.cleanClient({ id: 'c2', name: '依頼元2' }));
  S.reorderClients(sj, ['c2', 'c1']);
  assert.deepEqual(names(sj.clients), ['依頼元2', '依頼元1']);
});
