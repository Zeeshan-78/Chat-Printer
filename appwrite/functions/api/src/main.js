// Chat Printer backend (Appwrite Function). Every plan, quota and payment rule lives here, on the server.
// Visitors never get direct access to the database; they can only call the actions below.
//
// Plan model (v4):
//   free — 1 export total, text only, first 100 messages, files up to 200 MB.
//   paid — pay once per export; each approved payment adds 1 credit to subscriptions.credits.
//          A credit is consumed by the "begin" action. Full chat, media included, files up to 1 GB.
//   Legacy pro/ultra rows with an unexpired expiresAt still behave as paid until they expire.
import { Client, TablesDB, Users, Query, ID, TablesDBIndexType } from 'node-appwrite';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const MB = 1048576;
const FREE_TRUNC = 100; // free exports include only the first 100 messages
const PLANS = {
  free: { name: 'Free', max: 200 * MB, trunc: FREE_TRUNC },
  paid: { name: 'Full export', max: 1024 * MB, trunc: 0 },
};
const T = { subs: 'subscriptions', pay: 'payments', sms: 'bank_sms', keys: 'ext_keys' };
const METHODS = ['JazzCash', 'Easypaisa', 'SadaPay'];
const PAID_PKR = 100; // PKR per paid export (used to validate wallet-SMS amounts)
const NOPE = { ok: false, reason: 'Not allowed.' };
const DB = () => process.env.DATABASE_ID || 'chatprinter';
const code = (e) => (e && (e.code || e.status)) || 0;
const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex');

// Legacy time-based plans count as paid until their expiry date.
const effective = (s) => (s.plan === 'paid' ? 'paid' : ['pro', 'ultra'].includes(s.plan) && s.expiresAt && new Date(s.expiresAt) > new Date() ? 'paid' : 'free');

// In-memory sliding-window rate limit: 30 calls per minute per user+action.
const hits = new Map();
function rateLimit(uid, action) {
  const key = uid + '|' + action, now = Date.now(), win = 60e3;
  const arr = (hits.get(key) || []).filter((t) => now - t < win);
  if (arr.length >= 30) return false;
  arr.push(now);
  hits.set(key, arr);
  if (hits.size > 5000) hits.clear(); // bound memory
  return true;
}

async function getSub(db, uid) {
  const base = { databaseId: DB(), tableId: T.subs, rowId: uid };
  try {
    return await db.getRow(base);
  } catch (e) {
    if (code(e) !== 404) throw e;
    try {
      return await db.createRow({ ...base, data: { userId: uid, plan: 'free', freeUsed: 0, credits: 0, exports: 0 } });
    } catch (e2) {
      if (code(e2) !== 409) throw e2;
      return db.getRow(base);
    }
  }
}

async function status(db, uid, admin) {
  const s = await getSub(db, uid);
  const eff = effective(s);
  return { ok: true, plan: eff, credits: s.credits || 0, exports: s.exports || 0, free_used: (s.plan === 'free' && (s.freeUsed || 0) > 0) || eff === 'paid', is_admin: admin };
}

// Quota is consumed atomically; if the new value is over the limit we undo it and refuse.
async function begin(db, uid, size) {
  if (!Number.isFinite(size) || size < 0) return { ok: false, reason: 'Invalid file size.' };
  const s = await getSub(db, uid);
  const eff = effective(s);
  const P = PLANS[eff];
  if (size > P.max) return { ok: false, reason: 'This file is too large for the ' + P.name + ' plan (' + Math.round(P.max / MB) + ' MB max). See Billing to unlock a full export.' };
  if (eff === 'free') {
    const a = { databaseId: DB(), tableId: T.subs, rowId: uid, column: 'freeUsed', value: 1 };
    const r = await db.incrementRowColumn(a);
    if ((r.freeUsed || 0) > 1) {
      await db.decrementRowColumn(a);
      return { ok: false, reason: 'Your free export is already used. Pay once to export the full chat.' };
    }
  } else if (s.plan === 'paid') {
    // Paid by credits: consume one. Legacy pro/ultra rows (plan pro/ultra) skip this while unexpired.
    const a = { databaseId: DB(), tableId: T.subs, rowId: uid, column: 'credits', value: -1 };
    const r = await db.incrementRowColumn(a);
    if ((r.credits || 0) < 0) {
      await db.incrementRowColumn({ ...a, value: 1 });
      return { ok: false, reason: 'You have no paid exports left. Pay once to add another.' };
    }
  }
  try {
    await db.incrementRowColumn({ databaseId: DB(), tableId: T.subs, rowId: uid, column: 'exports', value: 1 });
  } catch (e) {
    /* older databases without the exports column: quota still enforced, stats just miss it */
  }
  return { ok: true, plan: eff, media: eff !== 'free', trunc: P.trunc || 0 };
}

