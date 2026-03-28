# Claude Code Project Context

## Project Overview
Automatic prayer times system that plays Adhan on Google Nest Hub at scheduled times.
Runs on Raspberry Pi (Ubuntu, ARM64) as a systemd service.

## Tech Stack
- **Runtime**: Node.js 18+ (ES modules)
- **Backend**: Express.js, node-cron, castv2-client
- **Frontend**: Vanilla HTML/CSS/JS (no framework)
- **Service**: systemd (`adhan-player.service`)

## Key Architecture Decisions

### Fajr (Sabah) Scheduling
Sabah namazi is scheduled at **sunrise - 40 minutes**, NOT at the CSV imsak time.
Logic is in `src/scheduler.js` — when `prayer === 'fajr'`, it reads `prayerTimes.sunrise` and subtracts 40 min.

### Per-Prayer Volume
Each prayer has its own volume level stored in `config.volumes` (object: prayer -> 0.0-1.0).
Falls back to global `config.volume` if not set. Used in `src/index.js:onPrayerTime()`.

### Beep Test
`audio/beep.wav` is auto-generated at startup (440Hz, 0.5s sine wave) if missing.
Test-cast endpoint plays it at 30% volume (`src/api-routes.js`).

### Diyanet API
Prayer times fetched from `https://prayertimes.api.abdus.dev/api/diyanet`.
Location ID configurable via `config.diyanetLocationId` (default: 11618 = Vienna).
Auto-fetches on startup if CSV missing/stale. Monthly refresh on 25th at 03:00.

## File Map
| File | Purpose |
|------|---------|
| `src/index.js` | Main app, AdhanPlayer class, beep generator |
| `src/scheduler.js` | Cron scheduling, fajr sunrise-40min logic |
| `src/cast.js` | Google Cast (castv2-client) player |
| `src/csv-parser.js` | CSV parser (English & Turkish formats) |
| `src/server.js` | Express HTTP server, static file serving |
| `src/api-routes.js` | REST API endpoints for dashboard |
| `src/diyanet-fetcher.js` | Diyanet API fetcher |
| `public/index.html` | Dashboard HTML |
| `public/css/style.css` | Sacred Twilight theme CSS |
| `public/js/app.js` | Dashboard logic (tab nav, forms, rendering) |
| `public/js/api.js` | Fetch wrapper for API calls |
| `config/config.json` | Runtime configuration |
| `data/*.csv` | Prayer times CSV files |
| `audio/*.mp3` | Adhan audio files |

## API Endpoints
- `GET /api/status` — System status, prayer times, next prayer
- `GET /api/config` / `PUT /api/config` — Read/write config
- `GET /api/prayer-times/today` — Today's times
- `GET /api/audio-files` / `POST upload` / `DELETE` — Audio file CRUD
- `GET /api/csv-files` / `POST upload` / `DELETE` / `POST activate` — CSV file CRUD
- `POST /api/actions/reschedule` — Re-schedule today's prayers
- `POST /api/actions/test-cast` — Play beep on speaker (30% vol)
- `POST /api/actions/fetch-times` — Fetch from Diyanet API
- `POST /api/actions/toggle-system` — Enable/disable scheduling

## Service Management
```bash
sudo systemctl restart adhan-player   # restart
sudo systemctl status adhan-player    # status
sudo journalctl -u adhan-player -f    # live logs
```

## UI Naming Convention
- fajr = "Sabah" (not "Imsak") — throughout the dashboard
- deviceIp label = "Hoparlor IP" (speaker IP)
- CSV tab = "Data"

## Config Example
```json
{
  "deviceIp": "192.168.1.100",
  "volume": 0.29,
  "timezone": "Europe/Vienna",
  "prayers": ["fajr", "dhuhr", "asr", "maghrib", "isha"],
  "adhanAudioFile": "adhan.mp3",
  "audioFiles": { "fajr": "adhan-fajr.mp3", ... },
  "volumes": { "fajr": 0.29, "dhuhr": 0.54, ... },
  "diyanetLocationId": 11618,
  "csvFile": "prayer-times.csv"
}
```
