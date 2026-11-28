import * as THREE from 'three';
import { attachGame } from './main.js';
import { tiles, soften } from './surface.js';
import { blow, stepWind, wind } from './wind.js';

const $ = id => document.getElementById(id);
const floor = () => 0;
const [grass] = tiles(['assets/textures/grass-clover.jpg']);

function clearing(scene) {
  const sky = document.createElement('canvas');
  sky.width = 2; sky.height = 256;
  const ctx = sky.getContext('2d'), gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, '#b3cfd2');
  gradient.addColorStop(0.36, '#e0e4d4');
  gradient.addColorStop(1, '#e0e4d4');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 2, 256);
  scene.background = new THREE.CanvasTexture(sky);
  scene.background.colorSpace = THREE.SRGBColorSpace;
  scene.fog = new THREE.Fog(0xe0e4d4, 24, 69);
  grass.repeat.set(100, 100);
  const mat = soften(new THREE.MeshLambertMaterial({ map: grass, color: 0xd2c9af }), {
    cells: [5, 4], contrast: 0.50, saturation: 0.47, scales: [0.10, 0.44], low: [0.68, 0.73, 0.60], high: [1.04, 1.0, 0.88],
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), mat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  const sun = new THREE.DirectionalLight(0xffedcc, 1.7);
  sun.position.set(-8, 15, 7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 15, bottom: -13, far: 48 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.normalBias = 0.03;
  sun.shadow.bias = -0.00025;
  scene.add(ground, sun, new THREE.HemisphereLight(0xfff5dd, 0x858e78, 1.23));
}

export async function startFallStand() {
  const canvas = $('scene'), stand = $('fall-stand'), action = $('fell-tree'), manual = $('fall-saw'), label = $('fall-state');
  canvas.setAttribute('aria-label', 'Один клён на поляне. Перетащи мышью, чтобы облететь дерево.');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, 1, 0.07, 150);
  clearing(scene);
  const seed = Number(new URLSearchParams(location.search).get('seed') ?? 27) >>> 0;
  const view = { yaw: 0.12, pitch: 0.12, dist: 22.2, focus: new THREE.Vector3(0, 4.35, 0) };
  const target = view.focus.clone(), direction = new THREE.Vector3(1, 0, 0);
  let stage = 'ready', afterHit = -1, follow = 0, samples = null, maxBodies = 0, seeFall = false, broken = 0;
  const study = {
    onFall(u, separation) {
      direction.copy(u);
      stage = 'falling';
      action.disabled = true;
      label.textContent = 'Дерево пошло';
      seeFall = game.active;
      if (seeFall) {
        // Из-под пилы переходим туда, откуда видна вся дуга настоящего падения.
        const side = Math.atan2(-u.z, u.x);
        view.yaw = Math.cos(side - view.yaw) >= 0 ? side : side + Math.PI;
      }
      follow = 0; afterHit = -1; maxBodies = 0;
      samples = { frames: [], peak: 0, separation };
    },
    onImpact(count) {
      afterHit = 0; broken = count;
      label.textContent = count === null ? 'Удар · ветви оседают' : 'Удар · разлетается листва';
    },
    onLand() {
      stage = 'down';
      action.disabled = false; action.textContent = 'Повторить падение';
      label.textContent = broken === null ? 'Ствол на земле' : 'Ствол на земле · отломилось ветвей: ' + broken;
    },
  };
  const game = attachGame({ scene, camera, ground: floor, groundNormal: (x, z, out) => out.set(0, 1, 0),
    walkable: (x, z) => Math.hypot(x, z) < 25, treePlots: [{ x: 0, z: 0, r: 0.12 }], study });
  function observe() {
    if (game.active) game.leave();
    manual.textContent = 'Взять пилу';
    stand.classList.remove('sawing');
    camera.fov = 40;
    camera.updateProjectionMatrix();
  }
  function reset() {
    observe();
    stage = 'ready'; samples = null; afterHit = -1; seeFall = false; broken = 0; follow = 0;
    blow(0.3, 0, 0.8);
    wind.time = 0;
    game.regrow(() => seed / 2 ** 32);
    renderer.shadowMap.needsUpdate = true;
    view.focus.set(0, 4.35, 0);
    action.disabled = false; action.textContent = 'Повалить';
    label.textContent = 'Дерево стоит';
  }
  function start() {
    if (stage === 'falling') return;
    if (stage === 'down') reset();
    direction.set(Number($('fall-direction').value), 0, 0);
    study.fell(direction.clone());
  }
  action.addEventListener('click', start);
  $('fall-reset').addEventListener('click', reset);
  manual.addEventListener('click', () => {
    if (game.active) { observe(); return; }
    const down = stage === 'down';
    const side = new THREE.Vector3(-direction.z, 0, direction.x);
    const at = down ? direction.clone().multiplyScalar(1.65).addScaledVector(side, 0.78) : new THREE.Vector3(0, 0, 0.82);
    game.enter(at, down ? Math.atan2(side.x, side.z) : 0, false);
    if (down) game.look(0, 0.85);
    stand.classList.add('sawing');
    manual.textContent = 'Вернуться к обзору · F';
  });
  addEventListener('keydown', e => {
    if (e.repeat || e.target.matches?.('select,input,textarea')) return;
    if (e.code === 'KeyF' && game.active) observe();
    if (e.code === 'KeyR') reset();
  });
  let pointer = null;
  canvas.addEventListener('pointerdown', e => {
    if (game.active || e.button !== 0) return;
    pointer = e.pointerId;
    canvas.setPointerCapture(pointer);
  });
  canvas.addEventListener('pointermove', e => {
    if (pointer !== e.pointerId || game.active) return;
    view.yaw -= e.movementX * 0.008;
    view.pitch = THREE.MathUtils.clamp(view.pitch + e.movementY * 0.006, -0.03, 1.25);
  });
  canvas.addEventListener('lostpointercapture', () => { pointer = null; });
  canvas.addEventListener('wheel', e => {
    if (game.active) return;
    e.preventDefault();
    view.dist = THREE.MathUtils.clamp(view.dist * Math.exp(e.deltaY * 0.001), 7, 36);
  }, { passive: false });
  function orbit(dt) {
    if (stage !== 'ready') follow = Math.min(1, follow + dt / 2.4);
    const t = THREE.MathUtils.smoothstep(follow, 0, 1);
    target.copy(direction).multiplyScalar(4.5 * t).setY(4.35 - 2.9 * t);
    view.focus.lerp(target, -Math.expm1(-7 * dt));
    const dist = view.dist * (1 - 0.14 * t) / Math.min(1, camera.aspect / 1.25);
    const pitch = view.pitch + 0.14 * t;
    const horizontal = Math.cos(pitch) * dist;
    camera.position.set(Math.sin(view.yaw) * horizontal, Math.sin(pitch) * dist, Math.cos(view.yaw) * horizontal).add(view.focus);
    camera.position.y = Math.max(0.65, camera.position.y);
    camera.lookAt(view.focus);
  }
  function saveResult() {
    samples.frames.sort((a, b) => a - b);
    const p95 = samples.frames[Math.ceil(samples.frames.length * 0.95) - 1];
    const row = $('fall-result');
    while (row.cells.length > 1) row.deleteCell(1);
    for (const value of [samples.separation.toFixed(1) + ' мс', samples.peak.toFixed(1) + ' мс', p95.toFixed(1) + ' мс', maxBodies]) row.insertCell().textContent = value;
    samples = null;
  }
  let width = 0, height = 0, last = 0, lastShadow = 0;
  function resize() {
    width = canvas.clientWidth; height = canvas.clientHeight;
    renderer.setPixelRatio(Math.min(1, 800 / width, 460 / height));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  reset();
  resize();
  orbit(0);
  await renderer.compileAsync(scene, camera);
  stand.hidden = false;
  window.stand = { renderer, scene, camera, game, study };
  function frame(now) {
    if (canvas.clientWidth !== width || canvas.clientHeight !== height) resize();
    const elapsed = last ? now - last : 16.67;
    last = now;
    const dt = Math.min(0.05, elapsed / 1000);
    const begin = performance.now();
    stepWind(dt);
    game.tick(now, dt);
    const cost = performance.now() - begin;
    if (seeFall) { seeFall = false; observe(); }
    if (!game.active) orbit(dt);
    const moving = study.movingBodies();
    if ((stage === 'falling' || moving || game.active || samples) && now - lastShadow >= 32) {
      renderer.shadowMap.needsUpdate = true;
      lastShadow = now;
    }
    if (samples) {
      samples.peak = Math.max(samples.peak, cost);
      samples.frames.push(elapsed);
      maxBodies = Math.max(maxBodies, moving);
      if (afterHit >= 0) {
        afterHit += dt;
        if (afterHit >= 3) saveResult();
      }
    }
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