const safeEq = (a, b) => timingSafeEqual(createHash('sha256').update(String(a)).digest(), createHash('sha256').update(String(b)).digest());
const rawBody = (req) => (typeof req.bodyText === 'string' ? req.bodyText : typeof req.bodyRaw === 'string' ? req.bodyRaw : typeof req.body === 'string' ? req.body : '');

// Pulls the Transaction ID and the amount out of a wallet confirmation SMS (formats differ, so it only trusts a labelled ID).
export function parseSms(text) {
  const t = String(text || '');
  const idm = t.match(/\b(?:tid|trx\.?\s*id|txn\.?\s*id|trans(?:action)?\.?\s*(?:id|no\.?|number)|ref(?:erence)?\.?\s*(?:id|no\.?|number)?)\b\s*[:#.\-]?\s*([A-Za-z0-9-]{6,30})/i);
  const am = t.match(/(?:rs\.?|pkr)\s*([\d,]+(?:\.\d{1,2})?)/i);
  return { tid: idm ? idm[1].toUpperCase() : '', amount: am ? Math.round(parseFloat(am[1].replace(/,/g, '')) * 100) : 0 };
}

export function verifyPaddle(raw, header, secret, nowMs = Date.now()) {
  if (!secret || !header) return false;
  const pairs = String(header).split(';').map((x) => x.split('=')).filter((x) => x.length === 2).map(([k, v]) => [k.trim(), v.trim()]);
  const ts = (pairs.find(([k]) => k === 'ts') || [])[1];
  const hs = pairs.filter(([k]) => k === 'h1').map(([, v]) => v);
  if (!ts || !hs.length || Math.abs(nowMs / 1000 - Number(ts)) > 300) return false;
  const h = createHmac('sha256', secret).update(ts + ':' + raw).digest('hex');
  return hs.some((x) => safeEq(h, x));
}

// One approved payment = one export credit.
async function addCredit(db, uid, n = 1) {
  await getSub(db, uid);
  const a = { databaseId: DB(), tableId: T.subs, rowId: uid, column: 'credits', value: Math.abs(n) };
  if (n >= 0) await db.incrementRowColumn(a);
  else {
    const r = await db.decrementRowColumn(a);
    if ((r.credits || 0) < 0) {
      await db.incrementRowColumn(a);
      return { ok: false, reason: 'Not enough credits to remove.' };
    }
  }
  await db.updateRow({ databaseId: DB(), tableId: T.subs, rowId: uid, data: { plan: 'paid' } });
  return { ok: true };
}

async function approveRow(db, p, source) {
  await addCredit(db, p.userId, 1);
  await db.updateRow({ databaseId: DB(), tableId: T.pay, rowId: p.$id, data: { status: 'approved', source } });
}

// A payment row can carry newer columns; if the database has not been updated yet, fall back to the old shape.
async function createPay(db, data) {
  try {
    return await db.createRow({ databaseId: DB(), tableId: T.pay, rowId: ID.unique(), data });
  } catch (e) {
    if (code(e) === 400 && /attribute|column/i.test(String(e.message))) {
      const { currency, amountCents, source, ...legacy } = data;
      return db.createRow({ databaseId: DB(), tableId: T.pay, rowId: ID.unique(), data: legacy });
    }
    throw e;
  }
}

async function autoMatch(db, p) {
  if (!process.env.SMS_SECRET) return false;
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const r = await db.listRows({ databaseId: DB(), tableId: T.sms, queries: [Query.greaterThan('$createdAt', since), Query.orderDesc('$createdAt'), Query.limit(200)] });
  const need = PAID_PKR * 100;
  for (const row of r.rows) {
    if (row.matched) continue;
    const s = parseSms(row.text);
    if (s.tid === p.tid && s.amount >= need) {
      await approveRow(db, p, 'sms');
      await db.updateRow({ databaseId: DB(), tableId: T.sms, rowId: row.$id, data: { matched: p.$id } });
      return true;
    }
  }
  return false;
}

async function smsHook(db, req, res) {
  if (!process.env.SMS_SECRET) return res.json({ ok: false, reason: 'SMS verification is not enabled.' }, 503);
  if (!safeEq(req.headers['x-sms-secret'] || '', process.env.SMS_SECRET)) return res.json({ ok: false }, 401);
  let b = null;
  try {
    b = JSON.parse(rawBody(req));
  } catch (e) {
    b = null;
  }
  const text = String((b && (b.text || b.message || b.body)) || '').slice(0, 1000);
  if (!text) return res.json({ ok: false, reason: 'No text.' }, 400);
  const row = await db.createRow({ databaseId: DB(), tableId: T.sms, rowId: ID.unique(), data: { text, matched: '' } });
  const s = parseSms(text);
  let matched = false;
  if (s.tid) {
    const q = await db.listRows({ databaseId: DB(), tableId: T.pay, queries: [Query.equal('tid', [s.tid]), Query.equal('status', ['pending']), Query.limit(1)] });
    const p = q.rows[0];
    if (p && s.amount >= PAID_PKR * 100) {
      await approveRow(db, p, 'sms');
      await db.updateRow({ databaseId: DB(), tableId: T.sms, rowId: row.$id, data: { matched: p.$id } });
      matched = true;
    }
  }
  try {
    const old = await db.listRows({ databaseId: DB(), tableId: T.sms, queries: [Query.lessThan('$createdAt', new Date(Date.now() - 30 * 864e5).toISOString()), Query.limit(25)] });
    for (const o of old.rows) await db.deleteRow({ databaseId: DB(), tableId: T.sms, rowId: o.$id });
  } catch (e) {
    /* pruning is best effort */
  }
  return res.json({ ok: true, matched });
}

async function paddleHook(db, req, res) {
  const raw = rawBody(req);
  if (!verifyPaddle(raw, req.headers['paddle-signature'], process.env.PADDLE_WEBHOOK_SECRET)) return res.json({ ok: false }, 401);
  let ev;
  try {
    ev = JSON.parse(raw);
  } catch (e) {
    return res.json({ ok: false }, 400);
  }
  if (ev.event_type !== 'transaction.completed') return res.json({ ok: true, ignored: true });
  const d = ev.data || {};
  const cd = d.custom_data || {};
  const plan = String(cd.plan || '');
  const uid = String(cd.user_id || '');
  if (!uid || plan !== 'paid' || !d.id) return res.json({ ok: true, ignored: true });
  const total = Number(d.details && d.details.totals && d.details.totals.total) || 0;
  let row;
  try {
    row = await createPay(db, { userId: uid, plan, method: 'Card', tid: String(d.id).slice(0, 30), name: 'Card checkout', status: 'approved', currency: String(d.currency_code || 'USD').slice(0, 3), amountCents: Math.round(total), source: 'paddle' });
  } catch (e) {
    if (code(e) === 409) return res.json({ ok: true, duplicate: true });
    throw e;
  }
  try {
    await addCredit(db, uid, 1);
  } catch (e) {
    await db.deleteRow({ databaseId: DB(), tableId: T.pay, rowId: row.$id });
    throw e;
  }
  return res.json({ ok: true });
}

async function createCheckout(uid, b) {
  const key = process.env.PADDLE_API_KEY;
  const plan = String(b.plan || '');
  const price = plan === 'paid' ? process.env.PADDLE_PRICE_PAID || process.env.PADDLE_PRICE_PRO : '';
  if (!key || !price) return { ok: false, reason: 'Card payments are not set up yet.' };
  const base = process.env.PADDLE_ENV === 'production' ? 'https://api.paddle.com' : 'https://sandbox-api.paddle.com';
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10000);
  try {
    const r = await fetch(base + '/transactions', { method: 'POST', signal: ctl.signal, headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ price_id: price, quantity: 1 }], custom_data: { user_id: uid, plan } }) });
    const j = await r.json().catch(() => ({}));
    const url = j && j.data && j.data.checkout && j.data.checkout.url;
    if (!r.ok || !url) return { ok: false, reason: 'Could not start the card payment. Try again later.' };
    return { ok: true, url };
  } catch (e) {
    return { ok: false, reason: 'Could not start the card payment. Try again later.' };
  } finally {
    clearTimeout(timer);
  }
}

