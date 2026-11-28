import * as THREE from 'three';
import { generator, smoothNoise } from './random.js';
import { KINDS, plantFallen, makeLogs } from './birch-wood.js';
import { height } from './terrain.js';
import { tiles } from './surface.js';

// Местность вокруг двора по плану Никиты (2026-11-08). Двор — в середине, улица — к +z, всё в метрах двора.
// Сделано: берёзовая лесополоса за улицей (по фото Никиты из такой полосы). Полоса посажена на пологом валу;
// берёзы — рядами на гребнях старой вспашки, тесно, между гребнями борозды; посередине широкая просека; весь вал
// в кочках; у поля — канава. Дальше по плану: поле за канавой, сзади луг к речке и бор, по бокам соседи.
// Рельеф отдаёт dug(x, z) — на сколько вдавлено (минус — поднято), как улица в road.js; terrain.js складывает.
// Полоса подходит к самой улице (Никита 2026-11-10: на улицах-референсах берёзы ближе): вал поднимается сразу
// от дальнего края улицы verge(x), к полю сходит за slope метров.
const BELT = { from: 27, to: 43, rise: 0.45, slope: 3 };    // м: полоса по z, высота вала
// Ряды деревьев по z — по два с каждой стороны просеки; гребень под рядом и борозда между гребнями: высота и полуширина;
// как ряд виляет вдоль полосы (вспахано не по линейке).
export const ROWS = [28.5, 32, 37.5, 41];
const PLOW = { ridge: 0.09, furrow: 0.07, half: 1.1, wander: 0.35 };
const TUSSOCK = { size: 1.3, height: 0.07 };                // кочки от обочины до канавы: размер и высота
const DITCH = { z: 45.5, half: 1.3, depth: 0.3 };           // канава у поля: середина, полуширина, глубина

// Где в ряду пусто, берёза упала (Никита: в берёзовых посадках падают часто). Доля lying лежит целиком, сухая;
// остальные уже распилили: пень высотой stump, а там, куда падала, брёвна одной длины log в ряд, крону (taken —
// выше этой доли роста) увезли. Падают вдоль полосы, вбок — насколько пускает полоса: через улицу не ложатся.
const FELL = { lying: 0.5, kinds: [0, 1, 2, 3, 4, 5], log: [[1, 1.2], [1.8, 2.4]], stump: [0.15, 0.45], taken: 0.6 };
const REACH = 100;

// Роща видна через дорогу. Просветы в ближнем ряду открывают два следующих;
// разница глубин даёт сдвиг крон при ходьбе вдоль забора.
const PAINTED_ROWS = [
  { z: 28.5, height: 15, spacing: 22, tint: 0xf1efcf, ambient: 0x343929 },
  { z: 35.8, height: 17, spacing: 18, tint: 0xd2dfcd, ambient: 0x525f4e },
  { z: 42.2, height: 18, spacing: 17, tint: 0xb4c9cb, ambient: 0x67796f },
];
const beltMaps = tiles(['assets/textures/birch-belt-01.png', 'assets/textures/birch-belt-02.png']);
for (const map of beltMaps) map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
const beltMaterials = PAINTED_ROWS.map(({ tint, ambient }) => beltMaps.map(map =>
  new THREE.MeshLambertMaterial({ map, color: tint, emissive: ambient, alphaTest: 0.32, side: THREE.DoubleSide })));

