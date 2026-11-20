// カードを使った記録と、カードの明細の確認(js/features/payments/cards-model.js)のテスト。架空のデータだけを使う。
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
require('../js/features/payments/cards-model.js');
require('../js/features/payments/model.js');
require('../js/features/assets/ir-model.js');
require('../js/features/assets/model.js');
require('../js/features/inventory/model.js');
require('../js/features/sidejob/model.js');

const { store, paymentsModel: P, cardCheck: C } = globalThis.MT;
const NOW = new Date(2026, 10, 20, 12, 0);

function fixture() {
  const d = store.createEmpty(NOW);
  const p = d.payments;
  p.month = '2026-11';
  P.saveBill(p, { id: 'cardA', name: '架空カードA', amount: 35624, dueDay: 27, category: 'variable' });
  P.saveBill(p, { id: 'cardB', name: '架空カードB', amount: 0, dueDay: 10, category: 'variable' });
  P.saveBill(p, { id: 'rent', name: '家賃', amount: 50000, dueDay: 27, category: 'fixed' });
  return p;
}

// 架空の明細(1 行にまとまった形と、日付・お店・金額が別の行の形をまぜる)
const TEXT = [
  '2026年11月お支払い分',
  'ご請求金額 35,624円',
  '10/03 コンビニA 駅前店 648円',
  '10/05 スーパーB 中央店 4,280円',
  '10/08',
  '動画配信サービスC',
  '1,490円',
  '10/10 保険料 架空生命 8,200円',
  '10/12 ガソリンスタンドD 6,100円',
  '10/15 スマホ料金 架空モバイル 5,480円',
  '10/18 ドラッグストアE 1,958円',
  '10/21 XYZ*ONLINE SHOP (USD 12.99) 2,034円',
  '10/21 XYZ*ONLINE SHOP (USD 12.99) 2,034円',
  '10/24 ABC PAYMENT 100円',
  '10/27 レストランF 3,300円',
  '合計 35,624円',
].join('\n');

test('カード:選んだ支払いがカード。選んでいなければ、名前に「カード」が入った支払い。いつものカードを最初に選ぶ', () => {
  const p = fixture();
  assert.deepEqual(C.cards(p).map((b) => b.id), ['cardA', 'cardB']);
  assert.equal(C.defaultCard(p), 'cardA');
  C.setCards(p, ['cardB', 'rent', 'nope'], 'cardB');
  assert.deepEqual(C.cards(p).map((b) => b.id), ['cardB', 'rent']);
  assert.equal(C.defaultCard(p), 'cardB');
  assert.equal(p.cardCheck.places[0], 'コンビニ');
  C.setPlaces(p, [' 本屋 ', 'コンビニ', '', 'コンビニ']);
  assert.deepEqual(p.cardCheck.places, ['本屋', 'コンビニ']);
});

test('記録:カード・日付・金額を確かめて足す。直す・消す', () => {
  const p = fixture();
  assert.equal(C.addRecord(p, { cardId: 'rent', date: '2026-10-03', place: 'x', amount: 1 }, NOW).ok, false); // カードではない
  assert.equal(C.addRecord(p, { cardId: 'cardA', date: 'x', place: 'x', amount: 1 }, NOW).ok, false);
  assert.equal(C.addRecord(p, { cardId: 'cardA', date: '2026-10-03', place: 'x', amount: 0 }, NOW).ok, false);
  const r = C.addRecord(p, { cardId: 'cardA', date: '2026-10-03', place: 'コンビニ', amount: 648 }, NOW);
  assert.equal(r.ok, true);
  assert.equal(C.updateRecord(p, r.record.id, { amount: 650, place: 'スーパー' }), true);
  assert.equal(p.cardCheck.records[0].amount, 650);
  assert.equal(C.removeRecord(p, r.record.id), true);
  assert.equal(p.cardCheck.records.length, 0);
});

test('明細の文字:1 行の形・別の行の形を読み、合計やご請求の行は飛ばす。年の無い日付はお支払いの月までの年', () => {
  const rows = C.parseText(TEXT, { payMonth: '2026-11' });
  assert.equal(rows.length, 11);
  assert.deepEqual(rows[2], { date: '2026-10-08', merchant: '動画配信サービスC', amount: 1490 });
  assert.equal(rows[7].merchant, 'XYZ*ONLINE SHOP (USD 12.99)');
  assert.equal(rows.reduce((t, r) => t + r.amount, 0), 35624);
  // 1 月払いの明細の 12 月の利用は、前の年
  assert.equal(C.parseText('12/28 架空ストア 1,000円', { payMonth: '2027-01' })[0].date, '2026-12-28');
  // 返金(マイナス・▲)も読む
  assert.equal(C.parseText('10/30 架空ストア ▲1,000円', { payMonth: '2026-11' })[0].amount, -1000);
});

