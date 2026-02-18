import { PrayerTimesParser } from './csv-parser.js';
import { AudioServer } from './server.js';
import { GoogleCastPlayer, discoverDevices } from './cast.js';
import { PrayerScheduler } from './scheduler.js';
import { DiyanetFetcher } from './diyanet-fetcher.js';
import { registerApiRoutes } from './api-routes.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import cron from 'node-cron';

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
    this.monthlyFetchJob = null;
    this.castPlayer = null;
    this.isRunning = false;
    this.rootDir = join(__dirname, '..');
    this.logBuffer = [];
    this.maxLogLines = 200;

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
   * Schedule monthly prayer times fetch (runs on the 25th at 03:00)
   */
  scheduleMonthlyFetch() {
    this.monthlyFetchJob = cron.schedule(
      '0 3 25 * *',
      async () => {
        console.log('\n📅 Monthly prayer times refresh - fetching from Diyanet...');
        try {
          await this.fetcher.fetchAndSave();
          // Reload parser with new data
          await this.parser.reload();
          // Re-schedule today's prayers
          this.scheduleTodaysPrayers();
          console.log('✅ Monthly prayer times update complete');
        } catch (error) {
          console.error('❌ Monthly fetch failed:', error.message);
        }
      },
      {
        scheduled: true,
        timezone: this.config.timezone,
      }
    );
    console.log('Scheduled monthly Diyanet fetch (25th of each month at 03:00)');
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
   */
  getAudioFileForPrayer(prayer) {
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

    try {
      // Create new cast player instance for this playback
      this.castPlayer = new GoogleCastPlayer({
        deviceIp: this.config.deviceIp,
        volume: this.config.volume,
      });

      // Get audio file for this specific prayer
      const audioFile = this.getAudioFileForPrayer(prayer);
      const audioUrl = this.server.getAudioUrl(audioFile);
      console.log(`Audio file: ${audioFile}`);
      console.log(`Audio URL: ${audioUrl}`);

      // Play Adhan
      await this.castPlayer.playAdhan(audioUrl, this.capitalizeFirst(prayer));

      console.log(`✅ Adhan playback completed for ${prayer}`);
    } catch (error) {
      console.error(`❌ Error playing Adhan for ${prayer}:`, error.message);
    } finally {
      if (this.castPlayer) {
        this.castPlayer.cleanup();
        this.castPlayer = null;
      }
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
    const nextPrayer = this.scheduler ? this.scheduler.getNextPrayer() : null;
    const schedulerStatus = this.scheduler ? this.scheduler.getStatus() : null;

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

      // Schedule monthly Diyanet fetch
      this.scheduleMonthlyFetch();

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

    if (this.monthlyFetchJob) {
      this.monthlyFetchJob.stop();
      this.monthlyFetchJob = null;
    }

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
