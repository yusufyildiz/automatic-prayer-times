import { spawn } from 'child_process';
import { join, extname } from 'path';
import { ha as defaultHa } from './ha-client.js';
import { MEDIA_DIR, MEDIA_SOURCE_PREFIX } from './paths.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MIME = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
};

export function mediaSourceId(file) {
  return `${MEDIA_SOURCE_PREFIX}/${file.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * Output "media_player": play through any HA media_player entity
 * (Cast/Nest, Sonos, ...). The file is passed as a media-source ID, HA
 * resolves it to a signed URL on its own internal address, so the speaker
 * never needs to reach the add-on container.
 */
export class MediaPlayerOutput {
  constructor({ entityId, ha = defaultHa, pollMs = 2000, startTimeoutMs = 25000, maxDurationMs = 20 * 60 * 1000 }) {
    this.entityId = entityId;
    this.ha = ha;
    this.pollMs = pollMs;
    this.startTimeoutMs = startTimeoutMs;
    this.maxDurationMs = maxDurationMs;
    this.stopRequested = false;
    this.describe = `media_player → ${entityId}`;
  }

  async check() {
    const state = await this.ha.getState(this.entityId);
    if (!state) throw new Error(`${this.entityId} bulunamadı`);
    return state.state;
  }

  /**
   * Play and resolve when playback has finished.
   * Throws if the entity is missing/unavailable or never starts playing.
   */
  async play({ file, volume }) {
    this.stopRequested = false;
    const before = await this.ha.getState(this.entityId);
    if (!before) throw new Error(`${this.entityId} bulunamadı`);
    if (before.state === 'unavailable') throw new Error(`${this.entityId} kullanılamıyor (unavailable)`);

    const previousVolume = before.attributes?.volume_level;

    await this.ha.callService('media_player', 'volume_set', {
      entity_id: this.entityId,
      volume_level: Number(volume.toFixed(2)),
    });
    await this.ha.callService('media_player', 'play_media', {
      entity_id: this.entityId,
      media_content_id: mediaSourceId(file),
      media_content_type: MIME[extname(file).toLowerCase()] || 'music',
    });

    // A player that was already playing music reports "playing" before our
    // file starts, so also check that its current media is our file (when
    // the integration reports media_content_id at all).
    const name = encodeURIComponent(file.split('/').pop());
    const isOurs = (s) => {
      const id = s.attributes?.media_content_id;
      return typeof id !== 'string' || id.includes(name) || id.includes(file);
    };
    const active = (s) => s.state === 'playing' || s.state === 'buffering';

    // Wait for the player to start
    const started = await this.waitFor((s) => active(s) && isOurs(s), this.startTimeoutMs);
    if (!started && !this.stopRequested) {
      throw new Error(`${this.entityId} ${Math.round(this.startTimeoutMs / 1000)} sn içinde çalmaya başlamadı`);
    }

    // Wait for it to finish
    if (started) {
      const finished = await this.waitFor((s) => !active(s) || !isOurs(s), this.maxDurationMs);
      if (!finished && !this.stopRequested) {
        console.warn(`⚠️  ${this.entityId} hâlâ çalıyor, bitiş beklenmeden devam ediliyor`);
      }
    }

    // Restore the speaker volume the user had before the adhan
    if (typeof previousVolume === 'number' && Math.abs(previousVolume - volume) > 0.005) {
      try {
        await sleep(1000);
        await this.ha.callService('media_player', 'volume_set', {
          entity_id: this.entityId,
          volume_level: previousVolume,
        });
      } catch (error) {
        console.warn(`⚠️  Ses seviyesi geri alınamadı: ${error.message}`);
      }
    }
  }

  /** Poll the entity until predicate is true; returns false on timeout/stop */
  async waitFor(predicate, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    await sleep(Math.min(this.pollMs, 1000));
    while (Date.now() < deadline) {
      if (this.stopRequested) return false;
      try {
        const s = await this.ha.getState(this.entityId);
        if (s && predicate(s)) return true;
      } catch (error) {
        console.warn(`⚠️  ${this.entityId} durumu okunamadı: ${error.message}`);
      }
      await sleep(this.pollMs);
    }
    return false;
  }

  async stop() {
    this.stopRequested = true;
    await this.ha.callService('media_player', 'media_stop', { entity_id: this.entityId });
  }
}

/**
 * Output "local": play on the Raspberry Pi's own audio output through the
 * Supervisor's PulseAudio (config.yaml `audio: true`).
 * MP3 → mpg123, everything else (wav/ogg/flac) → paplay.
 */
export class LocalOutput {
  constructor({ mediaDir = MEDIA_DIR } = {}) {
    this.mediaDir = mediaDir;
    this.child = null;
    this.describe = 'local (Pi ses çıkışı)';
  }

  async check() {
    return 'ok';
  }

  play({ file, volume }) {
    const path = join(this.mediaDir, file);
    const isMp3 = extname(file).toLowerCase() === '.mp3';
    const [cmd, args] = isMp3
      ? ['mpg123', ['-q', '-o', 'pulse', '-f', String(Math.round(volume * 32768)), path]]
      : ['paplay', ['--volume', String(Math.round(volume * 65536)), path]];

    return new Promise((resolve, reject) => {
      let stderr = '';
      const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      this.child = child;
      child.stderr.on('data', (d) => { stderr += d.toString(); });
      child.on('error', (error) => {
        this.child = null;
        reject(new Error(`${cmd} başlatılamadı: ${error.message}`));
      });
      child.on('close', (code, signal) => {
        this.child = null;
        if (code === 0 || signal === 'SIGTERM') resolve();
        else reject(new Error(`${cmd} çıkış kodu ${code}: ${stderr.trim().split('\n').slice(-2).join(' ')}`));
      });
    });
  }

  async stop() {
    if (this.child) this.child.kill('SIGTERM');
  }
}

export function createOutput(config) {
  return config.outputMode === 'local'
    ? new LocalOutput()
    : new MediaPlayerOutput({ entityId: config.mediaPlayerEntity });
}
