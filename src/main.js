import * as THREE from 'three';
import { TrunkVoxels, trunkShape, VOXEL, dressWood } from './trunk.js';
import {
  section, tipping, lever, closing, contact, pivotHeight, tearAngle, slope, twist, deflection, kerfWidth, splitLength, pulledFibres, FRICTION, SLIDING,
} from './physics.js';
import { struck, wreck, pushOut } from './yard.js';
import { makeFence, YARD, HEIGHTS, GAPS, TONES, BOARD_WIDTHS, AGES, POST_WIDTHS, COATS, SHADOWS, setTone, setCoat, setShadow } from './fence.js';
import { makePanorama } from './panorama.js';
import { tiles } from './surface.js';
import { makeSaw, dressSaw, lamp, PACKS, BARS, BAR_W } from './saw.js';
import { growMaple, DENSITY } from './maple.js';
import { dressBark } from './bark.js';
import { makeGround, makeTufts, grassTufts, mugwortTufts, nettleTufts, tansyTufts, dandelionTufts, cloverTufts, yarrowTufts, noise } from './grass.js';
import { watch, note, beat, tell } from './watch.js';
import { seed, random } from './random.js';
import { wind, blow, gust, stepWind } from './wind.js';

// Пробная делянка: три дерева в ряд, далеко друг от друга, — радиус ствола выше корневых наплывов и где растёт.
const PLOT = [{ r: 0.1, x: -15 }, { r: 0.3, x: 0 }, { r: 0.2, x: 15 }];
const TREE_H = 12;
const REACH = 1.0;        // докуда достаёт пила от лица до коры
const MAX_ENTRY = 2.0;    // выше этого пилу к стволу не приставить
// Низ ствола из вокселей: выше самой высокой точки входа ещё запас, чтобы полотно, наклонённое вверх, шло по древесине.
const ZONE_H = 3.2;
const SAW_SPEED = 0.2;    // метров глубины в секунду
const SEATING = 0.04;     // ствол прошёл такую долю пути до того, как сесть на пропил, — шину вот-вот закусит
const PINCH = 3;          // мм: уже этого — закусило, цепь встала
const RESULT_SHOWN = 4000; // мс: столько итог раунда висит на экране
const SPLIT_MIN = 0.02;   // м: отщеп короче этого — волосяная трещина, её не видно и она ничего не меняет
const OPEN = 14;          // мм: шире — щель раскрывается
const LEAN = THREE.MathUtils.degToRad(0.4); // настолько наклонился ствол — это уже заметно
// Больше этого ствол стоя не наклоняется: недопил теряет устойчивость, и дальше его ведёт падение.
const SHOWN_TILT = THREE.MathUtils.degToRad(3);
const MAX_TILT = THREE.MathUtils.degToRad(60);
const MAX_TURN = THREE.MathUtils.degToRad(30);
const SNAP_DIST = 0.03;   // прицел прилипает к начатому пропилу, если почти совпал с ним
const SNAP_COS = Math.cos(THREE.MathUtils.degToRad(10));
// Глаза стоя и присев: присев можно пилить у самой земли.
const EYE = 1.7, EYE_CROUCH = 1.0;
const STRIDE = 0.75;   // м — длина шага
const STEP_RISE = 0.012; // м — на сколько опускается голова на шаге при ходьбе; бегом вдвое больше
// Точная настройка пилы: шаг стрелками и замедление мыши с зажатым Shift.
const STEP = THREE.MathUtils.degToRad(0.5);
const PLAY = VOXEL / 4;    // настолько шина болтается в щели: цепь шире шины
// Оси пилы, вокруг которых она поворачивается: в плоскости полотна, наклон носом и крен.
const TURN = new THREE.Vector3(0, 0, 1), TILT = new THREE.Vector3(1, 0, 0), ROLL = new THREE.Vector3(0, 1, 0);
const UP = new THREE.Vector3(0, 1, 0);
const FINE = 0.2;
// Летающая камера для осмотра: медленная, чтобы можно было влезть в щель, и не дальше FLY_R от ствола.
const FLY_SPEED = 0.5, FLY_R = 4, FLY_NEAR = 0.005, NEAR = 0.05;
// Ракурсы — где камера и где пила в руках; переключаются клавишей K. hold — где пила в руках:
// столько вперёд от глаз, ниже и левее, так мотор справа от взгляда. У ствола «глаза» смотрят, куда смотрел;
// «к пиле» опускает взгляд на low над пилой и смотрит между лампой и пропилом; «из-за плеча» — камера
// на back позади этого места, выше и со стороны шины (руки не заслоняют лампу), а на ходу — на back позади головы.
const SHOTS = [
  { name: 'глаза', hold: [0.8, 0.6, 0.2] },
  { name: 'к пиле', hold: [0.6, 0.28, 0.1], low: 0.45 },
  { name: 'из-за плеча', hold: [0.6, 0.35, 0.1], back: 0.8 },
];
const SWAP = 0.4; // с: столько камера переезжает из одного ракурса в другой
const G = 9.8;
const MOUSE = 0.0022;

const canvas = document.getElementById('scene');
const hudEl = document.getElementById('hud');
const hintEl = document.getElementById('hint');
const depthEl = document.getElementById('depth');
const depthFillEl = document.getElementById('depthFill');
const resultEl = document.getElementById('result');
const logEl = document.getElementById('log');
const startEl = document.getElementById('start');
const gapEl = document.getElementById('gap');
const sideEl = document.getElementById('side');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
// Свет: тёплое низкое солнце и холодная тень от неба.
// Тумана в сцене нет: край земли закрывают панорамы, а воздух нарисован на них самих.
// Угол обзора по вертикали. Широкий угол у ствола растягивает картинку и укачивает,
// поэтому по умолчанию он умеренный, а клавиши − и = его меняют.
const FOV_MIN = 40, FOV_MAX = 75;
let fov = 55;
try { fov = THREE.MathUtils.clamp(Number(localStorage.getItem('fov')) || fov, FOV_MIN, FOV_MAX); } catch {}
// Выбор пилы, шины и ракурса тоже запоминаем: что было в list под key, а нет — первое.
const recall = (key, list, fallback = list[0]) => {
  try { return list.find((v) => String(v) === localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
};
const cycle = (list, value) => list[(list.indexOf(value) + 1) % list.length];
const keep = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
const camera = new THREE.PerspectiveCamera(fov, 1, NEAR, 200);
camera.rotation.order = 'YXZ';
// Вид сбоку — справа от игрока, на всё дерево: видно, клонится ли ствол к тебе или от тебя.
// С зажатой ПКМ его можно обвести вокруг ствола, колесом — приблизить. Чем ближе камера,
// тем ниже она смотрит: от середины дерева к месту, где пилят, — так видно щель.
const sideCamera = new THREE.PerspectiveCamera(50, 0.75, 0.05, 200);
const VIEW_FAR = 16, VIEW_NEAR = 0.8, VIEW_Y = 6.5;
const VIEW_EL_MIN = THREE.MathUtils.degToRad(-10), VIEW_EL_MAX = THREE.MathUtils.degToRad(80);
const view = { base: 0, az: 0, el: 0, dist: VIEW_FAR };
let inspecting = false;

// Снизу в тень светит залитый солнцем луг: без этого стороны досок и стволов в тени уходят в черноту.
scene.add(new THREE.HemisphereLight(0xb4ccec, 0x8f8a66, 1.1));
const sun = new THREE.DirectionalLight(0xffe2b8, 2.4);
// Тень накрывает весь участок с забором: солнце стоит, поэтому тени не дрожат. Карта 4096 — около 1,7 см
// на точку, мельче щелей штакетника: полосы света сквозь забор читаются.
// Солнце низкое и сбоку — справа от взгляда со старта, чуть впереди: стволы освещены наполовину,
// длинные тени деревьев ложатся поперёк луга, а сквозь щели правого забора по траве тянутся полосы света.
const SUN = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 22), THREE.MathUtils.degToRad(180 - 80));
sun.position.copy(SUN).multiplyScalar(60);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.camera.left = sun.shadow.camera.bottom = -36;
sun.shadow.camera.right = sun.shadow.camera.top = 36;
sun.shadow.camera.far = 120;
sun.shadow.normalBias = 0.03;
scene.add(sun);

