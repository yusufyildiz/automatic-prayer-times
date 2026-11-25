import { readFileSync, writeFileSync, renameSync, existsSync } from 'fs';

const EMPTY = () => ({
  muted: false,          // "Ezan sustur" switch
  mutedEvents: {},       // per-event mute switches: { fajr: true, ... }
  played: { date: null, events: [] }, // events already started today
  last: null,            // last adhan: { prayer, time, date, status, reason, at }
  lastFetch: null,       // { date, at, source, ... }
});

/**
 * Small JSON store in /data/state.json. Survives add-on restarts and is part
 * of HA backups. Writes are atomic (tmp + rename).
 */
export class StateStore {
  constructor(path) {
    this.path = path;
    this.data = EMPTY();
    try {
      if (existsSync(path)) {
        this.data = { ...EMPTY(), ...JSON.parse(readFileSync(path, 'utf-8')) };
      }
    } catch (error) {
      console.error(`⚠️  Durum dosyası okunamadı (${error.message}), sıfırdan başlanıyor`);
    }
  }

  save() {
    try {
      const tmp = `${this.path}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf-8');
      renameSync(tmp, this.path);
    } catch (error) {
      console.error(`❌ Durum dosyası yazılamadı: ${error.message}`);
    }
  }

  get muted() {
    return this.data.muted === true;
  }

  setMuted(value) {
    this.data.muted = Boolean(value);
    this.save();
  }

  isEventMuted(event) {
    return this.data.mutedEvents?.[event] === true;
  }

  setEventMuted(event, value) {
    this.data.mutedEvents = { ...this.data.mutedEvents, [event]: Boolean(value) };
    this.save();
  }

  wasPlayed(date, event) {
    return this.data.played?.date === date && this.data.played.events.includes(event);
  }

  /** Mark before playback starts, so a crash/restart mid-adhan never replays it */
  markPlayed(date, event) {
    if (this.data.played?.date !== date) {
      this.data.played = { date, events: [] };
    }
    if (!this.data.played.events.includes(event)) {
      this.data.played.events.push(event);
    }
    this.save();
  }

  get last() {
    return this.data.last;
  }

  setLast(last) {
    this.data.last = { ...last, at: new Date().toISOString() };
    this.save();
  }

  get lastFetch() {
    return this.data.lastFetch;
  }

  setLastFetch(info) {
    this.data.lastFetch = info ? { ...info, at: new Date().toISOString() } : null;
    this.save();
  }
}
