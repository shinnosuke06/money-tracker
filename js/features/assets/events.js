/*
 * 資産管理:株式分割・配当の自動確認(データの操作。画面には触らない)
 *
 * 価格取得の URL(GAS)に ?events=1&codes=… で問い合わせると、銘柄ごとの分割と配当の記録が返る
 * (返事の形は js/features/assets/prices.js の fetchEvents、GAS に足すコードは tools/gas/events.gs)。
 * それを保有と見比べて、「株の変更のお知らせ」(assets.changes)を作る。
 *
 * - 株式分割(併合も):銘柄の確認を始めた日(eventsSince)以後の分割は、自動で反映する。
 *     数量 = 分割前の数量 × 分割数、平均取得単価・今の価格・1株配当 = 分割前 ÷ 分割数
 *     (評価額と取得額は変わらない)。価格と同じ書き換えの中で反映するので、総資産の履歴がずれない
 *   最初の確認で見つかった、120 日以内の分割は、反映済みか分からないので「確認が必要」にする(押すと反映)
 *   eventsSince は、扱った記録のいちばん新しい日まで進める(それより前のものは二度と扱わない)
 * - 配当:確認を始めた日以後に新しい配当があり、1株配当が登録と違うときは「提案」にする
 *   (金額と支払月を直してから反映できる)。配当が未登録の銘柄には、最初の確認で直近 1 年の配当から提案する
 *   支払月は権利落ちの月からの目安(国内株は 3 か月後、米国株は 1 か月後)
 * - 優待:内容を取れる公開の仕組みが無いので、自動では確かめない(株数が条件に足りないかだけ見る)
 * - 反映したもの・提案は、確認するまで画面で色を付けて目立たせる。反映したものは元に戻せる
 *
 * change = {
 *   id, key,                 // key:同じ記録を二度扱わないための印(split:銘柄ID:日付 など)
 *   holdingId, name, code,   // 銘柄(消えても読めるように名前とコードも残す)
 *   kind: 'split' | 'dividend', source: 'auto' | 'manual',
 *   status: 'applied'(反映した)| 'pending'(確認が必要)| 'dismissed'(反映しない)| 'undone'(元に戻した),
 *   seen,                    // 確認したら true(色を消す)
 *   eventDate, at,           // 分割・権利落ちの日、見つけた日時
 *   ratio,                   // 分割:1株 → ratio 株(併合は 1 未満)
 *   before, after,           // 反映前・後:{ quantity, avgPrice, price, priceUsd, perShare, months }
 *   proposal,                // 配当の提案:{ perShare, months, reason: 'none' | 'changed', events: [{ date, amount }] }
 *   note,
 * }
 */