// Небо — акварельная растяжка на сфере изнутри: нижний край картинки на горизонте, верхний в зените,
// по кругу она повторяется дважды (сама бесшовная). Ниже горизонта — её нижний край.
// Краски неба, солнца и луны — как нарисованы: тональная кривая сцены их не трогает.
const skyGeo = new THREE.SphereGeometry(150, 64, 32);
{
  const p = skyGeo.attributes.position, uv = skyGeo.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setY(i, Math.max(0, Math.asin(p.getY(i) / 150) / (Math.PI / 2)));
}
const [skyMap, sunMap, moonMap] = tiles(['sky', 'sun', 'moon'].map((n) => `assets/textures/${n}.${n === 'sky' ? 'jpg' : 'png'}`));
skyMap.repeat.x = 2;
skyMap.wrapT = THREE.ClampToEdgeWrapping;
scene.add(new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ map: skyMap, side: THREE.BackSide, toneMapped: false })));
// Солнце и дневная луна — картинки, всегда лицом к игроку, на небе в 145 м. Луна в первой четверти:
// стоит на 90° восточнее солнца, левее его, и освещённым правым боком смотрит на него.
function disc(map, direction, degrees) {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, toneMapped: false, depthWrite: false }));
  sprite.position.copy(direction).multiplyScalar(145);
  sprite.scale.setScalar(145 * THREE.MathUtils.degToRad(degrees));
  return sprite;
}
scene.add(disc(sunMap, SUN, 5), disc(moonMap, SUN.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2).setY(0.4).normalize(), 4));
// Окружение локации — два кольца внутри неба: средний план (луг, стога, сараи) сразу за полосой травы
// за забором и горы за ним. Самое красивое место гор — перед игроком на старте.
for (const [name, radius] of [['tushna-mid', 45], ['tushna', 140]]) {
  const ring = await makePanorama(name, { radius, eye: EYE });
  ring.rotation.y = Math.PI / 2;
  scene.add(ring);
}

// Трава густая во всём дворе и редеет за забором на 8 м.
const meadow = (x, z) => 1 - 0.85 * THREE.MathUtils.smoothstep(Math.max(Math.abs(x) - YARD.w / 2, Math.abs(z) - YARD.d / 2), 0, 8);
// Полынь и крапива растут колониями от корневищ: пятна в несколько метров, у каждой свои, между ними их нет.
const colonies = (shift) => (x, z) => meadow(x, z) * THREE.MathUtils.smoothstep(noise(x / 9 + shift, z / 9), 0.6, 0.85);
// Одуванчик низкий и в высокой траве не выживает: растёт там, где трава ниже (тот же шум 5 м, что у пучков).
const lawn = (x, z) => meadow(x, z) * (1 - THREE.MathUtils.smoothstep(noise(x / 5, z / 5), 0.3, 0.6));
// Клевер тоже любит низкую траву, но разрастается куртинами по несколько метров.
const clover = (x, z) => lawn(x, z) * THREE.MathUtils.smoothstep(noise(x / 9 + 240, z / 9), 0.4, 0.7);
// Тысячелистник расползается корневищами редкими широкими пятнами, по всему двору, а не только в низкой траве.
const yarrow = (x, z) => meadow(x, z) * THREE.MathUtils.smoothstep(noise(x / 12 + 190, z / 12), 0.45, 0.8);
const clear = PLOT.map(({ x }) => ({ x, z: 0, r: 0.8 })).concat({ x: 0, z: 4, r: 1.5 });
// Растения сажаем в квадрате FIELD метров: весь двор и полоса за забором. Число пучков — на 1000 м².
const FIELD = 76;
const plant = (atlas, perThousand, density) => makeTufts(atlas, Math.round(perThousand * FIELD * FIELD / 1000), FIELD, clear, density);
// Забор подбираем на глаз клавишами: H — высота, G — щели, M — ширина досок, O — возраст,
// T — тон краски, N — тень;
// у столбов I — толщина, J — прокрас.
const cm = (v) => Math.round(v * 1000) / 10;
const FENCE_KEYS = {
  KeyH: ['height', HEIGHTS, 1.8, (v) => `Забор ${v} м`],
  KeyG: ['gap', Object.keys(GAPS), 'средние', (v) => `Щели ${v}`],
  KeyT: ['tone', Object.keys(TONES), 'выгоревший', (v) => `Краска: ${v}`],
  KeyI: ['postWidth', POST_WIDTHS, 0.1, (v) => `Столбы ${cm(v)} × ${cm(v)} см`],
  KeyJ: ['postCoat', Object.keys(COATS), 'как доски', (v) => `Прокрас столбов: ${v}`],
  KeyM: ['boardWidth', BOARD_WIDTHS, 0.1, (v) => `Доски ${cm(v)} см`],
  KeyO: ['age', Object.keys(AGES), 'ветхий', (v) => `Забор ${v}`],
  KeyN: ['shadow', Object.keys(SHADOWS), 'лёгкая', (v) => `Тень на заборе: ${v}`],
};
const fenceKey = (key) => `fence${key[0].toUpperCase()}${key.slice(1)}`;
const fenceLook = Object.fromEntries(Object.values(FENCE_KEYS).map(([key, list, fallback]) => [key, recall(fenceKey(key), list, fallback)]));
// Краску меняем на ходу, а размеры — пересобирая забор.
const PAINTS = ['tone', 'postCoat', 'shadow'];
function repaint() {
  setTone(TONES[fenceLook.tone]);
  setCoat(COATS[fenceLook.postCoat]);
  setShadow(SHADOWS[fenceLook.shadow]);
}
repaint();
let fence = makeFence(fenceLook);
function refence() {
  scene.remove(fence);
  fence.traverse((part) => part.geometry?.dispose());
  fence = makeFence(fenceLook);
  scene.add(fence);
}
scene.add(makeGround(200), fence, plant(grassTufts, 11000, meadow),
  plant(mugwortTufts, 1700, colonies(40)), plant(nettleTufts, 1700, colonies(90)),
  plant(tansyTufts, 1100, colonies(140)), plant(dandelionTufts, 1700, lawn), plant(cloverTufts, 5500, clover),
  plant(yarrowTufts, 1200, yarrow));

// Прицел пилы: полупрозрачная плоскость, по которой пойдёт пропил.
// Плоскость единичная: под длину шины и толщину ствола её растягивает scale.
const aimPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1),
  new THREE.MeshBasicMaterial({
    color: 0xff9a2e, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false,
  }),
);
const sawModel = makeSaw(recall('pack', PACKS), recall('bar', BARS));
scene.add(aimPlane, sawModel);
// Пила и прицел — на своём слое: их видит только взгляд игрока, а вид сбоку показывает
// одно дерево, иначе мотор заслоняет пропил.
const TOOLS = 1;
aimPlane.layers.set(TOOLS);
sawModel.traverse((part) => part.layers.set(TOOLS));
camera.layers.enable(TOOLS);

// Направление на земле задаём азимутом: 0 — вдоль +x, против часовой стрелки при взгляде сверху
// (так же, как поворот rotation.y у объектов).
const dirOf = (az) => new THREE.Vector3(Math.cos(az), 0, -Math.sin(az));
const azimuthOf = (v) => Math.atan2(-v.z, v.x);
const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const forwardOf = (yaw) => new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
const yawOf = (v) => Math.atan2(-v.x, -v.z);

const player = { pos: new THREE.Vector3(0, 0, 4), yaw: 0, pitch: 0, bob: 0, gait: 0, step: new THREE.Vector3(), eye: EYE, crouch: false };
// Осмотр с летающей камерой: игрок и пила замирают, камера летает сама по себе.
let fly = null;
const keys = new Set();
// free — ходим и смотрим; aim — пила приставлена, мышь крутит полотно; cut — пилим.
let mode = 'free';
let saw = null;
// Деревья делянки и то, с которым сейчас имеем дело: у которого пила, а без пилы — ближайшее.
// Координаты пропилов, пилы в стволе и всего, что считает физика, — от основания своего дерева (round.base).
const trees = [];
let round = null;
const local = (p) => p.clone().sub(round.base);
// Длина шины в руках: переключается клавишей B.
const barL = () => sawModel.userData.bar;

// Выше зоны пиления — клён (maple.js): скелет из осей, ствол ниже зоны идёт по форме кубиков (trunkShape)
// и выше продолжает её же сечением; кора чуть заходит в кубики, чтобы на стыке не было щели.
// Верх пока одно твёрдое тело на сгибе bend. Вес — древесина кубиков и скелета плюс листва.
function growTree(voxels) {
  const { shape } = voxels;
  const { tree, skeleton, com, mass, inertia } = growMaple(shape, ZONE_H, TREE_H, voxels.skin[0], ZONE_H - 0.03);
  const bend = new THREE.Group();
  bend.position.copy(shape.center(ZONE_H)).setY(ZONE_H - 0.03);
  tree.position.copy(bend.position).negate();
  bend.add(tree);
  bend.updateMatrixWorld(true);
  const zone = voxels.measure();
  const zoneMass = DENSITY * zone.volume;
  // Момент инерции вокруг вертикали через сгиб: свой вокруг центра тяжести плюс m·d².
  const d = com.clone().sub(bend.position);
  return {
    bend, skeleton,
    com: zone.center.multiplyScalar(zoneMass).addScaledVector(com, mass).divideScalar(zoneMass + mass),
    mass: zoneMass + mass,
    spin: inertia.elements[4] + mass * (d.x * d.x + d.z * d.z),
  };
}

// Новая делянка: все деревья вырастают заново и дует новый ветер, трава остаётся.
// Ветер смещает центр тяжести дерева на 0.05–0.25 м: под такой подобран порог, когда недопил держит.
const regrow = () => {
  blow(Math.random() * Math.PI * 2, 0.05 + Math.random() * 0.2, Math.random() * 9);
  PLOT.forEach((_, slot) => newRound(slot));
};

