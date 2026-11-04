// 支払い管理の計算・データ処理のテスト(画面は対象外)。使うのは架空のデータだけ。
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
require('../js/features/payments/legacy.js');
require('../js/features/assets/model.js'); // v2 → v3 の移行
require('../js/features/inventory/model.js'); // v3 → v4 の移行
require('../js/features/sidejob/model.js');
require('../js/data/sample.js');

const { util: U, store, monthlyModel: M, paymentsModel: P, paymentsLegacy: L, sample } = globalThis.MT;

const NOW = new Date(2026, 10, 15); // 2026-11-15
const YM = '2026-11';

/** 架空の口座 2 つ(銀行・手元現金)と支払い管理の入ったデータ */
function fixture() {
  const d = store.createEmpty(NOW);
  const m = d.monthly;
  const a = M.addItem(m, 'cat_cash', '架空銀行A');
  const b = M.addItem(m, 'cat_cash', '架空銀行B');
  const w = M.addItem(m, 'cat_cash', '手元の現金');
  d.payments.month = YM;
  P.linkAccount(d, a.id, 'bank');
  P.linkAccount(d, b.id, 'bank');
  P.linkAccount(d, w.id, 'cash');
  P.setBalance(d.payments, a.id, 50000, '2026-11-01');
  P.setBalance(d.payments, b.id, 10000, '2026-11-01');
  P.setBalance(d.payments, w.id, 5000, '2026-11-01');
  return { d, p: d.payments, a: a.id, b: b.id, w: w.id };
}

function sumCategories(t, key) {
  return Object.values(t.byCategory).reduce((s, c) => s + c[key], 0);
}

test('段階1(v1)のデータを移行しても月末記録は変わらず、現金区分の項目が口座になる', () => {
  const v1 = {
    app: 'money-tracker',
    schemaVersion: 1,
    meta: {},
    monthly: {
      categories: [
        { id: 'cat_cash', name: '現金' },
        { id: 'cat_invest', name: '投資' },
      ],
      items: [
        { id: 'a', categoryId: 'cat_cash', name: '架空銀行' },
        { id: 'w', categoryId: 'cat_cash', name: '財布' },
        { id: 's', categoryId: 'cat_invest', name: '架空証券' },
      ],
      records: {
        '2026-08': { values: { a: 1000, w: 10 }, confirmed: {}, memo: '' },
        '2026-09': { values: { a: 2000 }, confirmed: {}, memo: 'メモ' },
      },
    },
  };
  const res = store.prepare(v1);
  assert.equal(res.ok, true);
  assert.equal(res.migrated, true);
  assert.equal(res.data.schemaVersion, store.SCHEMA_VERSION); // v1 → v2 → … と続けて移行
  assert.deepEqual(res.data.monthly.records['2026-09'].values, { a: 2000 });
  assert.equal(res.data.monthly.records['2026-09'].memo, 'メモ');
  assert.deepEqual(
    res.data.payments.accounts.map((x) => [x.itemId, x.kind, x.balance]),
    [
      ['a', 'bank', 2000], // 最新の記録の値
      ['w', 'cash', 10], // 最新で空なら、その前の値
    ]
  );
});

test('カテゴリ別・未済・合計は同じ明細から出るので必ず一致する(内訳・残り・特別支出を含む)', () => {
  const { p, a, b } = fixture();
  P.saveBill(p, {
    name: 'カードX',
    amount: 50000,
    dueDay: 10,
    accountId: a,
    category: 'variable',
    subItems: [
      { name: 'サブスク', amount: 1500, category: 'fixed' },
      { name: '終わった内訳', amount: 9999, category: 'fixed', endMonth: '2026-10' },
      { name: '積立', amount: 10000, category: 'investment' },
    ],
  });
  P.saveBill(p, { name: 'ローンY', amount: 30000, dueDay: 27, accountId: b, category: 'loan', done: true });
  P.saveBill(p, { name: '終了Z', amount: 7000, category: 'fixed', endMonth: '2026-10' });
  P.saveBill(p, { name: '未入力W', amount: null, category: 'variable', subItems: [{ name: '固定分', amount: 800, category: 'fixed' }] });
  P.saveSpecial(p, { name: '税金', amount: 20000, month: YM });
  P.saveSpecial(p, { name: '来年の税金', amount: 99999, month: '2027-05' });

  const t = P.totals(p, YM);
  assert.equal(t.byCategory.fixed.total, 1500 + 800);
  assert.equal(t.byCategory.investment.total, 10000);
  assert.equal(t.byCategory.variable.total, 50000 - 1500 - 10000); // 請求額の残り
  assert.equal(t.byCategory.loan.total, 30000);
  assert.equal(t.byCategory.special.total, 20000);
  assert.equal(t.total, 50000 + 30000 + 800 + 20000);
  assert.equal(t.unpaid, t.total - 30000);
  assert.equal(sumCategories(t, 'total'), t.total);
  assert.equal(sumCategories(t, 'unpaid'), t.unpaid);
  assert.equal(P.cashflow(p, YM).remaining, t.unpaid);
  assert.deepEqual(P.activeBills(p, YM).map((x) => x.name), ['カードX', 'ローンY', '未入力W']); // 終了Z は非表示
});

