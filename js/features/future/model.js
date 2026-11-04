/*
 * 将来予想(ライフプラン):データの形と計算(画面には触らない)
 *
 * future = {
 *   plans: [Plan],            // 条件のまとまり(複製・名前変更・削除ができる。最大 MAX_PLANS)
 *   activeId,                 // いま見ているプラン
 *   compare: { a, b }         // 比較する 2 つのプラン
 * }
 *
 * Plan = {
 *   id, name,
 *   startYM,                  // 計算を始める年月(今の資産の時点)
 *   birthYM,                  // 生年月(null は未入力。年齢の条件が使えない)
 *   years,                    // 予想の期間(年。既定 40)
 *   inflation,                // インフレ率(年 %)。生活費・毎年の費用・単発の出費に掛ける(入力は今の値段)
 *   returns: { low, mid, high },          // 利回りの仮定(年 %)。現金は 0%
 *   tax: { taxable, nisa },               // 取り崩しの含み益にかける税率(%)
 *   reserve: { months, amount },          // 生活防衛資金。amount があればその額、無ければ その月の生活費 × months
 *   cash, cashSource,                     // 現金の初期値と、その出どころ(monthly / payments / manual)
 *   loadedAt,                             // 最新の記録から読み直した日
 *   incomes:    [{ id, name, fromAge, toAge, monthly }],             // 収入(手取りの月額)。年齢は null で「制限なし」
 *   extras:     [{ id, name, year, month, amount, untilYear }],      // 臨時収入。untilYear があれば毎年
 *   sidejob:    { monthly, untilYM },                                // 副業収入(untilYM まで。null は期間の終わりまで)
 *   repayments: [{ id, name, monthly, endYM }],                      // 家族などからの返済(endYM の月まで)
 *   living:     { monthly, changes: [{ id, fromAge, monthly }] },    // 毎月の生活費(ローン・積立を除く)
 *   loans:      [{ id, name, monthly, startYM, endYM, sourceKey }],  // ローン(endYM の月まで払い、翌月から減る)
 *   savings:    [{ id, name, monthly, startYM, endYM, taxKind, priority }], // 積立投資(現金 → 投資)
 *   oneTime:    [{ id, name, ym, amount, enabled }],                 // 単発の大きな出費
 *   yearly:     [{ id, name, amount, month, fromYear, toYear, interval, enabled, sourceKey }], // 毎年の費用
 *   assets:     [{ id, name, group, value, cost, taxKind, priority, grows, sourceKey }]       // 今の投資資産
 * }
 *   taxKind:taxable(課税口座)/ nisa(NISA)/ none(税金を計算しない)
 *   priority:first(最初に売る)/ ifNeeded(足りなければ売る)/ keep(売りたくない。取り崩さない)
 *   group:securities(株・投信)/ manual(手入力)/ inventory(ポケカ在庫)/ other
 *
 * 計算(simulate):月ごとに、
 *   現金 += 収入 − 生活費 − ローン − 積立 − 毎年の費用 − 単発の出費
 *   投資:月初の残高を月利((1 + 年利)^(1/12) − 1)で増やし、そのあと積立を足す(grows が false の資産は増えない)
 *   現金 < 生活防衛資金 なら、最初に売る → 足りなければ売る の順(同じ優先度は一覧の順)に取り崩す。
 *   売った額のうち含み益の割合(評価額と取得額の比率)に税率を掛けた分を引いた手取りが現金に入る。
 *   それでも現金がマイナスの月は「資金不足」、生活防衛資金を下回る月は「防衛資金割れ」として記録する。
 * 金額は毎月、円の整数に丸める。
 */
