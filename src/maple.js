import * as THREE from 'three';
import { BARK_TILE } from './bark.js';
import { random } from './random.js';
import { tiles } from './surface.js';
import { windUniforms, GUST_GLSL } from './wind.js';

// Клён ясенелистный (американский) — сорняк: растёт быстро и как попало. Ствол тянется к свету,
// теряет вершину, и лидером становится боковая ветка — так набираются изгибы и смещённая вершина,
// на месте старой вершины остаётся сухой пенёк. Почти у половины деревьев ствол раздваивается.
// Ветви супротивные: парами, пара повёрнута к прошлой на четверть оборота, многие почки не трогаются.
// Ветви поникают. Больше их со светлой стороны, куда клонится ствол.
//
// Дерево — скелет: дерево осей. У оси кривая центров с шагом STEP по длине дуги, в каждой точке
// касательная t и поперечная рамка n, b, перенесённая вдоль оси без кручения, и радиус r.
// Из скелета — кора одной трубкой, листва карточками на веточках, масса и инерция.
export const DENSITY = 750; // кг/м³ — сырая древесина клёна
export const STEP = 0.05;
const LEAF_SHARE = 7 / 22; // листья к ветвям по массе (Silvics: ветви 22%, листья 7% надземной массы)
const UP = new THREE.Vector3(0, 1, 0);

const rand = (a, b) => a + random() * (b - a);
const flat = (az) => new THREE.Vector3(Math.cos(az), 0, -Math.sin(az));
const wobble = (d, k) => d.add(new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(k)).normalize();

