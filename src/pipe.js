import * as THREE from 'three';

// Всё, что тянется вдоль линии: трубы газа, опоры, провода, гофра. Путь — точки оси { p, t, s }: место, касательная
// и длина от начала; трубка — кольца вокруг этих точек.

const dir = (a, b) => b.clone().sub(a).normalize();
function measure(points, tangents) {
  let s = 0;
  return points.map((p, i) => ({ p: p.clone(), t: tangents[i], s: (s += i ? p.distanceTo(points[i - 1]) : 0) }));
}

// Ломаная, в углах колена радиуса bend(i).
export function route(points, bend) {
  const out = [{ p: points[0].clone(), t: dir(points[0], points[1]), s: 0 }];
  const push = (p, t) => out.push({ p, t, s: out.at(-1).s + p.distanceTo(out.at(-1).p) });
  for (let i = 1; i < points.length - 1; i++) {
    const a = dir(points[i - 1], points[i]), b = dir(points[i], points[i + 1]), turn = a.angleTo(b);
    if (turn < 1e-4) continue;
    const r = bend(i), start = points[i].clone().addScaledVector(a, -r * Math.tan(turn / 2));
    const axis = a.clone().cross(b).normalize(), center = start.clone().addScaledVector(axis.clone().cross(a), r);
    const n = Math.ceil(turn / (Math.PI / 16));
    for (let k = 0; k <= n; k++) {
      const q = new THREE.Quaternion().setFromAxisAngle(axis, (turn * k) / n);
      push(start.clone().sub(center).applyQuaternion(q).add(center), a.clone().applyQuaternion(q));
    }
  }
  push(points.at(-1).clone(), dir(points.at(-2), points.at(-1)));
  return out;
}

// Плавная кривая по частым точкам (провис провода, обвязка): касательная — от соседней точки к соседней.
export const curve = (points) => measure(points, points.map((p, i) => dir(points[Math.max(0, i - 1)], points[Math.min(points.length - 1, i + 1)])));

// Провод между A и B с провисом sag посередине: P(t) = A + (B − A)·t − вверх·4·sag·t(1 − t).
export const sag = (a, b, depth, n = 32) =>
  curve(Array.from({ length: n + 1 }, (_, i) => a.clone().lerp(b, i / n).setY(a.y + (b.y - a.y) * (i / n) - 4 * depth * (i / n) * (1 - i / n))));

// Тот же путь с точками не реже step: прямые куски пути — по две точки, а гофре и скрутке нужны частые.
export function resample(path, step) {
  const points = [path[0].p], tangents = [path[0].t];
  for (let i = 1; i < path.length; i++) {
    const n = Math.ceil((path[i].s - path[i - 1].s) / step);
    for (let k = 1; k <= n; k++) {
      points.push(path[i - 1].p.clone().lerp(path[i].p, k / n));
      tangents.push(path[i - 1].t.clone().lerp(path[i].t, k / n).normalize());
    }
  }
  return measure(points, tangents);
}

// Рамка сечения в каждой точке: нормаль переносим от точки к точке поворотом касательной — сечение
// не перекручивается на коленах, а шов развёртки идёт по одной линии. У отвесного пути нормаль начинается с +x.
function frames(path) {
  const n = new THREE.Vector3(0, 1, 0);
  if (Math.abs(path[0].t.y) > 0.9) n.set(1, 0, 0);
  n.sub(path[0].t.clone().multiplyScalar(n.dot(path[0].t))).normalize();
  return path.map(({ t }, i) => {
    if (i) n.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(path[i - 1].t, t));
    return { n: n.clone(), b: t.clone().cross(n) };
  });
}

// Трубка вдоль пути. r — радиус или радиус от длины s (сбег опоры, рёбра гофры). Вдоль трубки укладывается целое
// число развёрток по tile метров (чуть растянутых или сжатых): трубка начинается и кончается краем картинки — там,
// где у всех картинок набора общий край, и соседняя трубка продолжает её без шва. Вокруг — одна развёртка;
// номер картинки — по клетке uv (soften, cells): у каждой трубки свой ряд клеток set, чтобы порядок не повторялся.
export function tube(path, r, { set = 0, tile = 1, sides = 16 } = {}) {
  const radius = typeof r === 'function' ? r : () => r;
  const length = path.at(-1).s, step = length / Math.max(1, Math.round(length / tile));
  const pos = [], normal = [], uv = [], index = [];
  const d = new THREE.Vector3();
  frames(path).forEach(({ n, b }, i) => {
    const { p, s } = path[i], rr = radius(s);
    for (let j = 0; j <= sides; j++) {
      const angle = (j / sides) * Math.PI * 2;
      d.copy(n).multiplyScalar(Math.cos(angle)).addScaledVector(b, Math.sin(angle));
      pos.push(p.x + d.x * rr, p.y + d.y * rr, p.z + d.z * rr);
      normal.push(d.x, d.y, d.z);
      uv.push(s / step, set + j / sides);
    }
    if (!i) return;
    const a0 = (i - 1) * (sides + 1), a1 = i * (sides + 1);
    for (let j = 0; j < sides; j++) index.push(a0 + j, a0 + j + 1, a1 + j, a1 + j, a0 + j + 1, a1 + j + 1);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  return geometry;
}

// Скрутка: count жил вокруг пути на расстоянии spread, оборот — за pitch метров (жгут СИП).
export function twist(path, count, spread, pitch) {
  const dense = resample(path, pitch / 12), rings = frames(dense);
  return Array.from({ length: count }, (_, k) => curve(dense.map(({ p, s }, i) => {
    const angle = (2 * Math.PI * (s / pitch + k / count));
    return p.clone().addScaledVector(rings[i].n, Math.cos(angle) * spread).addScaledVector(rings[i].b, Math.sin(angle) * spread);
  })));
}
