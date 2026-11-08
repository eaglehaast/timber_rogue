import * as THREE from 'three';
import { generator, smoothNoise } from './random.js';
import { tiles, soften } from './surface.js';
import { YARD, WICKET, GATES } from './fence.js';
import { height } from './terrain.js';
import { brickMaterial, BRICK_TILE } from './roof.js';

// Улица перед двором — колея среди травы (Никита, 2026-11-08: «два рельефных следа шин, кое-где глубокие лужи,
// в лужи можно пихнуть кирпичи, между колеями трава, с невысокими травами»). Полосы грунта нет.
// Следы вдавлены в саму землю (dug — для terrain.js): по краям выдавлен валик грязи, кое-где след проседает ямой,
// в яме стоит вода, в воде — обломки кирпича. От улицы к воротам сворачивает такая же колея, к калитке — тропка.
// Трава: на следах её нет, между ними и рядом — только низкая (trodden — для world.js).
//
// Картинки: дно следов и тропка — грунт чернозёма (road-base, 8 плиток по BASE м вперемешку), к траве рвано тает
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
const DRIVE = { inside: 1, depth: 0.6 };    // съезд в ворота: на сколько заходит во двор; глубина — доля уличной
const EDGE = 0.5, EDGE_ALONG = 16, BASE = 4; // м: полоса тающего края тропки; длина маски края; сторона плитки грунта
const LIFT = 0.006;                         // м над землёй, чтобы не мерцать с ней
const PATH = { half: 0.35 };                // тропка к калитке: полуширина

const [base, edge] = tiles(['road-base.jpg', 'road-edge.png'].map((f) => `assets/textures/${f}`));
for (const mask of [edge]) {
  mask.colorSpace = THREE.NoColorSpace;     // маски — доли, а не цвет
  mask.channel = 1;                         // берут вторые координаты: вдоль ленты и поперёк неё
  mask.wrapT = THREE.ClampToEdgeWrapping;   // внутри полотна — нижний ряд маски (земля), за ним — верхний (трава)
}
const flat = { transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 };
const look = { contrast: 0.9, saturation: 0.8, scales: [0.13, 0.5], low: [0.92, 0.92, 0.9], high: [1.02, 1.02, 1], cells: [4, 2] };
const path = soften(new THREE.MeshLambertMaterial({ map: base, alphaMap: edge, ...flat }), look);
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
const profile = (t) => (t < 1 ? (1 - t * t) ** 2 : t < 1.6 ? -RUT.berm * Math.sin((Math.PI * (t - 1)) / 0.6) : 0);

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
  // Съезд: следы от улицы прямо в ворота, мельче уличных.
  const drive = [-1, 1].map((side) => ({ x: GATES.at + (side * RUT.gauge) / 2, from: fence - DRIVE.inside, to: center }));
  const driveDepth = DRIVE.depth * RUT.depth[0];
  // Лужи — ямы в следах улицы у двора: { line, x, length, deep }.
  const puddles = Array.from({ length: PUDDLE.count }, () => {
    const lerp = (r) => r[0] + rnd() * (r[1] - r[0]);
    return { line: Math.floor(rnd() * 2), x: (rnd() * 2 - 1) * (YARD.w / 2 - 2), length: lerp(PUDDLE.length), deep: lerp(PUDDLE.deep) };
  });

  const dug = (x, z) => {
    let d = 0;
    lines.forEach((line, k) => {
      const t = Math.abs(z - line.z(x)) / half;
      if (t >= 1.6) return;
      d += line.depth(x) * profile(t);
      for (const p of puddles) {
        const u = Math.abs(x - p.x) / (p.length / 2);
        if (p.line === k && u < 1) d += p.deep * (1 - u * u) ** 2 * Math.max(0, profile(t / PUDDLE.wide));
      }
    });
    for (const r of drive) {
      if (z < r.from || z > r.to) continue;
      const fade = THREE.MathUtils.smoothstep(z, r.from, r.from + 1);
      d += driveDepth * fade * profile(Math.abs(x - r.x) / half);
    }
    return d;
  };
  // Где частые ряды земли: вдоль улицы по следам.
  const rows = [[center - RUT.gauge / 2 - RUT.width, center + RUT.gauge / 2 + RUT.width]];

  // Тропка к калитке: от улицы в калитку и на полметра во двор.
  const wicket = new THREE.CatmullRomCurve3([
    new THREE.Vector3(WICKET.at - 0.5, 0, center - RUT.gauge / 2), new THREE.Vector3(WICKET.at - 0.2, 0, fence + 1.2), new THREE.Vector3(WICKET.at, 0, fence - 0.5),
  ]).getSpacedPoints(24);
  const segment = new THREE.Line3(), p = new THREE.Vector3(), q = new THREE.Vector3();
  const onPath = (x, z) => {
    p.set(x, 0, z);
    let near = Infinity;
    for (let i = 1; i < wicket.length; i++) near = Math.min(near, segment.set(wicket[i - 1], wicket[i]).closestPointToPoint(p, true, q).distanceTo(p));
    return near;
  };

  // Трава: на следах и тропке нет; между следами и в метре за ними топчут — там она низкая.
  const s = THREE.MathUtils.smoothstep;
  const grass = (x, z) => {
    let g = Math.min(...lines.map((line) => s(Math.abs(z - line.z(x)) / half, 0.8, 1.2)));
    for (const r of drive) if (z > r.from && z < r.to) g = Math.min(g, s(Math.abs(x - r.x) / half, 0.8, 1.2));
    return g * s(onPath(x, z), PATH.half * 0.6, PATH.half + EDGE / 2);
  };
  const trodden = (x, z) => 1 - s(Math.abs(z - center), RUT.gauge / 2 + 0.3, RUT.gauge / 2 + 1.2);
  return { seed, center, lines, drive, puddles, wicket, dug, rows, grass, trodden };
}

