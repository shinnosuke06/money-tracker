/**
 * マネートラッカー:開示・決算(適時開示の要約と、決算発表予定日)  版 ir-v1
 *
 * アプリ(マネートラッカー)の「資産 → 開示・決算」から使う、Google Apps Script のウェブアプリです。
 * 通知はしません。アプリが開いたときに、ここに集めた結果を受け取ります。
 *
 * - 適時開示:無料の「やのしん WEB-API」(TDnet の開示の一覧)で、アプリから受け取った銘柄を見張る
 *     平日 11:30〜13:00・15:00〜18:00 は 5 分おき、平日 7:00〜22:00 のそのほかは 30 分おき、夜中と土日は 3 時間おき
 * - 要約:新しい開示の PDF を Gemini で要約し、【好材料】【悪材料】【中立】と目印(↑上方修正 など)を付ける
 *     目印は「資料に書かれた中身の向き」。株価がどう動くかの予想ではない
 *     1 回に 4 件・1 日 60 件まで(残りは次の回)。上限に当たったら後回しにして、表題と PDF は先に出す
 * - 決算発表予定日:日本取引所(JPX)の「決算発表予定日」の一覧(Excel)を 1 日 1 回(朝 6 時以降)読み込む
 * - どこかが失敗しても、前回の結果は残す(アプリには理由と一緒に前回の結果を返す)
 *
 * 使い方(README の「開示・決算」にも同じ手順):
 *   1. script.google.com で新しいプロジェクトを作り、このファイルの中身を貼り付けて保存する
 *   2. 上の関数の選択で「setup」を選んで「実行」(初めは許可を求められる)
 *      → 保存用のスプレッドシートと、5 分おきの定期実行ができる
 *   3. 「プロジェクトの設定」(歯車)→「スクリプト プロパティ」に GEMINI_API_KEY(Gemini の API キー)を追加
 *   4. 「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」、実行するユーザー「自分」、アクセス「全員」
 *      → 出てきた URL を、アプリの「設定 → 開示・決算」に貼る
 *
 * アプリから送られてくるのは銘柄コードだけです(株数や金額は来ません)。
 * このファイルにキーや個人の情報は書きません(キーはスクリプト プロパティに入れる)。
 */

const IR_VERSION = 'ir-v1';
const IR_YANOSHIN = 'https://webapi.yanoshin.jp/webapi/tdnet/list/';
const IR_GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
const IR_GEMINI_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite'];
const IR_JPX_PAGE = 'https://www.jpx.co.jp/listing/event-schedules/financial-announcement/index.html';
const IR_JPX_HOST = 'https://www.jpx.co.jp';

const IR_CODES_MAX = 100;            // 見張る銘柄の数の上限
const IR_CODES_PER_REQUEST = 30;     // やのしんに 1 回で聞く銘柄の数
const IR_FETCH_LIMIT = 100;          // やのしんから 1 回で受け取る件数
const IR_SUMMARY_PER_RUN = 4;        // 1 回の確認で要約する件数
const IR_SUMMARY_PER_DAY = 60;       // 1 日に要約する件数
const IR_SUMMARY_TRIES = 3;          // 要約を試す回数(これを超えたら「要約できなかった」)
const IR_SUMMARY_NEW_DAYS = 3;       // 見張り始めたときに、これより古い開示は自動では要約しない(画面から頼める)
const IR_KEEP_DAYS = 45;             // 開示を残す日数
const IR_ROWS_MAX = 3000;            // 開示を残す行数
const IR_PDF_MAX_BYTES = 20 * 1024 * 1024;
const IR_RUN_BUDGET_MS = 240 * 1000; // 1 回の実行でこれを過ぎたら残りは次の回(GAS の上限は 6 分)
const IR_EARNINGS_HOUR = 6;          // 決算発表予定日は、日本時間のこの時刻以降に 1 日 1 回
const IR_EARNINGS_FILES_MAX = 12;
const IR_SHEET = '開示';
const IR_COLUMNS = ['id', 'code', 'name', 'at', 'title', 'url', 'status', 'tries', 'tags', 'head', 'good', 'bad', 'neutral', 'reason', 'updatedAt'];

// 目印(資料に書かれた中身の向き)。up = ↑、down = ↓、flat = 向きなし
const IR_TAGS = [
  ['上方修正', 'up'], ['下方修正', 'down'], ['増配', 'up'], ['復配', 'up'], ['減配', 'down'], ['無配', 'down'],
  ['自社株買い', 'up'], ['優待新設', 'up'], ['優待拡充', 'up'], ['優待縮小', 'down'], ['優待廃止', 'down'],
  ['増収', 'up'], ['減収', 'down'], ['増益', 'up'], ['減益', 'down'], ['黒字転換', 'up'], ['赤字転落', 'down'],
  ['株式分割', 'flat'],
];
const IR_TAG_MAX = 4;

