import * as THREE from 'three';
import { pillow, pixelsOf } from './pillow.js';

// Руки в перчатках и рукава рубашки (картинки Никиты, tools/hands.py). Перчатка — «подушка» по силуэту тыла,
// как корпус пилы (pillow.js); пальцы гнутся на костях. Левая — зеркало правой. Рукав — труба от плеча
// до запястья поверх перчатки: рубашка оверсайз, рукав толщиной с нарисованный, а когда рука тянется дальше,
// чем достаёт, он растягивается в длину, а не худеет.
// Оси кисти: x — от большого пальца к мизинцу, y — к кончикам пальцев, z — тыл кисти; начало — середина запястья.

const PATH = 'assets/textures/';
const { glove: GLOVE, sleeve: SLEEVE } = await (await fetch(`${PATH}hands.json`)).json();
const shape = await new THREE.ImageLoader().loadAsync(`${PATH}glove-shape.png`);
const loader = new THREE.TextureLoader();
const picture = (file) => {
  const map = loader.load(PATH + file);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  return map;
};
const UP = new THREE.Vector3(0, 1, 0), X = new THREE.Vector3(1, 0, 0), Y = UP, Z = new THREE.Vector3(0, 0, 1);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
const ease = (dt, rate) => 1 - Math.exp(-rate * dt);

const { m: M, cell: CELL, wrist: [WX, WY] } = GLOVE;
const handX = (px) => (px - WX) * M, handY = (py) => (WY - py) * M;
// Пальцы и их суставы в осях кисти: у большого — запястно-пястный, пястно-фаланговый, межфаланговый и кончик,
// у остальных — пястно-фаланговый, два межфаланговых и кончик.
const DIGITS = ['thumb', 'index', 'middle', 'ring', 'pinky'];
const JOINTS = Object.fromEntries(DIGITS.map((name) => [name, GLOVE.joints[name].map(([px, py]) => new THREE.Vector3(handX(px), handY(py), 0))]));
// Полутолщина перчатки по высоте вида тыла: у пальцев и у ладони под пястными суставами (м).
function halfAt(py) {
  const [ys, hs] = GLOVE.half, k = ys.findIndex((y) => y > py);
  return k < 0 ? hs.at(-1) : k === 0 ? hs[0] : THREE.MathUtils.mapLinear(py, ys[k - 1], ys[k], hs[k - 1], hs[k]);
}
const FINGER = halfAt(GLOVE.joints.middle[1][1]), PALM = halfAt(GLOVE.joints.middle[0][1] + 40);

// Кости перчатки: 0 — кисть, дальше по три на палец в порядке DIGITS (у большого — пястная, основная и ногтевая,
// у остальных — три фаланги). Вершина гнётся с костями своего пальца: вдоль него до первого сустава — с кистью,
// за суставом — с фалангой; у сустава вес переходит плавно, на BEND пикселей в обе стороны. Чей палец — решает
// путь по самой перчатке, а не прямая: между пальцами прорези, и край безымянного далеко от среднего, хотя
// по прямой рядом. На ладони меж пальцев вес делится плавно, на SHARE пикселей пути.
const BEND = { thumb: [45, 20, 12], finger: [28, 14, 11] };
const SHARE = 12;
const STEPS = [[1, 0, 5], [-1, 0, 5], [0, 1, 5], [0, -1, 5], [1, 1, 7], [1, -1, 7], [-1, 1, 7], [-1, -1, 7]];

