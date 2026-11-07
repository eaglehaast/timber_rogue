import * as THREE from 'three';
import { generator } from './random.js';
import { Planks, boardMaterials } from './attic.js';
import { Faces } from './window.js';
import { KIT, atlas, cell, repaint } from './kit.js';

// Крыльцо у двери и обналичка двери — из тех же досок забора (attic.js: Planks), только крашеные.
// Крыльцо: площадка перед дверью вровень с порогом, лестница от неё наружу почти во всю её ширину; под площадкой
// и под лестницей по бокам — обшивка досками стоймя. Перила всегда, обычно с одной стороны.
// На ступенях и площадке тон истёрт посередине — там, где ходят, а к краям остаётся.
// Дверь — доски стоймя с железными ручкой и петлями, а с частью door (house.js: PARTS) — картинка Никиты: обитая дверь
// с ручкой, 4 рисунка под перекраску, крашеная кодом в цвет обивки. У перил — балясины, картинки на прозрачном
// (5 рисунков), две крест-накрест, чтобы точёная балясина была объёмной, и столбы с шапками (5 рисунков).
const LANDING = { width: 1.8, depth: 1.1 };   // м — площадка: вдоль стены и от стены
export const PORCH_WIDTH = LANDING.width;
const STAIR = { width: 1.6, run: 0.3, rise: 0.18 }; // ширина, проступь, желаемая высота ступени
const BOARD_W = 0.1, GAP = 0.006;              // доска и щель между досками
const SIDE = { thick: 0.022, above: 0.05 };    // обшивка боков лестницы: толщина, выше носков ступеней на
const POST = 0.11, RAIL = { height: 0.9, size: 0.06, both: 0.12 }; // столб; перила, доля крылец с перилами с двух сторон
const BALUSTER = 0.2;                         // м — шаг балясин
const DOOR_INSET = 0.08;                      // м — дверь утоплена в проём от лица стены
// Обналичка двери: ширина боковых досок и верхней, заход за край проёма, отступ от лица стены (поверх брёвен).
const TRIM = { side: 0.12, top: 0.15, overlap: 0.05, out: 0.02 };
const WOOD = new THREE.Color(0.2, 0.18, 0.16); // дерево под стёртой краской — серое
// Крыльцо и обналичка — цвета среза брёвен (Никита, 2026-11-07: без лишних цветов, но разное): тон среза
// (house-endgrain.jpg, приглушённый, как на срубе), темнее и светлее-серее.
const PAINTS = [[0.18, 0.12, 0.1], [0.13, 0.085, 0.065], [0.2, 0.15, 0.12]];
// Обивка двери — дерматин: коричневый, бордовый, чёрный (зелёный выбивался из дома). Картинка двери — без прозрачной каймы (INSET).
const DOOR_PAINTS = [[0.14, 0.08, 0.05], [0.12, 0.035, 0.03], [0.09, 0.085, 0.08]]; // чёрный чуть светлее: иначе дверь читается как пустой проём
const INSET = [4 / 512, 4 / 1024];
const iron = new THREE.MeshLambertMaterial({ color: 0x1d1b1a });