// Вырастить заново дерево на месте slot делянки. treeSeed — зерно, из которого оно растёт
// (по нему его можно вырастить заново из отчёта).
function newRound(slot, treeSeed = (Math.random() * 2 ** 32) >>> 0) {
  const old = trees[slot];
  if (old) scene.remove(old.root);
  const { r, x } = PLOT[slot];

  seed(treeSeed);
  const voxels = new TrunkVoxels(trunkShape(r, ZONE_H, random() * Math.PI * 2), ZONE_H, [dressBark(), dressWood()]);
  voxels.remesh();
  const tree = growTree(voxels);
  const upper = new THREE.Group();
  upper.add(tree.bend);

  const root = new THREE.Group();
  root.position.set(x, 0, 0);
  voxels.standing = true;
  upper.add(voxels.lift);
  root.add(voxels.group, upper);
  scene.add(root);
  const yard = []; // постройки (yard.js) пока убраны: отвлекают от дерева
  root.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });

  round = trees[slot] = {
    slot, base: root.position, root, voxels, upper, yard, ...tree,
    weight: tree.mass * G,
    seed: treeSeed,
    time: 0, sway: new THREE.Vector3(), tilt: new THREE.Vector3(), bent: new THREE.Vector3(), gap: null,
    // Насколько недопил поддался насовсем, вокруг какой оси, куда и с какой скоростью сейчас поворачивается.
    give: { tilt: new THREE.Vector3(), at: new THREE.Vector3(), u: null, speed: 0 },
    sec: null, secVersion: -1,
    twist: null, turn: 0, // как косые площадки закручивают верх вокруг вертикали и на сколько закрутили
    split: 0, tongue: new Set(), // на сколько недопил отщепился вверх и какие его колонки
    cuts: [], debris: [], left: [], // зажатые пилы, брошенные в стволе
    top: false, slide: null, fall: null, done: false,
    said: {},
  };
  if (saw?.tree === old) {
    mode = 'free';
    saw = null;
  }
  resultEl.hidden = true;
  logEl.replaceChildren();
}

// Поворот пилы, которую держат горизонтально и смотрят по yaw. В осях пилы x — вдоль шины (side),
// y — куда шина идёт в древесину (along), z — перпендикуляр к полотну (normal).
function facing(yaw) {
  const along = forwardOf(yaw);
  const side = new THREE.Vector3(-along.z, 0, along.x);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, along, side.clone().cross(along)));
}

// Пропил: точка входа на коре (origin), где сейчас режущая кромка шины (edge), поворот пилы q
// и сколько кромка прошла по древесине (depth). Кромка — середина края шины, которым она режет.
function basis(cut) {
  const axis = (x, y, z) => new THREE.Vector3(x, y, z).applyQuaternion(cut.q);
  return { origin: cut.edge, side: axis(1, 0, 0), along: axis(0, 1, 0), normal: axis(0, 0, 1) };
}

// Высота плоскости пропила над точкой (x, z) волокна f.
function planeY({ origin, normal }, f) {
  return origin.y - ((f.x - origin.x) * normal.x + (f.z - origin.z) * normal.z) / normal.y;
}

// Сколько пройти по линии at(t), пока не войдёшь в ствол, и сколько — пока не выйдешь из него.
// Ствол не цилиндр, поэтому идём шагами в кубик, а где перешагнули кору — делим шаг пополам до 1 мм.
// Не дошли до ствола за limit — null, дальше limit не смотрим.
function throughTrunk(at, limit) {
  const inside = (t) => {
    const p = at(t);
    return round.voxels.under(p);
  };
  const cross = (t, into) => {
    while (inside(t) !== into) if ((t += VOXEL) > limit + VOXEL) return Infinity;
    let lo = Math.max(0, t - VOXEL);
    while (t - lo > VOXEL / 10) {
      const mid = (lo + t) / 2;
      if (inside(mid) === into) t = mid;
      else lo = mid;
    }
    return t;
  };
  const enter = cross(0, true);
  return enter <= limit ? { enter, exit: Math.min(cross(enter, false), limit) } : null;
}

// То же для всей кромки шины: она прямая, а ствол круглый и не по центру, поэтому в кору первой
// упирается та точка кромки, что к ней ближе, и выходит из коры последней та, за которой древесины больше.
function acrossBar(origin, along, side, limit) {
  let enter = Infinity, exit = 0;
  for (let w = -barL() / 2; w <= barL() / 2; w += 2 * VOXEL) {
    const from = origin.clone().addScaledVector(side, w);
    const hit = throughTrunk((t) => from.clone().addScaledVector(along, t), limit);
    if (!hit) continue;
    enter = Math.min(enter, hit.enter);
    exit = Math.max(exit, hit.exit);
  }
  return enter < Infinity ? { enter, exit } : null;
}

// Корпус пилы толще щели: в древесину он не входит, а упирается в неё краем силуэта (обвод, rim из saw.js).
// Сколько кромке с поворотом q пройти от edge по ходу пилы, пока корпус не коснётся ствола, — не дальше limit.
// Меньше нуля — корпус уже в древесине.
function bodyRoom(edge, q, limit) {
  const { side, along, normal } = basis({ edge, q });
  let room = limit;
  for (const p of sawModel.userData.rim) {
    const from = edge.clone().addScaledVector(side, p.x).addScaledVector(along, p.y - BAR_W / 2).addScaledVector(normal, p.z);
    const hit = throughTrunk((t) => from.clone().addScaledVector(along, t), Math.max(0, room));
    // throughTrunk отдаёт точку уже в древесине, а за десятую долю кубика до неё — ещё снаружи.
    if (hit) room = Math.min(room, hit.enter - VOXEL / 10);
    if (room < 0) break;
  }
  return room;
}

// Сколько древесины впереди кромки по ходу пилы — до коры на той стороне ствола.
function ahead(cut) {
  const { origin, along, side } = basis(cut);
  return acrossBar(origin, along, side, 2 * REACH)?.exit ?? 0;
}

// Высота, на которой пила войдёт в кору, если кора по горизонтали в bark от игрока.
function entryHeight(bark) {
  return THREE.MathUtils.clamp(player.eye + Math.tan(player.pitch) * bark, 0.05, MAX_ENTRY);
}

// Расстояние по горизонтали до коры там, куда упирается взгляд.
function distanceToBark(forward) {
  const at = (t) => local(player.pos).addScaledVector(forward, t).setY(entryHeight(t));
  return throughTrunk(at, REACH)?.enter ?? null;
}

// Куда встанет пила, если приставить её сейчас: точка на коре под прицелом, полотно горизонтально.
// Если рядом начатый пропил того же направления, пила встаёт в него.
function sawCandidate(forward) {
  const bark = distanceToBark(forward);
  if (bark === null || bark > REACH) return null;
  // Кромка встаёт туда, где она коснулась коры, — на высоте точки под прицелом. Точка под прицелом
  // касается коры на bark; если никакая другая точка кромки не касается раньше, касание — она.
  const from = local(player.pos).setY(entryHeight(bark));
  const side = new THREE.Vector3(-forward.z, 0, forward.x);
  const q = facing(player.yaw);
  const touch = Math.min(acrossBar(from, forward, side, bark)?.enter ?? bark, bodyRoom(from, q, bark));
  const origin = from.addScaledVector(forward, touch);
  const fresh = { tree: round, origin, edge: origin.clone(), q, depth: 0 };
  const f = basis(fresh);
  return round.cuts.find((c) => {
    if (c.pinched) return false;
    const { normal, along } = basis(c);
    return normal.dot(f.normal) > SNAP_COS
      && along.dot(f.along) > SNAP_COS
      && Math.abs(origin.clone().sub(c.origin).dot(normal)) < SNAP_DIST;
  }) ?? fresh;
}

// Где середина шины (она на полширины позади кромки) и как пила повёрнута. shift — сдвиг от кромки по ходу.
function pose(cut, shift = -BAR_W / 2) {
  const b = basis(cut);
  return { position: b.origin.clone().addScaledVector(b.along, shift), quaternion: cut.q.clone() };
}

// Зажатую пилу бросаем в стволе: там остаётся её копия без рук, а в руках — запасная. Пробуем — пил сколько угодно.
// Когда дерево легло, пропил разжимается, и брошенные пилы забираешь обратно (land).
function leaveSaw() {
  const left = sawModel.clone();
  const hands = [];
  left.traverse((part) => {
    part.layers.set(0);
    if (part.name === 'hand') hands.push(part);
  });
  hands.forEach((hand) => hand.removeFromParent());
  const at = pose(saw);
  left.position.copy(at.position);
  left.quaternion.copy(at.quaternion);
  round.root.add(left);
  round.left.push(left);
  unsay('pinch');
  unsay('narrow');
}

// Пилу держат горизонтально перед собой, шиной поперёк взгляда. У ствола она встаёт туда,
// где пойдёт пропил, и переходит туда плавно: руки доворачивают пилу, а не она прыгает.
function moveSaw(cut, shake, dt) {
  const target = pose(cut);
  target.position.add(round.base).add(shake);
  const k = 1 - Math.exp(-15 * dt);
  sawModel.position.lerp(target.position, k);
  sawModel.quaternion.slerp(target.quaternion, k);
}

