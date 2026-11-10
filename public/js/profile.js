/* Profile page: avatar upload with client-side checks. */
(function () {
  'use strict';
  const { $, toast, api, setLoading } = window.App;

  const input = $('#avatar-input');
  const btn = $('#avatar-btn');
  const errorEl = $('#avatar-error');
  const MAX = 2 * 1024 * 1024;
  const OK = ['image/jpeg', 'image/png', 'image/webp'];

  function showErr(msg) { errorEl.textContent = msg; errorEl.hidden = !msg; }

  btn.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    showErr('');
    if (!OK.includes(file.type)) { showErr('Please choose a JPG, PNG or WebP image.'); input.value = ''; return; }
    if (file.size > MAX) { showErr('Image is too large. Maximum size is 2 MB.'); input.value = ''; return; }

    const fd = new FormData();
    fd.append('avatar', file, file.name);
    setLoading(btn, true);
    try {
      await api('/profile/avatar', { method: 'POST', body: fd });
      toast('Profile picture updated.', 'success');
      setTimeout(() => location.reload(), 600);
    } catch (e) {
      showErr(e.message);
      toast(e.message, 'error');
    } finally {
      setLoading(btn, false);
      input.value = '';
    }
  });

  if ($('#password-form .invalid')) $('#password-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
})();
