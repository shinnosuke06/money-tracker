/*
 * 支払い管理:カードを使った記録と、カードの明細の確認(画面)
 *   #/payments/cards   カードの明細:確かめてほしいもの(問題なし・おかしい)・確認できたもの・カードを使った記録・毎月の支払い
 *   右下のボタン      「カードを使った」(支払いの画面は文字つき、ほかの画面は小さい丸)
 *   明細を入れる      スクリーンショットをスマホの中で読み取る(tesseract.js)。うまく読めないときは文字を貼り付ける
 *   設定              カードとして使う支払い・いつものカード・お店の候補(settingsCard)
 * 計算と書き換えは js/features/payments/cards-model.js。画像も文字もスマホの外に送らない
 * (読み取りのしくみだけ、初めての読み取りのときに jsDelivr から受け取る)。
 */
(function (root) {
  'use strict';
  const MT = root.MT;
  const U = MT.util;
  const C = MT.cardCheck;
  const store = MT.store;
  const { h, add, icon, btn, toast, openSheet, confirmDialog, promptDialog, amountField } = MT.ui;

  const CARD_KEY = 'cardCheckCard'; // 明細の画面で出すカード(端末ごと)
  const MONTH_KEY = 'cardCheckMonth';
  const OCR = {
    workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
    corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1',
    langPath: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/jpn@1.0.0/4.0.0_best_int',
  };

  const W = ['日', '月', '火', '水', '木', '金', '土'];
  const md = (d) => {
    const [, m, dd] = d.split('-').map(Number);
    return `${m}/${dd}(${W[new Date(`${d}T00:00:00Z`).getUTCDay()]})`;
  };
  const yen = (v) => `${U.yen(v)}円`;
  const pay = () => store.get().payments;
  const cardName = (p, id) => (p.bills.find((b) => b.id === id) || { name: '(消した支払い)' }).name;

  // ---------------------------------------------------------------
  // ほかの画面へ渡すもの
  // ---------------------------------------------------------------

  function pendingCount() {
    const d = store.get();
    return d && d.payments && d.payments.cardCheck ? C.pending(d.payments).length : 0;
  }

  /** 下のタブ(支払い)に出す文字:まだ確かめていない明細があれば赤の「要確認」 */
  function tabBadge() {
    const n = pendingCount();
    return n ? { text: '要確認', level: 'red', label: `カードの明細:確かめてほしいものが ${n}件` } : null;
  }

  /** 支払いの概要のお知らせ */
  function overviewNotice() {
    const n = pendingCount();
    if (!n) return null;
    return h(
      'section',
      { class: 'notice notice-danger', role: 'status' },
      icon('alert', 'notice-icon'),
      h(
        'div',
        { class: 'notice-main' },
        h('p', { class: 'notice-title', text: `カードの明細に、確かめてほしいものがあります(${n}件)` }),
        h('p', { class: 'notice-text', text: '記録が無い・いつもと違う明細です。不正と決まったわけではありません。' }),
        h('div', { class: 'notice-actions' }, h('a', { class: 'btn btn-primary btn-small', href: '#/payments/cards' }, h('span', { text: 'カードの明細を見る' })))
      )
    );
  }

  /** 右下の「カードを使った」(支払いの画面は文字つき、ほかの画面は小さい丸)。カードが無ければ出さない */
  function updateFab(path) {
    let el = root.document.getElementById('card-fab');
    const d = store.get();
    const show = !!(d && d.payments && d.payments.cardCheck && C.cards(d.payments).length) && !MT.store.isReadOnly();
    root.document.body.classList.toggle('has-fab', show);
    if (!show) {
      if (el) el.remove();
      return;
    }
    const big = /^payments(\/|$)/.test(path || '');
    if (!el) {
      el = h('button', { type: 'button', id: 'card-fab', onClick: () => openRecordSheet() });
      root.document.body.append(el);
    }
    el.className = `fab${big ? '' : ' fab-mini'}`;
    el.setAttribute('aria-label', 'カードを使った記録をつける');
    el.replaceChildren(...(big ? [icon('plus'), h('span', { text: 'カードを使った' })] : [icon('card'), h('span', { class: 'fab-plus', 'aria-hidden': 'true', text: '+' })]));
  }

  // ---------------------------------------------------------------
  // カードを使った:記録のダイアログ
  // ---------------------------------------------------------------

  function cardPicker(p, value, onChange) {
    const list = C.cards(p);
    let cur = value;
    if (list.length <= 3) {
      const buttons = list.map((b) =>
        h('button', {
          type: 'button',
          role: 'radio',
          'aria-checked': String(b.id === cur),
          text: b.name,
          onClick: () => {
            cur = b.id;
            for (const [i, x] of buttons.entries()) x.setAttribute('aria-checked', String(list[i].id === cur));
            if (onChange) onChange(cur);
          },
        })
      );
      return { el: h('div', { class: 'seg seg-wide card-seg', role: 'radiogroup', 'aria-label': 'カード' }, buttons), value: () => cur };
    }
    const sel = MT.forms.selectEl(list.map((b) => ({ value: b.id, label: b.name })), cur, { 'aria-label': 'カード' });
    sel.addEventListener('change', () => {
      cur = sel.value;
      if (onChange) onChange(cur);
    });
    return { el: sel, value: () => cur };
  }

  /** カードを使った記録をつける(rec を渡すと直す) */
  function openRecordSheet(rec) {
    const p = pay();
    if (!C.cards(p).length) {
      toast('カードがありません。支払いにカードの支払いを足すか、設定で選んでください');
      return;
    }
    const s = openSheet({ title: rec ? 'カードを使った記録を直す' : 'カードを使った', description: '明細が出たら、この記録と突き合わせます', className: 'sheet-form' });
    const err = MT.forms.errorLine();
    const amount = amountField({ value: rec ? rec.amount : null, label: '金額', size: 'large' });
    const card = cardPicker(p, rec ? rec.cardId : C.defaultCard(p));
    const placeInput = MT.forms.textInput(rec ? rec.place : '', { id: 'card-place', maxlength: 30, placeholder: 'お店(任意)', 'aria-label': 'お店' });
    const chips = h(
      'div',
      { class: 'place-chips' },
      p.cardCheck.places.map((name) =>
        h('button', {
          type: 'button',
          class: 'month-chip',
          'aria-pressed': String(rec && rec.place === name),
          text: name,
          onClick: (e) => {
            placeInput.value = name;
            for (const b of chips.children) b.setAttribute('aria-pressed', String(b === e.currentTarget));
          },
        })
      )
    );
    const date = MT.forms.dateInput(rec ? rec.date : U.todayStr(), '使った日');
    s.body.append(
      MT.forms.field('金額', amount.el),
      MT.forms.field('カード', card.el),
      h('div', { class: 'form-row' }, h('span', { class: 'form-label' }, 'お店', h('a', { class: 'link-btn', href: '#/settings', onClick: () => s.close(), text: '候補を変える(設定)' })), chips, placeInput),
      MT.forms.field('使った日', date),
      err.el
    );
    const save = () => {
      err.hide();
      const r = amount.result();
      if (!r.ok || !(r.value > 0)) return err.show('金額を入れてください', amount.input);
      const draft = { cardId: card.value(), date: date.value, place: placeInput.value, amount: r.value };
      let res = null;
      if (rec) {
        if (store.update((d) => C.updateRecord(d.payments, rec.id, draft))) {
          s.close();
          toast('直しました');
        }
        return;
      }
      if (!store.update((d) => (res = C.addRecord(d.payments, draft))) || !res) return;
      if (!res.ok) return err.show(res.error);
      s.close();
      toast(`記録しました(${cardName(pay(), draft.cardId)}・${yen(draft.amount)})`);
    };
    MT.forms.formFoot(s, {
      onSave: save,
      saveLabel: rec ? '保存' : '記録する',
      onDelete: rec
        ? () => {
            if (store.update((d) => C.removeRecord(d.payments, rec.id))) {
              s.close();
              toast('記録を消しました');
            }
          }
        : null,
    });
    if (!rec) setTimeout(() => amount.input.focus(), 60);
  }

  // ---------------------------------------------------------------
  // 画面:カードの明細
  // ---------------------------------------------------------------

  function render(container) {
    MT.paymentsView.head(container, 'payments/cards');
    const p = pay();
    const list = C.cards(p);
    if (!list.length) {
      container.append(
        h(
          'section',
          { class: 'card' },
          h('h2', { class: 'card-title', text: 'カードがありません' }),
          h('p', { text: '支払いに、カードの支払い(例:クレジットカードA)を足してください。名前に「カード」が入った支払いは、自動でカードになります。設定の「カードを使った記録・明細」で選ぶこともできます。' }),
          h('div', { class: 'button-row' }, h('a', { class: 'btn btn-primary btn-small', href: '#/settings' }, h('span', { text: '設定を開く' })))
        )
      );
      return;
    }
    let cardId = U.prefs.get(CARD_KEY, null);
    if (!list.some((b) => b.id === cardId)) cardId = C.defaultCard(p);
    const stmts = p.cardCheck.statements.filter((x) => x.cardId === cardId).sort((a, b) => (a.month < b.month ? 1 : -1));
    let month = U.prefs.get(MONTH_KEY, null);
    if (!stmts.some((x) => x.month === month)) month = stmts.length ? stmts[0].month : p.month;
    const st = stmts.find((x) => x.month === month) || null;
    const judged = st ? C.judgeCard(p, cardId).get(st.id) : [];

    if (list.length > 1) {
      const pick = cardPicker(p, cardId, (v) => {
        U.prefs.set(CARD_KEY, v);
        U.prefs.set(MONTH_KEY, null);
        MT.app.rerender();
      });
      container.append(h('div', { class: 'card-pick' }, pick.el));
    }
    if (stmts.length > 1) {
      container.append(
        h(
          'div',
          { class: 'chip-row month-pick' },
          stmts.map((x) =>
            h('button', {
              type: 'button',
              class: 'month-chip',
              'aria-pressed': String(x.month === month),
              text: `${U.ymLabel(x.month)}払い${C.pending(p, cardId).some((q) => q.statementId === x.id) ? '・要確認' : ''}`,
              onClick: () => {
                U.prefs.set(MONTH_KEY, x.month);
                MT.app.rerender();
              },
            })
          )
        )
      );
    }

    container.append(summaryCard(p, cardId, st, judged, month));
    if (st) {
      const check = judged.filter((r) => r.kind === 'check');
      const okRows = judged.filter((r) => r.kind !== 'check');
      if (check.length) {
        container.append(
          h(
            'section',
            { class: 'card card-flush' },
            h('div', { class: 'card-head' }, h('h2', { class: 'card-title', text: `確かめてほしいもの(${check.length}件)` })),
            h('p', { class: 'card-text hint', text: '記録が無い・いつもと違う明細です。不正と決まったわけではありません。心当たりがあれば「問題なし」、なければ「おかしい」を。' }),
            h('ul', { class: 'pay-list asset-list' }, check.map((r) => checkRow(st, r)))
          )
        );
      }
      container.append(
        h(
          'section',
          { class: 'card card-flush' },
          h('div', { class: 'card-head' }, h('h2', { class: 'card-title', text: `確認できたもの(${okRows.length}件)` })),
          okRows.length
            ? h(
                'ul',
                { class: 'pay-list asset-list' },
                okRows.map((r) =>
                  h(
                    'li',
                    { class: 'pay-row no-check' },
                    h(
                      'div',
                      { class: 'pay-main' },
                      h('span', { class: 'pay-name', text: r.merchant }),
                      h(
                        'span',
                        { class: 'pay-meta' },
                        h('span', { text: md(r.date) }),
                        h('span', { class: 'chip chip-up', text: r.record ? `記録あり:${r.record.place || 'お店'} ${md(r.record.date)}` : r.note || 'いつもの支払い(前と同じ金額)' })
                      ),
                      h('span', { class: 'pay-amount', text: yen(r.amount) })
                    )
                  )
                )
              )
            : h('p', { class: 'card-text hint', text: 'まだありません。' })
        )
      );
    }
    add(container, recordsCard(p, cardId), knownCard(p, cardId));
  }

  function summaryCard(p, cardId, st, judged, month) {
    const bill = p.bills.find((b) => b.id === cardId);
    const head = h('div', { class: 'card-head' }, h('h2', { class: 'card-title', text: `${cardName(p, cardId)}:${U.ymLabel(month)}のお支払い分` }), bill && bill.amount != null && month === p.month ? h('span', { class: 'chip', text: `請求額 ${yen(bill.amount)}` }) : null);
    const body = [];
    if (!st) {
      body.push(h('p', { text: 'まだ明細を入れていません。カード会社のアプリやメールの明細のスクリーンショットを選ぶと、アプリがスマホの中で文字を読み取ります(画像も文字も外に送りません)。' }));
    } else {
      const n = (k) => judged.filter((r) => r.kind === k).length;
      const pend = judged.filter((r) => r.kind === 'check' && !r.status).length;
      const t = C.totals(p, st);
      body.push(
        h('div', { class: 'stat-grid' }, stat('記録と一致', n('record'), 'tone-pos'), stat('いつもの支払い', n('known'), 'tone-pos'), stat('確かめる', pend, pend ? 'tone-neg' : '')),
        h('p', { class: t.diff ? 'field-error' : 'hint', text: `明細の合計 ${yen(t.total)}${t.billAmount != null ? `・請求額 ${yen(t.billAmount)}${t.diff ? `(${yen(Math.abs(t.diff))}合わない。明細の入れ忘れや、読み取りの違いがないか確かめてください)` : '(一致)'}` : ''}` })
      );
    }
    return h(
      'section',
      { class: 'card' },
      head,
      body,
      h(
        'div',
        { class: 'button-row' },
        btn(st ? '明細を入れ直す' : '明細を入れる', { variant: 'primary', icon: 'plus', onClick: () => openStatementSheet(cardId, month) }),
        st ? btn('この明細を消す', { size: 'small', variant: 'ghost', className: 'btn-ghost-danger', onClick: () => removeStatementFlow(st) }) : null
      )
    );
  }

  function stat(label, value, cls) {
    return h('div', { class: `stat ${cls}`.trim() }, h('span', { class: 'stat-label', text: label }), h('span', { class: 'stat-value' }, String(value), h('small', { text: '件' })));
  }

  function checkRow(st, r) {
    const m = r.status;
    const tone = (x) => (/double|foreign|small/.test(x.id) ? 'chip-down' : 'chip-warn');
    return h(
      'li',
      { class: `pay-row no-check card-check${m ? ` is-${m}` : ' is-pending'}` },
      h(
        'div',
        { class: 'pay-main' },
        h('span', { class: 'pay-name', text: r.merchant }),
        h('span', { class: 'pay-meta' }, h('span', { text: md(r.date) }), ...r.reasons.map((x) => h('span', { class: `chip ${tone(x)}`, text: x.text }))),
        h('span', { class: 'pay-amount', text: yen(r.amount) })
      ),
      m
        ? h(
            'div',
            { class: 'check-done' },
            h('span', { class: `chip ${m === 'ok' ? 'chip-up' : 'chip-down'}`, text: m === 'ok' ? '問題なし(確認済み)' : 'おかしい' }),
            r.memo ? h('span', { class: 'check-memo', text: r.memo }) : null,
            btn('戻す', { size: 'small', variant: 'ghost', onClick: () => store.update((d) => C.setRowStatus(d.payments, st.id, r.id, null)) })
          )
        : h(
            'div',
            { class: 'check-actions' },
            btn('問題なし', { size: 'small', variant: 'primary', onClick: () => okFlow(st, r) }),
            btn('おかしい', { size: 'small', variant: 'ghost', className: 'btn-ghost-danger', onClick: () => ngFlow(st, r) })
          ),
      m === 'ng' ? h('p', { class: 'check-help', text: 'カードの裏に書いてある電話番号(カード会社)に連絡し、利用を止めてもらいましょう。カード会社のアプリで止められることもあります。' }) : null
    );
  }

  function okFlow(st, r) {
    const s = openSheet({ title: '問題なしにする', description: `${r.merchant}・${yen(r.amount)}` });
    const box = MT.forms.checkbox('毎月の支払いとして覚える(次の月から、同じお店・同じ金額なら確かめなくてよい)', /保険|料金|サブスク|配信|会費|月額|定期/.test(r.merchant) || r.reasons.some((x) => x.id === 'changed'));
    s.body.append(box.el, h('p', { class: 'form-hint', text: '金額が変わったときは、また「確かめてほしいもの」に出ます。' }));
    s.foot.append(
      btn('キャンセル', { onClick: () => s.close() }),
      btn('問題なし', {
        variant: 'primary',
        onClick: () => {
          const monthly = box.input.checked;
          if (store.update((d) => C.setRowStatus(d.payments, st.id, r.id, 'ok', { monthly }))) {
            s.close();
            toast(monthly ? '確認済みにして、毎月の支払いとして覚えました' : '確認済みにしました');
          }
        },
      })
    );
  }

  async function ngFlow(st, r) {
    const memo = await promptDialog({ title: 'おかしいにする', label: 'メモ(任意)', placeholder: '例:心当たりがない・カード会社に連絡した', okLabel: 'おかしいにする', maxLength: 100, hint: 'カード会社に連絡し、利用を止めてもらいましょう。' });
    if (memo === null) return;
    if (store.update((d) => C.setRowStatus(d.payments, st.id, r.id, 'ng', { memo }))) toast('「おかしい」にしました。カード会社に連絡しましょう');
  }

  async function removeStatementFlow(st) {
    const ok = await confirmDialog({ title: 'この明細を消しますか?', message: ['入れた明細の行と、確かめた印を消します。カードを使った記録と、毎月の支払いの覚えは残ります。'], okLabel: '消す', danger: true });
    if (ok && store.update((d) => C.removeStatement(d.payments, st.id), { backup: 'カードの明細の削除' })) toast('明細を消しました');
  }

  function recordsCard(p, cardId) {
    const unmatched = new Set(C.unmatchedRecords(p, cardId).map((r) => r.id));
    const recs = p.cardCheck.records
      .filter((r) => r.cardId === cardId)
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .slice(0, 60);
    return h(
      'section',
      { class: 'card card-flush' },
      h('div', { class: 'card-head' }, h('h2', { class: 'card-title', text: `カードを使った記録(${recs.length}件)` }), h('div', { class: 'card-head-side' }, btn('記録する', { size: 'small', icon: 'plus', onClick: () => openRecordSheet() }))),
      recs.length
        ? h(
            'ul',
            { class: 'pay-list asset-list' },
            recs.map((r) =>
              h(
                'li',
                { class: 'pay-row no-check' },
                h(
                  'button',
                  { type: 'button', class: 'pay-main', onClick: () => openRecordSheet(r) },
                  h('span', { class: 'pay-name', text: r.place || 'お店' }),
                  h('span', { class: 'pay-meta' }, h('span', { text: md(r.date) }), h('span', { class: `chip ${unmatched.has(r.id) ? 'chip-soft' : 'chip-up'}`, text: unmatched.has(r.id) ? '明細にまだ無い' : '明細と一致' })),
                  h('span', { class: 'pay-amount', text: yen(r.amount) })
                )
              )
            )
          )
        : h('p', { class: 'card-text hint', text: 'まだありません。カードを使ったら、右下の「カードを使った」で金額とお店を入れておきます。' })
    );
  }

  function knownCard(p, cardId) {
    const known = p.cardCheck.known.filter((k) => k.cardId === cardId);
    if (!known.length) return null;
    return h(
      'details',
      { class: 'card card-flush known-card' },
      h('summary', { class: 'card-head' }, h('h2', { class: 'card-title', text: `毎月の支払いとして覚えたもの(${known.length}件)` })),
      h('p', { class: 'card-text hint', text: '同じお店・同じ金額なら、確かめなくてよいものです。金額が変わると「確かめてほしいもの」に出ます。' }),
      h(
        'ul',
        { class: 'edit-list' },
        known.map((k) =>
          h(
            'li',
            { class: 'edit-row' },
            h('span', { class: 'edit-name' }, k.merchant, h('small', { class: 'edit-sub', text: yen(k.amount) })),
            h(
              'button',
              {
                type: 'button',
                class: 'icon-btn',
                'aria-label': `${k.merchant}を忘れる`,
                onClick: async () => {
                  const ok = await confirmDialog({ title: `「${k.merchant}」を忘れますか?`, message: '次の明細から、このお店も確かめるようになります。', okLabel: '忘れる' });
                  if (ok) store.update((d) => C.removeKnown(d.payments, k.id));
                },
              },
              icon('close')
            )
          )
        )
      )
    );
  }

  // ---------------------------------------------------------------
  // 明細を入れる(スクリーンショットの読み取り・貼り付け)
  // ---------------------------------------------------------------

  /** スマホの中で文字を読み取る(初めてのときだけ、読み取りのしくみを受け取る) */
  async function readImages(files, onStatus) {
    onStatus('読み取りのしくみを用意しています…(初めてのときは 6MB ほど受け取ります)');
    const T = await MT.libs.load('tesseract');
    const worker = await T.createWorker('jpn', 1, {
      ...OCR,
      logger: (m) => {
        if (m && m.status === 'recognizing text') onStatus(`読み取り中…(${Math.round((m.progress || 0) * 100)}%)`);
      },
    });
    try {
      const pages = [];
      for (let i = 0; i < files.length; i++) {
        onStatus(`読み取り中…(${i + 1}/${files.length}枚目)`);
        const { data } = await worker.recognize(files[i]);
        pages.push(data.text || '');
      }
      return pages;
    } finally {
      worker.terminate();
    }
  }

  function monthOptions(p) {
    const out = [];
    for (let i = -12; i <= 2; i++) out.push(U.ymAdd(p.month, i));
    return out.reverse().map((m) => ({ value: m, label: `${U.ymLabel(m)}払い` }));
  }

  function openStatementSheet(cardId, month) {
    const p = pay();
    const s = openSheet({ title: '明細を入れる', description: `${cardName(p, cardId)}`, className: 'sheet-form sheet-statement' });
    const err = MT.forms.errorLine();
    let rows = [];
    let curCard = cardId;
    const card = C.cards(p).length > 1 ? cardPicker(p, cardId, (v) => (curCard = v)) : null;
    const monthSel = MT.forms.selectEl(monthOptions(p), month, { 'aria-label': 'お支払いの月' });
    const status = h('p', { class: 'form-hint', 'aria-live': 'polite' });
    const table = h('div', { class: 'paste-preview' });
    const file = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, id: 'statement-file' });
    const ta = h('textarea', { class: 'field-textarea', id: 'statement-text', rows: 6, placeholder: 'ここに貼り付け(長押し →「ペースト」)' });

    const drawTable = () => {
      if (!rows.length) {
        table.replaceChildren();
        return;
      }
      const total = rows.reduce((t, r) => t + (r.amount || 0), 0);
      table.replaceChildren(
        h('p', { class: 'form-hint', text: `${rows.length}件・合計 ${yen(total)}。違うところは、その場で直せます(お店の名前の読み違いなど)。` }),
        h(
          'ul',
          { class: 'prow-list' },
          rows.map((r, i) =>
            h(
              'li',
              { class: 'prow' },
              h('input', { class: 'cell-input cell-date', type: 'date', value: r.date, 'aria-label': `${i + 1}行目の日付`, onChange: (e) => (r.date = e.target.value) }),
              h('input', {
                class: 'cell-input cell-amount',
                inputmode: 'numeric',
                value: U.yen(r.amount),
                'aria-label': `${i + 1}行目の金額(円)`,
                onChange: (e) => {
                  const v = U.parseYen(e.target.value);
                  if (v.ok && v.value !== null) r.amount = v.value;
                  drawTable();
                },
              }),
              h(
                'button',
                {
                  type: 'button',
                  class: 'icon-btn icon-btn-sm',
                  'aria-label': `${i + 1}行目を消す`,
                  onClick: () => {
                    rows.splice(i, 1);
                    drawTable();
                  },
                },
                icon('close')
              ),
              h('input', { class: 'cell-input cell-merchant', value: r.merchant, placeholder: '利用先', 'aria-label': `${i + 1}行目の利用先`, onInput: (e) => (r.merchant = e.target.value) })
            )
          )
        ),
        h('div', { class: 'button-row' }, btn('行を足す', { size: 'small', icon: 'plus', onClick: () => { rows.push({ date: U.todayStr(), merchant: '', amount: 0 }); drawTable(); } }))
      );
    };

    const readText = (texts) => {
      const pm = monthSel.value;
      const pages = texts.map((t) => C.parseText(t, { payMonth: pm }));
      rows = C.joinPages(pages).map((r) => ({ ...r }));
      drawTable();
      return rows.length;
    };

    const shot = btn('スクショを選んで読み取る', { variant: 'primary', icon: 'camera', onClick: () => file.click() });
    file.addEventListener('change', async () => {
      const files = [...file.files];
      file.value = '';
      if (!files.length) return;
      shot.disabled = true;
      try {
        const texts = await readImages(files, (msg) => (status.textContent = msg));
        const n = readText(texts);
        status.textContent = n ? `${files.length}枚から ${n}件を読み取りました。` : '日付と金額の形が見つかりませんでした。下の「うまく読めないとき」を試してください。';
      } catch (e) {
        status.textContent = '読み取れませんでした(インターネットにつながっているか確かめてください。初めての読み取りには、読み取りのしくみを受け取る必要があります)。下の「うまく読めないとき」で文字を貼り付けることもできます。';
      } finally {
        shot.disabled = false;
      }
    });

    add(
      s.body,
      card ? MT.forms.field('カード', card.el) : null,
      MT.forms.field('お支払いの月', monthSel, '同じカード・同じ月の明細を入れ直すと置き換えます(確かめた印は、同じ行なら残ります)。'),
      h('div', { class: 'button-row' }, shot, file),
      h('p', { class: 'form-hint', text: '明細のスクリーンショットを選ぶと、アプリがスマホの中で文字を読み取ります(画像も文字もスマホの外に送りません)。何枚かに分かれていても、続けて選べます(重なって写った行は 1 つにします)。' }),
      status,
      h(
        'details',
        { class: 'paste-more' },
        h('summary', { text: 'うまく読めないとき:文字を貼り付ける' }),
        h('p', { class: 'form-hint', text: 'iPhone の写真アプリでスクリーンショットを開き、文字を長押し →「すべてをコピー」して、ここに貼り付けます。' }),
        ta,
        h('div', { class: 'button-row' }, btn('貼り付けた文字を読む', { size: 'small', onClick: () => { const n = readText([ta.value]); status.textContent = n ? `${n}件を読み取りました。` : '日付と金額の形が見つかりませんでした。'; } }))
      ),
      table,
      err.el
    );
    MT.forms.formFoot(s, {
      saveLabel: 'この内容で保存',
      onSave: () => {
        err.hide();
        const clean = rows.filter((r) => U.isDateStr(r.date) && r.amount);
        if (!clean.length) return err.show('明細の行がありません。スクショを読み取るか、文字を貼り付けてください');
        let res = null;
        if (!store.update((d) => (res = C.saveStatement(d.payments, { cardId: curCard, month: monthSel.value, rows: clean })))) return;
        if (!res || !res.ok) return err.show(res ? res.error : '保存できませんでした');
        U.prefs.set(CARD_KEY, curCard);
        U.prefs.set(MONTH_KEY, monthSel.value);
        s.close();
        toast(`${clean.length}件を保存し、記録と突き合わせました`);
        MT.app.navigate('payments/cards');
      },
    });
  }

  // ---------------------------------------------------------------
  // 設定:カード・いつものカード・お店の候補
  // ---------------------------------------------------------------

  function settingsCard() {
    const p = pay();
    const c = p.cardCheck;
    const chosen = new Set(C.cards(p).map((b) => b.id));
    const bills = p.bills.filter((b) => !b.endMonth || b.endMonth >= p.month);
    const save = (ids, def) => store.update((d) => C.setCards(d.payments, ids, def));
    const cardBoxes = bills.map((b) => {
      const box = MT.forms.checkbox(b.name, chosen.has(b.id));
      box.input.addEventListener('change', () => {
        const ids = bills.filter((x) => (x.id === b.id ? box.input.checked : chosen.has(x.id))).map((x) => x.id);
        save(ids, c.defaultCardId);
        toast('カードを保存しました');
      });
      return box.el;
    });
    const defSel = MT.forms.selectEl([{ value: '', label: '前に記録したカード' }, ...C.cards(p).map((b) => ({ value: b.id, label: b.name }))], c.defaultCardId || '', { 'aria-label': 'いつものカード' });
    defSel.addEventListener('change', () => {
      save(C.cards(pay()).map((b) => b.id), defSel.value || null);
      toast('いつものカードを保存しました');
    });
    const places = h('ul', { class: 'edit-list' });
    const drawPlaces = () => {
      const list = pay().cardCheck.places;
      places.replaceChildren(
        ...list.map((name, i) =>
          h(
            'li',
            { class: 'edit-row' },
            h('span', { class: 'edit-name', text: name }),
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': `${name}を上へ`, disabled: i === 0, onClick: () => setPlaces(moved(list, i, i - 1)) }, icon('up')),
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': `${name}を下へ`, disabled: i === list.length - 1, onClick: () => setPlaces(moved(list, i, i + 1)) }, icon('down')),
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': `${name}を消す`, onClick: () => setPlaces(list.filter((x) => x !== name)) }, icon('close'))
          )
        )
      );
    };
    const moved = (list, from, to) => {
      const a = list.slice();
      U.moveInArray(a, from, to);
      return a;
    };
    const setPlaces = (next) => {
      store.update((d) => C.setPlaces(d.payments, next));
    };
    drawPlaces();
    const newPlace = MT.forms.textInput('', { id: 'card-place-new', maxlength: 20, placeholder: '例:本屋、ホームセンター', 'aria-label': '足すお店' });
    return h(
      'section',
      { class: 'card' },
      h('h2', { class: 'card-title', text: 'カードを使った記録・明細(支払い)' }),
      h('p', { class: 'hint', text: '右下の「カードを使った」で記録し、支払いの「カードの明細」で明細と突き合わせます。記録も明細も、この端末の中だけに保存します。' }),
      h('h3', { class: 'sp-title', text: 'カードとして使う支払い' }),
      h('div', { class: 'check-list' }, cardBoxes.length ? cardBoxes : h('p', { class: 'hint', text: '支払いがまだありません。' })),
      h('p', { class: 'form-hint', text: '何も選んでいないときは、名前に「カード」が入った支払いをカードにします。' }),
      MT.forms.field('いつものカード(記録するとき最初に選ばれる)', defSel),
      h('h3', { class: 'sp-title', text: 'お店の候補(上から順に出る)' }),
      places,
      h(
        'div',
        { class: 'input-with-btn' },
        newPlace,
        btn('足す', {
          icon: 'plus',
          onClick: () => {
            const v = newPlace.value.trim();
            if (!v) return;
            setPlaces([...pay().cardCheck.places, v]);
            newPlace.value = '';
          },
        })
      ),
      h('div', { class: 'button-row' }, btn('はじめの候補に戻す', { size: 'small', variant: 'ghost', onClick: () => setPlaces(C.DEFAULT_PLACES) }))
    );
  }

  MT.views = MT.views || {};
  MT.views['payments/cards'] = { render, tab: 'payments' };
  MT.cardUI = { tabBadge, overviewNotice, updateFab, openRecordSheet, settingsCard, pendingCount };
})(window);