// Центр тяжести над срезом с поправкой на ветер, на наклон ствола и на то, куда съехал перерезанный верх.
function centerOfMass() {
  const c = round.com.clone().add(round.sway).addScaledVector(round.tilt, round.com.y);
  if (round.slide) c.addScaledVector(round.slide.dir, round.slide.s * Math.cos(round.slide.tilt));
  return c;
}

// Фраза о том, что происходит с деревом. Каждое состояние объявляется один раз, пока не сменится.
function say(key, text) {
  if (round.said[key]) return;
  round.said[key] = true;
  const line = document.createElement('div');
  line.textContent = text;
  logEl.append(line);
  setTimeout(() => line.remove(), 6000);
}

const unsay = (key) => { round.said[key] = false; };

// Треск волокон: редкие щелчки шума, затухающие за треть секунды.
let audio = null;
function crack(power) {
  audio ??= new AudioContext();
  const len = Math.floor(audio.sampleRate * 0.35);
  const buffer = audio.createBuffer(1, len, audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) {
    data[i] = Math.random() < 0.08 ? (Math.random() * 2 - 1) * Math.exp(-i / (audio.sampleRate * 0.08)) : 0;
  }
  const source = audio.createBufferSource();
  source.buffer = buffer;
  const gain = audio.createGain();
  gain.gain.value = 0.25 * power;
  source.connect(gain).connect(audio.destination);
  source.start();
}

// Стоящее дерево: качает ветром, недопил гнётся под весом, и после каждого кубика
// пересчитываем, держит ли он дерево.
function stand(dt) {
  round.time += dt;
  const g = gust(round.base);
  round.sway.copy(wind.dir).multiplyScalar(g * wind.max);
  if (round.voxels.version && round.secVersion !== round.voxels.version) {
    round.sec = section(round.voxels);
    round.secVersion = round.voxels.version;
  }
  const { sec } = round;
  // Наклон ствола — упругий изгиб недопила и то, на сколько он уже осел насовсем (round.give).
  const { give } = round;
  if (sec) {
    const c = round.com.clone().add(round.sway).addScaledVector(give.tilt, round.com.y);
    round.bent = deflection(sec, c, round.weight, round.com.y, round.split);
    // Упругий наклон больше SHOWN_TILT — недопил потерял устойчивость: дальше дерево поворачивается
    // уже не упруго, а поддаваясь (yieldHinge), туда, куда его клонит.
    round.buckle = round.bent.length() > SHOWN_TILT ? round.bent.clone().normalize() : null;
    if (round.buckle) round.bent.set(0, 0, 0);
    round.tilt.copy(round.bent).add(give.tilt);
    // Косые площадки, на которые сел верх, закручивают его вокруг вертикали. Что сверх трения —
    // держит остаток недопила и закручивается на это упруго.
    round.twist = twist(sec, round.bent, give, round.weight, round.split);
    const tw = round.twist;
    const over = tw ? THREE.MathUtils.clamp(Math.abs(tw.drive) - tw.rub, 0, tw.hold) : 0;
    round.turn = over ? (Math.sign(tw.drive) * over) / tw.stiff : 0;
  }

  // Крона качается вокруг сгиба: смещение веса делим на высоту над сгибом. А весь верх над
  // пропилом клонится: упруго — вокруг центра недопила, осевший — вокруг оси, у которой осел.
  // Так щель видно смыкающейся там, где она сомкнулась, и раскрывшейся там, где раскрылась.
  // Перерезанный насквозь верх ещё и сел на пропил.
  const sway = new THREE.Quaternion().setFromAxisAngle(
    UP.clone().cross(wind.dir), (g * wind.max) / (round.com.y - ZONE_H),
  );
  round.bend.quaternion.copy(sway);
  if (!sec) return;
  const turn = (v, most = Infinity) => new THREE.Quaternion().setFromAxisAngle(
    UP.clone().cross(v).normalize(), Math.min(v.length(), most),
  );
  const y = (round.voxels.middle + 0.5) * VOXEL;
  // Поворот q вокруг точки at поверх того, что уже сделано.
  const spin = (q, at) => {
    round.upper.quaternion.premultiply(q);
    round.upper.position.sub(at).applyQuaternion(q).add(at);
  };
  // Сначала закрутка вокруг вертикали через остаток, потом упругий наклон вокруг центра недопила,
  // потом осевший — вокруг оси, у которой осел.
  round.upper.quaternion.identity();
  round.upper.position.set(0, 0, 0);
  if (round.twist) {
    const { o } = round.twist;
    spin(new THREE.Quaternion().setFromAxisAngle(UP, round.turn), new THREE.Vector3(o.x, y, o.z));
  }
  spin(turn(round.bent), new THREE.Vector3(sec.x0, y, sec.z0));
  spin(turn(give.tilt), give.at.clone().setY(y));
  round.upper.position.y -= sec.sink;

  const c = centerOfMass();
  if (g > 0.8) say('gust', 'Порыв ветра качнул крону');
  else if (g < 0.4) unsay('gust');
  if (round.tilt.length() > LEAN) say('lean', 'Ствол начал клониться — смотри вид сбоку');
  else if (round.tilt.length() < LEAN / 2) unsay('lean');

  if (!sec.intact.length) {
    const s = slope(sec);
    if (s.tilt > Math.atan(FRICTION)) return startSlide(s);
  }
  const tw = round.twist;
  if (tw && Math.abs(tw.drive) - tw.rub > tw.hold) return startTwist(tw, c);
  const tip = tipping(sec, c, round.weight, round.tilt);
  if (tip.net > 0 || give.speed > 0 || round.buckle) {
    yieldHinge(sec, tip, c, dt);
    if (round.fall) return;
  }

  splitHinge(sec, tip, Math.min(1, tip.ratio));

  if (!sec.intact.length) say('free', 'Ствол перерезан насквозь, но стоит: вес пока над пнём');
  else if (tip.ratio > 0.7) {
    if (!round.said.creak) crack(0.3);
    say('creak', 'Недопил потрескивает — ещё немного');
  } else if (tip.ratio < 0.5) unsay('creak');

  // Щель под шиной: наклон ствола её сжимает или раскрывает. Шина лежит поперёк ствола, и когда он
  // клонится вбок, у одного её конца щель смыкается раньше — берём самое узкое место там, где шина в древесине.
  round.gap = null;
  if (saw?.tree !== round || saw.depth < 0.05) return;
  const b = basis(saw);
  for (let w = -barL() / 2; w <= barL() / 2; w += VOXEL) {
    const p = b.origin.clone().addScaledVector(b.side, w);
    if (!round.voxels.shape.contains(p.x, p.y, p.z)) continue;
    const g = kerfWidth(sec, round.bent, give, p);
    if (round.gap === null || g < round.gap) round.gap = g;
  }
  if (round.gap === null) return;
  // Ствол клонится, пока щель где-то не сомкнётся, — тогда он сел на пропил. Если шина с той стороны,
  // куда он клонится, щель над ней сужается, а когда сел на эту же щель, вес прижимает её к шине
  // до конца: древесина не камень, под весом проминается. Сел на другой пропил — вес ушёл туда.
  const squeezed = round.gap < VOXEL * 1000;
  const lean = round.bent.length();
  let seat = 0, touch = null;
  if (lean) {
    const dir = round.bent.clone().divideScalar(lean);
    const p = sec.x0 * dir.x + sec.z0 * dir.z;
    seat = lean / closing(sec, dir, p, 0);
    touch = contact(sec, dir, p);
  }
  if (squeezed && seat >= 1 - 1e-6 && Math.abs(planeY(b, touch) - touch.mid) <= VOXEL) round.gap = 0;
  if (mode !== 'cut') return;
  // Сужение — предупреждение. Кто пилит дальше, тот зажимает шину: цепь встаёт, пилу не вынуть.
  if (round.gap < PINCH) {
    saw.pinched = true;
    mode = 'aim';
    say('pinch', 'Шину зажало: щель сомкнулась, цепь встала. Пилу не вынуть');
  } else if (squeezed && seat > SEATING) {
    say('narrow', 'Щель сужается — вес давит на шину, сейчас закусит');
    unsay('open');
  } else if (round.gap > OPEN) {
    say('open', 'Щель раскрывается — ствол уходит от пилы');
    unsay('narrow');
  }
}

