// 開示・決算の GAS(tools/gas/ir.gs)のうち、Google の機能を使わない部分のテスト。架空のデータだけを使う。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const code = fs.readFileSync(path.join(__dirname, '..', 'tools', 'gas', 'ir.gs'), 'utf8');
const G = vm.createContext({});
vm.runInContext(code, G);

// 日本時間の日時 → Date
const jst = (s) => new Date(Date.parse(s.replace(' ', 'T') + ':00+09:00'));

test('GAS:確認の間隔は、平日の昼休みと 15〜18 時は 5 分、平日の日中は 30 分、夜中と土日は 3 時間', () => {
  assert.equal(G.irIntervalMin_(jst('2026-11-16 11:45')), 5); // 月曜
  assert.equal(G.irIntervalMin_(jst('2026-11-16 15:00')), 5);
  assert.equal(G.irIntervalMin_(jst('2026-11-16 17:59')), 5);
  assert.equal(G.irIntervalMin_(jst('2026-11-16 18:00')), 30);
  assert.equal(G.irIntervalMin_(jst('2026-11-16 09:00')), 30);
  assert.equal(G.irIntervalMin_(jst('2026-11-16 23:00')), 180);
  assert.equal(G.irIntervalMin_(jst('2026-11-16 06:59')), 180);
  assert.equal(G.irIntervalMin_(jst('2026-11-14 15:30')), 180); // 土曜
  // 前回から間隔ぶん(1 分のずれは許す)たっていれば確かめる
  const now = jst('2026-11-16 15:30');
  assert.equal(G.irShouldRun_(now, null), true);
  assert.equal(G.irShouldRun_(now, jst('2026-11-16 15:26').toISOString()), true);
  assert.equal(G.irShouldRun_(now, jst('2026-11-16 15:28').toISOString()), false);
  assert.equal(G.irShouldRun_(jst('2026-11-16 09:30'), jst('2026-11-16 09:10').toISOString()), false);
  assert.equal(G.irShouldRun_(jst('2026-11-16 09:30'), jst('2026-11-16 09:01').toISOString()), true);
  // 1 日の回数の見込み(平日):5 分おき 4.5 時間 + 30 分おき 10.5 時間 + 3 時間おき 9 時間 で 80 回ほど
  let runs = 0;
  let last = null;
  for (let t = jst('2026-11-16 00:00').getTime(); t < jst('2026-11-17 00:00').getTime(); t += 5 * 60000) {
    const now2 = new Date(t);
    if (G.irShouldRun_(now2, last)) {
      runs++;
      last = now2.toISOString();
    }
  }
  assert.ok(runs > 60 && runs < 100, `1 日 ${runs} 回`);
});

test('GAS:決算発表予定日は 1 日 1 回(朝 6 時以降)。新しい銘柄が増えたら 1 時間あけて読み直す', () => {
  const st = { earningsAt: jst('2026-11-16 06:05').toISOString(), earningsCodes: ['X101'] };
  assert.equal(G.irEarningsDue_(jst('2026-11-16 12:00'), st, ['X101']), false);
  assert.equal(G.irEarningsDue_(jst('2026-11-17 05:59'), st, ['X101']), false);
  assert.equal(G.irEarningsDue_(jst('2026-11-17 06:00'), st, ['X101']), true);
  assert.equal(G.irEarningsDue_(jst('2026-11-16 06:30'), st, ['X101', 'X102']), false);
  assert.equal(G.irEarningsDue_(jst('2026-11-16 07:10'), st, ['X101', 'X102']), true);
  assert.equal(G.irEarningsDue_(jst('2026-11-16 07:10'), { ...st, earningsTriedAt: jst('2026-11-16 06:50').toISOString() }, ['X101', 'X102']), false);
  assert.equal(G.irEarningsDue_(jst('2026-11-16 07:10'), {}, []), false);
  assert.equal(G.irEarningsDue_(jst('2026-11-16 07:10'), {}, ['X101']), true);
});

