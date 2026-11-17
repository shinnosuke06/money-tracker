/*
 * 資産管理:開示・決算の画面
 *   #/assets/ir        近い決算・まだ見ていない開示・見ている銘柄(保有している国内株 + 気になる銘柄)
 *   #/assets/irstock   銘柄ごと:次の決算発表・IR のリンク・開示と要約
 * ほかの画面へ渡すもの(MT.assetIrUI):下のタブの文字の表示・ダッシュボードのお知らせ・保有の行の印・開いたときの受け取り
 * 計算と取得は js/features/assets/ir-model.js
 */
(function (root) {
  'use strict';
  const MT = root.MT;
  const U = MT.util;
  const IR = MT.assetIr;
  const store = MT.store;
  const { h, icon, btn, toast, openSheet, confirmDialog } = MT.ui;
  const { field, formFoot, errorLine, dateInput, textInput } = MT.forms;

  const STOCK_KEY = 'irStock'; // 銘柄の画面で出す銘柄(端末ごと)
  const openIds = new Set(); // 要約を開いている開示
  let busy = false;
  let summarizing = null;
  let timer = null;

  const W = ['日', '月', '火', '水', '木', '金', '土'];
  const md = (date) => {
    const [, m, d] = date.slice(0, 10).split('-').map(Number);
    return `${m}/${d}(${W[new Date(`${date.slice(0, 10)}T00:00:00Z`).getUTCDay()]})`;
  };
  const dateTime = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const assets = () => store.get().assets;
  const cache = () => IR.loadCache();
  const data = () => {
    const c = cache();
    return c ? c.data : null;
  };
  const url = () => MT.secrets.get().irUrl || '';

  // ---------------------------------------------------------------
  // ほかの画面へ渡すもの
  // ---------------------------------------------------------------

  function level() {
    const d = store.get();
    return d && d.assets ? IR.level(d.assets, data()) : null;
  }

  /** 下のタブ(資産)に出す文字 */
  function tabBadge() {
    const lv = level();
    if (!lv) return null;
    return { text: '開示・決算', level: lv, label: lv === 'red' ? '開示・決算:まだ見ていない開示があります' : '開示・決算:2週間以内に決算があります' };
  }

  /** 資産のダッシュボードのお知らせ(赤:まだ見ていない開示 / 黄:2週間以内の決算) */
  function dashboardNotice() {
    const a = assets();
    const dt = data();
    if (!dt) return null;
    const un = IR.unseen(a, dt);
    const sn = IR.soon(a, dt);
    if (!un.length && !sn.length) return null;
    const name = (code) => (IR.stocks(a).find((s) => s.code === code) || { name: code }).name;
    const lines = [
      ...un.slice(0, 3).map((it) => `${name(it.code)}:${it.tags && it.tags.length ? it.tags.map(tagText).join('・') : it.title}(${md(it.at)})`),
      ...(un.length > 3 ? [`ほか ${un.length - 3}件`] : []),
      ...sn.slice(0, 3).map((x) => `${x.stock.name}:${x.earnings.label}の発表が ${md(x.earnings.date)}(${daysText(x.earnings.date)})`),
    ];
    return h(
      'section',
      { class: `notice ${un.length ? 'notice-danger' : 'notice-warn'}`, role: 'status' },
      icon('alert', 'notice-icon'),
      h(
        'div',
        { class: 'notice-main' },
        h('p', { class: 'notice-title', text: un.length ? `まだ見ていない開示があります(${un.length}件)` : `2週間以内に決算があります(${sn.length}件)` }),
        h('ul', { class: 'notice-list' }, lines.map((t) => h('li', { text: t }))),
        h('div', { class: 'notice-actions' }, h('a', { class: 'btn btn-primary btn-small', href: '#/assets/ir' }, h('span', { text: '開示・決算を見る' })))
      )
    );
  }

  /** 保有の行に出す印(国内株だけ) */
  function holdingChips(x) {
    const dt = data();
    const code = x.type === 'jp' ? IR.normCode(x.code) : '';
    if (!dt || !code) return [];
    const a = assets();
    const list = IR.items(a, dt).filter((it) => it.code === code);
    const un = list.filter((it) => IR.isUnseen(a, it));
    const out = [];
    if (un.length) out.push(h('span', { class: 'chip chip-new', text: `未読 ${md(un[0].at)}` }));
    if (list[0] && list[0].tags) out.push(...tagChips(list[0].tags.slice(0, 2)));
    const e = IR.earningsOf(a, dt, code);
    if (e) out.push(earnChip(e));
    return out;
  }

  // ---------------------------------------------------------------
  // 部品
  // ---------------------------------------------------------------

  const ARROW = { up: '↑', down: '↓', flat: '' };
  const tagText = (t) => `${ARROW[t.dir] || ''}${t.name}`;
  function tagChips(tags) {
    return (tags || []).map((t) => h('span', { class: `chip ${t.dir === 'up' ? 'chip-up' : t.dir === 'down' ? 'chip-down' : 'chip-soft'}`, text: tagText(t) }));
  }
  function daysText(date) {
    const n = IR.daysUntil(date);
    return n === 0 ? '今日' : n === 1 ? '明日' : `あと${n}日`;
  }
  function earnChip(e) {
    const near = IR.daysUntil(e.date) <= IR.SOON_DAYS;
    return h('span', { class: `chip ${near ? 'chip-warn' : 'chip-soft'}`, text: `決算 ${md(e.date)}${near ? `・${daysText(e.date)}` : ''}` });
  }
  function kindChip(s) {
    return h('span', { class: `chip${s.kind === 'hold' ? '' : ' chip-soft'}`, text: s.kind === 'hold' ? '保有' : '気になる' });
  }

  function head(container, title, back) {
    if (back) {
      container.append(
        h('header', { class: 'page-head' }, h('a', { class: 'back-link', href: back.href }, icon('back'), h('span', { text: back.label })), h('h1', { class: 'page-title page-title-sub', text: title }))
      );
    } else MT.assetsView.head(container, 'assets/ir');
  }

  // ---------------------------------------------------------------
  // 受け取る
  // ---------------------------------------------------------------

  /** 入力欄で入力中なら、終わるまで待つ(描き直しで入力が消えないように) */
  function whenIdle() {
    return new Promise((resolve) => {
      const check = () => {
        const el = root.document.activeElement;
        const view = root.document.getElementById('view');
        const typing = el && view && view.contains(el) && el.matches('input, textarea, select');
        if (!typing) return resolve();
        root.document.addEventListener('focusout', () => setTimeout(check, 400), { once: true });
      };
      check();
    });
  }

  /**
   * GAS から集めた結果を受け取る。refresh:すぐに確かめてから(「今すぐ確認」)。quiet:開いたときの自動(失敗してもお知らせだけ)
   */
  async function load({ refresh = false, quiet = false } = {}) {
    const u = url();
    const a = assets();
    if (!u) {
      if (!quiet) toast('開示・決算の URL が未設定です(設定の「開示・決算」)');
      return;
    }
    if (busy) return;
    busy = true;
    if (!quiet) MT.app.rerender();
    const codes = IR.codesParam(a);
    try {
      const resp = await IR.fetchState({ url: u, codes, refresh });
      IR.saveCache({ fetchedAt: new Date().toISOString(), codes, data: resp, error: null });
      if (quiet) await whenIdle();
      busy = false;
      const changed = store.update((d) => IR.applyResponse(d.assets, resp, new Date()));
      if (!changed) MT.app.rerender();
      if (!quiet) toast(refresh ? '確かめました' : '受け取りました');
    } catch (e) {
      const c = cache();
      // 前回の結果は残し、理由だけ覚える(次は 10 分後)
      IR.saveCache({ fetchedAt: new Date().toISOString(), codes, data: c ? c.data : null, error: e.message || '受け取れませんでした' });
      if (!quiet) toast(`開示・決算:${e.message || '受け取れませんでした'}`, { type: 'error', duration: 5000 });
    } finally {
      busy = false;
      if (quiet) await whenIdle();
      MT.app.rerender();
    }
  }

  function maybeLoad() {
    if (busy || MT.store.isReadOnly()) return;
    if (root.navigator && root.navigator.onLine === false) return;
    const d = store.get();
    if (!d || !d.assets) return;
    if (IR.fetchDue(d.assets, cache(), url())) load({ quiet: true });
  }

  /** 開いたとき・戻ってきたときに、前回から 10 分以上たっていれば受け取る */
  function start() {
    maybeLoad();
    root.document.addEventListener('visibilitychange', () => {
      if (root.document.visibilityState !== 'visible') return;
      clearTimeout(timer);
      timer = setTimeout(maybeLoad, 800);
    });
  }

  // ---------------------------------------------------------------
  // 画面:開示・決算
  // ---------------------------------------------------------------

  function render(container) {
    head(container);
    const a = assets();
    const c = cache();
    const dt = c ? c.data : null;
    const list = IR.stocks(a);
    if (!url()) {
      container.append(setupCard());
    } else if (IR.fetchDue(a, c, url()) && !busy) {
      setTimeout(() => load({ quiet: true }), 0);
    }
    container.append(statusCard(c));

    if (url() || dt) {
      const sn = IR.soon(a, dt);
      container.append(
        h(
          'section',
          { class: 'card card-flush' },
          h('div', { class: 'card-head' }, h('h2', { class: 'card-title', text: '近い決算(2週間以内)' })),
          sn.length
            ? h(
                'ul',
                { class: 'pay-list asset-list' },
                sn.map((x) =>
                  h(
                    'li',
                    { class: 'pay-row no-check' },
                    h(
                      'button',
                      { type: 'button', class: 'pay-main', onClick: () => openStock(x.stock.code) },
                      h('span', { class: 'pay-name' }, x.stock.name, h('small', { class: 'code', text: x.stock.code })),
                      h('span', { class: 'pay-meta' }, kindChip(x.stock), h('span', { text: x.earnings.label }), x.earnings.manual ? h('span', { text: '手で入れた日' }) : null),
                      h('span', { class: 'pay-amount' }, md(x.earnings.date), h('small', { class: 'is-warn-num', text: daysText(x.earnings.date) }))
                    )
                  )
                )
              )
            : h('p', { class: 'card-text hint', text: dt ? '2週間以内の決算はありません。' : 'まだ受け取っていません。' })
        )
      );

      const un = IR.unseen(a, dt);
      const shown = un.length ? un : IR.items(a, dt).slice(0, 5);
      container.append(
        h(
          'section',
          { class: 'card card-flush' },
          h(
            'div',
            { class: 'card-head' },
            h('h2', { class: 'card-title', text: un.length ? `まだ見ていない開示(${un.length}件)` : '最近の開示' }),
            un.length ? h('div', { class: 'card-head-side' }, btn('すべて見た', { size: 'small', onClick: () => seen(un.map((it) => it.id), 'すべて見たことにしました') })) : null
          ),
          shown.length
            ? h('ul', { class: 'pay-list asset-list' }, shown.map((it) => discRow(a, it, true)))
            : h('p', { class: 'card-text hint', text: dt ? '直近1か月ほどの開示はありません。' : 'まだ受け取っていません。' })
        )
      );
    }

    container.append(
      h(
        'section',
        { class: 'card card-flush' },
        h('div', { class: 'card-head' }, h('h2', { class: 'card-title', text: `見ている銘柄(${list.length})` })),
        h('p', { class: 'card-text hint', text: '保有している国内株は自動で入ります(保有に追加すると自動で追加、削除すると外れます)。保有していない銘柄は「気になる銘柄」として下から追加できます。米国株と投資信託は対象外です。' }),
        list.length
          ? h(
              'ul',
              { class: 'pay-list asset-list' },
              list.map((s) => {
                const items = IR.items(a, dt).filter((it) => it.code === s.code);
                const last = items[0];
                const un = items.filter((it) => IR.isUnseen(a, it));
                const e = IR.earningsOf(a, dt, s.code);
                return h(
                  'li',
                  { class: `pay-row no-check${un.length ? ' is-changed' : ''}` },
                  h(
                    'button',
                    { type: 'button', class: 'pay-main', onClick: () => openStock(s.code) },
                    h('span', { class: 'pay-name' }, s.name, h('small', { class: 'code', text: s.code })),
                    h(
                      'span',
                      { class: 'pay-meta' },
                      kindChip(s),
                      un.length ? h('span', { class: 'chip chip-new', text: `未読 ${un.length}件` }) : null,
                      e ? earnChip(e) : h('span', { class: 'chip chip-soft', text: '決算 未定' }),
                      last ? tagChips((last.tags || []).slice(0, 2)) : null
                    ),
                    h('span', { class: 'pay-amount' }, last ? md(last.at) : '—', h('small', { text: last ? '最新の開示' : '開示なし' }))
                  )
                );
              })
            )
          : h('p', { class: 'card-text hint', text: 'まだありません。保有に国内株を入れるか、下から気になる銘柄を追加してください。' }),
        addWatchForm()
      )
    );
  }

  function setupCard() {
    return h(
      'section',
      { class: 'card' },
      h('h2', { class: 'card-title', text: 'はじめに' }),
      h('p', {
        text: '開示と決算発表予定日は、自分の Google アカウントに用意する「開示・決算」の GAS から受け取ります。README の「開示・決算」の手順で GAS を用意し、出てきた URL を設定に入れてください。',
      }),
      h('div', { class: 'button-row' }, h('a', { class: 'btn btn-primary btn-small', href: '#/settings' }, h('span', { text: '設定を開く' })))
    );
  }

  function statusCard(c) {
    const lines = [];
    const dt = c ? c.data : null;
    if (c && c.error) lines.push({ warn: true, text: `受け取れませんでした:${c.error}(${dateTime(c.fetchedAt)})${dt ? '。前回受け取った内容を出しています' : ''}` });
    if (dt && dt.lastError) lines.push({ warn: true, text: `開示の確認:${dt.lastError}(前回の結果を出しています)` });
    if (dt && dt.earningsError) lines.push({ warn: true, text: `決算発表予定日:${dt.earningsError}(前回の結果を出しています。銘柄の画面で手で入れることもできます)` });
    if (dt && dt.summaryNote) lines.push({ warn: true, text: dt.summaryNote });
    if (dt) lines.push({ text: `開示の確認:${dateTime(dt.lastOkAt)}・決算発表予定日:${dateTime(dt.earningsAt)}・受け取り:${dateTime(c.fetchedAt)}` });
    lines.push({ text: 'GAS は、平日 11:30〜13:00・15:00〜18:00 は 5 分おき、平日のそのほか(7〜22時)は 30 分おき、夜中と土日は 3 時間おきに開示を確かめます。アプリは開いたとき(前回から 10 分以上たっていたら)に受け取ります。↑↓は資料に書かれた中身の向きで、株価の予想ではありません。' });
    return h(
      'section',
      { class: 'card' },
      lines.map((l) => h('p', { class: l.warn ? 'field-error' : 'hint', text: l.text })),
      url() ? h('div', { class: 'button-row' }, btn(busy ? '確認中…' : '今すぐ確認', { icon: 'sync', className: busy ? 'is-busy' : '', onClick: () => load({ refresh: true }) })) : null
    );
  }

  function addWatchForm() {
    const code = textInput('', { id: 'ir-watch-code', maxlength: 6, autocapitalize: 'characters', placeholder: 'コード', 'aria-label': '気になる銘柄のコード(例:1234)' });
    const name = textInput('', { id: 'ir-watch-name', maxlength: 40, placeholder: '名前(任意)', 'aria-label': '気になる銘柄の名前(空なら開示の会社名)' });
    const err = errorLine();
    const add = () => {
      err.hide();
      let res = null;
      store.update((d) => (res = IR.addWatch(d.assets, code.value, name.value)));
      if (!res || !res.ok) return err.show(res ? res.error : '追加できませんでした', code);
      toast(`${res.code} を気になる銘柄に追加しました`);
      if (url()) load({ quiet: true });
    };
    return h('div', { class: 'card-text ir-watch-add' }, h('h3', { class: 'sp-title', text: '気になる銘柄を追加' }), h('div', { class: 'ir-watch-row' }, code, name, btn('追加', { variant: 'primary', icon: 'plus', onClick: add })), err.el);
  }

  function seen(ids, message) {
    let n = 0;
    if (store.update((d) => (n = IR.markSeen(d.assets, ids))) && message && n) toast(message);
  }

  function openStock(code) {
    U.prefs.set(STOCK_KEY, code);
    const a = assets();
    const ids = IR.items(a, data())
      .filter((it) => it.code === code)
      .map((it) => it.id);
    if (ids.length) store.update((d) => IR.markSeen(d.assets, ids));
    MT.app.navigate('assets/irstock');
  }

  function discRow(a, it, withName) {
    const s = IR.stocks(a).find((x) => x.code === it.code);
    const isOpen = openIds.has(it.id);
    const un = IR.isUnseen(a, it);
    return h(
      'li',
      { class: `disc-item${un ? ' is-changed' : ''}` },
      h(
        'button',
        {
          type: 'button',
          class: 'disc-head',
          'aria-expanded': String(isOpen),
          onClick: () => {
            if (isOpen) openIds.delete(it.id);
            else openIds.add(it.id);
            if (un) seen([it.id]);
            else MT.app.rerender();
          },
        },
        h('span', { class: 'disc-when' }, withName ? `${s ? s.name : it.name}(${it.code})・` : '', it.at, un ? h('span', { class: 'chip chip-new', text: '未読' }) : null),
        h('span', { class: 'disc-title', text: it.title }),
        h('span', { class: 'disc-tags' }, tagChips(it.tags), h('span', { class: 'disc-toggle', text: isOpen ? '閉じる ▲' : it.status === 'done' ? '要約を見る ▼' : '開く ▼' }))
      ),
      isOpen ? summaryBox(it) : null
    );
  }

  function summaryBox(it) {
    const sec = (title, list, cls) => h('div', { class: `sum-sec ${cls}` }, h('p', { class: 'sum-title', text: `【${title}】` }), h('ul', {}, (list && list.length ? list : ['なし']).map((t) => h('li', { text: t }))));
    const body = [];
    if (it.status === 'done') {
      body.push(h('p', { class: 'sum-head', text: it.head }), sec('好材料', it.good, 'is-good'), sec('悪材料', it.bad, 'is-bad'), sec('中立', it.neutral, 'is-neutral'));
    } else if (it.status === 'pending') {
      body.push(h('p', { class: 'hint', text: `要約待ちです(GAS が順番に要約します)。${it.reason ? `前回:${it.reason}` : ''}` }));
    } else {
      const why = it.status === 'nopdf' ? '資料の PDF がありません。' : it.status === 'failed' ? `要約できませんでした${it.reason ? `(${it.reason})` : ''}。` : '見張り始める前の開示なので、自動では要約していません。';
      body.push(h('p', { class: 'hint', text: why }));
      if (it.status !== 'nopdf' && url()) body.push(h('div', { class: 'button-row' }, btn(summarizing === it.id ? '要約中…(30秒ほど)' : 'いま要約する', { size: 'small', className: summarizing === it.id ? 'is-busy' : '', onClick: () => summarizeNow(it.id) })));
    }
    body.push(
      it.url ? h('div', { class: 'button-row' }, h('a', { class: 'btn btn-secondary btn-small', href: it.url, target: '_blank', rel: 'noopener' }, h('span', { text: '資料(PDF)を開く' }))) : null,
      it.status === 'done' ? h('p', { class: 'hint', text: '要約は Gemini が資料から作ったものです。↑↓は資料に書かれた中身の向きで、株価がどう動くかの予想ではありません。数字は資料で確かめてください。' }) : null
    );
    return h('div', { class: 'disc-summary' }, body);
  }

  async function summarizeNow(id) {
    if (summarizing) return;
    summarizing = id;
    MT.app.rerender();
    try {
      const item = await IR.summarize({ url: url(), id });
      const c = cache();
      if (c && c.data && Array.isArray(c.data.items) && item) {
        c.data.items = c.data.items.map((x) => (x.id === item.id ? item : x));
        IR.saveCache(c);
      }
      toast(item && item.status === 'done' ? '要約しました' : `要約できませんでした${item && item.reason ? `:${item.reason}` : ''}`, item && item.status === 'done' ? {} : { type: 'error' });
    } catch (e) {
      toast(`要約できませんでした:${e.message}`, { type: 'error', duration: 5000 });
    } finally {
      summarizing = null;
      MT.app.rerender();
    }
  }

  // ---------------------------------------------------------------
  // 画面:銘柄ごと
  // ---------------------------------------------------------------

  function renderStock(container) {
    const a = assets();
    const dt = data();
    const code = U.prefs.get(STOCK_KEY, '');
    const s = IR.stocks(a).find((x) => x.code === code);
    head(container, s ? `${s.name}(${s.code})` : '銘柄', { href: '#/assets/ir', label: '開示・決算' });
    if (!s) {
      container.append(h('section', { class: 'card' }, h('p', { class: 'hint', text: 'この銘柄は、いまは見ていません(保有から外したか、気になる銘柄から外しました)。' })));
      return;
    }
    const e = IR.earningsOf(a, dt, s.code);
    container.append(
      h(
        'section',
        { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', { class: 'card-title', text: '次の決算発表' }), kindChip(s)),
        e
          ? h('p', { class: 'earn-date' }, md(e.date), h('small', { text: `${e.label}・${daysText(e.date)}${e.manual ? '・手で入れた日' : ''}` }))
          : h('p', { class: 'earn-date is-undecided' }, '未定', h('small', { text: '一覧にまだ載っていません。会社の IR で確かめて、手で入れることもできます' })),
        h('p', { class: 'hint', text: '出どころ:日本取引所(JPX)の決算発表予定日の一覧(毎営業日更新)。予定は変わることがあります。' }),
        h(
          'div',
          { class: 'button-row' },
          btn(a.ir.manualEarnings[s.code] ? '手で入れた日を直す' : '予定日を手で入れる', { size: 'small', onClick: () => openEarningsSheet(s) }),
          s.kind === 'watch' ? btn('気になる銘柄から外す', { size: 'small', variant: 'ghost', className: 'btn-ghost-danger', onClick: () => removeWatchFlow(s) }) : null
        )
      ),
      h(
        'section',
        { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', { class: 'card-title', text: 'IR・会社の情報' })),
        h('p', { class: 'hint', text: '外のサイトが開きます(アプリからは何も送りません)。' }),
        h(
          'div',
          { class: 'button-row' },
          extLink('Yahoo!ファイナンス', `https://finance.yahoo.co.jp/quote/${s.code}.T`),
          extLink('株探(決算・開示)', `https://kabutan.jp/stock/?code=${s.code}`),
          extLink('会社の IR を検索', `https://www.google.com/search?q=${encodeURIComponent(`${s.code} ${s.name} IR`)}`)
        )
      )
    );
    const list = IR.items(a, dt).filter((it) => it.code === s.code);
    container.append(
      h(
        'section',
        { class: 'card card-flush' },
        h('div', { class: 'card-head' }, h('h2', { class: 'card-title', text: '開示(直近1か月ほど・新しい順)' })),
        list.length ? h('ul', { class: 'pay-list asset-list' }, list.map((it) => discRow(a, it, false))) : h('p', { class: 'card-text hint', text: dt ? '直近1か月ほどの開示はありません。' : 'まだ受け取っていません。' })
      )
    );
  }

  function extLink(label, href) {
    return h('a', { class: 'btn btn-secondary btn-small', href, target: '_blank', rel: 'noopener' }, h('span', { text: label }));
  }

  function openEarningsSheet(s) {
    const a = assets();
    const cur = a.ir.manualEarnings[s.code];
    const sh = openSheet({ title: '決算発表予定日を手で入れる', description: `${s.name}(${s.code})`, className: 'sheet-form' });
    const err = errorLine();
    const date = dateInput(cur ? cur.date : U.todayStr(), '決算発表予定日');
    const label = textInput(cur ? cur.label : '', { maxlength: 30, placeholder: '例:第2四半期決算', 'aria-label': '何の決算か' });
    sh.body.append(field('決算発表予定日', date, '会社の IR ページなどで確かめた日。一覧に載っている日より、こちらを優先します。過ぎたら使いません。'), field('何の決算か(任意)', label), err.el);
    formFoot(sh, {
      onSave: () => {
        if (!U.isDateStr(date.value)) return err.show('日付を入れてください', date);
        if (store.update((d) => IR.setManualEarnings(d.assets, s.code, date.value, label.value))) {
          sh.close();
          toast('決算発表予定日を入れました');
        }
      },
      onDelete: cur
        ? () => {
            if (store.update((d) => IR.setManualEarnings(d.assets, s.code, null))) {
              sh.close();
              toast('手で入れた日を消しました');
            }
          }
        : null,
    });
  }

  async function removeWatchFlow(s) {
    const ok = await confirmDialog({ title: `「${s.name}」を気になる銘柄から外しますか?`, message: '開示・決算の確認からも外れます。', okLabel: '外す', danger: true });
    if (ok && store.update((d) => IR.removeWatch(d.assets, s.code))) {
      toast('外しました');
      MT.app.navigate('assets/ir');
    }
  }

  MT.views = MT.views || {};
  MT.views['assets/ir'] = { render, tab: 'assets' };
  MT.views['assets/irstock'] = { render: renderStock, tab: 'assets' };
  MT.assetIrUI = { level, tabBadge, dashboardNotice, holdingChips, start, load };
})(window);
