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
      const out = around(at, turn + side + rand(-0.3, 0.3));
      if (random() > chance(parent, out, s)) continue;
      bud(parent, s, out, axes);
    }
  }
}

// Направление поперёк оси в сечении at под углом phi в его рамке.
const around = (at, phi) => at.frame[0].clone().multiplyScalar(Math.cos(phi)).addScaledVector(at.frame[1], Math.sin(phi));

// Ветвь из почки на оси parent на длине дуги s, наружу в сторону out, со всем, что на ней вырастет.
function bud(parent, s, out, axes) {
  const level = parent.level + 1;
  const at = section(parent, s);
  const el = level === 1 ? rand(0.6, 1.1) : rand(0.5, 1.0);
  const dir = at.tangent.clone().multiplyScalar(Math.cos(el)).addScaledVector(out, Math.sin(el)).normalize();
  const r0 = Math.min(at.r * rand(0.35, 0.65), level === 3 ? 0.012 : Infinity);
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
  return axis;
}

// Низ ствола, в зоне пиления, до длины дуги above: клён и здесь не голый. Редкие нижние ветви и волчки — пучки тонких побегов из спящих почек, торчащие вверх: чаще у земли,
// где ствол раздаётся. Каждая такая ветвь помечена low: при валке она уходит с тем, на чём растёт.
function low(trunk, above, axes) {
  for (let n = Math.floor(rand(0, 3.5)); n > 0; n--) {
    const s = rand(0.9, above - 0.2);
    bud(trunk, s, around(section(trunk, s), random() * Math.PI * 2), axes).low = true;
  }
  for (let n = Math.floor(rand(0, 3.5)); n > 0; n--) {
    const s0 = 0.1 + (above - 0.3) * random() ** 2;
    const phi = random() * Math.PI * 2;
    for (let k = 2 + Math.floor(random() * 4); k > 0; k--) {
      const s = s0 + rand(-0.05, 0.05);
      const at = section(trunk, s);
      const el = rand(0.25, 0.6);
      const dir = at.tangent.clone().multiplyScalar(Math.cos(el)).addScaledVector(around(at, phi + rand(-0.5, 0.5)), Math.sin(el)).normalize();
      const r0 = rand(0.005, 0.014), len = rand(0.4, 1.4);
      const shoot = makeAxis(walk(at.center, dir, len, len / 3, (d) => wobble(d, 0.12).addScaledVector(UP, 0.05).normalize()),
        (q, l) => Math.max(0.003, r0 * (1 - q / l) ** 0.7), { parent: trunk, attach: s, level: 2, joint: 'twig' });
      shoot.low = true;
      axes.push(shoot);
      branch(shoot, 0.4 * len, axes);
    }
  }
}

// Какая доля почек на оси трогается: у ствола больше со светлой стороны, к концу ветви — меньше.
function chance(parent, out, s) {
  if (parent.level === 0) return 0.55 + 0.25 * out.clone().setY(0).normalize().dot(parent.light);
  return parent.level === 1 ? 0.6 : 0.65 * (1 - 0.4 * (s / parent.len));
}