// Ось по опорным точкам: сглаженная кривая, разложенная с шагом STEP. radius(s, len) — радиус по длине дуги.
// joint — как ось сидит на родителе: twig (тонкая на толстом), collar (с воротником), codominant (равная,
// included — доля вросшей коры в развилке, по длине includedTo), trunk — сам ствол.
function makeAxis(ctrl, radius, { parent = null, attach = 0, joint = 'trunk', level = 0, dead = false, included = 0, includedTo = 0, profile = null }) {
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
function walk(from, dir, len, h, steer) {
  const ctrl = [from.clone()];
  const p = from.clone(), d = dir.clone();
  for (let s = h; s < len + h / 2; s += h) {
    steer(d, s / len);
    ctrl.push(p.addScaledVector(d, h).clone());
  }
  return ctrl;
}

// Ветви на оси parent: узлы через 0.35–0.6 м, на узле пара супротивных почек, каждая трогается с вероятностью chance(out).
function branch(parent, from, axes) {
  const level = parent.level + 1;
  let turn = random() * Math.PI;
  for (let s = from + rand(0.2, 0.5); s < parent.len - 0.3; s += level === 1 ? rand(0.35, 0.6) : rand(0.2, 0.35)) {
    turn += Math.PI / 2;
    const at = section(parent, s);
    for (const side of [0, Math.PI]) {
      const phi = turn + side + rand(-0.3, 0.3);
      const out = at.frame[0].clone().multiplyScalar(Math.cos(phi)).addScaledVector(at.frame[1], Math.sin(phi));
      if (random() > chance(parent, out, s)) continue;
      const el = level === 1 ? rand(0.6, 1.1) : rand(0.5, 1.0);
      const dir = at.tangent.clone().multiplyScalar(Math.cos(el)).addScaledVector(out, Math.sin(el)).normalize();
      const r0 = Math.min(at.r * (level === 1 ? rand(0.35, 0.65) : rand(0.35, 0.65)), level === 3 ? 0.012 : Infinity);
      const len = level === 1 ? rand(3, 6) * (1 - 0.6 * (s / parent.len)) : level === 2 ? rand(0.8, 2) * (1 - 0.4 * (s / parent.len)) : rand(0.3, 0.7);
      const droop = [0, 0.12, 0.15, 0.05][level];
      const ctrl = walk(at.center, dir, len, Math.min(0.3, len / 3), (d) => {
        wobble(d, 0.15).addScaledVector(UP, -droop).normalize();
      });
      const axis = makeAxis(ctrl, (q, l) => Math.max(0.004, r0 * (1 - q / l) ** 0.7), {
        parent, attach: s, level, joint: r0 / at.r < 0.35 ? 'twig' : 'collar',
      });
      axes.push(axis);
      if (level < 3) branch(axis, 0.3 * axis.len, axes);
    }
  }
}

// Какая доля почек на оси трогается: у ствола больше со светлой стороны, к концу ветви — меньше.
function chance(parent, out, s) {
  if (parent.level === 0) return 0.55 + 0.25 * out.clone().setY(0).normalize().dot(parent.light);
  return parent.level === 1 ? 0.6 : 0.65 * (1 - 0.4 * (s / parent.len));
}

// Ствол и всё, что на нём. shape — низ ствола (trunkShape): ниже zone ось ствола идёт точно по нему,
// выше — растёт сама. height — высота дерева.
export function growSkeleton(shape, zone, height) {
  const axes = [];
  const R = shape.radius * shape.scale(zone);
  const light = flat(shape.leanAz);
  const ctrl = [];
  for (let y = 0; y < zone; y += STEP) ctrl.push(shape.center(y).setY(y));
  // Ствол выше зоны: тянется к свету, всё слабее, и вверх; иногда теряет вершину — новый лидер уходит вбок,
  // старая вершина остаётся сухим пеньком.
  const stubs = [];
  let split = random() < 0.45 ? zone + rand(1.5, 4) : Infinity;
  const pull = rand(0.02, 0.1);
  const top = walk(shape.center(zone).setY(zone), shape.axis(zone), height - zone, 0.4, (d, f) => {
    // От зоны ствол уходит плавно, а не изломом: увод к свету и шатание набирают силу за первые метры.
    const ease = THREE.MathUtils.smoothstep(f, 0, 0.25);
    wobble(d, 0.06 * ease).addScaledVector(light, pull * ease * (1 - f)).addScaledVector(UP, 0.04).normalize();
    if (f > 0.2 && f < 0.85 && random() < 0.05) {
      stubs.push({ f, dir: d.clone() });
      const side = new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1)).normalize();
      d.addScaledVector(side, rand(0.4, 0.8)).normalize();
    }
  });
  ctrl.push(...top);
  const ground = (s, len) => (s < zone ? shape.radius * shape.scale(s) : 0);
  const trunkR = (s, len) => (s < zone ? ground(s, len) : Math.max(0.01, R * (1 - (s - zone) / (len - zone)) ** 1.2 * (s > split ? 0.8 : 1)));
  const trunk = makeAxis(ctrl, trunkR, {});
  // Сечение ствола: внизу — профиль trunkShape (по азимуту на местности), выше зоны за полтора метра круглеет.
  trunk.profile = (az, s) => {
    const [n, b] = section(trunk, s).frame;
    const world = Math.atan2(n.z * Math.cos(az) + b.z * Math.sin(az), n.x * Math.cos(az) + b.x * Math.sin(az));
    return THREE.MathUtils.lerp(shape.profile(world) / shape.radius, 1, THREE.MathUtils.clamp((s - zone) / 1.5, 0, 1));
  };
  trunk.light = light;
  axes.push(trunk);
  // Кривая ствола внизу идёт почти по вертикали, поэтому длина дуги до зоны — почти высота.
  const above = trunk.points.find((q) => q.p.y >= zone).s;
  // Кора ствола ложится так же, как на кубиках: по кругу — азимут на местности на радиус низа, вдоль — высота.
  trunk.bark = { radius: shape.radius, s: above, y: zone };

  if (split < Infinity) {
    // Второй лидер выходит из развилки. При узком угле в развилке зажимается кора.
    const s = above + (split - zone);
    const at = section(trunk, s);
    const side = new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1)).normalize();
    const angle = rand(0.3, 0.8);
    const dir = at.tangent.clone().multiplyScalar(Math.cos(angle)).addScaledVector(side, Math.sin(angle)).normalize();
    const len = (height - split) * rand(0.75, 0.95);
    const r0 = at.r * 0.8;
    const other = makeAxis(walk(at.center, dir, len, 0.4, (d, f) => wobble(d, 0.06).addScaledVector(UP, 0.05 * f).normalize()),
      (q, l) => Math.max(0.01, r0 * (1 - q / l) ** 0.75),
      { parent: trunk, attach: s, joint: 'codominant', included: angle < 0.55 ? rand(0.3, 0.8) : 0, includedTo: rand(0.2, 0.6) });
    other.light = light;
    axes.push(other);
    branch(other, 0.5, axes);
  }
  for (const { f, dir } of stubs) {
    const s = above + f * (height - zone);
    const at = section(trunk, s);
    const r0 = at.r * 0.8;
    axes.push(makeAxis(walk(at.center, dir, rand(0.15, 0.4), 0.1, () => {}), (q, l) => r0 * (1 - 0.3 * q / l),
      { parent: trunk, attach: s, joint: 'collar', level: 1, dead: true }));
  }
  branch(trunk, above + 0.3, axes);
  axes.forEach((a, i) => { a.id = i; });
  return { axes, trunk, zone };
}

