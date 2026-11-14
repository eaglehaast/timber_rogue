import * as THREE from 'three';
import { generator, smoothNoise } from './random.js';
import { tiles, soften } from './surface.js';
import { height } from './terrain.js';
import { atlas, makeTufts } from './grass.js';

// Сено на пойменном лугу за речкой (Никита, 2026-11-13): стог и рядом копны. Объём — кодом, бок — плитки
// ChatGPT 1 × 1 м (tools/hills.py → hay.jpg, свежее сено). Плитки идут по кругу и вверх по боку: стебли на картинке
// наискось сверху вниз, к макушке они сходятся. Из бока торчат клочья сена (пучки hay-tufts): без них ровный силуэт
// читается валуном. У подножия клочья лежат, луг вокруг выкошен.
// Стог 3–4 м, шире всего на трети высоты, макушка острая; копна 1,2–1,8 м, макушка покруглее (top — показатель
// сужения к макушке: больше — острее). Ставим туда, где пойма между водой и подножием холма шире всего.
const STACK = { h: [3, 4], r: [1.4, 1.8], top: 1.3 }, COCK = { h: [1.2, 1.8], r: [0.9, 1.2], top: 1 };
const LUMPS = 0.07;               // доля радиуса: бугры на боку
const RINGS = 18, SIDES = 32;
const SPOT = 30, BANK = 13;       // м: где искать место — по x от середины двора; от оси реки до сухого луга
// Торчащие клочья: штук на м радиуса × м высоты, рост, насколько свисают; клетки атласа — пышные клочья (1 и 3 плоские);
// tint — клочья на картинке рыжее плиток бока.
const STRAW = { per: 30, size: [0.4, 0.7], droop: 0.6, cells: [0, 2], tint: [0.95, 0.9, 0.8] };
const CLUMPS = { reach: 1.5, size: 120, per: 4000 };      // клочья у подножия: на сколько м от бока, квадрат и попыток на 1000 м²
const MOWN = 4;                   // м от бока кучи: луг выкошен, трава низкая
// Свет мягче, чем у гладкого тела: сено рыхлое, свет уходит вглубь, теневой бок не чернеет и не синеет от неба.
// Нормали бока наклонены к небу на SOFT. Клочья тонкие и светятся — их нормали ещё ближе к небу.
const SOFT = 0.8;

const material = soften(new THREE.MeshLambertMaterial({ map: tiles(['assets/textures/hay.jpg'])[0] }), {
  contrast: 1.4, saturation: 1.1, scales: [0.3, 1], low: [1.1, 1.05, 0.9], high: [1.3, 1.2, 1], cells: [3, 1] });
const CLUMP = await atlas('hay-tufts'), UP = new THREE.Vector3(0, 1, 0);
const strawMaterial = new THREE.MeshLambertMaterial({ map: CLUMP.material.map, alphaTest: 0.5, color: new THREE.Color(...STRAW.tint) });

// river — где ось реки (center), hills — где подножие холма (foot).
export function planHay(seed, river, hills) {
  const rnd = generator(seed + 71), pick = ([a, b]) => a + rnd() * (b - a), s = THREE.MathUtils.smoothstep;
  let x = 0, room = -Infinity;
  for (let a = -SPOT; a <= SPOT; a++) {
    const w = river.center(a) - BANK - hills.foot(a);
    if (w > room) [room, x] = [w, a];
  }
  const z = (river.center(x) - BANK + hills.foot(x)) / 2;
  const heaps = [{ x, z, ...STACK, h: pick(STACK.h), r: pick(STACK.r) }];
  // Копны по бокам стога: обе или одна.
  const one = rnd() < 0.5 ? [-1] : [1];
  for (const side of rnd() < 0.4 ? one : [-1, 1]) {
    heaps.push({ x: x + side * pick([4, 7]), z: z + pick([-1.5, 1.5]), ...COCK, h: pick(COCK.h), r: pick(COCK.r) });
  }
  for (const h of heaps) Object.assign(h, { turn: rnd() * 2 * Math.PI, k: rnd() * 50 });
  // Сколько метров от точки до бока ближайшей кучи (внутри — меньше нуля).
  const gap = (px, pz) => heaps.reduce((m, h) => Math.min(m, Math.hypot(px - h.x, pz - h.z) - h.r), Infinity);
  return {
    heaps, gap, noise: smoothNoise(rnd),
    bare: (px, pz) => (gap(px, pz) < 0.2 ? 1 : 0),       // под кучей трава луга не растёт
    mown: (px, pz) => 1 - s(gap(px, pz), 0, MOWN),       // для trodden луга: вокруг кучи трава низкая
  };
}

