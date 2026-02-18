import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const API_BASE = 'https://prayertimes.api.abdus.dev/api/diyanet';

const TURKISH_MONTHS = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];

/**
 * Fetch prayer times from Diyanet API and save as CSV
 */
export class DiyanetFetcher {
  constructor(config = {}) {
    this.locationId = config.locationId || 11618; // Default: Vienna
    this.csvFileName = config.csvFile || 'prayer-times.csv';
    this.dataDir = join(__dirname, '..', 'data');
  }

  /**
   * Fetch prayer times from Diyanet API
   * @returns {Array} Array of prayer time objects
   */
  async fetchPrayerTimes() {
    const url = `${API_BASE}/prayertimes?location_id=${this.locationId}`;
    console.log(`Fetching prayer times from Diyanet (location: ${this.locationId})...`);

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Diyanet API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('No prayer times data received from Diyanet API');
    }

    console.log(`Received ${data.length} days of prayer times`);
    return data;
  }

  /**
   * Convert API data to Turkish CSV format
   * @param {Array} data - Prayer times from API
   * @returns {string} CSV content
   */
  toCsv(data) {
    let csv = 'Miladi Tarih,İmsak,Güneş,Öğle,İkindi,Akşam,Yatsı\n';

    for (const entry of data) {
      const d = new Date(entry.date);
      const day = String(d.getDate()).padStart(2, '0');
      const month = TURKISH_MONTHS[d.getMonth()];
      const year = d.getFullYear();
      const dateStr = `${day} ${month} ${year}`;

      csv += `${dateStr},${entry.fajr},${entry.sun},${entry.dhuhr},${entry.asr},${entry.maghrib},${entry.isha}\n`;
    }

    return csv;
  }

  /**
   * Fetch prayer times and save to CSV file
   * @returns {string} Path to saved CSV file
   */
  async fetchAndSave() {
    const data = await this.fetchPrayerTimes();
    const csv = this.toCsv(data);
    const csvPath = join(this.dataDir, this.csvFileName);

    writeFileSync(csvPath, csv, 'utf8');

    const firstDate = data[0].date.split('T')[0];
    const lastDate = data[data.length - 1].date.split('T')[0];
    console.log(`Prayer times saved: ${csvPath} (${firstDate} — ${lastDate})`);

    return csvPath;
  }
}
