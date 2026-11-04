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

// ---- サービスワーカー(sw.js) ----

const vm = require('node:vm');
function loadSw() {
  const ctx = { self: { addEventListener() {}, location: { origin: 'https://example.invalid' } }, URL, console };
  vm.createContext(ctx);
  vm.runInContext(read('sw.js'), ctx);
  return ctx;
}

test('sw.js の VERSION は APP_VERSION と同じ(版を上げると、ホーム画面のアプリも入れ替わる)', () => {
  const m = /const VERSION = '([^']+)'/.exec(read('sw.js'));
  assert.ok(m);
  assert.equal(m[1], store.APP_VERSION);
});

test('sw.js は index.html のスクリプトとスタイルをすべてキャッシュに入れる(外の CDN は入れない)', () => {
  const sw = loadSw();
  const files = sw.filesIn(read('index.html'));
  const html = read('index.html');
  const local = [...html.matchAll(/<script src="([^"]+)"|<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1] || m[2]).filter((u) => !/^https?:/.test(u));
  for (const u of local) assert.ok(files.includes(u), u);
  assert.ok(files.every((u) => !/^https?:|^\/\//.test(u)));
  // manifest・アイコンも
  assert.ok(files.includes('manifest.webmanifest'));
  const STATIC = vm.runInContext('STATIC', sw);
  for (const f of STATIC.filter((x) => x !== './')) assert.ok(fs.existsSync(path.join(__dirname, '..', f)), f);
});

test('manifest:相対パス・standalone・アイコン(maskable を含む)がそろっている', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.equal(m.start_url, './');
  assert.equal(m.scope, './');
  assert.equal(m.display, 'standalone');
  assert.ok(m.name && m.short_name && m.theme_color && m.background_color);
  for (const ic of m.icons) {
    assert.ok(!ic.src.startsWith('/'), ic.src);
    assert.ok(fs.existsSync(path.join(__dirname, '..', ic.src)), ic.src);
  }
  assert.ok(m.icons.some((ic) => ic.purpose === 'maskable'));
  // index.html から読むファイルも、すべて相対パス
  const html = read('index.html');
  assert.equal(/(?:src|href)="\//.test(html), false);
});
