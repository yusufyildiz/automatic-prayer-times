import { PrayerTimesParser } from './csv-parser.js';
import { AudioServer } from './server.js';
import { GoogleCastPlayer, discoverDevices } from './cast.js';
import { PrayerScheduler } from './scheduler.js';
import { DiyanetFetcher } from './diyanet-fetcher.js';
import { registerApiRoutes } from './api-routes.js';
import { PrayerHistory } from './prayer-history.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import cron from 'node-cron';
import dayjs from 'dayjs';
import dayjsTimezone from 'dayjs/plugin/timezone.js';
import dayjsUtc from 'dayjs/plugin/utc.js';

dayjs.extend(dayjsUtc);
dayjs.extend(dayjsTimezone);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Generate a short beep WAV file (440Hz sine wave, 0.5s, mono, 16-bit)
 */
function generateBeepWav(filePath) {
  const sampleRate = 44100;
  const duration = 0.5;
  const frequency = 440;
  const numSamples = Math.floor(sampleRate * duration);
  const dataSize = numSamples * 2; // 16-bit = 2 bytes per sample

  const buffer = Buffer.alloc(44 + dataSize);

  // WAV header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);       // chunk size
  buffer.writeUInt16LE(1, 20);        // PCM format
  buffer.writeUInt16LE(1, 22);        // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32);        // block align
  buffer.writeUInt16LE(16, 34);       // bits per sample
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Generate sine wave samples
  for (let i = 0; i < numSamples; i++) {
    const sample = Math.sin(2 * Math.PI * frequency * i / sampleRate);
    // Apply fade in/out (50ms) to avoid clicks
    const fadeLen = Math.floor(sampleRate * 0.05);
    let amplitude = 0.8;
    if (i < fadeLen) amplitude *= i / fadeLen;
    if (i > numSamples - fadeLen) amplitude *= (numSamples - i) / fadeLen;
    const intSample = Math.max(-32768, Math.min(32767, Math.floor(sample * amplitude * 32767)));
    buffer.writeInt16LE(intSample, 44 + i * 2);
  }

  writeFileSync(filePath, buffer);
  console.log(`Generated beep sound: ${filePath}`);
}

/**
 * Ensure beep.wav exists in the audio directory
 */
function ensureBeepWav(rootDir) {
  const audioDir = join(rootDir, 'audio');
  if (!existsSync(audioDir)) {
    mkdirSync(audioDir, { recursive: true });
  }
  const beepPath = join(audioDir, 'beep.wav');
  if (!existsSync(beepPath)) {
    generateBeepWav(beepPath);
  }
}

/**
 * Main application entry point
 */
class AdhanPlayer {
  constructor() {
    this.config = null;
    this.parser = null;
    this.server = null;
    this.scheduler = null;
    this.fetcher = null;
    this.yearlyFetchJobs = [];
    this.castPlayer = null;
    this.isRunning = false;
    this.rootDir = join(__dirname, '..');
    this.logBuffer = [];
    this.maxLogLines = 200;

    // Silent mode (runtime state, not persisted)
    this.silentMode = false;
    this.silentModeTimer = null;
    this.silentModeExpiry = null;

    // Ramadan alert jobs
    this.ramadanAlertJobs = [];

    // Prayer history tracking
    this.prayerHistory = new PrayerHistory();

    // Intercept console.log/warn/error to capture logs
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;
    const self = this;

    const addLog = (level, args) => {
      const message = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
      self.logBuffer.push({ timestamp: new Date().toISOString(), level, message });
      if (self.logBuffer.length > self.maxLogLines) {
        self.logBuffer.shift();
      }
    };

    console.log = (...args) => { addLog('info', args); originalLog.apply(console, args); };
    console.warn = (...args) => { addLog('warn', args); originalWarn.apply(console, args); };
    console.error = (...args) => { addLog('error', args); originalError.apply(console, args); };
  }

  /**
   * Load configuration
   */
  loadConfig() {
    const configPath = join(__dirname, '..', 'config', 'config.json');

    if (!existsSync(configPath)) {
      throw new Error(`Configuration file not found: ${configPath}`);
    }

    const configData = readFileSync(configPath, 'utf-8');
    this.config = JSON.parse(configData);

    console.log('Configuration loaded:');
    console.log(`  Device IP: ${this.config.deviceIp}`);
    console.log(`  Volume: ${this.config.volume * 100}%`);
    console.log(`  Timezone: ${this.config.timezone}`);
    console.log(`  Prayers: ${this.config.prayers.join(', ')}`);

    // Show audio file configuration
    if (this.config.audioFiles) {
      console.log('  Audio files (per prayer):');
      for (const prayer of this.config.prayers) {
        const audioFile = this.config.audioFiles[prayer] || this.config.adhanAudioFile;
        console.log(`    ${prayer}: ${audioFile}`);
      }
    } else {
      console.log(`  Audio file: ${this.config.adhanAudioFile}`);
    }
  }

