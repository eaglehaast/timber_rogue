import * as THREE from 'three';
import { barkMaterial, BARK_TILE } from './bark.js';
import { random } from './random.js';

// Низ ствола — сетка кубиков-вокселей: древесина есть или выпилена.
// Пила вырезает из неё настоящую щель, по оставшимся кубикам считается, держит ли недопил.
export const VOXEL = 0.01;
const CHUNK = 10; // слоёв в одном куске сетки; при пилении перестраиваются только задетые куски

// Срез — полоса колец в полярных координатах: по ширине один оборот вокруг оси, сверху сердцевина, снизу кора.
// Поверх в середине — сердцевина: плоская картинка с прозрачным краем, квадрат в полрадиуса ствола.
// У каждого дерева своя полоса и своя сердцевина.
const PITH = 0.5; // сторона квадрата сердцевины — доля радиуса ствола
const loader = new THREE.TextureLoader();
const load = (file) => {
  const texture = loader.load(file);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
};
const rings = [1, 2, 3, 4, 5].map((i) => {
  const texture = load(`assets/textures/end-grain-${i}.jpg`);
  texture.wrapS = THREE.RepeatWrapping;
  return texture;
});
const piths = [1, 2, 3, 4, 5].map((i) => load(`assets/textures/pith-${i}.png`));
const pithMap = { value: piths[0] };
const woodMaterial = new THREE.MeshLambertMaterial({ map: rings[0] });
woodMaterial.onBeforeCompile = (shader) => {
  shader.uniforms.pithMap = pithMap;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec2 pith;\nvarying vec2 vPith;')
    .replace('#include <uv_vertex>', '#include <uv_vertex>\nvPith = pith;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform sampler2D pithMap;\nvarying vec2 vPith;')
    .replace('#include <map_fragment>', `#include <map_fragment>
      vec4 pithColor = texture2D(pithMap, vPith);
      diffuseColor.rgb = mix(diffuseColor.rgb, pithColor.rgb, pithColor.a);`);
};

// Новое дерево — новый срез: какая полоса колец и какая сердцевина.
export function dressWood() {
  woodMaterial.map = rings[Math.floor(Math.random() * rings.length)];
  pithMap.value = piths[Math.floor(Math.random() * piths.length)];
}

