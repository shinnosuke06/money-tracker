// Excel の過去記録の取り込み(表の読み取り・月末記録・カード推移・元に戻す)と、
// 参考行・証券会社×種別の反映のテスト(画面は対象外)。使うのは架空のデータだけ。
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
require('../js/features/monthly/model.js');
require('../js/features/payments/model.js');
require('../js/features/assets/model.js');
require('../js/features/inventory/model.js');
require('../js/features/sidejob/model.js');
require('../js/features/imports/table.js');
require('../js/features/imports/model.js');
require('../js/data/sample.js');

const { store, monthlyModel: M, paymentsModel: P, assetsModel: A, importTable: T, importsModel: IM, sample } = globalThis.MT;
const NOW = new Date(2026, 10, 15); // 2026-11-15
const TODAY = '2026-11-15';

const tsv = (rows) => rows.map((r) => r.join('\t')).join('\n');
const clone = (x) => JSON.parse(JSON.stringify(x));

// 架空の口座資産の表(年は別の行・「#####」の見出し・合計の列・記号だけの列・項目名が空の行)
const MONTHLY_TABLE = tsv([
  ['', '口座', '2025年', '', '', '2026年', '', ''],
  ['', '', '11月', '12月', '#####', '2月', '3月', '年間合計'],
  ['●', '架空銀行A 普通', '100,000', '¥110,000', '120,000', '-', '', '330,000'],
  ['●', '架空信用金庫 定期', '50,000', '50,000', '50,000', '50,000', '', '200,000'],
  ['', '証券X 特定口座', '200,000', '(10,000)', '210,000', '220,000', '', '620,000'],
  ['', '', '', '', '', '', '', ''],
  ['', 'サークルの預かり金', '0', '△5,000', '1,234.6', '3,000', '', '0'],
  ['', '合計', '350,000', '145,000', '381,235', '273,000', '', ''],
  ['', '前月比', '-', '△205,000', '236,235', '△108,235', '', ''],
  ['', '評価損益', '12,000', '13,000', '14,000', '15,000', '', ''],
  ['', '含み益(参考)', '1,000', '2,000', '3,000', '4,000', '', ''],
]);

function freshData() {
  const d = store.createEmpty(NOW);
  return d;
}

// ---------------------------------------------------------------
// 表の読み取り
// ---------------------------------------------------------------

test('金額:カンマ・円記号は整数、「-」と空欄は未入力、0 は 0、マイナスの書き方 3 種', () => {
  const v = (s) => T.parseAmount(s);
  assert.deepEqual(v('1,234'), { ok: true, value: 1234 });
  assert.deepEqual(v('¥1,234'), { ok: true, value: 1234 });
  assert.deepEqual(v('￥１，２３４'), { ok: true, value: 1234 });
  assert.deepEqual(v('1,234円'), { ok: true, value: 1234 });
  assert.deepEqual(v('-'), { ok: true, value: null });
  assert.deepEqual(v(''), { ok: true, value: null });
  assert.deepEqual(v('  '), { ok: true, value: null });
  assert.deepEqual(v('0'), { ok: true, value: 0 });
  assert.deepEqual(v('-1,234'), { ok: true, value: -1234 });
  assert.deepEqual(v('△1,234'), { ok: true, value: -1234 });
  assert.deepEqual(v('▲500'), { ok: true, value: -500 });
  assert.deepEqual(v('(1,234)'), { ok: true, value: -1234 });
  assert.deepEqual(v('（1,234）'), { ok: true, value: -1234 });
  assert.deepEqual(v('¥-1,234'), { ok: true, value: -1234 });
  assert.deepEqual(v('1234.5'), { ok: true, value: 1235 }); // 小数は円に丸める
  assert.equal(v('#####').ok, false);
  assert.equal(v('12月').ok, false);
});

