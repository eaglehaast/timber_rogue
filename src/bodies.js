import * as THREE from 'three';

// Твёрдые тела: отпилы, куски пня. У тела свои вес, центр тяжести и момент инерции, а форма — капсулы:
// отрезок с радиусом (у шара отрезок нулевой). Кусок из кубиков — шары, вписанные в его древесину.
// Тела падают и бьются о землю, о кубики пня и упавшего ствола и друг о друга. Где капсулы сошлись —
// касание: толчок (импульс) гасит сближение, даёт отскок, а трение — гасит скольжение.
// Касание ищем и чуть заранее, на путь тела за шаг: так быстрое тело не проскочит сквозь тонкое.
// Капсула может быть податливой (soft, м/Н — у ветки, что гнётся): такое касание — пружина с гашением,
// оно уступает тем глубже, чем сильнее давят, и не отскакивает.
// Улёгшееся тело засыпает и не считается, пока его не толкнут или не тронут то, на чём оно лежит.
// Чем касания давят на каждую капсулу, тело помнит: по этому видно, на что оно опирается и что гнёт.
const G = 9.8;
const STEP = 1 / 120;      // с — шаг расчёта
const PASSES = 10;         // столько раз за шаг проходим по касаниям: иначе стопка тел проседает
const BOUNCE = 0.3;        // какая доля скорости удара возвращается отскоком
const BOUNCE_FROM = 0.6;   // м/с — медленнее тело не отскакивает, а ложится
const FRICTION = 0.6;
const SLOP = 0.002;        // м — на столько тела могут заходить друг в друга, иначе лежащее дрожит
const PUSH = 0.25;         // какую долю глубины касания выправляем за шаг
const MAX_PUSH = 0.6;      // м/с — глубоко зашедшие тела расходятся не быстрее
const ROLL = 5;            // 1/с — как быстро трение качения (трава, земля) гасит вращение лежащего тела
const SLEEP_V = 0.05, SLEEP_T = 0.6; // м/с: все точки тела медленнее этого дольше SLEEP_T — уснуло
const LOAD_T = 0.1;        // с — за столько нагрузка на капсулу догоняет толчки касаний: они скачут от шага к шагу
const CELL = 0.5;          // м — клетка сетки, по которой ищем капсулы веток рядом с телом
const NEAR = 0.05;         // м — так близко к тому, что сдвинулось, спящее тело просыпается

const UP = new THREE.Vector3(0, 1, 0);
const _u = new THREE.Vector3(), _v = new THREE.Vector3(), _w = new THREE.Vector3(), _j = new THREE.Vector3();
const _p = new THREE.Vector3(), _n = new THREE.Vector3(), _s = new THREE.Vector3(), _a = new THREE.Vector3(), _e = new THREE.Vector3();
const _lo = new THREE.Vector3(), _hi = new THREE.Vector3();
const _c1 = new THREE.Vector3(), _c2 = new THREE.Vector3(), _q = new THREE.Quaternion();
const _m = new THREE.Matrix4(), _r = new THREE.Matrix3();

export class Body {
  // object — что двигаем: его начало — центр тяжести тела. mass — кг, inertia — момент инерции вокруг
  // центра тяжести в осях тела, position и quaternion — где центр тяжести и как тело повёрнуто
  // в осях мира, capsules — форма в осях тела: [{ a, b, r, soft, src }]: soft — податливость у концов a и b
  // (нет — капсула твёрдая), src — откуда капсула (тело его не трогает).
  constructor(object, { mass, inertia, position, quaternion, capsules }) {
    this.object = object;
    this.invMass = 1 / mass;
    this.invInertia = inertia.clone().invert();
    this.world = new THREE.Matrix3(); // обратный момент инерции в осях мира
    this.position = position.clone();
    this.quaternion = quaternion.clone();
    this.velocity = new THREE.Vector3();
    this.spin = new THREE.Vector3();
    // Толчок, которым расталкиваем зашедшие друг в друга тела: сдвигает их, но скорости им не даёт.
    this.shove = { velocity: new THREE.Vector3(), spin: new THREE.Vector3() };
    // force, torque — чем на капсулу давят касания: сила и её момент вокруг центра тяжести, в осях тела.
    this.capsules = capsules.map(({ a, b, r, soft = null, src }) => ({
      a, b, r, soft, src, ball: a.equals(b), A: new THREE.Vector3(), B: new THREE.Vector3(), low: new THREE.Vector3(), high: new THREE.Vector3(),
      force: new THREE.Vector3(), torque: new THREE.Vector3(), stepForce: new THREE.Vector3(), stepTorque: new THREE.Vector3(),
    }));
    this.reach = Math.max(...capsules.map((c) => Math.max(c.a.length(), c.b.length()) + c.r));
    this.low = new THREE.Vector3(); // рамка всех капсул
    this.high = new THREE.Vector3();
    this.sweep = 0; // м — сколько точка тела может пролететь за шаг
    this.still = 0;
    this.asleep = false;
    this.touching = false;
    this.place();
  }

