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
  const durationSeconds = Number.isFinite(video?.duration) && video.duration > 0
    ? Math.floor(video.duration)
    : 0;
  return {
    title,
    channelName: channelElement?.textContent?.replace(/\s+/g, ' ').trim() || '',
    publishDate: publishDateElement?.textContent?.replace(/\s+/g, ' ').trim() || '',
    videoUrl: window.location.href,
    currentSeconds: Math.floor(video?.currentTime || 0),
    durationSeconds
  };
}

/**
 * LỚP 0:
 * Quét trực tiếp các thẻ segment phụ đề THỰC SỰ đang hiển thị trong bảng Transcript
 * (TUYỆT ĐỐI không quét thẻ tiêu đề panel "Bản chép lời" / nút UI)
 */
function scrapeExistingTranscriptDOM() {
  const segmentContainers = document.querySelectorAll(
    'ytd-transcript-segment-renderer, transcript-segment-view-model'
  );
  if (segmentContainers.length === 0) {
    return '';
  }

  const lines = Array.from(segmentContainers)
    .map(getTranscriptSegmentLine)
    .filter((line) => line && !/^(bản chép lời|transcript|show transcript|tiếng anh|tiếng việt)$/i.test(line.trim()));

  // Chỉ chấp nhận khi có ít nhất 2 phân đoạn thực sự (tránh nhầm tiêu đề panel hoặc 1 dòng lỗi)
  if (lines.length >= 2) {
    return lines.join('\n');
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
 * LỚP 2: Tự động bấm mở bảng Transcript, chờ tối đa 1.5s, đọc toàn bộ segment và đóng lại gọn gàng
 */
async function autoOpenAndScrapeTranscript() {
  let openedByScript = false;
  try {
    let transcriptBtn = findShowTranscriptButton();

    // Nếu mô tả đang thu gọn, bấm nút mở rộng (#expand) trước
    if (!transcriptBtn) {
      const expandBtn = document.querySelector(
        'ytd-watch-metadata tp-yt-paper-button#expand, #description-inline-expander #expand'
      );
      if (expandBtn) {
        expandBtn.click();
        await new Promise((resolve) => setTimeout(resolve, 500));
        transcriptBtn = findShowTranscriptButton();
      }
    }

    if (transcriptBtn) {
      transcriptBtn.click();
      openedByScript = true;
    } else {
      const panel = document.querySelector(
        '#panels ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]'
      );
      if (panel) {
        panel.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED');
        openedByScript = true;
      }
    }

    // Chờ tối đa 4 giây (16 lần x 250ms) và đợi số lượng segment ổn định (tránh đọc sớm khi mới render 1-2 dòng đầu)
    let lastCount = 0;
    let stableTicks = 0;
    let bestText = '';
    for (let i = 0; i < 16; i++) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const nodes = document.querySelectorAll(
        'ytd-transcript-segment-renderer, transcript-segment-view-model'
      );
      const count = nodes.length;
      const text = scrapeExistingTranscriptDOM();
      if (text && text.length >= bestText.length) {
        bestText = text;
      }
      if (count > 0) {
        if (count === lastCount) {
          stableTicks += 1;
          if (stableTicks >= 2 && bestText) {
            return bestText;
          }
        } else {
          lastCount = count;
          stableTicks = 0;
        }
      }
    }
    if (bestText) {
      return bestText;
    }
  } catch (err) {
    console.warn('Không thể tự động mở bảng Transcript:', err);
  } finally {
    // Đóng lại bảng Transcript gọn gàng nếu chính script vừa mở ngầm
    if (openedByScript) {
      try {
        const panel = document.querySelector(
          'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]'
        );
        const closeBtn = panel?.querySelector(
          'button[aria-label*="Close" i], button[aria-label*="Đóng" i], #visibility-button button'
        );
        if (closeBtn) {
          closeBtn.click();
        } else if (panel) {
          panel.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN');
        }
      } catch (_) {
        // Bỏ qua lỗi khi đóng panel
      }
    }
  }
  return '';
}

function formatSecondsToTimestamp(totalSec) {
  const sec = Math.max(0, Math.floor(Number(totalSec) || 0));
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const seconds = sec % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function getYoutubeVideoDescription() {
  const descEl = document.querySelector(
    'ytd-text-inline-expander #attributed-snippet-text, #description-inline-expander yt-attributed-string, ytd-watch-metadata #description'
  );
  return descEl ? (descEl.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 2000) : '';
}

function decodeHtmlEntities(raw) {
  if (!raw) return '';
  const textarea = document.createElement('textarea');
  textarea.innerHTML = String(raw);
  return textarea.value;
}

/**
 * LỚP 1 (Nguồn Caption Tracks trực tiếp từ MAIN world ytInitialPlayerResponse / thẻ <script> HTML):
 * Lấy phụ đề có sẵn hoặc phụ đề tự động (ASR) của video hiện tại mà không phụ thuộc nút UI.
 */
function extractCaptionTracksFromPageHtml(htmlText) {
  if (!htmlText) return [];
  const marker = '"captionTracks":';
  const startIdx = htmlText.indexOf(marker);
  if (startIdx < 0) return [];
  const arrStart = htmlText.indexOf('[', startIdx + marker.length);
  if (arrStart < 0) return [];

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = arrStart; i < htmlText.length; i += 1) {
    const ch = htmlText[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '[') {
      depth += 1;
    } else if (ch === ']') {
      depth -= 1;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(htmlText.slice(arrStart, i + 1));
          return Array.isArray(parsed) ? parsed : [];
        } catch (_) {
          return [];
        }
      }
    }
  }
  return [];
}

