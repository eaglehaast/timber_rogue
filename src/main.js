import * as THREE from 'three';
import { TrunkVoxels, VOXEL } from './trunk.js';
import {
  section, tipping, closing, pivotHeight, tearAngle, slope, deflection, kerfWidth, FRICTION,
} from './physics.js';
import { makeYard, buildYard, struck, wreck, pushOut } from './yard.js';
import { makeSaw, BAR_L, BAR_W } from './saw.js';
import { growMaple } from './maple.js';

const TRUNK_R = 0.3;
const TREE_H = 12;
const REACH = 1.0;        // докуда достаёт пила от лица до коры
const MAX_ENTRY = 2.0;    // выше этого пилу к стволу не приставить
// Низ ствола из вокселей: выше самой высокой точки входа ещё запас, чтобы полотно, наклонённое вверх, шло по древесине.
const ZONE_H = 3.2;
const SAW_SPEED = 0.2;    // метров глубины в секунду
// Массы, кг: низ ствола, остальной ствол, крона. Крона тяжёлая и смещена — она и решает, куда тянет вес.
const M_ZONE = 800, M_TRUNK = 1500, M_CROWN = 900;
const PINCH = 3;          // мм: уже этого щель под шиной — закусывает
const OPEN = 14;          // мм: шире — щель раскрывается
const LEAN = THREE.MathUtils.degToRad(0.4); // настолько наклонился ствол — это уже заметно
// Больше этого ствол стоя не наклоняется: недопил теряет устойчивость, и дальше его ведёт падение.
const SHOWN_TILT = THREE.MathUtils.degToRad(3);
const MAX_TILT = THREE.MathUtils.degToRad(60);
const MAX_TURN = THREE.MathUtils.degToRad(30);
const SNAP_DIST = 0.03;   // прицел прилипает к начатому пропилу, если почти совпал с ним
const SNAP_COS = Math.cos(THREE.MathUtils.degToRad(10));
// Хоть одна сторона, куда дерево ляжет чисто, — не дальше этого угла от направления крена.
const REACH_SIDE = THREE.MathUtils.degToRad(75);
// Глаза стоя и присев: присев можно пилить у самой земли.
const EYE = 1.7, EYE_CROUCH = 1.0;
// Точная настройка пилы: шаг стрелками и замедление мыши с зажатым Shift.
const STEP = THREE.MathUtils.degToRad(0.5);
const PLAY = VOXEL / 4;    // настолько шина болтается в щели: цепь шире шины
// Оси пилы, вокруг которых она поворачивается: в плоскости полотна, наклон носом и крен.
const TURN = new THREE.Vector3(0, 0, 1), TILT = new THREE.Vector3(1, 0, 0), ROLL = new THREE.Vector3(0, 1, 0);
const FINE = 0.2;
const ENTRY_SPEED = 0.15;  // м/с: так пила, ещё не вошедшая в древесину, едет по коре вверх-вниз
// Летающая камера для осмотра: медленная, чтобы можно было влезть в щель, и не дальше FLY_R от ствола.
const FLY_SPEED = 0.5, FLY_R = 4, FLY_NEAR = 0.005, NEAR = 0.05;
// Где пила в руках: столько вперёд от глаз, ниже и левее — так мотор справа от взгляда.
const HOLD_AHEAD = 0.8, HOLD_LOW = 0.6, HOLD_LEFT = 0.2;
const G = 9.8;
const MOUSE = 0.0022;

const canvas = document.getElementById('scene');
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
// Свет: тёплое низкое солнце и холодная тень от неба, у горизонта — дымка. Даль тонет в ней,
// и глазу проще: что далеко, то бледнее.
const HAZE = 0xcfdbe3, ZENITH = 0x5d8fcf;
scene.fog = new THREE.Fog(HAZE, 25, 110);
// Угол обзора по вертикали. Широкий угол у ствола растягивает картинку и укачивает,
// поэтому по умолчанию он умеренный, а клавиши − и = его меняют.
const FOV_MIN = 40, FOV_MAX = 75;
let fov = 55;
try { fov = THREE.MathUtils.clamp(Number(localStorage.getItem('fov')) || fov, FOV_MIN, FOV_MAX); } catch {}
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

