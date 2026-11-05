// 株式分割・配当の自動確認のテスト(画面は対象外)。使うのは架空のデータだけ。
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
require('../js/features/future/model.js');
require('../js/core/secrets.js');
require('../js/features/monthly/model.js');
require('../js/features/payments/model.js');
require('../js/features/assets/model.js');
require('../js/features/assets/events.js');
require('../js/features/assets/prices.js');
require('../js/features/inventory/model.js');
require('../js/features/sidejob/model.js');

const { util: U, store, assetsModel: A, assetEvents: EV, assetPrices: PR } = globalThis.MT;

const DAY1 = new Date(2026, 10, 10, 9, 0); // 2026-11-10(最初の確認)
const DAY2 = new Date(2026, 10, 20, 9, 0); // 2026-11-20
const URL_OK = 'https://example.invalid/exec'; // 架空の URL(実在しない)

function fixture() {
  const a = A.create();
  A.saveHolding(a, { id: 'x', broker: '証券A', account: 'tokutei', type: 'jp', code: 'X101', name: '銘柄X', quantity: 100, avgPrice: 1500, price: 1800, dividend: { perShare: 50, months: [6, 12] }, benefit: { content: '優待品', minShares: 100 } });
  A.saveHolding(a, { id: 'y', broker: '証券A', account: 'nisa_new', type: 'jp', code: 'X102', name: '銘柄Y', quantity: 200, avgPrice: 900, price: 1000 });
  A.saveHolding(a, { id: 'u', broker: '証券B', account: 'tokutei', type: 'us', code: 'XUS', name: '米国銘柄U', quantity: 10, avgPrice: 20000, priceUsd: 140 });
  A.saveHolding(a, { id: 'f', broker: '証券B', account: 'nisa_new', type: 'fund', code: 'XFUND001', name: 'ファンドF', quantity: 5, avgPrice: 10000, price: 12000 });
  a.fx = { rate: 150, source: 'manual', at: null };
  return a;
}
const rep = (events) => ({ events, errors: {}, unsupported: false, error: null });

test('問い合わせのコード:国内株はそのまま、米国株は US: を付け、投資信託は問い合わせない', () => {
  const a = fixture();
  assert.deepEqual(a.holdings.map(EV.eventCode), ['X101', 'X102', 'US:XUS', null]);
  assert.equal(EV.splitRatio({ numerator: 3, denominator: 1 }), 3);
  assert.equal(EV.splitRatio({ numerator: 1, denominator: 10 }), 0.1);
  assert.equal(EV.splitRatio({ numerator: 1, denominator: 1 }), null);
  assert.equal(EV.splitRatio({ numerator: 0, denominator: 1 }), null);
  assert.equal(EV.ratioText(3), '1株 → 3株');
  assert.equal(EV.ratioText(0.1), '10株 → 1株(併合)');
});

test('確認するとき:URL があり確認できる株があって、前回から 20 時間(対応していなければ 7 日)', () => {
  const a = fixture();
  const sec = { priceUrl: URL_OK };
  assert.equal(EV.eventsDue(a, { secrets: {}, now: DAY1 }), false);
  assert.equal(EV.eventsDue(a, { secrets: sec, now: DAY1 }), true);
  a.eventsCheck.at = new Date(DAY1.getTime() - 3600000).toISOString();
  assert.equal(EV.eventsDue(a, { secrets: sec, now: DAY1 }), false);
  assert.equal(EV.eventsDue(a, { secrets: sec, now: DAY1, force: true }), true);
  a.eventsCheck.at = new Date(DAY1.getTime() - 21 * 3600000).toISOString();
  assert.equal(EV.eventsDue(a, { secrets: sec, now: DAY1 }), true);
  EV.markCheckFailed(a, { unsupported: true }, new Date(DAY1.getTime() - 2 * 86400000));
  assert.equal(EV.eventsDue(a, { secrets: sec, now: DAY1 }), false);
  assert.equal(EV.eventsDue(a, { secrets: sec, now: new Date(DAY1.getTime() + 6 * 86400000) }), true);
  const onlyFund = A.create();
  A.saveHolding(onlyFund, { type: 'fund', code: 'XFUND001', name: 'F', quantity: 1, avgPrice: 1 });
  assert.equal(EV.eventsDue(onlyFund, { secrets: sec, now: DAY1 }), false);
});

