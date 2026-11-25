'use strict';
// Browser end-to-end tests (Playwright library + Chrome/Chromium).
// The browser talks to https://shop.test; every request is routed to the local test
// server, so the site runs in production mode (HTTPS cookies, CSRF origin checks,
// PostgreSQL) without touching the live website. Stripe Checkout is stubbed.
//
// Run: TEST_DATABASE_URL=postgres://... CHROME_PATH=/path/to/chrome node --test tests/e2e/
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const h = require('../helpers/harness.cjs');

let playwright = null;
try { playwright = require('playwright'); } catch { try { playwright = require('@playwright/test'); } catch {} }
const skip = !playwright ? 'Playwright is not installed (npm i -D playwright)' : !h.hasDatabase ? 'needs TEST_DATABASE_URL' : false;
const EVIDENCE = path.join(h.ROOT, 'testing', 'evidence');
const ORIGIN = h.APP_ORIGIN;

const PAGES = ['/', '/shop.html', '/jewellery.html', '/timepieces.html', '/shop.html?collection=watches', '/product.html?slug=tennis-chain-3mm-925-silver', '/cart.html', '/account.html', '/contact.html', '/bespoke.html', '/about.html', '/privacy.html', '/watch.html', '/order.html?ref=BC-0000000000'];
const WIDTHS = [320, 375, 390, 430, 768, 1024, 1440, 1920];

