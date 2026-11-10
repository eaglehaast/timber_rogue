import * as THREE from 'three';
import { generator, smoothNoise } from './random.js';
import { tiles, soften } from './surface.js';
import { YARD, GATES } from './fence.js';
import { height, groundAt } from './terrain.js';
import { brickMaterial, BRICK_TILE } from './roof.js';

// Улица перед двором — колея среди травы (Никита, 2026-11-08: «два рельефных следа шин, кое-где глубокие лужи,
// в лужи можно пихнуть кирпичи, между колеями трава, с невысокими травами»). Полосы грунта нет.
// Следы вдавлены в саму землю (dug — для terrain.js): по краям выдавлен валик грязи, кое-где след проседает ямой,
// в яме стоит вода, в воде — обломки кирпича. Перед воротами — следы многих подъездов (Никита: «по чуть разным
// траекториям: подъехали к воротам; подъехали и поставили машину параллельно воротам»), старые мельче и заросли.
// Участок брошен: во двор не заезжали, тропки к калитке не осталось.
// Трава: на следах её нет, между ними и рядом — только низкая (trodden — для world.js).
//
// Картинки: дно следов — грунт чернозёма (road-base, 8 плиток по BASE м вперемешку), к траве рвано тает
// по маске края road-edge (вдоль EDGE_ALONG м, поперёк — полоса края).
// Заказаны у ChatGPT (design/road/rut-road-prompt.md): дно следа с протектором, низкая утоптанная трава, кромка лужи.
const STREET = { near: 4.5, reach: 140 };   // м: от забора до середины улицы; улица в обе стороны от середины двора
// Колея: между следами; ширина следа; глубина от и до; насколько след виляет; валик грязи по краю (доля глубины);
// полоса, где грязь дна рвано тает в траву.
const RUT = { gauge: 1.5, width: 0.42, depth: [0.06, 0.13], wander: 0.12, berm: 0.25, band: 0.3 };
// Лужи: сколько по улице вдоль двора (там сетка земли частая — яма не теряется), длина, насколько яма глубже следа,
// лужа шире следа во сколько раз, в какой доле луж кирпичи.
const PUDDLE = { count: 8, length: [1.2, 3.4], deep: [0.07, 0.16], wide: 1.35, bricks: 0.6 };
const BRICK = [0.25, 0.065, 0.12];          // м: кирпич
// Подъезды: сколько раз подъезжали носом к воротам и сколько вставали вдоль забора; с какой долей ехали со стороны
// деревни; поворот середины машины — вдоль улицы и поперёк; где встаёт середина передних колёс у ворот; где стоит
// середина машины вдоль забора (за стойками газовой трубы, в метре от забора); глубина свежего следа — доля самой
// глубокой уличной.
const VISITS = { gate: 5, parked: 2, village: 0.75, along: [2.5, 6], across: [2, 3.2], stop: [0.9, 1.8], beside: [1.9, 2.6], depth: 0.6 };
const STEP = 0.05;                          // м: шаг точек по пути машины
const CELL = 0.025;                         // м: клетка растра следов перед воротами
const EDGE_ALONG = 16, BASE = 4;            // м: длина маски края; сторона плитки грунта
const LIFT = 0.006;                         // м над землёй, чтобы не мерцать с ней

const [base, edge] = tiles(['road-base.jpg', 'road-edge.png'].map((f) => `assets/textures/${f}`));
for (const mask of [edge]) {
  mask.colorSpace = THREE.NoColorSpace;     // маски — доли, а не цвет
  mask.channel = 1;                         // берут вторые координаты: вдоль ленты и поперёк неё
  mask.wrapT = THREE.ClampToEdgeWrapping;   // внутри полотна — нижний ряд маски (земля), за ним — верхний (трава)
}
const flat = { transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 };
const look = { contrast: 0.9, saturation: 0.8, scales: [0.13, 0.5], low: [0.92, 0.92, 0.9], high: [1.02, 1.02, 1], cells: [4, 2] };
const mud = soften(new THREE.MeshLambertMaterial({ map: base, alphaMap: edge, vertexColors: true, ...flat }), look);
const WATER = puddleWater();
const BRICKS = brickMaterial();

