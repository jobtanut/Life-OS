// Life OS front end — single-page dashboard: tasks | calendar | check-in, log, stickies, notes. Coach is a popup.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let S = null;                 // server state
let weekStart = null;         // Sunday of the shown week
let coachBusy = false;
let showDone = false;
const COLORS = ['yellow', 'pink', 'blue', 'green'];
const HOUR = 44;

async function api(method, url, body) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json();
  if (!res.ok) { toast(data.error || 'Something went wrong'); throw new Error(data.error); }
  return data;
}
const load = async () => { S = await api('GET', '/api/state'); };
const refresh = async () => { await load(); renderAll(); };

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), 2200);
}

// ---- dates
const iso = d => d.toLocaleDateString('en-CA');
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); };
const sundayOf = s => addDays(s, -new Date(s + 'T12:00:00').getDay());
const fmtDate = (s, o = { weekday: 'short', day: 'numeric', month: 'short' }) => new Date(s + 'T12:00:00').toLocaleDateString('en-GB', o);
const relDate = s => s === S.today ? 'Today' : s === addDays(S.today, 1) ? 'Tomorrow' : s === addDays(S.today, -1) ? 'Yesterday' : fmtDate(s);
const pad = n => String(n).padStart(2, '0');
const mins = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

// ================= Header
function renderHeader() {
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const isSat = new Date().getDay() === 6;
  $('#greeting').innerHTML = `<b>${hello}${S.name ? ', ' + esc(S.name) : ''}</b> · ${fmtDate(S.today, { weekday: 'long', day: 'numeric', month: 'long' })}${isSat ? ' · <span class="rest">Rest day — no work</span>' : ''}`;
  const s = S.status;
  $('#status').innerHTML = `
    <span><i class="dot ${s.coach.name !== 'offline' ? 'on' : ''}"></i>Coach</span>
    <span><i class="dot ${s.todoist ? 'on' : ''}"></i>Todoist</span>
    <span><i class="dot ${s.gcal.length ? 'on' : ''}"></i>Calendar</span>
    ${s.lastSync ? `<span>synced ${new Date(s.lastSync).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>` : ''}`;
}

// ================= Tasks (left)
function taskRow(t) {
  const late = t.due && t.due < S.today && !t.done;
  const meta = [
    t.due && `<span class="${late ? 'late' : ''}">${relDate(t.due)}${t.time ? ' ' + t.time : ''}</span>`,
    t.project && `#${esc(t.project)}`,
    t.recurring && '↻',
  ].filter(Boolean).join(' · ');
  return `<div class="task ${t.done ? 'done' : ''}" data-id="${t.id}">
    <button class="check p${t.priority || 4}" data-act="toggle" title="Complete"></button>
    <div class="grow"><div class="title" contenteditable="plaintext-only" data-act="rename">${esc(t.title)}</div>${meta ? `<div class="meta">${meta}</div>` : ''}</div>
    <button class="x" data-act="del" title="Delete">✕</button>
  </div>`;
}
const sortTasks = ts => [...ts].sort((a, b) => (a.priority || 4) - (b.priority || 4) || (a.due || '9').localeCompare(b.due || '9') || (a.time || '').localeCompare(b.time || ''));

function renderTasks() {
  const open = S.tasks.filter(t => !t.done);
  const groups = [
    ['Overdue', open.filter(t => t.due && t.due < S.today), 'late'],
    ['Today', open.filter(t => t.due === S.today)],
    ['Next 7 days', open.filter(t => t.due > S.today && t.due <= addDays(S.today, 7))],
    ['Later', open.filter(t => t.due > addDays(S.today, 7))],
    ['No date', open.filter(t => !t.due)],
  ];
  const doneToday = S.tasks.filter(t => t.done && t.doneAt?.startsWith(S.today));
  const allClear = !groups[0][1].length && !groups[1][1].length; // nothing overdue, nothing left today
  const projects = S.projects.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  $('#tasksPanel').innerHTML = `
    <div class="phead"><h2>Tasks</h2><span class="count">${open.length} open · ${doneToday.length} done today</span></div>
    <form class="addtask">
      <input type="text" name="title" placeholder="+ Add a task…" required autocomplete="off">
      <div class="row">
        <input type="date" name="due" value="${S.today}">
        <input type="time" name="time">
        <input type="number" name="duration" min="5" step="5" placeholder="min" title="Estimated minutes">
        <select name="priority"><option value="1">P1</option><option value="2">P2</option><option value="3">P3</option><option value="4" selected>P4</option></select>
        ${projects ? `<select name="projectId"><option value="">Inbox</option>${projects}</select>` : ''}
      </div>
    </form>
    <div class="scroll tasks">
      ${allClear ? `<div class="allclear"><div class="cheer-title">✓ ${esc(allClearCompliment(doneToday.length))}</div>${aheadBlock()}</div>` : ''}
      ${groups.filter(([, ts]) => ts.length).map(([name, ts, cls]) => `<h3 class="${cls || ''}">${name} · ${ts.length}</h3>${sortTasks(ts).map(taskRow).join('')}`).join('')}
      ${doneToday.length ? `<h3 class="toggle" id="toggleDone">${showDone ? '▾' : '▸'} Done today · ${doneToday.length}</h3>${showDone ? doneToday.map(taskRow).join('') : ''}` : ''}
    </div>`;
  const panel = $('#tasksPanel');
  $('.addtask', panel).addEventListener('submit', async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const body = { title: f.title, priority: +f.priority };
    if (f.due) body.due = f.due;
    if (f.time) body.time = f.time;
    if (f.duration) body.duration = +f.duration;
    if (f.projectId) { body.projectId = f.projectId; body.project = S.projects.find(p => p.id === f.projectId)?.name; }
    await api('POST', '/api/tasks', body);
    toast('Task added'); await refresh(); $('#tasksPanel [name=title]').focus();
  });
  $('#toggleDone')?.addEventListener('click', () => { showDone = !showDone; renderTasks(); });
}
// Delegated once — panel content is re-rendered, the panel element isn't.
function bindTasks() {
  const root = $('#tasksPanel');
  root.addEventListener('click', async e => {
    const row = e.target.closest('.task'); if (!row) return;
    const t = S.tasks.find(x => x.id === row.dataset.id);
    if (e.target.dataset.act === 'toggle') {
      const completing = !t.done;
      await api('POST', '/api/tasks/complete', { id: t.id, done: completing });
      await refresh();
      completing ? celebrate(t) : toast('Reopened');
    }
    if (e.target.dataset.act === 'del' && confirm(`Delete "${t.title}"?`)) { await api('DELETE', `/api/tasks/${t.id}`); refresh(); }
  });
  root.addEventListener('focusout', async e => {
    if (e.target.dataset.act !== 'rename') return;
    const t = S.tasks.find(x => x.id === e.target.closest('.task').dataset.id);
    const title = e.target.textContent.trim();
    if (title && title !== t.title) { await api('PATCH', `/api/tasks/${t.id}`, { title }); await load(); }
  });
  root.addEventListener('keydown', e => { if (e.target.dataset.act === 'rename' && e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });
}

// ================= Calendar (centre)
function renderCal() {
  weekStart ??= sundayOf(S.today);
  const keepScroll = $('#calPanel .hours')?.scrollTop;
  const days = [...Array(7)].map((_, i) => addDays(weekStart, i));
  const evs = d => S.events.filter(e => e.date === d);
  const dueTasks = d => S.tasks.filter(t => !t.done && t.due === d && !t.time);
  const timedTasks = d => S.tasks.filter(t => !t.done && t.due === d && t.time);
  const nowTop = (new Date().getHours() * 60 + new Date().getMinutes()) / 60 * HOUR;
  const end = fmtDate(days[6], { day: 'numeric', month: 'short' });
  $('#calPanel').innerHTML = `
    <div class="phead">
      <h2>${fmtDate(weekStart, { day: 'numeric', month: 'short' })} – ${end}</h2>
      <span class="spacer"></span>
      <button data-nav="-7">‹</button><button data-nav="0">Today</button><button data-nav="7">›</button>
    </div>
    <div class="week">
      <div class="dayheads"><div></div>
        ${days.map(d => `<div class="dayhead ${d === S.today ? 'today' : ''} ${new Date(d + 'T12:00').getDay() === 6 ? 'sat' : ''}">${fmtDate(d, { weekday: 'short' })} <b>${+d.slice(8)}</b></div>`).join('')}
      </div>
      <div class="allday"><div class="lbl">all-day</div>
        ${days.map(d => `<div>${evs(d).filter(e => !e.start).map(e => `<div class="chip ev-${e.source}" title="${esc(e.title)} · ${esc(e.calendar)}">${esc(e.title)}</div>`).join('')}${dueTasks(d).map(t => `<div class="chip task-chip p${t.priority || 4}" title="Task">☐ ${esc(t.title)}</div>`).join('')}</div>`).join('')}
      </div>
      <div class="hours">
        <div class="hourlabels">${[...Array(24)].map((_, h) => `<div>${h ? pad(h) + ':00' : ''}</div>`).join('')}</div>
        ${days.map(d => `<div class="col ${d === S.today ? 'is-today' : ''}" data-date="${d}">
          ${[...Array(24)].map((_, h) => `<div class="slot" data-hour="${h}"></div>`).join('')}
          ${evs(d).filter(e => e.start).map(e => {
            const top = mins(e.start) / 60 * HOUR;
            const h = Math.max(((e.end ? mins(e.end) : mins(e.start) + 60) - mins(e.start)) / 60 * HOUR, 18);
            return `<div class="ev ${e.source}" data-id="${e.id}" style="top:${top}px;height:${h}px" title="${esc(e.title)} · ${esc(e.calendar)}">${esc(e.title)}<small>${e.start}${e.end ? '–' + e.end : ''}</small></div>`;
          }).join('')}
          ${timedTasks(d).map(t => `<div class="ev taskev p${t.priority || 4}" style="top:${mins(t.time) / 60 * HOUR}px;height:20px" title="Task">☐ ${esc(t.title)}</div>`).join('')}
          ${d === S.today ? `<div class="nowline" style="top:${nowTop}px"></div>` : ''}
        </div>`).join('')}
      </div>
    </div>`;
  $('#calPanel .hours').scrollTop = keepScroll ?? 7 * HOUR;
}
function bindCal() {
  const root = $('#calPanel');
  root.addEventListener('click', async e => {
    const nav = e.target.closest('[data-nav]');
    if (nav) { const n = +nav.dataset.nav; weekStart = n ? addDays(weekStart, n) : sundayOf(S.today); return renderCal(); }
    const ev = e.target.closest('.ev[data-id]');
    if (ev) {
      const item = S.events.find(x => x.id === ev.dataset.id);
      if (item.source === 'gcal') return toast('Read-only — edit it in Google Calendar');
      const title = prompt('Rename event (leave blank to delete):', item.title);
      if (title === null) return;
      if (title.trim()) await api('PATCH', `/api/events/${item.id}`, { title: title.trim() });
      else if (confirm('Delete this event?')) await api('DELETE', `/api/events/${item.id}`);
      return refresh();
    }
    const slot = e.target.closest('.slot'); if (!slot) return;
    const date = slot.parentElement.dataset.date, h = +slot.dataset.hour;
    const title = prompt(`New event — ${fmtDate(date)} ${pad(h)}:00`);
    if (!title?.trim()) return;
    const dur = prompt('Duration in minutes', '60');
    const endMin = Math.min(h * 60 + (+dur || 60), 23 * 60 + 59);
    await api('POST', '/api/events', { title: title.trim(), date, start: `${pad(h)}:00`, end: `${pad(Math.floor(endMin / 60))}:${pad(endMin % 60)}` });
    refresh();
  });
}

// ================= Side (right): stickies, notes
function renderSide() {
  const notes = [...S.notes].sort((a, b) => (b.pinned - a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
  $('#sidePanel').innerHTML = `<div class="scroll">
    <div class="phead"><h2>Stickies</h2><span class="spacer"></span>${COLORS.map(c => `<button class="swatch ${c}" data-new="${c}" title="New ${c} sticky">+</button>`).join('')}</div>
    <div class="stickies">${S.stickies.map(s => `<div class="sticky ${s.color}" data-id="${s.id}">
        <div class="grip"><button data-color title="Colour">◐</button><button data-del title="Delete">✕</button></div>
        <div class="txt" contenteditable="plaintext-only">${esc(s.text)}</div></div>`).join('') || '<div class="empty">No stickies.</div>'}</div>

    <div class="phead"><h2>Notes</h2><button class="link" id="newNote">+ New</button></div>
    <div class="notelist">${notes.map(n => `<div class="noteitem" data-id="${n.id}"><b>${n.pinned ? '📌 ' : ''}${esc(n.title)}</b><small>${esc(n.body.slice(0, 70)) || 'Empty'}</small></div>`).join('') || '<div class="empty">No notes yet.</div>'}</div>
  </div>`;
}
function bindSide() {
  const root = $('#sidePanel');
  root.addEventListener('click', async e => {
    if (e.target.id === 'newNote') { const n = await api('POST', '/api/notes', { title: 'Untitled' }); await refresh(); return openNote(n.id); }
    const note = e.target.closest('.noteitem'); if (note) return openNote(note.dataset.id);
    const nw = e.target.closest('[data-new]');
    if (nw) { await api('POST', '/api/stickies', { color: nw.dataset.new }); await refresh(); return $$('#sidePanel .sticky .txt').at(-1)?.focus(); }
    const st = e.target.closest('.sticky'); if (!st) return;
    const s = S.stickies.find(x => x.id === st.dataset.id);
    if (e.target.hasAttribute('data-del') && confirm('Delete sticky?')) { await api('DELETE', `/api/stickies/${s.id}`); refresh(); }
    if (e.target.hasAttribute('data-color')) {
      s.color = COLORS[(COLORS.indexOf(s.color) + 1) % COLORS.length];
      st.className = `sticky ${s.color}`;
      api('PATCH', `/api/stickies/${s.id}`, { color: s.color });
    }
  });
  root.addEventListener('focusout', e => {
    if (!e.target.classList.contains('txt')) return;
    const s = S.stickies.find(x => x.id === e.target.parentElement.dataset.id);
    if (s && e.target.innerText !== s.text) { s.text = e.target.innerText; api('PATCH', `/api/stickies/${s.id}`, { text: s.text }); }
  });
}

// ================= Modal: note editor, full log
function openModal(html) { $('#modalCard').innerHTML = html; $('#modal').hidden = false; }
function closeModal() { $('#modal').hidden = true; $('#modalCard').innerHTML = ''; refresh(); }
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal' || e.target.dataset.close !== undefined) closeModal(); });
addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });

function openNote(key) {
  const n = S.notes.find(x => x.id === key);
  openModal(`<div class="editor">
    <div class="row"><input class="grow ntitle" value="${esc(n.title)}">
      <button id="pin">${n.pinned ? 'Unpin' : 'Pin'}</button><button id="delNote">Delete</button><button class="ghost" data-close>✕</button></div>
    <textarea class="nbody" placeholder="Write…">${esc(n.body)}</textarea>
    <div class="sub" id="saved">Saved</div>
  </div>`);
  const title = $('#modalCard .ntitle'), body = $('#modalCard .nbody');
  let timer;
  const save = () => {
    $('#saved').textContent = 'Saving…';
    clearTimeout(timer);
    timer = setTimeout(async () => { await api('PATCH', `/api/notes/${n.id}`, { title: title.value, body: body.value }); $('#saved').textContent = 'Saved'; }, 500);
  };
  title.oninput = body.oninput = save;
  $('#pin').onclick = async () => { await api('PATCH', `/api/notes/${n.id}`, { pinned: !n.pinned }); n.pinned = !n.pinned; $('#pin').textContent = n.pinned ? 'Unpin' : 'Pin'; };
  $('#delNote').onclick = async () => { if (confirm('Delete this note?')) { await api('DELETE', `/api/notes/${n.id}`); closeModal(); } };
  (n.title === 'Untitled' ? title : body).focus();
  if (n.title === 'Untitled') title.select();
}

// ================= Completion: compliment + "get ahead" suggestions
const DINNER = 19 * 60 + 30;   // no work suggestions after this (no work after dinner)
const DEFAULT_EST = 30;        // minutes, when a task has no duration

const pick = arr => arr[Math.floor(Math.random() * arr.length)];
function compliment(t) {
  const doneToday = S.tasks.filter(x => x.done && x.doneAt?.startsWith(S.today)).length;
  const leftToday = S.tasks.filter(x => !x.done && x.due && x.due <= S.today).length;
  if (t.due && t.due > S.today) return pick([
    `Done before it was even due. Future you owes you one.`,
    `Early. That's the whole game, really.`,
    `${relDate(t.due)}'s problem, solved today. Rather good.`,
  ]);
  if (t.due && t.due < S.today) return pick([
    `Overdue no longer. That one was weighing on you.`,
    `Finally off the list. Better late than carried.`,
  ]);
  if (!leftToday && doneToday > 1) return `That's today cleared — ${doneToday} done. Properly good day.`;
  if (t.priority === 1) return pick([
    `A P1, done. That's the one that mattered.`,
    `The hard one first. Quite right.`,
    `Non-negotiable, handled.`,
  ]);
  if (doneToday >= 5) return `${doneToday} today. You're on a roll — don't let it go to your head.`;
  return pick([`Done. One less thing.`, `Ticked off. Keep it moving.`, `Nicely done.`, `That's ${doneToday} today.`]);
}

const nowMin = () => new Date().getHours() * 60 + new Date().getMinutes();
const fmtMin = m => m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ' ' + (m % 60) + 'm' : ''}` : `${m}m`;

// How long until the next thing on today's calendar (capped at dinner)
function freeWindow() {
  const now = nowMin();
  const next = S.events
    .filter(e => e.date === S.today && e.start && mins(e.start) > now)
    .sort((a, b) => mins(a.start) - mins(b.start))[0];
  const timedTask = S.tasks
    .filter(t => !t.done && t.due === S.today && t.time && mins(t.time) > now)
    .sort((a, b) => mins(a.time) - mins(b.time))[0];
  const stops = [DINNER, next && mins(next.start), timedTask && mins(timedTask.time)].filter(Boolean);
  const until = Math.min(...stops);
  const label = until === DINNER ? 'dinner' : next && mins(next.start) === until ? next.title : timedTask.title;
  return { minutes: Math.max(0, until - now), until, label };
}

// Future work that could be done now, best first: priority, then how soon it's due.
function getAhead(free) {
  const horizon = addDays(S.today, 14);
  const daysOut = d => d ? Math.round((new Date(d + 'T12:00') - new Date(S.today + 'T12:00')) / 864e5) : 14;
  return S.tasks
    .filter(t => !t.done && !t.recurring && (t.due ? t.due > S.today && t.due <= horizon : (t.priority || 4) <= 3))
    .map(t => {
      const est = t.duration || DEFAULT_EST;
      const score = (5 - (t.priority || 4)) * 10 + Math.max(0, 14 - daysOut(t.due)) * 1.5;
      return { t, est, fits: est <= free, score };
    })
    .sort((a, b) => b.fits - a.fits || b.score - a.score)
    .slice(0, 3);
}

// Get-ahead suggestions, respecting rest day, dinner cut-off and the free window. Shared by the
// completion popup and the all-clear card.
function aheadBlock() {
  if (new Date().getDay() === 6) return `<div class="cheer-note">It's Saturday. Nothing else to do — go rest.</div>`;
  if (nowMin() >= DINNER) return `<div class="cheer-note">It's after dinner. Call it a day.</div>`;
  const free = freeWindow();
  if (free.minutes < 15) return `<div class="cheer-note">Next up: ${esc(free.label)} in ${fmtMin(free.minutes)}. No room to get ahead just now.</div>`;
  const ideas = getAhead(free.minutes);
  if (!ideas.length) return `<div class="cheer-note">Nothing in the next two weeks to get ahead on. Enjoy the slack.</div>`;
  return `<div class="cheer-sub">Get ahead? You've <b>${fmtMin(free.minutes)}</b> free before ${esc(free.label)}.</div>
    ${ideas.map(({ t: x, est, fits }) => `<div class="ahead ${fits ? '' : 'nofit'}" data-id="${x.id}">
      <span class="check p${x.priority || 4}"></span>
      <div class="grow"><div>${esc(x.title)}</div><div class="meta">${x.due ? 'due ' + relDate(x.due) : 'no date'} · ~${fmtMin(est)}${x.duration ? '' : ' (guess)'}${fits ? '' : ' · won\'t fit now'}</div></div>
      ${fits ? `<button class="primary" data-start="${x.id}" data-est="${est}">Start now</button>` : ''}
    </div>`).join('')}`;
}

