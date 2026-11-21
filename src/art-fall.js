import * as THREE from 'three';
import { Limb } from './limbs.js';
import { pointAt } from './maple.js';
import { generator } from './random.js';

const UP = new THREE.Vector3(0, 1, 0);
const smooth = THREE.MathUtils.smoothstep;
const clamp = THREE.MathUtils.clamp;
const BRANCHES = 3;

// Разбираем несколько крупных боковых ветвей ещё при посадке. На ударе меняется только
// положение готовых рисунков. Игра по-прежнему пилит их по исходным осям и волокнам.
export function prepareCrown(crown, materials) {
  const whole = new Limb(crown.parts, crown.cards, materials);
  const choices = crown.parts.filter(({ axis }) => axis.level === 1 && !axis.dead && axis.len > 0.65)
    .sort((a, b) => b.axis.len - a.axis.len);
  const roots = [];
  for (const { axis } of choices) {
    if (roots.every(a => a.points[0].p.distanceToSquared(axis.points[0].p) > 0.8)) roots.push(axis);
    if (roots.length === BRANCHES) break;
  }
  const breaks = roots.map(axis => {
    const s = Math.min(0.2, axis.len * 0.12);
    return { limb: whole.split(axis, s).dress(), y: axis.points[0].p.y, crownBranch: true };
  });
  return { limb: whole.dress(), breaks };
}

// Несколько толстых участков для лежащего тела. Точная геометрия для пилы остаётся у Limb.
export function coarseCapsules(limb) {
  const parts = [...limb.parts].sort((a, b) => a.axis.level - b.axis.level || (b.to - b.from) - (a.to - a.from));
  const capsules = [];
  for (const part of parts.slice(0, 4)) {
    const { axis, from, to } = part;
    const n = axis.level === 0 ? 6 : 2;
    let a = pointAt(axis, from);
    for (let i = 1; i <= n; i++) {
      const b = pointAt(axis, from + (to - from) * i / n);
      capsules.push({ a: a.p, b: b.p, r: (a.r + b.r) / 2, axis, from: a.s, to: b.s });
      a = b;
    }
  }
  return capsules;
}

// В мировых координатах. query вызывается один раз для окрестности падения. У соседа
// или постройки достаточно box (Box3), root владельца и необязательного onHit(point). Цепочки узлов
// принадлежат разным стволам и не соединяются между собой поперёк развилки.
export function planFall(origin, direction, radius, chains, floor, query = () => [], owner) {
  const axis = UP.clone().cross(direction).normalize();
  const reach = Math.max(...chains.flat().map(k => k.p.distanceTo(origin) + k.r)) + 2 * radius + 1;
  const bounds = new THREE.Box3().setFromCenterAndSize(origin, new THREE.Vector3().setScalar(2 * reach));
  const obstacles = query(bounds, owner).filter(o => (!owner || o.root !== owner) && bounds.intersectsBox(o.box));
  const advance = 2 * radius + 0.28;
  const heel = new THREE.Vector3(), q = new THREE.Quaternion(), triangle = new THREE.Triangle(), box = new THREE.Box3();
  function pose(angle, at, orientation) {
    const slide = smooth(angle, 0.38, 1.43);
    at.copy(origin).addScaledVector(direction, slide * advance);
    at.y = THREE.MathUtils.lerp(origin.y, floor(at.x, at.z) + radius + 0.045, smooth(angle, 0.62, 1.53));
    orientation.setFromAxisAngle(axis, angle);
  }
  const relative = chains.map(chain => chain.map(k => k.p.clone().sub(origin)));
  const buffer = () => chains.map(chain => chain.map(() => new THREE.Vector3()));
  function write(angle, out) {
    pose(angle, heel, q);
    relative.forEach((chain, j) => chain.forEach((p, i) => out[j][i].copy(p).applyQuaternion(q).add(heel)));
  }
  const before = buffer(), after = buffer();
  function contact(left, right) {
    write(left, before);
    write(right, after);
    for (let j = 0; j < chains.length; j++) {
      for (let i = 1; i < chains[j].length; i++) {
        const a = before[j][i - 1], b = before[j][i], c = after[j][i], d = after[j][i - 1];
        const r = chains[j][i].r;
        for (const obstacle of obstacles) {
          box.copy(obstacle.box).expandByScalar(Math.max(r, chains[j][i - 1].r));
          if (box.intersectsTriangle(triangle.set(a, b, c)) || box.intersectsTriangle(triangle.set(a, c, d))) {
            const line = new THREE.Line3(d, c);
            const point = obstacle.box.clampPoint(line.closestPointToPoint(obstacle.box.getCenter(new THREE.Vector3()), true, new THREE.Vector3()), new THREE.Vector3());
            return { obstacle, point };
          }
        }
        if (c.y - r <= floor(c.x, c.z)) return { point: c.clone().setY(floor(c.x, c.z)) };
      }
    }
    return null;
  }
  const step = Math.PI / 48, limit = Math.PI * 0.72;
  let angle = limit, hit = null;
  for (let left = 0; left < limit; left += step) {
    let hi = Math.min(limit, left + step);
    hit = contact(left, hi);
    if (!hit) continue;
    let lo = left;
    for (let i = 0; i < 9; i++) {
      const mid = (lo + hi) / 2, earlier = contact(lo, mid);
      if (earlier) { hi = mid; hit = earlier; } else lo = mid;
    }
    angle = lo;
    break;
  }
  return { angle, hit, pose };
}