// Углы грани кубика для каждого из шести направлений, по кругу снаружи.
const FACES = [
  { dir: [1, 0, 0], corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { dir: [-1, 0, 0], corners: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
  { dir: [0, 1, 0], corners: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },
  { dir: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { dir: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { dir: [0, 0, -1], corners: [[0, 1, 0], [1, 1, 0], [1, 0, 0], [0, 0, 0]] },
];

const rand = (a, b) => a + random() * (b - a);
const ANGLES = 720;
const TAPER = 0.04; // настолько (доля радиуса) ствол тоньшает на каждый метр вверх

// Низ ствола до высоты height. Сечение — не круг: эллипс, вытянутый в случайную сторону, и бугры
// от старых сучков (profile — радиус по азимуту, самый большой — radius). У земли ствол раздаётся
// корневыми наплывами, кверху тоньшает и клонится в сторону leanAz, всё круче.
export function trunkShape(radius, height, leanAz) {
  const flat = rand(0.04, 0.12);
  const turn = random() * Math.PI;
  const bumps = Array.from({ length: 2 + Math.floor(random() * 3) }, () => ({
    at: random() * Math.PI * 2, h: rand(0.02, 0.07), w: rand(0.15, 0.4),
  }));
  const raw = (a) => bumps.reduce(
    (r, b) => r + b.h * Math.exp(-((Math.atan2(Math.sin(a - b.at), Math.cos(a - b.at)) / b.w) ** 2)),
    1 - (flat * (1 - Math.cos(2 * (a - turn)))) / 2,
  );
  // Сечение считается при каждой проверке кубика, поэтому оно заранее разложено по углам.
  const table = Float32Array.from({ length: ANGLES }, (_, i) => raw((i / ANGLES) * 2 * Math.PI));
  const top = Math.max(...table);
  const profile = (a) => (radius * table[Math.round((a / (2 * Math.PI)) * ANGLES + ANGLES) % ANGLES]) / top;

  const flare = rand(0.15, 0.3);
  const slope = Math.tan(THREE.MathUtils.degToRad(rand(1, 4)));
  const bow = rand(0, 0.02);
  const scale = (y) => 1 + flare * Math.exp(-y / 0.3) - TAPER * y;
  const off = (y) => slope * y + (bow * y * y) / 2;
  const lean = new THREE.Vector3(Math.cos(leanAz), 0, -Math.sin(leanAz));
  const center = (y) => lean.clone().multiplyScalar(off(y));
  return {
    radius, leanAz, profile, scale, center,
    // Направление оси ствола на высоте y.
    axis: (y) => lean.clone().multiplyScalar(slope + bow * y).setY(1).normalize(),
    // Под землёй ствола нет: там наплывы раздувались бы без конца.
    contains(x, y, z) {
      if (y < 0) return false;
      const dx = x - lean.x * off(y), dz = z - lean.z * off(y);
      return Math.hypot(dx, dz) <= scale(y) * profile(Math.atan2(dz, dx));
    },
    // Квадрат в плане, в который ствол помещается на всей высоте: середина и полуширина.
    mid: center(height / 2).setY(0),
    reach: radius * (1 + flare) + off(height) / 2 + VOXEL,
  };
}

export class TrunkVoxels {
  // shape — форма ствола (trunkShape): по ней кубики заполняются, а грань, за которой форма кончается, —
  // кора, остальные открытые грани — свежий срез. floor — с какого слоя (от земли) начинается сетка:
  // у отвалившихся кусков она не с нуля, но сетка в плане у всех кусков одна.
  constructor(shape, height, floor = 0) {
    this.shape = shape;
    this.radius = shape.radius;
    this.floor = floor;
    this.n = Math.ceil((2 * shape.reach) / VOXEL);
    this.ny = Math.round(height / VOXEL);
    this.x0 = shape.mid.x - (this.n * VOXEL) / 2;
    this.z0 = shape.mid.z - (this.n * VOXEL) / 2;

    this.data = new Uint8Array(this.n * this.n * this.ny);
    for (let j = 0, id = 0; j < this.ny; j++) {
      for (let k = 0; k < this.n; k++) {
        for (let i = 0; i < this.n; i++, id++) this.data[id] = this.wood(i, j, k) ? 1 : 0;
      }
    }
    // Волокна идут вдоль ствола, по колонкам кубиков. Для каждой колонки: сколько в ней выпилено,
    // нижний и верхний край выреза и наклон пропила, что её перерезал. version растёт с каждым кубиком.
    this.gap = new Uint16Array(this.n * this.n);
    this.gapLow = new Int16Array(this.n * this.n).fill(this.ny);
    this.gapHigh = new Int16Array(this.n * this.n).fill(-1);
    this.normals = new Float32Array(this.n * this.n * 3);
    this.version = 0;
    // Слои, где уже прошла пила: только в них что-то может отвалиться.
    this.cutLow = Infinity;
    this.cutHigh = -1;
    this.removed = []; // вырезанные с прошлой проверки на отвалившиеся куски
    this.floods = 0;

    this.group = new THREE.Group();
    this.group.position.y = floor * VOXEL;
    // Стоящий ствол (standing) клонится над пропилом: что выше пропила, рисуется в lift,
    // и его поворачивают вместе с верхом. Кусок, где проходит пропил, делится на две сетки.
    this.standing = false;
    this.lift = new THREE.Group();
    this.lift.position.y = floor * VOXEL;
    this.band = '';
    this.chunks = [];
    const mesh = () => {
      const m = new THREE.Mesh(new THREE.BufferGeometry(), [barkMaterial, woodMaterial]);
      m.castShadow = m.receiveShadow = true;
      return m;
    };
    for (let c = 0; c * CHUNK < this.ny; c++) {
      const chunk = { mesh: mesh(), top: mesh(), dirty: true, state: 'still' };
      this.group.add(chunk.mesh);
      this.lift.add(chunk.top);
      this.chunks.push(chunk);
    }
  }

  // Кубик слоя j появился или пропал: перестроить его кусок сетки и соседний, если слой на краю, —
  // грань между слоями рисует тот кусок, где лежит оставшийся кубик.
  touch(j) {
    const c = Math.floor(j / CHUNK), at = j - c * CHUNK;
    for (const k of [at === 0 ? c - 1 : c, c, at === CHUNK - 1 ? c + 1 : c]) {
      if (this.chunks[k]) this.chunks[k].dirty = true;
    }
  }

  // Кубик над пропилом — часть верха: в перерезанной колонке выше выреза, в целой — от высоты tear.
  above(j, col, tear) {
    return this.gap[col] ? j > this.gapHigh[col] : j >= tear;
  }

  // Слой, где ломается недопил стоящего ствола: середина полосы, где прошла пила.
  get middle() { return Math.round((this.cutLow + this.cutHigh) / 2); }

  // Кубик внутри формы ствола: древесина, пока её не выпилили.
  wood(i, j, k) { return this.shape.contains(this.x(i), (this.floor + j + 0.5) * VOXEL, this.z(k)); }

  x(i) { return this.x0 + (i + 0.5) * VOXEL; }
  y(j) { return (j + 0.5) * VOXEL; }
  z(k) { return this.z0 + (k + 0.5) * VOXEL; }
  at(i, j, k) { return this.data[(j * this.n + k) * this.n + i]; }

  neighbours(id) {
    const { n } = this;
    const layer = n * n;
    const rest = id % layer;
    const i = rest % n;
    const k = (rest - i) / n;
    const out = [];
    if (i > 0) out.push(id - 1);
    if (i < n - 1) out.push(id + 1);
    if (k > 0) out.push(id - n);
    if (k < n - 1) out.push(id + n);
    if (id >= layer) out.push(id - layer);
    if (id + layer < this.data.length) out.push(id + layer);
    return out;
  }

  // Кубик выпилен или выпал: волокно в его колонке перерезано.
  cutFibre(id, normal) {
    const layer = this.n * this.n;
    const j = Math.floor(id / layer);
    const col = id - j * layer;
    this.gap[col]++;
    this.gapLow[col] = Math.min(this.gapLow[col], j);
    this.gapHigh[col] = Math.max(this.gapHigh[col], j);
    if (normal) this.normals.set([normal.x, normal.y, normal.z], col * 3);
    this.version++;
  }

  // Есть ли древесина в точке p.
  solid(p) {
    const i = Math.floor((p.x - this.x0) / VOXEL);
    const j = Math.floor(p.y / VOXEL) - this.floor;
    const k = Math.floor((p.z - this.z0) / VOXEL);
    if (i < 0 || k < 0 || j < 0 || i >= this.n || k >= this.n || j >= this.ny) return false;
    return this.at(i, j, k) === 1;
  }

  // Вырезает щель пилы: кубики, чьи центры лежат в плоскости полотна (толщина — один кубик без дыр
  // при любом наклоне), от from до to по ходу пилы от origin и в пределах длины шины.
  carve({ origin, along, side, normal }, from, to, barLength) {
    const halfT = 0.5 * VOXEL * (Math.abs(normal.x) + Math.abs(normal.y) + Math.abs(normal.z));
    // Плоскость пологая (наклон не больше 60°): в каждой колонке её пересекают единицы кубиков —
    // те, чьи центры лежат в полуинтервале [низ, верх). Нормаль смотрим вверх, чтобы низ был снизу.
    // Толщина в колонке — layers ≥ 1 слоя, и номера слоёв считаются от одного t, поэтому
    // хоть один кубик в колонку попадает всегда, как бы ни округлялись дроби.
    const up = normal.y < 0 ? -1 : 1;
    const nx = normal.x * up, ny = normal.y * up, nz = normal.z * up;
    const layers = (2 * halfT) / (ny * VOXEL);
    const { n } = this;
    for (let k = 0; k < n; k++) {
      for (let i = 0; i < n; i++) {
        const dx = this.x(i) - origin.x;
        const dz = this.z(k) - origin.z;
        const t = (origin.y - (halfT + dx * nx + dz * nz) / ny) / VOXEL - 0.5;
        const j0 = Math.max(0, Math.ceil(t));
        const j1 = Math.min(this.ny - 1, Math.ceil(t + layers) - 1);
        for (let j = j0; j <= j1; j++) {
          const id = (j * n + k) * n + i;
          if (!this.data[id]) continue;
          const dy = this.y(j) - origin.y;
          const s = dx * along.x + dy * along.y + dz * along.z;
          const w = dx * side.x + dy * side.y + dz * side.z;
          if (s < from || s > to || Math.abs(w) > barLength / 2) continue;
          this.data[id] = 0;
          this.cutFibre(id, normal);
          this.touch(j);
          this.cutLow = Math.min(this.cutLow, j);
          this.cutHigh = Math.max(this.cutHigh, j);
          this.removed.push(id);
        }
      }
    }
  }

  // Куски, которые пропилы отрезали от всего: ни с пнём снизу, ни со стволом сверху не связаны.
  // Отвалиться может только то, что граничит с только что вырезанными кубиками, поэтому заливку
  // запускаем от их соседей. Ниже и выше полосы, где работала пила, ствол цельный: кто дотянулся
  // до её края или до уже признанного держащимся куска — держится, и заливка сразу обрывается.
  // Вверх-вниз идём в первую очередь, так до края полосы обычно доходим за несколько шагов.
  // Что залилось целиком, не дотянувшись, — отвалилось и переносится в свою сетку.
  breakLoose() {
    const seeds = this.removed;
    this.removed = [];
    if (!seeds.length) return [];
    const { n, data } = this;
    const layer = n * n;
    const lo = this.cutLow - 1;
    const hi = this.cutHigh + 1;
    this.stamp ??= new Int32Array(data.length);
    const { stamp } = this;
    const first = this.floods + 1; // метки прошлых вызовов устарели: с тех пор пила могла что-то отрезать
    const held = new Set();
    const pieces = [];

    const flood = (start) => {
      const no = ++this.floods;
      const piece = [];
      const stack = [start];
      stamp[start] = no;
      while (stack.length) {
        const id = stack.pop();
        piece.push(id);
        const j = Math.floor(id / layer);
        if (j <= lo || j >= hi) return held.add(no);
        for (const nb of this.neighbours(id)) {
          if (!data[nb]) continue;
          if (stamp[nb] >= first) {
            if (held.has(stamp[nb])) return held.add(no);
            continue;
          }
          stamp[nb] = no;
          stack.push(nb);
        }
      }
      piece.forEach((id) => this.cutFibre(id));
      pieces.push(this.detach(piece));
    };

    for (const id of seeds) {
      for (const nb of this.neighbours(id)) if (data[nb] && stamp[nb] < first) flood(nb);
    }
    return pieces;
  }

  // Отделяет верхушку, которая падает; здесь остаётся пень. Перерезанная колонка делится по выпилу:
  // что выше него — верх. Целые колонки недопила рвутся на высоте h, а отщепившиеся (tongue —
  // их номера) — выше на длину отщепа split: полоса остаётся на пне, в комле верха — жёлоб.
  // Кусок между двумя пропилами в одной колонке уходит с верхом, если держится за него сбоку, иначе остаётся на пне.
  splitTop(h, tongue = new Set(), split = 0) {
    const { n, data, gap, gapLow, gapHigh } = this;
    const layer = n * n;
    this.standing = false;
    const tear = Math.round(h / VOXEL);
    const tongueTear = Math.min(this.ny - 1, Math.round((h + split) / VOXEL));
    const top = new Uint8Array(data.length);
    const between = (id) => {
      const j = Math.floor(id / layer);
      const col = id - j * layer;
      return gap[col] > 0 && j > gapLow[col] && j < gapHigh[col];
    };
    // Колонки у коры, что в полосе пропилов выходят из ствола (rim): ствол клонится, а колонки отвесные,
    // и на крутом резе их много. По высоте их не разделить — в каждом слое они идут туда же,
    // куда соседняя древесина: кора под косым резом остаётся на пне, кора рядом с отщепом — на отщепе.
    const rim = new Uint8Array(layer);
    for (let col = 0; col < layer; col++) {
      if (gap[col]) continue;
      let wood = false, air = false;
      for (let j = this.cutLow; j <= this.cutHigh; j++) {
        if (data[j * layer + col]) wood = true;
        else air = true;
      }
      rim[col] = wood && air ? 1 : 0;
    }
    const last = Math.max(this.cutHigh, tongueTear);
    const stack = [];
    for (let id = 0; id < data.length; id++) {
      if (!data[id]) continue;
      const j = Math.floor(id / layer);
      const col = id - j * layer;
      if (rim[col] && j >= this.cutLow && j <= last) continue;
      if (this.above(j, col, tongue.has(col) ? tongueTear : tear)) {
        top[id] = 1;
        stack.push(id);
      }
    }
    for (let j = this.cutLow; j <= last; j++) {
      const known = new Uint8Array(layer);
      const queue = [];
      for (let col = 0; col < layer; col++) if (data[j * layer + col] && !rim[col]) { known[col] = 1; queue.push(col); }
      for (let q = 0; q < queue.length; q++) {
        const col = queue[q];
        const i = col % n;
        for (const nb of [i > 0 ? col - 1 : -1, i < n - 1 ? col + 1 : -1, col - n, col + n]) {
          if (nb < 0 || nb >= layer || known[nb] || !rim[nb] || !data[j * layer + nb]) continue;
          known[nb] = 1;
          queue.push(nb);
          if (top[j * layer + col]) {
            top[j * layer + nb] = 1;
            stack.push(j * layer + nb);
          }
        }
      }
      // Обрывок колонки, не связанный в слое ни с чем, решаем по высоте, как раньше.
      for (let col = 0; col < layer; col++) {
        const id = j * layer + col;
        if (rim[col] && data[id] && !known[col] && this.above(j, col, tear)) {
          top[id] = 1;
          stack.push(id);
        }
      }
    }
    while (stack.length) {
      for (const nb of this.neighbours(stack.pop())) {
        if (data[nb] && !top[nb] && between(nb)) {
          top[nb] = 1;
          stack.push(nb);
        }
      }
    }
    const ids = [];
    for (let id = 0; id < data.length; id++) if (top[id]) ids.push(id);
    return this.detach(ids);
  }

  // Трещина отщепа: вдоль кромки пропила, в перерезанных колонках рядом с отщепляющимися (tongue),
  // древесина над пропилом расходится вверх на split. Это раскол, а не пропил: волокна колонок
  // уже перерезаны, считать их заново не нужно.
  splinter(tongue, split) {
    const { n, data, gap, gapHigh } = this;
    const depth = Math.round(split / VOXEL);
    for (const col of tongue) {
      const i = col % n, k = (col - i) / n;
      for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + di, kk = k + dk;
        if (ii < 0 || kk < 0 || ii >= n || kk >= n) continue;
        const nb = kk * n + ii;
        if (!gap[nb]) continue;
        for (let j = gapHigh[nb] + 1; j <= Math.min(this.ny - 1, gapHigh[nb] + depth); j++) {
          if (!data[j * n * n + nb]) continue;
          data[j * n * n + nb] = 0;
          this.touch(j);
        }
      }
    }
  }

  // Переносит перечисленные кубики в новую сетку высотой ровно в их слои — отдельное тело.
  // Заодно считает его центр и нижнюю точку (в координатах ствола): по ним кусок падает на землю.
  detach(ids) {
    const layer = this.n * this.n;
    let jLow = Infinity, jHigh = -1;
    for (const id of ids) {
      const j = Math.floor(id / layer);
      jLow = Math.min(jLow, j);
      jHigh = Math.max(jHigh, j);
    }
    const part = new TrunkVoxels(this.shape, (jHigh - jLow + 1) * VOXEL, this.floor + jLow);
    part.data.fill(0);
    part.chunks.forEach((c) => { c.dirty = false; });
    for (const id of ids) {
      const j = Math.floor(id / layer);
      part.data[id - jLow * layer] = 1;
      part.touch(j - jLow);
      this.data[id] = 0;
      this.touch(j);
    }
    part.center = part.measure().center;
    part.low = part.floor * VOXEL;
    part.remesh();
    this.remesh();
    return part;
  }

  // Объём древесины и её центр (в координатах ствола).
  measure() {
    const { n, data } = this;
    const center = new THREE.Vector3();
    let count = 0;
    for (let j = 0, id = 0; j < this.ny; j++) {
      for (let k = 0; k < n; k++) {
        for (let i = 0; i < n; i++, id++) {
          if (!data[id]) continue;
          center.x += this.x(i);
          center.y += (this.floor + j + 0.5) * VOXEL;
          center.z += this.z(k);
          count++;
        }
      }
    }
    return { volume: count * VOXEL ** 3, center: center.divideScalar(count) };
  }

  // Кусок целиком над полосой пропилов клонится весь, целиком под ней — стоит, а через который
  // она проходит, делится на две сетки и перестраивается, когда полоса меняется.
  remesh() {
    const cut = this.standing && this.cutHigh >= 0;
    const band = cut ? `${this.cutLow} ${this.cutHigh}` : '';
    const moved = band !== this.band;
    this.band = band;
    this.chunks.forEach((chunk, c) => {
      const state = !cut || (c + 1) * CHUNK <= this.cutLow ? 'still' : c * CHUNK > this.cutHigh ? 'lifted' : 'split';
      if (state === 'split' && moved) chunk.dirty = true;
      if ((state === 'split') !== (chunk.state === 'split')) chunk.dirty = true;
      chunk.state = state;
      (state === 'lifted' ? this.lift : this.group).add(chunk.mesh);
      if (!chunk.dirty) return;
      chunk.dirty = false;
      chunk.mesh.geometry.dispose();
      chunk.top.geometry.dispose();
      const [still, top] = this.buildChunk(c * CHUNK, Math.min((c + 1) * CHUNK, this.ny), state === 'split');
      chunk.mesh.geometry = still;
      chunk.top.geometry = top;
    });
  }

  // Нормаль свежего среза у кубика (i, j, k): куда в среднем смотрит пустота вокруг него в кубе 5×5×5.
  // Косой пропил в кубиках — лесенка, а освещать его надо как ровную плоскость, иначе ступеньки
  // через одну тёмные и срез выглядит рваными волокнами. Ниже сетки — земля, выше — ствол: там пустоты нет.
  // Тонкая пластинка, у которой пустота с обеих сторон поровну, смотрит туда же, куда сама грань dir.
  cutNormal(i, j, k, dir) {
    const { n, ny, data } = this;
    let [x, y, z] = dir;
    for (let dj = -2; dj <= 2; dj++) {
      const jj = j + dj;
      if (jj < 0 || jj >= ny) continue;
      for (let dk = -2; dk <= 2; dk++) {
        const kk = k + dk;
        for (let di = -2; di <= 2; di++) {
          const ii = i + di;
          if (ii >= 0 && kk >= 0 && ii < n && kk < n && data[(jj * n + kk) * n + ii]) continue;
          x += di; y += dj; z += dk;
        }
      }
    }
    const l = Math.hypot(x, y, z);
    return [x / l, y / l, z / l];
  }

  // Рисуем только грани между древесиной и пустотой. Кора гладкая: нормаль у неё радиальная,
  // а не по грани кубика, иначе ствол выглядит лесенкой из светлых и тёмных полос.
  // Текстура коры натянута на цилиндр вокруг оси ствола: u — вдоль окружности, v — по высоте от земли, обе в метрах.
  // Кора и свежий срез — две группы граней со своими материалами.
  // Кусок перестраивается каждый кадр пиления, поэтому пишем в заранее выделенные массивы, без push.
  // split — разделить грани на две сетки: под пропилом и над ним (above).
  buildChunk(j0, j1, split) {
    const { n, ny, data, x0, z0 } = this;
    const out = scratch;
    const tear = this.middle;
    out.faces = 0;
    for (let j = j0; j < j1; j++) {
      const axis = this.shape.center((this.floor + j + 0.5) * VOXEL);
      const size = this.shape.scale((this.floor + j + 0.5) * VOXEL);
      for (let k = 0; k < n; k++) {
        for (let i = 0; i < n; i++) {
          if (!data[(j * n + k) * n + i]) continue;
          const lifted = split && this.above(j, k * n + i, tear);
          for (let f = 0; f < 6; f++) {
            const { dir, corners } = FACES[f];
            const ii = i + dir[0], jj = j + dir[1], kk = k + dir[2];
            if (jj < 0 || jj >= ny) continue; // снизу земля, сверху продолжается ствол
            const outside = ii < 0 || kk < 0 || ii >= n || kk >= n;
            if (!outside && data[(jj * n + kk) * n + ii]) continue;
            const bark = outside || !this.wood(ii, jj, kk);
            let nx = dir[0], nyy = dir[1], nz = dir[2];
            const a = Math.atan2(this.z(k) - axis.z, this.x(i) - axis.x);
            if (bark) {
              nx = Math.cos(a); nyy = 0; nz = Math.sin(a);
            } else {
              [nx, nyy, nz] = this.cutNormal(i, j, k, dir);
            }
            out.reserve();
            out.bark[out.faces] = bark ? 1 : 0;
            out.lift[out.faces] = lifted ? 1 : 0;
            let v = out.faces * 12, t = out.faces * 8;
            for (let c = 0; c < 4; c++, v += 3, t += 2) {
              const corner = corners[c];
              const px = x0 + (i + corner[0]) * VOXEL, pz = z0 + (k + corner[2]) * VOXEL;
              out.pos[v] = px;
              out.pos[v + 1] = (j + corner[1]) * VOXEL;
              out.pos[v + 2] = pz;
              out.nor[v] = nx; out.nor[v + 1] = nyy; out.nor[v + 2] = nz;
              const around = Math.atan2(pz - axis.z, px - axis.x);
              const turn = a + Math.atan2(Math.sin(around - a), Math.cos(around - a));
              if (bark) {
                out.uv[t] = (turn * this.radius) / BARK_TILE;
                out.uv[t + 1] = ((this.floor + j + corner[1]) * VOXEL) / BARK_TILE;
              } else {
                // Древесина — в полярных координатах: u — доля оборота, v — от коры (0) к сердцевине (1).
                // Радиус меряем долей профиля, поэтому годичные кольца повторяют форму ствола.
                out.uv[t] = turn / (2 * Math.PI);
                out.uv[t + 1] = 1 - Math.hypot(px - axis.x, pz - axis.z) / (size * this.shape.profile(around));
                out.pith[t] = 0.5 + (px - axis.x) / (PITH * size * this.shape.radius);
                out.pith[t + 1] = 0.5 + (pz - axis.z) / (PITH * size * this.shape.radius);
              }
            }
            out.faces++;
          }
        }
      }
    }
    const verts = out.faces * 12;
    const position = new THREE.BufferAttribute(out.pos.slice(0, verts), 3);
    const normal = new THREE.BufferAttribute(out.nor.slice(0, verts), 3);
    const uv = new THREE.BufferAttribute(out.uv.slice(0, out.faces * 8), 2);
    const pith = new THREE.BufferAttribute(out.pith.slice(0, out.faces * 8), 2);
    // Две сетки на одних вершинах: в каждой свои грани, сначала кора, потом срез.
    let lifted = 0;
    for (let f = 0; f < out.faces; f++) lifted += out.lift[f];
    return [0, 1].map((lift) => {
      const index = new Uint32Array((lift ? lifted : out.faces - lifted) * 6);
      let at = 0, barkFaces = 0;
      for (const pass of [1, 0]) {
        for (let f = 0; f < out.faces; f++) {
          if (out.bark[f] !== pass || out.lift[f] !== lift) continue;
          const v = f * 4;
          index.set([v, v + 1, v + 2, v, v + 2, v + 3], at);
          at += 6;
          barkFaces += pass;
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', position);
      geometry.setAttribute('normal', normal);
      geometry.setAttribute('uv', uv);
      geometry.setAttribute('pith', pith);
      geometry.setIndex(new THREE.BufferAttribute(index, 1));
      geometry.addGroup(0, barkFaces * 6, 0);
      geometry.addGroup(barkFaces * 6, index.length - barkFaces * 6, 1);
      return geometry;
    });
  }
}

// Общие черновые массивы граней на все куски; растут вдвое, когда не хватает места.
const scratch = {
  faces: 0,
  pos: new Float32Array(12 * 8192),
  nor: new Float32Array(12 * 8192),
  uv: new Float32Array(8 * 8192),
  pith: new Float32Array(8 * 8192),
  bark: new Uint8Array(8192),
  lift: new Uint8Array(8192),
  reserve() {
    if ((this.faces + 1) * 12 <= this.pos.length) return;
    for (const key of ['pos', 'nor', 'uv', 'pith', 'bark', 'lift']) {
      const grown = new this[key].constructor(this[key].length * 2);
      grown.set(this[key]);
      this[key] = grown;
    }
  },
};
