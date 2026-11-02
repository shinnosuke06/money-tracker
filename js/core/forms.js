/*
 * 入力フォームの共通部品(どの機能のダイアログでも使う)
 *   selectEl / segmented / ymPicker / monthChips / multiChips / choicePicker / checkbox / textInput /
 *   memoArea / dateInput / field / formFoot / errorLine / confirmDelete
 */
(function (root) {
  'use strict';
  const MT = root.MT;
  const U = MT.util;
  const { h, add, btn, confirmDialog } = MT.ui;

  function selectEl(options, value, attrs = {}) {
    const sel = h('select', { class: 'field-select', ...attrs });
    for (const o of options) sel.append(h('option', { value: o.value, disabled: o.disabled, text: o.label }));
    sel.value = value == null ? '' : String(value);
    return sel;
  }

  /** ボタンを並べた選択(どれか 1 つ) */
  function segmented(options, value, { label, onChange } = {}) {
    let current = value;
    const buttons = options.map((o) =>
      h('button', {
        type: 'button',
        role: 'radio',
        'aria-checked': String(o.value === current),
        text: o.label,
        onClick: () => {
          current = o.value;
          for (const [i, b] of buttons.entries()) b.setAttribute('aria-checked', String(options[i].value === current));
          if (onChange) onChange(current);
        },
      })
    );
    return { el: h('div', { class: 'seg seg-wide', role: 'radiogroup', 'aria-label': label }, buttons), value: () => current };
  }

  /** 年月の選択。allowNone なら「なし」を選べる */
  function ymPicker(value, { allowNone = true, from = U.currentYM(), years = 30, label = '年月' } = {}) {
    const fromY = U.splitYM(from).y;
    const curY = value ? Math.min(U.splitYM(value).y, fromY) : fromY;
    const yearOpts = [];
    if (allowNone) yearOpts.push({ value: '', label: 'なし' });
    for (let y = Math.min(curY, fromY - 1); y <= fromY + years; y++) yearOpts.push({ value: String(y), label: `${y}年` });
    const yearSel = selectEl(yearOpts, value ? U.splitYM(value).y : allowNone ? '' : fromY, { 'aria-label': `${label}(年)` });
    const monthSel = selectEl(
      Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}月` })),
      value ? U.splitYM(value).m : U.splitYM(from).m,
      { 'aria-label': `${label}(月)` }
    );
    const sync = () => {
      monthSel.disabled = yearSel.value === '';
    };
    yearSel.addEventListener('change', sync);
    sync();
    return {
      el: h('div', { class: 'ym-row' }, yearSel, monthSel),
      value: () => (yearSel.value === '' ? null : U.makeYM(Number(yearSel.value), Number(monthSel.value))),
    };
  }

  /** 1〜12月から複数選ぶ(支払月・権利確定月など) */
  function monthChips(selected, { label = '月', onChange } = {}) {
    const chosen = new Set(selected || []);
    const buttons = Array.from({ length: 12 }, (_, i) => {
      const m = i + 1;
      const b = h('button', {
        type: 'button',
        class: 'month-chip',
        'aria-pressed': String(chosen.has(m)),
        text: `${m}月`,
        onClick: () => {
          if (chosen.has(m)) chosen.delete(m);
          else chosen.add(m);
          b.setAttribute('aria-pressed', String(chosen.has(m)));
          if (onChange) onChange(value());
        },
      });
      return b;
    });
    const value = () => [...chosen].sort((a, b) => a - b);
    return { el: h('div', { class: 'month-chips', role: 'group', 'aria-label': label }, buttons), value };
  }

  /** 複数選べるボタンの並び(曜日など)。options: [{ value, label }] */
  function multiChips(options, selected, { label = '', onChange } = {}) {
    const chosen = new Set(selected || []);
    const buttons = options.map((o) => {
      const b = h('button', {
        type: 'button',
        class: 'month-chip',
        'aria-pressed': String(chosen.has(o.value)),
        text: o.label,
        onClick: () => {
          if (chosen.has(o.value)) chosen.delete(o.value);
          else chosen.add(o.value);
          b.setAttribute('aria-pressed', String(chosen.has(o.value)));
          if (onChange) onChange(value());
        },
      });
      return b;
    });
    const value = () => options.map((o) => o.value).filter((v) => chosen.has(v));
    return { el: h('div', { class: 'month-chips', role: 'group', 'aria-label': label, style: `grid-template-columns: repeat(${Math.min(options.length, 7)}, minmax(0, 1fr))` }, buttons), value };
  }

  /**
   * 過去の入力から選ぶ(「新しく入力…」で自由に入力)。names が空なら入力欄だけ。
   * @returns {{el, value(): string, onChange(fn)}}
   */
  function choicePicker(names, value, { label = '名前', placeholder = '', maxLength = 60 } = {}) {
    const NEW = '__new__';
    const listeners = [];
    const fire = () => listeners.forEach((f) => f());
    const input = textInput(names.length ? '' : value, { maxlength: maxLength, placeholder, 'aria-label': `${label}(入力)` });
    input.addEventListener('input', fire);
    if (!names.length) return { el: input, value: () => input.value.trim(), onChange: (f) => listeners.push(f), input };
    const initial = value && names.includes(value) ? value : value ? NEW : NEW;
    const sel = selectEl([{ value: NEW, label: '新しく入力…' }, ...names.map((n) => ({ value: n, label: n }))], initial, { 'aria-label': label });
    if (initial === NEW) input.value = value || '';
    const sync = () => {
      input.hidden = sel.value !== NEW;
    };
    sel.addEventListener('change', () => {
      sync();
      if (!input.hidden) input.focus();
      fire();
    });
    sync();
    return { el: h('div', { class: 'broker-pick' }, sel, input), value: () => (sel.value === NEW ? input.value.trim() : sel.value), onChange: (f) => listeners.push(f), input };
  }

  /** 日付の入力(YYYY-MM-DD) */
  function dateInput(value, label = '日付') {
    return h('input', { class: 'field-input', type: 'date', value: value || U.todayStr(), 'aria-label': label, required: true });
  }

  function checkbox(label, checked) {
    const input = h('input', { type: 'checkbox', checked });
    return { el: h('label', { class: 'check' }, input, h('span', { text: label })), input };
  }

  function textInput(value, attrs = {}) {
    return h('input', { class: 'field-input', type: 'text', autocomplete: 'off', value: value || '', ...attrs });
  }

  function memoArea(value, maxLength = 1000) {
    const ta = h('textarea', { class: 'field-textarea field-textarea-sm', rows: 2, maxlength: maxLength, 'aria-label': 'メモ' });
    ta.value = value || '';
    return ta;
  }

  /** ラベルつきの入力行 */
  function field(label, control, hint) {
    return h(
      'div',
      { class: 'form-row' },
      h('span', { class: 'form-label', text: label }),
      control,
      hint ? h('p', { class: 'form-hint', text: hint }) : null
    );
  }

  /** フォームの下部(削除・キャンセル・保存) */
  function formFoot(s, { onSave, onDelete, saveLabel = '保存' }) {
    add(
      s.foot,
      onDelete ? btn('削除', { variant: 'ghost', className: 'btn-ghost-danger', onClick: onDelete }) : null,
      btn('キャンセル', { onClick: () => s.close() }),
      btn(saveLabel, { variant: 'primary', onClick: onSave })
    );
  }

  function errorLine() {
    const el = h('p', { class: 'field-error', role: 'alert', hidden: true });
    return {
      el,
      show(msg, focusEl) {
        el.textContent = msg;
        el.hidden = false;
        if (focusEl) focusEl.focus();
        el.scrollIntoView({ block: 'nearest' });
      },
      hide() {
        el.hidden = true;
      },
    };
  }

  async function confirmDelete(name, kindLabel) {
    return confirmDialog({
      title: `「${name}」を削除しますか?`,
      message: [`この${kindLabel}を削除します。`, '間違えた場合は、設定の「直前のデータに戻す」で元に戻せます。'],
      okLabel: '削除する',
      danger: true,
    });
  }

  MT.forms = { selectEl, segmented, ymPicker, monthChips, multiChips, choicePicker, dateInput, checkbox, textInput, memoArea, field, formFoot, errorLine, confirmDelete };
})(window);
