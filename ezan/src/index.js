import { writeFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import cron from 'node-cron';
import dayjs from 'dayjs';
import dayjsTimezone from 'dayjs/plugin/timezone.js';
import dayjsUtc from 'dayjs/plugin/utc.js';
import { PrayerTimesParser } from './csv-parser.js';
import { PrayerScheduler, computeEventTimes, atTime, formatDuration } from './scheduler.js';
import { DiyanetFetcher } from './diyanet-fetcher.js';
import { loadOptions, LABELS, SLUGS, EVENTS, VAKITS } from './options.js';
import { StateStore } from './state.js';
import { createOutput } from './outputs.js';
import { MqttBridge, TIME_SENSORS } from './mqtt-bridge.js';
import { CACHE_CSV, STATE_PATH, MEDIA_DIR, DATA_DIR, HEALTH_PORT } from './paths.js';

dayjs.extend(dayjsUtc);
dayjs.extend(dayjsTimezone);

const __dirname = dirname(fileURLToPath(import.meta.url));
const VERSION = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8')).version;

const FETCH_RETRY_MS = 30 * 60 * 1000;
const PLAY_RETRIES = 3;
const PLAY_RETRY_DELAY_MS = 5000;
const BEEP_FILE = 'beep.wav';

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
}

/** Prefix console output with local time and keep emoji-friendly messages */
function installLogTimestamps(tz) {
  for (const level of ['log', 'warn', 'error']) {
    const original = console[level].bind(console);
    console[level] = (...args) => original(`[${dayjs().tz(tz).format('HH:mm:ss')}]`, ...args);
  }
}

/**
 * Main application
 */
class EzanApp {
  constructor() {
    this.config = null;
    this.state = null;
    this.parser = null;
    this.fetcher = null;
    this.scheduler = null;
    this.output = null;
    this.mqtt = null;
    this.healthServer = null;
    this.cronJobs = [];
    this.fetchRetryTimer = null;
    this.currentlyPlaying = null;
    this.stopRequested = false;
    this.startedAt = new Date();
  }

  get tz() {
    return this.config.timezone;
  }

  now() {
    return dayjs().tz(this.tz);
  }

  today() {
    return this.now().format('YYYY-MM-DD');
  }

  async start() {
    const { config, problems } = loadOptions();
    this.config = config;
    process.env.TZ = config.timezone;
    installLogTimestamps(config.timezone);

    console.log(`🕌 Ezan add-on v${VERSION} başlıyor`);
    console.log(`   Konum ID    : ${config.locationId}`);
    console.log(`   Saat dilimi : ${config.timezone}`);
    console.log(`   Çıkış       : ${config.outputMode}${config.outputMode === 'media_player' ? ` (${config.mediaPlayerEntity || '—'})` : ''}`);
    console.log(`   Ezanlar     : ${config.prayers.map((p) => LABELS[p]).join(', ') || '—'}`);
    console.log(`   Ses         : %${Math.round(config.volume * 100)} ${config.audioFile}`);
    console.log(`   Sabah       : %${Math.round(config.fajrVolume * 100)} ${config.fajrAudioFile}, güneş - ${config.fajrOffset} dk`);
    for (const p of problems) console.error(`❌ Ayar: ${p}`);

    this.ensureMediaDir();
    this.state = new StateStore(STATE_PATH);
    this.output = createOutput(config);

    this.fetcher = new DiyanetFetcher({ locationId: config.locationId, csvPath: CACHE_CSV, timezone: config.timezone });
    // Location changed since last fetch → the cache belongs to another city
    if (this.state.lastFetch && this.state.lastFetch.locationId !== config.locationId) {
      console.log(`📍 Konum değişmiş (${this.state.lastFetch.locationId} → ${config.locationId}), önbellek siliniyor`);
      rmSync(CACHE_CSV, { force: true });
      this.state.setLastFetch(null);
    }

    this.parser = new PrayerTimesParser(CACHE_CSV, { timezone: config.timezone });
    await this.parser.load();

    this.scheduler = new PrayerScheduler({
      timezone: config.timezone,
      prayers: config.prayers,
      fajrOffset: config.fajrOffset,
      onPrayerTime: (prayer, time, date) => this.onPrayerTime(prayer, time, date),
      skipReason: (prayer, date) => (this.state.wasPlayed(date, prayer) ? 'bugün zaten çalındı' : null),
    });

    this.mqtt = new MqttBridge({
      version: VERSION,
      onMute: (event, on) => this.setMute(event, on),
      onButton: (name) => this.onButton(name),
    });
    this.mqtt.start().catch((e) => console.error(`❌ MQTT başlatılamadı: ${e.message}`));

    this.startHealthServer();

    // Schedule from the cache right away, then fetch (can take a while
    // without internet) and reschedule only if the fetch changed the data.
    this.scheduleToday();
    this.publishSwitches();
    this.publishLast();
    const before = JSON.stringify(this.parser.getTodaysPrayerTimes());
    await this.refreshTimes({ reason: 'başlangıç' });
    if (JSON.stringify(this.parser.getTodaysPrayerTimes()) !== before) {
      console.log('🔁 Vakitler güncellendi, zamanlama yenileniyor');
      this.scheduleToday();
    }

    // 00:01 new day, 03:00 daily Diyanet fetch, every minute: "next" sensors
    const opts = { scheduled: true, timezone: config.timezone };
    this.cronJobs.push(cron.schedule('1 0 * * *', () => {
      console.log('🌙 Yeni gün');
      this.scheduleToday();
    }, opts));
    this.cronJobs.push(cron.schedule('0 3 * * *', async () => {
      await this.refreshTimes({ reason: 'günlük yenileme', force: true });
      this.scheduleToday();
    }, opts));
    this.cronJobs.push(cron.schedule('* * * * *', () => this.publishNext(), opts));

    this.checkOutput();

    process.on('SIGINT', () => this.stop());
    process.on('SIGTERM', () => this.stop());
    console.log('🚀 Hazır');
  }

