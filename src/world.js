import * as THREE from 'three';
import { PHONE } from './device.js';
import { YARD } from './fence.js';
import { makePanorama } from './panorama.js';
import { makeSky, sunlight, castShadows } from './sky.js';
import { Rays } from './rays.js';
import { makeGround, makeTufts, grassTufts, mugwortTufts, nettleTufts, tansyTufts, dandelionTufts, cloverTufts, yarrowTufts, noise } from './grass.js';

// Мир вокруг двора — общий у игры и стенда дома: свет, небо с облаками, кольца панорамы, земля и трава.
// Середина двора — в начале координат, улица с воротами — к +z. Земля — по рельефу terrain.js, если он задан.
export const EYE = 1.7; // м: глаза стоя — на этой высоте горизонт панорам

// Небо светит в тень почти так же, как солнце на свету: тень на досках и стволах прозрачная, а не чёрная.
// Снизу в тень светит залитый солнцем луг. Тень облака гасит солнце там, где лежит (sky.js), а отсвет
// луга — там, где стоим: под облаком луг освещён только небом.
// Солнце низкое и сбоку — справа от взгляда со старта игры, чуть впереди: стволы освещены наполовину,
// длинные тени деревьев ложатся поперёк луга, а сквозь щели правого забора по траве тянутся полосы света.
const SUN_POWER = 2.2, MEADOW = new THREE.Color(0x8f8a66);
const SUN = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 22), THREE.MathUtils.degToRad(180 - 80));

// Окружение локации — два кольца внутри неба: средний план (луг, стога, сараи) сразу за полосой травы
// за забором и горы за ним. Самое красивое место гор — перед игроком на старте.
// far — как далеко изображённое: луг и сараи — в сотнях метров, горы — в километрах (по ним бегут тени облаков).
export const RINGS = { middle: ['tushna-mid', 45, 300], far: ['tushna', 140, 3000] };

// Свет, небо и панорамы rings — в scene. Возвращает лучи солнца (рисуются поверх кадра) и light(camera):
// перед кадром сколько солнца у камеры проходит сквозь облака (0..1) — по нему гаснет отсвет луга.
export async function makeWorld(renderer, scene, rings = Object.values(RINGS)) {
  const skyLight = new THREE.HemisphereLight(0xb4ccec, MEADOW, 1.7);
  scene.add(skyLight);
  // Тень накрывает весь участок с забором: солнце стоит, поэтому тени не дрожат. Карта 4096 — около 1,7 см
  // на точку, мельче щелей штакетника: полосы света сквозь забор читаются.
  const sun = new THREE.DirectionalLight(0xffe2b8, SUN_POWER);
  sun.position.copy(SUN).multiplyScalar(60);
  sun.castShadow = true;
  // На телефоне карта 2048 (16 МБ памяти вместо 64): на маленьком экране щели штакетника и так мельче точки.
  sun.shadow.mapSize.setScalar(PHONE ? 2048 : 4096);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -36;
  sun.shadow.camera.right = sun.shadow.camera.top = 36;
  sun.shadow.camera.far = 120;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);

  scene.add(await makeSky(SUN));
  const rays = new Rays(renderer, scene, SUN);
  for (const [name, radius, far] of rings) {
    const ring = await makePanorama(name, { radius, far, eye: EYE });
    ring.rotation.y = Math.PI / 2;
    scene.add(ring);
  }

  return {
    rays,
    light(camera) {
      const light = sunlight(camera.position);
      skyLight.groundColor.copy(MEADOW).multiplyScalar(0.5 + 0.5 * light);
      castShadows(renderer);
      return light;
    },
  };
}

// Трава густая во всём дворе и редеет за забором на 8 м.
export const fenced = (x, z) => 1 - 0.85 * THREE.MathUtils.smoothstep(Math.max(Math.abs(x) - YARD.w / 2, Math.abs(z) - YARD.d / 2), 0, 8);
// Сколько где растёт, по тому, сколько травы вообще (grass, 0..1). Полынь и крапива растут колониями от корневищ:
// пятна в несколько метров, у каждой свои, между ними их нет.
const colonies = (shift) => (x, z) => THREE.MathUtils.smoothstep(noise(x / 9 + shift, z / 9), 0.6, 0.85);
// Одуванчик низкий и в высокой траве не выживает: растёт там, где трава ниже (тот же шум 5 м, что у пучков).
const lawn = (x, z) => 1 - THREE.MathUtils.smoothstep(noise(x / 5, z / 5), 0.3, 0.6);
// Клевер тоже любит низкую траву, но разрастается куртинами по несколько метров.
const clover = (x, z) => lawn(x, z) * THREE.MathUtils.smoothstep(noise(x / 9 + 240, z / 9), 0.4, 0.7);
// Тысячелистник расползается корневищами редкими широкими пятнами, по всему двору, а не только в низкой траве.
const yarrow = (x, z) => THREE.MathUtils.smoothstep(noise(x / 12 + 190, z / 12), 0.45, 0.8);
// Число пучков — на 1000 м² там, где трава густая; высокие сорняки (tall) там, где топчут, не растут.
// lush — как сочная трава меняет густоту: злаков вдвое больше, сорняки и большинство цветов она глушит,
// одуванчик растёт и в ней.
const PLANTS = [[grassTufts, 22000, () => 0.5, false, 1], [mugwortTufts, 1700, colonies(40), true, -1], [nettleTufts, 1700, colonies(90), true, -1],
  [tansyTufts, 1100, colonies(140), true, -1], [dandelionTufts, 1700, lawn, false, 0], [cloverTufts, 5500, clover, false, -0.6], [yarrowTufts, 1200, yarrow, false, -0.6]];

// Земля со стороной ground метров и трава на квадрате со стороной size. grass(x, z) — сколько здесь травы, 0..1:
// у ствола, под домом, на дороге её нет. trodden(x, z) — насколько здесь топчут, 0..1: там трава низкая;
// lush(x, z) — насколько трава сочная, 0..1 (в лесополосе); litter(x, z) — сколько на земле хвои (в бору). Строить после shapeGround: и земля, и пучки встают по рельефу.
export function makeMeadow(grass, size, ground = 200, { trodden = () => 0, lush = () => 0, litter } = {}) {
  return new THREE.Group().add(makeGround(ground, litter), ...PLANTS.map(([atlas, perThousand, kind, tall, rich]) => makeTufts(atlas,
    Math.round(perThousand * size * size / 1000), size,
    (x, z) => grass(x, z) * kind(x, z) * (1 + rich * lush(x, z)) * (tall ? 1 - trodden(x, z) : 1), { trodden, lush })));
}
