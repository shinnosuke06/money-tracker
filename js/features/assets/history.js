/*
 * 資産管理:総資産の履歴を直す画面
 *   #/assets/history   履歴の一覧(直す・削除)と、削除・修正前の履歴(元に戻す・完全に消す)
 *
 * 削除や修正をしても、前の記録は「削除・修正前の履歴」に残る(最大 200 件)。そこから元に戻せる。
 * 確かめたほうがよい記録(前後と比べて急な変化・価格未取得が多い・0 円)には目印を付ける。
 */
(function (root) {
  'use strict';
  const MT = root.MT;
  const U = MT.util;
  const A = MT.assetsModel;
  const store = MT.store;
  const CH = MT.assetsCharts;
  const { h, icon, btn, openSheet, actionSheet, confirmDialog, toast, amountField } = MT.ui;
  const { segmented, dateInput, field, formFoot, errorLine } = MT.forms;

  const SLOT = 'assets-history-edit';
  const PAGE = 60; // 一覧に一度に出す件数

  const yen = (v) => `${U.yen(v)}円`;
  const signed = (v) => `${U.yenSigned(v)}円`;
  const tone = (v) => (v < 0 ? 'is-neg' : v > 0 ? 'is-pos' : '');
  const fullDate = (date) => `${date.slice(0, 4)}/${U.dayLabel(date)}`;
  const dateTime = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  let filter = 'all'; // all / flagged
  let limit = PAGE;

  const assets = () => store.get().assets;
  const findEntry = (date) => assets().history.find((e) => e.date === date) || null;

  // ---------------------------------------------------------------
  // 画面
  // ---------------------------------------------------------------

  function render(container, { entered } = {}) {
    if (entered) {
      filter = 'all';
      limit = PAGE;
    }
    const a = assets();
    const flags = A.historyFlags(a);
    container.append(
      h(
        'header',
        { class: 'page-head' },
        h('a', { class: 'back-link', href: '#/assets' }, icon('back'), h('span', { text: '資産' })),
        h('h1', { class: 'page-title page-title-sub', text: '総資産の履歴' })
      ),
      h('p', {
        class: 'hint page-hint',
        text: '「価格を更新」を押した日の総資産です。間違った記録は、直すか削除できます。直す前・削除した記録は、いちばん下の「削除・修正前の履歴」から元に戻せます。',
      })
    );

    if (a.history.length) container.append(chartCard(a, flags));
    container.append(listCard(a, flags));
    if (a.historyTrash.length) container.append(trashCard(a));
  }

  function chartCard(a, flags) {
    const canvas = h('canvas', { role: 'img', 'aria-label': '総資産の推移の折れ線グラフ(赤い点は確かめたほうがよい記録)' });
    const fallback = h('p', { class: 'chart-fallback', hidden: true, text: 'グラフを読み込めませんでした。インターネットに接続して、もう一度開いてください。' });
    const card = h(
      'section',
      { class: 'card chart-card' },
      h('div', { class: 'card-head' }, h('h2', { class: 'card-title', text: '推移' })),
      h('div', { class: 'chart-box' }, canvas, fallback),
      h('p', { class: 'hint', text: `点を押すと、その日の記録を直せます。${flags.size ? '赤い点は、確かめたほうがよい記録です。' : ''}${a.history.length > 120 ? '(グラフは直近 120 件)' : ''}` })
    );
    CH.history(SLOT, canvas, fallback, a.history, { marks: new Set(flags.keys()), onPick: (date) => rowMenu(date) });
    return card;
  }

  function listCard(a, flags) {
    const card = h('section', { class: 'card card-flush' });
    const headSide = h('div', { class: 'card-head-side' });
    card.append(h('div', { class: 'card-head' }, h('h2', { class: 'card-title', text: `記録(${a.history.length}日分)` }), headSide));
    if (!a.history.length) {
      card.append(h('p', { class: 'card-text hint', text: 'まだ記録がありません。資産の「価格を更新」を押すと、その日の総資産を記録します。' }));
      return card;
    }
    if (flags.size) {
      const seg = segmented(
        [
          { value: 'all', label: 'すべて' },
          { value: 'flagged', label: `要確認(${flags.size})` },
        ],
        filter,
        {
          label: '表示する記録',
          onChange: (v) => {
            filter = v;
            limit = PAGE;
            MT.app.rerender();
          },
        }
      );
      card.append(h('div', { class: 'card-text hist-filter' }, seg.el));
    } else {
      filter = 'all';
    }

    // 新しい順。増減は、ひとつ前(古い側)の記録との差
    const rows = [];
    for (let i = a.history.length - 1; i >= 0; i--) {
      const e = a.history[i];
      if (filter === 'flagged' && !flags.has(e.date)) continue;
      rows.push({ e, prev: a.history[i - 1] || null, flags: flags.get(e.date) || [] });
    }
    const shown = rows.slice(0, limit);
    card.append(h('ul', { class: 'pay-list asset-list hist-edit-list' }, shown.map(rowEl)));
    if (rows.length > shown.length) {
      card.append(
        h(
          'div',
          { class: 'card-text' },
          btn(`もっと見る(残り ${rows.length - shown.length}件)`, {
            onClick: () => {
              limit += PAGE;
              MT.app.rerender();
            },
          })
        )
      );
    }
    return card;
  }

  function rowEl({ e, prev, flags }) {
    const diff = prev ? e.total - prev.total : null;
    const chips = flags.map((f) => h('span', { class: 'chip chip-warn', text: f.text }));
    if (e.missing && !flags.some((f) => f.id === 'missing')) chips.push(h('span', { class: 'chip chip-soft', text: `価格未取得 ${e.missing}件` }));
    if (e.edited) chips.push(h('span', { class: 'chip chip-soft', text: '手で修正' }));
    return h(
      'li',
      { class: `pay-row no-check${flags.length ? ' is-flagged' : ''}` },
      h(
        'button',
        { type: 'button', class: 'pay-main', 'aria-label': `${fullDate(e.date)} 総資産 ${yen(e.total)}${flags.length ? '(要確認)' : ''}`, onClick: () => rowMenu(e.date) },
        h('span', { class: 'pay-name', text: fullDate(e.date) }),
        chips.length ? h('span', { class: 'pay-meta' }, chips) : null,
        h('span', { class: 'pay-amount' }, yen(e.total), diff === null ? null : h('small', { class: tone(diff), text: signed(diff) }))
      )
    );
  }

  function trashCard(a) {
    return h(
      'section',
      { class: 'card card-flush' },
      h(
        'div',
        { class: 'card-head' },
        h('h2', { class: 'card-title', text: `削除・修正前の履歴(${a.historyTrash.length}件)` }),
        h('div', { class: 'card-head-side' }, btn('すべて消す', { size: 'small', variant: 'ghost', className: 'btn-ghost-danger', onClick: purgeAllFlow }))
      ),
      h('p', { class: 'card-text hint', text: `押すと元に戻せます。新しいものから ${A.TRASH_MAX}件まで残し、それより古いものは自動で消えます。` }),
      h(
        'ul',
        { class: 'pay-list asset-list hist-edit-list' },
        a.historyTrash.map((t) =>
          h(
            'li',
            { class: 'pay-row no-check' },
            h(
              'button',
              { type: 'button', class: 'pay-main', onClick: () => trashMenu(t.id) },
              h('span', { class: 'pay-name', text: fullDate(t.entry.date) }),
              h(
                'span',
                { class: 'pay-meta' },
                h('span', { class: 'chip', text: A.label(A.TRASH_REASONS, t.reason) }),
                t.at ? h('span', { text: dateTime(t.at) }) : null
              ),
              h('span', { class: 'pay-amount', text: yen(t.entry.total) })
            )
          )
        )
      )
    );
  }

  // ---------------------------------------------------------------
  // 操作
  // ---------------------------------------------------------------

  function rowMenu(date) {
    const e = findEntry(date);
    if (!e) return;
    const flags = A.historyFlags(assets()).get(date) || [];
    actionSheet({
      title: `${fullDate(date)} の記録`,
      description: [`総資産 ${yen(e.total)}`, ...flags.map((f) => f.text)].join('・'),
      actions: [
        { label: '直す(日付・総資産)', onSelect: () => openEditSheet(date) },
        { label: 'この記録を削除', danger: true, onSelect: () => removeEntry(date) },
      ],
    });
  }

  function removeEntry(date) {
    if (!findEntry(date)) return;
    if (store.update((d) => A.removeHistory(d.assets, [date], new Date()))) toast('削除しました。下の「削除・修正前の履歴」から戻せます');
  }

  function openEditSheet(date) {
    const a = assets();
    const i = a.history.findIndex((x) => x.date === date);
    if (i < 0) return;
    const e = a.history[i];
    const prev = a.history[i - 1];
    const next = a.history[i + 1];
    const s = openSheet({ title: '履歴を直す', description: `${fullDate(date)} の記録`, className: 'sheet-form' });
    const err = errorLine();
    const dateEl = dateInput(date, '日付');
    dateEl.max = U.todayStr();
    const total = amountField({ value: e.total, label: '総資産' });
    const near = [prev ? `前の記録:${fullDate(prev.date)} ${yen(prev.total)}` : null, next ? `次の記録:${fullDate(next.date)} ${yen(next.total)}` : null].filter(Boolean);
    s.body.append(
      field('日付', dateEl),
      field('総資産', total.el, '直す前の記録は「削除・修正前の履歴」に残り、あとで元に戻せます。'),
      near.length ? h('div', { class: 'form-hint hist-near' }, near.map((t) => h('p', { text: t }))) : null,
      err.el
    );

    function save() {
      err.hide();
      const r = total.result();
      if (!r.ok) return err.show(`総資産:${r.error}`, total.input);
      if (r.value === null) return err.show('総資産を入れてください', total.input);
      const draft = { date: dateEl.value, total: r.value };
      // 先に写しで確かめる(だめなら保存しない)
      const trial = A.editHistory(JSON.parse(JSON.stringify(assets())), date, draft, new Date());
      if (!trial.ok) return err.show(trial.error, trial.error.includes('日付') || trial.error.includes('履歴') ? dateEl : total.input);
      if (!trial.changed) {
        s.close();
        return;
      }
      if (store.update((d) => A.editHistory(d.assets, date, draft, new Date()))) {
        s.close();
        toast('直しました');
      }
    }
    formFoot(s, {
      onSave: save,
      onDelete: () => {
        s.close();
        removeEntry(date);
      },
    });
  }

  function trashMenu(id) {
    const t = assets().historyTrash.find((x) => x.id === id);
    if (!t) return;
    actionSheet({
      title: `${fullDate(t.entry.date)} の記録(${A.label(A.TRASH_REASONS, t.reason)})`,
      description: `総資産 ${yen(t.entry.total)}`,
      actions: [
        { label: '元に戻す', onSelect: () => restoreFlow(id) },
        { label: '完全に消す', danger: true, onSelect: () => purgeFlow(id) },
      ],
    });
  }

  async function restoreFlow(id) {
    const trial = A.restoreHistory(JSON.parse(JSON.stringify(assets())), id, {}, new Date());
    let replace = false;
    if (!trial.ok) {
      if (!trial.conflict) return toast(trial.error, { type: 'error' });
      const t = assets().historyTrash.find((x) => x.id === id);
      replace = await confirmDialog({
        title: `${fullDate(t.entry.date)} の記録を置き換えますか?`,
        message: [`今の記録:${yen(trial.conflict.total)}`, `戻す記録:${yen(t.entry.total)}`, '今の記録は「削除・修正前の履歴」に残ります。'],
        okLabel: '置き換える',
      });
      if (!replace) return;
    }
    let res = null;
    if (store.update((d) => (res = A.restoreHistory(d.assets, id, { replace }, new Date()))) && res && res.ok) toast(res.replaced ? '置き換えました' : '元に戻しました');
  }

  async function purgeFlow(id) {
    const ok = await confirmDialog({ title: 'この記録を完全に消しますか?', message: '消した記録は元に戻せません。', okLabel: '完全に消す', danger: true });
    if (ok && store.update((d) => A.purgeTrash(d.assets, id))) toast('完全に消しました');
  }

  async function purgeAllFlow() {
    const n = assets().historyTrash.length;
    const ok = await confirmDialog({ title: `削除・修正前の履歴(${n}件)をすべて消しますか?`, message: '消した記録は元に戻せません。今の履歴はそのまま残ります。', okLabel: 'すべて消す', danger: true });
    if (ok && store.update((d) => A.purgeTrash(d.assets))) toast('すべて消しました');
  }

  MT.views = MT.views || {};
  MT.views['assets/history'] = { render, tab: 'assets', unmount: () => CH.destroy(SLOT) };
  MT.assetsHistoryUI = { rowMenu, openEditSheet };
})(window);
