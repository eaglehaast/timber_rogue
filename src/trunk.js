import * as THREE from 'three';
import { BARK_TILE } from './bark.js';
import { random } from './random.js';

// Низ ствола — сетка кубиков-вокселей: древесина есть или выпилена.
// Пила вырезает из неё настоящую щель, по оставшимся кубикам считается, держит ли недопил.
export const VOXEL = 0.01;
const CHUNK = 10; // слоёв в одном куске сетки; при пилении перестраиваются только задетые куски

// Срез — полоса колец в полярных координатах: по ширине один оборот вокруг оси, сверху сердцевина, снизу кора.
// Поверх в середине — сердцевина: плоская картинка с прозрачным краем, квадрат в полрадиуса ствола.
// У каждого дерева своя полоса и своя сердцевина.
// На гранях вдоль ствола (стенки отщепа и раскола) та же полоса колец сама вытягивается по высоте: годичные
// слои идут полосами во всю длину стенки, у коры — кромка камбия. Поверх них — рельеф рваных волокон:
// яркость картинки-сплита, плитка SPLIT_W × SPLIT_H метров, вытянутая по высоте, как сами волокна.
// Торец и стенка смешиваются по нормали: чем круче грань, тем больше рельефа волокон.
const SPLIT_W = 0.3, SPLIT_H = 1.2;
const FIBRE = 0.6; // насколько рельеф волокон темнит и светлит полосы колец
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
const splits = [1].map((i) => {
  const texture = load(`assets/textures/split-${i}.jpg`);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
});
const woodShader = (shader) => {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
      attribute vec2 pith;
      attribute vec2 grain;
      varying vec2 vPith;
      varying vec2 vGrain;
      varying float vEnd;`)
    .replace('#include <uv_vertex>', `#include <uv_vertex>
      vPith = pith;
      vGrain = grain;
      vEnd = smoothstep(0.5, 0.8, abs(normal.y));`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
      uniform sampler2D pithMap;
      uniform sampler2D splitMap;
      uniform vec2 splitShift;
      varying vec2 vPith;
      varying vec2 vGrain;
      varying float vEnd;`)
    .replace('#include <map_fragment>', `#include <map_fragment>
      vec4 pithColor = texture2D(pithMap, vPith);
      diffuseColor.rgb = mix(diffuseColor.rgb, pithColor.rgb, pithColor.a * vEnd);
      const vec3 luma = vec3(0.299, 0.587, 0.114);
      float fibre = dot(texture2D(splitMap, vGrain + splitShift).rgb, luma) / dot(textureLod(splitMap, vec2(0.5), 12.0).rgb, luma);
      diffuseColor.rgb *= mix(1.0, fibre, ${FIBRE.toFixed(2)} * (1.0 - vEnd));`);
};

// Срез нового дерева, свой у каждого: какая полоса колец, какая сердцевина и откуда начинается узор волокон.
export function dressWood() {
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const uniforms = {
    pithMap: { value: pick(piths) },
    splitMap: { value: pick(splits) },
    splitShift: { value: new THREE.Vector2(Math.random(), Math.random()) },
  };
  const material = new THREE.MeshLambertMaterial({ map: pick(rings) });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    woodShader(shader);
  };
  return material;
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
const TWIN = 0.35;  // какая доля деревьев — двойной ствол от общего комля