// Перетянуло — недопил поддаётся, и дерево поворачивается вокруг его оси, набирая скорость, как при
// падении: I·φ'' = W·плечо − держит недопил. Держит он тем слабее, чем ближе к разрыву, но впереди
// оси смыкаются щели, и сжатых волокон становится больше. Вес отпустило (стих ветер) или щели удержали —
// дерево тормозит и встаёт в новом положении, назад недопил не разгибается. Дошло до разрыва недопила
// или до того, что сомкнулся вырез подпила, — падает дальше с набранной скоростью.
function yieldHinge(sec, tip, c, dt) {
  const { give } = round;
  const u = give.speed > 0 ? give.u : round.buckle ?? tip.u;
  const lean = Math.max(0, round.tilt.dot(u));
  const t = lever(sec, c, round.weight, u, lean);
  const tear = tearAngle(sec, u, round.split);
  // Потерявший устойчивость недопил не держит, пока ствол не сел на щель впереди.
  const seated = lean >= closing(sec, u, sec.x0 * u.x + sec.z0 * u.z, 0);
  const hold = round.buckle && !seated ? 0 : round.buckle ? Infinity : t.hold * Math.max(0, 1 - lean / tear);
  const inertia = (4 / 3) * round.mass * ((c.dot(u) - t.p) ** 2 + round.com.y ** 2);
  give.speed = Math.max(0, give.speed + ((t.pull - hold) / inertia) * dt);
  if (!give.speed) {
    unsay('yield');
    say('stood', 'Ствол встал: щель за недопилом осталась раскрытой');
    return;
  }
  if (!round.said.yield) crack(0.4);
  say('yield', 'Недопил поддаётся — щель за ним раскрывается');
  unsay('stood');
  give.u = u;
  give.tilt.addScaledVector(u, give.speed * dt);
  give.at.copy(u).multiplyScalar(t.p);
  if (lean >= Math.min(tear, closing(sec, u, t.p))) startFall(t, c, 0, give.speed);
}

// Дерево висит на недопиле: тот тянет пень вверх с долей load от своей прочности и отщепляется
// от кромки пропила вверх, в ствол (splitLength). Трещина не зарастает: отщеп только растёт.
function splitHinge(sec, tip, load) {
  const split = splitLength(sec, tip, load);
  if (split < SPLIT_MIN || split < round.split + VOXEL) return;
  round.split = split;
  round.tongue = new Set(pulledFibres(sec, tip).map((f) => f.col));
  round.voxels.splinter(round.tongue, split);
  round.voxels.remesh();
  crack(0.5);
  say('split', 'Треск вдоль ствола — его раскалывает вверх от недопила');
}

// Верх отделился от пня (недопил рвётся на высоте h) и дальше движется с upper. Что на пне
// после этого ни на чём не держится — кусок между пропилами, обрывок коры, — отваливается.
function separate(h, tongue, split) {
  round.upper.add(round.voxels.splitTop(h, tongue, split).group);
  round.voxels.breakLoose().forEach(dropPiece);
  round.top = true;
}

// Верх перерезан по косой круче, чем держит трение, — он съезжает по срезу.
function startSlide(s) {
  separate(round.voxels.middle * VOXEL);
  round.slide = { ...s, s: 0, v: 0 };
  dropSaw();
  crack(0.6);
  say('slide', 'Косой рез — ствол поехал вниз по срезу!');
}

function slideTop(dt) {
  const sl = round.slide;
  sl.v += G * (Math.sin(sl.tilt) - SLIDING * Math.cos(sl.tilt)) * dt;
  sl.s += sl.v * dt;
  round.upper.position.copy(sl.dir).multiplyScalar(sl.s * Math.cos(sl.tilt)).setY(-sl.s * Math.sin(sl.tilt));
  const c = centerOfMass();
  const tip = tipping(round.sec, c, round.weight, round.tilt);
  if (tip.net > 0) {
    round.slide = null;
    startFall(tip, c, sl.v * Math.cos(sl.tilt) * sl.dir.dot(tip.u));
  }
}

// Остаток недопила скрутило и порвало (а перерезанный насквозь верх сорвался с площадок):
// целых волокон больше нет. Верх проворачивается на косых срезах, сходит с них и валится туда,
// куда смещён его вес от оси, вокруг которой крутился.
function startTwist(tw, c) {
  round.sec = { ...round.sec, intact: [] };
  const u = new THREE.Vector3(c.x - tw.o.x, 0, c.z - tw.o.z).normalize();
  crack(0.8);
  say('twist', 'Ствол провернулся на косых срезах — остаток скрутило!');
  startFall({ u, p: tw.o.x * u.x + tw.o.z * u.z, hold: 0 }, c);
  // Пока верх ещё на площадках, они крутят его дальше: момент сверх трения скольжения.
  const push = Math.abs(tw.drive) - (tw.rub * SLIDING) / FRICTION;
  round.fall.spin = { speed: 0, push: (Math.sign(tw.drive) * push) / round.spin };
}

// Дерево пошло: поворачивается вокруг оси недопила. Пока недопил цел, он держит дерево
// в плоскости падения и тормозит, слабея с наклоном; дальше дерево летит само.
// slip — с какой скоростью верх ещё съезжает через кромку, если до этого скользил по косому резу.
// speed — с какой скоростью дерево уже поворачивается, если недопил поддавался.
function startFall(tip, c, slip = 0, speed = 0) {
  const { sec } = round;
  const h = pivotHeight(sec, tip.u, tip.p);
  // Падая, дерево тянет недопил, пока тот не порвётся, то есть до полной прочности.
  if (sec.intact.length) splitHinge(sec, tip, 1);
  if (!round.top) separate(h, round.tongue, round.split);
  const pivot = new THREE.Group();
  pivot.position.copy(tip.u).multiplyScalar(tip.p).setY(h);
  round.root.add(pivot);
  pivot.attach(round.upper);

  const a = c.dot(tip.u) - tip.p;
  // На сколько недопил уже поддался — на столько раньше он порвётся и сомкнётся подпил.
  // Поддался дальше, чем гнётся, — он уже порван, и дерево летит само.
  const given = Math.max(0, round.give.tilt.dot(tip.u));
  const tear = sec.intact.length ? tearAngle(sec, tip.u, round.split) - given : 0;
  const hinge = tear > 0;
  round.fall = {
    pivot, u: tip.u.clone(), p: tip.p, axis: UP.clone().cross(tip.u),
    angle: 0, speed, hinge,
    a, b: round.com.y + round.upper.position.y - h, // съехавший верх опустился
    hold: tip.hold,
    tear,
    shut: hinge ? closing(sec, tip.u, tip.p) - given : Infinity,
    edge: Math.max(...sec.all.map((f) => f.x * tip.u.x + f.z * tip.u.z)),
    lateral: c.clone().setY(0).addScaledVector(tip.u, -c.dot(tip.u)),
    len: TREE_H - h,
    slip: Math.max(0, slip),
    knots: [],
  };
  round.bend.traverse((o) => { if (o.name === 'trunk') round.fall.knots.push(o); });
  dropSaw();
  crack(1);
  say('go', hinge ? 'Хруст! Пропил за недопилом раскрылся — дерево пошло' : 'Дерево пошло!');
}

// Дерево пошло — пилу от него убираешь. Пила у другого дерева так и остаётся в руках.
function dropSaw() {
  if (saw?.tree !== round) return;
  mode = 'free';
  saw = null;
}

// Повернуть падающий верх вокруг оси падения ещё на angle.
function tip(f, angle) {
  f.angle += angle;
  f.pivot.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(f.axis, angle));
}

// Дерево легло, когда стволом коснулось земли (узлы ствола — точки на оси через полметра); ветви под ним ломаются.
// Не по углу: клён кривой, и клонившийся туда же, куда падает, ложится раньше, чем повернётся на 90°.
function grounded(f) {
  round.upper.updateWorldMatrix(true, true);
  const at = new THREE.Vector3();
  return f.knots.some((k) => k.getWorldPosition(at).y <= k.userData.r);
}

// Недопила больше нет: дерево уже никто не держит в плоскости, и вбок его уводит
// то, что вес был смещён в сторону от линии падения.
function release(f) {
  f.hinge = false;
  const lever = f.a * Math.cos(f.angle) + f.b * Math.sin(f.angle);
  f.u = f.u.clone().multiplyScalar(lever).add(f.lateral).normalize();
  f.axis = UP.clone().cross(f.u);
  f.lateral.set(0, 0, 0);
}

