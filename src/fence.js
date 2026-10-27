import * as THREE from 'three';

// Забор по периметру участка W × D метров с центром в начале координат. Стороны разные, как в деревне:
// к дороге (z = +D/2) — штакетник с калиткой, к полям (z = −D/2) — жерди на кольях, к соседям — рабица.
// Каждая доска и жердь — своя геометрия: щели сквозные, сквозь них видно улицу, а солнце кладёт полосы на траву.
// Пока всё одноцветное — проверяем пропорции; текстуры досок придут от ChatGPT.
export const YARD = { w: 60, d: 40 };

const wood = new THREE.MeshLambertMaterial({ color: 0xb3a58f });
const metal = new THREE.MeshLambertMaterial({ color: 0x8a8d8f });
const between = (a, b) => a + Math.random() * (b - a);

// Все детали одного материала — один InstancedMesh из единичного бруска или цилиндра.
function parts(geometry, material, list) {
  const mesh = new THREE.InstancedMesh(geometry, material, list.length);
  list.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}
const cube = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
const rod = new THREE.CylinderGeometry(0.5, 0.5, 1, 8).translate(0, 0.5, 0);
// Деталь: основание в (x, y, z), размеры по своим осям, повороты — рысканье yaw, наклоны tilt вбок и lean вперёд.
const at = (x, y, z, sx, sy, sz, yaw = 0, tilt = 0, lean = 0) => new THREE.Matrix4().compose(
  new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(lean, yaw, tilt, 'YXZ')), new THREE.Vector3(sx, sy, sz));

// Сторона забора — отрезок от a до b по земле; вдоль него ставим детали в локальной координате s.
function side(a, b) {
  const dir = new THREE.Vector2(b.x - a.x, b.z - a.z), length = dir.length();
  dir.normalize();
  const yaw = Math.atan2(-dir.y, dir.x);
  const point = (s, off = 0) => ({ x: a.x + dir.x * s - dir.y * off, z: a.z + dir.y * s + dir.x * off });
  return { length, yaw, point };
}

// Штакетник: столбы через 2,5 м, две прожилины, доски 9–14 см с щелями 2–8 см, неровные по высоте и наклону.
// Изредка доски нет. Калитка — проём с толстыми столбами и своими досками на раме с укосиной.
function picket(edge, gate, boards, beams, posts) {
  const { length, yaw, point } = edge;
  for (let s = 0; s <= length + 0.01; s += 2.5) {
    const p = point(s);
    posts.push(at(p.x, 0, p.z, 0.12, 1.6, 0.12));
  }
  for (const y of [0.35, 1.1]) {
    const p = point(length / 2, 0.06);
    beams.push(at(p.x, y, p.z, length, 0.08, 0.05, yaw));
  }
  for (let s = 0.05; s < length - 0.05;) {
    const w = between(0.09, 0.14);
    const inGate = Math.abs(s + w / 2 - gate) < 0.55;
    if (Math.random() > 0.03) {
      const p = point(s + w / 2, 0.1);
      const h = inGate ? between(1.25, 1.3) : between(1.35, 1.5);
      boards.push(at(p.x, inGate ? 0.12 : 0.05, p.z, w, h, 0.022, yaw, between(-0.025, 0.025)));
    }
    s += w + between(0.02, 0.08);
  }
  for (const s of [gate - 0.6, gate + 0.6]) {
    const p = point(s);
    posts.push(at(p.x, 0, p.z, 0.16, 1.75, 0.16));
  }
  const brace = point(gate, 0.07);
  beams.push(at(brace.x, 0.32, brace.z, 0.05, 1.15, 0.08, yaw, -0.72));
}

// Жердевой: колья через 2,5–3 м, наклонённые как придётся, на них три жерди, концы заходят друг за друга.
function rails(edge, poles, stakes) {
  const { length, yaw, point } = edge;
  const marks = [0];
  while (marks.at(-1) < length - 3) marks.push(marks.at(-1) + between(2.5, 3));
  marks.push(length);
  for (const s of marks) {
    const p = point(s);
    stakes.push(at(p.x, 0, p.z, 0.1, between(1.2, 1.35), 0.1, 0, between(-0.06, 0.06), between(-0.06, 0.06)));
  }
  for (let i = 1; i < marks.length; i++) {
    // Цилиндр, положенный набок, растёт от основания назад по стороне: основание ставим на дальний конец.
    const s0 = marks[i - 1] - 0.15, s1 = marks[i] + 0.15, end = point(s1, 0.08);
    for (const y of [0.4, 0.78, 1.12]) {
      const drop = between(-0.05, 0.05), r = between(0.07, 0.1);
      poles.push(at(end.x, y + drop, end.z, r, s1 - s0, r, yaw, Math.PI / 2 + between(-0.03, 0.03)));
    }
  }
}

// Рабица: трубы через 2,5 м и сетка ромбами на всю сторону. Сетка пока рисуется кодом — до картинки от ChatGPT.
const mesh = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.strokeStyle = '#fff';
  g.lineWidth = 5;
  for (const [x0, x1] of [[0, 64], [64, 0]]) {
    for (const shift of [-64, 0, 64]) { g.beginPath(); g.moveTo(x0 + shift, 0); g.lineTo(x1 + shift, 64); g.stroke(); }
  }
  const texture = new THREE.CanvasTexture(c);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
})();
const CELL = 0.06; // м: ромб сетки

function chain(edge, root, pipes) {
  const { length, yaw, point } = edge;
  for (let s = 0; s <= length + 0.01; s += 2.5) {
    const p = point(s);
    pipes.push(at(p.x, 0, p.z, 0.06, 1.6, 0.06));
  }
  const map = mesh.clone();
  map.needsUpdate = true; // копия текстуры — своя загрузка в видеокарту
  map.repeat.set(length / CELL, 1.5 / CELL);
  const net = new THREE.Mesh(new THREE.PlaneGeometry(length, 1.5),
    // Проволока тоньше точки уже в паре метров: срез по прозрачности оставил бы от неё одни узлы.
    // Поэтому сетка полупрозрачная — вдали она сливается в лёгкую серую вуаль, как в жизни.
    new THREE.MeshLambertMaterial({ color: 0x9a9c9e, map, alphaMap: map, transparent: true, depthWrite: false, alphaTest: 0.02, side: THREE.DoubleSide }));
  const mid = point(length / 2, 0.04);
  net.position.set(mid.x, 0.1 + 0.75, mid.z);
  net.rotation.y = yaw;
  net.castShadow = net.receiveShadow = true;
  root.add(net);
}

export function makeFence() {
  const root = new THREE.Group();
  const x = YARD.w / 2, z = YARD.d / 2;
  const boards = [], beams = [], posts = [], poles = [], stakes = [], pipes = [];
  picket(side({ x: -x, z }, { x, z }), x + 8, boards, beams, posts);
  rails(side({ x, z: -z }, { x: -x, z: -z }), poles, stakes);
  chain(side({ x: -x, z: -z }, { x: -x, z }), root, pipes);
  chain(side({ x, z }, { x, z: -z }), root, pipes);
  root.add(parts(cube, wood, [...boards, ...beams, ...posts]), parts(rod, wood, [...poles, ...stakes]), parts(rod, metal, pipes));
  return root;
}
