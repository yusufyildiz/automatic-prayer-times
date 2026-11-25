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

    // Detecting start/end:
    // - player was idle → any playing/buffering state is our file
    // - player was already playing music → wait until the media changes
    //   (media_content_id contains our file name, or differs from before)
    // Integrations report media_content_id differently, so the file name
    // match is only used when it is actually present.
    const name = encodeURIComponent(file.split('/').pop());
    const contentId = (s) => s.attributes?.media_content_id;
    const isOurs = (s) => {
      const id = contentId(s);
      return typeof id === 'string' && (id.includes(name) || id.includes(file));
    };
    const active = (s) => s.state === 'playing' || s.state === 'buffering';
    const wasActive = active(before);
    const previousId = contentId(before);
    let sawOurs = false;

    const startedCheck = (s) => {
      if (!active(s)) return false;
      if (isOurs(s)) sawOurs = true;
      return sawOurs || !wasActive || contentId(s) !== previousId;
    };
    const finishedCheck = (s) => !active(s) || (sawOurs && !isOurs(s));

    // Wait for the player to start
    const started = await this.waitFor(startedCheck, this.startTimeoutMs);
    if (!started && !this.stopRequested) {
      throw new Error(`${this.entityId} ${Math.round(this.startTimeoutMs / 1000)} sn içinde çalmaya başlamadı`);
    }

    // Wait for it to finish
    if (started) {
      const finished = await this.waitFor(finishedCheck, this.maxDurationMs);
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
 *
 * Alpine's mpg123 has no PulseAudio output module, so MP3 is decoded by
 * mpg123 to raw PCM (44.1 kHz, stereo, s16le) and piped into pacat.
 * Other formats (wav/ogg/flac) are played by paplay directly.
 */
export class LocalOutput {
  constructor({ mediaDir = MEDIA_DIR } = {}) {
    this.mediaDir = mediaDir;
    this.children = [];
    this.stopping = false;
    this.describe = 'local (Pi ses çıkışı)';
  }

  async check() {
    return process.env.PULSE_SERVER ? `PulseAudio ${process.env.PULSE_SERVER}` : 'PulseAudio (varsayılan)';
  }

  play({ file, volume }) {
    const path = join(this.mediaDir, file);
    this.stopping = false;

    if (extname(file).toLowerCase() !== '.mp3') {
      return this.run([['paplay', ['--volume', String(Math.round(volume * 65536)), path]]]);
    }
    return this.run([
      ['mpg123', ['-q', '-s', '-r', '44100', '--stereo', '-e', 's16', '-f', String(Math.round(volume * 32768)), path]],
      ['pacat', ['--playback', '--raw', '--rate=44100', '--channels=2', '--format=s16le', '--client-name=ezan']],
    ]);
  }

  /** Run a pipeline of [cmd, args]; resolves when the last process exits 0 */
  run(pipeline) {
    return new Promise((resolve, reject) => {
      const errors = [];
      let pending = pipeline.length;
      let failed = null;
      let prev = null;

      const settle = () => {
        if (--pending > 0) return;
        this.children = [];
        if (this.stopping) resolve();
        else if (failed) reject(failed);
        else if (errors.length) reject(new Error(errors.join(' | ')));
        else resolve();
      };

      this.children = pipeline.map(([cmd, args], i) => {
        const last = i === pipeline.length - 1;
        const child = spawn(cmd, args, { stdio: [prev ? 'pipe' : 'ignore', last ? 'ignore' : 'pipe', 'pipe'] });
        if (prev) {
          prev.stdout.on('error', () => {});
          child.stdin.on('error', () => {}); // EPIPE when stopped
          prev.stdout.pipe(child.stdin);
        }
        let stderr = '';
        let done = false;
        child.stderr?.on('data', (d) => { stderr += d.toString(); });
        child.on('error', (error) => {
          failed ??= new Error(`${cmd} başlatılamadı: ${error.message}`);
          // the other side of the pipe can't finish on its own
          for (const c of this.children) if (c !== child) c.kill('SIGTERM');
          if (!done) { done = true; settle(); }
        });
        child.on('close', (code, signal) => {
          if (done) return;
          done = true;
          if (code !== 0 && !signal && !this.stopping) {
            errors.push(`${cmd} çıkış kodu ${code}: ${stderr.trim().split('\n').slice(-2).join(' ')}`);
          }
          settle();
        });
        prev = child;
        return child;
      });
    });
  }

  async stop() {
    this.stopping = true;
    for (const c of this.children) c.kill('SIGTERM');
  }
}

export function createOutput(config) {
  return config.outputMode === 'local'
    ? new LocalOutput()
    : new MediaPlayerOutput({ entityId: config.mediaPlayerEntity });
}
