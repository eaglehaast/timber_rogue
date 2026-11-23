import * as THREE from 'three';
import { generator, smoothNoise } from './random.js';
import { tiles, soften, merge } from './surface.js';
import { groundAt } from './terrain.js';
import { planPathNetwork } from './route.js';
import { pavingMaterial, pavingTexture } from './paving.js';

// Единая сеть от ворот к крыльцу, бане и хозплощадке; между неровными плитами остаются узкие травяные швы.
const PATH = { half: 0.64, edge: 0.2, lift: 0.012 };
const CELL = 0.05;                                       // м: клетка растра протоптанного
const EDGE_TILE = 16, SLAB_TILE = 2.0;                   // м: длина маски края; масштаб плитняка под хозблоком
const SLAB_THICKNESS = 0.055, STONE_LIFT = 0.018, STONE_STEP = 0.74, STONE_ROWS = 2;

// Пути — полные: device.texture() сам подставляет half/ для игры; без префикса получался 404 и загрузка двора
// обрывалась на «212/212» (текстура грузится асинхронно, ошибка не бросается в код — просто висело ожидание).
const [edgeTex] = tiles(['assets/textures/road-edge.png']);
edgeTex.colorSpace = THREE.NoColorSpace;                 // маска — доли, а не цвет
edgeTex.channel = 1;                                     // вторые координаты: вдоль ленты и поперёк неё
edgeTex.wrapT = THREE.ClampToEdgeWrapping;               // внутри полотна — нижний ряд маски (земля), за ним — верхний (трава)
const flat = { transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 };
const look = { contrast: 0.9, saturation: 0.8, scales: [0.13, 0.5], low: [0.92, 0.92, 0.9], high: [1.02, 1.02, 1], cells: [4, 2] };
const mud = soften(new THREE.MeshLambertMaterial({ map: edgeTex.clone(), alphaMap: edgeTex, vertexColors: true, ...flat }), look);
mud.map.colorSpace = THREE.SRGBColorSpace;               // дно тропы — грунт той же картинки, что колея улицы
const stone = pavingMaterial(pavingTexture());

// Гладкий шум от rnd: s — ячейка, h — шаг сетки.
const noise = (rnd, h = 1.3) => {
  const w = smoothNoise(rnd);
  return (s) => w(s / h, 7.3);
};

