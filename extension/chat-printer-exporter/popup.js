const $ = (id) => document.getElementById(id);
const defaults = { format: 'html', media: 'no', theme: 'cp-light', autoScroll: true, me: 'Me', other: '' };

function setStatus(text, ok) {
  const s = $('status');
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
    `Found ${r.messages} messages (${r.rows} rows, ${r.mode}). Green outlines on the page show what will be exported.`,
    true
  );
};

$('pick').onclick = async () => {
  const r = await send('pick');
  if (!r.ok) return setStatus(r.error);
  window.close(); // let the user click on the page
};

$('start').onclick = async () => {
  const f = readForm();
  chrome.storage.local.set({ opts: f });
  const r = await send('start', {
    options: {
      format: f.format,
      withMedia: f.media === 'yes',
      theme: f.theme,
      autoScroll: f.autoScroll,
      me: f.me,
      other: f.other
    }
  });
  if (!r.ok) return setStatus(r.error);
  window.close(); // progress is shown on the page itself
};
