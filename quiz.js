/* ====================================
   Hushlore — Quiz Logic (v2)
   ==================================== */

const TOTAL_STEPS = 16;   // steps 1-16 shown in progress bar; 17=email, 18=loading
const answers = {};       // single-answer: { stepNum: answerString }
const multiAnswers = {};  // multi-answer: { stepNum: [a, b, c] }
let currentQuestion = 1;

/* ====================================
   Outcome scoring matrix
   ==================================== */

const scoring = {

  // Q3 — Atmosphere (step 3)
  cozy:        { 'slow-devotion': 3, 'best-friends-untold': 2 },
  passionate:  { 'commanding-embrace': 3, 'midnight-surrender': 2 },
  dreamy:      { 'slow-devotion': 2, 'forbidden-whispers': 1 },
  wild:        { 'midnight-surrender': 3, 'enemys-confession': 2 },
  mysterious:  { 'forbidden-whispers': 3, 'enemys-confession': 2 },

  // Q4 — Turn-ons (step 4)
  slowbuildup:      { 'slow-devotion': 3, 'best-friends-untold': 2 },
  dominance:        { 'commanding-embrace': 3, 'midnight-surrender': 2 },
  vulnerability:    { 'slow-devotion': 2, 'best-friends-untold': 2 },
  forbidden:        { 'forbidden-whispers': 4 },
  tender:           { 'slow-devotion': 3 },
  whispering:       { 'midnight-surrender': 3, 'slow-devotion': 1 },
  rough:            { 'commanding-embrace': 3, 'midnight-surrender': 2 },
  emotional:        { 'slow-devotion': 2, 'best-friends-untold': 2 },
  roleplay:         { 'forbidden-whispers': 2, 'midnight-surrender': 2 },
  'friends-tension':  { 'best-friends-untold': 4 },
  'enemies-desire':   { 'enemys-confession': 4 },

  // Q5 — Preference (step 5)
  'sweet-romance':   { 'slow-devotion': 3 },
  'sensual-tension': { 'midnight-surrender': 3, 'forbidden-whispers': 1 },
  'pure-fantasy':    { 'forbidden-whispers': 3, 'midnight-surrender': 2 },
  'emotional-depth': { 'slow-devotion': 2, 'best-friends-untold': 3 },
  'raw-desire':      { 'commanding-embrace': 3, 'midnight-surrender': 2 },
  'unpredictable':   { 'enemys-confession': 3, 'forbidden-whispers': 2 },

  // Q6 — Emotional connection (step 7)
  'emotion-not':        { 'midnight-surrender': 2, 'commanding-embrace': 1 },
  'emotion-slightly':   { 'midnight-surrender': 1, 'commanding-embrace': 1 },
  'emotion-moderately': { 'forbidden-whispers': 1, 'best-friends-untold': 1 },
  'emotion-very':       { 'slow-devotion': 2, 'best-friends-untold': 2 },
  'emotion-essential':  { 'slow-devotion': 3, 'best-friends-untold': 3 },

  // Q7 — Relationship dynamic (step 8)
  'equal':         { 'best-friends-untold': 2, 'slow-devotion': 2 },
  'dom-sub':       { 'commanding-embrace': 4 },
  'friends-lovers':{ 'best-friends-untold': 4 },
  'enemies-lovers':{ 'enemys-confession': 4 },
  'forbidden-love':{ 'forbidden-whispers': 4 },

  // Q8 — Current satisfaction (step 9)
  'very-satisfied':       { 'slow-devotion': 2 },
  'somewhat-satisfied':   { 'best-friends-untold': 1 },
  'neutral':              { 'midnight-surrender': 1 },
  'somewhat-unsatisfied': { 'forbidden-whispers': 1, 'commanding-embrace': 1 },
  'very-unsatisfied':     { 'commanding-embrace': 2, 'midnight-surrender': 2 },

  // Q9 — Something missing (step 10)
  'missing-not':     { 'slow-devotion': 2 },
  'missing-maybe':   { 'best-friends-untold': 1 },
  'missing-sometimes':{ 'slow-devotion': 1, 'best-friends-untold': 1 },
  'missing-often':   { 'forbidden-whispers': 1, 'midnight-surrender': 1 },
  'missing-always':  { 'commanding-embrace': 2, 'midnight-surrender': 2 },

  // Q10 — Feel more of (step 11, multi)
  'desired':               { 'forbidden-whispers': 2, 'commanding-embrace': 2, 'midnight-surrender': 1 },
  'confident':             { 'commanding-embrace': 2, 'enemys-confession': 2 },
  'playful-free':          { 'best-friends-untold': 2, 'enemys-confession': 1, 'slow-devotion': 1 },
  'emotionally-connected': { 'slow-devotion': 2, 'best-friends-untold': 2 },
  'seen-understood':       { 'slow-devotion': 2, 'midnight-surrender': 2 },

  // Q11 — Love to experience (step 12, multi)
  'completely-adored':      { 'slow-devotion': 3 },
  'surrendering-control':   { 'commanding-embrace': 3, 'midnight-surrender': 2 },
  'passionate-chase':       { 'enemys-confession': 3, 'forbidden-whispers': 2 },
  'deep-emotional-intimacy':{ 'slow-devotion': 2, 'best-friends-untold': 2 },
  'playful-teasing':        { 'best-friends-untold': 3, 'enemys-confession': 1 },

  // Q12 — Holding back (step 13, multi)
  'fear-judgement':     { 'forbidden-whispers': 1, 'commanding-embrace': 1 },
  'feeling-undeserving':{ 'slow-devotion': 1, 'midnight-surrender': 1 },
  'not-knowing-wants':  { 'forbidden-whispers': 2 },
  'fear-vulnerability': { 'slow-devotion': 1, 'best-friends-untold': 1 },
  'nothing-holding':    { 'midnight-surrender': 1, 'commanding-embrace': 1 },

  // Q13 — Looking for (step 14, multi)
  'escapism':         { 'midnight-surrender': 2, 'forbidden-whispers': 1 },
  'excitement':       { 'enemys-confession': 2, 'commanding-embrace': 1 },
  'emotional-healing':{ 'slow-devotion': 2 },
  'self-discovery':   { 'forbidden-whispers': 2 },
  'deep-connection':  { 'slow-devotion': 2, 'best-friends-untold': 2 },
  'pure-pleasure':    { 'midnight-surrender': 3, 'commanding-embrace': 2 },

  // Q14 — Type of experience (step 16, multi)
  'exp-romantic':    { 'slow-devotion': 2, 'best-friends-untold': 1 },
  'exp-sensual':     { 'midnight-surrender': 2, 'forbidden-whispers': 1 },
  'exp-adventurous': { 'enemys-confession': 2 },
  'exp-emotional':   { 'slow-devotion': 2, 'best-friends-untold': 2 },
  'exp-dom-sub':     { 'commanding-embrace': 3 },
  'exp-fantasy':     { 'forbidden-whispers': 2, 'midnight-surrender': 1 },
  'exp-playful':     { 'best-friends-untold': 2 },
  'exp-intense':     { 'commanding-embrace': 2, 'midnight-surrender': 2 },
};

