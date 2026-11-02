/*
 * 支払い管理:データの形と計算・操作(画面には触らない)
 *
 * payments = {
 *   month: "YYYY-MM",        // いま管理している月。月が変わると締めて履歴に保存する
 *   accounts: [{ itemId, kind: "bank"|"cash", balance, balanceDate }],
 *       // 口座 = 月末記録の項目(monthly.items)。名前は項目のものを使う(二重入力しない)
 *       // balance は「現在残高」(円の整数 or null)。月末記録へは反映ボタンで写す
 *   bills: [{ id, name, amount, dueDay, accountId, category, endMonth, memo, done,
 *             subItems: [{ id, name, amount, category, endMonth, memo }] }],
 *       // 支払い・ローン。amount=請求額(null は未入力)、dueDay=引き落とし日(1〜31)
 *       // category: loan / fixed / variable / investment、endMonth を過ぎると非表示
 *   incomes: [{ id, name, amount, fixed, targetId, done, memo }],   // 入金予定。targetId=優先振込先
 *   specials: [{ id, name, amount, month, accountId, done, memo }], // 特別支出(支払月 month)
 *   allocation: { mode: "auto"|"manual", items: [{ incomeId, accountId, amount }] },
 *       // 振り分け。auto のときは毎回計算し直す。手で直すと manual になる
 *   history: [{ month, income, payment, balance, catTotals, details, incomeDetails }],
 *   notice: { type: "rollover", month } | null,   // 月替わりの案内
 *   memo: ""
 * }
 *
 * 合計の整合:カテゴリ別・未済・口座ごとの引き落としは、すべて lines()(明細行の一覧)から計算する。
 */
