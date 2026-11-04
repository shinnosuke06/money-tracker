// 将来予想(ライフプラン)の計算のテスト(画面は対象外)。使うのは架空のデータだけ。
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
require('../js/features/future/model.js');
require('../js/data/sample.js');

const { util: U, store, monthlyModel: MM, assetsModel: A, futureModel: F, sample } = globalThis.MT;

const NOW = new Date(2026, 10, 15); // 2026-11-15

/** 確認用の小さなプラン(2030年1月から、利回り・防衛資金 0) */
function plan(patch) {
  return F.cleanPlan({ name: 'テスト', startYM: '2030-01', birthYM: '1980-01', years: 2, returns: { low: 0, mid: 0, high: 0 }, reserve: { months: 0, amount: 0 }, ...patch });
}

test('計算の確認(画面と同じ 8 つ)はすべて一致する', () => {
  const list = F.checks();
  assert.deepEqual(list.map((c) => c.id), ['loan', 'order', 'tax', 'fixed', 'rate', 'cap', 'cashcap', 'zero']);
  for (const c of list) assert.equal(c.ok, true, `${c.title}: ${JSON.stringify(c.rows)}`);
});

test('ローンは終了月まで払い、翌月から支出が減る(開始年月があればその月から)', () => {
  const r = F.simulate(plan({ cash: 0, loans: [{ name: 'ローンX', monthly: 10000, endYM: '2030-06' }, { name: 'ローンY', monthly: 3000, startYM: '2030-05', endYM: '2030-07' }] }), 0);
  const loansBy = (ym) => r.months.find((m) => m.ym === ym).loans;
  assert.equal(loansBy('2030-04'), 10000);
  assert.equal(loansBy('2030-05'), 13000);
  assert.equal(loansBy('2030-06'), 13000);
  assert.equal(loansBy('2030-07'), 3000);
  assert.equal(loansBy('2030-08'), 0);
});

test('取り崩し:最初に売る → 足りなければ売る。売りたくないは使わず、足りなければ資金不足', () => {
  const p = plan({
    cash: 0,
    years: 1,
    living: { monthly: 100000, changes: [] },
    assets: [
      { name: 'B', group: 'other', value: 50000, cost: 50000, taxKind: 'none', priority: 'ifNeeded', grows: false },
      { name: 'K', group: 'other', value: 9000000, cost: 9000000, taxKind: 'none', priority: 'keep', grows: false },
      { name: 'A', group: 'other', value: 80000, cost: 80000, taxKind: 'none', priority: 'first', grows: false },
    ],
  });
  const r = F.simulate(p, 0);
  // 1か月目:不足 100,000 → A 80,000 → B 20,000
  assert.deepEqual(r.months[0].sales.map((s) => [s.name, s.gross]), [['A', 80000], ['B', 20000]]);
  assert.equal(r.months[0].cash, 0);
  assert.equal(r.months[0].short, false);
  // 2か月目:B の残り 30,000 だけ。現金はマイナス → 資金不足
  assert.deepEqual(r.months[1].sales.map((s) => [s.name, s.gross]), [['B', 30000]]);
  assert.equal(r.months[1].cash, -70000);
  assert.equal(r.months[1].short, true);
  assert.equal(r.summary.firstShortYM, '2030-02');
  // 売りたくない資産は最後まで残る
  assert.equal(r.buckets.find((b) => b.name === 'K').value, 9000000);
});

