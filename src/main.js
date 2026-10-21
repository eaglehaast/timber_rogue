import * as THREE from 'three';
import { TrunkVoxels, VOXEL } from './trunk.js';
import {
  section, tipping, closing, pivotHeight, tearAngle, slope, deflection, kerfWidth, FRICTION,
} from './physics.js';

const TRUNK_R = 0.3;
const TREE_H = 12;
const REACH = 1.0;        // докуда достаёт пила от лица до коры
const MAX_ENTRY = 2.0;    // выше этого пилу к стволу не приставить
// Низ ствола из вокселей: выше самой высокой точки входа ещё запас, чтобы полотно, наклонённое вверх, шло по древесине.
const ZONE_H = 3.2;
const SAW_SPEED = 0.2;    // метров глубины в секунду
const BAR_L = 0.7;        // длина шины
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
const TOLERANCE = THREE.MathUtils.degToRad(10);
const EYE = 1.7;
const G = 9.8;
const MOUSE = 0.0022;

const canvas = document.getElementById('scene');
const hintEl = document.getElementById('hint');
const depthEl = document.getElementById('depth');
const depthFillEl = document.getElementById('depthFill');
const handsEl = document.getElementById('hands');
const resultEl = document.getElementById('result');
const logEl = document.getElementById('log');
const startEl = document.getElementById('start');
const gapEl = document.getElementById('gap');
const sideEl = document.getElementById('side');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9cc4e4);
scene.fog = new THREE.Fog(0x9cc4e4, 30, 90);
const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 200);
camera.rotation.order = 'YXZ';
// Вид сбоку — справа от игрока, на всё дерево: видно, клонится ли ствол к тебе или от тебя.
const sideCamera = new THREE.PerspectiveCamera(50, 0.75, 0.5, 200);

scene.add(new THREE.HemisphereLight(0xdfefff, 0x4a5a30, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(20, 30, 10);
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.MeshLambertMaterial({ color: 0x5d8a3a }),
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const barkMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2b });
const voxelMat = new THREE.MeshLambertMaterial({ vertexColors: true });
const crownMat = new THREE.MeshLambertMaterial({ color: 0x2f5d2a });
const targetMat = new THREE.MeshBasicMaterial({
  color: 0x4cff6a, transparent: true, opacity: 0.35, depthWrite: false,
});

// Прицел пилы: полупрозрачная плоскость, по которой пойдёт пропил, и сама шина на текущей глубине.
const aimPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(BAR_L, 2 * TRUNK_R),
  new THREE.MeshBasicMaterial({
    color: 0xff9a2e, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false,
  }),
);
const bar = new THREE.Mesh(
  new THREE.BoxGeometry(BAR_L, 0.05, 0.012),
  new THREE.MeshLambertMaterial({ color: 0x9a9aa0 }),
);
scene.add(aimPlane, bar);

// Направление на земле задаём азимутом: 0 — вдоль +x, против часовой стрелки при взгляде сверху.
// Так же считают углы RingGeometry после поворота на землю, поэтому сектор цели совпадает с азимутом.
const dirOf = (az) => new THREE.Vector3(Math.cos(az), 0, -Math.sin(az));
const azimuthOf = (v) => Math.atan2(-v.z, v.x);
const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const forwardOf = (yaw) => new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));

const player = { pos: new THREE.Vector3(0, 0, 4), yaw: 0, pitch: 0, bob: 0 };
const keys = new Set();
// free — ходим и смотрим; aim — пила приставлена, мышь крутит полотно; cut — пилим.
let mode = 'free';
let saw = null;
let round = null;

