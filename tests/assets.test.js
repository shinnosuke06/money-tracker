// 資産管理の計算・価格取得・旧データ変換のテスト(画面は対象外)。使うのは架空のデータだけ。
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
require('../js/core/secrets.js');
require('../js/features/monthly/model.js');
require('../js/features/payments/model.js');
require('../js/features/assets/model.js');
require('../js/features/assets/prices.js');
require('../js/features/assets/legacy.js');
require('../js/features/inventory/model.js'); // v3 → v4 の移行
require('../js/features/sidejob/model.js');
require('../js/data/sample.js');

const { util: U, store, secrets, monthlyModel: M, assetsModel: A, assetPrices: PR, assetsLegacy: L, sample } = globalThis.MT;

const NOW = new Date(2026, 10, 15, 10, 0); // 2026-11-15
const URL_OK = 'https://example.invalid/exec'; // 架空の URL(実在しない)

function fixture() {
  const d = store.createEmpty(NOW);
  const a = d.assets;
  A.saveHolding(a, { id: 'x', broker: '証券A', account: 'tokutei', type: 'jp', code: 'X101', name: '銘柄X', quantity: 100, avgPrice: 1500, price: 1800 });
  A.saveHolding(a, { id: 'y', broker: '証券A', account: 'tokutei', type: 'jp', code: 'X102', name: '銘柄Y', quantity: 100, avgPrice: 2000, price: 1900 });
  A.saveHolding(a, { id: 'm', broker: '証券A', account: 'nisa_new', type: 'fund', code: 'XFUND001', name: 'ファンドM', quantity: 12.3456, avgPrice: 15000, price: 16000 });
  A.saveHolding(a, { id: 'n', broker: '証券B', account: 'nisa_old', type: 'fund', code: 'XFUND002', name: 'ファンドN', quantity: 10, avgPrice: 10000, price: 12000 });
  A.saveHolding(a, { id: 'p', broker: '証券B', account: 'tokutei', type: 'us', code: 'XUS', name: '米国銘柄P', quantity: 10, avgPrice: 20000, priceUsd: 140 });
  A.saveHolding(a, { id: 'q', broker: '証券B', account: 'ippan', type: 'jp', code: 'X999', name: '価格なし', quantity: 50, avgPrice: 800 });
  A.saveManual(a, { id: 'pt', name: 'ポイント運用', category: 'invest', value: 52300, cost: 48000 });
  A.saveManual(a, { id: 'gd', name: '金', category: 'other', value: 100000, cost: 80000 });
  a.fx = { rate: 150, source: 'manual', at: null };
  return { d, a };
}

const sumOf = (map, key = 'value') => [...map.values()].reduce((t, g) => t + g[key], 0);

test('段階2(v2)のデータを v3 に移行しても、月末記録と支払い管理は変わらない', () => {
  const v2 = store.createEmpty(NOW);
  M.addItem(v2.monthly, 'cat_cash', '架空銀行');
  v2.payments.memo = '支払いのメモ';
  delete v2.assets;
  v2.schemaVersion = 2;
  const res = store.prepare(JSON.parse(JSON.stringify(v2)));
  assert.equal(res.ok, true);
  assert.equal(res.migrated, true);
  assert.equal(res.data.schemaVersion, store.SCHEMA_VERSION); // v3 以降まで続けて移行
  assert.equal(res.data.monthly.items[0].name, '架空銀行');
  assert.equal(res.data.payments.memo, '支払いのメモ');
  assert.deepEqual(res.data.assets.holdings, []);
  assert.equal(res.data.assets.settings.taxRate, A.DEFAULT_TAX);
});

test('段階1(v1)のデータも v3 まで続けて移行できる', () => {
  const v1 = { app: 'money-tracker', schemaVersion: 1, meta: {}, monthly: { categories: [{ id: 'cat_cash', name: '現金' }], items: [{ id: 'a', categoryId: 'cat_cash', name: '架空銀行' }], records: { '2026-09': { values: { a: 1 }, confirmed: {}, memo: '' } } } };
  const res = store.prepare(v1);
  assert.equal(res.ok, true);
  assert.equal(res.data.schemaVersion, store.SCHEMA_VERSION);
  assert.equal(res.data.payments.accounts.length, 1);
  assert.ok(res.data.assets);
});

test('評価額・評価損益・手残り:課税口座の含み益だけに税、NISA は 0%、含み損に税なし', () => {
  const { a } = fixture();
  const v = (id) => A.valuation(a.holdings.find((h) => h.id === id), a);
  assert.deepEqual([v('x').value, v('x').gain, v('x').tax, v('x').net], [180000, 30000, 6095, 173905]);
  assert.deepEqual([v('y').gain, v('y').tax], [-10000, 0]); // 含み損
  assert.deepEqual([v('m').value, v('m').cost, v('m').tax], [197530, 185184, 0]); // 投資信託(口数÷1万)・NISA
  assert.equal(v('p').value, 210000); // 140 ドル × 150 円 × 10 株
  assert.equal(v('q').missing, true); // 価格が無ければ取得単価で代用しない
  assert.equal(v('q').value, null);
  // 税率は設定で変えられる
  a.settings.taxRate = 0.1;
  assert.equal(v('x').tax, 3000);
});

