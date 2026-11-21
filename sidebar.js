const API_BASE_URL = 'http://127.0.0.1:8000';
const THEME_STORAGE_KEY = 'smartStudyTheme';
const DEFAULT_THEME_ID = 'tech-ocean';
const SIDEBAR_THEMES = [
  { id: 'tech-ocean', label: '🌊 Tech Ocean (Mặc định)' },
  { id: 'automation-slate', label: '🤖 Automation Slate' },
  { id: 'cyber-cobalt', label: '⚡ Cyber Cobalt' },
  { id: 'clean-daylight', label: '☀️ Clean Daylight' },
  { id: 'academic-ivory', label: '📜 Academic Ivory' },
  { id: 'neural-violet', label: '🧠 Neural Violet' }
];
const SIDEBAR_LEGACY_THEME_MAP = {
  'tech-midnight': 'tech-ocean',
  'emerald-matrix': 'automation-slate',
  'obsidian-amber': 'automation-slate',
  'crimson-carbon': 'neural-violet',
  'nordic-sky': 'clean-daylight',
  'mint-focus': 'clean-daylight',
  'sunrise-peach': 'academic-ivory',
  'lavender-mist': 'academic-ivory',
  'rose-quartz': 'clean-daylight'
};

function applySidebarTheme(themeId) {
  const mapped = SIDEBAR_LEGACY_THEME_MAP[themeId] || themeId;
  const valid = SIDEBAR_THEMES.some((t) => t.id === mapped);
  const safeId = valid ? mapped : DEFAULT_THEME_ID;
  document.documentElement.setAttribute('data-theme', safeId);
  return safeId;
}

document.addEventListener('DOMContentLoaded', async () => {
  const selectEl = document.getElementById('theme-selector');
  let savedTheme = DEFAULT_THEME_ID;
  try {
    const stored = await chrome.storage.local.get(THEME_STORAGE_KEY);
    if (stored && stored[THEME_STORAGE_KEY]) {
      savedTheme = applySidebarTheme(stored[THEME_STORAGE_KEY]);
    } else {
      applySidebarTheme(DEFAULT_THEME_ID);
    }
  } catch (_) {
    applySidebarTheme(DEFAULT_THEME_ID);
  }

  if (selectEl) {
    selectEl.replaceChildren();
    SIDEBAR_THEMES.forEach((theme) => {
      const opt = document.createElement('option');
      opt.value = theme.id;
      opt.textContent = theme.label;
      selectEl.appendChild(opt);
    });
    selectEl.value = savedTheme;
    selectEl.addEventListener('change', async () => {
      const next = applySidebarTheme(selectEl.value);
      try {
        await chrome.storage.local.set({ [THEME_STORAGE_KEY]: next });
      } catch (_) {}
    });
  }

  if (chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local' || !changes[THEME_STORAGE_KEY]) return;
      const next = applySidebarTheme(changes[THEME_STORAGE_KEY].newValue);
      if (selectEl && selectEl.value !== next) selectEl.value = next;
    });
  }
});

class VocabStorageManager {
  static STORAGE_KEY = 'vocabBank';
  static DAY_MS = 86400000;
  static LEITNER_INTERVALS_DAYS = {
    1: 1,
    2: 3,
    3: 7,
    4: 14
  };

  static makeKey(word, pos = '') {
    const cleanWord = String(word || '').toLowerCase().trim();
    const cleanPos = String(pos || '').replace(/[()]/g, '').toLowerCase().trim();
    return `${cleanWord}_${cleanPos}`;
  }

  async getAll() {
    const data = await chrome.storage.local.get(VocabStorageManager.STORAGE_KEY).catch(() => ({}));
    const raw = data?.[VocabStorageManager.STORAGE_KEY];
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === 'object') return Object.values(raw);
    return [];
  }

  async saveAll(list) {
    await chrome.storage.local.set({ [VocabStorageManager.STORAGE_KEY]: Array.isArray(list) ? list : [] });
  }

  async getDueList(now = Date.now()) {
    const list = await this.getAll();
    return list.filter((entry) => {
      if (!entry) return false;
      const level = Number(entry.masteryLevel || 0);
      if (level === 0) return true;
      return level < 4 && Number(entry.nextReviewAt || 0) <= now;
    });
  }

  async upsertUnknown(item, sourceMeta = null) {
    const list = await this.getAll();
    const word = String(item?.word || item?.front || item?.question || '')
      .replace(/\s*\([^()]{1,20}\)\s*$/, '')
      .trim();
    const pos = String(item?.pos || '').replace(/[()]/g, '').trim();
    if (!word) return null;

    const id = VocabStorageManager.makeKey(word, pos);
    const now = Date.now();
    const incomingSource = sourceMeta
      ? {
          type: sourceMeta.type || 'text',
          title: String(sourceMeta.title || '').trim(),
          ...(sourceMeta.url ? { url: String(sourceMeta.url).trim() } : {}),
          ...(sourceMeta.videoId ? { videoId: sourceMeta.videoId } : {}),
          ...(sourceMeta.videoUrl ? { videoUrl: sourceMeta.videoUrl } : {}),
          ...(Number.isFinite(sourceMeta.timestampSec) ? { timestampSec: sourceMeta.timestampSec } : {}),
          ...(sourceMeta.timestampLabel ? { timestampLabel: sourceMeta.timestampLabel } : {}),
          addedAt: sourceMeta.addedAt || now
        }
      : null;

    const existingIdx = list.findIndex((entry) => entry?.id === id);
    const incomingMeaning = String(item?.meaning_vi || item?.correct_answer || item?.meaning || item?.back || '').trim();
    const incomingContext = String(item?.contextSentence || item?.example_en || item?.example || '').trim();
    const incomingExampleVi = String(item?.example_vi || item?.exampleVi || '').trim();
    const incomingTopic = String(item?.topic || '').trim();
    const incomingVisualCategory = String(item?.visual_category || item?.visualCategory || '').trim();
    const incomingIconEmoji = String(item?.icon_emoji || item?.iconEmoji || '').trim();
    const incomingVisualLabel = String(item?.visual_label || item?.visualLabel || '').trim();
    const incomingMemoryHook = String(item?.memory_hook || item?.memoryHook || '').trim();

    if (existingIdx >= 0) {
      const existing = { ...list[existingIdx] };
      if (item?.ipa) existing.ipa = String(item.ipa).trim();
      if (incomingMeaning) existing.meaning = incomingMeaning;
      if (incomingContext) {
        existing.contextSentence = incomingContext;
        existing.example_en = incomingContext;
      }
      if (incomingExampleVi) {
        existing.exampleVi = incomingExampleVi;
        existing.example_vi = incomingExampleVi;
      }
      if (incomingTopic) existing.topic = incomingTopic;
      if (incomingVisualCategory) existing.visual_category = incomingVisualCategory;
      if (incomingIconEmoji) existing.icon_emoji = incomingIconEmoji;
      if (incomingVisualLabel) existing.visual_label = incomingVisualLabel;
      if (incomingMemoryHook) existing.memory_hook = incomingMemoryHook;
      if (!existing.svgSketch && (item?.svgSketch || item?.svg_sketch)) {
        existing.svgSketch = String(item.svgSketch || item.svg_sketch).trim();
      }
      const existingSources = Array.isArray(existing.sources) ? [...existing.sources] : [];
      if (incomingSource) {
        const isDup = existingSources.some(
          (src) =>
            src?.type === incomingSource.type &&
            src?.title === incomingSource.title &&
            (src?.url || '') === (incomingSource.url || '') &&
            src?.timestampSec === incomingSource.timestampSec
        );
        if (!isDup) existingSources.push(incomingSource);
      }
      existing.sources = existingSources;
      existing.masteryLevel = 0;
      existing.nextReviewAt = now;
      list[existingIdx] = existing;
      await this.saveAll(list);
      return existing;
    }

    const newRecord = {
      id,
      word,
      pos,
      ipa: String(item?.ipa || '').trim(),
      meaning: incomingMeaning,
      contextSentence: incomingContext,
      example_en: incomingContext,
      exampleVi: incomingExampleVi,
      example_vi: incomingExampleVi,
      topic: incomingTopic,
      visual_category: incomingVisualCategory,
      icon_emoji: incomingIconEmoji,
      visual_label: incomingVisualLabel,
      memory_hook: incomingMemoryHook,
      svgSketch: String(item?.svgSketch || item?.svg_sketch || '').trim(),
      masteryLevel: 0,
      nextReviewAt: now,
      sources: incomingSource ? [incomingSource] : []
    };
    list.unshift(newRecord);
    await this.saveAll(list);
    return newRecord;
  }
}

const vocabStorageManager = new VocabStorageManager();

const APP_VIEW_TITLES = {
  'view-quiz': 'Tạo Quiz bằng AI',
  'view-youtube': 'Tóm tắt YouTube',
  'view-word-form': 'Chỉnh sửa form Word',
  'view-history': 'Lịch sử Bộ đề',
  'view-export': 'Xuất Word & In PDF',
  'view-settings': 'Cài đặt API Key'
};

function showAppView(viewId) {
  const targetView = document.getElementById(viewId);
  if (!targetView || !targetView.classList.contains('app-view')) return false;

  document.querySelectorAll('.app-view').forEach((view) => {
    const isActive = view === targetView;
    view.hidden = !isActive;
    view.classList.toggle('active', isActive);
  });

  document.querySelectorAll('.nav-item[data-view]').forEach((item) => {
    const isActive = item.dataset.view === viewId;
    item.classList.toggle('active', isActive);
    if (isActive) {
      item.setAttribute('aria-current', 'page');
    } else {
      item.removeAttribute('aria-current');
    }
  });

  const title = document.getElementById('current-view-title');
  if (title) title.textContent = APP_VIEW_TITLES[viewId] || 'Smart Study';

  const contentArea = document.querySelector('.content-area');
  if (contentArea) contentArea.scrollTop = 0;
  return true;
}

(function initializeWordFormFeature() {
  let wfLastWorkingModel = '';
  let wfExtractedImages = new Map();
  const MAX_CHUNK_CHARS = 6500;

  function splitWordFormQuizInput(input) {
    const text = String(input || '').trim();
    if (text.length <= MAX_CHUNK_CHARS) return text ? [text] : [];

    const questionPattern = /^[ \t]*(?:(?:Câu|Bài|Question)[ \t]*\d+|\d+[.)])(?=[ \t:.)\-]|$)/gim;
    const questionStarts = Array.from(text.matchAll(questionPattern), (match) => match.index);
    const hasNumberedQuestions = questionStarts.length >= 2;
    let blocks;

    if (hasNumberedQuestions) {
      blocks = [];
      if (questionStarts[0] > 0) blocks.push(text.slice(0, questionStarts[0]).trim());
      questionStarts.forEach((start, index) => {
        const end = questionStarts[index + 1] ?? text.length;
        blocks.push(text.slice(start, end).trim());
      });
    } else {
      blocks = text.split(/\r?\n\s*\r?\n+/).map((block) => block.trim()).filter(Boolean);
    }

    const chunks = [];
    let currentBlocks = [];
    let currentLength = 0;
    const flushChunk = () => {
      if (currentBlocks.length) chunks.push(currentBlocks.join('\n\n'));
      currentBlocks = [];
      currentLength = 0;
    };

    blocks.forEach((block) => {
      const blockLength = block.length + (currentBlocks.length ? 2 : 0);
      if (currentBlocks.length && currentLength + blockLength > MAX_CHUNK_CHARS) {
        flushChunk();
      }
      currentBlocks.push(block);
      currentLength += block.length + (currentBlocks.length > 1 ? 2 : 0);
    });
    flushChunk();
    return chunks.length ? chunks : [text];
  }

  function splitWordEssayInput(input) {
    const text = String(input || '').trim();
    if (text.length <= MAX_CHUNK_CHARS) return text ? [text] : [];

    const blocks = text.split(/\r?\n+/).map((block) => block.trim()).filter(Boolean);
    const chunks = [];
    let currentBlocks = [];
    let currentLength = 0;
    const flushChunk = () => {
      if (currentBlocks.length) chunks.push(currentBlocks.join('\n\n'));
      currentBlocks = [];
      currentLength = 0;
    };

    blocks.forEach((sourceBlock) => {
      let block = sourceBlock;
      while (block.length > MAX_CHUNK_CHARS) {
        if (currentBlocks.length) flushChunk();
        let splitAt = block.lastIndexOf(' ', MAX_CHUNK_CHARS);
        if (splitAt < MAX_CHUNK_CHARS / 2) splitAt = MAX_CHUNK_CHARS;
        chunks.push(block.slice(0, splitAt).trim());
        block = block.slice(splitAt).trim();
      }

      const blockLength = block.length + (currentBlocks.length ? 2 : 0);
      if (currentBlocks.length && currentLength + blockLength > MAX_CHUNK_CHARS) {
        flushChunk();
      }
      currentBlocks.push(block);
      currentLength += block.length + (currentBlocks.length > 1 ? 2 : 0);
    });
    flushChunk();
    return chunks.length ? chunks : [text];
  }

  function buildWordFormClassificationPrompt(chunk, solveMissing) {
    const missingAnswerInstruction = solveMissing
      ? 'Nếu một câu không có dấu hiệu đáp án trong đề gốc, hãy tự giải câu đó, điền correct và đặt solvedByAi=true. Với đáp án tìm thấy rõ trong đề gốc, đặt solvedByAi=false.'
      : 'Nếu một câu không có dấu hiệu đáp án trong đề gốc, bắt buộc đặt correct="" và solvedByAi=false; tuyệt đối không tự giải hoặc đoán.';
    return `Bạn chỉ phân loại cấu trúc đề trắc nghiệm thành JSON. Không sửa hoặc diễn đạt lại nội dung câu hỏi và đáp án; chỉ làm sạch ký tự rác và khoảng trắng thừa.
  Chuẩn hóa mọi kiểu đánh số câu (ví dụ 1., 1), Bài 1, Question 1, Câu 1) thành số liên tục theo thứ tự xuất hiện.
  Giữ nguyên chính xác các dấu mốc [HÌNH X] và [BẢNG X].
  Giữ nguyên nguyên văn mọi token ảnh dạng [[IMG_X]] và đúng vị trí của chúng trong câu hỏi/đáp án.
  Dấu **...** biểu thị nội dung in đậm trong tệp gốc, __...__ biểu thị chữ gạch chân, và dấu * ở đầu lựa chọn cũng là dấu hiệu đáp án đúng. Dùng thêm bảng đáp án cuối đề nếu có. Không giữ các dấu định dạng này trong văn bản question/options đầu ra.
  ${missingAnswerInstruction}
  Mỗi câu có options với đủ khóa A, B, C, D; lựa chọn bị thiếu dùng chuỗi rỗng. number là số thứ tự liên tục.
  Chỉ trả về JSON hợp lệ, không thêm Markdown hay giải thích:
  {"questions":[{"number":1,"question":"Nội dung câu hỏi...","options":{"A":"...","B":"...","C":"...","D":"..."},"correct":"A","solvedByAi":false}],"hasMediaPlaceholder":false}

  ĐỀ CẦN PHÂN LOẠI:
  ${chunk}`;
  }

  function parseQuizLocally(rawText) {
    const cleaned = String(rawText || '').replace(/\*\*/g, '');
    const answerHeadingPattern =
      /(?:^|[\n\r]|(?<=[.?!]))\s*(?:Answers|Answer\s*Key|Đáp\s*án)\s*[:：]?\s*(?=[\n\r\s]*(?:Q\.?|Câu|\d))/ig;
    answerHeadingPattern.lastIndex = Math.floor(cleaned.length / 2);
    let answerHeadingMatch;
    let answerHeadingStart = -1;
    while ((answerHeadingMatch = answerHeadingPattern.exec(cleaned)) !== null) {
      answerHeadingStart = answerHeadingMatch.index;
    }

    const questionsPart = answerHeadingStart >= 0
      ? cleaned.slice(0, answerHeadingStart)
      : cleaned;
    const answersPart = answerHeadingStart >= 0
      ? cleaned.slice(answerHeadingStart)
      : '';
    const answerMap = {};
    const answerPairPattern =
      /(?:Q\.?|Câu)?\s*(\d+)\s*[-:.)]\s*([A-D])(?=$|[^a-zA-Z0-9]|(?:Q\.?|Câu)\s*\d|\d+\s*[-:.)]\s*[A-D])/gi;
    let answerMatch;
    while ((answerMatch = answerPairPattern.exec(answersPart)) !== null) {
      answerMap[Number(answerMatch[1])] = answerMatch[2].toUpperCase();
    }

    const questionStarts = [];
    const questionPattern =
      /(?:^|[\n\r]|(?<=[.?!…]))\s*(?:Q\.?|Câu)\s*(\d+)\s*[:.)]\s*/gi;
    let questionMatch;
    while ((questionMatch = questionPattern.exec(questionsPart)) !== null) {
      questionStarts.push({
        number: Number(questionMatch[1]),
        start: questionMatch.index,
        contentStart: questionPattern.lastIndex
      });
    }

    const optionPattern =
      /(?:^|[\s\n]|(?<=[.?!):;,"'”]))(\*?\s*[A-D])\s*[.)]\s*/gi;
    const resultsByNumber = new Map();
    let orphanedImageTokens = [];
    const attachOrphanedImages = (question) => {
      if (!orphanedImageTokens.length) return;
      question.question = cleanWordFormText(
        `${question.question} ${orphanedImageTokens.join(' ')}`
      );
      orphanedImageTokens = [];
    };
    questionStarts.forEach((start, index) => {
      const end = questionStarts[index + 1]?.start ?? questionsPart.length;
      const block = questionsPart.slice(start.contentStart, end).trim();
      const optionMatches = Array.from(block.matchAll(optionPattern));
      const options = { A: '', B: '', C: '', D: '' };
      let question = block;
      let asteriskAnswer = '';
      const completeOptionSets = [];

      for (let markerIndex = 0; markerIndex <= optionMatches.length - 4; markerIndex += 1) {
        const candidate = optionMatches.slice(markerIndex, markerIndex + 4);
        const labels = candidate.map((match) => match[1].replace(/\*/g, '').trim().toUpperCase());
        if (labels.join('') === 'ABCD') {
          completeOptionSets.push(candidate);
          markerIndex += 3;
        }
      }

      const hasSeparateOptionsSection = /\b(?:Exhibit|Options)\s*:/i.test(block);
      const orderedMarkers = completeOptionSets.length > 1 || hasSeparateOptionsSection
        ? completeOptionSets[completeOptionSets.length - 1] || []
        : completeOptionSets[0] || [];

      if (orderedMarkers.length === 4) {
        question = block.slice(0, orderedMarkers[0].index).trim();
        orderedMarkers.forEach((match, optionIndex) => {
          const letter = String.fromCharCode('A'.charCodeAt(0) + optionIndex);
          const contentStart = match.index + match[0].length;
          const contentEnd = orderedMarkers[optionIndex + 1]?.index ?? block.length;
          const rawOption = block.slice(contentStart, contentEnd).trim();
          const isAsteriskMarked = match[1].includes('*') || /^\*\s*/.test(rawOption);
          options[letter] = cleanWordFormText(rawOption.replace(/^\*\s*/, ''));
          if (isAsteriskMarked && !asteriskAnswer) asteriskAnswer = letter;
        });
      } else {
        const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        if (lines.length >= 5) {
          question = lines.slice(0, -4).join(' ');
          ['A', 'B', 'C', 'D'].forEach((letter, optionIndex) => {
            const rawOption = lines[lines.length - 4 + optionIndex];
            const choiceMatch = rawOption.match(/^\*?\s*([A-D])\s*[.)]\s*(.*)$/i);
            const choiceText = choiceMatch ? choiceMatch[2] : rawOption;
            options[letter] = cleanWordFormText(choiceText.replace(/^\*\s*/, ''));
            if ((rawOption.startsWith('*') || choiceMatch?.[0].startsWith('*')) && !asteriskAnswer) {
              asteriskAnswer = letter;
            }
          });
        }
      }

      const parsedQuestion = {
        number: start.number,
        question: cleanWordFormText(question),
        options,
        correct: answerMap[start.number] || asteriskAnswer || '',
        solvedByAi: false
      };
      if (!parsedQuestion.question) return;

      const existing = resultsByNumber.get(start.number);
      const hasFourOptions = (item) => ['A', 'B', 'C', 'D'].every((letter) => item.options[letter]);
      if (!existing || (!hasFourOptions(existing) && hasFourOptions(parsedQuestion))) {
        attachOrphanedImages(parsedQuestion);
        resultsByNumber.set(start.number, parsedQuestion);
      } else {
        orphanedImageTokens.push(...(block.match(/\[\[IMG_\d+\]\]/g) || []));
      }
    });

    const questions = Array.from(resultsByNumber.values());
    if (orphanedImageTokens.length && questions.length) {
      attachOrphanedImages(questions[questions.length - 1]);
    }
    return questions;
  }

  async function classifyWordFormChunk(chunk, apiKey, solveMissing) {
    const preferredModels = [
      'gemini-2.5-flash-lite',
      'gemini-2.0-flash',
      'gemini-2.0-flash-lite',
      'gemini-2.5-flash',
      'gemini-flash-latest'
    ];
    const models = preferredModels;
    let lastError = null;
    let allFailuresOverloaded = true;

    for (let index = 0; index < models.length; index += 1) {
      const modelName = models[index];
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      let shouldPauseForOverload = false;
      try {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{ parts: [{ text: buildWordFormClassificationPrompt(chunk, solveMissing) }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: 0.1
            }
          })
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          const message = data?.error?.message || `HTTP ${response.status}: ${response.statusText}`;
          lastError = new Error(message);
          shouldPauseForOverload =
            [429, 500, 503].includes(response.status) || /high demand/i.test(message);
          if (!shouldPauseForOverload) allFailuresOverloaded = false;
        } else {
          const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!rawText) {
            lastError = new Error(`Model ${modelName} không trả về dữ liệu JSON.`);
            allFailuresOverloaded = false;
          } else {
            try {
              const parsed = JSON.parse(String(rawText)
                .trim()
                .replace(/^```(?:json)?\s*/i, '')
                .replace(/\s*```$/i, '')
                .trim());
              if (!parsed || !Array.isArray(parsed.questions)) {
                throw new Error('Phản hồi phân loại không có mảng questions hợp lệ.');
              }
              wfLastWorkingModel = modelName;
              return parsed;
            } catch (error) {
              lastError = error;
              allFailuresOverloaded = false;
            }
          }
        }
      } catch (error) {
        lastError = error.name === 'AbortError'
          ? new Error(`Model ${modelName} đã quá thời gian chờ.`)
          : error;
        allFailuresOverloaded = false;
      } finally {
        clearTimeout(timeoutId);
      }

      if (shouldPauseForOverload && index < models.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    if (allFailuresOverloaded) {
      const overloadError = lastError || new Error('Tất cả model phân loại đề hiện đều quá tải.');
      overloadError.code = 'WF_AI_OVERLOADED';
      throw overloadError;
    }
    throw lastError || new Error('Tất cả model phân loại đề hiện đều thất bại.');
  }

  function cleanWordFormText(value) {
    return String(value || '')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/__(.*?)__/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeWordFormQuestions(rawQuestions, allowAiSolve) {
    const optionLetters = ['A', 'B', 'C', 'D'];
    return rawQuestions
      .map((item) => {
        const rawOptions = item?.options && typeof item.options === 'object' ? item.options : {};
        const options = {};
        optionLetters.forEach((letter) => {
          const value = rawOptions[letter] ?? rawOptions[letter.toLowerCase()] ?? '';
          options[letter] = cleanWordFormText(value).replace(/^\*\s*/, '');
        });
        const rawCorrect = String(item?.correct || '').trim().toUpperCase();
        const correctMatch = rawCorrect.match(/^\*?\s*([A-D])(?:[.):])?$/);
        const correct = correctMatch?.[1] || '';
        return {
          question: cleanWordFormText(item?.question),
          options,
          correct,
          solvedByAi: Boolean(allowAiSolve && item?.solvedByAi === true && correct)
        };
      })
      .filter((item) => item.question);
  }

  async function extractWordFormDocxText(html) {
    const parsedDocument = new DOMParser().parseFromString(html, 'text/html');
    const tables = Array.from(parsedDocument.body.querySelectorAll('table'));
    const lastTable = tables[tables.length - 1];
    let tableNumber = 0;

    const imageExtensions = {
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/bmp': 'bmp',
      'image/svg+xml': 'svg'
    };
    const imageNodes = Array.from(parsedDocument.body.querySelectorAll('img'));
    const extractedImages = await Promise.all(imageNodes.map(async (imageNode) => {
      try {
        const source = imageNode.getAttribute('src') || '';
        const imageData = source.match(/^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i);
        if (!imageData) return null;

        const mimeType = imageData[1].toLowerCase();
        const ext = imageExtensions[mimeType];
        if (!ext) return null;
        const binary = atob(imageData[2].replace(/\s/g, ''));
        if (!binary.length) return null;
        const bytes = new Uint8Array(binary.length);
        for (let byteIndex = 0; byteIndex < binary.length; byteIndex += 1) {
          bytes[byteIndex] = binary.charCodeAt(byteIndex);
        }

        const image = new Image();
        const dimensions = await new Promise((resolve) => {
          let settled = false;
          const finish = (value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutId);
            image.onload = null;
            image.onerror = null;
            resolve(value);
          };
          const timeoutId = setTimeout(() => finish(null), 5000);
          image.onload = () => finish({
            width: image.naturalWidth,
            height: image.naturalHeight
          });
          image.onerror = () => finish(null);
          image.src = source;
          if (image.complete) {
            finish(image.naturalWidth > 0
              ? { width: image.naturalWidth, height: image.naturalHeight }
              : null);
          }
        });
        if (!dimensions?.width || !dimensions?.height) return null;

        const scale = dimensions.width > 460 ? 460 / dimensions.width : 1;
        return {
          bytes,
          width: Math.round(dimensions.width * scale),
          height: Math.round(dimensions.height * scale),
          ext
        };
      } catch (_) {
        return null;
      }
    }));

    let imageNumber = 0;
    imageNodes.forEach((imageNode, index) => {
      const image = extractedImages[index];
      if (!image) {
        imageNode.remove();
        return;
      }
      imageNumber += 1;
      const imgId = `IMG_${imageNumber}`;
      wfExtractedImages.set(imgId, image);
      imageNode.replaceWith(parsedDocument.createTextNode(`\n[[${imgId}]]\n`));
    });

    const isAnswerKeyTable = (table) => {
      if (table !== lastTable) return false;
      const tableText = table.textContent.replace(/\s+/g, ' ').trim();
      if (/(?:đáp\s*án|answer\s*key|correct\s*answer)/i.test(tableText)) return true;
      const cells = Array.from(table.querySelectorAll('th, td'))
        .map((cell) => cell.textContent.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      return cells.length > 0 && cells.every((cell) =>
        /^(?:\d{1,3}\s*[.):\-]?\s*)?[A-D](?:\s*[.):\-]?\s*\d{0,3})?$/i.test(cell)
      );
    };

    const formatNode = (node) => {
      if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
      if (node.nodeType !== Node.ELEMENT_NODE) return '';

      const element = node;
      const tagName = element.tagName;
      if (tagName === 'TABLE') {
        if (!isAnswerKeyTable(element)) {
          tableNumber += 1;
          return `[BẢNG ${tableNumber}]`;
        }
        return Array.from(element.querySelectorAll('tr'))
          .map((row) => Array.from(row.querySelectorAll('th, td'))
            .map((cell) => formatChildren(cell).trim())
            .filter(Boolean)
            .join(' | '))
          .filter(Boolean)
          .join('\n');
      }
      if (tagName === 'BR') return '\n';

      const content = formatChildren(element);
      if (tagName === 'STRONG' || tagName === 'B') return `**${content}**`;
      if (tagName === 'U') return `__${content}__`;
      if (/^(ADDRESS|ARTICLE|BLOCKQUOTE|DIV|H[1-6]|LI|P|PRE|SECTION)$/.test(tagName)) {
        return `\n${content}\n`;
      }
      return content;
    };

    const formatChildren = (element) =>
      Array.from(element.childNodes, formatNode).join('');
    return formatChildren(parsedDocument.body)
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  async function createWordFormDocument(title, questions, answerStyle) {
    const docxApi = window.docx;
    if (!docxApi?.Document || !docxApi?.Paragraph || !docxApi?.TextRun || !docxApi?.Packer) {
      throw new Error('Không tải được thư viện docx.js từ assets/docx.umd.js.');
    }
    if (wfExtractedImages.size && !docxApi.ImageRun) {
      throw new Error('Không tải được thành phần ImageRun của docx.js để nhúng ảnh gốc.');
    }

    const paragraphs = [
      new docxApi.Paragraph({
        alignment: docxApi.AlignmentType?.CENTER || 'center',
        spacing: { after: 240, line: 276 },
        children: [
          new docxApi.TextRun({
            text: title,
            bold: true,
            font: 'Times New Roman',
            size: 28
          })
        ]
      })
    ];

    const renderedImageIds = new Set();
    const appendImageRun = (targetParagraphs, imgId, image) => {
      targetParagraphs.push(new docxApi.Paragraph({
        alignment: docxApi.AlignmentType?.CENTER || 'center',
        spacing: { before: 80, after: 80 },
        children: [new docxApi.ImageRun({
          data: image.bytes,
          type: image.ext,
          transformation: { width: image.width, height: image.height }
        })]
      }));
      renderedImageIds.add(imgId);
    };
    const appendTextWithImages = (targetParagraphs, rawStr, textOptions) => {
      const sourceText = String(rawStr || '');
      const { paragraphOptions, textRunOptions, prefixRuns = [] } = textOptions;
      const imageTokenPattern = /\[\[(IMG_\d+)\]\]/g;
      const imageTokens = Array.from(sourceText.matchAll(imageTokenPattern));
      let cursor = 0;
      let firstSegment = true;

      const appendTextSegment = (segment) => {
        const children = firstSegment ? [...prefixRuns] : [];
        if (segment) {
          children.push(new docxApi.TextRun({ ...textRunOptions, text: segment }));
        }
        if (children.length) {
          targetParagraphs.push(new docxApi.Paragraph({
            ...paragraphOptions,
            children
          }));
        }
        firstSegment = false;
      };

      if (!imageTokens.length) {
        appendTextSegment(sourceText);
        return;
      }

      imageTokens.forEach((match) => {
        appendTextSegment(sourceText.slice(cursor, match.index));
        const image = wfExtractedImages.get(match[1]);
        if (image) appendImageRun(targetParagraphs, match[1], image);
        cursor = match.index + match[0].length;
      });
      appendTextSegment(sourceText.slice(cursor));
    };

    questions.forEach((question, index) => {
      appendTextWithImages(
        paragraphs,
        ` ${question.question}`,
        {
          paragraphOptions: { spacing: { before: 100, after: 40, line: 276 } },
          textRunOptions: { font: 'Times New Roman', size: 24 },
          prefixRuns: [new docxApi.TextRun({
            text: `Câu ${index + 1}:`,
            bold: true,
            font: 'Times New Roman',
            size: 24
          })]
        }
      );

      ['A', 'B', 'C', 'D'].forEach((letter) => {
        const isCorrect = question.correct === letter;
        const marker = isCorrect && (answerStyle === 'asterisk' || answerStyle === 'both') ? '*' : '';
        appendTextWithImages(
          paragraphs,
          `${marker}${letter}. ${question.options[letter]}`,
          {
            paragraphOptions: { spacing: { after: 0, line: 276 } },
            textRunOptions: {
              bold: isCorrect && (answerStyle === 'bold' || answerStyle === 'both'),
              font: 'Times New Roman',
              size: 24
            }
          }
        );
      });
    });

    const unrenderedImages = Array.from(wfExtractedImages.entries())
      .filter(([imgId]) => !renderedImageIds.has(imgId));
    if (unrenderedImages.length) {
      paragraphs.push(new docxApi.Paragraph({
        spacing: { before: 160, after: 80 },
        children: [new docxApi.TextRun({
          text: 'Hình ảnh đính kèm từ tài liệu gốc',
          bold: true,
          font: 'Times New Roman',
          size: 22
        })]
      }));
      unrenderedImages.forEach(([imgId, image]) => appendImageRun(paragraphs, imgId, image));
    }

    const document = new docxApi.Document({
      styles: {
        default: {
          document: {
            run: { font: 'Times New Roman', size: 24 },
            paragraph: { spacing: { line: 276 } }
          }
        }
      },
      sections: [{
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 1134, bottom: 1134, left: 1417, right: 1134 }
          }
        },
        children: paragraphs
      }]
    });
    return {
      blob: await docxApi.Packer.toBlob(document),
      renderedImageIds
    };
  }

  function slugWordFormTitle(title) {
    const slug = String(title || '')
      .trim()
      .toLowerCase()
      .replace(/[đĐ]/g, 'd')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return slug || 'de-on-tap-trac-nghiem';
  }

  function renderWordFormValidation(box, report) {
    box.replaceChildren();
    box.classList.remove('has-warning', 'is-invalid');
    if (!report.valid) box.classList.add('is-invalid');
    else if (report.warnings.length) box.classList.add('has-warning');

    const heading = document.createElement('strong');
    heading.className = 'wf-validation-title';
    heading.textContent = report.valid
      ? report.warnings.length ? 'Kiểm định hoàn tất — cần lưu ý' : 'Kiểm định hoàn tất — đạt chuẩn'
      : 'Kiểm định không đạt';
    box.appendChild(heading);

    report.lines.forEach((text) => {
      const line = document.createElement('div');
      line.className = 'wf-validation-line';
      line.textContent = text;
      box.appendChild(line);
    });
    report.warnings.forEach((text) => {
      const warning = document.createElement('div');
      warning.className = 'wf-validation-line';
      warning.textContent = `⚠️ ${text}`;
      box.appendChild(warning);
    });
    if (report.error) {
      const error = document.createElement('div');
      error.className = 'wf-validation-line';
      error.textContent = report.error;
      box.appendChild(error);
    }
    box.hidden = false;
  }

  function extractWordEssayDocxText(html) {
    const parsedDocument = new DOMParser().parseFromString(html, 'text/html');
    let imageNumber = 0;
    let tableNumber = 0;

    const formatNode = (node) => {
      if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
      if (node.nodeType !== Node.ELEMENT_NODE) return '';

      const element = node;
      const tagName = element.tagName;
      if (tagName === 'IMG') {
        imageNumber += 1;
        return `[HÌNH ${imageNumber}]`;
      }
      if (tagName === 'TABLE') {
        tableNumber += 1;
        return `[BẢNG ${tableNumber}]`;
      }
      if (tagName === 'BR') return '\n';

      const content = Array.from(element.childNodes, formatNode).join('');
      if (tagName === 'STRONG' || tagName === 'B') return `**${content}**`;
      if (/^H[1-6]$/.test(tagName)) {
        return `\n${'#'.repeat(Number(tagName[1]))} ${content}\n`;
      }
      if (/^(ADDRESS|ARTICLE|BLOCKQUOTE|DIV|LI|P|PRE|SECTION)$/.test(tagName)) {
        return `\n${content}\n`;
      }
      return content;
    };

    return Array.from(parsedDocument.body.childNodes, formatNode)
      .join('')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function buildWordEssayClassificationPrompt(chunk) {
    return `Bạn chỉ phân loại cấu trúc và định dạng các đoạn trong bản thảo thành JSON. Không tóm tắt, không diễn đạt lại, không bịa thêm và không bỏ sót nội dung học thuật gốc. Giữ nguyên từ ngữ, số liệu, dấu câu, thứ tự, mọi trích dẫn như [1] và toàn bộ Tài liệu tham khảo; giữ chính xác các dấu [HÌNH X], [BẢNG X]. Dùng các dấu **...** và dấu # đầu dòng làm gợi ý nhận diện tiêu đề; không đưa dấu định dạng đó vào trường text.
  Mỗi đoạn chỉ được có đúng một type trong 5 nhãn: heading1, heading2, heading3, caption, body.
  Chỉ gắn nhãn heading cho tiêu đề ngắn không quá 120 ký tự; đoạn văn phân tích, câu hoàn chỉnh hoặc tiêu đề dài hơn 120 ký tự phải là body. Không gắn nhãn heading nếu nội dung kết thúc bằng dấu câu kết câu, trừ dòng chỉ là số mục như 1.1.
  heading1: tiêu đề cấp cao, gồm LỜI MỞ ĐẦU, MỞ ĐẦU, CHƯƠNG <số>, PHẦN, TIỂU KẾT CHƯƠNG <số>, KẾT LUẬN, TÀI LIỆU THAM KHẢO, PHỤ LỤC; các mục cấp 1 như 1. hoặc I.
  heading2: mục cấp 2 như 1.1. hoặc a).
  heading3: mục cấp 3 như 1.1.1.
  caption: chú thích hình/bảng; body: mọi nội dung còn lại, kể cả dòng liệt kê.
  Chỉ trả JSON thuần hợp lệ, không thêm Markdown hay giải thích, theo cấu trúc {"blocks":[{"type":"heading1","text":"..."}]}.

  BẢN THẢO:
  ${chunk}`;
  }

  async function classifyWordEssayChunk(chunk, apiKey) {
    const preferredModels = [
      'gemini-3.5-flash-lite',
      'gemini-2.5-flash-lite',
      'gemini-2.0-flash'
    ];
    const models = wfLastWorkingModel && preferredModels.includes(wfLastWorkingModel)
      ? [wfLastWorkingModel, ...preferredModels.filter((modelName) => modelName !== wfLastWorkingModel)]
      : preferredModels;
    let lastError = null;

    for (const modelName of models) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      try {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{ parts: [{ text: buildWordEssayClassificationPrompt(chunk) }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: 0.1
            }
          })
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          lastError = new Error(data?.error?.message || `HTTP ${response.status}: ${response.statusText}`);
          continue;
        }

        const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawText) {
          lastError = new Error(`Model ${modelName} không trả về dữ liệu JSON.`);
          continue;
        }
        try {
          const parsed = JSON.parse(String(rawText)
            .trim()
            .replace(/^```(?:json)?\s*/i, '')
            .replace(/\s*```$/i, '')
            .trim());
          if (!parsed || !Array.isArray(parsed.blocks)) {
            throw new Error('Phản hồi phân loại không có mảng blocks hợp lệ.');
          }
          wfLastWorkingModel = modelName;
          return parsed;
        } catch (error) {
          lastError = error;
        }
      } catch (error) {
        lastError = error.name === 'AbortError'
          ? new Error(`Model ${modelName} đã quá thời gian chờ.`)
          : error;
      } finally {
        clearTimeout(timeoutId);
      }
    }

    throw new Error(lastError?.message || 'Tất cả model phân loại tiểu luận hiện đều thất bại.');
  }

  function isValidHeadingText(text) {
    const numberedOutlineOnly = /^\d+(?:\.\d+)+\.$/.test(text);
    return text.length <= 120 &&
      (numberedOutlineOnly || !/[.!?…]["'”’)\]]*$/.test(text));
  }

  function getNumberedHeadingType(text) {
    const numberMatch = text.match(/^(\d+(?:\.\d+)*)(?:\.)?\s+\S/);
    if (numberMatch) {
      return `heading${Math.min(numberMatch[1].split('.').length, 3)}`;
    }
    if (/^[IVXLCDM]+\.\s+\S/i.test(text)) return 'heading1';
    return /^\d+(?:\.\d+)+\.$/.test(text) ? 'heading2' : '';
  }

  function parseEssayBlocksLocally(rawText) {
    return String(rawText || '')
      .split(/\r?\n+/)
      .map((line) => line
        .replace(/^#{1,6}\s+/, '')
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/__(.*?)__/g, '$1')
        .trim())
      .filter(Boolean)
      .map((text) => {
        let type = 'body';
        if (/^(LỜI MỞ ĐẦU|MỞ ĐẦU|CHƯƠNG\s+\d+\b|PHẦN\s+[IVX\d]+|TIỂU KẾT CHƯƠNG\s+\d+\b|KẾT LUẬN|TÀI LIỆU THAM KHẢO|PHỤ LỤC)\b/i.test(text)) {
          type = 'heading1';
        } else if (/^(Hình|Bảng|\[HÌNH|\[BẢNG|Figure|Table)\s*\d*/i.test(text)) {
          type = 'caption';
        } else {
          const headingType = getNumberedHeadingType(text);
          if (headingType && isValidHeadingText(text)) type = headingType;
        }
        return { type, text };
      });
  }

  function normalizeWordEssayBlocks(rawBlocks) {
    const allowedTypes = new Set(['heading1', 'heading2', 'heading3', 'caption', 'body']);
    const blocks = rawBlocks.map((block) => {
      const type = String(block?.type || '').trim().toLowerCase();
      const text = String(block?.text || '').trim();
      if (!allowedTypes.has(type) || !text) {
        throw new Error('Phản hồi AI có đoạn không hợp lệ hoặc thiếu nội dung.');
      }
      return { type, text };
    });
    if (!blocks.length) throw new Error('AI không trả về đoạn nội dung tiểu luận nào.');
    return blocks;
  }

  function cleanWordEssayText(text) {
    return String(text || '')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/__(.*?)__/g, '$1')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeTemplateBlocks(blocks, typeMap, cleanText = false) {
    return blocks.map((block) => ({
      type: typeMap[block.type] || 'body',
      text: cleanText ? cleanWordEssayText(block.text) : String(block.text || '').trim()
    }));
  }

  function parseEssayMembers(rawStudentInfo) {
    return String(rawStudentInfo || '')
      .split(/\r?\n|;/)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry, index) => {
        const parts = entry.split(/\s*\|\s*|\s+-\s+/).map((part) => part.trim()).filter(Boolean);
        const mssvMatch = entry.match(/\b\d{5,}\b/);
        const namePart = parts[0] || entry;
        const name = namePart
          .replace(/^\s*\d+[.)]\s*/, '')
          .replace(mssvMatch?.[0] || '', '')
          .replace(/\b(?:MSSV|ID)\s*:?\s*/i, '')
          .replace(/[|,\s-]+$/g, '')
          .trim() || namePart;
        return {
          stt: index + 1,
          name,
          mssv: mssvMatch?.[0] || '',
          task: 'Theo phân công',
          progress: '100%'
        };
      });
  }

  async function exportTemplateDocx(templateType, filename, data) {
    const response = await fetch('http://127.0.0.1:8000/api/export-template', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template_type: templateType, filename, data })
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => null);
      throw new Error(errorBody?.detail || `Backend xuất DOCX lỗi HTTP ${response.status}.`);
    }
    const blob = await response.blob();
    if (!blob.size) throw new Error('Backend trả về file DOCX rỗng.');
    return blob;
  }

  async function createWordEssayDocument(preset, includeCover, cover, blocks) {
    const docxApi = window.docx;
    if (
      !docxApi?.Document || !docxApi?.Paragraph || !docxApi?.TextRun || !docxApi?.Packer ||
      !docxApi?.TableOfContents || !docxApi?.PageBreak || !docxApi?.Footer || !docxApi?.PageNumber
    ) {
      throw new Error('Không tải đủ thành phần docx.js cần thiết để tạo tiểu luận.');
    }

    const presetSettings = {
      moet_binding: { left: 1984, fontSize: 26 },
      nd30: { left: 1701, fontSize: 28 }
    }[preset];
    if (!presetSettings) throw new Error('Bộ quy chuẩn tiểu luận không hợp lệ.');

    const pageSize = { width: 11906, height: 16838 };
    const pageMargin = { top: 1134, bottom: 1134, left: presetSettings.left, right: 1134 };
    const center = docxApi.AlignmentType?.CENTER || 'center';
    const justified = docxApi.AlignmentType?.JUSTIFIED || 'both';
    const mainParagraphs = [];
    let chapterCount = 0;

    blocks.forEach((block) => {
      const sourceText = block.type === 'bullet'
        ? block.text.replace(/^[-•*+]\s+/, '')
        : block.text;
      const text = cleanWordEssayText(sourceText);
      if (!text) return;

      let options = {
        spacing: { line: 360, after: 120 },
        children: [new docxApi.TextRun({
          text,
          font: 'Times New Roman',
          size: presetSettings.fontSize
        })]
      };

      if (block.type === 'chapter') {
        const pageBreakBefore = chapterCount > 0;
        chapterCount += 1;
        options = {
          heading: docxApi.HeadingLevel?.HEADING_1,
          alignment: center,
          pageBreakBefore,
          spacing: { before: 240, after: 300, line: 360 },
          children: [new docxApi.TextRun({
            text: text.toLocaleUpperCase('vi-VN'),
            bold: true,
            font: 'Times New Roman',
            size: 30
          })]
        };
      } else if (block.type === 'heading1') {
        options = {
          heading: docxApi.HeadingLevel?.HEADING_2,
          spacing: { before: 240, after: 120, line: 360 },
          children: [new docxApi.TextRun({
            text,
            bold: true,
            font: 'Times New Roman',
            size: presetSettings.fontSize
          })]
        };
      } else if (block.type === 'heading2') {
        options = {
          heading: docxApi.HeadingLevel?.HEADING_3,
          spacing: { before: 120, after: 80, line: 360 },
          children: [new docxApi.TextRun({
            text,
            bold: true,
            italics: true,
            font: 'Times New Roman',
            size: presetSettings.fontSize
          })]
        };
      } else if (block.type === 'heading3') {
        options = {
          spacing: { before: 80, after: 60, line: 360 },
          children: [new docxApi.TextRun({
            text,
            italics: true,
            font: 'Times New Roman',
            size: presetSettings.fontSize
          })]
        };
      } else if (block.type === 'body') {
        options = {
          alignment: justified,
          indent: { firstLine: 720 },
          spacing: { line: 360, after: 120 },
          children: [new docxApi.TextRun({
            text,
            font: 'Times New Roman',
            size: presetSettings.fontSize
          })]
        };
      } else if (block.type === 'bullet') {
        options = {
          alignment: justified,
          bullet: { level: 0 },
          indent: { left: 720 },
          spacing: { line: 360, after: 120 },
          children: [new docxApi.TextRun({
            text,
            font: 'Times New Roman',
            size: presetSettings.fontSize
          })]
        };
      } else if (block.type === 'caption') {
        options = {
          alignment: center,
          spacing: { line: 300, after: 120 },
          children: [new docxApi.TextRun({
            text,
            italics: true,
            font: 'Times New Roman',
            size: 24
          })]
        };
      }
      mainParagraphs.push(new docxApi.Paragraph(options));
    });

    const sections = [];
    if (includeCover) {
      const coverParagraphs = [
        new docxApi.Paragraph({
          alignment: center,
          spacing: { after: 180, line: 360 },
          children: [new docxApi.TextRun({
            text: cover.school.trim().toLocaleUpperCase('vi-VN'),
            bold: true,
            font: 'Times New Roman',
            size: presetSettings.fontSize
          })]
        })
      ];
      if (cover.faculty.trim()) {
        coverParagraphs.push(new docxApi.Paragraph({
          alignment: center,
          spacing: { after: 120, line: 360 },
          children: [new docxApi.TextRun({
            text: cover.faculty.trim(),
            font: 'Times New Roman',
            size: presetSettings.fontSize
          })]
        }));
      }
      coverParagraphs.push(
        new docxApi.Paragraph({ spacing: { before: 1100, after: 360 } }),
        new docxApi.Paragraph({
          alignment: center,
          spacing: { after: 300, line: 480 },
          children: [new docxApi.TextRun({
            text: 'TIỂU LUẬN MÔN HỌC',
            bold: true,
            font: 'Times New Roman',
            size: 36
          })]
        })
      );
      if (cover.topic.trim()) {
        coverParagraphs.push(new docxApi.Paragraph({
          alignment: center,
          spacing: { before: 360, after: 360, line: 420 },
          children: [new docxApi.TextRun({
            text: cover.topic.trim().toLocaleUpperCase('vi-VN'),
            bold: true,
            font: 'Times New Roman',
            size: 32
          })]
        }));
      }
      if (cover.lecturer.trim()) {
        coverParagraphs.push(new docxApi.Paragraph({
          alignment: center,
          spacing: { before: 900, after: 120 },
          children: [new docxApi.TextRun({
            text: `Giảng viên hướng dẫn: ${cover.lecturer.trim()}`,
            font: 'Times New Roman',
            size: presetSettings.fontSize
          })]
        }));
      }
      if (cover.student.trim()) {
        coverParagraphs.push(new docxApi.Paragraph({
          alignment: center,
          spacing: { before: 180, after: 120 },
          children: [new docxApi.TextRun({
            text: `Sinh viên: ${cover.student.trim()}`,
            font: 'Times New Roman',
            size: presetSettings.fontSize
          })]
        }));
      }
      coverParagraphs.push(new docxApi.Paragraph({
        children: [new docxApi.PageBreak()]
      }));
      coverParagraphs.push(
        new docxApi.Paragraph({
          alignment: center,
          spacing: { after: 240 },
          children: [new docxApi.TextRun({
            text: 'MỤC LỤC',
            bold: true,
            font: 'Times New Roman',
            size: 28
          })]
        }),
        new docxApi.TableOfContents('Mục lục', { hyperlink: true, headingStyleRange: '1-3' }),
        ...blocks
          .filter((block) => ['chapter', 'heading1', 'heading2', 'heading3'].includes(block.type))
          .map((block) => {
            const text = cleanWordEssayText(block.text);
            const level = {
              chapter: 0,
              heading1: 360,
              heading2: 720,
              heading3: 1080
            }[block.type];
            return text ? new docxApi.Paragraph({
              indent: { left: level },
              spacing: { line: 360, after: 60 },
              children: [new docxApi.TextRun({
                text: block.type === 'chapter' ? text.toLocaleUpperCase('vi-VN') : text,
                bold: block.type === 'chapter',
                font: 'Times New Roman',
                size: 26
              })]
            }) : null;
          })
          .filter(Boolean)
      );
      sections.push({
        properties: {
          page: {
            size: pageSize,
            margin: pageMargin,
            borders: {
              pageBorders: {
                display: docxApi.PageBorderDisplay.FIRST_PAGE,
                offsetFrom: docxApi.PageBorderOffsetFrom.PAGE
              },
              pageBorderTop: {
                style: docxApi.BorderStyle.DOUBLE,
                size: 12,
                space: 24,
                color: '000000'
              },
              pageBorderBottom: {
                style: docxApi.BorderStyle.DOUBLE,
                size: 12,
                space: 24,
                color: '000000'
              },
              pageBorderLeft: {
                style: docxApi.BorderStyle.DOUBLE,
                size: 12,
                space: 24,
                color: '000000'
              },
              pageBorderRight: {
                style: docxApi.BorderStyle.DOUBLE,
                size: 12,
                space: 24,
                color: '000000'
              }
            }
          }
        },
        children: coverParagraphs
      });
    }

    const footer = new docxApi.Footer({
      children: [new docxApi.Paragraph({
        alignment: center,
        children: [new docxApi.TextRun({
          children: [docxApi.PageNumber.CURRENT],
          font: 'Times New Roman',
          size: 24
        })]
      })]
    });
    sections.push({
      properties: {
        type: includeCover ? docxApi.SectionType.NEXT_PAGE : undefined,
        page: {
          size: pageSize,
          margin: pageMargin,
          pageNumbers: {
            start: 1,
            formatType: docxApi.NumberFormat?.DECIMAL || 'decimal'
          }
        }
      },
      footers: { default: footer },
      children: mainParagraphs
    });

    const document = new docxApi.Document({
      styles: {
        default: {
          document: {
            run: { font: 'Times New Roman', size: presetSettings.fontSize },
            paragraph: { spacing: { line: 360 } }
          }
        }
      },
      sections
    });
    return docxApi.Packer.toBlob(document);
  }

  function initializeWordEssayFeature() {
    const essayPanel = document.getElementById('wf-essay-panel');
    const coverFields = document.getElementById('wf-essay-cover-fields');
    const facultyInput = document.getElementById('wf-essay-faculty');
    const typeInput = document.getElementById('wf-essay-type');
    const subjectInput = document.getElementById('wf-essay-subject');
    const topicInput = document.getElementById('wf-essay-topic');
    const groupInput = document.getElementById('wf-essay-group');
    const studentInput = document.getElementById('wf-essay-student');
    const classInput = document.getElementById('wf-essay-class');
    const lecturerInput = document.getElementById('wf-essay-lecturer');
    const dateInput = document.getElementById('wf-essay-date');
    const fileDropzone = document.getElementById('wf-essay-file-dropzone');
    const fileInput = document.getElementById('wf-essay-file-input');
    const fileSelectButton = document.getElementById('wf-essay-file-select-btn');
    const fileName = document.getElementById('wf-essay-file-name');
    const fileNameText = document.getElementById('wf-essay-file-name-text');
    const fileRemoveButton = document.getElementById('wf-essay-file-remove-btn');
    const essayInput = document.getElementById('wf-essay-input');
    const inputStats = document.getElementById('wf-essay-input-stats');
    const processButton = document.getElementById('wf-process-essay-btn');
    const validationBox = document.getElementById('wf-essay-validation-box');
    const downloadButton = document.getElementById('wf-download-essay-btn');
    if (
      !essayPanel || !coverFields || !facultyInput || !typeInput || !subjectInput ||
      !topicInput || !groupInput || !studentInput || !classInput || !lecturerInput || !dateInput || !fileDropzone ||
      !fileInput || !fileSelectButton || !fileName || !fileNameText || !fileRemoveButton ||
      !essayInput || !inputStats || !processButton || !validationBox || !downloadButton
    ) {
      return;
    }

    let generatedBlob = null;
    let generatedFilename = '';
    const essayInputs = [
      facultyInput,
      typeInput,
      subjectInput,
      topicInput,
      groupInput,
      studentInput,
      classInput,
      lecturerInput,
      dateInput,
      essayInput
    ];
    const invalidateOutput = () => {
      generatedBlob = null;
      generatedFilename = '';
      downloadButton.disabled = true;
      validationBox.hidden = true;
      validationBox.replaceChildren();
      validationBox.classList.remove('has-warning', 'is-invalid');
    };
    const updateInputStats = () => {
      inputStats.textContent = `${essayInput.value.length.toLocaleString()} ký tự`;
    };
    const clearSelectedFile = (clearText) => {
      fileInput.value = '';
      fileDropzone.classList.remove('has-file');
      fileName.hidden = true;
      fileNameText.textContent = '';
      if (clearText) {
        essayInput.value = '';
        essayInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    };
    const setEssayControlsDisabled = (disabled) => {
      essayInputs.forEach((element) => { element.disabled = disabled; });
      fileSelectButton.disabled = disabled;
      fileRemoveButton.disabled = disabled;
      processButton.disabled = disabled;
    };

    updateInputStats();
    essayInput.addEventListener('input', () => {
      updateInputStats();
      invalidateOutput();
    });
    essayInputs.slice(0, -1).forEach((element) => {
      element.addEventListener('input', invalidateOutput);
      element.addEventListener('change', invalidateOutput);
    });

    fileSelectButton.addEventListener('click', () => fileInput.click());
    fileRemoveButton.addEventListener('click', () => clearSelectedFile(true));
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      const extension = file.name.split('.').pop().toLowerCase();
      if (extension !== 'docx' && extension !== 'txt') {
        clearSelectedFile(false);
        setMascotStatus('Định dạng bản thảo chưa được hỗ trợ. Hãy chọn file .docx hoặc .txt.', 'error');
        return;
      }

      fileNameText.textContent = file.name;
      fileName.hidden = false;
      fileDropzone.classList.add('has-file');
      setEssayControlsDisabled(true);
      fileSelectButton.disabled = true;
      fileRemoveButton.disabled = true;
      setMascotStatus(`Đang đọc bản thảo ${file.name}...`, 'loading');
      try {
        let extractedText;
        if (extension === 'docx') {
          if (!window.mammoth?.convertToHtml) {
            throw new Error('Không tải được thư viện Mammoth từ assets/mammoth.browser.min.js.');
          }
          const result = await window.mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
          extractedText = extractWordEssayDocxText(result.value || '');
        } else {
          extractedText = await file.text();
        }
        if (!extractedText.trim()) {
          throw new Error('Không tìm thấy nội dung văn bản trong bản thảo.');
        }
        essayInput.value = extractedText;
        essayInput.dispatchEvent(new Event('input', { bubbles: true }));
        setMascotStatus(`Đã đọc bản thảo ${file.name}.`, 'idle');
      } catch (error) {
        clearSelectedFile(false);
        console.error('Lỗi khi đọc bản thảo tiểu luận:', error);
        setMascotStatus(`Không thể đọc bản thảo ${file.name}: ${error.message}`, 'error');
      } finally {
        setEssayControlsDisabled(false);
      }
    });

    processButton.addEventListener('click', async () => {
      const sourceText = essayInput.value.trim();
      if (!sourceText) {
        setMascotStatus('Hãy chọn file hoặc nhập nội dung bản thảo tiểu luận.', 'error');
        return;
      }
      invalidateOutput();
      setEssayControlsDisabled(true);
      try {
        const { geminiApiKey } = await chrome.storage.local.get('geminiApiKey');
        const chunks = splitWordEssayInput(sourceText);
        const classifiedBlocks = [];
        let usedLocalParser = false;
        if (!geminiApiKey) {
          usedLocalParser = true;
          setMascotStatus('Chưa có Gemini API Key; đang phân loại bản thảo cục bộ...', 'loading');
          classifiedBlocks.push(...normalizeWordEssayBlocks(parseEssayBlocksLocally(sourceText)));
        } else {
          try {
            for (let index = 0; index < chunks.length; index += 1) {
              setMascotStatus(
                chunks.length > 1
                  ? `Đang phân loại đoạn ${index + 1}/${chunks.length}...`
                  : 'Đang phân loại cấu trúc tiểu luận...',
                'loading'
              );
              const classified = await classifyWordEssayChunk(chunks[index], geminiApiKey);
              classifiedBlocks.push(...normalizeWordEssayBlocks(classified.blocks));
            }
          } catch (aiErr) {
            console.warn('Phân loại Tiểu luận bằng AI thất bại; chuyển sang phân tích cục bộ:', aiErr);
            usedLocalParser = true;
            classifiedBlocks.length = 0;
            setMascotStatus('Gemini gặp sự cố; đang phân loại bản thảo cục bộ...', 'loading');
            classifiedBlocks.push(...normalizeWordEssayBlocks(parseEssayBlocksLocally(sourceText)));
          }
        }

        const members = parseEssayMembers(studentInput.value);
        const groupName = groupInput.value.trim();
        const coverGroupName = groupName.replace(/^\s*Nhóm:\s*/i, '').trim();
        const studentInfoCover = [
          coverGroupName
            ? (/\bNhóm\b/i.test(coverGroupName) ? coverGroupName : `Nhóm: ${coverGroupName}`)
            : '',
          ...members.map((member) =>
            `${member.stt}. ${member.name}${member.mssv ? ` - MSSV: ${member.mssv}` : ''}`
          )
        ].filter(Boolean).join('\n');
        const templateBlocks = normalizeTemplateBlocks(classifiedBlocks, {
          heading1: 'heading1',
          heading2: 'heading2',
          heading3: 'heading3',
          caption: 'caption',
          body: 'body'
        }, true);
        const templateData = {
          faculty_name: facultyInput.value.trim(),
          essay_type: typeInput.value.trim(),
          subject_name: subjectInput.value.trim(),
          essay_title: topicInput.value.trim(),
          group_name: groupName,
          student_info_cover: studentInfoCover,
          class_name: classInput.value.trim(),
          lecturer: lecturerInput.value.trim(),
          date: dateInput.value.trim(),
          members,
          blocks: templateBlocks
        };
        const filename = `${slugWordFormTitle(topicInput.value || 'Tieu luan')}.docx`;
        const blob = await exportTemplateDocx('essay', filename, templateData);
        const documentText = [
          templateData.faculty_name,
          templateData.essay_type,
          templateData.subject_name,
          templateData.essay_title,
          templateData.student_info_cover,
          templateData.class_name,
          templateData.lecturer,
          templateData.date,
          ...members.flatMap((member) => [member.name, member.mssv]),
          ...templateBlocks.map((block) => block.text)
        ].join('\n');
        const hasCorruptCharacters = /[\uFFFD]|\$!#|[\uE000-\uF8FF]/.test(documentText);
        const heading1Count = templateBlocks.filter((block) => block.type === 'heading1').length;
        const heading2Count = templateBlocks.filter((block) => block.type === 'heading2').length;
        const bodyParagraphCount = templateBlocks.filter((block) => block.type === 'body').length;
        const imageCount = (documentText.match(/\[HÌNH\b[^\]]*\]/gi) || []).length;
        const tableCount = (documentText.match(/\[BẢNG\b[^\]]*\]/gi) || []).length;
        const warnings = [];
        if (imageCount || tableCount) {
          warnings.push(
            `Cần chèn lại ${imageCount} hình [HÌNH X] và ${tableCount} bảng [BẢNG X] trong tệp Word.`
          );
        }
        const valid = blob.size > 0 && templateBlocks.length > 0 && !hasCorruptCharacters;
        const lines = [
          `Số đề mục cấp 1: ${heading1Count}; cấp 2: ${heading2Count}.`,
          `Số thành viên: ${members.length}.`,
          `Số đoạn văn xuôi: ${bodyParagraphCount}.`,
          `Kiểm tra ký tự lạ: ${hasCorruptCharacters ? 'Phát hiện ký tự lỗi mã hóa.' : 'Không phát hiện ký tự lỗi mã hóa.'}`,
          'Khuôn mẫu: template_tieu_luan.docx.',
          ...(usedLocalParser
            ? ['Ghi chú: Phân loại cấu trúc tự động bằng bộ phân tích cục bộ do máy chủ AI đang bận.']
            : []),
          `Kiểm tra file DOCX: ${blob.size > 0 ? `${blob.size.toLocaleString()} byte` : 'File rỗng'}.`
        ];
        renderWordFormValidation(validationBox, { valid, warnings, lines });
        const tocUpdateHint = document.createElement('small');
        tocUpdateHint.className = 'wf-validation-line';
        tocUpdateHint.textContent = 'Nhấn Ctrl + A rồi bấm F9 trong Word để cập nhật mục lục và số trang.';
        validationBox.appendChild(tocUpdateHint);
        if (!valid) {
          setMascotStatus(
            templateBlocks.length === 0
              ? 'Không nhận diện được nội dung tiểu luận hợp lệ; chưa thể tải file Word.'
              : 'Kiểm định phát hiện lỗi ký tự hoặc file rỗng; chưa thể tải file Word.',
            'error'
          );
          return;
        }

        generatedBlob = blob;
        generatedFilename = filename;
        downloadButton.disabled = false;
        setMascotStatus(
          usedLocalParser
            ? 'Đã tạo file tiểu luận bằng phân tích cục bộ; hãy rà soát lại cấu trúc.'
            : warnings.length
            ? 'Đã tạo file tiểu luận; hãy xem cảnh báo hình/bảng trước khi tải.'
            : 'Đã chuẩn hóa và kiểm định tiểu luận thành công.',
          warnings.length ? 'error' : 'idle'
        );
      } catch (error) {
        console.error('Lỗi khi chuẩn hóa tiểu luận:', error);
        renderWordFormValidation(validationBox, {
          valid: false,
          warnings: [],
          lines: [],
          error: `Không thể hoàn tất: ${error.message}`
        });
        setMascotStatus(`Không thể chuẩn hóa tiểu luận: ${error.message}`, 'error');
      } finally {
        setEssayControlsDisabled(false);
      }
    });

    downloadButton.addEventListener('click', () => {
      if (!generatedBlob || downloadButton.disabled) return;
      const downloadUrl = URL.createObjectURL(generatedBlob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = generatedFilename;
      link.hidden = true;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      setMascotStatus(`Đã tải ${generatedFilename}.`, 'idle');
    });
  }

  let cmuLastWorkingModel = '';

  function toInvertedName(fullName) {
    const name = String(fullName || '').trim();
    if (!name || name.includes(',')) return name;
    const parts = name.split(/\s+/);
    if (parts.length < 2) return name;
    return `${parts.pop()}, ${parts.join(' ')}`;
  }

  function parseCmuBlocksLocally(rawText) {
    let source = '';
    try {
      source = String(rawText || '');
      const blocks = source
        .split(/\r?\n+/)
        .map((text) => text.trim())
        .filter(Boolean)
        .map((text) => {
          let type = 'body';
          if (/^(?:\[HÌNH\s*[^\]]*\]|\[BẢNG\s*[^\]]*\]|Figure\b|Table\b)/i.test(text)) {
            type = 'caption';
          } else if (/^(LỜI MỞ ĐẦU|MỞ ĐẦU|CHƯƠNG\s+\d+\b|TIỂU KẾT CHƯƠNG\s+\d+\b|KẾT LUẬN|TÀI LIỆU THAM KHẢO)\b/i.test(text)) {
            type = 'heading1';
          } else {
            const headingType = getNumberedHeadingType(text) ||
              (/^[a-z]\)\s+\S/i.test(text) ? 'heading2' : '');
            if (headingType && isValidHeadingText(text)) type = headingType;
          }
          return { type, text };
        });
      return blocks.length || !source.trim()
        ? blocks
        : [{ type: 'body', text: source.trim() }];
    } catch (error) {
      console.error('Lỗi khi phân tích cục bộ báo cáo CMU:', error);
      return source.trim() ? [{ type: 'body', text: source.trim() }] : [];
    }
  }

  function normalizeCmuBlocks(rawBlocks) {
    const allowedTypes = new Set(['heading1', 'heading2', 'heading3', 'caption', 'body']);
    if (!Array.isArray(rawBlocks)) {
      throw new Error('Phản hồi phân loại CMU không có mảng blocks.');
    }
    const blocks = rawBlocks.map((block) => {
      const type = String(block?.type || '').trim();
      const text = String(block?.text || '').trim();
      if (!allowedTypes.has(type) || !text) {
        throw new Error('Phản hồi phân loại CMU có đoạn không hợp lệ hoặc thiếu nội dung.');
      }
      return { type, text };
    });
    if (!blocks.length) throw new Error('Không nhận diện được nội dung báo cáo CMU.');
    return blocks;
  }

  function buildCmuClassificationPrompt(rawText) {
    return `Phân loại cấu trúc báo cáo kỹ thuật thành JSON thuần. Tuyệt đối giữ nguyên từng chữ, số liệu, dấu câu, thứ tự, mọi trích dẫn như [1], toàn bộ Tài liệu tham khảo và placeholder [HÌNH X]/[BẢNG X]; không sửa, không tóm tắt, không diễn đạt lại, không thêm hoặc lược bỏ nội dung. Mỗi đoạn chỉ được gán đúng một trong 5 nhãn: heading1, heading2, heading3, caption, body.
Chỉ gắn nhãn heading cho tiêu đề ngắn không quá 120 ký tự; đoạn văn phân tích, câu hoàn chỉnh hoặc tiêu đề dài hơn 120 ký tự phải là body. Không gắn nhãn heading nếu nội dung kết thúc bằng dấu câu kết câu, trừ dòng chỉ là số mục như 1.1.
- heading1: tiêu đề cấp cao như "1. Introduction", LỜI MỞ ĐẦU, MỞ ĐẦU, CHƯƠNG <số>, TIỂU KẾT CHƯƠNG <số>, KẾT LUẬN, TÀI LIỆU THAM KHẢO.
- heading2: mục cấp 2 như "a) ..." hoặc "1.1 ...".
- heading3: mục cấp 3 như "1.1.1 ...".
- caption: placeholder [HÌNH X]/[BẢNG X] hoặc dòng chú thích Figure X.Y/Table X.Y.
- body: mọi nội dung còn lại, kể cả dòng liệt kê.
Chỉ trả về JSON hợp lệ, không thêm Markdown hay giải thích, theo dạng {"blocks":[{"type":"heading1","text":"..."}]}.

BẢN THẢO:
${rawText}`;
  }

  async function parseCmuBlocks(rawText, apiKey) {
    const source = String(rawText || '').trim();
    if (!source) return { blocks: [], usedLocalParser: true };

    if (apiKey) {
      const preferredModels = ['gemini-3.5-flash-lite', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'];
      const models = cmuLastWorkingModel && preferredModels.includes(cmuLastWorkingModel)
        ? [cmuLastWorkingModel, ...preferredModels.filter((modelName) => modelName !== cmuLastWorkingModel)]
        : preferredModels;
      let lastError = null;
      for (const modelName of models) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        try {
          const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`;
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              contents: [{ parts: [{ text: buildCmuClassificationPrompt(source) }] }],
              generationConfig: { responseMimeType: 'application/json', temperature: 0 }
            })
          });
          const data = await response.json().catch(() => null);
          if (!response.ok) {
            lastError = new Error(data?.error?.message || `HTTP ${response.status}: ${response.statusText}`);
            continue;
          }
          const rawResponse = data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!rawResponse) {
            lastError = new Error(`Model ${modelName} không trả về dữ liệu JSON.`);
            continue;
          }
          try {
            const parsed = JSON.parse(String(rawResponse)
              .trim()
              .replace(/^```(?:json)?\s*/i, '')
              .replace(/\s*```$/i, '')
              .trim());
            const blocks = normalizeCmuBlocks(parsed?.blocks);
            const classifiedText = blocks.map((block) => block.text).join(' ').replace(/\s+/g, ' ').trim();
            if (classifiedText !== source.replace(/\s+/g, ' ').trim()) {
              throw new Error('Phân loại Gemini đã làm thay đổi nội dung nguyên văn.');
            }
            cmuLastWorkingModel = modelName;
            return { blocks, usedLocalParser: false };
          } catch (error) {
            lastError = error;
          }
        } catch (error) {
          lastError = error.name === 'AbortError'
            ? new Error(`Model ${modelName} đã quá thời gian chờ.`)
            : error;
        } finally {
          clearTimeout(timeoutId);
        }
      }
      console.warn('Phân loại Báo cáo CMU bằng Gemini thất bại; dùng bộ phân tích cục bộ:', lastError);
    }

    try {
      const blocks = normalizeCmuBlocks(parseCmuBlocksLocally(source));
      return { blocks, usedLocalParser: true };
    } catch (error) {
      console.error('Không thể phân loại Báo cáo CMU; dùng toàn văn làm nội dung:', error);
      return { blocks: [{ type: 'body', text: source }], usedLocalParser: true };
    }
  }

  function createCmuTextParagraph(docxApi, text, options = {}) {
    const {
      alignment,
      bold = false,
      color,
      font = 'Times New Roman',
      italic = false,
      size = 28,
      spacing,
      style
    } = options;
    return new docxApi.Paragraph({
      alignment,
      spacing,
      style,
      children: [new docxApi.TextRun({
        text: String(text || ''),
        bold,
        color,
        font,
        italics: italic,
        size
      })]
    });
  }

  function createCmuCell(docxApi, text, options = {}) {
    const {
      bold = false,
      columnSpan,
      fill,
      alignment
    } = options;
    const lines = String(text || '').split(/\r?\n/);
    return new docxApi.TableCell({
      columnSpan,
      verticalAlign: docxApi.VerticalAlign?.CENTER,
      shading: fill ? { fill } : undefined,
      margins: { top: 80, bottom: 80, left: 100, right: 100 },
      children: lines.map((line) => createCmuTextParagraph(docxApi, line, {
        bold,
        alignment
      }))
    });
  }

  function createCmuDocumentTable(docxApi, rows, columnWidths) {
    const border = { style: docxApi.BorderStyle.SINGLE, size: 4, color: '808080' };
    return new docxApi.Table({
      rows: rows.map((cells) => new docxApi.TableRow({ children: cells })),
      width: { size: columnWidths.reduce((sum, width) => sum + width, 0), type: docxApi.WidthType.DXA },
      columnWidths,
      margins: { top: 80, bottom: 80, left: 100, right: 100 },
      borders: {
        top: border,
        bottom: border,
        left: border,
        right: border,
        insideHorizontal: border,
        insideVertical: border
      }
    });
  }

  function toCmuCaption(text, type) {
    const isFigure = type === 'figure';
    const prefix = isFigure ? /^(?:\[HÌNH\s*[^\]]*\]|Figure\s+\d+(?:\.\d+)?\.?)\s*/i : /^(?:\[BẢNG\s*[^\]]*\]|Table\s+\d+(?:\.\d+)?\.?)\s*/i;
    return String(text || '')
      .replace(prefix, '')
      .trim()
      .replace(/[.。]+$/g, '')
      .trim();
  }

  async function createCmuDocument(fields, blocks) {
    const docxApi = window.docx;
    if (
      !docxApi?.Document || !docxApi?.Paragraph || !docxApi?.TextRun || !docxApi?.Packer ||
      !docxApi?.Table || !docxApi?.TableRow || !docxApi?.TableCell || !docxApi?.SimpleField ||
      !docxApi?.TableOfContents || !docxApi?.PageBreak || !docxApi?.Footer ||
      !docxApi?.ImageRun || !docxApi?.PageNumber
    ) {
      throw new Error('Không tải đủ thành phần docx.js cần thiết để tạo Báo cáo CMU.');
    }

    const pageSize = { width: 11906, height: 16838 };
    const pageMargin = { top: 1440, bottom: 1440, left: 1440, right: 1440 };
    const center = docxApi.AlignmentType?.CENTER || 'center';
    const justified = docxApi.AlignmentType?.JUSTIFIED || 'both';
    const coverParagraphs = [];
    let logoRun = null;
    try {
      const logoBuffer = await fetch(chrome.runtime.getURL('assets/dtu_logo.png'))
        .then((response) => {
          if (!response.ok) throw new Error(`Không tải được logo DTU: HTTP ${response.status}.`);
          return response.arrayBuffer();
        });
      logoRun = new docxApi.ImageRun({
        data: logoBuffer,
        transformation: { width: 220, height: 68 }
      });
    } catch (error) {
      console.warn('Thiếu logo DTU; tiếp tục tạo Báo cáo CMU không có logo:', error);
    }

    if (logoRun) {
      coverParagraphs.push(new docxApi.Paragraph({
        alignment: center,
        spacing: { after: 120 },
        children: [logoRun]
      }));
    }
    coverParagraphs.push(
      createCmuTextParagraph(docxApi, 'DUY TAN UNIVERSITY', {
        alignment: center,
        bold: true,
        color: 'B81D24',
        size: 28,
        spacing: { after: 60 }
      }),
      createCmuTextParagraph(docxApi, 'INTERNATIONAL SCHOOL', {
        alignment: center,
        bold: true,
        color: '595959',
        size: 28,
        spacing: { after: 480 }
      }),
      createCmuTextParagraph(docxApi, fields.courseName, {
        alignment: center,
        size: 50,
        spacing: { after: 100 }
      }),
      createCmuTextParagraph(docxApi, fields.courseCode, {
        alignment: center,
        size: 26,
        spacing: { after: 360 }
      }),
      createCmuTextParagraph(docxApi, fields.docType, {
        alignment: center,
        bold: true,
        size: 40,
        spacing: { after: 240 }
      }),
      createCmuTextParagraph(docxApi, fields.version, {
        alignment: center,
        size: 24,
        spacing: { after: 80 }
      }),
      createCmuTextParagraph(docxApi, `Date: ${fields.date}`, {
        alignment: center,
        size: 24,
        spacing: { after: 520 }
      }),
      createCmuTextParagraph(docxApi, fields.title, {
        alignment: center,
        bold: true,
        size: 36,
        spacing: { after: 420 }
      }),
      createCmuTextParagraph(docxApi, `Created by: ${fields.createdBy}`, {
        alignment: center,
        size: 26,
        spacing: { after: 100 }
      }),
      createCmuTextParagraph(docxApi, `Full Name: ${fields.fullName}`, {
        alignment: center,
        size: 26,
        spacing: { after: 100 }
      }),
      createCmuTextParagraph(docxApi, `Student ID: ${fields.studentId}`, {
        alignment: center,
        size: 26,
        spacing: { after: 80 }
      }),
      createCmuTextParagraph(docxApi, 'Approved by', {
        alignment: center,
        bold: true,
        size: 26,
        spacing: { before: 3000, after: 120 }
      }),
      createCmuTextParagraph(docxApi, fields.mentor, {
        alignment: center,
        size: 26,
        spacing: { after: 100 }
      }),
      createCmuTextParagraph(docxApi, `${fields.courseName} - Mentor:`, {
        alignment: center,
        size: 26,
        spacing: { after: 360 }
      }),
      createCmuTextParagraph(docxApi, 'Name                 Signature                 Date', {
        alignment: center,
        size: 24
      })
    );

    const projectRows = [
      [
        createCmuCell(docxApi, 'Project acronym', { bold: true, fill: 'F2F2F2' }),
        createCmuCell(docxApi, fields.acronym, { columnSpan: 3 })
      ],
      [
        createCmuCell(docxApi, 'Project Title', { bold: true, fill: 'F2F2F2' }),
        createCmuCell(docxApi, fields.title, { columnSpan: 3 })
      ],
      [
        createCmuCell(docxApi, 'Start Date', { bold: true, fill: 'F2F2F2' }),
        createCmuCell(docxApi, fields.startDate),
        createCmuCell(docxApi, 'End Date', { bold: true, fill: 'F2F2F2' }),
        createCmuCell(docxApi, fields.endDate)
      ],
      [
        createCmuCell(docxApi, 'Lead Institution', { bold: true, fill: 'F2F2F2' }),
        createCmuCell(docxApi, 'International School, Duy Tan University', { columnSpan: 3 })
      ],
      [
        createCmuCell(docxApi, 'Project Mentor', { bold: true, fill: 'F2F2F2' }),
        createCmuCell(docxApi, toInvertedName(fields.mentor), { columnSpan: 3 })
      ],
      [
        createCmuCell(docxApi, 'Scrum master/ Project Leader & contact details', {
          bold: true,
          fill: 'F2F2F2'
        }),
        createCmuCell(docxApi, [
          toInvertedName(fields.fullName),
          fields.contact,
          fields.studentId ? `ID: ${fields.studentId}` : ''
        ].filter(Boolean).join('\n'), { columnSpan: 3 })
      ],
      [
        createCmuCell(docxApi, 'Partner Organization', { bold: true, fill: 'F2F2F2' }),
        createCmuCell(docxApi, 'Duy Tan University', { columnSpan: 3 })
      ],
      [
        createCmuCell(docxApi, 'Demo Link', { bold: true, fill: 'F2F2F2' }),
        createCmuCell(docxApi, fields.demoLink, { columnSpan: 3 })
      ]
    ];
    const revisionRows = [
      ['Version', 'Date', 'Description'].map((text) =>
        createCmuCell(docxApi, text, { bold: true, fill: 'F2F2F2' })
      ),
      [
        createCmuCell(docxApi, 'Draft'),
        createCmuCell(docxApi, fields.date),
        createCmuCell(docxApi, 'Initial draft')
      ],
      [
        createCmuCell(docxApi, 'v1.0'),
        createCmuCell(docxApi, fields.date),
        createCmuCell(docxApi, 'Version 1.0')
      ]
    ];
    const section2Paragraphs = [
      createCmuTextParagraph(docxApi, 'PROJECT INFORMATION', {
        bold: true,
        size: 28,
        spacing: { after: 120 }
      }),
      createCmuDocumentTable(docxApi, projectRows, [1900, 3226, 1600, 2300]),
      createCmuTextParagraph(docxApi, 'REVISION HISTORY', {
        bold: true,
        size: 28,
        spacing: { before: 300, after: 120 }
      }),
      createCmuDocumentTable(docxApi, revisionRows, [1800, 1800, 5426]),
      new docxApi.Paragraph({ children: [new docxApi.PageBreak()] }),
      createCmuTextParagraph(docxApi, 'LIST OF FIGURES', {
        bold: true,
        size: 28,
        spacing: { after: 240 }
      }),
      new docxApi.Paragraph({
        tabStops: [{
          type: docxApi.TabStopType.RIGHT,
          position: 9016,
          leader: docxApi.LeaderType.DOT
        }],
        children: [new docxApi.SimpleField('TOC \\h \\z \\c "Figure"')]
      }),
      createCmuTextParagraph(docxApi, 'Update this field in Word if the figure list is not refreshed automatically.', {
        italic: true,
        size: 20,
        spacing: { before: 100 }
      }),
      new docxApi.Paragraph({ children: [new docxApi.PageBreak()] }),
      createCmuTextParagraph(docxApi, 'LIST OF TABLES', {
        bold: true,
        size: 28,
        spacing: { after: 240 }
      }),
      new docxApi.Paragraph({
        tabStops: [{
          type: docxApi.TabStopType.RIGHT,
          position: 9016,
          leader: docxApi.LeaderType.DOT
        }],
        children: [new docxApi.SimpleField('TOC \\h \\z \\c "Table"')]
      }),
      new docxApi.Paragraph({ children: [new docxApi.PageBreak()] }),
      createCmuTextParagraph(docxApi, 'TABLE OF CONTENTS', {
        alignment: center,
        bold: true,
        size: 28,
        spacing: { after: 240 }
      }),
      new docxApi.TableOfContents('Table of Contents', {
        hyperlink: true,
        headingStyleRange: '1-2'
      })
    ];

    const mainParagraphs = [];
    let currentSectionNumber = 1;
    let figureNumber = 0;
    let tableNumber = 0;
    const dashedBorder = { style: docxApi.BorderStyle.DASHED, size: 6, color: '94A3B8' };
    const makePlaceholderTable = (text) => new docxApi.Table({
      rows: [new docxApi.TableRow({
        height: { value: 2400, rule: docxApi.HeightRule.ATLEAST },
        children: [new docxApi.TableCell({
          verticalAlign: docxApi.VerticalAlign?.CENTER,
          children: [createCmuTextParagraph(docxApi, text, {
            alignment: center,
            size: 22
          })]
        })]
      })],
      width: { size: 7500, type: docxApi.WidthType.DXA },
      columnWidths: [7500],
      alignment: center,
      borders: {
        top: dashedBorder,
        bottom: dashedBorder,
        left: dashedBorder,
        right: dashedBorder,
        insideHorizontal: dashedBorder,
        insideVertical: dashedBorder
      }
    });

    blocks.forEach((block) => {
      if (block.type === 'section') {
        const number = block.text.match(/^\s*(\d+)\./);
        currentSectionNumber = number ? Number(number[1]) : currentSectionNumber + 1;
        figureNumber = 0;
        tableNumber = 0;
        mainParagraphs.push(new docxApi.Paragraph({
          heading: docxApi.HeadingLevel.HEADING_1,
          spacing: { before: 240, after: 0, line: 312 },
          children: [new docxApi.TextRun({
            text: block.text,
            bold: true,
            color: '000000',
            font: 'Times New Roman',
            size: 28
          })]
        }));
        return;
      }
      if (block.type === 'subsection') {
        mainParagraphs.push(new docxApi.Paragraph({
          heading: docxApi.HeadingLevel.HEADING_2,
          alignment: justified,
          spacing: { line: 312 },
          children: [new docxApi.TextRun({
            text: block.text,
            bold: false,
            italics: true,
            color: '000000',
            font: 'Times New Roman',
            size: 28
          })]
        }));
        return;
      }
      if (block.type === 'figure' || block.type === 'tableCaption') {
        const isFigure = block.type === 'figure';
        const caption = toCmuCaption(block.text, block.type);
        const currentNumber = isFigure ? ++figureNumber : ++tableNumber;
        const label = isFigure ? 'Figure' : 'Table';
        const numberedCaption = new docxApi.Paragraph({
          alignment: center,
          style: 'Caption',
          spacing: { before: 120, after: 120, line: 260 },
          children: [
            new docxApi.TextRun({
              text: `${label} ${currentSectionNumber}.`,
              font: 'Times New Roman',
              size: 22
            }),
            new docxApi.SimpleField(`SEQ ${label} \\* ARABIC \\s 1`, String(currentNumber)),
            new docxApi.TextRun({
              text: caption ? `. ${caption}.` : '.',
              font: 'Times New Roman',
              size: 22
            })
          ]
        });
        if (isFigure) {
          mainParagraphs.push(
            makePlaceholderTable('[Chèn ảnh minh họa tại đây]'),
            numberedCaption
          );
        } else {
          mainParagraphs.push(numberedCaption, makePlaceholderTable('[Chèn bảng số liệu tại đây]'));
        }
        return;
      }
      if (block.type === 'bullet') {
        mainParagraphs.push(new docxApi.Paragraph({
          alignment: justified,
          bullet: { level: 0 },
          indent: { left: 720 },
          spacing: { line: 260, after: 160 },
          children: [new docxApi.TextRun({
            text: block.text.replace(/^[-•*+]\s+/, ''),
            font: 'Times New Roman',
            size: 28
          })]
        }));
        return;
      }
      mainParagraphs.push(new docxApi.Paragraph({
        alignment: justified,
        indent: { firstLine: 720 },
        spacing: { line: 260, after: 160 },
        children: [new docxApi.TextRun({
          text: block.text,
          font: 'Times New Roman',
          size: 28
        })]
      }));
    });

    const footer = new docxApi.Footer({
      children: [new docxApi.Paragraph({
        alignment: center,
        children: [new docxApi.TextRun({
          children: [docxApi.PageNumber.CURRENT],
          font: 'Times New Roman',
          size: 24
        })]
      })]
    });
    const document = new docxApi.Document({
      styles: {
        default: {
          document: {
            run: { font: 'Times New Roman', size: 28 }
          }
        }
      },
      features: { updateFields: true },
      sections: [
        {
          properties: {
            page: { size: pageSize, margin: { ...pageMargin } }
          },
          children: coverParagraphs
        },
        {
          properties: {
            type: docxApi.SectionType.NEXT_PAGE,
            page: { size: pageSize, margin: { ...pageMargin } }
          },
          children: section2Paragraphs
        },
        {
          properties: {
            type: docxApi.SectionType.NEXT_PAGE,
            page: {
              size: pageSize,
              margin: { ...pageMargin },
              pageNumbers: {
                start: 1,
                formatType: docxApi.NumberFormat?.DECIMAL || 'decimal'
              }
            }
          },
          footers: { default: footer },
          children: mainParagraphs
        }
      ]
    });
    return docxApi.Packer.toBlob(document);
  }

  function initializeCmuReportFeature() {
    const panel = document.getElementById('wf-cmu-panel');
    const fieldIds = [
      'wf-cmu-course-name',
      'wf-cmu-course-code',
      'wf-cmu-doc-type',
      'wf-cmu-version',
      'wf-cmu-date',
      'wf-cmu-title',
      'wf-cmu-acronym',
      'wf-cmu-start-date',
      'wf-cmu-end-date',
      'wf-cmu-created-by',
      'wf-cmu-fullname',
      'wf-cmu-student-id',
      'wf-cmu-contact',
      'wf-cmu-mentor',
      'wf-cmu-demo-link'
    ];
    const fields = Object.fromEntries(fieldIds.map((id) => [id, document.getElementById(id)]));
    const fileDropzone = document.getElementById('wf-cmu-file-dropzone');
    const fileInput = document.getElementById('wf-cmu-file-input');
    const fileSelectButton = document.getElementById('wf-cmu-file-select-btn');
    const fileName = document.getElementById('wf-cmu-file-name');
    const fileNameText = document.getElementById('wf-cmu-file-name-text');
    const fileRemoveButton = document.getElementById('wf-cmu-file-remove-btn');
    const reportInput = document.getElementById('wf-cmu-input');
    const processButton = document.getElementById('wf-process-cmu-btn');
    const validationBox = document.getElementById('wf-cmu-validation-box');
    const downloadButton = document.getElementById('wf-download-cmu-btn');
    if (
      !panel || fieldIds.some((id) => !fields[id]) || !fileDropzone || !fileInput ||
      !fileSelectButton || !fileName || !fileNameText || !fileRemoveButton || !reportInput ||
      !processButton || !validationBox || !downloadButton
    ) {
      return;
    }

    let generatedBlob = null;
    let generatedFilename = '';
    const controls = [...Object.values(fields), reportInput];
    const invalidateOutput = () => {
      generatedBlob = null;
      generatedFilename = '';
      downloadButton.disabled = true;
      validationBox.hidden = true;
      validationBox.replaceChildren();
      validationBox.classList.remove('has-warning', 'is-invalid');
    };
    const clearSelectedFile = (clearText) => {
      fileInput.value = '';
      fileDropzone.classList.remove('has-file');
      fileName.hidden = true;
      fileNameText.textContent = '';
      if (clearText) {
        reportInput.value = '';
        reportInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    };
    const setControlsDisabled = (disabled) => {
      controls.forEach((control) => { control.disabled = disabled; });
      fileSelectButton.disabled = disabled;
      fileRemoveButton.disabled = disabled;
      processButton.disabled = disabled;
    };
    const collectFields = () => ({
      courseName: fields['wf-cmu-course-name'].value.trim(),
      courseCode: fields['wf-cmu-course-code'].value.trim(),
      docType: fields['wf-cmu-doc-type'].value.trim(),
      version: fields['wf-cmu-version'].value.trim(),
      date: fields['wf-cmu-date'].value.trim(),
      title: fields['wf-cmu-title'].value.trim(),
      acronym: fields['wf-cmu-acronym'].value.trim(),
      startDate: fields['wf-cmu-start-date'].value.trim(),
      endDate: fields['wf-cmu-end-date'].value.trim(),
      createdBy: fields['wf-cmu-created-by'].value.trim(),
      fullName: fields['wf-cmu-fullname'].value.trim(),
      studentId: fields['wf-cmu-student-id'].value.trim(),
      contact: fields['wf-cmu-contact'].value.trim(),
      mentor: fields['wf-cmu-mentor'].value.trim(),
      demoLink: fields['wf-cmu-demo-link'].value.trim()
    });

    controls.forEach((control) => {
      control.addEventListener('input', invalidateOutput);
      control.addEventListener('change', invalidateOutput);
    });
    fileSelectButton.addEventListener('click', () => fileInput.click());
    fileRemoveButton.addEventListener('click', () => clearSelectedFile(true));
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      invalidateOutput();
      const extension = file.name.split('.').pop().toLowerCase();
      if (extension !== 'docx' && extension !== 'txt') {
        clearSelectedFile(false);
        setMascotStatus('Định dạng báo cáo chưa được hỗ trợ. Hãy chọn file .docx hoặc .txt.', 'error');
        return;
      }
      fileNameText.textContent = file.name;
      fileName.hidden = false;
      fileDropzone.classList.add('has-file');
      setControlsDisabled(true);
      fileSelectButton.disabled = true;
      fileRemoveButton.disabled = true;
      setMascotStatus(`Đang đọc báo cáo ${file.name}...`, 'loading');
      try {
        let extractedText;
        if (extension === 'docx') {
          if (!window.mammoth?.convertToHtml) {
            throw new Error('Không tải được thư viện Mammoth từ assets/mammoth.browser.min.js.');
          }
          const result = await window.mammoth.convertToHtml({
            arrayBuffer: await file.arrayBuffer()
          });
          extractedText = extractWordEssayDocxText(result.value || '');
        } else {
          extractedText = await file.text();
        }
        if (!extractedText.trim()) throw new Error('Không tìm thấy nội dung báo cáo trong file.');
        reportInput.value = extractedText;
        reportInput.dispatchEvent(new Event('input', { bubbles: true }));
        setMascotStatus(`Đã đọc báo cáo ${file.name}.`, 'idle');
      } catch (error) {
        clearSelectedFile(false);
        console.error('Lỗi khi đọc báo cáo CMU:', error);
        setMascotStatus(`Không thể đọc báo cáo ${file.name}: ${error.message}`, 'error');
      } finally {
        setControlsDisabled(false);
      }
    });

    processButton.addEventListener('click', async () => {
      const rawText = reportInput.value.trim();
      if (!rawText) {
        setMascotStatus('Hãy chọn file hoặc nhập nội dung báo cáo CMU.', 'error');
        return;
      }
      invalidateOutput();
      setControlsDisabled(true);
      try {
        let apiKey = '';
        try {
          const stored = await chrome.storage.local.get('geminiApiKey');
          apiKey = stored.geminiApiKey || '';
        } catch (error) {
          console.warn('Không đọc được Gemini API Key; dùng bộ phân tích cục bộ cho CMU:', error);
        }
        setMascotStatus(
          apiKey ? 'Đang phân loại cấu trúc Báo cáo CMU...' : 'Đang phân tích cấu trúc báo cáo cục bộ...',
          'loading'
        );
        const { blocks, usedLocalParser } = await parseCmuBlocks(rawText, apiKey);
        const formFields = collectFields();
        const templateBlocks = normalizeTemplateBlocks(blocks, {
          heading1: 'heading1',
          heading2: 'heading2',
          heading3: 'heading3',
          caption: 'caption',
          body: 'body'
        });
        const templateData = {
          course_name: formFields.courseName,
          course_code: formFields.courseCode,
          doc_type: formFields.docType,
          version: formFields.version,
          date: formFields.date,
          project_title: formFields.title,
          created_by: formFields.createdBy,
          full_name: formFields.fullName,
          student_id: formFields.studentId,
          mentor: formFields.mentor,
          acronym: formFields.acronym,
          start_date: formFields.startDate,
          end_date: formFields.endDate,
          mentor_inverted: toInvertedName(formFields.mentor),
          leader_inverted: toInvertedName(formFields.fullName),
          contact: formFields.contact,
          demo_link: formFields.demoLink,
          blocks: templateBlocks
        };
        const filename = `${slugWordFormTitle(formFields.title || formFields.courseName || formFields.courseCode || 'cmu-report')}.docx`;
        const blob = await exportTemplateDocx('cmu', filename, templateData);
        const documentText = [
          ...Object.values(templateData).filter((value) => !Array.isArray(value)),
          ...blocks.map((block) => block.text)
        ].join('\n');
        const hasCorruptCharacters = /[\uFFFD]|\$!#|[\uE000-\uF8FF]/.test(documentText);
        const sectionCount = blocks.filter((block) => block.type === 'heading1').length;
        const subsectionCount = blocks.filter((block) =>
          ['heading2', 'heading3'].includes(block.type)
        ).length;
        const figureCount = blocks.filter((block) =>
          block.type === 'caption' && /\b(?:Figure|HÌNH)\b/i.test(block.text)
        ).length;
        const tableCount = blocks.filter((block) =>
          block.type === 'caption' && /\b(?:Table|BẢNG)\b/i.test(block.text)
        ).length;
        const requiredMissing = [
          ['Tên môn học', formFields.courseName],
          ['Mã môn học', formFields.courseCode],
          ['Tên đề tài', formFields.title]
        ].filter(([, value]) => !value).map(([label]) => label);
        const warnings = [];
        if (figureCount || tableCount) {
          warnings.push(`Cần chèn ${figureCount} hình và ${tableCount} bảng vào các khung giữ chỗ.`);
        }
        if (requiredMissing.length) {
          warnings.push(`Thiếu thông tin bắt buộc: ${requiredMissing.join(', ')}.`);
        }
        if (usedLocalParser) {
          warnings.push('Cấu trúc được phân tích cục bộ; hãy rà soát lại các tiêu đề và chú thích.');
        }
        const valid = blob.size > 0 && blocks.length > 0 &&
          !hasCorruptCharacters && requiredMissing.length === 0;
        const lines = [
          `Mục lớn: ${sectionCount}; mục nhỏ: ${subsectionCount}.`,
          `Vị trí hình/bảng: ${figureCount} hình, ${tableCount} bảng.`,
          `Kiểm tra ký tự lỗi: ${hasCorruptCharacters ? 'Phát hiện ký tự lỗi.' : 'Không phát hiện ký tự lỗi.'}`,
          `Trang: A4; lề 2.54 cm cả bốn phía; font Times New Roman 14 pt.`,
          `Kiểm tra DOCX: ${blob.size > 0 ? `${blob.size.toLocaleString()} byte` : 'File rỗng'}.`
        ];
        renderWordFormValidation(validationBox, { valid, warnings, lines });
        if (!valid) {
          setMascotStatus('Kiểm định chưa đạt; hãy hoàn thiện thông tin bắt buộc và rà soát nội dung.', 'error');
          return;
        }
        generatedBlob = blob;
        generatedFilename = filename;
        downloadButton.disabled = false;
        setMascotStatus(
          warnings.length
            ? 'Đã tạo Báo cáo CMU; hãy rà soát các lưu ý kiểm định trước khi tải.'
            : 'Đã chuẩn hóa và kiểm định Báo cáo CMU thành công.',
          warnings.length ? 'error' : 'idle'
        );
      } catch (error) {
        console.error('Lỗi khi chuẩn hóa Báo cáo CMU:', error);
        renderWordFormValidation(validationBox, {
          valid: false,
          warnings: [],
          lines: [],
          error: `Không thể hoàn tất: ${error.message}`
        });
        setMascotStatus(`Không thể chuẩn hóa Báo cáo CMU: ${error.message}`, 'error');
      } finally {
        setControlsDisabled(false);
      }
    });

    downloadButton.addEventListener('click', () => {
      if (!generatedBlob || downloadButton.disabled) return;
      const downloadUrl = URL.createObjectURL(generatedBlob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = generatedFilename;
      link.hidden = true;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      setMascotStatus(`Đã tải ${generatedFilename}.`, 'idle');
    });
  }

  document.addEventListener('DOMContentLoaded', initializeWordEssayFeature);
  document.addEventListener('DOMContentLoaded', initializeCmuReportFeature);

  document.addEventListener('DOMContentLoaded', () => {
    const titleInput = document.getElementById('wf-quiz-title');
    const quizInput = document.getElementById('wf-quiz-input');
    const inputStats = document.getElementById('wf-input-stats');
    const answerStyleSelect = document.getElementById('wf-answer-style');
    const solveMissingCheckbox = document.getElementById('wf-ai-solve-missing');
    const fileDropzone = document.getElementById('wf-file-dropzone');
    const fileInput = document.getElementById('wf-file-input');
    const fileSelectButton = document.getElementById('wf-file-select-btn');
    const fileName = document.getElementById('wf-file-name');
    const fileNameText = document.getElementById('wf-file-name-text');
    const fileRemoveButton = document.getElementById('wf-file-remove-btn');
    const processButton = document.getElementById('wf-process-quiz-btn');
    const validationBox = document.getElementById('wf-validation-box');
    const downloadButton = document.getElementById('wf-download-docx-btn');
    const quizPanel = document.getElementById('wf-quiz-panel');
    const essayPanel = document.getElementById('wf-essay-panel');
    const cmuPanel = document.getElementById('wf-cmu-panel');
    if (
      !titleInput || !quizInput || !inputStats || !answerStyleSelect || !solveMissingCheckbox ||
      !fileDropzone || !fileInput || !fileSelectButton || !fileName || !fileNameText ||
      !fileRemoveButton || !processButton || !validationBox || !downloadButton ||
      !quizPanel || !essayPanel || !cmuPanel
    ) {
      return;
    }

    let generatedBlob = null;
    let generatedFilename = '';
    const invalidateOutput = () => {
      generatedBlob = null;
      generatedFilename = '';
      downloadButton.disabled = true;
      validationBox.hidden = true;
      validationBox.replaceChildren();
      validationBox.classList.remove('has-warning', 'is-invalid');
    };
    const updateInputStats = () => {
      inputStats.textContent = `${quizInput.value.length.toLocaleString()} ký tự`;
    };
    const clearSelectedFile = (clearText) => {
      fileInput.value = '';
      wfExtractedImages = new Map();
      fileDropzone.classList.remove('has-file');
      fileName.hidden = true;
      fileNameText.textContent = '';
      if (clearText) {
        quizInput.value = '';
        quizInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    };
    updateInputStats();

    fileSelectButton.addEventListener('click', () => fileInput.click());
    fileRemoveButton.addEventListener('click', () => clearSelectedFile(true));
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      wfExtractedImages = new Map();
      const extension = file.name.split('.').pop().toLowerCase();
      if (extension === 'pdf') {
        clearSelectedFile(false);
        setMascotStatus(
          'PDF chưa thể trích xuất text vì backend hiện không có endpoint trả nội dung thô. Hãy lưu file sang .docx hoặc .txt để xử lý trực tiếp.',
          'error'
        );
        return;
      }
      if (extension !== 'docx' && extension !== 'txt') {
        clearSelectedFile(false);
        setMascotStatus('Định dạng file chưa được hỗ trợ. Hãy chọn file .docx hoặc .txt.', 'error');
        return;
      }

      fileNameText.textContent = file.name;
      fileName.hidden = false;
      fileDropzone.classList.add('has-file');
      fileSelectButton.disabled = true;
      fileRemoveButton.disabled = true;
      processButton.disabled = true;
      quizInput.disabled = true;
      setMascotStatus(`Đang đọc file ${file.name}...`, 'loading');
      try {
        let extractedText;
        if (extension === 'docx') {
          if (!window.mammoth?.convertToHtml) {
            throw new Error('Không tải được thư viện Mammoth từ assets/mammoth.browser.min.js.');
          }
          const result = await window.mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
          extractedText = await extractWordFormDocxText(result.value || '');
        } else {
          extractedText = await file.text();
        }
        if (!extractedText.trim()) {
          throw new Error('Không tìm thấy nội dung văn bản trong file đã chọn.');
        }
        quizInput.value = extractedText;
        quizInput.dispatchEvent(new Event('input', { bubbles: true }));
        setMascotStatus(`Đã đọc nội dung từ ${file.name}.`, 'idle');
      } catch (error) {
        clearSelectedFile(false);
        console.error('Lỗi khi đọc file Form Word:', error);
        setMascotStatus(`Không thể đọc file ${file.name}: ${error.message}`, 'error');
      } finally {
        fileSelectButton.disabled = false;
        fileRemoveButton.disabled = false;
        processButton.disabled = false;
        quizInput.disabled = false;
      }
    });

    quizInput.addEventListener('input', () => {
      updateInputStats();
      invalidateOutput();
    });
    titleInput.addEventListener('input', invalidateOutput);
    answerStyleSelect.addEventListener('change', invalidateOutput);
    solveMissingCheckbox.addEventListener('change', invalidateOutput);

    document.querySelectorAll('.wf-mode-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        const mode = tab.dataset.wfMode;
        const selectedPanel = {
          quiz: quizPanel,
          essay: essayPanel,
          cmu: cmuPanel
        }[mode];
        if (!selectedPanel) return;
        document.querySelectorAll('.wf-mode-tab').forEach((modeTab) => {
          const isActive = modeTab === tab;
          modeTab.classList.toggle('active', isActive);
          modeTab.setAttribute('aria-selected', String(isActive));
        });
        [quizPanel, essayPanel, cmuPanel].forEach((panel) => {
          panel.hidden = panel !== selectedPanel;
        });
      });
    });

    processButton.addEventListener('click', async () => {
      const title = titleInput.value.trim();
      const input = quizInput.value.trim();
      const solveMissing = solveMissingCheckbox.checked;
      if (!input) {
        setMascotStatus('Hãy dán nội dung đề trắc nghiệm trước khi xử lý.', 'error');
        return;
      }
      if (!title) {
        setMascotStatus('Hãy nhập tiêu đề đề thi trước khi xử lý.', 'error');
        return;
      }

      const localQuestions = parseQuizLocally(input);
      const getImageTokens = (value) =>
        Array.from(String(value || '').matchAll(/\[\[(IMG_\d+)\]\]/g), (match) => match[0]);
      const imagesByQuestionNumber = new Map();
      localQuestions.forEach((question) => {
        const imageTokens = {
          question: getImageTokens(question.question),
          options: Object.fromEntries(
            ['A', 'B', 'C', 'D'].map((letter) => [letter, getImageTokens(question.options[letter])])
          )
        };
        if (
          imageTokens.question.length ||
          Object.values(imageTokens.options).some((tokens) => tokens.length)
        ) {
          imagesByQuestionNumber.set(question.number, imageTokens);
        }
      });
      const localAnsweredCount = localQuestions.filter((question) =>
        ['A', 'B', 'C', 'D'].includes(question.correct) && Boolean(question.options[question.correct])
      ).length;
      const useLocalFastPath = localQuestions.length >= 2 &&
        (localAnsweredCount === localQuestions.length || !solveMissing);

      invalidateOutput();
      processButton.disabled = true;
      titleInput.disabled = true;
      quizInput.disabled = true;
      answerStyleSelect.disabled = true;
      solveMissingCheckbox.disabled = true;
      fileSelectButton.disabled = true;
      fileRemoveButton.disabled = true;
      try {
        const mergedQuestions = [];
        let hasMediaPlaceholder = /\[(?:HÌNH|BẢNG)\b[^\]]*\]/i.test(input);
        let usedLocalFastPath = false;
        let usedLocalFallback = false;
        if (useLocalFastPath) {
          mergedQuestions.push(...localQuestions);
          usedLocalFastPath = true;
        } else {
          const { geminiApiKey } = await chrome.storage.local.get('geminiApiKey');
          if (!geminiApiKey) throw new Error('Vui lòng nhập Gemini API Key trong phần Cài đặt.');

          const inputWithoutImageTokens = input.replace(/\[\[IMG_\d+\]\]/g, ' ');
          const chunks = splitWordFormQuizInput(inputWithoutImageTokens);
          let aiQuestionOffset = 0;
          try {
            for (let index = 0; index < chunks.length; index += 1) {
              setMascotStatus(
                chunks.length > 1
                  ? `Đang phân loại cụm ${index + 1}/${chunks.length}...`
                  : 'Đang phân loại đề trắc nghiệm...',
                'loading'
              );
              const classified = await classifyWordFormChunk(chunks[index], geminiApiKey, solveMissing);
              if (Array.isArray(classified.questions)) {
                classified.questions.forEach((classifiedQuestion, questionIndex) => {
                  const sourceQuestion = localQuestions[aiQuestionOffset + questionIndex];
                  const questionNumber = sourceQuestion?.number ?? Number(classifiedQuestion?.number);
                  const imageTokens = imagesByQuestionNumber.get(questionNumber);
                  if (!imageTokens) {
                    mergedQuestions.push(classifiedQuestion);
                    return;
                  }

                  const rawOptions = classifiedQuestion?.options &&
                    typeof classifiedQuestion.options === 'object'
                    ? classifiedQuestion.options
                    : {};
                  const options = { ...rawOptions };
                  ['A', 'B', 'C', 'D'].forEach((letter) => {
                    const optionText = rawOptions[letter] ?? rawOptions[letter.toLowerCase()] ?? '';
                    const optionTokens = imageTokens.options[letter];
                    options[letter] = optionTokens.length
                      ? `${optionText} ${optionTokens.join(' ')}`.trim()
                      : optionText;
                  });
                  const questionText = String(classifiedQuestion?.question || '');
                  mergedQuestions.push({
                    ...classifiedQuestion,
                    question: imageTokens.question.length
                      ? `${questionText} ${imageTokens.question.join(' ')}`.trim()
                      : questionText,
                    options
                  });
                });
                aiQuestionOffset += classified.questions.length;
              }
              hasMediaPlaceholder = hasMediaPlaceholder || classified.hasMediaPlaceholder === true;
            }
          } catch (error) {
            if (error.code !== 'WF_AI_OVERLOADED' || localQuestions.length === 0) throw error;
            mergedQuestions.length = 0;
            mergedQuestions.push(...localQuestions);
            usedLocalFallback = true;
            setMascotStatus('Gemini đang quá tải; đang dùng kết quả phân tích cục bộ...', 'loading');
          }
        }

        const questions = normalizeWordFormQuestions(mergedQuestions, solveMissing)
          .map((question, index) => ({ ...question, number: index + 1 }));
        const { blob, renderedImageIds } = await createWordFormDocument(
          title,
          questions,
          answerStyleSelect.value
        );
        const documentText = [
          title,
          ...questions.flatMap((question, index) => [
            `Câu ${index + 1}: ${question.question}`,
            ...['A', 'B', 'C', 'D'].map((letter) => `${letter}. ${question.options[letter]}`)
          ])
        ].join('\n');
        const hasCorruptCharacters = /[\uFFFD]|\$!#|[\uE000-\uF8FF]/.test(documentText);
        const completeOptionCount = questions.filter((question) =>
          ['A', 'B', 'C', 'D'].every((letter) => question.options[letter])
        ).length;
        const markedAnswerCount = questions.filter((question) =>
          ['A', 'B', 'C', 'D'].includes(question.correct) && Boolean(question.options[question.correct])
        ).length;
        const aiSolvedAnswerCount = questions.filter((question) =>
          question.solvedByAi && Boolean(question.options[question.correct])
        ).length;
        const sourceAnswerCount = markedAnswerCount - aiSolvedAnswerCount;
        const missingAnswerCount = questions.length - markedAnswerCount;
        const warnings = [];
        if (completeOptionCount < questions.length) {
          warnings.push(`${questions.length - completeOptionCount} câu chưa đủ 4 đáp án A–D.`);
        }
        if (missingAnswerCount > 0) {
          warnings.push(
            solveMissing
              ? `${missingAnswerCount} câu chưa có đáp án xác định được.`
              : `${missingAnswerCount} câu chưa có đáp án đúng được đánh dấu; không tự đoán đáp án.`
          );
        }
        if (hasMediaPlaceholder) {
          const mediaPlaceholders = Array.from(new Set(
            input.match(/\[(?:HÌNH|BẢNG)\s*[^\]]*\]/gi) || []
          ));
          warnings.push(
            mediaPlaceholders.length
              ? `Cần chèn lại các vị trí ${mediaPlaceholders.join(', ')} trong file Word.`
              : 'Đề có nhắc đến [HÌNH] hoặc [BẢNG]; hãy chèn lại hình/bảng tương ứng trong file Word.'
          );
        }
        const valid = blob.size > 0 && questions.length > 0 && !hasCorruptCharacters;
        const lines = [
          ...(usedLocalFastPath
            ? [`⚡ Đã chuẩn hóa tức thì bằng bộ phân tích cục bộ: ${markedAnswerCount}/${questions.length} câu có đáp án đúng (0ms, không tốn quota AI).`]
            : []),
          ...(usedLocalFallback
            ? ['Ghi chú: Gemini quá tải; đã hạ cánh an toàn về bộ phân tích cục bộ.']
            : []),
          ...(wfExtractedImages.size
            ? [`🖼️ Đã giữ nguyên và nhúng tự động ${renderedImageIds.size}/${wfExtractedImages.size} hình ảnh vào tệp Word.`]
            : []),
          `Số câu nhận diện: ${questions.length} (Câu 1 → Câu ${questions.length}).`,
          `Số câu đủ 4 đáp án: ${completeOptionCount}/${questions.length}.`,
          `Đáp án nhận diện từ đề gốc: ${sourceAnswerCount}/${questions.length}.`,
          `Đáp án do AI tự giải: ${aiSolvedAnswerCount}/${questions.length}.`,
          `Câu chưa có đáp án: ${missingAnswerCount}/${questions.length}.`,
          `Kiểm tra ký tự lạ: ${hasCorruptCharacters ? 'Phát hiện ký tự lỗi mã hóa.' : 'Không phát hiện ký tự lỗi mã hóa.'}`,
          'Font và dàn trang: Times New Roman 12pt, giãn dòng 1.15, khổ A4; lề trên/dưới/phải 2 cm, trái 2.5 cm.',
          `Kiểm tra file DOCX: ${blob.size > 0 ? `${blob.size.toLocaleString()} byte` : 'File rỗng'}.`
        ];
        renderWordFormValidation(validationBox, { valid, warnings, lines });
        if (wfExtractedImages.size) {
          const imageLine = Array.from(validationBox.querySelectorAll('.wf-validation-line'))
            .find((line) => line.textContent.startsWith('🖼️'));
          if (imageLine) {
            imageLine.style.color = '#15803d';
            imageLine.style.fontWeight = '600';
          }
        }
        if (!valid) {
          setMascotStatus(
            questions.length === 0
              ? 'Không nhận diện được câu hỏi hợp lệ; chưa thể tải file Word.'
              : 'Kiểm định phát hiện lỗi ký tự hoặc file rỗng; chưa thể tải file Word.',
            'error'
          );
          return;
        }

        generatedBlob = blob;
        generatedFilename = `${slugWordFormTitle(title)}.docx`;
        downloadButton.disabled = false;
        setMascotStatus(
          warnings.length
            ? 'Đã tạo file Word; hãy xem các cảnh báo kiểm định trước khi tải.'
            : 'Đã chuẩn hóa và kiểm định Form Word thành công.',
          warnings.length ? 'error' : 'idle'
        );
      } catch (error) {
        console.error('Lỗi khi chuẩn hóa Form Word:', error);
        renderWordFormValidation(validationBox, {
          valid: false,
          warnings: [],
          lines: [],
          error: `Không thể hoàn tất: ${error.message}`
        });
        setMascotStatus(`Không thể chuẩn hóa Form Word: ${error.message}`, 'error');
      } finally {
        processButton.disabled = false;
        titleInput.disabled = false;
        quizInput.disabled = false;
        answerStyleSelect.disabled = false;
        solveMissingCheckbox.disabled = false;
        fileSelectButton.disabled = false;
        fileRemoveButton.disabled = false;
      }
    });

    downloadButton.addEventListener('click', () => {
      if (!generatedBlob || downloadButton.disabled) return;
      const downloadUrl = URL.createObjectURL(generatedBlob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = generatedFilename;
      link.hidden = true;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      setMascotStatus(`Đã tải ${generatedFilename}.`, 'idle');
    });
  });
})();

function setMascotStatus(message, state = 'idle') {
  const statusText = document.getElementById('pdf-status-text');
  const statusWidget = document.getElementById('pdf-status-widget');
  const appStatusText = document.getElementById('app-status-text');
  const appStatusIndicator = document.getElementById('app-status-indicator');
  const sidebarLogoSlot = document.getElementById('sidebar-logo-slot');
  const mascotAvatar = document.getElementById('mascot-avatar');
  const isProcessing = state === 'loading';

  if (statusText) statusText.textContent = message;
  if (statusWidget) {
    statusWidget.classList.toggle('is-loading', isProcessing);
    statusWidget.classList.toggle('is-error', state === 'error');
  }
  if (sidebarLogoSlot) {
    sidebarLogoSlot.classList.toggle('is-logo-processing', isProcessing);
    sidebarLogoSlot.setAttribute('data-logo-state', isProcessing ? 'processing' : 'idle');
  }
  if (mascotAvatar) {
    mascotAvatar.classList.toggle('is-logo-processing', isProcessing);
    mascotAvatar.setAttribute('data-logo-state', isProcessing ? 'processing' : 'idle');
  }
  if (appStatusText) {
    appStatusText.textContent =
      isProcessing ? 'Đang xử lý' : state === 'error' ? 'Cần chú ý' : 'Sẵn sàng';
  }
  if (appStatusIndicator) {
    appStatusIndicator.classList.toggle('is-loading', isProcessing);
    appStatusIndicator.classList.toggle('is-error', state === 'error');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const menuToggleButton = document.getElementById('menu-toggle-btn');
  const menuCloseButton = document.getElementById('menu-close-btn');
  const navDrawer = document.getElementById('nav-drawer');
  const navBackdrop = document.getElementById('nav-backdrop');

  const setDrawerOpen = (isOpen) => {
    if (!navDrawer || !navBackdrop || !menuToggleButton) return;
    navDrawer.classList.toggle('is-open', isOpen);
    navDrawer.setAttribute('aria-hidden', String(!isOpen));
    navDrawer.inert = !isOpen;
    navBackdrop.hidden = !isOpen;
    menuToggleButton.setAttribute('aria-expanded', String(isOpen));
    menuToggleButton.setAttribute('aria-label', isOpen ? 'Đóng menu' : 'Mở menu');
    if (isOpen) {
      menuCloseButton?.focus();
    } else {
      menuToggleButton.focus();
    }
  };

  menuToggleButton?.addEventListener('click', () => {
    setDrawerOpen(menuToggleButton.getAttribute('aria-expanded') !== 'true');
  });
  menuCloseButton?.addEventListener('click', () => setDrawerOpen(false));
  navBackdrop?.addEventListener('click', () => setDrawerOpen(false));
  document.querySelectorAll('.nav-item[data-view]').forEach((item) => {
    item.addEventListener('click', () => {
      showAppView(item.dataset.view);
      setMascotStatus('Sẵn sàng hỗ trợ bạn học tập!', 'idle');
      setDrawerOpen(false);
    });
  });

  const quizInput = document.getElementById('quiz-input');
  const count = document.getElementById('quiz-char-count');
  const clearButton = document.getElementById('clear-quiz-input-btn');
  const quizSharedControls = document.getElementById('quiz-shared-controls');
  const pageReadingTime = document.getElementById('page-reading-time');
  if (quizInput && count && clearButton) {
    const updateCount = () => {
      const text = quizInput.value;
      const words = text.trim() ? text.trim().split(/\s+/).length : 0;
      count.textContent = `${text.length} ký tự • ${words} từ`;
    };
    quizInput.addEventListener('input', () => {
      updateCount();
      const hasVocabPattern = Boolean(parseLocalVocabPos(quizInput.value));
      syncDifficultyForVocab(hasVocabPattern);
    });
    clearButton.addEventListener('click', () => {
      quizInput.value = '';
      updateCount();
      syncDifficultyForVocab(false);
      quizInput.focus();
    });
    updateCount();
  }
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && navDrawer?.classList.contains('is-open')) {
      setDrawerOpen(false);
    }
  });

  document.querySelectorAll('.source-tab-btn[data-source]').forEach((button) => {
    button.addEventListener('click', () => {
      const sourceName = button.dataset.source;
      const targetPanel = document.querySelector(`[data-source-panel="${sourceName}"]`);
      if (!targetPanel) return;

      document.querySelectorAll('.source-tab-btn[data-source]').forEach((tab) => {
        const isActive = tab === button;
        tab.classList.toggle('active', isActive);
        tab.setAttribute('aria-selected', String(isActive));
      });
      document.querySelectorAll('[data-source-panel]').forEach((panel) => {
        const isActive = panel === targetPanel;
        panel.classList.toggle('active', isActive);
        panel.hidden = !isActive;
      });
      if (quizSharedControls) quizSharedControls.hidden = sourceName === 'url';
      if (pageReadingTime) pageReadingTime.hidden = true;
    });
  });
});


// --- SPRINT 2: Lưu & tải Gemini API Key với chrome.storage.local ---
document.addEventListener('DOMContentLoaded', async () => {
  const apiKeyInput = document.getElementById('gemini-api-key');
  const saveKeyBtn = document.getElementById('save-key-btn');
  const saveStatus = document.getElementById('save-status');
  let hideTimeoutId = null;

  // 1. Tự động load API Key cũ ra ô input (nếu đã lưu trước đó)
  if (apiKeyInput) {
    try {
      const { geminiApiKey } = await chrome.storage.local.get('geminiApiKey');
      if (geminiApiKey) {
        apiKeyInput.value = geminiApiKey;
      }
    } catch (error) {
      console.error('Lỗi khi tải API Key:', error);
    }
  }

  // 2. Bắt sự kiện click nút Lưu để cất Key mới vào chrome.storage.local
  if (saveKeyBtn && apiKeyInput) saveKeyBtn.addEventListener('click', async () => {
    const apiKey = apiKeyInput.value.trim();
    setMascotStatus('Đang lưu API Key...', 'loading');

    try {
      await chrome.storage.local.set({ geminiApiKey: apiKey });

      // Hiện thông báo lưu thành công và tự động ẩn sau 2.5 giây
      if (saveStatus) saveStatus.hidden = false;
      if (hideTimeoutId) {
        clearTimeout(hideTimeoutId);
      }
      if (saveStatus) {
        hideTimeoutId = setTimeout(() => {
          saveStatus.hidden = true;
        }, 2500);
      }
      setMascotStatus('Đã lưu API Key thành công.', 'idle');
    } catch (error) {
      console.error('Lỗi khi lưu API Key:', error);
      setMascotStatus(`Không thể lưu API Key: ${error.message}`, 'error');
    }
  });
});


// --- HELPER: Tự động dò danh sách Model Flash khả dụng & Fallback ---
const PREFERRED_LIVE_FLASH_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.8-flash',
  'gemini-flash-latest'
];

function isAllowedLiveGeminiFlashModel(modelName) {
  const cleanName = String(modelName || '').replace(/^models\//, '').trim();
  const lower = cleanName.toLowerCase();
  if (!lower.startsWith('gemini-') || !lower.includes('flash')) return false;
  if (/(antigravity|preview|2\.5-flash|2\.0-flash)/i.test(lower)) return false;
  if (/(tts|image|imagen|audio|vision|embedding|aqa|veo|learnlm|bisheng)/i.test(lower)) return false;
  return true;
}

async function getAvailableFlashModels(apiKey) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(endpoint, {
      method: 'GET',
      signal: controller.signal
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      if (response.status === 400 || response.status === 401 || response.status === 403) {
        throw new Error('API Key không hợp lệ hoặc không có quyền truy cập. Vui lòng kiểm tra lại trong Cài đặt API Key!');
      }
      const errMsg = data?.error?.message || `HTTP ${response.status}: ${response.statusText}`;
      throw new Error(`Không thể lấy danh sách model: ${errMsg}`);
    }

    const rawModels = Array.isArray(data?.models) ? data.models : [];

    const discoveredFlashModels = rawModels
      .filter((m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
      .map((m) => String(m.name || '').replace(/^models\//, '').trim())
      .filter(isAllowedLiveGeminiFlashModel);

    const orderedModels = [];
    [...PREFERRED_LIVE_FLASH_MODELS, ...discoveredFlashModels].forEach((name) => {
      if (isAllowedLiveGeminiFlashModel(name) && !orderedModels.includes(name)) {
        orderedModels.push(name);
      }
    });

    console.log('[Gemini Discovery] Danh sách model khả dụng:', orderedModels);
    return orderedModels;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function callGeminiWithFallback(promptText, apiKey, onModelAttempt) {
  const candidateModels = await getAvailableFlashModels(apiKey);
  let lastError = null;

  for (const modelName of candidateModels) {
    if (typeof onModelAttempt === 'function') {
      onModelAttempt(modelName);
    }
    console.log(`[Gemini Fallback] Đang thử gọi model: ${modelName}...`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, 15000);

    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: promptText }
              ]
            }
          ]
        })
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        const apiErrorMessage = data?.error?.message || `HTTP ${response.status}: ${response.statusText}`;
        // Nếu lỗi liên quan đến API Key không hợp lệ thì dừng ngay, không thử tiếp
        if (response.status === 401 || response.status === 403) {
          throw new Error(apiErrorMessage);
        }
        console.warn(`[Gemini Fallback] Model ${modelName} trả về HTTP ${response.status} (${apiErrorMessage}), chuyển sang model tiếp theo...`);
        lastError = new Error(apiErrorMessage);
        continue;
      }

      const generatedText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!generatedText) {
        console.warn(`[Gemini Fallback] Model ${modelName} trả về nội dung rỗng, chuyển sang model tiếp theo...`);
        lastError = new Error(`Model ${modelName} không trả về nội dung.`);
        continue;
      }

      console.log(`[Gemini Fallback] Thành công với model: ${modelName}`);
      return generatedText;
    } catch (error) {
      if (error.name === 'AbortError') {
        console.warn(`[Gemini Fallback] Model ${modelName} bị quá thời gian chờ (Timeout 15s), chuyển sang model tiếp theo...`);
        lastError = new Error('Máy chủ Google hiện đang quá tải và không phản hồi (Timeout).');
        continue;
      }
      // Nếu lỗi xác thực API Key thì ném lỗi ra ngoài ngay
      if (/api key|permission|unauthenticated/i.test(error.message)) {
        throw error;
      }
      console.warn(`[Gemini Fallback] Lỗi khi thử model ${modelName}:`, error.message);
      lastError = error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastError || new Error('Tất cả các model Gemini khả dụng đều đang quá tải. Vui lòng thử lại sau.');
}


// --- HELPER: Chuẩn hóa dữ liệu JSON & Render Interactive Quiz UI ---
function parseStructuredQuizPayload(quizData, fallbackSummary = '') {
  let summary = typeof fallbackSummary === 'string' ? fallbackSummary.trim() : '';
  let quizType = 'standard';
  let validationError = '';
  let raw = quizData;

  // Nếu dữ liệu đầu vào là chuỗi (ví dụ Gemini trả về chuỗi JSON hoặc bọc trong ```json ... ```)
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    const cleanedJson = trimmed
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    try {
      raw = JSON.parse(cleanedJson);
    } catch (_) {
      // Thử tìm khối {...} hoặc [...] đầu tiên trong chuỗi
      const objMatch = cleanedJson.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
      if (objMatch) {
        try {
          raw = JSON.parse(objMatch[1]);
        } catch (__) {
          // Không phải JSON hợp lệ -> coi như văn bản tóm tắt thuần
          return { summary: summary || trimmed, quizList: [], quizType, validationError };
        }
      } else {
        return { summary: summary || trimmed, quizList: [], quizType, validationError };
      }
    }
  }

  if (Array.isArray(raw)) {
    return { summary, quizList: raw, quizType, validationError };
  }

  if (raw && typeof raw === 'object') {
    if (!summary && typeof raw.summary === 'string') {
      summary = raw.summary.trim();
    }
    quizType = typeof raw.quiz_type === 'string' ? raw.quiz_type : quizType;
    validationError = typeof raw.validation_error === 'string' ? raw.validation_error : '';
    if (Array.isArray(raw.quiz)) {
      return { summary, quizList: raw.quiz, quizType, validationError };
    }
    if (Array.isArray(raw.questions)) {
      return { summary, quizList: raw.questions, quizType, validationError };
    }
    // Trường hợp raw.quiz lại là một chuỗi JSON
    if (typeof raw.quiz === 'string') {
      return parseStructuredQuizPayload(raw.quiz, summary);
    }
    if (typeof raw.result === 'string') {
      return parseStructuredQuizPayload(raw.result, summary);
    }
  }

  return { summary, quizList: [], quizType, validationError };
}

function normalizeOptions(optionsRaw) {
  const letters = ['A', 'B', 'C', 'D', 'E', 'F'];

  if (Array.isArray(optionsRaw)) {
    return optionsRaw.slice(0, 6).map((opt, idx) => {
      const letter = letters[idx] || String.fromCharCode(65 + idx);
      const rawStr = String(opt ?? '').trim();
      const cleanText = rawStr.replace(/^[A-F][\.\)\:\-]\s*/i, '').trim() || rawStr;
      return { letter, text: cleanText, raw: rawStr };
    });
  }

  if (optionsRaw && typeof optionsRaw === 'object') {
    return letters
      .filter((letter) => optionsRaw[letter] !== undefined || optionsRaw[letter.toLowerCase()] !== undefined)
      .map((letter) => {
        const val = optionsRaw[letter] ?? optionsRaw[letter.toLowerCase()];
        const rawStr = String(val ?? '').trim();
        const cleanText = rawStr.replace(/^[A-F][\.\)\:\-]\s*/i, '').trim() || rawStr;
        return { letter, text: cleanText, raw: rawStr };
      });
  }

  return [];
}

function shuffleQuizQuestionsAndOptions(quizList) {
  const shuffledQuestions = Array.isArray(quizList) ? [...quizList] : [];
  for (let index = shuffledQuestions.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffledQuestions[index], shuffledQuestions[swapIndex]] = [shuffledQuestions[swapIndex], shuffledQuestions[index]];
  }

  return shuffledQuestions.map((item) => {
    if (!item || typeof item !== 'object') return item;

    const options = normalizeOptions(item.options)
      .map((option, optionIndex) => ({ ...option, optionIndex }))
      .filter((option) => option.text);
    const correctAnswer = item.correct_answer ?? item.answer;
    const correctOptionIndex = options.findIndex((option) =>
      isCorrectOption(option, option.optionIndex, correctAnswer)
    );
    if (options.length < 2 || correctOptionIndex < 0) return { ...item };

    const shuffledOptions = options.map((option, index) => ({
      text: option.text,
      isCorrect: index === correctOptionIndex
    }));
    for (let index = shuffledOptions.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [shuffledOptions[index], shuffledOptions[swapIndex]] = [shuffledOptions[swapIndex], shuffledOptions[index]];
    }

    const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
    const shuffledOptionsByLetter = Object.fromEntries(
      shuffledOptions.map((option, index) => [letters[index], option.text])
    );
    const newCorrectAnswer = letters[shuffledOptions.findIndex((option) => option.isCorrect)];
    const shuffledItem = {
      ...item,
      options: shuffledOptionsByLetter,
      correct_answer: newCorrectAnswer
    };
    if (Object.prototype.hasOwnProperty.call(item, 'answer')) {
      shuffledItem.answer = newCorrectAnswer;
    }
    return shuffledItem;
  });
}

function applyQuizDifficulty(quizData, difficulty) {
  if (difficulty !== 'shuffle') return quizData;

  let parsed = quizData;
  if (typeof parsed === 'string') {
    try {
      parsed = parseGeminiJson(parsed);
    } catch (_) {
      return quizData;
    }
  }

  if (Array.isArray(parsed)) {
    return shuffleQuizQuestionsAndOptions(parsed);
  }
  if (!parsed || typeof parsed !== 'object') return quizData;

  if (Array.isArray(parsed.quiz)) {
    return { ...parsed, quiz: shuffleQuizQuestionsAndOptions(parsed.quiz) };
  }
  if (Array.isArray(parsed.questions)) {
    return { ...parsed, questions: shuffleQuizQuestionsAndOptions(parsed.questions) };
  }
  return parsed;
}

function isCorrectOption(optionItem, optionIndex, correctAnswerRaw) {
  if (correctAnswerRaw === undefined || correctAnswerRaw === null) {
    return false;
  }

  if (typeof correctAnswerRaw === 'number') {
    return optionIndex === correctAnswerRaw;
  }

  const ans = String(correctAnswerRaw).trim();
  if (!ans) {
    return false;
  }

  const upperAns = ans.toUpperCase();
  const upperLetter = optionItem.letter.toUpperCase();

  // Trường hợp correct_answer là chữ cái đáp án hoặc "Đáp án A"
  if (
    upperAns === upperLetter ||
    new RegExp(`^${upperLetter}[.):-]`).test(upperAns) ||
    new RegExp(`^(?:ĐÁP ÁN|ANSWER)\\s*${upperLetter}\\b`, 'i').test(ans)
  ) {
    return true;
  }

  // Trường hợp correct_answer chứa toàn bộ nội dung đáp án
  const cleanAns = ans.replace(/^[A-F][\.\)\:\-]\s*/i, '').trim().toLowerCase();
  return (
    cleanAns === optionItem.text.toLowerCase() ||
    ans.toLowerCase() === optionItem.raw.toLowerCase()
  );
}

function formatSummaryMarkdown(text) {
  if (!text) return '';
  // Escape các ký tự HTML đặc biệt để an toàn trước khi chuyển đổi Markdown
  const escaped = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return escaped
    .replace(/^#{2,3}\s+(.+)$/gm, '<h4>$1</h4>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/<\/h4>\r?\n/g, '</h4>')
    .replace(/\r?\n/g, '<br>');
}

const BACKEND_API_ORIGIN = 'http://127.0.0.1:8000';
const MAX_STUDY_HISTORY = 10;
let currentQuizSession = null;

async function exportQuizToDocx(summary, quizList, buttonEl) {
  const originalLabel = buttonEl.textContent;
  buttonEl.disabled = true;
  buttonEl.textContent = '⏳ Đang xuất file Word (.docx)...';

  try {
    const response = await fetch(`${BACKEND_API_ORIGIN}/api/export-docx`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        summary: summary || '',
        quiz: quizList || []
      })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => null);
      const detail = errData?.detail || `HTTP ${response.status}: ${response.statusText}`;
      throw new Error(detail);
    }

    const blob = await response.blob();
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = 'Smart_Study_Quiz.docx';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);

    buttonEl.textContent = '✅ Đã tải Smart_Study_Quiz.docx!';
    setTimeout(() => {
      buttonEl.textContent = originalLabel;
    }, 2000);
  } catch (error) {
    console.error('Lỗi khi xuất file Word:', error);
    const msg = (error?.message || '').toLowerCase();
    if (error instanceof TypeError || msg.includes('failed to fetch')) {
      alert('Chưa bật Backend Server ở cổng 8000! Vui lòng bật server FastAPI trước khi tải file Word.');
    } else {
      alert(`Không thể xuất file Word: ${error.message}`);
    }
    buttonEl.textContent = originalLabel;
  } finally {
    buttonEl.disabled = false;
  }
}

async function refreshStudyHistoryDropdown(selectedId = '') {
  const historySelect = document.getElementById('study-history-select');
  if (!historySelect) return;

  try {
    const { studyHistory = [] } = await chrome.storage.local.get('studyHistory');
    historySelect.innerHTML = '';

    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = studyHistory.length > 0
      ? `-- Chọn bộ đề cũ (${studyHistory.length} mục gần nhất) --`
      : '-- Chưa có lịch sử bộ đề nào --';
    historySelect.appendChild(defaultOpt);

    studyHistory.forEach((entry) => {
      const opt = document.createElement('option');
      opt.value = entry.id;
      const qCount = Array.isArray(entry.quiz) ? entry.quiz.length : 0;
      opt.textContent = entry.type === 'web_summary'
        ? `[${entry.createdAt}] ${entry.title} (Tóm tắt)`
        : entry.type === 'youtube_summary'
          ? `[${entry.createdAt}] ${entry.title} (Tóm tắt YouTube)`
          : entry.quiz_type === 'vocab'
            ? `[${entry.createdAt}] ${entry.title} (🇬🇧 Từ vựng • ${qCount} từ)`
            : `[${entry.createdAt}] ${entry.title} (${qCount} câu)`;
      historySelect.appendChild(opt);
    });

    if (selectedId) {
      historySelect.value = selectedId;
    }
  } catch (error) {
    console.error('Lỗi khi tải danh sách lịch sử học tập:', error);
  }
}

async function saveQuizToHistory(sourceTitle, quizData, summaryText = '') {
  try {
    const { summary, quizList, quizType, validationError } = parseStructuredQuizPayload(quizData, summaryText);
    if ((!Array.isArray(quizList) || quizList.length === 0) && !summary && !validationError) {
      return;
    }

    const { studyHistory = [] } = await chrome.storage.local.get('studyHistory');
    const cleanTitle = String(sourceTitle || 'Bộ đề ôn tập').replace(/\s+/g, ' ').trim().slice(0, 48);
    const nowStr = new Date().toLocaleString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit'
    });

    // Lược bỏ ảnh nặng và SVG khi lưu lịch sử để giữ studyHistory gọn nhẹ (activePracticeSession vẫn giữ đầy đủ ảnh)
    const lightweightQuizList = Array.isArray(quizList)
      ? quizList.map((item) => {
          if (!item || typeof item !== 'object') return item;
          const cloned = { ...item };
          if (Array.isArray(cloned.images) && cloned.images.length > 0) {
            cloned.images = [];
          }
          if (typeof cloned.svg_sketch === 'string' && cloned.svg_sketch) {
            cloned.svg_sketch = '';
          }
          return cloned;
        })
      : [];

    const newEntry = {
      id: String(Date.now()),
      title: cleanTitle,
      createdAt: nowStr,
      summary: summary || '',
      quiz: lightweightQuizList,
      quiz_type: quizType,
      validation_error: validationError
    };

    const updatedHistory = [newEntry, ...studyHistory].slice(0, MAX_STUDY_HISTORY);
    await chrome.storage.local.set({ studyHistory: updatedHistory });
    await refreshStudyHistoryDropdown(newEntry.id);
  } catch (error) {
    console.error('Lỗi khi lưu lịch sử học tập:', error);
  }
}

function renderWebSummaryResult(data) {
  const quizResultEl = document.getElementById('quiz-result');
  if (!quizResultEl) return;

  const title = typeof data?.title === 'string' ? data.title.trim() : '';
  const summary = typeof data?.summary === 'string' ? data.summary : '';
  const rawSummaryLines = summary.includes('\n')
    ? summary.split(/\r?\n/)
    : summary.split(/\s+(?=-\s+|•\s+)/);
  const summaryLines = rawSummaryLines
    .map((line) => line
      .replace(/^\s*#{1,6}\s*/, '')
      .replace(/^\s*(?:[-*]\s+|•\s*)/, '')
      .replace(/\*\*/g, '')
      .replace(/(^|\s)\*\s+/g, '$1')
      .trim())
    .filter(Boolean);
  const keywords = Array.isArray(data?.keywords) ? data.keywords : [];
  quizResultEl.replaceChildren();
  quizResultEl.hidden = false;

  if (title) {
    const titleEl = document.createElement('h3');
    titleEl.className = 'web-summary-page-title';
    titleEl.textContent = title;
    quizResultEl.appendChild(titleEl);
  }

  const summaryBox = document.createElement('section');
  summaryBox.className = 'quiz-summary-box';
  const summaryHeading = document.createElement('div');
  summaryHeading.className = 'quiz-summary-title';
  summaryHeading.textContent = '📌 Tóm tắt nội dung';
  const summaryContent = document.createElement('div');
  summaryContent.className = 'quiz-summary-content';
  summaryLines.forEach((line) => {
    const lineEl = document.createElement('p');
    lineEl.className = 'summary-line';
    lineEl.textContent = line;
    summaryContent.appendChild(lineEl);
  });
  summaryBox.append(summaryHeading, summaryContent);
  quizResultEl.appendChild(summaryBox);

  const keywordBox = document.createElement('section');
  keywordBox.className = 'quiz-summary-box';
  const keywordHeading = document.createElement('div');
  keywordHeading.className = 'quiz-summary-title';
  keywordHeading.textContent = '🔑 Từ khóa tiếng Anh & Luyện phát âm';
  const keywordList = document.createElement('div');
  keywordList.className = 'web-keyword-list';

  keywords.forEach((item) => {
    const term = typeof item?.term === 'string' ? item.term.trim() : '';
    if (!term) return;

    const keywordItem = document.createElement('article');
    keywordItem.className = 'keyword-item';
    const termRow = document.createElement('div');
    termRow.className = 'keyword-term-row';
    const termEl = document.createElement('strong');
    termEl.className = 'keyword-term';
    termEl.textContent = term;
    const ipaEl = document.createElement('span');
    ipaEl.className = 'keyword-ipa';
    ipaEl.textContent = typeof item.ipa === 'string' ? item.ipa : '';
    const posEl = document.createElement('span');
    posEl.className = 'keyword-pos';
    posEl.textContent = item.pos ? `(${String(item.pos)})` : '';
    const speakButton = document.createElement('button');
    speakButton.type = 'button';
    speakButton.className = 'speak-word-btn';
    speakButton.title = 'Nghe phát âm chuẩn';
    speakButton.setAttribute('aria-label', `Nghe phát âm từ ${term}`);
    speakButton.textContent = '🔊';
    speakButton.addEventListener('click', () => {
      if (!window.speechSynthesis || typeof SpeechSynthesisUtterance !== 'function') {
        setMascotStatus('Trình duyệt này không hỗ trợ phát âm tự động.', 'error');
        return;
      }

      document.querySelectorAll('.speak-word-btn.is-speaking').forEach((button) => {
        button.classList.remove('is-speaking');
      });
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(term);
      utterance.lang = 'en-US';
      utterance.rate = 0.9;
      utterance.onstart = () => speakButton.classList.add('is-speaking');
      utterance.onend = () => speakButton.classList.remove('is-speaking');
      utterance.onerror = () => {
        const wasSpeaking = speakButton.classList.contains('is-speaking');
        speakButton.classList.remove('is-speaking');
        if (wasSpeaking) setMascotStatus(`Không thể phát âm từ "${term}".`, 'error');
      };
      window.speechSynthesis.speak(utterance);
    });

    const meaningEl = document.createElement('div');
    meaningEl.className = 'keyword-meaning';
    meaningEl.textContent = typeof item.meaning === 'string' ? item.meaning : '';
    termRow.append(termEl, ipaEl, posEl, speakButton);
    keywordItem.append(termRow, meaningEl);
    keywordList.appendChild(keywordItem);
  });
  keywordBox.append(keywordHeading, keywordList);
  quizResultEl.appendChild(keywordBox);

  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'action-btn web-action summary-copy-btn';
  copyButton.textContent = '📋 Sao chép bản tóm tắt';
  copyButton.addEventListener('click', async () => {
    const keywordCopyLines = keywords
      .filter((item) => typeof item?.term === 'string' && item.term.trim())
      .map((item) => {
        const term = item.term.trim();
        const ipa = typeof item.ipa === 'string' ? item.ipa.trim() : '';
        const pos = typeof item.pos === 'string' ? item.pos.trim() : '';
        const meaning = typeof item.meaning === 'string' ? item.meaning.trim() : '';
        return `${term} - ${ipa} (${pos}): ${meaning}`;
      });
    const copyText = [
      title,
      '',
      '📌 Tóm tắt nội dung',
      ...summaryLines,
      '',
      '🔑 Từ khóa tiếng Anh',
      ...keywordCopyLines
    ].filter(Boolean).join('\n');

    try {
      try {
        await navigator.clipboard.writeText(copyText);
      } catch (clipboardError) {
        const copyArea = document.createElement('textarea');
        copyArea.value = copyText;
        copyArea.setAttribute('readonly', '');
        copyArea.style.position = 'fixed';
        copyArea.style.opacity = '0';
        document.body.appendChild(copyArea);
        let copied = false;
        try {
          copyArea.select();
          copied = typeof document.execCommand === 'function' && document.execCommand('copy');
        } finally {
          copyArea.remove();
        }
        if (!copied) throw new Error(`Không thể sao chép bản tóm tắt: ${clipboardError.message}`);
      }
      setMascotStatus('Đã sao chép bản tóm tắt vào bộ nhớ tạm!', 'idle');
    } catch (error) {
      console.error('Lỗi khi sao chép bản tóm tắt:', error);
      setMascotStatus(`Không thể sao chép bản tóm tắt: ${error.message}`, 'error');
    }
  });
  quizResultEl.appendChild(copyButton);
}

async function saveWebSummaryToHistory(data, sourceTitle) {
  const { studyHistory = [] } = await chrome.storage.local.get('studyHistory');
  const cleanTitle = String(sourceTitle || data?.title || 'Tóm tắt trang web')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48);
  const createdAt = new Date().toLocaleString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit'
  });
  const newEntry = {
    id: String(Date.now()),
    type: 'web_summary',
    title: cleanTitle,
    createdAt,
    summary: typeof data?.summary === 'string' ? data.summary : '',
    keywords: Array.isArray(data?.keywords) ? data.keywords : [],
    url: typeof data?.url === 'string' ? data.url : '',
    quiz: []
  };

  await chrome.storage.local.set({
    studyHistory: [newEntry, ...studyHistory].slice(0, MAX_STUDY_HISTORY)
  });
  await refreshStudyHistoryDropdown(newEntry.id);
}

function isValidPracticeQuestion(item) {
  const options = normalizeOptions(item?.options).filter((option) => option.text);
  return Boolean(
    String(item?.question || '').trim() &&
    options.length >= 2 &&
    options.length <= 6 &&
    options.some((option, index) => isCorrectOption(option, index, item.correct_answer))
  );
}

function getFlashcardBack(item) {
  const directBack = item?.meaning_vi || item?.back;
  if (typeof directBack === 'string' && directBack.trim()) return directBack.trim();

  const options = normalizeOptions(item?.options);
  const correctOption = options.find((option, index) => isCorrectOption(option, index, item?.correct_answer));
  if (correctOption) return correctOption.text;

  const answer = String(item?.answer || '').trim();
  if (answer && !/^[A-F]$/i.test(answer)) return answer;
  return String(item?.explanation || '').trim();
}

function shakeButton(button) {
  if (!button) return;
  button.classList.remove('is-shaking');
  void button.offsetWidth;
  button.classList.add('is-shaking');
  button.addEventListener('animationend', () => button.classList.remove('is-shaking'), { once: true });
}

async function openPracticeRoom(mode, button) {
  const quizType = currentQuizSession?.quizType || 'standard';
  const quizList = Array.isArray(currentQuizSession?.quizList) ? currentQuizSession.quizList : [];
  let validList;
  let failureMessage;

  if (mode === 'quiz') {
    validList = quizList.filter(isValidPracticeQuestion);
    if (quizType === 'invalid_scan' || validList.length === 0) {
      failureMessage = 'Không nhận diện được đáp án trắc nghiệm (A–F) hoặc dấu in đậm/* trong đề. Hãy thử Lật thẻ hoặc kiểm tra lại file!';
    } else if (validList.length < quizList.length) {
      setMascotStatus(`Đã bỏ qua ${quizList.length - validList.length} câu thiếu đáp án hợp lệ; đang mở phòng thi.`, 'idle');
    }
  } else {
    validList = quizList.filter((item) => String(item?.word || item?.question || item?.front || '').trim() && getFlashcardBack(item));
    if ((quizType === 'invalid_vocab' && validList.length === 0) || validList.length === 0) {
      failureMessage = 'Không nhận diện được danh sách từ vựng Tiếng Anh hợp lệ để tạo thẻ lật!';
    }
  }

  if (failureMessage) {
    shakeButton(button);
    setMascotStatus(failureMessage, 'error');
    return;
  }

  const sessionTitle = currentQuizSession?.title || 'Bộ đề ôn tập';
  const inferredSourceType = sessionTitle.toLowerCase().endsWith('.docx') || sessionTitle.toLowerCase().endsWith('.pdf')
    ? 'docx'
    : 'text';
  const session = {
    title: sessionTitle,
    summary: currentQuizSession?.summary || '',
    quiz: validList,
    quiz_type: quizType,
    source_type: inferredSourceType,
    mode: mode === 'quiz' ? 'quiz' : 'flashcard',
    createdAt: Date.now()
  };

  try {
    await chrome.storage.local.set({ activePracticeSession: session });
    setTimeout(() => {
      chrome.tabs
        .create({ url: chrome.runtime.getURL('practice.html'), active: true })
        .catch((error) => {
          console.error('Không thể mở Phòng luyện tập:', error);
          setMascotStatus(`Không thể mở Phòng luyện tập: ${error.message}`, 'error');
        });
    }, 220);
  } catch (error) {
    console.error('Không thể mở Phòng luyện tập:', error);
    setMascotStatus(`Không thể mở Phòng luyện tập: ${error.message}`, 'error');
  }
}

function renderInteractiveQuiz(quizData, summaryText = '', title = 'Bộ đề ôn tập', summaryTextOnly = false, options = {}) {
  const quizResultEl = document.getElementById('quiz-result');
  if (!quizResultEl) return;

  const { summary, quizList, quizType, validationError } = parseStructuredQuizPayload(quizData, summaryText);
  quizResultEl.innerHTML = '';
  quizResultEl.hidden = false;
  currentQuizSession = {
    title,
    summary,
    quizList: Array.isArray(quizList) ? quizList : [],
    quizType,
    validationError
  };

  if (summary) {
    const summaryBox = document.createElement('div');
    summaryBox.className = 'quiz-summary-box';

    const summaryTitle = document.createElement('div');
    summaryTitle.className = 'quiz-summary-title';
    summaryTitle.textContent = '📌 Tóm tắt nội dung';

    const summaryContent = document.createElement('div');
    summaryContent.className = 'quiz-summary-content';
    if (summaryTextOnly) {
      summaryContent.textContent = summary;
    } else {
      summaryContent.innerHTML = formatSummaryMarkdown(summary);
    }

    summaryBox.appendChild(summaryTitle);
    summaryBox.appendChild(summaryContent);
    quizResultEl.appendChild(summaryBox);
  }

  const validationBadge = document.createElement('div');
  validationBadge.className = `quiz-validation-badge ${quizType.startsWith('invalid_') ? 'is-invalid' : ''}`;
  if (quizType === 'vocab') {
    validationBadge.textContent = '🇬🇧 Bộ thẻ Từ vựng Tiếng Anh';
  } else if (quizType === 'scan_exam') {
    validationBadge.textContent = quizList.some(isValidPracticeQuestion)
      ? '✅ Đề có sẵn đã được bóc tách'
      : '⚠️ Đề có sẵn chưa đủ dữ liệu đáp án';
  } else if (quizType === 'invalid_scan') {
    validationBadge.textContent = '⚠️ Không nhận diện được đáp án được đánh dấu';
  } else if (quizType === 'invalid_vocab') {
    validationBadge.textContent = '⚠️ Không nhận diện được từ vựng tiếng Anh';
  } else {
    validationBadge.textContent = '✅ Đạt chuẩn trắc nghiệm (A–F)';
  }
  quizResultEl.appendChild(validationBadge);

  const isVocab =
    quizType === 'vocab' || quizType === 'invalid_vocab' || currentDifficulty === 'vocab';
  if (quizType === 'vocab') {
    syncDifficultyForVocab(true);
  }

  const practiceActions = document.createElement('div');
  practiceActions.className = 'practice-launch-actions';
  let launchButton = null;
  if (isVocab) {
    // Bảng từ vựng: chỉ hiện nút Lật thẻ
    const openFlashcardButton = document.createElement('button');
    openFlashcardButton.type = 'button';
    openFlashcardButton.id = 'open-practice-flashcard-btn';
    openFlashcardButton.className = 'action-btn web-action';
    openFlashcardButton.textContent = '🗂️ Lật thẻ';
    openFlashcardButton.addEventListener('click', () => openPracticeRoom('flashcard', openFlashcardButton));
    practiceActions.appendChild(openFlashcardButton);
    launchButton = openFlashcardButton;
  } else {
    // Đề trắc nghiệm thông thường: chỉ hiện nút Thi Trắc nghiệm
    const openQuizButton = document.createElement('button');
    openQuizButton.type = 'button';
    openQuizButton.id = 'open-practice-quiz-btn';
    openQuizButton.className = 'action-btn primary-action';
    openQuizButton.textContent = '🚀 Thi Trắc nghiệm';
    openQuizButton.addEventListener('click', () => openPracticeRoom('quiz', openQuizButton));
    practiceActions.appendChild(openQuizButton);
    launchButton = openQuizButton;
  }
  if (practiceActions.children.length === 1) {
    practiceActions.classList.add('is-single');
  }
  quizResultEl.appendChild(practiceActions);

  if (options?.autoOpen) {
    const canAutoOpenFlashcard = isVocab && quizType !== 'invalid_vocab' && quizList.length > 0;
    const canAutoOpenQuiz = !isVocab && quizType !== 'invalid_scan' && quizList.some(isValidPracticeQuestion);
    if (canAutoOpenFlashcard) {
      void openPracticeRoom('flashcard', launchButton);
    } else if (canAutoOpenQuiz) {
      void openPracticeRoom('quiz', launchButton);
    }
  }

  // Chỉ xem trước tối đa 5 thẻ có ảnh trên Side Panel để tránh lag khi bộ từ > 5 thẻ (100+ thẻ)
  const previewItems = quizList.slice(0, 5);
  previewItems.forEach((question, index) => {
    if (!Array.isArray(question?.images) || question.images.length === 0) return;

    const imagePreview = document.createElement('section');
    imagePreview.className = 'quiz-image-preview';
    const questionTitle = document.createElement('p');
    questionTitle.textContent = String(question.question || `Câu ${index + 1}`);
    imagePreview.appendChild(questionTitle);

    question.images.forEach((imageUrl) => {
      if (typeof imageUrl !== 'string' || !imageUrl.startsWith('data:image/')) return;
      const image = document.createElement('img');
      image.className = 'quiz-inline-img';
      image.src = imageUrl;
      image.alt = `Hình minh họa câu ${index + 1}`;
      image.style.display = 'block';
      image.style.maxWidth = '100%';
      image.style.maxHeight = '220px';
      image.style.width = 'auto';
      image.style.height = 'auto';
      image.style.margin = '8px auto';
      imagePreview.appendChild(image);
    });

    if (imagePreview.querySelector('img')) {
      quizResultEl.appendChild(imagePreview);
    }
  });

  const exportBtn = document.createElement('button');
  exportBtn.type = 'button';
  exportBtn.className = 'quiz-export-btn';
  exportBtn.textContent = '📥 Tải file Word (.docx)';
  exportBtn.addEventListener('click', () => {
    exportQuizToDocx(summary, currentQuizSession.quizList, exportBtn);
  });
  quizResultEl.appendChild(exportBtn);
}

function parseScanExamText(text) {
  const questionStart = /^\s*(?:\*\*)?(?:Câu\s*\d+\s*[:.)-]?|\d{1,3}\s*[.)])\s*(.*?)\s*(?:\*\*)?\s*$/i;
  const optionStart = /^\s*(\*)?\s*(?:\*\*)?([A-F])[.):\-]\s*(.*?)\s*$/i;
  const quiz = [];
  let current = null;

  const finishQuestion = () => {
    if (!current || !current.question.trim()) return;
    const optionCount = Object.keys(current.options).length;
    if (optionCount < 2 || optionCount > 6) return;
    quiz.push({
      question: current.question.trim(),
      options: current.options,
      correct_answer: current.correctAnswer,
      explanation: ''
    });
  };

  for (const line of text.split(/\r?\n/)) {
    if (questionStart.test(line)) {
      finishQuestion();
      current = {
        question: line.replace(/\*\*(.*?)\*\*/g, '$1').trim(),
        options: {},
        correctAnswer: '',
        lastOption: ''
      };
      continue;
    }
    if (!current) continue;

    const optionMatch = line.match(optionStart);
    if (optionMatch) {
      const letter = optionMatch[2].toUpperCase();
      const originalText = optionMatch[3].trim();
      const marked = Boolean(
        optionMatch[1] ||
        /\*\*.+?\*\*/.test(originalText) ||
        originalText.startsWith('*') ||
        originalText.endsWith('*')
      );
      const answerText = originalText
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/^\*+|\*+$/g, '')
        .trim();
      if (answerText) {
        current.options[letter] = answerText;
        current.lastOption = letter;
        if (marked) current.correctAnswer = letter;
      }
      continue;
    }

    const continuation = line.trim();
    if (!continuation) continue;
    const cleanContinuation = continuation.replace(/\*\*(.*?)\*\*/g, '$1');
    if (current.lastOption) {
      current.options[current.lastOption] += ` ${cleanContinuation}`;
    } else {
      current.question += ` ${cleanContinuation}`;
    }
  }
  finishQuestion();

  if (!quiz.length || !quiz.some((item) => item.correct_answer)) {
    return { quiz_type: 'invalid_scan', validation_error: 'NO_BOLD_OR_STAR_ANSWER', quiz: [] };
  }
  return { quiz_type: 'scan_exam', quiz };
}

function parseGeminiJson(text) {
  const cleaned = String(text || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch (_) {
    const match = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (!match) throw new Error('Phản hồi Gemini không chứa JSON hợp lệ.');
    return JSON.parse(match[1]);
  }
}

let currentDifficulty = 'normal';

function syncDifficultyForVocab(isVocabMode) {
  const difficultySelect = document.getElementById('quiz-difficulty');
  if (!difficultySelect) return;

  const options = Array.from(difficultySelect.options || []);
  if (isVocabMode) {
    options.forEach((opt) => {
      if (opt.value === 'normal' || opt.value === 'shuffle') {
        opt.hidden = true;
        opt.disabled = true;
      } else {
        opt.hidden = false;
        opt.disabled = false;
      }
    });
    difficultySelect.value = 'vocab';
    currentDifficulty = 'vocab';
  } else {
    options.forEach((opt) => {
      opt.hidden = false;
      opt.disabled = false;
    });
    if (difficultySelect.value === 'vocab') {
      difficultySelect.value = 'normal';
      currentDifficulty = 'normal';
    }
  }
}

// Nén ảnh Data URL sang image/webp nhẹ bằng <canvas> để chịu tải mượt 100+ thẻ
function compressImageDataUrl(dataUrl, maxWidth = 360, quality = 0.75) {
  return new Promise((resolve) => {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
      resolve(dataUrl || '');
      return;
    }
    const img = new Image();
    img.onload = () => {
      try {
        const naturalWidth = img.naturalWidth || img.width || maxWidth;
        const naturalHeight = img.naturalHeight || img.height || maxWidth;
        const scale = Math.min(1, maxWidth / Math.max(1, naturalWidth));
        const targetWidth = Math.max(1, Math.round(naturalWidth * scale));
        const targetHeight = Math.max(1, Math.round(naturalHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(dataUrl);
          return;
        }
        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
        const compressed = canvas.toDataURL('image/webp', quality);
        resolve(compressed && compressed.startsWith('data:image/') ? compressed : dataUrl);
      } catch (_) {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

function isNonVocabPrefix(word) {
  const lowered = String(word || '').trim().toLowerCase();
  if (!lowered || !/[a-z]/.test(lowered)) return true;
  if (/^(?:câu|question|bài|chương|chủ\s*đề|phần|unit|topic|lesson|chapter|note|lưu\s*ý|ví\s*dụ|example)\b/i.test(lowered)) {
    return true;
  }
  if (/^[a-f]$/i.test(lowered)) return true;
  return false;
}

// Nhận diện cục bộ (0ms, không gọi API) danh sách từ vựng có tiêu đề Chủ đề/Chương/Unit,
// hỗ trợ cả "word (pos): meaning" và "word: meaning" / "word - meaning"
function parseLocalVocabPos(rawText, imagesByLineIndex = null) {
  const lines = String(rawText || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\*\*(.*?)\*\*/g, '$1').trim())
    .filter(Boolean);
  if (lines.length < 2) return null;

  const topicPattern = /^(?:Chủ\s*đề|Chương|Bài|Phần|Unit|Topic|Lesson|Chapter)\s*\d*[:.\-–]?\s*.+$/i;
  const vocabPosPattern = /^(?:\d+[.)]\s*|[-•*]\s*)?([A-Za-z][A-Za-z'’\- ]{0,55}?)\s*\(\s*([A-Za-z.\/, ]{1,20})\s*\)\s*[:：=\-–—]\s*(.+)$/;
  const vocabPlainPattern = /^(?:\d+[.)]\s*|[-•*]\s*)?([A-Za-z][A-Za-z'’\- ]{0,55}?)\s*(?:[:：=]\s*|\s+[-–—]\s+)(.+)$/;

  let currentTopic = '';
  let topicLines = 0;
  const quiz = [];

  lines.forEach((line, lineIdx) => {
    if (topicPattern.test(line) && !vocabPosPattern.test(line)) {
      currentTopic = line.replace(/\s+/g, ' ').trim();
      topicLines += 1;
      return;
    }

    let word = '';
    let pos = '';
    let meaning = '';
    const posMatch = line.match(vocabPosPattern);
    if (posMatch) {
      word = posMatch[1].replace(/\s+/g, ' ').trim();
      pos = posMatch[2].replace(/\s+/g, ' ').trim();
      meaning = posMatch[3].trim();
    } else {
      const plainMatch = line.match(vocabPlainPattern);
      if (plainMatch) {
        const candidateWord = plainMatch[1].replace(/\s+/g, ' ').trim();
        const candidateMeaning = plainMatch[2].trim();
        if (!isNonVocabPrefix(candidateWord) && candidateWord.split(/\s+/).length <= 6) {
          word = candidateWord;
          meaning = candidateMeaning;
        }
      }
    }

    if (!word || !meaning || isNonVocabPrefix(word)) return;

    const lineImages = imagesByLineIndex && Array.isArray(imagesByLineIndex.get(lineIdx))
      ? imagesByLineIndex.get(lineIdx)
      : [];

    quiz.push({
      word,
      pos,
      topic: currentTopic,
      question: pos ? `${word} (${pos})` : word,
      front: word,
      meaning_vi: meaning,
      back: meaning,
      answer: meaning,
      correct_answer: meaning,
      options: [],
      images: lineImages,
      ipa: '',
      example_en: '',
      example_vi: '',
      svg_sketch: '',
      explanation: ''
    });
  });

  const effectiveLines = Math.max(1, lines.length - topicLines);
  if (quiz.length < 2 || (quiz.length < 3 && quiz.length / effectiveLines < 0.4)) return null;
  if (quiz.length / effectiveLines < 0.4 && quiz.length < 3) return null;
  return { quiz_type: 'vocab', summary: '', quiz };
}

// Bóc tách từ vựng cục bộ (0ms) từ file .docx kèm nén ảnh nhúng (nếu có) sang WebP
async function parseLocalDocxVocab(file) {
  if (!file || !file.name.toLowerCase().endsWith('.docx')) return null;
  const arrayBuffer = await file.arrayBuffer();

  if (window.mammoth?.convertToHtml) {
    try {
      const htmlResult = await window.mammoth.convertToHtml({ arrayBuffer });
      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlResult.value || '', 'text/html');
      const blocks = Array.from(doc.body.querySelectorAll('p, li, tr, h1, h2, h3, h4'));
      const textLines = [];
      const imagesByLineIndex = new Map();

      for (const block of blocks) {
        const blockImages = Array.from(block.querySelectorAll('img'))
          .map((img) => img.getAttribute('src') || '')
          .filter((src) => src.startsWith('data:image/'));
        const compressedImages = [];
        for (const imgSrc of blockImages) {
          compressedImages.push(await compressImageDataUrl(imgSrc, 360, 0.75));
        }

        const rawText = (block.textContent || '').trim();
        if (rawText) {
          const sublines = rawText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
          sublines.forEach((s) => textLines.push(s));
          if (compressedImages.length > 0 && textLines.length > 0) {
            const targetIdx = textLines.length - 1;
            const existing = imagesByLineIndex.get(targetIdx) || [];
            imagesByLineIndex.set(targetIdx, [...existing, ...compressedImages]);
          }
        } else if (compressedImages.length > 0 && textLines.length > 0) {
          const targetIdx = textLines.length - 1;
          const existing = imagesByLineIndex.get(targetIdx) || [];
          imagesByLineIndex.set(targetIdx, [...existing, ...compressedImages]);
        }
      }

      const parsed = parseLocalVocabPos(textLines.join('\n'), imagesByLineIndex);
      if (parsed) return parsed;
    } catch (error) {
      console.warn('Không thể bóc tách HTML từ DOCX cục bộ, thử extractRawText:', error);
    }
  }

  if (window.mammoth?.extractRawText) {
    const { value: rawText } = await window.mammoth.extractRawText({ arrayBuffer });
    return parseLocalVocabPos(rawText);
  }
  return null;
}

// Bóc tách cục bộ (0ms, không gọi API) đề trắc nghiệm có sẵn từ file .docx
// Giữ nguyên ảnh <img> và chữ in đậm <strong>/<b> để nhận diện đáp án đúng + bảng Answers cuối file
async function parseLocalDocxExam(file) {
  if (!file || !file.name.toLowerCase().endsWith('.docx') || !window.mammoth?.convertToHtml) {
    return null;
  }
  const arrayBuffer = await file.arrayBuffer();
  const htmlResult = await window.mammoth.convertToHtml({ arrayBuffer });
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlResult.value || '', 'text/html');
  const blocks = Array.from(doc.body.querySelectorAll('p, li, tr, h1, h2, h3, h4'));

  const extractedLines = [];
  const imagesByLineIndex = new Map();

  for (const block of blocks) {
    if (block.tagName === 'TR' && block.querySelector('p, li')) {
      continue;
    }
    const blockImages = Array.from(block.querySelectorAll('img'))
      .map((img) => img.getAttribute('src') || '')
      .filter((src) => src.startsWith('data:image/'));
    const compressedImages = [];
    for (const imgSrc of blockImages) {
      compressedImages.push(await compressImageDataUrl(imgSrc, 480, 0.8));
    }

    const cloned = block.cloneNode(true);
    cloned.querySelectorAll('strong, b').forEach((boldEl) => {
      const txt = (boldEl.textContent || '').trim();
      if (txt) {
        boldEl.textContent = `**${boldEl.textContent}**`;
      }
    });
    const rawBlockText = (cloned.textContent || '').replace(/\u00a0/g, ' ').trim();
    if (rawBlockText) {
      const sublines = rawBlockText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      sublines.forEach((s) => extractedLines.push(s));
      if (compressedImages.length > 0 && extractedLines.length > 0) {
        const targetIdx = extractedLines.length - 1;
        const existing = imagesByLineIndex.get(targetIdx) || [];
        imagesByLineIndex.set(targetIdx, [...existing, ...compressedImages]);
      }
    } else if (compressedImages.length > 0 && extractedLines.length > 0) {
      const targetIdx = extractedLines.length - 1;
      const existing = imagesByLineIndex.get(targetIdx) || [];
      imagesByLineIndex.set(targetIdx, [...existing, ...compressedImages]);
    }
  }

  if (extractedLines.length < 5) return null;

  let answerSectionIdx = -1;
  const halfIndex = Math.floor(extractedLines.length * 0.45);
  for (let i = halfIndex; i < extractedLines.length; i += 1) {
    const plain = extractedLines[i].replace(/\*\*/g, '').trim();
    if (/^(?:Answers|Answer\s*Key|Đáp\s*án|Bảng\s*đáp\s*án)\s*[:：]?/i.test(plain)) {
      answerSectionIdx = i;
    }
  }

  const answerMap = new Map();
  if (answerSectionIdx >= 0) {
    const answerBlockText = extractedLines
      .slice(answerSectionIdx)
      .join('\n')
      .replace(/\*\*/g, '');
    const pairRegex = /(?:Q\.?|Câu|Question)?\s*(\d{1,3})\s*[-:.)\s]\s*([A-F])(?=$|[^A-Za-z0-9])/gi;
    let m;
    while ((m = pairRegex.exec(answerBlockText)) !== null) {
      answerMap.set(Number(m[1]), m[2].toUpperCase());
    }
  }

  const questionLines = answerSectionIdx >= 0
    ? extractedLines.slice(0, answerSectionIdx)
    : extractedLines;

  const questionStartRe = /^(?:\*\*)?\s*(?:Câu|Question|Bài|Q\.?)\s*(\d{1,3})\s*[:.)\-]?\s*(.*)$/i;
  const numberedStartRe = /^(?:\*\*)?\s*(\d{1,3})\s*[.)]\s+(.+)$/;
  const singleOptionRe = /^(\*)?\s*(?:\*\*)?\s*([A-F])\s*[.):\-]\s*(.+)$/i;
  const inlineAnswerRe = /^(?:\*\*)?\s*(?:Đáp\s*án|Answer|Ans|Key)\s*[:：\-]?\s*([A-F])\b/i;

  const parsedQuestions = [];
  let current = null;

  const flushCurrent = () => {
    if (!current) return;
    const cleanQ = current.question.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
    const opts = current.options;
    const requiredFour = ['A', 'B', 'C', 'D'].every((l) => Boolean(opts[l] && opts[l].trim()));
    let correct = current.correctAnswer;
    if (!correct && current.number && answerMap.has(current.number)) {
      correct = answerMap.get(current.number);
    }
    if (cleanQ && requiredFour && correct && opts[correct]) {
      parsedQuestions.push({
        question: cleanQ,
        options: opts,
        correct_answer: correct,
        explanation: '',
        ...(current.images.length ? { images: current.images } : {})
      });
    }
    current = null;
  };

  for (let idx = 0; idx < questionLines.length; idx += 1) {
    const rawLine = questionLines[idx];
    const plainLine = rawLine.replace(/\*\*/g, '').trim();
    const lineImgs = imagesByLineIndex.get(idx) || [];

    const qMatch = rawLine.match(questionStartRe) || rawLine.match(numberedStartRe);
    if (qMatch && !singleOptionRe.test(rawLine)) {
      flushCurrent();
      current = {
        number: Number(qMatch[1]) || parsedQuestions.length + 1,
        question: plainLine,
        options: {},
        correctAnswer: '',
        lastOption: '',
        images: [...lineImgs]
      };
      continue;
    }

    if (!current) continue;
    if (lineImgs.length) current.images.push(...lineImgs);

    const ansMatch = plainLine.match(inlineAnswerRe);
    if (ansMatch) {
      current.correctAnswer = ansMatch[1].toUpperCase();
      continue;
    }

    const multiOptMatches = Array.from(rawLine.matchAll(/(?:^|\s)(\*?\s*(?:\*\*)?\s*[A-F]\s*[.)]\s*)/gi));
    if (multiOptMatches.length >= 2) {
      for (let k = 0; k < multiOptMatches.length; k += 1) {
        const startPos = multiOptMatches[k].index;
        const endPos = multiOptMatches[k + 1] ? multiOptMatches[k + 1].index : rawLine.length;
        const seg = rawLine.slice(startPos, endPos).trim();
        const segMatch = seg.match(singleOptionRe);
        if (!segMatch) continue;
        const letter = segMatch[2].toUpperCase();
        const origText = segMatch[3].trim();
        const isMarked = Boolean(
          segMatch[1] ||
          /\*\*/.test(seg) ||
          origText.startsWith('*') ||
          origText.endsWith('*')
        );
        const cleanOpt = origText.replace(/\*\*/g, '').replace(/^\*+|\*+$/g, '').trim();
        if (cleanOpt) {
          current.options[letter] = cleanOpt;
          current.lastOption = letter;
          if (isMarked && !current.correctAnswer) current.correctAnswer = letter;
        }
      }
      continue;
    }

    const optMatch = rawLine.match(singleOptionRe);
    if (optMatch) {
      const letter = optMatch[2].toUpperCase();
      const origText = optMatch[3].trim();
      const isMarked = Boolean(
        optMatch[1] ||
        /\*\*/.test(rawLine) ||
        origText.startsWith('*') ||
        origText.endsWith('*')
      );
      const cleanOpt = origText.replace(/\*\*/g, '').replace(/^\*+|\*+$/g, '').trim();
      if (cleanOpt) {
        current.options[letter] = cleanOpt;
        current.lastOption = letter;
        if (isMarked && !current.correctAnswer) current.correctAnswer = letter;
      }
      continue;
    }

    if (plainLine) {
      if (current.lastOption && current.options[current.lastOption]) {
        current.options[current.lastOption] = `${current.options[current.lastOption]} ${plainLine}`.trim();
        if (/\*\*/.test(rawLine) && !current.correctAnswer) {
          current.correctAnswer = current.lastOption;
        }
      } else {
        current.question = `${current.question} ${plainLine}`.trim();
      }
    }
  }
  flushCurrent();

  if (parsedQuestions.length < 3) return null;
  return { quiz_type: 'scan_exam', summary: '', quiz: parsedQuestions };
}

async function generateTextQuiz(text, apiKey, difficulty, numQuestions, onModelAttempt) {
  if (difficulty === 'normal' || difficulty === 'shuffle' || difficulty === 'mixed') {
    const scanned = parseScanExamText(text);
    if (scanned.quiz_type === 'scan_exam') {
      const explanationPrompt = `Viết giải thích ngắn bằng tiếng Việt cho đáp án đã đánh dấu trong từng câu. Không thay đổi câu hỏi, phương án hay đáp án. Chỉ trả JSON {"explanations":[{"index":1,"explanation":"..."}]}.\n${JSON.stringify(scanned.quiz)}`;
      const explanationResponse = await callGeminiWithFallback(explanationPrompt, apiKey, onModelAttempt);
      const explanations = parseGeminiJson(explanationResponse).explanations || [];
      const explanationMap = new Map(
        explanations.map((item) => [Number(item.index), String(item.explanation || '')])
      );
      scanned.quiz.forEach((item, index) => {
        item.explanation = explanationMap.get(index + 1) || '';
      });
      return scanned;
    }
  }

  if (difficulty === 'vocab') {
    const vocabPrompt = `Bạn là chuyên gia dạy từ vựng tiếng Anh cho người Việt. Đầu vào có thể là danh sách từ/cụm từ kèm nghĩa hoặc một bài đọc tiếng Anh. Với danh sách, hãy xử lý các mục hợp lệ; với bài đọc, chọn 10–20 từ/cụm từ có giá trị học tập nhất. Không bịa từ không có trong văn bản nếu đầu vào là danh sách.
Chỉ trả về JSON hợp lệ theo schema: {"quiz_type":"vocab","quiz":[{"question":"ubiquitous (adj)","ipa":"/.../","meaning_vi":"nghĩa tiếng Việt","synonyms":"...","antonyms":"...","example":"English sentence","example_vi":"Câu tiếng Việt","options":{"A":"...","B":"...","C":"...","D":"..."},"correct_answer":"A","explanation":"Nghĩa tiếng Việt; đồng/trái nghĩa; ví dụ Anh–Việt."}]}.
Đan xen ba dạng câu hỏi: Anh → Việt, Việt → Anh, và điền từ vào câu ngữ cảnh tiếng Anh. Mỗi câu có đúng 4 lựa chọn, đáp án đúng và IPA. Nếu đầu vào không có từ vựng tiếng Anh hợp lệ, trả về {"quiz_type":"invalid_vocab","quiz":[]}.\n\nNỘI DUNG:\n${text}`;
    return callGeminiWithFallback(vocabPrompt, apiKey, onModelAttempt);
  }

  const difficultyLabels = {
    normal: 'bám sát nội dung theo đúng trình tự từ đầu đến cuối tài liệu',
    shuffle: 'bám sát nội dung theo đúng trình tự từ đầu đến cuối tài liệu',
    mixed: 'bám sát nội dung theo đúng trình tự từ đầu đến cuối tài liệu'
  };
  const countInstruction = numQuestions === 'all'
    ? 'Tạo số câu phù hợp với độ dài nội dung.'
    : `Tạo khoảng ${numQuestions} câu hỏi.`;
  const prompt = `Hãy đọc nội dung, tóm tắt ngắn gọn và tạo câu hỏi trắc nghiệm ${difficultyLabels[difficulty] || difficultyLabels.normal}. ${countInstruction} Mỗi câu có 2–6 phương án A–F, một correct_answer khớp với phương án và explanation. Sắp xếp câu hỏi theo trình tự nguồn từ đầu đến cuối, không đảo thứ tự câu hỏi hoặc đáp án. Chỉ trả JSON hợp lệ theo cấu trúc {"quiz_type":"standard","summary":"...","quiz":[{"question":"...","options":{"A":"...","B":"...","C":"...","D":"...","E":"...","F":"..."},"correct_answer":"A","explanation":"..."}]}.\nNỘI DUNG:\n${text}`;
  return callGeminiWithFallback(prompt, apiKey, onModelAttempt);
}


// --- SPRINT 3: Tạo câu hỏi trắc nghiệm bằng Gemini API từ văn bản dán tay ---
document.addEventListener('DOMContentLoaded', () => {
  const quizInput = document.getElementById('quiz-input');
  const generateQuizBtn = document.getElementById('generate-quiz-btn');
  const difficultySelect = document.getElementById('quiz-difficulty');
  const numQuestionsSelect = document.getElementById('num-questions');

  if (generateQuizBtn && quizInput) generateQuizBtn.addEventListener('click', async () => {
    const lessonText = quizInput.value.trim();

    if (!lessonText) {
      setMascotStatus('Vui lòng dán văn bản bài học trước khi tạo Quiz.', 'error');
      return;
    }

    // Luồng Dán Chữ: nhận diện bảng từ vựng cục bộ trong 0ms (không cần API Key)
    const localVocab = parseLocalVocabPos(lessonText);
    if (localVocab) {
      syncDifficultyForVocab(true);
      await saveQuizToHistory(`🇬🇧 Từ vựng: ${lessonText.slice(0, 28)}...`, localVocab);
      setMascotStatus(`Đã tạo xong bộ thẻ Từ vựng Tiếng Anh (${localVocab.quiz.length} từ).`, 'idle');
      renderInteractiveQuiz(localVocab, '', `Từ vựng: ${lessonText.slice(0, 40)}`, false, { autoOpen: true });
      return;
    }

    setMascotStatus('Đang tạo Quiz, vui lòng đợi...', 'loading');
    generateQuizBtn.disabled = true;

    try {
      const { geminiApiKey } = await chrome.storage.local.get('geminiApiKey');

      if (!geminiApiKey) {
        setMascotStatus('Vui lòng vào Cài đặt API Key trước.', 'error');
        return;
      }

      const difficulty = difficultySelect?.value || 'normal';
      currentDifficulty = difficulty;
      const numQuestions = numQuestionsSelect?.value || 'all';
      const generatedResponse = await generateTextQuiz(
        lessonText,
        geminiApiKey,
        difficulty,
        numQuestions,
        (modelName) => {
        setMascotStatus(`Đang tạo Quiz bằng model ${modelName}, vui lòng đợi...`, 'loading');
        }
      );

      const processedQuiz = applyQuizDifficulty(generatedResponse, difficulty);
      const parsedMeta = parseStructuredQuizPayload(processedQuiz, '');
      const isVocabResult = parsedMeta.quizType === 'vocab' || difficulty === 'vocab';
      if (isVocabResult) {
        syncDifficultyForVocab(true);
      }
      const shortTitle = isVocabResult
        ? `🇬🇧 Từ vựng: ${lessonText.slice(0, 28)}...`
        : `📝 Văn bản: ${lessonText.slice(0, 28)}...`;
      await saveQuizToHistory(shortTitle, processedQuiz);
      setMascotStatus(
        isVocabResult
          ? 'Đã tạo xong bộ thẻ Từ vựng Tiếng Anh từ văn bản.'
          : 'Đã tạo xong bộ Quiz từ văn bản.',
        'idle'
      );
      renderInteractiveQuiz(processedQuiz, '', `Văn bản: ${lessonText.slice(0, 40)}`, false, { autoOpen: true });
    } catch (error) {
      console.error('Lỗi khi gọi Gemini API:', error);
      setMascotStatus(`Đã xảy ra lỗi khi tạo Quiz: ${error.message}`, 'error');
    } finally {
      generateQuizBtn.disabled = false;
    }
  });
});


let ytLastWorkingModel = '';

function sampleYoutubeTranscript(transcript) {
  const text = String(transcript || '');
  const maxChars = 18000;
  const segmentChars = 6000;
  if (text.length <= maxChars) return text;

  const alignToLineStart = (offset) => {
    if (offset <= 0) return 0;
    const newlineIndex = text.indexOf('\n', offset);
    return newlineIndex < 0 ? offset : newlineIndex + 1;
  };
  const takeSegment = (offset) => {
    const start = alignToLineStart(offset);
    const targetEnd = Math.min(text.length, start + segmentChars);
    if (targetEnd === text.length) return text.slice(start, targetEnd).trim();
    const newlineIndex = text.lastIndexOf('\n', targetEnd);
    const end = newlineIndex > start ? newlineIndex : targetEnd;
    return text.slice(start, end).trim();
  };
  const lastStart = Math.max(0, text.length - segmentChars);
  const offsets = [0, Math.floor((text.length - segmentChars) / 2), lastStart];
  const labels = ['--- PHẦN ĐẦU VIDEO ---', '--- PHẦN GIỮA VIDEO ---', '--- PHẦN CUỐI VIDEO ---'];
  return offsets
    .map((offset, idx) => {
      const seg = takeSegment(offset);
      return seg ? `${labels[idx]}\n${seg}` : '';
    })
    .filter(Boolean)
    .join('\n\n')
    .slice(0, maxChars);
}

async function discoverYoutubeFlashModels(apiKey) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000);
  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
      { signal: controller.signal }
    );
    if (!resp.ok) return [];
    const data = await resp.json().catch(() => null);
    const rawModels = Array.isArray(data?.models) ? data.models : [];
    const result = [];
    rawModels.forEach((info) => {
      const methods = Array.isArray(info?.supportedGenerationMethods) ? info.supportedGenerationMethods : [];
      if (!methods.includes('generateContent')) return;
      const cleanName = String(info?.name || '').replace(/^models\//, '').trim();
      if (!isAllowedLiveGeminiFlashModel(cleanName)) return;
      if (!result.includes(cleanName)) result.push(cleanName);
    });
    return result;
  } catch (_) {
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
}

async function callYouTubeGeminiWithFallback(prompt, apiKey, onModelAttempt) {
  const discoveredModels = await discoverYoutubeFlashModels(apiKey);
  const mergedCandidates = [];

  if (ytLastWorkingModel && isAllowedLiveGeminiFlashModel(ytLastWorkingModel)) {
    mergedCandidates.push(ytLastWorkingModel);
  }
  [...PREFERRED_LIVE_FLASH_MODELS, ...discoveredModels].forEach((modelName) => {
    if (!isAllowedLiveGeminiFlashModel(modelName)) return;
    if (!mergedCandidates.includes(modelName)) {
      mergedCandidates.push(modelName);
    }
  });

  let lastError = null;
  const maxRounds = 2;

  for (let round = 1; round <= maxRounds; round += 1) {
    for (const modelName of mergedCandidates) {
      if (typeof onModelAttempt === 'function') {
        onModelAttempt(round === 1 ? modelName : `${modelName} (thử lại)`);
      }
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 35000);

      try {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              maxOutputTokens: 8192,
              temperature: 0.3
            }
          })
        });
        const data = await response.json().catch(() => null);

        if (!response.ok) {
          const message = String(data?.error?.message || `HTTP ${response.status}: ${response.statusText}`);
          const isRetryable =
            [400, 404, 429, 500, 502, 503, 504].includes(response.status) ||
            /high\s*demand|overloaded|unavailable|resource_exhausted|quota/i.test(message);
          console.warn(
            `[YouTube Gemini][Lượt ${round}] Model ${modelName} trả về HTTP ${response.status}: ${message}`
          );
          lastError = new Error(message);
          if (ytLastWorkingModel === modelName) {
            ytLastWorkingModel = '';
          }
          if (isRetryable) {
            continue;
          }
          continue;
        }

        const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawText) {
          lastError = new Error(`Model ${modelName} không trả về nội dung.`);
          continue;
        }

        try {
          const parsed = JSON.parse(String(rawText)
            .trim()
            .replace(/^```(?:json)?\s*/i, '')
            .replace(/\s*```$/i, '')
            .trim());
          if (
            !parsed ||
            typeof parsed.title !== 'string' ||
            typeof parsed.summary !== 'string' ||
            !Array.isArray(parsed.keywords)
          ) {
            throw new Error('Dữ liệu JSON tóm tắt YouTube không đúng cấu trúc.');
          }
          ytLastWorkingModel = modelName;
          return {
            title: parsed.title.trim(),
            summary: parsed.summary.trim(),
            keywords: parsed.keywords
          };
        } catch (error) {
          lastError = error;
          continue;
        }
      } catch (error) {
        lastError = error.name === 'AbortError'
          ? new Error(`Model ${modelName} quá thời gian chờ sau 35 giây.`)
          : error;
        if (ytLastWorkingModel === modelName) {
          ytLastWorkingModel = '';
        }
        console.warn(
          `[YouTube Gemini][Lượt ${round}] Model ${modelName} thất bại, trượt sang model kế tiếp:`,
          lastError.message
        );
        continue;
      } finally {
        clearTimeout(timeoutId);
      }
    }

    if (round < maxRounds) {
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
  }

  throw lastError || new Error('Các model Gemini nhanh hiện đang quá tải, không thể tóm tắt video lúc này.');
}

const callYoutubeGeminiWithFallback = callYouTubeGeminiWithFallback;

function buildYoutubeSummaryPrompt(videoData, summaryLevel) {
  const levelGuidance = {
    short: 'Tóm tắt cốt lõi trong 1–2 câu; mỗi câu/ý ở một dòng riêng.',
    medium: 'Tóm tắt thành 4–6 ý chính, mỗi ý ở một dòng riêng.',
    detailed: 'Chia nội dung thành các phần/chương quan trọng, mỗi phần ở một dòng riêng và nêu đủ diễn biến, luận cứ, ví dụ cùng số liệu quan trọng.',
    simple: 'Giải thích cho người mới bắt đầu bằng tiếng Việt gần gũi, gồm ba ý trên các dòng riêng: nói nôm na cốt lõi là gì; giải mã thuật ngữ khó bằng ví dụ; nêu ý nghĩa thực tế.'
  };
  const rawTranscriptLength = String(videoData.transcript || '').trim().length;
  const transcript = sampleYoutubeTranscript(videoData.transcript);
  const effectiveLength = Math.max(rawTranscriptLength, transcript.length);
  const targetKeywordRange =
    effectiveLength < 3000
      ? '10–14'
      : '18–25';

  return `Bạn là gia sư chuyên tóm tắt bài học từ video YouTube cho sinh viên.
Viết toàn bộ title và summary bằng tiếng Việt tự nhiên, dễ hiểu.
Mức tóm tắt: ${levelGuidance[summaryLevel] || levelGuidance.medium}
Trong summary, bắt đầu mỗi ý/chương quan trọng bằng mốc thời gian chính xác dạng [MM:SS] hoặc [HH:MM:SS] lấy từ phụ đề; không tự đoán thời gian.
Không dùng tiêu đề Markdown ###, dấu **, dấu * hoặc định dạng Markdown thừa. Có thể dùng dấu gạch đầu dòng đơn giản.
BẮT BUỘC quét xuyên suốt cả 3 lát cắt thời gian (PHẦN ĐẦU, PHẦN GIỮA và PHẦN CUỐI video — phân bổ đều, tuyệt đối không chỉ dừng ở vài phút đầu), xuất ĐẦY ĐỦ ${targetKeywordRange} mục trong mảng "keywords" (bao gồm cả từ vựng chuyên ngành lẫn cụm động từ / cụm từ học thuật collocations), mỗi mục gồm đủ: "term", "ipa", "pos" (n, v, adj, adv hoặc phrase), "meaning" (nghĩa tiếng Việt ngắn gọn sát ngữ cảnh), "context" (câu ví dụ tiếng Anh trích trực tiếp từ lời thoại video chứa từ khóa) và "timestamp" (mốc thời gian chính xác dạng "MM:SS" nơi từ khóa xuất hiện trong phụ đề).
Chỉ trả về một JSON hợp lệ theo cấu trúc {"title":"Tiêu đề video gọn gàng","summary":"Các ý tóm tắt, ngăn cách bằng ký tự xuống dòng \\n","keywords":[{"term":"English term","ipa":"/IPA/","pos":"n","meaning":"nghĩa tiếng Việt","context":"English sentence from transcript containing the term","timestamp":"MM:SS"}]}. Không thêm lời dẫn hoặc Markdown.

Tiêu đề video: ${videoData.title || ''}
Kênh: ${videoData.channelName || ''}
Ngày đăng: ${videoData.publishDate || ''}
Phụ đề có mốc thời gian (đã lấy mẫu đều từ đầu, giữa và cuối nếu quá dài):
${transcript}`;
}

function parseYoutubeTimestamp(timestamp) {
  const parts = String(timestamp || '').split(':').map(Number);
  if ((parts.length !== 2 && parts.length !== 3) || parts.some((part) => !Number.isInteger(part) || part < 0)) {
    return null;
  }
  return parts.length === 3
    ? parts[0] * 3600 + parts[1] * 60 + parts[2]
    : parts[0] * 60 + parts[1];
}

function isYoutubeUrl(urlString) {
  try {
    const hostname = new URL(urlString).hostname.toLowerCase();
    return hostname === 'youtube.com' ||
      hostname.endsWith('.youtube.com') ||
      hostname === 'youtu.be';
  } catch (_) {
    return false;
  }
}

function getYoutubeVideoId(urlString) {
  try {
    const url = new URL(urlString);
    return url.searchParams.get('v') ||
      url.pathname.match(/\/(?:shorts|embed|live)\/([^/?]+)/)?.[1] ||
      (url.hostname === 'youtu.be' ? url.pathname.slice(1).split('/')[0] : '') ||
      '';
  } catch (_) {
    return '';
  }
}

async function seekYoutubeVideo(videoUrl, timestamp) {
  const seconds = parseYoutubeTimestamp(timestamp);
  if (seconds === null) throw new Error('Mốc thời gian trong bản tóm tắt không hợp lệ.');

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id || !isYoutubeUrl(activeTab.url || '')) {
    throw new Error('Hãy mở video YouTube tương ứng để tua đến mốc này.');
  }
  const sourceVideoId = getYoutubeVideoId(videoUrl);
  const activeVideoId = getYoutubeVideoId(activeTab.url);
  if (sourceVideoId && activeVideoId && sourceVideoId !== activeVideoId) {
    throw new Error('Mở đúng video YouTube đã tóm tắt để tua đến mốc này.');
  }

  await chrome.scripting.executeScript({
    target: { tabId: activeTab.id },
    files: ['content.js']
  });
  const result = await chrome.tabs.sendMessage(activeTab.id, {
    action: 'SEEK_YOUTUBE_VIDEO',
    seconds
  });
  if (!result?.success) throw new Error(result?.error || 'Không thể tua video.');
}

async function getActiveYoutubeMetadata() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id || !isYoutubeUrl(activeTab.url || '')) {
    throw new Error('Hãy mở video YouTube trước khi sao chép trích dẫn.');
  }
  await chrome.scripting.executeScript({
    target: { tabId: activeTab.id },
    files: ['content.js']
  });
  const metadata = await chrome.tabs.sendMessage(activeTab.id, { type: 'GET_YOUTUBE_METADATA' });
  if (!metadata?.success) throw new Error('Không lấy được thông tin video YouTube hiện tại.');
  return metadata;
}

function getCleanYoutubeCitationUrl(videoUrl) {
  const videoId = getYoutubeVideoId(videoUrl);
  if (videoId) return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  const url = new URL(videoUrl);
  url.searchParams.delete('t');
  url.searchParams.delete('start');
  url.hash = '';
  return url.toString();
}

async function copyYoutubeText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (clipboardError) {
    const copyArea = document.createElement('textarea');
    copyArea.value = text;
    copyArea.setAttribute('readonly', '');
    copyArea.style.position = 'fixed';
    copyArea.style.opacity = '0';
    document.body.appendChild(copyArea);
    let copied = false;
    try {
      copyArea.select();
      copied = typeof document.execCommand === 'function' && document.execCommand('copy');
    } finally {
      copyArea.remove();
    }
    if (!copied) throw new Error(`Không thể sao chép: ${clipboardError.message}`);
  }
}

async function saveYoutubeSummaryToHistory(data) {
  const { studyHistory = [] } = await chrome.storage.local.get('studyHistory');
  const createdAt = new Date().toLocaleString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit'
  });
  const entry = {
    ...data,
    id: String(Date.now()),
    type: 'youtube_summary',
    createdAt
  };
  await chrome.storage.local.set({
    studyHistory: [entry, ...studyHistory].slice(0, MAX_STUDY_HISTORY)
  });
  await refreshStudyHistoryDropdown(entry.id);
}

function appendYoutubeInlineContent(parent, text, videoUrl) {
  const tokenPattern = /\*\*([\s\S]+?)\*\*|\[(\d{1,3}:\d{2}(?::\d{2})?)\]/g;
  let cursor = 0;
  let match;
  const appendText = (value) => {
    const cleanText = value.replace(/\*/g, '');
    if (cleanText) parent.appendChild(document.createTextNode(cleanText));
  };

  while ((match = tokenPattern.exec(text)) !== null) {
    appendText(text.slice(cursor, match.index));
    if (match[1] !== undefined) {
      const strong = document.createElement('strong');
      strong.textContent = match[1].replace(/\*/g, '');
      parent.appendChild(strong);
    } else {
      const timestampButton = document.createElement('button');
      const timestamp = match[2];
      timestampButton.type = 'button';
      timestampButton.className = 'yt-timestamp-btn';
      timestampButton.textContent = timestamp;
      timestampButton.title = `Tua video đến ${timestamp}`;
      timestampButton.addEventListener('click', async () => {
        try {
          await seekYoutubeVideo(videoUrl, timestamp);
          setMascotStatus(`Đã tua video đến ${timestamp}.`, 'idle');
        } catch (error) {
          setMascotStatus(error.message, 'error');
        }
      });
      parent.appendChild(timestampButton);
    }
    cursor = tokenPattern.lastIndex;
  }
  appendText(text.slice(cursor));
}

function renderYoutubeSummaryResult(data) {
  const ytResult = document.getElementById('yt-result');
  if (!ytResult) return;

  const title = String(data?.title || 'Tóm tắt video YouTube')
    .replace(/^\s*#{1,6}\s*/, '')
    .replace(/\*/g, '')
    .trim();
  const summary = typeof data?.summary === 'string' ? data.summary : '';
  const videoUrl = typeof data?.videoUrl === 'string' ? data.videoUrl : '';
  const summaryLines = summary.split(/\r?\n/)
    .map((line) => line
      .replace(/^\s*#{1,6}\s*/, '')
      .replace(/^\s*(?:\*\s+|-\s+|•\s*)/, '')
      .trim())
    .filter(Boolean);
  const keywords = Array.isArray(data?.keywords) ? data.keywords : [];
  ytResult.replaceChildren();

  const titleElement = document.createElement('h3');
  titleElement.className = 'web-summary-page-title';
  titleElement.textContent = title;
  ytResult.appendChild(titleElement);

  if (data?.missingCCWarning) {
    const ccWarningBanner = document.createElement('div');
    ccWarningBanner.className = 'yt-missing-cc-banner';
    ccWarningBanner.setAttribute('role', 'status');
    ccWarningBanner.style.cssText =
      'margin: 8px 0 10px; padding: 9px 12px; border-radius: 10px; background: #fffbeb; border: 1px solid #f59e0b; color: #92400e; font-size: 0.84rem; line-height: 1.45; font-weight: 500;';
    ccWarningBanner.textContent =
      '⚠️ Video này chưa bật phụ đề CC — AI đang tóm tắt dựa trên tiêu đề và mô tả video.';
    ytResult.appendChild(ccWarningBanner);
  }

  const summaryBox = document.createElement('section');
  summaryBox.className = 'quiz-summary-box';
  const summaryHeading = document.createElement('div');
  summaryHeading.className = 'quiz-summary-title';
  summaryHeading.textContent = '📌 Tóm tắt video';
  const summaryContent = document.createElement('div');
  summaryContent.className = 'quiz-summary-content';
  summaryLines.forEach((line) => {
    const lineElement = document.createElement('p');
    lineElement.className = 'yt-summary-line';
    appendYoutubeInlineContent(lineElement, line, videoUrl);
    summaryContent.appendChild(lineElement);
  });
  const note = document.createElement('small');
  note.className = 'yt-summary-note';
  note.textContent = 'Lưu ý: Phụ đề tự động có thể sai lệch nhỏ về thuật ngữ chuyên ngành.';
  summaryBox.append(summaryHeading, summaryContent, note);
  ytResult.appendChild(summaryBox);

  const keywordBox = document.createElement('section');
  keywordBox.className = 'quiz-summary-box';
  const keywordHeading = document.createElement('div');
  keywordHeading.className = 'quiz-summary-title';
  keywordHeading.textContent = '🔑 Từ khóa tiếng Anh & Luyện phát âm';
  const keywordList = document.createElement('div');
  keywordList.className = 'web-keyword-list';
  const validKeywords = keywords.filter((item) =>
    typeof item?.term === 'string' && item.term.trim()
  );
  validKeywords.forEach((item) => {
    const term = item.term.trim();
    const keywordItem = document.createElement('article');
    keywordItem.className = 'keyword-item';
    const termRow = document.createElement('div');
    termRow.className = 'keyword-term-row';
    const termElement = document.createElement('strong');
    termElement.className = 'keyword-term';
    termElement.textContent = term;
    const ipaElement = document.createElement('span');
    ipaElement.className = 'keyword-ipa';
    ipaElement.textContent = typeof item.ipa === 'string' ? item.ipa : '';
    const posElement = document.createElement('span');
    posElement.className = 'keyword-pos';
    posElement.textContent = item.pos ? `(${String(item.pos)})` : '';
    const speakButton = document.createElement('button');
    speakButton.type = 'button';
    speakButton.className = 'speak-word-btn';
    speakButton.title = 'Nghe phát âm chuẩn';
    speakButton.setAttribute('aria-label', `Nghe phát âm từ ${term}`);
    speakButton.textContent = '🔊';
    speakButton.addEventListener('click', () => {
      if (!window.speechSynthesis || typeof SpeechSynthesisUtterance !== 'function') {
        setMascotStatus('Trình duyệt này không hỗ trợ phát âm tự động.', 'error');
        return;
      }
      document.querySelectorAll('.speak-word-btn.is-speaking').forEach((button) => {
        button.classList.remove('is-speaking');
      });
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(term);
      utterance.lang = 'en-US';
      utterance.rate = 0.9;
      utterance.onstart = () => speakButton.classList.add('is-speaking');
      utterance.onend = () => speakButton.classList.remove('is-speaking');
      utterance.onerror = () => speakButton.classList.remove('is-speaking');
      window.speechSynthesis.speak(utterance);
    });
    const meaningElement = document.createElement('div');
    meaningElement.className = 'keyword-meaning';
    meaningElement.textContent = typeof item.meaning === 'string' ? item.meaning : '';
    termRow.append(termElement, ipaElement, posElement, speakButton);
    keywordItem.append(termRow, meaningElement);
    keywordList.appendChild(keywordItem);
  });
  keywordBox.append(keywordHeading, keywordList);

  const ytVideoId = getYoutubeVideoId(videoUrl);
  const flashcards = validKeywords
    .filter((item) => typeof item.meaning === 'string' && item.meaning.trim())
    .map((item) => {
      const term = item.term.trim();
      const posClean = String(item.pos || '').replace(/[()]/g, '').trim();
      const meaning = item.meaning.trim();
      const contextSentence = typeof item.context === 'string' ? item.context.trim() : '';
      const timestampLabel = String(item.timestamp || '').replace(/^\[|\]$/g, '').trim();
      const parsedSec = parseYoutubeTimestamp(timestampLabel);
      const timestampSec = Number.isFinite(parsedSec) ? parsedSec : null;
      const sourceEntry = {
        type: 'youtube',
        title,
        videoId: ytVideoId,
        videoUrl,
        ...(timestampSec !== null ? { timestampSec } : {}),
        ...(timestampLabel ? { timestampLabel } : {}),
        addedAt: Date.now()
      };
      return {
        word: term,
        pos: posClean,
        question: posClean ? `${term} (${posClean})` : term,
        front: term,
        answer: meaning,
        back: meaning,
        meaning_vi: meaning,
        correct_answer: meaning,
        options: [],
        ipa: typeof item.ipa === 'string' ? item.ipa : '',
        contextSentence,
        example_en: contextSentence,
        example_vi: '',
        timestampLabel,
        timestampSec,
        videoId: ytVideoId,
        videoUrl,
        videoTitle: title,
        sources: [sourceEntry],
        explanation: posClean ? `(${posClean})` : ''
      };
    });
  const practiceButton = document.createElement('button');
  practiceButton.type = 'button';
  practiceButton.className = 'action-btn web-action';
  practiceButton.textContent = '🎯 Luyện Tiếng Anh từ Video này';
  practiceButton.disabled = flashcards.length === 0;
  practiceButton.addEventListener('click', async () => {
    if (!flashcards.length) {
      setMascotStatus('Video chưa có từ khóa hợp lệ để tạo thẻ lật.', 'error');
      return;
    }
    try {
      await chrome.storage.local.set({
        activePracticeSession: {
          title: `${title} — Từ khóa`,
          summary: '',
          quiz: flashcards,
          quiz_type: 'vocab',
          source_type: 'youtube',
          videoId: ytVideoId,
          videoTitle: title,
          videoUrl,
          transcript: typeof data?.transcript === 'string' ? data.transcript : '',
          mode: 'flashcard',
          createdAt: Date.now()
        }
      });
      setTimeout(() => {
        chrome.tabs
          .create({ url: chrome.runtime.getURL('practice.html'), active: true })
          .catch((error) => {
            console.error('Không thể mở thẻ từ khóa YouTube:', error);
            setMascotStatus(`Không thể mở Phòng luyện tập: ${error.message}`, 'error');
          });
      }, 220);
    } catch (error) {
      console.error('Không thể mở thẻ từ khóa YouTube:', error);
      setMascotStatus(`Không thể mở Phòng luyện tập: ${error.message}`, 'error');
    }
  });
  keywordBox.appendChild(practiceButton);
  ytResult.appendChild(keywordBox);

  const actions = document.createElement('div');
  actions.className = 'youtube-result-actions';
  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'action-btn web-action';
  copyButton.textContent = '📋 Sao chép bản tóm tắt';
  copyButton.addEventListener('click', async () => {
    const keywordLines = validKeywords.map((item) =>
      `${item.term.trim()} - ${typeof item.ipa === 'string' ? item.ipa.trim() : ''} (${item.pos || ''}): ${item.meaning || ''}`
    );
    const copyText = [
      title,
      '',
      '📌 Tóm tắt video',
      ...summaryLines.map((line) => line.replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*/g, '')),
      '',
      '🔑 Từ khóa tiếng Anh',
      ...keywordLines
    ].join('\n');
    try {
      await copyYoutubeText(copyText);
      setMascotStatus('Đã sao chép bản tóm tắt YouTube vào bộ nhớ tạm!', 'idle');
    } catch (error) {
      setMascotStatus(error.message, 'error');
    }
  });

  const citationButton = document.createElement('button');
  citationButton.type = 'button';
  citationButton.className = 'action-btn primary-action';
  citationButton.textContent = '🎓 Copy trích dẫn';
  citationButton.addEventListener('click', async () => {
    try {
      const metadata = await getActiveYoutubeMetadata();
      const sourceVideoId = getYoutubeVideoId(videoUrl);
      const activeVideoId = getYoutubeVideoId(metadata.videoUrl);
      if (sourceVideoId && activeVideoId && sourceVideoId !== activeVideoId) {
        throw new Error('Hãy mở đúng video đã tóm tắt trước khi sao chép trích dẫn.');
      }
      const year = String(metadata.publishDate || '').match(/\b(?:19|20)\d{2}\b/)?.[0] || 'n.d.';
      const cleanUrl = getCleanYoutubeCitationUrl(metadata.videoUrl);
      const separator = cleanUrl.includes('?') ? '&' : '?';
      const seconds = Math.max(0, Number(metadata.currentSeconds) || 0);
      const citationTitle = metadata.title || title;
      const citation = `${metadata.channelName || 'YouTube'}. (${year}). ${citationTitle} [Video]. YouTube. ${cleanUrl}${separator}t=${seconds}s`;
      await copyYoutubeText(citation);
      setMascotStatus('Đã sao chép trích dẫn video kèm mốc thời gian!', 'idle');
    } catch (error) {
      setMascotStatus(error.message, 'error');
    }
  });
  actions.append(copyButton, citationButton);
  ytResult.appendChild(actions);
}

// --- Tóm tắt video YouTube bằng phụ đề có mốc thời gian ---
document.addEventListener('DOMContentLoaded', () => {
  const summarizeYtBtn = document.getElementById('summarize-yt-btn');
  const ytStatus = document.getElementById('yt-status');
  const ytResult = document.getElementById('yt-result');
  const summaryLevel = document.getElementById('yt-summary-level');

  if (summarizeYtBtn && ytStatus && ytResult) summarizeYtBtn.addEventListener('click', async () => {
    summarizeYtBtn.disabled = true;
    ytStatus.hidden = false;
    ytStatus.textContent = 'Đang cào Tiêu đề và Phụ đề (Transcript) từ tab YouTube...';
    ytResult.textContent = '';
    setMascotStatus('Đang lấy tiêu đề và phụ đề từ video YouTube...', 'loading');

    try {
      // 1. Tìm tab đang active trong cửa sổ hiện tại
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (
        !activeTab?.id ||
        !isYoutubeUrl(activeTab.url || '') ||
        new URL(activeTab.url).pathname !== '/watch'
      ) {
        ytStatus.hidden = true;
        ytResult.textContent = 'Vui lòng mở một video trên YouTube (youtube.com/watch) trước khi bấm tóm tắt!';
        setMascotStatus('Hãy mở một video YouTube trước khi yêu cầu tóm tắt.', 'error');
        return;
      }

      // 2. Gắn content.js vào tab YouTube hiện tại và gửi message lấy dữ liệu
      await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        files: ['content.js']
      });

      const videoData = await chrome.tabs.sendMessage(activeTab.id, {
        type: 'GET_YOUTUBE_DATA'
      });

      const rawTranscript = String(videoData?.transcript || '').trim();
      const fallbackTitle = String(videoData?.title || activeTab.title || '').replace(/\s*-\s*YouTube\s*$/i, '').trim();
      const fallbackDescription = String(videoData?.description || '').trim();
      const missingCCWarning = !videoData?.success || rawTranscript.length < 80;

      if (missingCCWarning && !fallbackTitle && !fallbackDescription) {
        const message = 'Video này chưa có phụ đề và không trích xuất được tiêu đề/mô tả để tóm tắt.';
        ytStatus.hidden = true;
        ytResult.textContent = message;
        setMascotStatus(message, 'error');
        return;
      }

      const effectiveVideoData = {
        ...(videoData || {}),
        success: true,
        title: fallbackTitle || 'Video YouTube',
        channelName: String(videoData?.channelName || '').trim(),
        publishDate: String(videoData?.publishDate || '').trim(),
        videoUrl: videoData?.videoUrl || activeTab.url,
        currentSeconds: Number(videoData?.currentSeconds) || 0,
        transcript: missingCCWarning
          ? [
              `Tiêu đề video: ${fallbackTitle || 'Không rõ'}`,
              videoData?.channelName ? `Kênh: ${videoData.channelName}` : '',
              fallbackDescription ? `Mô tả video:\n${fallbackDescription}` : '',
              rawTranscript ? `Đoạn phụ đề ngắn trích được:\n${rawTranscript}` : ''
            ]
              .filter(Boolean)
              .join('\n')
          : rawTranscript
      };

      // 3. Kiểm tra API Key trong chrome.storage.local
      const { geminiApiKey } = await chrome.storage.local.get('geminiApiKey');

      if (!geminiApiKey) {
        ytStatus.hidden = true;
        ytResult.textContent = 'Vui lòng vào Cài đặt API Key để nhập khóa trước!';
        setMascotStatus('Vui lòng vào Cài đặt API Key trước.', 'error');
        return;
      }

      const summaryLevelValue = ['short', 'medium', 'detailed', 'simple'].includes(summaryLevel?.value)
        ? summaryLevel.value
        : 'medium';
      const result = await callYouTubeGeminiWithFallback(
        buildYoutubeSummaryPrompt(effectiveVideoData, summaryLevelValue),
        geminiApiKey,
        (modelName) => {
          ytStatus.textContent = missingCCWarning
            ? `Video không có phụ đề CC — đang gửi tiêu đề & mô tả tới model ${modelName}...`
            : `Đã lấy phụ đề! Đang gửi tới model ${modelName} để tóm tắt...`;
          setMascotStatus(`Đang gửi nội dung tới model ${modelName} để tóm tắt...`, 'loading');
        }
      );
      const summaryData = {
        ...result,
        title: result.title || effectiveVideoData.title,
        channelName: effectiveVideoData.channelName,
        publishDate: effectiveVideoData.publishDate,
        videoUrl: effectiveVideoData.videoUrl,
        currentSeconds: effectiveVideoData.currentSeconds,
        transcript: sampleYoutubeTranscript(effectiveVideoData.transcript),
        missingCCWarning
      };
      ytStatus.hidden = true;
      renderYoutubeSummaryResult(summaryData);
      try {
        await saveYoutubeSummaryToHistory(summaryData);
        setMascotStatus('Đã tóm tắt và lưu lịch sử video YouTube.', 'idle');
      } catch (error) {
        console.error('Không thể lưu tóm tắt YouTube vào lịch sử:', error);
        setMascotStatus(`Đã tóm tắt nhưng không thể lưu lịch sử: ${error.message}`, 'error');
      }
    } catch (error) {
      console.error('Lỗi khi tóm tắt video YouTube:', error);
      ytStatus.hidden = true;
      ytResult.textContent = `Đã xảy ra lỗi khi tóm tắt video: ${error.message}`;
      setMascotStatus(`Đã xảy ra lỗi khi tóm tắt video: ${error.message}`, 'error');
    } finally {
      summarizeYtBtn.disabled = false;
    }
  });
});


// --- SPRINT 5 & 7: Tích hợp Backend FastAPI + Lịch sử Học tập (studyHistory) ---
document.addEventListener('DOMContentLoaded', async () => {
  const docUploadInput = document.getElementById('doc-upload');
  const numQuestionsSelect = document.getElementById('num-questions');
  const generateQuizFileBtn = document.getElementById('generate-quiz-file-btn');
  const generateQuizUrlBtn = document.getElementById('generate-quiz-url-btn');
  const historySelect = document.getElementById('study-history-select');
  const difficultySelect = document.getElementById('quiz-difficulty');
  const summaryLevelSelect = document.getElementById('summary-level');
  const pageReadingTime = document.getElementById('page-reading-time');
  const deleteHistoryBtn = document.getElementById('delete-history-btn');

  const BACKEND_BASE_URL = API_BASE_URL;
  let isProcessingUrl = false;

  // --- SPRINT 10.2: Nút mở nhanh Sổ tay Từ vựng Cần Ôn (X) & đồng bộ thời gian thực ---
  const quizViewCard = document.querySelector('#view-quiz .card');
  const quizResultAnchor = document.getElementById('quiz-result');
  let vocabBankBtn = document.getElementById('open-vocab-bank-btn');
  if (!vocabBankBtn && quizViewCard) {
    vocabBankBtn = document.createElement('button');
    vocabBankBtn.type = 'button';
    vocabBankBtn.id = 'open-vocab-bank-btn';
    vocabBankBtn.className = 'action-btn web-action';
    vocabBankBtn.style.marginTop = '10px';
    vocabBankBtn.style.width = '100%';
    vocabBankBtn.textContent = '📚 Sổ tay Từ vựng Cần Ôn (0)';
    if (quizResultAnchor && quizResultAnchor.parentElement === quizViewCard) {
      quizViewCard.insertBefore(vocabBankBtn, quizResultAnchor);
    } else {
      quizViewCard.appendChild(vocabBankBtn);
    }
  }

  async function refreshVocabBankButton() {
    if (!vocabBankBtn) return;
    try {
      const dueList = await vocabStorageManager.getDueList(Date.now());
      vocabBankBtn.textContent = `📚 Sổ tay Từ vựng Cần Ôn (${dueList.length})`;
    } catch (error) {
      console.warn('Không thể đếm sổ tay từ vựng:', error);
    }
  }

  if (vocabBankBtn) {
    vocabBankBtn.addEventListener('click', async () => {
      try {
        const dueList = await vocabStorageManager.getDueList(Date.now());
        if (!dueList.length) {
          setMascotStatus('Sổ tay Từ vựng Cần Ôn hiện chưa có từ nào đến hạn ôn tập!', 'idle');
          return;
        }
        const reviewCards = dueList.map((entry) => {
          const sources = Array.isArray(entry.sources) ? entry.sources : [];
          const ytSource = sources.find((src) => src?.type === 'youtube' && src?.videoId);
          return {
            id: entry.id,
            word: entry.word,
            pos: entry.pos || '',
            question: entry.pos ? `${entry.word} (${entry.pos})` : entry.word,
            front: entry.word,
            ipa: entry.ipa || '',
            meaning_vi: entry.meaning || '',
            back: entry.meaning || '',
            answer: entry.meaning || '',
            correct_answer: entry.meaning || '',
            options: [],
            contextSentence: entry.contextSentence || entry.example_en || '',
            example_en: entry.example_en || entry.contextSentence || '',
            example_vi: entry.example_vi || entry.exampleVi || '',
            topic: entry.topic || '',
            visual_category: entry.visual_category || entry.visualCategory || '',
            icon_emoji: entry.icon_emoji || entry.iconEmoji || '',
            visual_label: entry.visual_label || entry.visualLabel || '',
            memory_hook: entry.memory_hook || entry.memoryHook || '',
            svg_sketch: entry.svgSketch || '',
            svgSketch: entry.svgSketch || '',
            masteryLevel: Number(entry.masteryLevel || 0),
            nextReviewAt: Number(entry.nextReviewAt || 0),
            sources,
            ...(ytSource
              ? {
                  videoId: ytSource.videoId,
                  videoUrl: ytSource.videoUrl || `https://www.youtube.com/watch?v=${ytSource.videoId}`,
                  videoTitle: ytSource.title || '',
                  timestampSec: ytSource.timestampSec,
                  timestampLabel: ytSource.timestampLabel || ''
                }
              : {})
          };
        });

        await chrome.storage.local.set({
          activePracticeSession: {
            title: `📚 Sổ tay Từ vựng Cần Ôn (${reviewCards.length} từ)`,
            summary: '',
            quiz: reviewCards,
            quiz_type: 'vocab',
            source_type: 'vocab_bank',
            mode: 'flashcard',
            createdAt: Date.now()
          }
        });
        setMascotStatus(`Đang mở Sổ tay Từ vựng Cần Ôn (${reviewCards.length} từ)...`, 'idle');
        setTimeout(() => {
          chrome.tabs
            .create({ url: chrome.runtime.getURL('practice.html'), active: true })
            .catch((err) => {
              console.error('Không thể mở Sổ tay Từ vựng:', err);
              setMascotStatus(`Không thể mở Phòng luyện tập: ${err.message}`, 'error');
            });
        }, 220);
      } catch (error) {
        console.error('Lỗi khi mở Sổ tay Từ vựng:', error);
        setMascotStatus(`Không thể mở Sổ tay Từ vựng: ${error.message}`, 'error');
      }
    });
    void refreshVocabBankButton();
  }

  // --- SPRINT 11: Nút Ôn câu hay sai (X) theo trọng số từ quizWeakStats ---
  let weakRetestBtn = document.getElementById('open-weak-retest-btn');
  if (!weakRetestBtn && quizViewCard) {
    weakRetestBtn = document.createElement('button');
    weakRetestBtn.type = 'button';
    weakRetestBtn.id = 'open-weak-retest-btn';
    weakRetestBtn.className = 'action-btn secondary-action';
    weakRetestBtn.style.marginTop = '8px';
    weakRetestBtn.style.width = '100%';
    weakRetestBtn.textContent = '🎯 Ôn câu hay sai (0)';
    if (vocabBankBtn && vocabBankBtn.parentElement === quizViewCard) {
      vocabBankBtn.insertAdjacentElement('afterend', weakRetestBtn);
    } else if (quizResultAnchor && quizResultAnchor.parentElement === quizViewCard) {
      quizViewCard.insertBefore(weakRetestBtn, quizResultAnchor);
    } else {
      quizViewCard.appendChild(weakRetestBtn);
    }
  }

  function normalizeWeakQuizQuestionKey(questionText) {
    return String(questionText || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeWeakQuizOptions(rawOptions) {
    const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
    if (Array.isArray(rawOptions)) {
      return rawOptions
        .slice(0, 6)
        .map((item, idx) => {
          const raw = typeof item === 'object' && item !== null
            ? String(item.text ?? item.label ?? item.value ?? '').trim()
            : String(item ?? '').trim();
          if (!raw) return '';
          const letter = letters[idx] || String.fromCharCode(65 + idx);
          const clean = raw.replace(/^[A-F][.):\-]\s*/i, '').trim() || raw;
          return `${letter}. ${clean}`;
        })
        .filter(Boolean);
    }
    if (rawOptions && typeof rawOptions === 'object') {
      const picked = letters
        .filter((letter) => rawOptions[letter] !== undefined || rawOptions[letter.toLowerCase()] !== undefined)
        .map((letter) => {
          const raw = String(rawOptions[letter] ?? rawOptions[letter.toLowerCase()] ?? '').trim();
          if (!raw) return '';
          const clean = raw.replace(new RegExp(`^${letter}[.):\\-]\\s*`, 'i'), '').trim() || raw;
          return `${letter}. ${clean}`;
        })
        .filter(Boolean);
      if (picked.length) return picked;
      return Object.values(rawOptions)
        .slice(0, 6)
        .map((val, idx) => {
          const raw = String(val ?? '').trim();
          if (!raw) return '';
          const letter = letters[idx] || String.fromCharCode(65 + idx);
          const clean = raw.replace(/^[A-F][.):\-]\s*/i, '').trim() || raw;
          return `${letter}. ${clean}`;
        })
        .filter(Boolean);
    }
    return [];
  }

  async function getWeightedWeakQuizList() {
    const {
      quizWeakStats = {},
      studyHistory = [],
      activePracticeSession = null
    } = await chrome.storage.local
      .get(['quizWeakStats', 'studyHistory', 'activePracticeSession'])
      .catch(() => ({}));

    const stats = quizWeakStats && typeof quizWeakStats === 'object' ? { ...quizWeakStats } : {};
    const sourceMap = new Map();

    const indexSourceQuestions = (quizArr) => {
      if (!Array.isArray(quizArr)) return;
      quizArr.forEach((q) => {
        const qKey = normalizeWeakQuizQuestionKey(q?.question);
        if (!qKey || sourceMap.has(qKey)) return;
        const opts = normalizeWeakQuizOptions(q?.options);
        if (opts.length >= 2) {
          sourceMap.set(qKey, {
            question: String(q.question || '').trim(),
            options: opts,
            correct_answer: String(q.correct_answer ?? q.answer ?? '').trim(),
            explanation: String(q.explanation || '').trim(),
            images: Array.isArray(q.images) ? q.images : []
          });
        }
      });
    };

    if (activePracticeSession?.quiz) indexSourceQuestions(activePracticeSession.quiz);
    if (Array.isArray(studyHistory)) {
      studyHistory.forEach((hist) => {
        if (hist?.quiz) indexSourceQuestions(hist.quiz);
      });
    }

    let didRepair = false;
    const validEntries = [];

    Object.entries(stats).forEach(([key, entry]) => {
      if (!entry || Number(entry.wrongCount || 0) <= 0) return;
      const qText = String(entry.question || '').trim();
      if (!qText) return;

      let normalizedOptions = normalizeWeakQuizOptions(entry.options);
      let updatedEntry = entry;

      if (normalizedOptions.length < 2) {
        const matched = sourceMap.get(normalizeWeakQuizQuestionKey(qText)) || sourceMap.get(key);
        if (matched && matched.options.length >= 2) {
          normalizedOptions = matched.options;
          updatedEntry = {
            ...entry,
            question: qText || matched.question,
            options: matched.options,
            correct_answer: String(entry.correct_answer || matched.correct_answer || '').trim(),
            explanation: String(entry.explanation || matched.explanation || '').trim(),
            images: Array.isArray(entry.images) && entry.images.length ? entry.images : matched.images
          };
          stats[key] = updatedEntry;
          didRepair = true;
        }
      } else if (!Array.isArray(entry.options)) {
        updatedEntry = {
          ...entry,
          options: normalizedOptions,
          images: Array.isArray(entry.images) ? entry.images : []
        };
        stats[key] = updatedEntry;
        didRepair = true;
      }

      if (normalizedOptions.length >= 2) {
        validEntries.push({
          ...updatedEntry,
          options: normalizedOptions,
          images: Array.isArray(updatedEntry.images) ? updatedEntry.images : []
        });
      }
    });

    if (didRepair) {
      await chrome.storage.local.set({ quizWeakStats: stats }).catch(() => {});
    }

    return validEntries
      .map((entry) => {
        const attempts = Math.max(1, Number(entry.attempts || 1));
        const wrongCount = Number(entry.wrongCount || 0);
        const weight = wrongCount / attempts + Math.random() * 0.15;
        return { entry, weight };
      })
      .sort((a, b) => b.weight - a.weight)
      .map((item) => item.entry);
  }

  async function refreshWeakRetestButton() {
    if (!weakRetestBtn) return;
    const weakList = await getWeightedWeakQuizList();
    weakRetestBtn.textContent = `🎯 Ôn câu hay sai (${weakList.length})`;
  }

  if (weakRetestBtn) {
    weakRetestBtn.addEventListener('click', async () => {
      try {
        const weakEntries = await getWeightedWeakQuizList();
        const retestQuestions = weakEntries
          .map((entry) => ({
            question: String(entry.question || '').trim(),
            options: normalizeWeakQuizOptions(entry.options),
            correct_answer: String(entry.correct_answer || '').trim(),
            explanation: String(entry.explanation || '').trim(),
            images: Array.isArray(entry.images) ? entry.images : []
          }))
          .filter((q) => q.question && q.options.length >= 2);
        if (!retestQuestions.length) {
          setMascotStatus('Tuyệt vời! Hiện chưa có câu hỏi hay sai hợp lệ nào cần ôn lại.', 'idle');
          return;
        }
        await chrome.storage.local.set({
          activePracticeSession: {
            title: `🎯 Ôn câu hay sai (${retestQuestions.length} câu)`,
            summary: '',
            quiz: retestQuestions,
            quiz_type: 'standard',
            source_type: 'weak_retest',
            mode: 'quiz',
            createdAt: Date.now()
          }
        });
        setMascotStatus(`Đang mở phiên Ôn câu hay sai (${retestQuestions.length} câu)...`, 'idle');
        setTimeout(() => {
          chrome.tabs
            .create({ url: chrome.runtime.getURL('practice.html'), active: true })
            .catch((err) => {
              console.error('Không thể mở phiên Ôn câu hay sai:', err);
              setMascotStatus(`Không thể mở Phòng luyện tập: ${err.message}`, 'error');
            });
        }, 220);
      } catch (error) {
        console.error('Lỗi khi mở phiên Ôn câu hay sai:', error);
        setMascotStatus(`Không thể mở phiên Ôn câu hay sai: ${error.message}`, 'error');
      }
    });
    void refreshWeakRetestButton();
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes.vocabBank) {
      void refreshVocabBankButton();
    }
    if (changes.quizWeakStats) {
      void refreshWeakRetestButton();
    }
    if (changes.pendingSelectionTask?.newValue) {
      void consumePendingSelectionTask();
    }
  });

  // --- SPRINT 12: Context-Aware Selection Copilot (#selection-copilot-box) ---
  const selectionCopilotBox = document.getElementById('selection-copilot-box');
  const closeCopilotBoxBtn = document.getElementById('close-copilot-box-btn');
  const copilotSelectedQuote = document.getElementById('copilot-selected-quote');
  const copilotSourceMeta = document.getElementById('copilot-source-meta');
  const copilotResultContainer = document.getElementById('copilot-result-container');
  const copilotActionPills = Array.from(document.querySelectorAll('.copilot-action-pill[data-copilot-action]'));

  let activeCopilotTaskContext = null;
  let isRunningSelectionCopilot = false;

  if (closeCopilotBoxBtn && selectionCopilotBox) {
    closeCopilotBoxBtn.addEventListener('click', () => {
      selectionCopilotBox.hidden = true;
    });
  }

  copilotActionPills.forEach((pill) => {
    pill.addEventListener('click', () => {
      const targetAction = pill.dataset.copilotAction;
      if (!targetAction || !activeCopilotTaskContext || isRunningSelectionCopilot) return;
      void executeSelectionCopilotTask({
        ...activeCopilotTaskContext,
        action: targetAction
      });
    });
  });

  function speakEnglishTerm(term, buttonEl) {
    if (!window.speechSynthesis || typeof SpeechSynthesisUtterance !== 'function') {
      setMascotStatus('Trình duyệt này không hỗ trợ phát âm tự động.', 'error');
      return;
    }
    document.querySelectorAll('.speak-word-btn.is-speaking').forEach((btn) => {
      btn.classList.remove('is-speaking');
    });
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(term);
    utterance.lang = 'en-US';
    utterance.rate = 0.9;
    utterance.onstart = () => buttonEl?.classList.add('is-speaking');
    utterance.onend = () => buttonEl?.classList.remove('is-speaking');
    utterance.onerror = () => buttonEl?.classList.remove('is-speaking');
    window.speechSynthesis.speak(utterance);
  }

  function renderCopilotExplainResult(data, selectedText) {
    if (!copilotResultContainer) return;
    copilotResultContainer.replaceChildren();

    const title = String(data?.title || 'Giải thích nhanh').trim();
    const explanationVi = String(data?.explanation_vi || '').trim();
    const keyTakeaways = Array.isArray(data?.key_takeaways) ? data.key_takeaways : [];
    const breakdown = Array.isArray(data?.breakdown) ? data.breakdown : [];

    const mainBox = document.createElement('div');
    mainBox.className = 'copilot-section-box';
    const headingEl = document.createElement('div');
    headingEl.className = 'copilot-section-title';
    headingEl.textContent = `💡 ${title}`;
    const explainBody = document.createElement('div');
    explainBody.className = 'quiz-summary-content';
    explainBody.innerHTML = formatSummaryMarkdown(explanationVi);
    mainBox.append(headingEl, explainBody);
    copilotResultContainer.appendChild(mainBox);

    if (keyTakeaways.length > 0) {
      const takeawayBox = document.createElement('div');
      takeawayBox.className = 'copilot-section-box';
      const takeawayTitle = document.createElement('div');
      takeawayTitle.className = 'copilot-section-title';
      takeawayTitle.textContent = '🎯 Ý chính cốt lõi';
      const ul = document.createElement('ul');
      ul.className = 'copilot-takeaway-list';
      keyTakeaways.forEach((item) => {
        const text = String(item || '').trim();
        if (!text) return;
        const li = document.createElement('li');
        li.textContent = text;
        ul.appendChild(li);
      });
      takeawayBox.append(takeawayTitle, ul);
      copilotResultContainer.appendChild(takeawayBox);
    }

    if (breakdown.length > 0) {
      const breakdownBox = document.createElement('div');
      breakdownBox.className = 'copilot-section-box';
      const breakdownTitle = document.createElement('div');
      breakdownTitle.className = 'copilot-section-title';
      breakdownTitle.textContent = '🧩 Giải nghĩa thuật ngữ / Cú pháp';
      const tableWrap = document.createElement('div');
      tableWrap.className = 'copilot-breakdown-table';
      breakdown.forEach((entry) => {
        const term = String(entry?.term || '').trim();
        const note = String(entry?.note || '').trim();
        if (!term || !note) return;
        const row = document.createElement('div');
        row.className = 'copilot-breakdown-row';
        const termEl = document.createElement('span');
        termEl.className = 'copilot-breakdown-term';
        termEl.textContent = term;
        const noteEl = document.createElement('span');
        noteEl.className = 'copilot-breakdown-note';
        noteEl.textContent = note;
        row.append(termEl, noteEl);
        tableWrap.appendChild(row);
      });
      breakdownBox.append(breakdownTitle, tableWrap);
      copilotResultContainer.appendChild(breakdownBox);
    }

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'action-btn web-action';
    copyBtn.textContent = '📋 Sao chép';
    copyBtn.addEventListener('click', async () => {
      const copyLines = [
        `💡 ${title}`,
        `Đoạn chọn: "${selectedText}"`,
        '',
        explanationVi
      ];
      if (keyTakeaways.length > 0) {
        copyLines.push('', '🎯 Ý chính cốt lõi:', ...keyTakeaways.map((t) => `- ${t}`));
      }
      if (breakdown.length > 0) {
        copyLines.push(
          '',
          '🧩 Thuật ngữ / Cú pháp:',
          ...breakdown.map((b) => `- ${b.term}: ${b.note}`)
        );
      }
      try {
        await copyYoutubeText(copyLines.join('\n'));
        setMascotStatus('Đã sao chép lời giải thích vào bộ nhớ tạm!', 'idle');
      } catch (err) {
        setMascotStatus(`Không thể sao chép: ${err.message}`, 'error');
      }
    });
    copilotResultContainer.appendChild(copyBtn);
  }

  async function renderCopilotVocabResult(data, taskContext) {
    if (!copilotResultContainer) return;
    copilotResultContainer.replaceChildren();

    const items = Array.isArray(data?.items) ? data.items : [];
    const addedAt = Date.now();
    const sourceMeta = {
      type: 'web',
      title: String(taskContext?.pageTitle || 'Trang web').trim(),
      url: String(taskContext?.pageUrl || '').trim(),
      addedAt
    };

    const upsertedRecords = [];
    for (const item of items) {
      const exampleEn = item.example_en || item.contextSentence || '';
      const exampleVi = item.example_vi || item.exampleVi || '';
      const saved = await vocabStorageManager.upsertUnknown(
        {
          word: item.word,
          pos: String(item.pos || '').replace(/[()]/g, '').trim(),
          ipa: item.ipa || '',
          meaning: item.meaning || '',
          contextSentence: exampleEn,
          example_en: exampleEn,
          exampleVi: exampleVi,
          example_vi: exampleVi,
          topic: item.topic || '',
          visual_category: item.visual_category || '',
          icon_emoji: item.icon_emoji || '',
          visual_label: item.visual_label || '',
          memory_hook: item.memory_hook || ''
        },
        sourceMeta
      );
      if (saved) {
        upsertedRecords.push(saved);
      }
    }

    await refreshVocabBankButton();

    const savedBanner = document.createElement('div');
    savedBanner.className = 'copilot-vocab-saved-banner';
    savedBanner.textContent = `✓ Đã tự động lưu ${upsertedRecords.length} từ vựng vào Sổ tay Cần Ôn (Hộp 0 — Leitner)!`;
    copilotResultContainer.appendChild(savedBanner);

    const listEl = document.createElement('div');
    listEl.className = 'web-keyword-list';

    items.forEach((item) => {
      const word = String(item?.word || '').trim();
      if (!word) return;
      const posClean = String(item?.pos || '').replace(/[()]/g, '').trim();
      const exampleEn = String(item?.example_en || item?.contextSentence || '').trim();
      const exampleVi = String(item?.example_vi || item?.exampleVi || '').trim();
      const card = document.createElement('article');
      card.className = 'keyword-item';

      const termRow = document.createElement('div');
      termRow.className = 'keyword-term-row';

      if (item.icon_emoji) {
        const emojiSpan = document.createElement('span');
        emojiSpan.textContent = item.icon_emoji;
        emojiSpan.style.fontSize = '1.05rem';
        termRow.appendChild(emojiSpan);
      }

      const wordEl = document.createElement('strong');
      wordEl.className = 'keyword-term';
      wordEl.textContent = word;

      const ipaEl = document.createElement('span');
      ipaEl.className = 'keyword-ipa';
      ipaEl.textContent = item.ipa || '';

      const posEl = document.createElement('span');
      posEl.className = 'keyword-pos';
      posEl.textContent = posClean ? `(${posClean})` : '';

      const speakBtn = document.createElement('button');
      speakBtn.type = 'button';
      speakBtn.className = 'speak-word-btn';
      speakBtn.title = 'Nghe phát âm chuẩn';
      speakBtn.setAttribute('aria-label', `Nghe phát âm từ ${word}`);
      speakBtn.textContent = '🔊';
      speakBtn.addEventListener('click', () => speakEnglishTerm(word, speakBtn));

      termRow.append(wordEl, ipaEl, posEl, speakBtn);
      if (item.topic) {
        const topicTag = document.createElement('span');
        topicTag.style.cssText =
          'margin-left:auto;padding:2px 7px;border-radius:999px;background:#fef3c7;color:#92400e;font-size:0.7rem;font-weight:700;';
        topicTag.textContent = item.topic;
        termRow.appendChild(topicTag);
      }
      card.appendChild(termRow);

      const meaningEl = document.createElement('div');
      meaningEl.className = 'keyword-meaning';
      meaningEl.textContent = item.meaning || '';
      card.appendChild(meaningEl);

      if (item.visual_label || item.memory_hook) {
        const hookEl = document.createElement('div');
        hookEl.style.cssText =
          'margin-top:3px;padding:5px 8px;border-radius:6px;background:#eff6ff;border:1px solid #bfdbfe;color:#1e3a8a;font-size:0.75rem;line-height:1.4;';
        hookEl.textContent = item.memory_hook
          ? `💡 Mẹo nhớ: ${item.memory_hook}`
          : `🖼️ ${item.visual_label}`;
        card.appendChild(hookEl);
      }

      if (exampleEn) {
        const exEn = document.createElement('div');
        exEn.className = 'copilot-vocab-example';
        exEn.textContent = `"${exampleEn}"`;
        card.appendChild(exEn);
      }
      if (exampleVi) {
        const exVi = document.createElement('div');
        exVi.className = 'copilot-vocab-example-vi';
        exVi.textContent = `→ ${exampleVi}`;
        card.appendChild(exVi);
      }

      listEl.appendChild(card);
    });

    copilotResultContainer.appendChild(listEl);
  }

  async function executeSelectionCopilotTask(task) {
    const cleanText = String(task?.text || '').trim();
    if (!cleanText || !selectionCopilotBox) return;

    const action = ['explain', 'vocab', 'quiz'].includes(task.action) ? task.action : 'explain';
    const pageTitle = String(task.pageTitle || 'Trang web đang xem').trim();
    const pageUrl = String(task.pageUrl || '').trim();

    activeCopilotTaskContext = {
      text: cleanText,
      pageTitle,
      pageUrl
    };

    showAppView('view-quiz');
    selectionCopilotBox.hidden = false;

    if (copilotSelectedQuote) {
      copilotSelectedQuote.textContent =
        cleanText.length > 260 ? `"${cleanText.slice(0, 260)}..."` : `"${cleanText}"`;
    }
    if (copilotSourceMeta) {
      copilotSourceMeta.textContent = pageTitle ? `Nguồn: ${pageTitle}` : '';
      copilotSourceMeta.hidden = !pageTitle;
    }

    copilotActionPills.forEach((pill) => {
      const isCurrent = pill.dataset.copilotAction === action;
      pill.classList.toggle('active', isCurrent);
      pill.disabled = true;
    });

    if (copilotResultContainer) {
      copilotResultContainer.textContent = '⏳ AI Selection Copilot đang phân tích đoạn bôi đen...';
    }

    const actionLabelMap = {
      explain: 'giải thích đoạn bôi đen',
      vocab: 'rút trích & lưu từ vựng vào Sổ tay',
      quiz: 'tạo Quiz nhanh từ đoạn chọn'
    };
    setMascotStatus(`Đang ${actionLabelMap[action]}...`, 'loading');
    isRunningSelectionCopilot = true;

    try {
      const { geminiApiKey } = await chrome.storage.local.get('geminiApiKey');
      const cleanKey = String(geminiApiKey || '').trim();
      if (!cleanKey) {
        const msg = 'Vui lòng vào Cài đặt API Key để nhập Gemini API Key trước!';
        if (copilotResultContainer) copilotResultContainer.textContent = `⚠️ ${msg}`;
        setMascotStatus(msg, 'error');
        return;
      }

      const response = await fetch(`${API_BASE_URL}/api/selection-copilot`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Gemini-Api-Key': cleanKey
        },
        body: JSON.stringify({
          text: cleanText,
          action,
          page_title: pageTitle,
          page_url: pageUrl,
          api_key: cleanKey
        })
      });

      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const detail = data?.detail || `HTTP ${response.status}: ${response.statusText}`;
        throw new Error(detail);
      }

      if (action === 'explain') {
        renderCopilotExplainResult(data, cleanText);
        setMascotStatus('Đã giải thích xong đoạn bôi đen!', 'idle');
      } else if (action === 'vocab') {
        await renderCopilotVocabResult(data, activeCopilotTaskContext);
        setMascotStatus(
          `Đã lưu ${Array.isArray(data?.items) ? data.items.length : 0} từ vựng vào Sổ tay Cần Ôn!`,
          'idle'
        );
      } else if (action === 'quiz') {
        const quizList = Array.isArray(data?.quiz) ? data.quiz : [];
        const quizPayload = {
          quiz_type: 'standard',
          summary: `Đoạn trích từ "${pageTitle}":\n${cleanText.slice(0, 400)}`,
          quiz: quizList
        };
        const shortTitle = `✂️ Selection Quiz: ${cleanText.slice(0, 28)}...`;
        syncDifficultyForVocab(false);
        await saveQuizToHistory(shortTitle, quizPayload, quizPayload.summary);
        renderInteractiveQuiz(quizPayload, quizPayload.summary, shortTitle, false, { autoOpen: false });

        if (copilotResultContainer) {
          copilotResultContainer.replaceChildren();
          const quizReadyNote = document.createElement('div');
          quizReadyNote.className = 'copilot-vocab-saved-banner';
          quizReadyNote.textContent = `✓ Đã tạo ${quizList.length} câu hỏi trắc nghiệm bên dưới! Bạn có thể bấm "🚀 Thi Trắc nghiệm" để mở Phòng luyện tập.`;
          copilotResultContainer.appendChild(quizReadyNote);
        }
        setMascotStatus(`Đã tạo xong ${quizList.length} câu trắc nghiệm từ đoạn bôi đen!`, 'idle');
      }
    } catch (error) {
      console.error('Lỗi AI Selection Copilot:', error);
      const errText = isBackendConnectionError(error)
        ? 'Chưa bật Backend Server ở cổng 8000. Hãy bật FastAPI rồi thử lại.'
        : `Lỗi Selection Copilot: ${error.message}`;
      if (copilotResultContainer) {
        copilotResultContainer.textContent = `❌ ${errText}`;
      }
      setMascotStatus(errText, 'error');
    } finally {
      isRunningSelectionCopilot = false;
      copilotActionPills.forEach((pill) => {
        pill.disabled = false;
      });
    }
  }

  async function consumePendingSelectionTask() {
    if (isRunningSelectionCopilot) return;
    try {
      const { pendingSelectionTask } = await chrome.storage.local.get('pendingSelectionTask');
      if (!pendingSelectionTask || !pendingSelectionTask.text) return;
      await chrome.storage.local.remove('pendingSelectionTask');
      await executeSelectionCopilotTask(pendingSelectionTask);
    } catch (error) {
      console.warn('Không thể xử lý pendingSelectionTask:', error);
    }
  }

  void consumePendingSelectionTask();

  function isBackendConnectionError(error) {
    const msg = (error?.message || '').toLowerCase();
    return error instanceof TypeError || msg.includes('failed to fetch') || msg.includes('networkerror');
  }

  // Khởi tạo danh sách Lịch sử Học tập khi mở Side Panel
  await refreshStudyHistoryDropdown();

  if (historySelect) {
    historySelect.addEventListener('change', async () => {
      const selectedId = historySelect.value;
      if (!selectedId) return;

      try {
        const { studyHistory = [] } = await chrome.storage.local.get('studyHistory');
        const targetEntry = studyHistory.find((item) => item.id === selectedId);
        if (targetEntry) {
          if (targetEntry.type === 'youtube_summary') {
            showAppView('view-youtube');
            renderYoutubeSummaryResult(targetEntry);
            setMascotStatus(`Đã mở lại bản tóm tắt YouTube "${targetEntry.title}".`, 'idle');
            return;
          }
          showAppView('view-quiz');
          if (targetEntry.type === 'web_summary') {
            renderWebSummaryResult(targetEntry);
            setMascotStatus(`Đã mở lại bản tóm tắt "${targetEntry.title}".`, 'idle');
            return;
          }
          const isHistoryVocab = targetEntry.quiz_type === 'vocab';
          syncDifficultyForVocab(isHistoryVocab);
          renderInteractiveQuiz({
            quiz: targetEntry.quiz,
            quiz_type: targetEntry.quiz_type || 'standard',
            validation_error: targetEntry.validation_error,
            summary: targetEntry.summary || ''
          }, '', targetEntry.title);
          setMascotStatus(`Đã mở lại bộ đề "${targetEntry.title}".`, 'idle');
        }
      } catch (error) {
        console.error('Lỗi khi mở lại bộ đề từ lịch sử:', error);
        setMascotStatus(`Không thể mở bộ đề từ lịch sử: ${error.message}`, 'error');
      }
    });
  }

  if (deleteHistoryBtn) deleteHistoryBtn.addEventListener('click', async () => {
    const selectedId = historySelect?.value;
    if (!selectedId) {
      setMascotStatus('Hãy chọn bộ đề cần xóa trong lịch sử trước.', 'error');
      return;
    }
    try {
      const { studyHistory = [] } = await chrome.storage.local.get('studyHistory');
      const updatedHistory = studyHistory.filter((entry) => entry.id !== selectedId);
      await chrome.storage.local.set({ studyHistory: updatedHistory });
      await refreshStudyHistoryDropdown();
      setMascotStatus('Đã xóa bộ đề khỏi lịch sử học tập.', 'idle');
    } catch (error) {
      console.error('Lỗi khi xóa bộ đề khỏi lịch sử:', error);
      setMascotStatus(`Không thể xóa bộ đề: ${error.message}`, 'error');
    }
  });

  // Tự động nhận diện file .docx từ vựng POS Tag ngay khi chọn file
  if (docUploadInput) {
    docUploadInput.addEventListener('change', async () => {
      const selectedFile = docUploadInput.files?.[0];
      if (!selectedFile) {
        syncDifficultyForVocab(false);
        return;
      }

      if (!selectedFile.name.toLowerCase().endsWith('.docx') || !window.mammoth?.extractRawText) {
        syncDifficultyForVocab(false);
        return;
      }

      try {
        const arrayBuffer = await selectedFile.arrayBuffer();
        const { value: rawText } = await window.mammoth.extractRawText({ arrayBuffer });
        const isVocabDoc = Boolean(parseLocalVocabPos(rawText));
        syncDifficultyForVocab(isVocabDoc);
      } catch (error) {
        console.warn('Không thể quét nhanh nội dung file .docx:', error);
        syncDifficultyForVocab(false);
      }
    });
  }

  // 1. Sự kiện: Tạo Quiz từ File (.pdf, .docx)
  if (generateQuizFileBtn && docUploadInput) generateQuizFileBtn.addEventListener('click', async () => {
    const selectedFile = docUploadInput.files?.[0];
    if (!selectedFile) {
      setMascotStatus('Vui lòng chọn một file PDF hoặc DOCX trước.', 'error');
      return;
    }

    const numQuestions = numQuestionsSelect ? numQuestionsSelect.value : 'all';
    const difficulty = difficultySelect ? difficultySelect.value : 'normal';
    currentDifficulty = difficulty;

    // 1a. Local-First 0ms cho file .docx (từ vựng POS Tag hoặc đề trắc nghiệm có sẵn)
    if (selectedFile.name.toLowerCase().endsWith('.docx')) {
      try {
        const localDocxVocab = await parseLocalDocxVocab(selectedFile);
        if (localDocxVocab && Array.isArray(localDocxVocab.quiz) && localDocxVocab.quiz.length > 0) {
          syncDifficultyForVocab(true);
          await saveQuizToHistory(`📄 ${selectedFile.name}`, localDocxVocab, '');
          setMascotStatus('Đã tạo xong bộ thẻ Từ vựng Tiếng Anh!', 'idle');
          renderInteractiveQuiz(localDocxVocab, '', selectedFile.name, false, { autoOpen: true });
          return;
        }

        if (difficulty !== 'vocab') {
          const localDocxExam = await parseLocalDocxExam(selectedFile);
          if (localDocxExam && Array.isArray(localDocxExam.quiz) && localDocxExam.quiz.length >= 3) {
            const processedLocalExam = applyQuizDifficulty(localDocxExam, difficulty);
            // Đồng bộ bổ sung options/images cho các bản ghi khớp trong quizWeakStats
            try {
              const { quizWeakStats = {} } = await chrome.storage.local.get('quizWeakStats');
              if (quizWeakStats && typeof quizWeakStats === 'object') {
                let updatedWeak = false;
                processedLocalExam.quiz.forEach((q) => {
                  const qKey = normalizeWeakQuizQuestionKey(q.question);
                  if (qKey && quizWeakStats[qKey]) {
                    quizWeakStats[qKey] = {
                      ...quizWeakStats[qKey],
                      question: q.question,
                      options: normalizeWeakQuizOptions(q.options),
                      correct_answer: q.correct_answer,
                      explanation: String(q.explanation || quizWeakStats[qKey].explanation || '').trim(),
                      images: Array.isArray(q.images) ? q.images : (quizWeakStats[qKey].images || [])
                    };
                    updatedWeak = true;
                  }
                });
                if (updatedWeak) {
                  await chrome.storage.local.set({ quizWeakStats });
                }
              }
            } catch (_) {}

            await saveQuizToHistory(`📄 ${selectedFile.name}`, processedLocalExam, '');
            setMascotStatus(
              `✅ Đề có sẵn đã được bóc tách (${processedLocalExam.quiz.length} câu, 0ms)!`,
              'idle'
            );
            renderInteractiveQuiz(processedLocalExam, '', selectedFile.name, false, { autoOpen: true });
            return;
          }
        }
      } catch (localDocxError) {
        console.warn('Bỏ qua xử lý DOCX cục bộ, chuyển sang Backend:', localDocxError);
      }
    }

    generateQuizFileBtn.disabled = true;
    setMascotStatus(`Đang tải file "${selectedFile.name}" và tạo Quiz...`, 'loading');

    try {
      const { geminiApiKey } = await chrome.storage.local.get('geminiApiKey');
      if (!geminiApiKey) {
        setMascotStatus('Vui lòng vào Cài đặt API Key trước.', 'error');
        return;
      }

      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('api_key', geminiApiKey);
      formData.append('num_questions', numQuestions);
      formData.append('difficulty', difficulty);

      const response = await fetch(`${BACKEND_BASE_URL}/api/process-file`, {
        method: 'POST',
        body: formData
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        const detail = data?.detail || `HTTP ${response.status}: ${response.statusText}`;
        throw new Error(detail);
      }

      const processedQuiz = applyQuizDifficulty(data, difficulty);
      const summaryPayload = processedQuiz?.summary || '';
      const parsedMeta = parseStructuredQuizPayload(processedQuiz, summaryPayload);
      const isVocabResult =
        (parsedMeta.quizType === 'vocab' || difficulty === 'vocab') &&
        !(parsedMeta.quizType === 'invalid_vocab' && parsedMeta.quizList.length === 0);

      if (parsedMeta.quizType === 'invalid_vocab' && parsedMeta.quizList.length === 0) {
        setMascotStatus('Không nhận diện được danh sách từ vựng Tiếng Anh hợp lệ để tạo thẻ lật!', 'error');
        renderInteractiveQuiz(processedQuiz, summaryPayload, selectedFile.name, false, { autoOpen: false });
        return;
      }

      if (isVocabResult) {
        syncDifficultyForVocab(true);
      }
      await saveQuizToHistory(`📄 ${selectedFile.name}`, processedQuiz, summaryPayload);
      setMascotStatus(
        isVocabResult
          ? 'Đã tạo xong bộ thẻ Từ vựng Tiếng Anh!'
          : `Đã tạo xong bộ Quiz từ file "${selectedFile.name}".`,
        'idle'
      );
      renderInteractiveQuiz(processedQuiz, summaryPayload, selectedFile.name, false, { autoOpen: true });
    } catch (error) {
      console.error('Lỗi khi xử lý file qua Backend:', error);
      if (isBackendConnectionError(error)) {
        setMascotStatus('Chưa bật Backend Server ở cổng 8000. Hãy bật FastAPI rồi thử lại.', 'error');
      } else {
        setMascotStatus(`Lỗi khi tạo Quiz từ file: ${error.message}`, 'error');
      }
    } finally {
      generateQuizFileBtn.disabled = false;
    }
  });

  // 2. Tóm tắt trang web và rút trích từ khóa tiếng Anh
  if (generateQuizUrlBtn) {
    generateQuizUrlBtn.addEventListener('click', async () => {
      if (isProcessingUrl) return;
      isProcessingUrl = true;
      generateQuizUrlBtn.disabled = true;
      let timeoutId = null;
      if (pageReadingTime) pageReadingTime.hidden = true;
      setMascotStatus('Đang trích xuất nội dung trang web...', 'loading');

      try {
        const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const currentUrl = String(currentTab?.url || '').trim();
        if (!currentUrl || !currentTab?.id) throw new Error('Không lấy được URL của tab hiện tại.');

        let parsedUrl;
        try {
          parsedUrl = new URL(currentUrl);
        } catch (_) {
          throw new Error('URL của tab hiện tại không hợp lệ.');
        }

        if (parsedUrl.pathname.toLowerCase().endsWith('.pdf')) {
          throw new Error('Đây là file PDF. Hãy mở trang web dạng văn bản để tóm tắt.');
        }
        if (
          (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') ||
          parsedUrl.hostname.toLowerCase() === 'chromewebstore.google.com'
        ) {
          throw new Error('Trang hiện tại không hỗ trợ trích xuất. Hãy mở một trang web thông thường.');
        }

        const { geminiApiKey } = await chrome.storage.local.get('geminiApiKey');
        if (!geminiApiKey) {
          setMascotStatus('Vui lòng vào Cài đặt API Key trước.', 'error');
          return;
        }

        const controller = new AbortController();
        timeoutId = setTimeout(() => controller.abort(), 60000);
        const [extraction] = await chrome.scripting.executeScript({
          target: { tabId: currentTab.id },
          func: () => {
            const selectedText = window.getSelection ? window.getSelection().toString().trim() : '';
            const selectedWordCount = selectedText ? selectedText.split(/\s+/).filter(Boolean).length : 0;
            if (selectedWordCount >= 5) {
              return {
                text: selectedText.slice(0, 15000),
                isSelection: true
              };
            }

            const candidates = Array.from(document.querySelectorAll('article, main, [role="main"]'));
            const primaryContent = candidates
              .sort((left, right) => (right.innerText || '').length - (left.innerText || '').length)[0];
            const contentRoot = (primaryContent || document.body).cloneNode(true);
            contentRoot.querySelectorAll('nav, header, footer, aside, script, style, .ads, .comment')
              .forEach((element) => element.remove());
            const pageText = (contentRoot.innerText || contentRoot.textContent || '')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 15000);
            return {
              text: pageText,
              isSelection: false
            };
          }
        });
        const extractedText = typeof extraction?.result?.text === 'string'
          ? extraction.result.text.trim()
          : '';
        const isSelection = extraction?.result?.isSelection === true;
        const wordCount = extractedText ? extractedText.split(/\s+/).filter(Boolean).length : 0;
        if (!isSelection && wordCount < 35) {
          setMascotStatus('Trang này không có đủ nội dung văn bản để tóm tắt.', 'error');
          return;
        }

        if (pageReadingTime) {
          if (isSelection) {
            pageReadingTime.textContent = `✂️ Đoạn bôi đen (${wordCount} từ) • AI tóm tắt ~4 giây`;
          } else {
            const minutes = Math.max(1, Math.round(wordCount / 220));
            pageReadingTime.textContent = `⏱️ Đọc gốc ~${minutes} phút • AI tóm tắt ~5 giây`;
          }
          pageReadingTime.hidden = false;
        }
        setMascotStatus(
          isSelection
            ? 'Đang tóm tắt đoạn văn bản bạn vừa bôi đen và rút từ khóa...'
            : 'Đang tạo bản tóm tắt và trích xuất từ khóa tiếng Anh...',
          'loading'
        );
        const response = await fetch(`${BACKEND_BASE_URL}/api/process-url`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            url: currentUrl,
            title: currentTab.title || currentUrl,
            content: extractedText,
            summary_level: summaryLevelSelect?.value || 'medium',
            mode: 'summary_only',
            is_selection: isSelection,
            api_key: geminiApiKey,
          }),
          signal: controller.signal
        });

        const data = await response.json().catch(() => null);
        if (!response.ok) {
          const detail = data?.detail || `HTTP ${response.status}: ${response.statusText}`;
          throw new Error(detail);
        }
        if (typeof data?.summary !== 'string' || !Array.isArray(data?.keywords)) {
          throw new Error('Máy chủ trả về dữ liệu tóm tắt không hợp lệ.');
        }

        const summaryResult = {
          ...data,
          title: data.title || currentTab.title || currentUrl,
          url: currentUrl
        };
        renderWebSummaryResult(summaryResult);
        await saveWebSummaryToHistory(summaryResult, summaryResult.title);
        setMascotStatus('Đã tóm tắt trang web và trích xuất từ khóa tiếng Anh.', 'idle');
      } catch (error) {
        console.error('Lỗi khi tóm tắt trang web qua Backend:', error);
        if (error?.name === 'AbortError') {
          setMascotStatus('Máy chủ xử lý quá 60 giây. Vui lòng thử lại.', 'error');
        } else if (isBackendConnectionError(error)) {
          setMascotStatus('Không kết nối được máy chủ. Hãy bật backend rồi thử lại.', 'error');
        } else {
          setMascotStatus(`Lỗi khi tóm tắt trang web: ${error.message}`, 'error');
        }
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
        generateQuizUrlBtn.disabled = false;
        isProcessingUrl = false;
      }
    });
  }
});


// --- SPRINT 8 & 9: Bóc tách thông minh ruột tài liệu (Studocu & Báo chí/Blog) -> Xuất Word (.docx) & PDF (.pdf) ---
async function extractCleanDocument(tabId) {
  const injectionResults = await chrome.scripting.executeScript({
    target: { tabId },
    func: async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

      const toAbsoluteUrl = (rawUrl) => {
        if (!rawUrl || rawUrl.startsWith('data:') || rawUrl.startsWith('blob:') || rawUrl.startsWith('#')) {
          return rawUrl;
        }
        try {
          return new URL(rawUrl, window.location.href).href;
        } catch (_) {
          if (rawUrl.startsWith('/')) {
            return `${window.location.origin}${rawUrl}`;
          }
          return rawUrl;
        }
      };

      // 1. Xóa/Ẩn rác giao diện trước khi đọc: modal, cookie banner, lớp phủ blur, nav, header, footer, aside, bình luận, gợi ý
      const junkSelectors = [
        'header',
        'nav',
        'footer',
        'aside',
        '[role="dialog"]',
        '[role="banner"]',
        '[role="navigation"]',
        '[aria-modal="true"]',
        '[id*="cookie" i]',
        '[class*="cookie" i]',
        '[class*="banner" i]',
        '[class*="paywall" i]',
        '[class*="overlay" i]',
        '[class*="blur" i]',
        '[class*="modal" i]',
        '[class*="comment" i]',
        '[id*="comment" i]',
        '[data-testid*="recommend" i]',
        '[data-testid*="related" i]',
        '[class*="related-documents" i]',
        '[class*="discover-more" i]'
      ];

      document.querySelectorAll(junkSelectors.join(', ')).forEach((el) => {
        const hasDocInside =
          el.querySelector &&
          (el.querySelector('#page-container') || el.querySelector('[data-page-index]') || el.querySelector('article'));
        if (!hasDocInside) {
          el.style.setProperty('display', 'none', 'important');
        }
      });

      const overlayBannerSelector =
        '#upgrade-overlay, #modal-overlay, [class*="banner-wrapper"], [class*="PremiumBanner"], [id*="cookie" i], [class*="cookie" i], [id*="onetrust" i], .tooltip-bottom';

      // Ẩn các thành phần che giao diện ngay trên trang
      document.querySelectorAll(overlayBannerSelector).forEach((el) => {
        const hasDocInside =
          el.querySelector &&
          (el.querySelector('#page-container') || el.querySelector('[data-page-index]') || el.querySelector('article'));
        if (!hasDocInside) {
          el.style.setProperty('display', 'none', 'important');
        }
      });

      // Thu thập tất cả thẻ <link rel="stylesheet"> (đặc biệt là doc-assets) và <style>, chuyển toàn bộ href sang URL tuyệt đối
      const collectHeadStyles = () => {
        const styleTags = [];
        const seenHrefs = new Set();
        const headElement = document.head || document.documentElement;

        const nodes = Array.from(
          headElement.querySelectorAll('link[rel="stylesheet"], style')
        );
        document.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => {
          if (!nodes.includes(node)) {
            nodes.push(node);
          }
        });

        nodes.forEach((node) => {
          const tag = node.tagName.toLowerCase();
          if (tag === 'link') {
            const href = node.getAttribute('href');
            if (href) {
              const absHref = toAbsoluteUrl(href);
              if (!seenHrefs.has(absHref)) {
                seenHrefs.add(absHref);
                styleTags.push(`<link rel="stylesheet" href="${absHref}">`);
              }
            }
          } else if (tag === 'style') {
            const cssText = node.innerHTML || node.textContent || '';
            const absCssText = cssText.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (full, quote, urlPart) => {
              const trimmedUrl = urlPart.trim();
              if (trimmedUrl.startsWith('data:') || trimmedUrl.startsWith('http://') || trimmedUrl.startsWith('https://')) {
                return full;
              }
              return `url("${toAbsoluteUrl(trimmedUrl)}")`;
            });
            styleTags.push(`<style>${absCssText}</style>`);
          }
        });
        return styleTags.join('\n');
      };

      // Hàm đợi toàn bộ thẻ <img> hợp lệ bên trong một phần tử trang tải xong (img.complete hoặc timeout an toàn 3.5 giây)
      const waitForImagesInElement = async (containerEl, timeoutMs = 3500) => {
        if (!containerEl) return;
        containerEl.querySelectorAll('img').forEach((img) => {
          const realSrc =
            img.getAttribute('data-src') ||
            img.getAttribute('data-original') ||
            img.getAttribute('data-lazy-src') ||
            img.getAttribute('src');
          if (realSrc && !realSrc.includes('/blurred/')) {
            img.setAttribute('src', toAbsoluteUrl(realSrc));
          }
        });

        const validImgs = Array.from(containerEl.querySelectorAll('img')).filter((img) => {
          const src = img.getAttribute('src') || '';
          if (!src || src.includes('/blurred/')) return false;
          if (img.closest('.oGQxBa_blurredImageWrapper, ._5XZx7G_container')) return false;
          return true;
        });

        if (validImgs.length === 0) return;

        await Promise.race([
          Promise.all(
            validImgs.map((img) => {
              if (img.complete) return Promise.resolve();
              return new Promise((resolve) => {
                img.addEventListener('load', resolve, { once: true });
                img.addEventListener('error', resolve, { once: true });
              });
            })
          ),
          sleep(timeoutMs)
        ]);
      };

      const pageContainer = document.querySelector('#page-container');
      const initialIndexedPages = document.querySelectorAll('[data-page-index]');

      // =========================================================================
      // TRƯỜNG HỢP 1: Trang tài liệu chia trang (có #page-container hoặc [data-page-index] như Studocu)
      // =========================================================================
      if (pageContainer || initialIndexedPages.length > 0) {
        const rootDocContainer = pageContainer || initialIndexedPages[0].parentElement || document.body;

        // Lưu vị trí cuộn ban đầu để khôi phục sau khi quét xong
        const initialScrollY = window.scrollY;
        const initialScrollX = window.scrollX;

        // Ẩn toàn bộ các khối gợi ý nằm bên dưới #page-container (Related documents, Discover more...)
        if (pageContainer) {
          let sibling = pageContainer.nextElementSibling;
          while (sibling) {
            sibling.style.setProperty('display', 'none', 'important');
            sibling = sibling.nextElementSibling;
          }
        }

        const pagesStructuredMap = new Map();
        const pagesTextMap = new Map();
        const renderedPageSnapshotMap = new Map();
        const premiumLockedPagesSet = new Set();
        const failedLoadPagesSet = new Set();

        const isOutOfFocusText = (txt) => {
          return /why is this page out of focus|this is a premium document|become premium to read|unlock this document|upgrade to premium to read/i.test(
            (txt || '').trim()
          );
        };

        // Kiểm tra trang con có bị giới hạn quyền xem trước từ máy chủ hay không
        const checkIsPremiumLockedPage = (node) => {
          if (!node) return false;
          if (
            node.querySelector(
              '.oGQxBa_blurredImageWrapper, img[src*="/blurred/"], img[data-src*="/blurred/"], ._5XZx7G_container'
            )
          ) {
            return true;
          }
          const rawText = node.innerText || node.textContent || '';
          return /why is this page out of focus|become premium to read/i.test(rawText);
        };

        // Kiểm tra dòng chân trang lặp lại hoặc dòng chỉ chứa [Date] / số trang đơn lẻ
        const isRepeatingFooterOrPageNumberLine = (line) => {
          const trimmed = (line || '').trim();
          if (!trimmed) return true;
          if (/^(\[\s*date\s*\]|\d{1,4}|page\s+\d+(\s+of\s+\d+)?|trang\s+\d+(\s*\/\s*\d+)?)$/i.test(trimmed)) {
            return true;
          }
          return false;
        };

        const isWatermarkLine = (line) => {
          const trimmed = (line || '').trim();
          return (
            /^(lOMoARcPSD\||Downloaded by |Studocu is not sponsored|Scan to open on Studocu)/i.test(trimmed) ||
            isOutOfFocusText(trimmed)
          );
        };

        const normalizeBulletsAndPUA = (str) => {
          if (!str) return '';
          const puaMap = {
            '\uF076': '◆',
            '\uF075': '◆',
            '\uF077': '◆',
            '\uF0A7': '▪',
            '\uF0B7': '•',
            '\uF06E': '▪',
            '\uF06C': '●',
            '\uF0D8': '▸',
            '\uF0E0': '▸',
            '\uF0E8': '▸',
            '\uF0F0': '▸',
            '\uF0A8': '▸',
            '\uF0B2': '▸',
            '\uF034': '▸',
            '\uF0FC': '✓',
            '\uF050': '✓',
            '\uF0FE': '✓',
            '\uF02D': '-',
            '❖': '◆'
          };
          return str
            .replace(/[\uF000-\uF8FF❖]/g, (ch) => puaMap[ch] || '▸')
            .replace(/[\uE000-\uEFFF]/g, '▸');
        };

        const parseColorToHex6 = (colorStr) => {
          if (!colorStr) return null;
          const trimmed = colorStr.trim();
          if (trimmed.startsWith('#')) {
            const hex = trimmed.slice(1).toUpperCase();
            const fullHex =
              hex.length === 3
                ? hex
                    .split('')
                    .map((c) => c + c)
                    .join('')
                : hex.slice(0, 6);
            if (fullHex === '000000' || fullHex === '111111') return null;
            return fullHex;
          }
          const match = trimmed.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
          if (!match) return null;
          const r = Math.min(255, Math.max(0, parseInt(match[1], 10)));
          const g = Math.min(255, Math.max(0, parseInt(match[2], 10)));
          const b = Math.min(255, Math.max(0, parseInt(match[3], 10)));
          if (r <= 25 && g <= 25 && b <= 25) return null;
          const hex = [r, g, b]
            .map((v) => v.toString(16).padStart(2, '0').toUpperCase())
            .join('');
          if (hex === '000000' || hex === '111111') return null;
          return hex;
        };

        const getPageIndexFromNode = (pageEl, fallbackIdx) => {
          const indexedTarget = pageEl.hasAttribute('data-page-index')
            ? pageEl
            : pageEl.querySelector('[data-page-index]') || pageEl;

          const rawAttr =
            indexedTarget.getAttribute('data-page-index') ??
            indexedTarget.getAttribute('data-page-no') ??
            pageEl.getAttribute('data-page-index') ??
            pageEl.getAttribute('data-page-no');

          if (rawAttr !== null && rawAttr !== undefined && rawAttr !== '') {
            const parsed = Number(rawAttr);
            if (!Number.isNaN(parsed)) {
              // Nếu data-page-no bắt đầu từ 1 còn data-page-index bắt đầu từ 0
              const hasZeroBased =
                indexedTarget.hasAttribute('data-page-index') || pageEl.hasAttribute('data-page-index');
              return hasZeroBased ? parsed : Math.max(0, parsed - 1);
            }
          }
          return fallbackIdx;
        };

        // Hàm thu thập dữ liệu cấu trúc (cho Word) và lưu bản chụp DOM (cho PDF) khi trang đang hiển thị trên viewport
        const harvestLivePageForWordAndSnapshot = (pageEl, fallbackIdx) => {
          if (!pageEl || pageEl.matches(overlayBannerSelector)) return;

          const pageIndex = getPageIndexFromNode(pageEl, fallbackIdx);
          if (Number.isNaN(pageIndex)) return;
          const pageNum = pageIndex + 1;

          // Lưu bản sao của trang ngay thời điểm vừa tải xong để phòng trường hợp React unmount khi cuộn sang trang khác
          renderedPageSnapshotMap.set(pageIndex, pageEl.cloneNode(true));

          // Nếu trang bị khóa xem trước từ máy chủ (Premium locked / blurred)
          if (checkIsPremiumLockedPage(pageEl)) {
            premiumLockedPagesSet.add(pageNum);
            const lockedNoticeText = `[--- Trang ${pageNum} bị giới hạn xem trước trên nguồn gốc ---]`;
            pagesStructuredMap.set(pageIndex, [
              {
                type: 'text',
                text: lockedNoticeText,
                bold: false,
                italic: true,
                underline: false,
                color: '888888',
                center: true,
                indentInches: 0,
                indent_inches: 0,
                indentLevel: 0,
                indent_level: 0,
                indentPx: 0,
                fontSize: 11
              }
            ]);
            pagesTextMap.set(pageIndex, lockedNoticeText);
            return;
          }

          const pageRect = pageEl.getBoundingClientRect();
          if (pageRect.height < 20 || pageRect.width < 20) return;
          const pageWidth = pageRect.width;
          const pageHeight = pageRect.height;
          const pageBottom = pageRect.bottom;
          const pageArea = pageWidth * pageHeight;
          const pageCenter = pageWidth / 2;

          // Chuyển đổi lazy-load ảnh hợp lệ trong trang sang src tuyệt đối
          pageEl.querySelectorAll('img').forEach((img) => {
            const realSrc =
              img.getAttribute('data-src') ||
              img.getAttribute('data-original') ||
              img.getAttribute('data-lazy-src') ||
              img.getAttribute('src');
            if (realSrc && !realSrc.includes('/blurred/')) {
              img.setAttribute('src', toAbsoluteUrl(realSrc));
            }
          });

          // Quét các phần tử chữ (.t hoặc các node lá chứa text) bên trong trang
          const textLayer = pageEl.querySelector('.pc') || pageEl;
          let textNodes = Array.from(textLayer.querySelectorAll('.t'));

          if (textNodes.length === 0) {
            textNodes = Array.from(textLayer.querySelectorAll('p, h1, h2, h3, h4, li, span, div')).filter((el) => {
              if (el.children.length > 0) return false;
              if (el.closest(overlayBannerSelector)) return false;
              const txt = (el.innerText || el.textContent || '').trim();
              return txt.length > 0;
            });
          }

          const rawTextItems = [];
          textNodes.forEach((node) => {
            if (node.closest(overlayBannerSelector)) return;
            const rawText = (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
            const text = normalizeBulletsAndPUA(rawText);
            if (!text || isWatermarkLine(text)) return;

            const rect = node.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) return;

            // Lọc bỏ các dòng chân trang lặp lại nằm sát mép dưới cùng của trang (rect.top > pageBottom - 55)
            if (rect.top > pageBottom - 55) {
              return;
            }

            const computed = window.getComputedStyle(node);
            const weightNum = parseInt(computed.fontWeight, 10);
            let isBold =
              (!Number.isNaN(weightNum) && weightNum >= 600) ||
              computed.fontWeight === 'bold' ||
              computed.fontWeight === 'bolder' ||
              node.closest('b, strong, h1, h2, h3, h4') !== null;

            let isItalic =
              computed.fontStyle === 'italic' ||
              computed.fontStyle === 'oblique' ||
              node.closest('i, em') !== null;

            const tdLine = `${computed.textDecorationLine || ''} ${computed.textDecoration || ''}`.toLowerCase();
            let isUnderline =
              tdLine.includes('underline') ||
              node.closest('u') !== null;

            let hexColor = parseColorToHex6(computed.color);

            if (node.children && node.children.length > 0) {
              node.querySelectorAll('*').forEach((child) => {
                const childText = (child.innerText || child.textContent || '').trim();
                if (!childText) return;
                const cs = window.getComputedStyle(child);
                const cw = parseInt(cs.fontWeight, 10);
                if ((!Number.isNaN(cw) && cw >= 600) || cs.fontWeight === 'bold' || cs.fontWeight === 'bolder') {
                  isBold = true;
                }
                if (cs.fontStyle === 'italic' || cs.fontStyle === 'oblique') {
                  isItalic = true;
                }
                const ctd = `${cs.textDecorationLine || ''} ${cs.textDecoration || ''}`.toLowerCase();
                if (ctd.includes('underline')) {
                  isUnderline = true;
                }
                if (!hexColor) {
                  hexColor = parseColorToHex6(cs.color);
                }
              });
            }

            const fontSizePx = Math.round(parseFloat(computed.fontSize) || 12);

            rawTextItems.push({
              text,
              top: rect.top - pageRect.top,
              left: Math.max(0, rect.left - pageRect.left),
              right: Math.max(0, rect.right - pageRect.left),
              bold: isBold,
              italic: isItalic,
              underline: isUnderline,
              color: hexColor,
              fontSize: fontSizePx
            });
          });

          // Nhóm chữ theo tọa độ rect.top (cùng dòng nếu chênh lệch top < 5px, tách đoạn mới nếu >= 5px)
          rawTextItems.sort((a, b) => (Math.abs(a.top - b.top) < 5 ? a.left - b.left : a.top - b.top));

          const groupedLines = [];
          rawTextItems.forEach((item) => {
            const lastLine = groupedLines[groupedLines.length - 1];
            if (lastLine && Math.abs(item.top - lastLine.top) < 5) {
              lastLine.items.push(item);
              lastLine.top = (lastLine.top + item.top) / 2;
            } else {
              groupedLines.push({
                top: item.top,
                items: [item]
              });
            }
          });

          groupedLines.forEach((lineGroup) => {
            lineGroup.items.sort((a, b) => a.left - b.left);
          });

          const minLeft =
            groupedLines.length > 0
              ? Math.min(...groupedLines.map((lineGroup) => lineGroup.items[0].left))
              : 0;

          const structuredItems = [];
          const plainLines = [];

          groupedLines.forEach((lineGroup) => {
            // Lọc bỏ nếu dòng nằm sát mép dưới trang (top > pageHeight - 55)
            if (lineGroup.top > pageHeight - 55) {
              return;
            }

            let lineStr = '';
            let prevRight = null;
            let boldCount = 0;
            let italicCount = 0;
            let underlineCount = 0;
            let lineColor = null;
            let maxFontSize = 12;

            lineGroup.items.forEach((frag) => {
              if (prevRight !== null) {
                const gap = frag.left - prevRight;
                lineStr += gap > 40 ? '\t' : ' ';
              }
              lineStr += frag.text;
              prevRight = Math.max(prevRight ?? frag.right, frag.right);
              if (frag.bold) boldCount += 1;
              if (frag.italic) italicCount += 1;
              if (frag.underline) underlineCount += 1;
              if (!lineColor && frag.color) lineColor = frag.color;
              if (frag.fontSize > maxFontSize) maxFontSize = frag.fontSize;
            });

            const cleanedLine = normalizeBulletsAndPUA(lineStr.replace(/ +/g, ' ').trim());
            if (!cleanedLine || isWatermarkLine(cleanedLine) || isRepeatingFooterOrPageNumberLine(cleanedLine)) {
              return;
            }

            const firstItem = lineGroup.items[0];
            const lastItem = lineGroup.items[lineGroup.items.length - 1];
            const lineLeft = firstItem.left;
            const lineRight = lastItem.right;
            const lineWidth = Math.max(0, lineRight - lineLeft);

            const indentPx = Math.max(0, lineLeft - minLeft);
            const indentInches = Math.min(2.5, Math.round((indentPx / 96) * 10) / 10);
            const indentLevel = Math.min(6, Math.round(indentPx / 24));

            const isCenteredOnPage =
              Math.abs((lineLeft + lineRight) / 2 - pageCenter) < 15 &&
              lineWidth < pageWidth * 0.65 &&
              indentPx > 40;

            const isLineBold = boldCount >= Math.ceil(lineGroup.items.length / 2);
            const isLineItalic = italicCount >= Math.ceil(lineGroup.items.length / 2);
            const isLineUnderline = underlineCount > 0;

            const finalIndentInches = isCenteredOnPage ? 0 : indentInches;
            const finalIndentLevel = isCenteredOnPage ? 0 : indentLevel;

            structuredItems.push({
              type: 'text',
              text: cleanedLine,
              top: Math.round(lineGroup.top),
              bold: isLineBold,
              italic: isLineItalic,
              underline: isLineUnderline,
              color: lineColor,
              center: isCenteredOnPage,
              indentInches: finalIndentInches,
              indent_inches: finalIndentInches,
              indentLevel: finalIndentLevel,
              indent_level: finalIndentLevel,
              indentPx: isCenteredOnPage ? 0 : Math.round(indentPx),
              fontSize: maxFontSize
            });
            plainLines.push(cleanedLine);
          });

          // Quét các thẻ <img> minh họa thực sự trong trang (bỏ qua ảnh nền trang img.bi, ảnh mờ /blurred/ hoặc ảnh > 70% diện tích trang)
          pageEl.querySelectorAll('img').forEach((img) => {
            if (
              img.classList.contains('bi') ||
              img.matches('.bi, [class*="background" i], [class*="watermark" i]') ||
              img.closest(overlayBannerSelector) ||
              img.closest('.oGQxBa_blurredImageWrapper, ._5XZx7G_container')
            ) {
              return;
            }
            const src = img.getAttribute('src') || '';
            if (!src || src.startsWith('data:image/gif') || src.includes('/blurred/')) return;
            const imgRect = img.getBoundingClientRect();
            const imgArea = imgRect.width * imgRect.height;

            if (pageArea > 0 && imgArea > pageArea * 0.7) {
              return;
            }

            if (imgRect.width >= 32 && imgRect.height >= 32) {
              structuredItems.push({
                type: 'image',
                src: toAbsoluteUrl(src),
                top: Math.round(imgRect.top - pageRect.top)
              });
            }
          });

          structuredItems.sort((a, b) => (a.top || 0) - (b.top || 0));

          const prevStructured = pagesStructuredMap.get(pageIndex) || [];
          if (structuredItems.length > 0 && structuredItems.length >= prevStructured.length) {
            pagesStructuredMap.set(pageIndex, structuredItems);
            pagesTextMap.set(pageIndex, plainLines.join('\n'));
          }

          // Cập nhật lại bản chụp DOM sau khi các thuộc tính src ảnh đã được chuẩn hóa tuyệt đối
          renderedPageSnapshotMap.set(pageIndex, pageEl.cloneNode(true));
        };

        // 1. Kích hoạt tải lười (Lazy-loading) từng trang trước khi trích xuất
        const livePageElements = pageContainer
          ? Array.from(pageContainer.children)
          : Array.from(rootDocContainer.querySelectorAll('[data-page-index], .pf'));

        for (let i = 0; i < livePageElements.length; i++) {
          const pageEl = livePageElements[i];
          if (!pageEl || pageEl.matches(overlayBannerSelector)) {
            continue;
          }

          pageEl.scrollIntoView({ behavior: 'auto', block: 'start' });
          await sleep(250);
          await waitForImagesInElement(pageEl, 3500);
          harvestLivePageForWordAndSnapshot(pageEl, i);
        }

        // Khôi phục vị trí cuộn ban đầu (window.scrollY)
        window.scrollTo({ top: initialScrollY, left: initialScrollX, behavior: 'auto' });

        // 2. Nhân bản #page-container (cloneNode(true)) để cô lập hoàn toàn khỏi quá trình React re-render trên trang gốc
        const clonedContainer = (pageContainer || rootDocContainer).cloneNode(true);
        if (!clonedContainer.id) {
          clonedContainer.id = 'page-container';
        }

        // Xóa bỏ các lớp phủ UI che khuất bên trong bản sao #page-container
        clonedContainer.querySelectorAll(overlayBannerSelector).forEach((el) => el.remove());

        const clonedChildren = Array.from(clonedContainer.children);
        let validPdfPagesCount = 0;

        for (let idx = 0; idx < clonedChildren.length; idx++) {
          let pageNode = clonedChildren[idx];
          if (!pageNode) continue;

          if (pageNode.matches(overlayBannerSelector)) {
            pageNode.remove();
            continue;
          }

          const pageIndex = getPageIndexFromNode(pageNode, idx);
          const pageNum = pageIndex + 1;

          // Nếu trang trên DOM gốc bị React unmount lúc cuộn đi nhưng đã được chụp lại đầy đủ trong renderedPageSnapshotMap,
          // khôi phục từ bản chụp lúc trang đó đang ở trong viewport
          const snapshotNode = renderedPageSnapshotMap.get(pageIndex);
          if (
            snapshotNode &&
            !pageNode.querySelector('.pc') &&
            snapshotNode.querySelector('.pc')
          ) {
            const restoredNode = snapshotNode.cloneNode(true);
            pageNode.replaceWith(restoredNode);
            pageNode = restoredNode;
          }

          // Kiểm tra trang bị giới hạn từ máy chủ (.oGQxBa_blurredImageWrapper, img[src*="/blurred/"], ._5XZx7G_container, "Why is this page out of focus" / "Become Premium to read")
          if (checkIsPremiumLockedPage(pageNode) || premiumLockedPagesSet.has(pageNum)) {
            premiumLockedPagesSet.add(pageNum);
            pageNode.remove();

            // Đảm bảo trong dữ liệu Word có dòng ghi chú minh bạch tại vị trí trang bị khóa
            const lockedNoticeText = `[--- Trang ${pageNum} bị giới hạn xem trước trên nguồn gốc ---]`;
            if (!pagesStructuredMap.has(pageIndex)) {
              pagesStructuredMap.set(pageIndex, [
                {
                  type: 'text',
                  text: lockedNoticeText,
                  bold: false,
                  italic: true,
                  underline: false,
                  color: '888888',
                  center: true,
                  indentInches: 0,
                  indent_inches: 0,
                  indentLevel: 0,
                  indent_level: 0,
                  indentPx: 0,
                  fontSize: 11
                }
              ]);
              pagesTextMap.set(pageIndex, lockedNoticeText);
            }
            continue;
          }

          // Kiểm tra nếu trang trống hoàn toàn (không có .pc, không có text và không có ảnh hợp lệ)
          const hasPc = pageNode.querySelector('.pc') !== null;
          const cleanTextContent = (pageNode.innerText || pageNode.textContent || '').replace(/\s+/g, ' ').trim();
          const hasValidImg = Array.from(pageNode.querySelectorAll('img')).some((img) => {
            const s = img.getAttribute('src') || img.getAttribute('data-src') || '';
            return s && !s.includes('/blurred/') && !s.startsWith('data:image/gif');
          });

          if (!hasPc && !cleanTextContent && !hasValidImg) {
            failedLoadPagesSet.add(pageNum);
            pageNode.remove();
            continue;
          }

          // Đặt display: block; opacity: 1; visibility: visible; cho các lớp nội dung trang hợp lệ (.pc)
          pageNode.querySelectorAll('.pc').forEach((pcEl) => {
            pcEl.classList.add('opened');
            pcEl.style.setProperty('display', 'block', 'important');
            pcEl.style.setProperty('opacity', '1', 'important');
            pcEl.style.setProperty('visibility', 'visible', 'important');
          });

          // Xóa các lớp phủ hoặc script còn sót bên trong trang hợp lệ và chuẩn hóa URL ảnh
          pageNode.querySelectorAll(overlayBannerSelector).forEach((el) => el.remove());
          pageNode.querySelectorAll('script, noscript').forEach((el) => el.remove());
          pageNode.querySelectorAll('img').forEach((img) => {
            const s =
              img.getAttribute('data-src') ||
              img.getAttribute('data-original') ||
              img.getAttribute('data-lazy-src') ||
              img.getAttribute('src');
            if (s) {
              img.setAttribute('src', toAbsoluteUrl(s));
            }
          });

          validPdfPagesCount += 1;
        }

        const premiumLockedPages = Array.from(premiumLockedPagesSet).sort((a, b) => a - b);
        const failedLoadPages = Array.from(failedLoadPagesSet).sort((a, b) => a - b);

        const sortedStructuredEntries = Array.from(pagesStructuredMap.entries()).sort((a, b) => a[0] - b[0]);
        const sortedTextEntries = Array.from(pagesTextMap.entries()).sort((a, b) => a[0] - b[0]);

        const pagesStructured = sortedStructuredEntries
          .map(([, items]) => (Array.isArray(items) ? items : []))
          .filter((items) => items.length > 0);
        const pagesText = sortedTextEntries.map((entry) => String(entry[1] || '')).filter(Boolean);

        // 3. Bọc bản sao #page-container đã làm sạch vào đủ 3 lớp thẻ div cha: #page-container-wrapper > #document-wrapper > #viewer-wrapper
        const headStyles = collectHeadStyles();
        const cleanHtmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <base href="${window.location.origin}/">
  <title>${document.title || 'Smart_Study_Document'}</title>
  ${headStyles}
  <style>
    html, body {
      margin: 0 !important;
      padding: 0 !important;
      background: #ffffff !important;
    }
    #page-container-wrapper, #document-wrapper, #viewer-wrapper {
      display: block !important;
      position: relative !important;
      width: 100% !important;
      margin: 0 auto !important;
      padding: 0 !important;
      overflow: visible !important;
    }
    #page-container {
      margin: 0 auto !important;
      overflow: visible !important;
    }
    .pf, [data-page-index] {
      position: relative !important;
      overflow: hidden !important;
      page-break-after: always !important;
      break-after: page !important;
    }
    .pc {
      display: block !important;
      opacity: 1 !important;
      visibility: visible !important;
    }
    #upgrade-overlay, #modal-overlay, [class*="banner-wrapper"], [class*="PremiumBanner"], [id*="cookie" i], [class*="cookie" i], [id*="onetrust" i], .tooltip-bottom {
      display: none !important;
    }
  </style>
</head>
<body>
  <div id="page-container-wrapper">
    <div id="document-wrapper">
      <div id="viewer-wrapper">
        ${clonedContainer.outerHTML}
      </div>
    </div>
  </div>
</body>
</html>`;

        const validWordPagesCount = Math.max(0, pagesStructured.length - premiumLockedPages.length);

        return {
          isPagedDocument: true,
          title: (document.title || 'Smart_Study_Document').replace(/\s*-\s*Studocu$/i, '').trim(),
          pagesCount: Math.max(validPdfPagesCount, validWordPagesCount),
          validPagesCount: Math.max(validPdfPagesCount, validWordPagesCount),
          premiumLockedPages,
          failedLoadPages,
          restrictedPagesCount: premiumLockedPages.length,
          restrictedPages: premiumLockedPages,
          pagesStructured,
          pagesText,
          headStyles,
          cleanHtmlContent
        };
      }

      // =========================================================================
      // TRƯỜNG HỢP 2: Trang tin tức, thể thao, bóng đá, blog (không có #page-container)
      // =========================================================================
      const articleStepPx = 600;
      const articleWaitMs = 350;
      const articleMaxSteps = 300;
      let stableBottomCount = 0;
      let lastScrollHeight = 0;

      window.scrollTo({ top: 0, behavior: 'instant' });
      await sleep(200);

      for (let step = 0; step < articleMaxSteps; step++) {
        window.scrollBy(0, articleStepPx);
        await sleep(articleWaitMs);

        const currentScrollHeight = Math.max(
          document.body?.scrollHeight || 0,
          document.documentElement?.scrollHeight || 0
        );
        const atBottom = window.innerHeight + window.scrollY >= currentScrollHeight - 5;

        if (atBottom) {
          if (currentScrollHeight === lastScrollHeight) {
            stableBottomCount += 1;
            if (stableBottomCount >= 2) {
              break;
            }
          } else {
            stableBottomCount = 0;
          }
        }
        lastScrollHeight = currentScrollHeight;
      }

      // Cuộn lại lên đầu trang
      window.scrollTo({ top: 0, behavior: 'instant' });
      await sleep(200);

      // Chuyển đổi toàn bộ thuộc tính data-src / data-original của thẻ <img> trên trang thành src tuyệt đối
      document.querySelectorAll('img').forEach((img) => {
        const lazySrc =
          img.getAttribute('data-src') ||
          img.getAttribute('data-original') ||
          img.getAttribute('data-lazy-src') ||
          img.getAttribute('data-actualsrc') ||
          img.getAttribute('src');
        if (lazySrc) {
          img.setAttribute('src', toAbsoluteUrl(lazySrc));
        }
        const srcset = img.getAttribute('data-srcset') || img.getAttribute('srcset');
        if (srcset) {
          const absSrcset = srcset
            .split(',')
            .map((part) => {
              const pieces = part.trim().split(/\s+/);
              if (pieces[0]) pieces[0] = toAbsoluteUrl(pieces[0]);
              return pieces.join(' ');
            })
            .join(', ');
          img.setAttribute('srcset', absSrcset);
        }
      });

      // Khoanh vùng đúng khối bài báo chính (article, .fck_detail, .detail-content, main, hoặc khối nhiều <p> nhất)
      const findBestArticleContainer = () => {
        const prioritySelectors = [
          '.fck_detail',
          '.detail-content',
          '.article-content',
          '.post-content',
          '.entry-content',
          '.cms-body',
          'article',
          'main',
          '[role="main"]'
        ];

        for (const sel of prioritySelectors) {
          const candidate = document.querySelector(sel);
          if (candidate && candidate.querySelectorAll('p').length >= 2) {
            return candidate;
          }
        }

        // Tìm khối chứa nhiều thẻ <p> có nội dung nhất
        let bestNode = document.body;
        let maxScore = 0;
        document.querySelectorAll('article, main, section, div').forEach((box) => {
          const pNodes = box.querySelectorAll(':scope > p');
          if (pNodes.length >= 2) {
            const textLen = Array.from(pNodes).reduce((acc, p) => acc + (p.innerText || '').trim().length, 0);
            if (textLen > maxScore) {
              maxScore = textLen;
              bestNode = box;
            }
          }
        });
        return bestNode;
      };

      const mainArticle = findBestArticleContainer();
      const cloneArticle = mainArticle.cloneNode(true);

      // Loại bỏ quảng cáo, iframe, bình luận, tin liên quan, footer bên trong khối bài báo
      cloneArticle
        .querySelectorAll(
          'header, nav, footer, aside, script, style, noscript, iframe, form, ' +
          '[class*="ads" i], [id*="ads" i], [class*="related" i], [class*="comment" i], [class*="share" i], [class*="social" i]'
        )
        .forEach((el) => el.remove());

      cloneArticle.querySelectorAll('img').forEach((img) => {
        const src =
          img.getAttribute('data-src') ||
          img.getAttribute('data-original') ||
          img.getAttribute('data-lazy-src') ||
          img.getAttribute('src');
        if (src) {
          img.setAttribute('src', toAbsoluteUrl(src));
        }
      });

      // Bóc tách cấu trúc đoạn văn & hình ảnh cho xuất Word (.docx)
      const articleItems = [];
      const articleTextLines = [];

      // Thêm tiêu đề chính h1 của trang nếu nằm ngoài khối bài báo
      const pageH1 = document.querySelector('h1');
      if (pageH1 && !mainArticle.contains(pageH1)) {
        const h1Text = (pageH1.innerText || pageH1.textContent || '').replace(/\s+/g, ' ').trim();
        if (h1Text) {
          articleItems.push({
            type: 'text',
            text: h1Text,
            bold: true,
            center: false,
            fontSize: 20
          });
          articleTextLines.push(h1Text);
        }
      }

      cloneArticle.querySelectorAll('h1, h2, h3, h4, p, li, img').forEach((node) => {
        const tag = node.tagName.toLowerCase();
        if (tag === 'img') {
          const src = node.getAttribute('src');
          if (src && !src.startsWith('data:image/gif')) {
            articleItems.push({
              type: 'image',
              src: toAbsoluteUrl(src)
            });
          }
          return;
        }

        const txt = (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
        if (!txt || txt.length < 2) return;

        const isHeading = /^h[1-4]$/.test(tag);
        const fontSizeMap = { h1: 20, h2: 16, h3: 14, h4: 13 };
        articleItems.push({
          type: 'text',
          text: txt,
          bold: isHeading,
          center: false,
          fontSize: fontSizeMap[tag] || 12
        });
        articleTextLines.push(txt);
      });

      const titleHeadingHtml =
        pageH1 && !mainArticle.contains(pageH1) ? `<h1>${pageH1.innerHTML}</h1>` : '';

      const headStyles = collectHeadStyles();
      const cleanHtmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <base href="${window.location.origin}/">
  <title>${document.title || 'Smart_Study_Document'}</title>
  ${headStyles}
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      line-height: 1.65;
      padding: 28px;
      max-width: 860px;
      margin: 0 auto !important;
      background: #ffffff !important;
      color: #0f172a !important;
    }
    img {
      max-width: 100% !important;
      height: auto !important;
      display: block;
      margin: 12px auto;
    }
  </style>
</head>
<body>
  <article class="smart-study-clean-article">
    ${titleHeadingHtml}
    ${cloneArticle.outerHTML}
  </article>
</body>
</html>`;

      return {
        isPagedDocument: false,
        title: (document.title || 'Smart_Study_Document').trim(),
        pagesCount: 1,
        validPagesCount: 1,
        premiumLockedPages: [],
        failedLoadPages: [],
        restrictedPagesCount: 0,
        restrictedPages: [],
        pagesStructured: articleItems.length > 0 ? [articleItems] : [],
        pagesText: articleTextLines.length > 0 ? [articleTextLines.join('\n\n')] : [],
        headStyles,
        cleanHtmlContent
      };
    }
  });

  const docData = injectionResults?.[0]?.result;
  if (!docData) {
    throw new Error('Không thể bóc tách nội dung từ trang web hiện tại.');
  }
  return docData;
}

// --- Hàm chuẩn bị tải lười, tiêm CSS @media print chuẩn và gọi window.print() trực tiếp trên tab hiện tại ---
async function prepareAndPrintTabPdf(tabId, scrollConfig = {}) {
  const requestedDelay = Number(scrollConfig.scrollDelayMs);
  const scrollDelayMs =
    Number.isFinite(requestedDelay) && requestedDelay >= 0 ? requestedDelay : 250;

  // Tiêm file chuyên dụng student.js vào tab hiện tại
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['student.js']
  });

  const injectionResults = await chrome.scripting.executeScript({
    target: { tabId },
    args: [{ scrollDelayMs, tabId }],
    func: async (scrollConfig) => {
      const requestedDelay = Number(scrollConfig?.scrollDelayMs);
      const scrollDelayMs =
        Number.isFinite(requestedDelay) && requestedDelay >= 0 ? requestedDelay : 250;

      if (window.KHStudocuExport && typeof window.KHStudocuExport.run === 'function') {
        const khRes = await window.KHStudocuExport.run({
          scrollDelayMs,
          tabId: scrollConfig?.tabId
        });
        if (!['page_container_missing', 'not_supported'].includes(khRes?.reason)) {
          return khRes;
        }
      }

      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const sendPdfProgress = (payload) => {
        try {
          const result = chrome.runtime.sendMessage({
            type: 'PDF_PAGE_PROGRESS',
            tabId: Number(scrollConfig?.tabId || 0),
            ...payload
          });
          result?.catch?.(() => {});
        } catch (_) {}
      };

      const waitForImagesInElement = async (containerEl, timeoutMs = 3500, includeAllImages = false) => {
        if (!containerEl) return;
        const validImgs = Array.from(containerEl.querySelectorAll('img')).filter((img) => {
          if (includeAllImages) return true;
          const src = img.getAttribute('src') || '';
          if (!src || src.includes('/blurred/')) return false;
          if (img.closest('.oGQxBa_blurredImageWrapper, ._5XZx7G_container')) return false;
          return true;
        });

        if (validImgs.length === 0) return;

        await Promise.race([
          Promise.all(
            validImgs.map((img) => {
              if (img.complete) return Promise.resolve();
              return new Promise((resolve) => {
                img.addEventListener('load', resolve, { once: true });
                img.addEventListener('error', resolve, { once: true });
              });
            })
          ),
          sleep(timeoutMs)
        ]);
      };

      const initialScrollY = window.scrollY;
      const initialScrollX = window.scrollX;

      const overlayBannerSelector =
        '#upgrade-overlay, #modal-overlay, [class*="banner-wrapper"], [class*="PremiumBanner"], [id*="cookie" i], [class*="cookie" i], [id*="onetrust" i], .tooltip-bottom';

      const pageContainer = document.querySelector('#page-container');
      const hasPagedContainer = Boolean(pageContainer || document.querySelector('[data-page-index], .pf'));

      let validPagesCount = 0;
      const lockedPages = [];
      const pcSnapshotsMap = new Map();
      const savedInlineStyles = [];
      const genericAddedClasses = [];
      let genericContentRoot = null;
      const addGenericClass = (element, className) => {
        if (!element?.classList?.contains(className)) {
          element?.classList?.add(className);
          genericAddedClasses.push({ element, className });
        }
      };

      const rememberInlineStyle = (el) => {
        if (!el || !el.style) return;
        savedInlineStyles.push({ el, cssText: el.getAttribute('style') });
      };

      const checkIsLockedPage = (node) => {
        if (!node) return false;
        if (
          node.querySelector(
            '.oGQxBa_blurredImageWrapper, img[src*="/blurred/"], img[data-src*="/blurred/"], ._5XZx7G_container'
          )
        ) {
          return true;
        }
        const rawText = node.innerText || node.textContent || '';
        return /why is this page out of focus|become premium to read/i.test(rawText);
      };

      if (hasPagedContainer) {
        const rootContainer = pageContainer || document.querySelector('[data-page-index]')?.parentElement || document.body;
        const pageChildren = pageContainer
          ? Array.from(pageContainer.children)
          : Array.from(rootContainer.querySelectorAll('[data-page-index], .pf'));

        for (let i = 0; i < pageChildren.length; i++) {
          const pageEl = pageChildren[i];
          if (!pageEl || pageEl.nodeType !== 1) continue;

          if (pageEl.matches(overlayBannerSelector)) {
            pageEl.classList.add('smart-study-hidden-page');
            pageEl.setAttribute('data-smart-study-print-hide', 'true');
            continue;
          }

          pageEl.scrollIntoView({ behavior: 'auto', block: 'start' });
          await sleep(scrollDelayMs);
          await waitForImagesInElement(pageEl, 3500);

          const indexedTarget = pageEl.hasAttribute('data-page-index')
            ? pageEl
            : pageEl.querySelector('[data-page-index]') || pageEl;
          const rawIdx =
            indexedTarget.getAttribute('data-page-index') ??
            pageEl.getAttribute('data-page-index');
          const pageNum = rawIdx !== null && rawIdx !== undefined && rawIdx !== '' ? Number(rawIdx) + 1 : i + 1;

          // Nếu trang chứa .oGQxBa_blurredImageWrapper, img[src*="/blurred/"] hoặc ._5XZx7G_container,
          // gán class smart-study-hidden-page cho chính thẻ trang con trực tiếp đó
          if (checkIsLockedPage(pageEl)) {
            lockedPages.push(pageNum);
            pageEl.classList.add('smart-study-hidden-page');
            pageEl.setAttribute('data-smart-study-print-hide', 'true');
            pageEl.removeAttribute('data-smart-study-print-valid');
            rememberInlineStyle(pageEl);
            pageEl.style.setProperty('display', 'none', 'important');
            pageEl.style.setProperty('height', '0px', 'important');
            pageEl.style.setProperty('margin', '0px', 'important');
            pageEl.style.setProperty('padding', '0px', 'important');
            continue;
          }

          const pcNode = pageEl.querySelector('.pc');
          const textStr = (pageEl.innerText || pageEl.textContent || '').replace(/\s+/g, ' ').trim();
          const hasValidImg = Array.from(pageEl.querySelectorAll('img')).some((img) => {
            const s = img.getAttribute('src') || '';
            return s && !s.includes('/blurred/') && !s.startsWith('data:image/gif');
          });

          if (!pcNode && !textStr && !hasValidImg) {
            pageEl.classList.add('smart-study-hidden-page');
            pageEl.setAttribute('data-smart-study-print-hide', 'true');
            pageEl.removeAttribute('data-smart-study-print-valid');
            rememberInlineStyle(pageEl);
            pageEl.style.setProperty('display', 'none', 'important');
            pageEl.style.setProperty('height', '0px', 'important');
            pageEl.style.setProperty('margin', '0px', 'important');
            pageEl.style.setProperty('padding', '0px', 'important');
            continue;
          }

          pageEl.classList.remove('smart-study-hidden-page');
          pageEl.removeAttribute('data-smart-study-print-hide');
          pageEl.setAttribute('data-smart-study-print-valid', 'true');
          validPagesCount += 1;

          if (pcNode) {
            pcNode.classList.add('opened');
            pcSnapshotsMap.set(i, pcNode.cloneNode(true));
          }
        }

        // Khôi phục lại các lớp .pc nếu bị Virtual DOM của trang gỡ bỏ và tắt inline transform: scale(...) trên các thẻ bọc trang
        const wrapperContainer = document.getElementById('page-container-wrapper');
        if (wrapperContainer) {
          rememberInlineStyle(wrapperContainer);
          wrapperContainer.removeAttribute('style');
        }

        // Ẩn toàn bộ các phần tử anh em ngoài nhánh #page-container-wrapper (như khối gợi ý Discover more from, Students also viewed, Related documents)
        const keepRoot = wrapperContainer || pageContainer || rootContainer;
        let currNode = keepRoot;
        while (currNode && currNode !== document.body && currNode.parentElement) {
          const parentEl = currNode.parentElement;
          Array.from(parentEl.children).forEach((sibling) => {
            if (sibling !== currNode && sibling.tagName !== 'STYLE' && sibling.tagName !== 'LINK') {
              rememberInlineStyle(sibling);
              sibling.style.setProperty('display', 'none', 'important');
            }
          });
          currNode = parentEl;
        }

        for (let i = 0; i < pageChildren.length; i++) {
          const pageEl = pageChildren[i];
          if (!pageEl || pageEl.classList.contains('smart-study-hidden-page')) continue;

          const currentPc = pageEl.querySelector('.pc');
          const savedPc = pcSnapshotsMap.get(i);
          if (savedPc && (!currentPc || currentPc.children.length === 0)) {
            const targetFrame = pageEl.querySelector('.pf') || pageEl;
            const restoredPc = savedPc.cloneNode(true);
            restoredPc.setAttribute('data-smart-study-restored-pc', 'true');
            if (currentPc) {
              currentPc.replaceWith(restoredPc);
            } else {
              targetFrame.appendChild(restoredPc);
            }
          }

          // Xóa thuộc tính inline transform: scale(...) mà Studocu gắn vào thẻ bọc của từng trang khi mở Side Panel
          rememberInlineStyle(pageEl);
          pageEl.style.setProperty('height', 'auto', 'important');
          pageEl.style.setProperty('width', '100%', 'important');
          pageEl.style.setProperty('transform', 'none', 'important');

          if (pageEl.childNodes) {
            if (pageEl.childNodes.length === 2) {
              const w1 = pageEl.childNodes[1];
              const w2 = w1?.childNodes?.[0];
              if (w1?.style) {
                rememberInlineStyle(w1);
                w1.style.cssText = 'display: block !important; transform: none !important; width: 100% !important; height: auto !important;';
              }
              if (w2?.style) {
                rememberInlineStyle(w2);
                w2.style.cssText = 'display: block !important; transform: none !important; width: 100% !important; height: auto !important;';
              }
            } else {
              const w1 = pageEl.childNodes[0];
              const w2 = w1?.childNodes?.[0];
              if (w1?.style) {
                rememberInlineStyle(w1);
                w1.style.cssText = 'display: block !important; transform: none !important; width: 100% !important; height: auto !important;';
              }
              if (w2?.style) {
                rememberInlineStyle(w2);
                w2.style.cssText = 'display: block !important; transform: none !important; width: 100% !important; height: auto !important;';
              }
            }
          }
        }
      } else {
        sendPdfProgress({ stage: 'preparing' });
        const contentSelectors = [
          'article',
          'main',
          '.post-body',
          '.entry-content',
          '#main',
          '[role="main"]'
        ];
        genericContentRoot =
          contentSelectors.map((selector) => document.querySelector(selector)).find(Boolean) ||
          document.body;
        const stepPx = Math.max(1, Math.floor(window.innerHeight * 0.8));
        let scannedSteps = 0;
        let stableAtBottom = 0;
        let previousHeight = 0;
        window.scrollTo({ top: 0, behavior: 'auto' });
        while (true) {
          const currentHeight = Math.max(
            document.body?.scrollHeight || 0,
            document.documentElement?.scrollHeight || 0
          );
          const totalSteps = Math.max(1, Math.ceil(currentHeight / stepPx));
          if (window.innerHeight + window.scrollY >= currentHeight - 5) {
            stableAtBottom = currentHeight === previousHeight ? stableAtBottom + 1 : 0;
            if (stableAtBottom >= 2) break;
          } else {
            window.scrollTo({ top: window.scrollY + stepPx, behavior: 'auto' });
            stableAtBottom = 0;
          }
          scannedSteps += 1;
          sendPdfProgress({
            stage: 'scanning',
            done: scannedSteps,
            total: Math.max(totalSteps, scannedSteps)
          });
          await sleep(scrollDelayMs);
          previousHeight = currentHeight;
        }
        await waitForImagesInElement(document.body, 3000, true);
        validPagesCount = 1;

        if (genericContentRoot !== document.body) {
          let current = genericContentRoot;
          while (current && current !== document.body) {
            const parent = current.parentElement;
            if (!parent) break;
            Array.from(parent.children).forEach((sibling) => {
              if (sibling !== current && sibling.tagName !== 'STYLE' && sibling.tagName !== 'LINK') {
                addGenericClass(sibling, 'smart-study-generic-hide');
              }
            });
            current = parent;
          }
        }
        document.querySelectorAll(
          'header, nav, aside, footer, .comments, #comments, .blog-pager, [id*="cookie" i], [class*="cookie" i], [class*="banner" i], [class*="ads" i]'
        ).forEach((element) => addGenericClass(element, 'smart-study-generic-hide'));

        addGenericClass(genericContentRoot, 'smart-study-generic-content');
        let parent = genericContentRoot.parentElement;
        while (parent && parent !== document.documentElement) {
          addGenericClass(parent, 'smart-study-generic-parent');
          parent = parent.parentElement;
        }
      }

      // Trả lại vị trí cuộn ban đầu (window.scrollY)
      window.scrollTo({ top: initialScrollY, left: initialScrollX, behavior: 'auto' });

      // Gỡ thẻ style cũ nếu còn tồn tại
      const existingStyle = document.getElementById('smart-study-print-style');
      if (existingStyle) {
        existingStyle.remove();
      }
      document.getElementById('smart-study-generic-print-style')?.remove();

      // Tiêm thẻ <style id="smart-study-print-style"> với quy tắc @media print
      const printStyle = document.createElement('style');
      printStyle.id = hasPagedContainer
        ? 'smart-study-print-style'
        : 'smart-study-generic-print-style';
      printStyle.textContent = hasPagedContainer
        ? `
@media print {
  @page {
    size: A4 portrait;
    margin: 0;
  }
  html, body {
    margin: 0 !important;
    padding: 0 !important;
    background: #ffffff !important;
    overflow: visible !important;
    height: auto !important;
  }
  body * {
    visibility: hidden !important;
  }
  #page-container-wrapper,
  #page-container-wrapper * {
    visibility: visible !important;
  }
  #page-container-wrapper {
    position: absolute !important;
    left: 0 !important;
    top: 0 !important;
    width: 100% !important;
    margin: 0 !important;
    padding: 0 !important;
    background: #ffffff !important;
    overflow: visible !important;
  }
  #document-wrapper,
  #viewer-wrapper,
  #page-container,
  #page-container > *,
  #page-container > * > *,
  #page-container .pf,
  #page-container .page-content {
    transform: none !important;
    zoom: 1 !important;
    width: 100% !important;
    max-width: 100% !important;
    margin: 0 auto !important;
    padding: 0 !important;
    box-shadow: none !important;
    border: none !important;
    position: relative !important;
    left: 0 !important;
    top: 0 !important;
  }
  #page-container .pf {
    page-break-inside: avoid !important;
    break-inside: avoid !important;
    page-break-after: always !important;
    break-after: page !important;
    overflow: hidden !important;
  }
  #page-container > [data-smart-study-print-valid="true"]:last-of-type .pf,
  #page-container .pf:last-of-type {
    page-break-after: auto !important;
    break-after: auto !important;
  }
  #page-container .pc {
    display: block !important;
    opacity: 1 !important;
    visibility: visible !important;
  }
  .smart-study-hidden-page,
  .smart-study-hidden-page *,
  [data-smart-study-print-hide="true"],
  #upgrade-overlay,
  #modal-overlay,
  [class*="banner-wrapper"],
  [class*="PremiumBanner"],
  [id*="cookie" i],
  [class*="cookie" i],
  [id*="onetrust" i],
  .tooltip-bottom,
  .oGQxBa_blurredImageWrapper,
  ._5XZx7G_container {
    display: none !important;
    height: 0 !important;
    min-height: 0 !important;
    max-height: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
    border: none !important;
    visibility: hidden !important;
    overflow: hidden !important;
    page-break-after: avoid !important;
    break-after: avoid !important;
    page-break-before: avoid !important;
    break-before: avoid !important;
  }
}
`
        : `
@media print {
  @page {
    size: A4 portrait;
    margin: 12mm;
  }
  header, nav, aside, footer,
  [role="banner"], [role="navigation"], [role="dialog"], [aria-modal="true"],
  #upgrade-overlay, #modal-overlay,
  [class*="banner-wrapper"], [class*="PremiumBanner"],
  [id*="cookie" i], [class*="cookie" i], [id*="onetrust" i],
  .tooltip-bottom,
  [class*="floating" i], [class*="toolbar" i],
  [class*="ads" i], [id*="ads" i],
  [class*="comment" i], [id*="comment" i],
  [class*="related" i], iframe {
    display: none !important;
  }
  .smart-study-generic-hide {
    display: none !important;
  }
  .smart-study-generic-parent,
  .smart-study-generic-content {
    display: block !important;
    width: 100% !important;
    max-width: 100% !important;
    float: none !important;
    position: static !important;
    overflow: visible !important;
    margin: 0 !important;
    padding: 0 !important;
  }
  html, body {
    background: #ffffff !important;
    color: #000000 !important;
    overflow: visible !important;
  }
  .smart-study-generic-content {
    box-shadow: none !important;
  }
  img {
    max-width: 100% !important;
    height: auto !important;
    page-break-inside: avoid !important;
    break-inside: avoid !important;
  }
}
`;

      (document.head || document.documentElement).appendChild(printStyle);

      let cleanedUp = false;
      const cleanupAfterPrint = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        const styleNode = document.getElementById('smart-study-print-style');
        if (styleNode) {
          styleNode.remove();
        }
        document.getElementById('smart-study-generic-print-style')?.remove();
        genericAddedClasses.forEach(({ element, className }) => {
          element.classList.remove(className);
        });
        document.querySelectorAll('.smart-study-hidden-page').forEach((el) => {
          el.classList.remove('smart-study-hidden-page');
        });
        document
          .querySelectorAll('[data-smart-study-print-hide], [data-smart-study-print-valid]')
          .forEach((el) => {
            el.removeAttribute('data-smart-study-print-hide');
            el.removeAttribute('data-smart-study-print-valid');
          });
        savedInlineStyles.forEach(({ el, cssText }) => {
          try {
            if (cssText === null || cssText === undefined) {
              el.removeAttribute('style');
            } else {
              el.setAttribute('style', cssText);
            }
          } catch (_) {}
        });
        if (!hasPagedContainer) sendPdfProgress({ stage: 'done' });
      };

      window.addEventListener('afterprint', cleanupAfterPrint, { once: true });
      // Fallback setTimeout an toàn để gỡ style nếu người dùng đóng hộp thoại in mà trình duyệt không bắn sự kiện afterprint
      setTimeout(cleanupAfterPrint, 60000);

      // Mở hộp thoại In / Save as PDF của trình duyệt
      if (!hasPagedContainer) sendPdfProgress({ stage: 'building' });
      sendPdfProgress({ stage: 'printing' });
      setTimeout(() => {
        window.print();
      }, 150);

      return {
        isPagedDocument: hasPagedContainer,
        ...(!hasPagedContainer ? { mode: 'generic' } : {}),
        title: (document.title || 'Smart_Study_Document').replace(/\s*-\s*Studocu$/i, '').trim(),
        validPagesCount,
        lockedPagesCount: lockedPages.length,
        lockedPages
      };
    }
  });

  const printResult = injectionResults?.[0]?.result;
  if (!printResult) {
    throw new Error('Không thể chuẩn bị chế độ In / Lưu PDF trên trang web hiện tại.');
  }
  return printResult;
}

document.addEventListener('DOMContentLoaded', () => {
  const exportWebDocxBtn = document.getElementById('export-web-docx-btn');
  const exportWebPdfBtn = document.getElementById('export-web-pdf-btn');
  const scrollSpeedSlider = document.getElementById('scroll-speed-slider');
  const scrollSpeedBadge = document.getElementById('scroll-speed-badge');
  const clearCookiesReloadBtn = document.getElementById('clear-cookies-reload-btn');
  const BACKEND_BASE_URL = 'http://127.0.0.1:8000';
  const pdfScrollSpeeds = {
    1: { label: 'Chậm', scrollDelayMs: 800 },
    2: { label: 'Hơi chậm', scrollDelayMs: 500 },
    3: { label: 'Vừa', scrollDelayMs: 250 },
    4: { label: 'Nhanh', scrollDelayMs: 100 },
    5: { label: 'Rất nhanh', scrollDelayMs: 20 }
  };
  let activePdfProgressTabId = null;

  const runtimeMessage = globalThis.chrome?.runtime?.onMessage;
  if (runtimeMessage) {
    runtimeMessage.addListener((message) => {
      if (
        message?.type !== 'PDF_PAGE_PROGRESS' ||
        message.tabId !== activePdfProgressTabId
      ) return;

      let statusMessage;
      let statusState = 'loading';
      if (message.stage === 'preparing') {
        statusMessage = 'Đang chuẩn bị nội dung tài liệu...';
      } else if (message.stage === 'scanning') {
        statusMessage = `Đang nạp nội dung trang... ${message.done}/${message.total}`;
      } else if (message.stage === 'building') {
        statusMessage = 'Đang dựng khung trang in chuẩn...';
      } else if (message.stage === 'printing') {
        statusMessage = 'Đang mở hộp thoại In / Lưu PDF...';
      } else if (message.stage === 'done') {
        statusMessage = 'Đã chuẩn bị xong toàn bộ trang!';
        statusState = 'idle';
      } else if (message.stage === 'error') {
        statusMessage = `Lỗi: ${message.error || 'Không thể xử lý trang'}`;
        statusState = 'error';
      } else {
        return;
      }

      setMascotStatus(statusMessage, statusState);
    });
  }

  if (scrollSpeedSlider && scrollSpeedBadge) {
    let hasChangedSpeed = false;
    const updateScrollSpeedBadge = () => {
      const selectedSpeed = pdfScrollSpeeds[scrollSpeedSlider.value] || pdfScrollSpeeds[3];
      scrollSpeedBadge.textContent = selectedSpeed.label;
    };

    try {
      chrome.storage.local.get('pdfScrollSpeed').then(({ pdfScrollSpeed }) => {
        if (!hasChangedSpeed && pdfScrollSpeeds[pdfScrollSpeed]) {
          scrollSpeedSlider.value = pdfScrollSpeed;
        }
        updateScrollSpeedBadge();
      }).catch((error) => {
        console.error('Lỗi khi tải tốc độ cuộn PDF:', error);
        updateScrollSpeedBadge();
      });
    } catch (error) {
      console.error('Lỗi khi tải tốc độ cuộn PDF:', error);
      updateScrollSpeedBadge();
    }

    scrollSpeedSlider.addEventListener('input', () => {
      hasChangedSpeed = true;
      updateScrollSpeedBadge();
      chrome.storage.local.set({ pdfScrollSpeed: scrollSpeedSlider.value })
        .catch((error) => console.error('Lỗi khi lưu tốc độ cuộn PDF:', error));
    });
  }

  if (clearCookiesReloadBtn) {
    clearCookiesReloadBtn.addEventListener('click', async () => {
      clearCookiesReloadBtn.disabled = true;
      const statusMessage = 'Đang xóa cookie của domain hiện tại và tải lại trang...';
      setMascotStatus(statusMessage, 'loading');

      try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!activeTab?.id || !activeTab.url || !/^https?:\/\//i.test(activeTab.url)) {
          throw new Error('Trang hiện tại không phải là trang web hợp lệ (http/https).');
        }

        const result = await chrome.runtime.sendMessage({
          type: 'CLEAR_TAB_COOKIES_AND_RELOAD',
          tabId: activeTab.id,
          url: activeTab.url
        });
        if (!result?.ok) {
          if (result?.failedCount) {
            const errorMessage =
              `❌ Đã xóa ${result.removedCount} cookie nhưng còn ${result.failedCount} cookie không xóa được. Trang đã được tải lại.`;
            setMascotStatus(errorMessage.replace(/^❌\s*/, ''), 'error');
            return;
          }
          throw new Error(result?.error || 'Không thể xóa cookie hoặc tải lại trang.');
        }

        setMascotStatus('Đã xóa cookie. Trang đang được tải lại...', 'idle');
      } catch (error) {
        console.error('Lỗi khi xóa cookie và tải lại trang:', error);
        setMascotStatus(`Không thể xóa cookie và tải lại trang: ${error.message}`, 'error');
      } finally {
        clearCookiesReloadBtn.disabled = false;
      }
    });
  }

  function triggerBlobDownload(blob, filename) {
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
  }

  function formatHttpErrorDetail(err, response) {
    if (err && err.detail !== undefined && err.detail !== null) {
      if (Array.isArray(err.detail)) {
        return err.detail.map((e) => `${e.loc?.join('.')} : ${e.msg}`).join('; ');
      }
      if (typeof err.detail === 'object') {
        return JSON.stringify(err.detail);
      }
      return String(err.detail);
    }
    return `HTTP ${response.status}: ${response.statusText}`;
  }

  function buildRestrictedNotice(docData) {
    const notes = [];
    const lockedPages = Array.isArray(docData?.premiumLockedPages)
      ? docData.premiumLockedPages
      : Array.isArray(docData?.lockedPages)
      ? docData.lockedPages
      : Array.isArray(docData?.restrictedPages)
      ? docData.restrictedPages
      : [];
    const lockedCount = Number(docData?.lockedPagesCount ?? docData?.restrictedPagesCount ?? lockedPages.length);
    const failedPages = Array.isArray(docData?.failedLoadPages) ? docData.failedLoadPages : [];

    if (lockedCount > 0) {
      const pageListStr = lockedPages.length > 0 ? ` (trang ${lockedPages.join(', ')})` : '';
      notes.push(
        `\n💡 Lưu ý: Phát hiện ${lockedCount} trang bị giới hạn xem trước trên nguồn gốc${pageListStr}. Bạn có thể đăng nhập tài khoản hoặc làm mới phiên xem trước trên trang web nếu muốn lấy toàn bộ các trang còn lại.`
      );
    }
    if (failedPages.length > 0) {
      notes.push(
        `\nℹ️ Đã tự động loại bỏ ${failedPages.length} trang trống không có dữ liệu (trang ${failedPages.join(', ')}).`
      );
    }
    return notes.join('');
  }

  // 1. Nút 1 (#export-web-docx-btn): Tải ruột tài liệu về Word (.docx)
  if (exportWebDocxBtn) {
    exportWebDocxBtn.addEventListener('click', async () => {
      exportWebDocxBtn.disabled = true;
      if (exportWebPdfBtn) exportWebPdfBtn.disabled = true;
      setMascotStatus('Đang chuẩn bị nội dung Word...', 'loading');

      try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!activeTab?.id || !activeTab.url || (!activeTab.url.startsWith('http://') && !activeTab.url.startsWith('https://'))) {
          setMascotStatus('Trang hiện tại không hợp lệ để xuất Word.', 'error');
          return;
        }

        const docData = await extractCleanDocument(activeTab.id);

        const safeTitle = String(docData.title || 'Smart_Study_Document').trim() || 'Smart_Study_Document';

        // Đảm bảo pages_structured luôn là mảng các trang, mỗi trang là mảng các dòng object
        let safePagesStructured = Array.isArray(docData.pagesStructured)
          ? docData.pagesStructured
              .map((page) => {
                if (Array.isArray(page)) return page;
                if (page && Array.isArray(page.items)) return page.items;
                return [];
              })
              .filter((page) => page.length > 0)
          : [];

        // Đảm bảo pages_text luôn là mảng chuỗi dự phòng
        let safePagesText = Array.isArray(docData.pagesText)
          ? docData.pagesText.map((t) => String(t || '').trim()).filter(Boolean)
          : [];

        // Đồng bộ dự phòng hai chiều nếu một trong hai rỗng
        if (safePagesStructured.length === 0 && safePagesText.length > 0) {
          safePagesStructured = safePagesText.map((pageStr) =>
            pageStr
              .split('\n')
              .map((line) => line.trim())
              .filter(Boolean)
              .map((line) => ({
                type: 'text',
                text: line,
                bold: false,
                center: false,
                fontSize: 12
              }))
          );
        } else if (safePagesText.length === 0 && safePagesStructured.length > 0) {
          safePagesText = safePagesStructured
            .map((pageItems) =>
              pageItems
                .filter((item) => item && item.type === 'text' && item.text)
                .map((item) => String(item.text))
                .join('\n')
            )
            .filter(Boolean);
        }

        if (safePagesStructured.length === 0 && safePagesText.length === 0) {
          throw new Error('Không tìm thấy nội dung văn bản nào trong vùng tài liệu của trang.');
        }

        const validExportPages =
          docData.validPagesCount || docData.pagesCount || safePagesStructured.length || safePagesText.length;
        setMascotStatus(`Đã thu thập ${validExportPages} trang; đang kết xuất file Word...`, 'loading');

        const response = await fetch(`${BACKEND_BASE_URL}/api/export-web-docx`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            title: safeTitle,
            pages_structured: safePagesStructured,
            pages_text: safePagesText
          })
        });

        if (!response.ok) {
          const err = await response.json().catch(() => null);
          const detail = formatHttpErrorDetail(err, response);
          throw new Error(detail);
        }

        const docxBlob = await response.blob();
        triggerBlobDownload(docxBlob, 'Smart_Study_Document.docx');

        const restrictedNote = buildRestrictedNotice(docData);
        setMascotStatus(
          `Đã tải xong ${validExportPages} trang về file Word.${restrictedNote}`,
          'idle',
        );
      } catch (error) {
        console.error('Lỗi khi xuất ruột tài liệu sang Word:', error);
        const msg = (error?.message || '').toLowerCase();
        if (error instanceof TypeError || msg.includes('failed to fetch') || msg.includes('networkerror')) {
          setMascotStatus('Chưa bật Backend Server ở cổng 8000. Hãy bật FastAPI rồi thử lại.', 'error');
        } else {
          setMascotStatus(`Lỗi khi tải ruột tài liệu về Word: ${error.message}`, 'error');
        }
      } finally {
        exportWebDocxBtn.disabled = false;
        if (exportWebPdfBtn) exportWebPdfBtn.disabled = false;
      }
    });
  }

  // 2. Nút 2 (#export-web-pdf-btn): 🖨️ In / Lưu bản gốc PDF (.pdf) trực tiếp trên tab
  if (exportWebPdfBtn) {
    exportWebPdfBtn.addEventListener('click', async () => {
      exportWebPdfBtn.disabled = true;
      if (exportWebDocxBtn) exportWebDocxBtn.disabled = true;
      const selectedSpeed = pdfScrollSpeeds[scrollSpeedSlider?.value] || pdfScrollSpeeds[3];
      setMascotStatus(`Đang chuẩn bị PDF ở tốc độ ${selectedSpeed.label}...`, 'loading');

      try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!activeTab?.id || !activeTab.url || (!activeTab.url.startsWith('http://') && !activeTab.url.startsWith('https://'))) {
          const errorMessage = 'Trang hiện tại không phải là trang web hợp lệ (http/https) để In / Lưu PDF!';
          setMascotStatus(errorMessage, 'error');
          return;
        }

        activePdfProgressTabId = activeTab.id;
        const printData = await prepareAndPrintTabPdf(activeTab.id, {
          scrollDelayMs: selectedSpeed.scrollDelayMs
        });

        const restrictedNote = buildRestrictedNotice(printData);
        if (printData?.ok === false) {
          const reason =
            printData.reason === 'no_valid_pages'
              ? 'Không có trang nội dung hợp lệ để in; các trang bị giới hạn đã được loại bỏ.'
              : printData.reason === 'print_window_blocked' ||
                printData.reason === 'popup_blocked'
              ? 'Trình duyệt đã chặn cửa sổ xem trước bản in.'
              : `Không thể chuẩn bị bản in${printData.error ? `: ${printData.error}` : '.'}`;
          setMascotStatus(`${reason}${restrictedNote}`, 'error');
          return;
        }

        const validPages = printData.validPageCount ?? printData.validPagesCount ?? 1;
        setMascotStatus(
          printData.mode === 'generic'
            ? `Đã chuẩn bị trang web để In / Lưu PDF. ${restrictedNote}`.trim()
            : `Đã chuẩn bị xong ${validPages} trang hợp lệ. ${restrictedNote}`.trim(),
          'idle',
        );
      } catch (error) {
        console.error('Lỗi khi chuẩn bị In / Lưu PDF trên tab:', error);
        setMascotStatus(`Lỗi khi chuẩn bị In / Lưu PDF: ${error.message}`, 'error');
      } finally {
        activePdfProgressTabId = null;
        exportWebPdfBtn.disabled = false;
        if (exportWebDocxBtn) exportWebDocxBtn.disabled = false;
      }
    });
  }
});
