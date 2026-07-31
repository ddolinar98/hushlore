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

      // ── creator chat ──────────────────────────────────────────────
      if (p === '/api/chat/creators')      return chatCreators(request, env);
      if (p === '/api/chat/me')            return chatMe(request, env);
      if (p === '/api/chat/threads')       return chatThreads(request, env);
      if (p === '/api/chat/open')          return requirePost(request, () => chatOpen(request, env));
      if (p === '/api/chat/messages')      return chatMessages(request, env);
      if (p === '/api/chat/send')          return requirePost(request, () => chatSend(request, env));
      if (p === '/api/admin/grant-credits')return requirePost(request, () => adminGrantCredits(request, env));
      if (p === '/api/admin/creator')      return requirePost(request, () => adminUpsertCreator(request, env));
      if (p === '/api/admin/promote')      return requirePost(request, () => adminPromote(request, env));
      if (p === '/api/admin/overview')     return adminOverview(request, env);
      if (p === '/api/admin/threads')      return adminThreads(request, env);
      if (p === '/api/admin/thread')       return adminThread(request, env);
      if (p === '/api/admin/reply')        return requirePost(request, () => adminReply(request, env));
      if (p === '/api/admin/block')        return requirePost(request, () => adminBlock(request, env));
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

/* ═══════════════════════════ creator chat ═══════════════════════════
   1 credit = 1 message the listener sends. Creator replies are free and
   earn the creator a fixed amount. Credits are granted by /api/admin/grant-credits,
   so any payment processor can be wired in later without touching this logic.
─────────────────────────────────────────────────────────────────────── */

const FREE_MESSAGES      = 3;      // free messages a listener gets in total, across all creators
const MAX_MESSAGE_CHARS  = 2000;
const MIN_MS_BETWEEN_MSG = 1500;   // basic flood guard

/* Posted automatically as "Hushlore Team" every time a listener buys credits.
   Edit the wording here — it is the one place it lives. */
const PURCHASE_NOTICE =
  'This is the Hushlore team. Please keep messages respectful — the creators here are real people, ' +
  'and they read everything you send themselves. Anything abusive, or any attempt to arrange contact ' +
  'outside Hushlore, ends the conversation and the account. Other than that: enjoy yourself.';

/** Who is calling: listener, and whether they're also a creator. */
async function whoAmI(env, request) {
  const uid = await readSession(env, request);
  if (!uid) return null;
  const creator = await env.DB.prepare(
    'SELECT id, slug, display_name, payout_cents FROM creators WHERE user_id = ?1'
  ).bind(uid).first();
  return { uid, creator: creator || null };
}

/** Stable pseudonym so creators never see a listener's email. */
function listenerAlias(userId) {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return 'Listener #' + h.toString(16).toUpperCase().slice(0, 4).padStart(4, '0');
}

async function creditBalance(env, uid) {
  const row = await env.DB.prepare('SELECT credits FROM chat_balances WHERE user_id = ?1').bind(uid).first();
  return row ? row.credits : 0;
}

async function addCredits(env, uid, delta, reason, ref) {
  await env.DB.prepare(
    `INSERT INTO chat_balances (user_id, credits, updated_at) VALUES (?1, ?2, ?3)
     ON CONFLICT(user_id) DO UPDATE SET credits = credits + ?2, updated_at = ?3`
  ).bind(uid, delta, nowISO()).run();
  await env.DB.prepare(
    'INSERT INTO chat_ledger (id, user_id, delta, reason, ref, created_at) VALUES (?1,?2,?3,?4,?5,?6)'
  ).bind(crypto.randomUUID(), uid, delta, reason, ref || null, nowISO()).run();
}

/** Creators available to message — only those who record for this listener's audience.
    The audience is worked out in the browser (gender + who they're into); we take it once
    and remember it on the account so the server can personalise later too. */
