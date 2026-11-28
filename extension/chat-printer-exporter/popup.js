const $ = (id) => document.getElementById(id);
const defaults = { format: 'html', media: 'no', theme: 'cp-light', autoScroll: true, me: 'Me', other: '' };

function setStatus(text, ok) {
  const s = $('status');
  s.textContent = text;
  s.className = ok ? 'ok' : '';
}
function setGateStatus(text, ok) {
  const s = $('gatestatus');
  s.textContent = text;
  s.className = ok ? 'ok' : '';
}

function readForm() {
  return {
    format: $('format').value,
    media: $('media').value,
    theme: $('theme').value,
    autoScroll: $('autoScroll').checked,
    me: $('me').value.trim() || 'Me',
    other: $('other').value.trim()
  };
}

// Config comes from the website's config.js (loaded as a script tag in popup.html),
// so the extension always uses the same Appwrite project and function as the site.
const CFG = window.CHATPRINTER || {};
const ENDPOINT = CFG.endpoint || 'https://cloud.appwrite.io/v1';
const PROJECT = CFG.projectId || '';
const FUNCTION = CFG.functionId || '';

async function call(action, data) {
  if (!PROJECT || String(PROJECT).indexOf('YOUR-') === 0 || !FUNCTION || String(FUNCTION).indexOf('YOUR-') === 0)
    return { ok: false, reason: 'Could not load the Chat Printer config. Check your internet connection and reopen the popup.' };
  try {
    const r = await fetch(ENDPOINT + '/functions/' + FUNCTION + '/executions', {
      method: 'POST',
      headers: { 'X-Appwrite-Project': PROJECT, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...(data || {}) })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, reason: (j && j.message) || 'Server error. Try again.' };
    return j.responseBody ? JSON.parse(j.responseBody) : {};
  } catch (e) {
    return { ok: false, reason: 'Could not reach the server. Check your connection.' };
  }
}

let auth = null;

function showApp() {
  $('gate').hidden = true;
  $('app').hidden = false;
  const pl = $('planline');
  if (auth && auth.plan) {
    pl.hidden = false;
    pl.innerHTML =
      'Signed in · <b>' + (auth.plan === 'paid' ? 'Full export' : 'Free') + '</b> plan' +
      (auth.plan === 'paid'
        ? ' · ' + (auth.credits || 0) + ' export credit' + ((auth.credits || 0) === 1 ? '' : 's') + ' left'
        : ' · text only, first 100 messages');
  }
  const canMedia = !!(auth && auth.media);
  $('media').disabled = !canMedia;
  if (!canMedia) $('media').value = 'no';
}
function showGate() {
  $('gate').hidden = false;
  $('app').hidden = true;
}

$('unlock').onclick = async () => {
  const key = $('key').value.trim();
  if (!/^cp_[0-9a-f]{48}$/.test(key)) return setGateStatus('Paste a valid extension key (it starts with cp_).');
  setGateStatus('Checking your key…');
  const r = await call('ext_auth', { key });
  if (!r.ok) return setGateStatus(r.reason || 'That key did not work.');
  auth = { key, plan: r.plan, media: r.media, trunc: r.trunc || 0, credits: r.credits || 0 };
  chrome.storage.local.set({ cp_auth: auth });
  showApp();
};

$('signout').onclick = () => {
  chrome.storage.local.remove('cp_auth');
  auth = null;
  $('key').value = '';
  showGate();
};

chrome.storage.local.get('cp_auth', ({ cp_auth }) => {
  auth = cp_auth || null;
  if (auth && auth.key) showApp();
  else showGate();
});

chrome.storage.local.get('opts', ({ opts }) => {
  const o = { ...defaults, ...(opts || {}) };
  $('format').value = o.format;
  $('media').value = o.media;
  $('theme').value = o.theme;
  $('autoScroll').checked = o.autoScroll;
  $('me').value = o.me === 'Me' ? '' : o.me;
  $('other').value = o.other;
});

async function send(action, extra = {}) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return new Promise((resolve) => {
    if (!tab) return resolve({ ok: false, error: 'No active tab.' });
    chrome.tabs.sendMessage(tab.id, { action, ...extra }, (res) => {
      if (chrome.runtime.lastError || !res) {
        resolve({
          ok: false,
          error:
            'Extension is not active on this page. Refresh the page (F5) and try again. ' +
            'Supported: Messenger, Facebook, Instagram, X, Telegram Web, LinkedIn, Discord.'
        });
      } else resolve(res);
    });
  });
}

$('detect').onclick = async () => {
  setStatus('Checking...');
  const r = await send('detect');
  if (!r.ok) return setStatus(r.error);
  setStatus(
    `Found ${r.messages} messages (${r.rows} rows, ${r.mode}). Red outlines on the page show what will be exported.`,
    true
  );
};

$('pick').onclick = async () => {
  const r = await send('pick');
  if (!r.ok) return setStatus(r.error);
  window.close(); // let the user click on the page
};

$('start').onclick = async () => {
  if (!auth || !auth.key) {
    showGate();
    return setGateStatus('Sign in with your extension key first.');
  }
  const f = readForm();
  setStatus('Checking your plan…');
  // consume=1 makes the server enforce the plan and spend one export (free quota or one credit)
  const r = await call('ext_auth', { key: auth.key, consume: 1 });
  if (!r.ok) return setStatus(r.reason || 'Could not verify your account.');
  auth.plan = r.plan;
  auth.media = r.media;
  auth.trunc = r.trunc || 0;
  auth.credits = r.credits || 0;
  chrome.storage.local.set({ cp_auth: auth });
  showApp();
  const wantMedia = f.media === 'yes';
  if (wantMedia && !r.media)
    return setStatus('Media needs a paid export. Pay once on the website, then export again.');
  chrome.storage.local.set({ opts: f });
  const rr = await send('start', {
    options: {
      format: f.format,
      withMedia: wantMedia && r.media,
      theme: f.theme,
      autoScroll: f.autoScroll,
      me: f.me,
      other: f.other,
      trunc: r.trunc || 0
    }
  });
  if (!rr.ok) return setStatus(rr.error);
  window.close(); // progress is shown on the page itself
};
