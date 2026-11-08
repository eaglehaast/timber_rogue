import * as THREE from 'three';
import { generator } from './random.js';
import { height, normal } from './terrain.js';
import { tiles, strips, decal, merge } from './surface.js';
import { route, curve, tube } from './pipe.js';
import { R, COURSE, PLINTH, THICKEST, OVERHANG, blind } from './house.js';

// Газовая линия по каталогу ChatGPT «Газовая линия и ввод в дом» (2026-11-08, по видео Никиты).
// Улица: жёлтая труба на тёмных круглых стойках, в открытом седле, выше забора (Никита: 2,5–3 м),
// пролёт до SPAN. Над воротами она поднимается рыжей П-образной аркой — снизу плавные колена, наверху крутые;
// перемычку снизу держат две высокие стойки рядом со стояками, в седле, как уличные.
// От тройника тонкий отвод на той же высоте идёт над забором вдоль бока дома без двери — за остатками брёвен фасада
// на углу — к ближнему к улице глухому месту бока (ближняя стена — экономия, Никита) и там одним коленом уходит
// в стену. Перед стеной — кран: латунный корпус и красная рукоятка вдоль трубы (кран открыт). В стене — футляр,
// зазор в нём заделан тёмным. Если пролёт от тройника до колена длинный, его держит стойка во дворе.
// Крепёж — сёдла, накладки — крашен чёрным (Никита: серого не бывает).
// Под каждой стойкой — пятно цемента (Никита: «первоначальная отмостка плюс-минус цемент»).
//
// Картинки — развёртки ChatGPT (tools/gas.py → gas-*.jpg): длина × окружность, у каждого набора общие края,
// поэтому по трубе они лежат вперемешку, каждая на свои TILE метров (у тонкой трубы и стоек — короче во столько раз,
// во сколько они тоньше). Жёлтая — вперемешку со сварными стыками; у арки, где краска переходит в окись, —
// по картинке перехода.
// Улица — Ø 95 мм; ось над землёй — по оси 9-го венца бока (2,35 м): отвод на той же высоте входит в середину
// бревна, а не в паз между брёвнами, и проходит под всем, что висит под свесом крыши, — у самых низких срубов
// (12 венцов) причелины и подзор опускаются над этим местом до 2,6 м (Никита: на 2,8 м труба врезалась в причелину).
const MAIN = { r: 0.0475, axis: PLINTH + R + 8 * COURSE };
const BRANCH = { r: 0.017, out: OVERHANG + THICKEST * R + 0.12 }; // м: отвод — Ø 34 мм; во дворе — от оси бока
const POST = { r: 0.03, branch: 0.02 };       // м: стойки улицы и отвода
const SPAN = 4, BRANCH_SPAN = 4.5;            // м: самый длинный пролёт
const ARCH = { w: 4.2, h: 5, low: 0.4, high: 0.16 }; // просвет между стояками и до низа перемычки; радиусы колен
const ELBOW = 0.06;                           // м: колено отвода
const STREET = 1;                             // м: от забора к улице до оси трубы
const REACH = 45;                             // м: улица по обе стороны от середины двора
const CLEAR = 0.08, ROOM = 0.15;              // м: от наличника и выпусков пятой стены до трубы; ширина места для ввода
const TILE = 1.2;                             // м трубы Ø 95 мм на одну развёртку
const FOOTING = 0.5;                          // м: сторона картинки цемента
const SIDES = 16;

const paint = (hex) => new THREE.MeshLambertMaterial({ color: hex });
const MAT = {
  yellow: strips('gas-yellow.jpg', 11), turn: strips('gas-turn.jpg', 2), oxide: strips('gas-oxide.jpg', 6), post: strips('gas-post.jpg', 4),
  footing: decal(tiles(['assets/textures/gas-footing.webp'])[0]),
  iron: paint(0x1e2022), brass: paint(0x95815c), handle: paint(0xa3261d), seal: paint(0x2f2d29),
};
const FEET = 5; // картинок цемента в ряд