  /**
   * Initialize all components
   */
  async initialize() {
    console.log('\n🕌 Initializing Adhan Player...\n');

    // Ensure beep.wav exists for device testing
    ensureBeepWav(this.rootDir);

    // Load configuration
    this.loadConfig();

    // Initialize Diyanet fetcher
    this.fetcher = new DiyanetFetcher({
      locationId: this.config.diyanetLocationId || 11618,
      csvFile: this.config.csvFile || 'prayer-times.csv',
    });

    // Auto-fetch prayer times if CSV is missing or data doesn't cover today
    const csvPath = join(__dirname, '..', 'data', this.config.csvFile || 'prayer-times.csv');
    await this.ensurePrayerTimesData(csvPath);

    this.parser = new PrayerTimesParser(csvPath);
    await this.parser.load();

    // Check if today's data is available
    if (!this.parser.getTodaysPrayerTimes()) {
      console.warn('⚠️  Warning: No prayer times found for today!');
      console.warn('Available dates:', this.parser.getAvailableDates().slice(0, 5).join(', '), '...');
    }

    // Initialize HTTP server
    this.server = new AudioServer({
      port: this.config.serverPort || 3000,
      audioDir: join(__dirname, '..', 'audio'),
      localIp: this.config.localIp,
    });
    await this.server.start();

    // Verify audio files exist
    this.verifyAudioFiles();

    // Initialize scheduler
    this.scheduler = new PrayerScheduler({
      timezone: this.config.timezone,
      prayers: this.config.prayers,
      onPrayerTime: (prayer, time) => this.onPrayerTime(prayer, time),
    });

    // Test connection to Cast device (optional)
    if (this.config.testConnection) {
      await this.testCastConnection();
    }

    // Register API routes for web dashboard
    registerApiRoutes(this.server.app, this);

    console.log('\n✅ Initialization complete!\n');
  }

  /**
   * Ensure prayer times CSV exists and has data for today
   */
  async ensurePrayerTimesData(csvPath) {
    let needsFetch = false;

    if (!existsSync(csvPath)) {
      console.log('CSV file not found, fetching from Diyanet...');
      needsFetch = true;
    } else {
      // Check if CSV has data for today
      const tempParser = new PrayerTimesParser(csvPath);
      await tempParser.load();
      if (!tempParser.getTodaysPrayerTimes()) {
        console.log('CSV does not contain today\'s prayer times, fetching from Diyanet...');
        needsFetch = true;
      }
    }

    if (needsFetch) {
      try {
        await this.fetcher.fetchAndSave();
      } catch (error) {
        console.error('Failed to fetch prayer times from Diyanet:', error.message);
        if (!existsSync(csvPath)) {
          throw new Error('No prayer times CSV available and Diyanet fetch failed');
        }
        console.warn('Using existing CSV file as fallback');
      }
    }
  }

  /**
   * Schedule yearly prayer times fetch
   * - Jan 1 at 03:00 — fetch current year's data
   * - Dec 15 at 03:00 — pre-fetch next year's data
   */
  scheduleYearlyFetch() {
    const fetchHandler = async (label) => {
      console.log(`\n📅 ${label} - fetching from Diyanet...`);
      try {
        await this.fetcher.fetchAndSave();
        await this.parser.reload();
        this.scheduleTodaysPrayers();
        console.log(`✅ ${label} complete`);
      } catch (error) {
        console.error(`❌ ${label} failed:`, error.message);
      }
    };

    // Jan 1 at 03:00 — refresh current year
    this.yearlyFetchJobs = [];
    this.yearlyFetchJobs.push(cron.schedule(
      '0 3 1 1 *',
      () => fetchHandler('Yearly prayer times refresh (Jan 1)'),
      { scheduled: true, timezone: this.config.timezone }
    ));

    // Dec 15 at 03:00 — pre-fetch next year
    this.yearlyFetchJobs.push(cron.schedule(
      '0 3 15 12 *',
      () => fetchHandler('Next year prayer times pre-fetch (Dec 15)'),
      { scheduled: true, timezone: this.config.timezone }
    ));

    console.log('Scheduled yearly Diyanet fetch (Jan 1 + Dec 15 at 03:00)');
  }

