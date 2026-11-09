import * as THREE from 'three';
import { generator, smoothNoise } from './random.js';
import { plantPines } from './pine.js';
import { height } from './terrain.js';

// Сосновый бор сзади двора (−z) по плану Никиты (2026-11-08). От забора луг сходит в низину — там потом будет
// речка (её делает ChatGPT, пока низина пустая), за низиной песчаный берег поднимается уступом, на нём бор.
// Бор старый и густой: стволы внизу голые, кроны сомкнуты наверху, за ним ничего не видно. Земля в бору
// неровная — дюны, бугры и кочки у корней, — и усыпана хвоей, травы почти нет. На опушке сосны ниже и
// ветвистее, а перед ними, на лугу, пробивается подрост — сосенки от вершка до двух метров.
// Всё в метрах двора: dug(x, z) — на сколько вдавлено (минус — поднято), как в land.js.
const LOW = { z: -31, half: 7, depth: 0.8 };         // низина под речку: середина, полуширина, глубина
const BANK = { from: -36, to: -43, rise: 1.4 };       // уступ берега к бору: где начинается и кончается, высота
const EDGE = { z: -41, wander: 3, size: 25 };         // опушка: середина, на сколько виляет, длина волны
const DUNES = [[24, 0.8], [8, 0.3], [1.7, 0.08]];     // рельеф бора: длина волны и размах, м
const FAR = { x: 105, z: -100 };                      // докуда сажать: дальше не ходят (BOUND стенда)
// Посадка в клетках сетки со стороной cell, по сосне в клетке со сдвигом; empty — доля пустых клеток.
// Подрост — на лугу перед опушкой (до 6 м) и в первых метрах бора, гуще у самой опушки.
const STANDS = [
  { from: 7, to: Infinity, cell: 3.3, empty: 0.12, kinds: [0, 0, 1, 1, 1, 2, 2, 3, 3, 5, 6] }, // бор, кое-где второй ярус
  { from: 0, to: 7, cell: 3.6, empty: 0.15, kinds: [4, 4, 4, 5, 5, 6] },                        // опушка
  { from: -6, to: 2, cell: 1.6, empty: 0.55, kinds: [8, 8, 9, 9, 9, 10, 10, 10, 7] },           // подрост
];

const bump = (t) => (Math.abs(t) < 1 ? (1 - t * t) ** 2 : 0);

export function planForest(seed) {
  const rnd = generator(seed + 71);
  const smooth = smoothNoise(rnd), noise = (x, z) => 2 * smooth(x, z) - 1;
  const s = THREE.MathUtils.smoothstep;
  // Сколько метров от опушки вглубь бора (до неё — минус).
  const edge = (x) => EDGE.z + EDGE.wander * noise(x / EDGE.size, 5);
  const inside = (x, z) => edge(x) - z;
  // Бор — 0 на лугу, 1 в бору, переход в несколько метров у опушки.
  const wood = (x, z) => s(inside(x, z), -3, 4);
  const dug = (x, z) => {
    const dunes = DUNES.reduce((h, [l, a], k) => h + a * noise(x / l + 17 * k, z / l), 0);
    return LOW.depth * bump((z - LOW.z) / LOW.half) - BANK.rise * s(-z, -BANK.from, -BANK.to) - wood(x, z) * dunes;
  };
  // Хвоя на земле: сплошь в бору, на опушке рвётся пятнами в траву.
  const floor = (x, z) => s(inside(x, z) + 2.5 * noise(x / 2.5, z / 2.5 + 30), -4, 1);
  // Трава под соснами редкая: только в просветах.
  const grass = (x, z) => 1 - floor(x, z) * (1 - 0.25 * s(noise(x / 6 + 60, z / 6), 0.3, 0.8));
  const pines = [];
  for (const { from, to, cell, empty, kinds } of STANDS) {
    for (let x = -FAR.x; x < FAR.x; x += cell) {
      for (let z = edge(x) + Math.min(6, -from); z > FAR.z; z -= cell) {
        const at = { x: x + rnd() * cell, z: z - rnd() * cell };
        const d = inside(at.x, at.z);
        if (d < from || d > to || rnd() < empty) continue;
        // Подрост гуще у самой опушки, на лугу редеет.
        if (to < 3 && rnd() > s(d, from, 0)) continue;
        pines.push({ ...at, kind: kinds[Math.floor(rnd() * kinds.length)], turn: rnd() * 2 * Math.PI, scale: 0.9 + 0.2 * rnd() });
      }
    }
  }
  return { dug, floor, grass, pines };
}

// Строить после shapeGround: сосны встают по земле, комель чуть в ней.
export function buildForest({ pines }) {
  return plantPines(pines.map((p) => ({ ...p, y: height(p.x, p.z) - 0.05 })));
}
