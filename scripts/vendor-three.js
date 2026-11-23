// Copies the parts of three.js used by model-viewer.js into vendor/three/ so the
// browser can load them from this site (the server never serves node_modules).
// Runs automatically after `npm install` (see "postinstall" in package.json).
// Bare `three` imports are rewritten to relative paths, so no import map is
// needed (inline import maps would be blocked by the Content-Security-Policy).
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = path.join(root, 'node_modules', 'three');
const target = path.join(root, 'vendor', 'three');

if (!fs.existsSync(path.join(source, 'package.json'))) {
  console.log('[vendor-three] three is not installed; the 3D viewer stays off until it is.');
  process.exit(0);
}

// three r171+ splits the build into three.module.js + three.core.js; recent
// releases no longer ship minified copies, so the plain builds are used.
const files = [
  ['build/three.module.js', 'three.module.js', true],
  ['build/three.core.js', 'three.core.js', false],
  ['examples/jsm/loaders/GLTFLoader.js', 'GLTFLoader.js', true],
  ['examples/jsm/utils/BufferGeometryUtils.js', 'BufferGeometryUtils.js', true],
  ['examples/jsm/utils/SkeletonUtils.js', 'SkeletonUtils.js', false], // imported by GLTFLoader in r17x+
  ['examples/jsm/environments/RoomEnvironment.js', 'RoomEnvironment.js', true],
  ['LICENSE', 'LICENSE', false],
];

fs.mkdirSync(target, { recursive: true });
for (const [from, to, required] of files) {
  const file = path.join(source, from);
  if (!fs.existsSync(file)) {
    if (required) { console.error(`[vendor-three] Missing ${from}; the 3D viewer will not load.`); process.exitCode = 1; }
    continue;
  }
  let text = fs.readFileSync(file, 'utf8');
  if (to.endsWith('.js') && !to.startsWith('three.')) {
    text = text
      .replace(/from\s*(['"])three\1/g, "from './three.module.js'")
      .replace(/from\s*(['"])\.\.\/utils\/(BufferGeometryUtils|SkeletonUtils)\.js\1/g, "from './$2.js'");
  }
  fs.writeFileSync(path.join(target, to), text);
}
const version = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8')).version;
console.log(`[vendor-three] three ${version} copied to vendor/three/ for the 3D product viewer.`);
