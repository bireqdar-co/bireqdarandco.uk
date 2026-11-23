// BIREQDAR&CO. 3D product viewer — a dependency-free port of React Bits'
// <ModelViewer /> (https://reactbits.dev) to plain JavaScript on top of three.js,
// so it runs on this site without React or a build step.
//
// Behaviour kept from the original: auto-framing, drag-to-turn with momentum,
// idle auto-rotate that eases back in, hover tilt, gentle float, "rise" / "spin" /
// "fade" intros, soft contact shadow, pinch and Ctrl/Cmd+scroll zoom (plain
// scrolling still scrolls the page), double-click to reset, render-on-demand,
// pausing while off-screen, and prefers-reduced-motion support.
// Differences: studio lighting is generated locally (RoomEnvironment) instead of
// downloading HDR presets from a CDN (blocked by the site's Content-Security-Policy);
// GLB/GLTF models only; keyboard controls added (arrows turn, + / − zoom, 0 resets).
//
// Usage:
//   import { createModelViewer } from './model-viewer.js';
//   const viewer = createModelViewer(container, { url: 'assets/3d/watch.glb', startAngle: -20, tilt: 8 });
//   viewer.destroy();
import * as THREE from './vendor/three/three.module.js';
import { GLTFLoader } from './vendor/three/GLTFLoader.js';
import { RoomEnvironment } from './vendor/three/RoomEnvironment.js';

const FOV = 30;
const INTRO_SECONDS = 1.3;
const DRAG_SPEED = 0.0065;
const PITCH_LIMIT = (65 * Math.PI) / 180;
const toRadians = degrees => (degrees * Math.PI) / 180;
const clamp = THREE.MathUtils.clamp;

const DEFAULTS = {
  url: '',
  label: '3D model',
  environment: 'studio', // 'studio' or 'none'
  environmentIntensity: 1,
  exposure: 1,
  intro: 'rise', // 'rise' | 'spin' | 'fade' | 'none'
  autoRotate: true,
  autoRotateSpeed: 0.4,
  autoRotateDelay: 2,
  dragRotate: true,
  turntable: false,
  zoom: true,
  minZoom: 0.7,
  maxZoom: 2,
  hoverTilt: 0.15,
  float: 0.3,
  shadow: true,
  shadowOpacity: 0.45,
  fit: 0.8,
  offsetX: 0,
  offsetY: 0,
  startAngle: -30,
  tilt: 10,
  resetOnDoubleClick: true,
  onModelLoaded: null,
  onError: null,
};

function measure(object) {
  const box = new THREE.Box3().setFromObject(object);
  const extent = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const scale = 2 / Math.max(extent.x, extent.y, extent.z, 0.0001);
  return { scale, center, radius: (extent.length() / 2) * scale, floor: (extent.y / 2) * scale };
}

