/*
 * Excel の過去記録の取り込み:計算と書き込み(画面には触らない)
 *
 * imports = {
 *   log:  [{ id, kind, at, source, fileName, startYM, months: ["YYYY-MM"], counts: { rows, cells, newItems, reference }, undone }],
 *         // 取り込みの履歴(新しい順・最大 30 件)。kind: monthly(月末記録)/ cards(カード推移)
 *   undo: { id, kind, ... } | null   // 直前の取り込みを元に戻すための控え(1 つだけ)
 *     monthly: { addedCategories, addedItems, createdMonths, cells: { ym: { itemId: [前の値, 前の確認日] } },
 *                flags: [{ itemId, prev }], lastUpdated: { itemId: 前の最終更新日 } }
 *     cards:   { months: [{ month, prev: 前の履歴 | null }] }
 * }
 *
 * 取り込みの流れ:importTable.analyze(表)→ 既定の選択(monthlyDefaults / cardDefaults)
 *   → 画面で直す → プレビュー(buildMonthlyPlan / buildCardPlan)→ 書き込み(applyMonthlyImport / applyCardImport)
 * 同じ月に既に値があるときは、月ごとに overwrite(上書き)/ skip(スキップ)/ fill(空欄だけ補う)を選ぶ。
 */
(function (root) {
  'use strict';
  const MT = (root.MT = root.MT || {});
  const U = MT.util;
  const T = MT.importTable;
  const MM = MT.monthlyModel;
  const P = MT.paymentsModel;

  const KINDS = { monthly: '月末記録', cards: 'カード推移' };
  const MODES = [
    { id: 'overwrite', label: '上書き' },
    { id: 'skip', label: 'スキップ' },
    { id: 'fill', label: '空欄だけ補う' },
  ];
  const DEFAULT_MODE = 'fill';
  const MAX_LOG = 30;

  // 月末記録:行の既定の分類
  const MONTHLY_SKIP_RE = /合計|総資産|前月比|月平均/; // 取り込まない(計算で出す)
  const REFERENCE_RE = /含み益/; // 参考行
  const MONTHLY_GRAND = ['合計', '総合計', '総資産', '資産合計', '総資産合計', '合計資産'];
  // カード推移:行の既定の分類
  const CARD_SKIP_RE = /合計|総合計|前月比|月平均/;
  const CARD_GRAND = ['合計', '総合計', '引き落とし合計', '引落合計', '引落し合計', 'カード合計'];

  const compact = (s) => String(s).replace(/\s+/g, '');

  // ---------------------------------------------------------------
  // 区画(imports)
  // ---------------------------------------------------------------

  function create() {
    return { log: [], undo: null };
  }

  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const str = (v, max = 100) => (typeof v === 'string' ? v.slice(0, max) : '');
  const int = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
  const ids = (arr) => (Array.isArray(arr) ? arr.filter((x) => typeof x === 'string' && x) : []);

  function cleanLog(e) {
    const c = isObj(e.counts) ? e.counts : {};
    return {
      id: str(e.id, 64) || U.uid('imp'),
      kind: e.kind === 'cards' ? 'cards' : 'monthly',
      at: typeof e.at === 'string' && !Number.isNaN(Date.parse(e.at)) ? e.at : new Date(0).toISOString(),
      source: e.source === 'file' ? 'file' : 'paste',
      fileName: str(e.fileName),
      startYM: U.isYM(e.startYM) ? e.startYM : null,
      months: (Array.isArray(e.months) ? e.months : []).filter(U.isYM),
      counts: { rows: int(c.rows), cells: int(c.cells), newItems: int(c.newItems), reference: int(c.reference) },
      undone: e.undone === true,
    };
  }

  function cleanUndo(u) {
    if (!isObj(u) || typeof u.id !== 'string') return null;
    if (u.kind === 'cards') {
      const months = (Array.isArray(u.months) ? u.months : [])
        .filter((x) => isObj(x) && U.isYM(x.month))
        .map((x) => ({ month: x.month, prev: isObj(x.prev) ? P.cleanHistory({ ...x.prev, month: x.month }) : null }));
      return { id: u.id, kind: 'cards', months };
    }
    if (u.kind !== 'monthly') return null;
    const cells = {};
    if (isObj(u.cells)) {
      for (const [ym, m] of Object.entries(u.cells)) {
        if (!U.isYM(ym) || !isObj(m)) continue;
        cells[ym] = {};
        for (const [itemId, pair] of Object.entries(m)) {
          if (!Array.isArray(pair)) continue;
          cells[ym][itemId] = [U.isYenValue(pair[0]) ? pair[0] : null, U.isDateStr(pair[1]) ? pair[1] : null];
        }
      }
    }
    const lastUpdated = {};
    if (isObj(u.lastUpdated)) for (const [k, v] of Object.entries(u.lastUpdated)) lastUpdated[k] = U.isDateStr(v) ? v : null;
    return {
      id: u.id,
      kind: 'monthly',
      addedCategories: ids(u.addedCategories),
      addedItems: ids(u.addedItems),
      createdMonths: (Array.isArray(u.createdMonths) ? u.createdMonths : []).filter(U.isYM),
      cells,
      flags: (Array.isArray(u.flags) ? u.flags : []).filter((f) => isObj(f) && typeof f.itemId === 'string').map((f) => ({ itemId: f.itemId, prev: f.prev === true })),
      groups: (Array.isArray(u.groups) ? u.groups : [])
        .filter((g) => isObj(g) && typeof g.itemId === 'string')
        .map((g) => ({ itemId: g.itemId, prev: typeof g.prev === 'string' ? g.prev.slice(0, MM.NAME_MAX) : '' })),
      lastUpdated,
    };
  }

  function normalize(raw) {
    const x = create();
    const seen = new Set();
    for (const e of Array.isArray(raw.log) ? raw.log : []) {
      if (!isObj(e)) continue;
      const c = cleanLog(e);
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      x.log.push(c);
    }
    x.log = x.log.slice(0, MAX_LOG);
    x.undo = cleanUndo(raw.undo);
    return x;
  }

  function hasContent(x) {
    return !!x && x.log.length > 0;
  }

  function summarize(x) {
    return x.log.length ? [`Excel の取り込み:履歴 ${x.log.length}件`] : [];
  }

  if (MT.store) MT.store.defineSection('imports', { create, normalize, hasContent, summarize });

  /** 履歴の 1 行の説明(「2026年1月〜2026年12月(12か月)・108件・新しい項目 3件」) */
  function describe(e) {
    if (!e) return '';
    const ms = [...e.months].sort();
    const range = ms.length ? `${U.ymLabel(ms[0])}〜${U.ymLabel(ms[ms.length - 1])}(${ms.length}か月)` : '書き込んだ月なし';
    const parts = [`${KINDS[e.kind]}:${range}`, `${e.counts.cells}件`];
    if (e.counts.newItems) parts.push(`新しい項目 ${e.counts.newItems}件`);
    return parts.join('・');
  }

  function pushLog(d, entry, undo) {
    const x = d.imports || (d.imports = create());
    x.log = [entry, ...x.log].slice(0, MAX_LOG);
    x.undo = undo;
  }

  // ---------------------------------------------------------------
  // 共通:列と月
  // ---------------------------------------------------------------

  /** 列の一覧(年月・オン/オフ・取り込むか) */
  function planColumns(table, choices) {
    const on = choices.cols.map((c) => !!c.on);
    const months = T.assignMonths(table.columns, choices.startYM, on);
    return table.columns.map((c, j) => ({ ...c, index: j, on: on[j], month: months[j], imported: on[j] && !!months[j] }));
  }

  /** 名前が「合計」などに当たる、元の表の合計行 */
  function grandRow(rows, names, fallbackRe) {
    let i = rows.findIndex((r) => names.includes(compact(r.name)));
    if (i < 0) i = rows.findIndex((r) => fallbackRe.test(r.name));
    return i;
  }

  function modeFor(conflicts, modes, ym) {
    if (!conflicts.some((c) => c.month === ym)) return 'new';
    const m = modes && modes[ym];
    return MODES.some((x) => x.id === m) ? m : DEFAULT_MODE;
  }

  // ---------------------------------------------------------------
  // A. 月末記録(口座資産の表)
  // ---------------------------------------------------------------

  /** 区分の既定:「預かり」→ 預かり金、「銀行」「信用金庫」「JA」→ 現金、それ以外 → 投資 */
  function categoryGuess(name) {
    if (/預かり/.test(name)) return 'deposit';
    if (/銀行|信用金庫|JA|ＪＡ/.test(name)) return 'cash';
    return 'invest';
  }

  function categoriesOf(m) {
    return m.categories.length ? m.categories : MM.DEFAULT_CATEGORIES;
  }

  function categoryIdFor(m, kind) {
    const cats = categoriesOf(m);
    const byId = { cash: 'cat_cash', invest: 'cat_invest', deposit: 'cat_deposit' }[kind];
    const byName = { cash: /現金|銀行/, invest: /投資|証券/, deposit: /預かり/ }[kind];
    return (cats.find((c) => c.id === byId) || cats.find((c) => byName.test(c.name)) || cats[0]).id;
  }

  /**
   * まとめ(証券会社など)の推測。「証券A(国内株式)」のように括弧の前が同じ名前の行を 1 つのまとめにする。
   * 括弧の前がほかのまとめの名前の始まりと同じなら(「証券(預かり)」と「証券A」)、長いほうのまとめに入れる
   * (当てはまるまとめが 2 つ以上あるときは、どちらか決められないので入れない)。
   * 2 行以上あるまとめだけ使う。対象にしない行(skip など)は '' を返す。
   * @param {string[]} names 行の名前
   * @param {boolean[]} use まとめを推測する行か
   * @returns {string[]} 行ごとのまとめの名前('' はまとめなし)
   */
  function groupGuess(names, use) {
    const baseOf = (name) => {
      const p = /^(.+?)\s*[(（](.+)[)）]\s*$/.exec(name);
      return p ? p[1].replace(/\s+/g, ' ').trim().slice(0, MM.NAME_MAX) : '';
    };
    const bases = names.map((n, i) => (use[i] ? baseOf(n) : ''));
    const distinct = [...new Set(bases.filter(Boolean))];
    const merged = bases.map((b) => {
      if (!b) return '';
      const longer = distinct.filter((x) => x !== b && x.startsWith(b));
      return longer.length === 1 ? longer[0] : b;
    });
    const count = new Map();
    for (const g of merged) if (g) count.set(g, (count.get(g) || 0) + 1);
    return merged.map((g) => (g && count.get(g) >= 2 ? g : ''));
  }

  /**
   * 既定の選択。
   *  - 名前に「合計」「総資産」「前月比」「月平均」→ 取り込まない(計算で出す)
   *  - 最初の合計行より下の行と、名前に「含み益」→ 参考行
   *  - それ以外 → 取り込む。既存の項目名と一致すれば、その項目へ
   *  - まとめ:既存の項目にまとめがあればそれ、無ければ名前から推測(groupGuess)。参考行には付けない
   *  - 区分:まとめに入る新しい項目は、そのまとめの行でいちばん多い区分(「証券A(預かり)」も証券会社の区分に)
   */
  function monthlyDefaults(d, table, now = new Date()) {
    const m = d.monthly;
    const grand = grandRow(table.rows, MONTHLY_GRAND, /合計/);
    const used = new Set();
    const statuses = table.rows.map((r, i) =>
      MONTHLY_SKIP_RE.test(r.name) ? 'skip' : (grand >= 0 && i > grand) || REFERENCE_RE.test(r.name) ? 'reference' : 'import'
    );
    const guesses = groupGuess(
      table.rows.map((r) => r.name),
      statuses.map((s) => s === 'import')
    );
    // まとめごとに、いちばん多い区分の推測
    const votes = new Map();
    guesses.forEach((g, i) => {
      if (!g) return;
      const k = categoryGuess(table.rows[i].name);
      if (!votes.has(g)) votes.set(g, []);
      votes.get(g).push(k);
    });
    const groupKind = (g) => {
      const list = votes.get(g) || [];
      const tally = new Map();
      for (const k of list) tally.set(k, (tally.get(k) || 0) + 1);
      return [...tally.entries()].sort((a, b) => b[1] - a[1] || list.indexOf(a[0]) - list.indexOf(b[0]))[0][0];
    };
    return {
      startYM: T.guessStartYM(table, now),
      cols: T.defaultColumnsOn(table.columns).map((on) => ({ on })),
      rows: table.rows.map((r, i) => {
        const status = statuses[i];
        const match = status === 'skip' ? null : m.items.find((it) => !used.has(it.id) && T.nameKey(it.name) === T.nameKey(r.name));
        if (match) used.add(match.id);
        const guess = guesses[i];
        const group = status !== 'import' ? (match ? MM.groupOf(match) : '') : match && MM.groupOf(match) ? MM.groupOf(match) : guess;
        const categoryId = match ? match.categoryId : categoryIdFor(m, guess ? groupKind(guess) : categoryGuess(r.name));
        return { status, target: match ? match.id : 'new', categoryId, group };
      }),
      modes: {},
    };
  }

  /** その月に、すでに値が入っているか(件数) */
  function filledCount(m, ym) {
    const r = m.records[ym];
    return r ? Object.keys(r.values).length : 0;
  }

  /**
   * プレビュー:列の年月、行の行き先、月ごとの区分小計と総資産(取り込む行だけ)、元の表の合計との差、
   * すでに値がある月、取り込めない理由(errors)。
   */
  function buildMonthlyPlan(d, table, choices) {
    const m = d.monthly;
    const cats = categoriesOf(m);
    const columns = planColumns(table, choices);
    const imported = columns.filter((c) => c.imported);
    const rows = table.rows.map((r, i) => {
      const ch = choices.rows[i];
      const item = ch.target && ch.target !== 'new' ? MM.findItem(m, ch.target) : null;
      const status = ['import', 'reference', 'skip'].includes(ch.status) ? ch.status : 'skip';
      const categoryId = item ? item.categoryId : cats.some((c) => c.id === ch.categoryId) ? ch.categoryId : cats[0].id;
      const group = typeof ch.group === 'string' ? ch.group.replace(/\s+/g, ' ').trim().slice(0, MM.NAME_MAX) : '';
      return {
        ...r,
        index: i,
        status,
        target: item ? item.id : 'new',
        item,
        categoryId,
        group,
        groupChange: !!item && status !== 'skip' && MM.groupOf(item) !== group,
        flagChange: !!item && status !== 'skip' && !!item.reference !== (status === 'reference'),
        cellCount: imported.filter((c) => r.values[c.index] !== null).length,
      };
    });
    const active = rows.filter((r) => r.status !== 'skip');

    const errors = [];
    const byTarget = new Map();
    for (const r of active) {
      if (r.target === 'new') continue;
      if (!byTarget.has(r.target)) byTarget.set(r.target, []);
      byTarget.get(r.target).push(r);
    }
    for (const [, list] of byTarget) {
      if (list.length > 1) errors.push(`「${list[0].item.name}」に ${list.map((r) => `${r.line}行目`).join('・')} が対応しています。どれか 1 行にしてください。`);
    }
    if (!imported.length) errors.push('取り込む月の列がありません。列をオンにしてください。');
    if (!active.length) errors.push('取り込む行がありません。');

    const grand = grandRow(table.rows, MONTHLY_GRAND, /合計/);
    const source = grand >= 0 ? table.rows[grand] : null;
    const checks = imported.map((c) => {
      const byCategory = new Map(cats.map((cat) => [cat.id, 0]));
      let total = 0;
      let reference = 0;
      for (const r of active) {
        const v = r.values[c.index];
        if (v === null) continue;
        if (r.status === 'reference') reference += v;
        else {
          byCategory.set(r.categoryId, (byCategory.get(r.categoryId) || 0) + v);
          total += v;
        }
      }
      const sv = source ? source.values[c.index] : null;
      return { month: c.month, header: c.header, byCategory, total, reference, source: sv, diff: sv === null ? null : total - sv };
    });
    const conflicts = imported.filter((c) => filledCount(m, c.month) > 0).map((c) => ({ month: c.month, filled: filledCount(m, c.month) }));

    // 二重に数えそうな項目:今ある項目(小計・総資産に含めるもの)で、名前が取り込むまとめと同じもの
    // (「証券A」の 1 行で記録していた所へ、内訳の「証券A(国内株式)」などを足す場合)
    const targeted = new Set(active.map((r) => r.target));
    const groupKeys = new Set(active.filter((r) => r.status === 'import' && r.group).map((r) => T.nameKey(r.group)));
    const doubles = m.items
      .filter((it) => !it.reference && !targeted.has(it.id) && groupKeys.has(T.nameKey(it.name)))
      .map((it) => ({ itemId: it.id, name: it.name, months: imported.filter((c) => MM.getValue(m, c.month, it.id) !== null).map((c) => c.month) }))
      .filter((x) => x.months.length);

    return { kind: 'monthly', columns, imported, rows, active, categories: cats, source, sourceName: source ? source.name : null, checks, conflicts, doubles, errors };
  }

  /** 書き込む件数(月ごとの選択を反映)。画面のボタンと確認に使う */
  function countMonthlyWrites(d, plan, modes) {
    const m = d.monthly;
    let cells = 0;
    const months = [];
    for (const c of plan.imported) {
      const mode = modeFor(plan.conflicts, modes, c.month);
      if (mode === 'skip') continue;
      let n = 0;
      for (const r of plan.active) {
        if (r.values[c.index] === null) continue;
        if (mode === 'fill' && r.item && MM.getValue(m, c.month, r.item.id) !== null) continue;
        n++;
      }
      if (n) {
        cells += n;
        months.push(c.month);
      }
    }
    return { cells, months, newItems: plan.active.filter((r) => r.target === 'new').length };
  }

  /**
   * 月末記録に書き込む(store.update の中で呼ぶ)。書き込んだ値は、取り込んだ日(today)を確認日・最終更新日にする。
   * @returns {{ok: true, cells, months, newItems, entry} | {ok: false, error}}
   */
  function applyMonthlyImport(d, table, choices, { today = U.todayStr(), now = new Date(), source = 'paste', fileName = '' } = {}) {
    const plan = buildMonthlyPlan(d, table, choices);
    if (plan.errors.length) return { ok: false, error: plan.errors[0] };
    const m = d.monthly;
    const undo = { id: U.uid('imp'), kind: 'monthly', addedCategories: [], addedItems: [], createdMonths: [], cells: {}, flags: [], groups: [], lastUpdated: {} };
    if (!m.categories.length) {
      for (const c of MM.DEFAULT_CATEGORIES) {
        m.categories.push({ ...c });
        undo.addedCategories.push(c.id);
      }
    }
    const itemOf = new Map();
    for (const r of plan.active) {
      const wantRef = r.status === 'reference';
      let it;
      if (r.target === 'new') {
        it = MM.addItem(m, r.categoryId, r.name, { reference: wantRef, group: r.group });
        undo.addedItems.push(it.id);
      } else {
        it = MM.findItem(m, r.target);
        if (!(it.id in undo.lastUpdated)) undo.lastUpdated[it.id] = it.lastUpdated;
        if (!!it.reference !== wantRef) {
          undo.flags.push({ itemId: it.id, prev: !!it.reference });
          it.reference = wantRef;
        }
        if (MM.groupOf(it) !== r.group) {
          undo.groups.push({ itemId: it.id, prev: MM.groupOf(it) });
          MM.setGroup(m, it.id, r.group);
        }
      }
      itemOf.set(r.index, it.id);
    }
    let cells = 0;
    const months = [];
    for (const c of plan.imported) {
      const ym = c.month;
      const mode = modeFor(plan.conflicts, choices.modes, ym);
      if (mode === 'skip') continue;
      let wrote = 0;
      for (const r of plan.active) {
        const v = r.values[c.index];
        if (v === null) continue; // 表が空欄・「-」の所は、今の値をそのまま残す
        const itemId = itemOf.get(r.index);
        const prev = MM.getValue(m, ym, itemId);
        if (mode === 'fill' && prev !== null) continue;
        if (!m.records[ym]) {
          MM.addMonth(m, ym, { copy: false });
          undo.createdMonths.push(ym);
        }
        const saved = (undo.cells[ym] = undo.cells[ym] || {});
        if (!(itemId in saved)) saved[itemId] = [prev, m.records[ym].confirmed[itemId] || null];
        MM.setValue(m, ym, itemId, v, today);
        wrote++;
      }
      if (wrote) {
        cells += wrote;
        months.push(ym);
      }
    }
    const entry = {
      id: undo.id,
      kind: 'monthly',
      at: now.toISOString(),
      source,
      fileName: String(fileName || '').slice(0, 100),
      startYM: choices.startYM,
      months,
      counts: { rows: plan.active.length, cells, newItems: undo.addedItems.length, reference: plan.active.filter((r) => r.status === 'reference').length },
      undone: false,
    };
    pushLog(d, entry, undo);
    return { ok: true, cells, months, newItems: undo.addedItems.length, entry };
  }

  function undoMonthly(d, u) {
    const m = d.monthly;
    for (const [ym, saved] of Object.entries(u.cells)) {
      const rec = m.records[ym];
      if (!rec) continue;
      for (const [itemId, [v, c]] of Object.entries(saved)) {
        if (!MM.findItem(m, itemId)) continue;
        if (v === null) {
          delete rec.values[itemId];
          delete rec.confirmed[itemId];
        } else {
          rec.values[itemId] = v;
          if (c) rec.confirmed[itemId] = c;
          else delete rec.confirmed[itemId];
        }
      }
    }
    for (const [id, prev] of Object.entries(u.lastUpdated)) {
      const it = MM.findItem(m, id);
      if (it) it.lastUpdated = prev;
    }
    for (const f of u.flags) MM.setReference(m, f.itemId, f.prev);
    for (const g of u.groups || []) MM.setGroup(m, g.itemId, g.prev);
    for (const id of u.addedItems) if (MM.findItem(m, id)) MM.deleteItem(m, id);
    for (const ym of u.createdMonths) {
      const rec = m.records[ym];
      if (rec && !Object.keys(rec.values).length && !rec.memo) delete m.records[ym];
    }
    for (const cid of u.addedCategories) {
      if (!m.items.some((it) => it.categoryId === cid)) m.categories = m.categories.filter((c) => c.id !== cid);
    }
  }

  // ---------------------------------------------------------------
  // B. カード推移 → 支払い管理の月別履歴(支払いの内訳)
  // ---------------------------------------------------------------

  function cardDefaults(d, table, now = new Date()) {
    return {
      startYM: T.guessStartYM(table, now),
      cols: T.defaultColumnsOn(table.columns).map((on) => ({ on })),
      rows: table.rows.map((r) => ({ status: CARD_SKIP_RE.test(r.name) ? 'skip' : 'import', category: 'variable' })),
      modes: {},
    };
  }

  /** 月末残高の初期値:月末記録の「現金」区分の小計(その月に値が無ければ null) */
  function cashSubtotal(d, ym) {
    const m = d.monthly;
    const cat = m.categories.find((c) => c.id === 'cat_cash') || m.categories.find((c) => /現金/.test(c.name));
    if (!cat || !m.records[ym]) return null;
    const items = m.items.filter((it) => it.categoryId === cat.id && !it.reference);
    if (!items.some((it) => MM.getValue(m, ym, it.id) !== null)) return null;
    return MM.categoryTotal(m, ym, cat.id);
  }

  function buildCardPlan(d, table, choices) {
    const p = d.payments;
    const columns = planColumns(table, choices);
    const imported = columns.filter((c) => c.imported);
    const cats = new Set(P.CATEGORIES.map((c) => c.id));
    const rows = table.rows.map((r, i) => {
      const ch = choices.rows[i];
      return {
        ...r,
        index: i,
        status: ch.status === 'import' ? 'import' : 'skip',
        category: cats.has(ch.category) ? ch.category : 'variable',
        cellCount: imported.filter((c) => r.values[c.index] !== null).length,
      };
    });
    const active = rows.filter((r) => r.status === 'import');
    const grand = grandRow(table.rows, CARD_GRAND, /総合計/);
    const source = grand >= 0 ? table.rows[grand] : null;
    // 「合計」を含む引き落とし口座別の行:参照用に表示だけする
    const refRows = rows.filter((r, i) => i !== grand && /合計/.test(r.name) && !/前月比|月平均/.test(r.name));

    const errors = [];
    const seen = new Map();
    for (const r of active) {
      const k = T.nameKey(r.name);
      if (seen.has(k)) errors.push(`「${r.name}」が ${seen.get(k)}行目と ${r.line}行目にあります。どちらか 1 行にしてください。`);
      else seen.set(k, r.line);
    }
    if (!imported.length) errors.push('取り込む月の列がありません。列をオンにしてください。');
    if (!active.length) errors.push('取り込む行がありません。');

    const checks = imported.map((c) => {
      let total = 0;
      for (const r of active) total += r.values[c.index] || 0;
      const sv = source ? source.values[c.index] : null;
      return { month: c.month, header: c.header, total, source: sv, diff: sv === null ? null : total - sv, refs: refRows.map((r) => ({ name: r.name, value: r.values[c.index] })) };
    });
    const conflicts = imported
      .map((c) => ({ month: c.month, entry: p.history.find((h) => h.month === c.month) }))
      .filter((x) => x.entry)
      .map((x) => ({ month: x.month, filled: x.entry.details.length }));
    return { kind: 'cards', columns, imported, rows, active, source, sourceName: source ? source.name : null, refRows, checks, conflicts, errors };
  }

  function countCardWrites(d, plan, modes) {
    let cells = 0;
    const months = [];
    for (const c of plan.imported) {
      const mode = modeFor(plan.conflicts, modes, c.month);
      if (mode === 'skip') continue;
      const entry = d.payments.history.find((h) => h.month === c.month);
      let n = 0;
      for (const r of plan.active) {
        if (r.values[c.index] === null) continue;
        if (mode === 'fill' && entry && entry.details.some((x) => T.nameKey(x.name) === T.nameKey(r.name))) continue;
        n++;
      }
      if (n) {
        cells += n;
        months.push(c.month);
      }
    }
    return { cells, months, newItems: 0 };
  }

  /**
   * 支払い管理の月別履歴に、カードごとの引き落とし額を「支払いの明細」として書き込む。
   * 同じ名前の明細があれば、上書きは置き換え、空欄だけ補うは残す。カテゴリ別の合計と支払の合計も合わせて直す。
   * その月の履歴が無ければ、収入は未入力、月末残高は月末記録の現金の小計で作る。
   */
  function applyCardImport(d, table, choices, { now = new Date(), source = 'paste', fileName = '' } = {}) {
    const plan = buildCardPlan(d, table, choices);
    if (plan.errors.length) return { ok: false, error: plan.errors[0] };
    const p = d.payments;
    const undo = { id: U.uid('imp'), kind: 'cards', months: [] };
    let cells = 0;
    const months = [];
    for (const c of plan.imported) {
      const ym = c.month;
      const mode = modeFor(plan.conflicts, choices.modes, ym);
      if (mode === 'skip') continue;
      const existing = p.history.find((h) => h.month === ym) || null;
      const before = existing ? JSON.parse(JSON.stringify(existing)) : null;
      const entry = existing || {
        month: ym,
        income: null,
        payment: 0,
        balance: cashSubtotal(d, ym),
        catTotals: Object.fromEntries(P.TOTAL_CATEGORIES.map((x) => [x.id, 0])),
        details: [],
        incomeDetails: [],
      };
      let wrote = 0;
      for (const r of plan.active) {
        const v = r.values[c.index];
        if (v === null) continue;
        const i = entry.details.findIndex((x) => T.nameKey(x.name) === T.nameKey(r.name));
        if (i >= 0) {
          if (mode === 'fill') continue;
          const old = entry.details[i];
          entry.catTotals[old.category] = (entry.catTotals[old.category] || 0) - old.amount;
          entry.payment -= old.amount;
          entry.details[i] = { name: r.name, amount: v, category: r.category };
        } else entry.details.push({ name: r.name, amount: v, category: r.category });
        entry.catTotals[r.category] = (entry.catTotals[r.category] || 0) + v;
        entry.payment += v;
        wrote++;
      }
      if (!wrote) continue;
      if (!existing) p.history.push(entry);
      undo.months.push({ month: ym, prev: before });
      cells += wrote;
      months.push(ym);
    }
    p.history.sort((a, b) => (a.month < b.month ? -1 : 1));
    const entry = {
      id: undo.id,
      kind: 'cards',
      at: now.toISOString(),
      source,
      fileName: String(fileName || '').slice(0, 100),
      startYM: choices.startYM,
      months,
      counts: { rows: plan.active.length, cells, newItems: 0, reference: 0 },
      undone: false,
    };
    pushLog(d, entry, undo);
    return { ok: true, cells, months, newItems: 0, entry };
  }

  function undoCards(d, u) {
    const p = d.payments;
    for (const x of u.months) {
      p.history = p.history.filter((h) => h.month !== x.month);
      if (x.prev) p.history.push(P.cleanHistory({ ...x.prev, month: x.month }));
    }
    p.history.sort((a, b) => (a.month < b.month ? -1 : 1));
  }

  // ---------------------------------------------------------------
  // 元に戻す
  // ---------------------------------------------------------------

  /** 直前の取り込みを元に戻す(store.update の中で呼ぶ) */
  function undoLast(d) {
    const x = d.imports;
    const u = x && x.undo;
    if (!u) return { ok: false, error: '元に戻せる取り込みがありません。' };
    if (u.kind === 'cards') undoCards(d, u);
    else undoMonthly(d, u);
    const e = x.log.find((l) => l.id === u.id) || null;
    if (e) e.undone = true;
    x.undo = null;
    return { ok: true, kind: u.kind, entry: e };
  }

  /** 元に戻せる取り込み(履歴の 1 行)。無ければ null */
  function undoTarget(d) {
    const x = d.imports;
    if (!x || !x.undo) return null;
    return x.log.find((l) => l.id === x.undo.id) || { id: x.undo.id, kind: x.undo.kind, months: [], counts: { cells: 0, newItems: 0 } };
  }

  MT.importsModel = {
    KINDS,
    MODES,
    DEFAULT_MODE,
    MAX_LOG,
    create,
    normalize,
    describe,
    categoryGuess,
    groupGuess,
    monthlyDefaults,
    buildMonthlyPlan,
    countMonthlyWrites,
    applyMonthlyImport,
    cardDefaults,
    cashSubtotal,
    buildCardPlan,
    countCardWrites,
    applyCardImport,
    modeFor,
    undoLast,
    undoTarget,
  };
})(typeof window !== 'undefined' ? window : globalThis);
