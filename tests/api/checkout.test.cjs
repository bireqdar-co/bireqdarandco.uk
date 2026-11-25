'use strict';
// Catalogue, bag/checkout, payment and webhook tests. Stripe is mocked: no real payment
// provider is contacted and no money moves.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const h = require('../helpers/harness.cjs');

describe('Catalogue, checkout and payments', () => {
  let server, owner, shopper;
  before(async () => { server = await h.startServer(); owner = await h.ownerClient(server); shopper = server.client(); });
  after(async () => { await server.stop(); });

  const stripeCalls = () => server.outbox().filter(e => e.provider === 'stripe');
  // Checkout is rate limited per client IP (10 per 15 minutes), so each call uses a fresh client IP
  // unless a specific (signed-in) client is passed.
  const checkout = (client, items, overrides) => (client === shopper ? server.client() : client).post('/api/checkout', h.guestCheckout(items, overrides));

  // ---- Catalogue -----------------------------------------------------------------
  it('CAT-001 a published piece loads by slug; unknown slugs return 404', async () => {
    const r = await shopper.get('/api/product?slug=tennis-chain-3mm-925-silver');
    assert.equal(r.status, 200);
    assert.equal(r.data.product.priceCents, 18000);
    assert.equal((await shopper.get('/api/product?slug=does-not-exist')).status, 404);
    assert.equal((await shopper.get('/api/product')).status, 404);
  });

  it('CAT-002 unpublished pieces are hidden from the catalogue and product page', async () => {
    const hidden = await h.createProduct(owner, { published: false });
    const cat = await shopper.get('/api/catalog');
    assert.ok(!cat.data.products.some(p => p.id === hidden.id));
    assert.equal((await shopper.get(`/api/product?slug=${hidden.slug}`)).status, 404);
  });

  it('CAT-003 sample/demo listings are hidden in production', { skip: !h.hasDatabase && 'production mode only' }, async () => {
    const cat = await shopper.get('/api/catalog');
    assert.ok(!cat.data.products.some(p => p.isDemo));
    assert.equal((await shopper.get('/api/product?slug=gold-pendant-sample')).status, 404);
  });

  it('CAT-004 high-value prices are stored and returned exactly (no float rounding)', async () => {
    const p = await h.createProduct(owner, { priceCents: 99999999, stock: 1 });
    const r = await shopper.get(`/api/product?slug=${p.slug}`);
    assert.equal(r.data.product.priceCents, 99999999);
    const bad = await owner.post('/api/admin/products', { name: 'Too expensive', type: 'jewellery', priceCents: 100000001, collectionId: 'col-gold' });
    assert.equal(bad.status, 400, 'prices above £1,000,000 are refused');
    const fractional = await owner.post('/api/admin/products', { name: 'Fraction', type: 'jewellery', priceCents: 1999.5, collectionId: 'col-gold' });
    assert.equal(fractional.status, 400);
  });

  // ---- Checkout validation -------------------------------------------------------
  it('CHK-001 a guest can check out and is redirected to Stripe test checkout', async () => {
    const p = await h.createProduct(owner, { priceCents: 250000, stock: 3 });
    const r = await checkout(shopper, [{ id: p.id, quantity: 1 }]);
    assert.equal(r.status, 200, r.text);
    assert.match(r.data.redirectUrl, /^https:\/\/checkout\.stripe\.com\//);
    assert.match(r.data.reference, /^BC-[A-F0-9]{10}$/);
    const order = await h.findOrder(owner, r.data.reference);
    assert.equal(order.status, 'payment_pending');
    assert.equal(order.guest, true);
    assert.equal(order.customerId, null);
    assert.equal(order.paidAt, undefined, 'must not be paid before Stripe confirms');
  });

  it('CHK-002 prices, totals and delivery come from the server, not the browser', async () => {
    const p = await h.createProduct(owner, { priceCents: 480000, stock: 2 });
    const before = stripeCalls().length;
    const r = await checkout(shopper, [{ id: p.id, quantity: 2, priceCents: 1, price: 1, name: 'Free' }], { totalCents: 1, shippingCents: 0, subtotalCents: 1, taxCents: 0, discount: 100 });
    assert.equal(r.status, 200, r.text);
    const call = stripeCalls().slice(before).pop();
    assert.equal(call.params['line_items[0][price_data][unit_amount]'], '480000');
    assert.equal(call.params['line_items[0][quantity]'], '2');
    assert.equal(call.params['line_items[0][price_data][product_data][name]'], p.name);
    const order = await h.findOrder(owner, r.data.reference);
    assert.equal(order.subtotalCents, 960000);
    assert.equal(order.totalCents, 960000 + order.shippingCents);
  });

  it('CHK-003 invalid quantities are rejected (zero, negative, too many, non-numeric, fractional)', async () => {
    const p = await h.createProduct(owner, { priceCents: 10000, stock: 50 });
    for (const quantity of [0, -1, 11, 'abc', null, 1e9]) {
      const r = await checkout(shopper, [{ id: p.id, quantity }]);
      assert.equal(r.status, 400, `quantity ${quantity} returned ${r.status}`);
    }
    const fractional = await checkout(shopper, [{ id: p.id, quantity: 1.5 }]);
    assert.equal(fractional.status, 400, 'fractional quantities must be refused, not rounded');
  });

  it('CHK-004 quantities above available stock are refused, including split across lines', async () => {
    const p = await h.createProduct(owner, { priceCents: 10000, stock: 2, finishOptions: ['Silver', 'Yellow gold plated'] });
    const over = await checkout(shopper, [{ id: p.id, quantity: 3, finish: 'Silver' }]);
    assert.equal(over.status, 409);
    const split = await checkout(shopper, [{ id: p.id, quantity: 2, finish: 'Silver' }, { id: p.id, quantity: 1, finish: 'Yellow gold plated' }]);
    assert.equal(split.status, 409);
  });

  it('CHK-005 unknown, unpublished, enquiry-only and watch pieces cannot be bought', async () => {
    const hidden = await h.createProduct(owner, { published: false });
    const enquiry = await h.createProduct(owner, { priceCents: null, inquiryOnly: true });
    const watch = await h.createProduct(owner, { type: 'watch', brand: 'Rolex', collectionId: 'col-watches', priceCents: 1500000, category: '' });
    for (const id of ['no-such-id', hidden.id, enquiry.id, watch.id, 'rolex-gmt-master-ii-126718grnr', 'concept-watch-3d-sample']) {
      const r = await checkout(shopper, [{ id, quantity: 1 }]);
      assert.equal(r.status, 409, `${id} returned ${r.status}`);
    }
  });

  it('CHK-006 an empty or oversized bag is refused', async () => {
    assert.equal((await checkout(shopper, [])).status, 400);
    assert.equal((await checkout(shopper, 'not-a-list')).status, 400);
    const p = await h.createProduct(owner, { stock: 100, priceCents: 100 });
    const lines = Array.from({ length: 31 }, () => ({ id: p.id, quantity: 1 }));
    assert.equal((await checkout(shopper, lines)).status, 400);
    assert.equal((await checkout(shopper, [null])).status, 400);
  });

  it('CHK-007 delivery details are validated on the server', async () => {
    const p = await h.createProduct(owner, { stock: 20, priceCents: 1000 });
    const items = [{ id: p.id, quantity: 1 }];
    const cases = {
      'missing name': { name: '' }, 'script in name': { name: '<script>alert(1)</script>' }, 'invalid email': { email: 'not-an-email' },
      'email with spaces': { email: 'a b@example.com' }, 'missing address': { address1: '' }, 'invalid UK postcode': { postalCode: 'ABC' },
      'phone letters': { phone: 'call me' }, 'phone too short': { phone: '123' }, 'missing city': { city: '' }, 'terms not accepted': { acceptTerms: false },
      'terms as string': { acceptTerms: 'true' }, 'country markup': { country: '<b>UK</b>' }
    };
    for (const [label, override] of Object.entries(cases)) {
      const r = await checkout(shopper, items, override);
      assert.equal(r.status, 400, `${label} returned ${r.status}`);
    }
    const intl = await checkout(shopper, items, { country: 'France', postalCode: '75008', city: 'Paris' });
    assert.equal(intl.status, 200, 'international addresses are accepted');
    const ukFormatted = await checkout(shopper, items, { postalCode: 'sw1a1aa' });
    assert.equal(ukFormatted.status, 200);
    assert.equal((await h.findOrder(owner, ukFormatted.data.reference)).customer.postalCode, 'SW1A 1AA');
  });

  it('CHK-008 repeating the same checkout request is idempotent (no duplicate order or charge)', async () => {
    const p = await h.createProduct(owner, { stock: 5, priceCents: 70000 });
    const body = h.guestCheckout([{ id: p.id, quantity: 1 }]);
    const buyer = server.client();
    const first = await buyer.post('/api/checkout', body);
    const second = await buyer.post('/api/checkout', body);
    const results = await Promise.all([1, 2, 3].map(() => buyer.post('/api/checkout', body)));
    assert.equal(first.status, 200);
    for (const r of [second, ...results]) assert.equal(r.data.reference, first.data.reference);
    const data = await owner.get('/api/admin/data');
    assert.equal(data.data.orders.filter(o => o.checkoutRequestId === body.requestId).length, 1);
    const keys = new Set(stripeCalls().filter(c => c.params['line_items[0][price_data][product_data][name]'] === p.name).map(c => c.idempotencyKey));
    assert.equal(keys.size, 1, 'every Stripe call for this request uses one idempotency key');
  });

  it('CHK-009 two shoppers cannot both reserve the last unit of a unique piece', async () => {
    const p = await h.createProduct(owner, { stock: 1, priceCents: 1250000, name: 'One of a kind emerald' });
    const a = server.client(), b = server.client();
    const [ra, rb] = await Promise.all([checkout(a, [{ id: p.id, quantity: 1 }]), checkout(b, [{ id: p.id, quantity: 1 }])]);
    assert.deepEqual([ra.status, rb.status].sort(), [200, 409]);
  });

  it('CHK-010 a different client cannot hijack another checkout request ID', async () => {
    const p = await h.createProduct(owner, { stock: 5, priceCents: 5000 });
    const body = h.guestCheckout([{ id: p.id, quantity: 1 }]);
    const guest = await server.client().post('/api/checkout', body);
    assert.equal(guest.status, 200);
    const member = await h.registerAndSignIn(server);
    const replay = await member.post('/api/checkout', body);
    assert.equal(replay.status, 409);
  });

  it('CHK-011 a signed-in client’s order is linked to their account and uses their verified email', async () => {
    const p = await h.createProduct(owner, { stock: 5, priceCents: 9000 });
    const member = await h.registerAndSignIn(server);
    const r = await member.post('/api/checkout', h.guestCheckout([{ id: p.id, quantity: 1 }], { email: 'someone-else@example.com', saveAddress: true }));
    assert.equal(r.status, 200, r.text);
    const order = await h.findOrder(owner, r.data.reference);
    assert.equal(order.customer.email, member.email);
    assert.notEqual(order.customerId, null);
    const account = await member.get('/api/account');
    assert.ok(account.data.orders.some(o => o.reference === r.data.reference));
    assert.equal(account.data.deliveryAddress.postalCode, 'SW1A 1AA');
  });

  it('CHK-012 a payment-provider failure is reported politely and does not hold stock', async () => {
    const p = await h.createProduct(owner, { stock: 1, priceCents: 30000 });
    server.setMock({ stripe: 'fail' });
    const failed = await checkout(shopper, [{ id: p.id, quantity: 1 }]);
    server.setMock({});
    assert.equal(failed.status, 502);
    assert.equal(failed.data.error, 'Something went wrong. Please try again.');
    const retry = await checkout(shopper, [{ id: p.id, quantity: 1 }]);
    assert.equal(retry.status, 200, 'stock is not held by a failed attempt');
  });

  it('CHK-013 a provider timeout fails safely', async () => {
    const p = await h.createProduct(owner, { stock: 1, priceCents: 30000 });
    server.setMock({ stripe: 'timeout' });
    const r = await checkout(shopper, [{ id: p.id, quantity: 1 }]);
    server.setMock({});
    assert.ok(r.status >= 500);
    assert.ok(!/TimeoutError|mock/.test(r.text), 'internal error details must not leak');
  });

  it('CHK-014 the configured delivery fee is added by the server and cannot be removed by the client', async () => {
    const settings = (await owner.get('/api/admin/data')).data.settings;
    assert.equal((await owner.put('/api/admin/settings', { ...settings, shippingCents: 1500 })).status, 200);
    const p = await h.createProduct(owner, { stock: 2, priceCents: 20000 });
    const before = stripeCalls().length;
    const r = await checkout(shopper, [{ id: p.id, quantity: 1 }], { shippingCents: 0 });
    assert.equal(r.status, 200);
    const order = await h.findOrder(owner, r.data.reference);
    assert.equal(order.shippingCents, 1500);
    assert.equal(order.totalCents, 21500);
    const call = stripeCalls().slice(before).pop();
    assert.equal(call.params['line_items[1][price_data][unit_amount]'], '1500');
    await owner.put('/api/admin/settings', { ...settings, shippingCents: settings.shippingCents });
  });

  it('CHK-015 items in different currencies cannot share one bag', async () => {
    const gbp = await h.createProduct(owner, { stock: 2, priceCents: 1000, currency: 'GBP' });
    const eur = await h.createProduct(owner, { stock: 2, priceCents: 1000, currency: 'EUR' });
    const r = await checkout(shopper, [{ id: gbp.id, quantity: 1 }, { id: eur.id, quantity: 1 }]);
    assert.equal(r.status, 400);
  });

  // ---- Webhooks --------------------------------------------------------------------
  async function pendingOrder(price = 40000, stock = 3) {
    const p = await h.createProduct(owner, { stock, priceCents: price });
    const r = await checkout(server.client(), [{ id: p.id, quantity: 1 }]);
    assert.equal(r.status, 200, r.text);
    const order = await h.findOrder(owner, r.data.reference);
    return { product: p, order };
  }
  const stockOf = async id => (await owner.get('/api/admin/data')).data.products.find(p => p.id === id).stock;

  it('PAY-001 webhooks without a valid, recent Stripe signature are rejected', async () => {
    const { order } = await pendingOrder();
    const event = h.completedEvent(order, order.stripeSessionId);
    const noSig = await shopper.request('POST', '/api/stripe-webhook', { body: JSON.stringify(event), headers: { 'content-type': 'application/json', origin: null } });
    assert.equal(noSig.status, 400);
    assert.equal((await h.sendWebhook(shopper, event, { secret: 'whsec_wrong' })).status, 400);
    assert.equal((await h.sendWebhook(shopper, event, { timestamp: Math.floor(Date.now() / 1000) - 3600 })).status, 400, 'old signatures (replays) are refused');
    assert.equal((await h.sendWebhook(shopper, event, { header: 't=abc,v1=' + 'a'.repeat(64) })).status, 400);
    assert.equal((await h.findOrder(owner, order.reference)).status, 'payment_pending');
  });

  it('PAY-002 a verified payment marks the order paid, reduces stock once and emails the client', async () => {
    const { product, order } = await pendingOrder(123456, 3);
    const event = h.completedEvent(order, order.stripeSessionId);
    const r = await h.sendWebhook(shopper, event);
    assert.equal(r.status, 200);
    const paid = await h.findOrder(owner, order.reference);
    assert.equal(paid.status, 'paid');
    assert.ok(paid.paidAt);
    assert.equal(await stockOf(product.id), 2);
    const email = h.lastEmailTo(server, order.customer.email);
    assert.ok(email, 'confirmation email sent');
    assert.ok(email.subject.includes(order.reference));
    assert.ok(email.text.includes('£1,234.56'), 'email shows the exact total');
    assert.ok(!email.html.includes('<script'), 'no unescaped markup');
  });

  it('PAY-003 replayed and duplicate webhook deliveries do not double-count', async () => {
    const { product, order } = await pendingOrder(5000, 5);
    const event = h.completedEvent(order, order.stripeSessionId);
    await h.sendWebhook(shopper, event);
    await h.sendWebhook(shopper, event);
    await h.sendWebhook(shopper, { ...event, id: 'evt_duplicate_' + crypto.randomBytes(4).toString('hex') });
    assert.equal(await stockOf(product.id), 4);
    const emails = server.outbox().filter(e => e.provider === 'resend' && e.subject.includes(order.reference));
    assert.equal(emails.length, 1);
  });

  it('PAY-004 a payment for the wrong amount or currency is not accepted', async () => {
    const { order } = await pendingOrder(80000);
    const short = await h.sendWebhook(shopper, h.completedEvent(order, order.stripeSessionId, { amount_total: 100 }));
    assert.equal(short.status, 400);
    const usd = await h.sendWebhook(shopper, h.completedEvent(order, order.stripeSessionId, { currency: 'usd' }));
    assert.equal(usd.status, 400);
    assert.equal((await h.findOrder(owner, order.reference)).status, 'payment_pending');
  });

  it('PAY-005 events that do not match the order (metadata, reference, unpaid) change nothing', async () => {
    const { order } = await pendingOrder();
    await h.sendWebhook(shopper, h.completedEvent(order, order.stripeSessionId, { metadata: { orderId: 'other' } }));
    await h.sendWebhook(shopper, h.completedEvent(order, order.stripeSessionId, { client_reference_id: 'BC-OTHER' }));
    await h.sendWebhook(shopper, h.completedEvent(order, order.stripeSessionId, { payment_status: 'unpaid' }));
    await h.sendWebhook(shopper, h.completedEvent(order, 'cs_test_unknown'));
    assert.equal((await h.findOrder(owner, order.reference)).status, 'payment_pending');
  });

  it('PAY-006 an expired or failed payment session cancels the order and releases the piece', async () => {
    const { product, order } = await pendingOrder(60000, 1);
    const blocked = await checkout(server.client(), [{ id: product.id, quantity: 1 }]);
    assert.equal(blocked.status, 409, 'the piece is held while payment is pending');
    const expired = { id: 'evt_exp_' + crypto.randomBytes(4).toString('hex'), type: 'checkout.session.expired', data: { object: { id: order.stripeSessionId, metadata: { orderId: order.id }, client_reference_id: order.reference } } };
    assert.equal((await h.sendWebhook(shopper, expired)).status, 200);
    assert.equal((await h.findOrder(owner, order.reference)).status, 'cancelled');
    const again = await checkout(server.client(), [{ id: product.id, quantity: 1 }]);
    assert.equal(again.status, 200, 'released piece can be bought again');
  });

  it('PAY-007 if the confirmation email fails, Stripe is asked to retry and the email is sent once later', async () => {
    const { product, order } = await pendingOrder(15000, 2);
    const event = h.completedEvent(order, order.stripeSessionId);
    server.setMock({ resend: 'fail' });
    const first = await h.sendWebhook(shopper, event);
    server.setMock({});
    assert.equal(first.status, 500, 'non-2xx makes Stripe retry');
    assert.equal((await h.findOrder(owner, order.reference)).status, 'paid', 'payment is recorded even if email fails');
    const retry = await h.sendWebhook(shopper, event);
    assert.equal(retry.status, 200);
    assert.equal(await stockOf(product.id), 1, 'stock reduced exactly once');
    const sent = server.outbox().filter(e => e.provider === 'resend' && e.mode === 'ok' && e.subject.includes(order.reference));
    assert.equal(sent.length, 1);
  });

  it('PAY-008 a payment that arrives after the order was cancelled is flagged, not silently lost', async () => {
    const { order } = await pendingOrder(25000, 2);
    const cancel = await owner.put(`/api/admin/orders/${order.id}`, { status: 'cancelled' });
    assert.equal(cancel.status, 200);
    await h.sendWebhook(shopper, h.completedEvent(order, order.stripeSessionId));
    const after = await h.findOrder(owner, order.reference);
    assert.ok(after.paidAt, 'payment recorded');
    assert.notEqual(after.status, 'cancelled', 'a paid order must not stay marked as cancelled');
    assert.equal(after.status, 'paid');
    assert.equal(after.paidAfterCancellation, true, 'flagged for staff to check stock, then ship or refund');
  });

  it('PAY-009 staff cannot cancel an order while the client may be paying for it', async () => {
    const { order } = await pendingOrder(26000, 2);
    server.setMock({ expire: 'completed' });
    const r = await owner.put(`/api/admin/orders/${order.id}`, { status: 'cancelled' });
    server.setMock({});
    assert.equal(r.status, 409);
    assert.equal((await h.findOrder(owner, order.reference)).status, 'payment_pending');
    const expireCalls = server.outbox().filter(e => e.provider === 'stripe' && e.url.endsWith(`${order.stripeSessionId}/expire`));
    assert.equal(expireCalls.length, 1, 'the Stripe session was asked to close first');
  });

  it('PAY-010 an unpaid checkout holds the piece for 45 minutes, not 24 hours', async () => {
    const p = await h.createProduct(owner, { stock: 1, priceCents: 880000 });
    const buyer = server.client();
    const body = h.guestCheckout([{ id: p.id, quantity: 1 }]);
    const before = stripeCalls().length;
    const started = Date.now();
    const r = await buyer.post('/api/checkout', body);
    assert.equal(r.status, 200);
    const sent = Number(stripeCalls().slice(before).pop().params.expires_at) * 1000;
    assert.ok(sent - started >= 44 * 60 * 1000 && sent - started <= 46 * 60 * 1000, `expires_at is ${Math.round((sent - started) / 60000)} minutes ahead`);
    const retry = await buyer.post('/api/checkout', body);
    assert.equal(Number(stripeCalls().pop().params.expires_at) * 1000, sent, 'a retried request sends the same expiry (idempotent)');
    assert.equal(retry.data.reference, r.data.reference);
    const order = await h.findOrder(owner, r.data.reference);
    assert.equal(Math.floor(order.holdUntil / 1000) * 1000, sent, 'Stripe expiry matches the stock hold (to the second)');
  });

  // ---- Order lookup ------------------------------------------------------------------
  it('SEC-RL-001 checkout attempts from one client are rate limited', async () => {
    const p = await h.createProduct(owner, { stock: 100, priceCents: 100 });
    const bot = server.client();
    const statuses = [];
    for (let i = 0; i < 12; i++) statuses.push((await bot.post('/api/checkout', h.guestCheckout([{ id: p.id, quantity: 1 }]))).status);
    assert.ok(statuses.includes(429), statuses.join(','));
    assert.equal(statuses.filter(s => s === 200).length, 10);
  });

  it('ORD-001 the public order page shows status and items but no personal details', async () => {
    const { order } = await pendingOrder();
    const r = await shopper.get(`/api/order?ref=${order.reference}`);
    assert.equal(r.status, 200);
    assert.equal(r.data.status, 'payment_pending');
    for (const field of ['customer', 'customerId', 'stripeSessionId', 'checkoutRequestId', 'email']) assert.ok(!(field in r.data), `exposes ${field}`);
    assert.ok(!r.text.includes(order.customer.email));
    assert.equal((await shopper.get('/api/order?ref=BC-0000000000')).status, 404);
    assert.equal((await shopper.get(`/api/order?ref=${order.reference.toLowerCase()}`)).status, 200);
  });

  it('ORD-002 guessing order references is rate limited', async () => {
    const guesser = server.client();
    let limited = false;
    for (let i = 0; i < 40 && !limited; i++) limited = (await guesser.get(`/api/order?ref=BC-${crypto.randomBytes(5).toString('hex').toUpperCase()}`)).status === 429;
    assert.ok(limited, 'expected HTTP 429 within 40 guesses');
  });
});
