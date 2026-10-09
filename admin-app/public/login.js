(async () => {
  const $ = selector => document.querySelector(selector);
  const errorBox = $('[data-error]');
  const okBox = $('[data-ok]');
  const show = (box, message) => { errorBox.hidden = okBox.hidden = true; if (message) { box.textContent = message; box.hidden = false; } };

  const params = new URLSearchParams(location.search);
  if (params.get('error')) show(errorBox, params.get('error'));

  const options = await fetch('/auth/options').then(r => r.json()).catch(() => ({ password: true }));
  $('[data-google]').hidden = !options.google;
  const emailMethods = ['link', 'password'].filter(m => (m === 'link' ? options.emailLink : options.password));
  $('[data-divider]').hidden = !(options.google && emailMethods.length);
  $('[data-tabs]').hidden = emailMethods.length < 2;
  $('[data-forgot]').hidden = !options.emailLink;

  const selectTab = name => {
    document.querySelectorAll('[data-tab]').forEach(tab => tab.setAttribute('aria-selected', String(tab.dataset.tab === name)));
    document.querySelectorAll('[data-form]').forEach(form => { form.hidden = form.dataset.form !== name; });
  };
  document.querySelectorAll('[data-tab]').forEach(tab => tab.addEventListener('click', () => selectTab(tab.dataset.tab)));
  if (emailMethods.length) selectTab(emailMethods[0]);

  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(async r => ({ ok: r.ok, data: await r.json().catch(() => ({})) }));

  $('[data-form="link"]').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.target.querySelector('button[type=submit]');
    button.disabled = true;
    const { ok, data } = await post('/auth/link', { email: event.target.email.value });
    button.disabled = false;
    show(ok ? okBox : errorBox, ok ? data.message : data.error || 'Something went wrong.');
  });

  $('[data-form="password"]').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.target.querySelector('button[type=submit]');
    button.disabled = true;
    const { ok, data } = await post('/auth/password', { email: event.target.email.value, password: event.target.password.value });
    button.disabled = false;
    if (!ok) return show(errorBox, data.error || 'Sign-in failed.');
    location.href = data.mustSetPassword ? '/#/account?first=1' : '/';
  });

  $('[data-forgot]').addEventListener('click', async () => {
    const email = $('#pw-email').value.trim();
    if (!email) return show(errorBox, 'Enter your email above first, then click “Forgot your password?”.');
    const { ok, data } = await post('/auth/link', { email, purpose: 'reset' });
    show(ok ? okBox : errorBox, ok ? 'If that email is on the team, a password-reset link is on its way.' : data.error);
  });
})();