test('明細の文字:スクリーンショットの読み取りの崩れを直す(日本語の空白・\\ の円・「.」の桁区切り・「/」の読み違い)', () => {
  const ocr = [
    'ご 利用 日 ・ ご 利用 先 ・ ご 利用 金額',
    '2026 年 10 月 3 日', 'コン ビニ A 駅 前 店 \\648',
    '2026 年 10 月 18 日', 'ドラ ッ グ スト アビ E \\1.958',
    '10703_ スー パーB 中 央 店 4.280 円',
    '104712_ ガソリン スタ ンド D 6,100 円',
  ].join('\n');
  const rows = C.parseText(ocr, { payMonth: '2026-11' });
  assert.deepEqual(rows.map((r) => `${r.date}|${r.merchant}|${r.amount}`), ['2026-10-03|コンビニ A 駅前店|648', '2026-10-18|ドラッグストアビ E|1958', '2026-10-03|スーパーB 中央店|4280', '2026-10-12|ガソリンスタンド D|6100']);
});

test('何枚かのスクリーンショット:前の 1 枚と重なって写った行は除く(本当の二重請求は残す)', () => {
  const a = [
    { date: '2026-10-03', merchant: 'コンビニA', amount: 648 },
    { date: '2026-10-05', merchant: 'スーパーB', amount: 4280 },
    { date: '2026-10-08', merchant: '動画配信C', amount: 1490 },
  ];
  const b = [
    { date: '2026-10-05', merchant: 'スーパ-B', amount: 4280 },
    { date: '2026-10-08', merchant: '動画配信C', amount: 1490 },
    { date: '2026-10-10', merchant: '保険料', amount: 8200 },
    { date: '2026-10-10', merchant: '保険料', amount: 8200 },
  ];
  const joined = C.joinPages([a, b]);
  assert.deepEqual(joined.map((r) => r.amount), [648, 4280, 1490, 8200, 8200]);
  // 前の 1 枚で 1 行読み落としていても重なりとみなし、読み落とした行は次の 1 枚から残す
  const a2 = [a[0], a[2]];
  assert.deepEqual(C.joinPages([a2, b]).map((r) => r.amount), [648, 4280, 1490, 8200, 8200]);
  // 重ならない 2 枚は、そのままつなぐ
  assert.deepEqual(C.joinPages([[a[0]], [b[3]]]).map((r) => r.amount), [648, 8200]);
});