// Ближайшая к пикселю (px, py) точка ломаной line: как далеко она и сколько до неё вдоль ломаной от начала.
function nearest(line, px, py) {
  let best = { d: Infinity, s: 0 }, s = 0;
  for (let k = 1; k < line.length; k++) {
    const [ax, ay] = line[k - 1], [bx, by] = line[k], len = Math.hypot(bx - ax, by - ay);
    const t = THREE.MathUtils.clamp(((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / (len * len), 0, 1);
    const d = Math.hypot(ax + t * (bx - ax) - px, ay + t * (by - ay) - py);
    if (d < best.d) best = { d, s: s + t * len };
    s += len;
  }
  return best;
}

function skin(geometry) {
  const cols = shape.width, rows = shape.height, pixels = pixelsOf(shape);
  const inside = (i, j) => i >= 0 && j >= 0 && i < cols && j < rows && pixels[4 * (j * cols + i) + 1] > 128;
  const lines = DIGITS.map((name) => [GLOVE.wrist, ...GLOVE.joints[name]]);
  // Путь по перчатке от оси пальца до каждой клетки — шагами по соседним клеткам (5 — вбок, 7 — наискось).
  const paths = lines.map((line) => {
    const far = new Float32Array(cols * rows).fill(Infinity), queue = [];
    const put = (k, d) => {
      if (d < far[k]) {
        far[k] = d;
        (queue[d] ??= []).push(k);
      }
    };
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const { d } = nearest(line, (i + 0.5) * CELL, (j + 0.5) * CELL);
        if (inside(i, j) && d < 1.5 * CELL) put(j * cols + i, Math.round((5 * d) / CELL));
      }
    }
    for (let d = 0; d < queue.length; d++) {
      for (const k of queue[d] ?? []) {
        if (far[k] !== d) continue;
        const i = k % cols, j = (k - i) / cols;
        for (const [di, dj, step] of STEPS) if (inside(i + di, j + dj)) put(k + dj * cols + di, d + step);
      }
    }
    return far.map((d) => (d * CELL) / 5);
  });
  const stops = lines.map((line) => line.map((p, k) => line.slice(1, k + 1).reduce((s, q, n) => s + Math.hypot(q[0] - line[n][0], q[1] - line[n][1]), 0)));
  const position = geometry.getAttribute('position'), count = position.count;
  const index = new Uint16Array(4 * count), weight = new Float32Array(4 * count);
  for (let v = 0; v < count; v++) {
    const px = position.getX(v) / M + WX, py = WY - position.getY(v) / M;
    // Клетка вершины — ближайшая внутри силуэта: вершины края лежат между клетками.
    let cell = -1, best = Infinity;
    const ci = px / CELL - 0.5, cj = py / CELL - 0.5;
    for (let j = Math.floor(cj) - 1; j <= Math.floor(cj) + 2; j++) {
      for (let i = Math.floor(ci) - 1; i <= Math.floor(ci) + 2; i++) {
        const d = (i - ci) ** 2 + (j - cj) ** 2;
        if (inside(i, j) && d < best) [best, cell] = [d, j * cols + i];
      }
    }
    const far = paths.map((p) => p[cell]), near = Math.min(...far);
    const share = far.map((d) => Math.exp((near - d) / SHARE)), sum = share.reduce((a, b) => a + b);
    const bones = new Map();
    lines.forEach((line, c) => {
      const a = share[c] / sum;
      if (a < 1e-3) return;
      const { s } = nearest(line, px, py);
      const [t0, t1, t2] = BEND[c ? 'finger' : 'thumb'].map((h, k) => THREE.MathUtils.smoothstep(s, stops[c][k + 1] - h, stops[c][k + 1] + h));
      [[0, 1 - t0], [1 + 3 * c, t0 * (1 - t1)], [2 + 3 * c, t0 * t1 * (1 - t2)], [3 + 3 * c, t0 * t1 * t2]]
        .forEach(([bone, w]) => bones.set(bone, (bones.get(bone) ?? 0) + a * w));
    });
    const top = [...bones].sort((p, q) => q[1] - p[1]).slice(0, 4), total = top.reduce((s, [, w]) => s + w, 0);
    top.forEach(([bone, w], k) => {
      index[4 * v + k] = bone;
      weight[4 * v + k] = w / total;
    });
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(index, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weight, 4));
}