// Ствол выше зоны пиления — обычный цилиндр, сужается к вершине. Дерево кривое: верх наклонён
// от низа ствола, крона сидит набок. Цилиндр чуть заходит в кубики, чтобы на сгибе не было щели.
function growTree() {
  const length = TREE_H - ZONE_H;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(TRUNK_R * 0.6, TRUNK_R, length, 48), barkMat);
  trunk.position.y = length / 2;
  const crown = new THREE.Mesh(new THREE.ConeGeometry(2.2, 7, 12), crownMat);
  const leanAz = Math.random() * Math.PI * 2;
  const side = dirOf(leanAz + (Math.random() - 0.5) * 2).multiplyScalar(Math.random() * 0.8);
  crown.position.set(side.x, length - 2, side.z);
  const bend = new THREE.Group();
  bend.position.y = ZONE_H - 0.03;
  bend.add(trunk, crown);
  const lean = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0).cross(dirOf(leanAz)),
    THREE.MathUtils.degToRad(Math.random() * 5),
  );
  bend.quaternion.copy(lean);
  bend.updateMatrixWorld(true);
  // Центр тяжести: низ ствола посередине, у сужающегося ствола — ниже середины, крона — где нарисована.
  const com = new THREE.Vector3(0, ZONE_H / 2, 0).multiplyScalar(M_ZONE)
    .addScaledVector(bend.localToWorld(new THREE.Vector3(0, 0.42 * length, 0)), M_TRUNK)
    .addScaledVector(crown.getWorldPosition(new THREE.Vector3()), M_CROWN)
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

  // Валить приходится не строго по крену: цель — в пределах 75° от него.
  const targetAz = tree.leanAz + (Math.random() - 0.5) * THREE.MathUtils.degToRad(150);
  const target = new THREE.Mesh(
    new THREE.RingGeometry(1, TREE_H + 2, 32, 1, targetAz - TOLERANCE, TOLERANCE * 2),
    targetMat,
  );
  target.rotation.x = -Math.PI / 2;
  target.position.y = 0.02;

  const root = new THREE.Group();
  root.add(voxels.group, upper, target);
  scene.add(root);

  const mass = M_ZONE + M_TRUNK + M_CROWN;
  round = {
    root, voxels, upper, targetAz, ...tree,
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

// Пропил задан точкой входа на коре, поворотом по горизонтали и наклоном полотна.
// along — куда пила идёт вглубь, side — вдоль шины, normal — перпендикуляр к полотну.
function basis(cut) {
  const flat = forwardOf(cut.yaw);
  const side = new THREE.Vector3(-flat.z, 0, flat.x);
  const along = flat.multiplyScalar(Math.cos(cut.tilt)).setY(-Math.sin(cut.tilt));
  const normal = side.clone().cross(along);
  return { origin: cut.origin, along, side, normal };
}

// Насквозь по наклонному полотну дальше, чем по горизонтали.
const fullDepth = (cut) => (2 * TRUNK_R) / Math.cos(cut.tilt);

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
  origin.y = THREE.MathUtils.clamp(EYE + Math.tan(player.pitch) * bark, 0.05, MAX_ENTRY);
  const fresh = { origin, yaw: player.yaw, tilt: 0, depth: 0 };
  const freshNormal = basis(fresh).normal;
  return round.cuts.find((c) => {
    const { normal } = basis(c);
    return normal.dot(freshNormal) > SNAP_COS
      && forwardOf(c.yaw).dot(forward) > SNAP_COS
      && Math.abs(origin.clone().sub(c.origin).dot(normal)) < SNAP_DIST;
  }) ?? fresh;
}

function placeSaw(cut) {
  const b = basis(cut);
  const rotation = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(b.side, b.along, b.normal),
  );
  aimPlane.quaternion.copy(rotation);
  aimPlane.position.copy(b.origin).addScaledVector(b.along, TRUNK_R);
  bar.quaternion.copy(rotation);
  bar.position.copy(b.origin).addScaledVector(b.along, cut.depth);
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
  const b = basis(saw);
  round.gap = kerfWidth(sec, round.tilt, b.origin.clone().addScaledVector(b.along, saw.depth));
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
  const miss = Math.abs(THREE.MathUtils.radToDeg(angleDiff(azimuthOf(f), round.targetAz)));
  const deg = Math.round(miss);

  if (squashed) showResult('ПРИШИБЛО', 'Не стой на линии падения');
  else if (miss <= THREE.MathUtils.radToDeg(TOLERANCE)) showResult('ЗБС!', `Отклонение ${deg}°`);
  else showResult('ФУУ', `Мимо на ${deg}°`);
}

function showResult(title, note) {
  resultEl.innerHTML = `${title}<small>${note}</small><small>R — новое дерево</small>`;
  resultEl.hidden = false;
}

