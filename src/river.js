import * as THREE from 'three';
import { generator, smoothNoise } from './random.js';
import { tiles, soften } from './surface.js';
import { groundPatch, height } from './terrain.js';
import { windUniforms } from './wind.js';
import { atlas, makeTufts } from './grass.js';

// Речка за двором (каталог ChatGPT «Мелкая речка», 2026-11-10; ориентир — Атца). По воде 4–5,5 м
// (Никита попросил шире каталожных 2–3 м), 20–40 см глубиной, течёт вдоль двора по x и петляет. На изгибе
// с внутренней стороны — пологая галечная отмель, с внешней вода подмывает берег: короткий крутой глинистый
// откос, сверху дернина. За двором русло изгибается от двора, поэтому отмель — со стороны двора, откос —
// с дальней. Вокруг русла — пойма: её выровняла вода, поэтому длинной волны рельефа там нет (calm для
// terrain.js). Речка в низине сразу за двором: луг спускается к ней, наш берег — выпас с низкой травой,
// дальний берег выше нашего — со двора видно и воду, и тот берег (Никита, 2026-11-10). Заднего забора нет,
// боковые доходят до воды (into для fence.js).
// Всё в метрах двора, улица — к +z, речка — к −z. Рельеф отдаёт dug(x, z), как улица в road.js.
const AXIS = { z: -28, bend: 2, period: 60, wander: 1 };       // ось: середина по z, размах и длина изгиба, шум
const WIDTH = [4, 5.5], DEPTH = [0.2, 0.4];                     // м: ширина по воде, глубина в русле
const LEVEL = { at: -0.8, slope: 0.002 };                       // вода: высота у x = 0 и уклон вниз по течению (+x)
// Берег над водой: высота и ширина подъёма — у отмели внутри изгиба (low, shoal) и у откоса снаружи (high, steep).
const BANK = { low: 0.35, high: 0.7, shoal: 3, steep: 0.25 };
const LIP = { top: 0.25, edge: 0.12 };                          // неровность берегов: доля высоты откоса, м уреза
const TUFT = 0.4;                                               // м: трава на берегу — её тоже видно в отражении
const RISE = { lift: 1, run: 8 };                               // дальний луг: на сколько выше нашего, за сколько м от берега
const GRAZE = 0.8;                                              // на нашем берегу пасут: трава низкая (trodden для world.js)
const REACH = 140;                                              // м: русло в обе стороны от середины двора
const BAND = { half: 7, step: 0.1 };                            // полоса частой сетки земли вокруг русла

// Дно и голый берег — плитки ChatGPT по 1 × 1 м (tools/river.py): у отмели галька, в русле глина с илом,
// на подмытом откосе — глина откоса. Ступени blend (surface.js): 0 — галька, 1 — глина дна, 2 — глина откоса.
const BED_TILE = 1, ARC = 0.1;   // м: плитка 1 × 1 м; шаг, которым меряют путь поперёк берега
const [bankMap, bedMap] = tiles(['assets/textures/river-bank.jpg', 'assets/textures/river-bed.jpg']);
const bed = soften(new THREE.MeshLambertMaterial({ map: bankMap, vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }),
  { contrast: 0.9, saturation: 0.8, scales: [0.13, 0.5], low: [0.92, 0.92, 0.9], high: [1.02, 1.02, 1], cells: [5, 1],
    blend: { map: bedMap, cells: [5, 2], groups: [5, 5], scale: [1, 1] } });