function normalizeLangBase(code) {
  return String(code || '').trim().toLowerCase().split(/[-_]/)[0] || '';
}

function isAutoTranslatedTrackUrl(url) {
  return /[?&]tlang=[^&]+/i.test(String(url || ''));
}

function inferOriginalLanguageFromTracks(tracks, mainWorldData = null) {
  const explicitDefault = normalizeLangBase(mainWorldData?.defaultAudioLanguage);
  if (explicitDefault) return explicitDefault;

  if (Array.isArray(tracks) && tracks.length > 0) {
    // 1. Track được gắn nhãn gốc (original / gốc) rõ ràng từ YouTube
    const labeledOrig = tracks.find((t) =>
      /\((?:original|gốc|원본|オリジナル)\)/i.test(String(t?.name || '')) && !isAutoTranslatedTrackUrl(t?.baseUrl)
    );
    if (labeledOrig?.languageCode) return normalizeLangBase(labeledOrig.languageCode);

    // 2. Track ASR (vssId bắt đầu bằng "a." hoặc kind === "asr") phản ánh trực tiếp ngôn ngữ âm thanh gốc
    const asrTracks = tracks.filter(
      (t) => (t?.kind === 'asr' || String(t?.vssId || '').startsWith('a.')) && !isAutoTranslatedTrackUrl(t?.baseUrl)
    );
    if (asrTracks.length === 1 && asrTracks[0]?.languageCode) {
      return normalizeLangBase(asrTracks[0].languageCode);
    }

    // 3. Nếu chỉ có duy nhất 1 ngôn ngữ phụ đề không dịch máy
    const untranslatedLangs = Array.from(
      new Set(
        tracks
          .filter((t) => !isAutoTranslatedTrackUrl(t?.baseUrl))
          .map((t) => normalizeLangBase(t?.languageCode))
          .filter(Boolean)
      )
    );
    if (untranslatedLangs.length === 1) {
      return untranslatedLangs[0];
    }
  }
  return '';
}

