# Concentration + Situation Awareness study

A web app for a one-session (~20 min) experiment. Each participant does a practice
matching game, an exercise or standing-rest period, two themed Concentration boards
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
| `preview_s`, `mismatch_flip_ms` | Face-up preview length (currently 10 s); delay before a mismatch flips back |
| `board_time_limit_s` | Seconds of play allowed on each matching board (practice, A and B), counted from when the cards flip face down. Currently 90. The clock is hidden; only the last 5 seconds count down in the top-right corner. When it runs out the board ends ("Time's up!") and the session moves on. `0` or omitted = no limit. Fast timers do not shorten it |
| `max_participants` | Default N for the schedule |
| `sa_questions` | Question types. Currently `objects`, `color`, `side_by_side`; add `orientation` back to ask it |
| `sa_random_per_theme` | Single-item questions per theme after the objects grid (currently 4; 18 questions in total with Level 2 and the environment questions, see §6). Remove it to ask every type about every object |
| `sa_foils_per_theme` | Foils shown in the objects grid (a random subset per participant; currently 4, so the grid is 8 + 4 = 12). Remove it to show every foil |
| `confidence_scale`, `confidence_labels` | e.g. 4 and the two end labels. `0` turns the confidence rating off |
| `colors` | The 4 colors: `{id, label, hex}` |
| `orientations` | The 4 orientations: `{id, label, rotate_deg}`. `rotate_deg` is applied to the image as drawn. Every object is currently `up` (unrotated) |
| `condition_text` | Per condition: the `interval1` / `interval2` screen title and body |
| `oral_sa_questions` | Environment SA questions asked aloud by the facilitator after the on-screen questions: `{id, prompt, options: [{id, label}]}`. `options` are the choices the facilitator reads out. There is no answer key: the facilitator marks each answer correct or incorrect against what was really there that session (e.g. that day's hat) |
| `sa_level2_questions` | Level 2 questions per theme id, asked after that theme's Level 1 questions in the order listed. `{id, kind: "color_pair", prompt, cue, answer}` (cue and answer are seen object ids of the same color) or `{id, kind: "count", prompt, options: [{id, label}], answer}` |
| `sa_level2_neutral_hex` | The single color all color-pair options are drawn in (default `#8c8c8c`) |

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
| Practice | 3×4 emoji board with on-screen walkthrough hints and the same time limit. Clicks are not logged. | Shortcut when done (pressing early asks for a second press to skip) |
| Exercise / rest 1 | Full-screen instructions for the condition and "Wait for facilitator". No clock: the facilitator times it. A facilitator strip at the bottom records **RPE** (Borg 6–20, show the card) and optional **peak HR** at the end of the bout | Tap RPE, then shortcut (pressing without RPE asks for a second press) |
| Board A | Participant presses Start. Cards are face up for `preview_s` with a countdown, then flip down and the play clock (`board_time_limit_s`) starts. When the board is cleared or time runs out, the app advances automatically. | — |
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
`pid + schedule seed`. With the current config there are **18 questions**: 8 per board block (1 grid + 4 Level 1
items + 3 Level 2), then 2 spoken environment questions:

1. **Objects**: a grid of the 8 seen objects and 4 randomly chosen foils. The participant taps exactly 8, then Next.
2. Then 4 single-item questions, each about a different, randomly chosen seen object. The
   types are spread as evenly as possible (2 color + 2 side-by-side), in random order. Color
   questions only use mask items; side-by-side questions only use objects that have a variant:
   - **Color**: "What color was the [object]?" The 4 options show the object in each color.
   - **Side by side**: "Which did you see?" The original and altered variant, with left/right randomized.
   - **Orientation** ("Which way was the [object] facing?") is off for now; add it to `sa_questions` to enable it.

3. **Level 2** (end of each block, in `sa_level2_questions` order):
   - **Color pair**: e.g. "Which vehicle was the same color as the train?" 4 picture options: the
     answer plus 3 other seen objects chosen at random per participant (never the cue, never an
     original image, never the cue's color), in random order, all drawn in the neutral gray.
   - **Count**: e.g. "How many of the vehicles could fly?" Text options.
   Options are drawn from a separate random stream, so a PID's Level 1 questions are the same as before Level 2 existed.

4. **Environment SA** (after both blocks): the participant's screen says only "Please stand up and talk
   to your facilitator, who will ask you some questions about the environment." The facilitator presses
   <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> to show the controls, then for each question in
   `oral_sa_questions` asks it, reads the choices, and taps **Correct**, **Incorrect** or **Didn't
   remember** (scored incorrect), then Next. No confidence rating. After the last one the session moves to the survey.

Every single-item card question also offers **I don't remember** (scored incorrect,
no confidence rating). Color and Level 2 color-pair questions also offer **I'm color blind** (excluded from scoring, no
confidence rating). The analysis groups Level 1 card questions as **Memory**, Level 2 card questions as **Level 2**,
and environment questions as **SA**.

