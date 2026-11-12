// 計算・データ処理のテスト(画面は対象外)
// 実行方法: node --test(リポジトリのいちばん上で)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

// localStorage の代わり(メモリ上)
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
require('../js/features/payments/model.js'); // v1 → v2 の移行が入っている
require('../js/features/assets/model.js'); // v2 → v3 の移行が入っている
require('../js/features/inventory/model.js'); // v3 → v4 の移行が入っている
require('../js/features/sidejob/model.js');
require('../js/data/sample.js');

const { util: U, store, monthlyModel: M, sample } = globalThis.MT;

function freshMonthly() {
  const m = M.create();
  const a = M.addItem(m, 'cat_cash', '口座A');
  const b = M.addItem(m, 'cat_cash', '口座B');
  const c = M.addItem(m, 'cat_invest', '証券C');
  return { m, a, b, c };
}

test('金額の入力を解釈できる(式も可)', () => {
  assert.deepEqual(U.parseYen('1000+500'), { ok: true, value: 1500, isExpression: true });
  assert.equal(U.parseYen('1,980×3').value, 5940);
  assert.equal(U.parseYen('(1000+200)*2').value, 2400);
  assert.equal(U.parseYen('1980*1.1').value, 2178); // 小数は四捨五入
  assert.equal(U.parseYen('10/0').ok, false);
  assert.equal(U.parseYen('1000+').ok, false);
  assert.equal(U.parseYen('1,234,567').value, 1234567);
  assert.equal(U.parseYen('１２３４').value, 1234);
  assert.equal(U.parseYen('−5,000円').value, -5000);
  assert.equal(U.parseYen('▲300').value, -300);
  assert.ok(Object.is(U.parseYen('-0').value, 0));
  assert.equal(U.parseYen('  ').value, null);
  assert.equal(U.parseYen('12.5').ok, false);
  assert.equal(U.parseYen('abc').ok, false);
  assert.equal(U.parseYen('99999999999999').ok, false);
});

test('年月の計算', () => {
  assert.equal(U.ymAdd('2026-01', -1), '2025-12');
  assert.equal(U.ymAdd('2026-12', 1), '2027-01');
  assert.equal(U.ymAdd('2026-05', -17), '2024-12');
  assert.equal(U.lastDayOfYM('2028-02'), '2028-02-29');
  assert.equal(U.yenSigned(-1200), '−1,200');
  assert.equal(U.yenCompact(12345678), '1,234.6万');
});

test('新しい月は前月の値を「未確認」でコピーする', () => {
  const { m, a, b } = freshMonthly();
  M.setValue(m, '2026-08', a.id, 1000, '2026-08-31');
  M.setValue(m, '2026-08', b.id, 2000, '2026-08-31');
  const res = M.addMonth(m, '2026-09', { copy: true });
  assert.equal(res.copiedFrom, '2026-08');
  assert.equal(M.getValue(m, '2026-09', a.id), 1000);
  assert.equal(M.isCarried(m, '2026-09', a.id), true);
  assert.deepEqual(M.monthStatus(m, '2026-09'), { confirmed: 0, carried: 2, empty: 1, total: 3 });

  // 変わった所だけ直す
  M.setValue(m, '2026-09', a.id, 1500, '2026-10-01');
  assert.equal(M.isCarried(m, '2026-09', a.id), false);
  assert.equal(a.lastUpdated, '2026-10-01');
  assert.equal(M.monthTotal(m, '2026-09'), 3500);
  assert.equal(M.monthDiff(m, '2026-09').diff, 500);

  // 残りをまとめて確定
  assert.equal(M.confirmCarried(m, '2026-09', '2026-10-01'), 1);
  assert.equal(M.monthStatus(m, '2026-09').carried, 0);
});

