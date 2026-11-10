/* Dashboard: summary cards, charts and recent activity from /api/dashboard. */
(function () {
  'use strict';
  const { $, $$, el, icon, icons, api, toast, fmtGBP, relTime } = window.App;
  const { renderMonthly, renderCategories } = window.Charts;

  const h = new Date().getHours();
  $('#greeting').textContent = h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';

  const ACT_ICON = {
    expense_submitted: ['receipt', 'ok'], login: ['log-in', 'acc'], logout: ['log-out', ''], register: ['sparkles', 'acc'],
    profile_updated: ['user-pen', 'acc'], password_changed: ['key-round', 'acc'], avatar_updated: ['image', 'acc'],
    avatar_removed: ['image-off', ''], csv_export: ['download', 'acc'],
  };

  let data = null;

  function setStat(key, text) { $$(`[data-stat="${key}"]`).forEach((n) => { n.textContent = text; }); }

  function renderActivity(items) {
    const body = $('#activity-body');
    if (!items.length) {
      body.replaceChildren(el('div', { class: 'empty' }, el('span', { class: 'empty-icon' }, icon('activity', 'icon')),
        el('strong', { text: 'No activity yet' }), el('p', { text: 'Sign-ins, submissions and profile changes will show up here.' })));
    } else {
      body.replaceChildren(el('ul', { class: 'activity' }, items.map((a) => {
        const [ic, tone] = ACT_ICON[a.action] || ['circle', ''];
        return el('li', {},
          el('span', { class: `act-icon ${tone}` }, icon(ic)),
          el('div', { class: 'act-body' }, el('strong', { text: a.title }), a.details ? el('span', { text: a.details }) : null),
          el('time', { class: 'act-time', datetime: `${a.created_at.replace(' ', 'T')}Z`, title: new Date(`${a.created_at.replace(' ', 'T')}Z`).toLocaleString('en-GB'), text: relTime(a.created_at) }));
      })));
    }
    icons();
  }

  function render() {
    const s = data.summary;
    setStat('count', s.count.toLocaleString('en-GB'));
    setStat('total', fmtGBP(s.total));
    setStat('thisMonthCount', s.thisMonthCount.toLocaleString('en-GB'));
    setStat('thisMonthTotal', `${fmtGBP(s.thisMonthTotal)} submitted this month`);
    setStat('average', fmtGBP(s.average));
    setStat('largest', s.count ? `Largest: ${fmtGBP(s.largest)}` : 'No expenses yet');
    renderMonthly($('#monthly-box'), data.monthly);
    renderCategories($('#category-body'), data.categories);
    renderActivity(data.activity);
  }

  api('/api/dashboard')
    .then((d) => { data = d; render(); })
    .catch((e) => {
      toast(`Could not load dashboard data: ${e.message}`, 'error');
      ['count', 'total', 'thisMonthCount', 'average'].forEach((k) => setStat(k, '—'));
      $('#monthly-box').replaceChildren(el('div', { class: 'empty' }, el('strong', { text: 'Unable to load chart' }), el('p', { text: 'Please refresh the page.' })));
    });

  // Re-draw charts with the new palette when the theme changes.
  document.addEventListener('themechange', () => { if (data) { renderMonthly($('#monthly-box'), data.monthly); renderCategories($('#category-body'), data.categories); } });
})();
