import * as THREE from 'three';
import { generator } from './random.js';
import { merge } from './surface.js';
import { R, COURSE, PLINTH, THICKEST } from './house.js';
import { TRIM_WIDTH } from './window.js';

// Газовая линия по каталогу ChatGPT «Газовая линия и ввод в дом» (2026-11-08, по видео Никиты).
// Улица: жёлтая труба на тёмных круглых стойках, в открытом седле, пролёт до SPAN. Над воротами она поднимается
// рыжей П-образной аркой — снизу плавные колена, наверху крутые, — а рядом со стояками стоят свои высокие стойки,
// прихваченные к верху накладкой. От тройника тонкий отвод уходит сквозь забор (fence.js, passes), идёт по двору
// на своих стойках к глухому месту бока дома, у стены поднимается — на подъёме кран и кронштейн с хомутом —
// и коленом уходит в бревно сквозь стальной футляр, зазор в нём заделан тёмным.
// Под каждой стойкой — пятно цемента (Никита: «первоначальная отмостка плюс-минус цемент»).
//
// Цвета — из палитры каталога, пока однотонные. Развёртки от ChatGPT (2048 × 512: длина × окружность) лягут на
// готовые UV: u — вдоль оси, одна картинка на TILE метров, у тонкой трубы короче во столько раз, во сколько
// она тоньше; v — один оборот по окружности.
const MAIN = { r: 0.0475, axis: 1.15 };       // м: улица — Ø 95 мм, ось над землёй
const BRANCH = { r: 0.017, off: 0.24 };       // м: отвод — Ø 34 мм; ось от оси стены бока
const POST = { r: 0.03, branch: 0.02 };       // м: стойки улицы и отвода
const SPAN = 4, BRANCH_SPAN = 2.5;            // м: самый длинный пролёт
const ARCH = { w: 4.2, h: 5, low: 0.4, high: 0.16 }; // просвет между стояками и до низа перемычки; радиусы колен
const ELBOW = 0.06;                           // м: колено отвода
const REACH = 45;                             // м: улица по обе стороны от середины двора
const ENTRY = 1.9;                            // м над землёй: ввод в стену — примерно здесь, по оси бревна
const TILE = 1.2;
const SIDES = 16;

const paint = (hex, extra) => new THREE.MeshLambertMaterial({ color: hex, ...extra });
const MAT = {
  yellow: paint(0xc8b168), oxide: paint(0x985537), post: paint(0x45565d),
  steel: paint(0x8b908b, { side: THREE.DoubleSide }), brass: paint(0x95815c), handle: paint(0x40453e),
  seal: paint(0x55534c), weld: paint(0x624031), cement: paint(0x9d988c),
};

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

