# カードの明細の活用 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 保存した明細を使って、重複かもしれない行の一括削除・1 回で済む「問題なし」(毎月同じ支払いのチェックは問題なしのあとも残す)・次のお支払いの予想を足す。

**Architecture:** 計算と書き換えは `js/features/payments/cards-model.js`(`MT.cardCheck`)、画面は `js/features/payments/cards-view.js`。毎月の支払いの覚えに使う月の範囲(`from`・`until`)を持たせ、データの版を 17 に上げる。

**Tech Stack:** ビルドなしの静的 PWA(素の JavaScript)。テストは `node --test`。

**Spec:** `docs/superpowers/specs/2026-11-22-card-statement-use-design.md`

## Global Constraints

- 実際の金額・口座名・カード名・銀行名・証券会社名・お店の名前・個人の名前を、コード・テストデータ・README に入れない。テストは架空のデータだけ
- データは localStorage のみ。金額は円の整数。データの形を変えるときは schemaVersion を上げ、既存データを壊さない
- `APP_VERSION`(`js/core/store.js`)・`index.html` の `?v=`・`sw.js` の `VERSION` をそろえる(テストで確かめている)
- 子要素に null が入りうるときは `MT.ui.add` / `h` を使う(ブラウザの `append` は null を「null」と出す)
- 画面の言葉は、やさしい日本語

## Review Focus

1. 同じお店で金額の違う覚えがあるとき、覚え直すと古い覚えはその月までになり、前の月の明細の判定は変わらない(Task 1 のテスト)
2. 請求額が無い月の明細(支払いの月と違う月)では、重複の候補にチェックを付けず、「請求額が入っていない」と出す(Task 2・4)
3. 重複の候補がとても多いときは、組み合わせを探しすぎない(1 万通りを超えたらチェックを付けない)(Task 2 のテスト)
4. 名前が読めなかった行(名前なし)も、日付と金額で重複の候補にする(Task 2 のテスト)
5. 返金(マイナス)の行は重複の候補にしない(Task 2 のテスト)

---

### Task 1: 毎月の支払いの覚えに使う月の範囲(v17)と、1 回で問題なし

**Files:**
- Modify: `js/features/payments/cards-model.js`(normalize・judgeCard・setRowStatus・remember・removeKnown、export)
- Modify: `js/features/payments/model.js`(`addMigration(16, …)`)
- Modify: `js/core/store.js`(`SCHEMA_VERSION` 17、移行の一覧のコメント)
- Test: `tests/cards.test.js`

**Interfaces:**
- Produces:
  - 覚え:`{ id, cardId, merchant, amount, since, from, until }`(`from`・`until` は `YYYY-MM` か null)。`from` が null なら全部の月、`until` が null ならこの先ずっと
  - 使う月の判定:`from == null || from < 明細の月`、かつ `until == null || 明細の月 <= until`
  - `C.monthlyOf(p, stId, rowId) -> known | null`:その行と同じお店(`similar >= SIMILAR`)・同じ金額で、次の月に使う覚え
  - `C.setMonthly(p, stId, rowId, on: boolean) -> boolean`
    - on:もうあれば何もしない。同じお店で次の月に使う別の金額の覚えは `until = 明細の月` にし、`{ since: 月, from: 月, until: null }` で足す
    - off:`monthlyOf` の覚えが `from === 明細の月` なら消し、そうでなければ `until = 明細の月`
  - `C.setRowStatus(p, stId, rowId, status, { memo, monthly })`:`status === 'ok' && monthly === true` のときだけ `setMonthly(on=true)`。monthly が false でも覚えは外さない
  - `C.removeKnown(p, knownId)`:そのカードのいちばん新しい明細の月 M に対し、`from == null || from < M` なら `until = M`、そうでなければ消す。明細が無ければ消す
  - `C.activeKnown(p, cardId) -> known[]`:`until == null` の覚え(一覧と予想に使う)
  - `judgeCard`:覚えは使う月の範囲で選ぶ。確かめた行(`status` あり)は、記録や覚えと合っても `kind = 'check'` のまま(記録の突き合わせはいまのとおり行う)

