/*
 * 表示テーマを読み込みの最初に当てる(<head> の中で、スタイルシートより前に読み込む)
 * 起動時に一瞬だけ違う色が見えないよう、ここで <html data-theme="light|dark"> と theme-color を決める。
 * 選んだテーマは localStorage の "moneyTracker:ui:theme"("light" / "dark" / "system")。
 * 切り替えの本体は js/core/theme.js。
 */
(function () {
  'use strict';
  // CSS の --bg と同じ値(ブラウザの上の帯などの色)
  var THEME_COLOR = { light: '#f4f4f1', dark: '#0d0d0d' };
  var pref = 'system';
  try {
    var v = JSON.parse(window.localStorage.getItem('moneyTracker:ui:theme'));
    if (v === 'light' || v === 'dark' || v === 'system') pref = v;
  } catch (e) {
    /* 読めなければ「端末に合わせる」 */
  }
  var systemDark = false;
  try {
    systemDark = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  } catch (e) {
    /* 判定できなければライト */
  }
  var theme = pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;
  document.documentElement.setAttribute('data-theme', theme);
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLOR[theme]);
  window.MT_THEME_COLOR = THEME_COLOR;
})();