scene.add(new THREE.HemisphereLight(0xb4ccec, 0x5a4a32, 1.1));
const sun = new THREE.DirectionalLight(0xffe2b8, 2.4);
sun.position.set(20, 18, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = sun.shadow.camera.bottom = -24;
sun.shadow.camera.right = sun.shadow.camera.top = 24;
sun.shadow.normalBias = 0.03;
scene.add(sun);

// Небо — сфера изнутри: от дымки у горизонта к синеве в зените.
const skyGeo = new THREE.SphereGeometry(150, 32, 16);
const skyColors = [];
for (let i = 0; i < skyGeo.attributes.position.count; i++) {
  const up = Math.max(0, skyGeo.attributes.position.getY(i) / 150);
  const c = new THREE.Color(HAZE).lerp(new THREE.Color(ZENITH), Math.sqrt(up));
  skyColors.push(c.r, c.g, c.b);
}
skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(skyColors, 3));
scene.add(new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false })));

// Трава — пятнистая, а не заливка: по пятнам глаз видит, как ты идёшь и поворачиваешь.
// Заглушка до нарисованной текстуры.
function grassTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#5b7d36';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1800; i++) {
    g.fillStyle = `hsl(${80 + Math.random() * 25}, ${30 + Math.random() * 15}%, ${26 + Math.random() * 10}%)`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 5, 2 + Math.random() * 5);
  }
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(100, 100);
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.MeshLambertMaterial({ map: grassTexture() }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const voxelMat = new THREE.MeshLambertMaterial({ vertexColors: true });

// Прицел пилы: полупрозрачная плоскость, по которой пойдёт пропил.
const aimPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(BAR_L, 2 * TRUNK_R),
  new THREE.MeshBasicMaterial({
    color: 0xff9a2e, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false,
  }),
);
const sawModel = makeSaw();
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

const player = { pos: new THREE.Vector3(0, 0, 4), yaw: 0, pitch: 0, bob: 0, eye: EYE, crouch: false };
// Осмотр с летающей камерой: игрок и пила замирают, камера летает сама по себе.
let fly = null;
const keys = new Set();
// free — ходим и смотрим; aim — пила приставлена, мышь крутит полотно; cut — пилим.
let mode = 'free';
let saw = null;
let round = null;

// Выше зоны пиления — клён: ствол, развилка и крона. Дерево кривое: верх наклонён
// от низа ствола, крона сидит набок. Ствол чуть заходит в кубики, чтобы на сгибе не было щели.
function growTree() {
  const length = TREE_H - ZONE_H;
  const leanAz = Math.random() * Math.PI * 2;
  const side = dirOf(leanAz + (Math.random() - 0.5) * 2).multiplyScalar(Math.random() * 0.8);
  const { tree, crown } = growMaple(length, TRUNK_R, side);
  const bend = new THREE.Group();
  bend.position.y = ZONE_H - 0.03;
  bend.add(tree);
  const lean = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0).cross(dirOf(leanAz)),
    THREE.MathUtils.degToRad(Math.random() * 5),
  );
  bend.quaternion.copy(lean);
  bend.updateMatrixWorld(true);
  // Центр тяжести: низ ствола посередине, у сужающегося ствола — ниже середины, крона — где нарисована.
  const com = new THREE.Vector3(0, ZONE_H / 2, 0).multiplyScalar(M_ZONE)
    .addScaledVector(bend.localToWorld(new THREE.Vector3(0, 0.42 * length, 0)), M_TRUNK)
    .addScaledVector(bend.localToWorld(crown), M_CROWN)
    .divideScalar(M_ZONE + M_TRUNK + M_CROWN);
  return { bend, lean, com, leanAz };
}

