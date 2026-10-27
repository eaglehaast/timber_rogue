import * as THREE from 'three';

// Твёрдые тела: отпилы, куски пня. У тела свои вес, центр тяжести и момент инерции, а форма — капсулы:
// отрезок с радиусом (у шара отрезок нулевой). Кусок из кубиков — шары, вписанные в его древесину.
// Тела падают и бьются о землю, о кубики пня и упавшего ствола и друг о друга. Где капсулы сошлись —
// касание: толчок (импульс) гасит сближение, даёт отскок, а трение — гасит скольжение.
// Касание ищем и чуть заранее, на путь тела за шаг: так быстрое тело не проскочит сквозь тонкое.
// Улёгшееся тело засыпает и не считается, пока его не толкнут или не тронут то, на чём оно лежит.
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
const SLEEP_V = 0.05, SLEEP_W = 0.2, SLEEP_T = 0.6; // медленнее этого дольше SLEEP_T — уснуло

const UP = new THREE.Vector3(0, 1, 0);
const _u = new THREE.Vector3(), _v = new THREE.Vector3(), _w = new THREE.Vector3(), _j = new THREE.Vector3();
const _p = new THREE.Vector3(), _a = new THREE.Vector3(), _e = new THREE.Vector3();
const _c1 = new THREE.Vector3(), _c2 = new THREE.Vector3(), _q = new THREE.Quaternion();
const _m = new THREE.Matrix4(), _r = new THREE.Matrix3();

export class Body {
  // object — что двигаем: его начало — центр тяжести тела. mass — кг, inertia — момент инерции вокруг
  // центра тяжести в осях тела, position и quaternion — где центр тяжести и как тело повёрнуто
  // в осях мира, capsules — форма в осях тела: [{ a, b, r }].
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
    this.capsules = capsules.map(({ a, b, r }) => ({
      a, b, r, ball: a.equals(b), A: new THREE.Vector3(), B: new THREE.Vector3(), low: new THREE.Vector3(), high: new THREE.Vector3(),
    }));
    this.reach = Math.max(...capsules.map((c) => Math.max(c.a.length(), c.b.length()) + c.r));
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

// Тела у одного дерева, в осях root. Земля — плоскость y = 0. Кубики (пень, упавший комель) — solid
// с press(p, r, reach), рамкой box и номером version, который растёт, когда кубики выпиливают; их двигает
// вместе с object: пень стоит с делянкой, упавший верх летит с деревом и толкает тела своей скоростью.
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

  fix(object, solids) {
    const matrix = this.frame(object, new THREE.Matrix4());
    this.sets.push({
      object, solids, matrix, inverse: matrix.clone().invert(), turn: new THREE.Matrix3().setFromMatrix4(matrix),
      back: new THREE.Matrix4(), moved: false, dt: 0, seen: solids.map((s) => s.version),
    });
  }

  // Положение object в осях root.
  frame(object, out) {
    if (object === this.root) return out.identity();
    object.updateWorldMatrix(true, false);
    return out.copy(this.root.matrixWorld).invert().multiply(object.matrixWorld);
  }

  step(dt) {
    let touched = false;
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
      }
      set.solids.forEach((s, i) => {
        if (s.version === set.seen[i]) return;
        set.seen[i] = s.version;
        touched = true;
      });
      touched ||= set.moved;
    }
    if (touched) this.bodies.forEach((b) => b.wake());
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
        ground(b, c.A, c.r, contacts);
        if (!c.ball) ground(b, c.B, c.r, contacts);
        for (const set of this.sets) for (const solid of set.solids) press(b, c, set, solid, contacts);
      }
      for (let k = i + 1; k < awake.length; k++) pair(b, awake[k], contacts);
      for (const o of this.bodies) if (o.asleep) pair(b, o, contacts);
    });
    for (const c of contacts) prepare(c, h);
    for (let pass = 0; pass < PASSES; pass++) for (const c of contacts) solve(c);
    for (let pass = 0; pass < PASSES; pass++) for (const c of contacts) shove(c);
    for (const b of awake) settle(b, h);
  }
}

// Рамки капсул с запасом на путь за шаг.
function bound(b) {
  for (const c of b.capsules) {
    c.low.copy(c.A).min(c.B).subScalar(c.r + b.sweep);
    c.high.copy(c.A).max(c.B).addScalar(c.r + b.sweep);
  }
}

const overlap = (low, high, box) => low.x <= box.high.x && box.low.x <= high.x && low.y <= box.high.y
  && box.low.y <= high.y && low.z <= box.high.z && box.low.z <= high.z;

