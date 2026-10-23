// Сторож зависаний. Игра ведёт бортовой журнал: последние действия игрока и раз в полсекунды —
// состояние дерева и пилы. Журнал лежит в памяти браузера с пометкой «игра идёт», а когда вкладку
// закрывают или перезагружают, пометка снимается. Зависшая вкладка снять её не успевает: при следующем
// открытии сторож находит журнал и кладёт его в базу артефакта — оттуда его читает Claude.
// Кадр дольше секунды и ошибка в коде тоже попадают в базу, сразу, а по P — когда игрок попросит.
const KEY = 'timber-flight';
const KEEP = 200;         // столько последних действий помним
const SAVE_EVERY = 500;   // мс
const SLOW = 1000;        // мс: такой кадр — уже подвисание

const actions = [];
let snapshot = () => ({});
let last = 0, saved = 0;
const sent = new Set();   // о каждом виде беды за открытие сообщаем один раз

// Что сейчас происходит в игре — функция, которую сторож зовёт, когда пишет журнал.
export function watch(state) { snapshot = state; }

// Действие игрока или смена режима.
export function note(what) {
  actions.push([Math.round(performance.now()), what]);
  if (actions.length > KEEP) actions.shift();
}

// Зовётся каждый кадр.
export function beat(now) {
  if (last && now - last > SLOW) report('slow', { frame: Math.round(now - last) });
  last = now;
  if (now - saved > SAVE_EVERY) {
    saved = now;
    save(true);
  }
}

function record() {
  let state;
  try { state = snapshot(); } catch (e) { state = { error: String(e) }; }
  return { actions: actions.slice(), state };
}

function save(running) {
  try { localStorage.setItem(KEY, JSON.stringify({ running, at: Date.now(), ...record() })); } catch {}
}

// Игрок сам заметил странность и нажал P: отчёт с тем, что сейчас на экране, — сколько угодно раз.
export function tell() {
  return send('seen', {}, record());
}

function report(kind, extra, journal = record()) {
  if (sent.has(kind)) return;
  sent.add(kind);
  send(kind, extra, journal);
}

async function send(kind, extra, journal) {
  const db = await window.claude?.use?.('db');
  if (!db) return false;
  // В базу — строкой: так вложенность и пустые значения из журнала не упрутся в её правила.
  try {
    await db.collection('reports').add({
      kind, at: new Date().toISOString(), agent: navigator.userAgent, ...extra, journal: JSON.stringify(journal),
    });
    return true;
  } catch { return false; }
}

// Свёрнутая вкладка кадров не рисует: пауза — не подвисание.
document.addEventListener('visibilitychange', () => { last = 0; });
addEventListener('pagehide', () => save(false));
addEventListener('error', (e) => report('error', { message: String(e.message), where: `${e.filename}:${e.lineno}` }));
addEventListener('unhandledrejection', (e) => report('error', { message: String(e.reason) }));

// Прошлое открытие не закрылось как следует — скорее всего, зависло.
let previous = null;
try { previous = JSON.parse(localStorage.getItem(KEY)); } catch {}
if (previous?.running) report('hang', { lastSave: new Date(previous.at).toISOString() }, previous);
