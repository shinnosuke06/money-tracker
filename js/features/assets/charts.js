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

  /** 吹き出しの中で折り返す(全角で 16 文字ほど・最大 6 行) */
  function wrapLines(text, n = 16, max = 6) {
    const out = [];
    for (const line of String(text).split('\n')) {
      const chars = [...line];
      if (!chars.length) continue;
      for (let i = 0; i < chars.length; i += n) out.push(chars.slice(i, i + n).join(''));
    }
    return out.length > max ? [...out.slice(0, max - 1), `${out[max - 1].slice(0, n - 1)}…`] : out;
  }

  /**
   * 総資産の推移(日付ごと。直近 120 件)。コメントのある日は ◆ の点にし、吹き出しにコメントを出す
   * @param {{marks?: Set<string>, onPick?: (date: string) => void}} opts
   *   marks:目印を付ける日付(赤い点)/ onPick:点を押したとき(その日の日付を渡す)
   */
  function history(slot, canvas, fallback, entries, opts = {}) {
    const marks = opts.marks || new Set();
    C.mount(slot, canvas, fallback, (c) => {
      const pts = entries.slice(-120);
      const many = pts.length > 40;
      const marked = pts.map((e) => marks.has(e.date));
      const memo = pts.map((e) => !!e.memo);
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
              pointRadius: marked.map((m, i) => (memo[i] ? 7 : m ? 5 : many ? 0 : 4)),
              pointHoverRadius: marked.map((m, i) => (memo[i] ? 8 : m ? 6 : 5)),
              pointStyle: memo.map((x) => (x ? 'rectRot' : 'circle')),
              pointBackgroundColor: marked.map((m) => (m ? c.negative : c.series[0])),
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
          onClick: opts.onPick
            ? (evt, elements) => {
                if (elements.length) opts.onPick(pts[elements[0].index].date);
              }
            : undefined,
          plugins: {
            legend: { display: false },
            tooltip: C.tooltip(c, {
              title: (items) => (items.length ? pts[items[0].dataIndex].date.replace(/-/g, '/') : ''),
              label: (item) => ` 総資産: ${U.yen(item.raw)}円${marked[item.dataIndex] ? '(要確認)' : ''}`,
              afterBody: (items) => (items.length && pts[items[0].dataIndex].memo ? ['', ...wrapLines(pts[items[0].dataIndex].memo)] : []),
            }),
          },
          scales: { ...C.scales(c), y: { ...C.scales(c).y, beginAtZero: false } },
        },
      };
    });
  }

  MT.assetsCharts = { doughnut, history, wrapLines, destroy: C.destroy };
})(window);
