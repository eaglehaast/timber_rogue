import * as THREE from 'three';
import { readModel } from '../src/scan.js';

// Браузерная половина tools/scan.mjs: рисует шесть видов скана для ChatGPT и запекает его ответ в развёртку.
// Виды — грани куба вокруг предмета, ортогонально, все в одном масштабе, листом 3 × 2 клетки:
// сверху спереди, справа, сзади; снизу слева, сверху, снизу. Откуда смотрит камера и где у неё верх:
const VIEWS = [[[0, 0, 1], [0, 1, 0]], [[1, 0, 0], [0, 1, 0]], [[0, 0, -1], [0, 1, 0]],
  [[-1, 0, 0], [0, 1, 0]], [[0, 1, 0], [0, 0, -1]], [[0, -1, 0], [0, 0, 1]]];
const CELL = 512;  // точек на клетку листа: ChatGPT отдаёт 1536 × 1024
const SHARP = 4;   // степень косинуса: вид красит грани, что смотрят на него, — чем выше, тем резче переход между видами
const HIDDEN = 0.02; // вес вида, которому точку заслоняет другая часть предмета: берётся, только если её не видит никто
const DEPTH = 0.01;  // запас по глубине (доля куба), чтобы точка не заслоняла сама себя

// Камеры видов: куб со стороной чуть больше самого большого размера предмета, вокруг середины его коробки.
function cameras(geometry) {
  const box = geometry.boundingBox, mid = box.getCenter(new THREE.Vector3()), side = 1.05 * Math.max(...box.getSize(new THREE.Vector3()).toArray());
  return VIEWS.map(([from, up]) => {
    const camera = new THREE.OrthographicCamera(-side / 2, side / 2, side / 2, -side / 2, 0, 2 * side);
    camera.position.copy(mid).addScaledVector(new THREE.Vector3(...from), side);
    camera.up.set(...up);
    camera.lookAt(mid);
    camera.updateMatrixWorld();
    return camera;
  });
}

function renderer(width, height) {
  const r = new THREE.WebGLRenderer({ preserveDrawingBuffer: true, alpha: true });
  r.setPixelRatio(1);
  r.setSize(width, height);
  return r;
}

// Каждый вид — в свою клетку листа (клетка 0 — левая верхняя).
function sheet(r, scene, list, cell, target = null) {
  r.setRenderTarget(target);
  r.setScissorTest(true);
  list.forEach((camera, i) => {
    const x = (i % 3) * cell, y = (1 - Math.floor(i / 3)) * cell;
    r.setViewport(x, y, cell, cell);
    r.setScissor(x, y, cell, cell);
    r.render(scene, camera);
  });
  r.setScissorTest(false);
  r.setRenderTarget(null);
  r.setViewport(0, 0, r.domElement.width, r.domElement.height);
}

const load = async (url) => {
  const texture = await new THREE.TextureLoader().loadAsync(url);
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
};

// Шесть видов скана с его фотографией, без света — картинка для ChatGPT.
export async function views(model, photo) {
  const geometry = await readModel(model);
  const scene = new THREE.Scene().add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: await load(photo), side: THREE.DoubleSide })));
  const r = renderer(3 * CELL, 2 * CELL);
  r.setClearColor(0xffffff, 1);
  sheet(r, scene, cameras(geometry), CELL);
  return r.domElement.toDataURL('image/png');
}

// Лист видов от ChatGPT → развёртка скана size × size. Каждую точку поверхности красят виды, на которые она
// смотрит, — по косинусу в степени SHARP; вид, где её заслоняет другая часть предмета (внутренняя стенка ванны
// с боков), почти не красит. Глубину видов рисуем тем же листом.
export async function bake(model, picture, size) {
  const geometry = await readModel(model), list = cameras(geometry);
  const drawn = await new THREE.TextureLoader().loadAsync(picture);
  const { width, height } = drawn.image;
  if (Math.abs(width / height - 1.5) > 0.02) throw new Error(`лист от ChatGPT ${width} × ${height}, а нужен 3 : 2`);
  const r = renderer(size, size);
  const depths = new THREE.WebGLRenderTarget(3 * CELL, 2 * CELL);
  const solid = new THREE.Mesh(geometry, new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide }));
  sheet(r, new THREE.Scene().add(solid), list, CELL, depths);

  const paint = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: {
      drawn: { value: drawn }, depths: { value: depths.texture },
      views: { value: list.map((c) => c.projectionMatrix.clone().multiply(c.matrixWorldInverse)) },
      dirs: { value: VIEWS.map(([from]) => new THREE.Vector3(...from)) },
    },
    // Развёртка во весь кадр: v glTF идёт от верхнего края картинки.
    vertexShader: `varying vec3 vPos; varying vec3 vNormal;
      void main() { vPos = position; vNormal = normal; gl_Position = vec4(uv.x * 2. - 1., 1. - uv.y * 2., 0., 1.); }`,
    fragmentShader: `#include <packing>
      uniform sampler2D drawn, depths; uniform mat4 views[6]; uniform vec3 dirs[6];
      varying vec3 vPos; varying vec3 vNormal;
      void main() {
        vec3 n = normalize(vNormal), sum = vec3(0.);
        float total = 0.;
        for (int i = 0; i < 6; i++) {
          vec3 p = (views[i] * vec4(vPos, 1.)).xyz * .5 + .5;
          vec2 at = (p.xy + vec2(float(i % 3), float(1 - i / 3))) / vec2(3., 2.);
          float w = pow(max(dot(n, dirs[i]), 0.), ${SHARP}.) * (p.z <= unpackRGBAToDepth(texture2D(depths, at)) + ${DEPTH} ? 1. : ${HIDDEN});
          sum += w * texture2D(drawn, at).rgb;
          total += w;
        }
        gl_FragColor = vec4(sum / total, 1.);
      }`,
  });
  r.setClearColor(0x000000, 0);
  const unwrapped = Object.assign(new THREE.Mesh(geometry, paint), { frustumCulled: false });
  r.render(new THREE.Scene().add(unwrapped), new THREE.Camera());

  // Поля вокруг островков развёртки — цветом ближнего края, чтобы при уменьшении картинки на стыках не проступал фон.
  const canvas = Object.assign(document.createElement('canvas'), { width: size, height: size }), ctx = canvas.getContext('2d');
  ctx.drawImage(r.domElement, 0, 0);
  const pixels = ctx.getImageData(0, 0, size, size);
  bleed(pixels.data, size, 16);
  ctx.putImageData(pixels, 0, 0);
  return canvas.toDataURL('image/webp', 0.9);
}

// passes раз: пустая точка берёт средний цвет закрашенных соседей. Что так и осталось пустым — непрозрачное.
function bleed(data, size, passes) {
  for (let pass = 0; pass < passes; pass++) {
    const was = data.slice();
    for (let i = 0; i < size * size; i++) {
      if (was[4 * i + 3]) continue;
      const x = i % size, near = [x > 0 && i - 1, x < size - 1 && i + 1, i - size, i + size].filter((j) => j !== false && j >= 0 && j < size * size && was[4 * j + 3]);
      if (!near.length) continue;
      for (let k = 0; k < 3; k++) data[4 * i + k] = near.reduce((s, j) => s + was[4 * j + k], 0) / near.length;
      data[4 * i + 3] = 255;
    }
  }
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
}
