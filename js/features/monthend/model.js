/*
 * 月末チェック:月末の入力の確認に使う集計(画面には触らない。新しいデータは持たない)
 *
 * 項目(月末記録・支払い・資産の価格・ポケカ在庫の相場・副業の入金確認・バックアップ)ごとに、
 * 最終更新日と状態(ok / warn = 要確認 / alert = 未入力 / none = 対象なし)を出す。
 * 「確認した」の印と、起動時の案内を出した日は、端末ごとの表示設定(moneyTracker:ui:*)に入れる(書き出しには含めない)。
 */
(function (root) {
  'use strict';
  const MT = (root.MT = root.MT || {});
  const U = MT.util;

  const STALE_DAYS = 35; // 最終更新からこの日数を超えたら「古い」
  const BACKUP_DAYS = 30; // 最後のバックアップからこの日数以上で案内を出す

  /** 'YYYY-MM-DD'(または ISO 日時)を、その日の 0 時(端末の時刻)に */
  function dayOf(s) {
    if (!s) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
    if (!m) return null;
    if (String(s).length > 10) {
      const t = new Date(s);
      return Number.isNaN(t.getTime()) ? null : new Date(t.getFullYear(), t.getMonth(), t.getDate());
    }
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  /** 何日前か(無ければ null) */
  function daysSince(s, now = new Date()) {
    const d = dayOf(s);
    if (!d) return null;
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((today - d) / 86400000);
  }

  const maxDate = (list) => list.filter(Boolean).reduce((a, b) => (a && a > b ? a : b), null);
  const dateStr = (d) => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : null);

  /** 最後のバックアップ(この端末で書き出した日時) */
  function backupInfo(now = new Date(), at = U.prefs.get('lastExportAt', null)) {
    const days = daysSince(at, now);
    return { at, days, stale: days === null || days >= BACKUP_DAYS };
  }

  /**
   * 月末チェックの項目
   * @returns {{ id, label, path, last: string|null, days: number|null, state: 'ok'|'warn'|'alert'|'none', detail: string }[]}
   */
  function items(d, now = new Date(), lastExportAt = U.prefs.get('lastExportAt', null)) {
    const cur = U.currentYM(now);
    const prev = U.ymAdd(cur, -1);
    const out = [];
    const item = (id, label, path, last, state, detail) => out.push({ id, label, path, last, days: daysSince(last, now), state, detail });
    const old = (last) => {
      const n = daysSince(last, now);
      return n === null || n > STALE_DAYS;
    };

    // 1. 月末記録
    {
      const MM = MT.monthlyModel;
      const m = d.monthly;
      const last = m ? maxDate(m.items.map((it) => it.lastUpdated)) : null;
      if (!m || !m.items.length) item('monthly', '月末記録', 'monthly', null, 'none', '項目がありません');
      else if (!m.records[prev]) item('monthly', '月末記録', 'monthly', last, 'alert', `${U.ymLabel(prev)}末の記録がまだありません`);
      else {
        const st = MM.monthStatus(m, prev);
        const n = st.carried + st.empty;
        item('monthly', '月末記録', 'monthly', last, n ? 'warn' : 'ok', n ? `${U.ymLabel(prev)}末:まだ確認していない項目 ${n}件` : `${U.ymLabel(prev)}末の記録は確認済み`);
      }
    }

    // 2. 支払い(口座の残高・未入力)
    {
      const p = d.payments;
      if (!p || (!p.accounts.length && !p.bills.length && !p.incomes.length)) item('payments', '支払い', 'payments', null, 'none', '支払い・口座がありません');
      else {
        const last = maxDate(p.accounts.map((a) => a.balanceDate));
        const w = MT.paymentsModel.warnings(d, p.month);
        const missing = w.missingAmount.length + w.missingSpecial.length + w.missingBalance.length + w.missingIncome.length;
        if (missing) item('payments', '支払い', 'payments', last, 'warn', `未入力 ${missing}件(請求額・入金・残高など)`);
        else if (p.accounts.length && old(last)) item('payments', '支払い', 'payments', last, 'warn', '口座の現在残高が古いままです');
        else item('payments', '支払い', 'payments', last, 'ok', '残高と支払いは入力済み');
      }
    }

    // 3. 資産(価格の更新)
    {
      const a = d.assets;
      if (!a || (!a.holdings.length && !a.manual.length)) item('assets', '資産(価格の更新)', 'assets', null, 'none', '資産がありません');
      else {
        const last = a.lastUpdateAt ? dateStr(dayOf(a.lastUpdateAt)) : null;
        const missing = MT.assetsModel.summary(a).missing;
        if (old(last)) item('assets', '資産(価格の更新)', 'assets', last, 'warn', last ? '価格の更新から日がたっています' : 'まだ価格を更新していません');
        else if (missing) item('assets', '資産(価格の更新)', 'assets', last, 'warn', `価格未取得 ${missing}件`);
        else item('assets', '資産(価格の更新)', 'assets', last, 'ok', '価格は最近更新済み');
      }
    }

    // 4. ポケカ在庫(相場)
    {
      const inv = d.inventory;
      const held = inv ? inv.items.filter((x) => x.quantity > 0) : [];
      if (!held.length) item('inventory', 'ポケカ在庫(相場)', 'inventory', null, 'none', '在庫がありません');
      else {
        const last = maxDate(held.flatMap((x) => x.prices.map((pr) => pr.date)));
        item('inventory', 'ポケカ在庫(相場)', 'inventory', last, old(last) ? 'warn' : 'ok', old(last) ? '相場の記録が古いままです' : '相場は最近記録済み');
      }
    }

    // 5. 副業の入金確認
    {
      const sj = d.sidejob;
      if (!sj || !sj.clients.length) item('sidejob', '副業の入金確認', 'sidejob', null, 'none', '依頼元がありません');
      else {
        const first = `${cur}-01`;
        const last = maxDate(sj.records.map((r) => r.date));
        const unconfirmed = sj.records.filter((r) => r.date < first && !r.confirmed).length;
        item('sidejob', '副業の入金確認', 'sidejob', last, unconfirmed ? 'warn' : 'ok', unconfirmed ? `先月までの入金の未確認 ${unconfirmed}件` : '先月までの入金は確認済み');
      }
    }

    // 6. バックアップ
    {
      const b = backupInfo(now, lastExportAt);
      const last = b.at ? dateStr(dayOf(b.at)) : null;
      if (!b.at) item('backup', 'バックアップ', 'settings', null, 'alert', 'まだバックアップしていません');
      else item('backup', 'バックアップ', 'settings', last, b.stale ? 'warn' : 'ok', b.stale ? `最後のバックアップから ${b.days}日たっています` : 'バックアップは最近済み');
    }
    return out;
  }

  /**
   * 起動時に「月末の入力の確認」を出すか。
   * 出す条件:前月の月末記録が未入力、または前月末にまだ確認していない項目がある(月末記録のタブの印と同じ)。
   * あわせて、最後のバックアップから 30 日以上たっていれば、それも知らせる。
   * @returns {string[]} 知らせること(空なら出さない)
   */
  function promptReasons(d, now = new Date(), lastExportAt = U.prefs.get('lastExportAt', null)) {
    const list = items(d, now, lastExportAt);
    const reasons = [];
    const m = list.find((x) => x.id === 'monthly');
    if (m.state === 'alert' || m.state === 'warn') reasons.push(m.detail);
    // バックアップは、データがあるときだけ知らせる(使い始めの空の状態では出さない)
    const b = list.find((x) => x.id === 'backup');
    if (b.state !== 'ok' && MT.store.hasContent(d)) reasons.push(b.detail);
    return reasons;
  }

  // ---- 「確認した」の印(今月の分だけ。端末ごと) ----

  function doneMap(now = new Date()) {
    const v = U.prefs.get('monthEndDone', null);
    return v && v.ym === U.currentYM(now) && v.done && typeof v.done === 'object' ? v.done : {};
  }

  function setDone(id, on, now = new Date()) {
    const done = { ...doneMap(now) };
    if (on) done[id] = true;
    else delete done[id];
    U.prefs.set('monthEndDone', { ym: U.currentYM(now), done });
  }

  MT.monthEndModel = { STALE_DAYS, BACKUP_DAYS, daysSince, backupInfo, items, promptReasons, doneMap, setDone };
})(typeof window !== 'undefined' ? window : globalThis);