// Stable per day (not random), so the card doesn't change wording on every refresh.
function allClearCompliment(doneCount) {
  const lines = doneCount
    ? [`Today's list is clear — ${doneCount} done. That's the job.`, `All clear. ${doneCount} done and nothing hanging over you.`, `Cleared. Rather satisfying, isn't it?`]
    : [`Nothing due today. Clean slate.`, `Nothing on fire today. Use it well.`];
  return lines[(doneCount + +S.today.slice(8)) % lines.length];
}

function celebrate(t) {
  const box = $('#cheer');
  const restTime = new Date().getDay() === 6 || nowMin() >= DINNER;
  const leftToday = sortTasks(S.tasks.filter(x => !x.done && x.due && x.due <= S.today));
  const body = leftToday.length && !restTime
    ? `<div class="cheer-note">Still due today: <b>${esc(leftToday[0].title)}</b>${leftToday.length > 1 ? ` (+${leftToday.length - 1} more)` : ''}. Clear that before getting ahead.</div>`
    : aheadBlock();
  box.innerHTML = `<button class="ghost cheer-x" data-close>✕</button><div class="cheer-title">✓ ${esc(compliment(t))}</div>${body}`;
  box.hidden = false;
  clearTimeout(celebrate.h);
  const hasIdeas = !!$('.ahead', box);
  if (!hasIdeas) celebrate.h = setTimeout(() => (box.hidden = true), 6000);
}

