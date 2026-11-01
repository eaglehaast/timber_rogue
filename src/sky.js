import * as THREE from 'three';
import { tiles } from './surface.js';
import { generator } from './random.js';
import { wind } from './wind.js';

// Небо — акварельная растяжка на сфере изнутри: нижний край картинки на горизонте, верхний в зените,
// по кругу она повторяется дважды (сама бесшовная). Ниже горизонта — её нижний край.
// На нём солнце, дневная луна и облака — картинки лицом к игроку. Облака ближе солнца и луны
// и дальше колец панорамы: низкие уходят за горы. Краски неба — как нарисованы: тональная кривая
// сцены их не трогает.
const RADIUS = 150, DISCS = 149, CLOUDS = 146;
const deg = THREE.MathUtils.degToRad;

// Облака — слой на высоте LAYER над двором, квадрат со стороной 2·SPREAD, их несёт ветер двора.
// Каждое облако считаем там, где оно есть, а рисуем на небе в том же направлении от двора, в CLOUDS м,
// размером во столько же раз меньше, во сколько ближе: перспектива сама делает облака над головой
// крупными и быстрыми, а у горизонта мелкими, медленными и густыми. Ушедшее за край квадрата
// возвращается с другого края, а к краю облака тают — там, где они уже за горами.
// Картинка сбоку годится, пока облако невысоко. Над головой видно его брюхо, поэтому выше OVERHEAD
// оно плавно сменяется тем же облаком снизу: картинкой, лежащей в слое плашмя, длинной стороной поперёк
// ветра — так облако и проплывает над двором.
const LAYER = 1500, SPREAD = 10000, FADE = 0.6; // м; таять начинают с FADE·SPREAD
const CLOUD_COUNT = 240, CLOUD_SPEED = 12;       // штук на весь слой; м/с
const CLOUD_WIDTH = [900, 2400];                // м
const OVERHEAD = [deg(45), deg(65)];            // высота над горизонтом: от вида сбоку к виду снизу
const clouds = [];
// Облако закрывает солнце: свет проходит сквозь него на долю 1 − THICK·(непрозрачность картинки в том месте,
// где на ней солнце). Плотное тело облака гасит солнце почти совсем, рваный край — едва.
const THICK = 0.9;
const COVER = [64, 32]; // столько точек по ширине и высоте у карты непрозрачности облака
let sunDir = null, light = 1;

// Картинка на небе — плоскость лицом к середине двора. Не спрайт: спрайт развёрнут вдоль экрана, и край
// большого облака сбоку экрана подходил бы ближе колец панорамы и вылезал перед горами.
function picture(map, direction, distance, width, aspect = 1) {
  const material = new THREE.MeshBasicMaterial({ map, transparent: true, toneMapped: false, depthWrite: false });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(distance * width, (distance * width) / aspect), material);
  plane.position.copy(direction).multiplyScalar(distance);
  plane.lookAt(0, 0, 0);
  return plane;
}

export async function makeSky(sun) {
  const sky = new THREE.Group();
  const geometry = new THREE.SphereGeometry(RADIUS, 64, 32);
  const p = geometry.attributes.position, uv = geometry.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setY(i, Math.max(0, Math.asin(p.getY(i) / RADIUS) / (Math.PI / 2)));
  const [map, sunMap, moonMap] = tiles(['sky.jpg', 'sun.png', 'moon.png'].map((n) => `assets/textures/${n}`));
  map.repeat.x = 2;
  map.wrapT = THREE.ClampToEdgeWrapping;
  // Сфера — фон: рисуется первой и глубину не пишет, иначе срезала бы края облаков, что выходят за неё.
  const dome = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map, side: THREE.BackSide, toneMapped: false, depthWrite: false }));
  dome.renderOrder = -1;
  dome.userData.backdrop = true; // фон, а не преграда солнцу: лучам (rays.js) не мешает
  sky.add(dome);

  // Луна в первой четверти: стоит на 90° восточнее солнца, левее его, и освещённым правым боком смотрит на него.
  const moon = sun.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2).setY(0.4).normalize();
  for (const disc of [picture(sunMap, sun, DISCS, deg(5)), picture(moonMap, moon, DISCS, deg(4))]) {
    disc.renderOrder = -2 * SPREAD; // дальше любого облака: облако набегает на солнце, а не наоборот
    disc.userData.backdrop = true;
    sky.add(disc);
  }

  sunDir = sun;
  // Порядок картинок у облаков свой, как у забора: зерно деревьев не сбивается.
  const load = async (name) => {
    const aspects = await (await fetch(`assets/textures/${name}.json`)).json();
    const files = aspects.map((_, i) => `assets/textures/${name}-${i + 1}.webp`);
    const maps = tiles(files);
    maps.forEach((m) => { m.wrapS = m.wrapT = THREE.ClampToEdgeWrapping; });
    const covers = await Promise.all(files.map(cover));
    return maps.map((map, i) => ({ map, aspect: aspects[i], cover: covers[i] }));
  };
  const [sides, belows] = await Promise.all([load('cloud'), load('cloud-below')]);
  const rnd = generator(11);
  for (let i = 0; i < CLOUD_COUNT; i++) {
    const side = sides[i % sides.length], below = belows[i % belows.length];
    const material = (map) => new THREE.MeshBasicMaterial({ map, transparent: true, toneMapped: false, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(CLOUDS, CLOUDS / side.aspect), material(side.map));
    const belly = new THREE.Mesh(new THREE.PlaneGeometry(CLOUDS, CLOUDS / below.aspect).rotateX(Math.PI / 2), material(below.map));
    mesh.userData.cover = side.cover;
    belly.userData.cover = below.cover;
    belly.userData.belly = true;
    const width = THREE.MathUtils.lerp(...CLOUD_WIDTH, rnd());
    clouds.push({ mesh, belly, width, x: (rnd() * 2 - 1) * SPREAD, z: (rnd() * 2 - 1) * SPREAD });
    sky.add(mesh, belly);
  }
  driftClouds(0);
  return sky;
}

