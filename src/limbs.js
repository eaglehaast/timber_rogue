import * as THREE from 'three';
import { barkGeometry, leafMesh, segments, section, pointAt, girth } from './maple.js';
import { TENSILE, COMPRESSIVE, SHEAR, E, SPLIT_MIN } from './physics.js';

// Ветка, которую можно отпилить: кусок скелета клёна (maple.js) — куски осей parts ({ axis, from, to,
// cutFrom, cutTo }, родитель раньше детей) и листья cards на них. Крона ствола, нижняя ветвь, отпиленный
// сук — всё это ветки. Ветка рисует себя (кора, торцы, листва), знает свой вес и форму для столкновений
// и делится пропилом надвое. Всё — в осях скелета: в них ветку и держит её группа group.
// Где ветку что-то давит (нагрузки loads — { axis, s, f, p }: сила f по линии через точку p), она знает,
// что тянет и гнёт каждое её сечение и где она сломается.
export const THIN = 0.01;  // м — радиус: ветку тоньше пальца не пилим
const TWIG = 0.005;        // м — радиус: тоньше в столкновениях не участвует
const RUN = 4;             // столько точек оси (шагов по 5 см) идёт в одну капсулу

export class Limb {
  // skin — материалы коры и торца, cloud — середина кроны (от неё смотрят нормали листвы),
  // zone — высота зоны пиления: ствол ниже неё — кубики, в весе и форме ветки его нет.
  constructor(parts, cards, { skin, cloud, zone }) {
    this.parts = parts;
    this.cards = cards;
    this.skin = skin;
    this.cloud = cloud;
    this.zone = zone;
    this.kerfs = [];
    this.meshes = [];
    this.group = new THREE.Group();
    this.group.userData.limb = this;
  }

  // Кора с торцами и листва — заново, по нынешним кускам; заодно форма для столкновений (shape), что за каждой
  // точкой осей (tails) и вес всей ветки (weight).
  dress() {
    for (const mesh of this.meshes) {
      mesh.geometry.dispose();
      mesh.removeFromParent();
    }
    this.meshes = [new THREE.Mesh(barkGeometry(this.parts), this.skin), leafMesh(this.cards, this.cloud)];
    for (const mesh of this.meshes) mesh.castShadow = mesh.receiveShadow = true;
    this.group.add(...this.meshes);
    this.shape = this.capsules();
    this.tails = this.tally();
    this.weight = this.weigh();
    return this;
  }

  // Что за каждой точкой каждой оси — дальше по ней и на всём, что растёт на ней дальше: масса и масса × центр
  // (tails). Дети идут в parts после родителя: с конца каждый ребёнок сосчитан раньше, чем его родитель.
  tally() {
    const tails = new Map(), cards = Map.groupBy(this.cards, (c) => c.axis), kids = Map.groupBy(this.parts, (p) => p.axis.parent);
    for (const part of [...this.parts].reverse()) {
      const a = part.axis, n = a.points.length, mass = new Float64Array(n), moment = new Float64Array(3 * n);
      const add = (i, m, x, y, z) => {
        mass[i] += m;
        moment[3 * i] += x;
        moment[3 * i + 1] += y;
        moment[3 * i + 2] += z;
      };
      segments(part, this.zone, (m, p, len, r, t, i) => add(i, m, m * p.x, m * p.y, m * p.z));
      for (const { s, mass: m, center: c } of cards.get(a) ?? []) add(index(a, s), m, m * c.x, m * c.y, m * c.z);
      for (const { axis: child } of kids.get(a) ?? []) {
        const tail = tails.get(child);
        add(index(a, child.attach), tail.mass[0], ...tail.moment.subarray(0, 3));
      }
      for (let i = n - 2; i >= 0; i--) add(i, mass[i + 1], ...moment.subarray(3 * i + 3, 3 * i + 6));
      tails.set(a, { mass, moment });
    }
    return tails;
  }

