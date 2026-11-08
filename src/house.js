import * as THREE from 'three';
import { tiles, soften } from './surface.js';
import { generator } from './random.js';
import { KIT } from './kit.js';
import { buildBoards } from './attic.js';
import { brickMaterial, BRICK_TILE } from './roof.js';
import { buildPorch, porchWidth } from './porch.js';
import { PANE, TRIM_ABOVE, TRIM_BELOW, PAINT_ODDS, BLUES, PATTERNS, TULLES, LINING, buildWindows } from './window.js';
import { TRIM_ROOM, ABOVE_FRIEZE } from './carving.js';

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
export const R = 0.13;          // м — средний радиус бревна
export const COURSE = 1.7 * R;  // м — шаг венцов: бревно лежит в пазу нижнего, венцы ниже двух радиусов
export const OVERHANG = 0.3;    // м — остаток бревна за углом, от оси поперечной стены
export const PLINTH = 0.45;     // м — высота цоколя
export const THICKEST = 1.08;   // радиус бревна — от (2 − THICKEST)·R до THICKEST·R
// Боковые стены лежат на цоколе, фасадные (front, back) — на полбревна ниже.
// Пятая стена пятистенка (middle) — поперечная, рублена заодно с фасадом: на его высоте.
const LIFT = { front: -COURSE / 2, back: -COURSE / 2, middle: -COURSE / 2, left: 0, right: 0 };
// Низ проёма, стоящего на венце k стены wall: над самым толстым бревном, какое может выпасть в этом венце,
// и над обсадой. Так бревно под проёмом остаётся целым, пропил начинается сразу над ним, и щель между ними
// закрывает низ наличника (у фасада и боков венцы на разной высоте — у каждой стены свой).
const onCourse = (wall, k) => R + k * COURSE + LIFT[wall] + THICKEST * R + LINING;
// Части из набора 2026-11-06 включаем по одной, когда Никита примет предыдущую (2026-11-07: резьба, чердачное окно,
// кровля, труба с дымом; обитая дверь и перила с балясинами — всегда). Выключена пока пакля: chinking.
const PARTS = new Set(['carving', 'attic', 'roof', 'chimney']);
const SIDES = 20;        // граней по обводу бревна
const STEP = 0.25;       // м — шаг колец вдоль бревна

// Цоколь — кирпичный (кирпич трубы, roof.js) или обшитый досками стоймя (attic.js); PLINTHS — как часто.
// Обмазанный бут убран (Никита, 2026-11-07: «некрасиво»). Кирпич уходит в землю на SINK, у земли темнее в DAMP раз.
const PLINTHS = { boards: 1.2, brick: 0.8 };
const TAMBOUR_CHANCE = 0.4;
// Пятистенок — сруб длиннее, внутри пятая рубленая стена поперёк; снаружи видны её выпуски — колонна торцов
// посередине боков, как на углу. Окна бока — по обе стороны от неё, не ближе MIDDLE_GAP к её оси.
const FIVE_WALL_CHANCE = 0.35, MIDDLE_GAP = 0.65;
// Высокий сруб: боковые стены выше на KNEE венцов, крыша поднята на 1,1–1,5 м — наверху жилая комната под
// скатами с подрезанным потолком. Фасад и зад рублены во всю ширину только до прежнего верха: выше от них
// остаются лишь углы, а между углами — дощатый фронтон, опущенный до самого фриза. В нём обычное окно
// с наличником (вместо чердачного), и фриз — перемычка между брёвнами и досками.
// Окно фронтона — на GABLE_LIFT выше, чем впритык к фризу (Никита: иначе теснится к нижним).
const HIGH_CHANCE = 0.25, KNEE = [5, 7], GABLE_LIFT = 0.2;
const SINK = 0.05, DAMP = 0.6;

