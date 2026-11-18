import * as THREE from 'three';
import { generator } from './random.js';

// Земля не плоская. Высота — сумма трёх слоёв плавного шума (длина волны и размах в метрах): длинная волна —
// уклон участка, под каждым деревом свой скат в градус-два; средняя — пологие бугры; мелкая — кочки.
// Поверх — кротовины и ямки. У ствола земля ровная: дерево стоит на своей корневой шейке, и пилить у земли
// можно с любой стороны. За забором остаётся только длинная волна: там не ходят, и сетка земли редкая.
// Рельеф свой у каждого запуска игры; по зерну из отчёта сторожа его можно повторить.
const WAVES = [[40, 0.5], [6, 0.05], [1.1, 0.015]];
const CALM = [0.8, 2];   // м от оси ствола: ближе земля ровная, дальше — весь рельеф
const EDGE = 2;          // м за краем участка, за которые мелкий рельеф сходит на нет
const BUMPS = 30;        // кротовин и ямок на участке
const FINE = 0.15, COARSE = 2; // м — шаг сетки земли на участке и за ним

let salt = 0, area = { w: 0, d: 0 }, bumps = [], calm = [];

const hash = (i, j) => { const h = Math.sin(i * 127.1 + j * 311.7 + salt) * 43758.5453; return h - Math.floor(h); };
// Плавный шум −1..1 с ячейкой в единицу.
function noise(x, z) {
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash(i, j) + (hash(i + 1, j) - hash(i, j)) * sx, b = hash(i, j + 1) + (hash(i + 1, j + 1) - hash(i, j + 1)) * sx;
  return 2 * (a + (b - a) * sz) - 1;
}

// Высота без ровных площадок у стволов.
function raw(x, z) {
  let h = WAVES[0][1] * noise(x / WAVES[0][0], z / WAVES[0][0]);
  const out = Math.max(Math.abs(x) - area.w / 2, Math.abs(z) - area.d / 2);
  const near = 1 - THREE.MathUtils.smoothstep(out, 0, EDGE);
  if (!near) return h;
  let fine = 0;
  for (let k = 1; k < WAVES.length; k++) fine += WAVES[k][1] * noise(x / WAVES[k][0] + 37 * k, z / WAVES[k][0]);
  // Кротовина и ямка — купол (1 − d²/r²)²: края сходят в землю без ступеньки.
  for (const b of bumps) {
    const t = 1 - ((x - b.x) ** 2 + (z - b.z) ** 2) / b.r ** 2;
    if (t > 0) fine += b.h * t * t;
  }
  return h + near * fine;
}

// Новый рельеф участка w × d метров с центром в начале координат; trees — где стоят стволы ({ x, z }).
export function shapeGround(seed, trees, w, d) {
  const rnd = generator(seed);
  salt = rnd() * 1000;
  area = { w, d };
  calm = [];
  bumps = [];
  while (bumps.length < BUMPS) {
    const x = (rnd() - 0.5) * w, z = (rnd() - 0.5) * d;
    if (trees.some((t) => Math.hypot(x - t.x, z - t.z) < CALM[1])) continue;
    // Кротовина — горка 6–10 см шириной в полметра, ямка — 5–10 см глубиной и 40–100 см шириной.
    bumps.push(rnd() < 0.4 ? { x, z, r: 0.25 + 0.1 * rnd(), h: 0.06 + 0.04 * rnd() } : { x, z, r: 0.2 + 0.3 * rnd(), h: -0.05 - 0.05 * rnd() });
  }
  calm = trees.map((t) => ({ ...t, h: raw(t.x, t.z) }));
}

// Высота земли в точке (x, z) мира.
export function height(x, z) {
  let h = raw(x, z);
  for (const t of calm) {
    const d = Math.hypot(x - t.x, z - t.z);
    if (d < CALM[1]) h = t.h + THREE.MathUtils.smoothstep(d, CALM[0], CALM[1]) * (h - t.h);
  }
  return h;
}

// Нормаль к земле в точке (x, z) — по разности высот в 5 см по обе стороны.
const E = 0.05;
export function normal(x, z, out = new THREE.Vector3()) {
  return out.set(height(x - E, z) - height(x + E, z), 2 * E, height(x, z - E) - height(x, z + E)).normalize();
}

// Сетка земли — квадрат со стороной size: на участке (и на EDGE за ним) шаг FINE, дальше COARSE.
// Узлы по x и по z — общие для всех рядов: сетка из прямоугольников, частая там, где ходят.
export function groundGeometry(size) {
  const ticks = (half) => {
    const out = [];
    for (let s = -size / 2; s < -half; s += COARSE) out.push(s);
    for (let s = -half; s < half; s += FINE) out.push(s);
    for (let s = half; s < size / 2; s += COARSE) out.push(s);
    out.push(size / 2);
    return out;
  };
  const xs = ticks(area.w / 2 + EDGE), zs = ticks(area.d / 2 + EDGE);
  const pos = new Float32Array(xs.length * zs.length * 3), uv = new Float32Array(xs.length * zs.length * 2), index = [];
  zs.forEach((z, j) => xs.forEach((x, i) => {
    const k = j * xs.length + i;
    pos.set([x, height(x, z), z], 3 * k);
    uv.set([0.5 + x / size, 0.5 - z / size], 2 * k);
    if (i && j) index.push(k - xs.length - 1, k - 1, k - xs.length, k - xs.length, k - 1, k);
  }));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}