const IR_PROMPT = [
  'あなたは日本株の個人投資家のために、東証の適時開示の資料を読んで、事実だけを短くまとめる係です。',
  '添付の PDF を読み、指定の JSON で答えてください。',
  '・tags:次の一覧のうち、資料の中身に当てはまるものだけ(最大 ' + IR_TAG_MAX + ' 個。一覧にない言葉は使わない。無ければ空の配列)',
  '  一覧:' + IR_TAGS.map(function (t) { return t[0]; }).join('、'),
  '  上方修正・下方修正=業績予想の引き上げ・引き下げ、増配・復配・減配・無配=配当予想の変更、自社株買い=自己株式の取得の決定、',
  '  増収・減収・増益・減益=決算で売上高・営業利益が前年同期より増えた・減った、黒字転換・赤字転落=純利益の黒字・赤字の入れ替わり',
  '・head:何の開示かと結論を 1 文(60 字以内)',
  '・good:前年同期・前回の予想・会社の計画と比べて良くなったこと(箇条書き。無ければ空の配列)',
  '・bad:同じく悪くなったこと(無ければ空の配列)',
  '・neutral:良し悪しの向きが決まらないこと(日程・手続き・役員の変更など。無ければ空の配列)',
  '・箇条書きには、売上高・営業利益・純利益の金額と前年同期比、予想の修正前と修正後、配当額、取得する株数や金額や期間など、重要な数字を資料のとおりに入れる(単位を省かない)',
  '・資料に書かれていないことや、株価がどう動くかの予想は書かない。全体で 500 字以内',
].join('\n');

// ===================================================================
// 入口
// ===================================================================

/** 最初に 1 回だけ実行する:保存用のスプレッドシートと 5 分おきの定期実行を作る */
function setup() {
  irBook_();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'irTick') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('irTick').timeBased().everyMinutes(5).create();
  const key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  Logger.log('準備ができました。保存用のスプレッドシート:' + irBook_().getUrl());
  Logger.log(key ? 'Gemini の API キー:設定済み' : 'Gemini の API キー:まだです(スクリプト プロパティに GEMINI_API_KEY を追加してください)');
  Logger.log('次は「デプロイ」→「新しいデプロイ」→ ウェブアプリ(実行するユーザー:自分、アクセス:全員)');
}

/** 5 分おきの定期実行(setup で作る) */
function irTick() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return; // 前の回がまだ動いている
  try {
    irRun_(new Date(), {});
  } finally {
    lock.releaseLock();
  }
}

/** エディタから試すとき用:時間に関係なく、すぐに 1 回確かめる */
function irRunNow() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const st = irRun_(new Date(), { force: true, earnings: true });
    Logger.log(JSON.stringify({ codes: st.codes, lastError: st.lastError, earningsError: st.earningsError, summaryNote: st.summaryNote }));
  } finally {
    lock.releaseLock();
  }
}

/**
 * アプリからの問い合わせ
 *   ?api=state&codes=X101,X102     集めた結果を返す(見張る銘柄も、この codes にそろえる)
 *   ?api=refresh&codes=…           すぐに確かめてから返す(要約は 2 件まで)
 *   ?api=summarize&id=123          その開示を、いま要約して返す
 */
function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    if (p.api === 'state' || p.api === 'refresh') {
      if (p.codes !== undefined) irSaveCodes_(irParseCodes_(p.codes));
      if (p.api === 'refresh') {
        const lock = LockService.getScriptLock();
        if (lock.tryLock(20000)) {
          try {
            irRun_(new Date(), { force: true, maxSummaries: 2 });
          } finally {
            lock.releaseLock();
          }
        }
      }
      return irJson_(irState_(new Date()));
    }
    if (p.api === 'summarize') {
      const lock = LockService.getScriptLock();
      if (!lock.tryLock(20000)) return irJson_({ version: IR_VERSION, error: 'ほかの確認の途中です。少し待ってからもう一度押してください' });
      try {
        return irJson_({ version: IR_VERSION, item: irSummarizeOne_(String(p.id || '')) });
      } finally {
        lock.releaseLock();
      }
    }
    return irJson_({ version: IR_VERSION, error: 'api の指定がありません' });
  } catch (err) {
    return irJson_({ version: IR_VERSION, error: String(err && err.message ? err.message : err).slice(0, 200) });
  }
}

function irJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ===================================================================
// 確かめる(定期実行・すぐに確かめる)
// ===================================================================

