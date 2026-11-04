/*
 * ホーム画面から開くアプリ(PWA)の準備:サービスワーカー(sw.js)の登録と、「最新版に更新」
 *  - GitHub Pages などでファイルとして開いたとき(https か localhost)だけ動く。
 *    1 つの HTML にまとめた試用ページ(スクリプトが埋め込み)では何もしない
 *  - 「最新版に更新」:アプリのファイルのキャッシュを消し、サービスワーカーを外してから、ネットから読み直す。
 *    データ(localStorage)は消さない
 */
(function (root) {
  'use strict';
  const MT = (root.MT = root.MT || {});
  const doc = root.document;
  const nav = root.navigator;

  // ファイルとして読み込まれたか(試用ページのように埋め込まれていれば src が無い)
  const fromFile = !!(doc && doc.currentScript && doc.currentScript.src);
  const REFRESH_PARAM = 'refresh';
  let registration = null;

  function supported() {
    if (!fromFile || !nav || !('serviceWorker' in nav)) return false;
    const loc = root.location;
    return loc.protocol === 'https:' || loc.hostname === 'localhost' || loc.hostname === '127.0.0.1';
  }

  function register() {
    if (!supported()) return;
    nav.serviceWorker
      .register('sw.js', { scope: './' })
      .then((r) => {
        registration = r;
      })
      .catch(() => {
        /* 登録できなくても、ネットにつながっていれば普通に使える */
      });
  }

  /** 待っている新しい版があれば、すぐ入れ替える(このあと読み直す) */
  function applyWaiting() {
    try {
      if (registration && registration.waiting) registration.waiting.postMessage('skipWaiting');
    } catch (e) {
      /* 何もしない */
    }
  }

  /** 最新版に更新:キャッシュとサービスワーカーを外して、ネットから読み直す(データは消えない) */
  async function forceUpdate() {
    try {
      if (nav && nav.serviceWorker) {
        for (const r of await nav.serviceWorker.getRegistrations()) await r.unregister();
      }
      if (root.caches) {
        for (const k of await root.caches.keys()) if (k.startsWith('money-tracker-')) await root.caches.delete(k);
      }
    } catch (e) {
      /* 消せなくても読み直しは行う */
    }
    const url = new URL(root.location.href);
    url.searchParams.set(REFRESH_PARAM, String(Date.now())); // ブラウザのキャッシュも使わないように
    root.location.replace(url.toString());
  }

  /** 「最新版に更新」で付けた ?refresh= をアドレスから外す */
  function cleanUrl() {
    try {
      const url = new URL(root.location.href);
      if (!url.searchParams.has(REFRESH_PARAM)) return;
      url.searchParams.delete(REFRESH_PARAM);
      root.history.replaceState(null, '', url.pathname + url.search + url.hash);
    } catch (e) {
      /* 何もしない */
    }
  }

  /** いまの状態(設定に出す) */
  function status() {
    return { supported: supported(), offlineReady: !!(supported() && nav.serviceWorker.controller) };
  }

  MT.pwa = { register, applyWaiting, forceUpdate, cleanUrl, status, supported };
})(typeof window !== 'undefined' ? window : globalThis);
