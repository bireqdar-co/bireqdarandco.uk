# Bug report

**Severity scale:**
- **P0 critical:** payment bypass, data exposure, authentication bypass.
- **P1 high:** major security issue or broken critical journey.
- **P2 medium.**
- **P3 low.**
- **P4 improvement.**

CVSS v3.1 base scores are given for security findings where there is enough information to score them. Scores describe technical severity only; the business impact is described separately.

**No P0 issues were found.** After the approved round-2 fixes, the only open issues above P3 are the two launch items you need to do yourself (BUG-015, BUG-016) and the self-service privacy features (BUG-019). No payment bypass, price manipulation, authentication bypass, IDOR or stored XSS could be reproduced (see `SECURITY_AUDIT.md` for what was tried).

## Summary

| ID | Severity | Title | Status |
| --- | --- | --- | --- |
| BUG-015 | P1 | No terms of sale or delivery and returns (cancellation) information | Open – owner/legal |
| BUG-016 | P1 | Live store not launch-configured (Stripe test mode, test pieces public, no delivery fee) | Open – owner |
| BUG-012 | P2 | Payment after staff cancellation leaves a paid order marked "cancelled" | **Fixed** (approved) |
| BUG-014 | P2 | Pre-account takeover through Google sign-in linking | **Fixed** (approved) |
| BUG-020 | P2 | Abandoned checkouts can hold unique pieces for up to 24 hours | **Fixed** (approved) |
| BUG-018 | P2 | Whole-database rewrite on every change; single instance only | **Fixed** (approved) |
| BUG-019 | P2 | No self-service account deletion, data export or password change | Open – product decision |
| BUG-001 | P2 | Internal docs, tests and reports were downloadable from the website | **Fixed** |
| BUG-010 | P2 | Heavy product photography (shop page 3.3 MB, LCP 7.4 s on a phone) | **Fixed** |
| BUG-013 | P3 | Registration reveals whether an email has an account | **Fixed** (approved) |
| BUG-017 | P3 | Checkout VAT sentence reads like a system message | Open – owner wording |
| BUG-021 | P3 | Enquiry image attachments stored inside the database | Open |
| BUG-022 | P3 | Order page shows items and total to anyone holding the reference | Open – accept or harden |
| BUG-023 | P3 | Deploys use `npm install` rather than `npm ci`; no CI tests | Partly fixed (CI workflow added) |
| BUG-025 | P3 | 135–465 KB of render-blocking CSS per page | Open |
| BUG-028 | P3 | Security events not alerted; rate limits reset on restart | Open |
| BUG-002 | P3 | Wishlist accepted unpublished pieces and leaked their details | **Fixed** |
| BUG-003 | P3 | Fractional quantities silently rounded | **Fixed** |
| BUG-004 | P3 | 3D model path accepted `..` | **Fixed** |
| BUG-005 | P3 | Static files answered POST/PUT/DELETE | **Fixed** |
| BUG-006 | P3 | Connection reset after an oversized request broke the next request | **Fixed** |
| BUG-007 | P3 | Unbranded plain-text 404 page | **Fixed** |
| BUG-008 | P3 | Text contrast below WCAG AA on 9 pages | **Fixed** |
| BUG-009 | P3 | Wishlist heart nearly invisible on light photographs | **Fixed** |
| BUG-011 | P4 | Search did not tolerate typos or word order | **Fixed** |
| BUG-024 | P4 | Repository clutter (`.DS_Store`, 3 unused 2 MB PNGs, public dev preview page) | Open |
| BUG-026 | P4 | International delivery: no country rules, pricing or duties message | Open – business decision |
| BUG-027 | P4 | Luxury features not implemented (appointments, certificates, promo codes, currencies, insured delivery) | Open – product decisions |
| BUG-029 | P4 | Header hardening: HSTS without `includeSubDomains`; CSP allows inline styles and any HTTPS image | Open |

---

## Open findings

