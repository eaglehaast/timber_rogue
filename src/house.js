import * as THREE from 'three';
import { tiles, soften } from './surface.js';
import { generator } from './random.js';
import { buildBoards } from './attic.js';

// Сруб избы. Брёвна лежат венцами: продольные стены (фасад и зад) и поперечные (бока) чередуются,
// фасадные сидят на полбревна ниже боковых. На углах брёвна врублены «в чашу с остатком»: каждое выходит за угол
// на OVERHANG и там пересекает бревно соседней стены, а пересечение и есть чаша. В проёмах окон и двери
// брёвна перерезаны, и в проёме видны их торцы. Всё строится от числа-зерна: другое зерно — другой дом.
//
// Бревно — трубка вдоль своей оси: чуть сбежистое (комель толще вершины, комли венцов чередуются), чуть
// провисшее и не совсем круглое. Кора снята; бок одет плитками из набора (house-log.jpg, 10 плиток 5 × 2
// с общими краями), плитка — LOG_ALONG метров вдоль бревна и LOG_AROUND вокруг, волокна вдоль бревна.
// Торцы — круги из набора house-endgrain.jpg (20 штук 5 × 4); где в клетке центр круга и его радиус,
// записано в house-endgrain.json.
const LOG_ALONG = 1.5, LOG_AROUND = 0.8;
const R = 0.13;          // м — средний радиус бревна
const COURSE = 1.7 * R;  // м — шаг венцов: бревно лежит в пазу нижнего, венцы ниже двух радиусов
const OVERHANG = 0.3;    // м — остаток бревна за углом, от оси поперечной стены
const PLINTH = 0.45;     // м — высота цоколя
const SIDES = 20;        // граней по обводу бревна
const STEP = 0.25;       // м — шаг колец вдоль бревна

const [logMap, endMap] = tiles(['assets/textures/house-log.jpg', 'assets/textures/house-endgrain.jpg']);
const ENDS = await (await fetch('assets/textures/house-endgrain.json')).json();
const LOOK = { contrast: 0.7, saturation: 0.65, scales: [0.3, 1.1], low: [0.8, 0.8, 0.8], high: [1.08, 1.04, 1.0] };
const materials = [
  soften(new THREE.MeshLambertMaterial({ map: logMap }), { ...LOOK, cells: [5, 2] }),
  soften(new THREE.MeshLambertMaterial({ map: endMap }), LOOK),
];

// Дом по зерну: размер сруба, число венцов, уклон крыши, окна и дверь.
// Стены: front и back идут вдоль x (z = ±d/2), left и right — вдоль z (x = ∓w/2).
// Проём — { wall, at (середина вдоль стены от её центра), width, bottom, top } в метрах, низ и верх — от верха цоколя.
export function planHouse(seed) {
  const rnd = generator(seed);
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const w = pick([5, 6, 6, 6.5]), d = pick([5, 6, 6]);
  const courses = 11 + Math.floor(rnd() * 3);
  const pitch = THREE.MathUtils.degToRad(38 + 8 * rnd());
  const window = (wall, at) => ({ wall, at, width: 0.75, bottom: 0.95, top: 2.1 });
  const row = (wall, length, n) => Array.from({ length: n }, (_, i) => window(wall, (i - (n - 1) / 2) * (length / n)));
  const front = w < 5.5 ? 2 : 3;
  const door = pick(['left', 'right']);
  const openings = [
    ...row('front', w, front),
    ...row('back', w, 1 + Math.floor(rnd() * 2)),
    // У двери на боку — одно окно ближе к заду, дверь ближе к улице; на другом боку — одно-два окна.
    { wall: door, at: d / 4, width: 0.9, bottom: 0.05, top: 1.95 },
    window(door, -d / 5),
    ...row(door === 'left' ? 'right' : 'left', d, 1 + Math.floor(rnd() * 2)),
  ];
  return { seed, w, d, courses, pitch, openings };
}

