// Gỡ listener cũ (nếu có) để tránh xung đột khi content.js được inject lại
if (window.__smartStudyMessageListener) {
  try {
    chrome.runtime.onMessage.removeListener(window.__smartStudyMessageListener);
  } catch (_) {
    // Bỏ qua nếu listener cũ không còn hiệu lực
  }
}

/**
 * Lấy tiêu đề của video YouTube hiện tại
 */
function getVideoTitle() {
  const titleEl = document.querySelector(
    'h1.ytd-watch-metadata yt-formatted-string, h1.title yt-formatted-string, #title h1 yt-formatted-string, #title h1'
  );
  if (titleEl && titleEl.textContent.trim()) {
    return titleEl.textContent.trim();
  }
  return document.title.replace(/\s*-\s*YouTube$/i, '').trim() || 'Video YouTube';
}

function formatTranscriptTimestamp(value) {
  const timestampValue = String(value || '').replace(/^\[|\]$/g, '').trim();
  const match = timestampValue.match(/(?:^|\s)(\d{1,3}:\d{2}(?::\d{2})?)(?:\s|$)/);
  if (!match) return '';

  const parts = match[1].split(':').map(Number);
  if (parts.some((part) => !Number.isInteger(part))) return '';
  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  const [minutes, seconds] = parts;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function getTranscriptSegmentLine(container) {
  const timestampElement = container.querySelector('.segment-timestamp, [class*="timestamp"]');
  const textElement = container.querySelector('.segment-text, .yt-core-attributed-string');
  let timestampText = timestampElement?.textContent || '';
  let transcriptText = (textElement?.textContent || container.textContent || '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!timestampText) {
    const leadingTimestamp = transcriptText.match(/^\s*(\d{1,3}:\d{2}(?::\d{2})?)/);
    if (leadingTimestamp) {
      timestampText = leadingTimestamp[1];
      transcriptText = transcriptText.slice(leadingTimestamp[0].length).trim();
    }
  }

  transcriptText = transcriptText
    .replace(/^\s*\d{1,3}:\d{2}(?::\d{2})?\s*/, '')
    .trim();
  if (!transcriptText || /^\d{1,3}:\d{2}(?::\d{2})?$/.test(transcriptText)) return '';

  const timestamp = formatTranscriptTimestamp(timestampText);
  return timestamp ? `[${timestamp}] ${transcriptText}` : transcriptText;
}

function getVideoMetadata(title = getVideoTitle()) {
  const channelElement = document.querySelector(
    'ytd-video-owner-renderer #channel-name a, #owner #channel-name a, #channel-name a, #channel-name'
  );
  const publishDateElement = document.querySelector(
    '#info-strings yt-formatted-string, #info-strings, #date-text, ytd-video-primary-info-renderer #info'
  );
  const video = document.querySelector('video');
  return {
    title,
    channelName: channelElement?.textContent?.replace(/\s+/g, ' ').trim() || '',
    publishDate: publishDateElement?.textContent?.replace(/\s+/g, ' ').trim() || '',
    videoUrl: window.location.href,
    currentSeconds: Math.floor(video?.currentTime || 0)
  };
}

/**
 * LỚP 0 (Ưu tiên cao nhất):
 * Quét trực tiếp các thẻ phụ đề đang hiển thị sẵn trên màn hình (khi người dùng đã mở bảng Transcript)
 */
function scrapeExistingTranscriptDOM() {
  const segmentContainers = document.querySelectorAll(
    'ytd-transcript-segment-renderer, transcript-segment-view-model'
  );
  if (segmentContainers.length > 0) {
    const lines = Array.from(segmentContainers)
      .map(getTranscriptSegmentLine)
      .filter(Boolean);
    if (lines.length > 0) return lines.join('\n');
  }

  // Danh sách các selector chứa lời thoại phụ đề từ cụ thể nhất đến tổng quát
  const primarySelectors = [
    'ytd-transcript-segment-renderer .segment-text',
    'ytd-transcript-segment-renderer yt-formatted-string',
    '.segment-text',
    'transcript-segment-view-model .yt-core-attributed-string',
    'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"] yt-formatted-string',
    'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"] .yt-core-attributed-string'
  ];

  for (const selector of primarySelectors) {
    const nodes = document.querySelectorAll(selector);
    if (nodes && nodes.length > 0) {
      const lines = Array.from(nodes)
        .map((node) => {
          const container = node.closest('ytd-transcript-segment-renderer, transcript-segment-view-model');
          if (container) return getTranscriptSegmentLine(container);
          const transcriptText = node.textContent.replace(/\s+/g, ' ').trim();
          const timestamp = formatTranscriptTimestamp(
            node.parentElement?.querySelector('.segment-timestamp')?.textContent
          );
          return transcriptText && timestamp ? `[${timestamp}] ${transcriptText}` : transcriptText;
        })
        .filter((text) => text.length > 0 && !/^\d{1,3}:\d{2}(:\d{2})?$/.test(text));

      if (lines.length > 0) {
        return lines.join('\n');
      }
    }
  }

  return '';
}

/**
 * Tìm nút "Show transcript" / "Hiện bản phiên âm" dưới phần mô tả video
 */
function findShowTranscriptButton() {
  const directBtn = document.querySelector(
    'ytd-video-description-transcript-section-renderer button, ' +
    'ytd-video-description-transcript-section-renderer yt-button-shape button, ' +
    'button[aria-label*="Show transcript" i], ' +
    'button[aria-label*="transcript" i], ' +
    'button[aria-label*="phiên âm" i], ' +
    'button[aria-label*="chép lời" i]'
  );
  if (directBtn) {
    return directBtn;
  }

  const candidateButtons = document.querySelectorAll(
    'ytd-watch-metadata button, ytd-structured-description-content-renderer button'
  );
  for (const btn of candidateButtons) {
    const label = `${btn.textContent || ''} ${btn.getAttribute('aria-label') || ''}`.toLowerCase();
    if (
      label.includes('show transcript') ||
      label.includes('transcript') ||
      label.includes('bản phiên âm') ||
      label.includes('bản chép lời')
    ) {
      return btn;
    }
  }
  return null;
}

/**
 * LỚP 1: Tự động bấm mở bảng Transcript và chờ DOM render
 */
async function autoOpenAndScrapeTranscript() {
  try {
    let transcriptBtn = findShowTranscriptButton();

    // Nếu mô tả đang thu gọn, bấm nút mở rộng (#expand) trước
    if (!transcriptBtn) {
      const expandBtn = document.querySelector(
        'ytd-watch-metadata tp-yt-paper-button#expand, #description-inline-expander #expand'
      );
      if (expandBtn) {
        expandBtn.click();
        await new Promise((resolve) => setTimeout(resolve, 400));
        transcriptBtn = findShowTranscriptButton();
      }
    }

    if (transcriptBtn) {
      transcriptBtn.click();
    } else {
      const panel = document.querySelector(
        '#panels ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]'
      );
      if (panel) {
        panel.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED');
      }
    }

    // Chờ tối đa 4 giây (kiểm tra mỗi 250ms) cho tới khi các thẻ phụ đề xuất hiện
    for (let i = 0; i < 16; i++) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const text = scrapeExistingTranscriptDOM();
      if (text) {
        return text;
      }
    }
  } catch (err) {
    console.warn('Không thể tự động mở bảng Transcript:', err);
  }
  return '';
}