  // Масса того, что за точкой s оси a, и её центр.
  heft(a, s) {
    const tail = this.tails.get(a), i = Math.min(a.points.length - 1, Math.ceil(s / (a.len / (a.points.length - 1))));
    const mass = tail?.mass[i] ?? 0;
    return { mass, center: mass ? new THREE.Vector3(...tail.moment.subarray(3 * i, 3 * i + 3)).divideScalar(mass) : null };
  }

  // Что давит на то, что за сечением оси a в точке s: нагрузки loads и вес (g — ускорение свободного
  // падения в осях ветки). Отдаёт сечение q, силу F и её момент M вокруг середины сечения: сечение держит
  // то же обратно. Вдоль оси (F·t) больше нуля — его растягивает, меньше — сжимает.
  forces(a, s, loads, g) {
    const q = pointAt(a, s), past = beyond(a, s), F = new THREE.Vector3(), M = new THREE.Vector3();
    for (const l of loads) {
      if (!past(l.axis, l.s)) continue;
      F.add(l.f);
      M.add(_d.copy(l.p).sub(q.p).cross(l.f));
    }
    const { mass, center } = this.heft(a, s);
    if (mass) {
      F.addScaledVector(g, mass);
      M.add(center.sub(q.p).cross(_e.copy(g).multiplyScalar(mass)));
    }
    return { q, F, M };
  }

  // Комель оси a в этой ветке — откуда она растёт: ветвь — от коры родителя, ствол — от верха кубиков,
  // отпиленный кусок — от пропила.
  root(a) {
    const part = this.parts.find((p) => p.axis === a);
    return Math.max(part?.from ?? 0, a.stem !== undefined ? a.points.find((q) => q.p.y >= this.zone)?.s ?? a.len : section(a.parent, a.attach).r);
  }

  // Податливость ветки в точке s оси a, м/Н: на столько точка уходит под силой в ньютон поперёк оси, как конец
  // консоли от комля оси до s с сечением посередине: L³ / (3·E·I).
  yielding(a, s) {
    const base = this.root(a), L = s - base;
    return L > 0 ? L ** 3 / ((3 * E * Math.PI * section(a, (s + base) / 2).r ** 4) / 4) : 0;
  }

  // Где ветку ломает: самое нагруженное сечение на пути от каждой нагрузки к комлю ветки — { axis, s, ratio },
  // ratio — какую долю своей прочности сечение держит (strain).
  weakest(loads, g) {
    let worst = null;
    const seen = new Set();
    for (const l of loads) {
      for (let a = l.axis, s = l.s; a && this.parts.some((p) => p.axis === a); s = a.attach, a = a.parent) {
        const from = this.root(a);
        for (const q of a.points) {
          if (q.s > s || q.s < from || seen.has(q)) continue;
          seen.add(q);
          const { F, M } = this.forces(a, q.s, loads, g);
          const ratio = strain(F.dot(q.t), M.addScaledVector(q.t, -M.dot(q.t)).length(), q.r);
          if (!worst || ratio > worst.ratio) worst = { axis: a, s: q.s, ratio };
        }
      }
    }
    return worst;
  }

  // Вес, центр тяжести и момент инерции вокруг него (в осях ветки): древесина — цилиндрами по шагу оси,
  // листья — грузиками в серединах карточек.
  weigh() {
    const bits = [];
    for (const part of this.parts) {
      segments(part, this.zone, (m, p, len, r, t) => {
        // Свой момент цилиндра: вокруг оси — m·r²/2, поперёк — m·(3r² + L²)/12.
        const across = (m * (3 * r * r + len * len)) / 12, spin = (m * r * r) / 2, v = t.toArray();
        bits.push({ m, p, own: Array.from({ length: 9 }, (_, k) => (k % 4 === 0 ? across : 0) + (spin - across) * v[k % 3] * v[Math.floor(k / 3)]) });
      });
    }
    for (const card of this.cards) bits.push({ m: card.mass, p: card.center });
    return sum(bits);
  }