test('最初の確認:120 日以内の分割は「確認が必要」(反映しない)。それより前は扱わない。配当が未登録なら提案', () => {
  const a = fixture();
  const created = EV.applyEvents(
    a,
    rep({
      X101: { splits: [{ date: '2026-09-01', numerator: 2, denominator: 1 }, { date: '2025-01-10', numerator: 5, denominator: 1 }], dividends: [{ date: '2026-03-30', amount: 50 }, { date: '2026-09-29', amount: 25 }] },
      X102: { splits: [], dividends: [{ date: '2026-03-30', amount: 20 }, { date: '2026-09-29', amount: 22 }] },
      'US:XUS': { splits: [], dividends: [] },
    }),
    DAY1
  );
  assert.equal(a.holdings[0].quantity, 100); // 反映しない
  const split = created.find((c) => c.kind === 'split');
  assert.equal(split.status, 'pending');
  assert.equal(split.ratio, 2);
  assert.equal(created.filter((c) => c.kind === 'split').length, 1); // 2025 年の分割は扱わない
  // 配当:銘柄X は登録済みなので最初は提案しない。銘柄Y は未登録なので直近の配当から提案
  const div = created.find((c) => c.kind === 'dividend');
  assert.equal(div.holdingId, 'y');
  assert.equal(div.proposal.reason, 'none');
  assert.equal(div.proposal.perShare, 22);
  assert.deepEqual(div.proposal.months, [6, 12]); // 3 月・9 月の権利落ち → 6 月・12 月の支払い(目安)
  assert.equal(a.holdings[0].eventsSince, '2026-11-10');
  assert.equal(EV.attention(a).length, 2);
  // 同じ結果をもう一度受け取っても、二重には作らない
  assert.equal(EV.applyEvents(a, rep({ X101: { splits: [{ date: '2026-09-01', numerator: 2, denominator: 1 }], dividends: [] } }), DAY1).length, 0);
  // 押すと反映する
  assert.equal(EV.applyPendingSplit(a, split.id), true);
  assert.equal(a.holdings[0].quantity, 200);
  assert.equal(a.changes.find((c) => c.id === split.id).status, 'applied');
});

test('確認を始めたあとの分割は自動で反映:数量 = 分割前 × 分割数。単価・株価・1株配当は ÷。評価額と取得額は変わらない', () => {
  const a = fixture();
  EV.applyEvents(a, rep({ X101: { splits: [], dividends: [] }, 'US:XUS': { splits: [], dividends: [] } }), DAY1);
  const before = A.summary(a);
  const created = EV.applyEvents(
    a,
    rep({
      X101: { splits: [{ date: '2026-11-18', numerator: 3, denominator: 1 }], dividends: [] },
      'US:XUS': { splits: [{ date: '2026-11-19', numerator: 4, denominator: 1 }], dividends: [] },
    }),
    DAY2
  );
  assert.equal(created.length, 2);
  const x = a.holdings[0];
  assert.equal(x.quantity, 300);
  assert.equal(x.avgPrice, 500);
  assert.equal(x.price, 600);
  assert.equal(x.dividend.perShare, 16.6667);
  const u = a.holdings[2];
  assert.equal(u.quantity, 40);
  assert.equal(u.priceUsd, 35);
  const after = A.summary(a);
  assert.equal(after.total, before.total);
  assert.equal(after.cost, before.cost);
  const c = created[0];
  assert.equal(c.status, 'applied');
  assert.equal(c.seen, false);
  assert.deepEqual([c.before.quantity, c.after.quantity], [100, 300]);
  assert.equal(EV.attentionByHolding(a).get('x').length, 1);
  assert.equal(x.eventsSince, '2026-11-18');
  // 二度目は反映しない
  assert.equal(EV.applyEvents(a, rep({ X101: { splits: [{ date: '2026-11-18', numerator: 3, denominator: 1 }], dividends: [] } }), DAY2).length, 0);
  assert.equal(x.quantity, 300);
  // 確認したら色を消す
  assert.equal(EV.markSeen(a), 2);
  assert.equal(EV.attention(a).length, 0);
});