test('内訳の合計が請求額を超えると警告になり、それでも合計は一致する', () => {
  const { d, p, a } = fixture();
  P.saveBill(p, { name: '超過', amount: 1000, accountId: a, category: 'fixed', subItems: [{ name: 'x', amount: 1500, category: 'variable' }] });
  const bill = p.bills[0];
  assert.equal(P.isOverSub(bill, YM), true);
  assert.equal(P.warnings(d, YM).overSub.length, 1);
  const t = P.totals(p, YM);
  assert.equal(t.total, 1000); // 引き落とされるのは請求額
  assert.equal(sumCategories(t, 'total'), t.total);
});

test('口座ごとの引き落とし・入金予定・引落後予想(済は含めない)', () => {
  const { d, p, a, b } = fixture();
  P.saveBill(p, { name: '1', amount: 70000, accountId: a, category: 'fixed' });
  P.saveBill(p, { name: '2', amount: 5000, accountId: a, category: 'fixed', done: true });
  P.saveBill(p, { name: '3', amount: 12345, accountId: b, category: 'variable' });
  P.saveIncome(p, { name: '給与', amount: 100000, fixed: true, targetId: a });
  const rows = P.accountRows(d, YM);
  const ra = rows.find((r) => r.itemId === a);
  const rb = rows.find((r) => r.itemId === b);
  assert.equal(ra.withdraw, 70000);
  assert.equal(ra.withdrawAll, 75000);
  assert.equal(ra.need, 20000);
  assert.equal(rb.need, 3000); // 2,345 → 1,000 円単位で切り上げ
  assert.equal(ra.incoming + rb.incoming, 100000);
  assert.equal(rb.after, 10000 + 3000 - 12345);
  assert.equal(ra.after, 50000 + 97000 - 70000);
});

test('自動振り分け:優先振込先のある入金を先に使い、残りは優先振込先へ。指定なしの余りは振り分けない', () => {
  const { p, a, b } = fixture();
  P.saveBill(p, { name: 'A の引き落とし', amount: 80000, accountId: a, category: 'loan' });
  P.saveBill(p, { name: 'B の引き落とし', amount: 25500, accountId: b, category: 'fixed' });
  P.saveIncome(p, { id: 'free', name: '指定なし', amount: 20000, fixed: false, targetId: null });
  P.saveIncome(p, { id: 'toB', name: 'B宛て', amount: 50000, fixed: true, targetId: b });
  const plan = P.autoPlan(p, YM);
  // A の不足 30,000、B の不足 15,500 → 16,000
  // B宛て(先に使う):B に 16,000 → A に 30,000 → 残り 4,000 は B へ。指定なしは使わない
  const get = (inc, acc) => (plan.find((x) => x.incomeId === inc && x.accountId === acc) || {}).amount || 0;
  assert.equal(get('toB', b), 16000 + 4000);
  assert.equal(get('toB', a), 30000);
  assert.equal(get('free', a) + get('free', b), 0);
  const sum = P.planSummary(p, YM);
  assert.deepEqual(sum.unassigned.map((u) => [u.income.id, u.rest]), [['free', 20000]]);
});

test('振り分けを手で直すと手動になり、提案に戻せる', () => {
  const { p, a, b } = fixture();
  P.saveBill(p, { name: 'x', amount: 60000, accountId: a, category: 'fixed' });
  P.saveIncome(p, { id: 'sal', name: '給与', amount: 30000, fixed: true });
  assert.equal(P.planSummary(p, YM).mode, 'auto');
  P.setAllocation(p, YM, 'sal', b, 5000);
  const s = P.planSummary(p, YM);
  assert.equal(s.mode, 'manual');
  assert.equal(s.byAccount.get(a), 10000); // 提案の分は残る
  assert.equal(s.byAccount.get(b), 5000);
  P.setAllocation(p, YM, 'sal', b, 50000);
  assert.equal(P.planSummary(p, YM).over.length, 1); // 入金額を超えた
  P.resetAllocation(p);
  assert.equal(P.planSummary(p, YM).mode, 'auto');
});

