const activeTasks = new Map();

// Function to save log entry even when popup is closed
async function saveLogEntry(type, details) {
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

// Create notification with retry mechanism
async function createNotification(title, message, retryCount = 3) {
  const notificationId = 'refresh_' + Date.now();
  
  const notificationOptions = {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icon96.png'),
    title: title,
    message: message,
    priority: 2,
    requireInteraction: true,
    silent: false
  };

  try {
    // Wrap chrome.notifications.create in a Promise
    await new Promise((resolve, reject) => {
      chrome.notifications.create(notificationId, notificationOptions, (notificationId) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(notificationId);
        }
      });
    });
    
    console.log('Уведомление успешно создано:', notificationId);
    saveLogEntry('NOTIFICATION', `${title}: ${message}`);
  } catch (error) {
    console.error('Не удалось создать уведомление:', error);
    saveLogEntry('ERROR', `Не удалось создать уведомление: ${error.message}`);
    
    // Retry if we have attempts left
    if (retryCount > 0) {
      console.log(`Повторная попытка создания уведомления. Осталось попыток: ${retryCount - 1}`);
      setTimeout(() => {
        createNotification(title, message, retryCount - 1);
      }, 1000);
    }
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Сообщение получено в фоновом режиме:', message.action);
  
  // Always send response immediately to keep the message channel open
  sendResponse({ success: true });
  
  // Handle the message asynchronously
  (async () => {
    try {
      switch (message.action) {
        case 'startRefresh':
          await startRefreshTask(message.tabId, message.settings);
          await createNotification('Автообновление запущено', 'Мониторинг обновления страницы начат');
          await saveLogEntry('START', `Начато наблюдение за ${sender.tab?.url || 'страницей'}`);
          break;
          
        case 'stopRefresh':
          await stopRefreshTask(message.tabId || sender.tab.id);
          await createNotification('Автообновление остановлено', 'Мониторинг обновления страницы остановлен');
          await saveLogEntry('STOP', 'Задача остановлена вручную');
          break;
          
        case 'showNotification':
          await createNotification(message.title, message.message);
          await saveLogEntry('INFO', message.message);
          break;
          
        case 'updateTimer':
          const task = activeTasks.get(message.tabId || sender.tab?.id);
          if (task && !task.stopped) {
            await chrome.tabs.sendMessage(message.tabId || sender.tab.id, {
              action: 'timerUpdate',
              timeLeft: calculateTimeLeft(task),
              refreshCount: task.refreshCount
            }).catch(() => {});
          }
          break;
          
        case 'pageRefreshed':
          const refreshedTask = activeTasks.get(sender.tab?.id);
          if (refreshedTask && !refreshedTask.stopped) {
            await chrome.tabs.sendMessage(sender.tab.id, {
              action: 'refreshStarted',
              settings: refreshedTask.settings,
              tabId: sender.tab.id
            }).catch(() => {});
          }
          break;
          
        case 'getCurrentTab':
          // Already handled by sendResponse above
          break;
      }
    } catch (error) {
      console.error('Ошибка обработки сообщения:', error);
      await saveLogEntry('ERROR', `Ошибка обработки ${message.action}: ${error.message}`);
    }
  })();
  
  return true; // Keep the message channel open for async response
});

// Add notification click handler
chrome.notifications.onClicked.addListener((notificationId) => {
  chrome.notifications.clear(notificationId);
});