// Бок кучи: кольца снизу вверх, на высоте v (0..1) радиус r · (1 − v²)^top · (0,85 + 0,8 v) — у земли чуть уже,
// шире всего на трети высоты, к макушке сходится в точку. Бугры — плавный шум по кругу и высоте.
// По кругу целое число плиток, чтобы на шве плитка не обрывалась; вверх — по длине бока.
function heap({ x, z, h, r, top, turn, k }, noise) {
  const y0 = Math.min(...[[1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) => height(x + a * r, z + b * r))) - 0.05;
  const round = Math.max(2, Math.round(2 * Math.PI * r)), pos = [], uv = [], index = [];
  let arc = 0, prev = null;
  for (let i = 0; i <= RINGS; i++) {
    const v = i / RINGS, rv = r * (1 - v * v) ** top * (0.85 + 0.8 * v), y = y0 + v * h;
    if (prev) arc += Math.hypot(rv - prev[0], y - prev[1]);
    prev = [rv, y];
    for (let j = 0; j <= SIDES; j++) {
      const az = (j / SIDES) * 2 * Math.PI + turn, lump = 1 + LUMPS * (2 * noise(3 * Math.cos(az) + k, 3 * Math.sin(az) + 2 * v * h) - 1);
      pos.push(x + rv * lump * Math.cos(az), y, z + rv * lump * Math.sin(az));
      uv.push((j / SIDES) * round, arc);
      if (i && j) {
        const c = i * (SIDES + 1) + j, p = c - SIDES - 1;
        index.push(p - 1, c - 1, p, p, c - 1, c);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const n = geometry.attributes.normal, bent = new THREE.Vector3();
  for (let i = 0; i < n.count; i++) n.setXYZ(i, ...bent.fromBufferAttribute(n, i).addScaledVector(UP, SOFT).normalize().toArray());
  return geometry;
}

// Торчащие клочья: пучок-картинка основанием в бок кучи, растёт наружу и свисает вниз по склону. Плоскость пучка —
// вдоль склона (через макушку), поэтому спереди он виден ребром, а с краёв кучи ложится на силуэт рваной бахромой.
// Изнанка — свои треугольники с той же нормалью, как у пучков травы (grass.js): у DoubleSide она темнела бы.
// Точки — по четырёхугольникам сетки бока, со случайным сдвигом внутри.
function straw(geometry, { h, r }, pos, normal, uv, index) {
  const P = geometry.attributes.position, N = geometry.attributes.normal, row = SIDES + 1;
  const { cols, rows, aspect } = CLUMP;
  const corner = (A, i, j) => new THREE.Vector3().fromBufferAttribute(A, i * row + j);
  const mix = (A, i, j, s, t) => corner(A, i, j).lerp(corner(A, i, j + 1), s).lerp(corner(A, i + 1, j).lerp(corner(A, i + 1, j + 1), s), t);
  for (let c = Math.round(STRAW.per * r * h); c > 0; c--) {
    const i = 1 + Math.floor(Math.random() * (RINGS - 2)), j = Math.floor(Math.random() * SIDES), s = Math.random(), t = Math.random();
    const n = mix(N, i, j, s, t).normalize(), slope = corner(P, i + 1, j).sub(corner(P, i, j)).normalize();
    const base = mix(P, i, j, s, t).addScaledVector(n, -0.05);
    const out = n.clone().addScaledVector(slope, -STRAW.droop).normalize(), turn = Math.random() - 0.5;
    const across = slope.multiplyScalar(Math.cos(turn)).addScaledVector(new THREE.Vector3().crossVectors(n, slope).normalize(), Math.sin(turn));
    const tall = STRAW.size[0] + Math.random() * (STRAW.size[1] - STRAW.size[0]), half = (tall * aspect) / 2;
    const cell = STRAW.cells[Math.floor(Math.random() * STRAW.cells.length)], u0 = (cell % cols) / cols, v0 = 1 - (Math.floor(cell / cols) + 1) / rows;
    const k = pos.length / 3, lit = n.clone().add(UP).normalize();
    for (const [a, b] of [[-1, 0], [1, 0], [-1, 1], [1, 1]]) {
      pos.push(...base.clone().addScaledVector(across, a * half).addScaledVector(out, b * tall).toArray());
      normal.push(...lit.toArray());
      uv.push(u0 + ((a + 1) / 2) / cols, v0 + b / rows);
    }
    index.push(k, k + 1, k + 2, k + 2, k + 1, k + 3, k, k + 2, k + 1, k + 2, k + 3, k + 1);
  }
}

// Строить после shapeGround.
export function buildHay(hay) {
  const group = new THREE.Group(), pos = [], normal = [], uv = [], index = [];
  for (const h of hay.heaps) {
    const geometry = heap(h, hay.noise), mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    straw(geometry, h, pos, normal, uv, index);
  }
  const wisps = new THREE.BufferGeometry();
  wisps.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  wisps.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  wisps.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  wisps.setIndex(index);
  const fringe = new THREE.Mesh(wisps, strawMaterial);
  fringe.castShadow = fringe.receiveShadow = true;
  const near = (x, z) => { const d = hay.gap(x, z); return d < 0 ? 0 : 1 - THREE.MathUtils.smoothstep(d, 0, CLUMPS.reach); };
  return group.add(fringe, makeTufts(CLUMP, Math.round((CLUMPS.per * CLUMPS.size ** 2) / 1000), CLUMPS.size, near));
}
