/*
 * サンプルデータ(すべて架空の名前と金額)
 * 月末記録:今日から見て「2か月前まで」の 6 か月分。先月の記録はわざと入れていない(上部の案内を試せる)。
 * 支払い管理:管理中の月をわざと「先月」にしてある。開くとすぐ月替わり(締め)が動き、
 *             先月分が履歴に入り、「済」が外れ、変動費が空欄になる。
 */
(function (root) {
  'use strict';
  const MT = (root.MT = root.MT || {});
  const U = MT.util;

  const CATEGORIES = [
    { id: 'cat_cash', name: '現金(銀行口座)' },
    { id: 'cat_invest', name: '投資(証券口座など)' },
    { id: 'cat_deposit', name: '預かり金' },
  ];

  // values は古い月 → 新しい月の順。carryLast: 最新の月は「前月からのコピー(未確認)」にする
  const ITEMS = [
    { id: 'smp_bank_main', cat: 'cat_cash', name: 'サンプル銀行 普通', values: [412000, 398500, 455300, 430800, 468200, 441900] },
    { id: 'smp_bank_time', cat: 'cat_cash', name: 'サンプル銀行 定期', values: [1000000, 1000000, 1000000, 1000000, 1000000, 1000000], carryLast: true },
    { id: 'smp_netbank', cat: 'cat_cash', name: 'ネット銀行A 普通', values: [182000, 214000, 236500, 251000, 279800, 305200] },
    { id: 'smp_wallet', cat: 'cat_cash', name: '手元の現金', values: [23000, 18500, 31200, 15800, 27400, 21600] },
    { id: 'smp_sec_main', cat: 'cat_invest', name: 'サンプル証券 特定口座', values: [820000, 845300, 801200, 868900, 902400, 887100] },
    { id: 'smp_sec_nisa', cat: 'cat_invest', name: 'サンプル証券 NISA', values: [560000, 598200, 617500, 664300, 702800, 741600] },
    { id: 'smp_pension', cat: 'cat_invest', name: '確定拠出年金', values: [356000, 371400, 384900, 402200, 419800, 419800], carryLast: true },
    { id: 'smp_club', cat: 'cat_deposit', name: 'サークル会費の預かり', values: [36000, 48000, 12000, 24000, 36000, 48000] },
    { id: 'smp_family', cat: 'cat_deposit', name: '家族からの預かり', values: [100000, 100000, 100000, 0, 0, 50000] },
  ];

  const MEMOS = { 1: '家電を買い替え(サンプル)', 3: 'ボーナス月(サンプル)' };

  // ---- 支払い管理(すべて架空) ----

  const BILLS = [
    { id: 'smp_b_loan', name: '住宅ローン', amount: 72000, dueDay: 27, acc: 'smp_bank_main', category: 'loan', done: true },
    { id: 'smp_b_school', name: '奨学金の返済', amount: 13000, dueDay: 27, acc: 'smp_netbank', category: 'loan', end: 8, done: true },
    {
      id: 'smp_b_card',
      name: 'クレジットカードA',
      amount: 98400,
      dueDay: 10,
      acc: 'smp_bank_main',
      category: 'variable',
      done: true,
      subs: [
        { name: '動画配信サービス', amount: 1490, category: 'fixed' },
        { name: 'スマホ代', amount: 4980, category: 'fixed' },
        { name: '食費・日用品', amount: 62000, category: 'variable' },
        { name: 'ガソリン', amount: 9800, category: 'variable' },
      ],
    },
    { id: 'smp_b_energy', name: '電気・ガス', amount: 14800, dueDay: 26, acc: 'smp_netbank', category: 'variable' },
    { id: 'smp_b_insure', name: '保険料', amount: 12000, dueDay: 27, acc: 'smp_bank_main', category: 'fixed', memo: '年1回見直す(サンプル)' },
    { id: 'smp_b_invest', name: '積立投資', amount: 30000, dueDay: 27, acc: 'smp_netbank', category: 'investment' },
    { id: 'smp_b_gym', name: 'スポーツジム', amount: 7700, dueDay: 5, acc: 'smp_bank_main', category: 'fixed', end: 0, done: true },
    { id: 'smp_b_life', name: '生活費(現金)', amount: 40000, dueDay: null, acc: 'smp_wallet', category: 'variable' },
  ];

  const INCOMES = [
    { id: 'smp_i_salary', name: '給与', amount: 285000, fixed: true, target: 'smp_bank_main', done: true },
    { id: 'smp_i_side', name: '副業の報酬', amount: 42000, fixed: false, target: null },
    { id: 'smp_i_refund', name: '立替金の戻り', amount: 8000, fixed: false, target: 'smp_netbank' },
  ];

  // month は「今月」からのずれ
  const SPECIALS = [
    { id: 'smp_s_fee', name: '年会費', amount: 11000, month: 0, acc: 'smp_bank_main' },
    { id: 'smp_s_tax', name: '固定資産税(第4期)', amount: 28000, month: 3 },
    { id: 'smp_s_car', name: '自動車税', amount: 39500, month: 6 },
    { id: 'smp_s_inspect', name: '車検', amount: 98000, month: 10 },
    { id: 'smp_s_town', name: '町内会費', amount: 6000, month: -2, done: true },
  ];

  // 履歴(古い順)。catTotals の合計 = payment になるように作る
  const HISTORY = [
    { income: 327000, balance: 241000, cat: { loan: 85000, fixed: 26170, variable: 131200, investment: 30000, special: 0 } },
    { income: 331500, balance: 262400, cat: { loan: 85000, fixed: 26170, variable: 118400, investment: 30000, special: 0 } },
    { income: 285000, balance: 238900, cat: { loan: 85000, fixed: 26170, variable: 142600, investment: 30000, special: 0 } },
    { income: 342000, balance: 271300, cat: { loan: 85000, fixed: 26170, variable: 109800, investment: 30000, special: 0 } },
    { income: 318000, balance: 284700, cat: { loan: 85000, fixed: 26170, variable: 126300, investment: 30000, special: 6000 } },
  ];

  function buildPayments(now) {
    const cur = U.currentYM(now);
    const month = U.ymAdd(cur, -1);
    const p = MT.paymentsModel.create(now);
    p.month = month;
    p.accounts = [
      { itemId: 'smp_bank_main', kind: 'bank', balance: 186400, balanceDate: U.lastDayOfYM(U.ymAdd(cur, -2)) },
      { itemId: 'smp_netbank', kind: 'bank', balance: 18300, balanceDate: U.lastDayOfYM(U.ymAdd(cur, -2)) },
      { itemId: 'smp_wallet', kind: 'cash', balance: 21600, balanceDate: U.lastDayOfYM(U.ymAdd(cur, -2)) },
    ];
    p.bills = BILLS.map((b) => ({
      id: b.id,
      name: b.name,
      amount: b.amount,
      dueDay: b.dueDay,
      accountId: b.acc,
      category: b.category,
      endMonth: b.end === undefined ? null : U.ymAdd(month, b.end),
      memo: b.memo || '',
      done: b.done === true,
      subItems: (b.subs || []).map((x, i) => ({ id: `${b.id}_s${i}`, name: x.name, amount: x.amount, category: x.category, endMonth: null, memo: '' })),
    }));
    p.incomes = INCOMES.map((i) => ({ id: i.id, name: i.name, amount: i.amount, fixed: i.fixed, targetId: i.target, done: i.done === true, memo: '' }));
    p.specials = SPECIALS.map((x) => ({
      id: x.id,
      name: x.name,
      amount: x.amount,
      month: U.ymAdd(cur, x.month),
      accountId: x.acc || null,
      done: x.done === true,
      memo: '',
    }));
    p.history = HISTORY.map((x, i) => {
      const payment = Object.values(x.cat).reduce((a, b) => a + b, 0);
      return {
        month: U.ymAdd(month, i - HISTORY.length),
        income: x.income,
        payment,
        balance: x.balance,
        catTotals: { ...x.cat },
        details: [
          { name: '住宅ローン', amount: 72000, category: 'loan' },
          { name: 'クレジットカードA', amount: x.cat.variable - 40000, category: 'variable' },
        ],
        incomeDetails: [{ name: '給与', amount: 285000 }],
      };
    });
    p.memo = 'サンプルのメモです。ボーナス月は積立を増やす予定。';
    return p;
  }

  function build(now = new Date()) {
    const data = MT.store.createEmpty(now);
    const last = U.ymAdd(U.currentYM(now), -2);
    const months = ITEMS[0].values.map((_, i) => U.ymAdd(last, i - (ITEMS[0].values.length - 1)));

    const monthly = data.monthly;
    monthly.categories = CATEGORIES.map((c) => ({ ...c }));
    monthly.items = ITEMS.map((it) => ({ id: it.id, categoryId: it.cat, name: it.name, lastUpdated: null }));
    monthly.records = {};

    months.forEach((ym, i) => {
      const day = U.lastDayOfYM(ym);
      const rec = { values: {}, confirmed: {}, memo: MEMOS[i] || '' };
      const isLast = i === months.length - 1;
      ITEMS.forEach((it, k) => {
        rec.values[it.id] = it.values[i];
        if (!(isLast && it.carryLast)) {
          rec.confirmed[it.id] = day;
          monthly.items[k].lastUpdated = day;
        }
      });
      monthly.records[ym] = rec;
    });
    data.payments = buildPayments(now);
    return data;
  }

  MT.sample = { build };
})(typeof window !== 'undefined' ? window : globalThis);
