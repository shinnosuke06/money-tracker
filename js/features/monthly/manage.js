/*
 * 月末記録:項目と区分の編集(追加・名前変更・並べ替え・削除・区分の移動)
 * 画面:#/monthly/edit
 */
(function (root) {
  'use strict';
  const MT = root.MT;
  const M = MT.monthlyModel;
  const store = MT.store;
  const { h, icon, btn, confirmDialog, promptDialog, actionSheet, toast } = MT.ui;

  const monthly = () => store.get().monthly;
  let pendingFocus = null; // 並べ替え後に、押したボタンへフォーカスを戻す

  function render(container) {
    const m = monthly();
    container.append(
      h(
        'header',
        { class: 'page-head' },
        h(
          'a',
          { class: 'back-link', href: '#/monthly' },
          icon('back'),
          h('span', { text: '月末記録' })
        ),
        h('h1', { class: 'page-title page-title-sub', text: '項目と区分の編集' })
      ),
      h('p', { class: 'hint page-hint', text: '名前をタップすると変更できます。矢印で並べ替え、「…」で移動・削除ができます。' })
    );

    for (const [ci, g] of M.groups(m).entries()) {
      container.append(renderCategory(m, g, ci));
    }

    container.append(
      h(
        'div',
        { class: 'button-row' },
        btn('区分を追加', { icon: 'plus', onClick: addCategoryFlow })
      )
    );

    if (pendingFocus) {
      const el = container.querySelector(`[data-focus-key="${pendingFocus}"]`);
      if (el && !el.disabled) el.focus({ preventScroll: true });
      pendingFocus = null;
    }
  }

  function moveButtons(kind, id, isFirst, isLast, name) {
    const mover = (dir) => () => {
      pendingFocus = `${kind}-${dir < 0 ? 'up' : 'down'}-${id}`;
      store.update((d) => (kind === 'cat' ? M.moveCategory(d.monthly, id, dir) : M.moveItem(d.monthly, id, dir)));
    };
    return [
      h(
        'button',
        {
          type: 'button',
          class: 'icon-btn',
          'aria-label': `「${name}」を上へ`,
          disabled: isFirst,
          dataset: { focusKey: `${kind}-up-${id}` },
          onClick: mover(-1),
        },
        icon('up')
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'icon-btn',
          'aria-label': `「${name}」を下へ`,
          disabled: isLast,
          dataset: { focusKey: `${kind}-down-${id}` },
          onClick: mover(1),
        },
        icon('down')
      ),
    ];
  }

  /** 支払い管理の口座としてつないでいる項目か */
  function isPaymentAccount(itemId) {
    const p = store.get().payments;
    return !!(p && p.accounts.some((a) => a.itemId === itemId));
  }

  function renderCategory(m, g, ci) {
    const c = g.category;
    const isFirst = ci === 0;
    const isLast = ci === m.categories.length - 1;
    const list = h('ul', { class: 'edit-list' });
    g.items.forEach((it, i) => {
      list.append(
        h(
          'li',
          { class: 'edit-row' },
          h(
            'button',
            { type: 'button', class: 'edit-name', onClick: () => renameItemFlow(it) },
            it.name,
            isPaymentAccount(it.id) ? h('small', { class: 'edit-sub', text: '支払いの口座' }) : null
          ),
          moveButtons('item', it.id, i === 0, i === g.items.length - 1, it.name),
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': `「${it.name}」のメニュー`, onClick: () => itemMenu(it) }, icon('more'))
        )
      );
    });
    if (!g.items.length) list.append(h('li', { class: 'edit-row edit-empty', text: 'まだ項目がありません' }));

    return h(
      'section',
      { class: 'card edit-card' },
      h(
        'div',
        { class: 'edit-row edit-cat' },
        h(
          'button',
          { type: 'button', class: 'edit-name', onClick: () => renameCategoryFlow(c) },
          h('span', { class: 'edit-cat-label', text: '区分' }),
          c.name
        ),
        moveButtons('cat', c.id, isFirst, isLast, c.name),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': `区分「${c.name}」のメニュー`, onClick: () => categoryMenu(c, g.items.length) }, icon('more'))
      ),
      list,
      btn('項目を追加', { icon: 'plus', variant: 'ghost', size: 'small', className: 'add-item-btn', onClick: () => addItemFlow(c) })
    );
  }

  // ---- 区分 ----

  async function addCategoryFlow() {
    const name = await promptDialog({ title: '区分を追加', label: '区分の名前', placeholder: '例:電子マネー', okLabel: '追加', maxLength: M.NAME_MAX });
    if (name && store.update((d) => M.addCategory(d.monthly, name))) toast('区分を追加しました');
  }

  async function renameCategoryFlow(c) {
    const name = await promptDialog({ title: '区分の名前を変更', label: '区分の名前', value: c.name, maxLength: M.NAME_MAX });
    if (name && name !== c.name) store.update((d) => M.renameCategory(d.monthly, c.id, name));
  }

  function categoryMenu(c, itemCount) {
    actionSheet({
      title: c.name,
      actions: [
        { label: '名前を変更', onSelect: () => renameCategoryFlow(c) },
        { label: 'この区分に項目を追加', onSelect: () => addItemFlow(c) },
        { label: '区分を削除', danger: true, onSelect: () => deleteCategoryFlow(c, itemCount) },
      ],
    });
  }

  async function deleteCategoryFlow(c, itemCount) {
    const ok = await confirmDialog({
      title: `区分「${c.name}」を削除しますか?`,
      message: [
        itemCount ? `中の項目 ${itemCount}件と、その過去の金額もすべて消えます。` : 'この区分には項目がありません。',
        '間違えた場合は、設定の「直前のデータに戻す」で元に戻せます。',
      ],
      okLabel: '削除する',
      danger: true,
    });
    if (ok && store.update((d) => M.deleteCategory(d.monthly, c.id), { backup: `区分「${c.name}」の削除` })) {
      toast('区分を削除しました');
    }
  }

  // ---- 項目 ----

  async function addItemFlow(c) {
    const name = await promptDialog({
      title: `「${c.name}」に項目を追加`,
      label: '項目の名前',
      placeholder: '例:〇〇銀行 普通',
      okLabel: '追加',
      maxLength: M.NAME_MAX,
    });
    if (name && store.update((d) => M.addItem(d.monthly, c.id, name))) toast('項目を追加しました');
  }

  async function renameItemFlow(it) {
    const name = await promptDialog({ title: '項目の名前を変更', label: '項目の名前', value: it.name, maxLength: M.NAME_MAX });
    if (name && name !== it.name) store.update((d) => M.renameItem(d.monthly, it.id, name));
  }

  function itemMenu(it) {
    const m = monthly();
    const others = m.categories.filter((c) => c.id !== it.categoryId);
    actionSheet({
      title: it.name,
      actions: [
        { label: '名前を変更', onSelect: () => renameItemFlow(it) },
        others.length ? { label: '別の区分へ移動', onSelect: () => moveItemFlow(it, others) } : null,
        { label: '項目を削除', danger: true, onSelect: () => deleteItemFlow(it) },
      ],
    });
  }

  function moveItemFlow(it, others) {
    actionSheet({
      title: `「${it.name}」の移動先`,
      actions: others.map((c) => ({
        label: c.name,
        onSelect: () => {
          if (store.update((d) => M.changeItemCategory(d.monthly, it.id, c.id))) toast(`「${c.name}」へ移動しました`);
        },
      })),
    });
  }

  async function deleteItemFlow(it) {
    const ok = await confirmDialog({
      title: `「${it.name}」を削除しますか?`,
      message: [
        '過去の月の金額も消え、総資産の計算から外れます。',
        isPaymentAccount(it.id) ? '支払い管理の口座からも外れ、この口座を指していた支払い・入金は「口座なし」になります。' : null,
        '口座を解約した場合は、削除せずに金額を 0 にすると過去の記録を残せます。',
        '間違えた場合は、設定の「直前のデータに戻す」で元に戻せます。',
      ],
      okLabel: '削除する',
      danger: true,
    });
    if (ok && store.update((d) => M.deleteItem(d.monthly, it.id), { backup: `項目「${it.name}」の削除` })) {
      toast('項目を削除しました');
    }
  }

  MT.views = MT.views || {};
  MT.views['monthly/edit'] = { render, tab: 'monthly' };
})(window);
