/* Shared chart rendering (Chart.js) for the dashboard and analytics pages. */
(function () {
  'use strict';
  const { el, icon, icons, fmtGBP, fmtGBPShort } = window.App;

  // Fixed category -> colour slot mapping (colour follows the entity, never its rank).
  const CAT_SLOT = { Travel: 1, 'Food & Drink': 2, Accommodation: 3, Other: 4 };
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const monthLabel = (ym, long) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: long ? 'long' : 'short', year: long ? 'numeric' : '2-digit', timeZone: 'UTC' });

  const charts = new Map();
  function mount(container, key, config) {
    if (charts.has(key)) charts.get(key).destroy();
    const canvas = el('canvas', { role: 'img', 'aria-label': config.ariaLabel || '' });
    container.replaceChildren(canvas);
    const chart = new window.Chart(canvas, config);
    charts.set(key, chart);
    return chart;
  }

  function baseOptions() {
    const text3 = css('--text-3');
    window.Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    window.Chart.defaults.font.size = 12;
    window.Chart.defaults.color = text3;
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 600, easing: 'easeOutQuart' },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: css('--surface'), titleColor: css('--text'), bodyColor: css('--text-2'),
          borderColor: css('--border'), borderWidth: 1, padding: 10, cornerRadius: 8, displayColors: true,
          boxPadding: 4, usePointStyle: true,
        },
      },
    };
  }

  function emptyState(container, title, text) {
    container.replaceChildren(el('div', { class: 'empty' },
      el('span', { class: 'empty-icon' }, icon('chart-no-axes-column', 'icon')),
      el('strong', { text: title }), el('p', { text }),
      el('a', { class: 'btn btn-primary btn-sm', href: '/expenses/new' }, icon('plus'), 'Add Expense')));
    icons();
  }

  /** Monthly totals - single series bar chart. */
  function renderMonthly(container, monthly, { emptyTitle, emptyText } = {}) {
    if (!monthly.length || monthly.every((m) => m.total === 0)) {
      emptyState(container, emptyTitle || 'No spending to chart yet', emptyText || 'Submit your first expense to see monthly trends.');
      return;
    }
    const opts = baseOptions();
    const grid = css('--chart-grid');
    mount(container, 'monthly', {
      type: 'bar',
      ariaLabel: `Monthly spending: ${monthly.map((m) => `${monthLabel(m.month, true)} ${fmtGBP(m.total)}`).join(', ')}`,
      data: {
        labels: monthly.map((m) => monthLabel(m.month)),
        datasets: [{
          label: 'Total spent', data: monthly.map((m) => m.total), counts: monthly.map((m) => m.count),
          backgroundColor: css('--cat-1'), hoverBackgroundColor: css('--accent'),
          borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: 'bottom', maxBarThickness: 32, categoryPercentage: 0.7,
        }],
      },
      options: {
        ...opts,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { grid: { display: false }, border: { color: grid }, ticks: { maxRotation: 0, autoSkipPadding: 12 } },
          y: { beginAtZero: true, grid: { color: grid }, border: { display: false }, ticks: { maxTicksLimit: 5, callback: (v) => fmtGBPShort(v) } },
        },
        plugins: {
          ...opts.plugins,
          tooltip: {
            ...opts.plugins.tooltip,
            callbacks: {
              title: (items) => monthLabel(monthly[items[0].dataIndex].month, true),
              label: (ctx) => ` ${fmtGBP(ctx.parsed.y)}`,
              afterLabel: (ctx) => ` ${ctx.dataset.counts[ctx.dataIndex]} expense${ctx.dataset.counts[ctx.dataIndex] === 1 ? '' : 's'}`,
            },
          },
        },
      },
    });
  }

  /** Category doughnut + legend list that doubles as the data table. */
  function renderCategories(container, categories, { emptyTitle, emptyText } = {}) {
    const total = categories.reduce((s, c) => s + c.total, 0);
    if (total === 0) {
      emptyState(container, emptyTitle || 'No categories yet', emptyText || 'Your spending split by category will appear here.');
      return;
    }
    const colors = categories.map((c) => css(`--cat-${CAT_SLOT[c.category]}`));
    const canvasHost = el('div', { class: 'donut-box' });
    const center = el('div', { class: 'donut-center' }, el('div', {}, el('strong', { text: fmtGBPShort(total) }), el('span', { text: 'Total' })));
    const legend = el('ul', { class: 'legend', 'aria-label': 'Category totals' },
      categories.map((c) => el('li', {},
        el('span', { class: `sw sw-${CAT_SLOT[c.category]}` }),
        el('span', { text: c.category }),
        el('span', { class: 'val', text: fmtGBP(c.total) }),
        el('span', { class: 'pct', text: `${total ? Math.round((c.total / total) * 100) : 0}%` }))));
    container.replaceChildren(el('div', { class: 'donut-wrap' }, canvasHost, legend));
    const opts = baseOptions();
    mount(canvasHost, 'category', {
      type: 'doughnut',
      ariaLabel: `Spending by category: ${categories.map((c) => `${c.category} ${fmtGBP(c.total)}`).join(', ')}`,
      data: {
        labels: categories.map((c) => c.category),
        datasets: [{
          data: categories.map((c) => c.total), counts: categories.map((c) => c.count),
          backgroundColor: colors, borderColor: css('--surface'), borderWidth: 2, hoverOffset: 4,
        }],
      },
      options: {
        ...opts,
        cutout: '70%',
        plugins: {
          ...opts.plugins,
          tooltip: {
            ...opts.plugins.tooltip,
            callbacks: {
              label: (ctx) => ` ${ctx.label}: ${fmtGBP(ctx.parsed)} (${Math.round((ctx.parsed / total) * 100)}%)`,
              afterLabel: (ctx) => ` ${ctx.dataset.counts[ctx.dataIndex]} expense${ctx.dataset.counts[ctx.dataIndex] === 1 ? '' : 's'}`,
            },
          },
        },
      },
    });
    canvasHost.append(center);
  }

  window.Charts = { renderMonthly, renderCategories, CAT_SLOT, monthLabel };
})();
