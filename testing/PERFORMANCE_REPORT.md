# Performance report

## How it was measured

- Chrome 153 through Playwright, emulating an iPhone-sized phone (390 × 844) on a **throttled mid-range connection**: 1.6 Mbps down, 750 kbps up, 150 ms latency, CPU slowed 4×.
- Metrics were captured with the browser's own Performance APIs: TTFB, FCP, LCP, CLS and every response's size by type.
- The server ran locally in production mode with PostgreSQL, so **TTFB here is not the live figure**. On Render (Oregon) a UK visitor adds roughly 150–200 ms of network time to each request (see the hosting recommendation).
- Lighthouse was not available. These are the same underlying metrics that Lighthouse reports.

## Page-load results (after fixes)

| Page | FCP | LCP | CLS | Requests | Total | Images | CSS | JS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Home | 2.16 s | 2.16 s | 0 | 19 | 464 KB | 286 KB | 135 KB | 14 KB |
| Shop | 2.50 s | 2.97 s | 0 | 31 | 1,958 KB | 1,642 KB | 270 KB | 31 KB |
| Product (tennis chain) | 2.18 s | 2.51 s | 0 | 21 | 604 KB | 301 KB | 270 KB | 25 KB |
| Checkout (empty bag → bag) | 2.20 s | 2.76 s | 0 | 27 | 837 KB | 325 KB | 464 KB | 23 KB |
| Account / sign-in | 2.69 s | 3.09 s | 0 | 18 | 649 KB | 346 KB | 259 KB | 36 KB |

Against Google's "good" thresholds (LCP ≤ 2.5 s, CLS ≤ 0.1):
- **CLS is perfect (0) on every page.**
- **LCP is good or close to good everywhere** on a throttled phone. Shop and account are 0.5 s over.

### Before and after optimisation (shop page, same conditions)

| | Before | After |
| --- | ---: | ---: |
| Total transfer | 3,283 KB | 1,958 KB |
| Image bytes | 2,968 KB | 1,642 KB |
| LCP | 7.38 s | 2.97 s |
| Full load | 16.3 s | 9.8 s |

**What changed (BUG-010):** 16 catalogue photographs were re-encoded at the same pixel dimensions (mozjpeg, quality 80, progressive, full-resolution colour). The total dropped from 4.7 MB to 2.3 MB. Side-by-side 100% crops of the diamond setting and the green dial showed no visible difference. The originals are kept by git if you ever want them back.

Interaction (INP): no long tasks were seen while filtering, searching or adding to the bag; the scripts are small (14–36 KB per page). INP was not measured formally because it needs real user input traces.

## Server and database

- API responses are served from memory. Locally, TTFB was 4–12 ms for every page and API call.
- **Database writes are now incremental (BUG-018, fixed after approval).** Before, every change rewrote the whole database. Now only the rows that changed are written, in one transaction.

| Orders in the store | Before: full rewrite | After: typical change (1 order + 1 product) |
| ---: | ---: | ---: |
| 100 | 75 ms | 3 ms |
| 1,000 | 446 ms | 4 ms |
| 5,000 | 1,572 ms | 15 ms |

Measured on a local PostgreSQL 16 with a median of 5 saves. Most of what remains is the server comparing its copy with what is already saved, not database work, so a hosted database a network hop away adds only one round-trip per changed row. Start-up loading takes 12–39 ms.

## Caching

- Uploaded images: `Cache-Control: public, max-age=31536000, immutable` (they have unique file names). ✓
- HTML, CSS, JS and assets: `no-cache`, so the browser re-checks on each visit but can reuse unchanged files. This is safe, because file names are not versioned.
- API: `no-store`. ✓
- **Recommendation:** put Cloudflare (free) in front, and cache `/assets/*` and images at the edge. This matters most because the server is in Oregon and your clients are in the UK.

## Remaining recommendations, in order of value

1. **Serve modern formats and the right size.** Product cards display at about 400–600 px wide but download 1,250–1,500 px images. Adding WebP/AVIF versions at 640 px and 1,280 px with `srcset` would roughly halve the shop page again.
2. **Consolidate CSS (BUG-025).** 6–9 stylesheets per page (up to 465 KB, render-blocking) come from layers of overrides. One stylesheet per page type would save 100–300 KB and some FCP time.
3. **Host near your clients.** Move the Render service and database to Frankfurt, or put Cloudflare in front, to cut 100+ ms from every request.
4. **Fonts.** Check that web fonts use `font-display: swap` and are preloaded on the home page.
5. **Remove the three unused 2 MB PNGs** from the repository (they are not loaded by pages, but they slow every deploy).

## Not measured

- Lighthouse scores.
- Real-user field data (no analytics on the site).
- A load test with concurrent users (no authorised environment).
- The live site's TTFB.