// "Start now" lives in both the popup and the all-clear card, so listen at document level.
document.addEventListener('click', async e => {
  if (e.target.closest('#cheer') && e.target.dataset.close !== undefined) return ($('#cheer').hidden = true);
  const id = e.target.dataset.start; if (!id) return;
  const t = S.tasks.find(x => x.id === id);
  const start = Math.ceil(nowMin() / 5) * 5, end = Math.min(start + +e.target.dataset.est, 23 * 60 + 59);
  const hhmm = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  await api('POST', '/api/events', { title: `⚡ ${t.title}`, date: S.today, start: hhmm(start), end: hhmm(end) });
  await api('POST', '/api/journal', { type: 'ahead', text: `Started early: ${t.title}${t.due ? ` (due ${t.due})` : ''}` });
  $('#cheer').hidden = true;
  toast(`Blocked ${hhmm(start)}–${hhmm(end)}. Off you go.`);
  refresh();
});

// ================= Pulse page: journal — check-in, gratitude / wins / lessons, free-form journal
let pulseDate = null;
let journalTimer = null;
let showActivity = false;
const REFLECT = [
  { kind: 'gratitude', key: 'gratitude', icon: '🙏', title: 'Gratitude', hint: "I'm grateful for…" },
  { kind: 'win', key: 'wins', icon: '🏆', title: 'Wins', hint: 'A win today…' },
  { kind: 'lesson', key: 'lessons', icon: '💡', title: 'Lessons', hint: 'I learnt…' },
];