async function chatCreators(request, env) {
  const who = await whoAmI(env, request);
  if (!who) return json({ error: 'auth_required' }, 401);

  let aud = new URL(request.url).searchParams.get('aud');
  if (!['M', 'W', 'L', 'G'].includes(aud)) aud = null;
  if (aud) {
    await env.DB.prepare('UPDATE users SET aud = ?1 WHERE id = ?2').bind(aud, who.uid).run();
  } else {
    const u = await env.DB.prepare('SELECT aud FROM users WHERE id = ?1').bind(who.uid).first();
    aud = u && u.aud ? u.aud : null;
  }

  const { results } = await env.DB.prepare(
    `SELECT id, slug, display_name, tagline, bio, avatar, aud, reply_hint
       FROM creators
      WHERE chat_enabled = 1 AND (?1 IS NULL OR aud IS NULL OR aud = ?1)
      ORDER BY display_name`
  ).bind(aud).all();
  return json({ creators: results || [], aud: aud });
}

async function chatMe(request, env) {
  const who = await whoAmI(env, request);
  if (!who) return json({ authenticated: false }, 200);
  const sub = await activeSub(env, who.uid);
  const usedFree = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM chat_messages m JOIN chat_threads t ON t.id = m.thread_id
      WHERE t.user_id = ?1 AND m.sender = 'user'`
  ).bind(who.uid).first();
  return json({
    authenticated: true,
    credits: await creditBalance(env, who.uid),
    free_left: Math.max(0, FREE_MESSAGES - (usedFree ? usedFree.n : 0)),
    subscribed: !!sub,
    is_creator: !!who.creator,
    creator: who.creator ? { slug: who.creator.slug, display_name: who.creator.display_name } : null
  });
}

/** Listener: their conversations. Creator: their inbox. */
async function chatThreads(request, env) {
  const who = await whoAmI(env, request);
  if (!who) return json({ error: 'auth_required' }, 401);

  if (who.creator) {
    const { results } = await env.DB.prepare(
      `SELECT t.id, t.user_id, t.last_msg_at, t.last_msg_from, t.creator_unread, t.blocked,
              (SELECT body FROM chat_messages m WHERE m.thread_id = t.id ORDER BY created_at DESC LIMIT 1) AS preview
         FROM chat_threads t WHERE t.creator_id = ?1
        ORDER BY COALESCE(t.last_msg_at, t.created_at) DESC LIMIT 100`
    ).bind(who.creator.id).all();
    return json({
      as: 'creator',
      threads: (results || []).map(function (t) {
        return { id: t.id, who: listenerAlias(t.user_id), last_msg_at: t.last_msg_at,
                 last_msg_from: t.last_msg_from, unread: t.creator_unread, blocked: !!t.blocked, preview: t.preview };
      })
    });
  }

  const { results } = await env.DB.prepare(
    `SELECT t.id, t.creator_id, t.last_msg_at, t.last_msg_from, t.user_unread,
            c.display_name, c.avatar, c.slug, c.reply_hint,
            (SELECT body FROM chat_messages m WHERE m.thread_id = t.id ORDER BY created_at DESC LIMIT 1) AS preview
       FROM chat_threads t JOIN creators c ON c.id = t.creator_id
      WHERE t.user_id = ?1 ORDER BY COALESCE(t.last_msg_at, t.created_at) DESC`
  ).bind(who.uid).all();
  return json({ as: 'user', credits: await creditBalance(env, who.uid), threads: results || [] });
}

/** Open (or create) the listener's conversation with a creator. */
async function chatOpen(request, env) {
  const who = await whoAmI(env, request);
  if (!who) return json({ error: 'auth_required' }, 401);
  if (!await activeSub(env, who.uid)) return json({ error: 'subscription_required' }, 402);

  const body = await request.json().catch(() => ({}));
  const creator = await env.DB.prepare(
    'SELECT id, slug, display_name, avatar, reply_hint FROM creators WHERE slug = ?1 AND chat_enabled = 1'
  ).bind(String(body.slug || '')).first();
  if (!creator) return json({ error: 'creator_not_found' }, 404);

  let thread = await env.DB.prepare(
    'SELECT id FROM chat_threads WHERE user_id = ?1 AND creator_id = ?2'
  ).bind(who.uid, creator.id).first();

  if (!thread) {
    const id = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO chat_threads (id, user_id, creator_id, created_at) VALUES (?1,?2,?3,?4)'
    ).bind(id, who.uid, creator.id, nowISO()).run();
    thread = { id };
  }
  return json({ thread_id: thread.id, creator, credits: await creditBalance(env, who.uid) });
}

async function threadFor(env, who, threadId) {
  const t = await env.DB.prepare('SELECT * FROM chat_threads WHERE id = ?1').bind(threadId).first();
  if (!t) return null;
  if (who.creator && t.creator_id === who.creator.id) return { t, role: 'creator' };
  if (t.user_id === who.uid) return { t, role: 'user' };
  return null;
}

/** Poll messages. `?since=<iso>` returns only newer ones. */
async function chatMessages(request, env) {
  const who = await whoAmI(env, request);
  if (!who) return json({ error: 'auth_required' }, 401);
  const url = new URL(request.url);
  const found = await threadFor(env, who, url.searchParams.get('thread') || '');
  if (!found) return json({ error: 'not_found' }, 404);

  const since = url.searchParams.get('since') || '1970-01-01T00:00:00.000Z';
  const { results } = await env.DB.prepare(
    'SELECT id, sender, body, created_at FROM chat_messages WHERE thread_id = ?1 AND created_at > ?2 ORDER BY created_at LIMIT 200'
  ).bind(found.t.id, since).all();

  // mark this side as read
  const col = found.role === 'creator' ? 'creator_unread' : 'user_unread';
  await env.DB.prepare('UPDATE chat_threads SET ' + col + ' = 0 WHERE id = ?1').bind(found.t.id).run();

  return json({ role: found.role, messages: results || [], credits: found.role === 'user' ? await creditBalance(env, who.uid) : null });
}

async function chatSend(request, env) {
  const who = await whoAmI(env, request);
  if (!who) return json({ error: 'auth_required' }, 401);

  const body = await request.json().catch(() => ({}));
  const text = String(body.body || '').trim();
  if (!text) return json({ error: 'empty_message' }, 400);
  if (text.length > MAX_MESSAGE_CHARS) return json({ error: 'message_too_long' }, 400);

  const found = await threadFor(env, who, String(body.thread || ''));
  if (!found) return json({ error: 'not_found' }, 404);
  if (found.t.blocked) return json({ error: 'thread_blocked' }, 403);

  // flood guard
  const last = await env.DB.prepare(
    'SELECT created_at FROM chat_messages WHERE thread_id = ?1 AND sender = ?2 ORDER BY created_at DESC LIMIT 1'
  ).bind(found.t.id, found.role).first();
  if (last && Date.now() - new Date(last.created_at).getTime() < MIN_MS_BETWEEN_MSG) {
    return json({ error: 'too_fast' }, 429);
  }

  let spent = 0;
  if (found.role === 'user') {
    if (!await activeSub(env, who.uid)) return json({ error: 'subscription_required' }, 402);
    // free allowance is counted across every conversation, not per creator
    const sent = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM chat_messages m JOIN chat_threads t ON t.id = m.thread_id
        WHERE t.user_id = ?1 AND m.sender = 'user'`
    ).bind(who.uid).first();
    const stillFree = (sent ? sent.n : 0) < FREE_MESSAGES;
    if (!stillFree) {
      if (await creditBalance(env, who.uid) < 1) {
        return json({ error: 'no_credits', credits: 0 }, 402);
      }
      spent = 1;
    }
  }

  const msgId = crypto.randomUUID();
  const at = nowISO();
  await env.DB.prepare(
    'INSERT INTO chat_messages (id, thread_id, sender, body, created_at) VALUES (?1,?2,?3,?4,?5)'
  ).bind(msgId, found.t.id, found.role, text, at).run();

  const bump = found.role === 'user' ? 'creator_unread' : 'user_unread';
  await env.DB.prepare(
    'UPDATE chat_threads SET last_msg_at = ?1, last_msg_from = ?2, ' + bump + ' = ' + bump + ' + 1 WHERE id = ?3'
  ).bind(at, found.role, found.t.id).run();

  if (spent) await addCredits(env, who.uid, -1, 'message', msgId);

  // creator replies earn
  if (found.role === 'creator') {
    await env.DB.prepare(
      'INSERT INTO creator_earnings (id, creator_id, message_id, cents, created_at) VALUES (?1,?2,?3,?4,?5)'
    ).bind(crypto.randomUUID(), who.creator.id, msgId, who.creator.payout_cents || 12, at).run();
  }

  return json({
    ok: true, id: msgId, created_at: at, charged: spent,
    credits: found.role === 'user' ? await creditBalance(env, who.uid) : null
  });
}