// Толщина перчатки: у края скруглена радиусом GLOVE.radius, дальше — полутолщина halfAt. Считаем её по расстоянию
// до края d (пикселей), а не берём из карты: там полмиллиметра на ступеньку, и на тыле кисти видны полосы.
function bulge(px, py, d) {
  const h = halfAt(py), t = THREE.MathUtils.clamp((d * M) / Math.min(h, GLOVE.radius), 0, 1), z = h * Math.sqrt(1 - (1 - t) ** 2);
  return [z, -z];
}
const GEOMETRY = pillow(shape, CELL, GLOVE.size, handX, handY, bulge).geometry;
skin(GEOMETRY);
const LEATHER = ['glove-front.webp', 'glove-back.webp'].map((file) => new THREE.MeshStandardMaterial({ map: picture(file), roughness: 0.8 }));

// Ось сгиба пальца — поперёк него в плоскости ладони (z × вдоль пальца): поворот на +угол гнёт его к ладони.
// Большой палец в пястном суставе ещё приводится к указательному (вокруг z) и разворачивается подушечкой
// к пальцам (вокруг своей оси); его основная и ногтевая фаланги гнутся вокруг его же оси сгиба.
const across = (from, to) => {
  const d = to.clone().sub(from).normalize();
  return new THREE.Vector3(-d.y, d.x, 0);
};
const FLEX = Object.fromEntries(DIGITS.map((name) => [name, across(JOINTS[name][0], JOINTS[name][name === 'thumb' ? 1 : 3])]));
const THUMB = JOINTS.thumb[1].clone().sub(JOINTS.thumb[0]).normalize();
// Сгибы суставов (рад). Большой: к указательному, к ладони, разворот, основная, ногтевая фаланги.
const LOOSE = { thumb: [0.15, 0.35, 0.5, 0.25, 0.25], index: [0.3, 0.45, 0.25], middle: [0.35, 0.5, 0.3], ring: [0.4, 0.55, 0.3], pinky: [0.45, 0.6, 0.35] };
const CLASP = [0.35, 1.25, 0.8, 0.8, 0.8]; // большой палец обхватывает рукоять навстречу остальным
const LIMIT = [1.6, 1.9, 1.4];           // дальше суставы пальцев не гнутся

// Пальцы обхватывают рукоять: каждая фаланга по очереди гнётся, пока её конец не ляжет на рукоять. Рукоять —
// круг радиусом r поперёк ладони: её ось на высоте y кисти и на depth под серединой ладони. Ось пальца
// не подходит к оси рукояти ближе r + FINGER — палец лежит на ней подушечками.
function wrap(name, r, y, depth) {
  const j = JOINTS[name], dir = j[3].clone().sub(j[0]).normalize();
  // Плоскость сгиба: x — вдоль пальца, y — к ладони.
  const c = new THREE.Vector2((y - j[0].y) / dir.y, depth), p = new THREE.Vector2(), rho = r + FINGER;
  const end = (a, l) => p.clone().add(new THREE.Vector2(Math.cos(a), Math.sin(a)).multiplyScalar(l));
  let heading = 0;
  return [0, 1, 2].map((k) => {
    const l = j[k + 1].distanceTo(j[k]), q = p.clone().sub(c), dq = q.length();
    // Конец фаланги на рукояти: |q + l·e| = rho, то есть q·e = K.
    const K = (rho * rho - dq * dq - l * l) / (2 * l);
    let turn = 0;
    if (end(heading, l).distanceTo(c) > rho) {
      if (K < -dq) turn = Math.atan2(c.y - p.y, c.x - p.x) - heading; // не дотянуться — к рукояти, сколько можно
      else {
        const beta = Math.atan2(q.y, q.x), spread = Math.acos(Math.min(1, K / dq));
        turn = Math.min(...[beta - spread, beta + spread].map((a) => THREE.MathUtils.euclideanModulo(a - heading, 2 * Math.PI)));
      }
    }
    turn = THREE.MathUtils.clamp(turn, 0, LIMIT[k]);
    heading += turn;
    p.copy(end(heading, l));
    return turn;
  });
}

