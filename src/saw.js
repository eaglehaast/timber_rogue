import * as THREE from 'three';

// Аккумуляторная пила. Оси: x — вдоль шины (мотор на +x), y — куда шина идёт в древесину,
// z — перпендикуляр к полотну (при горизонтальном резе — вверх). Начало координат — середина шины.
// Рукояти лежат в плоскости шины, на −y: при горизонтальном резе пила лежит на боку, как в жизни.
// Длина шины — столько она перекрывает поперёк пропила; переключается клавишей: настоящая, 30 см
// (12", 45 звеньев цепи), и прежняя 70 см. Корпус от длины не зависит, полотно и цепь строятся под неё.
export const BARS = [0.3, 0.7];
export const BAR_W = 0.05; // ширина шины: столько её позади режущей кромки сидит в щели
const RIM_STEP = 0.01; // м: шаг точек обвода корпуса

// Комплекты картинок пилы и их размеры готовит tools/saw.py; в игре они переключаются клавишей.
export const PACKS = ['2', '1'];

const loader = new THREE.TextureLoader();
const geometryOf = (position, uv, index) => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
};

async function loadPack(name) {
  const path = `assets/textures/saw-${name}`;
  const { body: BODY, bar: BAR, chain: CHAIN } = await (await fetch(`${path}.json`)).json();
  const shape = await new THREE.ImageLoader().loadAsync(`${path}-shape.png`);
  const load = (file) => {
    const texture = loader.load(`${path}-${file}.png`);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return texture;
  };
  // Корпус — «подушка» по силуэту вида сбоку. Карта -shape.png по клетке BODY.cell пикселей:
  // в красном — z лицевого листа, в синем — z тыльного (128 + полмиллиметра на единицу),
  // в зелёном — расстояние до края силуэта в шестнадцатых клетки (128 — край).
  // Корпус — в своих осях, x от крепления шины: на пилу его ставят на конец шины, bar / 2.
  const bodyX = (px) => (BODY.mount[0] - px) * BODY.m;
  const bodyY = (py) => (py - BODY.mount[1]) * BODY.m;

  // Шина: полотно из -bar.png (вырезано из картинки по пикселям BAR.px) и цепь лентой вокруг.
  // Пятка и нос — в масштабе картинки, середина (BAR.stretch) тянется под длину шины bar.
  const slotX = (bar) => bar / 2 + bodyX(BODY.slot); // паз полотна садится на шпильки корпуса
  const noseX = (bar) => -bar / 2 + 0.012;            // кончик полотна: цепь на носу дотягивается до −bar / 2

  // Лицевой лист смотрит на +z, тыльный — на −z. Край проводим по клеткам, как изолинию (marching squares):
  // где зелёный переходит через 128, ставим вершину на ребре клетки, и там оба листа сходятся.
  // Сначала идут треугольники лица, за ними тыла: у каждого листа своя картинка.
  // Заодно — обвод корпуса (rim): точки края, где листы сходятся, не чаще RIM_STEP. Ствол — стенка,
  // и корпус, подойдя к нему, касается его краем силуэта: по обводу пила упирается корпусом в древесину.
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
    const position = [], uv = [], front = [], back = [], shared = new Map(), edge = new Set();
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
      return mark(vertex(`${Math.min(ka, kb)}-${Math.max(ka, kb)}`,
        (a[0] + t * (b[0] - a[0]) + 0.5) * cell, (a[1] + t * (b[1] - a[1]) + 0.5) * cell, z, z));
    };
    const mark = (index) => { edge.add(index); return index; };
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
    const rim = [];
    for (const i of edge) {
      const p = new THREE.Vector3().fromArray(position, 3 * i);
      if (rim.every((q) => q.distanceTo(p) >= RIM_STEP)) rim.push(p);
    }
    return { geometry, rim };
  }
  const body = bodyGeometry();

  function plateGeometry(bar) {
    const [left, right, top, bottom] = BAR.px, [a, b] = BAR.stretch;
    const heel = (px) => slotX(bar) - (px - BAR.slot[0]) * BAR.m, nose = (px) => noseX(bar) + (BAR.tip - px) * BAR.m;
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
  // конец ленты прячется в корпусе, там и шов картинки. Цепь бежит по ленте вперёд, а зубья на картинке
  // смотрят к её левому краю (впереди ограничитель, за ним режущий угол), поэтому картинку кладём задом наперёд.
  function chainGeometry(bar) {
    const noseC = noseX(bar) + BAR.radius, r = BAR.radius - CHAIN.inset;
    const path = [[slotX(bar), -r, 0, -1]];
    for (let k = 0; k <= 24; k++) {
      const a = -Math.PI / 2 - (Math.PI * k) / 24;
      path.push([noseC + r * Math.cos(a), r * Math.sin(a), Math.cos(a), Math.sin(a)]);
    }
    path.push([slotX(bar), r, 0, 1]);
    const position = [], uv = [], index = [];
    let s = 0;
    path.forEach(([x, y, nx, ny], k) => {
      if (k) s += Math.hypot(x - path[k - 1][0], y - path[k - 1][1]);
      position.push(x, y, 0, x + CHAIN.height * nx, y + CHAIN.height * ny, 0);
      uv.push(-s / CHAIN.tile, 0, -s / CHAIN.tile, 1);
      if (k) index.push(2 * k - 2, 2 * k, 2 * k - 1, 2 * k - 1, 2 * k, 2 * k + 1);
    });
    return geometryOf(position, uv, index);
  }

  const frontMap = load('front'), backMap = BODY.back ? load('back') : frontMap;
  const plateMap = load('bar'), chainMap = load('chain');
  chainMap.wrapS = THREE.RepeatWrapping;
  const flat = { side: THREE.DoubleSide, alphaTest: 0.5 };
  const plateMaterial = new THREE.MeshStandardMaterial({ map: plateMap, roughness: 0.45, ...flat });
  const onPlate = { roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -1 };
  const chainMaterial = new THREE.MeshStandardMaterial({ map: chainMap, ...onPlate, ...flat });
  const blurMap = blurred(await new THREE.ImageLoader().loadAsync(`${path}-chain.png`));
  const blurMaterial = new THREE.MeshStandardMaterial({ map: blurMap, ...onPlate, side: THREE.DoubleSide, transparent: true });
  return {
    body: new THREE.Mesh(body.geometry, [frontMap, backMap].map((map) => new THREE.MeshStandardMaterial({ map, roughness: 0.6 }))),
    bars: Object.fromEntries(BARS.map((bar) => {
      const chain = chainGeometry(bar);
      return [bar, {
        plate: new THREE.Mesh(plateGeometry(bar), plateMaterial),
        chain: new THREE.Mesh(chain, chainMaterial),
        blur: new THREE.Mesh(chain, blurMaterial),
      }];
    })),
    hands: BODY.hands.map(([px, py]) => new THREE.Vector3(bodyX(px), bodyY(py), 0)),
    lamp: new THREE.Vector3(bodyX(BODY.lamp[0]), bodyY(BODY.lamp[1]), 0),
    rim: body.rim,
  };
}

