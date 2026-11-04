// 副業収入の計算・旧データ変換のテスト(画面は対象外)。使うのは架空のデータだけ。
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
require('../js/features/future/model.js'); // v7 → v8 の移行
require('../js/features/monthly/model.js');
require('../js/features/payments/model.js');
require('../js/features/assets/model.js');
require('../js/features/inventory/model.js');
require('../js/features/sidejob/model.js');
require('../js/features/sidejob/legacy.js');
require('../js/data/sample.js');

const { util: U, store, paymentsModel: P, sidejobModel: S, sidejobLegacy: L, sample } = globalThis.MT;
const NOW = new Date(2026, 10, 15);
const TODAY = '2026-11-15';

function fixture() {
  const d = store.createEmpty(NOW);
  const sj = d.sidejob;
  S.saveClient(sj, {
    id: 'A',
    name: '依頼元A',
    baseAmount: 8000,
    tasks: [
      { id: 't1', name: '作業項目X', amount: 2000, isDefault: true },
      { id: 't2', name: '作業項目Y', amount: 1500, isDefault: false },
      { id: 't3', name: '作業項目Z', amount: 3000, isDefault: true },
    ],
    weekdays: [1, 3, 5], // 月水金
  });
  S.saveClient(sj, { id: 'B', name: '依頼元B', baseAmount: 10000, tasks: [{ id: 'p', name: '作業項目P', amount: 2500, isDefault: true }], weekdays: [6] });
  return { d, sj, A: S.findClient(sj, 'A'), B: S.findClient(sj, 'B') };
}

test('万円の表示は小数 1 桁、計算は円の整数(0.1万の足し算でも誤差が出ない)', () => {
  assert.equal(U.man(12345), '1.2万');
  let sum = 0;
  for (let i = 0; i < 3; i++) sum += 1000; // 0.1万 × 3
  assert.equal(sum, 3000);
  assert.equal(U.man(sum), '0.3万');
  assert.equal(L.manToYen('1.1'), 11000);
  assert.equal(L.manToYen(0.1), 1000);
  assert.equal(L.manToYen('2.35'), 23500);
  assert.equal(L.manToYen('1.23456'), 12346);
  assert.equal(L.manToYen('abc'), null);
});

test('新しい記録:基本額と既定の作業項目を最初から選び、合計と内容の文章を自動で作る', () => {
  const { sj, A } = fixture();
  const draft = S.newDraft(A, '2026-11-02');
  assert.equal(draft.base, 8000);
  assert.deepEqual(draft.items.map((x) => x.name), ['作業項目X', '作業項目Z']);
  draft.items.push({ name: '作業項目Y', amount: 1800 }); // 項目を足して金額も変える
  draft.memo = 'メモ';
  const rid = S.saveRecord(sj, draft);
  const r = sj.records.find((x) => x.id === rid);
  assert.equal(S.recordTotal(r), 8000 + 2000 + 3000 + 1800);
  assert.equal(r.content, '作業項目X0.2、作業項目Z0.3、作業項目Y0.18'); // 項目名 + 万円の数
  assert.equal(r.memo, 'メモ');
  assert.equal(r.confirmed, false);
});

test('月の一覧:依頼元別の合計と総合計、入金確認、まとめて確認済み', () => {
  const { sj, A, B } = fixture();
  S.saveRecord(sj, { ...S.newDraft(A, '2026-11-02'), confirmed: true });
  S.saveRecord(sj, S.newDraft(A, '2026-11-04'));
  S.saveRecord(sj, S.newDraft(B, '2026-11-07'));
  S.saveRecord(sj, S.newDraft(A, '2026-10-30')); // 別の月
  const s = S.monthSummary(sj, '2026-11');
  assert.equal(s.total, 13000 * 2 + 12500);
  assert.equal(s.byClient.get('A'), 26000);
  assert.equal(s.confirmed, 13000);
  assert.deepEqual(S.monthRecords(sj, '2026-11', 'A').map((r) => r.date), ['2026-11-02', '2026-11-04']);
  assert.equal(S.confirmMonth(sj, '2026-11', 'A'), 1);
  assert.equal(S.monthSummary(sj, '2026-11', 'A').unconfirmed, 0);
  assert.equal(S.monthSummary(sj, '2026-11', 'B').unconfirmed, 12500); // ほかの依頼元はそのまま
  const r = S.monthRecords(sj, '2026-11', 'B')[0];
  assert.equal(S.toggleConfirmed(sj, r.id), true);
});

