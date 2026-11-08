import * as THREE from 'three';
import { generator } from './random.js';
import { tiles, soften, merge } from './surface.js';
import { R, COURSE, PLINTH, THICKEST } from './house.js';
import { TRIM_WIDTH, TRIM_ABOVE } from './window.js';

// Газовая линия по каталогу ChatGPT «Газовая линия и ввод в дом» (2026-11-08, по видео Никиты).
// Улица: жёлтая труба на тёмных круглых стойках, в открытом седле, выше забора (Никита: 2,5–3 м), пролёт до SPAN.
// Над воротами она поднимается рыжей П-образной аркой — снизу плавные колена, наверху крутые, — стояки держат
// высокие стойки вплотную к ним. От тройника
// тонкий отвод на той же высоте идёт над забором к углу дома у улицы — к ближней стене, ради экономии (Никита), —
// за углом поворачивает к боку без двери и дальше крепится к дому: по стене над наличниками на кронштейнах до ближнего
// глухого места, там опускается (на спуске кран) и коленом уходит в бревно сквозь стальной футляр, зазор в нём заделан
// тёмным. Стойки во дворе — только если дом далеко от забора.
// Под каждой стойкой — пятно цемента (Никита: «первоначальная отмостка плюс-минус цемент»).
//
// Картинки — развёртки ChatGPT (tools/gas.py → gas-*.jpg): длина × окружность, у каждого набора общие края,
// поэтому по трубе они лежат вперемешку, каждая на свои TILE метров (у тонкой трубы и стоек — короче во столько раз,
// во сколько они тоньше). Жёлтая — вперемешку со сварными стыками; у арки, где краска переходит в окись, —
// по картинке перехода.
const MAIN = { r: 0.0475, axis: 2.7 };        // м: улица — Ø 95 мм, ось над землёй
const BRANCH = { r: 0.017, off: 0.24, out: 0.9 }; // м: отвод — Ø 34 мм; его ось у стены и во дворе — от оси бока
const POST = { r: 0.03, branch: 0.02 };       // м: стойки улицы и отвода
const SPAN = 4, BRANCH_SPAN = 4.5;            // м: самый длинный пролёт
const ARCH = { w: 4.2, h: 5, low: 0.4, high: 0.16 }; // просвет между стояками и до низа перемычки; радиусы колен
const ELBOW = 0.06;                           // м: колено отвода
const HOLD = 1.5;                             // м: кронштейны по стене не реже
const STREET = 1;                             // м: от забора к улице до оси трубы
const REACH = 45;                             // м: улица по обе стороны от середины двора
const CLEAR = 0.08, ROOM = 0.15;              // м: от наличника и выпусков пятой стены до трубы; ширина спуска с краном
const ENTRY = 1.9;                            // м над землёй: ввод в стену — примерно здесь, по оси бревна
const TILE = 1.2;                             // м трубы Ø 95 мм на одну развёртку
const FOOTING = 0.5;                          // м: сторона картинки цемента
const SIDES = 16;

const strips = (file, rows) => soften(new THREE.MeshLambertMaterial({ map: tiles([`assets/textures/${file}`])[0] }),
  { contrast: 1, saturation: 1, scales: [0.3, 1], low: [1, 1, 1], high: [1, 1, 1], cells: [1, rows] });
