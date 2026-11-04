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
require('../js/features/future/model.js'); // v7 → v8 の移行
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

// 旧・支払い管理アプリのテキスト形式(架空のデータ)
const b64 = (obj) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');
const DETAIL_JUN = { loan: [{ id: 'd1', name: '架空ローン', amount: 20000 }], fixed: [{ id: 'd2', name: '架空の会費', amount: 500 }], variable: [{ id: 'd3', name: 'カードA', amount: 50000 }], investment: [{ id: 'd4', name: '積立投資', amount: 30000 }] };
const INCOME_JUN = [{ id: 'i1', name: '給与', amount: 250000 }, { id: 'i2', name: '売上', amount: 8000 }];
const SECTION_TEXT = [
  '---支払い管理バックアップ---',
  '',
  '【手元現金】',
  '1001,財布,30000,0,0,0,駐輪場、日用品',
  '',
  '【口座】',
  '1002,架空銀行A 本店,120000,0,0,',
  '1003,架空信用金庫,50000,5000,0,給与口座',
  '',
  '【入金】',
  '2001,給与,250000,1,0,架空銀行A 本店に入金',
  '2002,臨時収入,0,0,1,どこかに入金',
  '2003,売上,12000,0,0,',
  '',
  '【支払い】',
  '3001,カードA,80000,26,1002,variable,0,,',
  '>3101,積立投資,30000,investment,,',
  '3002,ローンB,20000,27,1003,loan,1,メモ,あり,2030-12',
  '>3201,内訳C,5000,loan,2028-03,残り回数,24',
  '3003,家賃など,70000,,1002,fixed,0,,',
  '',
  '【特別支出】',
  '4001,固定資産税,30000,2026-12,0,年4回',
  '4002,お祝い,20000,2026-07,1,',
  '',
  '【メモ】',
  '1行目のメモ',
  '',
  '2行目のメモ',
  '',
  '【履歴】',
  `2026-06,26年6月,100500,90000,20000,500,50000,30000,${b64(DETAIL_JUN)},258000,${b64(INCOME_JUN)}`,
  `2026-07,26年7月,99999,95000,20000,500,50000,30000,${b64(DETAIL_JUN)},250000,${b64(INCOME_JUN.slice(0, 1))}`,
].join('\n');

test('支払い管理のテキスト形式:見出しごとの行を読み、内訳・メモ・履歴の明細(base64)まで変換する', () => {
  const u = LB.unwrap(SECTION_TEXT);
  assert.equal(u.ok, true);
  assert.equal(LB.identify(u.obj), 'payments');
  const r = PL.parse(SECTION_TEXT); // JSON でなくても読める
  assert.equal(r.ok, true);
  const { data, report } = PL.convert(r.obj, globalThis.MT.store.createEmpty(new Date(2026, 7, 15)));
  const p = data.payments;
  const item = (name) => data.monthly.items.find((x) => x.name === name);
  assert.deepEqual(
    [report.counts.banks, report.counts.wallets, report.counts.bills, report.counts.subItems, report.counts.incomes, report.counts.specials, report.counts.history],
    [2, 1, 3, 2, 3, 2, 2]
  );
  assert.deepEqual(report.issues, []);
  // 口座・手元現金
  assert.equal(globalThis.MT.paymentsModel.findAccount(p, item('架空銀行A 本店').id).balance, 120000);
  assert.equal(globalThis.MT.paymentsModel.findAccount(p, item('財布').id).kind, 'cash');
  assert.ok(report.notes.some((t) => t.includes('口座「架空信用金庫」') && t.includes('4番目の値「5000」')));
  assert.match(p.memo, /駐輪場、日用品/);
  // 入金:毎月固定・済・メモ「◯◯に入金」→ 優先振込先
  const inc = (name) => p.incomes.find((x) => x.name === name);
  assert.deepEqual([inc('給与').fixed, inc('給与').done, inc('給与').targetId], [true, false, item('架空銀行A 本店').id]);
  assert.deepEqual([inc('臨時収入').fixed, inc('臨時収入').done, inc('臨時収入').targetId], [false, true, null]);
  assert.ok(report.notes.some((t) => t.includes('入金 1件は')));
  // 支払い:内訳(「>」の行)、メモのカンマ、終了月、口座、引き落とし日なし
  const bill = (name) => p.bills.find((x) => x.name === name);
  assert.equal(bill('カードA').subItems[0].name, '積立投資');
  assert.equal(bill('カードA').subItems[0].category, 'investment');
  assert.equal(bill('カードA').accountId, item('架空銀行A 本店').id);
  assert.deepEqual([bill('ローンB').memo, bill('ローンB').endMonth, bill('ローンB').done, bill('ローンB').category], ['メモ,あり', '2030-12', true, 'loan']);
  assert.deepEqual([bill('ローンB').subItems[0].endMonth, bill('ローンB').subItems[0].memo], ['2028-03', '残り回数,24']);
  assert.deepEqual([bill('家賃など').dueDay, bill('家賃など').category], [null, 'fixed']);
  // 特別支出
  assert.deepEqual(p.specials.map((x) => [x.name, x.month, x.done]), [['固定資産税', '2026-12', false], ['お祝い', '2026-07', true]]);
  // メモ(空行も残す)
  assert.match(p.memo, /1行目のメモ\n\n2行目のメモ/);
  // 履歴:明細はカテゴリごと、入金の明細、月末残高。合計が合わない月はお知らせ
  const jun = p.history.find((h) => h.month === '2026-06');
  assert.deepEqual([jun.income, jun.payment, jun.balance], [258000, 100500, 90000]);
  assert.deepEqual(jun.catTotals, { loan: 20000, fixed: 500, variable: 50000, investment: 30000, special: 0 });
  assert.deepEqual(jun.details.map((x) => [x.name, x.category]), [['架空ローン', 'loan'], ['架空の会費', 'fixed'], ['カードA', 'variable'], ['積立投資', 'investment']]);
  assert.deepEqual(jun.incomeDetails, [{ name: '給与', amount: 250000 }, { name: '売上', amount: 8000 }]);
  assert.ok(report.notes.some((t) => t.includes('履歴「2026-07」') && t.includes('合いません')));
  assert.ok(!report.notes.some((t) => t.includes('履歴「2026-06」')));
  assert.equal(globalThis.MT.store.prepare(data).ok, true);
});

test('支払い管理のテキスト形式:読めない行は報告し、ほかの行は読み込む', () => {
  const text = ['【口座】', '1002,架空銀行A,1000,0,0,', 'こわれた行', '【支払い】', '>9,上の支払いが無い内訳,1,fixed,,', '【履歴】', '2026-06,26年6月,1,2,0,0,1,0,読めない,5,読めない'].join('\n');
  assert.equal(PL.isSectionText(text), true);
  const { data, report } = PL.convert(PL.parse(text).obj, globalThis.MT.store.createEmpty());
  assert.equal(data.payments.accounts.length, 1);
  assert.ok(report.issues.some((t) => t.includes('3行目') && t.includes('欄が足りない')));
  assert.ok(report.issues.some((t) => t.includes('内訳の上に支払いが無い')));
  assert.ok(report.issues.some((t) => t.includes('支払いの明細を読み取れなかった')));
  assert.equal(data.payments.history[0].payment, 1);
});
