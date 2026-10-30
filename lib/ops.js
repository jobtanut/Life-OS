// Every mutation goes through here — from the UI or the coach — so logging and sync stay consistent.
import { db, save, id, today, addDays, weekStart } from './store.js';
import { log, setMetric, setSummary, addReflection, removeReflection, setJournal, appendJournal } from './log.js';
import * as todoist from './todoist.js';
import * as gcal from './gcal.js';

const find = (coll, key) => {
  const item = db[coll].find(x => x.id === key);
  if (!item) throw new Error(`No ${coll.slice(0, -1)} with id ${key}`);
  return item;
};
const pick = (obj, keys) => Object.fromEntries(keys.filter(k => obj[k] !== undefined).map(k => [k, obj[k]]));
const describe = t => `${t.title}${t.priority ? ` (p${t.priority}` : ''}${t.due ? `, due ${t.due.slice(5)}${t.time ? ' ' + t.time : ''}` : ''}${t.priority ? ')' : ''}`;

// Push to Todoist without blocking the UI; failures are logged, not thrown.
function remote(fn, t) {
  if (!todoist.enabled()) return;
  Promise.resolve(fn(t))
    .then(r => { if (r?.id && !t.todoistId) { t.todoistId = r.id; save(); } })
    .catch(e => log('sync-error', e.message));
}

// ---- Tasks
const TASK_FIELDS = ['title', 'notes', 'due', 'time', 'priority', 'project', 'projectId', 'duration', 'eventId'];
export function addTask(input, by = 'me') {
  if (!input.title) throw new Error('Task needs a title');
  const t = { id: id(), done: false, priority: 4, createdAt: new Date().toISOString(), ...pick(input, TASK_FIELDS) };
  db.tasks.push(t);
  log('task+', `${describe(t)}${by === 'coach' ? ' — via coach' : ''}`);
  remote(todoist.create, t);
  return t;
}
export function updateTask(key, patch, by = 'me') {
  const t = find('tasks', key);
  const before = describe(t);
  Object.assign(t, pick(patch, TASK_FIELDS));
  log('task~', `${before} → ${describe(t)}${by === 'coach' ? ' — via coach' : ''}`);
  if (t.todoistId) remote(todoist.update, t);
  return t;
}
export function completeTask(key, done = true, by = 'me') {
  const t = find('tasks', key);
  t.done = done;
  t.doneAt = done ? new Date().toISOString() : null;
  log(done ? 'done' : 'undone', `${t.title}${by === 'coach' ? ' — via coach' : ''}`);
  if (t.todoistId) remote(done ? todoist.close : todoist.reopen, t);
  return t;
}
export function deleteTask(key, by = 'me') {
  const t = find('tasks', key);
  db.tasks = db.tasks.filter(x => x !== t);
  log('task-', `${t.title}${by === 'coach' ? ' — via coach' : ''}`);
  if (t.todoistId) remote(todoist.remove, t);
  return { ok: true };
}

// Link a task to a calendar block (eventId null unlinks). A task with no date takes the block's date.
export function linkTask(taskId, eventId, by = 'me') {
  const t = find('tasks', taskId);
  const e = eventId ? find('events', eventId) : null;
  t.eventId = eventId || null;
  if (e && !t.due) {
    t.due = e.date;
    if (t.todoistId) remote(todoist.update, t);
  }
  log(e ? 'link' : 'unlink', `${t.title}${e ? ` → ${e.title} ${e.date.slice(5)} ${e.start || 'all-day'}` : ''}${by === 'coach' ? ' — via coach' : ''}`);
  return t;
}

// ---- Events (local are editable; gcal ones are read-only in this draft)
const EVENT_FIELDS = ['title', 'date', 'start', 'end', 'calendar', 'notes', 'location', 'url'];
export function addEvent(input, by = 'me') {
  if (!input.title || !input.date) throw new Error('Event needs title and date');
  const e = { id: id(), source: 'local', calendar: 'Life OS', ...pick(input, EVENT_FIELDS) };
  db.events.push(e);
  log('event+', `${e.title} ${e.date.slice(5)} ${e.start || 'all-day'}${e.end ? '–' + e.end : ''}${by === 'coach' ? ' — via coach' : ''}`);
  return e;
}
export function updateEvent(key, patch) {
  const e = find('events', key);
  if (e.source === 'gcal') throw new Error('Google Calendar events are read-only in this draft');
  Object.assign(e, pick(patch, EVENT_FIELDS));
  log('event~', `${e.title} ${e.date.slice(5)} ${e.start || 'all-day'}`);
  return e;
}
export function deleteEvent(key) {
  const e = find('events', key);
  if (e.source === 'gcal') throw new Error('Google Calendar events are read-only in this draft');
  db.events = db.events.filter(x => x !== e);
  db.tasks.forEach(t => { if (t.eventId === e.id) t.eventId = null; });
  log('event-', e.title);
  return { ok: true };
}

// ---- Notes
export function addNote(input, by = 'me') {
  const n = { id: id(), title: input.title || 'Untitled', body: input.body || '', pinned: false, updatedAt: new Date().toISOString() };
  db.notes.unshift(n);
  log('note+', `${n.title}${by === 'coach' ? ' — via coach' : ''}`);
  return n;
}
export function updateNote(key, patch) {
  const n = find('notes', key);
  const firstEditToday = !n.updatedAt?.startsWith(today());
  Object.assign(n, pick(patch, ['title', 'body', 'pinned']), { updatedAt: new Date().toISOString() });
  firstEditToday ? log('note~', n.title) : save(); // one log line per note per day, not per keystroke
  return n;
}
export function deleteNote(key) {
  const n = find('notes', key);
  db.notes = db.notes.filter(x => x !== n);
  log('note-', n.title);
  return { ok: true };
}

// ---- Goals: 4 to 12 weeks each, with a target per calendar week (keyed by that week's Sunday)
const GOAL_SOFT_LIMIT = 5, GOAL_HARD_LIMIT = 7;
// An unfinished goal keeps occupying a slot after its last week, until you finish it.
const goalEnd = g => { const end = addDays(weekStart(g.startDate), g.weeks * 7 - 1); return end > today() ? end : today(); };
const clampWeeks = w => {
  const n = Math.round(+w);
  if (!(n >= 4 && n <= 12)) throw new Error('A goal runs for 4 to 12 weeks');
  return n;
};
export function addGoal(input, by = 'me') {
  const title = String(input.title || '').trim();
  if (!title) throw new Error('Goal needs a title');
  const startDate = input.startDate || today();
  const weeks = clampWeeks(input.weeks ?? 12);
  // The limit is about goals running at the same time, so a goal planned for next spring doesn't count against today.
  const end = addDays(weekStart(startDate), weeks * 7 - 1);
  const active = db.goals.filter(g => g.status === 'active' && g.startDate <= end && goalEnd(g) >= startDate).length;
  if (active >= GOAL_HARD_LIMIT) throw new Error(`You'd have more than ${GOAL_HARD_LIMIT} goals running at once. Finish or move one first.`);
  const g = { id: id(), title, startDate, weeks, status: 'active', targets: {} };
  db.goals.push(g);
  log('goal+', `${title} (${g.weeks} weeks)${by === 'coach' ? ' — via coach' : ''}`);
  return { ...g, warning: active + 1 > GOAL_SOFT_LIMIT ? `That's ${active + 1} active goals, above your ideal of ${GOAL_SOFT_LIMIT}.` : null };
}
export function updateGoal(key, patch, by = 'me') {
  const g = find('goals', key);
  if (patch.title !== undefined && String(patch.title).trim()) g.title = String(patch.title).trim();
  if (patch.weeks !== undefined) g.weeks = clampWeeks(patch.weeks);
  if (/^\d{4}-\d{2}-\d{2}$/.test(patch.startDate || '')) g.startDate = patch.startDate;
  if (patch.status === 'done' && g.status !== 'done') { g.status = 'done'; g.doneAt = today(); log('goal-done', g.title); }
  if (patch.weekTarget !== undefined) {
    const week = patch.week || weekStart();
    const text = String(patch.weekTarget).trim();
    if (text !== (g.targets[week] || '')) {
      g.targets[week] = text;
      log('week-goal', `${g.title}: ${text || '(cleared)'}${by === 'coach' ? ' — via coach' : ''}`);
    }
  }
  save();
  return g;
}
export function deleteGoal(key) {
  const g = find('goals', key);
  db.goals = db.goals.filter(x => x !== g);
  log('goal-', g.title);
  return { ok: true };
}

// ---- Ideal Year: one statement per calendar year
export function setYear(year, text) {
  const clean = String(text ?? '').trim();
  if ((db.year[year] || '') === clean) return { ok: true };
  db.year[year] = clean;
  log('ideal-year', `${year}: ${clean || '(cleared)'}`);
  return { ok: true };
}

// One line per calendar day, like a row in the Ideal Year sheet.
export function setYearDay(date, text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('Bad date');
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if ((db.yearDays[date] || '') === clean) return { ok: true };
  if (clean) db.yearDays[date] = clean; else delete db.yearDays[date];
  log('year-day', `${date.slice(5)}: ${clean || '(cleared)'}`);
  return { ok: true, text: clean };
}

// ---- Stickies
export function addSticky(input, by = 'me') {
  const s = { id: id(), text: input.text || '', color: input.color || 'yellow', x: input.x ?? 40 + Math.random() * 200, y: input.y ?? 40 + Math.random() * 120 };
  db.stickies.push(s);
  log('sticky+', `${s.text || '(blank)'}${by === 'coach' ? ' — via coach' : ''}`);
  return s;
}
export function updateSticky(key, patch) {
  const s = find('stickies', key);
  Object.assign(s, pick(patch, ['text', 'color', 'x', 'y']));
  save(); // moves/edits aren't worth logging
  return s;
}
export function deleteSticky(key) {
  const s = find('stickies', key);
  db.stickies = db.stickies.filter(x => x !== s);
  log('sticky-', s.text || '(blank)');
  return { ok: true };
}

// ---- Journal / metrics
export const journal = (text, type = 'journal') => (log(type, text), { ok: true });
export const metric = (key, value, date) => (setMetric(key, value, date || undefined), { ok: true });
export const summary = (text, date) => (setSummary(text, date || undefined), { ok: true });
export const reflect = (kind, text, date) => (addReflection(kind, text, date || undefined), { ok: true });
export const unreflect = (kind, index, date) => (removeReflection(kind, +index, date || undefined), { ok: true });
export const journalText = (text, date) => (setJournal(text, date || undefined), { ok: true });
export const journalAppend = (text, date) => (appendJournal(text, date || undefined), { ok: true });

// ---- Sync
export async function sync() {
  const report = {};
  if (todoist.enabled()) {
    const { tasks, projects } = await todoist.fetchAll();
    const remoteIds = new Set(tasks.map(t => t.todoistId));
    const byRemote = new Map(db.tasks.filter(t => t.todoistId).map(t => [t.todoistId, t]));
    for (const r of tasks) {
      const local = byRemote.get(r.todoistId);
      if (local) Object.assign(local, r, { done: false });
      else db.tasks.push({ id: id(), done: false, createdAt: new Date().toISOString(), ...r });
    }
    // Open locally but gone from Todoist's active list → completed or deleted there.
    for (const t of db.tasks) {
      if (t.todoistId && !t.done && !remoteIds.has(t.todoistId)) { t.done = true; t.doneAt = new Date().toISOString(); }
    }
    db.sync.projects = projects;
    report.todoist = `${tasks.length} active tasks`;
  }
  if (gcal.enabled()) {
    const events = await gcal.fetchAll();
    db.events = [...db.events.filter(e => e.source !== 'gcal'), ...events];
    report.gcal = `${events.length} events across ${gcal.calendars().length} calendars`;
  }
  db.sync.at = new Date().toISOString();
  save();
  if (Object.keys(report).length) log('sync', Object.entries(report).map(([k, v]) => `${k}: ${v}`).join(' · '));
  return { ...report, at: db.sync.at, todoist: report.todoist || (todoist.enabled() ? 'ok' : 'not connected'), gcal: report.gcal || 'not connected' };
}

// Snapshot used by both the UI and the coach's context.
export function snapshot(date = today()) {
  const open = db.tasks.filter(t => !t.done);
  return {
    date,
    overdue: open.filter(t => t.due && t.due < date),
    dueToday: open.filter(t => t.due === date),
    upcoming: open.filter(t => t.due && t.due > date && t.due <= addDays(date, 7)),
    undated: open.filter(t => !t.due),
    eventsToday: db.events.filter(e => e.date === date).sort((a, b) => (a.start || '').localeCompare(b.start || '')),
    eventsWeek: db.events.filter(e => e.date > date && e.date <= addDays(date, 7)),
  };
}
