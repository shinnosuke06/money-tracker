// 旧アプリのバックアップの読み方(LZ: / base64 / JSON)と、どのアプリのものかの見分けのテスト。
// 使うのは架空のデータだけ。実行方法: node --test(リポジトリのいちばん上で)
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
require('../js/features/payments/legacy.js');
require('../js/features/assets/model.js');
require('../js/features/inventory/model.js');
require('../js/features/sidejob/model.js');
require('../js/features/sidejob/legacy.js');
require('../js/features/settings/legacy-backup.js');

const { legacyBackup: LB, paymentsLegacy: PL } = globalThis.MT;

const POKECA = { lotteries: [{ id: 'l1', productName: '商品A', purchasePrice: 5000 }], inventory: { 商品A: { quantity: 1, purchasePrice: 5000, history: [], sales: [] } }, settings: {} };
const PAYMENTS = { accounts: [{ id: 1, name: '架空銀行A', amount: '1000' }], payments: [], incomes: [] };
const ASSETS = { holdings: [{ broker: '証券A', accountType: '特定', type: 'JP', code: 'X101', name: '銘柄X', quantity: 1, avgPrice: 100 }], history: [] };
const SIDEJOB = [['依頼元A', 1, 'x', '依頼元B', 1, 'y'], [[261102, 0, 1, 1, 1]]];

// 偽の LZ-String(本物は CDN から読む)。「LZ:」の後ろを base64 の JSON として戻す
const fakeLz = { decompressFromBase64: (s) => Buffer.from(s, 'base64').toString('utf8') || null };
const lzText = (obj) => 'LZ:' + Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');

test('読み方:「LZ:」・base64(encodeURIComponent)・そのままの JSON・JSON の文字列を読む', () => {
  assert.equal(LB.needsLz(lzText(POKECA)), true);
  assert.equal(LB.needsLz('{"a":1}'), false);
  assert.deepEqual(LB.unwrap(lzText(POKECA), fakeLz).obj, POKECA);
  assert.equal(LB.unwrap(lzText(POKECA), null).ok, false); // 部品が無ければ止める
  assert.deepEqual(LB.unwrap(btoa(encodeURIComponent(JSON.stringify(PAYMENTS)))).obj, PAYMENTS);
  assert.deepEqual(LB.unwrap(JSON.stringify(ASSETS)).obj, ASSETS);
  assert.deepEqual(LB.unwrap(JSON.stringify(JSON.stringify(SIDEJOB))).obj, SIDEJOB);
  assert.equal(LB.unwrap('').ok, false);
  assert.equal(LB.unwrap('読めない文字').ok, false);
});

test('見分け:ポケカ・支払い・資産・副業・このアプリの書き出しファイル', () => {
  assert.equal(LB.identify(POKECA), 'inventory');
  assert.equal(LB.identify({ lotteries: [] }), 'inventory');
  assert.equal(LB.identify(PAYMENTS), 'payments');
  assert.equal(LB.identify(ASSETS), 'assets'); // history があっても holdings があれば資産
  assert.equal(LB.identify(SIDEJOB), 'sidejob');
  assert.equal(LB.identify({ jobs: [], settings: {} }), 'sidejob');
  assert.equal(LB.identify({ app: 'money-tracker', schemaVersion: 5 }), 'app');
  assert.equal(LB.identify({ foo: 1 }), null);
  assert.equal(LB.identify(null), null);
});

test('間違えたボタンで読んだときは、読むべきボタンを案内する(支払い管理にポケカのバックアップ)', () => {
  const u = LB.unwrap(lzText(POKECA), fakeLz);
  const kind = LB.identify(u.obj);
  const msg = LB.wrongKindMessage(kind, 'payments');
  assert.match(msg, /旧・ポケカ管理アプリのバックアップのようです/);
  assert.match(msg, /「旧・ポケカ管理アプリのバックアップを読み込む」/);
  assert.match(LB.wrongKindMessage('app', 'inventory'), /「JSON ファイルを読み込む」/);
  // 「LZ:」の支払い管理のバックアップも、戻してから今までどおり変換できる
  const p = LB.unwrap(lzText(PAYMENTS), fakeLz);
  assert.equal(LB.identify(p.obj), 'payments');
  assert.equal(PL.parse(JSON.stringify(p.obj)).ok, true);
});
