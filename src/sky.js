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
const CLOUD_WIDTH = [600, 1600];                // м: крупнее — на низком солнце облака стоят гуще и закрывают его надолго
const OVERHEAD = [deg(45), deg(65)];            // высота над горизонтом: от вида сбоку к виду снизу
const clouds = [];
// Облако закрывает солнце не как ставня. Край кучевого облака рыхлый: чем глубже от края, тем больше
// в нём капель, и свет проходит сквозь толщу капель на долю exp(−толща) — закон Бугера — Ламберта.
// Поэтому, когда облако наползает на солнце, свет гаснет секунд за 10–25, а не мигом.
// Толща облака на пути к солнцу — непрозрачность его картинки там, размытая на SOFT ширины облака
// (рыхлый край), умноженная на DEPTH: плотное тело пропускает десятую часть света.
const DEPTH = Math.log(10);
const SOFT = 0.06;
const COVER = [64, 32]; // столько точек по ширине и высоте картинки у карты толщи облака
// Размываем дважды на BLUR точек: размытое выходит за края картинки на 2·BLUR — облако на ней бывает
// срезано краем, а настоящее у края не обрывается. Карта поэтому шире картинки на поле PAD с каждой стороны.
const BLUR = Math.round(SOFT * COVER[0]), PAD = 2 * BLUR;
const MAP = [COVER[0] + 2 * PAD, COVER[1] + 2 * PAD];

// Тень облака бежит по земле со скоростью ветра: её край переходит двор за секунды и ползёт по горам,
// а не гасит весь мир разом. Смотрим на слой облаков со стороны солнца — камерой вдоль его луча — и рисуем
// каждое облако его толщей: получается картинка света, сколько солнца проходит в каждом месте. Точка мира
// берёт свет оттуда, куда её переносит луч солнца. Солнце у нас низко (22°): к нему облако повёрнуто боком,
// поэтому тень отбрасывает картинка сбоку, а не снизу.
// Освещение всех материалов three.js умножает солнце на этот свет (вставка в шейдеры ниже).
const SHADE_SIZE = 256, SHADE_HALF = 3500; // точек на сторону картинки света; м от её середины до края
const shadeCamera = new THREE.OrthographicCamera(-SHADE_HALF, SHADE_HALF, SHADE_HALF, -SHADE_HALF, 1, 40000);
const shadeScene = new THREE.Scene();
const shadeTarget = new THREE.WebGLRenderTarget(SHADE_SIZE, SHADE_SIZE, { depthBuffer: false });
const cloudShade = { map: shadeTarget.texture, matrix: new THREE.Matrix4() };
const QUAD = new THREE.PlaneGeometry(1, 1);
const SHADE_FRAGMENT = `uniform sampler2D map; uniform float fade; varying vec2 vUv;
  void main() { gl_FragColor = vec4(vec3(exp(-${DEPTH} * fade * texture2D(map, vec2(vUv.x, 1.0 - vUv.y)).r)), 1.0); }`;

// Вставка в шейдеры three.js: точка мира (vCloudWorld) и свет облаков в ней (cloudLight) умножают солнце —
// единственный направленный свет с тенью. Картинка панорамы изображает землю вдали, а стоит близко:
// её точку отодвигаем во столько раз, во сколько изображённое дальше (CLOUD_FAR, panorama.js).
// Значение uniform — общий объект: three.js копирует его ссылкой, и все материалы видят одну картинку света.
THREE.ShaderChunk.common += `
#ifdef USE_SHADOWMAP
varying vec3 vCloudWorld;
#endif`;
THREE.ShaderChunk.worldpos_vertex += `
#ifdef USE_SHADOWMAP
  vCloudWorld = worldPosition.xyz;
  #ifdef CLOUD_FAR
    vCloudWorld.xz *= CLOUD_FAR;
  #endif
#endif`;
THREE.ShaderChunk.lights_pars_begin += `
#ifdef USE_SHADOWMAP
uniform struct CloudShade { sampler2D map; mat4 matrix; } cloudShade;
float cloudLight() {
  vec4 at = cloudShade.matrix * vec4(vCloudWorld, 1.0);
  return texture2D(cloudShade.map, at.xy * 0.5 + 0.5).r;
}
#endif`;
const SUN_SHADOW = 'vDirectionalShadowCoord[ i ] ) : 1.0;';
if (!THREE.ShaderChunk.lights_fragment_begin.includes(SUN_SHADOW)) throw new Error('sky.js: в three.js сменился шейдер света');
THREE.ShaderChunk.lights_fragment_begin = THREE.ShaderChunk.lights_fragment_begin
  .replace(SUN_SHADOW, `${SUN_SHADOW}\n\t\tdirectLight.color *= cloudLight();`);