(function (root) {
  'use strict';
  const MT = (root.MT = root.MT || {});
  const U = MT.util;
  const A = MT.assetsModel;

  const CHECK_HOURS = 20; // 分割・配当の確認は 1 日 1 回ほど
  const UNSUPPORTED_RETRY_DAYS = 7; // 価格取得の URL が対応していなかったら、次に試すまで
  const SPLIT_LOOKBACK_DAYS = 120; // 確認を始めた日より前の分割を「確認が必要」にする期間
  const DIV_LOOKBACK_DAYS = 400; // 配当の提案に使う期間(直近 1 年ほど)
  const PAY_MONTH_OFFSET = { jp: 3, us: 1 }; // 権利落ちの月 → 支払月の目安

  const round = (v, digits) => {
    const f = 10 ** digits;
    return Math.round(v * f) / f;
  };
  const DAY = 86400000;
  const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
  const byDate = (x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0);

  /** 問い合わせに使うコード(国内株はそのまま、米国株は US: を付ける。投資信託とコードの無いものは null) */
  function eventCode(h) {
    if (!h || !h.code || h.type === 'fund') return null;
    return h.type === 'us' ? `US:${h.code}` : h.code;
  }

  /** 分割の比率(1株 → 何株)。読めない・1 のときは null */
  function splitRatio(s) {
    const n = Number(s && s.numerator);
    const d = Number(s && s.denominator);
    if (!(n > 0) || !(d > 0) || !Number.isFinite(n) || !Number.isFinite(d)) return null;
    const r = round(n / d, 6);
    return r > 0 && r !== 1 ? r : null;
  }

  /** いま確認するか(価格取得の URL があり、確認できる株がある。前回から 20 時間・対応していなければ 7 日) */
  function eventsDue(a, { secrets = {}, now = new Date(), force = false } = {}) {
    if (!secrets.priceUrl || !a.holdings.some(eventCode)) return false;
    if (force) return true;
    const c = a.eventsCheck || {};
    const ago = (iso) => (iso ? now.getTime() - Date.parse(iso) : Infinity);
    if (ago(c.unsupportedAt) < UNSUPPORTED_RETRY_DAYS * DAY) return false;
    return ago(c.at) >= CHECK_HOURS * 3600000;
  }

  const snapshot = (h) => ({
    quantity: h.quantity,
    avgPrice: h.avgPrice,
    price: h.price,
    priceUsd: h.priceUsd,
    perShare: h.dividend.perShare,
    months: [...h.dividend.months],
  });

  /** 分割・併合を数量と単価に反映する(評価額・取得額は変わらない) */
  function splitHolding(h, ratio) {
    const before = snapshot(h);
    h.quantity = round(h.quantity * ratio, 6);
    h.avgPrice = round(h.avgPrice / ratio, 4);
    if (h.price != null) h.price = round(h.price / ratio, 4);
    if (h.priceUsd != null) h.priceUsd = round(h.priceUsd / ratio, 4);
    if (h.dividend.perShare != null) h.dividend.perShare = round(h.dividend.perShare / ratio, 4);
    return { before, after: snapshot(h) };
  }

  function addChange(a, c) {
    a.changes.unshift(A.cleanChange(c));
    if (a.changes.length > A.CHANGES_MAX) a.changes.length = A.CHANGES_MAX;
    return a.changes[0];
  }

  const hasKey = (a, key) => a.changes.some((c) => c.key === key);
  const base = (h, now) => ({ holdingId: h.id, name: h.name, code: h.code, at: now.toISOString() });

  /** 権利落ちの月から、支払月の目安 */
  function payMonths(type, dividends) {
    const off = PAY_MONTH_OFFSET[type === 'us' ? 'us' : 'jp'];
    return [...new Set(dividends.map((d) => ((Number(d.date.slice(5, 7)) - 1 + off) % 12) + 1))].sort((x, y) => x - y);
  }

  const sameAmount = (x, y) => x != null && y != null && Math.abs(x - y) < 1e-4 * Math.max(1, Math.abs(y));

  /**
   * 問い合わせの結果を保有と見比べて、分割の反映・配当の提案を作る(store.update の中で、価格の反映より前に呼ぶ)
   * @param {{events: object}} report fetchEvents の結果
   * @returns {object[]} 新しく作ったお知らせ
   */
  function applyEvents(a, report, now = new Date()) {
    const today = U.todayStr(now);
    const created = [];
    for (const h of a.holdings) {
      const code = eventCode(h);
      const ev = code && report.events ? report.events[code] : null;
      if (!ev) continue;
      const first = !h.eventsSince;
      const since = h.eventsSince || today;
      // 新しいもの:確認を始めた日以後(同じ日のものは、あとから載ることがあるのでもう一度見る。二度目は key で除く)
      const isNew = (date) => !first && date >= since;
      let latest = since;

      // 株式分割・併合
      for (const s of [...(ev.splits || [])].sort(byDate)) {
        const ratio = splitRatio(s);
        if (!ratio || !U.isDateStr(s.date) || s.date > today) continue;
        const key = `split:${h.id}:${s.date}`;
        if (hasKey(a, key)) continue;
        if (isNew(s.date)) {
          const { before, after } = splitHolding(h, ratio);
          created.push(addChange(a, { ...base(h, now), key, kind: 'split', source: 'auto', status: 'applied', seen: false, eventDate: s.date, ratio, before, after }));
        } else if (first && daysBetween(s.date, today) <= SPLIT_LOOKBACK_DAYS) {
          created.push(
            addChange(a, {
              ...base(h, now),
              key,
              kind: 'split',
              source: 'auto',
              status: 'pending',
              seen: false,
              eventDate: s.date,
              ratio,
              note: '確認を始める前の分割です。アプリの数量が分割前のままなら「反映する」を押してください。',
            })
          );
        }
        if (s.date > latest) latest = s.date;
      }

      // 配当
      const divs = [...(ev.dividends || [])].filter((d) => U.isDateStr(d.date) && d.date <= today && typeof d.amount === 'number' && d.amount > 0).sort(byDate);
      const recent = divs.filter((d) => daysBetween(d.date, today) <= DIV_LOOKBACK_DAYS);
      const fresh = divs.filter((d) => isNew(d.date));
      const last = (fresh.length ? fresh : recent)[(fresh.length ? fresh : recent).length - 1];
      const cur = h.dividend.perShare;
      let reason = null;
      if (fresh.length && !sameAmount(last.amount, cur)) reason = cur == null ? 'none' : 'changed';
      else if (first && cur == null && recent.length) reason = 'none';
      if (reason) {
        const key = `div:${h.id}:${last.date}`;
        if (!hasKey(a, key)) {
          const months = payMonths(h.type, recent.length ? recent : [last]);
          created.push(
            addChange(a, {
              ...base(h, now),
              key,
              kind: 'dividend',
              source: 'auto',
              status: 'pending',
              seen: false,
              eventDate: last.date,
              before: snapshot(h),
              proposal: { perShare: round(last.amount, 4), months, reason, events: recent.slice(-8) },
            })
          );
        }
      }
      if (divs.length && divs[divs.length - 1].date > latest) latest = divs[divs.length - 1].date;
      h.eventsSince = latest > today ? today : latest;
    }
    a.eventsCheck = { ...a.eventsCheck, at: now.toISOString(), unsupportedAt: null, error: null };
    return created;
  }

  /** 価格取得の URL が分割・配当の確認に対応していなかった・失敗したとき */
  function markCheckFailed(a, { unsupported = false, error = null } = {}, now = new Date()) {
    a.eventsCheck = {
      at: unsupported ? a.eventsCheck.at : now.toISOString(),
      unsupportedAt: unsupported ? now.toISOString() : null,
      error: unsupported ? null : error,
    };
  }

  const find = (a, id) => a.changes.find((c) => c.id === id) || null;
  const holdingOf = (a, c) => (c && c.holdingId ? a.holdings.find((h) => h.id === c.holdingId) || null : null);

  /** 確認が必要な分割を反映する */
  function applyPendingSplit(a, changeId) {
    const c = find(a, changeId);
    const h = holdingOf(a, c);
    if (!c || c.kind !== 'split' || c.status !== 'pending' || !h || !c.ratio) return false;
    const { before, after } = splitHolding(h, c.ratio);
    Object.assign(c, { status: 'applied', seen: true, before, after });
    return true;
  }

  /** 配当の提案を反映する(金額・支払月は画面で直したもの) */
  function applyDividend(a, changeId, { perShare, months }) {
    const c = find(a, changeId);
    const h = holdingOf(a, c);
    if (!c || c.kind !== 'dividend' || c.status !== 'pending' || !h) return false;
    if (!(typeof perShare === 'number' && perShare > 0)) return false;
    const before = snapshot(h);
    h.dividend.perShare = round(perShare, 4);
    h.dividend.months = [...new Set((months || []).filter((m) => Number.isInteger(m) && m >= 1 && m <= 12))].sort((x, y) => x - y);
    Object.assign(c, { status: 'applied', seen: true, before, after: snapshot(h) });
    return true;
  }

  /** 反映しない(提案・確認が必要なもの) */
  function dismiss(a, changeId) {
    const c = find(a, changeId);
    if (!c || c.status !== 'pending') return false;
    Object.assign(c, { status: 'dismissed', seen: true });
    return true;
  }

  /**
   * 反映したものを元に戻す。
   * 分割:数量・平均取得単価・1株配当は、反映後から変わっていなければ反映前の値に、変わっていれば分割数で割り戻す。
   *       今の価格は、反映後から変わっていなければ反映前の値に(価格を更新したあとなら、そのまま)
   * 配当:反映前の 1株配当と支払月に戻す
   */
  function undo(a, changeId) {
    const c = find(a, changeId);
    const h = holdingOf(a, c);
    if (!c || c.status !== 'applied' || !h || !c.before || !c.after) return false;
    if (c.kind === 'split') {
      const back = (cur, b, af, inverse) => (cur === af ? b : cur == null ? cur : inverse(cur));
      h.quantity = back(h.quantity, c.before.quantity, c.after.quantity, (v) => round(v / c.ratio, 6));
      h.avgPrice = back(h.avgPrice, c.before.avgPrice, c.after.avgPrice, (v) => round(v * c.ratio, 4));
      h.dividend.perShare = back(h.dividend.perShare, c.before.perShare, c.after.perShare, (v) => round(v * c.ratio, 4));
      if (h.price === c.after.price) h.price = c.before.price;
      if (h.priceUsd === c.after.priceUsd) h.priceUsd = c.before.priceUsd;
    } else {
      h.dividend.perShare = c.before.perShare == null ? null : c.before.perShare;
      h.dividend.months = [...(c.before.months || [])];
    }
    Object.assign(c, { status: 'undone', seen: true });
    return true;
  }

  /** 手で株式分割・併合を反映する(銘柄のメニューから) */
  function manualSplit(a, holdingId, ratio, now = new Date()) {
    const h = a.holdings.find((x) => x.id === holdingId);
    const r = typeof ratio === 'number' && Number.isFinite(ratio) && ratio > 0 ? round(ratio, 6) : null;
    if (!h || !r || r === 1) return null;
    const { before, after } = splitHolding(h, r);
    return addChange(a, { ...base(h, now), key: `manual:${U.uid('split')}`, kind: 'split', source: 'manual', status: 'applied', seen: true, eventDate: U.todayStr(now), ratio: r, before, after });
  }

  /** 確認した(色を消す)。ids を省くと、反映したものを全部 */
  function markSeen(a, ids) {
    const set = ids ? new Set([].concat(ids)) : null;
    let n = 0;
    for (const c of a.changes) {
      if (c.seen || c.status === 'pending') continue;
      if (set && !set.has(c.id)) continue;
      c.seen = true;
      n++;
    }
    return n;
  }

  /** 目立たせるもの(確認が必要・反映したがまだ確認していない) */
  function attention(a) {
    return a.changes.filter((c) => c.status === 'pending' || (c.status === 'applied' && !c.seen));
  }

  /** 銘柄ごとの、目立たせるお知らせ */
  function attentionByHolding(a) {
    const m = new Map();
    for (const c of attention(a)) {
      if (!c.holdingId) continue;
      if (!m.has(c.holdingId)) m.set(c.holdingId, []);
      m.get(c.holdingId).push(c);
    }
    return m;
  }

  /** 優待の株数の条件に足りないか */
  function benefitShort(h) {
    return !!(h.benefit && h.benefit.content && h.benefit.minShares && h.quantity < h.benefit.minShares);
  }

  /** 分割の比率の読み方(1株 → 3株 など) */
  function ratioText(r) {
    if (!r) return '';
    if (r >= 1) return `1株 → ${U.formatNumber(r, 6)}株`;
    const inv = round(1 / r, 6);
    return `${U.formatNumber(inv, 6)}株 → 1株(併合)`;
  }

  MT.assetEvents = {
    CHECK_HOURS,
    UNSUPPORTED_RETRY_DAYS,
    SPLIT_LOOKBACK_DAYS,
    DIV_LOOKBACK_DAYS,
    PAY_MONTH_OFFSET,
    eventCode,
    splitRatio,
    eventsDue,
    splitHolding,
    payMonths,
    applyEvents,
    markCheckFailed,
    applyPendingSplit,
    applyDividend,
    dismiss,
    undo,
    manualSplit,
    markSeen,
    attention,
    attentionByHolding,
    benefitShort,
    ratioText,
  };
})(typeof window !== 'undefined' ? window : globalThis);