test('キャッシュフロー:確保している資金 − 残りの支払い = 差引予測残高', () => {
  const { p, a } = fixture();
  P.saveBill(p, { name: 'x', amount: 40000, accountId: a, category: 'fixed' });
  P.saveIncome(p, { name: '入金', amount: 30000, fixed: true });
  P.saveIncome(p, { name: '入金済み', amount: 99999, fixed: true, done: true });
  const cf = P.cashflow(p, YM);
  assert.equal(cf.balances, 65000);
  assert.equal(cf.pendingIncome, 30000);
  assert.equal(cf.secured, 95000);
  assert.equal(cf.remaining, 40000);
  assert.equal(cf.net, 55000);
});

test('特別支出:今月分は支払いに含め、今後の分は月あたりの積立額を出す', () => {
  const { p } = fixture();
  P.saveSpecial(p, { name: '今月', amount: 10000, month: YM });
  P.saveSpecial(p, { name: '5か月後', amount: 30000, month: '2027-04' });
  P.saveSpecial(p, { name: '済', amount: 50000, month: '2027-01', done: true });
  assert.equal(P.totals(p, YM).byCategory.special.total, 10000);
  const plan = P.savingPlan(p, YM);
  assert.equal(plan.rows.length, 1);
  assert.equal(plan.rows[0].months, 5);
  assert.equal(plan.rows[0].perMonth, 6000);
  assert.equal(plan.total, 6000);
});

test('月替わり:前月を履歴に保存し、済を外し、変動の金額を空にする(1回だけ)', () => {
  const { d, p, a } = fixture();
  P.saveBill(p, { id: 'card', name: 'カード', amount: 30000, accountId: a, category: 'variable', done: true, subItems: [{ name: '固定', amount: 1000, category: 'fixed' }, { name: '変動', amount: 2000, category: 'variable' }] });
  P.saveBill(p, { id: 'rent', name: '家賃', amount: 50000, accountId: a, category: 'fixed', done: true });
  P.saveBill(p, { id: 'end', name: '今月で終わり', amount: 3000, category: 'fixed', endMonth: YM });
  P.saveIncome(p, { id: 'sal', name: '給与', amount: 200000, fixed: true, done: true });
  P.saveIncome(p, { id: 'side', name: '副業', amount: 10000, fixed: false });
  P.setAllocation(p, YM, 'side', a, 1000);

  assert.equal(P.rollover(d, new Date(2026, 10, 30)), null); // 同じ月なら何もしない
  const res = P.rollover(d, new Date(2026, 11, 1));
  assert.deepEqual(res, { month: YM, to: '2026-12' });
  const h = p.history.find((x) => x.month === YM);
  assert.equal(h.payment, 30000 + 50000 + 3000);
  assert.equal(h.income, 210000);
  assert.equal(h.balance, 65000);
  assert.equal(Object.values(h.catTotals).reduce((s, v) => s + v, 0), h.payment);
  const card = p.bills.find((x) => x.id === 'card');
  assert.equal(card.done, false);
  assert.equal(card.amount, null);
  assert.deepEqual(card.subItems.map((x) => x.amount), [1000, null]);
  assert.equal(p.bills.find((x) => x.id === 'rent').amount, 50000);
  assert.equal(p.incomes.find((x) => x.id === 'side').amount, null);
  assert.equal(p.incomes.find((x) => x.id === 'sal').amount, 200000);
  assert.equal(p.allocation.mode, 'auto');
  assert.deepEqual(p.notice, { type: 'rollover', month: YM });
  assert.deepEqual(P.activeBills(p, '2026-12').map((x) => x.id), ['card', 'rent']); // 終了した支払いは非表示
  assert.equal(P.rollover(d, new Date(2026, 11, 2)), null);
});

test('口座の現在残高を月末記録に反映する(月が無ければ作り、入力済みにする)', () => {
  const { d, a, b } = fixture();
  const other = M.addItem(d.monthly, 'cat_invest', '架空証券');
  M.setValue(d.monthly, '2026-10', other.id, 777, '2026-10-31');
  const n = P.reflectToMonthly(d, YM, '2026-11-30');
  assert.equal(n, 3);
  assert.equal(M.getValue(d.monthly, YM, a), 50000);
  assert.equal(M.isConfirmed(d.monthly, YM, b), true);
  assert.equal(M.getValue(d.monthly, YM, other.id), 777); // ほかの項目は前月からコピー(未確認)
  assert.equal(M.isCarried(d.monthly, YM, other.id), true);
});

