/**
 * Dashboard Application Logic
 */
(function () {
  // Prayer name translations
  const PRAYER_NAMES = {
    fajr: 'Sabah',
    sunrise: 'Gunes',
    dhuhr: 'Ogle',
    asr: 'Ikindi',
    maghrib: 'Aksam',
    isha: 'Yatsi',
  };

  // State
  let currentStatus = null;
  let countdownInterval = null;
  let logInterval = null;
  let activeTestPrayer = null;
  let testPollInterval = null;

  // === TAB NAVIGATION ===
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');

      // Load tab-specific data
      const tab = btn.dataset.tab;
      if (tab === 'home') loadHome();
      else if (tab === 'settings') loadSettings();
      else if (tab === 'audio') loadAudioFiles();
      else if (tab === 'csv') loadCsvFiles();
      else if (tab === 'logs') loadLogs();
    });
  });

  // === HOME TAB ===
  async function loadHome() {
    try {
      currentStatus = await API.getStatus();
      renderStatus(currentStatus);
      renderTodayTimes(currentStatus);
      startCountdown(currentStatus.nextPrayer);
      renderTomorrowTimes();
    } catch (e) {
      console.error('Failed to load status:', e);
    }
  }

  function renderStatus(status) {
    const runningEl = document.getElementById('status-running');
    const isRunning = status.isRunning;
    runningEl.innerHTML = `<span class="status-dot ${isRunning ? 'online' : 'offline'}"></span>${isRunning ? 'Calisiyor' : 'Durduruldu'}`;
    runningEl.style.color = isRunning ? 'var(--success)' : 'var(--danger)';
    document.getElementById('system-toggle').checked = isRunning;
    document.getElementById('status-device-ip').textContent = status.config?.deviceIp || '--';
    document.getElementById('status-timezone').textContent = status.config?.timezone || '--';
  }

  function renderTodayTimes(status) {
    const container = document.getElementById('today-times-body');
    const dateLabel = document.getElementById('today-date');
    const today = new Date().toISOString().split('T')[0];
    dateLabel.textContent = today;

    const times = status.todaysPrayerTimes;
    if (!times) {
      container.innerHTML = '<div class="prayer-empty">Bugun icin vakit bilgisi bulunamadi</div>';
      return;
    }

    const activePrayers = status.config?.prayers || [];
    const nextPrayer = status.nextPrayer;
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    const prayerOrder = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];

    container.innerHTML = prayerOrder
      .filter(p => times[p])
      .map(prayer => {
        const time = times[prayer];
        const [h, m] = time.split(':').map(Number);
        const prayerMinutes = h * 60 + m;
        const isActive = activePrayers.includes(prayer);
        const isNext = nextPrayer && nextPrayer.prayer === prayer;
        const isPassed = prayerMinutes <= nowMinutes;

        let badgeClass, badgeText;
        if (isNext) {
          badgeClass = 'badge-next';
          badgeText = 'Siradaki';
        } else if (isPassed) {
          badgeClass = 'badge-passed';
          badgeText = 'Gecti';
        } else {
          badgeClass = 'badge-upcoming';
          badgeText = 'Bekliyor';
        }

        if (!isActive && prayer !== 'sunrise') {
          badgeClass = 'badge-inactive';
          badgeText = 'Pasif';
        }

        const cardClass = [
          'prayer-card',
          isNext ? 'prayer-card-next' : '',
          isPassed ? 'prayer-card-passed' : '',
        ].filter(Boolean).join(' ');

        return `<div class="${cardClass}" data-prayer="${prayer}">
          <div class="prayer-card-name">${PRAYER_NAMES[prayer] || prayer}</div>
          <div class="prayer-card-time">${time}</div>
          <span class="badge ${badgeClass}">${badgeText}</span>
        </div>`;
      })
      .join('');
  }

  async function renderTomorrowTimes() {
    const container = document.getElementById('tomorrow-times-body');
    const dateLabel = document.getElementById('tomorrow-date');

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowDate = tomorrow.toISOString().split('T')[0];
    dateLabel.textContent = tomorrowDate;

    try {
      const data = await API.getPrayerTimes(tomorrowDate);
      const times = data.prayerTimes;
      if (!times) {
        container.innerHTML = '<div class="prayer-empty">Yarin icin vakit bilgisi bulunamadi</div>';
        return;
      }

      const prayerOrder = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];

      container.innerHTML = prayerOrder
        .filter(p => times[p])
        .map(prayer => {
          const time = times[prayer];
          return `<div class="prayer-card" data-prayer="${prayer}">
            <div class="prayer-card-name">${PRAYER_NAMES[prayer] || prayer}</div>
            <div class="prayer-card-time">${time}</div>
          </div>`;
        })
        .join('');
    } catch (e) {
      container.innerHTML = '<div class="prayer-empty">Yarin icin vakit bilgisi bulunamadi</div>';
    }
  }

  function startCountdown(nextPrayer) {
    if (countdownInterval) clearInterval(countdownInterval);

    const nameEl = document.getElementById('next-prayer-name');
    const countEl = document.getElementById('next-prayer-countdown');
    const timeEl = document.getElementById('next-prayer-time');

    if (!nextPrayer) {
      nameEl.textContent = 'Bugun baska namaz yok';
      countEl.textContent = '--:--:--';
      timeEl.textContent = '';
      return;
    }

    nameEl.textContent = PRAYER_NAMES[nextPrayer.prayer] || nextPrayer.prayer;
    timeEl.textContent = `Saat: ${nextPrayer.time}`;

    function updateCountdown() {
      const now = new Date();
      const [h, m] = nextPrayer.time.split(':').map(Number);
      const target = new Date(now);
      target.setHours(h, m, 0, 0);

      const diff = target - now;
      if (diff <= 0) {
        countEl.textContent = '00:00:00';
        clearInterval(countdownInterval);
        // Refresh after a minute
        setTimeout(loadHome, 60000);
        return;
      }

      const hours = Math.floor(diff / 3600000);
      const mins = Math.floor((diff % 3600000) / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      countEl.textContent = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }

    updateCountdown();
    countdownInterval = setInterval(updateCountdown, 1000);
  }

  // Action buttons
  document.getElementById('btn-reschedule').addEventListener('click', async () => {
    const resultEl = document.getElementById('action-result');
    try {
      const res = await API.reschedule();
      resultEl.className = 'action-result success';
      resultEl.textContent = res.nextPrayer
        ? `Yeniden planlandi. Siradaki: ${PRAYER_NAMES[res.nextPrayer.prayer] || res.nextPrayer.prayer} - ${res.nextPrayer.time}`
        : 'Yeniden planlandi. Bugun baska namaz yok.';
      loadHome();
    } catch (e) {
      resultEl.className = 'action-result error';
      resultEl.textContent = `Hata: ${e.message}`;
    }
  });

  document.getElementById('btn-test-cast').addEventListener('click', async () => {
    const resultEl = document.getElementById('action-result');
    resultEl.className = 'action-result';
    resultEl.textContent = 'Baglanti test ediliyor...';
    try {
      const res = await API.testCast();
      resultEl.className = `action-result ${res.success ? 'success' : 'error'}`;
      resultEl.textContent = res.message;
    } catch (e) {
      resultEl.className = 'action-result error';
      resultEl.textContent = `Hata: ${e.message}`;
    }
  });

  // System toggle
  document.getElementById('system-toggle').addEventListener('change', async (e) => {
    const resultEl = document.getElementById('action-result');
    try {
      const res = await API.toggleSystem(e.target.checked);
      resultEl.className = 'action-result success';
      resultEl.textContent = res.isRunning ? 'Sistem baslatildi' : 'Sistem durduruldu';
      loadHome();
    } catch (err) {
      resultEl.className = 'action-result error';
      resultEl.textContent = `Hata: ${err.message}`;
      e.target.checked = !e.target.checked;
    }
  });

  // === SETTINGS TAB ===
  async function loadSettings() {
    try {
      const [config, audioData] = await Promise.all([
        API.getConfig(),
        API.getAudioFiles(),
      ]);
      populateConfigForm(config, audioData.files);
    } catch (e) {
      console.error('Failed to load settings:', e);
    }
  }

  function populateConfigForm(config, audioFiles) {
    document.getElementById('cfg-deviceIp').value = config.deviceIp || '';
    document.getElementById('cfg-deviceName').value = config.deviceName || '';
    document.getElementById('cfg-volume').value = Math.round((config.volume || 0.5) * 100);
    document.getElementById('volume-display').textContent = `${Math.round((config.volume || 0.5) * 100)}%`;
    document.getElementById('cfg-timezone').value = config.timezone || '';
    document.getElementById('cfg-serverPort').value = config.serverPort || 3000;
    document.getElementById('cfg-localIp').value = config.localIp || '';
    document.getElementById('cfg-testConnection').checked = config.testConnection || false;

    // Prayer checkboxes
    const prayers = config.prayers || [];
    document.querySelectorAll('#prayer-checkboxes input[type="checkbox"]').forEach(cb => {
      cb.checked = prayers.includes(cb.value);
    });

    // Audio file selects
    const audioSelects = [
      'cfg-adhanAudioFile',
      'cfg-audio-fajr', 'cfg-audio-dhuhr', 'cfg-audio-asr',
      'cfg-audio-maghrib', 'cfg-audio-isha',
    ];

    audioSelects.forEach(id => {
      const select = document.getElementById(id);
      select.innerHTML = id === 'cfg-adhanAudioFile'
        ? '<option value="">-- Sec --</option>'
        : '<option value="">Varsayilan</option>';
      audioFiles.forEach(f => {
        const opt = document.createElement('option');
        opt.value = f.name;
        opt.textContent = f.name;
        select.appendChild(opt);
      });
    });

    // Set current values
    document.getElementById('cfg-adhanAudioFile').value = config.adhanAudioFile || '';

    if (config.audioFiles) {
      ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'].forEach(p => {
        const el = document.getElementById(`cfg-audio-${p}`);
        if (el && config.audioFiles[p]) el.value = config.audioFiles[p];
      });
    }

    // Per-prayer volume sliders
    const defaultVol = Math.round((config.volume || 0.5) * 100);
    ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'].forEach(p => {
      const slider = document.getElementById(`cfg-vol-${p}`);
      const display = document.getElementById(`vol-display-${p}`);
      const val = config.volumes && config.volumes[p] !== undefined
        ? Math.round(config.volumes[p] * 100)
        : defaultVol;
      slider.value = val;
      display.textContent = `${val}%`;
    });
  }

  // Volume slider display
  document.getElementById('cfg-volume').addEventListener('input', (e) => {
    document.getElementById('volume-display').textContent = `${e.target.value}%`;
  });

  // Per-prayer volume slider displays
  ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'].forEach(p => {
    document.getElementById(`cfg-vol-${p}`).addEventListener('input', (e) => {
      document.getElementById(`vol-display-${p}`).textContent = `${e.target.value}%`;
    });
  });

  // Config form submit
  document.getElementById('config-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const statusEl = document.getElementById('config-save-status');

    const prayers = [];
    document.querySelectorAll('#prayer-checkboxes input:checked').forEach(cb => {
      prayers.push(cb.value);
    });

    const audioFiles = {};
    ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'].forEach(p => {
      const val = document.getElementById(`cfg-audio-${p}`).value;
      if (val) audioFiles[p] = val;
    });

    const volumes = {};
    ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'].forEach(p => {
      volumes[p] = parseInt(document.getElementById(`cfg-vol-${p}`).value) / 100;
    });

    const config = {
      deviceIp: document.getElementById('cfg-deviceIp').value,
      deviceName: document.getElementById('cfg-deviceName').value,
      volume: parseInt(document.getElementById('cfg-volume').value) / 100,
      timezone: document.getElementById('cfg-timezone').value,
      serverPort: parseInt(document.getElementById('cfg-serverPort').value) || 3000,
      localIp: document.getElementById('cfg-localIp').value || null,
      prayers,
      adhanAudioFile: document.getElementById('cfg-adhanAudioFile').value,
      audioFiles: Object.keys(audioFiles).length > 0 ? audioFiles : undefined,
      volumes,
      csvFile: currentStatus?.config?.csvFile || 'prayer-times.csv',
      testConnection: document.getElementById('cfg-testConnection').checked,
    };

    try {
      await API.saveConfig(config);
      statusEl.className = 'save-status success';
      statusEl.textContent = 'Kaydedildi!';
      setTimeout(() => { statusEl.textContent = ''; }, 3000);
    } catch (e) {
      statusEl.className = 'save-status error';
      statusEl.textContent = `Hata: ${e.message}`;
    }
  });

  // === AUDIO FILES TAB ===
  async function loadAudioFiles() {
    try {
      const data = await API.getAudioFiles();
      renderAudioFiles(data.files);
    } catch (e) {
      console.error('Failed to load audio files:', e);
    }
  }

  // Shared audio element for previewing audio files
  let previewAudio = null;
  let currentlyPlayingBtn = null;

  window.playAudio = function (filename, btn) {
    // If already playing this file, stop it
    if (previewAudio && currentlyPlayingBtn === btn) {
      previewAudio.pause();
      previewAudio = null;
      btn.textContent = 'Dinle';
      btn.classList.remove('btn-playing');
      currentlyPlayingBtn = null;
      return;
    }

    // Stop any currently playing audio
    if (previewAudio) {
      previewAudio.pause();
      if (currentlyPlayingBtn) {
        currentlyPlayingBtn.textContent = 'Dinle';
        currentlyPlayingBtn.classList.remove('btn-playing');
      }
    }

    previewAudio = new Audio(`/audio/${encodeURIComponent(filename)}`);
    currentlyPlayingBtn = btn;
    btn.textContent = 'Durdur';
    btn.classList.add('btn-playing');

    previewAudio.play().catch(err => {
      console.error('Audio playback error:', err);
      btn.textContent = 'Dinle';
      btn.classList.remove('btn-playing');
      currentlyPlayingBtn = null;
    });

    previewAudio.addEventListener('ended', () => {
      btn.textContent = 'Dinle';
      btn.classList.remove('btn-playing');
      currentlyPlayingBtn = null;
      previewAudio = null;
    });
  };

  function renderAudioFiles(files) {
    const tbody = document.getElementById('audio-files-body');
    if (files.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4">Henuz ses dosyasi yok</td></tr>';
      return;
    }

    // Stop any playing audio when re-rendering
    if (previewAudio) {
      previewAudio.pause();
      previewAudio = null;
      currentlyPlayingBtn = null;
    }

    tbody.innerHTML = files.map(f => `<tr>
      <td>${escapeHtml(f.name)}</td>
      <td class="file-size">${formatSize(f.size)}</td>
      <td class="file-size">${new Date(f.modified).toLocaleDateString('tr-TR')}</td>
      <td>
        <button class="btn btn-small btn-secondary" onclick="playAudio('${escapeHtml(f.name)}', this)">Dinle</button>
        <button class="btn btn-danger btn-small" onclick="deleteAudioFile('${escapeHtml(f.name)}')">Sil</button>
      </td>
    </tr>`).join('');
  }

  document.getElementById('btn-upload-audio').addEventListener('click', () => {
    document.getElementById('audio-file-input').click();
  });

  document.getElementById('audio-file-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const statusEl = document.getElementById('audio-upload-status');
    statusEl.className = 'upload-status';
    statusEl.textContent = 'Yukleniyor...';
    try {
      const res = await API.uploadAudioFile(file);
      statusEl.className = 'upload-status success';
      statusEl.textContent = `${res.filename} yuklendi (${formatSize(res.size)})`;
      loadAudioFiles();
    } catch (err) {
      statusEl.className = 'upload-status error';
      statusEl.textContent = `Hata: ${err.message}`;
    }
    e.target.value = '';
  });

  window.deleteAudioFile = async function (filename) {
    if (!confirm(`"${filename}" silinsin mi?`)) return;
    try {
      await API.deleteAudioFile(filename);
      loadAudioFiles();
    } catch (e) {
      alert(`Silme hatasi: ${e.message}`);
    }
  };

  // === DATA TAB ===
  async function loadCsvFiles() {
    try {
      const [csvData, config] = await Promise.all([
        API.getCsvFiles(),
        API.getConfig(),
      ]);
      renderCsvFiles(csvData.files);
      // Populate API settings
      document.getElementById('cfg-diyanetLocationId').value = config.diyanetLocationId || 11618;
      document.getElementById('cfg-data-timezone').value = config.timezone || '';
    } catch (e) {
      console.error('Failed to load data tab:', e);
    }
  }

  // Save API settings
  document.getElementById('btn-save-api-settings').addEventListener('click', async () => {
    const statusEl = document.getElementById('api-settings-status');
    try {
      const config = await API.getConfig();
      const updated = {
        ...config,
        diyanetLocationId: parseInt(document.getElementById('cfg-diyanetLocationId').value) || 11618,
        timezone: document.getElementById('cfg-data-timezone').value || config.timezone,
      };
      await API.saveConfig(updated);
      statusEl.className = 'action-result success';
      statusEl.textContent = 'API ayarlari kaydedildi';
      setTimeout(() => { statusEl.textContent = ''; }, 3000);
    } catch (e) {
      statusEl.className = 'action-result error';
      statusEl.textContent = `Hata: ${e.message}`;
    }
  });

  // Fetch prayer times from API
  document.getElementById('btn-fetch-api').addEventListener('click', async () => {
    const statusEl = document.getElementById('api-settings-status');
    statusEl.className = 'action-result';
    statusEl.textContent = 'Vakitler cekiliyor...';
    try {
      const res = await API.fetchPrayerTimes();
      statusEl.className = `action-result ${res.success ? 'success' : 'error'}`;
      statusEl.textContent = res.message;
      if (res.success) {
        loadCsvFiles();
        loadHome();
      }
    } catch (e) {
      statusEl.className = 'action-result error';
      statusEl.textContent = `Hata: ${e.message}`;
    }
  });

  function renderCsvFiles(files) {
    const tbody = document.getElementById('csv-files-body');
    if (files.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5">Henuz CSV dosyasi yok</td></tr>';
      return;
    }
    tbody.innerHTML = files.map(f => `<tr>
      <td>${escapeHtml(f.name)}</td>
      <td class="file-size">${formatSize(f.size)}</td>
      <td class="file-size">${new Date(f.modified).toLocaleDateString('tr-TR')}</td>
      <td><span class="badge ${f.active ? 'badge-active' : 'badge-inactive'}">${f.active ? 'Aktif' : 'Pasif'}</span></td>
      <td>
        ${!f.active ? `<button class="btn btn-activate" onclick="activateCsv('${escapeHtml(f.name)}')">Aktif Yap</button>` : ''}
        ${!f.active ? `<button class="btn btn-danger btn-small" onclick="deleteCsvFile('${escapeHtml(f.name)}')">Sil</button>` : ''}
      </td>
    </tr>`).join('');
  }

  document.getElementById('btn-upload-csv').addEventListener('click', () => {
    document.getElementById('csv-file-input').click();
  });

  document.getElementById('csv-file-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const statusEl = document.getElementById('csv-upload-status');
    statusEl.className = 'upload-status';
    statusEl.textContent = 'Yukleniyor...';
    try {
      const res = await API.uploadCsvFile(file);
      statusEl.className = 'upload-status success';
      statusEl.textContent = `${res.filename} yuklendi (${formatSize(res.size)})`;
      loadCsvFiles();
    } catch (err) {
      statusEl.className = 'upload-status error';
      statusEl.textContent = `Hata: ${err.message}`;
    }
    e.target.value = '';
  });

  window.activateCsv = async function (filename) {
    try {
      await API.activateCsvFile(filename);
      loadCsvFiles();
      loadHome();
    } catch (e) {
      alert(`Aktivasyon hatasi: ${e.message}`);
    }
  };

  window.deleteCsvFile = async function (filename) {
    if (!confirm(`"${filename}" silinsin mi?`)) return;
    try {
      await API.deleteCsvFile(filename);
      loadCsvFiles();
    } catch (e) {
      alert(`Silme hatasi: ${e.message}`);
    }
  };

  // === LOGS TAB ===
  async function loadLogs() {
    try {
      const data = await API.getLogs();
      renderLogs(data.logs);
    } catch (e) {
      console.error('Failed to load logs:', e);
    }

    // Setup auto-refresh
    setupLogAutoRefresh();
  }

  function renderLogs(logs) {
    const output = document.getElementById('log-output');
    output.innerHTML = logs.map(log => {
      const time = new Date(log.timestamp).toLocaleTimeString('tr-TR');
      return `<div class="log-line log-${log.level}"><span class="log-time">${time}</span>${escapeHtml(log.message)}</div>`;
    }).join('');

    // Auto-scroll to bottom
    const container = document.getElementById('log-container');
    container.scrollTop = container.scrollHeight;
  }

  function setupLogAutoRefresh() {
    if (logInterval) clearInterval(logInterval);

    const autoRefresh = document.getElementById('log-auto-refresh');

    function tick() {
      if (autoRefresh.checked && document.getElementById('tab-logs').classList.contains('active')) {
        loadLogs();
      }
    }

    logInterval = setInterval(tick, 5000);
  }

  document.getElementById('btn-refresh-logs').addEventListener('click', loadLogs);

  // === HELPERS ===
  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // === TEST PRAYER BUTTONS ===
  function resetAllTestButtons() {
    document.querySelectorAll('.btn-test-prayer').forEach(btn => {
      btn.innerHTML = '&#9654;';
      btn.classList.remove('btn-playing');
    });
    activeTestPrayer = null;
  }

  document.querySelectorAll('.btn-test-prayer').forEach(btn => {
    btn.addEventListener('click', async () => {
      const prayer = btn.dataset.prayer;

      if (activeTestPrayer === prayer) {
        // Stop current test
        try { await API.stopTestPrayer(); } catch (e) { /* ignore */ }
        resetAllTestButtons();
        return;
      }

      // Read current volume from the slider
      const slider = document.getElementById(`cfg-vol-${prayer}`);
      const volume = parseInt(slider.value) / 100;

      // Reset all buttons first
      resetAllTestButtons();

      // Start new test
      btn.innerHTML = '&#9724;';
      btn.classList.add('btn-playing');
      activeTestPrayer = prayer;

      try {
        await API.testPrayer(prayer, volume);
      } catch (e) {
        resetAllTestButtons();
      }
    });
  });

  // Poll test prayer status every 3 seconds to detect natural end
  testPollInterval = setInterval(async () => {
    if (!activeTestPrayer) return;
    try {
      const status = await API.getTestPrayerStatus();
      if (!status.playing) {
        resetAllTestButtons();
      }
    } catch (e) { /* ignore */ }
  }, 3000);

  // === INIT ===
  loadHome();
})();
