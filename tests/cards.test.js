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

// 架空の明細:お店と金額の行が先で、その下に日付(26.10.01 の形)と支払い方法が来る形。
// 読み取りの崩れ(日本語のあいだの空白・金額の後ろの記号の読み違い・「1.080」)と、行のあき(空行)をまねる
const LATE_A = [
  '22:29 忘 過信',
  '',
  'く 利用 明細',
  '',
  'Q 日 付 、 金 額 、 店 名 な ど 三',
  '',
  'テスト 花子 様 ご 利用 分 (架空 カード / クレ',
  'ジッ ト )',
  '',
  '架空 ネット サー ビス 株式 会 1,234 円 ン',
  '社',
  '26.09.30 1 回 払い',
  '',
  'コン ビニ X 駅 前 店 512 円 て',
  '26.10.01 1 回 払い',
  '',
  'コン ビニ X 駅 前 店 1.080 円 ソ',
  '26.10.02 ] 回 払い',
  '',
  '架空 電話 ご 利用 料金 1 0 月 4,321 円 ン',
  '分',
  '26.10.03 1 回 払い',
  '',
  '架空 カフェ 中央 店 ZNFC 980 円 て', // 下で切れて、日付が写っていない
].join('\n');
const LATE_B = [
  'く 利用 明細',
  '',
  'ピン ノン ブン プン | ビン シン て', // 上で切れた行
  '26.10.02 1 回 払い',
  '',
  '架空 電話 ご 利用 料金 1 0 月 4,321 円 ン',
  '分',
  '26.10.03 1 回 払い',
  '',
  '架空 カフェ 中央 店 ZNFC 980 円 て',
  '26.10.05 1 回 払い',
  '',
  '架空 カフェ 中央 店 ノ NFC 980 円 ン', // 同じ日の同じ金額(本当の二重請求かもしれない)
  '26.10.05 1 回 払い',
  '',
  'く テスト 花子 様 お 支払 9,107 円',
  'い 金 額 小 計 >',
].join('\n');

test('お店と金額の行の下に日付(26.10.01 の形)が来る明細:行のあきでまとめて読む。上下で切れた行・小計は除く', () => {
  const a = C.parseText(LATE_A, { payMonth: '2026-11' });
  assert.deepEqual(a.map((r) => `${r.date}|${r.merchant}|${r.amount}`), [
    '2026-09-30|架空ネットサービス株式会社|1234',
    '2026-10-01|コンビニ X 駅前店|512',
    '2026-10-02|コンビニ X 駅前店|1080',
    '2026-10-03|架空電話ご利用料金 1 0 月分|4321',
  ]);
  const b = C.parseText(LATE_B, { payMonth: '2026-11' });
  assert.deepEqual(b.map((r) => `${r.date}|${r.amount}`), ['2026-10-03|4321', '2026-10-05|980', '2026-10-05|980']);
  // 2 枚をつなぐ:重なった行は 1 つ、同じ日の 2 回は残す。合計は明細の小計と同じ
  const joined = C.joinPages([a, b]);
  assert.deepEqual(joined.map((r) => r.amount), [1234, 512, 1080, 4321, 980, 980]);
  assert.equal(joined.reduce((t, r) => t + r.amount, 0), 9107);
  assert.equal(C.findTotal(LATE_B), 9107);
  assert.equal(C.findTotal(LATE_A), null);
});

test('スクリーンショットの行の位置から、あきの大きいところに空行を入れる(横に並んだ行は 1 行にする)', () => {
  const L = (text, y0, y1, x0 = 60) => ({ text, bbox: { x0, y0, x1: x0 + 400, y1 } });
  const text = C.layoutText([
    L('架空ストア 長い 名前 の', 960, 1004),
    L('1,234 円', 962, 1002, 900), // 金額が別の行として読まれた(同じ高さ)
    L('お 店', 1022, 1067),
    L('26.09.30 1 回 払い', 1104, 1137),
    L('コン ビニ X 512 円', 1225, 1270),
    L('26.10.01 1 回 払い', 1290, 1323),
  ]);
  assert.equal(text, ['架空ストア 長い 名前 の 1,234 円', 'お 店', '26.09.30 1 回 払い', '', 'コン ビニ X 512 円', '26.10.01 1 回 払い'].join('\n'));
  const rows = C.parseText(text, { payMonth: '2026-11' });
  assert.deepEqual(rows.map((r) => `${r.date}|${r.merchant}|${r.amount}`), ['2026-09-30|架空ストア長い名前のお店|1234', '2026-10-01|コンビニ X|512']);
  assert.equal(C.layoutText([]), '');
});

