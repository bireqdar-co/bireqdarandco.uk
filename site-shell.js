// Shared page shell for every storefront page: header state (solid / tucked away
// while scrolling down), the floating enquiry button and the bag-count badge.
// Loaded after script.js, which owns the mobile menu and the bag count itself.
(() => {
  const header = document.querySelector('.cine-header');
  const dock = document.querySelector('.enquire-dock');
  const compact = window.matchMedia('(max-width: 980px)');
  let lastY = window.scrollY;
  let frame = 0;

  // Mirror the bag count into an attribute so an empty bag shows no badge.
  const baseUpdateBagCount = window.updateBagCount;
  if (typeof baseUpdateBagCount === 'function') {
    window.updateBagCount = (...args) => {
      baseUpdateBagCount(...args);
      const count = document.querySelector('#cart-count');
      count?.closest('.bag-link')?.setAttribute('data-count', (count.textContent || '0').trim());
    };
    window.updateBagCount();
  }

  const update = () => {
    frame = 0;
    const y = window.scrollY;
    const vh = window.innerHeight;
    const delta = y - lastY;

    if (header) {
      const keepVisible = compact.matches
        || document.body.classList.contains('menu-open')
        || header.contains(document.activeElement)
        || y < vh * .6;
      header.classList.toggle('is-solid', y > 40);
      if (keepVisible) header.classList.remove('is-hidden');
      else if (delta > 6) header.classList.add('is-hidden');
      else if (delta < -6) header.classList.remove('is-hidden');
    }

    if (dock) {
      // Stay out of the way wherever the page already offers an enquiry route.
      const zoneInView = [...document.querySelectorAll('[data-dock-hide], .site-footer')].some(zone => {
        const rect = zone.getBoundingClientRect();
        return rect.top < vh * .85 && rect.bottom > vh * .15;
      });
      const headerAway = !header || header.classList.contains('is-hidden');
      const show = y > vh * .9 && !zoneInView && (compact.matches || headerAway);
      dock.classList.toggle('is-visible', show);
      dock.tabIndex = show ? 0 : -1;
      dock.setAttribute('aria-hidden', String(!show));
    }

    if (tocLinks.length) updateToc();
    lastY = y;
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };

  // Shop: mark the quick link that matches the current collection.
  const quick = [...document.querySelectorAll('.shop-quicklinks a[data-quick]')];
  if (quick.length) {
    const params = new URLSearchParams(location.search);
    const key = params.get('collection') || params.get('type') || 'all';
    const match = quick.find(link => link.dataset.quick === key) || (key === 'all' ? quick[0] : null);
    match?.setAttribute('aria-current', 'page');
  }

  // Long-form pages: highlight the section being read in the contents list.
  const tocLinks = [...document.querySelectorAll('.legal-toc a[href^="#"]')];
  const tocTargets = tocLinks.map(link => document.querySelector(link.getAttribute('href')));
  const updateToc = () => {
    let active = -1;
    tocTargets.forEach((target, i) => { if (target && target.getBoundingClientRect().top < window.innerHeight * .35) active = i; });
    tocLinks.forEach((link, i) => {
      if (i === active) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  };

  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule, { passive: true });
  compact.addEventListener?.('change', schedule);
  header?.addEventListener('focusin', () => header.classList.remove('is-hidden'));
  update();
})();
