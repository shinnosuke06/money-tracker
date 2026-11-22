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
 *   known: [{ id, cardId, merchant, amount, since, from, until }],    // 毎月の支払いとして覚えたもの(from より後・until までの月の明細に使う。空なら制限なし)
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
      .map((k) => ({ id: id(k.id, 'known'), cardId: k.cardId, merchant: text(k.merchant), amount: k.amount, since: U.isYM(k.since) ? k.since : null, from: U.isYM(k.from) ? k.from : null, until: U.isYM(k.until) ? k.until : null }))
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
    // 毎月同じ支払いのチェックが無いときは、覚えを外さない(外すのは setMonthly で)
    if (row.status === 'ok' && monthly === true) setMonthly(p, stId, rowId, true);
    return true;
  }

  /** 覚えを、その月の明細に使うか(from:この月より後に使う、until:この月まで使う。空なら制限なし) */
  const appliesTo = (k, month) => (k.from == null || k.from < month) && (k.until == null || month <= k.until);

  /** その行と同じお店・同じ金額で、次の月から使う覚え(毎月同じ支払いのチェックが付いているか) */
  function monthlyOf(p, stId, rowId) {
    const st = p.cardCheck.statements.find((s) => s.id === stId);
    const row = st && st.rows.find((r) => r.id === rowId);
    if (!row) return null;
    const next = U.ymAdd(st.month, 1);
    return p.cardCheck.known.find((k) => k.cardId === st.cardId && k.amount === row.amount && appliesTo(k, next) && similar(k.merchant, row.merchant) >= SIMILAR) || null;
  }

  /**
   * 毎月同じ支払いのチェックを付ける・外す。前の月の明細の判定は変えない。
   * 付ける:その月の明細から覚え、次の月から使う。同じお店で金額の違う覚えは、その月までにする。
   * 外す:その月に覚えたものなら消し、前の月から覚えていたものなら、その月までにする
   */
  function setMonthly(p, stId, rowId, on) {
    const st = p.cardCheck.statements.find((s) => s.id === stId);
    const row = st && st.rows.find((r) => r.id === rowId);
    if (!row) return false;
    const cur = monthlyOf(p, stId, rowId);
    if (on) {
      if (cur) return true;
      const next = U.ymAdd(st.month, 1);
      for (const k of p.cardCheck.known) if (k.cardId === st.cardId && appliesTo(k, next) && similar(k.merchant, row.merchant) >= SIMILAR) k.until = st.month;
      p.cardCheck.known.push({ id: U.uid('known'), cardId: st.cardId, merchant: text(row.merchant), amount: row.amount, since: st.month, from: st.month, until: null });
      if (p.cardCheck.known.length > KNOWN_MAX) p.cardCheck.known.splice(0, p.cardCheck.known.length - KNOWN_MAX);
      return true;
    }
    if (!cur) return true;
    if (cur.from === st.month) p.cardCheck.known = p.cardCheck.known.filter((k) => k !== cur);
    else cur.until = st.month;
    return true;
  }

  /** いま使っている覚え(この先も使うもの) */
  function activeKnown(p, cardId) {
    return p.cardCheck.known.filter((k) => k.cardId === cardId && k.until == null);
  }

  /** 一覧から忘れる:そのカードのいちばん新しい明細の月までにする(その月に覚えたもの・明細が無いときは消す) */
  function removeKnown(p, knownId) {
    const k = p.cardCheck.known.find((x) => x.id === knownId);
    if (!k) return false;
    const months = p.cardCheck.statements.filter((s) => s.cardId === k.cardId).map((s) => s.month).sort();
    const last = months[months.length - 1];
    if (last && (k.from == null || k.from < last)) k.until = last;
    else p.cardCheck.known = p.cardCheck.known.filter((x) => x !== k);
    return true;
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

  /** 読み取りの崩れを直す:全角の英数字、日本語のあいだの空白、¥ の読み違い(\)、桁区切りの「.」、「/」の読み違い */
  function cleanLine(line) {
    let t = String(line)
      .normalize('NFKC')
      .replace(/\s+/g, ' ')
      .trim();
    for (let i = 0; i < 3; i++) t = t.replace(/([^\x00-\x7f]) (?=[^\x00-\x7f])/g, '$1');
    t = t.replace(/(\d{4}) ?年 ?(\d{1,2}) ?月 ?(\d{1,2}) ?日/g, '$1年$2月$3日');
    t = t.replace(/(^|[^\d])(\d{1,2}) ?月 ?(\d{1,2}) ?日/g, '$1$2月$3日');
    t = fixSlashDate(t);
    t = t.replace(/^((?:\d{4}\/)?\d{1,2}\/\d{1,2})_+/, '$1 ');
    t = t.replace(/(\d)[.,]{2,}(\d{3})(?!\d)/g, '$1,$2'); // 「1,.958」
    t = t.replace(/[\\¥￥]+\s?(-?\d{1,3}(?:[.,]\d{3})+|-?\d+)(?!\s*円)/g, (m, n) => `${n.replace(/\./g, ',')}円`);
    t = t.replace(/(\d{1,3})\.(\d{3})(?=\s*円)/g, '$1,$2');
    t = t.replace(/[▲△]\s?(\d)/g, '-$1');
    return t;
  }

  /**
   * 行の先頭の日付で、「/」が「7」「4」「/7」などに読まれたものを直す(「10703」「104712」「2026/710703」「2026710710」)。
   * 月・日は 2 けたのときだけ。後ろに「円」が続くもの(金額)は直さない
   */
  function fixSlashDate(t) {
    const m = t.match(/^(\d{4}[/7]?)?([\d/]{4,8})(?=[\s_(]|$)/);
    if (!m || /^(?:\d{4}\/)?\d{1,2}\/\d{1,2}$/.test(m[0]) || /^\s*円/.test(t.slice(m[0].length))) return t;
    const r = m[2].match(m[1] ? /^[/47]{0,2}(0[1-9]|1[0-2])[/47]{0,2}([0-2]\d|3[01])$/ : /^[/47]{0,2}(0[1-9]|1[0-2])[/47]{1,2}([0-2]\d|3[01])$/);
    return r ? `${m[1] ? `${m[1].slice(0, 4)}/` : ''}${r[1]}/${r[2]}${t.slice(m[0].length)}` : t;
  }

  // 明細の行ではないもの(見出し・合計・残高など)。日付で始まる行は、お店の名前に入っていても飛ばさない
  const SKIP = /合計|小計|ご請求|請求額|お支払い金額|お支払金額|ご利用可能|利用可能額|残高|ポイント|ご利用日|ご利用分|お支払い分|明細/;
  const COLUMNS = /(?:日付|金額|店名|利用先|利用日).*(?:日付|金額|店名|利用先|利用日)/; // 列の見出し・検索の欄
  const TOTAL = /小計|合計|ご請求(?:金)?額|お支払い?(?:金)?額/;
  // 行の先頭の日付:10/03、10月3日、2026/10/03、2026年10月3日、26.10.03(年が 2 けた)。後ろに数字や「,」が続くもの(金額)は日付にしない
  const DATE_RE = /^(?:(\d{4}|\d{2})[年/.-] ?)?(\d{1,2})[月/.-] ?(\d{1,2})日?(?![\d,])/;
  const AMOUNT_RE = /(-?\d{1,3}(?:,\d{3})+|-?\d+)\s*円/;
  const TAIL_AMOUNT = /(?:^|\s)(-?\d{1,3}(?:[.,]\d{3})+|-?\d{2,})\s*$/; // 行の終わりの「円」の無い金額(表の形)
  const WEEKDAY = /^\s*\(\s*[月火水木金土日](?:曜日?)?\s*\)/;
  const EDGE = /^[\s_:・|\\-]+|[\s_:・|\\-]+$/g;
  // 「円」が別の文字に読まれた金額だけの行(「15.830 折」「10.198q』」):桁区切りのある数字か 3 けた以上の数字と、後ろに 2 文字まで
  const LOOSE_AMOUNT = /^(-?\d{1,3}(?:[.,]\d{3})+|-?\d{3,})(.*)$/;
  const yenOf = (a) => Number(a[1].replace(/[.,]/g, ''));
  // 支払い方法(1回払い・「1回」の印 など。「1」の読み違いも)
  const PAY = /[0-9\]|lI!]{0,2}\s*回払い?|(?:^|\s)[0-9\]|lI!]{1,2}\s*回(?=\s|$)|(?:ボーナス)?一括払い?|分割払い|リボ払い/g;
  const LETTER = /[A-Za-z぀-ヿ㐀-鿿]/;

  /** 名前のつづきをつなぐ(日本語どうしは空白なしで) */
  const joinText = (a, b) => (!a ? b : !b ? a : /[^\x00-\x7f]$/.test(a) && /^[^\x00-\x7f]/.test(b) ? a + b : `${a} ${b}`);
  /** 金額の行の前に、お店の名前だけの行があるとき:最後の 1 行(短ければ、折り返しとみなして前の行とつなぐ) */
  const lead = (names) => {
    const ns = names.filter((n) => n.length >= 2 && LETTER.test(n)).slice(-2);
    if (!ns.length) return '';
    const last = ns[ns.length - 1];
    return ns.length === 2 && last.length <= 4 ? joinText(ns[0], last) : last;
  };
  const NAMELESS = '(名前なし)';
  const nameless = (m) => !m || m === NAMELESS;
  const row = (e) => ({ date: e.date, merchant: text(e.merchant) || NAMELESS, amount: e.amount });

  /** 1 行から、日付(行の先頭)・金額・お店の名前を取り出す。日付の形で日付として正しくない行は null(読み違い) */
  function fieldsOf(line, toDate) {
    const d = line.match(DATE_RE);
    const date = d ? toDate(d[1], d[2], d[3]) : null;
    if (d && !date) return null;
    const rest = d ? line.slice(d[0].length).replace(WEEKDAY, '') : line;
    // 金額は「円」つき。日付で始まる行(表の形)は、行の終わりの「円」の無い金額も
    let a = rest.match(AMOUNT_RE) || (d ? rest.match(TAIL_AMOUNT) : null);
    if (!a && !d) {
      const m = rest.match(LOOSE_AMOUNT);
      const junk = m ? m[2].replace(/[\s\p{P}\p{S}]/gu, '') : '';
      if (m && junk.length <= 2 && !/[\d年月日件回時分秒%]/.test(junk)) a = { 1: m[1], index: 0, 0: m[0] };
    }
    // 支払い方法(1回払い など)と、表の利用者の列(本人・家族)はお店の名前に入れない
    const tidy = (s) =>
      s
        .replace(PAY, ' ')
        .replace(EDGE, '')
        .replace(/\s*(?:本人|家族)$/, '')
        .replace(EDGE, '')
        .replace(/\s+/g, ' ');
    const before = tidy(a ? rest.slice(0, a.index) : rest);
    const after = a ? tidy(rest.slice(a.index + a[0].length)) : '';
    return {
      date,
      amount: a ? yenOf(a) : null,
      // 金額の後ろの 1〜2 文字は、矢印などの記号の読み違い
      merchant: joinText(before, after.length >= 3 ? after : ''),
      skip: !d && (SKIP.test(line) || COLUMNS.test(line)),
    };
  }

  /** 日付が先に来る形:日付の行から次の日付の行までを 1 件にする(1 行にまとまった形も) */
  function readDateFirst(fs, out) {
    let cur = null;
    const push = () => {
      if (cur && cur.date && cur.amount != null) out.push(row(cur));
      cur = null;
    };
    for (const f of fs) {
      if (f.skip) continue;
      if (f.date) {
        push();
        cur = { date: f.date, merchant: f.merchant, amount: f.amount };
        if (cur.amount != null && cur.merchant) push();
        continue;
      }
      if (!cur) continue;
      if (f.amount != null && cur.amount == null) {
        cur.amount = f.amount;
        if (f.merchant && !cur.merchant) cur.merchant = f.merchant;
      } else if (!cur.merchant && f.merchant) cur.merchant = f.merchant;
      if (cur.amount != null && cur.merchant) push();
    }
    push();
  }

  /** 日付が後に来る形:お店・金額の行(名前の折り返しが続くことも)の後の、日付の行で 1 件にする */
  function readDateLast(fs, out) {
    let cur = null;
    let names = [];
    for (const f of fs) {
      if (f.skip) {
        cur = null;
        names = [];
      } else if (f.amount != null) {
        cur = { date: f.date, amount: f.amount, merchant: f.merchant || lead(names), more: 0 };
        names = [];
        if (cur.date) {
          out.push(row(cur));
          cur = null;
        }
      } else if (f.date) {
        if (cur) out.push(row({ ...cur, date: f.date }));
        cur = null;
        names = [];
      } else if (f.merchant && cur && cur.more < 2) {
        cur.merchant = joinText(cur.merchant, f.merchant);
        cur.more++;
      } else if (f.merchant && !cur) names = [...names, f.merchant].slice(-2);
    }
  }

  /** 行を順に読む。日付と金額のどちらが先に出てくるかで、形を決める */
  function readLines(fs, out) {
    const first = fs.find((f) => !f.skip && (f.date || f.amount != null));
    (first && first.amount != null && !first.date ? readDateLast : readDateFirst)(fs, out);
  }

  /**
   * 空行で分かれたまとまり(スクリーンショットでは、明細の 1 件ごと)を読む。
   * 金額が 1 つのまとまりは、日付が前でも後でも 1 件にする。合計・小計のまとまりは除く。
   * 日付の無い件は、ほとんどの件に日付が無い形(日付が見出しになっている形)のときだけ、前の日付を使う。
   * それ以外(上下で切れて日付が写っていない行)は除く
   */
  function readGroups(groups, out) {
    const items = [];
    let lastDate = null;
    for (const fs of groups) {
      const amounts = fs.filter((f) => !f.skip && f.amount != null);
      const dates = fs.filter((f) => f.date);
      if (amounts.length > 1 || dates.length > 1) {
        const sub = [];
        readLines(fs, sub);
        sub.forEach((r) => items.push(r));
        if (sub.length) lastDate = sub[sub.length - 1].date;
        continue;
      }
      const d = dates[0] || null;
      const a = amounts[0];
      if (!a) {
        if (d) lastDate = d.date;
        continue;
      }
      const ai = fs.indexOf(a);
      if (fs.some((f, i) => f.skip && i > ai)) continue; // 合計・小計
      const plain = (f) => !f.skip && !f.date && f.amount == null && f.merchant;
      let merchant = a.merchant || (d && d.merchant) || lead(fs.slice(0, ai).filter(plain).map((f) => f.merchant));
      fs.slice(ai + 1)
        .filter(plain)
        .slice(0, 2)
        .forEach((f) => (merchant = joinText(merchant, f.merchant)));
      items.push({ date: a.date || (d && d.date) || null, amount: a.amount, merchant, fallback: lastDate });
      if (items[items.length - 1].date) lastDate = items[items.length - 1].date;
    }
    const dated = items.filter((e) => e.date).length;
    const headed = items.length - dated > dated;
    for (const e of items) {
      const date = e.date || (headed ? e.fallback : null);
      if (date) out.push(row({ ...e, date }));
    }
  }

  /**
   * 明細の文字を、行(日付・お店・金額)にする。日付と金額の形を手がかりに、1 行にまとまっていても、別の行に分かれていても、
   * 日付が前でも後でも読む。空行があれば、空行で分かれたまとまりごとに読む(スクリーンショットの読み取りは、1 件ごとに空行を入れる)。
   * 年の無い日付は、お支払いの月(payMonth)より後にならない年にする。年が 2 けたなら 2000 年代
   */
  function parseText(textIn, { payMonth } = {}) {
    const [py, pm] = U.isYM(payMonth) ? payMonth.split('-').map(Number) : [new Date().getFullYear(), new Date().getMonth() + 1];
    const toDate = (y, m, d) => {
      let year = y ? Number(y) + (y.length === 2 ? 2000 : 0) : py;
      if (!y && Number(m) > pm) year = py - 1; // お支払いの月より後の月は、前の年の利用
      const s = `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      return U.isDateStr(s) ? s : null;
    };
    const lines = String(textIn || '')
      .split(/\r?\n/)
      .map(cleanLine);
    const fields = (ls) => ls.map((l) => fieldsOf(l, toDate)).filter(Boolean);
    const out = [];
    if (lines.some((l) => !l)) {
      const groups = [[]];
      for (const l of lines) {
        if (l) groups[groups.length - 1].push(l);
        else if (groups[groups.length - 1].length) groups.push([]);
      }
      readGroups(groups.map(fields), out);
    }
    if (!out.length) readLines(fields(lines.filter(Boolean)), out);
    // 先頭・最後の行に名前が無く、ほかのほとんどの行に名前があるときは、上下で切れた行とみなして除く
    const named = out.filter((r) => !nameless(r.merchant)).length;
    if (named * 2 >= out.length) {
      if (out.length && nameless(out[out.length - 1].merchant)) out.pop();
      if (out.length && nameless(out[0].merchant)) out.shift();
    }
    return out.filter((r) => Number.isSafeInteger(r.amount) && r.amount !== 0);
  }

  /**
   * スクリーンショットの読み取り結果の行(文字と位置)を、上から順の文字にする。
   * 同じ高さに並んだ行(左のお店と右の金額が別に読まれたもの)は 1 行にし、
   * 行のあきが大きいところ(ふつうの行の高さの 1.5 倍より広いところ = 明細の 1 件の区切り)に空行を入れる
   */
  function layoutText(lines) {
    const ls = (Array.isArray(lines) ? lines : [])
      .filter((l) => l && l.bbox && String(l.text || '').trim())
      .map((l) => ({ text: String(l.text).trim(), x0: l.bbox.x0, y0: l.bbox.y0, y1: l.bbox.y1, cy: (l.bbox.y0 + l.bbox.y1) / 2 }))
      .sort((a, b) => a.cy - b.cy);
    const rows = [];
    for (const l of ls) {
      const r = rows[rows.length - 1];
      if (r && l.cy >= r.y0 && l.cy <= r.y1) {
        r.parts.push(l);
        r.y0 = Math.min(r.y0, l.y0);
        r.y1 = Math.max(r.y1, l.y1);
      } else rows.push({ parts: [l], y0: l.y0, y1: l.y1 });
    }
    if (!rows.length) return '';
    const heights = rows.map((r) => r.y1 - r.y0).sort((a, b) => a - b);
    const wide = heights[Math.floor(heights.length / 2)] * 1.5;
    const out = [];
    rows.forEach((r, i) => {
      if (i && r.y0 - rows[i - 1].y1 > wide) out.push('');
      out.push(
        r.parts
          .sort((a, b) => a.x0 - b.x0)
          .map((p) => p.text)
          .join(' ')
      );
    });
    return out.join('\n');
  }

  /**
   * 明細に書かれた合計(合計・小計・ご請求金額・お支払い金額)を見つける。読み取った行の合計と比べて、読み落としに気づくため。
   * 金額がその行に無ければ、次の行(金額だけの行)か前の行から。いくつかあれば一番大きいもの。無ければ null
   */
  function findTotal(textIn) {
    const ls = String(textIn || '')
      .split(/\r?\n/)
      .map(cleanLine);
    const amountOf = (l) => {
      if (!l || DATE_RE.test(l)) return null;
      const a = l.match(AMOUNT_RE) || l.match(TAIL_AMOUNT);
      return a ? yenOf(a) : null;
    };
    let best = null;
    ls.forEach((l, i) => {
      if (!TOTAL.test(l) || DATE_RE.test(l)) return;
      let v = amountOf(l);
      const next = ls[i + 1];
      if (v == null && next && !next.replace(AMOUNT_RE, '').trim()) v = amountOf(next);
      if (v == null) v = amountOf(ls[i - 1]);
      if (v != null && (best == null || v > best)) best = v;
    });
    return best;
  }

  /**
   * 何枚かのスクリーンショットを続けて読んだとき、前の 1 枚と重なって写っている行(次の 1 枚の先頭)を除く。
   * 次の 1 枚の先頭から、前の 1 枚にもある行(日付・金額が同じで、名前が似ている)が続くところまでを重なりとみなす
   * (読み取りで 1 行抜けても続けて見る。前の 1 枚に無い行が 2 つ続いたら、そこで重なりは終わり)。
   * 重なりの中でも、前の 1 枚で読み落とした行は残す。1 枚の中の同じ行(本当の二重請求かもしれない)は除かない。
   * 前の 1 枚の行とは 1 対 1 で重ねる(同じ行が 2 つ続くところで重なっても、1 つは残す)。名前が読めなかった行は日付と金額で重ねる。最後に日付の順に並べる
   */
  function joinPages(pages) {
    const out = [];
    let prev = [];
    for (const rows of pages) {
      const used = new Set();
      const findPrev = (r) => {
        for (let i = prev.length - 1; i >= 0; i--) {
          const t = prev[i];
          if (!used.has(i) && t.date === r.date && t.amount === r.amount && (nameless(t.merchant) || nameless(r.merchant) || similar(t.merchant, r.merchant) >= SIMILAR)) return i;
        }
        return -1;
      };
      let start = 0;
      let misses = 0;
      const dup = new Set();
      for (let j = 0; j < rows.length && prev.length; j++) {
        const k = findPrev(rows[j]);
        if (k >= 0) {
          used.add(k);
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

  const COMBOS_MAX = 10000; // 重複の選び方を探す数の上限(これより多いときは探さない)

  /**
   * 重複かもしれない行:同じ明細の中で、日付・金額が同じで、名前が似ている(どちらかが名前なしでもよい)行の 2 つ目から。
   * 返金(0 円以下)は入れない。明細の合計が ref(請求額など)より多く、その差にぴったり合う選び方
   * (まとまりごとに、2 つ目から何件を消すか)が 1 つだけなら、その行に checked を付ける
   * @returns {{ items: Array<{ row, count, checked }>, total: number, diff: number|null, matched: boolean }}
   */
  function duplicates(rows, ref) {
    const list = Array.isArray(rows) ? rows : [];
    const groups = [];
    for (const r of list) {
      if (!(r.amount > 0)) continue;
      const g = groups.find((x) => x[0].date === r.date && x[0].amount === r.amount && (nameless(x[0].merchant) || nameless(r.merchant) || similar(x[0].merchant, r.merchant) >= SIMILAR));
      if (g) g.push(r);
      else groups.push([r]);
    }
    const gs = groups.filter((g) => g.length > 1);
    const total = list.reduce((t, r) => t + (r.amount || 0), 0);
    const diff = Number.isSafeInteger(ref) ? total - ref : null;
    let pick = null;
    if (diff > 0 && gs.length && gs.reduce((n, g) => n * g.length, 1) <= COMBOS_MAX) {
      const found = [];
      const walk = (i, sum, chosen) => {
        if (found.length > 1 || sum > diff) return;
        if (i === gs.length) {
          if (sum === diff) found.push(chosen);
          return;
        }
        for (let c = 0; c < gs[i].length; c++) walk(i + 1, sum + c * gs[i][0].amount, [...chosen, c]);
      };
      walk(0, 0, []);
      if (found.length === 1) pick = found[0];
    }
    const items = [];
    gs.forEach((g, i) => g.slice(1).forEach((row, j) => items.push({ row, count: g.length, checked: !!pick && j < pick[i] })));
    return { items, total, diff, matched: !!pick };
  }

  /** 保存した明細から、選んだ行を消す(ほかの行と確かめた印はそのまま)。消した数を返す */
  function removeRows(p, stId, rowIds) {
    const st = p.cardCheck.statements.find((s) => s.id === stId);
    if (!st) return 0;
    const ids = new Set(Array.isArray(rowIds) ? rowIds : []);
    const before = st.rows.length;
    st.rows = st.rows.filter((r) => !ids.has(r.id));
    return before - st.rows.length;
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
        const k = known.find((x) => appliesTo(x, st.month) && similar(x.merchant, r.merchant) >= SIMILAR);
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
        // 確かめた行(問題なし・おかしい)は、あとで記録や覚えと合っても「確かめてほしいもの」に残す
        if (r.status) res.kind = 'check';
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
    monthlyOf,
    setMonthly,
    activeKnown,
    duplicates,
    removeRows,
    setPlaces,
    setCards,
    cleanLine,
    parseText,
    layoutText,
    findTotal,
    joinPages,
    similar,
    judgeCard,
    pending,
    unmatchedRecords,
    totals,
  };
})(typeof window !== 'undefined' ? window : globalThis);