test('予定:曜日パターンから作り、休む日を外し、出る日を足せる', () => {
  const { sj, A } = fixture();
  const dates = S.plannedDates(sj, '2026-11', A);
  assert.equal(dates.length, 13); // 2026年11月の月・水・金(2,4,6,…,30)
  assert.equal(S.dayState(sj, '2026-11', A, '2026-11-02'), 'planned');
  S.toggleDay(sj, '2026-11', 'A', '2026-11-02'); // 休む
  assert.equal(S.dayState(sj, '2026-11', A, '2026-11-02'), 'off');
  S.toggleDay(sj, '2026-11', 'A', '2026-11-03'); // 火曜に追加で出る
  assert.equal(S.dayState(sj, '2026-11', A, '2026-11-03'), 'extra');
  const after = S.plannedDates(sj, '2026-11', A);
  assert.ok(!after.includes('2026-11-02') && after.includes('2026-11-03'));
  S.toggleDay(sj, '2026-11', 'A', '2026-11-02');
  S.toggleDay(sj, '2026-11', 'A', '2026-11-03');
  assert.deepEqual(sj.schedule, {}); // 元に戻すと消える
});

test('予想額:確認済み / 予定(未確認の記録 + 今日以降の予定日)/ 合計', () => {
  const { sj, A } = fixture();
  S.saveRecord(sj, { ...S.newDraft(A, '2026-11-02'), confirmed: true });
  S.saveRecord(sj, S.newDraft(A, '2026-11-16')); // 今日以降の予定日だが記録あり(未確認)
  const f = S.forecast(sj, '2026-11', 'A', TODAY);
  // 11/16 以降の月水金:16,18,20,23,25,27,30 → 記録のある 16 を除く 6 日
  assert.equal(f.plannedDays, 6);
  assert.equal(f.confirmed, 13000);
  assert.equal(f.unconfirmed, 13000);
  assert.equal(f.planned, 6 * 13000);
  assert.equal(f.total, f.confirmed + f.scheduled);
  // 来月はすべての予定日
  const next = S.forecast(sj, '2026-12', 'A', TODAY);
  assert.equal(next.plannedDays, S.plannedDates(sj, '2026-12', A).length);
});

test('推移:月ごとの依頼元別の合計', () => {
  const { sj, A, B } = fixture();
  S.saveRecord(sj, S.newDraft(A, '2026-10-05'));
  S.saveRecord(sj, S.newDraft(B, '2026-11-07'));
  const t = S.trend(sj, ['2026-10', '2026-11']);
  assert.deepEqual(t.series.map((s) => s.values), [[13000, 0], [0, 12500]]);
});

test('依頼元は最大 5 件', () => {
  const { sj } = fixture();
  for (let i = 0; i < 3; i++) assert.ok(S.saveClient(sj, { name: `依頼元${i}` }));
  assert.equal(S.saveClient(sj, { name: '6件目' }), null);
  assert.equal(sj.clients.length, 5);
});

test('支払い管理への連携:翌月払いは前の月の予想額を、対応する入金予定に入れる', () => {
  const { d, sj, A, B } = fixture();
  d.payments.month = '2026-12';
  P.saveIncome(d.payments, { id: 'inc1', name: '副業の報酬', amount: 1, fixed: false });
  A.payment = { incomeId: 'inc1', timing: 'next', day: 25 };
  B.payment = { incomeId: 'inc1', timing: 'same', day: 10 };
  S.saveRecord(sj, { ...S.newDraft(A, '2026-11-02'), confirmed: true });
  const plan = S.paymentPlan(d, TODAY);
  assert.equal(plan.target, '2026-12');
  const row = plan.rows[0];
  assert.deepEqual(row.sources.map((x) => [x.clientId, x.workMonth]), [['A', '2026-11'], ['B', '2026-12']]);
  const expected = S.forecast(sj, '2026-11', 'A', TODAY).total + S.forecast(sj, '2026-12', 'B', TODAY).total;
  assert.equal(row.to, expected);
  assert.equal(row.from, 1);
  assert.equal(S.applyPaymentPlan(d, TODAY), 1);
  assert.equal(d.payments.incomes[0].amount, expected);
  // 入金予定を消すと、対応も外れる
  P.removeById(d.payments, 'incomes', 'inc1');
  S.finalize(d);
  assert.equal(A.payment.incomeId, null);
});

test('依頼元を消すと、その記録と予定も消える', () => {
  const { sj, A } = fixture();
  S.saveRecord(sj, S.newDraft(A, '2026-11-02'));
  S.toggleDay(sj, '2026-11', 'A', '2026-11-04');
  S.removeClient(sj, 'A');
  assert.equal(sj.records.length, 0);
  assert.deepEqual(sj.schedule, {});
});

