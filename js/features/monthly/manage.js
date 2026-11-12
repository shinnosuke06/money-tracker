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
      h('p', { class: 'hint page-hint', text: '名前をタップすると変更できます。矢印で並べ替え、「…」で移動・削除・参考行(小計・総資産に含めない)の切り替え・まとめ(証券会社ごとの小計など)への出し入れができます。' })
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
      store.update((d) => {
        if (kind === 'cat') return M.moveCategory(d.monthly, id, dir);
        if (kind === 'group') {
          const sep = id.indexOf('|');
          return M.moveGroup(d.monthly, id.slice(0, sep), id.slice(sep + 1), dir);
        }
        return M.moveItem(d.monthly, id, dir);
      });
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
    const itemRow = (it, isFirst, isLast, child) =>
      h(
        'li',
        { class: child ? 'edit-row edit-child' : 'edit-row' },
        h(
          'button',
          { type: 'button', class: 'edit-name', onClick: () => renameItemFlow(it) },
          it.name,
          it.reference ? h('small', { class: 'edit-sub', text: '参考行(小計・総資産に含めない)' }) : null,
          isPaymentAccount(it.id) ? h('small', { class: 'edit-sub', text: '支払いの口座' }) : null
        ),
        moveButtons('item', it.id, isFirst, isLast, it.name),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': `「${it.name}」のメニュー`, onClick: () => itemMenu(it) }, icon('more'))
      );
    const bl = M.blocks(g.items);
    bl.forEach((b, bi) => {
      if (!b.group) {
        list.append(itemRow(b.items[0], bi === 0, bi === bl.length - 1, false));
        return;
      }
      // まとめの見出し(↑↓ はまとめごと動かす)と、その中の項目(↑↓ はまとめの中で動く)
      const gid = `${c.id}|${b.group}`;
      list.append(
        h(
          'li',
          { class: 'edit-row edit-group' },
          h(
            'button',
            { type: 'button', class: 'edit-name', onClick: () => renameGroupFlow(c, b.group) },
            h('span', { class: 'edit-cat-label', text: `まとめ(内訳 ${b.items.length}件)` }),
            b.group
          ),
          moveButtons('group', gid, bi === 0, bi === bl.length - 1, b.group),
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': `まとめ「${b.group}」のメニュー`, onClick: () => groupMenu(c, b.group) }, icon('more'))
        )
      );
      b.items.forEach((it, i) => list.append(itemRow(it, i === 0, i === b.items.length - 1, true)));
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
    const g = M.groupOf(it);
    actionSheet({
      title: it.name,
      actions: [
        { label: '名前を変更', onSelect: () => renameItemFlow(it) },
        { label: g ? 'まとめを変える' : 'まとめに入れる(証券会社ごとの小計など)', onSelect: () => chooseGroupFlow(it) },
        g
          ? {
              label: `まとめ「${g}」から外す`,
              onSelect: () => {
                if (store.update((d) => M.setGroup(d.monthly, it.id, ''))) toast('まとめから外しました');
              },
            }
          : null,
        others.length ? { label: '別の区分へ移動', onSelect: () => moveItemFlow(it, others) } : null,
        {
          label: it.reference ? '小計・総資産に含める(参考行をやめる)' : '参考行にする(小計・総資産に含めない)',
          onSelect: () => {
            if (store.update((d) => M.setReference(d.monthly, it.id, !it.reference))) toast(it.reference ? '小計・総資産に含めます' : '参考行にしました(合計には含めません)');
          },
        },
        { label: '項目を削除', danger: true, onSelect: () => deleteItemFlow(it) },
      ],
    });
  }

  // ---- まとめ(証券会社など) ----

  /** 項目を入れるまとめを選ぶ(同じ区分のまとめ・新しいまとめ) */
  function chooseGroupFlow(it) {
    const current = M.groupOf(it);
    const names = M.groupNames(monthly(), it.categoryId).filter((n) => n !== current);
    const put = (name) => {
      if (store.update((d) => M.setGroup(d.monthly, it.id, name))) toast(`「${name}」に入れました`);
    };
    const newFlow = async () => {
      const name = await promptDialog({
        title: '新しいまとめ',
        label: 'まとめの名前',
        placeholder: '例:証券A',
        hint: '同じまとめの項目は、表でまとめの小計の下に内訳として並びます。',
        okLabel: '入れる',
        maxLength: M.NAME_MAX,
      });
      if (name) put(name);
    };
    if (!names.length) {
      newFlow();
      return;
    }
    actionSheet({
      title: `「${it.name}」を入れるまとめ`,
      actions: [...names.map((n) => ({ label: n, onSelect: () => put(n) })), { label: '新しいまとめを作る', onSelect: newFlow }],
    });
  }

  function groupMenu(c, group) {
    actionSheet({
      title: group,
      actions: [
        { label: 'まとめの名前を変更', onSelect: () => renameGroupFlow(c, group) },
        {
          label: 'まとめを解く(項目はそのまま残る)',
          onSelect: () => {
            if (store.update((d) => M.renameGroup(d.monthly, c.id, group, ''))) toast('まとめを解きました');
          },
        },
      ],
    });
  }

  async function renameGroupFlow(c, group) {
    const name = await promptDialog({
      title: 'まとめの名前を変更',
      label: 'まとめの名前',
      value: group,
      hint: '同じ区分にある別のまとめと同じ名前にすると、1 つにまとまります。',
      maxLength: M.NAME_MAX,
    });
    if (name && name !== group && store.update((d) => M.renameGroup(d.monthly, c.id, group, name))) toast('まとめの名前を変更しました');
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
