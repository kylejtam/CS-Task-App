# CS Task List

A small Windows app for tracking crew scheduling tasks with deadlines and countdown timers.
It's a single `.exe` file. There's nothing to install: put it anywhere and double-click it.

## Getting the app

1. Open this repository on GitHub and click **Releases** on the right-hand side.
2. Open **Latest build** and click **CS-Task-List.exe** to download it.
3. Put the file wherever you like (Desktop, Documents, a USB stick) and double-click it.

The first time you run it, Windows may show a blue box saying **"Windows protected your PC"**.
This happens because the app isn't "signed" (signing is a paid certificate that companies buy).
Click **More info**, then **Run anyway**. You only need to do this once.

The app can take a few seconds to open, because it unpacks itself each time it starts.

## How to use it

| To do this | Do this |
| --- | --- |
| Add a task | Type in the box at the bottom and press **Enter**, then type a due time and press **Enter** again |
| Due time formats | `14:30` or `1430` = that clock time (tomorrow if it has already passed today) · `+45` = 45 minutes from now · `+1:30` = 1 hour 30 minutes from now · leave empty = no time limit |
| Make a task a priority | Click the **!** on the right of the task |
| Change a due time | **Right-click** the task |
| Complete a task | **Double-click** the task |
| Bring back a completed task | Open **Completed** at the bottom of the list and **right-click** the task |
| Undo | Click the curved arrow at the top, or press **Ctrl+Z** (up to 10 steps) |
| Settings, presets, theme | Click the gear at the top right |

**Row colors:** yellow = due within 1 hour · orange = due within 5 minutes · red = overdue.
You can change the yellow and orange limits in Settings.

**Countdown:** with an hour or more left it shows hours:minutes (`2:05`). With less than an
hour left it shows minutes:seconds (`4:30`). Once overdue it shows the time since the deadline
as a negative number (`-12:00`).

**Alerts:** when a task becomes overdue, the app plays a sound and shows a Windows pop-up.
Both can be turned off in Settings.

**Where your tasks are saved:** `%APPDATA%\CS Task List\tasks.json`. They stay saved even if you
move or replace the `.exe`.

## For whoever maintains this

* `src/` is the screen (HTML, CSS and JavaScript). `main.js` opens the window and saves files. `preload.js` connects the two.
* `npm install` then `npm start` runs it on your own computer. `npm test` runs the time-format checks.
* Every push to GitHub builds a new `.exe` on a Windows machine (`.github/workflows/build.yml`) and puts it on the Releases page.
