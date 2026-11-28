import * as THREE from 'three';
import { VOXEL } from './trunk.js';

// Механика стоящего дерева — игровое правило, а не модель волокон. Колонка кубиков, которую пропил задел
// хоть где-то, перерезана; целые колонки — недопил. Дерево падает туда, куда смещён его вес от середины пня
// (наклон, крона, ветер, лебёдка), и тогда, когда недопила осталось меньше, чем нужно, чтобы держать это плечо.
// Форма подпила и недопила на направление не влияет.

const THIN = 3;               // столько выпиленных кубиков в колонке — тонкий пропил, а не вырез (для косого среза)
// Числа — сырой клён ясенелистный (Acer negundo): справочник Alden, колонка Green. Трение и разрыв
// для этого вида не измерены — это пробные значения из исследования, а не справочник.
export const FRICTION = 0.6;  // трение сырого спила о спил: круче atan(0.6) ≈ 31° верх соскальзывает
export const SLIDING = 0.45;  // а когда уже поехал, трение слабее: сорвавшийся верх разгоняется
// Н: держит колонка 1×1 см вдоль волокон: разрыв ≈40 МПа (не подтверждено), сжатие 16,3 МПа.
const TENSION = 4000;
const CRUSH = 1630;
// Па — то же на квадратный метр: у ветки сечение не из колонок, а из клеток (limbs.js).
export const TENSILE = TENSION / VOXEL ** 2, COMPRESSIVE = CRUSH / VOXEL ** 2;
export const SHEAR = 6.5e6;          // Па: на скалывание вдоль волокон древесина держит в разы слабее
export const E = 6e9;                // Па: модуль упругости вдоль волокон (у твёрдого клёна 10–11 ГПа)
export const SPLIT_MIN = 0.02;       // м: отщеп короче этого — волосяная трещина, её не видно и она ничего не меняет

// Срез ствола по колонкам: все и целые волокна, центр целых. Перерезанный насквозь ствол оседает на самую узкую щель (sink, м),
// у каждой колонки open — сколько её щели осталось после этого.
export function section(voxels) {
  const { n, m } = voxels;
  const all = [], intact = [];
  for (let k = 0; k < m; k++) {
    for (let i = 0; i < n; i++) {
      const col = k * n + i;
      const gap = voxels.gap[col];
      // Держат только целые колонки тех стволов, что подпилены: у двойного дерева второй ствол сам по себе.
      if ((!gap && !through(voxels, i, k)) || !voxels.held(voxels.middle * n * m + col)) continue;
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
  let x0 = 0, z0 = 0;
  for (const f of intact) { x0 += f.x; z0 += f.z; }
  x0 /= intact.length || 1;
  z0 /= intact.length || 1;
  return { n, all, intact, sink, x0, z0 };
}

// Колонка без пропила связывает пень с верхом, только если древесина в ней сплошная по всей высоте,
// где прошла пила. Ствол кривой: у края косой рез может пройти там, где колонка уже вышла из ствола.
function through(voxels, i, k) {
  for (let j = voxels.cutLow; j <= voxels.cutHigh; j++) if (!voxels.at(i, j, k)) return false;
  return true;
}

const along = (f, u) => f.x * u.x + f.z * u.z;

// Недопил держит, пока его доля сечения не меньше HOLD · (плечо веса / радиус ствола), но не больше HOLD:
// клонящееся дерево надо допиливать меньше, ровное — почти насквозь.
export const HOLD = 0.3;
// Рез с той стороны, куда клонится дерево: щель над шиной смыкается целиком, когда пропил прошёл такую долю
// пути до падения. Дальше вес лежит на шине.
export const SEAT = 0.9;
// Рез с обратной стороны: перед самым падением верх раскрывает щель на такой угол вокруг недопила.
export const OPEN_TILT = THREE.MathUtils.degToRad(2.5);

// Что делает дерево с этим срезом sec, если его вес приложен в точке c (координаты ствола, по горизонтали).
// u — куда клонится и упадёт, lever — плечо веса от середины пня, keep — какая доля недопила держит,
// load — сколько пройдено до падения (1 — падает), front — пропил с той стороны, куда клонится,
// p — ось наклона по u, tilt — на сколько верх уже наклонился вокруг неё (рад).
// Пропил сзади: верх клонится вокруг переднего края недопила, и щель за ним раскрывается.
// Пропил спереди: верх садится на пропил, недопил проминается, ось — его задний край.
export function leaning(sec, c, radius) {
  if (!sec.all.length) throw new Error('leaning: в срезе нет ни одной колонки');
  let cx = 0, cz = 0;
  for (const f of sec.all) { cx += f.x; cz += f.z; }
  cx /= sec.all.length;
  cz /= sec.all.length;
  const u = new THREE.Vector3(c.x - cx, 0, c.z - cz);
  const lever = u.length();
  if (lever < 1e-6) throw new Error(`leaning: вес ровно над серединой пня (${c.x}, ${c.z})`);
  u.divideScalar(lever);
  const keep = HOLD * Math.min(1, lever / radius);
  const load = (1 - sec.intact.length / sec.all.length) / (1 - keep);
  const cut = sec.all.filter((f) => f.gap);
  const front = cut.reduce((s, f) => s + along(f, u), 0) / (cut.length || 1) > cx * u.x + cz * u.z;
  const hinge = (sec.intact.length ? sec.intact : sec.all).map((f) => along(f, u));
  if (front) {
    const p = Math.min(...hinge);
    const reach = Math.max(VOXEL, ...cut.map((f) => along(f, u) - p));
    return { u, lever, keep, load, front, p, tilt: (seated(load) * VOXEL) / reach };
  }
  return { u, lever, keep, load, front, p: Math.max(...hinge), tilt: OPEN_TILT * Math.min(1, load) ** 2 };
}

// Насколько верх сел на пропил спереди: 0 — щель как выпилили, 1 — сомкнулась.
const seated = (load) => Math.min(1, load / SEAT);

// Щель (м) над точкой x пропила. Спереди она сужается вся сразу — верх сел на шину; сзади раскрывается
// тем шире, чем дальше от оси. Перерезанный насквозь ствол ещё и осел на sec.sink.
export function kerfGap(sec, lean, x) {
  const gap = lean.front ? VOXEL * (1 - seated(lean.load)) : VOXEL + lean.tilt * (lean.p - along(x, lean.u));
  return Math.max(0, gap - sec.sink);
}

// Волокна, которые падающее дерево рвёт, а не мнёт: недопил позади его переднего края.
// Отщеп (split, м) тем длиннее, чем шире недопил по ходу падения.
export function torn(sec, lean) {
  if (!sec.intact.length) return { fibres: [], split: 0 };
  const a = sec.intact.map((f) => along(f, lean.u));
  const edge = Math.max(...a), width = edge - Math.min(...a);
  return { fibres: sec.intact.filter((f, i) => a[i] < edge - VOXEL), split: width < SPLIT_MIN ? 0 : Math.min(0.15, width / 2) };
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
