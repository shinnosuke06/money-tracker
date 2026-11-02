/*
 * まだ作っていないタブの「準備中」画面
 * 各段階で、ここの登録を本物の画面に置き換えていく。
 */
(function (root) {
  'use strict';
  const MT = root.MT;
  const { h } = MT.ui;

  const PLANS = {
    assets: {
      title: '資産',
      lines: ['株・投資信託の保有状況', '手入力の資産', '価格の自動取得', '配当・株主優待', 'ポケカ在庫', '副業収入'],
    },
    future: {
      title: '将来予想',
      lines: ['ライフプラン(収入・支出の見通し)', '資産の将来予想'],
    },
  };

  function placeholder(key) {
    const plan = PLANS[key];
    return {
      render(container) {
        container.append(
          h('header', { class: 'page-head' }, h('h1', { class: 'page-title', text: plan.title })),
          h(
            'section',
            { class: 'card placeholder' },
            h('p', { class: 'placeholder-badge', text: '準備中' }),
            h('p', { text: 'この画面は今後の段階で追加します。予定している機能:' }),
            h('ul', { class: 'plain-list' }, plan.lines.map((t) => h('li', { text: t })))
          )
        );
      },
    };
  }

  MT.views = MT.views || {};
  for (const key of Object.keys(PLANS)) {
    if (!MT.views[key]) MT.views[key] = placeholder(key);
  }
})(window);
