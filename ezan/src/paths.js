import { join } from 'path';

/**
 * File system locations.
 *
 * Inside the add-on everything persistent lives in /data (backed up by HA),
 * audio files live in /media/ezan (shared with HA's media browser).
 * Environment overrides exist only for local development and tests.
 */
export const DATA_DIR = process.env.EZAN_DATA_DIR || '/data';
export const OPTIONS_PATH = process.env.EZAN_OPTIONS_PATH || join(DATA_DIR, 'options.json');
export const CACHE_CSV = join(DATA_DIR, 'prayer-times.csv');
export const STATE_PATH = join(DATA_DIR, 'state.json');

export const MEDIA_DIR = process.env.EZAN_MEDIA_DIR || '/media/ezan';
// HA's "local" media source maps to /media, so /media/ezan/<file> is
// media-source://media_source/local/ezan/<file>
export const MEDIA_SOURCE_PREFIX = 'media-source://media_source/local/ezan';

export const HEALTH_PORT = Number(process.env.EZAN_HEALTH_PORT || 8099);