// Трубка вдоль пути: кольца в его точках. Рамку кольца переносим от точки к точке поворотом касательной —
// сечение не перекручивается на коленах, а шов развёртки идёт по одной линии.
function tube(path, r, s0 = 0) {
  const tile = (TILE * r) / MAIN.r;
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
      uv.push((s0 + s) / tile, j / SIDES);
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

// Где отвод входит в бок дома: глухой бок (без двери), самое широкое место между окнами, углами и выпусками
// пятой стены — там подъём не заденет наличники. Всё — в метрах двора: дом стоит в at фасадом к улице (+z).
const STREET = 1; // м: от забора к улице до оси трубы

// fence — где забор со стороны улицы (z), gate — середина ворот (x).
export function planGas(plan, at, { fence, gate }) {
  const door = plan.openings.find((o) => o.kind === 'door').wall;
  const wall = door === 'left' ? 'right' : 'left', out = wall === 'right' ? 1 : -1;
  const edge = plan.d / 2 - 0.5;
  const blocked = plan.openings.filter((o) => o.wall === wall).map((o) => [o.at - TRIM_WIDTH / 2 - 0.15, o.at + TRIM_WIDTH / 2 + 0.15]);
  if (plan.middle !== null) blocked.push([plan.middle - 0.45, plan.middle + 0.45]);
  blocked.sort((a, b) => a[0] - b[0]);
  // Свободные отрезки вдоль бока, z — от середины дома.
  const free = [];
  let from = -edge;
  for (const [a, b] of blocked) {
    if (a > from) free.push([from, Math.min(a, edge)]);
    from = Math.max(from, b);
  }
  if (from < edge) free.push([from, edge]);
  const [a, b] = free.reduce((best, f) => (f[1] - f[0] > best[1] - best[0] ? f : best));
  // Ввод — по оси бревна бока (боковые стены лежат на цоколе), ближайшего к высоте ENTRY.
  const k = Math.round((ENTRY - PLINTH - R) / COURSE);
  const wallX = at.x + (out * plan.w) / 2;
  return {
    seed: plan.seed, street: fence + STREET, gate,
    branch: { x: wallX + out * 0.9, z: at.z + (a + b) / 2, wallX, out, y: PLINTH + R + k * COURSE },
  };
}

export function buildGas({ seed, street, gate, branch }) {
  const rnd = generator(seed + 7);
  const parts = Object.fromEntries(Object.keys(MAT).map((name) => [name, []]));
  const put = (name, geometry, matrix) => parts[name].push(matrix ? geometry.applyMatrix4(matrix) : geometry);
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const H = MAIN.axis, z = street;

  // Улица и арка над воротами. Рыжая — от начала нижних колен: там у неё и стык.
  const left = gate - ARCH.w / 2 - MAIN.r, right = gate + ARCH.w / 2 + MAIN.r, top = ARCH.h + MAIN.r;
  const a0 = left - ARCH.low, a1 = right + ARCH.low;
  put('yellow', tube(route([V(-REACH, H, z), V(a0, H, z)], null), MAIN.r));
  const arch = route([V(a0, H, z), V(left, H, z), V(left, top, z), V(right, top, z), V(right, H, z), V(a1, H, z)],
    (i) => (i === 1 || i === 4 ? ARCH.low : ARCH.high));
  put('oxide', tube(arch, MAIN.r));
  put('yellow', tube(route([V(a1, H, z), V(REACH, H, z)], null), MAIN.r));
  const weld = (p, r, axis) => put('weld', new THREE.TorusGeometry(r + 0.002, 0.003, 6, SIDES), new THREE.Matrix4().lookAt(V(0, 0, 0), axis, V(0, 1, 0).cross(axis).lengthSq() > 0.01 ? V(0, 1, 0) : V(1, 0, 0)).setPosition(p));
  for (const x of [a0, a1]) weld(V(x, H, z), MAIN.r, V(1, 0, 0));
  for (let x = a1 + 6; x < REACH; x += 6) weld(V(x, H, z), MAIN.r, V(1, 0, 0));
  for (let x = a0 - 6; x > -REACH; x -= 6) weld(V(x, H, z), MAIN.r, V(1, 0, 0));

  // Стойка: круглая труба от цемента до седла — гнутой полосы, что подхватывает трубу снизу.
  const footing = (x, zz) => {
    // Неровный край — несколько волн по кругу со случайными фазами: шов цилиндра сходится сам с собой.
    const waves = [1, 2, 3].map((n) => [n + 1, rnd() * 6, (0.12 / n) * rnd()]);
    const g = new THREE.CylinderGeometry(0.17, 0.23, 0.08, 18, 1);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const angle = Math.atan2(p.getZ(i), p.getX(i)), k = 1 + waves.reduce((sum, [n, phase, size]) => sum + size * Math.sin(n * angle + phase), 0);
      p.setXYZ(i, p.getX(i) * k, p.getY(i), p.getZ(i) * k);
    }
    g.computeVertexNormals();
    put('cement', g, new THREE.Matrix4().setPosition(x, 0.01, zz));
  };
  const stand = (x, zz, pipe, post, along) => {
    const seat = H - pipe - 0.005, turn = new THREE.Matrix4().makeRotationY(along === 'z' ? Math.PI / 2 : 0);
    put('post', new THREE.CylinderGeometry(post, post, seat + 0.05, 10).translate(0, (seat - 0.05) / 2, 0), new THREE.Matrix4().setPosition(x, 0, zz));
    // Седло — часть трубки на 200° вокруг низа, ось вдоль трубы.
    const saddle = new THREE.CylinderGeometry(pipe + 0.005, pipe + 0.005, 0.07, 12, 1, true, THREE.MathUtils.degToRad(170), THREE.MathUtils.degToRad(200))
      .rotateZ(Math.PI / 2).translate(0, H, 0).applyMatrix4(turn);
    put('steel', saddle, new THREE.Matrix4().setPosition(x, 0, zz));
    footing(x, zz);
  };
  // Стойки улицы — от арки наружу, у самых колен и дальше через SPAN; у тройника стойку отодвигаем.
  const posts = [];
  for (let x = a1 + 0.5; x < REACH; x += SPAN) posts.push(x);
  for (let x = a0 - 0.5; x > -REACH; x -= SPAN) posts.push(x);
  for (const x of posts) stand(Math.abs(x - branch.x) < 0.3 ? branch.x + Math.sign(x - branch.x || 1) * 0.3 : x, z, MAIN.r, POST.r, 'x');
  // Высокие стойки арки — рядом со стояками, со стороны улицы; накладка у верха прихватывает стояк.
  for (const x of [left, right]) {
    const zz = z + 0.17, height = top - ARCH.high - 0.1;
    put('post', new THREE.CylinderGeometry(POST.r, POST.r, height + 0.05, 10).translate(0, (height - 0.05) / 2, 0), new THREE.Matrix4().setPosition(x, 0, zz));
    put('steel', new THREE.BoxGeometry(0.05, 0.02, zz - z), new THREE.Matrix4().setPosition(x, height - 0.05, (z + zz) / 2));
    footing(x, zz);
  }

  // Тройник на улице и отвод: сквозь забор во двор, к глухому месту бока, к стене, вверх и в стену.
  const { x, wallX, out, y } = branch;
  put('yellow', new THREE.CylinderGeometry(MAIN.r * 1.15, MAIN.r * 1.15, 0.22, SIDES).rotateZ(Math.PI / 2), new THREE.Matrix4().setPosition(x, H, z));
  const near = wallX + out * BRANCH.off;
  const path = route([V(x, H, z), V(x, H, branch.z), V(near, H, branch.z), V(near, y, branch.z), V(wallX, y, branch.z)], () => ELBOW);
  put('yellow', tube(path, BRANCH.r));
  // Стойки отвода — поровну от места у дома до забора, не дальше BRANCH_SPAN одна от другой.
  const run = [branch.z + 0.4, z - STREET - 0.3], count = Math.ceil((run[1] - run[0]) / BRANCH_SPAN);
  for (let i = 0; i <= count; i++) stand(x, run[0] + ((run[1] - run[0]) * i) / count, BRANCH.r, POST.branch, 'z');

  // Кран на подъёме: корпус с гранями на концах, шток наружу и рукоятка вдоль трубы — кран открыт.
  const valve = H + 0.4 * (y - H);
  put('brass', new THREE.CylinderGeometry(BRANCH.r * 1.8, BRANCH.r * 1.8, 0.05, SIDES), new THREE.Matrix4().setPosition(near, valve, branch.z));
  for (const dy of [-0.035, 0.035]) put('brass', new THREE.CylinderGeometry(BRANCH.r * 1.5, BRANCH.r * 1.5, 0.022, 6), new THREE.Matrix4().setPosition(near, valve + dy, branch.z));
  put('brass', new THREE.CylinderGeometry(0.006, 0.006, 0.04, 8).rotateZ(Math.PI / 2), new THREE.Matrix4().setPosition(near + out * 0.045, valve, branch.z));
  put('handle', new THREE.BoxGeometry(0.012, 0.11, 0.022), new THREE.Matrix4().setPosition(near + out * 0.068, valve + 0.04, branch.z));
  // Кронштейн: пятка на бревне (по оси венца под краном), вынос до трубы, хомут вокруг неё.
  const bracket = PLINTH + R + Math.round((valve - 0.2 - PLINTH - R) / COURSE) * COURSE;
  const heel = wallX + out * (THICKEST * R + 0.006), arm = BRANCH.off - THICKEST * R - BRANCH.r;
  put('steel', new THREE.BoxGeometry(0.012, 0.1, 0.05), new THREE.Matrix4().setPosition(heel, bracket, branch.z));
  put('steel', new THREE.BoxGeometry(arm, 0.02, 0.01), new THREE.Matrix4().setPosition(heel + (out * arm) / 2, bracket, branch.z));
  put('steel', new THREE.TorusGeometry(BRANCH.r + 0.004, 0.004, 6, SIDES).rotateX(Math.PI / 2), new THREE.Matrix4().setPosition(near, bracket, branch.z));
  // Ввод: стальной футляр из стены (бревно бывает и тоньше — тогда футляр торчит чуть больше), в нём тёмная заделка.
  const sleeve = BRANCH.r * 1.8, face = wallX + out * (THICKEST * R + 0.005), toWall = new THREE.Matrix4().makeRotationY((out * Math.PI) / 2);
  put('steel', new THREE.CylinderGeometry(sleeve, sleeve, THICKEST * R, SIDES, 1, true).rotateZ(Math.PI / 2), new THREE.Matrix4().setPosition(face - (out * THICKEST * R) / 2, y, branch.z));
  put('steel', new THREE.RingGeometry(sleeve * 0.85, sleeve, SIDES).applyMatrix4(toWall), new THREE.Matrix4().setPosition(face, y, branch.z));
  put('seal', new THREE.RingGeometry(BRANCH.r, sleeve * 0.85, SIDES).applyMatrix4(toWall), new THREE.Matrix4().setPosition(face - out * 0.002, y, branch.z));

  const group = new THREE.Group();
  for (const [name, list] of Object.entries(parts)) {
    if (!list.length) continue;
    const mesh = new THREE.Mesh(merge(list), MAT[name]);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