// Камни сверху на прозрачном (tools/river.py): плитняк 12–25 см — на отмели и в воде у уреза, окатыши 8–12 см.
// Камень — выпуклая шапка по овалу картинки, чуть утопленная в дно; край камня вырезает прозрачность картинки.
const STONES = await (await fetch('assets/textures/river-stones.json')).json();
// reach, step — вдоль русла: докуда от середины двора и через сколько метров пробовать положить камень.
const STONE = { flat: 5, size: [[0.12, 0.25], [0.08, 0.12]], tall: [0.3, 0.55], sink: 0.25, ring: 10, rows: 4, reach: 55, step: 0.15 };
const stoneMaterial = new THREE.MeshLambertMaterial({ map: tiles(['assets/textures/river-stones.webp'])[0], alphaTest: 0.5 });
// Осока по урезу (tools/tufts.py): куртинами, от воды на ладонь глубиной до пары десятков сантиметров над ней.
const SEDGE = await atlas('river-sedge-tufts'), SEDGE_PER = 20000;   // попыток на 1000 м² квадрата травы
const WATER = flowingWater();

// back — z задней границы двора: от неё луг спускается к реке.
export function planRiver({ seed, back }) {
  const rnd = generator(seed + 89);
  const smooth = smoothNoise(rnd), noise = (x, k) => 2 * smooth(x, 13 * k) - 1;
  const s = THREE.MathUtils.smoothstep, phase = rnd() * 9;
  const k = (2 * Math.PI) / AXIS.period;
  // Ось и её производные по x: за серединой двора русло дальше всего от двора.
  const center = (x) => AXIS.z - AXIS.bend * Math.cos(k * x) + AXIS.wander * noise(x / 37 + phase, 1);
  const slope = (x) => (center(x + 0.05) - center(x - 0.05)) / 0.1;
  const curve = (x) => (center(x + 0.5) - 2 * center(x) + center(x - 0.5)) / 0.25;
  const level = (x) => LEVEL.at - LEVEL.slope * x;
  // Сечение у x: полуширина по воде, глубина и изгиб: 0 — прямо, ±1 — круто, знак — куда внутренняя сторона
  // (плюс — к +z). На перегибе между изгибами он проходит через 0, и берега меняются местами плавно.
  // Берега неровные: высота откоса гуляет на ±25 % через несколько метров, урез — на ладонь туда-сюда; у каждого
  // берега своё (top, edge: [к −z, к +z]).
  const section = (x) => ({
    w: (WIDTH[0] + (WIDTH[1] - WIDTH[0]) * (0.5 + 0.5 * noise(x / 23, 2))) / 2,
    d: DEPTH[0] + (DEPTH[1] - DEPTH[0]) * (0.5 + 0.5 * noise(x / 17, 3)),
    bend: THREE.MathUtils.clamp((30 * curve(x)) / (1 + slope(x) ** 2) ** 1.5, -1, 1),
    top: [1 + LIP.top * noise(x / 5, 4), 1 + LIP.top * noise(x / 5, 5)],
    edge: [LIP.edge * noise(x / 2.5, 6), LIP.edge * noise(x / 2.5, 7)],
  });
  // Поперёк русла: сколько метров от оси, плюс — к +z.
  const across = (x, z) => (z - center(x)) / Math.sqrt(1 + slope(x) ** 2);
  // Берег той стороны русла, где лежит u. Самое глубокое место (deep) сдвинуто к внешней стороне изгиба.
  // out — насколько сторона внешняя: 0 — отмель, 1 — откос, 0,5 — прямой плёс. shore — урез (от оси, со знаком),
  // top — на сколько берег поднимается над водой, run — за сколько метров от уреза: от пологой отмели до крутого откоса.
  const side = (u, { w, bend, top, edge }) => {
    const deep = -0.35 * bend * w, sign = u < deep ? -1 : 1, k = (sign + 1) / 2, out = 0.5 - 0.5 * sign * bend;
    return {
      deep, sign, out, shore: sign * (w + edge[k]),
      top: (BANK.low + (BANK.high - BANK.low) * out) * top[k],
      run: BANK.shoal * (BANK.steep / BANK.shoal) ** out,
    };
  };
  // Высота над водой в сечении sec на расстоянии u от оси. Над водой берег поднимается от уреза и выполаживается
  // к пойме. Под водой дно идёт от ровного самого глубокого места к урезу (кубика Эрмита) и у уреза уходит под воду
  // с тем же наклоном, что берег над ней: отмель полого, откос круче — но не круче, чем позволяет глубина,
  // иначе у дна вырос бы горб.
  const rise = (u, sec) => {
    const { deep, sign, shore, top, run } = side(u, sec), beyond = sign * (u - shore);
    if (beyond > 0) return top * (1 - Math.max(0, 1 - beyond / run) ** 2);
    const t = (u - deep) / (shore - deep), lean = Math.min(((2 * top) / run) * Math.abs(shore - deep), 3 * sec.d);
    return -sec.d * (2 * t ** 3 - 3 * t ** 2 + 1) + lean * (t ** 3 - t ** 2);
  };
  // Пойма: 1 у воды, 0 на лугу. От верха берега луг поднимается: дальний — за RISE.run метров на RISE.lift выше
  // нашего, наш — от самого двора. Наш склон выпуклый: у двора полого, к реке круче (бровка), — с бровки взгляд
  // со двора падает к воде, а не упирается в траву склона.
  const deepest = AXIS.z - AXIS.bend - AXIS.wander - WIDTH[1] / 2 - LIP.edge - BANK.shoal - RISE.run;
  // У точки: p — 1 у воды, 0 на лугу; far — точка за рекой; sec, u — сечение и место в нём.
  const plainAt = (x, z) => {
    if (z > back || z < deepest) return { p: 0, far: z < deepest };
    const sec = section(x), u = across(x, z), { sign, shore, run } = side(u, sec), beyond = sign * (u - shore) - run;
    if (sign < 0) return { p: 1 - s(beyond, 0, RISE.run), far: true, sec, u };
    const q = THREE.MathUtils.clamp(beyond / Math.max(2, across(x, back) - shore - run), 0, 1);
    return { p: (1 - q) ** 2, far: false, sec, u };
  };
  const plain = (x, z) => plainAt(x, z).p;
  const dug = (x, z) => {
    const { p, far, sec, u } = plainAt(x, z);
    return -(p && p * (level(x) + rise(u, sec))) - (1 - p) * (far ? RISE.lift : 0);
  };
  const steepness = (u, sec) => Math.abs(rise(u + 0.05, sec) - rise(u - 0.05, sec)) / 0.1;
  // Над водой у самого уреза и на крутом откосе травы нет — голая глина; ниже уреза — дно.
  const bare = (x, z) => {
    const { p, sec, u } = plainAt(x, z);
    return p && Math.max(1 - s(rise(u, sec), 0.06, 0.2), s(steepness(u, sec), 0.7, 1.4));
  };
  // Трава от уреза вверх по берегу: на отмели редеет к воде (там галька и песок), полная — с верха берега.
  const grass = (x, z) => {
    const { p, sec, u } = plainAt(x, z);
    if (!p) return 1;
    const { sign, shore, run } = side(u, sec);
    return s(sign * (u - shore), 0, run) * (1 - s(steepness(u, sec), 0.7, 1.4));
  };
  // Мокро ниже уреза и на пару пальцев выше: глина там темнее.
  const wet = (x, z) => 1 - s(rise(across(x, z), section(x)), 0, 0.05);
  // Чем покрыто дно (ступень blend): у уреза отмели галька, у откоса глина откоса, глубже — глина дна.
  const stage = (x, z) => {
    const sec = section(x), u = across(x, z), h = rise(u, sec);
    return THREE.MathUtils.lerp(2 * side(u, sec).out, 1, s(-h, 0.05, 0.25));
  };
  // Сколько осоки: куртинами по урезу, где берег не круче откоса.
  const sedge = (x, z) => {
    if (Math.abs(z - AXIS.z) > AXIS.bend + AXIS.wander + WIDTH[1]) return 0;
    const sec = section(x), u = across(x, z), h = rise(u, sec);
    return s(h, -0.15, -0.03) * (1 - s(h, 0.15, 0.4)) * (1 - s(steepness(u, sec), 0.5, 1)) * s(smooth(x / 3, z / 3 + 77), 0.35, 0.65);
  };
  // Камни лежат на отмели куртинами — от трёх ладоней над урезом до метра в воду; у откоса их почти нет.
  const stones = [];
  for (let x = -STONE.reach; x <= STONE.reach; x += STONE.step) {
    const sec = section(x);
    for (const sign of [-1, 1]) {
      const { out, shore } = side(sign * sec.w, sec);
      if (rnd() > (1 - out) ** 2 * s(smooth(x / 6, sign * 9), 0.3, 0.7)) continue;
      const at = x + (rnd() - 0.5) * STONE.step, u = shore - sign * (rnd() * 1.3 - 0.3);
      stones.push({ x: at, z: center(at) + u * Math.sqrt(1 + slope(at) ** 2), kind: Math.floor(rnd() * STONES.aspect.length), size: rnd(), turn: rnd() * Math.PI });
    }
  }
  // Наш берег от двора до воды — выпас (гуси, коза): трава там низкая, и со двора видно воду.
  const trodden = (x, z) => (plainAt(x, z).far ? 0 : GRAZE * s(back - z, 0, 3));
  // Докуда по z идёт боковой забор: до уреза нашего берега (open для makeFence), в воде его нет.
  const into = (x) => {
    const sec = section(x);
    return center(x) + side(sec.w, sec).shore * Math.sqrt(1 + slope(x) ** 2);
  };
  const rows = [[AXIS.z - AXIS.bend - AXIS.wander - BAND.half, Math.min(back, AXIS.z + AXIS.bend + AXIS.wander + BAND.half), BAND.step]];
  return { center, slope, level, section, across, side, rise, dug, calm: plain, grass, bare, wet, stage, sedge, stones, trodden, into, rows };
}