(function (root) {
  'use strict';
  const MT = (root.MT = root.MT || {});
  const U = MT.util;

  const PATTERNS = [
    { id: 'low', label: '低め' },
    { id: 'mid', label: '普通' },
    { id: 'high', label: '高め' },
  ];
  const PRIORITIES = [
    { id: 'first', label: '最初に売る' },
    { id: 'ifNeeded', label: '足りなければ売る' },
    { id: 'keep', label: '売りたくない' },
  ];
  const TAX_KINDS = [
    { id: 'taxable', label: '課税口座(特定・一般)' },
    { id: 'nisa', label: 'NISA(非課税)' },
    { id: 'none', label: '税金を計算しない' },
  ];
  const GROUPS = [
    { id: 'securities', label: '株・投資信託' },
    { id: 'manual', label: '手入力の資産' },
    { id: 'inventory', label: 'ポケカ在庫' },
    { id: 'other', label: 'そのほか' },
  ];
  const CASH_SOURCES = [
    { id: 'monthly', label: '月末記録の「現金」の小計' },
    { id: 'payments', label: '支払い管理の口座の現在残高' },
    { id: 'manual', label: '手で入力' },
  ];
  const DEFAULTS = { years: 40, inflation: 0, returns: { low: 1, mid: 3, high: 5 }, tax: { taxable: 20.315, nisa: 0 }, reserveMonths: 6 };
  const MAX_PLANS = 10;
  const MAX_ROWS = 100;
  const MAX_ASSETS = 300;
  const NAME_MAX = 60;
  const LIST_KEYS = ['incomes', 'extras', 'repayments', 'loans', 'savings', 'oneTime', 'yearly', 'assets', 'livingChanges'];

  const label = (list, id) => (list.find((x) => x.id === id) || { label: id }).label;

  // ---- 値の点検 ----

  const text = (s, max = NAME_MAX) =>
    String(s == null ? '' : s)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max);
  const cleanId = (v, prefix) => (typeof v === 'string' && v ? v.slice(0, 64) : U.uid(prefix));
  /** 金額(円の整数)。allowNeg が false ならマイナスは 0 */
  const yen = (v, def = 0, allowNeg = false) => {
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    if (!Number.isFinite(n)) return def;
    const r = Math.round(n);
    if (!U.isYenValue(r)) return def;
    return allowNeg ? r : Math.max(0, r);
  };
  const yenOrNull = (v) => (v === null || v === undefined || v === '' ? null : yen(v, null));
  const num = (v, min, max, def, digits = 3) => {
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    if (!Number.isFinite(n)) return def;
    const f = 10 ** digits;
    return Math.min(max, Math.max(min, Math.round(n * f) / f));
  };
  const int = (v, min, max, def) => {
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    return Number.isInteger(n) && n >= min && n <= max ? n : def;
  };
  const intOrNull = (v, min, max) => (v === null || v === undefined || v === '' ? null : int(v, min, max, null));
  const ymOrNull = (v) => (U.isYM(v) ? v : null);
  const oneOf = (list, v, def) => (list.some((x) => x.id === v) ? v : def);
  const list = (arr) => (Array.isArray(arr) ? arr : []).filter((x) => x && typeof x === 'object');
  const rows = (arr, clean, max = MAX_ROWS) => {
    const seen = new Set();
    return list(arr)
      .map(clean)
      .filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)))
      .slice(0, max);
  };

  function cleanIncome(x) {
    return { id: cleanId(x.id, 'fin'), name: text(x.name) || '収入', fromAge: intOrNull(x.fromAge, 0, 120), toAge: intOrNull(x.toAge, 0, 120), monthly: yen(x.monthly) };
  }
  function cleanExtra(x) {
    const year = int(x.year, 1900, 2200, Number(U.currentYM().slice(0, 4)));
    const until = intOrNull(x.untilYear, 1900, 2200);
    return { id: cleanId(x.id, 'fex'), name: text(x.name) || '臨時収入', year, month: int(x.month, 1, 12, 12), amount: yen(x.amount), untilYear: until !== null && until > year ? until : null };
  }
  function cleanRepayment(x) {
    return { id: cleanId(x.id, 'frp'), name: text(x.name) || '返済', monthly: yen(x.monthly), endYM: ymOrNull(x.endYM) };
  }
  function cleanLivingChange(x) {
    return { id: cleanId(x.id, 'flv'), fromAge: int(x.fromAge, 0, 120, 65), monthly: yen(x.monthly) };
  }
  function cleanLoan(x) {
    return { id: cleanId(x.id, 'fln'), name: text(x.name) || 'ローン', monthly: yen(x.monthly), startYM: ymOrNull(x.startYM), endYM: ymOrNull(x.endYM), sourceKey: typeof x.sourceKey === 'string' ? x.sourceKey.slice(0, 160) : null };
  }
  function cleanSaving(x) {
    return {
      id: cleanId(x.id, 'fsv'),
      name: text(x.name) || '積立投資',
      monthly: yen(x.monthly),
      startYM: ymOrNull(x.startYM),
      endYM: ymOrNull(x.endYM),
      taxKind: oneOf(TAX_KINDS, x.taxKind, 'taxable'),
      priority: oneOf(PRIORITIES, x.priority, 'ifNeeded'),
      sourceKey: typeof x.sourceKey === 'string' ? x.sourceKey.slice(0, 160) : null,
    };
  }
  function cleanOneTime(x) {
    return { id: cleanId(x.id, 'fot'), name: text(x.name) || '出費', ym: ymOrNull(x.ym) || U.currentYM(), amount: yen(x.amount), enabled: x.enabled !== false };
  }
  function cleanYearly(x) {
    const fromYear = int(x.fromYear, 1900, 2200, Number(U.currentYM().slice(0, 4)));
    const toYear = intOrNull(x.toYear, 1900, 2200);
    return {
      id: cleanId(x.id, 'fyr'),
      name: text(x.name) || '毎年の費用',
      amount: yen(x.amount),
      month: int(x.month, 1, 12, 1),
      fromYear,
      toYear: toYear !== null && toYear >= fromYear ? toYear : null,
      interval: int(x.interval, 1, 30, 1),
      enabled: x.enabled !== false,
      sourceKey: typeof x.sourceKey === 'string' ? x.sourceKey.slice(0, 160) : null,
    };
  }
  function cleanAsset(x) {
    const group = oneOf(GROUPS, x.group, 'other');
    return {
      id: cleanId(x.id, 'fas'),
      name: text(x.name, 80) || '資産',
      group,
      value: yen(x.value),
      cost: yen(x.cost),
      taxKind: oneOf(TAX_KINDS, x.taxKind, 'none'),
      priority: oneOf(PRIORITIES, x.priority, 'ifNeeded'),
      grows: typeof x.grows === 'boolean' ? x.grows : group === 'securities',
      sourceKey: typeof x.sourceKey === 'string' ? x.sourceKey.slice(0, 160) : null,
    };
  }

  function cleanPlan(raw = {}, now = new Date()) {
    const r = raw.returns && typeof raw.returns === 'object' ? raw.returns : {};
    const t = raw.tax && typeof raw.tax === 'object' ? raw.tax : {};
    const rv = raw.reserve && typeof raw.reserve === 'object' ? raw.reserve : {};
    const sj = raw.sidejob && typeof raw.sidejob === 'object' ? raw.sidejob : {};
    const lv = raw.living && typeof raw.living === 'object' ? raw.living : {};
    return {
      id: cleanId(raw.id, 'plan'),
      name: text(raw.name, 40) || 'プラン',
      startYM: U.isYM(raw.startYM) ? raw.startYM : U.currentYM(now),
      birthYM: ymOrNull(raw.birthYM),
      years: int(raw.years, 1, 60, DEFAULTS.years),
      inflation: num(raw.inflation, -5, 20, DEFAULTS.inflation),
      returns: {
        low: num(r.low, -20, 30, DEFAULTS.returns.low),
        mid: num(r.mid, -20, 30, DEFAULTS.returns.mid),
        high: num(r.high, -20, 30, DEFAULTS.returns.high),
      },
      tax: { taxable: num(t.taxable, 0, 100, DEFAULTS.tax.taxable), nisa: num(t.nisa, 0, 100, DEFAULTS.tax.nisa) },
      reserve: { months: num(rv.months, 0, 60, DEFAULTS.reserveMonths, 1), amount: yenOrNull(rv.amount) },
      cash: yen(raw.cash, 0, true),
      cashSource: oneOf(CASH_SOURCES, raw.cashSource, 'manual'),
      loadedAt: U.isDateStr(raw.loadedAt) ? raw.loadedAt : null,
      incomes: rows(raw.incomes, cleanIncome),
      extras: rows(raw.extras, cleanExtra),
      sidejob: { monthly: yen(sj.monthly), untilYM: ymOrNull(sj.untilYM) },
      repayments: rows(raw.repayments, cleanRepayment),
      living: { monthly: yen(lv.monthly), changes: rows(lv.changes, cleanLivingChange) },
      loans: rows(raw.loans, cleanLoan),
      savings: rows(raw.savings, cleanSaving),
      oneTime: rows(raw.oneTime, cleanOneTime),
      yearly: rows(raw.yearly, cleanYearly),
      assets: rows(raw.assets, cleanAsset, MAX_ASSETS),
    };
  }

  // ---- 区画 ----

  function create() {
    return { plans: [], activeId: null, compare: { a: null, b: null } };
  }

  function normalize(raw) {
    const f = create();
    if (!raw || typeof raw !== 'object') return f;
    const seen = new Set();
    f.plans = list(raw.plans)
      .map((p) => cleanPlan(p))
      .filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)))
      .slice(0, MAX_PLANS);
    f.activeId = typeof raw.activeId === 'string' ? raw.activeId : null;
    const c = raw.compare && typeof raw.compare === 'object' ? raw.compare : {};
    f.compare = { a: typeof c.a === 'string' ? c.a : null, b: typeof c.b === 'string' ? c.b : null };
    fixRefs(f);
    return f;
  }

  /** 消したプランを指している選択を直す */
  function fixRefs(f) {
    const ids = new Set(f.plans.map((p) => p.id));
    if (!ids.has(f.activeId)) f.activeId = f.plans.length ? f.plans[0].id : null;
    if (!ids.has(f.compare.a)) f.compare.a = f.plans[0] ? f.plans[0].id : null;
    // B が無い、または A と同じでほかのプランがあるときは、A 以外の最初のプランにする
    if (!ids.has(f.compare.b) || (f.compare.b === f.compare.a && f.plans.length > 1)) {
      const other = f.plans.find((p) => p.id !== f.compare.a);
      f.compare.b = other ? other.id : f.compare.a;
    }
  }

  function finalize(d) {
    if (d.future) fixRefs(d.future);
  }

  function hasContent(f) {
    return !!f && f.plans.length > 0;
  }

  function summarize(f) {
    return [`将来予想:プラン ${f.plans.length}件`];
  }

  // ---- プランの操作 ----

  const findPlan = (f, id) => f.plans.find((p) => p.id === id) || null;
  const activePlan = (f) => findPlan(f, f.activeId) || f.plans[0] || null;

  function addPlan(f, plan) {
    if (f.plans.length >= MAX_PLANS) return null;
    const p = cleanPlan({ ...plan, id: null });
    f.plans.push(p);
    f.activeId = p.id;
    fixRefs(f);
    return p.id;
  }

  function duplicatePlan(f, id, name) {
    const src = findPlan(f, id);
    if (!src || f.plans.length >= MAX_PLANS) return null;
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = null;
    copy.name = text(name, 40) || `${src.name}のコピー`;
    // 行の id も新しくする(別のプランとして直せるように)
    for (const k of LIST_KEYS) for (const row of rowsOf(copy, k)) row.id = null;
    const p = cleanPlan(copy);
    f.plans.splice(f.plans.indexOf(src) + 1, 0, p);
    f.activeId = p.id;
    fixRefs(f);
    return p.id;
  }

  function renamePlan(f, id, name) {
    const p = findPlan(f, id);
    if (p && text(name, 40)) p.name = text(name, 40);
  }

  function removePlan(f, id) {
    f.plans = f.plans.filter((p) => p.id !== id);
    fixRefs(f);
  }

  /** 一覧の行の配列(livingChanges は living.changes) */
  function rowsOf(plan, key) {
    return key === 'livingChanges' ? plan.living.changes : plan[key];
  }

  const CLEANERS = {
    incomes: cleanIncome,
    extras: cleanExtra,
    repayments: cleanRepayment,
    loans: cleanLoan,
    savings: cleanSaving,
    oneTime: cleanOneTime,
    yearly: cleanYearly,
    assets: cleanAsset,
    livingChanges: cleanLivingChange,
  };

  /** 行を足す・直す(id が同じなら置き換え)。行の id を返す */
  function saveRow(plan, key, draft) {
    const arr = rowsOf(plan, key);
    const row = CLEANERS[key](draft || {});
    const i = arr.findIndex((x) => x.id === row.id);
    if (i >= 0) arr[i] = row;
    else {
      if (arr.length >= (key === 'assets' ? MAX_ASSETS : MAX_ROWS)) return null;
      arr.push(row);
    }
    return row.id;
  }

  function removeRow(plan, key, id) {
    const arr = rowsOf(plan, key);
    const i = arr.findIndex((x) => x.id === id);
    if (i >= 0) arr.splice(i, 1);
  }

  /** 単発の出費・毎年の費用のオン/オフ */
  function toggleRow(plan, key, id) {
    const row = rowsOf(plan, key).find((x) => x.id === id);
    if (row && 'enabled' in row) row.enabled = !row.enabled;
  }

  /** 基本の条件など、行でない値をまとめて直す(cleanPlan を通す) */
  function updatePlan(f, id, patch) {
    const i = f.plans.findIndex((p) => p.id === id);
    if (i < 0) return;
    f.plans[i] = cleanPlan({ ...f.plans[i], ...patch, id });
  }

  // ---- 年齢・時期 ----

  /** その年月の年齢(生年月が無ければ null) */
  function ageAt(plan, ym) {
    return plan.birthYM ? Math.floor(U.ymDiff(ym, plan.birthYM) / 12) : null;
  }

  /** 今の年齢から生年月を逆算(その年齢になったばかりとして扱う) */
  function birthFromAge(startYM, age) {
    return U.ymAdd(startYM, -12 * age);
  }

  const inAge = (age, from, to) => (from === null || (age !== null && age >= from)) && (to === null || (age !== null && age <= to));
  const inRange = (ym, from, to) => (!from || ym >= from) && (!to || ym <= to);
  const endYM = (plan) => U.ymAdd(plan.startYM, plan.years * 12 - 1);

  /** その年齢の生活費(年齢による変化のうち、いちばん新しいもの) */
  function livingAt(plan, age) {
    let v = plan.living.monthly;
    let best = -1;
    if (age === null) return v;
    for (const c of plan.living.changes) if (c.fromAge <= age && c.fromAge > best) (best = c.fromAge), (v = c.monthly);
    return v;
  }

  /** 毎年の費用がその年月にかかるか */
  function yearlyHits(row, ym) {
    const { y, m } = U.splitYM(ym);
    return row.enabled && row.month === m && y >= row.fromYear && (row.toYear === null || y <= row.toYear) && (y - row.fromYear) % row.interval === 0;
  }

  function extraHits(row, ym) {
    const { y, m } = U.splitYM(ym);
    return row.month === m && (row.untilYear === null ? y === row.year : y >= row.year && y <= row.untilYear);
  }

  // ---- 計算 ----

  /** 年利(%)→ 月利 */
  const monthlyRate = (annual) => Math.pow(1 + annual / 100, 1 / 12) - 1;

  /**
   * 1 本の利回りで、期間の月ごとに計算する。
   * @param {object} plan
   * @param {number} annualRate 投資の年利(%)
   * @returns {{ months: object[], years: object[], summary: object }}
   */
  function simulate(plan, annualRate) {
    const rm = monthlyRate(annualRate);
    const taxRate = (b) => (b.taxKind === 'taxable' ? plan.tax.taxable : b.taxKind === 'nisa' ? plan.tax.nisa : 0) / 100;
    const buckets = [
      ...plan.assets.map((a) => ({ key: `a:${a.id}`, name: a.name, group: a.group, value: a.value, cost: Math.min(a.cost, Number.MAX_SAFE_INTEGER), grows: a.grows, taxKind: a.taxKind, priority: a.priority })),
      ...plan.savings.map((s) => ({ key: `s:${s.id}`, savingId: s.id, name: `${s.name}(積立分)`, group: 'saving', value: 0, cost: 0, grows: true, taxKind: s.taxKind, priority: s.priority })),
    ];
    const sellOrder = [...buckets.filter((b) => b.priority === 'first'), ...buckets.filter((b) => b.priority === 'ifNeeded')];
    const total = plan.years * 12;
    let cash = plan.cash;
    const months = [];

    for (let k = 0; k < total; k++) {
      const ym = U.ymAdd(plan.startYM, k);
      const age = ageAt(plan, ym);
      const infl = Math.pow(1 + plan.inflation / 100, k / 12);

      // 収入(内訳も残す:収入の行・副業・返済・臨時収入)
      const parts = { work: 0, sidejob: 0, repay: 0, extra: 0 };
      for (const r of plan.incomes) if (inAge(age, r.fromAge, r.toAge)) parts.work += r.monthly;
      if (plan.sidejob.monthly && (!plan.sidejob.untilYM || ym <= plan.sidejob.untilYM)) parts.sidejob += plan.sidejob.monthly;
      for (const r of plan.repayments) if (!r.endYM || ym <= r.endYM) parts.repay += r.monthly;
      for (const r of plan.extras) if (extraHits(r, ym)) parts.extra += r.amount;
      const income = parts.work + parts.sidejob + parts.repay + parts.extra;

      // 支出
      const living = Math.round(livingAt(plan, age) * infl);
      let loans = 0;
      for (const r of plan.loans) if (inRange(ym, r.startYM, r.endYM)) loans += r.monthly;
      let saving = 0;
      const contrib = [];
      for (const r of plan.savings) {
        if (inRange(ym, r.startYM, r.endYM) && r.monthly > 0) {
          saving += r.monthly;
          contrib.push(r);
        }
      }
      let yearly = 0;
      for (const r of plan.yearly) if (yearlyHits(r, ym)) yearly += Math.round(r.amount * infl);
      let oneTime = 0;
      for (const r of plan.oneTime) if (r.enabled && r.ym === ym) oneTime += Math.round(r.amount * infl);

      const expense = living + loans + saving + yearly;
      cash += income - expense - oneTime;

      // 投資:月初の残高を増やしてから、積立を足す
      for (const b of buckets) if (b.grows && b.value > 0 && rm !== 0) b.value = Math.max(0, Math.round(b.value * (1 + rm)));
      for (const r of contrib) {
        const b = buckets.find((x) => x.savingId === r.id);
        b.value += r.monthly;
        b.cost += r.monthly;
      }

      // 取り崩し
      const reserve = plan.reserve.amount !== null ? plan.reserve.amount : Math.round(plan.reserve.months * living);
      const sales = [];
      if (cash < reserve) {
        let need = reserve - cash;
        for (const b of sellOrder) {
          if (need <= 0) break;
          const s = sell(b, need, taxRate(b));
          if (!s) continue;
          sales.push(s);
          cash += s.net;
          need -= s.net;
        }
      }
      const invest = buckets.reduce((t, b) => t + b.value, 0);
      months.push({
        ym,
        age,
        income,
        incomeParts: parts,
        living,
        loans,
        saving,
        yearly,
        oneTime,
        expense,
        flow: income - expense - oneTime,
        reserve,
        sales,
        drawGross: sales.reduce((t, s) => t + s.gross, 0),
        drawTax: sales.reduce((t, s) => t + s.tax, 0),
        drawNet: sales.reduce((t, s) => t + s.net, 0),
        cash,
        invest,
        total: cash + invest,
        short: cash < 0,
        below: cash < reserve,
      });
    }
    const years = toYears(months);
    return { months, years, summary: summaryOf(months), buckets };
  }

  /**
   * 1 つの資産から、手取りで need 円になるように売る(足りなければ全部売る)。
   * 税 = 売った額 × 含み益の割合((評価額 − 取得額)÷ 評価額)× 税率。取得額は売った割合だけ減らす。
   */
  function sell(b, need, rate) {
    if (b.value <= 0 || need <= 0) return null;
    const gainRatio = b.value > b.cost ? (b.value - b.cost) / b.value : 0;
    const keep = 1 - gainRatio * rate; // 1 円売ったときの手取り
    let gross = keep > 0 ? Math.ceil(need / keep) : b.value;
    if (gross > b.value) gross = b.value;
    const tax = Math.round(gross * gainRatio * rate);
    const costOut = Math.round((b.cost * gross) / b.value);
    b.value -= gross;
    b.cost = b.value === 0 ? 0 : Math.max(0, b.cost - costOut);
    return { key: b.key, name: b.name, group: b.group, priority: b.priority, taxKind: b.taxKind, gross, tax, net: gross - tax };
  }

  /** 月ごとの結果を、暦の年ごとにまとめる(最初と最後の年は一部の月だけのことがある) */
  function toYears(months) {
    const out = [];
    let cur = null;
    for (const m of months) {
      const year = Number(m.ym.slice(0, 4));
      if (!cur || cur.year !== year) {
        cur = { year, fromYM: m.ym, toYM: m.ym, count: 0, income: 0, living: 0, loans: 0, saving: 0, yearly: 0, oneTime: 0, expense: 0, flow: 0, drawGross: 0, drawTax: 0, drawNet: 0, sales: [], shortYM: null, belowYM: null };
        out.push(cur);
      }
      cur.count++;
      cur.toYM = m.ym;
      for (const k of ['income', 'living', 'loans', 'saving', 'yearly', 'oneTime', 'expense', 'flow', 'drawGross', 'drawTax', 'drawNet']) cur[k] += m[k];
      for (const s of m.sales) {
        const ex = cur.sales.find((x) => x.key === s.key);
        if (ex) {
          ex.gross += s.gross;
          ex.tax += s.tax;
          ex.net += s.net;
        } else cur.sales.push({ ...s });
      }
      if (m.short && !cur.shortYM) cur.shortYM = m.ym;
      if (m.below && !cur.belowYM) cur.belowYM = m.ym;
      cur.age = m.age;
      cur.cash = m.cash;
      cur.invest = m.invest;
      cur.total = m.total;
    }
    return out;
  }

  function summaryOf(months) {
    const last = months[months.length - 1];
    const firstShort = months.find((m) => m.short);
    const firstBelow = months.find((m) => m.below);
    return {
      firstShortYM: firstShort ? firstShort.ym : null,
      firstBelowYM: firstBelow ? firstBelow.ym : null,
      endYM: last ? last.ym : null,
      endTotal: last ? last.total : 0,
      endCash: last ? last.cash : 0,
      endInvest: last ? last.invest : 0,
      drawNet: months.reduce((t, m) => t + m.drawNet, 0),
    };
  }

  /** 3 つの利回りのパターンを同時に計算する */
  function simulateAll(plan) {
    const out = {};
    for (const p of PATTERNS) out[p.id] = { pattern: p, rate: plan.returns[p.id], ...simulate(plan, plan.returns[p.id]) };
    return out;
  }

  /**
   * 取り崩し案:その年に、どの資産をいくら売るか(売る順)。提案だけで、売却は記録しない
   * @returns {{ year, sales: object[], gross, tax, net } | null}
   */
  function drawdownPlan(result, year) {
    const y = result.years.find((x) => x.year === year);
    if (!y) return null;
    return { year, sales: y.sales, gross: y.drawGross, tax: y.drawTax, net: y.drawNet };
  }

  /**
   * 最初の 12 か月(期間が短ければその月数)の月平均の内訳。予想がマイナスになる理由を見るために使う
   * 積立は現金から投資へ移すだけなので、「積立を除いた差し引き」も出す
   */
  function firstYear(plan) {
    const ms = simulate(plan, plan.returns.mid).months.slice(0, 12);
    const n = ms.length || 1;
    const avg = (f) => Math.round(ms.reduce((t, m) => t + f(m), 0) / n);
    const income = {
      work: avg((m) => m.incomeParts.work),
      sidejob: avg((m) => m.incomeParts.sidejob),
      repay: avg((m) => m.incomeParts.repay),
      extra: avg((m) => m.incomeParts.extra),
    };
    const expense = { living: avg((m) => m.living), loans: avg((m) => m.loans), yearly: avg((m) => m.yearly), oneTime: avg((m) => m.oneTime), saving: avg((m) => m.saving) };
    const incomeTotal = income.work + income.sidejob + income.repay + income.extra;
    const expenseTotal = expense.living + expense.loans + expense.yearly + expense.oneTime + expense.saving;
    return {
      months: ms.length,
      fromYM: ms.length ? ms[0].ym : plan.startYM,
      toYM: ms.length ? ms[ms.length - 1].ym : plan.startYM,
      income,
      expense,
      incomeTotal,
      expenseTotal,
      net: incomeTotal - expenseTotal, // 現金の増減(月平均)
      netExSaving: incomeTotal - expenseTotal + expense.saving, // 積立を除いた差し引き(総資産の増減に近い)
      cashEnd: ms.length ? ms[ms.length - 1].cash : plan.cash,
      totalEnd: ms.length ? ms[ms.length - 1].total : plan.cash,
      totalStart: plan.cash + plan.assets.reduce((t, a) => t + a.value, 0),
    };
  }

  /** 気をつけること(画面に出す) */
  function warnings(plan) {
    const out = [];
    // 収入の入れ忘れ・生活費の入れすぎで、すぐにマイナスになっていないか
    if (!plan.incomes.length) {
      out.push('給与・年金などの「収入」が入っていません。そのため、すぐにマイナスになる計算になっています。「条件」の「収入」で手取りの月額を入れるか、「記録から足す」を押してください。');
    } else {
      const fy = firstYear(plan);
      if (fy.netExSaving < 0) {
        out.push(`最初の1年は、毎月の収入より支出が多い計算です(積立を除いて月平均 ${U.yen(-fy.netExSaving)}円の赤字)。収入の入れ忘れや、生活費・毎年の費用の初期値が多すぎないかを、「予想」の「最初の1年の内訳」で確かめてください。`);
      }
    }
    const usesAge = plan.incomes.some((r) => r.fromAge !== null || r.toAge !== null) || plan.living.changes.length > 0;
    if (!plan.birthYM && usesAge) out.push('生年月(または今の年齢)が未入力のため、年齢で決まる収入・生活費の変化が計算に入っていません。「条件」の「基本」で入れてください。');
    else if (!plan.birthYM) out.push('生年月(または今の年齢)を「条件」の「基本」で入れると、表に年齢が出て、「何歳から何歳まで」の収入や年金を入れられます。');
    const noEnd = plan.loans.filter((l) => !l.endYM);
    if (noEnd.length) out.push(`終了年月が未入力のローンがあります(${noEnd.map((l) => l.name).join('、')})。期間の終わりまで払う計算です。`);
    if (!plan.living.monthly) out.push('毎月の生活費が 0 円です。「生活費」で入れてください。');
    return out;
  }

  // ---- 最新の記録からの初期値 ----

  /** 現金の初期値:月末記録の最新月の「現金」区分の小計、または支払い管理の口座の現在残高の合計 */
  function cashFrom(d, source) {
    if (source === 'payments' && d.payments) {
      return { cash: d.payments.accounts.reduce((t, a) => t + (a.balance || 0), 0), cashSource: 'payments', note: '支払い管理の口座の現在残高の合計' };
    }
    const MM = MT.monthlyModel;
    const ym = d.monthly ? MM.latestMonth(d.monthly) : null;
    if (ym && d.monthly.categories.some((c) => c.id === 'cat_cash')) {
      return { cash: MM.categoryTotal(d.monthly, ym, 'cat_cash'), cashSource: 'monthly', note: `月末記録 ${U.ymLabel(ym)}末の「${d.monthly.categories.find((c) => c.id === 'cat_cash').name}」の小計` };
    }
    if (d.payments && d.payments.accounts.length) return cashFrom(d, 'payments');
    return { cash: 0, cashSource: 'manual', note: '記録がないため 0 円' };
  }

  /** 投資資産の初期値:資産管理の保有・手入力と、ポケカ在庫(売却優先度と取得額を引き継ぐ) */
  function assetsFrom(d) {
    const out = [];
    let missing = 0;
    if (d.assets) {
      const A = MT.assetsModel;
      for (const r of A.rows(d.assets)) {
        if (r.source === 'holding') {
          if (r.missing) {
            missing++;
            continue;
          }
          out.push({ name: `${r.broker}・${r.name}`, group: 'securities', value: r.value, cost: r.cost, taxKind: A.isTaxable(r.account) ? 'taxable' : 'nisa', priority: r.priority, grows: true, sourceKey: `h:${r.id}` });
        } else {
          const m = d.assets.manual.find((x) => x.id === r.id);
          out.push({ name: r.name, group: 'manual', value: r.value, cost: r.cost, taxKind: m && m.category === 'invest' ? 'taxable' : 'none', priority: r.priority, grows: false, sourceKey: `m:${r.id}` });
        }
      }
    }
    if (d.inventory) {
      const I = MT.inventoryModel;
      for (const it of d.inventory.items) {
        if (!(it.quantity > 0)) continue;
        const v = I.valuation(it);
        out.push({ name: `ポケカ・${it.name}`, group: 'inventory', value: v.value, cost: v.held, taxKind: 'none', priority: it.priority, grows: false, sourceKey: `i:${it.id}` });
      }
    }
    return { assets: out.map(cleanAsset), missing };
  }

  /** 生活費の初期値:支払い管理の履歴の直近 3 か月の、固定費 + 変動費の平均(ローン・投資・特別支出を除く) */
  function livingFrom(d) {
    const p = d.payments;
    if (!p) return { monthly: 0, note: '支払い管理の記録がありません' };
    const hist = p.history.slice(-3);
    if (hist.length) {
      const avg = Math.round(hist.reduce((t, h) => t + (h.catTotals.fixed || 0) + (h.catTotals.variable || 0), 0) / hist.length);
      return { monthly: avg, note: `支払いの履歴 ${hist.map((h) => U.ymLabel(h.month)).join('・')} の固定費 + 変動費の平均(ローン・投資・特別支出を除く)` };
    }
    const t = MT.paymentsModel.totals(p, p.month);
    return { monthly: t.byCategory.fixed.total + t.byCategory.variable.total, note: `履歴がないため、${U.ymLabel(p.month)}の固定費 + 変動費` };
  }

  /** 支払いの明細行のうち、カテゴリが cat のもの(終了月つき) */
  function paymentLines(d, cat) {
    const p = d.payments;
    if (!p) return [];
    const P = MT.paymentsModel;
    return P.lines(p, p.month)
      .filter((l) => l.source === 'bill' && l.category === cat && l.amount > 0)
      .map((l) => {
        const bill = p.bills.find((b) => b.id === l.id);
        const sub = l.subId && bill ? bill.subItems.find((s) => s.id === l.subId) : null;
        return { name: l.name, monthly: l.amount, endYM: (sub && sub.endMonth) || (bill && bill.endMonth) || null, sourceKey: l.subId ? `sub:${l.id}:${l.subId}` : `bill:${l.id}` };
      });
  }

  /** ローン:支払い管理のカテゴリ「ローン」の支払い(終了月の無いものは、終了年月が未入力のまま入れる) */
  function loansFrom(d) {
    return paymentLines(d, 'loan').map((l) => cleanLoan({ ...l, startYM: null }));
  }

  /** 積立投資:支払い管理のカテゴリ「投資」の支払い */
  function savingsFrom(d) {
    return paymentLines(d, 'investment').map((l) => cleanSaving({ ...l, startYM: null, taxKind: 'taxable', priority: 'ifNeeded' }));
  }

  /** 毎年の費用:支払い管理の特別支出(今月以降の未済)を、その月に毎年かかるものとして */
  function yearlyFrom(d) {
    const p = d.payments;
    if (!p) return [];
    return p.specials
      .filter((s) => !s.done && s.month >= p.month && s.amount)
      .map((s) => {
        const { y, m } = U.splitYM(s.month);
        return cleanYearly({ name: s.name, amount: s.amount, month: m, fromYear: y, toYear: null, interval: 1, enabled: true, sourceKey: `sp:${s.id}` });
      });
  }

  /**
   * 収入の初期値:支払い管理の入金予定のうち、副業から自動で入るもの以外で、
   *  - 「毎月固定」で金額があるもの → その金額
   *  - それ以外(「変動」で月替わりに空欄になったものなど)でも、履歴の直近 3 か月に毎月同じ名前で入っているもの → その平均
   */
  function incomesFrom(d) {
    const p = d.payments;
    if (!p) return [];
    const auto = new Set(d.sidejob ? d.sidejob.clients.map((c) => c.payment.incomeId).filter(Boolean) : []);
    const hist = p.history.slice(-3);
    const fromHistory = (name) => {
      if (!hist.length) return 0;
      const vals = hist.map((h) => h.incomeDetails.filter((x) => x.name === name).reduce((t, x) => t + x.amount, 0));
      return vals.every((v) => v > 0) ? Math.round(vals.reduce((t, v) => t + v, 0) / vals.length) : 0;
    };
    const out = [];
    for (const i of p.incomes) {
      if (auto.has(i.id)) continue;
      const monthly = i.fixed && i.amount ? i.amount : fromHistory(i.name);
      if (monthly > 0) out.push(cleanIncome({ name: i.name, fromAge: null, toAge: null, monthly }));
    }
    return out;
  }

  /** 家族などからの返済の候補:入金予定のうち、副業から自動で入るもの以外 */
  function repaymentCandidates(d) {
    const p = d.payments;
    if (!p) return [];
    const auto = new Set(d.sidejob ? d.sidejob.clients.map((c) => c.payment.incomeId).filter(Boolean) : []);
    return p.incomes.filter((i) => !auto.has(i.id)).map((i) => ({ id: i.id, name: i.name, monthly: i.amount || 0 }));
  }

  /** 副業収入の初期値:直近 6 か月(今月を除く)のうち、記録のある月の平均 */
  function sidejobFrom(d, now = new Date()) {
    const sj = d.sidejob;
    if (!sj || !sj.clients.length) return { monthly: 0, note: '副業の記録がありません' };
    const S = MT.sidejobModel;
    const cur = U.currentYM(now);
    const used = [];
    let sum = 0;
    for (let i = 6; i >= 1; i--) {
      const ym = U.ymAdd(cur, -i);
      const s = S.monthSummary(sj, ym);
      if (s.count) {
        used.push(ym);
        sum += s.total;
      }
    }
    if (!used.length) return { monthly: 0, note: '直近 6 か月の記録がありません' };
    return { monthly: Math.round(sum / used.length), note: `${used.map((ym) => U.monthLabel(ym)).join('・')}の平均(記録のある月だけ)` };
  }

  /** 今の資産(現金と投資)を最新の記録から読み直す(計算の開始年月も今月にする) */
  function reloadStart(plan, d, now = new Date()) {
    const c = cashFrom(d, plan.cashSource === 'payments' ? 'payments' : 'monthly');
    const a = assetsFrom(d);
    plan.startYM = U.currentYM(now);
    plan.cash = c.cash;
    plan.cashSource = c.cashSource;
    plan.assets = a.assets;
    plan.loadedAt = U.todayStr(now);
    return { cashNote: c.note, missing: a.missing, count: a.assets.length };
  }

  /** 最新の記録から新しいプランを作る */
  function newPlan(d, now = new Date(), name = 'プラン') {
    const plan = cleanPlan({ name }, now);
    reloadStart(plan, d, now);
    plan.incomes = incomesFrom(d);
    plan.sidejob = { monthly: sidejobFrom(d, now).monthly, untilYM: null };
    plan.living = { monthly: livingFrom(d).monthly, changes: [] };
    plan.loans = loansFrom(d);
    plan.savings = savingsFrom(d);
    plan.yearly = yearlyFrom(d);
    plan.tax.taxable = d.assets ? num(d.assets.settings.taxRate * 100, 0, 100, DEFAULTS.tax.taxable) : DEFAULTS.tax.taxable;
    return plan;
  }

  /** 生活防衛資金の今の額 */
  function reserveNow(plan) {
    return plan.reserve.amount !== null ? plan.reserve.amount : Math.round(plan.reserve.months * livingAt(plan, ageAt(plan, plan.startYM)));
  }

  // ---- 計算の確認(架空のデータ。画面の「計算の確認」とテストで使う) ----

  function basePlan(patch) {
    return cleanPlan({ name: '確認用', startYM: '2030-01', birthYM: '1990-01', years: 2, returns: { low: 0, mid: 0, high: 0 }, reserve: { months: 0, amount: 0 }, ...patch });
  }

  function checks() {
    const out = [];

    // 1. ローンの終了月の前後
    {
      const plan = basePlan({ cash: 1000000, loans: [{ name: 'ローンX', monthly: 50000, endYM: '2030-03' }] });
      const r = simulate(plan, 0);
      const [m2, m3, m4] = [r.months[1], r.months[2], r.months[3]];
      out.push({
        id: 'loan',
        title: 'ローンの終了月の前後',
        setup: '現金 1,000,000円、ローン 月 50,000円(終了 2030年3月)、ほかの収支なし、利回り 0%',
        rows: [
          ['2030年2月のローン', '50,000', m2.loans],
          ['2030年3月(終了月)のローン', '50,000', m3.loans],
          ['2030年4月(翌月)のローン', '0', m4.loans],
          ['2030年3月末の現金', '850,000', m3.cash],
          ['2030年4月末の現金(変わらない)', '850,000', m4.cash],
        ],
        ok: m2.loans === 50000 && m3.loans === 50000 && m4.loans === 0 && m3.cash === 850000 && m4.cash === 850000,
      });
    }

    // 2. 取り崩しの順番
    {
      const plan = basePlan({
        cash: 0,
        reserve: { months: 0, amount: 100000 },
        living: { monthly: 50000, changes: [] },
        assets: [
          { name: '資産C(売りたくない)', group: 'other', value: 1000000, cost: 1000000, taxKind: 'none', priority: 'keep', grows: false },
          { name: '資産B(足りなければ売る)', group: 'other', value: 1000000, cost: 1000000, taxKind: 'none', priority: 'ifNeeded', grows: false },
          { name: '資産A(最初に売る)', group: 'other', value: 120000, cost: 120000, taxKind: 'none', priority: 'first', grows: false },
        ],
        years: 1,
      });
      const r = simulate(plan, 0);
      const m = r.months[0];
      const names = m.sales.map((s) => s.name);
      const keep = r.buckets.find((b) => b.name.startsWith('資産C'));
      out.push({
        id: 'order',
        title: '取り崩しの順番',
        setup: '現金 0円、生活費 月 50,000円、生活防衛資金 100,000円。資産A(最初に売る)120,000円、資産B(足りなければ売る)・資産C(売りたくない)各 1,000,000円、税なし',
        rows: [
          ['1か月目に売る順', '資産A → 資産B', names.map((n) => n.replace(/\(.*\)$/, '')).join(' → ')],
          ['資産A を売る額', '120,000', m.sales[0] ? m.sales[0].gross : 0],
          ['資産B を売る額', '30,000', m.sales[1] ? m.sales[1].gross : 0],
          ['資産C(売りたくない)の残り', '1,000,000', keep.value],
          ['1か月目の末の現金', '100,000', m.cash],
        ],
        ok: names.length === 2 && names[0].startsWith('資産A') && names[1].startsWith('資産B') && m.sales[0].gross === 120000 && m.sales[1].gross === 30000 && keep.value === 1000000 && m.cash === 100000,
      });
    }

    // 3. NISA と課税口座の税率の違い
    {
      const mk = (taxKind) =>
        simulate(
          basePlan({
            cash: 0,
            reserve: { months: 0, amount: 100000 },
            years: 1,
            assets: [{ name: '資産', group: 'securities', value: 1000000, cost: 500000, taxKind, priority: 'first', grows: false }],
          }),
          0
        ).months[0].sales[0];
      const tx = mk('taxable');
      const ns = mk('nisa');
      out.push({
        id: 'tax',
        title: 'NISA と課税口座の税率の違い',
        setup: '評価額 1,000,000円・取得額 500,000円(含み益の割合 50%)の資産から、手取り 100,000円を取り崩す。課税口座は 20.315%、NISA は 0%',
        rows: [
          ['課税口座:売る額(100,000 ÷(1 − 0.5 × 0.20315)を切り上げ)', '111,306', tx.gross],
          ['課税口座:税金', '11,306', tx.tax],
          ['課税口座:手取り', '100,000', tx.net],
          ['NISA:売る額', '100,000', ns.gross],
          ['NISA:税金', '0', ns.tax],
        ],
        ok: tx.gross === 111306 && tx.tax === 11306 && tx.net === 100000 && ns.gross === 100000 && ns.tax === 0,
      });
    }

    // 4. 利回り 0% のときは単純な足し引きと一致
    {
      const plan = basePlan({
        cash: 500000,
        years: 2,
        incomes: [{ name: '収入', monthly: 300000 }],
        extras: [{ name: '賞与', year: 2030, month: 6, amount: 400000, untilYear: 2031 }],
        living: { monthly: 200000, changes: [] },
        loans: [{ name: 'ローン', monthly: 30000, endYM: '2030-12' }],
        savings: [{ name: '積立', monthly: 20000 }],
        yearly: [{ name: '毎年の費用', amount: 50000, month: 4, fromYear: 2030 }],
        oneTime: [{ name: '単発の出費', ym: '2031-08', amount: 600000 }],
        assets: [{ name: '投資', group: 'securities', value: 1000000, cost: 800000, taxKind: 'taxable', priority: 'first', grows: true }],
      });
      const r = simulate(plan, 0);
      const last = r.months[r.months.length - 1];
      // 単純な足し引き(24か月)
      const cash = 500000 + 300000 * 24 + 400000 * 2 - 200000 * 24 - 30000 * 12 - 20000 * 24 - 50000 * 2 - 600000;
      const invest = 1000000 + 20000 * 24;
      out.push({
        id: 'zero',
        title: '利回り 0% のときは単純な足し引きと一致',
        setup: '2030年1月から 24か月。現金 500,000円、収入 月 300,000円、賞与 毎年6月 400,000円、生活費 月 200,000円、ローン 月 30,000円(2030年12月まで)、積立 月 20,000円、毎年4月 50,000円、2031年8月に 600,000円、投資 1,000,000円、利回り 0%',
        rows: [
          ['期間の終わりの現金', U.yen(cash), last.cash],
          ['期間の終わりの投資', U.yen(invest), last.invest],
          ['期間の終わりの総資産', U.yen(cash + invest), last.total],
          ['取り崩し', '0', r.summary.drawNet],
        ],
        ok: last.cash === cash && last.invest === invest && last.total === cash + invest && r.summary.drawNet === 0,
      });
    }
    return out;
  }

  // ---- v7 → v8 ----
  // 将来予想(future)の区画を足す。中身は読み込み時の点検(normalize)で空の状態から作られる

  if (MT.store) {
    MT.store.defineSection('future', { create, normalize, finalize, hasContent, summarize });
    MT.store.addMigration(7, (d) => {
      d.schemaVersion = 8;
      return d;
    });
  }

  MT.futureModel = {
    PATTERNS,
    PRIORITIES,
    TAX_KINDS,
    GROUPS,
    CASH_SOURCES,
    DEFAULTS,
    MAX_PLANS,
    NAME_MAX,
    label,
    create,
    normalize,
    cleanPlan,
    findPlan,
    activePlan,
    addPlan,
    duplicatePlan,
    renamePlan,
    removePlan,
    rowsOf,
    saveRow,
    removeRow,
    toggleRow,
    updatePlan,
    ageAt,
    birthFromAge,
    livingAt,
    endYM,
    monthlyRate,
    simulate,
    simulateAll,
    drawdownPlan,
    warnings,
    reserveNow,
    cashFrom,
    assetsFrom,
    livingFrom,
    loansFrom,
    savingsFrom,
    yearlyFrom,
    incomesFrom,
    repaymentCandidates,
    sidejobFrom,
    reloadStart,
    newPlan,
    firstYear,
    checks,
  };
})(typeof window !== 'undefined' ? window : globalThis);
