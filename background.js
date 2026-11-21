// Bắt Chrome mở Side Panel mỗi khi click vào icon Extension
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

const SELECTION_CONTEXT_MENU_ITEMS = [
  {
    id: 'ss-explain-selection',
    title: '💡 Smart Study: Giải thích đoạn bôi đen',
    action: 'explain'
  },
  {
    id: 'ss-vocab-selection',
    title: '🇬🇧 Smart Study: Tra & Lưu từ vựng vào Sổ tay',
    action: 'vocab'
  },
  {
    id: 'ss-quiz-selection',
    title: '📝 Smart Study: Tạo Quiz nhanh từ đoạn chọn',
    action: 'quiz'
  }
];

const CONTEXT_MENU_ACTION_MAP = Object.fromEntries(
  SELECTION_CONTEXT_MENU_ITEMS.map((item) => [item.id, item.action])
);

function registerSelectionContextMenus() {
  if (!chrome.contextMenus) return;
  chrome.contextMenus.removeAll(() => {
    void chrome.runtime.lastError;
    SELECTION_CONTEXT_MENU_ITEMS.forEach((item) => {
      chrome.contextMenus.create(
        {
          id: item.id,
          title: item.title,
          contexts: ['selection']
        },
        () => {
          void chrome.runtime.lastError;
        }
      );
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  registerSelectionContextMenus();
});

registerSelectionContextMenus();

async function dispatchSelectionCopilotTask({ action, text, pageTitle, pageUrl }, senderTab) {
  const cleanText = String(text || '').trim().slice(0, 3500);
  if (cleanText.length < 2) {
    return { ok: false, error: 'Đoạn văn bản đã chọn quá ngắn.' };
  }

  const normalizedAction = ['explain', 'vocab', 'quiz'].includes(action) ? action : 'explain';
  const senderTabId = Number.isInteger(senderTab?.id) ? senderTab.id : null;
  const senderWindowId = Number.isInteger(senderTab?.windowId) ? senderTab.windowId : null;

  // Gọi chrome.sidePanel.open ngay trong luồng đồng bộ của user gesture trước khi await storage
  try {
    if (senderTabId !== null) {
      chrome.sidePanel.open({ tabId: senderTabId }).catch((err) => {
        if (senderWindowId !== null) {
          chrome.sidePanel.open({ windowId: senderWindowId }).catch(() => {});
        } else {
          console.warn('Không thể tự động mở Side Panel theo tabId:', err);
        }
      });
    } else if (senderWindowId !== null) {
      chrome.sidePanel.open({ windowId: senderWindowId }).catch((err) => {
        console.warn('Không thể tự động mở Side Panel theo windowId:', err);
      });
    }
  } catch (error) {
    console.warn('Lỗi khi gọi chrome.sidePanel.open:', error);
  }

  const pendingSelectionTask = {
    action: normalizedAction,
    text: cleanText,
    pageTitle: String(pageTitle || senderTab?.title || 'Trang web đang xem').trim(),
    pageUrl: String(pageUrl || senderTab?.url || '').trim(),
    timestamp: Date.now()
  };

  await chrome.storage.local.set({ pendingSelectionTask });
  return { ok: true, task: pendingSelectionTask };
}

if (chrome.contextMenus?.onClicked) {
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    const action = CONTEXT_MENU_ACTION_MAP[info?.menuItemId];
    if (!action) return;

    const selectedText = String(info?.selectionText || '').trim();
    if (!selectedText) return;

    void dispatchSelectionCopilotTask(
      {
        action,
        text: selectedText,
        pageTitle: tab?.title || '',
        pageUrl: info?.pageUrl || tab?.url || ''
      },
      tab
    );
  });
}

async function clearTabDomainCookiesAndReload(tabId, tabUrl) {
  const parsedUrl = new URL(tabUrl);
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('URL tab không hỗ trợ xóa cookie.');
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  const cookies = await chrome.cookies.getAll({});
  const matchingCookies = cookies.filter((cookie) => {
    const cookieDomain = cookie.domain.replace(/^\./, '').toLowerCase();
    return hostname === cookieDomain || hostname.endsWith(`.${cookieDomain}`);
  });

  let removedCount = 0;
  let failedCount = 0;

  for (const cookie of matchingCookies) {
    const cookieDomain = cookie.domain.replace(/^\./, '');
    const details = {
      url: `${cookie.secure ? 'https:' : 'http:'}//${cookieDomain}${cookie.path}`,
      name: cookie.name,
      storeId: cookie.storeId
    };
    if (cookie.partitionKey) {
      details.partitionKey = cookie.partitionKey;
    }

    try {
      if (await chrome.cookies.remove(details)) {
        removedCount += 1;
      } else {
        failedCount += 1;
      }
    } catch (error) {
      failedCount += 1;
      console.error(`Không thể xóa cookie "${cookie.name}":`, error);
    }
  }

  await chrome.tabs.reload(tabId, { bypassCache: true });
  return { ok: failedCount === 0, removedCount, failedCount };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'OPEN_SELECTION_COPILOT') {
    dispatchSelectionCopilotTask(
      {
        action: message.action,
        text: message.text,
        pageTitle: message.pageTitle || sender?.tab?.title || '',
        pageUrl: message.pageUrl || sender?.tab?.url || ''
      },
      sender?.tab
    )
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type !== 'CLEAR_TAB_COOKIES_AND_RELOAD') {
    return false;
  }

  if (!Number.isInteger(message.tabId) || typeof message.url !== 'string') {
    sendResponse({ ok: false, error: 'Thông tin tab không hợp lệ.' });
    return false;
  }

  clearTabDomainCookiesAndReload(message.tabId, message.url)
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});