function sortCaptionTracksByPriority(tracks, preferredOriginalLang = '') {
  const origBase = normalizeLangBase(preferredOriginalLang);
  const scoreTrack = (t) => {
    const langBase = normalizeLangBase(t?.languageCode);
    const isAsr = t?.kind === 'asr' || String(t?.vssId || '').startsWith('a.');
    const isTranslated = isAutoTranslatedTrackUrl(t?.baseUrl);
    const isLabeledOriginal = /\((?:original|gốc)\)/i.test(String(t?.name || ''));

    let score = isTranslated ? 10 : 50;
    if (isLabeledOriginal && !isTranslated) score += 45;

    if (origBase) {
      if (langBase === origBase && !isTranslated) {
        score += isAsr ? 34 : 42;
      } else if (langBase === 'en' && !isTranslated) {
        score += isAsr ? 14 : 20;
      } else if (langBase === 'vi' && !isTranslated) {
        score += isAsr ? 12 : 18;
      }
    } else {
      // Không rõ ngôn ngữ gốc: bảo thủ, ưu tiên bản không dịch máy, giữ cân bằng nguồn học thuật phổ biến
      if (!isTranslated) {
        if (!isAsr && langBase === 'en') score += 26;
        else if (!isAsr && langBase === 'vi') score += 25;
        else if (!isAsr) score += 22;
        else if (langBase === 'en') score += 20;
        else if (langBase === 'vi') score += 19;
        else score += 15;
      }
    }
    return score;
  };
  return [...tracks].sort((a, b) => scoreTrack(b) - scoreTrack(a));
}