- [ ] **Step 1: 失敗するテストを書く**(`tests/cards.test.js`)
  - `test('毎月同じ支払い:問題なしのあとも付け外しでき、前の月の判定は変わらない')`
    - 10 月・11 月の明細(架空、同じお店 `架空モバイル料金`)。10 月の行を `setRowStatus(…, 'ok', { monthly: true })` → 11 月の同じ金額の行は `known`、10 月の行は `kind === 'check'` で `status === 'ok'`、`monthlyOf` は覚えを返す
    - 11 月は金額が違う行 → `changed`。`setMonthly(on=true)` → 10 月の覚えは `until === '2026-10'`、新しい覚えは `from === '2026-11'`。10 月の行の判定は変わらず(`status` あり)、10 月のもう 1 つの同じ金額で未確認の行は `known` のまま
    - 11 月の行で `setMonthly(off)` → 11 月の覚えが消え、10 月の覚えは `until === '2026-10'` のまま。`pending` に 10 月の行が増えない
    - `removeKnown`:いちばん新しい明細の月までにし、`activeKnown` から消える。前の月の `known` の行はそのまま
  - `test('v16 のデータを開くと、覚えは全部の月に使う(from・until が空)')`:v16 の形(`since` だけ)から `store.prepare` → `schemaVersion === 17`、`from === null`・`until === null`、判定はいまと同じ
- [ ] **Step 2: 実行して失敗を確かめる**:`node --test tests/cards.test.js` → 新しい 2 件が失敗
- [ ] **Step 3: 作る**:上の Interfaces のとおり。`remember` は `setMonthly` に置き換える。移行は `addMigration(16, d => { d.schemaVersion = 17; 覚えに from: null, until: null; return d; })`。`tests/monthly.test.js` などの版の確かめは `>=` なので変えない
- [ ] **Step 4: 実行して通るのを確かめる**:`node --test` → 全部成功(前からある突き合わせのテストで、問題なし+毎月の行の kind を見ているものは、新しい決まり(確かめた行は check のまま)に合わせて直す)
- [ ] **Step 5: コミット**

### Task 2: 重複かもしれない行と、行の一括削除

**Files:**
- Modify: `js/features/payments/cards-model.js`
- Test: `tests/cards.test.js`

**Interfaces:**
- Produces:
  - `C.duplicates(rows, ref: number|null) -> { items: [{ row, count, checked }], total, diff, matched }`
    - まとまり:金額が 0 より大きい行で、日付・金額が同じで、名前が似ている(`similar >= SIMILAR`)か、どちらかが名前なし。まとまりの最初の行との比べで、順に入れる
    - 候補:各まとまりの 2 つ目から(`count` はまとまりの行の数)
    - `total` は全部の行の合計、`diff = ref == null ? null : total - ref`
    - `diff > 0` のとき、まとまりごとに消す数 c(0〜候補の数)を選び、Σ c × 金額 = diff になる選び方を探す。ちょうど 1 つならその分の候補を `checked`、`matched = true`。選び方の数(各まとまりの「候補の数 + 1」の積)が 10,000 を超えるときは探さない
  - `C.removeRows(p, stId, rowIds: string[]) -> number`(消した数。ほかの行と確かめた印はそのまま)

- [ ] **Step 1: 失敗するテストを書く**:`test('重複かもしれない行:差額にぴったり合う選び方が 1 つならチェック。一括で消す')`
  - 架空の行:`架空くじ 350` が同じ日に 2 つ、`架空カフェ 520` が同じ日に 2 つ、ほか。`ref = 合計 - 350` → くじの 2 つ目だけ `checked`、`matched === true`
  - `ref = 合計` → 候補 2 件、`checked` なし。`ref = null` → `diff === null`、`checked` なし。`ref = 合計 - 999`(合わない)→ `checked` なし
  - 名前なしの行が同じ日・同じ金額 → 候補になる。マイナスの行が 2 つ → 候補にならない
  - 同じ金額のまとまりが 2 つで差額がその 1 つ分 → 選び方が 2 つ → `checked` なし
  - 候補が多い(同じ行が 30 個のまとまりを 3 つ)→ 探さず `checked` なし(すぐ返る)
  - `removeRows` → 指定した行だけ消え、残った行の `status` はそのまま。知らない id は数えない
- [ ] **Step 2: 失敗を確かめる**:`node --test tests/cards.test.js`
- [ ] **Step 3: 作る**
- [ ] **Step 4: 通るのを確かめる**:`node --test`
- [ ] **Step 5: コミット**

### Task 3: 次のお支払いの予想

**Files:**
- Modify: `js/features/payments/cards-model.js`
- Test: `tests/cards.test.js`

**Interfaces:**
- Consumes:`activeKnown` ではなく使う月の範囲の判定(Task 1)、`unmatchedRecords`
- Produces:`C.forecast(p, cardId) -> { month, monthly: [{ merchant, amount }], monthlyTotal, records: [record], recordsTotal, total }`
  - `month`:そのカードのいちばん新しい明細の次の月(明細が無ければ `p.month` の次の月)
  - `monthly`:そのカードの覚えのうち、`month` に使うもの
  - `records`:どの明細の行とも突き合わなかった記録のうち、いちばん新しい明細の最初の日以降のもの(明細が無ければ全部)。日付の古い順

