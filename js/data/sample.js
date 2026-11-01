/*
 * サンプルデータ(すべて架空の名前と金額)
 * 今日から見て「2か月前まで」の 6 か月分を作る。
 * 先月の記録はわざと入れていないので、画面上部の案内を試せる。
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
    return data;
  }

  MT.sample = { build };
})(typeof window !== 'undefined' ? window : globalThis);
