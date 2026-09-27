/* Wakes hushlorewhisper.com once an hour so it can send the email that is due.
   Holds nothing but the shared key; all of the logic lives in the site. */
export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(run(env));
  },
  // Handy for a manual run while testing; the key still has to be right.
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.searchParams.get('key') !== env.CRON_KEY) {
      return new Response('forbidden', { status: 403 });
    }
    return new Response(await run(env), { headers: { 'Content-Type': 'application/json' } });
  }
};

async function run(env) {
  try {
    const res = await fetch(
      'https://hushlorewhisper.com/api/cron/emails?key=' + encodeURIComponent(env.CRON_KEY),
      { method: 'POST' }
    );
    return await res.text();
  } catch (e) {
    return JSON.stringify({ ok: false, error: String(e) });
  }
}
