/*
 * 設定:データの書き出し・読み込み、サンプル、元に戻す、全削除
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
      h('header', { class: 'page-head' }, h('h1', { class: 'page-title', text: '設定' })),

      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card-title', text: 'バックアップ' }),
        h('p', { text: 'すべてのデータを JSON ファイルに書き出したり、書き出したファイルから読み込んだりできます。機種変更や、もしものときに備えて、ときどき書き出しておくと安心です。' }),
        h(
          'div',
          { class: 'button-col' },
          btn('JSON ファイルに書き出す', { icon: 'download', variant: 'primary', onClick: exportFlow }),
          btn('JSON ファイルを読み込む', { icon: 'upload', onClick: () => fileInput.click() })
        ),
        fileInput,
        h('p', { class: 'hint', text: lastExport ? `この端末で最後に書き出した日時:${formatDateTime(lastExport)}` : 'この端末ではまだ書き出していません。' })
      ),

      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card-title', text: 'サンプルデータ' }),
        h('p', { text: '架空の項目と 6 か月分の金額、支払い管理の例を読み込んで、動きを試せます。今のデータは上書きされます。' }),
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
          infoRow('データ形式', `schemaVersion ${d.schemaVersion}`)
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

      h(
        'section',
        { class: 'card card-danger' },
        h('h2', { class: 'card-title', text: 'すべてのデータを削除' }),
        h('p', { text: 'この端末に保存しているマネートラッカーのデータを消して、最初の状態に戻します。' }),
        h('div', { class: 'button-col' }, btn('すべて削除する', { variant: 'danger', onClick: clearFlow }))
      ),

      h('p', { class: 'app-version', text: 'マネートラッカー 段階2(支払い管理)' })
    );
  }

  function infoRow(label, value) {
    return [h('dt', { text: label }), h('dd', { text: value })];
  }

  // ---- 書き出し ----

  function exportFlow() {
    const json = store.exportJSON();
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
    const ok = await confirmDialog({
      title: 'データを読み込みますか?',
      message: [
        `ファイル:${file.name}`,
        ...store.summarize(res.data),
        exportedAt ? `書き出した日時:${formatDateTime(exportedAt)}` : null,
        '今のデータはすべて上書きされます。(上書き前のデータは「直前のデータに戻す」で戻せます)',
      ].filter(Boolean),
      okLabel: '上書きして読み込む',
      danger: true,
    });
    if (!ok) return;
    if (store.replaceAll(res.data, 'ファイルの読み込み')) toast('読み込みました');
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

  // ---- 旧・支払い管理アプリの取り込み ----

  function legacyImportFlow() {
    const s = openSheet({
      title: '旧アプリのバックアップを読み込む',
      description: 'バックアップの JSON テキストを貼り付けるか、ファイルを選んでください。',
      className: 'sheet-form',
    });
    const ta = h('textarea', {
      class: 'field-textarea paste-area',
      rows: 6,
      placeholder: '{"accounts":[…],"payments":[…], …}',
      'aria-label': 'バックアップのテキスト',
      autocomplete: 'off',
      autocapitalize: 'off',
      spellcheck: 'false',
    });
    const file = h('input', { type: 'file', accept: 'application/json,.json,.txt,text/plain', class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true' });
    const err = h('p', { class: 'field-error', role: 'alert', hidden: true });
    file.addEventListener('change', async () => {
      const f = file.files && file.files[0];
      file.value = '';
      if (f) ta.value = await f.text();
    });
    s.body.append(
      ta,
      h('div', { class: 'button-row' }, btn('ファイルを選ぶ', { icon: 'upload', size: 'small', onClick: () => file.click() })),
      file,
      err,
      h('p', { class: 'form-hint', text: '次の画面で変換結果を確認してから読み込みます。データはこの端末の中だけで変換され、どこにも送信されません。' })
    );
    s.foot.append(
      btn('キャンセル', { onClick: () => s.close() }),
      btn('変換して確認', {
        variant: 'primary',
        onClick: () => {
          const r = MT.paymentsLegacy.parse(ta.value);
          if (!r.ok) {
            err.textContent = r.error;
            err.hidden = false;
            return;
          }
          let res;
          try {
            res = MT.paymentsLegacy.convert(r.obj, store.get());
          } catch (e) {
            err.textContent = '変換中に問題が起きました。バックアップの中身を確認してください。';
            err.hidden = false;
            return;
          }
          s.close();
          showLegacyReport(res);
        },
      })
    );
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
  MT.views.settings = { render };
  MT.settingsView = { loadSampleFlow };
})(window);
