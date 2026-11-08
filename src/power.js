import * as THREE from 'three';
import { generator } from './random.js';
import { merge } from './surface.js';
import { route, curve, sag, resample, tube, twist } from './pipe.js';
import { R, COURSE, PLINTH, THICKEST, OVERHANG, blind } from './house.js';

// Уличная электрика по каталогу ChatGPT «Двор: электричество» (2026-11-08, по видео и фото Никиты).
// Вдоль улицы — опоры старой линии: бетонные, пропитанные деревянные и деревянные на бетонной приставке.
// На крюках разной высоты — фарфоровые изоляторы, по ним четыре голых провода с провисом. С ближней к дому опоры —
// отдельный анкер ниже проводов, хвост жгута поднимается по опоре к двум проводам дворовой стороны.
// К дому — чёрный жгут СИП (две скрученные жилы) с провисом до анкера на глухом месте бока без двери, под свесом.
// От анкера хвост делает петлю и снизу входит в чёрную гофру; гофра на клипсах спускается мимо щита учёта,
// петлёй-«U» уходит под него и снизу входит в сальник. Щит — светло-серый ящик с дверцей, окошком и круглым замком.
//
// Всё объёмное — кодом. Картинки придут от ChatGPT: развёртки опор 2,8 м × 0,7 м обхвата (низ опоры — своя, с землёй
// у левого края; у дерева на приставке — своя, с пропилом), дверцы и бока щита, земля у основания опоры, номера,
// знаки. Пока на их местах — цвета из палитры каталога; развёртки уже лягут по uv.
const POLE = {
  top: 7.6,           // м видимой высоты
  street: 2.2,        // м от забора к улице — дальше газовой трубы
  span: [26, 32],     // м между опорами
  reach: 60,          // м улицы по обе стороны от середины двора
  strip: 2.8,         // м опоры на одну развёртку
  odds: { concrete: 5, wood: 3, spur: 3 },
};
const WOOD = [0.13, 0.09], CONCRETE = [0.15, 0.1];              // м: радиус у земли и наверху
const SPUR = { r: [0.113, 0.095], top: 2.4, from: 0.8, bands: [1.25, 2.15] }; // приставка: до угла сечения; низ бревна; бандажи
// Крюки: сторона (+1 — к улице) и сколько вниз от верха опоры. Все провода на разной высоте, как на видео.
const HOOKS = [{ side: 1, drop: 0.25 }, { side: -1, drop: 0.6 }, { side: 1, drop: 0.95 }, { side: -1, drop: 1.3 }];
const HOOK = { r: 0.009, out: 0.13, up: 0.08 };
const WIRE = { r: 0.0045, sag: [0.45, 0.85] };
const SIP = { r: 0.0042, pitch: 0.4, sag: [0.4, 0.7] };        // жила, шаг скрутки, провис отвода
// Анкер на доме — на оси 10-го венца бока (2,57 м): ниже свеса у самых низких срубов (2,83 м). Его пролёт уходит
// от стены не круче 45° — вбок от выступающего вперёд по стене (наличники, остатки брёвен пятой стены и углов).
const ANCHOR = { y: PLINTH + R + 9 * COURSE, room: OVERHANG + THICKEST * R + 0.15 };
const BOX = { w: 0.32, h: 0.46, d: 0.14, y: 1.5 };              // щит: ширина, высота, глубина, середина над землёй
const CONDUIT = { r: 0.013, rib: 0.008, side: 0.05, loop: [0.35, 0.45], clips: 0.4 }; // гофра; от щита сбоку; петля — доля высоты щита
const ROOM = BOX.w / 2 + CONDUIT.side + 2 * CONDUIT.r;         // м от середины щита до края гофры
const GAS = 0.25;                                              // м от ввода газа до края щита и гофры
const KEEP = 0.8;                                              // м от калитки и ворот до опоры

