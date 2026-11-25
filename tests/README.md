# Automated tests

Everything here runs against a **throwaway local copy** of the shop. Stripe and Resend are replaced by local fakes (`tests/helpers/mock-providers.cjs`), so no payment is taken, no email is sent and the live site is never contacted. Any other outbound request made by the server during a test is blocked and fails the test.

| Folder | What it covers | Needs |
| --- | --- | --- |
| `unit/` | Two-factor (TOTP) helpers, recovery codes, sealed secrets | Node 22 |
| `integration/` | PostgreSQL schema, constraints, rollback, round-trips | `TEST_DATABASE_URL` |
| `api/` | Catalogue, checkout, Stripe webhooks, accounts, staff studio, security headers, static files, CSRF, rate limits | Node 22 (`TEST_DATABASE_URL` runs them in production mode) |
| `e2e/` | Real browser: navigation, search, bag, guest checkout, responsive widths, accessibility, performance | `TEST_DATABASE_URL` + Playwright + Chrome/Chromium |

## Running locally

```bash
npm ci

# A PostgreSQL server you can create and drop databases on (each test file gets its own database).
export TEST_DATABASE_URL=postgres://tester:tester@127.0.0.1:5432/postgres

npm test             # unit + database + API (about 3 minutes; some studio tests wait for a fresh 30-second authenticator code)
npm run test:smoke   # quick health check

# Browser tests (Playwright is test-only and deliberately not added to package.json)
npm install --no-save playwright@1 && npx playwright install chromium
npm run test:e2e     # screenshots and metrics are written to testing/evidence/
```

Without `TEST_DATABASE_URL`, the API tests run in development mode against a temporary JSON store, and production-only checks are skipped.

## Test IDs

Each test name starts with its ID (for example `CHK-008`). The same IDs are used in `testing/TEST_CASES.md` and `testing/TEST_RESULTS.md`.

Tests marked `# TODO` describe features that are **not implemented yet** (account deletion, data export, password change). They are reported as "not tested", never as passed.

## Known failing tests

None. Every runnable test passes. Two findings had failing tests until your approval on 25 November 2026:
- ACC-005: registration revealed existing accounts.
- PAY-008: a paid order could stay marked "cancelled".

Both are now fixed. If a test ever fails, fix the behaviour; do not edit the test to make it pass.

The tests also stand in for Google sign-in (`MOCK_GOOGLE=1` in `tests/helpers/mock-providers.cjs`), so account-linking rules can be tested without real Google tokens.