  // Капсулы, объект и обратный момент инерции — по нынешнему положению тела.
  place() {
    _r.setFromMatrix4(_m.makeRotationFromQuaternion(this.quaternion));
    this.world.copy(_r).multiply(this.invInertia).multiply(_r.transpose());
    for (const c of this.capsules) {
      c.A.copy(c.a).applyQuaternion(this.quaternion).add(this.position);
      c.B.copy(c.b).applyQuaternion(this.quaternion).add(this.position);
    }
    this.object.position.copy(this.position);
    this.object.quaternion.copy(this.quaternion);
  }

  wake() {
    this.asleep = false;
    this.still = 0;
  }
}

// Тела у одного дерева, в осях root. Земля — плоскость y = 0. Остальное, обо что бьются, — наборы (fix):
// кубики (пень, упавший комель) — solid с press(p, r, reach), рамкой box и номером version, который растёт,
// когда кубики выпиливают, — и капсулы веток на дереве. Набор двигает вместе с object: пень стоит с делянкой,
// крону качает ветер, упавший верх летит с деревом и толкает тела своей скоростью.
export class World {
  constructor(root) {
    this.root = root;
    this.bodies = [];
    this.sets = [];
    this.time = 0;
  }

  add(body) {
    this.bodies.push(body);
  }

  // Набора больше нет: то, что на нём лежало, просыпается.
  unfix(set) {
    this.sets.splice(this.sets.indexOf(set), 1);
    this.rouse(set);
  }

  remove(body) {
    this.bodies.splice(this.bodies.indexOf(body), 1);
  }

  fix(object, { solids = [], capsules = [] }) {
    const matrix = this.frame(object, new THREE.Matrix4());
    const set = {
      object, solids, matrix, inverse: matrix.clone().invert(), turn: new THREE.Matrix3().setFromMatrix4(matrix),
      back: new THREE.Matrix4(), moved: false, dt: 0, seen: solids.map((s) => s.version), capsules: [], visit: 0,
      // Рамка всего набора в его осях и в осях root: тела вне неё набор не трогает.
      box: { low: new THREE.Vector3(), high: new THREE.Vector3() }, span: { low: new THREE.Vector3(), high: new THREE.Vector3() },
    };
    this.sets.push(set);
    this.refit(set, capsules);
    return set;
  }

  // Капсулы набора поменялись (от ветки отпилили кусок): раскладываем их по клеткам заново.
  // Тела у старых и у новых капсул будим: то, на чём они лежали, могло уйти.
  refit(set, capsules) {
    this.rouse(set);
    set.capsules = capsules.map(({ a, b, r }) => ({ A: a, B: b, r, low: a.clone().min(b).subScalar(r), high: a.clone().max(b).addScalar(r) }));
    set.grid = new Map();
    set.capsules.forEach((c, i) => cells(c.low, c.high, (key) => {
      if (!set.grid.has(key)) set.grid.set(key, []);
      set.grid.get(key).push(i);
    }));
    set.stamp = new Uint32Array(set.capsules.length);
    set.box.low.setScalar(Infinity);
    set.box.high.setScalar(-Infinity);
    for (const c of [...set.capsules, ...set.solids.map((solid) => solid.box)]) {
      set.box.low.min(c.low);
      set.box.high.max(c.high);
    }
    span(set);
    this.rouse(set);
  }

  // Разбудить спящие тела рядом с набором.
  rouse(set) {
    for (const b of this.bodies) if (b.asleep && near(set, b)) b.wake();
  }

  // Положение object в осях root.
  frame(object, out) {
    if (object === this.root) return out.identity();
    object.updateWorldMatrix(true, false);
    return out.copy(this.root.matrixWorld).invert().multiply(object.matrixWorld);
  }