  /**
   * Verify audio files exist
   */
  verifyAudioFiles() {
    const audioDir = join(__dirname, '..', 'audio');
    const missingFiles = [];

    if (this.config.audioFiles) {
      // Check prayer-specific audio files
      for (const prayer of this.config.prayers) {
        const audioFile = this.config.audioFiles[prayer] || this.config.adhanAudioFile;
        const audioFilePath = join(audioDir, audioFile);
        if (!existsSync(audioFilePath)) {
          missingFiles.push(`${prayer}: ${audioFile}`);
        }
      }
    } else {
      // Check single audio file
      const audioFilePath = join(audioDir, this.config.adhanAudioFile);
      if (!existsSync(audioFilePath)) {
        missingFiles.push(this.config.adhanAudioFile);
      }
    }

    if (missingFiles.length > 0) {
      console.warn('⚠️  Warning: Missing audio files:');
      missingFiles.forEach((file) => console.warn(`    - ${file}`));
      console.warn('Please add your Adhan audio files (MP3) to the audio directory.');
    } else {
      console.log('✅ All audio files found');
    }
  }

  /**
   * Get audio file for a specific prayer
   * On Fridays, dhuhr uses friday.audioFile if configured
   */
  getAudioFileForPrayer(prayer) {
    // Friday override for dhuhr
    if (prayer === 'dhuhr') {
      const tz = this.config.timezone || 'Europe/Vienna';
      const now = dayjs().tz(tz);
      if (now.day() === 5 && this.config.friday && this.config.friday.audioFile) {
        return this.config.friday.audioFile;
      }
    }
    if (this.config.audioFiles && this.config.audioFiles[prayer]) {
      return this.config.audioFiles[prayer];
    }
    return this.config.adhanAudioFile;
  }

  /**
   * Test connection to Google Cast device
   */
  async testCastConnection() {
    console.log('Testing connection to Google Cast device...');
    try {
      const player = new GoogleCastPlayer({
        deviceIp: this.config.deviceIp,
        volume: this.config.volume,
      });
      await player.connect();
      player.cleanup();
      console.log('✅ Successfully connected to Cast device');
    } catch (error) {
      console.error('❌ Failed to connect to Cast device:', error.message);
      console.log('Make sure:');
      console.log('  1. The device IP is correct');
      console.log('  2. Your computer and Nest Hub are on the same network');
      console.log('  3. The Nest Hub is powered on');
    }
  }

  /**
   * Handle prayer time event
   */
  async onPrayerTime(prayer, time) {
    console.log(`\n🕌 Time for ${prayer} prayer (${time})`);

    // Silent mode check
    if (this.silentMode) {
      console.log(`🔇 Sessiz mod aktif, ${prayer} atlanıyor`);
      if (this.prayerHistory) {
        this.prayerHistory.record(prayer, time, 'skipped', 'silent_mode');
      }
      return;
    }

    // Get per-prayer volume, fallback to global volume
    let volume = (this.config.volumes && this.config.volumes[prayer] !== undefined)
      ? this.config.volumes[prayer]
      : this.config.volume;

    // Friday volume override for dhuhr
    if (prayer === 'dhuhr') {
      const tz = this.config.timezone || 'Europe/Vienna';
      const now = dayjs().tz(tz);
      if (now.day() === 5 && this.config.friday && this.config.friday.volume !== undefined) {
        volume = this.config.friday.volume;
        console.log(`🕌 Cuma gunü - ozel ses ayari kullaniliyor`);
      }
    }

    // Get audio file for this specific prayer
    const audioFile = this.getAudioFileForPrayer(prayer);
    const audioUrl = this.server.getAudioUrl(audioFile);
    console.log(`Volume: ${Math.round(volume * 100)}%`);
    console.log(`Audio file: ${audioFile}`);
    console.log(`Audio URL: ${audioUrl}`);

    // Retry logic: up to 3 attempts with 5 second delay
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 1) {
          console.log(`🔄 Tekrar deneniyor (${attempt}/${maxRetries})...`);
          await new Promise(r => setTimeout(r, 5000));
        }

