# Concentration + Situation Awareness study

A web app for a one-session (~20 min) experiment. Each participant does a practice
matching game, an exercise or seated-rest period, two themed Concentration boards
with another exercise/rest period in between, then situation-awareness (SA) questions
about both boards and a short survey. Several computers can run sessions in parallel against one
server on the local network. No external network calls are made at runtime.

Stack: SvelteKit + TypeScript (Vite), SvelteKit server endpoints, SQLite
(better-sqlite3), and Docker Compose.

---

## 1. Setup

### Docker (recommended for data collection)

```bash
cp .env.example .env           # set ADMIN_PASSWORD (and PORT if not 3000)
docker compose build
docker compose run --rm app npm run schedule -- --seed 12345   # once, see §3
docker compose up -d
```

Open `http://<server-ip>:3000/` on each participant computer.

| Env var          | Default (Docker)   | Meaning                                                    |
| ---------------- | ------------------ | ---------------------------------------------------------- |
| `PORT`           | `3000`             | HTTP port                                                  |
| `ADMIN_PASSWORD` | (required)         | Password for `/admin`; admin is disabled if unset          |
| `DATA_DIR`       | `/data`            | SQLite DB (`experiment.db`) and `schedule.csv`             |
| `CONFIG_PATH`    | `/app/config.json` | Experiment config                                          |
| `ASSETS_DIR`     | `/app/assets`      | Theme folders and `layouts.json`                           |
| `SCHEDULE_PATH`  | `$DATA_DIR/schedule.csv` | Override the schedule location                       |
| `DEV_TIMERS`     | `0`                | `1` forces the card preview to 5 s (for testing)           |

`docker-compose.yml` bind-mounts `./data`, `./config.json` and `./assets`, so you can
edit config and images on the host without rebuilding. Restart the container after
changing them (`docker compose restart`), because config is loaded once at startup.

### Local development

```bash
npm install
npm run schedule -- --seed 12345
DEV_TIMERS=1 ADMIN_PASSWORD=dev npm run dev      # http://localhost:5173
npm test                                          # unit tests
npm run check                                     # type check
npm run validate                                  # check config/manifests/images/layouts
```

Outside Docker the defaults are `./config.json`, `./assets` and `./data`.

---

## 2. Config (`config.json`)

Nothing about conditions or themes is hardcoded. Everything comes from here and from the
theme manifests.

| Key | Meaning |
| --- | --- |
| `conditions` | e.g. `["rest", "elevated_hr"]` |
| `theme_orders` | Board A/B theme pairs, e.g. `[["mit","transport"],["transport","mit"]]` |
| `board` / `practice_board` | `{rows, cols}`; the practice board also names its `theme` |
| `preview_s`, `mismatch_flip_ms` | Face-up preview length; delay before a mismatch flips back |
| `max_participants` | Default N for the schedule |
| `sa_questions` | Question types. Currently `objects`, `color`, `side_by_side`; add `orientation` back to ask it |
| `sa_random_per_theme` | Single-item questions per theme after the objects grid (currently 4, so 10 questions in total). Remove it to ask every type about every object |
| `sa_foils_per_theme` | Foils shown in the objects grid (a random subset per participant; currently 4, so the grid is 8 + 4 = 12). Remove it to show every foil |
| `confidence_scale`, `confidence_labels` | e.g. 4 and the two end labels. `0` turns the confidence rating off |
| `colors` | The 4 colors: `{id, label, hex}` |
| `orientations` | The 4 orientations: `{id, label, rotate_deg}`. `rotate_deg` is applied to the image as drawn. Every object is currently `up` (unrotated) |
| `condition_text` | Per condition: the `interval1` / `interval2` screen title and body |
| `oral_sa_questions` | Environment SA questions read aloud by the facilitator after the on-screen questions: `{id, prompt, options: [{id, label}], answer}`. **The 4 in config.json are placeholders. Replace them with the real questions before data collection** |

---

## 3. Schedule generation

```bash
npm run schedule -- --seed 12345          # N defaults to max_participants
npm run schedule -- --seed 12345 --n 32 --out data/schedule.csv --force
```

This creates IDs `P01..PNN` and block-randomizes them to the condition × theme-order cells.
Each consecutive block of 4 IDs contains all 4 cells, so with 30 participants the cells get
8/8/7/7. It writes `pid, condition, board_a_theme, board_b_theme, seed`, prints the cell
counts, and refuses to overwrite an existing schedule without `--force`. If you omit
`--seed`, a random seed is chosen and recorded in the file.