function irRun_(now, opts) {
  const started = Date.now();
  const st = irLoadState_();
  const codes = st.codes || [];
  // 決算発表予定日(1 日 1 回。新しい銘柄が増えたときも)
  if (opts.earnings || irEarningsDue_(now, st, codes)) {
    try {
      const found = irFetchEarnings_(codes, now);
      st.earnings = irMergeEarnings_(st.earnings || {}, found, codes, irJst_(now).date);
      st.earningsAt = now.toISOString();
      st.earningsCodes = codes.slice();
      st.earningsError = null;
    } catch (err) {
      st.earningsError = irErrText_(err);
      st.earningsTriedAt = now.toISOString();
    }
  }
  // 適時開示
  if (codes.length && (opts.force || irShouldRun_(now, st.lastCheckAt))) {
    st.lastCheckAt = now.toISOString();
    try {
      const rows = irReadRows_();
      const items = irFetchDisclosures_(codes);
      const merged = irMergeRows_(rows, items, now, codes);
      const budget = { left: opts.maxSummaries == null ? IR_SUMMARY_PER_RUN : opts.maxSummaries, started: started };
      st.summaryNote = irSummarizePending_(merged, st, now, budget);
      irWriteRows_(irPruneRows_(merged, now));
      st.lastOkAt = now.toISOString();
      st.lastError = null;
    } catch (err) {
      st.lastError = irErrText_(err);
    }
  }
  irSaveState_(st);
  return st;
}

/** アプリに返す内容(見張っている銘柄の分だけ) */
function irState_(now) {
  const st = irLoadState_();
  const codes = st.codes || [];
  const set = {};
  codes.forEach(function (c) { set[c] = true; });
  const items = irReadRows_()
    .filter(function (r) { return set[r.code]; })
    .sort(function (a, b) { return b.id - a.id; })
    .slice(0, 300)
    .map(irPublicItem_);
  const earnings = {};
  Object.keys(st.earnings || {}).forEach(function (c) { if (set[c]) earnings[c] = st.earnings[c]; });
  return {
    version: IR_VERSION,
    now: now.toISOString(),
    codes: codes,
    lastCheckAt: st.lastCheckAt || null,
    lastOkAt: st.lastOkAt || null,
    lastError: st.lastError || null,
    earningsAt: st.earningsAt || null,
    earningsError: st.earningsError || null,
    summaryNote: st.summaryNote || null,
    items: items,
    earnings: earnings,
  };
}

function irPublicItem_(r) {
  return {
    id: r.id, code: r.code, name: r.name, at: r.at, title: r.title, url: r.url, status: r.status,
    tags: r.tags, head: r.head, good: r.good, bad: r.bad, neutral: r.neutral, reason: r.reason,
  };
}

// ===================================================================
// 時間(日本時間で決める)
// ===================================================================

/** 日本時間の { date: 'YYYY-MM-DD', dow: 0(日)〜6(土), min: 0〜1439 } */
function irJst_(now) {
  const j = new Date(now.getTime() + 9 * 3600 * 1000);
  const pad = function (n) { return (n < 10 ? '0' : '') + n; };
  return {
    date: j.getUTCFullYear() + '-' + pad(j.getUTCMonth() + 1) + '-' + pad(j.getUTCDate()),
    dow: j.getUTCDay(),
    min: j.getUTCHours() * 60 + j.getUTCMinutes(),
  };
}

/** いまの確認の間隔(分) */
function irIntervalMin_(now) {
  const j = irJst_(now);
  if (j.dow === 0 || j.dow === 6) return 180;
  const m = j.min;
  if ((m >= 690 && m < 780) || (m >= 900 && m < 1080)) return 5; // 11:30〜13:00・15:00〜18:00
  if (m >= 420 && m < 1320) return 30; // 7:00〜22:00
  return 180;
}

/** 前回から間隔ぶん(定期実行のずれを 1 分みる)たっていれば確かめる */
function irShouldRun_(now, lastIso) {
  if (!lastIso) return true;
  const gap = (now.getTime() - Date.parse(lastIso)) / 60000;
  return !(gap >= 0) || gap >= irIntervalMin_(now) - 1;
}

/** 決算発表予定日を読み込むか(1 日 1 回・朝 6 時以降。新しい銘柄が増えたら 1 時間あけて) */
function irEarningsDue_(now, st, codes) {
  if (!codes.length) return false;
  const j = irJst_(now);
  const tried = st.earningsTriedAt && now.getTime() - Date.parse(st.earningsTriedAt) < 60 * 60000;
  if (tried) return false;
  if (!st.earningsAt) return true;
  const last = irJst_(new Date(st.earningsAt));
  if (last.date !== j.date && j.min >= IR_EARNINGS_HOUR * 60) return true;
  const known = {};
  (st.earningsCodes || []).forEach(function (c) { known[c] = true; });
  const added = codes.some(function (c) { return !known[c]; });
  return added && now.getTime() - Date.parse(st.earningsAt) >= 60 * 60000;
}

