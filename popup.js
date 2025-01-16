let currentTab = null;
let settings = {
  refreshMode: 'default',
  interval: 30,
  minInterval: 10,
  maxInterval: 60,
  countdownTime: 5,
  refreshCount: 0,
  monitorMode: 'none',
  keywords: '',
  autoClick: false,
  showTimer: true,
  stopOnInteraction: true,
  hardRefresh: false,
  notifications: true
};

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
  // Get current tab
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tabs[0];

  // Load saved settings
  const savedSettings = await chrome.storage.local.get('settings');
  if (savedSettings.settings) {
    settings = { ...settings, ...savedSettings.settings };
  }

  // Initialize UI with saved settings
  initializeUI();

  // Setup event listeners
  setupEventListeners();

  // Load saved logs
  await loadSavedLogs();

  // Listen for changes in logs
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.actionLogs) {
      // Update the logs table when actionLogs change
      loadSavedLogs();
    }
  });
});

// Listen for messages from background script
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (message.action === 'refreshComplete' && message.tabId === currentTab?.id) {
    document.getElementById('startBtn').disabled = false;
    document.getElementById('stopBtn').disabled = true;
    if (message.refreshCount > 0) {
      await addLogEntry('COMPLETE', `Завершено ${message.refreshCount} обновлений`);
      alert(`Автообновление завершено: достигнуто ${message.refreshCount} обновлений`);
    }
  }
  return true;
});

function initializeUI() {
  // Set values for all inputs based on settings
  document.getElementById('refreshMode').value = settings.refreshMode;
  document.getElementById('interval').value = settings.interval;
  document.getElementById('minInterval').value = settings.minInterval;
  document.getElementById('maxInterval').value = settings.maxInterval;
  document.getElementById('countdownTime').value = settings.countdownTime;
  document.getElementById('refreshCount').value = settings.refreshCount;
  document.getElementById('monitorMode').value = settings.monitorMode;
  document.getElementById('keywords').value = settings.keywords;
  document.getElementById('autoClick').checked = settings.autoClick;
  document.getElementById('showTimer').checked = settings.showTimer;
  document.getElementById('stopOnInteraction').checked = settings.stopOnInteraction;
  document.getElementById('hardRefresh').checked = settings.hardRefresh;
  document.getElementById('notifications').checked = settings.notifications;

  // Show/hide relevant settings sections
  updateVisibleSettings();
}

function setupEventListeners() {
  // Mode change handlers
  document.getElementById('refreshMode').addEventListener('change', (e) => {
    settings.refreshMode = e.target.value;
    updateVisibleSettings();
  });

  document.getElementById('monitorMode').addEventListener('change', (e) => {
    settings.monitorMode = e.target.value;
    updateVisibleSettings();
  });

  // Input change handlers
  document.getElementById('interval').addEventListener('change', (e) => {
    settings.interval = Math.max(2, parseInt(e.target.value));
    e.target.value = settings.interval;
  });

  document.getElementById('refreshCount').addEventListener('change', (e) => {
    settings.refreshCount = parseInt(e.target.value);
  });

  document.getElementById('minInterval').addEventListener('change', (e) => {
    settings.minInterval = Math.max(2, parseInt(e.target.value));
    e.target.value = settings.minInterval;
  });

  document.getElementById('maxInterval').addEventListener('change', (e) => {
    settings.maxInterval = Math.max(settings.minInterval, parseInt(e.target.value));
    e.target.value = settings.maxInterval;
  });

  document.getElementById('countdownTime').addEventListener('change', (e) => {
    settings.countdownTime = parseInt(e.target.value);
  });

  document.getElementById('keywords').addEventListener('change', (e) => {
    settings.keywords = e.target.value;
  });

  // Checkbox handlers
  document.getElementById('autoClick').addEventListener('change', (e) => {
    settings.autoClick = e.target.checked;
  });

  document.getElementById('showTimer').addEventListener('change', (e) => {
    settings.showTimer = e.target.checked;
  });

  document.getElementById('stopOnInteraction').addEventListener('change', (e) => {
    settings.stopOnInteraction = e.target.checked;
  });

  document.getElementById('hardRefresh').addEventListener('change', (e) => {
    settings.hardRefresh = e.target.checked;
  });

  document.getElementById('notifications').addEventListener('change', (e) => {
    settings.notifications = e.target.checked;
  });

  // Button handlers
  document.getElementById('startBtn').addEventListener('click', startRefresh);
  document.getElementById('stopBtn').addEventListener('click', stopRefresh);
  document.getElementById('clearLogsBtn').addEventListener('click', clearLogs);
}

