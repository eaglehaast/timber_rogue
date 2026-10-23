import * as THREE from 'three';
import { VOXEL } from './trunk.js';

// Механика стоящего дерева. Древесина держит вдоль волокон, а волокна идут по стволу вертикально:
// колонка кубиков, которую пропил задел хоть где-то, на разрыв больше не работает.
// Целые колонки — недопил: только они не дают дереву наклониться.
// Перерезанная колонка опирается, только когда её щель сомкнулась: щель g на расстоянии d
// от оси поворота закрывается при наклоне g/d. Чем сильнее дерево наклонилось, тем больше колонок
// впереди оси опираются и тем крепче держит недопил — так у наклона бывает новая точка равновесия.
// На сжатие сырая древесина держит вдвое слабее, чем на разрыв: сжатые волокна сминаются.

const THIN = 3;               // столько выпиленных кубиков в колонке — тонкий пропил, а не вырез (для косого среза)
export const FRICTION = 0.3;  // трение спила о спил: круче atan(0.3) ≈ 17° верх соскальзывает
export const SLIDING = 0.2;   // а когда уже поехал, трение слабее: сорвавшийся верх разгоняется
// Н: держит колонка 1×1 см вдоль волокон. Сырой клён: разрыв ≈40 МПа, сжатие ≈17 МПа.
const TENSION = 4000;
const CRUSH = 1700;
const SHEAR = 7e6;            // Па: на скалывание вдоль волокон древесина держит в разы слабее
const E = 1e10;               // Па: модуль упругости сырой древесины вдоль волокон
const WEAK_H = 0.05;          // м: высота ослабленного участка у недопила — он и гнётся
const SHUT = Math.tan(THREE.MathUtils.degToRad(8)); // падая, дерево ломает недопил, если подпил сомкнулся раньше 8°
const G_WOOD = E / 16;         // Па: модуль сдвига — на кручение древесина в разы мягче, чем вдоль волокон
const DIRS = 36;

// Срез ствола по колонкам: все и целые волокна. Для целых — центр и моменты инерции:
// по ним считается, как недопил гнётся. Перерезанный насквозь ствол оседает на самую узкую щель (sink, м),
// у каждой колонки open — сколько её щели осталось после этого.
export function section(voxels) {
  const { n } = voxels;
  const all = [], intact = [];
  for (let k = 0; k < n; k++) {
    for (let i = 0; i < n; i++) {
      const col = k * n + i;
      const gap = voxels.gap[col];
      if (!gap && !through(voxels, i, k)) continue;
      const f = {
        col, x: voxels.x(i), z: voxels.z(k), gap,
        mid: ((voxels.gapLow[col] + voxels.gapHigh[col] + 1) / 2) * VOXEL,
        normal: voxels.normals.subarray(col * 3, col * 3 + 3),
      };
      all.push(f);
      if (!gap) intact.push(f);
    }
  }
  const sink = intact.length ? 0 : Math.min(...all.map((f) => f.gap)) * VOXEL;
  for (const f of all) f.open = f.gap * VOXEL - sink;
  let x0 = 0, z0 = 0, ixx = 0, izz = 0, ixz = 0;
  for (const f of intact) { x0 += f.x; z0 += f.z; }
  x0 /= intact.length || 1;
  z0 /= intact.length || 1;
  for (const f of intact) {
    ixx += (f.x - x0) ** 2;
    izz += (f.z - z0) ** 2;
    ixz += (f.x - x0) * (f.z - z0);
  }
  return { n, all, intact, sink, x0, z0, ixx, izz, ixz };
}

// Колонка без пропила связывает пень с верхом, только если древесина в ней сплошная по всей высоте,
// где прошла пила. Ствол кривой: у края косой рез может пройти там, где колонка уже вышла из ствола.
function through(voxels, i, k) {
  for (let j = voxels.cutLow; j <= voxels.cutHigh; j++) if (!voxels.at(i, j, k)) return false;
  return true;
}

const along = (f, u) => f.x * u.x + f.z * u.z;

// Гистограммы волокон вдоль направления, по 2 мм: так ось поворота ищется без сортировки.
// Для каждого шага — сколько волокон и сумма их расстояний: из них считается момент.
const BIN = 0.002;
const BINS = 400;
const comp = new Float64Array(BINS), compX = new Float64Array(BINS);
const tens = new Float64Array(BINS), tensX = new Float64Array(BINS);

