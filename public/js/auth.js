// Admin sign-in. The session token is kept on the device, so after signing in once
// the app keeps opening and working offline. Signing in itself needs the server.
const Auth = (() => {
  const $ = id => document.getElementById(id);
  let waiting = null, waitP = null;

  async function status() {
    const res = await fetch('/api/auth-status', { signal: AbortSignal.timeout(6000), cache: 'no-store' });
    if (!res.ok) throw new Error('status');
    return res.json();
  }

  async function post(path, body) {
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || 'Something went wrong. Please try again.');
    return out;
  }

  function show(mode, msg) {
    $('login-screen').hidden = false;
    $('login-form').hidden = mode === 'offline';
    $('login-offline').hidden = mode !== 'offline';
    $('login-confirm-row').hidden = mode !== 'setup';
    $('login-title').textContent = mode === 'setup' ? 'Create your admin account' : 'Sign in';
    $('login-sub').textContent = mode === 'setup'
      ? 'Choose a username and a strong password (8+ characters). You will use these to sign in on every device.'
      : 'Enter your admin username and password.';
    $('login-submit').textContent = mode === 'setup' ? 'Create account & start' : 'Sign in';
    $('login-form').dataset.mode = mode;
    $('login-error').textContent = msg || '';
    if (mode !== 'offline') setTimeout(() => $('login-user').focus(), 50);
  }

  async function open(msg) {
    if (waitP) return waitP;                       // sign-in already on screen
    try {
      const st = await status();
      if (st.setupNeeded && !st.canSetup) {
        show('offline');
        $('login-offline-text').textContent = 'The admin account has not been created yet. Open the app on the computer running the server to create it.';
      } else {
        show(st.setupNeeded ? 'setup' : 'login', msg);
      }
    } catch (e) {
      show('offline');
      $('login-offline-text').textContent = 'Can’t reach the server. Connect to the internet to sign in. Once you have signed in on this device, it keeps working offline.';
    }
    waitP = new Promise(res => { waiting = res; }).finally(() => { waitP = null; });
    return waitP;
  }

  async function submit(ev) {
    ev.preventDefault();
    const mode = $('login-form').dataset.mode;
    const username = $('login-user').value.trim(), password = $('login-pass').value;
    if (!username || !password) return ($('login-error').textContent = 'Enter both username and password.');
    if (mode === 'setup' && password !== $('login-pass2').value) return ($('login-error').textContent = 'The two passwords do not match.');
    $('login-submit').disabled = true;
    $('login-error').textContent = '';
    try {
      const out = await post(mode === 'setup' ? '/api/setup' : '/api/login', { username, password });
      await Store.setMeta('token', out.token);
      await Store.setMeta('user', out.user);
      $('login-pass').value = $('login-pass2').value = '';
      $('login-screen').hidden = true;
      const w = waiting; waiting = null; if (w) w(true);
    } catch (e) {
      $('login-error').textContent = e.message === 'Failed to fetch' || e.name === 'TimeoutError' ? 'Can’t reach the server. Check your internet and try again.' : e.message;
    } finally {
      $('login-submit').disabled = false;
    }
  }

  // Returns once signed in (immediately if this device already has a session).
  async function ensure() {
    $('login-form').addEventListener('submit', submit);
    $('login-retry').addEventListener('click', () => open());
    if (await Store.getMeta('token')) return true;
    return open();
  }

  // Server said our session is no longer valid.
  async function expired() {
    await Store.setMeta('token', null);
    return open('Your session has ended. Please sign in again.');
  }

  async function logout() {
    if (!confirm('Sign out of this device? You will need an internet connection to sign in again.')) return;
    await Store.setMeta('token', null);
    location.reload();
  }

  return { ensure, expired, logout, user: () => Store.getMeta('user') };
})();
