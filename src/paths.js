import * as THREE from 'three';
import { generator, smoothNoise } from './random.js';
import { tiles, soften } from './surface.js';
import { groundAt } from './terrain.js';

// Две тропинки от пешеходной калитки во двор (Никита, 2026-11-21): одна — прямо к нижней ступени крыльца,
// другая — в другую сторону, к краю широкой плотно вымощенной площадки у поленницы. Ширина — на одного
// человека; плоский плитняк лежит в один-два ряда, край рваный, травяной; между расходящимися тропами
// остаётся трава. Стиль — акварельный, как остальной двор: земля просвечивает в колее шагов вдоль оси.
// Концы троп привязаны к фактическому положению крыльца и площадки в каждом варианте двора (их считает
// house-view.js по плану дома и origin хоздвора). Ворота и калитка — разные объекты: тропы идут от калитки.
const PATH = { half: 0.45, edge: 0.18, wander: 0.07, tread: [0.34, 0.5], rows: [1, 2], lift: 0.008 }; // м: полуширина, полоса края, виляние, сторона камня, рядов поперёк
const CELL = 0.05;                                       // м: клетка растра протоптанного
const EDGE_TILE = 16, SLAB_TILE = 1.6;                   // м: длина маски края; сторона плитки под камень
const LIFT = 0.004;                                      // м над настилом тропы, чтобы камни не мерцали с ним

const [edgeTex, slabTex] = tiles(['road-edge.png', 'yard/timber_yard_paving_01.jpg']);
edgeTex.colorSpace = THREE.NoColorSpace;                 // маска — доли, а не цвет
edgeTex.channel = 1;                                     // вторые координаты: вдоль ленты и поперёк неё
edgeTex.wrapT = THREE.ClampToEdgeWrapping;               // внутри полотна — нижний ряд маски (земля), за ним — верхний (трава)
const flat = { transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 };
const look = { contrast: 0.9, saturation: 0.8, scales: [0.13, 0.5], low: [0.92, 0.92, 0.9], high: [1.02, 1.02, 1], cells: [4, 2] };
const mud = soften(new THREE.MeshLambertMaterial({ map: edgeTex.clone(), alphaMap: edgeTex, vertexColors: true, ...flat }), look);
mud.map.colorSpace = THREE.SRGBColorSpace;               // дно тропы — грунт той же картинки, что колея улицы
const stone = soften(new THREE.MeshLambertMaterial({ map: slabTex, color: 0xffffff }), {
  contrast: 0.88, saturation: 0.75, scales: [0.15, 0.5], low: [0.92, 0.9, 0.86], high: [1.06, 1.05, 1.02], cells: [1, 1],
});

// Гладкий шум от rnd: s — ячейка, h — шаг сетки.
const noise = (rnd, h = 1.3) => {
  const w = smoothNoise(rnd);
  return (s) => w(s / h, 7.3);
};

// Путь от a до b через равные промежутки, с лёгким вилянием поперёк; последние keep точек прижаты к цели,
// чтобы конец тропы читался там, где стоит крыльцо или лежит край площадок.
function walk(from, to, rnd, keep = 4) {
  const dx = to.x - from.x, dz = to.z - from.z, length = Math.hypot(dx, dz);
  const n = Math.max(6, Math.round(length / 0.3)), nx = -dz / length, nz = dx / length;
  const sway = noise(rnd, 2.2), bow = (rnd() - 0.5) * 0.5;
  const points = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    // Синус гасит виляние у обоих концов: начало — ровно у калитки, конец — ровно у цели.
    const off = PATH.wander * (sway(t * length) - 0.5) * Math.sin(Math.PI * t) + bow * Math.sin(Math.PI * t) * t;
    const fade = t < keep / n ? 0 : 1;
    points.push({ x: from.x + dx * t + nx * off * fade, z: from.z + dz * t + nz * off * fade });
  }
  return points;
}

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

