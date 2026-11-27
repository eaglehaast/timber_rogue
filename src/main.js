import { makeCutGuide } from './cut-guide.js';
import { makeHeldSaw } from './held-saw.js';
import { showAction } from './hud-layout.js';
import * as THREE from 'three';
import { TrunkVoxels, trunkShape, VOXEL, dressWood } from './trunk.js';
import { hitLog, LogCut } from './log-cut.js';
import {
  section, tipping, lever, closing, contact, pivotHeight, tearAngle, slope, twist, deflection, kerfWidth, opening, splitLength, pulledFibres, FRICTION, SLIDING,
  SPLIT_MIN,
} from './physics.js';
import { EYE, MOUSE, FOV_MIN, FOV_MAX, fieldOfView, makePlayer, forwardOf, turnHead, walkInput, walkSpeed, stepEyes, eyeCamera, bindStick } from './player.js';
import { mode as screenMode, PHONE } from './device.js';
import { makeSaw, dressSaw, lamp, runChain, PACKS, BAR_W } from './saw.js';
import { Arms } from './arms.js';
import { Chips } from './chips.js';
import { growMaple, DENSITY } from './maple.js';
import { animateFall, coarseCapsules, prepareCrown } from './art-fall.js';
import { makeFallLeaves } from './fall-leaves.js';
import { Limb, Kerf, combine } from './limbs.js';
import { Body, World, Grip, rayHit } from './bodies.js';
import { dressBark, dressLimbs } from './bark.js';
import { watch, note, beat, pauseWatch, tell } from './watch.js';
import { seed, random } from './random.js';
import { wind, gust } from './wind.js';
import { classifyLimbBody, dragBranch, haulSpeed, HOLD_DROP_LOW, PICK_RANGE } from './wood-handling.js';
import { advanceLadderClimb, buildLadder, findLadderPlacement, LADDER_ATTACH_HEIGHT, ladderClimbPosition } from './ladder.js';
import { createWinch, findWinchTarget } from './winch.js';

let woodyard = null;
// Где игрок появляется при выборе «Игра» — задаёт house-view.js: у ворот, с внутренней стороны двора.
let spawnPoint = null;

// Три клёна за домом. r — радиус ствола выше корневых наплывов.
export const MAPLES = [{ r: 0.1, x: -15, z: -3 }, { r: 0.3, x: 0, z: -3 }, { r: 0.2, x: 15, z: -3 }];
let plots = MAPLES, fallStand, fallLeaves;
const TREE_H = 12;
const BODY_RADIUS = 0.35;
const REACH = 1.0;        // докуда достаёт пила от лица до коры
const MAX_ENTRY = 2.0;    // выше этого пилу к стволу не приставить
const LOOK = 3;           // м — дальше этого ветку под прицелом не ищем
// Низ ствола из вокселей: выше самой высокой точки входа ещё запас, чтобы полотно, наклонённое вверх, шло по древесине.
const ZONE_H = 3.2;
const SAW_SPEED = 0.2;    // метров глубины в секунду
const SEATING = 0.04;     // ствол прошёл такую долю пути до того, как сесть на пропил, — шину вот-вот закусит
const CHEW = 3;           // мм: цепь встаёт, пилу ещё можно вынуть
const BIND = 1;           // мм: шину зажало в пропиле
const STRAIN = 0.5;       // недопил ветки держит такую долю своей прочности — щель уже сужается или раскрывается
const RESULT_SHOWN = 4000; // мс: столько итог раунда висит на экране
const OPEN = 14;          // мм: шире — щель раскрывается
const LEAN = THREE.MathUtils.degToRad(0.4); // настолько наклонился ствол — это уже заметно
// Больше этого ствол стоя не наклоняется: недопил теряет устойчивость, и дальше его ведёт падение.
const SHOWN_TILT = THREE.MathUtils.degToRad(3);
const MAX_TILT = THREE.MathUtils.degToRad(60);
const MAX_TURN = THREE.MathUtils.degToRad(30);
const SNAP_DIST = 0.03;   // прицел прилипает к начатому пропилу, если почти совпал с ним
const SNAP_COS = Math.cos(THREE.MathUtils.degToRad(10));
// Точная настройка пилы: шаг стрелками и замедление мыши с зажатым Shift.
const STEP = THREE.MathUtils.degToRad(0.5);
const PLAY = VOXEL / 4;    // настолько шина болтается в щели: цепь шире шины
// Оси пилы, вокруг которых она поворачивается: в плоскости полотна, наклон носом и крен.
const TURN = new THREE.Vector3(0, 0, 1), TILT = new THREE.Vector3(1, 0, 0), ROLL = new THREE.Vector3(0, 1, 0);
// Пила, что режет ветку снизу верхней кромкой шины, — та же пила, повёрнутая на пол-оборота вокруг шины:
// ход пропила вверх, а в руках она стоит как обычно.
const FLIP = new THREE.Quaternion().setFromAxisAngle(TILT, Math.PI);
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

const canvas = document.getElementById('scene');
const hudEl = document.getElementById('hud');
const hintEl = document.getElementById('hint');
const depthEl = document.getElementById('depth');
const depthFillEl = document.getElementById('depthFill');
const resultEl = document.getElementById('result');
const logEl = document.getElementById('log');
const gapEl = document.getElementById('gap');
const kitEl = document.getElementById('kit');
const heldSawEl = document.getElementById('held-saw');
const heldSawMotion = await makeHeldSaw(heldSawEl);
const stickEl = document.getElementById('stick');
const stick = bindStick(stickEl);
const touchSaw = document.getElementById('touch-saw');
const winchControl = document.getElementById('winch-control');

let scene, camera, ground, groundNormal, walkable, winch;
let playing = false, touch = false;
let resultTimer;
let sawPointer = null;
// Угол обзора по вертикали. Широкий угол у ствола растягивает картинку и укачивает,
// поэтому по умолчанию он умеренный, а клавиши − и = его меняют.
let fov = fieldOfView();
// Выбор пилы, шины и ракурса тоже запоминаем: что было в list под key, а нет — первое.
const recall = (key, list) => {
  try { return list.find((v) => String(v) === localStorage.getItem(key)) ?? list[0]; } catch { return list[0]; }
};
const keep = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
const aimPlane = makeCutGuide();
// Инвентарь: две пилы, руки и приставная лестница. Пила — вещь: она в руках, на поясе или осталась
// в дереве (left — её копия там, tree — у какого дерева). Зажатую в пропиле (stuck) не вынуть;
// свободную — в пне упавшего дерева или на земле — забираешь, подойдя (TAKE) и нажав её цифру.
const kit = [
  { name: 'Длинная пила', bar: 0.7, pack: recall('pack-long', PACKS) },
  { name: 'Короткая пила', bar: 0.3, pack: recall('pack-short', [...PACKS].reverse()) },
  { name: 'Руки' },
  { name: 'Приставная лестница', ladder: true },
  { name: 'Лебёдка', winch: true },
];
const TAKE = 2; // м — с такого расстояния от глаз дотягиваешься до брошенной пилы
let held = 0;   // что в руках: номер в kit
const ladderModel = buildLadder();
let ladderState = null, ladderPreview = null, climbing = null;
// Руки тянут с силой человека: HAND — сколько тянет, не надрываясь (Н): чурку 27 кг (32 × 45 см) несёшь,
// вдвое длиннее — волочишь за конец, втрое — уже не сдвинуть (Никита, 2026-11-01). TWIST — сколько запястья держат
// поворотом (Н·м). GRAB — докуда дотягиваешься от ног вбок (до земли — нагнувшись), HOLD — на каком расстоянии
// от глаз держишь по взгляду, SLIP — растянуло дальше — выскользнуло, LIFT — столько секунд рука тянет, а кусок
// к ней не идёт: не поднять. grasp — что держишь: дерево, хват, поворот куска к взгляду, вес и нагрузка.
const HAND = 500, TWIST = 40, GRAB = 1.2, HOLD = 0.6, SLIP = 0.8, LIFT = 0.8;
let grasp = null;
const sawModel = makeSaw(kit[0].pack, kit[0].bar);
const chips = new Chips();
const arms = new Arms();
// Пила и прицел видны только из игровой камеры.
const TOOLS = 1;
aimPlane.layers.set(TOOLS);
for (const tool of [sawModel, arms.group]) tool.traverse((part) => part.layers.set(TOOLS));
aimPlane.visible = sawModel.visible = arms.group.visible = false;
sawModel.name = 'saw';

const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
// Куда смотришь — с наклоном взгляда.
const lookOf = () => new THREE.Vector3(-Math.sin(player.yaw) * Math.cos(player.pitch), Math.sin(player.pitch), -Math.cos(player.yaw) * Math.cos(player.pitch));
const yawOf = (v) => Math.atan2(-v.x, -v.z);

const player = makePlayer();
// Осмотр с летающей камерой: игрок и пила замирают, камера летает сама по себе.
let fly = null;
const keys = new Set();
// free — ходим и смотрим; aim — пила приставлена, мышь крутит полотно; cut — пилим.
let mode = 'free';
let saw = null;
let under = false;   // ветку пилить снизу вверх, верхней кромкой шины (U)
const SEAT_HOLD_MS = 160; // короткое касание оставляет время выставить угол
let cutAfter = 0;
let trigger = false; // курок пилы — левая кнопка мыши — нажат
// Деревья делянки и то, с которым сейчас имеем дело: у которого пила, а без пилы — ближайшее.
// Координаты пропилов, пилы в стволе и всего, что считает физика, — от основания своего дерева (round.base).
const trees = [];
let round = null;
const local = (p) => p.clone().sub(round.base);
// Глаза игрока в мире: player.pos — где он стоит на земле, player.eye — высота глаз над ней.
const eyeOf = () => new THREE.Vector3(player.pos.x, player.pos.y + player.eye, player.pos.z);
// Длина шины той пилы, что в руках.
const barL = () => sawModel.userData.bar;

// Выше зоны пиления — клён (maple.js): скелет из осей, стволы ниже зоны идут по форме кубиков (trunkShape)
// и выше продолжают её же сечением; кора чуть заходит в кубики, чтобы на стыке не было щели.
// Крона каждого ствола и каждая его нижняя ветвь — ветки (limbs.js), от них можно отпиливать.
// Крона качается на своём сгибе bend — над осью ствола у верха зоны. Торец ветки — те же кольца, что на срезе,
// стенки раскола — те же рваные волокна, что у отщепа.
function growTree(voxels, artistic) {
  const { shape } = voxels;
  const { skeleton, crowns } = growMaple(shape, ZONE_H, TREE_H, ZONE_H - 0.03);
  const wood = voxels.skin[1];
  const skin = [dressLimbs(voxels.skin[0]), new THREE.MeshLambertMaterial({ map: wood.map }), new THREE.MeshLambertMaterial({ map: wood.userData.fibres })];
  const grow = ({ parts, cards, cloud }, stem) => Object.assign(new Limb(parts, cards, { skin, cloud, zone: ZONE_H }), { stem }).dress();
  const stems = crowns.map((c, i) => {
    const bend = new THREE.Group();
    bend.position.copy(shape.stems[i].center(ZONE_H)).setY(ZONE_H - 0.03);
    const prepared = artistic ? prepareCrown(c, { skin, cloud: c.cloud, zone: ZONE_H }) : null;
    const crown = prepared ? Object.assign(prepared.limb, { stem: i }) : grow(c, i);
    const breaks = prepared?.breaks ?? [];
    for (const { limb } of breaks) {
      limb.stem = i;
      crown.group.add(limb.group);
    }
    crown.group.position.copy(bend.position).negate();
    for (const { at, r } of c.knots) {
      const knot = new THREE.Object3D();
      knot.name = 'trunk';
      knot.userData.r = r;
      knot.position.copy(at);
      crown.group.add(knot);
    }
    bend.add(crown.group);
    bend.updateMatrixWorld(true);
    const stem = { bend, crown, lows: [...c.lows.map((l) => ({ limb: grow(l, i), y: l.y })), ...breaks] };
    return Object.assign(stem, heft(stem));
  });
  return { skeleton, stems, skin };
}

// Вес ствола над зоной — кроны и всех его нижних ветвей: { mass, com, inertia }.
const heft = (stem) => combine([stem.crown, ...stem.lows.map((l) => l.limb)].map((limb) => limb.weight));

// Все ветки дерева: кроны, нижние ветви и отпиленные куски.
const limbsOf = (tree) => [
  ...tree.stems.flatMap((s) => [s.crown, ...s.lows.map((l) => l.limb)]),
  ...tree.world.bodies.filter((b) => b.limb).map((b) => b.limb),
];

// Ствол i уже лежит: его свалили, а на пне стоит другой, или дерево легло целиком.
const fallen = (tree, i) => !(tree.standing & (1 << i)) || (tree.done && Boolean(tree.body & (1 << i)));

