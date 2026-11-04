/*
 * 月末チェック(#/monthend):月末の入力を忘れにくくするためのチェックリスト(新しいデータは持たない)
 *   月末記録 → 支払い → 資産(価格の更新)→ ポケカ在庫(相場)→ 副業の入金確認 → バックアップ
 * 各項目に最終更新日を並べ、古いもの・未入力を目立たせる。「確認した」は今月の分だけ端末に記録する。
 * 起動時に、前月の月末記録が未入力・未確認のとき(とバックアップが 30 日以上前のとき)は、下に案内を出す(1 日 1 回)。
 */
(function (root) {
  'use strict';
  const MT = root.MT;
  const U = MT.util;
  const ME = MT.monthEndModel;
  const store = MT.store;
  const { h, icon, btn } = MT.ui;

  const STATE = {
    ok: { cls: 'is-ok', label: 'OK' },
    warn: { cls: 'is-tight', label: '要確認' },
    alert: { cls: 'is-short', label: '未入力' },
    none: { cls: 'is-none', label: '対象なし' },
  };

  const ageText = (x) => {
    if (!x.last) return '最終更新:まだありません';
    const d = U.shortDate(x.last);
    return `最終更新:${d}(${x.days === 0 ? '今日' : `${x.days}日前`})`;
  };

  function render(container) {
    const d = store.get();
    const list = ME.items(d);
    const done = ME.doneMap();
    const target = list.filter((x) => x.state !== 'none');
    const doneCount = target.filter((x) => done[x.id]).length;
    const need = target.filter((x) => x.state === 'warn' || x.state === 'alert').length;

    container.append(
      h(
        'header',
        { class: 'page-head' },
        h('a', { class: 'back-link', href: '#/more' }, icon('back'), h('span', { text: 'その他' })),
        h('h1', { class: 'page-title page-title-sub', text: '月末チェック' })
      ),
      h(
        'section',
        { class: 'card' },
        h('p', { text: '月末に、上から順に確かめます。終わったら左の丸を押して「確認した」にします(今月の分だけ、この端末に記録します)。' }),
        h(
          'div',
          { class: 'stat-grid' },
          h('div', { class: 'stat' }, h('span', { class: 'stat-label', text: `${U.ymLabel(U.currentYM())}の確認` }), h('span', { class: 'stat-value' }, `${doneCount} / ${target.length}`, h('small', { text: '件' }))),
          h('div', { class: `stat${need ? ' tone-neg' : ' tone-pos'}` }, h('span', { class: 'stat-label', text: '要確認・未入力' }), h('span', { class: 'stat-value' }, String(need), h('small', { text: '件' })))
        )
      ),
      h(
        'section',
        { class: 'card card-flush' },
        h(
          'ol',
          { class: 'pay-list me-list' },
          list.map((x, i) => {
            const st = STATE[x.state];
            const isDone = !!done[x.id];
            const stale = x.state === 'warn' || x.state === 'alert';
            return h(
              'li',
              { class: `pay-row me-row${x.state === 'none' ? ' is-none' : ''}${isDone ? ' is-done' : ''}` },
              x.state === 'none'
                ? h('span', { class: 'me-num', text: String(i + 1) })
                : h(
                    'button',
                    {
                      type: 'button',
                      class: `round-check${isDone ? ' is-on' : ''}`,
                      role: 'checkbox',
                      'aria-checked': String(isDone),
                      'aria-label': `「${x.label}」を確認した`,
                      onClick: () => {
                        ME.setDone(x.id, !isDone);
                        MT.app.rerender();
                      },
                    },
                    icon('check')
                  ),
              h(
                'div',
                { class: 'me-main' },
                h('span', { class: 'pay-name' }, `${i + 1}. ${x.label}`, h('span', { class: `status-pill ${st.cls}`, text: st.label })),
                h('span', { class: `me-detail${stale ? (x.state === 'alert' ? ' is-neg' : ' is-warn-num') : ''}`, text: x.detail }),
                h('span', { class: `me-date${x.state !== 'none' && (x.days === null || x.days > ME.STALE_DAYS) ? ' is-old' : ''}`, text: ageText(x) }),
                x.state === 'none'
                  ? null
                  : h(
                      'div',
                      { class: 'button-row me-actions' },
                      x.id === 'backup'
                        ? btn('バックアップする', { size: 'small', icon: 'download', variant: stale ? 'primary' : undefined, onClick: () => MT.settingsView.exportFlow() })
                        : btn('開く', { size: 'small', onClick: () => MT.app.navigate(x.path) })
                    )
              )
            );
          })
        )
      ),
      h('p', { class: 'hint page-hint', text: `「最終更新」が ${ME.STALE_DAYS}日より前のもの、まだ無いものは黄色で出します。バックアップは ${ME.BACKUP_DAYS}日以上たつと案内を出します。` })
    );
  }

  /** 起動時の案内(1 日 1 回。「あとで」で閉じる) */
  function maybePrompt() {
    const d = store.get();
    if (store.isReadOnly && store.isReadOnly()) return;
    const reasons = ME.promptReasons(d);
    if (!reasons.length) return;
    const today = U.todayStr();
    if (U.prefs.get('monthEndPromptDay', null) === today) return;
    U.prefs.set('monthEndPromptDay', today);
    let rootEl = root.document.getElementById('toast-root');
    if (!rootEl) return;
    const close = h('button', { type: 'button', class: 'toast-close', text: 'あとで' });
    const go = h('button', { type: 'button', class: 'toast-action', text: '月末チェック' });
    const el = h(
      'div',
      { class: 'toast toast-update toast-monthend', role: 'status' },
      h('span', { class: 'toast-update-text' }, h('strong', { text: '月末の入力の確認' }), reasons.map((r) => h('small', { text: r }))),
      go,
      close
    );
    go.addEventListener('click', () => {
      el.remove();
      MT.app.navigate('monthend');
    });
    close.addEventListener('click', () => el.remove());
    rootEl.append(el);
  }

  /** 「その他」に出す件数(要確認・未入力) */
  function needCount() {
    return ME.items(store.get()).filter((x) => x.state === 'warn' || x.state === 'alert').length;
  }

  MT.views = MT.views || {};
  MT.views.monthend = { render, tab: 'more' };
  MT.monthEnd = { maybePrompt, needCount };
})(window);
