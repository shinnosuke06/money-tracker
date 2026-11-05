/**
 * マネートラッカー:株式分割・配当の記録を返す(価格取得の Google Apps Script に足すコード)
 *
 * 足し方(README の「株式分割・配当の自動確認」にも同じ手順):
 *   1. 価格取得に使っている Apps Script のプロジェクトを開き、このファイルの中身を
 *      新しいファイル(＋ → スクリプト。名前は events など)にそのまま貼り付けて保存する
 *   2. いまの doGet(e) の「いちばん最初の行」に、次の 1 行を足して保存する
 *        if (e && e.parameter && e.parameter.events) return moneyTrackerEvents_(e);
 *   3. 「デプロイ」→「デプロイを管理」→ 鉛筆 →「バージョン:新バージョン」→「デプロイ」
 *      (URL は変わりません。アプリの設定はそのままで使えます)
 *
 * 問い合わせ:?events=1&codes=X101,US:XYZ&range=2y
 *   国内株は 4 文字のコード(東証。Yahoo Finance の「コード.T」)、米国株は「US:ティッカー」
 * 返事:{ version: "events-v1",
 *        events: { コード: { splits: [{ date, numerator, denominator }], dividends: [{ date, amount }] } },
 *        errors: { コード: 理由 } }
 *   date は日本時間の YYYY-MM-DD(分割・権利落ちの日)。numerator / denominator は「1株 → numerator/denominator 株」
 * 送られてくるのは銘柄コードだけです(数量や金額は来ません)。
 */
function moneyTrackerEvents_(e) {
  var p = (e && e.parameter) || {};
  var codes = String(p.codes || '')
    .split(',')
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return /^(US:)?[A-Za-z0-9.\-]{1,12}$/.test(s); })
    .slice(0, 80);
  var range = /^(1y|2y|5y)$/.test(p.range || '') ? p.range : '2y';
  var out = { version: 'events-v1', events: {}, errors: {} };

  var day = function (sec) {
    return Utilities.formatDate(new Date(sec * 1000), 'Asia/Tokyo', 'yyyy-MM-dd');
  };
  var requests = codes.map(function (c) {
    var symbol = c.indexOf('US:') === 0 ? c.slice(3) : c + '.T';
    return {
      url: 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol) + '?interval=1d&range=' + range + '&events=div%2Csplits',
      muteHttpExceptions: true,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    };
  });

  // 一度に多く送りすぎないよう、20 件ずつ
  for (var i = 0; i < requests.length; i += 20) {
    var chunk = requests.slice(i, i + 20);
    var responses;
    try {
      responses = UrlFetchApp.fetchAll(chunk);
    } catch (err) {
      for (var k = 0; k < chunk.length; k++) out.errors[codes[i + k]] = '通信エラー:' + String(err && err.message ? err.message : err).slice(0, 80);
      continue;
    }
    for (var j = 0; j < responses.length; j++) {
      var code = codes[i + j];
      try {
        var res = responses[j];
        if (res.getResponseCode() !== 200) throw new Error('HTTP' + res.getResponseCode());
        var json = JSON.parse(res.getContentText());
        var result = json && json.chart && json.chart.result && json.chart.result[0];
        if (!result) throw new Error('データなし');
        var ev = result.events || {};
        var splits = Object.keys(ev.splits || {}).map(function (key) {
          var s = ev.splits[key];
          return { date: day(s.date), numerator: Number(s.numerator), denominator: Number(s.denominator) };
        });
        var dividends = Object.keys(ev.dividends || {}).map(function (key) {
          var d = ev.dividends[key];
          return { date: day(d.date), amount: Number(d.amount) };
        });
        out.events[code] = { splits: splits, dividends: dividends };
      } catch (err2) {
        out.errors[code] = String(err2 && err2.message ? err2.message : err2).slice(0, 80);
      }
    }
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}