// Касание тела a с телом b (или с неподвижным, если b — null) в точке p; нормаль n — от b к a, depth —
// на сколько зашли друг в друга (меньше нуля — сколько ещё до касания). surface — скорость того, обо что бьёмся.
function contact(a, b, p, n, depth, surface, contacts) {
  if (depth > -SLOP) {
    a.touching = true;
    if (b) b.touching = true;
  }
  contacts.push({
    a, b, p: p.clone(), n: n.clone(), depth, surface, ra: new THREE.Vector3(), rb: new THREE.Vector3(),
    t1: new THREE.Vector3(), t2: new THREE.Vector3(),
  });
}

// Конец капсулы у земли.
function ground(b, end, r, contacts) {
  const depth = r - end.y;
  if (depth < -b.sweep) return;
  contact(b, null, _p.copy(end).addScaledVector(UP, depth / 2 - r), UP, depth, null, contacts);
}

// Тела a и o: каждая пара их капсул, чьи рамки пересеклись. Спящее o держит, как неподвижное,
// а если в него ударили — просыпается.
function pair(a, o, contacts) {
  if (a.position.distanceTo(o.position) > a.reach + o.reach + a.sweep + o.sweep) return;
  const b = o.asleep ? null : o;
  for (const c of a.capsules) {
    for (const d of o.capsules) {
      if (!overlap(c.low, c.high, d)) continue;
      if (meet(a, c, b, d, a.sweep + o.sweep, contacts) && o.asleep && a.velocity.length() > 2 * SLEEP_V) o.wake();
    }
  }
}

// Две капсулы: ближайшие точки их отрезков ближе суммы радиусов (с запасом margin) — касание.
function meet(a, c, b, d, margin, contacts) {
  const dist2 = closest(c.A, c.B, d.A, d.B, _c1, _c2);
  const reach = c.r + d.r + margin;
  if (dist2 >= reach * reach) return false;
  const dist = Math.sqrt(dist2);
  const n = dist > 1e-9 ? _u.copy(_c1).sub(_c2).divideScalar(dist) : _u.copy(UP);
  const depth = c.r + d.r - dist;
  contact(a, b, _p.copy(_c1).addScaledVector(n, depth / 2 - c.r), n, depth, null, contacts);
  return true;
}

// Капсула и кубики: шарами вдоль её отрезка, через радиус друг от друга. Кубики спрашиваем в их осях.
function press(b, c, set, solid, contacts) {
  const a = _a.copy(c.A).applyMatrix4(set.inverse), e = _e.copy(c.B).applyMatrix4(set.inverse);
  const pad = c.r + b.sweep;
  if (!overlap(_w.copy(a).min(e).subScalar(pad), _j.copy(a).max(e).addScalar(pad), solid.box)) return;
  const count = c.ball ? 1 : Math.ceil(a.distanceTo(e) / c.r) + 1;
  for (let i = 0; i < count; i++) {
    const t = count > 1 ? i / (count - 1) : 0;
    const hit = solid.press(_v.copy(a).lerp(e, t), c.r, b.sweep);
    if (!hit) continue;
    const n = _u.copy(hit.normal).applyMatrix3(set.turn).normalize();
    const at = _p.copy(c.A).lerp(c.B, t).addScaledVector(n, hit.depth / 2 - c.r);
    const surface = set.moved ? at.clone().sub(_v.copy(at).applyMatrix4(set.back)).divideScalar(set.dt) : null;
    contact(b, null, at, n, hit.depth, surface, contacts);
  }
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
function give(body, r, d) {
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
  c.kn = 1 / (give(c.a, c.ra, c.n) + give(c.b, c.rb, c.n));
  c.k1 = 1 / (give(c.a, c.ra, c.t1) + give(c.b, c.rb, c.t1));
  c.k2 = 1 / (give(c.a, c.ra, c.t2) + give(c.b, c.rb, c.t2));
  const vn = relative(c, _v).dot(c.n);
  const bounce = vn < -BOUNCE_FROM ? -BOUNCE * vn : 0;
  const reaches = c.depth >= 0 || vn * h < c.depth;
  c.target = (reaches && bounce) || Math.min(c.depth, 0) / h;
  c.goal = Math.min(MAX_PUSH, (PUSH * Math.max(0, c.depth - SLOP)) / h);
  c.jn = c.j1 = c.j2 = c.jp = 0;
}

// Касание гасит сближение сверх target, трение — скольжение, не сильнее FRICTION от прижатия
// в какую сторону ни скользи: толчок трения по обеим осям вместе — не длиннее этого.
function solve(c) {
  const vn = relative(c, _v).dot(c.n);
  const jn = Math.max(0, c.jn + (c.target - vn) * c.kn);
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
  b.still = b.velocity.length() < SLEEP_V && b.spin.length() < SLEEP_W ? b.still + h : 0;
  if (b.still > SLEEP_T) {
    b.asleep = true;
    b.velocity.set(0, 0, 0);
    b.spin.set(0, 0, 0);
  }
}