// По одной сетке для каждой иллюстрации в ряду. Нижние углы следуют рельефу,
// а полоску травы внизу исходного рисунка отсекаем до наложения на землю.
function plantBelt(seed) {
  const group = new THREE.Group();
  group.name = 'birch-belt';
  const crop = 0.11;
  for (const [row, layer] of PAINTED_ROWS.entries()) {
    const rnd = generator(seed + 379 * (row + 1));
    const batches = beltMaps.map(() => ({ positions: [], uv: [], indices: [] }));
    for (let x = -REACH + rnd() * layer.spacing; x <= REACH; x += layer.spacing * (0.82 + rnd() * 0.36)) {
      const batch = batches[Math.floor(rnd() * batches.length)];
      const h = layer.height * (0.83 + rnd() * 0.32);
      const halfWidth = h * (4 / 3) * (0.93 + 0.14 * rnd()) / 2;
      const angle = (rnd() - 0.5) * 0.48;
      const z = layer.z + (rnd() - 0.5) * 1.4;
      const flip = rnd() < 0.5;
      const first = batch.positions.length / 3;
      for (const side of [-1, 1]) {
        const px = x + side * halfWidth * Math.cos(angle);
        const pz = z + side * halfWidth * Math.sin(angle);
        const base = height(px, pz) - 0.16;
        const u = (side > 0) !== flip ? 1 : 0;
        batch.positions.push(px, base, pz, px, base + h * (1 - crop), pz);
        batch.uv.push(u, crop, u, 1);
      }
      batch.indices.push(first, first + 1, first + 2, first + 2, first + 1, first + 3);
    }
    batches.forEach(({ positions, uv, indices }, variant) => {
      if (!indices.length) return;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      group.add(new THREE.Mesh(geometry, beltMaterials[row][variant]));
    });
  }
  return group;
}

const bump = (t) => (Math.abs(t) < 1 ? (1 - t * t) ** 2 : 0);

// verge(x) — z дальнего края улицы (road.js): сразу за ним трава сочная.
export function planLand(seed, verge) {
  const rnd = generator(seed + 53);
  const smooth = smoothNoise(rnd), noise = (x, z) => 2 * smooth(x, z) - 1;
  const s = THREE.MathUtils.smoothstep;
  // Вал: поднимается от края улицы до полосы и за ней за slope метров опускается к канаве.
  const bank = (x, z) => s(z, verge(x), BELT.from) * (1 - s(z, BELT.to, BELT.to + BELT.slope));
  // Середина k-го ряда (гребня) у x.
  const rowAt = (k, x) => ROWS[k] + PLOW.wander * noise(x / 13, 7 * k);
  // Гребни под рядами; между рядами одной пары и снаружи — борозды. Где пахали глубже, где мельче.
  const plow = (x, z) => {
    let h = 0;
    ROWS.forEach((row, k) => {
      const at = rowAt(k, x);
      h += PLOW.ridge * bump((z - at) / PLOW.half);
      for (const side of [-1, 1]) h -= PLOW.furrow * bump((z - at - side * 1.75) / (PLOW.half * 0.8));
    });
    return h * (0.7 + 0.3 * noise(x / 20, 3));
  };
  const dug = (x, z) => {
    const raised = bank(x, z) * (BELT.rise * (0.85 + 0.15 * noise(x / 30, 11)) + plow(x, z));
    const tussocks = TUSSOCK.height * s(noise(x / TUSSOCK.size, z / TUSSOCK.size + 40), 0.1, 0.9) * s(z - verge(x), 0.3, 1.5) * (1 - s(z, DITCH.z - 1, DITCH.z));
    return DITCH.depth * bump((z - DITCH.z) / DITCH.half) - raised - tussocks;
  };
  // За улицей вся трава сочная, как под берёзами (Никита 2026-11-09): трава двора с сорняками туда не заходит.
  const lush = (x, z) => s(z - verge(x), 0, 0.3);
  // На некоторых местах в посадке остались упавшие деревья, пни и брёвна.
  const gaps = [];
  ROWS.forEach((_, k) => {
    for (let x = -REACH; x < REACH; x += 1.8 + rnd() * 1.6) {
      if (rnd() < 0.12) gaps.push({ x, z: rowAt(k, x) });
      // Раньше для живого ствола выбирали вид, смещение, поворот и рост.
      // Сохраняем последовательность, чтобы пни и валежник знакомого двора остались на своих местах.
      else for (let i = 0; i < 4; i++) rnd();
    }
  });
  const fate = generator(seed + 61), range = ([a, b]) => a + fate() * (b - a), pick = (list) => list[Math.floor(fate() * list.length)];
  const fallen = [], cut = [];
  for (const { x, z } of gaps) {
    const kind = pick(FELL.kinds), scale = 1 + (fate() - 0.5) * 0.2, h = KINDS[kind] * scale;
    // Куда упала: вдоль полосы (along) и вбок на угол, при котором вершина остаётся между обочиной и канавой.
    const along = fate() < 0.5 ? -1 : 1, off = 2 * fate() - 1;
    const room = off > 0 ? DITCH.z - 1 - z : z - verge(x) - 0.5, angle = off * Math.asin(THREE.MathUtils.clamp(room / h, 0, 1));
    const dir = { x: along * Math.cos(angle), z: Math.sin(angle) };
    if (fate() < FELL.lying) fallen.push({ x, z, kind, scale, dir, spin: fate() * 2 * Math.PI });
    else {
      const stump = range(FELL.stump);
      cut.push({ x, z, h, dir, stump, logs: bucks(h, stump, range(pick(FELL.log)), range) });
    }
  }
  return { seed, dug, lush, fallen, cut };
}

