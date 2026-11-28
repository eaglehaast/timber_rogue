import * as THREE from 'three';
import { generator, smoothNoise } from './random.js';
import { groundAt } from './terrain.js';
import { planPathNetwork } from './route.js';
import { PAVING_ENTRY_HALF, pavingMaterial, pavingTexture } from './paving.js';
import { ENDS, END_MATERIAL, LOG_MATERIAL } from './house.js';
import { exposedPavingEdges, borderPoints, pavingContains, pavingIntersects } from './paving-contour.js';

// Общая непрерывная сеть мощения; расширяется у ступеней и плавно входит в хозплощадку.
const PATH = { half: 0.68, lift: 0.015 };
const CELL = 0.05;                                       // м: клетка растра протоптанного
const PAVING_TILE = 2;                                   // м: повтор плитняка на хозплощадке

const stone = pavingMaterial(pavingTexture());
function stainedWood(map) {
  const material = new THREE.MeshLambertMaterial({ map });
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      float woodLuma = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(woodLuma), 0.7) * vec3(0.82, 0.78, 0.72);`);
  };
  material.customProgramCacheKey = () => 'path-border-stain';
  return material;
}
const woodSide = stainedWood(LOG_MATERIAL.map), woodEnd = stainedWood(END_MATERIAL.map);
const BORDER = { radius: 0.065, spacing: 0.105, sides: 8 };
const rectangle = ({ x0, x1, z0, z1 }) => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];

// Гладкий шум от rnd: s — ячейка, h — шаг сетки.
const noise = (rnd, h = 1.3) => {
  const w = smoothNoise(rnd);
  return (s) => w(s / h, 7.3);
};

function ribbon(points, destination, surface, textureOrigin, seed, porchWidth, bathWidth, pierWidth, pierEntrySurface, outhouseWidth, shedWidth) {
  const lengths = [0];
  for (let i = 1; i < points.length; i++) {
    lengths.push(lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z));
  }
  const total = lengths.at(-1);
  const terminalHalf = { gate: 0.78, house: porchWidth / 2, utility: PAVING_ENTRY_HALF, bath: bathWidth / 2, pier: pierWidth / 2, 'pier-link': PATH.half, outhouse: outhouseWidth / 2, shed: shedWidth / 2 }[destination];
  const routeSeed = [...destination].reduce((sum, char) => sum + char.charCodeAt(0), seed);
  const edgeNoise = noise(generator(routeSeed + 160), 1.1);
  const smooth = (t) => t * t * (3 - 2 * t);
  const columns = 17, positions = [], uvs = [], indices = [];
  for (let i = 0; i < points.length; i++) {
    const before = points[Math.max(0, i - 1)], after = points[Math.min(points.length - 1, i + 1)];
    const tangent = new THREE.Vector2(after.x - before.x, after.z - before.z).normalize();
    const normal = new THREE.Vector2(-tangent.y, tangent.x);
    const distToEnd = total - lengths[i];
    const startFlare = destination === 'gate' || destination.startsWith('pier') || destination === 'outhouse' || destination === 'shed' ? 0 : smooth(THREE.MathUtils.clamp(1 - lengths[i] / 1.3, 0, 1));
    const endFlare = smooth(THREE.MathUtils.clamp(1 - distToEnd / 1.8, 0, 1));
    const flare = Math.max(startFlare, endFlare);
    const half = THREE.MathUtils.lerp(PATH.half, terminalHalf, flare)
      + (edgeNoise(lengths[i]) - 0.5) * 0.12 * (1 - flare);
    for (let j = 0; j < columns; j++) {
      const offset = half * (2 * j / (columns - 1) - 1);
      const x = points[i].x + normal.x * offset, z = points[i].z + normal.y * offset;
      const ground = surface(x, z);
      const ramp = destination === 'pier' ? smooth(THREE.MathUtils.clamp(1 - distToEnd / 0.8, 0, 1)) : 0;
      const y = ramp ? THREE.MathUtils.lerp(ground, Math.max(ground, pierEntrySurface), ramp) : ground;
      positions.push(x, y, z);
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

// Бордюр идёт по общей внешней границе всех лент и площадки, а не вдоль внутренних швов.
function border(paths, junction, pad, pavingOutline, forecourt, shedApron, seed) {
  const segments = (points) => points.slice(1).map((p, i) => [points[i], p]);
  const shapes = paths.flatMap(({ geometry }) => {
    const position = geometry.attributes.position, index = geometry.index, triangles = [];
    for (let i = 0; i < index.count; i += 3) {
      const ids = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
      const polygon = ids.map((id) => ({ x: position.getX(id), z: position.getZ(id) }));
      const edges = polygon.map((p, j) => [p, polygon[(j + 1) % 3]]).filter((_, j) => {
        const a = ids[j], b = ids[(j + 1) % 3];
        return !(Math.floor(a / 17) === Math.floor(b / 17)
          && (a < 17 || a >= position.count - 17));
      });
      triangles.push({ polygon, edges });
    }
    return triangles;
  });
  const circle = Array.from({ length: 32 }, (_, i) => ({
    x: junction.x + 0.92 * Math.cos(i * Math.PI / 16),
    z: junction.z + 0.92 * Math.sin(i * Math.PI / 16),
  }));
  shapes.push({ polygon: circle, edges: segments([...circle, circle[0]]) });
  const outline = pavingOutline;
  const padEdges = segments(outline).filter(([a, b]) =>
    !(Math.abs(a.x - pad.x) < 1e-5 && Math.abs(b.x - pad.x) < 1e-5
      && Math.abs(a.z - pad.z) <= PAVING_ENTRY_HALF + 1e-5 && Math.abs(b.z - pad.z) <= PAVING_ENTRY_HALF + 1e-5));
  shapes.push({ polygon: outline, edges: padEdges });
  if (forecourt) {
    const polygon = rectangle(forecourt);
    shapes.push({ polygon, edges: [[polygon[0], polygon[1]], [polygon[1], polygon[2]]] });
  }
  if (shedApron) shapes.push({ polygon: rectangle(shedApron), edges: shedApron.edges });
  const covered = pavingContains(shapes);
  const posts = borderPoints(exposedPavingEdges(shapes), BORDER.spacing).filter(({ x, z }) =>
    ![[0.08, 0], [-0.08, 0], [0, 0.08], [0, -0.08]].every(([dx, dz]) => covered(x + dx, z + dz)));
  const rnd = generator(seed + 4817);
  const side = { p: [], n: [], uv: [], index: [] }, top = { p: [], n: [], uv: [], index: [] };
  for (const { x, z } of posts) {
    const r = BORDER.radius * (0.95 + 0.1 * rnd()), spin = rnd() * Math.PI * 2;
    const cell = Math.floor(rnd() * ENDS.disc.length), [cx, cy, cr] = ENDS.disc[cell];
    const [cols, rows] = ENDS.grid, col = cell % cols, row = rows - 1 - Math.floor(cell / cols);
    const ground = [groundAt(x, z)];
    for (let j = 0; j < BORDER.sides; j++) {
      const angle = j * Math.PI * 2 / BORDER.sides;
      ground.push(groundAt(x + r * Math.cos(angle), z + r * Math.sin(angle)));
    }
    const y0 = Math.min(...ground) - 0.12, y1 = Math.max(...ground) + 0.07 + 0.015 * rnd();
    const si = side.p.length / 3, ti = top.p.length / 3;
    top.p.push(x, y1, z); top.n.push(0, 1, 0); top.uv.push((col + cx) / cols, (row + cy) / rows);
    for (let j = 0; j <= BORDER.sides; j++) {
      const angle = j * Math.PI * 2 / BORDER.sides, dx = Math.cos(angle), dz = Math.sin(angle);
      side.p.push(x + r * dx, y0, z + r * dz, x + r * dx, y1, z + r * dz);
      side.n.push(dx, 0, dz, dx, 0, dz);
      // Одна из десяти плиток сруба, волокна идут вдоль вертикального чурбачка.
      side.uv.push((cell % 5 + 0.1) / 5, (Math.floor(cell / 5) % 2 + j / BORDER.sides * 0.95) / 2,
        (cell % 5 + 0.8) / 5, (Math.floor(cell / 5) % 2 + j / BORDER.sides * 0.95) / 2);
      if (j === BORDER.sides) continue;
      const u = Math.cos(angle + spin), v = Math.sin(angle + spin);
      top.p.push(x + r * dx, y1, z + r * dz); top.n.push(0, 1, 0);
      top.uv.push((col + cx + u * cr) / cols, (row + cy + v * cr) / rows);
      side.index.push(si + 2 * j, si + 2 * j + 1, si + 2 * j + 2,
        si + 2 * j + 1, si + 2 * j + 3, si + 2 * j + 2);
      top.index.push(ti, ti + 1 + (j + 1) % BORDER.sides, ti + 1 + j);
    }
  }
  return [side, top].map((data, i) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.p, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.n, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(data.uv, 2));
    geometry.setIndex(data.index);
    const mesh = new THREE.Mesh(geometry, i ? woodEnd : woodSide);
    mesh.receiveShadow = true;
    mesh.name = i ? 'path-border-ends' : 'path-border-sides';
    return mesh;
  });
}

// Строить после shapeGround: единый ствол от ворот расходится к дому, бане и хозплощадке.
export function planPaths({ seed, gate, porch, porchApproach, porchWidth, pad, padApproach, pavingOrigin = pad, pavingOutline, bath, bathApproach, bathWidth, house, pier, pierApproach, pierWidth, pierEntrySurface, utilityPierStart, forecourt, outhouse, outhouseApproach, outhouseStart, outhouseWidth, shed, shedApproach, shedWidth, shedApron }) {
  if (pier && (!pierApproach || !utilityPierStart || !Number.isFinite(pierWidth) || !Number.isFinite(pierEntrySurface))) {
    throw new TypeError('Для тропы к причалу нужны подход, начало, ширина и высота стыка');
  }
  const surface = (x, z) => groundAt(x, z) + PATH.lift;
  const near = (x, z, p, r) => Math.hypot(x - p.x, z - p.z) < r;
  if (outhouse && (!outhouseApproach || !outhouseStart || !Number.isFinite(outhouseWidth))) {
    throw new TypeError('Для тропы к туалету нужны подход, начало и ширина входа');
  }
  if (shed && (!shedApproach || !Number.isFinite(shedWidth) || !shedApron?.edges)) {
    throw new TypeError('Для тропы к сараю нужны направление подхода, ширина устья и площадка перед фасадом');
  }
  const network = planPathNetwork({ gate, porch, porchApproach, pad, padApproach, bath, bathApproach, house, pier, pierApproach, utilityPierStart, outhouse, outhouseApproach, outhouseStart, shed, shedApproach });
  const paths = network.routes.map(({ points, destination }) => ({
    destination, points,
  }));
  const footprints = paths.flatMap(({ points, destination }) => {
    const geometry = ribbon(points, destination, () => 0, pavingOrigin, seed, porchWidth, bathWidth, pierWidth, pierEntrySurface, outhouseWidth, shedWidth);
    const pos = geometry.attributes.position, polygons = [];
    for (let i = 17; i < pos.count; i += 17) {
      const polygon = [i - 17, i - 1, i + 16, i].map((k) => ({ x: pos.getX(k), z: pos.getZ(k) }));
      polygons.push({ polygon });
    }
    geometry.dispose();
    return polygons;
  });
  footprints.push({ polygon: Array.from({ length: 32 }, (_, i) => ({
    x: network.junction.x + 0.92 * Math.cos(i * Math.PI / 16),
    z: network.junction.z + 0.92 * Math.sin(i * Math.PI / 16),
  })) }, { polygon: pavingOutline });
  for (const slab of [forecourt, shedApron]) if (slab) footprints.push({ polygon: rectangle(slab) });
  const intersects = pavingIntersects(footprints);
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
    blocks: (x, z, radius = 0) => intersects(x, z, radius + BORDER.radius * 1.05),
    // Трава: на самой тропе её нет, по рваному краю — режется шумом, между расходящимися тропами — остаётся.
    grass: (x, z) => {
      const d = at(x, z);
      if (near(x, z, porch, 1.1) || near(x, z, pad, 0.9) || near(x, z, bath, 0.9)
        || (shed && near(x, z, shed, 1.0))) return 1;
      return 1 - s(d, 0.55, 0.95) * (0.6 + 0.4 * wearNoise(x + z));
    },
    // Топтанье: высокая трава на тропе не растёт, у края — низкая (там, где d чуть меньше единицы, — куртины).
    trodden: (x, z) => (near(x, z, porch, 1.0) || near(x, z, pad, 0.8) || near(x, z, bath, 0.8)
      || (shed && near(x, z, shed, 0.8)) ? 0 : s(at(x, z), 0.15, 0.8)),
    build() {
      const group = new THREE.Group();
      const ribbons = paths.map((path) => ({
        ...path, geometry: ribbon(path.points, path.destination, surface, pavingOrigin, seed, porchWidth, bathWidth, pierWidth, pierEntrySurface, outhouseWidth, shedWidth),
      }));
      ribbons.forEach(({ geometry }) => {
        const mesh = new THREE.Mesh(geometry, stone);
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
      // Прямоугольная плита мощения повторяет рельеф и лежит чуть выше лент, чтобы стык с ними не мерцал.
      const slab = ({ x0, x1, z0, z1 }, name) => {
        const geometry = new THREE.PlaneGeometry(x1 - x0, z1 - z0,
          Math.ceil((x1 - x0) / 0.12), Math.ceil((z1 - z0) / 0.12)).rotateX(-Math.PI / 2);
        const pos = geometry.attributes.position, uv = geometry.attributes.uv;
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i) + (x0 + x1) / 2, z = pos.getZ(i) + (z0 + z1) / 2;
          pos.setXYZ(i, x, surface(x, z) + 0.003, z);
          uv.setXY(i, (z - pavingOrigin.z) / PAVING_TILE, (x - pavingOrigin.x) / PAVING_TILE);
        }
        geometry.computeVertexNormals();
        const mesh = new THREE.Mesh(geometry, stone);
        mesh.name = name;
        mesh.receiveShadow = true;
        return mesh;
      };
      if (forecourt) group.add(slab(forecourt, 'house-forecourt'));
      if (shedApron) group.add(slab(shedApron, 'shed-apron'));
      group.add(...border(ribbons, network.junction, pad, pavingOutline, forecourt, shedApron, seed));
      return group;
    },
  };
}
