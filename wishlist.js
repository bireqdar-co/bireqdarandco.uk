// Keep wishlist actions account-backed so saved pieces follow customers across devices.
(() => {
  const ids = new Set();
  const buttons = scope => {
    if (scope?.matches?.('[data-wishlist-toggle]')) sync(scope);
    scope?.querySelectorAll?.('[data-wishlist-toggle]').forEach(sync);
  };
  function sync(button) {
    const saved = ids.has(button.dataset.wishlistToggle);
    button.setAttribute('aria-pressed', String(saved));
    button.setAttribute('aria-label', saved ? 'Remove from wishlist' : 'Save to wishlist');
    button.title = saved ? 'Remove from wishlist' : 'Save to wishlist';
    button.classList.toggle('is-saved', saved);
  }
  async function account() {
    const response = await fetch('/api/account', { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not check your account. Please try again.');
    return response.json();
  }
  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-wishlist-toggle]');
    if (!button || button.disabled) return;
    const productId = button.dataset.wishlistToggle;
    button.disabled = true;
    try {
      let current = await account();
      if (!current.authenticated) {
        const returnPath = `${location.pathname}${location.search}${location.hash}`;
        location.assign(`account.html?return=${encodeURIComponent(returnPath)}&wishlist=${encodeURIComponent(productId)}`);
        return;
      }
      const action = ids.has(productId) ? 'remove' : 'add';
      const response = await fetch('/api/account/wishlist', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, action })
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 401) {
          const returnPath = `${location.pathname}${location.search}${location.hash}`;
          location.assign(`account.html?return=${encodeURIComponent(returnPath)}&wishlist=${encodeURIComponent(productId)}`);
          return;
        }
        throw new Error(result.error || 'Could not update your wishlist.');
      }
      if (action === 'add') ids.add(productId); else ids.delete(productId);
      sync(button);
    } catch (error) {
      button.title = error.message;
      button.setAttribute('aria-label', error.message);
    } finally {
      button.disabled = false;
    }
  });
  fetch('/api/account', { cache: 'no-store' }).then(response => response.json()).then(data => {
    if (data.authenticated) for (const product of data.wishlist || []) ids.add(product.id);
    buttons(document);
  }).catch(() => {});
  new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
    if (node.nodeType === Node.ELEMENT_NODE) buttons(node);
  }))).observe(document.documentElement, { childList: true, subtree: true });
})();
