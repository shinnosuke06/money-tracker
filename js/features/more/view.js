/*
 * 「その他」タブ:在庫(ポケカ)・将来予想・設定への入口
 */
(function (root) {
  'use strict';
  const MT = root.MT;
  const U = MT.util;
  const store = MT.store;
  const { h, icon } = MT.ui;

  function entry(href, iconName, title, sub) {
    return h(
      'li',
      null,
      h(
        'a',
        { class: 'more-row', href },
        icon(iconName, 'more-icon'),
        h('span', { class: 'more-text' }, h('span', { class: 'more-title', text: title }), sub ? h('span', { class: 'more-sub', text: sub }) : null),
        icon('chevron', 'more-chevron')
      )
    );
  }

  function render(container) {
    const d = store.get();
    const inv = d.inventory ? MT.inventoryModel.summary(d.inventory) : null;
    container.append(
      h('header', { class: 'page-head' }, h('h1', { class: 'page-title', text: 'その他' })),
      h(
        'section',
        { class: 'card card-flush' },
        h(
          'ul',
          { class: 'more-list' },
          entry('#/inventory', 'box', '在庫(ポケカ)', inv && inv.rows.length ? `評価額 ${U.yen(inv.value)}円・${inv.rows.length}商品` : '商品の在庫・相場・売却の記録'),
          entry('#/future', 'trend', '将来予想', d.future && d.future.plans.length ? `ライフプラン ${d.future.plans.length}件・年ごとの表と取り崩し案` : 'ライフプラン・資産の将来予想・取り崩し案'),
          entry('#/settings', 'settings', '設定', 'バックアップ・価格の自動取得・旧アプリの取り込み')
        )
      )
    );
  }

  MT.views = MT.views || {};
  MT.views.more = { render };
})(window);
