// Google Calendar read-sync via each calendar's free "Secret address in iCal format".
// Draft limitation: read-only. Writing back needs a Google OAuth client (free, but setup-heavy) — next iteration.
// Supports single events, all-day events, and common RRULEs (DAILY/WEEKLY/MONTHLY, INTERVAL, COUNT, UNTIL, BYDAY, EXDATE).
import crypto from 'node:crypto';
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

const unescapeText = v => v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

// Google descriptions are often HTML. Reduce to plain text, keeping link targets visible.
function cleanDescription(v) {
  if (!/<[a-z!/][\s\S]*>/i.test(v)) return v.trim();
  return v
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, url, label) => {
      const text = label.replace(/<[^>]+>/g, '').trim();
      return !text || text === url ? url : `${text} (${url})`;
    })
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// "CN=Job;PARTSTAT=ACCEPTED" → { CN: 'Job', PARTSTAT: 'ACCEPTED' }, respecting quoted values
function parseParams(params) {
  const out = {};
  for (const [, k, v] of params.matchAll(/;([A-Z0-9-]+)=("[^"]*"|[^;]*)/g)) out[k] = v.replace(/^"|"$/g, '');
  return out;
}
const person = (val, p) => ({ name: p.CN || '', email: val.replace(/^mailto:/i, '') });

const FREQ = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' };
const DAY_NAME = { SU: 'Sun', MO: 'Mon', TU: 'Tue', WE: 'Wed', TH: 'Thu', FR: 'Fri', SA: 'Sat' };
function describeRule(r) {
  const n = +(r.INTERVAL || 1);
  let text = `Every ${n > 1 ? `${n} ${FREQ[r.FREQ] || r.FREQ}s` : FREQ[r.FREQ] || r.FREQ}`;
  if (r.BYDAY) text += ` on ${r.BYDAY.split(',').map(d => DAY_NAME[d.slice(-2)] || d).join(', ')}`;
  if (r.UNTIL) text += `, until ${parseDT(r.UNTIL).date}`;
  if (r.COUNT) text += `, ${r.COUNT} times`;
  return text;
}
function describeTrigger(v) {
  const m = v.match(/^-?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return v;
  const parts = [[m[1], 'week'], [m[2], 'day'], [m[3], 'hour'], [m[4], 'minute']]
    .filter(([x]) => +x).map(([x, unit]) => `${+x} ${unit}${+x > 1 ? 's' : ''}`);
  return parts.length ? `${parts.join(' ')} before` : 'At the start';
}
const fromStamp = v => { const d = parseDT(v); return d.time ? `${d.date} ${d.time}` : d.date; };

// Properties with their own place in the details panel; anything else lands in `extras`.
const SKIP = new Set(['DTSTAMP']);
function parseICS(text) {
  const events = [];
  let cur = null;
  let nested = null; // VALARM etc. carry their own SUMMARY/DESCRIPTION, which must not overwrite the event's
  let alarm = null;
  for (const line of unfold(text)) {
    if (line === 'BEGIN:VEVENT') { cur = { exdates: [], attendees: [], reminders: [], attachments: [], extras: {} }; continue; }
    if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    if (line.startsWith('BEGIN:')) { nested = line.slice(6); alarm = nested === 'VALARM' ? {} : null; continue; }
    if (line.startsWith('END:')) {
      if (alarm?.trigger) cur.reminders.push(`${alarm.trigger}${alarm.action === 'EMAIL' ? ' (email)' : ''}`);
      nested = null; alarm = null;
      continue;
    }
    const m = line.match(/^([A-Z0-9-]+)((?:;(?:"[^"]*"|[^:;"])*)*):(.*)$/);
    if (!m) continue;
    const [, key, params, val] = m;
    if (nested) {
      if (alarm && key === 'TRIGGER') alarm.trigger = describeTrigger(val);
      if (alarm && key === 'ACTION') alarm.action = val;
      continue;
    }
    const p = parseParams(params);
    if (key === 'SUMMARY') cur.title = unescapeText(val).replace(/\n/g, ' ');
    else if (key === 'UID') { cur.uid = val; cur.extras.UID = val; }
    else if (key === 'DTSTART') cur.start = parseDT(val, params);
    else if (key === 'DTEND') cur.end = parseDT(val, params);
    else if (key === 'RRULE') { cur.rrule = Object.fromEntries(val.split(';').map(x => x.split('='))); cur.repeats = describeRule(cur.rrule); }
    else if (key === 'EXDATE') cur.exdates.push(...val.split(',').map(v => parseDT(v, params).date));
    else if (key === 'RECURRENCE-ID') cur.recurrenceId = parseDT(val, params).date;
    else if (key === 'STATUS') cur.status = val;
    else if (key === 'LOCATION') cur.location = unescapeText(val);
    else if (key === 'DESCRIPTION') cur.description = cleanDescription(unescapeText(val));
    else if (key === 'URL') cur.url = val;
    else if (key === 'X-GOOGLE-CONFERENCE') cur.conference = val;
    else if (key === 'ORGANIZER') cur.organizer = person(val, p);
    else if (key === 'ATTENDEE') cur.attendees.push({ ...person(val, p), status: p.PARTSTAT || 'NEEDS-ACTION', optional: p.ROLE === 'OPT-PARTICIPANT' });
    else if (key === 'ATTACH') cur.attachments.push({ url: val, name: p.FILENAME || val });
    else if (key === 'TRANSP') cur.showAs = val === 'TRANSPARENT' ? 'Free' : 'Busy';
    else if (key === 'CLASS') cur.visibility = val.charAt(0) + val.slice(1).toLowerCase();
    else if (key === 'CREATED') cur.created = fromStamp(val);
    else if (key === 'LAST-MODIFIED') cur.updated = fromStamp(val);
    else if (!SKIP.has(key)) cur.extras[key] = unescapeText(val);
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

function details(ev, date) {
  const out = {};
  for (const k of ['location', 'description', 'url', 'conference', 'organizer', 'status', 'showAs', 'visibility', 'repeats', 'created', 'updated']) {
    if (ev[k]) out[k] = ev[k];
  }
  for (const k of ['attendees', 'reminders', 'attachments']) if (ev[k].length) out[k] = ev[k];
  if (Object.keys(ev.extras).length) out.extras = ev.extras;
  // All-day DTEND is exclusive in iCal; a multi-day event should show its real last day.
  if (ev.end) {
    const span = dayDiff(ev.start.date, ev.end.date) - (ev.start.time ? 0 : 1);
    if (span > 0) out.endDate = addDays(date, span);
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
          id: `g-${date}-${crypto.createHash('sha1').update(`${cal.name}|${ev.uid}`).digest('hex').slice(0, 12)}`, // stable, so task links survive syncs
          title: ev.title || '(no title)',
          date,
          start: ev.start.time,
          end: ev.end?.time || null,
          calendar: cal.name,
          source: 'gcal',
          ...details(ev, date),
        });
      }
    }
  }
  return all;
}