function updateVisibleSettings() {
  document.getElementById('defaultSettings').style.display = 
    settings.refreshMode === 'default' ? 'block' : 'none';
  document.getElementById('randomSettings').style.display = 
    settings.refreshMode === 'random' ? 'block' : 'none';
  document.getElementById('countdownSettings').style.display = 
    settings.refreshMode === 'countdown' ? 'block' : 'none';

  document.getElementById('monitorSettings').style.display = 
    settings.monitorMode !== 'none' ? 'block' : 'none';
}

async function addLogEntry(type, details) {
  const now = new Date();
  const timestamp = now.getTime();
  const timeString = now.toLocaleTimeString();
  const dateString = now.toLocaleDateString();

  const newLog = {
    timestamp,
    date: dateString,
    time: timeString,
    type,
    details
  };

  // Get existing logs
  const { actionLogs = [] } = await chrome.storage.local.get('actionLogs');
  
  // Add new log and filter out old ones
  const updatedLogs = [newLog, ...actionLogs]
    .filter(log => now.getTime() - log.timestamp < 24 * 60 * 60 * 1000);

  // Save updated logs
  await chrome.storage.local.set({ actionLogs: updatedLogs });
}

async function loadSavedLogs() {
  const { actionLogs = [] } = await chrome.storage.local.get('actionLogs');
  const logsDiv = document.getElementById('actionLogs');
  logsDiv.innerHTML = '';

  // Filter out logs older than 24 hours
  const now = new Date().getTime();
  const recentLogs = actionLogs.filter(log => 
    now - log.timestamp < 24 * 60 * 60 * 1000
  );

  // Save filtered logs back to storage
  if (recentLogs.length !== actionLogs.length) {
    await chrome.storage.local.set({ actionLogs: recentLogs });
  }

  recentLogs.forEach(log => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="log-time">${log.time}</td>
      <td class="log-type log-type-${log.type.toLowerCase()}"><span>${log.type}</span></td>
      <td class="log-details">${log.details}</td>
    `;
    logsDiv.appendChild(tr);
  });
}

async function clearLogs() {
  await chrome.storage.local.set({ actionLogs: [] });
  document.getElementById('actionLogs').innerHTML = '';
}

async function startRefresh() {
    // Enforce minimum refresh interval of 2 seconds
    if (settings.interval < 2) settings.interval = 2;
    if (settings.minInterval < 2) settings.minInterval = 2;
    if (settings.maxInterval < settings.minInterval) settings.maxInterval = settings.minInterval;
  
    const refreshCountInput = document.getElementById('refreshCount');
    settings.refreshCount = parseInt(refreshCountInput.value, 10);
  
    await chrome.storage.local.set({ settings });
  
    const details = `
      URL: <code>${currentTab.url}</code><br>
      Режим: <code>${settings.refreshMode}</code><br>
      Интервал: <code>${settings.refreshMode === 'default' ? settings.interval + 's' :
                 settings.refreshMode === 'random' ? `${settings.minInterval}-${settings.maxInterval}s` :
                 `${settings.countdownTime}min`}</code><br>
      Количество: <code>${settings.refreshCount || 'бесконечно'}</code>
    `;
  
    await addLogEntry('START', details);
  
    chrome.runtime.sendMessage({
      action: 'startRefresh',
      tabId: currentTab.id,
      settings: settings
    });
  
    document.getElementById('startBtn').disabled = true;
    document.getElementById('stopBtn').disabled = false;
  }
  

  async function stopRefresh() {
    chrome.runtime.sendMessage({
      action: 'stopRefresh',
      tabId: currentTab.id
    });
  
    await addLogEntry('STOP', `Задача остановлена вручную<br>URL: <code>${currentTab.url}</code>`);
  
    document.getElementById('startBtn').disabled = false;
    document.getElementById('stopBtn').disabled = true;
  }

   // Handle star rating
   document.querySelectorAll('.star').forEach(star => {
    star.addEventListener('click', () => {
      const rating = star.dataset.rating;
      const extensionId = chrome.runtime.id;
      const chromeStoreUrl = `https://chrome.google.com/webstore/detail/${extensionId}`;
      chrome.tabs.create({ url: chromeStoreUrl });
    });
  });