function evaluateYoutubeTranscriptCoverage(text, totalVideoDur = 0) {
  const clean = String(text || '').trim();
  if (!clean) {
    return {
      status: 'empty',
      isSufficient: false,
      qualityScore: 0,
      lineCount: 0,
      totalWords: 0,
      firstSec: 0,
      lastSec: 0,
      endReachRatio: 0,
      occupiedBucketRatio: 0,
      maxInternalGapSec: 0
    };
  }

  const rawLines = clean.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const timestamps = [];
  let totalWords = 0;

  for (const line of rawLines) {
    const m = line.match(/^\[(\d{1,3}):(\d{2})(?::(\d{2}))?\]\s*(.*)$/);
    const body = m ? m[4] : line;
    const words = body.trim() ? body.trim().split(/\s+/).length : 0;
    totalWords += words;
    if (m) {
      const sec = m[3] !== undefined
        ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
        : Number(m[1]) * 60 + Number(m[2]);
      if (Number.isFinite(sec) && sec >= 0) {
        timestamps.push(sec);
      }
    }
  }

  const lineCount = rawLines.length;
  const dur = Math.max(0, Number(totalVideoDur) || 0);
  const firstSec = timestamps.length ? timestamps[0] : 0;
  const lastSec = timestamps.length ? timestamps.reduce((mx, v) => (v > mx ? v : mx), 0) : 0;

  let maxInternalGapSec = 0;
  let totalLargeGapSec = 0;
  let largeGapCount = 0;
  for (let i = 1; i < timestamps.length; i += 1) {
    const gap = timestamps[i] - timestamps[i - 1];
    if (gap > maxInternalGapSec) maxInternalGapSec = gap;
    if (gap > 180) {
      totalLargeGapSec += gap;
      largeGapCount += 1;
    }
  }

  // Trường hợp chưa rõ thời lượng video từ trình phát
  if (dur <= 0) {
    const ok = lineCount >= 3 && totalWords >= 18;
    return {
      status: ok ? 'complete' : 'partial',
      isSufficient: ok,
      missingKind: ok ? 'none' : 'sparse_fragments',
      qualityScore: ok ? Math.min(85, 50 + Math.min(35, lineCount)) : Math.min(40, lineCount * 10),
      lineCount,
      totalWords,
      firstSec,
      lastSec,
      endReachRatio: ok ? 1 : 0,
      occupiedBucketRatio: ok ? 1 : 0,
      maxInternalGapSec
    };
  }

  const endReachRatio = Math.min(1, lastSec / dur);
  const wordsPerMin = totalWords / Math.max(0.25, dur / 60);

  // Video rất ngắn (< 60 giây: ví dụ 15s, 30s, 45s)
  if (dur < 60) {
    const hasMeaningfulShortSpeech =
      lineCount >= 1 && (totalWords >= Math.max(3, Math.floor(dur * 0.25)) || endReachRatio >= 0.35 || clean.length >= 24);
    const status = hasMeaningfulShortSpeech ? (wordsPerMin < 30 ? 'sparse_valid' : 'complete') : 'partial';
    return {
      status,
      isSufficient: hasMeaningfulShortSpeech,
      missingKind: hasMeaningfulShortSpeech ? 'none' : 'ending',
      qualityScore: hasMeaningfulShortSpeech ? 82 + Math.min(18, endReachRatio * 18) : 25,
      lineCount,
      totalWords,
      firstSec,
      lastSec,
      endReachRatio,
      occupiedBucketRatio: hasMeaningfulShortSpeech ? 1 : endReachRatio,
      maxInternalGapSec
    };
  }

  // Video từ 1 phút đến 12+ giờ: chia tới 24 xô thời gian + kiểm tra đầu, cuối & ngưỡng khoảng trống tuyệt đối lẫn tỷ lệ
  const bucketCount = Math.min(24, Math.max(4, Math.floor(dur / 180)));
  const bucketSize = dur / bucketCount;
  const occupied = new Set();
  for (const sec of timestamps) {
    const idx = Math.min(bucketCount - 1, Math.max(0, Math.floor(sec / bucketSize)));
    occupied.add(idx);
  }
  const occupiedBucketRatio = timestamps.length ? occupied.size / bucketCount : 0;
  const trailingGapSec = Math.max(0, dur - lastSec);
  const allowedTrailingGapSec = dur >= 1800 ? Math.min(420, dur * 0.12) : Math.max(45, dur * 0.22);
  const reachesNearEnd = trailingGapSec <= allowedTrailingGapSec || endReachRatio >= 0.82;
  const startsReasonablyEarly = firstSec <= Math.max(90, Math.min(600, dur * 0.2));

  // Chốt kép (tỷ lệ + trần giây tuyệt đối) chống dương tính giả khi mất phụ đề 15p–5h ở giữa video dài
  const allowedCompleteGapSec = Math.min(420, Math.max(210, dur * 0.24));
  const noMassiveHollowMiddle = maxInternalGapSec <= allowedCompleteGapSec && totalLargeGapSec <= Math.max(240, dur * 0.2);

  // Cho phép khoảng lặng thực sự (demo code 3–8p hoặc 1 quãng nghỉ giải lao ngắn <= 12p trên sự kiện >= 2h phủ kín >= 85% xô)
  const allowedSparseGapSec =
    dur >= 7200 && largeGapCount <= 1 && occupiedBucketRatio >= 0.85
      ? 720
      : Math.min(480, Math.max(270, dur * 0.28));
  const fitsGenuineSparseSilence =
    maxInternalGapSec <= allowedSparseGapSec &&
    totalLargeGapSec <= Math.min(1200, Math.max(300, dur * 0.22));

  let status = 'partial';
  let isSufficient = false;

  if (reachesNearEnd && startsReasonablyEarly && occupiedBucketRatio >= 0.58 && noMassiveHollowMiddle && lineCount >= 4) {
    status = 'complete';
    isSufficient = true;
  } else if (
    reachesNearEnd &&
    firstSec <= Math.max(180, Math.min(900, dur * 0.28)) &&
    occupiedBucketRatio >= 0.5 &&
    fitsGenuineSparseSilence &&
    lineCount >= 3
  ) {
    status = 'sparse_valid';
    isSufficient = true;
  }

  let missingKind = 'none';
  if (!isSufficient) {
    if (!reachesNearEnd) {
      missingKind = 'ending';
    } else if (!startsReasonablyEarly) {
      missingKind = 'opening';
    } else if (!noMassiveHollowMiddle || !fitsGenuineSparseSilence) {
      missingKind = 'middle';
    } else {
      missingKind = 'sparse_fragments';
    }
  }

  const gapPenalty = !isSufficient && maxInternalGapSec > allowedCompleteGapSec
    ? Math.min(42, Math.round((maxInternalGapSec / Math.max(60, dur)) * 80) + 12)
    : 0;
  const rawQualityScore = Math.round(
    occupiedBucketRatio * 48 +
      endReachRatio * 32 +
      (startsReasonablyEarly ? 10 : 0) +
      Math.min(10, (lineCount / Math.max(5, dur / 30)) * 10) -
      gapPenalty
  );

  return {
    status,
    isSufficient,
    missingKind,
    qualityScore: Math.max(1, Math.min(100, rawQualityScore)),
    lineCount,
    totalWords,
    firstSec,
    lastSec,
    endReachRatio: +endReachRatio.toFixed(3),
    occupiedBucketRatio: +occupiedBucketRatio.toFixed(3),
    maxInternalGapSec: Math.round(maxInternalGapSec)
  };
}