describe('Storefront in the browser', { skip }, () => {
  let server, browser, owner, ipSeq = 10;
  const results = { overflow: [], consoleErrors: [], a11y: [], perf: [] };

  before(async () => {
    fs.mkdirSync(EVIDENCE, { recursive: true });
    server = await h.startServer({ mode: 'production' });
    owner = await h.ownerClient(server);
    browser = await playwright.chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  });
  after(async () => {
    fs.writeFileSync(path.join(EVIDENCE, 'e2e-results.json'), JSON.stringify(results, null, 2));
    await browser?.close();
    await server?.stop();
  });

  async function context(opts = {}) {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true, ...opts });
    const ip = `203.0.113.${ipSeq++ % 250}`;
    await ctx.route(`${ORIGIN}/**`, async route => {
      const req = route.request();
      const url = req.url().replace(ORIGIN, server.base);
      const response = await route.fetch({ url, headers: { ...req.headers(), 'x-forwarded-proto': 'https', 'cf-connecting-ip': ip } });
      await route.fulfill({ response });
    });
    await ctx.route('https://checkout.stripe.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Stripe test checkout (stub)</title><h1>Stripe test checkout stub</h1>' }));
    await ctx.route('https://accounts.google.com/**', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
    return ctx;
  }
  async function open(ctx, url) {
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(String(e)));
    page.errors = errors;
    await page.goto(ORIGIN + url, { waitUntil: 'networkidle' });
    return page;
  }

  it('E2E-NAV-001 every page loads without script errors (desktop and phone)', async () => {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const ctx = await context({ viewport, isMobile: viewport.width < 500, hasTouch: viewport.width < 500 });
      for (const url of PAGES) {
        const page = await open(ctx, url);
        const errs = page.errors.filter(e => !/Failed to load resource.*404/.test(e) || !url.startsWith('/order.html'));
        if (errs.length) results.consoleErrors.push({ url, viewport: viewport.width, errors: errs });
        await page.close();
      }
      await ctx.close();
    }
    assert.deepEqual(results.consoleErrors, []);
  });

  it('E2E-NAV-002 every internal link on every page resolves (no broken links)', async () => {
    const ctx = await context();
    const links = new Set();
    for (const url of PAGES) {
      const page = await open(ctx, url);
      for (const href of await page.$$eval('a[href]', as => as.map(a => a.href))) if (href.startsWith('https://shop.test/')) links.add(href.split('#')[0]);
      await page.close();
    }
    const broken = [];
    for (const href of links) {
      const r = await server.client().get(href.replace(ORIGIN, ''), { raw: true });
      if (r.status >= 400) broken.push(`${href} → ${r.status}`);
    }
    await ctx.close();
    assert.deepEqual(broken, [], `${links.size} links checked`);
  });

  it('E2E-NAV-003 back/forward and refresh keep the shopper where they were', async () => {
    const ctx = await context();
    const page = await open(ctx, '/');
    await page.goto(ORIGIN + '/shop.html?collection=gold', { waitUntil: 'networkidle' });
    await page.goto(ORIGIN + '/product.html?slug=tennis-chain-3mm-925-silver', { waitUntil: 'networkidle' });
    await page.goBack({ waitUntil: 'networkidle' });
    assert.match(page.url(), /shop\.html\?collection=gold/);
    await page.goForward({ waitUntil: 'networkidle' });
    assert.match(await page.textContent('#product-detail'), /Tennis Chain/);
    await page.reload({ waitUntil: 'networkidle' });
    assert.match(await page.textContent('#product-detail'), /Tennis Chain/);
    await ctx.close();
  });

  it('E2E-SRCH-001 catalogue search: exact, partial, case, special characters, empty, very long, no results', async () => {
    const ctx = await context();
    const page = await open(ctx, '/shop.html');
    const visible = async q => { await page.fill('#search', q); await page.waitForTimeout(150); return page.$$eval('[data-store-card]', cards => cards.filter(c => c.offsetParent !== null).map(c => c.textContent)); };
    const total = (await visible('')).length;
    assert.ok(total > 0, 'empty search shows all pieces');
    const outcomes = {};
    for (const q of ['Tennis Chain 3 mm', 'tenn', 'TENNIS', 'tennis chain', 'Tenis chain', '925', '<script>alert(1)</script>', '%', '"', "' OR 1=1 --", 'x'.repeat(5000), 'zzzz-no-such-piece']) {
      const cards = await visible(q);
      outcomes[q.slice(0, 40)] = cards.length;
    }
    results.search = outcomes;
    assert.ok(outcomes['Tennis Chain 3 mm'] >= 1, 'exact name');
    assert.ok(outcomes.tenn >= 1, 'partial name');
    assert.ok(outcomes.TENNIS >= 1, 'case-insensitive');
    assert.equal(outcomes['zzzz-no-such-piece'], 0);
    assert.equal(await page.isVisible('#shop-empty'), true, 'empty state shown when nothing matches');
    assert.equal(await page.evaluate(() => window.__pwned), undefined);
    assert.deepEqual(page.errors, []);
    await ctx.close();
  });

  it('E2E-SRCH-002 search tolerates a common misspelling', async () => {
    const ctx = await context();
    const page = await open(ctx, '/shop.html');
    await page.fill('#search', 'tenis');
    await page.waitForTimeout(150);
    const n = await page.$$eval('[data-store-card]', cards => cards.filter(c => c.offsetParent !== null).length);
    await ctx.close();
    assert.ok(n >= 1, 'misspelled "tenis" finds the tennis chain');
  });

  it('E2E-CART-001 bag: add, persist after refresh, quantity limits, remove, empty state', async () => {
    const p = await h.createProduct(owner, { name: 'E2E Signet Ring', priceCents: 129500, stock: 2 });
    const ctx = await context();
    const page = await open(ctx, `/product.html?slug=${p.slug}`);
    await page.click('#add-to-bag');
    await page.waitForFunction(() => document.querySelector('#cart-count')?.textContent.trim() === '1');
    await page.goto(ORIGIN + '/cart.html', { waitUntil: 'networkidle' });
    await page.reload({ waitUntil: 'networkidle' });
    assert.match(await page.textContent('#cart-content'), /E2E Signet Ring/);
    assert.match(await page.textContent('#cart-content'), /1,295\.00/);
    await page.click('[data-step="1"]');
    await page.click('[data-step="1"]');
    const qty = await page.$eval('input[data-line]', i => Number(i.value));
    assert.equal(qty, 2, 'cannot exceed available stock (2)');
    await page.click('[data-step="-1"]'); await page.click('[data-step="-1"]'); await page.click('[data-step="-1"]');
    assert.equal(await page.$eval('input[data-line]', i => Number(i.value)), 1, 'cannot go below 1');
    await page.fill('input[data-line]', '-5'); await page.dispatchEvent('input[data-line]', 'change');
    assert.equal(await page.$eval('input[data-line]', i => Number(i.value)), 1, 'negative typed quantity is corrected');
    await page.click('[data-remove]');
    await page.waitForTimeout(150);
    assert.match(await page.textContent('#cart-content'), /bag is waiting|empty|nothing/i, 'empty-bag message shown');
    await page.screenshot({ path: path.join(EVIDENCE, 'cart-empty-390.png') }).catch(() => {});
    await ctx.close();
  });

  it('E2E-CART-002 a piece withdrawn while in the bag cannot be checked out', async () => {
    const p = await h.createProduct(owner, { name: 'E2E Withdrawn Pendant', priceCents: 50000, stock: 1 });
    const ctx = await context();
    const page = await open(ctx, `/product.html?slug=${p.slug}`);
    await page.click('#add-to-bag');
    await owner.put(`/api/admin/products/${p.id}`, { ...p, published: false });
    await page.goto(ORIGIN + '/checkout.html', { waitUntil: 'networkidle' });
    const message = await page.textContent('#checkout-error');
    assert.match(message, /no longer available/i);
    assert.equal(await page.$eval('.checkout-submit', b => b.disabled), true);
    await ctx.close();
  });

  it('E2E-CHK-001 guest checkout journey reaches Stripe test checkout; double-clicking creates one order', async () => {
    const p = await h.createProduct(owner, { name: 'E2E Guest Bracelet', priceCents: 349000, stock: 3 });
    const ctx = await context({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await open(ctx, `/product.html?slug=${p.slug}`);
    assert.match(await page.textContent('#product-detail'), /3,490\.00/);
    assert.match(await page.textContent('#product-detail'), /Delivered by hand/i, 'pieces over £2,500 show the hand-delivery note');
    await page.click('#add-to-bag');
    await page.goto(ORIGIN + '/checkout.html', { waitUntil: 'networkidle' });
    assert.equal(await page.isVisible('#checkout-guest'), true, 'guest checkout offered');
    await page.fill('[name=name]', 'Grace Kelly');
    await page.fill('[name=email]', 'grace.e2e@example.com');
    await page.fill('[name=phone]', '+44 7700 900321');
    await page.fill('[name=address1]', '10 Mount Street');
    await page.fill('[name=city]', 'London');
    await page.fill('[name=postalCode]', 'w1k2tp');
    await page.locator('[name=postalCode]').blur();
    assert.equal(await page.inputValue('[name=postalCode]'), 'W1K 2TP');
    await page.check('[name=acceptTerms]');
    await page.screenshot({ path: path.join(EVIDENCE, 'checkout-guest-390.png'), fullPage: true }).catch(() => {});
    await Promise.all([page.waitForURL(/checkout\.stripe\.com/), page.dblclick('.checkout-submit')]);
    const data = await owner.get('/api/admin/data');
    const orders = data.data.orders.filter(o => o.items.some(i => i.id === p.id));
    assert.equal(orders.length, 1, 'double click must create exactly one order');
    assert.equal(orders[0].status, 'payment_pending');
    assert.equal(orders[0].totalCents, 349000 + (orders[0].shippingCents || 0));
    await ctx.close();
  });

  it('E2E-CHK-002 checkout refuses an invalid form in the browser before calling the server', async () => {
    const p = await h.createProduct(owner, { priceCents: 1000, stock: 1 });
    const ctx = await context();
    const page = await open(ctx, `/product.html?slug=${p.slug}`);
    await page.click('#add-to-bag');
    await page.goto(ORIGIN + '/checkout.html', { waitUntil: 'networkidle' });
    let posted = false;
    page.on('request', r => { if (r.url().endsWith('/api/checkout')) posted = true; });
    await page.fill('[name=name]', 'X');
    await page.fill('[name=email]', 'not-an-email');
    await page.click('.checkout-submit');
    await page.waitForTimeout(300);
    assert.equal(posted, false);
    await ctx.close();
  });

  it('E2E-SEC-001 enquiry markup does not execute in the staff studio', async () => {
    await server.client().post('/api/reservations', { name: 'Mallory Test', email: 'mallory@example.com', message: '<img src=x onerror="window.__pwned=1">', reference: '<svg onload="window.__pwned=2">' });
    const ctx = await context();
    const cookie = [...owner.cookies].map(([name, value]) => ({ name, value, domain: 'shop.test', path: '/', secure: true, httpOnly: true, sameSite: 'Strict' }));
    await ctx.addCookies(cookie);
    const page = await open(ctx, '/' + h.ADMIN_PATH);
    await page.waitForTimeout(800);
    const tabs = await page.$$('button, a');
    for (const t of tabs) { const label = (await t.textContent() || '').trim(); if (/enquir/i.test(label)) { await t.click().catch(() => {}); break; } }
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => window.__pwned), undefined);
    await ctx.close();
  });

  it('E2E-RESP-001 no page scrolls sideways at any tested width (portrait and landscape)', async () => {
    const sizes = [...WIDTHS.map(w => ({ width: w, height: w < 768 ? 844 : 900 })), { width: 844, height: 390 }, { width: 1180, height: 820 }];
    for (const viewport of sizes) {
      const ctx = await context({ viewport, isMobile: viewport.width < 768, hasTouch: viewport.width < 1100 });
      for (const url of PAGES.slice(0, 12)) {
        const page = await open(ctx, url);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (over > 1) results.overflow.push({ url, viewport: `${viewport.width}x${viewport.height}`, extraPx: over });
        if (url === '/' || url.startsWith('/product')) await page.screenshot({ path: path.join(EVIDENCE, `${url === '/' ? 'home' : 'product'}-${viewport.width}x${viewport.height}.png`) }).catch(() => {});
        await page.close();
      }
      await ctx.close();
    }
    assert.deepEqual(results.overflow, []);
  });

  it('E2E-RESP-002 the phone menu opens, traps nothing, and closes with Escape', async () => {
    const ctx = await context({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
    const page = await open(ctx, '/');
    const toggle = await page.$('.menu-toggle, [aria-controls][aria-expanded], button[aria-label*="menu" i]');
    assert.ok(toggle, 'menu button exists');
    await toggle.click();
    await page.waitForTimeout(300);
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false', 'Escape closes the menu');
    await ctx.close();
  });

  it('E2E-A11Y-001 automated accessibility checks (images, labels, names, language, headings, contrast)', async () => {
    const ctx = await context();
    const issues = [];
    for (const url of PAGES.slice(0, 12)) {
      const page = await open(ctx, url);
      const found = await page.evaluate(() => {
        const out = [];
        const visible = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
        if (!document.documentElement.lang) out.push('html element has no lang');
        if (!document.title.trim()) out.push('page has no title');
        for (const img of document.querySelectorAll('img')) if (!img.hasAttribute('alt')) out.push(`img without alt: ${img.getAttribute('src')}`);
        for (const el of document.querySelectorAll('input:not([type=hidden]), select, textarea')) {
          if (!visible(el)) continue;
          const named = el.labels?.length || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.title;
          if (!named) out.push(`form field without label: ${el.name || el.id || el.type}`);
        }
        for (const el of document.querySelectorAll('button, a[href], [role=button]')) {
          if (!visible(el) || el.closest('[aria-hidden="true"]')) continue;
          const name = (el.getAttribute('aria-label') || el.textContent || el.title || el.querySelector('img[alt]')?.alt || '').trim();
          if (!name) out.push(`control without an accessible name: ${el.outerHTML.slice(0, 80)}`);
        }
        const h1 = [...document.querySelectorAll('h1')].filter(visible);
        if (h1.length !== 1) out.push(`expected one visible h1, found ${h1.length}`);
        const ids = {}; for (const el of document.querySelectorAll('[id]')) ids[el.id] = (ids[el.id] || 0) + 1;
        for (const [id, n] of Object.entries(ids)) if (n > 1) out.push(`duplicate id: ${id}`);
        if (!document.querySelector('main')) out.push('no <main> landmark');
        // Contrast of visible text against its nearest opaque background (WCAG 1.4.3).
        const parse = c => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).map(Number); return { r, g, b, a }; };
        const lum = ({ r, g, b }) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
        const bgOf = el => { for (let e = el; e; e = e.parentElement) { const s = getComputedStyle(e); if (s.backgroundImage !== 'none') return null; const c = parse(s.backgroundColor); if (c && c.a >= 0.95) return c; } return { r: 255, g: 255, b: 255, a: 1 }; };
        let low = 0; const samples = [];
        for (const el of document.querySelectorAll('p, a, li, span, label, button, h2, h3, small, td')) {
          if (!visible(el) || ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
          const s = getComputedStyle(el); const fg = parse(s.color); const own = parse(s.backgroundColor);
          // Text on a translucent veil over photography cannot be measured here; it is checked visually instead.
          if (own && own.a > 0.05 && own.a < 0.95) continue;
          const bg = bgOf(el); if (!fg || !bg || fg.a < 0.5) continue;
          const [l1, l2] = [lum(fg), lum(bg)].sort((a, b) => b - a); const ratio = (l1 + 0.05) / (l2 + 0.05);
          const large = parseFloat(s.fontSize) >= 24 || (parseFloat(s.fontSize) >= 18.66 && Number(s.fontWeight) >= 700);
          if (ratio < (large ? 3 : 4.5)) { low++; if (samples.length < 3) samples.push(`${el.tagName.toLowerCase()} "${el.textContent.trim().slice(0, 30)}" ${ratio.toFixed(2)}:1`); }
        }
        if (low) out.push(`low-contrast text elements: ${low} (e.g. ${samples.join('; ')})`);
        if (!document.querySelector('a.skip-link, a[href="#main-content"]')) out.push('no skip link');
        return out;
      });
      if (found.length) issues.push({ url, issues: found });
      // Keyboard: the first Tab must land on something with a visible focus indicator.
      await page.keyboard.press('Tab');
      const focus = await page.evaluate(() => { const el = document.activeElement; if (!el || el === document.body) return 'nothing focused'; const s = getComputedStyle(el); return (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none' ? 'ok' : `no visible focus on ${el.tagName}`; });
      if (focus !== 'ok') issues.push({ url, issues: [focus] });
      await page.close();
    }
    results.a11y = issues;
    await ctx.close();
    assert.deepEqual(issues, []);
  });

  it('E2E-A11Y-002 reduced-motion preference is honoured', async () => {
    const ctx = await context({ reducedMotion: 'reduce' });
    const page = await open(ctx, '/');
    const running = await page.evaluate(() => document.getAnimations().filter(a => a.playState === 'running' && (a.effect?.getTiming().iterations === Infinity)).length);
    await ctx.close();
    assert.equal(running, 0, `${running} infinite animations still running with reduced motion`);
  });

  it('E2E-PERF-001 page-load metrics on a throttled mid-range phone (Fast 3G-like, 4x CPU)', async () => {
    for (const url of ['/', '/shop.html', '/product.html?slug=tennis-chain-3mm-925-silver', '/checkout.html', '/account.html']) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      const page = await ctx.newPage();
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8 });
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      await page.addInitScript(() => {
        window.__lcp = 0; window.__cls = 0;
        new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
        new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
      });
      let bytes = 0, js = 0, css = 0, img = 0, requests = 0;
      page.on('response', async r => { requests++; try { const b = (await r.body()).length; bytes += b; const t = r.headers()['content-type'] || ''; if (t.includes('javascript')) js += b; else if (t.includes('css')) css += b; else if (t.startsWith('image/')) img += b; } catch {} });
      await page.goto(server.base + url, { waitUntil: 'load', timeout: 120000 });
      await page.waitForTimeout(2500);
      const m = await page.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; const fcp = performance.getEntriesByName('first-contentful-paint')[0]; return { ttfb: Math.round(n.responseStart), fcp: Math.round(fcp?.startTime || 0), lcp: Math.round(window.__lcp), cls: Number(window.__cls.toFixed(3)), load: Math.round(n.loadEventEnd) }; });
      results.perf.push({ url, ...m, requests, totalKB: Math.round(bytes / 1024), jsKB: Math.round(js / 1024), cssKB: Math.round(css / 1024), imageKB: Math.round(img / 1024) });
      await ctx.close();
    }
    const bad = results.perf.filter(p => p.cls > 0.1);
    assert.deepEqual(bad, [], 'CLS must stay under 0.1');
  });
});
