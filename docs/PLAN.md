# Life OS: Build Plan

Status: draft for review, 2026-10-31. Nothing here is built yet.

## The vision

One app that runs your to-do list, calendar and journal, and tells you honestly whether how you're spending your time will get you to your goals.

**The problem it solves:** life organisation tools live in separate places and don't talk to each other. The only way to make them feel like one system today is to hold it together yourself, or with something like Claude Code. Run your life efficiently and you get more time for everything else.

**The test for every feature:** does it connect things that are otherwise separate? If it's just another standalone tool in the same window, it doesn't belong.

```
Ideal Year        where you want to end up
   ↓
Goals             each one 4 to 12 weeks long
   ↓
This week         weekly targets + 3 challenges
   ↓
Today             actions (to-dos + calendar)
   ↓
Weekly audit      what went right, what went wrong
   └───────────→  feeds next week's challenges
```

## What already exists

Tasks, a week calendar, notes, stickies, the coach popup, Pulse and daily Markdown logs all work. Tasks can also be linked to calendar blocks: a block's details show its tasks and how many are done, plus every property the calendar feed provides.

Also built ahead of the phases below:

- Drag on the calendar to create a block, and drag its bottom edge to resize it.
- The menu is Home, Plan and Pulse.
- A read-only goal reminder at the top right of Home: the big goal, its week count and this week's goal.
- A Plan page: Ideal Year (a year statement, goal bars and a month-by-month grid of one-liners, matching the Ideal Year sheet), then goals and weekly goals. Goals run 4 to 12 weeks, with a warning above 5 running at once and a stop at 7.
- Task views: Today, Upcoming, Inbox (with "Do today") and Projects. The gaps that matter for this plan:

- **Your real data isn't connected.** Todoist, Google Calendar and Gemini have only been tested with sample or mocked data.
- **Google Calendar is read-only.** Plan My Week can't put a week on your real calendar until that changes.
- **Pulse is too busy.** A check-in, three lists, a journal, a summary and an activity log feels like homework.

## How goals get judged

| Signal | What it measures | Role |
|---|---|---|
| **Plan vs done** | Hours and tasks you confirmed done, against what you planned for that goal this week | Main signal, triggers flags |
| **Unaligned time** | Share of your scheduled week linked to no goal | Main signal, shown every week |
| **Pace** | Hours still needed against hours scheduled before the deadline | Optional, see decision 4 |
| **Results** | The real number, such as subscribers or revenue | Log only, never triggers a flag |

Starting flag rules, to be tuned once there's real data:

- **On track:** 80% or more of the week's plan done.
- **At risk:** 50 to 79%.
- **Off track:** under 50%, or two At Risk weeks in a row.

Three rules keep these numbers honest:

- **A block isn't done until you confirm it.** If it has linked tasks, finishing them confirms it automatically. Otherwise it's one click on the calendar: done, partly, or skipped. Unconfirmed blocks count as not done, and the audit lists them.
- **Lunch and rest aren't "unaligned".** Time can be marked Protected (sleep, meals, rest day, relationships), so the number only measures time you could have pointed at something.
- **The code does the maths, not the AI.** Scores come from your data, so they're the same every time and work without an AI key. The AI only writes the words around them.

## The phases

Sizes are relative: S is small, M is medium, L is large.

### Phase 0: Real data (M)

Nothing below means much on sample data.

- Connect Todoist, your calendars and Gemini, and fix whatever real data breaks.
- Add Google Calendar write access. It's free, but needs a Google OAuth setup that you'll have to click through once.
- Move the rest day and evening cut-off into Settings, so they're no longer hard-coded.

**Done when:** your real week shows in the app, and an event created in the app appears in Google Calendar.

### Phase 1: Goals (L)

- Add a one-line why and planned hours per week to each goal on Plan. The Home panel stays as the daily reminder.
- Break it into weekly targets. The coach can draft these for you to edit.
- Link tasks and calendar blocks to a goal in one click. The app suggests the goal from the title, because if linking is any more work than that, you'll stop doing it.

**Done when:** today's tasks visibly serve a goal, and everything in a normal day can be linked in under a minute.

### Phase 2: Plan vs done (M)

- The one-click confirmation on calendar blocks, for blocks with no linked tasks.
- Each goal shows its plan vs done and its On Track, At Risk or Off Track status.
- Flags appear on Home when a goal slips.