function trunkChains(tree, fall) {
  tree.upper.updateWorldMatrix(true, true);
  const chains = [];
  for (const stem of tree.stems) {
    if (!(tree.body & (1 << stem.crown.stem))) continue;
    for (const { axis, from, to } of stem.crown.parts) {
      if (axis.level !== 0) continue;
      const chain = [];
      if (axis.stem !== undefined) chain.push({ p: fall.pivot.getWorldPosition(new THREE.Vector3()), r: tree.voxels.radius });
      for (let i = 0; i <= 6; i++) {
        const k = pointAt(axis, from + (to - from) * i / 6);
        chain.push({ p: stem.crown.group.localToWorld(k.p.clone()), r: k.r });
      }
      chains.push(chain);
    }
  }
  return chains;
}

// Сук вращается вокруг середины своей древесины. Его конечную позу с опорой на землю
// вычисляем один раз. Между ударом и покоем только короткая дуга, без физического тела.
function throwBranch(limb, tree, direction, index, floor, rnd) {
  const group = new THREE.Group();
  tree.root.add(group);
  const at = limb.group.localToWorld(limb.weight.com.clone());
  group.position.copy(tree.root.worldToLocal(at.clone()));
  group.quaternion.copy(limb.group.getWorldQuaternion(new THREE.Quaternion()));
  group.attach(limb.group);
  tree.world.unfix(limb.set);
  const start = group.position.clone(), startQ = group.quaternion.clone();
  const side = new THREE.Vector3(-direction.z, 0, direction.x).multiplyScalar(index % 2 ? -1 : 1);
  const end = start.clone().addScaledVector(side, 0.75 + rnd() * 1.55).addScaledVector(direction, 0.35 + rnd() * 0.8);
  const part = limb.parts[0], p = pointAt(part.axis, part.from), tip = pointAt(part.axis, part.to);
  const along = tip.p.clone().sub(p.p).normalize().applyQuaternion(startQ);
  const flat = along.clone().setY(0).addScaledVector(side, 0.42).normalize();
  const endQ = new THREE.Quaternion().setFromUnitVectors(along, flat).multiply(startQ);
  const v = new THREE.Vector3();
  end.y = -Infinity;
  for (const c of coarseCapsules(limb)) for (const point of [c.a, c.b]) {
    v.copy(point).sub(limb.weight.com).applyQuaternion(endQ);
    end.y = Math.max(end.y, floor(tree.base.x + end.x + v.x, tree.base.z + end.z + v.z) - tree.base.y + c.r - v.y);
  }
  const duration = 0.62 + rnd() * 0.28, hop = 0.24 + rnd() * 0.35;
  return {
    group, limb,
    move(time) {
      const t = clamp(time / duration, 0, 1);
      group.position.lerpVectors(start, end, 1 - (1 - t) ** 2);
      group.position.y = THREE.MathUtils.lerp(start.y, end.y, t * t) + 4 * hop * t * (1 - t);
      group.quaternion.slerpQuaternions(startQ, endQ, smooth(t, 0, 1));
      return t === 1;
    },
  };
}

export function animateFall(tree, fall, { floor, query, hit, effects, park }) {
  const pivot = fall.pivot, origin = pivot.getWorldPosition(new THREE.Vector3()), direction = fall.u;
  const plan = planFall(origin, direction, tree.voxels.radius, trunkChains(tree, fall), floor, query, tree.root);
  const rnd = generator(tree.seed ^ 1871);
  const at = new THREE.Vector3(), rotation = new THREE.Quaternion();
  const duration = 0.45 + 1.65 * Math.sqrt(plan.angle / (Math.PI / 2));
  const thrown = [];
  let age = 0, struck = false;
  function impact() {
    struck = true;
    const candidates = tree.stems.flatMap(s => s.lows.filter(l => l.crownBranch && (tree.body & (1 << s.crown.stem)))
      .map(l => ({ stem: s, low: l }))).filter(({ low }) => low.limb.weight.mass > 0 && low.limb.parts.length);
    candidates.sort((a, b) => b.low.limb.weight.mass - a.low.limb.weight.mass);
    const branches = candidates.slice(0, BRANCHES);
    const crowns = tree.stems.filter(s => tree.body & (1 << s.crown.stem)).map(s => s.crown);
    const point = plan.hit?.point ?? at;
    effects.burst([...branches.map(x => x.low.limb), ...crowns], point, direction, tree.seed, floor);
    for (const { stem, low } of branches) {
      stem.lows.splice(stem.lows.indexOf(low), 1);
      delete low.limb.stem;
      thrown.push(throwBranch(low.limb, tree, direction, thrown.length, floor, rnd));
    }
    plan.hit?.obstacle?.onHit?.(point.clone());
    hit(thrown.length);
  }
  function place(angle) {
    fall.angle = angle;
    plan.pose(angle, at, rotation);
    pivot.position.copy(at).sub(tree.base);
    pivot.quaternion.copy(rotation);
  }
  return {
    step(dt) {
      age += dt;
      const t = Math.min(1, age / duration);
      place(plan.angle * (0.09 * t + 0.91 * t ** 2.35));
      if (t < 1) return false;
      if (!struck) impact();
      const elapsed = age - duration;
      const settle = Math.min(1, elapsed / 0.56);
      place(plan.angle - Math.min(plan.angle * 0.12, 0.054) * Math.sin(Math.PI * settle) * (1 - settle) ** 2);
      let landed = true;
      for (const piece of thrown) if (!piece.move(elapsed)) landed = false;
      return settle === 1 && landed;
    },
    // Сначала снимаются опоры стоящей кроны и укладывается ствол. Только после
    // этого регистрируем спящие сучья: исчезновение опор уже не разбудит их.
    finish() {
      for (const piece of thrown) {
        park(piece.limb);
        piece.group.removeFromParent();
      }
      thrown.length = 0;
    },
  };
}