  ensureMediaDir() {
    try {
      mkdirSync(MEDIA_DIR, { recursive: true });
      const beep = join(MEDIA_DIR, BEEP_FILE);
      if (!existsSync(beep)) generateBeepWav(beep);
    } catch (error) {
      console.error(`❌ ${MEDIA_DIR} hazırlanamadı: ${error.message}`);
    }

    const files = new Set([this.config.audioFile, this.config.fajrAudioFile]);
    if (this.config.friday.audioFile) files.add(this.config.friday.audioFile);
    if (this.config.duaAudioFile) files.add(this.config.duaAudioFile);
    const missing = [...files].filter((f) => !existsSync(join(MEDIA_DIR, f)));
    if (missing.length) {
      console.warn(`⚠️  Ses dosyası bulunamadı: ${missing.map((f) => `${MEDIA_DIR}/${f}`).join(', ')}`);
      console.warn('   Dosyaları Samba / File editor ile /media/ezan/ klasörüne kopyalayın.');
    } else {
      console.log('✅ Ses dosyaları mevcut');
    }
  }

  async checkOutput() {
    try {
      const s = await this.output.check();
      console.log(`🔊 Çıkış: ${this.output.describe} (durum: ${s})`);
    } catch (error) {
      console.error(`❌ Çıkış kontrolü: ${error.message}`);
    }
  }

  /**
   * Fetch from Diyanet once a day (or when the cache can't serve today).
   * On failure keep using the cache and retry every 30 minutes.
   */
  async refreshTimes({ reason, force = false }) {
    const today = this.today();
    const haveToday = Boolean(this.parser.getTodaysPrayerTimes());
    const fetchedToday = this.state.lastFetch?.date === today;

    if (!force && haveToday && fetchedToday) {
      console.log(`📦 Vakitler bugün zaten çekilmiş, önbellek kullanılıyor (${this.state.lastFetch.source})`);
      return;
    }

    try {
      const result = await this.fetcher.fetchAndSave();
      this.state.setLastFetch({
        date: today,
        locationId: this.config.locationId,
        source: result.source,
        locationName: result.locationName,
        firstDate: result.firstDate,
        lastDate: result.lastDate,
      });
      await this.parser.reload();
      if (this.fetchRetryTimer) {
        clearTimeout(this.fetchRetryTimer);
        this.fetchRetryTimer = null;
      }
    } catch (error) {
      const dates = this.parser.getAvailableDates();
      console.error(`❌ Vakitler çekilemedi (${reason}): ${error.message}`);
      if (dates.length) {
        console.warn(`   Önbellekteki vakitlerle devam ediliyor (${dates[0]} → ${dates[dates.length - 1]}). 30 dk sonra tekrar denenecek.`);
      } else {
        console.error('   Önbellek de boş — vakit yok, ezan çalınamaz. 30 dk sonra tekrar denenecek.');
      }
      if (!this.fetchRetryTimer) {
        this.fetchRetryTimer = setTimeout(async () => {
          this.fetchRetryTimer = null;
          const hadToday = Boolean(this.parser.getTodaysPrayerTimes());
          await this.refreshTimes({ reason: 'tekrar deneme', force: true });
          if (!hadToday) this.scheduleToday();
        }, FETCH_RETRY_MS);
      }
    }

    const lastDate = this.parser.getAvailableDates().slice(-1)[0];
    if (lastDate && dayjs(lastDate).diff(dayjs(today), 'day') < 7) {
      console.warn(`⚠️  Önbellek ${lastDate} tarihinde bitiyor`);
    }
  }

