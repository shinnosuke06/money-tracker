/*
 * 月末記録:総資産の推移(積み上げ棒グラフ、Chart.js)
 * 色は CSS 変数(--series-1〜8)から読むので、ダークモードにも追従する。
 */
(function (root) {
  'use strict';
  const MT = (root.MT = root.MT || {});
  const U = MT.util;
  const M = MT.monthlyModel;

  const MAX_SERIES = 8; // 9 系列目以降は「その他」にまとめる
  const MAX_MONTHS = 24; // 横に並べる最大の月数(直近)

  let chart = null;
  let renderSeq = 0;

  function cssVar(name) {
    return getComputedStyle(root.document.documentElement).getPropertyValue(name).trim();
  }

  function palette() {
    const series = [];
    for (let i = 1; i <= MAX_SERIES; i++) series.push(cssVar(`--series-${i}`));
    return {
      series,
      other: cssVar('--series-other'),
      surface: cssVar('--surface'),
      grid: cssVar('--chart-grid'),
      axis: cssVar('--chart-axis'),
      text: cssVar('--chart-text'),
      font: cssVar('--font'),
    };
  }

  /** 系列が多すぎるときは、先頭 7 つ + 「その他」にまとめる */
  function foldSeries(series, monthCount) {
    if (series.length <= MAX_SERIES) return series;
    const head = series.slice(0, MAX_SERIES - 1);
    const rest = series.slice(MAX_SERIES - 1);
    const values = [];
    for (let i = 0; i < monthCount; i++) values.push(rest.reduce((s, r) => s + r.values[i], 0));
    return [...head, { key: '__other', label: `その他(${rest.length}件)`, values, isOther: true }];
  }

  function destroy() {
    renderSeq++;
    if (chart) {
      chart.destroy();
      chart = null;
    }
  }

  /**
   * グラフを描く
   * @param {HTMLCanvasElement} canvas
   * @param {HTMLElement} fallbackEl 読み込めなかったときに表示する要素
   * @param {object} m monthly データ
   * @param {'category'|'item'} mode
   */
  function render(canvas, fallbackEl, m, mode) {
    destroy();
    const seq = renderSeq;
    MT.libs
      .load('chart')
      .then((Chart) => {
        if (seq !== renderSeq || !canvas.isConnected) return;
        Chart.defaults.font.family = cssVar('--font');
        chart = new Chart(canvas, buildConfig(m, mode));
      })
      .catch(() => {
        if (seq !== renderSeq) return;
        canvas.hidden = true;
        fallbackEl.hidden = false;
      });
  }

  function buildConfig(m, mode) {
    const all = M.months(m);
    const monthList = all.slice(-MAX_MONTHS);
    const raw = mode === 'item' ? M.seriesByItem(m, monthList) : M.seriesByCategory(m, monthList);
    const series = foldSeries(raw, monthList.length);
    const c = palette();

    const datasets = series.map((s, i) => ({
      label: s.label,
      data: s.values,
      backgroundColor: s.isOther ? c.other : c.series[i],
      hoverBackgroundColor: s.isOther ? c.other : c.series[i],
      // 積み上げの境目に 2px の隙間(背景色の線)
      borderColor: c.surface,
      borderWidth: { top: 2, right: 0, bottom: 0, left: 0 },
      borderSkipped: 'start',
      borderRadius: topRadius,
      maxBarThickness: 24,
    }));

    const labels = monthList.map((ym, i) => {
      const { y, m: mon } = U.splitYM(ym);
      return i === 0 || mon === 1 ? [`${mon}月`, `${y}`] : `${mon}月`;
    });

    return {
      type: 'bar',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              color: c.text,
              font: { family: c.font, size: 12 },
              usePointStyle: true,
              boxWidth: 10,
              boxHeight: 10,
              padding: 12,
              generateLabels: (ch) =>
                ch.data.datasets.map((ds, i) => ({
                  text: ds.label,
                  fillStyle: ds.backgroundColor,
                  strokeStyle: ds.backgroundColor,
                  lineWidth: 0,
                  pointStyle: 'rectRounded',
                  fontColor: c.text,
                  hidden: !ch.isDatasetVisible(i),
                  datasetIndex: i,
                })),
            },
          },
          tooltip: {
            backgroundColor: 'rgba(20, 20, 19, 0.92)',
            titleFont: { family: c.font, weight: '600' },
            bodyFont: { family: c.font },
            footerFont: { family: c.font, weight: '600' },
            padding: 10,
            boxPadding: 4,
            usePointStyle: true,
            itemSort: (a, b) => b.datasetIndex - a.datasetIndex, // 上に積んだものから
            filter: (item) => item.raw !== 0,
            callbacks: {
              title: (items) => (items.length ? `${U.ymLabel(monthList[items[0].dataIndex])}末` : ''),
              label: (item) => ` ${item.dataset.label}: ${U.yen(item.raw)}円`,
              labelPointStyle: () => ({ pointStyle: 'rectRounded', rotation: 0 }),
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
          },
        },
        scales: {
          x: {
            stacked: true,
            grid: { display: false },
            border: { color: c.axis },
            ticks: { color: c.text, font: { family: c.font, size: 11 }, maxRotation: 0, autoSkip: true },
          },
          y: {
            stacked: true,
            beginAtZero: true,
            grid: { color: c.grid, lineWidth: 1 },
            border: { display: false },
            ticks: {
              color: c.text,
              font: { family: c.font, size: 11 },
              maxTicksLimit: 6,
              callback: (v) => U.yenCompact(v),
            },
          },
        },
      },
    };
  }

  /** 積み上げのいちばん上(表示中・正の値)だけ角を丸める */
  function topRadius(ctx) {
    const v = ctx.raw || 0;
    if (v <= 0) return 0;
    const ch = ctx.chart;
    for (let k = ch.data.datasets.length - 1; k > ctx.datasetIndex; k--) {
      if (ch.isDatasetVisible(k) && (ch.data.datasets[k].data[ctx.dataIndex] || 0) > 0) return 0;
    }
    return { topLeft: 4, topRight: 4, bottomLeft: 0, bottomRight: 0 };
  }

  MT.monthlyChart = { render, destroy, MAX_MONTHS };
})(window);