test('生活防衛資金:下回る月は取り崩して戻し、資産が尽きたら「防衛資金割れ」を記録する', () => {
  const p = plan({
    cash: 300000,
    years: 1,
    living: { monthly: 100000, changes: [] },
    reserve: { months: 2, amount: null }, // 生活費 × 2 = 200,000
    assets: [{ name: 'A', group: 'other', value: 150000, cost: 150000, taxKind: 'none', priority: 'first', grows: false }],
  });
  const r = F.simulate(p, 0);
  assert.equal(r.months[0].reserve, 200000);
  assert.equal(r.months[0].cash, 200000); // 300,000 − 100,000(まだ割らない)
  assert.equal(r.months[1].drawNet, 100000); // 100,000 → 200,000 に戻す
  assert.equal(r.months[1].cash, 200000);
  assert.equal(r.months[2].drawNet, 50000); // 残り 50,000 だけ
  assert.equal(r.months[2].cash, 150000);
  assert.equal(r.months[2].below, true);
  assert.equal(r.months[2].short, false);
  assert.equal(r.summary.firstBelowYM, '2030-03');
  // 4月:150,000 − 100,000 = 50,000、5月:−50,000 → 資金不足
  assert.equal(r.months[3].cash, 50000);
  assert.equal(r.summary.firstShortYM, '2030-05');
});

test('税金:課税口座は含み益の割合 × 税率、NISA は 0%、取得額は売った割合だけ減る', () => {
  const p = (taxKind) =>
    plan({ cash: 0, years: 1, reserve: { months: 0, amount: 100000 }, assets: [{ name: 'X', group: 'securities', value: 1000000, cost: 500000, taxKind, priority: 'first', grows: false }] });
  const t = F.simulate(p('taxable'), 0);
  const n = F.simulate(p('nisa'), 0);
  assert.deepEqual([t.months[0].sales[0].gross, t.months[0].sales[0].tax, t.months[0].sales[0].net], [111306, 11306, 100000]);
  assert.deepEqual([n.months[0].sales[0].gross, n.months[0].sales[0].tax], [100000, 0]);
  // 売ったあとの取得額:500,000 × (1 − 111,306 / 1,000,000)
  const b = t.buckets[0];
  assert.equal(b.value, 1000000 - 111306);
  assert.equal(b.cost, 500000 - Math.round((500000 * 111306) / 1000000));
  // 税率は条件で変えられる
  const t2 = F.simulate(plan({ ...p('taxable'), tax: { taxable: 10, nisa: 0 } }), 0);
  assert.equal(t2.months[0].sales[0].gross, Math.ceil(100000 / (1 - 0.5 * 0.1)));
});

test('利回り:年利から月利に換算し、12か月で年利どおりに増える。手入力・在庫(grows=false)と現金は増えない', () => {
  const p = plan({
    cash: 1000000,
    years: 1,
    assets: [
      { name: '投信', group: 'securities', value: 1000000, cost: 1000000, taxKind: 'nisa', priority: 'ifNeeded', grows: true },
      { name: '在庫', group: 'inventory', value: 500000, cost: 100000, taxKind: 'none', priority: 'first', grows: false },
    ],
  });
  const r = F.simulate(p, 12);
  const last = r.months[11];
  assert.ok(Math.abs(r.buckets[0].value - 1120000) <= 12, `${r.buckets[0].value}`);
  assert.equal(r.buckets[1].value, 500000);
  assert.equal(last.cash, 1000000);
  assert.ok(Math.abs(F.monthlyRate(12) - (Math.pow(1.12, 1 / 12) - 1)) < 1e-12);
});

test('3 つの利回りパターンを同時に計算する(高いほど期間の終わりの総資産が大きい)', () => {
  const p = plan({ cash: 0, years: 10, returns: { low: 1, mid: 3, high: 5 }, savings: [{ name: '積立', monthly: 30000 }], incomes: [{ name: '収入', monthly: 30000 }] });
  const all = F.simulateAll(p);
  assert.deepEqual(Object.keys(all), ['low', 'mid', 'high']);
  assert.ok(all.low.summary.endTotal < all.mid.summary.endTotal && all.mid.summary.endTotal < all.high.summary.endTotal);
  // 元本は 30,000 × 120
  assert.ok(all.low.summary.endInvest > 30000 * 120);
});