async function fetchSingleCaptionTrack(track) {
  const rawBaseUrl = String(track?.baseUrl || '').replace(/&amp;/g, '&').trim();
  if (!rawBaseUrl) return '';

  // Ưu tiên định dạng json3 gọn nhẹ, có sẵn tStartMs
  const json3Url = rawBaseUrl.includes('fmt=')
    ? rawBaseUrl.replace(/fmt=[^&]+/, 'fmt=json3')
    : `${rawBaseUrl}&fmt=json3`;

  try {
    const jsonResp = await fetch(json3Url, { credentials: 'include' });
    if (jsonResp.ok) {
      const rawBody = await jsonResp.text();
      if (rawBody && rawBody.trim().startsWith('{')) {
        const data = JSON.parse(rawBody);
        const events = Array.isArray(data?.events) ? data.events : [];
        const lines = [];
        for (const ev of events) {
          if (!Array.isArray(ev?.segs)) continue;
          const text = ev.segs
            .map((s) => String(s?.utf8 || ''))
            .join('')
            .replace(/\s+/g, ' ')
            .trim();
          if (!text) continue;
          const ts = formatSecondsToTimestamp((Number(ev.tStartMs) || 0) / 1000);
          lines.push(`[${ts}] ${text}`);
        }
        if (lines.length > 0) return lines.join('\n');
      }
    }
  } catch (_) {
    // Thử fallback XML bên dưới
  }

  // Fallback XML timedtext
  try {
    const xmlResp = await fetch(rawBaseUrl, { credentials: 'include' });
    if (xmlResp.ok) {
      const xmlText = await xmlResp.text();
      if (xmlText && xmlText.includes('<text')) {
        const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
        const textNodes = Array.from(doc.querySelectorAll('text'));
        const lines = textNodes
          .map((node) => {
            const text = decodeHtmlEntities(node.textContent || '')
              .replace(/\s+/g, ' ')
              .trim();
            if (!text) return '';
            const startSec = parseFloat(node.getAttribute('start') || '0');
            return `[${formatSecondsToTimestamp(startSec)}] ${text}`;
          })
          .filter(Boolean);
        if (lines.length > 0) return lines.join('\n');
      }
    }
  } catch (_) {
    // Bỏ qua track lỗi
  }

  return '';
}