test('月末記録で項目を消すと、支払い管理の口座と参照も外れる', () => {
  const { d, a } = fixture();
  P.saveBill(d.payments, { id: 'x', name: 'x', amount: 1, accountId: a, category: 'fixed' });
  P.saveIncome(d.payments, { id: 'i', name: 'i', amount: 1, targetId: a });
  M.deleteItem(d.monthly, a);
  P.finalize(d);
  assert.equal(d.payments.accounts.some((x) => x.itemId === a), false);
  assert.equal(d.payments.bills[0].accountId, null);
  assert.equal(d.payments.incomes[0].targetId, null);
});

test('旧アプリのバックアップ(架空)を変換し、式を計算し、変換できない項目を報告する', () => {
  store.load();
  store.replaceAll(store.createEmpty(NOW), 'テスト');
  // 同じ名前の項目があれば、つなぐ
  store.update((d) => M.addItem(d.monthly, 'cat_cash', '架空銀行A'));
  const legacy = {
    accounts: [{ id: 1, name: '架空銀行A', amount: '100000+2500', incomingAmount: '', isIncomingDone: false, memo: '給与口座' }],
    wallets: [{ id: 'w1', name: '財布', amount: 12000, outgoAmount: '20000', isOutgoDone: false, isOutgoFixed: false, incomingAmount: '', memo: '' }],
    incomes: [
      { id: 'i1', name: '給与', amount: '250000', defaultTarget: 'account_1', isFixed: true, isDone: false, memo: '' },
      { id: 'i2', name: '臨時', amount: 'abc', defaultTarget: 'wallet_zz', isFixed: false, isDone: false },
    ],
    payments: [
      {
        id: 'p1',
        name: 'カードX',
        amount: '30000+1500*2',
        dueDate: '27',
        endDate: '',
        accountId: '1',
        category: 'variable',
        isDone: false,
        memo: '',
        subItems: [{ id: 's1', name: 'サブスク', amount: '980', category: 'fixed', endDate: '2030-01', memo: '' }],
      },
      { id: 'p2', name: '謎', amount: 5000, dueDate: '末', endDate: '2025/3', accountId: '9', category: 'other', isDone: true },
    ],
    specialPayments: [
      { id: 'sp1', name: '税金', amount: '40000', targetMonth: '2027-05', memo: '', isDone: false },
      { id: 'sp2', name: '不明', amount: '1', targetMonth: 'いつか' },
    ],
    history: [
      { id: '2026-09', label: '9月', income: '250000', payment: '180000', balance: '500000', catTotals: { loan: 50000, fixed: '30000', variable: '100000' }, details: [{ name: 'カードX', amount: '31000', category: 'variable' }], incomeDetails: [{ name: '給与', amount: 250000 }] },
    ],
    memos: 'メモ本文',
    allocations: { i1: { account_1: 30000 } },
  };
  const parsed = L.parse(JSON.stringify(legacy));
  assert.equal(parsed.ok, true);
  const { data, report } = L.convert(parsed.obj, store.get(), NOW);
  const p = data.payments;

  assert.equal(report.counts.linked, 1);
  assert.equal(report.counts.created, 1);
  const bankItem = data.monthly.items.find((x) => x.name === '架空銀行A');
  assert.equal(P.findAccount(p, bankItem.id).balance, 102500);
  const card = p.bills.find((x) => x.name === 'カードX');
  assert.equal(card.amount, 33000);
  assert.equal(card.dueDay, 27);
  assert.equal(card.accountId, bankItem.id);
  assert.equal(card.subItems[0].endMonth, '2030-01');
  const odd = p.bills.find((x) => x.name === '謎');
  assert.equal(odd.dueDay, 31);
  assert.equal(odd.category, 'variable');
  assert.equal(odd.accountId, null);
  assert.ok(p.bills.some((x) => x.name === '財布の支出' && x.amount === 20000));
  assert.equal(p.incomes.find((x) => x.name === '給与').targetId, bankItem.id);
  assert.equal(p.incomes.find((x) => x.name === '臨時').amount, null);
  assert.equal(p.specials.length, 1);
  assert.equal(p.history[0].catTotals.fixed, 30000);
  assert.deepEqual(p.allocation, { mode: 'manual', items: [{ incomeId: 'inc_i1', accountId: bankItem.id, amount: 30000 }] });
  assert.match(p.memo, /メモ本文/);
  assert.match(p.memo, /給与口座/);
  for (const word of ['abc', 'wallet_zz', '「9」', 'other', 'いつか']) {
    assert.ok(report.issues.some((t) => t.includes(word)), `報告に ${word} がない`);
  }
  assert.equal(store.prepare(data).ok, true);
  // 変換は元のデータを書き換えない
  assert.equal(store.get().payments.bills.length, 0);
});