test('年齢で決まる収入と生活費の変化、インフレ率', () => {
  const p = plan({
    birthYM: '1970-06', // 2030年6月に 60 歳
    years: 2,
    cash: 10000000,
    incomes: [
      { name: '給与', fromAge: null, toAge: 59, monthly: 300000 },
      { name: '再雇用', fromAge: 60, toAge: 64, monthly: 180000 },
    ],
    living: { monthly: 200000, changes: [{ fromAge: 60, monthly: 150000 }] },
    inflation: 12,
  });
  const r = F.simulate(p, 0);
  const at = (ym) => r.months.find((m) => m.ym === ym);
  assert.equal(at('2030-05').age, 59);
  assert.equal(at('2030-05').income, 300000);
  assert.equal(at('2030-06').age, 60);
  assert.equal(at('2030-06').income, 180000);
  // インフレ:12か月後は 1.12 倍(生活費は入力が今の値段)
  assert.equal(at('2030-01').living, 200000);
  assert.equal(at('2031-01').living, Math.round(150000 * 1.12));
  // 生年月が無いと、年齢の条件つきの収入は入らず、注意が出る
  const q = plan({ birthYM: null, incomes: [{ name: '給与', fromAge: null, toAge: 59, monthly: 300000 }, { name: '仕送り', monthly: 1000 }] });
  assert.equal(F.simulate(q, 0).months[0].income, 1000);
  assert.ok(F.warnings(q).some((w) => w.includes('生年月')));
});

test('臨時収入・毎年の費用(間隔・オフ)・単発の出費(オフ)・返済・副業の期限', () => {
  const p = plan({
    years: 4,
    cash: 10000000,
    extras: [{ name: '退職金', year: 2031, month: 3, amount: 5000000 }, { name: '賞与', year: 2030, month: 12, amount: 200000, untilYear: 2031 }],
    yearly: [
      { name: '車検', amount: 100000, month: 9, fromYear: 2030, interval: 2 },
      { name: 'オフの費用', amount: 999, month: 1, fromYear: 2030, enabled: false },
    ],
    oneTime: [{ name: '車', ym: '2031-04', amount: 2000000, enabled: true }, { name: 'オフ', ym: '2031-05', amount: 1, enabled: false }],
    repayments: [{ name: '返済', monthly: 10000, endYM: '2030-03' }],
    sidejob: { monthly: 50000, untilYM: '2030-02' },
  });
  const r = F.simulate(p, 0);
  const sum = (key, from, to) => r.months.filter((m) => m.ym >= from && m.ym <= to).reduce((t, m) => t + m[key], 0);
  assert.deepEqual(r.months.filter((m) => m.yearly).map((m) => m.ym), ['2030-09', '2032-09']);
  assert.deepEqual(r.months.filter((m) => m.oneTime).map((m) => m.ym), ['2031-04']);
  assert.equal(sum('income', '2031-03', '2031-03'), 5000000);
  assert.deepEqual(r.months.filter((m) => m.income === 200000).map((m) => m.ym), ['2030-12', '2031-12']);
  // 返済(3月まで)と副業(2月まで)
  assert.equal(r.months[0].income, 60000);
  assert.equal(r.months[2].income, 10000);
  assert.equal(r.months[3].income, 0);
});

test('年ごとの表:暦の年でまとめ、合計は月の合計と一致。最初の年は一部の月', () => {
  const p = plan({ startYM: '2030-11', years: 2, cash: 0, incomes: [{ name: '収入', monthly: 100 }], living: { monthly: 30, changes: [] } });
  const r = F.simulate(p, 0);
  assert.deepEqual(r.years.map((y) => [y.year, y.count]), [[2030, 2], [2031, 12], [2032, 10]]);
  assert.equal(r.years.reduce((t, y) => t + y.income, 0), 100 * 24);
  assert.equal(r.years[0].flow, 140);
  assert.equal(r.years[2].cash, 70 * 24);
  assert.equal(r.years[1].age, 51);
});