The server reads the schedule when a participant ID is first opened. IDs not in the
schedule are rejected.

---

## 4. Themes and images

Each theme is a folder `assets/themes/<theme>/` containing a `manifest.json` and its
images. The MIT and transport themes each have 8 board objects and 8 foils.

```jsonc
{
  "theme": "mit",
  "objects": [
    {
      "id": "great_dome", "label": "Great Dome",       // label is used in "What color was the …?"
      "image": "great_dome.svg",
      "color": "blue",                                 // one of config.colors ids
      "orientation": "up",                             // one of config.orientations ids
      "variant": { "scale": 0.85 }                     // altered version for side-by-side
    }
  ],
  "foils": [ /* same shape; shown only in the recognition grid */ ]
}
```

**Two ways to draw an item** (`"render"` in the manifest):

- `"mask"` (the default): a single-color silhouette filled with the item's assigned color (below).
- `"original"`: the file (a full-color SVG such as emoji art, or a PNG/JPG photo) is shown as-is.
  Use it where a silhouette is hard to recognize. Color questions are never asked about these
  items, and their side-by-side variant must use `mirror`, `scale` or `image` (not `color_shift_deg`).

**How color and orientation are applied (mask items).** Every image is used as a CSS mask and filled
with the assigned color, then rotated. The image's shape matters, but its own colors are
ignored. That means **every image must be a single-color shape on a transparent
background**, ideally SVG (a PNG with transparency also works). This is what keeps color
and orientation answers controlled.

**Variants** (side-by-side question) can combine:
`image` (an alternate file, e.g. with a small element removed), `mirror: true`,
`scale: 0.85`, or `color_shift_deg: 25` (slight hue shift of the assigned color).

**Where the images come from** (details in `assets/ATTRIBUTION.md`):

- Most icons come from Material Design Icons (Apache-2.0) and game-icons.net (CC BY 3.0).
  They're copied out of npm packages by `npm run icons`, using the id-to-icon map in
  `scripts/import-icons.ts`. To swap an icon, change the map and run
  `npm run icons -- --force`, or simply replace the SVG file.
- `mit_logo.svg` is the public-domain MIT logo from Wikimedia Commons.
- Drawn as-is (`"render": "original"`): the square-cropped Boston skyline, Stata Center,
  Green Building and Brass Rat photos.
- `infinite_corridor.svg` (doorway + infinity sign) and `apollo_capsule_variant.svg` (window
  filled in) were made by hand. `npm run icons` never overwrites these or any non-SVG image.
- An object without a `variant` is never asked about side by side (e.g. the symmetric DNA helix).

Run `npm run validate` and restart the server after changing images.

**Reviewing icons: the `/preview` page.** Log in at `/admin`, then open `/preview`. It shows every
object and foil as it looks on a card now, plus its variant, next to alternative icons and
photos. Click an alternative, choose **Keep**, **Use selected** or **Need other**, and add a note.
The Questions and Survey tabs let you try the participant flow and comment on it. **Save feedback**
writes `data/preview-feedback.json`. Alternatives live in `assets/candidates/` with source and
license per file in `index.json`. They are fetched once, with network access, by
`npm run candidates` (`-- --force` to refetch, `-- --only mit` for one theme). Candidates are
not used by the study until they are copied into a theme folder and the manifest is updated.

**Practice board.** The `emoji` theme uses plain emoji (`"emoji": "⭐"` instead of
`image`). Emoji are drawn by the computer's own emoji font and have no color or orientation
control. That is fine because practice is not logged. Make sure the participant browsers have
an emoji font (Windows, macOS and ChromeOS do; minimal Linux may not).

**Card layouts** are fixed and identical for every participant. They are generated once
into `assets/layouts.json`, with no pair placed side by side:

```bash
npm run layouts -- --seed 20261025          # refuses to overwrite without --force
```

If you change a manifest's objects, regenerate the layouts **before** data collection.

---

## 5. Running a session

1. Open `http://<server>:3000/`, enter the participant ID, and click **Start session**.
   You can also go straight to `/?pid=P07`.
2. The facilitator uses one shortcut, **Ctrl + Shift + F**.

