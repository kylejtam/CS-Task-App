# Task Timer

A small Windows app for tracking crew scheduling tasks with deadlines and countdown timers.
It's a single `.exe` file. There's nothing to install: put it anywhere and double-click it.

## Getting the app

1. Open this repository on GitHub and click **Releases** on the right-hand side.
2. Open the newest **Task Timer** release and click **Task-Timer.exe** to download it.
   (Direct link: https://github.com/kylejtam/CS-Task-App/releases/latest)
3. Put the file wherever you like (Desktop, Documents, a USB stick) and double-click it.

The first time you run it, Windows may show a blue box saying **"Windows protected your PC"**.
This happens because the app isn't "signed" (signing is a paid certificate that companies buy).
Click **More info**, then **Run anyway**. You only need to do this once.

The app can take a few seconds to open, because it unpacks itself each time it starts.

## Updating

Open **Settings** and press **Check for updates** (the version you have is shown in the bottom-left corner).
The app also checks quietly each time it opens; a small dot on the gear means a new version is ready.
On Windows, choosing **Update now** downloads the new version, closes the app and reopens it. Your tasks are kept.

## iPhone version

The same app also runs on iPhone as a **Home Screen web app**: open
**https://kylejtam.github.io/CS-Task-App/** in **Safari**,
tap the **Share** button (square with an arrow), then **Add to Home Screen**. It then has its own
icon, opens full-screen, works without internet, and keeps your tasks on your phone.

* Swipe a task **right** to complete it. Swipe it **left** to rename it, change its time or delete it.
* Press and hold a task with no time limit, then drag it to reorder.
* Tap a flashing task **once** to stop the flashing.
* Swipe a completed task either way to move it back to the list.
* Timers, sounds and pop-ups only work while the app is open on screen. iPhones pause web apps in the
  background, so an alert for a task that went overdue while the app was closed appears when you next open it.
* Pop-up alerts need iOS 16.4 or newer. Sounds don't play when the phone is on silent.
* Phone tasks and Windows tasks are separate lists: they don't sync with each other.

## How to use it (Windows)

| To do this | Do this |
| --- | --- |
| Add a task | Type in the box at the bottom and press **Enter**, then type a due time and press **Enter** again |
| Due time formats | `14:30` or `1430` = that clock time (tomorrow if it has already passed today) · `+45` = 45 minutes from now · `+1:30` = 1 hour 30 minutes from now · leave empty = no time limit |
| Make a task a priority | Click the **!** on the right of the task |
| Rename, change the time, or delete | **Right-click** the task |
| Reorder tasks with no time limit | Drag them up or down (tasks with times always stay in time order) |
| Complete a task | **Double-click** the task |
| Bring back a completed task | Open **Completed** at the bottom of the list and **right-click** the task |
| Undo | Click the curved arrow at the top, or press **Ctrl+Z** (up to 10 steps) |
| Stop a task flashing | Click it once |
| Rename the list, settings, presets, theme | Click the gear at the top right |

**Row colors:** yellow = due within 1 hour · orange = due within 5 minutes · red = overdue.
You can change the yellow and orange limits in Settings. When a task's border changes color it
**flashes**. Click the task once to say "I've seen it" and the flashing stops (the colored border and soft fill stay).

**Completed tasks** show the time you completed them for 24 hours. Moving one back restores its original due time.

**Times on each row:** the big number is the time left; the small number under it is the actual
due time (with "tmrw" if it's due tomorrow).

**Countdown:** with an hour or more left it shows hours:minutes (`2:05`). With less than an
hour left it shows minutes:seconds (`4:30`). Once overdue it shows the time since the deadline
as a negative number (`-12:00`).

**Alerts:** when a task becomes overdue, the app plays a sound and shows a Windows pop-up.
Both can be turned off in Settings.

**Where your tasks are saved:** `%APPDATA%\Task Timer\tasks.json` (tasks saved by the older "CS Task List" version are copied over automatically). They stay saved even if you
move or replace the `.exe`.

## For whoever maintains this

* `src/` is the screen (HTML, CSS and JavaScript). `main.js` opens the window and saves files. `preload.js` connects the two.
* `npm install` then `npm start` runs it on your own computer. `npm test` runs the time-format checks.
* Every push to GitHub builds a new `.exe` on a Windows machine (`.github/workflows/build.yml`) and puts it on the Releases page.
