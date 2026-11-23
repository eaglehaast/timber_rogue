import { showAction } from './hud-layout.js';
import { sawPoses } from './hud-bench-art.js';
import { makeHeldSaw } from './held-saw.js';
import * as THREE from 'three';
import { MOUSE, fieldOfView, makePlayer, forwardOf, turnHead, walkInput, walkSpeed, stepEyes, eyeCamera, bindStick } from './player.js';

// Этот стенд не импортирует двор или физику дерева. Общие с игрой здесь глаза,
// походка, круг движения и настоящие элементы экранного интерфейса.
export async function makePreview(getLayout) {
  const el = id => document.getElementById(id);
  const canvas = el('scene'), renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(fieldOfView(), 800 / 460, .05, 140);
  scene.background = new THREE.Color(0xd2dcd7);
  scene.fog = new THREE.FogExp2(scene.background, .047);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(180, 180), new THREE.MeshBasicMaterial({ color: 0xa2ac96 }));
  floor.rotation.x = -Math.PI / 2;
  const grid = new THREE.GridHelper(180, 180, 0x6c7a6a, 0x8a9883);
  grid.position.y = .002;
  scene.add(floor, grid);
  const player = makePlayer(), keys = new Set(), stick = bindStick(el('stick'));
  const slots = [...el('kit').querySelectorAll('button')];
  const contextual = ['hint','depth','gap','log','result'];
  const action = el('touch-saw'), saw = el('held-saw');
  const still = new Image(), rig = document.createElement('div');
  still.alt = 'Пила в руках'; still.draggable = false;
  rig.style.cssText = 'position:absolute; inset:0; pointer-events:none';
  rig.setAttribute('aria-hidden', 'true');
  saw.replaceChildren(still, rig);
  const motion = await makeHeldSaw(rig);
  el('hint').textContent = 'Падает! Отойди!';
  el('gap').textContent = 'Щель 8 мм';
  el('log').textContent = 'Щель сужается';
  el('result').textContent = 'Дерево легло';
  el('depthFill').style.width = '45%';
  el('hud').classList.add('details');
  el('hud').hidden = false;
  let playing = false, selected = 'held-saw', artState = 'asset', slot = 0;
  let actionPointer = null, lookPointer = null, previous = 0;
  function show() {
    const hasSaw = !playing || slot !== 2;
    const pressed = playing ? keys.has('Space') || actionPointer !== null
      : artState === 'pressedAsset' || artState === 'shortPressedAsset';
    const short = playing ? slot === 1 : selected === 'held-saw' && (artState === 'shortAsset' || artState === 'shortPressedAsset');
    const state = short ? (pressed ? 'shortPressedAsset' : 'shortAsset') : (pressed ? 'pressedAsset' : 'asset');
    const layout = getLayout(), id = layout.elements['held-saw'][state];
    const animate = playing && hasSaw && id === sawPoses[state] && layout.elements['held-saw'].visible;
    saw.hidden = !hasSaw; rig.hidden = !animate; still.hidden = animate;
    still.dataset.art = state;
    if (animate) {
      motion.setLength(short ? 30 : 70);
      motion.setThrottle(pressed);
    } else {
      motion.stop();
      if (hasSaw && still.getAttribute('src') !== layout.assets[id].src) still.src = layout.assets[id].src;
    }
    showAction(action, hasSaw ? 'Газ' : 'Взять', hasSaw, pressed);
    slots.forEach((el, i) => el.setAttribute('aria-pressed', i === slot));
    for (const id of contextual) el(id).hidden = playing || selected !== id;
  }
  function cancelGas() {
    const captured = actionPointer;
    actionPointer = null; keys.delete('Space');
    if (captured !== null && action.hasPointerCapture(captured)) action.releasePointerCapture(captured);
    motion.stop();
  }
  function take(i) { cancelGas(); slot = i; show(); }
  slots.forEach((el, i) => el.addEventListener('click', () => { if (playing) take(i); }));
  action.addEventListener('pointerdown', e => {
    if (!playing || e.button !== 0 || actionPointer !== null) return;
    actionPointer = e.pointerId;
    action.setPointerCapture(e.pointerId);
    show();
  });
  for (const type of ['pointerup','pointercancel','lostpointercapture']) action.addEventListener(type, e => {
    if (actionPointer === e.pointerId) { actionPointer = null; show(); }
  });
  canvas.addEventListener('pointerdown', e => {
    if (!playing || e.button !== 0 || lookPointer !== null) return;
    lookPointer = e.pointerId;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    if (lookPointer === e.pointerId) turnHead(player, e.movementX * MOUSE, e.movementY * MOUSE);
  });
  for (const type of ['pointerup','pointercancel','lostpointercapture']) canvas.addEventListener(type, e => { if (lookPointer === e.pointerId) lookPointer = null; });
  addEventListener('keydown', e => {
    if (!playing || e.target.closest('input,textarea,select') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!e.repeat) keys.add(e.code);
    if (/^Digit[1-3]$/.test(e.code) && !e.repeat) take(Number(e.code.at(-1)) - 1);
    if (e.code === 'KeyC' && !e.repeat) player.crouch = !player.crouch;
    if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) show(); }
  });
  addEventListener('keyup', e => { keys.delete(e.code); if (playing && e.code === 'Space') show(); });
  function clear() { cancelGas(); keys.clear(); lookPointer = null; show(); }
  addEventListener('blur', clear);
  addEventListener('pagehide', clear);
  document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); });
  el('inspector').addEventListener('focusin', clear);

  function draw() { eyeCamera(camera, player); renderer.render(scene, camera); }
  function frame(now) {
    const dt = Math.min((now - previous) / 1000, .05);
    previous = now;
    const input = walkInput(keys, stick), forward = forwardOf(player.yaw), right = new THREE.Vector3(-forward.z, 0, forward.x);
    const speed = walkSpeed(player, keys);
    player.pos.addScaledVector(forward, input.ahead * speed * dt).addScaledVector(right, input.side * speed * dt);
    player.pos.clampScalar(-65, 65);
    stepEyes(player, right, Math.hypot(input.side, input.ahead) * speed, dt);
    draw();
  }
  new ResizeObserver(() => {
    if (!canvas.clientWidth || !canvas.clientHeight) return;
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    camera.aspect = canvas.clientWidth / canvas.clientHeight;
    camera.updateProjectionMatrix();
    draw();
  }).observe(canvas);
  return {
    select(id, state) { selected = id; artState = state; show(); },
    play(on) {
      playing = on; clear(); previous = performance.now();
      renderer.setAnimationLoop(on ? frame : null);
      draw();
    },
  };
}