const [logMap, endMap, chinkMap] = tiles(['assets/textures/house-log.jpg', 'assets/textures/house-endgrain.jpg', 'assets/textures/house-chinking.jpg']);
const ENDS = await (await fetch('assets/textures/house-endgrain.json')).json();
const LOOK = { contrast: 0.7, saturation: 0.65, scales: [0.3, 1.1], low: [0.8, 0.8, 0.8], high: [1.08, 1.04, 1.0] };
const materials = [
  soften(new THREE.MeshLambertMaterial({ map: logMap }), { ...LOOK, cells: [5, 2] }),
  soften(new THREE.MeshLambertMaterial({ map: endMap }), LOOK),
];
// Пакля — жгут в пазу между венцами снаружи: половина трубки радиуса CHINK.r, торчит из паза на CHINK.out.
// Картинки — набор house-chinking.jpg (5 лент 2048 × 256 с общими краями), лента вдоль жгута — CHINK.tile метров.
// Картинка темнее брёвен, а пакля в пазу видна светлыми волокнами — поэтому светлее в CHINK.tone раз.
const CHINK = { r: 0.022, out: 0.018, tile: 0.5, arc: 6, tone: 2.2 };
const chinkMaterial = soften(new THREE.MeshLambertMaterial({ map: chinkMap, color: new THREE.Color().setScalar(CHINK.tone) }), { ...LOOK, contrast: 0.85, cells: [1, 5] });
const plinthBrick = brickMaterial({ vertexColors: true });

// Дом по зерну: размер сруба, число венцов, уклон крыши, окна и дверь.
// Стены: front и back идут вдоль x (z = ±d/2), left и right — вдоль z (x = ∓w/2).
// Проём — { kind (window или door), wall, at (середина вдоль стены от её центра), width, bottom, top } в метрах,
// низ и верх — от верха цоколя. Окно — по проёму наличника (PANE); наличники на доме одного узора и цвета.
// Номер по весам odds: чем больше вес, тем чаще выпадает; u — случайное число от 0 до 1.
const weighted = (odds, u) => {
  let x = u * odds.reduce((a, b) => a + b);
  return odds.findIndex((o) => (x -= o) < 0);
};
export function planHouse(seed) {
  const rnd = generator(seed);
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const w = pick([5, 6, 6, 6.5]), five = rnd() < FIVE_WALL_CHANCE, d = five ? pick([8, 9, 9.5]) : pick([5, 6, 6]);
  // Пятая стена делит сруб примерно пополам.
  const middle = five ? Math.round((rnd() - 0.5) * 8) / 10 : null;
  // Над окнами — не меньше трёх венцов: под фронтоном висит резной фриз, наличник не должен в него упираться.
  const high = rnd() < HIGH_CHANCE;
  const low = 12 + Math.floor(rnd() * 3), knee = high ? KNEE[0] + Math.floor(rnd() * (KNEE[1] - KNEE[0] + 1)) : 0;
  const courses = low + knee, gable = 2 * R + (low - 1) * COURSE - COURSE / 2; // низ фронтона над цоколем
  const pitch = THREE.MathUtils.degToRad(38 + 8 * rnd());
  // Низ окна — 0,95 м над цоколем, а в низком срубе ниже: кокошник наличника не должен доставать до резного фриза
  // под фронтоном (carving.js: TRIM_ROOM — сколько оставить под верхом фасадной стены).
  const sill = Math.min(0.95, gable - TRIM_ROOM - TRIM_ABOVE - PANE[1]);
  // Окно садится на ближайший венец не выше sill.
  const window = (wall, at) => {
    const bottom = onCourse(wall, Math.floor((sill - onCourse(wall, 0)) / COURSE));
    return { kind: 'window', wall, at, width: PANE[0], bottom, top: bottom + PANE[1] };
  };
  // n окон поровну по отрезку стены [a, b] (от её середины).
  const row = (wall, a, b, n) => Array.from({ length: n }, (_, i) => window(wall, a + ((i + 0.5) * (b - a)) / n));
  const front = w < 5.5 ? 2 : 3;
  const door = pick(['left', 'right']), other = door === 'left' ? 'right' : 'left';
  // Остеклённый тамбур на крыльце (porch.js) — у части домов; площадка под ним шире.
  const tambour = rnd() < TAMBOUR_CHANCE, porch = porchWidth(tambour);
  // Дверь на боку. У избы — ближе к улице, но крыльцо (с тамбуром — шире) не заходит на остатки брёвен соседней
  // стены за углом. У пятистенка — в заднюю половину, крыльцо вплотную к выпускам пятой стены.
  const doorAt = five ? middle - R - 0.1 - porch / 2 : Math.min(d / 4, d / 2 - 2 * R - porch / 2);
  // Окна боков. У избы: у двери — одно ближе к заду, на другом боку — одно-два. У пятистенка — в каждой половине
  // свои: спереди по два, сзади у двери одно (если между крыльцом и углом хватает места), напротив — одно-два.
  const edge = d / 2 - 0.5, behind = doorAt - porch / 2 - 0.1;
  const sides = five
    ? [...row(door, middle + MIDDLE_GAP, edge, 2), ...row(door, -edge, behind, behind + edge > 1.2 ? 1 : 0),
      ...row(other, middle + MIDDLE_GAP, edge, 2), ...row(other, -edge, middle - MIDDLE_GAP, 1 + Math.floor(rnd() * 2))]
    : [window(door, -d / 5), ...row(other, -d / 2, d / 2, 1 + Math.floor(rnd() * 2))];
  const openings = [
    ...row('front', -w / 2, w / 2, front),
    ...row('back', -w / 2, w / 2, 1 + Math.floor(rnd() * 2)),
    // Нижнее бревно под дверью остаётся порогом, верх двери — у стыка венцов около 2 м: бревно над ней цело.
    { kind: 'door', wall: door, at: doorAt, width: 0.9, bottom: onCourse(door, 0), top: Math.round((2.0 + LINING) / COURSE) * COURSE - LINING - 0.015, porch },
    ...sides,
    // Окна верхней комнаты высокого сруба — во фронтонах, над фризом.
    ...(high ? ['front', 'back'].map((wall) => {
      const bottom = gable + ABOVE_FRIEZE + TRIM_BELOW + GABLE_LIFT;
      return { kind: 'window', wall, at: 0, width: PANE[0], bottom, top: bottom + PANE[1] };
    }) : []),
  ];
  const windows = { pattern: Math.floor(rnd() * PATTERNS), paint: weighted(PAINT_ODDS, rnd()), tulle: Math.floor(rnd() * TULLES) };
  // Кровля: чаще шифер, потом зелёное железо, реже рубероид и старый тёс. Зелёное железо не сочетают
  // с голубыми и синими наличниками (Никита, 2026-11-07) — у таких домов его нет.
  const roof = pick(['slate', 'slate', 'slate', 'metal', 'metal', 'felt', 'tes'].filter((kind) => !(kind === 'metal' && BLUES.includes(windows.paint))));
  // Резьба (причелины и фриз, в цвет наличников) и чердачное окно — у всех.
  const carving = { prichelina: Math.floor(rnd() * KIT.prichelina.count), frieze: Math.floor(rnd() * KIT.frieze.count) };
  const attic = Math.floor(rnd() * KIT.attic.count);
  const plinth = Object.keys(PLINTHS)[weighted(Object.values(PLINTHS), rnd())];
  return {
    seed, w, d, middle, courses, knee, pitch, openings, windows, parts: PARTS,
    roof: PARTS.has('roof') ? roof : 'tes', carving: PARTS.has('carving') ? carving : null,
    attic: PARTS.has('attic') && !high ? attic : null, plinth, tambour,
  };
}