        // Create fresh cast player instance for each attempt
        this.castPlayer = new GoogleCastPlayer({
          deviceIp: this.config.deviceIp,
          volume,
        });

        // Play Adhan
        await this.castPlayer.playAdhan(audioUrl, this.capitalizeFirst(prayer));

        console.log(`✅ Adhan playback completed for ${prayer}`);
        if (this.prayerHistory) {
          this.prayerHistory.record(prayer, time, 'played');
        }
        return; // Success, exit
      } catch (error) {
        console.error(`❌ Deneme ${attempt}/${maxRetries} basarisiz (${prayer}): ${error.message}`);
        if (this.castPlayer) {
          this.castPlayer.cleanup();
          this.castPlayer = null;
        }

        if (attempt === maxRetries) {
          console.error(`❌ ${maxRetries} deneme sonrasi ${prayer} calınamadı`);
          if (this.prayerHistory) {
            this.prayerHistory.record(prayer, time, 'failed', error.message);
          }
        }
      } finally {
        if (this.castPlayer) {
          this.castPlayer.cleanup();
          this.castPlayer = null;
        }
      }
    }
  }

  /**
   * Enable silent mode
   * @param {number|null} durationMinutes - Duration in minutes, null for indefinite
   */
  enableSilentMode(durationMinutes) {
    if (this.silentModeTimer) {
      clearTimeout(this.silentModeTimer);
      this.silentModeTimer = null;
    }

    this.silentMode = true;

    if (durationMinutes) {
      this.silentModeExpiry = new Date(Date.now() + durationMinutes * 60 * 1000).toISOString();
      this.silentModeTimer = setTimeout(() => {
        this.disableSilentMode();
        console.log('🔔 Sessiz mod suresi doldu, ses tekrar aktif');
      }, durationMinutes * 60 * 1000);
      console.log(`🔇 Sessiz mod aktif (${durationMinutes} dakika)`);
    } else {
      this.silentModeExpiry = null;
      console.log('🔇 Sessiz mod aktif (suresiz)');
    }
  }

  /**
   * Disable silent mode
   */
  disableSilentMode() {
    if (this.silentModeTimer) {
      clearTimeout(this.silentModeTimer);
      this.silentModeTimer = null;
    }
    this.silentMode = false;
    this.silentModeExpiry = null;
    console.log('🔔 Sessiz mod kapatildi');
  }

  /**
   * Schedule Ramadan alerts (iftar & sahur warnings)
   */
  scheduleRamadanAlerts(todaysTimes) {
    // Clear previous ramadan jobs
    this.ramadanAlertJobs.forEach(job => job.stop());
    this.ramadanAlertJobs = [];

    const ramadan = this.config.ramadan;
    if (!ramadan || !ramadan.enabled || !todaysTimes) return;

    const tz = this.config.timezone || 'Europe/Vienna';
    const now = dayjs().tz(tz);

    // Iftar alert: maghrib - N minutes
    if (ramadan.iftarAlertAudioFile && todaysTimes.maghrib) {
      const [mH, mM] = todaysTimes.maghrib.split(':').map(Number);
      const alertMin = ramadan.iftarAlertMinutesBefore || 15;
      const totalMin = mH * 60 + mM - alertMin;
      const alertH = Math.floor(totalMin / 60);
      const alertM = totalMin % 60;

      const alertTime = now.clone().hour(alertH).minute(alertM).second(0);
      if (alertTime.isAfter(now)) {
        const cronExpr = `${alertM} ${alertH} * * *`;
        const job = cron.schedule(cronExpr, () => {
          this.playRamadanAlert(ramadan.iftarAlertAudioFile, 'Iftar Uyarisi');
        }, { scheduled: true, timezone: tz });
        this.ramadanAlertJobs.push(job);
        console.log(`  Ramazan iftar uyarisi: ${String(alertH).padStart(2,'0')}:${String(alertM).padStart(2,'0')} (maghrib - ${alertMin}dk)`);
      }
    }

    // Sahur alert: fajr (adjusted) - N minutes
    if (ramadan.sahurAlertAudioFile) {
      let fajrH, fajrM;
      if (todaysTimes.sunrise) {
        const [sunH, sunM] = todaysTimes.sunrise.split(':').map(Number);
        const fajrTotal = (sunH * 60 + sunM) - 40;
        fajrH = Math.floor(fajrTotal / 60);
        fajrM = fajrTotal % 60;
      } else if (todaysTimes.fajr) {
        [fajrH, fajrM] = todaysTimes.fajr.split(':').map(Number);
      }

      if (fajrH !== undefined) {
        const alertMin = ramadan.sahurAlertMinutesBefore || 30;
        const totalMin = fajrH * 60 + fajrM - alertMin;
        const alertH = Math.floor(totalMin / 60);
        const alertM = totalMin % 60;

        const alertTime = now.clone().hour(alertH).minute(alertM).second(0);
        if (alertTime.isAfter(now)) {
          const cronExpr = `${alertM} ${alertH} * * *`;
          const job = cron.schedule(cronExpr, () => {
            this.playRamadanAlert(ramadan.sahurAlertAudioFile, 'Sahur Uyarisi');
          }, { scheduled: true, timezone: tz });
          this.ramadanAlertJobs.push(job);
          console.log(`  Ramazan sahur uyarisi: ${String(alertH).padStart(2,'0')}:${String(alertM).padStart(2,'0')} (sabah - ${alertMin}dk)`);
        }
      }
    }
  }

  /**
   * Play a Ramadan alert audio on Cast device
   */
  async playRamadanAlert(audioFile, title) {
    if (this.silentMode) {
      console.log(`🔇 Sessiz mod aktif, ${title} atlanıyor`);
      return;
    }

    console.log(`🌙 ${title}`);
    let player = null;
    try {
      player = new GoogleCastPlayer({
        deviceIp: this.config.deviceIp,
        volume: this.config.volume,
      });

      const audioUrl = this.server.getAudioUrl(audioFile);
      await player.playAdhan(audioUrl, title);
      console.log(`✅ ${title} tamamlandi`);
    } catch (error) {
      console.error(`❌ ${title} hatasi:`, error.message);
    } finally {
      if (player) player.cleanup();
    }
  }

  /**
   * Reload configuration and re-initialize components
   */
  async reloadConfig(newConfig) {
    const configPath = join(__dirname, '..', 'config', 'config.json');
    if (newConfig) {
      writeFileSync(configPath, JSON.stringify(newConfig, null, 2), 'utf-8');
    }
    this.loadConfig();

    // Update fetcher with new config
    if (this.fetcher) {
      this.fetcher.locationId = this.config.diyanetLocationId || 11618;
      this.fetcher.csvFileName = this.config.csvFile || 'prayer-times.csv';
    }

    // Reload CSV parser if csvFile changed
    const csvPath = join(__dirname, '..', 'data', this.config.csvFile || 'prayer-times.csv');
    if (existsSync(csvPath)) {
      await this.parser.reload(csvPath);
    }

    // Re-initialize scheduler with new config
    if (this.scheduler) {
      this.scheduler.stop();
    }
    this.scheduler = new PrayerScheduler({
      timezone: this.config.timezone,
      prayers: this.config.prayers,
      onPrayerTime: (prayer, time) => this.onPrayerTime(prayer, time),
    });

    this.scheduleTodaysPrayers();
    this.scheduler.scheduleMidnightRefresh(() => {
      this.scheduleTodaysPrayers();
    });
  }

  /**
   * Get aggregated system status
   */
  getStatus() {
    const todaysTimes = this.parser ? this.parser.getTodaysPrayerTimes() : null;
    let nextPrayer = this.scheduler ? this.scheduler.getNextPrayer() : null;
    const schedulerStatus = this.scheduler ? this.scheduler.getStatus() : null;

    // If no more prayers today, find tomorrow's first prayer
    if (!nextPrayer && this.parser && this.config) {
      const tz = this.config.timezone || 'Europe/Vienna';
      const now = dayjs().tz(tz);
      const tomorrowStr = now.add(1, 'day').format('YYYY-MM-DD');
      const tomorrowTimes = this.parser.getPrayerTimes(tomorrowStr);

      if (tomorrowTimes) {
        const firstPrayer = (this.config.prayers || [])[0];
        if (firstPrayer && tomorrowTimes[firstPrayer]) {
          let hours, minutes;

          // Apply fajr sunrise-40min adjustment
          if (firstPrayer === 'fajr' && tomorrowTimes.sunrise) {
            const [sunH, sunM] = tomorrowTimes.sunrise.split(':').map(Number);
            const total = (sunH * 60 + sunM) - 40;
            hours = Math.floor(total / 60);
            minutes = total % 60;
          } else {
            [hours, minutes] = tomorrowTimes[firstPrayer].split(':').map(Number);
          }

          const effectiveTime = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
          const tomorrowPrayerTime = now.add(1, 'day').hour(hours).minute(minutes).second(0);
          const minutesUntil = tomorrowPrayerTime.diff(now, 'minute');

          nextPrayer = {
            prayer: firstPrayer,
            time: effectiveTime,
            minutesUntil,
            isTomorrow: true,
          };
        }
      }
    }

    return {
      isRunning: this.isRunning,
      config: this.config,
      todaysPrayerTimes: todaysTimes,
      nextPrayer,
      schedulerStatus,
      serverUrl: this.server ? this.server.getServerUrl() : null,
      availableDates: this.parser ? {
        total: this.parser.getAvailableDates().length,
        first: this.parser.getAvailableDates()[0],
        last: this.parser.getAvailableDates().slice(-1)[0],
      } : null,
      silentMode: this.silentMode,
      silentModeExpiry: this.silentModeExpiry,
    };
  }

  /**
   * Capitalize first letter
   */
  capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  /**
   * Schedule today's prayers
   */
  scheduleTodaysPrayers() {
    const todaysTimes = this.parser.getTodaysPrayerTimes();

    if (!todaysTimes) {
      console.error('No prayer times available for today');
      return;
    }

    this.scheduler.scheduleTodaysPrayers(todaysTimes);

    // Schedule Ramadan alerts if enabled
    this.scheduleRamadanAlerts(todaysTimes);

    // Show next prayer
    const nextPrayer = this.scheduler.getNextPrayer();
    if (nextPrayer) {
      console.log(`\n⏭️  Next prayer: ${this.capitalizeFirst(nextPrayer.prayer)} at ${nextPrayer.time} (in ${nextPrayer.minutesUntil} minutes)`);
    } else {
      console.log('\nNo more prayers scheduled for today');
    }
  }

  /**
   * Start the application
   */
  async start() {
    try {
      await this.initialize();

      // Schedule today's prayers
      this.scheduleTodaysPrayers();

      // Schedule midnight refresh
      this.scheduler.scheduleMidnightRefresh(() => {
        this.scheduleTodaysPrayers();
      });

      // Schedule yearly Diyanet fetch
      this.scheduleYearlyFetch();

      this.isRunning = true;

      console.log('\n🚀 Adhan Player is running!');
      console.log('Press Ctrl+C to stop.\n');

      // Handle graceful shutdown
      process.on('SIGINT', () => this.stop());
      process.on('SIGTERM', () => this.stop());

      // Keep the process running
      await this.keepAlive();
    } catch (error) {
      console.error('Failed to start Adhan Player:', error.message);
      process.exit(1);
    }
  }

  /**
   * Keep the application running
   */
  async keepAlive() {
    return new Promise((resolve) => {
      const interval = setInterval(() => {
        if (!this.isRunning) {
          clearInterval(interval);
          resolve();
        }
      }, 1000);
    });
  }

  /**
   * Stop the application
   */
  async stop() {
    console.log('\n\nStopping Adhan Player...');

    this.isRunning = false;

    if (this.scheduler) {
      this.scheduler.stop();
    }

    if (this.yearlyFetchJobs) {
      this.yearlyFetchJobs.forEach(job => job.stop());
      this.yearlyFetchJobs = [];
    }

    // Clear ramadan alert jobs
    this.ramadanAlertJobs.forEach(job => job.stop());
    this.ramadanAlertJobs = [];

    if (this.server) {
      await this.server.stop();
    }

    if (this.castPlayer) {
      this.castPlayer.cleanup();
    }

    console.log('Goodbye! 👋');
    process.exit(0);
  }
}

/**
 * CLI Helper: Discover Cast devices
 */
async function discoverCastDevices() {
  console.log('🔍 Discovering Google Cast devices on your network...\n');
  const devices = await discoverDevices(10000);

  if (devices.length === 0) {
    console.log('No devices found. Make sure:');
    console.log('  1. Your computer is on the same network as your Cast devices');
    console.log('  2. mDNS/Bonjour is not blocked by your firewall');
  } else {
    console.log('\nFound devices:');
    devices.forEach((device, index) => {
      console.log(`  ${index + 1}. ${device.name}`);
      console.log(`     IP: ${device.ip}`);
    });
  }
}

// Main execution
const args = process.argv.slice(2);

if (args.includes('--discover')) {
  discoverCastDevices().catch(console.error);
} else {
  const app = new AdhanPlayer();
  app.start().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