// Распиленная берёза: брёвна по log метров от пня до taken роста, толщина как у ствола (R — 0,006 роста, комель
// толще). Лежат в ряд, куда падала, с зазорами, чуть вбок и вкось (range([a, b]) — случайное между a и b).
// at и side — метры от пня вдоль направления падения и поперёк, turn — поворот бревна.
function bucks(h, stump, log, range) {
  const r = (s) => 0.006 * h * (1 - s / h) ** 0.8 * (1 + 0.3 * Math.exp(-s / 0.4));
  const logs = [];
  for (let s = stump, at = 0.3; s + log < FELL.taken * h; s += log, at += log + range([0.05, 0.35])) {
    logs.push({ at, side: range([-0.15, 0.15]), turn: range([-0.2, 0.2]), r0: r(s), r1: r(s + log), length: log });
  }
  return logs;
}

// Строить после shapeGround: берёзы встают по земле, комель чуть в ней; упавшие и брёвна лежат на ней.
export function buildLand({ seed, fallen, cut }) {
  const UP = new THREE.Vector3(0, 1, 0);
  // Упавшая лежит от комля к вершине по земле; комель приподнят на свою толщину.
  const lying = fallen.map(({ x, z, kind, scale, dir, spin }) => {
    const h = KINDS[kind] * scale, y = height(x, z);
    const along = new THREE.Vector3(dir.x * h, height(x + dir.x * h, z + dir.z * h) - y, dir.z * h).normalize();
    const rotation = new THREE.Quaternion().setFromUnitVectors(UP, along).multiply(new THREE.Quaternion().setFromAxisAngle(UP, spin));
    return { x, y: y + 0.008 * h, z, kind, scale, rotation };
  });
  // Пень стоит; бревно лежит на земле своей серединой.
  const logs = cut.flatMap(({ x, z, h, dir, stump, logs }) => [
    { at: new THREE.Vector3(x, height(x, z) - 0.1, z), dir: UP, r0: 0.0075 * h, r1: 0.0075 * h, length: stump + 0.1 },
    ...logs.map(({ at, side, turn, r0, r1, length }) => {
      const d = new THREE.Vector3(dir.x, 0, dir.z).applyAxisAngle(UP, turn);
      const from = new THREE.Vector3(x + dir.x * at - dir.z * side, 0, z + dir.z * at + dir.x * side);
      const mid = from.clone().addScaledVector(d, length / 2);
      return { at: from.setY(height(mid.x, mid.z) + (r0 + r1) / 2), dir: d, r0, r1, length };
    })]);
  return new THREE.Group().add(plantBelt(seed), plantFallen(lying), makeLogs(logs, generator(seed + 67)));
}