  step(dt) {
    for (const set of this.sets) {
      const now = this.frame(set.object, _m);
      set.moved = !now.equals(set.matrix);
      if (set.moved) {
        // Точка, неподвижная на object, сейчас в x, а кадр назад была в back·x: отсюда скорость поверхности.
        set.inverse.copy(now).invert();
        set.back.multiplyMatrices(set.matrix, set.inverse);
        set.matrix.copy(now);
        set.turn.setFromMatrix4(now);
        set.dt = dt;
        span(set);
      }
      let changed = set.moved;
      set.solids.forEach((s, i) => {
        if (s.version === set.seen[i]) return;
        set.seen[i] = s.version;
        changed = true;
      });
      if (changed) this.rouse(set);
    }
    this.time += dt;
    while (this.time >= STEP) {
      this.time -= STEP;
      this.advance(STEP);
    }
  }

  advance(h) {
    const awake = this.bodies.filter((b) => !b.asleep);
    if (!awake.length) return;
    for (const b of awake) {
      b.velocity.y -= G * h;
      b.sweep = (b.velocity.length() + b.spin.length() * b.reach) * h;
      b.touching = false;
      bound(b);
    }
    const contacts = [];
    awake.forEach((b, i) => {
      for (const c of b.capsules) {
        ground(b, c, c.A, contacts);
        if (!c.ball) ground(b, c, c.B, contacts);
      }
      for (const set of this.sets) if (overlap(b.low, b.high, set.span)) for (const c of b.capsules) against(b, c, set, contacts);
      for (let k = i + 1; k < awake.length; k++) pair(b, awake[k], contacts);
      for (const o of this.bodies) if (o.asleep) pair(b, o, contacts);
    });
    for (const c of contacts) prepare(c, h);
    for (let pass = 0; pass < PASSES; pass++) for (const c of contacts) solve(c);
    for (let pass = 0; pass < PASSES; pass++) for (const c of contacts) shove(c);
    for (const c of contacts) bear(c, h);
    const k = 1 - Math.exp(-h / LOAD_T);
    for (const b of awake) {
      for (const c of b.capsules) {
        c.force.lerp(c.stepForce, k);
        c.torque.lerp(c.stepTorque, k);
        c.stepForce.set(0, 0, 0);
        c.stepTorque.set(0, 0, 0);
      }
      settle(b, h);
    }
  }
}

// Рамка набора в осях root — по углам его рамки в своих осях.
function span(set) {
  const { box: { low, high }, span: out } = set;
  out.low.setScalar(Infinity);
  out.high.setScalar(-Infinity);
  if (low.x > high.x) return;
  for (let k = 0; k < 8; k++) {
    _s.set(k & 1 ? high.x : low.x, k & 2 ? high.y : low.y, k & 4 ? high.z : low.z).applyMatrix4(set.matrix);
    out.low.min(_s);
    out.high.max(_s);
  }
}

// Рамки капсул и всего тела с запасом на путь за шаг.
function bound(b) {
  b.low.setScalar(Infinity);
  b.high.setScalar(-Infinity);
  for (const c of b.capsules) {
    c.low.copy(c.A).min(c.B).subScalar(c.r + b.sweep);
    c.high.copy(c.A).max(c.B).addScalar(c.r + b.sweep);
    b.low.min(c.low);
    b.high.max(c.high);
  }
}

const overlap = (low, high, box) => low.x <= box.high.x && box.low.x <= high.x && low.y <= box.high.y
  && box.low.y <= high.y && low.z <= box.high.z && box.low.z <= high.z;

// Клетки сетки (по CELL), в которые заходит рамка low–high: номер клетки — из трёх её индексов по 10 бит.
function cells(low, high, each) {
  const x1 = Math.floor(high.x / CELL), y1 = Math.floor(high.y / CELL), z1 = Math.floor(high.z / CELL);
  for (let x = Math.floor(low.x / CELL); x <= x1; x++) {
    for (let y = Math.floor(low.y / CELL); y <= y1; y++) {
      for (let z = Math.floor(low.z / CELL); z <= z1; z++) each((((x & 1023) << 10) | (y & 1023)) * 1024 + (z & 1023));
    }
  }
}

// Капсулы набора, чьи рамки пересекают рамку low–high (в осях набора).
function around(set, low, high, each) {
  if (!set.capsules.length) return;
  set.visit++;
  cells(low, high, (key) => {
    for (const i of set.grid.get(key) ?? []) {
      if (set.stamp[i] === set.visit) continue;
      set.stamp[i] = set.visit;
      if (overlap(low, high, set.capsules[i])) each(set.capsules[i]);
    }
  });
}

