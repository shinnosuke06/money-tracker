// 開示・決算(js/features/assets/ir-model.js)のテスト。架空のデータ(実在しない形のコード 9X1A など)だけを使う。
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
require('../js/features/assets/ir-model.js');
require('../js/features/assets/model.js');
require('../js/features/inventory/model.js');
require('../js/features/sidejob/model.js');

const { store, assetsModel: A, assetIr: IR, secrets } = globalThis.MT;

const NOW = new Date('2026-11-16T03:00:00Z'); // 日本時間 11/16 12:00
const TODAY = '2026-11-16';

function fixture() {
  const a = A.create();
  A.saveHolding(a, { id: 'h1', broker: '証券A', account: 'tokutei', type: 'jp', code: '9X1A', name: '銘柄A', quantity: 100, avgPrice: 1000 });
  A.saveHolding(a, { id: 'h2', broker: '証券B', account: 'nisa_new', type: 'jp', code: '9x1a', name: '銘柄A', quantity: 100, avgPrice: 1000 }); // 同じ銘柄を別の口座で
  A.saveHolding(a, { id: 'h3', broker: '証券A', account: 'tokutei', type: 'jp', code: '9X2B', name: '銘柄B', quantity: 200, avgPrice: 500 });
  A.saveHolding(a, { id: 'u', broker: '証券B', account: 'tokutei', type: 'us', code: 'XUS', name: '米国銘柄', quantity: 1, avgPrice: 1 });
  A.saveHolding(a, { id: 'f', broker: '証券B', account: 'nisa_new', type: 'fund', code: 'XFUND001', name: 'ファンド', quantity: 1, avgPrice: 1 });
  return a;
}

const item = (id, code, at, tags = []) => ({ id, code, name: '', at, title: `開示${id}`, url: '', status: 'done', tags, head: '', good: [], bad: [], neutral: [] });

test('開示・決算:見る銘柄は保有している国内株(同じ銘柄は 1 つ)+ 気になる銘柄。米国株・投資信託は入らない', () => {
  const a = fixture();
  assert.deepEqual(IR.stocks(a).map((s) => `${s.code}:${s.kind}:${s.holdings.length}`), ['9X1A:hold:2', '9X2B:hold:1']);
  assert.equal(IR.addWatch(a, '９ｙ３ｃ', '気になるC', NOW).ok, true);
  assert.equal(IR.addWatch(a, '9X1A', '', NOW).error, 'その銘柄は、もう見ています');
  assert.match(IR.addWatch(a, 'ABC', '', NOW).error, /4 けた/);
  assert.equal(IR.codesParam(a), '9X1A,9X2B,9Y3C');
  // 気になる銘柄を保有に入れたら、保有として数える(二重にならない)
  A.saveHolding(a, { id: 'h4', broker: '証券A', account: 'tokutei', type: 'jp', code: '9Y3C', name: '銘柄C', quantity: 1, avgPrice: 1 });
  assert.deepEqual(IR.stocks(a).map((s) => `${s.code}:${s.kind}`), ['9X1A:hold', '9X2B:hold', '9Y3C:hold']);
  assert.equal(IR.removeWatch(a, '9Y3C'), true);
  assert.equal(IR.normCode('9X1A0'), '9X1A');
});

test('開示・決算:見張り始める前の開示は「見た」扱い。それより後の開示は、見るまで赤', () => {
  const a = fixture();
  const data = { now: NOW.toISOString(), items: [item(3, '9X1A', '2026-11-16 15:30', [{ name: '上方修正', dir: 'up' }]), item(2, '9X2B', '2026-11-13 15:00'), item(1, 'XXXX', '2026-11-16 15:00')], earnings: {} };
  assert.equal(IR.applyResponse(a, data, NOW), true); // 初めての銘柄の「見張り始め」を入れる
  assert.equal(IR.applyResponse(a, data, NOW), false);
  assert.deepEqual(IR.items(a, data).map((x) => x.id), [3, 2]); // 見ていない銘柄の開示は除く
  assert.deepEqual(IR.unseen(a, data).map((x) => x.id), [3]); // 11/13 の開示は見張り始める前
  assert.equal(IR.level(a, data, TODAY), 'red');
  assert.equal(IR.markSeen(a, [3, 3, 'x']), 1);
  assert.equal(IR.unseen(a, data).length, 0);
  assert.equal(IR.level(a, data, TODAY), null);
  assert.equal(IR.level(a, null, TODAY), null);
  // 保有から外した銘柄の「見張り始め」は消す
  A.removeHolding(a, 'h3');
  assert.equal(IR.applyResponse(a, data, NOW), true);
  assert.equal('9X2B' in a.ir.since, false);
});

