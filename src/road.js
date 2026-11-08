import * as THREE from 'three';
import { generator } from './random.js';
import { tiles, soften } from './surface.js';
import { WICKET, GATES } from './fence.js';

// Грунтовая улица перед двором по каталогу ChatGPT «Грунтовая улица» (R01–R06, R09; 2026-11-08):
// одна полоса утрамбованной земли вдоль забора с воротами — за опорами и обочиной, — в поперечнике чуть выпуклая.
// Край не резкий: на полосе EDGE вокруг края земля рвано тает в траву по маске. По полотну местами две слабые
// колеи. Перед воротами край улицы раскрывается веером съезда, сбоку к калитке подходит узкая тропка.
// Канава с трубой под съездом, мокрая земля и лужи — следующие шаги.
//
// Картинки (заказ ChatGPT, tools/road.py): road-base — грунт, плитка BASE метров; road-edge — маска края:
// вдоль EDGE_ALONG метров, поперёк — полоса EDGE, снизу земля (белое), сверху трава (чёрное); road-rut — маска следа
// поперёк RUT.width. Пока на их местах заглушки тех же форматов.
const ROAD = {
  near: 2.8,       // м от забора до ближнего края: опоры на 2,2 м и обочина
  width: 3.5,      // м утрамбованной полосы
  crown: 0.04,     // м подъёма к середине
  reach: 60,       // м улицы в обе стороны от середины двора
};
const EDGE = 1, EDGE_ALONG = 4, BASE = 4;   // м: полоса тающего края; длина маски края; сторона плитки грунта
const LIFT = 0.01;                          // м над травой, чтобы не мерцать с ней
const RUT = { gauge: 1.45, width: 0.5, strength: [1, 0.6] }; // колея: между следами; полоса маски; сила следов
// Съезд: шире ворот на margin с каждой стороны, к улице раскрывается ещё на flare; заходит во двор на inside.
const DRIVE = { margin: 0.3, flare: 1, inside: 0.5 };
const PATH = { half: 0.4, edge: 0.5 };      // тропка к калитке: полуширина, полоса края

const [base, edge, rut] = tiles(['road-base.jpg', 'road-edge.png', 'road-rut.png'].map((f) => `assets/textures/${f}`));
for (const mask of [edge, rut]) {
  mask.colorSpace = THREE.NoColorSpace;     // маски — доли, а не цвет
  mask.channel = 1;                         // берут вторые координаты: вдоль ленты и поперёк неё
  mask.wrapT = THREE.ClampToEdgeWrapping;   // внутри полотна — нижний ряд маски (земля), за ним — верхний (трава)
}
const flat = { transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 };
const ground = soften(new THREE.MeshLambertMaterial({ map: base, alphaMap: edge, ...flat }), {
  contrast: 0.9, saturation: 0.8, scales: [0.13, 0.5], low: [0.92, 0.92, 0.9], high: [1.02, 1.02, 1], cells: [1, 1],
});
const track = new THREE.MeshLambertMaterial({ color: 0x8a7763, alphaMap: rut, vertexColors: true, ...flat });

