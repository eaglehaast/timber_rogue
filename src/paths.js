import * as THREE from 'three';
import { generator, smoothNoise } from './random.js';
import { groundAt } from './terrain.js';
import { planPathNetwork } from './route.js';
import { PAVING_ENTRY_HALF, pavingMaterial, pavingTexture } from './paving.js';

// Общая непрерывная сеть мощения; расширяется у ступеней и плавно входит в хозплощадку.
const PATH = { half: 0.68, lift: 0.015 };
const CELL = 0.05;                                       // м: клетка растра протоптанного
const PAVING_TILE = 2;                                   // м: повтор плитняка на хозплощадке

const stone = pavingMaterial(pavingTexture());

// Гладкий шум от rnd: s — ячейка, h — шаг сетки.
const noise = (rnd, h = 1.3) => {
  const w = smoothNoise(rnd);
  return (s) => w(s / h, 7.3);
};

function ribbon(points, destination, surface, textureOrigin, seed) {
  const lengths = [0];
  for (let i = 1; i < points.length; i++) {
    lengths.push(lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z));
  }
  const total = lengths.at(-1);
  const terminalHalf = { gate: 0.78, house: 0.9, utility: PAVING_ENTRY_HALF, bath: 0.68 }[destination];
  const routeSeed = [...destination].reduce((sum, char) => sum + char.charCodeAt(0), seed);
  const edgeNoise = noise(generator(routeSeed + 160), 1.1);
  const smooth = (t) => t * t * (3 - 2 * t);
  const columns = 17, positions = [], uvs = [], indices = [];
  for (let i = 0; i < points.length; i++) {
    const before = points[Math.max(0, i - 1)], after = points[Math.min(points.length - 1, i + 1)];
    const tangent = new THREE.Vector2(after.x - before.x, after.z - before.z).normalize();
    const normal = new THREE.Vector2(-tangent.y, tangent.x);
    const distToEnd = total - lengths[i];
    const startFlare = destination === 'gate' ? 0 : smooth(THREE.MathUtils.clamp(1 - lengths[i] / 1.3, 0, 1));
    const endFlare = smooth(THREE.MathUtils.clamp(1 - distToEnd / 1.8, 0, 1));
    const flare = Math.max(startFlare, endFlare);
    const half = THREE.MathUtils.lerp(PATH.half, terminalHalf, flare)
      + (edgeNoise(lengths[i]) - 0.5) * 0.12 * (1 - flare);
    for (let j = 0; j < columns; j++) {
      const offset = half * (2 * j / (columns - 1) - 1);
      const x = points[i].x + normal.x * offset, z = points[i].z + normal.y * offset;
      positions.push(x, surface(x, z), z);
      uvs.push((z - textureOrigin.z) / PAVING_TILE, (x - textureOrigin.x) / PAVING_TILE);
      if (!i) continue;
      const a = (i - 1) * columns + j, b = i * columns + j;
      if (j < columns - 1) indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// Строить после shapeGround: единый ствол от ворот расходится к дому, бане и хозплощадке.
export function planPaths({ seed, gate, porch, porchApproach, pad, padApproach, pavingOrigin = pad, bath, bathApproach, house }) {
  const surface = (x, z) => groundAt(x, z) + PATH.lift;
  const near = (x, z, p, r) => Math.hypot(x - p.x, z - p.z) < r;
  const network = planPathNetwork({ gate, porch, porchApproach, pad, padApproach, bath, bathApproach, house });
  const paths = network.routes.map(({ points, destination }) => ({
    destination, points,
  }));
  // Растр протоптанного вокруг троп: в колее шагов (у оси) трава не растёт вовсе, у края — низкая.
  const all = paths.flatMap((p) => p.points);
  const box = {
    x0: Math.min(...all.map((p) => p.x)) - 1.2, x1: Math.max(...all.map((p) => p.x)) + 1.2,
    z0: Math.min(...all.map((p) => p.z)) - 1.2, z1: Math.max(...all.map((p) => p.z)) + 1.2,
  };
  const nx = Math.ceil((box.x1 - box.x0) / CELL) + 1, nz = Math.ceil((box.z1 - box.z0) / CELL) + 1;
  const layer = new Float32Array(nx * nz);
  for (const { points } of paths) {
    for (let i = 0; i < points.length; i++) {
      const p = points[i], w = 1, reach = PATH.half + 0.65;
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
      paths.forEach(({ points, destination }) => {
        const mesh = new THREE.Mesh(ribbon(points, destination, surface, pavingOrigin, seed), stone);
        mesh.receiveShadow = true;
        group.add(mesh);
      });
      const junction = new THREE.Mesh(new THREE.CircleGeometry(0.92, 32).rotateX(-Math.PI / 2), stone);
      const centerY = surface(network.junction.x, network.junction.z);
      junction.position.set(network.junction.x, centerY + 0.001, network.junction.z);
      junction.receiveShadow = true;
      const uv = junction.geometry.attributes.uv;
      const position = junction.geometry.attributes.position;
      for (let i = 0; i < uv.count; i++) {
        const x = network.junction.x + position.getX(i), z = network.junction.z + position.getZ(i);
        position.setY(i, surface(x, z) - centerY);
        uv.setXY(i, (z - pavingOrigin.z) / PAVING_TILE, (x - pavingOrigin.x) / PAVING_TILE);
      }
      junction.geometry.computeVertexNormals();
      group.add(junction);
      return group;
    },
  };
}