// Поворот твёрдого тела вокруг оси: I·φ'' = W·плечо − держит недопил,
// где плечо — расстояние по горизонтали от оси до центра тяжести, I = 4/3·m·r² как у стержня.
function fallTop(dt) {
  const f = round.fall;
  // Съезжающий верх продолжает ползти через край пня, пока трение его не остановит: плечо растёт.
  if (f.slip > 0) {
    f.a += f.slip * dt;
    round.upper.position.addScaledVector(f.u, f.slip * dt);
    f.slip = Math.max(0, f.slip - G * SLIDING * dt);
  }
  const lever = f.a * Math.cos(f.angle) + f.b * Math.sin(f.angle);
  const hold = f.hinge ? f.hold * Math.max(0, 1 - f.angle / f.tear) : 0;
  const inertia = (4 / 3) * round.mass * (f.a ** 2 + f.b ** 2);
  f.speed += ((round.weight * lever - hold) / inertia) * dt;
  const step = f.speed * dt;
  tip(f, step);
  // Провернувшийся верх крутится вокруг вертикали, а площадки разгоняют его, пока он на них сидит:
  // пока дальний край не поднялся над ними на ширину пропила. Куда он валится, поворачивается вместе с ним.
  if (f.spin) {
    if (f.angle * round.voxels.radius < VOXEL) f.spin.speed += f.spin.push * dt;
    const spin = new THREE.Quaternion().setFromAxisAngle(UP, f.spin.speed * dt);
    f.pivot.quaternion.premultiply(spin);
    f.u.applyQuaternion(spin);
    f.axis.applyQuaternion(spin);
    f.lateral.applyQuaternion(spin);
  }

  if (f.hinge && f.angle >= f.shut) {
    // Подпил сомкнулся: дерево упирается в нижнюю грань подпила, недопил рвёт,
    // и поворот переезжает на передний край пня.
    crack(1);
    say('shut', 'Подпил сомкнулся — недопил лопнул!');
    const next = new THREE.Group();
    next.position.copy(f.pivot.position).addScaledVector(f.u, f.edge - f.p);
    round.root.add(next);
    next.attach(round.upper);
    round.root.remove(f.pivot);
    f.pivot = next;
    f.a -= f.edge - f.p;
    release(f);
  } else if (f.hinge && f.angle >= f.tear) {
    crack(0.7);
    say('tear', 'Недопил оторвался — дальше дерево летит само');
    release(f);
  }
  if (grounded(f)) {
    // За кадр вершина проходит до метра: возвращаем поворот назад, делением шага пополам, до касания.
    let lo = f.angle - step, hi = f.angle;
    for (let i = 0; i < 8; i++) {
      const mid = (lo + hi) / 2;
      tip(f, mid - f.angle);
      if (grounded(f)) hi = mid;
      else lo = mid;
    }
    tip(f, hi - f.angle);
    land();
  }
}

// Отпиленный кусок отваливается от ствола наружу, кувыркаясь, и ложится на землю.
function dropPiece(part) {
  const body = new THREE.Group();
  body.position.copy(part.center);
  part.group.position.sub(part.center);
  body.add(part.group);
  round.root.add(body);
  const out = new THREE.Vector3(part.center.x, 0, part.center.z).normalize();
  round.debris.push({
    body,
    velocity: out.multiplyScalar(0.6),
    spin: new THREE.Vector3(-out.z, 0, out.x),
    rest: part.center.y - part.low,
    landed: false,
  });
}

function fallPiece(piece, dt) {
  if (piece.landed) return;
  piece.velocity.y -= G * dt;
  piece.body.position.addScaledVector(piece.velocity, dt);
  piece.body.rotateOnWorldAxis(piece.spin, 2 * dt);
  if (piece.body.position.y <= piece.rest) {
    piece.body.position.y = piece.rest;
    piece.landed = true;
  }
}

function land() {
  round.done = true;
  const back = round.left.length;
  round.left.forEach((left) => left.removeFromParent());
  round.left = [];
  // Пришибло, если стоял там, куда лёг ствол: впереди оси по линии падения и не дальше метра вбок.
  const { u: f, pivot, len } = round.fall;
  const at = local(player.pos);
  const dx = at.x - pivot.position.x;
  const dz = at.z - pivot.position.z;
  const along = dx * f.x + dz * f.z;
  const squashed = along > 0 && along < len && Math.abs(dx * f.z - dz * f.x) < 1;
  const hit = struck(round.yard, pivot.position, f, len);
  hit.forEach(wreck);

  const saws = back ? [back > 1 ? `Зажатые пилы вынул из пня: ${back}` : 'Зажатую пилу вынул из пня'] : [];
  if (squashed) showResult('ПРИШИБЛО', ['Не стой на линии падения', ...saws]);
  else if (hit.length) showResult('ОЙ', [...hit.map((o) => o.kind.verdict), ...saws]);
  else showResult('ЧИСТО!', ['Дерево легло и ничего не задело', ...saws]);
}

// Пилить можно стоящее дерево и всё, что осталось, когда оно легло: пень, отщеп, спинку. Раунд кончается только по R.
const canSaw = () => !round.top || round.done;

function showResult(title, notes) {
  resultEl.innerHTML = `${title}${notes.map((n) => `<small>${n}</small>`).join('')}<small>R — новое дерево</small>`;
  resultEl.hidden = false;
  // Итог висит недолго и остаётся в журнале: дальше можно кромсать пень, пока не нажмёшь R.
  say('result', `${title} ${notes.join('. ')}`);
  const shown = round;
  setTimeout(() => { if (trees.includes(shown)) resultEl.hidden = true; }, RESULT_SHOWN);
}

// Ближайшее к игроку дерево по горизонтали.
function nearest() {
  const at = player.pos.clone().setY(0);
  return trees.reduce((a, b) => (a.base.distanceToSquared(at) <= b.base.distanceToSquared(at) ? a : b));
}

function update(dt) {
  if (!saw) round = nearest();
  const forward = forwardOf(player.yaw);
  const right = new THREE.Vector3(-forward.z, 0, forward.x);

  const shift = keys.has('ShiftLeft') || keys.has('ShiftRight');
  // Ходить можно, только пока пила не приставлена к стволу и камера не летает.
  const move = new THREE.Vector3();
  if (mode === 'free' && !fly) {
    if (keys.has('KeyW')) move.add(forward);
    if (keys.has('KeyS')) move.sub(forward);
    if (keys.has('KeyD')) move.add(right);
    if (keys.has('KeyA')) move.sub(right);
  }
  const moving = move.lengthSq() > 0;
  const speed = moving ? (player.crouch ? 1.5 : shift ? 6 : 3) : 0;
  if (moving) player.pos.addScaledVector(move.normalize(), speed * dt);
  // Шаги: голова на каждом шаге чуть опускается и за два шага раз качается из стороны в сторону.
  // Фаза bob идёт по пройденному пути (шаг — полоборота), поэтому бегом шаги чаще, а встал — замерли.
  // Размах растёт со скоростью и плавно приходит и уходит. Головой не крутим: только сдвиг.
  // gait — скорость в долях обычной ходьбы: 0 стоим, 0.5 присев, 1 идём, 2 бежим.
  player.gait += (speed / 3 - player.gait) * (1 - Math.exp(-6 * dt));
  player.bob += (speed * dt * Math.PI) / STRIDE;
  const rise = STEP_RISE * player.gait;
  player.step.copy(right).multiplyScalar(Math.sin(player.bob) * rise / 2).setY(-rise * Math.sin(player.bob) ** 2);
  player.eye += ((player.crouch ? EYE_CROUCH : EYE) - player.eye) * (1 - Math.exp(-8 * dt));
  // Шаг назад от приставленной пилы — уходишь от пропила. Зажатая пила остаётся в стволе, в руках — запасная.
  if (mode !== 'free' && !fly && keys.has('KeyS')) {
    if (saw.pinched) leaveSaw();
    mode = 'free';
    saw = null;
  }
  // Сквозь ствол не пройти: держимся от коры на всей высоте тела. Ствол клонится, поэтому над ногами
  // он бывает ближе, чем у земли. Когда дерево упало, остаётся только пень.
  const { shape } = round.voxels;
  const body = round.top ? Math.min(player.eye, round.voxels.cutLow * VOXEL) : player.eye;
  for (let y = 0; y <= body; y += 0.1) {
    const c = shape.center(y).add(round.base);
    const dx = player.pos.x - c.x, dz = player.pos.z - c.z;
    const dist = Math.hypot(dx, dz);
    const minDist = shape.outline(Math.atan2(dz, dx), y) + 0.35;
    if (dist < minDist) player.pos.set(c.x + (dx / dist) * minDist, player.pos.y, c.z + (dz / dist) * minDist);
  }
  pushOut(round.yard, player.pos, 0.35);
  // За забор не выйти.
  player.pos.x = THREE.MathUtils.clamp(player.pos.x, -YARD.w / 2 + 0.4, YARD.w / 2 - 0.4);
  player.pos.z = THREE.MathUtils.clamp(player.pos.z, -YARD.d / 2 + 0.4, YARD.d / 2 - 0.4);

  const candidate = mode === 'free' && canSaw() ? sawCandidate(forward) : null;

  if (mode === 'cut') {
    if (!round.cuts.includes(saw)) round.cuts.push(saw);
    // Цепь режет кромкой: выпиливаем полосу, которую кромка прошла за кадр. Дальше, чем пускает корпус, не идёт.
    const reach = Math.min(SAW_SPEED * dt, ahead(saw));
    const step = Math.max(0, Math.min(reach, bodyRoom(saw.edge, saw.q, reach)));
    saw.blocked = step < reach;
    if (saw.blocked) say('body', 'Пила упёрлась корпусом в ствол: поверни её по часовой или вынь');
    else unsay('body');
    saw.edge.addScaledVector(basis(saw).along, step);
    saw.depth += step;
    round.voxels.carve(basis(saw), -step - VOXEL, 0, barL());
    round.voxels.breakLoose().forEach(dropPiece);
    round.voxels.remesh();
  }
  if (saw?.loose) rest(saw);
  // Живут все деревья делянки: то, от которого отошёл, падает дальше.
  stepWind(dt);
  const here = round;
  for (const tree of trees) {
    round = tree;
    if (!round.top) stand(dt);
    else if (round.slide) slideTop(dt);
    round.debris.forEach((piece) => fallPiece(piece, dt));
    if (round.fall && !round.done) fallTop(dt);
  }
  round = here;

  const shown = saw ?? candidate;
  aimPlane.visible = Boolean(shown) && mode !== 'cut';
  if (shown) {
    const r = round.voxels.radius;
    const plane = pose(shown, r);
    aimPlane.position.copy(plane.position).add(round.base);
    aimPlane.quaternion.copy(plane.quaternion);
    aimPlane.scale.set(barL(), 2 * r, 1);
  }

  hintEl.textContent = hint();
  depthEl.style.visibility = saw ? 'visible' : 'hidden';
  if (saw) depthFillEl.style.width = `${(saw.depth / (saw.depth + ahead(saw))) * 100}%`;

  gapEl.hidden = round.gap === null || round.top;
  if (!gapEl.hidden) {
    const mm = round.gap;
    gapEl.textContent = `Щель ${mm.toFixed(0)} мм${mm < 9 ? ' — сужается' : mm > 11 ? ' — расширяется' : ''}`;
  }
  const focus = (saw ?? round.cuts.at(-1))?.origin.y ?? 1;
  const target = round.base.clone().setY(THREE.MathUtils.mapLinear(view.dist, VIEW_NEAR, VIEW_FAR, focus, VIEW_Y));
  // Вид сбоку стоит справа от линии «ты — ствол», а не от взгляда: крутишь головой — он
  // неподвижен, обходишь дерево — он плавно идёт следом.
  const bearing = local(player.pos).setY(0).normalize();
  view.base += angleDiff(azimuthOf(new THREE.Vector3(bearing.z, 0, -bearing.x)), view.base) * (1 - Math.exp(-3 * dt));
  const look = dirOf(view.base + view.az).multiplyScalar(Math.cos(view.el)).setY(Math.sin(view.el));
  sideCamera.position.copy(target).addScaledVector(look, view.dist);
  sideCamera.lookAt(target);

  // Пилящая пила дрожит, при ходьбе покачивается в руках.
  const shake = new THREE.Vector3();
  if (mode === 'cut') {
    shake.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.006);
  } else {
    // В руках пила отстаёт от шага: качается шире головы и с запозданием на четверть шага.
    shake.copy(right).multiplyScalar(Math.sin(player.bob - 0.8) * player.gait * 0.012).setY(-(Math.cos(player.bob) ** 2) * player.gait * 0.012);
  }
  const [out, down, aside] = SHOTS[shot].hold;
  const held = player.pos.clone().addScaledVector(forward, out).addScaledVector(right, -aside).setY(player.eye - down).add(player.step);
  moveSaw(shown ?? { edge: local(held), q: facing(player.yaw) }, shake, dt);
  lamp(sawModel, !!saw && (saw.pinched || !!round.squeeze));

  if (fly) flyCamera(dt, shift);
  else frame(dt);
}