/* ====================================
   Single-select option clicks
   ==================================== */

document.querySelectorAll('.quiz-option:not(.multi)').forEach((btn) => {
  btn.addEventListener('click', () => {
    const questionEl = btn.closest('.quiz-question');
    const qNumber = parseInt(questionEl.dataset.question, 10);
    answers[qNumber] = btn.dataset.answer;
    advance();
  });
});

/* ====================================
   Multi-select option toggles
   ==================================== */

document.querySelectorAll('.quiz-option.multi').forEach((btn) => {
  btn.addEventListener('click', () => {
    const questionEl = btn.closest('.quiz-question');
    const qNumber = parseInt(questionEl.dataset.question, 10);
    const value = btn.dataset.answer;

    if (!multiAnswers[qNumber]) multiAnswers[qNumber] = [];

    const idx = multiAnswers[qNumber].indexOf(value);
    if (idx >= 0) {
      multiAnswers[qNumber].splice(idx, 1);
      btn.classList.remove('selected');
    } else {
      multiAnswers[qNumber].push(value);
      btn.classList.add('selected');
    }

    // Enable / disable Continue based on selection count
    const continueBtn = questionEl.querySelector('[data-continue]');
    if (continueBtn) {
      const has = multiAnswers[qNumber].length > 0;
      continueBtn.disabled = !has;
      continueBtn.style.opacity = has ? '1' : '0.4';
      continueBtn.style.cursor = has ? 'pointer' : 'not-allowed';
    }
  });
});

/* ====================================
   Continue buttons (interstitials + multi-select)
   ==================================== */

