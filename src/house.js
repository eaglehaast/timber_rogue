import * as THREE from 'three';
import { tiles, soften } from './surface.js';
import { generator, smoothNoise } from './random.js';
import { KIT } from './kit.js';
import { buildZavalinka } from './zavalinka.js';
import { buildBoards } from './attic.js';
import { buildPorch, PORCH_WIDTH } from './porch.js';
import { PANE, TRIM_ABOVE, PAINTS, PATTERNS, TULLES, LINING, buildWindows } from './window.js';

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
// Части из набора 2026-11-06 включаем по одной, когда Никита примет предыдущую (2026-11-07: начали с резьбы).
// Остальные собраны и лежат выключенными: roof, chimney, chinking, attic, door, balusters, zavalinka.
const PARTS = new Set(['carving']);
const SIDES = 20;        // граней по обводу бревна
const STEP = 0.25;       // м — шаг колец вдоль бревна

// Цоколь — старая обмазка по буту: набор house-plinth.jpg, 10 плиток 2 × 5 с общими левым и правым краем,
// плитка — PLINTH_TILE[0] метров вдоль стены и PLINTH_TILE[1] в высоту (цоколь берёт полосу из её высоты).
// Плитки почти белые и ровные, а на референсе обмазка серо-бурая, пятнами, и у земли темнее от сырости и
// брызг. Поэтому плитки темним цветом PLINTH_COLOR, их рисунок усиливаем, а пятна тона кладём не в шаг
// плиток (так у плиток, одинаковых у краёв, стык не повторяется каждые 2 м). DAMP — во сколько темнее у земли.
const PLINTH_TILE = [2, 1];
// Форма цоколя: обмазка руками по камню — стенка в буграх и вмятинах (две крупности), к низу оплыла наружу,
// углы скруглены и обиты, низ ушёл в землю. Верх ровный: на нём лежат брёвна и над ним висит отлив.
const PLINTH_SHAPE = { step: 0.04, corner: 0.07, sink: 0.08, splay: 0.035, bumps: [[0.6, 0.35, 0.04], [0.13, 0.11, 0.012]], chip: 0.025 };
const PLINTH_COLOR = [0.5, 0.48, 0.49];
const DAMP = 0.6;

const [logMap, endMap, plinthMap, chinkMap] = tiles(['assets/textures/house-log.jpg', 'assets/textures/house-endgrain.jpg', 'assets/textures/house-plinth.jpg', 'assets/textures/house-chinking.jpg']);
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
const plinthMaterial = soften(new THREE.MeshLambertMaterial({ map: plinthMap, color: new THREE.Color(...PLINTH_COLOR), vertexColors: true }), {
  contrast: 1.5, saturation: 0.6, scales: [1.4, 3.7], low: [0.7, 0.67, 0.62], high: [1.06, 1.03, 0.98], cells: [2, 5],
});