// Ветер налетает порывами: сумма несоизмеримых волн, обрезанная снизу, — от 0 до 1.
function gust(t, phase) {
  const g = Math.sin(0.31 * t + phase) + 0.5 * Math.sin(0.87 * t + 2 * phase) + 0.3 * Math.sin(2.3 * t);
  return Math.max(0, g) / 1.8;
}

function newRound() {
  if (round) scene.remove(round.root);

  const voxels = new TrunkVoxels(TRUNK_R, ZONE_H, voxelMat);
  voxels.remesh();
  const tree = growTree();
  const upper = new THREE.Group();
  upper.add(tree.bend);

  const root = new THREE.Group();
  root.add(voxels.group, upper);
  scene.add(root);
  const yard = makeYard(azimuthOf(tree.com), REACH_SIDE, TREE_H);
  buildYard(yard, root);
  root.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });

  const mass = M_ZONE + M_TRUNK + M_CROWN;
  round = {
    root, voxels, upper, yard, ...tree,
    weight: mass * G, mass,
    wind: { dir: dirOf(Math.random() * Math.PI * 2), max: 0.05 + Math.random() * 0.2, phase: Math.random() * 9 },
    time: 0, sway: new THREE.Vector3(), tilt: new THREE.Vector3(), gap: null,
    sec: null, secVersion: -1,
    cuts: [], debris: [],
    top: false, slide: null, fall: null, done: false,
    said: {},
  };
  mode = 'free';
  saw = null;
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

// Сколько древесины впереди кромки по ходу пилы — до коры на той стороне ствола.
function ahead(cut) {
  const { origin: p, along: d } = basis(cut);
  const a = d.x ** 2 + d.z ** 2, b = p.x * d.x + p.z * d.z, c = p.x ** 2 + p.z ** 2 - TRUNK_R ** 2;
  return Math.max(0, (-b + Math.sqrt(Math.max(0, b * b - a * c))) / a);
}

// Расстояние по взгляду до коры, если взгляд (по горизонтали) упирается в ствол.
function distanceToBark(forward) {
  const along = -(player.pos.x * forward.x + player.pos.z * forward.z);
  if (along <= 0) return null;
  const perp2 = player.pos.x ** 2 + player.pos.z ** 2 - along ** 2;
  if (perp2 > TRUNK_R ** 2) return null;
  return along - Math.sqrt(TRUNK_R ** 2 - perp2);
}