  scheduleToday() {
    const times = this.parser.getTodaysPrayerTimes();
    this.scheduler.scheduleTodaysPrayers(times);
    this.publishTimes(times);
    this.publishNext(true);
  }

  // ---------- Playback ----------

  playbackFor(event) {
    const c = this.config;
    if (event === 'fajr' || event === 'imsak') {
      return { file: c.fajrAudioFile, volume: c.fajrVolume };
    }
    if (event === 'dhuhr' && this.now().day() === 5) {
      return { file: c.friday.audioFile || c.audioFile, volume: c.friday.volume ?? c.volume, friday: true };
    }
    return { file: c.audioFile, volume: c.volume };
  }

  async onPrayerTime(prayer, time, date) {
    const label = LABELS[prayer];

    if (this.state.wasPlayed(date, prayer)) {
      console.log(`⏭️  ${label} (${time}) bugün zaten çalındı, atlanıyor`);
      return;
    }
    this.state.markPlayed(date, prayer);

    const skip = this.state.muted
      ? '"Ezan sustur" açık'
      : this.state.isEventMuted(prayer) ? `"${label} ezanını sustur" açık` : null;
    if (skip) {
      console.log(`🔇 ${label} ezanı (${time}) atlandı: ${skip}`);
      this.recordLast({ prayer, time, date, status: 'atlandı', reason: skip });
      this.publishNext(true);
      return;
    }

    if (this.currentlyPlaying) {
      console.warn(`⚠️  ${LABELS[this.currentlyPlaying] || this.currentlyPlaying} hâlâ çalıyor, durduruluyor`);
      await this.output.stop().catch(() => {});
    }

    const { file, volume, friday } = this.playbackFor(prayer);
    console.log(`🕌 ${label} ezanı (${time}) çalıyor → ${this.output.describe}, ses %${Math.round(volume * 100)}, ${file}${friday ? ' (Cuma)' : ''}`);
    this.recordLast({ prayer, time, date, status: 'çalıyor' });

    const result = await this.playWithRetry(prayer, file, volume);
    if (result.ok) {
      console.log(`✅ ${label} ezanı tamamlandı`);
      this.recordLast({ prayer, time, date, status: 'çalındı' });
      if (this.config.duaAudioFile && !this.stopRequested) {
        await this.playDua(prayer, volume);
      }
    } else if (result.stopped) {
      this.recordLast({ prayer, time, date, status: 'durduruldu' });
    } else {
      console.error(`❌ ${label} ezanı ${PLAY_RETRIES} denemede çalınamadı: ${result.error}`);
      this.recordLast({ prayer, time, date, status: 'hata', reason: result.error });
    }
    this.currentlyPlaying = null;
    this.publishNext(true);
  }

  /** Up to 3 attempts, 5 seconds apart (same as the original app) */
  async playWithRetry(key, file, volume) {
    this.currentlyPlaying = key;
    this.stopRequested = false;

    if (!existsSync(join(MEDIA_DIR, file))) {
      this.currentlyPlaying = null;
      return { ok: false, error: `${MEDIA_DIR}/${file} bulunamadı` };
    }

    let lastError = null;
    for (let attempt = 1; attempt <= PLAY_RETRIES; attempt++) {
      if (this.stopRequested) return { ok: false, stopped: true };
      if (attempt > 1) {
        console.log(`🔄 Tekrar deneniyor (${attempt}/${PLAY_RETRIES})...`);
        await new Promise((r) => setTimeout(r, PLAY_RETRY_DELAY_MS));
      }
      try {
        await this.output.play({ file, volume });
        if (this.stopRequested) return { ok: false, stopped: true };
        return { ok: true };
      } catch (error) {
        lastError = error.message;
        console.error(`❌ Deneme ${attempt}/${PLAY_RETRIES} başarısız: ${error.message}`);
      }
    }
    return { ok: false, error: lastError };
  }

