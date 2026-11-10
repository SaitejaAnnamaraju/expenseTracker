/* Shared UI behaviour: icons, theme, sidebar, toasts, confirm dialogs, form helpers. */
(function () {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const csrf = () => ($('meta[name="csrf-token"]') || {}).content || '';
  const icons = () => { if (window.lucide) window.lucide.createIcons(); };

  const gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });
  const gbpShort = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', notation: 'compact', maximumFractionDigits: 1 });
  const fmtGBP = (n) => gbp.format(Number(n) || 0);
  const fmtGBPShort = (n) => (Math.abs(n) >= 10000 ? gbpShort.format(n) : fmtGBP(n));

  /** Build DOM nodes safely (text only - never innerHTML with data). */
  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    });
    children.flat().forEach((c) => { if (c !== null && c !== undefined && c !== false) node.append(c.nodeType ? c : document.createTextNode(String(c))); });
    return node;
  }
  const icon = (name, cls = 'icon icon-sm') => el('i', { 'data-lucide': name, class: cls });

  // ------------------------------------------------------------- Theme
  function syncThemeUI() {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    // toggleAttribute (not .hidden): Lucide renders these as <svg>, which has no .hidden property.
    $$('.theme-icon-dark').forEach((i) => i.toggleAttribute('hidden', dark));
    $$('.theme-icon-light').forEach((i) => i.toggleAttribute('hidden', !dark));
    $$('.theme-label').forEach((l) => { l.textContent = dark ? 'Light mode' : 'Dark mode'; });
  }
  function setTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('theme', t); } catch (e) { /* ignore */ }
    syncThemeUI();
    document.dispatchEvent(new CustomEvent('themechange', { detail: t }));
  }
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-theme-toggle]')) {
      setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    }
  });

  // ------------------------------------------------------------- Mobile sidebar
  const shell = $('#shell');
  document.addEventListener('click', (e) => {
    if (!shell) return;
    if (e.target.closest('[data-nav-open]')) shell.classList.add('nav-open');
    else if (e.target.closest('[data-nav-close]')) shell.classList.remove('nav-open');
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && shell) shell.classList.remove('nav-open'); });
  const topbar = $('#topbar');
  if (topbar) window.addEventListener('scroll', () => topbar.classList.toggle('scrolled', window.scrollY > 4), { passive: true });

  // ------------------------------------------------------------- Toasts
  const TOAST_ICON = { success: 'check', error: 'x', info: 'info' };
  function toast(message, type = 'info', ms = 4500) {
    const host = $('#toasts');
    if (!host) return;
    const close = () => { t.classList.add('leaving'); setTimeout(() => t.remove(), 200); };
    const t = el('div', { class: `toast ${type}`, role: type === 'error' ? 'alert' : 'status' },
      el('span', { class: 't-icon' }, icon(TOAST_ICON[type] || 'info', 'icon icon-xs')),
      el('div', { class: 't-body', text: message }),
      el('button', { class: 't-close', type: 'button', 'aria-label': 'Dismiss', onclick: close }, icon('x', 'icon icon-xs')));
    host.append(t);
    icons();
    if (ms) setTimeout(close, ms);
  }

  // ------------------------------------------------------------- Confirm dialog
  /** Promise-based accessible modal. Resolves true/false. */
  function confirmDialog({ title, text, ok = 'Confirm', cancel = 'Cancel', danger = false, iconName = 'triangle-alert' }) {
    return new Promise((resolve) => {
      const prevFocus = document.activeElement;
      const done = (v) => { backdrop.remove(); document.removeEventListener('keydown', onKey); if (prevFocus) prevFocus.focus(); resolve(v); };
      const okBtn = el('button', { type: 'button', class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, text: ok, onclick: () => done(true) });
      const cancelBtn = el('button', { type: 'button', class: 'btn', text: cancel, onclick: () => done(false) });
      const modal = el('div', { class: 'modal', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'm-title', 'aria-describedby': 'm-text' },
        el('div', { class: `m-icon ${danger ? 'danger' : ''}` }, icon(iconName, 'icon')),
        el('h3', { id: 'm-title', text: title }),
        text ? el('p', { id: 'm-text', text }) : null,
        el('div', { class: 'm-actions' }, cancelBtn, okBtn));
      const backdrop = el('div', { class: 'modal-backdrop', onclick: (e) => { if (e.target === backdrop) done(false); } }, modal);
      const onKey = (e) => {
        if (e.key === 'Escape') done(false);
        if (e.key === 'Tab') { // focus trap
          const f = [cancelBtn, okBtn];
          const i = f.indexOf(document.activeElement);
          e.preventDefault();
          f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
        }
      };
      document.addEventListener('keydown', onKey);
      document.body.append(backdrop);
      icons();
      okBtn.focus();
    });
  }

  // Forms/links with data-confirm ask first.
  document.addEventListener('submit', async (e) => {
    const form = e.target;
    if (!form.matches('[data-confirm]') || form.dataset.confirmed) return;
    e.preventDefault();
    const yes = await confirmDialog({
      title: form.dataset.confirm, text: form.dataset.confirmText, ok: form.dataset.confirmOk || 'Confirm',
      danger: form.hasAttribute('data-confirm-danger'), iconName: form.hasAttribute('data-confirm-danger') ? 'trash-2' : 'log-out',
    });
    if (yes) { form.dataset.confirmed = '1'; form.requestSubmit ? form.requestSubmit() : form.submit(); }
  }, true);

  // ------------------------------------------------------------- Password show/hide + strength
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-toggle-password]');
    if (!btn) return;
    const input = document.getElementById(btn.dataset.togglePassword);
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.setAttribute('aria-pressed', String(show));
    btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    btn.replaceChildren(icon(show ? 'eye-off' : 'eye'));
    icons();
    input.focus();
  });

  $$('[data-strength]').forEach((input) => {
    const bar = document.getElementById(input.dataset.strength);
    input.addEventListener('input', () => {
      const v = input.value;
      let s = 0;
      if (v.length >= 8) s++;
      if (v.length >= 12) s++;
      if (/[a-z]/.test(v) && /[A-Z]/.test(v)) s++;
      if (/\d/.test(v)) s++;
      if (/[^A-Za-z0-9]/.test(v)) s++;
      const pct = v ? Math.max(10, (s / 5) * 100) : 0;
      bar.style.width = `${pct}%`;
      bar.style.background = s <= 2 ? 'var(--danger)' : s === 3 ? 'var(--warning)' : 'var(--success)';
    });
  });

  // ------------------------------------------------------------- Classic form validation + loading state
  function setFieldError(input, msg) {
    const field = input.closest('.field');
    input.classList.toggle('invalid', Boolean(msg));
    input.setAttribute('aria-invalid', msg ? 'true' : 'false');
    let p = field && field.querySelector('.error-text.client');
    if (msg) {
      if (!p && field) { p = el('p', { class: 'error-text client' }); field.append(p); }
      if (p) p.textContent = msg;
    } else if (p) p.remove();
  }

  function validateInput(input) {
    const v = input.type === 'checkbox' ? input.checked : input.value.trim();
    let msg = '';
    if (input.required && !v) msg = input.type === 'checkbox' ? 'This box must be checked.' : 'This field is required.';
    else if (input.minLength > 0 && v && input.value.length < input.minLength) msg = `Must be at least ${input.minLength} characters.`;
    else if (input.type === 'email' && v && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) msg = 'Please enter a valid email address.';
    else if (input.pattern && v && !new RegExp(`^(?:${input.pattern})$`).test(v)) msg = 'Please use only the allowed characters.';
    else if (input.dataset.strength && v && (!/[A-Za-z]/.test(v) || !/\d/.test(v))) msg = 'Include at least one letter and one number.';
    else if (input.dataset.match && v !== document.getElementById(input.dataset.match).value) msg = 'Passwords do not match.';
    setFieldError(input, msg);
    return !msg;
  }

  $$('form[data-validate]').forEach((form) => {
    form.addEventListener('submit', (e) => {
      const inputs = $$('input:not([type=hidden]):not([disabled]), select, textarea', form);
      const okAll = inputs.map(validateInput).every(Boolean);
      if (!okAll) {
        e.preventDefault();
        const first = inputs.find((i) => i.classList.contains('invalid'));
        if (first) first.focus();
        return;
      }
      const btn = form.querySelector('button[type=submit]');
      if (btn) setLoading(btn, true);
    });
    $$('input, select, textarea', form).forEach((i) => i.addEventListener('blur', () => { if (i.value) validateInput(i); }));
  });

  function setLoading(btn, on) {
    btn.disabled = on;
    btn.classList.toggle('is-loading', on);
    btn.setAttribute('aria-busy', String(on));
    const label = btn.querySelector('.btn-label');
    if (label) {
      if (on) { btn.dataset.label = label.textContent; label.textContent = btn.dataset.loadingText || 'Working…'; }
      else if (btn.dataset.label) label.textContent = btn.dataset.label;
    }
  }

  // ------------------------------------------------------------- JSON fetch helper
  async function api(url, opts = {}) {
    const res = await fetch(url, {
      credentials: 'same-origin',
      ...opts,
      headers: { Accept: 'application/json', 'X-CSRF-Token': csrf(), ...(opts.headers || {}) },
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* non-JSON */ }
    if (res.status === 401) { toast('Your session has expired. Redirecting to sign in…', 'error'); setTimeout(() => { location.href = '/login'; }, 1200); }
    if (!res.ok) {
      const err = new Error((data && data.error) || `Request failed (${res.status})`);
      err.status = res.status; err.data = data;
      throw err;
    }
    return data;
  }

  // ------------------------------------------------------------- Relative time
  const rtf = new Intl.RelativeTimeFormat('en-GB', { numeric: 'auto' });
  function relTime(utcString) {
    const d = new Date(String(utcString).replace(' ', 'T') + 'Z');
    const s = Math.round((d - Date.now()) / 1000);
    const abs = Math.abs(s);
    if (abs < 45) return 'just now';
    if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute');
    if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour');
    if (abs < 86400 * 7) return rtf.format(Math.round(s / 86400), 'day');
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  const fmtDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  // ------------------------------------------------------------- Boot
  icons();
  syncThemeUI();
  const flashNode = $('#flash-data');
  if (flashNode) {
    try { const f = JSON.parse(flashNode.textContent); toast(f.message, f.type); } catch (e) { /* ignore */ }
  }
  if (new URLSearchParams(location.search).get('signedout') === '1') {
    toast('You have been signed out.', 'success');
    history.replaceState(null, '', location.pathname);
  }

  window.App = { $, $$, el, icon, icons, toast, confirm: confirmDialog, api, csrf, fmtGBP, fmtGBPShort, setLoading, relTime, fmtDate, setFieldError };
})();
