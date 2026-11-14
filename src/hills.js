import * as THREE from 'three';
import { generator, smoothNoise } from './random.js';
import { height } from './terrain.js';
import { plantShrubs } from './shrubs.js';
import { atlas, makeTufts, grassTufts, mugwortTufts } from './grass.js';

// Заречье (Никита, 2026-11-13 и 14): за речкой ровный пойменный луг, поодаль от воды настоящий холм — склон
// долины. Высота гребня своя у каждого зерна; высокий холм может закрыть горы панорамы, это не страшно (Никита:
// «у нас рандом»). Склон зелёный, но трава на нём степная, не как во дворе: ковыль, чабрец, выгоревшие травы,
// полынь, злаков мало. Редкие деревца облепихи, шиповник, в балках облепиха гуще. Склон режут балки — промоины
// талой воды от гребня к подножию.
// Профиль — плавный подъём от подножия до гребня, круче всего на середине; за гребнем склон уходит вниз,
// поэтому со стороны видно холм, а не ступеньку.
// Всё в метрах двора, речка — к −z. Рельеф отдаёт dug(x, z), как улица в road.js; terrain.js складывает.
const FOOT = { z: -75, wander: 5, period: 70 };          // м: подножие по z; на сколько и с какой волной гуляет вдоль x
const HIGH = [10, 16], RUN = [35, 48];                   // м: высота гребня и сколько до него от подножия — по зерну
const TALL = [90, 0.25];                                 // м, доля: холм вдоль x то выше, то ниже — длина волны и размах
const BACK = { drop: 0.3, run: 40 };                     // за гребнем: на какую долю высоты склон уходит вниз и за сколько м
// Балки: шаг по x, полуширина (у устья; наверху вдвое уже), глубина (в середине склона), на сколько русло виляет.
const GULLY = { gap: [35, 60], half: [5, 8], depth: [1.5, 3], wander: 4 };
const BUMPY = [14, 0.6];                                 // м: длина волны и размах бугров на склоне
const REACH = 150;                                       // м: балки по x в обе стороны от середины двора
// Кусты (shrubs.js) пробуем ставить через step метров со сдвигом: облепиха гуще в балках (thicket — где балка
// глубока) и редкими деревцами по склону (lone), шиповник редко по склону (rose).
const SHRUB = { step: 1.6, reach: 135, thicket: 0.15, lone: 0.008, rose: 0.015 };
// Пучки на квадрате TUFTS метров вокруг двора, попыток на 1000 м². Пойма — злаки, как луг за забором: от края
// квадрата луга двора (meadow) до подножия. Склон — травы склона (ковыль, чабрец, выгоревшая трава), полынь
// и немного злаков (доля GRASS). На склоне густо до NEAR[0] метров вверх от подножия, к NEAR[1] сходят на нет:
// дальше со двора пучков не разглядеть, зелень даёт земля.
const HILL_TUFTS = await atlas('hill-tufts'), TUFTS = 240, PLAIN_PER = 12000, HERB_PER = 7000, WORMWOOD_PER = 900, GRASS = 0.2;
const NEAR = [25, 60];

const bump = (u) => (Math.abs(u) < 1 ? (1 - u * u) ** 2 : 0);

// meadow — м от середины двора, где кончается трава луга двора (там начинается пойма).
export function planHills(seed, meadow) {
  const rnd = generator(seed + 61);
  const smooth = smoothNoise(rnd), noise = (x, z) => 2 * smooth(x, z) - 1;
  const s = THREE.MathUtils.smoothstep, pick = ([a, b]) => a + rnd() * (b - a), phase = rnd() * 9;
  const high = pick(HIGH), run = pick(RUN);
  // Подножие: z, за которым начинается подъём; tall — во сколько раз холм у x выше обычного.
  const foot = (x) => FOOT.z + FOOT.wander * noise(x / FOOT.period + phase, 3);
  const tall = (x) => 1 + TALL[1] * noise(x / TALL[0] + phase, 5);
  const gullies = [];
  for (let x = -REACH + pick(GULLY.gap) / 2; x < REACH; x += pick(GULLY.gap)) {
    gullies.push({ x, half: pick(GULLY.half), depth: pick(GULLY.depth), k: rnd() * 50 });
  }
  // У точки: t — сколько метров от подножия вверх по склону, rise — подъём, cut — на сколько его прорезала балка.
  // Балка глубже всего в середине склона, у гребня начинается узкой промоиной и к устью расходится; дно не ниже
  // луга: у подножия она выходит на луг, а не роет яму.
  const shape = (x, z) => {
    const t = foot(x) - z;
    if (t <= 0) return { t, rise: 0, cut: 0 };
    const rise = tall(x) * high * ((1 - Math.cos(Math.PI * Math.min(t / run, 1))) / 2 - BACK.drop * s(t - run, 0, BACK.run));
    const along = s(t, 0, 0.2 * run) * (1 - s(t, 0.6 * run, run)), wide = 1 - 0.5 * Math.min(t / run, 1);
    let cut = 0;
    if (along) for (const g of gullies) cut += g.depth * along * bump((x - g.x - GULLY.wander * noise(z / 25, g.k)) / (g.half * wide));
    return { t, rise, cut: Math.min(cut, 0.8 * rise) };
  };
  const dug = (x, z) => {
    const { t, rise, cut } = shape(x, z);
    return t <= 0 ? 0 : -(rise - cut + BUMPY[1] * s(t, 0, 6) * noise(x / BUMPY[0], z / BUMPY[0] + 40));
  };
  // Склон — от подножия за пару метров: ниже луг со своей травой.
  const cover = (x, z) => s(foot(x) - z, -1, 2);
  const near = (x, z) => cover(x, z) * (1 - s(foot(x) - z, NEAR[0], NEAR[1]));
  const plain = (x, z) => s(-z, meadow - 3, meadow) * (1 - cover(x, z));
  const shrubs = [];
  for (let x = -SHRUB.reach; x < SHRUB.reach; x += SHRUB.step) {
    for (let t = 1; t < run; t += SHRUB.step) {
      const px = x + (rnd() - 0.5) * SHRUB.step, pz = foot(px) - t + (rnd() - 0.5) * SHRUB.step;
      const r = rnd(), turn = rnd() * 2 * Math.PI, scale = pick([0.85, 1.15]);
      const thicket = SHRUB.thicket * s(shape(px, pz).cut, 0.3, 1.5);
      if (r < thicket + SHRUB.lone) shrubs.push({ x: px, z: pz, species: 'seabuckthorn', kind: Math.floor(rnd() * 5), turn, scale });
      else if (r < thicket + SHRUB.lone + SHRUB.rose) shrubs.push({ x: px, z: pz, species: 'rosehip', kind: Math.floor(rnd() * 3), turn, scale });
    }
  }
  return { foot, dug, cover, near, plain, shrubs };
}

// Строить после shapeGround: пучки и кусты встают по рельефу.
export function buildHills(hills) {
  const tufts = (kit, per, density) => makeTufts(kit, Math.round((per * TUFTS * TUFTS) / 1000), TUFTS, density);
  return new THREE.Group().add(
    tufts(grassTufts, PLAIN_PER, (x, z) => hills.plain(x, z) + GRASS * hills.near(x, z)),
    tufts(HILL_TUFTS, HERB_PER, hills.near), tufts(mugwortTufts, WORMWOOD_PER, hills.near),
    plantShrubs(hills.shrubs.map((t) => ({ ...t, y: height(t.x, t.z) }))));
}
