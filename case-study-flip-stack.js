// Reusable, scroll-pinned editorial card stack for the existing no-build storefront.
(() => {
  const root = document.querySelector('[data-case-study-flip-stack]');
  if (!root) return;

  const items = [
    {
      eyebrow: 'FINE JEWELLERY · SILVER',
      title: 'A bright line, designed to move.',
      description: 'A 3 mm tennis chain in 925 sterling silver, set with 12.5 ct of cubic zirconia. Eighteen inches long (45.72 cm), made to sit beautifully on its own or layered.',
      image: '/assets/catalogue/tennis-chain-hero.jpg',
      imageAlt: 'Silver tennis chain styled against deep emerald green',
      background: '#062318', foreground: '#f3eddf',
      href: 'product.html?slug=tennis-chain-3mm-925-silver', linkLabel: 'Discover the tennis chain'
    },
    {
      eyebrow: 'NATURAL & LAB-GROWN',
      title: 'A little more light.',
      description: 'Explore natural and lab-grown diamond designs. Ask our team about grading, origin and the details that make each stone distinctive.',
      image: '/assets/catalogue/pear-diamond-pendant-concept.jpg',
      imageAlt: 'A pear-shaped diamond pendant design study',
      background: '#e8dfcc', foreground: '#263e30',
      href: 'shop.html?collection=gemstones', linkLabel: 'Explore diamonds'
    },
    {
      eyebrow: 'PRECIOUS METALS',
      title: 'Value with a lasting form.',
      description: 'Discover gold and silver bullion. Contact us for item-specific weight, purity, availability and pricing.',
      image: '/assets/catalogue/bullion-still-life-concept.jpg',
      imageAlt: 'Gold and silver bullion still life',
      background: '#173c2d', foreground: '#f3eddf',
      href: 'shop.html?collection=bullion', linkLabel: 'Discover our bullions'
    },
    {
      eyebrow: 'TIMEPIECES · BESPOKE',
      title: 'Chosen for your own story.',
      description: 'Explore selected watches or begin a bespoke commission shaped around your ideas, materials and occasion.',
      image: '/watch-collection-concept.png',
      imageAlt: 'Emerald-toned timepiece design presentation',
      background: '#381b26', foreground: '#f3eddf',
      href: 'shop.html?type=watch', linkLabel: 'Explore watches',
      secondaryHref: 'bespoke.html', secondaryLabel: 'Start a commission'
    },
    {
      eyebrow: 'A WATCH TO REMEMBER',
      title: 'The Emerald Monolith.',
      description: 'Sculptural lines and a deep emerald dial bring quiet presence to the collection.',
      details: ['Design language · Sculptural minimalism', 'Dial study · Faceted emerald green'],
      image: '/watch-collection-concept.png',
      imageAlt: 'Three timepieces arranged on dark sculptural plinths',
      background: '#e8dfcc', foreground: '#263e30',
      href: 'shop.html?type=watch', linkLabel: 'Explore our watch collection'
    },
    {
      id: 'story',
      eyebrow: 'A DIFFERENT WAY TO MARK TIME',
      title: 'Geometry with a softer edge.',
      description: 'BIREQDAR&CO. brings together personal adornment and thoughtful design. Explore diamond jewellery, watches and bespoke pieces, with each product described using verified details.',
      details: ['Considered form · Architectural lines, softened for everyday wear', 'Light, held · An emerald study that changes with the light', 'Time to imagine · Jewellery, precious metals, bespoke pieces and watches'],
      image: '/assets/catalogue/emerald-line-pendant.jpg',
      imageAlt: 'Emerald jewellery detail from the collection',
      background: '#173c2d', foreground: '#f3eddf',
      href: 'shop.html', linkLabel: 'Discover the collection',
      secondaryHref: 'contact.html', secondaryLabel: 'Start a conversation'
    },
    {
      eyebrow: 'LET’S BEGIN A CONVERSATION',
      title: 'Curious about BIREQDAR&CO.?',
      description: 'Tell us what caught your eye and our team will respond personally. For availability, sourcing or a private appointment, we are here to help.',
      image: '/logo-monogram.png',
      imageAlt: 'BIREQDAR&CO. crowned monogram',
      background: '#062318', foreground: '#f3eddf',
      href: 'contact.html', linkLabel: 'Make an enquiry',
      secondaryHref: 'privacy.html', secondaryLabel: 'Privacy notes'
    }
  ];
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

  root.innerHTML = `
    <section class="flip-stack-section" aria-labelledby="flip-stack-heading">
      <header class="flip-stack-intro">
        <div><p class="eyebrow">DISCOVER BIREQDAR&amp;CO.</p><h2 id="flip-stack-heading">Pieces with<br><em>presence.</em></h2></div>
        <p>Move through our collections, stories and services, one considered card at a time.</p>
        <span class="flip-stack-scroll-cue" aria-hidden="true">SCROLL TO EXPLORE <b>↓</b></span>
      </header>
      <div class="flip-stack-scroll" style="--flip-card-count:${items.length}">
        <div class="flip-stack-stage">
          ${items.map((item, index) => `
            <article id="${escape(item.id || `flip-card-${index}`)}" class="flip-stack-card${item.details?.length ? ' has-details' : ''}" data-flip-card="${index}" style="--flip-card-bg:${escape(item.background)};--flip-card-fg:${escape(item.foreground)};--flip-card-index:${index}" aria-label="${escape(item.eyebrow)}: ${escape(item.title)}">
              <div class="flip-stack-copy"><p class="flip-stack-eyebrow">${escape(item.eyebrow)}</p><span class="flip-stack-number">${String(index + 1).padStart(2, '0')}</span><h3>${escape(item.title)}</h3><p class="flip-stack-description">${escape(item.description)}</p>${item.details?.length ? `<ul class="flip-stack-details">${item.details.map(detail => `<li>${escape(detail)}</li>`).join('')}</ul>` : ''}<div class="flip-stack-links"><a href="${escape(item.href)}">${escape(item.linkLabel)} <svg class="cine-arrow" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M3.2 8.8 8.8 3.2M4.6 3.2h4.2v4.2"/></svg></a>${item.secondaryHref ? `<a class="flip-stack-secondary" href="${escape(item.secondaryHref)}">${escape(item.secondaryLabel)} <svg class="cine-arrow" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M3.2 8.8 8.8 3.2M4.6 3.2h4.2v4.2"/></svg></a>` : ''}</div></div>
              <div class="flip-stack-image"><img src="${escape(item.image)}" alt="${escape(item.imageAlt)}" loading="${index===0?'eager':'lazy'}"></div>
            </article>`).join('')}
        </div>
      </div>
      <p class="flip-stack-end">Form follows feeling. Time, made tangible. <a href="shop.html">Explore every piece <svg class="cine-arrow" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M3.2 8.8 8.8 3.2M4.6 3.2h4.2v4.2"/></svg></a></p>
    </section>`;

  const scrollArea = root.querySelector('.flip-stack-scroll');
  const stage = root.querySelector('.flip-stack-stage');
  const cards = [...root.querySelectorAll('[data-flip-card]')];
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let frame = 0;

  function updateStack() {
    frame = 0;
    if (motion.matches || !cards.length) return;
    const cardHeight = stage.getBoundingClientRect().height || window.innerHeight;
    // Each viewport of scroll advances one card; the active card folds away as the next rises into place.
    const scrollProgress = Math.max(0, Math.min(cards.length - 1, -scrollArea.getBoundingClientRect().top / cardHeight));
    const current = Math.floor(scrollProgress);
    const progress = scrollProgress - current;

    cards.forEach((card, index) => {
      let y = 24, rotation = 0, scale = .94, opacity = .48, z = cards.length - index;
      if (index < current) {
        y = -112; rotation = -66; scale = .94; opacity = 0; z = index + 1;
      } else if (index === current && index < cards.length - 1) {
        y = -progress * 28; rotation = -progress * 64; scale = 1 - progress * .055; opacity = 1 - progress * .35; z = cards.length + 1;
      } else if (index === current) {
        y = 0; rotation = 0; scale = 1; opacity = 1; z = cards.length + 1;
      } else if (index === current + 1) {
        y = (1 - progress) * 28; rotation = (1 - progress) * -5; scale = .94 + progress * .06; opacity = .94; z = cards.length;
      }
      card.style.zIndex = String(z);
      card.style.opacity = String(opacity);
      card.style.transform = `perspective(1400px) translateY(${y}%) rotateX(${rotation}deg) scale(${scale})`;
      card.setAttribute('aria-hidden', String(opacity < .05));
    });
  }
  function requestUpdate() { if (!frame) frame = requestAnimationFrame(updateStack); }
  window.addEventListener('scroll', requestUpdate, { passive: true });
  window.addEventListener('resize', requestUpdate, { passive: true });
  motion.addEventListener?.('change', requestUpdate);
  requestUpdate();
})();