  // Форма для столкновений — капсулы по осям толще TWIG, по RUN точек: { a, b, r, axis, from, to, soft }.
  // soft — податливость концов капсулы (yielding): ветка не камень, под тем, что на неё давит, она гнётся.
  // Ветвь сидит в родителе, а у пропила кончается торцом: с этих концов капсулы поджаты на свой радиус,
  // чтобы куски по обе стороны пропила и ветвь с родителем не заходили друг в друга. Короткий толстый
  // кусок (чурка, на которую капсулы не хватает) — кольцами шаров толщиной в сам кусок.
  capsules() {
    const out = [];
    for (const { axis: a, from, to, cutFrom, cutTo } of this.parts) {
      // Капсулы начинаются за торцом пропила, у ветви — за корой родителя, у ствола — от зоны (ниже — кубики).
      const inside = cutFrom ? from : a.stem === undefined ? Math.max(from, section(a.parent, a.attach).r) : null;
      const s0 = inside === null ? a.points.find((q) => q.p.y >= this.zone)?.s ?? a.len : inside + section(a, inside).r;
      const thin = a.points.findLast((q) => q.r >= TWIG)?.s ?? 0, end = Math.min(to, thin);
      const s1 = cutTo && to <= thin ? to - section(a, to).r : end;
      if (s1 > s0) {
        const marks = [s0, ...a.points.filter((q, i) => i % RUN === 0 && q.s > s0 + 0.01 && q.s < s1 - 0.01).map((q) => q.s), s1];
        for (let i = 1; i < marks.length; i++) {
          const p = pointAt(a, marks[i - 1]), q = pointAt(a, marks[i]);
          out.push({
            a: p.p, b: q.p, r: (p.r + q.r) / 2, axis: a, from: p.s, to: q.s, soft: [this.yielding(a, p.s), this.yielding(a, q.s)],
            ...around(p.p, q.p, (p.r + q.r) / 2),
          });
        }
      } else if (to - from > 0 && cutFrom && cutTo && section(a, from).r >= TWIG) {
        const q = pointAt(a, (from + to) / 2), half = (to - from) / 2;
        for (let ring = q.r - half; ring > -half / 2; ring -= 2 * half) {
          const count = Math.max(1, Math.round((2 * Math.PI * Math.max(0, ring)) / (2 * half)));
          for (let k = 0; k < count; k++) {
            const az = (k / count) * 2 * Math.PI;
            const at = q.p.clone().addScaledVector(q.n, Math.max(0, ring) * Math.cos(az)).addScaledVector(q.b, Math.max(0, ring) * Math.sin(az));
            out.push({ a: at, b: at, r: half, axis: a, from: q.s, to: q.s, ...around(at, at, half) });
          }
        }
      }
    }
    return out;
  }

  // Луч из origin по единичному dir (в осях ветки) не дальше limit: в какую ось, где по её длине, на каком
  // расстоянии он упрётся первым и какой там радиус — { axis, s, t, r }.
  hit(origin, dir, limit) {
    let best = null;
    for (const c of this.shape) {
      if (c.mid.distanceToSquared(origin) > (Math.min(limit, best?.t ?? limit) + c.reach) ** 2) continue;
      const t = ray(origin, dir, c.a, c.b, c.r);
      if (t !== null && t <= limit && (!best || t < best.t)) best = { t, c };
    }
    if (!best) return null;
    const { c, t } = best;
    const ab = c.b.clone().sub(c.a), len2 = ab.lengthSq();
    const k = len2 > 0 ? THREE.MathUtils.clamp(origin.clone().addScaledVector(dir, t).sub(c.a).dot(ab) / len2, 0, 1) : 0;
    const s = THREE.MathUtils.lerp(c.from, c.to, k);
    return { axis: c.axis, s, t, r: section(c.axis, s).r };
  }

