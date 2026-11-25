import { readFileSync } from 'fs';
import { OPTIONS_PATH } from './paths.js';

/**
 * Event keys used internally (kept from the original app):
 *   imsak  - Diyanet imsak time
 *   fajr   - "Sabah" adhan: sunrise - fajrOffset minutes (0 = at imsak)
 *   dhuhr, asr, maghrib, isha
 */
export const EVENTS = ['imsak', 'fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

/** Diyanet's six vakits (used for sensors / "sonraki vakit") */
export const VAKITS = ['imsak', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];

export const LABELS = {
  imsak: 'İmsak',
  fajr: 'Sabah',
  sunrise: 'Güneş',
  dhuhr: 'Öğle',
  asr: 'İkindi',
  maghrib: 'Akşam',
  isha: 'Yatsı',
};

/** ASCII slugs used in option names, MQTT topics and entity IDs */
export const SLUGS = {
  imsak: 'imsak',
  fajr: 'sabah',
  sunrise: 'gunes',
  dhuhr: 'ogle',
  asr: 'ikindi',
  maghrib: 'aksam',
  isha: 'yatsi',
};

const DEFAULTS = {
  location_id: 11618,
  timezone: 'Europe/Vienna',
  output_mode: 'media_player',
  media_player_entity: '',
  volume: 0.5,
  audio_file: 'adhan.mp3',
  imsak: false,
  sabah: true,
  ogle: true,
  ikindi: true,
  aksam: true,
  yatsi: true,
  fajr_offset: 40,
};

const clamp01 = (v, fallback) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
};

const present = (v) => v !== undefined && v !== null && v !== '';

/**
 * Convert HA add-on options (/data/options.json) into the internal config.
 * Returns { config, problems } — problems are human readable strings that
 * are logged at startup; they never stop the add-on (sensors keep working).
 */
export function normalizeOptions(raw = {}) {
  const o = { ...DEFAULTS };
  for (const [k, v] of Object.entries(raw)) {
    if (present(v)) o[k] = v;
  }

  const problems = [];
  const volume = clamp01(o.volume, DEFAULTS.volume);

  const config = {
    locationId: Number(o.location_id) || DEFAULTS.location_id,
    timezone: String(o.timezone || DEFAULTS.timezone),
    outputMode: o.output_mode === 'local' ? 'local' : 'media_player',
    mediaPlayerEntity: String(o.media_player_entity || '').trim(),
    prayers: EVENTS.filter((e) => o[SLUGS[e]] === true),
    fajrOffset: Math.max(0, Math.round(Number(o.fajr_offset) || 0)),
    volume,
    audioFile: String(o.audio_file),
    fajrAudioFile: present(o.fajr_audio_file) ? String(o.fajr_audio_file) : String(o.audio_file),
    fajrVolume: present(o.fajr_volume) ? clamp01(o.fajr_volume, volume) : volume,
    friday: {
      audioFile: present(o.friday_audio_file) ? String(o.friday_audio_file) : null,
      volume: present(o.friday_volume) ? clamp01(o.friday_volume, volume) : null,
    },
    duaAudioFile: present(o.dua_audio_file) ? String(o.dua_audio_file) : null,
    duaVolume: present(o.dua_volume) ? clamp01(o.dua_volume, volume) : null,
  };

  if (config.outputMode === 'media_player' && !/^media_player\.[a-z0-9_]+$/.test(config.mediaPlayerEntity)) {
    problems.push(
      `output_mode "media_player" seçili ama media_player_entity geçersiz: "${config.mediaPlayerEntity}" ` +
      '(örnek: media_player.mutfak_nest_hub). Ezan çalınamayacak.'
    );
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: config.timezone });
  } catch {
    problems.push(`Geçersiz saat dilimi "${config.timezone}", Europe/Vienna kullanılıyor.`);
    config.timezone = DEFAULTS.timezone;
  }
  if (config.prayers.length === 0) {
    problems.push('Hiçbir vakit için ezan açık değil.');
  }

  return { config, problems };
}

export function loadOptions(path = OPTIONS_PATH) {
  const raw = JSON.parse(readFileSync(path, 'utf-8'));
  return normalizeOptions(raw);
}