// Камера по ракурсу shot. Сменился ракурс, или пилу приставили, или отошли — камера не прыгает,
// а за SWAP секунд переезжает из того места, где была.
let shot = SHOTS.findIndex((s) => s.name === recall('shot', SHOTS.map((s) => s.name)));
const swap = { kind: '', t: 1, position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
function frame(dt) {
  const { low, back } = SHOTS[shot];
  const kind = `${shot} ${!!saw}`;
  if (kind !== swap.kind) {
    swap.kind = kind;
    swap.t = 0;
    swap.position.copy(camera.position);
    swap.quaternion.copy(camera.quaternion);
  }
  camera.position.set(player.pos.x, player.eye, player.pos.z).add(player.step);
  camera.rotation.set(player.pitch, player.yaw, 0);
  if (saw && (low || back)) {
    // Смотрим между лампой и пропилом: в кадре и шина в древесине, и корпус с лампой.
    const lit = sawModel.getObjectByName('lamp').getWorldPosition(new THREE.Vector3());
    const b = basis(saw);
    const focus = b.origin.clone().add(round.base).add(lit).multiplyScalar(0.5);
    if (low) camera.position.y = Math.min(player.eye, focus.y + low);
    else camera.position.copy(focus).addScaledVector(b.along, -back).addScaledVector(b.side, -back / 3).addScaledVector(UP, back / 2);
    camera.lookAt(focus);
  } else if (back) {
    camera.translateZ(back);
  }
  if (swap.t < 1) {
    swap.t = Math.min(1, swap.t + dt / SWAP);
    const k = THREE.MathUtils.smoothstep(swap.t, 0, 1);
    camera.position.lerpVectors(swap.position, camera.position, k);
    camera.quaternion.slerpQuaternions(swap.quaternion, camera.quaternion, k);
  }
}

// Летающая камера: куда смотришь, туда и летишь; Space — вверх, C — вниз, Shift — ещё медленнее.
function flyCamera(dt, shift) {
  const look = new THREE.Vector3(-Math.sin(fly.yaw) * Math.cos(fly.pitch), Math.sin(fly.pitch), -Math.cos(fly.yaw) * Math.cos(fly.pitch));
  const right = new THREE.Vector3(-look.z, 0, look.x).normalize();
  const move = new THREE.Vector3();
  if (keys.has('KeyW')) move.add(look);
  if (keys.has('KeyS')) move.sub(look);
  if (keys.has('KeyD')) move.add(right);
  if (keys.has('KeyA')) move.sub(right);
  if (keys.has('Space')) move.y += 1;
  if (keys.has('KeyC')) move.y -= 1;
  if (move.lengthSq()) fly.pos.addScaledVector(move.normalize(), FLY_SPEED * (shift ? FINE : 1) * dt);
  const off = local(fly.pos).setY(0);
  if (off.length() > FLY_R) fly.pos.sub(off).addScaledVector(off, FLY_R / off.length());
  fly.pos.y = THREE.MathUtils.clamp(fly.pos.y, 0.02, ZONE_H + 1);
  camera.position.copy(fly.pos);
  camera.rotation.set(fly.pitch, fly.yaw, 0);
}

function setFlying(on) {
  fly = on ? { pos: camera.position.clone(), yaw: player.yaw, pitch: player.pitch } : null;
  if (on && mode === 'cut') mode = 'aim';
  camera.near = on ? FLY_NEAR : NEAR;
  camera.updateProjectionMatrix();
}

// Повернуть пилу вокруг её оси axis (TURN, TILT или ROLL) на angle. Пила поворачивается вокруг
// кромки. В плоскости полотна — свободно: конец шины, что идёт в древесину, выбирает бегущая цепь.
// Из плоскости шина упирается в стенки щели: едва вошла — крути как хочешь, вошла целиком — чуть-чуть.
// На ходу из плоскости не повернуть: иначе бегущая цепь шаг за шагом расширяет щель под новый угол
// и закручивает пропил винтом. Зажатую шину не повернуть никак.
function steer(axis, angle) {
  if (saw.pinched || (mode === 'cut' && axis !== TURN)) return;
  // Шагами, чтобы конец шины за шаг сдвигался не больше чем на полкубика: так цепь не оставит
  // недопиленных клиньев, а шина не проскочит сквозь стенку щели.
  const steps = saw.depth > 0 ? Math.ceil((Math.abs(angle) * barL()) / VOXEL) : 1;
  for (let i = 0; i < steps; i++) {
    const q = saw.q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(axis, angle / steps));
    saw.stuck = !aimable(q) || !fitsKerf(q) || (saw.depth > 0 && bodyRoom(saw.edge, q, 0) < 0);
    if (saw.stuck) return;
    saw.q.copy(q);
    saw.blocked = false;
    if (mode === 'cut') round.voxels.carve(basis(saw), -VOXEL, 0, barL());
  }
  // Мышь шлёт сотни событий в секунду, а кромку на кору кладём раз за кадр (rest в update).
  if (!saw.depth) saw.loose = true;
}

// Пила ещё не в древесине: повёрнутая кромка не может войти в ствол сама и не висит в воздухе,
// а ложится на кору — туда, где первой её коснётся, если подвести её по ходу пилы.
function rest(cut) {
  cut.loose = false;
  const { along, side } = basis(cut);
  const from = cut.edge.clone().addScaledVector(along, -REACH);
  const hit = acrossBar(from, along, side, 2 * REACH);
  if (hit) cut.origin.copy(cut.edge.copy(from.addScaledVector(along, Math.min(hit.enter, bodyRoom(from, cut.q, hit.enter)))));
}

// Полотно не круче MAX_TILT к горизонту (иначе пропил выйдет дырявым, см. carve)
// и смотрит не дальше MAX_TURN от взгляда.
function aimable(q) {
  const { along, normal } = basis({ q });
  return normal.y >= Math.cos(MAX_TILT) && Math.abs(angleDiff(yawOf(along), player.yaw)) <= MAX_TURN;
}