// Масса, центр тяжести и тензор инерции (вокруг центра тяжести) оси со всем, что на ней растёт.
// Древесина — кусками по STEP; то, что сидит внутри родителя, и ствол ниже зоны (его считают кубики) не в счёт.
function wood(a, zone) {
  const inside = a.parent ? section(a.parent, a.attach).r : 0;
  const parts = [];
  for (let i = 0; i < a.points.length - 1; i++) {
    const q = a.points[i];
    if (q.s < inside || (a.joint === 'trunk' && q.p.y < zone)) continue;
    parts.push([DENSITY * Math.PI * q.r * q.r * (a.points[i + 1].s - q.s), q.p.clone().lerp(a.points[i + 1].p, 0.5)]);
  }
  return parts;
}

export function measure(axis, zone) {
  const parts = [];
  (function gather(a) {
    parts.push(...wood(a, zone));
    if (a.leaves.mass) parts.push([a.leaves.mass, a.leaves.center]);
    a.children.forEach(gather);
  })(axis);
  const mass = parts.reduce((m, [dm]) => m + dm, 0);
  const com = parts.reduce((c, [dm, p]) => c.addScaledVector(p, dm), new THREE.Vector3()).divideScalar(mass);
  const e = new Array(9).fill(0);
  for (const [dm, p] of parts) {
    const d = p.clone().sub(com), dd = d.lengthSq(), v = d.toArray();
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) e[3 * i + j] += dm * ((i === j ? dd : 0) - v[i] * v[j]);
  }
  return { mass, com, inertia: new THREE.Matrix3().fromArray(e) };
}

