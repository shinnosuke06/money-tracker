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
require('../js/features/monthly/model.js');
require('../js/data/sample.js');

const { util: U, store, monthlyModel: M, sample } = globalThis.MT;

function freshMonthly() {
  const m = M.create();
  const a = M.addItem(m, 'cat_cash', '口座A');
  const b = M.addItem(m, 'cat_cash', '口座B');
  const c = M.addItem(m, 'cat_invest', '証券C');
  return { m, a, b, c };
}

test('金額の入力を解釈できる', () => {
  assert.deepEqual(U.parseYen('1,234,567'), { ok: true, value: 1234567 });
  assert.deepEqual(U.parseYen('１２３４'), { ok: true, value: 1234 });
  assert.deepEqual(U.parseYen('−5,000円'), { ok: true, value: -5000 });
  assert.deepEqual(U.parseYen('▲300'), { ok: true, value: -300 });
  assert.deepEqual(U.parseYen('-0'), { ok: true, value: 0 });
  assert.deepEqual(U.parseYen('  '), { ok: true, value: null });
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
