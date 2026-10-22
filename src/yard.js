import * as THREE from 'three';

// Участок вокруг дерева: постройки и коммуникации. Для игры каждая — прямоугольник на земле
// (по нему считается, задел ли его ствол, и через него не пройти) и простая модель-заглушка.
// Длинные вещи — забор, провода, труба — ставим поперёк линий падения: так они чаще мешают.
const KINDS = [
  { name: 'house', w: 6, d: 8, h: 3, color: 0xc9b38a, max: 1, verdict: 'Дерево проломило крышу дома. Хозяева будут не в восторге.' },
  { name: 'shed', w: 2.5, d: 3, h: 2.2, color: 0x7d6a55, max: 2, verdict: 'Сарай всмятку. Да и чёрт с ним — его давно пора было снести.' },
  { name: 'greenhouse', w: 3, d: 5, h: 2.2, color: 0xcfe8ff, max: 1, verdict: 'Теплица — в стекло. Прощайте, помидоры.' },
  { name: 'fence', w: 9, d: 0.12, h: 1.4, color: 0x9b7b4f, max: 2, across: true, verdict: 'Забор повален. Соседи придут поговорить.' },
  { name: 'power', w: 14, d: 0.3, h: 7, color: 0x4a4a4a, max: 1, across: true, verdict: 'Дерево легло на провода. Деревня обесточена.' },
  { name: 'pipe', w: 12, d: 0.3, h: 0.7, color: 0xe2c044, max: 1, across: true, verdict: 'Дерево упало на газовую трубу — погнулась. Скажешь, что так и было.' },
];
const COUNT = 6;
const NEAR = 4.5;  // ближе к стволу ничего не ставим: там работает лесоруб
const FAR = 14;
const TRUNK_HIT = 0.35;  // полутолщина лежащего ствола
const CROWN_HIT = 2;     // радиус кроны
const CROWN_AT = 3.5;    // центр кроны от вершины

const box = (w, h, d, material, x = 0, y = h / 2, z = 0) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  return mesh;
};

function model(kind) {
  const group = new THREE.Group();
  const material = new THREE.MeshLambertMaterial({
    color: kind.color, transparent: kind.name === 'greenhouse', opacity: 0.45,
  });
  const { w, d, h } = kind;
  if (kind.name === 'house') {
    group.add(box(w, h, d, material));
    // Крыша — четырёхгранная пирамида, растянутая по дому.
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1, 2, 4), new THREE.MeshLambertMaterial({ color: 0x8a3b2b }));
    roof.rotation.y = Math.PI / 4;
    roof.scale.set(w / Math.SQRT2, 1, d / Math.SQRT2);
    roof.position.y = h + 1;
    group.add(roof);
  } else if (kind.name === 'fence') {
    group.add(box(w, 0.1, d, material, 0, 0.5), box(w, 0.1, d, material, 0, 1.1));
    for (let x = -w / 2; x <= w / 2; x += 1.5) group.add(box(0.12, h, 0.12, material, x));
  } else if (kind.name === 'power') {
    group.add(box(0.25, h + 1, 0.25, material, -w / 2), box(0.25, h + 1, 0.25, material, w / 2));
    group.wire = box(w, 0.04, 0.04, new THREE.MeshBasicMaterial({ color: 0x111111 }), 0, h);
    group.add(group.wire);
  } else if (kind.name === 'pipe') {
    group.add(box(w, 0.3, 0.3, material, 0, 0.55));
    group.add(box(0.15, 0.4, 0.15, material, -w / 2 + 0.5, 0.2), box(0.15, 0.4, 0.15, material, w / 2 - 0.5, 0.2));
  } else {
    group.add(box(w, h, d, material));
  }
  return group;
}

// Вектор от прямоугольника до точки (0, если внутри) — в координатах участка.
function offset(o, x, z) {
  const c = Math.cos(o.yaw), s = Math.sin(o.yaw);
  const dx = x - o.x, dz = z - o.z;
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  const ox = lx - THREE.MathUtils.clamp(lx, -o.w / 2, o.w / 2);
  const oz = lz - THREE.MathUtils.clamp(lz, -o.d / 2, o.d / 2);
  return { x: ox * c + oz * s, z: -ox * s + oz * c };
}

