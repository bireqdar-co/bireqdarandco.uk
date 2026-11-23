// BIREQDAR&CO. 360° spin viewer: turns a real product by scrubbing through a
// sequence of photographs taken on a turntable (24–72 frames, evenly spaced).
// Photographs keep polished gold and sapphire exactly as they look in life,
// which 3D scans of reflective watches rarely manage.
//
//   import { createSpinViewer } from './spin-viewer.js';
//   const spin = createSpinViewer(container, { frames: [...urls], label: 'Watch' });
//   spin.destroy();
//
// Drag or swipe sideways to turn (with gentle momentum), arrow keys step one frame,
// Home / 0 returns to the first frame. One slow introductory turn plays once the
// frames have loaded, unless the visitor prefers reduced motion.

export function createSpinViewer(container, options = {}) {
  const frames = (options.frames || []).filter(Boolean);
  const label = options.label || 'Product';
  const reducedQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const reduced = () => !!reducedQuery?.matches;
  const turnsPerWidth = options.turnsPerWidth ?? 1; // dragging the full width = one full turn

  const view = document.createElement('div');
  view.className = 'spin-view';
  view.tabIndex = 0;
  view.setAttribute('role', 'img');
  view.setAttribute('aria-roledescription', '360 degree view');
  view.setAttribute('aria-label', `${label}, 360° view. Drag, swipe or use the left and right arrow keys to turn it.`);
  const img = document.createElement('img');
  img.className = 'spin-frame';
  img.alt = '';
  img.draggable = false;
  const progress = document.createElement('div');
  progress.className = 'spin-progress';
  progress.setAttribute('role', 'status');
  const dial = document.createElement('div');
  dial.className = 'spin-dial';
  dial.setAttribute('aria-hidden', 'true');
  dial.innerHTML = '<span></span>';
  view.append(img, progress, dial);
  container.append(view);

  let index = 0;
  let position = 0; // fractional frame position
  let velocity = 0; // frames per second
  let dragging = false;
  let lastX = 0;
  let lastT = 0;
  let raf = 0;
  let introRemaining = 0;
  let destroyed = false;
  const images = [];

  const show = value => {
    const n = frames.length;
    position = ((value % n) + n) % n;
    const next = Math.round(position) % n;
    if (next !== index || !img.src) {
      index = next;
      img.src = images[index]?.src || frames[index];
    }
    dial.style.setProperty('--turn', `${(position / n) * 360}deg`);
  };

  const loop = time => {
    raf = 0;
    if (destroyed) return;
    const dt = Math.min(0.05, lastT ? (time - lastT) / 1000 : 1 / 60);
    lastT = time;
    let moving = false;
    if (!dragging && introRemaining > 0) {
      const speed = frames.length / 4; // one turn in about four seconds
      const step = Math.min(introRemaining, speed * dt);
      introRemaining -= step;
      show(position + step);
      moving = introRemaining > 0;
    } else if (!dragging && Math.abs(velocity) > 0.2) {
      show(position + velocity * dt);
      velocity *= Math.exp(-dt * 3.2);
      moving = true;
    }
    if (moving) raf = requestAnimationFrame(loop);
    else lastT = 0;
  };
  const kick = () => { if (!raf && !destroyed) raf = requestAnimationFrame(loop); };

  const framesPerPixel = () => (frames.length * turnsPerWidth) / Math.max(1, view.clientWidth);
  const onDown = event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    dragging = true;
    introRemaining = 0;
    velocity = 0;
    lastX = event.clientX;
    lastT = event.timeStamp;
    view.setPointerCapture?.(event.pointerId);
    view.classList.add('is-dragging');
  };
  const onMove = event => {
    if (!dragging) return;
    const dx = event.clientX - lastX;
    const dt = Math.max((event.timeStamp - lastT) / 1000, 1 / 240);
    lastX = event.clientX;
    lastT = event.timeStamp;
    const delta = -dx * framesPerPixel(); // drag right = turn the watch towards you from the left
    show(position + delta);
    velocity = velocity * 0.35 + (delta / dt) * 0.65;
  };
  const onUp = event => {
    if (!dragging) return;
    dragging = false;
    view.classList.remove('is-dragging');
    if (event.timeStamp - lastT > 90) velocity = 0;
    if (reduced()) velocity = 0;
    lastT = 0;
    kick();
  };
  const onKey = event => {
    if (event.key === 'ArrowLeft') show(position - 1);
    else if (event.key === 'ArrowRight') show(position + 1);
    else if (event.key === 'Home' || event.key === '0') show(0);
    else return;
    event.preventDefault();
    introRemaining = 0;
    velocity = 0;
  };
  view.addEventListener('pointerdown', onDown);
  view.addEventListener('pointermove', onMove);
  view.addEventListener('pointerup', onUp);
  view.addEventListener('pointercancel', onUp);
  view.addEventListener('keydown', onKey);

  // Preload every frame before allowing interaction so turning never flickers.
  let loaded = 0;
  progress.textContent = `Preparing the 360° view… 0 / ${frames.length}`;
  const ready = Promise.all(frames.map((src, i) => new Promise(resolve => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = image.onerror = () => {
      loaded += 1;
      progress.textContent = `Preparing the 360° view… ${loaded} / ${frames.length}`;
      resolve();
    };
    image.src = src;
    images[i] = image;
  }))).then(() => {
    if (destroyed) return;
    progress.textContent = '';
    view.classList.add('is-ready');
    show(0);
    if (!reduced() && options.intro !== false) { introRemaining = frames.length; kick(); }
  });
  show(0);

  return {
    ready,
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      view.remove();
    },
  };
}
