// 新しい版の確認(js/core/update.js)と、index.html の ?v= のテスト。
// 実行方法: node --test(リポジトリのいちばん上で)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
require('../js/core/util.js');
require('../js/core/store.js');
require('../js/features/future/model.js'); // v7 → v8 の移行
require('../js/core/update.js');

const { store, update } = globalThis.MT;
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('store.js の中身から APP_VERSION を取り出す', () => {
  assert.equal(update.parseVersion(read('js/core/store.js')), store.APP_VERSION);
  assert.equal(update.parseVersion("const APP_VERSION = '2000.01.01-1';"), '2000.01.01-1');
  assert.equal(update.parseVersion('<html>見つかりません</html>'), null);
  assert.equal(update.parseVersion(null), null);
});

test('公開中の版が読めて、いまの版と違うときだけ知らせる', () => {
  assert.equal(update.isUpdate('2000.01.02-1', '2000.01.01-1'), true);
  assert.equal(update.isUpdate('2000.01.01-1', '2000.01.01-1'), false);
  assert.equal(update.isUpdate(null, '2000.01.01-1'), false);
  assert.equal(update.isUpdate('2000.01.01-1', undefined), false);
});

test('index.html のスクリプトとスタイルに、いまの版の ?v= が付いている', () => {
  const html = read('index.html');
  const urls = [...html.matchAll(/<script src="([^"]+)"|<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1] || m[2]);
  const local = urls.filter((u) => !/^https?:/.test(u));
  assert.ok(local.length > 30);
  for (const u of local) {
    assert.equal(u.split('?v=')[1], store.APP_VERSION, u);
    assert.ok(fs.existsSync(path.join(__dirname, '..', u.split('?')[0])), u);
  }
  assert.ok(local.some((u) => u.startsWith('js/core/update.js')));
});