async function submit(db, uid, b) {
  const plan = String(b.plan || '');
  const method = String(b.method || '');
  const tid = String(b.tid || '').trim().toUpperCase();
  const name = String(b.name || '').trim();
  if (plan !== 'paid' || !METHODS.includes(method) || !/^[A-Z0-9-]{6,30}$/.test(tid) || name.length < 1 || name.length > 80)
    return { ok: false, reason: 'Check the details and try again.' };
  const pend = await db.listRows({ databaseId: DB(), tableId: T.pay, queries: [Query.equal('userId', [uid]), Query.equal('status', ['pending']), Query.limit(6)] });
  if (pend.rows.length >= 5) return { ok: false, reason: 'Too many pending payments. Please wait for approval.' };
  let row;
  try {
    row = await createPay(db, { userId: uid, plan, method, tid, name, status: 'pending', currency: 'PKR', amountCents: PAID_PKR * 100, source: 'manual' });
  } catch (e) {
    if (code(e) === 409) return { ok: false, reason: 'This Transaction ID was already submitted.' };
    throw e;
  }
  let activated = false;
  try {
    activated = await autoMatch(db, row);
  } catch (e) {
    activated = false;
  }
  return { ok: true, activated };
}

async function myPayments(db, uid) {
  const r = await db.listRows({ databaseId: DB(), tableId: T.pay, queries: [Query.equal('userId', [uid]), Query.orderDesc('$createdAt'), Query.limit(10)] });
  return { ok: true, rows: r.rows.map((x) => ({ id: x.$id, plan: x.plan, tid: x.tid, status: x.status, method: x.method, currency: x.currency || 'PKR', amountCents: x.amountCents || (x.plan === 'paid' ? PAID_PKR * 100 : 0), source: x.source || 'manual', created: x.$createdAt })) };
}