// 1–3 red, 4–6 yellow, 7–9 green, 10 blue; unset stays neutral
const scoreBand = v => v == null ? '' : v <= 3 ? 'band-red' : v <= 6 ? 'band-yellow' : v <= 9 ? 'band-green' : 'band-blue';

async function renderPulse() {
  await flushJournal();
  pulseDate ??= S.today;
  const [dates, d] = await Promise.all([api('GET', '/api/days'), api('GET', `/api/day?date=${pulseDate}`)]);
  const m = d.metrics;
  const words = d.journal.trim() ? d.journal.trim().split(/\s+/).length : 0;
  $('#pulsePage').innerHTML = `
    <div class="pulsehead">
      <div>
        <h1>${fmtDate(pulseDate, { weekday: 'long', day: 'numeric', month: 'long' })}</h1>
      </div>
      <span class="spacer"></span>
      <button data-day="-1" title="Previous day">‹</button>
      <select id="logDate">${[...new Set([S.today, ...dates])].sort().reverse().map(x => `<option ${x === pulseDate ? 'selected' : ''} value="${x}">${relDate(x)} · ${x}</option>`).join('')}</select>
      <button data-day="1" title="Next day" ${pulseDate >= S.today ? 'disabled' : ''}>›</button>
    </div>

    <div class="panel checkin">
      <h2>Check-in</h2>
      ${['mood', 'energy', 'focus'].map(k => `<div class="metric ${scoreBand(m[k])}"><label>${k}<b id="v-${k}">${m[k] ?? '–'}</b></label><input type="range" min="1" max="10" value="${m[k] ?? 5}" data-metric="${k}" style="--pct:${m[k] == null ? 0 : (m[k] - 1) / 9 * 100}%"></div>`).join('')}
      <div class="metric sleep"><label>sleep (h)</label><input type="number" step="0.25" min="0" max="14" value="${m.sleep ?? ''}" data-metric="sleep" placeholder="–"></div>
    </div>

    <div class="reflect">
      ${REFLECT.map(r => `<div class="panel rcard" data-kind="${r.kind}">
        <h2>${r.icon} ${r.title} <span class="count">${d[r.key].length || ''}</span></h2>
        <ul>${d[r.key].map((x, i) => `<li><span class="grow">${esc(x.text)}</span><button class="x" data-del="${i}" title="Remove">✕</button></li>`).join('')}</ul>
        <form class="radd"><input type="text" name="text" placeholder="${r.hint}" autocomplete="off" required></form>
      </div>`).join('')}
    </div>

    <div class="panel journalcard">
      <div class="phead">
        <h2>✍️ Journal</h2>
        <span class="count" id="jstatus">${words} words</span>
        <button class="link" id="stamp" title="Add a timestamped entry">+ New entry</button>
      </div>
      <textarea id="journal" placeholder="Write anything. Come back and add to it through the day — “+ New entry” timestamps each bit.">${esc(d.journal)}</textarea>
    </div>

    <div class="panel">
      <div class="phead"><h2>Day summary</h2><span class="spacer"></span><button class="link" id="saveSummary">Save</button></div>
      <textarea id="summary" rows="2" placeholder="Two lines on how the day went (or ask the coach for an end-of-day review)">${esc(d.summary)}</textarea>
    </div>

    <div class="activity">
      <h3 class="toggle" id="toggleActivity">${showActivity ? '▾' : '▸'} Activity · ${d.entries.length}</h3>
      ${showActivity ? `<div class="log full">${[...d.entries].reverse().map(e => `<div class="logentry"><span class="t">${e.t}</span><span class="ty">${esc(e.type)}</span><span class="tx">${esc(e.text)}</span></div>`).join('') || '<div class="empty">Nothing yet.</div>'}</div>` : ''}
    </div>`;
}