// Новый набор клёнов. Зерно двора задаёт первый набор, R при игре — следующий.
function regrow(rnd = Math.random) {
  releaseSaw();
  if (grasp) letGo();
  winch?.clear();
  ladderState = ladderPreview = climbing = null;
  ladderModel.visible = false;
  for (const item of kit) {
    item.left?.removeFromParent();
    Object.assign(item, { left: null, tree: null, kerf: null, body: null, cut: null, stuck: false });
  }
  for (const tree of trees) {
    tree.root.removeFromParent();
    tree.root.traverse((object) => object.geometry?.dispose());
    for (const material of [...tree.voxels.skin, ...tree.skin]) material.dispose();
    tree.voxels.skin[0].map.dispose();
  }
  saw = null;
  mode = 'free';
  under = false;
  noted.until = 0;
  aimPlane.visible = false;
  releaseSaw();
  chips.clear();
  fallLeaves.clear();
  if (woodyard) {
    woodyard.reset();
  }
  const artistic = fallStand?.artistic ?? true;
  plots.forEach((_, slot) => newRound(slot, (rnd() * 2 ** 32) >>> 0, artistic));
  round = nearest();
  arm(0);
  clearTimeout(resultTimer);
  resultEl.hidden = true;
  logEl.replaceChildren();
}

// Вырастить заново дерево на месте slot делянки. treeSeed — зерно, из которого оно растёт
// (по нему его можно вырастить заново из отчёта).
function newRound(slot, treeSeed, artistic) {
  const { r, x, z } = plots[slot];

  seed(treeSeed);
  const voxels = new TrunkVoxels(trunkShape(r, ZONE_H, random() * Math.PI * 2), ZONE_H, [dressBark(), dressWood()]);
  voxels.remesh();
  const tree = growTree(voxels, artistic);

  const root = new THREE.Group();
  root.name = 'maple';
  root.position.set(x, ground(x, z), z);
  voxels.standing = true;
  // Кроны сначала стоят на месте, а над пропилом их потом переносят с сохранением положения (attach).
  root.add(voxels.group, ...tree.stems.flatMap((s) => [s.bend, ...s.lows.filter(l => !l.crownBranch).map(l => l.limb.group)]));
  scene.add(root);
  // Отпилы — твёрдые тела у этого дерева: лежат на земле, на пне, на ветках и друг на друге.
  const world = new World(root, ground, groundNormal);
  world.fix(root, { solids: [voxels] });
  for (const s of tree.stems) for (const limb of [s.crown, ...s.lows.map((l) => l.limb)]) limb.set = world.fix(limb.group, { capsules: limb.shape });

  round = trees[slot] = {
    slot, base: root.position, root, voxels, world, ...tree,
    seed: treeSeed, artistic, shedStems: 0,
    time: 0,
    stumps: [], // на какой высоте спилен ствол (по номеру ствола)
    cuts: [],
  };
  standUp((1 << tree.stems.length) - 1);
  root.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });

}

// Стоят стволы standing (маска по номерам): их ещё не валили, и пилить можно заново. Верх над пропилом
// со всем, что на нём, — upper.
function standUp(standing) {
  const upper = new THREE.Group();
  round.root.add(upper);
  upper.add(round.voxels.lift);
  Object.assign(round, {
    upper, standing, body: 0,
    sway: new THREE.Vector3(), tilt: new THREE.Vector3(), bent: new THREE.Vector3(), gap: null,
    // Насколько недопил поддался насовсем, вокруг какой оси, куда и с какой скоростью сейчас поворачивается.
    give: { tilt: new THREE.Vector3(), at: new THREE.Vector3(), u: null, speed: 0 },
    sec: null, secVersion: -1,
    twist: null, turn: 0, // как косые площадки закручивают верх вокруг вертикали и на сколько закрутили
    split: 0, tongue: new Set(), // на сколько недопил отщепился вверх и какие его колонки
    top: false, slide: null, fall: null, done: false,
    said: {},
  });
  hold(standing);
}

// Нижние ветви и волчки подпиленного ствола, что растут выше пропила, клонятся и падают с верхом,
// а ниже — остаются на пне.
function lift() {
  const y = round.voxels.middle * VOXEL;
  round.stems.forEach((s, i) => {
    if (!(round.standing & (1 << i))) return;
    for (const l of s.lows) if (!l.crownBranch) (round.body & (1 << i) && l.y > y ? round.upper : round.root).attach(l.limb.group);
  });
}

// Недопил держит стволы mask — тело, которое клонится и падает: их кроны и кубики над пропилом.
// Ниже развилки подпилен один ствол — держит оба, выше — только его. Остальные стоят на месте.
function hold(mask) {
  const { stems, upper } = round;
  round.body = round.voxels.body = mask;
  stems.forEach((s, i) => {
    if (round.standing & (1 << i)) (mask & (1 << i) ? upper : round.root).attach(s.bend);
  });
  weigh();
  round.voxels.remesh();
}

// Вес тела — древесина кубиков над пропилом (пень не падает), скелета и листвы.
// Момент инерции вокруг вертикали через сгибы: у каждой кроны свой вокруг её центра тяжести плюс m·d².
function weigh() {
  const { voxels, stems, body } = round;
  const own = stems.filter((s, i) => body & (1 << i));
  const zone = voxels.measure(body, voxels.cutHigh >= 0 ? voxels.middle : 0);
  const zoneMass = DENSITY * zone.volume;
  round.mass = own.reduce((m, s) => m + s.mass, zoneMass);
  round.com = own.reduce((c, s) => c.addScaledVector(s.com, s.mass), zone.center.multiplyScalar(zoneMass)).divideScalar(round.mass);
  round.weight = round.mass * G;
  const at = own.reduce((p, s) => p.add(s.bend.position), new THREE.Vector3()).divideScalar(own.length);
  round.spin = own.reduce((m, s) => {
    const d = s.com.clone().sub(at);
    return m + s.inertia.elements[4] + s.mass * (d.x * d.x + d.z * d.z);
  }, 0);
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

// Ствол как древесина для пилы (у ветки то же умеет её пропил, Kerf). pass — луч from + dir·t: где он
// входит в кору и где выходит; band — то же для всей кромки шины.
const TRUNK = {
  pass: (from, dir, limit) => throughTrunk((t) => from.clone().addScaledVector(dir, t), limit),
  band: (origin, along, side, limit) => acrossBar(origin, along, side, limit),
};
const woodOf = (cut) => cut.kerf ?? TRUNK;

// Корпус пилы толще щели: в древесину он не входит, а упирается в неё краем силуэта (обвод, rim из saw.js).
// Сколько кромке пропила cut ({ edge, q, under }) пройти по ходу пилы, пока корпус не коснётся древесины
// wood, — не дальше limit. Меньше нуля — корпус уже в древесине. Режет верхней кромкой (under) — силуэт
// повёрнут вокруг шины (FLIP).
function bodyRoom(cut, limit, wood = TRUNK) {
  const { origin, side, along, normal } = basis(cut), flip = cut.under ? -1 : 1;
  let room = limit;
  for (const p of sawModel.userData.rim) {
    const from = origin.clone().addScaledVector(side, p.x).addScaledVector(along, flip * p.y - BAR_W / 2).addScaledVector(normal, flip * p.z);
    const hit = wood.pass(from, along, Math.max(0, room));
    // throughTrunk отдаёт точку уже в древесине, а за десятую долю кубика до неё — ещё снаружи.
    if (hit) room = Math.min(room, hit.enter - VOXEL / 10);
    if (room < 0) break;
  }
  return room;
}

// Сколько древесины впереди кромки по ходу пилы — до коры на той стороне ствола или ветки.
function ahead(cut) {
  const { origin, along, side } = basis(cut);
  return Math.max(0, woodOf(cut).band(origin, along, side, 2 * REACH, barL() / 2)?.exit ?? 0);
}

// Высота, на которой пила войдёт в кору, если кора по горизонтали в bark от игрока.
function entryHeight(bark) {
  const max = climbing ? ZONE_H - VOXEL : MAX_ENTRY;
  return THREE.MathUtils.clamp(local(eyeOf()).y + Math.tan(player.pitch) * bark, 0.05, max);
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
  // Корпус — сбоку, на конце шины. Ствол шире того, что шина перекрывает, — и корпус, стоящий против середины,
  // упрётся в кору, едва кромка войдёт в древесину. Вальщик ставит пилу так, чтобы корпус прошёл мимо ствола:
  // сдвигает её к мотору настолько, чтобы корпусу хватило места на весь путь кромки сквозь ствол, но не дальше
  // полшины — точка под прицелом остаётся под кромкой.
  const clear = (x) => {
    const edge = from.clone().addScaledVector(side, x), through = acrossBar(edge, forward, side, 2 * REACH)?.exit ?? 0;
    return bodyRoom({ edge, q }, through) >= through;
  };
  let lo = 0, hi = barL() / 2;
  if (!clear(lo)) {
    for (let k = 0; k < 6; k++) {
      const mid = (lo + hi) / 2;
      if (clear(mid)) hi = mid;
      else lo = mid;
    }
    from.addScaledVector(side, hi);
  }
  const touch = Math.min(acrossBar(from, forward, side, bark)?.enter ?? bark, bodyRoom({ edge: from, q }, bark));
  const origin = from.addScaledVector(forward, touch);
  // Свежий рез идёт в ствол, который, может быть, уже осел на недопиле и стоит наклонённым: щель выпиливается
  // в нём таким, и смыкает её только то, на сколько он осядет дальше. Запоминаем, насколько он осел (settled).
  const settled = { tilt: round.give.tilt.clone(), at: round.give.at.clone() };
  const fresh = { tree: round, origin, edge: origin.clone(), q, depth: 0, settled };
  const f = basis(fresh);
  return round.cuts.find((c) => {
    if (c.pinched) return false;
    const { normal, along } = basis(c);
    return normal.dot(f.normal) > SNAP_COS
      && along.dot(f.along) > SNAP_COS
      && Math.abs(origin.clone().sub(c.origin).dot(normal)) < SNAP_DIST;
  }) ?? fresh;
}

// Ищем первый поперечный рез под прицелом среди ветвей и отпилов всех деревьев.
// Лежащий комель и его отпилы могут находиться далеко от своего пня.
function crosscutCandidate(eye, look, forward) {
  let best = null;
  for (const tree of trees) {
    for (const limb of limbsOf(tree)) {
      if (tree.top && !tree.done && limb.stem !== undefined) continue;
      limb.group.updateWorldMatrix(true, false);
      const inverse = new THREE.Matrix4().copy(limb.group.matrixWorld).invert();
      const standing = limb.stem !== undefined && !fallen(tree, limb.stem);
      const hit = limb.hit(eye.clone().applyMatrix4(inverse), look.clone().transformDirection(inverse), best?.t ?? LOOK, standing);
      if (hit) best = { tree, limb, ...hit };
    }
    const from = eye.clone().sub(tree.root.position);
    for (const body of tree.world.bodies) {
      if (from.distanceToSquared(body.position) > (body.reach + (best?.t ?? LOOK)) ** 2) continue;
      const logs = body.voxels ? [body.voxels] : body.logs;
      if (!logs) continue;
      for (const log of logs) {
        const hit = hitLog(log, eye, look, best?.t ?? LOOK);
        if (hit) best = { tree, log, ...hit };
      }
    }
  }
  if (!best) return null;
  const { tree, limb, axis, s, t, log } = best;
  const at = eye.clone().addScaledVector(look, t);
  const reach = at.y < player.pos.y + 0.8 ? REACH + barL() / 2 : REACH;
  if (Math.hypot(at.x - player.pos.x, at.z - player.pos.z) > reach || at.y - player.pos.y > MAX_ENTRY) return null;
  const kerf = log ? LogCut.at(log, best.row, SNAP_DIST)
    : limb.kerfs.find((k) => k.axis === axis && Math.abs(k.s - s) < SNAP_DIST) ?? new Kerf(axis, s);
  const cut = mount({ tree, limb, log, kerf }, eye, forward);
  cut.aimDistance = t;
  return cut;
}

// Пила в пропиле kerf ветки limb: плоскость пропила — поперёк ветки, шина режет её сверху вниз, мотором
// к глазам eye, а под U — снизу вверх, верхней кромкой. Ветку, что торчит почти отвесно, — как ствол:
// по взгляду forward от тебя (под U — к себе), мотор справа.
function mount({ tree, limb, log, kerf }, eye, forward) {
  // Дальше — в осях ветки: шина режет по along, мотор — с конца side.
  const group = (limb ?? log).group;
  group.updateWorldMatrix(true, false);
  const inverse = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const inPlane = (v) => v.transformDirection(inverse).addScaledVector(kerf.normal, -v.dot(kerf.normal));
  const normal = kerf.normal.clone();
  let along = inPlane(new THREE.Vector3(0, -1, 0));
  const steep = along.length() < 0.3;
  if (steep) along = inPlane(forward.clone());
  along.normalize();
  if (under) along.negate();
  const side = along.clone().cross(normal);
  const toward = steep ? new THREE.Vector3(-forward.z, 0, forward.x).transformDirection(inverse) : eye.clone().applyMatrix4(inverse).sub(kerf.center);
  if (side.dot(toward) < 0) {
    side.negate();
    normal.negate();
  }
  // Ветка — посередине шины; толстую, что шире шины, шина берёт с ближнего края: он в 2 см от мотора.
  const w = Math.min(0, barL() / 2 - 0.02 - (log ? kerf.extent(side) : kerf.r));
  const edge = kerf.center.clone().addScaledVector(side, -w).addScaledVector(along, -kerf.r);
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, along, normal));
  const cut = { tree, limb, log, kerf, origin: edge.clone(), edge, q, depth: 0, under };
  rest(cut);
  return cut;
}

