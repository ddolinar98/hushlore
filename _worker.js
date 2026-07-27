/**
 * Hushlore — Cloudflare Pages advanced-mode Worker.
 *
 * Serves the static site, plus:
 *   POST /api/auth/register   { email, password }     → create account (+ claim pending grant)
 *   POST /api/auth/login      { email, password }     → session cookie
 *   POST /api/auth/logout                             → clear cookie
 *   GET  /api/auth/me                                 → { email, sub: { active, expires_at, plan } }
 *   POST /api/admin/grant     { email, plan, months } → grant/extend access (needs x-admin-key)
 *   GET  /audio/<id>.mp3                              → streams from R2, active subscribers only
 *   POST /api/subscribe       { email, branch }       → MailerLite (marketing list)
 *
 * Bindings required: DB (D1 hushlore-db), AUDIO (R2 hushlore-audio)
 * Secrets required:  SESSION_SECRET, ADMIN_KEY        (optional: MAILERLITE_TOKEN)
 */

const SESSION_DAYS = 30;
const PBKDF2_ITER = 100000;

/** Never serve config / source / data files, whatever ends up in the deploy. */
const BLOCKED = /^\/(\.|wrangler\.toml|package(-lock)?\.json|.*\.(sql|py|toml|env|log|xlsx|docx|pages|md)$|_build-scripts\/|Creators\/|production\/|audio-tests\/)/i;

export default {
  async fetch(request, env) {
    const p = new URL(request.url).pathname;
    if (BLOCKED.test(p)) return new Response('Not found', { status: 404 });
    try {
      if (p === '/api/auth/register') return requirePost(request, () => register(request, env));
      if (p === '/api/auth/login')    return requirePost(request, () => login(request, env));
      if (p === '/api/auth/logout')   return requirePost(request, () => logout());
      if (p === '/api/auth/me')       return me(request, env);
      if (p === '/api/admin/grant')   return requirePost(request, () => adminGrant(request, env));
      if (p === '/api/subscribe')     return requirePost(request, () => subscribe(request, env));
      if (p.startsWith('/audio/'))    return serveAudio(request, env, p.slice('/audio/'.length));
    } catch (e) {
      return json({ error: 'server_error' }, 500);
    }
    return env.ASSETS.fetch(request);
  }
};

/* ───────────────────────────── helpers ───────────────────────────── */

function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers }
  });
}
function requirePost(request, fn) {
  return request.method === 'POST' ? fn() : json({ error: 'method_not_allowed' }, 405);
}
function normEmail(e) { return String(e || '').trim().toLowerCase(); }
function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
function nowISO() { return new Date().toISOString(); }

const enc = new TextEncoder();
function b64(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))); }
function b64url(str) { return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function unb64url(str) { return atob(str.replace(/-/g, '+').replace(/_/g, '/')); }

/** constant-time compare */
function safeEqual(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ──────────────────────────── passwords ──────────────────────────── */

async function hashPassword(password, saltB64, iter = PBKDF2_ITER) {
  const salt = saltB64
    ? Uint8Array.from(atob(saltB64), c => c.charCodeAt(0))
    : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, key, 256
  );
  return { hash: b64(bits), salt: b64(salt), iter };
}

/* ───────────────────────────── sessions ───────────────────────────── */

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return b64url(String.fromCharCode(...new Uint8Array(sig)));
}

async function makeSession(env, userId) {
  const payload = b64url(JSON.stringify({ uid: userId, exp: Date.now() + SESSION_DAYS * 864e5 }));
  return payload + '.' + await hmac(env.SESSION_SECRET, payload);
}

async function readSession(env, request) {
  const m = /(?:^|;\s*)hl_sess=([^;]+)/.exec(request.headers.get('Cookie') || '');
  if (!m) return null;
  const parts = decodeURIComponent(m[1]).split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  if (!safeEqual(sig, await hmac(env.SESSION_SECRET, payload))) return null;
  try {
    const data = JSON.parse(unb64url(payload));
    if (!data.uid || !data.exp || Date.now() > data.exp) return null;
    return data.uid;
  } catch (_) { return null; }
}

function sessionCookie(value, maxAge) {
  return `hl_sess=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

/* ────────────────────────── subscriptions ────────────────────────── */

async function activeSub(env, userId) {
  return await env.DB.prepare(
    `SELECT plan, expires_at FROM subscriptions
      WHERE user_id = ?1 AND status = 'active' AND expires_at > ?2
      ORDER BY expires_at DESC LIMIT 1`
  ).bind(userId, nowISO()).first();
}

function subShape(sub) {
  return sub ? { active: true, plan: sub.plan, expires_at: sub.expires_at } : { active: false };
}

/** Adds months on top of an existing expiry so renewals stack instead of reset. */
async function grantAccess(env, userId, plan, months, source, ref) {
  const cur = await activeSub(env, userId);
  const expires = new Date(cur ? cur.expires_at : Date.now());
  expires.setMonth(expires.getMonth() + Number(months));
  await env.DB.prepare(
    `INSERT INTO subscriptions (id, user_id, plan, started_at, expires_at, status, source, ref, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 'active', ?6, ?7, ?4)`
  ).bind(crypto.randomUUID(), userId, plan, nowISO(), expires.toISOString(), source || 'manual', ref || null).run();
  return expires.toISOString();
}

/* ──────────────────────────── auth routes ──────────────────────────── */

async function register(request, env) {
  const body = await request.json().catch(() => ({}));
  const email = normEmail(body.email);
  const password = String(body.password || '');
  if (!validEmail(email)) return json({ error: 'invalid_email' }, 400);
  if (password.length < 8) return json({ error: 'weak_password' }, 400);

  if (await env.DB.prepare('SELECT id FROM users WHERE email = ?1').bind(email).first()) {
    return json({ error: 'email_taken' }, 409);
  }

  const { hash, salt, iter } = await hashPassword(password);
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO users (id, email, pass_hash, pass_salt, pass_iter, created_at, last_login_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)`
  ).bind(id, email, hash, salt, iter, nowISO()).run();

  // access bought before the account existed
  const pending = await env.DB.prepare('SELECT * FROM pending_grants WHERE email = ?1').bind(email).first();
  if (pending) {
    await grantAccess(env, id, pending.plan, pending.months, pending.source, pending.ref);
    await env.DB.prepare('DELETE FROM pending_grants WHERE email = ?1').bind(email).run();
  }

  return json({ ok: true, email, sub: subShape(await activeSub(env, id)) }, 200,
    { 'Set-Cookie': sessionCookie(await makeSession(env, id), SESSION_DAYS * 86400) });
}

