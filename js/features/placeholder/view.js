/*
 * まだ作っていないタブの「準備中」画面
 * 各段階で、ここの登録を本物の画面に置き換えていく。
 */
(function (root) {
  'use strict';
  const MT = root.MT;
  const { h } = MT.ui;

  // 段階5で「将来予想」を本物の画面にしたので、いまは準備中の画面はない(段階6で使う)
  const PLANS = {};

  function placeholder(key) {
    const plan = PLANS[key];
    return {
      tab: 'more',
      render(container) {
        container.append(
          h(
            'header',
            { class: 'page-head' },
            h('a', { class: 'back-link', href: '#/more' }, MT.ui.icon('back'), h('span', { text: 'その他' })),
            h('h1', { class: 'page-title page-title-sub', text: plan.title })
          ),
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
