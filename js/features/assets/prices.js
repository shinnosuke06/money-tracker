/*
 * 資産管理:価格の自動取得
 *  - 国内株・投資信託:設定の URL に GET ?codes=コード1,コード2
 *      返事 { version: "v6", results: { コード: 価格 }, errors: [コード], errorDetails: { コード: 理由 } }
 *      version が "v6" でなければ「URLが古い、または別のものです」として、何も更新しない
 *  - 米国株:Finnhub の quote の c(ドル)。円は USD/JPY を掛けて出す(キーが無ければ手入力)
 *  - USD/JPY:上の URL に為替のコード(既定 USDJPY)も一緒に問い合わせる。取れなければ設定の手入力値
 * 送るのは銘柄コードだけ(数量や金額は送らない)。URL とキーは MT.secrets から読む。
 */
(function (root) {
  'use strict';
  const MT = (root.MT = root.MT || {});
  const A = MT.assetsModel;

  const VERSION = 'v6';
  const FINNHUB_QUOTE = 'https://finnhub.io/api/v1/quote'; // 公開 API の窓口(キーは設定から)
  const TIMEOUT_MS = 20000;

  const toNum = (v) => {
    const n = typeof v === 'string' ? Number(v.replace(/,/g, '')) : v;
    return typeof n === 'number' && Number.isFinite(n) ? n : null;
  };

  function errorText(e) {
    if (e && e.name === 'AbortError') return '時間切れになりました';
    const m = e && /HTTP (\d+)/.exec(e.message || '');
    if (m) {
      if (m[1] === '401' || m[1] === '403') return 'キーやURLを確認してください(HTTP ' + m[1] + ')';
      if (m[1] === '429') return '回数の上限です。少し待ってから更新してください';
      return '取得できませんでした(HTTP ' + m[1] + ')';
    }
    if (e && e.message === 'json') return '返事の形式が読み取れません';
    return '通信できませんでした';
  }

  async function getJson(url, fetchImpl, timeoutMs) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    try {
      const res = await fetchImpl(url, { method: 'GET', signal: ctrl ? ctrl.signal : undefined, credentials: 'omit', cache: 'no-store', redirect: 'follow' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      try {
        return await res.json();
      } catch (e) {
        throw new Error('json');
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** 同時に count 件ずつ実行する */
  async function pool(items, count, fn) {
    let i = 0;
    const workers = Array.from({ length: Math.min(count, items.length) }, async () => {
      while (i < items.length) {
        const item = items[i++];
        await fn(item);
      }
    });
    await Promise.all(workers);
  }

  /**
   * 価格を取りに行く(データは書き換えない。結果は A.applyPriceReport で反映する)
   * @returns {Promise<{prices: object, fx: object|null, messages: string[], aborted: string|null}>}
   */
  async function fetchPrices({ assets, secrets, fetchImpl, timeoutMs = TIMEOUT_MS }) {
    const doFetch = fetchImpl || ((url, opts) => root.fetch(url, opts));
    const report = { prices: {}, fx: null, messages: [], aborted: null };
    const set = (kind, code, ok, valueOrReason) => {
      report.prices[`${kind}:${code}`] = ok ? { ok: true, price: valueOrReason } : { ok: false, reason: valueOrReason };
    };
    const uniq = (arr) => [...new Set(arr.filter(Boolean))];
    const jp = uniq(assets.holdings.filter((h) => h.type !== 'us').map((h) => A.normCode(h.code)));
    const us = uniq(assets.holdings.filter((h) => h.type === 'us').map((h) => A.normCode(h.code)));
    const s = assets.settings;
    const fxCode = A.normCode(s.fxCode || 'USDJPY');

    // 国内株・投資信託(と USD/JPY)
    let gas = null;
    const codes = us.length ? [...jp, fxCode] : jp;
    if (secrets.priceUrl && codes.length) {
      let url;
      try {
        url = new URL(secrets.priceUrl);
      } catch (e) {
        report.aborted = '価格取得のURLが正しくありません。設定を確認してください';
        return report;
      }
      url.searchParams.set('codes', codes.join(','));
      try {
        const json = await getJson(url.toString(), doFetch, timeoutMs);
        if (!json || json.version !== VERSION) {
          report.aborted = 'URLが古い、または別のものです。価格は更新していません';
          return report;
        }
        gas = json;
      } catch (e) {
        const why = errorText(e);
        report.messages.push(`国内株・投資信託:${why}`);
        for (const c of jp) set('jp', c, false, why);
      }
    } else if (jp.length) {
      report.messages.push('国内株・投資信託:価格取得のURLが未設定です(価格は銘柄の編集で手入力できます)');
    }

    if (gas) {
      const results = gas.results && typeof gas.results === 'object' ? gas.results : {};
      const details = gas.errorDetails && typeof gas.errorDetails === 'object' ? gas.errorDetails : {};
      const errs = new Set((Array.isArray(gas.errors) ? gas.errors : []).map((c) => A.normCode(c)));
      for (const c of jp) {
        const v = toNum(results[c]);
        if (v > 0) set('jp', c, true, v);
        else set('jp', c, false, details[c] ? String(details[c]).slice(0, 120) : errs.has(c) ? '取得できませんでした' : '結果に含まれていません');
      }
    }

    // USD/JPY
    if (us.length) {
      const auto = gas && gas.results ? toNum(gas.results[fxCode]) : null;
      if (auto > 0) report.fx = { rate: auto, source: 'auto' };
      else if (s.fxManual > 0) {
        report.fx = { rate: s.fxManual, source: 'manual' };
        if (secrets.priceUrl) report.messages.push(`USD/JPY:自動で取得できなかったため、設定の値(${s.fxManual})を使いました`);
      } else {
        report.fx = { rate: null, source: null };
        report.messages.push('USD/JPY:取得できず、設定の手入力値も無いため、米国株は価格未取得になります');
      }
    }

    // 米国株
    if (us.length) {
      if (!secrets.finnhubKey) {
        report.messages.push('米国株:Finnhub の APIキーが未設定です(株価はドルで手入力できます)');
      } else {
        await pool(us, 3, async (c) => {
          const url = `${FINNHUB_QUOTE}?symbol=${encodeURIComponent(c)}&token=${encodeURIComponent(secrets.finnhubKey)}`;
          try {
            const j = await getJson(url, doFetch, timeoutMs);
            const v = toNum(j && j.c);
            if (v > 0) set('us', c, true, v);
            else set('us', c, false, '銘柄が見つからないか、価格がありません');
          } catch (e) {
            set('us', c, false, errorText(e));
          }
        });
      }
    }
    return report;
  }

  /** 結果の数え上げ(画面の表示用) */
  function countReport(report) {
    let ok = 0;
    const failed = [];
    for (const [key, r] of Object.entries(report.prices)) {
      if (r.ok) ok++;
      else failed.push({ code: key.split(':').slice(1).join(':'), reason: r.reason });
    }
    return { ok, failed };
  }

  MT.assetPrices = { VERSION, fetchPrices, countReport };
})(typeof window !== 'undefined' ? window : globalThis);
