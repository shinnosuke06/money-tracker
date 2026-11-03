/*
 * 副業収入:データの形と計算・操作(画面には触らない)
 *
 * sidejob = {
 *   clients: [{                        // 依頼元(最大 5 件)
 *     id, name, baseAmount,            // 基本額(円)
 *     tasks: [{ id, name, amount, isDefault }],   // 作業項目。isDefault は記録を作るときに最初から選ぶもの
 *     weekdays: [0..6],                // 曜日パターン(0 = 日曜)
 *     payment: { incomeId, timing, day },          // 支払い管理の入金予定との対応。timing: next(翌月)/ same(当月)
 *     memo
 *   }],
 *   records: [{                        // 日ごとの記録
 *     id, date, clientId,
 *     base,                            // 基本額(円)
 *     items: [{ name, amount }],       // 選んだ作業項目(金額は記録ごとに変えられる)
 *     content,                         // 内容の文章。選んだ項目から自動で作る(「作業項目X1、作業項目Y0.1」=
 *                                      //   項目名 + 金額を万円にした数)。旧データは文章のまま
 *     memo, confirmed                  // 入金確認
 *   }],
 *   schedule: { "YYYY-MM": { [clientId]: {
 *     off: [日付], extra: [日付],      // 休む日・追加で出る日
 *     plans: { [日付]: { base, items: [{ name, amount }] } }   // その日の見込み(追加で出る日に選んだ基本額と作業項目)
 *   } } }
 * }
 *
 * 金額はすべて円の整数で保存・計算し、画面で万円(小数 1 桁)に直す。
 * 支払い管理との連携:依頼元に対応させた入金予定へ、働いた月の予想額を自動で入れる(syncPayments)。
 */
