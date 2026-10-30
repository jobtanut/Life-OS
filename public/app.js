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

// ================= Task <-> calendar block links
const eventOf = t => t.eventId ? S.events.find(e => e.id === t.eventId) : null;
const linkedTasks = e => S.tasks.filter(t => t.eventId === e.id);
const blockTime = e => `${e.start || 'All day'}${e.start && e.end ? '–' + e.end : ''}`;
function blockBadge(e) {
  const ts = linkedTasks(e);
  return ts.length ? `<span class="linkbadge">☑ ${ts.filter(t => t.done).length}/${ts.length}</span>` : '';
}
const blockDone = e => { const ts = linkedTasks(e); return ts.length > 0 && ts.every(t => t.done); };

// ================= Tasks (left)
function taskRow(t, { pick = false } = {}) {
  const late = t.due && t.due < S.today && !t.done;
  const meta = [
    t.due && `<span class="${late ? 'late' : ''}">${relDate(t.due)}${t.time ? ' ' + t.time : ''}</span>`,
    t.project && `#${esc(t.project)}`,
    t.recurring && '↻',
  ].filter(Boolean).join(' · ');
  const block = eventOf(t);
  return `<div class="task ${t.done ? 'done' : ''}" data-id="${t.id}">
    <button class="check p${t.priority || 4}" data-act="toggle" title="Complete"></button>
    <div class="grow"><div class="title" contenteditable="plaintext-only" data-act="rename">${esc(t.title)}</div>${meta ? `<div class="meta">${meta}</div>` : ''}${block ? `<button class="linkmeta" data-act="openblock">🔗 ${esc(block.title)} · ${blockTime(block)}</button>` : ''}</div>
    ${pick && !t.done && !t.recurring && !(t.due && t.due <= S.today) ? '<button class="dotoday" data-act="today" title="Move to today">Do today</button>' : ''}
    <button class="x" data-act="link" title="Link to a calendar block">🔗</button>
    <button class="x" data-act="del" title="Delete">✕</button>
  </div>`;
}
const sortTasks = ts => [...ts].sort((a, b) => (a.priority || 4) - (b.priority || 4) || (a.due || '9').localeCompare(b.due || '9') || (a.time || '').localeCompare(b.time || ''));

// Which list the task panel shows. Remembered per browser, as a convenience only.
let taskView = 'today';
try { taskView = localStorage.getItem('taskView') || 'today'; } catch {}
const collapsedProjects = new Set();
const inInbox = t => !t.project || t.project === 'Inbox';