async function startRefreshTask(tabId, settings) {
  if (activeTasks.has(tabId)) {
    stopRefreshTask(tabId);
  }

  console.log('Запуск задачи обновления с настройками:', settings);
  saveLogEntry('INFO', `Запуск задачи обновления с интервалом: ${settings.interval}s`);

  const task = {
    settings: settings,
    timer: null,
    refreshCount: 0,
    lastContent: null,
    startTime: Date.now(),
    stopped: false
  };

  try {
    console.log('Внедрение контент-скрипта в вкладку:', tabId);
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content.js']
    });
    await chrome.scripting.insertCSS({
      target: { tabId: tabId },
      files: ['content.css']
    });
    console.log('Контент-скрипт внедрен в вкладку:', tabId);
  } catch (error) {
    console.error('Не удалось внедрить контент-скрипт:', error);
    createNotification('Ошибка', 'Не удалось запустить мониторинг обновления');
    saveLogEntry('ERROR', `Не удалось внедрить контент-скрипт: ${error.message}`);
    return;
  }

  const interval = calculateInterval(settings);
  task.timer = setInterval(() => {
    if (!task.stopped) {
      refreshTab(tabId, task);
    }
  }, interval * 1000);

  activeTasks.set(tabId, task);

  if (settings.showTimer) {
    task.timerInterval = setInterval(() => {
      if (!task.stopped) {
        chrome.tabs.sendMessage(tabId, {
          action: 'timerUpdate',
          timeLeft: calculateTimeLeft(task),
          refreshCount: task.refreshCount
        }).catch(() => {
          clearInterval(task.timerInterval);
        });
      }
    }, 1000);
  }

  try {
    console.log('Отправка сообщения refreshStarted в контент-скрипт...');
    const response = await chrome.tabs.sendMessage(tabId, {
      action: 'refreshStarted',
      settings: settings
    }).catch(() => null);

    if (!response) {
      console.log('Контент-скрипт не ответил, повторное внедрение...');
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['content.js']
      });
      await chrome.scripting.insertCSS({
        target: { tabId: tabId },
        files: ['content.css']
      });
      await chrome.tabs.sendMessage(tabId, {
        action: 'refreshStarted',
        settings: settings
      });
    }
  } catch (error) {
    console.error('Не удалось инициализировать контент-скрипт:', error);
    createNotification('Ошибка', 'Не удалось инициализировать мониторинг обновления');
    saveLogEntry('ERROR', `Не удалось инициализировать контент-скрипт: ${error.message}`);
    stopRefreshTask(tabId);
  }
}

async function stopRefreshTask(tabId) {
  const task = activeTasks.get(tabId);
  if (task) {
    console.log('Остановка задачи обновления. Итоговое количество обновлений:', task.refreshCount);
    saveLogEntry('COMPLETE', `Задача завершена с ${task.refreshCount} обновлениями`);
    
    task.stopped = true;
    clearInterval(task.timer);
    if (task.timerInterval) {
      clearInterval(task.timerInterval);
    }
    activeTasks.delete(tabId);

    try {
      await chrome.tabs.sendMessage(tabId, {
        action: 'refreshStopped'
      }).catch(() => null);
    } catch (error) {
      console.error('Не удалось уведомить контент-скрипт об остановке:', error);
    }

    try {
      await chrome.runtime.sendMessage({
        action: 'refreshComplete',
        tabId: tabId,
        refreshCount: task.refreshCount
      }).catch(() => null);
    } catch (error) {
      console.error('Не удалось уведомить всплывающее окно о завершении:', error);
    }
  }
}

function calculateInterval(settings) {
  switch (settings.refreshMode) {
    case 'random':
      return Math.floor(Math.random() * 
        (settings.maxInterval - settings.minInterval + 1)) + 
        settings.minInterval;
    case 'countdown':
      return settings.countdownTime * 60;
    default:
      return settings.interval;
  }
}

function calculateTimeLeft(task) {
  const interval = calculateInterval(task.settings);
  const elapsed = (Date.now() - task.startTime) / 1000;
  return Math.max(0, Math.ceil(interval - (elapsed % interval)));
}

async function refreshTab(tabId, task) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab || task.stopped) {
      console.log('Вкладка не найдена или задача остановлена, остановка задачи обновления');
      stopRefreshTask(tabId);
      return;
    }

    task.refreshCount++;
    console.log('Количество обновлений:', task.refreshCount, 'Лимит:', task.settings.refreshCount);
    saveLogEntry('INFO', `Количество обновлений: ${task.refreshCount}`);

    if (task.settings.refreshCount > 0 && task.refreshCount >= task.settings.refreshCount) {
      console.log('Достигнут лимит количества обновлений, остановка задачи');
      createNotification(
        'Автообновление завершено',
        `Задача обновления завершена после ${task.refreshCount} обновлений`
      );
      stopRefreshTask(tabId);
      return;
    }

    task.startTime = Date.now();

    if (task.settings.hardRefresh) {
      await chrome.tabs.reload(tabId, { bypassCache: true });
    } else {
      await chrome.tabs.reload(tabId);
    }
  } catch (error) {
    console.error('Не удалось обновить вкладку:', error);
    createNotification('Ошибка', 'Не удалось обновить страницу');
    saveLogEntry('ERROR', `Не удалось обновить вкладку: ${error.message}`);
    stopRefreshTask(tabId);
  }
}