// Куда встанет пила, если приставить её сейчас: на ствол или на ветку — что ближе к глазам под прицелом.
function sawAt(forward) {
  const eye = eyeOf(), look = lookOf();
  const crosscut = crosscutCandidate(eye, look, forward);
  if (crosscut && (!canSaw() || !hitLog(round.voxels, eye, look, crosscut.aimDistance))) return crosscut;
  return (canSaw() ? sawCandidate(forward) : null) ?? crosscut;
}

// Где середина шины (она на полширины позади кромки) и как пила повёрнута — в осях пропила.
// shift — сдвиг от кромки по ходу.
function pose(cut, shift = -BAR_W / 2) {
  const b = basis(cut);
  return { position: b.origin.clone().addScaledVector(b.along, shift), quaternion: cut.under ? cut.q.clone().multiply(FLIP) : cut.q.clone() };
}

// То же в мире. Пропил ствола — в осях дерева, ветки — в осях ветки: пила ходит с ней, когда её качает.
function place(cut, shift) {
  const at = pose(cut, shift);
  const group = (cut.limb ?? cut.log)?.group;
  if (!group) {
    at.position.add(round.base);
    return at;
  }
  group.updateWorldMatrix(true, false);
  const m = group.matrixWorld;
  at.position.applyMatrix4(m);
  at.quaternion.premultiply(new THREE.Quaternion().setFromRotationMatrix(m));
  return at;
}

// Кромка пропила и куда идёт пила — в мире.
function inWorld(cut) {
  const { origin, along, side } = basis(cut);
  const group = (cut.limb ?? cut.log)?.group;
  if (!group) return { origin: origin.clone().add(round.base), along, side };
  group.updateWorldMatrix(true, false);
  const m = group.matrixWorld;
  return { origin: origin.clone().applyMatrix4(m), along: along.transformDirection(m), side: side.transformDirection(m) };
}

// Цепь выпиливает полосу от from до кромки по ходу пилы, а выпиленное летит щепками.
function bite(from) {
  const volume = (saw.kerf ?? round.voxels).carve(basis(saw), from, 0, barL());
  if (volume) spray(saw, volume);
}

// Щепки вылетают там, где цепь выходит из древесины, и летят по её ходу: по режущей кромке цепь бежит
// к мотору, а у пилы, перевёрнутой под U, — к носу. Где выходит: луч с конца кромки (со стороны хода цепи,
// чуть впереди кромки, где ещё не выпилено) упирается в кору. Если конец кромки сам в древесине, шина там
// сидит в щели, и цепь выносит щепки из её устья — на коре позади кромки.
function spray(cut, volume) {
  const { origin, along, side } = basis(cut), run = cut.under ? -1 : 1, wood = woodOf(cut);
  const end = origin.clone().addScaledVector(along, VOXEL).addScaledVector(side, (run * barL()) / 2);
  const hit = wood.pass(end, side.clone().multiplyScalar(-run), barL());
  if (!hit) return;
  const enter = Math.max(0, hit.enter);
  const back = enter ? 0 : (wood.pass(end, along.clone().negate(), REACH)?.exit ?? 0);
  const w = inWorld(cut);
  const at = w.origin.addScaledVector(w.along, VOXEL - back).addScaledVector(w.side, run * (barL() / 2 - enter));
  chips.spray(at, w.side.multiplyScalar(run), volume);
}

// Зажатую пилу бросаем в стволе: там остаётся её копия, а руки свободны. Когда дерево легло,
// пропил разжимается и пилу можно забрать из пня (land).
function leaveSaw() {
  const left = sawModel.clone();
  runChain(left, false, true, 0);
  left.traverse((part) => part.layers.set(0));
  const at = pose(saw);
  left.position.copy(at.position);
  left.quaternion.copy(at.quaternion);
  (saw.kerf?.mark ?? round.root).add(left);
  Object.assign(kit[held], { left, tree: round, kerf: saw.kerf ?? null, cut: saw, stuck: true });
  arm(kit.length - 1);
  unsay('pinch');
  unsay('narrow');
  // Обе пилы зажаты — пилить нечем: раунд проигран. Разожмёт их только само дерево, если упадёт.
  if (sawless()) showResult('ПИЛЫ ЗАСТРЯЛИ', ['Обе пилы зажаты в пропилах — раунд проигран']);
}

const sawless = () => kit.every((item) => !item.bar || item.stuck);

// Взять в руки вещь i из инвентаря.
function arm(i) {
  if (kit[i]?.ladder && ladderState) {
    notice('Сначала спустись и убери лестницу руками');
    return;
  }
  held = i;
  const { bar, pack } = kit[i];
  if (bar) heldSawMotion.setLength(Math.round(bar * 100));
  if ((bar || kit[i].ladder || kit[i].winch) && grasp) letGo();
  if (bar) dressSaw(sawModel, pack, bar);
  showKit();
}

// Достать вещь i: брошенную пилу — если она свободна и до неё дотягиваешься. Пилу, что приставлена
// к стволу, при этом убираешь, а зажатую оставляешь в пропиле.
function take(i) {
  const item = kit[i];
  if (!item || i === held) return;
  if (item.ladder && ladderState) {
    notice('Лестница приставлена — спустись и убери её руками');
    return;
  }
  if (item.left) {
    if (item.stuck) return notice(`${item.name} зажата в пропиле — её не вынуть`);
    const far = item.left.getWorldPosition(new THREE.Vector3()).distanceTo(eyeOf());
    if (far > TAKE) return notice(`${item.name} лежит в ${Math.round(far)} м — подойди`);
    if (item.body) {
      item.tree.world.remove(item.body);
      item.body.object.removeFromParent();
    } else item.left.removeFromParent();
    Object.assign(item, { left: null, tree: null, kerf: null, body: null, cut: null });
  }
  if (saw) stepBack();
  else releaseSaw();
  arm(i);
}

// Подсказка на пару секунд: почему не вышло то, что нажал.
let noted = { text: '', until: 0 };
const notice = (text) => { noted = { text, until: performance.now() + 2500 }; };

// Ячейки инвентаря: что в руках, где брошенные пилы.
const kitCells = [...kitEl.querySelectorAll('button')];
const kitLabels = kitCells.map(button => button.getAttribute('aria-label'));
const kitStatus = kitCells.map(button => button.querySelector('.tool-status'));
kitCells.forEach((button, i) => button.addEventListener('click', () => {
  if (playing && !fly) take(i);
  button.blur();
}));
winchControl.addEventListener('click', () => {
  tensionWinch();
  winchControl.blur();
});
function showKit() {
  kit.forEach((item, i) => {
    const where = item.left ? (item.stuck ? 'зажата' : `лежит, ${Math.round(item.left.getWorldPosition(new THREE.Vector3()).distanceTo(eyeOf()))} м`)
      : item.ladder && ladderState ? 'у дерева'
      : item.winch && winch?.staked ? 'на колу'
      : item.winch && winch?.tree ? 'привязана'
      : !item.bar && grasp ? `${Math.round(grasp.mass)} кг` : '';
    if (kitStatus[i].textContent !== where) kitStatus[i].textContent = where;
    const label = where ? [kitLabels[i], where].join(', ') : kitLabels[i];
    if (kitCells[i].getAttribute('aria-label') !== label) kitCells[i].setAttribute('aria-label', label);
    kitCells[i].classList.toggle('away', Boolean(item.left));
    if (kitCells[i].getAttribute('aria-pressed') !== String(i === held)) kitCells[i].setAttribute('aria-pressed', i === held);
  });
}

function ladderNearby() {
  return ladderState && Math.hypot(player.pos.x - ladderState.base.x, player.pos.z - ladderState.base.z) < 1.4
    && Math.abs(player.pos.y - ladderState.base.y) < 0.6;
}

function ladderTargeted() {
  if (!ladderState || climbing) return false;
  ladderModel.updateWorldMatrix(true, true);
  const ray = new THREE.Raycaster(eyeOf(), lookOf(), 0, PICK_RANGE);
  return ray.intersectObject(ladderModel, true).length > 0;
}

function placeLadder() {
  const placement = ladderPreview ?? ladderPlacementPreview();
  if (!placement) {
    notice('Подойди к стоящему дереву, чтобы примерить лестницу');
    return false;
  }
  ladderState = placement;
  poseLadder(placement.base, placement.right, placement.up);
  arm(2);
  return true;
}

function pickUpLadder() {
  if (held !== 2 || !ladderTargeted()) return false;
  ladderState = null;
  arm(3);
  return true;
}

function updateClimbPosition() {
  player.pos.copy(ladderClimbPosition(ladderState, climbing.progress));
}

function leaveLadder() {
  if (!climbing) return;
  if (climbing.progress > 0.12) {
    notice('Спустись по лестнице до земли, чтобы сойти');
    return;
  }
  player.pos.copy(ladderState.base).addScaledVector(ladderState.forward, -0.55);
  player.pos.y = ground(player.pos.x, player.pos.z);
  climbing = null;
}

function mountLadder() {
  if (!ladderNearby() || climbing || saw || grasp || mode !== 'free') return false;
  if (ladderState.tree.fall || ladderState.tree.top || !ladderState.tree.standing) {
    notice('К дереву, которое уже падает или спилено, не подняться');
    return false;
  }
  if (ladderState.stem !== undefined
    && Number.isFinite(ladderState.tree.stumps?.[ladderState.stem])
    && ladderState.tree.stumps[ladderState.stem] >= LADDER_ATTACH_HEIGHT) {
    notice('Уровень спила выше верхней точки лестницы');
    return false;
  }
  climbing = { progress: 0 };
  player.yaw = yawOf(ladderState.forward);
  updateClimbPosition();
  return true;
}

function climb(input, dt) {
  if (!climbing) return false;
  if (ladderState.tree.fall || ladderState.tree.top || !ladderState.tree.standing) {
    climbing.progress = 0;
    leaveLadder();
    return false;
  }
  if (ladderState.stem !== undefined
    && Number.isFinite(ladderState.tree.stumps?.[ladderState.stem])
    && ladderState.tree.stumps[ladderState.stem] >= LADDER_ATTACH_HEIGHT) {
    climbing.progress = 0;
    leaveLadder();
    notice('Спил выше верхней точки лестницы');
    return false;
  }
  const next = advanceLadderClimb(ladderState, climbing.progress, input.ahead, dt);
  if (next.leaveAtBottom) {
    climbing.progress = next.progress;
    leaveLadder();
    return false;
  }
  climbing.progress = next.progress;
  updateClimbPosition();
  return true;
}

function ladderPlacementPreview() {
  if (!kit[held]?.ladder || ladderState || climbing) return null;
  return findLadderPlacement(trees, player.pos, forwardOf(player.yaw), ground);
}

function winchTarget() {
  return findWinchTarget(trees, eyeOf(), lookOf());
}

function winchNearby() {
  return winch?.staked && player.pos.distanceTo(winch.position) < 1.8;
}

function winchTreeNearby() {
  return winch?.tree && Math.hypot(player.pos.x - winch.tree.base.x, player.pos.z - winch.tree.base.z) < 2;
}

function winchAction() {
  if (!playing || fly || !winch) return;
  if (!winch.tree) {
    const target = winchTarget();
    if (!target) {
      notice('Наведи прицел на стоящий ствол в пределах досягаемости');
      return;
    }
    if (winch.tie(target.tree, target.point)) notice('Трос привязан · отойди от ствола и вбей кол');
    return;
  }
  if (winchTreeNearby()) {
    winch.untie();
    notice('Трос отвязан от дерева');
    return;
  }
  if (winch.staked) return notice('Лебёдка уже на колу · подойди к ней и забери руками');
  if (climbing) return notice('Спустись с лестницы, чтобы вбить кол');
  const distance = Math.hypot(player.pos.x - winch.tree.base.x, player.pos.z - winch.tree.base.z);
  if (distance > 9) return notice('Подойди поближе к привязанному дереву, чтобы вбить кол');
  const away = new THREE.Vector3(player.pos.x - winch.tree.base.x, 0, player.pos.z - winch.tree.base.z).normalize();
  const peg = player.pos.clone().addScaledVector(away, 0.45);
  if (!canStand(peg.x, peg.z)) return notice('Здесь нельзя вбить кол · выбери свободное место');
  peg.y = ground(peg.x, peg.z);
  if (winch.plant(peg)) notice('Лебёдка установлена · натягивай отдельной кнопкой');
}

function tensionWinch() {
  if (!playing || fly || !winch?.tree || !winch.staked) return;
  if (winch.ratchet()) notice(`Натяжение лебёдки: ${Math.round((winch.tension / winch.maxTension) * 100)}%`);
  else notice('Лебёдка натянута до предела');
}

function winchActionLabel() {
  if (!winch.tree) return 'Привязать трос';
  if (winchTreeNearby()) return 'Отвязать трос';
  if (winch.staked) return 'Лебёдка на колу';
  if (climbing) return 'Спустись для установки';
  return 'Вбить кол';
}

function showWinchControl() {
  const show = playing && !fly && winch?.tree && winch.staked;
  winchControl.hidden = !show;
  if (show) {
    const label = `Натянуть лебёдку · ${Math.round((winch.tension / winch.maxTension) * 100)}%`;
    winchControl.textContent = label;
    winchControl.setAttribute('aria-label', label);
  }
}

function poseLadder(position, right, up) {
  const normal = right.clone().cross(up).normalize();
  ladderModel.position.copy(position);
  ladderModel.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, normal));
}

