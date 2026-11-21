import { readFileSync } from 'fs';
// Мок браузера: Image грузит файл с диска, canvas — заглушка. Так проверяется весь импорт paths.js,
// включая реальный THREE.TextureLoader (в node он тоже идёт через FileLoader + Image).
globalThis.window = globalThis;
globalThis.HTMLCanvasElement = class {};
const doc = { createElement: () => new FakeImage(), createElementNS: () => new FakeImage(), addEventListener() {} };
globalThis.document = doc;
class FakeImage {
  constructor() { this._w = 0; this._h = 0; }
  addEventListener(name, fn) { this['on' + name] = fn; }
  get src() { return this._src; }
  set src(url) {
    const data = readFileSync('/workspace/' + url.replace(/^\.\//, '')); // 404 упадёт здесь — как onError в браузере
    this.width = this._w = 64; this.height = this._h = 64; this.complete = true;
    setTimeout(() => this.onload?.(), 0);
  }
}
globalThis.Image = FakeImage;
globalThis.createImageBitmap = async () => ({ width: 64, height: 64, close() {} });
globalThis.navigator = { userAgent: 'node', maxTouchPoints: 0 };
globalThis.location = { search: '' };
globalThis.matchMedia = () => ({ matches: true });
try {
  const paths = await import('/workspace/src/paths.js');
  console.log('import ok:', Object.keys(paths));
  const p = paths.planPaths({ seed: 1, from: { x: 9.2, z: 19.5 }, porch: { x: 3.0, z: 8.0 }, pad: { x: 14.0, z: 12.0 }, gate: { x: 10.3, z: 20 } });
  console.log('planPaths ok; grass on path=', p.grass(6.1, 13.7).toFixed(2), 'far=', p.grass(0, 0));
  const g = p.build();
  console.log('build ok, children:', g.children.length, 'verts:', g.children.map(c => c.geometry.attributes.position.count).join(','));
} catch (e) { console.error('FAIL:', e); process.exit(1); }