test('GAS:コードをそろえる(全角・5 桁・重複・形の違うもの)', () => {
  assert.equal(G.irNormalizeCode_('９Ｘ１Ａ'), '9X1A');
  assert.equal(G.irNormalizeCode_('9X1A0'), '9X1A');
  assert.equal(G.irNormalizeCode_('9x2b'), '9X2B');
  assert.equal(G.irNormalizeCode_('X101'), ''); // 国内株の形ではない
  assert.deepEqual(Array.from(G.irParseCodes_('9X1A, 9X1A0,9Y9Z,abc,,9X2B')), ['9X1A', '9Y9Z', '9X2B']);
});

test('GAS:やのしんの返事から開示を取り出し、資料の URL を直す。古い開示は自動では要約しない', () => {
  const json = {
    items: [
      { Tdnet: { id: '1001', pubdate: '2026-11-13 15:30:00', company_code: '9X1A0', company_name: '架空工業', title: '2027年3月期 第2四半期決算短信', document_url: 'https://webapi.yanoshin.jp/rd.php?https://www.release.tdnet.info/inbs/140120261113000001.pdf' } },
      { Tdnet: { id: '1002', pubdate: '2026-11-01 15:00:00', company_code: '9X2B0', company_name: '架空商事', title: '自己株式の取得に関するお知らせ', document_url: 'http://www.release.tdnet.info/inbs/x.pdf' } },
      { Tdnet: { id: 'x', company_code: '9X1A' } },
    ],
  };
  const items = G.irParseYanoshin_(json);
  assert.equal(items.length, 2);
  assert.equal(items[0].code, '9X1A');
  assert.equal(items[0].at, '2026-11-13 15:30');
  assert.equal(items[0].url, 'https://www.release.tdnet.info/inbs/140120261113000001.pdf');
  assert.equal(items[1].url, 'https://www.release.tdnet.info/inbs/x.pdf');
  assert.throws(() => G.irParseYanoshin_({ nope: true }));
  const now = jst('2026-11-14 10:00');
  const rows = G.irMergeRows_([], items, now, ['9X1A', '9X2B']);
  assert.deepEqual(JSON.parse(JSON.stringify(rows.map((r) => [r.id, r.status]))), [[1002, 'skipped'], [1001, 'pending']]);
  // 同じ開示は二度足さない(要約の結果は残る)
  rows[1].status = 'done';
  const again = G.irMergeRows_(rows, items, now, ['9X1A']);
  assert.equal(again.length, 2);
  assert.equal(again.find((r) => r.id === 1001).status, 'done');
  // 45 日より前は消す
  assert.equal(G.irPruneRows_([{ id: 1, at: '2026-09-01 10:00' }, { id: 2, at: '2026-11-01 10:00' }], now).length, 1);
});

test('GAS:要約の返事をそろえる(一覧にない目印・「なし」・長すぎる文は除く)', () => {
  const s = G.irShapeSummary_({
    tags: ['上方修正', '↑増配', 'すごい', '上方修正', '株式分割', '減益', '増収'],
    head: '第2四半期の決算。予想を引き上げた',
    good: ['・営業利益 1,520百万円(前年同期比 +15.4%)', 'なし', ''],
    bad: [],
    neutral: ['決算説明会の日程'],
  });
  assert.deepEqual(Array.from(s.tags.map((t) => `${t.name}:${t.dir}`)), ['上方修正:up', '増配:up', '株式分割:flat', '減益:down']);
  assert.deepEqual(Array.from(s.good), ['営業利益 1,520百万円(前年同期比 +15.4%)']);
  assert.equal(s.bad.length, 0);
  assert.equal(G.irShapeSummary_(null), null);
  assert.equal(G.irShapeSummary_({ tags: [], head: '', good: [], bad: [], neutral: [] }), null);
});

