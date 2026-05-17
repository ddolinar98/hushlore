# Hushlore — Smoke Test Funnel

A static landing → quiz → result → checkout funnel for validating demand for a personalized audio romance product.

**Stack:** Plain HTML + CSS + vanilla JS. No build step. Deploy anywhere.

---

## Files

| File | Purpose |
|---|---|
| `index.html` | Landing page — hero, social proof, how-it-works, 6 outcome tease, CTA to quiz |
| `quiz.html` | 6-question quiz + email capture (question 7) |
| `quiz.js` | Quiz logic — scoring matrix → outcome calculation → redirect |
| `result.html` | Dynamic result page — shows matched outcome + checkout CTA |
| `checkout.html` | Order summary + Stripe Payment Link button |
| `thanks.html` | Post-purchase confirmation |
| `styles.css` | Global dark & sensual theme |

---

## Local preview

Open `index.html` directly in browser, or run a tiny server:

```bash
cd hushlore
python3 -m http.server 8000
# visit http://localhost:8000
```

---

## Deploy (fastest path — Cloudflare Pages, free, custom domain)

1. Go to https://dash.cloudflare.com → **Workers & Pages** → **Create application** → **Pages** → **Upload assets**
2. Drag the entire `hushlore/` folder
3. Hit Deploy. You'll get a `*.pages.dev` URL within ~30 seconds
4. **Custom domain** (after you buy hushlore.com on Namecheap):
   - In Cloudflare Pages → **Custom domains** → add `hushlore.com`
   - Update nameservers at Namecheap to Cloudflare's nameservers (Cloudflare shows you which)
   - Wait 5-30 min for DNS propagation

**Alternative deploy options:**
- **Vercel**: `vercel deploy` from this folder
- **Netlify**: drag folder into https://app.netlify.com/drop
- **GitHub Pages**: push to repo, enable Pages in settings

---

## Before launching the smoke test — checklist

### 1. Set up Stripe Payment Link
- Create Stripe account → enable test mode first to verify flow
- Dashboard → **Payment Links** → New
  - Product: `Hushlore Personalized Audio Pack`
  - Price: `$19.00 USD`
  - After payment → **Custom URL** → `https://hushlore.com/thanks.html`
  - Enable **collect customer email**
- Copy the live Payment Link URL
- Open `checkout.html` and replace `https://buy.stripe.com/REPLACE_WITH_YOUR_PAYMENT_LINK` with your real link
- Redeploy

### 2. Set up email capture (MailerLite — free up to 1k subs)
- Create MailerLite account → create group "Hushlore Quiz"
- Get your form ID / API key
- In `quiz.js`, find the `// TODO: replace with real email integration` comment and add a fetch() to MailerLite's API
- Or simplest: add a hidden MailerLite-hosted form and POST to it from JS

### 3. Smoke test safety rules (CRITICAL)
You're refunding every buyer. Stripe will flag/ban you if you don't follow these:

- **Hard cap at 25 transactions.** Then disable the Payment Link or replace the checkout button with "Sold out — join waitlist."
- **Refund within 1-2 hours** of each purchase via Stripe dashboard. Reason: "Beta capacity reached."
- **Email immediately** after refund: "Refund issued — you're on the official launch list with 50% off."
- **Use a fresh Stripe account** dedicated to this test. Never use your main business account.
- **Monitor dispute alerts** in Stripe daily. If anyone disputes: refund + personal email + free launch access.

### 4. Legal basics (EU / Slovenia)
- Add a real **Terms** page (mention 30-day refund guarantee)
- Add a real **Privacy** page (GDPR — what data you collect, how long you keep it)
- Footer cookies banner if you add any analytics tracking
- Currently the footer links are placeholders (`#`) — replace before going live

### 5. Analytics
- Add Plausible (https://plausible.io) or PostHog — measure:
  - Landing → quiz start rate
  - Quiz completion rate (which question drops people)
  - Result → checkout click rate
  - Checkout → purchase rate
- Without this, your smoke test gives you no learning. Don't skip.

### 6. Traffic (TikTok organic + paid)
- Audio romance is **TikTok-driven**. Meta is a distant second.
- Test budget: $50-100 in TikTok ads pointing at landing page
- Organic: post snippets / mood content / quiz teasers @hushlore on TikTok daily

---

## Quiz outcome scoring (`quiz.js`)

Six outcomes weighted by answer combinations:

| Outcome | Vibe |
|---|---|
| `slow-devotion` | Tender, adoring, held |
| `forbidden-whispers` | Secret, charged, inevitable |
| `commanding-embrace` | Dominant, possessive, sure |
| `best-friends-untold` | Friends-to-lovers, playful warmth |
| `enemys-confession` | Enemies-to-lovers, tense |
| `midnight-surrender` | Pure indulgence, no plot |

Edit `scoring` object in `quiz.js` to tune the matching.

---

## What's intentionally missing

- **No real audio files** — this is a fake-door smoke test. You're validating purchase intent, then refunding.
- **No backend** — purely static. Email capture goes to MailerLite, payment goes to Stripe. No server to maintain.
- **No accounts / login** — not needed at this stage.
- **No real Terms/Privacy** — add before going live.
- **Placeholder logos / avatars** — colored gradients stand in. Replace with real photography if you have it.

---

## Next steps after smoke test validates demand

1. Hire 2-3 voice narrators (Voices.com, Backstage, ACX)
2. Produce 15-20 launch stories matching the 6 outcomes
3. Add real auth + audio player (recommend Whop as fastest no-code path, or Memberstack + this site)
4. Switch from one-time pack to tripwire + monthly subscription model
5. Open the doors for real

---

**Listen with intention.**
