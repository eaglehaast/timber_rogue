import * as THREE from 'three';
import { VOXEL } from './trunk.js';

// Механика стоящего дерева. Древесина держит вдоль волокон, а волокна идут по стволу вертикально:
// колонка кубиков, которую пропил задел хоть где-то, на разрыв больше не работает.
// Целые колонки — недопил: только они не дают дереву наклониться.
// Перерезанная колонка ещё может опираться, если её щель смыкается почти сразу: щель g на расстоянии d
// от оси поворота закрывается при наклоне g/d. Тонкий пропил так опирается, раскрытый клин подпила — нет.
// Прочность на сжатие и на разрыв берём одинаковой.

const THIN = 3;               // столько выпиленных кубиков в колонке — тонкий пропил, а не вырез (для косого среза)
export const FRICTION = 0.3;  // трение спила о спил: круче atan(0.3) ≈ 17° верх соскальзывает
const FIBRE = 3000;          // Н: держит колонка 1×1 см (≈30 МПа — прочность древесины вдоль волокон)
const E = 1e10;               // Па: модуль упругости сырой древесины вдоль волокон
const WEAK_H = 0.05;          // м: высота ослабленного участка у недопила — он и гнётся
const SHUT = Math.tan(THREE.MathUtils.degToRad(8)); // щель, что смыкается раньше 8° наклона, — опора
const DIRS = 36;

// Срез ствола по колонкам: все и целые волокна. Для целых — центр и моменты инерции:
// по ним считается, как недопил гнётся. Ствол кверху тоньшает и клонится, поэтому какие колонки
// в стволе, смотрим на середине высоты, где прошла пила.
export function section(voxels) {
  const { n } = voxels;
  const at = Math.round((voxels.cutLow + voxels.cutHigh) / 2);
  const all = [], intact = [];
  for (let k = 0; k < n; k++) {
    for (let i = 0; i < n; i++) {
      const col = k * n + i;
      const gap = voxels.gap[col];
      if (!gap && !voxels.wood(i, at, k)) continue;
      const f = {
        x: voxels.x(i), z: voxels.z(k), gap,
        mid: ((voxels.gapLow[col] + voxels.gapHigh[col] + 1) / 2) * VOXEL,
        normal: voxels.normals.subarray(col * 3, col * 3 + 3),
      };
      all.push(f);
      if (!gap) intact.push(f);
    }
  }
  let x0 = 0, z0 = 0, ixx = 0, izz = 0, ixz = 0;
  for (const f of intact) { x0 += f.x; z0 += f.z; }
  x0 /= intact.length || 1;
  z0 /= intact.length || 1;
  for (const f of intact) {
    ixx += (f.x - x0) ** 2;
    izz += (f.z - z0) ** 2;
    ixz += (f.x - x0) * (f.z - z0);
  }
  return { all, intact, x0, z0, ixx, izz, ixz };
}

const along = (f, u) => f.x * u.x + f.z * u.z;

// Гистограммы волокон вдоль направления, по 2 мм: так ось поворота ищется без сортировки.
// Для каждого шага — сколько волокон и сумма их расстояний: из них считается момент.
const BIN = 0.002;
const BINS = 400;
const comp = new Float64Array(BINS), compX = new Float64Array(BINS);
const tens = new Float64Array(BINS), tensX = new Float64Array(BINS);

// Недопил работает как пластический шарнир. Дерево поворачивается вокруг оси q поперёк u:
// позади неё целые волокна растянуты, впереди сжаты все, что опираются, каждое держит FIBRE.
// Колонка с щелью g опирается, если ось позади неё дальше g/SHUT: так для каждой колонки есть
// порог, и ось ищется одним проходом — там, где сжатых больше растянутых ровно на вес дерева.
// Держит момент всех напряжённых волокон относительно оси, тянет вес: W·(c·u − q).
function hinge(sec, u, weight) {
  const half = (BINS * BIN) / 2;
  const bin = (x) => THREE.MathUtils.clamp(Math.floor((x + half) / BIN), 0, BINS - 1);
  comp.fill(0); compX.fill(0); tens.fill(0); tensX.fill(0);
  let ahead = 0, aheadX = 0;
  for (const f of sec.all) {
    const x = along(f, u);
    const b = bin(x - (f.gap * VOXEL) / SHUT);
    comp[b]++;
    compX[b] += x;
    ahead++;
    aheadX += x;
    if (f.gap) continue;
    tens[bin(x)]++;
    tensX[bin(x)] += x;
  }
  const need = weight / FIBRE;
  let behind = 0, behindX = 0, b = 0;
  while (b < BINS && ahead - behind > need) {
    ahead -= comp[b];
    aheadX -= compX[b];
    behind += tens[b];
    behindX += tensX[b];
    b++;
  }
  const q = b * BIN - half;
  return { q, hold: FIBRE * (aheadX - q * ahead + q * behind - behindX) };
}

