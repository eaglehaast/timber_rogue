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
const LAYER = 1500, SPREAD = 10000, FADE = 0.6; // м; таять начинают с FADE·SPREAD
const CLOUD_COUNT = 160, CLOUD_SPEED = 12;       // штук на весь слой; м/с
const CLOUD_WIDTH = [700, 2000];                // м
const clouds = [];

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
  sky.add(dome);

  // Луна в первой четверти: стоит на 90° восточнее солнца, левее его, и освещённым правым боком смотрит на него.
  const moon = sun.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2).setY(0.4).normalize();
  for (const disc of [picture(sunMap, sun, DISCS, deg(5)), picture(moonMap, moon, DISCS, deg(4))]) {
    disc.renderOrder = -2 * SPREAD; // дальше любого облака: облако набегает на солнце, а не наоборот
    sky.add(disc);
  }

  // Порядок картинок у облаков свой, как у забора: зерно деревьев не сбивается.
  const aspects = await (await fetch('assets/textures/clouds.json')).json();
  const maps = tiles(aspects.map((_, i) => `assets/textures/cloud-${i + 1}.webp`));
  maps.forEach((m) => { m.wrapS = m.wrapT = THREE.ClampToEdgeWrapping; });
  const rnd = generator(11);
  for (let i = 0; i < CLOUD_COUNT; i++) {
    const n = i % maps.length;
    const mesh = picture(maps[n], new THREE.Vector3(0, 1, 0), CLOUDS, 1, aspects[n]);
    const width = THREE.MathUtils.lerp(...CLOUD_WIDTH, rnd());
    clouds.push({ mesh, width, x: (rnd() * 2 - 1) * SPREAD, z: (rnd() * 2 - 1) * SPREAD });
    sky.add(mesh);
  }
  driftClouds(0);
  return sky;
}

const wrap = (v) => ((((v + SPREAD) % (2 * SPREAD)) + 2 * SPREAD) % (2 * SPREAD)) - SPREAD;
const to = new THREE.Vector3();
export function driftClouds(dt) {
  for (const cloud of clouds) {
    cloud.x = wrap(cloud.x + wind.dir.x * CLOUD_SPEED * dt);
    cloud.z = wrap(cloud.z + wind.dir.z * CLOUD_SPEED * dt);
    const far = Math.hypot(cloud.x, cloud.z), fade = 1 - THREE.MathUtils.smoothstep(far, FADE * SPREAD, SPREAD);
    const { mesh } = cloud;
    mesh.visible = fade > 0;
    if (!mesh.visible) continue;
    const distance = to.set(cloud.x, LAYER, cloud.z).length();
    mesh.position.copy(to).multiplyScalar(CLOUDS / distance);
    mesh.scale.setScalar(cloud.width / distance);
    mesh.lookAt(0, 0, 0);
    mesh.material.opacity = fade;
    mesh.renderOrder = -distance; // ближнее облако заслоняет дальнее
  }
}
