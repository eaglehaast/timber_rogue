import * as THREE from 'three';
import { soften } from './surface.js';
import { KIT, atlas } from './kit.js';
import { Faces } from './window.js';

// Завалинка — земля, засыпанная у цоколя и удержанная доской: доска стоймя на OUT от цоколя, высотой HIGH,
// земля от её верха поднимается к цоколю ещё на RISE. Картинки — набор house-zavalinka.jpg (5 лент 2048 × 512
// с общими краями): нижняя половина — доска, верхняя — земля; лента повторяется через TILE метров.
// У двери завалинки нет — там крыльцо. На углах земля двух стен сходится косым ребром сама.
const OUT = 0.4, HIGH = 0.26, RISE = 0.07, SINK = 0.05;
const TILE = 4 * 2 * (HIGH + SINK);
const material = soften(new THREE.MeshLambertMaterial({ map: atlas('zavalinka') }), {
  contrast: 0.85, saturation: 0.8, scales: [0.4, 1.3], low: [0.85, 0.85, 0.85], high: [1.05, 1.04, 1.02], cells: KIT.zavalinka.grid,
});

// hx, hz — полуразмеры цоколя; door — проём двери (wall, at, porch — ширина крыльца).
export function buildZavalinka(hx, hz, door, rnd) {
  const faces = new Faces();
  const walls = [
    { name: 'front', n: [0, 0, 1], half: hx, at: hz }, { name: 'back', n: [0, 0, -1], half: hx, at: hz },
    { name: 'left', n: [-1, 0, 0], half: hz, at: hx }, { name: 'right', n: [1, 0, 0], half: hz, at: hx },
  ];
  for (const { name, n, half, at } of walls) {
    // Точка у стены: s — вдоль стены, d — от лица цоколя наружу, y — вверх.
    const P = (s, d, y) => (n[0] ? [n[0] * (at + d), y, s] : [s, y, n[2] * (at + d)]);
    const ends = door.wall === name ? [[-half - OUT, door.at - door.porch / 2], [door.at + door.porch / 2, half + OUT]] : [[-half - OUT, half + OUT]];
    const u0 = rnd() * 10, slope = new THREE.Vector3(n[0] * RISE, OUT, n[2] * RISE).normalize().toArray();
    for (const [a, b] of ends) {
      const [ua, ub] = [u0 + a / TILE, u0 + b / TILE];
      faces.face([P(a, OUT, -SINK), P(b, OUT, -SINK), P(b, OUT, HIGH), P(a, OUT, HIGH)], n, [[ua, 0], [ub, 0], [ub, 0.5], [ua, 0.5]]);
      faces.face([P(a, OUT, HIGH), P(b, OUT, HIGH), P(b, 0, HIGH + RISE), P(a, 0, HIGH + RISE)], slope, [[ua, 0.5], [ub, 0.5], [ub, 0.999], [ua, 0.999]]);
    }
  }
  return faces.mesh(material);
}