const distance = (o, x, z) => Math.hypot(...Object.values(offset(o, x, z)));

function corners(o) {
  const c = Math.cos(o.yaw), s = Math.sin(o.yaw);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => {
    const lx = (a * o.w) / 2, lz = (b * o.d) / 2;
    return { x: o.x + lx * c + lz * s, z: o.z - lx * s + lz * c };
  });
}

// Прямоугольники пересекаются, если нет оси (стороны одного из них), на которой их тени расходятся.
function overlap(a, b, gap) {
  const ca = corners(a), cb = corners(b);
  for (const o of [a, b]) {
    for (const yaw of [o.yaw, o.yaw + Math.PI / 2]) {
      const ax = Math.cos(yaw), az = -Math.sin(yaw);
      const pa = ca.map((p) => p.x * ax + p.z * az), pb = cb.map((p) => p.x * ax + p.z * az);
      if (Math.max(...pa) + gap < Math.min(...pb) || Math.max(...pb) + gap < Math.min(...pa)) return false;
    }
  }
  return true;
}

// Что заденет дерево, если ляжет из точки from в сторону u: ствол — цепочка точек, крона — круг.
export function struck(objects, from, u, length) {
  return objects.filter((o) => {
    for (let t = 0; t <= length; t += 0.25) {
      if (distance(o, from.x + u.x * t, from.z + u.z * t) < TRUNK_HIT) return true;
    }
    const crown = length - CROWN_AT;
    return distance(o, from.x + u.x * crown, from.z + u.z * crown) < CROWN_HIT;
  });
}

// Случайный участок. Хоть одна сторона, куда дерево можно уронить чисто, должна быть
// в пределах reach от направления, куда его тянет вес, — иначе раунд не пройти.
export function makeYard(lean, reach, length) {
  for (;;) {
    const objects = [];
    for (let tries = 0; objects.length < COUNT && tries < 200; tries++) {
      const kind = KINDS[Math.floor(Math.random() * KINDS.length)];
      if (objects.filter((o) => o.kind === kind).length >= kind.max) continue;
      const az = Math.random() * Math.PI * 2;
      const r = NEAR + Math.random() * (FAR - NEAR);
      const o = {
        kind, w: kind.w, d: kind.d,
        x: r * Math.cos(az), z: -r * Math.sin(az),
        yaw: kind.across ? az + Math.PI / 2 + (Math.random() - 0.5) * 0.6 : Math.random() * Math.PI,
      };
      if (distance(o, 0, 0) < NEAR || objects.some((other) => overlap(o, other, 1))) continue;
      objects.push(o);
    }
    for (let i = -18; i <= 18; i++) {
      const az = lean + (i / 18) * reach;
      if (!struck(objects, { x: 0, z: 0 }, new THREE.Vector3(Math.cos(az), 0, -Math.sin(az)), length).length) {
        return objects;
      }
    }
  }
}

export function buildYard(objects, root) {
  for (const o of objects) {
    o.mesh = model(o.kind);
    o.mesh.position.set(o.x, 0, o.z);
    o.mesh.rotation.y = o.yaw;
    root.add(o.mesh);
  }
}

// Задетое сминается, у столба рвутся провода.
export function wreck(o) {
  if (o.mesh.wire) o.mesh.wire.visible = false;
  else o.mesh.scale.y = 0.35;
}

// Сквозь постройки не пройти: точку у стены отталкиваем наружу. Внутрь она не попадает —
// игрок появляется у ствола, а постройки стоят дальше.
export function pushOut(objects, pos, radius) {
  for (const o of objects) {
    const off = offset(o, pos.x, pos.z);
    const dist = Math.hypot(off.x, off.z);
    if (dist >= radius || dist === 0) continue;
    pos.x += (off.x / dist) * (radius - dist);
    pos.z += (off.z / dist) * (radius - dist);
  }
}
