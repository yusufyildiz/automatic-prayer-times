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

  // === PWA: OFFLINE/ONLINE DETECTION ===
  function updateOnlineStatus() {
    const banner = document.getElementById('offline-banner');
    if (!banner) return;
    if (navigator.onLine) {
      banner.classList.remove('visible');
    } else {
      banner.classList.add('visible');
    }
  }
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  updateOnlineStatus();

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
  let silentCountdownInterval = null;
  let ramadanCountdownInterval = null;
  let homeRefreshInterval = null;

  function startHomeAutoRefresh() {
    if (homeRefreshInterval) clearInterval(homeRefreshInterval);
    homeRefreshInterval = setInterval(() => {
      if (document.getElementById('tab-home').classList.contains('active')) {
        loadHome();
      }
    }, 30000); // 30 seconds
  }

  async function loadHome() {
    try {
      currentStatus = await API.getStatus();
      renderSilentMode(currentStatus);
      renderNowPlaying(currentStatus);
      renderTodayTimes(currentStatus);
      startCountdown(currentStatus.nextPrayer);
      renderTomorrowTimes();
      renderRamadanCard(currentStatus);
      renderWeeklySummary();
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
    const now = new Date();
    const today = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    dateLabel.textContent = today;

    const times = status.todaysPrayerTimes;
    if (!times) {
      container.innerHTML = '<div class="prayer-empty">Bugun icin vakit bilgisi bulunamadi</div>';
      return;
    }

    const activePrayers = status.config?.prayers || [];
    const nextPrayer = status.nextPrayer;
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
    const tomorrowDate = tomorrow.getFullYear() + '-' + String(tomorrow.getMonth() + 1).padStart(2, '0') + '-' + String(tomorrow.getDate()).padStart(2, '0');
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
    timeEl.textContent = nextPrayer.isTomorrow
      ? `Yarin saat: ${nextPrayer.time}`
      : `Saat: ${nextPrayer.time}`;

    function updateCountdown() {
      const now = new Date();
      const [h, m] = nextPrayer.time.split(':').map(Number);
      const target = new Date(now);
      if (nextPrayer.isTomorrow) {
        target.setDate(target.getDate() + 1);
      }
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

  // === SILENT MODE ===
  function renderSilentMode(status) {
    const card = document.getElementById('silent-mode-card');
    const offBtn = document.getElementById('btn-silent-off');
    const activeDiv = document.getElementById('silent-mode-active');
    const optionsDiv = document.getElementById('silent-mode-options');

    if (!card) return;

    if (status.silentMode) {
      card.classList.add('silent-active');
      offBtn.style.display = '';
      activeDiv.style.display = 'block';
      optionsDiv.style.display = 'none';

      if (silentCountdownInterval) clearInterval(silentCountdownInterval);
      const countdownEl = document.getElementById('silent-countdown');

      if (status.silentModeExpiry) {
        function updateSilentCountdown() {
          const diff = new Date(status.silentModeExpiry) - new Date();
          if (diff <= 0) {
            countdownEl.textContent = 'Sure doldu';
            clearInterval(silentCountdownInterval);
            setTimeout(loadHome, 2000);
            return;
          }
          const m = Math.floor(diff / 60000);
          const s = Math.floor((diff % 60000) / 1000);
          countdownEl.textContent = `${m}dk ${s}sn kaldi`;
        }
        updateSilentCountdown();
        silentCountdownInterval = setInterval(updateSilentCountdown, 1000);
      } else {
        countdownEl.textContent = 'Suresiz sessiz mod aktif';
      }
    } else {
      card.classList.remove('silent-active');
      offBtn.style.display = 'none';
      activeDiv.style.display = 'none';
      optionsDiv.style.display = 'flex';
      if (silentCountdownInterval) clearInterval(silentCountdownInterval);
    }
  }

  // === NOW PLAYING ===
  function renderNowPlaying(status) {
    const card = document.getElementById('now-playing-card');
    if (!card) return;

    if (status.currentlyPlaying) {
      const prayerName = PRAYER_NAMES[status.currentlyPlaying] || status.currentlyPlaying;
      document.getElementById('now-playing-text').textContent = `${prayerName} ezani caliniyor...`;
      card.style.display = '';
    } else {
      card.style.display = 'none';
    }
  }

  document.getElementById('btn-stop-adhan').addEventListener('click', async () => {
    try {
      await API.stopAdhan();
      loadHome();
    } catch (e) {
      console.error('Stop adhan failed:', e);
    }
  });

  // Silent mode off button
  document.getElementById('btn-silent-off').addEventListener('click', async () => {
    await API.setSilentMode(false);
    loadHome();
  });

  // Silent mode duration buttons
  document.querySelectorAll('.silent-duration').forEach(btn => {
    btn.addEventListener('click', async () => {
      const duration = parseInt(btn.dataset.duration);
      await API.setSilentMode(true, duration || null);
      loadHome();
    });
  });

  // === RAMADAN CARD ===
  function renderRamadanCard(status) {
    const card = document.getElementById('ramadan-card');
    if (!card) return;

    const ramadan = status.config?.ramadan;
    if (!ramadan || !ramadan.enabled) {
      card.style.display = 'none';
      if (ramadanCountdownInterval) clearInterval(ramadanCountdownInterval);
      return;
    }

    card.style.display = '';
    const times = status.todaysPrayerTimes;
    if (!times) return;

    // Iftar = maghrib time, Sahur = fajr adjusted time
    const iftarTime = times.maghrib;
    const iftarEl = document.getElementById('ramadan-iftar-time');
    const iftarCountEl = document.getElementById('ramadan-iftar-countdown');
    iftarEl.textContent = iftarTime || '--:--';

    // Sahur = imsak vakti (CSV fajr time)
    const sahurTime = times.fajr;
    const sahurEl = document.getElementById('ramadan-sahur-time');
    const sahurCountEl = document.getElementById('ramadan-sahur-countdown');
    sahurEl.textContent = sahurTime || '--:--';

    if (ramadanCountdownInterval) clearInterval(ramadanCountdownInterval);

    function updateRamadanCountdown() {
      const now = new Date();
      const today = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');

      if (iftarTime) {
        const [ih, im] = iftarTime.split(':').map(Number);
        const iftarDate = new Date(`${today}T${String(ih).padStart(2,'0')}:${String(im).padStart(2,'0')}:00`);
        const iftarDiff = iftarDate - now;
        if (iftarDiff > 0) {
          const h = Math.floor(iftarDiff / 3600000);
          const m = Math.floor((iftarDiff % 3600000) / 60000);
          const s = Math.floor((iftarDiff % 60000) / 1000);
          iftarCountEl.textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
        } else {
          iftarCountEl.textContent = 'Iftar vakti gecti';
        }
      }

      if (sahurTime) {
        const [sh, sm] = sahurTime.split(':').map(Number);
        const sahurDate = new Date(`${today}T${String(sh).padStart(2,'0')}:${String(sm).padStart(2,'0')}:00`);
        const sahurDiff = sahurDate - now;
        if (sahurDiff > 0) {
          const h = Math.floor(sahurDiff / 3600000);
          const m = Math.floor((sahurDiff % 3600000) / 60000);
          const s = Math.floor((sahurDiff % 60000) / 1000);
          sahurCountEl.textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
        } else {
          sahurCountEl.textContent = 'Sahur vakti gecti';
        }
      }
    }
    updateRamadanCountdown();
    ramadanCountdownInterval = setInterval(updateRamadanCountdown, 1000);
  }

  // === WEEKLY SUMMARY ===
  async function renderWeeklySummary() {
    const card = document.getElementById('weekly-summary-card');
    const statsEl = document.getElementById('weekly-stats');
    const chartEl = document.getElementById('weekly-chart');
    if (!card || !statsEl) return;

    try {
      const data = await API.getHistoryStats();
      const s = data.stats;
      if (!s || s.total === 0) {
        statsEl.innerHTML = '<div class="prayer-empty">Henuz kayit yok</div>';
        chartEl.innerHTML = '';
        return;
      }

      statsEl.innerHTML = `
        <div class="stat-box stat-played"><div class="stat-number">${s.played}</div><div class="stat-label">Calindi</div></div>
        <div class="stat-box stat-failed"><div class="stat-number">${s.failed}</div><div class="stat-label">Basarisiz</div></div>
        <div class="stat-box stat-skipped"><div class="stat-number">${s.skipped}</div><div class="stat-label">Atlandi</div></div>
        <div class="stat-box stat-rate"><div class="stat-number">${s.successRate}%</div><div class="stat-label">Basari</div></div>
      `;

      // Daily bar chart
      if (s.daily && s.daily.length > 0) {
        const maxCount = Math.max(...s.daily.map(d => d.played + d.failed + d.skipped), 1);
        chartEl.innerHTML = s.daily.map(d => {
          const dayLabel = d.date.slice(5); // MM-DD
          const total = d.played + d.failed + d.skipped;
          const pct = Math.round((total / maxCount) * 100);
          return `<div class="chart-bar-group">
            <div class="chart-bar-container">
              <div class="chart-bar chart-bar-played" style="height:${Math.round((d.played/maxCount)*100)}%"></div>
              <div class="chart-bar chart-bar-failed" style="height:${Math.round((d.failed/maxCount)*100)}%"></div>
            </div>
            <div class="chart-bar-label">${dayLabel}</div>
          </div>`;
        }).join('');
      }
    } catch (e) {
      statsEl.innerHTML = '<div class="prayer-empty">Ozet yuklenemedi</div>';
      chartEl.innerHTML = '';
    }
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
      const [status, config, audioData] = await Promise.all([
        API.getStatus(),
        API.getConfig(),
        API.getAudioFiles(),
      ]);
      renderStatus(status);
      populateConfigForm(config, audioData.files);
    } catch (e) {
      console.error('Failed to load settings:', e);
    }
  }

  function populateConfigForm(config, audioFiles) {
    document.getElementById('cfg-deviceIp').value = config.deviceIp || '';
    document.getElementById('cfg-deviceName').value = config.deviceName || '';
    document.getElementById('cfg-timezone').value = config.timezone || '';
    document.getElementById('cfg-serverPort').value = config.serverPort || 3000;
    document.getElementById('cfg-localIp').value = config.localIp || '';
    document.getElementById('cfg-testConnection').checked = config.testConnection || false;

    // Prayer checkboxes + inactive state
    const prayers = config.prayers || [];
    document.querySelectorAll('.prayer-setting input[type="checkbox"]').forEach(cb => {
      cb.checked = prayers.includes(cb.value);
      const card = cb.closest('.prayer-setting');
      card.classList.toggle('inactive', !cb.checked);
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

    // Dua file selects
    ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'].forEach(p => {
      const sel = document.getElementById(`cfg-dua-${p}`);
      if (!sel) return;
      sel.innerHTML = '<option value="">Yok</option>';
      audioFiles.forEach(f => {
        const opt = document.createElement('option');
        opt.value = f.name;
        opt.textContent = f.name;
        sel.appendChild(opt);
      });
      if (config.duaFiles && config.duaFiles[p]) sel.value = config.duaFiles[p];
    });

    // Dua volume steppers
    ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'].forEach(p => {
      const display = document.getElementById(`dua-vol-display-${p}`);
      if (!display) return;
      const ezanVol = config.volumes && config.volumes[p] !== undefined
        ? Math.round(config.volumes[p] * 100)
        : defaultVol;
      const raw = config.duaVolumes && config.duaVolumes[p] !== undefined
        ? Math.round(config.duaVolumes[p] * 100)
        : ezanVol;
      const val = Math.round(raw / 5) * 5;
      display.dataset.value = val;
      display.textContent = `${val}%`;
    });

    // Set current values
    document.getElementById('cfg-adhanAudioFile').value = config.adhanAudioFile || '';

    if (config.audioFiles) {
      ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'].forEach(p => {
        const el = document.getElementById(`cfg-audio-${p}`);
        if (el && config.audioFiles[p]) el.value = config.audioFiles[p];
      });
    }

    // Per-prayer volume steppers
    const defaultVol = Math.round((config.volume || 0.5) * 100);
    ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'].forEach(p => {
      const display = document.getElementById(`vol-display-${p}`);
      const raw = config.volumes && config.volumes[p] !== undefined
        ? Math.round(config.volumes[p] * 100)
        : defaultVol;
      const val = Math.round(raw / 5) * 5;
      display.dataset.value = val;
      display.textContent = `${val}%`;
    });

    // Friday settings
    const fridayAudioSelect = document.getElementById('cfg-friday-audio');
    if (fridayAudioSelect) {
      fridayAudioSelect.innerHTML = '<option value="">Yok (Normal ezan)</option>';
      audioFiles.forEach(f => {
        const opt = document.createElement('option');
        opt.value = f.name;
        opt.textContent = f.name;
        fridayAudioSelect.appendChild(opt);
      });
      if (config.friday && config.friday.audioFile) {
        fridayAudioSelect.value = config.friday.audioFile;
      }
    }
    const fridayVolDisplay = document.getElementById('friday-vol-display');
    if (fridayVolDisplay) {
      const fv = config.friday && config.friday.volume !== undefined
        ? Math.round(config.friday.volume * 100)
        : Math.round((config.volume || 0.5) * 100);
      const fvRound = Math.round(fv / 5) * 5;
      fridayVolDisplay.dataset.value = fvRound;
      fridayVolDisplay.textContent = `${fvRound}%`;
    }

    // Fajr offset
    const fajrOffsetDisplay = document.getElementById('fajr-offset-display');
    if (fajrOffsetDisplay) {
      const offset = config.fajrOffset ?? 40;
      fajrOffsetDisplay.dataset.value = offset;
      fajrOffsetDisplay.textContent = `${offset} dk`;
    }

    // Ramadan settings — always populate audio selects
    const ramadanEnabled = document.getElementById('cfg-ramadan-enabled');
    const ramadanSub = document.getElementById('ramadan-sub-settings');
    if (ramadanEnabled) {
      const isEnabled = config.ramadan?.enabled || false;
      ramadanEnabled.checked = isEnabled;
      if (ramadanSub) ramadanSub.style.display = isEnabled ? '' : 'none';

      const iftarMinEl = document.getElementById('cfg-iftar-minutes');
      const sahurMinEl = document.getElementById('cfg-sahur-minutes');
      if (iftarMinEl) iftarMinEl.value = config.ramadan?.iftarAlertMinutesBefore || 15;
      if (sahurMinEl) sahurMinEl.value = config.ramadan?.sahurAlertMinutesBefore || 30;

      // Always populate audio selects
      ['cfg-iftar-audio', 'cfg-sahur-audio'].forEach(id => {
        const sel = document.getElementById(id);
        if (!sel) return;
        sel.innerHTML = '<option value="">Yok</option>';
        audioFiles.forEach(f => {
          const opt = document.createElement('option');
          opt.value = f.name;
          opt.textContent = f.name;
          sel.appendChild(opt);
        });
      });
      const iftarAudioEl = document.getElementById('cfg-iftar-audio');
      const sahurAudioEl = document.getElementById('cfg-sahur-audio');
      if (iftarAudioEl && config.ramadan?.iftarAlertAudioFile) iftarAudioEl.value = config.ramadan.iftarAlertAudioFile;
      if (sahurAudioEl && config.ramadan?.sahurAlertAudioFile) sahurAudioEl.value = config.ramadan.sahurAlertAudioFile;
    }
  }

  // Stepper buttons
  document.querySelectorAll('.prayer-setting').forEach(item => {
    const prayer = item.dataset.prayer;
    const display = document.getElementById(`vol-display-${prayer}`);
    const step = 5;

    item.querySelector('.stepper-minus').addEventListener('click', () => {
      let val = parseInt(display.dataset.value) - step;
      if (val < 0) val = 0;
      display.dataset.value = val;
      display.textContent = `${val}%`;
    });

    item.querySelector('.stepper-plus').addEventListener('click', () => {
      let val = parseInt(display.dataset.value) + step;
      if (val > 100) val = 100;
      display.dataset.value = val;
      display.textContent = `${val}%`;
    });
  });

  // Friday volume stepper
  const fridayVolMinus = document.getElementById('friday-vol-minus');
  const fridayVolPlus = document.getElementById('friday-vol-plus');
  const fridayVolDisplay = document.getElementById('friday-vol-display');
  if (fridayVolMinus && fridayVolPlus && fridayVolDisplay) {
    fridayVolMinus.addEventListener('click', () => {
      let val = parseInt(fridayVolDisplay.dataset.value) - 5;
      if (val < 0) val = 0;
      fridayVolDisplay.dataset.value = val;
      fridayVolDisplay.textContent = `${val}%`;
    });
    fridayVolPlus.addEventListener('click', () => {
      let val = parseInt(fridayVolDisplay.dataset.value) + 5;
      if (val > 100) val = 100;
      fridayVolDisplay.dataset.value = val;
      fridayVolDisplay.textContent = `${val}%`;
    });
  }

  // Dua volume steppers
  ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'].forEach(p => {
    const minus = document.getElementById(`dua-vol-minus-${p}`);
    const plus = document.getElementById(`dua-vol-plus-${p}`);
    const display = document.getElementById(`dua-vol-display-${p}`);
    if (minus && plus && display) {
      minus.addEventListener('click', () => {
        let val = parseInt(display.dataset.value) - 5;
        if (val < 0) val = 0;
        display.dataset.value = val;
        display.textContent = `${val}%`;
      });
      plus.addEventListener('click', () => {
        let val = parseInt(display.dataset.value) + 5;
        if (val > 100) val = 100;
        display.dataset.value = val;
        display.textContent = `${val}%`;
      });
    }
  });

  // Fajr offset stepper
  const fajrOffMinus = document.getElementById('fajr-offset-minus');
  const fajrOffPlus = document.getElementById('fajr-offset-plus');
  const fajrOffDisplay = document.getElementById('fajr-offset-display');
  if (fajrOffMinus && fajrOffPlus && fajrOffDisplay) {
    fajrOffMinus.addEventListener('click', () => {
      let val = parseInt(fajrOffDisplay.dataset.value) - 5;
      if (val < 0) val = 0;
      fajrOffDisplay.dataset.value = val;
      fajrOffDisplay.textContent = `${val} dk`;
    });
    fajrOffPlus.addEventListener('click', () => {
      let val = parseInt(fajrOffDisplay.dataset.value) + 5;
      if (val > 120) val = 120;
      fajrOffDisplay.dataset.value = val;
      fajrOffDisplay.textContent = `${val} dk`;
    });
  }

  // Prayer toggle — dim card when unchecked
  document.querySelectorAll('.prayer-setting input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      cb.closest('.prayer-setting').classList.toggle('inactive', !cb.checked);
    });
  });

  // Ramadan enabled toggle
  const ramadanEnabledCb = document.getElementById('cfg-ramadan-enabled');
  if (ramadanEnabledCb) {
    ramadanEnabledCb.addEventListener('change', () => {
      const sub = document.getElementById('ramadan-sub-settings');
      if (sub) sub.style.display = ramadanEnabledCb.checked ? '' : 'none';
    });
  }

  // Config form submit
  document.getElementById('config-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const statusEl = document.getElementById('config-save-status');

    const prayers = [];
    document.querySelectorAll('.prayer-setting input[type="checkbox"]:checked').forEach(cb => {
      prayers.push(cb.value);
    });

    const audioFiles = {};
    ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'].forEach(p => {
      const val = document.getElementById(`cfg-audio-${p}`).value;
      if (val) audioFiles[p] = val;
    });

    const volumes = {};
    ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'].forEach(p => {
      volumes[p] = parseInt(document.getElementById(`vol-display-${p}`).dataset.value) / 100;
    });

    // Friday settings
    const fridayAudio = document.getElementById('cfg-friday-audio');
    const fridayVolEl = document.getElementById('friday-vol-display');
    let friday = undefined;
    if (fridayAudio && fridayAudio.value) {
      friday = {
        audioFile: fridayAudio.value,
        volume: fridayVolEl ? parseInt(fridayVolEl.dataset.value) / 100 : 0.5,
      };
    }

    // Dua settings
    const duaFiles = {};
    const duaVolumes = {};
    ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'].forEach(p => {
      const val = document.getElementById(`cfg-dua-${p}`)?.value;
      if (val) duaFiles[p] = val;
      const duaVolDisplay = document.getElementById(`dua-vol-display-${p}`);
      if (duaVolDisplay) duaVolumes[p] = parseInt(duaVolDisplay.dataset.value) / 100;
    });

    // Ramadan settings
    const ramadanEnabled = document.getElementById('cfg-ramadan-enabled');
    let ramadan = undefined;
    if (ramadanEnabled) {
      ramadan = {
        enabled: ramadanEnabled.checked,
        iftarAlertMinutesBefore: parseInt(document.getElementById('cfg-iftar-minutes')?.value) || 15,
        iftarAlertAudioFile: document.getElementById('cfg-iftar-audio')?.value || '',
        sahurAlertMinutesBefore: parseInt(document.getElementById('cfg-sahur-minutes')?.value) || 30,
        sahurAlertAudioFile: document.getElementById('cfg-sahur-audio')?.value || '',
      };
    }

    const config = {
      deviceIp: document.getElementById('cfg-deviceIp').value,
      deviceName: document.getElementById('cfg-deviceName').value,
      volume: currentStatus?.config?.volume || 0.5,
      timezone: document.getElementById('cfg-timezone').value,
      serverPort: parseInt(document.getElementById('cfg-serverPort').value) || 3000,
      localIp: document.getElementById('cfg-localIp').value || null,
      prayers,
      adhanAudioFile: document.getElementById('cfg-adhanAudioFile').value,
      audioFiles: Object.keys(audioFiles).length > 0 ? audioFiles : undefined,
      volumes,
      duaFiles: Object.keys(duaFiles).length > 0 ? duaFiles : undefined,
      duaVolumes,
      friday,
      ramadan: ramadan || currentStatus?.config?.ramadan,
      fajrOffset: fajrOffDisplay ? parseInt(fajrOffDisplay.dataset.value) : 40,
      csvFile: currentStatus?.config?.csvFile || 'prayer-times.csv',
      diyanetLocationId: currentStatus?.config?.diyanetLocationId || 11618,
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

  // === EXCEL UPLOAD ===
  document.getElementById('btn-download-diyanet').addEventListener('click', () => {
    const locationId = document.getElementById('cfg-diyanetLocationId').value || 11618;
    const year = new Date().getFullYear();
    window.open(`https://namazvakitleri.diyanet.gov.tr/tr-TR/home/PrayerTimeYearlyExcel?locationId=${locationId}&year=${year}`, '_blank');
  });

  document.getElementById('btn-upload-excel').addEventListener('click', () => {
    document.getElementById('excel-file-input').click();
  });

  document.getElementById('excel-file-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    await handleExcelUpload(file);
    e.target.value = '';
  });

  // Drag & drop for Excel
  const excelDropArea = document.getElementById('excel-drop-area');
  if (excelDropArea) {
    excelDropArea.addEventListener('dragover', (e) => {
      e.preventDefault();
      excelDropArea.classList.add('drag-over');
    });
    excelDropArea.addEventListener('dragleave', () => {
      excelDropArea.classList.remove('drag-over');
    });
    excelDropArea.addEventListener('drop', async (e) => {
      e.preventDefault();
      excelDropArea.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file && /\.(xlsx|xls)$/i.test(file.name)) {
        await handleExcelUpload(file);
      } else {
        const statusEl = document.getElementById('excel-upload-status');
        statusEl.className = 'upload-status error';
        statusEl.textContent = 'Sadece .xlsx veya .xls dosyalari kabul edilir';
      }
    });
  }

  async function handleExcelUpload(file) {
    const statusEl = document.getElementById('excel-upload-status');
    statusEl.className = 'upload-status';
    statusEl.textContent = 'Yukleniyor ve isleniyor...';
    try {
      const res = await API.uploadExcel(file);
      statusEl.className = 'upload-status success';
      statusEl.textContent = res.message;
      loadCsvFiles();
      loadHome();
    } catch (err) {
      statusEl.className = 'upload-status error';
      statusEl.textContent = `Hata: ${err.message}`;
    }
  }

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

  // === YEARLY TIMES MODAL ===
  const MONTH_NAMES_TR = ['Ocak','Subat','Mart','Nisan','Mayis','Haziran','Temmuz','Agustos','Eylul','Ekim','Kasim','Aralik'];

  document.getElementById('btn-show-yearly').addEventListener('click', async () => {
    const modal = document.getElementById('yearly-modal');
    const body = document.getElementById('yearly-modal-body');
    const nav = document.getElementById('yearly-month-nav');
    body.innerHTML = '<div class="prayer-empty">Yukleniyor...</div>';
    nav.innerHTML = '';
    modal.style.display = 'flex';

    try {
      const data = await API.getAllPrayerTimes();
      const allTimes = data.prayerTimes;
      const dates = Object.keys(allTimes).sort();
      if (dates.length === 0) {
        body.innerHTML = '<div class="prayer-empty">Kayitli vakit verisi yok</div>';
        return;
      }

      // Group by month
      const months = {};
      for (const date of dates) {
        const key = date.slice(0, 7); // YYYY-MM
        if (!months[key]) months[key] = [];
        months[key].push({ date, ...allTimes[date] });
      }

      const monthKeys = Object.keys(months).sort();
      const today = new Date();
      const todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
      const currentMonthKey = todayStr.slice(0, 7);

      // Build month nav
      nav.innerHTML = monthKeys.map(key => {
        const [y, m] = key.split('-');
        const label = MONTH_NAMES_TR[parseInt(m) - 1] + ' ' + y;
        return `<button class="month-btn${key === currentMonthKey ? ' active' : ''}" data-month="${key}">${label}</button>`;
      }).join('');

      function renderMonth(monthKey) {
        const days = months[monthKey];
        if (!days) return;

        nav.querySelectorAll('.month-btn').forEach(b => b.classList.toggle('active', b.dataset.month === monthKey));

        let html = '<table class="monthly-table"><thead><tr><th>Gun</th><th>Imsak</th><th>Gunes</th><th>Ogle</th><th>Ikindi</th><th>Aksam</th><th>Yatsi</th></tr></thead><tbody>';
        for (const d of days) {
          const dayNum = parseInt(d.date.slice(8));
          const isToday = d.date === todayStr;
          html += `<tr class="${isToday ? 'today-row' : ''}"><td>${dayNum}</td><td>${d.fajr || '-'}</td><td>${d.sunrise || '-'}</td><td>${d.dhuhr || '-'}</td><td>${d.asr || '-'}</td><td>${d.maghrib || '-'}</td><td>${d.isha || '-'}</td></tr>`;
        }
        html += '</tbody></table>';
        body.innerHTML = html;
      }

      // Nav click
      nav.addEventListener('click', (e) => {
        if (e.target.classList.contains('month-btn')) {
          renderMonth(e.target.dataset.month);
        }
      });

      // Show current month or first
      renderMonth(months[currentMonthKey] ? currentMonthKey : monthKeys[0]);
    } catch (e) {
      body.innerHTML = `<div class="prayer-empty">Hata: ${e.message}</div>`;
    }
  });

  // Close modal
  document.getElementById('btn-close-modal').addEventListener('click', () => {
    document.getElementById('yearly-modal').style.display = 'none';
  });
  document.getElementById('yearly-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
      e.currentTarget.style.display = 'none';
    }
  });

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

      // Read current volume from the stepper
      const display = document.getElementById(`vol-display-${prayer}`);
      const volume = parseInt(display.dataset.value) / 100;

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
  // PWA: Handle shortcut URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  const tabParam = urlParams.get('tab');
  const actionParam = urlParams.get('action');

  if (tabParam) {
    const tabBtn = document.querySelector(`.tab-btn[data-tab="${tabParam}"]`);
    if (tabBtn) tabBtn.click();
  } else {
    loadHome();
  }

  if (actionParam === 'test-cast') {
    setTimeout(() => {
      const btn = document.getElementById('btn-test-cast');
      if (btn) btn.click();
    }, 1500);
  }

  startHomeAutoRefresh();
})();
