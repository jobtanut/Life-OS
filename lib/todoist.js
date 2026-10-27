// Todoist two-way sync (API v1, free personal token). Local priority p1..p4 maps to Todoist 4..1.
const BASE = 'https://api.todoist.com/api/v1';
const token = () => process.env.TODOIST_TOKEN;
export const enabled = () => Boolean(token());

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Todoist ${method} ${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json().catch(() => null);
}

async function paged(path) {
  const out = [];
  let cursor = null;
  do {
    const sep = path.includes('?') ? '&' : '?';
    const r = await api('GET', `${path}${sep}limit=200${cursor ? `&cursor=${cursor}` : ''}`);
    out.push(...r.results);
    cursor = r.next_cursor;
  } while (cursor);
  return out;
}

export async function fetchAll() {
  const [tasks, projects] = await Promise.all([paged('/tasks'), paged('/projects')]);
  const projectName = Object.fromEntries(projects.map(p => [p.id, p.name]));
  return {
    projects: projects.map(p => ({ id: p.id, name: p.name })),
    tasks: tasks.map(t => ({
      todoistId: t.id,
      title: t.content,
      notes: t.description || '',
      priority: 5 - t.priority,
      due: t.due?.date?.slice(0, 10) || null,
      time: t.due?.date?.length > 10 ? t.due.date.slice(11, 16) : null,
      recurring: Boolean(t.due?.is_recurring),
      duration: t.duration?.unit === 'minute' ? t.duration.amount : null, // minutes, used for "get ahead" fit checks
      project: projectName[t.project_id] || 'Inbox',
      projectId: t.project_id,
    })),
  };
}

const toRemote = t => ({
  content: t.title,
  description: t.notes || '',
  priority: 5 - (t.priority || 4),
  ...(t.due ? (t.time ? { due_datetime: `${t.due}T${t.time}:00` } : { due_date: t.due }) : {}),
  ...(t.duration ? { duration: t.duration, duration_unit: 'minute' } : {}),
});

export const create = t => api('POST', '/tasks', { ...toRemote(t), ...(t.projectId ? { project_id: t.projectId } : {}) });
export const update = t => api('POST', `/tasks/${t.todoistId}`, toRemote(t));
export const close = t => api('POST', `/tasks/${t.todoistId}/close`);
export const reopen = t => api('POST', `/tasks/${t.todoistId}/reopen`);
export const remove = t => api('DELETE', `/tasks/${t.todoistId}`);
