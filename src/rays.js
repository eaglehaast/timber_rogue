import * as THREE from 'three';
import { wind } from './wind.js';

// Лучи солнца в воздухе — как сквозь листву, когда светит в глаза, — и пылинки, что в них блестят.
// Лучи считаем по экрану (радиальное размытие, GPU Gems 3, гл. 13): рисуем маленькую маску — сцену
// чёрным, а за ней сияние вокруг солнца; там, где солнце видно в просветах листвы, маска светлая.
// Затем от каждой точки экрана идём к солнцу и копим свет маски, ослабляя его с каждым шагом: просветы
// вытягиваются в лучи от солнца. Лучи кладём поверх кадра. Облако на солнце гасит их вместе со светом.
// Пылинки — точки в воздухе вокруг глаз: видны там, где на них падает луч, по той же картинке лучей.
const SCALE = 4;           // маска и лучи мельче экрана во столько раз по каждой стороне
const SAMPLES = 64;        // шагов от точки к солнцу
const REACH = 0.9;         // какую долю пути до солнца проходят шаги
const DECAY = 0.98;       // столько света остаётся от шага к шагу
const EXPOSURE = 0.035;     // яркость лучей
const WARM = new THREE.Color(1.0, 0.86, 0.62);
const GLOW = THREE.MathUtils.degToRad(11); // угловой радиус сияния вокруг солнца в маске
const SKY = 148;           // м — сияние стоит на небе, за всем, что есть во дворе
const MOTES = 4000, BOX = 6; // пылинок в кубе BOX м вокруг глаз
const MOTE_GLOW = 14;      // во сколько раз пылинка в луче ярче самого луча

// Число в тексте шейдера: у дробного GLSL нужна точка (3 → 3.0).
const glsl = (x) => (Number.isInteger(x) ? `${x}.0` : `${x}`);
const quad = () => new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
const FLAT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

// Та же поверхность, но чёрная: с той же формой (ветер, рельеф) и той же прозрачностью (листья, облака).
const occluders = new WeakMap();
function occluder(material) {
  let black = occluders.get(material);
  if (!black) {
    black = material.clone();
    black.onBeforeCompile = (shader, renderer) => {
      material.onBeforeCompile(shader, renderer);
      shader.fragmentShader = shader.fragmentShader.replace(/}\s*$/, '  gl_FragColor.rgb = vec3(0.0);\n}');
    };
    black.customProgramCacheKey = () => `${material.customProgramCacheKey()}|occluder`;
    occluders.set(material, black);
  }
  black.opacity = material.opacity;
  return black;
}

