import { showAction } from './hud-layout.js';
import * as THREE from 'three';
import { MOUSE, fieldOfView, makePlayer, forwardOf, turnHead, walkInput, walkSpeed, stepEyes, eyeCamera, bindStick } from './player.js';

// Этот стенд не импортирует двор или физику дерева. Общие с игрой здесь глаза,
// походка, круг движения и настоящие элементы экранного интерфейса.
export function makePreview() {
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
  el('hint').textContent = 'Падает! Отойди!';
  el('gap').textContent = 'Щель 8 мм';
  el('log').textContent = 'Щель сужается';
  el('result').textContent = 'Дерево легло';
  el('depthFill').style.width = '45%';
  el('hud').classList.add('details');
  el('hud').hidden = false;
  let playing = false, selected = 'held-saw', slot = 0, pressed = false, actionPointer = null, lookPointer = null, previous = 0;
  function show() {
    saw.hidden = playing && slot === 2;
    saw.classList.toggle('short-bar', playing && slot === 1);
    saw.classList.toggle('running', playing && pressed && slot !== 2);
    const hasSaw = !playing || slot !== 2;
    showAction(action, hasSaw ? 'Газ' : 'Взять', hasSaw, pressed);
    slots.forEach((el, i) => el.setAttribute('aria-pressed', i === slot));
    for (const id of contextual) el(id).hidden = playing || selected !== id;
  }
  function take(i) { slot = i; release(); }
  function release() { pressed = false; actionPointer = null; show(); }
  slots.forEach((el, i) => el.addEventListener('click', () => { if (playing) take(i); }));
  action.addEventListener('pointerdown', e => {
    if (!playing || e.button !== 0 || actionPointer !== null) return;
    actionPointer = e.pointerId;
    action.setPointerCapture(e.pointerId);
    pressed = true;
    show();
  });
  for (const type of ['pointerup','pointercancel','lostpointercapture']) action.addEventListener(type, e => { if (actionPointer === e.pointerId) release(); });
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
    keys.add(e.code);
    if (/^Digit[1-3]$/.test(e.code)) take(Number(e.code.at(-1)) - 1);
    if (e.code === 'KeyC' && !e.repeat) player.crouch = !player.crouch;
    if (e.code === 'Space') { e.preventDefault(); pressed = true; show(); }
  });
  addEventListener('keyup', e => { keys.delete(e.code); if (e.code === 'Space') release(); });
  function clear() { keys.clear(); lookPointer = null; release(); }
  addEventListener('blur', clear);
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
    select(id) { selected = id; show(); },
    play(on) {
      playing = on; clear(); previous = performance.now();
      renderer.setAnimationLoop(on ? frame : null);
      draw();
    },
  };
}
