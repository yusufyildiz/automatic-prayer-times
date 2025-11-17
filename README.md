# Automatic Prayer Times - Adhan Player for Google Nest Hub

Automatically play Adhan (Islamic call to prayer) on your Google Nest Hub at scheduled prayer times. Prayer times are loaded from a CSV file.

## Features

- 🕌 Plays Adhan audio at exact prayer times
- 🎵 Different Adhan audio for each prayer (optional)
- 📅 Reads prayer times from CSV file (supports English & Turkish formats)
- 🔊 Casts audio to Google Nest Hub
- ⏰ Automatic scheduling with daily refresh
- 🇦🇹 Vienna timezone configured (customizable)
- 🍓 Runs on Raspberry Pi

## Requirements

- Node.js 18 or higher
- Google Nest Hub (with screen) on the same network
- Adhan audio file (MP3)
- CSV file with prayer times

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Find Your Google Nest Hub IP

Run the discovery tool:

```bash
npm start -- --discover
```

Or check your router's admin panel for the device's IP address.

### 3. Configure

Edit `config/config.json`:

```json
{
  "deviceIp": "192.168.1.100",  // Your Nest Hub IP
  "volume": 0.7,                 // Volume (0.0 to 1.0)
  "timezone": "Europe/Vienna",   // Your timezone
  "prayers": ["fajr", "dhuhr", "asr", "maghrib", "isha"],
  "csvFile": "prayer-times.csv",
  "adhanAudioFile": "adhan.mp3",
  "audioFiles": {
    "fajr": "adhan-fajr.mp3",
    "dhuhr": "adhan-dhuhr.mp3",
    "asr": "adhan-asr.mp3",
    "maghrib": "adhan-maghrib.mp3",
    "isha": "adhan-isha.mp3"
  }
}
```

**Note**: The `audioFiles` object is optional. If you want the same Adhan for all prayers, just use `adhanAudioFile`. If you want different Adhan for each prayer (e.g., special Fajr Adhan), configure `audioFiles`.

### 4. Add Your Files

1. **Prayer Times CSV**: Copy your CSV file to `data/prayer-times.csv`

   Format (English):
   ```csv
   Date,Fajr,Sunrise,Dhuhr,Asr,Maghrib,Isha
   2024-11-17,05:32,07:12,11:48,14:23,16:24,18:04
   ```

   Format (Turkish):
   ```csv
   Miladi Tarih,İmsak,Güneş,Öğle,İkindi,Akşam,Yatsı
   01 Ocak 2025,05:51,07:38,12:03,13:57,16:18,17:52
   ```

2. **Adhan Audio**: Place your MP3 file(s) in the `audio/` directory

   - Single file: `audio/adhan.mp3`
   - Multiple files: `audio/adhan-fajr.mp3`, `audio/adhan-dhuhr.mp3`, etc.

   You can download Adhan audio from various Islamic websites.

### 5. Run

```bash
npm start
```

## CSV File Format

The system supports multiple CSV formats:

### English Format

- `Date` - Date in YYYY-MM-DD format (also supports DD/MM/YYYY, MM/DD/YYYY)
- `Fajr` - Fajr prayer time (HH:MM)
- `Sunrise` - Sunrise time (optional)
- `Dhuhr` - Dhuhr/Zuhr prayer time
- `Asr` - Asr prayer time
- `Maghrib` - Maghrib prayer time
- `Isha` - Isha prayer time

Example:
```csv
Date,Fajr,Sunrise,Dhuhr,Asr,Maghrib,Isha
2024-11-17,05:32,07:12,11:48,14:23,16:24,18:04
2024-11-18,05:33,07:14,11:48,14:22,16:23,18:03
```

### Turkish Format

- `Miladi Tarih` - Date in "DD Month YYYY" format (e.g., "01 Ocak 2025")
- `İmsak` - Fajr/Imsak time
- `Güneş` - Sunrise time
- `Öğle` - Dhuhr/Zuhr time
- `İkindi` - Asr time
- `Akşam` - Maghrib time
- `Yatsı` - Isha time