// Тело b рядом с набором: его шар задевает рамку кубиков или капсулу.
function near(set, b) {
  const p = _a.copy(b.position).applyMatrix4(set.inverse), r = b.reach + NEAR;
  const low = _lo.copy(p).subScalar(r), high = _hi.copy(p).addScalar(r);
  if (set.solids.some((s) => overlap(low, high, s.box))) return true;
  let close = false;
  around(set, low, high, (d) => {
    if (!close && closest(p, p, d.A, d.B, _c1, _c2) < (r + d.r) ** 2) close = true;
  });
  return close;
}

// Касание капсулы ca тела a с капсулой cb тела b (или с неподвижным, если b — null) в точке p; нормаль n —
// от b к a, depth — на сколько зашли друг в друга (меньше нуля — сколько ещё до касания). surface — скорость
// того, обо что бьёмся.
function contact(a, b, p, n, depth, surface, contacts, ca, cb = null) {
  if (depth > -SLOP) {
    a.touching = true;
    if (b) b.touching = true;
  }
  contacts.push({
    a, b, ca, cb, p: p.clone(), n: n.clone(), depth, surface, soft: give(ca, p) + give(cb, p), ra: new THREE.Vector3(), rb: new THREE.Vector3(),
    t1: new THREE.Vector3(), t2: new THREE.Vector3(),
  });
}

// Податливость капсулы c у точки p — между податливостью её концов.
function give(c, p) {
  if (!c?.soft) return 0;
  const ab = _w.copy(c.B).sub(c.A), len2 = ab.lengthSq();
  const k = len2 > 0 ? THREE.MathUtils.clamp(_v.copy(p).sub(c.A).dot(ab) / len2, 0, 1) : 0;
  return THREE.MathUtils.lerp(c.soft[0], c.soft[1], k);
}

// Конец end капсулы c у земли.
function ground(b, c, end, contacts) {
  const depth = c.r - end.y;
  if (depth < -b.sweep) return;
  contact(b, null, _p.copy(end).addScaledVector(UP, depth / 2 - c.r), UP, depth, null, contacts, c);
}

// Тела a и o: каждая пара их капсул, чьи рамки пересеклись. Сначала у каждого — капсулы в рамке другого:
// у большого сука их сотни, а рядом с другим телом — единицы. Спящее o держит, как неподвижное,
// а если в него ударили — просыпается.
function pair(a, o, contacts) {
  if (!overlap(a.low, a.high, o)) return;
  const b = o.asleep ? null : o;
  const mine = a.capsules.filter((c) => overlap(c.low, c.high, o));
  const theirs = mine.length ? o.capsules.filter((d) => overlap(d.low, d.high, a)) : [];
  for (const c of mine) {
    for (const d of theirs) {
      if (!overlap(c.low, c.high, d)) continue;
      const depth = meet(c.A, c.B, c.r, d.A, d.B, d.r, a.sweep + o.sweep);
      if (depth === null) continue;
      contact(a, b, _p, _n, depth, null, contacts, c, b && d);
      if (o.asleep && a.velocity.length() > 2 * SLEEP_V) o.wake();
    }
  }
}

// Две капсулы: ближайшие точки их отрезков ближе суммы радиусов (с запасом margin) — касание: на сколько
// они зашли друг в друга (ответ), нормаль от второй к первой (_n) и точка посередине перекрытия (_p).
function meet(A1, B1, r1, A2, B2, r2, margin) {
  const dist2 = closest(A1, B1, A2, B2, _c1, _c2);
  const reach = r1 + r2 + margin;
  if (dist2 >= reach * reach) return null;
  const dist = Math.sqrt(dist2);
  if (dist > 1e-9) _n.copy(_c1).sub(_c2).divideScalar(dist);
  else _n.copy(UP);
  const depth = r1 + r2 - dist;
  _p.copy(_c1).addScaledVector(_n, depth / 2 - r1);
  return depth;
}