// Вода в луже: мутная, вблизи сквозь неё видно грязь дна, а чем дальше лужа, тем больше она отражает небо
// (доля отражения по Шлику: 2 % сверху, всё — вскользь). Небо — цвет и сила света неба из world.js.
function puddleWater() {
  const material = new THREE.MeshLambertMaterial({ color: 0x2e2820, transparent: true, opacity: 0.55, depthWrite: false });
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `#include <opaque_fragment>
      float mirror = 0.02 + 0.98 * pow(1.0 - abs(dot(normalize(vViewPosition), normal)), 5.0);
      gl_FragColor = mix(gl_FragColor, vec4(0.78, 1.0, 1.4, 1.0), mirror);`);
  };
  material.customProgramCacheKey = () => 'puddle';
  return material;
}

// Профиль следа поперёк: t — расстояние от оси в полуширинах. В следе — впадина, сразу за краем — валик
// выдавленной грязи, дальше земля нетронута.
const LIP = 1.6; // валик грязи кончается на стольких полуширинах следа от его оси
const profile = (t) => (t < 1 ? (1 - t * t) ** 2 : t < LIP ? -RUT.berm * Math.sin((Math.PI * (t - 1)) / (LIP - 1)) : 0);

// Где улица и что на ней — для рельефа, травы и самой улицы. fence — z забора со стороны улицы.
export function planRoad({ seed, fence }) {
  const rnd = generator(seed + 37);
  const wave = smoothNoise(rnd), phase = rnd() * 9;
  const center = fence + STREET.near, half = RUT.width / 2;
  // Ось каждого следа по x и его глубина: след виляет и где глубже, где мельче.
  const lines = [-1, 1].map((side, k) => ({
    z: (x) => center + (side * RUT.gauge) / 2 + RUT.wander * Math.sin(x / 7 + phase + k * 0.6),
    depth: (x) => RUT.depth[0] + (RUT.depth[1] - RUT.depth[0]) * wave(x / 6, k * 3),
  }));
  // Подъезды и их колёса; следы колёс и середины машин — в растре перед воротами.
  const visits = approaches(rnd, GATES.at, fence, center);
  const wheels = visits.flatMap((visit) => [-1, 1].map((side) => ({ ...visit, points: beside(visit.points, (side * RUT.gauge) / 2) })));
  const front = raster(fence, center, wheels, visits);
  // Лужи — ямы в следах улицы у двора: { line, x, length, deep }.
  const puddles = Array.from({ length: PUDDLE.count }, () => {
    const lerp = (r) => r[0] + rnd() * (r[1] - r[0]);
    return { line: Math.floor(rnd() * 2), x: (rnd() * 2 - 1) * (YARD.w / 2 - 2), length: lerp(PUDDLE.length), deep: lerp(PUDDLE.deep) };
  });

  // Где следы сходятся, земля — по самому глубокому месту: след прорезает валик соседнего, а не складывается с ним.
  const dug = (x, z) => {
    let d = front.near(x, z) ? front.dug(x, z) : -Infinity;
    for (const line of lines) {
      const t = Math.abs(z - line.z(x)) / half;
      if (t < 1.6) d = Math.max(d, line.depth(x) * profile(t));
    }
    if (d === -Infinity) d = 0;
    for (const p of puddles) {
      const t = Math.abs(z - lines[p.line].z(x)) / half, u = Math.abs(x - p.x) / (p.length / 2);
      if (u < 1) d += p.deep * (1 - u * u) ** 2 * Math.max(0, profile(t / PUDDLE.wide));
    }
    return d;
  };
  // Где сетка земли частая: ряды вдоль улицы и перед воротами.
  const rows = [[front.box.z0, front.box.z1]];

  // Трава: на следах нет, на старых — проросла; на улице и там, где ездили, топчут — там она низкая.
  const s = THREE.MathUtils.smoothstep;
  const grass = (x, z) => Math.min(1 - front.bare(x, z), ...lines.map((line) => s(Math.abs(z - line.z(x)) / half, 0.8, 1.2)));
  const trodden = (x, z) => Math.max(front.trodden(x, z), 1 - s(Math.abs(z - center), RUT.gauge / 2 + 0.3, RUT.gauge / 2 + 1.2));
  // Где машины съезжали с улицы к забору — там не ставить опор (power.js): { at, width } по x.
  const off = visits.flatMap((v) => v.points).filter((p) => p.z < center - RUT.gauge / 2).map((p) => p.x);
  const keep = { at: (Math.min(...off) + Math.max(...off)) / 2, width: Math.max(...off) - Math.min(...off) };
  // Дальний край улицы у x — внешний край дальнего следа с валиком грязи: за ним начинается лесополоса (land.js).
  const verge = (x) => lines[1].z(x) + LIP * half;
  return { seed, lines, wheels, puddles, dug, rows, grass, trodden, keep, verge };
}

