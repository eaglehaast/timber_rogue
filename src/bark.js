import * as THREE from 'three';

// Кора ствола и ветвей. Текстура лежит в мировом масштабе: квадрат BARK_TILE метров.
// Чтобы плитка не бросалась в глаза, у каждого дерева своя картинка из нескольких, свой сдвиг
// и крупность, а поверх — крупные пятна тона, которые нигде не повторяются.
export const BARK_TILE = 0.4;
const FILES = [1, 2, 3, 4, 5].map((i) => `assets/textures/bark-${i}.jpg`);
// Насколько оставить фотографичность: контраст фактуры и насыщенность. Меньше — мягче и спокойнее.
const CONTRAST = 0.6;
const SATURATION = 0.8;

const loader = new THREE.TextureLoader();
const textures = FILES.map((file) => {
  const texture = loader.load(file);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
});

// Фактуру смягчаем к среднему цвету картинки (его даёт самый мелкий мип-уровень), потом
// кладём пятна тона — плавный шум по координатам текстуры: ячейки около метра и треть метра.
const soften = (shader) => {
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
      float barkHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float barkNoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(barkHash(i), barkHash(i + vec2(1, 0)), f.x),
                   mix(barkHash(i + vec2(0, 1)), barkHash(i + vec2(1, 1)), f.x), f.y);
      }`)
    .replace('#include <map_fragment>', `#include <map_fragment>
      #ifdef USE_MAP
        vec3 barkMean = textureLod(map, vMapUv, 12.0).rgb * diffuse;
        diffuseColor.rgb = mix(barkMean, diffuseColor.rgb, ${CONTRAST.toFixed(2)});
        float barkLuma = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        diffuseColor.rgb = mix(vec3(barkLuma), diffuseColor.rgb, ${SATURATION.toFixed(2)});
        float tone = 0.6 * barkNoise(vMapUv * 0.4) + 0.4 * barkNoise(vMapUv * 1.3 + 7.0);
        diffuseColor.rgb *= mix(vec3(0.78, 0.8, 0.76), vec3(1.1, 1.05, 1.0), tone);
      #endif`);
};

// Кора нового дерева, своя у каждого: какая из картинок, откуда начинается узор и насколько он крупный.
export function dressBark() {
  const map = textures[Math.floor(Math.random() * textures.length)].clone();
  const scale = 0.85 + Math.random() * 0.3;
  map.repeat.set(scale, scale);
  map.offset.set(Math.random(), Math.random());
  const material = new THREE.MeshLambertMaterial({ map });
  material.onBeforeCompile = soften;
  return material;
}