// Лента по земле вдоль пути: полуширина дышит (рваный край), mask(i) — насколько тропа видна (у конца — в ноль).
// Тот же приём, что у колеи улицы (road.js): альфа-маска road-edge рвано тает в траву по полосе edge.
function ribbon(points, surface, mask = () => 1) {
  const pos = [], uv = [], uv1 = [], color = [], index = [];
  const breath = noise(generator(11), 0.9);
  const n = Math.ceil((2 * (PATH.half + PATH.edge)) / 0.05) + 1;
  let s = 0;
  points.forEach((p, i) => {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    const t = new THREE.Vector2(b.x - a.x, b.z - a.z).normalize(), m = new THREE.Vector2(-t.y, t.x);
    if (i) s += Math.hypot(p.x - points[i - 1].x, p.z - points[i - 1].z);
    const h = PATH.half * (1 + 0.14 * (breath(s) - 0.5));
    const inner = h - PATH.edge / 2, outer = h + PATH.edge / 2, w = mask(i);
    Array.from({ length: n }, (_, k) => outer * ((2 * k) / (n - 1) - 1)).forEach((d) => {
      const x = p.x + m.x * d, z = p.z + m.y * d;
      pos.push(x, surface(x, z), z);
      uv.push(x / EDGE_TILE, z / EDGE_TILE);
      uv1.push(s / EDGE_TILE, Math.max(0, Math.abs(d) - inner) / PATH.edge);
      color.push(1, 1, 1, w);
    });
    if (!i) return;
    const a0 = (i - 1) * n, a1 = i * n;
    for (let j = 0; j < n - 1; j++) index.push(a0 + j, a0 + j + 1, a1 + j, a0 + j + 1, a1 + j + 1, a1 + j);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('uv1', new THREE.Float32BufferAttribute(uv1, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(color, 4));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

function flagstone(width, length, rnd) {
  const outline = [
    [-width * (0.5 - rnd() * 0.08), -length / 2],
    [width * (0.5 - rnd() * 0.12), -length * (0.5 - rnd() * 0.1)],
    [width / 2, -length * (0.5 - rnd() * 0.2)],
    [width * (0.5 - rnd() * 0.07), length * (0.5 - rnd() * 0.13)],
    [width * (0.5 - rnd() * 0.14), length / 2],
    [-width * (0.5 - rnd() * 0.12), length / 2],
    [-width / 2, length * (0.5 - rnd() * 0.16)],
    [-width / 2, -length * (0.5 - rnd() * 0.18)],
  ];
  const shape = new THREE.Shape();
  shape.moveTo(...outline[0]);
  outline.slice(1).forEach((point) => shape.lineTo(...point));
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: SLAB_THICKNESS, bevelEnabled: false });
  geometry.rotateX(-Math.PI / 2);
  const uv = geometry.attributes.uv, position = geometry.attributes.position;
  const du = rnd() * 2, dv = rnd() * 2;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, du + position.getX(i) / SLAB_TILE, dv - position.getZ(i) / SLAB_TILE);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function sample(points, distance) {
  let along = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (along + length >= distance) {
      const t = length > 1e-6 ? (distance - along) / length : 0;
      const before = points[Math.max(0, i - 2)], after = points[Math.min(points.length - 1, i + 1)];
      const tangent = new THREE.Vector2(after.x - before.x, after.z - before.z).normalize();
      return {
        x: THREE.MathUtils.lerp(a.x, b.x, t),
        z: THREE.MathUtils.lerp(a.z, b.z, t),
        tangent,
      };
    }
    along += length;
  }
  const last = points.at(-1), before = points.at(-2);
  return { ...last, tangent: new THREE.Vector2(last.x - before.x, last.z - before.z).normalize() };
}

// Два ряда неровных плит со смещёнными швами; тот же камень и масштаб, что у хозплощадки.
function slabs(points, surface, rnd) {
  const parts = [];
  const length = points.slice(1).reduce((total, point, i) =>
    total + Math.hypot(point.x - points[i].x, point.z - points[i].z), 0);
  for (let row = 0; row < STONE_ROWS; row++) {
    let along = 0.12 + row * STONE_STEP / 2;
    while (along < length - 0.12) {
      const { x, z, tangent } = sample(points, along);
      const across = (row - (STONE_ROWS - 1) / 2) * 0.52 + (rnd() - 0.5) * 0.05;
      const normal = new THREE.Vector2(-tangent.y, tangent.x);
      const cx = x + normal.x * across, cz = z + normal.y * across;
      const geometry = flagstone(0.44 + rnd() * 0.1, 0.59 + rnd() * 0.15, rnd);
      geometry.rotateY(Math.atan2(tangent.x, tangent.y) + (rnd() - 0.5) * 0.12);
      geometry.translate(cx, surface(cx, cz) + STONE_LIFT - SLAB_THICKNESS, cz);
      parts.push(geometry);
      along += STONE_STEP + (rnd() - 0.5) * 0.12;
    }
  }
  if (!parts.length) return new THREE.BufferGeometry();
  const geometry = merge(parts);
  for (const g of parts) g.dispose();
  return geometry;
}

// Строить после shapeGround: единый ствол от ворот расходится к дому, бане и хозплощадке.
export function planPaths({ seed, gate, porch, pad, bath, house }) {
  const surface = (x, z) => groundAt(x, z) + PATH.lift;
  const near = (x, z, p, r) => Math.hypot(x - p.x, z - p.z) < r;
  const network = planPathNetwork({ gate, porch, pad, bath, house });
  const paths = network.routes.map(({ points, destination }) => ({
    destination, points, mask: () => 1,
  }));
  // Растр протоптанного вокруг троп: в колее шагов (у оси) трава не растёт вовсе, у края — низкая.
  const all = paths.flatMap((p) => p.points);
  const box = {
    x0: Math.min(...all.map((p) => p.x)) - 1.2, x1: Math.max(...all.map((p) => p.x)) + 1.2,
    z0: Math.min(...all.map((p) => p.z)) - 1.2, z1: Math.max(...all.map((p) => p.z)) + 1.2,
  };
  const nx = Math.ceil((box.x1 - box.x0) / CELL) + 1, nz = Math.ceil((box.z1 - box.z0) / CELL) + 1;
  const layer = new Float32Array(nx * nz);
  for (const { points, mask } of paths) {
    for (let i = 0; i < points.length; i++) {
      const p = points[i], w = mask(i), reach = PATH.half + PATH.edge + 0.35;
      const i0 = Math.max(0, Math.floor((p.x - reach - box.x0) / CELL)), i1 = Math.min(nx - 1, Math.ceil((p.x + reach - box.x0) / CELL));
      const j0 = Math.max(0, Math.floor((p.z - reach - box.z0) / CELL)), j1 = Math.min(nz - 1, Math.ceil((p.z + reach - box.z0) / CELL));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const r = Math.hypot(box.x0 + i * CELL - p.x, box.z0 + j * CELL - p.z) / PATH.half;
        if (r < reach / PATH.half) {
          const k = j * nx + i;
          layer[k] = Math.max(layer[k], w * THREE.MathUtils.clamp(1.25 - r, 0, 1));
        }
      }
    }
  }
  const at = (x, z) => {
    const u = (x - box.x0) / CELL, v = (z - box.z0) / CELL;
    if (u < 0 || v < 0 || u >= nx - 1 || v >= nz - 1) return 0;
    const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j, k = j * nx + i;
    return (layer[k] * (1 - fu) + layer[k + 1] * fu) * (1 - fv) + (layer[k + nx] * (1 - fu) + layer[k + nx + 1] * fu) * fv;
  };
  const wearNoise = noise(generator(5), 0.35);
  const s = THREE.MathUtils.smoothstep;
  return {
    paths,
    junction: network.junction,
    // Трава: на самой тропе её нет, по рваному краю — режется шумом, между расходящимися тропами — остаётся.
    grass: (x, z) => {
      const d = at(x, z);
      if (near(x, z, porch, 1.1) || near(x, z, pad, 0.9) || near(x, z, bath, 0.9)) return 1;
      return 1 - s(d, 0.55, 0.95) * (0.6 + 0.4 * wearNoise(x + z));
    },
    // Топтанье: высокая трава на тропе не растёт, у края — низкая (там, где d чуть меньше единицы, — куртины).
    trodden: (x, z) => (near(x, z, porch, 1.0) || near(x, z, pad, 0.8) || near(x, z, bath, 0.8) ? 0 : s(at(x, z), 0.15, 0.8)),
    build() {
      const group = new THREE.Group();
      paths.forEach(({ points, mask }, k) => {
        const mesh = new THREE.Mesh(ribbon(points, surface, mask), mud);
        mesh.receiveShadow = true;
        mesh.renderOrder = 2;
        const stones = new THREE.Mesh(slabs(points, surface, generator(seed + 91 + k)), stone);
        stones.receiveShadow = true;
        stones.renderOrder = 3;
        group.add(mesh, stones);
      });
      return group;
    },
  };
}
