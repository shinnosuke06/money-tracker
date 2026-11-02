/*
 * 月末記録:画面
 *  - 前月の記録がまだなら上に案内
 *  - 総資産と前月比
 *  - 表(横に月、縦に項目)。セルをタップして入力
 *  - 総資産の推移グラフ
 */
(function (root) {
  'use strict';
  const MT = root.MT;
  const U = MT.util;
  const M = MT.monthlyModel;
  const store = MT.store;
  const { h, icon, btn, openSheet, confirmDialog, actionSheet, toast } = MT.ui;

  // 画面を描き直しても保つ状態
  const state = {
    scrollLeft: null, // 表の横スクロール位置(null なら右端=最新へ)
    focusYM: null, // 次の描画でこの月が見えるようにスクロール
  };

  const monthly = () => store.get().monthly;
  const today = () => U.todayStr();

  // ---------------------------------------------------------------
  // 画面全体
  // ---------------------------------------------------------------

  function render(container, { entered = false } = {}) {
    const m = monthly();
    const months = M.months(m);
    if (entered) state.scrollLeft = null; // 別のタブから来たら最新の月を表示

    container.append(
      h(
        'header',
        { class: 'page-head' },
        h('h1', { class: 'page-title', text: '月末記録' }),
        btn('項目を編集', { icon: 'edit', variant: 'ghost', size: 'small', onClick: () => MT.app.navigate('monthly/edit') })
      )
    );

    if (!m.items.length) {
      container.append(renderWelcome());
      return;
    }
    if (!months.length) {
      container.append(renderFirstMonth(m));
      return;
    }

    const banner = renderBanner(m);
    if (banner) container.append(banner);
    container.append(renderSummary(m, months));
    const tableCard = renderTableCard(m, months);
    container.append(tableCard);
    const mode = chartMode();
    const chartCard = renderChartCard(m, mode);
    container.append(chartCard);

    restoreTableScroll(tableCard);
    MT.monthlyChart.render(chartCard.querySelector('canvas'), chartCard.querySelector('.chart-fallback'), m, mode);
  }

  function unmount() {
    MT.monthlyChart.destroy();
  }

  // ---------------------------------------------------------------
  // はじめての表示
  // ---------------------------------------------------------------

  function renderWelcome() {
    return h(
      'section',
      { class: 'card welcome' },
      h('h2', { class: 'card-title', text: 'はじめに' }),
      h('p', { text: '毎月末の残高を記録して、総資産の推移を見える化します。' }),
      h('p', { text: 'まず、記録する項目(銀行口座・証券口座など)を登録しましょう。' }),
      h(
        'div',
        { class: 'button-row' },
        btn('項目を登録する', { variant: 'primary', icon: 'plus', onClick: () => MT.app.navigate('monthly/edit') }),
        btn('サンプルで試す', { onClick: () => MT.settingsView.loadSampleFlow() })
      ),
      h('p', { class: 'hint', text: 'データはこの端末のブラウザの中だけに保存され、どこにも送信されません。' })
    );
  }

  function renderFirstMonth(m) {
    const target = M.suggestNewMonth(m);
    return h(
      'section',
      { class: 'card welcome' },
      h('h2', { class: 'card-title', text: '最初の記録を作りましょう' }),
      h('p', { text: `項目は ${m.items.length}件 登録済みです。記録する月を作って、金額を入力します。` }),
      h(
        'div',
        { class: 'button-row' },
        btn(`${U.ymLabel(target)}末を記録する`, {
          variant: 'primary',
          onClick: () => createMonthAndStart(target, true),
        }),
        btn('別の月を選ぶ', { onClick: () => openAddMonthSheet() })
      )
    );
  }

  // ---------------------------------------------------------------
  // 上の案内(前月が未入力など)
  // ---------------------------------------------------------------

  function renderBanner(m) {
    const prev = U.ymAdd(U.currentYM(), -1);
    if (!m.records[prev]) {
      const src = M.prevRecordKey(m, prev) || M.nextRecordKey(m, prev);
      return notice('warn', `${U.ymLabel(prev)}末の記録がまだありません`, [
        src
          ? `${U.ymLabel(src)}の値を下書きとしてコピーするので、変わった所だけ直せます。`
          : '月を作って、金額を入力しましょう。',
      ], [
        btn(`${U.monthLabel(prev)}を作成して入力`, { variant: 'primary', size: 'small', onClick: () => createMonthAndStart(prev, true) }),
      ]);
    }
    const st = M.monthStatus(m, prev);
    if (st.carried + st.empty > 0) {
      const parts = [];
      if (st.carried) parts.push(`未確認 ${st.carried}件`);
      if (st.empty) parts.push(`未入力 ${st.empty}件`);
      return notice('info', `${U.ymLabel(prev)}末:${parts.join('・')}`, [
        '前月のコピーのままの値や、空欄の項目があります。金額がない項目は 0 を入れてください。',
      ], [btn('続きを入力', { variant: 'primary', size: 'small', onClick: () => startSequence(prev) })]);
    }
    return null;
  }

  function notice(type, title, lines, actions) {
    return h(
      'section',
      { class: `notice notice-${type}`, role: 'status' },
      icon(type === 'warn' ? 'alert' : 'info', 'notice-icon'),
      h(
        'div',
        { class: 'notice-main' },
        h('p', { class: 'notice-title', text: title }),
        lines.map((t) => h('p', { class: 'notice-text', text: t })),
        actions && actions.length ? h('div', { class: 'notice-actions' }, actions) : null
      )
    );
  }

  // ---------------------------------------------------------------
  // 総資産のまとめ
  // ---------------------------------------------------------------

  function renderSummary(m, months) {
    const latest = months[months.length - 1];
    const total = M.monthTotal(m, latest);
    const diff = M.monthDiff(m, latest);
    let diffEl = null;
    if (diff) {
      const cls = diff.diff < 0 ? 'is-neg' : diff.diff > 0 ? 'is-pos' : '';
      const pct = diff.prevTotal !== 0 ? `(${U.percentSigned(diff.diff / Math.abs(diff.prevTotal))})` : '';
      const label = diff.prev === U.ymAdd(latest, -1) ? '前月比' : `${U.ymLabel(diff.prev)}比`;
      diffEl = h(
        'p',
        { class: 'summary-diff' },
        `${label} `,
        h('span', { class: `delta ${cls}`, text: `${U.yenSigned(diff.diff)}円 ${pct}` })
      );
    }
    return h(
      'section',
      { class: 'card summary' },
      h('p', { class: 'summary-label', text: `総資産(${U.ymLabel(latest)}末)` }),
      h('p', { class: 'summary-value' }, U.yen(total), h('span', { class: 'summary-unit', text: '円' })),
      diffEl
    );
  }

  // ---------------------------------------------------------------
  // 表
  // ---------------------------------------------------------------

  function renderTableCard(m, months) {
    const latest = months[months.length - 1];
    const stale = M.staleItemIds(m);
    const groups = M.groups(m);

    const headRow = h(
      'tr',
      null,
      h('th', { class: 'col-name col-corner', scope: 'col' }, h('span', { class: 'unit', text: '単位:円' })),
      months.map((ym) => {
        const { y, m: mon } = U.splitYM(ym);
        return h(
          'th',
          { class: 'col-month', scope: 'col' },
          h(
            'button',
            {
              type: 'button',
              class: 'month-btn',
              dataset: { action: 'month', ym },
              'aria-label': `${U.ymLabel(ym)}のメニュー`,
            },
            h('span', { class: 'month-year', text: String(y) }),
            h('span', { class: 'month-name', text: `${mon}月` })
          )
        );
      })
    );

    const rows = [];
    for (const g of groups) {
      rows.push(
        h(
          'tr',
          { class: 'row-cat' },
          h('th', { class: 'col-name', scope: 'row', text: g.category.name }),
          months.map((ym) => h('td', { class: 'col-month num', text: U.yen(M.categoryTotal(m, ym, g.category.id)) }))
        )
      );
      if (!g.items.length) {
        rows.push(
          h(
            'tr',
            { class: 'row-empty' },
            h('th', { class: 'col-name', scope: 'row' }, h('span', { class: 'muted', text: '項目なし' })),
            months.map(() => h('td', { class: 'col-month' }))
          )
        );
      }
      for (const it of g.items) rows.push(renderItemRow(m, months, it, stale.has(it.id)));
    }

    rows.push(
      h(
        'tr',
        { class: 'row-total' },
        h('th', { class: 'col-name', scope: 'row', text: '総資産' }),
        months.map((ym) => h('td', { class: 'col-month num', text: U.yen(M.monthTotal(m, ym)) }))
      )
    );
    rows.push(
      h(
        'tr',
        { class: 'row-diff' },
        h('th', { class: 'col-name', scope: 'row', text: '前月比' }),
        months.map((ym) => {
          const d = M.monthDiff(m, ym);
          if (!d) return h('td', { class: 'col-month num muted', text: '—' });
          const cls = d.diff < 0 ? 'is-neg' : d.diff > 0 ? 'is-pos' : '';
          return h('td', { class: `col-month num delta ${cls}`, text: U.yenSigned(d.diff) });
        })
      )
    );
    rows.push(
      h(
        'tr',
        { class: 'row-memo' },
        h('th', { class: 'col-name', scope: 'row', text: 'メモ' }),
        months.map((ym) => {
          const memo = m.records[ym].memo;
          return h(
            'td',
            { class: 'col-month' },
            h(
              'button',
              {
                type: 'button',
                class: `memo-btn${memo ? '' : ' is-empty'}`,
                dataset: { action: 'memo', ym },
                'aria-label': `${U.ymLabel(ym)}のメモ${memo ? ':' + memo : '(なし)'}`,
              },
              memo ? memo : '+'
            )
          );
        })
      )
    );

    const table = h('table', { class: 'grid' }, h('thead', null, headRow), h('tbody', null, rows));
    table.addEventListener('click', onTableClick);

    const wrap = h('div', { class: 'grid-wrap' }, table);
    wrap.addEventListener('scroll', () => {
      state.scrollLeft = wrap.scrollLeft;
    }, { passive: true });

    return h(
      'section',
      { class: 'card card-flush table-card' },
      h(
        'div',
        { class: 'card-head' },
        h('h2', { class: 'card-title', text: '月ごとの残高' }),
        btn('月を追加', { icon: 'plus', size: 'small', onClick: () => openAddMonthSheet() })
      ),
      wrap,
      h(
        'p',
        { class: 'grid-legend' },
        h('span', { class: 'legend-item' }, h('span', { class: 'dot-carried', 'aria-hidden': 'true' }), '前月からのコピー(未確認)'),
        h('span', { class: 'legend-item' }, h('span', { class: 'badge-stale', text: '未更新' }), `${U.monthLabel(latest)}にまだ入力していない項目`),
        h('span', { class: 'legend-item', text: 'セルをタップして入力・月名をタップでメニュー' })
      )
    );
  }

  function renderItemRow(m, months, it, isStale) {
    const meta = [];
    if (isStale) meta.push(h('span', { class: 'badge-stale', text: '未更新' }));
    meta.push(h('span', { text: it.lastUpdated ? `最終 ${U.shortDate(it.lastUpdated)}` : '未入力' }));
    return h(
      'tr',
      { class: 'row-item' },
      h(
        'th',
        { class: 'col-name', scope: 'row' },
        h('span', { class: 'item-name', text: it.name }),
        h('span', { class: 'item-meta' }, meta)
      ),
      months.map((ym) => {
        const v = M.getValue(m, ym, it.id);
        const carried = v !== null && !M.isConfirmed(m, ym, it.id);
        const cls = ['cell-btn'];
        if (v === null) cls.push('is-empty');
        if (carried) cls.push('is-carried');
        const desc = v === null ? '未入力' : `${U.yen(v)}円${carried ? '(前月からのコピー・未確認)' : ''}`;
        return h(
          'td',
          { class: 'col-month' },
          h(
            'button',
            {
              type: 'button',
              class: cls.join(' '),
              dataset: { action: 'input', ym, item: it.id },
              'aria-label': `${it.name} ${U.ymLabel(ym)}末 ${desc}`,
            },
            v === null ? '—' : U.yen(v)
          )
        );
      })
    );
  }

  function onTableClick(e) {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const { action, ym, item } = b.dataset;
    if (action === 'input') openInputSheet(ym, item);
    else if (action === 'month') openMonthMenu(ym);
    else if (action === 'memo') openMemoSheet(ym);
  }

  function restoreTableScroll(card) {
    const wrap = card.querySelector('.grid-wrap');
    if (state.focusYM) {
      const monthBtn = card.querySelector(`.month-btn[data-ym="${state.focusYM}"]`);
      const corner = card.querySelector('.col-corner');
      if (monthBtn && corner) {
        const cell = monthBtn.closest('th');
        const left = cell.offsetLeft - corner.offsetWidth - 8;
        const right = cell.offsetLeft + cell.offsetWidth - wrap.clientWidth + 8;
        if (wrap.scrollLeft > left) wrap.scrollLeft = Math.max(0, left);
        else if (wrap.scrollLeft < right) wrap.scrollLeft = right;
      }
      state.focusYM = null;
    } else if (state.scrollLeft === null) {
      wrap.scrollLeft = wrap.scrollWidth;
    } else {
      wrap.scrollLeft = state.scrollLeft;
    }
    state.scrollLeft = wrap.scrollLeft;
  }

  // ---------------------------------------------------------------
  // グラフ
  // ---------------------------------------------------------------

  function chartMode() {
    return U.prefs.get('chartMode', 'category') === 'item' ? 'item' : 'category';
  }

  function renderChartCard(m, mode) {
    const segBtn = (value, label) =>
      h('button', {
        type: 'button',
        'aria-pressed': String(mode === value),
        text: label,
        onClick: () => {
          if (mode === value) return;
          U.prefs.set('chartMode', value);
          MT.app.rerender();
        },
      });
    const count = M.months(m).length;
    return h(
      'section',
      { class: 'card chart-card' },
      h(
        'div',
        { class: 'card-head' },
        h('h2', { class: 'card-title', text: '総資産の推移' }),
        h('div', { class: 'seg', role: 'group', 'aria-label': 'グラフの分け方' }, segBtn('category', '区分別'), segBtn('item', '項目別'))
      ),
      h(
        'div',
        { class: 'chart-box' },
        h('canvas', { role: 'img', 'aria-label': `総資産の推移(${mode === 'item' ? '項目別' : '区分別'}の積み上げ棒グラフ)。数値は上の表を参照。` }),
        h('p', { class: 'chart-fallback', hidden: true, text: 'グラフを読み込めませんでした。インターネットに接続して、もう一度開いてください。' })
      ),
      count > MT.monthlyChart.MAX_MONTHS ? h('p', { class: 'hint', text: `直近${MT.monthlyChart.MAX_MONTHS}か月を表示しています。` }) : null
    );
  }

  // ---------------------------------------------------------------
  // 金額の入力
  // ---------------------------------------------------------------

  /** その月の、未確認・未入力の最初の項目から順番に入力する */
  function startSequence(ym) {
    const m = monthly();
    const items = M.orderedItems(m);
    if (!items.length) return;
    const first = items.find((it) => !M.isConfirmed(m, ym, it.id)) || items[0];
    state.focusYM = ym;
    openInputSheet(ym, first.id);
  }

  function createMonthAndStart(ym, copy) {
    let res = null;
    state.focusYM = ym; // 描き直したときに、この月が見えるように
    const ok = store.update((d) => {
      res = M.addMonth(d.monthly, ym, { copy });
    });
    if (!ok || !res) return;
    if (res.copiedFrom) toast(`${U.ymLabel(ym)}を作成しました(${U.monthLabel(res.copiedFrom)}の値をコピー)`);
    startSequence(ym);
  }

  function openInputSheet(ym, itemId) {
    const s = openSheet({ className: 'sheet-input' });
    const sub = h('p', { class: 'sheet-desc' });
    s.head.append(sub);

    const refLine = h('p', { class: 'amount-ref' });
    const statusLine = h('p', { class: 'amount-status', hidden: true });
    const preview = h('p', { class: 'amount-preview', 'aria-live': 'polite' });
    const field = MT.ui.amountField({
      size: 'large',
      onChange: () => {
        err.hidden = true;
        updatePreview();
      },
    });
    const input = field.input;
    input.setAttribute('enterkeyhint', 'next');
    const err = h('p', { class: 'field-error', role: 'alert', hidden: true });
    const sameBtn = btn('前月と同じ', { size: 'small', keepFocus: true });
    const clearBtn = btn('空欄にする', { size: 'small', keepFocus: true });

    const form = h(
      'form',
      { class: 'amount-form', novalidate: true },
      refLine,
      statusLine,
      field.el,
      preview,
      err,
      h('div', { class: 'chip-row' }, sameBtn, clearBtn)
    );
    s.body.append(form);

    const closeBtn = btn('閉じる', { onClick: () => s.close() });
    const saveBtn = btn('保存', { keepFocus: true });
    const nextBtn = btn('保存して次へ', { variant: 'primary', keepFocus: true });
    s.foot.append(closeBtn, saveBtn, nextBtn);

    let current = itemId;
    let prevValue = null;
    let nextId = null;

    function load(id) {
      const m = monthly();
      const it = M.findItem(m, id);
      if (!it) {
        s.close();
        return;
      }
      current = id;
      const cat = M.findCategory(m, it.categoryId);
      const list = M.orderedItems(m);
      const pos = list.findIndex((x) => x.id === id) + 1;
      s.setTitle(it.name);
      sub.textContent = `${U.ymLabel(ym)}末 ・ ${cat ? cat.name : ''}(${pos}/${list.length})`;

      const pk = M.prevRecordKey(m, ym);
      prevValue = pk ? M.getValue(m, pk, id) : null;
      const pLabel = pk ? (pk === U.ymAdd(ym, -1) ? `前月(${U.monthLabel(pk)})` : `前回(${U.ymLabel(pk)})`) : '';
      refLine.textContent = pk ? `${pLabel}:${prevValue === null ? '未入力' : U.yen(prevValue) + '円'}` : '前月の記録はありません';

      const v = M.getValue(m, ym, id);
      const carried = v !== null && !M.isConfirmed(m, ym, id);
      statusLine.hidden = !carried;
      statusLine.textContent = carried ? '前月からコピーした値です。変わっていなければ、そのまま保存で確定します。' : '';

      field.setValue(v);
      sameBtn.disabled = prevValue === null;
      nextId = M.nextItemId(m, id);
      nextBtn.hidden = !nextId;
      saveBtn.className = `btn ${nextId ? 'btn-secondary' : 'btn-primary'}`;
      err.hidden = true;
      updatePreview();
    }

    function focusInput() {
      field.focus(true);
    }

    function updatePreview() {
      const r = field.result();
      preview.replaceChildren();
      if (!r.ok) return;
      if (r.value === null) {
        preview.textContent = '空欄で保存すると、この月の金額を消します。';
        return;
      }
      if (prevValue === null) return;
      const d = r.value - prevValue;
      const cls = d < 0 ? 'is-neg' : d > 0 ? 'is-pos' : '';
      preview.append('前月比 ', h('span', { class: `delta ${cls}`, text: `${U.yenSigned(d)}円` }));
    }

    function commit() {
      const r = field.result();
      if (!r.ok) {
        err.textContent = r.error;
        err.hidden = false;
        focusInput();
        return false;
      }
      return store.update((d) => M.setValue(d.monthly, ym, current, r.value, today()));
    }

    function save() {
      if (!commit()) return;
      s.close();
      toast('保存しました');
    }

    function saveAndNext() {
      if (!commit()) return;
      if (nextId) {
        load(nextId);
        focusInput();
      } else {
        s.close();
        toast(`${U.ymLabel(ym)}の入力が終わりました`);
      }
    }

    sameBtn.addEventListener('click', () => {
      if (prevValue === null) return;
      field.setValue(prevValue);
      focusInput();
    });
    clearBtn.addEventListener('click', () => {
      field.setValue(null);
      input.focus();
    });
    saveBtn.addEventListener('click', save);
    nextBtn.addEventListener('click', saveAndNext);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (nextId) saveAndNext();
      else save();
    });

    load(itemId);
    focusInput();
  }

  // ---------------------------------------------------------------
  // 月の追加・メニュー・メモ
  // ---------------------------------------------------------------

  function openAddMonthSheet(preset) {
    const m = monthly();
    const cur = U.currentYM();
    const curY = U.splitYM(cur).y;
    const existing = M.months(m);
    const firstY = existing.length ? U.splitYM(existing[0]).y : curY;
    const minY = Math.min(curY - 10, firstY);
    const initial = preset || M.suggestNewMonth(m);

    const s = openSheet({
      title: '月を追加',
      description: '過去の月も選べます。入力を忘れた月も、あとから追加できます。',
    });

    const yearSel = h('select', { class: 'field-select', 'aria-label': '年' });
    for (let y = curY; y >= minY; y--) yearSel.append(h('option', { value: String(y), text: `${y}年` }));
    const monthSel = h('select', { class: 'field-select', 'aria-label': '月' });
    for (let i = 1; i <= 12; i++) monthSel.append(h('option', { value: String(i), text: `${i}月` }));
    const { y: iy, m: im } = U.splitYM(initial);
    yearSel.value = String(iy);
    monthSel.value = String(im);

    const copyBox = h('input', { type: 'checkbox', checked: true });
    const copyText = h('span');
    const copyLabel = h('label', { class: 'check' }, copyBox, copyText);
    const status = h('p', { class: 'field-error', role: 'status', hidden: true });

    s.body.append(
      h('div', { class: 'ym-row' }, yearSel, monthSel, h('span', { class: 'ym-suffix', text: '末' })),
      copyLabel,
      status
    );

    const createBtn = btn('作成', {});
    const startBtn = btn('作成して入力', { variant: 'primary' });
    s.foot.append(btn('閉じる', { onClick: () => s.close() }), createBtn, startBtn);

    function selected() {
      return U.makeYM(Number(yearSel.value), Number(monthSel.value));
    }

    function refresh() {
      // 未来の月は選べない
      for (const opt of monthSel.options) {
        opt.disabled = U.makeYM(Number(yearSel.value), Number(opt.value)) > cur;
      }
      if (selected() > cur) monthSel.value = String(U.splitYM(cur).m);
      const ym = selected();
      const exists = !!m.records[ym];
      const src = M.prevRecordKey(m, ym) || M.nextRecordKey(m, ym);
      copyLabel.hidden = !src || exists;
      copyText.textContent = src ? `${U.ymLabel(src)}の値をコピーする(「未確認」の印がつきます)` : '';
      status.hidden = !exists;
      status.textContent = exists ? `${U.ymLabel(ym)}はすでにあります。表のセルをタップして入力できます。` : '';
      createBtn.disabled = exists;
      startBtn.disabled = exists;
    }

    function create(start) {
      const ym = selected();
      if (m.records[ym] || ym > cur) return;
      s.close();
      if (start) {
        createMonthAndStart(ym, copyBox.checked);
        return;
      }
      let res = null;
      state.focusYM = ym;
      if (!store.update((d) => (res = M.addMonth(d.monthly, ym, { copy: copyBox.checked })))) return;
      toast(res && res.copiedFrom ? `${U.ymLabel(ym)}を作成しました(${U.monthLabel(res.copiedFrom)}の値をコピー)` : `${U.ymLabel(ym)}を作成しました`);
    }

    yearSel.addEventListener('change', refresh);
    monthSel.addEventListener('change', refresh);
    createBtn.addEventListener('click', () => create(false));
    startBtn.addEventListener('click', () => create(true));
    refresh();
  }

  function openMonthMenu(ym) {
    const m = monthly();
    if (!m.records[ym]) return;
    const st = M.monthStatus(m, ym);
    const memo = m.records[ym].memo;
    actionSheet({
      title: `${U.ymLabel(ym)}末`,
      description: `入力済み ${st.confirmed}件・未確認 ${st.carried}件・未入力 ${st.empty}件`,
      actions: [
        { label: '順番に入力する', onSelect: () => startSequence(ym) },
        st.carried
          ? {
              label: `未確認の ${st.carried}件をそのまま確定`,
              onSelect: () => {
                let n = 0;
                if (store.update((d) => (n = M.confirmCarried(d.monthly, ym, today())))) toast(`${n}件を確定しました`);
              },
            }
          : null,
        { label: memo ? 'メモを編集' : 'メモを書く', onSelect: () => openMemoSheet(ym) },
        { label: 'この月を削除', danger: true, onSelect: () => deleteMonthFlow(ym) },
      ],
    });
  }

  async function deleteMonthFlow(ym) {
    const ok = await confirmDialog({
      title: `${U.ymLabel(ym)}を削除しますか?`,
      message: [
        'この月の金額とメモがすべて消えます。',
        '間違えた場合は、設定の「直前のデータに戻す」で元に戻せます。',
      ],
      okLabel: '削除する',
      danger: true,
    });
    if (!ok) return;
    state.scrollLeft = null; // 削除後は最新の月を表示
    if (store.update((d) => M.deleteMonth(d.monthly, ym), { backup: `${U.ymLabel(ym)}の削除` })) {
      toast(`${U.ymLabel(ym)}を削除しました`);
    }
  }

  function openMemoSheet(ym) {
    const s = openSheet({ title: `${U.ymLabel(ym)}のメモ` });
    const ta = h('textarea', {
      class: 'field-textarea',
      rows: 5,
      maxlength: M.MEMO_MAX,
      placeholder: '例:ボーナス月、大きな買い物 など',
      'aria-label': 'メモ',
    });
    ta.value = (monthly().records[ym] || {}).memo || '';
    s.body.append(ta);
    s.foot.append(
      btn('キャンセル', { onClick: () => s.close() }),
      btn('保存', {
        variant: 'primary',
        onClick: () => {
          if (store.update((d) => M.setMemo(d.monthly, ym, ta.value.trim()))) {
            s.close();
            toast('メモを保存しました');
          }
        },
      })
    );
    ta.focus();
  }

  /** タブの印:前月の記録がない、または未確認・未入力が残っている */
  function needsAttention(m) {
    if (!m.items.length) return false;
    const prev = U.ymAdd(U.currentYM(), -1);
    if (!m.records[prev]) return true;
    const st = M.monthStatus(m, prev);
    return st.carried + st.empty > 0;
  }

  MT.views = MT.views || {};
  MT.views.monthly = { render, unmount, needsAttention: () => needsAttention(monthly()) };
  MT.monthlyView = { openAddMonthSheet, openInputSheet };
})(window);