test('集計:証券会社別・口座区分別・種別別・売却優先度別のどれを足しても合計と一致し、価格未取得は数だけ数える', () => {
  const { a } = fixture();
  const s = A.summary(a);
  assert.equal(s.missing, 1);
  const overall = { value: s.total, cost: s.cost, gain: s.gain, tax: s.tax, net: s.net };
  for (const key of Object.keys(overall)) {
    for (const map of [s.byBroker, s.byAccount, s.byKind, s.byPriority]) assert.equal(sumOf(map, key), overall[key], key);
  }
  assert.equal(s.byBroker.get(A.MANUAL_BROKER).value, 152300);
  assert.equal(s.nisa.nisa_new.value, 197530);
  assert.equal(s.nisa.nisa_old.gain, 20000);
  assert.equal(s.byPriority.get('keep').value, 152300); // 手入力の既定は「売りたくない」
  assert.equal(s.byPriority.get('ifNeeded').count, 6); // 株・投信の既定は「足りなければ売る」
});

test('手入力の資産:評価額か含み損益の片方から、もう片方を計算する(取得額 = 評価額 − 含み益)', () => {
  assert.deepEqual(A.recalcManual({ value: 60000, gain: 4300, cost: 48000 }, 'value'), { value: 60000, cost: 48000, gain: 12000 });
  assert.deepEqual(A.recalcManual({ value: 52300, gain: 10000, cost: 48000 }, 'gain'), { value: 58000, cost: 48000, gain: 10000 });
  const { a } = fixture();
  const pt = A.manualValuation(a.manual.find((m) => m.id === 'pt'), a);
  assert.deepEqual([pt.gain, pt.tax], [4300, 874]); // 「投資」区分は課税
  const gd = A.manualValuation(a.manual.find((m) => m.id === 'gd'), a);
  assert.equal(gd.tax, 0); // 「その他」は税なし
});

test('買い増し:数量と買値から、加重平均で平均取得単価を出し直す', () => {
  const { a } = fixture();
  assert.equal(A.buyMore(a, 'x', 100, 2100), true);
  const x = a.holdings.find((h) => h.id === 'x');
  assert.equal(x.quantity, 200);
  assert.equal(x.avgPrice, 1800);
  assert.deepEqual(A.previewBuyMore({ quantity: 3, avgPrice: 100 }, 1, 200), { quantity: 4, avgPrice: 125 });
});

test('貼り付け:見出しを飛ばし、種別を推測し、同じ銘柄は買い増しとして合算する', () => {
  const { a } = fixture();
  const textValue = ['コード,銘柄名,数量,取得単価', 'X101,銘柄X,100,2100', 'XFUND009\tファンドK\t1.5\t9,800', 'XAB,米国銘柄R,2,30000', 'X5,おかしい行', 'X201,銘柄W,abc,100'].join('\n');
  const { rows } = A.parsePaste(textValue, { a, broker: '証券A', account: 'tokutei', type: 'auto' });
  assert.equal(rows.length, 5);
  assert.equal(rows[0].mergeWith, 'x');
  assert.deepEqual([rows[1].type, rows[1].avgPrice, rows[1].quantity], ['fund', 9800, 1.5]);
  assert.equal(rows[2].type, 'us');
  assert.match(rows[3].error, /4 つ/);
  assert.match(rows[4].error, /数量/);
  const res = A.applyPaste(a, rows, { broker: '証券A', account: 'tokutei' });
  assert.deepEqual(res, { added: 2, merged: 1 });
  assert.equal(a.holdings.find((h) => h.id === 'x').quantity, 200);
});

test('価格の自動取得:v6 の結果を反映し、取れなかった銘柄は前回の価格のまま理由を付け、米国株はドル × USD/JPY', async () => {
  const { a } = fixture();
  const calls = [];
  const fake = async (url) => {
    calls.push(url);
    if (url.startsWith(URL_OK)) {
      const codes = new URL(url).searchParams.get('codes').split(',');
      assert.ok(codes.includes('USDJPY')); // 米国株があるときは為替も一緒に聞く
      return { ok: true, json: async () => ({ version: 'v6', results: { X101: 1850, XFUND001: 16500, XFUND002: 12100, USDJPY: 152 }, errors: ['X102'], errorDetails: { X102: '一時的なエラー' } }) };
    }
    if (url.includes('symbol=XUS')) return { ok: true, json: async () => ({ c: 150 }) };
    throw new Error('unexpected ' + url);
  };
  const report = await PR.fetchPrices({ assets: a, secrets: { priceUrl: URL_OK, finnhubKey: 'dummy-key' }, fetchImpl: fake });
  assert.equal(report.aborted, null);
  assert.deepEqual(report.fx, { rate: 152, source: 'auto' });
  assert.deepEqual(report.prices['jp:X102'], { ok: false, reason: '一時的なエラー' });
  assert.deepEqual(report.prices['jp:X999'], { ok: false, reason: '結果に含まれていません' });
  A.applyPriceReport(a, report, NOW);
  const h = (id) => a.holdings.find((x) => x.id === id);
  assert.equal(h('x').price, 1850);
  assert.equal(h('x').priceSource, 'auto');
  assert.equal(h('y').price, 1900); // 前回の価格のまま
  assert.equal(h('y').lastError, '一時的なエラー');
  assert.equal(h('q').price, null); // 一度も取れていない → 価格未取得のまま
  assert.equal(A.valuation(h('p'), a).value, 150 * 152 * 10);
  assert.equal(a.history.length, 1); // 更新のたびに履歴へ
  assert.equal(a.history[0].date, '2026-11-15');
});

