// AI coach with read/write/execute access. Free providers only:
//   GEMINI_API_KEY → Google AI Studio free tier (default)
//   OLLAMA_MODEL   → a local model via Ollama
//   neither        → offline mode (rule-based briefing, no actions)
// The model returns JSON {reply, actions[]}; actions run through ops.js so they're logged like any other change.
import fs from 'node:fs';
import path from 'node:path';
import { db, save, today, addDays } from './store.js';
import { day, log } from './log.js';
import * as ops from './ops.js';

const ROOT = path.resolve(import.meta.dirname, '..');
// Your own profile is gitignored; the example ships with the repo.
const PROFILE = [path.join(ROOT, 'coach-profile.md'), path.join(ROOT, 'coach-profile.example.md')].find(f => fs.existsSync(f));

export function provider() {
  if (process.env.GEMINI_API_KEY) return { name: 'gemini', model: process.env.GEMINI_MODEL || 'gemini-2.5-flash' };
  if (process.env.OLLAMA_MODEL) return { name: 'ollama', model: process.env.OLLAMA_MODEL };
  return { name: 'offline', model: null };
}

const ACTIONS = {
  add_task: a => ops.addTask(a, 'coach'),
  update_task: a => ops.updateTask(a.id, a, 'coach'),
  complete_task: a => ops.completeTask(a.id, a.done ?? true, 'coach'),
  delete_task: a => ops.deleteTask(a.id, 'coach'),
  add_event: a => ops.addEvent(a, 'coach'),
  update_event: a => ops.updateEvent(a.id, a),
  delete_event: a => ops.deleteEvent(a.id),
  add_note: a => ops.addNote(a, 'coach'),
  update_note: a => ops.updateNote(a.id, a),
  add_sticky: a => ops.addSticky(a, 'coach'),
  delete_sticky: a => ops.deleteSticky(a.id),
  log: a => ops.journal(a.text, a.kind || 'coach-note'),
  set_metric: a => ops.metric(a.key, a.value),
  add_reflection: a => ops.reflect(a.kind, a.text),
  append_journal: a => ops.journalAppend(a.text),
  set_summary: a => ops.summary(a.text),
};

const task = t => `[${t.id}] p${t.priority || 4} ${t.title}${t.due ? ` (due ${t.due}${t.time ? ' ' + t.time : ''})` : ''}${t.project ? ` #${t.project}` : ''}`;
const event = e => `[${e.id}] ${e.date} ${e.start || 'all-day'}${e.end ? '–' + e.end : ''} ${e.title} {${e.calendar}${e.source === 'gcal' ? ', read-only' : ''}}`;

function context() {
  const date = today();
  const s = ops.snapshot(date);
  const dow = new Date().toLocaleDateString('en-GB', { weekday: 'long' });
  const recent = [1, 2, 3].map(n => addDays(date, -n)).filter(d => db.days[d])
    .map(d => `${d}: ${db.days[d].summary || '(no summary)'} | ${JSON.stringify(db.days[d].metrics)} | ${db.days[d].entries.length} entries`);
  const d = day(date);
  return [
    `NOW: ${dow} ${date} ${new Date().toTimeString().slice(0, 5)}`,
    `\nOVERDUE:\n${s.overdue.map(task).join('\n') || '-'}`,
    `\nDUE TODAY:\n${s.dueToday.map(task).join('\n') || '-'}`,
    `\nNEXT 7 DAYS:\n${s.upcoming.map(task).join('\n') || '-'}`,
    `\nNO DATE (first 20):\n${s.undated.slice(0, 20).map(task).join('\n') || '-'}`,
    `\nEVENTS TODAY:\n${s.eventsToday.map(event).join('\n') || '-'}`,
    `\nEVENTS NEXT 7 DAYS:\n${s.eventsWeek.map(event).join('\n') || '-'}`,
    `\nNOTES:\n${db.notes.slice(0, 15).map(n => `[${n.id}] ${n.title}: ${n.body.slice(0, 100).replace(/\n/g, ' ')}`).join('\n') || '-'}`,
    `\nSTICKIES:\n${db.stickies.map(x => `[${x.id}] ${x.text}`).join('\n') || '-'}`,
    `\nTODAY'S JOURNAL: gratitude ${JSON.stringify(d.gratitude.map(x => x.text))} · wins ${JSON.stringify(d.wins.map(x => x.text))} · lessons ${JSON.stringify(d.lessons.map(x => x.text))}\n${d.journal.slice(-1500) || '(journal empty)'}`,
    `\nTODAY'S LOG: metrics ${JSON.stringify(d.metrics)}\n${d.entries.slice(-40).map(e => `${e.t} [${e.type}] ${e.text}`).join('\n') || '-'}`,
    `\nLAST 3 DAYS:\n${recent.join('\n') || '-'}`,
  ].join('\n');
}