test('区切り:タブ区切りとカンマ区切り("…" で囲んだ値・改行の CRLF)を読む', () => {
  assert.deepEqual(T.parseDelimited('a\tb\r\nc\t"1,234"\n'), [['a', 'b'], ['c', '1,234']]);
  assert.deepEqual(T.parseDelimited('名前,金額\n架空銀行A,"1,234"\n"引用""あり",5\n\n'), [['名前', '金額'], ['架空銀行A', '1,234'], ['引用"あり', '5']]);
  assert.equal(T.detectDelimiter('a,b\nc,d'), ',');
  assert.equal(T.detectDelimiter('a\tb,c'), '\t');
});

test('文字コード:UTF-8(BOM つきも)と Shift_JIS を自動で見分ける', () => {
  const utf8 = new Uint8Array([0xef, 0xbb, 0xbf, ...Buffer.from('現金,1', 'utf8')]);
  assert.deepEqual(T.decodeBytes(utf8), { ok: true, text: '現金,1', encoding: 'utf-8' });
  // 「現金,1」の Shift_JIS(現 = 8C BB、金 = 8B E0)
  const sjis = new Uint8Array([0x8c, 0xbb, 0x8b, 0xe0, 0x2c, 0x31]);
  assert.deepEqual(T.decodeBytes(sjis), { ok: true, text: '現金,1', encoding: 'shift_jis' });
  assert.equal(T.decodeBytes(sjis, 'shift_jis').text, '現金,1');
});

test('表の解釈:記号だけの列と空の行を無視し、見出しの行・合計の列・空欄の列を見分ける', () => {
  const t = T.analyze(MONTHLY_TABLE);
  assert.equal(t.ok, true);
  assert.equal(t.nameCol, 1); // 1 列目の「●」の列は無視
  assert.deepEqual(t.ignoredCols, [0]);
  assert.equal(t.headerRows, 2);
  assert.deepEqual(t.columns.map((c) => c.header), ['2025年 11月', '12月', '#####', '2026年 2月', '3月', '年間合計']);
  assert.deepEqual(t.columns.map((c) => c.summary), [false, false, false, false, false, true]);
  assert.deepEqual(t.columns.map((c) => c.blank), [false, false, false, false, true, false]);
  assert.deepEqual(t.rows.map((r) => r.name), ['架空銀行A 普通', '架空信用金庫 定期', '証券X 特定口座', 'サークルの預かり金', '合計', '前月比', '評価損益', '含み益(参考)']);
  assert.deepEqual(t.rows[0].values, [100000, 110000, 120000, null, null, 330000]);
  assert.deepEqual(t.rows[2].values.slice(0, 2), [200000, -10000]);
  assert.deepEqual(t.rows[3].values.slice(0, 3), [0, -5000, 1235]);
  // 既定:合計の列と全部空欄の列はオフ。年月は合計の列(オフ)を数えない
  const on = T.defaultColumnsOn(t.columns);
  assert.deepEqual(on, [true, true, true, true, false, false]);
  assert.deepEqual(T.assignMonths(t.columns, '2025-11', on), ['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', null]);
  // 合計の列をオンにすると、月として数える
  assert.equal(T.assignMonths(t.columns, '2025-11', [true, true, true, true, false, true])[5], '2026-04');
  // 最初の月列の見出しに年と月があれば、それを初期値にする
  assert.equal(T.guessStartYM(t, NOW), '2025-11');
});

test('表の解釈:月だけの見出しは、金額のある最後の列が今月を超えない年にする', () => {
  const t = T.analyze(tsv([['', '10月', '11月', '12月'], ['架空銀行A', '1', '2', '']]));
  assert.equal(T.guessStartYM(t, NOW), '2026-10');
  const t2 = T.analyze(tsv([['', '12月', '1月'], ['架空銀行A', '1', '2']]));
  assert.equal(T.guessStartYM(t2, NOW), '2025-12');
  assert.equal(T.analyze('').ok, false);
  assert.equal(T.analyze(tsv([['架空銀行A', '12月']])).ok, false);
});

// ---------------------------------------------------------------
// A. 月末記録
// ---------------------------------------------------------------