**Done when:** a skipped block visibly lowers that goal's score.

### Phase 3: Unaligned time (S)

- Mark time as Protected.
- A weekly figure on Home and on Goals: aligned, protected and unaligned hours.

**Done when:** you can see at a glance where the week actually went.

### Checkpoint: use it for two full weeks

No new features for two weeks. This is the point of the whole plan: if you won't confirm blocks or link tasks, an audit built on them is worthless, and I'd rather find that out now.

### Phase 4: Simpler journal (S)

- Pulse becomes a blank page with one optional prompt that changes daily.
- No streaks and no required fields.
- Gratitude, win and lesson become optional tags on a line, not separate boxes.
- The mood, energy, focus and sleep check-in becomes optional, and collapsed by default.
- Existing entries are kept. Past gratitude, wins and lessons still show.

**Done when:** opening it feels like opening a notebook.

### Phase 5: Weekly audit and three challenges (L)

- A guided review covering each goal's plan vs done, unaligned time, skipped blocks, what went right and what went wrong.
- It reads your journal, so what you write actually gets used.
- It proposes three challenges for next week, each tied to something it found. You edit or accept them.
- Saved reviews form a history you can look back through.
- Without an AI key, the numbers still work and you write the challenges yourself.

**Done when:** a review takes under 15 minutes and ends with three challenges you'd actually accept.

### Phase 6: Plan My Week (L)

- Starts from your three challenges and each goal's weekly target.
- Places your fixed events first, then goal blocks, then everything else.
- Follows your rules: back-to-back blocks, one long free block a day, lunch at 13:00, travel blocks and no Saturday work.
- Shows the week as a draft for you to adjust. Nothing is written to Google Calendar until you approve it.

**Done when:** you can go from finished audit to a real week on your calendar in one sitting.

### Phase 7: Ideal Year (built)

The grid, year statement and goal bars are in Plan. Still open: bringing in the existing Ideal Year 2026 sheet.

## New data

```
goals          title, why, startDate, weeks (4-12), hoursPerWeek, status
goal targets   goalId, weekNumber, target, done
tasks          + goalId (eventId already exists)
event links    eventId → goalId, confirmed (done/partly/skipped), protected
reviews        weekStart, right, wrong, challenges (3), scores
year           statement per year (built)
yearDays       date → one-liner (built)
```

Event links sit in their own table because Google events get replaced on every sync. Anything stored on the event itself would be wiped.

## Ideas for later

- **Energy Portfolio:** build it into the app as its own feature. Not now. Only its limit numbers are used for the moment.
- **Weekly rows from the sheet:** the "12 Week Year Plan" tab tracks Plan, Action, Complete and Reflection for each week. Those fields could feed plan vs done and the weekly audit directly.
- **Weekly life scores:** the sheet's stat tab scores nine life areas each week, which could join the audit.
- **Birthdays:** the sheet's Birthday tab could become a yearly layer on Ideal Year.

## Leaving out for now

- Hosting, accounts and payments. These only matter once you decide to sell.
- A mobile app. The web version will do until you've used this for a while.
- Results tracking beyond a simple log.
- Streaks, badges and points.

## Decisions I need from you

1. **Notion:** does the app replace your Weekly Agendas and Energy Portfolio, or run alongside them? I recommend replacing them for goal tracking once the two-week checkpoint passes. Keeping both means entering everything twice, and you'd stop within a fortnight.
2. **Audit day:** I recommend Friday, then planning the following Sunday to Saturday, since Saturday is rest. Your notes disagree here: `CLAUDE.md` says the week starts on Sunday, while `MEMORY.md` says it runs Saturday to Friday. Please confirm which is right.
3. **Goal limit:** built with your Energy Portfolio numbers, a warning above 5 and a hard stop at 7. If you sell this later, new users may need a lower default.
4. **Pace:** you didn't pick this one, but I recommend keeping it as a quiet line on each goal, not a flag. It's the only signal that warns you before the deadline rather than after.
5. **AI and privacy:** Gemini's free tier may use your journal and tasks to improve Google's models, and the audit makes that matter more. I recommend sending the audit only your scores and the tagged lines, never the full journal, unless you switch it on.

## Pushback

This is a long way from where the app is now, and it's competing with university, the channel and your other work. Build Phases 0 to 3, then stop and use it. It should also take a slot on your Energy Portfolio, if it isn't already holding one.