test('取り崩し案:その年に売る資産を、売る順に合計する', () => {
  const p = plan({
    cash: 0,
    years: 1,
    living: { monthly: 10000, changes: [] },
    assets: [{ name: 'A', group: 'other', value: 25000, cost: 25000, taxKind: 'none', priority: 'first', grows: false }, { name: 'B', group: 'other', value: 1000000, cost: 1000000, taxKind: 'none', priority: 'ifNeeded', grows: false }],
  });
  const r = F.simulate(p, 0);
  const dp = F.drawdownPlan(r, 2030);
  assert.deepEqual(dp.sales.map((s) => [s.name, s.gross]), [['A', 25000], ['B', 95000]]);
  assert.equal(dp.net, 120000);
  assert.equal(F.drawdownPlan(r, 2099), null);
});

test('サンプルの記録から新しいプランを作る(初期値)', () => {
  const d = sample.build(NOW);
  const p = F.newPlan(d, NOW, 'テストのプラン');
  const ym = MM.latestMonth(d.monthly);
  assert.equal(p.startYM, '2026-11');
  assert.equal(p.cash, MM.categoryTotal(d.monthly, ym, 'cat_cash'));
  assert.equal(p.cashSource, 'monthly');
  // 投資:価格のある保有 + 手入力 + 在庫(個数 1 以上)。売却優先度と取得額を引き継ぐ
  const rows = A.rows(d.assets);
  const held = d.inventory.items.filter((i) => i.quantity > 0).length;
  assert.equal(p.assets.length, rows.filter((r) => !r.missing).length + held);
  for (const r of rows.filter((x) => !x.missing)) {
    const a = p.assets.find((x) => x.sourceKey === `${r.source === 'holding' ? 'h' : 'm'}:${r.id}`);
    assert.equal(a.value, r.value);
    assert.equal(a.cost, r.cost);
    assert.equal(a.priority, r.priority);
  }
  assert.ok(p.assets.filter((a) => a.group === 'inventory').every((a) => a.grows === false));
  assert.ok(p.assets.filter((a) => a.group === 'securities').every((a) => a.grows === true));
  // 生活費:履歴の直近 3 か月の固定費 + 変動費の平均
  const h3 = d.payments.history.slice(-3);
  assert.equal(p.living.monthly, Math.round(h3.reduce((t, h) => t + h.catTotals.fixed + h.catTotals.variable, 0) / h3.length));
  // ローン:カテゴリ「ローン」の支払い。終了月を引き継ぐ
  const loanBills = d.payments.bills.filter((b) => b.category === 'loan' && (!b.endMonth || b.endMonth >= d.payments.month));
  assert.equal(p.loans.length, loanBills.length);
  for (const b of loanBills) assert.equal(p.loans.find((l) => l.sourceKey === `bill:${b.id}`).endYM, b.endMonth);
  // 特別支出 → 毎年の費用
  assert.ok(p.yearly.length > 0 && p.yearly.every((y) => y.sourceKey.startsWith('sp:')));
  assert.equal(p.tax.taxable, 20.315);
  // 副業:直近の記録のある月の平均
  assert.equal(p.sidejob.monthly, F.sidejobFrom(d, NOW).monthly);
  assert.ok(p.sidejob.monthly > 0);
  // 現金の出どころを支払いの口座残高に変える
  const c = F.cashFrom(d, 'payments');
  assert.equal(c.cash, d.payments.accounts.reduce((t, a) => t + (a.balance || 0), 0));
});

test('プランの複製・名前変更・削除と、比較の選択', () => {
  const f = F.create();
  const id1 = F.addPlan(f, F.cleanPlan({ name: '車を買い替える', oneTime: [{ name: '車', ym: '2030-04', amount: 1 }] }));
  const id2 = F.duplicatePlan(f, id1, '車を買い替えない');
  const [p1, p2] = f.plans;
  assert.notEqual(id1, id2);
  assert.notEqual(p1.oneTime[0].id, p2.oneTime[0].id);
  F.toggleRow(p2, 'oneTime', p2.oneTime[0].id);
  assert.equal(p1.oneTime[0].enabled, true);
  assert.equal(p2.oneTime[0].enabled, false);
  assert.equal(f.activeId, id2);
  assert.deepEqual(f.compare, { a: id1, b: id2 });
  F.renamePlan(f, id1, '  新しい名前  ');
  assert.equal(p1.name, '新しい名前');
  F.removePlan(f, id2);
  assert.equal(f.activeId, id1);
  assert.deepEqual(f.compare, { a: id1, b: id1 });
  for (let i = 0; i < 20; i++) F.addPlan(f, F.cleanPlan({}));
  assert.equal(f.plans.length, F.MAX_PLANS);
});