const SETTINGS6 = ['依頼元A', 1.2, '作業項目X、作業項目Y', '依頼元B', '0.8', '作業項目P'];

test('旧アプリ①:[設定配列, 記録配列] を読み、万円を円の整数に直し、既定内容のコードを文章にする', () => {
  const legacy = [
    SETTINGS6,
    [
      [261102, 0, 1.2, 1, 1],
      ['261104', 1, '0.8', 0, 2],
      [261105, 0, 1.15, 1, '特別作業'],
      [269999, 0, 1, 0, ''],
      [261106, 7, 1, 0, ''],
    ],
  ];
  const parsed = L.parse(JSON.stringify(legacy));
  assert.equal(parsed.format, 'settingsFirst');
  const { data, report } = L.convert(parsed, store.createEmpty(NOW));
  const sj = data.sidejob;
  assert.deepEqual(sj.clients.map((c) => [c.name, c.baseAmount]), [['依頼元A', 12000], ['依頼元B', 8000]]);
  assert.deepEqual(
    sj.records.map((r) => [r.date, r.clientId, r.base, r.confirmed, r.content, r.items.length]),
    [
      ['2026-11-02', 'cli_A', 12000, true, '作業項目X、作業項目Y', 0],
      ['2026-11-04', 'cli_B', 8000, false, '作業項目P', 0],
      ['2026-11-05', 'cli_A', 11500, true, '特別作業', 0],
    ]
  );
  assert.equal(report.issues.length, 2); // 日付が読めない 1 件、依頼元が分からない 1 件
  assert.equal(store.prepare(data).ok, true);
});

test('旧アプリ②:[記録配列, 設定配列] を読む', () => {
  const legacy = [
    [
      ['r1', '2026-10-01', 'A', 1.1, 1, '作業A'],
      ['r2', '2026-10-02', 'B', 0.75, 0, ''],
      ['r3', '2026/10/03', 'C', 1, 0, ''],
    ],
    SETTINGS6,
  ];
  const parsed = L.parse(JSON.stringify(legacy));
  assert.equal(parsed.format, 'recordsFirst');
  const { data, report } = L.convert(parsed, store.createEmpty(NOW));
  assert.deepEqual(data.sidejob.records.map((r) => [r.id, r.base, r.confirmed]), [['rec_r1', 11000, true], ['rec_r2', 7500, false]]);
  assert.ok(report.issues.some((t) => t.includes('A か B か')));
});

test('旧アプリ③:{ jobs, settings } を読む(done は確認済み、plan は未確認)', () => {
  const legacy = {
    jobs: [
      { id: 1, date: '2026-09-01', company: 'A', amount: 1.3, status: 'done', description: '作業A' },
      { id: 2, date: '2026-09-02', company: 'companyB', amount: '0.9', status: 'plan', description: '作業B' },
      { id: 3, date: '2026-09-03', company: '依頼元A', amount: 'x', status: 'done', description: '' },
    ],
    settings: { companyA: { name: '依頼元A', defaultAmount: 1.3, defaultDesc: '作業A' }, companyB: { name: '依頼元B', defaultAmount: 0.9, defaultDesc: '作業B' } },
  };
  const parsed = L.parse(JSON.stringify(legacy));
  assert.equal(parsed.format, 'object');
  const { data, report } = L.convert(parsed, store.createEmpty(NOW));
  assert.deepEqual(data.sidejob.records.map((r) => [r.clientId, r.base, r.confirmed]), [['cli_A', 13000, true], ['cli_B', 9000, false]]);
  assert.ok(report.notes.some((t) => t.includes('plan')));
  assert.ok(report.issues.some((t) => t.includes('金額')));
  assert.equal(report.counts.total, 22000);
});

test('旧形式ではないものは読み込まない', () => {
  assert.equal(L.parse('not json').ok, false);
  assert.equal(L.parse('[1,2,3]').ok, false);
  assert.equal(L.parse('{"foo":[]}').ok, false);
});

test('サンプル:副業も入っていて、予想額が出せる', () => {
  const d = store.prepare(sample.build(NOW)).data;
  assert.ok(d.sidejob.clients.length >= 2);
  assert.ok(d.sidejob.records.length > 10);
  const f = S.forecast(d.sidejob, '2026-11', null, TODAY);
  assert.equal(f.total, f.confirmed + f.scheduled);
});