// Карта непрозрачности картинки облака: COVER точек, строки сверху вниз.
async function cover(file) {
  const image = await new THREE.ImageLoader().loadAsync(file);
  const [w, h] = COVER, canvas = new OffscreenCanvas(w, h), ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  return Float32Array.from({ length: w * h }, (_, i) => data[4 * i + 3] / 255);
}

// Сколько облака на солнце у картинки plane: луч от двора к солнцу в осях картинки, где он проходит
// её плоскость (у бокового облака — z = 0, у брюха — y = 0), и непрозрачность там.
const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _inv = new THREE.Matrix4();
function shade(plane) {
  plane.updateMatrixWorld();
  _inv.copy(plane.matrixWorld).invert();
  _o.set(0, 0, 0).applyMatrix4(_inv);
  _d.copy(sunDir).multiplyScalar(RADIUS).applyMatrix4(_inv).sub(_o);
  const across = plane.userData.belly ? 'y' : 'z';
  const t = -_o[across] / _d[across];
  if (!(t > 0)) return 0;
  const { width, height } = plane.geometry.parameters;
  const u = (_o.x + t * _d.x) / width + 0.5, v = (across === 'z' ? _o.y + t * _d.y : _o.z + t * _d.z) / height + 0.5;
  if (u < 0 || u >= 1 || v < 0 || v >= 1) return 0;
  const [w, h] = COVER;
  return plane.userData.cover[Math.floor((1 - v) * h) * w + Math.floor(u * w)] * plane.material.opacity;
}

// Какая доля солнечного света доходит до двора: 1 — солнце чистое, около 0,1 — за плотным облаком.
export const sunlight = () => light;

const wrap = (v) => ((((v + SPREAD) % (2 * SPREAD)) + 2 * SPREAD) % (2 * SPREAD)) - SPREAD;
const to = new THREE.Vector3();
export function driftClouds(dt) {
  for (const cloud of clouds) {
    cloud.x = wrap(cloud.x + wind.dir.x * CLOUD_SPEED * dt);
    cloud.z = wrap(cloud.z + wind.dir.z * CLOUD_SPEED * dt);
    const far = Math.hypot(cloud.x, cloud.z), fade = 1 - THREE.MathUtils.smoothstep(far, FADE * SPREAD, SPREAD);
    const { mesh, belly } = cloud;
    const distance = to.set(cloud.x, LAYER, cloud.z).length();
    const up = THREE.MathUtils.smoothstep(Math.asin(LAYER / distance), ...OVERHEAD);
    for (const [plane, share] of [[mesh, 1 - up], [belly, up]]) {
      plane.visible = fade * share > 0;
      if (!plane.visible) continue;
      plane.position.copy(to).multiplyScalar(CLOUDS / distance);
      plane.scale.setScalar(cloud.width / distance);
      plane.material.opacity = fade * share;
      plane.renderOrder = -distance; // ближнее облако заслоняет дальнее
    }
    mesh.lookAt(0, 0, 0);
    belly.rotation.y = Math.atan2(-wind.dir.x, -wind.dir.z);
  }
  // Свет солнца — сквозь все облака, что сейчас на нём. Картинку, далёкую от солнца, не проверяем:
  // она закрывает на небе не больше atan(scale) от своей середины.
  light = 1;
  for (const { mesh, belly } of clouds) {
    for (const plane of [mesh, belly]) {
      if (plane.visible && plane.position.dot(sunDir) > CLOUDS * Math.cos(Math.atan(plane.scale.x))) light *= 1 - THICK * shade(plane);
    }
  }
}