// Extension login: the extension sends the key the user pasted. The key's SHA-256 is the row id
// of a lookup row (ext_keys) that points at the account, so no session is needed from the extension.
async function extAuth(db, b) {
  const key = String(b.key || '').trim();
  if (!/^cp_[0-9a-f]{48}$/.test(key)) return { ok: false, reason: 'Invalid extension key.' };
  let row;
  try {
    row = await db.getRow({ databaseId: DB(), tableId: T.keys, rowId: sha256(key) });
  } catch (e) {
    if (code(e) === 404) return { ok: false, reason: 'Wrong extension key. Create a key on the website and paste it here.' };
    throw e;
  }
  const s = await getSub(db, row.userId);
  let eff = effective(s);
  if (b.consume) {
    // The extension spends one export here (free quota or one credit), same rules as "begin".
    const r = await begin(db, row.userId, 0);
    if (!r.ok) return r;
    eff = r.plan;
    const s2 = await getSub(db, row.userId);
    return { ok: true, plan: eff, media: r.media, trunc: r.trunc || 0, credits: s2.credits || 0 };
  }
  return { ok: true, plan: eff, media: eff !== 'free', trunc: PLANS[eff].trunc || 0, credits: s.credits || 0 };
}

// Create (or rotate) the signed-in user's extension key. Shown once; only its SHA-256 is stored.
async function extKey(db, users, uid) {
  const key = 'cp_' + randomBytes(24).toString('hex');
  let prefs = {};
  try {
    prefs = (await users.get({ userId: uid })).prefs || {};
  } catch (e) {
    return { ok: false, reason: 'Could not load your account.' };
  }
  if (prefs.extKeyHash) {
    try {
      await db.deleteRow({ databaseId: DB(), tableId: T.keys, rowId: prefs.extKeyHash });
    } catch (e) {
      /* old key row already gone */
    }
  }
  await db.createRow({ databaseId: DB(), tableId: T.keys, rowId: sha256(key), data: { userId: uid } });
  await users.updatePrefs({ userId: uid, prefs: { ...prefs, extKeyHash: sha256(key) } });
  return { ok: true, key };
}