test('過去の月を後から挿入でき、前の月が無ければ後の月からコピーする', () => {
  const { m, a } = freshMonthly();
  M.setValue(m, '2026-09', a.id, 5000, '2026-09-30');
  const res = M.addMonth(m, '2026-07', { copy: true });
  assert.equal(res.copiedFrom, '2026-09');
  assert.equal(M.getValue(m, '2026-07', a.id), 5000);
  assert.deepEqual(M.months(m), ['2026-07', '2026-09']);
  assert.equal(M.addMonth(m, '2026-07').created, false);
});

test('最新の月で未入力・未確認の項目に印がつく', () => {
  const { m, a, b, c } = freshMonthly();
  M.setValue(m, '2026-08', a.id, 1, '2026-08-31');
  M.setValue(m, '2026-08', b.id, 1, '2026-08-31');
  M.addMonth(m, '2026-09');
  M.setValue(m, '2026-09', a.id, 2, '2026-09-30');
  const stale = M.staleItemIds(m);
  assert.equal(stale.has(a.id), false);
  assert.equal(stale.has(b.id), true); // コピーのまま
  assert.equal(stale.has(c.id), true); // 未入力
});

test('区分ごとの小計と、項目・区分の並べ替え・移動・削除', () => {
  const { m, a, b, c } = freshMonthly();
  M.setValue(m, '2026-09', a.id, 100, '2026-09-30');
  M.setValue(m, '2026-09', b.id, 200, '2026-09-30');
  M.setValue(m, '2026-09', c.id, 400, '2026-09-30');
  assert.equal(M.categoryTotal(m, '2026-09', 'cat_cash'), 300);

  M.moveItem(m, b.id, -1);
  assert.deepEqual(M.groups(m)[0].items.map((x) => x.name), ['口座B', '口座A']);
  assert.equal(M.moveItem(m, b.id, -1), false); // 先頭より上には行かない

  M.changeItemCategory(m, a.id, 'cat_invest');
  assert.equal(M.categoryTotal(m, '2026-09', 'cat_invest'), 500);

  M.moveCategory(m, 'cat_deposit', -1);
  assert.deepEqual(m.categories.map((x) => x.id), ['cat_cash', 'cat_deposit', 'cat_invest']);

  M.deleteItem(m, c.id);
  assert.equal(m.records['2026-09'].values[c.id], undefined);
  M.deleteCategory(m, 'cat_invest');
  assert.equal(m.items.length, 1);
  assert.equal(M.monthTotal(m, '2026-09'), 200);
});

test('読み込み時に壊れた値を取り除き、知らない項目の金額は捨てる', () => {
  const raw = {
    app: 'money-tracker',
    schemaVersion: 1,
    meta: {},
    monthly: {
      categories: [{ id: 'c1', name: '現金' }],
      items: [
        { id: 'i1', categoryId: 'c1', name: 'A', lastUpdated: '2026-09-30' },
        { id: 'i2', categoryId: 'nope', name: 'B' },
      ],
      records: {
        '2026-09': { values: { i1: 100, i2: 1.5, ghost: 5 }, confirmed: { i1: '2026-09-30' }, memo: 'x' },
        'bad-key': { values: {} },
      },
    },
  };
  const res = store.prepare(raw);
  assert.equal(res.ok, true);
  const m = res.data.monthly;
  assert.deepEqual(Object.keys(m.records), ['2026-09']);
  assert.deepEqual(m.records['2026-09'].values, { i1: 100 });
  assert.equal(m.items.find((x) => x.id === 'i2').categoryId, 'cat_uncategorized');
});

test('他のアプリのデータや新しいバージョンのデータは読み込まない', () => {
  assert.equal(store.prepare({ foo: 1 }).ok, false);
  const newer = store.prepare({ app: 'money-tracker', schemaVersion: 999 });
  assert.equal(newer.ok, false);
  assert.equal(newer.newer, true);
});

