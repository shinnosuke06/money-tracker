/*
 * Excel の過去記録の取り込み:画面(設定から開くダイアログ)
 *   1. 表の入力:貼り付け(タブ区切り・カンマ区切り)か、CSV ファイル(UTF-8 / Shift_JIS)
 *   2. 確認:最初の月列の年月、月の列のオン/オフ、行の扱い(取り込む/参考行/取り込まない)・区分・反映先、
 *           月ごとの合計と元の表の合計との差、すでに記録がある月の扱い、今のデータの書き出し
 *   3. 取り込み(設定の「直前の取り込みを元に戻す」で取り消せる)
 */
(function (root) {
  'use strict';
  const MT = root.MT;
  const U = MT.util;
  const T = MT.importTable;
  const IM = MT.importsModel;
  const MM = MT.monthlyModel;
  const P = MT.paymentsModel;
  const store = MT.store;
  const { h, btn, openSheet, confirmDialog, promptDialog, toast } = MT.ui;
  const { selectEl, segmented, ymPicker, field, errorLine } = MT.forms;

  const yen = (v) => `${U.yen(v)}円`;
  const tag = (text) => h('span', { class: 'imp-tag', text });

  function formatDateTime(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // 「例の表を入れる」で入れる架空の表(README の例と同じ)
  const tsv = (rows) => rows.map((r) => r.join('\t')).join('\n');
  const EXAMPLES = {
    monthly: tsv([
      ['口座', '2025年', '', '', '2026年', '', '', ''],
      ['', '10月', '11月', '12月', '1月', '2月', '#####', '年間平均'],
      ['架空銀行A 普通', '412,000', '398,500', '455,300', '430,800', '468,200', '', '432,960'],
      ['架空信用金庫 定期', '1,000,000', '1,000,000', '1,000,000', '1,000,000', '1,000,000', '', '1,000,000'],
      ['証券X 特定口座', '820,000', '845,300', '801,200', '868,900', '902,400', '', '847,560'],
      ['証券X NISA', '560,000', '598,200', '617,500', '664,300', '702,800', '', '628,560'],
      ['サークルの預かり金', '36,000', '48,000', '12,000', '24,000', '-', '', '30,000'],
      ['合計', '2,828,000', '2,890,000', '2,886,000', '2,988,000', '3,073,400', '', '2,933,080'],
      ['前月比', '-', '62,000', '△4,000', '102,000', '85,400', '', ''],
      ['含み益', '210,000', '(12,000)', '198,000', '250,300', '301,000', '', ''],
    ]),
    cards: tsv([
      ['カード', '2025年', '', '', '2026年'],
      ['', '10月', '11月', '12月', '1月'],
      ['カードA', '52,300', '48,900', '61,200', '45,800'],
      ['カードB', '12,400', '9,800', '15,600', '11,200'],
      ['カードC(家族)', '-', '3,200', '0', '4,500'],
      ['架空銀行A 合計', '64,700', '58,700', '76,800', '57,000'],
      ['架空銀行B 合計', '-', '3,200', '0', '4,500'],
      ['総合計', '64,700', '61,900', '76,800', '61,500'],
      ['前月比', '-', '△2,800', '14,900', '△15,300'],
    ]),
  };

  // ---------------------------------------------------------------
  // 1. 表の入力
  // ---------------------------------------------------------------

  function open(kind) {
    const isCards = kind === 'cards';
    const s = openSheet({
      title: isCards ? 'カード推移の表を取り込む' : '月末記録の表を取り込む',
      description: isCards
        ? '1列目がカード名、2列目以降が月ごとの引き落とし額の表です。支払い管理の月別履歴(支払いの明細)に入れます。'
        : '1列目が項目名(口座など)、2列目以降が月ごとの金額の表です。月末記録に入れます。',
      className: 'sheet-form',
    });
    const err = errorLine();
    const ta = h('textarea', {
      class: 'field-textarea paste-area',
      rows: 7,
      wrap: 'off', // 表の行が折り返されないように
      placeholder: 'Excel で表の範囲を選んでコピーし、ここに貼り付けます',
      'aria-label': '取り込む表',
      autocomplete: 'off',
      autocapitalize: 'off',
      spellcheck: 'false',
    });
    const file = h('input', { type: 'file', accept: '.csv,text/csv,.txt,text/plain', class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true' });
    const enc = selectEl(
      [
        { value: 'auto', label: '文字コード:自動' },
        { value: 'utf-8', label: 'UTF-8' },
        { value: 'shift_jis', label: 'Shift_JIS' },
      ],
      'auto',
      { class: 'field-select field-sm imp-enc', 'aria-label': 'CSV ファイルの文字コード' }
    );
    const info = h('p', { class: 'form-hint', 'aria-live': 'polite' });
    let bytes = null;
    let fileName = '';
    let source = 'paste';

    function decode() {
      const r = T.decodeBytes(bytes, enc.value);
      if (!r.ok) return err.show(r.error);
      err.hide();
      ta.value = r.text;
      info.textContent = `ファイル「${fileName}」を ${r.encoding === 'shift_jis' ? 'Shift_JIS' : 'UTF-8'} として読みました。文字が化けているときは、文字コードを選び直してください。`;
    }
    file.addEventListener('change', async () => {
      const f = file.files && file.files[0];
      file.value = '';
      if (!f) return;
      bytes = new Uint8Array(await f.arrayBuffer());
      fileName = f.name;
      source = 'file';
      decode();
    });
    enc.addEventListener('change', () => {
      if (bytes) decode();
    });
    ta.addEventListener('input', () => {
      if (source !== 'file') return;
      source = 'paste';
      fileName = '';
      bytes = null;
      info.textContent = '';
    });

    s.body.append(
      field('表(貼り付け)', ta, 'Excel からのコピー(タブ区切り)と、カンマ区切りのどちらも読めます。'),
      h(
        'div',
        { class: 'button-row' },
        btn('CSV ファイルを選ぶ', { icon: 'upload', size: 'small', onClick: () => file.click() }),
        enc,
        btn('例の表を入れる', {
          size: 'small',
          variant: 'ghost',
          onClick: () => {
            ta.value = EXAMPLES[kind];
            source = 'paste';
            fileName = '';
            bytes = null;
            info.textContent = '架空の例です。このまま「確認へ」で流れを試せます。';
          },
        })
      ),
      file,
      info,
      err.el,
      h('p', { class: 'form-hint', text: '次の画面で、最初の月列の年月・行の行き先・月ごとの合計を確認してから取り込みます。表はこの端末の中だけで読み取ります。' })
    );
    s.foot.append(
      btn('キャンセル', { onClick: () => s.close() }),
      btn('確認へ', {
        variant: 'primary',
        onClick: () => {
          const t = T.analyze(ta.value);
          if (!t.ok) return err.show(t.error, ta);
          s.close();
          openPreview(kind, t, { source, fileName });
        },
      })
    );
  }

  // ---------------------------------------------------------------
  // 2. 確認(プレビュー)
  // ---------------------------------------------------------------

  function openPreview(kind, table, meta) {
    const isCards = kind === 'cards';
    const choices = isCards ? IM.cardDefaults(store.get(), table) : IM.monthlyDefaults(store.get(), table);
    const build = () => (isCards ? IM.buildCardPlan(store.get(), table, choices) : IM.buildMonthlyPlan(store.get(), table, choices));
    const count = (plan) => (isCards ? IM.countCardWrites(store.get(), plan, choices.modes) : IM.countMonthlyWrites(store.get(), plan, choices.modes));
    let plan = build();

    const s = openSheet({ title: `${IM.KINDS[kind]}:取り込む内容の確認`, className: 'sheet-form sheet-wide' });
    const summaryEl = h('p', { class: 'imp-summary', 'aria-live': 'polite' });

    // 最初の月列の年月
    const ym = ymPicker(choices.startYM, { allowNone: false, from: U.ymAdd(U.currentYM(), -12 * 20), years: 21, label: '最初の月列の年月' });
    ym.el.addEventListener('change', () => {
      choices.startYM = ym.value();
      refresh();
    });

    // 月の列
    const cols = table.columns.map((c, j) => {
      const box = h('input', { type: 'checkbox', checked: choices.cols[j].on, 'aria-label': `${j + 1}列目を取り込む` });
      const monthEl = h('span', { class: 'imp-col-month' });
      const label = h(
        'label',
        { class: 'imp-col' },
        box,
        h(
          'span',
          { class: 'imp-col-text' },
          monthEl,
          h('span', { class: 'imp-col-head', text: `見出し:${c.header || '(なし)'}` }),
          c.summary || c.blank ? h('span', { class: 'imp-tags' }, c.summary ? tag('合計などの列') : null, c.blank ? tag('全部空欄') : null) : null
        )
      );
      box.addEventListener('change', () => {
        choices.cols[j].on = box.checked;
        refresh();
      });
      return { li: h('li', null, label), label, monthEl, box };
    });

    // 行
    const catOptions = isCards ? P.CATEGORIES.map((c) => ({ value: c.id, label: c.label })) : plan.categories.map((c) => ({ value: c.id, label: c.name }));
    const targetOptions = isCards
      ? []
      : [{ value: 'new', label: '新しい項目として追加' }].concat(
          MM.groups(store.get().monthly).flatMap((g) => g.items.map((it) => ({ value: it.id, label: `${g.category.name} / ${it.name}${it.reference ? '(参考行)' : ''}` })))
        );
    const statusOptions = isCards
      ? [
          { value: 'import', label: '取り込む' },
          { value: 'skip', label: '取り込まない' },
        ]
      : [
          { value: 'import', label: '取り込む' },
          { value: 'reference', label: '参考行(合計に含めない)' },
          { value: 'skip', label: '取り込まない' },
        ];
    // まとめ(証券会社など)の選択肢:推測したもの・今あるもの・「新しいまとめ」
    const groupNames = [];
    const addGroupName = (n) => {
      if (n && !groupNames.includes(n)) groupNames.push(n);
    };
    if (!isCards) {
      choices.rows.forEach((c) => addGroupName(c.group));
      MM.groupNames(store.get().monthly).forEach(addGroupName);
    }
    const NEW_GROUP = '__new__';
    const groupOptions = () => [{ value: '', label: 'まとめなし' }]
      .concat(groupNames.map((n) => ({ value: n, label: `まとめ:${n}` })))
      .concat([{ value: NEW_GROUP, label: '新しいまとめを作る…' }]);
    const fillGroupSelect = (sel, value) => {
      sel.replaceChildren(...groupOptions().map((o) => h('option', { value: o.value, text: o.label })));
      sel.value = value;
    };

    const rows = table.rows.map((r, i) => {
      const ch = choices.rows[i];
      const status = selectEl(statusOptions, ch.status, { class: 'field-select field-sm', 'aria-label': `${r.name}の扱い` });
      const cat = selectEl(catOptions, isCards ? ch.category : ch.categoryId, { class: 'field-select field-sm', 'aria-label': `${r.name}の${isCards ? 'カテゴリ' : '区分'}` });
      const target = isCards ? null : selectEl(targetOptions, ch.target, { class: 'field-select field-sm', 'aria-label': `${r.name}の反映先` });
      const group = isCards ? null : h('select', { class: 'field-select field-sm', 'aria-label': `${r.name}のまとめ(証券会社など)` });
      if (group) {
        fillGroupSelect(group, ch.group || '');
        group.addEventListener('change', async () => {
          if (group.value !== NEW_GROUP) {
            ch.group = group.value;
            refresh();
            return;
          }
          const name = await promptDialog({
            title: '新しいまとめ',
            label: 'まとめの名前',
            placeholder: '例:証券A',
            hint: '同じまとめの行は、月末記録の表でまとめの小計の下に内訳として並びます。',
            okLabel: '決定',
            maxLength: MM.NAME_MAX,
          });
          if (name) {
            const n = name.replace(/\s+/g, ' ').trim().slice(0, MM.NAME_MAX);
            addGroupName(n);
            ch.group = n;
          }
          // 選択肢を全部の行で作り直す(キャンセルなら元の選択に戻る)
          rows.forEach((v, j) => fillGroupSelect(v.group, choices.rows[j].group || ''));
          refresh();
        });
      }
      const metaEl = h('span', { class: 'imp-row-meta' });
      const note = h('p', { class: 'form-hint' });
      status.addEventListener('change', () => {
        ch.status = status.value;
        refresh();
      });
      cat.addEventListener('change', () => {
        if (isCards) ch.category = cat.value;
        else ch.categoryId = cat.value;
        refresh();
      });
      if (target) {
        target.addEventListener('change', () => {
          ch.target = target.value;
          const it = MM.findItem(store.get().monthly, ch.target);
          if (it) ch.categoryId = it.categoryId;
          refresh();
        });
      }
      const li = h(
        'li',
        { class: 'imp-row' },
        h('div', { class: 'imp-row-head' }, h('span', { class: 'imp-row-name', text: r.name }), metaEl),
        h('div', { class: `imp-row-ctrl${isCards ? ' is-cards' : ' has-group'}` }, status, cat, target, group),
        note
      );
      return { li, status, cat, target, group, metaEl, note };
    });

    const checksBox = h('ul', { class: 'imp-list' });
    const doublesBox = h('div', { 'aria-live': 'polite' });
    const conflictTitle = h('h3', { class: 'form-section-title' });
    const conflictBox = h('div', { class: 'map-list' });
    const setAll = (mode) => () => {
      for (const c of plan.conflicts) choices.modes[c.month] = mode;
      refresh();
    };
    const conflictSec = h(
      'section',
      { class: 'form-section' },
      conflictTitle,
      h('p', { class: 'form-hint', text: '上書き:表の値で置き換えます(表が空欄の所は今の値のまま)。スキップ:この月は取り込みません。空欄だけ補う:まだ値の無い所だけ入れます。' }),
      h('div', { class: 'button-row' }, IM.MODES.map((m) => btn(`すべて${m.label}`, { size: 'small', onClick: setAll(m.id) }))),
      conflictBox
    );
    const errBox = h('div', { role: 'alert' });
    const submit = btn('取り込む', { variant: 'primary', onClick: () => doImport() });

    s.body.append(
      summaryEl,
      h(
        'section',
        { class: 'form-section' },
        field('最初の月列の年月', ym.el, '見出しの月名は使いません。この年月から右へ 1 列ごとに 1 か月ずつ進めます(「合計」などの列は、オンにしたときだけ数えます)。'),
        h('h3', { class: 'form-section-title', text: `月の列(${table.columns.length}列)` }),
        h('p', { class: 'form-hint', text: 'チェックを外した列は取り込みません。「合計」「年間」「平均」の列と、全部空欄の列は、最初は外してあります。' }),
        h('ul', { class: 'imp-list' }, cols.map((c) => c.li)),
        table.ignoredCols.length ? h('p', { class: 'form-hint', text: `記号(●など)だけの列 ${table.ignoredCols.length}列は無視しました。` }) : null
      ),
      h(
        'section',
        { class: 'form-section' },
        h('h3', { class: 'form-section-title', text: `行(${table.rows.length}行)` }),
        h(
          'p',
          { class: 'form-hint' },
          isCards
            ? '名前に「合計」「総合計」「前月比」「月平均」を含む行は、最初は「取り込まない」にしています。カテゴリは行ごとに選べます(最初は変動費)。'
            : '名前に「合計」「総資産」「前月比」「月平均」を含む行は「取り込まない」、合計の行より下の行と「含み益」は「参考行」にしています。参考行は記録しますが、小計・総資産には含めません。「証券A(国内株式)」のように括弧の前が同じ行は、同じ「まとめ」にしています(表でまとめの小計の下に内訳として並びます)。'
        ),
        h('ul', { class: 'imp-list' }, rows.map((r) => r.li)),
        table.issues.length ? h('ul', { class: 'report-list is-issue' }, table.issues.map((t) => h('li', { text: t }))) : null
      ),
      h(
        'section',
        { class: 'form-section' },
        h('h3', { class: 'form-section-title', text: isCards ? '月ごとの合計(取り込む行だけで計算)' : '月ごとの区分小計と総資産(取り込む行だけで計算)' }),
        isCards && plan.refRows.length ? h('p', { class: 'form-hint', text: '「合計」を含む引き落とし口座別の行は、参照用に表示しています(取り込みません)。' }) : null,
        doublesBox,
        checksBox
      ),
      conflictSec,
      h(
        'section',
        { class: 'form-section' },
        h('h3', { class: 'form-section-title', text: '取り込む前に' }),
        h('p', { class: 'form-hint', text: '念のため、今のデータを JSON ファイルに書き出しておけます。取り込んだあとは、設定の「直前の取り込みを元に戻す」でも取り消せます。' }),
        h('div', { class: 'button-row' }, btn('今のデータを JSON に書き出す', { icon: 'download', size: 'small', onClick: () => MT.settingsView.exportFlow() }))
      ),
      errBox
    );
    s.foot.append(btn('キャンセル', { onClick: () => s.close() }), submit);

    function refresh() {
      plan = build();
      const w = count(plan);
      // 列
      plan.columns.forEach((c, j) => {
        const v = cols[j];
        v.monthEl.textContent = c.month ? `${U.ymLabel(c.month)}${c.on ? '' : '(取り込まない)'}` : '月として数えない';
        v.label.classList.toggle('is-off', !c.imported);
      });
      // 行
      plan.rows.forEach((r, i) => {
        const v = rows[i];
        const skip = r.status === 'skip';
        v.li.classList.toggle('is-skip', skip);
        v.metaEl.textContent = `${r.line}行目・値 ${r.cellCount}件${r.bad.length ? `・読めない値 ${r.bad.length}件` : ''}`;
        v.cat.disabled = skip || (!isCards && r.target !== 'new');
        if (!isCards) {
          v.cat.value = r.categoryId;
          v.target.disabled = skip;
          v.target.value = r.target;
          v.group.disabled = r.status !== 'import';
          v.group.value = r.group;
        }
        v.note.textContent = rowNote(r);
      });
      drawChecks();
      drawConflicts();
      // まとめ・エラー・ボタン
      const months = plan.imported.map((c) => c.month);
      summaryEl.textContent = months.length
        ? `取り込む月:${U.ymLabel(months[0])}〜${U.ymLabel(months[months.length - 1])}(${months.length}か月)・取り込む行 ${plan.active.length}行・書き込む金額 ${w.cells}件`
        : '取り込む月がありません。';
      const msgs = [...plan.errors];
      if (!msgs.length && !w.cells) msgs.push('この選択では、書き込む金額がありません(すべてスキップか、空欄だけ補う所が無い)。');
      errBox.replaceChildren(...msgs.map((t) => h('p', { class: 'field-error', text: t })));
      submit.disabled = msgs.length > 0;
      submit.querySelector('span').textContent = w.cells ? `${w.cells}件を取り込む` : '取り込む';
    }

    function rowNote(r) {
      if (r.status === 'skip') return '取り込みません。';
      if (isCards) return `支払いの明細「${r.name}」(${P.categoryLabel(r.category)})として入れます。`;
      const inGroup = r.status === 'import' && r.group ? `まとめ「${r.group}」の内訳にします。` : '';
      if (r.target === 'new') return `新しい項目「${r.name}」を${r.status === 'reference' ? '参考行として' : ''}追加します。${inGroup}`;
      const flag = r.flagChange ? (r.status === 'reference' ? 'この項目を参考行にします。' : 'この項目を小計・総資産に含めます。') : '';
      const groupNote = r.groupChange ? (r.group ? `まとめを「${r.group}」にします。` : 'まとめから外します。') : '';
      return `今の項目「${r.item.name}」に書き込みます(区分はそのまま)。${flag}${groupNote}`;
    }

    function drawChecks() {
      checksBox.replaceChildren();
      // 二重に数えそうな項目(今の「証券A」と、取り込む内訳の「証券A(国内株式)」など)
      const doubles = isCards ? [] : plan.doubles;
      doublesBox.replaceChildren(
        ...(doubles.length
          ? [
              h(
                'div',
                { class: 'notice notice-warn' },
                h(
                  'div',
                  { class: 'notice-main' },
                  h('p', { class: 'notice-title', text: '二重に数える項目があります' }),
                  doubles.map((x) =>
                    h('p', { class: 'notice-text', text: `今の項目「${x.name}」(${x.months.length}か月分に値あり)と、取り込むまとめ「${x.name}」の内訳は同じお金です。` })
                  ),
                  h('p', { class: 'notice-text', text: '取り込んだあと「項目を編集」で今の項目を削除すると、総資産が元の表と同じになります(下の総資産は、取り込む行だけで計算しています)。' })
                )
              ),
            ]
          : [])
      );
      if (!plan.checks.length) {
        checksBox.append(h('li', { class: 'form-hint', text: '取り込む月がありません。' }));
        return;
      }
      for (const c of plan.checks) {
        let diffEl;
        if (!plan.sourceName) diffEl = h('span', { class: 'imp-diff', text: '元の表に合計の行がないため、比べていません。' });
        else if (c.source === null) diffEl = h('span', { class: 'imp-diff', text: `元の表の「${plan.sourceName}」はこの月が空欄です。` });
        else if (c.diff === 0) diffEl = h('span', { class: 'imp-diff is-ok', text: `元の表の「${plan.sourceName}」と一致(✓)` });
        else diffEl = h('span', { class: 'imp-diff is-off', text: `元の表の「${plan.sourceName}」${yen(c.source)}と、差 ${U.yenSigned(c.diff)}円` });
        const sub = isCards
          ? c.refs.length
            ? c.refs.map((x) => `${x.name} ${x.value === null ? '—' : U.yen(x.value)}`).join(' / ')
            : null
          : plan.categories.map((cat) => `${cat.name} ${U.yen(c.byCategory.get(cat.id) || 0)}`).join(' / ') + (c.reference ? ` / 参考行 ${U.yen(c.reference)}` : '');
        checksBox.append(
          h(
            'li',
            { class: 'imp-month' },
            h('div', { class: 'imp-month-head' }, h('span', { text: U.ymLabel(c.month) }), h('span', { text: `${isCards ? '合計' : '総資産'} ${yen(c.total)}` })),
            sub ? h('div', { class: 'imp-month-sub', text: sub }) : null,
            diffEl
          )
        );
      }
    }

    function drawConflicts() {
      conflictSec.hidden = !plan.conflicts.length;
      conflictBox.replaceChildren();
      if (!plan.conflicts.length) return;
      conflictTitle.textContent = `すでに記録がある月(${plan.conflicts.length}か月)`;
      for (const c of plan.conflicts) {
        const seg = segmented(
          IM.MODES.map((m) => ({ value: m.id, label: m.label })),
          IM.modeFor(plan.conflicts, choices.modes, c.month),
          {
            label: `${U.ymLabel(c.month)}の扱い`,
            onChange: (v) => {
              choices.modes[c.month] = v;
              refresh();
            },
          }
        );
        conflictBox.append(h('div', { class: 'map-row' }, h('span', { class: 'map-label', text: `${U.ymLabel(c.month)}:今 ${c.filled}件の${isCards ? '明細' : '値'}があります` }), seg.el));
      }
    }

    async function doImport() {
      plan = build();
      const w = count(plan);
      if (plan.errors.length || !w.cells) return;
      const modeCount = {};
      for (const c of plan.conflicts) {
        const m = IM.modeFor(plan.conflicts, choices.modes, c.month);
        modeCount[m] = (modeCount[m] || 0) + 1;
      }
      const modeText = IM.MODES.filter((m) => modeCount[m.id]).map((m) => `${m.label} ${modeCount[m.id]}か月`).join('・');
      const ok = await confirmDialog({
        title: '取り込みますか?',
        message: [
          `${w.months.length}か月・${w.cells}件の金額を${isCards ? '支払い管理の月別履歴' : '月末記録'}に書き込みます。`,
          !isCards && w.newItems ? `新しい項目を ${w.newItems}件 追加します。` : null,
          modeText ? `すでに記録がある月:${modeText}` : null,
          '取り込みは、設定の「直前の取り込みを元に戻す」で取り消せます。',
        ],
        okLabel: '取り込む',
      });
      if (!ok) return;
      const opts = { today: U.todayStr(), now: new Date(), source: meta.source, fileName: meta.fileName };
      let res = null;
      const done = store.update(
        (d) => {
          res = isCards ? IM.applyCardImport(d, table, choices, opts) : IM.applyMonthlyImport(d, table, choices, opts);
        },
        { backup: `Excel の取り込み(${IM.KINDS[kind]})の前` }
      );
      if (!done || !res) return;
      if (!res.ok) {
        toast(res.error, { type: 'error', duration: 5000 });
        return;
      }
      s.close();
      toast(`${res.months.length}か月・${res.cells}件を取り込みました`);
      MT.app.navigate(isCards ? 'payments/history' : 'monthly');
    }

    refresh();
  }

  // ---------------------------------------------------------------
  // 3. 直前の取り込みを元に戻す
  // ---------------------------------------------------------------

  async function undoFlow() {
    const e = IM.undoTarget(store.get());
    if (!e) {
      toast('元に戻せる取り込みがありません');
      return;
    }
    const ok = await confirmDialog({
      title: '直前の取り込みを元に戻しますか?',
      message: [
        `${formatDateTime(e.at)} の取り込み(${IM.describe(e)})`,
        e.kind === 'cards'
          ? '取り込みで作った月の履歴を消し、書き換えた月の履歴を取り込む前に戻します。'
          : '書き込んだ金額を取り込む前の値に戻し、取り込みで追加した項目を削除します。',
        '取り込んだあとに、同じ月・項目を手で直していた場合は、その変更も戻ります。',
        '戻す直前のデータは、設定の「直前のデータに戻す」でもう一度戻せます。',
      ],
      okLabel: '元に戻す',
      danger: true,
    });
    if (!ok) return;
    let res = null;
    if (store.update((d) => (res = IM.undoLast(d)), { backup: '取り込みを元に戻す前' }) && res && res.ok) toast('直前の取り込みを元に戻しました');
  }

  MT.importsUI = { open, openPreview, undoFlow, formatDateTime, EXAMPLES };
})(window);