// Недопил работает как пластический шарнир. Дерево повернулось вокруг оси q поперёк u на угол с тангенсом
// lean: позади оси целые волокна растянуты и держат TENSION, впереди сжаты все, что опираются, и держат CRUSH.
// Колонка с щелью g опирается, если ось позади неё дальше g/lean: так для каждой колонки есть
// порог, и ось ищется одним проходом — там, где сжатые держат больше растянутых ровно на вес дерева.
// Держит момент всех напряжённых волокон относительно оси, тянет вес: W·(c·u − q).
function hinge(sec, u, weight, lean) {
  const half = (BINS * BIN) / 2;
  const bin = (x) => THREE.MathUtils.clamp(Math.floor((x + half) / BIN), 0, BINS - 1);
  comp.fill(0); compX.fill(0); tens.fill(0); tensX.fill(0);
  let ahead = 0, aheadX = 0;
  for (const f of sec.all) {
    const x = along(f, u);
    const b = bin(x - (f.open ? f.open / lean : 0));
    comp[b]++;
    compX[b] += x;
    ahead++;
    aheadX += x;
    if (f.gap) continue;
    tens[bin(x)]++;
    tensX[bin(x)] += x;
  }
  let behind = 0, behindX = 0, b = 0;
  while (b < BINS && CRUSH * ahead - TENSION * behind > weight) {
    ahead -= comp[b];
    aheadX -= compX[b];
    behind += tens[b];
    behindX += tensX[b];
    b++;
  }
  const q = b * BIN - half;
  return { q, pulled: behind, hold: CRUSH * (aheadX - q * ahead) + TENSION * (q * behind - behindX) };
}