// Дом по плану: сруб (бок и торцы брёвен — две группы граней со своими материалами), цоколь,
// а над срубом и у цоколя — дощатые части (attic.js).
export function buildHouse(plan) {
  const { seed, w, d, courses, openings } = plan;
  const rnd = generator(seed + 1);
  const parts = { pos: [], normal: [], uv: [], side: [], end: [] };
  const walls = {
    front: { along: 'x', at: d / 2, half: w / 2 },
    back: { along: 'x', at: -d / 2, half: w / 2 },
    left: { along: 'z', at: -w / 2, half: d / 2 },
    right: { along: 'z', at: w / 2, half: d / 2 },
    ...(plan.middle === null ? {} : { middle: { along: 'x', at: plan.middle, half: w / 2, inner: true } }),
  };
  const chink = { pos: [], normal: [], uv: [], index: [] };
  for (const [name, wall] of Object.entries(walls)) {
    const holes = openings.filter((o) => o.wall === name);
    let below = null; // венец под этим: между ними — пакля
    for (let k = 0; k < courses; k++) {
      // Боковые стены лежат на цоколе, фасадные — на полбревна ниже: их нижний венец — полубревно,
      // стёсанное снизу по цоколю (см. log), так между венцами нигде нет щели.
      const y = R + k * COURSE + LIFT[name];
      const reach = wall.half + OVERHANG + (rnd() - 0.5) * 0.06;
      const r = R * (2 - THICKEST + 2 * (THICKEST - 1) * rnd());
      const butt = k % 2 ? 1 : -1; // комель — то с одного конца, то с другого
      // Бревно перерезано проёмами, сквозь которые проходит его ось.
      // У пятой стены внутри дома брёвна не видны — строим только выпуски за боковыми стенами.
      const start = -reach - (rnd() - 0.5) * 0.06;
      // У фасада и зада высокого сруба выше прежнего верха — только углы, между ними фронтон.
      const corners = wall.inner || (wall.along === 'x' && k >= courses - plan.knee);
      let pieces = corners ? [[start, -wall.half + R], [wall.half - R, reach]] : [[start, reach]];
      for (const o of holes) {
        // Проём пропилен по всем брёвнам, которые задевает, и шире на обсаду.
        if (y + r <= o.bottom - LINING || y - r >= o.top + LINING) continue;
        const a = o.at - o.width / 2 - LINING, b = o.at + o.width / 2 + LINING;
        pieces = pieces.flatMap(([p, q]) => [[p, Math.min(q, a)], [Math.max(p, b), q]].filter(([u, v]) => v - u > 0.05));
      }
      const look = { r, butt, reach, sag: 0.005 + 0.01 * rnd(), wobble: rnd() * 100, u: rnd() * 10, v: rnd() * 10 };
      for (const [from, to] of pieces) log(parts, wall, y + PLINTH, from, to, look, rnd);
      const course = { y: y + PLINTH, pieces, ...look };
      if (below && plan.parts.has('chinking')) chinking(chink, wall, below, course);
      below = course;
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
  const chinkGeometry = new THREE.BufferGeometry();
  for (const [name, size] of [['position', 3], ['normal', 3], ['uv', 2]]) chinkGeometry.setAttribute(name, new THREE.Float32BufferAttribute(chink[name === 'position' ? 'pos' : name], size));
  chinkGeometry.setIndex(chink.index);
  const chinks = new THREE.Mesh(chinkGeometry, chinkMaterial);
  chinks.receiveShadow = true;

  const top = PLINTH + 2 * R + (courses - 1) * COURSE; // верх боковых стен; фасадные ниже на полбревна
  const boards = buildBoards(plan, { front: top - COURSE / 2, low: top - COURSE / 2 - plan.knee * COURSE, side: top, plinth: PLINTH, r: R, reach: w / 2 + OVERHANG });
  // Наличник — пластина чуть впереди самых толстых брёвен (радиус до 1,08 R и неровность обвода до 4 %).
  const windows = buildWindows(plan, walls, { base: PLINTH, out: 1.13 * R + 0.005 });
  const door = openings.find((o) => o.kind === 'door');
  const porch = buildPorch(seed, door, walls[door.wall], { base: PLINTH, face: R, tambour: plan.tambour, tulle: plan.windows.tulle, trim: plan.windows.paint });
  const house = new THREE.Group().add(srub, chinks, boards, windows, porch);
  if (plan.plinth === 'brick') {
    const brick = new THREE.Mesh(brickPlinth(w / 2 + R, d / 2 + R, rnd), plinthBrick);
    brick.castShadow = brick.receiveShadow = true;
    house.add(brick);
  }
  return house;
}

// Кирпичный цоколь с полуразмерами hx, hz: четыре стенки от SINK под землёй до верха. Кирпич ложится в метрах
// обхода — на углах ряды не рвутся; к земле темнее (цвет вершин). Крышки нет: сверху лежат брёвна.
function brickPlinth(hx, hz, rnd) {
  const corners = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]];
  const pos = [], normal = [], uv = [], color = [], index = [];
  let u = rnd() * 10;
  corners.forEach(([ax, az], k) => {
    const [bx, bz] = corners[(k + 1) % 4], length = Math.hypot(bx - ax, bz - az), start = pos.length / 3;
    for (const [x, z, along] of [[ax, az, 0], [bx, bz, length]]) {
      for (const y of [-SINK, PLINTH]) {
        const damp = y < 0 ? DAMP : 1;
        pos.push(x, y, z); normal.push((bz - az) / length, 0, -(bx - ax) / length); color.push(damp, damp, damp);
        uv.push((u + along) / BRICK_TILE[0], y / BRICK_TILE[1]);
      }
    }
    index.push(start, start + 1, start + 2, start + 1, start + 3, start + 2);
    u += length;
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
  geometry.setIndex(index);
  return geometry;
}

// Сбег бревна (радиус без неровности обвода) и провис его оси в месте s — общие для бревна и пакли.
const taper = ({ r, butt, reach }, s) => r * (1 - 0.04 * butt * (s / reach));
const sag = ({ sag: depth, reach }, s) => depth * (1 - (s / reach) ** 2);

// Пакля между венцами below и above стены wall снаружи: там, где оба бревна целы, и между углами (за углом
// остатки брёвен разделены поперечной стеной). Жгут лежит в пазу — где обводы двух брёвен пересекаются.
function chinking(chink, wall, below, above) {
  const out = Math.sign(wall.at), end = wall.half - 0.6 * R;
  const spans = below.pieces.flatMap(([a, b]) => above.pieces.map(([c, d]) => [Math.max(a, c, -end), Math.min(b, d, end)])).filter(([a, b]) => b - a > 0.05);
  const place = (s, x, h) => (wall.along === 'x' ? [s, h, x + wall.at] : [x + wall.at, h, s]);
  const turn = (x, h) => (wall.along === 'x' ? [0, h, x] : [x, h, 0]);
  for (const [from, to] of spans) {
    const n = Math.max(1, Math.ceil((to - from) / STEP)), start = chink.pos.length / 3;
    for (let i = 0; i <= n; i++) {
      const s = from + ((to - from) * i) / n;
      // Пересечение обводов: оси на расстоянии D, радиусы ra и rb; паз — на высоте a над нижней осью, x — от оси.
      const ya = below.y - sag(below, s), D = above.y - sag(above, s) - ya, ra = taper(below, s), rb = taper(above, s);
      const a = (D * D + ra * ra - rb * rb) / (2 * D), x = Math.sqrt(Math.max(0, ra * ra - a * a)) + CHINK.out - CHINK.r;
      for (let j = 0; j <= CHINK.arc; j++) {
        const az = (j / CHINK.arc - 0.5) * Math.PI, c = Math.cos(az), sn = Math.sin(az);
        chink.pos.push(...place(s, out * (x + c * CHINK.r), ya + a + sn * CHINK.r));
        chink.normal.push(...turn(out * c, sn));
        chink.uv.push(below.u + s / CHINK.tile, j / CHINK.arc);
        if (i && j) {
          const p = start + i * (CHINK.arc + 1) + j, q = p - (CHINK.arc + 1);
          chink.index.push(...((out > 0) === (wall.along === 'x') ? [q - 1, p - 1, p, q - 1, p, q] : [q - 1, p, p - 1, q - 1, q, p]));
        }
      }
    }
  }
}

// Кусок бревна стены wall от from до to вдоль неё, ось на высоте y. look — общее у всех кусков одного бревна:
// радиус, с какого конца комель, провис, неровность обвода и сдвиг узора, — так перерезанное проёмом бревно
// остаётся одним бревном.
function log(parts, wall, y, from, to, { r, butt, reach, sag: depth, wobble, u, v }, rnd) {
  // Ниже верха цоколя бревно стёсано: точка обвода не опускается под него.
  const hewn = (s, x, h) => [x, Math.max(h, PLINTH - (y - drop(s)))];
  // Точка бревна: s вдоль стены, x поперёк неё (наружу дома — по знаку wall.at), h — высота; turn — тот же поворот без сдвига.
  const turn = (s, x, h) => (wall.along === 'x' ? [s, h, x] : [x, h, s]);
  const place = (s, x, h) => turn(s, x + wall.at, h);
  const dir = turn(1, 0, 0);
  // Вдоль x рамка (s, x, h) → (x, y, z) зеркальна — обход треугольников обратный, иначе бок смотрит внутрь.
  const flip = wall.along === 'x';
  // Радиус в месте s: сбег 8 % от комля к вершине и неровность обвода — пара плавных волн по азимуту.
  const radius = (s, az) => taper({ r, butt, reach }, s) * (1 + 0.025 * Math.sin(2 * az + wobble) + 0.015 * Math.sin(3 * az + 0.7 * s + wobble));
  const drop = (s) => sag({ sag: depth, reach }, s); // провис к середине
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
