// Координаты от левого верхнего угла поля. Размеры и смещения — в точках макета,
// вращение — в градусах вокруг центра элемента, масштаб и непрозрачность — в процентах.
export const fields = [
  ['x', 'X от левого края', -1600, 1600, 0.5], ['y', 'Y от верха', -920, 920, 0.5],
  ['scaleX', 'Ширина, %', 5, 400, 1], ['scaleY', 'Высота, %', 5, 400, 1],
  ['rotateX', 'Наклон X, °', -360, 360, 0.1], ['rotateY', 'Поворот Y, °', -360, 360, 0.1],
  ['rotateZ', 'Крен Z, °', -360, 360, 0.1], ['opacity', 'Непрозрачность, %', 0, 100, 1],
  ['layer', 'Слой', 0, 99, 1],
];
const imageID = /^image-[\w-]+$/;
const defaults = { scaleX: 100, scaleY: 100, rotateX: 0, rotateY: 0, rotateZ: 0, opacity: 100, layer: 3, visible: true, comment: '' };

export async function setupHud() {
  const response = await fetch('assets/hud/layout.json');
  if (!response.ok) throw new Error('Не удалось прочитать расстановку интерфейса');
  const base = await response.json();
  for (const [id, item] of Object.entries(base.elements)) {
    base.elements[id] = { ...defaults, ...item };
  }
  const stage = document.querySelector('#stage'), layer = document.querySelector('#hud');
  const resize = () => layer.style.setProperty('--hud-scale', Math.min(stage.clientWidth / base.viewport.width, stage.clientHeight / base.viewport.height));
  new ResizeObserver(resize).observe(stage);
  resize();

  function apply(layout, id) {
    const item = layout.elements[id];
    let el = document.getElementById(id);
    if (!el && item.kind === 'image' && imageID.test(id)) {
      el = document.createElement('div'); el.id = id; el.dataset.imageLayer = '';
      const img = new Image(); img.alt = item.name; img.draggable = false;
      el.append(img); layer.append(el);
    }
    el.classList.add('hud-object');
    el.classList.toggle('hud-art', item.kind === 'image');
    Object.assign(el.style, { left: `${item.x}px`, top: `${item.y}px`, width: `${item.width}px`, height: `${item.height}px`,
      transform: `perspective(700px) rotateZ(${item.rotateZ}deg) rotateY(${item.rotateY}deg) rotateX(${item.rotateX}deg) scale(${item.scaleX / 100}, ${item.scaleY / 100})`,
      zIndex: item.layer, opacity: item.opacity / 100 });
    el.toggleAttribute('data-layout-off', !item.visible);
    if (item.asset) {
      const img = el.querySelector('img'), src = layout.assets[item.asset].src;
      if (img.getAttribute('src') !== src) img.src = src;
    }
  }
  return { base, apply };
}

export function imageLayer(name, asset, width, height, viewport) {
  return { ...defaults, name, kind: 'image', asset, width, height,
    x: Math.round((viewport.width - width) / 2), y: Math.round((viewport.height - height) / 2), layer: 4 };
}

// В импортированном файле пути штатных рисунков принадлежат каталогу игры. Новые рисунки
// переносим прямо в файле, чтобы получатель видел тот же предмет без исходной папки автора.
export function readLayout(data, base) {
  if (data?.version !== base.version || data.viewport?.width !== base.viewport.width || data.viewport?.height !== base.viewport.height || !data.elements) {
    throw new Error('Нужна расстановка Timber Rogue для поля 800 × 460, версия 1.');
  }
  const layout = structuredClone(base);
  for (const [key, art] of Object.entries(data.assets ?? {})) {
    if (Object.hasOwn(base.assets, key)) continue;
    if (!/^local-[\w-]+$/.test(key) || typeof art?.name !== 'string' || typeof art.src !== 'string' || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(art.src)) throw new Error('Неизвестный формат рисунка.');
    layout.assets[key] = { name: art.name, src: art.src };
  }
  for (const [id, saved] of Object.entries(data.elements)) {
    if (!Object.hasOwn(base.elements, id)) {
      if (!imageID.test(id) || saved?.kind !== 'image' || typeof saved.name !== 'string' || !Object.hasOwn(layout.assets, saved.asset)
          || ![saved.width, saved.height].every(n => Number.isFinite(n) && n >= 1 && n <= 1600)) throw new Error(`Неизвестный элемент «${id}».`);
      layout.elements[id] = imageLayer(saved.name, saved.asset, saved.width, saved.height, base.viewport);
    }
    const item = layout.elements[id];
    for (const [key, , min, max] of fields) {
      if (!Object.hasOwn(saved, key)) continue;
      if (!Number.isFinite(saved[key]) || saved[key] < min || saved[key] > max || (key === 'layer' && !Number.isInteger(saved[key]))) throw new Error(`Некорректное значение «${key}» у «${item.name}».`);
      item[key] = saved[key];
    }
    if ('visible' in saved && typeof saved.visible !== 'boolean' || 'comment' in saved && typeof saved.comment !== 'string') throw new Error(`Проверь свойства «${item.name}».`);
    if ('visible' in saved) item.visible = saved.visible;
    if ('comment' in saved) item.comment = saved.comment;
    if (item.asset && saved.asset) {
      if (!Object.hasOwn(layout.assets, saved.asset)) throw new Error('В расстановке отсутствует выбранный рисунок.');
      item.asset = saved.asset;
    }
  }
  return layout;
}
