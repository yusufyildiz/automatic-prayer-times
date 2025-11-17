import { createReadStream } from 'fs';
import { parse } from 'csv-parse';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';

dayjs.extend(customParseFormat);

/**
 * Parse CSV file containing prayer times
 * Expected CSV format:
 * Date,Fajr,Sunrise,Dhuhr,Asr,Maghrib,Isha
 * 2024-11-17,05:32,07:12,11:48,14:23,16:24,18:04
 */

export class PrayerTimesParser {
  constructor(csvFilePath) {
    this.csvFilePath = csvFilePath;
    this.prayerTimesMap = new Map();
    this.loaded = false;
  }

  /**
   * Load and parse the CSV file
   */
  async load() {
    return new Promise((resolve, reject) => {
      const records = [];

      createReadStream(this.csvFilePath)
        .pipe(parse({
          columns: true,
          skip_empty_lines: true,
          trim: true,
        }))
        .on('data', (record) => {
          records.push(record);
        })
        .on('end', () => {
          this.processRecords(records);
          this.loaded = true;
          console.log(`Loaded ${this.prayerTimesMap.size} days of prayer times`);
          resolve();
        })
        .on('error', (error) => {
          reject(error);
        });
    });
  }

  /**
   * Process CSV records into a map
   */
  processRecords(records) {
    for (const record of records) {
      // Normalize date format - try multiple formats
      let dateKey = record.Date || record.date;

      if (!dateKey) {
        console.warn('Record missing date field:', record);
        continue;
      }

      // Try to parse the date and normalize to YYYY-MM-DD format
      const parsedDate = dayjs(dateKey, ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY', 'DD.MM.YYYY'], true);

      if (!parsedDate.isValid()) {
        console.warn(`Invalid date format: ${dateKey}`);
        continue;
      }

      dateKey = parsedDate.format('YYYY-MM-DD');

      // Extract prayer times (handle different column name variations)
      const prayerTimes = {
        fajr: record.Fajr || record.fajr || null,
        sunrise: record.Sunrise || record.sunrise || null,
        dhuhr: record.Dhuhr || record.dhuhr || record.Zuhr || record.zuhr || null,
        asr: record.Asr || record.asr || null,
        maghrib: record.Maghrib || record.maghrib || null,
        isha: record.Isha || record.isha || null,
      };

      // Validate and normalize time formats
      for (const [prayer, time] of Object.entries(prayerTimes)) {
        if (time) {
          prayerTimes[prayer] = this.normalizeTime(time);
        }
      }

      this.prayerTimesMap.set(dateKey, prayerTimes);
    }
  }

  /**
   * Normalize time to HH:MM format
   */
  normalizeTime(timeStr) {
    if (!timeStr) return null;

    // Remove any spaces
    timeStr = timeStr.trim();

    // Handle formats like "5:32" -> "05:32"
    const parts = timeStr.split(':');
    if (parts.length === 2) {
      const hours = parts[0].padStart(2, '0');
      const minutes = parts[1].padStart(2, '0');
      return `${hours}:${minutes}`;
    }

    return timeStr;
  }

  /**
   * Get prayer times for a specific date
   * @param {string|Date} date - Date in YYYY-MM-DD format or Date object
   * @returns {Object|null} Prayer times object or null if not found
   */
  getPrayerTimes(date) {
    if (!this.loaded) {
      throw new Error('CSV file not loaded. Call load() first.');
    }

    let dateKey;
    if (date instanceof Date) {
      dateKey = dayjs(date).format('YYYY-MM-DD');
    } else if (typeof date === 'string') {
      dateKey = dayjs(date).format('YYYY-MM-DD');
    } else {
      dateKey = dayjs().format('YYYY-MM-DD');
    }

    return this.prayerTimesMap.get(dateKey) || null;
  }

  /**
   * Get today's prayer times
   */
  getTodaysPrayerTimes() {
    return this.getPrayerTimes(new Date());
  }

  /**
   * Get all available dates
   */
  getAvailableDates() {
    return Array.from(this.prayerTimesMap.keys()).sort();
  }

  /**
   * Check if data is available for a specific date
   */
  hasDataForDate(date) {
    const dateKey = dayjs(date).format('YYYY-MM-DD');
    return this.prayerTimesMap.has(dateKey);
  }
}