// Куда встанет пила, если приставить её сейчас: точка на коре под прицелом, полотно горизонтально.
// Если рядом начатый пропил того же направления, пила встаёт в него.
function sawCandidate(forward) {
  const bark = distanceToBark(forward);
  if (bark === null || bark > REACH) return null;
  const origin = player.pos.clone().addScaledVector(forward, bark);
  origin.y = THREE.MathUtils.clamp(player.eye + Math.tan(player.pitch) * bark, 0.05, MAX_ENTRY);
  const fresh = { origin, edge: origin.clone(), q: facing(player.yaw), depth: 0 };
  const f = basis(fresh);
  return round.cuts.find((c) => {
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

// Пилу держат горизонтально перед собой, шиной поперёк взгляда. У ствола она встаёт туда,
// где пойдёт пропил, и переходит туда плавно: руки доворачивают пилу, а не она прыгает.
function moveSaw(cut, shake, dt) {
  const target = pose(cut);
  target.position.add(shake);
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
  const g = gust(round.time, round.wind.phase);
  round.sway.copy(round.wind.dir).multiplyScalar(g * round.wind.max);
  if (round.voxels.version && round.secVersion !== round.voxels.version) {
    round.sec = section(round.voxels);
    round.secVersion = round.voxels.version;
  }
  const { sec } = round;
  if (sec) round.tilt = deflection(sec, round.com.clone().add(round.sway), round.weight, round.com.y);

  // Крона качается вокруг сгиба: смещение веса делим на высоту над сгибом. Наклон недопила
  // рисуем там же — на глаз разницы с поворотом у пропила при таких углах нет.
  // Наклон больше SHOWN_TILT бывает, только когда недопил потерял устойчивость: дерево в этом
  // же кадре начинает падать, и дальше его поворачивает падение.
  const up = new THREE.Vector3(0, 1, 0);
  const sway = new THREE.Quaternion().setFromAxisAngle(
    up.clone().cross(round.wind.dir), (g * round.wind.max) / (round.com.y - ZONE_H),
  );
  const tilt = new THREE.Quaternion().setFromAxisAngle(
    up.clone().cross(round.tilt).normalize(), Math.min(round.tilt.length(), SHOWN_TILT),
  );
  round.bend.quaternion.copy(tilt).multiply(sway).multiply(round.lean);
  if (!sec) return;

  const c = centerOfMass();
  if (g > 0.8) say('gust', 'Порыв ветра качнул крону');
  else if (g < 0.4) unsay('gust');
  if (round.tilt.length() > LEAN) say('lean', 'Ствол начал клониться — смотри вид сбоку');
  else if (round.tilt.length() < LEAN / 2) unsay('lean');

  if (!sec.intact.length) {
    const s = slope(sec);
    if (s.tilt > Math.atan(FRICTION)) return startSlide(s);
  }
  const tip = tipping(sec, c, round.weight);
  if (tip.net > 0) return startFall(tip, c);

  if (!sec.intact.length) say('free', 'Ствол перерезан насквозь, но стоит: вес пока над пнём');
  else if (tip.ratio > 0.7) {
    if (!round.said.creak) crack(0.3);
    say('creak', 'Недопил потрескивает — ещё немного');
  } else if (tip.ratio < 0.5) unsay('creak');

  // Щель под шиной: наклон ствола её сжимает или раскрывает.
  round.gap = null;
  if (!saw || saw.depth < 0.05) return;
  round.gap = kerfWidth(sec, round.tilt, saw.edge);
  if (mode !== 'cut') return;
  if (round.gap < PINCH) {
    say('pinch', 'Щель сжимается — вес давит на шину, пилу начинает закусывать');
    unsay('open');
  } else if (round.gap > OPEN) {
    say('open', 'Щель раскрывается — ствол уходит от пилы');
    unsay('pinch');
  }
}

// Верх перерезан по косой круче, чем держит трение, — он съезжает по срезу.
function startSlide(s) {
  round.upper.add(round.voxels.splitTop(0).group);
  round.top = true;
  round.slide = { ...s, s: 0, v: 0 };
  mode = 'free';
  saw = null;
  crack(0.6);
  say('slide', 'Косой рез — ствол поехал вниз по срезу!');
}

function slideTop(dt) {
  const sl = round.slide;
  sl.v += G * (Math.sin(sl.tilt) - FRICTION * Math.cos(sl.tilt)) * dt;
  sl.s += sl.v * dt;
  round.upper.position.copy(sl.dir).multiplyScalar(sl.s * Math.cos(sl.tilt)).setY(-sl.s * Math.sin(sl.tilt));
  const c = centerOfMass();
  const tip = tipping(round.sec, c, round.weight);
  if (tip.net > 0) {
    round.slide = null;
    startFall(tip, c, sl.v * Math.cos(sl.tilt) * sl.dir.dot(tip.u));
  }
}

// Дерево пошло: поворачивается вокруг оси недопила. Пока недопил цел, он держит дерево
// в плоскости падения и тормозит, слабея с наклоном; дальше дерево летит само.
// slip — с какой скоростью верх ещё съезжает через кромку, если до этого скользил по косому резу.
function startFall(tip, c, slip = 0) {
  const { sec } = round;
  const hinge = sec.intact.length > 0;
  const h = pivotHeight(sec, tip.u, tip.p);
  if (!round.top) round.upper.add(round.voxels.splitTop(h).group);
  round.top = true;
  const pivot = new THREE.Group();
  pivot.position.copy(tip.u).multiplyScalar(tip.p).setY(h);
  round.root.add(pivot);
  pivot.attach(round.upper);

  const a = c.dot(tip.u) - tip.p;
  round.fall = {
    pivot, u: tip.u, p: tip.p, axis: new THREE.Vector3(0, 1, 0).cross(tip.u),
    angle: 0, speed: 0, hinge,
    a, b: round.com.y + round.upper.position.y - h, // съехавший верх опустился
    hold: tip.hold,
    tear: hinge ? tearAngle(sec, tip.u) : 0,
    shut: hinge ? closing(sec, tip.u, tip.p) : Infinity,
    edge: Math.max(...sec.all.map((f) => f.x * tip.u.x + f.z * tip.u.z)),
    lateral: c.clone().setY(0).addScaledVector(tip.u, -c.dot(tip.u)),
    len: TREE_H - h,
    slip: Math.max(0, slip),
  };
  mode = 'free';
  saw = null;
  crack(1);
  say('go', hinge ? 'Хруст! Пропил за недопилом раскрылся — дерево пошло' : 'Дерево пошло!');
}

// Недопила больше нет: дерево уже никто не держит в плоскости, и вбок его уводит
// то, что вес был смещён в сторону от линии падения.
function release(f) {
  f.hinge = false;
  const lever = f.a * Math.cos(f.angle) + f.b * Math.sin(f.angle);
  f.u = f.u.clone().multiplyScalar(lever).add(f.lateral).normalize();
  f.axis = new THREE.Vector3(0, 1, 0).cross(f.u);
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
    f.slip = Math.max(0, f.slip - G * FRICTION * dt);
  }
  const lever = f.a * Math.cos(f.angle) + f.b * Math.sin(f.angle);
  const hold = f.hinge ? f.hold * Math.max(0, 1 - f.angle / f.tear) : 0;
  const inertia = (4 / 3) * round.mass * (f.a ** 2 + f.b ** 2);
  f.speed += ((round.weight * lever - hold) / inertia) * dt;
  const step = Math.min(f.speed * dt, Math.PI / 2 - f.angle);
  f.angle += step;
  f.pivot.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(f.axis, step));

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
  if (f.angle >= Math.PI / 2) land();
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
  // Пришибло, если стоял там, куда лёг ствол: впереди оси по линии падения и не дальше метра вбок.
  const { u: f, pivot, len } = round.fall;
  const dx = player.pos.x - pivot.position.x;
  const dz = player.pos.z - pivot.position.z;
  const along = dx * f.x + dz * f.z;
  const squashed = along > 0 && along < len && Math.abs(dx * f.z - dz * f.x) < 1;
  const hit = struck(round.yard, pivot.position, f, len);
  hit.forEach(wreck);

  if (squashed) showResult('ПРИШИБЛО', ['Не стой на линии падения']);
  else if (hit.length) showResult('ОЙ', hit.map((o) => o.kind.verdict));
  else showResult('ЧИСТО!', ['Дерево легло и ничего не задело']);
}

function showResult(title, notes) {
  resultEl.innerHTML = `${title}${notes.map((n) => `<small>${n}</small>`).join('')}<small>R — новое дерево</small>`;
  resultEl.hidden = false;
}

function update(dt) {
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
  if (moving) {
    const speed = player.crouch ? 1.5 : shift ? 6 : 3;
    player.pos.addScaledVector(move.normalize(), speed * dt);
  }
  player.eye += ((player.crouch ? EYE_CROUCH : EYE) - player.eye) * (1 - Math.exp(-8 * dt));
  // Пила у коры, но ещё не вошла: W и S везут её вверх-вниз по стволу.
  if (mode === 'aim' && saw.depth === 0 && !fly) {
    const lift = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    saw.edge.y = saw.origin.y = THREE.MathUtils.clamp(saw.origin.y + lift * ENTRY_SPEED * (shift ? FINE : 1) * dt, 0.05, MAX_ENTRY);
  }
  // Сквозь пень не пройти.
  const minDist = TRUNK_R + 0.35;
  const dist = Math.hypot(player.pos.x, player.pos.z);
  if (dist < minDist) player.pos.multiplyScalar(minDist / dist);
  pushOut(round.yard, player.pos, 0.35);

  const candidate = mode === 'free' && !round.top ? sawCandidate(forward) : null;

  if (mode === 'cut') {
    if (!round.cuts.includes(saw)) round.cuts.push(saw);
    // Цепь режет кромкой: выпиливаем полосу, которую кромка прошла за кадр.
    const step = Math.min(SAW_SPEED * dt, ahead(saw));
    saw.edge.addScaledVector(basis(saw).along, step);
    saw.depth += step;
    round.voxels.carve(basis(saw), -step - VOXEL, 0, BAR_L);
    round.voxels.breakLoose().forEach(dropPiece);
    round.voxels.remesh();
  }
  if (!round.top) stand(dt);
  else if (round.slide) slideTop(dt);

  const shown = saw ?? candidate;
  aimPlane.visible = Boolean(shown) && mode !== 'cut';
  if (shown) {
    const plane = pose(shown, TRUNK_R);
    aimPlane.position.copy(plane.position);
    aimPlane.quaternion.copy(plane.quaternion);
  }

  round.debris.forEach((piece) => fallPiece(piece, dt));

  if (round.fall && !round.done) fallTop(dt);

  hintEl.textContent = hint(candidate);
  depthEl.style.visibility = saw ? 'visible' : 'hidden';
  if (saw) depthFillEl.style.width = `${(saw.depth / (saw.depth + ahead(saw))) * 100}%`;

  gapEl.hidden = round.gap === null || round.top;
  if (!gapEl.hidden) {
    const mm = round.gap;
    gapEl.textContent = `Щель ${mm.toFixed(0)} мм${mm < 9 ? ' — сужается' : mm > 11 ? ' — расширяется' : ''}`;
  }
  const focus = (saw ?? round.cuts.at(-1))?.origin.y ?? 1;
  const target = new THREE.Vector3(0, THREE.MathUtils.mapLinear(view.dist, VIEW_NEAR, VIEW_FAR, focus, VIEW_Y), 0);
  // Вид сбоку стоит справа от линии «ты — ствол», а не от взгляда: крутишь головой — он
  // неподвижен, обходишь дерево — он плавно идёт следом.
  const bearing = player.pos.clone().setY(0).normalize();
  view.base += angleDiff(azimuthOf(new THREE.Vector3(bearing.z, 0, -bearing.x)), view.base) * (1 - Math.exp(-3 * dt));
  const look = dirOf(view.base + view.az).multiplyScalar(Math.cos(view.el)).setY(Math.sin(view.el));
  sideCamera.position.copy(target).addScaledVector(look, view.dist);
  sideCamera.lookAt(target);

  // Пилящая пила дрожит, при ходьбе покачивается в руках.
  const shake = new THREE.Vector3();
  if (mode === 'cut') {
    shake.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.006);
  } else if (moving) {
    player.bob += dt * 10;
    shake.copy(right).multiplyScalar(Math.sin(player.bob) * 0.015).setY(-Math.abs(Math.cos(player.bob)) * 0.02);
  }
  const held = player.pos.clone().addScaledVector(forward, HOLD_AHEAD).addScaledVector(right, -HOLD_LEFT).setY(player.eye - HOLD_LOW);
  moveSaw(shown ?? { edge: held, q: facing(player.yaw) }, shake, dt);

  if (fly) {
    flyCamera(dt, shift);
  } else {
    camera.position.set(player.pos.x, player.eye, player.pos.z);
    camera.rotation.set(player.pitch, player.yaw, 0);
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
  const flat = Math.hypot(fly.pos.x, fly.pos.z);
  if (flat > FLY_R) fly.pos.multiplyScalar(FLY_R / flat);
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
// Зажатую щелью шину не повернуть никак.
function steer(axis, angle) {
  if (round.gap !== null && round.gap < PINCH) return;
  // Шагами, чтобы конец шины за шаг сдвигался не больше чем на полкубика: так цепь не оставит
  // недопиленных клиньев, а шина не проскочит сквозь стенку щели.
  const steps = saw.depth > 0 ? Math.ceil((Math.abs(angle) * BAR_L) / VOXEL) : 1;
  for (let i = 0; i < steps; i++) {
    const q = saw.q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(axis, angle / steps));
    saw.stuck = !aimable(q) || !fitsKerf(q);
    if (saw.stuck) return;
    saw.q.copy(q);
    if (mode === 'cut') round.voxels.carve(basis(saw), -VOXEL, 0, BAR_L);
  }
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
    for (let w = -BAR_L / 2; w <= BAR_L / 2; w += VOXEL / 2) {
      if (!inKerf(at(now, s, w, p))) continue;
      const off = at(next, s, w, moved).sub(p).dot(n);
      if (!inKerf(p.addScaledVector(n, off))) return false;
    }
  }
  return true;
}

