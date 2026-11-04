/*
 * 将来予想のグラフ(Chart.js。色は MT.charts.palette() から)
 *  - 総資産の推移:利回りの 3 パターンを 3 本の線で(低め・普通・高め = 系列 1・2・3)。資金不足になる年に赤い ▲
 *  - 現金と投資:選んだパターンの年末の現金(系列 4)と投資(系列 7)の積み上げ棒
 *  - プランの比較:2 つのプランの総資産を 2 本の線で(A・B = 系列 1・2)
 * 線の右端には系列の名前を文字の色で直接書く(凡例と両方。色だけで見分けさせない)。数字は下の表でも見られる。
 */
(function (root) {
  'use strict';
  const MT = root.MT;
  const U = MT.util;
  const C = MT.charts;

  /** 線の右端に系列名を書く(重なるときは上下にずらす。文字は系列の色ではなく文字の色) */
  const endLabels = {
    id: 'futureEndLabels',
    afterDatasetsDraw(chart, _args, opts) {
      const { ctx, chartArea } = chart;
      const items = [];
      chart.data.datasets.forEach((ds, i) => {
        if (!chart.isDatasetVisible(i)) return;
        const meta = chart.getDatasetMeta(i);
        let k = ds.data.length - 1;
        while (k >= 0 && ds.data[k] == null) k--;
        if (k < 0 || !meta.data[k]) return;
        items.push({ text: ds.shortLabel || ds.label, y: meta.data[k].y, x: meta.data[k].x });
      });
      items.sort((a, b) => a.y - b.y);
      for (let i = 1; i < items.length; i++) if (items[i].y - items[i - 1].y < 14) items[i].y = items[i - 1].y + 14;
      ctx.save();
      ctx.font = `600 11px ${opts.font}`;
      ctx.fillStyle = opts.color;
      ctx.textBaseline = 'middle';
      for (const it of items) ctx.fillText(it.text, Math.min(it.x + 6, chartArea.right + 4), Math.max(chartArea.top, Math.min(chartArea.bottom, it.y)));
      ctx.restore();
    },
  };

  /** 年のラベル(年齢が分かれば 2 行目に) */
  const yearLabels = (years) => years.map((y) => (y.age != null ? [`${y.year}`, `${y.age}歳`] : `${y.year}`));

  function lineDataset(c, label, shortLabel, color, values, shortIdx) {
    return {
      label,
      shortLabel,
      data: values,
      borderColor: color,
      backgroundColor: color,
      legendColor: color,
      borderWidth: 2,
      tension: 0,
      fill: false,
      // 資金不足になる年だけ赤い ▲(まわりに面の色の輪)
      pointRadius: values.map((_, i) => (i === shortIdx ? 7 : 0)),
      pointHoverRadius: values.map((_, i) => (i === shortIdx ? 8 : 4)),
      pointStyle: values.map((_, i) => (i === shortIdx ? 'triangle' : 'circle')),
      pointBackgroundColor: values.map((_, i) => (i === shortIdx ? c.negative : color)),
      pointBorderColor: c.surface,
      pointBorderWidth: 2,
    };
  }

  function lineOptions(c, tooltipTitle, extraLabel) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      layout: { padding: { right: 40 } },
      plugins: {
        legend: C.legend(c),
        tooltip: C.tooltip(c, {
          title: tooltipTitle,
          label: (item) => ` ${item.dataset.label}: ${item.raw == null ? '—' : `${U.yen(item.raw)}円`}${extraLabel ? extraLabel(item) : ''}`,
        }),
        futureEndLabels: { color: c.text, font: c.font },
      },
      scales: { ...C.scales(c), y: { ...C.scales(c).y, beginAtZero: true } },
    };
  }

  /** 総資産の推移(3 パターン) */
  function totals(slot, canvas, fallback, all) {
    C.mount(slot, canvas, fallback, (c) => {
      const base = all.mid.years;
      const pats = MT.futureModel.PATTERNS;
      return {
        type: 'line',
        data: {
          labels: yearLabels(base),
          datasets: pats.map((p, i) => {
            const r = all[p.id];
            const shortYear = r.summary.firstShortYM ? Number(r.summary.firstShortYM.slice(0, 4)) : null;
            return lineDataset(c, `${p.label}(${r.rate}%)`, p.label, c.series[i], r.years.map((y) => y.total), shortYear ? r.years.findIndex((y) => y.year === shortYear) : -1);
          }),
        },
        options: lineOptions(
          c,
          (items) => (items.length ? `${base[items[0].dataIndex].year}年末${base[items[0].dataIndex].age != null ? `(${base[items[0].dataIndex].age}歳)` : ''}の総資産` : ''),
          (item) => {
            const r = all[pats[item.datasetIndex].id];
            const y = r.years[item.dataIndex];
            return y && y.shortYM ? '(資金不足)' : '';
          }
        ),
        plugins: [endLabels],
      };
    });
  }

  /** 現金と投資の積み上げ(選んだパターン) */
  function stack(slot, canvas, fallback, result) {
    C.mount(slot, canvas, fallback, (c) => {
      const ys = result.years;
      return {
        type: 'bar',
        data: {
          labels: yearLabels(ys),
          datasets: [
            { label: '現金', data: ys.map((y) => y.cash), ...C.barStyle(c, c.series[3], { stacked: true }) },
            { label: '投資', data: ys.map((y) => y.invest), ...C.barStyle(c, c.series[6], { stacked: true }) },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: C.legend(c),
            tooltip: C.tooltip(c, {
              title: (items) => (items.length ? `${ys[items[0].dataIndex].year}年末` : ''),
              label: (item) => ` ${item.dataset.label}: ${U.yen(item.raw)}円`,
              footer: (items) => (items.length ? `総資産: ${U.yen(ys[items[0].dataIndex].total)}円` : ''),
            }),
          },
          scales: C.scales(c, { stacked: true }),
        },
      };
    });
  }

  /** プランの比較(2 本の線。年は両方の年をあわせる) */
  function compare(slot, canvas, fallback, a, b) {
    C.mount(slot, canvas, fallback, (c) => {
      const years = [...new Set([...a.result.years.map((y) => y.year), ...b.result.years.map((y) => y.year)])].sort((x, y) => x - y);
      const valuesOf = (r) => years.map((yr) => {
        const y = r.years.find((x) => x.year === yr);
        return y ? y.total : null;
      });
      const shortIdx = (r) => (r.summary.firstShortYM ? years.indexOf(Number(r.summary.firstShortYM.slice(0, 4))) : -1);
      return {
        type: 'line',
        data: {
          labels: years.map(String),
          datasets: [
            lineDataset(c, `A:${a.name}`, 'A', c.series[0], valuesOf(a.result), shortIdx(a.result)),
            lineDataset(c, `B:${b.name}`, 'B', c.series[1], valuesOf(b.result), shortIdx(b.result)),
          ],
        },
        options: { ...lineOptions(c, (items) => (items.length ? `${years[items[0].dataIndex]}年末の総資産` : '')), spanGaps: false },
        plugins: [endLabels],
      };
    });
  }

  MT.futureCharts = { totals, stack, compare, destroy: C.destroy };
})(window);