function system() {
  const profile = PROFILE ? fs.readFileSync(PROFILE, 'utf8') : '';
  return `You are the life coach inside "Life OS", the user's personal app for tasks, calendar, notes, stickies and a daily log.
You have full read/write/execute access: act directly when the user asks, or when an action is obviously helpful (e.g. logging something they just told you). Don't ask permission for small things; do confirm before deleting anything they didn't name.

${profile}

Respond ONLY with JSON: {"reply": string, "actions": Action[]}
Keep replies short, direct, and honest — push back when they're overloading or avoiding the important thing.
Action types (ids come from the [brackets] in the state below; dates YYYY-MM-DD, times HH:MM 24h, priority 1=highest..4):
- {"type":"add_task","title","due"?,"time"?,"priority"?,"notes"?}
- {"type":"update_task","id", ...fields}
- {"type":"complete_task","id","done"?:boolean}
- {"type":"delete_task","id"}
- {"type":"add_event","title","date","start"?,"end"?,"notes"?}
- {"type":"update_event","id", ...fields} / {"type":"delete_event","id"} (local events only)
- {"type":"add_note","title","body"} / {"type":"update_note","id","body"}
- {"type":"add_sticky","text","color"?:"yellow|pink|blue|green"} / {"type":"delete_sticky","id"}
- {"type":"log","text","kind"?:"journal|win|lesson|health|coach-note"}  — compact, one line
- {"type":"add_reflection","kind":"gratitude|win|lesson","text"}  — one short line for today's journal page
- {"type":"append_journal","text"}  — adds a timestamped paragraph to today's journal (only when the user asks, or dictates journal content)
- {"type":"set_metric","key","value"}  — e.g. mood 1-10, energy 1-10, sleep hours, focus 1-10
- {"type":"set_summary","text"}  — end-of-day summary, 2-4 dense sentences: what got done, what slipped and why, one lesson
If the user shares a win, a lesson or something they're grateful for, add it with add_reflection. Other notable things (how they feel, health) go in log; set metrics if they give numbers.

CURRENT STATE:
${context()}`;
}

async function callModel(messages) {
  const p = provider();
  if (p.name === 'gemini') {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${p.model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system() }] },
        contents: messages.map(m => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content }] })),
        generationConfig: { responseMimeType: 'application/json', temperature: 0.6 },
      }),
    });
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const j = await res.json();
    return j.candidates?.[0]?.content?.parts?.map(x => x.text).join('') || '{}';
  }
  if (p.name === 'ollama') {
    const res = await fetch(`${process.env.OLLAMA_URL || 'http://localhost:11434'}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: p.model, stream: false, format: 'json', messages: [{ role: 'system', content: system() }, ...messages] }),
    });
    if (!res.ok) throw new Error(`Ollama ${res.status}`);
    return (await res.json()).message.content;
  }
  return JSON.stringify({ reply: offlineBriefing(), actions: [] });
}

function offlineBriefing() {
  const s = ops.snapshot();
  const lines = [`Offline mode — add a free GEMINI_API_KEY to .env for the real coach.`, ''];
  if (s.overdue.length) lines.push(`Overdue (${s.overdue.length}): ${s.overdue.slice(0, 5).map(t => t.title).join('; ')}`);
  lines.push(`Due today (${s.dueToday.length}): ${s.dueToday.map(t => t.title).join('; ') || 'nothing'}`);
  lines.push(`Events today: ${s.eventsToday.map(e => `${e.start || 'all-day'} ${e.title}`).join('; ') || 'none'}`);
  const p1 = [...s.overdue, ...s.dueToday].filter(t => t.priority === 1);
  if (p1.length) lines.push(`Start with: ${p1[0].title}`);
  return lines.join('\n');
}

function parse(raw) {
  try { return JSON.parse(raw); } catch {}
  const m = raw.match(/\{[\s\S]*\}/);
  try { return m ? JSON.parse(m[0]) : null; } catch { return null; }
}

export async function chat(message) {
  db.coach.push({ role: 'user', content: message, ts: new Date().toISOString() });
  const history = db.coach.slice(-12).map(({ role, content }) => ({ role, content }));
  const out = parse(await callModel(history)) || { reply: 'Sorry — I garbled that response. Try again?', actions: [] };

  const results = [];
  for (const a of Array.isArray(out.actions) ? out.actions : []) {
    try {
      if (!ACTIONS[a.type]) throw new Error(`unknown action ${a.type}`);
      ACTIONS[a.type](a);
      results.push({ type: a.type, ok: true, label: a.title || a.text || a.key || a.id });
    } catch (e) {
      results.push({ type: a.type, ok: false, error: e.message });
    }
  }
  const reply = String(out.reply || '');
  db.coach.push({ role: 'model', content: reply, actions: results, ts: new Date().toISOString() });
  db.coach = db.coach.slice(-60);
  save();
  if (provider().name !== 'offline') {
    log('coach', `"${message.slice(0, 120)}" → ${results.length ? results.map(r => r.type + (r.ok ? '' : '✗')).join(', ') : 'advice only'}`);
  }
  return { reply, actions: results };
}
