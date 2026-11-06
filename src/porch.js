import * as THREE from 'three';
import { generator } from './random.js';
import { Planks, boardMaterials } from './attic.js';
import { Faces } from './window.js';
import { KIT, atlas, cell, repaint } from './kit.js';

// Крыльцо у двери и обналичка двери — из тех же досок забора (attic.js: Planks), только крашеные.
// Крыльцо: площадка перед дверью вровень с порогом, лестница от неё наружу почти во всю её ширину; под площадкой
// и под лестницей по бокам — обшивка досками стоймя. Перила редко и только с одной стороны.
// Краска тёмная; на ступенях и площадке истёрта посередине — там, где ходят, а к краям остаётся.
// Дверь — картинка Никиты (обитая дверь с ручкой, 4 рисунка под перекраску), крашеная кодом в цвет обивки.
// Балясины перил — картинки на прозрачном (5 рисунков), две крест-накрест, чтобы точёная балясина была объёмной.
const LANDING = { width: 1.8, depth: 1.1 };   // м — площадка: вдоль стены и от стены
export const PORCH_WIDTH = LANDING.width;
const STAIR = { width: 1.6, run: 0.3, rise: 0.18 }; // ширина, проступь, желаемая высота ступени
const BOARD_W = 0.1, GAP = 0.006;              // доска и щель между досками
const SIDE = { thick: 0.022, above: 0.05 };    // обшивка боков лестницы: толщина, выше носков ступеней на
const POST = 0.09, RAIL = { height: 0.9, size: 0.06, chance: 0.3 }; // перила — у каждого третьего крыльца
const BALUSTER = 0.2;                         // м — шаг балясин
const DOOR_INSET = 0.08;                      // м — дверь утоплена в проём от лица стены
// Обналичка двери: ширина боковых досок и верхней, заход за край проёма, отступ от лица стены (поверх брёвен).
const TRIM = { side: 0.12, top: 0.15, overlap: 0.05, out: 0.02 };
const WOOD = new THREE.Color(0.2, 0.18, 0.16); // дерево под стёртой краской — серое
// Краски крыльца и обналички — тёмные: коричневая (её Никита назвал привычной), красно-коричневая, синяя.
const PAINTS = [[0.16, 0.08, 0.05], [0.12, 0.045, 0.03], [0.035, 0.06, 0.15]];
// Обивка двери: коричневая, бордовая, чёрная, тёмно-зелёная. Картинка двери — без прозрачной каймы (INSET).
const DOOR_PAINTS = [[0.2, 0.1, 0.06], [0.16, 0.04, 0.03], [0.07, 0.07, 0.07], [0.08, 0.14, 0.09]];
const INSET = [4 / 512, 4 / 1024];