Example:
```csv
Miladi Tarih,İmsak,Güneş,Öğle,İkindi,Akşam,Yatsı
01 Ocak 2025,05:51,07:38,12:03,13:57,16:18,17:52
02 Ocak 2025,05:51,07:38,12:03,13:58,16:19,17:53
```

**Note**: The system auto-detects the format based on column names.

## Configuration Options

| Option | Description | Default |
|--------|-------------|---------|
| `deviceIp` | IP address of Google Nest Hub | Required |
| `deviceName` | Name of the device (for reference) | "Google Nest Hub" |
| `volume` | Volume level (0.0 - 1.0) | 0.7 |
| `timezone` | Timezone for scheduling | "Europe/Vienna" |
| `prayers` | Which prayers to announce | All five prayers |
| `csvFile` | Name of CSV file in data/ folder | "prayer-times.csv" |
| `adhanAudioFile` | Default audio file (fallback) | "adhan.mp3" |
| `audioFiles` | Object mapping each prayer to its audio file | null (uses adhanAudioFile) |
| `serverPort` | HTTP server port for audio streaming | 3000 |
| `localIp` | Override local IP detection | Auto-detect |
| `testConnection` | Test Cast connection on startup | false |

## Running on Raspberry Pi

### Install Node.js 18+

```bash
# Update package list
sudo apt update

# Install Node.js 18.x
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify installation
node --version
npm --version
```

### Install mDNS Dependencies

```bash
sudo apt-get install libavahi-compat-libdnssd-dev
```

### Run as a Service

1. Copy the service file:

```bash
sudo cp adhan-player.service /etc/systemd/system/
```

2. Edit the service file to match your paths:

```bash
sudo nano /etc/systemd/system/adhan-player.service
```

3. Enable and start the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable adhan-player
sudo systemctl start adhan-player
```

4. Check status:

```bash
sudo systemctl status adhan-player
```

5. View logs:

```bash
journalctl -u adhan-player -f
```

## Troubleshooting

### Device Not Found

- Ensure Nest Hub and computer/Pi are on the same network
- Check if the IP address is correct
- Try running `npm start -- --discover` to find devices
- Make sure port 3000 is not blocked by firewall

### Audio Not Playing

- Verify the audio file exists in `audio/` directory
- Check if the audio file is a valid MP3
- Ensure the Nest Hub volume is not muted
- Test with a simple audio file first

### Prayer Times Not Loading

- Check CSV file format matches the example
- Verify dates are in the correct format
- Ensure the CSV file is in the `data/` directory
- Check for UTF-8 encoding (no special characters)

### Network Issues

- Open port 3000 in your firewall
- Ensure both devices can communicate
- Try static IP for Nest Hub in router settings

## Project Structure

```
automatic-prayer-times/
├── src/
│   ├── index.js          # Main entry point
│   ├── scheduler.js      # Cron job scheduler
│   ├── cast.js           # Google Cast integration
│   ├── csv-parser.js     # CSV prayer times reader
│   └── server.js         # HTTP server for audio
├── audio/
│   ├── adhan.mp3         # Default Adhan (or single file)
│   ├── adhan-fajr.mp3    # Fajr-specific Adhan (optional)
│   ├── adhan-dhuhr.mp3   # Dhuhr-specific Adhan (optional)
│   ├── adhan-asr.mp3     # Asr-specific Adhan (optional)
│   ├── adhan-maghrib.mp3 # Maghrib-specific Adhan (optional)
│   └── adhan-isha.mp3    # Isha-specific Adhan (optional)
├── data/
│   └── prayer-times.csv  # Your prayer times (Turkish or English)
├── config/
│   └── config.json       # Configuration
├── package.json
├── adhan-player.service  # Systemd service file
└── README.md
```

## License

MIT

## Contributing

Feel free to submit issues and pull requests!

---

May your prayers be accepted. 🤲
