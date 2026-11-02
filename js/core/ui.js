/*
 * 画面部品:要素づくり、アイコン、ボタン、ダイアログ(シート)、確認、通知
 * 利用者が入力した文字は必ず textContent で入れる(innerHTML は使わない)。
 */
(function (root) {
  'use strict';
  const MT = (root.MT = root.MT || {});
  const doc = root.document;

  /** h('div', { class: 'x', onClick: fn }, '文字', 子要素...) */
  function h(tag, props, ...children) {
    const el = doc.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, String(v));
      }
    }
    append(el, children);
    return el;
  }

  /**
   * 子要素を足す。null は飛ばし、配列は展開する。
   * (ブラウザの el.append() は null を "null" という文字にしてしまうので、こちらを使う)
   */
  function add(el, ...children) {
    append(el, children);
    return el;
  }

  function append(el, children) {
    for (const c of children) {
      if (c == null || c === false) continue;
      if (Array.isArray(c)) append(el, c);
      else el.append(c instanceof root.Node ? c : doc.createTextNode(String(c)));
    }
  }

  // 線のアイコン(24x24)。中身は固定の文字列だけ。
  const ICONS = {
    calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    card: '<rect x="2.5" y="5.5" width="19" height="13" rx="2.5"/><path d="M2.5 10h19M6.5 15h4"/>',
    coins:
      '<ellipse cx="12" cy="6.5" rx="7" ry="3"/><path d="M5 6.5v5c0 1.66 3.13 3 7 3s7-1.34 7-3v-5"/><path d="M5 11.5v5c0 1.66 3.13 3 7 3s7-1.34 7-3v-5"/>',
    trend: '<path d="M3.5 17.5l5-5 4 4 8-8"/><path d="M15 8.5h5.5V14"/>',
    settings:
      '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    edit: '<path d="M14.5 5.5l4 4L9 19H5v-4z"/><path d="M12.5 7.5l4 4"/>',
    back: '<path d="M14.5 5.5L8 12l6.5 6.5"/>',
    up: '<path d="M6.5 14.5L12 9l5.5 5.5"/>',
    down: '<path d="M6.5 9.5L12 15l5.5-5.5"/>',
    more: '<circle cx="6" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18" cy="12" r="1.3"/>',
    download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>',
    upload: '<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M5 19.5h14"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
    close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    check: '<path d="M5.5 12.5l4.2 4.2L18.5 8"/>',
    bank: '<path d="M4 10h16M5.5 10v7M10 10v7M14 10v7M18.5 10v7M3.5 19.5h17M12 4l8 4H4z"/>',
    wallet: '<rect x="3.5" y="6" width="17" height="13" rx="2.5"/><path d="M3.5 9.5h17M15.5 14h2"/>',
    sync: '<path d="M5 12a7 7 0 0 1 12-4.9L19 9"/><path d="M19 4.5V9h-4.5"/><path d="M19 12a7 7 0 0 1-12 4.9L5 15"/><path d="M5 19.5V15h4.5"/>',
    history: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9"/><path d="M4.5 4.5V9H9"/><path d="M12 8v4.5l3 2"/>',
    alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/>',
  };

  function icon(name, cls = '') {
    const span = doc.createElement('span');
    span.className = `icon ${cls}`.trim();
    span.setAttribute('aria-hidden', 'true');
    span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
    return span;
  }

  /**
   * ボタン
   * @param {string} label
   * @param {{variant?: 'primary'|'secondary'|'danger'|'ghost', size?: 'small', icon?: string, onClick?: Function, ariaLabel?: string, keepFocus?: boolean}} opts
   *   keepFocus: タップしても入力欄のキーボードを閉じない
   */
  function btn(label, opts = {}) {
    const cls = ['btn', `btn-${opts.variant || 'secondary'}`];
    if (opts.size) cls.push(`btn-${opts.size}`);
    if (opts.className) cls.push(opts.className);
    const b = h(
      'button',
      { type: opts.type || 'button', class: cls.join(' '), 'aria-label': opts.ariaLabel, onClick: opts.onClick },
      opts.icon ? icon(opts.icon) : null,
      label ? h('span', { text: label }) : null
    );
    if (opts.keepFocus) keepFocusOnTap(b);
    return b;
  }

  /** タップでフォーカスを奪わない(入力中のキーボードを閉じないため) */
  function keepFocusOnTap(el) {
    el.addEventListener('mousedown', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse') e.preventDefault();
    });
  }

  /**
   * 金額の入力欄(式も可)。数字キーボードのまま「+ − ×」を入れられるボタン付き。
   * 式のときは下に計算結果を出す。保存時に result() で整数にする。
   * @param {{value?: number|null, size?: 'normal'|'large', label?: string, placeholder?: string, onChange?: Function}} opts
   */
  function amountField(opts = {}) {
    const U = MT.util;
    // compact: 計算ボタンは入力中だけ出す(内訳など、欄が多いところ用)
    const input = h('input', {
      class: `amount-input${opts.size === 'large' ? ' is-large' : ''}`,
      type: 'text',
      inputmode: 'numeric',
      autocomplete: 'off',
      enterkeyhint: 'done',
      placeholder: opts.placeholder || '0',
      'aria-label': opts.label || '金額(円)',
    });
    const calc = h('span', { class: 'amount-calc', 'aria-live': 'polite' });

    function update() {
      const r = U.parseYen(input.value);
      calc.textContent = r.ok && r.isExpression && r.value !== null ? `= ${U.yen(r.value)}円` : '';
      if (opts.onChange) opts.onChange(r);
    }

    /** 普通の数字を打っているときだけ 3 桁区切りにする(カーソルが末尾のとき) */
    function reformat() {
      const raw = input.value;
      if (input.selectionStart !== raw.length) return;
      if (!/^\s*[-−ー▲]?[\d０-９,，\s]+$/.test(raw)) return;
      const r = U.parseYen(raw);
      if (!r.ok || r.value === null || r.isExpression) return;
      const neg = /^\s*[-−ー▲]/.test(raw);
      const next = (neg ? '-' : '') + U.yen(Math.abs(r.value));
      if (next !== raw) input.value = next;
    }

    function insert(text) {
      const len = input.value.length;
      const s = input.selectionStart == null ? len : input.selectionStart;
      const e = input.selectionEnd == null ? s : input.selectionEnd;
      input.value = input.value.slice(0, s) + text + input.value.slice(e);
      const pos = s + text.length;
      input.focus();
      try {
        input.setSelectionRange(pos, pos);
      } catch (err) {
        /* 何もしない */
      }
      update();
    }

    const opBtn = (text, insertText, aria) => {
      const b = h('button', { type: 'button', class: 'op-btn', 'aria-label': aria, text });
      keepFocusOnTap(b);
      b.addEventListener('click', () => insert(insertText));
      return b;
    };

    input.addEventListener('input', (e) => {
      if (!e.isComposing) reformat();
      update();
    });

    const el = h(
      'div',
      { class: `amount-field${opts.compact ? ' is-compact' : ''}` },
      h('div', { class: 'amount-row' }, input, h('span', { class: 'amount-unit', text: '円' })),
      h(
        'div',
        { class: 'amount-tools' },
        opBtn('+', '+', '足し算'),
        opBtn('−', '-', '引き算・マイナス'),
        opBtn('×', '×', '掛け算'),
        calc
      )
    );

    const api = {
      el,
      input,
      result: () => U.parseYen(input.value),
      setValue(v) {
        input.value = v == null ? '' : U.yenInput(v);
        update();
      },
      focus(select = true) {
        input.focus();
        if (select) {
          try {
            input.setSelectionRange(0, input.value.length);
          } catch (err) {
            /* 何もしない */
          }
        }
      },
    };
    if (opts.value != null) input.value = U.yenInput(opts.value);
    return api;
  }

  // ---- シート(ダイアログ) ----

  let lockCount = 0;
  function lockScroll() {
    if (lockCount++ === 0) doc.documentElement.classList.add('is-locked');
  }
  function unlockScroll() {
    if (--lockCount <= 0) {
      lockCount = 0;
      doc.documentElement.classList.remove('is-locked');
    }
  }

  let sheetSeq = 0;

  /**
   * 画面の上寄りに出るダイアログ(キーボードに隠れないように上寄せ)。
   * @returns {{panel, head, body, foot, close(result?), setTitle(text)}}
   */
  function openSheet({ title = '', description = '', className = '', onClose } = {}) {
    const titleId = `sheet-title-${++sheetSeq}`;
    const titleEl = h('h2', { class: 'sheet-title', id: titleId, text: title });
    const head = h('div', { class: 'sheet-head' }, titleEl, description ? h('p', { class: 'sheet-desc', text: description }) : null);
    const body = h('div', { class: 'sheet-body' });
    const foot = h('div', { class: 'sheet-foot' });
    const panel = h(
      'div',
      { class: `sheet ${className}`.trim(), role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
      head,
      body,
      foot
    );
    const backdrop = h('div', { class: 'sheet-backdrop' });
    const layer = h('div', { class: 'sheet-layer' }, backdrop, panel);
    const prevFocus = doc.activeElement;
    let closed = false;

    function isTop() {
      const layers = doc.querySelectorAll('.sheet-layer');
      return layers[layers.length - 1] === layer;
    }
    function onKey(e) {
      if (e.key === 'Escape' && isTop()) {
        e.preventDefault();
        close();
      }
    }
    function close(result) {
      if (closed) return;
      closed = true;
      layer.remove();
      doc.removeEventListener('keydown', onKey);
      if (vv) {
        vv.removeEventListener('resize', fitViewport);
        vv.removeEventListener('scroll', fitViewport);
      }
      unlockScroll();
      if (prevFocus && prevFocus.focus && doc.contains(prevFocus) && prevFocus !== doc.body) {
        try {
          prevFocus.focus({ preventScroll: true });
        } catch (e) {
          /* 何もしない */
        }
      }
      if (onClose) onClose(result);
    }

    // iPhone でキーボードが出たとき、見えている範囲にダイアログを収める
    const vv = root.visualViewport;
    function fitViewport() {
      layer.style.top = `${vv.offsetTop}px`;
      layer.style.height = `${vv.height}px`;
    }
    if (vv) {
      vv.addEventListener('resize', fitViewport);
      vv.addEventListener('scroll', fitViewport);
      fitViewport();
    }

    backdrop.addEventListener('click', () => close());
    doc.addEventListener('keydown', onKey);
    doc.body.append(layer);
    lockScroll();

    return {
      panel,
      head,
      body,
      foot,
      close,
      setTitle(text) {
        titleEl.textContent = text;
      },
    };
  }

  /** 確認ダイアログ。OK なら true */
  function confirmDialog({ title, message, okLabel = 'OK', cancelLabel = 'キャンセル', danger = false }) {
    return new Promise((resolve) => {
      const s = openSheet({ title, className: 'sheet-confirm', onClose: (r) => resolve(r === true) });
      for (const p of [].concat(message || []).filter(Boolean)) s.body.append(h('p', { class: 'sheet-text', text: p }));
      s.foot.append(
        btn(cancelLabel, { onClick: () => s.close(false) }),
        btn(okLabel, { variant: danger ? 'danger' : 'primary', onClick: () => s.close(true) })
      );
    });
  }

  /** 文字を 1 つ入力するダイアログ。キャンセルなら null */
  function promptDialog({ title, label, value = '', placeholder = '', okLabel = '保存', maxLength = 40 }) {
    return new Promise((resolve) => {
      let result = null;
      const s = openSheet({ title, onClose: () => resolve(result) });
      const input = h('input', {
        class: 'field-input',
        type: 'text',
        value,
        placeholder,
        maxlength: maxLength,
        autocomplete: 'off',
        enterkeyhint: 'done',
      });
      const err = h('p', { class: 'field-error', role: 'alert', hidden: true });
      function submit() {
        const v = input.value.trim();
        if (!v) {
          err.textContent = '名前を入力してください';
          err.hidden = false;
          input.focus();
          return;
        }
        result = v;
        s.close();
      }
      const form = h(
        'form',
        {
          class: 'field',
          onSubmit: (e) => {
            e.preventDefault();
            submit();
          },
        },
        h('label', { class: 'field-label' }, h('span', { text: label }), input),
        err
      );
      s.body.append(form);
      s.foot.append(btn('キャンセル', { onClick: () => s.close() }), btn(okLabel, { variant: 'primary', onClick: submit }));
      // iOS ではタップ処理の中で同期的に focus するとキーボードが開く
      input.focus();
      input.select();
    });
  }

  /** 選択肢の一覧。actions: [{ label, danger?, onSelect }](null は無視) */
  function actionSheet({ title, description, actions }) {
    const s = openSheet({ title, description, className: 'sheet-actions' });
    const list = h('div', { class: 'action-list' });
    for (const a of actions) {
      if (!a) continue;
      list.append(
        h(
          'button',
          {
            type: 'button',
            class: `action-item${a.danger ? ' is-danger' : ''}`,
            onClick: () => {
              s.close();
              a.onSelect();
            },
          },
          a.label
        )
      );
    }
    s.body.append(list);
    s.foot.append(btn('閉じる', { onClick: () => s.close() }));
    return s;
  }

  /** 画面下に短いお知らせ */
  function toast(message, { type = 'info', duration = 2600 } = {}) {
    let rootEl = doc.getElementById('toast-root');
    if (!rootEl) {
      rootEl = h('div', { id: 'toast-root', 'aria-live': 'polite' });
      doc.body.append(rootEl);
    }
    const t = h('div', { class: `toast toast-${type}`, role: type === 'error' ? 'alert' : 'status', text: message });
    rootEl.append(t);
    // 同時に出すのは 3 件まで(古いものから消す)
    while (rootEl.children.length > 3) rootEl.firstElementChild.remove();
    setTimeout(() => {
      t.classList.add('is-leaving');
      setTimeout(() => t.remove(), 300);
    }, duration);
  }

  MT.ui = { h, add, icon, btn, keepFocusOnTap, amountField, openSheet, confirmDialog, promptDialog, actionSheet, toast };
})(window);
