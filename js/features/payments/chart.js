/*
 * 支払い管理:月別の履歴グラフ
 *  - flow:収入と支払(横並びの棒)
 *  - category:支払の内訳(カテゴリ別の積み上げ)
 *  - balance:月末残高
 */
(function (root) {
  'use strict';
  const MT = root.MT;
  const U = MT.util;
  const P = MT.paymentsModel;
  const C = MT.charts;

  const SLOT = 'payments-history';
  const MAX_MONTHS = 24;

  function render(canvas, fallbackEl, history, mode) {
    C.mount(SLOT, canvas, fallbackEl, (c) => buildConfig(c, history.slice(-MAX_MONTHS), mode));
  }

  function destroy() {
    C.destroy(SLOT);
  }

  function buildConfig(c, hist, mode) {
    const months = hist.map((x) => x.month);
    let datasets;
    let stacked = false;
    if (mode === 'category') {
      stacked = true;
      datasets = P.TOTAL_CATEGORIES.map((cat, i) => ({
        label: cat.label,
        data: hist.map((x) => x.catTotals[cat.id] || 0),
        ...C.barStyle(c, c.series[i], { stacked: true }),
      }));
    } else if (mode === 'balance') {
      datasets = [{ label: '月末残高', data: hist.map((x) => (x.balance == null ? null : x.balance)), ...C.barStyle(c, c.series[0]) }];
    } else {
      datasets = [
        { label: '収入', data: hist.map((x) => (x.income == null ? null : x.income)), ...C.barStyle(c, c.series[0]) },
        { label: '支払', data: hist.map((x) => x.payment), ...C.barStyle(c, c.series[1]) },
      ];
    }
    return {
      type: 'bar',
      data: { labels: C.monthLabels(months), datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: C.legend(c, { show: datasets.length > 1 }),
          tooltip: C.tooltip(
            c,
            {
              title: (items) => (items.length ? U.ymLabel(months[items[0].dataIndex]) : ''),
              label: (item) => (item.raw == null ? ` ${item.dataset.label}: —` : ` ${item.dataset.label}: ${U.yen(item.raw)}円`),
              footer: (items) => {
                if (!items.length) return '';
                const x = hist[items[0].dataIndex];
                if (mode === 'flow') return x.income == null ? '収入:未入力' : `差:${U.yenSigned(x.income - x.payment)}円`;
                if (mode === 'category') return `合計:${U.yen(x.payment)}円`;
                return '';
              },
            },
            stacked ? { itemSort: (a, b) => b.datasetIndex - a.datasetIndex, filter: (item) => item.raw !== 0 } : {}
          ),
        },
        scales: C.scales(c, { stacked }),
      },
    };
  }

  MT.paymentsChart = { render, destroy };
})(window);
