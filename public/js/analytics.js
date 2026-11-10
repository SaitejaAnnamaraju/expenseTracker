/* Analytics page: filters -> /api/analytics (real DB aggregates) + CSV export link. */
(function () {
  'use strict';
  const { $, $$, el, icon, icons, api, toast, fmtGBP, fmtDate } = window.App;
  const { renderMonthly, renderCategories, CAT_SLOT, monthLabel } = window.Charts;

  const form = $('#filter-form');
  const FIELDS = ['from', 'to', 'category', 'min', 'max', 'month'];
  const LABELS = { from: 'From', to: 'To', category: 'Category', min: 'Min', max: 'Max', month: 'Submitted' };
  let data = null;

  function currentParams() {
    const p = new URLSearchParams();
    FIELDS.forEach((k) => { const v = form.elements[k].value.trim(); if (v) p.set(k, v); });
    return p;
  }

  function validateFilters() {
    const g = (k) => form.elements[k].value.trim();
    if (g('from') && g('to') && g('from') > g('to')) return '“From date” must be on or before “To date”.';
    if (g('min') && (Number(g('min')) < 0 || Number.isNaN(Number(g('min'))))) return 'Minimum amount must be zero or more.';
    if (g('max') && (Number(g('max')) <= 0 || Number.isNaN(Number(g('max'))))) return 'Maximum amount must be greater than zero.';
    if (g('min') && g('max') && Number(g('min')) > Number(g('max'))) return 'Minimum amount cannot be greater than maximum amount.';
    return '';
  }

  function setStat(key, text) { $$(`[data-stat="${key}"]`).forEach((n) => { n.textContent = text; }); }
  function skeletons() {
    ['count', 'total', 'average', 'largest'].forEach((k) => $$(`[data-stat="${k}"]`).forEach((n) => n.replaceChildren(el('span', { class: 'skeleton sk-value' }))));
  }

  function renderChips(applied) {
    const host = $('#active-filters');
    const fmt = (k, v) => (k === 'from' || k === 'to' ? fmtDate(v) : k === 'min' || k === 'max' ? fmtGBP(v) : k === 'month' ? monthLabel(v, true) : v);
    const entries = Object.entries(applied);
    host.replaceChildren(...entries.map(([k, v]) => el('span', { class: 'badge badge-accent' }, icon('filter', 'icon icon-xs'), `${LABELS[k]}: ${fmt(k, v)}`)));
    if (!entries.length) host.replaceChildren(el('span', { class: 'hint', text: 'Showing all of your submitted expenses.' }));
    icons();
  }

  function renderTable(categories, total) {
    const tbody = $('#category-table tbody');
    const rows = categories.map((c) => {
      const pct = total ? (c.total / total) * 100 : 0;
      const fill = el('div', { class: `bar-fill sw-${CAT_SLOT[c.category]}` });
      requestAnimationFrame(() => { fill.style.width = `${pct.toFixed(1)}%`; });
      return el('tr', {},
        el('td', {}, el('span', { class: 'inline-actions' }, el('span', { class: `sw sw-${CAT_SLOT[c.category]} legend-sw` }), c.category)),
        el('td', { class: 'r', text: c.count.toLocaleString('en-GB') }),
        el('td', { class: 'r', text: fmtGBP(c.total) }),
        el('td', { class: 'r', text: c.count ? fmtGBP(c.total / c.count) : '—' }),
        el('td', {}, el('div', { class: 'bar-cell' }, el('div', { class: 'bar-track' }, fill), el('span', { class: 'pct num', text: `${pct.toFixed(0)}%` }))));
    });
    tbody.replaceChildren(...rows);
  }

  function render() {
    const s = data.summary;
    setStat('count', s.count.toLocaleString('en-GB'));
    setStat('total', fmtGBP(s.total));
    setStat('average', fmtGBP(s.average));
    setStat('largest', fmtGBP(s.largest));
    const filtered = Object.keys(data.filters).length > 0;
    const emptyOpts = filtered
      ? { emptyTitle: 'No matching expenses', emptyText: 'Try widening the date range or clearing some filters.' }
      : {};
    renderMonthly($('#monthly-box'), data.monthly, emptyOpts);
    renderCategories($('#category-body'), data.categories, emptyOpts);
    renderTable(data.categories, s.total);
    renderChips(data.filters);
  }

  async function load(push) {
    const err = validateFilters();
    $('#filter-error').textContent = err;
    if (err) { toast(err, 'error'); return; }
    const params = currentParams();
    const qs = params.toString();
    $('#export-btn').href = `/analytics/export.csv${qs ? `?${qs}` : ''}`;
    if (push) history.replaceState(null, '', `/analytics${qs ? `?${qs}` : ''}`);
    skeletons();
    try {
      data = await api(`/api/analytics${qs ? `?${qs}` : ''}`);
      render();
    } catch (e) {
      toast(`Could not load analytics: ${e.message}`, 'error');
    }
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); load(true); });
  $('#reset-filters').addEventListener('click', (e) => { e.preventDefault(); form.reset(); FIELDS.forEach((k) => { form.elements[k].value = ''; }); load(true); });
  // Selects apply immediately for a snappier feel.
  ['category', 'month'].forEach((k) => form.elements[k].addEventListener('change', () => load(true)));
  $('#export-btn').addEventListener('click', () => toast('Preparing your CSV export…', 'info', 2500));

  document.addEventListener('themechange', () => { if (data) render(); });
  load(false);
})();
