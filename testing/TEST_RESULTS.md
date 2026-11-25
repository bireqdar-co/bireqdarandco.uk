# Test results

**Final run:** 25 November 2026, after the approved payment, account and database fixes. Software used: Node 22.23.5, PostgreSQL 16.15 and Chrome 153 (Playwright 1.63).

**Raw output** (in `testing/evidence/`):
- `api-run.txt` and `api-junit.xml`
- `e2e-run.txt` and `e2e-junit.xml`
- `e2e-results.json`
- screenshots

## Summary

| | Automated | Manual / review | Total |
| --- | ---: | ---: | ---: |
| Test cases | 115 | 28 | **143** |
| Passed | 112 | 9 | **121** |
| Failed | 0 | 2 | **2** |
| Blocked (tool or access unavailable) | 0 | 5 | **5** |
| Not tested (feature missing or out of scope) | 3 | 12 | **15** |

### Automated results by suite (final run)

| Suite | Tests | Pass | Fail | Not tested |
| --- | ---: | ---: | ---: | ---: |
| Unit: staff two-factor (`tests/unit`) | 8 | 8 | 0 | 0 |
| Database: PostgreSQL store (`tests/integration`) | 11 | 11 | 0 | 0 |
| API: platform, headers, static files (`platform.test.cjs`) | 14 | 14 | 0 | 0 |
| API: catalogue, checkout, payments (`checkout.test.cjs`) | 32 | 32 | 0 | 0 |
| API: customer accounts (`accounts.test.cjs`) | 21 | 18 | 0 | 3 |
| API: staff studio and enquiries (`studio.test.cjs`) | 14 | 14 | 0 | 0 |
| Browser end to end (`storefront.e2e.cjs`) | 15 | 15 | 0 | 0 |
| **Total** | **115** | **112** | **0** | **3** |

Run times: 41 s for unit, database and API tests; 3 min 20 s for the browser tests.

The API tests were also run without a database, in development mode: 85 passed, 0 failed, 1 skipped (production-only) and 3 to-do.

## History

### Round 1: first run on unchanged code

**11 tests failed, each pointing to a real defect.** Nine were fixed straight away as safe changes:

| Test | Defect | Bug |
| --- | --- | --- |
| SEC-STA-002 | Internal documents (code guide, schema notes, test files) could be downloaded from the website | BUG-001 |
| ACC-013 | Hidden pieces could be saved to a wishlist, and their details came back in the account page | BUG-002 |
| CHK-003 | A quantity like 1.5 was quietly rounded down instead of refused | BUG-003 |
| ADM-009 | A 3D model path containing `..` was accepted when saving a product | BUG-004 |
| SEC-STA-005 | Page files answered upload and delete requests instead of refusing them | BUG-005 |
| SEC-CSRF-001 / API-002 | After an oversized request was refused, the next request on the same connection failed | BUG-006 |
| NAV-404-001 | Missing pages showed a plain "Not found." instead of a branded page | BUG-007 |
| E2E-A11Y-001 | Text too faint to read on 9 pages; the wishlist heart hard to see | BUG-008, BUG-009 |
| E2E-SRCH-002 | Searching "tenis" found nothing | BUG-011 |

**Product photos** were also made lighter: the shop page went from an LCP of 7.4 s to 3.0 s (BUG-010).

**Two failures waited for approval:** ACC-005 (BUG-013) and PAY-008 (BUG-012).

### Round 2: approved changes

All five approved items were implemented. Each now has tests:

| Bug | Change | Proven by |
| --- | --- | --- |
| BUG-014 | Google sign-in removes a password set by someone who never confirmed the email | ACC-019 (new), ACC-020 (new) |
| BUG-012 | A payment received after cancellation turns the order back to "paid" and flags it. Staff cancelling an unpaid order now closes the Stripe page first, and refuse to cancel if the client is already paying. | PAY-008 (now passes), PAY-009 (new) |
| BUG-020 | Checkout holds a piece for 45 minutes, not 24 hours | PAY-010 (new) |
| BUG-013 | Registration gives the same answer for new and existing emails; existing clients get an "you already have an account" email | ACC-005 (now passes), ACC-018 (new) |
| BUG-014 (related) | A password reset confirms an unconfirmed email | ACC-021 (new) |
| BUG-018 | Database saves write only what changed | DB-008, DB-009, DB-010, DB-011 (new) |

### Test corrections (test bugs, not product bugs)

- **Harness:** the HTTP client attached a body to GET requests (ADM-001, ADM-007).
- **ADM-011:** the test expected `null` and `Infinity` to be refused. JSON turns `Infinity` into `null`, and a null stock change does nothing, so neither is a defect.
- **E2E-CART-001:** the test looked for the wrong empty-bag wording. The real message is "Your bag is waiting."
- **Accessibility checker:**
  - It counted image links that are already hidden from screen readers as unnamed.
  - It cannot measure text placed over photographs, so that text was checked by eye instead.
- **Rate limits:** the checkout tests first ran from one IP address and hit the real limit. The limit now has its own test (SEC-RL-001).
- **PAY-010:** the test compared Stripe's whole-second expiry time with the order's millisecond time.

## Open failures

| Test | Severity | Summary | Bug |
| --- | --- | --- | --- |
| MAN-LEGAL-001 | P1 | No terms of sale or delivery and returns page, so cancellation rights aren't explained | BUG-015 |
| MAN-OPS-001 | P1 | The live store is still in Stripe test mode, with test pieces public and no delivery fee set | BUG-016 |

Both need you to act; neither needs a code change.

## Blocked and not tested

**Blocked** (the tool or access wasn't available here):
- npm audit
- OWASP ZAP
- Lighthouse
- axe-core
- Stripe test-card payments (declined, insufficient funds, expired card, 3-D Secure)

**Not tested:**
- Safari, Mobile Safari, Firefox, Edge and real Android phones
- screen reader
- the live site's TLS (HTTPS) setup
- load testing
- features that aren't built yet: account deletion, data export, changing your password while signed in, promo codes, appointment booking, certificates, showing prices in other currencies, and choosing insured delivery