test('開示・決算:2週間以内の決算だけなら黄色、見ていない開示もあれば赤。手で入れた日を優先し、過ぎた日は使わない', () => {
  const a = fixture();
  const data = { now: NOW.toISOString(), items: [], earnings: { '9X1A': { date: '2026-11-30', label: '第2四半期' }, '9X2B': { date: '2026-12-25', label: '本決算' } } };
  IR.applyResponse(a, data, NOW);
  assert.equal(IR.level(a, data, TODAY), 'yellow'); // 11/30 はあと 14 日
  assert.deepEqual(IR.soon(a, data, TODAY).map((x) => x.stock.code), ['9X1A']);
  assert.equal(IR.level(a, data, '2026-11-15'), null); // あと 15 日なら出さない
  IR.setManualEarnings(a, '9X2B', '2026-11-20', '手で');
  assert.deepEqual(IR.soon(a, data, TODAY).map((x) => `${x.stock.code}:${x.earnings.manual}`), ['9X2B:true', '9X1A:false']);
  assert.equal(IR.earningsOf(a, data, '9X2B', '2026-11-21').date, '2026-12-25'); // 手で入れた日が過ぎたら一覧の日
  assert.equal(IR.earningsOf(a, data, '9X1A', '2026-12-01'), null);
  IR.setManualEarnings(a, '9X2B', null);
  assert.equal('9X2B' in a.ir.manualEarnings, false);
  // 見ていない開示もあれば赤
  data.items = [item(5, '9X2B', '2026-11-16 16:00')];
  assert.equal(IR.level(a, data, TODAY), 'red');
});

test('開示・決算:開いたときに受け取るのは、前回から 10 分以上・または見る銘柄が変わったとき', () => {
  const a = fixture();
  const url = 'https://example.invalid/exec';
  assert.equal(IR.fetchDue(a, null, '', NOW), false);
  assert.equal(IR.fetchDue(a, null, url, NOW), true);
  const cache = { fetchedAt: new Date(NOW.getTime() - 5 * 60000).toISOString(), codes: IR.codesParam(a) };
  assert.equal(IR.fetchDue(a, cache, url, NOW), false);
  assert.equal(IR.fetchDue(a, { ...cache, fetchedAt: new Date(NOW.getTime() - 11 * 60000).toISOString() }, url, NOW), true);
  IR.addWatch(a, '9Y3C', '', NOW);
  assert.equal(IR.fetchDue(a, cache, url, NOW), true);
  assert.equal(IR.fetchDue(A.create(), null, url, NOW), false); // 見る銘柄が無い
});

test('開示・決算:問い合わせの URL と返事の確かめ(違う GAS・エラー・通信できない)', async () => {
  let asked = '';
  const ok = await IR.fetchState({ url: 'https://example.invalid/exec', codes: '9X1A,9X2B', refresh: true, fetchImpl: async (u) => { asked = u; return { ok: true, json: async () => ({ version: 'ir-v1', items: [] }) }; } });
  const u = new URL(asked);
  assert.equal(u.searchParams.get('api'), 'refresh');
  assert.equal(u.searchParams.get('codes'), '9X1A,9X2B');
  assert.equal(ok.version, 'ir-v1');
  await assert.rejects(IR.fetchState({ url: 'https://example.invalid/exec', codes: '', fetchImpl: async () => ({ ok: true, json: async () => ({ version: 'v6', results: {} }) }) }), /GAS の返事ではありません/);
  await assert.rejects(IR.fetchState({ url: 'https://example.invalid/exec', codes: '', fetchImpl: async () => ({ ok: true, json: async () => ({ version: 'ir-v1', error: 'api の指定がありません' }) }) }), /api の指定/);
  await assert.rejects(IR.fetchState({ url: 'https://example.invalid/exec', codes: '', fetchImpl: async () => { throw new TypeError('Failed to fetch'); } }), /通信できませんでした/);
  const it = await IR.summarize({ url: 'https://example.invalid/exec', id: 7, fetchImpl: async (u2) => ({ ok: true, json: async () => ({ version: 'ir-v1', item: { id: Number(new URL(u2).searchParams.get('id')) } }) }) });
  assert.equal(it.id, 7);
  // URL はこの端末の中だけ(secrets)
  secrets.set({ irUrl: 'https://example.invalid/exec' });
  assert.equal(secrets.get().irUrl, 'https://example.invalid/exec');
});

test('開示・決算:読み込み時にそろえる(コードの形・重複・見た開示の数)。v13 のデータを開いても保有はそのまま', () => {
  const n = IR.normalize({ watch: [{ code: '9y3c', name: 'C' }, { code: '9Y3C' }, { code: 'bad' }], seen: [1, 1, 2, -1, 'x', ...Array.from({ length: 700 }, (_, i) => i + 10)], since: { '9x1a': NOW.toISOString(), no: 'x' }, manualEarnings: { '9X1A': { date: '2026-12-01', label: 'L' }, '9X2B': { date: 'bad' } } });
  assert.deepEqual(n.watch.map((w) => w.code), ['9Y3C']);
  assert.equal(n.seen.length, 600);
  assert.deepEqual(Object.keys(n.since), ['9X1A']);
  assert.deepEqual(Object.keys(n.manualEarnings), ['9X1A']);

  const v13 = store.createEmpty(NOW);
  v13.schemaVersion = 13;
  v13.assets.holdings = [{ id: 'x', broker: '証券A', account: 'tokutei', type: 'jp', code: '9X1A', name: '銘柄A', quantity: 100, avgPrice: 1000 }];
  delete v13.assets.ir;
  const res = store.prepare(JSON.parse(JSON.stringify(v13)));
  assert.equal(res.ok, true);
  assert.equal(res.data.schemaVersion, store.SCHEMA_VERSION);
  assert.equal(res.data.assets.holdings[0].quantity, 100);
  assert.deepEqual(res.data.assets.ir, { watch: [], seen: [], since: {}, manualEarnings: {} });
});
