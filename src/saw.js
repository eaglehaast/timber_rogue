import * as THREE from 'three';

// Аккумуляторная пила. Оси: x — вдоль шины (мотор на +x), y — куда шина идёт в древесину,
// z — перпендикуляр к полотну (при горизонтальном резе — вверх). Начало координат — середина шины.
// Рукояти лежат в плоскости шины, на −y: при горизонтальном резе пила лежит на боку, как в жизни.
export const BAR_L = 0.7;  // длина шины: столько она перекрывает поперёк пропила
export const BAR_W = 0.05; // ширина шины: столько её позади режущей кромки сидит в щели

// Комплект картинок пилы (?saw=1 или 2) и его размеры готовит tools/saw.py.
const PACK = `assets/textures/saw-${new URLSearchParams(location.search).get('saw') ?? '2'}`;
const { body: BODY, bar: BAR, chain: CHAIN } = await (await fetch(`${PACK}.json`)).json();

// Корпус — «подушка» по силуэту вида сбоку. Карта -shape.png по клетке BODY.cell пикселей:
// в красном — z лицевого листа, в синем — z тыльного (128 + полмиллиметра на единицу),
// в зелёном — расстояние до края силуэта в шестнадцатых клетки (128 — край).
const bodyX = (px) => BAR_L / 2 + (BODY.mount[0] - px) * BODY.m;
const bodyY = (py) => (py - BODY.mount[1]) * BODY.m;

// Шина: полотно из -bar.png (вырезано из картинки по пикселям BAR.px) и цепь лентой вокруг.
// Пятка и нос — в масштабе картинки, середина (BAR.stretch) тянется под длину BAR_L.
const SLOT_X = bodyX(BODY.slot);   // паз полотна садится на шпильки корпуса
const NOSE_X = -BAR_L / 2 + 0.012; // кончик полотна: цепь на носу дотягивается до −BAR_L / 2

const loader = new THREE.TextureLoader();
const load = (file) => {
  const texture = loader.load(`${PACK}-${file}.png`);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
};
const geometryOf = (position, uv, index) => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
};
const shape = await new THREE.ImageLoader().loadAsync(`${PACK}-shape.png`);

// Лицевой лист смотрит на +z, тыльный — на −z. Край проводим по клеткам, как изолинию (marching squares):
// где зелёный переходит через 128, ставим вершину на ребре клетки, и там оба листа сходятся.
// Сначала идут треугольники лица, за ними тыла: у каждого листа своя картинка.
function bodyGeometry() {
  const cols = shape.width, rows = shape.height, cell = BODY.cell, [sideW, sideH] = BODY.size;
  const canvas = document.createElement('canvas');
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(shape, 0, 0);
  const pixels = ctx.getImageData(0, 0, cols, rows).data;
  const at = ([i, j], channel) => pixels[4 * (j * cols + i) + channel] - 128;
  const dist = (c) => at(c, 1);
  const position = [], uv = [], front = [], back = [], shared = new Map();
  // Вершина на пикселе (px, py) вида сбоку: лицевая копия, за ней тыльная.
  const vertex = (key, px, py, zf, zb) => {
    if (!shared.has(key)) {
      shared.set(key, position.length / 3);
      position.push(bodyX(px), bodyY(py), zf, bodyX(px), bodyY(py), zb);
      uv.push(px / sideW, 1 - py / sideH, px / sideW, 1 - py / sideH);
    }
    return shared.get(key);
  };
  const corner = (c) => vertex(c[1] * cols + c[0], (c[0] + 0.5) * cell, (c[1] + 0.5) * cell, at(c, 0) / 2000, at(c, 2) / 2000);
  const crossing = (a, b) => {
    const t = dist(a) / (dist(a) - dist(b)), ka = a[1] * cols + a[0], kb = b[1] * cols + b[0];
    const z = ((1 - t) * (at(a, 0) + at(a, 2)) + t * (at(b, 0) + at(b, 2))) / 4000;
    return vertex(`${Math.min(ka, kb)}-${Math.max(ka, kb)}`,
      (a[0] + t * (b[0] - a[0]) + 0.5) * cell, (a[1] + t * (b[1] - a[1]) + 0.5) * cell, z, z);
  };
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const ring = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]], poly = [];
      ring.forEach((a, k) => {
        const b = ring[(k + 1) % 4];
        if (dist(a) > 0) poly.push(corner(a));
        if ((dist(a) > 0) !== (dist(b) > 0)) poly.push(crossing(a, b));
      });
      // Обход клетки идёт по часовой стрелке, если смотреть с +z: лицевой лист разворачиваем.
      for (let k = 1; k < poly.length - 1; k++) {
        front.push(poly[0], poly[k + 1], poly[k]);
        back.push(poly[0] + 1, poly[k] + 1, poly[k + 1] + 1);
      }
    }
  }
  const geometry = geometryOf(position, uv, [...front, ...back]);
  geometry.addGroup(0, front.length, 0);
  geometry.addGroup(front.length, back.length, 1);
  return geometry;
}