// Debounced save. Text and date are captured when typed, and any pending save is flushed before
// the page switches day — so nothing is lost or written to the wrong date.
let pendingJournal = null;
async function flushJournal() {
  clearTimeout(journalTimer);
  const p = pendingJournal; pendingJournal = null;
  if (!p) return;
  await api('POST', '/api/day/journal', p);
  const words = p.text.trim() ? p.text.trim().split(/\s+/).length : 0;
  if (p.date === pulseDate && $('#jstatus')) $('#jstatus').textContent = `${words} words · saved`;
}
function saveJournal() {
  clearTimeout(journalTimer);
  pendingJournal = { text: $('#journal').value, date: pulseDate };
  $('#jstatus').textContent = 'Saving…';
  journalTimer = setTimeout(flushJournal, 600);
}

// Click a score number to type it instead of dragging. Enter/blur saves, Esc cancels.
function editScore(b) {
  const k = b.id.slice(2);
  const input = Object.assign(document.createElement('input'), { type: 'number', min: 1, max: 10, step: 1, className: 'scoreinput', value: /^\d+$/.test(b.textContent) ? b.textContent : '' });
  b.replaceWith(input);
  input.focus(); input.select();
  let done = false;
  const finish = async save => {
    if (done) return; done = true;
    const v = Math.round(+input.value);
    if (save && input.value !== '' && v >= 1 && v <= 10) {
      await api('POST', '/api/metric', { key: k, value: v, date: pulseDate });
      toast(`${k} saved`);
    } else if (save && input.value !== '') toast('Scores go from 1 to 10');
    renderPulse();
  };
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
}

