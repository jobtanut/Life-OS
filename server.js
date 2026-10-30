// Life OS — local server. Zero dependencies: `npm start`, then open http://localhost:4747
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { db, today, LOG_DIR } from './lib/store.js';
import { day, render } from './lib/log.js';
import * as ops from './lib/ops.js';
import * as coach from './lib/coach.js';
import * as todoist from './lib/todoist.js';
import * as gcal from './lib/gcal.js';

const PORT = +(process.env.PORT || 4747);
const PUBLIC = path.join(import.meta.dirname, 'public');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

const COLLECTIONS = {
  tasks: { add: ops.addTask, update: ops.updateTask, remove: ops.deleteTask },
  events: { add: ops.addEvent, update: ops.updateEvent, remove: ops.deleteEvent },
  notes: { add: ops.addNote, update: ops.updateNote, remove: ops.deleteNote },
  stickies: { add: ops.addSticky, update: ops.updateSticky, remove: ops.deleteSticky },
  goals: { add: ops.addGoal, update: ops.updateGoal, remove: ops.deleteGoal },
};

const routes = {
  'GET /api/state': () => ({
    today: today(),
    name: process.env.USER_NAME || '',
    tasks: db.tasks, events: db.events, notes: db.notes, stickies: db.stickies, goals: db.goals, year: db.year, yearDays: db.yearDays,
    projects: db.sync.projects || [],
    day: day(today()),
    coach: db.coach.slice(-30),
    status: { todoist: todoist.enabled(), gcal: gcal.calendars().map(c => c.name), coach: coach.provider(), lastSync: db.sync.at || null },
  }),
  'GET /api/days': () => Object.keys(db.days).sort().reverse(),
  'GET /api/day': (_, q) => ({ date: q.get('date'), ...day(q.get('date') || today()), markdown: render(q.get('date') || today()) }),
  'POST /api/tasks/complete': b => ops.completeTask(b.id, b.done ?? true),
  'POST /api/tasks/link': b => ops.linkTask(b.id, b.eventId),
  'POST /api/journal': b => ops.journal(b.text, b.type || 'journal'),
  'POST /api/metric': b => ops.metric(b.key, b.value, b.date),
  'POST /api/reflection': b => ops.reflect(b.kind, b.text, b.date),
  'POST /api/reflection/delete': b => ops.unreflect(b.kind, b.index, b.date),
  'POST /api/day/journal': b => ops.journalText(b.text ?? '', b.date),
  'POST /api/summary': b => ops.summary(b.text, b.date),
  'POST /api/year': b => ops.setYear(b.year, b.text),
  'POST /api/year/day': b => ops.setYearDay(b.date, b.text),
  'POST /api/sync': () => ops.sync(),
  'POST /api/coach': b => coach.chat(String(b.message || '')),
};

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const body = req.method === 'GET' ? {} : await new Promise(r => {
    let s = ''; req.on('data', c => (s += c)); req.on('end', () => r(s ? JSON.parse(s) : {}));
  });

  const exact = routes[`${req.method} ${url.pathname}`];
  if (exact) return send(res, 200, await exact(body, url.searchParams));

  const m = url.pathname.match(/^\/api\/(\w+)(?:\/([\w-]+))?$/);
  const coll = m && COLLECTIONS[m[1]];
  if (coll) {
    if (req.method === 'POST' && !m[2]) return send(res, 200, coll.add(body));
    if (req.method === 'PATCH' && m[2]) return send(res, 200, coll.update(m[2], body));
    if (req.method === 'DELETE' && m[2]) return send(res, 200, coll.remove(m[2]));
  }
  if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Not found' });

  // Static files
  const file = path.join(PUBLIC, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file)) return send(res, 404, { error: 'Not found' });
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

function send(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

http.createServer((req, res) => handle(req, res).catch(e => send(res, 400, { error: e.message })))
  .listen(PORT, '127.0.0.1', () => {
    console.log(`Life OS running → http://localhost:${PORT}`);
    console.log(`Coach: ${coach.provider().name} · Todoist: ${todoist.enabled() ? 'on' : 'off'} · Calendars: ${gcal.calendars().map(c => c.name).join(', ') || 'none'}`);
    console.log(`Daily logs → ${LOG_DIR}`);
    if (todoist.enabled() || gcal.enabled()) ops.sync().catch(e => console.error('Initial sync failed:', e.message));
  });