test('突き合わせ:記録と一致・毎月の支払い・確かめてほしいもの(理由つき)。確かめたら残りが減る', () => {
  const p = fixture();
  for (const [date, place, amount] of [['2026-10-03', 'コンビニ', 648], ['2026-10-04', 'スーパー', 4280], ['2026-10-12', 'ガソリン', 6100], ['2026-10-18', 'ドラッグストア', 1958], ['2026-10-30', '飲食店', 3300], ['2026-11-02', 'コンビニ', 500]]) {
    C.addRecord(p, { cardId: 'cardA', date, place, amount }, NOW);
  }
  // 先月の明細で、毎月の支払いを覚えておく
  const prev = C.saveStatement(p, { cardId: 'cardA', month: '2026-10', rows: [
    { date: '2026-09-08', merchant: '動画配信サービスC', amount: 1490 },
    { date: '2026-09-10', merchant: '保険料 架空生命', amount: 8200 },
    { date: '2026-09-15', merchant: 'スマホ料金 架空モバイル', amount: 4980 },
  ] }, NOW).statement;
  for (const r of prev.rows) C.setRowStatus(p, prev.id, r.id, 'ok', { monthly: true });
  assert.equal(p.cardCheck.known.length, 3);
  assert.equal(C.pending(p).length, 0);

  const st = C.saveStatement(p, { cardId: 'cardA', month: '2026-11', rows: C.parseText(TEXT, { payMonth: '2026-11' }) }, NOW).statement;
  const rows = C.judgeCard(p, 'cardA').get(st.id);
  const by = (m) => rows.find((r) => r.merchant.startsWith(m));
  assert.equal(by('コンビニA').kind, 'record');
  assert.equal(by('スーパーB').kind, 'record'); // 日付が 1 日ずれても
  assert.equal(by('レストランF').kind, 'record'); // 3 日ずれても
  assert.equal(by('動画配信').kind, 'known');
  assert.equal(by('保険料').kind, 'known');
  const phone = by('スマホ料金');
  assert.equal(phone.kind, 'check');
  assert.equal(phone.reasons[0].id, 'changed'); // 4,980 → 5,480
  const shop = rows.filter((r) => r.merchant.startsWith('XYZ'));
  assert.deepEqual(shop[0].reasons.map((x) => x.id), ['norecord', 'foreign', 'double', 'first']);
  assert.deepEqual(by('ABC').reasons.map((x) => x.id), ['norecord', 'small', 'first']);
  assert.equal(C.pending(p).length, 4);
  // 記録したけれど明細にまだ無いもの
  assert.deepEqual(C.unmatchedRecords(p, 'cardA').map((r) => r.amount), [500]);
  // 合計と請求額
  assert.deepEqual(C.totals(p, st), { total: 35624, billAmount: 35624, diff: 0 });
  // 問題なし(毎月の支払いとして覚える)→ 次の月から同じ金額なら確かめなくてよい
  C.setRowStatus(p, st.id, phone.id, 'ok', { monthly: true });
  assert.equal(p.cardCheck.known.find((k) => k.merchant.startsWith('スマホ')).amount, 5480);
  C.setRowStatus(p, st.id, shop[0].id, 'ng', { memo: '心当たりがない' });
  assert.equal(C.pending(p).length, 2);
  // 入れ直しても、確かめた印は同じ行に残る
  C.saveStatement(p, { cardId: 'cardA', month: '2026-11', rows: C.parseText(TEXT, { payMonth: '2026-11' }) }, NOW);
  assert.equal(p.cardCheck.statements.filter((s) => s.month === '2026-11').length, 1);
  assert.equal(C.pending(p).length, 2);
  // 返金(マイナス)は確かめなくてよい
  const st2 = C.saveStatement(p, { cardId: 'cardB', month: '2026-11', rows: [{ date: '2026-10-30', merchant: '架空ストア', amount: -1000 }] }, NOW).statement;
  assert.equal(C.judgeCard(p, 'cardB').get(st2.id)[0].kind, 'known');
});

test('名前が少し違っても(読み違い)同じお店とみなす', () => {
  assert.ok(C.similar('保険料 架空生命', '保険料如空生命') >= 0.5);
  assert.ok(C.similar('動画配信サービスC', '動画配信サ-ビスC') >= 0.5);
  assert.ok(C.similar('コンビニA', 'スーパーB') < 0.5);
});

test('読み込み時にそろえる。v15 のデータを開いても支払いはそのまま', () => {
  const n = C.normalize({ records: [{ cardId: 'a', date: '2026-10-03', amount: 1 }, { cardId: 'a', date: 'bad', amount: 1 }], statements: [{ cardId: 'a', month: '2026-11', rows: [{ date: '2026-10-03', merchant: 'x', amount: 1, status: 'weird' }, { date: 'bad' }] }], places: ['a', 'a', ''], known: [{ cardId: 'a', merchant: '', amount: 1 }] });
  assert.equal(n.records.length, 1);
  assert.equal(n.statements[0].rows.length, 1);
  assert.equal(n.statements[0].rows[0].status, null);
  assert.deepEqual(n.places, ['a']);
  assert.equal(n.known.length, 0);

  const v15 = store.createEmpty(NOW);
  v15.schemaVersion = 15;
  v15.payments.bills = [{ id: 'cardA', name: '架空カードA', amount: 1000, dueDay: 27, category: 'variable' }];
  delete v15.payments.cardCheck;
  const res = store.prepare(JSON.parse(JSON.stringify(v15)));
  assert.equal(res.ok, true);
  assert.equal(res.data.schemaVersion, store.SCHEMA_VERSION);
  assert.equal(res.data.payments.bills[0].amount, 1000);
  assert.deepEqual(res.data.payments.cardCheck.records, []);
  assert.equal(res.data.payments.cardCheck.places.length, C.DEFAULT_PLACES.length);
});
