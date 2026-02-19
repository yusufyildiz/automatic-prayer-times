import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class PrayerHistory {
  constructor() {
    const dataDir = join(__dirname, '..', 'data');
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }
    this.filePath = join(dataDir, 'prayer-history.json');
    this.data = this._load();
  }

  _load() {
    try {
      if (existsSync(this.filePath)) {
        return JSON.parse(readFileSync(this.filePath, 'utf-8'));
      }
    } catch (e) {
      console.error('Failed to load prayer history:', e.message);
    }
    return [];
  }

  _save() {
    try {
      writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (e) {
      console.error('Failed to save prayer history:', e.message);
    }
  }

  /**
   * Record a prayer event
   * @param {string} prayer - Prayer name (fajr, dhuhr, etc.)
   * @param {string} time - Scheduled time (HH:MM)
   * @param {string} status - 'played' | 'failed' | 'skipped'
   * @param {string} reason - Optional reason for failure/skip
   */
  record(prayer, time, status, reason) {
    const now = new Date();
    const date = now.toISOString().slice(0, 10);

    this.data.push({
      date,
      prayer,
      time,
      status,
      reason: reason || null,
      timestamp: now.toISOString(),
    });

    // Keep max 30 days of data
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    this.data = this.data.filter(d => d.date >= cutoffStr);

    this._save();
  }

  /**
   * Get weekly statistics (last 7 days)
   */
  getWeeklyStats() {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const week = this.data.filter(d => d.date >= cutoffStr);

    const played = week.filter(d => d.status === 'played').length;
    const failed = week.filter(d => d.status === 'failed').length;
    const skipped = week.filter(d => d.status === 'skipped').length;
    const total = week.length;
    const successRate = total > 0 ? Math.round((played / total) * 100) : 0;

    // Daily breakdown
    const dailyMap = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      dailyMap[dateStr] = { date: dateStr, played: 0, failed: 0, skipped: 0 };
    }

    week.forEach(entry => {
      if (dailyMap[entry.date]) {
        if (entry.status === 'played') dailyMap[entry.date].played++;
        else if (entry.status === 'failed') dailyMap[entry.date].failed++;
        else if (entry.status === 'skipped') dailyMap[entry.date].skipped++;
      }
    });

    return {
      total,
      played,
      failed,
      skipped,
      successRate,
      daily: Object.values(dailyMap),
    };
  }

  /**
   * Get raw history entries
   * @param {number} limit - Max entries to return
   */
  getHistory(limit = 50) {
    return this.data.slice(-limit);
  }
}