/**
 * Lắng nghe message từ sidebar.js với cấu trúc BẮT BUỘC có return true và try...catch tổng
 */
window.__smartStudyMessageListener = (message, sender, sendResponse) => {
  if (message?.action === 'SEEK_YOUTUBE_VIDEO') {
    const video = document.querySelector('video');
    const seconds = Number(message.seconds);
    if (!video || !Number.isFinite(seconds) || seconds < 0) {
      sendResponse({ success: false, error: 'Không thể tua video đến mốc thời gian đã chọn.' });
      return false;
    }

    try {
      video.currentTime = seconds;
      const playResult = video.play();
      if (playResult && typeof playResult.then === 'function') {
        playResult.then(
          () => sendResponse({ success: true }),
          (error) => sendResponse({ success: false, error: error?.message || 'Không thể phát video.' })
        );
        return true;
      }
      sendResponse({ success: true });
    } catch (error) {
      sendResponse({ success: false, error: error?.message || 'Không thể tua video.' });
    }
    return false;
  }

  if (message?.type === 'GET_YOUTUBE_METADATA') {
    sendResponse({ success: true, ...getVideoMetadata() });
    return false;
  }

  if (message?.type !== 'GET_YOUTUBE_DATA') {
    return false;
  }

  (async () => {
    try {
      const title = getVideoTitle();
      const metadata = getVideoMetadata(title);

      // 1. LỚP 0 (Ưu tiên cao nhất): Nếu bảng Transcript đã mở sẵn trên màn hình, gom text và trả về ngay lập tức
      let transcript = scrapeExistingTranscriptDOM();

      // 2. LỚP 1: Nếu chưa có trên màn hình, thử tự động bấm mở bảng Transcript
      if (!transcript) {
        transcript = await autoOpenAndScrapeTranscript();
      }

      if (!transcript) {
        sendResponse({
          success: false,
          title,
          ...metadata,
          error: 'Không tìm thấy phụ đề! Bạn hãy bấm mở bảng "Hiện bản chép lời" (Show transcript) dưới mô tả video rồi thử lại nhé.'
        });
        return;
      }

      sendResponse({
        success: true,
        title,
        transcript,
        ...metadata,
        data: { title, transcript, ...metadata }
      });
    } catch (err) {
      sendResponse({
        success: false,
        error: err?.message || 'Đã xảy ra lỗi không xác định khi lấy phụ đề YouTube.'
      });
    }
  })();

  // BẮT BUỘC return true ở cuối hàm listener để giữ kênh kết nối bất đồng bộ với sidebar.js
  return true;
};