function bindPulse() {
  const root = $('#pulsePage');
  root.addEventListener('input', e => {
    if (e.target.id === 'journal') return saveJournal();
    const k = e.target.dataset.metric;
    if (k && $(`#v-${k}`)) {
      $(`#v-${k}`).textContent = e.target.value;
      e.target.parentElement.className = `metric ${scoreBand(+e.target.value)}`;
      e.target.style.setProperty('--pct', `${(e.target.value - 1) / 9 * 100}%`);
    }
  });
  root.addEventListener('change', async e => {
    if (e.target.id === 'logDate') { pulseDate = e.target.value; return renderPulse(); }
    const k = e.target.dataset.metric; if (!k || e.target.value === '') return;
    await api('POST', '/api/metric', { key: k, value: +e.target.value, date: pulseDate });
    toast(`${k} saved`);
  });
  root.addEventListener('submit', async e => {
    e.preventDefault();
    const kind = e.target.closest('.rcard')?.dataset.kind; if (!kind) return;
    await api('POST', '/api/reflection', { kind, text: e.target.text.value, date: pulseDate });
    await renderPulse();
    $(`#pulsePage .rcard[data-kind="${kind}"] input`).focus();
  });
  root.addEventListener('click', async e => {
    const num = e.target.closest('.checkin .metric label b');
    if (num) return editScore(num);
    const nav = e.target.closest('[data-day]');
    if (nav) { pulseDate = addDays(pulseDate, +nav.dataset.day); return renderPulse(); }
    if (e.target.id === 'toggleActivity') { showActivity = !showActivity; return renderPulse(); }
    if (e.target.dataset.del !== undefined) {
      const kind = e.target.closest('.rcard').dataset.kind;
      await api('POST', '/api/reflection/delete', { kind, index: +e.target.dataset.del, date: pulseDate });
      return renderPulse();
    }
    if (e.target.id === 'stamp') {
      const ta = $('#journal');
      const stamp = `— ${pad(new Date().getHours())}:${pad(new Date().getMinutes())} —\n`;
      ta.value = ta.value.trimEnd() + (ta.value.trim() ? '\n\n' : '') + stamp;
      ta.focus(); ta.selectionStart = ta.selectionEnd = ta.value.length; ta.scrollTop = ta.scrollHeight;
      return saveJournal();
    }
    if (e.target.id === 'saveSummary') {
      await api('POST', '/api/summary', { text: $('#summary').value, date: pulseDate });
      toast('Summary saved');
    }
  });
}

