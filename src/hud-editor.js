import { fields, imageLayer, readLayout } from './hud-layout.js';
import { makePreview } from './hud-preview.js';

function openDrafts() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('timber-hud', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('layouts');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

export async function startEditor({ base, apply }) {
  const el = id => document.getElementById(id);
  const objectList = el('objects'), artList = el('art'), status = el('status');
  for (const id of ['inspector','editor-bar','editor-help']) el(id).hidden = false;
  const preview = makePreview();
  let layout = structuredClone(base), selected = 'held-saw', testing = false, drag = null, db;
  try {
    db = await openDrafts();
    const stored = await new Promise((resolve, reject) => {
      const read = db.transaction('layouts').objectStore('layouts').get('current');
      read.onsuccess = () => resolve(read.result);
      read.onerror = () => reject(read.error);
    });
    if (stored) { layout = readLayout(stored, base); status.textContent = 'Открыт местный черновик.'; }
  } catch (error) { status.textContent = `Не удалось открыть черновик. ${error.message}`; }
  let pendingSave;
  function announce(message) { pendingSave = null; status.textContent = message; }
  function save() {
    if (!db) { status.textContent = 'Хранилище недоступно. Сохранить работу можно кнопкой «Выгрузить JSON».'; return; }
    const tx = db.transaction('layouts', 'readwrite');
    tx.objectStore('layouts').put(layout, 'current');
    pendingSave = tx;
    tx.oncomplete = () => { if (pendingSave === tx) announce('Черновик сохранён на этом устройстве.'); };
    tx.onabort = () => { if (pendingSave === tx) announce('Ошибка записи черновика. Выгрузи JSON для сохранения.'); };
  }
  const inputs = {};
  for (const [key, title, min, max, step] of fields) {
    const label = document.createElement('label'), input = document.createElement('input');
    label.textContent = title;
    Object.assign(input, { type: 'number', id: `edit-${key}`, min, max, step });
    inputs[key] = input;
    label.append(input); el('numbers').append(label);
    input.addEventListener('input', () => {
      const v = input.valueAsNumber;
      if (!Number.isFinite(v) || v < min || v > max || (key === 'layer' && !Number.isInteger(v))) return;
      layout.elements[selected][key] = v; apply(layout, selected);
    });
    input.addEventListener('change', () => { input.value = layout.elements[selected][key]; save(); });
  }
  function select(id) {
    el('hud').querySelector('.selected')?.classList.remove('selected');
    selected = id;
    const item = layout.elements[id];
    el(id).classList.add('selected'); objectList.value = id;
    for (const [key, field] of Object.entries(inputs)) field.value = item[key];
    el('visible').checked = item.visible;
    el('comment').value = item.comment;
    el('restore').textContent = base.elements[id] ? 'Сбросить элемент' : 'Убрать слой';
    el('art-controls').hidden = !item.asset;
    if (item.asset) {
      artList.replaceChildren(...Object.entries(layout.assets).map(([key, art]) => new Option(art.name, key)));
      artList.value = item.asset;
    }
    preview.select(id);
  }
  function refresh() {
    for (const node of document.querySelectorAll('[data-image-layer]')) if (!layout.elements[node.id]) node.remove();
    objectList.replaceChildren();
    for (const [id, item] of Object.entries(layout.elements)) {
      apply(layout, id); objectList.add(new Option(item.name, id));
    }
    select(layout.elements[selected] ? selected : 'held-saw');
  }
  function setTesting(on) {
    testing = on;
    el('help').open = false;
    el('stage').classList.toggle('editing', !on);
    el('try').setAttribute('aria-pressed', on); el('arrange').setAttribute('aria-pressed', !on);
    el('editor-help').textContent = on ? 'WASD или круг — идти · потяни мышью по полю — осмотреться · кнопка или пробел — газ' : 'Перетаскивай элементы мышью. Стрелки сдвигают выбранный на одну точку, с Shift — на десять.';
    preview.play(on);
  }
  el('back').addEventListener('click', e => { e.preventDefault(); if (testing) announce('В игре эта кнопка открывает главное меню.'); });
  el('regrow').hidden = true;
  objectList.addEventListener('change', () => select(objectList.value));
  el('try').addEventListener('click', () => setTesting(true));
  el('arrange').addEventListener('click', () => setTesting(false));
  el('visible').addEventListener('change', e => { layout.elements[selected].visible = e.target.checked; apply(layout, selected); save(); });
  el('comment').addEventListener('input', e => { layout.elements[selected].comment = e.target.value; save(); });
  artList.addEventListener('change', () => { layout.elements[selected].asset = artList.value; apply(layout, selected); save(); });
  el('restore').addEventListener('click', () => {
    if (base.elements[selected]) layout.elements[selected] = { ...base.elements[selected] };
    else delete layout.elements[selected];
    refresh(); save();
  });

  const hud = el('hud');
  function position(x, y) {
    const item = layout.elements[selected];
    for (const [key, value] of [['x',x],['y',y]]) {
      const input = inputs[key];
      item[key] = Math.min(+input.max, Math.max(+input.min, Math.round(value * 2) / 2));
      input.value = item[key];
    }
    apply(layout, selected);
  }
  hud.addEventListener('pointerdown', e => {
    const item = e.target.closest('.hud-object');
    if (testing || !item || e.button !== 0 || drag) return;
    e.preventDefault(); e.stopPropagation(); select(item.id);
    document.activeElement?.blur();
    const { x, y } = layout.elements[selected];
    drag = { pointer: e.pointerId, fromX: e.clientX, fromY: e.clientY, x, y };
    hud.setPointerCapture(e.pointerId);
  }, true);
  hud.addEventListener('pointermove', e => {
    if (e.pointerId !== drag?.pointer) return;
    const scale = hud.getBoundingClientRect().width / base.viewport.width;
    position(drag.x + (e.clientX - drag.fromX) / scale, drag.y + (e.clientY - drag.fromY) / scale);
  });
  for (const type of ['pointerup','pointercancel','lostpointercapture']) hud.addEventListener(type, e => {
    if (e.pointerId === drag?.pointer) { drag = null; save(); }
  });
  hud.addEventListener('click', e => { if (!testing) { e.preventDefault(); e.stopPropagation(); } }, true);
  const arrows = { ArrowLeft: [-1,0], ArrowRight: [1,0], ArrowUp: [0,-1], ArrowDown: [0,1] };
  addEventListener('keydown', e => {
    if (testing || !arrows[e.code] || e.target.closest('input,textarea,select,button') || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    const [dx,dy] = arrows[e.code], step = e.shiftKey ? 10 : 1, { x,y } = layout.elements[selected];
    position(x + dx * step, y + dy * step); save();
  });
  async function importArt(e) {
    const input = e.target, file = input.files[0], id = selected;
    if (!file) return;
    try {
      if (!['image/png','image/jpeg','image/webp'].includes(file.type)) throw new Error('Выбери PNG, JPEG или WebP.');
      const src = await new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file);
      });
      const img = new Image(); img.src = src; await img.decode();
      const key = `local-${crypto.randomUUID()}`;
      layout.assets[key] = { name: file.name, src };
      if (input.id === 'new-layer') {
        const scale = Math.min(1, 280 / img.naturalWidth, 200 / img.naturalHeight);
        selected = `image-${crypto.randomUUID()}`;
        layout.elements[selected] = imageLayer(file.name, key, Math.max(1, Math.round(img.naturalWidth * scale)), Math.max(1, Math.round(img.naturalHeight * scale)), base.viewport);
      } else layout.elements[id].asset = key;
      refresh(); save();
    } catch (error) { announce(`Рисунок не открыт. ${error.message}`); }
    input.value = '';
  }
  el('new-art').addEventListener('change', importArt);
  el('new-layer').addEventListener('change', importArt);
  el('export').addEventListener('click', () => {
    const changes = {};
    for (const [id, item] of Object.entries(layout.elements)) {
      if (!base.elements[id]) { changes[id] = { before: null, after: item }; continue; }
      const changed = {};
      for (const [key, value] of Object.entries(item)) {
        const before = base.elements[id][key];
        if (value !== before) changed[key] = { before, after: value };
      }
      if (Object.keys(changed).length) changes[id] = changed;
    }
    const coordinates = { origin: 'top-left', pivot: 'element-center', position: 'layout-pixels', rotation: 'degrees', scale: 'percent', opacity: 'percent' };
    const bytes = new Blob([JSON.stringify({ ...layout, coordinates, changes }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(bytes), link = document.createElement('a');
    link.download = 'timber-hud.json'; link.href = url; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    announce('Расстановка и комментарии выгружены.');
  });
  el('import').addEventListener('change', async e => {
    const input = e.target, file = input.files[0];
    if (!file) return;
    try { const next = readLayout(JSON.parse(await file.text()), base); layout = next; refresh(); save(); }
    catch (error) { announce(`Файл не открыт. ${error.message}`); }
    input.value = '';
  });
  refresh(); setTesting(false);
}