// Один ствол низа до высоты height. Сечение — не круг: эллипс, вытянутый в случайную сторону, и бугры
// от старых сучков (profile — радиус по азимуту, самый большой — radius). У земли ствол раздаётся
// корневыми лапами: 4–7 рёбер, между ними впадины. Кверху лапы сходят на нет рёбрами по стволу,
// а у земли часть из них уходит в стороны корнями (lobes — где и какие).
// center(y) — ось ствола на высоте y. У ствола двойного дерева лапы только с наружной стороны
// (outward — азимут, куда она смотрит): с другой стороны к нему прирос второй ствол.
// outline(a, y) — радиус ствола на высоте y по азимуту a от оси.
function stemShape(radius, center, leanAz, outward = null) {
  const flat = rand(0.04, 0.12);
  const turn = random() * Math.PI;
  const bumps = Array.from({ length: 2 + Math.floor(random() * 3) }, () => ({
    at: random() * Math.PI * 2, h: rand(0.02, 0.07), w: rand(0.15, 0.4),
  }));
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const raw = (a) => bumps.reduce(
    (r, b) => r + b.h * Math.exp(-((wrap(a - b.at) / b.w) ** 2)),
    1 - (flat * (1 - Math.cos(2 * (a - turn)))) / 2,
  );
  // Сечение считается при каждой проверке кубика, поэтому оно заранее разложено по углам.
  const table = (f) => Float32Array.from({ length: ANGLES }, (_, i) => f((i / ANGLES) * 2 * Math.PI));
  const index = (a) => Math.round((a / (2 * Math.PI)) * ANGLES + ANGLES) % ANGLES;
  const shapeTable = table(raw);
  const top = Math.max(...shapeTable);
  const profile = (a) => (radius * shapeTable[index(a)]) / top;

  // Лапы стоят примерно поровну по кругу (или по наружной половине). size — насколько лапа у земли
  // выступает (доля радиуса), fade — за какую высоту она ослабевает в e раз, w — её ширина по углу.
  // У части лап над землёй выходит корень: лапа у самой земли тянется дальше узким низким гребнем.
  // root — на сколько дальше (м), rootH — на какой высоте корень сходит на нет, ширина — вдвое уже лапы.
  const count = outward === null ? 4 + Math.floor(random() * 4) : 2 + Math.floor(random() * 3);
  const phase = outward === null ? random() * Math.PI * 2 : outward - Math.PI / 2;
  const spread = outward === null ? 2 * Math.PI : Math.PI;
  const lobes = Array.from({ length: count }, (_, i) => {
    const at = phase + ((i + (outward === null ? 0 : 0.5) + rand(-0.3, 0.3)) / count) * spread;
    const w = rand(0.18, 0.32);
    const ridge = (width) => table((a) => Math.exp(-((wrap(a - at) / width) ** 2)));
    return {
      at, size: rand(0.3, 0.8), fade: rand(0.25, 0.5), w, ridge: ridge(w),
      root: random() < 0.5 ? rand(0.12, 0.3) : 0, rootH: rand(0.06, 0.12), narrow: ridge(w * 0.45),
    };
  });

  const flare = rand(0.08, 0.15);
  const scale = (y) => 1 + flare * Math.exp(-y / 0.3) - TAPER * y;
  // Кубики проверяются слой за слоем, поэтому для последнего слоя запоминаем высоты лап и границы:
  // дальше far — точно не ствол, ближе near — точно ствол, считать контур нужно только между ними.
  const low = Math.min(...shapeTable) / top;
  const lobeR = new Float32Array(count), rootR = new Float32Array(count), rootD = new Float32Array(count);
  let layerY = NaN, near = 0, far = 0, axisX = 0, axisZ = 0;
  const layer = (y) => {
    if (y === layerY) return;
    layerY = y;
    ({ x: axisX, z: axisZ } = center(y));
    far = scale(y) * radius;
    lobes.forEach((l, n) => {
      const left = Math.max(0, 1 - y / l.rootH); // сколько осталось до верха корня
      lobeR[n] = radius * l.size * Math.exp(-y / l.fade);
      rootR[n] = l.root * left * left;
      rootD[n] = (-2 * l.root * left) / l.rootH;
      far += lobeR[n] + rootR[n];
    });
    near = scale(y) * radius * low;
  };
  const at = (i, y) => {
    let r = (scale(y) * radius * shapeTable[i]) / top;
    for (let n = 0; n < count; n++) r += lobeR[n] * lobes[n].ridge[i] + rootR[n] * lobes[n].narrow[i];
    return r;
  };
  const outline = (a, y) => {
    layer(y);
    return at(index(a), y);
  };
  // Нормаль коры в точке на азимуте a, высоте y, на расстоянии d от оси: поверхность d = outline(a, y),
  // поэтому нормаль — от оси, с поправкой на то, как контур меняется по углу и по высоте. На лапах она
  // смотрит вбок и вверх, вдоль склона лапы, а не вбок, как у прямого ствола.
  const STEP = (2 * Math.PI) / ANGLES;
  const normal = (a, y, d) => {
    layer(y);
    const i = index(a);
    const dA = (at((i + 1) % ANGLES, y) - at((i + ANGLES - 1) % ANGLES, y)) / (2 * STEP);
    let dY = ((-flare / 0.3) * Math.exp(-y / 0.3) - TAPER) * profile(a);
    for (let n = 0; n < count; n++) dY += -(lobeR[n] / lobes[n].fade) * lobes[n].ridge[i] + rootD[n] * lobes[n].narrow[i];
    const c = Math.cos(a), sn = Math.sin(a), t = dA / d;
    const nx = c + t * sn, nz = sn - t * c, ny = -dY;
    const len = Math.hypot(nx, ny, nz);
    return [nx / len, ny / len, nz / len];
  };
  return {
    radius, leanAz, profile, scale, outline, normal, center, lobes,
    // Направление оси ствола на высоте y.
    axis: (y) => center(y + 0.01).sub(center(y - 0.01)).divideScalar(0.02).setY(1).normalize(),
    // Под землёй ствола нет: там лапы раздувались бы без конца.
    contains(x, y, z) {
      if (y < 0) return false;
      layer(y);
      const dx = x - axisX, dz = z - axisZ;
      const d = Math.hypot(dx, dz);
      return d <= near || (d <= far && d <= outline(Math.atan2(dz, dx), y));
    },
    // Дальше этого от оси ствол не выходит ни на какой высоте.
    extent: radius * (1 + flare) + Math.max(...lobes.map((l) => radius * l.size + l.root)),
  };
}