| Phase | What happens | Facilitator |
| --- | --- | --- |
| Baseline | Shows the participant ID and **condition**. Fit the sensor, then click **START** at the same moment as the HR monitor's lap button. The timestamp is logged. | Click START (or press the shortcut), then press the shortcut to begin practice |
| Practice | 3×4 emoji board with on-screen walkthrough hints. Not logged. | Shortcut when done (pressing early asks for a second press to skip) |
| Exercise / rest 1 | Full-screen instructions for the condition and "Wait for facilitator". No clock: the facilitator times it. A facilitator strip at the bottom records **RPE** (Borg 6–20, show the card) and optional **peak HR** at the end of the bout | Tap RPE, then shortcut (pressing without RPE asks for a second press) |
| Board A | Participant presses Start. Cards are face up for `preview_s` with a countdown, then flip down. When the board is cleared, the app advances automatically. | — |
| Exercise / rest 2 | Same as above | Shortcut advances |
| Board B | Same as Board A, with the other theme | — |
| SA questions | Both theme blocks, in random order (see §6) | — |
| Survey | One screen **filled in by the facilitator**: ask each question aloud and tap the answer. Age, exercise days per week, fitness level (1–5 scale with descriptions), hours slept, caffeine today, difficulty seeing colors | Tap answers, then **Save & finish** |
| Done | Thank-you screen | Shortcut returns to the start page for the next participant |

- The participant cannot go back: the browser Back button is suppressed, and the server
  only ever moves a session forward.
- State lives on the server. Refreshing or reopening the URL resumes the current phase.
  A board resumes with matched pairs still face up. Board reloads are logged (`board_x.resume`) and counted in the summary.
- The only on-screen game instruction is "Match the objects." Nothing mentions color,
  orientation or later questions.
- When `DEV_TIMERS=1`, a yellow "DEV TIMERS" badge shows on every screen and on the admin page.

### Test runs and developer mode

The **Test run** panel on `/admin` creates a throwaway session named `TEST-n`. You choose its
condition, board order and starting phase, and you can turn on fast timers (5 s preview) for that
session only. The session opens in a new tab. A purple **TEST** toolbar at the top right of a test
session lets you jump to any phase, restart the current phase, or toggle fast timers. Jumping
clears whatever was recorded from that phase onward. This needs the admin login in that browser.
The sessions table also has **Open** and **Jump to…** controls for test rows.

Test sessions are **left out of every CSV export and the summary**. Delete them from the sessions
table when you're done.
- The phases table records when each exercise/rest phase began and ended (shortcut presses), so you get the real durations.

---

## 6. SA questions

The two theme blocks come in a random order per participant, seeded from
`pid + schedule seed`. With the current config there are **14 questions**: 5 per board block, then
4 spoken environment questions:

1. **Objects**: a grid of the 8 seen objects and 4 randomly chosen foils. The participant taps exactly 8, then Next.
2. Then 4 single-item questions, each about a different, randomly chosen seen object. The
   types are spread as evenly as possible (2 color + 2 side-by-side), in random order. Color
   questions only use mask items; side-by-side questions only use objects that have a variant:
   - **Color**: "What color was the [object]?" The 4 options show the object in each color.
   - **Side by side**: "Which did you see?" The original and altered variant, with left/right randomized.
   - **Orientation** ("Which way was the [object] facing?") is off for now; add it to `sa_questions` to enable it.

3. **Environment SA** (after both blocks): the questions in `oral_sa_questions`, in order. The screen
   tells the facilitator to read the question and choices aloud and tap the participant's answer.

Every single-item question (card and environment) also offers **I don't remember** (scored incorrect,
no confidence rating). Color questions also offer **I'm color blind** (excluded from scoring, no
confidence rating). The analysis groups card questions as **Memory** and environment questions as **SA**.

Each single-item question has an answer and a confidence rating (1–`confidence_scale`).
Both can be changed freely until the participant clicks **Submit**. All images are shown
as they appeared on the board. Correctness is computed on the server from the stored plan
and manifests.

---

## 7. Data and export

Go to `/admin` and log in with `ADMIN_PASSWORD`. The page shows a live card for each
session in progress (phase, time in phase, last activity), every session's progress, and
the schedule. It refreshes every 3 s.

