# Test plan: BIREQDAR & CO. storefront

**Scope date:** 25 November 2026
**Code under test:** the redesign folder at commit `a763f48` plus the fixes listed in `REMEDIATION_PLAN.md`
**Environment:** a local, isolated copy only. The live site (bireqdar-co-uk.onrender.com) was not attacked, load-tested or written to. Stripe and Resend were replaced by local fakes, so no real money or email moved.

## 1. Architecture under test (as found in the code)

| Area | Implementation |
| --- | --- |
| Front end | Static HTML pages with plain CSS and JavaScript, no framework or bundler. three.js is vendored for the 3D viewer. |
| Back end | A single Node.js 22 process (`server.js`, built-in `node:http`, no framework) that serves both the API and the static files. |
| Storage | PostgreSQL (`pg`, pool of 5) using `db/schema.sql`, with a local JSON file as a development fallback. The whole store is held in memory and saved as one transaction. Uploads are written to a disk folder. |
| Customer auth | Email and password (argon2id) with mandatory email verification, plus optional Google sign-in. Sessions are random tokens stored hashed, sent as `HttpOnly; SameSite=Lax; Secure` cookies and valid for 30 days. Password reset uses a single-use token valid for 30 minutes. |
| Staff auth | Owner plus "worker" roles. Password plus mandatory TOTP two-factor, with hashed recovery codes. Sessions are `SameSite=Strict` and last 8 hours. The studio is served only from a private `ADMIN_PATH`. |
| Payments | Stripe Checkout (hosted page) through the REST API with an idempotency key. Orders are confirmed only by an HMAC-signed webhook that checks the amount and currency. |
| Email | Resend REST API: verification, password reset, order confirmation and shipped emails. |
| Protections | Same-origin `Origin` check on every state-changing request; per-IP and per-account in-memory rate limits; CSP, HSTS, `X-Frame-Options`, `nosniff`, Referrer-Policy and Permissions-Policy; static-file allow and block rules. |
| Hosting | Render web service (Oregon) with a 1 GB disk, PostgreSQL, and `render.yaml`. |

### Routes and roles

- **Public pages:** `/`, shop, jewellery, timepieces, watch, product, cart, checkout, order, account, contact, bespoke, about, privacy, and the new 404 page.
- **Public API:**
  - `GET /api/store`, `/api/catalog`, `/api/product`, `/api/order`, `/api/account`, `/api/account/google-config`
  - `POST /api/reservations`, `/api/checkout`, `/api/stripe-webhook`
  - `POST /api/account/register`, `/login`, `/logout`, `/verify-email`, `/resend-verification`, `/forgot-password`, `/reset-password`, `/google`
- **Customer-only API:** `POST /api/account/profile`, `/address`, `/wishlist`.
- **Staff API (`/api/admin/*`):**
  - Anyone: `status`, `setup` (setup key), `login`, `mfa/verify`, `logout`.
  - Workers: catalogue (`products`, `upload`, `stock`) and their own two-factor settings.
  - Owner only: orders, enquiries, customers, settings, collections, staff, demo-data.
- **Roles:** anonymous visitor, guest buyer, registered client, studio worker, studio owner, Stripe (webhook caller).

### Placeholders and hard-coded values found

- Sample listings (`isDemo`) are hidden in production.
- The live catalogue also contains a £1 test piece and the "3D sample" watch.
- The watch brand list is hard-coded (7 brands).
- Allowed currencies are GBP, EUR and USD; VAT rates are 20% or 0%.
- Rate limits are hard-coded.
- Existing tests before this audit: **none**.

## 2. Strategy

| Layer | Tool | Why |
| --- | --- | --- |
| Unit | `node:test` (built in) | No new dependencies. Covers the TOTP, recovery-code and secret-sealing code. |
| Database integration | `node:test` against a throwaway PostgreSQL 16 database per run | Checks constraints, rollback and exact money values. |
| API and integration | `node:test` plus a harness that starts the real `server.js` in **production mode** on a free port, with its own database, data folder and upload folder | Tests the real code paths: HTTPS cookies, CSRF, sample listings hidden, PostgreSQL. |
| Payment provider | Preloaded fake for `api.stripe.com` and `api.resend.com` (`tests/helpers/mock-providers.cjs`); any other outbound call fails the test | No real charges or emails. Lets us inject provider failures, timeouts and duplicates. |
| Webhooks | Locally signed Stripe events (same HMAC-SHA256 scheme) | Covers valid, forged, replayed, out-of-date, mismatched and duplicated events. |
| End to end | Playwright library with Chrome 153. The browser uses `https://shop.test`, which is routed to the local server. | Real browser behaviour with Secure cookies and CSRF checks working as in production. |
| Accessibility | Custom in-page WCAG checks (alt text, labels, accessible names, one `h1`, duplicate ids, landmarks, contrast, skip link, focus visibility, reduced motion) | axe-core was not installable here (no registry access). |
| Performance | Chrome DevTools Protocol: Fast-3G-like network (1.6 Mbps, 150 ms) and 4× CPU slowdown; LCP, CLS, FCP, TTFB, bytes by type; plus a database save benchmark | Lighthouse was not installable. |
| Security review | Line-by-line review of `server.js`, `postgres-store.js`, `staff-auth.js` and client scripts against the OWASP Top 10, OWASP API Top 10 and ASVS L2 themes; secret scan of tracked files and full git history | Covers areas automation cannot reach. |

### Isolation and test data

- Each test file gets its own server, its own PostgreSQL database (created and dropped automatically) and its own temporary folders.
- Every test client uses its own simulated IP address (`CF-Connecting-IP`, trusted only when running behind Render, which the harness reproduces), so rate limits apply realistically.
- Test accounts and products are created through the real API with random emails and names. No real customer data is used.

## 3. Entry and exit criteria

- **Entry:** the server starts in production mode with PostgreSQL, and the baseline run is recorded.
- **Exit:**
  - Every test was executed or explicitly marked Blocked or Not Tested with a reason.
  - Every failure has a bug ID.
  - Safe fixes are re-tested and a full regression run is green, apart from findings that need approval.

## 4. Workflow followed

1. Inspect the project.
2. Write this plan.
3. Run a baseline (11 product defects found by the automated tests).
4. Fix safe, non-breaking issues.
5. Hold payment, authentication and architecture changes for approval.
6. Re-run the failed tests.
7. Run the full regression suite.
8. Write the reports.

## 5. Out of scope or not possible here

- **Live production:** no scanning or load testing.
- **Real Stripe test cards and 3-D Secure:** these need the owner's Stripe dashboard.
- **Other browsers:** Safari, Firefox, Edge and real devices.
- **Tools not available here:** Lighthouse, axe-core, OWASP ZAP, npm audit (no registry access).
- **Legal compliance opinions:** technical findings only.