// Низ дерева до высоты height: один ствол или (TWIN — как часто) два от общего комля. Кверху ствол
// тоньшает и клонится в сторону leanAz, всё круче. Два ствола ниже развилки срослись, и сечение там
// восьмёркой, выше расходятся под углом. Ствол потолще стоит ближе к общей оси, второй уходит вбок.
// При узком угле в развилке зажата кора: её щель уходит от развилки вниз между стволами, и ниже
// развилки на эту глубину стволы держатся друг за друга только краями, а не срослись.
// stems — стволы, of(x, y, z) — к какому стволу относится точка, bits — маска стволов, в которых она.
export function trunkShape(radius, height, leanAz) {
  const slope = Math.tan(THREE.MathUtils.degToRad(rand(1, 4)));
  const bow = rand(0, 0.02);
  const lean = new THREE.Vector3(Math.cos(leanAz), 0, -Math.sin(leanAz));
  const base = (y) => lean.clone().multiplyScalar(slope * y + (bow * y * y) / 2);
  if (random() >= TWIN) return stemsShape([stemShape(radius, base, leanAz)], radius, leanAz, height, () => false);

  const fork = rand(0.3, 2.8);
  const r1 = radius * rand(0.68, 0.78), r2 = r1 * rand(0.75, 1);
  const az = random() * Math.PI * 2;
  const dir = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
  const angle = rand(0.25, 0.8); // рад — угол между стволами выше развилки
  const touch = 0.95 * (r1 + r2);
  const sep = (y) => (y < fork ? touch * (0.3 + 0.7 * (y / fork) ** 2) : touch + 2 * Math.tan(angle / 2) * (y - fork));
  const center = (side, share) => (y) => base(y).addScaledVector(dir, side * share * sep(y));
  const stems = [
    stemShape(r1, center(-1, r2 / (r1 + r2)), leanAz, az + Math.PI),
    stemShape(r2, center(1, r1 / (r1 + r2)), leanAz, az),
  ];
  // Вросшая кора: щель толщиной в два кубика там, где стволы заходят друг в друга, — по линии,
  // где их контуры пересекаются (по радиусам; лапы и бугры здесь не в счёт).
  const depth = angle < 0.5 ? Math.min(fork, rand(0.15, 0.6)) : 0;
  const seam = (x, y, z) => {
    if (y > fork || y < fork - depth) return false;
    const a = stems[0].center(y), d = sep(y);
    const ra = r1 * stems[0].scale(y), rb = r2 * stems[1].scale(y);
    const meet = (d * d + ra * ra - rb * rb) / (2 * d);
    return Math.abs((x - a.x) * dir.x + (z - a.z) * dir.z - meet) < VOXEL
      && stems[0].contains(x, y, z) && stems[1].contains(x, y, z);
  };
  return stemsShape(stems, radius, leanAz, height, seam);
}

function stemsShape(stems, radius, leanAz, height, seam) {
  const ys = [0, height / 2, height];
  const mid = stems.reduce((m, s) => m.add(s.center(height / 2)), new THREE.Vector3()).divideScalar(stems.length).setY(0);
  const reach = (axis) => Math.max(...stems.flatMap((s) => ys.map((y) => Math.abs(s.center(y)[axis] - mid[axis]) + s.extent))) + VOXEL;
  // Кому принадлежит точка: тому стволу, в контуре которого она глубже всего.
  const of = (x, y, z) => {
    if (stems.length === 1) return 0;
    let best = 0, depth = Infinity;
    stems.forEach((s, i) => {
      const c = s.center(y), dx = x - c.x, dz = z - c.z;
      const k = Math.hypot(dx, dz) / s.outline(Math.atan2(dz, dx), y);
      if (k < depth) { depth = k; best = i; }
    });
    return best;
  };
  return {
    stems, radius, leanAz, of, seam, mid,
    // Прямоугольник в плане, в который стволы помещаются на всей высоте: середина и полуширины.
    reach: { x: reach('x'), z: reach('z') },
    // Маска стволов, в контуре которых точка (щель вросшей коры не в счёт).
    inside: (x, y, z) => stems.reduce((m, s, i) => (s.contains(x, y, z) ? m | (1 << i) : m), 0),
    contains: (x, y, z) => stems.some((s) => s.contains(x, y, z)) && !seam(x, y, z),
  };
}