// ===================================================================
// コード
// ===================================================================

/** 銘柄コードをそろえる(全角→半角・大文字。5 桁で末尾 0 の形は 4 桁に)。国内株の形でなければ '' */
function irNormalizeCode_(v) {
  if (v === null || v === undefined) return '';
  let s = String(v).trim().replace(/[０-９Ａ-Ｚａ-ｚ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xfee0); });
  s = s.toUpperCase().replace(/\s/g, '');
  if (/^[0-9][0-9A-Z]{3}0$/.test(s)) s = s.slice(0, 4);
  return /^[0-9][0-9A-Z]{3}$/.test(s) ? s : '';
}

function irParseCodes_(str) {
  const out = [];
  String(str || '').split(',').forEach(function (x) {
    const c = irNormalizeCode_(x);
    if (c && out.indexOf(c) < 0 && out.length < IR_CODES_MAX) out.push(c);
  });
  return out;
}

function irSaveCodes_(codes) {
  const st = irLoadState_();
  if (JSON.stringify(st.codes || []) === JSON.stringify(codes)) return;
  st.codes = codes;
  irSaveState_(st);
}

// ===================================================================
// 適時開示(やのしん WEB-API)
// ===================================================================

function irFetchDisclosures_(codes) {
  const all = {};
  for (let i = 0; i < codes.length; i += IR_CODES_PER_REQUEST) {
    const chunk = codes.slice(i, i + IR_CODES_PER_REQUEST);
    const res = UrlFetchApp.fetch(IR_YANOSHIN + chunk.join('-') + '.json2?limit=' + IR_FETCH_LIMIT, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw new Error('開示の一覧を取れませんでした(やのしん HTTP ' + res.getResponseCode() + ')');
    let json;
    try {
      json = JSON.parse(res.getContentText());
    } catch (e) {
      throw new Error('開示の一覧の形が読めませんでした');
    }
    irParseYanoshin_(json).forEach(function (it) { all[it.id] = it; });
  }
  return Object.keys(all).map(function (k) { return all[k]; });
}

/** やのしんの返事から、開示の一覧を取り出す */
function irParseYanoshin_(json) {
  let arr;
  if (Array.isArray(json)) arr = json;
  else if (json && Array.isArray(json.items)) arr = json.items;
  else throw new Error('開示の一覧の形が想定と違います');
  const out = [];
  arr.forEach(function (raw) {
    const t = raw && (raw.Tdnet || raw.TDnet || raw.tdnet || raw);
    if (!t) return;
    const id = Number(t.id);
    const code = irNormalizeCode_(t.company_code);
    if (!(id > 0) || !code) return;
    out.push({
      id: id,
      code: code,
      name: String(t.company_name || '').trim().slice(0, 60),
      at: String(t.pubdate || '').slice(0, 16),
      title: String(t.title || '').trim().slice(0, 200) || '(表題なし)',
      url: irPdfUrl_(t.document_url),
    });
  });
  return out;
}

/** やのしん経由の URL(rd.php?…)から、資料の URL を取り出す */
function irPdfUrl_(u) {
  let s = String(u || '').trim();
  const m = s.match(/rd\.php\?(https?:\/\/.+)$/);
  if (m) s = m[1];
  return /^https:\/\/\S+$/.test(s) ? s : /^http:\/\/\S+$/.test(s) ? s.replace(/^http:/, 'https:') : '';
}

/**
 * 取ってきた開示を、保存している行に足す(新しいものだけ)。
 * IR_SUMMARY_NEW_DAYS 日より前の開示(見張り始めた銘柄の過去の分など)は、自動では要約しない(skipped。画面から頼める)
 */
function irMergeRows_(rows, items, now, codes) {
  const byId = {};
  rows.forEach(function (r) { byId[r.id] = r; });
  const cutoff = now.getTime() - IR_SUMMARY_NEW_DAYS * 86400000;
  items.forEach(function (it) {
    if (byId[it.id]) return;
    const old = irAtTime_(it.at) < cutoff;
    const r = {
      id: it.id, code: it.code, name: it.name, at: it.at, title: it.title, url: it.url,
      status: !it.url ? 'nopdf' : old ? 'skipped' : 'pending',
      tries: 0, tags: [], head: '', good: [], bad: [], neutral: [], reason: '', updatedAt: now.toISOString(),
    };
    byId[it.id] = r;
  });
  return Object.keys(byId).map(function (k) { return byId[k]; }).sort(function (a, b) { return b.id - a.id; });
}

/** '2026-11-13 15:30'(日本時間)→ 時刻 */
function irAtTime_(at) {
  const m = String(at || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return 0;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 9, +m[5]);
}

function irPruneRows_(rows, now) {
  const cutoff = now.getTime() - IR_KEEP_DAYS * 86400000;
  return rows.filter(function (r) { return irAtTime_(r.at) >= cutoff; }).slice(0, IR_ROWS_MAX);
}

// ===================================================================
// 要約(Gemini)
// ===================================================================

/** 要約待ちを、新しいものから順に要約する。上限に当たったら残りは次の回。お知らせの文を返す */
function irSummarizePending_(rows, st, now, budget) {
  const key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!key) return 'Gemini の API キーが未設定のため、要約していません(スクリプト プロパティに GEMINI_API_KEY を追加してください)';
  const today = irJst_(now).date;
  if (!st.summaryDay || st.summaryDay.date !== today) st.summaryDay = { date: today, count: 0 };
  let note = null;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.status !== 'pending') continue;
    if (budget.left <= 0) break;
    if (st.summaryDay.count >= IR_SUMMARY_PER_DAY) { note = '今日の要約の上限(' + IR_SUMMARY_PER_DAY + '件)に達したので、残りは明日にします'; break; }
    if (Date.now() - budget.started > IR_RUN_BUDGET_MS) break;
    budget.left--;
    st.summaryDay.count++;
    const res = irSummarize_(key, r);
    if (res.ok) {
      irApplySummary_(r, res.summary, now);
    } else {
      r.tries = (Number(r.tries) || 0) + 1;
      r.reason = res.reason;
      r.updatedAt = now.toISOString();
      if (res.quota) { note = 'Gemini の無料の上限に当たったので、要約は少しあとにします'; break; }
      if (r.tries >= IR_SUMMARY_TRIES || res.final) r.status = 'failed';
    }
  }
  return note;
}

