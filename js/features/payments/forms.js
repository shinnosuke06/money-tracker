/*
 * 支払い管理:入力用の部品とダイアログ
 *  - 支払い・ローン(内訳つき)、入金予定、特別支出、現在残高、振り分け、月末記録への反映、メモ
 */
(function (root) {
  'use strict';
  const MT = root.MT;
  const U = MT.util;
  const P = MT.paymentsModel;
  const store = MT.store;
  const { h, add, icon, btn, openSheet, confirmDialog, toast, amountField } = MT.ui;

  const data = () => store.get();
  const pay = () => store.get().payments;
  const today = () => U.todayStr();

  // ---------------------------------------------------------------
  // 小さな部品
  // ---------------------------------------------------------------

  const { selectEl, segmented, ymPicker, checkbox, textInput, field, formFoot, errorLine, confirmDelete, moveButtons } = MT.forms;
  const memoArea = (value) => MT.forms.memoArea(value, P.MEMO_MAX);

  /** 口座の選択(口座なし + 支払いで使う口座) */
  function accountSelect(d, value, { noneLabel = '口座なし', label = '口座' } = {}) {
    const options = [{ value: '', label: noneLabel }].concat(
      d.payments.accounts.map((a) => ({ value: a.itemId, label: `${P.accountName(d, a.itemId)}${a.kind === 'cash' ? '(手元現金)' : ''}` }))
    );
    return selectEl(options, value, { 'aria-label': label });
  }

  function catDot(id) {
    return h('span', { class: `cat-dot cat-${id}`, 'aria-hidden': 'true' });
  }

  function catChip(id) {
    return h('span', { class: 'chip' }, catDot(id), P.categoryLabel(id));
  }

  function moneyText(v) {
    return v === null || v === undefined ? '未入力' : `${U.yen(v)}円`;
  }

  // ---------------------------------------------------------------
  // 支払い・ローン
  // ---------------------------------------------------------------

  function openBillSheet(id) {
    const d = data();
    const p = d.payments;
    const month = p.month;
    const src = id ? p.bills.find((b) => b.id === id) : null;
    const firstBank = p.accounts.find((a) => a.kind === 'bank');
    const draft = src
      ? JSON.parse(JSON.stringify(src))
      : { id: null, name: '', amount: null, dueDay: null, accountId: firstBank ? firstBank.itemId : null, category: 'fixed', endMonth: null, memo: '', done: false, subItems: [] };

    const s = openSheet({ title: src ? '支払いを編集' : '支払いを追加', className: 'sheet-form' });
    const err = errorLine();
    const nameInput = textInput(draft.name, { maxlength: P.NAME_MAX, placeholder: '例:クレジットカードA', 'aria-label': '項目名' });
    const amount = amountField({ value: draft.amount, label: '請求額', onChange: updateSummary });
    const cat = segmented(
      P.CATEGORIES.map((c) => ({ value: c.id, label: c.label })),
      draft.category,
      { label: 'カテゴリ', onChange: updateSummary }
    );
    const daySel = selectEl(
      [{ value: '', label: '未定' }].concat(Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: i === 30 ? '31日(末日)' : `${i + 1}日` }))),
      draft.dueDay,
      { 'aria-label': '引き落とし日' }
    );
    const accSel = accountSelect(d, draft.accountId, { label: '引き落とし口座' });
    const end = ymPicker(draft.endMonth, { from: month, label: '終了月' });
    const done = checkbox('済(支払い済み)', draft.done);
    const memo = memoArea(draft.memo);

    // 内訳
    const subRows = [];
    const subList = h('div', { class: 'sub-list' });
    const summary = h('div', { class: 'sub-summary', 'aria-live': 'polite' });

    function addSubRow(sub) {
      const row = { id: sub.id || U.uid('sub') };
      row.name = textInput(sub.name, { class: 'field-input field-sm', maxlength: P.NAME_MAX, placeholder: '内訳の名前', 'aria-label': '内訳の名前' });
      row.amount = amountField({ value: sub.amount, compact: true, label: '内訳の金額', onChange: updateSummary });
      row.cat = selectEl(
        P.CATEGORIES.map((c) => ({ value: c.id, label: c.label })),
        sub.category,
        { class: 'field-select field-sm', 'aria-label': '内訳のカテゴリ' }
      );
      row.cat.addEventListener('change', updateSummary);
      row.end = ymPicker(sub.endMonth, { from: month, label: '内訳の終了月' });
      row.memo = textInput(sub.memo, { class: 'field-input field-sm', maxlength: P.MEMO_MAX, placeholder: 'メモ', 'aria-label': '内訳のメモ' });
      const remove = h(
        'button',
        {
          type: 'button',
          class: 'icon-btn',
          'aria-label': '内訳を削除',
          onClick: () => {
            subRows.splice(subRows.indexOf(row), 1);
            row.el.remove();
            updateSummary();
          },
        },
        icon('close')
      );
      const ended = sub.endMonth && sub.endMonth < month;
      row.el = h(
        'div',
        { class: `sub-row${ended ? ' is-ended' : ''}` },
        h('div', { class: 'sub-row-top' }, row.name, ...moveButtons(subRows, row, '内訳'), remove),
        h('div', { class: 'sub-row-mid' }, row.amount.el, row.cat),
        ended ? h('p', { class: 'form-hint', text: `終了月(${U.ymLabel(sub.endMonth)})を過ぎているため、計算には入りません` }) : null,
        h(
          'details',
          { class: 'sub-more', open: !!(sub.endMonth || sub.memo) },
          h('summary', { text: '終了月・メモ' }),
          field('終了月', row.end.el),
          field('メモ', row.memo)
        )
      );
      subRows.push(row);
      subList.append(row.el);
      return row;
    }

    function updateSummary() {
      if (!subRows.length) {
        summary.replaceChildren();
        return;
      }
      const a = amount.result();
      let subSum = 0;
      for (const r of subRows) {
        const e = r.end.value();
        if (e && e < month) continue;
        const v = r.amount.result();
        if (v.ok) subSum += v.value || 0;
      }
      const catLabel = P.categoryLabel(cat.value());
      summary.className = 'sub-summary';
      if (!a.ok) summary.textContent = `内訳の合計:${U.yen(subSum)}円`;
      else if (a.value === null) summary.textContent = `内訳の合計:${U.yen(subSum)}円(請求額が空欄なので、この合計を支払額として計算します)`;
      else if (subSum > a.value) {
        summary.className = 'sub-summary is-warn';
        summary.textContent = `内訳の合計(${U.yen(subSum)}円)が請求額(${U.yen(a.value)}円)を ${U.yen(subSum - a.value)}円 超えています。金額を確認してください。`;
      } else summary.textContent = `内訳の合計:${U.yen(subSum)}円 ・ 残り ${U.yen(a.value - subSum)}円は「${catLabel}」に計上`;
    }

    draft.subItems.forEach(addSubRow);

    s.body.append(
      field('項目名', nameInput),
      field('請求額', amount.el, '1000+500 のような式も使えます。変動費は月が変わると空欄に戻ります。'),
      field('カテゴリ', cat.el),
      h('div', { class: 'form-2col' }, field('引き落とし日', daySel), field('引き落とし口座', accSel)),
      field('終了月(任意)', end.el, '終了月を過ぎると、一覧から自動で外れます。'),
      done.el,
      h(
        'section',
        { class: 'form-section' },
        h('h3', { class: 'form-section-title', text: '内訳(明細)' }),
        h('p', { class: 'form-hint', text: 'カードの請求などを内訳に分けられます。内訳ごとにカテゴリを選べます。' }),
        subList,
        summary,
        btn('内訳を追加', {
          icon: 'plus',
          variant: 'ghost',
          size: 'small',
          onClick: () => {
            const r = addSubRow({ name: '', amount: null, category: cat.value(), endMonth: null, memo: '' });
            updateSummary();
            r.name.focus();
          },
        })
      ),
      field('メモ', memo),
      err.el
    );
    updateSummary();

    function save() {
      err.hide();
      const name = nameInput.value.trim();
      if (!name) return err.show('項目名を入力してください', nameInput);
      const a = amount.result();
      if (!a.ok) return err.show(`請求額:${a.error}`, amount.input);
      const subs = [];
      for (const r of subRows) {
        const v = r.amount.result();
        const label = r.name.value.trim() || '名前なし';
        if (!v.ok) return err.show(`内訳「${label}」:${v.error}`, r.amount.input);
        subs.push({ id: r.id, name: r.name.value.trim() || '内訳', amount: v.value, category: r.cat.value, endMonth: r.end.value(), memo: r.memo.value });
      }
      const bill = {
        id: draft.id || U.uid('bill'),
        name,
        amount: a.value,
        dueDay: daySel.value ? Number(daySel.value) : null,
        accountId: accSel.value || null,
        category: cat.value(),
        endMonth: end.value(),
        memo: memo.value,
        done: done.input.checked,
        subItems: subs,
      };
      if (store.update((dd) => P.saveBill(dd.payments, bill))) {
        s.close();
        toast(src ? '保存しました' : '支払いを追加しました');
      }
    }

    async function remove() {
      if (!(await confirmDelete(draft.name, '支払い'))) return;
      if (store.update((dd) => P.removeById(dd.payments, 'bills', draft.id), { backup: `支払い「${draft.name}」の削除` })) {
        s.close();
        toast('削除しました');
      }
    }

    formFoot(s, { onSave: save, onDelete: src ? remove : null });
    if (!src) nameInput.focus();
  }

  // ---------------------------------------------------------------
  // 入金予定
  // ---------------------------------------------------------------

  function openIncomeSheet(id) {
    const d = data();
    const src = id ? d.payments.incomes.find((x) => x.id === id) : null;
    const draft = src ? { ...src } : { id: null, name: '', amount: null, fixed: true, targetId: null, done: false, memo: '' };
    const s = openSheet({ title: src ? '入金予定を編集' : '入金予定を追加', className: 'sheet-form' });
    const err = errorLine();
    const nameInput = textInput(draft.name, { maxlength: P.NAME_MAX, placeholder: '例:給与', 'aria-label': '項目名' });
    const amount = amountField({ value: draft.amount, label: '金額' });
    const kind = segmented(
      [
        { value: 'fixed', label: '毎月固定' },
        { value: 'variable', label: '変動' },
      ],
      draft.fixed ? 'fixed' : 'variable',
      { label: '種類' }
    );
    const target = accountSelect(d, draft.targetId, { noneLabel: '指定なし', label: '優先振込先' });
    const done = checkbox('済(入金済み)', draft.done);
    const memo = memoArea(draft.memo);

    const auto = src && MT.sidejobModel ? MT.sidejobModel.clientsForIncome(d.sidejob, src.id) : [];
    add(
      s.body,
      auto.length ? h('p', { class: 'calc-preview', text: `この入金予定には、副業(${auto.map((c) => c.name).join('・')})の予想額が自動で入ります。入金済みにすると、そのあとは変わりません。` }) : null,
      field('項目名', nameInput),
      field('金額', amount.el, '変動の入金は、月が変わると空欄に戻ります。空欄のままだと赤で「未入力」と出ます。'),
      field('種類', kind.el),
      field('優先振込先', target, '振り分けでは、優先振込先のある入金から先に使います。'),
      done.el,
      field('メモ', memo),
      err.el
    );

    function save() {
      err.hide();
      const name = nameInput.value.trim();
      if (!name) return err.show('項目名を入力してください', nameInput);
      const a = amount.result();
      if (!a.ok) return err.show(`金額:${a.error}`, amount.input);
      const income = {
        id: draft.id || U.uid('inc'),
        name,
        amount: a.value,
        fixed: kind.value() === 'fixed',
        targetId: target.value || null,
        done: done.input.checked,
        memo: memo.value,
      };
      const report = {};
      if (store.update((dd) => P.saveIncome(dd.payments, income, U.todayStr(), report))) {
        s.close();
        const msg = P.creditMessage(store.get(), report);
        toast(`${src ? '保存しました' : '入金予定を追加しました'}${msg ? `。${msg}` : ''}`, msg ? { duration: 4200 } : undefined);
      }
    }

    async function remove() {
      if (!(await confirmDelete(draft.name, '入金予定'))) return;
      if (store.update((dd) => P.removeById(dd.payments, 'incomes', draft.id), { backup: `入金予定「${draft.name}」の削除` })) {
        s.close();
        toast('削除しました');
      }
    }

    formFoot(s, { onSave: save, onDelete: src ? remove : null });
    if (!src) nameInput.focus();
  }

  // ---------------------------------------------------------------
  // 特別支出
  // ---------------------------------------------------------------

  function openSpecialSheet(id) {
    const d = data();
    const p = d.payments;
    const src = id ? p.specials.find((x) => x.id === id) : null;
    const draft = src ? { ...src } : { id: null, name: '', amount: null, month: U.ymAdd(p.month, 1), accountId: null, done: false, memo: '' };
    const s = openSheet({ title: src ? '特別支出を編集' : '特別支出を追加', className: 'sheet-form' });
    const err = errorLine();
    const nameInput = textInput(draft.name, { maxlength: P.NAME_MAX, placeholder: '例:固定資産税、車検', 'aria-label': '項目名' });
    const amount = amountField({ value: draft.amount, label: '金額' });
    const month = ymPicker(draft.month, { allowNone: false, from: U.ymAdd(p.month, -12), years: 40, label: '支払月' });
    const acc = accountSelect(d, draft.accountId, { noneLabel: '指定なし', label: '引き落とし口座' });
    const done = checkbox('済(支払い済み)', draft.done);
    const memo = memoArea(draft.memo);

    s.body.append(
      field('項目名', nameInput),
      field('金額', amount.el),
      field('支払月', month.el, '支払月になると、その月の支払いに含めます。'),
      field('引き落とし口座(任意)', acc),
      done.el,
      field('メモ', memo),
      err.el
    );

    function save() {
      err.hide();
      const name = nameInput.value.trim();
      if (!name) return err.show('項目名を入力してください', nameInput);
      const a = amount.result();
      if (!a.ok) return err.show(`金額:${a.error}`, amount.input);
      const sp = { id: draft.id || U.uid('sp'), name, amount: a.value, month: month.value(), accountId: acc.value || null, done: done.input.checked, memo: memo.value };
      if (store.update((dd) => P.saveSpecial(dd.payments, sp))) {
        s.close();
        toast(src ? '保存しました' : '特別支出を追加しました');
      }
    }

    async function remove() {
      if (!(await confirmDelete(draft.name, '特別支出'))) return;
      if (store.update((dd) => P.removeById(dd.payments, 'specials', draft.id), { backup: `特別支出「${draft.name}」の削除` })) {
        s.close();
        toast('削除しました');
      }
    }

    formFoot(s, { onSave: save, onDelete: src ? remove : null });
    if (!src) nameInput.focus();
  }

  // ---------------------------------------------------------------
  // 現在残高
  // ---------------------------------------------------------------

  function openBalanceSheet(itemId) {
    const d = data();
    const a = P.findAccount(d.payments, itemId);
    if (!a) return;
    const name = P.accountName(d, itemId);
    const s = openSheet({ title: name, description: '現在残高', className: 'sheet-input' });
    const err = errorLine();
    const amount = amountField({ value: a.balance, size: 'large', label: '現在残高' });
    const MM = MT.monthlyModel;
    let latest = null;
    for (const ym of MM.months(d.monthly).reverse()) {
      const v = MM.getValue(d.monthly, ym, itemId);
      if (v !== null) {
        latest = { ym, v };
        break;
      }
    }
    add(
      s.body,
      h('p', { class: 'amount-ref', text: a.balanceDate ? `最終更新:${U.shortDate(a.balanceDate)}` : '残高はまだ更新していません' }),
      amount.el,
      latest
        ? h(
            'div',
            { class: 'chip-row' },
            btn(`月末記録(${U.monthLabel(latest.ym)}):${U.yen(latest.v)}円 を入れる`, {
              size: 'small',
              keepFocus: true,
              onClick: () => {
                amount.setValue(latest.v);
                amount.focus();
              },
            })
          )
        : null,
      err.el
    );
    function save() {
      const r = amount.result();
      if (!r.ok) return err.show(r.error, amount.input);
      if (store.update((dd) => P.setBalance(dd.payments, itemId, r.value, today()))) {
        s.close();
        toast('残高を更新しました');
      }
    }
    s.body.addEventListener('submit', (e) => e.preventDefault());
    amount.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') save();
    });
    formFoot(s, { onSave: save });
    amount.focus();
  }

  // ---------------------------------------------------------------
  // 振り分け
  // ---------------------------------------------------------------

  /** 振り分け 1 行を直す(incomeId, accountId が無ければ新しく追加) */
  function openAllocationSheet(incomeId, accountId, current) {
    const d = data();
    const p = d.payments;
    const isNew = !incomeId;
    const s = openSheet({ title: isNew ? '振り分けを追加' : '振り分けを直す', className: 'sheet-form' });
    const err = errorLine();
    const pending = P.pendingIncomes(p);
    const incSel = selectEl(
      pending.map((i) => ({ value: i.id, label: `${i.name}(${U.yen(i.amount)}円)` })),
      incomeId || (pending[0] && pending[0].id),
      { 'aria-label': '入金' }
    );
    const accSel = accountSelect(d, accountId || (p.accounts[0] && p.accounts[0].itemId), { noneLabel: '—', label: '振込先' });
    const amount = amountField({ value: current == null ? null : current, size: 'large', label: '振り分ける金額' });
    const info = h('p', { class: 'form-hint' });

    function updateInfo() {
      const plan = P.planSummary(p, p.month);
      const inc = p.incomes.find((i) => i.id === incSel.value);
      if (!inc) return;
      const usedElsewhere = plan.items.filter((x) => x.incomeId === inc.id && x.accountId !== accSel.value).reduce((t, x) => t + x.amount, 0);
      info.textContent = `入金額 ${U.yen(inc.amount || 0)}円 / ほかの口座への振り分け ${U.yen(usedElsewhere)}円`;
    }
    incSel.addEventListener('change', updateInfo);
    accSel.addEventListener('change', updateInfo);

    if (!pending.length) {
      s.body.append(h('p', { class: 'sheet-text', text: 'まだ入金していない入金予定がありません。' }));
      s.foot.append(btn('閉じる', { onClick: () => s.close() }));
      return;
    }
    add(
      s.body,
      isNew ? field('入金', incSel) : h('p', { class: 'sheet-text', text: `${p.incomes.find((i) => i.id === incomeId).name} → ${P.accountName(d, accountId)}` }),
      isNew ? field('振込先', accSel) : null,
      field('金額', amount.el, '0 または空欄で保存すると、この振り分けを消します。'),
      info,
      err.el
    );
    updateInfo();

    function save() {
      const r = amount.result();
      if (!r.ok) return err.show(r.error, amount.input);
      const inc = isNew ? incSel.value : incomeId;
      const acc = isNew ? accSel.value : accountId;
      if (!inc || !acc) return err.show('入金と振込先を選んでください');
      if (store.update((dd) => P.setAllocation(dd.payments, dd.payments.month, inc, acc, r.value || 0))) {
        s.close();
        toast('振り分けを直しました(手動で調整中)');
      }
    }
    formFoot(s, { onSave: save });
    amount.focus();
  }

  // ---------------------------------------------------------------
  // 月末記録への反映
  // ---------------------------------------------------------------

  function openReflectSheet(preferMonth) {
    const d = data();
    const p = d.payments;
    const cur = p.month;
    const prev = U.ymAdd(cur, -1);
    let target = preferMonth || cur;
    const s = openSheet({ title: '月末記録に反映', description: '口座の現在残高を、月末記録の金額として書き込みます。', className: 'sheet-form' });
    const pick = segmented(
      [
        { value: cur, label: `${U.ymLabel(cur)}末` },
        { value: prev, label: `${U.ymLabel(prev)}末` },
      ],
      target === prev ? prev : cur,
      {
        label: '反映する月',
        onChange: (v) => {
          target = v;
          draw();
        },
      }
    );
    target = pick.value();
    const list = h('div', { class: 'reflect-list' });
    const note = h('p', { class: 'form-hint' });

    function draw() {
      const rows = P.reflectPreview(data(), target);
      list.replaceChildren(
        ...rows.map((r) =>
          h(
            'div',
            { class: 'reflect-row' },
            h('span', { class: 'reflect-name', text: r.name }),
            h('span', { class: 'reflect-from', text: r.from === null ? '未入力' : U.yen(r.from) }),
            h('span', { class: 'reflect-arrow', 'aria-hidden': 'true', text: '→' }),
            h('span', { class: 'reflect-to', text: U.yen(r.to) })
          )
        )
      );
      if (!rows.length) list.append(h('p', { class: 'sheet-text', text: '現在残高が入っている口座がありません。' }));
      note.textContent = data().monthly.records[target]
        ? '書き込んだ値は「入力済み」になります。'
        : `${U.ymLabel(target)}の記録はまだないので作成します(ほかの項目は前月の値をコピーします)。`;
    }
    draw();
    s.body.append(field('反映する月', pick.el), list, note);
    formFoot(s, {
      saveLabel: '反映する',
      onSave: () => {
        let n = 0;
        if (store.update((dd) => (n = P.reflectToMonthly(dd, target, today())))) {
          s.close();
          toast(`${U.ymLabel(target)}末の月末記録に ${n}件 反映しました`);
        }
      },
    });
  }

  // ---------------------------------------------------------------
  // メモ
  // ---------------------------------------------------------------

  function openMemoSheet() {
    const s = openSheet({ title: '支払いのメモ', className: 'sheet-form' });
    const ta = h('textarea', { class: 'field-textarea', rows: 6, maxlength: P.MEMO_MAX, 'aria-label': 'メモ' });
    ta.value = pay().memo || '';
    s.body.append(ta);
    formFoot(s, {
      onSave: () => {
        if (store.update((dd) => (dd.payments.memo = ta.value.trim()))) {
          s.close();
          toast('メモを保存しました');
        }
      },
    });
    ta.focus();
  }

  MT.paymentsUI = {
    selectEl,
    accountSelect,
    segmented,
    ymPicker,
    field,
    catDot,
    catChip,
    moneyText,
    openBillSheet,
    openIncomeSheet,
    openSpecialSheet,
    openBalanceSheet,
    openAllocationSheet,
    openReflectSheet,
    openMemoSheet,
  };
})(window);
