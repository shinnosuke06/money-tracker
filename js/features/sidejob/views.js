/*
 * 副業収入:画面
 *   #/sidejob          月の一覧(月切り替え・依頼元の絞り込み・入金確認・スクショモード)
 *   #/sidejob/plan     予定と予想額(曜日パターンのカレンダー・今月/来月の予想・支払い管理への連携)
 *   #/sidejob/trend    推移(直近 6 か月・依頼元別の積み上げ棒グラフ)
 *   #/sidejob/clients  依頼元(最大 5 件)
 * 表示は万円(小数 1 桁)、計算と保存は円の整数。
 */
(function (root) {
  'use strict';
  const MT = root.MT;
  const U = MT.util;
  const S = MT.sidejobModel;
  const store = MT.store;
  const C = MT.charts;
  const F = MT.sidejobUI;
  const { h, add, icon, btn, toast, actionSheet } = MT.ui;

  const SUBNAV = [
    { path: 'sidejob', label: '記録' },
    { path: 'sidejob/plan', label: '予定と予想' },
    { path: 'sidejob/trend', label: '推移' },
    { path: 'sidejob/clients', label: '依頼元' },
  ];

  // 画面を描き直しても保つ状態
  const state = { month: U.currentYM(), client: null, shot: false };

  const sj = () => store.get().sidejob;

  function head(container, active) {
    container.append(
      h('header', { class: 'page-head' }, h('h1', { class: 'page-title', text: '副業' }), h('span', { class: 'page-sub', text: '表示は万円' })),
      h(
        'nav',
        { class: 'subnav', 'aria-label': '副業のメニュー' },
        SUBNAV.map((s) => h('a', { class: 'subnav-item', href: `#/${s.path}`, 'aria-current': s.path === active ? 'page' : null, text: s.label }))
      )
    );
  }

  /** 月の切り替え */
  function monthSwitcher() {
    const go = (n) => () => {
      state.month = U.ymAdd(state.month, n);
      MT.app.rerender();
    };
    return h(
      'div',
      { class: 'month-switch' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': '前の月', onClick: go(-1) }, icon('prev')),
      h('span', { class: 'month-switch-label', text: U.ymLabel(state.month) }),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': '次の月', onClick: go(1) }, icon('next'))
    );
  }

  /** 依頼元の絞り込み(全体 / 各依頼元) */
  function clientFilter(data) {
    if (state.client && !S.findClient(data, state.client)) state.client = null;
    const chip = (cid, labelText) =>
      h('button', {
        type: 'button',
        class: 'filter-chip',
        'aria-pressed': String(state.client === cid),
        text: labelText,
        onClick: () => {
          state.client = cid;
          MT.app.rerender();
        },
      });
    return h('div', { class: 'filter-row', role: 'group', 'aria-label': '依頼元で絞り込む' }, chip(null, '全体'), data.clients.map((c) => chip(c.id, c.name)));
  }

  function noClients(container) {
    container.append(
      h(
        'section',
        { class: 'card welcome' },
        h('h2', { class: 'card-title', text: '副業の記録をはじめる' }),
        h('p', { text: 'まず依頼元(最大 5 件)を登録します。基本額・作業項目・曜日パターンを入れておくと、記録や予定を作るときに使えます。' }),
        h('div', { class: 'button-row' }, btn('依頼元を登録', { variant: 'primary', icon: 'plus', onClick: () => F.openClientSheet(null) })),
        h('p', { class: 'hint', text: '旧・副業管理アプリのデータは、設定から読み込めます。' })
      )
    );
  }

  // ---------------------------------------------------------------
  // 月の一覧
  // ---------------------------------------------------------------

  function renderRecords(container) {
    const data = sj();
    if (state.shot) return renderShot(container, data);
    head(container, 'sidejob');
    if (!data.clients.length && !data.records.length) return noClients(container);

    const sum = S.monthSummary(data, state.month, state.client);
    const all = S.monthSummary(data, state.month, null);
    const rows = S.monthRecords(data, state.month, state.client);
    container.append(
      h('div', { class: 'list-tools' }, monthSwitcher(), clientFilter(data)),
      h(
        'section',
        { class: 'card' },
        h(
          'div',
          { class: 'kv-list' },
          data.clients.map((c) =>
            h(
              'div',
              { class: `kv${state.client && state.client !== c.id ? ' is-dim' : ''}` },
              h('span', { class: 'kv-label', text: c.name }),
              h('span', { class: 'kv-value', text: U.man(all.byClient.get(c.id) || 0) })
            )
          ),
          h('div', { class: 'kv kv-total' }, h('span', { class: 'kv-label', text: state.client ? `${S.clientName(data, state.client)}の合計` : '総合計' }), h('span', { class: 'kv-value', text: U.man(sum.total) }))
        ),
        h('p', { class: 'hint', text: `入金確認済み ${U.man(sum.confirmed)}・未確認 ${U.man(sum.unconfirmed)}(${sum.count}件)` }),
        h(
          'div',
          { class: 'button-row' },
          btn('記録を追加', { icon: 'plus', variant: 'primary', onClick: () => F.openRecordSheet(null, { date: defaultDate(), clientId: state.client }) }),
          btn('スクショモード', { icon: 'camera', onClick: enterShot }),
          state.client && sum.unconfirmed
            ? btn('今月の入金を全て確認済みにする', {
                size: 'small',
                onClick: () => {
                  let n = 0;
                  if (store.update((d) => (n = S.confirmMonth(d.sidejob, state.month, state.client)))) toast(`${n}件を確認済みにしました`);
                },
              })
            : null
        )
      ),
      h(
        'section',
        { class: 'card card-flush' },
        h(
          'ul',
          { class: 'pay-list job-list' },
          rows.length ? rows.map((r) => recordRow(data, r)) : h('li', { class: 'pay-empty', text: `${U.ymLabel(state.month)}の記録はありません。` })
        )
      )
    );
  }

  /** 新しい記録の日付:表示中の月が今月なら今日、ほかの月なら 1 日 */
  function defaultDate() {
    return state.month === U.currentYM() ? U.todayStr() : `${state.month}-01`;
  }

  function recordRow(data, r) {
    const total = S.recordTotal(r);
    return h(
      'li',
      { class: `pay-row job-row${r.confirmed ? ' is-confirmed' : ''}` },
      h(
        'button',
        {
          type: 'button',
          class: `round-check${r.confirmed ? ' is-on' : ''}`,
          role: 'checkbox',
          'aria-checked': String(r.confirmed),
          'aria-label': `${U.dayLabel(r.date)} の入金を確認済みにする`,
          onClick: () => store.update((d) => S.toggleConfirmed(d.sidejob, r.id)),
        },
        icon('check')
      ),
      h(
        'button',
        { type: 'button', class: 'pay-main', onClick: () => F.openRecordSheet(r.id) },
        h('span', { class: 'pay-name' }, U.dayLabel(r.date), state.client ? null : h('span', { class: 'chip chip-soft job-client', text: S.clientName(data, r.clientId) })),
        h('span', { class: 'pay-meta' }, h('span', { class: 'job-content', text: r.content || '(内容なし)' }), r.memo ? h('span', { text: `メモ:${r.memo}` }) : null),
        h('span', { class: 'pay-amount', text: U.man(total) })
      ),
      h('button', { type: 'button', class: 'icon-btn trash-btn', 'aria-label': `${U.dayLabel(r.date)} の記録を削除`, onClick: () => F.deleteRecordConfirm(r) }, icon('trash'))
    );
  }

  // ---- スクショモード ----

  function enterShot() {
    state.shot = true;
    root.document.documentElement.classList.add('is-shot');
    MT.app.rerender();
    root.scrollTo(0, 0);
  }

  function exitShot() {
    state.shot = false;
    root.document.documentElement.classList.remove('is-shot');
    MT.app.rerender();
  }

  /** 「YYYY年M月 稼働報告」・依頼元名・合計・日付/金額/内容の一覧だけを出す */
  function renderShot(container, data) {
    const { y, m } = U.splitYM(state.month);
    const rows = S.monthRecords(data, state.month, state.client);
    const sum = S.monthSummary(data, state.month, state.client);
    container.append(
      h(
        'section',
        { class: 'shot' },
        h('h1', { class: 'shot-title', text: `${y}年${m}月 稼働報告` }),
        h('p', { class: 'shot-client', text: state.client ? S.clientName(data, state.client) : data.clients.map((c) => c.name).join('・') || '全体' }),
        h('p', { class: 'shot-total' }, '合計 ', h('strong', { text: U.man(sum.total) }), h('span', { class: 'shot-yen', text: `(${U.yen(sum.total)}円・${rows.length}日)` })),
        h(
          'table',
          { class: 'shot-table' },
          h('tbody', null, rows.map((r) => h('tr', null, h('td', { class: 'shot-date', text: U.dayLabel(r.date) }), h('td', { class: 'shot-amount', text: U.man(S.recordTotal(r)) }), h('td', { class: 'shot-content', text: r.content || '' }))))
        ),
        !rows.length ? h('p', { class: 'hint', text: '記録はありません。' }) : null,
        h('div', { class: 'shot-exit' }, btn('モード終了', { onClick: exitShot }))
      )
    );
  }

  function unmountRecords(opts) {
    if (state.shot && opts && opts.leaving) {
      state.shot = false;
      root.document.documentElement.classList.remove('is-shot');
    }
  }

  // ---------------------------------------------------------------
  // 予定と予想額
  // ---------------------------------------------------------------

  function forecastCard(data, ym, labelText) {
    const f = S.forecast(data, ym, state.client, U.todayStr());
    return h(
      'div',
      { class: 'stat forecast' },
      h('span', { class: 'stat-label', text: `${labelText}(${U.ymLabel(ym)})` }),
      h('span', { class: 'stat-value' }, U.man(f.total, false), h('small', { text: '万' })),
      h('span', { class: 'fc-line', text: `確認済み ${U.man(f.confirmed)}` }),
      h('span', { class: 'fc-line is-planned', text: `予定 ${U.man(f.scheduled)}(未確認 ${U.man(f.unconfirmed)}・予定日 ${f.plannedDays}日)` })
    );
  }

  // ---- 予定のカレンダー ----

  /** 月のカレンダーの枠(曜日の見出しと、1 日の前の空き) */
  function calendarFrame(ym, cells, label) {
    const first = U.weekday(`${ym}-01`);
    const blanks = Array.from({ length: first }, () => h('span', { class: 'cal-cell is-blank', 'aria-hidden': 'true' }));
    return h('div', { class: 'cal-grid', role: 'group', 'aria-label': label }, U.WEEKDAYS.map((w) => h('span', { class: 'cal-wd', text: w })), blanks, cells);
  }

  /** 依頼元を 1 つに絞り込んだときのカレンダー(予定 ↔ 休む、予定のない日は追加で出る日を入れる) */
  function clientCalendar(data) {
    const cid = state.client;
    const client = S.findClient(data, cid);
    const ym = state.month;
    const recorded = new Set(data.records.filter((r) => r.clientId === cid && r.date.startsWith(ym)).map((r) => r.date));
    const n = U.daysInMonth(ym);
    const today = U.todayStr();
    const cells = [];
    for (let d = 1; d <= n; d++) {
      const date = `${ym}-${String(d).padStart(2, '0')}`;
      const st = S.dayState(data, ym, client, date);
      const done = recorded.has(date);
      const plan = st === 'off' ? null : S.dayPlan(data, cid, date);
      const stateLabel = { planned: '予定', off: '休む', extra: '追加で出る', none: '予定なし' }[st];
      cells.push(
        h(
          'button',
          {
            type: 'button',
            class: `cal-cell is-${st}${done ? ' is-done' : ''}${date === today ? ' is-today' : ''}`,
            'aria-label': `${U.dayLabel(date)} ${stateLabel}${plan ? `・見込み ${U.man(S.recordTotal(plan))}` : ''}${done ? '・記録あり' : ''}`,
            // 予定の日 ↔ 休む。予定のない日・追加の日は、依頼元と金額を選ぶ画面を開く
            onClick: () => (st === 'none' || st === 'extra' ? F.openExtraDaySheet(date, cid) : store.update((dd) => S.toggleDay(dd.sidejob, ym, cid, date))),
          },
          h('span', { class: 'cal-day', text: String(d) }),
          plan ? h('span', { class: 'cal-amt', text: U.man(S.recordTotal(plan)) }) : null,
          done ? h('span', { class: 'cal-mark', text: '●' }) : null
        )
      );
    }
    const planned = S.plannedDates(data, ym, client);
    return h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card-title', text: `${client.name}の予定` }),
        h('div', { class: 'cal-switch' }, monthSwitcher()),
        h('p', { class: 'hint', text: `曜日パターン:${client.weekdays.length ? client.weekdays.map((w) => U.WEEKDAYS[w]).join('・') : '未設定'}・予定 ${planned.length}日` }),
        calendarFrame(ym, cells, `${U.ymLabel(ym)}の予定`),
        h(
          'p',
          { class: 'cal-legend' },
          h('span', { class: 'lg lg-planned', text: '予定' }),
          h('span', { class: 'lg lg-off', text: '休む' }),
          h('span', { class: 'lg lg-extra', text: '追加で出る' }),
          h('span', { text: '● 記録あり' })
        ),
        h('p', { class: 'hint', text: '予定の日をタップすると「休む」になります。予定のない日をタップすると、依頼元と基本額・作業項目を選んで「追加で出る」日にできます(もう一度タップで直す・やめる)。' })
      );
  }

  const STATE_LABEL = { planned: '予定', off: '休む', extra: '追加で出る', none: '予定なし' };

  /** 「全体」のときのカレンダー:全部の依頼元の予定・休む日・追加で出る日を、依頼元ごとの色で出す */
  function allCalendar(data) {
    const ym = state.month;
    const today = U.todayStr();
    const clients = data.clients;
    const recorded = new Set(data.records.filter((r) => r.date.startsWith(ym)).map((r) => r.date));
    const cells = [];
    for (let d = 1; d <= U.daysInMonth(ym); d++) {
      const date = `${ym}-${String(d).padStart(2, '0')}`;
      const marks = clients
        .map((c, i) => ({ c, i, st: S.dayState(data, ym, c, date), plan: S.dayPlan(data, c.id, date) }))
        .filter((x) => x.st !== 'none');
      const done = recorded.has(date);
      const label = marks.length
        ? marks.map((x) => `${x.c.name}:${STATE_LABEL[x.st]}${x.plan && x.st !== 'off' ? `(見込み ${U.man(S.recordTotal(x.plan))})` : ''}`).join('、')
        : '予定なし';
      cells.push(
        h(
          'button',
          {
            type: 'button',
            class: `cal-cell is-multi${marks.some((x) => x.st !== 'off') ? ' has-plan' : ''}${date === today ? ' is-today' : ''}`,
            'aria-label': `${U.dayLabel(date)} ${label}${done ? '・記録あり' : ''}`,
            onClick: () => dayMenu(data, date),
          },
          h('span', { class: 'cal-day', text: String(d) }),
          h('span', { class: 'cal-dots', 'aria-hidden': 'true' }, marks.map((x) => h('span', { class: `cal-dot cli-${x.i + 1} is-${x.st}` }))),
          done ? h('span', { class: 'cal-mark', text: '●' }) : null
        )
      );
    }
    const counts = clients.map((c) => `${c.name} ${S.plannedDates(data, ym, c).length}日`).join('・');
    return h(
      'section',
      { class: 'card' },
      h('h2', { class: 'card-title', text: '全体の予定' }),
      h('div', { class: 'cal-switch' }, monthSwitcher()),
      h('p', { class: 'hint', text: `予定:${counts}` }),
      calendarFrame(ym, cells, `${U.ymLabel(ym)}の全体の予定`),
      h(
        'p',
        { class: 'cal-legend' },
        clients.map((c, i) => h('span', { class: `lg-cli cli-${i + 1}`, text: c.name })),
        h('span', { class: 'lg-shape', text: '● 予定 ■ 追加で出る ○ 休む' }),
        h('span', { text: '右上の ● 記録あり' })
      ),
      h('p', { class: 'hint', text: '日をタップすると、依頼元ごとに「休む」「予定に戻す」「追加で出る日を入れる・直す」を選べます。' })
    );
  }

  /** 「全体」のカレンダーで日をタップしたとき:依頼元ごとの操作を選ぶ */
  function dayMenu(data, date) {
    const ym = state.month;
    const actions = [];
    for (const c of data.clients) {
      const st = S.dayState(data, ym, c, date);
      const toggle = () => store.update((dd) => S.toggleDay(dd.sidejob, ym, c.id, date));
      if (st === 'planned') {
        actions.push({ label: `${c.name}:休む日にする`, onSelect: toggle });
        actions.push({ label: `${c.name}:この日の見込みを直す`, onSelect: () => F.openExtraDaySheet(date, c.id) });
      } else if (st === 'off') actions.push({ label: `${c.name}:予定に戻す`, onSelect: toggle });
      else if (st === 'extra') actions.push({ label: `${c.name}:追加で出る日を直す・やめる`, onSelect: () => F.openExtraDaySheet(date, c.id) });
    }
    const free = data.clients.find((c) => S.dayState(data, ym, c, date) === 'none') || data.clients[0];
    actions.push({ label: '追加で出る日を入れる(依頼元を選ぶ)', onSelect: () => F.openExtraDaySheet(date, free.id) });
    actionSheet({ title: U.dayLabel(date), description: '依頼元ごとの予定を変えます。', actions });
  }

  function renderPlan(container) {
    const data = sj();
    head(container, 'sidejob/plan');
    if (!data.clients.length) return noClients(container);
    const cur = U.currentYM();
    container.append(
      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card-title', text: '予想額' }),
        h('div', { class: 'cal-switch' }, clientFilter(data)),
        h('div', { class: 'stat-grid' }, forecastCard(data, cur, '今月'), forecastCard(data, U.ymAdd(cur, 1), '来月')),
        h('p', { class: 'hint', text: '予定 = 入金がまだ確認できていない記録 + 今日以降の予定日(基本額 + 既定の作業項目)+ 追加で出る日(選んだ基本額と作業項目。今日より前の日も、記録を作るまでは数えます)。予定は薄い色で表示しています。' })
      )
    );

    // カレンダー:「全体」のときは全部の依頼元を色分けして 1 つに、絞り込んだときはその依頼元だけ
    container.append(
      state.client ? clientCalendar(data) : allCalendar(data),
      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card-title', text: '支払い管理への連携' }),
        h('p', { class: 'hint', text: '依頼元ごとに対応させた入金予定へ、働いた月の予想額(確認済み + 予定)が自動で入ります(翌月払いなら、前の月に働いた分)。入金済みにした入金は変えません。対応と入金のタイミングは「依頼元」で設定します。' }),
        h('div', { class: 'button-row' }, btn('入る額を見る', { icon: 'sync', onClick: F.openPaymentLinkSheet }))
      )
    );
  }

  // ---------------------------------------------------------------
  // 推移
  // ---------------------------------------------------------------

  function renderTrend(container) {
    const data = sj();
    head(container, 'sidejob/trend');
    if (!data.clients.length && !data.records.length) return noClients(container);
    const cur = U.currentYM();
    const months = Array.from({ length: 6 }, (_, i) => U.ymAdd(cur, i - 5));
    const t = S.trend(data, months);
    const canvas = h('canvas', { role: 'img', 'aria-label': '直近 6 か月の月別収入(依頼元別の積み上げ棒グラフ)。数値は下の一覧を参照。' });
    const fallback = h('p', { class: 'chart-fallback', hidden: true, text: 'グラフを読み込めませんでした。インターネットに接続して、もう一度開いてください。' });
    container.append(
      h('section', { class: 'card chart-card' }, h('div', { class: 'card-head' }, h('h2', { class: 'card-title', text: '直近 6 か月の収入' })), h('div', { class: 'chart-box' }, canvas, fallback)),
      h(
        'section',
        { class: 'card card-flush' },
        h(
          'ul',
          { class: 'hist-list' },
          [...months].reverse().map((ym) => {
            const i = months.indexOf(ym);
            const total = t.series.reduce((s, x) => s + x.values[i], 0);
            return h(
              'li',
              { class: 'hist-row sum-row' },
              h('span', { class: 'hist-month' }, U.ymLabel(ym), h('small', { text: `  合計 ${U.man(total)}` })),
              h('span', { class: 'hist-nums' }, t.series.map((x) => h('span', null, h('small', { text: x.label }), U.man(x.values[i]))))
            );
          })
        )
      )
    );
    C.mount('sidejob-trend', canvas, fallback, (c) => {
      const series = C.foldSeries(t.series, months.length);
      return {
        type: 'bar',
        data: { labels: C.monthLabels(months), datasets: series.map((s, i) => ({ label: s.label, data: s.values, ...C.barStyle(c, s.isOther ? c.other : c.series[i], { stacked: true }) })) },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: C.legend(c, { show: series.length > 1 }),
            tooltip: C.tooltip(
              c,
              {
                title: (items) => (items.length ? U.ymLabel(months[items[0].dataIndex]) : ''),
                label: (it) => ` ${it.dataset.label}: ${U.man(it.raw)}`,
                footer: (items) => (items.length ? `合計: ${U.man(items.reduce((s, it) => s + it.raw, 0))}` : ''),
              },
              { itemSort: (a, b) => b.datasetIndex - a.datasetIndex, filter: (it) => it.raw !== 0 }
            ),
          },
          scales: { ...C.scales(c, { stacked: true }), y: { ...C.scales(c, { stacked: true }).y, ticks: { ...C.scales(c).y.ticks, callback: (v) => U.man(v) } } },
        },
      };
    });
  }

  // ---------------------------------------------------------------
  // 依頼元
  // ---------------------------------------------------------------

  function renderClients(container) {
    const d = store.get();
    const data = d.sidejob;
    head(container, 'sidejob/clients');
    container.append(
      h(
        'section',
        { class: 'card card-flush' },
        h(
          'div',
          { class: 'card-head' },
          h('h2', { class: 'card-title', text: `依頼元(${data.clients.length}/${S.MAX_CLIENTS})` }),
          data.clients.length < S.MAX_CLIENTS ? btn('追加', { icon: 'plus', variant: 'primary', size: 'small', onClick: () => F.openClientSheet(null) }) : null
        ),
        h(
          'ul',
          { class: 'pay-list' },
          data.clients.length
            ? data.clients.map((c) => {
                const inc = c.payment.incomeId && d.payments ? d.payments.incomes.find((i) => i.id === c.payment.incomeId) : null;
                return h(
                  'li',
                  { class: 'pay-row no-check' },
                  h(
                    'button',
                    { type: 'button', class: 'pay-main', onClick: () => F.openClientSheet(c.id) },
                    h('span', { class: 'pay-name', text: c.name }),
                    h(
                      'span',
                      { class: 'pay-meta' },
                      h('span', { text: `作業項目 ${c.tasks.length}件` }),
                      h('span', { text: c.weekdays.length ? c.weekdays.map((w) => U.WEEKDAYS[w]).join('・') : '曜日未設定' }),
                      h('span', { text: inc ? `入金予定「${inc.name}」(${c.payment.timing === 'same' ? '当月' : '翌月'}${c.payment.day ? `${c.payment.day}日` : ''})` : '支払い管理と連携なし' })
                    ),
                    h('span', { class: 'pay-amount' }, U.man(c.baseAmount), h('small', { text: `1日の見込み ${U.man(S.dailyExpected(c))}` }))
                  )
                );
              })
            : h('li', { class: 'pay-empty', text: 'まだありません。「追加」から登録してください(最大 5 件)。' })
        )
      )
    );
  }

  // 支払い管理への自動の反映:起動時・画面に戻ったとき・データが変わったときに、対応する入金予定を予想額にそろえる
  MT.maintenance = MT.maintenance || [];
  MT.maintenance.push(() => {
    const d = store.get();
    const today = U.todayStr();
    if (!S.needsPaymentSync(d, today)) return null;
    store.update((dd) => S.syncPayments(dd, today));
    return null;
  });

  MT.views = MT.views || {};
  MT.views.sidejob = { render: renderRecords, unmount: unmountRecords };
  MT.views['sidejob/plan'] = { render: renderPlan, tab: 'sidejob' };
  MT.views['sidejob/trend'] = { render: renderTrend, tab: 'sidejob', unmount: () => C.destroy('sidejob-trend') };
  MT.views['sidejob/clients'] = { render: renderClients, tab: 'sidejob' };
})(window);