/** Payment hook — call this from the processor's webhook (or by hand) after a bundle is bought. */
async function adminGrantCredits(request, env) {
  if (!env.ADMIN_KEY || !safeEqual(request.headers.get('x-admin-key') || '', env.ADMIN_KEY)) {
    return json({ error: 'unauthorized' }, 401);
  }
  const body = await request.json().catch(() => ({}));
  const email = normEmail(body.email);
  const credits = parseInt(body.credits, 10);
  if (!validEmail(email)) return json({ error: 'invalid_email' }, 400);
  if (!credits || credits < 1) return json({ error: 'invalid_credits' }, 400);

  const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?1').bind(email).first();
  if (!user) return json({ error: 'no_such_user', note: 'the buyer must create an account first' }, 404);

  await addCredits(env, user.id, credits, 'purchase', body.ref);
  const notified = await postPurchaseNotice(env, user.id);
  return json({ ok: true, email, credits: await creditBalance(env, user.id), notice_posted: notified });
}

/** Drop the house-rules notice into the conversation this listener is most likely
    to open next. Skipped if it is already the last thing in that thread. */
async function postPurchaseNotice(env, userId) {
  const t = await env.DB.prepare(
    `SELECT id FROM chat_threads WHERE user_id = ?1
      ORDER BY COALESCE(last_msg_at, created_at) DESC LIMIT 1`
  ).bind(userId).first();
  if (!t) return false;

  const last = await env.DB.prepare(
    'SELECT sender, body FROM chat_messages WHERE thread_id = ?1 ORDER BY created_at DESC LIMIT 1'
  ).bind(t.id).first();
  if (last && last.sender === 'admin' && last.body === PURCHASE_NOTICE) return false;

  const at = nowISO();
  await env.DB.prepare(
    "INSERT INTO chat_messages (id, thread_id, sender, body, created_at) VALUES (?1,?2,'admin',?3,?4)"
  ).bind(crypto.randomUUID(), t.id, PURCHASE_NOTICE, at).run();
  await env.DB.prepare(
    "UPDATE chat_threads SET last_msg_at = ?1, last_msg_from = 'admin', user_unread = user_unread + 1 WHERE id = ?2"
  ).bind(at, t.id).run();
  return true;
}