// Строить после makeMeadow: дно и берег лежат на куске той же сетки земли. size — сторона квадрата травы.
export function buildRiver(river, size) {
  const group = new THREE.Group();
  // Дно и голый берег: покрытие на сетке земли, к траве тает.
  const patch = groundPatch((x, z) => river.bare(x, z) > 0);
  const pos = patch.attributes.position;
  const uv = [], color = [], blend = [];
  // Плитка вдоль — по x, поперёк — по пути через профиль от оси: на крутом откосе она не тянется, а ложится «в лоб».
  const arc = (x, z) => {
    const sec = river.section(x), u = river.across(x, z), n = Math.ceil(Math.abs(u) / ARC), du = u / n;
    let path = 0, h = river.rise(0, sec);
    for (let k = 1; k <= n; k++) {
      const e = river.rise(k * du, sec);
      path += Math.hypot(du, e - h);
      h = e;
    }
    return Math.sign(u) * path;
  };
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    uv.push(x / BED_TILE, -arc(x, z) / BED_TILE);
    const tone = 1 - 0.4 * river.wet(x, z);
    color.push(tone, tone, tone, river.bare(x, z));
    blend.push(river.stage(x, z));
  }
  patch.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  patch.setAttribute('color', new THREE.Float32BufferAttribute(color, 4));
  patch.setAttribute('blend', new THREE.Float32BufferAttribute(blend, 1));
  const floor = new THREE.Mesh(patch, bed);
  floor.receiveShadow = true;
  floor.renderOrder = 1;
  group.add(floor, water(river), stones(river), makeTufts(SEDGE, Math.round((SEDGE_PER * size * size) / 1000), size, river.sedge, { trodden: river.trodden }));
  return group;
}