Each single-item question has an answer and a confidence rating (1–`confidence_scale`).
Both can be changed freely until the participant clicks **Submit**. All images are shown
as they appeared on the board. Correctness is computed on the server from the stored plan
and manifests.

---

## 7. Data and export

Go to `/admin` and log in with `ADMIN_PASSWORD`. The page shows a live card for each
session in progress (phase, time in phase, last activity), every session's progress, and
the schedule. It refreshes every 3 s.

**Data explorer** (`/admin/explore`, or click a PID in the sessions table):
- Overview: participants, completed sessions, boards that timed out, and a table of means per
  condition (board times, errors, timeouts, memory / SA accuracy, d′, RPE, peak HR).
- A sortable participant table; click a row to open that participant.
- Participant view: phase timeline with durations and markers (preview, play, timeout, reload),
  each board drawn with its real images showing how often each card was flipped and the order
  pairs were matched, board metrics and the full click log, RPE / peak HR, survey answers, and
  every SA answer marked right or wrong.
- Test sessions are hidden unless you tick **Include test sessions**.

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
| `phases.csv` | Every phase start/end (server ms; client high-res ms where available), plus markers: `baseline.start` (HR lap), `board_a.preview`, `board_a.play` (cards flipped down), `board_a.timeout` (time limit ran out), `board_a.resume` |
| `clicks.csv` | Every card flip: pid, board, theme, seq, card index, object id, outcome (`first_flip` / `match` / `mismatch`), `client_ts` (`performance.timeOrigin + performance.now()`, fractional ms), `server_ts` |
| `sa_responses.csv` | One row per answer (16 per objects grid): question type, item, target, response, correct, confidence, `rt_ms` (shown → final answer choice), `confidence_rt_ms` (shown → final confidence choice), `submit_rt_ms`, `answer_changes`, `confidence_changes`, what was presented (for Level 2 color pairs: the 4 option ids and the neutral color). Level 2 rows are re-scored against the current config on export. Environment rows: response `correct` / `incorrect` / `dont_remember` as marked by the facilitator |
| `bouts.csv` | Per exercise/rest bout (`interval1` before Game A, `interval2` before Game B): RPE, peak HR |
| `survey.csv` | Age, exercise days/week, fitness (1–5), hours slept, caffeine, color vision |
| `summary.csv` | One row per participant (below) |

**Summary columns**

- `A_*` / `B_*`:
  - `cleared`, `timed_out` (1 if the time limit ran out before the board was cleared), `pairs_found`
  - `time_to_clear_ms`: last match minus the moment the cards flipped face down, on the client clock (blank if not cleared)
  - `total_flips`
  - `moves`: completed pairs of flips
  - `efficiency`: pairs found / moves
  - `repeat_errors`: a mismatch where the **second** card's location had already been revealed in an earlier move
  - `missed_matches`: a mismatch where the first card's **partner** had already been revealed, so a match was available
  - `mismatches`: mismatched pairs of flips (errors per game)
  - `reloads`
- `delta_BminusA_*`: B minus A for each of these.
- `q_<type>_acc`, plus `_A` and `_B`: accuracy per question type (`objects`, `color`,
  `side_by_side`, `level2_color`, `level2_count`, `oral`), overall and per board. `q_<type>_conf` is mean confidence.
- `q_objects_hit_rate`, `_fa_rate` and `_dprime`: recognition d′ = z(H) − z(F), using the
  log-linear correction H = (hits+.5)/(targets+1), F = (FAs+.5)/(foils+1) (Hautus, 1995).
- `memory_*` (Level 1 card questions: color, side-by-side), `level2_*` (Level 2 card questions) and
  `sa_env_*` (spoken environment questions, as marked by the facilitator),
  the Question Type factor:
  - `_n`: number of questions
  - `_acc`: accuracy, with "I don't remember" scored as incorrect
  - `_acc_known`: the sensitivity analysis, with "I don't remember" left out of the denominator
  - `_dont_remember_rate`
  - `_conf`: mean confidence
- `level2_acc_excl_color`: Level 2 accuracy without the color-pair questions (only the count
  question remains), for color-blind participants.
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
