// Google Calendar read-sync via each calendar's free "Secret address in iCal format".
// Draft limitation: read-only. Writing back needs a Google OAuth client (free, but setup-heavy) — next iteration.
// Supports single events, all-day events, and common RRULEs (DAILY/WEEKLY/MONTHLY, INTERVAL, COUNT, UNTIL, BYDAY, EXDATE).
import { today, addDays } from './store.js';

export function calendars() {
  // GCAL_ICS="Study=https://...ics,Business=https://...ics"
  return (process.env.GCAL_ICS || '')
    .split(',').map(s => s.trim()).filter(Boolean)
    .map(pair => {
      const i = pair.indexOf('=');
      return { name: pair.slice(0, i).trim(), url: pair.slice(i + 1).trim() };
    });
}
export const enabled = () => calendars().length > 0;

function unfold(text) {
  return text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
}

// Returns { date: 'YYYY-MM-DD', time: 'HH:MM' | null } in local time
function parseDT(value, params = '') {
  if (/VALUE=DATE(?!-)/.test(params) || /^\d{8}$/.test(value)) {
    return { date: `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`, time: null };
  }
  const [, y, mo, d, h, mi] = value.match(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/);
  if (value.endsWith('Z')) {
    const dt = new Date(Date.UTC(+y, mo - 1, +d, +h, +mi));
    return { date: today(dt), time: dt.toTimeString().slice(0, 5) };
  }
  return { date: `${y}-${mo}-${d}`, time: `${h}:${mi}` }; // TZID wall-clock, assumed local
}

function parseICS(text) {
  const events = [];
  let cur = null;
  for (const line of unfold(text)) {
    if (line === 'BEGIN:VEVENT') { cur = { exdates: [] }; continue; }
    if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const m = line.match(/^([A-Z-]+)((?:;[^:]*)?):(.*)$/);
    if (!m) continue;
    const [, key, params, val] = m;
    if (key === 'SUMMARY') cur.title = val.replace(/\\([,;\\])/g, '$1').replace(/\\n/g, ' ');
    else if (key === 'UID') cur.uid = val;
    else if (key === 'DTSTART') cur.start = parseDT(val, params);
    else if (key === 'DTEND') cur.end = parseDT(val, params);
    else if (key === 'RRULE') cur.rrule = Object.fromEntries(val.split(';').map(p => p.split('=')));
    else if (key === 'EXDATE') cur.exdates.push(...val.split(',').map(v => parseDT(v, params).date));
    else if (key === 'RECURRENCE-ID') cur.recurrenceId = parseDT(val, params).date;
    else if (key === 'STATUS') cur.status = val;
  }
  return events.filter(e => e.start && e.status !== 'CANCELLED');
}

const BYDAY = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const dayDiff = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5);

function occurrences(ev, from, to) {
  const r = ev.rrule;
  if (!r) return ev.start.date >= from && ev.start.date <= to ? [ev.start.date] : [];
  const interval = +(r.INTERVAL || 1);
  const until = r.UNTIL ? parseDT(r.UNTIL).date : '9999-12-31';
  const count = r.COUNT ? +r.COUNT : Infinity;
  const days = r.BYDAY ? r.BYDAY.split(',').map(d => BYDAY[d.slice(-2)]) : null;
  const out = [];
  let n = 0;
  for (let d = ev.start.date; d <= until && d <= to && n < count; d = addDays(d, 1)) {
    const diff = dayDiff(ev.start.date, d);
    const dt = new Date(d + 'T12:00:00');
    const start = new Date(ev.start.date + 'T12:00:00');
    let hit = false;
    if (r.FREQ === 'DAILY') hit = diff % interval === 0;
    else if (r.FREQ === 'WEEKLY') {
      const weekIdx = Math.floor((diff + start.getDay()) / 7);
      hit = weekIdx % interval === 0 && (days ? days.includes(dt.getDay()) : dt.getDay() === start.getDay());
    } else if (r.FREQ === 'MONTHLY') {
      const months = (dt.getFullYear() - start.getFullYear()) * 12 + dt.getMonth() - start.getMonth();
      hit = months % interval === 0 && dt.getDate() === start.getDate();
    } else if (r.FREQ === 'YEARLY') hit = d.slice(5) === ev.start.date.slice(5);
    if (!hit) continue;
    n++;
    if (d >= from && !ev.exdates.includes(d)) out.push(d);
  }
  return out;
}

export async function fetchAll(from = addDays(today(), -14), to = addDays(today(), 60)) {
  const all = [];
  for (const cal of calendars()) {
    const res = await fetch(cal.url);
    if (!res.ok) throw new Error(`Calendar ${cal.name}: ${res.status}`);
    const events = parseICS(await res.text());
    const overrides = new Set(events.filter(e => e.recurrenceId).map(e => `${e.uid}|${e.recurrenceId}`));
    for (const ev of events) {
      for (const date of occurrences(ev, from, to)) {
        if (!ev.recurrenceId && ev.rrule && overrides.has(`${ev.uid}|${date}`)) continue;
        all.push({
          id: `g-${ev.uid}-${date}`.replace(/[^\w-]/g, '').slice(0, 80),
          title: ev.title || '(no title)',
          date,
          start: ev.start.time,
          end: ev.end?.time || null,
          calendar: cal.name,
          source: 'gcal',
        });
      }
    }
  }
  return all;
}
