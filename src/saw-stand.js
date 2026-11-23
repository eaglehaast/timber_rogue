import { PHONE } from './device.js';
import { makeHeldSaw } from './held-saw.js';

async function start() {
  const gas = document.querySelector('#gas'), status = document.querySelector('#status');
  const lengths = document.querySelectorAll('[data-length]'), views = document.querySelectorAll('[data-view]');
  const labels = { idle: 'Цепь стоит', running: 'Цепь движется', coasting: 'Цепь тормозит' };
  const triggers = ['rest', 'down'].map(state => {
    const img = new Image();
    img.alt = ''; img.draggable = false;
    img.src = 'assets/hud/saw-bench/trigger-' + state + '.webp';
    return img;
  });
  gas.append(...triggers);
  const backdrop = document.querySelector('#yard-backdrop');
  backdrop.src = 'assets/hud/saw-bench/yard.webp';
  const [saw] = await Promise.all([
    makeHeldSaw(document.querySelector('#rig'), state => {
      gas.setAttribute('aria-pressed', String(state === 'running'));
      status.textContent = labels[state];
    }), ...[...triggers, backdrop].map(img => img.decode()),
  ]);
  let pointer = null, space = false;
  const throttle = () => saw.setThrottle(pointer !== null || space);
  function cancel() {
    const captured = pointer;
    pointer = null; space = false;
    if (captured !== null && gas.hasPointerCapture(captured)) gas.releasePointerCapture(captured);
    saw.stop();
  }
  for (const button of lengths) button.addEventListener('click', () => {
    cancel(); saw.setLength(Number(button.dataset.length));
    for (const item of lengths) item.setAttribute('aria-pressed', String(item === button));
  });
  for (const button of views) button.addEventListener('click', () => {
    document.querySelector('#stage').classList.toggle('yard', button.dataset.view === 'yard');
    for (const item of views) item.setAttribute('aria-pressed', String(item === button));
  });
  gas.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0 || pointer !== null) return;
    event.preventDefault(); pointer = event.pointerId;
    gas.focus({ preventScroll: true }); gas.setPointerCapture(pointer); throttle();
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) gas.addEventListener(type, event => {
    if (event.pointerId === pointer) { pointer = null; throttle(); }
  });
  addEventListener('keydown', event => {
    if (event.code !== 'Space' || event.altKey || event.ctrlKey || event.metaKey || event.target.closest('a')) return;
    event.preventDefault();
    if (!event.repeat) { space = true; throttle(); }
  });
  addEventListener('keyup', event => {
    if (event.code === 'Space') { space = false; throttle(); }
  });
  addEventListener('blur', cancel);
  addEventListener('pagehide', cancel);
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(); });
  gas.disabled = false;
}

if (PHONE) location.replace('./#stands');
else start().catch(error => { document.querySelector('#status').textContent = 'Не удалось открыть рисунки пилы. ' + error.message; });
