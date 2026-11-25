# Production readiness

## Recommendation: **the code is GO. Live payments are GO once you finish two tasks: the legal pages and the launch settings.**

All the code issues that blocked payments have been fixed and tested after your approval:
- the Google sign-in loophole
- a paid order left marked as cancelled
- the 24-hour hold on pieces
- registration revealing who has an account
- slow database saves

The full suite passes: **112 of 112 runnable automated tests**. The other 3 are features that don't exist yet.

**Two things still stop real payments, and both are yours to do:**
1. **Terms of sale and a delivery & returns page (BUG-015, P1).** These include cancellation rights and should be reviewed by a solicitor.
2. **Switch the live store on (BUG-016, P1).** Move Stripe to live keys, unpublish the test pieces and set the delivery fee.

Before turning on live payments, also run the four Stripe test cards once on staging (see the checklist at the end).

## Numbers

| Measure | Value |
| --- | ---: |
| Total test cases | **143** (115 automated + 28 manual, review or blocked) |
| Passed | **121** |
| Failed | **2** (both launch tasks for you: BUG-015, BUG-016) |
| Blocked | **5** |
| Not executed | **15** (3 features not implemented, 12 out of scope or tool unavailable) |
| Baseline automated failures fixed | 11 of 11 |
| Code coverage | Not measured (no coverage tool installed). Most API routes are exercised. Not yet covered: Google sign-in (stubbed), resend-verification, the shipped email, collection edit/delete, enquiry status changes, staff password/two-factor resets, recovery-code regeneration and demo-data removal. |

### Security findings by severity

| Severity | Open | Fixed |
| --- | ---: | ---: |
| P0 | 0 | 0 |
| P1 | 2 (legal and launch configuration) | 0 |
| P2 | 1 (BUG-019: account deletion and data export) | 6 (BUG-001, BUG-010, BUG-012, BUG-014, BUG-018, BUG-020) |
| P3 | 6 | 9 |
| P4 | 4 | 1 |

**Remaining vulnerabilities** (all low; fixes are described in `BUG_REPORT.md`):
- BUG-021 (CVSS 5.3): enquiry images are stored inside the database.
- BUG-022 (3.7): anyone holding an order reference can see its items and total.
- BUG-028: no alerting on security events.
- BUG-029: header tightening.

### Performance (throttled phone, after fixes)

| Page | LCP | CLS | Weight |
| --- | ---: | ---: | ---: |
| Home | 2.16 s | 0 | 464 KB |
| Shop | 2.97 s (was 7.38 s) | 0 | 1.96 MB (was 3.28 MB) |
| Product | 2.51 s | 0 | 604 KB |
| Checkout | 2.76 s | 0 | 837 KB |
| Account | 3.09 s | 0 | 649 KB |

Database save time for a typical change is 4 ms at 1,000 orders and 15 ms at 5,000 (it was 0.45 s and 1.6 s before BUG-018 was fixed).

### Browser compatibility

| Browser | Result |
| --- | --- |
| Chrome 153 desktop (1024–1920 px) | ✅ all 15 browser tests (re-run after the round-2 fixes) |
| Chrome 153 phone and tablet emulation (320–768 px, landscape) | ✅ no overflow, menu, bag and checkout work |
| Safari / Mobile Safari | ⚠️ Not tested here (the iPhone screenshots you sent earlier were fixed in previous rounds) |
| Firefox | ⚠️ Not tested |
| Microsoft Edge | ⚠️ Not tested (Chromium-based, so likely the same as Chrome) |
| Android Chrome (real device) | ⚠️ Not tested |

## Fixed and unresolved issues

**Fixed (16):**
- BUG-001 to BUG-014
- BUG-018
- BUG-020
- BUG-023, in part (the automated test setup is added; the Render build command still needs changing)

**Unresolved (13):**