function update(dt) {
  const forward = forwardOf(player.yaw);
  const right = new THREE.Vector3(-forward.z, 0, forward.x);

  // Ходить можно, только пока пила не приставлена к стволу.
  const move = new THREE.Vector3();
  if (mode === 'free') {
    if (keys.has('KeyW')) move.add(forward);
    if (keys.has('KeyS')) move.sub(forward);
    if (keys.has('KeyD')) move.add(right);
    if (keys.has('KeyA')) move.sub(right);
  }
  const moving = move.lengthSq() > 0;
  if (moving) {
    const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 6 : 3;
    player.pos.addScaledVector(move.normalize(), speed * dt);
  }
  // Сквозь пень не пройти.
  const minDist = TRUNK_R + 0.35;
  const dist = Math.hypot(player.pos.x, player.pos.z);
  if (dist < minDist) player.pos.multiplyScalar(minDist / dist);

  const candidate = mode === 'free' && !round.top ? sawCandidate(forward) : null;

  if (mode === 'cut') {
    if (!round.cuts.includes(saw)) round.cuts.push(saw);
    saw.depth = Math.min(saw.depth + SAW_SPEED * dt, fullDepth(saw));
    round.voxels.carve(basis(saw), saw.depth, BAR_L);
    round.voxels.breakLoose().forEach(dropPiece);
    round.voxels.remesh();
  }
  if (!round.top) stand(dt);
  else if (round.slide) slideTop(dt);

  const shown = saw ?? candidate;
  aimPlane.visible = Boolean(shown) && mode !== 'cut';
  bar.visible = Boolean(shown);
  if (shown) placeSaw(shown);

  round.debris.forEach((piece) => fallPiece(piece, dt));

  if (round.fall && !round.done) fallTop(dt);

  hintEl.textContent = hint(candidate);
  depthEl.style.visibility = saw ? 'visible' : 'hidden';
  if (saw) depthFillEl.style.width = `${(saw.depth / fullDepth(saw)) * 100}%`;

  gapEl.hidden = round.gap === null || round.top;
  if (!gapEl.hidden) {
    const mm = round.gap;
    gapEl.textContent = `Щель ${mm.toFixed(0)} мм${mm < 9 ? ' — сужается' : mm > 11 ? ' — расширяется' : ''}`;
  }
  sideCamera.position.copy(right).multiplyScalar(16).setY(6.5);
  sideCamera.lookAt(0, 6.5, 0);

  let hx = 0, hy = 0;
  if (mode === 'cut') {
    hx = (Math.random() - 0.5) * 6;
    hy = (Math.random() - 0.5) * 6;
  } else if (moving) {
    player.bob += dt * 10;
    hx = Math.sin(player.bob) * 6;
    hy = Math.abs(Math.cos(player.bob)) * 8;
  }
  handsEl.style.transform = `translate(calc(-50% + ${hx}px), ${hy}px)`;

  camera.position.set(player.pos.x, EYE, player.pos.z);
  camera.rotation.set(player.pitch, player.yaw, 0);
}

function hint(candidate) {
  if (round.slide) return 'Съезжает! Отойди!';
  if (round.fall) return round.done ? '' : 'Падает! Беги!';
  if (mode === 'cut') return '';
  if (mode === 'aim') {
    if (saw.depth > 0) return 'ЛКМ — пилить дальше · S — убрать пилу';
    const tilt = Math.round(THREE.MathUtils.radToDeg(saw.tilt));
    return `Наклон ${tilt}° · мышь — наклон и поворот · ЛКМ — пилить · S — убрать пилу`;
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
  // S при приставленной пиле — шаг назад: пила убрана, ходить снова можно.
  if (e.code === 'KeyS' && mode !== 'free') {
    mode = 'free';
    saw = null;
  }
});
addEventListener('keyup', (e) => keys.delete(e.code));
startEl.addEventListener('click', () => {
  startEl.hidden = true;
  lockPointer();
});
canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (document.pointerLockElement !== canvas) lockPointer();
  if (mode === 'aim') mode = 'cut';
  else if (mode === 'free' && !round.top) {
    saw = sawCandidate(forwardOf(player.yaw));
    if (saw) mode = 'aim';
  }
});
addEventListener('mouseup', (e) => {
  if (e.button === 0 && mode === 'cut') mode = 'aim';
});
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement !== canvas && mode === 'cut') mode = 'aim';
});
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  if (mode === 'free') {
    player.yaw -= e.movementX * MOUSE;
    player.pitch = THREE.MathUtils.clamp(player.pitch - e.movementY * MOUSE, -1.5, 1.5);
  } else if (mode === 'aim' && saw.depth === 0) {
    // Пока пила не вошла в древесину, мышь крутит полотно: вбок — поворот, вверх-вниз — наклон.
    const turn = THREE.MathUtils.clamp(angleDiff(saw.yaw - e.movementX * MOUSE, player.yaw), -MAX_TURN, MAX_TURN);
    saw.yaw = player.yaw + turn;
    saw.tilt = THREE.MathUtils.clamp(saw.tilt + e.movementY * MOUSE, -MAX_TILT, MAX_TILT);
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
  renderer.render(scene, sideCamera);
  renderer.setScissorTest(false);
});