// ================= Pages
let page = 'home';
function go(p) {
  page = p;
  $$('.menu [data-page]').forEach(b => b.classList.toggle('active', b.dataset.page === p));
  $('.layout').hidden = p !== 'home';
  $('#pulsePage').hidden = p !== 'pulse';
  renderAll();
}
$$('[data-page]').forEach(b => b.onclick = () => go(b.dataset.page));

// ================= Coach popup
const QUICK = {
  'Plan my day': 'Plan my day',
  'What next?': 'What should I do next?',
  'Unmotivated': "I'm feeling unmotivated",
  'End-of-day review': 'Run my end-of-day review: look at what got done and what slipped today, ask me nothing — just write the day summary with set_summary and tell me the one thing to fix tomorrow.',
};
function msgHtml(m) {
  const acts = (m.actions || []).map(a => `<span class="${a.ok ? '' : 'bad'}" title="${esc(a.error || '')}">${a.ok ? '✓' : '✗'} ${esc(a.type.replace('_', ' '))}${a.label ? ': ' + esc(String(a.label).slice(0, 40)) : ''}</span>`).join('');
  return `<div class="msg ${m.role}">${esc(m.content)}${acts ? `<div class="acts">${acts}</div>` : ''}</div>`;
}
function renderCoach() {
  const p = S.status.coach;
  $('#coachSub').textContent = p.name === 'offline' ? ' offline — add GEMINI_API_KEY' : ` ${p.model}`;
  $('#msgs').innerHTML = S.coach.map(msgHtml).join('') + (coachBusy ? '<div class="msg model typing">Thinking…</div>' : '')
    || '<div class="empty">Tell me how your day is going, or ask me to plan it.</div>';
  $('#msgs').scrollTop = 1e9;
}
async function sendCoach(text) {
  if (coachBusy) return;
  coachBusy = true;
  S.coach.push({ role: 'user', content: text });
  renderCoach();
  try { await api('POST', '/api/coach', { message: text }); }
  finally { coachBusy = false; await refresh(); }
}
function toggleCoach(open = $('#coachBox').hidden) {
  $('#coachBox').hidden = !open;
  $('#coachFab').classList.toggle('open', open);
  if (open) { renderCoach(); $('#composer textarea').focus(); }
}
$('#coachFab').onclick = () => toggleCoach();
$('#coachClose').onclick = () => toggleCoach(false);
$('#quick').innerHTML = Object.keys(QUICK).map(k => `<button data-q="${esc(k)}">${esc(k)}</button>`).join('');
$('#quick').onclick = e => { const k = e.target.dataset.q; if (k) sendCoach(QUICK[k]); };
$('#composer').onsubmit = e => { e.preventDefault(); const v = e.target.m.value.trim(); if (v) { e.target.m.value = ''; sendCoach(v); } };
$('#composer textarea').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#composer').requestSubmit(); } };