async function adminDecide(db, b) {
  const id = String(b.id || '');
  const p = await db.getRow({ databaseId: DB(), tableId: T.pay, rowId: id });
  if (p.status !== 'pending') return { ok: false, reason: 'This payment was already handled.' };
  if (b.decision === 'approve') {
    await approveRow(db, p, 'admin');
    return { ok: true };
  }
  if (b.decision === 'reject') {
    await db.updateRow({ databaseId: DB(), tableId: T.pay, rowId: id, data: { status: 'rejected' } });
    return { ok: true };
  }
  return { ok: false, reason: 'Unknown decision.' };
}

async function adminPayments(db, b) {
  const st = String(b.status || 'pending');
  const qs = [Query.orderDesc('$createdAt'), Query.limit(Math.min(500, Math.max(1, Number(b.limit) || 50)))];
  if (['pending', 'approved', 'rejected'].includes(st)) qs.unshift(Query.equal('status', [st]));
  const r = await db.listRows({ databaseId: DB(), tableId: T.pay, queries: qs });
  return { ok: true, rows: r.rows.map((x) => ({ id: x.$id, plan: x.plan, method: x.method, tid: x.tid, name: x.name, status: x.status, userId: x.userId, created: x.$createdAt, source: x.source || 'manual', currency: x.currency || 'PKR', amountCents: x.amountCents || (x.plan === 'paid' ? PAID_PKR * 100 : 0) })) };
}

async function adminStats(db, users) {
  const cnt = async (qs) => (await db.listRows({ databaseId: DB(), tableId: T.pay, queries: [...qs, Query.limit(1)] })).total;
  const [pending, approved, paid] = await Promise.all([cnt([Query.equal('status', ['pending'])]), cnt([Query.equal('status', ['approved'])]), cnt([Query.equal('status', ['approved']), Query.equal('plan', ['paid'])])]);
  const act = await db.listRows({ databaseId: DB(), tableId: T.subs, queries: [Query.greaterThan('credits', 0), Query.limit(1)] });
  let total = null;
  try {
    total = (await users.list({ queries: [Query.limit(1)] })).total;
  } catch (e) {
    total = null; // needs the users.read scope
  }
  return { ok: true, users: total, active: act.total, pending, approved, revenue: paid * PAID_PKR };
}

async function adminUsers(db, users, b) {
  const limit = 25;
  const offset = Math.max(0, Number(b.offset) || 0);
  const search = b.search ? String(b.search).slice(0, 60) : undefined;
  let list;
  try {
    list = await users.list({ queries: [Query.limit(limit), Query.offset(offset), Query.orderDesc('$createdAt')], search });
  } catch (e) {
    return { ok: false, reason: 'Could not list users. Give the function the users.read scope and redeploy.' };
  }
  const subs = new Map();
  if (list.users.length) {
    const r = await db.listRows({ databaseId: DB(), tableId: T.subs, queries: [Query.equal('$id', list.users.map((u) => u.$id)), Query.limit(limit)] });
    r.rows.forEach((x) => subs.set(x.$id, x));
  }
  return {
    ok: true,
    total: list.total,
    rows: list.users.map((u) => {
      const s = subs.get(u.$id);
      return { id: u.$id, name: u.name || '', email: u.email || '', phone: (u.prefs && u.prefs.phone) || '', verified: !!u.emailVerification, created: u.registration, plan: s ? effective(s) : 'free', credits: s ? s.credits || 0 : 0, exports: s ? s.exports || 0 : 0 };
    }),
  };
}

async function adminCredits(db, b) {
  const uid = String(b.userId || '');
  const n = Math.trunc(Number(b.add));
  if (!uid || !Number.isFinite(n) || n === 0 || Math.abs(n) > 100) return { ok: false, reason: 'Check the details and try again.' };
  return addCredit(db, uid, n);
}

async function adminSetPlan(db, b) {
  const uid = String(b.userId || '');
  const plan = String(b.plan || '');
  if (!uid || !['free', 'paid'].includes(plan)) return { ok: false, reason: 'Check the details and try again.' };
  await getSub(db, uid);
  await db.updateRow({ databaseId: DB(), tableId: T.subs, rowId: uid, data: plan === 'free' ? { plan: 'free', credits: 0 } : { plan: 'paid' } });
  return { ok: true };
}

