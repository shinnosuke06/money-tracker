/*
 * 将来予想(ライフプラン)の画面
 *   #/future           予想:要約(パターン別)・グラフ・年ごとの表・取り崩し案
 *   #/future/plan      条件:基本・今の資産・収入・支出・利回りなど(プランごと)
 *   #/future/compare   比較:2 つのプランの総資産の推移
 *   #/future/check     計算の確認:架空のデータで、手計算と一致するか
 * どの画面にも「仮定にもとづく予想で、将来を保証するものではありません」を小さく出す。
 */
(function (root) {
  'use strict';
  const MT = root.MT;
  const U = MT.util;
  const F = MT.futureModel;
  const UI = MT.futureUI;
  const CH = MT.futureCharts;
  const store = MT.store;
  const { h, add, icon, btn, openSheet } = MT.ui;

  const SUBNAV = [
    { path: 'future', label: '予想' },
    { path: 'future/plan', label: '条件' },
    { path: 'future/compare', label: '比較' },
    { path: 'future/check', label: '計算の確認' },
  ];
  const DISCLAIMER = '仮定にもとづく予想で、将来を保証するものではありません';

  // 描き直しても保つ表示の状態(データには入れない)
  const state = { pattern: 'mid', chart: 'total', drawYear: null, cmpPattern: 'mid' };

  const MINUS = '−';
  const yen = (v) => `${U.yen(v)}円`;
  /** 万円(整数・3 桁区切り) */
  const man = (v) => `${v < 0 ? MINUS : ''}${Math.round(Math.abs(v) / 10000).toLocaleString('ja-JP')}`;
  const manYen = (v) => `${man(v)}万円`;
  const signedMan = (v) => (v > 0 ? `+${man(v)}` : man(v));
  const tone = (v) => (v < 0 ? 'is-neg' : v > 0 ? 'is-pos' : '');
  const patLabel = (plan, id) => `${F.label(F.PATTERNS, id)}(年${plan.returns[id]}%)`;
  const ymAge = (plan, ym) => {
    const a = F.ageAt(plan, ym);
    return `${U.ymLabel(ym)}${a != null ? `(${a}歳)` : ''}`;
  };
  /** 表の中の年月(年齢は 2 行目に小さく) */
  const ymAgeCell = (plan, ym, cls) => {
    const a = F.ageAt(plan, ym);
    const { y, m } = U.splitYM(ym);
    return h('span', { class: `fx-ym ${cls}` }, h('span', { text: `${y}年` }), h('small', { text: `${m}月${a != null ? ` ${a}歳` : ''}` }));
  };
  /** 「期間内は大丈夫」(狭い列でも言葉の途中で折り返さない) */
  const okCell = () => h('span', { class: 'is-pos fx-strong fx-ok' }, h('span', { text: '期間内は' }), h('span', { text: '大丈夫' }));

  // ---------------------------------------------------------------
  // 共通
  // ---------------------------------------------------------------

  function head(container, active) {
    container.append(
      h(
        'header',
        { class: 'page-head' },
        h('a', { class: 'back-link', href: '#/more' }, icon('back'), h('span', { text: 'その他' })),
        h('h1', { class: 'page-title page-title-sub', text: '将来予想' })
      ),
      h(
        'nav',
        { class: 'subnav', 'aria-label': '将来予想のメニュー' },
        SUBNAV.map((s) => h('a', { class: 'subnav-item', href: `#/${s.path}`, 'aria-current': s.path === active ? 'page' : null, text: s.label }))
      ),
      h('p', { class: 'fx-disclaimer', role: 'note' }, icon('info', 'fx-disclaimer-icon'), DISCLAIMER)
    );
  }

  function welcome() {
    return h(
      'section',
      { class: 'card welcome' },
      h('h2', { class: 'card-title', text: 'ライフプランをはじめる' }),
      h('p', { text: '今の資産と、収入・生活費・ローン・積立・大きな出費などの条件から、毎月の現金と投資の残高を計算し、年ごとの表とグラフで将来を見通します。利回りは「低め / 普通 / 高め」の 3 パターンを同時に計算します。' }),
      h('p', { class: 'hint', text: '最新の記録(月末記録・支払い管理・資産管理・ポケカ在庫・副業)から初期値を入れます。どれも手で直せます。' }),
      h('div', { class: 'button-row' }, btn('最新の記録からプランを作る', { variant: 'primary', icon: 'plus', onClick: UI.createPlanFlow }))
    );
  }

  function planBar(f, plan) {
    const sel = MT.forms.selectEl(
      f.plans.map((p) => ({ value: p.id, label: p.name })),
      plan.id,
      { class: 'field-select', 'aria-label': '表示するプラン' }
    );
    sel.addEventListener('change', () => store.update((d) => (d.future.activeId = sel.value)));
    return h(
      'div',
      { class: 'fx-planbar' },
      h('span', { class: 'fx-planbar-label', text: 'プラン' }),
      sel,
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'プランの操作(名前の変更・複製・削除)', onClick: () => UI.planMenu(plan.id) }, icon('more'))
    );
  }

  function warnNotice(lines) {
    return h(
      'section',
      { class: 'notice notice-warn', role: 'status' },
      icon('alert', 'notice-icon'),
      h('div', { class: 'notice-main' }, h('p', { class: 'notice-title', text: '条件を確かめてください' }), lines.map((t) => h('p', { class: 'notice-text', text: t })))
    );
  }

  function seg(options, value, label, onPick) {
    return h(
      'div',
      { class: 'seg seg-wide', role: 'group', 'aria-label': label },
      options.map((o) =>
        h('button', {
          type: 'button',
          'aria-pressed': String(o.value === value),
          text: o.label,
          onClick: () => onPick(o.value),
        })
      )
    );
  }

  // ---------------------------------------------------------------
  // 予想
  // ---------------------------------------------------------------

  function renderForecast(container) {
    const d = store.get();
    const f = d.future;
    head(container, 'future');
    if (!f.plans.length) return container.append(welcome());
    const plan = F.activePlan(f);
    const all = F.simulateAll(plan);
    const res = all[state.pattern];
    container.append(planBar(f, plan));
    const warns = F.warnings(plan);
    if (warns.length) container.append(warnNotice(warns));
    container.append(summaryCard(plan, all));

    // グラフ
    const canvas = h('canvas', { role: 'img', 'aria-label': state.chart === 'total' ? '総資産の推移(3 パターン)のグラフ。数値は下の年ごとの表を参照。' : '現金と投資の内訳のグラフ。数値は下の年ごとの表を参照。' });
    const fallback = h('p', { class: 'chart-fallback', hidden: true, text: 'グラフを読み込めませんでした。インターネットに接続して、もう一度開いてください。数値は下の表で見られます。' });
    const anyShort = F.PATTERNS.some((p) => all[p.id].summary.firstShortYM);
    container.append(
      h(
        'section',
        { class: 'card chart-card' },
        h('div', { class: 'card-head' }, h('h2', { class: 'card-title', text: state.chart === 'total' ? '総資産の推移' : `現金と投資(${patLabel(plan, state.pattern)})` })),
        seg(
          [
            { value: 'total', label: '総資産(3パターン)' },
            { value: 'stack', label: '現金と投資' },
          ],
          state.chart,
          'グラフの種類',
          (v) => {
            state.chart = v;
            MT.app.rerender();
          }
        ),
        h('div', { class: 'chart-box' }, canvas, fallback),
        state.chart === 'total' && anyShort ? h('p', { class: 'hint fx-mark-note' }, h('span', { class: 'fx-tri', 'aria-hidden': 'true' }), '資金が足りなくなる年(現金がマイナスになる最初の年)') : null,
        state.chart === 'stack' ? h('p', { class: 'hint', text: '年末の残高。パターンは下の「表のパターン」で切り替えます。' }) : null
      ),
      patternBar(plan),
      tableCard(plan, res),
      drawdownCard(plan, res)
    );
    if (state.chart === 'total') CH.totals('future-main', canvas, fallback, all);
    else CH.stack('future-main', canvas, fallback, res);
  }

  function summaryCard(plan, all) {
    const cell = (node) => h('td', null, node);
    const shortCell = (r) => {
      const ym = r.summary.firstShortYM;
      return ym ? ymAgeCell(plan, ym, 'is-neg fx-strong') : okCell();
    };
    const belowCell = (r) => {
      const ym = r.summary.firstBelowYM;
      return ym ? ymAgeCell(plan, ym, 'is-warn-num fx-strong') : h('span', { text: '割らない' });
    };
    return h(
      'section',
      { class: 'card' },
      h('h2', { class: 'card-title', text: '要約(利回りのパターン別)' }),
      h(
        'div',
        { class: 'fx-sum-wrap' },
        h(
          'table',
          { class: 'fx-sum' },
          h('thead', null, h('tr', null, h('th', { scope: 'col', text: '' }), F.PATTERNS.map((p) => h('th', { scope: 'col' }, p.label, h('small', { text: `年${plan.returns[p.id]}%` }))))),
          h(
            'tbody',
            null,
            h('tr', null, h('th', { scope: 'row', text: '資金が足りなくなる年' }), F.PATTERNS.map((p) => cell(shortCell(all[p.id])))),
            h(
              'tr',
              null,
              h('th', { scope: 'row' }, '期間の終わりの総資産', h('small', { text: '万円' })),
              F.PATTERNS.map((p) => cell(h('span', { class: `fx-num fx-strong ${all[p.id].summary.endTotal < 0 ? 'is-neg' : ''}`.trim(), text: man(all[p.id].summary.endTotal) })))
            ),
            h('tr', null, h('th', { scope: 'row', text: '生活防衛資金を割る最初の年' }), F.PATTERNS.map((p) => cell(belowCell(all[p.id])))),
            h('tr', null, h('th', { scope: 'row' }, '取り崩しの合計(手取り)', h('small', { text: '万円' })), F.PATTERNS.map((p) => cell(h('span', { class: 'fx-num', text: man(all[p.id].summary.drawNet) }))))
          )
        )
      ),
      h(
        'p',
        { class: 'hint' },
        `期間:${U.ymLabel(plan.startYM)}〜${U.ymLabel(F.endYM(plan))}(${plan.years}年)・インフレ率 年${plan.inflation}%・生活防衛資金 ${yen(F.reserveNow(plan))}${plan.reserve.amount === null ? `(生活費の${plan.reserve.months}か月分)` : ''}。利回りは仮の値で、「条件」で直せます。`
      )
    );
  }

  function patternBar(plan) {
    return h(
      'section',
      { class: 'card fx-pattern' },
      h('p', { class: 'fx-pattern-label', text: '表のパターン(利回り)' }),
      seg(
        F.PATTERNS.map((p) => ({ value: p.id, label: `${p.label} ${plan.returns[p.id]}%` })),
        state.pattern,
        '表と取り崩し案のパターン',
        (v) => {
          state.pattern = v;
          MT.app.rerender();
        }
      )
    );
  }

  function tableCard(plan, res) {
    const head1 = ['年', '年齢', '収入', '支出', '単発の出費', '収支', '現金残高', '投資残高', '総資産', '取り崩し額'];
    const rows = res.years.map((y) => {
      const partial = y.count < 12 ? `${Number(y.fromYM.slice(5))}〜${Number(y.toYM.slice(5))}月` : '';
      const cls = y.shortYM ? 'is-short' : y.belowYM ? 'is-below' : '';
      const tr = h(
        'tr',
        { class: cls || null },
        h(
          'th',
          { scope: 'row' },
          h('button', { type: 'button', class: 'fx-year-btn', 'aria-label': `${y.year}年の内訳と取り崩し案`, onClick: () => openYearSheet(plan, res, y) }, `${y.year}`, partial ? h('small', { text: partial }) : null),
          y.belowYM && !y.shortYM ? h('span', { class: 'fx-dot', title: '生活防衛資金を割る年', 'aria-label': '生活防衛資金を割る年' }) : null
        ),
        h('td', { text: y.age != null ? `${y.age}` : '—' }),
        h('td', { text: man(y.income) }),
        h('td', { text: man(y.expense) }),
        h('td', { text: y.oneTime ? man(y.oneTime) : '—' }),
        h('td', { class: tone(y.flow) || null, text: signedMan(y.flow) }),
        h('td', { class: y.cash < 0 ? 'is-neg' : null, text: man(y.cash) }),
        h('td', { text: man(y.invest) }),
        h('td', { class: `fx-strong${y.total < 0 ? ' is-neg' : ''}`, text: man(y.total) }),
        h('td', { text: y.drawNet ? man(y.drawNet) : '—' })
      );
      tr.addEventListener('click', (e) => {
        if (!e.target.closest('button')) openYearSheet(plan, res, y);
      });
      return tr;
    });
    return h(
      'section',
      { class: 'card card-flush' },
      h('div', { class: 'card-head' }, h('h2', { class: 'card-title', text: `年ごとの表(${patLabel(plan, state.pattern)})` }), h('span', { class: 'hint', text: '単位:万円' })),
      h(
        'p',
        { class: 'card-text hint fx-legend' },
        h('span', { class: 'fx-legend-short', text: '赤い行' }),
        ' 資金不足(現金がマイナス)の年 ',
        h('span', { class: 'fx-dot', 'aria-hidden': 'true' }),
        ' 生活防衛資金を割る年。支出 = 生活費 + ローン + 積立 + 毎年の費用。取り崩し額は手取り。行をタップすると内訳と取り崩し案。表は横にスクロールできます。'
      ),
      h('div', { class: 'fx-table-wrap', tabindex: '0', role: 'region', 'aria-label': '年ごとの表(横にスクロール)' }, h('table', { class: 'fx-table' }, h('thead', null, h('tr', null, head1.map((t) => h('th', { scope: 'col', text: t })))), h('tbody', null, rows)))
    );
  }

  function salesList(sales) {
    return h(
      'ol',
      { class: 'fx-draw-list' },
      sales.map((s) =>
        h(
          'li',
          null,
          h('span', { class: 'fx-draw-name' }, s.name, h('span', { class: `chip fx-pri-${s.priority}`, text: F.label(F.PRIORITIES, s.priority) }), h('small', { text: F.label(F.TAX_KINDS, s.taxKind) })),
          h('span', { class: 'fx-draw-nums' }, h('span', { text: `売る ${yen(s.gross)}` }), s.tax ? h('small', { text: `税 ${yen(s.tax)}` }) : null, h('small', { text: `手取り ${yen(s.net)}` }))
        )
      )
    );
  }

  function drawdownCard(plan, res) {
    const years = res.years.filter((y) => y.drawGross > 0);
    const card = h('section', { class: 'card' }, h('h2', { class: 'card-title', text: `取り崩し案(${patLabel(plan, state.pattern)})` }));
    if (!years.length) {
      card.append(h('p', { class: 'hint', text: 'この条件・このパターンでは、期間中に取り崩しはありません(現金が生活防衛資金を下回りません)。' }));
      return card;
    }
    const year = years.some((y) => y.year === state.drawYear) ? state.drawYear : years[0].year;
    const sel = MT.forms.selectEl(
      years.map((y) => ({ value: String(y.year), label: `${y.year}年${y.age != null ? `(${y.age}歳)` : ''}・手取り ${manYen(y.drawNet)}` })),
      String(year),
      { class: 'field-select', 'aria-label': '取り崩し案の年' }
    );
    sel.addEventListener('change', () => {
      state.drawYear = Number(sel.value);
      MT.app.rerender();
    });
    const dp = F.drawdownPlan(res, year);
    add(
      card,
      MT.forms.field('年', sel),
      salesList(dp.sales),
      h('div', { class: 'fx-draw-total' }, h('span', { text: '合計' }), h('span', { text: `売る ${yen(dp.gross)}・税 ${yen(dp.tax)}・手取り ${yen(dp.net)}` })),
      h('p', { class: 'hint', text: '提案です。実際の売却は記録しません。売る順:「最初に売る」→「足りなければ売る」(同じ優先度は「条件」の一覧の順)。「売りたくない」は使いません。課税口座は含み益の割合に税率を掛けた分を引いた手取りで計算しています。' })
    );
    return card;
  }

  function openYearSheet(plan, res, y) {
    const partial = y.count < 12 ? `(${Number(y.fromYM.slice(5))}〜${Number(y.toYM.slice(5))}月)` : '';
    const s = openSheet({ title: `${y.year}年${partial}${y.age != null ? ` ${y.age}歳` : ''}`, description: patLabel(plan, state.pattern), className: 'sheet-form' });
    const row = (label, value, cls = '') => [h('dt', { text: label }), h('dd', { class: cls || null, text: value })];
    const out = (v) => (v > 0 ? `${MINUS}${yen(v)}` : '0円');
    add(
      s.body,
      y.shortYM ? h('p', { class: 'field-error', text: `資金不足:${U.ymLabel(y.shortYM)}に現金がマイナスになります(取り崩しても足りません)。` }) : null,
      y.belowYM && !y.shortYM ? h('p', { class: 'fx-warn-line', text: `${U.ymLabel(y.belowYM)}に生活防衛資金を割ります(取り崩せる資産が足りません)。` }) : null,
      h(
        'dl',
        { class: 'info-list' },
        row('収入', y.income > 0 ? `+${yen(y.income)}` : '0円', y.income > 0 ? 'is-pos' : ''),
        row('生活費', out(y.living)),
        row('ローン', out(y.loans)),
        row('積立(投資へ)', out(y.saving)),
        row('毎年の費用', out(y.yearly)),
        row('単発の出費', out(y.oneTime)),
        row('収支', `${U.yenSigned(y.flow)}円`, tone(y.flow)),
        row('取り崩し(手取り)', y.drawNet ? `+${yen(y.drawNet)}` : '0円'),
        row('年末の現金', yen(y.cash), y.cash < 0 ? 'is-neg' : ''),
        row('年末の投資', yen(y.invest)),
        row('年末の総資産', yen(y.total), y.total < 0 ? 'is-neg' : '')
      ),
      y.sales.length ? [h('h3', { class: 'form-section-title', text: 'この年の取り崩し案' }), salesList(y.sales), h('p', { class: 'hint', text: `合計:売る ${yen(y.drawGross)}・税 ${yen(y.drawTax)}・手取り ${yen(y.drawNet)}(提案だけで、売却は記録しません)` })] : null,
      h('p', { class: 'fx-disclaimer' }, DISCLAIMER)
    );
    s.foot.append(btn('閉じる', { onClick: () => s.close() }));
  }

  // ---------------------------------------------------------------
  // 条件
  // ---------------------------------------------------------------

  /** 一覧のカード(行をタップで直す。toggle のある行はオン/オフのスイッチつき) */
  function listCard({ plan, key, title, hint, describe, actions = [], toggle = false, empty }) {
    const rows = F.rowsOf(plan, key);
    const list = h(
      'ul',
      { class: 'pay-list fx-list' },
      rows.length
        ? rows.map((r) => {
            const x = describe(r);
            return h(
              'li',
              { class: `pay-row${toggle ? '' : ' no-check'}${toggle && !r.enabled ? ' is-off' : ''}` },
              toggle
                ? h(
                    'button',
                    {
                      type: 'button',
                      class: `fx-switch${r.enabled ? ' is-on' : ''}`,
                      role: 'switch',
                      'aria-checked': String(r.enabled),
                      'aria-label': `「${r.name}」を計算に入れる`,
                      onClick: () => UI.updatePlan(plan.id, (p) => F.toggleRow(p, key, r.id)),
                    },
                    h('span', { class: 'fx-switch-knob' })
                  )
                : null,
              h(
                'button',
                { type: 'button', class: 'pay-main', onClick: () => UI.openRowSheet(plan.id, key, r.id) },
                h('span', { class: 'pay-name' }, x.name, x.flag ? h('span', { class: 'badge-warn', text: x.flag }) : null),
                h('span', { class: 'pay-meta' }, x.sub ? h('span', { text: x.sub }) : null, toggle && !r.enabled ? h('span', { class: 'chip', text: 'オフ(計算に入れない)' }) : null),
                h('span', { class: `pay-amount${x.amountCls ? ` ${x.amountCls}` : ''}`, text: x.amount })
              )
            );
          })
        : h('li', { class: 'pay-empty', text: empty || 'まだありません。' })
    );
    return h(
      'section',
      { class: 'card card-flush' },
      h('div', { class: 'card-head' }, h('h2', { class: 'card-title', text: title }), btn('追加', { icon: 'plus', size: 'small', onClick: () => UI.openRowSheet(plan.id, key, null) })),
      hint ? h('p', { class: 'card-text hint', text: hint }) : null,
      list,
      actions.length ? h('div', { class: 'card-foot button-row' }, actions) : null
    );
  }

  function kvCard(title, rows, onEdit, extra = []) {
    return h(
      'section',
      { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', { class: 'card-title', text: title }), onEdit ? btn('直す', { icon: 'edit', size: 'small', variant: 'ghost', onClick: onEdit }) : null),
      h('div', { class: 'kv-list fx-kv' }, rows.map(([k, v, cls]) => h('div', { class: 'kv' }, h('span', { class: 'kv-label', text: k }), h('span', { class: `kv-value${cls ? ` ${cls}` : ''}`, text: v })))),
      extra
    );
  }

  const ageRange = (from, to) => (from === null && to === null ? '今から期間の終わりまで' : `${from === null ? '今' : `${from}歳`}〜${to === null ? '期間の終わり' : `${to}歳`}`);

  function renderPlan(container) {
    const d = store.get();
    const f = d.future;
    head(container, 'future/plan');
    if (!f.plans.length) return container.append(welcome());
    const plan = F.activePlan(f);
    const id = plan.id;
    const age = F.ageAt(plan, plan.startYM);
    container.append(planBar(f, plan));
    const warns = F.warnings(plan);
    if (warns.length) container.append(warnNotice(warns));

    // 1. 基本
    container.append(
      kvCard(
        '基本',
        [
          ['計算の開始(今の資産の時点)', U.ymLabel(plan.startYM)],
          ['生年月(今の年齢)', plan.birthYM ? `${U.ymLabel(plan.birthYM)}(${age}歳)` : '未入力', plan.birthYM ? '' : 'is-warn-num'],
          ['予想の期間', `${plan.years}年(${U.ymLabel(F.endYM(plan))}まで)`],
          ['インフレ率', `年${plan.inflation}%`],
        ],
        () => UI.openBaseSheet(id)
      )
    );

    // 2. 今の資産(B)
    container.append(assetsCard(plan));

    // 3〜4. 収入
    container.append(
      listCard({
        plan,
        key: 'incomes',
        title: '収入(手取りの月額)',
        hint: '働く期間・再雇用・年金などを、何歳から何歳まで月いくらで入れます。',
        describe: (r) => ({ name: r.name, sub: ageRange(r.fromAge, r.toAge), amount: `+${yen(r.monthly)}`, amountCls: 'is-in' }),
        empty: '収入がありません。「追加」から入れてください。',
      }),
      listCard({
        plan,
        key: 'extras',
        title: '臨時収入(ボーナス・退職金など)',
        describe: (r) => ({ name: r.name, sub: r.untilYear ? `${r.year}〜${r.untilYear}年の毎年${r.month}月` : `${r.year}年${r.month}月`, amount: `+${yen(r.amount)}`, amountCls: 'is-in' }),
      }),
      kvCard(
        '副業収入',
        [
          ['月いくら', `+${yen(plan.sidejob.monthly)}`, plan.sidejob.monthly ? 'is-pos' : ''],
          ['いつまで', UI.ymText(plan.sidejob.untilYM)],
        ],
        () => UI.openSidejobSheet(id),
        [h('div', { class: 'button-row' }, btn('副業の記録から計算し直す', { size: 'small', icon: 'sync', onClick: () => UI.recalcSidejob(id) }))]
      ),
      listCard({
        plan,
        key: 'repayments',
        title: '家族などからの返済',
        describe: (r) => ({ name: r.name, sub: `${UI.ymText(r.endYM, '終了年月が未定')}${r.endYM ? 'まで' : ''}`, amount: `+${yen(r.monthly)}`, amountCls: 'is-in', flag: r.endYM ? null : '終了年月を入れてください' }),
        actions: [btn('入金予定から選ぶ', { size: 'small', onClick: () => UI.pickRepaymentFlow(id) })],
      })
    );

    // 5. 生活費
    container.append(
      kvCard(
        '毎月の生活費(ローン・積立を除く)',
        [['今の生活費(月)', `${yen(plan.living.monthly)}`]],
        () => UI.openLivingSheet(id),
        [h('div', { class: 'button-row' }, btn('支払いの履歴から計算し直す', { size: 'small', icon: 'sync', onClick: () => UI.recalcLiving(id) }))]
      ),
      listCard({
        plan,
        key: 'livingChanges',
        title: '年齢による生活費の変化',
        hint: '「何歳から月いくら」で入れます(例:子どもの独立後・年金生活)。',
        describe: (r) => ({ name: `${r.fromAge}歳から`, sub: '', amount: `${yen(r.monthly)}/月` }),
      })
    );

    // 6〜7. ローン・積立
    container.append(
      listCard({
        plan,
        key: 'loans',
        title: 'ローン',
        hint: '支払い管理のカテゴリ「ローン」を拾っています。終了月の翌月から支出が減ります。',
        describe: (r) => ({
          name: r.name,
          sub: `${r.startYM ? `${U.ymLabel(r.startYM)}から` : '今から'}・${r.endYM ? `${U.ymLabel(r.endYM)}まで` : '終了年月が未定'}`,
          amount: `${MINUS}${yen(r.monthly)}`,
          amountCls: 'is-neg',
          flag: r.endYM ? null : '終了年月が未入力',
        }),
        actions: [btn('支払い管理から拾い直す', { size: 'small', icon: 'sync', onClick: () => UI.reloadFromPayments(id, 'loans') })],
      }),
      listCard({
        plan,
        key: 'savings',
        title: '積立投資',
        hint: '毎月、現金から投資へ移します。',
        describe: (r) => ({
          name: r.name,
          sub: `${r.startYM ? `${U.ymLabel(r.startYM)}から` : '今から'}・${r.endYM ? `${U.ymLabel(r.endYM)}まで` : '期間の終わりまで'}・${F.label(F.TAX_KINDS, r.taxKind)}・${F.label(F.PRIORITIES, r.priority)}`,
          amount: `${yen(r.monthly)}/月`,
        }),
        actions: [btn('支払い管理から拾い直す', { size: 'small', icon: 'sync', onClick: () => UI.reloadFromPayments(id, 'savings') })],
      })
    );

    // 8. 出費
    container.append(
      listCard({
        plan,
        key: 'oneTime',
        title: '大きな出費(単発)',
        hint: 'スイッチでオン/オフできます(買い替える/買い替えないの比較に)。金額は今の値段で、インフレ率を掛けます。',
        toggle: true,
        describe: (r) => ({ name: r.name, sub: U.ymLabel(r.ym), amount: `${MINUS}${yen(r.amount)}`, amountCls: r.enabled ? 'is-neg' : '' }),
      }),
      listCard({
        plan,
        key: 'yearly',
        title: '毎年の費用',
        hint: '自動車税・固定資産税など。支払い管理の特別支出を取り込めます。',
        toggle: true,
        describe: (r) => ({
          name: r.name,
          sub: `${r.fromYear}〜${r.toYear ? `${r.toYear}年` : '期間の終わり'}の${r.interval > 1 ? `${r.interval}年ごと` : '毎年'}${r.month}月`,
          amount: `${MINUS}${yen(r.amount)}`,
          amountCls: r.enabled ? 'is-neg' : '',
        }),
        actions: [btn('特別支出から取り込む', { size: 'small', icon: 'download', onClick: () => UI.importYearlyFlow(id) })],
      })
    );

    // 9〜10. 利回り・税率・生活防衛資金
    container.append(
      kvCard(
        '利回りの仮定と税率',
        [
          ['低め', `年${plan.returns.low}%`],
          ['普通', `年${plan.returns.mid}%`],
          ['高め', `年${plan.returns.high}%`],
          ['現金', '年0%(増えない)'],
          ['課税口座の含み益の税率', `${plan.tax.taxable}%`],
          ['NISA の税率', `${plan.tax.nisa}%`],
        ],
        () => UI.openReturnsSheet(id),
        [h('p', { class: 'hint fx-assume', text: '利回りは仮の値です(初期値 1% / 3% / 5%)。「直す」で変えられます。手入力の資産とポケカ在庫は増えません(利回り 0)。' })]
      ),
      kvCard(
        '生活防衛資金(現金の最低ライン)',
        [
          ['今の額', yen(F.reserveNow(plan))],
          ['決め方', plan.reserve.amount !== null ? '金額で決める' : `生活費の${plan.reserve.months}か月分(仮)`],
        ],
        () => UI.openReserveSheet(id),
        [h('p', { class: 'hint', text: '現金がこの額を下回る月は、投資から取り崩して補います。' })]
      )
    );
  }

  function assetsCard(plan) {
    const id = plan.id;
    const invest = plan.assets.reduce((t, a) => t + a.value, 0);
    const groups = F.PRIORITIES.map((p) => ({ p, rows: plan.assets.filter((a) => a.priority === p.id) }));
    const assetRow = (a) =>
      h(
        'li',
        { class: 'pay-row no-check' },
        h(
          'button',
          { type: 'button', class: 'pay-main', onClick: () => UI.openRowSheet(id, 'assets', a.id) },
          h('span', { class: 'pay-name', text: a.name }),
          h('span', { class: 'pay-meta' }, h('span', { text: F.label(F.GROUPS, a.group) }), h('span', { text: F.label(F.TAX_KINDS, a.taxKind) }), h('span', { text: a.grows ? '利回りで増える' : '増えない' })),
          h('span', { class: 'pay-amount' }, yen(a.value), h('small', { text: `取得 ${yen(a.cost)}` }))
        )
      );
    return h(
      'section',
      { class: 'card card-flush' },
      h('div', { class: 'card-head' }, h('h2', { class: 'card-title', text: '今の資産' }), btn('資産を追加', { icon: 'plus', size: 'small', onClick: () => UI.openRowSheet(id, 'assets', null) })),
      h(
        'div',
        { class: 'card-text' },
        h('div', { class: 'stat-grid' }, h('button', { type: 'button', class: 'stat fx-stat-btn', onClick: () => UI.openCashSheet(id) }, h('span', { class: 'stat-label', text: '現金(タップで直す)' }), h('span', { class: 'stat-value' }, U.yen(plan.cash), h('small', { text: '円' }))), h('div', { class: 'stat' }, h('span', { class: 'stat-label', text: '投資' }), h('span', { class: 'stat-value' }, U.yen(invest), h('small', { text: '円' })))),
        h('p', { class: 'hint', text: `現金の出どころ:${F.label(F.CASH_SOURCES, plan.cashSource)}。${plan.loadedAt ? `${plan.loadedAt.replace(/-/g, '/')} に記録から読み直しました。` : ''}投資は資産管理(保有・手入力)とポケカ在庫の評価額。売却優先度と取得額を引き継ぎます。` })
      ),
      groups.map((g) =>
        h(
          'details',
          { class: 'fx-group', open: g.rows.length > 0 && g.rows.length <= 8 },
          h('summary', null, h('span', { class: `chip fx-pri-${g.p.id}`, text: g.p.label }), h('span', { class: 'fx-group-sum', text: `${g.rows.length}件・${yen(g.rows.reduce((t, a) => t + a.value, 0))}` })),
          g.rows.length ? h('ul', { class: 'pay-list fx-list' }, g.rows.map(assetRow)) : h('p', { class: 'hint card-text', text: 'ありません。' })
        )
      ),
      h('div', { class: 'card-foot button-row' }, btn('最新の記録から読み直す', { icon: 'sync', size: 'small', onClick: () => UI.reloadStartFlow(id) }))
    );
  }

  // ---------------------------------------------------------------
  // 比較
  // ---------------------------------------------------------------

  function renderCompare(container) {
    const d = store.get();
    const f = d.future;
    head(container, 'future/compare');
    if (!f.plans.length) return container.append(welcome());
    if (f.plans.length < 2) {
      const only = f.plans[0];
      container.append(
        h(
          'section',
          { class: 'card' },
          h('h2', { class: 'card-title', text: 'プランを 2 つにすると比べられます' }),
          h('p', { text: '今のプランを複製し、片方の条件を変えます(例:「車を買い替える」のプランを複製して、単発の出費のスイッチをオフにした「買い替えない」プラン)。' }),
          h('div', { class: 'button-row' }, btn('今のプランを複製する', { variant: 'primary', onClick: () => UI.duplicateFlow(only.id) }))
        )
      );
      return;
    }
    const pick = (which) => {
      const sel = MT.forms.selectEl(f.plans.map((p) => ({ value: p.id, label: p.name })), f.compare[which], { class: 'field-select', 'aria-label': `プラン${which.toUpperCase()}` });
      sel.addEventListener('change', () => store.update((dd) => (dd.future.compare[which] = sel.value)));
      return sel;
    };
    const pa = F.findPlan(f, f.compare.a);
    const pb = F.findPlan(f, f.compare.b);
    const pat = state.cmpPattern;
    const a = { name: pa.name, plan: pa, result: F.simulate(pa, pa.returns[pat]) };
    const b = { name: pb.name, plan: pb, result: F.simulate(pb, pb.returns[pat]) };
    const canvas = h('canvas', { role: 'img', 'aria-label': `プラン A と B の総資産の推移。数値は下の表を参照。` });
    const fallback = h('p', { class: 'chart-fallback', hidden: true, text: 'グラフを読み込めませんでした。数値は下の表で見られます。' });
    const shortText = (x) => (x.result.summary.firstShortYM ? ymAgeCell(x.plan, x.result.summary.firstShortYM, 'is-neg fx-strong') : okCell());
    const belowText = (x) => (x.result.summary.firstBelowYM ? ymAgeCell(x.plan, x.result.summary.firstBelowYM, 'is-warn-num fx-strong') : h('span', { text: '割らない' }));
    const diff = b.result.summary.endTotal - a.result.summary.endTotal;
    const years = [...new Set([...a.result.years.map((y) => y.year), ...b.result.years.map((y) => y.year)])].sort((x, y) => x - y);
    const totalOf = (x, yr) => {
      const y = x.result.years.find((v) => v.year === yr);
      return y ? y.total : null;
    };
    container.append(
      h(
        'section',
        { class: 'card' },
        h('div', { class: 'fx-cmp-pick' }, MT.forms.field('プラン A', pick('a')), MT.forms.field('プラン B', pick('b'))),
        seg(
          F.PATTERNS.map((p) => ({ value: p.id, label: p.label })),
          pat,
          '比べる利回りのパターン',
          (v) => {
            state.cmpPattern = v;
            MT.app.rerender();
          }
        ),
        h('p', { class: 'hint', text: `利回りは、それぞれのプランの「${F.label(F.PATTERNS, pat)}」(A:年${pa.returns[pat]}%・B:年${pb.returns[pat]}%)で計算します。` })
      ),
      h('section', { class: 'card chart-card' }, h('h2', { class: 'card-title', text: '総資産の推移' }), h('div', { class: 'chart-box' }, canvas, fallback), h('p', { class: 'hint fx-mark-note' }, h('span', { class: 'fx-tri', 'aria-hidden': 'true' }), '資金が足りなくなる年')),
      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card-title', text: '比べた結果' }),
        h(
          'div',
          { class: 'fx-sum-wrap' },
          h(
            'table',
            { class: 'fx-sum' },
            h('thead', null, h('tr', null, h('th', { scope: 'col', text: '' }), h('th', { scope: 'col', text: `A:${pa.name}` }), h('th', { scope: 'col', text: `B:${pb.name}` }))),
            h(
              'tbody',
              null,
              h('tr', null, h('th', { scope: 'row', text: '資金が足りなくなる年' }), h('td', null, shortText(a)), h('td', null, shortText(b))),
              h('tr', null, h('th', { scope: 'row' }, '期間の終わりの総資産', h('small', { text: '万円' })), h('td', { class: `fx-num fx-strong ${a.result.summary.endTotal < 0 ? 'is-neg' : ''}`.trim(), text: man(a.result.summary.endTotal) }), h('td', { class: `fx-num fx-strong ${b.result.summary.endTotal < 0 ? 'is-neg' : ''}`.trim(), text: man(b.result.summary.endTotal) })),
              h('tr', null, h('th', { scope: 'row', text: '生活防衛資金を割る最初の年' }), h('td', null, belowText(a)), h('td', null, belowText(b))),
              h('tr', null, h('th', { scope: 'row' }, '取り崩しの合計(手取り)', h('small', { text: '万円' })), h('td', { class: 'fx-num', text: man(a.result.summary.drawNet) }), h('td', { class: 'fx-num', text: man(b.result.summary.drawNet) }))
            )
          )
        ),
        h('p', { class: `fx-diff ${tone(diff)}`.trim(), text: `期間の終わりの総資産の差(B − A):${diff > 0 ? '+' : ''}${manYen(diff)}` })
      ),
      h(
        'section',
        { class: 'card card-flush' },
        h('div', { class: 'card-head' }, h('h2', { class: 'card-title', text: '年末の総資産' }), h('span', { class: 'hint', text: '単位:万円' })),
        h(
          'div',
          { class: 'fx-table-wrap', tabindex: '0', role: 'region', 'aria-label': '年末の総資産の比較' },
          h(
            'table',
            { class: 'fx-table' },
            h('thead', null, h('tr', null, ['年', 'A', 'B', '差(B − A)'].map((t) => h('th', { scope: 'col', text: t })))),
            h(
              'tbody',
              null,
              years.map((yr) => {
                const va = totalOf(a, yr);
                const vb = totalOf(b, yr);
                const dv = va != null && vb != null ? vb - va : null;
                return h(
                  'tr',
                  null,
                  h('th', { scope: 'row', text: String(yr) }),
                  h('td', { class: va != null && va < 0 ? 'is-neg' : null, text: va == null ? '—' : man(va) }),
                  h('td', { class: vb != null && vb < 0 ? 'is-neg' : null, text: vb == null ? '—' : man(vb) }),
                  h('td', { class: dv ? tone(dv) : null, text: dv == null ? '—' : signedMan(dv) })
                );
              })
            )
          )
        )
      )
    );
    CH.compare('future-compare', canvas, fallback, a, b);
  }

  // ---------------------------------------------------------------
  // 計算の確認
  // ---------------------------------------------------------------

  function renderCheck(container) {
    head(container, 'future/check');
    const list = F.checks();
    add(
      container,
      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card-title', text: '計算の確認' }),
        h('p', { text: '架空のデータで、このアプリの計算が手で計算した値と一致するかを確かめます(この画面を開くたびに計算します)。' }),
        h('p', { class: `fx-check-all ${list.every((c) => c.ok) ? 'is-pos' : 'is-neg'}`, text: list.every((c) => c.ok) ? `✓ ${list.length}件すべて一致しています` : `✗ 一致しないものがあります` })
      ),
      list.map((c) =>
        h(
          'section',
          { class: 'card' },
          h('div', { class: 'card-head' }, h('h2', { class: 'card-title', text: c.title }), h('span', { class: `status-pill ${c.ok ? 'is-ok' : 'is-short'}`, text: c.ok ? '✓ 一致' : '✗ 不一致' })),
          h('p', { class: 'hint', text: c.setup }),
          h(
            'div',
            { class: 'fx-sum-wrap' },
            h(
              'table',
              { class: 'fx-sum fx-check' },
              h('thead', null, h('tr', null, h('th', { scope: 'col', text: '項目' }), h('th', { scope: 'col', text: '手計算' }), h('th', { scope: 'col', text: 'アプリ' }))),
              h('tbody', null, c.rows.map(([k, exp, act]) => h('tr', null, h('th', { scope: 'row', text: k }), h('td', { text: exp }), h('td', { class: 'fx-strong', text: typeof act === 'number' ? U.yen(act) : String(act) }))))
            )
          )
        )
      ),
      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card-title', text: '計算のきまり' }),
        h(
          'ul',
          { class: 'plain-list fx-rules' },
          [
            '内部は月ごとに計算し、表は暦の年ごとにまとめます(最初と最後の年は一部の月だけのことがあります)。',
            '毎月:現金 += 収入 − 生活費 − ローン − 積立 − 毎年の費用 − 単発の出費。積立分は投資に加えます。',
            '投資は、年利から換算した月利((1 + 年利)^(1/12) − 1)で、月初の残高を増やしてから積立を足します。現金・手入力の資産・ポケカ在庫は増えません。',
            'ローンは終了年月の月まで払い、翌月から支出が減ります。',
            'インフレ率は、生活費・毎年の費用・単発の出費(どれも今の値段で入力)に掛けます。収入・ローン・積立には掛けません。',
            '現金が生活防衛資金を下回る月は、「最初に売る」→「足りなければ売る」の順(同じ優先度は一覧の順)に取り崩し、生活防衛資金まで戻します。「売りたくない」は使いません。',
            '取り崩しの税:売った額 × 含み益の割合((評価額 − 取得額)÷ 評価額)× 税率(課税口座 20.315%、NISA 0%。条件で変更可)。手取りが現金に入ります。',
            '取り崩しても現金がマイナスの月は「資金不足」、生活防衛資金を下回る月は「防衛資金割れ」として記録します。',
            '利回りの 3 パターン(低め・普通・高め)は同時に計算します。',
          ].map((t) => h('li', { text: t }))
        )
      )
    );
  }

  MT.views = MT.views || {};
  MT.views.future = { render: renderForecast, tab: 'more' };
  MT.views['future/plan'] = { render: renderPlan, tab: 'more' };
  MT.views['future/compare'] = { render: renderCompare, tab: 'more' };
  MT.views['future/check'] = { render: renderCheck, tab: 'more' };
})(window);