// ================= Settings dropdown (appearance is per-browser, so it lives in localStorage)
function currentTheme() { try { return localStorage.getItem('theme') || 'system'; } catch { return 'system'; } }
function applyTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  try { localStorage.setItem('theme', t); } catch {}
  $$('#themeSeg [data-theme]').forEach(b => b.classList.toggle('active', b.dataset.theme === t));
}
function toggleSettings(open = $('#settingsMenu').hidden) {
  $('#settingsMenu').hidden = !open;
  $('#settingsBtn').setAttribute('aria-expanded', open);
}
$('#settingsBtn').onclick = e => { e.stopPropagation(); toggleSettings(); };
$('#themeSeg').onclick = e => { const t = e.target.closest('[data-theme]')?.dataset.theme; if (t) applyTheme(t); };
document.addEventListener('click', e => { if (!e.target.closest('.settings')) toggleSettings(false); });
addEventListener('keydown', e => { if (e.key === 'Escape') toggleSettings(false); });
applyTheme(currentTheme());

// ================= Boot
function renderAll() {
  renderHeader();
  if (page === 'home') { renderTasks(); renderCal(); renderSide(); }
  else if (document.activeElement?.id !== 'journal') renderPulse();
  if (!$('#coachBox').hidden) renderCoach();
}

$('#syncBtn').onclick = async () => {
  const btn = $('#syncBtn');
  if (btn.classList.contains('spin')) return;
  btn.classList.add('spin');
  try {
    const r = await api('POST', '/api/sync');
    toast(`Todoist: ${r.todoist} · Calendar: ${r.gcal}`);
    await refresh();
  } finally { btn.classList.remove('spin'); }
};

bindTasks(); bindCal(); bindSide(); bindPulse();
await refresh();
setInterval(() => { if (page === 'home' && !document.hidden && $('#modal').hidden && !document.activeElement?.isContentEditable && document.activeElement?.tagName !== 'INPUT') renderCal(); }, 60_000); // keep the now-line moving