test('月末記録:行の既定(取り込まない・参考行・区分)と、既存の項目名への対応', () => {
  const d = freshData();
  const existing = M.addItem(d.monthly, 'cat_cash', '架空銀行A　普通'); // 空白の違いは同じ名前として扱う
  const t = T.analyze(MONTHLY_TABLE);
  const ch = IM.monthlyDefaults(d, t, NOW);
  assert.equal(ch.startYM, '2025-11');
  const by = Object.fromEntries(t.rows.map((r, i) => [r.name, ch.rows[i]]));
  assert.equal(by['架空銀行A 普通'].target, existing.id);
  assert.equal(by['架空銀行A 普通'].status, 'import');
  assert.deepEqual([by['架空信用金庫 定期'].status, by['架空信用金庫 定期'].target, by['架空信用金庫 定期'].categoryId], ['import', 'new', 'cat_cash']);
  assert.equal(by['証券X 特定口座'].categoryId, 'cat_invest');
  assert.equal(by['サークルの預かり金'].categoryId, 'cat_deposit');
  assert.equal(by['合計'].status, 'skip');
  assert.equal(by['前月比'].status, 'skip');
  assert.equal(by['評価損益'].status, 'reference'); // 合計の行より下
  assert.equal(by['含み益(参考)'].status, 'reference');
  assert.equal(IM.categoryGuess('架空JA 普通貯金'), 'cash');
});

test('月末記録:プレビューで区分小計・総資産を計算し、元の表の合計行との差を出す', () => {
  const d = freshData();
  const t = T.analyze(MONTHLY_TABLE);
  const ch = IM.monthlyDefaults(d, t, NOW);
  const plan = IM.buildMonthlyPlan(d, t, ch);
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(plan.imported.map((c) => c.month), ['2025-11', '2025-12', '2026-01', '2026-02']);
  const [nov, dec, jan, feb] = plan.checks;
  assert.equal(nov.byCategory.get('cat_cash'), 150000);
  assert.equal(nov.byCategory.get('cat_invest'), 200000);
  assert.deepEqual([nov.total, nov.source, nov.diff], [350000, 350000, 0]);
  assert.deepEqual([dec.total, dec.diff], [145000, 0]);
  assert.deepEqual([jan.total, jan.diff], [381235, 0]);
  assert.equal(feb.total, 273000);
  assert.equal(nov.reference, 13000); // 評価損益 + 含み益(参考)
  assert.equal(plan.sourceName, '合計');
  // 元の表の合計とずれていれば、差を出す
  const t2 = T.analyze(MONTHLY_TABLE.replace('350,000', '351,000'));
  assert.equal(IM.buildMonthlyPlan(d, t2, IM.monthlyDefaults(d, t2, NOW)).checks[0].diff, -1000);
});

test('月末記録:同じ項目に 2 行を対応させると、取り込めない理由を出す', () => {
  const d = freshData();
  const it = M.addItem(d.monthly, 'cat_cash', '架空銀行A 普通');
  const t = T.analyze(MONTHLY_TABLE);
  const ch = IM.monthlyDefaults(d, t, NOW);
  ch.rows[1].target = it.id;
  const plan = IM.buildMonthlyPlan(d, t, ch);
  assert.equal(plan.errors.length, 1);
  assert.match(plan.errors[0], /架空銀行A 普通/);
  assert.equal(IM.applyMonthlyImport(d, t, ch, { today: TODAY, now: NOW }).ok, false);
});