| Issue | What's needed |
| --- | --- |
| BUG-015, BUG-016 | Your launch tasks |
| BUG-017 | Choose the VAT wording |
| BUG-019 | Self-service account deletion, data export and password change |
| BUG-021 | Store enquiry images as files |
| BUG-022 | Order lookup with an extra check |
| BUG-023 | Use `npm ci` as the Render build command |
| BUG-024 to BUG-029 | Clean-up and optional improvements |

## Modified files

| File | Change |
| --- | --- |
| `server.js` | Static-file hardening and blocklist, 405 for non-GET, branded 404, `Connection: close` on 413, wishlist restricted to public pieces, whole-number quantities, `..` refused in 3D model paths. **Round 2:** Google-link password removal, reset confirms email, 45-minute checkout hold with Stripe `expires_at`, paid-after-cancellation handling, Stripe session expiry when staff cancel, non-revealing registration |
| `postgres-store.js` | Round 2: incremental (changed-rows-only) saves |
| `admin.js` | Round 2: "Paid after cancellation" badge |
| `account.js` | Round 2: `account.html?forgot=1` opens the password-reset form |
| `404.html` | New branded "page not found" page |
| `shop.js` | Typo-tolerant search |
| `responsive.css` | Contrast and wishlist-heart fixes |
| `account.css`, `admin-studio.css`, `catalogue.css`, `home-cinematic.css`, `pages.css` | Gold text `#8d6c35` → `#7a5c2b` |
| `commerce.css` | Filter caption colour |
| `assets/catalogue/*.jpg` (16 files) | Re-encoded, same dimensions |
| `package.json` | Test scripts only; dependencies unchanged |
| `.github/workflows/tests.yml` | New CI workflow |
| `tests/**` | New test suite, harness and provider fakes |
| `testing/**` | These reports and evidence |

## Commands to reproduce

```bash
npm ci
export TEST_DATABASE_URL=postgres://USER:PASSWORD@127.0.0.1:5432/postgres   # any local PostgreSQL 16 you can create databases on
npm test                       # unit + database + API (≈1 minute; 100 tests)
npm install --no-save playwright@1 && npx playwright install chromium
npm run test:e2e               # browser tests (≈3–4 minutes; 15 tests)
npm audit --omit=dev           # dependency advisories (needs internet)
```

Individual suites: `npm run test:unit`, `npm run test:db`, `npm run test:api`, `npm run test:smoke`.

## Testing limitations

- **Production was not tested directly.** No scans or load tests, and TLS was not checked.
- **Stripe and Resend were replaced by local fakes.** Real Stripe test-card flows (declines, 3-D Secure) were not run.
- **Google sign-in used a local stand-in** that follows the same rules, so real Google tokens were not tested.
- **Only Chrome was available.** Safari, Firefox, Edge and real devices are untested.
- **Several standard tools were unavailable:** Lighthouse, axe-core, OWASP ZAP and npm audit (no registry access). Equivalent custom checks were used where possible.
- **No code-coverage measurement, no screen-reader testing and no legal review.**
- This report does not claim the site is completely secure, legally compliant or PCI DSS certified.

## Live launch checklist

- [ ] Terms of Sale and Delivery & Returns published and linked from checkout (BUG-015)
- [x] BUG-012, BUG-013, BUG-014, BUG-018 and BUG-020 fixes approved, implemented and tested
- [ ] Stripe live keys, live webhook on the final domain, `STRIPE_WEBHOOK_SECRET` set
- [ ] Test pieces unpublished; delivery fee set; VAT wording confirmed
- [ ] `APP_URL` set to the final `https://` domain; Resend sending domain verified
- [ ] `ADMIN_PATH` and `STAFF_MFA_KEY` set; owner two-factor enrolled; recovery codes stored offline
- [ ] PostgreSQL is a paid plan with backups (not a free, expiring instance); a restore has been tested once
- [ ] Four Stripe test cards run on staging; one real low-value live purchase, then refunded
- [ ] `npm ci` build command; CI green; log alerts and uptime monitor configured
- [ ] Then set `LIVE_CHECKOUT_ENABLED=true`
