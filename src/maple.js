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

// Поверхностные корни: каждая лапа у земли уходит в сторону корнем — толстым, сужающимся, полузарытым.
// Корни клёна неглубокие, поэтому выходят наружу на полметра-метр, извиваясь, и ныряют в землю.
// Они только для вида: пилят ствол выше, а вес и прочность корней в счёт не идут.
export function growRoots(shape) {
  const roots = new THREE.Group();
  for (const lobe of shape.lobes) {
    const r0 = shape.radius * lobe.size * 0.5;
    const reach = rand(0.4, 1.1);
    let az = lobe.at;
    const p = flat(az).multiplyScalar(shape.outline(az, 0) - r0).setY(-0.4 * r0);
    const steps = 3;
    for (let i = 0; i < steps; i++) {
      const ra = THREE.MathUtils.lerp(r0, 0.4 * r0, i / steps);
      const rb = THREE.MathUtils.lerp(r0, 0.4 * r0, (i + 1) / steps);
      az += rand(-0.25, 0.25);
      const q = p.clone().add(flat(az).multiplyScalar(reach / steps));
      q.y = -rb * (i + 1 === steps ? 1.2 : rand(0.3, 0.6)); // в конце корень уходит под землю
      const dir = q.clone().sub(p);
      const len = dir.length();
      const limb = barkMesh(new THREE.CylinderGeometry(rb, ra, len, 10, 1), Math.PI * (ra + rb), len);
      limb.position.copy(p).addScaledVector(dir, 0.5);
      limb.quaternion.setFromUnitVectors(UP, dir.normalize());
      const knot = barkMesh(new THREE.SphereGeometry(rb, 10, 6), 2 * Math.PI * rb, Math.PI * rb);
      knot.position.copy(q);
      roots.add(limb, knot);
      p.copy(q);
    }
  }
  return roots;
}
