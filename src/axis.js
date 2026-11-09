import * as THREE from 'three';

// Скелет дерева — дерево осей. У оси кривая центров с шагом STEP по длине дуги, в каждой точке касательная t
// и поперечная рамка n, b, перенесённая вдоль оси без кручения, и радиус r. Общий у клёна (maple.js) и берёзы (birch.js).
export const STEP = 0.05;

// Ось по опорным точкам: сглаженная кривая, разложенная с шагом STEP. radius(s, len) — радиус по длине дуги.
// joint — как ось сидит на родителе: twig (тонкая на толстом), collar (с воротником), codominant (равная,
// included — доля вросшей коры в развилке, по длине includedTo), trunk — сам ствол.
export function makeAxis(ctrl, radius, { parent = null, attach = 0, joint = 'trunk', level = 0, dead = false, included = 0, includedTo = 0, profile = null }) {
  const curve = new THREE.CatmullRomCurve3(ctrl, false, 'centripetal');
  const len = curve.getLength();
  const count = Math.max(2, Math.ceil(len / STEP)) + 1;
  const points = [];
  let n = new THREE.Vector3(1, 0, 0);
  for (let i = 0; i < count; i++) {
    const u = i / (count - 1);
    const t = curve.getTangentAt(u);
    if (i === 0 && Math.abs(t.x) > 0.9) n.set(0, 0, 1);
    n.addScaledVector(t, -n.dot(t)).normalize();
    points.push({ s: u * len, p: curve.getPointAt(u), t, n: n.clone(), b: t.clone().cross(n), r: radius(u * len, len) });
  }
  const axis = { id: 0, parent, attach, joint, level, dead, included, includedTo, len, points, profile, leaves: { mass: 0, center: new THREE.Vector3() }, children: [] };
  parent?.children.push(axis);
  return axis;
}

// Сечение оси на длине дуги s: центр, касательная, рамка, радиус и профиль по азимуту в этой рамке.
export function section(axis, s) {
  const { points } = axis;
  const i = THREE.MathUtils.clamp(Math.floor(s / (axis.len / (points.length - 1))), 0, points.length - 2);
  const a = points[i], b = points[i + 1];
  const k = THREE.MathUtils.clamp((s - a.s) / (b.s - a.s), 0, 1);
  return {
    center: a.p.clone().lerp(b.p, k), tangent: a.t.clone().lerp(b.t, k).normalize(),
    frame: [a.n.clone().lerp(b.n, k).normalize(), a.b.clone().lerp(b.b, k).normalize()],
    r: THREE.MathUtils.lerp(a.r, b.r, k), profile: (az) => (axis.profile ? axis.profile(az, s) : 1),
  };
}

// Опорные точки оси шагом h: на каждом шаге steer(d, доля длины) подправляет направление.
export function walk(from, dir, len, h, steer) {
  const ctrl = [from.clone()];
  const p = from.clone(), d = dir.clone();
  for (let s = h; s < len + h / 2; s += h) {
    steer(d, s / len);
    ctrl.push(p.addScaledVector(d, h).clone());
  }
  return ctrl;
}
