# Remediation plan

## Done in this audit (safe, non-breaking, verified)

| Bug | Change | Files |
| --- | --- | --- |
| BUG-001 | Blocked `*.md`, `skills-lock.json` and the `tests/`, `testing/`, `tools/`, `api/` and `bireqdarandco.uk/` folders from being served | `server.js` |
| BUG-002 | Wishlist accepts and returns only publicly listed pieces | `server.js` |
| BUG-003 | Checkout refuses non-whole-number quantities | `server.js` |
| BUG-004 | 3D model paths containing `..` are refused at save | `server.js` |
| BUG-005 | Static files allow only `GET` and `HEAD` (405 otherwise) | `server.js` |
| BUG-006 | `Connection: close` after a 413 "too large" response | `server.js` |
| BUG-007 | Branded 404 page for browsers | `404.html` (new), `server.js` |
| BUG-008 | WCAG AA contrast for gold labels, captions and the sort label | `account.css`, `admin-studio.css`, `catalogue.css`, `home-cinematic.css`, `pages.css`, `commerce.css`, `responsive.css` |
| BUG-009 | Wishlist heart visible on light photos | `responsive.css` |
| BUG-010 | 16 catalogue photos re-encoded (4.7 MB → 2.3 MB, same size, no visible change) | `assets/catalogue/*.jpg` |
| BUG-011 | Typo-tolerant, word-order-independent search | `shop.js` |
| BUG-023 (part) | CI workflow that runs every test and `npm audit` on each push | `.github/workflows/tests.yml` |
| — | Test suite (105 automated tests), harness, provider fakes and test scripts | `tests/**`, `package.json` (scripts only; no dependency changes) |

## Done after your approval (25 November 2026)

| Bug | Change | Files | Proven by |
| --- | --- | --- | --- |
| BUG-014 | Google sign-in on an account whose email was never confirmed removes the old password and sessions. A password reset now also confirms the email. | `server.js` | ACC-019, ACC-020, ACC-021 |
| BUG-012 | Payment received after cancellation turns the order back to paid, with a flag, a history note and a studio badge. Cancelling an unpaid Stripe order first closes the Stripe page; the cancellation is refused if the client already paid. | `server.js`, `admin.js` | PAY-008, PAY-009 |
| BUG-020 | Pieces are held for 45 minutes and the Stripe page expires at the same time. Retrying an expired checkout asks the client to start again. | `server.js` | PAY-010 |
| BUG-013 | Registration gives the same answer for every email. Existing clients get a "You already have an account" email with sign-in and reset links. | `server.js`, `account.js` (the reset link in that email opens the reset form) | ACC-005, ACC-018 |
| BUG-018 | Only changed rows are written, in one transaction; a typical save takes 3–15 ms instead of up to 1.6 s. | `postgres-store.js` | DB-008 to DB-011 |

The site still runs as **one server instance**, which suits your Render plan. Running several instances at once would need row locking on stock. That is not needed now, so don't turn on autoscaling.

## Owner actions before launch (no code)

1. **BUG-015:** publish Terms of Sale and Delivery & Returns (14-day cancellation, bespoke exceptions, insured and hand delivery, trader identity and address) and have them reviewed by a solicitor. I can draft the pages once you give me your business details, delivery prices and returns window.
2. **BUG-016:**
   - Switch Stripe to live keys and register the production webhook.
   - Unpublish the £1 test piece and the 3D sample.
   - Set the delivery fee.
   - Set `LIVE_CHECKOUT_ENABLED=true` last.
3. **BUG-017:** choose the VAT wording; confirm your VAT position with an accountant.
4. **MAN-PAY-001:** on staging, pay once with each Stripe test card:
   - `4000 0000 0000 0002` (declined)
   - `4000 0000 0000 9995` (insufficient funds)
   - `4000 0000 0000 0069` (expired)
   - `4000 0027 6000 3184` (3-D Secure)

   Confirm that no order is marked paid unless Stripe succeeds.
5. Change the Render build command to `npm ci --omit=dev` (BUG-023).
6. Set up log alerts and uptime monitoring (BUG-028).

## Later improvements

In rough order of value:
1. Responsive WebP/AVIF images with `srcset` (shop page about −50%).
2. CSS consolidation (BUG-025).
3. Self-service account deletion, data export and password change (BUG-019).
4. Store enquiry attachments as files (BUG-021).
5. Order lookup with an email second factor (BUG-022).
6. Delivery country rules and duties message (BUG-026).
7. Repository clean-up (BUG-024).
8. Header tightening (BUG-029).
9. Luxury features you may want (BUG-027): appointment booking, certificates on product pages, insured delivery choice, currency display.
