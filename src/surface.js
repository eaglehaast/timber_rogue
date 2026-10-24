import * as THREE from 'three';

// Поверхности из бесшовных фотографий: кора, трава. Картинки ложатся плиткой в мировом масштабе.
const loader = new THREE.TextureLoader();
export const tiles = (files) => files.map((file) => {
  const texture = loader.load(file);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
});

// Фотографическая текстура в игре слишком резкая и пёстрая: мелкая контрастная рябь мерцает и укачивает,
// а повтор плитки бросается в глаза. Поэтому фактуру смягчаем к среднему цвету картинки (его даёт
// самый мелкий мип-уровень), гасим насыщенность и кладём поверх крупные пятна тона — плавный шум
// по координатам текстуры двух размеров, scales — сколько ячеек шума на плитку. Пятна нигде
// не повторяются и разбивают плитку.
export function soften(material, { contrast, saturation, scales: [a, b], low, high }) {
  const vec3 = (c) => `vec3(${c.map((v) => v.toFixed(2)).join(', ')})`;
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        float softHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float softNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(softHash(i), softHash(i + vec2(1, 0)), f.x),
                     mix(softHash(i + vec2(0, 1)), softHash(i + vec2(1, 1)), f.x), f.y);
        }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        #ifdef USE_MAP
          vec3 softMean = textureLod(map, vMapUv, 12.0).rgb * diffuse;
          diffuseColor.rgb = mix(softMean, diffuseColor.rgb, ${contrast.toFixed(2)});
          float softLuma = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
          diffuseColor.rgb = mix(vec3(softLuma), diffuseColor.rgb, ${saturation.toFixed(2)});
          float tone = 0.6 * softNoise(vMapUv * ${a.toFixed(2)}) + 0.4 * softNoise(vMapUv * ${b.toFixed(2)} + 7.0);
          diffuseColor.rgb *= mix(${vec3(low)}, ${vec3(high)}, tone);
        #endif`);
  };
  return material;
}
