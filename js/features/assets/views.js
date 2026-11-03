/*
 * 資産管理:画面
 *   #/assets            ダッシュボード(総資産・評価損益・前回更新比・円グラフ・推移)
 *   #/assets/holdings   保有(株・投信)
 *   #/assets/manual     手入力の資産
 *   #/assets/summary    集計(証券会社別・口座区分別・種別別・NISA 枠・含み益・売却優先度)
 *   #/assets/dividends  配当・優待(月別カレンダー)
 */
(function (root) {
  'use strict';
  const MT = root.MT;
  const U = MT.util;
  const A = MT.assetsModel;
  const store = MT.store;
  const F = MT.assetsUI;
  const CH = MT.assetsCharts;
  const { h, add, icon, btn, toast } = MT.ui;

  const SUBNAV = [
    { path: 'assets', label: 'ダッシュボード' },
    { path: 'assets/holdings', label: '保有' },
    { path: 'assets/manual', label: '手入力' },
    { path: 'assets/summary', label: '集計' },
    { path: 'assets/dividends', label: '配当・優待' },
  ];

  const yen = (v) => `${U.yen(v)}円`;
  const signed = (v) => `${U.yenSigned(v)}円`;
  const tone = (v) => (v < 0 ? ' is-neg' : v > 0 ? ' is-pos' : '');
  const pct = (gain, cost) => (cost > 0 ? ` (${U.percentSigned(gain / cost)})` : '');
  const dateTime = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  function head(container, active) {
    const a = store.get().assets;
    container.append(
      h(
        'header',
        { class: 'page-head' },
        h('h1', { class: 'page-title', text: '資産' }),
        h('span', { class: 'page-sub', text: a.lastUpdateAt ? `価格の更新 ${dateTime(a.lastUpdateAt)}` : '価格は未更新' })
      ),
      h(
        'nav',
        { class: 'subnav', 'aria-label': '資産のメニュー' },
        SUBNAV.map((s) => h('a', { class: 'subnav-item', href: `#/${s.path}`, 'aria-current': s.path === active ? 'page' : null, text: s.label }))
      )
    );
    const unsure = a.holdings.filter((x) => x.nisaUnsure).length;
    if (unsure) {
      container.append(
        h(
          'section',
          { class: 'notice notice-warn', role: 'status' },
          icon('alert', 'notice-icon'),
          h(
            'div',
            { class: 'notice-main' },
            h('p', { class: 'notice-title', text: `NISA の口座区分を選んでください(${unsure}件)` }),
            h('p', { class: 'notice-text', text: '旧アプリの「NISA」は、旧 NISA か新 NISA か分からないため、仮に新 NISA にしています。' }),
            h('div', { class: 'notice-actions' }, btn('選ぶ', { variant: 'primary', size: 'small', onClick: F.openNisaReviewSheet }))
          )
        )
      );
    }
  }

  // ---- 価格の更新 ----

  let updating = false;

  async function updatePrices() {
    if (updating) return;
    const a = store.get().assets;
    if (!a.holdings.length && !a.manual.length) {
      toast('資産がまだありません');
      return;
    }
    updating = true;
    MT.app.rerender();
    try {
      const report = await MT.assetPrices.fetchPrices({ assets: a, secrets: MT.secrets.get() });
      if (report.aborted) {
        F.openPriceReport(report);
        return;
      }
      store.update((d) => A.applyPriceReport(d.assets, report, new Date()));
      const c = MT.assetPrices.countReport(report);
      if (c.failed.length || report.messages.length) F.openPriceReport(report);
      else toast(`価格を更新しました(${c.ok}件)`);
    } catch (e) {
      toast('価格を更新できませんでした', { type: 'error' });
    } finally {
      updating = false;
      MT.app.rerender();
    }
  }

  function updateButton() {
    return btn(updating ? '更新中…' : '価格を更新', { icon: 'sync', variant: 'primary', onClick: updatePrices, className: updating ? 'is-busy' : '' });
  }

  // ---------------------------------------------------------------
  // ダッシュボード
  // ---------------------------------------------------------------

  function renderDashboard(container) {
    const d = store.get();
    const a = d.assets;
    head(container, 'assets');
    const s = A.summary(a);

    if (!a.holdings.length && !a.manual.length) {
      container.append(
        h(
          'section',
          { class: 'card welcome' },
          h('h2', { class: 'card-title', text: '資産管理をはじめる' }),
          h('p', { text: '株・投資信託の保有と、ポイント運用や金などの手入力の資産をまとめて管理します。価格の自動取得の URL とキーは「設定」で入力します。' }),
          h(
            'div',
            { class: 'button-row' },
            btn('銘柄を追加', { variant: 'primary', icon: 'plus', onClick: () => F.openHoldingSheet(null) }),
            btn('まとめて貼り付け', { onClick: F.openPasteSheet }),
            btn('手入力の資産を追加', { onClick: () => F.openManualSheet(null) })
          ),
          h('p', { class: 'hint', text: '旧・資産管理アプリのデータは、設定から読み込めます。' })
        )
      );
      return;
    }

    const prev = A.previousEntry(a, U.todayStr());
    const diff = prev ? s.total - prev.total : null;
    container.append(
      h(
        'section',
        { class: 'card summary' },
        h('p', { class: 'summary-label', text: '総資産' }),
        h('p', { class: 'summary-value' }, U.yen(s.total), h('span', { class: 'summary-unit', text: '円' })),
        h(
          'div',
          { class: 'kv-list' },
          kv('評価損益', `${signed(s.gain)}${pct(s.gain, s.cost)}`, tone(s.gain)),
          kv('前回更新比', diff === null ? '—' : `${signed(diff)}${prev ? `(${U.shortDate(prev.date)}比)` : ''}`, diff === null ? '' : tone(diff)),
          kv('手残り(税引後)', yen(s.net), '', `課税口座の含み益に ${(a.settings.taxRate * 100).toFixed(3)}%`)
        ),
        s.missing ? h('p', { class: 'field-error', text: `価格未取得の銘柄が ${s.missing}件あります。合計には入っていません。` }) : null,
        h(
          'div',
          { class: 'button-row' },
          updateButton(),
          btn('月末記録に反映', { icon: 'sync', onClick: F.openReflectSheet })
        ),
        h('p', { class: 'hint', text: priceStatusText(a) })
      )
    );

    // 円グラフ
    const brokerParts = [...s.byBroker.entries()].filter(([, g]) => g.value > 0).map(([k, g]) => ({ label: k, value: g.value }));
    const kindParts = A.KINDS.map((k) => ({ label: k.label, value: (s.byKind.get(k.id) || { value: 0 }).value })).filter((p) => p.value > 0);
    container.append(pieCard('証券会社別', 'assets-pie-broker', brokerParts), pieCard('種別', 'assets-pie-kind', kindParts));

    // 推移
    const histCanvas = h('canvas', { role: 'img', 'aria-label': '総資産の推移の折れ線グラフ' });
    const histFallback = h('p', { class: 'chart-fallback', hidden: true, text: 'グラフを読み込めませんでした。インターネットに接続して、もう一度開いてください。' });
    container.append(
      h(
        'section',
        { class: 'card chart-card' },
        h('div', { class: 'card-head' }, h('h2', { class: 'card-title', text: '総資産の推移' })),
        a.history.length ? h('div', { class: 'chart-box' }, histCanvas, histFallback) : h('p', { class: 'hint', text: '「価格を更新」を押すたびに、その日の総資産を記録します(同じ日は上書き)。' })
      )
    );
    if (a.history.length) CH.history('assets-history', histCanvas, histFallback, a.history);
  }

  function priceStatusText(a) {
    const sec = MT.secrets.get();
    const parts = [];
    if (!sec.priceUrl) parts.push('国内株・投資信託の価格取得URLが未設定');
    if (a.holdings.some((x) => x.type === 'us') && !sec.finnhubKey) parts.push('Finnhub のキーが未設定(米国株は手入力)');
    if (a.fx.rate) parts.push(`USD/JPY ${a.fx.rate}(${a.fx.source === 'auto' ? '自動' : '手入力'})`);
    return parts.length ? parts.join('・') : '';
  }

  function kv(labelText, value, cls = '', hint) {
    return h(
      'div',
      { class: 'kv' },
      h('span', { class: 'kv-label' }, labelText, hint ? h('small', { text: hint }) : null),
      h('span', { class: `kv-value${cls}`, text: value })
    );
  }

  function pieCard(title, slot, parts) {
    const canvas = h('canvas', { role: 'img', 'aria-label': `${title}の円グラフ。数値は集計を参照。` });
    const fallback = h('p', { class: 'chart-fallback', hidden: true, text: 'グラフを読み込めませんでした。' });
    const card = h(
      'section',
      { class: 'card chart-card' },
      h('div', { class: 'card-head' }, h('h2', { class: 'card-title', text: title })),
      parts.length ? h('div', { class: 'chart-box chart-pie' }, canvas, fallback) : h('p', { class: 'hint', text: 'まだありません。' })
    );
    if (parts.length) setTimeout(() => CH.doughnut(slot, canvas, fallback, parts), 0);
    return card;
  }

  // ---------------------------------------------------------------
  // 保有
  // ---------------------------------------------------------------

  function renderHoldings(container) {
    const a = store.get().assets;
    head(container, 'assets/holdings');
    const s = A.summary(a);
    container.append(
      h(
        'section',
        { class: 'card' },
        h(
          'div',
          { class: 'card-head' },
          h('h2', { class: 'card-title', text: `株・投資信託(${a.holdings.length}件)` }),
          btn('追加', { icon: 'plus', variant: 'primary', size: 'small', onClick: () => F.openHoldingSheet(null) })
        ),
        h('div', { class: 'stat-grid' }, stat('評価額', s.securities.value), stat('評価損益', s.securities.gain, true)),
        s.securities.missing ? h('p', { class: 'field-error', text: `価格未取得 ${s.securities.missing}件(合計に入っていません)` }) : null,
        h('div', { class: 'button-row' }, updateButton(), btn('まとめて貼り付け', { size: 'small', onClick: F.openPasteSheet }))
      )
    );
    const groups = new Map();
    for (const x of a.holdings) {
      if (!groups.has(x.broker)) groups.set(x.broker, []);
      groups.get(x.broker).push(x);
    }
    for (const [broker, items] of groups) {
      const g = s.byBroker.get(broker);
      container.append(
        h(
          'section',
          { class: 'card card-flush' },
          h('div', { class: 'card-head' }, h('h2', { class: 'card-title', text: broker }), h('span', { class: `group-sum${tone(g.gain)}`, text: `${yen(g.value)}・${signed(g.gain)}` })),
          h('ul', { class: 'pay-list asset-list' }, items.map((x) => holdingRow(a, x)))
        )
      );
    }
  }

  function stat(labelText, value, signedValue) {
    return h(
      'div',
      { class: 'stat' },
      h('span', { class: 'stat-label', text: labelText }),
      h('span', { class: `stat-value${signedValue ? tone(value) : ''}` }, signedValue ? U.yenSigned(value) : U.yen(value), h('small', { text: '円' }))
    );
  }

  /** 価格が無い銘柄の、取れない理由(画面に出す) */
  function missingReason(a, x) {
    if (!x.code) return 'コードが未入力です(編集で入れてください)';
    if (x.type === 'us' && x.priceUsd != null && !a.fx.rate) return 'ドルの株価はありますが、USD/JPY が無いため円に換算できません(設定の「USD/JPY(手入力)」に入れられます)';
    if (x.lastError) return x.lastError;
    const sec = MT.secrets.get();
    if (x.type === 'us' && !sec.finnhubKey) return 'Finnhub のキーが未設定です(ドルで手入力できます)';
    if (x.type !== 'us' && !sec.priceUrl) return '価格取得のURLが未設定です(手入力できます)';
    return 'まだ「価格を更新」していません';
  }

  function holdingRow(a, x) {
    const v = A.valuation(x, a);
    const unit = F.qtyInfo(x.type).unit;
    const priceText = v.missing
      ? '価格未取得'
      : x.type === 'us'
        ? `$${U.formatNumber(x.priceUsd, 2)}(${U.formatNumber(v.unit, 0)}円)`
        : `${U.formatNumber(v.unit, 2)}円`;
    return h(
      'li',
      { class: 'pay-row no-check' },
      h(
        'button',
        { type: 'button', class: 'pay-main', onClick: () => F.holdingMenu(x.id) },
        h('span', { class: 'pay-name' }, x.name, x.code ? h('small', { class: 'code', text: x.code }) : null),
        h(
          'span',
          { class: 'pay-meta' },
          h('span', { class: 'chip', text: A.label(A.ACCOUNTS, x.account) }),
          h('span', { class: 'chip', text: A.label(A.TYPES, x.type) }),
          h('span', { text: `${U.formatNumber(x.quantity, 6)}${unit} × ${priceText}` }),
          x.lastError && !v.missing ? h('span', { class: 'meta-due is-warn', text: `取得失敗:${x.lastError}(前回 ${dateTime(x.priceAt)} の価格)` }) : null,
          v.missing ? h('span', { class: 'meta-due is-warn', text: `取れない理由:${missingReason(a, x)}` }) : null,
          x.priceSource === 'manual' && !v.missing ? h('span', { text: '手入力の価格' }) : null,
          x.priceSource === 'import' && !v.missing ? h('span', { text: '旧アプリの価格' }) : null,
          h('span', { class: 'chip chip-soft', text: A.label(A.PRIORITIES, x.sellPriority) })
        ),
        h(
          'span',
          { class: `pay-amount${v.missing ? ' is-missing' : ''}` },
          v.missing ? '価格未取得' : yen(v.value),
          v.missing ? h('small', { text: `取得額 ${U.yen(v.cost)}円` }) : h('small', { class: tone(v.gain).trim(), text: `${signed(v.gain)}${pct(v.gain, v.cost)}` })
        )
      )
    );
  }

  // ---------------------------------------------------------------
  // 手入力の資産
  // ---------------------------------------------------------------

  function renderManual(container) {
    const a = store.get().assets;
    head(container, 'assets/manual');
    const total = a.manual.reduce((t, m) => t + m.value, 0);
    const gain = a.manual.reduce((t, m) => t + (m.value - m.cost), 0);
    container.append(
      h(
        'section',
        { class: 'card card-flush' },
        h(
          'div',
          { class: 'card-head' },
          h('h2', { class: 'card-title', text: `手入力の資産(${a.manual.length}件)` }),
          btn('追加', { icon: 'plus', variant: 'primary', size: 'small', onClick: () => F.openManualSheet(null) })
        ),
        h('div', { class: 'stat-grid card-text' }, stat('評価額', total), stat('含み損益', gain, true)),
        h('p', { class: 'card-text hint', text: 'ポイント運用、ウォレット、金、コレクションなど、価格を自動で取れない資産です。評価額か含み損益のどちらかを入れると、もう片方を計算します。' }),
        h(
          'ul',
          { class: 'pay-list asset-list' },
          a.manual.length
            ? a.manual.map((m) => {
                const g = m.value - m.cost;
                return h(
                  'li',
                  { class: 'pay-row no-check' },
                  h(
                    'button',
                    { type: 'button', class: 'pay-main', onClick: () => F.openManualSheet(m.id) },
                    h('span', { class: 'pay-name', text: m.name }),
                    h(
                      'span',
                      { class: 'pay-meta' },
                      h('span', { class: 'chip', text: A.label(A.MANUAL_CATEGORIES, m.category) }),
                      h('span', { class: 'chip chip-soft', text: A.label(A.PRIORITIES, m.sellPriority) }),
                      h('span', { text: m.updatedAt ? `最終更新 ${U.shortDate(m.updatedAt)}` : '更新日なし' })
                    ),
                    h('span', { class: 'pay-amount' }, yen(m.value), h('small', { class: tone(g).trim(), text: signed(g) }))
                  )
                );
              })
            : h('li', { class: 'pay-empty', text: 'まだありません。「追加」から登録してください。' })
        )
      )
    );
  }

  // ---------------------------------------------------------------
  // 集計
  // ---------------------------------------------------------------

  function groupTable(title, entries) {
    return h(
      'section',
      { class: 'card card-flush' },
      h('div', { class: 'card-head' }, h('h2', { class: 'card-title', text: title })),
      h(
        'ul',
        { class: 'hist-list' },
        entries.map(([labelText, g]) =>
          h(
            'li',
            { class: 'hist-row sum-row' },
            h('span', { class: 'hist-month' }, labelText, g.missing ? h('small', { class: 'is-neg', text: ` 価格未取得 ${g.missing}件` }) : null),
            h(
              'span',
              { class: 'hist-nums' },
              h('span', null, h('small', { text: '評価額' }), U.yen(g.value)),
              h('span', { class: tone(g.gain).trim() }, h('small', { text: '評価損益' }), U.yenSigned(g.gain)),
              h('span', null, h('small', { text: '手残り' }), U.yen(g.net))
            )
          )
        )
      )
    );
  }

  function renderSummary(container) {
    const a = store.get().assets;
    head(container, 'assets/summary');
    const s = A.summary(a);
    const ordered = (map, list) => list.filter((x) => map.has(x.id)).map((x) => [x.label, map.get(x.id)]);
    const accounts = [...A.ACCOUNTS, { id: 'manual', label: '手入力の資産' }];
    const rate = a.settings.taxRate;
    const taxableGain = s.rows.filter((r) => !r.missing && r.gain > 0 && (A.isTaxable(r.account) || r.kind === 'm_invest')).reduce((t, r) => t + r.gain, 0);

    container.append(
      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card-title', text: '合計' }),
        h(
          'div',
          { class: 'kv-list' },
          kv('評価額', yen(s.total)),
          kv('取得額', yen(s.cost)),
          kv('評価損益(含み益の合計)', `${signed(s.gain)}${pct(s.gain, s.cost)}`, tone(s.gain)),
          kv('課税される含み益', yen(taxableGain), '', `税率 ${(rate * 100).toFixed(3)}%(NISA は 0%)`),
          kv('税金の見込み', yen(s.tax)),
          kv('手残り(税引後)', yen(s.net))
        ),
        s.missing ? h('p', { class: 'field-error', text: `価格未取得 ${s.missing}件は、どの合計にも入っていません。` }) : null
      ),
      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card-title', text: 'NISA 枠' }),
        h(
          'div',
          { class: 'stat-grid' },
          ...['nisa_old', 'nisa_new'].map((k) => {
            const g = s.nisa[k];
            return h(
              'div',
              { class: 'stat nisa-box' },
              h('span', { class: 'stat-label', text: A.label(A.ACCOUNTS, k) }),
              h('span', { class: 'stat-value' }, U.yen(g.value), h('small', { text: '円' })),
              h('span', { class: 'nisa-sub', text: `取得額 ${U.yen(g.cost)}円` }),
              h('span', { class: `nisa-sub${tone(g.gain)}`, text: `含み益 ${U.yenSigned(g.gain)}円` })
            );
          })
        )
      ),
      groupTable('証券会社別', [...s.byBroker.entries()]),
      groupTable('口座区分別', ordered(s.byAccount, accounts)),
      groupTable('種別別', ordered(s.byKind, A.KINDS)),
      groupTable('売却優先度別(段階5の取り崩し案で使います)', ordered(s.byPriority, A.PRIORITIES))
    );
  }

  // ---------------------------------------------------------------
  // 配当・優待
  // ---------------------------------------------------------------

  function renderDividends(container) {
    const a = store.get().assets;
    head(container, 'assets/dividends');
    const cal = A.dividendCalendar(a);
    const thisMonth = new Date().getMonth() + 1;
    container.append(
      h(
        'section',
        { class: 'card summary' },
        h('p', { class: 'summary-label', text: '年間の配当見込み(税引後)' }),
        h('p', { class: 'summary-value' }, U.yen(cal.annual.net), h('span', { class: 'summary-unit', text: '円' })),
        h('p', { class: 'summary-diff', text: `税引前 ${yen(cal.annual.gross)}・課税口座は ${(a.settings.taxRate * 100).toFixed(3)}%、米国株は米国の源泉税 10% も引いています` }),
        cal.missingFx ? h('p', { class: 'field-error', text: 'USD/JPY が無いため、米国株の配当は入っていません。' }) : null
      ),
      h(
        'section',
        { class: 'card card-flush' },
        h('div', { class: 'card-head' }, h('h2', { class: 'card-title', text: '月別カレンダー' })),
        h(
          'ol',
          { class: 'cal-list' },
          cal.months.map((m) =>
            h(
              'li',
              { class: `cal-month${m.month === thisMonth ? ' is-current' : ''}` },
              h('div', { class: 'cal-head' }, h('span', { class: 'cal-name', text: `${m.month}月` }), m.net ? h('span', { class: 'cal-total', text: `配当 ${yen(m.net)}` }) : null),
              m.dividends.length || m.records.length || m.arrivals.length
                ? h(
                    'ul',
                    { class: 'cal-items' },
                    m.dividends.map((x) => h('li', null, h('span', { class: 'cal-tag tag-div', text: '配当' }), h('span', { class: 'cal-text', text: x.name }), h('span', { class: 'num', text: yen(x.net) }))),
                    m.records.map((x) =>
                      h('li', null, h('span', { class: 'cal-tag tag-rec', text: '権利確定' }), h('span', { class: 'cal-text', text: `${x.name}:${x.content}${x.eligible ? '' : `(あと${U.formatNumber(x.short, 6)}株)`}` }))
                    ),
                    m.arrivals.map((x) => h('li', null, h('span', { class: 'cal-tag tag-arr', text: '到着' }), h('span', { class: 'cal-text', text: `${x.name}:${x.content}` })))
                  )
                : h('p', { class: 'hint cal-empty', text: '予定なし' })
            )
          )
        )
      ),
      h(
        'section',
        { class: 'card card-flush' },
        h('div', { class: 'card-head' }, h('h2', { class: 'card-title', text: '銘柄ごとの配当・優待' })),
        h(
          'ul',
          { class: 'pay-list asset-list' },
          a.holdings.length
            ? a.holdings.map((x) => {
                const dv = x.dividend;
                const b = x.benefit;
                const unit = x.type === 'us' ? 'ドル' : '円';
                return h(
                  'li',
                  { class: 'pay-row no-check' },
                  h(
                    'button',
                    { type: 'button', class: 'pay-main', onClick: () => F.openDividendSheet(x.id) },
                    h('span', { class: 'pay-name', text: x.name }),
                    h(
                      'span',
                      { class: 'pay-meta' },
                      h('span', { text: dv.perShare && dv.months.length ? `配当 ${U.formatNumber(dv.perShare, 4)}${unit} × ${dv.months.join('・')}月` : '配当なし' }),
                      b.content ? h('span', { text: `優待:${b.content}` }) : null
                    ),
                    h('span', { class: 'pay-amount', text: '編集' })
                  )
                );
              })
            : h('li', { class: 'pay-empty', text: '銘柄がまだありません。' })
        )
      )
    );
  }

  // ---------------------------------------------------------------
  // 登録
  // ---------------------------------------------------------------

  function destroyCharts() {
    for (const slot of ['assets-pie-broker', 'assets-pie-kind', 'assets-history']) CH.destroy(slot);
  }

  function needsAttention() {
    const d = store.get();
    return !!(d && d.assets && d.assets.holdings.some((x) => x.nisaUnsure));
  }

  MT.views = MT.views || {};
  MT.views.assets = { render: renderDashboard, unmount: destroyCharts, needsAttention };
  MT.views['assets/holdings'] = { render: renderHoldings, tab: 'assets' };
  MT.views['assets/manual'] = { render: renderManual, tab: 'assets' };
  MT.views['assets/summary'] = { render: renderSummary, tab: 'assets' };
  MT.views['assets/dividends'] = { render: renderDividends, tab: 'assets' };
  MT.assetsView = { updatePrices };
})(window);
