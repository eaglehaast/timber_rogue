import * as THREE from 'three';
import { tiles } from './surface.js';

// Наличники — резные рамы окон, картинки на прозрачном фоне (house-nalichnik.webp, 5 узоров в ряд).
// Каждая картинка — 1,1 × 2,2 м, вид строго спереди. У всех пяти один контур и один проём, поэтому
// проём в срубе меряется по картинке: PANE — ширина и высота проёма в метрах.
// Рисованы белым: цвет даёт код, на одном доме все наличники одного узора и цвета.
const COUNT = 5;
const SIZE = [1.1, 2.2];
const PX = [1024, 2048];
// В пикселях картинки 1024 × 2048 (от левого верхнего угла): сама рама и проём в ней.
const FRAME = { x: [11, 1013], y: [104, 1831] };
const OPENING = { x: [231, 792], y: [544, 1587] };
const m = (px, axis) => (px / PX[axis]) * SIZE[axis];
export const PANE = [m(OPENING.x[1] - OPENING.x[0], 0), m(OPENING.y[1] - OPENING.y[0], 1)];
export const TRIM_ABOVE = m(OPENING.y[0] - FRAME.y[0], 1); // рама над проёмом (кокошник)

// Краски наличников: голубая как на референсе, она и чаще всего.
export const PAINTS = [
  [0.3, 0.55, 0.92], [0.3, 0.55, 0.92], [0.92, 0.92, 0.88], [0.14, 0.28, 0.66], [0.26, 0.5, 0.3], [0.64, 0.48, 0.24],
];
export const PATTERNS = COUNT;

const [map] = tiles(['assets/textures/house-nalichnik.webp']);
const materials = new Map();
const material = (paint) => {
  if (!materials.has(paint)) materials.set(paint, new THREE.MeshLambertMaterial({ map, color: new THREE.Color(...PAINTS[paint]), alphaTest: 0.5 }));
  return materials.get(paint);
};

// Наличники на окна дома: пластина рамы чуть впереди брёвен (out — от оси стены наружу), проём картинки
// совпадает с проёмом окна. walls — как в house.js: along, at; base — высота, от которой считаются низ и верх проёмов.
export function buildNalichniki({ openings, nalichnik: { pattern, paint } }, walls, { base, out }) {
  const pos = [], normal = [], uv = [], index = [];
  // Края рамы относительно низа и середины проёма, в метрах; u, v — места в атласе.
  const left = m(FRAME.x[0] - OPENING.x[0], 0), right = m(FRAME.x[1] - OPENING.x[0], 0) - PANE[0];
  const below = m(OPENING.y[1] - FRAME.y[1], 1), above = m(OPENING.y[1] - FRAME.y[0], 1);
  const u = [FRAME.x[0], FRAME.x[1]].map((x) => (pattern + x / PX[0]) / COUNT);
  const v = [FRAME.y[1], FRAME.y[0]].map((y) => 1 - y / PX[1]);
  for (const o of openings) {
    if (o.kind !== 'window') continue;
    const wall = walls[o.wall], side = Math.sign(wall.at);
    // Середина проёма на оси стены, наружу n, и s — вправо для того, кто смотрит на стену снаружи.
    const c = wall.along === 'x' ? [o.at, 0, wall.at] : [wall.at, 0, o.at];
    const n = wall.along === 'x' ? [0, 0, side] : [side, 0, 0];
    const s = wall.along === 'x' ? [side, 0, 0] : [0, 0, -side];
    const point = (a, h) => [0, 1, 2].map((k) => c[k] + n[k] * out + s[k] * a + (k === 1 ? base + o.bottom + h : 0));
    const start = pos.length / 3;
    const xs = [-PANE[0] / 2 + left, PANE[0] / 2 + right], hs = [below, above];
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
      pos.push(...point(xs[i], hs[j]));
      normal.push(...n);
      uv.push(u[i], v[j]);
    }
    index.push(start, start + 1, start + 3, start, start + 3, start + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  const mesh = new THREE.Mesh(geometry, material(paint));
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}