(function (root) {
  'use strict';
  const MT = (root.MT = root.MT || {});
  const U = MT.util;

  const MAX_CLIENTS = 5;
  const NAME_MAX = 40;
  const TEXT_MAX = 500;

  function create() {
    return { clients: [], records: [], schedule: {} };
  }

  // ---- 値の点検 ----

  const text = (s, max = NAME_MAX) =>
    String(s == null ? '' : s)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max);
  const yen = (v) => (U.isYenValue(v) && v >= 0 ? v : 0);
  const id = (v, prefix) => (typeof v === 'string' && v ? v.slice(0, 64) : U.uid(prefix));
  const list = (arr) => (Array.isArray(arr) ? arr : []).filter((x) => x && typeof x === 'object');

  function cleanClient(c) {
    const pay = c.payment && typeof c.payment === 'object' ? c.payment : {};
    return {
      id: id(c.id, 'cli'),
      name: text(c.name) || '依頼元',
      baseAmount: yen(c.baseAmount),
      tasks: list(c.tasks).map((t) => ({ id: id(t.id, 'tsk'), name: text(t.name) || '作業', amount: yen(t.amount), isDefault: t.isDefault === true })),
      weekdays: [...new Set((Array.isArray(c.weekdays) ? c.weekdays : []).filter((w) => Number.isInteger(w) && w >= 0 && w <= 6))].sort(),
      payment: {
        incomeId: typeof pay.incomeId === 'string' && pay.incomeId ? pay.incomeId : null,
        timing: pay.timing === 'same' ? 'same' : 'next',
        day: Number.isInteger(pay.day) && pay.day >= 1 && pay.day <= 31 ? pay.day : null,
      },
      memo: String(c.memo == null ? '' : c.memo).slice(0, 1000),
    };
  }

  function cleanPlan(pl) {
    const x = pl && typeof pl === 'object' ? pl : {};
    return { base: yen(x.base), items: list(x.items).map((it) => ({ name: text(it.name) || '作業', amount: yen(it.amount) })) };
  }

  function cleanRecord(r) {
    return {
      id: id(r.id, 'rec'),
      date: r.date,
      clientId: typeof r.clientId === 'string' ? r.clientId : '',
      base: yen(r.base),
      items: list(r.items).map((x) => ({ name: text(x.name) || '作業', amount: yen(x.amount) })),
      content: text(r.content, TEXT_MAX),
      memo: String(r.memo == null ? '' : r.memo).slice(0, 1000),
      confirmed: r.confirmed === true,
    };
  }

  function normalize(raw) {
    const sj = create();
    const seen = new Set();
    for (const c of list(raw.clients).map(cleanClient)) {
      if (seen.has(c.id) || sj.clients.length >= MAX_CLIENTS) continue;
      seen.add(c.id);
      sj.clients.push(c);
    }
    const recIds = new Set();
    for (const r of list(raw.records)) {
      if (!U.isDateStr(r.date)) continue;
      const rec = cleanRecord(r);
      if (rec.items.length) rec.content = contentOf(rec.items); // 作業項目から作る文章は、いつも今の書き方にそろえる
      if (recIds.has(rec.id)) continue;
      recIds.add(rec.id);
      sj.records.push(rec);
    }
    const sched = raw.schedule && typeof raw.schedule === 'object' ? raw.schedule : {};
    for (const ym of Object.keys(sched)) {
      if (!U.isYM(ym) || !sched[ym] || typeof sched[ym] !== 'object') continue;
      for (const cid of Object.keys(sched[ym])) {
        const e = sched[ym][cid] || {};
        const inMonth = (arr) => [...new Set((Array.isArray(arr) ? arr : []).filter((x) => U.isDateStr(x) && x.startsWith(ym)))].sort();
        const off = inMonth(e.off);
        const extra = inMonth(e.extra);
        const plans = {};
        if (e.plans && typeof e.plans === 'object') {
          for (const date of Object.keys(e.plans)) if (U.isDateStr(date) && date.startsWith(ym) && !off.includes(date)) plans[date] = cleanPlan(e.plans[date]);
        }
        if (!off.length && !extra.length && !Object.keys(plans).length) continue;
        (sj.schedule[ym] = sj.schedule[ym] || {})[cid] = { off, extra, plans };
      }
    }
    return sj;
  }

  /** 支払い管理の入金予定が消えていたら、対応を外す */
  function finalize(d) {
    const sj = d.sidejob;
    if (!sj) return;
    const incomes = new Set(d.payments ? d.payments.incomes.map((i) => i.id) : []);
    for (const c of sj.clients) if (c.payment.incomeId && !incomes.has(c.payment.incomeId)) c.payment.incomeId = null;
  }

  function hasContent(sj) {
    return !!sj && (sj.clients.length > 0 || sj.records.length > 0);
  }

  function summarize(sj) {
    return [`副業収入:依頼元 ${sj.clients.length}件・記録 ${sj.records.length}件`];
  }

  // ---- 読み出し・計算 ----

  const findClient = (sj, cid) => sj.clients.find((c) => c.id === cid) || null;
  const clientName = (sj, cid) => (findClient(sj, cid) || { name: '(削除された依頼元)' }).name;

  /** 記録の合計 = 基本額 + 選んだ作業項目 */
  function recordTotal(r) {
    return r.base + r.items.reduce((t, x) => t + x.amount, 0);
  }

  /** 金額を万円の数にする(10,000 → "1"、1,000 → "0.1"、12,500 → "1.25") */
  function manNumber(n) {
    return String(Math.round((Number(n) || 0)) / 10000);
  }

  /** 内容の文章:選んだ項目を「項目名 + 万円の数」にして「、」でつなぐ(関スー 10,000円 → 「関スー1」) */
  function contentOf(items) {
    return items.map((x) => `${x.name}${manNumber(x.amount)}`).join('、');
  }

  /** 1 日あたりの見込み額 = 基本額 + 既定の作業項目 */
  function dailyExpected(client) {
    return client.baseAmount + client.tasks.filter((t) => t.isDefault).reduce((s, t) => s + t.amount, 0);
  }

  /**
   * 新しい記録の下書き(基本額と既定の作業項目を最初から選ぶ)。
   * plan(追加で出る日の見込み)があれば、その基本額と作業項目にする。
   */
  function newDraft(client, date, plan = null) {
    return {
      id: null,
      date,
      clientId: client ? client.id : '',
      base: plan ? plan.base : client ? client.baseAmount : 0,
      items: plan
        ? plan.items.map((x) => ({ name: x.name, amount: x.amount }))
        : client
          ? client.tasks.filter((t) => t.isDefault).map((t) => ({ name: t.name, amount: t.amount }))
          : [],
      content: '',
      memo: '',
      confirmed: false,
    };
  }

  function monthRecords(sj, ym, clientId = null) {
    return sj.records
      .filter((r) => r.date.startsWith(ym) && (!clientId || r.clientId === clientId))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  /** 月の合計(依頼元別・入金確認別) */
  function monthSummary(sj, ym, clientId = null) {
    const byClient = new Map(sj.clients.map((c) => [c.id, 0]));
    let total = 0;
    let confirmed = 0;
    const rows = monthRecords(sj, ym, clientId);
    for (const r of rows) {
      const v = recordTotal(r);
      total += v;
      if (r.confirmed) confirmed += v;
      byClient.set(r.clientId, (byClient.get(r.clientId) || 0) + v);
    }
    return { total, confirmed, unconfirmed: total - confirmed, byClient, count: rows.length };
  }

  const emptyEntry = () => ({ off: [], extra: [], plans: {} });

  /** その日の見込み(追加で出る日に選んだ基本額と作業項目)。無ければ null */
  function dayPlan(sj, clientId, date) {
    const e = (sj.schedule[String(date).slice(0, 7)] || {})[clientId];
    return e && e.plans && e.plans[date] ? e.plans[date] : null;
  }

  /** その日の見込み額:追加で出る日の見込みがあればそれ、無ければ 1 日あたりの見込み額 */
  function dayExpected(sj, client, date) {
    const pl = dayPlan(sj, client.id, date);
    return pl ? recordTotal(pl) : dailyExpected(client);
  }

  /** 曜日パターンから作ったその月の予定日(休む日を除き、追加の日を足す) */
  function plannedDates(sj, ym, client) {
    const e = (sj.schedule[ym] || {})[client.id] || emptyEntry();
    const out = new Set();
    const n = U.daysInMonth(ym);
    for (let d = 1; d <= n; d++) {
      const date = `${ym}-${String(d).padStart(2, '0')}`;
      if (client.weekdays.includes(U.weekday(date)) && !e.off.includes(date)) out.add(date);
    }
    for (const x of e.extra) out.add(x);
    return [...out].sort();
  }

  /** カレンダーの日の状態:planned(予定)/ off(休む)/ extra(追加)/ none */
  function dayState(sj, ym, client, date) {
    const e = (sj.schedule[ym] || {})[client.id] || emptyEntry();
    if (e.extra.includes(date)) return 'extra';
    if (client.weekdays.includes(U.weekday(date))) return e.off.includes(date) ? 'off' : 'planned';
    return 'none';
  }

  function entryOf(sj, ym, clientId) {
    const month = (sj.schedule[ym] = sj.schedule[ym] || {});
    const e = (month[clientId] = month[clientId] || emptyEntry());
    if (!e.plans) e.plans = {};
    return e;
  }

  function tidySchedule(sj, ym, clientId) {
    const month = sj.schedule[ym];
    if (!month) return;
    const e = month[clientId];
    if (e && !e.off.length && !e.extra.length && !Object.keys(e.plans || {}).length) delete month[clientId];
    if (!Object.keys(month).length) delete sj.schedule[ym];
  }

  /** 日をタップ:予定 ↔ 休む、予定外 ↔ 追加(追加をやめると、その日の見込みも消す) */
  function toggleDay(sj, ym, clientId, date) {
    const client = findClient(sj, clientId);
    if (!client || !date.startsWith(ym)) return;
    const e = entryOf(sj, ym, clientId);
    const flip = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : arr.concat(v).sort());
    if (client.weekdays.includes(U.weekday(date))) {
      e.off = flip(e.off, date);
      if (e.off.includes(date)) delete e.plans[date];
    } else {
      e.extra = flip(e.extra, date);
      if (!e.extra.includes(date)) delete e.plans[date];
    }
    tidySchedule(sj, ym, clientId);
  }

  /**
   * 追加で出る日を、依頼元と見込み(基本額と作業項目)つきで入れる。
   * 依頼元の曜日パターンの日なら、休む日から外して、その日の見込みだけ入れる。
   */
  function setExtraDay(sj, clientId, date, plan) {
    const client = findClient(sj, clientId);
    if (!client || !U.isDateStr(date)) return false;
    const ym = date.slice(0, 7);
    const e = entryOf(sj, ym, clientId);
    if (client.weekdays.includes(U.weekday(date))) e.off = e.off.filter((x) => x !== date);
    else if (!e.extra.includes(date)) e.extra = e.extra.concat(date).sort();
    e.plans[date] = cleanPlan(plan);
    tidySchedule(sj, ym, clientId);
    return true;
  }

  /** 追加で出る日をやめる(見込みも消す)。曜日パターンの日なら、見込みだけ消す */
  function removeExtraDay(sj, clientId, date) {
    const ym = String(date).slice(0, 7);
    const e = (sj.schedule[ym] || {})[clientId];
    if (!e) return;
    e.extra = e.extra.filter((x) => x !== date);
    if (e.plans) delete e.plans[date];
    tidySchedule(sj, ym, clientId);
  }

  /**
   * 予想額:確認済み / 予定 / 合計
   *  予定 = 入金が未確認の記録 + まだ記録のない予定日(今日以降)× 1 日あたりの見込み額
   */
  function forecast(sj, ym, clientId, today) {
    const clients = clientId ? sj.clients.filter((c) => c.id === clientId) : sj.clients;
    const s = monthSummary(sj, ym, clientId);
    let planned = 0;
    let plannedDays = 0;
    for (const c of clients) {
      const recorded = new Set(sj.records.filter((r) => r.clientId === c.id && r.date.startsWith(ym)).map((r) => r.date));
      for (const date of plannedDates(sj, ym, c)) {
        if (date < today || recorded.has(date)) continue;
        planned += dayExpected(sj, c, date);
        plannedDays++;
      }
    }
    const scheduled = s.unconfirmed + planned;
    return { confirmed: s.confirmed, unconfirmed: s.unconfirmed, planned, plannedDays, scheduled, total: s.confirmed + scheduled };
  }

  /** 推移:直近の月ごとの、依頼元別の合計 */
  function trend(sj, months) {
    return {
      months,
      series: sj.clients.map((c) => ({ key: c.id, label: c.name, values: months.map((ym) => monthSummary(sj, ym, c.id).total) })),
    };
  }

  // ---- 書き換え ----

  function saveClient(sj, draft) {
    const c = cleanClient(draft);
    const i = sj.clients.findIndex((x) => x.id === c.id);
    if (i >= 0) sj.clients[i] = c;
    else {
      if (sj.clients.length >= MAX_CLIENTS) return null;
      sj.clients.push(c);
    }
    return c.id;
  }

  /** 依頼元を消す(その依頼元の記録と予定も消える) */
  function removeClient(sj, cid) {
    sj.clients = sj.clients.filter((c) => c.id !== cid);
    sj.records = sj.records.filter((r) => r.clientId !== cid);
    for (const ym of Object.keys(sj.schedule)) {
      delete sj.schedule[ym][cid];
      if (!Object.keys(sj.schedule[ym]).length) delete sj.schedule[ym];
    }
  }

  /** 記録を保存する。作業項目を選んでいれば、内容の文章をそこから作る */
  function saveRecord(sj, draft) {
    const r = cleanRecord({ ...draft, content: draft.items && draft.items.length ? contentOf(draft.items) : draft.content });
    if (!U.isDateStr(r.date)) return null;
    const i = sj.records.findIndex((x) => x.id === r.id);
    if (i >= 0) sj.records[i] = r;
    else sj.records.push(r);
    return r.id;
  }

  function removeRecord(sj, rid) {
    sj.records = sj.records.filter((r) => r.id !== rid);
  }

  function toggleConfirmed(sj, rid) {
    const r = sj.records.find((x) => x.id === rid);
    if (r) r.confirmed = !r.confirmed;
    return r ? r.confirmed : false;
  }

  /** その月の、その依頼元の入金を全て確認済みにする */
  function confirmMonth(sj, ym, clientId) {
    let n = 0;
    for (const r of monthRecords(sj, ym, clientId)) {
      if (!r.confirmed) {
        r.confirmed = true;
        n++;
      }
    }
    return n;
  }

  // ---- 支払い管理との連携 ----

  /**
   * 支払い管理の入金予定に入れる予定:管理中の月(payments.month)の入金に、
   * 対応する依頼元の働いた月(翌月払いなら前の月)の予想額を入れる。同じ入金に複数の依頼元なら合計。
   */
  function paymentPlan(d, today) {
    const sj = d.sidejob;
    const p = d.payments;
    const target = p.month;
    const rows = new Map();
    for (const c of sj.clients) {
      const inc = c.payment.incomeId ? p.incomes.find((i) => i.id === c.payment.incomeId) : null;
      if (!inc) continue;
      const workMonth = c.payment.timing === 'same' ? target : U.ymAdd(target, -1);
      const f = forecast(sj, workMonth, c.id, today);
      if (!rows.has(inc.id)) rows.set(inc.id, { incomeId: inc.id, incomeName: inc.name, from: inc.amount, to: 0, sources: [] });
      const row = rows.get(inc.id);
      row.to += f.total;
      row.sources.push({ clientId: c.id, clientName: c.name, workMonth, amount: f.total, day: c.payment.day, timing: c.payment.timing });
    }
    return { target, rows: [...rows.values()] };
  }

  function applyPaymentPlan(d, today) {
    const plan = paymentPlan(d, today);
    for (const r of plan.rows) {
      const inc = d.payments.incomes.find((i) => i.id === r.incomeId);
      if (inc) inc.amount = r.to;
    }
    return plan.rows.length;
  }

  /**
   * 自動の反映:対応する入金予定の金額が予想額と違えば、予想額にする(入金済みにした入金は変えない)。
   * 画面を開いたとき・データが変わったときに呼ぶ(app.js の定期処理)。
   * @returns {number} 直した入金予定の数
   */
  function syncPayments(d, today) {
    if (!d.sidejob || !d.payments) return 0;
    let n = 0;
    for (const r of paymentPlan(d, today).rows) {
      const inc = d.payments.incomes.find((i) => i.id === r.incomeId);
      if (!inc || inc.done || inc.amount === r.to) continue;
      inc.amount = r.to;
      n++;
    }
    return n;
  }

  /** 自動の反映で直す入金予定があるか(書き換えずに調べる) */
  function needsPaymentSync(d, today) {
    if (!d.sidejob || !d.payments) return false;
    return paymentPlan(d, today).rows.some((r) => {
      const inc = d.payments.incomes.find((i) => i.id === r.incomeId);
      return inc && !inc.done && inc.amount !== r.to;
    });
  }

  /** この入金予定に対応している依頼元(自動で入る入金か) */
  function clientsForIncome(sj, incomeId) {
    return sj ? sj.clients.filter((c) => c.payment.incomeId === incomeId) : [];
  }

  if (MT.store) {
    MT.store.defineSection('sidejob', { create, normalize, finalize, hasContent, summarize });
    // v5 → v6:副業の予定に、追加で出る日の見込み(plans)を足す。読み込み時の点検で空の見込みが入るので、版だけ上げる
    MT.store.addMigration(5, (d) => {
      d.schemaVersion = 6;
      return d;
    });
  }

  MT.sidejobModel = {
    MAX_CLIENTS,
    NAME_MAX,
    create,
    normalize,
    finalize,
    cleanClient,
    cleanRecord,
    findClient,
    clientName,
    recordTotal,
    manNumber,
    contentOf,
    dailyExpected,
    dayPlan,
    dayExpected,
    newDraft,
    monthRecords,
    monthSummary,
    plannedDates,
    dayState,
    toggleDay,
    setExtraDay,
    removeExtraDay,
    forecast,
    trend,
    saveClient,
    removeClient,
    saveRecord,
    removeRecord,
    toggleConfirmed,
    confirmMonth,
    paymentPlan,
    applyPaymentPlan,
    syncPayments,
    needsPaymentSync,
    clientsForIncome,
  };
})(typeof window !== 'undefined' ? window : globalThis);
