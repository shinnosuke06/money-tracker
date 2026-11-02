/*
 * 副業収入:入力ダイアログ
 *  日ごとの記録、依頼元の設定(作業項目・曜日パターン・支払い管理との対応)、支払い管理への連携
 */
(function (root) {
  'use strict';
  const MT = root.MT;
  const U = MT.util;
  const S = MT.sidejobModel;
  const store = MT.store;
  const { h, add, icon, btn, openSheet, confirmDialog, toast, amountField } = MT.ui;
  const { selectEl, segmented, multiChips, dateInput, textInput, field, formFoot, errorLine } = MT.forms;

  const sj = () => store.get().sidejob;
  const manYen = (v) => `${U.man(v)}(${U.yen(v)}円)`;

  // ---------------------------------------------------------------
  // 日ごとの記録
  // ---------------------------------------------------------------

  /**
   * @param {string|null} rid 記録の id(新規なら null)
   * @param {{date?: string, clientId?: string}} preset 新規のときの初期値
   */
  function openRecordSheet(rid, preset = {}) {
    const data = sj();
    if (!data.clients.length) {
      toast('先に「依頼元」を登録してください', { type: 'error' });
      MT.app.navigate('sidejob/clients');
      return;
    }
    const src = rid ? data.records.find((r) => r.id === rid) : null;
    const firstClient = S.findClient(data, preset.clientId) || data.clients[0];
    let draft = src ? JSON.parse(JSON.stringify(src)) : S.newDraft(firstClient, preset.date || U.todayStr());
    const s = openSheet({ title: src ? '記録を直す' : '記録を追加', className: 'sheet-form' });
    const err = errorLine();
    const date = dateInput(draft.date);
    const clientSel = selectEl(
      data.clients.map((c) => ({ value: c.id, label: c.name })).concat(src && !S.findClient(data, src.clientId) ? [{ value: src.clientId, label: '(削除された依頼元)' }] : []),
      draft.clientId,
      { 'aria-label': '依頼元' }
    );
    const base = amountField({ value: draft.base, label: '基本額', compact: true, onChange: updateTotal });
    const taskBox = h('div', { class: 'task-list' });
    const totalEl = h('p', { class: 'record-total', 'aria-live': 'polite' });
    const contentEl = h('p', { class: 'form-hint' });
    const memo = MT.forms.memoArea(draft.memo);
    const confirmed = MT.forms.checkbox('入金を確認した', draft.confirmed);
    let rows = []; // { name, check, amount }

    /** 依頼元の作業項目を並べる(記録にある項目は選んだ状態で。依頼元に無い項目もそのまま残す) */
    function buildTasks() {
      const client = S.findClient(sj(), clientSel.value);
      const chosen = new Map(draft.items.map((x) => [x.name, x.amount]));
      const list = (client ? client.tasks.map((t) => ({ name: t.name, amount: chosen.has(t.name) ? chosen.get(t.name) : t.amount, on: chosen.has(t.name) })) : []).concat(
        draft.items.filter((x) => !client || !client.tasks.some((t) => t.name === x.name)).map((x) => ({ name: x.name, amount: x.amount, on: true }))
      );
      taskBox.replaceChildren();
      rows = list.map((t) => {
        const check = h('input', { type: 'checkbox', checked: t.on, 'aria-label': `${t.name}を選ぶ` });
        const amount = amountField({ value: t.amount, label: `${t.name}の金額`, compact: true, onChange: updateTotal });
        check.addEventListener('change', updateTotal);
        taskBox.append(h('div', { class: 'task-row' }, h('label', { class: 'task-name' }, check, h('span', { text: t.name })), amount.el));
        return { name: t.name, check, amount };
      });
      if (!rows.length) taskBox.append(h('p', { class: 'form-hint', text: 'この依頼元には作業項目がありません(「依頼元」で登録できます)。' }));
      updateTotal();
    }

    function selectedItems() {
      return rows.filter((r) => r.check.checked).map((r) => ({ name: r.name, amount: r.amount.result().ok ? r.amount.result().value || 0 : 0 }));
    }

    function updateTotal() {
      if (!rows) return;
      const b = base.result();
      const items = selectedItems();
      const total = (b.ok ? b.value || 0 : 0) + items.reduce((t, x) => t + x.amount, 0);
      totalEl.textContent = `合計 ${manYen(total)}`;
      contentEl.textContent = items.length ? `内容:${S.contentOf(items)}` : draft.content ? `内容(旧データの文章):${draft.content}` : '内容:(作業項目を選ぶと自動で作ります)';
    }

    clientSel.addEventListener('change', () => {
      // 依頼元を変えたら、その依頼元の基本額と既定の作業項目にし直す
      const c = S.findClient(sj(), clientSel.value);
      draft = { ...draft, ...S.newDraft(c, date.value), id: draft.id, memo: memo.value, confirmed: confirmed.input.checked, content: '' };
      base.setValue(draft.base);
      buildTasks();
    });

    s.body.append(
      h('div', { class: 'form-2col' }, field('日付', date), field('依頼元', clientSel)),
      field('基本額', base.el),
      h('div', { class: 'form-row' }, h('span', { class: 'form-label', text: '作業項目(オンオフと金額を変えられます)' }), taskBox),
      totalEl,
      contentEl,
      field('メモ', memo),
      confirmed.el,
      err.el
    );
    buildTasks();

    function save() {
      err.hide();
      if (!U.isDateStr(date.value)) return err.show('日付を入れてください', date);
      const b = base.result();
      if (!b.ok || (b.value !== null && b.value < 0)) return err.show('基本額を確かめてください', base.input);
      for (const r of rows) {
        const a = r.amount.result();
        if (r.check.checked && (!a.ok || (a.value !== null && a.value < 0))) return err.show(`「${r.name}」の金額を確かめてください`, r.amount.input);
      }
      const items = selectedItems();
      const rec = {
        id: draft.id || U.uid('rec'),
        date: date.value,
        clientId: clientSel.value,
        base: b.value || 0,
        items,
        content: items.length ? S.contentOf(items) : draft.content,
        memo: memo.value,
        confirmed: confirmed.input.checked,
      };
      if (store.update((d) => S.saveRecord(d.sidejob, rec))) {
        s.close();
        toast(src ? '保存しました' : `${U.dayLabel(rec.date)} の記録を追加しました`);
      }
    }
    async function remove() {
      if (!(await deleteRecordConfirm(src))) return;
      s.close();
    }
    formFoot(s, { onSave: save, onDelete: src ? remove : null });
  }

  /** 記録を消す(確認あり)。消したら true */
  async function deleteRecordConfirm(rec) {
    const ok = await confirmDialog({
      title: `${U.dayLabel(rec.date)} の記録を削除しますか?`,
      message: [`${S.clientName(sj(), rec.clientId)}・${U.man(S.recordTotal(rec))}`, '間違えた場合は、設定の「直前のデータに戻す」で元に戻せます。'],
      okLabel: '削除する',
      danger: true,
    });
    if (!ok) return false;
    if (store.update((d) => S.removeRecord(d.sidejob, rec.id), { backup: '副業の記録の削除' })) toast('削除しました');
    return true;
  }

  // ---------------------------------------------------------------
  // 依頼元の設定
  // ---------------------------------------------------------------

  function openClientSheet(cid) {
    const d = store.get();
    const src = cid ? S.findClient(d.sidejob, cid) : null;
    if (!src && d.sidejob.clients.length >= S.MAX_CLIENTS) {
      toast(`依頼元は ${S.MAX_CLIENTS}件までです`, { type: 'error' });
      return;
    }
    const draft = src ? JSON.parse(JSON.stringify(src)) : S.cleanClient({ name: '', weekdays: [] });
    const s = openSheet({ title: src ? '依頼元を編集' : '依頼元を追加', className: 'sheet-form' });
    const err = errorLine();
    const name = textInput(src ? draft.name : '', { maxlength: S.NAME_MAX, placeholder: '例:依頼元A', 'aria-label': '依頼元の名前' });
    const base = amountField({ value: draft.baseAmount, label: '基本額', compact: true });
    const taskBox = h('div', { class: 'task-list' });
    let taskRows = [];
    function addTaskRow(t) {
      const row = { id: t.id || U.uid('tsk') };
      row.name = textInput(t.name, { class: 'field-input field-sm', maxlength: S.NAME_MAX, placeholder: '作業項目の名前', 'aria-label': '作業項目の名前' });
      row.amount = amountField({ value: t.amount, label: '作業項目の金額', compact: true });
      row.def = h('input', { type: 'checkbox', checked: t.isDefault, 'aria-label': '既定で選ぶ' });
      row.el = h(
        'div',
        { class: 'sub-row' },
        h('div', { class: 'sub-row-top' }, row.name, h('button', { type: 'button', class: 'icon-btn', 'aria-label': '作業項目を削除', onClick: () => { taskRows = taskRows.filter((x) => x !== row); row.el.remove(); } }, icon('close'))),
        h('div', { class: 'sub-row-mid' }, row.amount.el, h('label', { class: 'check check-inline' }, row.def, h('span', { text: '既定で選ぶ' })))
      );
      taskRows.push(row);
      taskBox.append(row.el);
      return row;
    }
    draft.tasks.forEach(addTaskRow);
    const weekdays = multiChips(U.WEEKDAYS.map((w, i) => ({ value: i, label: w })), draft.weekdays, { label: '曜日パターン' });
    const incomes = d.payments ? d.payments.incomes : [];
    const income = selectEl([{ value: '', label: '連携しない' }].concat(incomes.map((i) => ({ value: i.id, label: i.name }))), draft.payment.incomeId || '', { 'aria-label': '対応する入金予定' });
    const timing = segmented(
      [
        { value: 'next', label: '働いた月の翌月' },
        { value: 'same', label: '働いた月の当月' },
      ],
      draft.payment.timing,
      { label: '入金のタイミング' }
    );
    const day = selectEl([{ value: '', label: '未定' }].concat(Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: i === 30 ? '31日(末日)' : `${i + 1}日` }))), draft.payment.day || '', { 'aria-label': '入金日' });
    const memo = MT.forms.memoArea(draft.memo);

    s.body.append(
      field('名前', name),
      field('基本額(1日あたり)', base.el),
      h(
        'section',
        { class: 'form-section' },
        h('h3', { class: 'form-section-title', text: '作業項目' }),
        h('p', { class: 'form-hint', text: '「既定で選ぶ」にした項目は、記録を作るときに最初から選ばれます。' }),
        taskBox,
        btn('作業項目を追加', { icon: 'plus', variant: 'ghost', size: 'small', onClick: () => addTaskRow({ name: '', amount: 0, isDefault: true }).name.focus() })
      ),
      field('曜日パターン', weekdays.el, '予定を自動で作るときに使います。'),
      h(
        'section',
        { class: 'form-section' },
        h('h3', { class: 'form-section-title', text: '支払い管理との連携' }),
        field('対応する入金予定', income, incomes.length ? '' : '支払い管理に入金予定がまだありません。'),
        field('入金のタイミング', timing.el),
        field('入金日', day)
      ),
      field('メモ', memo),
      err.el
    );

    function save() {
      err.hide();
      const n = name.value.trim();
      if (!n) return err.show('名前を入力してください', name);
      const b = base.result();
      if (!b.ok || (b.value !== null && b.value < 0)) return err.show('基本額を確かめてください', base.input);
      const tasks = [];
      for (const r of taskRows) {
        const tn = r.name.value.trim();
        if (!tn) continue;
        const a = r.amount.result();
        if (!a.ok || (a.value !== null && a.value < 0)) return err.show(`「${tn}」の金額を確かめてください`, r.amount.input);
        tasks.push({ id: r.id, name: tn, amount: a.value || 0, isDefault: r.def.checked });
      }
      const c = {
        id: draft.id || U.uid('cli'),
        name: n,
        baseAmount: b.value || 0,
        tasks,
        weekdays: weekdays.value(),
        payment: { incomeId: income.value || null, timing: timing.value(), day: day.value ? Number(day.value) : null },
        memo: memo.value,
      };
      let ok = false;
      store.update((dd) => (ok = !!S.saveClient(dd.sidejob, c)));
      if (!ok) return err.show(`依頼元は ${S.MAX_CLIENTS}件までです`);
      s.close();
      toast(src ? '保存しました' : '依頼元を追加しました');
    }
    async function remove() {
      const count = sj().records.filter((r) => r.clientId === src.id).length;
      const ok = await confirmDialog({
        title: `「${src.name}」を削除しますか?`,
        message: [count ? `この依頼元の記録 ${count}件と予定も削除されます。` : 'この依頼元の記録はありません。', '間違えた場合は、設定の「直前のデータに戻す」で元に戻せます。'],
        okLabel: '削除する',
        danger: true,
      });
      if (!ok) return;
      if (store.update((dd) => S.removeClient(dd.sidejob, src.id), { backup: `依頼元「${src.name}」の削除` })) {
        s.close();
        toast('削除しました');
      }
    }
    formFoot(s, { onSave: save, onDelete: src ? remove : null });
    if (!src) name.focus();
  }

  // ---------------------------------------------------------------
  // 支払い管理への連携
  // ---------------------------------------------------------------

  function openPaymentLinkSheet() {
    const d = store.get();
    const plan = S.paymentPlan(d, U.todayStr());
    const s = openSheet({
      title: '支払い管理の入金予定に入れる',
      description: `支払い管理で管理中の ${U.ymLabel(plan.target)} の入金予定に、働いた月の予想額(確認済み + 予定)を入れます。`,
      className: 'sheet-form',
    });
    if (!plan.rows.length) {
      s.body.append(h('p', { class: 'sheet-text', text: '入金予定と対応している依頼元がありません。「依頼元」の編集で「対応する入金予定」を選んでください。' }));
      s.foot.append(btn('閉じる', { onClick: () => s.close() }));
      return;
    }
    add(
      s.body,
      plan.rows.map((r) =>
        h(
          'div',
          { class: 'link-block' },
          h(
            'div',
            { class: 'reflect-row' },
            h('span', { class: 'reflect-name', text: r.incomeName }),
            h('span', { class: 'reflect-from', text: r.from === null ? '未入力' : U.yen(r.from) }),
            h('span', { class: 'reflect-arrow', 'aria-hidden': 'true', text: '→' }),
            h('span', { class: 'reflect-to', text: U.yen(r.to) })
          ),
          h(
            'ul',
            { class: 'report-list' },
            r.sources.map((x) =>
              h('li', { text: `${x.clientName}:${U.ymLabel(x.workMonth)}分 ${U.man(x.amount)}(${x.timing === 'same' ? '当月' : '翌月'}${x.day ? `${x.day}日` : ''}入金)` })
            )
          )
        )
      ),
      h('p', { class: 'form-hint', text: '今の金額は上書きされます。' })
    );
    formFoot(s, {
      saveLabel: '上書きして入れる',
      onSave: async () => {
        const ok = await confirmDialog({
          title: '入金予定の金額を上書きしますか?',
          message: plan.rows.map((r) => `${r.incomeName}:${r.from === null ? '未入力' : U.yen(r.from) + '円'} → ${U.yen(r.to)}円`),
          okLabel: '上書きする',
        });
        if (!ok) return;
        if (store.update((dd) => S.applyPaymentPlan(dd, U.todayStr()), { backup: '副業の予想額を入金予定へ' })) {
          s.close();
          toast('入金予定に入れました');
        }
      },
    });
  }

  MT.sidejobUI = { openRecordSheet, deleteRecordConfirm, openClientSheet, openPaymentLinkSheet };
})(window);
