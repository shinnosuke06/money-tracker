/*
 * 資産管理:グラフ
 *  - 円グラフ(証券会社別・種別)
 *  - 総資産の推移(折れ線)
 * 共通部品は js/core/charts.js
 */
(function (root) {
  'use strict';
  const MT = root.MT;
  const U = MT.util;
  const C = MT.charts;

  /**
   * 円グラフ(ドーナツ)
   * @param {{label: string, value: number}[]} parts 表示順(色はこの順に固定で割り当てる)
   */
  function doughnut(slot, canvas, fallback, parts) {
    C.mount(slot, canvas, fallback, (c) => {
      const series = C.foldSeries(
        parts.map((p) => ({ label: p.label, values: [p.value] })),
        1
      );
      const total = series.reduce((t, s) => t + s.values[0], 0);
      return {
        type: 'doughnut',
        data: {
          labels: series.map((s) => s.label),
          datasets: [
            {
              data: series.map((s) => s.values[0]),
              backgroundColor: series.map((s, i) => (s.isOther ? c.other : c.series[i])),
              borderColor: c.surface,
              borderWidth: 2,
              hoverOffset: 4,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          cutout: '62%',
          plugins: {
            legend: {
              position: 'bottom',
              labels: { color: c.text, font: { family: c.font, size: 12 }, usePointStyle: true, pointStyle: 'rectRounded', boxWidth: 10, boxHeight: 10, padding: 10 },
            },
            tooltip: C.tooltip(c, {
              label: (item) => ` ${item.label}: ${U.yen(item.raw)}円(${total ? ((item.raw / total) * 100).toFixed(1) : 0}%)`,
            }),
          },
        },
      };
    });
  }

  /** 総資産の推移(日付ごと) */
  function history(slot, canvas, fallback, entries) {
    C.mount(slot, canvas, fallback, (c) => {
      const pts = entries.slice(-120);
      const many = pts.length > 40;
      const labels = pts.map((e, i) => {
        const [y, m, d] = e.date.split('-').map(Number);
        return i === 0 || (m === 1 && d <= 7) ? [`${m}/${d}`, `${y}`] : `${m}/${d}`;
      });
      return {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: '総資産',
              data: pts.map((e) => e.total),
              borderColor: c.series[0],
              backgroundColor: c.series[0],
              borderWidth: 2,
              pointRadius: many ? 0 : 4,
              pointHoverRadius: 5,
              pointBorderColor: c.surface,
              pointBorderWidth: 2,
              tension: 0,
              fill: false,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: C.tooltip(c, {
              title: (items) => (items.length ? pts[items[0].dataIndex].date.replace(/-/g, '/') : ''),
              label: (item) => ` 総資産: ${U.yen(item.raw)}円`,
            }),
          },
          scales: { ...C.scales(c), y: { ...C.scales(c).y, beginAtZero: false } },
        },
      };
    });
  }

  MT.assetsCharts = { doughnut, history, destroy: C.destroy };
})(window);