test('おかしな値は直して読み込む(範囲・行の形)', () => {
  const p = F.cleanPlan({ years: 999, inflation: 'abc', returns: { low: -99, mid: '2.5', high: 100 }, tax: { taxable: -1 }, cash: -500, incomes: [null, { monthly: -1, fromAge: 200 }], yearly: [{ toYear: 1900, fromYear: 2030 }] });
  assert.equal(p.years, 40);
  assert.equal(p.inflation, 0);
  assert.deepEqual(p.returns, { low: -20, mid: 2.5, high: 30 });
  assert.equal(p.tax.taxable, 0);
  assert.equal(p.cash, -500); // 現金はマイナスも入る(借入など)
  assert.equal(p.incomes.length, 1);
  assert.equal(p.incomes[0].monthly, 0);
  assert.equal(p.incomes[0].fromAge, null);
  assert.equal(p.yearly[0].toYear, null);
});

test('v7 のデータを開くと最新の版になり、空の将来予想の区画が足される(ほかはそのまま)', () => {
  const v7 = sample.build(NOW);
  delete v7.future;
  v7.schemaVersion = 7;
  const before = JSON.stringify(v7.payments);
  const res = store.prepare(JSON.parse(JSON.stringify(v7)));
  assert.equal(res.ok, true);
  assert.equal(res.data.schemaVersion, store.SCHEMA_VERSION);
  assert.deepEqual(res.data.future.plans, []);
  assert.equal(JSON.stringify(res.data.payments), before);
});

test('収入の初期値:「変動」で空欄の入金予定も、履歴の直近 3 か月に毎月あれば平均で入れる', () => {
  const d = store.createEmpty(NOW);
  const P = globalThis.MT.paymentsModel;
  const p = d.payments;
  P.saveIncome(p, { name: '給与', amount: null, fixed: false });
  P.saveIncome(p, { name: '固定の収入', amount: 50000, fixed: true });
  P.saveIncome(p, { name: 'たまの入金', amount: null, fixed: false });
  p.history = ['2026-08', '2026-09', '2026-10'].map((month, i) => ({
    month,
    income: 0,
    payment: 0,
    balance: null,
    catTotals: {},
    details: [],
    incomeDetails: [{ name: '給与', amount: 300000 + i * 3000 }, ...(i === 1 ? [{ name: 'たまの入金', amount: 9000 }] : [])],
  }));
  const rows = F.incomesFrom(d);
  assert.deepEqual(rows.map((r) => [r.name, r.monthly]), [['給与', 303000], ['固定の収入', 50000]]);
});

test('最初の1年の内訳と、収入が少ないときの注意', () => {
  const p = plan({ years: 2, cash: 0, incomes: [{ name: '収入', monthly: 100000 }], living: { monthly: 150000, changes: [] }, savings: [{ name: '積立', monthly: 20000 }], extras: [{ name: '賞与', year: 2030, month: 6, amount: 120000 }] });
  const fy = F.firstYear(p);
  assert.equal(fy.months, 12);
  assert.equal(fy.income.work, 100000);
  assert.equal(fy.income.extra, 10000);
  assert.equal(fy.expense.saving, 20000);
  assert.equal(fy.net, 100000 + 10000 - 150000 - 20000);
  assert.equal(fy.netExSaving, 100000 + 10000 - 150000);
  assert.ok(F.warnings(p).some((w) => w.includes('赤字')));
  assert.ok(F.warnings(plan({ incomes: [] })).some((w) => w.includes('収入」が入っていません')));
  // 積立だけで現金が減るときは「赤字」と言わない
  const q = plan({ years: 1, cash: 0, incomes: [{ name: '収入', monthly: 100000 }], living: { monthly: 90000, changes: [] }, savings: [{ name: '積立', monthly: 20000 }] });
  assert.equal(F.firstYear(q).net < 0, true);
  assert.equal(F.warnings(q).some((w) => w.includes('赤字')), false);
});