test('日付が後に来る明細を貼り付けた文字(空行なし)も読む。先頭の見出しはお店の名前に入れない', () => {
  const text = ['利用明細', 'クレジット デビット ポイント払い', '日付、金額、店名など', 'テスト花子 様 ご利用分', '架空ストアA', '1,200円', '26.10.01', '1回払い', '架空ストアB 長い名前の', 'お店', '300円', '26.10.02', '1回払い'].join('\n');
  const rows = C.parseText(text, { payMonth: '2026-11' });
  assert.deepEqual(rows.map((r) => `${r.date}|${r.merchant}|${r.amount}`), ['2026-10-01|架空ストアA|1200', '2026-10-02|架空ストアB 長い名前のお店|300']);
});

test('日付の形:26.10.01(年が 2 けた)・2026/10/01 を読み、「10月9,558円」のような金額は日付にしない', () => {
  assert.equal(C.parseText('26.10.01 架空ストア 500円', { payMonth: '2026-11' })[0].date, '2026-10-01');
  assert.equal(C.parseText('2026/10/01 架空ストア 500円', { payMonth: '2026-11' })[0].date, '2026-10-01');
  assert.deepEqual(C.parseText('10/03\n架空電話 10月9,558円', { payMonth: '2026-11' }).map((r) => `${r.date}|${r.amount}`), ['2026-10-03|9558']);
  // 全角の英数字・支払い方法の文字はそろえる
  assert.equal(C.parseText('10/05 ＡＢＣ　ＳＴＯＲＥ／ＮＦＣ 1,000円 1回払い', { payMonth: '2026-11' })[0].merchant, 'ABC STORE/NFC');
});

// カード会社ごとに違う明細の形(どれも架空の明細を読み取ったときの崩れをまねる)
const FORMS = {
  // 日付・お店・金額がそれぞれ別の行(日付に曜日、「10 月 3 日」と空白が入る、¥ が \ と読まれる)
  stack: ['10 月 3 日 ( 土 )', 'コン ビニ A 駅 前 店', '\\648', '', '10 月 5 日 (月 )', '動画 配信 サー ビス C', '\\1,490', '', 'ご 請求 金額 \\2,138'].join('\n'),
  // 表の形:金額に「円」が無い。本人・支払い区分の列がある。日付の「/」が「7」や「/7」と読まれる
  table: [
    '2026 年 11 月 27 日 お 支払 い 分',
    '利用 日 利用 店 名 利用 者 支払 区 分 利用 金額',
    '2026/710703 コン ビニ A 駅 前 店 本 人 1 回 払い 648',
    '2026710705 動画 配信 サー ビス C 本 人 1 回 払い 1,490',
    '2026/10/712 ガソリン スタ ンド D 家 族 1 回 払い 1.958',
    '合計 4.096',
  ].join('\n'),
  // お店が上、その下に日付と金額(桁区切りが「,.」と読まれる)
  below: ['コン ビニ A 駅 前 店', '2026/10/703 648 円', '', 'ドラ ッ グ スト ア E', '2026/10/18 1,.958 円'].join('\n'),
  // 1 行の形で、日付に曜日がつく(「/」が「7」と読まれた日付も)
  weekday: ['10703( 土 ) コン ビニ A 駅 前 店 \\648', '', '10/05( 月 ) _ 動画 配信 サー ビス C \\1,490'].join('\n'),
};

test('カード会社ごとに違う形:日付・お店・金額が別の行、表(円なし)、お店が上、曜日つき を読む', () => {
  const read = (t) => C.parseText(t, { payMonth: '2026-11' }).map((r) => `${r.date}|${r.merchant}|${r.amount}`);
  assert.deepEqual(read(FORMS.stack), ['2026-10-03|コンビニ A 駅前店|648', '2026-10-05|動画配信サービス C|1490']);
  assert.deepEqual(read(FORMS.table), ['2026-10-03|コンビニ A 駅前店|648', '2026-10-05|動画配信サービス C|1490', '2026-10-12|ガソリンスタンド D|1958']);
  assert.deepEqual(read(FORMS.below), ['2026-10-03|コンビニ A 駅前店|648', '2026-10-18|ドラッグストア E|1958']);
  assert.deepEqual(read(FORMS.weekday), ['2026-10-03|コンビニ A 駅前店|648', '2026-10-05|動画配信サービス C|1490']);
  // 明細の合計(¥ のもの、「円」が無いもの、「,.」と読まれたもの)
  assert.equal(C.findTotal(FORMS.stack), 2138);
  assert.equal(C.findTotal(FORMS.table), 4096);
  assert.equal(C.findTotal('合計 30.,190 円'), 30190);
  // 店の番号のような数字は日付にしない
  assert.equal(C.parseText('7110 STORE 500円', { payMonth: '2026-11' }).length, 0);
});

test('明細の合計を見つける(合計・小計・ご請求金額。金額が次の行や前の行にあっても)', () => {
  assert.equal(C.findTotal(TEXT), 35624);
  assert.equal(C.findTotal('合計\n12,345円'), 12345);
  assert.equal(C.findTotal('10/03 架空ストア 500円\nご利用可能額 100,000円'), null);
  assert.equal(C.findTotal(''), null);
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