### BUG-015 · P1 · No terms of sale or delivery and returns page
- **Where:** site-wide. The checkout consent only says "…read the Privacy Notice".
- **Evidence:** page inventory; MAN-LEGAL-001.
- **Business impact:** UK distance-selling rules expect pre-contract information, including cancellation rights, delivery and returns terms and the trader's identity. Without it, cancellation periods can be extended and disputes are harder to win.
- **Remediation:**
  - Publish Terms of Sale and a Delivery & Returns page, covering the 14-day cancellation window, exceptions for bespoke or personalised pieces, and insured and hand delivery.
  - Link both from the footer and the checkout consent line.
  - Have a solicitor review them. This report is not legal advice.

### BUG-016 · P1 · Live store is not launch-configured
- **Evidence:** live `/api/catalog` check earlier in this project (MAN-OPS-001):
  - `checkoutMode: "test"`
  - the £1 test piece and the 3D sample are published
  - `shippingCents: null`
- **Business impact:** no real payments can be taken, and test listings are visible to the public.
- **Remediation:**
  - Switch Stripe to live keys and register the webhook for the production domain.
  - Set `LIVE_CHECKOUT_ENABLED=true` only after the remaining items in the checklist in `PRODUCTION_READINESS.md` are done.
  - Unpublish the test pieces and set the delivery fee (0 for complimentary).

### BUG-012 · P2 · A paid order can stay marked "cancelled"
- **Steps:**
  1. A client starts checkout, so the order is `payment_pending`.
  2. Staff set the order to `cancelled` in the studio.
  3. The client completes payment on the Stripe page, which was still open.
- **Actual:** the webhook records `paidAt` and reduces stock, but the status stays `cancelled`. The studio shows a cancelled order that has actually been paid.
- **Expected:** the order is clearly shown as paid and needing attention (or refunded).
- **Test:** PAY-008 (fails).
- **Business impact:** money is received for an order staff believe is cancelled, so the piece is never shipped or refunded.
- **Remediation, for approval:**
  1. In the webhook, if the order is `cancelled` when payment arrives, set `status: 'paid'`, record a `paidAfterCancellation` flag and log a security event.
  2. Stop staff cancelling `payment_pending` Stripe orders, or expire the Stripe session through the API when they do.
- **Fixed (approved, 25 November 2026):** when a valid payment arrives for a cancelled order, the order becomes "paid", is flagged `paidAfterCancellation`, gets a history note and a studio badge ("Paid after cancellation · check stock, then ship or refund"), and a security event is logged. Cancelling an unpaid Stripe order in the studio first closes the client’s Stripe page; if Stripe says the client has already paid, the cancellation is refused (409). Tests: PAY-008, PAY-009.

### BUG-014 · P2 · Pre-account takeover via Google sign-in · CVSS 6.8 (AV:N/AC:H/PR:N/UI:R/S:U/C:H/I:H/A:N)
- **Steps (code review, MAN-SEC-005):**
  1. An attacker registers with the victim's email and a password of their own. The account stays unverified, because the link goes to the victim.
  2. Later, the victim chooses "Continue with Google". `/api/account/google` finds the account by email, links it and marks it verified, but keeps the attacker's password hash.
  3. The attacker can now sign in with their password.
- **Business impact:** access to the victim's orders, addresses and wishlist.
- **Remediation, for approval:** when Google links to an account whose email was never verified, delete `passwordHash` and end all of that account's existing sessions. One line in `server.js`; covered by a new test once approved.
- **Fixed (approved, 25 November 2026):** if Google signs in to an account whose email was never confirmed, the stored password, pending reset link and any sessions are removed. Accounts whose owner already confirmed their email keep their password. A password reset now also confirms the email, since the link proves the inbox is theirs. Tests: ACC-019, ACC-020, ACC-021.