// ---- 取り崩しの設定 ----

const asset = (name, value, priority = 'ifNeeded', extra = {}) => ({ name, group: 'other', value, cost: value, taxKind: 'nisa', priority, grows: false, ...extra });

test('取り崩しの設定:既定は「不足分だけ」。v8 のプランを開くと既定が入り、結果は変わらない', () => {
  const p = plan({ cash: 0, years: 1, living: { monthly: 10000, changes: [] }, assets: [asset('A', 50000, 'first')] });
  assert.equal(p.drawdown.method, 'shortfall');
  assert.equal(p.drawdown.topUp, true);
  assert.equal(p.drawdown.fixedMonthly, F.DRAW_DEFAULTS.fixedMonthly);
  assert.equal(p.drawdown.ratePercent, F.DRAW_DEFAULTS.ratePercent);
  const v8 = store.createEmpty(NOW);
  const raw = JSON.parse(JSON.stringify(p));
  delete raw.drawdown;
  v8.future = { plans: [raw], activeId: raw.id, compare: { a: raw.id, b: raw.id } };
  v8.schemaVersion = 8;
  const res = store.prepare(JSON.parse(JSON.stringify(v8)));
  assert.equal(res.ok, true);
  assert.equal(res.data.schemaVersion, store.SCHEMA_VERSION);
  assert.equal(res.data.future.plans[0].drawdown.method, 'shortfall');
  assert.deepEqual(F.simulate(res.data.future.plans[0], 0).summary, F.simulate(p, 0).summary);
});

test('取り崩しの対象:「売りたくない」は既定でオフ、オンにすると使う。順番の入れ替えとオフ', () => {
  const p = plan({ cash: 0, years: 1, living: { monthly: 30000, changes: [] }, assets: [asset('B', 100000), asset('K', 100000, 'keep'), asset('A', 100000, 'first')] });
  const items = F.drawItems(p);
  assert.deepEqual(items.map((x) => [x.name, x.on]), [['A', true], ['B', true], ['K', false]]);
  const keyOf = (n) => items.find((x) => x.name === n).key;
  // 順番を K → B → A にして、K をオン、A をオフ
  p.drawdown = F.cleanDrawdown({ ...p.drawdown, order: [keyOf('K'), keyOf('B'), keyOf('A')], targets: { [keyOf('K')]: true, [keyOf('A')]: false } });
  const r = F.simulate(p, 0);
  assert.deepEqual(r.months[0].sales.map((x) => x.name), ['K']);
  assert.equal(r.buckets.find((b) => b.name === 'A').value, 100000);
  // すべてオフなら補わず、注意を出す
  p.drawdown = F.cleanDrawdown({ ...p.drawdown, targets: { [keyOf('K')]: false, [keyOf('A')]: false, [keyOf('B')]: false } });
  assert.equal(F.simulate(p, 0).months[0].cash, -30000);
  assert.ok(F.warnings(p).some((w) => w.includes('すべてオフ')));
});

