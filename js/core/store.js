/*
 * データの保存・読み込み(localStorage)
 *
 * データ全体は 1 つの JSON で、次の形をしている。
 *   { app: "money-tracker", schemaVersion: 1, meta: {...}, monthly: {...}, ...今後の区画 }
 *
 * 各機能は defineSection() で自分の区画(monthly など)を登録する。
 * 登録内容:create()=空の初期値、normalize(raw)=読み込み時の点検・整形、
 *           hasContent(sec)=中身があるか、summarize(sec)=確認画面用の要約
 *
 * データの形を変えるときは SCHEMA_VERSION を上げ、MIGRATIONS に変換を足す。
 */
(function (root) {
  'use strict';
  const MT = (root.MT = root.MT || {});

  const APP_ID = 'money-tracker';
  const SCHEMA_VERSION = 1;
  const STORAGE_KEY = 'moneyTracker:data';
  const BACKUP_KEY = 'moneyTracker:backup';
  const CORRUPT_PREFIX = 'moneyTracker:corrupt:';

  /**
   * スキーマの移行。MIGRATIONS[n] はバージョン n のデータを受け取り、n+1 の形にして返す。
   * 例(段階2で支払い管理を足すとき):
   *   MIGRATIONS[1] = (d) => ({ ...d, schemaVersion: 2, payments: { cards: [], loans: [] } });
   */
  const MIGRATIONS = {};

  const sections = {};
  const sectionOrder = [];

  function defineSection(name, def) {
    if (!sections[name]) sectionOrder.push(name);
    sections[name] = def;
  }

  function createEmpty(now = new Date()) {
    const iso = now.toISOString();
    const d = { app: APP_ID, schemaVersion: SCHEMA_VERSION, meta: { createdAt: iso, updatedAt: iso } };
    for (const name of sectionOrder) d[name] = sections[name].create();
    return d;
  }

  function isObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  /** 最新の形になったデータを点検し、壊れた値を取り除いた複製を返す */
  function normalize(raw) {
    const d = createEmpty();
    const meta = isObject(raw.meta) ? raw.meta : {};
    if (typeof meta.createdAt === 'string') d.meta.createdAt = meta.createdAt;
    if (typeof meta.updatedAt === 'string') d.meta.updatedAt = meta.updatedAt;
    for (const name of sectionOrder) {
      d[name] = isObject(raw[name]) ? sections[name].normalize(raw[name]) : sections[name].create();
    }
    return d;
  }

  function fail(error) {
    return { ok: false, error };
  }

  /**
   * 外から来たデータ(保存済み・読み込みファイル)を点検し、必要なら移行する。
   * @returns {{ok: true, data, migrated: boolean} | {ok: false, error: string, newer?: boolean}}
   */
  function prepare(obj) {
    if (!isObject(obj)) return fail('データの形式が正しくありません。');
    if (obj.app !== APP_ID) return fail('マネートラッカーのデータではないようです。');
    const v = obj.schemaVersion;
    if (!Number.isInteger(v) || v < 1) return fail('データのバージョンが読み取れません。');
    if (v > SCHEMA_VERSION) {
      return {
        ok: false,
        newer: true,
        error: '新しいバージョンのアプリで保存されたデータです。ページを再読み込みして、アプリを最新にしてください。',
      };
    }
    try {
      let d = JSON.parse(JSON.stringify(obj));
      while (d.schemaVersion < SCHEMA_VERSION) {
        const step = MIGRATIONS[d.schemaVersion];
        if (!step) return fail(`バージョン${d.schemaVersion}のデータは変換できません。`);
        d = step(d);
      }
      return { ok: true, data: normalize(d), migrated: v !== SCHEMA_VERSION };
    } catch (e) {
      return fail('データの中身に読み取れない部分があります。');
    }
  }

  // ---- 状態 ----

  let data = null;
  let readOnly = false;
  const listeners = new Set();
  let errorHandler = (msg) => {
    if (root.console) root.console.error(msg);
  };

  function storage() {
    try {
      return root.localStorage || null;
    } catch (e) {
      return null; // Safari のプライベートブラウズ等
    }
  }

  function notify() {
    for (const fn of listeners) fn(data);
  }

  /**
   * localStorage から読み込む。
   * @returns {{status: 'new'|'ok'|'migrated'|'corrupt'|'newer'|'unavailable', error?: string}}
   */
  function load() {
    readOnly = false;
    const ls = storage();
    if (!ls) {
      data = createEmpty();
      return { status: 'unavailable' };
    }
    let raw = null;
    try {
      raw = ls.getItem(STORAGE_KEY);
    } catch (e) {
      data = createEmpty();
      return { status: 'unavailable' };
    }
    if (raw === null) {
      data = createEmpty();
      return { status: 'new' };
    }
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      parsed = null;
    }
    const res = prepare(parsed);
    if (res.ok) {
      data = res.data;
      if (res.migrated) persist();
      return { status: res.migrated ? 'migrated' : 'ok' };
    }
    if (res.newer) {
      // 古いアプリで新しいデータを上書きしないよう、保存を止める
      data = createEmpty();
      readOnly = true;
      return { status: 'newer', error: res.error };
    }
    // 壊れたデータは別名で残してから、空の状態で始める
    try {
      ls.setItem(CORRUPT_PREFIX + Date.now(), raw);
    } catch (e) {
      /* 残せなくても続行 */
    }
    data = createEmpty();
    return { status: 'corrupt', error: res.error };
  }

  function persist() {
    if (readOnly) return { ok: false, error: '新しいバージョンのデータを守るため、保存を止めています。' };
    const ls = storage();
    if (!ls) return { ok: false, error: 'この端末(ブラウザ)ではデータを保存できません。' };
    try {
      data.meta.updatedAt = new Date().toISOString();
      ls.setItem(STORAGE_KEY, JSON.stringify(data));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: '保存できませんでした。空き容量が足りない可能性があります。' };
    }
  }

  function hasContent(d) {
    if (!d) return false;
    return sectionOrder.some((name) => sections[name].hasContent && sections[name].hasContent(d[name]));
  }

  function summarize(d) {
    const lines = [];
    for (const name of sectionOrder) {
      if (sections[name].summarize) lines.push(...sections[name].summarize(d[name]));
    }
    return lines;
  }

  /** 上書き・削除の前に、今のデータを 1 つだけ退避しておく(「直前のデータに戻す」用) */
  function saveBackup(reason) {
    if (!hasContent(data)) return;
    const ls = storage();
    if (!ls) return;
    try {
      ls.setItem(BACKUP_KEY, JSON.stringify({ savedAt: new Date().toISOString(), reason: reason || '', data }));
    } catch (e) {
      /* 退避できなくても本体の操作は続ける */
    }
  }

  function readBackup() {
    const ls = storage();
    if (!ls) return null;
    try {
      const b = JSON.parse(ls.getItem(BACKUP_KEY));
      return isObject(b) && isObject(b.data) ? b : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * データを書き換えて保存する。
   * @param {(data) => void} mutator データを直接書き換える関数
   * @param {{backup?: string}} opts backup に理由を渡すと、書き換え前を退避する(削除操作など)
   */
  function update(mutator, opts = {}) {
    if (readOnly) {
      errorHandler('新しいバージョンのデータを守るため、編集できません。ページを再読み込みしてください。');
      return false;
    }
    if (opts.backup) saveBackup(opts.backup);
    mutator(data);
    const r = persist();
    notify();
    if (!r.ok) {
      errorHandler(r.error);
      return false;
    }
    return true;
  }

  /** データ全体を入れ替える(読み込み・サンプル・全削除)。入れ替え前は退避する。 */
  function replaceAll(newData, reason) {
    if (readOnly) {
      errorHandler('新しいバージョンのデータを守るため、操作できません。ページを再読み込みしてください。');
      return false;
    }
    saveBackup(reason);
    data = newData;
    const r = persist();
    notify();
    if (!r.ok) {
      errorHandler(r.error);
      return false;
    }
    return true;
  }

  function getBackupInfo() {
    const b = readBackup();
    if (!b) return null;
    const res = prepare(b.data);
    if (!res.ok) return null;
    return { savedAt: b.savedAt, reason: b.reason, summary: summarize(res.data) };
  }

  /** 退避データと今のデータを入れ替える(もう一度押すと元に戻る) */
  function restoreBackup() {
    if (readOnly) return { ok: false, error: '操作できません。ページを再読み込みしてください。' };
    const b = readBackup();
    if (!b) return { ok: false, error: '戻せるデータがありません。' };
    const res = prepare(b.data);
    if (!res.ok) return { ok: false, error: res.error };
    saveBackup('「直前のデータに戻す」の前');
    data = res.data;
    const r = persist();
    notify();
    return r;
  }

  function exportJSON() {
    const out = JSON.parse(JSON.stringify(data));
    out.meta.exportedAt = new Date().toISOString();
    return JSON.stringify(out, null, 2);
  }

  function storedBytes() {
    const ls = storage();
    try {
      const raw = ls ? ls.getItem(STORAGE_KEY) : null;
      return raw ? new TextEncoder().encode(raw).length : 0;
    } catch (e) {
      return 0;
    }
  }

  MT.store = {
    APP_ID,
    SCHEMA_VERSION,
    STORAGE_KEY,
    defineSection,
    createEmpty,
    prepare,
    load,
    get: () => data,
    isReadOnly: () => readOnly,
    update,
    replaceAll,
    hasContent,
    summarize,
    getBackupInfo,
    restoreBackup,
    exportJSON,
    storedBytes,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    setErrorHandler(fn) {
      errorHandler = fn;
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
