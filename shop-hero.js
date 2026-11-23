// Shop header: match the banner image and wording to the collection in the URL
// (?type=jewellery, ?collection=gemstones, ?collection=bullion, ?type=watch …).
// Wording comes from the matching collection pages; nothing here is a product claim.
(() => {
  const hero = document.querySelector('.page-hero--banner');
  if (!hero) return;
  const params = new URLSearchParams(location.search);
  const baseKey = (params.get('collection') || params.get('type') || 'all').toLowerCase();
  const category = (params.get('category') || '').toLowerCase();
  const categoryNames = { necklaces: 'Necklaces', pendants: 'Pendants', earrings: 'Earrings', bracelets: 'Bracelets', rings: 'Rings' };

  const scenes = {
    all: {
      image: 'assets/catalogue/pear-diamond-pendant-concept.jpg', focus: '50% 55%',
      eyebrow: 'BIREQDAR&CO. · COLLECTIONS', title: 'Pieces with <em>presence.</em>',
      lede: 'Explore jewellery, precious metals and watches. Ask us about availability, verified product details and bespoke commissions.',
    },
    jewellery: {
      image: 'assets/catalogue/tennis-chain-hero.jpg', focus: '50% 40%',
      eyebrow: 'FINE JEWELLERY', title: 'A light of <em>your own.</em>',
      lede: 'Gold and silver jewellery, from necklaces and pendants to earrings, bracelets and rings.',
    },
    gold: {
      image: 'assets/catalogue/emerald-line-pendant.jpg', focus: '50% 60%',
      eyebrow: 'FINE JEWELLERY · GOLD', title: 'Warm, enduring <em>form.</em>',
      lede: 'Explore gold jewellery and ask about current designs, materials and availability.',
    },
    silver: {
      image: 'assets/catalogue/silver-curve-bracelet.jpg', focus: '50% 50%',
      eyebrow: 'FINE JEWELLERY · SILVER', title: 'Quiet <em>distinction.</em>',
      lede: 'Discover silver pieces for personal wear, gifting and special occasions.',
    },
    gemstones: {
      image: 'assets/catalogue/diamond-studs-concept.jpg', focus: '50% 45%',
      eyebrow: 'NATURAL & LAB-GROWN DIAMONDS · GEMSTONES', title: 'A little more <em>light.</em>',
      lede: 'Discover diamond designs and ask our team about the details, origins and options that matter to you.',
    },
    bullion: {
      image: 'assets/catalogue/bullion-still-life-concept.jpg', focus: '50% 50%',
      eyebrow: 'PRECIOUS METALS · INVESTMENT', title: 'Gold and silver, <em>held close.</em>',
      lede: 'Gold and silver bars and coins, including limited-edition bullion. Ask us for current availability, specifications and item-specific documentation.',
    },
    watch: {
      image: 'assets/catalogue/emerald-dial-watch-concept.jpg', focus: '50% 45%',
      eyebrow: 'TIMEPIECES', title: 'Watches with <em>presence.</em>',
      lede: 'Explore watches selected by BIREQDAR&CO., and ask us about current models, condition, availability and full specifications.',
    },
  };
  const aliases = { watches: 'watch', diamonds: 'gemstones', investment: 'bullion' };
  // A watch brand chosen in the Watches section gets its own banner wording.
  const brandScene = name => ({
    image: 'emerald-background.png', focus: '50% 40%',
    eyebrow: `TIMEPIECES · ${name.toUpperCase()}`, title: `${name}, <em>considered.</em>`,
    lede: `Explore ${name} watches and ask us about current models, condition, box and papers, availability and full specifications.`,
  });
  const apply = brandName => {
  const key = aliases[baseKey] || baseKey;
  const scene = key === 'watch' && brandName ? brandScene(brandName) : (scenes[key] || scenes.all);
  const eyebrow = category && categoryNames[category] ? `${scene.eyebrow.split(' · ')[0]} · ${categoryNames[category].toUpperCase()}` : scene.eyebrow;

  const img = hero.querySelector('.page-hero-banner-media img');
  if (img && !img.src.endsWith(scene.image)) img.src = scene.image;
  img?.style.setProperty('--focus', scene.focus);
  const set = (selector, html) => { const el = hero.querySelector(selector); if (el) el.innerHTML = html; };
  const escapeText = text => text.replace(/&/g, '&amp;');
  set('.cine-eyebrow', escapeText(eyebrow).replace(' · ', ' <span aria-hidden="true">·</span> '));
  set('h1', scene.title);
  set('.page-lede', escapeText(scene.lede));
  const label = (categoryNames[category] ? `${categoryNames[category]} — ` : '') + hero.querySelector('h1').textContent.trim();
  document.title = `${label} — BIREQDAR&CO.`;
  };
  window.shopHero = { setBrand: apply };
  const brandNames = { rolex: 'Rolex', 'patek-philippe': 'Patek Philippe', 'audemars-piguet': 'Audemars Piguet', cartier: 'Cartier', omega: 'Omega', 'richard-mille': 'Richard Mille', 'vacheron-constantin': 'Vacheron Constantin' };
  apply(brandNames[(params.get('brand') || '').toLowerCase()] || '');
})();