// Где отвод входит в бок дома: глухой бок (без двери), ближнее к улице место между окнами, углами и выпусками
// пятой стены. Всё — в метрах двора: дом стоит в at фасадом к улице (+z), at.y — земля под ним; fence — где забор
// со стороны улицы (z), gate — середина ворот (x).
export function planGas(plan, at, { fence, gate }) {
  const door = plan.openings.find((o) => o.kind === 'door').wall;
  const wall = door === 'left' ? 'right' : 'left', out = wall === 'right' ? 1 : -1;
  const [a, b] = blind(plan, wall, CLEAR).filter(([a, b]) => b - a >= ROOM).at(-1);
  const wallX = at.x + (out * plan.w) / 2;
  return { seed: plan.seed, floor: at.y, street: fence + STREET, gate, branch: { x: wallX + out * BRANCH.out, z: at.z + Math.max((a + b) / 2, b - 0.25), wallX, out } };
}

export function buildGas({ seed, floor, street, gate, branch }) {
  const rnd = generator(seed + 7);
  const set = () => Math.floor(rnd() * 1000);
  const parts = Object.fromEntries(Object.keys(MAT).map((name) => [name, []]));
  const put = (name, geometry, matrix) => parts[name].push(matrix ? geometry.applyMatrix4(matrix) : geometry);
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  // Трубка: развёртка на TILE метров у трубы улицы, у тонких — короче во столько раз, во сколько они тоньше.
  const pipe = (path, r) => tube(path, r, { set: set(), tile: (TILE * r) / MAIN.r, sides: SIDES });
  const line = (...points) => curve(points);
  // Труба идёт ровно, на высоте ввода в дом; стойки под ней по земле — какой длины выйдут.
  const H = floor + MAIN.axis, z = street;

  // Улица и арка над воротами. Рыжая — от начала нижних колен; перед ними по развёртке перехода краски в окись,
  // её жёлтый край снаружи (правая трубка перехода идёт к арке с другой стороны).
  const left = gate - ARCH.w / 2 - MAIN.r, right = gate + ARCH.w / 2 + MAIN.r, top = floor + ARCH.h + MAIN.r;
  const a0 = left - ARCH.low, a1 = right + ARCH.low;
  put('yellow', pipe(line(V(-REACH, H, z), V(a0 - TILE, H, z)), MAIN.r));
  put('turn', pipe(line(V(a0 - TILE, H, z), V(a0, H, z)), MAIN.r));
  put('oxide', pipe(route([V(a0, H, z), V(left, H, z), V(left, top, z), V(right, top, z), V(right, H, z), V(a1, H, z)],
    (i) => (i === 1 || i === 4 ? ARCH.low : ARCH.high)), MAIN.r));
  put('turn', pipe(line(V(a1 + TILE, H, z), V(a1, H, z)), MAIN.r));
  put('yellow', pipe(line(V(a1 + TILE, H, z), V(REACH, H, z)), MAIN.r));

  // Цемент — картинка сверху на земле (лежит по её скату), стойка в её середине; какая из FEET и как повёрнута — наугад.
  const feet = (x, zz) => {
    const k = Math.floor(rnd() * FEET), plane = new THREE.PlaneGeometry(FOOTING, FOOTING).rotateX(-Math.PI / 2).rotateY(rnd() * Math.PI * 2);
    const uv = plane.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, (k + uv.getX(i)) / FEET);
    const slope = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal(x, zz));
    put('footing', plane, new THREE.Matrix4().compose(V(x, height(x, zz) + 0.005, zz), slope, V(1, 1, 1)));
  };
  // Стойка: круглая труба от цемента до седла — гнутой полосы толщиной 4 мм, что подхватывает трубу радиуса held снизу на 200°.
  const stand = (x, zz, held, post, axis, y = H) => {
    const seat = y - held - 0.006;
    put('post', pipe(line(V(x, height(x, zz) - 0.05, zz), V(x, seat, zz)), post));
    const saddle = new THREE.Shape().absarc(0, 0, held + 0.006, THREE.MathUtils.degToRad(170), THREE.MathUtils.degToRad(370), false)
      .absarc(0, 0, held + 0.002, THREE.MathUtils.degToRad(370), THREE.MathUtils.degToRad(170), true);
    put('iron', new THREE.ExtrudeGeometry(saddle, { depth: 0.06, bevelEnabled: false, curveSegments: 12 }).translate(0, 0, -0.03)
      .rotateY(axis === 'x' ? Math.PI / 2 : 0), new THREE.Matrix4().setPosition(x, y, zz));
    put('iron', new THREE.CylinderGeometry(post + 0.004, post + 0.004, 0.03, 12), new THREE.Matrix4().setPosition(x, seat - 0.012, zz));
    feet(x, zz);
  };
  // Стойки улицы — от арки наружу, у самых колен и дальше через SPAN; у тройника стойку отодвигаем.
  const posts = [];
  for (let x = a1 + 0.5; x < REACH; x += SPAN) posts.push(x);
  for (let x = a0 - 0.5; x > -REACH; x -= SPAN) posts.push(x);
  for (const x of posts) stand(Math.abs(x - branch.x) < 0.3 ? branch.x + Math.sign(x - branch.x || 1) * 0.3 : x, z, MAIN.r, POST.r, 'x');
  // Высокие стойки арки — под перемычкой, сразу за верхними коленами: держат её снизу седлом.
  for (const x of [left + ARCH.high + 0.15, right - ARCH.high - 0.15]) stand(x, z, MAIN.r, POST.r, 'x', top);

  // Тройник на улице и отвод: над забором вдоль бока к месту ввода, коленом к стене и в стену.
  const { x, wallX, out } = branch;
  put('yellow', pipe(line(V(x - 0.11, H, z), V(x + 0.11, H, z)), MAIN.r * 1.15));
  put('yellow', pipe(route([V(x, H, z), V(x, H, branch.z), V(wallX, H, branch.z)], () => ELBOW), BRANCH.r));
  const span = z - branch.z, count = Math.ceil(span / BRANCH_SPAN);
  for (let i = 1; i < count; i++) stand(x, z - (span * i) / count, BRANCH.r, POST.branch, 'z');

  // Кран между коленом и стеной: корпус — тело вращения (шар между двумя муфтами с гранями), шток вверх,
  // красная рукоятка-флажок вдоль трубы.
  const face = wallX + out * (THICKEST * R + 0.005), valve = (face + x - out * ELBOW) / 2;
  const toAxis = new THREE.Matrix4().makeRotationZ(Math.PI / 2), at = (dx, dy = 0) => new THREE.Matrix4().setPosition(valve + dx, H + dy, branch.z);
  const r = BRANCH.r, body = [[r * 0.9, -0.05], [r * 1.25, -0.05], [r * 1.25, -0.03], [r * 1.55, -0.022], [r * 1.85, -0.008], [r * 1.85, 0.008], [r * 1.55, 0.022], [r * 1.25, 0.03], [r * 1.25, 0.05], [r * 0.9, 0.05]];
  put('brass', new THREE.LatheGeometry(body.map(([a, b]) => new THREE.Vector2(a, b)), SIDES).applyMatrix4(toAxis), at(0));
  for (const dx of [-0.04, 0.04]) put('brass', new THREE.CylinderGeometry(r * 1.45, r * 1.45, 0.016, 6).applyMatrix4(toAxis), at(dx));
  put('brass', new THREE.CylinderGeometry(0.005, 0.006, 0.02, 10), at(0, r * 1.8 + 0.008));
  const lever = new THREE.Shape().moveTo(-0.012, -0.007).lineTo(0.07, -0.005).quadraticCurveTo(0.08, 0, 0.07, 0.005).lineTo(-0.012, 0.007).quadraticCurveTo(-0.018, 0, -0.012, -0.007);
  put('handle', new THREE.ExtrudeGeometry(lever, { depth: 0.003, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.0015, bevelSegments: 2 })
    .rotateX(-Math.PI / 2).rotateY(out > 0 ? Math.PI : 0), at(0, r * 1.8 + 0.02));
  // Ввод: футляр, крашенный как труба, из стены (бревно бывает и тоньше — тогда футляр торчит чуть больше),
  // в нём тёмная заделка.
  const sleeve = r * 1.8, toWall = new THREE.Matrix4().makeRotationY((out * Math.PI) / 2);
  put('yellow', pipe(line(V(wallX, H, branch.z), V(face, H, branch.z)), sleeve));
  put('seal', new THREE.RingGeometry(r, sleeve, SIDES).applyMatrix4(toWall), new THREE.Matrix4().setPosition(face, H, branch.z));

  const group = new THREE.Group();
  for (const [name, list] of Object.entries(parts)) {
    if (!list.length) continue;
    const mesh = new THREE.Mesh(merge(list), MAT[name]);
    mesh.castShadow = name !== 'footing';
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
