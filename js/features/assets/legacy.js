/*
 * 旧・資産管理アプリのバックアップ(JSON)を、新しい形に変換する
 *
 * 旧形式:
 *   holdings: [{ id, broker, accountType: "特定"|"一般"|"NISA", type: "JP"|"US"|"FUND", code, name, quantity, avgPrice }]
 *   history:  [{ date: "YYYY/M/D", value }]
 *   prices:   { コード: 価格 }
 *   lastTotal: 数値
 * 旧 "NISA" は新旧が分からないので、仮に新 NISA にして nisaUnsure を付ける(読み込み後に選び直す)。
 * はっきりしない点(投資信託の数量の単位、米国株の取得単価の通貨)は、確認画面で選べるようにする。
 */
(function (root) {
  'use strict';
  const MT = (root.MT = root.MT || {});
  const U = MT.util;
  const A = MT.assetsModel;

  const KEYS = ['holdings', 'history', 'prices', 'lastTotal'];
  const TYPE_MAP = { JP: 'jp', US: 'us', FUND: 'fund' };
  const ACCOUNT_MAP = { 特定: 'tokutei', 一般: 'ippan', NISA: 'nisa_new', 旧NISA: 'nisa_old', 新NISA: 'nisa_new' };

  const str = (v) => (v == null ? '' : String(v));
  const asList = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);

  function parse(textValue) {
    let obj;
    try {
      obj = JSON.parse(String(textValue || '').trim());
      if (typeof obj === 'string') obj = JSON.parse(obj);
    } catch (e) {
      return { ok: false, error: 'JSON として読み取れませんでした。バックアップの文字をすべてコピーしたか確認してください。' };
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, error: '旧・資産管理アプリのバックアップの形ではありません。' };
    for (const k of ['holdings', 'history', 'prices']) {
      if (typeof obj[k] === 'string' && /^\s*[[{]/.test(obj[k])) {
        try {
          obj[k] = JSON.parse(obj[k]);
        } catch (e) {
          /* そのまま(後で報告) */
        }
      }
    }
    if (!Array.isArray(obj.holdings)) return { ok: false, error: '旧・資産管理アプリのバックアップの形ではありません(holdings が見つかりません)。' };
    return { ok: true, obj };
  }

  function num(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const r = U.parseDecimal(str(v), 6);
    return r.ok ? r.value : null;
  }

  function priceOf(prices, code) {
    if (!prices || typeof prices !== 'object') return null;
    const c = A.normCode(code);
    for (const k of Object.keys(prices)) if (A.normCode(k) === c) return num(prices[k]);
    return null;
  }

  /**
   * 読み込む前の下調べ:件数と、はっきりしない点の推測
   * fundUnit: 'raw'(旧アプリの数量は口数そのまま → 1万で割る)/ 'asis'(すでに口数÷1万)
   */
  function analyze(obj) {
    const hs = asList(obj.holdings);
    const funds = hs.filter((x) => str(x.type).toUpperCase() === 'FUND');
    const us = hs.filter((x) => str(x.type).toUpperCase() === 'US');
    const lastTotal = num(obj.lastTotal);
    let fundGuess = funds.some((x) => (num(x.quantity) || 0) >= 1000) ? 'raw' : 'asis';
    let guessReason = '数量の大きさから推測しました';
    if (funds.length && lastTotal > 0) {
      // 価格のある国内株・投資信託だけで合計を出し、lastTotal に近い方を選ぶ(米国株はどちらも同じだけずれる)
      let base = 0;
      let fundAsIs = 0;
      let priced = 0;
      for (const x of hs) {
        const t = str(x.type).toUpperCase();
        if (t === 'US') continue;
        const p = priceOf(obj.prices, x.code);
        const q = num(x.quantity);
        if (p == null || q == null) continue;
        priced++;
        if (t === 'FUND') fundAsIs += q * p;
        else base += q * p;
      }
      if (priced) {
        const diffAsIs = Math.abs(base + fundAsIs - lastTotal);
        const diffRaw = Math.abs(base + fundAsIs / 10000 - lastTotal);
        fundGuess = diffRaw < diffAsIs ? 'raw' : 'asis';
        guessReason = '旧アプリの最後の総資産(lastTotal)に近くなる方を選びました';
      }
    }
    return {
      holdings: hs.length,
      nisa: hs.filter((x) => str(x.accountType).trim() === 'NISA').length,
      funds: funds.length,
      us: us.length,
      fundGuess,
      guessReason,
      fundExample: funds[0] ? { name: str(funds[0].name || funds[0].code), quantity: num(funds[0].quantity) } : null,
      usExample: us[0] ? { name: str(us[0].name || us[0].code), avgPrice: num(us[0].avgPrice), price: priceOf(obj.prices, us[0].code) } : null,
      lastTotal,
      history: asList(obj.history).length,
    };
  }

  /** "YYYY/M/D"(YYYY-MM-DD なども可)→ "YYYY-MM-DD" */
  function toDate(v) {
    const m = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/.exec(str(v).trim());
    if (!m) return null;
    const out = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    return U.isDateStr(out) ? out : null;
  }

  /**
   * 変換する。今のデータ(current)は書き換えず、新しいデータ全体を返す。
   * 置き換えるのは資産管理の「保有」と「履歴」。手入力の資産と設定は残す。
   * @param {{fundUnit: 'raw'|'asis', usAvg: 'yen'|'usd', fxRate?: number}} options
   */
  function convert(obj, current, options) {
    const opt = { fundUnit: 'asis', usAvg: 'yen', fxRate: null, ...options };
    const data = JSON.parse(JSON.stringify(current));
    const a = data.assets;
    const issues = [];
    const notes = [];
    const holdings = [];
    let priced = 0;

    asList(obj.holdings).forEach((x, i) => {
      const label = str(x.name || x.code).trim() || `${i + 1}件目`;
      const where = `銘柄「${label}」`;
      let type = TYPE_MAP[str(x.type).trim().toUpperCase()];
      if (!type) {
        type = A.guessType(x.code) || 'jp';
        issues.push(`${where}:種別「${str(x.type) || '(空)'}」が分からないため「${A.label(A.TYPES, type)}」にしました`);
      }
      const accRaw = str(x.accountType).trim();
      let account = ACCOUNT_MAP[accRaw];
      if (!account) {
        account = 'tokutei';
        issues.push(`${where}:口座区分「${accRaw || '(空)'}」が分からないため「特定」にしました`);
      }
      let quantity = num(x.quantity);
      if (quantity == null || quantity <= 0) {
        issues.push(`${where}:数量「${str(x.quantity)}」を読み取れないため、読み込みませんでした`);
        return;
      }
      if (type === 'fund' && opt.fundUnit === 'raw') quantity = quantity / 10000;
      let avgPrice = num(x.avgPrice);
      if (avgPrice == null || avgPrice < 0) {
        issues.push(`${where}:平均取得単価「${str(x.avgPrice)}」を読み取れないため 0 にしました(編集で直してください)`);
        avgPrice = 0;
      } else if (type === 'us' && opt.usAvg === 'usd') {
        if (opt.fxRate > 0) avgPrice = avgPrice * opt.fxRate;
        else issues.push(`${where}:USD/JPY が無いため、平均取得単価を円に換算できませんでした`);
      }
      const broker = str(x.broker).trim();
      if (!broker) notes.push(`${where}:証券会社が空のため「(証券会社なし)」にしました`);
      const p = priceOf(obj.prices, x.code);
      const h = A.cleanHolding({
        id: `hld_${str(x.id) || i}`,
        broker,
        account,
        type,
        code: x.code,
        name: x.name,
        quantity,
        avgPrice,
        nisaUnsure: accRaw === 'NISA',
        sellPriority: 'ifNeeded',
      });
      if (p != null && p > 0) {
        if (type === 'us') h.priceUsd = p;
        else h.price = p;
        h.priceSource = 'import';
        priced++;
      }
      holdings.push(h);
    });

    const hist = new Map();
    asList(obj.history).forEach((x, i) => {
      const date = toDate(x.date);
      const v = typeof x.value === 'number' ? Math.round(x.value) : U.parseYen(str(x.value)).value;
      if (!date) return issues.push(`履歴 ${i + 1}件目:日付「${str(x.date)}」を読み取れないため、読み込みませんでした`);
      if (!U.isYenValue(v)) return issues.push(`履歴「${date}」:金額「${str(x.value)}」を読み取れないため、読み込みませんでした`);
      hist.set(date, { date, total: v, gain: null, byBroker: {}, missing: 0 });
    });

    const nisa = holdings.filter((h) => h.nisaUnsure).length;
    if (nisa) notes.push(`「NISA」の銘柄 ${nisa}件は、仮に新 NISA にしました。読み込んだあとに旧 NISA / 新 NISA を選び直せます`);
    if (holdings.some((h) => h.type === 'fund')) {
      notes.push(opt.fundUnit === 'raw' ? '投資信託の数量は、旧アプリの値を 1万で割って「口数 ÷ 1万」にしました' : '投資信託の数量は、旧アプリの値をそのまま「口数 ÷ 1万」として読み込みました');
    }
    if (priced) notes.push(`旧アプリの価格(prices)を ${priced}件 入れました(日時は不明。「価格を更新」で新しくなります)`);
    const lastTotal = num(obj.lastTotal);
    if (lastTotal) notes.push(`旧アプリの最後の総資産(lastTotal)は ${U.yen(Math.round(lastTotal))}円でした。読み込み後に「価格を更新」して比べてください`);

    a.holdings = holdings;
    a.history = [...hist.values()].sort((x, y) => (x.date < y.date ? -1 : 1));
    return {
      data,
      report: { counts: { holdings: holdings.length, nisa, history: a.history.length, priced, keptManual: a.manual.length }, issues, notes },
    };
  }

  MT.assetsLegacy = { KEYS, parse, analyze, convert, toDate };
})(typeof window !== 'undefined' ? window : globalThis);
