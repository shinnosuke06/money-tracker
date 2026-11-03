/*
 * 新しい版が公開されたら知らせる(GitHub Pages などでファイルとして開いたときだけ)
 *  - 起動したときと、画面に戻ってきたとき(ホーム画面のアプリを開き直したときなど)に、
 *    公開中の js/core/store.js の APP_VERSION を、キャッシュを使わずに読んで比べる
 *  - 違っていれば「新しい版があります」と出し、「更新する」で読み直す。
 *    読み直しで古いファイルが使われないよう、index.html の各ファイルには ?v=版 を付けている
 *  - 1 つの HTML にまとめた試用ページ(スクリプトが埋め込み)では何もしない
 *  - 通信できないとき・読めないときは何も出さない
 */
(function (root) {
  'use strict';
  const MT = (root.MT = root.MT || {});
  const doc = root.document;

  // ファイルとして読み込まれたか(試用ページのように埋め込まれていれば src が無い)
  const fromFile = !!(doc && doc.currentScript && doc.currentScript.src);
  const MIN_INTERVAL = 60 * 1000; // 確かめるのは 1 分に 1 回まで

  /** store.js の中身から APP_VERSION を取り出す。無ければ null */
  function parseVersion(text) {
    const m = /\bAPP_VERSION\s*=\s*'([^']+)'/.exec(String(text == null ? '' : text));
    return m ? m[1] : null;
  }

  /** 知らせるべき新しい版か(公開中の版が読めて、いまの版と違う) */
  function isUpdate(remote, current) {
    return !!remote && !!current && remote !== current;
  }

  let lastCheck = 0;
  let shown = null;

  function showBanner(version) {
    if (shown === version) return;
    const { h } = MT.ui;
    const old = doc.querySelector('.toast-update');
    if (old) old.remove();
    let rootEl = doc.getElementById('toast-root');
    if (!rootEl) {
      rootEl = h('div', { id: 'toast-root', 'aria-live': 'polite' });
      doc.body.append(rootEl);
    }
    const close = h('button', { type: 'button', class: 'toast-close', 'aria-label': 'あとで', text: 'あとで' });
    const reload = h('button', { type: 'button', class: 'toast-action', text: '更新する' });
    const el = h(
      'div',
      { class: 'toast toast-update', role: 'status' },
      h('span', { class: 'toast-update-text', text: `新しい版(${version})があります` }),
      reload,
      close
    );
    reload.addEventListener('click', () => root.location.reload());
    close.addEventListener('click', () => el.remove());
    rootEl.append(el);
    shown = version;
  }

  async function check() {
    if (!fromFile || !root.fetch || !/^https?:$/.test(root.location.protocol)) return;
    const now = Date.now();
    if (now - lastCheck < MIN_INTERVAL) return;
    lastCheck = now;
    try {
      const res = await root.fetch(`js/core/store.js?check=${now}`, { cache: 'no-store' });
      if (!res.ok) return;
      const remote = parseVersion(await res.text());
      if (isUpdate(remote, MT.store && MT.store.APP_VERSION)) showBanner(remote);
    } catch (e) {
      /* 通信できないときは何もしない */
    }
  }

  function start() {
    if (!fromFile) return;
    root.setTimeout(check, 1500);
    doc.addEventListener('visibilitychange', () => {
      if (doc.visibilityState === 'visible') check();
    });
  }

  MT.update = { parseVersion, isUpdate, check, start };
})(typeof window !== 'undefined' ? window : globalThis);
