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

test('計算の確認(画面と同じ 4 つ)はすべて一致する', () => {
  const list = F.checks();
  assert.equal(list.length, 4);
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

test('v7 のデータを開くと v8 になり、空の将来予想の区画が足される(ほかはそのまま)', () => {
  const v7 = sample.build(NOW);
  delete v7.future;
  v7.schemaVersion = 7;
  const before = JSON.stringify(v7.payments);
  const res = store.prepare(JSON.parse(JSON.stringify(v7)));
  assert.equal(res.ok, true);
  assert.equal(res.data.schemaVersion, 8);
  assert.deepEqual(res.data.future.plans, []);
  assert.equal(JSON.stringify(res.data.payments), before);
});