test('定額:期間(年齢)の外は「不足分だけ」。不足分を補わない設定なら、足りない月は資金不足', () => {
  const base = { birthYM: '1970-01', cash: 0, years: 1, living: { monthly: 20000, changes: [] }, assets: [asset('A', 10000000)] };
  // 2030年は 60 歳。定額は 61 歳から → この年は不足分だけ(生活費の分だけ)
  const before = F.simulate(plan({ ...base, drawdown: { method: 'fixed', fixedMonthly: 50000, fromAge: 61 } }), 0);
  assert.equal(before.months[0].drawPlanNet, 0);
  assert.equal(before.months[0].drawNeedNet, 20000);
  // 60 歳から:毎月 50,000 を取り崩し、不足分は出ない
  const during = F.simulate(plan({ ...base, drawdown: { method: 'fixed', fixedMonthly: 50000, fromAge: 60 } }), 0);
  assert.equal(during.months[0].drawPlanNet, 50000);
  assert.equal(during.months[0].cash, 30000);
  // 定額 10,000・不足分を補わない → 毎月 −10,000 ずつ足りない
  const noTop = F.simulate(plan({ ...base, drawdown: { method: 'fixed', fixedMonthly: 10000, topUp: false } }), 0);
  assert.equal(noTop.months[0].cash, -10000);
  assert.equal(noTop.summary.firstShortYM, '2030-01');
  // 補う設定なら、足りない分も取り崩す(併用)
  const top = F.simulate(plan({ ...base, drawdown: { method: 'fixed', fixedMonthly: 10000, topUp: true } }), 0);
  assert.deepEqual([top.months[0].drawPlanNet, top.months[0].drawNeedNet, top.months[0].cash], [10000, 10000, 0]);
});

test('定額の税:課税口座は売る額から税を引いた手取りが現金に入る', () => {
  const r = F.simulate(plan({ cash: 0, years: 1, drawdown: { method: 'fixed', fixedMonthly: 100000 }, assets: [asset('X', 1000000, 'ifNeeded', { cost: 500000, taxKind: 'taxable' })] }), 0);
  const sl = r.months[0].sales[0];
  assert.equal(sl.gross, 100000);
  assert.equal(sl.tax, Math.round(100000 * 0.5 * 0.20315));
  assert.equal(r.months[0].cash, 100000 - sl.tax);
});

test('現金の上限:上限以上の月は定額・定率を休む(戻す設定がなくても)', () => {
  const r = F.simulate(plan({ cash: 600000, years: 1, living: { monthly: 100000, changes: [] }, drawdown: { method: 'fixed', fixedMonthly: 50000, cashCap: 500000 }, assets: [asset('A', 1000000)] }), 0);
  // 1月:600,000 − 100,000 = 500,000(上限以上)→ 休む / 2月:400,000 → 50,000 取り崩す
  assert.equal(r.months[0].paused, true);
  assert.equal(r.months[0].drawGross, 0);
  assert.equal(r.months[1].drawGross, 50000);
  assert.equal(r.months[1].cash, 450000);
});

test('複製と読み直しで、取り崩しの対象・順番の設定が消えない', () => {
  const d = sample.build(NOW);
  const f = F.create();
  const id = F.addPlan(f, F.newPlan(d, NOW, 'もと'));
  const p = F.findPlan(f, id);
  const items = F.drawItems(p);
  const k0 = items[0].key;
  F.updateDrawdown(f, id, { targets: { [k0]: false }, order: items.map((x) => x.key).reverse() });
  // 読み直し:同じ出どころの資産は id を引き継ぐ
  F.reloadStart(F.findPlan(f, id), d, NOW);
  const after = F.drawItems(F.findPlan(f, id));
  assert.equal(after.find((x) => x.key === k0).on, false);
  assert.equal(after[after.length - 1].key, k0);
  // 複製:キーが新しい id に付け替わる
  const id2 = F.duplicatePlan(f, id, 'コピー');
  const c = F.drawItems(F.findPlan(f, id2));
  assert.deepEqual(c.map((x) => [x.name, x.on]), after.map((x) => [x.name, x.on]));
  assert.ok(c.every((x) => !x.key.startsWith('a:') || F.findPlan(f, id2).assets.some((a) => `a:${a.id}` === x.key)));
});

// ---- 原因の見える化 ----