function irApplySummary_(r, s, now) {
  r.status = 'done';
  r.tags = s.tags;
  r.head = s.head;
  r.good = s.good;
  r.bad = s.bad;
  r.neutral = s.neutral;
  r.reason = '';
  r.updatedAt = now.toISOString();
}

/** 画面から頼まれた 1 件を、いま要約する */
function irSummarizeOne_(id) {
  const key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!key) throw new Error('Gemini の API キーが未設定です(スクリプト プロパティに GEMINI_API_KEY を追加してください)');
  const rows = irReadRows_();
  const r = rows.filter(function (x) { return String(x.id) === id; })[0];
  if (!r) throw new Error('その開示が見つかりません');
  if (r.status !== 'done') {
    const res = irSummarize_(key, r);
    if (res.ok) irApplySummary_(r, res.summary, new Date());
    else {
      r.reason = res.reason;
      r.status = 'failed';
    }
    irWriteRows_(rows);
  }
  return irPublicItem_(r);
}

function irSummarize_(key, r) {
  if (!r.url) return { ok: false, final: true, reason: '資料の URL がありません' };
  if (!/\.pdf$/i.test(r.url.split('?')[0])) return { ok: false, final: true, reason: 'PDF ではない資料です' };
  let res;
  try {
    res = UrlFetchApp.fetch(r.url, { muteHttpExceptions: true });
  } catch (e) {
    return { ok: false, reason: '資料を取れませんでした' };
  }
  if (res.getResponseCode() !== 200) return { ok: false, reason: '資料を取れませんでした(HTTP ' + res.getResponseCode() + ')' };
  const bytes = res.getContent();
  if (!bytes || bytes.length < 4 || bytes[0] !== 37 || bytes[1] !== 80 || bytes[2] !== 68 || bytes[3] !== 70) return { ok: false, final: true, reason: 'PDF の中身ではありませんでした' };
  if (bytes.length > IR_PDF_MAX_BYTES) return { ok: false, final: true, reason: '資料が大きすぎます(' + Math.round(bytes.length / 1048576) + 'MB)' };
  const b64 = Utilities.base64Encode(bytes);
  let last = { ok: false, reason: '要約できませんでした' };
  for (let i = 0; i < IR_GEMINI_MODELS.length; i++) {
    const model = IR_GEMINI_MODELS[i];
    let g = irGemini_(key, model, b64, /^gemini-3/.test(model));
    if (!g.ok && g.status === 400 && /^gemini-3/.test(model)) g = irGemini_(key, model, b64, false);
    if (g.ok) {
      const s = irShapeSummary_(g.json);
      if (s) return { ok: true, summary: s };
      last = { ok: false, reason: '要約の形が読めませんでした(' + model + ')' };
      continue;
    }
    last = { ok: false, reason: g.reason, quota: g.status === 429 };
    if (g.status === 0 || g.status === 401 || g.status === 403) break;
    if (g.status === 429) continue; // ほかのモデルの上限は別
    if (g.status === 400 && !/not found|not supported|unsupported/i.test(g.reason)) break;
  }
  return last;
}