document.querySelectorAll('[data-continue]').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.disabled) return;
    advance();
  });
});

/* ====================================
   Advance to next step
   ==================================== */

function advance() {
  const current = document.querySelector(`.quiz-question[data-question="${currentQuestion}"]`);
  current.classList.remove('active');

  currentQuestion += 1;

  const next = document.querySelector(`.quiz-question[data-question="${currentQuestion}"]`);
  if (next) {
    next.classList.add('active');
    updateProgress();
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Trigger stat bar animation when stats interstitial becomes active
    if (next.dataset.type === 'interstitial') {
      animateStats(next);
    }
  }
}

/* ====================================
   Animate stats bars + counters
   ==================================== */

function animateStats(container) {
  const fills = container.querySelectorAll('.stat-bar-fill');
  const numbers = container.querySelectorAll('[data-stat-target]');

  setTimeout(() => {
    fills.forEach((el) => {
      const target = parseInt(el.dataset.statFill, 10);
      el.style.width = target + '%';
    });

    numbers.forEach((el) => {
      const target = parseInt(el.dataset.statTarget, 10);
      const duration = 1200;
      const start = performance.now();
      function tick(now) {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        el.textContent = Math.round(target * eased) + '%';
        if (t < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  }, 150);
}

/* ====================================
   Progress bar
   ==================================== */

function updateProgress() {
  // Only update progress for steps 1-16 (not email/loading)
  const step = Math.min(currentQuestion, TOTAL_STEPS);
  const pct = ((step - 1) / TOTAL_STEPS) * 100;
  document.getElementById('progressFill').style.width = pct + '%';
  document.getElementById('progressText').textContent =
    currentQuestion <= TOTAL_STEPS
      ? `Step ${currentQuestion} of ${TOTAL_STEPS}`
      : `Almost there...`;
}

/* ====================================
   Calculate outcome
   ==================================== */

function calculateOutcome() {
  const scores = {
    'slow-devotion': 0,
    'forbidden-whispers': 0,
    'commanding-embrace': 0,
    'best-friends-untold': 0,
    'enemys-confession': 0,
    'midnight-surrender': 0,
  };

  // Single-answer questions
  for (const qNum in answers) {
    const ans = answers[qNum];
    const points = scoring[ans] || {};
    for (const outcome in points) {
      scores[outcome] += points[outcome];
    }
  }

  // Multi-answer questions
  for (const qNum in multiAnswers) {
    multiAnswers[qNum].forEach((ans) => {
      const points = scoring[ans] || {};
      for (const outcome in points) {
        scores[outcome] += points[outcome];
      }
    });
  }

  let topOutcome = 'slow-devotion';
  let topScore = -1;
  for (const o in scores) {
    if (scores[o] > topScore) {
      topScore = scores[o];
      topOutcome = o;
    }
  }

  return topOutcome;
}

/* ====================================
   Email submit → loading screen → redirect
   ==================================== */

function submitEmail(e) {
  e.preventDefault();
  const email = document.getElementById('emailInput').value.trim();
  if (!email) return false;

  const outcome = calculateOutcome();

  try {
    localStorage.setItem('hushlore_email', email);
    localStorage.setItem('hushlore_outcome', outcome);
    localStorage.setItem('hushlore_answers', JSON.stringify({ single: answers, multi: multiAnswers }));
  } catch (_) {}

  if (typeof fbq !== 'undefined') fbq('track', 'Lead', { content_name: 'Quiz Email', content_category: outcome });

  fetch('https://connect.mailerlite.com/api/subscribers', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhdWQiOiI0IiwianRpIjoiZTk5YzJmMWFiYWU4ZjAyOTAzYWMzZmNiNTY1OGYwMmNhOTc0MWQ1MGE1MWE1ODI4OGY3MDQ1YWQ3MDM0ZDJlYjgxODg5ODdmODk2NmE1OWIiLCJpYXQiOjE3NzkwNDA5NjUuNjYwNTcsIm5iZiI6MTc3OTA0MDk2NS42NjA1NzUsImV4cCI6NDkzNDcxNDU2NS42NTA5NDEsInN1YiI6IjIzNzQ2MzMiLCJzY29wZXMiOltdfQ.Z31pT73HXComt0iGUSdlU0JzHhGMzjZgpSaMT2jB7T1-syOIglDlraBe-NlhLVNFnMiywEekwvOBlY6bEMzOQqTOyck7KOrJ4D6OpvBTPJMWFtywF0rEjeJqEzothGvV0RZ5JvD35Qqz3H3Am3lZLYhvfhtj9Ob3CPuKHtGyzaBRb0o7nJa90AP7-SE-WCklgQKqU_mBlpzY3BiEEhcxllDuuQfWrC4AekOV_N24gSbxiZXGcT2Hk4sb_yIMtP9oJ2hyuO3bqbtpaX6SET9le49Y4ClHNbVjGU66FI92RBWjZLpgmgZZ5iDzJnBlAt2ZBmDGUxeUUjO9KjswvXqadLl6SOeFZm63IWjQFiXqlaubEorCQCdBZpZoi4izXgaGGVPn3m_izuYgW_IOcyM7zVzPULSgiXROoZsXchOQ_Z_oOvXE7V598ExMGzF5TgCcKZrpTvUHbdnoZ_4Bv-yJNc_sJAksKBVXVDXfXzwUc544PitduBTybR-ZD78__jocr-1fglddmgEEcJNY7OS7zeDwFVrx2ms2EaXJuEjnjArPhyr9eYVQ_LRhJMazGwSAiZVeJs9DiLOtfpoy3QUhH91P6M6OQDW2GIvcMLNtN8TOgbC2ilPBrWdjpuq_leUh5xu6gZXvTUryDo_4YchDjjmLft-QBytvy1ucOfDSK3Y'
    },
    body: JSON.stringify({
      email: email,
      groups: ['187738021652595766'],
      fields: { outcome: outcome }
    })
  }).catch(() => {});

  runLoadingAndRedirect(outcome);
  return false;
}

/* ====================================
   Loading / analysis screen w/ mid-step modals
   ==================================== */

const modalAnswers = {};

const STEP_MODALS = [
  null,           // step 1 — no modal
  'explicit',     // step 2 — show modal at ~50%
  'fantasies',    // step 3
  'relationship'  // step 4
];

async function runLoadingAndRedirect(outcome) {
  document.querySelector('.quiz-progress').style.display = 'none';

  const emailStep = document.querySelector('[data-question="17"]');
  if (emailStep) emailStep.classList.remove('active');

  const loadingStep = document.querySelector('[data-question="18"]');
  loadingStep.classList.add('active');

  window.scrollTo({ top: 0, behavior: 'instant' });

  const steps = loadingStep.querySelectorAll('.loading-step');

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    step.classList.add('animating');

    const modalId = STEP_MODALS[i];
    if (modalId) {
      await animateLoadingStep(step, 700, 0, 49);
      const answer = await showModal(modalId);
      modalAnswers[modalId] = answer;
      await animateLoadingStep(step, 700, 49, 100);
    } else {
      await animateLoadingStep(step, 1300, 0, 100);
    }

    step.classList.remove('animating');
    step.classList.add('done');
    step.querySelector('[data-loading-pct]').textContent = '✓';
  }

  try {
    localStorage.setItem('hushlore_loading_answers', JSON.stringify(modalAnswers));
  } catch (_) {}

  await new Promise((r) => setTimeout(r, 500));
  window.location.href = `result.html?match=${outcome}`;
}

function animateLoadingStep(step, duration, fromPct = 0, toPct = 100) {
  return new Promise((resolve) => {
    const pctEl = step.querySelector('[data-loading-pct]');
    const fillEl = step.querySelector('.loading-step-fill');
    const start = performance.now();
    const span = toPct - fromPct;

    function tick(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 2);
      const pct = Math.round(fromPct + span * eased);
      pctEl.textContent = pct + '%';
      fillEl.style.width = pct + '%';
      if (t < 1) requestAnimationFrame(tick);
      else resolve();
    }
    requestAnimationFrame(tick);
  });
}

function showModal(modalId) {
  return new Promise((resolve) => {
    const modal = document.querySelector(`.quiz-modal[data-modal="${modalId}"]`);
    if (!modal) return resolve(null);
    modal.hidden = false;

    const onClick = (e) => {
      const btn = e.target.closest('[data-modal-answer]');
      if (!btn) return;
      const answer = btn.dataset.modalAnswer;
      modal.hidden = true;
      modal.removeEventListener('click', onClick);
      resolve(answer);
    };
    modal.addEventListener('click', onClick);
  });
}
