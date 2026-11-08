import * as THREE from 'three';
import { generator } from './random.js';
import { tiles, soften, merge } from './surface.js';
import { R, COURSE, PLINTH, THICKEST, OVERHANG } from './house.js';
import { TRIM_WIDTH } from './window.js';

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

const strips = (file, rows) => soften(new THREE.MeshLambertMaterial({ map: tiles([`assets/textures/${file}`])[0] }),
  { contrast: 1, saturation: 1, scales: [0.3, 1], low: [1, 1, 1], high: [1, 1, 1], cells: [1, rows] });
const paint = (hex) => new THREE.MeshLambertMaterial({ color: hex });
const MAT = {
  yellow: strips('gas-yellow.jpg', 11), turn: strips('gas-turn.jpg', 2), oxide: strips('gas-oxide.jpg', 6), post: strips('gas-post.jpg', 4),
  footing: new THREE.MeshLambertMaterial({ map: tiles(['assets/textures/gas-footing.webp'])[0], transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
  iron: paint(0x1e2022), brass: paint(0x95815c), handle: paint(0xa3261d), seal: paint(0x2f2d29),
};
const FEET = 5; // картинок цемента в ряд

// Путь трубы — ломаная, в углах колена радиуса bend(i): точки оси с касательной t и длиной s от начала.
function route(points, bend) {
  const dir = (a, b) => b.clone().sub(a).normalize();
  const out = [{ p: points[0].clone(), t: dir(points[0], points[1]), s: 0 }];
  const push = (p, t) => out.push({ p, t, s: out.at(-1).s + p.distanceTo(out.at(-1).p) });
  for (let i = 1; i < points.length - 1; i++) {
    const a = dir(points[i - 1], points[i]), b = dir(points[i], points[i + 1]), turn = a.angleTo(b);
    if (turn < 1e-4) continue;
    const r = bend(i), start = points[i].clone().addScaledVector(a, -r * Math.tan(turn / 2));
    const axis = a.clone().cross(b).normalize(), center = start.clone().addScaledVector(axis.clone().cross(a), r);
    const n = Math.ceil(turn / (Math.PI / 16));
    for (let k = 0; k <= n; k++) {
      const q = new THREE.Quaternion().setFromAxisAngle(axis, (turn * k) / n);
      push(start.clone().sub(center).applyQuaternion(q).add(center), a.clone().applyQuaternion(q));
    }
  }
  push(points.at(-1).clone(), dir(points.at(-2), points.at(-1)));
  return out;
}
const line = (...points) => route(points);

// Трубка вдоль пути: кольца в его точках. Рамку кольца переносим от точки к точке поворотом касательной —
// сечение не перекручивается на коленах, а шов развёртки идёт по одной линии. Вдоль трубы укладывается целое число
// развёрток (чуть растянутых или сжатых): труба начинается и кончается краем картинки — там, где у всех картинок
// набора общий край, и соседняя трубка продолжает её без шва. Номер картинки — по клетке uv (soften, cells):
// у каждой трубки свой ряд клеток set, чтобы порядок картинок не повторялся.
function tube(path, r, set) {
  const length = path.at(-1).s, tile = length / Math.max(1, Math.round(length / ((TILE * r) / MAIN.r)));
  const pos = [], normal = [], uv = [], index = [];
  const n = new THREE.Vector3(0, 1, 0);
  if (Math.abs(path[0].t.y) > 0.9) n.set(1, 0, 0);
  n.sub(path[0].t.clone().multiplyScalar(n.dot(path[0].t))).normalize();
  const d = new THREE.Vector3();
  path.forEach(({ p, t, s }, i) => {
    if (i) n.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(path[i - 1].t, t));
    const b = t.clone().cross(n);
    for (let j = 0; j <= SIDES; j++) {
      const angle = (j / SIDES) * Math.PI * 2;
      d.copy(n).multiplyScalar(Math.cos(angle)).addScaledVector(b, Math.sin(angle));
      pos.push(p.x + d.x * r, p.y + d.y * r, p.z + d.z * r);
      normal.push(d.x, d.y, d.z);
      uv.push(s / tile, set + j / SIDES);
    }
    if (!i) return;
    const a0 = (i - 1) * (SIDES + 1), a1 = i * (SIDES + 1);
    for (let j = 0; j < SIDES; j++) index.push(a0 + j, a0 + j + 1, a1 + j, a1 + j, a0 + j + 1, a1 + j + 1);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  return geometry;
}

// Где отвод входит в бок дома: глухой бок (без двери), ближнее к улице место между окнами, углами и выпусками
// пятой стены. Всё — в метрах двора: дом стоит в at фасадом к улице (+z), fence — где забор со стороны улицы (z),
// gate — середина ворот (x).
export function planGas(plan, at, { fence, gate }) {
  const door = plan.openings.find((o) => o.kind === 'door').wall;
  const wall = door === 'left' ? 'right' : 'left', out = wall === 'right' ? 1 : -1;
  const edge = plan.d / 2 - 0.5;
  const blocked = plan.openings.filter((o) => o.wall === wall).map((o) => [o.at - TRIM_WIDTH / 2 - CLEAR, o.at + TRIM_WIDTH / 2 + CLEAR]);
  if (plan.middle !== null) blocked.push([plan.middle - R - CLEAR, plan.middle + R + CLEAR]);
  blocked.sort((a, b) => a[0] - b[0]);
  // Свободные отрезки вдоль бока, z — от середины дома; берём ближний к улице.
  const free = [];
  let from = -edge;
  for (const [a, b] of blocked) {
    if (a > from) free.push([from, Math.min(a, edge)]);
    from = Math.max(from, b);
  }
  if (from < edge) free.push([from, edge]);
  const [a, b] = free.filter(([a, b]) => b - a >= ROOM).at(-1);
  const wallX = at.x + (out * plan.w) / 2;
  return { seed: plan.seed, street: fence + STREET, gate, branch: { x: wallX + out * BRANCH.out, z: at.z + Math.max((a + b) / 2, b - 0.25), wallX, out } };
}

export function buildGas({ seed, street, gate, branch }) {
  const rnd = generator(seed + 7);
  const set = () => Math.floor(rnd() * 1000);
  const parts = Object.fromEntries(Object.keys(MAT).map((name) => [name, []]));
  const put = (name, geometry, matrix) => parts[name].push(matrix ? geometry.applyMatrix4(matrix) : geometry);
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const H = MAIN.axis, z = street;

  // Улица и арка над воротами. Рыжая — от начала нижних колен; перед ними по развёртке перехода краски в окись,
  // её жёлтый край снаружи (правая трубка перехода идёт к арке с другой стороны).
  const left = gate - ARCH.w / 2 - MAIN.r, right = gate + ARCH.w / 2 + MAIN.r, top = ARCH.h + MAIN.r;
  const a0 = left - ARCH.low, a1 = right + ARCH.low;
  put('yellow', tube(line(V(-REACH, H, z), V(a0 - TILE, H, z)), MAIN.r, set()));
  put('turn', tube(line(V(a0 - TILE, H, z), V(a0, H, z)), MAIN.r, set()));
  put('oxide', tube(route([V(a0, H, z), V(left, H, z), V(left, top, z), V(right, top, z), V(right, H, z), V(a1, H, z)],
    (i) => (i === 1 || i === 4 ? ARCH.low : ARCH.high)), MAIN.r, set()));
  put('turn', tube(line(V(a1 + TILE, H, z), V(a1, H, z)), MAIN.r, set()));
  put('yellow', tube(line(V(a1 + TILE, H, z), V(REACH, H, z)), MAIN.r, set()));

  // Цемент — картинка сверху на земле, стойка в её середине; какая из FEET и как повёрнута — наугад.
  const feet = (x, zz) => {
    const k = Math.floor(rnd() * FEET), plane = new THREE.PlaneGeometry(FOOTING, FOOTING).rotateX(-Math.PI / 2).rotateY(rnd() * Math.PI * 2);
    const uv = plane.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, (k + uv.getX(i)) / FEET);
    put('footing', plane, new THREE.Matrix4().setPosition(x, 0.005, zz));
  };
  // Стойка: круглая труба от цемента до седла — гнутой полосы толщиной 4 мм, что подхватывает трубу снизу на 200°.
  const stand = (x, zz, pipe, post, axis, y = H) => {
    const seat = y - pipe - 0.006;
    put('post', tube(line(V(x, -0.05, zz), V(x, seat, zz)), post, set()));
    const saddle = new THREE.Shape().absarc(0, 0, pipe + 0.006, THREE.MathUtils.degToRad(170), THREE.MathUtils.degToRad(370), false)
      .absarc(0, 0, pipe + 0.002, THREE.MathUtils.degToRad(370), THREE.MathUtils.degToRad(170), true);
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
  put('yellow', tube(line(V(x - 0.11, H, z), V(x + 0.11, H, z)), MAIN.r * 1.15, set()));
  put('yellow', tube(route([V(x, H, z), V(x, H, branch.z), V(wallX, H, branch.z)], () => ELBOW), BRANCH.r, set()));
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
  put('yellow', tube(line(V(wallX, H, branch.z), V(face, H, branch.z)), sleeve, set()));
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