function irGemini_(key, model, b64, thinking) {
  const body = {
    contents: [{ role: 'user', parts: [{ inline_data: { mime_type: 'application/pdf', data: b64 } }, { text: IR_PROMPT }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          tags: { type: 'ARRAY', items: { type: 'STRING' } },
          head: { type: 'STRING' },
          good: { type: 'ARRAY', items: { type: 'STRING' } },
          bad: { type: 'ARRAY', items: { type: 'STRING' } },
          neutral: { type: 'ARRAY', items: { type: 'STRING' } },
        },
        required: ['tags', 'head', 'good', 'bad', 'neutral'],
      },
    },
  };
  if (thinking) body.generationConfig.thinkingConfig = { thinkingLevel: 'low' };
  let res;
  try {
    res = UrlFetchApp.fetch(IR_GEMINI_BASE + model + ':generateContent', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-goog-api-key': key },
      payload: JSON.stringify(body),
      muteHttpExceptions: true,
    });
  } catch (e) {
    return { ok: false, status: 0, reason: 'Gemini につながりませんでした' };
  }
  const code = res.getResponseCode();
  let j = null;
  try { j = JSON.parse(res.getContentText()); } catch (e) { j = null; }
  if (code !== 200) {
    const msg = j && j.error && j.error.message ? String(j.error.message).split(key).join('***').slice(0, 120) : '';
    return { ok: false, status: code, reason: 'Gemini(' + model + ')の返事が ' + code + (msg ? ':' + msg : '') };
  }
  const parts = (j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
  const text = parts.filter(function (p) { return p && p.text && !p.thought; }).map(function (p) { return p.text; }).join('').trim();
  let json = null;
  try { json = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch (e) { json = null; }
  if (!json) return { ok: false, status: code, reason: 'Gemini(' + model + ')の返事が読めませんでした' };
  return { ok: true, status: code, json: json };
}

/** Gemini の返事を、画面に出す形にそろえる(一覧にない目印は捨て、長さをそろえる)。だめなら null */
function irShapeSummary_(j) {
  if (!j || typeof j !== 'object') return null;
  const list = function (v) {
    return (Array.isArray(v) ? v : [])
      .map(function (x) { return String(x == null ? '' : x).replace(/^[・\-\s]+/, '').trim().slice(0, 200); })
      .filter(function (x) { return x && x !== 'なし'; })
      .slice(0, 8);
  };
  const dirOf = {};
  IR_TAGS.forEach(function (t) { dirOf[t[0]] = t[1]; });
  const tags = [];
  (Array.isArray(j.tags) ? j.tags : []).forEach(function (t) {
    const name = String(t || '').replace(/[↑↓\s]/g, '');
    if (dirOf[name] && !tags.some(function (x) { return x.name === name; }) && tags.length < IR_TAG_MAX) tags.push({ name: name, dir: dirOf[name] });
  });
  const head = String(j.head == null ? '' : j.head).trim().slice(0, 120);
  const out = { tags: tags, head: head, good: list(j.good), bad: list(j.bad), neutral: list(j.neutral) };
  if (!head && !out.good.length && !out.bad.length && !out.neutral.length) return null;
  return out;
}

// ===================================================================
// 決算発表予定日(日本取引所の一覧。Excel)
// ===================================================================

function irFetchEarnings_(codes, now) {
  if (!codes.length) return {};
  const page = UrlFetchApp.fetch(IR_JPX_PAGE, { muteHttpExceptions: true });
  if (page.getResponseCode() !== 200) throw new Error('決算発表予定日のページを開けませんでした(HTTP ' + page.getResponseCode() + ')');
  const links = irXlsxLinks_(page.getContentText());
  if (!links.length) throw new Error('決算発表予定日の一覧(Excel)が見つかりませんでした');
  const want = {};
  codes.forEach(function (c) { want[c] = true; });
  const today = irJst_(now).date;
  let found = {};
  let read = 0;
  const started = Date.now();
  for (let i = 0; i < links.length && i < IR_EARNINGS_FILES_MAX; i++) {
    if (Date.now() - started > 150 * 1000) break;
    try {
      const res = UrlFetchApp.fetch(links[i], { muteHttpExceptions: true });
      if (res.getResponseCode() !== 200) continue;
      const blob = res.getBlob().setContentType('application/zip');
      const files = Utilities.unzip(blob);
      const shared = files.filter(function (f) { return /sharedStrings\.xml$/.test(f.getName()); })[0];
      const sheet = files.filter(function (f) { return /worksheets\/sheet1\.xml$/.test(f.getName()); })[0]
        || files.filter(function (f) { return /worksheets\/sheet\d+\.xml$/.test(f.getName()); })[0];
      if (!sheet) continue;
      const strings = shared ? irXlsxSharedStrings_(shared.getDataAsString('UTF-8')) : [];
      const rows = irXlsxRows_(sheet.getDataAsString('UTF-8'), strings);
      found = irCombineEarnings_(found, irPickEarnings_(rows, want, today));
      read++;
    } catch (e) {
      // その 1 ファイルだけ飛ばす
    }
  }
  if (!read) throw new Error('決算発表予定日の一覧(Excel)を読めませんでした');
  return found;
}

/** ページの中の Excel へのリンク(絶対 URL)。同じものは 1 つ */
function irXlsxLinks_(html) {
  const out = [];
  const re = /href="([^"]+\.xlsx)"/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    let u = m[1].replace(/&amp;/g, '&');
    if (/^\//.test(u)) u = IR_JPX_HOST + u;
    else if (!/^https?:\/\//.test(u)) u = IR_JPX_HOST + '/listing/event-schedules/financial-announcement/' + u;
    if (out.indexOf(u) < 0) out.push(u);
  }
  return out;
}