const paint = (hex, more = {}) => new THREE.MeshLambertMaterial({ color: hex, ...more });
const MAT = {
  concrete: paint(0xaba99e, { flatShading: true }), concreteButt: paint(0x97958a, { flatShading: true }),
  wood: paint(0x5c5244), woodButt: paint(0x4b4338), woodEnd: paint(0x6d604e), base: paint(0x76786b, { transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
  steel: paint(0x51595d), porcelain: paint(0xdfd9c9), wire: paint(0x303a41), sip: paint(0x20272c), clamp: paint(0x2b2f33),
  conduit: paint(0x1b1d1f), box: paint(0xd0d2c7), door: paint(0xd0d2c7), rim: paint(0x818d91), glass: paint(0x171f27), lock: paint(0x929b9e),
};

// Где что: место щита и анкера на боку с газовым вводом (gas — planGas), опоры вдоль улицы. Всё в метрах двора:
// fence — забор со стороны улицы (z), keep — калитка и ворота { at, width } (x), перед ними опор нет.
export function planPower(plan, at, gas, { fence, keep }) {
  const rnd = generator(plan.seed + 29);
  const { wallX, out } = gas.branch, wall = out > 0 ? 'right' : 'left', g = gas.branch.z - at.z;
  // Щит — в глухом месте бока, не ближе GAS к вводу газа. Гофра — слева от щита, если смотреть на него
  // (как в каталоге), анкер — над ней. Отвод уходит от анкера к улице: до того, что выступает впереди по стене
  // (конца глухого места — ahead), от анкера должно быть не меньше ANCHOR.room. Газ не мешает: он ниже анкера.
  // Берём ближнее к улице место, где это выходит, а если нигде — то, где щит можно отодвинуть от выступа дальше всего.
  const shift = out * (BOX.w / 2 + CONDUIT.side);
  const spots = blind(plan, wall, 0.08).flatMap(([a, b]) => (a < g && g < b ? [[a, g - GAS], [g + GAS, b]] : [[a, b]])
    .map(([lo, hi]) => ({ lo: lo + ROOM, hi: Math.min(hi - ROOM, b - ANCHOR.room - shift), last: hi - ROOM, ahead: b })))
    .filter(({ lo, last }) => lo <= last);
  const roomy = spots.filter(({ lo, hi }) => lo <= hi).at(-1);
  const spot = roomy ?? spots.reduce((x, y) => (y.ahead - y.lo > x.ahead - x.lo ? y : x));
  const box = roomy ? spot.lo + rnd() * (spot.hi - spot.lo) : spot.lo, ahead = spot.ahead;
  const conduit = box + shift;
  const anchor = new THREE.Vector3(wallX, ANCHOR.y, at.z + conduit);
  // Опора с отводом — на улице сбоку от дома: пролёт уходит от стены под углом, при котором он минует всё,
  // что выступает впереди по стене (до него ahead − conduit).
  const z = fence + POLE.street, deep = z - anchor.z;
  const side = deep * Math.max(1 + 0.4 * rnd(), ANCHOR.room / (ahead - conduit));
  const xs = [wallX + out * side];
  const span = () => POLE.span[0] + rnd() * (POLE.span[1] - POLE.span[0]);
  while (xs.at(-1) < POLE.reach) xs.push(xs.at(-1) + span());
  while (xs[0] > -POLE.reach) xs.unshift(xs[0] - span());
  const feeder = xs.indexOf(wallX + out * side);
  // Опору, что встала перед калиткой или воротами, отодвигаем за ближний край.
  const lo = Math.min(...keep.map((k) => k.at - k.width / 2)) - KEEP, hi = Math.max(...keep.map((k) => k.at + k.width / 2)) + KEEP;
  const kinds = Object.keys(POLE.odds), weights = Object.values(POLE.odds), total = weights.reduce((s, w) => s + w);
  const poles = xs.map((x) => {
    if (x > lo && x < hi) x = x - lo < hi - x ? lo : hi;
    let u = rnd() * total;
    const kind = kinds[weights.findIndex((w) => (u -= w) < 0)];
    const lean = THREE.MathUtils.degToRad(kind === 'concrete' ? 0.6 : 1.8);
    return { x, z: z + (rnd() - 0.5) * 0.3, kind, lean: [(rnd() - 0.5) * lean, (rnd() - 0.5) * lean], crook: [(rnd() - 0.5) * 0.08, (rnd() - 0.5) * 0.08] };
  });
  return { seed: plan.seed, poles, feeder, house: { anchor, out, box: at.z + box, conduit: at.z + conduit } };
}

export function buildPower({ seed, poles, feeder, house }) {
  const rnd = generator(seed + 31);
  const set = () => Math.floor(rnd() * 1000);
  const parts = Object.fromEntries(Object.keys(MAT).map((name) => [name, []]));
  const put = (name, geometry, matrix) => parts[name].push(matrix ? geometry.applyMatrix4(matrix) : geometry);
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const UP = V(0, 1, 0);
  const smooth = (points, n = 24) => curve(new THREE.CatmullRomCurve3(points, false, 'centripetal').getPoints(n));
  // Жгут: две скрученные жилы вдоль пути.
  const bundle = (path) => twist(path, 2, SIP.r, SIP.pitch).forEach((p) => put('sip', tube(p, SIP.r, { sides: 6 })));

  // Анкерный зажим: дужка вокруг ушка eye, клиновой корпус от неё в сторону пролёта dir.
  // near — откуда выходит хвост жгута, far — откуда начинается пролёт.
  const clamp = (eye, dir) => {
    const across = dir.clone().cross(UP).normalize(), near = eye.clone().addScaledVector(dir, 0.07);
    put('steel', tube(route([near.clone().addScaledVector(across, 0.014), eye.clone().addScaledVector(across, 0.01), eye.clone().addScaledVector(dir, -0.012),
      eye.clone().addScaledVector(across, -0.01), near.clone().addScaledVector(across, -0.014)], () => 0.006), 0.0025, { sides: 6 }));
    const body = [[0.004, 0], [0.015, 0], [0.018, 0.02], [0.016, 0.1], [0.011, 0.13], [0.004, 0.13]];
    put('clamp', new THREE.LatheGeometry(body.map(([r, y]) => new THREE.Vector2(r, y)), 10),
      new THREE.Matrix4().compose(near, new THREE.Quaternion().setFromUnitVectors(UP, dir), new THREE.Vector3(1, 1, 1)));
    return { near, far: near.clone().addScaledVector(dir, 0.13) };
  };

  // Опоры. Каждая строится стоя в нуле так, чтобы улица была +x: у отвесной трубки шов развёртки на +x — он уходит
  // к улице, со двора не виден. Потом опора поворачивается улицей к +z, наклоняется и встаёт на место.
  // Возвращает, где на ней провода (по порядку HOOKS) и как найти её ось и радиус на высоте y.
  const pole = ({ x, z, kind, lean, crook }) => {
    const top = POLE.top, [r0, r1] = kind === 'concrete' ? CONCRETE : WOOD;
    const radius = (y) => r0 + ((r1 - r0) * y) / top;
    const bend = 5.2; // выше этого места ось кривого бревна идёт прямо к верху
    const axis = (y) => (kind === 'concrete' || y < 2.8 ? V(0, y, 0)
      : y < bend ? V(crook[0], 0, crook[1]).multiplyScalar((y - 2.8) / (bend - 2.8)).setY(y)
        : V(crook[0], 0, crook[1]).multiplyScalar((top - y) / (top - bend)).setY(y));
    const M = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(lean[0], 0, lean[1])).setPosition(x, 0, z)
      .multiply(new THREE.Matrix4().makeRotationY(-Math.PI / 2));
    const sides = kind === 'concrete' ? 8 : 12;
    const piece = (name, from, to, points) => put(name, tube(route(points ?? [axis(from), axis(to)], () => 8), (s) => radius(from + s), { set: set(), tile: POLE.strip, sides }), M);
    const lower = kind === 'spur' ? SPUR.from : 0;
    const body = kind === 'concrete' ? [axis(2.8), axis(top)] : [axis(2.8), axis(bend), axis(top)];
    piece(kind === 'concrete' ? 'concreteButt' : kind === 'spur' ? 'woodEnd' : 'woodButt', lower, 2.8 + lower,
      kind === 'spur' ? [axis(lower), axis(2.8 + lower)] : undefined);
    if (kind === 'spur') piece('wood', 2.8 + lower, top, [axis(2.8 + lower), axis(bend), axis(top)]);
    else piece(kind === 'concrete' ? 'concrete' : 'wood', 2.8, top, body);
    const cap = (name, y, flip) => put(name, new THREE.CircleGeometry(radius(y), sides).rotateX(flip ? Math.PI / 2 : -Math.PI / 2).translate(...axis(y).toArray()), M);
    cap(kind === 'concrete' ? 'concrete' : 'wood', top);
    if (kind === 'spur') {
      // Приставка — короткая бетонная стойка рядом с бревном вдоль улицы (−z здесь); бревно над землёй на SPUR.from,
      // к приставке примотано двумя бандажами по три витка.
      cap('woodEnd', lower, true);
      const at = radius(1.5) + SPUR.r[0] / Math.SQRT2 + 0.005;
      put('concreteButt', tube(curve([V(0, -0.05, 0), V(0, SPUR.top, 0)]), (s) => SPUR.r[0] + ((SPUR.r[1] - SPUR.r[0]) * s) / SPUR.top, { set: set(), tile: POLE.strip, sides: 4 })
        .rotateY(Math.PI / 4).translate(0, 0, at), M);
      put('concrete', new THREE.CircleGeometry(SPUR.r[1], 4).rotateX(-Math.PI / 2).rotateY(Math.PI / 4).translate(0, SPUR.top, at), M);
      for (const h of SPUR.bands) for (let k = 0; k < 3; k++) {
        const y = h + k * 0.015, points = [];
        for (let i = 0; i < 24; i++) {
          const a = (i / 24) * Math.PI * 2;
          points.push(new THREE.Vector2(Math.cos(a) * (radius(y) + 0.004), Math.sin(a) * (radius(y) + 0.004)));
        }
        const half = (SPUR.r[0] + ((SPUR.r[1] - SPUR.r[0]) * y) / SPUR.top) / Math.SQRT2 + 0.004;
        for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) points.push(new THREE.Vector2(dx * half, at + dz * half));
        const loop = hull(points).map((p) => V(p.x, y, p.y));
        put('steel', tube(curve([...loop, loop[0]]), 0.003, { sides: 5 }), M);
      }
    }
    // Земля у основания — будет картинкой; пока пятно.
    put('base', new THREE.CircleGeometry(0.5, 20).rotateX(-Math.PI / 2).translate(0, 0.006, kind === 'spur' ? radius(1.5) / 2 : 0), M);
    // Крюки с изоляторами: крюк из опоры в сторону side, загнут вверх; провод лежит в желобке на макушке изолятора.
    const wires = HOOKS.map(({ side, drop }) => {
      const y = top - drop, c = axis(y), r = radius(y);
      const tip = c.clone().add(V(side * (r + HOOK.out), HOOK.up, 0));
      put('steel', tube(route([c.clone().add(V(side * (r - 0.03), 0, 0)), c.clone().add(V(side * (r + HOOK.out), 0, 0)), tip], () => 0.03), HOOK.r, { sides: 8 }), M);
      put('porcelain', new THREE.LatheGeometry(INSULATOR.map(([a, b]) => new THREE.Vector2(a, b)), 14).translate(...tip.clone().add(V(0, -0.02, 0)).toArray()), M);
      return tip.clone().add(V(0, -0.02 + INSULATOR.at(-1)[1] - 0.002, 0)).applyMatrix4(M);
    });
    return { wires, M, axis, radius, top };
  };
  const built = poles.map(pole);

  // Провода — от изолятора к изолятору, у пролёта свой провис, у каждого провода чуть свой.
  const spans = [];
  for (let i = 1; i < built.length; i++) {
    const depth = WIRE.sag[0] + rnd() * (WIRE.sag[1] - WIRE.sag[0]);
    spans.push(HOOKS.map((_, j) => {
      const a = built[i - 1].wires[j], b = built[i].wires[j], d = depth * (0.9 + 0.2 * rnd());
      put('wire', tube(sag(a, b, d, 40), WIRE.r, { sides: 5 }));
      return (t) => a.clone().lerp(b, t).setY(a.y + (b.y - a.y) * t - 4 * d * t * (1 - t));
    }));
  }

  // Отвод: с анкера опоры (ниже проводов, на стороне к дому) жгутом с провисом к анкеру дома.
  const { M, axis, radius, top } = built[feeder];
  const local = (v) => v.clone().applyMatrix4(M.clone().invert());
  const world = (v) => v.clone().applyMatrix4(M);
  const { anchor, out } = house;
  const face = anchor.x + out * THICKEST * R;
  const houseEye = V(face + out * 0.05, anchor.y, anchor.z);
  const yb = top - HOOKS.at(-1).drop - 0.8, cb = axis(yb), rb = radius(yb);
  const toHouse = local(houseEye).sub(cb).setY(0).normalize();
  // Кронштейн: два хомута вокруг опоры, пластина, ушко.
  for (const dy of [-0.07, 0.07]) put('steel', new THREE.CylinderGeometry(rb + 0.003, rb + 0.003, 0.02, 16, 1, true).translate(cb.x, yb + dy, cb.z), M);
  const plate = new THREE.Matrix4().compose(cb.clone().addScaledVector(toHouse, rb + 0.004), new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), toHouse), new THREE.Vector3(1, 1, 1));
  put('steel', new THREE.BoxGeometry(0.05, 0.18, 0.008), plate.clone().premultiply(M));
  put('steel', new THREE.BoxGeometry(0.012, 0.012, 0.04).translate(0, 0, 0.02), plate.clone().premultiply(M));
  const poleEye = world(cb.clone().addScaledVector(toHouse, rb + 0.05));
  const fromPole = clamp(poleEye, houseEye.clone().sub(poleEye).normalize());
  const toPole = clamp(houseEye, poleEye.clone().sub(houseEye).normalize());
  const rise = fromPole.far.y - toPole.far.y;
  bundle(sag(toPole.far, fromPole.far, Math.min(SIP.sag[0] + rnd() * (SIP.sag[1] - SIP.sag[0]), 0.2 * rise), 64));

  // Хвост на опоре: петлёй вниз, к опоре и вверх по ней (сбоку от кронштейна) к двум проводам дворовой стороны;
  // там жилы расходятся и прокалывающими зажимами садятся на провода в полуметре от изоляторов к дому.
  const around = toHouse.clone().applyAxisAngle(UP, 0.6);
  const onPole = (y, gap = 0.014) => world(axis(y).addScaledVector(around, radius(y) + gap));
  const [upper, lower] = [1, 3], ya = top - HOOKS[lower].drop - 0.3, yb2 = top - HOOKS[upper].drop - 0.3;
  bundle(smooth([fromPole.near, fromPole.near.clone().add(V(0, -0.14, 0)).lerp(onPole(yb), 0.4), onPole(yb - 0.1), onPole(yb + 0.25), onPole(ya)], 40));
  const toward = Math.sign(house.anchor.x - poles[feeder].x);
  const span = spans[toward > 0 ? feeder : feeder - 1];
  const tap = (j, from) => {
    const length = Math.abs(poles[feeder + toward].x - poles[feeder].x), t = 0.5 / length;
    const w = span[j](toward > 0 ? t : 1 - t);
    put('sip', tube(smooth([from, from.clone().add(V(0, 0.15, 0)), w.clone().add(V(0, -0.08, 0)), w]), SIP.r * 1.1, { sides: 6 }));
    put('clamp', new THREE.BoxGeometry(0.05, 0.05, 0.035).translate(w.x, w.y - 0.012, w.z));
  };
  tap(lower, onPole(ya));
  put('sip', tube(curve([onPole(ya, 0.02), onPole(yb2, 0.02)]), SIP.r * 1.1, { sides: 6 }));
  tap(upper, onPole(yb2, 0.02));
  const band = (yb + ya) / 2 + 0.05;
  put('steel', new THREE.CylinderGeometry(radius(band) + 0.03, radius(band) + 0.03, 0.015, 16, 1, true).translate(...axis(band).toArray()), M);

  // Дом: пятка на бревне (утоплена в него — брёвна разной толщины), ушко.
  const heel = new THREE.Matrix4().makeRotationY((out * Math.PI) / 2).setPosition(face - out * 0.012, anchor.y, anchor.z);
  put('steel', new THREE.BoxGeometry(0.05, 0.1, 0.036), heel);
  put('steel', new THREE.BoxGeometry(0.012, 0.012, 0.05).translate(0, 0, 0.03), heel);
  put('steel', new THREE.TorusGeometry(0.012, 0.0035, 6, 14), new THREE.Matrix4().setPosition(houseEye.x - out * 0.012, anchor.y, anchor.z));

  // Гофра: сверху «гусак» открытым концом вниз (хвост жгута входит в него снизу, вода не затекает), вниз по стене
  // на клипсах мимо щита, под щитом петлёй и снизу в сальник.
  const cx = face + out * (CONDUIT.r + 0.012), z = house.conduit, high = anchor.y - 0.32;
  const bottom = BOX.y - BOX.h / 2, low = bottom - BOX.h * (CONDUIT.loop[0] + rnd() * (CONDUIT.loop[1] - CONDUIT.loop[0]));
  const gland = house.box + out * (BOX.w / 2 - 0.06), hood = cx + out * 0.1;
  const path = route([V(hood, high - 0.06, z), V(hood, high + 0.04, z), V(cx, high + 0.04, z), V(cx, low, z), V(cx, low, gland), V(cx, bottom - 0.012, gland)],
    (i) => (i < 3 ? 0.04 : Math.abs(z - gland) / 2 - 0.002));
  put('conduit', tube(resample(path, CONDUIT.rib / 4), (s) => CONDUIT.r * (1 - 0.09 * (0.5 + 0.5 * Math.cos((2 * Math.PI * s) / CONDUIT.rib))), { sides: 10 }));
  bundle(smooth([toPole.near, toPole.near.clone().add(V(0, -0.1, 0)), V(hood, high - 0.24, z + Math.sign(toPole.near.z - z) * 0.03), V(hood, high - 0.16, z), V(hood, high - 0.07, z)], 30));
  // Клипсы: полукольцо вокруг гофры и ножка к стене.
  const clip = new THREE.Shape().absarc(0, 0, CONDUIT.r + 0.003, -Math.PI * 0.6, Math.PI * 0.6, false).absarc(0, 0, CONDUIT.r + 0.0005, Math.PI * 0.6, -Math.PI * 0.6, true);
  for (let y = high - 0.1; y > low + 0.12; y -= CONDUIT.clips) {
    const m = new THREE.Matrix4().makeRotationY(out > 0 ? 0 : Math.PI).setPosition(cx, y, z);
    put('clamp', new THREE.ExtrudeGeometry(clip, { depth: 0.012, bevelEnabled: false, curveSegments: 6 }).rotateX(-Math.PI / 2), m);
    put('clamp', new THREE.BoxGeometry(CONDUIT.r + 0.024, 0.012, 0.022).translate(-(CONDUIT.r + 0.012), 0.006, 0), m);
  }
  put('clamp', new THREE.CylinderGeometry(0.017, 0.019, 0.022, 12), new THREE.Matrix4().setPosition(cx, bottom - 0.008, gland));

  // Щит: корпус, верхняя кромка, дверца на тонком шве, окошко в ободке, круглый замок. Строим стоя дверцей к +z,
  // вдоль стены — x (слева от смотрящего — −x), и поворачиваем дверцей от стены.
  const B = new THREE.Matrix4().makeRotationY((out * Math.PI) / 2).setPosition(face, BOX.y, house.box);
  put('box', new THREE.BoxGeometry(BOX.w, BOX.h, BOX.d).translate(0, 0, BOX.d / 2), B);
  put('box', new THREE.BoxGeometry(BOX.w + 0.016, 0.012, BOX.d + 0.014).translate(0, BOX.h / 2 + 0.004, BOX.d / 2 + 0.002), B);
  const door = { w: BOX.w - 0.012, h: BOX.h - 0.014 };
  put('door', new THREE.BoxGeometry(door.w, door.h, 0.004).translate(0, -0.002, BOX.d + 0.003), B);
  const spot = (u, v) => [-door.w / 2 + u * door.w, door.h / 2 - v * door.h - 0.002];
  const [wx, wy] = spot(0.42, 0.23), ww = 0.28 * door.w, wh = 0.17 * door.h;
  const pane = (inset) => rounded(ww - 2 * inset, wh - 2 * inset, 0.012 - inset);
  const rim = pane(0);
  rim.holes.push(pane(0.006));
  put('rim', new THREE.ExtrudeGeometry(rim, { depth: 0.004, bevelEnabled: false, curveSegments: 4 }).translate(wx, wy, BOX.d + 0.005), B);
  put('glass', new THREE.ShapeGeometry(pane(0.005), 4).translate(wx, wy, BOX.d + 0.0055), B);
  const [lx, ly] = spot(0.16, 0.5);
  put('lock', new THREE.CylinderGeometry(0.011, 0.012, 0.008, 16).rotateX(Math.PI / 2).translate(lx, ly, BOX.d + 0.009), B);
  put('glass', new THREE.CircleGeometry(0.0035, 8).translate(lx, ly, BOX.d + 0.0131), B);

  const group = new THREE.Group();
  for (const [name, list] of Object.entries(parts)) {
    if (!list.length) continue;
    const mesh = new THREE.Mesh(merge(list), MAT[name]);
    mesh.castShadow = name !== 'base';
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

// Изолятор: профиль тела вращения (радиус, высота) — юбка, шейка под вязку, головка с желобком под провод.
const INSULATOR = [[0.008, 0], [0.024, 0], [0.036, 0.012], [0.036, 0.02], [0.026, 0.03], [0.023, 0.045], [0.03, 0.055], [0.03, 0.062],
  [0.022, 0.07], [0.024, 0.08], [0.016, 0.09], [0.006, 0.088]];

// Прямоугольник со скруглёнными углами вокруг нуля.
function rounded(w, h, r) {
  const s = new THREE.Shape(), x = w / 2, y = h / 2;
  s.moveTo(-x + r, -y).lineTo(x - r, -y).quadraticCurveTo(x, -y, x, -y + r).lineTo(x, y - r).quadraticCurveTo(x, y, x - r, y)
    .lineTo(-x + r, y).quadraticCurveTo(-x, y, -x, y - r).lineTo(-x, -y + r).quadraticCurveTo(-x, -y, -x + r, -y);
  return s;
}

// Выпуклая оболочка точек на плоскости — по ней бандаж обходит бревно и приставку.
function hull(points) {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (list) => list.reduce((h, q) => {
    while (h.length >= 2 && cross(h.at(-2), h.at(-1), q) <= 0) h.pop();
    h.push(q);
    return h;
  }, []);
  const lower = half(p), upper = half(p.reverse());
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}