// Куда дерево опрокинется: побеждает сторона с наибольшим перевесом тянущего над держащим.
// Длинный узкий недопил держит вдоль себя на длинных плечах, а поперёк — на коротких,
// поэтому дерево идёт поперёк него, как дверь на петле.
// ratio — насколько вес близок к тому, чтобы порвать недопил (1 — рвёт).
// tilt — на сколько и куда ствол уже наклонился: в сторону u он наклонён на tilt·u.
export function tipping(sec, c, weight, tilt) {
  const at = (az) => {
    const u = new THREE.Vector3(Math.cos(az), 0, -Math.sin(az));
    return lever(sec, c, weight, u, Math.max(0, along(tilt, u)));
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

// Шарнир при наклоне lean (тангенс) в сторону u: где ось, сколько держит и сколько тянет вес.
export function lever(sec, c, weight, u, lean) {
  const { q, pulled, hold } = hinge(sec, u, weight, lean);
  const pull = weight * (along(c, u) - q);
  return { u, p: q, pulled, hold, pull, net: pull - hold };
}

// На какой угол наклонится дерево, пока вырез впереди оси не сомкнётся (подпил закроется).
// Щели, что смыкаются раньше least (тангенс угла), не в счёт: по умолчанию это тонкие пропилы —
// на них дерево опирается, а ломает недопил только раскрытый вырез подпила.
export const closing = (sec, u, p, least = SHUT) => Math.atan(firstShut(sec, u, p, least).shut);

// Волокно, на котором щель смыкается первой: туда дерево и садится.
export const contact = (sec, u, p) => firstShut(sec, u, p, 0).at;

function firstShut(sec, u, p, least) {
  let shut = Infinity, at = null;
  for (const f of sec.all) {
    const d = along(f, u) - p;
    if (!f.gap || d <= 0 || f.open < d * least || f.open >= shut * d) continue;
    shut = f.open / d;
    at = f;
  }
  return { shut, at };
}

// Высота, на которой дерево ломается: середина выреза у кромки опоры.
export function pivotHeight(sec, u, p) {
  const cut = sec.all.filter((f) => f.gap);
  const near = cut.filter((f) => Math.abs(along(f, u) - p) < 0.05);
  const from = near.length ? near : cut;
  return from.reduce((s, f) => s + f.mid, 0) / from.length;
}

// Целые волокна недопила позади оси: они растянуты, на них дерево и висит.
export const pulledFibres = (sec, tip) => sec.intact.filter((f) => along(f, tip.u) < tip.p);

// Отщеп. Растянутые волокна недопила тянут с силой T и вырывают свой пучок из ствола над пропилом:
// он скалывается по всем граням, где граничит с остальной древесиной (кора снаружи ничего не держит).
// Вверх, а не в пень: пень стоит, а верх поворачивается и отжимает трещину над пропилом — там древесину
// не только скалывает, но и рвёт поперёк волокон, а на это она держит ещё слабее. Пучок остаётся на пне
// полосой, в комле верха — жёлоб. Скалывается древесина легко, поэтому трещина идёт на длину
// T / (SHEAR·периметр) — пока площади хватит, чтобы передать силу. Широкий недопил толщиной t отщепляется
// на ~3t, узкая полоска по направлению падения — едва-едва: периметр у неё большой, а тянет она мало.
// А толстый недопил под тяжёлым наклонённым деревом тянет так, что ствол раскалывается вверх на метры
// и на пне остаётся высокая спинка — «парикмахерское кресло» (barber chair).
// load — какую долю своей прочности волокна сейчас держат.
export function splitLength(sec, tip, load) {
  const pulled = new Set(pulledFibres(sec, tip).map((f) => f.col));
  if (!pulled.size) return 0;
  const wood = new Set(sec.all.map((f) => f.col));
  let faces = 0;
  for (const col of pulled) {
    for (const nb of [col - 1, col + 1, col - sec.n, col + sec.n]) if (wood.has(nb) && !pulled.has(nb)) faces++;
  }
  return (TENSION * tip.pulled * load) / (SHEAR * faces * VOXEL);
}

// Недопил гнётся, пока дерево наклоняется, и рвётся тем позже, чем он толще: 3 см — на 15°, от 5° до 35°.
// Отщепившийся на длину split недопил — длинная полоса: гнётся дальше во столько раз, во сколько длиннее, до 70°.
export function tearAngle(sec, u, split = 0) {
  let lo = Infinity, hi = -Infinity;
  for (const f of sec.intact) {
    lo = Math.min(lo, along(f, u));
    hi = Math.max(hi, along(f, u));
  }
  const angle = THREE.MathUtils.clamp((hi - lo + VOXEL) / 0.06, 0.33, 2.33) * 15 * Math.max(1, split / WEAK_H);
  return THREE.MathUtils.degToRad(Math.min(angle, 70));
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

// Сворачивание. Перерезанный верх, севший на пропилы (щель сомкнулась), стоит на площадках срезов.
// Косая площадка толкает верх вбок вдоль своего наклона, и если встречные косые резы спускаются
// в разные стороны, как витки винта, толчки не гасят друг друга, а закручивают верх вокруг вертикали
// через остаток недопила (или через середину опоры, если перерезан насквозь).
// drive — этот момент, Н·м (знак — куда крутит), rub — сколько держит трение площадок,
// hold — сколько остаток выдержит на кручение, прежде чем его скрутит и порвёт,
// stiff — его жёсткость на кручение, Н·м/рад: до разрыва он закручивается упруго на (|drive| − rub)/stiff.
// Вес делится между площадками поровну, но каждая держит не больше, чем на смятие, — остальное на недопиле.
export function twist(sec, theta, give, weight, split = 0) {
  const seat = sec.all.filter((f) => f.gap && !kerfWidth(sec, theta, give, f, f.open));
  if (!seat.length) return null;
  const from = sec.intact.length ? sec.intact : seat;
  const o = { x: 0, z: 0 };
  for (const f of from) { o.x += f.x / from.length; o.z += f.z / from.length; }
  const load = Math.min(CRUSH, weight / seat.length);
  let drive = 0, rub = 0;
  for (const f of seat) {
    const up = f.normal[1] < 0 ? -1 : 1;
    const press = load / (up * f.normal[1]);
    const rx = f.x - o.x, rz = f.z - o.z;
    drive += press * up * (rz * f.normal[0] - rx * f.normal[2]);
    rub += FRICTION * press * Math.hypot(rx, rz);
  }
  // Колонка 1×1 см на расстоянии r от оси: держит SHEAR·VOXEL²·r, а у самой оси — как квадрат, τ·a³/3.
  let hold = 0, polar = 0;
  for (const f of sec.intact) {
    const r = Math.hypot(f.x - o.x, f.z - o.z);
    hold += SHEAR * VOXEL * VOXEL * Math.hypot(r, VOXEL / 3);
    polar += VOXEL * VOXEL * (r * r + (VOXEL * VOXEL) / 6);
  }
  return { o, drive, rub, hold, stiff: (G_WOOD * polar) / Math.max(WEAK_H, split) };
}

// Упругий наклон ствола над недопилом — вектор вдоль земли: куда и на сколько радиан.
// Недопил — пружина: жёсткость E·I/H, где I — моменты инерции целых волокон, H — высота, на которой
// он гнётся: WEAK_H, а у отщепившегося на split — вся длина отщепа. Гнёт её вес,
// смещённый от центра недопила, и чем сильнее ствол наклонился, тем дальше уходит вес:
// (K − W·H)·θ = W·(c − центр), где H — высота центра тяжести. Если недопил так тонок,
// что K < W·H, равновесия нет: ствол валится туда, куда его клонит.
// Наклон останавливается, когда смыкается щель впереди — ствол садится на пропил.
export function deflection(sec, c, weight, height, split = 0) {
  const theta = new THREE.Vector3();
  if (!sec.intact.length) return theta;
  const k = (E * VOXEL * VOXEL) / Math.max(WEAK_H, split);
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

// Ширина пропила в точке x, мм: пила оставляет щель в кубик (open, м — что от неё осталось после оседания),
// а наклон ствола раскрывает её позади и сжимает впереди — упругий (theta) вокруг центра недопила,
// осевший (give) вокруг оси, у которой осел.
export function kerfWidth(sec, theta, give, x, open = VOXEL - sec.sink) {
  const t = give.tilt;
  return Math.max(0, 1000 * (open + theta.x * (sec.x0 - x.x) + theta.z * (sec.z0 - x.z)
    + t.x * (give.at.x - x.x) + t.z * (give.at.z - x.z)));
}