// Кора: каждая ось — одна трубка по своей кривой, в рамке оси, с профилем сечения. У оси с воротником
// трубка у основания раздута. Начало оси сидит на оси родителя, внутри него, — стык без щели.
// Текстура в метрах: по кругу — по среднему радиусу оси, вдоль — по длине дуги. Толстый конец оси
// (сломанная вершина, сухой пенёк) закрыт крышкой.
function barkGeometry(axes, from) {
  const pos = [], normal = [], uv = [], index = [];
  for (const a of axes) {
    const r0 = a.points[0].r;
    const sides = THREE.MathUtils.clamp(Math.ceil((2 * Math.PI * r0) / 0.03), 5, 32);
    const every = r0 < 0.02 ? 2 : 1;
    const rings = a.points.filter((q, i) => (i % every === 0 || i === a.points.length - 1) && !(a.joint === 'trunk' && q.p.y < from));
    const mean = rings.reduce((m, q) => m + q.r, 0) / rings.length;
    const start = pos.length / 3;
    rings.forEach((q, k) => {
      const collar = a.joint === 'collar' ? 1 + 0.35 * Math.exp(-q.s / (2 * r0)) : 1;
      const world = (az) => Math.atan2(q.n.z * Math.cos(az) + q.b.z * Math.sin(az), q.n.x * Math.cos(az) + q.b.x * Math.sin(az));
      const turn = Math.sign(Math.sin(world(0.1) - world(0)));
      for (let j = 0; j <= sides; j++) {
        const az = (j / sides) * 2 * Math.PI;
        const out = q.n.clone().multiplyScalar(Math.cos(az)).addScaledVector(q.b, Math.sin(az));
        const r = q.r * collar * (a.profile ? a.profile(az, q.s) : 1);
        pos.push(...q.p.clone().addScaledVector(out, r).toArray());
        normal.push(...out.toArray());
        if (a.bark) uv.push(((world(0) + turn * az) * a.bark.radius) / BARK_TILE, (q.s - a.bark.s + a.bark.y) / BARK_TILE);
        else uv.push((az * mean) / BARK_TILE, q.s / BARK_TILE);
        if (k && j < sides) {
          const c = start + k * (sides + 1) + j, p = c - (sides + 1);
          index.push(p, p + 1, c, p + 1, c + 1, c);
        }
      }
    });
    const end = rings[rings.length - 1];
    if (end.r > 0.012) {
      const c = pos.length / 3, last = c - (sides + 1);
      pos.push(...end.p.toArray());
      normal.push(...end.t.toArray());
      uv.push(0, 0);
      for (let j = 0; j < sides; j++) index.push(last + j, last + j + 1, c);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  return geometry;
}

// Листва — карточки из атласа maple-leaves.png (собирает tools/tufts.py): веточка с листьями, срез
// веточки по центру нижнего края. Сидят на концевых веточках, крест-накрест, смотрят наружу и чуть вниз.
// Нормаль — от середины кроны наружу: крона освещена как одно облако, а не как горсть плоскостей.
// Ветер треплет карточку сильнее к её верхнему краю (lift — от 0 у среза до 1 вверху).
const [leafTexture] = tiles(['assets/textures/maple-leaves.png']);
const leafMaterial = new THREE.MeshLambertMaterial({ map: leafTexture, alphaTest: 0.5 });
leafMaterial.onBeforeCompile = (shader) => {
  Object.assign(shader.uniforms, windUniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
      attribute float lift;
      ${GUST_GLSL}`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      float flutter = (0.02 + windMax * 0.3 * gust(transformed.xz)) * sin(7.0 * windTime + dot(transformed, vec3(5.3, 3.7, 4.1)));
      transformed.xz += windDir * flutter * lift;`);
};
const LEAVES = await (await fetch('assets/textures/maple-leaves.json')).json();

function leafCards(axes, trunk) {
  const { grid: [cols, rows], aspect, heights } = LEAVES;
  const cards = [];
  for (const a of axes) {
    if (a.dead || a.level < 2) continue;
    for (let s = 0.3 * a.len; s <= a.len; s += rand(0.08, 0.16)) {
      const at = section(a, s);
      const outward = at.center.clone().sub(section(trunk, Math.min(trunk.len, at.center.y)).center).setY(0).normalize();
      const up = at.tangent.clone().lerp(outward, 0.3).addScaledVector(UP, -0.2).normalize();
      const cell = Math.floor(random() * heights.length), [low, high] = heights[cell];
      cards.push({ axis: a, at: at.center, up, cell, h: rand(low, high), turn: random() * Math.PI });
    }
  }
  const pos = [], normal = [], uv = [], lift = [], index = [];
  const center = cards.reduce((c, k) => c.add(k.at), new THREE.Vector3()).divideScalar(cards.length);
  for (const { at, up, cell, h, turn } of cards) {
    const u0 = (cell % cols) / cols, v0 = 1 - (Math.floor(cell / cols) + 1) / rows, u1 = u0 + 1 / cols, v1 = v0 + 1 / rows;
    const side0 = new THREE.Vector3().crossVectors(up, Math.abs(up.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : UP).normalize();
    for (const a of [turn, turn + Math.PI / 2]) {
      const side = side0.clone().applyAxisAngle(up, a).multiplyScalar((h * aspect) / 2);
      const k = pos.length / 3;
      const corners = [at.clone().sub(side), at.clone().add(side), at.clone().add(side).addScaledVector(up, h), at.clone().sub(side).addScaledVector(up, h)];
      for (const c of corners) {
        pos.push(...c.toArray());
        normal.push(...c.clone().sub(center).normalize().addScaledVector(UP, 1).normalize().toArray());
      }
      uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
      lift.push(0, 0, 1, 1);
      index.push(k, k + 1, k + 2, k, k + 2, k + 3, k, k + 2, k + 1, k, k + 3, k + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('lift', new THREE.Float32BufferAttribute(lift, 1));
  geometry.setIndex(index);
  return { mesh: new THREE.Mesh(geometry, leafMaterial), cards };
}

// Клён выше зоны пиления: кора от from (чуть ниже зоны, чтобы на стыке с кубиками не было щели) и листва.
// Масса листьев — доля LEAF_SHARE от массы ветвей — поровну на карточки, к осям, на которых они сидят.
// Узлы ствола (пустышки 'trunk' с радиусом) — по ним падающее дерево ложится на землю.
export function growMaple(shape, zone, height, bark, from) {
  const skeleton = growSkeleton(shape, zone, height);
  const { axes, trunk } = skeleton;
  const tree = new THREE.Group();
  tree.add(new THREE.Mesh(barkGeometry(axes, from), bark));
  const { mesh, cards } = leafCards(axes, trunk);
  tree.add(mesh);
  const branches = axes.filter((a) => a.level > 0).reduce((m, a) => wood(a, zone).reduce((w, [dm]) => w + dm, m), 0);
  for (const { axis, at, up, h } of cards) {
    axis.leaves.mass += (LEAF_SHARE * branches) / cards.length;
    axis.leaves.center.addScaledVector(at.clone().addScaledVector(up, h / 2), 1);
    axis.leaves.count = (axis.leaves.count ?? 0) + 1;
  }
  for (const a of axes) if (a.leaves.count) a.leaves.center.divideScalar(a.leaves.count);
  for (const a of axes.filter((x) => x.joint === 'trunk' || x.joint === 'codominant')) {
    for (let s = 0; s <= a.len; s += 0.5) {
      const at = section(a, s);
      if (at.center.y < zone) continue;
      const knot = new THREE.Object3D();
      knot.name = 'trunk';
      knot.userData.r = at.r;
      knot.position.copy(at.center);
      tree.add(knot);
    }
  }
  return { tree, skeleton, ...measure(trunk, zone) };
}
