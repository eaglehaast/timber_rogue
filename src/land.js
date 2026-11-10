import * as THREE from 'three';
import { generator, smoothNoise } from './random.js';
import { KINDS, plantBirches, plantFallen, makeLogs } from './birch.js';
import { height } from './terrain.js';

// Местность вокруг двора по плану Никиты (2026-11-08), вся объёмом. Двор — в середине, улица — к +z, всё в метрах двора.
// Сделано: берёзовая лесополоса за улицей (по фото Никиты из такой полосы). Полоса посажена на пологом валу;
// берёзы — рядами на гребнях старой вспашки, тесно, между гребнями борозды; посередине широкая просека; весь вал
// в кочках; у поля — канава. Дальше по плану: поле за канавой, сзади луг к речке и бор, по бокам соседи.
// Рельеф отдаёт dug(x, z) — на сколько вдавлено (минус — поднято), как улица в road.js; terrain.js складывает.
const BELT = { from: 32, to: 48, rise: 0.45, slope: 3 };    // м: полоса по z, высота вала, на сколько метров он сходит
// Ряды деревьев по z — по два с каждой стороны просеки; гребень под рядом и борозда между гребнями: высота и полуширина;
// как ряд виляет вдоль полосы (вспахано не по линейке).
export const ROWS = [33.5, 37, 42.5, 46];
const PLOW = { ridge: 0.09, furrow: 0.07, half: 1.1, wander: 0.35 };
const TUSSOCK = { size: 1.3, height: 0.07 };                // кочки от обочины до канавы: размер и высота
const DITCH = { z: 50.5, half: 1.3, depth: 0.3 };           // канава у поля: середина, полуширина, глубина

// Берёзы (birch.js) — в ряду через step метров, чуть вбок от ряда (jitter), кое-где пропуск; kinds — какие виды
// и как часто (взрослых больше), рост вида гуляет на ±size.
const GROVE = { step: [1.8, 3.4], jitter: 0.35, gaps: 0.12, reach: 100, size: 0.1, kinds: [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7] };

// Где в ряду пусто, берёза упала (Никита: в берёзовых посадках падают часто). Доля lying лежит целиком, сухая;
// остальные уже распилили: пень высотой stump, а там, куда падала, брёвна одной длины log в ряд, крону (taken —
// выше этой доли роста) увезли. Падают вдоль полосы, вбок — насколько пускает полоса: через улицу не ложатся.
const FELL = { lying: 0.5, kinds: [0, 1, 2, 3, 4, 5], log: [[1, 1.2], [1.8, 2.4]], stump: [0.15, 0.45], taken: 0.6 };
// Подрост — молодые берёзки (последние виды KINDS) около рядов: по одной на per м² полосы, до reach м от ряда.
const UNDER = { kinds: [8, 9, 10], per: 8, reach: 2.2 };

const bump = (t) => (Math.abs(t) < 1 ? (1 - t * t) ** 2 : 0);

// verge(x) — z дальнего края улицы (road.js): сразу за ним трава сочная.
export function planLand(seed, verge) {
  const rnd = generator(seed + 53);
  const smooth = smoothNoise(rnd), noise = (x, z) => 2 * smooth(x, z) - 1;
  const s = THREE.MathUtils.smoothstep;
  // Вал: поднимается за slope метров до полосы и опускается за ней к канаве.
  const bank = (z) => s(z, BELT.from - BELT.slope, BELT.from) * (1 - s(z, BELT.to, BELT.to + BELT.slope));
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
    const raised = BELT.rise * bank(z) * (0.85 + 0.15 * noise(x / 30, 11)) + bank(z) * plow(x, z);
    const tussocks = TUSSOCK.height * s(noise(x / TUSSOCK.size, z / TUSSOCK.size + 40), 0.1, 0.9) * s(z, BELT.from - 6, BELT.from - 2) * (1 - s(z, DITCH.z - 1, DITCH.z));
    return DITCH.depth * bump((z - DITCH.z) / DITCH.half) - raised - tussocks;
  };
  // За улицей вся трава сочная, как под берёзами (Никита 2026-11-09): трава двора с сорняками туда не заходит.
  const lush = (x, z) => s(z - verge(x), 0, 0.3);
  // Берёзы по рядам: { x, z, kind, turn, scale } — место, вид, поворот и рост.
  const birches = [], gaps = [];
  ROWS.forEach((_, k) => {
    for (let x = -GROVE.reach; x < GROVE.reach; x += GROVE.step[0] + rnd() * (GROVE.step[1] - GROVE.step[0])) {
      if (rnd() < GROVE.gaps) {
        gaps.push({ x, z: rowAt(k, x) });
        continue;
      }
      const kind = GROVE.kinds[Math.floor(rnd() * GROVE.kinds.length)];
      birches.push({ x, z: rowAt(k, x) + (rnd() - 0.5) * 2 * GROVE.jitter, kind, turn: rnd() * 2 * Math.PI, scale: 1 + (rnd() - 0.5) * 2 * GROVE.size });
    }
  });
  // Судьба пустых мест и подрост — своим генератором: ряды от них не меняются.
  const fate = generator(seed + 61), range = ([a, b]) => a + fate() * (b - a), pick = (list) => list[Math.floor(fate() * list.length)];
  const fallen = [], cut = [];
  for (const { x, z } of gaps) {
    const kind = pick(FELL.kinds), scale = 1 + (fate() - 0.5) * 2 * GROVE.size, h = KINDS[kind] * scale;
    // Куда упала: вдоль полосы (along) и вбок на угол, при котором вершина остаётся между обочиной и канавой.
    const along = fate() < 0.5 ? -1 : 1, off = 2 * fate() - 1;
    const room = off > 0 ? DITCH.z - 1 - z : z - (BELT.from - 3), angle = off * Math.asin(THREE.MathUtils.clamp(room / h, 0, 1));
    const dir = { x: along * Math.cos(angle), z: Math.sin(angle) };
    if (fate() < FELL.lying) fallen.push({ x, z, kind, scale, dir, spin: fate() * 2 * Math.PI });
    else {
      const stump = range(FELL.stump);
      cut.push({ x, z, h, dir, stump, logs: bucks(h, stump, range(pick(FELL.log)), range) });
    }
  }
  const saplings = Array.from({ length: Math.round((2 * GROVE.reach * (BELT.to - BELT.from)) / UNDER.per) }, () => {
    const k = Math.floor(fate() * ROWS.length), x = (2 * fate() - 1) * GROVE.reach;
    return { x, z: rowAt(k, x) + (2 * fate() - 1) * UNDER.reach, kind: pick(UNDER.kinds), turn: fate() * 2 * Math.PI, scale: 1 + (fate() - 0.5) * 0.4 };
  });
  return { seed, dug, lush, birches, saplings, fallen, cut };
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
export function buildLand({ seed, birches, saplings, fallen, cut }) {
  const UP = new THREE.Vector3(0, 1, 0);
  const standing = [...birches, ...saplings].map((b) => ({ ...b, y: height(b.x, b.z) - 0.05 }));
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
  return new THREE.Group().add(plantBirches(standing), plantFallen(lying), makeLogs(logs, generator(seed + 67)));
}