async function adminRevenue(db) {
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const r = await db.listRows({ databaseId: DB(), tableId: T.pay, queries: [Query.equal('status', ['approved']), Query.greaterThan('$createdAt', since), Query.limit(500)] });
  const days = {};
  const totals = {};
  for (const x of r.rows) {
    const d = String(x.$createdAt).slice(0, 10);
    days[d] = (days[d] || 0) + 1;
    const c = x.currency || 'PKR';
    totals[c] = (totals[c] || 0) + (x.amountCents || (x.plan === 'paid' ? PAID_PKR * 100 : 0));
  }
  return { ok: true, days, totals };
}

async function adminAutomation(db) {
  let sms = [];
  try {
    const r = await db.listRows({ databaseId: DB(), tableId: T.sms, queries: [Query.orderDesc('$createdAt'), Query.limit(10)] });
    sms = r.rows.map((x) => ({ id: x.$id, created: x.$createdAt, matched: !!x.matched, text: String(x.text || '').slice(0, 90) }));
  } catch (e) {
    sms = [];
  }
  const paddlePrice = process.env.PADDLE_PRICE_PAID || process.env.PADDLE_PRICE_PRO;
  return { ok: true, sms_enabled: !!process.env.SMS_SECRET, paddle_ready: !!(process.env.PADDLE_API_KEY && paddlePrice), paddle_webhook: !!process.env.PADDLE_WEBHOOK_SECRET, paddle_env: process.env.PADDLE_ENV === 'production' ? 'production' : 'sandbox', sms };
}

// Creates the database, tables, columns and indexes. Safe to run again: existing things are skipped.
async function setup(db) {
  const log = [];
  const d = DB();
  const run = async (label, fn) => {
    try {
      await fn();
      log.push(label + ': created');
    } catch (e) {
      log.push(label + ': ' + (code(e) === 409 ? 'already exists' : 'NOT READY - ' + (e && e.message ? e.message : e)));
    }
  };
  const str = (t, key, size, required, xdefault) => run(t + '.' + key, () => db.createStringColumn({ databaseId: d, tableId: t, key, size, required, xdefault }));
  const int = (t, key) => run(t + '.' + key, () => db.createIntegerColumn({ databaseId: d, tableId: t, key, required: false, xdefault: 0 }));
  // Appwrite's free plan allows one database and then refuses even to say "already exists",
  // so look first and only create when it is really missing.
  try {
    await db.get({ databaseId: d });
    log.push('database: already exists');
  } catch (e) {
    if (code(e) === 404) await run('database', () => db.create({ databaseId: d, name: 'Chat Printer' }));
    else log.push('database: NOT READY - ' + (e && e.message ? e.message : e));
  }
  for (const [id, name] of [[T.subs, 'Subscriptions'], [T.pay, 'Payments'], [T.sms, 'Bank SMS'], [T.keys, 'Extension keys']])
    await run('table ' + id, () => db.createTable({ databaseId: d, tableId: id, name, permissions: [], rowSecurity: false }));
  await str(T.subs, 'userId', 36, true);
  await str(T.subs, 'plan', 10, false, 'free');
  await int(T.subs, 'freeUsed');
  await int(T.subs, 'credits');
  await int(T.subs, 'exports');
  await run(T.subs + '.expiresAt', () => db.createDatetimeColumn({ databaseId: d, tableId: T.subs, key: 'expiresAt', required: false }));
  await str(T.pay, 'userId', 36, true);
  await str(T.pay, 'plan', 10, true);
  await str(T.pay, 'method', 20, true);
  await str(T.pay, 'tid', 30, true);
  await str(T.pay, 'name', 80, true);
  await str(T.pay, 'status', 12, false, 'pending');
  await str(T.pay, 'currency', 3, false, 'PKR');
  await str(T.pay, 'source', 12, false, 'manual');
  await int(T.pay, 'amountCents');
  await str(T.sms, 'text', 1000, true);
  await str(T.sms, 'matched', 40, false, '');
  await str(T.keys, 'userId', 36, true);
  const idx = (table, key, type, col) => run('index ' + key, () => db.createIndex({ databaseId: d, tableId: table, key, type, columns: [col] }));
  await idx(T.pay, 'tid_unique', TablesDBIndexType.Unique, 'tid');
  await idx(T.pay, 'user_idx', TablesDBIndexType.Key, 'userId');
  await idx(T.pay, 'status_idx', TablesDBIndexType.Key, 'status');
  await idx(T.subs, 'credits_idx', TablesDBIndexType.Key, 'credits');
  const ready = log.every((l) => !l.includes('NOT READY'));
  return { ok: true, ready, log, note: ready ? 'Setup complete.' : 'Some items are still being created. Wait about a minute and press the button again.' };
}