export class TrunkVoxels {
  // shape — форма ствола (trunkShape): по ней кубики заполняются, а грань, за которой форма кончается, —
  // кора, остальные открытые грани — свежий срез. floor — с какого слоя (от земли) начинается сетка:
  // у отвалившихся кусков она не с нуля, но сетка в плане у всех кусков одна.
  // skin — материалы коры и среза этого дерева (dressBark, dressWood): куски берут их от ствола.
  constructor(shape, height, skin, floor = 0) {
    this.shape = shape;
    this.skin = skin;
    this.radius = shape.radius;
    this.floor = floor;
    // Сетка в плане — прямоугольник вокруг ствола: n кубиков по x, m по z.
    this.n = Math.ceil((2 * shape.reach.x) / VOXEL);
    this.m = Math.ceil((2 * shape.reach.z) / VOXEL);
    this.ny = Math.round(height / VOXEL);
    this.x0 = shape.mid.x - (this.n * VOXEL) / 2;
    this.z0 = shape.mid.z - (this.m * VOXEL) / 2;

    this.data = new Uint8Array(this.n * this.m * this.ny);
    // top — верхний слой с древесиной в каждой колонке: выше него воздух, даже если там форма ствола
    // (упавший верх унёс своё, срезанный кусок выпал). По нему пила находит кору пня.
    this.top = new Int16Array(this.n * this.m).fill(-1);
    // У двойного дерева у каждого кубика — маска стволов, к которым он принадлежит (в сросшемся низу
    // обоим), а body — маска стволов, которые сейчас держит недопил: только они клонятся и падают.
    // У отвалившихся кусков стволов нет: они ничего не держат.
    this.owner = shape.stems.length > 1 && !floor ? new Uint8Array(this.data.length) : null;
    this.body = 0;
    this.carved = -1; // последний выпиленный кубик
    for (let j = 0, id = 0; j < this.ny; j++) {
      const y = (floor + j + 0.5) * VOXEL;
      for (let k = 0, col = 0; k < this.m; k++) {
        for (let i = 0; i < this.n; i++, id++, col++) {
          if (this.owner) {
            this.owner[id] = shape.inside(this.x(i), y, this.z(k));
            this.data[id] = this.owner[id] && !shape.seam(this.x(i), y, this.z(k)) ? 1 : 0;
          } else this.data[id] = this.wood(i, j, k) ? 1 : 0;
          if (this.data[id]) this.top[col] = j;
        }
      }
    }
    // Волокна идут вдоль ствола, по колонкам кубиков. Для каждой колонки: сколько в ней выпилено,
    // нижний и верхний край выреза и наклон пропила, что её перерезал. version растёт с каждым кубиком.
    this.gap = new Uint16Array(this.n * this.m);
    this.gapLow = new Int16Array(this.n * this.m).fill(this.ny);
    this.gapHigh = new Int16Array(this.n * this.m).fill(-1);
    this.normals = new Float32Array(this.n * this.m * 3);
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
      const m = new THREE.Mesh(new THREE.BufferGeometry(), skin);
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

  // Кубик того ствола, что держит недопил (у одиночного — любой).
  held(id) { return !this.owner || !!(this.owner[id] & this.body); }

  // Какой ствол пилят: тот, что держит недопил под последним выпиленным кубиком (carved). В его слое
  // берём всё, что связано с ним через древесину и вырез. Ниже развилки стволы срослись, и пропил
  // в одном держит оба; выше и в щели вросшей коры они порознь. standing — маска ещё стоящих стволов.
  // Подпилили один и взялись за другой — держит другой: первый стоит на своём недопиле, пока его не допилят.
  cutStems(standing) {
    if (!this.owner || this.carved < 0) return standing;
    const { n, m, data, owner, gap } = this;
    const layer = n * m, row = Math.floor(this.carved / layer) * layer;
    const seen = new Uint8Array(layer), stack = [this.carved - row];
    seen[stack[0]] = 1;
    let mask = 0;
    while (stack.length) {
      const col = stack.pop(), i = col % n;
      mask |= owner[row + col];
      for (const nb of [i > 0 ? col - 1 : -1, i < n - 1 ? col + 1 : -1, col - n, col + n]) {
        if (nb < 0 || nb >= layer || seen[nb] || !(data[row + nb] || gap[nb])) continue;
        seen[nb] = 1;
        stack.push(nb);
      }
    }
    return (mask & standing) || standing;
  }

  // Верх упал, на пне стоят ещё стволы: дальше их держит то, что под ними, и пилят их заново.
  // Колонки, у которых верх ушёл выше выреза, — просто торцы пня: выреза в них больше нет.
  restand() {
    for (let col = 0; col < this.n * this.m; col++) {
      if (!this.gap[col] || this.top[col] >= this.gapLow[col]) continue;
      this.gap[col] = 0;
      this.gapLow[col] = this.ny;
      this.gapHigh[col] = -1;
    }
    this.cutLow = Infinity;
    this.cutHigh = -1;
    this.standing = true;
  }

  // Слой, где ломается недопил стоящего ствола: середина полосы, где прошла пила.
  get middle() { return Math.round((this.cutLow + this.cutHigh) / 2); }

  // Кубик внутри формы ствола: древесина, пока её не выпилили.
  wood(i, j, k) { return this.shape.contains(this.x(i), (this.floor + j + 0.5) * VOXEL, this.z(k)); }

  x(i) { return this.x0 + (i + 0.5) * VOXEL; }
  y(j) { return (j + 0.5) * VOXEL; }
  z(k) { return this.z0 + (k + 0.5) * VOXEL; }
  at(i, j, k) { return this.data[(j * this.m + k) * this.n + i]; }

  // Убирает кубик; если он был верхним в колонке, верх колонки опускается до следующего.
  empty(id) {
    const layer = this.n * this.m;
    this.data[id] = 0;
    const col = id % layer;
    if (Math.floor(id / layer) !== this.top[col]) return;
    let j = this.top[col] - 1;
    while (j >= 0 && !this.data[j * layer + col]) j--;
    this.top[col] = j;
  }

  // Точка p внутри формы ствола и не выше древесины в своей колонке: пропилы внутри не в счёт,
  // а там, где древесину унесло целиком, — воздух.
  under(p) {
    if (!this.shape.contains(p.x, p.y, p.z)) return false;
    const i = Math.floor((p.x - this.x0) / VOXEL), k = Math.floor((p.z - this.z0) / VOXEL);
    if (i < 0 || k < 0 || i >= this.n || k >= this.m) return false;
    return Math.floor(p.y / VOXEL) - this.floor <= this.top[k * this.n + i];
  }

  neighbours(id) {
    const { n, m } = this;
    const layer = n * m;
    const rest = id % layer;
    const i = rest % n;
    const k = (rest - i) / n;
    const out = [];
    if (i > 0) out.push(id - 1);
    if (i < n - 1) out.push(id + 1);
    if (k > 0) out.push(id - n);
    if (k < m - 1) out.push(id + n);
    if (id >= layer) out.push(id - layer);
    if (id + layer < this.data.length) out.push(id + layer);
    return out;
  }

  // Кубик выпилен или выпал: волокно в его колонке перерезано.
  cutFibre(id, normal) {
    const layer = this.n * this.m;
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
    if (i < 0 || k < 0 || j < 0 || i >= this.n || k >= this.m || j >= this.ny) return false;
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
    const { n, m } = this;
    for (let k = 0; k < m; k++) {
      for (let i = 0; i < n; i++) {
        const dx = this.x(i) - origin.x;
        const dz = this.z(k) - origin.z;
        const t = (origin.y - (halfT + dx * nx + dz * nz) / ny) / VOXEL - 0.5;
        const j0 = Math.max(0, Math.ceil(t));
        const j1 = Math.min(this.ny - 1, Math.ceil(t + layers) - 1);
        for (let j = j0; j <= j1; j++) {
          const id = (j * m + k) * n + i;
          if (!this.data[id]) continue;
          const dy = this.y(j) - origin.y;
          const s = dx * along.x + dy * along.y + dz * along.z;
          const w = dx * side.x + dy * side.y + dz * side.z;
          if (s < from || s > to || Math.abs(w) > barLength / 2) continue;
          this.empty(id);
          this.cutFibre(id, normal);
          this.touch(j);
          this.cutLow = Math.min(this.cutLow, j);
          this.cutHigh = Math.max(this.cutHigh, j);
          this.removed.push(id);
          this.carved = id;
        }
      }
    }
  }

  // Куски, которые пропилы отрезали от всего: ни с пнём снизу, ни со стволом сверху не связаны.
  // Отвалиться может только то, что граничит с только что вырезанными кубиками, поэтому заливку
  // запускаем от их соседей. Ниже и выше полосы, где работала пила, ствол цельный: кто дотянулся
  // до её края или до уже признанного держащимся куска — держится, и заливка сразу обрывается.
  // Когда верх упал, сверху держать некому: держит только низ пня.
  // Вверх-вниз идём в первую очередь, так до края полосы обычно доходим за несколько шагов.
  // Что залилось целиком, не дотянувшись, — отвалилось и переносится в свою сетку.
  breakLoose() {
    const seeds = this.removed;
    this.removed = [];
    if (!seeds.length) return [];
    const { n, m, data } = this;
    const layer = n * m;
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
        // Стоящий ствол держит и пень снизу, и верх сверху; у пня держит только земля под пропилами.
        if (j <= lo || (this.standing && j >= hi)) return held.add(no);
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
  splitTop(h, tongue = new Set(), split = 0) {
    const { n, m, data, gap, gapLow, gapHigh } = this;
    const layer = n * m;
    this.standing = false;
    const tear = Math.round(h / VOXEL);
    const tongueTear = Math.min(this.ny - 1, Math.round((h + split) / VOXEL));
    const last = Math.max(this.cutHigh, tongueTear);
    // По своей колонке не решить два рода кубиков, их решаем по слою. Кусок колонки между двумя
    // разрывами отрезан сверху и снизу и держится только боком: кусок слоя из таких кубиков уходит
    // туда, с чем у него больше общих граней. Колонки у коры, что в полосе пропилов выходят из ствола
    // (rim), отвесные, а ствол клонится: по высоте их не разделить. Кора держится за древесину под
    // собой и идёт туда же, куда ближайшая по слою: под косым резом остаётся на пне, у отщепа — на отщепе.
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
    // Колонка рвётся на пропилах, а целая на высоте недопила — ещё и там, где рвётся недопил:
    // кусок от этой высоты до пропила выше держится только боком, как кусок между двумя пропилами.
    const between = (j, col) => gap[col] > 0 && j < gapHigh[col]
      && (j > gapLow[col] || j >= (tongue.has(col) ? tongueTear : tear));
    // Кубики других стволов (их недопил не держит) остаются на пне целиком.
    const open = (j, col) => this.held(j * layer + col) && (rim[col] ? j >= this.cutLow && j <= last : between(j, col));
    const top = new Uint8Array(data.length);
    for (let id = 0; id < data.length; id++) {
      if (!data[id] || !this.held(id)) continue;
      const j = Math.floor(id / layer);
      const col = id - j * layer;
      if (!open(j, col) && this.above(j, col, tongue.has(col) ? tongueTear : tear)) top[id] = 1;
    }
    const side = new Uint8Array(layer); // 0 — ещё не решён, 1 — верх, 2 — пень
    const queue = new Int32Array(layer);
    const near = (col) => {
      const i = col % n;
      return [i > 0 ? col - 1 : -1, i < n - 1 ? col + 1 : -1, col - n, col + n].filter((nb) => nb >= 0 && nb < layer);
    };
    for (let j = this.cutLow; j <= last; j++) {
      const row = j * layer;
      side.fill(0);
      for (let col = 0; col < layer; col++) if (data[row + col] && !open(j, col)) side[col] = top[row + col] ? 1 : 2;
      // Куски между пропилами: обходим каждый и считаем, сколько граней у него с верхом и с пнём.
      for (let start = 0; start < layer; start++) {
        if (side[start] || !data[row + start] || !open(j, start) || rim[start]) continue;
        side[start] = 3;
        let end = 0, up = 0, down = 0;
        queue[end++] = start;
        for (let q = 0; q < end; q++) {
          for (const nb of near(queue[q])) {
            if (!data[row + nb]) continue;
            if (side[nb] === 1) up++;
            else if (side[nb] === 2) down++;
            else if (!side[nb] && !rim[nb] && open(j, nb)) {
              side[nb] = 3;
              queue[end++] = nb;
            }
          }
        }
        for (let q = 0; q < end; q++) side[queue[q]] = up > down ? 1 : 2;
      }
      // Кора — за ближайшей решённой древесиной слоя.
      let end = 0;
      for (let col = 0; col < layer; col++) if (side[col]) queue[end++] = col;
      for (let q = 0; q < end; q++) {
        const col = queue[q];
        for (const nb of near(col)) {
          if (side[nb] || !data[row + nb]) continue;
          side[nb] = side[col];
          queue[end++] = nb;
        }
      }
      // Обрывок, не связанный в слое ни с чем решённым, остаётся на пне: если его и там ничто
      // не держит, он отвалится (breakLoose).
      for (let col = 0; col < layer; col++) if (side[col] === 1 && open(j, col)) top[row + col] = 1;
    }
    const ids = [];
    for (let id = 0; id < data.length; id++) if (top[id]) ids.push(id);
    return this.detach(ids);
  }

  // Трещина отщепа: вдоль кромки пропила, в перерезанных колонках рядом с отщепляющимися (tongue),
  // древесина над пропилом расходится вверх на split. Это раскол, а не пропил: волокна колонок
  // уже перерезаны, считать их заново не нужно.
  splinter(tongue, split) {
    const { n, m, data, gap, gapHigh } = this;
    const depth = Math.round(split / VOXEL);
    for (const col of tongue) {
      const i = col % n, k = (col - i) / n;
      for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + di, kk = k + dk;
        if (ii < 0 || kk < 0 || ii >= n || kk >= m) continue;
        const nb = kk * n + ii;
        if (!gap[nb]) continue;
        for (let j = gapHigh[nb] + 1; j <= Math.min(this.ny - 1, gapHigh[nb] + depth); j++) {
          if (!data[j * n * m + nb]) continue;
          this.empty(j * n * m + nb);
          this.touch(j);
        }
      }
    }
  }

  // Переносит перечисленные кубики в новую сетку высотой ровно в их слои — отдельное тело.
  // Заодно считает его центр и нижнюю точку (в координатах ствола): по ним кусок падает на землю.
  detach(ids) {
    const layer = this.n * this.m;
    let jLow = Infinity, jHigh = -1;
    for (const id of ids) {
      const j = Math.floor(id / layer);
      jLow = Math.min(jLow, j);
      jHigh = Math.max(jHigh, j);
    }
    const part = new TrunkVoxels(this.shape, (jHigh - jLow + 1) * VOXEL, this.skin, this.floor + jLow);
    part.data.fill(0);
    part.top.fill(-1);
    part.chunks.forEach((c) => { c.dirty = false; });
    for (const id of ids) {
      const j = Math.floor(id / layer);
      part.data[id - jLow * layer] = 1;
      part.top[id % layer] = Math.max(part.top[id % layer], j - jLow);
      part.touch(j - jLow);
      this.empty(id);
      this.touch(j);
      this.removed.push(id);
    }
    part.center = part.measure().center;
    part.low = part.floor * VOXEL;
    part.remesh();
    this.remesh();
    return part;
  }

  // Объём древесины и её центр (в координатах ствола); mask — только этих стволов.
  measure(mask = 0) {
    const { n, m, data, owner } = this;
    const center = new THREE.Vector3();
    let count = 0;
    for (let j = 0, id = 0; j < this.ny; j++) {
      for (let k = 0; k < m; k++) {
        for (let i = 0; i < n; i++, id++) {
          if (!data[id] || (mask && owner && !(owner[id] & mask))) continue;
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
    // Если клонится не всё дерево, а один из стволов, кусок над полосой тоже делится на две сетки (parted):
    // по стволам, поэтому перестраивается, только когда меняется, какие стволы держит недопил.
    const whole = !this.owner || this.body === (1 << this.shape.stems.length) - 1;
    const parted = this.body !== this.parted;
    this.parted = this.body;
    this.chunks.forEach((chunk, c) => {
      const state = !cut || (c + 1) * CHUNK <= this.cutLow ? 'still'
        : c * CHUNK <= this.cutHigh ? 'split' : whole ? 'lifted' : 'parted';
      const two = (st) => st === 'split' || st === 'parted';
      if ((state === 'split' && moved) || (state === 'parted' && parted) || two(state) !== two(chunk.state)) chunk.dirty = true;
      chunk.state = state;
      (state === 'lifted' ? this.lift : this.group).add(chunk.mesh);
      if (!chunk.dirty) return;
      chunk.dirty = false;
      chunk.mesh.geometry.dispose();
      chunk.top.geometry.dispose();
      const [still, top] = this.buildChunk(c * CHUNK, Math.min((c + 1) * CHUNK, this.ny), two(state));
      chunk.mesh.geometry = still;
      chunk.top.geometry = top;
    });
  }

  // Нормаль свежего среза у кубика (i, j, k): куда в среднем смотрит пустота вокруг него в кубе 5×5×5.
  // Косой пропил в кубиках — лесенка, а освещать его надо как ровную плоскость, иначе ступеньки
  // через одну тёмные и срез выглядит рваными волокнами. Ниже сетки — земля, выше — ствол: там пустоты нет.
  // Тонкая пластинка, у которой пустота с обеих сторон поровну, смотрит туда же, куда сама грань dir.
  cutNormal(i, j, k, dir) {
    const { n, m, ny, data } = this;
    let [x, y, z] = dir;
    for (let dj = -2; dj <= 2; dj++) {
      const jj = j + dj;
      if (jj < 0 || jj >= ny) continue;
      for (let dk = -2; dk <= 2; dk++) {
        const kk = k + dk;
        for (let di = -2; di <= 2; di++) {
          const ii = i + di;
          if (ii >= 0 && kk >= 0 && ii < n && kk < m && data[(jj * m + kk) * n + ii]) continue;
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
    const { n, m, ny, data, x0, z0 } = this;
    const out = scratch;
    const tear = this.middle;
    out.faces = 0;
    const rim = new Set(); // углы граней коры, по номеру угла на сетке
    const key = (I, J, K) => (J * (m + 1) + K) * (n + 1) + I;
    const { stems } = this.shape;
    for (let j = j0; j < j1; j++) {
      const y = (this.floor + j + 0.5) * VOXEL;
      const axes = stems.map((s) => s.center(y));
      for (let k = 0; k < m; k++) {
        for (let i = 0; i < n; i++) {
          if (!data[(j * m + k) * n + i]) continue;
          const lifted = split && this.held((j * m + k) * n + i) && this.above(j, k * n + i, tear);
          // Кора и кольца — вокруг оси своего ствола: у двойного у каждого своя сердцевина.
          let stem = null, axis = null, size = 0;
          for (let f = 0; f < 6; f++) {
            const { dir, corners } = FACES[f];
            const ii = i + dir[0], jj = j + dir[1], kk = k + dir[2];
            if (jj < 0 || jj >= ny) continue; // снизу земля, сверху продолжается ствол
            const outside = ii < 0 || kk < 0 || ii >= n || kk >= m;
            if (!outside && data[(jj * m + kk) * n + ii]) continue;
            const bark = outside || !this.wood(ii, jj, kk);
            // Вросшая кора внутри дерева: грань коры, но плоская, как срез, и на контур её не ставим.
            const seam = bark && !outside && this.shape.seam(this.x(ii), (this.floor + jj + 0.5) * VOXEL, this.z(kk));
            if (!stem) {
              const s = this.shape.of(this.x(i), y, this.z(k));
              stem = stems[s];
              axis = axes[s];
              size = stem.scale(y);
            }
            let nx = dir[0], nyy = dir[1], nz = dir[2];
            const a = Math.atan2(this.z(k) - axis.z, this.x(i) - axis.x);
            if (bark && !seam) {
              [nx, nyy, nz] = stem.normal(a, y, Math.hypot(this.x(i) - axis.x, this.z(k) - axis.z));
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
              if (bark && !seam) rim.add(key(i + corner[0], j + corner[1], k + corner[2]));
              out.pos[v] = px;
              out.pos[v + 1] = (j + corner[1]) * VOXEL;
              out.pos[v + 2] = pz;
              out.nor[v] = nx; out.nor[v + 1] = nyy; out.nor[v + 2] = nz;
              const around = Math.atan2(pz - axis.z, px - axis.x);
              const turn = a + Math.atan2(Math.sin(around - a), Math.cos(around - a));
              if (bark) {
                out.uv[t] = (turn * stem.radius) / BARK_TILE;
                // По лапе кора идёт вниз и наружу: v — путь вдоль склона, а не одна высота.
                const down = Math.max(0, Math.hypot(px - axis.x, pz - axis.z) - size * stem.profile(around));
                out.uv[t + 1] = ((this.floor + j + corner[1]) * VOXEL - down) / BARK_TILE;
              } else {
                // Древесина — в полярных координатах: u — доля оборота, v — от коры (0) к сердцевине (1).
                // Радиус меряем долей контура, поэтому годичные кольца повторяют форму ствола, и лапы тоже.
                out.uv[t] = turn / (2 * Math.PI);
                out.uv[t + 1] = 1 - Math.hypot(px - axis.x, pz - axis.z) / stem.outline(around, y);
                out.pith[t] = 0.5 + (px - axis.x) / (PITH * size * stem.radius);
                out.pith[t + 1] = 0.5 + (pz - axis.z) / (PITH * size * stem.radius);
                // Рельеф волокон: u — по горизонтали вдоль сглаженной плоскости грани, v — по высоте.
                const h = Math.hypot(nx, nz);
                out.grain[t] = (h > 1e-3 ? (pz * nx - px * nz) / h : px) / SPLIT_W;
                out.grain[t + 1] = ((this.floor + j + corner[1]) * VOXEL) / SPLIT_H;
              }
            }
            out.faces++;
          }
        }
      }
    }
    const verts = out.faces * 12;
    // Углы коры ставим на сам контур по лучу от оси, иначе по краю ствола шла бы лесенка кубиков.
    // Угол сдвигается во всех гранях, где он есть, и в коре и в срезе, поэтому они сходятся без щели.
    // Кубики не меняются: пила режет по ним, сетка лишь глаже их рисует.
    const snapped = new Map();
    for (let v = 0; v < verts; v += 3) {
      const I = Math.round((out.pos[v] - x0) / VOXEL), J = Math.round(out.pos[v + 1] / VOXEL), K = Math.round((out.pos[v + 2] - z0) / VOXEL);
      const id = key(I, J, K);
      if (!rim.has(id)) continue;
      let p = snapped.get(id);
      if (!p) {
        const y = (this.floor + J) * VOXEL;
        const stem = this.shape.stems[this.shape.of(out.pos[v], y, out.pos[v + 2])];
        const c = stem.center(y);
        const dx = out.pos[v] - c.x, dz = out.pos[v + 2] - c.z;
        const k = stem.outline(Math.atan2(dz, dx), y) / Math.hypot(dx, dz);
        p = [c.x + dx * k, c.z + dz * k];
        snapped.set(id, p);
      }
      out.pos[v] = p[0];
      out.pos[v + 2] = p[1];
    }
    const position = new THREE.BufferAttribute(out.pos.slice(0, verts), 3);
    const normal = new THREE.BufferAttribute(out.nor.slice(0, verts), 3);
    const uv = new THREE.BufferAttribute(out.uv.slice(0, out.faces * 8), 2);
    const pith = new THREE.BufferAttribute(out.pith.slice(0, out.faces * 8), 2);
    const grain = new THREE.BufferAttribute(out.grain.slice(0, out.faces * 8), 2);
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
      geometry.setAttribute('grain', grain);
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
  grain: new Float32Array(8 * 8192),
  bark: new Uint8Array(8192),
  lift: new Uint8Array(8192),
  reserve() {
    if ((this.faces + 1) * 12 <= this.pos.length) return;
    for (const key of ['pos', 'nor', 'uv', 'pith', 'grain', 'bark', 'lift']) {
      const grown = new this[key].constructor(this[key].length * 2);
      grown.set(this[key]);
      this[key] = grown;
    }
  },
};