function renderTasks() {
  const draft = $('#tasksPanel [name=title]')?.value || '';   // don't lose half-typed text on a re-render
  const open = S.tasks.filter(t => !t.done);
  const overdue = open.filter(t => t.due && t.due < S.today);
  const dueToday = open.filter(t => t.due === S.today);
  const doneToday = S.tasks.filter(t => t.done && t.doneAt?.startsWith(S.today));
  const inbox = open.filter(inInbox);
  const allClear = !overdue.length && !dueToday.length;
  const group = (name, ts, cls = '') => ts.length ? `<h3 class="${cls}">${name} · ${ts.length}</h3>${sortTasks(ts).map(t => taskRow(t)).join('')}` : '';

  const views = {
    today: () => `
      ${allClear ? `<div class="allclear"><div class="cheer-title">✓ ${esc(allClearCompliment(doneToday.length))}</div>${aheadBlock()}</div>` : ''}
      ${group('Overdue', overdue, 'late')}${group('Today', dueToday)}
      ${doneToday.length ? `<h3 class="toggle" id="toggleDone">${showDone ? '▾' : '▸'} Done today · ${doneToday.length}</h3>${showDone ? doneToday.map(t => taskRow(t)).join('') : ''}` : ''}`,
    upcoming: () => group('Next 7 days', open.filter(t => t.due > S.today && t.due <= addDays(S.today, 7)))
      + group('Later', open.filter(t => t.due > addDays(S.today, 7)))
      || '<div class="empty">Nothing scheduled ahead.</div>',
    inbox: () => inbox.length
      ? `<div class="sub viewhint">Pick what you'll do. “Do today” moves it onto today's list.</div>${sortTasks(inbox).map(t => taskRow(t, { pick: true })).join('')}`
      : '<div class="empty">Inbox empty. Anything with no project lands here.</div>',
    projects: () => {
      const names = [...new Set(open.filter(t => !inInbox(t)).map(t => t.project))].sort((a, b) => a.localeCompare(b));
      return names.map(name => {
        const ts = open.filter(t => t.project === name);
        const shut = collapsedProjects.has(name);
        return `<h3 class="toggle" data-project="${esc(name)}">${shut ? '▸' : '▾'} ${esc(name)} · ${ts.length}</h3>${shut ? '' : sortTasks(ts).map(t => taskRow(t, { pick: true })).join('')}`;
      }).join('') || '<div class="empty">No projects yet. Give a task a project and it shows up here.</div>';
    },
  };
  const tabs = [['today', 'Today', overdue.length + dueToday.length], ['upcoming', 'Upcoming', 0], ['inbox', 'Inbox', inbox.length], ['projects', 'Projects', 0]];
  // Todoist projects when connected; otherwise any name you type becomes a project.
  const knownNames = [...new Set(S.tasks.map(t => t.project).filter(p => p && p !== 'Inbox'))];
  const projectField = S.projects.length
    ? `<select name="projectId" title="Project"><option value="">Inbox</option>${S.projects.filter(p => p.name !== 'Inbox').map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>`
    : `<input type="text" name="project" placeholder="Project" title="Leave blank for Inbox" list="projectNames" autocomplete="off"><datalist id="projectNames">${knownNames.map(n => `<option value="${esc(n)}"></option>`).join('')}</datalist>`;

  $('#tasksPanel').innerHTML = `
    <div class="phead"><h2>Tasks</h2><span class="count">${open.length} open · ${doneToday.length} done today</span></div>
    <form class="addtask">
      <input type="text" name="title" placeholder="Task name" required autocomplete="off" value="${esc(draft)}">
      <div class="row">
        <input type="date" name="due" value="${taskView === 'today' ? S.today : ''}" title="Date (optional)">
        <input type="time" name="time" title="Time (optional)">
      </div>
      <div class="row">
        <input type="number" name="duration" min="5" step="5" placeholder="Minutes" title="Estimated minutes (optional)">
        <select name="priority" title="Priority"><option value="1">P1</option><option value="2">P2</option><option value="3">P3</option><option value="4" selected>P4</option></select>
        ${projectField}
      </div>
      <button class="primary addbtn" ${draft.trim() ? '' : 'disabled'}>Add task</button>
    </form>
    <div class="taskviews">${tabs.map(([k, label, n]) => `<button class="${k === taskView ? 'active' : ''}" data-view="${k}">${label}${n ? ` <span>${n}</span>` : ''}</button>`).join('')}</div>
    <div class="scroll tasks">${views[taskView]()}</div>`;

  const panel = $('#tasksPanel');
  const titleInput = $('[name=title]', panel);
  titleInput.addEventListener('input', () => { $('.addbtn', panel).disabled = !titleInput.value.trim(); });
  $('.addtask', panel).addEventListener('submit', async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    if (!f.title.trim()) return;
    const body = { title: f.title.trim(), priority: +f.priority };
    if (f.due) body.due = f.due;
    if (f.time) body.time = f.time;
    if (f.duration) body.duration = +f.duration;
    if (f.projectId) { body.projectId = f.projectId; body.project = S.projects.find(p => p.id === f.projectId)?.name; }
    if (f.project?.trim()) body.project = f.project.trim();
    await api('POST', '/api/tasks', body);
    e.target.reset();
    titleInput.value = '';
    toast('Task added'); await refresh(); $('#tasksPanel [name=title]').focus();
  });
  $('#toggleDone')?.addEventListener('click', () => { showDone = !showDone; renderTasks(); });
}
// Delegated once — panel content is re-rendered, the panel element isn't.
function bindTasks() {
  const root = $('#tasksPanel');
  root.addEventListener('click', async e => {
    const tab = e.target.closest('.taskviews [data-view]');
    if (tab) {
      taskView = tab.dataset.view;
      try { localStorage.setItem('taskView', taskView); } catch {}
      return renderTasks();
    }
    const head = e.target.closest('[data-project]');
    if (head) {
      const name = head.dataset.project;
      collapsedProjects.has(name) ? collapsedProjects.delete(name) : collapsedProjects.add(name);
      return renderTasks();
    }
    const row = e.target.closest('.task'); if (!row) return;
    const t = S.tasks.find(x => x.id === row.dataset.id);
    if (e.target.dataset.act === 'today') {
      await api('PATCH', `/api/tasks/${t.id}`, { due: S.today });
      toast('Moved to today');
      return refresh();
    }
    if (e.target.dataset.act === 'toggle') {
      const completing = !t.done;
      await api('POST', '/api/tasks/complete', { id: t.id, done: completing });
      await refresh();
      completing ? celebrate(t) : toast('Reopened');
    }
    if (e.target.dataset.act === 'del' && confirm(`Delete "${t.title}"?`)) { await api('DELETE', `/api/tasks/${t.id}`); refresh(); }
    if (e.target.dataset.act === 'link') openLinker(t.id);
    if (e.target.dataset.act === 'openblock') openEvent(t.eventId);
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
  const dueTasks = d => S.tasks.filter(t => !t.done && t.due === d && !t.time && !eventOf(t));
  const timedTasks = d => S.tasks.filter(t => !t.done && t.due === d && t.time && !eventOf(t));
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
        ${days.map(d => `<div>${evs(d).filter(e => !e.start).map(e => `<div class="chip ev-${e.source}" data-event="${e.id}" title="${esc(e.title)} · ${esc(e.calendar)}">${esc(e.title)} ${blockBadge(e)}</div>`).join('')}${dueTasks(d).map(t => `<div class="chip task-chip p${t.priority || 4}" title="Task">☐ ${esc(t.title)}</div>`).join('')}</div>`).join('')}
      </div>
      <div class="hours">
        <div class="hourlabels">${[...Array(24)].map((_, h) => `<div>${h ? pad(h) + ':00' : ''}</div>`).join('')}</div>
        ${days.map(d => `<div class="col ${d === S.today ? 'is-today' : ''}" data-date="${d}">
          ${[...Array(24)].map((_, h) => `<div class="slot" data-hour="${h}"></div>`).join('')}
          ${evs(d).filter(e => e.start).map(e => {
            const top = mins(e.start) / 60 * HOUR;
            const h = Math.max(((e.end ? mins(e.end) : mins(e.start) + 60) - mins(e.start)) / 60 * HOUR, 18);
            return `<div class="ev ${e.source} ${blockDone(e) ? 'alldone' : ''}" data-event="${e.id}" style="top:${top}px;height:${h}px" title="${esc(e.title)} · ${esc(e.calendar)}">${esc(e.title)} ${blockBadge(e)}<small>${e.start}${e.end ? '–' + e.end : ''}</small>${e.source === 'local' ? '<div class="resize" title="Drag to change length"></div>' : ''}</div>`;
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
    if (skipClick) { skipClick = false; return; }
    const nav = e.target.closest('[data-nav]');
    if (nav) { const n = +nav.dataset.nav; weekStart = n ? addDays(weekStart, n) : sundayOf(S.today); return renderCal(); }
    const ev = e.target.closest('[data-event]');
    if (ev) return openEvent(ev.dataset.event);
    // Mouse drags are handled below; a tap on a touch screen arrives here as a plain click.
    const slot = e.target.closest('.slot'); if (!slot) return;
    const col = slot.parentElement, start = snapMin(e.clientY - col.getBoundingClientRect().top);
    openNewBlock(col.dataset.date, start, Math.min(start + 60, DAY_END));
  });

  root.addEventListener('pointerdown', e => {
    skipClick = false;
    if (e.pointerType === 'touch' || e.button !== 0) return;
    const handle = e.target.closest('.resize');
    if (handle) return startResize(e, handle.closest('.ev'));
    if (e.target.closest('.slot')) startCreate(e, e.target.closest('.col'));
  });
}

// ---- Drag on the calendar: snaps to 15 minutes
const DAY_END = 24 * 60 - 1;
let calDragging = false;
let skipClick = false;   // the click that follows a drag shouldn't also open anything
const fmtHM = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const snapMin = y => Math.max(0, Math.min(DAY_END, Math.round(y / HOUR * 60 / 15) * 15));

function trackDrag(onMove, onEnd) {
  const hours = $('#calPanel .hours');
  calDragging = true;
  hours.classList.add('dragging');
  const move = e => {
    const r = hours.getBoundingClientRect();   // scroll when the pointer nears the edge
    if (e.clientY < r.top + 24) hours.scrollTop -= 14;
    else if (e.clientY > r.bottom - 24) hours.scrollTop += 14;
    onMove(e);
  };
  const stop = commit => {
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', up);
    removeEventListener('keydown', key);
    calDragging = false;
    hours.classList.remove('dragging');
    skipClick = true;
    onEnd(commit);
  };
  const up = () => stop(true);
  const key = e => { if (e.key === 'Escape') stop(false); };
  addEventListener('pointermove', move);
  addEventListener('pointerup', up);
  addEventListener('keydown', key);
}

function startCreate(e, col) {
  e.preventDefault();
  const yOf = ev => ev.clientY - col.getBoundingClientRect().top;
  const anchor = snapMin(yOf(e));
  const startY = e.clientY;
  let from = anchor, to = anchor, moved = false;
  const ghost = document.createElement('div');
  ghost.className = 'ev ghost';
  ghost.hidden = true;
  col.append(ghost);
  trackDrag(ev => {
    if (Math.abs(ev.clientY - startY) < 5 && !moved) return;
    moved = true;
    const at = snapMin(yOf(ev));
    from = Math.min(anchor, at);
    to = Math.max(anchor, at);
    if (to - from < 15) to = Math.min(from + 15, DAY_END);
    ghost.hidden = false;
    ghost.style.top = `${from / 60 * HOUR}px`;
    ghost.style.height = `${(to - from) / 60 * HOUR}px`;
    ghost.textContent = `${fmtHM(from)}–${fmtHM(to)}`;
  }, commit => {
    if (!commit) return ghost.remove();
    if (!moved) { from = anchor; to = Math.min(anchor + 60, DAY_END); }   // a plain click gives an hour
    openNewBlock(col.dataset.date, from, to, () => ghost.remove());
  });
}

function startResize(e, el) {
  e.preventDefault();
  const item = S.events.find(x => x.id === el.dataset.event);
  const start = mins(item.start);
  const col = el.parentElement;
  let end = item.end ? mins(item.end) : start + 60;
  const label = el.querySelector('small');
  trackDrag(ev => {
    end = Math.max(start + 15, snapMin(ev.clientY - col.getBoundingClientRect().top));
    el.style.height = `${(end - start) / 60 * HOUR}px`;
    label.textContent = `${item.start}–${fmtHM(end)}`;
  }, async commit => {
    if (commit && fmtHM(end) !== item.end) await api('PATCH', `/api/events/${item.id}`, { end: fmtHM(end) });
    refresh();
  });
}

// A block doesn't exist until it has a name: closing this discards the draft.
function openNewBlock(date, from, to, onClose) {
  openModal(`<form class="blockcard" id="newBlock">
    <div class="row"><div class="ntitle grow">New block</div><button type="button" class="ghost" data-close>✕</button></div>
    <input type="text" id="nbTitle" placeholder="What's this block for?" autocomplete="off" required>
    <div class="row">
      <input type="date" id="nbDate" value="${date}">
      <input type="time" id="nbStart" value="${fmtHM(from)}">
      <span class="sub">to</span>
      <input type="time" id="nbEnd" value="${fmtHM(to)}">
    </div>
    <div class="row"><span class="spacer"></span><button class="primary">Create block</button></div>
  </form>`);
  modalCleanup = onClose;
  $('#nbTitle').focus();
  $('#newBlock').onsubmit = async ev => {
    ev.preventDefault();
    const start = $('#nbStart').value, end = $('#nbEnd').value;
    if (start && end && end <= start) return toast('The block has to end after it starts');
    const made = await api('POST', '/api/events', { title: $('#nbTitle').value.trim(), date: $('#nbDate').value, start, end });
    onClose?.(); modalCleanup = null;
    await load(); renderAll();
    openEvent(made.id);
  };
}

// ================= Side (right): stickies, notes
function renderSide() {
  const notes = [...S.notes].sort((a, b) => (b.pinned - a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
  const goals = S.goals.filter(g => g.status === 'active' && goalWeekNo(g) >= 1);
  const thisWeek = sundayOf(S.today);
  $('#sidePanel').innerHTML = `<div class="scroll">
    <div class="phead"><h2>Goals</h2><span class="spacer"></span><button class="link" data-goplan>Plan →</button></div>
    <div class="goals">${goals.map(g => {
      const n = goalWeekNo(g), over = n > g.weeks;
      return `<div class="goal">
        <div class="goal-week ${over ? 'over' : ''}">${over ? `Past its ${g.weeks} weeks` : `Week ${n} of ${g.weeks}`}</div>
        <div class="goal-big">${esc(g.title)}</div>
        <div class="goal-week-label">This week</div>
        <div class="goal-small ${g.targets[thisWeek] ? '' : 'unset'}">${esc(g.targets[thisWeek] || 'Not set yet')}</div>
      </div>`;
    }).join('') || '<button class="link goal-none" data-goplan>No goal yet. Set one in Plan.</button>'}</div>

    <div class="phead"><h2>Notes</h2><button class="link" id="newNote">+ New</button></div>
    <div class="notelist">${notes.map(n => `<div class="noteitem" data-id="${n.id}"><b>${n.pinned ? '📌 ' : ''}${esc(n.title)}</b><small>${esc(n.body.slice(0, 70)) || 'Empty'}</small></div>`).join('') || '<div class="empty">No notes yet.</div>'}</div>

    <div class="phead"><h2>Stickies</h2><span class="spacer"></span>${COLORS.map(c => `<button class="swatch ${c}" data-new="${c}" title="New ${c} sticky">+</button>`).join('')}</div>
    <div class="stickies">${S.stickies.map(s => `<div class="sticky ${s.color}" data-id="${s.id}">
        <div class="grip"><button data-color title="Colour">◐</button><button data-del title="Delete">✕</button></div>
        <div class="txt" contenteditable="plaintext-only">${esc(s.text)}</div></div>`).join('') || '<div class="empty">No stickies.</div>'}</div>
  </div>`;
}
function bindSide() {
  const root = $('#sidePanel');
  root.addEventListener('click', async e => {
    if (e.target.closest('[data-goplan]')) return go('plan');
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
let modalCleanup = null;
function closeModal() { modalCleanup?.(); modalCleanup = null; $('#modal').hidden = true; $('#modalCard').innerHTML = ''; refresh(); }
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

// ================= Plan page: Ideal Year → goals → weekly goals
let planYear = null;
let showGoalForm = false;
const openGoalWeeks = new Set();
const goalWeekNo = g => Math.round((new Date(sundayOf(S.today) + 'T12:00') - new Date(sundayOf(g.startDate) + 'T12:00')) / 6048e5) + 1;
const goalLastDay = g => addDays(sundayOf(g.startDate), g.weeks * 7 - 1);

// Same shape as the Ideal Year sheet: months across the top, a date and a one-liner for each day.
function yearGrid(year) {
  const months = [...Array(12)].map((_, m) => {
    const name = new Date(+year, m, 1).toLocaleDateString('en-GB', { month: 'long' });
    const days = new Date(+year, m + 1, 0).getDate();
    const rows = [...Array(days)].map((_, i) => {
      const date = `${year}-${pad(m + 1)}-${pad(i + 1)}`;
      const dow = new Date(date + 'T12:00').getDay();
      const text = S.yearDays?.[date] || '';
      return `<label class="yday ${dow === 0 || dow === 6 ? 'weekend' : ''} ${date === S.today ? 'today' : ''}" title="${esc(text)}"><span>${i + 1}</span><input data-day="${date}" value="${esc(text)}" maxlength="200" autocomplete="off" aria-label="${name} ${i + 1}"></label>`;
    }).join('');
    return `<div class="ymonth"><div class="ymonth-name">${name}</div>${rows}</div>`;
  }).join('');
  return `<div class="ygrid">${months}</div>`;
}

// Goals drawn across the same year, to show overlaps and gaps.
function yearBars(year) {
  const goals = S.goals.filter(g => g.startDate.slice(0, 4) <= year && goalLastDay(g).slice(0, 4) >= year)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  if (!goals.length) return '';
  const first = new Date(`${year}-01-01T12:00`), last = new Date(`${year}-12-31T12:00`);
  const span = (last - first) / 864e5 + 1;
  const pct = d => (new Date(d + 'T12:00') - first) / 864e5 / span * 100;
  return `<div class="ybars">
    ${goals.map(g => {
      const from = Math.max(0, pct(g.startDate)), to = Math.min(100, pct(goalLastDay(g)) + 100 / span);
      return `<div class="yrow"><div class="ybar ${g.status === 'done' ? 'done' : ''}" style="left:${from}%;width:${to - from}%" title="${esc(g.title)}, ${g.weeks} weeks from ${g.startDate}">${esc(g.title)}</div></div>`;
    }).join('')}
    ${S.today.slice(0, 4) === year ? `<div class="ytoday" style="left:${pct(S.today)}%" title="Today"></div>` : ''}
  </div>`;
}

function renderPlan() {
  planYear ??= S.today.slice(0, 4);
  const gridScroll = $('#planPage .ygrid')?.scrollLeft;
  const thisWeek = sundayOf(S.today);
  const active = S.goals.filter(g => g.status === 'active').sort((a, b) => a.startDate.localeCompare(b.startDate));
  const finished = S.goals.filter(g => g.status === 'done');
  const weekOptions = sel => [...Array(9)].map((_, i) => `<option value="${i + 4}" ${i + 4 === sel ? 'selected' : ''}>${i + 4} weeks</option>`).join('');
  const label = g => {
    const n = goalWeekNo(g);
    if (n < 1) return `Starts ${fmtDate(g.startDate)}`;
    return n > g.weeks ? `Past its ${g.weeks} weeks` : `Week ${n} of ${g.weeks}`;
  };
  $('#planPage').innerHTML = `
    <div class="pulsehead"><h1>Plan</h1></div>

    <div class="panel">
      <div class="phead"><h2>Ideal Year</h2><span class="spacer"></span>
        <button data-year="-1" title="Previous year">‹</button><b class="yearlabel">${planYear}</b><button data-year="1" title="Next year">›</button></div>
      <input id="yearText" value="${esc(S.year?.[planYear] || '')}" placeholder="By the end of ${planYear}, where do you want to be?" autocomplete="off">
      ${yearBars(planYear)}
      ${yearGrid(planYear)}
    </div>

    <div class="panel">
      <div class="phead"><h2>Goals</h2><span class="spacer"></span><button class="link" id="addGoal">+ New goal</button></div>
      ${showGoalForm || !active.length ? `<form id="goalForm" class="goalform">
        <input type="text" name="title" placeholder="What's the big goal?" autocomplete="off" required>
        <div class="row">
          <label class="sub">Starts <input type="date" name="startDate" value="${S.today}" required></label>
          <select name="weeks" title="Length">${weekOptions(12)}</select>
          <span class="spacer"></span><button class="primary">Set goal</button>
        </div>
      </form>` : ''}
      <div class="pgoals">${active.map(g => {
        const started = goalWeekNo(g) >= 1 && goalWeekNo(g) <= g.weeks;
        const open = openGoalWeeks.has(g.id);
        const weeks = [...Array(g.weeks)].map((_, i) => addDays(sundayOf(g.startDate), i * 7));
        return `<div class="pgoal" data-id="${g.id}">
          <div class="pgoal-top"><span class="goal-week ${goalWeekNo(g) > g.weeks ? 'over' : ''}">${label(g)}</span><span class="spacer"></span>
            <button class="link" data-finish>✓ Finish</button><button class="link danger" data-remove>Delete</button></div>
          <input class="goal-big" data-field="title" value="${esc(g.title)}" aria-label="Goal">
          <div class="row pgoal-meta">
            <label class="sub">Starts <input type="date" data-field="startDate" value="${g.startDate}"></label>
            <select data-field="weeks" title="Length">${weekOptions(g.weeks)}</select>
          </div>
          ${started ? `<label class="goal-week-label">This week<input class="goal-small" data-week="${thisWeek}" value="${esc(g.targets[thisWeek] || '')}" placeholder="What does this goal need from this week?" autocomplete="off"></label>` : ''}
          <h3 class="toggle" data-weeks>${open ? '▾' : '▸'} All ${g.weeks} weeks</h3>
          ${open ? `<div class="pweeks">${weeks.map((w, i) => `<label class="${w === thisWeek ? 'now' : ''}"><span>Week ${i + 1} · ${fmtDate(w, { day: 'numeric', month: 'short' })}</span><input data-week="${w}" value="${esc(g.targets[w] || '')}" placeholder="Goal for this week" autocomplete="off"></label>`).join('')}</div>` : ''}
        </div>`;
      }).join('')}</div>
      ${finished.length ? `<div class="sub pgoal-done">Finished: ${finished.map(g => esc(g.title)).join(' · ')}</div>` : ''}
    </div>`;
  // Keep your place on re-render; otherwise open on the current month.
  const grid = $('#planPage .ygrid');
  if (gridScroll != null) grid.scrollLeft = gridScroll;
  else if (planYear === S.today.slice(0, 4)) grid.scrollLeft = grid.children[+S.today.slice(5, 7) - 1].offsetLeft - grid.offsetLeft;
}

// Your own actions always redraw. The guard in renderAll only protects typing from background refreshes.
async function reloadPlan() { await load(); renderPlan(); }

function bindPlan() {
  const root = $('#planPage');
  root.addEventListener('submit', async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const g = await api('POST', '/api/goals', { title: f.title, weeks: +f.weeks, startDate: f.startDate });
    showGoalForm = false;
    await reloadPlan();
    if (g.warning) toast(g.warning);
    $(`#planPage .pgoal[data-id="${g.id}"] [data-week]`)?.focus();
  });
  root.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches('.pgoal input, #yearText')) { e.preventDefault(); e.target.blur(); }
    // Move through the grid like a spreadsheet: Enter or ↓ goes to the next day, ↑ to the previous.
    if (e.target.dataset.day && ['Enter', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
      e.preventDefault();
      const next = addDays(e.target.dataset.day, e.key === 'ArrowUp' ? -1 : 1);
      $(`#planPage [data-day="${next}"]`)?.focus();
    }
  });
  root.addEventListener('change', async e => {
    if (e.target.id === 'yearText') {
      await api('POST', '/api/year', { year: planYear, text: e.target.value });
      return load();
    }
    if (e.target.dataset.day) {
      const date = e.target.dataset.day;
      const saved = await api('POST', '/api/year/day', { date, text: e.target.value });
      S.yearDays[date] = saved.text ?? e.target.value.trim();
      e.target.closest('.yday').title = S.yearDays[date];
      return;
    }
    const card = e.target.closest('.pgoal'); if (!card) return;
    const id = card.dataset.id, week = e.target.dataset.week, field = e.target.dataset.field;
    if (week) {
      await api('PATCH', `/api/goals/${id}`, { weekTarget: e.target.value, week });
      // The same week can be showing in two boxes.
      $$(`[data-week="${week}"]`, card).forEach(i => { if (i !== e.target) i.value = e.target.value; });
      return load();
    }
    if (field === 'title') {
      if (!e.target.value.trim()) return reloadPlan();
      await api('PATCH', `/api/goals/${id}`, { title: e.target.value });
      await load();
      return;
    }
    await api('PATCH', `/api/goals/${id}`, { [field]: field === 'weeks' ? +e.target.value : e.target.value });
    reloadPlan();
  });
  root.addEventListener('click', async e => {
    const nav = e.target.closest('[data-year]');
    if (nav) {
      planYear = String(+planYear + +nav.dataset.year);
      $('#planPage .ygrid').scrollLeft = 0;
      return renderPlan();
    }
    if (e.target.id === 'addGoal') {
      showGoalForm = !showGoalForm;
      renderPlan();
      return $('#goalForm [name=title]')?.focus();
    }
    const card = e.target.closest('.pgoal'); if (!card) return;
    const g = S.goals.find(x => x.id === card.dataset.id);
    if (e.target.closest('[data-weeks]')) {
      openGoalWeeks.has(g.id) ? openGoalWeeks.delete(g.id) : openGoalWeeks.add(g.id);
      return renderPlan();
    }
    if (e.target.hasAttribute('data-finish') && confirm(`Mark "${g.title}" as finished?`)) {
      await api('PATCH', `/api/goals/${g.id}`, { status: 'done' });
      toast('Goal finished. Rather good.');
      reloadPlan();
    }
    if (e.target.hasAttribute('data-remove') && confirm(`Delete "${g.title}" and its weekly goals?`)) {
      await api('DELETE', `/api/goals/${g.id}`);
      reloadPlan();
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
  $('#planPage').hidden = p !== 'plan';
  renderAll();
}
$$('[data-page]').forEach(b => b.onclick = () => go(b.dataset.page));

// Only ever turn http(s) addresses into links; calendar text comes from outside the app.
function safeUrl(v) {
  try { const u = new URL(String(v).trim()); return /^https?:$/.test(u.protocol) ? u.href : null; } catch { return null; }
}
const extLink = (href, label) => `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;
const linkify = text => esc(text).replace(/https?:\/\/[^\s<]+/g, m => {
  const url = m.replace(/[.,)]+$/, '');
  return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>${m.slice(url.length)}`;
});
const GUEST_STATUS = { ACCEPTED: ['✓', 'Going'], DECLINED: ['✕', 'Declined'], TENTATIVE: ['?', 'Maybe'], 'NEEDS-ACTION': ['·', 'No reply'] };

// Read-only property list for a Google block. Empty properties are left out.
function blockProps(e) {
  const row = (icon, label, html) => html ? `<div class="prop"><span class="prop-i" title="${label}">${icon}</span><div class="grow"><div class="prop-l">${label}</div><div>${html}</div></div></div>` : '';
  const who = p => p.name && p.name !== p.email ? `${esc(p.name)} <span class="sub">${esc(p.email)}</span>` : esc(p.email);
  const join = safeUrl(e.conference);
  const guests = e.attendees || [];
  const going = guests.filter(g => g.status === 'ACCEPTED').length;
  const locUrl = e.location && safeUrl(e.location);
  const facts = [e.showAs, e.visibility, e.status && e.status !== 'CONFIRMED' ? e.status.charAt(0) + e.status.slice(1).toLowerCase() : null].filter(Boolean).map(esc).join(' · ');
  const stamps = [e.created && `Created ${esc(e.created)}`, e.updated && `Updated ${esc(e.updated)}`].filter(Boolean).join(' · ');
  const extras = Object.entries(e.extras || {});
  return `<div class="props">
    ${join ? `<a class="joinbtn" href="${esc(join)}" target="_blank" rel="noopener noreferrer">🎥 Join meeting</a>` : ''}
    ${row('📍', 'Location', e.location && (locUrl ? extLink(locUrl, e.location) : `${esc(e.location)} · ${extLink(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.location)}`, 'Open map')}`))}
    ${row('📝', 'Description', e.description && `<div class="prop-desc">${linkify(e.description)}</div>`)}
    ${row('🔗', 'Link', safeUrl(e.url) && extLink(safeUrl(e.url), e.url))}
    ${row('👤', 'Organiser', e.organizer && who(e.organizer))}
    ${row('👥', guests.length ? `Guests · ${guests.length}${going ? `, ${going} going` : ''}` : 'Guests', guests.length && `<ul class="guests">${guests.map(g => {
      const [icon, text] = GUEST_STATUS[g.status] || ['·', g.status];
      return `<li><span class="gs" title="${esc(text)}">${icon}</span><span class="grow">${who(g)}${g.optional ? ' <span class="sub">optional</span>' : ''}</span><span class="sub">${esc(text)}</span></li>`;
    }).join('')}</ul>`)}
    ${row('🔁', 'Repeats', e.repeats && esc(e.repeats))}
    ${row('🔔', 'Reminders', e.reminders?.length && e.reminders.map(esc).join(' · '))}
    ${row('📎', 'Attachments', e.attachments?.length && e.attachments.map(a => safeUrl(a.url) ? extLink(safeUrl(a.url), a.name) : esc(a.name)).join('<br>'))}
    ${row('ℹ️', 'Status', facts)}
    ${stamps ? `<div class="sub prop-stamps">${stamps}</div>` : ''}
    ${extras.length ? `<details class="prop-more"><summary>All other properties · ${extras.length}</summary>${extras.map(([k, v]) => `<div><b>${esc(k)}</b> ${linkify(String(v))}</div>`).join('')}</details>` : ''}
  </div>`;
}

// Block details: what the block is, and the tasks that belong to it.
function openEvent(id) {
  const e = S.events.find(x => x.id === id);
  if (!e) return toast('That block is no longer on the calendar');
  const local = e.source !== 'gcal';
  const linked = sortTasks(linkedTasks(e));
  const done = linked.filter(t => t.done).length;
  const free = S.tasks.filter(t => !t.done && !t.eventId)
    .sort((a, b) => (b.due === e.date) - (a.due === e.date) || (a.priority || 4) - (b.priority || 4));
  const projects = S.projects.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  openModal(`<div class="blockcard">
    <div class="row"><span class="tag">${esc(e.calendar)}</span><span class="spacer"></span><button class="ghost" data-close>✕</button></div>
    ${local ? `<input class="ntitle" id="bTitle" value="${esc(e.title)}">
      <div class="row">
        <input type="date" id="bDate" value="${e.date}">
        <input type="time" id="bStart" value="${e.start || ''}">
        <span class="sub">to</span>
        <input type="time" id="bEnd" value="${e.end || ''}">
      </div>
      <input type="text" id="bLocation" value="${esc(e.location || '')}" placeholder="📍 Location" autocomplete="off">
      <input type="url" id="bUrl" value="${esc(e.url || '')}" placeholder="🔗 Link or meeting URL" autocomplete="off">
      <textarea id="bNotes" rows="3" placeholder="📝 Notes">${esc(e.notes || '')}</textarea>
      ${safeUrl(e.url) ? `<a class="joinbtn" href="${esc(safeUrl(e.url))}" target="_blank" rel="noopener noreferrer">Open link</a>` : ''}` : `<div class="ntitle">${esc(e.title)}</div>
      <div class="sub">${fmtDate(e.date, { weekday: 'long', day: 'numeric', month: 'long' })}${e.endDate ? ` to ${fmtDate(e.endDate, { weekday: 'long', day: 'numeric', month: 'long' })}` : ''} · ${blockTime(e)} · edit it in Google Calendar</div>
      ${blockProps(e)}`}

    <h3>Tasks for this block${linked.length ? ` · ${done}/${linked.length} done` : ''}</h3>
    <div class="blocktasks">${linked.map(t => `<div class="blocktask ${t.done ? 'done' : ''}" data-id="${t.id}">
        <button class="check p${t.priority || 4}" data-act="toggle" title="${t.done ? 'Reopen' : 'Complete'}"></button>
        <span class="grow title">${esc(t.title)}</span>
        <button class="ghost unlink" data-act="unlink" title="Unlink">Unlink</button>
      </div>`).join('') || '<div class="empty">Nothing linked yet, so this block has no way of knowing whether the work got done.</div>'}</div>

    <form class="row blockadd" id="bNew">
      <input type="text" name="title" class="grow" placeholder="+ New task for this block" autocomplete="off" required>
      <select name="priority"><option value="1">P1</option><option value="2">P2</option><option value="3">P3</option><option value="4" selected>P4</option></select>
      ${projects ? `<select name="projectId"><option value="">Inbox</option>${projects}</select>` : ''}
      <button class="primary">Add</button>
    </form>
    ${free.length ? `<select id="bPick"><option value="">Link an existing task…</option>${free.map(t => `<option value="${t.id}">${esc(t.title)}${t.due ? ` · ${relDate(t.due)}` : ''}</option>`).join('')}</select>` : ''}
    ${local ? `<div class="row blockfoot"><span class="spacer"></span><button id="bDelete">Delete block</button></div>` : ''}
  </div>`);

  const card = $('#modalCard');
  const again = async () => { await load(); renderAll(); openEvent(id); };
  card.querySelector('.blocktasks').onclick = async ev => {
    const act = ev.target.dataset.act; if (!act) return;
    const t = S.tasks.find(x => x.id === ev.target.closest('.blocktask').dataset.id);
    if (act === 'unlink') { await api('POST', '/api/tasks/link', { id: t.id, eventId: null }); return again(); }
    const completing = !t.done;
    await api('POST', '/api/tasks/complete', { id: t.id, done: completing });
    await again();
    if (completing) celebrate(t);
  };
  $('#bNew').onsubmit = async ev => {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(ev.target));
    const body = { title: f.title, priority: +f.priority, due: e.date, eventId: e.id };
    if (f.projectId) { body.projectId = f.projectId; body.project = S.projects.find(p => p.id === f.projectId)?.name; }
    await api('POST', '/api/tasks', body);
    await again();
    $('#bNew [name=title]').focus();
  };
  if ($('#bPick')) $('#bPick').onchange = async ev => {
    if (!ev.target.value) return;
    await api('POST', '/api/tasks/link', { id: ev.target.value, eventId: e.id });
    again();
  };
  if (!local) return;
  const saveBlock = async () => {
    const start = $('#bStart').value, end = $('#bEnd').value;
    if (start && end && end <= start) return toast('The block has to end after it starts');
    await api('PATCH', `/api/events/${e.id}`, { title: $('#bTitle').value.trim() || e.title, date: $('#bDate').value, start: start || null, end: end || null, location: $('#bLocation').value.trim(), url: $('#bUrl').value.trim(), notes: $('#bNotes').value });
    await load(); renderAll();
    toast('Saved');
  };
  ['#bTitle', '#bDate', '#bStart', '#bEnd', '#bLocation', '#bUrl', '#bNotes'].forEach(s => $(s).onchange = saveBlock);
  $('#bDelete').onclick = async () => {
    if (!confirm('Delete this block? Linked tasks stay on your list.')) return;
    await api('DELETE', `/api/events/${e.id}`);
    closeModal();
  };
}

// Link from the task's side: pick a block from the next two weeks.
function openLinker(taskId) {
  const t = S.tasks.find(x => x.id === taskId);
  const until = addDays(S.today, 14);
  const blocks = S.events
    .filter(e => e.date === t.due || (e.date >= S.today && e.date <= until))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.start || '').localeCompare(b.start || ''));
  openModal(`<div class="blockcard">
    <div class="row"><div class="ntitle grow">Link “${esc(t.title)}” to a block</div><button class="ghost" data-close>✕</button></div>
    ${t.eventId ? '<div class="row"><button id="lUnlink">Remove current link</button></div>' : ''}
    <div class="blockpick">${blocks.map(e => `<button class="${e.id === t.eventId ? 'current' : ''}" data-block="${e.id}"><b>${esc(e.title)}</b><small>${relDate(e.date)} · ${blockTime(e)}</small></button>`).join('') || '<div class="empty">No blocks in the next two weeks. Click a slot on the calendar to make one.</div>'}</div>
  </div>`);
  const done = async eventId => { await api('POST', '/api/tasks/link', { id: t.id, eventId }); closeModal(); };
  $('.blockpick').onclick = e => { const b = e.target.closest('[data-block]'); if (b) done(b.dataset.block); };
  if ($('#lUnlink')) $('#lUnlink').onclick = () => done(null);
}

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
  else if (page === 'plan') { if (!document.activeElement?.closest('#planPage')) renderPlan(); }
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

bindTasks(); bindCal(); bindSide(); bindPulse(); bindPlan();
await refresh();
setInterval(() => { if (page === 'home' && !calDragging && !document.hidden && $('#modal').hidden && !document.activeElement?.isContentEditable && document.activeElement?.tagName !== 'INPUT') renderCal(); }, 60_000); // keep the now-line moving