test('サンプルは 6 か月分で、先月の記録は空けてある', () => {
  const now = new Date(2026, 10, 1); // 2026-11-01
  const d = sample.build(now);
  const res = store.prepare(d);
  assert.equal(res.ok, true);
  const m = res.data.monthly;
  assert.deepEqual(M.months(m), ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']);
  assert.equal(m.records['2026-10'], undefined);
  assert.ok(M.staleItemIds(m).size >= 1);
});

test('書き出したデータを読み込むと同じ内容に戻る', () => {
  store.load();
  store.replaceAll(sample.build(new Date(2026, 10, 1)), 'テスト');
  const json = store.exportJSON();
  const res = store.prepare(JSON.parse(json));
  assert.equal(res.ok, true);
  assert.deepEqual(res.data.monthly, store.get().monthly);
});

// ---- まとめ(証券会社など):見出しに小計、その下に内訳 ----

function groupedMonthly() {
  const m = M.create();
  const bank = M.addItem(m, 'cat_cash', '架空銀行');
  const jp = M.addItem(m, 'cat_invest', '証券A(国内株式)', { group: '証券A' });
  const solo = M.addItem(m, 'cat_invest', '証券B');
  const us = M.addItem(m, 'cat_invest', '証券A(米国株式)', { group: '証券A' });
  const fund = M.addItem(m, 'cat_invest', '証券A(投資信託)', { group: '証券A' });
  const ref = M.addItem(m, 'cat_invest', '証券A(含み益)', { reference: true });
  M.addMonth(m, '2026-10', { copy: false });
  const put = (it, v) => M.setValue(m, '2026-10', it.id, v, '2026-10-31');
  put(bank, 100);
  put(jp, 1000);
  put(solo, 50);
  put(us, 2000);
  put(fund, 3000);
  put(ref, 999);
  return { m, bank, jp, solo, us, fund, ref };
}

test('まとめ:同じまとめの項目は続けて並び、小計は内訳の合計(参考行は含めない)。総資産は変わらない', () => {
  const { m, jp, solo, us, fund } = groupedMonthly();
  const invest = M.groups(m).find((g) => g.category.id === 'cat_invest').items.filter((it) => !it.reference);
  assert.deepEqual(invest.map((it) => it.id), [jp.id, us.id, fund.id, solo.id]); // 後から足した内訳もまとめの所へ
  const bl = M.blocks(invest);
  assert.deepEqual(bl.map((b) => [b.group, b.items.length]), [['証券A', 3], ['', 1]]);
  assert.equal(M.groupTotal(m, '2026-10', 'cat_invest', '証券A'), 6000);
  assert.equal(M.categoryTotal(m, '2026-10', 'cat_invest'), 6050);
  assert.equal(M.monthTotal(m, '2026-10'), 6150);
  assert.deepEqual(M.groupNames(m, 'cat_invest'), ['証券A']);
  assert.deepEqual(M.groupNames(m, 'cat_cash'), []);
});

test('まとめ:内訳の短い名前は括弧の中(括弧の前がまとめの名前の一部でもよい)。当てはまらなければ名前のまま', () => {
  const it = (name, group) => ({ name, group });
  assert.equal(M.itemLabel(it('証券A(国内株式)', '証券A')), '国内株式');
  assert.equal(M.itemLabel(it('証券A（投資信託）', '証券A')), '投資信託');
  assert.equal(M.itemLabel(it('証券(預かり、ハイブリッド)', '証券A')), '預かり、ハイブリッド');
  assert.equal(M.itemLabel(it('証券A 特定口座', '証券A')), '特定口座');
  assert.equal(M.itemLabel(it('ポイント運用A', '証券A')), 'ポイント運用A');
  assert.equal(M.itemLabel(it('証券A(国内株式)', '')), '証券A(国内株式)');
});

test('まとめ:並べ替えは、まとめの中ならその中で、まとめに入っていない項目はまとめを飛び越え、まとめごとも動かせる', () => {
  const { m, jp, solo, us, fund } = groupedMonthly();
  const order = () => m.items.filter((it) => it.categoryId === 'cat_invest' && !it.reference).map((it) => it.id);
  assert.equal(M.moveItem(m, jp.id, -1), false); // まとめの先頭より上へは出ない
  assert.equal(M.moveItem(m, fund.id, 1), false); // まとめの最後より下へは出ない(参考行は別)
  assert.equal(M.moveItem(m, us.id, -1), true);
  assert.deepEqual(order(), [us.id, jp.id, fund.id, solo.id]);
  assert.equal(M.moveItem(m, solo.id, -1), true); // まとめ全体を飛び越える
  assert.deepEqual(order(), [solo.id, us.id, jp.id, fund.id]);
  assert.equal(M.moveGroup(m, 'cat_invest', '証券A', -1), true);
  assert.deepEqual(order(), [us.id, jp.id, fund.id, solo.id]);
  assert.equal(M.moveGroup(m, 'cat_invest', '証券A', -1), false);
  // ほかの区分の項目の位置は変わらない
  assert.equal(m.items[0].categoryId, 'cat_cash');
});

test('まとめ:入れる・外す・名前の変更(同じ名前なら 1 つに)・解く', () => {
  const { m, jp, solo, us, fund } = groupedMonthly();
  assert.equal(M.setGroup(m, solo.id, '証券A'), true);
  assert.equal(M.groupTotal(m, '2026-10', 'cat_invest', '証券A'), 6050);
  assert.deepEqual(M.blocks(m.items.filter((it) => it.categoryId === 'cat_invest' && !it.reference)).map((b) => b.items.length), [4]);
  assert.equal(M.setGroup(m, solo.id, ''), true);
  assert.equal(M.groupOf(M.findItem(m, solo.id)), '');
  assert.equal(M.setGroup(m, solo.id, '証券B'), true);
  assert.equal(M.renameGroup(m, 'cat_invest', '証券B', '証券A'), true); // 1 つにまとまる
  assert.deepEqual(M.groupNames(m, 'cat_invest'), ['証券A']);
  assert.equal(M.renameGroup(m, 'cat_invest', '証券A', ''), true); // 解く
  assert.deepEqual(M.groupNames(m, 'cat_invest'), []);
  for (const it of [jp, us, fund, solo]) assert.ok(M.findItem(m, it.id)); // 項目は残る
  assert.equal(M.monthTotal(m, '2026-10'), 6150);
});

test('まとめ:読み込み時に名前を整え、まとめが離れていたら続けて並べ直す。別の区分へ移すと移動先のまとめに並ぶ', () => {
  const raw = {
    categories: [{ id: 'cat_cash', name: '現金' }, { id: 'cat_invest', name: '投資' }],
    items: [
      { id: 'a', categoryId: 'cat_invest', name: '証券A(国内株式)', group: '  証券A ' },
      { id: 'b', categoryId: 'cat_invest', name: '証券B' },
      { id: 'c', categoryId: 'cat_invest', name: '証券A(米国株式)', group: '証券A' },
      { id: 'd', categoryId: 'cat_cash', name: '証券A(預かり)', group: '証券A' },
      { id: 'e', categoryId: 'cat_cash', name: '架空銀行', group: 123 },
    ],
    records: {},
  };
  const m = M.normalize(raw);
  assert.deepEqual(m.items.map((it) => [it.id, it.group]), [['a', '証券A'], ['c', '証券A'], ['b', ''], ['d', '証券A'], ['e', '']]);
  assert.equal(M.changeItemCategory(m, 'd', 'cat_invest'), true);
  assert.deepEqual(m.items.filter((it) => it.categoryId === 'cat_invest').map((it) => it.id), ['a', 'c', 'd', 'b']);
});

test('v13 のデータを開くと v14 になり、項目のまとめは空(まとめなし)になる', () => {
  store.load();
  store.replaceAll(sample.build(new Date(2026, 10, 1)), 'テスト');
  const v13 = JSON.parse(store.exportJSON());
  v13.schemaVersion = 13;
  for (const it of v13.monthly.items) delete it.group;
  const res = store.prepare(v13);
  assert.equal(res.ok, true);
  assert.equal(res.data.schemaVersion, store.SCHEMA_VERSION);
  assert.equal(store.SCHEMA_VERSION, 14);
  assert.ok(res.data.monthly.items.every((it) => it.group === ''));
});