// Бегущую цепь глаз видит размытой: звенья проносятся быстрее, чем он успевает их разглядеть, и каждая
// строка картинки сливается в свой средний цвет — вдоль хода тянутся полосы. Свет складывается в линейных
// долях, а не в цифрах sRGB, а прозрачное не красит. Зубья занимают лишь часть длины, поэтому над лентой
// остаётся полупрозрачная дымка.
function blurred(image) {
  const { width: w, height: h } = image;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, w, h).data, row = ctx.createImageData(1, h);
  for (let y = 0; y < h; y++) {
    const sum = [0, 0, 0, 0];
    for (let i = 4 * y * w; i < 4 * (y + 1) * w; i += 4) {
      const a = pixels[i + 3] / 255;
      for (let c = 0; c < 3; c++) sum[c] += a * (pixels[i + c] / 255) ** 2.2;
      sum[3] += a;
    }
    for (let c = 0; c < 3; c++) row.data[4 * y + c] = 255 * (sum[c] / (sum[3] || 1)) ** (1 / 2.2);
    row.data[4 * y + 3] = (255 * sum[3]) / w;
  }
  canvas.width = 1;
  ctx.putImageData(row, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const packs = Object.fromEntries(await Promise.all(PACKS.map(async (name) => [name, await loadPack(name)])));

// Лампа перегрузки у основания задней рукояти: тёмная, а когда шину вот-вот зажмёт, горит красным.
const lampGeometry = new THREE.BoxGeometry(0.008, 0.008, 0.014);
const LAMP_OFF = new THREE.MeshStandardMaterial({ color: 0x3a1210, roughness: 0.3 });
const LAMP_ON = new THREE.MeshStandardMaterial({ color: 0xc00000, emissive: 0xff0000, emissiveIntensity: 0.9 });
export function lamp(saw, on) {
  saw.getObjectByName('lamp').material = on ? LAMP_ON : LAMP_OFF;
}

// Собирает пилу из комплекта name с шиной длиной bar в группе saw; части получают слои самой группы.
// Корпус с руками и лампой — на конце шины, bar / 2 от её середины.
export function dressSaw(saw, name, bar) {
  const pack = packs[name];
  saw.clear();
  const skin = new THREE.MeshLambertMaterial({ color: 0xe0ad84 });
  const body = new THREE.Group();
  body.position.x = bar / 2;
  const light = new THREE.Mesh(lampGeometry, LAMP_OFF);
  light.position.copy(pack.lamp);
  light.name = 'lamp';
  body.add(pack.body.clone(), light);
  // Руки — пока шары: на задней рукояти у курка и на верху передней дуги.
  for (const at of pack.hands) {
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), skin);
    hand.position.copy(at);
    hand.name = 'hand';
    body.add(hand);
  }
  const { plate, chain, blur } = pack.bars[bar];
  const links = chain.clone(), streaks = blur.clone();
  links.name = 'chain';
  streaks.name = 'blur';
  streaks.visible = false;
  saw.add(body, plate.clone(), links, streaks);
  saw.traverse((part) => { part.layers.mask = saw.layers.mask; });
  saw.userData.pack = name;
  saw.userData.bar = bar;
  saw.userData.chain = 0;
  saw.userData.rim = pack.rim.map((p) => p.clone().setX(p.x + bar / 2));
  return saw;
}

// Цепь бежит, пока нажат курок: по кромке, что идёт в древесину, — от носа к мотору, по обратной — к носу.
// Бежит она метров пятнадцать в секунду, и звенья сливаются в полосы. Отпустил курок — мотор тормозит цепь,
// и она ещё долю секунды бежит. Зажатая цепь встаёт сразу. Скорость цепи (м/с) пила помнит в userData.chain:
// брошенная пила — копия той, что была в руках, со стоящей цепью, и дальше её не трогают.
const RUN = 15;         // м/с
const SPIN_DOWN = 0.5;  // с — за столько тормоз останавливает цепь
export function runChain(saw, pressed, jammed, dt) {
  const v = saw.userData.chain;
  saw.userData.chain = jammed ? 0 : pressed ? RUN : Math.max(0, v - (RUN * dt) / SPIN_DOWN);
  saw.getObjectByName('chain').visible = !saw.userData.chain;
  saw.getObjectByName('blur').visible = saw.userData.chain > 0;
}

export const makeSaw = (name = PACKS[0], bar = BARS[0]) => dressSaw(new THREE.Group(), name, bar);
