import * as THREE from 'three';
import { VOXEL } from './trunk.js';

// У лежащего комля сетка следует за телом. Луч проходит только те кубики, которые действительно пересёк.
const inverse = new THREE.Matrix4(), ray = new THREE.Ray(), bounds = new THREE.Box3(), point = new THREE.Vector3();
export function hitLog(log, eye, look, limit) {
  log.group.updateWorldMatrix(true, false);
  ray.set(eye, look).applyMatrix4(inverse.copy(log.group.matrixWorld).invert());
  bounds.min.set(log.x0, 0, log.z0);
  bounds.max.set(log.x0 + log.n * VOXEL, log.ny * VOXEL, log.z0 + log.m * VOXEL);
  let t = 0;
  if (!bounds.containsPoint(ray.origin)) {
    if (!ray.intersectBox(bounds, point)) return null;
    t = point.distanceTo(ray.origin);
  }
  ray.at(t + 1e-7, point).sub(bounds.min).divideScalar(VOXEL);
  let i = Math.floor(point.x), j = Math.floor(point.y), k = Math.floor(point.z);
  const { x, y, z } = ray.direction;
  const stride = d => d === 0 ? Infinity : VOXEL / Math.abs(d);
  const next = (v, d) => d === 0 ? Infinity : t + 1e-7 + (Math.floor(v) + (d > 0 ? 1 : 0) - v) * VOXEL / d;
  const dx = stride(x), dy = stride(y), dz = stride(z);
  let tx = next(point.x, x), ty = next(point.y, y), tz = next(point.z, z);
  while (t <= limit && i >= 0 && i < log.n && j >= 0 && j < log.ny && k >= 0 && k < log.m) {
    if (log.at(i, j, k)) return { t, row: j };
    t = Math.min(tx, ty, tz);
    if (tx <= t) { i += Math.sign(x); tx += dx; }
    if (ty <= t) { j += Math.sign(y); ty += dy; }
    if (tz <= t) { k += Math.sign(z); tz += dz; }
  }
  return null;
}

// Поперечный пропил по реальной форме комля, в том числе клина или развилки.
// Полосы дерева в выбранном слое задают, где шина входит в древесину и выходит из неё.
export class LogCut {
  static at(log, row, snap) {
    let target = row, distance = snap;
    for (const j of log.cutRows ?? []) {
      const d = Math.abs(j - row) * VOXEL;
      if (d <= distance) { target = j; distance = d; }
    }
    if (log.crosscut?.row !== target) log.crosscut = new LogCut(log, target);
    return log.crosscut;
  }

  constructor(log, row) {
    this.log = log;
    this.row = row;
    this.strips = [];
    let left = Infinity, right = -Infinity, front = Infinity, back = -Infinity;
    for (let k = 0; k < log.m; k++) {
      for (let i = 0; i < log.n;) {
        if (!log.at(i, row, k)) { i++; continue; }
        const first = i;
        while (i < log.n && log.at(i, row, k)) i++;
        const x0 = log.x0 + first * VOXEL, x1 = log.x0 + i * VOXEL, z0 = log.z0 + k * VOXEL;
        this.strips.push({ x: (x0 + x1) / 2, z: z0 + VOXEL / 2, half: (x1 - x0) / 2 });
        left = Math.min(left, x0); right = Math.max(right, x1);
        front = Math.min(front, z0); back = Math.max(back, z0 + VOXEL);
      }
    }
    this.normal = new THREE.Vector3(0, 1, 0);
    this.center = new THREE.Vector3((left + right) / 2, log.y(row), (front + back) / 2);
    this.r = Math.hypot(right - left, back - front) / 2;
  }

  extent(side) {
    let edge = 0;
    for (const strip of this.strips) {
      const center = (strip.x - this.center.x) * side.x + (strip.z - this.center.z) * side.z;
      edge = Math.max(edge, center + Math.abs(side.x) * strip.half + Math.abs(side.z) * VOXEL / 2);
    }
    return edge;
  }

  band(origin, along, side, limit, half) {
    let enter = Infinity, exit = -Infinity;
    for (const strip of this.strips) {
      const x = strip.x - origin.x, z = strip.z - origin.z, w = strip.half, h = VOXEL / 2;
      if (Math.abs(x * side.x + z * side.z) > half + w * Math.abs(side.x) + h * Math.abs(side.z)) continue;
      const mid = x * along.x + z * along.z, span = w * Math.abs(along.x) + h * Math.abs(along.z);
      let lo = Math.max(0, mid - span), hi = Math.min(limit, mid + span);
      const wx = w + half * Math.abs(side.x), wz = h + half * Math.abs(side.z);
      if (Math.abs(along.x) > 1e-9) {
        lo = Math.max(lo, x / along.x - wx / Math.abs(along.x));
        hi = Math.min(hi, x / along.x + wx / Math.abs(along.x));
      } else if (Math.abs(x) > wx) continue;
      if (Math.abs(along.z) > 1e-9) {
        lo = Math.max(lo, z / along.z - wz / Math.abs(along.z));
        hi = Math.min(hi, z / along.z + wz / Math.abs(along.z));
      } else if (Math.abs(z) > wz) continue;
      if (lo <= hi) { enter = Math.min(enter, lo); exit = Math.max(exit, hi); }
    }
    return enter <= exit ? { enter, exit } : null;
  }

  pass(origin, dir, limit) {
    return this.band(origin, dir, { x: -dir.z, z: dir.x }, limit, 0);
  }

  carve(basis, from, to, length) {
    const volume = this.log.carve(basis, from, to, length);
    if (volume) {
      (this.log.cutRows ??= new Set()).add(this.row);
      this.log.remesh();
      this.log.removed.length = 0;
    }
    return volume;
  }

  get through() {
    const stride = this.log.n * this.log.m;
    return !this.log.data.subarray(this.row * stride, (this.row + 1) * stride).some(Boolean);
  }
}