export const makeHandler = (db, users) => async ({ req, res, error }) => {
  const method = String(req.method || '').toUpperCase();
  if (method === 'POST' && (req.path === '/sms' || req.path === '/paddle')) {
    try {
      return await (req.path === '/sms' ? smsHook : paddleHook)(db, req, res);
    } catch (e) {
      error(String((e && e.stack) || e));
      return res.json({ ok: false }, 500);
    }
  }
  // Hard body cap: nothing we accept is ever close to this.
  if (rawBody(req).length > 20000) return res.json({ ok: false, reason: 'Request too large.' });
  let b = {};
  try {
    b = req.bodyJson || (req.body ? JSON.parse(req.body) : {});
  } catch (e) {
    return res.json({ ok: false, reason: 'Bad request.' });
  }
  const action = String(b.action || '').slice(0, 30);
  // Extension login has no Appwrite session; it proves itself with the extension key instead.
  if (action === 'ext_auth') {
    try {
      if (!rateLimit('ext', sha256(String(b.key || '')).slice(0, 24))) return res.json({ ok: false, reason: 'Too many attempts. Slow down and try again.' });
      return res.json(await extAuth(db, b));
    } catch (e) {
      error(String((e && e.stack) || e));
      return res.json({ ok: false, reason: 'Server error. Try again.' });
    }
  }
  const uid = req.headers['x-appwrite-user-id'];
  if (!uid) return res.json({ ok: false, reason: 'Please sign in first.' });
  if (!rateLimit(uid, action || 'none')) return res.json({ ok: false, reason: 'Too many requests. Slow down and try again.' });
  const admin = !!process.env.ADMIN_USER_ID && uid === process.env.ADMIN_USER_ID;
  try {
    switch (action) {
      case 'status':
        try {
          return res.json(await status(db, uid, admin));
        } catch (e) {
          // Before the first setup the tables do not exist; the owner still needs to see the Admin box.
          if (admin && code(e) === 404) return res.json({ ok: true, plan: 'free', credits: 0, exports: 0, free_used: false, is_admin: true, setup_needed: true });
          throw e;
        }
      case 'begin': return res.json(await begin(db, uid, Number(b.size)));
      case 'submit_payment': return res.json(await submit(db, uid, b));
      case 'my_payments': return res.json(await myPayments(db, uid));
      case 'create_checkout': return res.json(await createCheckout(uid, b));
      case 'ext_auth': return res.json(await extAuth(db, b));
      case 'ext_key': return res.json(await extKey(db, users, uid));
      case 'admin_pending': return res.json(admin ? await adminPayments(db, { status: 'pending' }) : NOPE);
      case 'admin_payments': return res.json(admin ? await adminPayments(db, b) : NOPE);
      case 'admin_revenue': return res.json(admin ? await adminRevenue(db) : NOPE);
      case 'admin_automation': return res.json(admin ? await adminAutomation(db) : NOPE);
      case 'admin_stats': return res.json(admin ? await adminStats(db, users) : NOPE);
      case 'admin_users': return res.json(admin ? await adminUsers(db, users, b) : NOPE);
      case 'admin_credits': return res.json(admin ? await adminCredits(db, b) : NOPE);
      case 'admin_set_plan': return res.json(admin ? await adminSetPlan(db, b) : NOPE);
      case 'admin_decide': return res.json(admin ? await adminDecide(db, b) : NOPE);
      case 'admin_setup': return res.json(admin ? await setup(db) : NOPE);
      default: return res.json({ ok: false, reason: 'Unknown action.' });
    }
  } catch (e) {
    error(String((e && e.stack) || e));
    if (code(e) === 404) return res.json({ ok: false, reason: 'The database is not set up yet.' });
    return res.json({ ok: false, reason: 'Server error. Try again.' });
  }
};

export default async (ctx) => {
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT)
    .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
    .setKey(process.env.API_KEY || ctx.req.headers['x-appwrite-key']);
  return makeHandler(new TablesDB(client), new Users(client))(ctx);
};
