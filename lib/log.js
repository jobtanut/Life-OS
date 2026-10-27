// Daily log: compact one-line entries per day, plus metrics and an end-of-day summary.
// Source of truth is db.days; each change re-renders logs/YYYY-MM-DD.md (what Friday reads).
import fs from 'node:fs';
import path from 'node:path';
import { db, save, today, nowTime, LOG_DIR } from './store.js';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function day(date = today()) {
  const d = (db.days[date] ??= { summary: '', metrics: {}, entries: [] });
  d.journal ??= '';
  d.gratitude ??= []; d.wins ??= []; d.lessons ??= [];
  return d;
}

// Journal page: three reflection lists + a free-form journal that grows through the day.
const KINDS = { gratitude: 'gratitude', win: 'wins', lesson: 'lessons' };
const listFor = (kind, date) => {
  if (!KINDS[kind]) throw new Error(`Unknown reflection "${kind}" (use gratitude, win or lesson)`);
  return day(date)[KINDS[kind]];
};

export function addReflection(kind, text, date = today()) {
  const clean = String(text).replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!clean) throw new Error('Nothing to add');
  listFor(kind, date).push({ t: nowTime(), text: clean });
  persist(date);
}

export function removeReflection(kind, index, date = today()) {
  listFor(kind, date).splice(index, 1);
  persist(date);
}

export function setJournal(text, date = today()) {
  day(date).journal = String(text);
  persist(date);
}

export function appendJournal(text, date = today()) {
  const d = day(date);
  d.journal = `${d.journal.trimEnd()}${d.journal.trim() ? '\n\n' : ''}— ${nowTime()} —\n${String(text).trim()}`;
  persist(date);
}

export function log(type, text, date = today()) {
  const clean = String(text).replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!clean) return;
  day(date).entries.push({ t: nowTime(), type, text: clean });
  persist(date);
}

export function setMetric(key, value, date = today()) {
  day(date).metrics[key] = value;
  persist(date);
}

export function setSummary(text, date = today()) {
  day(date).summary = String(text).trim();
  persist(date);
}

export function render(date) {
  const d = day(date);
  const dow = DOW[new Date(date + 'T12:00:00').getDay()];
  const metrics = Object.entries(d.metrics).map(([k, v]) => `${k}: ${v}`).join(' · ');
  const done = db.tasks.filter(t => t.done && t.doneAt?.startsWith(date)).length;
  const open = db.tasks.filter(t => !t.done && t.due && t.due <= date).length;
  const list = (title, items) => items.length ? [`## ${title}`, ...items.map(i => `- ${i.text}`), ''] : [];
  return [
    `# ${date} (${dow})`,
    '',
    `**Summary:** ${d.summary || '—'}`,
    `**Metrics:** ${metrics || '—'}`,
    `**Tasks:** ${done} done · ${open} open/overdue at last update`,
    '',
    ...list('Gratitude', d.gratitude),
    ...list('Wins', d.wins),
    ...list('Lessons', d.lessons),
    ...(d.journal.trim() ? ['## Journal', d.journal.trim(), ''] : []),
    '## Activity',
    ...(d.entries.length ? d.entries.map(e => `- ${e.t} [${e.type}] ${e.text}`) : ['- (none)']),
    '',
  ].join('\n');
}

function persist(date) {
  save();
  fs.writeFileSync(path.join(LOG_DIR, `${date}.md`), render(date));
}

export const touch = persist;