test('月末記録:取り込むと項目と金額が入り、参考行は総資産に含めず、元に戻すと前の状態に戻る', () => {
  const d = freshData();
  const t = T.analyze(MONTHLY_TABLE);
  const ch = IM.monthlyDefaults(d, t, NOW);
  const before = clone(d);
  const res = IM.applyMonthlyImport(d, t, ch, { today: TODAY, now: NOW, source: 'file', fileName: '架空の表.csv' });
  assert.equal(res.ok, true);
  assert.equal(res.newItems, 6);
  assert.deepEqual(res.months, ['2025-11', '2025-12', '2026-01', '2026-02']);
  const m = d.monthly;
  const item = (name) => m.items.find((x) => x.name === name);
  assert.equal(M.getValue(m, '2025-12', item('架空銀行A 普通').id), 110000);
  assert.equal(M.getValue(m, '2026-02', item('架空銀行A 普通').id), null); // 「-」は未入力
  assert.equal(M.getValue(m, '2025-11', item('サークルの預かり金').id), 0);
  assert.equal(item('含み益(参考)').reference, true);
  assert.equal(item('評価損益').reference, true);
  assert.equal(m.items.some((x) => x.name === '合計' || x.name === '前月比'), false);
  // 総資産・区分小計は参考行を含めない(元の表の合計と一致)
  assert.equal(M.monthTotal(m, '2025-11'), 350000);
  assert.equal(M.monthTotal(m, '2026-01'), 381235);
  assert.equal(M.categoryTotal(m, '2025-11', 'cat_invest'), 200000);
  assert.deepEqual(M.referenceItems(m).map((x) => x.name), ['評価損益', '含み益(参考)']);
  assert.equal(M.seriesByItem(m, ['2025-11']).length, 4);
  // 取り込んだ日を確認日・最終更新日にする
  assert.equal(m.records['2025-11'].confirmed[item('架空銀行A 普通').id], TODAY);
  assert.equal(item('架空銀行A 普通').lastUpdated, TODAY);
  // 履歴
  assert.equal(d.imports.log.length, 1);
  assert.equal(d.imports.log[0].counts.cells, res.cells);
  assert.equal(d.imports.log[0].fileName, '架空の表.csv');
  assert.ok(IM.describe(d.imports.log[0]).startsWith('月末記録:2025年11月〜2026年2月'), IM.describe(d.imports.log[0]));
  // 保存して読み直しても形が変わらない
  assert.equal(store.prepare(clone(d)).ok, true);
  // 元に戻す
  const u = IM.undoLast(d);
  assert.equal(u.ok, true);
  assert.deepEqual(d.monthly, before.monthly);
  assert.equal(d.imports.undo, null);
  assert.equal(d.imports.log[0].undone, true);
  assert.equal(IM.undoLast(d).ok, false);
});

test('月末記録:すでに値がある月は、上書き / スキップ / 空欄だけ補うを月ごとに選べる', () => {
  const d = freshData();
  const m = d.monthly;
  const bank = M.addItem(m, 'cat_cash', '架空銀行A 普通');
  const shin = M.addItem(m, 'cat_cash', '架空信用金庫 定期');
  M.addMonth(m, '2025-11', { copy: false });
  M.addMonth(m, '2025-12', { copy: false });
  M.addMonth(m, '2026-01', { copy: false });
  for (const ym of ['2025-11', '2025-12', '2026-01']) M.setValue(m, ym, bank.id, 1, '2026-01-31');
  bank.lastUpdated = '2026-01-31';
  const before = clone(d);
  const t = T.analyze(MONTHLY_TABLE);
  const ch = IM.monthlyDefaults(d, t, NOW);
  const plan = IM.buildMonthlyPlan(d, t, ch);
  assert.deepEqual(plan.conflicts.map((c) => c.month), ['2025-11', '2025-12', '2026-01']);
  ch.modes = { '2025-11': 'overwrite', '2025-12': 'skip' }; // 2026-01 は既定(空欄だけ補う)
  const w = IM.countMonthlyWrites(d, plan, ch.modes);
  const res = IM.applyMonthlyImport(d, t, ch, { today: TODAY, now: NOW });
  assert.equal(res.cells, w.cells);
  assert.equal(M.getValue(m, '2025-11', bank.id), 100000); // 上書き
  assert.equal(M.getValue(m, '2025-12', bank.id), 1); // スキップ
  assert.equal(M.getValue(m, '2025-12', shin.id), null);
  assert.equal(M.getValue(m, '2026-01', bank.id), 1); // 空欄だけ補う:今の値を残す
  assert.equal(M.getValue(m, '2026-01', shin.id), 50000); // 空欄だった所は入る
  assert.equal(M.getValue(m, '2026-02', bank.id), null);
  IM.undoLast(d);
  assert.deepEqual(d.monthly, before.monthly);
});

