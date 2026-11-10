import * as THREE from 'three';
import { generator, smoothNoise } from './random.js';

// Земля не плоская. Высота — сумма трёх слоёв плавного шума (длина волны и размах в метрах): длинная волна —
// уклон участка, под каждым деревом свой скат в градус-два; средняя — пологие бугры; мелкая — кочки.
// Поверх — кротовины и ямки. Под тем, что стоит на земле (стволы, дом), земля ровная: дерево стоит на своей
// корневой шейке, и пилить у земли можно с любой стороны; площадку под дом выравнивают при стройке.
// За забором остаётся только длинная волна, а что там вдавлено или насыпано (улица, вал лесополосы), даёт carve.
// Рельеф задаёт shapeGround — свой у каждого запуска игры, по зерну его можно повторить. До неё земля ровная.
// Игра и стенд дома ставят по height(x, z) всё, что стоит на земле.
const WAVES = [[40, 0.5], [6, 0.05], [1.1, 0.015]];
const CALM = [0.8, 2];   // м от края ровной площадки: ближе земля ровная, дальше — весь рельеф
const EDGE = 2;          // м за краем участка, за которые мелкий рельеф сходит на нет
const BUMPS = 30;        // кротовин и ямок на участке
// м — шаг сетки земли: на участке, вокруг него до NEAR от середины (там ходят: улица, лесополоса) и дальше.
const FINE = 0.15, MID = 0.4, COARSE = 1, NEAR = 60;
const CARVED = 0.04;           // м — шаг рядов сетки в полосах rows, где вдавлены следы вдоль x

// noise — плавный шум −1..1 с ячейкой в единицу, свой у каждого рельефа; пока рельефа нет — null.
let noise = null, area = { w: 0, d: 0 }, bumps = [], flats = [], dug = () => 0, rows = [];
// Последняя построенная сетка земли: узлы по x и по z и высоты узлов — для groundAt.
let grid = null;

// Высота без ровных площадок у стволов.
function raw(x, z) {
  if (!noise) return 0;
  let h = WAVES[0][1] * noise(x / WAVES[0][0], z / WAVES[0][0]) - dug(x, z);
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

// Сколько от точки до ровной площадки f: прямоугольник w × d с серединой в (x, z), у ствола — точка.
const away = (f, x, z) => Math.hypot(Math.max(Math.abs(x - f.x) - (f.w ?? 0) / 2, 0), Math.max(Math.abs(z - f.z) - (f.d ?? 0) / 2, 0));

// Новый рельеф участка w × d метров с центром в начале координат. level — ровные площадки { x, z, w, d }:
// под стволом (w и d не нужны) и под домом. Высота площадки — высота земли в её середине.
// carve — что вдавлено в землю: dug(x, z) — на сколько метров (колея, ямы луж); rows — полосы по z [от, до],
// где у сетки земли частые ряды (там следы идут вдоль x).
export function shapeGround(seed, level, w, d, carve = { dug: () => 0, rows: [] }) {
  const rnd = generator(seed);
  const smooth = smoothNoise(rnd);
  noise = (x, z) => 2 * smooth(x, z) - 1;
  area = { w, d };
  ({ dug, rows } = carve);
  flats = [];
  bumps = [];
  while (bumps.length < BUMPS) {
    const x = (rnd() - 0.5) * w, z = (rnd() - 0.5) * d;
    if (level.some((f) => away(f, x, z) < CALM[1])) continue;
    // Кротовина — горка 6–10 см шириной в полметра, ямка — 5–10 см глубиной и 40–100 см шириной.
    bumps.push(rnd() < 0.4 ? { x, z, r: 0.25 + 0.1 * rnd(), h: 0.06 + 0.04 * rnd() } : { x, z, r: 0.2 + 0.3 * rnd(), h: -0.05 - 0.05 * rnd() });
  }
  flats = level.map((f) => ({ ...f, h: raw(f.x, f.z) }));
}

// Высота земли в точке (x, z) мира.
export function height(x, z) {
  let h = raw(x, z);
  for (const f of flats) {
    const d = away(f, x, z);
    if (d < CALM[1]) h = f.h + THREE.MathUtils.smoothstep(d, CALM[0], CALM[1]) * (h - f.h);
  }
  return h;
}

// Нормаль к земле в точке (x, z) — по разности высот в 5 см по обе стороны.
const E = 0.05;
export function normal(x, z, out = new THREE.Vector3()) {
  return out.set(height(x - E, z) - height(x + E, z), 2 * E, height(x, z - E) - height(x, z + E)).normalize();
}

// Сетка земли — квадрат со стороной size: на участке (и на EDGE за ним) шаг FINE, до NEAR — MID, дальше COARSE,
// в полосах rows ряды через CARVED. Узлы по x и по z — общие для всех рядов: сетка из прямоугольников, частая там, где ходят.
export function groundGeometry(size) {
  const ticks = (half, bands = []) => {
    const out = [];
    for (let s = -size / 2; s < -NEAR; s += COARSE) out.push(s);
    for (let s = -NEAR; s < -half; s += MID) out.push(s);
    for (let s = -half; s < half; s += FINE) out.push(s);
    for (let s = half; s < NEAR; s += MID) out.push(s);
    for (let s = NEAR; s < size / 2; s += COARSE) out.push(s);
    out.push(size / 2);
    const steps = ([a, b]) => Math.round((b - a) / CARVED);
    return [...out.filter((s) => !bands.some(([a, b]) => s >= a && s <= b)),
      ...bands.flatMap((band) => Array.from({ length: steps(band) + 1 }, (_, i) => band[0] + ((band[1] - band[0]) * i) / steps(band)))]
      .sort((a, b) => a - b);
  };
  const zs = ticks(area.d / 2 + EDGE, rows), xs = ticks(area.w / 2 + EDGE);
  const pos = new Float32Array(xs.length * zs.length * 3), uv = new Float32Array(xs.length * zs.length * 2), index = [];
  zs.forEach((z, j) => xs.forEach((x, i) => {
    const k = j * xs.length + i;
    pos.set([x, height(x, z), z], 3 * k);
    uv.set([0.5 + x / size, 0.5 - z / size], 2 * k);
    if (i && j) index.push(k - xs.length - 1, k - 1, k - xs.length, k - xs.length, k - 1, k);
  }));
  grid = { xs, zs, pos };
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

// Высота земли такой, какой её нарисовала сетка: по треугольнику сетки, а не по рельефу между её узлами.
// По ней кладут то, что лежит на земле плёнкой (грязь следов): сетка срезает ямки прямыми гранями,
// и плёнка по рельефу ушла бы под них. Строить после groundGeometry.
export function groundAt(x, z) {
  const { xs, zs, pos } = grid;
  const find = (ticks, v) => {
    let lo = 0, hi = ticks.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (ticks[mid] <= v) lo = mid; else hi = mid;
    }
    return lo;
  };
  const i = find(xs, x), j = find(zs, z), y = (a, b) => pos[3 * ((j + b) * xs.length + i + a) + 1];
  const fx = (x - xs[i]) / (xs[i + 1] - xs[i]), fz = (z - zs[j]) / (zs[j + 1] - zs[j]);
  // Клетка разрезана от (i + 1, j) к (i, j + 1), как в index выше.
  return fx + fz <= 1 ? y(0, 0) + fx * (y(1, 0) - y(0, 0)) + fz * (y(0, 1) - y(0, 0))
    : y(1, 1) + (1 - fx) * (y(0, 1) - y(1, 1)) + (1 - fz) * (y(1, 0) - y(1, 1));
}
