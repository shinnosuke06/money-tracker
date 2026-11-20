/*
 * 支払い管理:カードを使った記録と、カードの明細の確認(データと計算。画面には触らない)
 *
 * カードを使ったら、すぐに記録する(金額・お店・日付)。明細が出たら、スクリーンショットを読み取って(または文字を貼り付けて)
 * 明細の行にし、記録と突き合わせる。記録が無い・いつもと違う行だけを「確かめてほしいもの」にする。
 *
 * payments.cardCheck = {
 *   cardIds: [billId],             // カードとして使う支払い(空なら、名前に「カード」が入った支払い)
 *   defaultCardId: billId | null,  // いつものカード(記録するとき最初に選ばれる)
 *   places: ['コンビニ', …],        // お店の候補(上から順に出る)
 *   records: [{ id, cardId, date, place, amount, createdAt }],         // カードを使った記録
 *   statements: [{ id, cardId, month, rows: [{ id, date, merchant, amount, status, memo }], createdAt }],
 *       // カードの明細。month はお支払いの月(YYYY-MM)。status:null(まだ)/ ok(問題なし)/ ng(おかしい)
 *   known: [{ id, cardId, merchant, amount, since }],                 // 毎月の支払いとして覚えたもの
 * }
 *
 * 明細の行の見分け(judge):
 *   record:記録と合う(同じカード・同じ金額・日付が前後 3 日以内)
 *   known :毎月の支払いとして覚えたものと、お店(似た名前)と金額が同じ。返金・取り消し(マイナス)も、ここ
 *   check :それ以外。理由(記録なし・金額が変わった・二重かも・外貨・少額・はじめての利用先)を付ける
 * 判定はスマホの中だけで行う。不正と決めつけるものではない。
 */