test('価格の自動取得:version が v6 でなければ何も更新しない', async () => {
  const { a } = fixture();
  const before = JSON.stringify(a.holdings);
  const report = await PR.fetchPrices({
    assets: a,
    secrets: { priceUrl: URL_OK, finnhubKey: 'dummy-key' },
    fetchImpl: async () => ({ ok: true, json: async () => ({ version: 'v5', results: { X101: 9999 } }) }),
  });
  assert.match(report.aborted, /URLが古い、または別のもの/);
  assert.deepEqual(report.prices, {});
  assert.equal(JSON.stringify(a.holdings), before);
});

test('価格の自動取得:為替が取れなければ設定の手入力値、キーが無ければ米国株は手入力のまま', async () => {
  const { a } = fixture();
  a.settings.fxManual = 148;
  const report = await PR.fetchPrices({
    assets: a,
    secrets: { priceUrl: URL_OK },
    fetchImpl: async () => ({ ok: true, json: async () => ({ version: 'v6', results: { X101: 1800 }, errors: [], errorDetails: {} }) }),
  });
  assert.deepEqual(report.fx, { rate: 148, source: 'manual' });
  assert.equal(report.prices['us:XUS'], undefined);
  assert.ok(report.messages.some((m) => m.includes('Finnhub')));
  // 通信できないときは、国内株・投資信託がすべて失敗扱い(価格は前回のまま)
  const r2 = await PR.fetchPrices({ assets: a, secrets: { priceUrl: URL_OK }, fetchImpl: async () => ({ ok: false, status: 500 }) });
  assert.equal(r2.prices['jp:X101'].ok, false);
  // 通信そのものができない(ネットにつながらない・外部に接続できない画面)ときは、理由とお知らせを出す
  const r3 = await PR.fetchPrices({ assets: a, secrets: { priceUrl: URL_OK, finnhubKey: 'k' }, fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
  assert.equal(r3.prices['jp:X101'].reason, '通信できませんでした');
  assert.equal(r3.prices['us:XUS'].reason, '通信できませんでした');
  assert.ok(r3.messages.some((m) => m.includes('外部に接続できない画面')));
});

test('価格の自動取得:USD/JPY は URL → 公開の為替レート → 手入力 → 前回の値の順に使う(Finnhub は株価だけ)', async () => {
  const { a } = fixture();
  a.settings.fxManual = 148;
  const asked = [];
  const fake = (fxJpy) => async (url) => {
    asked.push(url);
    if (url.includes('finnhub')) return { ok: true, json: async () => ({ c: 100 }) };
    if (url.includes('frankfurter')) return fxJpy ? { ok: true, json: async () => ({ amount: 1, base: 'USD', date: '2026-11-13', rates: { JPY: fxJpy } }) } : { ok: false, status: 503 };
    return { ok: true, json: async () => ({ version: 'v6', results: { X101: 1800 }, errors: [], errorDetails: {} }) }; // 価格取得の URL は USDJPY を返さない
  };
  // URL に無ければ、公開の為替レート
  const r1 = await PR.fetchPrices({ assets: a, secrets: { priceUrl: URL_OK, finnhubKey: 'k' }, fetchImpl: fake(151.5) });
  assert.deepEqual(r1.fx, { rate: 151.5, source: 'auto' });
  assert.ok(r1.messages.some((m) => m.includes('公開の為替レート') && m.includes('2026-11-13')));
  assert.equal(r1.prices['us:XUS'].price, 100);
  assert.ok(!asked.some((u) => u.includes('finnhub') && u.includes('JPY'))); // Finnhub には為替を聞かない
  // 公開の為替レートも取れなければ、手入力の値
  const r2 = await PR.fetchPrices({ assets: a, secrets: { priceUrl: URL_OK, finnhubKey: 'k' }, fetchImpl: fake(null) });
  assert.deepEqual(r2.fx, { rate: 148, source: 'manual' });
  // 手入力も無ければ、前回の値のまま(日時は変えない)
  a.settings.fxManual = null;
  a.fx = { rate: 149, source: 'auto', at: '2026-11-01T00:00:00.000Z' };
  const r3 = await PR.fetchPrices({ assets: a, secrets: { priceUrl: URL_OK, finnhubKey: 'k' }, fetchImpl: fake(null) });
  assert.equal(r3.fx, null);
  A.applyPriceReport(a, r3, NOW);
  assert.equal(a.fx.rate, 149);
  assert.equal(a.fx.at, '2026-11-01T00:00:00.000Z');
  // 何も無ければ、円に換算できない理由を出す
  a.fx = { rate: null, source: null, at: null };
  const r4 = await PR.fetchPrices({ assets: a, secrets: { priceUrl: URL_OK, finnhubKey: 'k' }, fetchImpl: fake(null) });
  assert.deepEqual(r4.fx, { rate: null, source: null });
  assert.ok(r4.messages.some((m) => m.includes('USD/JPY(手入力)')));
});

test('価格の自動取得:USD/JPY の公開の為替レートは Frankfurter(新しい場所)→ currency-api の順。取れない理由をどこで・なぜか出す', async () => {
  const { a } = fixture();
  a.settings.fxManual = 147;
  assert.ok(PR.PUBLIC_FX[0].url.startsWith('https://api.frankfurter.dev/v1/'));
  assert.ok(!PR.PUBLIC_FX.some((x) => x.url.includes('frankfurter.app')));
  const asked = [];
  const fake = ({ frank, cur }) => async (url) => {
    asked.push(url);
    if (url.includes('finnhub')) return { ok: true, json: async () => ({ c: 100 }) };
    if (url.includes('frankfurter')) {
      if (frank === 'offline') throw new TypeError('Failed to fetch');
      return frank ? { ok: true, json: async () => ({ base: 'USD', date: '2026-11-13', rates: { JPY: frank } }) } : { ok: false, status: 503 };
    }
    if (url.includes('currency-api')) return cur ? { ok: true, json: async () => ({ date: '2026-11-14', usd: { jpy: cur } }) } : { ok: false, status: 404 };
    return { ok: true, json: async () => ({ version: 'v6', results: { X101: 1800 }, errors: ['USDJPY'], errorDetails: { USDJPY: 'SBI_HISTORY(HTTP404)' } }) };
  };
  // Frankfurter が通信できなければ、currency-api
  const r1 = await PR.fetchPrices({ assets: a, secrets: { priceUrl: URL_OK, finnhubKey: 'k' }, fetchImpl: fake({ frank: 'offline', cur: 153.25 }) });
  assert.deepEqual(r1.fx, { rate: 153.25, source: 'auto' });
  assert.ok(r1.messages.some((m) => m.includes('currency-api') && m.includes('2026-11-14')));
  // 両方だめなら手入力。理由に GAS・Frankfurter・currency-api が並ぶ
  const r2 = await PR.fetchPrices({ assets: a, secrets: { priceUrl: URL_OK, finnhubKey: 'k' }, fetchImpl: fake({ frank: null, cur: null }) });
  assert.deepEqual(r2.fx, { rate: 147, source: 'manual' });
  const msg = r2.messages.find((m) => m.startsWith('USD/JPY'));
  assert.ok(msg.includes('価格取得のURL:USDJPY を返しませんでした') && msg.includes('Frankfurter:取得できませんでした(HTTP 503)') && msg.includes('currency-api:取得できませんでした(HTTP 404)'), msg);
  // 価格取得の URL が USDJPY を返せば、公開の為替レートには聞かない
  asked.length = 0;
  const r3 = await PR.fetchPrices({
    assets: a,
    secrets: { priceUrl: URL_OK, finnhubKey: 'k' },
    fetchImpl: async (url) => (url.includes('finnhub') ? { ok: true, json: async () => ({ c: 100 }) } : { ok: true, json: async () => ({ version: 'v6', results: { X101: 1800, USDJPY: 150.5 }, errors: [], errorDetails: {} }) }),
  });
  assert.deepEqual(r3.fx, { rate: 150.5, source: 'auto' });
  assert.ok(!asked.some((u) => u.includes('frankfurter') || u.includes('currency-api')));
});

test('価格の自動取得:コードが無い銘柄は取りに行かず、理由を付ける(証券会社の違いは関係しない)', async () => {
  const { a } = fixture();
  A.saveHolding(a, { id: 'nocode', broker: '証券C', account: 'tokutei', type: 'fund', code: '', name: 'ファンドZ', quantity: 1, avgPrice: 10000 });
  const asked = [];
  const report = await PR.fetchPrices({
    assets: a,
    secrets: { priceUrl: URL_OK },
    fetchImpl: async (url) => (asked.push(url), { ok: true, json: async () => ({ version: 'v6', results: { X101: 1800 }, errors: [], errorDetails: {} }) }),
  });
  assert.ok(!decodeURIComponent(asked[0]).includes(',,'));
  assert.match(report.prices[A.priceKey(a.holdings.find((h) => h.id === 'nocode'))].reason, /コードが未入力/);
  assert.ok(report.messages.some((m) => m.includes('ファンドZ')));
  A.applyPriceReport(a, report, NOW);
  assert.match(a.holdings.find((h) => h.id === 'nocode').lastError, /コードが未入力/);
});

test('履歴:同じ日は上書きし、前回更新比は前の日の記録と比べる', () => {
  const { a } = fixture();
  A.saveHistory(a, '2026-11-14');
  a.holdings.find((h) => h.id === 'x').price = 2000;
  A.saveHistory(a, '2026-11-15');
  A.saveHistory(a, '2026-11-15');
  assert.deepEqual(a.history.map((e) => e.date), ['2026-11-14', '2026-11-15']);
  assert.equal(A.previousEntry(a, '2026-11-15').date, '2026-11-14');
  assert.equal(a.history[1].total - a.history[0].total, 20000);
  assert.equal(a.history[1].byBroker['証券A'] - a.history[0].byBroker['証券A'], 20000);
});

test('配当カレンダー:税引後(課税口座・NISA・米国の源泉税)と優待の権利確定・到着', () => {
  const { a } = fixture();
  const set = (id, dividend, benefit) => Object.assign(a.holdings.find((h) => h.id === id), { dividend: { perShare: dividend[0], months: dividend[1], memo: '' }, benefit });
  set('x', [30, [6, 12]], { content: 'カタログ', minShares: 100, recordMonths: [3], arriveMonths: [6] });
  set('m', [100, [12]], { content: '', minShares: null, recordMonths: [], arriveMonths: [] });
  set('p', [0.5, [3]], { content: '', minShares: null, recordMonths: [], arriveMonths: [] });
  set('y', [0, []], { content: '優待券', minShares: 200, recordMonths: [9], arriveMonths: [12] });
  const cal = A.dividendCalendar(a);
  const jun = cal.months[5];
  assert.equal(jun.dividends[0].gross, 3000);
  assert.equal(jun.dividends[0].net, Math.round(3000 * (1 - A.DEFAULT_TAX)));
  assert.equal(cal.months[11].dividends.find((x) => x.id === 'm').net, 1235); // NISA は税なし
  assert.equal(cal.months[2].dividends[0].net, Math.round(750 * 0.9 * (1 - A.DEFAULT_TAX))); // 米国株
  assert.equal(cal.months[2].records[0].content, 'カタログ');
  assert.equal(cal.months[8].records[0].eligible, false);
  assert.equal(cal.months[8].records[0].short, 100);
  assert.equal(cal.annual.net, cal.months.reduce((t, m) => t + m.net, 0));
});

test('月末記録への反映:口座区分ごと/証券会社ごとに、対応する項目へ合計を書き込む', () => {
  const { d, a } = fixture();
  const main = M.addItem(d.monthly, 'cat_invest', '架空証券 特定');
  const nisa = M.addItem(d.monthly, 'cat_invest', '架空証券 NISA');
  a.settings.reflect = { groupBy: 'account', map: { tokutei: main.id, ippan: main.id, nisa_new: nisa.id, nisa_old: nisa.id }, manualMap: { pt: nisa.id } };
  const plan = A.reflectPlan(d, '2026-11');
  const to = (id) => plan.rows.find((r) => r.itemId === id).to;
  assert.equal(to(main.id), 180000 + 190000 + 210000); // 一般の「価格なし」は入らない
  assert.equal(to(nisa.id), 197530 + 120000 + 52300);
  assert.equal(plan.missing, 1);
  assert.equal(A.reflectToMonthly(d, '2026-11', '2026-11-30'), 2);
  assert.equal(M.getValue(d.monthly, '2026-11', main.id), 580000);
  assert.equal(M.isConfirmed(d.monthly, '2026-11', nisa.id), true);
  // 証券会社ごと
  a.settings.reflect = { groupBy: 'broker', map: { 証券A: main.id }, manualMap: {} };
  const p2 = A.reflectPlan(d, '2026-11');
  assert.equal(p2.rows[0].to, 180000 + 190000 + 197530);
  assert.deepEqual(p2.unmapped, ['証券B']);
});

test('反映先の項目を月末記録で消すと、対応が外れる', () => {
  const { d, a } = fixture();
  const item = M.addItem(d.monthly, 'cat_invest', '架空証券');
  a.settings.reflect.map = { 証券A: item.id };
  M.deleteItem(d.monthly, item.id);
  A.finalize(d);
  assert.deepEqual(a.settings.reflect.map, {});
});

test('価格取得の URL とキーは別の場所に保存し、書き出しには既定で含めない', () => {
  store.load();
  store.replaceAll(store.createEmpty(NOW), 'テスト');
  secrets.set({ priceUrl: URL_OK, finnhubKey: 'dummy-key' });
  assert.equal(secrets.has(), true);
  const plain = JSON.parse(store.exportJSON());
  assert.equal(plain.secrets, undefined);
  assert.ok(!JSON.stringify(plain).includes('dummy-key'));
  const withSecrets = JSON.parse(store.exportJSON({ secrets: secrets.get() }));
  assert.equal(withSecrets.secrets.finnhubKey, 'dummy-key');
  assert.equal(store.prepare(withSecrets).ok, true); // 読み込みにも支障なし
  secrets.set({ finnhubKey: '' });
  assert.deepEqual(secrets.get(), { priceUrl: URL_OK });
  secrets.clear();
  assert.equal(secrets.has(), false);
});

test('旧・資産管理アプリのバックアップ(架空)を変換する:NISA は選び直し、投信の単位は lastTotal から推測', () => {
  const legacy = {
    holdings: [
      { id: 1, broker: '証券A', accountType: '特定', type: 'JP', code: 'X101', name: '銘柄X', quantity: '100', avgPrice: '1500' },
      { id: 2, broker: '証券A', accountType: 'NISA', type: 'FUND', code: 'XFUND001', name: 'ファンドM', quantity: 123456, avgPrice: 15000 },
      { id: 3, broker: '', accountType: '謎', type: 'US', code: 'XUS', name: '米国銘柄P', quantity: 10, avgPrice: 140 },
      { id: 4, broker: '証券B', accountType: '一般', type: 'ETF', code: 'X300', name: '不明な種別', quantity: 5, avgPrice: 100 },
      { id: 5, broker: '証券B', accountType: '特定', type: 'JP', code: 'X400', name: '数量なし', quantity: 'abc', avgPrice: 100 },
    ],
    history: [{ date: '2026/9/1', value: 1000000 }, { date: '2026/10/1', value: '1050000' }, { date: 'いつか', value: 1 }],
    prices: { X101: 1800, XFUND001: 16000, XUS: 150 },
    lastTotal: 180000 + 197530,
  };
  const parsed = L.parse(JSON.stringify(legacy));
  assert.equal(parsed.ok, true);
  const info = L.analyze(parsed.obj);
  assert.equal(info.fundGuess, 'raw'); // 1万で割ると lastTotal に近い
  assert.equal(info.nisa, 1);
  const base = store.createEmpty(NOW);
  A.saveManual(base.assets, { id: 'keep', name: '残る手入力', category: 'cash', value: 1000, cost: 1000 });
  const { data, report } = L.convert(parsed.obj, base, { fundUnit: info.fundGuess, usAvg: 'usd', fxRate: 150 });
  const h = (id) => data.assets.holdings.find((x) => x.id === id);
  assert.equal(data.assets.holdings.length, 4);
  assert.equal(h('hld_2').quantity, 12.3456);
  assert.equal(h('hld_2').account, 'nisa_new');
  assert.equal(h('hld_2').nisaUnsure, true);
  assert.equal(h('hld_3').avgPrice, 21000); // 140 ドル × 150
  assert.equal(h('hld_3').priceUsd, 150);
  assert.equal(h('hld_3').account, 'tokutei');
  assert.equal(h('hld_1').price, 1800);
  assert.equal(h('hld_1').priceSource, 'import');
  assert.deepEqual(data.assets.history.map((e) => [e.date, e.total]), [['2026-09-01', 1000000], ['2026-10-01', 1050000]]);
  assert.equal(data.assets.manual[0].id, 'keep'); // 手入力の資産は残る
  for (const word of ['謎', 'ETF', 'abc', 'いつか']) assert.ok(report.issues.some((t) => t.includes(word)), word);
  assert.equal(store.prepare(data).ok, true);
  // 選び直し
  A.setNisaAccount(data.assets, 'hld_2', 'nisa_old');
  assert.deepEqual([h('hld_2').account, h('hld_2').nisaUnsure], ['nisa_old', false]);
});

test('旧形式ではないテキストは読み込まない', () => {
  assert.equal(L.parse('not json').ok, false);
  assert.equal(L.parse('{"foo":1}').ok, false);
  assert.equal(L.parse(JSON.stringify({ holdings: JSON.stringify([]) })).ok, true);
});

test('サンプル:資産管理も入っていて、集計が一致する', () => {
  const d = store.prepare(sample.build(NOW)).data;
  const a = d.assets;
  assert.ok(a.holdings.length >= 5);
  assert.ok(a.manual.length >= 3);
  const s = A.summary(a);
  assert.equal(s.missing, 1); // 米国銘柄Q はわざと価格なし
  assert.equal(sumOf(s.byBroker), s.total);
  assert.ok(A.reflectPlan(d, '2026-11').rows.length >= 1);
  for (const h of a.holdings) assert.ok(!/^\d{4}$/.test(h.code), '実在しうる 4 桁コードは使わない');
});

// ---- 総資産の履歴を直す・削除・元に戻す(架空の金額) ----

function histAssets(entries) {
  const a = A.create();
  a.history = entries.map(([date, total, missing = 0]) => ({ date, total, gain: null, byBroker: {}, missing }));
  return a;
}

test('履歴:v9 のデータを開くと、今の履歴はそのままで「削除・修正前の履歴」が空で入る', () => {
  const v9 = store.createEmpty(NOW);
  v9.schemaVersion = 9;
  v9.assets.history = [{ date: '2026-11-01', total: 1000000, gain: 10000, byBroker: { 証券A: 1000000 }, missing: 0 }];
  delete v9.assets.historyTrash;
  const res = store.prepare(JSON.parse(JSON.stringify(v9)));
  assert.equal(res.ok, true);
  assert.equal(res.data.schemaVersion, store.SCHEMA_VERSION);
  assert.deepEqual(res.data.assets.history, v9.assets.history);
  assert.deepEqual(res.data.assets.historyTrash, []);
});

test('履歴を直す:金額を直すと「手で修正」の印が付き、直す前は控えに残る。控えから元に戻せる', () => {
  const a = histAssets([
    ['2026-11-01', 1000000],
    ['2026-11-02', 300000],
    ['2026-11-03', 1010000],
  ]);
  const r = A.editHistory(a, '2026-11-02', { date: '2026-11-02', total: 1005000 }, NOW);
  assert.deepEqual(r, { ok: true, changed: true, date: '2026-11-02' });
  assert.equal(a.history[1].total, 1005000);
  assert.equal(a.history[1].edited, true);
  assert.equal(a.historyTrash.length, 1);
  assert.equal(a.historyTrash[0].reason, 'edited');
  assert.equal(a.historyTrash[0].entry.total, 300000);

  // 同じ日の記録があるので、置き換えるかどうかを聞く(そのままでは戻さない)
  const tid = a.historyTrash[0].id;
  const c = A.restoreHistory(a, tid, {}, NOW);
  assert.equal(c.ok, false);
  assert.equal(c.conflict.total, 1005000);
  assert.equal(a.history[1].total, 1005000);
  // 置き換える:直した記録は「置き換え前」として残る
  const ok = A.restoreHistory(a, tid, { replace: true }, NOW);
  assert.deepEqual(ok, { ok: true, date: '2026-11-02', replaced: true });
  assert.equal(a.history[1].total, 300000);
  assert.equal(a.history[1].edited, undefined);
  assert.equal(a.historyTrash.length, 1);
  assert.equal(a.historyTrash[0].reason, 'replaced');
  assert.equal(a.historyTrash[0].entry.total, 1005000);
});

test('履歴を直す:日付の変更・同じ日付の重なり・先の日付・負の金額・変更なし', () => {
  const a = histAssets([
    ['2026-11-01', 1000000],
    ['2026-11-05', 1020000],
  ]);
  const moved = A.editHistory(a, '2026-11-05', { date: '2026-11-03', total: 1020000 }, NOW);
  assert.equal(moved.ok, true);
  assert.deepEqual(a.history.map((e) => e.date), ['2026-11-01', '2026-11-03']);
  const dup = A.editHistory(a, '2026-11-03', { date: '2026-11-01', total: 1 }, NOW);
  assert.equal(dup.ok, false);
  assert.match(dup.error, /すでにあります/);
  assert.equal(A.editHistory(a, '2026-11-03', { date: '2026-11-16', total: 1 }, NOW).ok, false); // NOW は 11/15
  assert.equal(A.editHistory(a, '2026-11-03', { date: '2026-11-03', total: -1 }, NOW).ok, false);
  assert.equal(A.editHistory(a, '2026-11-03', { date: '2026-13-01', total: 1 }, NOW).ok, false);
  assert.equal(A.editHistory(a, '2026-10-01', { date: '2026-10-01', total: 1 }, NOW).ok, false);
  const before = a.historyTrash.length;
  assert.deepEqual(A.editHistory(a, '2026-11-01', { date: '2026-11-01', total: 1000000 }, NOW), { ok: true, changed: false, date: '2026-11-01' });
  assert.equal(a.historyTrash.length, before);
});

test('履歴の削除:控えへ移り、元に戻すと日付順の位置に戻る。同じ日に新しい記録があれば置き換えを聞く', () => {
  const a = histAssets([
    ['2026-11-01', 1000000],
    ['2026-11-02', 50],
    ['2026-11-03', 1010000],
  ]);
  assert.equal(A.removeHistory(a, ['2026-11-02'], NOW), 1);
  assert.deepEqual(a.history.map((e) => e.date), ['2026-11-01', '2026-11-03']);
  assert.equal(a.historyTrash[0].reason, 'deleted');
  assert.equal(a.historyTrash[0].at, NOW.toISOString());
  const back = A.restoreHistory(a, a.historyTrash[0].id, {}, NOW);
  assert.deepEqual(back, { ok: true, date: '2026-11-02', replaced: false });
  assert.deepEqual(a.history.map((e) => e.date), ['2026-11-01', '2026-11-02', '2026-11-03']);
  assert.equal(a.historyTrash.length, 0);

  // 削除のあと、同じ日に「価格を更新」で新しい記録ができた場合
  const { a: fa } = fixture();
  A.saveHistory(fa, '2026-11-15');
  A.removeHistory(fa, '2026-11-15', NOW);
  A.saveHistory(fa, '2026-11-15');
  const tid = fa.historyTrash[0].id;
  assert.equal(A.restoreHistory(fa, tid, {}, NOW).ok, false);
  assert.equal(A.restoreHistory(fa, tid, { replace: true }, NOW).replaced, true);
  assert.equal(fa.history.length, 1);
  assert.equal(fa.historyTrash.length, 1);
  assert.equal(A.restoreHistory(fa, 'no-such-id', {}, NOW).ok, false);
});

test('削除・修正前の履歴:1 件ずつ・全部を完全に消せる。最大件数を超えたら古いものから消える', () => {
  const a = histAssets([
    ['2026-11-01', 1000],
    ['2026-11-02', 2000],
    ['2026-11-03', 3000],
  ]);
  A.removeHistory(a, ['2026-11-01', '2026-11-02', '2026-11-03'], NOW);
  assert.equal(a.historyTrash.length, 3);
  assert.equal(A.purgeTrash(a, a.historyTrash[0].id), 1);
  assert.equal(a.historyTrash.length, 2);
  assert.equal(A.purgeTrash(a), 2);
  assert.deepEqual(a.historyTrash, []);

  const many = histAssets(Array.from({ length: A.TRASH_MAX + 5 }, (_, i) => [`2026-0${1 + Math.floor(i / 28) % 9}-${String((i % 28) + 1).padStart(2, '0')}`, 1000 + i]));
  const dates = many.history.map((e) => e.date);
  A.removeHistory(many, dates, NOW);
  assert.equal(many.historyTrash.length, A.TRASH_MAX);
});

test('要確認の目印:前後より飛び出た記録・急な増減・価格未取得が増えた記録・0 円(戻っただけの記録には付けない)', () => {
  const a = histAssets([
    ['2026-11-01', 1000000],
    ['2026-11-02', 1010000],
    ['2026-11-03', 400000], // 落ち込み(前後より低い)
    ['2026-11-04', 1020000], // 元に戻っただけ(目印なし)
    ['2026-11-05', 1500000], // 前回から急に増加(次がないので「飛び出た」ではない)
    ['2026-11-06', 1490000, 2], // 価格未取得が前回より多い
    ['2026-11-07', 0],
  ]);
  const f = A.historyFlags(a);
  assert.deepEqual([...f.keys()], ['2026-11-03', '2026-11-05', '2026-11-06', '2026-11-07']);
  assert.equal(f.get('2026-11-03')[0].id, 'spike');
  assert.match(f.get('2026-11-03')[0].text, /前後より低い/);
  assert.equal(f.get('2026-11-05')[0].id, 'jump');
  assert.equal(f.get('2026-11-06')[0].id, 'missing');
  assert.equal(f.get('2026-11-07')[0].id, 'zero');
  // ふだんの増減(数 % )には付けない
  assert.equal(A.historyFlags(histAssets([['2026-11-01', 1000000], ['2026-11-02', 1030000], ['2026-11-03', 990000]])).size, 0);
});

test('履歴:読み込み時に「手で修正」の印を残し、形のおかしい控えは捨てる', () => {
  const a = A.normalize({
    history: [{ date: '2026-11-01', total: 1000, edited: true }, { date: '2026-11-02', total: 2000, edited: 'yes' }],
    historyTrash: [{ id: 't1', reason: 'edited', at: NOW.toISOString(), entry: { date: '2026-11-01', total: 900 } }, { id: 't2', entry: { date: 'bad' } }, { id: 't3' }, { id: 't1', entry: { date: '2026-11-03', total: 1 } }],
  });
  assert.equal(a.history[0].edited, true);
  assert.equal('edited' in a.history[1], false);
  assert.equal(a.historyTrash.length, 1);
  assert.equal(a.historyTrash[0].entry.total, 900);
});

// ---- その日のコメント・開いたときの自動更新(架空のデータ) ----

test('コメント:書く・前後の空白を取る・最大 200 文字・空で消す。記録の無い日には書けない', () => {
  const a = histAssets([['2026-11-01', 1000000]]);
  assert.equal(A.setHistoryMemo(a, '2026-11-01', '  銘柄Xを100株買った\n相場が下がった  '), true);
  assert.equal(a.history[0].memo, '銘柄Xを100株買った\n相場が下がった');
  A.setHistoryMemo(a, '2026-11-01', 'あ'.repeat(A.HISTORY_MEMO_MAX + 50));
  assert.equal(a.history[0].memo.length, A.HISTORY_MEMO_MAX);
  A.setHistoryMemo(a, '2026-11-01', '   ');
  assert.equal('memo' in a.history[0], false);
  assert.equal(A.setHistoryMemo(a, '2026-10-01', 'x'), false);
  // 読み込み時も同じ(文字列以外・空は捨てる)
  const n = A.normalize({ history: [{ date: '2026-11-01', total: 1, memo: ' メモ ' }, { date: '2026-11-02', total: 1, memo: 123 }, { date: '2026-11-03', total: 1, memo: '' }] });
  assert.deepEqual(n.history.map((e) => e.memo), ['メモ', undefined, undefined]);
});

test('コメント:同じ日に価格を更新し直しても引き継ぐ。手で直した記録を上書きするときは「置き換え前」に残す', () => {
  const { a } = fixture();
  const T = new Date(2026, 10, 15, 9, 0);
  A.saveHistory(a, '2026-11-15', T);
  A.setHistoryMemo(a, '2026-11-15', '銘柄Xを買い増し');
  A.editHistory(a, '2026-11-15', { date: '2026-11-15', total: 123456 }, T);
  assert.equal(a.history[0].memo, '銘柄Xを買い増し');
  const before = a.historyTrash.length;
  A.saveHistory(a, '2026-11-15', T);
  assert.equal(a.history.length, 1);
  assert.equal(a.history[0].memo, '銘柄Xを買い増し');
  assert.equal(a.history[0].edited, undefined);
  assert.notEqual(a.history[0].total, 123456);
  assert.equal(a.historyTrash.length, before + 1);
  assert.equal(a.historyTrash[0].reason, 'replaced');
  assert.equal(a.historyTrash[0].entry.total, 123456);
  assert.equal(a.historyTrash[0].entry.memo, '銘柄Xを買い増し');
  // 手で直していない記録の上書きは、控えを作らない
  A.saveHistory(a, '2026-11-15', T);
  assert.equal(a.historyTrash.length, before + 1);
  // 削除して戻しても、コメントは残る
  A.removeHistory(a, '2026-11-15', T);
  A.restoreHistory(a, a.historyTrash[0].id, {}, T);
  assert.equal(a.history[0].memo, '銘柄Xを買い増し');
});

test('コメント:v10 のデータを開いても、履歴とコメントはそのまま', () => {
  const v10 = store.createEmpty(NOW);
  v10.schemaVersion = 10;
  v10.assets.history = [{ date: '2026-11-01', total: 1000000, gain: null, byBroker: {}, missing: 0, memo: '架空のメモ' }];
  const res = store.prepare(JSON.parse(JSON.stringify(v10)));
  assert.equal(res.ok, true);
  assert.equal(res.data.schemaVersion, store.SCHEMA_VERSION);
  assert.equal(res.data.assets.history[0].memo, '架空のメモ');
});

test('開いたときの自動更新:取りに行ける銘柄があり、前回から 30 分以上たっているときだけ', () => {
  const T = new Date(2026, 10, 15, 12, 0);
  const ago = (min) => new Date(T.getTime() - min * 60000).toISOString();
  const a = A.create();
  const sec = { priceUrl: URL_OK };
  assert.equal(A.autoUpdateDue(a, { secrets: sec, now: T }), false); // 銘柄なし
  A.saveHolding(a, { broker: '証券A', account: 'tokutei', type: 'jp', code: 'X101', name: '銘柄X', quantity: 1, avgPrice: 1 });
  assert.equal(A.autoUpdateDue(a, { secrets: {}, now: T }), false); // URL なし
  assert.equal(A.autoUpdateDue(a, { secrets: sec, now: T }), true); // 一度も更新していない
  a.lastUpdateAt = ago(10);
  assert.equal(A.autoUpdateDue(a, { secrets: sec, now: T }), false);
  a.lastUpdateAt = ago(A.AUTO_MIN_MINUTES);
  assert.equal(A.autoUpdateDue(a, { secrets: sec, now: T }), true);
  // 米国株だけなら Finnhub のキーが要る
  const u = A.create();
  A.saveHolding(u, { broker: '証券B', account: 'tokutei', type: 'us', code: 'XUS', name: '米国銘柄', quantity: 1, avgPrice: 1 });
  assert.equal(A.autoUpdateDue(u, { secrets: sec, now: T }), false);
  assert.equal(A.autoUpdateDue(u, { secrets: { finnhubKey: 'dummy' }, now: T }), true);
});
