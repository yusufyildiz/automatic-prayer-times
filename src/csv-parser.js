import { createReadStream } from 'fs';
import { parse } from 'csv-parse';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';

dayjs.extend(customParseFormat);

/**
 * Parse CSV file containing prayer times
 * Supports multiple formats:
 *
 * English format:
 * Date,Fajr,Sunrise,Dhuhr,Asr,Maghrib,Isha
 * 2024-11-17,05:32,07:12,11:48,14:23,16:24,18:04
 *
 * Turkish format:
 * Miladi Tarih,İmsak,Güneş,Öğle,İkindi,Akşam,Yatsı
 * 01 Ocak 2025,05:51,07:38,12:03,13:57,16:18,17:52
 */

// Turkish month names mapping
const TURKISH_MONTHS = {
  'ocak': 0,
  'şubat': 1,
  'mart': 2,
  'nisan': 3,
  'mayıs': 4,
  'haziran': 5,
  'temmuz': 6,
  'ağustos': 7,
  'eylül': 8,
  'ekim': 9,
  'kasım': 10,
  'aralık': 11,
};

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
      // Support: Date, date, Miladi Tarih (Turkish)
      let dateKey = record.Date || record.date || record['Miladi Tarih'];

      if (!dateKey) {
        console.warn('Record missing date field:', record);
        continue;
      }

      // Clean up the date string
      dateKey = dateKey.trim();

      // Try to parse the date and normalize to YYYY-MM-DD format
      let parsedDate = dayjs(dateKey, ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY', 'DD.MM.YYYY'], true);

      // If standard parsing fails, try Turkish date format (e.g., "01 Ocak 2025")
      if (!parsedDate.isValid()) {
        parsedDate = this.parseTurkishDate(dateKey);
      }

      if (!parsedDate || !parsedDate.isValid()) {
        console.warn(`Invalid date format: ${dateKey}`);
        continue;
      }

      dateKey = parsedDate.format('YYYY-MM-DD');

      // Extract prayer times (handle different column name variations)
      // Support both English and Turkish column names
      const prayerTimes = {
        fajr: record.Fajr || record.fajr || record['İmsak'] || record.Imsak || null,
        sunrise: record.Sunrise || record.sunrise || record['Güneş'] || record.Gunes || null,
        dhuhr: record.Dhuhr || record.dhuhr || record.Zuhr || record.zuhr || record['Öğle'] || record.Ogle || null,
        asr: record.Asr || record.asr || record['İkindi'] || record.Ikindi || null,
        maghrib: record.Maghrib || record.maghrib || record['Akşam'] || record.Aksam || null,
        isha: record.Isha || record.isha || record['Yatsı'] || record.Yatsi || null,
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
   * Parse Turkish date format (e.g., "01 Ocak 2025")
   */
  parseTurkishDate(dateStr) {
    const parts = dateStr.trim().split(/\s+/);

    if (parts.length !== 3) {
      return null;
    }

    const day = parseInt(parts[0], 10);
    const monthName = parts[1].toLowerCase();
    const year = parseInt(parts[2], 10);

    const month = TURKISH_MONTHS[monthName];

    if (isNaN(day) || month === undefined || isNaN(year)) {
      return null;
    }

    return dayjs(new Date(year, month, day));
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

  /**
   * Reload CSV data (optionally with a new file path)
   */
  async reload(newCsvFilePath) {
    if (newCsvFilePath) {
      this.csvFilePath = newCsvFilePath;
    }
    this.prayerTimesMap.clear();
    this.loaded = false;
    await this.load();
  }
}