test('確認した日と同じ日付の分割が、あとから載っても反映する(一度だけ)', () => {
  const a = fixture();
  EV.applyEvents(a, rep({ X101: { splits: [], dividends: [] } }), DAY1); // eventsSince = 11/10
  const created = EV.applyEvents(a, rep({ X101: { splits: [{ date: '2026-11-10', numerator: 2, denominator: 1 }], dividends: [] } }), DAY2);
  assert.equal(created.length, 1);
  assert.equal(a.holdings[0].quantity, 200);
});

test('配当:新しい配当が登録と違えば提案(直して反映・反映しない)。同じなら何もしない', () => {
  const a = fixture();
  EV.applyEvents(a, rep({ X101: { splits: [], dividends: [{ date: '2026-03-30', amount: 50 }] } }), DAY1);
  assert.equal(EV.applyEvents(a, rep({ X101: { splits: [], dividends: [{ date: '2026-11-17', amount: 50 }] } }), DAY2).length, 0);
  const a2 = fixture();
  EV.applyEvents(a2, rep({ X101: { splits: [], dividends: [] } }), DAY1);
  const [c] = EV.applyEvents(a2, rep({ X101: { splits: [], dividends: [{ date: '2026-03-30', amount: 50 }, { date: '2026-11-17', amount: 55 }] } }), DAY2);
  assert.equal(c.kind, 'dividend');
  assert.equal(c.proposal.reason, 'changed');
  assert.equal(c.proposal.perShare, 55);
  assert.equal(a2.holdings[0].dividend.perShare, 50); // 提案だけ。まだ変えない
  assert.equal(EV.applyDividend(a2, c.id, { perShare: 52.5, months: [12, 6, 6, 13] }), true);
  assert.equal(a2.holdings[0].dividend.perShare, 52.5);
  assert.deepEqual(a2.holdings[0].dividend.months, [6, 12]);
  assert.equal(EV.applyDividend(a2, c.id, { perShare: 1, months: [] }), false); // 二度目はできない
  // 元に戻す
  assert.equal(EV.undo(a2, c.id), true);
  assert.equal(a2.holdings[0].dividend.perShare, 50);
  // 反映しない
  const a3 = fixture();
  EV.applyEvents(a3, rep({ X101: { splits: [], dividends: [] } }), DAY1);
  const [c3] = EV.applyEvents(a3, rep({ X101: { splits: [], dividends: [{ date: '2026-11-17', amount: 60 }] } }), DAY2);
  assert.equal(EV.dismiss(a3, c3.id), true);
  assert.equal(a3.changes[0].status, 'dismissed');
  assert.equal(a3.holdings[0].dividend.perShare, 50);
  assert.equal(EV.attention(a3).length, 0);
});

test('支払月の目安:国内株は権利落ちの 3 か月後、米国株は 1 か月後', () => {
  assert.deepEqual(EV.payMonths('jp', [{ date: '2026-03-30' }, { date: '2026-09-29' }]), [6, 12]);
  assert.deepEqual(EV.payMonths('us', [{ date: '2026-02-10' }, { date: '2026-05-10' }, { date: '2026-08-10' }, { date: '2026-11-10' }]), [3, 6, 9, 12]);
  assert.deepEqual(EV.payMonths('jp', [{ date: '2026-12-28' }]), [3]);
});

test('分割を元に戻す:数量・単価・1株配当を戻す。反映後に価格を更新していれば、株価はそのまま', () => {
  const a = fixture();
  EV.applyEvents(a, rep({ X101: { splits: [], dividends: [] }, X102: { splits: [], dividends: [] } }), DAY1);
  const [c] = EV.applyEvents(a, rep({ X101: { splits: [{ date: '2026-11-18', numerator: 3, denominator: 1 }], dividends: [] } }), DAY2);
  assert.equal(EV.undo(a, c.id), true);
  assert.deepEqual([a.holdings[0].quantity, a.holdings[0].avgPrice, a.holdings[0].price, a.holdings[0].dividend.perShare], [100, 1500, 1800, 50]);
  assert.equal(a.changes[0].status, 'undone');
  // 反映後に新しい株価が入っていた場合
  const [c2] = EV.applyEvents(a, rep({ X102: { splits: [{ date: '2026-11-19', numerator: 2, denominator: 1 }], dividends: [] } }), DAY2);
  a.holdings[1].price = 510; // 価格の更新(分割後の株価)
  EV.undo(a, c2.id);
  assert.deepEqual([a.holdings[1].quantity, a.holdings[1].avgPrice, a.holdings[1].price], [200, 900, 510]);
});