- [ ] **Step 1: 失敗するテストを書く**:`test('次のお支払いの予想:毎月の支払い + まだ明細に出ていない記録')`
  - 架空の明細(11 月払い)・覚え 2 つ(1 つは `until` 済みで入らない)・記録 3 つ(1 つは明細と一致、1 つは明細の最初の日より前で入らない、1 つは 11 月の記録)→ `month === '2026-12'`、合計が合う
  - 明細が無いカード → `month` は支払いの月の次、記録は全部
- [ ] **Step 2: 失敗を確かめる**
- [ ] **Step 3: 作る**
- [ ] **Step 4: 通るのを確かめる**:`node --test`
- [ ] **Step 5: コミット**

### Task 4: 画面(重複の欄・予想・1 回で問題なし・毎月同じ支払いのチェック)

**Files:**
- Modify: `js/features/payments/cards-view.js`(render・summaryCard の下・checkRow・okFlow を消す・knownCard・openStatementSheet の drawTable)
- Modify: `css/style.css`(`.dup-box` ほか。サンプル `card-use.html` の「アプリに足す見た目」と同じ)

**Interfaces:**
- Consumes:`C.duplicates`・`C.removeRows`・`C.forecast`・`C.monthlyOf`・`C.setMonthly`・`C.setRowStatus`・`C.activeKnown`・`C.totals`

- [ ] **Step 1: 重複の欄を 1 つの関数にする**:`dupBox(rows, ref, refName, onDelete) -> Element|null`(候補が無ければ null)。説明の文はサンプルと同じ 4 通り(請求額なし・選び方が合った・合計が同じ・合わない)。ボタンは `btn-danger` で「チェックした ○件を消す(○円)」、0 件なら押せない
- [ ] **Step 2: 保存した明細の画面**:summaryCard の下に「重複かもしれない行」のカード(`ref` は `C.totals(p, st).billAmount`)。消すときは `store.update(…, { backup: 'カードの明細の重複の削除' })` → トースト「○件を消しました」。その下に「次のお支払いの予想(○月払い)」のカード:「少なくとも ○円」、毎月の支払い(件数・合計・内訳)、まだ明細に出ていない記録(件数・合計・内訳)、注意の 1 文。覚えも記録も無ければ出さない
- [ ] **Step 3: 読み取った直後**:drawTable の合計の比べの下に重複の欄。`ref` は、選んだお支払いの月が `p.month` で請求額があればそれ(名前は「請求額」)、無ければスクショから見つけた合計(名前は「明細に書かれた合計」)。消すと表を描き直す(保存はしない)
- [ ] **Step 4: 確かめてほしいもの**:
  - 未確認の行:「問題なし」「おかしい」と、右に「毎月同じ支払い」のチェック(最初の状態は `monthlyOf` があるか、いまの okFlow と同じ名前・`changed` の決め方)。「問題なし」で `setRowStatus(…, 'ok', { monthly: チェック })` してトースト。okFlow のポップアップは消す
  - 確認済み(問題なし)の行:印・メモ・「毎月同じ支払い」のチェック(`monthlyOf` で付き外し、変えたらすぐ `setMonthly` してトースト「毎月の支払いとして覚えました」「毎月の支払いから外しました」)・「戻す」
  - 「おかしい」の行:いまのまま(チェックは出さない)
- [ ] **Step 5: 毎月の支払いとして覚えたものの一覧**:`activeKnown` を使う
- [ ] **Step 6: 画面で確かめる**:ローカルで架空のデータを入れ、iPhone 13 のライト・ダークで、重複を消す → 請求額と一致、問題なし → チェックが残り付け外しできる、予想の数字、はみ出しなし、「null」の文字なし、エラーなし
- [ ] **Step 7: コミット**

### Task 5: 仕上げとマージ

**Files:**
- Modify: `js/core/store.js`・`index.html`・`sw.js`(版を `2026.11.22-1` に)
- Modify: `README.md`(カードの明細の説明・データの形 v17・移行の一覧・テストの件数・確かめる一覧)
- Modify: `docs/wishlist.md`(「カードの明細の活用」を「済み」へ)

- [ ] **Step 1: 版と README・リストを直す**
- [ ] **Step 2: 全部のテスト**:`node --test` → 全部成功
- [ ] **Step 3: 全画面の確かめ**:`fullpass.js`(30 画面 × iPhone 13/SE × ライト/ダーク)で問題なし、カードの流れ(`cards-app.js`)が動く
- [ ] **Step 4: 差分に実際のデータが無いか確かめる**(名前・お店・金額の言葉で探す)
- [ ] **Step 5: コミット・プッシュ・PR・マージ**(いつもどおりマージまで)