function carryLadder() {
  if (ladderState) {
    ladderPreview = null;
    ladderModel.visible = true;
    return;
  }
  ladderModel.visible = playing && !fly && kit[held]?.ladder;
  if (!ladderModel.visible) {
    ladderPreview = null;
    return;
  }
  ladderPreview = ladderPlacementPreview();
  if (ladderPreview) {
    poseLadder(ladderPreview.base, ladderPreview.right, ladderPreview.up);
    return;
  }
  const forward = forwardOf(player.yaw), right = new THREE.Vector3(-forward.z, 0, forward.x);
  const base = player.pos.clone().addScaledVector(forward, 0.85)
    .addScaledVector(right, 0.5).addScaledVector(UP, 0.05);
  poseLadder(base, right.negate(), UP);
}

// Руками берёшь то, во что упирается взгляд (до PICK_RANGE от глаз): отпил, кусок пня, ветку.
// Взятый кусок плавно парит в воздухе перед игроком (как на стенде хоздвора), а на плитке или углях распределяется в поленницу или костёр.
function reachable(eye, look) {
  let best = null;
  for (const tree of trees) {
    const from = eye.clone().sub(tree.root.position);
    for (const body of tree.world.bodies) {
      if (kit.some((item) => item.body === body)) continue;
      const hit = rayHit(body, from, look, best?.t ?? PICK_RANGE);
      if (hit) best = { tree, body, ...hit };
    }
  }
  if (!best) return null;
  if (!best.body.wood) classifyLimbBody(best.body);
  return best;
}

function grab() {
  const got = reachable(eyeOf(), lookOf());
  if (!got) return;
  const { tree, body } = got;
  if (!body.wood) classifyLimbBody(body);
  if (body.wood.tooHeavy) {
    notice(body.wood.verdict || 'Бревно тяжёлое — распили на части!');
    return;
  }
  const idx = tree.world.bodies.indexOf(body);
  if (idx !== -1) tree.world.bodies.splice(idx, 1);
  const yawOffset = new THREE.Euler().setFromQuaternion(body.quaternion, 'YXZ').y - player.yaw;
  const worldPos = body.position.clone().add(tree.root.position);
  grasp = {
    tree,
    body,
    yawOffset,
    rollAngle: 0,
    prevWorldPos: worldPos.clone(),
    mass: body.wood.mass,
    worldPos,
  };
}

function regrip() {
  if (grasp) letGo();
}

function endsOf(body, c) {
  const u = c.B.clone().sub(c.A).normalize(), along = (p) => p.clone().sub(c.A).dot(u);
  let low = 0, high = along(c.B);
  for (const d of body.capsules) {
    const s = [d.A, d.B].map(along);
    if ([d.A, d.B].some((p, i) => p.clone().sub(c.A).addScaledVector(u, -s[i]).length() > c.r)) continue;
    low = Math.min(low, ...s);
    high = Math.max(high, ...s);
  }
  return [c.A.clone().addScaledVector(u, low), c.A.clone().addScaledVector(u, high)];
}

// Отпустить: над плитняком или углями хоздвора кусок уходит в поленницу или в костёр, иначе падает обратно на землю.
function letGo(why) {
  if (!grasp) return;
  const { tree, body } = grasp;
  const worldPos = body.position.clone().add(tree.root.position);
  grasp = null;
  if (woodyard) woodyard.pad.mat.color.setHex(0xffffff);
  const zone = !why && woodyard ? woodyard.dropZoneAt(worldPos) : null;
  if (zone) {
    woodyard.acceptDroppedBody(body, zone);
  } else {
    tree.world.add(body);
    body.velocity.set(0, 0, 0);
    body.spin.set(0, 0, 0);
    body.wake();
  }
  if (why) notice(why);
}

// Лёгкие и средние куски плавно парят в воздухе перед игроком, а тяжёлые брёвна (до 1 м длиной) катятся по земле перед игроком как колесо.
function carry(dt) {
  const { tree, body, yawOffset } = grasp;
  const lerpFactor = 1 - Math.exp(-18 * dt);

  if (body.wood.canDrag) {
    dragBranch(body, tree.world, player.pos, forwardOf(player.yaw), dt);
    grasp.worldPos.copy(body.position).add(tree.root.position);
    return;
  }
  if (body.wood?.canRoll) {
    const forward = forwardOf(player.yaw);
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const r = Math.max(0.08, body.wood.radius || 0.14);
    const targetWorld = player.pos.clone().addScaledVector(forward, 1.45);
    targetWorld.y = ground(targetWorld.x, targetWorld.z) + r;

    const targetLocal = targetWorld.clone().sub(tree.root.position);
    body.position.lerp(targetLocal, lerpFactor);
    grasp.worldPos.copy(body.position).add(tree.root.position);

    const moveVec = grasp.worldPos.clone().sub(grasp.prevWorldPos);
    const signedDist = moveVec.dot(forward);
    grasp.rollAngle -= signedDist / r;
    grasp.prevWorldPos.copy(grasp.worldPos);

    // Ось бревна (cutDir) ставим поперёк хода (вдоль right) и крутим вокруг right на угол качения rollAngle
    const alignAcross = new THREE.Quaternion().setFromUnitVectors(body.wood.cutDir, right);
    const wheelSpin = new THREE.Quaternion().setFromAxisAngle(right, grasp.rollAngle);
    const targetQuat = wheelSpin.multiply(alignAcross);
    body.quaternion.slerp(targetQuat, lerpFactor);
    body.place();
    return;
  }

  const holdDist = body.wood?.holdDist ?? 1.7;
  const targetWorld = eyeOf().addScaledVector(lookOf(), holdDist);
  targetWorld.y += HOLD_DROP_LOW;
  const minHeight = ground(targetWorld.x, targetWorld.z) + Math.max(0.18, (body.wood?.radius ?? 0.08) + 0.08);
  if (targetWorld.y < minHeight) targetWorld.y = minHeight;

  const targetLocal = targetWorld.clone().sub(tree.root.position);
  body.position.lerp(targetLocal, lerpFactor);
  const targetQuat = new THREE.Quaternion().setFromAxisAngle(UP, player.yaw + yawOffset);
  body.quaternion.slerp(targetQuat, lerpFactor);
  body.place();
  grasp.worldPos.copy(body.position).add(tree.root.position);
}

