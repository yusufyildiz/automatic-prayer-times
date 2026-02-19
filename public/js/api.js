/**
 * API Client - Fetch wrapper for the dashboard
 */
const API = {
  async request(url, options = {}) {
    try {
      const res = await fetch(url, {
        headers: { 'Content-Type': 'application/json', ...options.headers },
        ...options,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      return data;
    } catch (error) {
      throw error;
    }
  },

  // Status
  getStatus() {
    return this.request('/api/status');
  },

  // Prayer Times
  getTodayPrayerTimes() {
    return this.request('/api/prayer-times/today');
  },

  getPrayerTimes(date) {
    return this.request(`/api/prayer-times/${date}`);
  },

  // Config
  getConfig() {
    return this.request('/api/config');
  },

  saveConfig(config) {
    return this.request('/api/config', {
      method: 'PUT',
      body: JSON.stringify(config),
    });
  },

  // Audio Files
  getAudioFiles() {
    return this.request('/api/audio-files');
  },

  async uploadAudioFile(file) {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch('/api/audio-files/upload', {
      method: 'POST',
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    return data;
  },

  deleteAudioFile(filename) {
    return this.request(`/api/audio-files/${encodeURIComponent(filename)}`, {
      method: 'DELETE',
    });
  },

  // CSV Files
  getCsvFiles() {
    return this.request('/api/csv-files');
  },

  async uploadCsvFile(file) {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch('/api/csv-files/upload', {
      method: 'POST',
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    return data;
  },

  deleteCsvFile(filename) {
    return this.request(`/api/csv-files/${encodeURIComponent(filename)}`, {
      method: 'DELETE',
    });
  },

  activateCsvFile(filename) {
    return this.request(`/api/csv-files/activate/${encodeURIComponent(filename)}`, {
      method: 'POST',
    });
  },

  // Logs
  getLogs(limit = 200) {
    return this.request(`/api/logs?limit=${limit}`);
  },

  // Actions
  reschedule() {
    return this.request('/api/actions/reschedule', { method: 'POST' });
  },

  testCast() {
    return this.request('/api/actions/test-cast', { method: 'POST' });
  },

  fetchPrayerTimes() {
    return this.request('/api/actions/fetch-times', { method: 'POST' });
  },

  toggleSystem(enabled) {
    return this.request('/api/actions/toggle-system', {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    });
  },

  setSilentMode(enabled, duration) {
    return this.request('/api/actions/silent-mode', {
      method: 'POST',
      body: JSON.stringify({ enabled, duration }),
    });
  },

  getHistoryStats() {
    return this.request('/api/history/stats');
  },

  getHistory(limit = 50) {
    return this.request(`/api/history?limit=${limit}`);
  },

  testPrayer(prayer, volume) {
    return this.request('/api/actions/test-prayer', {
      method: 'POST',
      body: JSON.stringify({ action: 'start', prayer, volume }),
    });
  },

  stopTestPrayer() {
    return this.request('/api/actions/test-prayer', {
      method: 'POST',
      body: JSON.stringify({ action: 'stop' }),
    });
  },

  getTestPrayerStatus() {
    return this.request('/api/actions/test-prayer/status');
  },
};