// Подъезды к воротам gx от улицы с серединой center; fence — z забора. Участок брошен: во двор никто не заезжал.
// Подъезжали проверить дом: носом к воротам — и задним ходом тем же следом обратно, или вставали вдоль забора
// и уезжали дальше. Чаще ехали со стороны деревни. Каждый подъезд — путь середины машины (точки через STEP,
// сплайн через опорные точки, у каждого подъезда свой разворот и свой сбой). У точки w — насколько след
// виден, 0..1: старых подъездов больше, старый след мельче и зарос; где машина встала, след сходит на нет.
function approaches(rnd, gx, fence, center) {
  const lerp = ([a, b]) => a + rnd() * (b - a), jitter = (a) => (rnd() - 0.5) * 2 * a;
  const village = rnd() < 0.5 ? -1 : 1, dir = () => (rnd() < VISITS.village ? -village : village);
  const path = (points, stops = false) => {
    const curve = new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, 0, z)));
    const spaced = curve.getSpacedPoints(Math.ceil(curve.getLength() / STEP)), fresh = 0.2 + 0.8 * rnd() ** 2;
    const end = (i) => (stops ? THREE.MathUtils.smoothstep((spaced.length - 1 - i) * STEP, 0, 0.6) : 1);
    return { points: spaced.map(({ x, z }, i) => ({ x, z, w: fresh * end(i) })) };
  };
  const visits = [];
  for (let n = 0; n < VISITS.gate; n++) {
    // d — куда ехали по улице. Поворот — четверть овала: along метров вдоль улицы, across — поперёк, дальше прямо
    // хотя бы метр до стоянки; машина встаёт не ровно, а чуть наискось (skew).
    const d = dir(), along = lerp(VISITS.along), x = gx + jitter(0.9), z = center + jitter(0.35), stop = fence + lerp(VISITS.stop);
    const across = Math.min(lerp(VISITS.across), z - stop - 1), k = Math.SQRT1_2, skew = jitter(0.4);
    visits.push(path([[x - d * (along + 7), z + jitter(0.2)], [x - d * along, z], [x - d * along * (1 - k), z - across * (1 - k)],
      [x, z - across], [x + skew, stop]], true));
  }
  for (let n = 0; n < VISITS.parked; n++) {
    const d = dir(), x = gx + jitter(3), z = fence + lerp(VISITS.beside), run = lerp([5, 9]);
    visits.push(path([[x - d * (run + 7), center + jitter(0.3)], [x - d * run, center], [x - d * 2.5, z + 0.2 + jitter(0.15)], [x, z],
      [x + d * 3, z + jitter(0.15)], [x + d * (run - 1), center + jitter(0.3)], [x + d * (run + 6), center]]));
  }
  return visits;
}

// Путь points, сдвинутый вбок на off (влево по ходу — плюс): след колеса.
function beside(points, off) {
  return points.map((p, i) => {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)], l = Math.hypot(b.x - a.x, b.z - a.z);
    return { ...p, x: p.x - (off * (b.z - a.z)) / l, z: p.z + (off * (b.x - a.x)) / l };
  });
}