// Дом по плану: сруб (бок и торцы брёвен — две группы граней со своими материалами), цоколь,
// а над срубом и у цоколя — дощатые части (attic.js).
export function buildHouse(plan) {
  const { seed, w, d, courses, openings } = plan;
  const rnd = generator(seed + 1);
  const parts = { pos: [], normal: [], uv: [], side: [], end: [] };
  const walls = {
    front: { along: 'x', at: d / 2, half: w / 2, lift: -COURSE / 2 },
    back: { along: 'x', at: -d / 2, half: w / 2, lift: -COURSE / 2 },
    left: { along: 'z', at: -w / 2, half: d / 2, lift: 0 },
    right: { along: 'z', at: w / 2, half: d / 2, lift: 0 },
  };
  for (const [name, wall] of Object.entries(walls)) {
    const holes = openings.filter((o) => o.wall === name);
    for (let k = 0; k < courses; k++) {
      // Боковые стены лежат на цоколе, фасадные — на полбревна ниже: их нижний венец — полубревно,
      // стёсанное снизу по цоколю (см. log), так между венцами нигде нет щели.
      const y = R + k * COURSE + wall.lift;
      const reach = wall.half + OVERHANG + (rnd() - 0.5) * 0.06;
      const r = R * (0.92 + 0.16 * rnd());
      const butt = k % 2 ? 1 : -1; // комель — то с одного конца, то с другого
      // Бревно перерезано проёмами, сквозь которые проходит его ось.
      let pieces = [[-reach - (rnd() - 0.5) * 0.06, reach]];
      for (const o of holes) {
        if (y < o.bottom || y > o.top) continue;
        const a = o.at - o.width / 2, b = o.at + o.width / 2;
        pieces = pieces.flatMap(([p, q]) => [[p, Math.min(q, a)], [Math.max(p, b), q]].filter(([u, v]) => v - u > 0.05));
      }
      const look = { r, butt, reach, sag: 0.005 + 0.01 * rnd(), wobble: rnd() * 100, u: rnd() * 10, v: rnd() * 10 };
      for (const [from, to] of pieces) log(parts, wall, y + PLINTH, from, to, look, rnd);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(parts.pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(parts.normal, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(parts.uv, 2));
  geometry.setIndex([...parts.side, ...parts.end]);
  geometry.addGroup(0, parts.side.length, 0);
  geometry.addGroup(parts.side.length, parts.end.length, 1);
  const srub = new THREE.Mesh(geometry, materials);
  srub.castShadow = srub.receiveShadow = true;

  // Цоколь — пока простой короб под срубом, до своей текстуры.
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(w + 2 * R, PLINTH, d + 2 * R).translate(0, PLINTH / 2, 0),
    new THREE.MeshLambertMaterial({ color: 0xb9b2a4 }));
  plinth.castShadow = plinth.receiveShadow = true;
  const top = PLINTH + 2 * R + (courses - 1) * COURSE; // верх боковых стен; фасадные ниже на полбревна
  const boards = buildBoards(plan, { front: top - COURSE / 2, side: top, plinth: PLINTH, r: R, reach: w / 2 + OVERHANG });
  return new THREE.Group().add(srub, plinth, boards);
}

// Кусок бревна стены wall от from до to вдоль неё, ось на высоте y. look — общее у всех кусков одного бревна:
// радиус, с какого конца комель, провис, неровность обвода и сдвиг узора, — так перерезанное проёмом бревно
// остаётся одним бревном.
function log(parts, wall, y, from, to, { r, butt, reach, sag, wobble, u, v }, rnd) {
  // Ниже верха цоколя бревно стёсано: точка обвода не опускается под него.
  const hewn = (s, x, h) => [x, Math.max(h, PLINTH - (y - drop(s)))];
  // Точка бревна: s вдоль стены, x поперёк неё (наружу дома — по знаку wall.at), h — высота; turn — тот же поворот без сдвига.
  const turn = (s, x, h) => (wall.along === 'x' ? [s, h, x] : [x, h, s]);
  const place = (s, x, h) => turn(s, x + wall.at, h);
  const dir = turn(1, 0, 0);
  // Вдоль x рамка (s, x, h) → (x, y, z) зеркальна — обход треугольников обратный, иначе бок смотрит внутрь.
  const flip = wall.along === 'x';
  // Радиус в месте s: сбег 8 % от комля к вершине и неровность обвода — пара плавных волн по азимуту.
  const radius = (s, az) => r * (1 - 0.04 * butt * (s / reach)) * (1 + 0.025 * Math.sin(2 * az + wobble) + 0.015 * Math.sin(3 * az + 0.7 * s + wobble));
  const drop = (s) => sag * (1 - (s / reach) ** 2); // провис к середине
  const n = Math.max(1, Math.ceil((to - from) / STEP));
  const start = parts.pos.length / 3;
  for (let i = 0; i <= n; i++) {
    const s = from + ((to - from) * i) / n;
    for (let j = 0; j <= SIDES; j++) {
      const az = (j / SIDES) * 2 * Math.PI, c = Math.cos(az), sn = Math.sin(az), rr = radius(s, az);
      const [x, h] = hewn(s, c * rr, sn * rr);
      parts.pos.push(...place(s, x, y - drop(s) + h));
      parts.normal.push(...turn(0, c, sn));
      parts.uv.push(u + s / LOG_ALONG, v + (az * r) / LOG_AROUND);
      if (i && j < SIDES) {
        const a = start + i * (SIDES + 1) + j, b = a - (SIDES + 1);
        parts.side.push(...(flip ? [b, a, b + 1, b + 1, a, a + 1] : [b, b + 1, a, b + 1, a + 1, a]));
      }
    }
  }
  // Торцы: круг из набора, повёрнутый наугад; обвод торца — обвод бревна.
  for (const [s, out] of [[from, -1], [to, 1]]) {
    const cell = Math.floor(rnd() * ENDS.disc.length), [cx, cy, cr] = ENDS.disc[cell];
    const [cols, rows] = ENDS.grid, col = cell % cols, row = rows - 1 - Math.floor(cell / cols), spin = rnd() * 2 * Math.PI;
    // Точка торца (поперёк стены, вверх) → место в круге картинки, повёрнутом на spin.
    const turnEnd = (x, h) => [(x * Math.cos(spin) - h * Math.sin(spin)) / r, (x * Math.sin(spin) + h * Math.cos(spin)) / r];
    const at = (x, h) => [(col + cx + x * cr) / cols, (row + cy + h * cr) / rows];
    const center = parts.pos.length / 3;
    const [x0, h0] = hewn(s, 0, 0);
    parts.pos.push(...place(s, x0, y - drop(s) + h0));
    parts.normal.push(...dir.map((k) => k * out));
    parts.uv.push(...at(...turnEnd(x0, h0)));
    for (let j = 0; j <= SIDES; j++) {
      const az = (j / SIDES) * 2 * Math.PI, rr = radius(s, az);
      const [x, h] = hewn(s, Math.cos(az) * rr, Math.sin(az) * rr);
      parts.pos.push(...place(s, x, y - drop(s) + h));
      parts.normal.push(...dir.map((k) => k * out));
      parts.uv.push(...at(...turnEnd(x, h)));
      if (j) parts.end.push(...(out * (flip ? -1 : 1) > 0 ? [center, center + j, center + j + 1] : [center, center + j + 1, center + j]));
    }
  }
}
