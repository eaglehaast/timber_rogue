import * as THREE from 'three';
import { VOXEL } from './trunk.js';

// Механика стоящего дерева. Древесина держит вдоль волокон, а волокна идут по стволу вертикально:
// колонка кубиков, которую пропил задел хоть где-то, на разрыв больше не работает.
// Целые колонки — недопил: только они не дают дереву наклониться.
// Перерезанная колонка ещё может опираться, если её щель смыкается почти сразу: щель g на расстоянии d
// от оси поворота закрывается при наклоне g/d. Тонкий пропил так опирается, раскрытый клин подпила — нет.
// Прочность на сжатие и на разрыв берём одинаковой.

export const THIN = 3;        // столько выпиленных кубиков в колонке — тонкий пропил, а не вырез (для схемы и косого среза)
export const FRICTION = 0.3;  // трение спила о спил: круче atan(0.3) ≈ 17° верх соскальзывает
const FIBRE = 3000;          // Н: держит колонка 1×1 см (≈30 МПа — прочность древесины вдоль волокон)
const SHUT = Math.tan(THREE.MathUtils.degToRad(8)); // щель, что смыкается раньше 8° наклона, — опора
const DIRS = 36;

// Срез ствола по колонкам: все и целые волокна. Для целых — площадь, центр и моменты инерции:
// по ним считается, сжат пропил или раскрыт.
export function section(voxels) {
  const { n } = voxels;
  const all = [], intact = [];
  for (let k = 0; k < n; k++) {
    for (let i = 0; i < n; i++) {
      const col = k * n + i;
      if (!voxels.inside[col]) continue;
      const gap = voxels.gap[col];
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
// Щели, что уже опираются, не в счёт.
export function closing(sec, u, p) {
  let shut = Infinity;
  for (const f of sec.all) {
    const d = along(f, u) - p;
    if (f.gap && d > 0 && f.gap * VOXEL >= d * SHUT) shut = Math.min(shut, (f.gap * VOXEL) / d);
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

// Нагрузка на пропил в точке x: сжатие от веса на целых волокнах, как во внецентренно сжатой балке.
// 1 — как в среднем по недопилу; сильно больше — щель сжимается и закусывает шину;
// меньше нуля — волокна там растянуты, щель раскрывается. Без целых волокон — не определена.
export function kerfLoad(sec, c, x) {
  const det = sec.ixx * sec.izz - sec.ixz ** 2;
  if (!sec.intact.length || det <= 0) return null;
  const ex = c.x - sec.x0, ez = c.z - sec.z0;
  const dx = x.x - sec.x0, dz = x.z - sec.z0;
  const bx = (sec.izz * dx - sec.ixz * dz) / det;
  const bz = (sec.ixx * dz - sec.ixz * dx) / det;
  return 1 + sec.intact.length * (ex * bx + ez * bz);
}
