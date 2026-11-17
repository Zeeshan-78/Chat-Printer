// Chat Printer backend (Appwrite Function). Every plan, quota and payment rule lives here, on the server.
// Visitors never get direct access to the database; they can only call the actions below.
import { Client, TablesDB, Users, Query, ID, TablesDBIndexType } from 'node-appwrite';
import { createHash } from 'node:crypto';

const MB = 1048576;
const PLANS = {
  free: { name: 'Free', max: 200 * MB, total: 2, day: 0 },
  pro: { name: 'Pro', max: 1024 * MB, total: 0, day: 20 },
  ultra: { name: 'Ultra Pro', max: 0, total: 0, day: 0 },
};
const T = { subs: 'subscriptions', daily: 'daily_usage', pay: 'payments' };
const METHODS = ['JazzCash', 'Easypaisa'];
const PRICES = { pro: 450, ultra: 750 };
const NOPE = { ok: false, reason: 'Not allowed.' };
const DB = () => process.env.DATABASE_ID || 'chatprinter';
const code = (e) => (e && (e.code || e.status)) || 0;
// Day counter runs on Pakistan time (UTC+5), so "next day" starts at midnight in Pakistan.
const pkDay = () => new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
const dayRowId = (uid, day) => createHash('sha256').update(uid + '|' + day).digest('hex').slice(0, 32);
const effective = (s) => (s.plan !== 'free' && s.expiresAt && new Date(s.expiresAt) > new Date() ? s.plan : 'free');

async function getSub(db, uid) {
  const base = { databaseId: DB(), tableId: T.subs, rowId: uid };
  try {
    return await db.getRow(base);
  } catch (e) {
    if (code(e) !== 404) throw e;
    try {
      return await db.createRow({ ...base, data: { userId: uid, plan: 'free', totalUsed: 0 } });
    } catch (e2) {
      if (code(e2) !== 409) throw e2;
      return db.getRow(base);
    }
  }
}

async function status(db, uid, admin) {
  const s = await getSub(db, uid);
  let d = 0;
  try {
    d = (await db.getRow({ databaseId: DB(), tableId: T.daily, rowId: dayRowId(uid, pkDay()) })).n || 0;
  } catch (e) {
    if (code(e) !== 404) throw e;
  }
  return { ok: true, plan: effective(s), expires_at: s.expiresAt || null, total_used: s.totalUsed || 0, day_used: d, is_admin: admin };
}

// Counters are incremented atomically; if the new value is over the limit we undo it and refuse.
async function begin(db, uid, size) {
  if (!Number.isFinite(size) || size < 0) return { ok: false, reason: 'Invalid file size.' };
  const s = await getSub(db, uid);
  const eff = effective(s);
  const P = PLANS[eff];
  if (P.max && size > P.max) return { ok: false, reason: 'This file is too large for the ' + P.name + ' plan. See Billing to upgrade.' };
  if (eff === 'free') {
    const a = { databaseId: DB(), tableId: T.subs, rowId: uid, column: 'totalUsed', value: 1 };
    const r = await db.incrementRowColumn(a);
    if (r.totalUsed > P.total) {
      await db.decrementRowColumn(a);
      return { ok: false, reason: 'You have used all ' + P.total + ' free conversions. See Billing to upgrade.' };
    }
  } else if (eff === 'pro') {
    const day = pkDay();
    const rowId = dayRowId(uid, day);
    try {
      await db.createRow({ databaseId: DB(), tableId: T.daily, rowId, data: { userId: uid, day, n: 0 } });
    } catch (e) {
      if (code(e) !== 409) throw e;
    }
    const a = { databaseId: DB(), tableId: T.daily, rowId, column: 'n', value: 1 };
    const r = await db.incrementRowColumn(a);
    if (r.n > P.day) {
      await db.decrementRowColumn(a);
      return { ok: false, reason: 'Daily limit of ' + P.day + ' reached. It renews tomorrow, or upgrade to Ultra Pro.' };
    }
  }
  return { ok: true, plan: eff, media: eff !== 'free' };
}