async function fetchTranscriptFromCaptionTracks(mainWorldData = null, totalVideoDur = 0, preferredOriginalLang = '') {
  try {
    let tracks = Array.isArray(mainWorldData?.captionTracks) ? mainWorldData.captionTracks : [];

    // Nếu MAIN world chưa có, quét các thẻ <script> trong DOM
    if (!tracks.length) {
      const scripts = Array.from(document.querySelectorAll('script'));
      for (const script of scripts) {
        const text = script.textContent || '';
        if (text.includes('"captionTracks"')) {
          tracks = extractCaptionTracksFromPageHtml(text);
          if (tracks.length > 0) break;
        }
      }
    }

    // Nếu SPA vừa điều hướng sang video mới nên script cũ không khớp videoId, tải lại HTML trang watch hiện tại
    const currentVideoId = new URLSearchParams(window.location.search).get('v') || '';
    const tracksMatchCurrentVideo = tracks.some(
      (t) => typeof t?.baseUrl === 'string' && (!currentVideoId || t.baseUrl.includes(currentVideoId))
    );
    if (!tracks.length || !tracksMatchCurrentVideo) {
      const pageResp = await fetch(window.location.href, { credentials: 'include' });
      if (pageResp.ok) {
        const pageHtml = await pageResp.text();
        const freshTracks = extractCaptionTracksFromPageHtml(pageHtml);
        if (freshTracks.length > 0) tracks = freshTracks;
      }
    }

    if (!tracks.length) return { text: '', lang: '', inferredOrigLang: '' };

    const inferredOrigLang = preferredOriginalLang || inferOriginalLanguageFromTracks(tracks, mainWorldData);
    const prioritizedTracks = sortCaptionTracksByPriority(tracks, inferredOrigLang);

    let bestCandidate = { text: '', lang: '', score: -1, inferredOrigLang };
    for (const track of prioritizedTracks.slice(0, 3)) {
      // Nếu track bị dính tham số dịch máy tlang=, thử bản gốc trước khi dùng bản dịch
      const cleanTrack = isAutoTranslatedTrackUrl(track?.baseUrl)
        ? { ...track, baseUrl: String(track.baseUrl).replace(/([?&])tlang=[^&]+&?/gi, '$1').replace(/[?&]$/, '') }
        : track;
      const transcriptText = (await fetchSingleCaptionTrack(cleanTrack)) || (cleanTrack !== track ? await fetchSingleCaptionTrack(track) : '');
      if (!transcriptText) continue;

      const trackLang = normalizeLangBase(track?.languageCode);
      const cov = evaluateYoutubeTranscriptCoverage(transcriptText, totalVideoDur);
      const langAlignBonus =
        inferredOrigLang && trackLang === inferredOrigLang && !isAutoTranslatedTrackUrl(cleanTrack?.baseUrl) ? 12 : 0;
      const combinedScore = cov.qualityScore + langAlignBonus;

      if (combinedScore > bestCandidate.score) {
        bestCandidate = {
          text: transcriptText,
          lang: trackLang,
          score: combinedScore,
          inferredOrigLang
        };
      }
      // Dừng sớm có giới hạn ngay khi tìm được bản đầy đủ đúng ngôn ngữ ưu tiên (tránh request thừa)
      if (cov.status === 'complete' && (!inferredOrigLang || trackLang === inferredOrigLang)) {
        break;
      }
    }
    return bestCandidate;
  } catch (err) {
    console.warn('Không thể lấy phụ đề từ captionTracks:', err);
  }
  return { text: '', lang: '', inferredOrigLang: preferredOriginalLang || '' };
}

/**
 * LỚP 3 (Fallback DOM Caption): Gom phụ đề đang hiển thị trực tiếp trên trình phát (.ytp-caption-segment)
 * hoặc tiện ích phụ đề song ngữ (Language Reactor .lln-subs)
 */
