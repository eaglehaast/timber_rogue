import * as THREE from 'three';
import { generator, smoothNoise } from './random.js';
import { tiles, soften } from './surface.js';
import { YARD, GATES } from './fence.js';
import { height } from './terrain.js';
import { brickMaterial, BRICK_TILE } from './roof.js';

// Улица перед двором — колея среди травы (Никита, 2026-11-08: «два рельефных следа шин, кое-где глубокие лужи,
// в лужи можно пихнуть кирпичи, между колеями трава, с невысокими травами»). Полосы грунта нет.
// Следы вдавлены в саму землю (dug — для terrain.js): по краям выдавлен валик грязи, кое-где след проседает ямой,
// в яме стоит вода, в воде — обломки кирпича. К воротам машины сворачивали с улицы с обеих сторон: из каждого
// уличного следа дугой выходит свой, как рельсы на трамвайном перекрёстке, и у ворот дуги сходятся в съезд.
// Участок брошен: тропки к калитке не осталось.
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
// Поворот в ворота: радиус дуги середины машины; на сколько съезд заходит во двор; глубина — доля самой глубокой уличной.
const TURN = { radius: 4, inside: 1, depth: 0.6 };
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
const mud = soften(new THREE.MeshLambertMaterial({ map: base, alphaMap: edge, ...flat }), look);
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
  // Поворот: машина шла серединой улицы и сворачивала к воротам по четверти круга радиуса TURN.radius — колёса по
  // кругам на полколеи меньше и больше. Каждая дуга начинается на уличном следе по касательной, а кончается
  // на z = turn над своим следом съезда; дальше съезд идёт прямо в ворота.
  // from — откуда ехали: −1 со стороны −x, 1 со стороны +x. Дуга: радиус, off — как далеко от неё, at — точка по углу 0..π/2.
  const turn = center - TURN.radius, deep = TURN.depth * RUT.depth[1];
  // В своей ли четверти круга точка и как далеко она от круга радиуса r.
  const quarter = (from, cx, r) => (x, z) => (from * (x - cx) <= 0 && z >= turn ? Math.abs(Math.hypot(x - cx, z - turn) - r) : Infinity);
  const arcs = [-1, 1].flatMap((from) => [-1, 1].map((side) => {
    const cx = GATES.at + from * TURN.radius, r = TURN.radius + (side * RUT.gauge) / 2;
    return { r, off: quarter(from, cx, r), at: (a) => ({ x: cx - from * r * Math.sin(a), z: turn + r * Math.cos(a) }) };
  }));
  const gate = [-1, 1].map((side) => GATES.at + (side * RUT.gauge) / 2);
  // Все следы — расстояние от оси следа (Infinity — не здесь) и глубина. Дуга — только в своей четверти круга.
  const tracks = [
    ...lines.map((line) => ({ off: (x, z) => Math.abs(z - line.z(x)), depth: line.depth })),
    ...arcs.map(({ off }) => ({ off, depth: () => deep })),
    ...gate.map((gx) => ({
      off: (x, z) => (z >= fence - TURN.inside && z <= turn ? Math.abs(x - gx) : Infinity),
      depth: (x, z) => deep * THREE.MathUtils.smoothstep(z, fence - TURN.inside, fence - TURN.inside + 1),
    })),
  ];
  // Лужи — ямы в следах улицы у двора: { line, x, length, deep }.
  const puddles = Array.from({ length: PUDDLE.count }, () => {
    const lerp = (r) => r[0] + rnd() * (r[1] - r[0]);
    return { line: Math.floor(rnd() * 2), x: (rnd() * 2 - 1) * (YARD.w / 2 - 2), length: lerp(PUDDLE.length), deep: lerp(PUDDLE.deep) };
  });

  // Где следы сходятся, земля — по самому глубокому месту: след прорезает валик соседнего, а не складывается с ним.
  const dug = (x, z) => {
    let d = -Infinity;
    for (const track of tracks) {
      const t = track.off(x, z) / half;
      if (t < 1.6) d = Math.max(d, track.depth(x, z) * profile(t));
    }
    if (d === -Infinity) d = 0;
    for (const p of puddles) {
      const t = Math.abs(z - lines[p.line].z(x)) / half, u = Math.abs(x - p.x) / (p.length / 2);
      if (u < 1) d += p.deep * (1 - u * u) ** 2 * Math.max(0, profile(t / PUDDLE.wide));
    }
    return d;
  };
  // Где сетка земли частая: ряды — вдоль улицы и на повороте, столбцы — на повороте.
  const rows = [[fence - TURN.inside, center + RUT.gauge / 2 + RUT.width]];
  const cols = [[GATES.at - TURN.radius - RUT.gauge, GATES.at + TURN.radius + RUT.gauge]];

  // Трава: на следах нет; на улице и там, где машина сворачивала, топчут — там она низкая.
  const s = THREE.MathUtils.smoothstep;
  const grass = (x, z) => Math.min(...tracks.map((track) => s(track.off(x, z) / half, 0.8, 1.2)));
  // Середина машины: улица, два поворота, съезд.
  const middle = [(x, z) => Math.abs(z - center), ...[-1, 1].map((from) => quarter(from, GATES.at + from * TURN.radius, TURN.radius)),
    (x, z) => (z >= fence - TURN.inside && z <= turn ? Math.abs(x - GATES.at) : Infinity)];
  const trodden = (x, z) => 1 - s(Math.min(...middle.map((off) => off(x, z))), RUT.gauge / 2 + 0.3, RUT.gauge / 2 + 1.2);
  return { seed, lines, arcs, gate, fence, turn, puddles, dug, rows, cols, grass, trodden };
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

// Строить после shapeGround(…, planRoad): следы уже вдавлены в землю, здесь — их дно, вода и кирпичи.
export function buildRoad({ seed, lines, arcs, gate, fence, turn, puddles }) {
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
    add(ribbon(points, half, surface, { band: RUT.band, from: rnd() * EDGE_ALONG }), mud, 2);
  });
  const track = (points) => add(ribbon(points, () => RUT.width / 2, surface, { band: RUT.band, from: rnd() * EDGE_ALONG }), mud, 2);
  for (const { r, at } of arcs) track(along(0, Math.PI / 2, 0.15 / r, at));
  for (const x of gate) track(along(fence - TURN.inside, turn, 0.15, (z) => ({ x, z })));

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
