/*
 * アプリ本体:下部タブ、画面の切り替え(#/monthly など)、起動処理
 *
 * 画面は MT.views に登録する。
 *   MT.views['monthly']      = { render(container, { entered }), unmount?({ leaving }), needsAttention?() }
 *   MT.views['monthly/edit'] = { render(container), tab: 'monthly' }  // サブ画面
 *
 * 定期的な処理(支払いの月替わりなど)は MT.maintenance に関数を登録する。
 *   起動時・画面に戻ったとき・データが変わったときに呼ばれ、お知らせの文を返すとトーストで表示する。
 */
(function (root) {
  'use strict';
  const MT = root.MT;
  const { h, icon, toast } = MT.ui;

  // 下部タブは 5 つまで。在庫(ポケカ)・将来予想・設定は「その他」の中にある
  const TABS = [
    { id: 'monthly', label: '月末記録', icon: 'calendar' },
    { id: 'payments', label: '支払い', icon: 'card' },
    { id: 'assets', label: '資産', icon: 'coins' },
    { id: 'sidejob', label: '副業', icon: 'briefcase' },
    { id: 'more', label: 'その他', icon: 'grid' },
  ];

  let currentView = null;
  let currentPath = null;
  let globalNotice = null; // 全画面の上に出す注意(読み取り専用など)

  function parsePath() {
    const raw = (root.location.hash || '').replace(/^#\/?/, '');
    return MT.views[raw] ? raw : 'monthly';
  }

  function navigate(path) {
    const hash = `#/${path}`;
    if (root.location.hash === hash) render({ resetScroll: true });
    else root.location.hash = hash;
  }

  function render({ resetScroll = false } = {}) {
    const path = parsePath();
    const view = MT.views[path];
    const main = root.document.getElementById('view');

    const changed = currentPath !== path;
    if (currentView && currentView.unmount) currentView.unmount({ leaving: changed }); // leaving: 別の画面へ移るとき true
    main.replaceChildren();
    if (globalNotice) main.append(globalNotice);
    view.render(main, { entered: changed }); // entered: 別の画面から来たとき true
    currentView = view;
    currentPath = path;
    updateTabbar(view.tab || path.split('/')[0]);
    if (resetScroll || changed) root.scrollTo(0, 0);
  }

  function buildTabbar() {
    const nav = root.document.getElementById('tabbar');
    nav.replaceChildren(
      ...TABS.map((t) =>
        h(
          'a',
          { class: 'tab', href: `#/${t.id}`, dataset: { tab: t.id } },
          icon(t.icon),
          h('span', { class: 'tab-label', text: t.label }),
          h('span', { class: 'tab-dot', hidden: true, 'aria-hidden': 'true' })
        )
      )
    );
  }

  function updateTabbar(activeTab) {
    for (const a of root.document.querySelectorAll('#tabbar .tab')) {
      const id = a.dataset.tab;
      if (id === activeTab) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
      const view = MT.views[id];
      const attention = !!(view && view.needsAttention && view.needsAttention());
      a.querySelector('.tab-dot').hidden = !attention;
      a.setAttribute('aria-label', attention ? `${a.textContent}(要確認)` : a.textContent);
    }
  }

  // ---- 定期的な処理 ----

  let busy = false;

  function runMaintenance() {
    if (MT.store.isReadOnly()) return;
    for (const task of MT.maintenance || []) {
      try {
        const msg = task();
        if (msg) toast(msg, { duration: 4000 });
      } catch (e) {
        if (root.console) root.console.error(e);
      }
    }
  }

  /** データが変わったとき:定期処理を確認してから 1 回だけ描き直す */
  function onStoreChange() {
    if (busy) return;
    busy = true;
    try {
      runMaintenance();
    } finally {
      busy = false;
    }
    render();
  }

  // ---- 表示テーマの切り替えボタン ----

  function buildThemeToggle() {
    const b = h('button', { type: 'button', id: 'theme-toggle', class: 'theme-toggle', onClick: () => MT.theme.toggle() });
    root.document.body.append(b);
    updateThemeToggle();
  }

  function updateThemeToggle() {
    const b = root.document.getElementById('theme-toggle');
    if (!b) return;
    const dark = MT.theme.current() === 'dark';
    b.replaceChildren(icon(dark ? 'moon' : 'sun'));
    b.setAttribute('aria-label', `表示テーマ:${dark ? 'ダーク' : 'ライト'}(タップで${dark ? 'ライト' : 'ダーク'}に切り替え)`);
    b.title = b.getAttribute('aria-label');
  }

  function showGlobalNotice(title, text) {
    globalNotice = h(
      'section',
      { class: 'notice notice-danger', role: 'alert' },
      icon('alert', 'notice-icon'),
      h('div', { class: 'notice-main' }, h('p', { class: 'notice-title', text: title }), h('p', { class: 'notice-text', text }))
    );
  }

  function init() {
    MT.store.setErrorHandler((msg) => toast(msg, { type: 'error', duration: 5000 }));
    const res = MT.store.load();

    if (res.status === 'newer') {
      showGlobalNotice('データを開けません', res.error + '(データを守るため、保存を止めています)');
    } else if (res.status === 'unavailable') {
      showGlobalNotice('データを保存できません', 'このブラウザではデータを保存できない設定になっています。プライベートブラウズをやめるか、別のブラウザで開いてください。');
    }

    buildTabbar();
    busy = true;
    try {
      runMaintenance();
    } finally {
      busy = false;
    }
    MT.store.subscribe(onStoreChange);
    // 開きっぱなしで日付や月が変わったとき用
    root.document.addEventListener('visibilitychange', () => {
      if (root.document.visibilityState === 'visible') onStoreChange();
    });
    root.addEventListener('hashchange', () => render({ resetScroll: true }));
    // 別のタブで変更されたら読み直す
    root.addEventListener('storage', (e) => {
      if (e.key === MT.store.STORAGE_KEY) {
        MT.store.load();
        onStoreChange();
      }
    });
    // 表示テーマ:どの画面からでも 1 タップで切り替えるボタン。変わったら画面とグラフを描き直す
    buildThemeToggle();
    MT.theme.onChange(() => {
      updateThemeToggle();
      render();
      MT.charts.refreshAll(); // 開いているダイアログの中のグラフも
    });

    render();
    // 新しい版が公開されたら知らせる(GitHub Pages などでファイルとして開いたとき)
    if (MT.update) MT.update.start();
    // ホーム画面から開くアプリ:オフライン用のサービスワーカー(GitHub Pages などで開いたとき)
    if (MT.pwa) {
      MT.pwa.cleanUrl();
      MT.pwa.register();
    }
    // 月末の入力の確認(前月の月末記録が未入力・未確認、バックアップが 30 日以上前のとき。1 日 1 回)
    if (MT.monthEnd) MT.monthEnd.maybePrompt();

    if (res.status === 'corrupt') {
      toast('保存データが壊れていたため、空の状態で始めました(元のデータは別名で残しています)', { type: 'error', duration: 6000 });
    }

    // 可能なら、ブラウザにデータを消さないよう頼んでおく
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(() => {});
    }
  }

  MT.app = { navigate, rerender: () => render(), init };

  if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
