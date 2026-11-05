/*
 * 資産管理:株の変更のお知らせ(株式分割・配当)の画面と入力ダイアログ
 *   #/assets/changes   確認が必要なもの(反映する・反映しない)・反映したもの(確認した・元に戻す)・これまで
 *   銘柄のメニューの「株式分割・併合」:手で分割を反映する
 * 計算と書き換えは js/features/assets/events.js
 */
(function (root) {
  'use strict';
  const MT = root.MT;
  const U = MT.util;
  const A = MT.assetsModel;
  const EV = MT.assetEvents;
  const store = MT.store;
  const { h, icon, btn, openSheet, confirmDialog, toast, amountField } = MT.ui;
  const { field, formFoot, errorLine, monthChips } = MT.forms;

  const assets = () => store.get().assets;
  const qty = (v) => U.formatNumber(v, 6);
  const unitPrice = (v) => (v == null ? '—' : U.formatNumber(v, 4));
  const dateTime = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const day = (s) => (s ? s.replace(/-/g, '/') : '—');
  const monthsText = (m) => (m && m.length ? `${m.join('・')}月` : 'なし');
  const holdingOf = (c) => (c.holdingId ? assets().holdings.find((x) => x.id === c.holdingId) || null : null);
  const qtyUnit = (x) => (x && x.type === 'fund' ? '万口' : '株');
  const moneyUnit = (x) => (x && x.type === 'us' ? 'ドル' : '円');

  // ---------------------------------------------------------------
  // 画面
  // ---------------------------------------------------------------

  function render(container) {
    const a = assets();
    const pending = a.changes.filter((c) => c.status === 'pending');
    const unseen = a.changes.filter((c) => c.status === 'applied' && !c.seen);
    const past = a.changes.filter((c) => !pending.includes(c) && !unseen.includes(c)).slice(0, 30);
    container.append(
      h(
        'header',
        { class: 'page-head' },
        h('a', { class: 'back-link', href: '#/assets' }, icon('back'), h('span', { text: '資産' })),
        h('h1', { class: 'page-title page-title-sub', text: '株の変更のお知らせ' })
      ),
      h('p', {
        class: 'hint page-hint',
        text: '株式分割・配当の記録を 1 日 1 回ほど確かめ、保有と見比べます。分割は自動で反映し(数量 = 分割前の数量 × 分割数)、配当は提案として出します。確認するまで、保有・配当の一覧でも色を付けています。',
      }),
      statusCard(a)
    );
    if (pending.length) container.append(listCard(`確認が必要(${pending.length}件)`, pending, 'pending'));
    if (unseen.length) container.append(listCard(`反映しました(${unseen.length}件)`, unseen, 'unseen'));
    if (!pending.length && !unseen.length) container.append(h('section', { class: 'card' }, h('p', { class: 'hint', text: '確認が必要なお知らせはありません。' })));
    if (past.length) container.append(listCard('これまで(直近 30 件)', past, 'past'));
  }

  function statusCard(a) {
    const c = a.eventsCheck;
    const sec = MT.secrets.get();
    const lines = [];
    if (!sec.priceUrl) lines.push({ text: '価格取得のURLが未設定です。設定の「価格の自動取得」で入れると、分割・配当を確かめられます。', warn: true });
    else if (c.unsupportedAt) lines.push({ text: `価格取得のURL(GAS)が、分割・配当の確認に対応していませんでした(${dateTime(c.unsupportedAt)})。GAS に「tools/gas/events.gs」を足すと使えます(README の「株式分割・配当の自動確認」)。7 日ごとに、また試します。`, warn: true });
    else if (c.error) lines.push({ text: `前回は確認できませんでした:${c.error}`, warn: true });
    lines.push({ text: `最後に確認:${dateTime(c.at)}(価格の更新のときに、1 日 1 回ほど確かめます)` });
    lines.push({ text: '優待は、内容を自動で取れる公開の仕組みが無いため、株数が条件に足りないかだけを確かめます(配当・優待の一覧に出ます)。' });
    const busy = MT.assetsView.isUpdating();
    return h(
      'section',
      { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', { class: 'card-title', text: '分割・配当の確認' })),
      lines.map((l) => h('p', { class: l.warn ? 'field-error' : 'hint', text: l.text })),
      h('div', { class: 'button-row' }, btn(busy ? '確認中…' : '今すぐ確認', { icon: 'sync', onClick: () => MT.assetsView.checkEvents(), className: busy ? 'is-busy' : '' }))
    );
  }

  function listCard(title, list, mode) {
    const side = mode === 'unseen' ? btn('すべて確認した', { size: 'small', variant: 'primary', onClick: () => seenAll() }) : null;
    return h(
      'section',
      { class: 'card card-flush' },
      h('div', { class: 'card-head' }, h('h2', { class: 'card-title', text: title }), side ? h('div', { class: 'card-head-side' }, side) : null),
      h('ul', { class: 'chg-list' }, list.map((c) => changeItem(c, mode)))
    );
  }

  /** 変わる所を「前 → 後」で出す(後ろを目立たせる) */
  function diffRow(label, before, after, unit = '') {
    const changed = before !== after;
    return h(
      'div',
      { class: 'chg-diff' },
      h('span', { class: 'chg-diff-label', text: label }),
      h('span', { class: 'chg-diff-value' }, changed ? h('s', { class: 'was', text: `${before}${unit}` }) : null, changed ? ' → ' : null, h(changed ? 'mark' : 'span', { class: changed ? 'is-new' : '', text: `${after}${unit}` }))
    );
  }

  function changeItem(c, mode) {
    const x = holdingOf(c);
    const head = h(
      'div',
      { class: 'chg-head' },
      h('span', { class: 'chg-name' }, c.name, c.code ? h('small', { class: 'code', text: c.code }) : null),
      h('span', { class: `chip ${c.status === 'pending' ? 'chip-warn' : c.status === 'applied' && !c.seen ? 'chip-change' : 'chip-soft'}`, text: statusText(c) })
    );
    const body = [];
    if (c.kind === 'split') {
      const kindText = c.ratio < 1 ? '株式併合' : '株式分割';
      body.push(h('p', { class: 'chg-what', text: `${kindText}:${EV.ratioText(c.ratio)}(${day(c.eventDate)}${c.source === 'manual' ? '・手で反映' : ''})` }));
      if (c.status === 'pending' && x) {
        const p = EV.splitHolding(JSON.parse(JSON.stringify(x)), c.ratio);
        body.push(splitDiff(x, p.before, p.after), h('p', { class: 'hint', text: c.note || '' }));
      } else if (c.before && c.after) body.push(splitDiff(x, c.before, c.after));
    } else {
      const p = c.proposal || {};
      body.push(h('p', { class: 'chg-what', text: `配当:${p.reason === 'changed' ? '新しい配当が、登録と違います' : '配当の情報を見つけました'}(権利落ち ${day(c.eventDate)})` }));
      const b = c.before || {};
      const af = c.status === 'applied' && c.after ? c.after : { perShare: p.perShare, months: p.months };
      body.push(
        diffRow('1株配当', unitPrice(b.perShare), unitPrice(af.perShare), moneyUnit(x)),
        diffRow('支払月', monthsText(b.months), monthsText(af.months)),
        p.events && p.events.length ? h('p', { class: 'hint', text: `直近の配当(権利落ち日:1株):${p.events.map((e) => `${day(e.date)} ${U.formatNumber(e.amount, 4)}`).join('・')}。支払月は権利落ちの月からの目安です。` }) : null
      );
    }
    if (!x && c.holdingId) body.push(h('p', { class: 'hint', text: 'この銘柄は削除されています。' }));
    const actions = [];
    if (c.status === 'pending' && x) {
      if (c.kind === 'split') actions.push(btn('反映する', { variant: 'primary', size: 'small', onClick: () => applySplitFlow(c.id) }));
      else actions.push(btn('内容を見て反映', { variant: 'primary', size: 'small', onClick: () => openDividendApplySheet(c.id) }));
      actions.push(btn('反映しない', { size: 'small', onClick: () => act(() => EV.dismiss(store.get().assets, c.id), '反映しないことにしました') }));
    }
    if (c.status === 'applied' && x) {
      if (!c.seen) actions.push(btn('確認した', { variant: 'primary', size: 'small', onClick: () => act(() => EV.markSeen(store.get().assets, c.id), '確認しました') }));
      actions.push(btn('元に戻す', { size: 'small', variant: 'ghost', className: 'btn-ghost-danger', onClick: () => undoFlow(c.id) }));
    }
    return h(
      'li',
      { class: `chg-item${mode !== 'past' ? ' is-changed' : ''}` },
      head,
      body,
      h('p', { class: 'chg-at', text: `見つけた日時:${dateTime(c.at)}` }),
      actions.length ? h('div', { class: 'button-row chg-actions' }, actions) : null
    );
  }

  function splitDiff(x, before, after) {
    const u = qtyUnit(x);
    const rows = [diffRow('数量', qty(before.quantity), qty(after.quantity), u), diffRow('平均取得単価', unitPrice(before.avgPrice), unitPrice(after.avgPrice), '円')];
    if (x && x.type === 'us' ? before.priceUsd != null : before.price != null) {
      rows.push(x && x.type === 'us' ? diffRow('今の株価', unitPrice(before.priceUsd), unitPrice(after.priceUsd), 'ドル') : diffRow('今の株価', unitPrice(before.price), unitPrice(after.price), '円'));
    }
    if (before.perShare != null) rows.push(diffRow('1株配当', unitPrice(before.perShare), unitPrice(after.perShare), moneyUnit(x)));
    const short = x && x.benefit && x.benefit.content && x.benefit.minShares;
    return h('div', { class: 'chg-diffs' }, rows, short ? h('p', { class: 'hint', text: `優待の条件(${qty(x.benefit.minShares)}株以上)や内容が、分割で変わることがあります。会社のお知らせを確かめ、「配当・優待」で直してください。` }) : null);
  }

  function statusText(c) {
    if (c.status === 'pending') return c.kind === 'split' ? '確認が必要' : '提案';
    if (c.status === 'applied') return c.seen ? '反映済み' : '反映しました';
    if (c.status === 'dismissed') return '反映しない';
    return '元に戻した';
  }

  // ---------------------------------------------------------------
  // 操作
  // ---------------------------------------------------------------

  function act(fn, message) {
    let ok = false;
    if (store.update((d) => (ok = !!fn(d.assets))) && ok) toast(message);
  }

  function seenAll() {
    let n = 0;
    if (store.update((d) => (n = EV.markSeen(d.assets))) && n) toast(`${n}件を確認しました`);
  }

  async function applySplitFlow(id) {
    const c = assets().changes.find((x) => x.id === id);
    const x = c && holdingOf(c);
    if (!c || !x) return;
    const ok = await confirmDialog({
      title: `${x.name}に分割を反映しますか?`,
      message: [`${EV.ratioText(c.ratio)}:数量 ${qty(x.quantity)} → ${qty(x.quantity * c.ratio)}${qtyUnit(x)}`, 'アプリの数量が、すでに分割後の数になっているときは「反映しない」を選んでください。'],
      okLabel: '反映する',
    });
    if (ok) act((a) => EV.applyPendingSplit(a, id), '分割を反映しました');
  }

  async function undoFlow(id) {
    const c = assets().changes.find((x) => x.id === id);
    if (!c) return;
    const ok = await confirmDialog({
      title: '元に戻しますか?',
      message: c.kind === 'split' ? ['数量・平均取得単価・1株配当を、分割を反映する前に戻します。', '今の株価は、反映したあとに価格を更新していれば、そのままにします。'] : ['1株配当と支払月を、反映する前に戻します。'],
      okLabel: '元に戻す',
    });
    if (ok) act((a) => EV.undo(a, id), '元に戻しました');
  }

  /** 配当の提案を、金額・支払月を直してから反映する */
  function openDividendApplySheet(id) {
    const c = assets().changes.find((x) => x.id === id);
    const x = c && holdingOf(c);
    if (!c || !x || !c.proposal) return;
    const p = c.proposal;
    const s = openSheet({ title: `配当を反映:${x.name}`, description: `いま:1株 ${unitPrice(x.dividend.perShare)}${moneyUnit(x)}・支払月 ${monthsText(x.dividend.months)}`, className: 'sheet-form' });
    const err = errorLine();
    const per = amountField({ value: p.perShare, decimals: 4, unit: moneyUnit(x), label: '1回あたりの1株配当' });
    const months = monthChips(p.months, { label: '支払月' });
    s.body.append(
      field('1回あたりの1株配当', per.el, '見つけた直近の配当の金額です。中間と期末で違う会社もあります。'),
      field('支払月', months.el, '権利落ちの月からの目安(国内株は 3 か月後、米国株は 1 か月後)です。違っていたら直してください。'),
      p.events && p.events.length ? h('p', { class: 'form-hint', text: `直近の配当(権利落ち日:1株):${p.events.map((e) => `${day(e.date)} ${U.formatNumber(e.amount, 4)}`).join('・')}` }) : null,
      err.el
    );
    formFoot(s, {
      saveLabel: '反映する',
      onSave: () => {
        err.hide();
        const r = per.result();
        if (!r.ok || !(r.value > 0)) return err.show('1株配当を 0 より大きい数で入れてください', per.input);
        let ok = false;
        if (store.update((d) => (ok = EV.applyDividend(d.assets, id, { perShare: r.value, months: months.value() }))) && ok) {
          s.close();
          toast('配当を反映しました');
        }
      },
    });
  }

  /** 手で株式分割・併合を反映する(銘柄のメニューから) */
  function openSplitSheet(hid) {
    const x = assets().holdings.find((v) => v.id === hid);
    if (!x) return;
    const s = openSheet({ title: `株式分割・併合:${x.name}`, description: `いま:${qty(x.quantity)}${qtyUnit(x)}・平均取得単価 ${unitPrice(x.avgPrice)}円`, className: 'sheet-form' });
    const err = errorLine();
    const preview = h('div', { class: 'chg-diffs', 'aria-live': 'polite' });
    const ratio = amountField({
      decimals: 6,
      unit: '株',
      label: '1株が何株になるか',
      onChange: () => {
        const r = ratio.result();
        preview.replaceChildren();
        if (!r.ok || !(r.value > 0) || r.value === 1) return;
        const p = EV.splitHolding(JSON.parse(JSON.stringify(x)), r.value);
        preview.append(splitDiff(x, p.before, p.after));
      },
    });
    s.body.append(
      field('1株が何株になるか', ratio.el, '分割は 1株 → 3株 なら 3。併合は 10株 → 1株 なら 0.1 と入れます。数量 = 今の数量 × この数、平均取得単価と 1株配当 = 今の値 ÷ この数(評価額と取得額は変わりません)。'),
      preview,
      err.el
    );
    formFoot(s, {
      saveLabel: '反映する',
      onSave: () => {
        err.hide();
        const r = ratio.result();
        if (!r.ok || !(r.value > 0) || r.value === 1) return err.show('1 以外の、0 より大きい数を入れてください', ratio.input);
        let c = null;
        if (store.update((d) => (c = EV.manualSplit(d.assets, hid, r.value, new Date()))) && c) {
          s.close();
          toast('株式分割を反映しました(株の変更のお知らせから元に戻せます)');
        }
      },
    });
  }

  MT.views = MT.views || {};
  MT.views['assets/changes'] = { render, tab: 'assets' };
  MT.assetsChangesUI = { openSplitSheet, openDividendApplySheet };
})(window);
