# Security audit

**Type:** authorised, non-destructive assessment of a **local copy** running in production mode with PostgreSQL. No production system, external service or real account was attacked.
**References:** OWASP Top 10 (2021), OWASP API Security Top 10 (2023), OWASP ASVS 4.0 Level 2 themes.
**Method:**
- line-by-line review of `server.js`, `postgres-store.js`, `staff-auth.js` and the browser scripts
- 72 automated security-relevant API and browser tests
- a secret scan of the tracked files and the full git history

Secret values are never printed in this report.

## Result in one paragraph

The core of the shop is well defended:
- Prices, totals and delivery are computed on the server.
- Orders become "paid" only through a signed, amount-checked Stripe webhook.
- Checkout and webhooks are idempotent.
- Staff need a password and an authenticator code.
- Sessions are random, stored hashed and sent as HttpOnly, Secure cookies.
- Every state-changing request must come from your own site.

**No P0 vulnerability was found.** Four medium and low-risk issues were fixed after your approval on 25 November 2026:
- pre-account takeover through Google sign-in (BUG-014)
- account enumeration at registration (BUG-013)
- unique pieces held by abandoned checkouts (BUG-020)
- a paid order left marked as cancelled (BUG-012)

The two remaining P1 issues are about launch configuration and legal pages, not about the code.

## Findings by severity

| Severity | Open | Fixed during audit |
| --- | ---: | ---: |
| P0 Critical | 0 | 0 |
| P1 High | 0 security (2 launch/legal: BUG-015, BUG-016) | 0 |
| P2 Medium | 0 | 4 (BUG-001, BUG-012, BUG-014, BUG-020) |
| P3 Low | 3 (BUG-021, BUG-022, BUG-028) | 5 (BUG-002, BUG-004, BUG-005, BUG-006, BUG-013) |
| P4 Informational | 1 (BUG-029) | 0 |

## Authentication and sessions

| Check | Result | Evidence |
| --- | --- | --- |
| Password hashing | argon2id, m=19 MiB, t=2, p=1 (OWASP minimum). Legacy scrypt hashes are upgraded at sign-in. | code, DB-007 |
| Password policy | 12–200 characters for clients and staff. No breached-password check. | ACC-003 |
| Brute force | Per IP: 8 per 15 minutes. Per account: 5 per 15 minutes, across IPs. The correct password is also refused during a lockout. | ACC-006, ADM-005 |
| Account enumeration | Sign-in, password reset and registration all give the same answer whether or not the email has an account. Existing account holders are told by email instead. | ACC-004, ACC-007, ACC-005, ACC-018 |
| Reset tokens | 256-bit random, stored as SHA-256, valid for 30 minutes, single use; reset ends all sessions. | ACC-007 |
| Email verification | Required before sign-in; 24-hour single-use token. | ACC-001 |
| Session fixation | A new random token is issued at every sign-in. | code |
| Session storage | Only SHA-256 hashes are stored. Client cookies are `HttpOnly; Secure; SameSite=Lax` and last 30 days; staff cookies are `SameSite=Strict` and last 8 hours. | ACC-002, ADM-006 |
| Logout | Deleted on the server; a stolen cookie stops working. | ACC-008 |
| Staff two-factor | Mandatory. RFC 6238 TOTP with replay protection, 5 attempts per challenge and 10 per 15 minutes per user; recovery codes hashed and single use; secrets encrypted at rest with `STAFF_MFA_KEY`. | UNIT-001…008, ADM-003, ADM-004 |
| Google sign-in | The ID token is verified against the client ID and a verified email is required. If the account's email was never confirmed, the old password and sessions are removed when Google links it (fixed BUG-014). | ACC-019, ACC-020 |

## Authorisation and access control