// Куда дерево опрокинется: побеждает сторона с наибольшим перевесом тянущего над держащим.
// Длинный узкий недопил держит вдоль себя на длинных плечах, а поперёк — на коротких,
// поэтому дерево идёт поперёк него, как дверь на петле.
// ratio — насколько вес близок к тому, чтобы порвать недопил (1 — рвёт).
export function tipping(sec, c, weight) {
  const at = (az) => {
    const u = new THREE.Vector3(Math.cos(az), 0, -Math.sin(az));
    const { q, hold } = hinge(sec, u, weight);
    const pull = weight * (along(c, u) - q);
    return { az, u, p: q, hold, pull, net: pull - hold };
  };
  let best = at(0);
  let ratio = 0;
  const consider = (t) => {
    if (t.pull > 0) ratio = Math.max(ratio, t.pull / t.hold);
    if (t.net > best.net) best = t;
  };
  for (let d = 1; d < DIRS; d++) consider(at((d / DIRS) * Math.PI * 2));
  for (let step = Math.PI / DIRS; step > 1e-3; step /= 2) {
    const from = best.az;
    consider(at(from + step));
    consider(at(from - step));
  }
  return { ...best, ratio };
}

// На какой угол наклонится дерево, пока вырез впереди оси не сомкнётся (подпил закроется).
// Щели, что смыкаются раньше least (тангенс угла), не в счёт: по умолчанию это те, что уже опираются.
export function closing(sec, u, p, least = SHUT) {
  let shut = Infinity;
  for (const f of sec.all) {
    const d = along(f, u) - p;
    if (f.gap && d > 0 && f.gap * VOXEL >= d * least) shut = Math.min(shut, (f.gap * VOXEL) / d);
  }
  return Math.atan(shut);
}

// Высота, на которой дерево ломается: середина выреза у кромки опоры.
export function pivotHeight(sec, u, p) {
  const cut = sec.all.filter((f) => f.gap);
  const near = cut.filter((f) => Math.abs(along(f, u) - p) < 0.05);
  const from = near.length ? near : cut;
  return from.reduce((s, f) => s + f.mid, 0) / from.length;
}

// Недопил гнётся, пока дерево наклоняется, и рвётся тем позже, чем он толще: 3 см — на 15°, от 5° до 35°.
export function tearAngle(sec, u) {
  let lo = Infinity, hi = -Infinity;
  for (const f of sec.intact) {
    lo = Math.min(lo, along(f, u));
    hi = Math.max(hi, along(f, u));
  }
  return THREE.MathUtils.degToRad(THREE.MathUtils.clamp((hi - lo + VOXEL) / 0.06, 0.33, 2.33) * 15);
}

// Наклон поверхности, на которой стоит перерезанный верх: средняя нормаль тонких пропилов.
export function slope(sec) {
  const m = new THREE.Vector3();
  for (const f of sec.all) {
    if (!f.gap || f.gap > THIN) continue;
    const sign = f.normal[1] < 0 ? -1 : 1;
    m.x += sign * f.normal[0];
    m.y += sign * f.normal[1];
    m.z += sign * f.normal[2];
  }
  const flat = Math.hypot(m.x, m.z);
  return { tilt: Math.atan2(flat, m.y), dir: new THREE.Vector3(m.x / flat, 0, m.z / flat) };
}

// Упругий наклон ствола над недопилом — вектор вдоль земли: куда и на сколько радиан.
// Недопил — пружина: жёсткость E·I/WEAK_H, где I — моменты инерции целых волокон. Гнёт её вес,
// смещённый от центра недопила, и чем сильнее ствол наклонился, тем дальше уходит вес:
// (K − W·H)·θ = W·(c − центр), где H — высота центра тяжести. Если недопил так тонок,
// что K < W·H, равновесия нет: ствол валится туда, куда его клонит.
// Наклон останавливается, когда смыкается щель впереди — ствол садится на пропил.
export function deflection(sec, c, weight, height) {
  const theta = new THREE.Vector3();
  if (!sec.intact.length) return theta;
  const k = (E * VOXEL * VOXEL) / WEAK_H;
  const a = k * sec.ixx - weight * height;
  const b = k * sec.ixz;
  const d = k * sec.izz - weight * height;
  const ex = weight * (c.x - sec.x0), ez = weight * (c.z - sec.z0);
  const det = a * d - b * b;
  if (a > 0 && det > 0) {
    theta.set((d * ex - b * ez) / det, 0, (a * ez - b * ex) / det);
  } else {
    // Самое мягкое направление — собственный вектор с меньшим собственным числом.
    const low = (a + d) / 2 - Math.hypot((a - d) / 2, b);
    theta.set(b, 0, low - a);
    if (theta.lengthSq() < 1e-12) theta.set(a <= d ? 1 : 0, 0, a <= d ? 0 : 1);
    theta.setLength(theta.x * ex + theta.z * ez < 0 ? -Math.PI / 2 : Math.PI / 2);
  }
  const size = theta.length();
  if (!size) return theta;
  const dir = theta.clone().divideScalar(size);
  return theta.setLength(Math.min(size, closing(sec, dir, sec.x0 * dir.x + sec.z0 * dir.z, 0)));
}

// Ширина пропила в точке x, мм: пила оставляет щель в кубик, а наклон ствола вокруг центра
// недопила раскрывает её позади и сжимает впереди.
export function kerfWidth(sec, theta, x) {
  return Math.max(0, 1000 * (VOXEL + theta.x * (sec.x0 - x.x) + theta.z * (sec.z0 - x.z)));
}