// A soft radial shadow texture standing in for drei's <ContactShadows />.
function shadowTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(0,0,0,1)');
  gradient.addColorStop(0.45, 'rgba(0,0,0,.55)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createModelViewer(container, options = {}) {
  const s = { ...DEFAULTS, ...options };
  s.minZoom = Math.min(options.minZoom ?? DEFAULTS.minZoom, options.maxZoom ?? DEFAULTS.maxZoom);
  s.maxZoom = Math.max(options.minZoom ?? DEFAULTS.minZoom, options.maxZoom ?? DEFAULTS.maxZoom);
  s.autoRotateDelay = Math.max(0, s.autoRotateDelay);
  s.hoverTilt = Math.max(0, s.hoverTilt);
  s.float = Math.max(0, s.float);
  const reducedQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const reduced = () => !!reducedQuery?.matches;

  // ---- renderer, scene, camera
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping ?? THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = s.exposure;
  const canvas = renderer.domElement;
  canvas.className = 'model-viewer-canvas';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `${s.label}. Drag or use the arrow keys to turn it; plus and minus to zoom; 0 to reset.`);
  canvas.style.touchAction = 'pan-y';
  canvas.style.cursor = s.dragRotate ? 'grab' : 'default';
  canvas.style.opacity = s.intro === 'none' ? '1' : '0';
  canvas.style.transition = s.intro === 'none' ? 'none' : 'opacity .6s ease';
  container.append(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 100);
  let pmrem = null;
  if (s.environment !== 'none') {
    pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    if ('environmentIntensity' in scene) scene.environmentIntensity = s.environmentIntensity;
  }
  const keyLight = new THREE.DirectionalLight(0xffffff, 0.6);
  keyLight.position.set(3, 5, 4);
  scene.add(keyLight);

  // Same group nesting as the original: place > float > tilt > spin > fit > model
  const place = new THREE.Group();
  const floatGroup = new THREE.Group();
  const tiltGroup = new THREE.Group();
  const spinGroup = new THREE.Group();
  const fitGroup = new THREE.Group();
  place.add(floatGroup); floatGroup.add(tiltGroup); tiltGroup.add(spinGroup); spinGroup.add(fitGroup);
  scene.add(place);

  let bounds = null;
  let shadowMesh = null;
  let destroyed = false;
  let visible = true;
  let frame = 0;
  let lastTime = 0;

  const motion = {
    yaw: toRadians(s.startAngle), pitch: toRadians(s.tilt), yawVelocity: 0, pitchVelocity: 0,
    zoom: 1, zoomGoal: 1, tiltX: 0, tiltY: 0, tiltGoalX: 0, tiltGoalY: 0, spinSpeed: 0,
    idle: 0, dragging: false, intro: s.intro === 'none' || reduced() ? 1 : 0, clock: 0, reset: null,
  };

  const size = { width: 1, height: 1 };
  const resize = () => {
    const rect = container.getBoundingClientRect();
    size.width = Math.max(1, Math.round(rect.width));
    size.height = Math.max(1, Math.round(rect.height));
    renderer.setSize(size.width, size.height, false);
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    wake();
  };

  // ---- render loop (on demand, like frameloop="demand")
  function step(time) {
    frame = 0;
    if (destroyed) return;
    const delta = lastTime ? (time - lastTime) / 1000 : 1 / 60;
    lastTime = time;
    const settling = bounds ? tick(delta) : false;
    renderer.render(scene, camera);
    if (settling && visible) frame = requestAnimationFrame(step);
    else lastTime = 0;
  }
  function wake() { if (!frame && !destroyed) frame = requestAnimationFrame(step); }

  function tick(delta) {
    const m = motion;
    const dt = Math.min(delta, 0.05);
    const reduce = reduced();
    m.clock += dt;
    m.idle += dt;
    if (m.intro < 1) m.intro = reduce ? 1 : Math.min(1, m.intro + dt / INTRO_SECONDS);
    const eased = 1 - Math.pow(1 - m.intro, 3);

    if (m.reset) {
      m.yaw += (m.reset.yaw - m.yaw) * (1 - Math.exp(-dt * 7));
      m.pitch += (m.reset.pitch - m.pitch) * (1 - Math.exp(-dt * 7));
      if (Math.abs(m.reset.yaw - m.yaw) < 0.001 && Math.abs(m.reset.pitch - m.pitch) < 0.001) m.reset = null;
    } else if (!m.dragging) {
      const decay = Math.exp(-dt * 4.5);
      m.yaw += m.yawVelocity * dt;
      m.pitch = clamp(m.pitch + m.pitchVelocity * dt, -PITCH_LIMIT, PITCH_LIMIT);
      m.yawVelocity *= decay;
      m.pitchVelocity *= decay;
      if (s.turntable) m.pitch += (toRadians(s.tilt) - m.pitch) * (1 - Math.exp(-dt * 4));
    }

    const spinning = s.autoRotate && !reduce && !m.dragging && m.idle > s.autoRotateDelay;
    m.spinSpeed += ((spinning ? s.autoRotateSpeed : 0) - m.spinSpeed) * (1 - Math.exp(-dt * 2));
    m.yaw += m.spinSpeed * dt;
    m.zoom += (m.zoomGoal - m.zoom) * (1 - Math.exp(-dt * 8));
    m.tiltX += (m.tiltGoalX - m.tiltX) * (1 - Math.exp(-dt * 6));
    m.tiltY += (m.tiltGoalY - m.tiltY) * (1 - Math.exp(-dt * 6));

    const aspect = size.width / Math.max(size.height, 1);
    const halfView = Math.tan(toRadians(FOV) / 2);
    const fitDistance = bounds.radius / (Math.max(s.fit, 0.05) * halfView * Math.min(1, aspect));
    const distance = fitDistance / m.zoom;
    camera.aspect = aspect;
    camera.position.set(0, 0, distance);
    camera.near = distance / 50;
    camera.far = distance * 50;
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();

    const halfHeight = fitDistance * halfView;
    place.position.set(s.offsetX * halfHeight * aspect, s.offsetY * halfHeight, 0);
    const rise = s.intro === 'rise' ? (1 - eased) * -0.45 : 0;
    const grow = s.intro === 'rise' ? 0.9 + 0.1 * eased : 1;
    const twist = s.intro === 'spin' ? (1 - eased) * -Math.PI * 1.2 : s.intro === 'rise' ? (1 - eased) * -0.5 : 0;
    const bob = reduce ? 0 : Math.sin(m.clock * 1.3) * s.float * 0.06;
    floatGroup.position.y = rise + bob;
    floatGroup.scale.setScalar(grow);
    tiltGroup.rotation.set(m.tiltX, m.tiltY, 0);
    spinGroup.rotation.set(m.pitch, m.yaw + twist, 0, 'YXZ');
    if (s.intro === 'fade' && canvas.style.opacity !== '1') canvas.style.opacity = String(eased);

    return m.intro < 1 || m.dragging || !!m.reset
      || Math.abs(m.yawVelocity) + Math.abs(m.pitchVelocity) > 0.0005
      || Math.abs(m.zoomGoal - m.zoom) > 0.0005
      || Math.abs(m.tiltGoalX - m.tiltX) + Math.abs(m.tiltGoalY - m.tiltY) > 0.0005
      || m.spinSpeed > 0.0005
      || (s.autoRotate && !reduce)
      || (s.float > 0 && !reduce);
  }

  // ---- input
  const pointers = new Map();
  let pinchStart = 0;
  let zoomStart = 1;
  const resetView = () => {
    const turns = Math.round((motion.yaw - toRadians(s.startAngle)) / (Math.PI * 2));
    motion.reset = { yaw: toRadians(s.startAngle) + turns * Math.PI * 2, pitch: toRadians(s.tilt) };
    motion.zoomGoal = 1; motion.yawVelocity = 0; motion.pitchVelocity = 0; motion.idle = 0;
    wake();
  };
  const onDown = event => {
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, t: event.timeStamp });
    if (pointers.size === 2 && s.zoom) {
      const [a, b] = [...pointers.values()];
      pinchStart = Math.hypot(a.x - b.x, a.y - b.y);
      zoomStart = motion.zoomGoal;
      motion.dragging = false;
    } else if (pointers.size === 1 && s.dragRotate && (event.pointerType !== 'mouse' || event.button === 0)) {
      motion.dragging = true; motion.yawVelocity = 0; motion.pitchVelocity = 0;
      canvas.setPointerCapture?.(event.pointerId);
      canvas.style.cursor = 'grabbing';
    }
    motion.idle = 0;
    wake();
  };
  const onMove = event => {
    const rect = canvas.getBoundingClientRect();
    if (event.pointerType === 'mouse' || event.pointerType === 'pen') {
      const nx = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = ((event.clientY - rect.top) / rect.height) * 2 - 1;
      motion.tiltGoalX = ny * s.hoverTilt * 0.6;
      motion.tiltGoalY = nx * s.hoverTilt;
    }
    const last = pointers.get(event.pointerId);
    if (last) {
      const dx = event.clientX - last.x;
      const dy = event.clientY - last.y;
      const elapsed = Math.max((event.timeStamp - last.t) / 1000, 1 / 240);
      last.x = event.clientX; last.y = event.clientY; last.t = event.timeStamp;
      if (pointers.size === 2 && s.zoom && pinchStart > 0) {
        const [a, b] = [...pointers.values()];
        motion.zoomGoal = clamp((zoomStart * Math.hypot(a.x - b.x, a.y - b.y)) / pinchStart, s.minZoom, s.maxZoom);
      } else if (motion.dragging) {
        motion.yaw += dx * DRAG_SPEED;
        motion.yawVelocity = motion.yawVelocity * 0.4 + ((dx * DRAG_SPEED) / elapsed) * 0.6;
        if (!s.turntable) {
          motion.pitch = clamp(motion.pitch + dy * DRAG_SPEED, -PITCH_LIMIT, PITCH_LIMIT);
          motion.pitchVelocity = motion.pitchVelocity * 0.4 + ((dy * DRAG_SPEED) / elapsed) * 0.6;
        }
        motion.idle = 0;
      }
    }
    wake();
  };
  const onUp = event => {
    const last = pointers.get(event.pointerId);
    if (last && event.timeStamp - last.t > 80) { motion.yawVelocity = 0; motion.pitchVelocity = 0; }
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinchStart = 0;
    if (pointers.size === 0) { motion.dragging = false; canvas.style.cursor = s.dragRotate ? 'grab' : 'default'; }
    wake();
  };
  const onLeave = () => { motion.tiltGoalX = 0; motion.tiltGoalY = 0; wake(); };
  const onWheel = event => {
    if (!s.zoom || !(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    motion.zoomGoal = clamp(motion.zoomGoal * Math.exp(-event.deltaY * 0.01), s.minZoom, s.maxZoom);
    motion.idle = 0;
    wake();
  };
  const onDoubleClick = () => { if (s.resetOnDoubleClick) resetView(); };
  const onKey = event => {
    const turn = 0.18;
    if (event.key === 'ArrowLeft') motion.yawVelocity -= turn * 6;
    else if (event.key === 'ArrowRight') motion.yawVelocity += turn * 6;
    else if (event.key === 'ArrowUp' && !s.turntable) motion.pitchVelocity -= turn * 4;
    else if (event.key === 'ArrowDown' && !s.turntable) motion.pitchVelocity += turn * 4;
    else if ((event.key === '+' || event.key === '=') && s.zoom) motion.zoomGoal = clamp(motion.zoomGoal * 1.15, s.minZoom, s.maxZoom);
    else if ((event.key === '-' || event.key === '_') && s.zoom) motion.zoomGoal = clamp(motion.zoomGoal / 1.15, s.minZoom, s.maxZoom);
    else if (event.key === '0' || event.key === 'Home') resetView();
    else return;
    event.preventDefault();
    motion.idle = 0;
    wake();
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('dblclick', onDoubleClick);
  canvas.addEventListener('keydown', onKey);

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  const visibility = new IntersectionObserver(entries => {
    visible = entries.some(entry => entry.isIntersecting);
    if (visible) wake();
  });
  visibility.observe(container);
  reducedQuery?.addEventListener?.('change', wake);
  resize();

  // ---- load the model
  const ready = new Promise((resolve, reject) => {
    new GLTFLoader().load(s.url, gltf => {
      if (destroyed) return;
      const object = gltf.scene;
      bounds = measure(object);
      fitGroup.scale.setScalar(bounds.scale);
      fitGroup.position.set(-bounds.center.x * bounds.scale, -bounds.center.y * bounds.scale, -bounds.center.z * bounds.scale);
      fitGroup.add(object);
      if (s.shadow) {
        shadowMesh = new THREE.Mesh(
          new THREE.PlaneGeometry(1, 1),
          new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, opacity: s.shadowOpacity, depthWrite: false, toneMapped: false }),
        );
        shadowMesh.rotation.x = -Math.PI / 2;
        shadowMesh.scale.setScalar(bounds.radius * 2.6);
        shadowMesh.position.y = -bounds.floor - 0.08;
        place.add(shadowMesh);
      }
      canvas.style.opacity = s.intro === 'fade' ? '0' : '1';
      container.classList.add('is-ready');
      s.onModelLoaded?.();
      wake();
      resolve();
    }, undefined, error => {
      container.classList.add('has-error');
      s.onError?.(error);
      reject(error);
    });
  });

  return {
    ready,
    reset: resetView,
    capture: (type = 'image/png') => canvas.toDataURL(type),
    destroy() {
      destroyed = true;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      visibility.disconnect();
      reducedQuery?.removeEventListener?.('change', wake);
      scene.traverse(node => {
        node.geometry?.dispose?.();
        const materials = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
        materials.forEach(material => { Object.values(material).forEach(value => value?.isTexture && value.dispose()); material.dispose(); });
      });
      scene.environment?.dispose?.();
      pmrem?.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
