# Life OS

Tasks, a week calendar, notes, sticky notes and a daily journal on one page, plus an AI coach that can actually move things around. It runs locally, uses free tools only, and has zero npm dependencies.

## What's in it

**Home**
- **Tasks** on the left, with P1–P4 priorities, due dates, times and time estimates. Inline editing, and two-way Todoist sync.
- **Week calendar** in the middle, Sunday to Saturday, with a now-line. Click any slot to add an event. Tasks with a time show on the grid.
- **Stickies and notes** on the right. Notes open in a focused editor and save as you type.
- **Get ahead.** Finish a task, or clear the day, and you get a compliment plus up to three future tasks you could start now. They're ranked by priority, then by how soon they're due, and only suggested if they fit before your next calendar event. "Start now" blocks the time on your calendar.

**Pulse** (the journal)
- A check-in for mood, energy, focus and sleep. Sliders change colour with the score, or click the number to type it.
- Gratitude, Wins and Lessons lists.
- A free-form journal that autosaves and takes timestamped entries through the day.
- A day summary, and a small activity history at the bottom.

**Coach** (bottom-right popup)
- Reads everything and can add, complete or move tasks, create events, notes and stickies, log reflections and write your end-of-day summary.
- Runs on Google's free Gemini tier, a local Ollama model, or an offline briefing mode with no key at all.

**Settings:** System, Light or Dark appearance.

## Run it

You need Node 22.9 or newer. There's nothing to install.

```bash
cp .env.example .env
npm start
```

Then open http://localhost:4747.

## Connect things (all optional, all free)

Put these in `.env`:

| Variable | What it does | Where to get it |
|---|---|---|
| `USER_NAME` | Your name in the greeting | You know this one |
| `GEMINI_API_KEY` | Switches on the AI coach | https://aistudio.google.com/apikey |
| `OLLAMA_MODEL` | Local coach instead of Gemini | Install Ollama, then `ollama pull llama3.1` |
| `TODOIST_TOKEN` | Two-way Todoist sync | Todoist → Settings → Integrations → Developer |
| `GCAL_ICS` | Read-only Google Calendar | Each calendar's settings → "Secret address in iCal format", as `Name=url,Name=url` |

Syncing happens on start and whenever you press ⟳.

Note that on Gemini's free tier, Google may use what you send to improve its models. The coach sends your tasks and journal with each message. If that matters to you, use Ollama instead.

## Make the coach yours

```bash
cp coach-profile.example.md coach-profile.md
```

Edit it with who you are, your routines and how blunt you want the coach to be. Your copy is gitignored.

## Where your data lives

Everything below stays on your machine and out of git:

- `data/db.json`: all app data, and the source of truth.
- `logs/YYYY-MM-DD.md`: one compact Markdown file per day, covering metrics, gratitude, wins, lessons, journal and activity. Handy for feeding to another AI assistant.
- `coach-profile.md`: your coach profile.
- `.env`: your keys.

## Project layout

```
server.js          HTTP server and API routes (no framework)
lib/store.js       JSON storage and date helpers
lib/log.js         Daily log, journal and Markdown rendering
lib/ops.js         Every change goes through here, so logging and sync stay consistent
lib/coach.js       AI coach: context, providers and actions
lib/todoist.js     Todoist API v1 sync
lib/gcal.js        iCal parser with recurring events
public/            Front end (vanilla JS, no build step)
```

## Known limits

- Google Calendar is read-only. Writing back needs an OAuth client.
- Rare recurrence rules (e.g. "2nd Tuesday of the month") don't expand.
- It's single-user and local, with no login, so don't expose it to the internet as is.
- Saturday rest day, the 19:30 work cut-off and Sunday week start are currently hard-coded.
