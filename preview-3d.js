// Private 3D preview page: loads the concept watch into the shared model viewer.
import { createModelViewer } from './model-viewer.js';

const stage = document.querySelector('#preview3d-stage');
const status = stage.querySelector('.model-stage-status');
let autoRotate = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let viewer = null;

function mount() {
  viewer?.destroy();
  viewer = createModelViewer(stage, {
    url: 'assets/3d/bireqdar-concept-watch.glb',
    label: 'BIREQDAR&CO. concept watch, 3D model',
    environment: 'studio',
    environmentIntensity: 1.1,
    exposure: 1.05,
    intro: 'rise',
    autoRotate,
    autoRotateSpeed: 0.35,
    startAngle: -24,
    tilt: 14,
    fit: 0.86,
    shadowOpacity: 0.55,
  });
  viewer.ready.then(() => status?.remove()).catch(() => { if (status) status.textContent = 'The 3D view could not be shown on this device.'; });
}
mount();

document.querySelector('[data-reset]')?.addEventListener('click', () => viewer?.reset());
const spin = document.querySelector('[data-spin]');
if (!autoRotate && spin) { spin.setAttribute('aria-pressed', 'false'); spin.textContent = 'Auto-rotate off'; }
spin?.addEventListener('click', () => {
  autoRotate = !autoRotate;
  spin.setAttribute('aria-pressed', String(autoRotate));
  spin.textContent = autoRotate ? 'Auto-rotate on' : 'Auto-rotate off';
  mount();
});
