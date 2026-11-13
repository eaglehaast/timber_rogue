import * as THREE from 'three';
import { generator, smoothNoise } from './random.js';

// Заречье (Никита, 2026-11-13): за речкой пойменный луг, за ним поднимается склон долины — холм. Нижний склон
// крутой: на нём будут кусты облепихи и шиповника, полынь, ковыль, меловые проплешины. Выше склон положе, там
// пшеничное поле до гребня. Между ними пологая бровка (межа). Склон режут балки — промоины талой воды от поля
// к подножию; между балками остаются отроги.
// Поле — не ровная терраса, а склон до гребня: со двора видно только то, что поднимается круче взгляда снизу,
// ровный верх спрятался бы за бровкой. Гребень ниже гор панорамы, они видны над ним.
// Всё в метрах двора, речка — к −z. Рельеф отдаёт dug(x, z), как улица в road.js; terrain.js складывает.
const FOOT = { z: -52, wander: 5, period: 70 };          // м: подножие по z; на сколько и с какой волной гуляет вдоль x
const STEEP = { rise: 6, run: 22 };                      // нижний склон: на сколько поднимается, за сколько метров
const TALL = [90, 0.3];                                  // м, доля: холм вдоль x то выше, то ниже — длина волны и размах
const FIELD = { rise: 5, run: 38, from: 0.75 };          // поле: подъём, ширина; с какой доли нижнего склона начинается
// Балки: шаг по x, полуширина (у устья; наверху вдвое уже), глубина (в середине нижнего склона), на сколько русло виляет.
const GULLY = { gap: [35, 60], half: [5, 8], depth: [1.5, 2.8], wander: 4 };
const BUMPY = [14, 0.5];                                 // м: длина волны и размах бугров на склоне
const REACH = 150;                                       // м: балки по x в обе стороны от середины двора

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
  const top = STEEP.run + 0.3 * FIELD.run;
  const dug = (x, z) => {
    const t = foot(x) - z;
    if (t <= 0) return 0;
    const rise = tall(x) * (STEEP.rise * s(t, 0, STEEP.run) + FIELD.rise * s(t, FIELD.from * STEEP.run, STEEP.run + FIELD.run));
    const along = s(t, 0, 0.4 * STEEP.run) * (1 - s(t, 0.8 * STEEP.run, top)), wide = 1 - 0.5 * Math.min(t / top, 1);
    let cut = 0;
    if (along) for (const g of gullies) cut += g.depth * along * bump((x - g.x - GULLY.wander * noise(z / 25, g.k)) / (g.half * wide));
    return -(rise - Math.min(cut, 0.8 * rise) + BUMPY[1] * s(t, 0, 6) * noise(x / BUMPY[0], z / BUMPY[0] + 40));
  };
  return { dug };
}