function irXmlText_(s) {
  return String(s)
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(Number(n)); })
    .replace(/&amp;/g, '&');
}

/** Excel の共有文字列(xl/sharedStrings.xml)→ 文字列の配列 */
function irXlsxSharedStrings_(xml) {
  const out = [];
  const re = /<si>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = re.exec(String(xml || '')))) {
    const parts = [];
    const tr = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
    let t;
    // ふりがな(rPh)の中の文字は除く
    const body = m[1].replace(/<rPh[\s\S]*?<\/rPh>/g, '');
    while ((t = tr.exec(body))) parts.push(irXmlText_(t[1]));
    out.push(parts.join(''));
  }
  return out;
}

/** Excel のシート(xl/worksheets/sheetN.xml)→ 行の配列(列は A=0, B=1, …) */
function irXlsxRows_(xml, strings) {
  const rows = [];
  const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g;
  let r;
  while ((r = rowRe.exec(String(xml || '')))) {
    const row = [];
    const cellRe = /<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let c;
    while ((c = cellRe.exec(r[1]))) {
      const attrs = c[1];
      const inner = c[2] || '';
      const ref = (attrs.match(/\br="([A-Z]+)\d+"/) || [])[1];
      const type = (attrs.match(/\bt="([^"]+)"/) || [])[1] || '';
      let v = '';
      if (type === 'inlineStr') {
        const tm = inner.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/);
        v = tm ? irXmlText_(tm[1]) : '';
      } else {
        const vm = inner.match(/<v>([\s\S]*?)<\/v>/);
        v = vm ? irXmlText_(vm[1]) : '';
        if (type === 's') v = strings[Number(v)] == null ? '' : strings[Number(v)];
      }
      const col = ref ? irColIndex_(ref) : row.length;
      row[col] = String(v).trim();
    }
    for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = '';
    rows.push(row);
  }
  return rows;
}

function irColIndex_(letters) {
  let n = 0;
  for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
  return n - 1;
}

/** 日付の文字(2026/11/20・2026-11-20・2026年11月20日)か、Excel の日付の数字 → 'YYYY-MM-DD'。読めなければ '' */
function irExcelDate_(v) {
  const s = String(v == null ? '' : v).trim();
  let m = s.match(/^(\d{4})[\/\-年.](\d{1,2})[\/\-月.](\d{1,2})/);
  if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86400000);
    return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
  }
  return '';
}

/**
 * 一覧の行から、見張っている銘柄の決算発表予定日を拾う。
 * 見出しの行(「コード」と「予定日」or「発表日」を含む行)を探し、列の位置を決める。今日より前の日付は拾わない
 * @returns {{[code]: {date, label, name}}}
 */
function irPickEarnings_(rows, want, today) {
  let head = -1;
  let col = null;
  for (let i = 0; i < rows.length && i < 30; i++) {
    const r = rows[i].map(function (x) { return String(x).replace(/\s/g, ''); });
    const ci = r.findIndex(function (x) { return /コード|Code/i.test(x) && !/業種/.test(x); });
    const di = r.findIndex(function (x) { return /予定日|発表日/.test(x); });
    if (ci >= 0 && di >= 0) {
      head = i;
      col = {
        code: ci,
        date: di,
        name: r.findIndex(function (x) { return /会社名|銘柄名/.test(x); }),
        kind: r.findIndex(function (x) { return /種別|区分/.test(x) && !/市場/.test(x); }),
        period: r.findIndex(function (x) { return /決算期/.test(x); }),
      };
      break;
    }
  }
  const out = {};
  if (head < 0) return out;
  for (let i = head + 1; i < rows.length; i++) {
    const r = rows[i];
    const code = irNormalizeCode_(r[col.code]);
    if (!code || !want[code]) continue;
    const date = irExcelDate_(r[col.date]);
    if (!date || date < today) continue;
    const kind = col.kind >= 0 ? String(r[col.kind] || '').trim() : '';
    const period = col.period >= 0 ? String(r[col.period] || '').trim() : '';
    const label = (kind || '決算') + (period && !/^\d+(\.\d+)?$/.test(period) ? '(' + period + ')' : '');
    const cand = { date: date, label: label.slice(0, 40), name: col.name >= 0 ? String(r[col.name] || '').trim().slice(0, 60) : '' };
    if (!out[code] || cand.date < out[code].date) out[code] = cand;
  }
  return out;
}

