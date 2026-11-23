// Downloads media from the platform CDNs on behalf of the content script.
// The service worker has host permissions, so the page's CORS rules do not block it.
// Hardening: only https addresses on the platforms' own hosts, and only messages from this extension.
const OK_HOSTS = /(^|\.)(facebook\.com|fbcdn\.net|fbsbx\.com|messenger\.com|instagram\.com|cdninstagram\.com|twimg\.com|x\.com|twitter\.com)$/i;
function allowed(u) {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' && OK_HOSTS.test(x.hostname);
  } catch (e) {
    return false;
  }
}
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'fetch') return;
  if (sender.id !== chrome.runtime.id || !sender.tab || !allowed(msg.url)) {
    sendResponse({ ok: false });
    return;
  }
  fetch(msg.url, { credentials: 'include' })
    .then((r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.blob();
    })
    .then((blob) => {
      const fr = new FileReader();
      fr.onload = () => sendResponse({ ok: true, dataUrl: fr.result, type: blob.type });
      fr.onerror = () => sendResponse({ ok: false });
      fr.readAsDataURL(blob);
    })
    .catch(() => sendResponse({ ok: false }));
  return true; // async response
});