| Check | Result | Evidence |
| --- | --- | --- |
| Anonymous access to 14 studio routes | All return 401 | ADM-001 |
| Customer cookie on studio routes | 401 | ACC-014 |
| Worker → owner-only areas (orders, customers, settings, staff, collections) | 403; worker data has no orders or customers | ADM-007 |
| Removing staff | Their sessions end immediately | ADM-013 |
| IDOR between clients | Each client sees only their own orders; no other client's email appears | ACC-010 |
| Checkout request-ID replay by another account | 409 | CHK-010 |
| Mass assignment (email, id, passwordHash, role in profile updates) | Ignored | ACC-011 |
| Client-side controls relied on? | No. Every rule tested above is enforced on the server. | — |
| Studio address | `/admin.html` returns 404 in production; the studio is served only at `ADMIN_PATH`, with `noindex` and `no-store` | SEC-STA-004 |

## Input validation and injection

| Class | Result |
| --- | --- |
| SQL injection | Every query uses parameters (`$1`…) in `postgres-store.js`, and API input never reaches SQL directly. Search runs in the browser. SQL-style payloads were rejected or treated as plain text (ADM-011, E2E-SRCH-001). |
| NoSQL / JSON injection | Not applicable. JSON bodies must be objects, with type checks per field. |
| XSS (stored) | Enquiry markup was stored as text, and the studio never executed it (ADM-012, E2E-SEC-001). All browser rendering uses an `esc()` HTML escaper; the CSP has no `'unsafe-inline'` for scripts. |
| XSS (reflected / DOM) | Search terms and URL parameters are not written as HTML (E2E-SRCH-001 with a `<script>` payload). |
| CSRF | Every POST, PUT, PATCH and DELETE needs a same-site `Origin` (missing, foreign and look-alike origins all get 403), plus SameSite cookies (SEC-CSRF-001). |
| SSRF | The server only calls fixed hosts (Stripe, Resend, Google). No URL from users is fetched. |
| Command injection | No shell or child-process calls in the application. |
| Path traversal | Seven encoded traversal variants were blocked. Real paths are checked after symlinks are resolved. Model and spin-frame paths are validated (SEC-STA-003, ADM-009). |
| Open redirect | The account `return` parameter only allows same-origin paths (protocol-relative and backslash tricks fail the origin check). Checkout redirect URLs come from the server. |
| File uploads | Only PNG, JPEG or WebP; the magic bytes must match the declared type; 4 MB maximum; random UUID names; SVG and HTML are refused (ADM-008). Uploads are served with the correct MIME type and `nosniff`. |
| Template injection | Not applicable (no server templates). Email HTML escapes order data. |

## API security

| Check | Result |
| --- | --- |
| Request size | 7 MB cap (413), with the connection now closed after it (BUG-006 fixed) |
| Content type | JSON only (415 otherwise) |
| Error handling | 4xx gives a friendly message; 5xx gives a generic "Something went wrong"; no stack traces (API-001, CHK-013) |
| CORS | No `Access-Control-Allow-Origin` is ever sent (SEC-HDR-002) |
| HTTP methods | Unknown API routes return 404; static files now allow only `GET` and `HEAD` (BUG-005 fixed) |
| Data exposure | Product, account and order responses are allow-listed fields (SMK-003, ACC-010, ORD-001). BUG-002 fixed. |
| Rate limits | Checkout, sign-in, registration, reset, verification, enquiries, order lookup, uploads and staff writes (SEC-RL-001, ORD-002, ENQ-001) |
| Replay | Stripe signatures older than 5 minutes are refused; event IDs are deduplicated (PAY-001, PAY-003) |

## E-commerce business logic