for (const name of ['lambert', 'phong', 'standard', 'physical', 'toon']) THREE.ShaderLib[name].uniforms.cloudShade = { value: cloudShade };

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

  // Порядок картинок у облаков свой, как у забора: зерно деревьев не сбивается.
  const load = async (name) => {
    const aspects = await (await fetch(`assets/textures/${name}.json`)).json();
    const files = aspects.map((_, i) => `assets/textures/${name}-${i + 1}.webp`);
    const maps = tiles(files);
    maps.forEach((m) => { m.wrapS = m.wrapT = THREE.ClampToEdgeWrapping; });
    return maps.map((map, i) => ({ map, aspect: aspects[i], file: files[i] }));
  };
  const [sides, belows] = await Promise.all([load('cloud'), load('cloud-below')]);
  // Толща облака — по картинке сбоку: такой его видит низкое солнце.
  const thick = await Promise.all(sides.map(({ file }) => cover(file)));
  const shadeMaps = thick.map((map) => {
    const texture = new THREE.DataTexture(Uint8Array.from(map, (a) => Math.round(255 * a)), ...MAP, THREE.RedFormat);
    texture.magFilter = texture.minFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
  });
  shadeCamera.position.copy(sun).multiplyScalar(LAYER / sun.y + 20000);
  shadeCamera.lookAt(sun.clone().multiplyScalar(LAYER / sun.y));
  shadeCamera.updateMatrixWorld();
  cloudShade.matrix.multiplyMatrices(shadeCamera.projectionMatrix, shadeCamera.matrixWorldInverse);
  const rnd = generator(11);
  for (let i = 0; i < CLOUD_COUNT; i++) {
    const side = sides[i % sides.length], below = belows[i % belows.length];
    const material = (map) => new THREE.MeshBasicMaterial({ map, transparent: true, toneMapped: false, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(CLOUDS, CLOUDS / side.aspect), material(side.map));
    const belly = new THREE.Mesh(new THREE.PlaneGeometry(CLOUDS, CLOUDS / below.aspect).rotateX(Math.PI / 2), material(below.map));
    const width = THREE.MathUtils.lerp(...CLOUD_WIDTH, rnd());
    // Тень: картинка толщи с полями, лицом к солнцу, в настоящую величину облака.
    const k = i % sides.length;
    const shadow = new THREE.Mesh(QUAD, new THREE.ShaderMaterial({
      uniforms: { map: { value: shadeMaps[k] }, fade: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: SHADE_FRAGMENT,
      blending: THREE.MultiplyBlending, premultipliedAlpha: true, transparent: true, depthTest: false, depthWrite: false,
    }));
    shadow.quaternion.copy(shadeCamera.quaternion);
    shadow.scale.set(width * MAP[0] / COVER[0], (width / side.aspect) * MAP[1] / COVER[1], 1);
    shadeScene.add(shadow);
    clouds.push({ mesh, belly, shadow, thick: thick[k], width, fade: 0, x: (rnd() * 2 - 1) * SPREAD, z: (rnd() * 2 - 1) * SPREAD });
    sky.add(mesh, belly);
  }
  driftClouds(0);
  return sky;
}

// Карта толщи облака: непрозрачность картинки в COVER точках (строки сверху вниз) посреди поля PAD,
// размытая на SOFT её ширины. Размываем дважды средним по отрезку — вдоль и поперёк: получается мягкий
// холм, а не ступень.
async function cover(file) {
  const image = await new THREE.ImageLoader().loadAsync(file);
  const [w, h] = MAP, canvas = new OffscreenCanvas(w, h), ctx = canvas.getContext('2d');
  ctx.drawImage(image, PAD, PAD, ...COVER);
  const data = ctx.getImageData(0, 0, w, h).data;
  let map = Float32Array.from({ length: w * h }, (_, i) => data[4 * i + 3] / 255);
  const along = (src, dx, dy) => src.map((_, i) => {
    const x = i % w, y = (i - x) / w;
    let sum = 0;
    for (let k = -BLUR; k <= BLUR; k++) {
      const X = x + k * dx, Y = y + k * dy;
      if (X >= 0 && X < w && Y >= 0 && Y < h) sum += src[Y * w + X];
    }
    return sum / (2 * BLUR + 1);
  });
  for (let pass = 0; pass < 2; pass++) map = along(along(map, 1, 0), 0, 1);
  return map;
}

// Какая доля солнечного света доходит до точки p: 1 — солнце чистое, около 0,1 — за плотным облаком.
// Та же картинка света, что у шейдеров, только посчитанная здесь: луч от p к солнцу проходит слой
// облаков, и каждое облако на нём добавляет свою толщу — по его карте, между её точками плавно.
const _p = new THREE.Vector3(), _c = new THREE.Vector3();
export function sunlight(p) {
  const view = shadeCamera.matrixWorldInverse, [w, h] = MAP;
  _p.copy(p).applyMatrix4(view);
  let depth = 0;
  for (const { shadow, thick, fade, x: cx, z: cz } of clouds) {
    if (!fade) continue;
    _c.set(cx, LAYER, cz).applyMatrix4(view);
    const x = ((_p.x - _c.x) / shadow.scale.x + 0.5) * w - 0.5, y = (0.5 - (_p.y - _c.y) / shadow.scale.y) * h - 0.5;
    if (x < 0 || x >= w - 1 || y < 0 || y >= h - 1) continue;
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const row = (y) => thick[y * w + x0] * (1 - fx) + thick[y * w + x0 + 1] * fx;
    depth += DEPTH * fade * (row(y0) * (1 - fy) + row(y0 + 1) * fy);
  }
  return Math.exp(-depth);
}

// Картинка света облаков для шейдеров: рисуем каждый кадр, облака плывут.
export function castShadows(renderer) {
  const clear = renderer.getClearColor(new THREE.Color()), alpha = renderer.getClearAlpha();
  renderer.setRenderTarget(shadeTarget);
  renderer.setClearColor(0xffffff, 1);
  renderer.clear();
  renderer.render(shadeScene, shadeCamera);
  renderer.setClearColor(clear, alpha);
  renderer.setRenderTarget(null);
}

const wrap = (v) => ((((v + SPREAD) % (2 * SPREAD)) + 2 * SPREAD) % (2 * SPREAD)) - SPREAD;
const to = new THREE.Vector3();
export function driftClouds(dt) {
  for (const cloud of clouds) {
    cloud.x = wrap(cloud.x + wind.dir.x * CLOUD_SPEED * dt);
    cloud.z = wrap(cloud.z + wind.dir.z * CLOUD_SPEED * dt);
    const far = Math.hypot(cloud.x, cloud.z), fade = 1 - THREE.MathUtils.smoothstep(far, FADE * SPREAD, SPREAD);
    const { mesh, belly, shadow } = cloud;
    cloud.fade = fade;
    shadow.position.set(cloud.x, LAYER, cloud.z);
    shadow.visible = fade > 0;
    shadow.material.uniforms.fade.value = fade;
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
}