test('手で分割・併合を反映できる(元に戻せる)。優待の株数の条件に足りないかを見る', () => {
  const a = fixture();
  const c = EV.manualSplit(a, 'x', 0.1, DAY1);
  assert.equal(c.source, 'manual');
  assert.equal(c.seen, true);
  assert.equal(a.holdings[0].quantity, 10);
  assert.equal(a.holdings[0].avgPrice, 15000);
  assert.equal(EV.benefitShort(a.holdings[0]), true); // 優待は 100 株以上
  assert.equal(EV.manualSplit(a, 'x', 1, DAY1), null);
  assert.equal(EV.manualSplit(a, 'none', 2, DAY1), null);
  EV.undo(a, c.id);
  assert.equal(a.holdings[0].quantity, 100);
  assert.equal(EV.benefitShort(a.holdings[0]), false);
});

test('別の銘柄に変えたら確認を最初から。v11 のデータを開いても保有はそのまま', () => {
  const a = fixture();
  EV.applyEvents(a, rep({ X101: { splits: [], dividends: [] } }), DAY1);
  assert.equal(a.holdings[0].eventsSince, '2026-11-10');
  A.saveHolding(a, { ...a.holdings[0], code: 'X109' });
  assert.equal(a.holdings[0].eventsSince, null);

  const v11 = store.createEmpty(DAY1);
  v11.schemaVersion = 11;
  v11.assets.holdings = [{ id: 'x', broker: '証券A', account: 'tokutei', type: 'jp', code: 'X101', name: '銘柄X', quantity: 100, avgPrice: 1500 }];
  delete v11.assets.changes;
  delete v11.assets.eventsCheck;
  const res = store.prepare(JSON.parse(JSON.stringify(v11)));
  assert.equal(res.ok, true);
  assert.equal(res.data.schemaVersion, store.SCHEMA_VERSION);
  assert.equal(res.data.assets.holdings[0].quantity, 100);
  assert.equal(res.data.assets.holdings[0].eventsSince, null);
  assert.deepEqual(res.data.assets.changes, []);
  assert.deepEqual(res.data.assets.eventsCheck, { at: null, unsupportedAt: null, error: null });
});

test('問い合わせ:URL に events=1 とコードを付け、返事を読む。対応していない・通信できないとき', async () => {
  const a = fixture();
  let asked = '';
  const ok = await PR.fetchEvents({
    assets: a,
    secrets: { priceUrl: URL_OK },
    fetchImpl: async (url) => {
      asked = url;
      return {
        ok: true,
        json: async () => ({
          version: 'events-v1',
          events: { X101: { splits: [{ date: '2026-11-18', numerator: 3, denominator: 1 }, { date: 'bad', numerator: 1, denominator: 1 }], dividends: [{ date: '2026-09-29', amount: '25' }, { date: '2026-03-30', amount: -1 }] } },
          errors: { X102: 'HTTP404' },
        }),
      };
    },
  });
  const u = new URL(asked);
  assert.equal(u.searchParams.get('events'), '1');
  assert.deepEqual(u.searchParams.get('codes').split(','), ['X101', 'X102', 'US:XUS']);
  assert.deepEqual(ok.events.X101.splits, [{ date: '2026-11-18', numerator: 3, denominator: 1 }]);
  assert.deepEqual(ok.events.X101.dividends, [{ date: '2026-09-29', amount: 25 }]);
  assert.equal(ok.errors.X102, 'HTTP404');
  assert.equal(ok.unsupported, false);

  const old = await PR.fetchEvents({ assets: a, secrets: { priceUrl: URL_OK }, fetchImpl: async () => ({ ok: true, json: async () => ({ version: 'v6', results: {} }) }) });
  assert.equal(old.unsupported, true);
  const down = await PR.fetchEvents({ assets: a, secrets: { priceUrl: URL_OK }, fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
  assert.equal(down.error, '通信できませんでした');
  const none = await PR.fetchEvents({ assets: a, secrets: {}, fetchImpl: async () => { throw new Error('呼ばれないはず'); } });
  assert.deepEqual(none.events, {});
});