// Лидер — ствол дерева. stem — его низ (ствол формы trunkShape): ниже zone ось идёт точно по нему,
// выше растёт сама до высоты height: тянется к свету, всё слабее, и вверх; иногда теряет вершину —
// новый лидер уходит вбок, старая вершина остаётся сухим пеньком. split — где он раздваивается выше зоны.
function leader(stem, index, zone, height, split, axes, parent = null) {
  const R = stem.radius * stem.scale(zone);
  const light = flat(stem.leanAz);
  const ctrl = [];
  for (let y = 0; y < zone; y += STEP) ctrl.push(stem.center(y).setY(y));
  const stubs = [];
  const pull = rand(0.02, 0.1);
  const top = walk(stem.center(zone).setY(zone), stem.axis(zone), height - zone, 0.4, (d, f) => {
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
  const ground = (s) => stem.radius * stem.scale(s);
  const trunkR = (s, len) => (s < zone ? ground(s) : Math.max(0.01, R * (1 - (s - zone) / (len - zone)) ** 1.2 * (s > split ? 0.8 : 1)));
  // Второй ствол двойного дерева растёт от общего комля: сидит на первом у земли, как равный.
  const trunk = makeAxis(ctrl, trunkR, parent ? { parent, joint: 'codominant' } : {});
  trunk.stem = index;
  // Сечение ствола: внизу — профиль ствола формы (по азимуту на местности), выше зоны за полтора метра круглеет.
  trunk.profile = (az, s) => {
    const [n, b] = section(trunk, s).frame;
    const world = Math.atan2(n.z * Math.cos(az) + b.z * Math.sin(az), n.x * Math.cos(az) + b.x * Math.sin(az));
    return THREE.MathUtils.lerp(stem.profile(world) / stem.radius, 1, THREE.MathUtils.clamp((s - zone) / 1.5, 0, 1));
  };
  trunk.light = light;
  axes.push(trunk);
  // Кривая ствола внизу идёт почти по вертикали, поэтому длина дуги до зоны — почти высота.
  const above = trunk.points.find((q) => q.p.y >= zone).s;
  // Кора ствола ложится так же, как на кубиках: по кругу — азимут на местности на радиус низа, вдоль — высота.
  trunk.bark = { radius: stem.radius, s: above, y: zone };
  low(trunk, above, axes);
  for (const { f, dir } of stubs) {
    const s = above + f * (height - zone);
    const at = section(trunk, s);
    const r0 = at.r * 0.8;
    axes.push(makeAxis(walk(at.center, dir, rand(0.15, 0.4), 0.1, () => {}), (q, l) => r0 * (1 - 0.3 * q / l),
      { parent: trunk, attach: s, joint: 'collar', level: 1, dead: true }));
  }
  return { trunk, above };
}

// Ствол и всё, что на нём. shape — низ дерева (trunkShape), один или два ствола: каждый — свой лидер.
// height — высота дерева; второй ствол двойного чуть ниже первого. У одиночного ствол раздваивается
// выше зоны почти у половины деревьев.
export function growSkeleton(shape, zone, height) {
  const axes = [];
  const twin = shape.stems.length > 1;
  const split = !twin && random() < 0.45 ? zone + rand(1.5, 4) : Infinity;
  const { trunk, above } = leader(shape.stems[0], 0, zone, height, split, axes);
  for (let i = 1; i < shape.stems.length; i++) {
    const other = leader(shape.stems[i], i, zone, height * rand(0.8, 0.95), Infinity, axes, trunk);
    branch(other.trunk, other.above + 0.3, axes);
  }

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
    other.light = trunk.light;
    axes.push(other);
    branch(other, 0.5, axes);
  }
  branch(trunk, above + 0.3, axes);
  axes.forEach((a, i) => { a.id = i; });
  return { axes, trunk, zone };
}

// Древесина оси part.axis от part.from до part.to кусками по STEP: each(масса, середина, длина, радиус,
// касательная, номер точки оси, с которой кусок начинается). То, что сидит внутри родителя, и ствол ниже зоны
// (его считают кубики) не в счёт.
export function segments({ axis: a, from = 0, to = a.len }, zone, each) {
  const inside = a.parent ? section(a.parent, a.attach).r : 0;
  for (let i = 0; i < a.points.length - 1; i++) {
    const q = a.points[i], next = a.points[i + 1];
    const s0 = Math.max(q.s, from, inside), s1 = Math.min(next.s, to);
    if (s1 <= s0 || (a.stem !== undefined && q.p.y < zone)) continue;
    const k0 = (s0 - q.s) / (next.s - q.s), k1 = (s1 - q.s) / (next.s - q.s);
    const mid = q.p.clone().lerp(next.p, (k0 + k1) / 2);
    each(DENSITY * Math.PI * q.r * q.r * (s1 - s0), mid, s1 - s0, q.r, q.t, i);
  }
}

// Точка оси на длине дуги s — такая же, как в points: центр, касательная, рамка и радиус.
export function pointAt(axis, s) {
  const at = section(axis, s);
  return { s, p: at.center, t: at.tangent, n: at.frame[0], b: at.frame[1], r: at.r };
}

// Радиус коры оси a в точке q (её s и r) по азимуту az в рамке оси: у оси с воротником основание раздуто,
// у ствола сечение — по профилю.
export function girth(a, q, az) {
  const collar = a.joint === 'collar' ? 1 + 0.35 * Math.exp(-q.s / (2 * a.points[0].r)) : 1;
  return q.r * collar * (a.profile ? a.profile(az, q.s) : 1);
}

// Кора: каждая ось — одна трубка по своей кривой от from до to (parts — { axis, from, to }), в рамке оси,
// с профилем сечения. У оси с воротником трубка у основания раздута. Начало оси сидит на оси родителя,
// внутри него, — стык без щели. Текстура в метрах: по кругу — по среднему радиусу оси, вдоль — по длине
// дуги, поэтому у отпиленного куска кора та же, что была на дереве. Толстый конец оси (сломанная вершина,
// сухой пенёк) закрыт крышкой из коры, а где ось перепилили (cutFrom, cutTo) — торцом с кольцами:
// это вторая группа граней, со своим материалом. Кольца по торцу — как на срезе кубиков: по кругу
// доля оборота, от коры (0) к сердцевине (1). Трубка каждого куска строится раз: кусок не меняется, а когда
// ось перепиливают, на её месте появляются новые куски, — так перепиленная крона одевается быстро.
const tubes = new WeakMap();
export function barkGeometry(parts) {
  const list = parts.map((part) => {
    if (!tubes.has(part)) tubes.set(part, tube(part));
    return tubes.get(part);
  });
  const size = (key) => list.reduce((n, t) => n + t[key].length, 0);
  const pos = new Float32Array(size('pos')), normal = new Float32Array(size('pos')), uv = new Float32Array(size('uv'));
  const bark = size('index'), index = new Uint32Array(bark + size('grain'));
  let v = 0, i = 0, g = bark;
  for (const t of list) {
    pos.set(t.pos, v * 3);
    normal.set(t.normal, v * 3);
    uv.set(t.uv, v * 2);
    for (const k of t.index) index[i++] = k + v;
    for (const k of t.grain) index[g++] = k + v;
    v += t.pos.length / 3;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.addGroup(0, bark, 0);
  geometry.addGroup(bark, index.length - bark, 1);
  return geometry;
}

// Трубка одного куска оси: точки, нормали, uv и треугольники коры (index) и торцов (grain) — номера свои.
function tube({ axis: a, from = 0, to = a.len, cutFrom, cutTo }) {
  const pos = [], normal = [], uv = [], index = [], grain = [];
  const r0 = a.points[0].r;
  const sides = THREE.MathUtils.clamp(Math.ceil((2 * Math.PI * r0) / 0.03), 5, 32);
  const every = r0 < 0.02 ? 2 : 1;
  const step = (q, i) => i % every === 0 || i === a.points.length - 1;
  a.mean ??= a.points.filter(step).reduce((m, q) => m + q.r, 0) / a.points.filter(step).length;
  const rings = [pointAt(a, from), ...a.points.filter((q, i) => q.s > from + 1e-6 && q.s < to - 1e-6 && step(q, i)), pointAt(a, to)];
  rings.forEach((q, k) => {
    const world = (az) => Math.atan2(q.n.z * Math.cos(az) + q.b.z * Math.sin(az), q.n.x * Math.cos(az) + q.b.x * Math.sin(az));
    const turn = Math.sign(Math.sin(world(0.1) - world(0)));
    for (let j = 0; j <= sides; j++) {
      const az = (j / sides) * 2 * Math.PI;
      const out = q.n.clone().multiplyScalar(Math.cos(az)).addScaledVector(q.b, Math.sin(az));
      pos.push(...q.p.clone().addScaledVector(out, girth(a, q, az)).toArray());
      normal.push(...out.toArray());
      if (a.bark) uv.push(((world(0) + turn * az) * a.bark.radius) / BARK_TILE, (q.s - a.bark.s + a.bark.y) / BARK_TILE);
      else uv.push((az * a.mean) / BARK_TILE, q.s / BARK_TILE);
      if (k && j < sides) {
        const c = k * (sides + 1) + j, p = c - (sides + 1);
        index.push(p, p + 1, c, p + 1, c + 1, c);
      }
    }
  });
  // Торец пропила смотрит вдоль оси наружу (out = +1 у конца, −1 у начала). У каждого треугольника своя
  // середина: в полярных координатах середина — целая строка картинки, и общая растянула бы её веером.
  const cap = (q, out) => {
    const n = q.t.clone().multiplyScalar(out).toArray();
    for (let j = 0; j < sides; j++) {
      const c = pos.length / 3;
      pos.push(...q.p.toArray());
      uv.push((j + 0.5) / sides, 1);
      for (const k of [j, j + 1]) {
        const az = (k / sides) * 2 * Math.PI;
        const dir = q.n.clone().multiplyScalar(Math.cos(az)).addScaledVector(q.b, Math.sin(az));
        pos.push(...q.p.clone().addScaledVector(dir, girth(a, q, az)).toArray());
        uv.push(k / sides, 0);
      }
      normal.push(...n, ...n, ...n);
      if (out > 0) grain.push(c + 1, c + 2, c);
      else grain.push(c + 2, c + 1, c);
    }
  };
  const end = rings[rings.length - 1];
  if (cutTo) cap(end, 1);
  else if (end.r > 0.012) {
    const c = pos.length / 3, last = c - (sides + 1);
    pos.push(...end.p.toArray());
    normal.push(...end.t.toArray());
    uv.push(0, 0);
    for (let j = 0; j < sides; j++) index.push(last + j, last + j + 1, c);
  }
  if (cutFrom) cap(rings[0], -1);
  return { pos: Float32Array.from(pos), normal: Float32Array.from(normal), uv: Float32Array.from(uv), index: Uint32Array.from(index), grain: Uint32Array.from(grain) };
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

// Карточки листвы на концевых веточках осей axes: где сидит (ось и длина дуги s, точка at), куда смотрит
// вверх (up), какая клетка атласа, какой высоты и как повёрнута. Центр карточки — center.
function placeCards(axes, trunk) {
  const { heights } = LEAVES;
  const cards = [];
  for (const a of axes) {
    if (a.dead || a.level < 2) continue;
    for (let s = 0.3 * a.len; s <= a.len; s += rand(0.08, 0.16)) {
      const at = section(a, s);
      const outward = at.center.clone().sub(section(trunk, Math.min(trunk.len, at.center.y)).center).setY(0).normalize();
      const up = at.tangent.clone().lerp(outward, 0.3).addScaledVector(UP, -0.2).normalize();
      const cell = Math.floor(random() * heights.length), [low, high] = heights[cell];
      const h = rand(low, high);
      cards.push({ axis: a, s, at: at.center, up, cell, h, turn: random() * Math.PI, center: at.center.clone().addScaledVector(up, h / 2) });
    }
  }
  return cards;
}

// Листва карточек cards одним куском. cloud — середина кроны: от неё смотрят нормали.
export function leafMesh(cards, cloud) {
  const { grid: [cols, rows], aspect } = LEAVES;
  const pos = [], normal = [], uv = [], lift = [], index = [];
  for (const { at, up, cell, h, turn } of cards) {
    const u0 = (cell % cols) / cols, v0 = 1 - (Math.floor(cell / cols) + 1) / rows, u1 = u0 + 1 / cols, v1 = v0 + 1 / rows;
    const side0 = new THREE.Vector3().crossVectors(up, Math.abs(up.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : UP).normalize();
    for (const a of [turn, turn + Math.PI / 2]) {
      const side = side0.clone().applyAxisAngle(up, a).multiplyScalar((h * aspect) / 2);
      const k = pos.length / 3;
      const corners = [at.clone().sub(side), at.clone().add(side), at.clone().add(side).addScaledVector(up, h), at.clone().sub(side).addScaledVector(up, h)];
      for (const c of corners) {
        pos.push(...c.toArray());
        normal.push(...c.clone().sub(cloud).normalize().addScaledVector(UP, 1).normalize().toArray());
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
  return new THREE.Mesh(geometry, leafMaterial);
}

// Клён выше зоны пиления — куски скелета, из которых игра собирает отпиливаемые ветки (limbs.js):
// у каждого ствола крона, у неё — нижние ветви и волчки, каждая своим куском (y — на какой высоте она
// сидит на стволе). Кусок — оси parts ({ axis, from, to }), листья cards и cloud — середина его листвы.
// Кора ствола начинается кольцом ниже from: трубка заходит внутрь кубиков и при качании не открывает щель.
// Масса листьев — доля LEAF_SHARE от массы ветвей — поровну на карточки. Узлы ствола (knots — точки на оси
// с радиусом) — по ним падающее дерево ложится на землю. Стволы двойного дерева падают порознь.
export function growMaple(shape, zone, height, from) {
  const skeleton = growSkeleton(shape, zone, height);
  const { axes, trunk } = skeleton;
  const stemOf = (a) => (a.stem !== undefined ? a.stem : stemOf(a.parent));
  const lowOf = (a) => (a.low ? a : a.parent && lowOf(a.parent));
  const part = (a) => ({ axis: a, from: a.stem !== undefined ? a.points[a.points.findIndex((q) => q.p.y >= from) - 1].s : 0, to: a.len });
  const piece = (own) => {
    const cards = placeCards(own, trunk);
    const cloud = cards.reduce((c, k) => c.add(k.at), new THREE.Vector3()).divideScalar(Math.max(1, cards.length));
    return { parts: own.map(part), cards, cloud };
  };
  const lows = axes.filter((a) => a.low).map((root) => ({
    root, ...piece(axes.filter((a) => lowOf(a) === root)), y: section(root.parent, root.attach).center.y,
  }));
  const crowns = shape.stems.map((_, i) => ({
    ...piece(axes.filter((a) => stemOf(a) === i && !lowOf(a))), knots: [],
    lows: lows.filter((l) => stemOf(l.root) === i).map(({ parts, cards, cloud, y }) => ({ parts, cards, cloud, y })),
  }));
  const cards = [...crowns, ...lows].flatMap((c) => c.cards);
  let branches = 0;
  for (const a of axes) if (a.level > 0) segments({ axis: a }, zone, (m) => { branches += m; });
  for (const card of cards) card.mass = (LEAF_SHARE * branches) / cards.length;
  for (const a of axes.filter((x) => x.level === 0 || x.joint === 'codominant')) {
    for (let s = 0; s <= a.len; s += 0.5) {
      const at = section(a, s);
      if (at.center.y >= zone) crowns[stemOf(a)].knots.push({ at: at.center, r: at.r });
    }
  }
  return { skeleton, crowns };
}