| Attack | Result | Test |
| --- | --- | --- |
| Change the price, total, tax, delivery or discount in the request | Ignored; Stripe receives the server's catalogue price | CHK-002, CHK-014 |
| Zero, negative, huge, text or fractional quantities | Refused | CHK-003 |
| Buy more than the stock, split across finishes | Refused | CHK-004 |
| Buy enquiry-only, watch, unpublished or sample pieces | Refused | CHK-005, CAT-003 |
| Two buyers racing for the last unique piece | Exactly one succeeds | CHK-009 |
| Double submit or double click | One order, one Stripe idempotency key | CHK-008, E2E-CHK-001 |
| Fake "paid" webhook | Signature required | PAY-001 |
| Underpay (amount or currency mismatch) | Refused | PAY-004 |
| Webhook for another order | Ignored | PAY-005 |
| Staff marking orders paid, refunded or shipped before payment | Refused | ADM-010 |
| Stock below zero | Clamped and constrained in the database | ADM-011, DB-003 |
| Refunds | Not available in the site; done in the Stripe dashboard (no endpoint to abuse) | — |
| Holding stock with fake checkouts | Now limited to 45 minutes; the Stripe page closes when the hold ends (fixed BUG-020) | PAY-010 |
| Payment after cancellation | The order becomes "paid" and is flagged for staff. Staff cannot cancel while the client is paying (fixed BUG-012). | PAY-008, PAY-009 |

## Secrets and infrastructure

- **Secret scan:**
  - 150 tracked files and every commit (75 in all branches) were checked for Stripe, Resend, AWS, GitHub and Google secrets, PEM keys and database URLs with passwords.
  - **None found.** `.env` has never been committed, and `.gitignore` covers `.env*`, `/data/`, `/uploads/` and keys.
- **Client-side bundles:** no secrets. Only the public Google client ID is sent to the browser.
- **Startup checks:** production refuses to start without `DATABASE_URL` and `ADMIN_SETUP_KEY`. It also validates the formats of `APP_URL` (HTTPS for email links), the Stripe key, `ADMIN_SETUP_KEY` (32+ characters) and `RESEND_FROM_EMAIL`.
- **Live payments:** live mode is locked unless every one of these is true:
  - `LIVE_CHECKOUT_ENABLED=true`
  - PostgreSQL is in use
  - `APP_URL` is HTTPS
  - the webhook secret is set
  - the delivery fee is set
  - tax is configured
  - no sample listings are published
- **Debug output:** none in production; the setup key is printed only in development.
- **Publicly served files:** previously the internal docs (BUG-001); now blocked, with a test.
- **Database:** the app connects with one role that can change the schema (it runs `schema.sql` at start-up). Use a role that cannot create databases or roles. Render's managed database handles network access and TLS.
- **Dependencies:** 52 locked packages. `npm audit` could not run here (no registry access); it is now part of CI. Manual review found no known vulnerable pinned versions (for example, `jws` is 4.0.1, the patched release). There are no unnecessary runtime dependencies. `three` is vendored at build time by `postinstall`.

## HTTP and browser security

| Header / control | Value | Assessment |
| --- | --- | --- |
| Content-Security-Policy | `default-src 'self'`; scripts from self and Google GSI only; `object-src 'none'`; `frame-ancestors 'none'`; `base-uri 'self'`; `form-action 'self' https://checkout.stripe.com` | Strong. `style-src 'unsafe-inline'` and `img-src https:` could be tightened (BUG-029). |
| HSTS | `max-age=31536000` over HTTPS | Good; add `includeSubDomains` later |
| X-Frame-Options | `DENY` | Clickjacking protected |
| X-Content-Type-Options | `nosniff` | ✓ |
| Referrer-Policy | `strict-origin-when-cross-origin` | ✓ |
| Permissions-Policy | camera, microphone and geolocation disabled | ✓ |
| Cross-Origin-Resource-Policy | `same-origin` | ✓ |
| Caching of sensitive responses | Every API response and the studio use `no-store` | ✓ |
| Mixed content | All assets are same-origin or HTTPS | ✓ |
| TLS | Terminated by Render/Cloudflare; **not scanned** (production out of scope) | Run SSL Labs |

## Not verified

- Live TLS configuration.
- Real Stripe 3-D Secure and decline flows (they happen on Stripe's hosted page).
- A dynamic scanner (OWASP ZAP).
- `npm audit`.
- Google sign-in against real Google tokens. The tests replaced Google with a local stand-in that follows the same rules (ACC-019, ACC-020).

This audit does not certify PCI DSS compliance. Card data is handled entirely by Stripe Checkout, which normally puts the site in the simplest (SAQ A) category, but that must be confirmed with Stripe or your acquirer.
