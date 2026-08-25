/**
 * Age confirmation.
 *
 * Required by CCBill's Self-Attestation, which asks whether the site shows an
 * age confirmation warning *before access to the site* - the 18+ line at the
 * checkout does not answer that question.
 *
 * This is confirmation, not verification: a declaration, no document check.
 * Jurisdictions that mandate real age assurance (the UK, France, and the US
 * states that have passed AV laws) need more than this, and that is a separate
 * piece of work gated on which markets are actually opened.
 *
 * Included on public pages only. Everything behind the login already required
 * an account and an active membership to reach.
 */
(function () {
  var KEY = 'hl_age_ok';
  try { if (localStorage.getItem(KEY) === '1') return; } catch (_) { return; }

  var css = document.createElement('style');
  css.textContent =
    '.agegate{position:fixed;inset:0;z-index:9999;background:rgba(4,3,5,.94);' +
      'backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;padding:20px}' +
    '.agegate-box{max-width:440px;width:100%;background:var(--bg-card,#170b15);' +
      'border:1px solid var(--border-strong,rgba(192,51,88,.38));border-radius:16px;padding:34px 30px;text-align:center}' +
    '.agegate-mark{font-family:var(--serif,Georgia,serif);font-size:30px;color:var(--cream,#f7f3f6);margin-bottom:18px}' +
    '.agegate-mark span{color:var(--gold,#c03358)}' +
    '.agegate-box h2{font-family:var(--serif,Georgia,serif);font-weight:500;font-size:23px;' +
      'color:var(--cream,#f7f3f6);margin-bottom:12px;line-height:1.25}' +
    '.agegate-box p{font-family:var(--sans,system-ui);font-size:14px;line-height:1.65;' +
      'color:#a98ea3;margin-bottom:22px}' +
    '.agegate-actions{display:flex;gap:10px;flex-wrap:wrap;justify-content:center}' +
    '.agegate-yes,.agegate-no{font-family:var(--sans,system-ui);font-size:15px;font-weight:600;' +
      'border-radius:10px;padding:13px 22px;cursor:pointer;border:none}' +
    '.agegate-yes{background:var(--gold,#c03358);color:#fff;flex:1 1 180px}' +
    '.agegate-no{background:none;border:1px solid var(--border,rgba(192,51,88,.18));color:#a98ea3;flex:0 1 auto}' +
    '.agegate-fine{font-family:var(--sans,system-ui);font-size:11.5px;color:#6b5265;margin-top:18px;line-height:1.6}' +
    '.agegate-fine a{color:#a98ea3}';
  document.head.appendChild(css);

  var el = document.createElement('div');
  el.className = 'agegate';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.innerHTML =
    '<div class="agegate-box">' +
      '<div class="agegate-mark">Hush<span>lore</span></div>' +
      '<h2>This site is for adults only</h2>' +
      '<p>Hushlore contains sexually explicit audio. You must be 18 or older, and of legal age ' +
        'in your country, to enter.</p>' +
      '<div class="agegate-actions">' +
        '<button class="agegate-yes" type="button">I am 18 or older - enter</button>' +
        '<button class="agegate-no" type="button">Leave</button>' +
      '</div>' +
      '<p class="agegate-fine">By entering you confirm you are of legal age and wish to view adult ' +
        'content. See our <a href="terms.html">Terms</a> and <a href="privacy.html">Privacy Policy</a>.</p>' +
    '</div>';

  function show() {
    document.body.appendChild(el);
    document.documentElement.style.overflow = 'hidden';
    el.querySelector('.agegate-yes').focus();
  }

  el.querySelector('.agegate-yes').addEventListener('click', function () {
    try { localStorage.setItem(KEY, '1'); } catch (_) {}
    el.remove();
    document.documentElement.style.overflow = '';
  });
  el.querySelector('.agegate-no').addEventListener('click', function () {
    location.href = 'https://www.google.com';
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show);
  else show();
})();
