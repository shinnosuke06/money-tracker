/*
 * 旧・支払い管理アプリのバックアップ(JSON テキスト)を、新しい形に変換する
 *
 * 旧形式のキー:accounts, wallets, incomes, payments, history, specialPayments, memos, allocations
 * 金額は "1000+500" のような式の文字列のことがある → 計算して整数にする
 * 口座(accounts / wallets)は、同じ名前の月末記録の項目があればつなぎ、無ければ項目を作る。
 * 変換できなかったものは issues に、変換のしかたを変えたものは notes に入れて報告する。
 */
(function (root) {
  'use strict';
  const MT = (root.MT = root.MT || {});
  const U = MT.util;
  const P = MT.paymentsModel;

  const KEYS = ['accounts', 'wallets', 'incomes', 'payments', 'history', 'specialPayments', 'memos', 'allocations'];
  const CASH_CATEGORY = { id: 'cat_cash', name: '現金(銀行口座)' };

  /** テキストを読み取る。値が JSON 文字列のまま入っている形(localStorage の書き出し)にも対応 */
  function parse(text) {
    let obj;
    try {
      obj = JSON.parse(String(text || '').trim());
      if (typeof obj === 'string') obj = JSON.parse(obj);
    } catch (e) {
      return { ok: false, error: 'JSON として読み取れませんでした。バックアップの文字をすべてコピーしたか確認してください。' };
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return { ok: false, error: '旧・支払い管理アプリのバックアップの形ではありません。' };
    }
    for (const k of KEYS) {
      if (typeof obj[k] === 'string' && /^\s*[[{]/.test(obj[k])) {
        try {
          obj[k] = JSON.parse(obj[k]);
        } catch (e) {
          /* そのまま(後で報告) */
        }
      }
    }
    if (!KEYS.some((k) => k in obj)) {
      return { ok: false, error: '旧・支払い管理アプリのバックアップの形ではありません(accounts や payments などが見つかりません)。' };
    }
    return { ok: true, obj };
  }

  const asList = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);
  const str = (v) => (v == null ? '' : String(v));

  /**
   * 変換する。今のデータ(current)は書き換えず、新しいデータ全体を返す。
   * 月末記録は残し、足りない口座の項目だけ追加する。支払い管理の区画は置き換える。
   * @returns {{data, report: {accounts: {name, kind, action}[], counts: object, issues: string[], notes: string[]}}}
   */
  function convert(obj, current, now = new Date()) {
    const data = JSON.parse(JSON.stringify(current));
    const monthly = data.monthly;
    const issues = [];
    const notes = [];
    const accountsReport = [];
    const memoLines = [];
    const p = P.create(now);

    /** 金額(数値・式の文字列)→ 整数。空なら null。計算できなければ報告して null */
    function amount(v, where) {
      if (v == null || v === '') return null;
      if (typeof v === 'number') {
        if (Number.isFinite(v)) {
          const n = Math.round(v);
          if (U.isYenValue(n)) return n === 0 ? 0 : n;
        }
        issues.push(`${where}:金額「${v}」を読み取れませんでした`);
        return null;
      }
      const r = U.parseYen(str(v));
      if (r.ok) return r.value;
      issues.push(`${where}:金額「${str(v).slice(0, 40)}」を計算できませんでした`);
      return null;
    }

    /** "YYYY-MM"(YYYY/M なども可)。label を渡すと、読めないときに報告する */
    function ym(v, where, label) {
      if (v == null || v === '') return null;
      const s = str(v).trim().replace(/\//g, '-');
      const m = /^(\d{4})-(\d{1,2})/.exec(s);
      const out = m ? U.makeYM(Number(m[1]), Number(m[2])) : null;
      if (out && U.isYM(out)) return out;
      if (label) issues.push(`${where}:${label}「${str(v)}」を読み取れませんでした`);
      return null;
    }

    function dueDay(v, where) {
      if (v == null || v === '') return null;
      const s = str(v).trim();
      if (/^(末|月末|末日)$/.test(s)) return 31;
      let n = null;
      if (/^\d{1,2}日?$/.test(s)) n = parseInt(s, 10);
      else {
        const m = /^\d{4}[-/]\d{1,2}[-/](\d{1,2})/.exec(s);
        if (m) n = parseInt(m[1], 10);
      }
      if (n >= 1 && n <= 31) return n;
      issues.push(`${where}:引き落とし日「${s}」を読み取れませんでした`);
      return null;
    }

    function category(v, where) {
      if (P.CATEGORIES.some((c) => c.id === v)) return v;
      issues.push(`${where}:カテゴリ「${str(v) || '(空)'}」が分からないため「変動費」にしました`);
      return 'variable';
    }

    // ---- 口座(月末記録の項目とつなぐ) ----

    function cashCategoryId() {
      let c = monthly.categories.find((x) => x.id === CASH_CATEGORY.id) || monthly.categories.find((x) => /現金/.test(x.name));
      if (!c) {
        c = { ...CASH_CATEGORY };
        monthly.categories.unshift(c);
        notes.push(`月末記録に区分「${c.name}」を作りました`);
      }
      return c.id;
    }

    const usedItems = new Set();
    const accMap = new Map(); // 旧 account id → itemId
    const walletMap = new Map(); // 旧 wallet id → itemId

    function linkOrCreate(name, kind, balance, label) {
      const clean = str(name).replace(/\s+/g, ' ').trim().slice(0, P.NAME_MAX) || (kind === 'cash' ? '手元現金' : '口座');
      let item = monthly.items.find((it) => it.name === clean && !usedItems.has(it.id));
      let action = 'linked';
      if (!item) {
        item = MT.monthlyModel.addItem(monthly, cashCategoryId(), clean);
        action = 'created';
      }
      usedItems.add(item.id);
      p.accounts.push({ itemId: item.id, kind, balance, balanceDate: null });
      accountsReport.push({ name: clean, kind, action, label });
      return item.id;
    }

    asList(obj.accounts).forEach((a, i) => {
      const where = `口座「${str(a.name) || i + 1}」`;
      const id = linkOrCreate(a.name, 'bank', amount(a.amount, where), '口座');
      accMap.set(str(a.id), id);
      if (str(a.memo).trim()) memoLines.push(`【${str(a.name)}】${str(a.memo).trim()}`);
      const inc = amount(a.incomingAmount, where);
      if (inc) notes.push(`${where}の入金予定額(${U.yen(inc)}円)は、新しいアプリでは振り分けから計算するため読み込みませんでした`);
    });

    const walletBills = [];
    asList(obj.wallets).forEach((w, i) => {
      const where = `手元現金「${str(w.name) || i + 1}」`;
      const id = linkOrCreate(w.name, 'cash', amount(w.amount, where), '手元現金');
      walletMap.set(str(w.id), id);
      if (str(w.memo).trim()) memoLines.push(`【${str(w.name)}】${str(w.memo).trim()}`);
      const out = amount(w.outgoAmount, where);
      if (out) {
        walletBills.push({
          name: `${str(w.name).trim() || '手元現金'}の支出`,
          amount: out,
          dueDay: null,
          accountId: id,
          category: w.isOutgoFixed ? 'fixed' : 'variable',
          endMonth: null,
          memo: '',
          done: w.isOutgoDone === true,
          subItems: [],
        });
        notes.push(`${where}の支出予定を、支払い「${str(w.name).trim() || '手元現金'}の支出」として読み込みました`);
      }
      const inc = amount(w.incomingAmount, where);
      if (inc) notes.push(`${where}の入金予定額(${U.yen(inc)}円)は、振り分けから計算するため読み込みませんでした`);
    });

    /** "account_1" / "wallet_2" / "1" → itemId */
    function target(ref, where) {
      const s = str(ref).trim();
      if (!s) return null;
      let m = /^account_(.+)$/.exec(s);
      if (m && accMap.has(m[1])) return accMap.get(m[1]);
      m = /^wallet_(.+)$/.exec(s);
      if (m && walletMap.has(m[1])) return walletMap.get(m[1]);
      if (accMap.has(s)) return accMap.get(s);
      if (walletMap.has(s)) return walletMap.get(s);
      issues.push(`${where}:口座「${s}」が見つからないため「口座なし」にしました`);
      return null;
    }

    // ---- 入金予定 ----

    const incomeMap = new Map(); // 旧 id → 新 id
    asList(obj.incomes).forEach((x, i) => {
      const where = `入金「${str(x.name) || i + 1}」`;
      const income = P.cleanIncome({
        id: `inc_${str(x.id) || i}`,
        name: x.name,
        amount: amount(x.amount, where),
        fixed: x.isFixed !== false,
        targetId: target(x.defaultTarget, where),
        done: x.isDone === true,
        memo: x.memo,
      });
      incomeMap.set(str(x.id), income.id);
      p.incomes.push(income);
    });

    // ---- 支払い・ローン ----

    let subCount = 0;
    asList(obj.payments).forEach((x, i) => {
      const where = `支払い「${str(x.name) || i + 1}」`;
      const subs = asList(x.subItems).map((s, k) => {
        const w2 = `${where}の内訳「${str(s.name) || k + 1}」`;
        return {
          id: `sub_${str(s.id) || `${i}_${k}`}`,
          name: s.name,
          amount: amount(s.amount, w2),
          category: category(s.category, w2),
          endMonth: ym(s.endDate, w2, '終了月'),
          memo: s.memo,
        };
      });
      subCount += subs.length;
      p.bills.push(
        P.cleanBill({
          id: `bill_${str(x.id) || i}`,
          name: x.name,
          amount: amount(x.amount, where),
          dueDay: dueDay(x.dueDate, where),
          accountId: target(x.accountId, where),
          category: category(x.category, where),
          endMonth: ym(x.endDate, where, '終了月'),
          memo: x.memo,
          done: x.isDone === true,
          subItems: subs,
        })
      );
    });
    for (const b of walletBills) p.bills.push(P.cleanBill(b));

    // ---- 特別支出 ----

    asList(obj.specialPayments).forEach((x, i) => {
      const where = `特別支出「${str(x.name) || i + 1}」`;
      const month = ym(x.targetMonth, where);
      if (!month) {
        issues.push(`${where}:支払月「${str(x.targetMonth)}」が分からないため読み込みませんでした`);
        return;
      }
      p.specials.push(
        P.cleanSpecial({ id: `sp_${str(x.id) || i}`, name: x.name, amount: amount(x.amount, where), month, accountId: null, done: x.isDone === true, memo: x.memo })
      );
    });

    // ---- 履歴 ----

    const hist = new Map();
    asList(obj.history).forEach((x, i) => {
      const month = ym(x.id || x.month, '');
      if (!month) {
        issues.push(`履歴 ${i + 1}件目:月「${str(x.id || x.month)}」が分からないため読み込みませんでした`);
        return;
      }
      const where = `履歴「${U.ymLabel(month)}」`;
      const catTotals = {};
      const ct = x.catTotals && typeof x.catTotals === 'object' ? x.catTotals : {};
      for (const k of Object.keys(ct)) {
        if (P.TOTAL_CATEGORIES.some((c) => c.id === k)) catTotals[k] = amount(ct[k], where) || 0;
        else notes.push(`${where}:カテゴリ「${k}」の合計は読み込みませんでした`);
      }
      const listOf = (v) => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : []);
      let dropped = 0;
      const items = (v, withCat) =>
        listOf(v)
          .map((e) => {
            if (!e || typeof e !== 'object' || (e.name == null && e.amount == null)) {
              dropped++;
              return null;
            }
            const o = { name: str(e.name) || '—', amount: amount(e.amount, where) || 0 };
            if (withCat) o.category = P.TOTAL_CATEGORIES.some((c) => c.id === e.category) ? e.category : 'variable';
            return o;
          })
          .filter(Boolean);
      const entry = P.cleanHistory({
        month,
        income: amount(x.income, where),
        payment: amount(x.payment, where),
        balance: amount(x.balance, where),
        catTotals,
        details: items(x.details, true),
        incomeDetails: items(x.incomeDetails, false),
      });
      if (dropped) notes.push(`${where}:明細 ${dropped}件は形が分からないため読み込みませんでした`);
      hist.set(month, entry);
    });
    p.history = [...hist.values()].sort((a, b) => (a.month < b.month ? -1 : 1));

    // ---- メモ ----

    const memos = obj.memos;
    if (typeof memos === 'string') memoLines.unshift(memos.trim());
    else if (Array.isArray(memos)) {
      for (const m of memos) {
        if (typeof m === 'string') memoLines.unshift(m.trim());
        else if (m && typeof m === 'object') {
          const text = m.text || m.memo || m.content || m.body || m.title;
          if (text) memoLines.unshift(str(text).trim());
          else issues.push('メモ:読み取れない形のメモがありました');
        }
      }
    } else if (memos && typeof memos === 'object') {
      for (const [k, v] of Object.entries(memos)) if (v != null && str(v).trim()) memoLines.unshift(`${k}: ${str(v).trim()}`);
    } else if (memos != null) {
      issues.push('メモ:読み取れない形でした');
    }
    p.memo = memoLines.filter(Boolean).join('\n').slice(0, P.MEMO_MAX);
    if (memoLines.join('\n').length > P.MEMO_MAX) issues.push(`メモ:${P.MEMO_MAX}文字を超えた部分は読み込みませんでした`);

    // ---- 振り分け ----

    const alloc = [];
    const pushAlloc = (incRef, accRef, amt) => {
      const incomeId = incomeMap.get(str(incRef));
      const accountId = target(accRef, '振り分け');
      const v = amount(amt, '振り分け');
      if (incomeId && accountId && v > 0) alloc.push({ incomeId, accountId, amount: v });
    };
    const a = obj.allocations;
    if (Array.isArray(a)) {
      for (const x of a) if (x && typeof x === 'object') pushAlloc(x.incomeId ?? x.income ?? x.from, x.accountId ?? x.targetId ?? x.target ?? x.to, x.amount);
    } else if (a && typeof a === 'object') {
      for (const [incRef, v] of Object.entries(a)) {
        if (v && typeof v === 'object' && !Array.isArray(v)) for (const [accRef, amt] of Object.entries(v)) pushAlloc(incRef, accRef, amt);
        else if (Array.isArray(v)) for (const x of v) if (x && typeof x === 'object') pushAlloc(incRef, x.accountId ?? x.targetId ?? x.target, x.amount);
      }
    }
    const hasAllocData = Array.isArray(a) ? a.length > 0 : !!(a && typeof a === 'object' && Object.keys(a).length);
    if (alloc.length) {
      p.allocation = { mode: 'manual', items: alloc };
      notes.push(`振り分け ${alloc.length}件を「手動で調整した振り分け」として読み込みました`);
    } else if (hasAllocData) {
      issues.push('振り分け(allocations):形を読み取れなかったため、自動の提案を使います');
    }

    data.payments = p;
    const counts = {
      linked: accountsReport.filter((x) => x.action === 'linked').length,
      created: accountsReport.filter((x) => x.action === 'created').length,
      banks: asList(obj.accounts).length,
      wallets: asList(obj.wallets).length,
      bills: p.bills.length,
      subItems: subCount,
      incomes: p.incomes.length,
      specials: p.specials.length,
      history: p.history.length,
    };
    return { data, report: { accounts: accountsReport, counts, issues, notes } };
  }

  MT.paymentsLegacy = { parse, convert, KEYS };
})(typeof window !== 'undefined' ? window : globalThis);