// Перчатка: кисть с костями пальцев. Куда её ставить, задаёт aim, как согнуть пальцы — goal; к тому и другому
// она приходит плавно: сменив хватку (kind), кисть за LAG секунд переезжает со старого места, а дальше держит
// новое жёстко — рука не отстаёт от пилы.
const LAG = 0.15;
class Glove {
  constructor(left) {
    this.left = left;
    const root = new THREE.Bone(), bones = [root];
    for (const name of DIGITS) {
      let parent = root, from = new THREE.Vector3();
      for (const joint of JOINTS[name].slice(0, 3)) {
        const bone = new THREE.Bone();
        bone.position.subVectors(joint, from);
        parent.add(bone);
        bones.push(bone);
        [parent, from] = [bone, joint];
      }
    }
    this.bones = bones;
    this.mesh = new THREE.SkinnedMesh(GEOMETRY, LEATHER);
    this.mesh.add(root);
    this.mesh.bind(new THREE.Skeleton(bones));
    this.mesh.frustumCulled = false;
    if (left) this.mesh.scale.x = -1;
    this.object = new THREE.Group().add(this.mesh);
    this.curl = structuredClone(LOOSE);
    this.goal = LOOSE;
    this.target = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
    this.kind = '';
    this.lag = new THREE.Vector3();
    this.twist = new THREE.Quaternion();
  }

  // Встать так, чтобы ось кисти x шла по across (от большого пальца к мизинцу), тыл смотрел к back,
  // а точка local (в осях правой кисти) пришлась на at.
  aim(kind, across, back, local, at) {
    const x = across.clone().normalize(), z = back.clone().addScaledVector(x, -back.dot(x)).normalize();
    const y = this.left ? x.clone().cross(z) : z.clone().cross(x);
    const q = this.target.quaternion.setFromRotationMatrix(_m.makeBasis(this.left ? x.negate() : x, y, z));
    const p = local.clone();
    if (this.left) p.x = -p.x;
    this.target.position.copy(at).sub(p.applyQuaternion(q));
    if (kind !== this.kind && this.kind) {
      this.lag.subVectors(this.object.position, this.target.position);
      this.twist.copy(this.object.quaternion).multiply(_q.copy(q).invert());
    }
    this.kind = kind;
  }

  follow(dt) {
    const k = Math.exp(-dt / LAG);
    this.lag.multiplyScalar(k);
    this.twist.slerp(_q.identity(), 1 - k);
    this.object.position.copy(this.target.position).add(this.lag);
    this.object.quaternion.copy(this.target.quaternion).premultiply(this.twist);
    const e = ease(dt, 14);
    for (const name of DIGITS) this.curl[name] = this.curl[name].map((a, k) => a + (this.goal[name][k] - a) * e);
    DIGITS.forEach((name, d) => {
      const [b0, b1, b2] = this.bones.slice(1 + 3 * d, 4 + 3 * d), c = this.curl[name];
      if (name === 'thumb') {
        b0.quaternion.setFromAxisAngle(Z, c[0]).multiply(_q.setFromAxisAngle(FLEX.thumb, c[1])).multiply(_q.setFromAxisAngle(THUMB, c[2]));
        b1.quaternion.setFromAxisAngle(FLEX.thumb, c[3]);
        b2.quaternion.setFromAxisAngle(FLEX.thumb, c[4]);
      } else [b0, b1, b2].forEach((bone, k) => bone.quaternion.setFromAxisAngle(FLEX[name], c[k]));
    });
  }

  // Обхватить рукоять радиусом r, ось которой идёт по across через at: над at — пястный сустав пальца finger,
  // а рукоять лежит в ладони чуть ниже пястных суставов. Пальцам с отступом gaps рукоять кажется толще:
  // указательный лежит на курке.
  clasp(kind, at, across, back, r, finger, gaps = {}) {
    const y = JOINTS[finger][0].y - 0.008, depth = r + PALM;
    this.aim(kind, across, back, new THREE.Vector3(JOINTS[finger][0].x, y, -depth), at);
    this.goal = { thumb: CLASP };
    for (const name of DIGITS.slice(1)) this.goal[name] = wrap(name, r + (gaps[name] ?? 0), y, depth);
  }
}

