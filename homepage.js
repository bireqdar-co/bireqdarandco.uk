// Homepage behaviour: scroll-linked scenes, chapter index and the
// "Selected pieces" carousel from /api/catalog. Header and enquiry button: site-shell.js.
(() => {
  const root = document.documentElement;
  const scenes = [...document.querySelectorAll('[data-scene]')];
  const heroIntro = document.querySelector('.cine-hero-intro');
  const indexNav = document.querySelector('.chapter-index');
  const indexLinks = [...document.querySelectorAll('.chapter-index a')];
  const indexTargets = indexLinks.map(link => document.querySelector(link.getAttribute('href')));
  const footer = document.querySelector('.site-footer');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const compact = window.matchMedia('(max-width: 980px)');
  const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

  let motion = !reducedMotion.matches;
  let frame = 0;

  const applyMotionPreference = () => {
    motion = !reducedMotion.matches;
    root.classList.toggle('motion-ok', motion);
    if (!motion) scenes.forEach(scene => { scene.style.removeProperty('--p'); scene.style.removeProperty('--enter'); });
    schedule();
  };

  // Each scene reports how far it has arrived (--enter) and how far through it we are (--p).
  const updateScenes = vh => {
    if (!motion) return;
    const arrival = compact.matches ? vh * .78 : vh;
    scenes.forEach(scene => {
      const rect = scene.getBoundingClientRect();
      if (rect.bottom < -vh || rect.top > vh * 2) return;
      const travel = Math.max(1, rect.height - vh);
      const p = clamp(-rect.top / travel);
      const enter = clamp((vh - rect.top) / arrival);
      scene.style.setProperty('--p', p.toFixed(4));
      scene.style.setProperty('--enter', enter.toFixed(4));
      if (scene.id === 'home' && heroIntro) heroIntro.classList.toggle('is-live', p > .42);
    });
  };

  const updateIndex = vh => {
    if (!indexLinks.length) return;
    let active = 0;
    indexTargets.forEach((target, i) => {
      if (target && target.getBoundingClientRect().top <= vh * .5) active = i;
    });
    indexLinks.forEach((link, i) => {
      if (i === active) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
    const current = indexTargets[active];
    indexNav?.classList.toggle('on-light', !!current?.matches('.shop-by, .pieces'));
    indexNav?.classList.toggle('is-quiet', !!footer && footer.getBoundingClientRect().top < vh * .7);
  };

  const update = () => {
    frame = 0;
    const vh = window.innerHeight;
    updateScenes(vh);
    updateIndex(vh);
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };

  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule, { passive: true });
  reducedMotion.addEventListener?.('change', applyMotionPreference);
  compact.addEventListener?.('change', schedule);

  // Soft entrance for the lighter browsing sections.
  const risers = [...document.querySelectorAll('.shop-by-head, .shop-by-grid > li, .pieces-head, .cine-close-head, .cine-close-routes > li')];
  risers.forEach((el, i) => { el.setAttribute('data-rise', ''); el.style.transitionDelay = `${(i % 5) * 70}ms`; });
  if ('IntersectionObserver' in window) {
    const riseObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) { entry.target.classList.add('is-in'); riseObserver.unobserve(entry.target); }
      });
    }, { threshold: .15, rootMargin: '0px 0px -40px 0px' });
    risers.forEach(el => riseObserver.observe(el));
  } else {
    risers.forEach(el => el.classList.add('is-in'));
  }

  applyMotionPreference();

  // ---------- Selected pieces (public catalogue) ----------
  const track = document.querySelector('.pieces-track');
  const arrows = document.querySelector('.pieces-arrows');
  const progress = document.querySelector('.pieces-progress');
  const progressBar = progress?.querySelector('span');
  const fallback = document.querySelector('.pieces-fallback');
  const money = (cents, currency = 'GBP') => cents == null
    ? 'Price on enquiry'
    : new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100);
  const categoryNames = { necklaces: 'Necklaces', pendants: 'Pendants', earrings: 'Earrings', bracelets: 'Bracelets', rings: 'Rings' };

  const choosePieces = (products, limit = 10) => {
    const seen = new Set();
    const usable = products
      .filter(p => p && p.slug && p.image)
      .sort((a, b) => Number(!!a.isDemo) - Number(!!b.isDemo))
      .filter(p => (seen.has(p.image) ? false : seen.add(p.image)));
    // Interleave types so jewellery, watches and bullion each appear early.
    const groups = new Map();
    usable.forEach(p => { if (!groups.has(p.type)) groups.set(p.type, []); groups.get(p.type).push(p); });
    const order = [];
    while (order.length < limit && [...groups.values()].some(list => list.length)) {
      groups.forEach(list => { if (list.length && order.length < limit) order.push(list.shift()); });
    }
    return order;
  };

  const buildCard = (product, collections) => {
    const collection = collections.find(c => c.id === product.collectionId);
    const li = document.createElement('li');
    li.className = 'piece-card';
    const link = document.createElement('a');
    link.href = `product.html?slug=${encodeURIComponent(product.slug)}`;
    const media = document.createElement('span');
    media.className = 'piece-media';
    const img = document.createElement('img');
    img.src = product.image;
    img.alt = product.name;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.addEventListener('error', () => media.classList.add('is-missing'), { once: true });
    media.append(img);
    const kicker = document.createElement('span');
    kicker.className = 'piece-kicker';
    kicker.textContent = [collection?.name || product.type, categoryNames[product.category]].filter(Boolean).join(' · ');
    const name = document.createElement('span');
    name.className = 'piece-name';
    name.textContent = product.name;
    const price = document.createElement('span');
    price.className = 'piece-price';
    price.textContent = product.inquiryOnly && product.priceCents == null ? 'Price on enquiry' : money(product.priceCents, product.currency);
    link.append(media, kicker, name, price);
    li.append(link);
    return li;
  };

  const updateCarousel = () => {
    if (!track) return;
    const max = track.scrollWidth - track.clientWidth;
    const overflow = max > 4;
    if (arrows) arrows.hidden = !overflow;
    if (progress) progress.hidden = !overflow;
    if (!overflow) return;
    const [prev, next] = arrows.querySelectorAll('button');
    prev.disabled = track.scrollLeft <= 4;
    next.disabled = track.scrollLeft >= max - 4;
    if (progressBar) progressBar.style.transform = `scaleX(${clamp(track.clientWidth / track.scrollWidth + (track.scrollLeft / max) * (1 - track.clientWidth / track.scrollWidth), .08, 1)})`;
  };

  const stepCarousel = direction => {
    const card = track.querySelector('.piece-card');
    const gap = parseFloat(getComputedStyle(track).columnGap) || 16;
    const cardStep = card ? card.getBoundingClientRect().width + gap : 0;
    const step = cardStep ? cardStep * Math.max(1, Math.floor(track.clientWidth / cardStep)) : track.clientWidth * .8;
    track.scrollBy({ left: direction * step, behavior: reducedMotion.matches ? 'auto' : 'smooth' });
  };

  if (track) {
    arrows?.querySelectorAll('button').forEach(button => {
      button.addEventListener('click', () => stepCarousel(Number(button.dataset.direction)));
    });
    track.addEventListener('scroll', () => requestAnimationFrame(updateCarousel), { passive: true });
    window.addEventListener('resize', updateCarousel, { passive: true });

    fetch('/api/catalog', { headers: { Accept: 'application/json' } })
      .then(response => { if (!response.ok) throw new Error(`Catalogue unavailable (${response.status})`); return response.json(); })
      .then(data => {
        const pieces = choosePieces(Array.isArray(data.products) ? data.products : []);
        const collections = Array.isArray(data.collections) ? data.collections : [];
        if (!pieces.length) throw new Error('No published pieces');
        track.replaceChildren(...pieces.map(product => buildCard(product, collections)));
        track.setAttribute('aria-busy', 'false');
        updateCarousel();
      })
      .catch(() => {
        track.replaceChildren();
        track.hidden = true;
        track.setAttribute('aria-busy', 'false');
        if (fallback) fallback.hidden = false;
      });
  }
})();
