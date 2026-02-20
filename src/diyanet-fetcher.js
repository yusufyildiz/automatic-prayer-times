import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const API_BASE = 'https://prayertimes.api.abdus.dev/api/diyanet';
const DIYANET_EXCEL_URL = 'https://namazvakitleri.diyanet.gov.tr/tr-TR/home/PrayerTimeYearlyExcel';

const TURKISH_MONTHS = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];

/**
 * Fetch prayer times from Diyanet API / Excel and save as CSV
 */
export class DiyanetFetcher {
  constructor(config = {}) {
    this.locationId = config.locationId || 11618; // Default: Vienna
    this.csvFileName = config.csvFile || 'prayer-times.csv';
    this.dataDir = join(__dirname, '..', 'data');
  }

  /**
   * Fetch yearly Excel from Diyanet website
   * @param {number} year - Year to fetch
   * @returns {Array} Array of prayer time objects
   */
  async fetchYearlyExcel(year) {
    const url = `${DIYANET_EXCEL_URL}?locationId=${this.locationId}&year=${year}`;
    console.log(`Fetching yearly Excel from Diyanet (location: ${this.locationId}, year: ${year})...`);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel, */*',
        'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
        'Referer': 'https://namazvakitleri.diyanet.gov.tr/',
      },
    });

    if (!response.ok) {
      throw new Error(`Diyanet Excel download failed: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      throw new Error('Diyanet returned HTML instead of Excel (bot protection active)');
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    if (buffer.length < 1000) {
      throw new Error(`Diyanet Excel response too small (${buffer.length} bytes), likely blocked`);
    }

    const data = this.parseExcelBuffer(buffer);
    console.log(`Parsed ${data.length} days from Diyanet Excel`);
    return data;
  }

  /**
   * Parse Excel buffer (from Diyanet yearly export) into prayer time objects
   * @param {Buffer} buffer - Excel file buffer
   * @returns {Array} Array of prayer time objects
   */
  parseExcelBuffer(buffer) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    // Find the header row — look for a row containing "İmsak" or "Imsak"
    // Normalize Turkish characters for matching (İ→i, ı→i, ş→s, ö→o, ü→u, ğ→g, ç→c)
    const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ğ/g, 'g').replace(/ç/g, 'c');
    let headerIdx = -1;
    let colMap = {};
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      const row = rows[i];
      if (!row) continue;
      const cells = row.map(c => norm(String(c || '').trim()));
      const imsakIdx = cells.findIndex(c => c.includes('imsak'));
      if (imsakIdx !== -1) {
        headerIdx = i;
        // Map column names to indices
        // Diyanet format: Miladi Tarih, Hicri Tarih, İmsak, Güneş, Öğle, İkindi, Akşam, Yatsı
        cells.forEach((cell, idx) => {
          if (cell.includes('miladi')) colMap.date = idx;
          if (cell.includes('imsak')) colMap.fajr = idx;
          if (cell.includes('gunes')) colMap.sunrise = idx;
          if (cell.includes('ogle')) colMap.dhuhr = idx;
          if (cell.includes('ikindi')) colMap.asr = idx;
          if (cell.includes('aksam')) colMap.maghrib = idx;
          if (cell.includes('yatsi')) colMap.isha = idx;
        });
        break;
      }
    }

    if (headerIdx === -1) {
      throw new Error('Excel header row not found (expected İmsak column)');
    }

    // If no date column found, assume first column
    if (colMap.date === undefined) colMap.date = 0;

    const data = [];
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row[colMap.date]) continue;

      const dateVal = row[colMap.date];
      let dateObj;

      // Handle Excel serial date numbers
      if (typeof dateVal === 'number') {
        dateObj = this.excelDateToJS(dateVal);
      } else {
        // Try to parse date string (DD.MM.YYYY or DD/MM/YYYY or other formats)
        dateObj = this.parseDateStr(String(dateVal));
      }

      if (!dateObj || isNaN(dateObj.getTime())) continue;

      const formatTime = (val) => {
        if (!val) return '';
        const s = String(val).trim();
        // Handle Excel time fractions (e.g. 0.25 = 06:00)
        if (typeof val === 'number' && val < 1) {
          const totalMinutes = Math.round(val * 24 * 60);
          const h = Math.floor(totalMinutes / 60);
          const m = totalMinutes % 60;
          return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        }
        // Already HH:MM
        const match = s.match(/(\d{1,2}):(\d{2})/);
        if (match) return `${String(match[1]).padStart(2, '0')}:${match[2]}`;
        return s;
      };

      data.push({
        date: dateObj.toISOString(),
        fajr: formatTime(row[colMap.fajr]),
        sun: formatTime(row[colMap.sunrise]),
        dhuhr: formatTime(row[colMap.dhuhr]),
        asr: formatTime(row[colMap.asr]),
        maghrib: formatTime(row[colMap.maghrib]),
        isha: formatTime(row[colMap.isha]),
      });
    }

    if (data.length === 0) {
      throw new Error('No prayer times found in Excel file');
    }

    return data;
  }

  /**
   * Convert Excel serial date number to JS Date (UTC)
   */
  excelDateToJS(serial) {
    // Excel epoch is 1900-01-01; offset 25569 converts to Unix epoch (UTC)
    const utcDays = Math.floor(serial - 25569);
    return new Date(utcDays * 86400 * 1000);
  }

  /**
   * Parse various date string formats (returns UTC date to avoid timezone shifts)
   */
  parseDateStr(str) {
    // DD.MM.YYYY
    let m = str.match(/(\d{1,2})[./](\d{1,2})[./](\d{4})/);
    if (m) return new Date(Date.UTC(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1])));

    // YYYY-MM-DD
    m = str.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return new Date(Date.UTC(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3])));

    // "DD Turkish_Month YYYY" or "DD Turkish_Month YYYY DayName" (e.g. "01 Ocak 2026 Perşembe")
    m = str.match(/(\d{1,2})\s+(\S+)\s+(\d{4})/);
    if (m) {
      const monthName = m[2].toLowerCase();
      const monthIdx = TURKISH_MONTHS.findIndex(mon => mon.toLowerCase() === monthName);
      if (monthIdx !== -1) {
        return new Date(Date.UTC(parseInt(m[3]), monthIdx, parseInt(m[1])));
      }
    }

    // Fallback
    return new Date(str);
  }

  /**
   * Fetch prayer times from Diyanet API (legacy, ~31 days)
   * @returns {Array} Array of prayer time objects
   */
  async fetchPrayerTimes() {
    const url = `${API_BASE}/prayertimes?location_id=${this.locationId}`;
    console.log(`Fetching prayer times from Diyanet API (location: ${this.locationId})...`);

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
      const day = String(d.getUTCDate()).padStart(2, '0');
      const month = TURKISH_MONTHS[d.getUTCMonth()];
      const year = d.getUTCFullYear();
      const dateStr = `${day} ${month} ${year}`;

      csv += `${dateStr},${entry.fajr},${entry.sun},${entry.dhuhr},${entry.asr},${entry.maghrib},${entry.isha}\n`;
    }

    return csv;
  }

  /**
   * Fetch prayer times and save to CSV file
   * Strategy: Yearly Excel → API fallback → throw error
   * @returns {string} Path to saved CSV file
   */
  async fetchAndSave() {
    let data;

    // Strategy 1: Try yearly Excel download
    const currentYear = new Date().getFullYear();
    try {
      data = await this.fetchYearlyExcel(currentYear);
    } catch (excelError) {
      console.warn(`Excel download failed: ${excelError.message}`);

      // Strategy 2: Fall back to API
      try {
        data = await this.fetchPrayerTimes();
      } catch (apiError) {
        console.error(`API fetch also failed: ${apiError.message}`);
        throw new Error(`Both Excel and API fetch failed. Excel: ${excelError.message}. API: ${apiError.message}`);
      }
    }

    const csv = this.toCsv(data);
    const csvPath = join(this.dataDir, this.csvFileName);

    writeFileSync(csvPath, csv, 'utf8');

    const firstDate = data[0].date.split('T')[0];
    const lastDate = data[data.length - 1].date.split('T')[0];
    console.log(`Prayer times saved: ${csvPath} (${firstDate} — ${lastDate}, ${data.length} days)`);

    return csvPath;
  }

  /**
   * Parse uploaded Excel buffer and save as CSV
   * @param {Buffer} buffer - Excel file buffer
   * @returns {string} Path to saved CSV file
   */
  parseAndSaveExcel(buffer) {
    const data = this.parseExcelBuffer(buffer);
    const csv = this.toCsv(data);
    const csvPath = join(this.dataDir, this.csvFileName);

    writeFileSync(csvPath, csv, 'utf8');

    const firstDate = data[0].date.split('T')[0];
    const lastDate = data[data.length - 1].date.split('T')[0];
    console.log(`Excel uploaded and saved: ${csvPath} (${firstDate} — ${lastDate}, ${data.length} days)`);

    return { csvPath, totalDays: data.length, firstDate, lastDate };
  }
}
