// 表示テーマと色のきまりのテスト。
// 実行方法: node --test(リポジトリのいちばん上で)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

require('../js/core/util.js');
require('../js/core/theme.js');
require('../js/core/store.js');
require('../js/features/monthly/model.js');
require('../js/features/payments/model.js');
require('../js/features/assets/model.js');
require('../js/features/inventory/model.js');
require('../js/features/sidejob/model.js');

const { theme, store } = globalThis.MT;
const ROOT = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');

/** CSS の色の変数ブロックを読む */
function block(selector) {
  const i = css.indexOf(`${selector} {`);
  assert.ok(i >= 0, `${selector} が見つかりません`);
  const body = css.slice(i, css.indexOf('\n}', i));
  const vars = {};
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  return { vars, text: body };
}
const light = block(':root');
const dark = block(':root[data-theme="dark"]');

const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\(/;

test('テーマ:選んだもの(端末に合わせる / ライト / ダーク)から、使うテーマを決める', () => {
  assert.equal(theme.pref(), 'system'); // 既定は「端末に合わせる」
  assert.equal(theme.resolve('system', true), 'dark');
  assert.equal(theme.resolve('system', false), 'light');
  assert.equal(theme.resolve('light', true), 'light');
  assert.equal(theme.resolve('dark', false), 'dark');
  assert.deepEqual(theme.PREFS, ['system', 'light', 'dark']);
});

test('テーマの選択は端末の表示設定に保存し、データの書き出しには入らない', () => {
  theme.set('dark');
  assert.equal(mem.get('moneyTracker:ui:theme'), '"dark"');
  assert.equal(theme.pref(), 'dark');
  store.load();
  const exported = store.exportJSON();
  assert.ok(!exported.includes('theme'), '書き出しに theme が入っている');
  theme.set('nonsense'); // 知らない値は無視
  assert.equal(theme.pref(), 'dark');
  theme.set('system');
});

test('CSS:色は変数ブロックの中だけに書き、ほかの場所に直書きしない', () => {
  const outside = css.replace(light.text, '').replace(dark.text, '').replace(/\/\*[\s\S]*?\*\//g, ''); // コメントは除く
  const hits = outside.split('\n').filter((l) => COLOR_RE.test(l));
  assert.deepEqual(hits, []);
  assert.ok(!/prefers-color-scheme/.test(outside), 'CSS 側で prefers-color-scheme を使わない(判定は theme-boot.js)');
});

test('CSS:ライトの色の変数は、すべてダークにもある', () => {
  const colorVars = Object.keys(light.vars).filter((k) => COLOR_RE.test(light.vars[k]));
  const missing = colorVars.filter((k) => !(k in dark.vars));
  assert.deepEqual(missing, []);
  assert.ok(colorVars.length > 40);
});

test('JavaScript:色を直書きしない(テーマの theme-color だけは別)', () => {
  const files = [];
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.js')) files.push(p);
    }
  };
  walk(path.join(ROOT, 'js'));
  const allowed = ['theme-boot.js', 'theme.js'];
  const hits = [];
  for (const f of files) {
    if (allowed.includes(path.basename(f))) continue;
    fs.readFileSync(f, 'utf8')
      .split('\n')
      .forEach((l, i) => {
        if (/['"`]#[0-9a-fA-F]{3,8}['"`]|rgba?\(/.test(l)) hits.push(`${path.relative(ROOT, f)}:${i + 1}`);
      });
  }
  assert.deepEqual(hits, []);
});

test('theme-color(ブラウザの帯の色)は、CSS の --bg と同じ', () => {
  const boot = fs.readFileSync(path.join(ROOT, 'js/core/theme-boot.js'), 'utf8');
  assert.ok(boot.includes(`light: '${light.vars.bg}'`), 'ライトの theme-color が --bg と違う');
  assert.ok(boot.includes(`dark: '${dark.vars.bg}'`), 'ダークの theme-color が --bg と違う');
  assert.deepEqual(theme.THEME_COLOR, { light: light.vars.bg, dark: dark.vars.bg });
});

// ---- コントラスト(WCAG):文字は 4.5 以上 ----

const rgb = (hex) => {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
};
const lum = (hex) => {
  const [r, g, b] = rgb(hex).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const PAIRS = [
  ['text', 'surface'],
  ['text', 'bg'],
  ['text-2', 'surface'],
  ['text-2', 'surface-2'],
  ['text-3', 'surface'],
  ['text-3', 'surface-2'],
  ['text-3', 'bg'],
  ['accent-text', 'surface'],
  ['accent-text', 'accent-soft'],
  ['on-accent', 'accent'],
  ['positive', 'surface'],
  ['positive', 'surface-2'],
  ['negative', 'surface'],
  ['negative', 'surface-2'],
  ['negative', 'danger-soft'],
  // 金額の色分け(入る・足りる=緑、出る・不足=赤、残りわずか=黄)の塗りの上の文字
  ['positive', 'positive-soft'],
  ['text', 'positive-soft'],
  ['text-2', 'positive-soft'],
  ['negative', 'negative-soft'],
  ['text', 'negative-soft'],
  ['text-2', 'negative-soft'],
  ['warn-text', 'warn-soft'],
  ['warn-text', 'surface-2'],
  ['on-danger', 'danger'],
  ['warn-text', 'surface'],
  ['warn-ink', 'warn-soft'],
  ['toast-text', 'toast-bg'],
  ['toast-error-text', 'toast-error-bg'],
  ['tooltip-text', 'tooltip-bg'],
  ['chart-text', 'surface'],
];

for (const [name, t] of [
  ['ライト', light.vars],
  ['ダーク', dark.vars],
]) {
  test(`コントラスト(${name}):文字と背景の組み合わせはすべて 4.5 以上`, () => {
    const low = PAIRS.map(([fg, bg]) => [fg, bg, ratio(t[fg], t[bg])]).filter(([, , r]) => r < 4.5);
    assert.deepEqual(low.map(([fg, bg, r]) => `${fg} / ${bg} = ${r.toFixed(2)}`), []);
  });

  test(`コントラスト(${name}):プラスの緑とマイナスの赤は見分けられる`, () => {
    assert.notEqual(t.positive, t.negative);
    const [pr, pg] = rgb(t.positive);
    const [nr, ng] = rgb(t.negative);
    assert.ok(pg > pr && nr > ng, '緑は緑み、赤は赤みが強い');
  });
}
