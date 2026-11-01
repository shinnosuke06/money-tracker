# マネートラッカー

個人用のお金の管理ウェブアプリです。iPhone の Safari(ホーム画面に追加)で使うことを想定しています。

- ビルド不要の静的サイト(HTML / CSS / JavaScript)
- データはブラウザの **localStorage にだけ保存**し、サーバーには送りません
- 金額はすべて **円の整数** で扱います
- グラフは Chart.js を CDN(jsDelivr)から読み込みます(読み込めなくても他の機能は動きます)

> このリポジトリには実際の金額・口座情報・個人名・実在の金融機関名・API キーを入れません。
> サンプルデータはすべて架空です。

## 進み具合(全6段階)

| 段階 | 内容 | 状態 |
|---|---|---|
| 1 | 土台(画面の骨組み、月末記録、設定、サンプル) | ✅ この段階 |
| 2〜 | 支払い管理(カード・ローン・入金・口座の過不足) | 準備中 |
| | 資産管理(株・投信・手入力資産・価格の自動取得・配当・優待) | 準備中 |
| | ポケカ在庫、副業収入 | 準備中 |
| | ライフプラン(将来予想) | 準備中 |

## 使い方(手元で確認)

`index.html` をブラウザで開くだけで動きます。ローカルサーバーで確認する場合:

```bash
python3 -m http.server 8000
```

ブラウザで http://localhost:8000/ を開きます。

計算処理のテスト(Node.js 18 以上):

```bash
node --test
```

## ファイル構成

```
index.html                 画面の入れ物。script を順番に読み込む
manifest.webmanifest       ホーム画面に追加したときの設定
icons/                     アプリのアイコン
css/style.css              スタイル(色は :root の変数。ダークモード対応)
js/
  core/
    util.js                日付・年月・金額の小さな関数
    store.js               データの保存・読み込み・移行(schemaVersion)・バックアップ
    ui.js                  ボタン・ダイアログ・確認・通知などの画面部品
    libs.js                外部ライブラリ(Chart.js)を必要なときに CDN から読み込む
  features/
    monthly/
      model.js             月末記録のデータ操作と計算(画面に依存しない)
      chart.js             総資産の推移グラフ
      view.js              月末記録の画面(表・案内・入力)
      manage.js            項目と区分の編集画面
    settings/view.js       設定画面(書き出し・読み込み・サンプル・元に戻す・全削除)
    placeholder/view.js    まだ作っていないタブの「準備中」画面
  data/sample.js           サンプルデータ(架空)
  app.js                   下部タブ・画面の切り替え・起動
tests/monthly.test.js      計算処理のテスト
```

### 機能の足し方(次の段階向け)

1. `js/features/<機能名>/` にファイルを作る
2. データが必要なら `MT.store.defineSection('<区画名>', { create, normalize, hasContent, summarize })` で区画を登録する
3. 画面は `MT.views['<タブ名>'] = { render(container) }` で登録する(準備中の画面と置き換わる)
4. `index.html` に script を追加する
5. データの形を変えたら `store.js` の `SCHEMA_VERSION` を上げ、`MIGRATIONS` に古い形からの変換を書く

## データ構造(schemaVersion 1)

localStorage のキー `moneyTracker:data` に、次の JSON を 1 つ保存します。書き出しファイルも同じ形です。

```jsonc
{
  "app": "money-tracker",          // このアプリのデータかの目印
  "schemaVersion": 1,              // データ形式のバージョン
  "meta": { "createdAt": "ISO日時", "updatedAt": "ISO日時" },
  "monthly": {                     // 月末記録
    "categories": [                // 区分(配列の順番 = 表示順)
      { "id": "cat_cash", "name": "現金(銀行口座)" }
    ],
    "items": [                     // 項目(区分の中の順番 = 配列の順番)
      { "id": "itm_…", "categoryId": "cat_cash", "name": "サンプル銀行 普通", "lastUpdated": "2026-10-31" }
    ],
    "records": {                   // 月ごとの記録(キーは "YYYY-MM")
      "2026-10": {
        "values":    { "itm_…": 441900 },        // 月末の金額(円の整数)
        "confirmed": { "itm_…": "2026-10-31" },  // 入力・確認した日
        "memo": "ボーナス月"
      }
    }
  }
}
```

- `values` にあって `confirmed` に無い値は「前月からコピーしたまま未確認」の値です(表では薄い文字+黄色の点)。
- `lastUpdated` はその項目の金額を最後に入力・確認した日です。
- 「未更新」の印は、表のいちばん新しい月で、まだ入力・確認していない項目につきます。
- 総資産 = すべての区分の項目の合計。前月比は直前の記録との差です。
- 読み込み時は形を点検し、壊れた値・存在しない項目の金額は取り除きます。新しいバージョンのデータは読み込まず、上書きもしません。

そのほか、端末ごとの表示設定(グラフの区分別/項目別など)を `moneyTracker:ui:*` に、
上書き・削除の直前のデータを 1 つだけ `moneyTracker:backup` に保存します(設定の「直前のデータに戻す」で使用)。

## 注意

- iPhone では、Safari で開いた場合とホーム画面から開いた場合で、データの保存場所が別になります。ふだん使う方を決め、移すときは設定の「書き出し・読み込み」を使ってください。
- ブラウザのデータを消すとアプリのデータも消えます。ときどき JSON ファイルに書き出してバックアップしてください。