test('月末記録:既存の項目を参考行として取り込むと印が付き、元に戻すと外れる', () => {
  const d = freshData();
  const gain = M.addItem(d.monthly, 'cat_invest', '含み益(参考)');
  const t = T.analyze(MONTHLY_TABLE);
  const ch = IM.monthlyDefaults(d, t, NOW);
  const plan = IM.buildMonthlyPlan(d, t, ch);
  assert.equal(plan.rows.find((r) => r.name === '含み益(参考)').flagChange, true);
  IM.applyMonthlyImport(d, t, ch, { today: TODAY, now: NOW });
  assert.equal(gain.reference, true);
  IM.undoLast(d);
  assert.equal(M.findItem(d.monthly, gain.id).reference, false);
});

// ---------------------------------------------------------------
// B. カード推移
// ---------------------------------------------------------------

const CARD_TABLE = tsv([
  ['カード', '2025年', '', '2026年'],
  ['', '11月', '12月', '1月'],
  ['カードA', '52,300', '48,900', '61,200'],
  ['カードB', '12,400', '-', '15,600'],
  ['カードC', '0', '3,200', '(1,000)'],
  ['架空銀行A 合計', '64,700', '48,900', '76,800'],
  ['架空銀行B 合計', '0', '3,200', '-1,000'],
  ['総合計', '64,700', '52,100', '75,800'],
  ['前月比', '-', '△12,600', '23,700'],
  ['月平均', '64,700', '58,400', '64,200'],
]);

test('カード推移:合計などの行は取り込まず、口座別の合計行は参照用に出し、元の表の総合計と比べる', () => {
  const d = freshData();
  const t = T.analyze(CARD_TABLE);
  const ch = IM.cardDefaults(d, t, NOW);
  assert.deepEqual(ch.rows.map((r) => r.status), ['import', 'import', 'import', 'skip', 'skip', 'skip', 'skip', 'skip']);
  assert.ok(ch.rows.every((r) => r.category === 'variable'));
  const plan = IM.buildCardPlan(d, t, ch);
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.sourceName, '総合計');
  assert.deepEqual(plan.refRows.map((r) => r.name), ['架空銀行A 合計', '架空銀行B 合計']);
  assert.deepEqual(plan.checks.map((c) => [c.month, c.total, c.diff]), [['2025-11', 64700, 0], ['2025-12', 52100, 0], ['2026-01', 75800, 0]]);
  assert.deepEqual(plan.checks[1].refs, [{ name: '架空銀行A 合計', value: 48900 }, { name: '架空銀行B 合計', value: 3200 }]);
});