// Пила выпала из разошедшегося пропила ствола: она — твёрдое тело, как отпил, падает и ложится на землю.
// Корпус с мотором — шар по обводу корпуса, шина — капсула; вес: корпус с аккумулятором 3,5 кг, шина с цепью
// 1,4 кг на метр. Центр тяжести — между ними по весу, момент инерции — от шара и стержня.
const MOTOR = 3.5, BAR_KG = 1.4;
function fallSaw(item) {
  const { left, bar } = item;
  const rim = left.userData.rim; // в копии пилы точки обвода — простые { x, y }
  const xs = rim.map((p) => p.x), ys = rim.map((p) => p.y);
  const motor = new THREE.Vector3((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2, 0);
  const r = (Math.max(...ys) - Math.min(...ys)) / 2;
  const mBar = BAR_KG * bar, mass = MOTOR + mBar;
  const com = motor.clone().multiplyScalar(MOTOR / mass);
  const d = motor.clone().sub(com);
  // Шина — стержень вдоль x с серединой в начале осей пилы, корпус — шар в motor.
  const sphere = 0.4 * MOTOR * r * r, rod = (mBar * bar * bar) / 12;
  const xy = -(MOTOR * d.x * d.y + mBar * com.x * com.y);
  const inertia = new THREE.Matrix3().set(
    sphere + MOTOR * d.y ** 2 + mBar * com.y ** 2, xy, 0,
    xy, sphere + MOTOR * d.x ** 2 + rod + mBar * com.x ** 2, 0,
    0, 0, sphere + MOTOR * d.lengthSq() + rod + mBar * com.lengthSq());
  const tree = item.tree;
  tree.root.updateMatrixWorld();
  const inTree = left.matrixWorld.clone().premultiply(tree.root.matrixWorld.clone().invert());
  const at = new THREE.Vector3(), q = new THREE.Quaternion();
  inTree.decompose(at, q, new THREE.Vector3());
  const object = new THREE.Group();
  tree.root.add(object);
  object.add(left);
  left.position.copy(com).negate();
  left.quaternion.identity();
  item.body = new Body(object, {
    mass, inertia, position: at.add(com.clone().applyQuaternion(q)), quaternion: q,
    capsules: [
      { a: new THREE.Vector3(-bar / 2, 0, 0).sub(com), b: new THREE.Vector3(bar / 2, 0, 0).sub(com), r: 0.02 },
      { a: d, b: d.clone(), r },
    ],
  });
  tree.world.add(item.body);
  Object.assign(item, { kerf: null, stuck: false });
}

// В каком стволе пропил cut (у двойного дерева их два): ближайший к нему на его высоте.
function stemOf(cut) {
  const { stems } = round.voxels.shape;
  const off = (stem) => stem.center(cut.origin.y).setY(0).distanceTo(cut.origin.clone().setY(0));
  return stems.indexOf(stems.reduce((a, b) => (off(b) < off(a) ? b : a)));
}

// Пилу держат горизонтально перед собой, шиной поперёк взгляда. У ствола она встаёт туда,
// где пойдёт пропил, и переходит туда плавно: руки доворачивают пилу, а не она прыгает.
function moveSaw(cut, shake, dt) {
  const target = place(cut);
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

// Первые листья принадлежат подпиленному стволу. Если недопил поддаётся несколько раз
// или к одному пню приросли два ствола, каждый осыпает свою крону один раз.
function crackTrunk(power) {
  const stems = round.body & ~round.shedStems;
  if (round.artistic && stems) {
    const cutY = round.voxels.middle * VOXEL;
    const sources = round.stems.flatMap((stem, i) => stems & (1 << i)
      ? [stem.crown, ...stem.lows.filter(l => l.y > cutY).map(l => l.limb)] : []);
    fallLeaves.shed(sources, round.base, round.seed ^ stems, ground);
    round.shedStems |= stems;
  }
  crack(power);
}

// Стоящее дерево: качает ветром, недопил гнётся под весом, и после каждого кубика
// пересчитываем, держит ли он дерево.
function stand(dt) {
  round.time += dt;
  const g = gust(round.base);
  round.sway.copy(wind.dir).multiplyScalar(g * wind.max);
  if (round.voxels.cutHigh >= 0 && round.secVersion !== round.voxels.version) {
    const body = round.voxels.cutStems(round.standing);
    if (body && body !== round.body) hold(body);
    else weigh();
    round.sec = section(round.voxels);
    lift();
    round.secVersion = round.voxels.version;
  }
  const { sec } = round;
  // Наклон ствола — упругий изгиб недопила и то, на сколько он уже осел насовсем (round.give).
  const { give } = round;
  const winchOffset = sec && winch?.tree === round
    ? winch.offset(round.root.localToWorld(new THREE.Vector3(sec.x0, (round.voxels.middle + 0.5) * VOXEL, sec.z0)), round.weight)
    : new THREE.Vector3();
  if (sec) {
    const c = round.com.clone().add(round.sway).addScaledVector(give.tilt, round.com.y).add(winchOffset);
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
  round.stems.forEach((s, i) => round.standing & (1 << i) && s.bend.quaternion.copy(sway));
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
  const tip = tipping(sec, c.clone().add(winchOffset), round.weight, round.tilt);
  if (tip.net > 0 || give.speed > 0 || round.buckle) {
    yieldHinge(sec, tip, c, dt, winchOffset);
    if (round.fall) return;
  }

  splitHinge(sec, tip, Math.min(1, tip.ratio));

  if (!sec.intact.length) say('free', 'Ствол перерезан насквозь, но стоит: вес пока над пнём');
  else if (tip.ratio > 0.7) {
    if (!round.said.creak) crackTrunk(0.3);
    say('creak', 'Недопил потрескивает — ещё немного');
  } else if (tip.ratio < 0.5) unsay('creak');

  // Щель под шиной: наклон ствола её сжимает или раскрывает. Шина лежит поперёк ствола, и когда он
  // клонится вбок, у одного её конца щель смыкается раньше — берём самое узкое место там, где шина в древесине.
  if (saw?.tree !== round || saw.kerf || saw.depth < 0.05) return;
  const b = basis(saw);
  for (let w = -barL() / 2; w <= barL() / 2; w += VOXEL) {
    const p = b.origin.clone().addScaledVector(b.side, w);
    if (!round.voxels.shape.contains(p.x, p.y, p.z)) continue;
    const g = kerfWidth(sec, round.bent, give, p, VOXEL - sec.sink - opening(sec, new THREE.Vector3(), saw.settled, p));
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
  if (squeezed && touch && seat >= 1 - 1e-6 && Math.abs(planeY(b, touch) - touch.mid) <= VOXEL) round.gap = 0;
  round.squeeze = squeezed && seat > SEATING;
  if (mode !== 'cut') return;
  // При сужении даём вынуть пилу. После повторного нажатия сомкнувшаяся щель зажимает шину.
  if (round.gap < CHEW && !saw.chewed) {
    saw.chewed = true;
    releaseSaw();
    say('chew', 'Пилу зажёвывает, цепь встала. Вынь её (S) или нажми снова');
  } else if (round.gap < BIND) {
    saw.pinched = true;
    releaseSaw();
    say('pinch', 'Шину зажало: щель сомкнулась, цепь встала. Пилу не вынуть');
  } else if (round.squeeze) {
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
function yieldHinge(sec, tip, c, dt, winchOffset) {
  const { give } = round;
  const u = give.speed > 0 ? give.u : round.buckle ?? tip.u;
  const lean = Math.max(0, round.tilt.dot(u));
  const t = lever(sec, c.clone().add(winchOffset), round.weight, u, lean);
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
  if (!round.said.yield) crackTrunk(0.4);
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
  crackTrunk(0.5);
  say('split', 'Треск вдоль ствола — его раскалывает вверх от недопила');
}

// Верх отделился от пня (недопил рвётся на высоте h) и дальше движется с upper: его комель толкает
// отпилы, что попались на пути. Что на пне после этого ни на чём не держится — кусок между пропилами,
// обрывок коры, — отваливается.
function separate(h, tongue, split) {
  round.stems.forEach((_, i) => { if (round.body & (1 << i)) round.stumps[i] = round.voxels.cutLow * VOXEL; });
  const log = round.voxels.splitTop(h, tongue, split, round.artistic);
  round.upper.add(log.group);
  log.group.userData.log = log;
  log.set = round.world.fix(round.upper, { solids: [log] });
  round.voxels.breakLoose().forEach(part => dropPiece(part));
  round.top = true;
}

// Верх перерезан по косой круче, чем держит трение, — он съезжает по срезу.
function startSlide(s) {
  separate(round.voxels.middle * VOXEL);
  round.slide = { ...s, s: 0, v: 0 };
  dropSaw();
  crackTrunk(0.6);
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
  crackTrunk(0.8);
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
  const began = fallStand && performance.now();
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
  round.upper.traverse((o) => { if (o.name === 'trunk') round.fall.knots.push(o); });
  if (round.artistic) {
    round.fall.motion = animateFall(round, round.fall, {
      floor: ground, query: fallStand?.query, effects: fallLeaves,
      hit(count) { fallStand?.onImpact(count); crack(0.85); },
      park(limb) { limbBody(limb, round.world.frame(limb.group, new THREE.Matrix4()), true).park(); },
    });
  }
  fallStand?.onFall(tip.u, performance.now() - began);
  dropSaw();
  crackTrunk(1);
  say('go', hinge ? 'Хруст! Пропил за недопилом раскрылся — дерево пошло' : 'Дерево пошло!');
}

// Дерево пошло — пилу от него убираешь. Пила у другого дерева так и остаётся в руках.
function dropSaw() {
  if (saw?.tree !== round) return;
  cutAfter = 0;
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
  return f.knots.some((k) => k.getWorldPosition(at).y - ground(at.x, at.z) <= k.userData.r);
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

// Отпиленный кусок — твёрдое тело: вес и момент инерции — по его кубикам, форма — вписанные в него шары.
// Он не летит сам, а падает оттуда, где его отрезало: с пня, из подпила, со спинки.
function dropPiece(part, frame = new THREE.Matrix4(), previous = null) {
  const { volume, center, inertia, balls } = part.form();
  const object = new THREE.Group();
  part.group.position.set(0, part.floor * VOXEL, 0).sub(center);
  object.add(part.group);
  round.root.add(object);
  const body = new Body(object, {
    mass: DENSITY * volume,
    inertia: inertia.multiplyScalar(DENSITY),
    position: center.clone().applyMatrix4(frame),
    quaternion: new THREE.Quaternion().setFromRotationMatrix(frame),
    capsules: balls.map(({ at, r }) => {
      const a = at.sub(center);
      return { a, b: a, r };
    }),
  });
  if (previous) {
    body.spin.copy(previous.spin);
    body.velocity.copy(previous.velocity).add(previous.spin.clone().cross(body.position.clone().sub(previous.position)));
  }
  body.voxels = part;
  round.world.add(body);
  return body;
}

// После сквозного реза нижний кусок комля свободен, верхний по-прежнему связан с кроной, если она есть.
function splitLog(log, row) {
  const body = round.world.bodies.find(b => b.voxels === log || b.logs?.includes(log));
  releaseSaw();
  dropSaw();
  if (!body) return;
  const frame = round.world.frame(log.group, new THREE.Matrix4())
    .multiply(new THREE.Matrix4().makeTranslation(0, -log.floor * VOXEL, 0));
  const layer = log.n * log.m, below = [];
  for (let id = 0; id < row * layer; id++) if (log.data[id]) below.push(id);
  const above = log.data.subarray((row + 1) * layer).some(Boolean);
  log.cutRows.delete(row);
  log.crosscut = null;
  if (below.length && (above || body.logs)) {
    const piece = log.detach(below);
    for (const j of log.cutRows) {
      if (j >= row) continue;
      (piece.cutRows ??= new Set()).add(j + log.floor - piece.floor);
      log.cutRows.delete(j);
    }
    log.removed.length = 0;
    dropPiece(piece, frame, body);
  }
  if (body.logs) {
    if (above) {
      const { volume, center, inertia, balls } = log.form();
      log.heft = { mass: DENSITY * volume, com: center, inertia: inertia.multiplyScalar(DENSITY), balls };
    } else {
      body.logs.splice(body.logs.indexOf(log), 1);
      log.group.removeFromParent();
    }
    const kept = relay(body);
    if (kept) kept.velocity.add(body.spin.clone().cross(kept.position.clone().sub(body.position)));
  } else {
    round.world.remove(body);
    body.object.removeFromParent();
    if (above || below.length) dropPiece(log, frame, body);
  }
}

// Ветка разошлась по пропилу kerf — его допилили или недопил не выдержал (и его, может быть, раскололо
// вдоль: chair): что за ним — отдельное тело. Пила из него свободна, а ту, что в нём зажало и бросили, забираешь.
function part(limb, kerf, chair = null) {
  for (const item of kit) {
    if (item.kerf !== kerf) continue;
    fallSaw(item);
    unsay('freed');
    say('freed', `Ствол разошёлся по пропилу — ${item.name.toLowerCase()} выпала`);
  }
  limb.kerfs.splice(limb.kerfs.indexOf(kerf), 1);
  kerf.mark.removeFromParent();
  kerf.mark.geometry.dispose();
  sever(limb, kerf.axis, kerf.s, chair);
  if (saw?.kerf === kerf) {
    mode = 'free';
    saw = null;
  }
}

// Недопил ветки под нагрузкой (strain у Kerf). Не держит — сминается там, где сжат: щель там смыкается
// и останавливает рез, если давит на шину. Или рвётся — ветка расходится по пропилу, и что на ней лежало, оседает;
// толстый растянутый недопил при этом раскалывает ветку вдоль (Kerf.tongue).
// Пока держит, но на пределе, тому, кто пилит, видно, к чему идёт. true — ветку разорвало.
function bear(limb, kerf, loads, g) {
  const { F, M } = limb.forces(kerf.axis, kerf.s, loads, g);
  for (;;) {
    const { ratio, closing, pulled, d } = kerf.strain(F, M);
    const pressingBlade = saw?.kerf === kerf && closing.length && kerf.onBlade(closing, basis(saw), barL(), BAR_W);
    if (ratio < 1) {
      if (saw?.kerf === kerf) saw.narrow = ratio > STRAIN && Boolean(pressingBlade);
      if (ratio > STRAIN && saw?.kerf === kerf && mode === 'cut') {
        if (pressingBlade) say('tight', 'Щель сужается — зажимает шину');
        else if (!closing.length) say('tear', 'Щель раскрывается — недопил вот-вот не выдержит');
      }
      return false;
    }
    unsay('tight');
    unsay('tear');
    if (!closing.length) {
      const chair = kerf.tongue(pulled, d);
      part(limb, kerf, chair);
      crack(chair ? 0.8 : 0.6);
      say('broke', chair
        ? `Недопил не выдержал — его растянутые волокна раскололи ветку вдоль на ${Math.round((chair.to - chair.from) * 100)} см`
        : 'Недопил не выдержал — ветку переломило по пропилу');
      return true;
    }
    kerf.close(closing);
    if (pressingBlade) stopCrosscut();
  }
}

function stopCrosscut() {
  releaseSaw();
  if (saw.kerf.axis.level === 0 && saw.kerf.r >= 0.055) {
    if (!saw.pinched) {
      saw.pinched = true;
      crack(0.3);
      say('pinch', 'Вес ствола зажал шину в пропиле');
    }
  } else {
    saw.kerf.stoppedFrom ??= basis(saw).along;
    saw.branchStopped = true;
  }
}

// Тело, в котором ветка limb: отпил или лежащее дерево. У стоящего дерева ветки не тела.
const bodyOf = (limb) => round.world.bodies.find((b) => b.limb === limb || b.limbs?.includes(limb));

// Что давит на ветку limb: касания тела, в котором она, и вес. Ветку стоящего дерева тянет только вес.
function pressing(limb) {
  const body = bodyOf(limb);
  return [body ? loadsOn(body, limb) : [], gravityIn(limb, body)];
}

// Ветку limb перепилило или сломало на оси axis в точке s (chair — раскол вдоль, Limb.split): всё, что дальше, —
// отдельное тело и падает. Отпиленный кусок распадается на два тела, лежащее дерево ложится заново без
// отпавшего. Со стоящего дерева ушёл вес — оно клонится иначе.
function sever(limb, axis, s, chair) {
  const frame = round.world.frame(limb.group, new THREE.Matrix4());
  const piece = limb.split(axis, s, chair).dress();
  limb.dress();
  const body = bodyOf(limb);
  const isHeld = Boolean(body && grasp?.body === body);
  const simple = Boolean(body?.fixedPose || body?.fallBranch);
  if (body?.limbs) relay(body);
  else if (body) {
    round.world.remove(body);
    body.object.removeFromParent();
    limbBody(limb, frame, simple);
  } else {
    round.world.refit(limb.set, limb.shape);
    const stem = round.stems[limb.stem];
    Object.assign(stem, heft(stem));
    if (!round.top) weigh();
  }
  limbBody(piece, frame, simple);
  if (isHeld) regrip();
}

// Отпиленная ветка — твёрдое тело: вес и инерция — по её древесине и листьям, форма — её капсулы.
// Падает оттуда, где была: frame — где ветка была в осях дерева.
function limbBody(limb, frame, simple = false) {
  const { mass, com, inertia } = limb.weight;
  const object = new THREE.Group();
  limb.group.position.copy(com).negate();
  limb.group.quaternion.identity();
  object.add(limb.group);
  round.root.add(object);
  const body = new Body(object, {
    mass, inertia, position: com.clone().applyMatrix4(frame), quaternion: new THREE.Quaternion().setFromRotationMatrix(frame),
    capsules: (simple ? coarseCapsules(limb) : limb.shape).map((c) => ({ a: c.a.clone().sub(com), b: c.b.clone().sub(com), r: c.r, soft: c.soft, src: { limb, capsule: c } })),
  });
  body.limb = limb;
  body.fallBranch = simple;
  round.world.add(body);
  return body;
}

// Дерево легло — дальше оно твёрдое тело, как отпил: ветки и комель упавшего верха (upper) ложатся на землю,
// на пень и друг на друга, а на чём оно легло, то его и держит. Что не держит, ломается (snapLimbs).
function lay(simple) {
  const limbs = [], logs = [];
  round.upper.traverse((o) => {
    if (o.userData.limb) limbs.push(o.userData.limb);
    if (o.userData.log) logs.push(o.userData.log);
  });
  for (const x of [...limbs, ...logs]) round.world.unfix(x.set);
  for (const log of logs) {
    if (simple) {
      const { volume, center } = log.measure(), mass = DENSITY * volume;
      const r2 = log.radius ** 2, side = mass * (3 * r2 + (log.ny * VOXEL) ** 2) / 12;
      log.heft = { mass, com: center, inertia: new THREE.Matrix3().set(side, 0, 0, 0, mass * r2 / 2, 0, 0, 0, side) };
    } else {
      const { volume, center, inertia } = log.form();
      log.heft = { mass: DENSITY * volume, com: center, inertia: inertia.multiplyScalar(DENSITY) };
    }
  }
  lyingBody(round.upper, limbs, logs, simple);
}

// Лежащее дерево — одно тело: вес, инерция и форма — по тому, где сейчас его ветки и комель. Комель из кубиков —
// капсулы по оси ствола радиусом в ствол, от торца (поджаты на радиус) до зоны, где начинаются капсулы ветки.
function lyingBody(upper, limbs, logs, simple = false) {
  const at = (o) => round.world.frame(o, new THREE.Matrix4());
  const turned = (inertia, m) => {
    const r = new THREE.Matrix3().setFromMatrix4(m);
    return r.clone().multiply(inertia).multiply(r.transpose());
  };
  const placed = limbs.map((limb) => ({ limb, m: at(limb.group), ...limb.weight })).filter((l) => l.mass > 0);
  if (!placed.length && !logs.length) {
    upper.removeFromParent();
    return null;
  }
  const m = at(upper);
  const { mass, com, inertia } = combine([
    ...placed.map((l) => ({ mass: l.mass, com: l.com.clone().applyMatrix4(l.m), inertia: turned(l.inertia, l.m) })),
    ...logs.map(({ heft: h }) => ({ mass: h.mass, com: h.com.clone().applyMatrix4(m), inertia: turned(h.inertia, m) })),
  ]);
  const capsules = placed.flatMap(({ limb, m: lm }) => (simple ? coarseCapsules(limb) : limb.shape).map((c) => ({
    a: c.a.clone().applyMatrix4(lm).sub(com), b: c.b.clone().applyMatrix4(lm).sub(com), r: c.r, soft: c.soft, src: { limb, capsule: c },
  })));
  for (const log of logs) {
    if (log.heft.balls) {
      for (const { at, r } of log.heft.balls) {
        const p = at.clone().applyMatrix4(m).sub(com);
        capsules.push({ a: p, b: p, r, src: { log } });
      }
      continue;
    }
    for (const { limb } of placed) {
      const trunk = limb.parts.find((p) => p.axis.stem !== undefined)?.axis;
      const run = trunk?.points.filter((q) => q.p.y >= log.box.low.y + q.r && q.p.y <= ZONE_H) ?? [];
      for (let i = 4; i < run.length + 3; i += 4) {
        const p = run[i - 4], q = run[Math.min(i, run.length - 1)];
        if (p === q) break;
        capsules.push({ a: p.p.clone().applyMatrix4(m).sub(com), b: q.p.clone().applyMatrix4(m).sub(com), r: (p.r + q.r) / 2, src: { log } });
      }
    }
  }
  const object = new THREE.Group();
  object.position.copy(com);
  round.root.add(object);
  object.updateMatrixWorld();
  object.attach(upper);
  const body = new Body(object, { mass, inertia, position: com, quaternion: new THREE.Quaternion(), capsules });
  Object.assign(body, { upper, limbs: placed.map((l) => l.limb), logs });
  if (simple) {
    body.fixedPose = true;
    body.park();
  }
  round.world.add(body);
  return body;
}

// От лежащего дерева отпало что-то: тело то же, но с тем, что осталось, и движется оно, как двигалось.
function relay(old) {
  round.world.remove(old);
  round.root.attach(old.upper);
  old.object.removeFromParent();
  const body = lyingBody(old.upper, old.limbs, old.logs, old.fixedPose);
  if (!body) return null;
  body.velocity.copy(old.velocity);
  body.spin.copy(old.spin);
  return body;
}

// Нагрузки на ветку limb от касаний тела body — в осях ветки: { axis, s, f, p } — сила f, точка p на её линии
// и где по оси она приложена (s — у точки капсулы, ближайшей к линии силы).
function loadsOn(body, limb) {
  limb.group.updateWorldMatrix(true, false);
  const toLimb = limb.group.matrixWorld.clone().invert().multiply(body.object.matrixWorld);
  const turn = new THREE.Matrix3().setFromMatrix4(toLimb);
  const loads = [];
  for (const c of body.capsules) {
    if (c.src?.limb !== limb || c.force.lengthSq() < 1) continue;
    const f = c.force.clone().applyMatrix3(turn);
    const p = c.force.clone().cross(c.torque).divideScalar(c.force.lengthSq()).applyMatrix4(toLimb);
    const { a, b, axis, from, to } = c.src.capsule;
    loads.push({ axis, s: THREE.MathUtils.lerp(from, to, nearestOn(a, b, p, f)), f, p });
  }
  return loads;
}

// Где на отрезке a–b (доля его длины) ближайшая точка к прямой через p по d.
function nearestOn(a, b, p, d) {
  const u = b.clone().sub(a), w = a.clone().sub(p);
  const uu = u.dot(u), ud = u.dot(d), dd = d.dot(d), uw = u.dot(w), dw = d.dot(w);
  const den = uu * dd - ud * ud;
  return den > 1e-12 ? THREE.MathUtils.clamp((ud * dw - dd * uw) / den, 0, 1) : 0;
}

// Ускорение свободного падения в осях ветки — в точке p (в осях ветки). Если ветка в теле body, из него вычитаем
// ускорение тела в этой точке (принцип д'Аламбера): тело, которое дёргает рука или останавливает земля, давит
// на свои сечения и силой инерции. Иначе рука, разгоняя лёгкий кусок, ломала бы его, как будто держит его стена.
function gravityIn(limb, body) {
  limb.group.updateWorldMatrix(true, false);
  const toLimb = limb.group.matrixWorld.clone().invert(), turn = new THREE.Matrix3().setFromMatrix4(toLimb);
  const g = new THREE.Vector3(0, -G, 0).applyMatrix3(turn);
  if (!body) return () => g;
  const a = body.accel.clone().applyMatrix3(turn), alpha = body.turnAccel.clone().applyMatrix3(turn);
  const w = body.spin.clone().applyMatrix3(turn), com = body.object.getWorldPosition(new THREE.Vector3()).applyMatrix4(toLimb);
  const r = new THREE.Vector3(), out = new THREE.Vector3();
  return (p) => {
    r.copy(p).sub(com);
    return out.copy(g).sub(a).sub(r.clone().crossVectors(alpha, r)).sub(r.clone().crossVectors(w, r.clone().crossVectors(w, r)));
  };
}

// Ветка не держит то, что на неё давит, — ломается в самом нагруженном сечении или по пропилу (bear). У лежащего
// дерева и отпилов, пока они движутся: улёгшееся тело уже на чём-то держится. По перелому за кадр: после
// него тело ложится иначе.
function snapLimbs() {
  for (const body of round.world.bodies) {
    if (body.asleep || body.fallBranch) continue;
    for (const limb of body.limbs ?? (body.limb ? [body.limb] : [])) {
      const loads = loadsOn(body, limb), g = gravityIn(limb, body);
      if (limb.kerfs.some((kerf) => bear(limb, kerf, loads, g))) return;
      const worst = loads.length ? limb.weakest(loads, g) : null;
      if (!worst || worst.ratio < 1) continue;
      sever(limb, worst.axis, worst.s);
      crack(0.5);
      say('snap', 'Хрусть — ветку под деревом сломало');
      return;
    }
  }
}

// Ветви упавшего дерева, что ушли в землю, сломались там, где в неё упёрлись: что дальше — пропало под
// деревом. Ствол и вторые лидеры не ломаются: на них дерево и легло.
function crush(limb) {
  const frame = round.world.frame(limb.group, new THREE.Matrix4());
  const at = new THREE.Vector3();
  for (const { axis } of [...limb.parts]) {
    const part = limb.parts.find((p) => p.axis === axis);
    if (!part || axis.level === 0) continue;
    const q = axis.points.find((p) => p.s >= part.from && p.s <= part.to && at.copy(p.p).applyMatrix4(frame).y - round.world.floor(at) < p.r);
    if (q) limb.split(axis, q.s).kerfs.forEach((k) => k.mark.geometry.dispose());
  }
  limb.dress();
}

function land(simple = false) {
  round.done = true;
  if (!simple) {
    fallStand?.onImpact(null);
    const lying = [];
    round.upper.traverse((o) => { if (o.userData.limb) lying.push(o.userData.limb); });
    lying.forEach(crush);
  }
  lay(simple);
  round.fall.motion?.finish();
  fallStand?.onLand();
  // Ствол лёг — его пропилы в пне разжались: брошенные в них пилы свободны.
  const freed = kit.filter((item) => item.tree === round && item.stuck && !item.kerf && fallen(round, stemOf(item.cut)));
  freed.forEach((item) => { item.stuck = false; });
  // Пришибло, если стоял там, куда лёг ствол: впереди оси по линии падения и не дальше метра вбок.
  const { u: f, pivot, len } = round.fall;
  const at = local(player.pos);
  const dx = at.x - pivot.position.x;
  const dz = at.z - pivot.position.z;
  const along = dx * f.x + dz * f.z;
  const squashed = playing && along > 0 && along < len && Math.abs(dx * f.z - dz * f.x) < 1;

  const saws = freed.length ? [`Пропил разжался — ${freed.length > 1 ? 'пилы в пне свободны' : 'пила в пне свободна'}, забери`] : [];
  // У двойного дерева мог упасть один ствол: второй стоит на пне, его валят заново.
  const rest = round.standing & ~round.body;
  const notes = [...saws, ...(rest ? ['Второй ствол ещё стоит'] : [])];
  if (squashed) showResult('ПРИШИБЛО', ['Не стой на линии падения', ...notes]);
  else showResult('ДЕРЕВО ЛЕГЛО', notes);
  if (rest) {
    round.voxels.restand();
    standUp(rest);
  }
}

// Пилить можно стоящее дерево и всё, что осталось, когда оно легло: пень, отщеп, спинку. Раунд кончается только по R.
const canSaw = () => !round.top || round.done;

function showResult(title, notes) {
  say('result', `${title} ${notes.join('. ')}`);
  if (!playing) return;
  clearTimeout(resultTimer);
  resultEl.innerHTML = `${title}${notes.map((n) => `<small>${n}</small>`).join('')}<small>R — новые клёны</small>`;
  resultEl.hidden = false;
  // Итог висит недолго и остаётся в журнале: дальше можно кромсать пень, пока не нажмёшь R.
  resultTimer = setTimeout(() => { resultEl.hidden = true; }, RESULT_SHOWN);
}

// Ближайшее к игроку дерево по горизонтали.
function nearest() {
  const away = (t) => Math.hypot(t.base.x - player.pos.x, t.base.z - player.pos.z);
  return trees.reduce((a, b) => (away(a) <= away(b) ? a : b));
}

// Земля под игроком задаёт высоту, на которой его тело может встретить стоящий ствол, пень или костёр.
function canStand(x, z) {
  if (!walkable(x, z)) return false;
  if (woodyard && !woodyard.canWalk(x, z)) return false;
  const floor = ground(x, z);
  for (const { base, voxels, stumps } of trees) {
    const { mid, reach, stems } = voxels.shape;
    const dx = x - base.x, dz = z - base.z;
    if (Math.abs(dx - mid.x) > reach.x + BODY_RADIUS || Math.abs(dz - mid.z) > reach.z + BODY_RADIUS) continue;
    const feet = floor - base.y;
    for (const [i, stem] of stems.entries()) {
      const high = Math.min(feet + player.eye, ZONE_H, stumps[i] ?? ZONE_H);
      for (let y = Math.max(0, feet); y <= high; y += 0.1) {
        const center = stem.center(y);
        const sx = dx - center.x, sz = dz - center.z;
        if (Math.hypot(sx, sz) < stem.outline(Math.atan2(sz, sx), y) + BODY_RADIUS) return false;
      }
    }
  }
  return true;
}

function movePlayer(dx, dz) {
  const { x, z } = player.pos;
  // У стены, ствола или кромки воды можно скользить вдоль препятствия.
  if (canStand(x + dx, z + dz)) player.pos.set(x + dx, 0, z + dz);
  else if (dx && canStand(x + dx, z)) player.pos.x += dx;
  else if (dz && canStand(x, z + dz)) player.pos.z += dz;
  // Поленница и костёр — твёрдые границы: если шаг всё же ввёл тело в рамку, общая проверка хоздвора
  // выталкивает наружу кратчайшей стороной (campfire.js: clampPlayer, она же blocksYard в canStand).
  if (woodyard) woodyard.clampPlayer(player.pos);
  player.pos.y = ground(player.pos.x, player.pos.z);
}

function stepBack() {
  releaseSaw();
  if (saw.pinched) leaveSaw();
  saw.chewed = false;
  unsay('chew');
  dropSaw();
}

function update(dt) {
  if (!saw) round = climbing?.tree ?? nearest();
  const forward = forwardOf(player.yaw);
  const right = new THREE.Vector3(-forward.z, 0, forward.x);

  const shift = keys.has('ShiftLeft') || keys.has('ShiftRight');
  // Ходить можно, только пока пила не приставлена к стволу и камера не летает.
  const input = walkInput(keys, stick);
  const move = new THREE.Vector3();
  if (!climbing && mode === 'free' && !fly && input.ahead > 0 && !saw && !grasp) mountLadder();
  if (climbing && !fly) {
    if (!saw) climb(input, dt);
  } else if (mode === 'free' && !fly) move.addScaledVector(forward, input.ahead).addScaledVector(right, input.side);
  const moving = move.lengthSq() > 0;
  const speed = moving ? move.length() * walkSpeed(player, keys) * haulSpeed(grasp?.body.wood) : 0;
  if (moving) {
    const step = move.normalize().multiplyScalar(speed * dt);
    movePlayer(step.x, step.z);
  }
  stepEyes(player, right, speed, dt);
  carryLadder();
  // Шаг назад от приставленной пилы — уходишь от пропила. Зажатая пила остаётся в стволе, руки свободны.
  if (saw && !fly && input.ahead < -0.2) stepBack();

  const candidate = mode === 'free' && !fly && kit[held].bar ? sawAt(forward) : null;
  if (cutAfter && performance.now() >= cutAfter && mode === 'aim' && trigger) startCut();
  showKit();

  if (mode === 'cut' && saw.limb && saw.kerf.closed.length && saw.kerf.onBlade(saw.kerf.closed, basis(saw), barL(), BAR_W)) stopCrosscut();
  if (mode === 'cut') {
    const { kerf, limb } = saw;
    if (!kerf && !round.cuts.includes(saw)) round.cuts.push(saw);
    if (limb && !limb.kerfs.includes(kerf)) {
      limb.kerfs.push(kerf);
      limb.group.add(kerf.mark);
    }
    // Цепь режет кромкой: выпиливаем полосу, которую кромка прошла за кадр. Дальше, чем пускает корпус, не идёт.
    const reach = Math.min(SAW_SPEED * dt * (saw.narrow ? 0.4 : 1), ahead(saw));
    const step = Math.max(0, Math.min(reach, bodyRoom(saw, reach, woodOf(saw))));
    saw.blocked = step < reach;
    if (saw.blocked) say('body', 'Пила упёрлась корпусом в древесину. Смени сторону реза или поверни пилу');
    else unsay('body');
    saw.edge.addScaledVector(basis(saw).along, step);
    saw.depth += step;
    bite(-step - VOXEL);
    if (saw.log) {
      if (kerf.through) { splitLog(saw.log, kerf.row); crack(0.3); }
    } else if (limb) {
      if (kerf.through) {
        part(limb, kerf);
        crack(0.3);
      } else bear(limb, kerf, ...pressing(limb));
    } else {
      round.voxels.breakLoose().forEach(part => dropPiece(part));
      round.voxels.remesh();
    }
  }
  if (saw?.loose) rest(saw);
  if (grasp) carry(dt);
  updateTrees(dt);
  showWinchControl();
  hudEl.classList.toggle('winch-aim', Boolean(kit[held].winch && !winch.tree && !fly));
  winch?.showTarget(kit[held].winch && !winch.tree && !fly ? winchTarget() : null);

  const shown = saw ?? candidate;
  if (touch) {
    touchSaw.hidden = Boolean(fly);
    const reverse = canReverseCut();
    const isTrigger = Boolean(kit[held].bar) && !reverse;
    let label = reverse ? 'С другой стороны' : isTrigger ? (shown ? 'Пилить' : 'Газ') : (grasp ? 'Бросить' : 'Взять');
    if (kit[held].winch) label = winchActionLabel();
    else if (held === 2 && winchNearby()) label = 'Забрать лебёдку';
    else if (kit[held].ladder) label = ladderPreview ? 'Поставить лестницу' : 'Примерить лестницу';
    else if (!kit[held].bar && climbing) label = 'Спуститься';
    else if (!kit[held].bar && ladderNearby()) label = ladderTargeted() ? 'Убрать лестницу' : 'Подняться';
    showAction(touchSaw, label, isTrigger, trigger);
  }
  aimPlane.visible = !fly && Boolean(shown) && mode !== 'cut';
  if (aimPlane.visible) {
    const r = shown.kerf?.r ?? shown.tree.voxels.radius;
    const plane = place(shown, r);
    aimPlane.position.copy(plane.position);
    aimPlane.quaternion.copy(plane.quaternion);
    aimPlane.scale.set(barL(), (shown.under ? -2 : 2) * r, 1);
  }

  if (saw?.limb) saw.warningTime = saw.narrow || saw.branchStopped ? (saw.warningTime ?? 0) + dt : 0;
  const message = hint();
  if (hintEl.textContent !== message) hintEl.textContent = message;
  depthEl.style.visibility = saw ? 'visible' : 'hidden';
  if (saw) depthFillEl.style.width = `${(saw.depth / (saw.depth + ahead(saw))) * 100}%`;

  gapEl.hidden = round.gap === null || round.top;
  if (!gapEl.hidden) {
    const mm = round.gap;
    gapEl.textContent = `Щель ${mm.toFixed(0)} мм${mm < 9 ? ' — сужается' : mm > 11 ? ' — расширяется' : ''}`;
  }
  if (shown) {
    // При первом наведении шина сразу совпадает с разметкой, в том числе у лежащей ветки.
    if (!sawModel.visible || !saw) {
      const at = place(shown);
      sawModel.position.copy(at.position);
      sawModel.quaternion.copy(at.quaternion);
    } else {
      const shake = new THREE.Vector3();
      if (mode === 'cut') shake.set(Math.random() - .5, Math.random() - .5, Math.random() - .5).multiplyScalar(.006);
      moveSaw(saw, shake, dt);
    }
  }
  lamp(sawModel, !!saw && (saw.branchStopped || saw.narrow || saw.pinched || round.squeeze));
  runChain(sawModel, trigger, Boolean(saw?.branchStopped || saw?.pinched || (saw?.chewed && mode === 'aim')), dt);

  if (fly) flyCamera(dt, shift);
  else frame(dt);

  updateSawVisibility(shown);
  // При переноске предметов в режиме рук предмет парит перед игроком (без прыгающих 3D-рук в кадре)
  arms.group.visible = false;
  if (woodyard) {
    if (grasp) {
      const zone = woodyard.dropZoneAt(grasp.worldPos);
      woodyard.pad.mat.color.setHex(zone === 'paving' ? 0xc2d8b8 : 0xe8e2d4);
    } else {
      woodyard.pad.mat.color.setHex(0xffffff);
    }
  }
}

// Наведение показывает модель, но ещё не создаёт пропил и не ограничивает ходьбу.
function updateSawVisibility(target = saw) {
  sawModel.visible = playing && !fly && Boolean(target) && Boolean(kit[held].bar);
  const hidden = !playing || Boolean(fly || target) || !kit[held].bar;
  if (hidden && !heldSawEl.hidden) heldSawMotion.stop();
  heldSawEl.hidden = hidden;
  if (!hidden) heldSawMotion.setThrottle(trigger);
}

// Все деревья продолжают падать, а куски — двигаться, когда игрок переключается в облёт.
function updateTrees(dt) {
  chips.step(dt, ground);
  woodyard?.tick(dt);
  const here = round;
  for (const tree of trees) {
    round = tree;
    round.gap = null;
    round.squeeze = false;
    if (!round.top) stand(dt);
    else if (round.slide) slideTop(dt);
    if (round.fall && !round.done) {
      if (round.fall.motion) {
        if (round.fall.motion.step(dt)) land(true);
      } else fallTop(dt);
    }
    // Уложенные анимацией сучья уже в покое. Обычные отпилы и пропилы по-прежнему
    // чувствуют движение своих опор, в том числе пока их дерево ещё стоит.
    if (!tree.artistic || tree.world.bodies.some(b => !b.asleep || !(b.fixedPose || b.fallBranch))) {
      tree.world.step(dt);
      snapLimbs();
    }
  }
  round = here;
  fallLeaves.tick(dt);
}

// Камера по ракурсу shot. Сменился ракурс, или пилу приставили, или отошли — камера не прыгает,
// а за SWAP секунд переезжает из того места, где была.
let shot = screenMode === 'game' ? 0 : SHOTS.findIndex((s) => s.name === recall('shot', SHOTS.map((s) => s.name)));
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
  eyeCamera(camera, player);
  if (saw && (low || back)) {
    // Смотрим между лампой и пропилом: в кадре и шина в древесине, и корпус с лампой.
    const lit = sawModel.getObjectByName('lamp').getWorldPosition(new THREE.Vector3());
    const b = inWorld(saw);
    const focus = b.origin.add(lit).multiplyScalar(0.5);
    if (low) camera.position.y = Math.min(player.pos.y + player.eye, focus.y + low);
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
  fly.pos.y = THREE.MathUtils.clamp(fly.pos.y, ground(fly.pos.x, fly.pos.z) + 0.02, round.base.y + ZONE_H + 1);
  camera.position.copy(fly.pos);
  camera.rotation.set(fly.pitch, fly.yaw, 0);
}

function setFlying(on) {
  fly = on ? { pos: camera.position.clone(), yaw: player.yaw, pitch: player.pitch } : null;
  if (on) releaseSaw();
  camera.near = on ? FLY_NEAR : NEAR;
  camera.updateProjectionMatrix();
}

// Повернуть пилу вокруг её оси axis (TURN, TILT или ROLL) на angle. Пила поворачивается вокруг
// кромки. В плоскости полотна — свободно: конец шины, что идёт в древесину, выбирает бегущая цепь.
// Пропил ветки всегда поперёк неё: у ветки пилу крутят только в плоскости полотна.
// Из плоскости шина упирается в стенки щели: едва вошла — крути как хочешь, вошла целиком — чуть-чуть.
// На ходу из плоскости не повернуть: иначе бегущая цепь шаг за шагом расширяет щель под новый угол
// и закручивает пропил винтом. Зажатую шину не повернуть никак.
function steer(axis, angle) {
  if (saw.pinched || ((mode === 'cut' || saw.kerf) && axis !== TURN)) return;
  // Шагами, чтобы конец шины за шаг сдвигался не больше чем на полкубика: так цепь не оставит
  // недопиленных клиньев, а шина не проскочит сквозь стенку щели.
  const steps = saw.depth > 0 ? Math.ceil((Math.abs(angle) * barL()) / VOXEL) : 1;
  for (let i = 0; i < steps; i++) {
    const q = saw.q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(axis, angle / steps));
    saw.stuck = (!saw.kerf && (!aimable(q) || !fitsKerf(q))) || (saw.depth > 0 && bodyRoom({ ...saw, q }, 0, woodOf(saw)) < 0);
    if (saw.stuck) return;
    saw.q.copy(q);
    saw.blocked = false;
    if (mode === 'cut') bite(-VOXEL);
  }
  // Мышь шлёт сотни событий в секунду, а кромку на кору кладём раз за кадр (rest в update).
  if (!saw.depth) saw.loose = true;
}

// Пила ещё не в древесине: повёрнутая кромка не может войти в ствол (ветку) сама и не висит в воздухе,
// а ложится на кору — туда, где первой её коснётся, если подвести её по ходу пилы.
function rest(cut) {
  cut.loose = false;
  const { along, side } = basis(cut);
  const from = cut.edge.clone().addScaledVector(along, -REACH);
  const wood = woodOf(cut);
  const hit = wood.band(from, along, side, 2 * REACH, barL() / 2);
  if (hit) cut.origin.copy(cut.edge.copy(from.addScaledVector(along, Math.min(hit.enter, bodyRoom({ ...cut, edge: from }, hit.enter, wood)))));
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
  if (round.fall && !round.done) return 'Падает! Беги!';
  if (fly) return 'Осмотр · I — вернуться';
  if (saw?.branchStopped && saw.warningTime < 0.55) return 'Щель сужается, зажимает шину';
  if (saw?.branchStopped) return 'Дальше не идёт, зажимает. Пили с другой стороны' + (PHONE ? ' или потяни круг назад' : ' (U) или вынь пилу (S)');
  if (saw?.narrow && !saw.pinched) return 'Щель сужается, начинает зажимать шину';
  if (performance.now() < noted.until) return noted.text;
  if (saw?.pinched) return 'Зажало · оставь пилу в стволе (S)';
  if (saw?.chewed && mode === 'aim') return 'Пилу зажёвывает · вынь её (S) или нажми снова';
  if (saw?.blocked) return 'Упёрлась корпусом · поверни пилу или вынь (S)';
  if (kit[held].winch) {
    if (!winch.tree) return 'Наведи на ствол · отметь точку привязки и нажми действие';
    if (winchTreeNearby()) return 'Рядом с деревом · нажми действие, чтобы отвязать трос';
    if (winch.staked) return 'Лебёдка на колу · руки — забрать её';
    return 'Отойди от дерева · нажми действие, чтобы вбить кол';
  }
  if (held === 2 && winchNearby()) return 'Лебёдка рядом · нажми действие, чтобы забрать';
  if (sawless()) return 'Обе пилы застряли · R — новые клёны';
  if (climbing) return 'W/S — подниматься/спускаться · у земли — сойти';
  if (kit[held].ladder) return ladderPreview
    ? 'Лестница примерена к стволу · ЛКМ — оставить'
    : 'Подойди к дереву, чтобы примерить лестницу';
  if (ladderNearby() && held === 2) return ladderTargeted()
    ? 'ЛКМ — убрать лестницу в инвентарь · W — подняться'
    : 'Подойди к лестнице и нажми W, чтобы подняться';
  const near = kit.findIndex((item) => item.left && !item.stuck && item.left.getWorldPosition(new THREE.Vector3()).distanceTo(eyeOf()) <= TAKE);
  if (near >= 0) return `${kit[near].name} рядом · ${near + 1} — взять`;
  if (kit[held].bar) return '';
  if (grasp) {
    const zone = woodyard?.dropZoneAt(grasp.worldPos);
    const rolling = grasp.body.wood?.canRoll;
    if (zone === 'embers') return 'ЛКМ — бросить в угли (сгорит целиком)';
    if (zone === 'paving') return grasp.body.wood?.fitsPile ? (rolling ? 'ЛКМ — закатить в поленницу' : 'ЛКМ — уложить в поленницу') : 'ЛКМ — отправить в костёр';
    const action = rolling ? 'Катишь' : grasp.body.wood.canDrag ? 'Тащишь по земле' : 'Несёшь';
    return `${action} · ${grasp.body.wood.title} · отпустить`;
  }
  const got = reachable(eyeOf(), lookOf());
  if (!got) return '';
  return got.body.wood?.tooHeavy
    ? `${got.body.wood.title} — ${got.body.wood.verdict}`
    : `${got.body.wood.title} · ${got.body.wood.canRoll ? 'Катить' : got.body.wood.canDrag ? 'Тащить' : 'Взять'}`;
}

// Захват мыши может не дать браузер (например, без жеста пользователя); игра от этого не ломается.
function lockPointer() {
  canvas.requestPointerLock?.()?.catch(() => {});
}

addEventListener('keydown', (e) => {
  if (!playing || e.code === 'KeyF') return;
  if (e.target === touchSaw && (e.code === 'Space' || e.code === 'Enter')) {
    e.preventDefault();
    if (!e.repeat) pressSaw();
    return;
  }
  if (!e.repeat) note(e.code);
  keys.add(e.code);
  if (e.code === 'KeyR' && !e.repeat && !fallStand) regrow();
  if (e.code === 'KeyP' && !e.repeat) {
    const reported = round;
    tell().then((ok) => {
      if (!playing || reported !== round) return;
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
  if (screenMode === 'fly' && e.code === 'KeyI' && !e.repeat) setFlying(!fly);
  if (fly) return;
  if (e.code === 'KeyT' && !e.repeat) {
    tensionWinch();
    return;
  }
  if (e.repeat && !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyQ', 'KeyE'].includes(e.code)) return;
  if (e.code === 'KeyE' && !e.repeat && mode === 'free') {
    if (climbing) leaveLadder();
    else mountLadder();
    return;
  }
  // Отход от пропила — разовое действие. Даже нажатие короче кадра должно отпустить пилу.
  if (e.code === 'KeyS' && saw) stepBack();
  if (e.code === 'KeyC') player.crouch = !player.crouch;
  if (e.code === 'KeyL') hudEl.classList.toggle('details');
  // Цифры — взять вещь из инвентаря.
  const digit = /^Digit(\d)$/.exec(e.code);
  if (digit) take(Number(digit[1]) - 1);
  // V — другая модель пилы у пропила.
  if (e.code === 'KeyV' && kit[held].bar) {
    const item = kit[held];
    item.pack = PACKS[(PACKS.indexOf(item.pack) + 1) % PACKS.length];
    dressSaw(sawModel, item.pack, item.bar);
    keep(held ? 'pack-short' : 'pack-long', item.pack);
  }
  if (e.code === 'KeyU' && !e.repeat) changeCutSide();
  if (screenMode === 'fly' && e.code === 'KeyK') {
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
addEventListener('keyup', (e) => {
  keys.delete(e.code);
  if (e.target === touchSaw && (e.code === 'Space' || e.code === 'Enter')) releaseSaw();
});
touchSaw.addEventListener('blur', releaseSaw);
addEventListener('blur', () => {
  heldSawMotion.stop();
  keys.clear();
  releaseSaw();
});

function canReverseCut() {
  return saw?.kerf && (saw.branchStopped || saw.blocked || saw.pinched);
}

function changeCutSide() {
  under = !under;
  if (saw?.kerf) {
    if (saw.pinched) {
      const spare = kit.findIndex(item => item.bar && !item.left && item !== kit[held]);
      leaveSaw();
      if (spare < 0) { dropSaw(); return; }
      arm(spare);
    }
    releaseSaw();
    saw = mount(saw, eyeOf(), forwardOf(player.yaw));
  }
  unsay('under');
  say('under', under ? 'Пилишь снизу, верхней кромкой шины' : 'Пилишь сверху');
}

function startCut() {
  cutAfter = 0;
  if (saw.pinched || saw.branchStopped) return;
  if (saw.depth === 0 && !saw.kerf) saw.edge.y = saw.origin.y = (Math.floor(saw.origin.y / VOXEL) + .5) * VOXEL;
  mode = 'cut';
}

function pressSaw() {
  if (!playing || fly) return;
  if (mode === 'free' && kit[held].winch) {
    winchAction();
    return;
  }
  if (mode === 'free' && held === 2 && winchNearby() && !climbing && !grasp) {
    winch.pickUp();
    notice('Лебёдка в руках · выбери её в инвентаре');
    return;
  }
  if (climbing && touch && !kit[held].bar) {
    climbing.progress = Math.max(0, climbing.progress - 0.45);
    if (climbing.progress === 0) leaveLadder();
    else updateClimbPosition();
    return;
  }
  if (mode === 'free' && !kit[held].bar) {
    if (kit[held].ladder) {
      placeLadder();
      return;
    }
    if (held === 2 && pickUpLadder()) return;
    if (touch && held === 2 && ladderNearby() && !climbing) {
      mountLadder();
      return;
    }
    if (climbing) return;
  }
  if (touch && canReverseCut()) {
    changeCutSide();
    return;
  }
  if (saw?.branchStopped) return;
  trigger = Boolean(kit[held].bar);
  if (mode === 'aim') {
    startCut();
  } else if (mode === 'free' && kit[held].bar) {
    saw = sawAt(forwardOf(player.yaw));
    if (saw) {
      round = saw.tree;
      mode = 'aim';
      cutAfter = performance.now() + SEAT_HOLD_MS;
    }
  } else if (mode === 'free') {
    if (grasp) letGo();
    else grab();
  }
}

function releaseSaw() {
  cutAfter = 0;
  trigger = false;
  if (mode === 'cut') mode = 'aim';
}

canvas.addEventListener('contextmenu', (e) => { if (playing) e.preventDefault(); });
canvas.addEventListener('pointerdown', (e) => {
  if (!playing || e.pointerType !== 'mouse') return;
  note(`mouse${e.button} ${mode}`);
  if (e.button !== 0) return;
  if (document.pointerLockElement !== canvas) lockPointer();
  pressSaw();
});
addEventListener('mouseup', (e) => {
  if (!playing) return;
  note(`up${e.button} ${mode}`);
  if (e.button === 0) releaseSaw();
});
touchSaw.addEventListener('pointerdown', (e) => {
  if (!playing || sawPointer !== null || e.button !== 0) return;
  e.preventDefault();
  sawPointer = e.pointerId;
  touchSaw.setPointerCapture(e.pointerId);
  pressSaw();
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  touchSaw.addEventListener(type, (e) => {
    if (e.pointerId !== sawPointer) return;
    sawPointer = null;
    releaseSaw();
  });
}
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === canvas) return;
  releaseSaw();
});
document.addEventListener('mousemove', (e) => {
  if (playing && document.pointerLockElement === canvas) look(e.movementX * MOUSE, e.movementY * MOUSE);
});

function look(dx, dy) {
  if (fly) {
    fly.yaw -= dx;
    fly.pitch = THREE.MathUtils.clamp(fly.pitch - dy, -1.5, 1.5);
  } else if (climbing) {
    turnHead(player, dx, dy);
  } else if (mode === 'free') {
    turnHead(player, dx, dy);
  } else {
    // Мышь водит пилу: вбок — поворот, вверх-вниз — наклон; с Shift — в пять раз точнее.
    const k = keys.has('ShiftLeft') || keys.has('ShiftRight') ? FINE : 1;
    steer(TURN, -dx * k);
    steer(TILT, -dy * k);
  }
}

function touchWalk(side, ahead) {
  if (fly) return;
  if (climbing) {
    if (saw) {
      if (ahead < 0) stepBack();
      return;
    }
    const progress = climbing.progress + ahead;
    if (ahead < 0 && progress <= 0) {
      climbing.progress = 0;
      leaveLadder();
    } else {
      climbing.progress = THREE.MathUtils.clamp(progress, 0, ladderState.maxProgress);
      updateClimbPosition();
    }
    return;
  }
  if (saw) {
    if (ahead < 0 && -ahead > Math.abs(side)) stepBack();
    return;
  }
  const { x, z } = forwardOf(player.yaw);
  const speed = haulSpeed(grasp?.body.wood);
  side *= speed;
  ahead *= speed;
  // Длинный жест разбиваем на шаги, чтобы нельзя было проскочить сквозь ствол или забор.
  const steps = Math.ceil(Math.hypot(side, ahead) / 0.25);
  for (let i = 0; i < steps; i++) movePlayer((x * ahead - z * side) / steps, (z * ahead + x * side) / steps);
}

function enter({ x, z }, yaw, byTouch, capture = !byTouch) {
  playing = true;
  touch = byTouch || screenMode === 'game';
  keys.clear();
  player.pos.set(x, ground(x, z), z);
  player.yaw = yaw;
  player.pitch = player.bob = player.gait = 0;
  player.step.set(0, 0, 0);
  round = nearest();
  camera.fov = fov;
  camera.near = NEAR;
  camera.updateProjectionMatrix();
  camera.layers.enable(TOOLS);
  const forward = forwardOf(yaw);
  const right = new THREE.Vector3(-forward.z, 0, forward.x);
  const [out, down, aside] = SHOTS[shot].hold;
  const grip = eyeOf().addScaledVector(forward, out).addScaledVector(right, -aside).addScaledVector(UP, -down);
  const pose = place({ edge: local(grip), q: facing(yaw) });
  sawModel.position.copy(pose.position);
  sawModel.quaternion.copy(pose.quaternion);
  swap.kind = `${shot} false`;
  swap.t = 1;
  frame(0);
  hudEl.hidden = false;
  stickEl.hidden = touchSaw.hidden = !touch;
  updateSawVisibility();
  showKit();
  if (capture) lockPointer();
}

function leave() {
  if (saw) stepBack();
  releaseSaw();
  if (grasp) letGo();
  climbing = null;
  winch?.showTarget(null);
  ladderPreview = null;
  if (!ladderState) ladderModel.visible = false;
  playing = false;
  if (sawPointer !== null) {
    if (touchSaw.hasPointerCapture(sawPointer)) touchSaw.releasePointerCapture(sawPointer);
    sawPointer = null;
  }
  keys.clear();
  setFlying(false);
  if (document.pointerLockElement === canvas) document.exitPointerLock();
  camera.layers.disable(TOOLS);
  aimPlane.visible = arms.group.visible = false;
  updateSawVisibility();
  clearTimeout(resultTimer);
  hudEl.hidden = resultEl.hidden = true;
  pauseWatch();
  return player;
}

// Что записать в бортовой журнал сторожа зависаний (watch.js): режим, игрок, пила, дерево и все пропилы.
const r3 = (a) => a.map((v) => +v.toFixed(3));
watch(() => ({
  mode,
  player: r3([player.pos.x, player.pos.z, player.yaw, player.pitch, player.eye]),
  wind: r3([wind.dir.x, wind.dir.z, wind.max, wind.phase, wind.time]),
  saw: saw && { limb: !!saw.limb, edge: r3(saw.edge.toArray()), q: r3(saw.q.toArray()), depth: +saw.depth.toFixed(3), pinched: !!saw.pinched },
  tree: round && {
    slot: round.slot, seed: round.seed, time: +round.time.toFixed(2), mass: Math.round(round.mass), com: r3(round.com.toArray()),
    top: round.top, slide: !!round.slide, fall: round.fall && r3([round.fall.angle, round.fall.speed]),
    cuts: round.cuts.map((c) => ({ origin: r3(c.origin.toArray()), q: r3(c.q.toArray()), depth: +c.depth.toFixed(3) })),
  },
}));

function tick(now, dt) {
  if (playing) {
    update(dt);
    beat(now);
  } else updateTrees(dt);
  winch?.update();
}

// Стенд владеет сценой, камерой и кадром. Игра добавляет в его двор клёны, пилу, хоздвор (поленницу и костёр) и управление.
export function attachGame({ scene: yard, camera: eyes, ground: floor, groundNormal: normal, walkable: free, createWoodyard, treePlots = MAPLES, study }) {
  plots = treePlots;
  fallStand = study;
  scene = yard;
  winch = createWinch(scene);
  camera = eyes;
  ground = floor;
  groundNormal = normal;
  walkable = free;
  camera.rotation.order = 'YXZ';
  scene.add(aimPlane, sawModel, chips, arms.group);
  scene.add(ladderModel);
  woodyard = createWoodyard?.({
    scene,
    withFence: false,
    onNotice: (msg) => {
      notice(msg);
      if (round) {
        unsay('woodyard');
        say('woodyard', msg);
      }
    },
  });
  fallLeaves = makeFallLeaves(scene);
  // Открытие звукового устройства может задержать первый хруст. Готовим его во время загрузки.
  audio ??= new AudioContext();
  const listen = () => { if (audio.state === 'suspended') audio.resume().catch(() => {}); };
  addEventListener('pointerup', listen, { capture: true, once: true });
  addEventListener('keydown', listen, { capture: true, once: true });
  if (study) {
    // Та же геометрия пропила и тот же вход в падение, что у пилы. Для повтора стенд
    // прорезает весь ряд на заданной высоте и задаёт направление одного толчка.
    study.fell = direction => {
      if (!round || round.top) return;
      const y = 0.705, side = UP.clone().cross(direction);
      round.voxels.carve({ origin: new THREE.Vector3(0, y, 0), along: direction, side, normal: UP }, -2, 2, 4);
      round.voxels.remesh();
      round.sec = section(round.voxels);
      lift();
      weigh();
      startFall({ u: direction, p: round.voxels.radius * 0.8, hold: 0 }, round.com, 0, 0.48);
    };
    study.movingBodies = () => round.world.bodies.reduce((n, b) => n + Number(!b.asleep), 0);
  }
  // Точка появления игрока при входе в «Игру»: у ворот, с внутренней стороны (house-view.js привязывает её
  // к фактическим воротам забора). yaw = Math.PI — лицом во двор (спиной к улице), чтобы сразу идти вперёд.
  const spawn = () => spawnPoint ?? { x: MAPLES[1].x, z: MAPLES[1].z + 4, yaw: 0 };
  return { get active() { return playing; }, setSpawn: (p) => { spawnPoint = p; }, spawn, placeWoodyard: woodyard?.placeByGate, regrow, canStand, enter, leave, tick, look, touchWalk };
}