// Дом по зерну: размер сруба, число венцов, уклон крыши, окна и дверь.
// Стены: front и back идут вдоль x (z = ±d/2), left и right — вдоль z (x = ∓w/2).
// Проём — { kind (window или door), wall, at (середина вдоль стены от её центра), width, bottom, top } в метрах,
// низ и верх — от верха цоколя. Окно — по проёму наличника (PANE); наличники на доме одного узора и цвета.
export function planHouse(seed) {
  const rnd = generator(seed);
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const w = pick([5, 6, 6, 6.5]), d = pick([5, 6, 6]);
  // Над окнами — не меньше трёх венцов: под фронтоном висит резной фриз, наличник не должен в него упираться.
  const courses = 12 + Math.floor(rnd() * 3);
  const pitch = THREE.MathUtils.degToRad(38 + 8 * rnd());
  // Низ окна — 0,95 м над цоколем, а в низком срубе ниже: кокошник наличника не должен лезть выше стен.
  const sill = Math.min(0.95, 2 * R + (courses - 1) * COURSE - COURSE / 2 - TRIM_ABOVE - PANE[1] - 0.03);
  const window = (wall, at) => ({ kind: 'window', wall, at, width: PANE[0], bottom: sill, top: sill + PANE[1] });
  const row = (wall, length, n) => Array.from({ length: n }, (_, i) => window(wall, (i - (n - 1) / 2) * (length / n)));
  const front = w < 5.5 ? 2 : 3;
  const door = pick(['left', 'right']);
  const openings = [
    ...row('front', w, front),
    ...row('back', w, 1 + Math.floor(rnd() * 2)),
    // У двери на боку — одно окно ближе к заду, дверь ближе к улице; на другом боку — одно-два окна.
    // Нижнее бревно под дверью остаётся порогом, верх двери — у стыка венцов около 2 м: бревно над ней цело.
    { kind: 'door', wall: door, at: d / 4, width: 0.9, bottom: 2 * R, top: Math.round((2.0 + LINING) / COURSE) * COURSE - LINING - 0.015, porch: PORCH_WIDTH },
    window(door, -d / 5),
    ...row(door === 'left' ? 'right' : 'left', d, 1 + Math.floor(rnd() * 2)),
  ];
  const windows = { pattern: Math.floor(rnd() * PATTERNS), paint: Math.floor(rnd() * PAINTS.length), tulle: Math.floor(rnd() * TULLES) };
  // Кровля: чаще шифер, потом зелёное железо, реже рубероид и старый тёс.
  const roof = pick(['slate', 'slate', 'slate', 'metal', 'metal', 'felt', 'tes']);
  // Резьба (причелины и фриз, в цвет наличников) — у трёх домов из четырёх; чердачное окно — у всех.
  const carving = rnd() < 0.75 ? { prichelina: Math.floor(rnd() * KIT.prichelina.count), frieze: Math.floor(rnd() * KIT.frieze.count) } : null;
  const attic = Math.floor(rnd() * KIT.attic.count);
  const zavalinka = rnd() < 0.5;
  return {
    seed, w, d, courses, pitch, openings, windows, parts: PARTS,
    roof: PARTS.has('roof') ? roof : 'tes', carving: PARTS.has('carving') ? carving : null,
    attic: PARTS.has('attic') ? attic : null, zavalinka: PARTS.has('zavalinka') && zavalinka,
  };
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
  const chink = { pos: [], normal: [], uv: [], index: [] };
  for (const [name, wall] of Object.entries(walls)) {
    const holes = openings.filter((o) => o.wall === name);
    let below = null; // венец под этим: между ними — пакля
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

  const plinth = new THREE.Mesh(plinthGeometry(w / 2 + R, d / 2 + R, rnd), plinthMaterial);
  plinth.castShadow = plinth.receiveShadow = true;
  const top = PLINTH + 2 * R + (courses - 1) * COURSE; // верх боковых стен; фасадные ниже на полбревна
  const boards = buildBoards(plan, { front: top - COURSE / 2, side: top, plinth: PLINTH, r: R, reach: w / 2 + OVERHANG });
  // Наличник — пластина чуть впереди самых толстых брёвен (радиус до 1,08 R и неровность обвода до 4 %).
  const windows = buildWindows(plan, walls, { base: PLINTH, out: 1.13 * R + 0.005 });
  const door = openings.find((o) => o.kind === 'door');
  const porch = buildPorch(seed, door, walls[door.wall], { base: PLINTH, face: R, parts: plan.parts });
  const house = new THREE.Group().add(srub, chinks, plinth, boards, windows, porch);
  if (plan.zavalinka) house.add(buildZavalinka(w / 2 + R, d / 2 + R, door, rnd));
  return house;
}

// Цоколь с полуразмерами hx, hz: стенка — сетка по обходу (s) и высоте, каждая точка сдвинута по нормали
// обхода (PLINTH_SHAPE), сверху — крышка. Плитка ложится в метрах обхода, так что на углах узор не рвётся;
// по высоте сдвиг держит полосу цоколя внутри одной плитки (её верх и низ между собой не сшиты).
function plinthGeometry(hx, hz, rnd) {
  const { step, corner: c, sink, splay, bumps, chip } = PLINTH_SHAPE;
  const noise = smoothNoise(rnd);
  // Обход скруглённого прямоугольника от середины зада: прямые стены и дуги углов. at(s) — точка и нормаль наружу.
  const straight = [2 * (hx - c), 2 * (hz - c)], arc = (c * Math.PI) / 2;
  const legs = [];
  for (let k = 0; k < 4; k++) legs.push(straight[k % 2], arc);
  const perimeter = legs.reduce((a, b) => a + b);
  const at = (s) => {
    s = ((s + straight[0] / 2) % perimeter + perimeter) % perimeter; // от середины зада
    let k = 0;
    while (s > legs[k]) s -= legs[k++];
    const side = k >> 1, angle = -Math.PI / 2 + (side * Math.PI) / 2; // зад, право, фасад, лево — нормали по кругу
    const [ex, ez] = [hx - c, hz - c];
    const corners = [[-ex, -ez], [ex, -ez], [ex, ez], [-ex, ez]];
    if (k % 2 === 0) { // прямая: от угла side вдоль к углу side + 1
      const [ax, az] = corners[side], [bx, bz] = corners[(side + 1) % 4], t = s / legs[k];
      const [nx, nz] = [Math.cos(angle), Math.sin(angle)];
      return [ax + (bx - ax) * t + nx * c, az + (bz - az) * t + nz * c, nx, nz, 0];
    }
    const a = angle + (s / arc) * (Math.PI / 2), [ox, oz] = corners[(side + 1) % 4];
    return [ox + Math.cos(a) * c, oz + Math.sin(a) * c, Math.cos(a), Math.sin(a), Math.sin((s / arc) * Math.PI)];
  };
  const pos = [], uv = [], color = [], index = [];
  const u0 = rnd() * 10, v0 = rnd() * (PLINTH_TILE[1] - PLINTH);
  const cols = Math.ceil(perimeter / step), rows = Math.ceil((PLINTH + sink) / step);
  for (let i = 0; i <= cols; i++) {
    const s = (perimeter * i) / cols, [x, z, nx, nz, round] = at(s);
    for (let j = 0; j <= rows; j++) {
      const y = -sink + ((PLINTH + sink) * j) / rows, rise = Math.max(0, y) / PLINTH;
      // Шум по обходу зациклен: последний столбец совпадает с первым.
      const wrap = (f) => THREE.MathUtils.lerp(f(s, y), f(s - perimeter, y), s / perimeter);
      let out = splay * (1 - rise) ** 2;
      for (const [cs, cy, a] of bumps) out += a * (2 * wrap((p, q) => noise(p / cs, q / cy)) - 1);
      out -= chip * round * wrap((p, q) => noise(p / 0.2 + 40, q / 0.15));
      out *= THREE.MathUtils.smoothstep(PLINTH - y, 0, 0.12); // у верха — вровень с брёвнами
      pos.push(x + nx * out, y, z + nz * out);
      uv.push(u0 + s / PLINTH_TILE[0], v0 + y / PLINTH_TILE[1]);
      const k = THREE.MathUtils.lerp(DAMP, 1, rise);
      color.push(k, k, k);
      if (i && j) {
        const a = i * (rows + 1) + j, b = a - (rows + 1);
        index.push(b - 1, b, a, b - 1, a, a - 1);
      }
    }
  }
  // Крышка: веер от середины к верхнему кольцу.
  const center = pos.length / 3;
  pos.push(0, PLINTH, 0); uv.push(u0, v0); color.push(1, 1, 1);
  for (let i = 0; i < cols; i++) index.push(center, (i + 2) * (rows + 1) - 1, (i + 1) * (rows + 1) - 1);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  // Первый и последний столбцы — одни и те же точки: нормали у них общие, иначе на заду виден шов.
  const normal = geometry.attributes.normal, last = cols * (rows + 1);
  for (let j = 0; j <= rows; j++) {
    const n = new THREE.Vector3().fromBufferAttribute(normal, j).add(new THREE.Vector3().fromBufferAttribute(normal, last + j)).normalize();
    normal.setXYZ(j, n.x, n.y, n.z); normal.setXYZ(last + j, n.x, n.y, n.z);
  }
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
