/*
 * ポケカ在庫:入力ダイアログ
 *  仕入れの追加、商品の詳細(相場・売却の履歴とグラフ)、編集(名前の変更・統合)、
 *  相場の記録、売却の記録、月末記録への反映
 */
(function (root) {
  'use strict';
  const MT = root.MT;
  const U = MT.util;
  const I = MT.inventoryModel;
  const MM = MT.monthlyModel;
  const store = MT.store;
  const C = MT.charts;
  const { h, add, btn, openSheet, confirmDialog, toast, amountField } = MT.ui;
  const { selectEl, choicePicker, dateInput, textInput, field, formFoot, errorLine, confirmDelete } = MT.forms;

  const inv = () => store.get().inventory;
  const yen = (v) => `${U.yen(v)}円`;
  const unit = (v) => `${U.formatNumber(v, 2)}円`;
  const tone = (v) => (v < 0 ? ' is-neg' : v > 0 ? ' is-pos' : '');
  const opts = I.PRIORITIES.map((p) => ({ value: p.id, label: p.label }));

  // ---------------------------------------------------------------
  // 仕入れの追加
  // ---------------------------------------------------------------

  function openAddSheet(presetName) {
    const names = inv().items.map((x) => x.name);
    const s = openSheet({ title: '在庫を追加', description: '同じ商品名に追加すると、購入単価を加重平均で出し直します。', className: 'sheet-form' });
    const err = errorLine();
    const name = choicePicker(names, presetName || '', { label: '商品名', placeholder: '例:商品A', maxLength: I.NAME_MAX });
    const preview = h('p', { class: 'calc-preview', 'aria-live': 'polite' });
    const update = () => {
      const q = qty.result();
      const p = price.result();
      const n = name.value();
      const pv = q.ok && p.ok && q.value > 0 && p.value !== null ? I.previewPurchase(inv(), n, q.value, p.value) : null;
      preview.textContent = pv
        ? `「${n}」の在庫 ${pv.before.quantity}個(単価 ${unit(pv.before.unitCost)})に追加 → ${pv.after.quantity}個・平均 ${unit(pv.after.unitCost)}`
        : n && names.includes(n)
          ? ''
          : n
            ? '新しい商品として追加します(売却優先度は「最初に売る」)。'
            : '';
    };
    const qty = amountField({ unit: '個', label: '個数', onChange: update });
    const price = amountField({ label: '購入単価', onChange: update });
    name.onChange(update);
    s.body.append(field('商品名', name.el, '過去に入力した商品名から選べます。'), field('個数', qty.el), field('購入単価(1個あたり)', price.el), preview, err.el);
    formFoot(s, {
      saveLabel: '追加',
      onSave: () => {
        const n = name.value();
        if (!n) return err.show('商品名を入力してください', name.input);
        const q = qty.result();
        if (!q.ok || !(q.value > 0)) return err.show('個数は 1 以上の整数で入れてください', qty.input);
        const p = price.result();
        if (!p.ok || p.value === null || p.value < 0) return err.show('購入単価を入れてください', price.input);
        let res = null;
        if (store.update((d) => (res = I.addPurchase(d.inventory, n, q.value, p.value)))) {
          s.close();
          toast(res && res.merged ? `「${n}」に追加しました(購入単価を出し直しました)` : `「${n}」を追加しました`);
        }
      },
    });
    update();
  }

  // ---------------------------------------------------------------
  // 商品の詳細
  // ---------------------------------------------------------------

  function openItemSheet(iid) {
    const s = openSheet({ title: '', className: 'sheet-form sheet-wide', onClose: () => C.destroy('inventory-item') });
    const body = h('div', { class: 'form-stack' });
    s.body.append(body);
    s.foot.append(btn('閉じる', { variant: 'primary', onClick: () => s.close() }));

    function refresh(newId) {
      if (newId) iid = newId;
      const item = I.find(inv(), iid);
      if (!item) {
        s.close();
        return;
      }
      const v = I.valuation(item);
      s.setTitle(item.name);
      body.replaceChildren();
      const canvas = h('canvas', { role: 'img', 'aria-label': `${item.name}の相場と売却単価の折れ線グラフ。数値は下の一覧を参照。` });
      const fallback = h('p', { class: 'chart-fallback', hidden: true, text: 'グラフを読み込めませんでした。' });
      add(
        body,
        h(
          'div',
          { class: 'kv-list' },
          kv('在庫', `${item.quantity}個・購入単価 ${unit(item.unitCost)}`),
          kv('最新の相場', v.latest ? `${yen(v.latest.price)}(${U.shortDate(v.latest.date)}${v.latest.store ? '・' + v.latest.store : ''})` : '記録なし(購入単価で評価)'),
          kv('評価額', yen(v.value)),
          kv('予定利益', `${U.yenSigned(v.expected)}円`, tone(v.expected)),
          kv('確定利益', `${U.yenSigned(v.realized)}円(${v.soldCount}個売却)`, tone(v.realized)),
          kv('売却優先度', I.label(item.priority))
        ),
        h(
          'div',
          { class: 'button-row' },
          btn('相場を記録', { size: 'small', variant: 'primary', onClick: () => openPriceSheet(iid, null, refresh) }),
          btn('売却を記録', { size: 'small', onClick: () => openSaleSheet(iid, null, refresh) }),
          btn('編集', { size: 'small', onClick: () => openEditSheet(iid, refresh) })
        ),
        item.prices.length || item.sales.length ? h('div', { class: 'chart-box chart-small' }, canvas, fallback) : null,
        h('h3', { class: 'form-section-title', text: `相場の記録(${item.prices.length}件)` }),
        item.prices.length
          ? h(
              'ul',
              { class: 'detail-list tappable' },
              [...item.prices].reverse().map((p) =>
                h(
                  'li',
                  null,
                  h(
                    'button',
                    { type: 'button', class: 'detail-btn', onClick: () => openPriceSheet(iid, p.id, refresh) },
                    h('span', { text: `${p.date.replace(/-/g, '/')}${p.store ? '・' + p.store : ''}` }),
                    h('span', { class: 'num', text: yen(p.price) })
                  )
                )
              )
            )
          : h('p', { class: 'form-hint', text: 'まだありません。' }),
        h('h3', { class: 'form-section-title', text: `売却の記録(${item.sales.length}件)` }),
        item.sales.length
          ? h(
              'ul',
              { class: 'detail-list tappable' },
              [...item.sales].reverse().map((x) => {
                const profit = Math.round(x.quantity * (x.price - x.costAtSale));
                return h(
                  'li',
                  null,
                  h(
                    'button',
                    { type: 'button', class: 'detail-btn', onClick: () => openSaleSheet(iid, x.id, refresh) },
                    h('span', { text: `${x.date.replace(/-/g, '/')}・${x.quantity}個 × ${yen(x.price)}` }),
                    h('span', { class: `num${tone(profit)}`, text: `${U.yenSigned(profit)}円` })
                  )
                );
              })
            )
          : h('p', { class: 'form-hint', text: 'まだありません。' }),
        item.memo ? h('p', { class: 'memo-text', text: item.memo }) : null
      );
      if (item.prices.length || item.sales.length) drawChart(canvas, fallback, item);
    }
    refresh();
  }

  function kv(labelText, value, cls = '') {
    return h('div', { class: 'kv' }, h('span', { class: 'kv-label', text: labelText }), h('span', { class: `kv-value${cls}`, text: value }));
  }

  /** 相場(線)と売却単価(点)のグラフ */
  function drawChart(canvas, fallback, item) {
    C.mount('inventory-item', canvas, fallback, (c) => {
      const dates = [...new Set([...item.prices.map((p) => p.date), ...item.sales.map((x) => x.date)])].sort();
      const priceAt = new Map();
      for (const p of item.prices) priceAt.set(p.date, p.price);
      const saleAt = new Map();
      for (const x of item.sales) saleAt.set(x.date, x.price);
      return {
        type: 'line',
        data: {
          labels: dates.map((d) => {
            const [, m, dd] = d.split('-').map(Number);
            return `${m}/${dd}`;
          }),
          datasets: [
            {
              label: '相場',
              data: dates.map((d) => (priceAt.has(d) ? priceAt.get(d) : null)),
              borderColor: c.series[0],
              backgroundColor: c.series[0],
              borderWidth: 2,
              pointRadius: 4,
              pointBorderColor: c.surface,
              pointBorderWidth: 2,
              spanGaps: true,
            },
            {
              label: '売却単価',
              data: dates.map((d) => (saleAt.has(d) ? saleAt.get(d) : null)),
              borderColor: c.series[1],
              backgroundColor: c.series[1],
              showLine: false,
              pointRadius: 6,
              pointStyle: 'rectRot',
              pointBorderColor: c.surface,
              pointBorderWidth: 2,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: C.legend(c),
            tooltip: C.tooltip(c, {
              title: (items) => (items.length ? dates[items[0].dataIndex].replace(/-/g, '/') : ''),
              label: (it) => (it.raw == null ? null : ` ${it.dataset.label}: ${U.yen(it.raw)}円`),
            }),
          },
          scales: { ...C.scales(c), y: { ...C.scales(c).y, beginAtZero: false } },
        },
      };
    });
  }

  // ---------------------------------------------------------------
  // 編集(名前の変更と統合、個数・購入単価・売却優先度・メモ)
  // ---------------------------------------------------------------

  function openEditSheet(iid, onSaved) {
    const item = I.find(inv(), iid);
    if (!item) return;
    const s = openSheet({ title: '商品を編集', className: 'sheet-form' });
    const err = errorLine();
    const name = textInput(item.name, { maxlength: I.NAME_MAX, 'aria-label': '商品名' });
    const hint = h('p', { class: 'form-hint' });
    const qty = amountField({ value: item.quantity, unit: '個', label: '個数', compact: true });
    const cost = amountField({ value: item.unitCost, decimals: 2, label: '購入単価', compact: true });
    const priority = selectEl(opts, item.priority, { 'aria-label': '売却優先度' });
    const memo = MT.forms.memoArea(item.memo);
    const updateHint = () => {
      const t = I.renameTarget(inv(), iid, name.value);
      hint.textContent = t ? `「${t.name}」と同じ名前です。保存すると、個数・相場の記録・売却の記録を 1 つにまとめます。` : '';
      hint.className = t ? 'form-hint is-warn-text' : 'form-hint';
    };
    name.addEventListener('input', updateHint);
    s.body.append(
      h('div', { class: 'form-row' }, h('span', { class: 'form-label', text: '商品名' }), name, hint),
      h('div', { class: 'form-2col' }, field('個数', qty.el), field('購入単価', cost.el)),
      field('売却優先度', priority, '段階5の取り崩し案で使います。'),
      field('メモ', memo),
      err.el
    );
    updateHint();

    async function save() {
      err.hide();
      const n = name.value.trim();
      if (!n) return err.show('商品名を入力してください', name);
      const q = qty.result();
      if (!q.ok || q.value === null || q.value < 0) return err.show('個数は 0 以上の整数で入れてください', qty.input);
      const c = cost.result();
      if (!c.ok || c.value === null || c.value < 0) return err.show('購入単価を入れてください', cost.input);
      const target = I.renameTarget(inv(), iid, n);
      if (target) {
        const ok = await confirmDialog({
          title: `「${target.name}」にまとめますか?`,
          message: [`「${item.name}」の個数・相場の記録・売却の記録を「${target.name}」に統合します。購入単価は個数で加重平均します。`, '間違えた場合は、設定の「直前のデータに戻す」で元に戻せます。'],
          okLabel: 'まとめる',
        });
        if (!ok) return;
      }
      let newId = iid;
      const ok = store.update(
        (d) => {
          I.updateItem(d.inventory, iid, { quantity: q.value, unitCost: c.value, priority: priority.value, memo: memo.value });
          if (n !== item.name) newId = I.rename(d.inventory, iid, n).id;
        },
        target ? { backup: `「${item.name}」を「${target.name}」に統合` } : {}
      );
      if (ok) {
        s.close();
        toast(target ? `「${target.name}」にまとめました` : '保存しました');
        if (onSaved) onSaved(newId);
      }
    }

    async function remove() {
      if (!(await confirmDelete(item.name, '商品(相場・売却の記録も含む)'))) return;
      if (store.update((d) => I.removeItem(d.inventory, iid), { backup: `商品「${item.name}」の削除` })) {
        s.close();
        toast('削除しました');
        if (onSaved) onSaved();
      }
    }
    formFoot(s, { onSave: save, onDelete: remove });
  }

  // ---------------------------------------------------------------
  // 相場の記録
  // ---------------------------------------------------------------

  function openPriceSheet(iid, pid, onSaved) {
    const item = I.find(inv(), iid);
    if (!item) return;
    const src = pid ? item.prices.find((p) => p.id === pid) : null;
    const s = openSheet({ title: src ? '相場を直す' : '相場を記録', description: item.name, className: 'sheet-form' });
    const err = errorLine();
    const date = dateInput(src ? src.date : U.todayStr());
    const price = amountField({ value: src ? src.price : null, label: '買取相場', size: 'large' });
    const stores = [...new Set(inv().items.flatMap((x) => x.prices.map((p) => p.store)).filter(Boolean))];
    const shop = choicePicker(stores, src ? src.store : '', { label: '買取店', placeholder: '例:買取店A(任意)', maxLength: 40 });
    s.body.append(field('日付', date), field('買取相場(1個あたり)', price.el), field('買取店(任意)', shop.el), err.el);
    formFoot(s, {
      onSave: () => {
        const r = price.result();
        if (!U.isDateStr(date.value)) return err.show('日付を入れてください', date);
        if (!r.ok || r.value === null || r.value < 0) return err.show('買取相場を入れてください', price.input);
        if (store.update((d) => I.savePrice(d.inventory, iid, { id: src ? src.id : null, date: date.value, price: r.value, store: shop.value() }))) {
          s.close();
          toast('相場を記録しました');
          if (onSaved) onSaved();
        }
      },
      onDelete: src
        ? async () => {
            if (!(await confirmDelete(`${src.date.replace(/-/g, '/')} の相場`, '記録'))) return;
            if (store.update((d) => I.removePrice(d.inventory, iid, src.id))) {
              s.close();
              toast('削除しました');
              if (onSaved) onSaved();
            }
          }
        : null,
    });
    if (!src) price.focus();
  }

  // ---------------------------------------------------------------
  // 売却の記録
  // ---------------------------------------------------------------

  function openSaleSheet(iid, sid, onSaved) {
    const item = I.find(inv(), iid);
    if (!item) return;
    const src = sid ? item.sales.find((x) => x.id === sid) : null;
    const stock = item.quantity + (src ? src.quantity : 0);
    const s = openSheet({
      title: src ? '売却を直す' : '売却を記録',
      description: `${item.name}・売れるのは ${stock}個まで`,
      className: 'sheet-form',
    });
    const err = errorLine();
    const date = dateInput(src ? src.date : U.todayStr());
    const latest = I.latestPrice(item);
    const qty = amountField({ value: src ? src.quantity : 1, unit: '個', label: '個数' });
    const price = amountField({ value: src ? src.price : latest ? latest.price : null, label: '売却単価' });
    const costAt = src ? src.costAtSale : item.unitCost;
    const preview = h('p', { class: 'calc-preview', 'aria-live': 'polite' });
    const update = () => {
      const q = qty.result();
      const p = price.result();
      preview.textContent = q.ok && p.ok && q.value > 0 && p.value !== null ? `確定利益:${U.yenSigned(Math.round(q.value * (p.value - costAt)))}円(購入単価 ${unit(costAt)} で計算)` : '';
    };
    qty.input.addEventListener('input', update);
    price.input.addEventListener('input', update);
    s.body.append(field('日付', date), h('div', { class: 'form-2col' }, field('個数', qty.el), field('売却単価(1個あたり)', price.el)), preview, err.el);
    update();
    formFoot(s, {
      onSave: () => {
        const q = qty.result();
        const p = price.result();
        if (!q.ok || q.value === null) return err.show('個数を入れてください', qty.input);
        if (!p.ok || p.value === null) return err.show('売却単価を入れてください', price.input);
        let res = { ok: false, error: '' };
        store.update((d) => (res = I.saveSale(d.inventory, iid, { id: src ? src.id : null, date: date.value, quantity: q.value, price: p.value })));
        if (!res.ok) return err.show(res.error);
        s.close();
        toast('売却を記録しました');
        if (onSaved) onSaved();
      },
      onDelete: src
        ? async () => {
            if (!(await confirmDialog({ title: 'この売却を削除しますか?', message: [`${src.quantity}個が在庫に戻ります。`], okLabel: '削除する', danger: true }))) return;
            if (store.update((d) => I.removeSale(d.inventory, iid, src.id))) {
              s.close();
              toast('削除しました(個数を戻しました)');
              if (onSaved) onSaved();
            }
          }
        : null,
    });
  }

  // ---------------------------------------------------------------
  // 月末記録への反映
  // ---------------------------------------------------------------

  function itemOptions(d) {
    return [{ value: '', label: '反映しない(未設定)' }].concat(
      MM.groups(d.monthly).flatMap((g) => g.items.map((it) => ({ value: it.id, label: `${g.category.name} / ${it.name}` })))
    );
  }

  /** 反映先の選択(設定にも同じものを置く) */
  function reflectTargetSelect(onChange) {
    const d = store.get();
    const sel = selectEl(itemOptions(d), d.inventory.settings.reflectItemId || '', { 'aria-label': '在庫の反映先' });
    sel.addEventListener('change', () => {
      store.update((dd) => (dd.inventory.settings.reflectItemId = sel.value || null));
      if (onChange) onChange();
    });
    return sel;
  }

  function openReflectSheet() {
    const cur = U.currentYM();
    const prev = U.ymAdd(cur, -1);
    let target = cur;
    const s = openSheet({ title: '月末記録に反映', description: '在庫の評価額の合計を、月末記録の項目に書き込みます。', className: 'sheet-form' });
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
    const box = h('div');
    const go = btn('反映する', { variant: 'primary' });
    function draw() {
      const d = store.get();
      const plan = I.reflectPlan(d, target);
      box.replaceChildren();
      add(
        box,
        plan.itemId
          ? h(
              'div',
              { class: 'reflect-row' },
              h('span', { class: 'reflect-name', text: plan.name }),
              h('span', { class: 'reflect-from', text: plan.from === null ? '未入力' : U.yen(plan.from) }),
              h('span', { class: 'reflect-arrow', 'aria-hidden': 'true', text: '→' }),
              h('span', { class: 'reflect-to', text: U.yen(plan.to) })
            )
          : h('p', { class: 'field-error', text: '反映先がまだ選ばれていません。下で選んでください。' }),
        h('p', { class: 'form-hint', text: d.monthly.records[target] ? '書き込んだ値は「入力済み」になります。' : `${U.ymLabel(target)}の記録はまだないので作成します(ほかの項目は前月の値をコピーします)。` })
      );
      go.disabled = !plan.itemId;
    }
    s.body.append(field('反映する月', pick.el), field('反映先(月末記録の項目)', reflectTargetSelect(draw)), box);
    draw();
    go.addEventListener('click', () => {
      if (store.update((d) => I.reflectToMonthly(d, target, U.todayStr()))) {
        s.close();
        toast(`${U.ymLabel(target)}末の月末記録に反映しました`);
      }
    });
    s.foot.append(btn('キャンセル', { onClick: () => s.close() }), go);
  }

  MT.inventoryUI = { openAddSheet, openItemSheet, openEditSheet, openPriceSheet, openSaleSheet, openReflectSheet, reflectTargetSelect };
})(window);
