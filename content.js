console.log('Контент-скрипт загружен и выполняется.');

(() => {
    console.log('Контент-скрипт инициализирован.');
    const state = {
      timer: null,
      settings: null,
      checkPerformed: false,
      refreshStopped: false,
      tabId: null,
      alertShown: false,
      refreshCount: 0
    };
  
    // Get the current tab ID
    chrome.runtime.sendMessage({ action: 'getCurrentTab' }, (response) => {
      if (response && response.tabId) {
        state.tabId = response.tabId;
      }
    });

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      console.log('Сообщение получено в контент-скрипте:', message.action);
      switch (message.action) {
        case 'refreshStarted':
          console.log('Обновление начато, инициализация...');
          state.settings = message.settings;
          state.tabId = message.tabId;
          state.checkPerformed = false;
          state.refreshStopped = false;
          state.alertShown = false;
          state.refreshCount = 0;
          console.log('Получены настройки:', state.settings);
          initializeRefresh(message.settings);
          sendResponse({ success: true });
          break;
        case 'refreshStopped':
          console.log('Обновление остановлено, очистка...');
          stopRefresh();
          sendResponse({ success: true });
          break;
        case 'timerUpdate':
          console.log('Получено обновление таймера:', message.timeLeft);
          if (!state.refreshStopped) {
            updateTimer(message.timeLeft, message.refreshCount);
          }
          sendResponse({ success: true });
          break;
        case 'pageRefreshed':
          console.log('Страница обновлена, обработка обновления...');
          handlePageRefresh();
          sendResponse({ success: true });
          break;
      }
      return true;
    });

    function handlePageRefresh() {
      console.log('Обработка обновления страницы...');
      
      if (state.refreshStopped) {
        console.log('Обновление остановлено, пропуск дальнейших действий.');
        return;
      }

      if (state.settings) {
        console.log('Создание таймера после обновления...');
        createTimer();
        chrome.runtime.sendMessage({ 
          action: 'updateTimer', 
          tabId: state.tabId,
          refreshCount: state.refreshCount
        });
        
        if (document.readyState === 'complete') {
          performKeywordCheck();
        } else {
          window.addEventListener('load', performKeywordCheck, { once: true });
        }
      }
    }
  
    function initializeRefresh(settings) {
      console.log('Инициализация обновления с настройками:', settings);
      state.settings = settings;
      state.checkPerformed = false;
      state.refreshStopped = false;
      state.alertShown = false;
      state.refreshCount = 0;
      
      createTimer();
      chrome.runtime.sendMessage({ 
        action: 'updateTimer', 
        tabId: state.tabId,
        refreshCount: state.refreshCount
      });

      if (document.readyState === 'complete') {
        performKeywordCheck();
      } else {
        window.addEventListener('load', performKeywordCheck, { once: true });
      }

      if (settings.stopOnInteraction) {
        initializeInteractionDetection();
      }
    }
  
    function createTimer() {
      if (state.refreshStopped) return;
      
      console.log('Создание элемента таймера...');
      if (state.timer) {
        state.timer.remove();
      }
  
      state.timer = document.createElement('div');
      state.timer.className = 'auto-refresh-timer';
      document.body.appendChild(state.timer);
    }
  
    function updateTimer(timeLeft, refreshCount) {
      console.log('Обновление таймера:', timeLeft);
      if (state.timer && !state.refreshStopped) {
        state.timer.innerHTML = `
          <div>Следующее обновление через ${timeLeft}с</div>
          <div>Обновления: ${refreshCount}</div>
        `;
        state.timer.style.display = state.settings?.showTimer ? 'block' : 'none';
      }
    }
  
    function performKeywordCheck() {
      if (state.checkPerformed || state.refreshStopped) {
        console.log('Проверка ключевых слов уже выполнена или обновление остановлено, пропуск...');
        return;
      }

      console.log('Выполнение проверки ключевых слов...');
      if (!state.settings || state.settings.monitorMode !== 'appear' || !state.settings.keywords) {
        console.log('Мониторинг ключевых слов не настроен, пропуск проверки');
        return;
      }

      const keywords = state.settings.keywords.split(',').map(k => k.trim());
      const pageContent = document.body.textContent.toLowerCase();
      
      for (const keyword of keywords) {
        const keywordLower = keyword.toLowerCase();
        if (pageContent.includes(keywordLower)) {
          console.log('Найдено ключевое слово:', keyword);
          
          state.refreshStopped = true;
          state.checkPerformed = true;

          chrome.runtime.sendMessage({ 
            action: 'stopRefresh', 
            tabId: state.tabId
          });

          chrome.runtime.sendMessage({
            action: 'showNotification',
            title: 'Найдено ключевое слово',
            message: `Найдено ключевое слово "${keyword}" на странице`
          });

          if (state.settings.autoClick) {
            handleAutoClick(keyword);
          }
          
          return;
        }
      }
      state.checkPerformed = true;
      console.log('Ключевые слова не найдены, продолжение обновления...');
    }
  
    function handleAutoClick(keyword) {
      if (state.refreshStopped) {
        console.log('Обработка автоматического клика для ключевого слова:', keyword);
        
        const walker = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_TEXT,
          null,
          false
        );

        const clickableElements = [];
        while (walker.nextNode()) {
          const node = walker.currentNode;
          if (node.textContent.toLowerCase().includes(keyword.toLowerCase())) {
            let element = node.parentElement;
            while (element && !['A', 'BUTTON'].includes(element.tagName)) {
              element = element.parentElement;
            }
            if (element && 
                ['A', 'BUTTON'].includes(element.tagName) && 
                !element.disabled && 
                element.offsetParent !== null) {
              clickableElements.push(element);
            }
          }
        }

        if (clickableElements.length > 0) {
          console.log('Клик по элементу, содержащему ключевое слово');
          const clickedElement = clickableElements[0];

          const handlePageLoadAfterClick = () => {
            if (document.readyState === 'complete') {
              setTimeout(() => {
                if (!state.alertShown) {
                  showGreenAlert(`Найдено ключевое слово: ${keyword}`);
                  state.alertShown = true;
                }
              }, 100);
              window.removeEventListener('load', handlePageLoadAfterClick);
            }
          };

          window.addEventListener('load', handlePageLoadAfterClick);
          clickedElement.click();
        }
      }
    }

    function showGreenAlert(message) {
      const alertBox = document.createElement('div');
      alertBox.className = 'green-alert';
      alertBox.textContent = message;
      document.body.appendChild(alertBox);

      setTimeout(() => {
        alertBox.remove();
      }, 5000);
    }

    function showNotification(title, message) {
      const notification = document.createElement('div');
      notification.className = 'auto-refresh-notification';
      notification.textContent = `${title}: ${message}`;
      document.body.appendChild(notification);
      
      setTimeout(() => notification.remove(), 10000);
    }
  
    function initializeInteractionDetection() {
      const stopRefreshOnInteraction = () => {
        if (!state.refreshStopped) {
          state.refreshStopped = true;
          chrome.runtime.sendMessage({ action: 'stopRefresh', tabId: state.tabId });
        }
      };
  
      document.addEventListener('click', stopRefreshOnInteraction);
      document.addEventListener('keypress', stopRefreshOnInteraction);
    }
  
    function stopRefresh() {
      if (state.timer) {
        state.timer.remove();
        state.timer = null;
      }
      state.settings = null;
      state.checkPerformed = false;
      state.refreshStopped = true;
      state.alertShown = false;
      state.refreshCount = 0;
    }

    if (document.readyState === 'complete') {
      chrome.runtime.sendMessage({ action: 'pageRefreshed' });
    } else {
      window.addEventListener('load', () => {
        chrome.runtime.sendMessage({ action: 'pageRefreshed' });
      }, { once: true });
    }
})();