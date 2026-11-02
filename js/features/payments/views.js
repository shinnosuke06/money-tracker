/*
 * 支払い管理:画面
 *   #/payments           概要(キャッシュフロー・口座・カテゴリ別合計・注意)
 *   #/payments/bills     支払い・ローン、特別支出
 *   #/payments/income    入金予定、自動振り分け
 *   #/payments/history   月別の履歴
 *   #/payments/accounts  口座の設定(月末記録の項目とつなぐ・並べ替え)
 */
(function (root) {
  'use strict';
  const MT = root.MT;
  const U = MT.util;
  const P = MT.paymentsModel;
  const MM = MT.monthlyModel;
  const store = MT.store;
  const F = MT.paymentsUI;
  const { h, add, icon, btn, actionSheet, promptDialog, confirmDialog, openSheet, toast } = MT.ui;

  const SUBNAV = [
    { path: 'payments', label: '概要' },
    { path: 'payments/bills', label: '支払い' },
    { path: 'payments/income', label: '入金・振り分け' },
    { path: 'payments/history', label: '履歴' },
  ];

  const yen = (v) => `${U.yen(v)}円`;
  const negCls = (v) => (v < 0 ? ' is-neg' : '');

  function head(container, active) {
    const p = store.get().payments;
    container.append(
      h(
        'header',
        { class: 'page-head' },
        h('h1', { class: 'page-title', text: '支払い' }),
        h('span', { class: 'page-sub', text: `${U.ymLabel(p.month)}の支払い` })
      ),
      h(
        'nav',
        { class: 'subnav', 'aria-label': '支払いのメニュー' },
        SUBNAV.map((s) => h('a', { class: 'subnav-item', href: `#/${s.path}`, 'aria-current': s.path === active ? 'page' : null, text: s.label }))
      )
    );
  }

  function toggle(key, id) {
    store.update((d) => P.toggleDone(d.payments, key, id));
  }

  function checkBtn(checked, label, onToggle) {
    return h(
      'button',
      { type: 'button', class: `check-btn${checked ? ' is-on' : ''}`, role: 'checkbox', 'aria-checked': String(checked), 'aria-label': label, onClick: onToggle },
      icon('check')
    );
  }

  function stat(label, value, cls = '') {
    return h(
      'div',
      { class: `stat ${cls}`.trim() },
      h('span', { class: 'stat-label', text: label }),
      h('span', { class: `stat-value${negCls(value)}` }, U.yen(value), h('small', { text: '円' }))
    );
  }

  function warnBadge(text) {
    return h('span', { class: 'badge-warn', text });
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

  /** 引き落とし日の表示(今月なら「あと◯日」も) */
  function dueText(b, ym) {
    if (!b.dueDay) return { text: '日付未定', cls: '' };
    const base = { text: b.dueDay === 31 ? '末日' : `${b.dueDay}日`, cls: '' };
    if (b.done || ym !== U.currentYM()) return base;
    const diff = b.dueDay - new Date().getDate();
    if (diff < 0) return { text: `${base.text}・期日を過ぎています`, cls: 'is-warn' };
    if (diff === 0) return { text: `${base.text}・今日`, cls: 'is-soon' };
    if (diff <= 3) return { text: `${base.text}・あと${diff}日`, cls: 'is-soon' };
    return base;
  }

  // ---------------------------------------------------------------
  // 概要
  // ---------------------------------------------------------------

  function renderOverview(container) {
    const d = store.get();
    const p = d.payments;
    const ym = p.month;
    head(container, 'payments');

    if (p.notice) container.append(rolloverNotice(p.notice));
    if (!p.bills.length && !p.incomes.length) container.append(welcomeCard(p));
    if (!p.accounts.length) {
      container.append(
        notice('info', '支払いで使う口座がまだありません', ['口座は月末記録の項目と同じものを使います。「口座の設定」でつないでください。'], [
          btn('口座の設定', { variant: 'primary', size: 'small', onClick: () => MT.app.navigate('payments/accounts') }),
        ])
      );
    }

    const cf = P.cashflow(p, ym);
    container.append(cashflowCard(cf));
    const w = warningsCard(d, P.warnings(d, ym));
    if (w) container.append(w);
    if (p.accounts.length) container.append(accountsCard(d, ym));
    container.append(categoryCard(cf.totals), memoCard(p));
  }

  function rolloverNotice(n) {
    return notice('info', `${U.ymLabel(n.month)}分を締めて、履歴に保存しました`, [
      '「済」を外し、変動費と変動の入金を空欄に戻しました。',
      `${U.monthLabel(n.month)}末の口座残高を、月末記録に反映できます。`,
    ], [
      btn(`${U.monthLabel(n.month)}末の記録に反映`, { variant: 'primary', size: 'small', onClick: () => F.openReflectSheet(n.month) }),
      btn('閉じる', { size: 'small', onClick: () => store.update((d) => (d.payments.notice = null)) }),
    ]);
  }

  function welcomeCard() {
    return h(
      'section',
      { class: 'card welcome' },
      h('h2', { class: 'card-title', text: '支払い管理をはじめる' }),
      h('p', { text: 'カードやローンの支払い、入金予定を登録すると、口座ごとに足りるかどうかと、どこにいくら入れればよいかが分かります。' }),
      h(
        'div',
        { class: 'button-row' },
        btn('支払いを追加', { variant: 'primary', icon: 'plus', onClick: () => F.openBillSheet(null) }),
        btn('入金予定を追加', { icon: 'plus', onClick: () => F.openIncomeSheet(null) })
      ),
      h('p', { class: 'hint', text: '旧・支払い管理アプリのデータは、設定から読み込めます。' })
    );
  }

  function cashflowCard(cf) {
    return h(
      'section',
      { class: 'card cashflow' },
      h('h2', { class: 'card-title', text: '今月のキャッシュフロー' }),
      h(
        'div',
        { class: 'stat-grid' },
        stat('確保している資金', cf.secured),
        stat('残りの支払い(未済)', cf.remaining)
      ),
      h('p', { class: 'hint cf-breakdown', text: `確保している資金 = 口座残高 ${yen(cf.balances)} + 入金予定(未済)${yen(cf.pendingIncome)}` }),
      h(
        'div',
        { class: 'cf-net' },
        h('p', { class: 'summary-label', text: '差引予測残高' }),
        h('p', { class: `summary-value${negCls(cf.net)}` }, U.yen(cf.net), h('span', { class: 'summary-unit', text: '円' }))
      )
    );
  }

  function warningsCard(d, w) {
    const items = [];
    const names = (list, f = (x) => x.name) => list.map(f).join('、');
    const go = (path) => () => MT.app.navigate(path);
    if (w.shortAccounts.length) items.push({ text: `引落後予想がマイナスの口座:${names(w.shortAccounts, (r) => `${r.name}(${U.yen(r.after)}円)`)}`, path: 'payments/income', label: '振り分けを見る' });
    if (w.missingAmount.length) items.push({ text: `請求額が未入力:${names(w.missingAmount)}`, path: 'payments/bills', label: '入力する' });
    if (w.overSub.length) items.push({ text: `内訳の合計が請求額を超えています:${names(w.overSub)}`, path: 'payments/bills', label: '確認する' });
    if (w.noAccount.length) items.push({ text: `引き落とし口座が未設定:${names(w.noAccount)}`, path: 'payments/bills', label: '設定する' });
    if (w.missingIncome.length) items.push({ text: `金額が未入力の入金予定:${names(w.missingIncome)}`, path: 'payments/income', label: '入力する' });
    if (w.overAllocated.length) items.push({ text: `入金額より多く振り分けています:${names(w.overAllocated, (x) => x.income.name)}`, path: 'payments/income', label: '直す' });
    if (w.pastSpecials.length) items.push({ text: `支払月を過ぎた未済の特別支出:${names(w.pastSpecials)}`, path: 'payments/bills', label: '確認する' });
    if (!items.length) return null;
    return h(
      'section',
      { class: 'card warn-card' },
      h('h2', { class: 'card-title' }, icon('alert', 'title-icon'), '確認してください'),
      h(
        'ul',
        { class: 'warn-list' },
        items.map((x) => h('li', null, h('span', { text: x.text }), btn(x.label, { size: 'small', variant: 'ghost', onClick: go(x.path) })))
      )
    );
  }

  function accountsCard(d, ym) {
    const p = d.payments;
    const rows = P.accountRows(d, ym);
    const un = P.withdrawals(p, ym).unassigned;
    return h(
      'section',
      { class: 'card card-flush' },
      h(
        'div',
        { class: 'card-head' },
        h('h2', { class: 'card-title', text: '口座と手元現金' }),
        btn('口座の設定', { variant: 'ghost', size: 'small', onClick: () => MT.app.navigate('payments/accounts') })
      ),
      h(
        'ul',
        { class: 'acct-list' },
        rows.map((r) =>
          h(
            'li',
            null,
            h(
              'button',
              {
                type: 'button',
                class: 'acct-row',
                'aria-label': `${r.name} 現在残高 ${r.balance === null ? '未入力' : yen(r.balance)}、引落後予想 ${yen(r.after)}。タップして残高を更新`,
                onClick: () => F.openBalanceSheet(r.itemId),
              },
              h(
                'span',
                { class: 'acct-top' },
                icon(r.kind === 'cash' ? 'wallet' : 'bank', 'acct-icon'),
                h('span', { class: 'acct-name' }, r.name, h('small', { text: r.balanceDate ? `残高 ${U.shortDate(r.balanceDate)} 更新` : r.kind === 'cash' ? '手元現金' : '銀行口座' })),
                h('span', { class: `acct-balance${r.balance === null ? ' is-missing' : negCls(r.balance)}`, text: r.balance === null ? '残高未入力' : yen(r.balance) })
              ),
              h(
                'span',
                { class: 'acct-flow' },
                h('span', { text: `入金予定 +${U.yen(r.incoming)}` }),
                h('span', { text: `引き落とし −${U.yen(r.withdraw)}` })
              ),
              h('span', { class: 'acct-after' }, h('span', { text: '引落後予想' }), h('span', { class: `num${negCls(r.after)}`, text: yen(r.after) }))
            )
          )
        )
      ),
      un.unpaid
        ? h('p', { class: 'acct-unassigned' }, `口座が未設定の支払い(未済):${yen(un.unpaid)}`)
        : null,
      h(
        'div',
        { class: 'card-foot' },
        h('p', { class: 'hint', text: '口座をタップすると現在残高を更新できます。「済」の支払い・入金は、残高に反映済みとして計算します。' }),
        btn('月末記録に反映', { icon: 'sync', onClick: () => F.openReflectSheet((p.notice && p.notice.month) || null) })
      )
    );
  }

  function categoryCard(t) {
    return h(
      'section',
      { class: 'card' },
      h('h2', { class: 'card-title', text: 'カテゴリ別の合計' }),
      h(
        'table',
        { class: 'cat-table' },
        h('thead', null, h('tr', null, h('th', { scope: 'col', text: 'カテゴリ' }), h('th', { scope: 'col', text: '合計' }), h('th', { scope: 'col', text: '未済' }))),
        h(
          'tbody',
          null,
          P.TOTAL_CATEGORIES.map((c) =>
            h(
              'tr',
              null,
              h('th', { scope: 'row' }, F.catDot(c.id), c.label),
              h('td', { class: negCls(t.byCategory[c.id].total).trim(), text: U.yen(t.byCategory[c.id].total) }),
              h('td', { class: negCls(t.byCategory[c.id].unpaid).trim(), text: U.yen(t.byCategory[c.id].unpaid) })
            )
          )
        ),
        h(
          'tfoot',
          null,
          h('tr', null, h('th', { scope: 'row', text: '合計' }), h('td', { text: U.yen(t.total) }), h('td', { text: U.yen(t.unpaid) }))
        )
      ),
      h('p', { class: 'hint', text: `済:${yen(t.paid)}。内訳は内訳のカテゴリに、請求額の残りは支払いのカテゴリに入ります(合計と未済は同じ明細から計算)。` })
    );
  }

  function memoCard(p) {
    return h(
      'section',
      { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', { class: 'card-title', text: 'メモ' }), btn('編集', { variant: 'ghost', size: 'small', icon: 'edit', onClick: F.openMemoSheet })),
      p.memo ? h('p', { class: 'memo-text', text: p.memo }) : h('p', { class: 'hint', text: 'メモはありません。' })
    );
  }

  // ---------------------------------------------------------------
  // 支払い・ローン、特別支出
  // ---------------------------------------------------------------

  function renderBills(container) {
    const d = store.get();
    const p = d.payments;
    const ym = p.month;
    head(container, 'payments/bills');
    const t = P.totals(p, ym);
    const bills = P.activeBills(p, ym);
    const specials = P.specialsFor(p, ym);

    container.append(
      h(
        'section',
        { class: 'card' },
        h(
          'div',
          { class: 'card-head' },
          h('h2', { class: 'card-title', text: '今月の支払い' }),
          btn('追加', { icon: 'plus', variant: 'primary', size: 'small', onClick: () => F.openBillSheet(null) })
        ),
        h('div', { class: 'stat-grid stat-grid-3' }, stat('合計', t.total), stat('済', t.paid), stat('未済', t.unpaid))
      )
    );

    const list = h('ul', { class: 'pay-list' });
    for (const b of bills) list.append(billRow(d, b, ym));
    for (const s of specials) list.append(specialRow(d, s, ym, true));
    if (!bills.length && !specials.length) list.append(h('li', { class: 'pay-empty', text: '今月の支払いはありません。「追加」から登録してください。' }));
    container.append(
      h(
        'section',
        { class: 'card card-flush' },
        h('div', { class: 'card-head' }, h('h2', { class: 'card-title', text: '支払い・ローン' }), h('span', { class: 'hint', text: '引き落とし日順' })),
        list,
        endedSection(d, ym)
      ),
      specialsCard(d, ym)
    );
  }

  function billRow(d, b, ym) {
    const subs = P.activeSubs(b, ym);
    const total = P.billTotal(b, ym);
    const due = dueText(b, ym);
    const missing = b.amount === null;
    return h(
      'li',
      { class: `pay-row${b.done ? ' is-done' : ''}` },
      checkBtn(b.done, `「${b.name}」を済にする`, () => toggle('bills', b.id)),
      h(
        'button',
        { type: 'button', class: 'pay-main', onClick: () => F.openBillSheet(b.id) },
        h(
          'span',
          { class: 'pay-name' },
          b.name,
          P.isOverSub(b, ym) ? warnBadge('内訳が超過') : null,
          b.memo ? h('span', { class: 'memo-mark', title: b.memo, 'aria-label': 'メモあり', text: '✎' }) : null
        ),
        h(
          'span',
          { class: 'pay-meta' },
          F.catChip(b.category),
          h('span', { class: `meta-due ${due.cls}`.trim(), text: due.text }),
          h('span', { text: b.accountId ? P.accountName(d, b.accountId) : '口座なし' }),
          subs.length ? h('span', { text: `内訳 ${subs.length}件` }) : null,
          b.endMonth ? h('span', { text: `${U.ymLabel(b.endMonth)}まで` }) : null
        ),
        h(
          'span',
          { class: `pay-amount${missing && !subs.length ? ' is-missing' : ''}` },
          missing && !subs.length ? '未入力' : yen(total),
          missing && subs.length ? h('small', { text: '請求額未入力(内訳の合計)' }) : null
        )
      )
    );
  }

  function specialRow(d, s, ym, inList) {
    const months = U.ymDiff(s.month, ym);
    const when = s.month === ym ? '今月' : months > 0 ? `${U.ymLabel(s.month)}(あと${months}か月)` : U.ymLabel(s.month);
    const showCheck = s.month <= ym;
    return h(
      'li',
      { class: `pay-row${s.done ? ' is-done' : ''}${showCheck ? '' : ' no-check'}` },
      showCheck ? checkBtn(s.done, `「${s.name}」を済にする`, () => toggle('specials', s.id)) : null,
      h(
        'button',
        { type: 'button', class: 'pay-main', onClick: () => F.openSpecialSheet(s.id) },
        h('span', { class: 'pay-name' }, s.name),
        h(
          'span',
          { class: 'pay-meta' },
          inList ? F.catChip('special') : null,
          h('span', { text: when }),
          s.accountId ? h('span', { text: P.accountName(d, s.accountId) }) : null
        ),
        h('span', { class: `pay-amount${s.amount === null ? ' is-missing' : ''}`, text: s.amount === null ? '未入力' : yen(s.amount) })
      )
    );
  }

  function endedSection(d, ym) {
    const ended = P.endedBills(d.payments, ym);
    if (!ended.length) return null;
    return h(
      'details',
      { class: 'ended' },
      h('summary', { text: `終了した支払い(${ended.length}件・非表示)` }),
      h(
        'ul',
        { class: 'pay-list' },
        ended.map((b) =>
          h(
            'li',
            { class: 'pay-row no-check is-done' },
            h(
              'button',
              { type: 'button', class: 'pay-main', onClick: () => F.openBillSheet(b.id) },
              h('span', { class: 'pay-name', text: b.name }),
              h('span', { class: 'pay-meta' }, h('span', { text: `${U.ymLabel(b.endMonth)}で終了` })),
              h('span', { class: 'pay-amount', text: b.amount === null ? '—' : yen(b.amount) })
            )
          )
        )
      )
    );
  }

  function specialsCard(d, ym) {
    const p = d.payments;
    const g = P.specialGroups(p, ym);
    const plan = P.savingPlan(p, ym);
    const perMonth = new Map(plan.rows.map((r) => [r.special.id, r.perMonth]));
    const section = (title, list, extra) =>
      list.length
        ? h(
            'div',
            { class: 'sp-section' },
            h('h3', { class: 'sp-title', text: title }),
            h(
              'ul',
              { class: 'pay-list' },
              list.map((s) => {
                const row = specialRow(d, s, ym, false);
                if (perMonth.has(s.id)) row.querySelector('.pay-meta').append(h('span', { class: 'meta-saving', text: `積立 月${U.yen(perMonth.get(s.id))}円` }));
                return row;
              })
            ),
            extra || null
          )
        : null;
    return h(
      'section',
      { class: 'card card-flush' },
      h(
        'div',
        { class: 'card-head' },
        h('h2', { class: 'card-title', text: '特別支出' }),
        btn('追加', { icon: 'plus', size: 'small', onClick: () => F.openSpecialSheet(null) })
      ),
      h('p', { class: 'card-text hint', text: '固定資産税や車検など、毎月ではない支出です。支払月になると、その月の支払いに含めます。' }),
      section('今月(上の支払いにも含めています)', g.current),
      section('今後の予定', g.upcoming),
      g.past.length
        ? h(
            'details',
            { class: 'ended' },
            h('summary', { text: `過去の特別支出(${g.past.length}件)` }),
            h('ul', { class: 'pay-list' }, g.past.map((s) => specialRow(d, s, ym, false)))
          )
        : null,
      !p.specials.length ? h('p', { class: 'card-text hint', text: 'まだ登録がありません。' }) : null,
      h(
        'div',
        { class: 'saving' },
        h('span', { class: 'saving-label', text: '月あたりの必要積立額' }),
        h('span', { class: 'saving-value', text: yen(plan.total) })
      ),
      h('p', { class: 'card-text hint', text: '今後の未済の特別支出を、支払月までの月数で割った額の合計です(100円単位で切り上げ)。' })
    );
  }

  // ---------------------------------------------------------------
  // 入金予定・自動振り分け
  // ---------------------------------------------------------------

  function renderIncome(container) {
    const d = store.get();
    const p = d.payments;
    head(container, 'payments/income');
    const total = p.incomes.reduce((t, i) => t + (i.amount || 0), 0);
    const pending = P.pendingIncomes(p).reduce((t, i) => t + i.amount, 0);

    const list = h('ul', { class: 'pay-list' });
    for (const i of p.incomes) list.append(incomeRow(d, i));
    if (!p.incomes.length) list.append(h('li', { class: 'pay-empty', text: '入金予定はまだありません。「追加」から登録してください。' }));

    container.append(
      h(
        'section',
        { class: 'card card-flush' },
        h(
          'div',
          { class: 'card-head' },
          h('h2', { class: 'card-title', text: '入金予定' }),
          btn('追加', { icon: 'plus', variant: 'primary', size: 'small', onClick: () => F.openIncomeSheet(null) })
        ),
        h('div', { class: 'stat-grid card-text' }, stat('合計', total), stat('未済', pending)),
        list
      ),
      allocationCard(d)
    );
  }

  function incomeRow(d, i) {
    return h(
      'li',
      { class: `pay-row${i.done ? ' is-done' : ''}` },
      checkBtn(i.done, `「${i.name}」を入金済にする`, () => toggle('incomes', i.id)),
      h(
        'button',
        { type: 'button', class: 'pay-main', onClick: () => F.openIncomeSheet(i.id) },
        h('span', { class: 'pay-name' }, i.name, i.memo ? h('span', { class: 'memo-mark', 'aria-label': 'メモあり', text: '✎' }) : null),
        h(
          'span',
          { class: 'pay-meta' },
          h('span', { class: 'chip', text: i.fixed ? '毎月固定' : '変動' }),
          h('span', { text: i.targetId ? `優先:${P.accountName(d, i.targetId)}` : '振込先の指定なし' })
        ),
        h('span', { class: `pay-amount${i.amount === null ? ' is-missing' : ''}`, text: i.amount === null ? '未入力' : yen(i.amount) })
      )
    );
  }

  function allocationCard(d) {
    const p = d.payments;
    const ym = p.month;
    const plan = P.planSummary(p, ym);
    const rows = P.accountRows(d, ym);
    const incomeName = (id) => (p.incomes.find((i) => i.id === id) || {}).name || '—';
    const card = h(
      'section',
      { class: 'card card-flush alloc-card' },
      h(
        'div',
        { class: 'card-head' },
        h('h2', { class: 'card-title', text: '自動振り分け' }),
        h('span', { class: `mode-badge${plan.mode === 'manual' ? ' is-manual' : ''}`, text: plan.mode === 'manual' ? '手動で調整中' : '自動の提案' })
      ),
      h('p', { class: 'card-text hint', text: '引き落としで足りない口座に、入金予定から入れる額の提案です。優先振込先のある入金から先に使い、不足額は1,000円単位で切り上げます。金額をタップすると手で直せます。' })
    );

    if (!p.accounts.length) {
      card.append(h('p', { class: 'card-text', text: '口座がありません。概要の「口座の設定」からつないでください。' }));
      return card;
    }

    // 不足する口座
    const short = rows.filter((r) => r.need > 0);
    card.append(
      h(
        'div',
        { class: 'card-text' },
        h('h3', { class: 'sp-title', text: '引き落としで不足する額' }),
        short.length
          ? h('ul', { class: 'need-list' }, short.map((r) => h('li', null, h('span', { text: r.name }), h('span', { class: 'is-neg', text: `${yen(r.need)}` }))))
          : h('p', { class: 'hint', text: '不足する口座はありません。' })
      )
    );

    // 口座ごとの「どこにいくら」
    const blocks = rows.filter((r) => r.incoming > 0 || r.need > 0);
    const byAcc = h('div', { class: 'alloc-list' });
    for (const r of blocks) {
      const items = plan.items.filter((x) => x.accountId === r.itemId);
      byAcc.append(
        h(
          'div',
          { class: 'alloc-block' },
          h('div', { class: 'alloc-head' }, h('span', { class: 'alloc-acc', text: r.name }), h('span', { class: 'alloc-total', text: `+${yen(r.incoming)}` })),
          items.length
            ? h(
                'ul',
                { class: 'alloc-items' },
                items.map((x) =>
                  h(
                    'li',
                    null,
                    h(
                      'button',
                      {
                        type: 'button',
                        class: 'alloc-item',
                        'aria-label': `${incomeName(x.incomeId)}から${r.name}へ ${yen(x.amount)}。タップして直す`,
                        onClick: () => F.openAllocationSheet(x.incomeId, x.accountId, x.amount),
                      },
                      h('span', { text: `${incomeName(x.incomeId)} から` }),
                      h('span', { class: 'num', text: yen(x.amount) }),
                      icon('edit', 'alloc-edit')
                    )
                  )
                )
              )
            : h('p', { class: 'hint alloc-none', text: '振り分けなし' }),
          h('p', { class: 'alloc-after' }, '入金後の引落後予想 ', h('span', { class: `num${negCls(r.after)}`, text: yen(r.after) }))
        )
      );
    }
    if (blocks.length) card.append(h('h3', { class: 'sp-title card-text', text: 'どの口座にいくら入れるか' }), byAcc);

    // 余り・超過
    const extra = h('div', { class: 'card-text' });
    if (plan.unassigned.length) {
      extra.append(
        h('h3', { class: 'sp-title', text: 'どこにも振り分けていない入金' }),
        h('ul', { class: 'need-list' }, plan.unassigned.map((u) => h('li', null, h('span', { text: u.income.name }), h('span', { text: yen(u.rest) }))))
      );
    }
    for (const o of plan.over) extra.append(h('p', { class: 'field-error', text: `「${o.income.name}」の振り分けが入金額を ${yen(o.over)} 超えています。` }));
    for (const r of rows.filter((x) => x.after < 0)) extra.append(h('p', { class: 'field-error', text: `「${r.name}」は振り分け後も ${yen(-r.after)} 足りません。` }));
    if (extra.childNodes.length) card.append(extra);

    card.append(
      h(
        'div',
        { class: 'card-foot button-row' },
        btn('振り分けを追加', { icon: 'plus', size: 'small', onClick: () => F.openAllocationSheet(null, null, null) }),
        plan.mode === 'manual'
          ? btn('自動の提案に戻す', {
              size: 'small',
              onClick: async () => {
                const ok = await confirmDialog({ title: '自動の提案に戻しますか?', message: ['手で直した振り分けは消え、自動の提案に戻ります。'], okLabel: '戻す' });
                if (ok && store.update((dd) => P.resetAllocation(dd.payments))) toast('自動の提案に戻しました');
              },
            })
          : null
      )
    );
    return card;
  }

  // ---------------------------------------------------------------
  // 履歴
  // ---------------------------------------------------------------

  const HISTORY_MODES = [
    { value: 'flow', label: '収入と支払' },
    { value: 'category', label: '支払の内訳' },
    { value: 'balance', label: '月末残高' },
  ];

  function renderHistory(container) {
    const p = store.get().payments;
    head(container, 'payments/history');
    if (!p.history.length) {
      container.append(
        h(
          'section',
          { class: 'card' },
          h('h2', { class: 'card-title', text: '履歴はまだありません' }),
          h('p', { class: 'hint', text: '月が変わると、前月の収入・支払・月末残高がここに保存されます。' })
        )
      );
      return;
    }
    let mode = U.prefs.get('paymentsHistoryMode', 'flow');
    if (!HISTORY_MODES.some((m) => m.value === mode)) mode = 'flow';
    const canvas = h('canvas', { role: 'img', 'aria-label': `月別の履歴グラフ(${HISTORY_MODES.find((m) => m.value === mode).label})。数値は下の一覧を参照。` });
    const fallback = h('p', { class: 'chart-fallback', hidden: true, text: 'グラフを読み込めませんでした。インターネットに接続して、もう一度開いてください。' });
    container.append(
      h(
        'section',
        { class: 'card chart-card' },
        h('div', { class: 'card-head' }, h('h2', { class: 'card-title', text: '月別の推移' })),
        h(
          'div',
          { class: 'seg seg-wide', role: 'group', 'aria-label': 'グラフの種類' },
          HISTORY_MODES.map((m) =>
            h('button', {
              type: 'button',
              'aria-pressed': String(m.value === mode),
              text: m.label,
              onClick: () => {
                U.prefs.set('paymentsHistoryMode', m.value);
                MT.app.rerender();
              },
            })
          )
        ),
        h('div', { class: 'chart-box' }, canvas, fallback)
      ),
      h(
        'section',
        { class: 'card card-flush' },
        h('div', { class: 'card-head' }, h('h2', { class: 'card-title', text: '月ごとの記録' })),
        h(
          'ul',
          { class: 'hist-list' },
          [...p.history].reverse().map((x) =>
            h(
              'li',
              null,
              h(
                'button',
                { type: 'button', class: 'hist-row', onClick: () => openHistorySheet(x.month) },
                h('span', { class: 'hist-month', text: U.ymLabel(x.month) }),
                h(
                  'span',
                  { class: 'hist-nums' },
                  h('span', null, h('small', { text: '収入' }), U.yen(x.income)),
                  h('span', null, h('small', { text: '支払' }), U.yen(x.payment)),
                  h('span', null, h('small', { text: '月末残高' }), x.balance == null ? '—' : U.yen(x.balance))
                )
              )
            )
          )
        )
      )
    );
    MT.paymentsChart.render(canvas, fallback, p.history, mode);
  }

  function openHistorySheet(month) {
    const p = store.get().payments;
    const x = p.history.find((e) => e.month === month);
    if (!x) return;
    const s = openSheet({ title: `${U.ymLabel(month)}の記録`, className: 'sheet-form' });
    const row = (label, value, cls = '') => [h('dt', { text: label }), h('dd', { class: cls, text: value })];
    add(
      s.body,
      h(
        'dl',
        { class: 'info-list' },
        row('収入', yen(x.income)),
        row('支払', yen(x.payment)),
        row('差', `${U.yenSigned(x.income - x.payment)}円`, x.income - x.payment < 0 ? 'is-neg' : ''),
        row('月末残高', x.balance == null ? '—' : yen(x.balance))
      ),
      h('h3', { class: 'form-section-title', text: 'カテゴリ別' }),
      h(
        'table',
        { class: 'cat-table' },
        h('tbody', null, P.TOTAL_CATEGORIES.map((c) => h('tr', null, h('th', { scope: 'row' }, F.catDot(c.id), c.label), h('td', { text: U.yen(x.catTotals[c.id] || 0) }))))
      ),
      x.details.length
        ? [
            h('h3', { class: 'form-section-title', text: '支払いの明細' }),
            h('ul', { class: 'detail-list' }, x.details.map((e) => h('li', null, h('span', null, F.catDot(e.category), e.name), h('span', { text: yen(e.amount) })))),
          ]
        : null,
      x.incomeDetails.length
        ? [
            h('h3', { class: 'form-section-title', text: '入金の明細' }),
            h('ul', { class: 'detail-list' }, x.incomeDetails.map((e) => h('li', null, h('span', { text: e.name }), h('span', { text: yen(e.amount) })))),
          ]
        : null
    );
    s.foot.append(
      btn('削除', {
        variant: 'ghost',
        className: 'btn-ghost-danger',
        onClick: async () => {
          const ok = await confirmDialog({
            title: `${U.ymLabel(month)}の記録を削除しますか?`,
            message: ['間違えた場合は、設定の「直前のデータに戻す」で元に戻せます。'],
            okLabel: '削除する',
            danger: true,
          });
          if (ok && store.update((d) => P.deleteHistory(d.payments, month), { backup: `${U.ymLabel(month)}の支払い履歴の削除` })) {
            s.close();
            toast('削除しました');
          }
        },
      }),
      btn('閉じる', { onClick: () => s.close() })
    );
  }

  // ---------------------------------------------------------------
  // 口座の設定
  // ---------------------------------------------------------------

  function renderAccounts(container) {
    const d = store.get();
    const p = d.payments;
    const linked = new Set(p.accounts.map((a) => a.itemId));
    container.append(
      h(
        'header',
        { class: 'page-head' },
        h('a', { class: 'back-link', href: '#/payments' }, icon('back'), h('span', { text: '支払い' })),
        h('h1', { class: 'page-title page-title-sub', text: '口座の設定' })
      ),
      h('p', { class: 'hint page-hint', text: '口座は月末記録の項目と同じものを使います(名前の変更・削除は、月末記録の「項目を編集」から)。' })
    );

    const list = h('ul', { class: 'edit-list' });
    p.accounts.forEach((a, i) => {
      const it = MM.findItem(d.monthly, a.itemId);
      const cat = it ? MM.findCategory(d.monthly, it.categoryId) : null;
      const kindSel = F.selectEl(
        P.KINDS.map((k) => ({ value: k.id, label: k.label })),
        a.kind,
        { class: 'field-select field-sm kind-select', 'aria-label': `${it ? it.name : ''}の種類` }
      );
      kindSel.addEventListener('change', () => store.update((dd) => P.setAccountKind(dd.payments, a.itemId, kindSel.value)));
      list.append(
        h(
          'li',
          { class: 'edit-row acct-edit' },
          h('span', { class: 'edit-name' }, it ? it.name : '—', h('small', { class: 'edit-sub', text: cat ? cat.name : '' })),
          kindSel,
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': '上へ', disabled: i === 0, onClick: () => store.update((dd) => P.moveAccount(dd.payments, a.itemId, -1)) }, icon('up')),
          h(
            'button',
            { type: 'button', class: 'icon-btn', 'aria-label': '下へ', disabled: i === p.accounts.length - 1, onClick: () => store.update((dd) => P.moveAccount(dd.payments, a.itemId, 1)) },
            icon('down')
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'icon-btn',
              'aria-label': `${it ? it.name : ''}を支払いで使わない`,
              onClick: async () => {
                const ok = await confirmDialog({
                  title: `「${it ? it.name : ''}」を支払いで使わないようにしますか?`,
                  message: ['月末記録の項目と金額はそのまま残ります。', 'この口座を指していた支払い・入金は「口座なし」になります。'],
                  okLabel: '外す',
                });
                if (ok) store.update((dd) => P.unlinkAccount(dd, a.itemId), { backup: '口座を外す' });
              },
            },
            icon('close')
          )
        )
      );
    });
    if (!p.accounts.length) list.append(h('li', { class: 'edit-row edit-empty', text: 'まだありません。下の一覧から追加してください。' }));

    const candidates = h('div');
    for (const g of MM.groups(d.monthly)) {
      const items = g.items.filter((it) => !linked.has(it.id));
      if (!items.length) continue;
      candidates.append(
        h('h3', { class: 'sp-title', text: g.category.name }),
        h(
          'ul',
          { class: 'edit-list' },
          items.map((it) =>
            h(
              'li',
              { class: 'edit-row' },
              h('span', { class: 'edit-name', text: it.name }),
              btn('追加', {
                size: 'small',
                icon: 'plus',
                onClick: () => {
                  const kind = /現金|財布|手元/.test(it.name) ? 'cash' : 'bank';
                  if (store.update((dd) => P.linkAccount(dd, it.id, kind))) toast(`「${it.name}」を口座に追加しました`);
                },
              })
            )
          )
        )
      );
    }
    if (!candidates.childNodes.length) candidates.append(h('p', { class: 'hint', text: '追加できる項目はありません。' }));

    container.append(
      h('section', { class: 'card edit-card' }, h('h2', { class: 'card-title card-title-pad', text: '支払いで使う口座' }), list),
      h('section', { class: 'card' }, h('h2', { class: 'card-title', text: '月末記録の項目から追加' }), candidates),
      h('div', { class: 'button-row' }, btn('新しい口座を作る', { icon: 'plus', onClick: createAccountFlow }))
    );
  }

  async function createAccountFlow() {
    const d = store.get();
    if (!d.monthly.categories.length) {
      toast('先に月末記録で区分を作ってください', { type: 'error' });
      return;
    }
    const name = await promptDialog({ title: '新しい口座', label: '口座の名前(月末記録にも項目として追加されます)', placeholder: '例:〇〇銀行 普通', okLabel: '次へ', maxLength: P.NAME_MAX });
    if (!name) return;
    const cash = d.monthly.categories.find((c) => c.id === 'cat_cash') || d.monthly.categories[0];
    actionSheet({
      title: `「${name}」の種類`,
      description: `月末記録の「${cash.name}」に項目を追加します。`,
      actions: P.KINDS.map((k) => ({
        label: k.label,
        onSelect: () => {
          if (store.update((dd) => P.createAccount(dd, cash.id, name, k.id))) toast(`「${name}」を作りました`);
        },
      })),
    });
  }

  // ---------------------------------------------------------------
  // 登録
  // ---------------------------------------------------------------

  function needsAttention() {
    const d = store.get();
    if (!d || !d.payments) return false;
    if (d.payments.notice) return true;
    return P.accountRows(d, d.payments.month).some((r) => r.after < 0);
  }

  MT.views = MT.views || {};
  MT.views.payments = { render: renderOverview, needsAttention };
  MT.views['payments/bills'] = { render: renderBills, tab: 'payments' };
  MT.views['payments/income'] = { render: renderIncome, tab: 'payments' };
  MT.views['payments/history'] = { render: renderHistory, tab: 'payments', unmount: () => MT.paymentsChart.destroy() };
  MT.views['payments/accounts'] = { render: renderAccounts, tab: 'payments' };

  // 月替わり:起動時・画面に戻ったとき・データが変わったときに確認する
  MT.maintenance = MT.maintenance || [];
  MT.maintenance.push(() => {
    const d = store.get();
    if (!d.payments || !(d.payments.month < U.currentYM())) return null;
    let res = null;
    store.update((dd) => {
      res = P.rollover(dd);
    });
    return res ? `${U.ymLabel(res.month)}分の支払いを締めて、履歴に保存しました` : null;
  });
})(window);