  async playDua(prayer, adhanVolume) {
    await new Promise((r) => setTimeout(r, 3000));
    const volume = this.config.duaVolume ?? adhanVolume;
    console.log(`📿 Ezan duası çalıyor (${LABELS[prayer]}), ses %${Math.round(volume * 100)}`);
    const result = await this.playWithRetry(prayer, this.config.duaAudioFile, volume);
    if (result.ok) console.log('✅ Ezan duası tamamlandı');
    else if (!result.stopped) console.error(`❌ Ezan duası çalınamadı: ${result.error}`);
  }

  async onButton(name) {
    if (name === 'durdur') {
      if (!this.currentlyPlaying) {
        console.log('⏹️  Durdur: şu an çalan bir şey yok');
      }
      this.stopRequested = true;
      try {
        await this.output.stop();
        console.log('⏹️  Çalma durduruldu');
      } catch (error) {
        console.error(`❌ Durdurulamadı: ${error.message}`);
      }
      return;
    }
    if (name === 'test') {
      if (this.currentlyPlaying) {
        console.warn('⚠️  Şu an ezan çalıyor, test yapılmadı');
        return;
      }
      console.log(`🔔 Hoparlör testi → ${this.output.describe} (bip, %30)`);
      const result = await this.playWithRetry('test', BEEP_FILE, 0.3);
      this.currentlyPlaying = null;
      if (result.ok) console.log('✅ Hoparlör testi başarılı');
      else if (!result.stopped) console.error(`❌ Hoparlör testi başarısız: ${result.error}`);
    }
  }

  setMute(event, on) {
    if (event === null) {
      this.state.setMuted(on);
      console.log(on ? '🔇 Ezan sustur: AÇIK — hiçbir ezan çalmayacak' : '🔔 Ezan sustur: KAPALI');
    } else {
      this.state.setEventMuted(event, on);
      console.log(`${on ? '🔇' : '🔔'} ${LABELS[event]} ezanını sustur: ${on ? 'AÇIK' : 'KAPALI'}`);
    }
    this.publishSwitches();
    this.publishNext(true);
  }

  recordLast(last) {
    this.state.setLast(last);
    this.publishLast();
  }

  // ---------- Sensors ----------

  publishTimes(times) {
    const events = computeEventTimes(times, this.config.fajrOffset);
    const date = this.today();
    for (const s of TIME_SENSORS) {
      const hhmm = events?.[s.key];
      this.mqtt.publishTimestamp(s.slug, hhmm ? atTime(date, hhmm, this.tz) : null);
    }
  }

  /** Next Diyanet vakit and next adhan that will actually play */
  computeNext(now = this.now()) {
    const today = now.format('YYYY-MM-DD');
    const days = [today, now.add(1, 'day').format('YYYY-MM-DD'), now.add(2, 'day').format('YYYY-MM-DD')];

    let nextVakit = null;
    let nextEzan = null;
    for (const date of days) {
      const events = computeEventTimes(this.parser.getPrayerTimes(date), this.config.fajrOffset);
      if (!events) continue;

      if (!nextVakit) {
        for (const key of VAKITS) {
          const at = atTime(date, events[key], this.tz);
          if (at.isAfter(now)) {
            nextVakit = { key, at };
            break;
          }
        }
      }
      if (!nextEzan && !this.state.muted) {
        const candidates = EVENTS
          .filter((e) => this.config.prayers.includes(e) && !this.state.isEventMuted(e))
          .filter((e) => !(date === today && this.state.wasPlayed(date, e)))
          .map((e) => ({ key: e, at: atTime(date, events[e], this.tz) }))
          .filter((c) => c.at.isAfter(now))
          .sort((a, b) => a.at.valueOf() - b.at.valueOf());
        if (candidates.length) nextEzan = candidates[0];
      }
      if (nextVakit && (nextEzan || this.state.muted)) break;
    }
    return { nextVakit, nextEzan };
  }