// Капсула тела и неподвижный набор — в осях набора: по кубикам шарами вдоль отрезка капсулы
// (через радиус друг от друга), с капсулами веток — по сетке.
function against(b, c, set, contacts) {
  const a = _a.copy(c.A).applyMatrix4(set.inverse), e = _e.copy(c.B).applyMatrix4(set.inverse);
  const pad = c.r + b.sweep;
  const low = _lo.copy(a).min(e).subScalar(pad), high = _hi.copy(a).max(e).addScalar(pad);
  const hit = (depth) => {
    _p.applyMatrix4(set.matrix);
    _n.applyMatrix3(set.turn).normalize();
    const surface = set.moved ? _p.clone().sub(_s.copy(_p).applyMatrix4(set.back)).divideScalar(set.dt) : null;
    contact(b, null, _p, _n, depth, surface, contacts, c);
  };
  for (const solid of set.solids) {
    if (!overlap(low, high, solid.box)) continue;
    const count = c.ball ? 1 : Math.ceil(a.distanceTo(e) / c.r) + 1;
    for (let i = 0; i < count; i++) {
      const t = count > 1 ? i / (count - 1) : 0;
      const pressed = solid.press(_v.copy(a).lerp(e, t), c.r, b.sweep);
      if (!pressed) continue;
      _n.copy(pressed.normal);
      _p.copy(a).lerp(e, t).addScaledVector(_n, pressed.depth / 2 - c.r);
      hit(pressed.depth);
    }
  }
  around(set, low, high, (d) => {
    const depth = meet(a, e, c.r, d.A, d.B, d.r, b.sweep);
    if (depth !== null) hit(depth);
  });
}

// Ближайшие точки отрезков p1–q1 и p2–q2 (c1 на первом, c2 на втором) и квадрат расстояния между ними
// (Эриксон, «Обнаружение столкновений в реальном времени», 5.1.9).
function closest(p1, q1, p2, q2, c1, c2) {
  const d1 = _j.copy(q1).sub(p1), d2 = _w.copy(q2).sub(p2), r = _v.copy(p1).sub(p2);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  let s = 0, t = 0;
  if (a <= 1e-12 && e > 1e-12) t = THREE.MathUtils.clamp(f / e, 0, 1);
  else if (a > 1e-12) {
    const c = d1.dot(r);
    if (e <= 1e-12) s = THREE.MathUtils.clamp(-c / a, 0, 1);
    else {
      const b = d1.dot(d2), denom = a * e - b * b;
      s = denom > 1e-12 ? THREE.MathUtils.clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = THREE.MathUtils.clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = THREE.MathUtils.clamp((b - c) / a, 0, 1);
      }
    }
  }
  c1.copy(p1).addScaledVector(d1, s);
  c2.copy(p2).addScaledVector(d2, t);
  return c1.distanceToSquared(c2);
}

// Насколько единичный толчок вдоль d в точке r тела меняет скорость этой точки вдоль d: 1/m + d·((I⁻¹(r×d))×r).
function response(body, r, d) {
  if (!body) return 0;
  _u.copy(r).cross(d).applyMatrix3(body.world).cross(r);
  return body.invMass + _u.dot(d);
}

// Скорость точки тела, что в r от его центра: v + ω×r — обычная или от расталкивания (motion).
function pointVelocity(motion, r, out) {
  return out.copy(motion.spin).cross(r).add(motion.velocity);
}

// Скорость тела a относительно того, обо что оно бьётся, в точке касания.
function relative(c, out, shoving = false) {
  pointVelocity(shoving ? c.a.shove : c.a, c.ra, out);
  if (c.b) out.sub(pointVelocity(shoving ? c.b.shove : c.b, c.rb, _w));
  else if (c.surface && !shoving) out.sub(c.surface);
  return out;
}

// Толчок j в точке касания: телу a — вдоль j, телу b — против.
function apply(c, j, shoving = false) {
  const ma = shoving ? c.a.shove : c.a;
  ma.velocity.addScaledVector(j, c.a.invMass);
  ma.spin.add(_u.copy(c.ra).cross(j).applyMatrix3(c.a.world));
  if (!c.b) return;
  const mb = shoving ? c.b.shove : c.b;
  mb.velocity.addScaledVector(j, -c.b.invMass);
  mb.spin.sub(_u.copy(c.rb).cross(j).applyMatrix3(c.b.world));
}

