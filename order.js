// The order reference in the URL is a lookup key, not proof of payment.
(() => {
  const root = document.querySelector('#order-confirmation');
  const params = new URLSearchParams(location.search);
  const reference = params.get('ref');

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
  const formatMoney = (cents, currency) => new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency
  }).format(cents / 100);

  if (!reference) {
    root.innerHTML = '<p class="eyebrow">ORDER UPDATE</p><h1>No order reference found.</h1><p>Visit the shop to browse the collection.</p><a class="button primary" href="shop.html">Return to the shop</a>';
    return;
  }

  // Ask the server for the latest order state; redirects alone never confirm payment.
  fetch(`/api/order?ref=${encodeURIComponent(reference)}`)
    .then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      return data;
    })
    .then(order => {
      if (order.paymentMode === 'preview') {
        root.innerHTML = '<p class="eyebrow">ORDER UPDATE</p><h1>Order not completed.</h1><p>Please contact our team to arrange your purchase.</p><p class="order-ref">' + escapeHtml(order.reference) + '</p><a class="button primary" href="contact.html">Contact our team</a>';
        return;
      }

      const status = order.status === 'paid'
        ? 'Payment confirmed'
        : order.status === 'payment_pending'
          ? 'Payment received; confirming order status'
          : order.status.replace('_', ' ');
      const items = order.items.map(item => `
        <div class="summary-line">
          <span>${escapeHtml(item.name)} × ${item.quantity}</span>
          <strong>${formatMoney(item.priceCents * item.quantity, item.currency)}</strong>
        </div>`).join('');
      const vatRow = order.taxCents > 0 ? `
        <div class="summary-line"><span>VAT included</span>
          <strong>${formatMoney(order.taxCents, order.currency)}</strong>
        </div>` : '';

      root.innerHTML = `
        <p class="eyebrow">BIREQDAR&amp;CO. · ORDER UPDATE</p>
        <h1>Thank you for your order.</h1>
        <p>Your order is being processed. We will follow up using the email supplied at checkout.</p>
        <p class="order-ref">${escapeHtml(order.reference)}</p>
        <div class="order-items">${items}${vatRow}
          <div class="summary-line total"><span>${status}</span>
            <strong>${formatMoney(order.totalCents, order.currency)}</strong>
          </div>
        </div>
        <p class="order-note">Keep this reference for your records. For an update, contact BIREQDAR&amp;CO. and include the reference above.</p>
        <a class="button primary" href="shop.html">Continue exploring</a>`;
    })
    .catch(error => {
      root.innerHTML = `<h1>We could not find this order.</h1><p>${escapeHtml(error.message)}</p><a class="button primary" href="shop.html">Return to the shop</a>`;
    });
})();