// Рукав — труба по руке: плечо — локоть — запястье. Локоть скруглён, к запястью труба подходит по оси кисти,
// а манжета — эллипс поперёк кисти (CUFF), как раз охватывает обшлаг перчатки. Толщина по длине — как
// на картинке (SLEEVE.profile, в долях манжеты); манжета всегда CUFF_L длиной, растягивается остальной рукав.
// Развёртка картинки: u — угол от тыла кисти (середина картинки, вид с планкой) через сторону мизинца,
// v — от плеча к манжете.
const RINGS = 36, SIDES = 28;
const CUFF = [0.062, 0.042], CUFF_L = 0.07, ELBOW = 0.07;
const ROUND = Math.sqrt(CUFF[0] * CUFF[1]), FLAT = Math.sqrt(CUFF[0] / CUFF[1]);
const CLOTH = new THREE.MeshStandardMaterial({ map: picture('sleeve.webp'), roughness: 0.95, side: THREE.DoubleSide });
const V = Array.from({ length: RINGS }, (_, i) => i / (RINGS - 1));
const widthAt = (v) => {
  const p = SLEEVE.profile, at = v * (p.length - 1), k = Math.min(Math.floor(at), p.length - 2);
  return p[k] + (p[k + 1] - p[k]) * (at - k);
};
class Sleeve {
  constructor(left) {
    this.left = left;
    const uv = [], index = [];
    V.forEach((v, i) => {
      for (let j = 0; j <= SIDES; j++) {
        uv.push(j / SIDES, 1 - v);
        if (!i || !j) continue;
        const a = (i - 1) * (SIDES + 1) + j - 1, b = a + 1, c = a + SIDES + 1, d = c + 1;
        // Лицо треугольников — снаружи трубы; у левой руки обход по кругу зеркальный.
        index.push(...(left ? [a, b, c, b, d, c] : [a, c, b, c, d, b]));
      }
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(3 * uv.length / 2), 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(3 * uv.length / 2), 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geometry.setIndex(index);
    this.mesh = new THREE.Mesh(geometry, CLOTH);
    this.mesh.frustumCulled = false;
  }

  // Ось рукава — ломаная мелкими шагами: от плеча к локтю, скругление локтя, к запястью — подходя по оси кисти along.
  update(shoulder, elbow, wrist, along, across, back) {
    const upper = elbow.clone().sub(shoulder), fore = wrist.clone().sub(elbow);
    const f = Math.min(ELBOW, 0.4 * upper.length(), 0.4 * fore.length());
    const e1 = elbow.clone().addScaledVector(upper.normalize(), -f), e2 = elbow.clone().addScaledVector(fore.normalize(), f);
    const reach = wrist.distanceTo(e2) / 3;
    const bend = new THREE.QuadraticBezierCurve3(e1, elbow, e2);
    const arm = new THREE.CubicBezierCurve3(e2, e2.clone().addScaledVector(fore, reach), wrist.clone().addScaledVector(along, -reach), wrist);
    const path = [
      ...Array.from({ length: 8 }, (_, k) => shoulder.clone().lerp(e1, k / 8)),
      ...bend.getPoints(8).slice(0, -1),
      ...arm.getPoints(20),
    ];
    const lengths = path.map((p, k) => (k ? p.distanceTo(path[k - 1]) : 0));
    for (let k = 1; k < lengths.length; k++) lengths[k] += lengths[k - 1];
    const total = lengths.at(-1), cuff = Math.min(CUFF_L, total / 3), body = total - cuff;
    const position = this.mesh.geometry.getAttribute('position'), normal = this.mesh.geometry.getAttribute('normal');
    const n = across.clone(), point = new THREE.Vector3(), tangent = new THREE.Vector3(), b = new THREE.Vector3();
    let k = path.length - 2;
    // Кольца — от манжеты к плечу: поперечные оси несём вдоль трубы без закрутки, начиная с осей кисти.
    for (let i = RINGS - 1; i >= 0; i--) {
      const v = V[i], s = v < SLEEVE.cuff ? (v / SLEEVE.cuff) * body : body + ((v - SLEEVE.cuff) / (1 - SLEEVE.cuff)) * cuff;
      while (k > 0 && lengths[k] > s) k--;
      const t = THREE.MathUtils.clamp((s - lengths[k]) / (lengths[k + 1] - lengths[k] || 1), 0, 1);
      point.lerpVectors(path[k], path[k + 1], t);
      tangent.subVectors(path[k + 1], path[k]).normalize();
      n.addScaledVector(tangent, -n.dot(tangent)).normalize();
      if (this.left) b.crossVectors(tangent, n);
      else b.crossVectors(n, tangent);
      const r = widthAt(v) * ROUND, e = THREE.MathUtils.lerp(1, FLAT, THREE.MathUtils.smoothstep(v, 0.7, SLEEVE.cuff));
      const wide = r * e, thin = r / e;
      for (let j = 0; j <= SIDES; j++) {
        const a = (2 * Math.PI * j) / SIDES - Math.PI, cos = Math.cos(a), sin = Math.sin(a), at = i * (SIDES + 1) + j;
        position.setXYZ(at,
          point.x + b.x * thin * cos - n.x * wide * sin,
          point.y + b.y * thin * cos - n.y * wide * sin,
          point.z + b.z * thin * cos - n.z * wide * sin);
        const nx = b.x * (cos / thin) - n.x * (sin / wide), ny = b.y * (cos / thin) - n.y * (sin / wide), nz = b.z * (cos / thin) - n.z * (sin / wide);
        const l = Math.hypot(nx, ny, nz);
        normal.setXYZ(at, nx / l, ny / l, nz / l);
      }
    }
    position.needsUpdate = true;
    normal.needsUpdate = true;
  }
}

// Плечо — относительно глаз: вбок, ниже и чуть позади (м). Плечо и предплечье — UPPER и FORE; дальше
// STRAIGHT от их суммы рука не разгибается, а тянется, как резиновая.
const SHOULDER = [0.19, 0.25, 0.05];
const UPPER = 0.3, FORE = 0.27, STRAIGHT = 0.95;
// Оси тела, повёрнутого по yaw: вправо и вперёд. Плечо руки side (+1 — правая, −1 — левая) при глазах eye.
const axesOf = (yaw) => [new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)), new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw))];
const shoulderOf = (eye, right, forward, side) =>
  eye.clone().addScaledVector(right, side * SHOULDER[0]).addScaledVector(UP, -SHOULDER[1]).addScaledVector(forward, -SHOULDER[2]);