**Cleaning up test data:**
- **Delete** on a session row, or tick several rows and click **Delete selected**, removes
  everything recorded for those participants. They can then start again from the beginning.
- **Reset all data…** deletes every session, click, answer and survey; you must type
  `RESET` to confirm. The schedule is kept.

Both are permanent, so download the CSVs first if you need them.

Download links, each a full table as CSV (every epoch-ms column also gets an `_iso` column):

| File | Contents |
| --- | --- |
| `sessions.csv` | One row per participant: assignment, current phase, timestamps, the SA plan |
| `phases.csv` | Every phase start/end (server ms; client high-res ms where available), plus markers: `baseline.start` (HR lap), `board_a.preview`, `board_a.play` (cards flipped down), `board_a.resume` |
| `clicks.csv` | Every card flip: pid, board, theme, seq, card index, object id, outcome (`first_flip` / `match` / `mismatch`), `client_ts` (`performance.timeOrigin + performance.now()`, fractional ms), `server_ts` |
| `sa_responses.csv` | One row per answer (16 per objects grid): question type, item, target, response, correct, confidence, `rt_ms` (shown → final answer choice), `confidence_rt_ms` (shown → final confidence choice), `submit_rt_ms`, `answer_changes`, `confidence_changes`, what was presented |
| `bouts.csv` | Per exercise/rest bout (`interval1` before Game A, `interval2` before Game B): RPE, peak HR |
| `survey.csv` | Age, exercise days/week, fitness (1–5), hours slept, caffeine, color vision |
| `summary.csv` | One row per participant (below) |

**Summary columns**

- `A_*` / `B_*`:
  - `time_to_clear_ms`: last match minus the moment the cards flipped face down, on the client clock
  - `total_flips`
  - `moves`: completed pairs of flips
  - `efficiency`: pairs found / moves
  - `repeat_errors`: a mismatch where the **second** card's location had already been revealed in an earlier move
  - `missed_matches`: a mismatch where the first card's **partner** had already been revealed, so a match was available
  - `mismatches`: mismatched pairs of flips (errors per game)
  - `reloads`
- `delta_BminusA_*`: B minus A for each of these.
- `q_<type>_acc`, plus `_A` and `_B`: accuracy per question type (`objects`, `color`,
  `side_by_side`, `oral`), overall and per board. `q_<type>_conf` is mean confidence.
- `q_objects_hit_rate`, `_fa_rate` and `_dprime`: recognition d′ = z(H) − z(F), using the
  log-linear correction H = (hits+.5)/(targets+1), F = (FAs+.5)/(foils+1) (Hautus, 1995).
- `memory_*` (card questions: color, side-by-side) and `sa_env_*` (spoken environment questions),
  the Question Type factor:
  - `_n`: number of questions
  - `_acc`: accuracy, with "I don't remember" scored as incorrect
  - `_acc_known`: the sensitivity analysis, with "I don't remember" left out of the denominator
  - `_dont_remember_rate`
  - `_conf`: mean confidence
- `color_blind_answers`: how many "I'm color blind" answers were given. They are excluded from
  every accuracy column. Use the `color_vision` survey answer to drop color questions entirely.
- `rpe_1`, `peak_hr_1`, `pct_hrmax_1` (bout before Game A) and `_2` (bout before Game B):
  %HRmax = peak HR / (220 − age).
- Survey fields: `age`, `exercise_days`, `fitness`, `hours_slept`, `caffeine`, `color_vision`.

The raw database is `data/experiment.db`. Back it up by copying it while the server is
stopped, or with `sqlite3 data/experiment.db ".backup backup.db"`.

**Clock alignment with the HR monitor.** `baseline.start` holds both the server time and
the participant computer's clock time at the moment START was clicked. Sync the computers' clocks
(NTP) or note the HR monitor's offset once per session.

---

## 8. Project layout

```
config.json                 experiment config
assets/themes/<theme>/      manifest.json + images
assets/layouts.json         fixed card layouts (npm run layouts)
scripts/                    CLI: schedule, layouts, icons, validate
src/lib/                    pure logic shared by server, CLI and tests
  schedule.ts layout.ts metrics.ts sa-plan.ts render.ts validate.ts
  server/                   SQLite, session state machine, admin/export
  components/               Board, Interval, Sa, Survey, ...
src/routes/                 participant page (/), admin (/admin), API (/api/session/*)
tests/                      vitest unit tests
```
