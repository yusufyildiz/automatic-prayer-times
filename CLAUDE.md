# Claude Code Project Context

## Project Overview
Home Assistant add-on that plays the adhan at Diyanet prayer times.
Repo is an HA add-on repository: `repository.yaml` at the root, the add-on in `ezan/` (slug `ezan`).
Target: Raspberry Pi 4, Home Assistant OS, aarch64 (amd64 also built).

## Tech Stack
- **Runtime**: Node.js 20+ (ES modules) on `ghcr.io/home-assistant/base` (Alpine, s6-overlay, bashio)
- **Libs**: node-cron, dayjs, mqtt, csv-parse, xlsx (Excel fallback only)
- **No build.yaml** — deprecated; base image is `ARG BUILD_FROM` default in `ezan/Dockerfile`

## Key Architecture Decisions

### Events vs vakits
Internal event keys: `imsak`, `fajr` (= "Sabah"), `dhuhr`, `asr`, `maghrib`, `isha`.
- `imsak` plays at Diyanet's imsak time (default off).
- `fajr`/Sabah plays at **sunrise − `fajr_offset`** (default 40), NOT at imsak. `fajr_offset: 0` → at imsak.
Logic: `computeEventTimes()` in `ezan/src/scheduler.js`. Slugs (`sabah`, `ogle`, …) and Turkish labels: `ezan/src/options.js`.

### Prayer time source (`ezan/src/diyanet-fetcher.js`)
1. Diyanet location page `https://namazvakitleri.diyanet.gov.tr/tr-TR/<id>` — HTML tables (yearly + 30-day).
2. Yearly Excel endpoint (returned HTML as of 2026-11).
3. `prayertimes.api.abdus.dev` (SQL error as of 2026-11).
Results are **merged** into `/data/prayer-times.csv` (never overwritten), days older than 7 days pruned.
Fetch on startup (if not fetched today) and daily at 03:00; retry every 30 min on failure.

### Outputs (`ezan/src/outputs.js`)
- `media_player`: HA Core API via Supervisor proxy (`homeassistant_api: true`): `volume_set` → `play_media` with
  `media-source://media_source/local/ezan/<file>` → poll state until finished → restore previous volume.
- `local`: `mpg123 -o pulse` (mp3) / `paplay` (others), needs `audio: true`.
Audio files live in `/media/ezan/` (`map: media` rw). `beep.wav` is generated there for `button.ezan_test`.

### HA integration (`ezan/src/mqtt-bridge.js`)
MQTT device-based discovery (one message on `homeassistant/device/ezan_addon/config`), entity IDs pinned with
`default_entity_id`. Broker credentials from `GET http://supervisor/services/mqtt` (`services: mqtt:need`).
Topics under `ezan/…`, availability `ezan/availability` with LWT.

### Persistence (`/data`)
- `options.json` — HA add-on options (read by `ezan/src/options.js`)
- `prayer-times.csv` — cache
- `state.json` — mute switches, events already started today (no replay after restart), last adhan, last fetch

### Watchdog
`/health` on port 8099 returns 503 only if today's schedule wasn't built (missed midnight).

## File Map
| File | Purpose |
|------|---------|
| `repository.yaml` | HA add-on repository metadata |
| `ezan/config.yaml` | Add-on manifest, options + schema |
| `ezan/Dockerfile`, `ezan/run.sh` | Image; run.sh exports TZ from options and execs node |
| `ezan/translations/{en,tr}.yaml` | Option labels |
| `ezan/DOCS.md`, `README.md` (root) | User docs (Turkish) |
| `ezan/src/index.js` | Main app: startup, playback + retries, sensors, health |
| `ezan/src/scheduler.js` | Daily cron scheduling, event time computation |
| `ezan/src/csv-parser.js` | CSV cache reader (tz-aware "today") |
| `ezan/src/diyanet-fetcher.js` | Diyanet fetch + merge |
| `ezan/src/state.js` | `/data/state.json` store |
| `ezan/src/ha-client.js` | Supervisor / Core API client |
| `.github/workflows/addon.yml` | Tests + buildx aarch64/amd64 + in-image smoke test |

## Testing
```bash
cd ezan && npm test
```
Dev env overrides: `EZAN_DATA_DIR`, `EZAN_MEDIA_DIR`, `EZAN_MQTT_URL`, `EZAN_HA_URL`, `EZAN_HA_TOKEN`, `EZAN_HEALTH_PORT`.
No Docker on the dev machine — image builds are verified in GitHub Actions.

## UI Naming Convention
- fajr = "Sabah" (not "Imsak"); imsak is its own event
- Logs and entity names are Turkish