  // Перепилить ось axis на длине дуги s: всё, что за пропилом, — новая ветка (её и отдаём), здесь остаётся
  // то, что до него. За пропилом — дальше по оси и всё, что растёт на ней дальше s. Пропилы и листья
  // уходят с тем куском, на котором сидят. Обе ветки надо одеть заново (dress).
  // chair — раскол вдоль (Kerf.tongue): его полоса уходит с этим куском языком (tongue), а в дальнем на её
  // месте жёлоб (groove). Это малая доля куска: в весе и форме для столкновений их нет.
  split(axis, s, chair = null) {
    const past = beyond(axis, s);
    const near = [], far = [];
    for (const part of this.parts) {
      if (part.axis !== axis) (past(part.axis) ? far : near).push(part);
      else {
        const tear = chair && { ...chair, to: Math.min(chair.to, part.to) };
        if (s > part.from) near.push({ ...part, to: s, cutTo: true, tongue: tear });
        far.push({ ...part, from: Math.max(s, part.from), cutFrom: s > part.from || part.cutFrom, groove: tear ?? part.groove });
      }
    }
    const piece = new Limb(far, this.cards.filter((c) => past(c.axis, c.s)), this);
    piece.kerfs = this.kerfs.filter((k) => past(k.axis, k.s));
    for (const k of piece.kerfs) piece.group.add(k.mark);
    this.parts = near;
    this.cards = this.cards.filter((c) => !past(c.axis, c.s));
    this.kerfs = this.kerfs.filter((k) => !past(k.axis, k.s));
    return piece;
  }
}

// Какую долю своей прочности держит круглое сечение радиуса r, когда его тянет вдоль оси сила N (сжимает —
// меньше нуля) и гнёт момент M. Ломается оно целиком: по одну сторону нейтральной линии (в радиусах — y0
// от середины) древесина сжата во всю прочность на сжатие, по другую растянута во всю прочность на разрыв.
// Такая пара держит N(y0) и M(y0) — на этой кривой и лежит предел: нагрузка на луче (N, M) доходит до неё
// на доле, которую мы и отдаём. Сжатая сторона у круга — сегмент над y0, площадь acos y0 − y0·√(1 − y0²).
export function strain(N, M, r) {
  const n = N / r ** 2, m = M / r ** 3;
  if (m < 1e-9) return n > 0 ? n / (TENSILE * Math.PI) : -n / (COMPRESSIVE * Math.PI);
  const pull = (y) => TENSILE * Math.PI - (TENSILE + COMPRESSIVE) * (Math.acos(y) - y * Math.sqrt(1 - y * y));
  const bend = (y) => (2 / 3) * (1 - y * y) ** 1.5 * (TENSILE + COMPRESSIVE);
  let lo = -1, hi = 1;
  for (let i = 0; i < 40; i++) {
    const y = (lo + hi) / 2;
    if (pull(y) * m - bend(y) * n < 0) lo = y;
    else hi = y;
  }
  return m / bend((lo + hi) / 2);
}

// За точкой s оси axis — та же ось дальше s и всё, что растёт на ней дальше: лежит ли там точка at оси a.
const beyond = (axis, s) => (a, at) => {
  if (a === axis) return at > s;
  for (let c = a; c.parent; c = c.parent) if (c.parent === axis) return c.attach > s;
  return false;
};

// Номер точки оси a, с которой начинается шаг, где лежит длина дуги s.
const index = (a, s) => THREE.MathUtils.clamp(Math.floor(s / (a.len / (a.points.length - 1))), 0, a.points.length - 2);

// Середина капсулы и докуда она от неё достаёт: так луч быстро пропускает далёкие капсулы.
const around = (a, b, r) => ({ mid: a.clone().lerp(b, 0.5), reach: a.distanceTo(b) / 2 + r });

// Вес, центр тяжести и момент инерции вокруг него у нескольких тел { mass, com, inertia } вместе.
export function combine(list) {
  return sum(list.map(({ mass, com, inertia }) => ({ m: mass, p: com, own: inertia.elements })));
}

// Грузики { m, p, own } — масса, где она и свой момент инерции (9 чисел), если есть: сумма по Штейнеру.
function sum(bits) {
  const mass = bits.reduce((m, b) => m + b.m, 0);
  const com = bits.reduce((c, b) => c.addScaledVector(b.p, b.m), new THREE.Vector3()).divideScalar(mass);
  const e = new Array(9).fill(0);
  for (const { m, p, own } of bits) {
    const d = p.clone().sub(com).toArray(), dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) e[3 * i + j] += m * ((i === j ? dd : 0) - d[i] * d[j]) + (own ? own[3 * i + j] : 0);
  }
  return { mass, com, inertia: new THREE.Matrix3().fromArray(e) };
}