// Лента по земле вдоль середины points ({x, z} через равные шаги): полуширина half(i), высота — surface(x, z).
// По краю — полоса band (её середина — на half), где маска идёт от земли к траве. Вдоль маска идёт по EDGE_ALONG
// метров, начиная с места from на ней. Поперёк точки через step, чтобы лента повторяла впадину и валик.
function ribbon(points, half, surface, { band, from = 0, step = 0.04 }) {
  const pos = [], uv = [], uv1 = [], index = [];
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
    });
    if (!i) return;
    const k = n, a0 = (i - 1) * k, a1 = i * k;
    for (let j = 0; j < k - 1; j++) index.push(a0 + j, a0 + j + 1, a1 + j, a0 + j + 1, a1 + j + 1, a1 + j);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('uv1', new THREE.Float32BufferAttribute(uv1, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

// Строить после shapeGround(…, planRoad): следы уже вдавлены в землю, здесь — их дно, вода, кирпичи и тропка.
export function buildRoad({ seed, lines, drive, puddles, wicket }) {
  const rnd = generator(seed + 41);
  const group = new THREE.Group();
  const add = (geometry, material, order = 0) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.renderOrder = order;
    return group.add(mesh);
  };
  const surface = (x, z) => height(x, z) + LIFT;
  const along = (from, to, step, at) => Array.from({ length: Math.round((to - from) / step) + 1 }, (_, i) => at(from + i * step));

  // Дно следов — грунт, рвано тающий в траву; у каждого следа своё место на маске края, чтобы следы не повторяли друг друга.
  // У лужи след шире — во всю яму.
  lines.forEach((line, k) => {
    const points = along(-STREET.reach, STREET.reach, 0.25, (x) => ({ x, z: line.z(x) }));
    const half = (i) => (RUT.width / 2) * (1 + (PUDDLE.wide - 1) * Math.max(0, ...puddles.filter((p) => p.line === k)
      .map((p) => 1 - (Math.abs(points[i].x - p.x) / (p.length / 2)) ** 2)));
    add(ribbon(points, half, surface, { band: RUT.band, from: rnd() * EDGE_ALONG }), path, 2);
  });
  for (const r of drive) add(ribbon(along(r.from, r.to, 0.15, (z) => ({ x: r.x, z })), () => RUT.width / 2, surface, { band: RUT.band, from: rnd() * EDGE_ALONG }), path, 2);
  add(ribbon(wicket, () => PATH.half, surface, { band: EDGE, from: rnd() * EDGE_ALONG }), path, 1);

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