export class Rays {
  constructor(renderer, scene, sun) {
    Object.assign(this, { renderer, scene, sun: sun.clone().normalize() });
    this.mask = new THREE.WebGLRenderTarget(1, 1);
    this.rays = new THREE.WebGLRenderTarget(1, 1);
    this.flat = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // Сияние: яркий диск, к краю гаснет. Стоит на небе по направлению солнца, лицом ко двору; видно
    // только в маске. В очереди — перед облаками: облако, набежавшее на солнце, его заслоняет.
    const size = 2 * SKY * Math.tan(GLOW);
    this.glow = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.ShaderMaterial({
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'varying vec2 vUv; void main() { float d = length(vUv - 0.5) * 2.0; gl_FragColor = vec4(vec3(pow(max(0.0, 1.0 - d), 3.0)), 1.0); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.glow.position.copy(this.sun).multiplyScalar(SKY);
    this.glow.lookAt(0, 0, 0);
    this.glow.renderOrder = -Infinity;
    this.glow.visible = false;
    scene.add(this.glow);

    this.blur = new THREE.Mesh(quad().geometry, new THREE.ShaderMaterial({
      uniforms: { mask: { value: this.mask.texture }, sun: { value: new THREE.Vector2() } },
      vertexShader: FLAT,
      fragmentShader: `
        uniform sampler2D mask; uniform vec2 sun; varying vec2 vUv;
        void main() {
          vec2 step = (sun - vUv) * (${glsl(REACH)} / ${glsl(SAMPLES)}), at = vUv;
          float light = 0.0, left = 1.0;
          for (int i = 0; i < ${SAMPLES}; i++) { light += texture2D(mask, at).r * left; left *= ${glsl(DECAY)}; at += step; }
          gl_FragColor = vec4(vec3(light * ${glsl(EXPOSURE)}), 1.0);
        }`,
      depthTest: false, depthWrite: false,
    }));
    this.blur.frustumCulled = false;
    this.blurScene = new THREE.Scene().add(this.blur);

    const over = { depthTest: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending, toneMapped: false };
    this.shafts = new THREE.Mesh(quad().geometry, new THREE.ShaderMaterial({
      uniforms: { rays: { value: this.rays.texture }, strength: { value: 0 }, warm: { value: WARM } },
      vertexShader: FLAT,
      fragmentShader: 'uniform sampler2D rays; uniform float strength; uniform vec3 warm; varying vec2 vUv; void main() { gl_FragColor = vec4(warm * texture2D(rays, vUv).r * strength, 1.0); }',
      ...over,
    }));
    this.shafts.frustumCulled = false;

    // Пылинки: место каждой — в кубе BOX, который ездит с глазами (шейдер переносит её на ту сторону
    // куба, откуда она ушла), её несёт ветер и покачивает воздух.
    const at = new Float32Array(MOTES * 3).map(() => Math.random() * BOX);
    const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(at, 3));
    this.motes = new THREE.Points(geometry, new THREE.ShaderMaterial({
      uniforms: {
        rays: { value: this.rays.texture }, strength: { value: 0 }, warm: { value: WARM },
        eye: { value: new THREE.Vector3() }, drift: { value: new THREE.Vector3() }, time: { value: 0 }, scale: { value: 1 },
      },
      vertexShader: `
        uniform vec3 eye, drift; uniform float time, scale; varying float near;
        void main() {
          vec3 sway = 0.08 * sin(time * vec3(0.7, 0.5, 0.9) + position.yzx * 3.0);
          vec3 p = mod(position + drift + sway - eye + ${glsl(BOX / 2)}, ${glsl(BOX)}) - ${glsl(BOX / 2)} + eye;
          vec4 view = modelViewMatrix * vec4(p, 1.0);
          near = 1.0 - smoothstep(${glsl(BOX / 4)}, ${glsl(BOX / 2)}, length(p - eye));
          gl_PointSize = clamp(0.004 * scale / -view.z, 1.0, 2.5);
          gl_Position = projectionMatrix * view;
        }`,
      fragmentShader: `
        uniform sampler2D rays; uniform float strength; uniform vec3 warm; uniform vec2 size; varying float near;
        void main() {
          float shaft = texture2D(rays, gl_FragCoord.xy / size).r;
          gl_FragColor = vec4(warm * shaft * strength * ${glsl(MOTE_GLOW)} * near, 1.0);
        }`,
      ...over, depthTest: true,
    }));
    this.motes.material.uniforms.size = { value: new THREE.Vector2() };
    this.motes.frustumCulled = false;
    this.overlay = new THREE.Scene().add(this.shafts, this.motes);
  }

  setSize(width, height) {
    this.mask.setSize(Math.ceil(width / SCALE), Math.ceil(height / SCALE));
    this.rays.setSize(Math.ceil(width / SCALE), Math.ceil(height / SCALE));
    this.motes.material.uniforms.size.value.set(width, height);
    this.motes.material.uniforms.scale.value = height;
  }

  // Поверх кадра камеры camera, уже нарисованного на экране. light — какая доля солнца проходит сквозь облака.
  render(camera, light, dt) {
    const { renderer, scene } = this;
    const sun = this.glow.getWorldPosition(new THREE.Vector3()).project(camera);
    // Солнце за спиной или далеко за краем кадра — лучей на экране нет: им не из чего тянуться.
    if (light <= 0 || sun.z > 1 || Math.max(Math.abs(sun.x), Math.abs(sun.y)) > 2) return;

    const swapped = [], hidden = [];
    scene.traverse((o) => {
      if (o.userData.backdrop && o.visible) {
        hidden.push(o);
        o.visible = false;
      } else if (o.material && o !== this.glow) {
        swapped.push([o, o.material]);
        o.material = Array.isArray(o.material) ? o.material.map(occluder) : occluder(o.material);
      }
    });
    this.glow.visible = true;
    const clear = renderer.getClearColor(new THREE.Color()), alpha = renderer.getClearAlpha();
    const autoUpdate = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.setClearColor(0x000000, 1);
    renderer.setRenderTarget(this.mask);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.shadowMap.autoUpdate = autoUpdate;
    renderer.setClearColor(clear, alpha);
    this.glow.visible = false;
    for (const [o, material] of swapped) o.material = material;
    for (const o of hidden) o.visible = true;

    this.blur.material.uniforms.sun.value.set(sun.x * 0.5 + 0.5, sun.y * 0.5 + 0.5);
    renderer.setRenderTarget(this.rays);
    renderer.render(this.blurScene, this.flat);
    renderer.setRenderTarget(null);

    const motes = this.motes.material.uniforms;
    motes.time.value += dt;
    motes.drift.value.addScaledVector(wind.dir, 0.15 * dt);
    motes.eye.value.copy(camera.position);
    motes.strength.value = this.shafts.material.uniforms.strength.value = light;
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.overlay, camera);
    renderer.autoClear = autoClear;
  }
}
