/*
 * 入力フォームの共通部品(どの機能のダイアログでも使う)
 *   selectEl / segmented / ymPicker / monthChips / multiChips / choicePicker / checkbox / textInput /
 *   memoArea / dateInput / field / formFoot / errorLine / confirmDelete / openReorderSheet / moveButtons
 */
(function (root) {
  'use strict';
  const MT = root.MT;
  const U = MT.util;
  const { h, add, btn, icon, openSheet, confirmDialog } = MT.ui;

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

  /**
   * フォームの中の行(内訳・作業項目など)を上下に動かす ↑↓ ボタン。
   * 行の要素を入れ替え、順番の配列(rows)も同じように入れ替える。保存するときは rows の順に読む
   * @param {Array<{el: HTMLElement}>} rows
   * @param {{el: HTMLElement}} row
   * @param {string} label 読み上げ用の名前(例:内訳)
   */
  function moveButtons(rows, row, label) {
    const go = (dir, btnEl) => {
      const i = rows.indexOf(row);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= rows.length) return;
      const other = rows[j];
      if (dir < 0) other.el.before(row.el);
      else other.el.after(row.el);
      rows[i] = other;
      rows[j] = row;
      btnEl.focus({ preventScroll: true });
      row.el.scrollIntoView({ block: 'nearest' });
    };
    const up = h('button', { type: 'button', class: 'icon-btn icon-btn-sm', 'aria-label': `${label}を上へ` }, icon('up'));
    const down = h('button', { type: 'button', class: 'icon-btn icon-btn-sm', 'aria-label': `${label}を下へ` }, icon('down'));
    up.addEventListener('click', () => go(-1, up));
    down.addEventListener('click', () => go(1, down));
    return [up, down];
  }

  /**
   * 並べ替えのダイアログ。左のつまみを上下にドラッグするか、↑↓ で 1 つずつ動かし、「保存」で決める。
   * @param {object} o
   * @param {string} o.title
   * @param {string} [o.description] 説明(ドラッグの使い方の後ろに足す)
   * @param {Array<{id: string, label: string, sub?: string}>} o.items いまの順番(ほかのキーがあっても良い)
   * @param {Array<{id: string, label: string, sort: Function}>} [o.presets] 「〜順に並べる」ボタン。sort(items) は並べた配列を返す
   * @param {(ids: string[], preset: string|null) => void} o.onSave 順番が変わったとき・並べ方のボタンを使ったとき。
   *   preset は最後に押した並べ方のボタンの id(そのあと手で動かしたら null)
   */
  function openReorderSheet({ title, description = '', items, presets = [], onSave }) {
    const s = openSheet({
      title,
      description: ['左のつまみ(≡)を上下にドラッグするか、↑↓ で動かします。', description].filter(Boolean).join(''),
      className: 'sheet-reorder',
    });
    const byId = new Map(items.map((x) => [String(x.id), x]));
    const rowsById = new Map();
    const list = h('ul', { class: 'reorder-list' });
    let preset = null;
    let drag = null;

    const ids = () => [...list.children].map((li) => li.dataset.id);

    function refresh() {
      const lis = [...list.children];
      lis.forEach((li, i) => {
        li.querySelector('.rb-up').disabled = i === 0;
        li.querySelector('.rb-down').disabled = i === lis.length - 1;
      });
    }

    function step(li, dir, btnEl) {
      const other = dir < 0 ? li.previousElementSibling : li.nextElementSibling;
      if (!other) return;
      if (dir < 0) other.before(li);
      else other.after(li);
      preset = null;
      refresh();
      // 端に着いて押せなくなったら、反対のボタンへ
      const target = btnEl.disabled ? li.querySelector(dir < 0 ? '.rb-down' : '.rb-up') : btnEl;
      target.focus({ preventScroll: true });
      li.scrollIntoView({ block: 'nearest' });
    }

    // ---- ドラッグ(ダイアログ全体がスクロールするので、端に近づいたら自動で送る) ----
    const scroller = s.panel;
    function offset() {
      return drag.y - drag.startY + (scroller.scrollTop - drag.scroll0);
    }
    function place() {
      const { li } = drag;
      li.style.transform = `translateY(${offset()}px)`;
      // 隣の行の真ん中を越えたら入れ替える(速く動かしたときのため、越えなくなるまで繰り返す)
      for (let guard = 0; guard < 200; guard++) {
        const r = li.getBoundingClientRect();
        const mid = r.top + r.height / 2;
        const prev = li.previousElementSibling;
        const next = li.nextElementSibling;
        let swap = null;
        if (prev) {
          const pr = prev.getBoundingClientRect();
          if (mid < pr.top + pr.height / 2) swap = () => prev.before(li);
        }
        if (!swap && next) {
          const nr = next.getBoundingClientRect();
          if (mid > nr.top + nr.height / 2) swap = () => next.after(li);
        }
        if (!swap) break;
        const before = li.offsetTop;
        swap();
        drag.startY += li.offsetTop - before; // 並びが変わった分だけずらし、指の下に残す
        drag.moved = true;
        li.style.transform = `translateY(${offset()}px)`;
      }
    }
    function tick() {
      if (!drag) return;
      const r = scroller.getBoundingClientRect();
      const edge = 56;
      let v = 0;
      if (drag.y < r.top + edge) v = -Math.ceil((r.top + edge - drag.y) / 5);
      else if (drag.y > r.bottom - edge) v = Math.ceil((drag.y - (r.bottom - edge)) / 5);
      if (v) {
        const before = scroller.scrollTop;
        scroller.scrollTop = before + v;
        if (scroller.scrollTop !== before) place();
      }
      drag.raf = root.requestAnimationFrame(tick);
    }
    function onMove(e) {
      if (!drag || e.pointerId !== drag.pointerId) return;
      e.preventDefault();
      drag.y = e.clientY;
      place();
    }
    function endDrag(e) {
      if (!drag || e.pointerId !== drag.pointerId) return;
      const { li, handle, moved } = drag;
      root.cancelAnimationFrame(drag.raf);
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', endDrag);
      handle.removeEventListener('pointercancel', endDrag);
      li.style.transform = '';
      li.classList.remove('is-dragging');
      list.classList.remove('is-sorting');
      drag = null;
      if (moved) preset = null;
      refresh();
    }
    function startDrag(e, li) {
      if (drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
      e.preventDefault();
      const handle = e.currentTarget;
      try {
        handle.setPointerCapture(e.pointerId);
      } catch (err) {
        /* 取れなくても動かせる */
      }
      drag = { li, handle, pointerId: e.pointerId, startY: e.clientY, y: e.clientY, scroll0: scroller.scrollTop, raf: 0, moved: false };
      li.classList.add('is-dragging');
      list.classList.add('is-sorting');
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', endDrag);
      handle.addEventListener('pointercancel', endDrag);
      drag.raf = root.requestAnimationFrame(tick);
    }

    for (const x of items) {
      const name = String(x.label);
      const handle = h('span', { class: 'reorder-handle', 'aria-hidden': 'true' }, icon('grip'));
      const up = h('button', { type: 'button', class: 'icon-btn rb-up', 'aria-label': `「${name}」を上へ` }, icon('up'));
      const down = h('button', { type: 'button', class: 'icon-btn rb-down', 'aria-label': `「${name}」を下へ` }, icon('down'));
      const li = h(
        'li',
        { class: 'reorder-row', 'data-id': String(x.id) },
        handle,
        h('span', { class: 'reorder-text' }, h('span', { class: 'reorder-name', text: name }), x.sub ? h('small', { class: 'reorder-sub', text: x.sub }) : null),
        up,
        down
      );
      handle.addEventListener('pointerdown', (e) => startDrag(e, li));
      up.addEventListener('click', () => step(li, -1, up));
      down.addEventListener('click', () => step(li, 1, down));
      rowsById.set(String(x.id), li);
      list.append(li);
    }
    refresh();

    const presetRow = presets.length
      ? h(
          'div',
          { class: 'button-row reorder-presets' },
          presets.map((pr) =>
            btn(pr.label, {
              size: 'small',
              onClick: () => {
                for (const x of pr.sort(ids().map((id) => byId.get(id)))) list.append(rowsById.get(String(x.id)));
                preset = pr.id;
                refresh();
                MT.ui.toast(`${pr.label.replace(/に並べる$/, '')}に並べました(保存で決まります)`);
              },
            })
          )
        )
      : null;
    add(s.body, presetRow, list);

    const before = items.map((x) => String(x.id)).join('\n');
    s.foot.append(
      btn('キャンセル', { onClick: () => s.close() }),
      btn('保存', {
        variant: 'primary',
        onClick: () => {
          const now = ids();
          s.close();
          if (now.join('\n') !== before || preset) onSave(now, preset);
        },
      })
    );
    return s;
  }

  MT.forms = {
    selectEl,
    segmented,
    ymPicker,
    monthChips,
    multiChips,
    choicePicker,
    dateInput,
    checkbox,
    textInput,
    memoArea,
    field,
    formFoot,
    errorLine,
    confirmDelete,
    openReorderSheet,
    moveButtons,
  };
})(window);