### BUG-020 · P2 · Unique pieces can be held by abandoned checkouts · CVSS 5.3 (AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L)
- **Detail:** a `payment_pending` Stripe order reserves stock until Stripe expires the session. That defaults to 24 hours, and the site does not set `expires_at`.
- **Impact:** for a one-of-a-kind piece, one abandoned checkout makes it show as unavailable for a day. A competitor or bot could repeat this; the checkout rate limit slows but does not stop it.
- **Remediation, for approval:** send `expires_at` of now + 30–60 minutes when creating the Checkout Session (Stripe's minimum is 30 minutes). Optionally show "Reserved while another client completes checkout".
- **Fixed (approved, 25 November 2026):** new orders hold stock for 45 minutes, and the same time is sent to Stripe as `expires_at`, so the Stripe page closes when the hold ends. Retrying an expired checkout asks the client to start again. Orders created before the change keep the old 24-hour rule until they expire. Test: PAY-010.

### BUG-018 · P2 · Whole-database rewrite on every change
- **Evidence:** MAN-PERF-003. Each save deletes and re-inserts every row:

  | Orders | Save time |
  | ---: | ---: |
  | 100 | 75 ms |
  | 1,000 | 446 ms |
  | 5,000 | 1,572 ms |

  That is on a local database; with a network hop to a hosted database it will be several times slower.
- **Other effects:**
  - Saves are queued, so a slow save delays sign-ins, checkouts and webhooks.
  - The design also requires exactly one server instance.
- **Remediation, for approval:** move to per-row `INSERT/UPDATE` for the entity that changed. Use `SELECT … FOR UPDATE` on product stock in checkout and webhooks so more than one instance could run.
- **Fixed (approved, 25 November 2026):** `postgres-store.js` now remembers what the database holds and writes only changed rows (inserts, updates, deletes) inside one transaction. A failed save is rolled back and caught up on the next save. A typical change takes 3–15 ms instead of 75–1,572 ms (see PERFORMANCE_REPORT.md). The very first save of an empty database still writes everything. The app still runs as a single server instance, which is correct for your current Render plan. Tests: DB-008 to DB-011.

### BUG-019 · P2 · No self-service deletion, export or password change
- **Tests:** ACC-015, ACC-016, ACC-017 (Not Tested: features absent).
- **Impact:** UK GDPR requests must be handled manually. Clients who know their password must use the email reset to change it.
- **Remediation:** add "Change password" (requires the current password; ends other sessions), "Download my data" (JSON) and "Delete my account". Order records should be kept anonymised for the accounting retention period.

### BUG-013 · P3 · Account enumeration at registration · CVSS 5.3 (AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N)
- **Steps:** register with an email that already has an account. The response is **409** "An account with this email already exists"; a new email gets 201. **Test:** ACC-005 (fails).
- **Mitigations already in place:**
  - Rate limits: 8 per 15 minutes per IP and 5 per email.
  - Sign-in and password reset already give identical answers (ACC-004, ACC-007 pass).
- **Remediation, for approval:** always answer "Check your email to finish creating your account". If the email already exists, send that address a "you already have an account – sign in or reset" email instead.
- **Fixed (approved, 25 November 2026):** registration now always answers "Check your email…". If the email already has an account, that address receives a "You already have an account" email with sign-in and password-reset links, and the account is not changed. The password is still hashed in both cases, so the timing matches too. Tests: ACC-005, ACC-018.

### BUG-017 · P3 · VAT sentence at checkout
- **Detail:** the checkout shows "VAT is not charged because the store is not marked UK VAT-registered."
- **Remediation:** the owner should choose the wording, for example "Prices include all applicable taxes." Confirm the VAT position with an accountant.

### BUG-021 · P3 · Enquiry attachments stored in the database · CVSS 5.3 (A:L)
- **Detail:** bespoke reference images (up to 2 MB each, as base64) are stored inside the `reservations` rows. Because every save rewrites the database (BUG-018), each attachment makes every later save slower. The limit is 8 per 15 minutes per IP.
- **Remediation:** store attachments as files in the upload folder, as product uploads already are, and keep only the path.

### BUG-022 · P3 · Order lookup by reference · CVSS 3.7 (AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:N/A:N)
- **Detail:** `/api/order?ref=` shows status, items and totals, with no name, email or address (ORD-001 passes). References have 40 bits of randomness and lookups are limited to 30 per minute (ORD-002 passes).
- **Remediation (optional):** require the order email, or the signed Stripe `session_id`, as a second factor for guest lookups.

### BUG-023 · P3 · Build reproducibility and CI
- **Detail:** `render.yaml` builds with `npm install --omit=dev`, which can resolve newer versions than the lockfile, and there were no automated tests.
- **Fixed in part:** `.github/workflows/tests.yml` now runs the full suite plus `npm audit` on every push.
- **Remaining:** change the build command to `npm ci --omit=dev`.

### BUG-025 · P3 · CSS weight
- **Detail:** every page loads 6–9 layered stylesheets, many overriding older ones with `!important` (135 KB on the home page, 465 KB on checkout). These block rendering.
- **Remediation:** consolidate the files into one stylesheet per page type, and remove unused legacy rules from `styles.css` and `commerce.css`.

### BUG-028 · P3 · Monitoring
- **Detail:** security events (failed logins, rate limits, payment mismatches) are written to stdout only. Rate-limit counters live in memory and reset on restart or deploy.
- **Remediation:**
  - Forward Render logs to a log service with alerts on `stripe_payment_mismatch`, `staff_mfa_locked` and bursts of `rate_limit_exceeded`.
  - Add uptime monitoring on `/api/store`.

### BUG-024, BUG-026, BUG-027, BUG-029 · P4
- **BUG-024:** remove `.DS_Store`, `emerald-background.png`, `hero-head-logo.png` and `watch-collection-concept.png` (the JPEG versions are used), and consider removing `3d-preview.html` from production.
- **BUG-026:** decide which countries you deliver to. The checkout currently accepts any country at the same flat fee, with no duties or import-tax message.
- **BUG-027:** the following are not implemented:
  - appointment booking
  - authenticity certificates and documents
  - promo codes
  - multi-currency display
  - insured or signature delivery choice

  They are listed so they are not assumed to exist.
- **BUG-029:** add `includeSubDomains` to HSTS once every subdomain is HTTPS. Restrict `img-src` to your own domain and Stripe, and move inline styles into CSS so `'unsafe-inline'` can be removed.

---

## Fixed findings (verified by re-running the failing tests)

| ID | Severity | What was wrong | Fix | Verified by |
| --- | --- | --- | --- | --- |
| BUG-001 | P2 · CVSS 5.3 (C:L) | `CODE_GUIDE.md`, `db/SCHEMA.md`, `skills-lock.json` and any new `tests/` or `testing/` files were public, exposing architecture details | Static server now blocks every `.md` file, `skills-lock.json` and the folders `tests/`, `testing/`, `tools/`, `api/` and `bireqdarandco.uk/` | SEC-STA-001, SEC-STA-002 |
| BUG-010 | P2 | 16 catalogue photos of 200–420 KB each; shop page 3.3 MB, LCP 7.4 s | Re-encoded at the same pixel size (mozjpeg q80, progressive, full colour); no visible difference in side-by-side crops; 4.7 MB → 2.3 MB | E2E-PERF-001 |
| BUG-002 | P3 · CVSS 4.3 | `/api/account/wishlist` accepted any product ID, including unpublished pieces, and `/api/account` returned their details | Wishlist and account only include publicly listed pieces; removing an item still works | ACC-013 |
| BUG-003 | P3 | Quantity `1.5` was rounded down to 1 instead of being refused | Quantity must be a whole number from 1 to 10 | CHK-003 |
| BUG-004 | P3 | `model3d` containing `..` was saved (it was already refused when served, so there was no file access) | Refused at save time | ADM-009 |
| BUG-005 | P3 | Static files answered any HTTP method | Only `GET` and `HEAD` are allowed; other methods get 405 with an `Allow` header | SEC-STA-005 |
| BUG-006 | P3 | After a 413 response the connection was reset while still marked keep-alive, so the client's next request failed | A 413 now sends `Connection: close` | API-002, SEC-CSRF-001 |
| BUG-007 | P3 | Missing pages showed plain "Not found." | New branded `404.html` for browsers; the API still returns JSON 404 | NAV-404-001, screenshots `404-1440.png`, `404-390.png` |
| BUG-008 | P3 | Gold small-caps labels 4.12:1, bespoke label 1.95:1, filter captions 3.94:1, sort label 4.31:1 | Deeper gold `#7a5c2b` on cream backgrounds; captions `#55665a`; all now ≥ 4.5:1 | E2E-A11Y-001 |
| BUG-009 | P3 | White wishlist heart over light photos | Soft dark veil behind the heart | E2E-A11Y-001, visual check |
| BUG-011 | P4 | "tenis" or "chain tennis" found nothing | Each search word must match; words of 4+ letters tolerate one typo | E2E-SRCH-001, E2E-SRCH-002 |