test('資金不足の年の内訳と理由(単発の出費・上限・取り崩せる資産なし)', () => {
  const p = plan({
    startYM: '2030-01',
    years: 3,
    cash: 500000,
    incomes: [{ name: '収入', monthly: 100000 }],
    living: { monthly: 100000, changes: [] },
    oneTime: [{ name: '車', ym: '2031-06', amount: 900000 }],
    assets: [asset('A', 200000)],
  });
  const r = F.simulate(p, 0);
  const c = F.shortageCause(p, r);
  assert.equal(c.year.year, 2031);
  assert.equal(c.comparable, true);
  assert.equal(c.rows.find((x) => x.key === 'oneTime').cur, 900000);
  assert.equal(c.rows.find((x) => x.key === 'cashStart').cur, 500000);
  assert.ok(c.reasons.some((t) => t.includes('車')));
  assert.ok(c.reasons.some((t) => t.includes('取り崩せる資産がなくなりました')));
  const capPlan = plan({ cash: 0, years: 1, living: { monthly: 100000, changes: [] }, drawdown: { yearlyCap: 200000 }, assets: [asset('A', 5000000)] });
  const cc = F.shortageCause(capPlan, F.simulate(capPlan, 0));
  assert.ok(cc.reasons[0].includes('上限'));
  assert.equal(F.shortageCause(plan({ cash: 1 }), F.simulate(plan({ cash: 1 }), 0)), null);
});

test('ちょっと変えたら:生活費・収入の終わり・積立・利回りを一時的に動かす(元のプランは変えない)', () => {
  const p = plan({
    birthYM: '1970-01',
    incomes: [{ name: '給与', toAge: 59, monthly: 300000 }, { name: '再雇用', fromAge: 60, toAge: 64, monthly: 180000 }, { name: '年金', fromAge: 65, monthly: 150000 }],
    living: { monthly: 200000, changes: [{ fromAge: 65, monthly: 150000 }] },
    savings: [{ name: '積立', monthly: 30000 }],
    returns: { low: 1, mid: 3, high: 5 },
  });
  const t = F.applyTweaks(p, { living: -10, workEnd: 2, saving: 50, rate: 1 });
  assert.equal(t.living.monthly, 180000);
  assert.equal(t.living.changes[0].monthly, 135000);
  assert.deepEqual(t.incomes.map((r) => [r.name, r.fromAge, r.toAge]), [['給与', null, 61], ['再雇用', 62, 66], ['年金', 65, null]]);
  assert.equal(t.savings[0].monthly, 45000);
  assert.deepEqual(t.returns, { low: 2, mid: 4, high: 6 });
  assert.equal(p.living.monthly, 200000); // 元はそのまま
  assert.deepEqual(F.applyTweaks(p, {}).incomes, p.incomes);
});

test('10% 変えたときの影響:期間の終わりの総資産の差を、大きい順に並べる', () => {
  const p = plan({ years: 10, cash: 1000000, incomes: [{ name: '収入', monthly: 300000 }], living: { monthly: 200000, changes: [] }, loans: [{ name: 'ローン', monthly: 10000 }], returns: { low: 1, mid: 3, high: 5 }, assets: [asset('A', 1000000, 'ifNeeded', { grows: true })] });
  const s = F.sensitivity(p, 'mid');
  const by = Object.fromEntries(s.items.map((x) => [x.id, x]));
  assert.equal(by.work.up, 300000 * 0.1 * 120); // 収入 +10% → 月 30,000 × 120 か月(現金は増えない)
  assert.equal(by.living.up, -200000 * 0.1 * 120);
  assert.equal(by.loans.up, -1000 * 120);
  assert.ok(by.returns.up > 0);
  const mags = s.items.map((x) => Math.max(Math.abs(x.up), Math.abs(x.down)));
  assert.deepEqual(mags, [...mags].sort((a, b) => b - a));
  assert.equal(s.items[0].id, 'work');
  assert.ok(!by.sidejob); // 0 円の項目は出さない
});
