/*
 * 表示テーマ(ライト / ダーク / 端末に合わせる)の切り替え
 *  - 選択は端末ごとの表示設定(localStorage の moneyTracker:ui:theme)に保存し、データの書き出しには含めない
 *  - 最初の適用は js/core/theme-boot.js(読み込みの最初)。ここでは切り替えと、端末の設定の変化への追従を行う
 *  - 変わったら onChange に登録した関数を呼ぶ(画面とグラフの描き直しは app.js)
 */
(function (root) {
  'use strict';
  const MT = (root.MT = root.MT || {});
  const U = MT.util;

  const PREFS = ['system', 'light', 'dark'];
  const LABELS = { system: '端末に合わせる', light: 'ライト', dark: 'ダーク' };
  const THEME_COLOR = root.MT_THEME_COLOR || { light: '#f4f4f1', dark: '#0d0d0d' };
  const listeners = new Set();
  const hasDom = typeof root.document !== 'undefined';

  /** 選んでいるテーマ(system / light / dark) */
  function pref() {
    const v = U.prefs.get('theme', 'system');
    return PREFS.includes(v) ? v : 'system';
  }

  function systemDark() {
    try {
      return !!(root.matchMedia && root.matchMedia('(prefers-color-scheme: dark)').matches);
    } catch (e) {
      return false;
    }
  }

  /** 実際に使うテーマ(light / dark) */
  function resolve(p, isSystemDark) {
    if (p === 'light' || p === 'dark') return p;
    return isSystemDark ? 'dark' : 'light';
  }

  /** いま画面に当たっているテーマ */
  function current() {
    return hasDom ? root.document.documentElement.getAttribute('data-theme') || resolve(pref(), systemDark()) : resolve(pref(), false);
  }

  /** テーマを当てる。変わったら true */
  function apply() {
    if (!hasDom) return false;
    const before = root.document.documentElement.getAttribute('data-theme');
    const theme = resolve(pref(), systemDark());
    root.document.documentElement.setAttribute('data-theme', theme);
    const meta = root.document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', THEME_COLOR[theme]);
    return before !== theme;
  }

  function notify() {
    for (const fn of listeners) fn(current());
  }

  /** テーマを選ぶ(system / light / dark) */
  function set(p) {
    if (!PREFS.includes(p)) return;
    U.prefs.set('theme', p);
    apply();
    notify();
  }

  /** ライト ⇔ ダークを 1 タップで切り替える(いまの見た目の反対にする) */
  function toggle() {
    set(current() === 'dark' ? 'light' : 'dark');
  }

  // 「端末に合わせる」のときは、端末の設定が変わったら追従する
  if (hasDom && root.matchMedia) {
    const mq = root.matchMedia('(prefers-color-scheme: dark)');
    const onSystemChange = () => {
      if (pref() === 'system' && apply()) notify();
    };
    if (mq.addEventListener) mq.addEventListener('change', onSystemChange);
    else if (mq.addListener) mq.addListener(onSystemChange);
  }
  if (hasDom) apply(); // theme-boot.js が読めなかったときの念のため

  MT.theme = {
    PREFS,
    LABELS,
    THEME_COLOR,
    pref,
    resolve,
    current,
    set,
    toggle,
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