test('カード推移:履歴が無い月は「収入:未入力・月末残高:現金の小計」で作り、ある月は選んだ扱いで直す。元に戻せる', () => {
  const d = freshData();
  const m = d.monthly;
  const bank = M.addItem(m, 'cat_cash', '架空銀行A');
  const sec = M.addItem(m, 'cat_invest', '架空証券');
  M.setValue(m, '2025-11', bank.id, 300000, '2025-11-30');
  M.setValue(m, '2025-11', sec.id, 999999, '2025-11-30'); // 投資は月末残高に入れない
  const p = d.payments;
  p.history.push(P.cleanHistory({
    month: '2026-01',
    income: 250000,
    payment: 100000,
    balance: 400000,
    catTotals: { loan: 60000, variable: 40000 },
    details: [{ name: '架空ローン', amount: 60000, category: 'loan' }, { name: 'カードA', amount: 40000, category: 'variable' }],
    incomeDetails: [{ name: '給与', amount: 250000 }],
  }));
  const before = clone(d);
  const t = T.analyze(CARD_TABLE);
  const ch = IM.cardDefaults(d, t, NOW);
  ch.rows[2].category = 'fixed'; // カードC は固定費
  const plan = IM.buildCardPlan(d, t, ch);
  assert.deepEqual(plan.conflicts.map((c) => c.month), ['2026-01']);
  ch.modes['2026-01'] = 'overwrite';
  const res = IM.applyCardImport(d, t, ch, { now: NOW });
  assert.equal(res.ok, true);
  const nov = p.history.find((x) => x.month === '2025-11');
  assert.equal(nov.income, null);
  assert.equal(nov.balance, 300000);
  assert.deepEqual(nov.details, [
    { name: 'カードA', amount: 52300, category: 'variable' },
    { name: 'カードB', amount: 12400, category: 'variable' },
    { name: 'カードC', amount: 0, category: 'fixed' },
  ]);
  assert.equal(nov.payment, 64700);
  assert.equal(nov.catTotals.variable, 64700);
  const dec = p.history.find((x) => x.month === '2025-12');
  assert.equal(dec.balance, null); // 月末記録が無い月
  assert.equal(dec.details.length, 2); // カードB は「-」
  // 既存の月(上書き):同じ名前の明細を置き換え、ほかの明細(ローン)と収入は残す
  const jan = p.history.find((x) => x.month === '2026-01');
  assert.equal(jan.income, 250000);
  assert.deepEqual(jan.details.map((x) => [x.name, x.amount]), [['架空ローン', 60000], ['カードA', 61200], ['カードB', 15600], ['カードC', -1000]]);
  assert.equal(jan.catTotals.loan, 60000);
  assert.equal(jan.catTotals.variable, 61200 + 15600);
  assert.equal(jan.catTotals.fixed, -1000);
  assert.equal(jan.payment, 60000 + 61200 + 15600 - 1000);
  assert.deepEqual(p.history.map((x) => x.month), ['2025-11', '2025-12', '2026-01']);
  // 保存して読み直せる(収入の未入力は null のまま)
  const again = store.prepare(clone(d));
  assert.equal(again.ok, true);
  assert.equal(again.data.payments.history[0].income, null);
  // 元に戻す
  IM.undoLast(d);
  assert.deepEqual(d.payments.history, before.payments.history);
});

test('カード推移:空欄だけ補うでは、すでにある明細を残して、無い明細だけ足す', () => {
  const d = freshData();
  d.payments.history.push(P.cleanHistory({ month: '2026-01', income: 1, payment: 40000, catTotals: { variable: 40000 }, details: [{ name: 'カードA', amount: 40000, category: 'variable' }] }));
  const t = T.analyze(CARD_TABLE);
  const ch = IM.cardDefaults(d, t, NOW);
  ch.cols = ch.cols.map((c, j) => ({ on: j === 2 })); // 2026年1月の列だけ
  const plan = IM.buildCardPlan(d, t, ch);
  assert.equal(IM.countCardWrites(d, plan, ch.modes).cells, 2);
  IM.applyCardImport(d, t, ch, { now: NOW });
  const jan = d.payments.history[0];
  assert.deepEqual(jan.details.map((x) => [x.name, x.amount]), [['カードA', 40000], ['カードB', 15600], ['カードC', -1000]]);
  assert.equal(jan.payment, 40000 + 15600 - 1000);
});

// ---------------------------------------------------------------
// データの版・反映
// ---------------------------------------------------------------

test('v4 のデータを開くと v5 になり、項目に参考行の印(false)と、空の取り込み履歴が足される', () => {
  const v4 = store.createEmpty(NOW);
  M.addItem(v4.monthly, 'cat_cash', '架空銀行');
  M.setValue(v4.monthly, '2026-10', v4.monthly.items[0].id, 5000, '2026-10-31');
  delete v4.monthly.items[0].reference;
  delete v4.imports;
  v4.payments.history.push({ month: '2026-09', income: 1000, payment: 500, balance: 0, catTotals: {}, details: [], incomeDetails: [] });
  v4.schemaVersion = 4;
  const res = store.prepare(clone(v4));
  assert.equal(res.ok, true);
  assert.equal(res.migrated, true);
  assert.equal(res.data.schemaVersion, store.SCHEMA_VERSION);
  assert.equal(res.data.monthly.items[0].reference, false);
  assert.equal(M.monthTotal(res.data.monthly, '2026-10'), 5000);
  assert.deepEqual(res.data.imports, { log: [], undo: null });
  assert.equal(res.data.payments.history[0].income, 1000);
});