function hint(candidate) {
  if (round.slide) return 'Съезжает! Отойди!';
  if (round.fall) return round.done ? '' : 'Падает! Беги!';
  if (fly) return 'Осмотр · WASD, Space и C — лететь · Shift — медленно · F — вернуться';
  if (mode !== 'free') {
    const deg = (a) => THREE.MathUtils.radToDeg(a).toFixed(1);
    const { along, side } = basis(saw);
    let angles = `Поворот ${deg(angleDiff(yawOf(along), player.yaw))}° · наклон ${deg(Math.asin(along.y))}° · крен ${deg(Math.asin(-side.y))}°`;
    if (round.gap !== null && round.gap < PINCH) angles += ' · шину зажало';
    else if (saw.stuck) angles += ' · шина упёрлась в стенку пропила';
    if (mode === 'cut') return angles;
    const move = saw.depth > 0 ? '' : ' · W/S — выше-ниже';
    return `${angles} · мышь, стрелки, Q/E — повернуть (Shift — точно)${move} · ЛКМ — пилить · Space — убрать пилу`;
  }
  if (!candidate) return round.cuts.length ? '' : 'Подойди к стволу';
  return round.cuts.includes(candidate) ? 'ЛКМ — приставить пилу к пропилу' : 'ЛКМ — приставить пилу';
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
  keys.add(e.code);
  if (e.code === 'KeyR') newRound();
  if (e.code === 'Minus' || e.code === 'Equal') {
    fov = THREE.MathUtils.clamp(fov + (e.code === 'Minus' ? -5 : 5), FOV_MIN, FOV_MAX);
    camera.fov = fov;
    camera.updateProjectionMatrix();
    try { localStorage.setItem('fov', fov); } catch {}
    unsay('fov');
    say('fov', `Угол обзора ${fov}°`);
  }
  if (e.code === 'KeyF') setFlying(!fly);
  if (fly) return;
  if (e.code === 'KeyC') player.crouch = !player.crouch;
  // Space при приставленной пиле — шаг назад: пила убрана, ходить снова можно.
  if (e.code === 'Space' && mode !== 'free') {
    mode = 'free';
    saw = null;
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
  if (e.button === 2) setInspecting(true);
  if (e.button !== 0) return;
  if (document.pointerLockElement !== canvas) lockPointer();
  if (fly) return;
  if (mode === 'aim') {
    // Входим в древесину по середине слоя кубиков: тогда щель лежит вокруг полотна поровну.
    if (saw.depth === 0) saw.edge.y = saw.origin.y = (Math.floor(saw.origin.y / VOXEL) + 0.5) * VOXEL;
    mode = 'cut';
  } else if (mode === 'free' && !round.top) {
    saw = sawCandidate(forwardOf(player.yaw));
    if (saw) mode = 'aim';
  }
});
addEventListener('mouseup', (e) => {
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
newRound();
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
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
