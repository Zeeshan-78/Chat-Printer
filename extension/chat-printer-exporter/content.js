(() => {
  if (window.__chatExporterLoaded) return;
  window.__chatExporterLoaded = true;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let running = false;
  let stopFlag = false;
  let manualCtx = null;

  // Links that identify the *conversation list* (left sidebar) - we must not treat those as messages.
  const THREAD_LINK =
    'a[href*="/t/"], a[href*="/direct/t/"], a[href*="/messages/"], a[href*="/e2ee/t/"]';
  const NOISE = new Set([
    'seen', 'sent', 'delivered', 'reply', 'more', 'forward', 'remove', 'copy',
    'react', 'unsend', 'edited', 'active now', 'you sent', 'enter'
  ]);
  const TIME_RE = /^\d{1,2}:\d{2}(\s?[ap]\.?m\.?)?$/i;
  const SEP_RE = /\d|today|yesterday|^(mon|tue|wed|thu|fri|sat|sun)/i;

  // ---------------------------------------------------------------- helpers
  function scrollParent(el) {
    let p = el.parentElement;
    while (p && p !== document.body && p !== document.documentElement) {
      const s = getComputedStyle(p);
      if (/(auto|scroll|overlay)/.test(s.overflowY) && p.scrollHeight > p.clientHeight + 5) return p;
      p = p.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }

  const isReverse = (sc) => getComputedStyle(sc).flexDirection === 'column-reverse';
  const atTop = (sc) =>
    isReverse(sc) ? sc.scrollTop <= -(sc.scrollHeight - sc.clientHeight) + 2 : sc.scrollTop <= 2;
  const scrollUp = (sc, step) => {
    sc.scrollTop = isReverse(sc) ? sc.scrollTop - step : Math.max(0, sc.scrollTop - step);
  };
  const scrollToEnd = (sc) => {
    sc.scrollTop = isReverse(sc) ? 0 : sc.scrollHeight;
  };

  function getText(node) {
    let out = '';
    node.childNodes.forEach((n) => {
      if (n.nodeType === 3) out += n.nodeValue;
      else if (n.nodeType === 1) {
        if (n.tagName === 'IMG') out += n.alt || ''; // emojis are <img alt="😀">
        else if (n.tagName === 'BR') out += '\n';
        else {
          const t = getText(n);
          out += t;
          if (/^(DIV|P)$/.test(n.tagName) && t) out += '\n';
        }
      }
    });
    return out;
  }

  const sigOf = (src) => (!src ? '' : src.startsWith('blob:') ? 'blob' : src.split('?')[0]);

  // ---------------------------------------------------------------- overlay
  function overlay(text, o = {}) {
    let el = document.getElementById('__ce_overlay');
    if (!el) {
      el = document.createElement('div');
      el.id = '__ce_overlay';
      el.style.cssText =
        'position:fixed;right:16px;bottom:16px;z-index:2147483647;background:#141712;color:#fff;' +
        'padding:12px 14px;border-radius:12px;font:13px/1.45 system-ui,sans-serif;' +
        'box-shadow:0 8px 30px rgba(0,0,0,.45);max-width:320px;';
      document.documentElement.appendChild(el);
    }
    el.innerHTML = '';
    const hd = document.createElement('div');
    hd.textContent = 'Chat Printer';
    hd.style.cssText = 'font-weight:800;letter-spacing:.06em;font-size:11px;margin-bottom:3px;color:#b0c6b3;';
    el.appendChild(hd);
    const s = document.createElement('div');
    s.textContent = text;
    el.appendChild(s);
    if (o.stop) {
      const b = document.createElement('button');
      b.textContent = 'Stop & export what is loaded';
      b.style.cssText =
        'margin-top:8px;padding:6px 10px;border:0;border-radius:8px;background:#b42318;color:#fff;cursor:pointer;font:600 12px system-ui;';
      b.onclick = () => (stopFlag = true);
      el.appendChild(b);
    }
    if (o.autoHide) setTimeout(() => el.remove(), o.autoHide);
  }
  const hideOverlay = () => document.getElementById('__ce_overlay')?.remove();

  // ---------------------------------------------------------------- chat detection
  function findChat() {
    const sels = ['[data-testid="messageEntry"]', '[role="row"]'];
    let best = null;
    for (const sel of sels) {
      const groups = new Map();
      document.querySelectorAll(sel).forEach((r) => {
        if (r.closest('#__ce_overlay') || r.querySelector(THREAD_LINK)) return;
        const sp = scrollParent(r);
        if (!groups.has(sp)) groups.set(sp, []);
        groups.get(sp).push(r);
      });
      groups.forEach((rows, sp) => {
        if (!best || rows.length > best.count) best = { sel, scroller: sp, count: rows.length };
      });
    }
    if (!best || best.count < 1) return null;
    return {
      mode: 'auto',
      scroller: best.scroller,
      getRows: () =>
        [...document.querySelectorAll(best.sel)].filter(
          (r) => best.scroller.contains(r) && !r.querySelector(THREAD_LINK)
        )
    };
  }

  function ctxFromElement(el) {
    const scroller = scrollParent(el);
    const chain = [];
    let n = el;
    while (n && n !== scroller) {
      chain.push(n);
      n = n.parentElement;
    }
    chain.reverse();
    const candidates = [scroller, ...chain];
    let parent = candidates.find((c) => c.children.length >= 4);
    if (!parent) parent = [...candidates].reverse().find((c) => c.children.length >= 2);
    if (!parent) return null;
    return { mode: 'manual', scroller, getRows: () => [...parent.children] };
  }

  function startPick() {
    overlay('Click on any message inside the chat you want to export (Esc = cancel).');
    const cleanup = () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
    };
    function onClick(e) {
      e.preventDefault();
      e.stopPropagation();
      cleanup();
      const ctx = ctxFromElement(e.target);
      if (!ctx) {
        overlay('Could not detect a message list there. Try clicking directly on a message.', { autoHide: 5000 });
      } else {
        manualCtx = ctx;
        overlay(`Chat area selected (${ctx.getRows().length} items). Now open the extension and press Start.`, {
          autoHide: 6000
        });
      }
    }
    function onKey(e) {
      if (e.key === 'Escape') {
        cleanup();
        hideOverlay();
      }
    }
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
  }

  function getCtx() {
    if (manualCtx && manualCtx.scroller.isConnected) return manualCtx;
    return findChat();
  }

  function detectTitle() {
    const sels = [
      '[role="main"] h1', '[role="main"] h2', '[data-testid="DmActivityContainer"] h2',
      'header h1', 'header h2', '[role="main"] header span[dir="auto"]'
    ];
    for (const s of sels) {
      const t = document.querySelector(s)?.textContent?.trim();
      if (t && t.length < 80) return t;
    }
    return document.title.replace(/^\(\d+\)\s*/, '').replace(/\s*[|•\-–].*$/, '').trim();
  }

  // ---------------------------------------------------------------- row extraction
  function extractRow(row, sr) {
    const texts = [];
    const rects = [];
    let time = '';

    let leaves = [...row.querySelectorAll('[dir="auto"]')].filter((e) => !e.querySelector('[dir="auto"]'));
    if (!leaves.length) {
      leaves = [...row.querySelectorAll('span')].filter((e) => !e.querySelector('span') && e.textContent.trim());
    }
    for (const el of leaves) {
      const t = getText(el).replace(/\u200b/g, '').trim();
      if (!t || NOISE.has(t.toLowerCase())) continue;
      if (TIME_RE.test(t)) {
        if (!time) time = t;
        continue;
      }
      if (texts.includes(t)) continue;
      texts.push(t);
      const r = el.getBoundingClientRect();
      if (r.width) rects.push(r);
    }
    const tEl = row.querySelector('time');
    if (tEl && !time) time = tEl.getAttribute('datetime') || tEl.textContent.trim();

    const media = [];
    const seenSrc = new Set();
    row.querySelectorAll('img').forEach((img) => {
      if (img.closest('[dir="auto"]')) return; // inline emoji
      const r = img.getBoundingClientRect();
      if (r.width < 80 || r.height < 60) return; // avatars, icons
      const src = img.currentSrc || img.src;
      if (!src || seenSrc.has(src)) return;
      seenSrc.add(src);
      media.push({ type: 'image', src });
      rects.push(r);
    });
    row.querySelectorAll('video').forEach((v) => {
      const src = v.currentSrc || v.src || v.querySelector('source')?.src || '';
      const r = v.getBoundingClientRect();
      media.push({ type: 'video', src, poster: v.poster || '' });
      if (r.width) rects.push(r);
    });
    row.querySelectorAll('audio').forEach((a) => {
      const src = a.currentSrc || a.src || '';
      if (src) media.push({ type: 'audio', src });
    });

    if (!texts.length && !media.length) return null;

    let side = 'other';
    let centered = false;
    if (rects.length) {
      let minL = Infinity, maxR = -Infinity;
      rects.forEach((r) => {
        minL = Math.min(minL, r.left);
        maxR = Math.max(maxR, r.right);
      });
      const gl = minL - sr.left;
      const gr = sr.right - maxR;
      side = gr < gl ? 'me' : 'other';
      centered = Math.abs(gl - gr) < sr.width * 0.08;
    }

    if (centered && !media.length && texts.length === 1 && texts[0].length < 45 && SEP_RE.test(texts[0])) {
      return { type: 'sep', text: texts[0], key: 'sep|' + texts[0] };
    }

    const text = texts.join('\n');
    return {
      type: 'msg',
      side,
      text,
      time,
      media,
      key: `msg|${side}|${text}|${time}|${media.map((m) => sigOf(m.src || m.poster)).join(',')}`
    };
  }

  function snapshot(ctx) {
    const sr = ctx.scroller.getBoundingClientRect();
    const rows = ctx
      .getRows()
      .map((r) => ({ r, top: r.getBoundingClientRect().top }))
      .sort((a, b) => a.top - b.top);
    const out = [];
    for (const { r } of rows) {
      const m = extractRow(r, sr);
      if (m) out.push(m);
    }
    return out;
  }

  // Prepend rows newly seen at the top of the chat.
  function mergeTop(all, snap) {
    if (!snap.length) return;
    if (!all.length) {
      all.push(...snap);
      return;
    }
    const maxK = Math.min(30, all.length);
    for (let k = 0; k < maxK; k++) {
      for (let i = k; i < snap.length; i++) {
        if (snap[i].key !== all[k].key) continue;
        let ok = true;
        for (let j = 1; j < 3 && k + j < all.length && i + j < snap.length; j++) {
          if (snap[i + j].key !== all[k + j].key) {
            ok = false;
            break;
          }
        }
        if (ok) {
          const fresh = snap.slice(0, i - k);
          if (fresh.length) all.unshift(...fresh);
          return;
        }
      }
    }
    all.unshift(...snap); // no overlap found - keep everything rather than lose messages
  }

  // ---------------------------------------------------------------- media downloading
  async function fetchBytes(url) {
    const viaBackground = async () => {
      try {
        const r = await chrome.runtime.sendMessage({ type: 'fetch', url });
        if (r && r.ok) {
          const bin = atob(r.dataUrl.split(',')[1]);
          const u8 = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
          return { bytes: u8, type: r.type || '' };
        }
      } catch (e) {}
      return null;
    };
    const direct = async () => {
      try {
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) return null;
        const blob = await res.blob();
        return { bytes: new Uint8Array(await blob.arrayBuffer()), type: blob.type };
      } catch (e) {
        return null;
      }
    };
    if (url.startsWith('blob:') || url.startsWith('data:')) return direct();
    return (await viaBackground()) || (await direct());
  }

  function extFor(type, url, kind) {
    const map = {
      'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
      'video/mp4': 'mp4', 'video/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a',
      'audio/ogg': 'ogg', 'audio/webm': 'webm'
    };
    if (map[type]) return map[type];
    const m = /\.([a-z0-9]{2,4})(?:$|\?)/i.exec((url || '').split('#')[0]);
    if (m) return m[1].toLowerCase();
    return { image: 'jpg', video: 'mp4', audio: 'mp3' }[kind] || 'bin';
  }

  // ---------------------------------------------------------------- theme (export looks like the platform it came from)
  const PRESETS = {
    messenger: {
      name: 'Messenger', radius: '18px', style: 'round',
      font: '"Segoe UI Historic","Segoe UI",Helvetica,Arial,sans-serif',
      light: { bg: '#ffffff', fg: '#050505', hdrBg: '#ffffff', hdrFg: '#050505', meBg: '#0084ff', meFg: '#ffffff', otBg: '#e4e6eb', otFg: '#050505', sub: '#65676b' },
      dark: { bg: '#18191a', fg: '#e4e6eb', hdrBg: '#242526', hdrFg: '#e4e6eb', meBg: '#0084ff', meFg: '#ffffff', otBg: '#303030', otFg: '#e4e6eb', sub: '#b0b3b8' }
    },
    instagram: {
      name: 'Instagram', radius: '22px', style: 'round',
      font: '-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif',
      light: { bg: '#ffffff', fg: '#000000', hdrBg: '#ffffff', hdrFg: '#000000', meBg: 'linear-gradient(135deg,#5b6cf0,#8a3ab9)', meFg: '#ffffff', otBg: '#efefef', otFg: '#000000', sub: '#737373' },
      dark: { bg: '#000000', fg: '#f5f5f5', hdrBg: '#000000', hdrFg: '#f5f5f5', meBg: 'linear-gradient(135deg,#5b6cf0,#8a3ab9)', meFg: '#ffffff', otBg: '#262626', otFg: '#f5f5f5', sub: '#a8a8a8' }
    },
    x: {
      name: 'X', radius: '20px', style: 'x',
      font: '"TwitterChirp",-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif',
      light: { bg: '#ffffff', fg: '#0f1419', hdrBg: '#ffffff', hdrFg: '#0f1419', meBg: '#1d9bf0', meFg: '#ffffff', otBg: '#eff3f4', otFg: '#0f1419', sub: '#536471' },
      dark: { bg: '#000000', fg: '#e7e9ea', hdrBg: '#000000', hdrFg: '#e7e9ea', meBg: '#1d9bf0', meFg: '#ffffff', otBg: '#2f3336', otFg: '#e7e9ea', sub: '#71767b' }
    },
    telegram: {
      name: 'Telegram', radius: '12px', style: 'round',
      font: '-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif',
      light: { bg: '#dfe7ec', fg: '#000000', hdrBg: '#ffffff', hdrFg: '#000000', meBg: '#eeffde', meFg: '#000000', otBg: '#ffffff', otFg: '#000000', sub: '#707579' },
      dark: { bg: '#0e1621', fg: '#f5f5f5', hdrBg: '#17212b', hdrFg: '#f5f5f5', meBg: '#2b5278', meFg: '#ffffff', otBg: '#182533', otFg: '#f5f5f5', sub: '#7f91a4' }
    },
    linkedin: {
      name: 'LinkedIn', radius: '10px', style: 'round',
      font: '-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif',
      light: { bg: '#ffffff', fg: '#191919', hdrBg: '#ffffff', hdrFg: '#191919', meBg: '#0a66c2', meFg: '#ffffff', otBg: '#f3f2ef', otFg: '#191919', sub: '#666666' },
      dark: { bg: '#1b1f23', fg: '#ffffff', hdrBg: '#1b1f23', hdrFg: '#ffffff', meBg: '#0a66c2', meFg: '#ffffff', otBg: '#38434f', otFg: '#ffffff', sub: '#9ba4ad' }
    },
    discord: {
      name: 'Discord', radius: '12px', style: 'round',
      font: '"gg sans","Segoe UI",Roboto,Helvetica,Arial,sans-serif',
      light: { bg: '#ffffff', fg: '#313338', hdrBg: '#f2f3f5', hdrFg: '#313338', meBg: '#5865f2', meFg: '#ffffff', otBg: '#f2f3f5', otFg: '#313338', sub: '#5c5e66' },
      dark: { bg: '#313338', fg: '#dbdee1', hdrBg: '#2b2d31', hdrFg: '#dbdee1', meBg: '#5865f2', meFg: '#ffffff', otBg: '#2b2d31', otFg: '#dbdee1', sub: '#949ba4' }
    },
    chatprinter: {
      name: 'Chat Printer', radius: '10px', style: 'round', wp: true,
      font: 'system-ui,"Segoe UI",Roboto,Helvetica,Arial,sans-serif',
      light: { bg: '#efeae2', fg: '#111b21', hdrBg: '#008069', hdrFg: '#ffffff', meBg: '#d9fdd3', meFg: '#111b21', otBg: '#ffffff', otFg: '#111b21', sub: '#667781' },
      dark: { bg: '#0b141a', fg: '#e9edef', hdrBg: '#202c33', hdrFg: '#e9edef', meBg: '#005c4b', meFg: '#e9edef', otBg: '#202c33', otFg: '#e9edef', sub: '#8696a0' }
    },
    default: {
      name: 'Chat', radius: '10px', style: 'round',
      font: 'system-ui,"Segoe UI",Roboto,sans-serif',
      light: { bg: '#e5ddd5', fg: '#111111', hdrBg: '#075e54', hdrFg: '#ffffff', meBg: '#dcf8c6', meFg: '#111111', otBg: '#ffffff', otFg: '#111111', sub: '#667781' },
      dark: { bg: '#0b141a', fg: '#e9edef', hdrBg: '#202c33', hdrFg: '#e9edef', meBg: '#005c4b', meFg: '#e9edef', otBg: '#202c33', otFg: '#e9edef', sub: '#8696a0' }
    }
  };

  function presetFor(host) {
    if (/messenger\.com|facebook\.com/.test(host)) return PRESETS.messenger;
    if (/instagram\.com/.test(host)) return PRESETS.instagram;
    if (/(^|\.)x\.com$|twitter\.com/.test(host)) return PRESETS.x;
    if (/telegram\.org/.test(host)) return PRESETS.telegram;
    if (/linkedin\.com/.test(host)) return PRESETS.linkedin;
    if (/discord\.com/.test(host)) return PRESETS.discord;
    return PRESETS.default;
  }

  const parseRGB = (c) => {
    const m = /rgba?\(([^)]+)\)/.exec(c || '');
    if (!m) return null;
    const p = m[1].split(/[,/ ]+/).filter(Boolean).map(parseFloat);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = (c) => (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
  const toCss = (c) => `rgb(${c.r},${c.g},${c.b})`;
  // Values copied from a web page must never carry addresses or scripts into the exported file.
  const cssSafe = (s, fallback = 'transparent') => {
    const t = String(s).replace(/[<>{};\\]/g, '');
    return /url\s*\(|@import|expression\s*\(|javascript:|behavior\s*:/i.test(t) ? fallback : t;
  };

  function solidBg(el) {
    while (el) {
      const c = parseRGB(getComputedStyle(el).backgroundColor);
      if (c && c.a > 0.5) return c;
      el = el.parentElement;
    }
    return null;
  }

  // Read the real colours of the chat that is currently on screen (works with custom chat colours too).
  function sampleTheme(ctx) {
    const out = {};
    out.bgC = solidBg(ctx.scroller) || solidBg(document.body);
    out.fg = getComputedStyle(ctx.scroller).color;
    out.font = getComputedStyle(document.body).fontFamily;
    const sr = ctx.scroller.getBoundingClientRect();
    for (const row of ctx.getRows()) {
      const leaf = [...row.querySelectorAll('[dir="auto"]')].find(
        (e) => !e.querySelector('[dir="auto"]') && e.textContent.trim().length > 1
      );
      if (!leaf) continue;
      const r = leaf.getBoundingClientRect();
      if (!r.width) continue;
      const side = sr.right - r.right < r.left - sr.left ? 'me' : 'other';
      if (out[side]) continue;
      let el = leaf;
      while (el && el !== row.parentElement) {
        const cs = getComputedStyle(el);
        const c = parseRGB(cs.backgroundColor);
        const img = cs.backgroundImage && cs.backgroundImage !== 'none' && /gradient/.test(cs.backgroundImage);
        if ((c && c.a > 0.3) || img) {
          out[side] = {
            bg: img ? cs.backgroundImage : cs.backgroundColor,
            fg: getComputedStyle(leaf).color,
            radius: cs.borderRadius
          };
          break;
        }
        el = el.parentElement;
      }
      if (out.me && out.other) break;
    }
    return out;
  }

  function buildTheme(ctx, mode) {
    if (mode === 'cp-light' || mode === 'cp-dark') {
      const b = PRESETS.chatprinter;
      const dark = mode === 'cp-dark';
      return { name: b.name, font: b.font, radius: b.radius, style: b.style, wp: true, dark, ...b[dark ? 'dark' : 'light'] };
    }
    const base = presetFor(location.hostname);
    let sampled = {};
    if (mode === 'auto') {
      try {
        sampled = sampleTheme(ctx) || {};
      } catch (e) {}
    }
    const dark =
      mode === 'dark' ? true : mode === 'light' ? false
        : sampled.bgC ? lum(sampled.bgC) < 0.45
          : matchMedia('(prefers-color-scheme: dark)').matches;
    const t = { name: base.name, font: base.font, radius: base.radius, style: base.style, dark, ...base[dark ? 'dark' : 'light'] };
    if (mode === 'auto') {
      if (sampled.bgC) t.bg = toCss(sampled.bgC);
      if (sampled.fg) t.fg = sampled.fg;
      if (sampled.font) t.font = sampled.font + ',' + base.font;
      if (sampled.me) { t.meBg = sampled.me.bg; t.meFg = sampled.me.fg; }
      if (sampled.other) { t.otBg = sampled.other.bg; t.otFg = sampled.other.fg; }
      const rad = (sampled.me || sampled.other || {}).radius;
      if (rad && /^\d+(\.\d+)?px$/.test(rad) && parseFloat(rad) >= 6) t.radius = Math.min(parseFloat(rad), 24) + 'px';
    }
    return t;
  }

  // ---------------------------------------------------------------- export builders
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function mediaLabel(m) {
    return m.type === 'image' ? 'Image' : m.type === 'video' ? 'Video' : 'Audio';
  }

  function toTXT(msgs, ctx) {
    const lines = [];
    for (const m of msgs) {
      if (m.type === 'sep') {
        lines.push(`\n--- ${m.text} ---`);
        continue;
      }
      const stamp = [m.dateLabel, m.time].filter(Boolean).join(' ');
      const who = m.side === 'me' ? ctx.me : ctx.other;
      const parts = [];
      if (m.text) parts.push(m.text);
      for (const med of m.media) {
        if (ctx.withMedia && med.filename) parts.push(`<attached: media/${med.filename}>`);
        else parts.push(`<${mediaLabel(med)} omitted>`);
      }
      lines.push(`${stamp ? '[' + stamp + '] ' : ''}${who}: ${parts.join('\n')}`);
    }
    return lines.join('\n');
  }

  function toJSON(msgs, ctx) {
    return JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        platform: location.hostname,
        chat: ctx.other,
        me: ctx.me,
        messages: msgs.map((m) =>
          m.type === 'sep'
            ? { type: 'date_separator', text: m.text }
            : {
                sender: m.side === 'me' ? ctx.me : ctx.other,
                side: m.side,
                date: m.dateLabel || '',
                time: m.time || '',
                text: m.text,
                media: m.media.map((x) => ({ type: x.type, file: x.filename ? 'media/' + x.filename : null }))
              }
        )
      },
      null,
      2
    );
  }

  function toHTML(msgs, ctx) {
    const t = ctx.theme;
    const v = (x) => cssSafe(x);
    const body = msgs
      .map((m) => {
        if (m.type === 'sep') return `<div class="sep"><span>${esc(m.text)}</span></div>`;
        const who = m.side === 'me' ? ctx.me : ctx.other;
        const stamp = [m.dateLabel, m.time].filter(Boolean).join(' ');
        const media = m.media
          .map((x) => {
            if (ctx.withMedia && x.filename) {
              const p = 'media/' + esc(x.filename);
              if (x.type === 'image') return `<a href="${p}" target="_blank"><img src="${p}" loading="lazy"></a>`;
              if (x.type === 'video') return `<video controls preload="metadata" src="${p}"></video>`;
              return `<audio controls src="${p}"></audio>`;
            }
            return `<div class="ph">[${mediaLabel(x)}${x.failed ? ' - could not be downloaded' : ''}]</div>`;
          })
          .join('');
        return (
          `<div class="row ${m.side}"><div class="bub">` +
          (t.wp ? '' : `<div class="meta">${esc(who)}${stamp ? ' &middot; ' + esc(stamp) : ''}</div>`) +
          (m.text ? `<div class="txt">${esc(m.text)}</div>` : '') +
          media +
          (t.wp && m.time ? `<span class="tm">${esc(m.time)}</span>` : '') +
          `</div></div>`
        );
      })
      .join('\n');
    const initial = esc((ctx.other || '?').trim().charAt(0).toUpperCase() || '?');
    const xCorners = t.style === 'x'
      ? '.me .bub{border-bottom-right-radius:4px}.other .bub{border-bottom-left-radius:4px}' : '';
    return `<!doctype html><html><head><meta charset="utf-8"><title>Chat with ${esc(ctx.other)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{--bg:${v(t.bg)};--fg:${v(t.fg)};--hdrBg:${v(t.hdrBg)};--hdrFg:${v(t.hdrFg)};--meBg:${v(t.meBg)};--meFg:${v(t.meFg)};--otBg:${v(t.otBg)};--otFg:${v(t.otFg)};--sub:${v(t.sub)};--radius:${v(t.radius)};--font:${cssSafe(t.font, 'system-ui,sans-serif')};color-scheme:${t.dark ? 'dark' : 'light'}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 var(--font)}
header{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:12px;background:var(--hdrBg);color:var(--hdrFg);padding:12px 18px;box-shadow:0 1px 0 rgba(128,128,128,.25)}
.av{width:40px;height:40px;border-radius:50%;background:var(--meBg);color:var(--meFg);display:grid;place-items:center;font-weight:700;flex:none}
header b{display:block;font-size:16px}header small{display:block;color:var(--sub)}
main{max-width:760px;margin:0 auto;padding:16px 12px 60px}
.row{display:flex;margin:3px 0}.row.me{justify-content:flex-end}
.bub{max-width:78%;padding:8px 12px;border-radius:var(--radius)}
.me .bub{background:var(--meBg);color:var(--meFg)}
.other .bub{background:var(--otBg);color:var(--otFg)}
${xCorners}
.meta{font-size:11px;opacity:.7;margin-bottom:2px}
.txt{white-space:pre-wrap;word-break:break-word}
.bub img,.bub video{display:block;max-width:100%;max-height:420px;border-radius:calc(var(--radius) - 4px);margin-top:6px}
.bub audio{margin-top:6px;max-width:100%}
.ph{font-style:italic;opacity:.75;margin-top:4px}
.sep{text-align:center;margin:16px 0 8px}.sep span{color:var(--sub);font-size:12px;font-weight:600}
footer{text-align:center;color:var(--sub);font-size:12px;padding:20px}
.lg{margin-left:auto;height:26px;width:auto}
${t.wp ? 'body{background-image:' + (t.dark ? CE_BRAND.doodleDark : CE_BRAND.doodleLight) + ';background-size:240px 240px}.bub{box-shadow:0 1px 1px rgba(0,0,0,.13)}.me .bub{border-top-right-radius:3px}.other .bub{border-top-left-radius:3px}.tm{display:block;text-align:right;font-size:11px;opacity:.6;margin-top:2px}.sep span{background:var(--otBg);padding:4px 10px;border-radius:8px;box-shadow:0 1px 1px rgba(0,0,0,.13)}' : ''}
</style></head><body>
<header><div class="av">${initial}</div><div><b>${esc(ctx.other)}</b><small>${esc(t.wp ? 'Chat Printer' : t.name)} &middot; exported ${esc(new Date().toLocaleString())}</small></div>${t.wp ? '<img class="lg" alt="" src="' + CE_BRAND.logo + '">' : ''}</header>
<main>
${body}
</main><footer>Exported with <a href="https://chatprinter.vercel.app" style="color:inherit">Chat Printer</a></footer></body></html>`;
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  // ---------------------------------------------------------------- main run
  async function run(opts) {
    if (running) return;
    running = true;
    stopFlag = false;
    try {
      const ctx = getCtx();
      if (!ctx) throw new Error('Chat not found. Open a chat first, or use "Pick chat area manually".');
      const sc = ctx.scroller;

      // media registry (shared by every message that shows the same file)
      const store = new Map();
      let active = 0;
      const waiters = [];
      const pool = async (fn) => {
        while (active >= 4) await new Promise((r) => waiters.push(r));
        active++;
        try {
          return await fn();
        } finally {
          active--;
          const w = waiters.shift();
          if (w) w();
        }
      };
      const downloadMedia = async (e) => {
        let res = e.src ? await fetchBytes(e.src) : null;
        if (res) e.ext = extFor(res.type, e.src, e.type);
        if (!res && e.type === 'video' && e.poster) {
          res = await fetchBytes(e.poster);
          if (res) {
            e.thumb = true;
            e.ext = extFor(res.type, e.poster, 'image');
          }
        }
        if (res) e.bytes = res.bytes;
        else e.failed = true;
      };
      const register = (d) => {
        const sig = sigOf(d.src || d.poster) + '|' + d.type;
        let e = store.get(sig);
        if (!e || sig.startsWith('blob|')) {
          e = { ...d };
          if (!sig.startsWith('blob|')) store.set(sig, e);
          else store.set(sig + Math.random(), e);
          if (opts.withMedia) e.promise = pool(() => downloadMedia(e));
        }
        return e;
      };

      const all = [];
      const grab = () => {
        const snap = snapshot(ctx);
        // blob: sources are unique per DOM mount, so register only rows we have not seen
        const known = new Set(all.map((x) => x.key));
        snap.forEach((m) => {
          if (m.type === 'msg' && m.media.length && !known.has(m.key)) m.media = m.media.map(register);
        });
        mergeTop(all, snap);
      };

      grab();
      const theme = buildTheme(ctx, opts.theme || 'auto');
      overlay(`Reading chat... ${all.length} messages found`, { stop: true });

      if (opts.autoScroll) {
        let stable = 0;
        let last = all.length;
        let guard = 0;
        while (!stopFlag && guard++ < 5000) {
          scrollUp(sc, Math.max(200, sc.clientHeight * 0.7));
          await sleep(opts.delay || 900);
          grab();
          if (atTop(sc)) {
            if (all.length === last) {
              stable++;
              await sleep(1200); // give the site time to load older messages
            } else stable = 0;
          } else stable = 0;
          last = all.length;
          const mediaCount = [...store.values()].length;
          overlay(`Scrolling up... ${all.length} messages, ${mediaCount} media found`, { stop: true });
          if (stable >= 4) break;
        }
        scrollToEnd(sc);
      }

      // Paid plan exports keep everything; free plan exports only the first `trunc` messages.
      if (opts.trunc > 0) {
        let n = 0;
        for (let i = all.length - 1; i >= 0; i--) {
          if (all[i].type === 'msg') n++;
          if (n > opts.trunc) all.splice(i, 1);
        }
      }

      // media
      const entries = [...store.values()];
      if (opts.withMedia && entries.length) {
        let done = 0;
        await Promise.all(
          entries.map((e) =>
            e.promise.then(() => {
              done++;
              overlay(`Downloading media ${done}/${entries.length}...`);
            })
          )
        );
      }

      // order-based file names + date labels
      const counters = { IMG: 0, VID: 0, AUD: 0, THUMB: 0 };
      const files = [];
      let cur = '';
      for (const m of all) {
        if (m.type === 'sep') {
          cur = m.text;
          continue;
        }
        m.dateLabel = cur;
        for (const med of m.media) {
          if (!opts.withMedia || !med.bytes || med.filename) continue;
          const p = med.thumb ? 'THUMB' : { image: 'IMG', video: 'VID', audio: 'AUD' }[med.type];
          med.filename = `${p}_${String(++counters[p]).padStart(4, '0')}.${med.ext || 'bin'}`;
          files.push({ name: 'media/' + med.filename, data: med.bytes });
        }
      }

      const meta = {
        me: opts.me || 'Me',
        other: opts.other || detectTitle() || 'Other',
        withMedia: !!opts.withMedia,
        theme
      };
      const base =
        'chat-' + meta.other.replace(/[^\w\-\u0600-\u06FF ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 40) +
        '-' + new Date().toISOString().slice(0, 10);
      const fmt = opts.format || 'html';
      const text = fmt === 'txt' ? toTXT(all, meta) : fmt === 'json' ? toJSON(all, meta) : toHTML(all, meta);
      const chatName = `chat.${fmt}`;
      const msgCount = all.filter((m) => m.type === 'msg').length;

      if (opts.withMedia) {
        const enc = new TextEncoder();
        const zip = CE_makeZip([{ name: chatName, data: enc.encode(text) }, ...files]);
        download(zip, base + '.zip');
      } else {
        const mime = fmt === 'html' ? 'text/html' : fmt === 'json' ? 'application/json' : 'text/plain';
        download(new Blob([text], { type: mime + ';charset=utf-8' }), `${base}.${fmt}`);
      }

      const failed = [...store.values()].filter((e) => e.failed).length;
      overlay(
        `Done! ${msgCount} messages exported` +
          (opts.withMedia ? `, ${files.length} media files saved${failed ? `, ${failed} could not be downloaded` : ''}` : '') +
          '.',
        { autoHide: 9000 }
      );
    } catch (err) {
      overlay('Export failed: ' + (err && err.message ? err.message : err), { autoHide: 9000 });
    } finally {
      running = false;
    }
  }

  // ---------------------------------------------------------------- messages from popup
  chrome.runtime.onMessage.addListener((msg, sender, send) => {
    if (msg.action === 'ping') {
      send({ ok: true });
    } else if (msg.action === 'detect') {
      const ctx = getCtx();
      if (!ctx) {
        send({ ok: false, error: 'No chat detected. Open a conversation, or use "Pick chat area manually".' });
        return;
      }
      const rows = ctx.getRows();
      const count = snapshot(ctx).filter((m) => m.type === 'msg').length;
      rows.forEach((r) => (r.style.outline = '2px solid #db3356'));
      setTimeout(() => rows.forEach((r) => (r.style.outline = '')), 3500);
      send({ ok: true, rows: rows.length, messages: count, mode: ctx.mode });
    } else if (msg.action === 'pick') {
      startPick();
      send({ ok: true });
    } else if (msg.action === 'start') {
      run(msg.options);
      send({ ok: true });
    } else if (msg.action === 'stop') {
      stopFlag = true;
      send({ ok: true });
    }
  });

  // Lets the automatic tests reach a few internal functions. A web page cannot set this flag: the page and the
  // extension run in separate JavaScript worlds.
  if (window.__CE_TEST_HOOK__) window.__CE_TEST__ = { buildTheme, toHTML, toTXT, toJSON, cssSafe, PRESETS };
})();
