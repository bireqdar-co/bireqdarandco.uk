# Accessibility report

**Target:** WCAG 2.2 Level AA.
**Tools:**
- Automated in-browser checks (`E2E-A11Y-001`, `E2E-A11Y-002`) on 12 pages in Chrome 153.
- Keyboard tests and reduced-motion emulation.
- Visual review of screenshots at 8 widths plus landscape.
- axe-core could not be installed here (no package registry access), so the checks were written to cover the same main rules. A screen-reader pass was **not** done.

## Result

After fixes, **all 12 pages pass every automated check**:
- `lang` and page titles
- `alt` text on every image
- labels on every visible form field
- accessible names on every visible link and button
- exactly one visible `h1`
- no duplicate `id`s
- a `<main>` landmark and a skip link
- a visible focus indicator on the first Tab stop
- body-text contrast of at least 4.5:1 (3:1 for large text)
- no endless animations when the visitor prefers reduced motion

Responsive checks: **no sideways scrolling** on any of 12 pages at 320, 375, 390, 430, 768, 1024, 1440 and 1920 px, or at 844 × 390 (phone landscape) and 1180 × 820 (tablet landscape). That is 120 page loads. Screenshots are in `testing/evidence/`.

## Issues found and fixed

| Issue | WCAG | Before | After |
| --- | --- | --- | --- |
| Gold small-caps labels ("THE COLLECTION", "FROM THE COLLECTION" and others) on cream | 1.4.3 Contrast | 4.12:1 | 5.4:1 (`#7a5c2b`) |
| "HOW SHOULD WE REACH YOU?" on the bespoke cream card | 1.4.3 | **1.95:1** | 5.4:1 |
| Filter captions (COLLECTION, STYLE, GENDER) | 1.4.3 | 3.94:1 | 5.3:1 (`#55665a`) |
| Sort label | 1.4.3 | 4.31:1 | 5.3:1 |
| Wishlist heart over light product photos | 1.4.11 Non-text contrast | nearly invisible | soft dark veil behind the heart |
| Missing pages showed plain text with no navigation | 2.4.5 Multiple ways (good practice) | plain "Not found." | branded 404 page with navigation and links |

The colour changes are small: a slightly deeper shade of the same gold and green. The brand look is unchanged.

## Already done well

- A skip link to `#main-content` on every page.
- The phone menu reports its state through `aria-expanded` and closes with Escape (E2E-RESP-002).
- Live regions (`aria-live="polite"`) for bag and form messages.
- Decorative arrows and duplicate image links are hidden from assistive technology.
- Touch targets were enlarged to 44 px in the earlier mobile work.
- Inputs use the right `autocomplete` and `inputmode` values, which helps with phone keyboards and autofill.
- Reduced motion: no endless animations run when the visitor asks for less motion.

## Remaining checks for a person to do

1. **Screen reader:** VoiceOver on iPhone and NVDA on Windows through browse → product → bag → checkout → Stripe. Check that filter dropdowns (custom `role=option` lists) announce correctly.
2. **Keyboard-only checkout:** the automated test confirmed focus is visible and the form refuses invalid input. A person should confirm the error messages are announced and that focus moves to the first invalid field.
3. **Text resize to 200%** and the browser's minimum font size setting.
4. **The 3D viewer and 360° spin:** confirm there is a keyboard alternative and that the images carry the information.
5. **Stripe Checkout** is Stripe's own page, so its accessibility is Stripe's responsibility.

## Limitations

- These checks are not axe-core and do not cover every WCAG rule.
- Contrast of text placed directly over photographs cannot be measured automatically; those places were reviewed visually.
- No screen-reader testing was done.
