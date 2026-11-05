/*
 * 資産管理:アプリを開いたときに、価格を自動で更新する
 *
 * - アプリを開いたとき・ほかのアプリから戻ってきたときに確かめる
 * - 更新するのは、取りに行ける銘柄があり(国内株・投信は価格取得の URL、米国株は Finnhub のキー)、
 *   前回の更新から 30 分以上たっているとき(js/features/assets/model.js の autoUpdateDue)
 * - 結果は画面の下に短く出す(取れなかった銘柄の理由は、資産の「価格を更新」で見られる)
 * - 設定の「価格の自動取得」で止められる。端末ごとの表示設定(moneyTracker:ui:assetsAutoUpdate)に入れ、書き出しには含めない
 */
(function (root) {
  'use strict';
  const MT = root.MT;
  const U = MT.util;
  const A = MT.assetsModel;

  const PREF = 'assetsAutoUpdate';
  let timer = null;

  const enabled = () => U.prefs.get(PREF, true) !== false;
  const setEnabled = (on) => U.prefs.set(PREF, !!on);

  function maybeRun() {
    if (!enabled() || !MT.assetsView) return;
    if (root.navigator && root.navigator.onLine === false) return;
    if (MT.store.isReadOnly()) return;
    const d = MT.store.get();
    if (!d || !d.assets) return;
    if (!A.autoUpdateDue(d.assets, { secrets: MT.secrets.get(), now: new Date() })) return;
    MT.assetsView.updatePrices({ auto: true });
  }

  function start() {
    maybeRun();
    root.document.addEventListener('visibilitychange', () => {
      if (root.document.visibilityState !== 'visible') return;
      clearTimeout(timer);
      timer = setTimeout(maybeRun, 600);
    });
  }

  MT.assetsAuto = { start, enabled, setEnabled, maybeRun };
})(window);