test('項目を参考行にすると、小計・総資産・入力状況から外れる(表には残る)', () => {
  const d = freshData();
  const m = d.monthly;
  const a = M.addItem(m, 'cat_invest', '架空証券');
  const g = M.addItem(m, 'cat_invest', '含み益');
  M.setValue(m, '2026-10', a.id, 1000, '2026-10-31');
  M.setValue(m, '2026-10', g.id, 300, '2026-10-31');
  assert.equal(M.monthTotal(m, '2026-10'), 1300);
  M.setReference(m, g.id, true);
  assert.equal(M.monthTotal(m, '2026-10'), 1000);
  assert.equal(M.categoryTotal(m, '2026-10', 'cat_invest'), 1000);
  assert.equal(M.monthStatus(m, '2026-10').total, 1);
  assert.deepEqual(M.displayItems(m).map((x) => x.name), ['架空証券', '含み益']);
  assert.equal(M.nextItemId(m, a.id), g.id);
});

test('資産の反映:証券会社×種別(国内株 / 米国株 / 投資信託)ごとの合計も反映先に選べる', () => {
  const d = freshData();
  const a = d.assets;
  const jpA = M.addItem(d.monthly, 'cat_invest', '証券A 国内株');
  const fundA = M.addItem(d.monthly, 'cat_invest', '証券A 投資信託');
  A.saveHolding(a, { broker: '証券A', account: 'tokutei', type: 'jp', code: 'X101', name: '銘柄X', quantity: 10, avgPrice: 100, price: 120 });
  A.saveHolding(a, { broker: '証券A', account: 'nisa_new', type: 'jp', code: 'X102', name: '銘柄Y', quantity: 5, avgPrice: 100, price: 200 });
  A.saveHolding(a, { broker: '証券A', account: 'nisa_new', type: 'fund', code: 'XFUND001', name: 'ファンドM', quantity: 2, avgPrice: 10000, price: 15000 });
  A.saveHolding(a, { broker: '証券B', account: 'tokutei', type: 'us', code: 'XUS', name: '米国銘柄P', quantity: 1, avgPrice: 15000, priceUsd: 100 });
  a.fx.rate = 150;
  a.settings.reflect = { groupBy: 'brokerType', map: { [A.brokerTypeKey('証券A', 'jp')]: jpA.id, [A.brokerTypeKey('証券A', 'fund')]: fundA.id }, manualMap: {} };
  const g = A.reflectGroups(a).groups;
  assert.deepEqual(g.map((x) => [x.label, x.value]), [['証券A・国内株', 2200], ['証券A・投資信託', 30000], ['証券B・米国株', 15000]]);
  const plan = A.reflectPlan(d, '2026-11');
  assert.deepEqual(plan.rows.map((r) => [r.name, r.to]), [['証券A 国内株', 2200], ['証券A 投資信託', 30000]]);
  assert.deepEqual(plan.unmapped, ['証券B・米国株']);
  // 保存して読み直しても、まとめ方と対応は残る
  const again = store.prepare(clone(d)).data;
  assert.equal(again.assets.settings.reflect.groupBy, 'brokerType');
  assert.equal(again.assets.settings.reflect.map['証券A|fund'], fundA.id);
});

test('サンプル:v5 の形で、取り込みの履歴は空', () => {
  const d = store.prepare(sample.build(NOW)).data;
  assert.equal(d.schemaVersion, store.SCHEMA_VERSION);
  assert.deepEqual(d.imports, { log: [], undo: null });
  assert.ok(d.monthly.items.every((x) => x.reference === false));
});