(function (root) {
  'use strict';
  const MT = (root.MT = root.MT || {});
  const U = MT.util;

  const RECORDS_MAX = 2000;
  const STATEMENTS_MAX = 120;
  const ROWS_MAX = 300;
  const KNOWN_MAX = 200;
  const PLACES_MAX = 30;
  const MATCH_DAYS = 3; // 記録と明細の日付のずれ(前後)
  const SMALL_AMOUNT = 300; // 少額(テスト決済かも)
  const SIMILAR = 0.5; // 名前が似ているとみなす度合い
  const DEFAULT_PLACES = ['コンビニ', 'スーパー', 'ドラッグストア', 'ガソリン', '飲食店', 'ネット通販'];

  const NAME_MAX = 60;
  const text = (s, max = NAME_MAX) =>
    String(s == null ? '' : s)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max);
  const id = (v, prefix) => (typeof v === 'string' && v ? v.slice(0, 64) : U.uid(prefix));
  const list = (arr) => (Array.isArray(arr) ? arr : []).filter((x) => x && typeof x === 'object');
  const yen = (v) => (Number.isSafeInteger(v) && Math.abs(v) <= 1e10 ? v : null);

  function create() {
    return { cardIds: [], defaultCardId: null, places: [...DEFAULT_PLACES], records: [], statements: [], known: [] };
  }

  function cleanRow(r) {
    return {
      id: id(r.id, 'srow'),
      date: U.isDateStr(r.date) ? r.date : null,
      merchant: text(r.merchant) || '(名前なし)',
      amount: yen(r.amount) ?? 0,
      status: r.status === 'ok' || r.status === 'ng' ? r.status : null,
      memo: String(r.memo == null ? '' : r.memo).slice(0, 300),
    };
  }

  function normalize(raw) {
    const c = create();
    const r = raw && typeof raw === 'object' ? raw : {};
    c.cardIds = [...new Set((Array.isArray(r.cardIds) ? r.cardIds : []).filter((x) => typeof x === 'string' && x))];
    c.defaultCardId = typeof r.defaultCardId === 'string' && r.defaultCardId ? r.defaultCardId : null;
    if (Array.isArray(r.places)) c.places = [...new Set(r.places.map((p) => text(p, 20)).filter(Boolean))].slice(0, PLACES_MAX);
    c.records = list(r.records)
      .filter((x) => typeof x.cardId === 'string' && U.isDateStr(x.date) && yen(x.amount) !== null)
      .map((x) => ({ id: id(x.id, 'use'), cardId: x.cardId, date: x.date, place: text(x.place, 30), amount: x.amount, createdAt: typeof x.createdAt === 'string' ? x.createdAt : null }))
      .slice(-RECORDS_MAX);
    c.statements = list(r.statements)
      .filter((s) => typeof s.cardId === 'string' && U.isYM(s.month))
      .map((s) => ({ id: id(s.id, 'stm'), cardId: s.cardId, month: s.month, rows: list(s.rows).map(cleanRow).filter((x) => x.date).slice(0, ROWS_MAX), createdAt: typeof s.createdAt === 'string' ? s.createdAt : null }))
      .slice(-STATEMENTS_MAX);
    c.known = list(r.known)
      .filter((k) => typeof k.cardId === 'string' && text(k.merchant) && yen(k.amount) !== null)
      .map((k) => ({ id: id(k.id, 'known'), cardId: k.cardId, merchant: text(k.merchant), amount: k.amount, since: U.isYM(k.since) ? k.since : null }))
      .slice(-KNOWN_MAX);
    return c;
  }

  // ---------------------------------------------------------------
  // カード
  // ---------------------------------------------------------------

  /** カードとして使う支払い(選んだもの。無ければ、名前に「カード」が入った支払い) */
  function cards(p) {
    const c = p.cardCheck;
    const active = p.bills.filter((b) => !b.endMonth || b.endMonth >= p.month);
    const chosen = c.cardIds.length ? c.cardIds.map((id2) => p.bills.find((b) => b.id === id2)).filter(Boolean) : active.filter((b) => /カード|card/i.test(b.name));
    return chosen;
  }

  /** 最初に選ぶカード(いつものカード → 前回記録したカード → 一覧の先頭) */
  function defaultCard(p) {
    const list2 = cards(p);
    const c = p.cardCheck;
    if (c.defaultCardId && list2.some((b) => b.id === c.defaultCardId)) return c.defaultCardId;
    const last = c.records[c.records.length - 1];
    if (last && list2.some((b) => b.id === last.cardId)) return last.cardId;
    return list2[0] ? list2[0].id : null;
  }

  // ---------------------------------------------------------------
  // 書き換え(store.update の中で呼ぶ)
  // ---------------------------------------------------------------

  /** カードを使った記録を足す。{ ok, error, record } */
  function addRecord(p, { cardId, date, place, amount }, now = new Date()) {
    if (!cards(p).some((b) => b.id === cardId)) return { ok: false, error: 'カードを選んでください' };
    if (!U.isDateStr(date)) return { ok: false, error: '日付を入れてください' };
    if (!(Number.isSafeInteger(amount) && amount > 0 && amount <= 1e10)) return { ok: false, error: '金額を入れてください' };
    const rec = { id: U.uid('use'), cardId, date, place: text(place, 30), amount, createdAt: now.toISOString() };
    p.cardCheck.records.push(rec);
    if (p.cardCheck.records.length > RECORDS_MAX) p.cardCheck.records.splice(0, p.cardCheck.records.length - RECORDS_MAX);
    return { ok: true, record: rec };
  }

  function updateRecord(p, recId, patch) {
    const r = p.cardCheck.records.find((x) => x.id === recId);
    if (!r) return false;
    if (patch.date !== undefined && U.isDateStr(patch.date)) r.date = patch.date;
    if (patch.place !== undefined) r.place = text(patch.place, 30);
    if (patch.amount !== undefined && Number.isSafeInteger(patch.amount) && patch.amount > 0) r.amount = patch.amount;
    if (patch.cardId !== undefined && cards(p).some((b) => b.id === patch.cardId)) r.cardId = patch.cardId;
    return true;
  }

  function removeRecord(p, recId) {
    const before = p.cardCheck.records.length;
    p.cardCheck.records = p.cardCheck.records.filter((x) => x.id !== recId);
    return p.cardCheck.records.length !== before;
  }

  /** 明細を保存する(同じカード・同じお支払いの月の明細は置き換える。確かめた印は、同じ行なら引き継ぐ) */
  function saveStatement(p, { cardId, month, rows }, now = new Date()) {
    if (!U.isYM(month)) return { ok: false, error: 'お支払いの月が正しくありません' };
    const clean = list(rows).map(cleanRow).filter((r) => r.date).slice(0, ROWS_MAX);
    if (!clean.length) return { ok: false, error: '明細の行がありません' };
    const old = p.cardCheck.statements.find((s) => s.cardId === cardId && s.month === month);
    if (old) {
      const used = new Set();
      for (const r of clean) {
        const prev = old.rows.find((o) => !used.has(o.id) && o.date === r.date && o.amount === r.amount && similar(o.merchant, r.merchant) >= SIMILAR);
        if (prev) {
          used.add(prev.id);
          r.status = prev.status;
          r.memo = prev.memo;
        }
      }
      old.rows = clean;
      old.createdAt = now.toISOString();
      return { ok: true, statement: old, replaced: true };
    }
    const st = { id: U.uid('stm'), cardId, month, rows: clean, createdAt: now.toISOString() };
    p.cardCheck.statements.push(st);
    p.cardCheck.statements.sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
    if (p.cardCheck.statements.length > STATEMENTS_MAX) p.cardCheck.statements.splice(0, p.cardCheck.statements.length - STATEMENTS_MAX);
    return { ok: true, statement: st, replaced: false };
  }

  function removeStatement(p, stId) {
    const before = p.cardCheck.statements.length;
    p.cardCheck.statements = p.cardCheck.statements.filter((s) => s.id !== stId);
    return p.cardCheck.statements.length !== before;
  }

  /**
   * 明細の 1 行を確かめた:status 'ok'(問題なし)/ 'ng'(おかしい)/ null(戻す)。
   * monthly:問題なしのとき、毎月の支払いとして覚える(同じお店の覚えがあれば金額を新しくする)
   */
  function setRowStatus(p, stId, rowId, status, { memo, monthly = false } = {}) {
    const st = p.cardCheck.statements.find((s) => s.id === stId);
    const row = st && st.rows.find((r) => r.id === rowId);
    if (!row) return false;
    row.status = status === 'ok' || status === 'ng' ? status : null;
    if (memo !== undefined) row.memo = String(memo || '').slice(0, 300);
    if (row.status === 'ok' && monthly) remember(p, st.cardId, row.merchant, row.amount, st.month);
    return true;
  }

  function remember(p, cardId, merchant, amount, since) {
    const k = p.cardCheck.known.find((x) => x.cardId === cardId && similar(x.merchant, merchant) >= SIMILAR);
    if (k) {
      k.amount = amount;
      k.merchant = text(merchant);
    } else {
      p.cardCheck.known.push({ id: U.uid('known'), cardId, merchant: text(merchant), amount, since: U.isYM(since) ? since : null });
      if (p.cardCheck.known.length > KNOWN_MAX) p.cardCheck.known.splice(0, p.cardCheck.known.length - KNOWN_MAX);
    }
  }

  function removeKnown(p, knownId) {
    const before = p.cardCheck.known.length;
    p.cardCheck.known = p.cardCheck.known.filter((k) => k.id !== knownId);
    return p.cardCheck.known.length !== before;
  }

  function setPlaces(p, places) {
    p.cardCheck.places = [...new Set((Array.isArray(places) ? places : []).map((x) => text(x, 20)).filter(Boolean))].slice(0, PLACES_MAX);
  }

  function setCards(p, cardIds, defaultCardId) {
    const ids = new Set(p.bills.map((b) => b.id));
    p.cardCheck.cardIds = [...new Set(cardIds)].filter((x) => ids.has(x));
    p.cardCheck.defaultCardId = defaultCardId && ids.has(defaultCardId) ? defaultCardId : null;
  }

  // ---------------------------------------------------------------
  // 明細の文字を読む(スクリーンショットの読み取り・貼り付け)
  // ---------------------------------------------------------------

  /** 読み取りの崩れを直す:日本語のあいだの空白、¥ の読み違い(\)、桁区切りの「.」、「/」の読み違い */
  function cleanLine(line) {
    let t = String(line)
      .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .replace(/[，]/g, ',')
      .replace(/[／]/g, '/')
      .replace(/\s+/g, ' ')
      .trim();
    for (let i = 0; i < 3; i++) t = t.replace(/([^\x00-\x7f]) (?=[^\x00-\x7f])/g, '$1');
    t = t.replace(/(\d{4}) ?年 ?(\d{1,2}) ?月 ?(\d{1,2}) ?日/g, '$1年$2月$3日');
    // 「10/03」の「/」が数字に読まれて「10703」「104712」のようになったとき(5〜6 けたで始まる行)
    t = t.replace(/^(\d{5,6})(?=[_\s]|$)/, (m) => {
      const mo = Number(m.slice(0, 2));
      const da = Number(m.slice(-2));
      return mo >= 1 && mo <= 12 && da >= 1 && da <= 31 ? `${m.slice(0, 2)}/${m.slice(-2)}` : m;
    });
    t = t.replace(/^(\d{1,2}\/\d{1,2})_+/, '$1 ');
    t = t.replace(/[\\¥￥]\s?(-?\d{1,3}(?:[.,]\d{3})+|-?\d+)(?!\s*円)/g, (m, n) => `${n.replace(/\./g, ',')}円`);
    t = t.replace(/(\d{1,3})\.(\d{3})(?=\s*円)/g, '$1,$2');
    t = t.replace(/[▲△]\s?(\d)/g, '-$1');
    return t;
  }

  const SKIP = /合計|ご請求|請求額|お支払い金額|お支払金額|ご利用可能|利用可能額|残高|ポイント|ご利用日|お支払い分/;
  const DATE_RE = /(?:(\d{4})[年\/.\-])?(\d{1,2})[月\/.\-](\d{1,2})日?/;
  const AMOUNT_RE = /(-?\d{1,3}(?:,\d{3})+|-?\d+)\s*円/;

  /**
   * 明細の文字を、行(日付・お店・金額)にする。日付と金額の形を手がかりに、1 行にまとまっていても、別の行に分かれていても読む。
   * 年の無い日付は、お支払いの月(payMonth)より後にならない年にする
   */
  function parseText(textIn, { payMonth } = {}) {
    const [py, pm] = U.isYM(payMonth) ? payMonth.split('-').map(Number) : [new Date().getFullYear(), new Date().getMonth() + 1];
    const toDate = (y, m, d) => {
      let year = y ? Number(y) : py;
      if (!y && Number(m) > pm) year = py - 1; // お支払いの月より後の月は、前の年の利用
      const s = `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      return U.isDateStr(s) ? s : null;
    };
    const lines = String(textIn || '')
      .split(/\r?\n/)
      .map(cleanLine)
      .filter(Boolean);
    const out = [];
    let cur = null;
    const push = () => {
      if (cur && cur.date && cur.amount != null) out.push({ date: cur.date, merchant: text(cur.merchant) || '(名前なし)', amount: cur.amount });
      cur = null;
    };
    for (const line of lines) {
      const d = line.match(DATE_RE);
      const a = line.match(AMOUNT_RE);
      if (SKIP.test(line) && !(d && d.index === 0)) continue;
      if (d && d.index === 0) {
        push();
        const date = toDate(d[1], d[2], d[3]);
        if (!date) continue;
        cur = { date, merchant: '', amount: null };
        let rest = line.slice(d[0].length);
        if (a) {
          cur.amount = Number(a[1].replace(/,/g, ''));
          rest = rest.replace(a[0], '');
        }
        cur.merchant = rest.replace(/^[\s_:・-]+/, '').trim();
        if (cur.amount != null && cur.merchant) push();
        continue;
      }
      if (!cur) continue;
      if (a && cur.amount == null) {
        cur.amount = Number(a[1].replace(/,/g, ''));
        const rest = line.replace(a[0], '').trim();
        if (rest && !cur.merchant) cur.merchant = rest;
      } else if (!cur.merchant) cur.merchant = line;
      if (cur.amount != null && cur.merchant) push();
    }
    push();
    return out.filter((r) => Number.isSafeInteger(r.amount) && r.amount !== 0);
  }

  /**
   * 何枚かのスクリーンショットを続けて読んだとき、前の 1 枚と重なって写っている行(次の 1 枚の先頭)を除く。
   * 次の 1 枚の先頭から、前の 1 枚にもある行(日付・金額が同じで、名前が似ている)が続くところまでを重なりとみなす
   * (読み取りで 1 行抜けても続けて見る。前の 1 枚に無い行が 2 つ続いたら、そこで重なりは終わり)。
   * 重なりの中でも、前の 1 枚で読み落とした行は残す。1 枚の中の同じ行(本当の二重請求かもしれない)は除かない。最後に日付の順に並べる
   */
  function joinPages(pages) {
    const out = [];
    let prev = [];
    for (const rows of pages) {
      const inPrev = (r) => prev.some((t) => t.date === r.date && t.amount === r.amount && similar(t.merchant, r.merchant) >= SIMILAR);
      let start = 0;
      let misses = 0;
      const dup = new Set();
      for (let j = 0; j < rows.length && prev.length; j++) {
        if (inPrev(rows[j])) {
          dup.add(j);
          start = j + 1;
          misses = 0;
        } else if (++misses >= 2) break;
      }
      // 重なりの中でも、前の 1 枚で読み落とした行は残す
      out.push(...rows.filter((r, j) => !(j < start && dup.has(j))));
      prev = rows;
    }
    // 日付の順に並べる(同じ日はもとの順)
    return out.map((r, i) => ({ r, i })).sort((x, y) => (x.r.date < y.r.date ? -1 : x.r.date > y.r.date ? 1 : x.i - y.i)).map((x) => x.r);
  }

  // ---------------------------------------------------------------
  // 突き合わせ
  // ---------------------------------------------------------------

  const norm = (t) =>
    String(t || '')
      .replace(/[\s・*＊()（）\-_.,]/g, '')
      .toLowerCase();

  /** 名前の似ている度合い(0〜1。2 文字ずつの重なり)。読み違いが少しあっても同じお店とみなすため */
  function similar(a, b) {
    const x = norm(a);
    const y = norm(b);
    if (!x || !y) return 0;
    if (x === y) return 1;
    if (x.length >= 3 && y.length >= 3 && (x.includes(y) || y.includes(x))) return 0.9;
    const grams = (t) => {
      const g = new Set();
      for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2));
      return g;
    };
    const gx = grams(x);
    const gy = grams(y);
    if (!gx.size || !gy.size) return 0;
    let hit = 0;
    for (const g of gx) if (gy.has(g)) hit++;
    return (2 * hit) / (gx.size + gy.size);
  }

  const dayDiff = (a, b) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000;
  const FOREIGN = /USD|EUR|GBP|\$|€|海外|外貨|ドル|ユーロ/i;

  /**
   * カードの明細を、記録・覚えた支払いと突き合わせる(そのカードの明細を古い順に。記録は 1 回しか使わない)。
   * @returns {Map<statementId, Array<row & { kind, reasons, record, known }>>}
   */
  function judgeCard(p, cardId) {
    const c = p.cardCheck;
    const stmts = c.statements.filter((s) => s.cardId === cardId).sort((a, b) => (a.month < b.month ? -1 : 1));
    const recs = c.records.filter((r) => r.cardId === cardId);
    const used = new Set();
    const known = c.known.filter((k) => k.cardId === cardId);
    const seenMerchants = [];
    const out = new Map();
    for (const st of stmts) {
      const rows = st.rows.map((r) => {
        const res = { ...r, kind: 'check', reasons: [], record: null, known: null };
        if (r.amount < 0) {
          res.kind = 'known';
          res.note = '返金・取り消し';
          return res;
        }
        const rec = recs
          .filter((x) => !used.has(x.id) && x.amount === r.amount && dayDiff(x.date, r.date) <= MATCH_DAYS)
          .sort((x, y) => dayDiff(x.date, r.date) - dayDiff(y.date, r.date))[0];
        const k = known.find((x) => similar(x.merchant, r.merchant) >= SIMILAR);
        if (rec) {
          used.add(rec.id);
          res.kind = 'record';
          res.record = rec;
        } else if (k && k.amount === r.amount) {
          res.kind = 'known';
          res.known = k;
        } else {
          if (k) res.reasons.push({ id: 'changed', text: `金額が変わった(前は ${U.yen(k.amount)}円)` });
          else res.reasons.push({ id: 'norecord', text: '記録なし' });
          if (FOREIGN.test(r.merchant)) res.reasons.push({ id: 'foreign', text: '外貨・海外' });
          if (st.rows.some((o) => o.id !== r.id && o.date === r.date && o.amount === r.amount && similar(o.merchant, r.merchant) >= 0.8)) res.reasons.push({ id: 'double', text: '二重かも(同じ日・同じ金額)' });
          if (!k && r.amount <= SMALL_AMOUNT) res.reasons.push({ id: 'small', text: '少額(テスト決済かも)' });
          if (!k && !seenMerchants.some((m) => similar(m, r.merchant) >= SIMILAR)) res.reasons.push({ id: 'first', text: 'はじめての利用先' });
        }
        return res;
      });
      for (const r of st.rows) seenMerchants.push(r.merchant);
      out.set(st.id, rows);
    }
    return out;
  }

  /** まだ確かめていない行(check で status が無いもの)。cardId を省くと全部のカード */
  function pending(p, cardId) {
    const ids = cardId ? [cardId] : [...new Set(p.cardCheck.statements.map((s) => s.cardId))];
    const out = [];
    for (const cid of ids) {
      for (const [stId, rows] of judgeCard(p, cid)) {
        for (const r of rows) if (r.kind === 'check' && !r.status) out.push({ statementId: stId, cardId: cid, row: r });
      }
    }
    return out;
  }

  /** 記録したけれど、どの明細にもまだ無いもの(新しい順) */
  function unmatchedRecords(p, cardId) {
    const used = new Set();
    for (const rows of judgeCard(p, cardId).values()) for (const r of rows) if (r.record) used.add(r.record.id);
    return p.cardCheck.records.filter((r) => r.cardId === cardId && !used.has(r.id)).sort((a, b) => (a.date < b.date ? 1 : -1));
  }

  /** 明細の合計と、そのカードの支払いの請求額(その月) */
  function totals(p, st) {
    const bill = p.bills.find((b) => b.id === st.cardId);
    const total = st.rows.reduce((t, r) => t + r.amount, 0);
    const billAmount = bill && st.month === p.month ? bill.amount : null;
    return { total, billAmount, diff: billAmount == null ? null : total - billAmount };
  }

  MT.cardCheck = {
    DEFAULT_PLACES,
    MATCH_DAYS,
    SMALL_AMOUNT,
    create,
    normalize,
    cards,
    defaultCard,
    addRecord,
    updateRecord,
    removeRecord,
    saveStatement,
    removeStatement,
    setRowStatus,
    removeKnown,
    setPlaces,
    setCards,
    cleanLine,
    parseText,
    joinPages,
    similar,
    judgeCard,
    pending,
    unmatchedRecords,
    totals,
  };
})(typeof window !== 'undefined' ? window : globalThis);