function scrapeActivePlayerCaptions() {
  const captionSelectors = [
    '.ytp-caption-window-container .ytp-caption-segment',
    '.lln-subs .lln-sub-text',
    '.lln-subs',
    '.lln-subs-wrap'
  ];

  const collected = [];
  for (const selector of captionSelectors) {
    const nodes = document.querySelectorAll(selector);
    if (!nodes.length) continue;
    const text = Array.from(nodes)
      .map((n) => (n.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text && !collected.includes(text)) {
      collected.push(text);
    }
  }

  if (!collected.length) return '';
  const video = document.querySelector('video');
  const ts = formatSecondsToTimestamp(video?.currentTime || 0);
  return `[${ts}] ${collected.join(' | ')}`;
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
      const mainWorldData = message?.mainWorldData || null;
      const title = String(mainWorldData?.title || '').trim() || getVideoTitle();
      const metadata = getVideoMetadata(title);
      if (!metadata.channelName && mainWorldData?.author) {
        metadata.channelName = String(mainWorldData.author).trim();
      }
      const description =
        String(mainWorldData?.description || '').replace(/\s+/g, ' ').trim().slice(0, 2000) ||
        getYoutubeVideoDescription();

      const getTranscriptMaxSeconds = (text) => {
        if (!text) return 0;
        let maxSec = 0;
        const regex = /\[(\d{1,3}):(\d{2})(?::(\d{2}))?\]/g;
        let m;
        while ((m = regex.exec(text)) !== null) {
          const sec = m[3] !== undefined
            ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
            : Number(m[1]) * 60 + Number(m[2]);
          if (Number.isFinite(sec) && sec > maxSec) maxSec = sec;
        }
        return maxSec;
      };

      const totalVideoDur = Math.max(
        Number(metadata.durationSeconds) || 0,
        Number(mainWorldData?.lengthSeconds) || 0
      );

      let detectedOriginalLang = inferOriginalLanguageFromTracks(mainWorldData?.captionTracks || [], mainWorldData);
      let bestTranscript = '';
      let bestSource = '';
      let bestTrackLang = '';
      let bestCoverage = evaluateYoutubeTranscriptCoverage('', totalVideoDur);
      let bestCombinedScore = -1;

      const considerCandidate = (candidateText, sourceName, candidateLang = '') => {
        const clean = String(candidateText || '').trim();
        if (!clean) return;
        const cov = evaluateYoutubeTranscriptCoverage(clean, totalVideoDur);
        const normCandLang = normalizeLangBase(candidateLang);
        const langBonus =
          detectedOriginalLang && normCandLang
            ? normCandLang === detectedOriginalLang
              ? 12
              : -6
            : 0;
        const score = cov.qualityScore + langBonus;

        // Luôn giữ ứng viên tốt nhất: ưu tiên độ phủ thực tế cao hơn đáng kể, hoặc tương đương nhưng đúng ngôn ngữ gốc
        if (
          !bestTranscript ||
          score > bestCombinedScore + 3 ||
          (Math.abs(score - bestCombinedScore) <= 3 && clean.length > bestTranscript.length)
        ) {
          bestTranscript = clean;
          bestSource = sourceName;
          bestTrackLang = normCandLang || bestTrackLang;
          bestCoverage = cov;
          bestCombinedScore = score;
        }
      };

      const hasReliableOriginalCandidate = () =>
        bestCoverage.isSufficient &&
        (!detectedOriginalLang || !bestTrackLang || bestTrackLang === detectedOriginalLang);

      // Tầng 1A: Transcript đầy đủ từ youtubei/v1/get_transcript trong MAIN world
      considerCandidate(mainWorldData?.innertubeTranscript, 'innertube', mainWorldData?.innertubeLang || '');

      // Tầng 1B: Transcript từ live timedtext URL trong MAIN world (nếu Tầng 1A chưa đủ phủ hoặc lệch ngôn ngữ gốc)
      if (!hasReliableOriginalCandidate()) {
        considerCandidate(mainWorldData?.timedtextPerfTranscript, 'timedtext_perf', mainWorldData?.timedtextLang || '');
      }

      // Tầng 1C: Đọc captionTracks (ưu tiên ngôn ngữ gốc & độ phủ đầy đủ; luôn chạy nếu ứng viên trước lệch ngôn ngữ hoặc thiếu độ phủ)
      if (!hasReliableOriginalCandidate() || (detectedOriginalLang && !bestTrackLang)) {
        const trackRes = await fetchTranscriptFromCaptionTracks(mainWorldData, totalVideoDur, detectedOriginalLang);
        if (trackRes?.inferredOrigLang && !detectedOriginalLang) {
          detectedOriginalLang = trackRes.inferredOrigLang;
        }
        if (trackRes?.text) {
          considerCandidate(trackRes.text, 'caption_tracks', trackRes.lang);
        }
      }

      // Tầng 2: Nếu Tầng 1 chưa đủ độ phủ thời lượng video, đọc bảng Transcript DOM (hoặc mở ngầm, chờ ổn định rồi đóng gọn)
      if (!bestCoverage.isSufficient) {
        considerCandidate(scrapeExistingTranscriptDOM(), 'transcript_dom');
      }
      if (!bestCoverage.isSufficient) {
        considerCandidate(await autoOpenAndScrapeTranscript(), 'transcript_dom');
      }

      // Tầng 3: Fallback cuối cùng từ phụ đề đang hiển thị trên trình phát (.ytp-caption-segment / Language Reactor .lln-subs)
      if (!bestTranscript) {
        considerCandidate(scrapeActivePlayerCaptions(), 'player_caption_only');
      }

      const transcript = bestTranscript;
      const transcriptSource = bestSource;

      // Tầng 4: Chỉ báo rỗng khi cả 3 tầng đều không có dữ liệu
      if (!transcript) {
        sendResponse({
          success: false,
          title,
          description,
          transcriptSource: 'none',
          detectedOriginalLang,
          coverage: bestCoverage,
          ...metadata,
          error: 'Không tìm thấy phụ đề! Video này không có bản chép lời hoặc phụ đề CC.'
        });
        return;
      }

      sendResponse({
        success: true,
        title,
        description,
        transcript,
        transcriptSource,
        transcriptLang: bestTrackLang,
        detectedOriginalLang,
        coverage: bestCoverage,
        ...metadata,
        data: {
          title,
          description,
          transcript,
          transcriptSource,
          transcriptLang: bestTrackLang,
          detectedOriginalLang,
          coverage: bestCoverage,
          ...metadata
        }
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
        padding: 6px 11px;
        border-radius: 999px;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        white-space: nowrap;
        transition: background-color 0.2s cubic-bezier(0.22, 1, 0.36, 1), color 0.2s cubic-bezier(0.22, 1, 0.36, 1), transform 0.16s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.2s ease;
      }
      .ss-copilot-btn svg {
        width: 14px;
        height: 14px;
        flex: 0 0 14px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.85;
        stroke-linecap: round;
        stroke-linejoin: round;
        transition: transform 0.2s cubic-bezier(0.22, 1, 0.36, 1);
      }
      .ss-copilot-btn:hover {
        background: rgba(56, 189, 248, 0.2);
        color: #7dd3fc;
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(56, 189, 248, 0.18);
      }
      .ss-copilot-btn:hover svg {
        transform: scale(1.12);
      }
      .ss-copilot-btn:active {
        transform: scale(0.94) translateY(0);
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

    const createCopilotIcon = (paths) => {
      const svgNS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('aria-hidden', 'true');
      paths.forEach((d) => {
        const path = document.createElementNS(svgNS, 'path');
        path.setAttribute('d', d);
        svg.appendChild(path);
      });
      return svg;
    };

    const buttonsConfig = [
      {
        action: 'explain',
        label: 'Giải thích',
        iconPaths: ['M9 18h6', 'M10 22h4', 'M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z']
      },
      {
        action: 'vocab',
        label: 'Lưu từ vựng',
        iconPaths: ['M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z', 'M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z']
      },
      {
        action: 'quiz',
        label: 'Tạo Quiz',
        iconPaths: ['M9 11l3 3L22 4', 'M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11']
      }
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
      const textSpan = document.createElement('span');
      textSpan.textContent = cfg.label;
      btn.append(createCopilotIcon(cfg.iconPaths), textSpan);
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