// Точки шины, что сейчас в щели, после поворота q должны в ней и остаться. Стенки щели — по бокам
// полотна, поэтому в счёт идёт только сдвиг поперёк него: вдоль полотна шина скользит или режет.
// Цепь шире шины, и шина болтается в щели: точка в щели, пока до выпиленного кубика поперёк
// полотна не дальше PLAY. Полосу у кромки не проверяем: там сама цепь.
function fitsKerf(q) {
  const now = basis(saw), next = basis({ edge: saw.edge, q });
  const n = now.normal, v = round.voxels;
  const p = new THREE.Vector3(), moved = new THREE.Vector3(), probe = new THREE.Vector3();
  const at = (b, s, w, out) => out.copy(b.origin).addScaledVector(b.along, s).addScaledVector(b.side, w);
  const inKerf = (x) => !v.solid(x) || !v.solid(probe.copy(x).addScaledVector(n, PLAY))
    || !v.solid(probe.copy(x).addScaledVector(n, -PLAY));
  for (let s = -VOXEL; s >= -BAR_W; s -= VOXEL / 2) {
    for (let w = -barL() / 2; w <= barL() / 2; w += VOXEL / 2) {
      if (!inKerf(at(now, s, w, p))) continue;
      const off = at(next, s, w, moved).sub(p).dot(n);
      if (!inKerf(p.addScaledVector(n, off))) return false;
    }
  }
  return true;
}

// На экране — только то, от чего надо бежать, конец игры и почему пила не идёт. Остальное — в журнале (L).
function hint() {
  if (round.slide) return 'Съезжает! Отойди!';
  if (round.fall) return round.done ? '' : 'Падает! Беги!';
  if (fly) return 'Осмотр · F — вернуться';
  if (saw?.blocked) return 'Упёрлась корпусом · поверни пилу или вынь (S)';
  return '';
}

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}

// Захват мыши может не дать браузер (например, без жеста пользователя); игра от этого не ломается.
function lockPointer() {
  canvas.requestPointerLock()?.catch(() => {});
}

addEventListener('resize', resize);
addEventListener('keydown', (e) => {
  if (!e.repeat) note(e.code);
  keys.add(e.code);
  if (e.code === 'KeyR') regrow();
  if (e.code === 'KeyP') {
    tell().then((ok) => {
      unsay('seen');
      say('seen', ok ? 'Отчёт отправлен — спасибо!' : 'Отчёт не ушёл: игра открыта не в артефакте или без доступа к базе');
    });
  }
  if (e.code === 'Minus' || e.code === 'Equal') {
    fov = THREE.MathUtils.clamp(fov + (e.code === 'Minus' ? -5 : 5), FOV_MIN, FOV_MAX);
    camera.fov = fov;
    camera.updateProjectionMatrix();
    try { localStorage.setItem('fov', fov); } catch {}
    unsay('fov');
    say('fov', `Угол обзора ${fov}°`);
  }
  if (e.code === 'KeyF') setFlying(!fly);
  if (FENCE_KEYS[e.code]) {
    const [key, list, , label] = FENCE_KEYS[e.code];
    fenceLook[key] = cycle(list, fenceLook[key]);
    keep(fenceKey(key), fenceLook[key]);
    if (PAINTS.includes(key)) repaint();
    else refence();
    unsay('fence');
    say('fence', label(fenceLook[key]));
  }
  if (fly) return;
  if (e.code === 'KeyC') player.crouch = !player.crouch;
  if (e.code === 'KeyL') hudEl.classList.toggle('details');
  if (e.code === 'KeyV') {
    const next = PACKS[(PACKS.indexOf(sawModel.userData.pack) + 1) % PACKS.length];
    dressSaw(sawModel, next, barL());
    keep('pack', next);
    unsay('pack');
    say('pack', `Пила: комплект ${next}`);
  }
  // Шину меняют, отойдя от ствола: в пропиле её не снять.
  if (e.code === 'KeyB' && mode === 'free') {
    const next = BARS[(BARS.indexOf(barL()) + 1) % BARS.length];
    dressSaw(sawModel, sawModel.userData.pack, next);
    keep('bar', next);
    unsay('bar');
    say('bar', `Шина ${next * 100} см`);
  }
  if (e.code === 'KeyK') {
    shot = (shot + 1) % SHOTS.length;
    keep('shot', SHOTS[shot].name);
    unsay('shot');
    say('shot', `Камера: ${SHOTS[shot].name}`);
  }
  // Стрелки и Q/E — пила поворачивается на полградуса за нажатие.
  const keySteer = {
    ArrowLeft: [TURN, STEP], ArrowRight: [TURN, -STEP], ArrowUp: [TILT, STEP], ArrowDown: [TILT, -STEP],
    KeyQ: [ROLL, -STEP], KeyE: [ROLL, STEP],
  };
  if (keySteer[e.code] && mode !== 'free') steer(...keySteer[e.code]);
});
addEventListener('keyup', (e) => keys.delete(e.code));
startEl.addEventListener('click', () => {
  startEl.hidden = true;
  lockPointer();
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('mousedown', (e) => {
  note(`mouse${e.button} ${mode}`);
  if (e.button === 2) setInspecting(true);
  if (e.button !== 0) return;
  if (document.pointerLockElement !== canvas) lockPointer();
  if (fly) return;
  if (mode === 'aim' && !saw.pinched) {
    // Входим в древесину по середине слоя кубиков: тогда щель лежит вокруг полотна поровну.
    if (saw.depth === 0) saw.edge.y = saw.origin.y = (Math.floor(saw.origin.y / VOXEL) + 0.5) * VOXEL;
    mode = 'cut';
  } else if (mode === 'free' && canSaw()) {
    saw = sawCandidate(forwardOf(player.yaw));
    if (saw) mode = 'aim';
  }
});
addEventListener('mouseup', (e) => {
  note(`up${e.button} ${mode}`);
  if (e.button === 0 && mode === 'cut') mode = 'aim';
  if (e.button === 2) setInspecting(false);
});
addEventListener('wheel', (e) => {
  view.dist = THREE.MathUtils.clamp(view.dist * Math.exp(e.deltaY * 0.001), VIEW_NEAR, VIEW_FAR);
});

// Осмотр: рамка вида сбоку растёт, а мышь вместо взгляда водит камеру вокруг ствола.
function setInspecting(on) {
  inspecting = on;
  sideEl.classList.toggle('big', on);
}
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement !== canvas && mode === 'cut') mode = 'aim';
});
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  if (inspecting) {
    view.az -= e.movementX * MOUSE * 2;
    view.el = THREE.MathUtils.clamp(view.el + e.movementY * MOUSE * 2, VIEW_EL_MIN, VIEW_EL_MAX);
  } else if (fly) {
    fly.yaw -= e.movementX * MOUSE;
    fly.pitch = THREE.MathUtils.clamp(fly.pitch - e.movementY * MOUSE, -1.5, 1.5);
  } else if (mode === 'free') {
    player.yaw -= e.movementX * MOUSE;
    player.pitch = THREE.MathUtils.clamp(player.pitch - e.movementY * MOUSE, -1.5, 1.5);
  } else {
    // Мышь водит пилу: вбок — поворот, вверх-вниз — наклон; с Shift — в пять раз точнее.
    const k = MOUSE * (keys.has('ShiftLeft') || keys.has('ShiftRight') ? FINE : 1);
    steer(TURN, -e.movementX * k);
    steer(TILT, -e.movementY * k);
  }
});

resize();
regrow();
const clock = new THREE.Clock();
// Что записать в бортовой журнал сторожа зависаний (watch.js): режим, игрок, пила, дерево и все пропилы.
const r3 = (a) => a.map((v) => +v.toFixed(3));
watch(() => ({
  mode,
  player: r3([player.pos.x, player.pos.z, player.yaw, player.pitch, player.eye]),
  wind: r3([wind.dir.x, wind.dir.z, wind.max, wind.phase, wind.time]),
  saw: saw && { edge: r3(saw.edge.toArray()), q: r3(saw.q.toArray()), depth: +saw.depth.toFixed(3), pinched: !!saw.pinched },
  tree: {
    slot: round.slot, seed: round.seed, time: +round.time.toFixed(2), mass: Math.round(round.mass), com: r3(round.com.toArray()),
    top: round.top, slide: !!round.slide, fall: round.fall && r3([round.fall.angle, round.fall.speed]),
    cuts: round.cuts.map((c) => ({ origin: r3(c.origin.toArray()), q: r3(c.q.toArray()), depth: +c.depth.toFixed(3) })),
  },
}));

renderer.setAnimationLoop((now) => {
  if (startEl.hidden) beat(now);
  update(Math.min(clock.getDelta(), 0.05));
  renderer.setViewport(0, 0, innerWidth, innerHeight);
  renderer.render(scene, camera);
  // Вид сбоку рисуем в рамку #side поверх основного, тем же рендером.
  const r = sideEl.getBoundingClientRect();
  renderer.setScissorTest(true);
  renderer.setScissor(r.left, innerHeight - r.bottom, r.width, r.height);
  renderer.setViewport(r.left, innerHeight - r.bottom, r.width, r.height);
  sideCamera.aspect = r.width / r.height;
  sideCamera.updateProjectionMatrix();
  renderer.render(scene, sideCamera);
  renderer.setScissorTest(false);
});