// Тыл кисти k (0 — правая, 1 — левая), обхватившей ось across (от большого пальца к мизинцу) у точки grip, при глазах
// eye и осях тела right, forward. Пальцы продолжают предплечье — от локтя, опущенного под плечо, к хвату, чуть
// внутрь — и ложатся поперёк оси. Тогда тыл кисти смотрит на глаза, а не прячется за манжетой.
function backOf(k, grip, across, eye, right, forward) {
  const side = k ? -1 : 1, elbow = shoulderOf(eye, right, forward, side).addScaledVector(UP, -UPPER);
  const fingers = grip.clone().sub(elbow).normalize().addScaledVector(right, -0.3 * side);
  fingers.addScaledVector(across, -fingers.dot(across)).normalize();
  return k ? fingers.cross(across) : across.clone().cross(fingers);
}
// Локоть руки от плеча shoulder до запястья wrist: где сходятся плечо и предплечье, в сторону pole.
function reach(shoulder, wrist, pole) {
  const d = Math.max(shoulder.distanceTo(wrist), 1e-3), k = Math.max(1, d / (STRAIGHT * (UPPER + FORE)));
  const a = UPPER * k, b = FORE * k;
  const along = (a * a - b * b + d * d) / (2 * d), h = Math.sqrt(Math.max(0, a * a - along * along));
  const dir = wrist.clone().sub(shoulder).divideScalar(d);
  const side = pole.clone().addScaledVector(dir, -pole.dot(dir)).normalize();
  return shoulder.clone().addScaledVector(dir, along).addScaledVector(side, h);
}

