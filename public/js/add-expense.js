/* Add Expense page (Feature 1). */
(function () {
  'use strict';
  const { $, $$, el, icon, icons, toast, confirm, api, fmtGBP, setLoading, fmtDate } = window.App;

  const form = $('#expense-form');
  if (!form) return;

  const MAX_BYTES = Number(form.dataset.maxBytes);
  const MAX_AMOUNT = Number(form.dataset.maxAmount);
  const RECEIPT_REQUIRED = form.dataset.receiptRequired === '1';
  const ALLOWED_EXT = ['jpg', 'jpeg', 'png', 'pdf'];
  const ALLOWED_MIME = ['image/jpeg', 'image/png', 'application/pdf'];

  const f = {
    date: $('#expense_date'), category: $('#category'), label: $('#label'), amount: $('#amount'),
    description: $('#description'), receipt: $('#receipt'), token: $('#form_token'),
  };
  const submitBtn = $('#submit-btn');
  let selectedFile = null;
  let previewUrl = null;
  let dirty = false;
  let submitting = false;

  // ----------------------------------------------------------- Errors
  function showError(name, msg) {
    const p = $(`[data-error-for="${name}"]`);
    const input = name === 'receipt' ? $('#dropzone') : f[name === 'expense_date' ? 'date' : name];
    if (p) { p.textContent = msg || ''; p.hidden = !msg; }
    if (input) {
      input.classList.toggle('invalid', Boolean(msg));
      if (input.setAttribute) input.setAttribute('aria-invalid', msg ? 'true' : 'false');
    }
  }
  function clearErrors() {
    $$('[data-error-for]').forEach((p) => { p.hidden = true; p.textContent = ''; });
    $$('.invalid', form).forEach((i) => i.classList.remove('invalid'));
    $('#form-alert').hidden = true;
  }
  function showAlert(msg) { $('#form-alert-text').textContent = msg; $('#form-alert').hidden = false; }

  // ----------------------------------------------------------- Validation (mirrors the server)
  function todayLocal() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  const validators = {
    expense_date() {
      const v = f.date.value;
      if (!v) return 'Please choose the date of the expense.';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) return 'Please choose a valid date.';
      if (v > f.date.max) return 'Expense date cannot be in the future.';
      if (v < f.date.min) return 'Expense date is too far in the past.';
      return '';
    },
    category() { return f.category.value ? '' : 'Please select a category.'; },
    label() {
      const v = f.label.value.trim();
      if (!v) return 'Expense label is required.';
      if (v.length > 120) return 'Label must be 120 characters or fewer.';
      return '';
    },
    amount() {
      const v = f.amount.value.trim().replace(/,/g, '');
      if (!v) return 'Please enter the amount.';
      if (v.startsWith('-')) return 'Amount cannot be negative.';
      if (!/^\d{1,7}(\.\d{1,2})?$/.test(v)) return 'Enter a valid amount, e.g. 24.99 (max 2 decimal places).';
      const n = Number(v);
      if (n <= 0) return 'Amount must be greater than £0.00.';
      if (n > MAX_AMOUNT) return `Amount cannot exceed ${fmtGBP(MAX_AMOUNT)}.`;
      return '';
    },
    description() { return f.description.value.length > 5000 ? 'Description must be 5,000 characters or fewer.' : ''; },
    receipt() { return RECEIPT_REQUIRED && !selectedFile ? 'Please attach a receipt.' : ''; },
  };
  function validateAll() {
    let firstBad = null;
    Object.keys(validators).forEach((k) => {
      const msg = validators[k]();
      showError(k, msg);
      if (msg && !firstBad) firstBad = k;
    });
    return firstBad;
  }

  // ----------------------------------------------------------- Live summary + counters
  function updateSummary() {
    const amt = Number(f.amount.value.replace(/,/g, ''));
    $('#sum-amount').textContent = fmtGBP(Number.isFinite(amt) && amt > 0 ? amt : 0);
    $('#sum-label').textContent = f.label.value.trim() || 'Untitled expense';
    $('#sum-date').textContent = f.date.value ? fmtDate(f.date.value) : '—';
    $('#sum-category').textContent = f.category.value || '—';
    $('#sum-receipt').textContent = selectedFile ? 'Attached' : 'None';
    $$('[data-counter-for]').forEach((c) => {
      const input = $(`#${c.dataset.counterFor}`);
      c.textContent = `${input.value.length.toLocaleString('en-GB')} / ${Number(input.maxLength).toLocaleString('en-GB')}`;
    });
  }

  form.addEventListener('input', (e) => {
    dirty = true;
    updateSummary();
    const name = e.target.name;
    // Re-validate a field only once it has been flagged, so users aren't nagged while typing.
    if (name && validators[name] && e.target.classList.contains('invalid')) showError(name, validators[name]());
  });
  ['date', 'category', 'label', 'amount'].forEach((k) => {
    f[k].addEventListener('blur', () => { if (f[k].value) showError(f[k].name, validators[f[k].name]()); });
  });
  f.category.addEventListener('change', () => showError('category', validators.category()));
  f.date.addEventListener('change', () => showError('expense_date', validators.expense_date()));

  // Amount: keep only digits and one dot, max 2 decimals; normalise on blur.
  f.amount.addEventListener('input', () => {
    let v = f.amount.value.replace(/[^\d.]/g, '');
    const i = v.indexOf('.');
    if (i !== -1) v = v.slice(0, i + 1) + v.slice(i + 1).replace(/\./g, '').slice(0, 2);
    if (v !== f.amount.value) f.amount.value = v;
  });
  f.amount.addEventListener('keydown', (e) => { if (e.key === '-' || e.key === 'e' || e.key === 'E' || e.key === '+') e.preventDefault(); });
  f.amount.addEventListener('blur', () => {
    const v = f.amount.value;
    if (/^\d+(\.\d{0,2})?$/.test(v) && Number(v) > 0) f.amount.value = Number(v).toFixed(2);
    updateSummary();
  });

  // ----------------------------------------------------------- Markdown editor + sanitised preview
  const preview = $('#md-preview');
  const toolbar = $('[data-md-toolbar]');
  if (window.marked) window.marked.setOptions({ gfm: true, breaks: true });

  function renderPreview() {
    const src = f.description.value.trim();
    if (!src) { preview.classList.add('empty'); preview.textContent = 'Nothing to preview yet.'; return; }
    preview.classList.remove('empty');
    const html = window.marked ? window.marked.parse(src) : src;
    // DOMPurify strips scripts, event handlers, javascript: URLs, iframes, styles, etc.
    const clean = window.DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ['style', 'img', 'iframe', 'form', 'input', 'button'],
      FORBID_ATTR: ['style'],
    });
    preview.innerHTML = clean;
    $$('a', preview).forEach((a) => { a.target = '_blank'; a.rel = 'noopener noreferrer nofollow'; });
  }

  $$('[data-md-tab]').forEach((tab) => tab.addEventListener('click', () => {
    const isPreview = tab.dataset.mdTab === 'preview';
    $$('[data-md-tab]').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
    if (isPreview) renderPreview();
    preview.hidden = !isPreview;
    f.description.hidden = isPreview;
    toolbar.hidden = isPreview;
    if (!isPreview) f.description.focus();
  }));

  const MD = {
    bold: ['**', '**', 'bold text'], italic: ['*', '*', 'italic text'], code: ['`', '`', 'code'],
    link: ['[', '](https://)', 'link text'], ul: ['- ', '', 'List item'], ol: ['1. ', '', 'List item'],
  };
  toolbar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-md]');
    if (!b) return;
    const [pre, post, placeholder] = MD[b.dataset.md];
    const ta = f.description;
    const { selectionStart: s, selectionEnd: en, value } = ta;
    const sel = value.slice(s, en) || placeholder;
    const lineStart = (b.dataset.md === 'ul' || b.dataset.md === 'ol') && s > 0 && value[s - 1] !== '\n' ? '\n' : '';
    ta.setRangeText(lineStart + pre + sel + post, s, en, 'end');
    ta.focus();
    ta.setSelectionRange(s + lineStart.length + pre.length, s + lineStart.length + pre.length + sel.length);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });

  // ----------------------------------------------------------- Receipt upload
  const dz = $('#dropzone');
  const card = $('#file-card');
  const fmtSize = (b) => (b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1024 / 1024).toFixed(2)} MB`);

  function checkFile(file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!ALLOWED_EXT.includes(ext) || (file.type && !ALLOWED_MIME.includes(file.type))) {
      return 'Unsupported file type. Please upload a JPG, JPEG, PNG or PDF.';
    }
    if (file.size === 0) return 'This file is empty.';
    if (file.size > MAX_BYTES) return `File is too large (${fmtSize(file.size)}). Maximum size is ${fmtSize(MAX_BYTES)}.`;
    return '';
  }

  function setFile(file) {
    const err = checkFile(file);
    if (err) { showError('receipt', err); toast(err, 'error'); f.receipt.value = ''; return; }
    showError('receipt', '');
    selectedFile = file;
    dirty = true;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;

    const isImage = file.type.startsWith('image/');
    const thumb = $('#file-thumb');
    thumb.replaceChildren();
    if (isImage) {
      previewUrl = URL.createObjectURL(file);
      thumb.append(el('img', { src: previewUrl, alt: '' }));
      $('#receipt-preview-img').src = previewUrl;
      $('#receipt-preview').hidden = false;
    } else {
      thumb.append(icon('file-text', 'icon'));
      $('#receipt-preview').hidden = true;
    }
    $('#file-name').textContent = file.name;
    $('#file-info').textContent = `${isImage ? 'Image' : 'PDF document'} · ${fmtSize(file.size)}`;
    card.hidden = false;
    dz.hidden = true;
    icons();
    updateSummary();
  }

  function clearFile() {
    selectedFile = null;
    f.receipt.value = '';
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    $('#receipt-preview').hidden = true;
    $('#receipt-preview-img').removeAttribute('src');
    card.hidden = true;
    dz.hidden = false;
    updateSummary();
  }

  dz.addEventListener('click', () => f.receipt.click());
  dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); f.receipt.click(); } });
  f.receipt.addEventListener('change', () => { if (f.receipt.files[0]) setFile(f.receipt.files[0]); });
  ['dragenter', 'dragover'].forEach((t) => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.add('dragover'); }));
  ['dragleave', 'dragend', 'drop'].forEach((t) => dz.addEventListener(t, () => dz.classList.remove('dragover')));
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files.length > 1) toast('Only one receipt can be attached; using the first file.', 'info');
    if (files[0]) setFile(files[0]);
  });
  // Prevent the browser from navigating away if a file is dropped outside the zone.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());
  $('#replace-file').addEventListener('click', () => f.receipt.click());
  $('#remove-file').addEventListener('click', () => { clearFile(); toast('Receipt removed.', 'info', 2500); });

  // ----------------------------------------------------------- Submit
  function resetForm() {
    form.reset();
    f.date.value = f.date.max;           // back to today
    f.category.selectedIndex = 0;
    clearFile();
    clearErrors();
    preview.hidden = true; f.description.hidden = false; toolbar.hidden = false;
    $$('[data-md-tab]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.mdTab === 'write')));
    dirty = false;
    updateSummary();
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submitting) return;               // duplicate-click guard (server enforces it too)
    clearErrors();
    const bad = validateAll();
    if (bad) {
      showAlert('Please correct the highlighted fields before submitting.');
      const target = bad === 'receipt' ? dz : f[bad === 'expense_date' ? 'date' : bad];
      target.focus();
      return;
    }

    const fd = new FormData();
    fd.append('form_token', f.token.value);
    fd.append('expense_date', f.date.value);
    fd.append('category', f.category.value);
    fd.append('label', f.label.value.trim());
    fd.append('amount', f.amount.value.trim());
    fd.append('description', f.description.value);
    if (selectedFile) fd.append('receipt', selectedFile, selectedFile.name);

    submitting = true;
    setLoading(submitBtn, true);
    form.setAttribute('aria-busy', 'true');
    try {
      const data = await api('/expenses', { method: 'POST', body: fd });
      f.token.value = data.formToken;
      dirty = false;
      const x = data.expense;
      toast('Expense submitted successfully.', 'success');
      showSuccess(x);
    } catch (err) {
      const d = err.data || {};
      if (d.formToken) f.token.value = d.formToken;
      if (d.errors) Object.entries(d.errors).forEach(([k, m]) => showError(k, m));
      if (d.code === 'DUPLICATE_SUBMISSION') {
        toast(err.message, 'error', 7000);
        showAlert(err.message);
      } else if (err.status !== 401) {
        showAlert(err.message || 'Submission failed. Please try again.');
        toast(err.message || 'Submission failed. Please try again.', 'error');
      }
    } finally {
      submitting = false;
      setLoading(submitBtn, false);
      form.removeAttribute('aria-busy');
    }
  });

  async function showSuccess(x) {
    // Simple, accessible success dialog with the stored record's key facts.
    const backdrop = el('div', { class: 'modal-backdrop' });
    const close = (go) => { backdrop.remove(); if (go) location.href = go; };
    const addAnother = el('button', { type: 'button', class: 'btn', onclick: () => { close(); resetForm(); f.date.focus(); } }, icon('plus'), 'Add another');
    const toDash = el('button', { type: 'button', class: 'btn btn-primary', onclick: () => close('/dashboard') }, 'Go to dashboard');
    const row = (k, v) => [el('dt', { text: k }), el('dd', { text: v })];
    backdrop.append(el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ok-title', 'data-testid': 'success-modal' },
      el('div', { class: 'm-icon ok' }, icon('circle-check', 'icon')),
      el('h3', { id: 'ok-title', text: 'Expense submitted' }),
      el('p', { text: 'Your expense has been saved and is awaiting review.' }),
      el('dl', { class: 'summary-list' },
        row('Reference', `#${String(x.id).padStart(5, '0')}`),
        row('Label', x.label),
        row('Amount', fmtGBP(x.amount)),
        row('Category', x.category),
        row('Expense date', fmtDate(x.expense_date)),
        row('Receipt', x.hasReceipt ? 'Attached' : 'Not attached'),
        row('Status', x.status)),
      el('div', { class: 'm-actions' }, addAnother, toDash)));
    backdrop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { close(); resetForm(); } });
    document.body.append(backdrop);
    icons();
    toDash.focus();
  }

  // ----------------------------------------------------------- Cancel / leave guard
  $('#cancel-btn').addEventListener('click', async (e) => {
    if (!dirty) return;
    e.preventDefault();
    const href = e.currentTarget.href;
    const yes = await confirm({
      title: 'Discard this expense?', text: 'The details you have entered and any attached receipt will be lost.',
      ok: 'Discard', cancel: 'Keep editing', danger: true, iconName: 'trash-2',
    });
    if (yes) { dirty = false; location.href = href; }
  });
  window.addEventListener('beforeunload', (e) => { if (dirty && !submitting) { e.preventDefault(); e.returnValue = ''; } });

  updateSummary();
})();