// Где луч ro + rd·t (rd единичный) входит в капсулу a–b радиуса r, или null (Иниго Килес, «Пересечения»):
// сначала в бесконечный цилиндр вокруг отрезка, а мимо его длины — в полусферу на ближнем конце.
function ray(ro, rd, a, b, r) {
  const ba = _ba.copy(b).sub(a), oa = _oa.copy(ro).sub(a);
  const baba = ba.dot(ba), bard = ba.dot(rd), baoa = ba.dot(oa);
  const k2 = baba - bard * bard;
  if (baba > 1e-12 && k2 > 1e-12) {
    const k1 = baba * rd.dot(oa) - baoa * bard, k0 = baba * oa.dot(oa) - baoa * baoa - r * r * baba;
    const h = k1 * k1 - k2 * k0;
    if (h < 0) return null;
    const t = (-k1 - Math.sqrt(h)) / k2, y = baoa + t * bard;
    if (y > 0 && y < baba) return t >= 0 ? t : null;
    return sphere(ro, rd, y <= 0 ? a : b, r);
  }
  // Шар или луч вдоль самого отрезка.
  const ta = sphere(ro, rd, a, r), tb = sphere(ro, rd, b, r);
  return ta === null ? tb : tb === null ? ta : Math.min(ta, tb);
}

function sphere(ro, rd, c, r) {
  const oc = _oc.copy(ro).sub(c), b = rd.dot(oc), h = b * b - (oc.dot(oc) - r * r);
  if (h < 0) return null;
  const t = -b - Math.sqrt(h);
  return t >= 0 ? t : null;
}
const _ba = new THREE.Vector3(), _oa = new THREE.Vector3(), _oc = new THREE.Vector3();

// Пропил поперёк ветки: ось axis, длина дуги s, плоскость — сечение (нормаль — касательная оси).
// В плоскости — свои оси x, y по рамке оси n, b. Сечение — обвод (outline, SIDES точек) и клетки N×N:
// древесина — те, чья середина внутри обвода; пила их выпиливает (cut 1 — щель). Где недопил под нагрузкой
// смяло, щель сомкнулась (cut 2): там её стенки упёрлись друг в друга и держат сжатие. Выпилена вся
// древесина — ветка отделилась. На коре по пропилу — тёмная щель (mark) там, где он вышел к коре.
const SIDES = 48;
const CELL = 0.006; // м — клетка сечения, не крупнее этого (но не меньше 8 и не больше 64 клеток поперёк)
const SLIT = 0.01;  // м — ширина щели от цепи
const slit = new THREE.MeshBasicMaterial({ color: 0x1b130c, side: THREE.DoubleSide });

export class Kerf {
  constructor(axis, s) {
    this.axis = axis;
    this.s = s;
    const q = pointAt(axis, s);
    this.point = q;
    this.center = q.p;
    this.normal = q.t;
    this.radii = Float32Array.from({ length: SIDES }, (_, j) => girth(axis, q, (j / SIDES) * 2 * Math.PI));
    this.r = Math.max(...this.radii);
    // Обвод — многоугольник: его вершины на равных азимутах. По нему считаются и клетки древесины, и путь
    // пилы (crossing, band): иначе между ними остаётся щёлочка, где клетка древесины, а пиле пилить нечего.
    this.outline = Array.from(this.radii, (r, j) => [r * Math.cos((j / SIDES) * 2 * Math.PI), r * Math.sin((j / SIDES) * 2 * Math.PI)]);
    this.N = THREE.MathUtils.clamp(Math.ceil((2 * this.r) / CELL), 8, 64);
    this.cell = (2 * this.r) / this.N;
    this.wood = new Uint8Array(this.N * this.N);
    this.cut = new Uint8Array(this.N * this.N);
    this.left = 0;
    for (let j = 0, id = 0; j < this.N; j++) {
      for (let i = 0; i < this.N; i++, id++) {
        if (!this.inside(this.x(i), this.x(j))) continue;
        this.wood[id] = 1;
        this.left++;
      }
    }
    this.mark = new THREE.Mesh(new THREE.BufferGeometry(), slit);
    this.mark.frustumCulled = false;
    this.slit();
  }

