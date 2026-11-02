/*
 * 月末記録:総資産の推移(積み上げ棒グラフ)
 * 共通部品は js/core/charts.js
 */
(function (root) {
  'use strict';
  const MT = (root.MT = root.MT || {});
  const U = MT.util;
  const M = MT.monthlyModel;
  const C = MT.charts;

  const SLOT = 'monthly';
  const MAX_MONTHS = 24; // 横に並べる最大の月数(直近)

  /**
   * グラフを描く
   * @param {HTMLCanvasElement} canvas
   * @param {HTMLElement} fallbackEl 読み込めなかったときに表示する要素
   * @param {object} m monthly データ
   * @param {'category'|'item'} mode
   */
  function render(canvas, fallbackEl, m, mode) {
    C.mount(SLOT, canvas, fallbackEl, (c) => buildConfig(c, m, mode));
  }

  function destroy() {
    C.destroy(SLOT);
  }

  function buildConfig(c, m, mode) {
    const monthList = M.months(m).slice(-MAX_MONTHS);
    const raw = mode === 'item' ? M.seriesByItem(m, monthList) : M.seriesByCategory(m, monthList);
    const series = C.foldSeries(raw, monthList.length);

    const datasets = series.map((s, i) => ({
      label: s.label,
      data: s.values,
      ...C.barStyle(c, s.isOther ? c.other : c.series[i], { stacked: true }),
    }));

    return {
      type: 'bar',
      data: { labels: C.monthLabels(monthList), datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: C.legend(c),
          tooltip: C.tooltip(
            c,
            {
              title: (items) => (items.length ? `${U.ymLabel(monthList[items[0].dataIndex])}末` : ''),
              label: (item) => ` ${item.dataset.label}: ${U.yen(item.raw)}円`,
              footer: (items) => {
                if (!items.length) return '';
                const ch = items[0].chart;
                const i = items[0].dataIndex;
                let total = 0;
                ch.data.datasets.forEach((ds, k) => {
                  if (ch.isDatasetVisible(k)) total += ds.data[i] || 0;
                });
                return `合計: ${U.yen(total)}円`;
              },
            },
            {
              itemSort: (a, b) => b.datasetIndex - a.datasetIndex, // 上に積んだものから
              filter: (item) => item.raw !== 0,
            }
          ),
        },
        scales: C.scales(c, { stacked: true }),
      },
    };
  }

  MT.monthlyChart = { render, destroy, MAX_MONTHS };
})(window);