async function submit(db, uid, b) {
  const plan = String(b.plan || '');
  const method = String(b.method || '');
  const tid = String(b.tid || '').trim().toUpperCase();
  const name = String(b.name || '').trim();
  if (!['pro', 'ultra'].includes(plan) || !METHODS.includes(method) || !/^[A-Z0-9-]{6,30}$/.test(tid) || name.length < 1 || name.length > 80)
    return { ok: false, reason: 'Check the details and try again.' };
  const pend = await db.listRows({ databaseId: DB(), tableId: T.pay, queries: [Query.equal('userId', [uid]), Query.equal('status', ['pending']), Query.limit(6)] });
  if (pend.rows.length >= 5) return { ok: false, reason: 'Too many pending payments. Please wait for approval.' };
  try {
    await db.createRow({ databaseId: DB(), tableId: T.pay, rowId: ID.unique(), data: { userId: uid, plan, method, tid, name, status: 'pending' } });
  } catch (e) {
    if (code(e) === 409) return { ok: false, reason: 'This Transaction ID was already submitted.' };
    throw e;
  }
  return { ok: true };
}

async function myPayments(db, uid) {
  const r = await db.listRows({ databaseId: DB(), tableId: T.pay, queries: [Query.equal('userId', [uid]), Query.orderDesc('$createdAt'), Query.limit(10)] });
  return { ok: true, rows: r.rows.map((x) => ({ plan: x.plan, tid: x.tid, status: x.status })) };
}

async function adminDecide(db, b) {
  const id = String(b.id || '');
  const p = await db.getRow({ databaseId: DB(), tableId: T.pay, rowId: id });
  if (p.status !== 'pending') return { ok: false, reason: 'This payment was already handled.' };
  if (b.decision === 'approve') {
    const s = await getSub(db, p.userId);
    const now = Date.now();
    const keep = s.plan === p.plan && s.expiresAt && new Date(s.expiresAt).getTime() > now;
    const until = new Date((keep ? new Date(s.expiresAt).getTime() : now) + 30 * 864e5).toISOString();
    await db.updateRow({ databaseId: DB(), tableId: T.subs, rowId: p.userId, data: { plan: p.plan, expiresAt: until } });
    await db.updateRow({ databaseId: DB(), tableId: T.pay, rowId: id, data: { status: 'approved' } });
    return { ok: true, until };
  }
  if (b.decision === 'reject') {
    await db.updateRow({ databaseId: DB(), tableId: T.pay, rowId: id, data: { status: 'rejected' } });
    return { ok: true };
  }
  return { ok: false, reason: 'Unknown decision.' };
}

async function adminPayments(db, b) {
  const st = String(b.status || 'pending');
  const qs = [Query.orderDesc('$createdAt'), Query.limit(50)];
  if (['pending', 'approved', 'rejected'].includes(st)) qs.unshift(Query.equal('status', [st]));
  const r = await db.listRows({ databaseId: DB(), tableId: T.pay, queries: qs });
  return { ok: true, rows: r.rows.map((x) => ({ id: x.$id, plan: x.plan, method: x.method, tid: x.tid, name: x.name, status: x.status, userId: x.userId, created: x.$createdAt })) };
}

async function adminStats(db, users) {
  const cnt = async (qs) => (await db.listRows({ databaseId: DB(), tableId: T.pay, queries: [...qs, Query.limit(1)] })).total;
  const paid = (p) => cnt([Query.equal('status', ['approved']), Query.equal('plan', [p])]);
  const [pending, approved, pro, ultra] = await Promise.all([cnt([Query.equal('status', ['pending'])]), cnt([Query.equal('status', ['approved'])]), paid('pro'), paid('ultra')]);
  const act = await db.listRows({ databaseId: DB(), tableId: T.subs, queries: [Query.greaterThan('expiresAt', new Date().toISOString()), Query.limit(1)] });
  let total = null;
  try {
    total = (await users.list({ queries: [Query.limit(1)] })).total;
  } catch (e) {
    total = null; // needs the users.read scope
  }
  return { ok: true, users: total, active: act.total, pending, approved, revenue: pro * PRICES.pro + ultra * PRICES.ultra };
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
      return { id: u.$id, name: u.name || '', email: u.email || '', phone: (u.prefs && u.prefs.phone) || '', verified: !!u.emailVerification, created: u.registration, plan: s ? effective(s) : 'free', expires_at: (s && s.expiresAt) || null, total_used: s ? s.totalUsed || 0 : 0 };
    }),
  };
}