  get through() {
    return this.left === 0;
  }

  // Середина клетки номер i по x (или по y).
  x(i) {
    return -this.r + (i + 0.5) * this.cell;
  }

  // Радиус обвода по азимуту az.
  radius(az) {
    const f = ((az / (2 * Math.PI)) * SIDES + SIDES) % SIDES, j = Math.floor(f);
    return THREE.MathUtils.lerp(this.radii[j], this.radii[(j + 1) % SIDES], f - j);
  }

  // Внутри обвода — по ту же сторону ребра своего сектора, что и середина.
  inside(x, y) {
    const j = Math.floor(((Math.atan2(y, x) / (2 * Math.PI)) * SIDES + SIDES) % SIDES);
    const [x0, y0] = this.outline[j], [x1, y1] = this.outline[(j + 1) % SIDES];
    return (x1 - x0) * (y - y0) - (y1 - y0) * (x - x0) >= 0;
  }

  // Точка (или направление, если dir) ветки — в осях плоскости пропила.
  flat(v, dir = false) {
    const d = dir ? v : _d.copy(v).sub(this.center);
    return [d.dot(this.point.n), d.dot(this.point.b)];
  }

  // Луч из p по d (в плоскости пропила, d единичный): на каком расстоянии он входит в обвод (0 — если уже
  // внутри) и где выходит из него последним, или null — мимо.
  crossing([px, py], [dx, dy]) {
    let enter = this.inside(px, py) ? 0 : Infinity, exit = -Infinity;
    for (let j = 0; j < SIDES; j++) {
      const [x0, y0] = this.outline[j], [x1, y1] = this.outline[(j + 1) % SIDES];
      const ex = x1 - x0, ey = y1 - y0;
      const denom = dx * ey - dy * ex;
      if (Math.abs(denom) < 1e-12) continue;
      const wx = x0 - px, wy = y0 - py;
      const t = (wx * ey - wy * ex) / denom, u = (wx * dy - wy * dx) / denom;
      if (u < 0 || u > 1 || t < 0) continue;
      enter = Math.min(enter, t);
      exit = Math.max(exit, t);
    }
    return enter < Infinity ? { enter, exit: Math.max(exit, enter) } : null;
  }

  // Луч from + dir·t (в осях ветки; from спроецирован на плоскость пропила): где он входит в древесину
  // и где выходит, не дальше limit, — или null, если до limit не вошёл.
  pass(from, dir, limit) {
    const hit = this.crossing(this.flat(from), this.flat(dir, true));
    return hit && hit.enter <= limit ? { enter: hit.enter, exit: Math.min(hit.exit, limit) } : null;
  }

  // То же для всей кромки шины: отрезок от origin на half в обе стороны по side идёт по along. Первой
  // коры касается ближайшая к ней точка кромки, выходит последней та, за которой древесины больше.
  band(origin, along, side, limit, half) {
    const [ex, ey] = this.flat(origin), [ax, ay] = this.flat(along, true), [sx, sy] = this.flat(side, true);
    let enter = Infinity, exit = -Infinity;
    for (const [x, y] of this.outline) {
      const vx = x - ex, vy = y - ey;
      if (Math.abs(vx * sx + vy * sy) > half) continue;
      enter = Math.min(enter, vx * ax + vy * ay);
      exit = Math.max(exit, vx * ax + vy * ay);
    }
    for (const w of [-half, half]) {
      const hit = this.crossing([ex + sx * w, ey + sy * w], [ax, ay]);
      if (!hit) continue;
      enter = Math.min(enter, hit.enter);
      exit = Math.max(exit, hit.exit);
    }
    if (enter === Infinity) return null;
    enter = Math.max(0, enter);
    return enter <= limit ? { enter, exit: Math.min(exit, limit) } : null;
  }

