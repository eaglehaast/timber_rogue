// Предмет двора по скану айфона (Polycam, Scaniverse, Object Capture → GLB) — в игру, в два шага.
// Зависимости: npm install --prefix tools; браузер — Playwright, что стоит в системе.
//
// node tools/scan.mjs prepare <скан.glb> <имя> [высота, м]
//   → assets/models/<имя>.glb — форма: один меш до TRIANGLES треугольников, метры, низ на нуле, середина основания
//     над началом координат; цвета в нём нет. Высота — если единицы скана не метры: предмет растянут до неё.
//   → <имя>-views.png рядом со сканом — шесть видов предмета с его фотографией, лист 3 × 2. Его — в ChatGPT
//     с промптом design/scan/scan-prompt.md (в project-files).
// node tools/scan.mjs bake <имя> <лист от ChatGPT> [сторона развёртки]
//   → assets/textures/scan-<имя>.webp — лист ChatGPT, спроецированный на развёртку скана (tools/scan-page.js).
//     Потом python3 tools/half.py и строка в SCANS (src/scan.js).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { NodeIO, VertexLayout } from '@gltf-transform/core';
import { dedup, dequantize, flatten, join, weld, normals, simplify, prune, transformMesh, getBounds } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

// Playwright — системный, со своим браузером: из папки tools его найдёт только require.
const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = path.resolve(import.meta.dirname, '..');
const TRIANGLES = 20000;
const KEEP = ['POSITION', 'NORMAL', 'TEXCOORD_0'];
const TYPES = { '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };

// Вызвать функцию fn из tools/scan-page.js в браузере. Страница видит файлы репозитория и files — { путь: байты }.
async function browse(files, fn, ...args) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  files['/'] = '<script type="importmap">{ "imports": { "three": "/vendor/three.module.min.js" } }</script>';
  await page.route('http://scan.local/**', (route) => {
    const at = decodeURIComponent(new URL(route.request().url()).pathname), file = path.join(ROOT, at);
    const body = files[at] ?? (fs.existsSync(file) ? fs.readFileSync(file) : null);
    return body === null ? route.fulfill({ status: 404 }) : route.fulfill({ body, contentType: TYPES[path.extname(at)] ?? 'text/html' });
  });
  page.on('pageerror', (e) => console.error(e));
  page.on('console', (m) => m.type() === 'error' && console.error(m.text()));
  await page.goto('http://scan.local/');
  try {
    return await page.evaluate(async ([fn, args]) => (await import('/tools/scan-page.js'))[fn](...args), [fn, args]);
  } finally {
    await browser.close();
  }
}

const save = (file, url) => fs.writeFileSync(file, Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));

async function prepare(scan, name, tall) {
  // Атрибуты вершин — каждый своим куском, не вперемешку: так GLB читает readModel в src/scan.js.
  const io = new NodeIO().setVertexLayout(VertexLayout.SEPARATE), doc = await io.read(scan), root = doc.getRoot();
  await MeshoptSimplifier.ready;
  await doc.transform(dequantize(), dedup(), flatten(), join(), weld());
  const meshes = root.listMeshes(), [mesh] = meshes, [prim] = mesh.listPrimitives();
  if (meshes.length > 1 || mesh.listPrimitives().length > 1) throw new Error('в скане несколько частей или материалов, нужен один меш с одной текстурой');
  const texture = prim.getMaterial()?.getBaseColorTexture();
  if (!texture) throw new Error('в скане нет цветной текстуры');
  const photo = Buffer.from(texture.getImage());
  // Положение узла — в вершины, лишние атрибуты (цвет вершин, второй канал развёртки) — прочь.
  const node = root.listNodes().find((n) => n.getMesh() === mesh);
  transformMesh(mesh, node.getWorldMatrix());
  node.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
  for (const semantic of prim.listSemantics()) if (!KEEP.includes(semantic)) prim.setAttribute(semantic, null);
  const before = prim.getIndices().getCount() / 3;
  await doc.transform(normals({ overwrite: false }), simplify({ simplifier: MeshoptSimplifier, ratio: Math.min(1, TRIANGLES / before), error: 0.01 }));
  const { min, max } = getBounds(root.getDefaultScene() ?? root.listScenes()[0]), s = tall ? tall / (max[1] - min[1]) : 1;
  const [cx, cz] = [(min[0] + max[0]) / 2, (min[2] + max[2]) / 2];
  transformMesh(mesh, [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, -cx * s, -min[1] * s, -cz * s, 1]);
  prim.setMaterial(null);
  for (const t of root.listTextures()) t.dispose();
  await doc.transform(prune());
  const model = path.join(ROOT, 'assets/models', `${name}.glb`);
  fs.mkdirSync(path.dirname(model), { recursive: true });
  fs.writeFileSync(model, await io.writeBinary(doc));
  const size = (max.map((v, i) => (v - min[i]) * s)).map((v) => v.toFixed(2)).join(' × ');
  console.log(`${model}: ${before} → ${prim.getIndices().getCount() / 3} треугольников, ${size} м (ширина × высота × глубина)`);
  const views = path.join(path.dirname(scan), `${name}-views.png`);
  save(views, await browse({ '/work/model.glb': fs.readFileSync(model), '/work/photo': photo }, 'views', '/work/model.glb', '/work/photo'));
  console.log(`${views}: виды для ChatGPT`);
}

async function bake(name, picture, size = 1024) {
  const out = path.join(ROOT, 'assets/textures', `scan-${name}.webp`);
  save(out, await browse({ '/work/picture': fs.readFileSync(picture) }, 'bake', `/assets/models/${name}.glb`, '/work/picture', Number(size)));
  console.log(`${out}: развёртка; дальше python3 tools/half.py`);
}

const [command, ...args] = process.argv.slice(2);
await { prepare, bake }[command](...args);
