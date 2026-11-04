/*
 * 将来予想:入力のダイアログ(条件の行・基本の条件・プランの操作)
 *
 * 行の入力は openFieldsSheet() の共通の形で作る。項目(fields)の種類:
 *   text / yen(円の整数)/ percent(%・小数)/ int(年齢・年数など。区切りなし)/ ym(年月)/ month(1〜12月)/ select / check
 */
(function (root) {
  'use strict';
  const MT = root.MT;
  const U = MT.util;
  const F = MT.futureModel;
  const store = MT.store;
  const { h, add, btn, openSheet, confirmDialog, promptDialog, actionSheet, toast, amountField } = MT.ui;
  const { selectEl, textInput, field, formFoot, errorLine, checkbox } = MT.forms;

  const yen = (v) => `${U.yen(v)}円`;
  const ymText = (ym, none = '期間の終わりまで') => (ym ? U.ymLabel(ym) : none);

  // ---------------------------------------------------------------
  // 共通:項目を並べた入力ダイアログ
  // ---------------------------------------------------------------

  /** 年齢・年などの整数の入力(3 桁区切りにしない) */
  function intField(value, { unit = '', placeholder = '', label = '' } = {}) {
    const input = h('input', {
      class: 'field-input int-input',
      type: 'text',
      inputmode: 'numeric',
      autocomplete: 'off',
      enterkeyhint: 'done',
      placeholder,
      'aria-label': label,
      value: value == null ? '' : String(value),
    });
    return { el: h('div', { class: 'int-field' }, input, unit ? h('span', { class: 'amount-unit', text: unit }) : null), input };
  }

  /** 項目 1 つ分の入力欄。get() で { ok, value, error } を返す */
  function control(f, v, plan) {
    const need = (msg) => ({ ok: false, error: msg || `「${f.label}」を入れてください` });
    switch (f.type) {
      case 'text': {
        const el = textInput(v, { maxlength: f.max || F.NAME_MAX, placeholder: f.placeholder || '', 'aria-label': f.label });
        return { el, focusEl: el, get: () => (el.value.trim() || f.allowEmpty ? { ok: true, value: el.value.trim() } : need()) };
      }
      case 'yen':
      case 'percent': {
        const isPct = f.type === 'percent';
        const a = amountField({ value: v, label: f.label, compact: true, decimals: isPct ? 3 : 0, unit: f.unit != null ? f.unit : isPct ? '%' : '円', placeholder: f.placeholder });
        return {
          el: a.el,
          focusEl: a.input,
          get: () => {
            const r = a.result();
            if (!r.ok) return need(`「${f.label}」:${r.error}`);
            if (r.value === null) return f.allowEmpty ? { ok: true, value: null } : need();
            if (f.min != null && r.value < f.min) return need(`「${f.label}」は ${f.min} 以上にしてください`);
            if (f.max != null && r.value > f.max) return need(`「${f.label}」は ${f.max} 以下にしてください`);
            return { ok: true, value: r.value };
          },
        };
      }
      case 'int': {
        const x = intField(v, { unit: f.unit, placeholder: f.placeholder, label: f.label });
        return {
          el: x.el,
          focusEl: x.input,
          get: () => {
            const s = x.input.value.trim().replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
            if (s === '') return f.allowEmpty ? { ok: true, value: null } : need();
            if (!/^\d+$/.test(s)) return need(`「${f.label}」は数字で入れてください`);
            const n = Number(s);
            if ((f.min != null && n < f.min) || (f.max != null && n > f.max)) return need(`「${f.label}」は ${f.min}〜${f.max} で入れてください`);
            return { ok: true, value: n };
          },
        };
      }
      case 'ym': {
        const from = f.from || plan.startYM;
        const p = MT.forms.ymPicker(v, { allowNone: !!f.allowEmpty, from, years: f.years || plan.years + 1, label: f.label });
        if (f.noneLabel) {
          const opt = p.el.querySelector('option[value=""]');
          if (opt) opt.textContent = f.noneLabel;
        }
        return { el: p.el, get: () => (p.value() || f.allowEmpty ? { ok: true, value: p.value() } : need()) };
      }
      case 'month': {
        const sel = selectEl(Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}月` })), v || 1, { 'aria-label': f.label });
        return { el: sel, get: () => ({ ok: true, value: Number(sel.value) }) };
      }
      case 'select': {
        const sel = selectEl(f.options.map((o) => ({ value: o.id, label: o.label })), v, { 'aria-label': f.label });
        return { el: sel, get: () => ({ ok: true, value: sel.value }) };
      }
      case 'check': {
        const c = checkbox(f.checkLabel || f.label, !!v);
        return { el: c.el, get: () => ({ ok: true, value: c.input.checked }) };
      }
      default:
        throw new Error(`unknown field type ${f.type}`);
    }
  }

  /**
   * 項目を並べた入力ダイアログ。保存で onSave(値のオブジェクト) を呼ぶ(false を返すと閉じない)
   */
  function openFieldsSheet({ title, description, fields, value = {}, plan, onSave, onDelete, deleteLabel }) {
    const s = openSheet({ title, description, className: 'sheet-form' });
    const err = errorLine();
    const ctrls = fields.map((f) => ({ f, c: control(f, value[f.key], plan) }));
    add(s.body, ...ctrls.map(({ f, c }) => (f.type === 'check' ? h('div', { class: 'form-row' }, c.el, f.hint ? h('p', { class: 'form-hint', text: f.hint }) : null) : field(f.label, c.el, f.hint))), err.el);
    formFoot(s, {
      onDelete: onDelete
        ? async () => {
            const ok = await confirmDialog({ title: `「${value.name || title}」を削除しますか?`, message: [deleteLabel || 'この条件を削除します。'], okLabel: '削除する', danger: true });
            if (ok) {
              onDelete();
              s.close();
            }
          }
        : null,
      onSave: () => {
        const out = {};
        for (const { f, c } of ctrls) {
          const r = c.get();
          if (!r.ok) return err.show(r.error, c.focusEl);
          out[f.key] = r.value;
        }
        const res = onSave(out);
        if (res === false) return;
        if (typeof res === 'string') return err.show(res);
        s.close();
      },
    });
    return s;
  }

  /** プランを書き換える(store.update の中で、そのプランを渡す) */
  function updatePlan(planId, fn, okText) {
    const ok = store.update((d) => {
      const p = F.findPlan(d.future, planId);
      if (p) fn(p, d);
    });
    if (ok && okText) toast(okText);
    return ok;
  }

  // ---------------------------------------------------------------
  // 一覧の行(収入・臨時収入・返済・生活費の変化・ローン・積立・出費・毎年の費用・資産)
  // ---------------------------------------------------------------

  const priorityOptions = F.PRIORITIES;
  const taxOptions = F.TAX_KINDS;
  const yearNow = (plan) => Number(plan.startYM.slice(0, 4));

  /** 行の種類ごとの、題名・項目・新しい行の初期値 */
  function rowSpec(key, plan) {
    const age = { type: 'int', unit: '歳', min: 0, max: 120, allowEmpty: true };
    const year = { type: 'int', unit: '年', min: 1900, max: 2200 };
    switch (key) {
      case 'incomes':
        return {
          title: '収入(手取りの月額)',
          fields: [
            { key: 'name', label: '名前', type: 'text', placeholder: '例:給与・再雇用・年金' },
            { key: 'monthly', label: '手取りの月額', type: 'yen', min: 0 },
            { key: 'fromAge', label: '何歳から', ...age, hint: '空欄は「今から」。その年齢になった月から入ります' },
            { key: 'toAge', label: '何歳まで', ...age, hint: '空欄は「期間の終わりまで」。その年齢のあいだは入ります' },
          ],
          blank: { name: '', monthly: 0, fromAge: null, toAge: null },
        };
      case 'extras':
        return {
          title: '臨時収入(ボーナス・退職金など)',
          fields: [
            { key: 'name', label: '名前', type: 'text', placeholder: '例:賞与・退職金' },
            { key: 'amount', label: '金額(手取り)', type: 'yen', min: 0 },
            { key: 'year', label: '年', ...year },
            { key: 'month', label: '入る月', type: 'month' },
            { key: 'untilYear', label: '毎年なら、最後の年', type: 'int', unit: '年', min: 1900, max: 2200, allowEmpty: true, hint: '空欄は 1 回だけ。入れると、その年まで毎年同じ月に入ります' },
          ],
          blank: { name: '', amount: 0, year: yearNow(plan) + 1, month: 12, untilYear: null },
        };
      case 'repayments':
        return {
          title: '家族などからの返済',
          fields: [
            { key: 'name', label: '名前', type: 'text', placeholder: '例:家族からの返済' },
            { key: 'monthly', label: '月額', type: 'yen', min: 0 },
            { key: 'endYM', label: '終了年月(この月まで)', type: 'ym', allowEmpty: true, noneLabel: '未定(期間の終わりまで)' },
          ],
          blank: { name: '', monthly: 0, endYM: null },
        };
      case 'livingChanges':
        return {
          title: '年齢による生活費の変化',
          fields: [
            { key: 'fromAge', label: '何歳から', type: 'int', unit: '歳', min: 0, max: 120 },
            { key: 'monthly', label: '生活費(月・今の値段で)', type: 'yen', min: 0, hint: 'その年齢から、毎月の生活費がこの額になります(インフレ率はこの額に掛けます)' },
          ],
          blank: { fromAge: 65, monthly: plan.living.monthly },
          nameOf: (r) => `${r.fromAge}歳から`,
        };
      case 'loans':
        return {
          title: 'ローン',
          fields: [
            { key: 'name', label: '名前', type: 'text', placeholder: '例:住宅ローン' },
            { key: 'monthly', label: '月額', type: 'yen', min: 0 },
            { key: 'startYM', label: '開始年月', type: 'ym', allowEmpty: true, noneLabel: '今から', hint: 'これから組むローンなら入れます' },
            { key: 'endYM', label: '終了年月(この月まで払う)', type: 'ym', allowEmpty: true, noneLabel: '未定(期間の終わりまで)', hint: '終了月の翌月から支出が減ります' },
          ],
          blank: { name: '', monthly: 0, startYM: null, endYM: null },
        };
      case 'savings':
        return {
          title: '積立投資',
          fields: [
            { key: 'name', label: '名前', type: 'text', placeholder: '例:つみたて投資' },
            { key: 'monthly', label: '毎月の積立額', type: 'yen', min: 0, hint: '現金から投資へ移します(利回りの仮定で増えます)' },
            { key: 'startYM', label: '開始年月', type: 'ym', allowEmpty: true, noneLabel: '今から' },
            { key: 'endYM', label: '終了年月(この月まで)', type: 'ym', allowEmpty: true, noneLabel: '期間の終わりまで' },
            { key: 'taxKind', label: '口座区分', type: 'select', options: taxOptions },
            { key: 'priority', label: '取り崩すとき', type: 'select', options: priorityOptions },
          ],
          blank: { name: '', monthly: 0, startYM: null, endYM: null, taxKind: 'nisa', priority: 'ifNeeded' },
        };
      case 'oneTime':
        return {
          title: '大きな出費(単発)',
          fields: [
            { key: 'name', label: '名前', type: 'text', placeholder: '例:車の買い替え・家の修繕' },
            { key: 'amount', label: '金額(今の値段で)', type: 'yen', min: 0 },
            { key: 'ym', label: '年月', type: 'ym' },
            { key: 'enabled', label: '計算に入れる', type: 'check', checkLabel: '計算に入れる(オフにすると比較用に残したまま外せます)' },
          ],
          blank: { name: '', amount: 0, ym: U.ymAdd(plan.startYM, 12), enabled: true },
        };
      case 'yearly':
        return {
          title: '毎年の費用',
          fields: [
            { key: 'name', label: '名前', type: 'text', placeholder: '例:自動車税・固定資産税' },
            { key: 'amount', label: '年額(今の値段で)', type: 'yen', min: 0 },
            { key: 'month', label: '払う月', type: 'month' },
            { key: 'fromYear', label: '開始年', ...year },
            { key: 'toYear', label: '終了年', type: 'int', unit: '年', min: 1900, max: 2200, allowEmpty: true, hint: '空欄は期間の終わりまで' },
            { key: 'interval', label: '何年ごと', type: 'int', unit: '年ごと', min: 1, max: 30, hint: '車検のように 2 年ごとなら 2' },
            { key: 'enabled', label: '計算に入れる', type: 'check', checkLabel: '計算に入れる' },
          ],
          blank: { name: '', amount: 0, month: 4, fromYear: yearNow(plan), toYear: null, interval: 1, enabled: true },
        };
      case 'assets':
        return {
          title: '投資資産',
          fields: [
            { key: 'name', label: '名前', type: 'text', max: 80 },
            { key: 'value', label: '評価額', type: 'yen', min: 0 },
            { key: 'cost', label: '取得額(税金の計算用)', type: 'yen', min: 0 },
            { key: 'priority', label: '売却優先度', type: 'select', options: priorityOptions, hint: '「売りたくない」は取り崩しに使いません' },
            { key: 'taxKind', label: '税金', type: 'select', options: taxOptions },
            { key: 'grows', label: '利回りで増える', type: 'check', checkLabel: '利回りの仮定で増える(手入力の資産・ポケカ在庫は既定でオフ)' },
            { key: 'group', label: '種類', type: 'select', options: F.GROUPS },
          ],
          blank: { name: '', value: 0, cost: 0, priority: 'ifNeeded', taxKind: 'taxable', grows: true, group: 'other' },
        };
      default:
        throw new Error(key);
    }
  }

  /** 行を足す・直すダイアログ */
  function openRowSheet(planId, key, rowId = null) {
    const plan = F.findPlan(store.get().future, planId);
    if (!plan) return;
    const spec = rowSpec(key, plan);
    const row = rowId ? F.rowsOf(plan, key).find((x) => x.id === rowId) : null;
    openFieldsSheet({
      title: `${spec.title}${row ? 'を直す' : 'を追加'}`,
      fields: spec.fields,
      value: row || spec.blank,
      plan,
      onSave: (v) => {
        let saved = null;
        updatePlan(planId, (p) => (saved = F.saveRow(p, key, { ...(row || {}), ...v, id: row ? row.id : null })));
        if (!saved) return 'これ以上は追加できません';
        toast(row ? '直しました' : '追加しました');
        return true;
      },
      onDelete: row ? () => updatePlan(planId, (p) => F.removeRow(p, key, row.id), '削除しました') : null,
    });
  }

  // ---------------------------------------------------------------
  // 基本・利回り・生活防衛資金・副業・生活費・現金
  // ---------------------------------------------------------------

  function openBaseSheet(planId) {
    const plan = F.findPlan(store.get().future, planId);
    openFieldsSheet({
      title: '基本の条件',
      plan,
      fields: [
        { key: 'birthYM', label: '生年月', type: 'ym', allowEmpty: true, noneLabel: '未入力', from: U.ymAdd(plan.startYM, -12 * 100), years: 100, hint: '年齢で決まる収入・生活費の変化に使います' },
        { key: 'age', label: 'または今の年齢', type: 'int', unit: '歳', min: 0, max: 120, allowEmpty: true, hint: '入れると、生年月の代わりにこの年齢から逆算します' },
        { key: 'years', label: '予想の期間', type: 'int', unit: '年', min: 1, max: 60 },
        { key: 'inflation', label: 'インフレ率(年)', type: 'percent', min: -5, max: 20, hint: '生活費・毎年の費用・単発の出費に掛けます(入力は今の値段)。収入・ローン・積立には掛けません' },
      ],
      value: { birthYM: plan.birthYM, age: null, years: plan.years, inflation: plan.inflation },
      onSave: (v) => {
        const birthYM = v.age !== null ? F.birthFromAge(plan.startYM, v.age) : v.birthYM;
        store.update((d) => F.updatePlan(d.future, planId, { birthYM, years: v.years, inflation: v.inflation }));
        toast('基本の条件を保存しました');
      },
    });
  }

  function openReturnsSheet(planId) {
    const plan = F.findPlan(store.get().future, planId);
    openFieldsSheet({
      title: '利回りの仮定と税率',
      description: '初期値(1% / 3% / 5%)は仮の値です。手で直せます。現金の利回りは 0% です。',
      plan,
      fields: [
        { key: 'low', label: '低め(年利)', type: 'percent', min: -20, max: 30 },
        { key: 'mid', label: '普通(年利)', type: 'percent', min: -20, max: 30 },
        { key: 'high', label: '高め(年利)', type: 'percent', min: -20, max: 30 },
        { key: 'taxable', label: '課税口座の含み益の税率', type: 'percent', min: 0, max: 100, hint: '取り崩すとき、売った額のうち含み益の割合にかけます' },
        { key: 'nisa', label: 'NISA の税率', type: 'percent', min: 0, max: 100 },
      ],
      value: { ...plan.returns, ...plan.tax },
      onSave: (v) => {
        if (!(v.low <= v.mid && v.mid <= v.high)) return '低め ≦ 普通 ≦ 高め の順にしてください';
        store.update((d) => F.updatePlan(d.future, planId, { returns: { low: v.low, mid: v.mid, high: v.high }, tax: { taxable: v.taxable, nisa: v.nisa } }));
        toast('保存しました');
      },
    });
  }

  function openReserveSheet(planId) {
    const plan = F.findPlan(store.get().future, planId);
    openFieldsSheet({
      title: '生活防衛資金(現金の最低ライン)',
      description: '現金がこの額を下回る月は、投資から取り崩して補います。',
      plan,
      fields: [
        { key: 'months', label: '生活費の何か月分', type: 'percent', unit: 'か月分', min: 0, max: 60, hint: '既定は仮に 6 か月分。その月の生活費に掛けます' },
        { key: 'amount', label: 'または金額で決める', type: 'yen', min: 0, allowEmpty: true, hint: '入れると、か月分の代わりにこの額を使います(空欄で、か月分に戻ります)' },
      ],
      value: plan.reserve,
      onSave: (v) => {
        store.update((d) => F.updatePlan(d.future, planId, { reserve: { months: v.months, amount: v.amount } }));
        toast('保存しました');
      },
    });
  }

  function openSidejobSheet(planId) {
    const plan = F.findPlan(store.get().future, planId);
    const fromRec = F.sidejobFrom(store.get());
    openFieldsSheet({
      title: '副業収入',
      description: `記録からの月平均:${yen(fromRec.monthly)}(${fromRec.note})`,
      plan,
      fields: [
        { key: 'monthly', label: '月いくら', type: 'yen', min: 0 },
        { key: 'untilYM', label: 'いつまで(この月まで)', type: 'ym', allowEmpty: true, noneLabel: '期間の終わりまで' },
      ],
      value: plan.sidejob,
      onSave: (v) => {
        store.update((d) => F.updatePlan(d.future, planId, { sidejob: v }));
        toast('保存しました');
      },
    });
  }

  function openLivingSheet(planId) {
    const plan = F.findPlan(store.get().future, planId);
    const fromRec = F.livingFrom(store.get());
    openFieldsSheet({
      title: '毎月の生活費(ローン・積立を除く)',
      description: `記録からの初期値:${yen(fromRec.monthly)}(${fromRec.note})`,
      plan,
      fields: [{ key: 'monthly', label: '今の生活費(月)', type: 'yen', min: 0 }],
      value: { monthly: plan.living.monthly },
      onSave: (v) => {
        updatePlan(planId, (p) => (p.living.monthly = v.monthly), '保存しました');
      },
    });
  }

  // ---------------------------------------------------------------
  // 取り崩しの設定
  // ---------------------------------------------------------------

  function openDrawdownSheet(planId) {
    const plan = F.findPlan(store.get().future, planId);
    const dd = plan.drawdown;
    const D = F.DRAW_DEFAULTS;
    openFieldsSheet({
      title: '取り崩しの設定',
      description: '取り崩しは、売った額から税を引いた手取りを現金に入れます(税率は「利回りの仮定と税率」の値)。',
      plan,
      fields: [
        { key: 'method', label: '方式', type: 'select', options: F.DRAW_METHODS, hint: '不足分だけ:現金が生活防衛資金を下回る月に補う / 定額:毎月決まった額 / 定率:年初の残高の◯%を 1 年かけて月割り' },
        { key: 'fixedMonthly', label: '定額:毎月の取り崩し額(売る額)', type: 'yen', min: 0, hint: `定額のときに使います。初期値 ${U.yen(D.fixedMonthly)}円は仮の値です` },
        { key: 'ratePercent', label: '定率:年初の残高の何%', type: 'percent', min: 0, max: 100, hint: `定率のときに使います。初期値 ${D.ratePercent}% は仮の値です。年初(1月か計算の最初の月)の、取り崩しの対象の残高に掛けます` },
        { key: 'topUp', label: '不足分も補う', type: 'check', checkLabel: '定額・定率のうえで、足りなければ不足分も補う(併用)' },
        { key: 'fromAge', label: '定額・定率を始める年齢', type: 'int', unit: '歳', min: 0, max: 120, allowEmpty: true, hint: '空欄は今から。始める前と終わった後は「不足分だけ」で補います(生年月が必要)' },
        { key: 'toAge', label: '定額・定率を終える年齢', type: 'int', unit: '歳', min: 0, max: 120, allowEmpty: true, hint: '空欄は期間の終わりまで。その年齢のあいだは取り崩します' },
        { key: 'yearlyCap', label: '1年あたりの上限(売る額)', type: 'yen', min: 0, allowEmpty: true, hint: '空欄は上限なし。1〜12月に売る額の合計の上限です。上限のために必要な分を取り崩せない月は「資金不足」として記録します' },
        { key: 'cashCap', label: '現金の上限', type: 'yen', min: 0, allowEmpty: true, hint: '空欄は上限なし。現金がこの額以上の月は、定額・定率の取り崩しを休みます' },
        { key: 'reinvest', label: '上限を超えた現金', type: 'check', checkLabel: '現金の上限を超えた分を投資に戻す(課税口座として利回りで増やし、取り崩しの対象にも入れます)' },
      ],
      value: dd,
      onSave: (v) => {
        if (v.fromAge !== null && v.toAge !== null && v.fromAge > v.toAge) return '始める年齢は、終える年齢以下にしてください';
        if (v.reinvest && v.cashCap === null) return '投資に戻すときは、現金の上限を入れてください';
        store.update((d) => F.updateDrawdown(d.future, planId, v));
        toast('取り崩しの設定を保存しました');
        return true;
      },
    });
  }

  /** 取り崩す資産と順番(資産ごとのオン/オフ、優先度ごとにまとめてオン/オフ、並べ替え) */
  function openDrawTargetsSheet(planId) {
    const plan = F.findPlan(store.get().future, planId);
    const items = F.drawItems(plan);
    let order = items.map((x) => x.key);
    const on = Object.fromEntries(items.map((x) => [x.key, x.on]));
    const info = new Map(items.map((x) => [x.key, x]));
    const s = openSheet({
      title: '取り崩す資産と順番',
      description: '上から順に取り崩します。スイッチでオン/オフ(「売りたくない」は初期でオフ)。',
      className: 'sheet-form',
    });
    const tagBox = h('div', { class: 'fx-tag-list' });
    const list = h('ul', { class: 'pay-list fx-list fx-target-list' });
    function render() {
      tagBox.replaceChildren(
        ...F.PRIORITIES.map((pr) => {
          const keys = order.filter((k) => info.get(k).priority === pr.id);
          if (!keys.length) return null;
          const n = keys.filter((k) => on[k]).length;
          const set = (v) => () => {
            for (const k of keys) on[k] = v;
            render();
          };
          return h(
            'div',
            { class: 'fx-tag-row' },
            h('div', { class: 'fx-tag-name' }, h('span', { class: `chip fx-pri-${pr.id}`, text: pr.label }), h('span', { class: 'fx-tag-count', text: `${n}/${keys.length}件オン` })),
            btn('全部オン', { size: 'small', className: 'fx-tag-btn', onClick: set(true) }),
            btn('全部オフ', { size: 'small', className: 'fx-tag-btn', onClick: set(false) })
          );
        }).filter(Boolean)
      );
      list.replaceChildren(
        ...order.map((k, i) => {
          const x = info.get(k);
          return h(
            'li',
            { class: `pay-row${on[k] ? '' : ' is-off'}` },
            h(
              'button',
              {
                type: 'button',
                class: `fx-switch${on[k] ? ' is-on' : ''}`,
                role: 'switch',
                'aria-checked': String(on[k]),
                'aria-label': `「${x.name}」を取り崩しの対象にする`,
                onClick: () => {
                  on[k] = !on[k];
                  render();
                },
              },
              h('span', { class: 'fx-switch-knob' })
            ),
            h(
              'div',
              { class: 'pay-main fx-target-main' },
              h('span', { class: 'pay-name' }, `${i + 1}. ${x.name}`),
              h('span', { class: 'pay-meta' }, h('span', { class: `chip fx-pri-${x.priority}`, text: F.label(F.PRIORITIES, x.priority) }), h('span', { text: F.label(F.TAX_KINDS, x.taxKind) })),
              h('span', { class: 'pay-amount', text: x.kind === 'asset' ? yen(x.value) : x.kind === 'saving' ? '積立でたまる分' : '戻した分' })
            )
          );
        })
      );
    }
    render();
    add(
      s.body,
      tagBox,
      list,
      h(
        'div',
        { class: 'button-row' },
        btn('並べ替え', {
          size: 'small',
          onClick: () =>
            MT.forms.openReorderSheet({
              title: '取り崩す順番',
              description: '上にあるものから先に取り崩します。',
              items: order.map((k) => ({ id: k, label: info.get(k).name, sub: F.label(F.PRIORITIES, info.get(k).priority), priority: info.get(k).priority })),
              presets: [{ id: 'priority', label: '売却優先度の順に並べる', sort: (xs) => xs.map((x, i) => ({ x, i })).sort((a, b) => ['first', 'ifNeeded', 'keep'].indexOf(a.x.priority) - ['first', 'ifNeeded', 'keep'].indexOf(b.x.priority) || a.i - b.i).map((o) => o.x) }],
              onSave: (ids) => {
                order = ids;
                render();
              },
            }),
        }),
        btn('既定に戻す', {
          size: 'small',
          variant: 'ghost',
          onClick: () => {
            const def = F.drawItems({ ...plan, drawdown: { ...plan.drawdown, order: null, targets: {} } });
            order = def.map((x) => x.key);
            for (const x of def) on[x.key] = x.on;
            render();
          },
        })
      ),
      h('p', { class: 'hint', text: '並べ替えは「保存」で決まります。新しく足した資産は、売却優先度の位置で後ろに入ります。' })
    );
    formFoot(s, {
      onSave: () => {
        store.update((d) => F.updateDrawdown(d.future, planId, { order, targets: { ...on } }));
        toast('取り崩す資産と順番を保存しました');
        s.close();
      },
    });
  }

  function openCashSheet(planId) {
    const plan = F.findPlan(store.get().future, planId);
    const d = store.get();
    const m = F.cashFrom(d, 'monthly');
    const p = F.cashFrom(d, 'payments');
    openFieldsSheet({
      title: '現金(今の額)',
      description: `月末記録:${yen(m.cash)}(${m.note})/ 支払い管理:${yen(p.cash)}(${p.note})`,
      plan,
      fields: [
        { key: 'cashSource', label: '初期値の出どころ', type: 'select', options: F.CASH_SOURCES, hint: '「手で入力」以外を選ぶと、その記録の額を入れます' },
        { key: 'cash', label: '手で入力するときの額', type: 'yen' },
      ],
      value: { cashSource: plan.cashSource, cash: plan.cash },
      onSave: (v) => {
        const cash = v.cashSource === 'manual' ? v.cash : F.cashFrom(d, v.cashSource).cash;
        store.update((dd) => F.updatePlan(dd.future, planId, { cash, cashSource: v.cashSource }));
        toast('保存しました');
      },
    });
  }

  // ---------------------------------------------------------------
  // 記録からの読み直し・取り込み
  // ---------------------------------------------------------------

  async function reloadStartFlow(planId) {
    const ok = await confirmDialog({
      title: '今の資産を最新の記録から読み直しますか?',
      message: ['現金と投資資産の一覧を、月末記録・資産管理・ポケカ在庫の最新の値で置き換えます(手で直した値は消えます)。計算の開始年月も今月になります。'],
      okLabel: '読み直す',
    });
    if (!ok) return;
    let info = null;
    updatePlan(planId, (p, d) => (info = F.reloadStart(p, d)));
    if (info) toast(`読み直しました(投資 ${info.count}件${info.missing ? `・価格未取得の ${info.missing}件は入れていません` : ''})`, { duration: 4000 });
  }

  /** ローン・積立を支払い管理から拾い直す(記録から入れた行を入れ替え、手で足した行は残す) */
  async function reloadFromPayments(planId, key) {
    const label = key === 'loans' ? 'ローン' : '積立投資';
    const ok = await confirmDialog({
      title: `${label}を支払い管理から拾い直しますか?`,
      message: [`支払い管理から入れた${label}を、いまの支払い(カテゴリ「${key === 'loans' ? 'ローン' : '投資'}」)で入れ替えます。手で足した行は残ります。`],
      okLabel: '拾い直す',
    });
    if (!ok) return;
    updatePlan(
      planId,
      (p, d) => {
        const fresh = key === 'loans' ? F.loansFrom(d) : F.savingsFrom(d);
        const old = new Map(p[key].filter((r) => r.sourceKey).map((r) => [r.sourceKey, r]));
        // すでにある行の設定(口座区分など)は引き継ぐ
        const merged = fresh.map((r) => (old.has(r.sourceKey) ? { ...old.get(r.sourceKey), monthly: r.monthly, endYM: r.endYM || old.get(r.sourceKey).endYM, name: r.name } : r));
        p[key] = [...merged, ...p[key].filter((r) => !r.sourceKey)];
      },
      `${label}を拾い直しました`
    );
  }

  function importYearlyFlow(planId) {
    let added = 0;
    updatePlan(planId, (p, d) => {
      const have = new Set(p.yearly.map((r) => r.sourceKey).filter(Boolean));
      for (const r of F.yearlyFrom(d)) {
        if (have.has(r.sourceKey)) continue;
        if (F.saveRow(p, 'yearly', r)) added++;
      }
    });
    toast(added ? `特別支出から ${added}件を取り込みました(毎年として。間隔などは直せます)` : '取り込む特別支出はありません(取り込み済みか、今後の未済がありません)', { duration: 4000 });
  }

  /** 収入を記録(入金予定・履歴)から足す(同じ名前の行があるものは足さない) */
  function importIncomesFlow(planId) {
    const found = F.incomesFrom(store.get());
    let added = 0;
    updatePlan(planId, (p) => {
      const have = new Set(p.incomes.map((r) => r.name));
      for (const r of found) {
        if (have.has(r.name)) continue;
        if (F.saveRow(p, 'incomes', { ...r, id: null })) added++;
      }
    });
    toast(
      added
        ? `収入を ${added}件 足しました。何歳から何歳までかを直してください`
        : found.length
          ? '記録の収入は、すでに入っています'
          : '記録から収入が見つかりませんでした(入金予定の「毎月固定」か、履歴の直近3か月に毎月ある入金を拾います)。「追加」から入れてください',
      { duration: 5000 }
    );
  }

  function pickRepaymentFlow(planId) {
    const cands = F.repaymentCandidates(store.get());
    if (!cands.length) return toast('支払い管理に入金予定がありません');
    actionSheet({
      title: '入金予定から選ぶ',
      description: '選んだ入金予定の名前と金額で返済を足します。終了年月はあとで入れてください。',
      actions: cands.map((c) => ({
        label: `${c.name}(月 ${yen(c.monthly)})`,
        onSelect: () => updatePlan(planId, (p) => F.saveRow(p, 'repayments', { name: c.name, monthly: c.monthly, endYM: null }), `「${c.name}」を足しました`),
      })),
    });
  }

  function recalcSidejob(planId) {
    const r = F.sidejobFrom(store.get());
    updatePlan(planId, (p) => (p.sidejob.monthly = r.monthly), `副業収入を ${yen(r.monthly)} にしました(${r.note})`);
  }

  function recalcLiving(planId) {
    const r = F.livingFrom(store.get());
    updatePlan(planId, (p) => (p.living.monthly = r.monthly), `生活費を ${yen(r.monthly)} にしました`);
  }

  // ---------------------------------------------------------------
  // プランの操作
  // ---------------------------------------------------------------

  function createPlanFlow() {
    const f = store.get().future;
    if (f.plans.length >= F.MAX_PLANS) return toast(`プランは ${F.MAX_PLANS} 件までです`);
    const name = f.plans.length ? `プラン${f.plans.length + 1}` : '基本のプラン';
    let id = null;
    if (store.update((d) => (id = F.addPlan(d.future, F.newPlan(d, new Date(), name))))) toast('最新の記録からプランを作りました。条件を確かめてください', { duration: 4000 });
    return id;
  }

  async function renameFlow(planId) {
    const plan = F.findPlan(store.get().future, planId);
    const name = await promptDialog({ title: 'プランの名前', label: '名前', value: plan.name, maxLength: 40 });
    if (name && name.trim()) store.update((d) => F.renamePlan(d.future, planId, name));
  }

  async function duplicateFlow(planId) {
    const f = store.get().future;
    if (f.plans.length >= F.MAX_PLANS) return toast(`プランは ${F.MAX_PLANS} 件までです`);
    const plan = F.findPlan(f, planId);
    const name = await promptDialog({ title: 'プランを複製', label: '新しいプランの名前', value: `${plan.name}のコピー`, okLabel: '複製する', maxLength: 40 });
    if (name === null) return;
    if (store.update((d) => F.duplicatePlan(d.future, planId, name))) toast('複製しました。条件を変えて「比較」で並べられます', { duration: 4000 });
  }

  async function deleteFlow(planId) {
    const plan = F.findPlan(store.get().future, planId);
    const ok = await confirmDialog({
      title: `プラン「${plan.name}」を削除しますか?`,
      message: ['このプランの条件をすべて削除します。間違えた場合は、設定の「直前のデータに戻す」で元に戻せます。'],
      okLabel: '削除する',
      danger: true,
    });
    if (ok && store.update((d) => F.removePlan(d.future, planId), { backup: `将来予想のプラン「${plan.name}」の削除` })) toast('削除しました');
  }

  function planMenu(planId) {
    actionSheet({
      title: 'プラン',
      actions: [
        { label: '名前を変更', onSelect: () => renameFlow(planId) },
        { label: '複製(条件を変えて比べる)', onSelect: () => duplicateFlow(planId) },
        { label: '最新の記録から新しいプランを作る', onSelect: createPlanFlow },
        { label: '削除', danger: true, onSelect: () => deleteFlow(planId) },
      ],
    });
  }

  MT.futureUI = {
    openDrawdownSheet,
    openDrawTargetsSheet,
    yen,
    ymText,
    rowSpec,
    openRowSheet,
    openBaseSheet,
    openReturnsSheet,
    openReserveSheet,
    openSidejobSheet,
    openLivingSheet,
    openCashSheet,
    reloadStartFlow,
    reloadFromPayments,
    importYearlyFlow,
    pickRepaymentFlow,
    importIncomesFlow,
    recalcSidejob,
    recalcLiving,
    createPlanFlow,
    renameFlow,
    duplicateFlow,
    deleteFlow,
    planMenu,
    updatePlan,
  };
})(window);