// Какой скорости сближения касание добивается: отскока, если ударились быстро. Ещё не коснулись —
// подлететь можно вплотную, а если коснутся за этот шаг, отскакивают сразу.
function prepare(c, h) {
  c.ra.copy(c.p).sub(c.a.position);
  if (c.b) c.rb.copy(c.p).sub(c.b.position);
  c.t1.copy(Math.abs(c.n.x) < 0.9 ? _v.set(1, 0, 0) : _v.set(0, 0, 1)).cross(c.n).normalize();
  c.t2.copy(c.n).cross(c.t1);
  c.kn = 1 / (response(c.a, c.ra, c.n) + response(c.b, c.rb, c.n));
  c.k1 = 1 / (response(c.a, c.ra, c.t1) + response(c.b, c.rb, c.t1));
  c.k2 = 1 / (response(c.a, c.ra, c.t2) + response(c.b, c.rb, c.t2));
  c.jn = c.j1 = c.j2 = c.jp = 0;
  c.gamma = 0;
  c.ks = c.kn;
  if (c.soft && c.depth > 0) {
    // Пружина k = 1/soft с критическим гашением: в покое толкает с силой k·depth (Катто, «Мягкие связи»).
    const k = 1 / c.soft, d = 2 * Math.sqrt(k * c.kn) + h * k;
    c.gamma = 1 / (h * d);
    c.ks = 1 / (1 / c.kn + c.gamma);
    c.target = (k * c.depth) / d;
    c.goal = 0;
    return;
  }
  const vn = relative(c, _v).dot(c.n);
  const bounce = vn < -BOUNCE_FROM ? -BOUNCE * vn : 0;
  const reaches = c.depth >= 0 || vn * h < c.depth;
  c.target = (reaches && bounce) || Math.min(c.depth, 0) / h;
  c.goal = Math.min(MAX_PUSH, (PUSH * Math.max(0, c.depth - SLOP)) / h);
}

// Касание гасит сближение сверх target, трение — скольжение, не сильнее FRICTION от прижатия
// в какую сторону ни скользи: толчок трения по обеим осям вместе — не длиннее этого.
function solve(c) {
  const vn = relative(c, _v).dot(c.n);
  const jn = Math.max(0, c.jn + (c.target - vn - c.gamma * c.jn) * c.ks);
  apply(c, _j.copy(c.n).multiplyScalar(jn - c.jn));
  c.jn = jn;
  relative(c, _v);
  let j1 = c.j1 - _v.dot(c.t1) * c.k1, j2 = c.j2 - _v.dot(c.t2) * c.k2;
  const most = FRICTION * c.jn, rub = Math.hypot(j1, j2);
  if (rub > most) {
    j1 *= most / rub;
    j2 *= most / rub;
  }
  apply(c, _j.copy(c.t1).multiplyScalar(j1 - c.j1).addScaledVector(c.t2, j2 - c.j2));
  c.j1 = j1;
  c.j2 = j2;
}

// Расталкивание зашедших друг в друга тел: только сдвиг, скорости от него не остаётся.
function shove(c) {
  if (!c.goal) return;
  const vn = relative(c, _v, true).dot(c.n);
  const jp = Math.max(0, c.jp + (c.goal - vn) * c.kn);
  apply(c, _j.copy(c.n).multiplyScalar(jp - c.jp), true);
  c.jp = jp;
}

// Касание за шаг h толкнуло тело a: сила — толчок за шаг, ложится на его капсулу (в осях тела), а на
// капсулу тела b — та же сила обратно.
function bear(c, h) {
  _j.copy(c.n).multiplyScalar(c.jn).addScaledVector(c.t1, c.j1).addScaledVector(c.t2, c.j2).divideScalar(h);
  load(c.a, c.ca, c.ra, _j);
  if (c.b) load(c.b, c.cb, c.rb, _j.negate());
}

function load(body, capsule, r, f) {
  _q.copy(body.quaternion).invert();
  _u.copy(f).applyQuaternion(_q);
  capsule.stepForce.add(_u);
  capsule.stepTorque.add(_v.copy(r).applyQuaternion(_q).cross(_u));
}

// Сдвинуть и повернуть тело на шаг h; лежащее катится всё медленнее; долго почти неподвижное засыпает.
function settle(b, h) {
  b.position.addScaledVector(b.velocity, h).addScaledVector(b.shove.velocity, h);
  const w = _w.copy(b.spin).add(b.shove.spin);
  _q.set(w.x, w.y, w.z, 0).multiply(b.quaternion);
  b.quaternion.set(
    b.quaternion.x + (_q.x * h) / 2, b.quaternion.y + (_q.y * h) / 2,
    b.quaternion.z + (_q.z * h) / 2, b.quaternion.w + (_q.w * h) / 2,
  ).normalize();
  b.shove.velocity.set(0, 0, 0);
  b.shove.spin.set(0, 0, 0);
  if (b.touching) b.spin.multiplyScalar(Math.exp(-ROLL * h));
  b.place();
  b.still = b.velocity.length() + b.spin.length() * b.reach < SLEEP_V ? b.still + h : 0;
  if (b.still > SLEEP_T) {
    b.asleep = true;
    b.velocity.set(0, 0, 0);
    b.spin.set(0, 0, 0);
  }
}