async function adminSetPlan(db, b) {
  const uid = String(b.userId || '');
  const plan = String(b.plan || '');
  const days = Math.min(3650, Math.max(1, Number(b.days) || 30));
  if (!uid || !['free', 'pro', 'ultra'].includes(plan)) return { ok: false, reason: 'Check the details and try again.' };
  await getSub(db, uid);
  const data = plan === 'free' ? { plan: 'free', expiresAt: null } : { plan, expiresAt: new Date(Date.now() + days * 864e5).toISOString() };
  await db.updateRow({ databaseId: DB(), tableId: T.subs, rowId: uid, data });
  return { ok: true };
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
  for (const [id, name] of [[T.subs, 'Subscriptions'], [T.daily, 'Daily usage'], [T.pay, 'Payments']])
    await run('table ' + id, () => db.createTable({ databaseId: d, tableId: id, name, permissions: [], rowSecurity: false }));
  await str(T.subs, 'userId', 36, true);
  await str(T.subs, 'plan', 10, false, 'free');
  await int(T.subs, 'totalUsed');
  await run(T.subs + '.expiresAt', () => db.createDatetimeColumn({ databaseId: d, tableId: T.subs, key: 'expiresAt', required: false }));
  await str(T.daily, 'userId', 36, true);
  await str(T.daily, 'day', 10, true);
  await int(T.daily, 'n');
  await str(T.pay, 'userId', 36, true);
  await str(T.pay, 'plan', 10, true);
  await str(T.pay, 'method', 20, true);
  await str(T.pay, 'tid', 30, true);
  await str(T.pay, 'name', 80, true);
  await str(T.pay, 'status', 12, false, 'pending');
  const idx = (table, key, type, col) => run('index ' + key, () => db.createIndex({ databaseId: d, tableId: table, key, type, columns: [col] }));
  await idx(T.pay, 'tid_unique', TablesDBIndexType.Unique, 'tid');
  await idx(T.pay, 'user_idx', TablesDBIndexType.Key, 'userId');
  await idx(T.pay, 'status_idx', TablesDBIndexType.Key, 'status');
  await idx(T.pay, 'plan_idx', TablesDBIndexType.Key, 'plan');
  await idx(T.subs, 'exp_idx', TablesDBIndexType.Key, 'expiresAt');
  const ready = log.every((l) => !l.includes('NOT READY'));
  return { ok: true, ready, log, note: ready ? 'Setup complete.' : 'Some items are still being created. Wait about a minute and press the button again.' };
}

export const makeHandler = (db, users) => async ({ req, res, error }) => {
  const uid = req.headers['x-appwrite-user-id'];
  if (!uid) return res.json({ ok: false, reason: 'Please sign in first.' });
  let b = {};
  try {
    b = req.bodyJson || (req.body ? JSON.parse(req.body) : {});
  } catch (e) {
    return res.json({ ok: false, reason: 'Bad request.' });
  }
  const admin = !!process.env.ADMIN_USER_ID && uid === process.env.ADMIN_USER_ID;
  try {
    switch (b.action) {
      case 'status':
        try {
          return res.json(await status(db, uid, admin));
        } catch (e) {
          // Before the first setup the tables do not exist; the owner still needs to see the Admin box.
          if (admin && code(e) === 404) return res.json({ ok: true, plan: 'free', expires_at: null, total_used: 0, day_used: 0, is_admin: true, setup_needed: true });
          throw e;
        }
      case 'begin': return res.json(await begin(db, uid, Number(b.size)));
      case 'submit_payment': return res.json(await submit(db, uid, b));
      case 'my_payments': return res.json(await myPayments(db, uid));
      case 'admin_pending': return res.json(admin ? await adminPayments(db, { status: 'pending' }) : NOPE);
      case 'admin_payments': return res.json(admin ? await adminPayments(db, b) : NOPE);
      case 'admin_stats': return res.json(admin ? await adminStats(db, users) : NOPE);
      case 'admin_users': return res.json(admin ? await adminUsers(db, users, b) : NOPE);
      case 'admin_set_plan': return res.json(admin ? await adminSetPlan(db, b) : NOPE);
      case 'admin_decide': return res.json(admin ? await adminDecide(db, b) : { ok: false, reason: 'Not allowed.' });
      case 'admin_setup': return res.json(admin ? await setup(db) : { ok: false, reason: 'Not allowed.' });
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
