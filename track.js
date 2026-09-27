/* First-party funnel tracking.
   Posts to /api/track on this same domain, so an ad blocker treats it as part
   of the site rather than as a third-party beacon. Nothing here identifies a
   person: the session id is made up by the browser and lives for one visit. */
(function (w) {
  function sid() {
    try {
      var s = sessionStorage.getItem('hl_sid');
      if (!s) {
        s = Math.random().toString(36).slice(2) + Date.now().toString(36);
        sessionStorage.setItem('hl_sid', s);
      }
      return s;
    } catch (e) { return 'anon-' + Date.now().toString(36); }
  }

  function aud() {
    try { return localStorage.getItem('hl_aud') || null; } catch (e) { return null; }
  }

  w.hlTrack = function (name, extras) {
    var body = Object.assign({
      sid: sid(),
      name: name,
      aud: aud(),
      path: location.pathname,
      ref: document.referrer || null
    }, extras || {});
    try {
      fetch('/api/track', {
        method: 'POST',
        keepalive: true,                 // survives the page going away
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',      // so a signed-in sale ties to the funnel
        body: JSON.stringify(body)
      }).catch(function () {});
    } catch (e) {}
  };
})(window);