// Камни одной геометрией: у каждого шапка из колец вокруг макушки, высота над краем — как у половинки эллипсоида.
function stones(river) {
  const { grid: [cols, rows], aspect } = STONES, { ring } = STONE;
  const pos = [], uv = [], index = [];
  for (const { x, z, kind, size, turn } of river.stones) {
    const shape = kind < STONE.flat ? 0 : 1, [lo, hi] = STONE.size[shape], length = lo + size * (hi - lo);   // 0 — плитняк, 1 — окатыш
    const half = [length / 2, length / 2 / aspect[kind]], tall = length * STONE.tall[shape], y = height(x, z) - STONE.sink * tall;
    const cos = Math.cos(turn), sin = Math.sin(turn), u0 = (kind % cols) / cols, v0 = 1 - (Math.floor(kind / cols) + 1) / rows;
    const k = pos.length / 3, at = (i, j) => (i ? k + 1 + (i - 1) * ring + (j % ring) : k);
    for (let i = 0; i <= STONE.rows; i++) {
      const r = i / STONE.rows, lift = tall * Math.sqrt(1 - r * r);
      for (let j = 0; j < (i ? ring : 1); j++) {
        const a = (j / ring) * 2 * Math.PI, dx = r * Math.cos(a), dz = r * Math.sin(a), lx = dx * half[0], lz = dz * half[1];
        pos.push(x + lx * cos - lz * sin, y + lift, z + lx * sin + lz * cos);
        uv.push(u0 + (0.5 + 0.5 * dx) / cols, v0 + (0.5 + 0.5 * dz) / rows);
      }
    }
    // Обход — чтобы грани смотрели наружу, вверх.
    for (let j = 0; j < ring; j++) {
      index.push(k, at(1, j + 1), at(1, j));
      for (let i = 1; i < STONE.rows; i++) index.push(at(i, j), at(i + 1, j + 1), at(i + 1, j), at(i, j), at(i, j + 1), at(i + 1, j + 1));
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, stoneMaterial);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

// Вода — лента по руслу на уровне воды, шире русла: у берега её закрывает земля, урез — где они пересекаются.
// В вершинах: depth — глубина до дна, flow — метры вдоль течения и поперёк, along — направление течения,
// bank — берега для отражения: сколько метров до каждого (к −n, к +n) и как высоко он поднимается над водой
// вместе с травой. Берег для этого — стенка посередине его подъёма.
const STEP = 0.5, ACROSS = 10, MARGIN = 0.8;
function water(river) {
  const pos = [], depth = [], flow = [], along = [], bank = [], index = [];
  let path = 0;
  for (let x = -REACH, i = 0; x <= REACH; x += STEP, i++) {
    const sec = river.section(x), cz = river.center(x), y = river.level(x);
    const t = new THREE.Vector2(1, river.slope(x)).normalize(), n = new THREE.Vector2(-t.y, t.x);
    const [near, far] = [-1, 1].map((sign) => river.side(sign * sec.w, sec));
    if (i) path += STEP * Math.hypot(1, river.slope(x));
    for (let j = 0; j <= ACROSS; j++) {
      const v = (j / ACROSS - 0.5) * 2 * (sec.w + MARGIN);
      pos.push(x + n.x * v, y, cz + n.y * v);
      depth.push(-river.rise(v, sec));
      flow.push(path, v);
      along.push(t.x, t.y);
      bank.push(-near.shore + near.run / 2 + v, far.shore + far.run / 2 - v, near.top + TUFT, far.top + TUFT);
      if (i && j) {
        const c = i * (ACROSS + 1) + j, p = c - (ACROSS + 1);
        index.push(p - 1, p, c - 1, p, c, c - 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
  geometry.setAttribute('depth', new THREE.Float32BufferAttribute(depth, 1));
  geometry.setAttribute('flow', new THREE.Float32BufferAttribute(flow, 2));
  geometry.setAttribute('along', new THREE.Float32BufferAttribute(along, 2));
  geometry.setAttribute('bank', new THREE.Float32BufferAttribute(bank, 4));
  geometry.setIndex(index);
  const mesh = new THREE.Mesh(geometry, WATER);
  mesh.renderOrder = 2;
  return mesh;
}

// Вода: у кромки тонкий слой, сквозь него видно дно и камни; к середине русла цвет плотнее и дно приглушается.
// По воде бежит мелкая рябь вдоль течения — шум, сдвигаемый со временем по оси русла; рябь наклоняет нормаль.
// Отражение — по Шлику, как в лужах (road.js): сверху почти не отражает, вскользь — почти зеркало. Отражается небо,
// а у берегов — сами берега: луч, отражённый водой, уходит поперёк русла и упирается в берег, если не успел
// подняться выше него (с травой): в отражении глина и трава, бурые с зеленью. Цвета — в линейном свете, как в шейдере.
const DEEP = 0.35, CLEAR = 0.12, MURK = 0.8, FLOW = 0.35;
const SKY = 'vec3(0.78, 1.0, 1.4)', SHORE = 'vec3(0.1, 0.1, 0.055)';
function flowingWater() {
  const material = new THREE.MeshLambertMaterial({ color: 0x3e4d44, transparent: true, depthWrite: false });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, windUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float depth;
        attribute vec2 flow, along;
        attribute vec4 bank;
        varying float vDepth;
        varying vec2 vFlow, vAlong;
        varying vec4 vBank;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vDepth = depth; vFlow = flow; vAlong = along; vBank = bank;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float windTime;
        varying float vDepth;
        varying vec2 vFlow, vAlong;
        varying vec4 vBank;
        float rippleHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float rippleNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(rippleHash(i), rippleHash(i + vec2(1, 0)), f.x), mix(rippleHash(i + vec2(0, 1)), rippleHash(i + vec2(1, 1)), f.x), f.y);
        }
        // Рябь: два слоя штрихов, вытянутых поперёк течения и бегущих по нему; над отмелью гуще.
        float ripple(vec2 p) {
          float t = windTime * ${FLOW.toFixed(2)};
          return rippleNoise(p * vec2(2.0, 5.0) - vec2(3.0 * t, 0.0)) + 0.5 * rippleNoise(p * vec2(4.5, 11.0) - vec2(5.0 * t, 0.3 * t));
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        float e = 0.03, r0 = ripple(vFlow);
        vec2 slope = vec2(ripple(vFlow + vec2(e, 0.0)) - r0, ripple(vFlow + vec2(0.0, e)) - r0) / e;
        slope *= 0.012 * (1.0 + 1.5 * (1.0 - smoothstep(0.0, ${DEEP.toFixed(2)}, vDepth)));
        vec3 tilt = vec3(vAlong.x, 0.0, vAlong.y) * slope.x + vec3(-vAlong.y, 0.0, vAlong.x) * slope.y;
        normal = normalize(normal - mat3(viewMatrix) * tilt);`)
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>
        float deep = smoothstep(0.0, ${DEEP.toFixed(2)}, vDepth);
        float mirror = 0.02 + 0.98 * pow(1.0 - abs(dot(normalize(vViewPosition), normal)), 5.0);
        gl_FragColor.a = mix(${CLEAR.toFixed(2)}, ${MURK.toFixed(2)}, deep);
        vec3 ray = (vec4(reflect(-normalize(vViewPosition), normal), 0.0) * viewMatrix).xyz;
        float horiz = length(ray.xz) + 1e-4, aside = dot(ray.xz, vec2(-vAlong.y, vAlong.x)) / horiz;
        vec2 wall = aside > 0.0 ? vBank.yw : vBank.xz;
        float climb = ray.y / horiz * max(wall.x, 0.0) / max(abs(aside), 0.05);
        vec3 seen = mix(${SHORE}, ${SKY}, smoothstep(0.7, 1.3, climb / wall.y));
        gl_FragColor = mix(gl_FragColor, vec4(seen, 1.0), mirror);
        gl_FragColor.a *= smoothstep(0.0, 0.02, vDepth);`);
  };
  material.customProgramCacheKey = () => 'river';
  return material;
}