// Плоские плиты вдоль тропы в один-два ряда поперёк, с зазором до травяного края: швы темнее, посадка неровная.
function slabs(points, surface, rnd, mask = () => 1) {
  const parts = [];
  let s = 0;
  for (let i = 1; i < points.length; i++) s += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
  const step = (PATH.tread[0] + PATH.tread[1]) / 2;
  for (let along = 0.2; along < s - 0.1; along += step * (0.8 + rnd() * 0.5)) {
    // Точка пути на расстоянии along от начала.
    let d = 0, i = 0;
    while (i < points.length - 1 && d + Math.hypot(points[i + 1].x - points[i].x, points[i + 1].z - points[i].z) < along) {
      d += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].z - points[i].z), i++;
    }
    const u = Math.min(1, (along - d) / Math.max(1e-6, Math.hypot(points[i + 1]?.x - points[i].x, points[i + 1]?.z - points[i].z)));
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    const t = new THREE.Vector2(b.x - a.x, b.z - a.z).normalize(), m = new THREE.Vector2(-t.y, t.x);
    const cx = THREE.MathUtils.lerp(points[i].x, points[i + 1].x, u), cz = THREE.MathUtils.lerp(points[i].z, points[i + 1].z, u);
    const seen = mask(i / (points.length - 1));
    const rows = PATH.rows[0] + Math.floor(rnd() * (PATH.rows[1] - PATH.rows[0] + 1));
    for (let r = 0; r < rows; r++) {
      const across = rows === 1 ? 0 : (r / (rows - 1) - 0.5) * 2 * (PATH.half - 0.28);
      const w = PATH.tread[0] + rnd() * (PATH.tread[1] - PATH.tread[0]);
      const l = w * (0.75 + rnd() * 0.5);
      const x = cx + m.x * (across + (rnd() - 0.5) * 0.06), z = cz + m.y * (across + (rnd() - 0.5) * 0.06);
      const y = surface(x, z) + LIFT - rnd() * 0.006;
      const g = new THREE.BoxGeometry(w, 0.045, l).rotateY(Math.atan2(m.y, m.x) + (rnd() - 0.5) * 0.35);
      const uv = g.attributes.uv, du = rnd() * 4, dv = rnd() * 4;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, du + uv.getX(k) * w / SLAB_TILE, dv + uv.getY(k) * l / SLAB_TILE);
      g.translate(x, y, z);
      const col = g.attributes.color ?? new THREE.Float32BufferAttribute(new Float32Array(uv.count * 4).fill(1), 4);
      for (let k = 0; k < col.count; k++) col.setW(k, seen);
      g.setAttribute('color', col);
      parts.push(g);
    }
  }
  return mergeGeometries(parts);
}

function mergeGeometries(parts) {
  const count = (name) => parts.reduce((sum, g) => sum + g.attributes[name].count, 0);
  const position = new Float32Array(count('position') * 3), normal = new Float32Array(count('position') * 3);
  const uv = new Float32Array(count('position') * 2), color = new Float32Array(count('position') * 4);
  const index = new Uint32Array(count('position'));
  let vo = 0, io = 0;
  for (const g of parts) {
    position.set(g.attributes.position.array, vo * 3);
    normal.set(g.attributes.normal.array, vo * 3);
    uv.set(g.attributes.uv.array, vo * 2);
    color.set(g.attributes.color.array, vo * 4);
    const gi = g.index;
    for (let i = 0; i < gi.count; i++) index[io + i] = gi.getX(i) + vo;
    vo += g.attributes.position.count, io += gi.count;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setAttribute('color', new THREE.BufferAttribute(color, 4));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  for (const g of parts) g.dispose();
  return geometry;
}

// Что где лежит: from — точка калитки внутри забора, porch — низкая ступень крыльца, pad — ближний к калитке
// угол мощёной площадки у поленницы, gate — середина ворот (тропы их обходят). Строить после shapeGround:
// лента и камни встают по рельефу. Возвращает trodden и grass для травы world.js и build() для сцены.
export function planPaths({ seed, from, porch, pad, gate }) {
  const rnd = generator(seed + 71);
  const surface = (x, z) => groundAt(x, z) + PATH.lift;
  const avoid = (p) => Math.min(1, Math.hypot(p.x - gate.x, p.z - gate.z) / 1.4);
  const near = (x, z, p, r) => Math.hypot(x - p.x, z - p.z) < r;
  const paths = [walk(from, porch, rnd), walk(from, { x: pad.x, z: pad.z }, rnd)].map((points) => ({
    points,
    // У самой цели лента сходит на нет: дорожка стыкуется со ступенью и с краем площадок без обрыва.
    mask: (i) => avoid(points[i]) * (1 - THREE.MathUtils.smoothstep(i / (points.length - 1), 0.9, 1)),
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
  const s = THREE.MathUtils.smoothstep;
  return {
    paths,
    // Трава: на самой тропе её нет, по рваному краю — режется шумом, между расходящимися тропами — остаётся.
    grass: (x, z) => {
      const d = at(x, z);
      if (near(x, z, porch, 1.1) || near(x, z, pad, 0.9)) return 1;
      return 1 - s(d, 0.55, 0.95) * (0.6 + 0.4 * noise(generator(5), 0.35)(x + z));
    },
    // Топтанье: высокая трава на тропе не растёт, у края — низкая (там, где d чуть меньше единицы, — куртины).
    trodden: (x, z) => (near(x, z, porch, 1.0) || near(x, z, pad, 0.8) ? 0 : s(at(x, z), 0.15, 0.8)),
    build() {
      const group = new THREE.Group();
      paths.forEach(({ points, mask }, k) => {
        const mesh = new THREE.Mesh(ribbon(points, surface, mask), mud);
        mesh.receiveShadow = true;
        mesh.renderOrder = 2;
        const stones = new THREE.Mesh(slabs(points, surface, generator(seed + 91 + k), mask), stone.clone());
        stones.material.vertexColors = true;
        stones.receiveShadow = true;
        stones.renderOrder = 3;
        group.add(mesh, stones);
      });
      return group;
    },
  };
}