// Пустые руки — у нижнего края взгляда (в осях глаз: вбок, вверх, вперёд), наготове: пальцы вперёд, чуть внутрь
// и вниз, тыл кисти наружу и кверху, большие пальцы — вверх. Запястье — у края кадра, кисть — в кадре.
const REST = { at: [0.17, -0.22, -0.42], fingers: [-0.1, -0.15, -1], back: [1, 0.5, 0.1] };
// Пилу держат обе руки (saw.js, userData.grips). Правая — заднюю рукоять, тыл кисти — к лицевой стороне пилы
// и чуть к рукоятям (SAW_BACK). Левая — верх передней трубы, большим пальцем к лицевой стороне, а тыл кисти —
// куда велит предплечье (backOf). Указательный правой, пока не пилишь, приподнят над курком (рукоять ему
// как бы толще на TRIGGER.free), нажал — прижал.
const SAW_BACK = new THREE.Vector3(0, -0.35, 1).normalize();
const TRIGGER = { free: 0.03, pressed: 0.004 };
// Кусок тоньше THIN обхватывают кулаки, толще — ладони ложатся плашмя. Толстый поперёк взгляда (ось к «вправо»
// ближе, чем на 30°: cos — CROSS) короче SPAN держат за торцы, длиннее — снизу, ладони по обе стороны от хвата
// на UNDER; наискось, вдоль взгляда и стоймя — с боков.
const THIN = 0.045, CROSS = Math.cos(Math.PI / 6), SPAN = 0.65, UNDER = 0.25;
// Выбор с запасом: «да», когда score > 0, но сделанный выбор (was) держится, пока score не уйдёт за margin
// в другую сторону. Кусок в руках качается у границы выбора — а руки не перескакивают с места на место.
const choose = (was, score, margin = 0.2) => (was === undefined ? score > 0 : score > (was ? -margin : margin));

export class Arms {
  constructor() {
    this.hands = [new Glove(false), new Glove(true)];
    this.sleeves = [new Sleeve(false), new Sleeve(true)];
    this.group = new THREE.Group().add(...this.hands.map((h) => h.object), ...this.sleeves.map((s) => s.mesh));
    this.choice = {}; // как держат кусок: что выбрано в прошлый раз (choose)
  }

  // Держать пилу saw (pressed — курок нажат), глядя из eye и стоя лицом по yaw.
  holdSaw(saw, pressed, eye, yaw) {
    this.choice = {};
    saw.updateMatrixWorld();
    const [right, forward] = axesOf(yaw), q = saw.getWorldQuaternion(new THREE.Quaternion());
    saw.userData.grips.forEach(({ at, axis, r, finger }, k) => {
      const gaps = k ? {} : { index: pressed ? TRIGGER.pressed : TRIGGER.free };
      const grip = at.clone().applyMatrix4(saw.matrixWorld), across = axis.clone().applyQuaternion(q);
      const back = k ? backOf(k, grip, across, eye, right, forward) : SAW_BACK.clone().applyQuaternion(q);
      this.hands[k].clasp('saw', grip, across, back, r, finger, gaps);
    });
  }