async function login(request, env) {
  const body = await request.json().catch(() => ({}));
  const email = normEmail(body.email);
  const password = String(body.password || '');
  const user = await env.DB.prepare(
    'SELECT id, pass_hash, pass_salt, pass_iter FROM users WHERE email = ?1'
  ).bind(email).first();

  // identical failure for unknown email and wrong password
  if (!user) { await hashPassword(password || 'x'); return json({ error: 'bad_credentials' }, 401); }
  const { hash } = await hashPassword(password, user.pass_salt, user.pass_iter);
  if (!safeEqual(hash, user.pass_hash)) return json({ error: 'bad_credentials' }, 401);

  await env.DB.prepare('UPDATE users SET last_login_at = ?1 WHERE id = ?2').bind(nowISO(), user.id).run();
  return json({ ok: true, email, sub: subShape(await activeSub(env, user.id)) }, 200,
    { 'Set-Cookie': sessionCookie(await makeSession(env, user.id), SESSION_DAYS * 86400) });
}

function logout() {
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0) });
}

async function me(request, env) {
  const uid = await readSession(env, request);
  if (!uid) return json({ authenticated: false });
  const user = await env.DB.prepare('SELECT email, created_at FROM users WHERE id = ?1').bind(uid).first();
  if (!user) return json({ authenticated: false });
  return json({
    authenticated: true, email: user.email, created_at: user.created_at,
    sub: subShape(await activeSub(env, uid))
  });
}

/** Manual grant (and later: payment webhook). Works before the buyer has an account. */
async function adminGrant(request, env) {
  if (!env.ADMIN_KEY || !safeEqual(request.headers.get('x-admin-key') || '', env.ADMIN_KEY)) {
    return json({ error: 'unauthorized' }, 401);
  }
  const body = await request.json().catch(() => ({}));
  const email = normEmail(body.email);
  if (!validEmail(email)) return json({ error: 'invalid_email' }, 400);

  const months = Number(body.months || ({ '1m': 1, '3m': 3, '6m': 6 })[body.plan] || 1);
  const plan = body.plan || (months === 6 ? '6m' : months === 3 ? '3m' : '1m');

  const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?1').bind(email).first();
  if (user) {
    const expires_at = await grantAccess(env, user.id, plan, months, body.source, body.ref);
    return json({ ok: true, mode: 'granted', email, expires_at });
  }
  await env.DB.prepare(
    `INSERT INTO pending_grants (email, plan, months, source, ref, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT(email) DO UPDATE SET plan = ?2, months = ?3, source = ?4, ref = ?5, created_at = ?6`
  ).bind(email, plan, months, body.source || 'manual', body.ref || null, nowISO()).run();
  return json({ ok: true, mode: 'pending', email, note: 'applies when the account is created' });
}

/* ───────────────────────── protected audio ───────────────────────── */

async function serveAudio(request, env, filename) {
  if (!/^[a-z0-9][a-z0-9-]*\.mp3$/i.test(filename)) return new Response('Not found', { status: 404 });

  const uid = await readSession(env, request);
  if (!uid) return json({ error: 'auth_required' }, 401);
  if (!await activeSub(env, uid)) return json({ error: 'subscription_required' }, 402);

  const obj = await env.AUDIO.get(filename, { range: request.headers, onlyIf: request.headers });
  if (!obj) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('Content-Type', 'audio/mpeg');
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', 'private, no-store');

  if (!obj.body) return new Response(null, { status: 304, headers });          // onlyIf matched
  if (obj.range && 'offset' in obj.range) {                                     // partial content
    const start = obj.range.offset || 0;
    const len = obj.range.length != null ? obj.range.length : obj.size - start;
    headers.set('Content-Range', `bytes ${start}-${start + len - 1}/${obj.size}`);
    return new Response(obj.body, { status: 206, headers });
  }
  return new Response(obj.body, { status: 200, headers });
}

/* ───────────────────────── marketing list ───────────────────────── */

async function subscribe(request, env) {
  try {
    const body = await request.json();
    const email = normEmail(body.email);
    if (!validEmail(email)) return json({ error: 'invalid email' }, 400);
    if (!env.MAILERLITE_TOKEN) return json({ ok: false, skipped: true });
    const res = await fetch('https://connect.mailerlite.com/api/subscribers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + env.MAILERLITE_TOKEN },
      body: JSON.stringify({
        email,
        groups: ['187738021652595766'],
        fields: { quiz_source: 'quiz2', branch: body.branch === 'men' ? 'men' : 'women' }
      })
    });
    return json({ ok: res.ok }, res.ok ? 200 : 502);
  } catch (e) {
    return json({ error: 'bad_request' }, 400);
  }
}