(function (root) {
  'use strict';
  const MT = (root.MT = root.MT || {});
  const U = MT.util;
  const MM = MT.monthlyModel;

  const CATEGORIES = [
    { id: 'loan', label: 'ローン' },
    { id: 'fixed', label: '固定費' },
    { id: 'variable', label: '変動費' },
    { id: 'investment', label: '投資' },
  ];
  const SPECIAL = { id: 'special', label: '特別支出' };
  const TOTAL_CATEGORIES = [...CATEGORIES, SPECIAL]; // 合計表の行
  const CAT_IDS = new Set(CATEGORIES.map((c) => c.id));
  const KINDS = [
    { id: 'bank', label: '銀行口座' },
    { id: 'cash', label: '手元現金' },
  ];

  const NAME_MAX = 40;
  const MEMO_MAX = 1000;
  const ALLOCATION_UNIT = 1000; // 不足額はこの単位で切り上げ
  const SAVING_UNIT = 100; // 月あたり積立額はこの単位で切り上げ

  function categoryLabel(id) {
    const c = TOTAL_CATEGORIES.find((x) => x.id === id);
    return c ? c.label : id;
  }

  function create(now = new Date()) {
    return {
      month: U.currentYM(now),
      accounts: [],
      bills: [],
      incomes: [],
      specials: [],
      allocation: { mode: 'auto', items: [] },
      history: [],
      notice: null,
      memo: '',
    };
  }

  // ---- 値の点検 ----

  const cleanText = (s, max = NAME_MAX) =>
    String(s == null ? '' : s)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max);
  const cleanMemo = (s) => String(s == null ? '' : s).slice(0, MEMO_MAX);
  const cleanAmount = (v) => (U.isYenValue(v) ? v : null);
  const cleanDay = (v) => (Number.isInteger(v) && v >= 1 && v <= 31 ? v : null);
  const cleanYM = (v) => (U.isYM(v) ? v : null);
  const cleanCategory = (c) => (CAT_IDS.has(c) ? c : 'variable');
  const cleanId = (v, prefix) => (typeof v === 'string' && v ? v.slice(0, 64) : U.uid(prefix));
  const sum = (arr, f) => arr.reduce((s, x) => s + (f(x) || 0), 0);

  function cleanSub(s) {
    return {
      id: cleanId(s && s.id, 'sub'),
      name: cleanText(s && s.name) || '内訳',
      amount: cleanAmount(s && s.amount),
      category: cleanCategory(s && s.category),
      endMonth: cleanYM(s && s.endMonth),
      memo: cleanMemo(s && s.memo),
    };
  }

  function cleanBill(b) {
    return {
      id: cleanId(b.id, 'bill'),
      name: cleanText(b.name) || '支払い',
      amount: cleanAmount(b.amount),
      dueDay: cleanDay(b.dueDay),
      accountId: typeof b.accountId === 'string' && b.accountId ? b.accountId : null,
      category: cleanCategory(b.category),
      endMonth: cleanYM(b.endMonth),
      memo: cleanMemo(b.memo),
      done: b.done === true,
      subItems: (Array.isArray(b.subItems) ? b.subItems : []).filter(Boolean).map(cleanSub),
    };
  }

  function cleanIncome(i) {
    return {
      id: cleanId(i.id, 'inc'),
      name: cleanText(i.name) || '入金',
      amount: cleanAmount(i.amount),
      fixed: i.fixed !== false,
      targetId: typeof i.targetId === 'string' && i.targetId ? i.targetId : null,
      done: i.done === true,
      memo: cleanMemo(i.memo),
    };
  }

  function cleanSpecial(s) {
    return {
      id: cleanId(s.id, 'sp'),
      name: cleanText(s.name) || '特別支出',
      amount: cleanAmount(s.amount),
      month: cleanYM(s.month) || U.currentYM(),
      accountId: typeof s.accountId === 'string' && s.accountId ? s.accountId : null,
      done: s.done === true,
      memo: cleanMemo(s.memo),
    };
  }

  function cleanHistory(h) {
    const catTotals = {};
    const ct = h.catTotals && typeof h.catTotals === 'object' ? h.catTotals : {};
    for (const c of TOTAL_CATEGORIES) catTotals[c.id] = cleanAmount(ct[c.id]) || 0;
    const items = (arr, withCat) =>
      (Array.isArray(arr) ? arr : [])
        .filter((x) => x && typeof x === 'object')
        .map((x) => {
          const o = { name: cleanText(x.name) || '—', amount: cleanAmount(x.amount) || 0 };
          if (withCat) o.category = TOTAL_CATEGORIES.some((c) => c.id === x.category) ? x.category : 'variable';
          return o;
        });
    return {
      month: h.month,
      income: cleanAmount(h.income) || 0,
      payment: cleanAmount(h.payment) || 0,
      balance: cleanAmount(h.balance),
      catTotals,
      details: items(h.details, true),
      incomeDetails: items(h.incomeDetails, false),
    };
  }

  function uniqueById(list) {
    const seen = new Set();
    return list.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
  }

  function normalize(raw) {
    const p = create();
    if (U.isYM(raw.month)) p.month = raw.month;
    const seenAcc = new Set();
    for (const a of Array.isArray(raw.accounts) ? raw.accounts : []) {
      if (!a || typeof a.itemId !== 'string' || seenAcc.has(a.itemId)) continue;
      seenAcc.add(a.itemId);
      p.accounts.push({
        itemId: a.itemId,
        kind: a.kind === 'cash' ? 'cash' : 'bank',
        balance: cleanAmount(a.balance),
        balanceDate: U.isDateStr(a.balanceDate) ? a.balanceDate : null,
      });
    }
    const list = (arr) => (Array.isArray(arr) ? arr : []).filter((x) => x && typeof x === 'object');
    p.bills = uniqueById(list(raw.bills).map(cleanBill));
    p.incomes = uniqueById(list(raw.incomes).map(cleanIncome));
    p.specials = uniqueById(list(raw.specials).map(cleanSpecial));
    const alloc = raw.allocation && typeof raw.allocation === 'object' ? raw.allocation : {};
    p.allocation = {
      mode: alloc.mode === 'manual' ? 'manual' : 'auto',
      items: list(alloc.items)
        .filter((x) => typeof x.incomeId === 'string' && typeof x.accountId === 'string' && U.isYenValue(x.amount) && x.amount > 0)
        .map((x) => ({ incomeId: x.incomeId, accountId: x.accountId, amount: x.amount })),
    };
    const hist = new Map();
    for (const h of list(raw.history)) if (U.isYM(h.month)) hist.set(h.month, cleanHistory(h));
    p.history = [...hist.values()].sort((a, b) => (a.month < b.month ? -1 : 1));
    p.notice = raw.notice && raw.notice.type === 'rollover' && U.isYM(raw.notice.month) ? { type: 'rollover', month: raw.notice.month } : null;
    p.memo = cleanMemo(raw.memo);
    return p;
  }

  /** 月末記録の項目がなくなった口座や、外れた口座への参照を取り除く */
  function finalize(d) {
    const p = d.payments;
    if (!p || !d.monthly) return;
    const itemIds = new Set(d.monthly.items.map((it) => it.id));
    p.accounts = p.accounts.filter((a) => itemIds.has(a.itemId));
    const accIds = new Set(p.accounts.map((a) => a.itemId));
    for (const b of p.bills) if (b.accountId && !accIds.has(b.accountId)) b.accountId = null;
    for (const i of p.incomes) if (i.targetId && !accIds.has(i.targetId)) i.targetId = null;
    for (const s of p.specials) if (s.accountId && !accIds.has(s.accountId)) s.accountId = null;
    const incIds = new Set(p.incomes.map((i) => i.id));
    p.allocation.items = p.allocation.items.filter((x) => accIds.has(x.accountId) && incIds.has(x.incomeId));
  }

  function hasContent(p) {
    return !!p && (p.bills.length > 0 || p.incomes.length > 0 || p.specials.length > 0 || p.history.length > 0);
  }

  function summarize(p) {
    return [`支払い管理:支払い ${p.bills.length}件・入金予定 ${p.incomes.length}件・特別支出 ${p.specials.length}件・履歴 ${p.history.length}か月分`];
  }

  // ---- 読み出し ----

  const isActive = (endMonth, ym) => !endMonth || endMonth >= ym;

  function findAccount(p, itemId) {
    return p.accounts.find((a) => a.itemId === itemId) || null;
  }

  /** 口座の名前(月末記録の項目名) */
  function accountName(d, itemId) {
    const it = d.monthly.items.find((x) => x.id === itemId);
    return it ? it.name : '(口座なし)';
  }

  function activeBills(p, ym) {
    return p.bills.filter((b) => isActive(b.endMonth, ym)).sort(byDueDay);
  }

  function endedBills(p, ym) {
    return p.bills.filter((b) => !isActive(b.endMonth, ym));
  }

  function byDueDay(a, b) {
    const x = a.dueDay == null ? 99 : a.dueDay;
    const y = b.dueDay == null ? 99 : b.dueDay;
    return x - y;
  }

  function activeSubs(bill, ym) {
    return bill.subItems.filter((s) => isActive(s.endMonth, ym));
  }

  function subTotal(bill, ym) {
    return sum(activeSubs(bill, ym), (s) => s.amount);
  }

  /** 支払い 1 件の金額。請求額が未入力なら内訳の合計 */
  function billTotal(bill, ym) {
    return bill.amount !== null ? bill.amount : subTotal(bill, ym);
  }

  /** 内訳の合計が請求額を超えているか */
  function isOverSub(bill, ym) {
    return bill.amount !== null && subTotal(bill, ym) > bill.amount;
  }

  function specialsFor(p, ym) {
    return p.specials.filter((s) => s.month === ym);
  }

  /**
   * その月のお金の明細行。合計はすべてここから計算する。
   * 内訳はそれぞれのカテゴリ、請求額の残り(請求額 − 内訳合計)は支払いのカテゴリに入る。
   * @returns {{source: 'bill'|'special', id, subId, name, category, amount, done, accountId}[]}
   */
  function lines(p, ym) {
    const out = [];
    for (const b of activeBills(p, ym)) {
      const subs = activeSubs(b, ym);
      let subSum = 0;
      for (const s of subs) {
        const amount = s.amount || 0;
        subSum += amount;
        out.push({ source: 'bill', id: b.id, subId: s.id, name: `${b.name}/${s.name}`, category: s.category, amount, done: b.done, accountId: b.accountId });
      }
      if (b.amount !== null && (b.amount - subSum !== 0 || !subs.length)) {
        out.push({ source: 'bill', id: b.id, subId: null, name: b.name, category: b.category, amount: b.amount - subSum, done: b.done, accountId: b.accountId });
      }
    }
    for (const s of specialsFor(p, ym)) {
      out.push({ source: 'special', id: s.id, subId: null, name: s.name, category: SPECIAL.id, amount: s.amount || 0, done: s.done, accountId: s.accountId });
    }
    return out;
  }

  /** カテゴリ別の合計と未済(すべて lines() から) */
  function totals(p, ym) {
    const byCategory = {};
    for (const c of TOTAL_CATEGORIES) byCategory[c.id] = { total: 0, unpaid: 0 };
    let total = 0;
    let unpaid = 0;
    for (const l of lines(p, ym)) {
      const cat = byCategory[l.category];
      cat.total += l.amount;
      total += l.amount;
      if (!l.done) {
        cat.unpaid += l.amount;
        unpaid += l.amount;
      }
    }
    return { byCategory, total, unpaid, paid: total - unpaid };
  }

  /** 口座ごとの引き落とし(未済・全部)。口座が未設定の分は unassigned */
  function withdrawals(p, ym) {
    const map = new Map(p.accounts.map((a) => [a.itemId, { unpaid: 0, all: 0 }]));
    const unassigned = { unpaid: 0, all: 0, count: 0 };
    for (const l of lines(p, ym)) {
      const w = map.get(l.accountId);
      const target = w || unassigned;
      target.all += l.amount;
      if (!l.done) target.unpaid += l.amount;
      if (!w && !l.done && l.amount !== 0) unassigned.count++;
    }
    return { map, unassigned };
  }

  function pendingIncomes(p) {
    return p.incomes.filter((i) => !i.done && i.amount !== null && i.amount > 0);
  }

  // ---- 自動振り分け ----

  /** 引き落としに対して足りない額(1,000 円単位で切り上げ) */
  function needs(p, ym) {
    const wd = withdrawals(p, ym).map;
    const need = new Map();
    for (const a of p.accounts) {
      const w = wd.get(a.itemId);
      need.set(a.itemId, U.roundUp(Math.max(0, w.unpaid - (a.balance || 0)), ALLOCATION_UNIT));
    }
    return need;
  }

  /**
   * 自動の提案。優先振込先のある入金を先に使い、不足する口座を順に埋める。
   * 優先振込先のある入金の残りは、その口座に入る(実際にそこへ振り込まれるため)。
   */
  function autoPlan(p, ym) {
    const need = needs(p, ym);
    const items = [];
    const add = (incomeId, accountId, amount) => {
      const ex = items.find((x) => x.incomeId === incomeId && x.accountId === accountId);
      if (ex) ex.amount += amount;
      else items.push({ incomeId, accountId, amount });
    };
    const sources = pendingIncomes(p);
    const hasTarget = (i) => i.targetId && need.has(i.targetId);
    const ordered = [...sources.filter(hasTarget), ...sources.filter((i) => !hasTarget(i))];
    for (const inc of ordered) {
      let rest = inc.amount;
      const give = (accountId, want) => {
        const amount = Math.min(rest, want);
        if (amount <= 0) return;
        add(inc.id, accountId, amount);
        rest -= amount;
        need.set(accountId, Math.max(0, need.get(accountId) - amount));
      };
      const target = hasTarget(inc) ? inc.targetId : null;
      if (target) give(target, need.get(target));
      for (const a of p.accounts) if (need.get(a.itemId) > 0) give(a.itemId, need.get(a.itemId));
      if (target && rest > 0) give(target, rest);
    }
    return items;
  }

  /** いま使う振り分け(自動なら計算、手動なら保存した内容) */
  function currentPlan(p, ym) {
    if (p.allocation.mode !== 'manual') return autoPlan(p, ym);
    const pending = new Set(pendingIncomes(p).map((i) => i.id));
    const accIds = new Set(p.accounts.map((a) => a.itemId));
    return p.allocation.items.filter((x) => pending.has(x.incomeId) && accIds.has(x.accountId) && x.amount > 0);
  }

  /** 振り分けの集計(口座ごと・入金ごと・余り・超過・振り分け後の不足) */
  function planSummary(p, ym) {
    const items = currentPlan(p, ym);
    const byAccount = new Map(p.accounts.map((a) => [a.itemId, 0]));
    const byIncome = new Map();
    for (const x of items) {
      byAccount.set(x.accountId, (byAccount.get(x.accountId) || 0) + x.amount);
      byIncome.set(x.incomeId, (byIncome.get(x.incomeId) || 0) + x.amount);
    }
    const unassigned = [];
    const over = [];
    for (const inc of pendingIncomes(p)) {
      const used = byIncome.get(inc.id) || 0;
      if (used < inc.amount) unassigned.push({ income: inc, rest: inc.amount - used });
      if (used > inc.amount) over.push({ income: inc, over: used - inc.amount });
    }
    return { mode: p.allocation.mode, items, byAccount, byIncome, unassigned, over, need: needs(p, ym) };
  }

  // ---- 口座・キャッシュフロー ----

  /** 口座ごとの表示行:現在残高、入金予定、引き落とし(未済)、引落後予想 */
  function accountRows(d, ym) {
    const p = d.payments;
    const wd = withdrawals(p, ym).map;
    const plan = planSummary(p, ym);
    return p.accounts.map((a) => {
      const w = wd.get(a.itemId);
      const incoming = plan.byAccount.get(a.itemId) || 0;
      const balance = a.balance || 0;
      return {
        itemId: a.itemId,
        name: accountName(d, a.itemId),
        kind: a.kind,
        balance: a.balance,
        balanceDate: a.balanceDate,
        incoming,
        withdraw: w.unpaid,
        withdrawAll: w.all,
        after: balance + incoming - w.unpaid,
        need: plan.need.get(a.itemId) || 0,
      };
    });
  }

  /** 今月のキャッシュフロー */
  function cashflow(p, ym) {
    const balances = sum(p.accounts, (a) => a.balance);
    const pendingIncome = sum(pendingIncomes(p), (i) => i.amount);
    const t = totals(p, ym);
    const secured = balances + pendingIncome;
    return { balances, pendingIncome, secured, remaining: t.unpaid, net: secured - t.unpaid, totals: t };
  }

  // ---- 特別支出 ----

  function specialGroups(p, ym) {
    const sorted = [...p.specials].sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
    return {
      current: sorted.filter((s) => s.month === ym),
      upcoming: sorted.filter((s) => s.month > ym),
      past: sorted.filter((s) => s.month < ym).reverse(),
    };
  }

  /** 月あたりの必要積立額:今後の(未済の)特別支出 ÷ 支払月までの月数(100 円単位で切り上げ) */
  function savingPlan(p, ym) {
    const rows = specialGroups(p, ym)
      .upcoming.filter((s) => !s.done && s.amount)
      .map((s) => {
        const months = U.ymDiff(s.month, ym);
        return { special: s, months, perMonth: U.roundUp(Math.ceil(s.amount / months), SAVING_UNIT) };
      });
    return { rows, total: sum(rows, (r) => r.perMonth) };
  }

  // ---- 注意すること ----

  function warnings(d, ym) {
    const p = d.payments;
    const bills = activeBills(p, ym);
    const rows = accountRows(d, ym);
    const plan = planSummary(p, ym);
    return {
      missingAmount: bills.filter((b) => b.amount === null && !b.done),
      overSub: bills.filter((b) => isOverSub(b, ym)),
      noAccount: bills.filter((b) => !b.done && !b.accountId && billTotal(b, ym) !== 0),
      shortAccounts: rows.filter((r) => r.after < 0),
      missingIncome: p.incomes.filter((i) => !i.done && i.amount === null),
      overAllocated: plan.over,
      pastSpecials: specialGroups(p, ym).past.filter((s) => !s.done),
    };
  }

  // ---- 書き換え(store.update の中で呼ぶ) ----

  /** 口座として使う(月末記録の最新の値を、現在残高の初期値にする) */
  function linkAccount(d, itemId, kind = 'bank') {
    const p = d.payments;
    if (findAccount(p, itemId) || !MM.findItem(d.monthly, itemId)) return false;
    let balance = null;
    for (const ym of MM.months(d.monthly).reverse()) {
      const v = MM.getValue(d.monthly, ym, itemId);
      if (v !== null) {
        balance = v;
        break;
      }
    }
    p.accounts.push({ itemId, kind: kind === 'cash' ? 'cash' : 'bank', balance, balanceDate: null });
    return true;
  }

  /** 口座から外す(月末記録の項目は残る)。この口座を指していた支払い・入金は「口座なし」になる */
  function unlinkAccount(d, itemId) {
    d.payments.accounts = d.payments.accounts.filter((a) => a.itemId !== itemId);
    finalize(d);
  }

  /** 新しい口座を作る:月末記録に項目を足してから、口座としてつなぐ */
  function createAccount(d, categoryId, name, kind) {
    const it = MM.addItem(d.monthly, categoryId, name);
    linkAccount(d, it.id, kind);
    return it;
  }

  function moveAccount(p, itemId, dir) {
    const i = p.accounts.findIndex((a) => a.itemId === itemId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= p.accounts.length) return false;
    [p.accounts[i], p.accounts[j]] = [p.accounts[j], p.accounts[i]];
    return true;
  }

  function setAccountKind(p, itemId, kind) {
    const a = findAccount(p, itemId);
    if (a) a.kind = kind === 'cash' ? 'cash' : 'bank';
  }

  function setBalance(p, itemId, value, today) {
    const a = findAccount(p, itemId);
    if (!a) return;
    a.balance = cleanAmount(value);
    a.balanceDate = today;
  }

  function upsert(list, item) {
    const i = list.findIndex((x) => x.id === item.id);
    if (i >= 0) list[i] = item;
    else list.push(item);
    return item.id;
  }

  function saveBill(p, draft) {
    return upsert(p.bills, cleanBill(draft));
  }
  function saveIncome(p, draft) {
    return upsert(p.incomes, cleanIncome(draft));
  }
  function saveSpecial(p, draft) {
    return upsert(p.specials, cleanSpecial(draft));
  }

  function removeById(p, key, id) {
    p[key] = p[key].filter((x) => x.id !== id);
    if (key === 'incomes') p.allocation.items = p.allocation.items.filter((x) => x.incomeId !== id);
  }

  function toggleDone(p, key, id) {
    const x = p[key].find((v) => v.id === id);
    if (x) x.done = !x.done;
    return x ? x.done : false;
  }

  /** 振り分けを手で直す(自動のときは、いまの提案を写してから手動にする)。0 か null で削除 */
  function setAllocation(p, ym, incomeId, accountId, amount) {
    if (p.allocation.mode !== 'manual') {
      p.allocation = { mode: 'manual', items: autoPlan(p, ym).map((x) => ({ ...x })) };
    }
    const items = p.allocation.items.filter((x) => !(x.incomeId === incomeId && x.accountId === accountId));
    if (U.isYenValue(amount) && amount > 0) items.push({ incomeId, accountId, amount });
    p.allocation.items = items;
  }

  function resetAllocation(p) {
    p.allocation = { mode: 'auto', items: [] };
  }

  /** 月末記録の該当月に、口座の現在残高を写す(月が無ければ作る) */
  function reflectPreview(d, ym) {
    return d.payments.accounts
      .filter((a) => a.balance !== null && MM.findItem(d.monthly, a.itemId))
      .map((a) => ({ itemId: a.itemId, name: accountName(d, a.itemId), from: MM.getValue(d.monthly, ym, a.itemId), to: a.balance }));
  }

  function reflectToMonthly(d, ym, today) {
    const rows = reflectPreview(d, ym);
    if (!d.monthly.records[ym]) MM.addMonth(d.monthly, ym, { copy: true });
    for (const r of rows) MM.setValue(d.monthly, ym, r.itemId, r.to, today);
    if (d.payments.notice && d.payments.notice.month === ym) d.payments.notice = null;
    return rows.length;
  }

  // ---- 月替わり ----

  /** その月の状態を履歴の形にする */
  function snapshot(p, ym) {
    const t = totals(p, ym);
    const catTotals = {};
    for (const c of TOTAL_CATEGORIES) catTotals[c.id] = t.byCategory[c.id].total;
    const details = activeBills(p, ym)
      .map((b) => ({ name: b.name, amount: billTotal(b, ym), category: b.category }))
      .concat(specialsFor(p, ym).map((s) => ({ name: s.name, amount: s.amount || 0, category: SPECIAL.id })));
    const incomeDetails = p.incomes.map((i) => ({ name: i.name, amount: i.amount || 0 }));
    return {
      month: ym,
      income: sum(incomeDetails, (x) => x.amount),
      payment: t.total,
      balance: sum(p.accounts, (a) => a.balance),
      catTotals,
      details,
      incomeDetails,
    };
  }

  /**
   * 月が変わっていたら締める:前月の状態を履歴に保存し、「済」を外し、変動の金額を空にする。
   * @returns {{month: string, to: string} | null} 締めた月(締めなかったら null)
   */
  function rollover(d, now = new Date()) {
    const p = d.payments;
    const cur = U.currentYM(now);
    if (!U.isYM(p.month)) {
      p.month = cur;
      return null;
    }
    if (p.month >= cur) return null;
    const ym = p.month;
    const entry = snapshot(p, ym);
    p.history = p.history.filter((h) => h.month !== ym).concat(entry).sort((a, b) => (a.month < b.month ? -1 : 1));
    for (const b of p.bills) {
      b.done = false;
      if (b.category === 'variable') b.amount = null;
      for (const s of b.subItems) if (s.category === 'variable') s.amount = null;
    }
    for (const i of p.incomes) {
      i.done = false;
      if (!i.fixed) i.amount = null;
    }
    p.allocation = { mode: 'auto', items: [] };
    p.notice = { type: 'rollover', month: ym };
    p.month = cur;
    return { month: ym, to: cur };
  }

  function deleteHistory(p, month) {
    p.history = p.history.filter((h) => h.month !== month);
  }

  // ---- v1 → v2:段階1のデータに支払い管理を足す ----

  /** 段階1の「現金(銀行口座)」区分の項目を、口座として最初からつないでおく */
  function initialFromMonthly(monthly, now = new Date()) {
    const p = create(now);
    if (!monthly || !Array.isArray(monthly.items)) return p;
    const records = monthly.records && typeof monthly.records === 'object' ? monthly.records : {};
    const months = Object.keys(records).filter(U.isYM).sort().reverse();
    for (const it of monthly.items) {
      if (!it || typeof it.id !== 'string' || it.categoryId !== 'cat_cash') continue;
      let balance = null;
      for (const ym of months) {
        const v = records[ym] && records[ym].values ? records[ym].values[it.id] : undefined;
        if (U.isYenValue(v)) {
          balance = v;
          break;
        }
      }
      const kind = /現金|財布|手元/.test(String(it.name || '')) ? 'cash' : 'bank';
      p.accounts.push({ itemId: it.id, kind, balance, balanceDate: null });
    }
    return p;
  }

  if (MT.store) {
    MT.store.defineSection('payments', { create, normalize, finalize, hasContent, summarize });
    MT.store.addMigration(1, (d) => {
      d.payments = initialFromMonthly(d.monthly);
      d.schemaVersion = 2;
      return d;
    });
  }

  MT.paymentsModel = {
    CATEGORIES,
    SPECIAL,
    TOTAL_CATEGORIES,
    KINDS,
    NAME_MAX,
    MEMO_MAX,
    ALLOCATION_UNIT,
    SAVING_UNIT,
    categoryLabel,
    create,
    normalize,
    finalize,
    cleanBill,
    cleanIncome,
    cleanSpecial,
    cleanHistory,
    findAccount,
    accountName,
    activeBills,
    endedBills,
    activeSubs,
    subTotal,
    billTotal,
    isOverSub,
    specialsFor,
    lines,
    totals,
    withdrawals,
    pendingIncomes,
    needs,
    autoPlan,
    currentPlan,
    planSummary,
    accountRows,
    cashflow,
    specialGroups,
    savingPlan,
    warnings,
    linkAccount,
    unlinkAccount,
    createAccount,
    moveAccount,
    setAccountKind,
    setBalance,
    saveBill,
    saveIncome,
    saveSpecial,
    removeById,
    toggleDone,
    setAllocation,
    resetAllocation,
    reflectPreview,
    reflectToMonthly,
    snapshot,
    rollover,
    deleteHistory,
    initialFromMonthly,
  };
})(typeof window !== 'undefined' ? window : globalThis);