/** Create or update a creator profile, and link the account they log in with. */
async function adminUpsertCreator(request, env) {
  if (!env.ADMIN_KEY || !safeEqual(request.headers.get('x-admin-key') || '', env.ADMIN_KEY)) {
    return json({ error: 'unauthorized' }, 401);
  }
  const b = await request.json().catch(() => ({}));
  const slug = String(b.slug || '').trim().toLowerCase();
  if (!/^[a-z0-9-]{2,32}$/.test(slug)) return json({ error: 'invalid_slug' }, 400);

  let userId = null;
  if (b.login_email) {
    const u = await env.DB.prepare('SELECT id FROM users WHERE email = ?1').bind(normEmail(b.login_email)).first();
    if (!u) return json({ error: 'no_such_user', note: 'create the creator an account first' }, 404);
    userId = u.id;
  }

  const existing = await env.DB.prepare('SELECT id FROM creators WHERE slug = ?1').bind(slug).first();
  if (existing) {
    await env.DB.prepare(
      `UPDATE creators SET display_name = COALESCE(?2, display_name), tagline = COALESCE(?3, tagline),
              bio = COALESCE(?4, bio), avatar = COALESCE(?5, avatar), aud = COALESCE(?6, aud),
              chat_enabled = COALESCE(?7, chat_enabled), reply_hint = COALESCE(?8, reply_hint),
              payout_cents = COALESCE(?9, payout_cents), user_id = COALESCE(?10, user_id)
         WHERE id = ?1`
    ).bind(existing.id, b.display_name || null, b.tagline || null, b.bio || null, b.avatar || null,
           b.aud || null, b.chat_enabled === undefined ? null : (b.chat_enabled ? 1 : 0),
           b.reply_hint || null, b.payout_cents || null, userId).run();
    return json({ ok: true, mode: 'updated', slug });
  }

  await env.DB.prepare(
    `INSERT INTO creators (id, slug, display_name, tagline, bio, avatar, aud, chat_enabled, reply_hint, payout_cents, user_id, created_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)`
  ).bind(crypto.randomUUID(), slug, b.display_name || slug, b.tagline || null, b.bio || null, b.avatar || null,
         b.aud || null, b.chat_enabled ? 1 : 0, b.reply_hint || 'usually replies within a day',
         b.payout_cents || 12, userId, nowISO()).run();
  return json({ ok: true, mode: 'created', slug });
}