  // Выпилить клетки, чьи середины от from до to по ходу пилы от origin и в пределах длины шины.
  carve({ origin, along, side }, from, to, length) {
    const [ex, ey] = this.flat(origin), [ax, ay] = this.flat(along, true), [sx, sy] = this.flat(side, true);
    let changed = false;
    for (let j = 0, id = 0; j < this.N; j++) {
      for (let i = 0; i < this.N; i++, id++) {
        if (this.cut[id]) continue;
        const vx = this.x(i) - ex, vy = this.x(j) - ey, d = vx * ax + vy * ay;
        if (d < from || d > to || Math.abs(vx * sx + vy * sy) > length / 2) continue;
        this.cut[id] = 1;
        if (this.wood[id]) this.left--;
        changed = true;
      }
    }
    if (changed) this.slit();
  }

  // Что держит сечение пропила, когда на то, что за ним, давят сила F и момент M вокруг середины (в осях
  // ветки). Держат недопил (тянется и сжимается) и сомкнутая щель (только сжатие). Ломается сечение, как
  // в strain: по одну сторону нейтральной линии всё растянуто во всю свою прочность, по другую — сжато.
  // Линия — поперёк момента вокруг середины того, что держит; где она встанет, ищем по пределу в осях
  // (сила, момент): двигая линию через клетки, обходим его выпуклый многоугольник, и нагрузка на луче
  // из нуля выходит из него на доле 1/ratio. closing — клетки щели, что при этом на сжатой стороне:
  // их сомкнёт; пусто — щель только раскрывается. Смыкается щель, только если её устье — дальний
  // от нейтральной линии край — на сжатой стороне. Если туда заходит лишь кончик пропила (пилили
  // с растянутой стороны чуть наискось), он у самой линии: чтобы сомкнуться, сечению пришлось бы сильно
  // повернуться, а растянутый недопил рвётся раньше. pulled — растянутые клетки недопила (их рвёт), d — куда
  // смотрит линия (в осях пропила). squeezed — целое сечение сжато всё: зажмёт с любой стороны.
  strain(F, M) {
    const N = F.dot(this.normal), { n, b } = this.point, A = this.cell ** 2, C = COMPRESSIVE * A;
    const cx = (id) => this.x(id % this.N), cy = (id) => this.x(Math.floor(id / this.N));
    const bear = [], open = [];
    let ox = 0, oy = 0;
    for (let id = 0; id < this.wood.length; id++) {
      if (!this.wood[id]) continue;
      if (this.cut[id] === 1) open.push(id);
      else {
        bear.push(id);
        ox += cx(id);
        oy += cy(id);
      }
    }
    const bend = Math.hypot(M.dot(n), M.dot(b));
    const squeezed = N / (Math.PI * this.r ** 2) + (4 * bend) / (Math.PI * this.r ** 3) < 0;
    if (!bear.length || !(N || bend)) return { ratio: bear.length ? 0 : Infinity, closing: [], squeezed, pulled: [] };
    ox /= bear.length;
    oy /= bear.length;
    let dx = -M.dot(b) - N * ox, dy = M.dot(n) - N * oy;
    const m = Math.hypot(dx, dy);
    [dx, dy] = m > 1e-9 ? [dx / m, dy / m] : [1, 0];
    const u = new Float64Array(this.wood.length);
    for (const id of [...bear, ...open]) u[id] = (cx(id) - ox) * dx + (cy(id) - oy) * dy;
    bear.sort((p, q) => u[p] - u[q]);
    const pull = (id) => (this.cut[id] ? 0 : TENSILE * A);
    // Вершины предела против часовой: сначала растянуто всё, что выше линии (up), потом всё, что ниже.
    // Луч нагрузки (N, m) выходит через ребро, что смотрит на него, и на нём доля пути λ — наименьшая.
    let best = { lambda: Infinity };
    const edge = (p, q, at, up) => {
      const ex = q[0] - p[0], ey = q[1] - p[1], den = N * ey - m * ex;
      if (den <= 0) return;
      const lambda = Math.max(0, p[0] * ey - p[1] * ex) / den;
      if (lambda < best.lambda) best = { lambda, at, up };
    };
    for (const up of [true, false]) {
      let p = up ? [0, 0] : [-C * bear.length, 0];
      if (up) for (const id of bear) p = [p[0] + pull(id), p[1] + pull(id) * u[id]];
      for (const id of bear) {
        const k = (up ? -1 : 1) * (pull(id) + C), q = [p[0] + k, p[1] + k * u[id]];
        edge(p, q, u[id], up);
        p = q;
      }
    }
    const { lambda, at, up } = best;
    const pressed = (id) => (up ? at - u[id] : u[id] - at); // насколько клетка за линией на сжатой стороне
    const mouth = open.reduce((m, id) => (Math.abs(pressed(id)) > Math.abs(pressed(m)) ? id : m), open[0]);
    const closing = open.length && pressed(mouth) > 0 ? open.filter((id) => pressed(id) > this.cell / 2) : [];
    const pulled = bear.filter((id) => !this.cut[id] && (up ? u[id] > at : u[id] < at));
    return { ratio: 1 / lambda, closing, squeezed, pulled, d: [dx, dy] };
  }