chrome.runtime.onMessage.addListener(window.__smartStudyMessageListener);

/**
 * SPRINT 12: Context-Aware Selection Copilot — Thanh công cụ nổi cách ly CSS bằng Shadow DOM
 */
(function initSmartStudySelectionCopilot() {
  if (window.__smartStudySelectionCopilotInitialized) {
    return;
  }
  window.__smartStudySelectionCopilotInitialized = true;

  const HOST_ID = 'smart-study-copilot-host';
  let hostEl = document.getElementById(HOST_ID);
  let shadowRoot = null;
  let toolbarEl = null;
  let actionsWrapEl = null;
  let toastEl = null;
  let activeSelectedText = '';
  let hideTimerId = null;
  let selectionDebounceId = null;

  function ensureCopilotShadowDOM() {
    hostEl = document.getElementById(HOST_ID);
    if (hostEl && hostEl.shadowRoot && toolbarEl) {
      return;
    }
    if (hostEl) {
      hostEl.remove();
    }

    hostEl = document.createElement('div');
    hostEl.id = HOST_ID;
    hostEl.style.cssText =
      'position: fixed !important; top: 0 !important; left: 0 !important; width: 0 !important; height: 0 !important; z-index: 2147483647 !important; pointer-events: none !important;';

    shadowRoot = hostEl.attachShadow({ mode: 'open' });

    const styleEl = document.createElement('style');
    styleEl.textContent = `
      :host {
        all: initial;
      }
      .ss-copilot-toolbar {
        position: fixed;
        z-index: 2147483647;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 5px 6px;
        border-radius: 999px;
        background: rgba(15, 23, 42, 0.96);
        border: 1px solid rgba(148, 163, 184, 0.28);
        box-shadow: 0 10px 25px -5px rgba(15, 23, 42, 0.45), 0 4px 10px -2px rgba(15, 23, 42, 0.25);
        backdrop-filter: blur(8px);
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 12.5px;
        line-height: 1;
        color: #f8fafc;
        pointer-events: auto;
        user-select: none;
        -webkit-user-select: none;
        opacity: 0;
        transform: translateY(6px) scale(0.96);
        transition: opacity 0.15s cubic-bezier(0.2, 0.8, 0.2, 1), transform 0.15s cubic-bezier(0.2, 0.8, 0.2, 1);
      }
      .ss-copilot-toolbar.is-visible {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
      .ss-copilot-toolbar[hidden] {
        display: none !important;
      }
      .ss-copilot-actions {
        display: inline-flex;
        align-items: center;
        gap: 3px;
      }
      .ss-copilot-actions[hidden] {
        display: none !important;
      }
      .ss-copilot-btn {
        appearance: none;
        border: none;
        background: transparent;
        color: #f8fafc;
        font-family: inherit;
        font-size: 12px;
        font-weight: 600;
        padding: 6px 10px;
        border-radius: 999px;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        white-space: nowrap;
        transition: background-color 0.14s ease, color 0.14s ease, transform 0.1s ease;
      }
      .ss-copilot-btn:hover {
        background: rgba(59, 130, 246, 0.24);
        color: #93c5fd;
      }
      .ss-copilot-btn:active {
        transform: scale(0.95);
      }
      .ss-copilot-divider {
        width: 1px;
        height: 15px;
        background: rgba(148, 163, 184, 0.28);
      }
      .ss-copilot-toast {
        padding: 6px 12px;
        color: #4ade80;
        font-size: 12px;
        font-weight: 700;
        white-space: nowrap;
        letter-spacing: 0.01em;
      }
      .ss-copilot-toast[hidden] {
        display: none !important;
      }
    `;

    toolbarEl = document.createElement('div');
    toolbarEl.className = 'ss-copilot-toolbar';
    toolbarEl.hidden = true;
    toolbarEl.setAttribute('role', 'toolbar');
    toolbarEl.setAttribute('aria-label', 'Smart Study Selection Copilot');

    actionsWrapEl = document.createElement('div');
    actionsWrapEl.className = 'ss-copilot-actions';

    const buttonsConfig = [
      { action: 'explain', label: '💡 Giải thích' },
      { action: 'vocab', label: '🇬🇧 Lưu từ vựng' },
      { action: 'quiz', label: '📝 Tạo Quiz' }
    ];

    buttonsConfig.forEach((cfg, index) => {
      if (index > 0) {
        const divider = document.createElement('span');
        divider.className = 'ss-copilot-divider';
        divider.setAttribute('aria-hidden', 'true');
        actionsWrapEl.appendChild(divider);
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ss-copilot-btn';
      btn.dataset.action = cfg.action;
      btn.textContent = cfg.label;
      btn.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        triggerCopilotAction(cfg.action);
      });
      actionsWrapEl.appendChild(btn);
    });

    toastEl = document.createElement('div');
    toastEl.className = 'ss-copilot-toast';
    toastEl.textContent = '✓ Đã gửi sang Smart Study';
    toastEl.hidden = true;

    toolbarEl.append(actionsWrapEl, toastEl);
    shadowRoot.append(styleEl, toolbarEl);
    (document.documentElement || document.body).appendChild(hostEl);
  }

  function isEditableTarget(node) {
    if (!node) return false;
    const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!el || typeof el.closest !== 'function') return false;
    if (el.closest('input, textarea, [contenteditable="true"], [contenteditable=""]')) {
      return true;
    }
    return Boolean(el.isContentEditable);
  }

  function hideCopilotToolbar(immediate = false) {
    if (hideTimerId) {
      clearTimeout(hideTimerId);
      hideTimerId = null;
    }
    if (!toolbarEl || toolbarEl.hidden) return;
    toolbarEl.classList.remove('is-visible');
    if (immediate) {
      toolbarEl.hidden = true;
      if (actionsWrapEl) actionsWrapEl.hidden = false;
      if (toastEl) toastEl.hidden = true;
      return;
    }
    hideTimerId = setTimeout(() => {
      if (toolbarEl) {
        toolbarEl.hidden = true;
      }
      if (actionsWrapEl) actionsWrapEl.hidden = false;
      if (toastEl) toastEl.hidden = true;
    }, 150);
  }

  function triggerCopilotAction(action) {
    const textToSend = (
      activeSelectedText ||
      (window.getSelection ? window.getSelection().toString() : '') ||
      ''
    )
      .replace(/\s+/g, ' ')
      .trim();

    if (textToSend.length < 2 || textToSend.length > 3500) {
      hideCopilotToolbar(true);
      return;
    }

    if (actionsWrapEl && toastEl) {
      actionsWrapEl.hidden = true;
      toastEl.hidden = false;
    }

    try {
      chrome.runtime.sendMessage(
        {
          type: 'OPEN_SELECTION_COPILOT',
          action,
          text: textToSend,
          pageTitle: document.title || '',
          pageUrl: window.location.href
        },
        () => {
          void chrome.runtime.lastError;
        }
      );
    } catch (_) {
      // Bỏ qua nếu extension context vừa reload
    }

    if (hideTimerId) clearTimeout(hideTimerId);
    hideTimerId = setTimeout(() => {
      hideCopilotToolbar(false);
    }, 900);
  }

  function evaluateSelectionAndShowToolbar() {
    const selection = window.getSelection ? window.getSelection() : null;
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      hideCopilotToolbar();
      return;
    }

    if (
      isEditableTarget(selection.anchorNode) ||
      isEditableTarget(selection.focusNode) ||
      isEditableTarget(document.activeElement)
    ) {
      hideCopilotToolbar(true);
      return;
    }

    const rawText = selection.toString().replace(/\s+/g, ' ').trim();
    if (rawText.length < 2 || rawText.length > 3500) {
      hideCopilotToolbar();
      return;
    }

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      hideCopilotToolbar();
      return;
    }

    activeSelectedText = rawText;
    ensureCopilotShadowDOM();

    if (hideTimerId) {
      clearTimeout(hideTimerId);
      hideTimerId = null;
    }
    actionsWrapEl.hidden = false;
    toastEl.hidden = true;
    toolbarEl.hidden = false;

    const toolbarRect = toolbarEl.getBoundingClientRect();
    const toolbarWidth = toolbarRect.width || 276;
    const toolbarHeight = toolbarRect.height || 36;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1024;

    let top = rect.top - toolbarHeight - 10;
    if (top < 8) {
      top = Math.min((window.innerHeight || 768) - toolbarHeight - 8, rect.bottom + 10);
    }
    let left = rect.left + rect.width / 2 - toolbarWidth / 2;
    left = Math.max(8, Math.min(viewportWidth - toolbarWidth - 8, left));

    toolbarEl.style.top = `${Math.round(top)}px`;
    toolbarEl.style.left = `${Math.round(left)}px`;

    requestAnimationFrame(() => {
      toolbarEl?.classList.add('is-visible');
    });
  }

  document.addEventListener(
    'mouseup',
    (event) => {
      if (hostEl && (event.target === hostEl || hostEl.contains(event.target))) {
        return;
      }
      if (selectionDebounceId) clearTimeout(selectionDebounceId);
      selectionDebounceId = setTimeout(evaluateSelectionAndShowToolbar, 30);
    },
    true
  );

  document.addEventListener(
    'keyup',
    (event) => {
      if (event.key === 'Escape') {
        hideCopilotToolbar(true);
        return;
      }
      if (event.shiftKey || ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        if (selectionDebounceId) clearTimeout(selectionDebounceId);
        selectionDebounceId = setTimeout(evaluateSelectionAndShowToolbar, 40);
      }
    },
    true
  );

  document.addEventListener(
    'mousedown',
    (event) => {
      if (hostEl && (event.target === hostEl || event.composedPath?.().includes(hostEl))) {
        return;
      }
      hideCopilotToolbar(true);
    },
    true
  );

  window.addEventListener(
    'scroll',
    () => {
      if (toolbarEl && !toolbarEl.hidden) {
        hideCopilotToolbar(true);
      }
    },
    { capture: true, passive: true }
  );
})();
