// Show the current payment and delivery progress for an order reference.
(() => {
  const root = document.querySelector('#order-confirmation');
  const reference = new URLSearchParams(location.search).get('ref');
  let refreshing = false;

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
  const formatMoney = (cents, currency) => new Intl.NumberFormat(undefined, {
    style: 'currency', currency
  }).format(cents / 100);
  const labelFor = status => ({
    payment_pending: 'Awaiting payment', paid: 'Confirmed', processing: 'Preparing',
    shipped: 'Shipped', delivered: 'Delivered', fulfilled: 'Completed', cancelled: 'Cancelled'
  })[status] || 'Being updated';

  function progressMarkup(order) {
    if (order.status === 'cancelled') return '<p class="order-status-callout">This order was cancelled. Please contact our team if you need help.</p>';
    const stages = [
      { key: 'paid', label: 'Confirmed' }, { key: 'processing', label: 'Preparing' },
      { key: 'shipped', label: 'Shipped' }, { key: order.status === 'fulfilled' ? 'fulfilled' : 'delivered', label: order.status === 'fulfilled' ? 'Completed' : 'Delivered' }
    ];
    const active = ({ paid: 0, processing: 1, shipped: 2, delivered: 3, fulfilled: 3 })[order.status] ?? -1;
    const history = Array.isArray(order.statusHistory) ? order.statusHistory : [];
    const items = stages.map((stage, index) => {
      const state = index < active ? 'complete' : index === active ? 'current' : 'upcoming';
      const eventStatus = stage.key === 'paid' ? 'paid' : stage.key;
      const event = history.find(entry => entry.status === eventStatus);
      const time = event?.at ? `<small>${escapeHtml(new Date(event.at).toLocaleDateString())}</small>` : '';
      return `<li class="order-progress-${state}" ${state === 'current' ? 'aria-current="step"' : ''}><span class="order-progress-mark" aria-hidden="true">${index < active ? '✓' : index + 1}</span><span>${stage.label}${time}</span></li>`;
    }).join('');
    const pending = order.status === 'payment_pending'
      ? '<p class="order-status-callout">We are waiting for Stripe to confirm your payment. This page checks for updates automatically.</p>' : '';
    return `${pending}<ol class="order-progress" aria-label="Order progress">${items}</ol>`;
  }

  if (!reference) {
    root.innerHTML = '<p class="eyebrow">ORDER UPDATE</p><h1>No order reference found.</h1><p>Visit the shop to browse the collection.</p><a class="button primary" href="shop.html">Return to the shop</a>';
    return;
  }

  async function refreshOrder() {
    if (refreshing) return;
    refreshing = true;
    try {
      const response = await fetch(`/api/order?ref=${encodeURIComponent(reference)}`, { cache: 'no-store' });
      const order = await response.json();
      if (!response.ok) throw new Error(order.error || 'Could not retrieve this order.');
      if (order.paymentMode === 'preview') {
        clearInterval(pollTimer);
        root.innerHTML = '<p class="eyebrow">ORDER UPDATE</p><h1>Order not completed.</h1><p>Please contact our team to arrange your purchase.</p><p class="order-ref">' + escapeHtml(order.reference) + '</p><a class="button primary" href="contact.html">Contact our team</a>';
        return;
      }
      const items = order.items.map(item => `<div class="summary-line"><span>${escapeHtml(item.name)} × ${item.quantity}</span><strong>${formatMoney(item.priceCents * item.quantity, item.currency)}</strong></div>`).join('');
      const vatRow = order.taxCents > 0 ? `<div class="summary-line"><span>VAT included</span><strong>${formatMoney(order.taxCents, order.currency)}</strong></div>` : '';
      const message = order.status === 'delivered' || order.status === 'fulfilled'
        ? 'Your order is complete. Thank you for choosing BIREQDAR & CO.'
        : order.status === 'cancelled' ? 'Please contact our team if you need help with this order.'
          : 'We will keep you updated using the email supplied at checkout.';
      root.innerHTML = `
        <p class="eyebrow">BIREQDAR&amp;CO. · ORDER UPDATE</p>
        <h1>${order.status === 'cancelled' ? 'Order update.' : 'Thank you for your order.'}</h1>
        <p>${message}</p>
        <p class="order-ref">${escapeHtml(order.reference)}</p>
        ${progressMarkup(order)}
        <div class="order-items">${items}${vatRow}<div class="summary-line total"><span>${labelFor(order.status)}</span><strong>${formatMoney(order.totalCents, order.currency)}</strong></div></div>
        <p class="order-note">Keep this reference for your records. For help, contact BIREQDAR&amp;CO. and include the reference above.</p>
        <div class="order-page-actions"><button class="button order-refresh-button" type="button" data-refresh-order>Refresh status</button><a class="button primary" href="shop.html">Continue exploring</a></div>
        <p class="order-last-updated" aria-live="polite">Status checked ${escapeHtml(new Date().toLocaleTimeString())}</p>`;
      root.querySelector('[data-refresh-order]')?.addEventListener('click', refreshOrder);
      if (['delivered', 'fulfilled', 'cancelled'].includes(order.status)) clearInterval(pollTimer);
    } catch (error) {
      root.innerHTML = `<h1>We could not find this order.</h1><p>${escapeHtml(error.message)}</p><button class="button order-refresh-button" type="button" data-refresh-order>Try again</button><a class="button primary" href="shop.html">Return to the shop</a>`;
      root.querySelector('[data-refresh-order]')?.addEventListener('click', refreshOrder);
    } finally {
      refreshing = false;
    }
  }

  refreshOrder();
  const pollTimer = setInterval(refreshOrder, 30000);
})();
