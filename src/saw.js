import * as THREE from 'three';

// Аккумуляторная пила. Оси: x — вдоль шины (мотор на +x), y — куда шина идёт в древесину,
// z — перпендикуляр к полотну (при горизонтальном резе — вверх). Начало координат — середина шины.
// Рукояти лежат в плоскости шины, на −y: при горизонтальном резе пила лежит на боку, как в жизни.
export const BAR_L = 0.7;  // длина шины: столько она перекрывает поперёк пропила
export const BAR_W = 0.05; // ширина шины: столько её позади режущей кромки сидит в щели

// Корпус — «подушка» по силуэту вида сбоку (saw-body.png). Карта saw-shape.png по клетке CELL×CELL:
// в красном — полутолщина в четвертях миллиметра, в зелёном — расстояние до края силуэта
// в шестнадцатых клетки (128 — край). Обе картинки готовит tools/saw.py.
const BODY_M = 0.36 / 1484;     // метров в пикселе вида сбоку
const CELL = 8;                 // пикселей вида сбоку в клетке карты формы
const SIDE_W = 1536, SIDE_H = 1024;
const MOUNT = [1500, 742];      // пиксель, где из корпуса выходит шина: x = BAR_L / 2, y = 0
const bodyX = (px) => BAR_L / 2 + (MOUNT[0] - px) * BODY_M;
const bodyY = (py) => (py - MOUNT[1]) * BODY_M;

// Шина: полотно из saw-bar.png (вырезано из картинки по пикселям BAR_PX) и цепь лентой вокруг.
// Пятка и нос — в масштабе картинки, середина тянется под длину BAR_L.
const BAR_M = 0.3 / 1936;       // метров в пикселе картинки шины
const BAR_PX = [91, 1983, 272, 513];
const PLATE_TIP = 1975;         // пиксель кончика полотна
const SLOT = [218, 392];        // середина паза: садится на шпильки корпуса
const SLOT_X = bodyX(1390);
const NOSE_X = -BAR_L / 2 + 0.012; // кончик полотна в метрах: цепь на носу дотягивается до −BAR_L / 2
const PLATE_R = 0.0175;         // полуширина полотна, по нему идёт цепь
const CHAIN_IN = 0.003, CHAIN_H = 0.015, CHAIN_TILE = 0.164; // лента цепи: высота и длина одного повтора картинки

const loader = new THREE.TextureLoader();
const load = (file) => {
  const texture = loader.load(`assets/textures/${file}`);
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
const shape = await new THREE.ImageLoader().loadAsync('assets/textures/saw-shape.png');

// Передний лист на +z и задний на −z. Край проводим по клеткам, как изолинию (marching squares):
// где зелёный переходит через 128, ставим вершину на ребре клетки, и там оба листа сходятся на z = 0.
function bodyGeometry() {
  const cols = shape.width, rows = shape.height;
  const canvas = document.createElement('canvas');
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(shape, 0, 0);
  const pixels = ctx.getImageData(0, 0, cols, rows).data;
  const dist = ([i, j]) => pixels[4 * (j * cols + i) + 1] - 128;
  const position = [], uv = [], index = [], shared = new Map();
  // Вершина на пикселе (px, py) вида сбоку: передняя копия, за ней задняя.
  const vertex = (key, px, py, half) => {
    if (!shared.has(key)) {
      shared.set(key, position.length / 3);
      position.push(bodyX(px), bodyY(py), half, bodyX(px), bodyY(py), -half);
      uv.push(px / SIDE_W, 1 - py / SIDE_H, px / SIDE_W, 1 - py / SIDE_H);
    }
    return shared.get(key);
  };
  const corner = ([i, j]) => vertex(j * cols + i, (i + 0.5) * CELL, (j + 0.5) * CELL, pixels[4 * (j * cols + i)] / 4000);
  const crossing = (a, b) => {
    const t = dist(a) / (dist(a) - dist(b)), ka = a[1] * cols + a[0], kb = b[1] * cols + b[0];
    return vertex(`${Math.min(ka, kb)}-${Math.max(ka, kb)}`,
      (a[0] + t * (b[0] - a[0]) + 0.5) * CELL, (a[1] + t * (b[1] - a[1]) + 0.5) * CELL, 0);
  };
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const ring = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]], poly = [];
      ring.forEach((a, k) => {
        const b = ring[(k + 1) % 4];
        if (dist(a) > 0) poly.push(corner(a));
        if ((dist(a) > 0) !== (dist(b) > 0)) poly.push(crossing(a, b));
      });
      // Обход клетки идёт по часовой стрелке, если смотреть с +z: передний лист разворачиваем.
      for (let k = 1; k < poly.length - 1; k++) {
        index.push(poly[0], poly[k + 1], poly[k], poly[0] + 1, poly[k] + 1, poly[k + 1] + 1);
      }
    }
  }
  return geometryOf(position, uv, index);
}

function plateGeometry() {
  const [left, right, top, bottom] = BAR_PX;
  const columns = [[left, SLOT_X - (left - SLOT[0]) * BAR_M], [700, SLOT_X - (700 - SLOT[0]) * BAR_M],
    [1700, NOSE_X + (PLATE_TIP - 1700) * BAR_M], [right, NOSE_X - (right - PLATE_TIP) * BAR_M]];
  const position = [], uv = [], index = [];
  columns.forEach(([px, x], k) => {
    for (const py of [top, bottom]) {
      position.push(x, (py - SLOT[1]) * BAR_M, 0);
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
  const noseC = NOSE_X + PLATE_R, r = PLATE_R - CHAIN_IN;
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
    position.push(x, y, 0, x + CHAIN_H * nx, y + CHAIN_H * ny, 0);
    uv.push(s / CHAIN_TILE, 0, s / CHAIN_TILE, 1);
    if (k) index.push(2 * k - 2, 2 * k, 2 * k - 1, 2 * k - 1, 2 * k, 2 * k + 1);
  });
  return geometryOf(position, uv, index);
}

const bodyMap = load('saw-body.png'), plateMap = load('saw-bar.png'), chainMap = load('saw-chain.png');
chainMap.wrapS = THREE.RepeatWrapping;
const body = bodyGeometry(), plate = plateGeometry(), chain = chainGeometry();
const flat = { side: THREE.DoubleSide, alphaTest: 0.5 };

export function makeSaw() {
  const skin = new THREE.MeshLambertMaterial({ color: 0xe0ad84 });
  const saw = new THREE.Group();
  saw.add(
    new THREE.Mesh(body, new THREE.MeshStandardMaterial({ map: bodyMap, roughness: 0.6 })),
    new THREE.Mesh(plate, new THREE.MeshStandardMaterial({ map: plateMap, roughness: 0.45, ...flat })),
    new THREE.Mesh(chain, new THREE.MeshStandardMaterial({ map: chainMap, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -1, ...flat })),
  );
  // Руки — пока шары: на задней рукояти у курка и на верху передней дуги.
  for (const [px, py] of [[340, 290], [1070, 125]]) {
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), skin);
    hand.position.set(bodyX(px), bodyY(py), 0);
    hand.name = 'hand';
    saw.add(hand);
  }
  return saw;
}
