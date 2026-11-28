import assert from 'node:assert/strict';
import { PerformanceMonitor, showPerformancePanel } from './src/performance.js';

let time = 0;
const monitor = new PerformanceMonitor(() => time);
monitor.measure('build', () => { time += 250; });
await monitor.measureAsync('load', async () => { time += 500; });
assert.deepEqual([...monitor.stages], [['build', 250], ['load', 500]]);
const stats = { calls: 10, triangles: 100, geometries: 3, textures: 4 };
const parts = { game: 3, world: 1, render: 10, rays: 2 };
monitor.frame(1000, parts, stats);
monitor.frame(1016, parts, stats);
monitor.frame(1136, { ...parts, render: 1 }, stats);
assert.equal(monitor.snapshot().freezes, 1);
assert.equal(monitor.snapshot().worst, 120);
assert.equal(monitor.snapshot().lastSpike.parts.render, 10, 'пауза относится к предыдущему кадру');
monitor.frame(1200, parts, stats, false);
monitor.frame(2000, parts, stats);
assert.equal(monitor.snapshot().freezes, 1, 'скрытая вкладка не считается фризом');
monitor.frame(12000, parts, stats);
assert.equal(monitor.snapshot().freezes, 0, 'старые кадры не остаются в окне измерения');
const summary = {}, content = {}, listeners = {};
const panel = { hidden: true, querySelector: (selector) => selector === 'summary' ? summary : content };
globalThis.document = { querySelector: () => panel, addEventListener: (name, fn) => { listeners[name] = fn; } };
globalThis.addEventListener = (name, fn) => { listeners[name] = fn; };
const originalInterval = globalThis.setInterval, originalClear = globalThis.clearInterval;
globalThis.setInterval = (fn) => { listeners.update = fn; return 1; };
globalThis.clearInterval = () => {};
try {
  const ui = showPerformancePanel(monitor);
  assert.equal(panel.hidden, false);
  assert.match(summary.textContent, /load 0\.5 с/);
  ui.ready();
  monitor.frame(12016, parts, stats);
  listeners.update();
  assert.match(summary.textContent, /FPS/);
  assert.match(content.textContent, /Вызовы рисования: 10/);
  assert.match(content.textContent, /не время GPU/);
  listeners.visibilitychange();
  assert.equal(monitor.lastFrame, null);
} finally {
  globalThis.setInterval = originalInterval;
  globalThis.clearInterval = originalClear;
}
console.log('performance checks ok');