const paint = (hex, extra) => new THREE.MeshLambertMaterial({ color: hex, ...extra });
const MAT = {
  yellow: strips('gas-yellow.jpg', 11), turn: strips('gas-turn.jpg', 2), oxide: strips('gas-oxide.jpg', 6), post: strips('gas-post.jpg', 4),
  footing: new THREE.MeshLambertMaterial({ map: tiles(['assets/textures/gas-footing.webp'])[0], transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
  steel: paint(0x8b908b, { side: THREE.DoubleSide }), brass: paint(0x95815c), handle: paint(0x40453e), seal: paint(0x55534c),
};
const FEET = 5; // картинок цемента в ряд

// Путь трубы — ломаная, в углах колена радиуса bend(i): точки оси с касательной t и длиной s от начала.
function route(points, bend) {
  points = points.filter((p, i) => !i || p.distanceTo(points[i - 1]) > 1e-6);
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
// пятой стены, где подъём не заденет наличники. Всё — в метрах двора: дом стоит в at фасадом к улице (+z),
// fence — где забор со стороны улицы (z), gate — середина ворот (x).
export function planGas(plan, at, { fence, gate }) {
  const door = plan.openings.find((o) => o.kind === 'door').wall;
  const wall = door === 'left' ? 'right' : 'left', out = wall === 'right' ? 1 : -1;
  const edge = plan.d / 2 - 0.5;
  const blocked = plan.openings.filter((o) => o.wall === wall).map((o) => [o.at - TRIM_WIDTH / 2 - CLEAR, o.at + TRIM_WIDTH / 2 + CLEAR]);
  if (plan.middle !== null) blocked.push([plan.middle - R - CLEAR, plan.middle + R + CLEAR]);
  blocked.sort((a, b) => a[0] - b[0]);
  // Свободные отрезки вдоль бока, z — от середины дома; берём ближний к улице, куда помещается спуск с краном.
  const free = [];
  let from = -edge;
  for (const [a, b] of blocked) {
    if (a > from) free.push([from, Math.min(a, edge)]);
    from = Math.max(from, b);
  }
  if (from < edge) free.push([from, edge]);
  // У пятистенка — перед пятой стеной: по стене за неё не пройти, мешают её выпуски.
  const [a, b] = free.filter(([a, b]) => b - a >= ROOM && (plan.middle === null || a > plan.middle)).at(-1);
  // По стене отвод идёт над наличниками бока, но не ниже улицы.
  const tops = plan.openings.filter((o) => o.wall === wall && o.kind === 'window').map((o) => PLINTH + o.top + TRIM_ABOVE + 0.12);
  // Ввод — по оси бревна бока (боковые стены лежат на цоколе), ближайшего к высоте ENTRY.
  const k = Math.round((ENTRY - PLINTH - R) / COURSE);
  const wallX = at.x + (out * plan.w) / 2;
  return {
    seed: plan.seed, street: fence + STREET, gate,
    branch: {
      x: wallX + out * BRANCH.out, wallX, out, y: PLINTH + R + k * COURSE, run: Math.max(MAIN.axis, ...tops),
      // К стене — сразу за остатками брёвен фасада на углу; ввод — у переднего края глухого места.
      corner: at.z + plan.d / 2 - THICKEST * R - 0.1, z: at.z + Math.max((a + b) / 2, b - 0.25),
    },
  };
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
  // Стойка: круглая труба от цемента до седла — гнутой полосы, что подхватывает трубу снизу.
  const stand = (x, zz, pipe, post, along) => {
    const seat = H - pipe - 0.005;
    put('post', tube(line(V(x, -0.05, zz), V(x, seat, zz)), post, set()));
    // Седло — часть трубки на 200° вокруг низа, ось вдоль трубы.
    put('steel', new THREE.CylinderGeometry(pipe + 0.005, pipe + 0.005, 0.07, 12, 1, true, THREE.MathUtils.degToRad(170), THREE.MathUtils.degToRad(200))
      .rotateZ(Math.PI / 2).rotateY(along === 'z' ? Math.PI / 2 : 0), new THREE.Matrix4().setPosition(x, H, zz));
    feet(x, zz);
  };
  // Стойки улицы — от арки наружу, у самых колен и дальше через SPAN; у тройника стойку отодвигаем.
  const posts = [];
  for (let x = a1 + 0.5; x < REACH; x += SPAN) posts.push(x);
  for (let x = a0 - 0.5; x > -REACH; x -= SPAN) posts.push(x);
  for (const x of posts) stand(Math.abs(x - branch.x) < 0.3 ? branch.x + Math.sign(x - branch.x || 1) * 0.3 : x, z, MAIN.r, POST.r, 'x');
  // Стояки арки держат свои высокие стойки (видео Никиты): тёмная труба от земли вплотную к стояку со стороны улицы
  // почти до верхнего колена, прихвачена к нему накладками.
  const beside = MAIN.r + POST.r + 0.015, tall = top - ARCH.high;
  for (const x of [left, right]) {
    put('post', tube(line(V(x, -0.05, z + beside), V(x, tall, z + beside)), POST.r, set()));
    for (const h of [H + 0.5 * (tall - H), tall - 0.12]) put('steel', new THREE.BoxGeometry(0.04, 0.03, beside), new THREE.Matrix4().setPosition(x, h, z + beside / 2));
    feet(x, z + beside);
  }

  // Тройник на улице и отвод: над забором во двор, за углом к боку дома, по стене, вниз и в стену.
  const { x, wallX, out, y, run, corner } = branch;
  put('yellow', tube(line(V(x - 0.11, H, z), V(x + 0.11, H, z)), MAIN.r * 1.15, set()));
  const near = wallX + out * BRANCH.off;
  put('yellow', tube(route([V(x, H, z), V(x, H, corner), V(near, H, corner), V(near, run, corner), V(near, run, branch.z),
    V(near, y, branch.z), V(wallX, y, branch.z)], () => ELBOW), BRANCH.r, set()));
  // Стойки отвода во дворе — поровну, только если пролёт от тройника до угла дома длиннее BRANCH_SPAN.
  const span = z - corner, count = Math.ceil(span / BRANCH_SPAN);
  for (let i = 1; i < count; i++) stand(x, z - (span * i) / count, BRANCH.r, POST.branch, 'z');

  // Кронштейн: пятка на бревне, вынос до трубы, хомут вокруг неё — на стене (по z) или на спуске (вверх).
  const heel = wallX + out * (THICKEST * R + 0.006), arm = BRANCH.off - THICKEST * R - BRANCH.r;
  const bracket = (h, zz, up) => {
    put('steel', new THREE.BoxGeometry(0.012, 0.1, 0.05), new THREE.Matrix4().setPosition(heel, h, zz));
    put('steel', new THREE.BoxGeometry(arm, 0.02, 0.01), new THREE.Matrix4().setPosition(heel + (out * arm) / 2, h, zz));
    const clamp = new THREE.TorusGeometry(BRANCH.r + 0.004, 0.004, 6, SIDES);
    put('steel', up ? clamp.rotateX(Math.PI / 2) : clamp, new THREE.Matrix4().setPosition(near, h, zz));
  };
  const along = corner - branch.z, holds = Math.ceil(along / HOLD);
  for (let i = 0; i <= holds; i++) bracket(run, corner - 0.15 - ((along - 0.3) * i) / holds, false);
  // Кран на спуске: корпус с гранями на концах, шток наружу и рукоятка вдоль трубы — кран открыт.
  const valve = y + 0.35 * (run - y);
  put('brass', new THREE.CylinderGeometry(BRANCH.r * 1.8, BRANCH.r * 1.8, 0.05, SIDES), new THREE.Matrix4().setPosition(near, valve, branch.z));
  for (const dy of [-0.035, 0.035]) put('brass', new THREE.CylinderGeometry(BRANCH.r * 1.5, BRANCH.r * 1.5, 0.022, 6), new THREE.Matrix4().setPosition(near, valve + dy, branch.z));
  put('brass', new THREE.CylinderGeometry(0.006, 0.006, 0.04, 8).rotateZ(Math.PI / 2), new THREE.Matrix4().setPosition(near + out * 0.045, valve, branch.z));
  put('handle', new THREE.BoxGeometry(0.012, 0.11, 0.022), new THREE.Matrix4().setPosition(near + out * 0.068, valve + 0.04, branch.z));
  // И кронштейн на спуске над краном — по оси венца.
  bracket(PLINTH + R + Math.round((valve + 0.3 - PLINTH - R) / COURSE) * COURSE, branch.z, true);
  // Ввод: стальной футляр из стены (бревно бывает и тоньше — тогда футляр торчит чуть больше), в нём тёмная заделка.
  const sleeve = BRANCH.r * 1.8, face = wallX + out * (THICKEST * R + 0.005), toWall = new THREE.Matrix4().makeRotationY((out * Math.PI) / 2);
  put('steel', new THREE.CylinderGeometry(sleeve, sleeve, THICKEST * R, SIDES, 1, true).rotateZ(Math.PI / 2), new THREE.Matrix4().setPosition(face - (out * THICKEST * R) / 2, y, branch.z));
  put('steel', new THREE.RingGeometry(sleeve * 0.85, sleeve, SIDES).applyMatrix4(toWall), new THREE.Matrix4().setPosition(face, y, branch.z));
  put('seal', new THREE.RingGeometry(BRANCH.r, sleeve * 0.85, SIDES).applyMatrix4(toWall), new THREE.Matrix4().setPosition(face - out * 0.002, y, branch.z));

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
