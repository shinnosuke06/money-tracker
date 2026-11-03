/*
 * グラフの共通部品(Chart.js)
 *  - 色は CSS 変数(--series-1〜8・--chart-*・--tooltip-*)から読む(色の直書きはしない)
 *  - mount(slot, ...) で、場所(slot)ごとに 1 つのグラフを管理する(描き直すと古いものは破棄)
 *  - テーマが変わったら refreshAll() で、表示中のグラフを新しい色で描き直す
 */
(function (root) {
  'use strict';
  const MT = (root.MT = root.MT || {});
  const U = MT.util;

  const MAX_SERIES = 8; // 9 系列目以降は「その他」にまとめる

  const slots = {}; // slot → { chart, seq }

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
      tooltipBg: cssVar('--tooltip-bg'),
      tooltipText: cssVar('--tooltip-text'),
      font: cssVar('--font'),
    };
  }

  /** 系列が多すぎるときは、先頭 7 つ + 「その他」にまとめる。series: [{ label, values }] */
  function foldSeries(series, pointCount) {
    if (series.length <= MAX_SERIES) return series;
    const head = series.slice(0, MAX_SERIES - 1);
    const rest = series.slice(MAX_SERIES - 1);
    const values = [];
    for (let i = 0; i < pointCount; i++) values.push(rest.reduce((s, r) => s + (r.values[i] || 0), 0));
    return [...head, { key: '__other', label: `その他(${rest.length}件)`, values, isOther: true }];
  }

  /** 横軸の月ラベル:最初と 1 月だけ年を添える */
  function monthLabels(months) {
    return months.map((ym, i) => {
      const { y, m } = U.splitYM(ym);
      return i === 0 || m === 1 ? [`${m}月`, `${y}`] : `${m}月`;
    });
  }

  function legend(c, { show = true } = {}) {
    return {
      display: show,
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
            fillStyle: ds.legendColor || ds.backgroundColor,
            strokeStyle: ds.legendColor || ds.backgroundColor,
            lineWidth: 0,
            pointStyle: 'rectRounded',
            fontColor: c.text,
            hidden: !ch.isDatasetVisible(i),
            datasetIndex: i,
          })),
      },
    };
  }

  function tooltip(c, callbacks, extra = {}) {
    return {
      backgroundColor: c.tooltipBg,
      titleColor: c.tooltipText,
      bodyColor: c.tooltipText,
      footerColor: c.tooltipText,
      titleFont: { family: c.font, weight: '600' },
      bodyFont: { family: c.font },
      footerFont: { family: c.font, weight: '600' },
      padding: 10,
      boxPadding: 4,
      usePointStyle: true,
      callbacks: { labelPointStyle: () => ({ pointStyle: 'rectRounded', rotation: 0 }), ...callbacks },
      ...extra,
    };
  }

  function scales(c, { stacked = false } = {}) {
    return {
      x: {
        stacked,
        grid: { display: false },
        border: { color: c.axis },
        ticks: { color: c.text, font: { family: c.font, size: 11 }, maxRotation: 0, autoSkip: true },
      },
      y: {
        stacked,
        beginAtZero: true,
        grid: { color: c.grid, lineWidth: 1 },
        border: { display: false },
        ticks: { color: c.text, font: { family: c.font, size: 11 }, maxTicksLimit: 6, callback: (v) => U.yenCompact(v) },
      },
    };
  }

  /** 棒の見た目(上端だけ 4px の角丸、積み上げの境目に 2px の隙間) */
  function barStyle(c, color, { stacked = false } = {}) {
    return {
      backgroundColor: color,
      hoverBackgroundColor: color,
      borderColor: c.surface,
      borderWidth: stacked ? { top: 2, right: 0, bottom: 0, left: 0 } : 0,
      borderSkipped: 'start',
      borderRadius: stacked ? topRadius : 4,
      maxBarThickness: 24,
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

  function destroy(slot) {
    const s = slots[slot] || (slots[slot] = { chart: null, seq: 0 });
    s.seq++;
    if (s.chart) {
      s.chart.destroy();
      s.chart = null;
    }
    return s;
  }

  /**
   * グラフを描く。Chart.js は必要になった時点で CDN から読み込む。
   * @param {string} slot 場所の名前(同じ slot のグラフは描き直すと置き換わる)
   * @param {HTMLCanvasElement} canvas
   * @param {HTMLElement} fallbackEl 読み込めなかったときに表示する要素
   * @param {(c: object) => object} buildConfig 色(palette)を受け取って Chart.js の設定を返す
   */
  function mount(slot, canvas, fallbackEl, buildConfig) {
    const s = destroy(slot);
    Object.assign(s, { canvas, fallbackEl, buildConfig }); // テーマが変わったときの描き直し用
    const seq = s.seq;
    MT.libs
      .load('chart')
      .then((Chart) => {
        if (seq !== s.seq || !canvas.isConnected) return;
        Chart.defaults.font.family = cssVar('--font');
        s.chart = new Chart(canvas, buildConfig(palette()));
      })
      .catch(() => {
        if (seq !== s.seq) return;
        canvas.hidden = true;
        if (fallbackEl) fallbackEl.hidden = false;
      });
  }

  /** 表示中のグラフを、いまのテーマの色で描き直す */
  function refreshAll() {
    for (const [slot, s] of Object.entries(slots)) {
      if (s.canvas && s.canvas.isConnected && s.buildConfig) mount(slot, s.canvas, s.fallbackEl, s.buildConfig);
    }
  }

  MT.charts = { MAX_SERIES, palette, foldSeries, monthLabels, legend, tooltip, scales, barStyle, topRadius, mount, destroy, refreshAll };
})(window);
