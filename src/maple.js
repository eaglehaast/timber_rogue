import * as THREE from 'three';
import { barkMaterial, BARK_TILE } from './bark.js';
import { random } from './random.js';

// Клён ясенелистный (американский) — сорняк: растёт быстро и как попало. Ровно вверх почти никогда:
// ствол клонится к свету, потом выгибается обратно вверх, часто раздваивается. Ветви растут по всей
// высоте, больше — со светлой стороны, куда клонится ствол, и сами ветвятся. Вес дерева считается
// по объёму древесины, поэтому кривой ствол и кособокая крона уводят центр тяжести от пня.
export const DENSITY = 750; // кг/м³ — сырая древесина клёна
const leafMat = new THREE.MeshLambertMaterial({ color: 0x7fae47, flatShading: true });
const UP = new THREE.Vector3(0, 1, 0);

const rand = (a, b) => a + random() * (b - a);
const flat = (az) => new THREE.Vector3(Math.cos(az), 0, -Math.sin(az));

// Кора на ветвях и узлах в том же масштабе, что на стволе: координаты текстуры в метрах.
function barkMesh(geometry, around, along) {
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * around) / BARK_TILE, (uv.getY(i) * along) / BARK_TILE);
  return new THREE.Mesh(geometry, barkMaterial);
}

// leanAz — куда клонится ствол (азимут), r — радиус ствола внизу, length — высота от низа до вершины.
// base — сечение низа ствола (радиус по азимуту, см. trunkShape): ствол начинается с него и к первому изгибу круглеет.
// start — направление, в котором ствол выходит снизу.
// Возвращает модель, центр тяжести (в её координатах), массу и момент инерции вокруг вертикали через низ ствола
// (каждый кусок — точка в своём центре тяжести): так тяжело крону раскрутить.
export function growMaple(length, r, leanAz, base, start) {
  const tree = new THREE.Group();
  const com = new THREE.Vector3();
  let mass = 0, spin = 0;

  // Кусок ветви — сужающийся цилиндр от a до b, в месте излома — шар, чтобы не было щели.
  // shape — сечение у начала куска (радиус по азимуту), к концу кусок круглеет.
  // Узлы ствола помечены: по ним падающее дерево ложится на землю.
  function piece(a, b, r0, r1, shape, trunk) {
    const dir = b.clone().sub(a);
    const len = dir.length();
    const geometry = new THREE.CylinderGeometry(r1, r0, len, shape ? 48 : 10, shape ? 4 : 1);
    if (shape) {
      const v = geometry.attributes.position;
      for (let i = 0; i < v.count; i++) {
        const k = THREE.MathUtils.lerp(shape(Math.atan2(v.getZ(i), v.getX(i))) / r0, 1, v.getY(i) / len + 0.5);
        v.setXYZ(i, v.getX(i) * k, v.getY(i), v.getZ(i) * k);
      }
      geometry.computeVertexNormals();
    }
    const limb = barkMesh(geometry, Math.PI * (r0 + r1), len);
    limb.position.copy(a).addScaledVector(dir, 0.5);
    limb.quaternion.setFromUnitVectors(UP, dir.normalize());
    const knot = barkMesh(new THREE.SphereGeometry(r1, 10, 6), 2 * Math.PI * r1, Math.PI * r1);
    knot.position.copy(b);
    if (trunk) knot.name = 'trunk';
    tree.add(limb, knot);
    // Усечённый конус: объём и центр, сдвинутый к толстому концу.
    const m = DENSITY * (Math.PI / 3) * len * (r0 * r0 + r0 * r1 + r1 * r1);
    const t = (r0 * r0 + 2 * r0 * r1 + 3 * r1 * r1) / (4 * (r0 * r0 + r0 * r1 + r1 * r1));
    const at = a.clone().lerp(b, t);
    com.addScaledVector(at, m);
    mass += m;
    spin += m * (at.x * at.x + at.z * at.z);
  }

  // Листва — шапка на конце ветви. Веса почти не даёт, в счёт не идёт.
  function leaves(at, size) {
    const clump = new THREE.Mesh(new THREE.IcosahedronGeometry(size, 1), leafMat);
    clump.position.copy(at);
    clump.scale.y = 0.7;
    clump.rotation.set(rand(0, 3), rand(0, 3), 0);
    tree.add(clump);
  }

  // Ветвь (level 0 — ствол) растёт шагами: на каждом шаге чуть сворачивает вбок и тянется вверх.
  // Ствол ещё и уводит к свету: от пня всё сильнее клонится, потом этот увод слабеет.
  // split — на каком шаге ствол раздваивается (или -1), shape — сечение у основания.
  function grow(from, dir, r0, rTip, len, level, split = -1, shape = null) {
    const steps = level === 0 ? 8 : level === 1 ? 4 : 3;
    const wiggle = level === 0 ? 0.1 : 0.25;
    const rise = level === 0 ? rand(0.01, 0.04) : rand(0.02, 0.08);
    const sweep = level === 0 ? rand(0.02, 0.1) : 0;
    const p = from.clone();
    const d = dir.clone();
    let k = 1; // после развилки ствол тоньше
    for (let i = 0; i < steps; i++) {
      const ra = k * THREE.MathUtils.lerp(r0, rTip, i / steps);
      const rb = k * THREE.MathUtils.lerp(r0, rTip, (i + 1) / steps);
      d.add(new THREE.Vector3(rand(-1, 1), rand(-0.5, 0.5), rand(-1, 1)).multiplyScalar(wiggle))
        .addScaledVector(UP, rise).addScaledVector(flat(leanAz), sweep * (1 - i / steps)).normalize();
      const q = p.clone().addScaledVector(d, len / steps);
      piece(p, q, ra, rb, i === 0 ? shape : null, level === 0);
      p.copy(q);
      if (i === split) {
        // Сдвоенный ствол: второй лидер уходит в сторону и дальше растёт сам, первый становится тоньше.
        const side = new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1)).normalize();
        const other = d.clone().addScaledVector(side, rand(0.4, 0.7)).normalize();
        d.addScaledVector(side, -rand(0.15, 0.3)).normalize();
        grow(q, other, rb * 0.75, rTip, len * (1 - (i + 1) / steps) * rand(0.8, 1), 0);
        k = 0.8;
      }
      // Ветви: у ствола — с первого шага, больше со светлой стороны; у ветвей — веточки.
      if (level < 2 && i >= 1) {
        const count = level === 0 ? 1 + (random() < 0.5 ? 1 : 0) : random() < 0.6 ? 1 : 0;
        for (let n = 0; n < count; n++) {
          const az = level === 0 ? leanAz + rand(-1, 1) * rand(0.5, 2.2) : random() * Math.PI * 2;
          const el = rand(0.05, 0.6);
          const out = flat(az).multiplyScalar(Math.cos(el)).addScaledVector(UP, Math.sin(el)).lerp(d, 0.2).normalize();
          const reach = level === 0 ? rand(2.5, 5) * (1 - 0.5 * (i / steps)) : rand(0.8, 1.8);
          grow(q, out, rb * rand(0.3, 0.5), 0.02, reach, level + 1);
        }
      }
    }
    if (level > 0) leaves(p, level === 1 ? rand(0.4, 0.6) : rand(0.3, 0.5));
  }

  // Почти у половины деревьев ствол раздваивается.
  grow(new THREE.Vector3(), start, r, r * 0.25, length, 0, random() < 0.45 ? 1 + Math.floor(random() * 3) : -1, base);
  return { tree, com: com.divideScalar(mass), mass, spin };
}