/* ═══════════════════════ admin / moderation ═══════════════════════
   Read-only over every conversation, plus the ability to step in. Admin replies
   are sent as 'admin' and shown to the listener as the Hushlore team — never
   dressed up as the creator.
──────────────────────────────────────────────────────────────────── */

/** Admin either via a signed-in account flagged is_admin, or the ADMIN_KEY header. */
async function requireAdmin(request, env) {
  const key = request.headers.get('x-admin-key');
  if (key && env.ADMIN_KEY && safeEqual(key, env.ADMIN_KEY)) return { uid: null, viaKey: true };
  const uid = await readSession(env, request);
  if (!uid) return null;
  const u = await env.DB.prepare('SELECT is_admin FROM users WHERE id = ?1').bind(uid).first();
  return u && u.is_admin ? { uid, viaKey: false } : null;
}

/** Bootstrap: turn an existing account into an admin (needs the ADMIN_KEY). */
async function adminPromote(request, env) {
  if (!env.ADMIN_KEY || !safeEqual(request.headers.get('x-admin-key') || '', env.ADMIN_KEY)) {
    return json({ error: 'unauthorized' }, 401);
  }
  const b = await request.json().catch(() => ({}));
  const email = normEmail(b.email);
  const on = b.admin === false ? 0 : 1;
  const u = await env.DB.prepare('SELECT id FROM users WHERE email = ?1').bind(email).first();
  if (!u) return json({ error: 'no_such_user' }, 404);
  await env.DB.prepare('UPDATE users SET is_admin = ?1 WHERE id = ?2').bind(on, u.id).run();
  return json({ ok: true, email, admin: !!on });
}

async function adminOverview(request, env) {
  if (!await requireAdmin(request, env)) return json({ error: 'unauthorized' }, 401);
  const q = async (sql) => (await env.DB.prepare(sql).first()) || {};
  const users     = await q('SELECT COUNT(*) AS n FROM users');
  const subs      = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM subscriptions WHERE status='active' AND expires_at > ?1").bind(nowISO()).first();
  const threads   = await q('SELECT COUNT(*) AS n FROM chat_threads');
  const msgs      = await q("SELECT COUNT(*) AS n FROM chat_messages WHERE sender='user'");
  const replies   = await q("SELECT COUNT(*) AS n FROM chat_messages WHERE sender='creator'");
  const spent     = await q("SELECT COALESCE(-SUM(delta),0) AS n FROM chat_ledger WHERE reason='message'");
  const bought    = await q("SELECT COALESCE(SUM(delta),0) AS n FROM chat_ledger WHERE reason='purchase'");
  const owed      = await q('SELECT COALESCE(SUM(cents),0) AS n FROM creator_earnings WHERE paid_out = 0');
  return json({
    users: users.n, active_subs: subs ? subs.n : 0, threads: threads.n,
    messages_sent: msgs.n, creator_replies: replies.n,
    credits_bought: bought.n, credits_spent: spent.n, creator_owed_cents: owed.n
  });
}

