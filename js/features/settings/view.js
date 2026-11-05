/*
 * 設定:データの書き出し・読み込み、Excel の過去記録の取り込み、価格の自動取得、旧アプリの取り込み、
 *       サンプル、元に戻す、全削除
 */
(function (root) {
  'use strict';
  const MT = root.MT;
  const U = MT.util;
  const store = MT.store;
  const { h, add, icon, btn, confirmDialog, openSheet, toast } = MT.ui;

  function formatDateTime(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function formatBytes(n) {
    if (n < 1024) return `${n} B`;
    return `${(n / 1024).toFixed(1)} KB`;
  }

  function render(container) {
    const d = store.get();
    const backup = store.getBackupInfo();
    const lastExport = U.prefs.get('lastExportAt', null);
    const fileInput = h('input', { type: 'file', accept: 'application/json,.json', class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true' });
    fileInput.addEventListener('change', () => {
      const file = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (file) importFlow(file);
    });

    container.append(
      h(
        'header',
        { class: 'page-head' },
        h('a', { class: 'back-link', href: '#/more' }, icon('back'), h('span', { text: 'その他' })),
        h('h1', { class: 'page-title page-title-sub', text: '設定' })
      ),

      backupCard(lastExport, fileInput),

      themeCard(),

      importCard(d),

      priceSettingsCard(d),

      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card-title', text: '副業・在庫' }),
        MT.forms.field('在庫(ポケカ)の評価額の反映先(月末記録の項目)', MT.inventoryUI.reflectTargetSelect()),
        h('div', { class: 'button-row' }, btn('副業の依頼元の設定(最大5件)', { onClick: () => MT.app.navigate('sidejob/clients') }))
      ),

      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card-title', text: 'サンプルデータ' }),
        h('p', { text: '架空の項目と 6 か月分の金額、支払い管理・資産管理・在庫・副業の例を読み込んで、動きを試せます。今のデータは上書きされます。' }),
        h('div', { class: 'button-col' }, btn('サンプルを読み込む', { onClick: loadSampleFlow }))
      ),

      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card-title', text: '旧・支払い管理アプリから移行' }),
        h('p', { text: '旧アプリのバックアップ(JSON テキスト)を読み込み、支払い管理のデータに変換します。読み込む前に、変換結果と、変換できなかった項目の一覧を確認できます。' }),
        h('div', { class: 'button-col' }, btn('旧・支払い管理アプリのバックアップを読み込む', { icon: 'upload', onClick: legacyImportFlow }))
      ),

      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card-title', text: '旧・資産管理アプリから移行' }),
        h('p', { text: '旧アプリのバックアップ(JSON)の保有銘柄・履歴・価格を、資産管理のデータに変換します。読み込む前に、変換結果と、変換できなかった項目の一覧を確認できます。' }),
        h('div', { class: 'button-col' }, btn('旧・資産管理アプリのバックアップを読み込む', { icon: 'upload', onClick: assetsLegacyFlow }))
      ),

      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card-title', text: '旧・副業管理アプリ / 旧・ポケカ管理アプリから移行' }),
        h('p', { text: '旧アプリのバックアップ(JSON や .txt)を読み込みます。読み込む前に、変換結果と、変換できなかった項目の一覧を確認できます。' }),
        h(
          'div',
          { class: 'button-col' },
          btn('旧・副業管理アプリのバックアップを読み込む', { icon: 'upload', onClick: sidejobLegacyFlow }),
          btn('旧・ポケカ管理アプリのバックアップを読み込む', { icon: 'upload', onClick: inventoryLegacyFlow })
        )
      ),

      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card-title', text: '直前のデータに戻す' }),
        h('p', { text: '読み込み・サンプル・削除をする直前のデータを 1 つだけ残しています。もう一度押すと、戻す前の状態に戻ります。' }),
        backup
          ? h(
              'p',
              { class: 'hint' },
              `${formatDateTime(backup.savedAt)} の${backup.reason ? '「' + backup.reason + '」' : ''}直前のデータ`,
              h('br'),
              backup.summary.join(' / ')
            )
          : h('p', { class: 'hint', text: '戻せるデータはまだありません。' }),
        h('div', { class: 'button-col' }, Object.assign(btn('直前のデータに戻す', { onClick: restoreFlow }), { disabled: !backup }))
      ),

      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card-title', text: '保存しているデータ' }),
        h(
          'dl',
          { class: 'info-list' },
          infoRow('内容', store.summarize(d).join(' / ')),
          infoRow('最終保存', formatDateTime(d.meta.updatedAt)),
          infoRow('サイズ', formatBytes(store.storedBytes())),
          infoRow('データ形式', `schemaVersion ${d.schemaVersion}`),
          infoRow('アプリの版', store.APP_VERSION)
        ),
        h(
          'div',
          { class: 'notice notice-info notice-compact' },
          icon('info', 'notice-icon'),
          h(
            'div',
            { class: 'notice-main' },
            h('p', { class: 'notice-text', text: 'データはこの端末のブラウザ(localStorage)の中だけに保存され、サーバーには送信されません。' }),
            h('p', { class: 'notice-text', text: 'iPhone では、Safari で開いた場合とホーム画面から開いた場合で、保存場所が別々になります。ふだん使う方を決めておき、移すときは書き出し・読み込みを使ってください。' })
          )
        )
      ),

      appCard(),

      h(
        'section',
        { class: 'card card-danger' },
        h('h2', { class: 'card-title', text: 'すべてのデータを削除' }),
        h('p', { text: 'この端末に保存しているマネートラッカーのデータを消して、最初の状態に戻します。価格取得の URL とキーは残ります(上の「URLとキーを消す」で消せます)。' }),
        h('div', { class: 'button-col' }, btn('すべて削除する', { variant: 'danger', onClick: clearFlow }))
      ),

      h('p', { class: 'app-version', text: `マネートラッカー ${store.APP_VERSION}(段階1〜6)` })
    );
  }

  /** Excel の過去記録の取り込み(月末記録・カード推移)と、その履歴・元に戻す */
  function importCard(d) {
    const IM = MT.importsModel;
    const UI = MT.importsUI;
    const log = d.imports ? d.imports.log : [];
    const target = IM.undoTarget(d);
    return h(
      'section',
      { class: 'card' },
      h('h2', { class: 'card-title', text: 'Excel の過去記録を取り込む' }),
      h('p', { text: 'Excel で付けていた表を、貼り付け(コピー)か CSV ファイルで取り込みます。取り込む前に、月と行の対応や、月ごとの合計を確認できます。' }),
      h(
        'div',
        { class: 'button-col' },
        btn('月末記録(口座資産の表)を取り込む', { icon: 'upload', variant: 'primary', onClick: () => UI.open('monthly') }),
        btn('カード推移の表を取り込む', { icon: 'upload', onClick: () => UI.open('cards') })
      ),
      h('p', { class: 'hint', text: '表の形:1列目が項目名(カード名)、2列目以降が月ごとの金額。見出しの月名は使わず、最初の月列の年月を指定して、右へ 1 か月ずつ進めて読みます。' }),
      h('h3', { class: 'sp-title', text: '取り込みの履歴' }),
      log.length
        ? h(
            'ul',
            { class: 'report-list' },
            log.slice(0, 5).map((e) => h('li', { text: `${formatDateTime(e.at)} ${IM.describe(e)}${e.fileName ? `(${e.fileName})` : ''}${e.undone ? '(元に戻し済み)' : ''}` }))
          )
        : h('p', { class: 'hint', text: 'まだ取り込んでいません。' }),
      h('div', { class: 'button-col' }, Object.assign(btn('直前の取り込みを元に戻す', { onClick: () => UI.undoFlow() }), { disabled: !target })),
      h('p', { class: 'hint', text: target ? `元に戻せる取り込み:${formatDateTime(target.at)} ${IM.describe(target)}` : '元に戻せる取り込みはありません。' })
    );
  }

  /** 表示テーマ(ライト / ダーク / 端末に合わせる)。端末ごとの設定で、データの書き出しには含めない */
  function themeCard() {
    const seg = MT.forms.segmented(
      MT.theme.PREFS.map((p) => ({ value: p, label: MT.theme.LABELS[p] })),
      MT.theme.pref(),
      { label: '表示テーマ', onChange: (v) => MT.theme.set(v) }
    );
    return h(
      'section',
      { class: 'card' },
      h('h2', { class: 'card-title', text: '表示テーマ' }),
      seg.el,
      h('p', { class: 'hint', text: '「端末に合わせる」は、iPhone のライト/ダークの設定に合わせて自動で変わります。画面右上の丸いボタンでも、ライトとダークを 1 タップで切り替えられます。' }),
      h('p', { class: 'hint', text: '選んだテーマはこの端末にだけ保存し、データの書き出しには含めません。' })
    );
  }

  /** バックアップ(いちばん上に、目立たせて置く) */
  function backupCard(lastExport, fileInput) {
    const b = MT.monthEndModel ? MT.monthEndModel.backupInfo(new Date(), lastExport) : { at: lastExport, days: null, stale: !lastExport };
    const days = MT.monthEndModel ? MT.monthEndModel.BACKUP_DAYS : 30;
    return h(
      'section',
      { class: 'card card-backup' },
      h('h2', { class: 'card-title', text: 'バックアップ' }),
      h('p', { text: 'すべてのデータを 1 つのファイル(JSON)に書き出します。機種変更や、もしものときに備えて、月に 1 回は書き出して「ファイル」アプリや iCloud Drive などに保存しておくと安心です。' }),
      b.stale
        ? h(
            'div',
            { class: 'notice notice-warn notice-compact' },
            icon('alert', 'notice-icon'),
            h('div', { class: 'notice-main' }, h('p', { class: 'notice-text', text: b.at ? `最後のバックアップから ${b.days}日たっています(${days}日以上)。書き出しておきましょう。` : 'まだバックアップしていません。書き出しておきましょう。' }))
          )
        : null,
      h(
        'div',
        { class: 'button-col' },
        btn('バックアップ(全データを書き出す)', { icon: 'download', variant: 'primary', onClick: exportFlow }),
        btn('バックアップから戻す', { icon: 'upload', onClick: () => fileInput.click() })
      ),
      fileInput,
      h('p', { class: 'hint', text: b.at ? `この端末で最後にバックアップした日時:${formatDateTime(b.at)}` : 'この端末ではまだバックアップしていません。' })
    );
  }

  /** アプリ(ホーム画面から開く場合のオフライン・更新) */
  function appCard() {
    const st = MT.pwa ? MT.pwa.status() : { supported: false, offlineReady: false };
    const offline = !st.supported ? 'この開き方では使えません(試用ページなど)' : st.offlineReady ? '電波がなくても開けます' : '準備中(次に開いたときから)';
    return h(
      'section',
      { class: 'card' },
      h('h2', { class: 'card-title', text: 'アプリの更新' }),
      h('dl', { class: 'info-list' }, infoRow('アプリの版', store.APP_VERSION), infoRow('オフライン', offline)),
      h('p', { class: 'hint', text: '新しい版は、ふだんは次に開いたときに自動で入れ替わります。古い画面のままのときは「最新版に更新」を押してください。アプリのファイルだけを読み直し、データは消えません(インターネットに接続して行ってください)。' }),
      h(
        'div',
        { class: 'button-col' },
        Object.assign(
          btn('最新版に更新', {
            icon: 'sync',
            onClick: async () => {
              const ok = await MT.ui.confirmDialog({ title: '最新版に更新しますか?', message: ['アプリのファイルをネットから読み直します。データは消えません。'], okLabel: '更新する' });
              if (ok) MT.pwa.forceUpdate();
            },
          }),
          { disabled: !st.supported }
        )
      )
    );
  }

  function infoRow(label, value) {
    return [h('dt', { text: label }), h('dd', { text: value })];
  }

  // ---- 価格の自動取得(資産管理) ----

  function priceSettingsCard(d) {
    const A = MT.assetsModel;
    const sec = MT.secrets.get();
    const set = d.assets.settings;
    const { field, textInput } = MT.forms;
    const url = textInput(sec.priceUrl || '', { type: 'url', inputmode: 'url', autocapitalize: 'off', spellcheck: 'false', placeholder: 'https://…', 'aria-label': '価格取得のURL' });
    const key = textInput(sec.finnhubKey || '', { type: 'password', autocapitalize: 'off', spellcheck: 'false', placeholder: '未設定', 'aria-label': 'Finnhub の APIキー' });
    const showKey = btn('表示', {
      size: 'small',
      onClick: () => {
        key.type = key.type === 'password' ? 'text' : 'password';
        showKey.querySelector('span').textContent = key.type === 'password' ? '表示' : '隠す';
      },
    });
    const fxCode = textInput(set.fxCode, { maxlength: 20, autocapitalize: 'characters', 'aria-label': '為替のコード' });
    const fxManual = MT.ui.amountField({ value: set.fxManual, decimals: 4, unit: '円', label: 'USD/JPY(手入力)', compact: true });
    const tax = MT.ui.amountField({ value: Math.round(set.taxRate * 100000) / 1000, decimals: 3, unit: '%', label: '税率', compact: true });
    const err = h('p', { class: 'field-error', role: 'alert', hidden: true });
    const autoBox = MT.forms.checkbox('アプリを開いたときに、価格を自動で更新する', MT.assetsAuto ? MT.assetsAuto.enabled() : false);
    autoBox.input.addEventListener('change', () => {
      MT.assetsAuto.setEnabled(autoBox.input.checked);
      toast(autoBox.input.checked ? '開いたときの自動更新をオンにしました' : '開いたときの自動更新をオフにしました');
    });

    function save() {
      err.hidden = true;
      const u = url.value.trim();
      if (u && !/^https:\/\/[^\s]+$/.test(u)) {
        err.textContent = 'URL は https:// で始まるものを入れてください';
        err.hidden = false;
        return;
      }
      const fx = fxManual.result();
      const t = tax.result();
      if (!fx.ok || (fx.value !== null && fx.value <= 0)) {
        err.textContent = 'USD/JPY は 0 より大きい数で入れてください';
        err.hidden = false;
        return;
      }
      if (!t.ok || t.value === null || t.value < 0 || t.value >= 100) {
        err.textContent = '税率は 0〜100 の % で入れてください';
        err.hidden = false;
        return;
      }
      MT.secrets.set({ priceUrl: u, finnhubKey: key.value.trim() });
      if (
        store.update((dd) => {
          dd.assets.settings.fxManual = fx.value;
          dd.assets.settings.fxCode = A.normCode(fxCode.value) || 'USDJPY';
          dd.assets.settings.taxRate = t.value / 100;
        })
      )
        toast('価格取得の設定を保存しました');
    }

    async function clearSecrets() {
      const ok = await confirmDialog({ title: 'URLとキーを消しますか?', message: ['この端末に保存している価格取得の URL と Finnhub のキーを消します。'], okLabel: '消す', danger: true });
      if (!ok) return;
      MT.secrets.clear();
      MT.app.rerender();
      toast('URLとキーを消しました');
    }

    return h(
      'section',
      { class: 'card' },
      h('h2', { class: 'card-title', text: '価格の自動取得(資産)' }),
      h('div', { class: 'form-stack' },
        field('国内株・投資信託の価格取得URL', url, '「?codes=コード1,コード2」を付けて問い合わせます。返事の version が "v6" のものに対応しています。'),
        field('Finnhub の APIキー(米国株)', h('div', { class: 'input-with-btn' }, key, showKey), 'キーが無いときは、米国株の株価をドルで手入力します。'),
        h('div', { class: 'form-2col' }, field('為替のコード', fxCode), field('USD/JPY(手入力)', fxManual.el)),
        h('p', { class: 'form-hint', text: 'USD/JPY は、上の URL に為替のコードも一緒に問い合わせ、無ければキー不要の公開の為替レートを使います(Finnhub は米国株の株価だけ)。どちらも取れないとき(試用ページなど外に接続できない場所)は、手入力の値を使います。' }),
        field('税率(課税口座の含み益・配当)', tax.el, '既定は 20.315%。NISA は 0% として計算します。'),
        autoBox.el,
        h('p', { class: 'form-hint', text: `アプリを開いたときや、ほかのアプリから戻ってきたときに、前回の更新から ${A.AUTO_MIN_MINUTES} 分以上たっていたら価格を取りに行きます。結果は画面の下に短く出ます(この端末だけの設定)。` }),
        err
      ),
      h('p', { class: 'hint', text: 'URL とキーはこの端末の中だけに保存し、JSON の書き出しには含めません(書き出すときに含めることもできます)。送るのは銘柄コードだけで、数量や金額は送りません。' }),
      h(
        'div',
        { class: 'button-row' },
        btn('保存', { variant: 'primary', onClick: save }),
        btn('月末記録への反映先', { onClick: () => MT.assetsUI.openReflectMappingSheet() }),
        h('a', { class: 'btn btn-secondary', href: '#/assets/changes' }, h('span', { text: '分割・配当の確認' })),
        MT.secrets.has() ? btn('URLとキーを消す', { variant: 'ghost', className: 'btn-ghost-danger', onClick: clearSecrets }) : null
      )
    );
  }

  // ---- 書き出し ----

  /** 価格取得の URL とキーがあれば、含めるかどうかを聞いてから書き出す */
  function exportFlow() {
    if (!MT.secrets.has()) return doExport(false);
    const s = openSheet({ title: 'JSON ファイルに書き出す', className: 'sheet-form' });
    const { checkbox } = MT.forms;
    const box = checkbox('価格取得の URL と APIキーも含める', false);
    s.body.append(
      box.el,
      h('p', { class: 'form-hint', text: '含めると、ファイルを見た人が URL やキーを使えてしまいます。人に渡すファイルや、公開する場所には含めないでください。' })
    );
    s.foot.append(
      btn('キャンセル', { onClick: () => s.close() }),
      btn('書き出す', {
        variant: 'primary',
        onClick: () => {
          s.close();
          doExport(box.input.checked);
        },
      })
    );
  }

  function doExport(withSecrets) {
    const json = store.exportJSON(withSecrets ? { secrets: MT.secrets.get() } : null);
    const name = `money-tracker-${U.todayStr()}.json`;
    const blob = new Blob([json], { type: 'application/json' });
    const done = () => {
      U.prefs.set('lastExportAt', new Date().toISOString());
      MT.app.rerender();
    };

    // iPhone などでは共有シート(「ファイルに保存」)を使う
    let file = null;
    try {
      file = new File([blob], name, { type: 'application/json' });
    } catch (e) {
      file = null;
    }
    const touch = root.matchMedia && root.matchMedia('(pointer: coarse)').matches;
    if (touch && file && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator
        .share({ files: [file], title: name })
        .then(() => {
          done();
          toast('書き出しました');
        })
        .catch((err) => {
          if (err && err.name === 'AbortError') return; // 利用者がキャンセル
          download(blob, name);
          done();
        });
      return;
    }
    download(blob, name);
    done();
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name, class: 'visually-hidden' });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast(`${name} を書き出しました`);
  }

  // ---- 読み込み ----

  async function importFlow(file) {
    let parsed = null;
    try {
      parsed = JSON.parse(await file.text());
    } catch (e) {
      toast('JSON ファイルとして読み取れませんでした', { type: 'error' });
      return;
    }
    const res = store.prepare(parsed);
    if (!res.ok) {
      toast(res.error, { type: 'error', duration: 5000 });
      return;
    }
    const exportedAt = parsed.meta && parsed.meta.exportedAt;
    const fileSecrets = MT.secrets.clean(parsed.secrets);
    const hasSecrets = Object.keys(fileSecrets).length > 0;
    const ok = await confirmDialog({
      title: 'データを読み込みますか?',
      message: [
        `ファイル:${file.name}`,
        ...store.summarize(res.data),
        exportedAt ? `書き出した日時:${formatDateTime(exportedAt)}` : null,
        hasSecrets ? 'このファイルには価格取得の URL・キーが入っているので、それも読み込みます。' : null,
        '今のデータはすべて上書きされます。(上書き前のデータは「直前のデータに戻す」で戻せます)',
      ].filter(Boolean),
      okLabel: '上書きして読み込む',
      danger: true,
    });
    if (!ok) return;
    if (store.replaceAll(res.data, 'ファイルの読み込み')) {
      if (hasSecrets) MT.secrets.set(fileSecrets);
      toast('読み込みました');
    }
  }

  // ---- サンプル ----

  async function loadSampleFlow() {
    if (store.hasContent(store.get())) {
      const ok = await confirmDialog({
        title: 'サンプルを読み込みますか?',
        message: ['今のデータはサンプルで上書きされます。', '上書き前のデータは「直前のデータに戻す」で戻せます。'],
        okLabel: '上書きして読み込む',
        danger: true,
      });
      if (!ok) return;
    }
    if (store.replaceAll(MT.sample.build(), 'サンプルの読み込み')) {
      MT.app.navigate('monthly');
      toast('サンプルを読み込みました');
    }
  }

  // ---- 旧アプリの取り込み(共通) ----
  // どのボタンからでも「LZ:」・base64・JSON を読み、別のアプリのバックアップなら、読むべきボタンを案内する

  const LB = () => MT.legacyBackup;

  /** 「LZ:」で始まるときだけ LZ-String を読み込む(読み込めなければ null) */
  async function lzFor(text) {
    if (!LB().needsLz(text)) return null;
    try {
      return await MT.libs.load('lzstring');
    } catch (e) {
      return null;
    }
  }

  /**
   * バックアップのテキストを戻し、expected(payments / assets / sidejob / inventory)のものか確かめる。
   * @returns {Promise<{ok: true, obj} | {ok: false, message: string, kind?: string}>}
   */
  async function readLegacyBackup(text, expected) {
    const u = LB().unwrap(text, await lzFor(text));
    if (!u.ok) return { ok: false, message: u.error };
    const kind = LB().identify(u.obj);
    if (kind && kind !== expected) return { ok: false, message: LB().wrongKindMessage(kind, expected), kind };
    return { ok: true, obj: u.obj };
  }

  /** 別の取り込みを開く(貼り付けた文字を引き継ぐ) */
  function openLegacy(kind, text) {
    const open = { payments: legacyImportFlow, assets: assetsLegacyFlow, sidejob: sidejobLegacyFlow, inventory: inventoryLegacyFlow }[kind];
    if (open) open(text);
  }

  /**
   * バックアップを貼り付ける(またはファイルを選ぶ)ダイアログ。
   * onNext(text) が null を返したら閉じる。文字列か { message, kind } を返したら案内を出し、
   * kind があれば、そのバックアップ用の取り込みへ移るボタンも出す。
   */
  function pasteSheet({ title, placeholder, initial, onNext }) {
    const s = openSheet({ title, description: 'バックアップのテキストを貼り付けるか、ファイルを選んでください(「LZ:」で始まる形も読めます)。', className: 'sheet-form' });
    const ta = h('textarea', { class: 'field-textarea paste-area', rows: 6, placeholder, 'aria-label': 'バックアップのテキスト', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
    ta.value = typeof initial === 'string' ? initial : ''; // ボタンから開いたときは、クリックの情報が入ってくるので使わない
    const file = h('input', { type: 'file', accept: 'application/json,.json,.txt,text/plain', class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true' });
    const errBox = h('div', { role: 'alert' });
    file.addEventListener('change', async () => {
      const f = file.files && file.files[0];
      file.value = '';
      if (f) ta.value = await f.text();
    });
    function showError(res) {
      const message = typeof res === 'string' ? res : res.message;
      const kind = typeof res === 'object' && res.kind && res.kind !== 'app' ? res.kind : null;
      errBox.replaceChildren();
      add(
        errBox,
        h('p', { class: 'field-error', text: message }),
        kind
          ? h(
              'div',
              { class: 'button-row' },
              btn(`${LB().KINDS[kind].label}の取り込みで読む`, {
                variant: 'primary',
                size: 'small',
                onClick: () => {
                  const text = ta.value;
                  s.close();
                  openLegacy(kind, text);
                },
              })
            )
          : null
      );
    }
    s.body.append(
      ta,
      h('div', { class: 'button-row' }, btn('ファイルを選ぶ', { icon: 'upload', size: 'small', onClick: () => file.click() })),
      file,
      errBox,
      h('p', { class: 'form-hint', text: '次の画面で内容を確認してから読み込みます。データはこの端末の中だけで変換され、どこにも送信されません。' })
    );
    const next = btn('確認へ', { variant: 'primary' });
    next.addEventListener('click', async () => {
      next.disabled = true;
      try {
        const res = await onNext(ta.value);
        if (res) showError(res);
        else s.close();
      } finally {
        next.disabled = false;
      }
    });
    s.foot.append(btn('キャンセル', { onClick: () => s.close() }), next);
  }

  // ---- 旧・支払い管理アプリの取り込み ----

  function legacyImportFlow(initial) {
    pasteSheet({
      title: '旧・支払い管理アプリのバックアップ',
      placeholder: '{"accounts":[…],"payments":[…], …}',
      initial,
      onNext: async (textValue) => {
        const b = await readLegacyBackup(textValue, 'payments');
        if (!b.ok) return b;
        const r = MT.paymentsLegacy.parse(JSON.stringify(b.obj));
        if (!r.ok) return r.error;
        let res;
        try {
          res = MT.paymentsLegacy.convert(r.obj, store.get());
        } catch (e) {
          return '変換中に問題が起きました。バックアップの中身を確認してください。';
        }
        showLegacyReport(res);
        return null;
      },
    });
  }

  function showLegacyReport(res) {
    const { counts: c, accounts, issues, notes } = res.report;
    const s = openSheet({ title: '読み込む内容の確認', className: 'sheet-form' });
    const list = (items, cls = '') => h('ul', { class: `report-list ${cls}`.trim() }, items.map((t) => h('li', { text: t })));
    add(
      s.body,
      list([
        `口座 ${c.banks}件・手元現金 ${c.wallets}件(月末記録の項目とつなぐ ${c.linked}件・新しく項目を作る ${c.created}件)`,
        `支払い・ローン ${c.bills}件(内訳 ${c.subItems}件)`,
        `入金予定 ${c.incomes}件`,
        `特別支出 ${c.specials}件`,
        `履歴 ${c.history}か月分`,
      ]),
      accounts.length
        ? [
            h('h3', { class: 'form-section-title', text: '口座' }),
            list(accounts.map((a) => `${a.label}「${a.name}」:${a.action === 'linked' ? '同じ名前の項目とつなぎます' : '月末記録に項目を作ります'}`)),
          ]
        : null,
      h('h3', { class: 'form-section-title', text: `変換できなかった項目(${issues.length}件)` }),
      issues.length ? list(issues, 'is-issue') : h('p', { class: 'form-hint', text: 'ありません。' }),
      notes.length ? [h('h3', { class: 'form-section-title', text: `変換のしかたを変えた項目(${notes.length}件)` }), list(notes)] : null,
      h('p', {
        class: 'sheet-text',
        text: '今の支払い管理のデータは、読み込む内容に置き換わります。月末記録の金額はそのままです(足りない口座だけ項目を追加します)。上書き前のデータは「直前のデータに戻す」で戻せます。',
      })
    );
    s.foot.append(
      btn('キャンセル', { onClick: () => s.close() }),
      btn('読み込む', {
        variant: 'primary',
        onClick: () => {
          if (store.replaceAll(res.data, '旧アプリのバックアップの読み込み')) {
            s.close();
            MT.app.navigate('payments');
            toast('旧アプリのデータを読み込みました');
          }
        },
      })
    );
  }

  // ---- 旧・資産管理アプリの取り込み ----

  function assetsLegacyFlow(initial) {
    pasteSheet({
      title: '旧・資産管理アプリのバックアップ',
      placeholder: '{"holdings":[…],"history":[…],"prices":{…},"lastTotal":…}',
      initial,
      onNext: async (textValue) => {
        const b = await readLegacyBackup(textValue, 'assets');
        if (!b.ok) return b;
        const r = MT.assetsLegacy.parse(JSON.stringify(b.obj));
        if (!r.ok) return r.error;
        assetsLegacyConfirm(r.obj);
        return null;
      },
    });
  }

  /** 読み込む前の確認:はっきりしない点を選び、変換結果を見てから読み込む */
  function assetsLegacyConfirm(obj) {
    const L = MT.assetsLegacy;
    const info = L.analyze(obj);
    const a = store.get().assets;
    const fxRate = a.fx.rate || a.settings.fxManual || null;
    const { segmented, field } = MT.forms;
    const s = openSheet({ title: '読み込む内容の確認', className: 'sheet-form' });
    const opts = { fundUnit: info.fundGuess, usAvg: 'yen', fxRate };
    const result = h('div');
    const list = (items, cls = '') => h('ul', { class: `report-list ${cls}`.trim() }, items.map((t) => h('li', { text: t })));

    function draw() {
      let res;
      try {
        res = L.convert(obj, store.get(), opts);
      } catch (e) {
        result.replaceChildren(h('p', { class: 'field-error', text: '変換中に問題が起きました。バックアップの中身を確認してください。' }));
        return null;
      }
      const c = res.report.counts;
      result.replaceChildren();
      add(
        result,
        list([`保有 ${c.holdings}件(うち NISA ${c.nisa}件は読み込み後に旧/新を選び直し)`, `履歴 ${c.history}日分`, `価格 ${c.priced}件`, `手入力の資産 ${c.keptManual}件はそのまま残します`]),
        h('h3', { class: 'form-section-title', text: `変換できなかった項目(${res.report.issues.length}件)` }),
        res.report.issues.length ? list(res.report.issues, 'is-issue') : h('p', { class: 'form-hint', text: 'ありません。' }),
        res.report.notes.length ? [h('h3', { class: 'form-section-title', text: 'お知らせ' }), list(res.report.notes)] : null
      );
      return res;
    }

    const choices = [];
    if (info.funds) {
      const ex = info.fundExample;
      const seg = segmented(
        [
          { value: 'raw', label: '口数そのまま(1万で割る)' },
          { value: 'asis', label: 'すでに口数÷1万' },
        ],
        opts.fundUnit,
        {
          label: '投資信託の数量の単位',
          onChange: (v) => {
            opts.fundUnit = v;
            draw();
          },
        }
      );
      choices.push(field('投資信託の数量(旧アプリ)', seg.el, `${info.guessReason}。例:${ex.name} の数量 ${U.formatNumber(ex.quantity, 6)}`));
    }
    if (info.us) {
      const ex = info.usExample;
      const seg = segmented(
        [
          { value: 'yen', label: '円' },
          { value: 'usd', label: fxRate ? `ドル(×${fxRate}で円に)` : 'ドル(USD/JPY 未設定)' },
        ],
        'yen',
        {
          label: '米国株の平均取得単価の通貨',
          onChange: (v) => {
            opts.usAvg = v;
            draw();
          },
        }
      );
      choices.push(field('米国株の平均取得単価(旧アプリ)', seg.el, `例:${ex.name} の平均取得単価 ${U.formatNumber(ex.avgPrice || 0, 4)}${ex.price ? `・旧アプリの価格 ${U.formatNumber(ex.price, 4)}` : ''}`));
    }
    s.body.append(...choices, result, h('p', { class: 'sheet-text', text: '資産管理の「保有」と「履歴」が読み込む内容に置き換わります。上書き前のデータは「直前のデータに戻す」で戻せます。' }));
    draw();
    s.foot.append(
      btn('キャンセル', { onClick: () => s.close() }),
      btn('読み込む', {
        variant: 'primary',
        onClick: () => {
          const res = draw();
          if (!res) return;
          if (store.replaceAll(res.data, '旧・資産管理アプリの読み込み')) {
            s.close();
            MT.app.navigate('assets');
            toast('旧アプリのデータを読み込みました');
            if (res.report.counts.nisa) MT.assetsUI.openNisaReviewSheet();
          }
        },
      })
    );
  }

  // ---- 旧・副業管理アプリ / 旧・ポケカ管理アプリ ----

  /** 変換結果の確認と読み込み */
  function legacyConfirm({ title, lines, report, replaceText, reason, navigateTo, data }) {
    const s = openSheet({ title, className: 'sheet-form' });
    const list = (items, cls = '') => h('ul', { class: `report-list ${cls}`.trim() }, items.map((t) => h('li', { text: t })));
    add(
      s.body,
      list(lines),
      h('h3', { class: 'form-section-title', text: `変換できなかった項目(${report.issues.length}件)` }),
      report.issues.length ? list(report.issues, 'is-issue') : h('p', { class: 'form-hint', text: 'ありません。' }),
      report.notes.length ? [h('h3', { class: 'form-section-title', text: 'お知らせ' }), list(report.notes)] : null,
      h('p', { class: 'sheet-text', text: `${replaceText}上書き前のデータは「直前のデータに戻す」で戻せます。` })
    );
    s.foot.append(
      btn('キャンセル', { onClick: () => s.close() }),
      btn('読み込む', {
        variant: 'primary',
        onClick: () => {
          if (store.replaceAll(data, reason)) {
            s.close();
            MT.app.navigate(navigateTo);
            toast('旧アプリのデータを読み込みました');
          }
        },
      })
    );
  }

  const FORMAT_LABEL = { settingsFirst: '[設定, 記録] の形', recordsFirst: '[記録, 設定] の形', object: '{ jobs, settings } の形' };

  function sidejobLegacyFlow(initial) {
    pasteSheet({
      title: '旧・副業管理アプリのバックアップ',
      placeholder: '[["依頼元A",1.2,"…","依頼元B",0.8,"…"],[[261102,0,1.2,1,1], …]] など',
      initial,
      onNext: async (textValue) => {
        const b = await readLegacyBackup(textValue, 'sidejob');
        if (!b.ok) return b;
        const L = MT.sidejobLegacy;
        const p = L.parse(JSON.stringify(b.obj));
        if (!p.ok) return p.error;
        let res;
        try {
          res = L.convert(p, store.get());
        } catch (e) {
          return '変換中に問題が起きました。バックアップの中身を確認してください。';
        }
        const c = res.report.counts;
        legacyConfirm({
          title: '読み込む内容の確認(副業)',
          lines: [`形式:${FORMAT_LABEL[p.format]}`, `依頼元 ${c.clients}件`, `記録 ${c.records}件(入金確認済み ${c.confirmed}件)`, `記録の合計 ${U.man(c.total)}(${U.yen(c.total)}円)`],
          report: res.report,
          replaceText: '副業の依頼元・記録・予定は、読み込む内容に置き換わります。',
          reason: '旧・副業管理アプリの読み込み',
          navigateTo: 'sidejob',
          data: res.data,
        });
        return null;
      },
    });
  }

  function inventoryLegacyFlow(initial) {
    pasteSheet({
      title: '旧・ポケカ管理アプリのバックアップ',
      placeholder: 'LZ:… または 英数字の長いテキスト',
      initial,
      onNext: async (textValue) => {
        const b = await readLegacyBackup(textValue, 'inventory');
        if (!b.ok) return b;
        const obj = b.obj;
        if (!obj || typeof obj !== 'object' || Array.isArray(obj) || !obj.inventory || typeof obj.inventory !== 'object' || Array.isArray(obj.inventory)) {
          return '在庫(inventory)が見つかりませんでした。旧・ポケカ管理アプリのバックアップか確認してください。';
        }
        let res;
        try {
          res = MT.inventoryLegacy.convert(obj, store.get());
        } catch (e) {
          return '変換中に問題が起きました。バックアップの中身を確認してください。';
        }
        const c = res.report.counts;
        legacyConfirm({
          title: '読み込む内容の確認(ポケカ在庫)',
          lines: [`商品 ${c.items}件`, `相場の記録 ${c.prices}件`, `売却の記録 ${c.sales}件`],
          report: res.report,
          replaceText: '在庫の商品は、読み込む内容に置き換わります(反映先の設定は残ります)。',
          reason: '旧・ポケカ管理アプリの読み込み',
          navigateTo: 'inventory',
          data: res.data,
        });
        return null;
      },
    });
  }

  // ---- 元に戻す・全削除 ----

  async function restoreFlow() {
    const info = store.getBackupInfo();
    if (!info) return;
    const ok = await confirmDialog({
      title: '直前のデータに戻しますか?',
      message: [...info.summary, '今のデータと入れ替わります。もう一度押すと元に戻せます。'],
      okLabel: '戻す',
    });
    if (!ok) return;
    const r = store.restoreBackup();
    if (r.ok) toast('直前のデータに戻しました');
    else toast(r.error, { type: 'error' });
  }

  async function clearFlow() {
    const ok = await confirmDialog({
      title: 'すべてのデータを削除しますか?',
      message: ['項目・金額・メモがすべて消えます。', '削除の直前のデータは「直前のデータに戻す」で 1 回だけ戻せます。心配なら先に書き出してください。'],
      okLabel: '削除する',
      danger: true,
    });
    if (!ok) return;
    if (store.replaceAll(store.createEmpty(), 'すべて削除')) toast('すべてのデータを削除しました');
  }

  MT.views = MT.views || {};
  MT.views.settings = { render, tab: 'more' };
  MT.settingsView = { loadSampleFlow, exportFlow };
})(window);
