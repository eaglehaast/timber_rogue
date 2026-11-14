import * as THREE from 'three';
import { generator, smoothNoise } from './random.js';
import { tiles, soften } from './surface.js';
import { groundPatch, height } from './terrain.js';
import { plantShrubs } from './shrubs.js';
import { atlas, makeTufts } from './grass.js';

// Заречье (Никита, 2026-11-13): за речкой пойменный луг, за ним поднимается склон долины — холм. Нижний склон
// крутой: на нём будут кусты облепихи и шиповника, полынь, ковыль, меловые проплешины. Выше склон положе, там
// пшеничное поле до гребня. Между ними пологая бровка (межа). Склон режут балки — промоины талой воды от поля
// к подножию; между балками остаются отроги.
// Поле — не ровная терраса, а склон до гребня: со двора видно только то, что поднимается круче взгляда снизу,
// ровный верх спрятался бы за бровкой. Гребень со двора не выше 2° над горизонтом: горы панорамы встают над ним
// на 4–9°, при холме в 11–14 м они скрылись (Никита, 2026-11-14). Отсюда и высоты ниже: весь подъём 4–5 м.
// Всё в метрах двора, речка — к −z. Рельеф отдаёт dug(x, z), как улица в road.js; terrain.js складывает.
const FOOT = { z: -52, wander: 5, period: 70 };          // м: подножие по z; на сколько и с какой волной гуляет вдоль x
const STEEP = { rise: 3, run: 14 };                      // нижний склон: на сколько поднимается, за сколько метров
const TALL = [90, 0.2];                                  // м, доля: холм вдоль x то выше, то ниже — длина волны и размах
const FIELD = { rise: 1.5, run: 38, from: 0.75 };        // поле: подъём, ширина; с какой доли нижнего склона начинается
// Балки: шаг по x, полуширина (у устья; наверху вдвое уже), глубина (в середине нижнего склона), на сколько русло виляет.
const GULLY = { gap: [35, 60], half: [5, 8], depth: [1, 1.8], wander: 4 };
const BUMPY = [14, 0.5];                                 // м: длина волны и размах бугров на склоне
const REACH = 150;                                       // м: балки по x в обе стороны от середины двора
// Пшеница — с бровки, чуть выше перегиба: край поля гуляет на wander метров. Вокруг верховьев балок не пашут.
const PLOW = { from: STEEP.run + 1, wander: 2.5 };
// Кусты (shrubs.js) пробуем ставить через step метров со сдвигом. Облепиха зарослями по балкам (thicket — где балка
// глубока) и изредка по склону (lone), шиповник редко по склону (rose) и чаще по меже у поля (edge).
const SHRUB = { step: 1.6, reach: 135, thicket: 0.7, lone: 0.03, rose: 0.025, edge: 0.2 };
// Травы склона пучками (tools/tufts.py): ковыль, чабрец, выгоревшая трава — на квадрате TUFTS метров вокруг двора
// (дальше пучков не разглядеть), TUFTS_PER попыток на 1000 м². На мелу их меньше, в поле нет.
const HILL_TUFTS = await atlas('hill-tufts'), TUFTS = 200, TUFTS_PER = 8000;

// Покрытие склона — плитки ChatGPT (tools/hills.py) поверх травы луга, на куске той же сетки земли, как дно реки.
// Ступени blend (surface.js): 0 — меловая осыпь, 1 — сухая дернина, 2 — спелое поле. Плитки поля 4 × 4 м,
// мела и дернины — 2 × 2 м. Поле и дернина издали светлее и желтее травы луга: конец лета, склон на солнце.
const FIELD_TILE = 4, GROUND_TILE = 2;
const [fieldMap, groundMap] = tiles(['assets/textures/wheat-field.jpg', 'assets/textures/hill-ground.jpg']);
const surface = soften(new THREE.MeshLambertMaterial({ map: fieldMap, vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }),
  { contrast: 0.9, saturation: 1, scales: [0.13, 0.5], low: [0.95, 0.93, 0.86], high: [1.1, 1.08, 1], cells: [4, 1],
    blend: { map: groundMap, cells: [5, 2], groups: [5, 5], scale: [FIELD_TILE / GROUND_TILE, FIELD_TILE / GROUND_TILE] } });

const bump = (u) => (Math.abs(u) < 1 ? (1 - u * u) ** 2 : 0);

