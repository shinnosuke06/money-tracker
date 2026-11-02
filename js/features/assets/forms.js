/*
 * 資産管理:入力ダイアログ
 *  銘柄の追加・編集、買い増し、貼り付けでまとめて登録、手入力の資産、配当・優待、
 *  価格更新の結果、月末記録への反映と反映先の設定、旧 NISA / 新 NISA の選び直し
 */
(function (root) {
  'use strict';
  const MT = root.MT;
  const U = MT.util;
  const A = MT.assetsModel;
  const MM = MT.monthlyModel;
  const store = MT.store;
  const { h, add, btn, openSheet, actionSheet, toast, amountField } = MT.ui;
  const { selectEl, segmented, monthChips, textInput, field, formFoot, errorLine, confirmDelete } = MT.forms;
  const memoArea = (v) => MT.forms.memoArea(v, A.MEMO_MAX);

  const assets = () => store.get().assets;
  const opts = (list) => list.map((x) => ({ value: x.id, label: x.label }));
  const NEW_BROKER = '__new__';

  /** 数量の単位と説明(種別によって変わる) */
  function qtyInfo(type) {
    if (type === 'fund') return { unit: '万口', hint: '投資信託は「口数 ÷ 1万」で入力します(例:12,345口 → 1.2345)。' };
    return { unit: '株', hint: type === 'us' ? '端数の株も入力できます。' : '' };
  }
  function avgHint(type) {
    if (type === 'fund') return '1万口あたりの平均取得単価(円)。';
    if (type === 'us') return '1株あたりの平均取得単価を円で入力します。';
    return '1株あたりの平均取得単価(円)。';
  }
  const fmtQty = (v) => U.formatNumber(v, 6);
  const fmtUnit = (v) => U.formatNumber(v, 2);

  /** 証券会社の選択(過去の入力から選ぶ。前回の選択が初期値) */
  function brokerPicker(a, value) {
    const names = A.brokers(a);
    const input = textInput(names.length ? '' : value, { maxlength: A.NAME_MAX, placeholder: '例:証券A', 'aria-label': '証券会社の名前' });
    if (!names.length) return { el: input, value: () => input.value.trim() };
    const initial = value && names.includes(value) ? value : value ? NEW_BROKER : names[0];
    const sel = selectEl([...names.map((n) => ({ value: n, label: n })), { value: NEW_BROKER, label: '新しく入力…' }], initial, { 'aria-label': '証券会社' });
    if (initial === NEW_BROKER) input.value = value;
    const sync = () => {
      input.hidden = sel.value !== NEW_BROKER;
    };
    sel.addEventListener('change', () => {
      sync();
      if (!input.hidden) input.focus();
    });
    sync();
    return { el: h('div', { class: 'broker-pick' }, sel, input), value: () => (sel.value === NEW_BROKER ? input.value.trim() : sel.value) };
  }

  // ---------------------------------------------------------------
  // 銘柄の追加・編集
  // ---------------------------------------------------------------

  function openHoldingSheet(hid) {
    const a = assets();
    const src = hid ? a.holdings.find((x) => x.id === hid) : null;
    const draft = src
      ? JSON.parse(JSON.stringify(src))
      : A.cleanHolding({ broker: a.recent.broker, account: a.recent.account, type: a.recent.type, code: '', name: '', quantity: 0, avgPrice: 0 });
    if (!src) draft.id = null;
    let type = draft.type;
    const initialPrice = type === 'us' ? draft.priceUsd : draft.price;

    const s = openSheet({ title: src ? '銘柄を編集' : '銘柄を追加', className: 'sheet-form' });
    const err = errorLine();
    const broker = brokerPicker(a, draft.broker);
    const account = segmented(opts(A.ACCOUNTS), draft.account, { label: '口座区分' });
    const code = textInput(draft.code, { maxlength: 20, autocapitalize: 'characters', placeholder: '例:X101', 'aria-label': 'コード' });
    const name = textInput(src ? draft.name : '', { maxlength: A.NAME_MAX, placeholder: '例:銘柄X', 'aria-label': '銘柄名' });
    const qty = amountField({ value: src ? draft.quantity : null, decimals: 6, unit: qtyInfo(type).unit, label: '数量' });
    const avg = amountField({ value: src ? draft.avgPrice : null, decimals: 4, label: '平均取得単価(円)' });
    const price = amountField({ value: initialPrice, decimals: 4, unit: type === 'us' ? 'ドル' : '円', label: '現在の価格' });
    const priority = selectEl(opts(A.PRIORITIES), draft.sellPriority, { 'aria-label': '売却優先度' });
    const memo = memoArea(draft.memo);
    const qtyHint = h('p', { class: 'form-hint' });
    const avgHintEl = h('p', { class: 'form-hint' });
    const priceHint = h('p', { class: 'form-hint' });

    function updateLabels() {
      const qi = qtyInfo(type);
      qty.el.querySelector('.amount-unit').textContent = qi.unit;
      qtyHint.textContent = qi.hint;
      qtyHint.hidden = !qi.hint;
      avgHintEl.textContent = avgHint(type);
      price.el.querySelector('.amount-unit').textContent = type === 'us' ? 'ドル' : '円';
      const status = src && src.priceAt ? `(${src.priceSource === 'manual' ? '手入力' : '取得'}:${new Date(src.priceAt).toLocaleString('ja-JP')})` : '';
      priceHint.textContent =
        (type === 'us' ? '米国株はドルで入力します(円は USD/JPY を掛けて計算)。' : type === 'fund' ? '1万口あたりの基準価額(円)。' : '1株あたりの株価(円)。') +
        '自動取得できないときに使います。' +
        status;
    }
    const typeSeg = segmented(opts(A.TYPES), type, {
      label: '種別',
      onChange: (v) => {
        type = v;
        updateLabels();
      },
    });
    updateLabels();

    s.body.append(
      field('証券会社', broker.el),
      field('口座区分', account.el),
      field('種別', typeSeg.el),
      h('div', { class: 'form-2col' }, field('コード', code), field('銘柄名', name)),
      h('div', { class: 'form-row' }, h('span', { class: 'form-label', text: '数量' }), qty.el, qtyHint),
      h('div', { class: 'form-row' }, h('span', { class: 'form-label', text: '平均取得単価(円)' }), avg.el, avgHintEl),
      h('div', { class: 'form-row' }, h('span', { class: 'form-label', text: '現在の価格(手入力・任意)' }), price.el, priceHint),
      field('売却優先度', priority, '段階5の取り崩し案で使います。'),
      field('メモ', memo),
      err.el
    );

    function save() {
      err.hide();
      const b = broker.value();
      if (!b) return err.show('証券会社を入力してください');
      const c = A.normCode(code.value);
      const n = name.value.trim();
      if (!c && !n) return err.show('コードか銘柄名を入力してください', code);
      const q = qty.result();
      if (!q.ok) return err.show(`数量:${q.error}`, qty.input);
      if (!(q.value > 0)) return err.show('数量を入力してください', qty.input);
      const ap = avg.result();
      if (!ap.ok) return err.show(`平均取得単価:${ap.error}`, avg.input);
      if (ap.value === null || ap.value < 0) return err.show('平均取得単価を入力してください', avg.input);
      const pr = price.result();
      if (!pr.ok) return err.show(`現在の価格:${pr.error}`, price.input);
      if (pr.value !== null && pr.value <= 0) return err.show('現在の価格は 0 より大きくしてください', price.input);

      const hold = {
        ...draft,
        id: draft.id || U.uid('hld'),
        broker: b,
        account: account.value(),
        type,
        code: c,
        name: n || c,
        quantity: q.value,
        avgPrice: ap.value,
        sellPriority: priority.value,
        memo: memo.value,
      };
      if (src && src.account !== hold.account) hold.nisaUnsure = false;
      const priceChanged = pr.value !== initialPrice || (src && src.type !== type);
      const ok = store.update((d) => {
        const newId = A.saveHolding(d.assets, hold);
        if (priceChanged) {
          if (pr.value === null) {
            const x = d.assets.holdings.find((v) => v.id === newId);
            if (type === 'us') x.priceUsd = null;
            else x.price = null;
          } else A.setManualPrice(d.assets, newId, pr.value);
        }
      });
      if (ok) {
        s.close();
        toast(src ? '保存しました' : '銘柄を追加しました');
      }
    }

    async function remove() {
      if (!(await confirmDelete(draft.name, '銘柄'))) return;
      if (store.update((d) => A.removeHolding(d.assets, draft.id), { backup: `銘柄「${draft.name}」の削除` })) {
        s.close();
        toast('削除しました');
      }
    }

    formFoot(s, { onSave: save, onDelete: src ? remove : null });
    if (!src) code.focus();
  }

  /** 銘柄をタップしたときのメニュー */
  function holdingMenu(hid) {
    const a = assets();
    const x = a.holdings.find((v) => v.id === hid);
    if (!x) return;
    const v = A.valuation(x, a);
    actionSheet({
      title: x.name,
      description: v.missing ? `価格未取得・取得額 ${U.yen(v.cost)}円` : `評価額 ${U.yen(v.value)}円・損益 ${U.yenSigned(v.gain)}円`,
      actions: [
        { label: '編集', onSelect: () => openHoldingSheet(hid) },
        { label: '買い増し', onSelect: () => openBuyMoreSheet(hid) },
        { label: '配当・優待', onSelect: () => openDividendSheet(hid) },
      ],
    });
  }

  // ---------------------------------------------------------------
  // 買い増し
  // ---------------------------------------------------------------

  function openBuyMoreSheet(hid) {
    const x = assets().holdings.find((v) => v.id === hid);
    if (!x) return;
    const s = openSheet({ title: `買い増し:${x.name}`, description: `いま:${fmtQty(x.quantity)}${qtyInfo(x.type).unit}・平均取得単価 ${fmtUnit(x.avgPrice)}円`, className: 'sheet-form' });
    const err = errorLine();
    const preview = h('p', { class: 'calc-preview', 'aria-live': 'polite' });
    const update = () => {
      const q = qty.result();
      const p = price.result();
      if (!q.ok || !p.ok || q.value === null || p.value === null) {
        preview.textContent = '';
        return;
      }
      const r = A.previewBuyMore(x, q.value, p.value);
      preview.textContent = r ? `買い増し後:数量 ${fmtQty(r.quantity)}${qtyInfo(x.type).unit}・平均取得単価 ${fmtUnit(r.avgPrice)}円(加重平均)` : '';
    };
    const qty = amountField({ decimals: 6, unit: qtyInfo(x.type).unit, label: '買い増す数量', onChange: update });
    const price = amountField({ decimals: 4, label: '買値(1単位あたり・円)', onChange: update });
    s.body.append(
      field('買い増す数量', qty.el, x.type === 'fund' ? '口数 ÷ 1万で入力します。' : ''),
      field(x.type === 'fund' ? '買値(1万口あたり・円)' : '買値(1株あたり・円)', price.el),
      preview,
      err.el
    );
    formFoot(s, {
      saveLabel: '買い増す',
      onSave: () => {
        const q = qty.result();
        const p = price.result();
        if (!q.ok || !(q.value > 0)) return err.show('数量を入力してください', qty.input);
        if (!p.ok || p.value === null || p.value < 0) return err.show('買値を入力してください', price.input);
        if (store.update((d) => A.buyMore(d.assets, hid, q.value, p.value))) {
          s.close();
          toast('買い増しを反映しました');
        }
      },
    });
    qty.focus();
  }

  // ---------------------------------------------------------------
  // 貼り付けでまとめて登録
  // ---------------------------------------------------------------

  function openPasteSheet() {
    const a = assets();
    const s = openSheet({ title: 'まとめて登録', description: '1行に「コード,銘柄名,数量,取得単価」を書いて貼り付けます。表計算ソフトからのコピー(タブ区切り)もそのまま使えます。', className: 'sheet-form' });
    const broker = brokerPicker(a, a.recent.broker);
    const account = segmented(opts(A.ACCOUNTS), a.recent.account, { label: '口座区分', onChange: refresh });
    const type = selectEl([{ value: 'auto', label: 'コードから自動判定' }, ...opts(A.TYPES)], 'auto', { 'aria-label': '種別' });
    const ta = h('textarea', {
      class: 'field-textarea paste-area',
      rows: 5,
      placeholder: 'X101,銘柄X,100,1500\nXFUND001,ファンドM,12.3456,15000',
      'aria-label': '貼り付ける内容',
      autocomplete: 'off',
      autocapitalize: 'off',
      spellcheck: 'false',
    });
    const preview = h('div', { class: 'paste-preview', 'aria-live': 'polite' });
    const submit = btn('登録', { variant: 'primary' });
    let parsed = { rows: [] };

    function refresh() {
      parsed = A.parsePaste(ta.value, { a: assets(), broker: broker.value(), account: account.value(), type: type.value });
      const valid = parsed.rows.filter((r) => !r.error);
      preview.replaceChildren();
      if (!parsed.rows.length) {
        preview.append(h('p', { class: 'form-hint', text: '貼り付けると、ここに登録内容が表示されます。' }));
      } else {
        preview.append(
          h(
            'ul',
            { class: 'paste-rows' },
            parsed.rows.map((r) =>
              h(
                'li',
                { class: r.error ? 'is-error' : '' },
                h('span', { class: 'paste-line', text: `${r.line}行目` }),
                r.error
                  ? h('span', { text: r.error })
                  : h(
                      'span',
                      null,
                      h('strong', { text: r.name || r.code }),
                      ` ${r.code}・${A.label(A.TYPES, r.type)}・${fmtQty(r.quantity)}${qtyInfo(r.type).unit}・${fmtUnit(r.avgPrice)}円`,
                      h('em', { text: r.mergeWith ? '(同じ銘柄に買い増しとして合算)' : '(新規)' })
                    )
              )
            )
          )
        );
      }
      submit.disabled = !valid.length;
      submit.querySelector('span').textContent = valid.length ? `${valid.length}件を登録` : '登録';
    }

    ta.addEventListener('input', refresh);
    type.addEventListener('change', refresh);
    broker.el.addEventListener('change', refresh);
    broker.el.addEventListener('input', refresh);
    s.body.append(
      field('証券会社', broker.el),
      field('口座区分', account.el),
      field('種別', type, '国内株は先頭が数字の4文字、投資信託は8文字の英数字、米国株は英字のコードとして判定します。投資信託の数量は「口数 ÷ 1万」です。'),
      field('貼り付ける内容', ta),
      preview
    );
    submit.addEventListener('click', () => {
      const b = broker.value();
      if (!b) return toast('証券会社を入力してください', { type: 'error' });
      refresh();
      let res = null;
      if (store.update((d) => (res = A.applyPaste(d.assets, parsed.rows, { broker: b, account: account.value() })))) {
        s.close();
        toast(`${res.added}件を追加${res.merged ? `・${res.merged}件を買い増しとして合算` : ''}しました`);
      }
    });
    s.foot.append(btn('キャンセル', { onClick: () => s.close() }), submit);
    refresh();
    ta.focus();
  }

  // ---------------------------------------------------------------
  // 手入力の資産
  // ---------------------------------------------------------------

  function openManualSheet(mid) {
    const a = assets();
    const src = mid ? a.manual.find((x) => x.id === mid) : null;
    const s = openSheet({ title: src ? '手入力の資産を編集' : '手入力の資産を追加', className: 'sheet-form' });
    const err = errorLine();
    const name = textInput(src ? src.name : '', { maxlength: A.NAME_MAX, placeholder: '例:ポイント運用、ウォレット、金、コレクション', 'aria-label': '名前' });
    const cat = segmented(opts(A.MANUAL_CATEGORIES), src ? src.category : 'invest', { label: '区分' });
    let cost = src ? src.cost : null;
    let syncing = false;
    const costLine = h('p', { class: 'form-hint' });
    const showCost = () => {
      const v = value.result();
      const g = gain.result();
      if (v.ok && v.value !== null) costLine.textContent = `取得額(評価額 − 含み損益):${U.yen(v.value - (g.ok && g.value !== null ? g.value : 0))}円`;
      else costLine.textContent = cost !== null ? `取得額:${U.yen(cost)}円` : '評価額を入れてください。';
    };
    const value = amountField({
      value: src ? src.value : null,
      label: '評価額',
      onChange: (r) => {
        if (syncing || !r.ok || r.value === null) return showCost();
        if (cost !== null) {
          syncing = true;
          gain.setValue(r.value - cost);
          syncing = false;
        }
        showCost();
      },
    });
    const gain = amountField({
      value: src ? src.value - src.cost : null,
      label: '含み損益',
      onChange: (r) => {
        if (syncing || !r.ok || r.value === null) return showCost();
        if (cost !== null) {
          syncing = true;
          value.setValue(cost + r.value);
          syncing = false;
        }
        showCost();
      },
    });
    const priority = selectEl(opts(A.PRIORITIES), src ? src.sellPriority : 'keep', { 'aria-label': '売却優先度' });
    const memo = memoArea(src ? src.memo : '');
    showCost();

    s.body.append(
      field('名前', name),
      field('区分', cat.el),
      field('評価額', value.el, 'どちらか片方を直すと、もう片方を自動で計算します(取得額は変わりません)。'),
      field('含み損益', gain.el),
      costLine,
      field('売却優先度', priority, '手入力の資産の既定は「売りたくない」です。'),
      src && src.updatedAt ? h('p', { class: 'form-hint', text: `最終更新:${U.shortDate(src.updatedAt)}` }) : null,
      field('メモ', memo),
      err.el
    );

    function save() {
      err.hide();
      const n = name.value.trim();
      if (!n) return err.show('名前を入力してください', name);
      const v = value.result();
      if (!v.ok) return err.show(`評価額:${v.error}`, value.input);
      if (v.value === null) return err.show('評価額を入力してください', value.input);
      const g = gain.result();
      if (!g.ok) return err.show(`含み損益:${g.error}`, gain.input);
      const gv = g.value === null ? 0 : g.value;
      const changed = !src || src.value !== v.value || src.value - src.cost !== gv;
      const m = {
        id: src ? src.id : U.uid('man'),
        name: n,
        category: cat.value(),
        value: v.value,
        cost: v.value - gv,
        updatedAt: changed ? U.todayStr() : src.updatedAt,
        sellPriority: priority.value,
        memo: memo.value,
      };
      if (store.update((d) => A.saveManual(d.assets, m))) {
        s.close();
        toast(src ? '保存しました' : '追加しました');
      }
    }
    async function remove() {
      if (!(await confirmDelete(src.name, '資産'))) return;
      if (store.update((d) => A.removeManual(d.assets, src.id), { backup: `資産「${src.name}」の削除` })) {
        s.close();
        toast('削除しました');
      }
    }
    formFoot(s, { onSave: save, onDelete: src ? remove : null });
    if (!src) name.focus();
  }

  // ---------------------------------------------------------------
  // 配当・優待
  // ---------------------------------------------------------------

  function openDividendSheet(hid) {
    const a = assets();
    const x = a.holdings.find((v) => v.id === hid);
    if (!x) return;
    const s = openSheet({ title: `配当・優待:${x.name}`, description: `${fmtQty(x.quantity)}${qtyInfo(x.type).unit}・${A.label(A.ACCOUNTS, x.account)}`, className: 'sheet-form' });
    const unit = x.type === 'us' ? 'ドル' : '円';
    const preview = h('p', { class: 'calc-preview', 'aria-live': 'polite' });
    const update = () => {
      const r = per.result();
      const n = months.value().length;
      if (!r.ok || !r.value || !n) {
        preview.textContent = '';
        return;
      }
      const g = A.dividendPerPayment({ ...x, dividend: { ...x.dividend, perShare: r.value } }, a);
      if (g === null) {
        preview.textContent = 'USD/JPY が無いため、円に換算できません(価格を更新するか、設定で USD/JPY を入れてください)。';
        return;
      }
      const net = Math.round(g * A.dividendNetFactor(x, a));
      preview.textContent = `1回あたり ${U.yen(g)}円(税引後 ${U.yen(net)}円)× 年${n}回 = 年 ${U.yen(net * n)}円(税引後)`;
    };
    const per = amountField({
      value: x.dividend.perShare,
      decimals: 4,
      unit,
      label: '1回あたりの1株配当',
      onChange: update,
    });
    const months = monthChips(x.dividend.months, { label: '配当の支払月', onChange: update });
    const content = textInput(x.benefit.content, { maxlength: 200, placeholder: '例:カタログギフト', 'aria-label': '優待の内容' });
    const minShares = amountField({ value: x.benefit.minShares, decimals: 6, unit: qtyInfo(x.type).unit, label: '必要株数' });
    const record = monthChips(x.benefit.recordMonths, { label: '権利確定月' });
    const arrive = monthChips(x.benefit.arriveMonths, { label: '届く月' });
    const memo = memoArea(x.dividend.memo);
    const err = errorLine();

    s.body.append(
      h('h3', { class: 'form-section-title', text: '配当' }),
      field(x.type === 'fund' ? '1回あたりの分配金(1万口あたり)' : `1回あたりの1株配当(${unit})`, per.el, x.type === 'us' ? '米国株はドルで入力します(円は USD/JPY で換算。米国の源泉税 10% も引きます)。' : ''),
      field('支払月(複数可)', months.el),
      preview,
      h('h3', { class: 'form-section-title', text: '株主優待' }),
      field('優待の内容', content),
      field('必要株数', minShares.el),
      field('権利確定月', record.el),
      field('届く月', arrive.el),
      field('メモ', memo),
      err.el
    );
    update();

    formFoot(s, {
      onSave: () => {
        const r = per.result();
        if (!r.ok) return err.show(`1株配当:${r.error}`, per.input);
        const ms = minShares.result();
        if (!ms.ok) return err.show(`必要株数:${ms.error}`, minShares.input);
        const ok = store.update((d) => {
          const t = d.assets.holdings.find((v) => v.id === hid);
          if (!t) return;
          t.dividend = { perShare: r.value && r.value > 0 ? r.value : null, months: months.value(), memo: memo.value };
          t.benefit = { content: content.value.trim(), minShares: ms.value && ms.value > 0 ? ms.value : null, recordMonths: record.value(), arriveMonths: arrive.value() };
        });
        if (ok) {
          s.close();
          toast('配当・優待を保存しました');
        }
      },
    });
  }

  // ---------------------------------------------------------------
  // 価格更新の結果
  // ---------------------------------------------------------------

  function openPriceReport(report) {
    const a = assets();
    const c = MT.assetPrices.countReport(report);
    const nameOf = (code) => {
      const x = a.holdings.find((v) => A.normCode(v.code) === code);
      return x ? `${x.name}(${code})` : code;
    };
    const s = openSheet({ title: report.aborted ? '価格を更新できませんでした' : '価格を更新しました', className: 'sheet-form' });
    add(
      s.body,
      report.aborted ? h('p', { class: 'field-error', text: report.aborted }) : h('p', { class: 'sheet-text', text: `取得できた銘柄:${c.ok}件・取得できなかった銘柄:${c.failed.length}件` }),
      c.failed.length
        ? [
            h('h3', { class: 'form-section-title', text: '取得できなかった銘柄(前回の価格のまま。一度も取れていなければ「価格未取得」)' }),
            h('ul', { class: 'report-list is-issue' }, c.failed.map((f) => h('li', { text: `${nameOf(f.code)}:${f.reason}` }))),
          ]
        : null,
      report.messages.length ? [h('h3', { class: 'form-section-title', text: 'お知らせ' }), h('ul', { class: 'report-list' }, report.messages.map((m) => h('li', { text: m })))] : null,
      report.fx && report.fx.rate ? h('p', { class: 'form-hint', text: `USD/JPY:${report.fx.rate}(${report.fx.source === 'auto' ? '自動取得' : '設定の手入力値'})` }) : null
    );
    s.foot.append(btn('閉じる', { variant: 'primary', onClick: () => s.close() }));
  }

  // ---------------------------------------------------------------
  // 月末記録への反映
  // ---------------------------------------------------------------

  function openReflectSheet() {
    const cur = U.currentYM();
    const prev = U.ymAdd(cur, -1);
    let target = cur;
    const s = openSheet({ title: '月末記録に反映', description: '資産の評価額を、反映先の月末記録の項目に書き込みます。', className: 'sheet-form' });
    const pick = MT.forms.segmented(
      [
        { value: cur, label: `${U.ymLabel(cur)}末` },
        { value: prev, label: `${U.ymLabel(prev)}末` },
      ],
      cur,
      {
        label: '反映する月',
        onChange: (v) => {
          target = v;
          draw();
        },
      }
    );
    const body = h('div');
    const go = btn('反映する', { variant: 'primary' });
    function draw() {
      const d = store.get();
      const plan = A.reflectPlan(d, target);
      body.replaceChildren();
      add(
        body,
        plan.rows.length
          ? h(
              'div',
              { class: 'reflect-list' },
              plan.rows.map((r) =>
                h(
                  'div',
                  { class: 'reflect-row' },
                  h('span', { class: 'reflect-name' }, r.name, h('small', { class: 'edit-sub', text: r.sources.join('・') })),
                  h('span', { class: 'reflect-from', text: r.from === null ? '未入力' : U.yen(r.from) }),
                  h('span', { class: 'reflect-arrow', 'aria-hidden': 'true', text: '→' }),
                  h('span', { class: 'reflect-to', text: U.yen(r.to) })
                )
              )
            )
          : h('p', { class: 'sheet-text', text: '反映先がまだ設定されていません。' }),
        plan.unmapped.length ? h('p', { class: 'form-hint', text: `反映先が未設定(反映しません):${plan.unmapped.join('、')}` }) : null,
        plan.missing ? h('p', { class: 'field-error', text: `価格未取得の銘柄が ${plan.missing}件あり、その分は合計に入っていません。` }) : null,
        h('p', { class: 'form-hint', text: d.monthly.records[target] ? '書き込んだ値は「入力済み」になります。' : `${U.ymLabel(target)}の記録はまだないので作成します(ほかの項目は前月の値をコピーします)。` }),
        btn('反映先を設定', { size: 'small', variant: 'ghost', onClick: () => openReflectMappingSheet(draw) })
      );
      go.disabled = !plan.rows.length;
    }
    draw();
    s.body.append(field('反映する月', pick.el), body);
    go.addEventListener('click', () => {
      let n = 0;
      if (store.update((d) => (n = A.reflectToMonthly(d, target, U.todayStr())))) {
        s.close();
        toast(`${U.ymLabel(target)}末の月末記録に ${n}件 反映しました`);
      }
    });
    s.foot.append(btn('キャンセル', { onClick: () => s.close() }), go);
  }

  /** 反映先の設定(証券会社ごと/口座区分ごと → 月末記録の項目) */
  function openReflectMappingSheet(onSaved) {
    const d = store.get();
    const a = d.assets;
    const r = JSON.parse(JSON.stringify(a.settings.reflect));
    const s = openSheet({ title: '月末記録への反映先', description: 'まとまりごとに、書き込む月末記録の項目を選びます。同じ項目を選ぶと合計して書き込みます。', className: 'sheet-form' });
    const itemOptions = [{ value: '', label: '反映しない' }].concat(
      MM.groups(d.monthly).flatMap((g) => g.items.map((it) => ({ value: it.id, label: `${g.category.name} / ${it.name}` })))
    );
    const list = h('div', { class: 'map-list' });
    const by = MT.forms.segmented(
      [
        { value: 'broker', label: '証券会社ごと' },
        { value: 'account', label: '口座区分ごと' },
      ],
      r.groupBy,
      {
        label: 'まとめ方',
        onChange: (v) => {
          r.groupBy = v;
          draw();
        },
      }
    );
    function row(labelText, value, onChange) {
      const sel = selectEl(itemOptions, value || '', { 'aria-label': `${labelText}の反映先` });
      sel.addEventListener('change', () => onChange(sel.value));
      return h('div', { class: 'map-row' }, h('span', { class: 'map-label', text: labelText }), sel);
    }
    function draw() {
      const tmp = { ...a, settings: { ...a.settings, reflect: r } };
      const { groups, manual } = A.reflectGroups(tmp);
      list.replaceChildren();
      add(
        list,
        groups.length ? groups.map((g) => row(g.label, r.map[g.key], (v) => (v ? (r.map[g.key] = v) : delete r.map[g.key]))) : h('p', { class: 'form-hint', text: '銘柄がまだありません。' }),
        manual.length ? [h('h3', { class: 'form-section-title', text: '手入力の資産' }), manual.map((g) => row(g.label, r.manualMap[g.key], (v) => (v ? (r.manualMap[g.key] = v) : delete r.manualMap[g.key])))] : null
      );
    }
    draw();
    s.body.append(field('まとめ方', by.el), list);
    formFoot(s, {
      onSave: () => {
        if (store.update((dd) => (dd.assets.settings.reflect = r))) {
          s.close();
          toast('反映先を保存しました');
          if (onSaved) onSaved();
        }
      },
    });
  }

  // ---------------------------------------------------------------
  // 旧 NISA / 新 NISA の選び直し
  // ---------------------------------------------------------------

  function openNisaReviewSheet() {
    const a = assets();
    const targets = a.holdings.filter((x) => x.nisaUnsure);
    const s = openSheet({ title: 'NISA の口座区分を選ぶ', description: '旧アプリの「NISA」は旧 NISA か新 NISA か分からないため、銘柄ごとに選んでください。', className: 'sheet-form' });
    if (!targets.length) {
      s.body.append(h('p', { class: 'sheet-text', text: '選び直しが必要な銘柄はありません。' }));
      s.foot.append(btn('閉じる', { onClick: () => s.close() }));
      return;
    }
    const choices = new Map(targets.map((x) => [x.id, x.account === 'nisa_old' ? 'nisa_old' : 'nisa_new']));
    const segs = [];
    const listEl = h('div', { class: 'map-list' });
    for (const x of targets) {
      const seg = MT.forms.segmented(
        [
          { value: 'nisa_old', label: '旧NISA' },
          { value: 'nisa_new', label: '新NISA' },
        ],
        choices.get(x.id),
        { label: `${x.name}の口座区分`, onChange: (v) => choices.set(x.id, v) }
      );
      segs.push({ x, seg });
      listEl.append(h('div', { class: 'map-row' }, h('span', { class: 'map-label', text: `${x.name}(${x.broker})` }), seg.el));
    }
    const setAll = (v) => {
      for (const { x, seg } of segs) {
        choices.set(x.id, v);
        for (const b of seg.el.querySelectorAll('button')) b.setAttribute('aria-checked', String(b.textContent === (v === 'nisa_old' ? '旧NISA' : '新NISA')));
      }
    };
    s.body.append(
      h('div', { class: 'button-row' }, btn('すべて旧NISA', { size: 'small', onClick: () => setAll('nisa_old') }), btn('すべて新NISA', { size: 'small', onClick: () => setAll('nisa_new') })),
      listEl
    );
    formFoot(s, {
      saveLabel: '決定',
      onSave: () => {
        if (store.update((d) => choices.forEach((acc, hid) => A.setNisaAccount(d.assets, hid, acc)))) {
          s.close();
          toast('NISA の口座区分を保存しました');
        }
      },
    });
  }

  MT.assetsUI = {
    qtyInfo,
    openHoldingSheet,
    holdingMenu,
    openBuyMoreSheet,
    openPasteSheet,
    openManualSheet,
    openDividendSheet,
    openPriceReport,
    openReflectSheet,
    openReflectMappingSheet,
    openNisaReviewSheet,
  };
})(window);