  // Раскол вдоль (barber chair). Растянутые волокна недопила pulled рвутся не поперёк: они тянут с силой
  // T = TENSILE·площадь и вырывают свой пучок из дальнего куска, как отщеп из ствола (splitLength в physics.js).
  // Пучок скалывается по граням, где граничит с остальной древесиной (кора снаружи ничего не держит),
  // на длину T / (SHEAR·периметр) — пока площади хватит, чтобы передать силу. Полоса толщиной t уходит
  // на ~3t, а тонкий недопил между встречными пропилами рвётся поперёк. Отдаёт, где раскол: полосу поперёк
  // d (в осях пропила) от lo до hi от оси на длине оси от from до to — или null, если он короче SPLIT_MIN.
  tongue(pulled, d) {
    const mine = new Set(pulled), N = this.N;
    let faces = 0, lo = Infinity, hi = -Infinity;
    for (const id of pulled) {
      const i = id % N, j = (id - i) / N;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + di, jj = j + dj;
        if (ii >= 0 && jj >= 0 && ii < N && jj < N && this.wood[jj * N + ii] && !mine.has(jj * N + ii)) faces++;
      }
      const u = this.x(i) * d[0] + this.x(j) * d[1];
      lo = Math.min(lo, u);
      hi = Math.max(hi, u);
    }
    const L = faces ? (TENSILE * this.cell * pulled.length) / (SHEAR * faces) : 0;
    return L < SPLIT_MIN ? null : { d, lo: lo - this.cell / 2, hi: hi + this.cell / 2, from: this.s, to: this.s + L };
  }

  // Недопил смяло: щель там, где он сжат, сомкнулась.
  close(ids) {
    for (const id of ids) this.cut[id] = 2;
  }

  // Щель на коре: по тем азимутам, где пропил дошёл до коры, — тёмная полоска по ширине цепи.
  slit() {
    const pos = [], index = [];
    const { center, normal, point: { n, b } } = this;
    const out = (az, k) => center.clone().addScaledVector(n, Math.cos(az) * this.radius(az) * k).addScaledVector(b, Math.sin(az) * this.radius(az) * k);
    for (let j = 0; j < SIDES; j++) {
      const mid = ((j + 0.5) / SIDES) * 2 * Math.PI, p = out(mid, 0.8);
      const [x, y] = this.flat(p);
      const i = Math.floor((x + this.r) / this.cell), k = Math.floor((y + this.r) / this.cell);
      if (!this.cut[k * this.N + i]) continue;
      const c = pos.length / 3;
      for (const az of [(j / SIDES) * 2 * Math.PI, ((j + 1) / SIDES) * 2 * Math.PI]) {
        const rim = out(az, 1.03);
        pos.push(...rim.clone().addScaledVector(normal, -SLIT / 2).toArray(), ...rim.addScaledVector(normal, SLIT / 2).toArray());
      }
      index.push(c, c + 1, c + 2, c + 1, c + 3, c + 2);
    }
    this.mark.geometry.dispose();
    this.mark.geometry = new THREE.BufferGeometry();
    this.mark.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.mark.geometry.setIndex(index);
  }
}
const _d = new THREE.Vector3(), _e = new THREE.Vector3();