// Крыльцо и дверь для проёма door. walls — как в house.js; base — верх цоколя; face — лицо стены от её оси.
export function buildPorch(seed, door, wall, { base, face }) {
  const rnd = generator(seed + 3);
  const paint = PAINTS[Math.floor(rnd() * PAINTS.length)];
  const side = Math.sign(wall.at);
  // Точка крыльца: a — вдоль стены вправо (для того, кто смотрит на дверь снаружи), q — от лица стены наружу, y — вверх.
  const c = wall.along === 'x' ? new THREE.Vector3(door.at, 0, wall.at) : new THREE.Vector3(wall.at, 0, door.at);
  const n = wall.along === 'x' ? new THREE.Vector3(0, 0, side) : new THREE.Vector3(side, 0, 0);
  const s = wall.along === 'x' ? new THREE.Vector3(side, 0, 0) : new THREE.Vector3(0, 0, -side);
  const up = new THREE.Vector3(0, 1, 0);
  const P = (a, q, y) => c.clone().addScaledVector(n, face + q).addScaledVector(s, a).setY(y);
  const plane = (o, X, Y) => ({ o, X, Y });
  const centre = P(0, 0, 0);
  const worn = new Planks(boardMaterials(WOOD, { color: paint, wear: { centre: centre.toArray(), across: s.toArray(), half: STAIR.width / 2 } }));
  const coat = boardMaterials(WOOD, { color: paint });
  const painted = new Planks(coat), beams = new Planks(coat, POST), rails = new Planks(coat, RAIL.size), balusters = new Faces();
  const dir = (x, y) => [x / Math.hypot(x, y), y / Math.hypot(x, y)];
  const rect = (a0, a1, b0, b1) => [[a0, b0], [a1, b0], [a1, b1], [a0, b1]];
  // Доски вдоль along по полосе [from, to] поперёк, шириной BOARD_W: ряд прямоугольников в плоскости frame.
  const row = (planks, frame, normal, a0, a1, from, to, alongA) => {
    const count = Math.max(1, Math.round((to - from) / BOARD_W)), wd = (to - from) / count;
    for (let i = 0; i < count; i++) {
      const b0 = from + i * wd, b1 = b0 + wd - GAP;
      planks.add(alongA ? rect(a0, a1, b0, b1) : rect(b0, b1, a0, a1), frame, normal, alongA ? [1, 0] : [0, 1], wd - GAP, rnd);
    }
  };

  // Площадка вровень с порогом (верх нижнего бревна под дверью); доски вдоль стены.
  const top = base + door.bottom, L = LANDING.depth, W = LANDING.width / 2;
  row(worn, plane(P(0, 0, top - 0.022), s, n), up, -W, W, 0, L, true);

  // Лестница: ступени от площадки наружу, проступь из досок, подступёнки из двух досок.
  const steps = Math.max(2, Math.round(top / STAIR.rise)), rise = top / steps, w = STAIR.width / 2, run = STAIR.run;
  for (let k = 1; k <= steps; k++) {
    const q = L + (k - 1) * run, y = top - k * rise;
    if (k < steps) row(worn, plane(P(0, q, y - 0.022), s, n), up, -w, w, 0, run, true);
    // Подступёнок под передним краем ступени выше.
    row(painted, plane(P(0, q - 0.03, y), s, up), n, -w, w, 0, rise - 0.022, true);
  }
  // Бока лестницы зашиты досками стоймя от земли до линии носков ступеней (чуть выше неё), до нижнего подступёнка.
  const nose = (q) => top - ((q - L) / run) * rise, qLow = L + (steps - 1) * run;
  const count = Math.round((qLow - L) / BOARD_W), wd = (qLow - L) / count;
  for (const a of [-w - SIDE.thick, w]) {
    for (let i = 0; i < count; i++) {
      const q0 = L + i * wd, q1 = q0 + wd - GAP;
      painted.add([[q0, 0], [q1, 0], [q1, nose(q1) + SIDE.above], [q0, nose(q0) + SIDE.above]], plane(P(a, 0, 0), n, up), s, [0, 1], wd - GAP, rnd);
    }
  }
  // Обшивка площадки снизу: по бокам и спереди по обе стороны лестницы.
  for (const a of [-W, W - 0.022]) row(painted, plane(P(a, 0, 0), n, up), s, 0, top - 0.03, 0.05, L, false);
  for (const [a0, a1] of [[-W, -w - SIDE.thick], [w + SIDE.thick, W]]) row(painted, plane(P(0, L - 0.03, 0), s, up), n, 0, top - 0.03, a0, a1, false);

  // Перила — у некоторых крылец, с одной стороны: столбы у края площадки и внизу лестницы, брус по площадке от стены
  // и по лестнице вниз.
  if (rnd() < RAIL.chance) {
    const sign = rnd() < 0.5 ? -1 : 1, r = RAIL.size, a = sign * (w + SIDE.thick + POST / 2);
    const postAt = (q, height) => beams.add(rect(a - POST / 2, a + POST / 2, 0, height), plane(P(0, q - POST / 2, 0), s, up), n, [0, 1], POST, rnd);
    const railTop = top + RAIL.height, railLow = nose(qLow) + RAIL.height;
    postAt(L - POST / 2, railTop + 0.05);
    postAt(qLow, railLow + 0.05);
    const frame = plane(P(a - r / 2, 0, 0), n, up);
    rails.add(rect(0, L - POST, railTop - r, railTop), frame, s, [1, 0], r, rnd);
    rails.add([[L - POST, railTop], [qLow, railLow], [qLow, railLow - r], [L - POST, railTop - r]], frame, s, dir(qLow - L + POST, railLow - railTop), r, rnd);
    // Балясины от настила (на лестнице — от обшивки бока) до бруса: две картинки крест-накрест, ширина — четверть высоты.
    const [u0, v0, u1, v1] = cell('baluster', Math.floor(rnd() * KIT.baluster.count)), uv = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    const floor = (q) => (q < L ? top : nose(q) + SIDE.above);
    for (let q = BALUSTER; q < qLow - POST; q += BALUSTER) {
      if (Math.abs(q - (L - POST / 2)) < POST) continue; // столб
      const y0 = floor(q), y1 = (q < L ? railTop : nose(q) + RAIL.height) - r, half = (y1 - y0) / 8;
      balusters.face([P(a - half, q, y0), P(a + half, q, y0), P(a + half, q, y1), P(a - half, q, y1)].map((p) => p.toArray()), n.toArray(), uv);
      balusters.face([P(a, q - half, y0), P(a, q + half, y0), P(a, q + half, y1), P(a, q - half, y1)].map((p) => p.toArray()), s.toArray(), uv);
    }
  }

  // Дверь утоплена в проём; обсада проёма от лица стены до двери.
  const dw = door.width / 2, dTop = base + door.top;
  const at = (a, q, y) => P(a, q, y).toArray();
  const leaf = new Faces(), [du0, dv0, du1, dv1] = cell('door', Math.floor(rnd() * KIT.door.count));
  const [iu, iv] = INSET, dq = -DOOR_INSET;
  leaf.face([at(-dw, dq, top), at(dw, dq, top), at(dw, dq, dTop), at(-dw, dq, dTop)], n.toArray(),
    [[du0 + iu, dv0 + iv], [du1 - iu, dv0 + iv], [du1 - iu, dv1 - iv], [du0 + iu, dv1 - iv]]);
  const cover = DOOR_PAINTS[Math.floor(rnd() * DOOR_PAINTS.length)];
  const lining = new Faces();
  lining.face([at(-dw, 0, top), at(-dw, 0, dTop), at(-dw, -DOOR_INSET, dTop), at(-dw, -DOOR_INSET, top)], s.toArray());
  lining.face([at(dw, 0, top), at(dw, 0, dTop), at(dw, -DOOR_INSET, dTop), at(dw, -DOOR_INSET, top)], s.clone().negate().toArray());
  lining.face([at(-dw, 0, dTop), at(dw, 0, dTop), at(dw, -DOOR_INSET, dTop), at(-dw, -DOOR_INSET, dTop)], [0, -1, 0]);
  // Обналичка двери: доски по бокам и сверху на лице стены, поверх торцов брёвен у проёма.
  const trim = plane(P(0, TRIM.out, 0), s, up), edge = dw + TRIM.overlap;
  for (const sign of [-1, 1]) {
    const a0 = sign > 0 ? edge - TRIM.side : -edge, a1 = a0 + TRIM.side;
    painted.add(rect(a0, a1, top, dTop + TRIM.top), trim, n, [0, 1], TRIM.side, rnd);
  }
  painted.add(rect(-edge, edge, dTop, dTop + TRIM.top), plane(P(0, TRIM.out + 0.022, 0), s, up), n, [1, 0], TRIM.top, rnd);
  const liningMesh = lining.mesh(new THREE.MeshLambertMaterial({ color: new THREE.Color(...paint).multiplyScalar(0.8) }));
  const doorMesh = leaf.mesh(new THREE.MeshLambertMaterial({ map: atlas('door'), color: repaint('door', cover) }));
  const group = new THREE.Group().add(...worn.meshes(), ...painted.meshes(), ...beams.meshes(), ...rails.meshes(), liningMesh, doorMesh);
  if (balusters.pos.length) group.add(balusters.mesh(new THREE.MeshLambertMaterial({ map: atlas('baluster'), color: repaint('baluster', paint), alphaTest: 0.5, side: THREE.DoubleSide })));
  return group;
}
