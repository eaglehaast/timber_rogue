import * as THREE from 'three';
import { generator, smoothNoise } from './random.js';
import { plantBirches } from './birch.js';
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
const VERGE = 26;                                          // м: дальняя обочина улицы, за ней трава сочная

// Берёзы (birch.js) — в ряду через step метров, чуть вбок от ряда (jitter), кое-где пропуск; kinds — какие виды
// и как часто (взрослых больше), рост вида гуляет на ±size.
const GROVE = { step: [1.8, 3.4], jitter: 0.35, gaps: 0.08, reach: 100, size: 0.1, kinds: [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7] };

const bump = (t) => (Math.abs(t) < 1 ? (1 - t * t) ** 2 : 0);

export function planLand(seed) {
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
  const lush = (x, z) => s(z, VERGE, VERGE + 1.5);
  // Берёзы по рядам: { x, z, kind, turn, scale } — место, вид, поворот и рост.
  const birches = [];
  ROWS.forEach((_, k) => {
    for (let x = -GROVE.reach; x < GROVE.reach; x += GROVE.step[0] + rnd() * (GROVE.step[1] - GROVE.step[0])) {
      if (rnd() < GROVE.gaps) continue;
      const kind = GROVE.kinds[Math.floor(rnd() * GROVE.kinds.length)];
      birches.push({ x, z: rowAt(k, x) + (rnd() - 0.5) * 2 * GROVE.jitter, kind, turn: rnd() * 2 * Math.PI, scale: 1 + (rnd() - 0.5) * 2 * GROVE.size });
    }
  });
  return { seed, dug, lush, birches };
}

// Строить после shapeGround: берёзы встают по земле, комель чуть в ней.
export function buildLand({ birches }) {
  return plantBirches(birches.map((b) => ({ ...b, y: height(b.x, b.z) - 0.05 })));
}
