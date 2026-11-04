// 月末チェック(js/features/monthend/model.js)のテスト。使うのは架空のデータだけ。
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
require('../js/features/future/model.js');
require('../js/features/monthly/model.js');
require('../js/features/payments/model.js');
require('../js/features/assets/model.js');
require('../js/features/inventory/model.js');
require('../js/features/sidejob/model.js');
require('../js/data/sample.js');
require('../js/features/monthend/model.js');

const { store, monthEndModel: ME, monthlyModel: MM, sample, util: U } = globalThis.MT;
const NOW = new Date(2026, 10, 15); // 2026-11-15

test('何日前か:日付と日時のどちらでも、端末の日付で数える', () => {
  assert.equal(ME.daysSince('2026-11-15', NOW), 0);
  assert.equal(ME.daysSince('2026-11-05', NOW), 10);
  assert.equal(ME.daysSince('2026-10-15T23:00:00', NOW), 31);
  assert.equal(ME.daysSince(null, NOW), null);
});

test('バックアップ:まだ・30 日以上前は案内を出す', () => {
  assert.deepEqual(ME.backupInfo(NOW, null), { at: null, days: null, stale: true });
  assert.equal(ME.backupInfo(NOW, '2026-10-17T10:00:00').stale, false); // 29 日前
  assert.equal(ME.backupInfo(NOW, '2026-10-16T10:00:00').stale, true); // 30 日前
});

test('月末チェックの項目:順番と、前月の記録が無いときは「未入力」', () => {
  const d = sample.build(NOW); // サンプルは 2 か月前までの記録
  const list = ME.items(d, NOW, null);
  assert.deepEqual(list.map((x) => x.id), ['monthly', 'payments', 'assets', 'inventory', 'sidejob', 'backup']);
  const m = list[0];
  assert.equal(m.state, 'alert');
  assert.ok(m.detail.includes('2026年10月末'));
  assert.equal(list[5].state, 'alert');
  // 前月の記録を作って全部確認すると OK
  const prev = '2026-10';
  d.monthly.records[prev] = { values: {}, confirmed: {}, memo: '' };
  for (const it of d.monthly.items) {
    d.monthly.records[prev].values[it.id] = 1000;
    d.monthly.records[prev].confirmed[it.id] = '2026-10-31';
  }
  assert.equal(ME.items(d, NOW, null)[0].state, 'ok');
  // 1 つだけ未確認
  delete d.monthly.records[prev].confirmed[d.monthly.items[0].id];
  const st = MM.monthStatus(d.monthly, prev);
  assert.equal(ME.items(d, NOW, null)[0].state, st.carried + st.empty ? 'warn' : 'ok');
});

test('副業:先月までの未確認の入金を数える。在庫・資産は相場・価格の日付が古いと要確認', () => {
  const d = sample.build(NOW);
  const unconfirmed = d.sidejob.records.filter((r) => r.date < '2026-11-01' && !r.confirmed).length;
  const sj = ME.items(d, NOW, null).find((x) => x.id === 'sidejob');
  assert.equal(sj.state, unconfirmed ? 'warn' : 'ok');
  for (const it of d.inventory.items) it.prices = it.prices.map((p) => ({ ...p, date: '2026-01-01' }));
  assert.equal(ME.items(d, NOW, null).find((x) => x.id === 'inventory').state, 'warn');
  d.assets.lastUpdateAt = null;
  assert.equal(ME.items(d, NOW, null).find((x) => x.id === 'assets').state, 'warn');
});

test('対象がないものは「対象なし」。空のデータでは起動時の案内を出さない', () => {
  const d = store.createEmpty(NOW);
  const list = ME.items(d, NOW, null);
  assert.ok(list.filter((x) => x.id !== 'backup').every((x) => x.state === 'none'));
  assert.deepEqual(ME.promptReasons(d, NOW, null), []);
});

test('起動時の案内:前月の月末記録が未入力、バックアップが古いと、その理由を出す', () => {
  const d = sample.build(NOW);
  const r = ME.promptReasons(d, NOW, null);
  assert.equal(r.length, 2);
  assert.ok(r[0].includes('記録がまだありません'));
  assert.ok(r[1].includes('バックアップ'));
  // 最近バックアップしていれば、月末記録の分だけ
  assert.equal(ME.promptReasons(d, NOW, '2026-11-10T09:00:00').length, 1);
});

test('「確認した」の印は今月の分だけ(月が変わると消える)', () => {
  ME.setDone('monthly', true, NOW);
  ME.setDone('payments', true, NOW);
  assert.deepEqual(ME.doneMap(NOW), { monthly: true, payments: true });
  ME.setDone('payments', false, NOW);
  assert.deepEqual(ME.doneMap(NOW), { monthly: true });
  assert.deepEqual(ME.doneMap(new Date(2026, 11, 1)), {});
  assert.equal(U.prefs.get('monthEndDone', null).ym, '2026-11');
});