  publishNext(log = false) {
    if (!this.parser || !this.mqtt) return;
    const { nextVakit, nextEzan } = this.computeNext();
    const key = `${nextVakit?.at.valueOf()}|${nextEzan?.key}@${nextEzan?.at.valueOf()}`;
    if (!log && key === this.lastNextKey) return;
    this.lastNextKey = key;

    const attrs = (n) => (n ? { vakit: LABELS[n.key], anahtar: SLUGS[n.key], saat: n.at.format('HH:mm'), tarih: n.at.format('YYYY-MM-DD') } : {});
    this.mqtt.publishTimestamp('sonraki_vakit', nextVakit?.at ?? null, attrs(nextVakit));
    this.mqtt.publishTimestamp('sonraki_ezan', nextEzan?.at ?? null, attrs(nextEzan));

    if (log) {
      if (nextEzan) {
        const mins = nextEzan.at.diff(this.now(), 'minute', true);
        const day = nextEzan.at.format('YYYY-MM-DD') === this.today() ? '' : ` (${nextEzan.at.format('DD.MM')})`;
        console.log(`⏭️  Sonraki ezan: ${LABELS[nextEzan.key]} ${nextEzan.at.format('HH:mm')}${day} — ${formatDuration(mins)} sonra`);
      } else if (this.state.muted) {
        console.log('⏭️  Sonraki ezan: yok ("Ezan sustur" açık)');
      } else {
        console.log('⏭️  Sonraki ezan: bilinmiyor (vakit verisi yok)');
      }
    }
  }

  publishSwitches() {
    this.mqtt.publishSwitch('sustur', this.state.muted);
    for (const e of EVENTS) {
      this.mqtt.publishSwitch(`sustur_${SLUGS[e]}`, this.state.isEventMuted(e));
    }
  }

  publishLast() {
    const last = this.state.last;
    if (!last) {
      this.mqtt.publishSensor('son_calan', null, {});
      return;
    }
    this.mqtt.publishSensor('son_calan', `${LABELS[last.prayer] || last.prayer} ${last.time} — ${last.status}`, {
      vakit: LABELS[last.prayer] || last.prayer,
      saat: last.time,
      tarih: last.date,
      durum: last.status,
      neden: last.reason || null,
      zaman: last.at,
    });
  }

  // ---------- Health / watchdog ----------

  health() {
    const today = this.today();
    const mins = this.now().hour() * 60 + this.now().minute();
    // Liveness: today's schedule must have been built (grace: 5 min after
    // midnight and the first 3 min after start)
    const uptimeMs = Date.now() - this.startedAt;
    const scheduleOk = this.scheduler?.scheduledDate === today || mins < 5 || uptimeMs < 3 * 60 * 1000;
    return {
      ok: scheduleOk,
      version: VERSION,
      today,
      scheduledDate: this.scheduler?.scheduledDate ?? null,
      scheduled: this.scheduler ? Object.fromEntries([...this.scheduler.scheduledJobs].map(([k, v]) => [k, v.time])) : {},
      hasTodaysTimes: Boolean(this.parser?.getTodaysPrayerTimes()),
      cache: (() => {
        const d = this.parser?.getAvailableDates() || [];
        return d.length ? { first: d[0], last: d[d.length - 1], days: d.length } : null;
      })(),
      lastFetch: this.state?.lastFetch ?? null,
      mqttConnected: this.mqtt?.connected ?? false,
      muted: this.state?.muted ?? false,
      currentlyPlaying: this.currentlyPlaying,
      uptimeSec: Math.round((Date.now() - this.startedAt) / 1000),
    };
  }

  startHealthServer() {
    this.healthServer = http.createServer((req, res) => {
      if (req.url === '/health' || req.url === '/') {
        const h = this.health();
        res.writeHead(h.ok ? 200 : 503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(h, null, 2));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    this.healthServer.on('error', (e) => console.error(`❌ Health sunucusu: ${e.message}`));
    this.healthServer.listen(HEALTH_PORT, '0.0.0.0');
  }

  async stop() {
    console.log('👋 Durduruluyor...');
    this.scheduler?.stop();
    this.cronJobs.forEach((j) => j.stop());
    if (this.fetchRetryTimer) clearTimeout(this.fetchRetryTimer);
    if (this.currentlyPlaying) await this.output.stop().catch(() => {});
    await this.mqtt?.stop();
    this.healthServer?.close();
    process.exit(0);
  }
}

const app = new EzanApp();
app.start().catch((error) => {
  console.error(`💥 Başlatılamadı: ${error.stack || error.message}`);
  if (!existsSync(DATA_DIR)) console.error(`   ${DATA_DIR} yok`);
  process.exit(1);
});