/** Every conversation, newest activity first. */
async function adminThreads(request, env) {
  if (!await requireAdmin(request, env)) return json({ error: 'unauthorized' }, 401);
  const url = new URL(request.url);
  const creator = url.searchParams.get('creator') || '';
  const { results } = await env.DB.prepare(
    `SELECT t.id, t.user_id, t.blocked, t.last_msg_at, t.last_msg_from, t.created_at,
            c.display_name AS creator_name, c.slug AS creator_slug,
            u.email AS user_email,
            (SELECT COUNT(*) FROM chat_messages m WHERE m.thread_id = t.id AND m.sender='user')    AS from_user,
            (SELECT COUNT(*) FROM chat_messages m WHERE m.thread_id = t.id AND m.sender='creator') AS from_creator,
            (SELECT body FROM chat_messages m WHERE m.thread_id = t.id ORDER BY created_at DESC LIMIT 1) AS preview
       FROM chat_threads t
       JOIN creators c ON c.id = t.creator_id
       JOIN users u    ON u.id = t.user_id
      WHERE (?1 = '' OR c.slug = ?1)
      ORDER BY COALESCE(t.last_msg_at, t.created_at) DESC LIMIT 200`
  ).bind(creator).all();
  const { results: cr } = await env.DB.prepare(
    'SELECT slug, display_name FROM creators ORDER BY display_name').all();
  return json({ threads: results || [], creators: cr || [] });
}

/** Full transcript of one conversation, plus what that listener has spent. */
async function adminThread(request, env) {
  if (!await requireAdmin(request, env)) return json({ error: 'unauthorized' }, 401);
  const id = new URL(request.url).searchParams.get('id') || '';
  const t = await env.DB.prepare(
    `SELECT t.*, c.display_name AS creator_name, u.email AS user_email, u.created_at AS user_since
       FROM chat_threads t JOIN creators c ON c.id = t.creator_id JOIN users u ON u.id = t.user_id
      WHERE t.id = ?1`
  ).bind(id).first();
  if (!t) return json({ error: 'not_found' }, 404);

  const { results: messages } = await env.DB.prepare(
    'SELECT id, sender, body, created_at FROM chat_messages WHERE thread_id = ?1 ORDER BY created_at'
  ).bind(id).all();
  const bal = await env.DB.prepare('SELECT credits FROM chat_balances WHERE user_id = ?1').bind(t.user_id).first();
  const sub = await activeSub(env, t.user_id);

  return json({
    thread: {
      id: t.id, creator_name: t.creator_name, user_email: t.user_email, user_since: t.user_since,
      blocked: !!t.blocked, credits_left: bal ? bal.credits : 0,
      subscription: subShape(sub)
    },
    messages: messages || []
  });
}

async function adminReply(request, env) {
  if (!await requireAdmin(request, env)) return json({ error: 'unauthorized' }, 401);
  const b = await request.json().catch(() => ({}));
  const text = String(b.body || '').trim();
  if (!text) return json({ error: 'empty_message' }, 400);
  if (text.length > MAX_MESSAGE_CHARS) return json({ error: 'message_too_long' }, 400);
  const t = await env.DB.prepare('SELECT id FROM chat_threads WHERE id = ?1').bind(String(b.thread || '')).first();
  if (!t) return json({ error: 'not_found' }, 404);

  const id = crypto.randomUUID(), at = nowISO();
  await env.DB.prepare(
    "INSERT INTO chat_messages (id, thread_id, sender, body, created_at) VALUES (?1,?2,'admin',?3,?4)"
  ).bind(id, t.id, text, at).run();
  await env.DB.prepare(
    'UPDATE chat_threads SET last_msg_at = ?1, last_msg_from = ?2, user_unread = user_unread + 1 WHERE id = ?3'
  ).bind(at, 'admin', t.id).run();
  return json({ ok: true, id, created_at: at });
}

async function adminBlock(request, env) {
  if (!await requireAdmin(request, env)) return json({ error: 'unauthorized' }, 401);
  const b = await request.json().catch(() => ({}));
  const on = b.blocked ? 1 : 0;
  await env.DB.prepare('UPDATE chat_threads SET blocked = ?1 WHERE id = ?2')
    .bind(on, String(b.thread || '')).run();
  return json({ ok: true, blocked: !!on });
}