// Лента по земле вдоль середины points ({x, z} через равные шаги): полотно полуширины half(i), высота — surface(x, z).
// По краю — полоса band: в ней маска идёт от земли к траве (uv1.y от 0 до 1), внутри полотна — земля целиком.
// across — маска поперёк всей ленты (колея). alpha(s) — сила по длине (колея местами слабее и рвётся).
function ribbon(points, half, surface, { band, across = false, alpha }) {
  const pos = [], uv = [], uv1 = [], color = [], index = [];
  let s = 0;
  points.forEach((p, i) => {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    const t = new THREE.Vector2(b.x - a.x, b.z - a.z).normalize(), n = new THREE.Vector2(-t.y, t.x);
    if (i) s += Math.hypot(p.x - points[i - 1].x, p.z - points[i - 1].z);
    const h = half(i), inner = h - band / 2, outer = h + band / 2;
    // Поперёк: края полосы маски — отдельными точками, чтобы маска шла по ним ровно; внутри — для выпуклости.
    const offsets = across ? [-outer, -h, 0, h, outer]
      : [-outer, -inner, ...Array.from({ length: 5 }, (_, k) => inner * (k / 2 - 1)), inner, outer];
    offsets.forEach((d) => {
      const x = p.x + n.x * d, z = p.z + n.y * d;
      pos.push(x, surface(x, z), z);
      uv.push(x / BASE, z / BASE);
      uv1.push(s / EDGE_ALONG, across ? (d + outer) / (2 * outer) : (Math.abs(d) - inner) / band);
      color.push(1, 1, 1, alpha ? alpha(s) : 1);
    });
    if (!i) return;
    const k = offsets.length, a0 = (i - 1) * k, a1 = i * k;
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

// Улица вдоль забора со стороны дороги (fence — его z), съезд к воротам и тропка к калитке — в метрах двора.
export function buildRoad({ seed, fence }) {
  const rnd = generator(seed + 37);
  const center = fence + ROAD.near + ROAD.width / 2, half = ROAD.width / 2;
  const along = (from, to, step, at) => Array.from({ length: Math.round((to - from) / step) + 1 }, (_, i) => at(from + i * step));
  const group = new THREE.Group();
  const add = (geometry, material, order) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.renderOrder = order;
    group.add(mesh);
  };
  // Поверхность полотна: чуть над травой, к середине улицы выпуклая. По ней же ложатся съезд, тропка и колея.
  const surface = (x, z) => LIFT + ROAD.crown * Math.max(0, 1 - ((z - center) / half) ** 2);
  add(ribbon(along(-ROAD.reach, ROAD.reach, 0.5, (x) => ({ x, z: center })), () => half, surface, { band: EDGE }), ground, 1);

  // Колея: два следа по RUT.gauge, видны местами — сила плавно гуляет по длине и рвётся; второй след слабее.
  RUT.strength.forEach((strength, k) => {
    const phase = [rnd() * 10, rnd() * 10, rnd() * 10];
    const alpha = (s) => strength * THREE.MathUtils.clamp(0.55 + 0.45 * Math.sin(s / 6.5 + phase[0]) + 0.35 * Math.sin(s / 2.1 + phase[1]) + 0.2 * Math.sin(s / 0.9 + phase[2]), 0, 1);
    const z = center + (k ? 1 : -1) * RUT.gauge / 2;
    add(ribbon(along(-ROAD.reach, ROAD.reach, 0.5, (x) => ({ x, z })), () => RUT.width / 2, (x, z) => surface(x, z) + 0.002, { band: 0, across: true, alpha }), track, 2);
  });

  // Съезд: от середины улицы через обочину в ворота и чуть во двор. У ворот — их ширина и margin, к улице край
  // плавно расходится веером ещё на flare с каждой стороны.
  const gate = GATES.width / 2 + DRIVE.margin, edgeZ = fence + ROAD.near;
  const drive = along(fence - DRIVE.inside, center, 0.25, (z) => ({ x: GATES.at, z }));
  const fan = (z) => gate + DRIVE.flare * THREE.MathUtils.smoothstep(z, fence, edgeZ + 0.5);
  add(ribbon(drive, (i) => fan(drive[i].z), surface, { band: EDGE }), ground, 1);

  // Тропка к калитке: от края улицы, огибая край съезда, в калитку и на полметра во двор.
  const wicket = new THREE.CatmullRomCurve3([
    new THREE.Vector3(WICKET.at - 0.6, 0, edgeZ + 0.3), new THREE.Vector3(WICKET.at - 0.3, 0, fence + 1.2), new THREE.Vector3(WICKET.at, 0, fence - 0.5),
  ]).getSpacedPoints(24);
  add(ribbon(wicket, () => PATH.half, surface, { band: PATH.edge }), ground, 1);
  return group;
}