// Растр перед воротами: клетки по CELL на прямоугольнике box, где ездили. В каждой клетке — сколько вдавлено
// (по самому глубокому следу), насколько голо (свежий след — совсем) и насколько топчут (около середины машины).
// Точки путей идут через STEP, этого хватает: под каждой точкой отпечаток профиля следа.
function raster(fence, center, wheels, visits) {
  const all = visits.flatMap((v) => v.points);
  const box = {
    x0: Math.min(...all.map((p) => p.x)) - 2, x1: Math.max(...all.map((p) => p.x)) + 2,
    z0: Math.min(fence, ...all.map((p) => p.z)) - 2, z1: center + RUT.gauge / 2 + 2 * RUT.width,
  };
  const nx = Math.ceil((box.x1 - box.x0) / CELL) + 1, nz = Math.ceil((box.z1 - box.z0) / CELL) + 1;
  const dug = new Float32Array(nx * nz), touched = new Uint8Array(nx * nz), bare = new Float32Array(nx * nz), trodden = new Float32Array(nx * nz);
  // Отпечаток в радиусе reach вокруг (x, z): mark(k, расстояние) для каждой клетки.
  const stamp = (x, z, reach, mark) => {
    const i0 = Math.max(0, Math.floor((x - reach - box.x0) / CELL)), i1 = Math.min(nx - 1, Math.ceil((x + reach - box.x0) / CELL));
    const j0 = Math.max(0, Math.floor((z - reach - box.z0) / CELL)), j1 = Math.min(nz - 1, Math.ceil((z + reach - box.z0) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const r = Math.hypot(box.x0 + i * CELL - x, box.z0 + j * CELL - z);
      if (r < reach) mark(j * nx + i, r);
    }
  };
  const half = RUT.width / 2, deep = VISITS.depth * RUT.depth[1], s = THREE.MathUtils.smoothstep;
  for (const { points } of wheels) {
    for (const p of points) stamp(p.x, p.z, 1.6 * half, (k, r) => {
      const v = p.w * deep * profile(r / half);
      dug[k] = touched[k] ? Math.max(dug[k], v) : v;
      touched[k] = 1;
      bare[k] = Math.max(bare[k], p.w * (1 - s(r / half, 0.8, 1.2)));
    });
  }
  const wide = RUT.gauge / 2 + 1.2;
  for (const { points } of visits) {
    for (let i = 0; i < points.length; i += 4) {
      stamp(points[i].x, points[i].z, wide, (k, r) => { trodden[k] = Math.max(trodden[k], points[i].w * (1 - s(r, RUT.gauge / 2 + 0.3, wide))); });
    }
  }
  // Значение слоя в точке — по четырём клеткам вокруг; вне растра — ноль.
  const at = (layer) => (x, z) => {
    const u = (x - box.x0) / CELL, v = (z - box.z0) / CELL;
    if (u < 0 || v < 0 || u >= nx - 1 || v >= nz - 1) return 0;
    const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j, k = j * nx + i;
    return (layer[k] * (1 - fu) + layer[k + 1] * fu) * (1 - fv) + (layer[k + nx] * (1 - fu) + layer[k + nx + 1] * fu) * fv;
  };
  return { box, dug: at(dug), bare: at(bare), trodden: at(trodden), near: (x, z) => at(touched)(x, z) > 0 };
}

// Лента по земле вдоль середины points ({x, z} через равные шаги): полуширина half(i), высота — surface(x, z).
// По краю — полоса band (её середина — на half), где маска идёт от земли к траве. Вдоль маска идёт по EDGE_ALONG
// метров, начиная с места from на ней. Поперёк точки через step, чтобы лента повторяла впадину и валик.
// У точки может быть w — насколько лента здесь видна (старый заросший след бледнее).
function ribbon(points, half, surface, { band, from = 0, step = 0.04 }) {
  const pos = [], uv = [], uv1 = [], color = [], index = [];
  const n = Math.ceil((2 * Math.max(...points.map((_, i) => half(i))) + band) / step) + 1; // точек поперёк — у всех рядов поровну
  let s = 0;
  points.forEach((p, i) => {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    const t = new THREE.Vector2(b.x - a.x, b.z - a.z).normalize(), m = new THREE.Vector2(-t.y, t.x);
    if (i) s += Math.hypot(p.x - points[i - 1].x, p.z - points[i - 1].z);
    const h = half(i), inner = h - band / 2, outer = h + band / 2;
    const offsets = Array.from({ length: n }, (_, k) => outer * ((2 * k) / (n - 1) - 1));
    offsets.forEach((d) => {
      const x = p.x + m.x * d, z = p.z + m.y * d;
      pos.push(x, surface(x, z), z);
      uv.push(x / BASE, z / BASE);
      uv1.push((from + s) / EDGE_ALONG, Math.max(0, Math.abs(d) - inner) / band);
      color.push(1, 1, 1, p.w ?? 1);
    });
    if (!i) return;
    const k = n, a0 = (i - 1) * k, a1 = i * k;
    for (let j = 0; j < k - 1; j++) index.push(a0 + j, a0 + j + 1, a1 + j, a0 + j + 1, a1 + j + 1, a1 + j);
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

// Строить после shapeGround(…, planRoad): следы уже вдавлены в землю, здесь — их дно, вода и кирпичи.
export function buildRoad({ seed, lines, wheels, puddles }) {
  const rnd = generator(seed + 41);
  const group = new THREE.Group();
  const add = (geometry, material, order = 0) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.renderOrder = order;
    return group.add(mesh);
  };
  const surface = (x, z) => groundAt(x, z) + LIFT;
  const along = (from, to, step, at) => Array.from({ length: Math.round((to - from) / step) + 1 }, (_, i) => at(from + i * step));

  // Дно следов — грунт, рвано тающий в траву; у каждого следа своё место на маске края, чтобы следы не повторяли друг друга.
  // У лужи след шире — во всю яму.
  lines.forEach((line, k) => {
    const points = along(-STREET.reach, STREET.reach, 0.25, (x) => ({ x, z: line.z(x) }));
    const half = (i) => (RUT.width / 2) * (1 + (PUDDLE.wide - 1) * Math.max(0, ...puddles.filter((p) => p.line === k)
      .map((p) => 1 - (Math.abs(points[i].x - p.x) / (p.length / 2)) ** 2)));
    add(ribbon(points, half, surface, { band: RUT.band, from: rnd() * EDGE_ALONG }), mud, 2);
  });
  // Ленте хватает точки через три шага пути.
  for (const { points } of wheels) {
    add(ribbon(points.filter((_, i) => i % 3 === 0 || i === points.length - 1), () => RUT.width / 2, surface, { band: RUT.band, from: rnd() * EDGE_ALONG }), mud, 2);
  }

  // Лужи: вода ровно на уровне, где яма выходит на дно следа (по краям лужи), — заполняет яму.
  // Кирпичи — обломки, брошенные в лужу: лежат вкривь, наполовину в воде.
  const bricks = [];
  for (const p of puddles) {
    const line = lines[p.line], z = line.z(p.x);
    const level = Math.min(height(p.x - p.length / 2, line.z(p.x - p.length / 2)), height(p.x + p.length / 2, line.z(p.x + p.length / 2))) - 0.01;
    const water = new THREE.PlaneGeometry(p.length, RUT.width * PUDDLE.wide, 1, 1).rotateX(-Math.PI / 2)
      .rotateY(-Math.atan2(line.z(p.x + 0.5) - line.z(p.x - 0.5), 1)).translate(p.x, level, z);
    add(water, WATER, 3);
    if (rnd() > PUDDLE.bricks) continue;
    for (let n = 1 + Math.floor(rnd() * 3); n > 0; n--) {
      const piece = rnd() < 0.6 ? 0.5 + rnd() * 0.3 : 1; // чаще половинки
      const x = p.x + (rnd() - 0.5) * p.length * 0.6, bz = line.z(x) + (rnd() - 0.5) * RUT.width * 0.4;
      const geometry = new THREE.BoxGeometry(BRICK[0] * piece, BRICK[1], BRICK[2]);
      const uv = geometry.attributes.uv, du = rnd(), dv = rnd();
      for (let i = 0; i < uv.count; i++) uv.setXY(i, du + (uv.getX(i) * BRICK[0] * piece) / BRICK_TILE[0], dv + (uv.getY(i) * BRICK[1]) / BRICK_TILE[1]);
      geometry.rotateX((rnd() - 0.5) * 0.5).rotateZ((rnd() - 0.5) * 0.4).rotateY(rnd() * Math.PI)
        .translate(x, Math.max(height(x, bz), level - 0.06) + BRICK[1] * 0.3, bz);
      bricks.push(geometry);
    }
  }
  for (const geometry of bricks) {
    const mesh = new THREE.Mesh(geometry, BRICKS);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