test('内容の文章:作業項目名に、金額を万円にした数を付ける(10,000円 → 1、1,000円 → 0.1)', () => {
  assert.equal(S.contentOf([{ name: '作業項目K', amount: 10000 }, { name: '作業項目N', amount: 1000 }]), '作業項目K1、作業項目N0.1');
  assert.equal(S.manNumber(12500), '1.25');
  assert.equal(S.manNumber(0), '0');
  // 読み込み直すと、作業項目のある記録の文章は今の書き方にそろう(作業項目の無い旧データは文章のまま)
  const { d, sj, A } = fixture();
  sj.records.push({ id: 'r1', date: '2026-11-02', clientId: 'A', base: 8000, items: [{ name: '作業項目X', amount: 2000 }], content: '作業項目X', memo: '', confirmed: false });
  sj.records.push({ id: 'r2', date: '2026-11-04', clientId: 'A', base: 8000, items: [], content: '旧データの文章', memo: '', confirmed: false });
  const again = store.prepare(JSON.parse(JSON.stringify(d))).data.sidejob.records;
  assert.equal(again.find((r) => r.id === 'r1').content, '作業項目X0.2');
  assert.equal(again.find((r) => r.id === 'r2').content, '旧データの文章');
  assert.ok(A);
});

test('追加で出る日:依頼元と基本額・作業項目を選んで予定に入れると、予想額と記録の初期値に使う', () => {
  const { sj, A, B } = fixture();
  // 2026-11-17(火)は依頼元A の曜日パターン外 → 追加で出る日(見込みは基本額 5,000 + 作業項目Y 1,500)
  S.setExtraDay(sj, 'A', '2026-11-17', { base: 5000, items: [{ name: '作業項目Y', amount: 1500 }] });
  assert.equal(S.dayState(sj, '2026-11', A, '2026-11-17'), 'extra');
  assert.equal(S.dayExpected(sj, A, '2026-11-17'), 6500);
  assert.equal(S.dayExpected(sj, A, '2026-11-18'), S.dailyExpected(A)); // ふつうの予定日
  const before = S.forecast(sj, '2026-11', 'A', TODAY);
  assert.ok(S.plannedDates(sj, '2026-11', A).includes('2026-11-17'));
  // 記録を作るときは、その日の見込みが最初から入る
  const draft = S.newDraft(A, '2026-11-17', S.dayPlan(sj, 'A', '2026-11-17'));
  assert.deepEqual([draft.base, draft.items.map((x) => x.name)], [5000, ['作業項目Y']]);
  // 見込みを直すと予想額も変わる
  S.setExtraDay(sj, 'A', '2026-11-17', { base: 0, items: [{ name: '作業項目Y', amount: 1500 }] });
  assert.equal(S.forecast(sj, '2026-11', 'A', TODAY).planned, before.planned - 5000);
  // 依頼元B の曜日パターンの日(土曜)を選んだときは、休む日を戻して見込みだけ入れる
  S.toggleDay(sj, '2026-11', 'B', '2026-11-21');
  assert.equal(S.dayState(sj, '2026-11', B, '2026-11-21'), 'off');
  S.setExtraDay(sj, 'B', '2026-11-21', { base: 20000, items: [] });
  assert.equal(S.dayState(sj, '2026-11', B, '2026-11-21'), 'planned');
  assert.equal(S.dayExpected(sj, B, '2026-11-21'), 20000);
  // やめると、日と見込みが消える
  S.removeExtraDay(sj, 'A', '2026-11-17');
  assert.equal(S.dayState(sj, '2026-11', A, '2026-11-17'), 'none');
  assert.equal(S.dayPlan(sj, 'A', '2026-11-17'), null);
  // 保存して読み直しても見込みは残る
  const again = S.normalize(JSON.parse(JSON.stringify(sj)));
  assert.equal(again.schedule['2026-11'].B.plans['2026-11-21'].base, 20000);
});

test('支払い管理への自動の反映:対応する入金予定を予想額にそろえ、入金済みの入金は変えない', () => {
  const { d, sj, A } = fixture();
  d.payments.month = '2026-12';
  P.saveIncome(d.payments, { id: 'inc1', name: '副業:依頼元A', amount: null, fixed: false });
  A.payment = { incomeId: 'inc1', timing: 'next', day: 25 }; // 翌月払い → 11 月の働いた分が 12 月の入金
  S.saveRecord(sj, { ...S.newDraft(A, '2026-11-02'), confirmed: true });
  const expected = S.forecast(sj, '2026-11', 'A', TODAY).total;
  assert.equal(S.needsPaymentSync(d, TODAY), true);
  assert.equal(S.syncPayments(d, TODAY), 1);
  assert.equal(d.payments.incomes[0].amount, expected);
  assert.equal(S.needsPaymentSync(d, TODAY), false);
  assert.deepEqual(S.clientsForIncome(sj, 'inc1').map((c) => c.id), ['A']);
  // 入金済みにしたら、そのあと記録が増えても変えない
  d.payments.incomes[0].done = true;
  S.saveRecord(sj, S.newDraft(A, '2026-11-04'));
  assert.equal(S.syncPayments(d, TODAY), 0);
  assert.equal(d.payments.incomes[0].amount, expected);
});

