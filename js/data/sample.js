/*
 * サンプルデータ(すべて架空の名前と金額)
 * 月末記録:今日から見て「2か月前まで」の 6 か月分。先月の記録はわざと入れていない(上部の案内を試せる)。
 * 支払い管理:管理中の月をわざと「先月」にしてある。開くとすぐ月替わり(締め)が動き、
 *             先月分が履歴に入り、「済」が外れ、変動費が空欄になる。
 * 資産管理:証券A・証券B の架空の銘柄(コードも実在しない形)と手入力の資産、推移の履歴。
 *           米国銘柄Q はわざと価格なし(「価格未取得」の表示を試せる)。
 * ポケカ在庫:商品A〜D(商品D は相場なし → 購入単価で評価)。
 * 副業収入:依頼元A(月水金)・依頼元B(土)の 6 か月分の記録。今月は途中まで。
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

  // ---- 資産管理(すべて架空。コードは実在しない形にしてある) ----

  const HOLDINGS = [
    { id: 'smp_h_x', broker: '証券A', account: 'tokutei', type: 'jp', code: 'X101', name: '銘柄X', quantity: 100, avgPrice: 1520, price: 1784,
      dividend: { perShare: 30, months: [6, 12] }, benefit: { content: 'カタログギフト(サンプル)', minShares: 100, recordMonths: [3], arriveMonths: [6] } },
    { id: 'smp_h_y', broker: '証券A', account: 'nisa_new', type: 'jp', code: 'X102', name: '銘柄Y', quantity: 100, avgPrice: 2310, price: 2195,
      dividend: { perShare: 45, months: [3, 9] }, benefit: { content: 'お米の引換券(サンプル)', minShares: 200, recordMonths: [9], arriveMonths: [12] } },
    { id: 'smp_h_m', broker: '証券A', account: 'nisa_new', type: 'fund', code: 'XFUND001', name: 'ファンドM', quantity: 42.1875, avgPrice: 18420, price: 21366 },
    { id: 'smp_h_n', broker: '証券A', account: 'nisa_old', type: 'fund', code: 'XFUND002', name: 'ファンドN', quantity: 18.5, avgPrice: 13050, price: 17872 },
    { id: 'smp_h_z', broker: '証券B', account: 'tokutei', type: 'jp', code: 'X103', name: '銘柄Z', quantity: 300, avgPrice: 812, price: 768,
      dividend: { perShare: 12, months: [6, 12] } },
    { id: 'smp_h_p', broker: '証券B', account: 'tokutei', type: 'us', code: 'XUS', name: '米国銘柄P', quantity: 15, avgPrice: 21800, priceUsd: 168.4,
      dividend: { perShare: 0.62, months: [3, 6, 9, 12] } },
    { id: 'smp_h_q', broker: '証券B', account: 'nisa_new', type: 'us', code: 'XUSQ', name: '米国銘柄Q', quantity: 8, avgPrice: 15600 },
  ];

  const MANUAL = [
    { id: 'smp_m_point', name: 'ポイント運用A', category: 'invest', value: 52300, cost: 48000 },
    { id: 'smp_m_wallet', name: 'ウォレットB', category: 'cash', value: 18000, cost: 18000 },
    { id: 'smp_m_gold', name: '金(現物)', category: 'other', value: 132000, cost: 110000 },
    { id: 'smp_m_collect', name: 'コレクション', category: 'other', value: 85000, cost: 60000, sellPriority: 'first' },
  ];

  function buildAssets(now) {
    const a = MT.assetsModel.create();
    const day = (n) => {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - n);
      return U.todayStr(d);
    };
    const priceAt = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 18, 0).toISOString();
    a.holdings = HOLDINGS.map((x) =>
      MT.assetsModel.cleanHolding({ ...x, priceAt: x.price || x.priceUsd ? priceAt : null, priceSource: x.price || x.priceUsd ? 'sample' : null })
    );
    a.manual = MANUAL.map((m) => MT.assetsModel.cleanManual({ ...m, updatedAt: day(12) }));
    a.fx = { rate: 150, source: 'manual', at: priceAt };
    a.lastUpdateAt = priceAt;
    a.settings.fxManual = 150;
    a.settings.reflect = {
      groupBy: 'account',
      map: { tokutei: 'smp_sec_main', ippan: 'smp_sec_main', nisa_old: 'smp_sec_nisa', nisa_new: 'smp_sec_nisa' },
      manualMap: {},
    };
    a.recent = { broker: '証券A', account: 'nisa_new', type: 'jp' };
    // 推移(古い順):いまの評価額を基準に、少しずつ増えてきた形にする
    const now0 = MT.assetsModel.summary(a);
    const factors = [
      [56, 0.931],
      [49, 0.946],
      [42, 0.958],
      [35, 0.951],
      [28, 0.972],
      [21, 0.984],
      [14, 0.978],
      [7, 0.991],
    ];
    a.history = factors.map(([n, f]) => {
      const byBroker = {};
      let total = 0;
      for (const [k, g] of now0.byBroker) {
        const v = k === MT.assetsModel.MANUAL_BROKER ? g.value : Math.round((g.value * f) / 100) * 100;
        byBroker[k] = v;
        total += v;
      }
      return { date: day(n), total, gain: null, byBroker, missing: 1 };
    });
    return a;
  }

  // ---- ポケカ在庫(すべて架空) ----

  function buildInventory(now) {
    const day = (n) => U.todayStr(new Date(now.getFullYear(), now.getMonth(), now.getDate() - n));
    const items = [
      {
        id: 'smp_inv_a', name: '商品A', quantity: 3, unitCost: 5500, priority: 'first',
        prices: [[60, 6200, '買取店A'], [40, 6800, '買取店B'], [20, 7400, '買取店A'], [5, 7100, '']],
        sales: [[30, 1, 7000, 5500]],
      },
      { id: 'smp_inv_b', name: '商品B', quantity: 2, unitCost: 12000, priority: 'ifNeeded', prices: [[45, 11500, '買取店A'], [10, 10800, '買取店A']], sales: [] },
      {
        id: 'smp_inv_c', name: '商品C', quantity: 6, unitCost: 900, priority: 'first',
        prices: [[50, 1500, '買取店B'], [15, 1800, '買取店B']],
        sales: [[25, 2, 1600, 900]],
      },
      { id: 'smp_inv_d', name: '商品D', quantity: 1, unitCost: 3000, priority: 'keep', prices: [], sales: [], memo: '相場の記録がないので、購入単価で評価しています(サンプル)' },
    ];
    return {
      items: items.map((x) =>
        MT.inventoryModel.cleanItem({
          ...x,
          prices: x.prices.map(([n, price, store], i) => ({ id: `${x.id}_p${i}`, date: day(n), price, store })),
          sales: x.sales.map(([n, quantity, price, costAtSale], i) => ({ id: `${x.id}_s${i}`, date: day(n), quantity, price, costAtSale })),
        })
      ),
      settings: { reflectItemId: null },
    };
  }

  // ---- 副業収入(すべて架空) ----

  function buildSidejob(now) {
    const today = U.todayStr(now);
    const cur = U.currentYM(now);
    const clients = [
      {
        id: 'smp_cli_a', name: '依頼元A', baseAmount: 8000,
        tasks: [
          { id: 'smp_t_x', name: '作業項目X', amount: 2000, isDefault: true },
          { id: 'smp_t_y', name: '作業項目Y', amount: 1500, isDefault: false },
          { id: 'smp_t_z', name: '作業項目Z', amount: 3000, isDefault: true },
        ],
        weekdays: [1, 3, 5],
        payment: { incomeId: 'smp_i_side', timing: 'next', day: 25 },
        memo: '',
      },
      {
        id: 'smp_cli_b', name: '依頼元B', baseAmount: 10000,
        tasks: [
          { id: 'smp_t_p', name: '作業項目P', amount: 2500, isDefault: true },
          { id: 'smp_t_q', name: '作業項目Q', amount: 1000, isDefault: false },
        ],
        weekdays: [6],
        payment: { incomeId: null, timing: 'next', day: null },
        memo: '',
      },
    ].map((c) => MT.sidejobModel.cleanClient(c));
    const records = [];
    let n = 0;
    for (let k = -5; k <= 0; k++) {
      const ym = U.ymAdd(cur, k);
      for (const c of clients) {
        const days = MT.sidejobModel.plannedDates({ schedule: {} }, ym, c);
        days.forEach((date, i) => {
          if (date >= today) return; // 今日より先はまだ働いていない
          if ((i + k) % 5 === 4) return; // ときどき休み
          const items = c.tasks.filter((t) => t.isDefault).map((t) => ({ name: t.name, amount: t.amount }));
          if (i % 3 === 1) {
            const extra = c.tasks.find((t) => !t.isDefault);
            items.push({ name: extra.name, amount: extra.amount });
          }
          const daysAgo = Math.round((now - new Date(date + 'T00:00:00')) / 86400000);
          records.push({ id: `smp_rec_${n++}`, date, clientId: c.id, base: c.baseAmount, items, content: MT.sidejobModel.contentOf(items), memo: '', confirmed: k < 0 || daysAgo > 10 });
        });
      }
    }
    // 今月、依頼元A の次の予定日を 1 日休みにしておく
    const next = MT.sidejobModel.plannedDates({ schedule: {} }, cur, clients[0]).find((d) => d > today);
    const schedule = next ? { [cur]: { [clients[0].id]: { off: [next], extra: [], plans: {} } } } : {};
    return { clients, records: records.map((r) => MT.sidejobModel.cleanRecord(r)), schedule };
  }

  function build(now = new Date()) {
    const data = MT.store.createEmpty(now);
    const last = U.ymAdd(U.currentYM(now), -2);
    const months = ITEMS[0].values.map((_, i) => U.ymAdd(last, i - (ITEMS[0].values.length - 1)));

    const monthly = data.monthly;
    monthly.categories = CATEGORIES.map((c) => ({ ...c }));
    monthly.items = ITEMS.map((it) => ({ id: it.id, categoryId: it.cat, name: it.name, lastUpdated: null, reference: false }));
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
    data.assets = buildAssets(now);
    data.inventory = buildInventory(now);
    data.sidejob = buildSidejob(now);
    return data;
  }

  MT.sample = { build };
})(typeof window !== 'undefined' ? window : globalThis);
