/*
 * ポケカ在庫:画面(#/inventory。「その他」タブの中)
 *  集計(評価額・総支出・総予定利益・確定利益・売却優先度別)と、在庫の一覧(+/− ボタン)
 */
(function (root) {
  'use strict';
  const MT = root.MT;
  const U = MT.util;
  const I = MT.inventoryModel;
  const store = MT.store;
  const F = MT.inventoryUI;
  const { h, icon, btn, toast } = MT.ui;

  const yen = (v) => `${U.yen(v)}円`;
  const signed = (v) => `${U.yenSigned(v)}円`;
  const tone = (v) => (v < 0 ? ' is-neg' : v > 0 ? ' is-pos' : '');

  function kv(labelText, value, cls = '') {
    return h('div', { class: 'kv' }, h('span', { class: 'kv-label', text: labelText }), h('span', { class: `kv-value${cls}`, text: value }));
  }

  function reorderFlow() {
    const inv = store.get().inventory;
    MT.forms.openReorderSheet({
      title: '在庫の並べ替え',
      items: inv.items.map((x) => ({ id: x.id, label: x.name, sub: `${x.quantity}個` })),
      onSave: (ids) => {
        if (store.update((d) => I.reorderItems(d.inventory, ids))) toast('並べ替えました');
      },
    });
  }

  function render(container) {
    const d = store.get();
    const s = I.summary(d.inventory);
    container.append(
      h(
        'header',
        { class: 'page-head' },
        h('a', { class: 'back-link', href: '#/more' }, icon('back'), h('span', { text: 'その他' })),
        h('h1', { class: 'page-title page-title-sub', text: '在庫(ポケカ)' })
      )
    );

    if (!s.rows.length) {
      container.append(
        h(
          'section',
          { class: 'card welcome' },
          h('h2', { class: 'card-title', text: '在庫の記録をはじめる' }),
          h('p', { text: '商品ごとに、個数・購入単価・相場・売却を記録して、評価額と利益を計算します。' }),
          h('div', { class: 'button-row' }, btn('在庫を追加', { variant: 'primary', icon: 'plus', onClick: () => F.openAddSheet() })),
          h('p', { class: 'hint', text: '旧・ポケカ管理アプリのデータは、設定から読み込めます。' })
        )
      );
      return;
    }

    container.append(
      h(
        'section',
        { class: 'card summary' },
        h('p', { class: 'summary-label', text: `在庫の評価額(${s.quantity}個)` }),
        h('p', { class: 'summary-value' }, U.yen(s.value), h('span', { class: 'summary-unit', text: '円' })),
        h(
          'div',
          { class: 'kv-list' },
          kv('総支出', yen(s.spent)),
          kv('総予定利益', signed(s.expected), tone(s.expected)),
          kv('確定利益', signed(s.realized), tone(s.realized))
        ),
        h('h3', { class: 'sp-title', text: '売却優先度別の評価額(段階5の取り崩し案で使います)' }),
        h(
          'div',
          { class: 'kv-list' },
          I.PRIORITIES.map((p) => {
            const g = s.byPriority.get(p.id);
            return kv(`${p.label}(${g.count}商品)`, yen(g.value));
          })
        ),
        h(
          'div',
          { class: 'button-row' },
          btn('在庫を追加', { variant: 'primary', icon: 'plus', onClick: () => F.openAddSheet() }),
          btn('月末記録に反映', { icon: 'sync', onClick: F.openReflectSheet })
        ),
        h('p', { class: 'hint', text: '評価額 = 個数 × 最新の相場(相場が無ければ購入単価)。予定利益 =(相場 − 購入単価)× 在庫。' })
      ),
      h(
        'section',
        { class: 'card card-flush' },
        h(
          'div',
          { class: 'card-head' },
          h('h2', { class: 'card-title', text: `在庫の一覧(${s.rows.length}商品)` }),
          s.rows.length > 1 ? btn('並べ替え', { size: 'small', onClick: reorderFlow }) : null
        ),
        h('ul', { class: 'pay-list inv-list' }, s.rows.map(row))
      )
    );
  }

  function row(r) {
    const x = r.item;
    const stepper = (delta, label) =>
      h(
        'button',
        {
          type: 'button',
          class: 'step-btn',
          'aria-label': `${x.name}を${label}`,
          disabled: delta < 0 && x.quantity <= 0,
          onClick: () => store.update((d) => I.adjustQuantity(d.inventory, x.id, delta)),
        },
        icon(delta > 0 ? 'plus' : 'minus')
      );
    return h(
      'li',
      { class: `inv-row${x.quantity === 0 ? ' is-empty' : ''}` },
      h(
        'button',
        { type: 'button', class: 'pay-main', onClick: () => F.openItemSheet(x.id) },
        h('span', { class: 'pay-name', text: x.name }),
        h(
          'span',
          { class: 'pay-meta' },
          h('span', { class: 'chip chip-soft', text: I.label(x.priority) }),
          h('span', { text: `購入 ${U.formatNumber(x.unitCost, 2)}円` }),
          h('span', { text: r.latest ? `相場 ${U.yen(r.latest.price)}円(${U.shortDate(r.latest.date)})` : '相場なし(購入単価で評価)' }),
          r.realized ? h('span', { class: tone(r.realized).trim(), text: `確定 ${signed(r.realized)}` }) : null
        ),
        h('span', { class: 'pay-amount' }, yen(r.value), h('small', { class: tone(r.expected).trim(), text: `予定 ${signed(r.expected)}` }))
      ),
      h('div', { class: 'inv-qty' }, stepper(-1, '1個減らす'), h('span', { class: 'qty-num', text: `${x.quantity}個` }), stepper(1, '1個増やす'))
    );
  }

  MT.views = MT.views || {};
  MT.views.inventory = { render, tab: 'more' };
})(window);