export function planHills(seed) {
  const rnd = generator(seed + 61);
  const smooth = smoothNoise(rnd), noise = (x, z) => 2 * smooth(x, z) - 1;
  const s = THREE.MathUtils.smoothstep, pick = ([a, b]) => a + rnd() * (b - a), phase = rnd() * 9;
  // Подножие: z, за которым начинается подъём; tall — во сколько раз холм у x выше обычного.
  const foot = (x) => FOOT.z + FOOT.wander * noise(x / FOOT.period + phase, 3);
  const tall = (x) => 1 + TALL[1] * noise(x / TALL[0] + phase, 5);
  const gullies = [];
  for (let x = -REACH + pick(GULLY.gap) / 2; x < REACH; x += pick(GULLY.gap)) {
    gullies.push({ x, half: pick(GULLY.half), depth: pick(GULLY.depth), k: rnd() * 50 });
  }
  // Балка глубже всего в середине нижнего склона, наверху начинается в поле узкой промоиной и к устью
  // расходится. Дно балки не ниже луга: у подножия она выходит на луг, а не роет яму.
  // У точки: t — сколько метров от подножия вверх по склону, rise — подъём склона, cut — на сколько его прорезала балка.
  const top = STEEP.run + 0.3 * FIELD.run;
  const shape = (x, z) => {
    const t = foot(x) - z;
    if (t <= 0) return { t, rise: 0, cut: 0 };
    const rise = tall(x) * (STEEP.rise * s(t, 0, STEEP.run) + FIELD.rise * s(t, FIELD.from * STEEP.run, STEEP.run + FIELD.run));
    const along = s(t, 0, 0.4 * STEEP.run) * (1 - s(t, 0.8 * STEEP.run, top)), wide = 1 - 0.5 * Math.min(t / top, 1);
    let cut = 0;
    if (along) for (const g of gullies) cut += g.depth * along * bump((x - g.x - GULLY.wander * noise(z / 25, g.k)) / (g.half * wide));
    return { t, rise, cut: Math.min(cut, 0.8 * rise) };
  };
  const dug = (x, z) => {
    const { t, rise, cut } = shape(x, z);
    return t <= 0 ? 0 : -(rise - cut + BUMPY[1] * s(t, 0, 6) * noise(x / BUMPY[0], z / BUMPY[0] + 40));
  };
  // Склон — от подножия за пару метров: ниже луг с травой.
  const cover = (x, z) => s(foot(x) - z, -1, 2);
  // Поле — выше бровки, край неровный; в верховьях балок не пашут.
  const field = (x, z) => {
    const { t, cut } = shape(x, z);
    return s(t - PLOW.from - PLOW.wander * noise(x / 15, 7), 0, 1.5) * (1 - s(cut, 0.05, 0.3));
  };
  // Мел выходит там, где склон круче: на стенках балок и обрывчиках, пятнами.
  const chalk = (x, z) => {
    const e = 0.5, steep = Math.hypot(dug(x + e, z) - dug(x - e, z), dug(x, z + e) - dug(x, z - e)) / (2 * e);
    return s(steep, 0.25, 0.5) * s(noise(x / 7, z / 7 + 11), -0.3, 0.3);
  };
  const shrubs = [];
  for (let x = -SHRUB.reach; x < SHRUB.reach; x += SHRUB.step) {
    for (let t = 1; t < top + 4; t += SHRUB.step) {
      const px = x + (rnd() - 0.5) * SHRUB.step, pz = foot(px) - t + (rnd() - 0.5) * SHRUB.step;
      const f = field(px, pz), r = rnd(), turn = rnd() * 2 * Math.PI, scale = pick([0.85, 1.15]);
      if (f > 0.5) continue;
      const thicket = SHRUB.thicket * s(shape(px, pz).cut, 0.15, 0.8);
      if (r < thicket + SHRUB.lone) shrubs.push({ x: px, z: pz, species: 'seabuckthorn', kind: Math.floor(rnd() * 3) + (r < thicket ? 0 : 2), turn, scale });
      else if (r < thicket + SHRUB.lone + SHRUB.rose + SHRUB.edge * 2 * f) shrubs.push({ x: px, z: pz, species: 'rosehip', kind: Math.floor(rnd() * 3), turn, scale });
    }
  }
  return { foot, dug, cover, field, chalk, shrubs };
}

// Строить после makeMeadow: покрытие склона лежит на куске той же сетки земли и к лугу тает. На склоне — травы и кусты.
export function buildHills(hills) {
  const patch = groundPatch((x, z) => hills.cover(x, z) > 0), pos = patch.attributes.position;
  const uv = [], color = [], blend = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), field = hills.field(x, z);
    uv.push(x / FIELD_TILE, -z / FIELD_TILE);
    color.push(1, 1, 1, hills.cover(x, z));
    blend.push(1 - (1 - field) * hills.chalk(x, z) + field);
  }
  patch.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  patch.setAttribute('color', new THREE.Float32BufferAttribute(color, 4));
  patch.setAttribute('blend', new THREE.Float32BufferAttribute(blend, 1));
  const mesh = new THREE.Mesh(patch, surface);
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;
  const tufts = makeTufts(HILL_TUFTS, Math.round((TUFTS_PER * TUFTS * TUFTS) / 1000), TUFTS,
    (x, z) => hills.cover(x, z) * (1 - hills.field(x, z)) * (1 - 0.7 * hills.chalk(x, z)));
  return new THREE.Group().add(mesh, tufts, plantShrubs(hills.shrubs.map((t) => ({ ...t, y: height(t.x, t.z) }))));
}
