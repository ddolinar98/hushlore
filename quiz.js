/* ====================================
   Hushlore — Quiz Logic
   ==================================== */

const TOTAL_STEPS = 10;
const answers = {};          // single-answer questions: { qNum: answerString }
const multiAnswers = {};     // multi-answer questions: { qNum: [a, b, c] }
let currentQuestion = 1;

/* ====================================
   Outcome scoring matrix
   ==================================== */

const scoring = {
  // Q1 — Mood
  unwind:        { 'slow-devotion': 3, 'best-friends-untold': 2, 'midnight-surrender': 1 },
  butterflies:   { 'best-friends-untold': 3, 'slow-devotion': 2, 'enemys-confession': 1 },
  intensity:     { 'commanding-embrace': 3, 'enemys-confession': 2, 'midnight-surrender': 2 },
  curious:       { 'forbidden-whispers': 3, 'midnight-surrender': 1, 'enemys-confession': 1 },

  // Q2 — Voice
  deep:          { 'commanding-embrace': 3, 'enemys-confession': 2, 'midnight-surrender': 1 },
  soft:          { 'slow-devotion': 3, 'best-friends-untold': 2 },
  playful:       { 'best-friends-untold': 3, 'enemys-confession': 1 },
  smooth:        { 'midnight-surrender': 3, 'forbidden-whispers': 2 },

  // Q3 — Scene
  cabin:         { 'slow-devotion': 3, 'best-friends-untold': 2 },
  office:        { 'forbidden-whispers': 3, 'enemys-confession': 2 },
  bedroom:       { 'midnight-surrender': 3, 'commanding-embrace': 2 },
  beach:         { 'best-friends-untold': 2, 'slow-devotion': 2, 'enemys-confession': 1 },

  // Q5 — Feel more of (MULTI)
  desired:                 { 'forbidden-whispers': 2, 'commanding-embrace': 2, 'midnight-surrender': 1 },
  confident:               { 'commanding-embrace': 2, 'enemys-confession': 2 },
  'playful-free':          { 'best-friends-untold': 2, 'enemys-confession': 1, 'slow-devotion': 1 },
  'emotionally-connected': { 'slow-devotion': 2, 'best-friends-untold': 2 },
  'seen-understood':       { 'slow-devotion': 2, 'midnight-surrender': 2 },

  // Q6 — Story start
  strangers:     { 'forbidden-whispers': 3, 'midnight-surrender': 2 },
  friends:       { 'best-friends-untold': 4 },
  enemies:       { 'enemys-confession': 4 },
  secret:        { 'forbidden-whispers': 4 },

  // Q7 — Heat
  sweet:         { 'slow-devotion': 3, 'best-friends-untold': 2 },
  slowburn:      { 'best-friends-untold': 2, 'enemys-confession': 2, 'forbidden-whispers': 1 },
  steamy:        { 'commanding-embrace': 2, 'forbidden-whispers': 2, 'midnight-surrender': 1 },
  intense:       { 'commanding-embrace': 3, 'midnight-surrender': 3, 'enemys-confession': 1 },

  // Q8 — When
  sleep:         { 'slow-devotion': 2, 'midnight-surrender': 2 },
  bath:          { 'midnight-surrender': 3, 'slow-devotion': 1 },
  drive:         { 'forbidden-whispers': 2, 'commanding-embrace': 1 },
  quiet:         { 'slow-devotion': 2, 'midnight-surrender': 1, 'best-friends-untold': 1 },
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

  // Small delay so the user sees the bars start at 0
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
        const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
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
  const pct = ((currentQuestion - 1) / TOTAL_STEPS) * 100;
  document.getElementById('progressFill').style.width = pct + '%';
  document.getElementById('progressText').textContent =
    `Step ${currentQuestion} of ${TOTAL_STEPS}`;
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

  // TODO: replace with real email integration (MailerLite / ConvertKit webhook)

  runLoadingAndRedirect(outcome);
  return false;
}

/* ====================================
   Loading / analysis screen w/ mid-step modals
   ==================================== */

const modalAnswers = {};

// Modal mapping: which step index (0-based) shows which modal at ~50% mark
const STEP_MODALS = [
  null,           // step 1 — no modal
  'explicit',     // step 2 — show modal at ~50%
  'fantasies',    // step 3
  'relationship'  // step 4
];

async function runLoadingAndRedirect(outcome) {
  document.querySelector('.quiz-progress').style.display = 'none';

  const emailStep = document.querySelector('[data-question="10"]');
  if (emailStep) emailStep.classList.remove('active');

  const loadingStep = document.querySelector('[data-question="11"]');
  loadingStep.classList.add('active');

  window.scrollTo({ top: 0, behavior: 'instant' });

  const steps = loadingStep.querySelectorAll('.loading-step');

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    step.classList.add('animating');

    const modalId = STEP_MODALS[i];
    if (modalId) {
      // Animate to ~50%, pause, show modal, await answer, animate to 100%
      await animateLoadingStep(step, 700, 0, 49);
      const answer = await showModal(modalId);
      modalAnswers[modalId] = answer;
      await animateLoadingStep(step, 700, 49, 100);
    } else {
      await animateLoadingStep(step, 1300, 0, 100);
    }

    step.classList.remove('animating');
    step.classList.add('done');
    // Replace % with ✓ on done
    step.querySelector('[data-loading-pct]').textContent = '✓';
  }

  // Persist modal answers
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