test('v5 のデータを開くと v6 になり、副業の予定は見込み(plans)つきの形になる', () => {
  const v5 = store.createEmpty(NOW);
  v5.sidejob.clients.push({ id: 'A', name: '依頼元A', baseAmount: 1000, tasks: [], weekdays: [1], payment: {}, memo: '' });
  v5.sidejob.schedule = { '2026-11': { A: { off: ['2026-11-02'], extra: ['2026-11-04'] } } };
  v5.schemaVersion = 5;
  const res = store.prepare(JSON.parse(JSON.stringify(v5)));
  assert.equal(res.ok, true);
  assert.equal(res.data.schemaVersion, store.SCHEMA_VERSION); // v6 を通って最新の版まで上がる
  assert.deepEqual(res.data.sidejob.schedule['2026-11'].A, { off: ['2026-11-02'], extra: ['2026-11-04'], plans: {} });
});

test('追加で出る日:今日より前の日に入れても、記録を作るまでは予想額に入る(ふつうの予定日は今日以降だけ)', () => {
  const { sj, B } = fixture();
  const before = S.forecast(sj, '2026-11', 'B', TODAY); // 今日は 2026-11-15
  // 2026-11-02(月)は依頼元B の曜日パターン外。今日より前の日に、見込み 15,000 円で追加
  S.setExtraDay(sj, 'B', '2026-11-02', { base: 15000, items: [] });
  const after = S.forecast(sj, '2026-11', 'B', TODAY);
  assert.equal(after.planned, before.planned + 15000);
  assert.equal(after.plannedDays, before.plannedDays + 1);
  // ふつうの予定日(土曜)は今日以降の 11/21・11/28 だけを数える(11/7・11/14 は記録が無いので 0)
  assert.equal(before.planned, 2 * S.dailyExpected(B));
  // 記録を作ると、見込みではなく記録の額になる
  S.saveRecord(sj, { ...S.newDraft(B, '2026-11-02', S.dayPlan(sj, 'B', '2026-11-02')), base: 12000, items: [] });
  const recorded = S.forecast(sj, '2026-11', 'B', TODAY);
  assert.equal(recorded.unconfirmed, 12000);
  assert.equal(recorded.planned, before.planned);
});

test('来月の入金(予想):翌月払いは今月働いた分。対応していない依頼元は、同じ名前の入金予定に対応させられる', () => {
  const { d, sj, A, B } = fixture();
  d.payments.month = '2026-11';
  P.saveIncome(d.payments, { id: 'incB', name: '依頼元B', amount: 50000, fixed: false });
  // 依頼元B は同じ名前の入金予定がある → 対応させる候補
  const un = S.unlinkedClients(d);
  assert.deepEqual(un.map((u) => [u.client.id, u.sameName && u.sameName.id]), [['A', null], ['B', 'incB']]);
  S.linkClientToIncome(d, 'B', 'incB');
  assert.equal(B.payment.incomeId, 'incB');
  // 依頼元A は入金予定を作って対応させる
  const created = S.linkClientToIncome(d, 'A', null);
  assert.equal(d.payments.incomes.find((i) => i.id === created).name, '副業:依頼元A');
  // 来月(12 月)の入金 = 11 月に働いた分(追加で出る日を含む)
  S.setExtraDay(sj, 'B', '2026-11-02', { base: 15000, items: [] });
  const pv = S.nextPaymentPreview(d, TODAY);
  assert.equal(pv.target, '2026-12');
  const rowB = pv.rows.find((r) => r.incomeId === 'incB');
  assert.equal(rowB.to, S.forecast(sj, '2026-11', 'B', TODAY).total);
  assert.equal(pv.total, pv.rows.reduce((t, r) => t + r.to, 0));
  // 今月の入金予定には 10 月に働いた分(記録が無く 0 円)→ 入っている 50,000 円は消さない。空欄なら 0 円を入れる
  S.syncPayments(d, TODAY);
  assert.equal(d.payments.incomes.find((i) => i.id === 'incB').amount, 50000);
  assert.equal(d.payments.incomes.find((i) => i.id === created).amount, 0); // 空欄の入金予定には予想額(0 円)が入る
  assert.ok(A);
});
