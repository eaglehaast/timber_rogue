import * as THREE from 'three';

export const EYE = 1.7, MOUSE = 0.0022;
export const FOV_MIN = 40, FOV_MAX = 75;
export function fieldOfView() {
  let angle = 55;
  try { angle = THREE.MathUtils.clamp(Number(localStorage.getItem('fov')) || angle, FOV_MIN, FOV_MAX); } catch {}
  return angle;
}
export const forwardOf = (yaw) => new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
export const makePlayer = () => ({ pos: new THREE.Vector3(0, 0, 4), yaw: 0, pitch: 0, bob: 0, gait: 0, step: new THREE.Vector3(), eye: EYE, crouch: false });
export function turnHead(player, dx, dy) {
  player.yaw -= dx;
  player.pitch = THREE.MathUtils.clamp(player.pitch - dy, -1.5, 1.5);
}
export function walkInput(keys, stick) {
  const side = Number(keys.has('KeyD')) - Number(keys.has('KeyA')) + stick.side;
  const ahead = Number(keys.has('KeyW')) - Number(keys.has('KeyS')) + stick.ahead;
  const length = Math.max(1, Math.hypot(side, ahead));
  return { side: side / length, ahead: ahead / length };
}
export const walkSpeed = (player, keys) => player.crouch ? 1.5 : keys.has('ShiftLeft') || keys.has('ShiftRight') ? 6 : 3;
export function stepEyes(player, right, speed, dt) {
  // Шаг длиной 75 см. Голова чуть опускается на каждом шаге и качается из стороны в сторону.
  player.gait += (speed / 3 - player.gait) * (1 - Math.exp(-6 * dt));
  player.bob += speed * dt * Math.PI / 0.75;
  const rise = 0.012 * player.gait;
  player.step.copy(right).multiplyScalar(Math.sin(player.bob) * rise / 2).setY(-rise * Math.sin(player.bob) ** 2);
  player.eye += ((player.crouch ? 1 : EYE) - player.eye) * (1 - Math.exp(-8 * dt));
}
export function eyeCamera(camera, player) {
  camera.position.copy(player.pos).add(player.step);
  camera.position.y += player.eye;
  camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
}
export function bindStick(el) {
  const state = { side: 0, ahead: 0 }, knob = el.firstElementChild;
  let pointer = null;
  function move(e) {
    if (e.pointerId !== pointer) return;
    const rect = el.getBoundingClientRect();
    const x = (e.clientX - rect.left - rect.width / 2) / (rect.width * .32);
    const y = (e.clientY - rect.top - rect.height / 2) / (rect.height * .32);
    const length = Math.max(1, Math.hypot(x, y));
    state.side = x / length;
    state.ahead = -y / length;
    knob.style.transform = `translate(${state.side * 65}%, ${-state.ahead * 65}%)`;
  }
  function stop() { pointer = null; state.side = state.ahead = 0; knob.style.transform = ''; }
  el.addEventListener('pointerdown', e => {
    if (pointer !== null || e.button !== 0) return;
    pointer = e.pointerId;
    el.setPointerCapture(pointer);
    move(e);
  });
  el.addEventListener('pointermove', move);
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(type, e => { if (e.pointerId === pointer) stop(); });
  addEventListener('blur', stop);
  return state;
}