test('旧形式ではないテキストは読み込まない', () => {
  assert.equal(L.parse('not json').ok, false);
  assert.equal(L.parse('[1,2]').ok, false);
  assert.equal(L.parse('{"foo":1}').ok, false);
  // 値が JSON の文字列になっている形にも対応
  assert.equal(L.parse(JSON.stringify({ accounts: JSON.stringify([{ id: 1, name: 'x' }]) })).obj.accounts.length, 1);
});

test('サンプル:読み込むと月替わりが動き、先月分が履歴に入る', () => {
  const d = store.prepare(sample.build(NOW)).data;
  assert.equal(d.payments.month, '2026-10');
  const res = P.rollover(d, NOW);
  assert.deepEqual(res, { month: '2026-10', to: YM });
  assert.equal(d.payments.history.length, 6);
  assert.equal(d.payments.history[5].month, '2026-10');
  const t = P.totals(d.payments, YM);
  assert.equal(sumCategories(t, 'total'), t.total);
  assert.equal(P.endedBills(d.payments, YM).length, 1); // ジムは先月で終了
});

test('未入力:請求額も内訳も空欄の支払いだけを「完全に未入力」とし、一部だけ入れた所は空欄を 0 として計算する', () => {
  const { d, p, a } = fixture();
  P.saveBill(p, { id: 'none', name: '架空カードN', amount: null, dueDay: 10, accountId: a, category: 'variable', subItems: [] });
  P.saveBill(p, { id: 'part', name: '架空カードP', amount: null, dueDay: 10, accountId: a, category: 'variable', subItems: [{ name: '入れた内訳', amount: 3000, category: 'fixed' }, { name: '空欄の内訳', amount: null, category: 'variable' }] });
  P.saveBill(p, { id: 'subs', name: '架空カードS', amount: null, dueDay: 10, accountId: a, category: 'variable', subItems: [{ name: '空欄', amount: null, category: 'fixed' }] });
  const bill = (id) => p.bills.find((b) => b.id === id);
  assert.equal(P.isUnentered(bill('none'), YM), true);
  assert.equal(P.isUnentered(bill('subs'), YM), true);
  assert.equal(P.isUnentered(bill('part'), YM), false);
  assert.equal(P.billTotal(bill('part'), YM), 3000); // 空欄の内訳は 0
  const w = P.warnings(d, YM);
  assert.deepEqual(w.missingAmount.map((b) => b.id).sort(), ['none', 'subs']);
  // 完全に未入力の支払いは、合計では 0 として扱う
  const t = P.totals(p, YM);
  assert.equal(t.byCategory.fixed.total >= 3000, true);
  P.toggleDone(p, 'bills', 'none');
  assert.deepEqual(P.warnings(d, YM).missingAmount.map((b) => b.id), ['subs']); // 済にしたものは出さない
});

test('引き落とし後の残りの状態:マイナスは不足、引き落としがあって 1 万円未満は残りわずか', () => {
  assert.equal(P.afterStatus(-1, 5000), 'short');
  assert.equal(P.afterStatus(0, 5000), 'tight');
  assert.equal(P.afterStatus(P.TIGHT_BALANCE - 1, 1), 'tight');
  assert.equal(P.afterStatus(P.TIGHT_BALANCE, 1), 'ok');
  // 引き落としが無い口座は、残りが少なくても「足りる」
  assert.equal(P.afterStatus(300, 0), 'ok');
  assert.equal(P.afterStatus(-300, 0), 'short');
  // 口座の行にも状態が入る
  const { d, p, a } = fixture();
  P.saveBill(p, { name: '支払いX', amount: 45000, dueDay: 27, accountId: a, category: 'fixed' }); // 残り 5,000 円
  const rows = P.accountRows(d, YM);
  for (const r of rows) assert.equal(r.status, P.afterStatus(r.after, r.withdraw));
  assert.equal(rows.find((r) => r.itemId === a).status, 'tight');
});
