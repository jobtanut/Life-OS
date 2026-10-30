// JSON-file store. One db.json holds everything; daily logs are rendered to logs/*.md for Friday.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
export const LOG_DIR = path.join(ROOT, 'logs');

const EMPTY = { tasks: [], events: [], notes: [], stickies: [], goals: [], year: {}, yearDays: {}, coach: [], days: {}, sync: {} };

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(LOG_DIR, { recursive: true });

export const db = fs.existsSync(DB_FILE)
  ? { ...structuredClone(EMPTY), ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) }
  : structuredClone(EMPTY);

export function save() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

export const id = () => crypto.randomUUID().slice(0, 8);

// Local-time helpers (machine timezone, i.e. Bangkok)
export const today = (d = new Date()) => d.toLocaleDateString('en-CA');
export const nowTime = (d = new Date()) => d.toTimeString().slice(0, 5);
export const weekStart = (dateStr = today()) => addDays(dateStr, -new Date(dateStr + 'T12:00:00').getDay()); // Sunday
export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return today(d);
}