function plateGeometry() {
  const [left, right, top, bottom] = BAR.px, [a, b] = BAR.stretch;
  const heel = (px) => SLOT_X - (px - BAR.slot[0]) * BAR.m, nose = (px) => NOSE_X + (BAR.tip - px) * BAR.m;
  const position = [], uv = [], index = [];
  [[left, heel(left)], [a, heel(a)], [b, nose(b)], [right, nose(right)]].forEach(([px, x], k) => {
    for (const py of [top, bottom]) {
      position.push(x, (py - BAR.slot[1]) * BAR.m, 0);
      uv.push((px - left) / (right - left), 1 - (py - top) / (bottom - top));
    }
    if (k) index.push(2 * k - 2, 2 * k - 1, 2 * k, 2 * k - 1, 2 * k + 1, 2 * k);
  });
  return geometryOf(position, uv, index);
}

// Цепь — лента по краю полотна: вдоль верхней кромки к носу, вокруг носа и обратно к корпусу.
// Звенья смотрят внутрь и чуть заходят на полотно (рисуются поверх него), зубья — наружу;
// конец ленты прячется в корпусе, там и шов картинки.
function chainGeometry() {
  const noseC = NOSE_X + BAR.radius, r = BAR.radius - CHAIN.inset;
  const path = [[SLOT_X, -r, 0, -1]];
  for (let k = 0; k <= 24; k++) {
    const a = -Math.PI / 2 - (Math.PI * k) / 24;
    path.push([noseC + r * Math.cos(a), r * Math.sin(a), Math.cos(a), Math.sin(a)]);
  }
  path.push([SLOT_X, r, 0, 1]);
  const position = [], uv = [], index = [];
  let s = 0;
  path.forEach(([x, y, nx, ny], k) => {
    if (k) s += Math.hypot(x - path[k - 1][0], y - path[k - 1][1]);
    position.push(x, y, 0, x + CHAIN.height * nx, y + CHAIN.height * ny, 0);
    uv.push(s / CHAIN.tile, 0, s / CHAIN.tile, 1);
    if (k) index.push(2 * k - 2, 2 * k, 2 * k - 1, 2 * k - 1, 2 * k, 2 * k + 1);
  });
  return geometryOf(position, uv, index);
}

const frontMap = load('front'), backMap = BODY.back ? load('back') : frontMap;
const plateMap = load('bar'), chainMap = load('chain');
chainMap.wrapS = THREE.RepeatWrapping;
const body = bodyGeometry(), plate = plateGeometry(), chain = chainGeometry();
const flat = { side: THREE.DoubleSide, alphaTest: 0.5 };

export function makeSaw() {
  const skin = new THREE.MeshLambertMaterial({ color: 0xe0ad84 });
  const saw = new THREE.Group();
  saw.add(
    new THREE.Mesh(body, [frontMap, backMap].map((map) => new THREE.MeshStandardMaterial({ map, roughness: 0.6 }))),
    new THREE.Mesh(plate, new THREE.MeshStandardMaterial({ map: plateMap, roughness: 0.45, ...flat })),
    new THREE.Mesh(chain, new THREE.MeshStandardMaterial({ map: chainMap, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -1, ...flat })),
  );
  // Руки — пока шары: на задней рукояти у курка и на верху передней дуги.
  for (const [px, py] of BODY.hands) {
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), skin);
    hand.position.set(bodyX(px), bodyY(py), 0);
    hand.name = 'hand';
    saw.add(hand);
  }
  return saw;
}