// Крыльцо и дверь для проёма door. walls — как в house.js; base — верх цоколя; face — лицо стены от её оси.
export function buildPorch(seed, door, wall, { base, face, parts }) {
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
  const painted = new Planks(coat), rails = new Planks(coat, RAIL.size), balusters = new Faces(), posts = new Faces();
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

  // Перила — у каждого крыльца (в таких домах живут старики): обычно с одной стороны, изредка с двух.
  // Столбы у края площадки и внизу лестницы, брус по площадке от стены и по лестнице вниз, между ними балясины.
  const sides = rnd() < RAIL.both ? [-1, 1] : [rnd() < 0.5 ? -1 : 1];
  const [u0, v0, u1, v1] = cell('baluster', Math.floor(rnd() * KIT.baluster.count)), uv = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
  const newel = Math.floor(rnd() * KIT.newel.count);
  const floor = (q) => (q < L ? top : nose(q) + SIDE.above);
  const railTop = top + RAIL.height, railLow = nose(qLow) + RAIL.height, r = RAIL.size;
  for (const sign of sides) {
    const a = sign * (w + SIDE.thick + POST / 2);
    newelPost(posts, newel, P(a, L - POST / 2, 0), s, n, railTop + 0.12);
    newelPost(posts, newel, P(a, qLow, 0), s, n, railLow + 0.12);
    const frame = plane(P(a - r / 2, 0, 0), n, up);
    rails.add(rect(0, L - POST, railTop - r, railTop), frame, s, [1, 0], r, rnd);
    rails.add([[L - POST, railTop], [qLow, railLow], [qLow, railLow - r], [L - POST, railTop - r]], frame, s, dir(qLow - L + POST, railLow - railTop), r, rnd);
    // Балясины от настила (на лестнице — от обшивки бока) до бруса: две картинки крест-накрест, ширина — четверть высоты.
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
  const door3d = new THREE.Group();
  if (parts.has('door')) {
    const cover = DOOR_PAINTS[Math.floor(rnd() * DOOR_PAINTS.length)], leaf = new Faces();
    const [du0, dv0, du1, dv1] = cell('door', Math.floor(rnd() * KIT.door.count)), [iu, iv] = INSET, dq = -DOOR_INSET;
    leaf.face([at(-dw, dq, top), at(dw, dq, top), at(dw, dq, dTop), at(-dw, dq, dTop)], n.toArray(),
      [[du0 + iu, dv0 + iv], [du1 - iu, dv0 + iv], [du1 - iu, dv1 - iv], [du0 + iu, dv1 - iv]]);
    door3d.add(leaf.mesh(new THREE.MeshLambertMaterial({ map: atlas('door'), color: repaint('door', cover) })));
  } else {
    row(painted, plane(P(0, -DOOR_INSET, 0), s, up), n, top, dTop, -dw, dw, false);
    // Железо: две петли-полосы со стороны петель и скоба-ручка с другой.
    const box = (a0, a1, y0, y1, q0, q1) => {
      const [p, q] = [P(a0, q0, y0), P(a1, q1, y1)];
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(q.x - p.x), y1 - y0, Math.abs(q.z - p.z)), iron);
      mesh.position.copy(p).add(q).multiplyScalar(0.5);
      mesh.castShadow = true;
      door3d.add(mesh);
    };
    const face0 = -DOOR_INSET + 0.022;
    for (const y of [top + 0.3, dTop - 0.3]) box(-dw + 0.02, -dw + 0.45, y - 0.02, y + 0.02, face0, face0 + 0.006);
    box(dw - 0.14, dw - 0.11, top + 0.85, top + 1.05, face0, face0 + 0.05);
  }
  const lining = new Faces();
  lining.face([at(-dw, 0, top), at(-dw, 0, dTop), at(-dw, -DOOR_INSET, dTop), at(-dw, -DOOR_INSET, top)], s.toArray());
  lining.face([at(dw, 0, top), at(dw, 0, dTop), at(dw, -DOOR_INSET, dTop), at(dw, -DOOR_INSET, top)], s.clone().negate().toArray());
  lining.face([at(-dw, 0, dTop), at(dw, 0, dTop), at(dw, -DOOR_INSET, dTop), at(-dw, -DOOR_INSET, dTop)], [0, -1, 0]);
  // Порог — доска от лица стены до двери вровень с площадкой: под ней бревно-порог, между ними иначе видна щель.
  lining.face([at(-dw, 0, top), at(dw, 0, top), at(dw, -DOOR_INSET, top), at(-dw, -DOOR_INSET, top)], [0, 1, 0]);
  // Обналичка двери: доски по бокам и сверху на лице стены, поверх торцов брёвен у проёма.
  const trim = plane(P(0, TRIM.out, 0), s, up), edge = dw + TRIM.overlap;
  for (const sign of [-1, 1]) {
    const a0 = sign > 0 ? edge - TRIM.side : -edge, a1 = a0 + TRIM.side;
    painted.add(rect(a0, a1, top, dTop + TRIM.top), trim, n, [0, 1], TRIM.side, rnd);
  }
  painted.add(rect(-edge, edge, dTop, dTop + TRIM.top), plane(P(0, TRIM.out + 0.022, 0), s, up), n, [1, 0], TRIM.top, rnd);
  const liningMesh = lining.mesh(new THREE.MeshLambertMaterial({ color: new THREE.Color(...paint).multiplyScalar(0.8) }));
  return new THREE.Group().add(...worn.meshes(), ...painted.meshes(), ...rails.meshes(), liningMesh, door3d,
    balusters.mesh(new THREE.MeshLambertMaterial({ map: atlas('baluster'), color: repaint('baluster', paint), alphaTest: 0.5, side: THREE.DoubleSide })),
    posts.mesh(new THREE.MeshLambertMaterial({ map: atlas('newel'), color: repaint('newel', paint), alphaTest: 0.5 })));
}

// Столб перил: брус POST × POST от земли до height, грани — картинка столба index (набор house-newel.webp — тело
// столба с шапкой, без свеса шапки). Низ и шапка картинки — в своём масштабе (по ширине столба), середина тянется
// по высоте. s, n — оси столба вдоль стены и от неё, base — середина низа.
const NEWEL = { foot: 0.05, cap: 0.16 }; // доли высоты картинки: низ и шапка, которые не тянутся
function newelPost(faces, index, base, s, n, height) {
  const [u0, v0, u1, v1] = cell('newel', index), [, , , , pw, ph] = KIT.newel.rects[index];
  const natural = (POST * ph) / pw, foot = NEWEL.foot * natural, cap = NEWEL.cap * natural;
  const v = (f) => v0 + f * (v1 - v0);
  // Пояса по высоте: [низ, верх, доля картинки снизу, доля сверху].
  const bands = [[0, foot, 0, NEWEL.foot], [foot, height - cap, NEWEL.foot, 1 - NEWEL.cap], [height - cap, height, 1 - NEWEL.cap, 1]];
  const h = POST / 2, corner = (i, j, y) => base.clone().addScaledVector(s, i * h).addScaledVector(n, j * h).setY(y).toArray();
  // Четыре грани: [угол слева, угол справа, наружу] для того, кто смотрит на грань снаружи.
  const sides = [[[-1, 1], [1, 1], n], [[1, 1], [1, -1], s], [[1, -1], [-1, -1], n.clone().negate()], [[-1, -1], [-1, 1], s.clone().negate()]];
  for (const [[ai, aj], [bi, bj], out] of sides) {
    for (const [y0, y1, f0, f1] of bands) {
      faces.face([corner(ai, aj, y0), corner(bi, bj, y0), corner(bi, bj, y1), corner(ai, aj, y1)], out.toArray(),
        [[u0, v(f0)], [u1, v(f0)], [u1, v(f1)], [u0, v(f1)]]);
    }
  }
  // Верх шапки — цветом шапки.
  const lid = [u0 + (u1 - u0) / 2, v(1 - NEWEL.cap / 2)];
  faces.face([corner(-1, -1, height), corner(1, -1, height), corner(1, 1, height), corner(-1, 1, height)], [0, 1, 0], [lid, lid, lid, lid]);
}