test('GAS:決算発表予定日の一覧(Excel の中身)を読み、見ている銘柄のいちばん近い予定日を拾う', () => {
  const shared = '<sst><si><t>決算発表予定日</t></si><si><t>コード</t></si><si><t>会社名</t></si><si><t>決算期末</t></si><si><t>種別</t></si>'
    + '<si><t>架空工業</t></si><si><r><t>架空</t></r><r><t>商事</t></r><rPh><t>カクウ</t></rPh></si><si><t>第2四半期</t></si><si><t>本決算</t></si><si><t>3月</t></si></sst>';
  const strings = G.irXlsxSharedStrings_(shared);
  assert.equal(strings[6], '架空商事');
  const sheet = '<worksheet><sheetData>'
    + '<row r="1"><c r="A1" t="inlineStr"><is><t>2026年11月期 決算発表予定日一覧</t></is></c></row>'
    + '<row r="3"><c r="A3" t="s"><v>0</v></c><c r="B3" t="s"><v>1</v></c><c r="C3" t="s"><v>2</v></c><c r="D3" t="s"><v>3</v></c><c r="E3" t="s"><v>4</v></c></row>'
    + '<row r="4"><c r="A4"><v>46346</v></c><c r="B4" t="inlineStr"><is><t>9X1A</t></is></c><c r="C4" t="s"><v>5</v></c><c r="D4" t="s"><v>9</v></c><c r="E4" t="s"><v>7</v></c></row>'
    + '<row r="5"><c r="A5" t="inlineStr"><is><t>2026/11/27</t></is></c><c r="B5" t="inlineStr"><is><t>9X2B</t></is></c><c r="C5" t="s"><v>6</v></c><c r="E5" t="s"><v>8</v></c></row>'
    + '<row r="6"><c r="A6" t="inlineStr"><is><t>2026/11/10</t></is></c><c r="B6" t="inlineStr"><is><t>9Y9Z</t></is></c></row>'
    + '</sheetData></worksheet>';
  const rows = G.irXlsxRows_(sheet, strings);
  assert.equal(rows[1][1], 'コード');
  assert.equal(G.irExcelDate_('46346'), '2026-11-20');
  assert.equal(G.irExcelDate_('2026年2月5日'), '2026-02-05');
  assert.equal(G.irExcelDate_('未定'), '');
  const want = { '9X1A': true, '9X2B': true, '9Y9Z': true };
  const got = G.irPickEarnings_(rows, want, '2026-11-16');
  assert.deepEqual(JSON.parse(JSON.stringify(got)), {
    '9X1A': { date: '2026-11-20', label: '第2四半期(3月)', name: '架空工業' },
    '9X2B': { date: '2026-11-27', label: '本決算', name: '架空商事' },
  }); // 9Y9Z は今日より前なので拾わない
  // 見出しの無い表からは何も拾わない
  assert.deepEqual(JSON.parse(JSON.stringify(G.irPickEarnings_([['a', 'b']], want, '2026-11-16'))), {});
  // 合わせる:近い日を使い、拾えなかった銘柄は前回の予定(今日以後)を残す
  const merged = G.irMergeEarnings_({ '9X1A': { date: '2026-11-18' }, '9Y9Z': { date: '2026-12-01' }, '9Z0A': { date: '2026-11-01' } }, got, ['9X1A', '9X2B', '9Y9Z', '9Z0A'], '2026-11-16');
  assert.deepEqual(Object.keys(merged).sort(), ['9X1A', '9X2B', '9Y9Z']);
  assert.equal(merged['9X1A'].date, '2026-11-20');
  assert.equal(G.irCombineEarnings_({ 1: { date: '2026-12-01' } }, { 1: { date: '2026-11-30' } })[1].date, '2026-11-30');
});

test('GAS:決算発表予定日のページから Excel のリンクを取り出す', () => {
  const html = '<a href="/listing/event-schedules/financial-announcement/tvdivq-att/kessan_a.xlsx">A</a> <a href="kessan_b.xlsx">B</a> <a href="/listing/event-schedules/financial-announcement/tvdivq-att/kessan_a.xlsx">A</a> <a href="x.pdf">x</a>';
  assert.deepEqual(Array.from(G.irXlsxLinks_(html)), [
    'https://www.jpx.co.jp/listing/event-schedules/financial-announcement/tvdivq-att/kessan_a.xlsx',
    'https://www.jpx.co.jp/listing/event-schedules/financial-announcement/kessan_b.xlsx',
  ]);
});

test('GAS:コードにキーや個人の情報を書いていない', () => {
  assert.doesNotMatch(code, /AIza[0-9A-Za-z_-]{20,}/); // Gemini のキーの形
  assert.match(code, /getProperty\('GEMINI_API_KEY'\)/);
});
