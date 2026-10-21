import * as THREE from 'three';

// Низ ствола — сетка кубиков-вокселей: древесина есть или выпилена.
// Пила вырезает из неё настоящую щель, по оставшимся кубикам считается, держит ли недопил.
export const VOXEL = 0.01;
const CHUNK = 10; // слоёв в одном куске сетки; при пилении перестраиваются только задетые куски

const BARK = new THREE.Color(0x6b4a2b);
const WOOD = new THREE.Color(0xe2bf86);

// Углы грани кубика для каждого из шести направлений, по кругу снаружи.
const FACES = [
  { dir: [1, 0, 0], corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { dir: [-1, 0, 0], corners: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
  { dir: [0, 1, 0], corners: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },
  { dir: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { dir: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { dir: [0, 0, -1], corners: [[0, 1, 0], [1, 1, 0], [1, 0, 0], [0, 0, 0]] },
];

export class TrunkVoxels {
  constructor(radius, height, material) {
    this.radius = radius;
    this.height = height;
    this.n = Math.ceil((2 * radius) / VOXEL);
    this.ny = Math.round(height / VOXEL);
    this.half = (this.n * VOXEL) / 2;
    this.material = material;

    // inside — клетки круга ствола в плане; снаружи от них грань кубика — кора, внутри — свежий срез.
    this.inside = new Uint8Array(this.n * this.n);
    for (let k = 0; k < this.n; k++) {
      for (let i = 0; i < this.n; i++) {
        this.inside[k * this.n + i] = Math.hypot(this.x(i), this.z(k)) <= radius ? 1 : 0;
      }
    }
    this.full = this.inside.reduce((s, v) => s + v, 0);
    this.data = new Uint8Array(this.n * this.n * this.ny);
    for (let j = 0; j < this.ny; j++) this.data.set(this.inside, j * this.n * this.n);
    this.layerCount = new Int32Array(this.ny).fill(this.full);

    this.group = new THREE.Group();
    this.chunks = [];
    for (let c = 0; c * CHUNK < this.ny; c++) {
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
      this.group.add(mesh);
      this.chunks.push({ mesh, dirty: true });
    }
  }

  x(i) { return (i + 0.5) * VOXEL - this.half; }
  y(j) { return (j + 0.5) * VOXEL; }
  z(k) { return (k + 0.5) * VOXEL - this.half; }
  at(i, j, k) { return this.data[(j * this.n + k) * this.n + i]; }

  layerOf(y) {
    return THREE.MathUtils.clamp(Math.floor(y / VOXEL), 0, this.ny - 1);
  }

  // Вырезает щель пилы: кубики, чьи центры лежат в плоскости полотна (толщина — один кубик без дыр
  // при любом наклоне), не дальше depth по ходу пилы и в пределах длины шины.
  carve({ origin, along, side, normal }, depth, barLength) {
    const halfT = 0.5 * VOXEL * (Math.abs(normal.x) + Math.abs(normal.y) + Math.abs(normal.z));
    const { n } = this;
    for (let k = 0; k < n; k++) {
      for (let i = 0; i < n; i++) {
        if (!this.inside[k * n + i]) continue;
        const dx = this.x(i) - origin.x;
        const dz = this.z(k) - origin.z;
        const c = dx * normal.x + dz * normal.z;
        // Плоскость пологая (наклон не больше 60°), поэтому в каждой колонке её пересекают единицы кубиков.
        const y0 = origin.y + (-halfT - c) / normal.y;
        const y1 = origin.y + (halfT - c) / normal.y;
        const j0 = Math.max(0, Math.ceil(Math.min(y0, y1) / VOXEL - 0.5));
        const j1 = Math.min(this.ny - 1, Math.floor(Math.max(y0, y1) / VOXEL - 0.5));
        for (let j = j0; j <= j1; j++) {
          const id = (j * n + k) * n + i;
          if (!this.data[id]) continue;
          const dy = this.y(j) - origin.y;
          const s = dx * along.x + dy * along.y + dz * along.z;
          const w = dx * side.x + dy * side.y + dz * side.z;
          if (s > depth || Math.abs(w) > barLength / 2) continue;
          this.data[id] = 0;
          this.layerCount[j]--;
          this.chunks[Math.floor(j / CHUNK)].dirty = true;
        }
      }
    }
  }

  // Самый тонкий слой: там дерево и сломается.
  weakest() {
    let best = 0;
    for (let j = 1; j < this.ny; j++) if (this.layerCount[j] < this.layerCount[best]) best = j;
    return { layer: best, share: this.layerCount[best] / this.full };
  }

  // Центр тяжести древесины в слое и её самая дальняя точка вдоль направления.
  layerCentroid(j) {
    let cx = 0, cz = 0, count = 0;
    this.eachInLayer(j, (x, z) => { cx += x; cz += z; count++; });
    return count ? { x: cx / count, z: cz / count } : { x: 0, z: 0 };
  }

  farthestAlong(j, dir) {
    let best = 0;
    this.eachInLayer(j, (x, z) => { best = Math.max(best, x * dir.x + z * dir.z); });
    return best;
  }

  eachInLayer(j, fn) {
    const { n } = this;
    for (let k = 0; k < n; k++) {
      for (let i = 0; i < n; i++) if (this.at(i, j, k)) fn(this.x(i), this.z(k), i, k);
    }
  }

  // Отделяет всё выше слоя layer в новую сетку (верхушка, которая падает); здесь остаётся пень.
  split(layer) {
    const top = new TrunkVoxels(this.radius, this.height, this.material);
    const cut = (layer + 1) * this.n * this.n;
    top.data.set(this.data);
    top.layerCount.set(this.layerCount);
    top.data.fill(0, 0, cut);
    top.layerCount.fill(0, 0, layer + 1);
    this.data.fill(0, cut);
    this.layerCount.fill(0, layer + 1);
    this.chunks.forEach((c) => { c.dirty = true; });
    top.remesh();
    this.remesh();
    return top;
  }

  remesh() {
    this.chunks.forEach((chunk, c) => {
      if (!chunk.dirty) return;
      chunk.dirty = false;
      chunk.mesh.geometry.dispose();
      chunk.mesh.geometry = this.buildChunk(c * CHUNK, Math.min((c + 1) * CHUNK, this.ny));
    });
  }

  // Рисуем только грани между древесиной и пустотой. Кора гладкая: нормаль у неё радиальная,
  // а не по грани кубика, иначе ствол выглядит лесенкой из светлых и тёмных полос.
  // Кусок перестраивается каждый кадр пиления, поэтому пишем в заранее выделенные массивы, без push.
  buildChunk(j0, j1) {
    const { n, ny, data, inside, half } = this;
    const out = scratch;
    out.faces = 0;
    for (let j = j0; j < j1; j++) {
      for (let k = 0; k < n; k++) {
        for (let i = 0; i < n; i++) {
          if (!data[(j * n + k) * n + i]) continue;
          for (let f = 0; f < 6; f++) {
            const { dir, corners } = FACES[f];
            const ii = i + dir[0], jj = j + dir[1], kk = k + dir[2];
            if (jj < 0 || jj >= ny) continue; // снизу земля, сверху продолжается ствол
            const outside = ii < 0 || kk < 0 || ii >= n || kk >= n;
            if (!outside && data[(jj * n + kk) * n + ii]) continue;
            const bark = outside || !inside[kk * n + ii];
            let nx = dir[0], nyy = dir[1], nz = dir[2];
            if (bark) {
              const x = this.x(i), z = this.z(k), r = Math.hypot(x, z);
              nx = x / r; nyy = 0; nz = z / r;
            }
            out.reserve();
            const color = bark ? BARK : WOOD;
            let v = out.faces * 12;
            for (let c = 0; c < 4; c++, v += 3) {
              const corner = corners[c];
              out.pos[v] = (i + corner[0]) * VOXEL - half;
              out.pos[v + 1] = (j + corner[1]) * VOXEL;
              out.pos[v + 2] = (k + corner[2]) * VOXEL - half;
              out.nor[v] = nx; out.nor[v + 1] = nyy; out.nor[v + 2] = nz;
              out.col[v] = color.r; out.col[v + 1] = color.g; out.col[v + 2] = color.b;
            }
            out.faces++;
          }
        }
      }
    }
    const verts = out.faces * 12;
    const index = new Uint32Array(out.faces * 6);
    for (let f = 0; f < out.faces; f++) {
      const v = f * 4;
      index.set([v, v + 1, v + 2, v, v + 2, v + 3], f * 6);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(out.pos.slice(0, verts), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(out.nor.slice(0, verts), 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(out.col.slice(0, verts), 3));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    return geometry;
  }
}

// Общие черновые массивы граней на все куски; растут вдвое, когда не хватает места.
const scratch = {
  faces: 0,
  pos: new Float32Array(12 * 8192),
  nor: new Float32Array(12 * 8192),
  col: new Float32Array(12 * 8192),
  reserve() {
    if ((this.faces + 1) * 12 <= this.pos.length) return;
    for (const key of ['pos', 'nor', 'col']) {
      const grown = new Float32Array(this[key].length * 2);
      grown.set(this[key]);
      this[key] = grown;
    }
  },
};