  // Держать кусок за точку at на оси a–b (a, b — его концы) радиусом r, глядя из eye и стоя лицом по yaw.
  // Тонкий — в кулаках по обе стороны точки вдоль оси, правая — ближе к правому, верхнему и ближнему концу;
  // большой палец — кверху, внутрь или к себе: так кисть поворачивается без вывиха, как бы ни лежал кусок.
  // Толстый — ладонями плашмя, пальцы вперёд: короткий поперёк взгляда — за торцы, длинный поперёк — снизу,
  // а вдоль взгляда или стоймя — с боков. За торцы и с боков большие пальцы смотрят вверх.
  holdPiece(at, a, b, r, eye, yaw) {
    const [right, forward] = axesOf(yaw), axis = b.clone().sub(a).normalize();
    const centre = new THREE.Line3(a, b).closestPointToPoint(at, true, new THREE.Vector3());
    const was = this.choice;
    if (r < THIN) {
      const toB = (was.toB = choose(was.toB, axis.dot(right.clone().addScaledVector(UP, 0.3).addScaledVector(forward, -0.5)))) ? 1 : -1;
      const spread = 0.06 + 0.8 * r;
      this.hands.forEach((hand, k) => {
        const side = k ? -1 : 1, inward = right.clone().multiplyScalar(-side);
        const grip = centre.clone().addScaledVector(axis, toB * side * spread);
        const thumb = UP.clone().addScaledVector(inward, 0.5).addScaledVector(forward, -0.3);
        const across = (was[k] = choose(was[k], axis.dot(thumb))) ? axis.clone().negate() : axis.clone();
        hand.clasp('piece', grip, across, backOf(k, grip, across, eye, right, forward), r, 'middle');
      });
      return;
    }
    if (!(was.toB = choose(was.toB, axis.dot(right)))) {
      [a, b] = [b, a];
      axis.negate();
    }
    const crosswise = (was.cross = choose(was.cross, axis.dot(right) - CROSS, 0.1));
    const kind = crosswise ? (a.distanceTo(b) < SPAN ? 'ends' : 'under') : 'sides';
    this.hands.forEach((hand, k) => {
      // out — наружу из куска под ладонью, contact — где ладонь его касается.
      const side = k ? -1 : 1, out = new THREE.Vector3(), contact = new THREE.Vector3();
      if (kind === 'ends') {
        out.copy(axis).multiplyScalar(side);
        contact.copy(k ? a : b);
      } else {
        if (kind === 'under') out.copy(UP).addScaledVector(axis, -axis.dot(UP)).normalize().negate();
        else out.copy(right).addScaledVector(axis, -axis.dot(right)).normalize().multiplyScalar(side);
        contact.copy(centre).addScaledVector(axis, kind === 'under' ? side * UNDER : 0).addScaledVector(out, r);
      }
      // Пальцы — вперёд вдоль ладони; кривизна под ними — у торца никакой, у бока — по тому, как пальцы лежат
      // к оси: поперёк — радиус куска, вдоль — прямая.
      const fingers = forward.clone().addScaledVector(out, -forward.dot(out)).normalize();
      const curve = kind === 'ends' ? 1 : Math.min(1, r / Math.max(1e-3, 1 - fingers.dot(axis) ** 2));
      const across = k ? out.clone().cross(fingers) : fingers.clone().cross(out);
      hand.clasp(kind, contact.addScaledVector(out, -curve), across, out, curve, 'middle');
    });
  }

  // Пустые руки при взгляде eye (точка) с поворотом look (кватернион глаз).
  rest(eye, look) {
    this.choice = {};
    this.hands.forEach((hand, k) => {
      const side = k ? -1 : 1, v = ([x, y, z]) => new THREE.Vector3(x * side, y, z).applyQuaternion(look);
      const fingers = v(REST.fingers).normalize(), back = v(REST.back);
      back.addScaledVector(fingers, -back.dot(fingers)).normalize();
      const across = k ? back.clone().cross(fingers) : fingers.clone().cross(back);
      hand.aim('rest', across, back, new THREE.Vector3(), v(REST.at).add(eye));
      hand.goal = LOOSE;
    });
  }

  // Кисти — к своим местам, пальцы — к своим сгибам; рукава — от плеч (по глазам eye и повороту тела yaw) к запястьям.
  update(eye, yaw, dt) {
    const [right, forward] = axesOf(yaw);
    this.hands.forEach((hand, k) => {
      hand.follow(dt);
      const side = k ? -1 : 1, q = hand.object.quaternion, shoulder = shoulderOf(eye, right, forward, side);
      const along = Y.clone().applyQuaternion(q), back = Z.clone().applyQuaternion(q), across = X.clone().applyQuaternion(q).multiplyScalar(side);
      // Локоть — вниз, наружу и назад, и так, чтобы предплечье шло к кисти по её оси.
      const pole = right.clone().multiplyScalar(0.6 * side).sub(UP).addScaledVector(forward, -0.4).addScaledVector(along, -0.5);
      const wrist = hand.object.position;
      this.sleeves[k].update(shoulder, reach(shoulder, wrist, pole), wrist, along, across, back);
    });
  }
}