/** いくつかの一覧から拾ったものを合わせる(銘柄ごとに、いちばん近い日) */
function irCombineEarnings_(a, b) {
  const out = {};
  Object.keys(a).forEach(function (k) { out[k] = a[k]; });
  Object.keys(b).forEach(function (k) { if (!out[k] || b[k].date < out[k].date) out[k] = b[k]; });
  return out;
}

/** 前回の結果と合わせる:新しく拾えたものを使い、拾えなかった銘柄は前回の予定(今日以後)を残す。見張っていない銘柄は捨てる */
function irMergeEarnings_(old, found, codes, today) {
  const out = {};
  codes.forEach(function (c) {
    if (found[c]) out[c] = found[c];
    else if (old[c] && old[c].date >= today) out[c] = old[c];
  });
  return out;
}

// ===================================================================
// 保存(スクリプト プロパティとスプレッドシート)
// ===================================================================

function irLoadState_() {
  try {
    const v = JSON.parse(PropertiesService.getScriptProperties().getProperty('IR_STATE') || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch (e) {
    return {};
  }
}

function irSaveState_(st) {
  PropertiesService.getScriptProperties().setProperty('IR_STATE', JSON.stringify(st));
}

/** 保存用のスプレッドシート(無ければ作る) */
function irBook_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('IR_SHEET_ID');
  if (id) {
    try {
      return SpreadsheetApp.openById(id);
    } catch (e) {
      // 消されていたら作り直す
    }
  }
  const book = SpreadsheetApp.create('マネートラッカー 開示・決算(自動で書き込み)');
  props.setProperty('IR_SHEET_ID', book.getId());
  const sh = book.getSheets()[0];
  sh.setName(IR_SHEET);
  sh.getRange(1, 1, 1, IR_COLUMNS.length).setValues([IR_COLUMNS]);
  return book;
}

function irSheet_() {
  const book = irBook_();
  let sh = book.getSheetByName(IR_SHEET);
  if (!sh) {
    sh = book.insertSheet(IR_SHEET);
    sh.getRange(1, 1, 1, IR_COLUMNS.length).setValues([IR_COLUMNS]);
  }
  return sh;
}

function irReadRows_() {
  const sh = irSheet_();
  const n = sh.getLastRow() - 1;
  if (n <= 0) return [];
  return sh.getRange(2, 1, n, IR_COLUMNS.length).getValues().map(irRowFromCells_).filter(function (r) { return r.id > 0 && r.code; });
}

function irWriteRows_(rows) {
  const sh = irSheet_();
  sh.clearContents();
  const values = [IR_COLUMNS].concat(rows.map(irCellsFromRow_));
  const range = sh.getRange(1, 1, values.length, IR_COLUMNS.length);
  range.setNumberFormat('@'); // 文字のまま(コードや日時が数字・日付に変わらないように)
  range.setValues(values);
}

function irRowFromCells_(c) {
  const arr = function (v) {
    try {
      const x = JSON.parse(String(v || '[]'));
      return Array.isArray(x) ? x : [];
    } catch (e) {
      return [];
    }
  };
  return {
    id: Number(c[0]), code: irNormalizeCode_(c[1]), name: String(c[2] || ''), at: String(c[3] || ''), title: String(c[4] || ''),
    url: String(c[5] || ''), status: String(c[6] || 'pending'), tries: Number(c[7]) || 0, tags: arr(c[8]), head: String(c[9] || ''),
    good: arr(c[10]), bad: arr(c[11]), neutral: arr(c[12]), reason: String(c[13] || ''), updatedAt: String(c[14] || ''),
  };
}

function irCellsFromRow_(r) {
  return [
    String(r.id), r.code, r.name, r.at, r.title, r.url, r.status, String(r.tries || 0),
    JSON.stringify(r.tags || []), r.head || '', JSON.stringify(r.good || []), JSON.stringify(r.bad || []), JSON.stringify(r.neutral || []),
    r.reason || '', r.updatedAt || '',
  ];
}

function irErrText_(err) {
  return String(err && err.message ? err.message : err).slice(0, 200);
}