// Поверхностные корни: лапа у земли уходит в сторону корнем — толстым, сужающимся, полузарытым.
// Корни клёна неглубокие, поэтому выходят наружу на полметра-метр, извиваясь, и ныряют в землю.
// Корень — одна гладкая трубка вдоль кривой, приплюснутая: в земле он раздаётся вширь.
// Они только для вида: пилят ствол выше, а вес и прочность корней в счёт не идут.
const ROOT_RINGS = 24;
export function growRoots(shape) {
  const roots = new THREE.Group();
  for (const lobe of shape.lobes) {
    const r0 = shape.radius * lobe.size * 0.45;
    const reach = rand(0.4, 1.1);
    let az = lobe.at;
    // Корень выходит из лапы там, где она опустилась до его толщины: верх корня продолжает склон лапы.
    const points = [flat(az).multiplyScalar(shape.outline(az, r0) - r0).setY(0)];
    for (let i = 1; i <= 3; i++) {
      az += rand(-0.2, 0.2);
      const p = points[i - 1].clone().add(flat(az).multiplyScalar(reach / 3));
      p.y = i === 3 ? -0.6 * r0 : -rand(0.1, 0.3) * r0; // в конце корень уходит под землю
      points.push(p);
    }
    const curve = new THREE.CatmullRomCurve3(points);
    const geometry = new THREE.TubeGeometry(curve, ROOT_RINGS, 1, 10, false);
    const v = geometry.attributes.position;
    const c = new THREE.Vector3(), o = new THREE.Vector3();
    for (let n = 0; n < v.count; n++) {
      const ring = Math.floor(n / 11);
      const u = ring / ROOT_RINGS;
      curve.getPointAt(u, c);
      o.fromBufferAttribute(v, n).sub(c).multiplyScalar(r0 * (1 - 0.7 * u));
      o.y *= 0.7;
      v.setXYZ(n, c.x + o.x, c.y + o.y, c.z + o.z);
    }
    geometry.computeVertexNormals();
    // У трубки u идёт вдоль, а у коры — по кругу: меняем местами, чтобы борозды шли вдоль корня.
    const uv = geometry.attributes.uv;
    for (let n = 0; n < uv.count; n++) uv.setXY(n, uv.getY(n), uv.getX(n));
    roots.add(barkMesh(geometry, Math.PI * r0 * 1.3, curve.getLength()));
  }
  return roots;
}
