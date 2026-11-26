import {
  API_BASE_URL,
  BACKEND_FETCH_TIMEOUT_MS,
  OPTION_LETTERS,
  VocabStorageManager,
  vocabStorageManager,
  normalizePracticeOptions,
  getSafeRawOptions,
  findCorrectOption,
  splitVocabQuestion,
  getVocabWord,
  getVocabPos,
  getVocabMeaning,
  getLocalDateKey,
  normalizeQuestionKey,
  recordStudyStreak,
  recordQuizAttempt,
  normalizeWeakQuestionOptions,
  recordQuestionOutcome,
  getWeightedWeakQuestions,
  clearAllWeakQuestions
} from './modules/storage-manager.js';

import {
  TOPIC_EMOJI_MAP,
  cleanTopicLabel,
  inferVisualCategoryFromCard,
  buildVisualMnemonicHtml,
  sanitizeSvgMarkup,
  parseLocalVocabPos,
  parseQuizLocally
} from './modules/vocab-parser.js';

import {
  shuffleArrayFisherYates,
  shuffleQuizQuestionsAndOptions,
  computeWeakQuestionScore,
  filterWeakQuestionsList,
  bindSvgTooltips,
  renderLeitnerSvgChart,
  renderQuizHistorySvgChart
} from './modules/quiz-engine.js';

import {
  speakText,
  refreshVoices,
  resolveSpeakerVoice,
  getIsPlayingDialogue,
  getStorySpeechRate,
  setStorySpeechRate,
  clearSpeakerVoiceAssignments,
  updateStoryPlaybackButtons,
  clearDialogueTurnHighlights,
  stopSpeechSequence,
  speakSingleUtterance,
  playDialogueSequence
} from './modules/speech-service.js';

import { initThemeManager } from './modules/theme-manager.js';

const BACKEND_ENRICH_URL = `${API_BASE_URL}/api/enrich-vocab`;
const BACKEND_GRADE_SENTENCE_URL = `${API_BASE_URL}/api/grade-sentence`;
const BACKEND_SYNTHESIZE_STORY_URL = `${API_BASE_URL}/api/synthesize-story`;
const BACKEND_SELECTION_COPILOT_URL = `${API_BASE_URL}/api/selection-copilot`;
const CLIENT_GEMINI_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.8-flash',
  'gemini-flash-latest'
];
const ENRICH_BATCH_SIZE = 5;
const ENRICH_TIMEOUT_MS = BACKEND_FETCH_TIMEOUT_MS;
const FETCH_TIMEOUT_MS = BACKEND_FETCH_TIMEOUT_MS;
const QUOTA_FALLBACK_GUIDANCE =
  '⚠️ API Key hiện tại đã hết lượt dùng / chạm giới hạn (Rate Limit / Quota). Vui lòng vào Side Panel → Cài đặt API Key để nhập Gemini API Key cá nhân của bạn và tiếp tục sử dụng.';
const isQuotaOrRateLimitError = (msg) =>
  /(429|quota|rate\s*limit|resource_exhausted|hết\s*lượt|giới\s*hạn)/i.test(String(msg || ''));
const buildApiHeaders = (apiKey) => {
  const headers = { 'Content-Type': 'application/json' };
  const clean = String(apiKey || '').trim();
  if (clean) headers['X-Gemini-Api-Key'] = clean;
  return headers;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let allVocabCards = [];
let selectedTopicFilter = 'ALL';
let activeCramMode = 'NONE';
let cramClusters = [];
let currentStoryData = null;
let isStoryShowVi = true;
let isStoryClozeMode = false;
let isGeneratingStory = false;
let originalQuiz = [];
let activeQuiz = [];
let isWeakRetestSession = false;
let weakRetestPool = [];
let preWeakRetestBackup = null;
let activeMode = 'quiz';
let questionIndex = 0;
let answered = false;
let results = [];
let countdownGeneration = 0;
let flashcardIndex = 0;
let flashcardFlipped = false;
let isReversedMode = false;
let isEnrichingVocab = false;
let dictationHintStep = 0;
let quizTitle = 'Bộ đề ôn tập';
let quizType = 'standard';
let practiceLogoProcessingCount = 0;

function setPracticeLogoProcessing(isActive) {
  practiceLogoProcessingCount = Math.max(0, practiceLogoProcessingCount + (isActive ? 1 : -1));
  const isProcessing = practiceLogoProcessingCount > 0;
  const logoSlot = document.getElementById('practice-logo-slot');
  if (!logoSlot) return;
  logoSlot.classList.toggle('is-logo-processing', isProcessing);
  logoSlot.setAttribute('data-logo-state', isProcessing ? 'processing' : 'idle');
}

function syncWeakRetestButtonVisibility() {
  const weakBtn = document.getElementById('practice-weak-retest-btn');
  if (!weakBtn) return;
  const shouldHide = quizType === 'vocab' || activeMode !== 'quiz';
  weakBtn.hidden = shouldHide;
  weakBtn.style.display = shouldHide ? 'none' : '';
}

function syncVocabOverviewVisibility() {
  const showOverview = quizType === 'vocab' && activeMode === 'flashcard';
  const masteryCard = document.getElementById('vocab-mastery-progress-card');
  if (masteryCard) masteryCard.hidden = !showOverview;
  const topicBar = document.getElementById('practice-topic-bar');
  if (topicBar) {
    topicBar.hidden = !showOverview || !allVocabCards.length;
  }
}

function updateVocabMasteryProgressBar(vocabBankList = []) {
  const cardEl = document.getElementById('vocab-mastery-progress-card');
  if (!cardEl) return;

  if (quizType !== 'vocab' || activeMode !== 'flashcard') {
    cardEl.hidden = true;
    return;
  }
  cardEl.hidden = false;

  const bankMap = new Map();
  (Array.isArray(vocabBankList) ? vocabBankList : []).forEach((entry) => {
    if (entry?.id) bankMap.set(entry.id, Number(entry.masteryLevel || 0));
  });

  const sourceList = allVocabCards.length ? allVocabCards : vocabBankList;
  let box0 = 0;
  let box1To3 = 0;
  let mastered = 0;

  sourceList.forEach((item) => {
    if (!item) return;
    const key = VocabStorageManager.makeKey(getVocabWord(item), getVocabPos(item));
    const lvlRaw =
      item.masteryLevel !== undefined
        ? Number(item.masteryLevel)
        : bankMap.has(key)
          ? bankMap.get(key)
          : 0;
    const lvl = Math.max(0, Math.min(4, Number(lvlRaw || 0)));
    item.masteryLevel = lvl;
    if (lvl === 0) {
      box0 += 1;
    } else if (lvl >= 4) {
      mastered += 1;
    } else {
      box1To3 += 1;
    }
  });

  const total = Math.max(1, box0 + box1To3 + mastered);
  const pct0 = Math.round((box0 / total) * 100);
  const pct1 = Math.round((box1To3 / total) * 100);
  const pctM = Math.max(0, 100 - pct0 - pct1);

  const chip0 = document.getElementById('mastery-chip-box0');
  const chip1 = document.getElementById('mastery-chip-box1');
  const chipM = document.getElementById('mastery-chip-mastered');
  if (chip0) chip0.textContent = `🔴 Box 0 (Cần ôn): ${box0}`;
  if (chip1) chip1.textContent = `🟡 Box 1–3 (Đang nhớ): ${box1To3}`;
  if (chipM) chipM.textContent = `🟢 Mastered (Thuộc vững): ${mastered}`;

  const seg0 = document.getElementById('mastery-seg-box0');
  const seg1 = document.getElementById('mastery-seg-box1');
  const segM = document.getElementById('mastery-seg-mastered');
  if (seg0) seg0.style.width = `${box0 === 0 ? 0 : pct0}%`;
  if (seg1) seg1.style.width = `${box1To3 === 0 ? 0 : pct1}%`;
  if (segM) segM.style.width = `${mastered === 0 ? 0 : pctM}%`;
}

async function renderAnalyticsDashboard() {
  const [vocabList, storageData, weakList] = await Promise.all([
    vocabStorageManager.getAll(),
    chrome.storage.local.get(['studyStreak', 'quizScoreHistory']).catch(() => ({})),
    getWeightedWeakQuestions()
  ]);

  const streakCount = Number(storageData?.studyStreak?.count || 0);
  const masteredCount = vocabList.filter((entry) => Number(entry?.masteryLevel || 0) >= 4).length;
  const history = Array.isArray(storageData?.quizScoreHistory) ? storageData.quizScoreHistory : [];
  const avgScore = history.length
    ? Math.round(history.reduce((sum, item) => sum + Number(item?.scorePercent || 0), 0) / history.length)
    : null;

  const kpiStreak = document.getElementById('kpi-streak');
  const kpiMastered = document.getElementById('kpi-mastered');
  const kpiAvgScore = document.getElementById('kpi-avg-score');
  const summaryPill = document.getElementById('analytics-summary-pill');
  const weakBtn = document.getElementById('practice-weak-retest-btn');

  if (kpiStreak) kpiStreak.textContent = `🔥 ${streakCount} ngày`;
  if (kpiMastered) kpiMastered.textContent = `${masteredCount} từ`;
  if (kpiAvgScore) kpiAvgScore.textContent = avgScore !== null ? `${avgScore}%` : '--%';
  if (summaryPill) {
    summaryPill.textContent = `🔥 ${streakCount} ngày • ${masteredCount} từ Box 4${avgScore !== null ? ` • TB ${avgScore}%` : ''}`;
  }
  if (weakBtn) {
    weakBtn.textContent = `🎯 Ôn câu hay sai (${weakList.length})`;
    weakBtn.disabled = weakList.length === 0;
  }
  syncWeakRetestButtonVisibility();
  updateVocabMasteryProgressBar(vocabList);

  renderLeitnerSvgChart(vocabList);
  renderQuizHistorySvgChart(history);
}

function applyWeakRetestFilter() {
  if (!isWeakRetestSession) return;
  const filterInput = document.getElementById('weak-filter-input');
  const severitySelect = document.getElementById('weak-severity-select');
  const query = filterInput ? filterInput.value : '';
  const severity = severitySelect ? severitySelect.value : 'ALL';

  const filtered = filterWeakQuestionsList(weakRetestPool, query, severity);
  const feedbackEl = document.getElementById('practice-feedback');

  if (!filtered.length) {
    if (feedbackEl) {
      feedbackEl.textContent = '⚠️ Không có câu hỏi sai nào khớp với bộ lọc hiện tại.';
      feedbackEl.className = 'practice-feedback is-wrong';
    }
    return;
  }

  activeQuiz = filtered;
  questionIndex = 0;
  results = [];
  answered = false;
  quizTitle = `🎯 Ôn câu hay sai (${filtered.length} câu)`;
  document.getElementById('practice-title').textContent = quizTitle;
  document.getElementById('practice-result-panel').hidden = true;
  document.getElementById('quiz-mode-panel').hidden = false;
  renderQuestion();
}

async function handleResetAllWeakQuestions() {
  const confirmed = window.confirm(
    'Bạn có chắc chắn muốn xóa sạch toàn bộ danh sách "Ôn câu hay sai" về 0 không?'
  );
  if (!confirmed) return;

  await clearAllWeakQuestions();
  weakRetestPool = [];
  await renderAnalyticsDashboard();

  const weakControls = document.getElementById('weak-retest-controls');
  if (weakControls) weakControls.hidden = true;
  isWeakRetestSession = false;

  if (preWeakRetestBackup && Array.isArray(preWeakRetestBackup.quiz) && preWeakRetestBackup.quiz.length) {
    quizTitle = preWeakRetestBackup.title;
    originalQuiz = preWeakRetestBackup.quiz;
    activeQuiz = preWeakRetestBackup.quiz;
    questionIndex = 0;
    results = [];
    answered = false;
    document.getElementById('practice-title').textContent = quizTitle;
    document.title = `${quizTitle} | Smart Study`;
    renderQuestion();
  } else {
    const feedback = document.getElementById('practice-feedback');
    if (feedback) {
      feedback.textContent = '✅ Đã xóa sạch danh sách câu hỏi hay sai!';
      feedback.className = 'practice-feedback is-correct';
    }
  }
}

async function startWeakSpotRetest() {
  const weakEntries = await getWeightedWeakQuestions();
  const retestQuestions = weakEntries
    .map((entry) => ({
      question: String(entry.question || '').trim(),
      options: normalizeWeakQuestionOptions(entry.options),
      correct_answer: String(entry.correct_answer || '').trim(),
      explanation: String(entry.explanation || '').trim(),
      images: Array.isArray(entry.images) ? entry.images : [],
      wrongCount: Number(entry.wrongCount || 1),
      attempts: Number(entry.attempts || 1)
    }))
    .filter((q) => q.question && q.options.length >= 2);
  if (!retestQuestions.length) return;

  if (!isWeakRetestSession && originalQuiz.length) {
    preWeakRetestBackup = {
      title: quizTitle,
      quiz: [...originalQuiz]
    };
  }

  isWeakRetestSession = true;
  weakRetestPool = retestQuestions;
  quizTitle = `🎯 Ôn câu hay sai (${retestQuestions.length} câu)`;
  quizType = 'standard';
  originalQuiz = retestQuestions;
  activeQuiz = retestQuestions;
  questionIndex = 0;
  results = [];
  answered = false;
  activeMode = 'quiz';

  const filterInput = document.getElementById('weak-filter-input');
  if (filterInput) filterInput.value = '';
  const severitySelect = document.getElementById('weak-severity-select');
  if (severitySelect) severitySelect.value = 'ALL';
  const weakControls = document.getElementById('weak-retest-controls');
  if (weakControls) weakControls.hidden = false;

  document.getElementById('practice-title').textContent = quizTitle;
  document.title = `${quizTitle} | Smart Study`;
  document.querySelectorAll('.mode-switch-btn').forEach((btn) => {
    const show = btn.dataset.mode === 'quiz';
    btn.hidden = !show;
    btn.style.display = show ? '' : 'none';
  });
  document.getElementById('practice-result-panel').hidden = true;
  document.getElementById('flashcard-mode-panel').hidden = true;
  const dPanel = document.getElementById('dictation-mode-panel');
  if (dPanel) dPanel.hidden = true;
  const sPanel = document.getElementById('sentence-mode-panel');
  if (sPanel) sPanel.hidden = true;
  const stPanel = document.getElementById('story-mode-panel');
  if (stPanel) stPanel.hidden = true;
  const topicBar = document.getElementById('practice-topic-bar');
  if (topicBar) topicBar.hidden = true;
  const masteryCard = document.getElementById('vocab-mastery-progress-card');
  if (masteryCard) masteryCard.hidden = true;
  document.getElementById('quiz-mode-panel').hidden = false;

  syncWeakRetestButtonVisibility();
  updateModeButtons();
  renderQuestion();
  void startUnifiedCountdown('quiz');
}

async function exportStudyRoadmapDocx() {
  const statusEl = document.getElementById('analytics-export-status');
  const setExportStatus = (msg) => {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.hidden = !msg;
  };

  if (!window.docx) {
    setExportStatus('⚠️ Không tải được thư viện assets/docx.umd.js.');
    return;
  }

  try {
    setExportStatus('⏳ Đang tạo phiếu lộ trình ôn tập (.docx)...');
    const [dueVocab, allVocab, weakList, storageData] = await Promise.all([
      vocabStorageManager.getDueList(),
      vocabStorageManager.getAll(),
      getWeightedWeakQuestions(),
      chrome.storage.local.get(['studyStreak', 'quizScoreHistory']).catch(() => ({}))
    ]);

    const streakCount = Number(storageData?.studyStreak?.count || 0);
    const masteredCount = allVocab.filter((e) => Number(e?.masteryLevel || 0) >= 4).length;
    const history = Array.isArray(storageData?.quizScoreHistory) ? storageData.quizScoreHistory : [];
    const avgScore = history.length
      ? Math.round(history.reduce((s, x) => s + Number(x?.scorePercent || 0), 0) / history.length)
      : null;

    const { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, WidthType, AlignmentType } = window.docx;

    const children = [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 180 },
        children: [
          new TextRun({
            text: 'PHIẾU LỘ TRÌNH ÔN TẬP CÁ NHÂN — SMART STUDY',
            bold: true,
            size: 30,
            color: '1D4ED8'
          })
        ]
      }),
      new Paragraph({
        spacing: { after: 160 },
        children: [
          new TextRun({
            text: `Ngày xuất: ${new Date().toLocaleDateString('vi-VN')}  |  Chuỗi học: ${streakCount} ngày  |  Từ thành thạo (Box 4): ${masteredCount}/${allVocab.length}  |  Điểm Quiz TB: ${avgScore !== null ? `${avgScore}%` : 'Chưa có'}`,
            size: 20,
            color: '334155'
          })
        ]
      }),
      new Paragraph({
        spacing: { before: 160, after: 120 },
        children: [
          new TextRun({
            text: `1. TỪ VỰNG CẦN ÔN TẬP ĐẾN HẠN (${dueVocab.length} từ)`,
            bold: true,
            size: 24,
            color: '0F172A'
          })
        ]
      })
    ];

    if (dueVocab.length) {
      const vocabHeaderRow = new TableRow({
        tableHeader: true,
        children: ['Từ vựng', 'Loại từ / IPA', 'Nghĩa tiếng Việt', 'Leitner Box'].map(
          (heading) =>
            new TableCell({
              shading: { fill: 'EFF6FF' },
              children: [new Paragraph({ children: [new TextRun({ text: heading, bold: true, size: 20 })] })]
            })
        )
      });
      const vocabRows = dueVocab.slice(0, 120).map(
        (v) =>
          new TableRow({
            children: [
              new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: String(v.word || ''), bold: true, size: 20 })] })] }),
              new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: `${v.pos ? `(${v.pos}) ` : ''}${v.ipa || ''}`.trim() || '—', size: 19 })] })] }),
              new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: String(v.meaning || '—'), size: 20 })] })] }),
              new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: `Box ${Number(v.masteryLevel || 0)}`, size: 19 })] })] })
            ]
          })
      );
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [vocabHeaderRow, ...vocabRows]
        })
      );
    } else {
      children.push(
        new Paragraph({
          spacing: { after: 120 },
          children: [new TextRun({ text: 'Hiện không có từ vựng nào đến hạn ôn tập.', italics: true, size: 20 })]
        })
      );
    }

    children.push(
      new Paragraph({
        spacing: { before: 240, after: 120 },
        children: [
          new TextRun({
            text: `2. CÂU HỎI TRẮC NGHIỆM HAY SAI CẦN ÔN LẠI (${weakList.length} câu)`,
            bold: true,
            size: 24,
            color: '0F172A'
          })
        ]
      })
    );

    if (weakList.length) {
      weakList.slice(0, 60).forEach((q, idx) => {
        children.push(
          new Paragraph({
            spacing: { before: 80, after: 40 },
            children: [
              new TextRun({
                text: `Câu ${idx + 1} (Sai ${Math.ceil(Number(q.wrongCount || 0))}/${Number(q.attempts || 1)} lần): `,
                bold: true,
                size: 20,
                color: 'B91C1C'
              }),
              new TextRun({ text: String(q.question || ''), bold: true, size: 20 })
            ]
          }),
          new Paragraph({
            spacing: { after: 80 },
            children: [
              new TextRun({ text: `Đáp án đúng: ${String(q.correct_answer || '—')}`, size: 19, color: '047857' }),
              q.explanation
                ? new TextRun({ text: `  |  Giải thích: ${String(q.explanation)}`, size: 19, color: '475569' })
                : new TextRun({ text: '' })
            ]
          })
        );
      });
    } else {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: 'Hiện chưa có câu hỏi hay sai nào được ghi nhận.', italics: true, size: 20 })]
        })
      );
    }

    const doc = new Document({ sections: [{ children }] });
    const blob = await Packer.toBlob(doc);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Smart_Study_Lo_Trinh_On_Tap_${getLocalDateKey()}.docx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    setExportStatus('✅ Đã xuất phiếu lộ trình ôn tập (.docx) thành công!');
  } catch (error) {
    console.error('Lỗi khi xuất phiếu lộ trình .docx:', error);
    setExportStatus(`⚠️ Lỗi khi xuất phiếu: ${error.message}`);
  }
}

function setProgress(current, total) {
  const progress = document.getElementById('practice-progress');
  if (progress) progress.textContent = `Câu ${current} / ${total}`;
}

function updateModeButtons() {
  document.querySelectorAll('.mode-switch-btn').forEach((button) => {
    button.classList.toggle('active', button.dataset.mode === activeMode);
  });
}

function renderQuestionImages(anchor, containerId, images) {
  let container = document.getElementById(containerId);
  if (!container) {
    container = document.createElement('div');
    container.id = containerId;
    container.className = 'practice-question-images';
    anchor.insertAdjacentElement('afterend', container);
  }

  container.replaceChildren();
  const validImages = Array.isArray(images)
    ? images.filter((image) => typeof image === 'string' && image.startsWith('data:image/'))
    : [];
  container.hidden = validImages.length === 0;

  validImages.forEach((imageUrl) => {
    const image = document.createElement('img');
    image.src = imageUrl;
    image.alt = 'Hình minh họa câu hỏi';
    image.addEventListener('click', (event) => {
      event.stopPropagation();
      image.classList.toggle('is-zoomed');
    });
    container.appendChild(image);
  });
}

function renderQuestion() {
  const item = activeQuiz[questionIndex];
  if (!item) {
    finishQuiz();
    return;
  }

  answered = false;
  setProgress(questionIndex + 1, activeQuiz.length);
  document.getElementById('practice-question-number').textContent = `Câu ${questionIndex + 1}`;
  const questionElement = document.getElementById('practice-question');
  questionElement.textContent = String(item.question || '').trim();
  renderQuestionImages(questionElement, 'practice-question-images', item.images);
  document.getElementById('practice-options').replaceChildren();
  document.getElementById('practice-explanation').hidden = true;
  const aiExplainWrap = document.getElementById('practice-ai-explain-wrap');
  if (aiExplainWrap) aiExplainWrap.hidden = true;
  document.getElementById('practice-feedback').textContent = '';
  document.getElementById('practice-feedback').className = 'practice-feedback';

  const nextButton = document.getElementById('practice-next-btn');
  nextButton.hidden = true;
  nextButton.textContent = questionIndex === activeQuiz.length - 1 ? '🏁 Xem kết quả' : 'Câu tiếp theo ➡️';

  const options = normalizePracticeOptions(getSafeRawOptions(item));
  options.forEach((option, optionIndex) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'practice-option-btn';
    button.dataset.letter = option.letter;

    const letter = document.createElement('span');
    letter.className = 'practice-option-letter';
    letter.textContent = option.letter;
    const text = document.createElement('span');
    text.textContent = option.text;
    button.append(letter, text);
    button.addEventListener('click', () => selectAnswer(option, optionIndex));
    document.getElementById('practice-options').appendChild(button);
  });
}

function hasMeaningfulQuizExplanation(rawExplanation) {
  const clean = String(rawExplanation || '').trim();
  if (!clean) return false;
  if (/^không có giải thích/i.test(clean)) return false;
  if (/^\([^()]{1,25}\)$/.test(clean)) return false;
  return true;
}

async function generateOnDemandQuizExplanation() {
  const item = activeQuiz[questionIndex];
  const result = results[questionIndex];
  const explanationEl = document.getElementById('practice-explanation');
  const aiWrap = document.getElementById('practice-ai-explain-wrap');
  const aiBtn = document.getElementById('practice-ai-explain-btn');
  if (!item || !explanationEl) return;

  const { geminiApiKey } = await chrome.storage.local.get('geminiApiKey').catch(() => ({}));
  const cleanKey = String(geminiApiKey || '').trim();

  const options = normalizePracticeOptions(getSafeRawOptions(item));
  const correctOption = result?.correct || findCorrectOption(item, options);
  const selectedOption = result?.selected || null;
  const optionsSummary = options.map((opt) => `${opt.letter}. ${opt.text}`).join('\n');

  if (aiBtn) {
    aiBtn.disabled = true;
    aiBtn.textContent = '⏳ AI đang phân tích đúng/sai & tạo mẹo nhớ...';
  }
  setPracticeLogoProcessing(true);
  explanationEl.textContent = '⏳ Đang phân tích câu hỏi, các phương án A/B/C/D và tạo tín hiệu ghi nhớ...';
  explanationEl.hidden = false;

  const prompt = `Bạn là gia sư luyện thi xuất sắc. Hãy giải thích ngắn gọn, rõ ràng câu hỏi trắc nghiệm sau bằng tiếng Việt:
Câu hỏi: ${String(item.question || '').trim()}
Các lựa chọn:
${optionsSummary}
Đáp án đúng: ${correctOption ? `${correctOption.letter}. ${correctOption.text}` : String(item.correct_answer || '')}
Lựa chọn của học viên: ${selectedOption ? `${selectedOption.letter}. ${selectedOption.text}` : 'Chưa rõ'}

Chỉ trả về JSON hợp lệ theo đúng cấu trúc:
{
  "why_correct": "Giải thích vì sao đáp án đúng là chính xác và hợp lý nhất",
  "why_others_wrong": "Giải thích vì sao lựa chọn của học viên (nếu sai) hoặc các phương án gây nhiễu khác chưa phù hợp",
  "memory_cue": "Mẹo ghi nhớ nhanh (Memory Cue) hoặc 1 ví dụ thực tế cực ngắn gọn để nhớ ngay không bao giờ nhầm lại"
}`;

  let formattedExplanation = '';
  let quotaErrorMsg = '';

  if (cleanKey) {
    try {
      const parsed = await callClientGeminiJsonWithFallback(prompt, cleanKey);
      if (parsed && typeof parsed === 'object') {
        const parts = [];
        if (parsed.why_correct) {
          parts.push(`✅ Vì sao đáp án ${correctOption?.letter || ''} đúng: ${String(parsed.why_correct).trim()}`);
        }
        if (parsed.why_others_wrong) {
          parts.push(`❌ Phân tích phương án nhiễu/sai: ${String(parsed.why_others_wrong).trim()}`);
        }
        if (parsed.memory_cue) {
          parts.push(`💡 Mẹo ghi nhớ (Memory Cue): ${String(parsed.memory_cue).trim()}`);
        }
        formattedExplanation = parts.join('\n\n').trim();
      }
    } catch (clientErr) {
      if (isQuotaOrRateLimitError(clientErr?.message)) {
        quotaErrorMsg = QUOTA_FALLBACK_GUIDANCE;
      }
      console.warn('Thử fallback qua Backend /api/selection-copilot cho giải thích câu hỏi:', clientErr);
    }
  }

  if (!formattedExplanation) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const response = await fetch(BACKEND_SELECTION_COPILOT_URL, {
        method: 'POST',
        headers: buildApiHeaders(cleanKey),
        signal: controller.signal,
        body: JSON.stringify({
          text: `Giải thích câu trắc nghiệm:\n${String(item.question || '').trim()}\n${optionsSummary}\nĐáp án đúng: ${correctOption ? `${correctOption.letter}. ${correctOption.text}` : ''}\nNgười học chọn: ${selectedOption ? `${selectedOption.letter}. ${selectedOption.text}` : ''}\nHãy nêu: 1) Vì sao đáp án đúng hợp lý; 2) Vì sao phương án khác sai; 3) Mẹo ghi nhớ (Memory Cue).`,
          action: 'explain',
          page_title: quizTitle,
          page_url: '',
          api_key: cleanKey
        })
      });
      clearTimeout(timeoutId);
      const data = await response.json().catch(() => null);
      if (response.status === 429 || isQuotaOrRateLimitError(data?.detail)) {
        quotaErrorMsg = QUOTA_FALLBACK_GUIDANCE;
      } else if (response.ok && data) {
        const summary = String(data.summary || data.explanation || data.explanation_vi || '').trim();
        const points = Array.isArray(data.key_points)
          ? data.key_points.map((p) => `• ${p}`).join('\n')
          : Array.isArray(data.key_takeaways)
            ? data.key_takeaways.map((p) => `• ${p}`).join('\n')
            : '';
        const example = String(data.example || '').trim();
        formattedExplanation = [
          summary ? `✅ Phân tích: ${summary}` : '',
          points ? `📌 Chi tiết phương án:\n${points}` : '',
          example ? `💡 Mẹo ghi nhớ (Memory Cue): ${example}` : ''
        ]
          .filter(Boolean)
          .join('\n\n')
          .trim();
      }
    } catch (backendErr) {
      console.warn('Lỗi fallback giải thích câu hỏi:', backendErr);
    }
  }

  if (formattedExplanation) {
    item.explanation = formattedExplanation;
    explanationEl.textContent = formattedExplanation;
    explanationEl.hidden = false;
    if (aiWrap) aiWrap.hidden = true;
  } else if (quotaErrorMsg) {
    explanationEl.textContent = quotaErrorMsg;
    explanationEl.hidden = false;
  } else {
    explanationEl.textContent =
      '⚠️ Không thể tạo giải thích AI lúc này. Nếu server hết lượt dùng, hãy nhập Gemini API Key cá nhân tại Side Panel → Cài đặt API Key.';
    explanationEl.hidden = false;
  }

  setPracticeLogoProcessing(false);
  if (aiBtn) {
    aiBtn.disabled = false;
    aiBtn.textContent = '💡 Giải thích vì sao đúng/sai';
  }
}

function selectAnswer(selectedOption) {
  if (answered) return;
  const item = activeQuiz[questionIndex];
  const options = normalizePracticeOptions(getSafeRawOptions(item));
  const correctOption = findCorrectOption(item, options);
  if (!correctOption) return;
  answered = true;

  const isCorrect = selectedOption.letter === correctOption.letter;
  results[questionIndex] = {
    item,
    selected: selectedOption,
    correct: correctOption,
    isCorrect
  };
  void recordQuestionOutcome(item, isCorrect).then(() => renderAnalyticsDashboard());

  document.querySelectorAll('.practice-option-btn').forEach((button) => {
    button.disabled = true;
    if (button.dataset.letter === correctOption.letter) button.classList.add('is-correct');
    if (button.dataset.letter === selectedOption.letter && !isCorrect) button.classList.add('is-wrong');
  });

  const feedback = document.getElementById('practice-feedback');
  feedback.textContent = isCorrect ? '✅ Chính xác!' : `❌ Chưa đúng — đáp án ${correctOption.letter}`;
  feedback.classList.add(isCorrect ? 'is-correct' : 'is-wrong');

  const explanation = document.getElementById('practice-explanation');
  const aiExplainWrap = document.getElementById('practice-ai-explain-wrap');
  const aiExplainBtn = document.getElementById('practice-ai-explain-btn');

  if (hasMeaningfulQuizExplanation(item.explanation)) {
    explanation.textContent = String(item.explanation).trim();
    explanation.hidden = false;
    if (aiExplainWrap) aiExplainWrap.hidden = true;
  } else {
    explanation.textContent = '';
    explanation.hidden = true;
    if (aiExplainWrap) aiExplainWrap.hidden = false;
    if (aiExplainBtn) {
      aiExplainBtn.disabled = false;
      aiExplainBtn.textContent = '💡 Giải thích vì sao đúng/sai';
    }
  }
  document.getElementById('practice-next-btn').hidden = false;
}

function finishQuiz() {
  countdownGeneration += 1;
  const countdownOverlay = document.getElementById('practice-countdown-overlay');
  if (countdownOverlay) countdownOverlay.hidden = true;
  document.getElementById('quiz-mode-panel').hidden = true;
  document.getElementById('practice-result-panel').hidden = false;

  const completed = results.filter(Boolean);
  const correctCount = completed.filter((result) => result.isCorrect).length;
  const percent = completed.length ? Math.round((correctCount / completed.length) * 100) : 0;
  document.getElementById('practice-result-title').textContent = quizTitle;
  document.getElementById('practice-score-summary').textContent =
    `Đúng ${correctCount} / ${activeQuiz.length} câu • ${percent}% chính xác`;

  const reviewList = document.getElementById('practice-review-list');
  reviewList.replaceChildren();
  activeQuiz.forEach((item, index) => {
    const result = results[index];
    const card = document.createElement('article');
    card.className = `review-card ${result?.isCorrect ? 'is-correct' : 'is-wrong'}`;
    const title = document.createElement('h4');
    title.textContent = `${result?.isCorrect ? '✅ Đúng' : '❌ Sai'} — ${String(item.question || '').trim()}`;
    const chosen = document.createElement('p');
    chosen.textContent = `Bạn chọn: ${result ? `${result.selected.letter}. ${result.selected.text}` : 'Chưa trả lời'}`;
    const correct = document.createElement('p');
    const options = normalizePracticeOptions(getSafeRawOptions(item));
    const right = findCorrectOption(item, options);
    correct.textContent = `Đáp án đúng: ${right ? `${right.letter}. ${right.text}` : 'Chưa xác định'}`;
    const explanation = document.createElement('p');
    explanation.className = 'review-explanation';
    explanation.textContent = `Giải thích: ${String(item.explanation || 'Không có giải thích chi tiết.')}`;
    card.append(title, chosen, correct, explanation);
    reviewList.appendChild(card);
  });

  const wrongButton = document.getElementById('retry-wrong-btn');
  wrongButton.disabled = !completed.some((result) => !result.isCorrect);

  void Promise.all([
    recordStudyStreak(),
    recordQuizAttempt({
      title: quizTitle,
      scorePercent: percent,
      correctCount,
      totalCount: activeQuiz.length
    })
  ]).then(() => renderAnalyticsDashboard());
}

let countdownAudioCtx = null;

function playCountdownTone(step) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!countdownAudioCtx) {
      countdownAudioCtx = new AudioCtx();
    }
    const ctx = countdownAudioCtx;
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => { });
    }

    const now = ctx.currentTime;
    if (step === 'Bắt đầu!') {
      // Chuỗi 2 nốt chuông khởi động vui tai: E5 (659.25 Hz) nối tiếp C6 (1046.5 Hz) trong 260ms
      const notes = [
        { freq: 659.25, start: now, duration: 0.12 },
        { freq: 1046.5, start: now + 0.11, duration: 0.15 }
      ];
      notes.forEach(({ freq, start, duration }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.18, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + duration);
      });
    } else {
      // Nhịp 3 / 2 / 1: tiếng beep gọn sắc nét C5 (523.25 Hz), thời lượng 130ms
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, now);
      gain.gain.setValueAtTime(0.16, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.13);
    }
  } catch (_) {
    // Bỏ qua an toàn nếu trình duyệt chặn autoplay AudioContext
  }
}

function waitForTabVisible(maxWaitMs = 600) {
  if (document.visibilityState === 'visible') {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      clearTimeout(fallbackTimer);
      resolve();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        finish();
      }
    };
    const fallbackTimer = setTimeout(finish, maxWaitMs);
    document.addEventListener('visibilitychange', onVisibilityChange);
  });
}

function restartQuiz(questions) {
  activeQuiz = questions;
  questionIndex = 0;
  results = [];
  document.getElementById('practice-result-panel').hidden = true;
  document.getElementById('quiz-mode-panel').hidden = false;
  renderQuestion();
  void startUnifiedCountdown('quiz');
}

async function startUnifiedCountdown(mode = activeMode) {
  const overlay = document.getElementById('practice-countdown-overlay');
  const label = document.getElementById('practice-countdown-text');
  const subtitle = document.getElementById('practice-countdown-subtitle');
  if (!overlay || !label) return;

  const generation = ++countdownGeneration;
  if (subtitle) {
    subtitle.textContent =
      mode === 'flashcard' ? 'Chuẩn bị Lật thẻ Từ vựng...' : 'Chuẩn bị Thi Trắc nghiệm...';
  }
  overlay.style.opacity = '1';
  overlay.hidden = false;

  await waitForTabVisible(600);
  if (generation !== countdownGeneration) return;
  await new Promise((resolve) => requestAnimationFrame(resolve));
  if (generation !== countdownGeneration) return;

  const steps = [
    { text: '3', holdMs: 750 },
    { text: '2', holdMs: 750 },
    { text: '1', holdMs: 750 },
    { text: 'Bắt đầu!', holdMs: 600 }
  ];

  for (const step of steps) {
    if (generation !== countdownGeneration) return;
    label.textContent = step.text;
    label.style.animation = 'none';
    void label.offsetWidth;
    label.style.animation = '';
    playCountdownTone(step.text);
    await sleep(step.holdMs);
  }

  if (generation !== countdownGeneration) return;
  overlay.style.opacity = '0';
  await sleep(250);
  if (generation !== countdownGeneration) return;
  overlay.hidden = true;
  overlay.style.opacity = '1';

  if (mode === 'flashcard' && quizType === 'vocab' && !isReversedMode) {
    speakFlashcard();
  }
}

function skipCountdown() {
  countdownGeneration += 1;
  const overlay = document.getElementById('practice-countdown-overlay');
  if (overlay) {
    overlay.style.opacity = '0';
    overlay.hidden = true;
    overlay.style.opacity = '1';
  }
  if (activeMode === 'flashcard' && quizType === 'vocab' && !isReversedMode) {
    speakFlashcard();
  }
}

function renderHighlightedSentence(container, sentence, targetWord) {
  if (!container) return;
  container.replaceChildren();
  const cleanSentence = String(sentence || '').trim();
  if (!cleanSentence) return;

  const cleanWord = String(targetWord || '').trim();
  if (!cleanWord) {
    container.textContent = cleanSentence;
    return;
  }

  const escaped = cleanWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped}[a-z]*)`, 'gi');
  const parts = cleanSentence.split(regex);
  parts.forEach((part, idx) => {
    if (!part) return;
    if (idx % 2 === 1) {
      const strong = document.createElement('strong');
      strong.textContent = part;
      container.appendChild(strong);
    } else {
      container.appendChild(document.createTextNode(part));
    }
  });
}

function getPrimarySourceMeta(item) {
  const sources = Array.isArray(item?.sources) ? item.sources : [];
  const ytSource = sources.find((src) => src?.type === 'youtube' && src?.videoId);
  if (ytSource) return ytSource;

  const videoId = item?.videoId || window.practiceSession?.videoId || '';
  const videoUrl = item?.videoUrl || window.practiceSession?.videoUrl || '';
  const videoTitle = item?.videoTitle || window.practiceSession?.videoTitle || quizTitle;
  const timestampSec = Number.isFinite(Number(item?.timestampSec)) ? Number(item.timestampSec) : null;
  const timestampLabel = String(item?.timestampLabel || '').trim();

  if (videoId) {
    return {
      type: 'youtube',
      title: videoTitle,
      videoId,
      videoUrl: videoUrl || `https://www.youtube.com/watch?v=${videoId}`,
      ...(timestampSec !== null ? { timestampSec } : {}),
      ...(timestampLabel ? { timestampLabel } : {}),
      addedAt: Date.now()
    };
  }

  if (sources.length > 0) return sources[sources.length - 1];

  const sessionSourceType = window.practiceSession?.source_type;
  return {
    type: sessionSourceType === 'docx' ? 'docx' : 'text',
    title: quizTitle,
    addedAt: Date.now()
  };
}

function formatSourceBadgeText(item) {
  const src = getPrimarySourceMeta(item);
  if (!src || !src.title) return '';
  const shortTitle = src.title.length > 32 ? `${src.title.slice(0, 32)}…` : src.title;
  if (src.type === 'youtube') return `🎬 Từ video: ${shortTitle}`;
  if (src.type === 'docx') return `📄 Từ file: ${shortTitle}`;
  return `📝 Từ nguồn: ${shortTitle}`;
}

async function seekYoutubeOriginalSegment(source) {
  if (!source?.videoId || !Number.isFinite(Number(source.timestampSec))) return;
  const targetVideoId = String(source.videoId).trim();
  const seconds = Math.max(0, Math.floor(Number(source.timestampSec)));

  try {
    const allTabs = await chrome.tabs.query({});
    const matchingTab = allTabs.find((tab) => {
      const url = String(tab?.url || '');
      return (url.includes('youtube.com') || url.includes('youtu.be')) && url.includes(targetVideoId);
    });

    if (matchingTab?.id) {
      await chrome.tabs.update(matchingTab.id, { active: true });
      if (matchingTab.windowId) {
        await chrome.windows.update(matchingTab.windowId, { focused: true }).catch(() => { });
      }
      try {
        await chrome.tabs.sendMessage(matchingTab.id, {
          action: 'SEEK_YOUTUBE_VIDEO',
          seconds
        });
        return;
      } catch (msgErr) {
        console.warn('Không gửi được lệnh tua tới tab YouTube, thử mở URL kèm timestamp:', msgErr);
      }
    }

    const baseUrl = source.videoUrl && source.videoUrl.includes('youtube.com/watch')
      ? source.videoUrl.replace(/[&?]t=\d+s?/gi, '')
      : `https://www.youtube.com/watch?v=${encodeURIComponent(targetVideoId)}`;
    const separator = baseUrl.includes('?') ? '&' : '?';
    await chrome.tabs.create({ url: `${baseUrl}${separator}t=${seconds}s`, active: true });
  } catch (error) {
    console.error('Lỗi khi tua đoạn video gốc:', error);
  }
}

function showSrsToast(message) {
  const toastEl = document.getElementById('srs-status-toast');
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.hidden = !message;
}

async function handleSrsMark(isKnown) {
  if (!activeQuiz.length) return;
  const currentIdx = Math.max(0, Math.min(flashcardIndex, activeQuiz.length - 1));
  const item = activeQuiz[currentIdx];
  if (!item) return;
  const sourceMeta = getPrimarySourceMeta(item);
  const wordLabel = getVocabWord(item);

  if (isKnown) {
    const saved = await vocabStorageManager.markKnown(item, sourceMeta);
    const level = Math.max(1, Math.min(4, Number(saved?.masteryLevel || 1)));
    const nextDays = VocabStorageManager.LEITNER_INTERVALS_DAYS[level] || 14;
    item.masteryLevel = level;
    showSrsToast(
      level >= 4
        ? `🟢 "${wordLabel}" đã đạt Box 4 (Thành thạo) — nhắc ôn lại sau ${nextDays} ngày!`
        : `🟢 Đã thuộc "${wordLabel}" → Box ${level} (nhắc ôn lại sau ${nextDays} ngày).`
    );
  } else {
    await vocabStorageManager.upsertUnknown(item, sourceMeta);
    item.masteryLevel = 0;
    showSrsToast(`🔴 Đã đưa "${wordLabel}" về Box 0 (Cần ôn) — chuyển sang thẻ kế tiếp.`);
  }

  void recordStudyStreak().then(() => renderAnalyticsDashboard());

  if (activeQuiz.length > 1) {
    flashcardIndex = currentIdx < activeQuiz.length - 1 ? currentIdx + 1 : 0;
    renderFlashcard(true);
  } else {
    flashcardFlipped = false;
    document.getElementById('flashcard')?.classList.remove('is-flipped');
  }
}

function updateCrammingToolbarUi() {
  const btn5Min = document.getElementById('cram-5min-btn');
  const btnCluster = document.getElementById('cram-cluster-btn');
  const selectCluster = document.getElementById('cram-cluster-select');
  const btnExit = document.getElementById('cram-exit-btn');

  if (btn5Min) btn5Min.classList.toggle('active', activeCramMode === '5MIN');
  if (btnCluster) btnCluster.classList.toggle('active', activeCramMode === 'CLUSTER');
  if (selectCluster) selectCluster.hidden = activeCramMode !== 'CLUSTER';
  if (btnExit) btnExit.hidden = activeCramMode === 'NONE';
}

function refreshActiveVocabView() {
  flashcardIndex = 0;
  renderCardJumpOptions();
  if (activeMode === 'dictation') {
    renderDictationCard(true);
  } else if (activeMode === 'sentence') {
    renderSentenceCard();
  } else if (activeMode === 'story') {
    void generateAndRenderStory(true);
  } else {
    renderFlashcard(false);
  }
}

function startCram5MinMode() {
  if (!allVocabCards.length) return;
  const unmastered = allVocabCards.filter((card) => Number(card?.masteryLevel || 0) < 4);
  const pool = unmastered.length ? unmastered : [...allVocabCards];
  const sorted = [...pool].sort((a, b) => Number(a?.masteryLevel || 0) - Number(b?.masteryLevel || 0));
  const picked = sorted.slice(0, Math.min(10, sorted.length));
  if (!picked.length) return;

  activeCramMode = '5MIN';
  activeQuiz = picked;
  updateCrammingToolbarUi();
  refreshActiveVocabView();
  showSrsToast(`⚡ Đang bật "Ôn nhanh 5 phút" với ${picked.length} thẻ cần ưu tiên ôn nhất!`);
}

function buildVocabClusters() {
  const unmastered = allVocabCards.filter((card) => Number(card?.masteryLevel || 0) < 4);
  const pool = unmastered.length ? unmastered : [...allVocabCards];
  const byGroup = new Map();

  pool.forEach((card) => {
    const topicLabel = cleanTopicLabel(card?.topic);
    const posLabel = getVocabPos(card) || 'từ vựng';
    const groupKey = topicLabel && topicLabel !== 'Chủ đề chung' ? topicLabel : `Nhóm (${posLabel})`;
    if (!byGroup.has(groupKey)) byGroup.set(groupKey, []);
    byGroup.get(groupKey).push(card);
  });

  const clusters = [];
  const CHUNK_SIZE = 6;
  byGroup.forEach((cards, groupName) => {
    for (let i = 0; i < cards.length; i += CHUNK_SIZE) {
      const slice = cards.slice(i, i + CHUNK_SIZE);
      const partSuffix = cards.length > CHUNK_SIZE ? ` #${Math.floor(i / CHUNK_SIZE) + 1}` : '';
      clusters.push({
        label: `🧩 Cụm ${clusters.length + 1}: ${groupName}${partSuffix} (${slice.length} thẻ)`,
        cards: slice
      });
    }
  });
  return clusters;
}

function startCramClusterMode() {
  if (!allVocabCards.length) return;
  cramClusters = buildVocabClusters();
  if (!cramClusters.length) return;

  activeCramMode = 'CLUSTER';
  const selectEl = document.getElementById('cram-cluster-select');
  if (selectEl) {
    selectEl.replaceChildren();
    cramClusters.forEach((cluster, idx) => {
      const opt = document.createElement('option');
      opt.value = String(idx);
      opt.textContent = cluster.label;
      selectEl.appendChild(opt);
    });
    selectEl.value = '0';
  }

  activeQuiz = [...cramClusters[0].cards];
  updateCrammingToolbarUi();
  refreshActiveVocabView();
  showSrsToast(`🧩 Đang ôn ${cramClusters[0].label}`);
}

function exitCramMode() {
  activeCramMode = 'NONE';
  activeQuiz =
    selectedTopicFilter === 'ALL'
      ? [...allVocabCards]
      : allVocabCards.filter((c) => cleanTopicLabel(c?.topic) === selectedTopicFilter);
  updateCrammingToolbarUi();
  refreshActiveVocabView();
  showSrsToast(`↩️ Đã quay lại toàn bộ danh sách (${activeQuiz.length} thẻ).`);
}

async function exportUnmasteredVocabToDocx() {
  if (!window.docx) {
    showSrsToast('⚠️ Không tải được thư viện assets/docx.umd.js để xuất file Word.');
    return;
  }

  try {
    let itemsToExport = await vocabStorageManager.getUnmasteredList();
    if (!itemsToExport.length) {
      itemsToExport = activeQuiz
        .filter((item) => Number(item?.masteryLevel || 0) < 2)
        .map((item) => {
          const options = normalizePracticeOptions(getSafeRawOptions(item));
          const correctOption = options.length > 0 ? findCorrectOption(item, options) : null;
          return {
            word: getVocabWord(item),
            pos: getVocabPos(item),
            ipa: String(item?.ipa || '').trim(),
            meaning: getVocabMeaning(item, options, correctOption),
            contextSentence: String(item?.contextSentence || item?.example_en || item?.example || '').trim(),
            masteryLevel: Number(item?.masteryLevel || 0)
          };
        });
    }

    if (!itemsToExport.length) {
      showSrsToast('🎉 Không có từ vựng nào chưa thuộc để xuất Word!');
      return;
    }

    const { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, WidthType, AlignmentType } = window.docx;
    const headerRow = new TableRow({
      children: ['STT', 'Từ vựng & Loại từ', 'Phiên âm', 'Nghĩa tiếng Việt', 'Câu ví dụ ngữ cảnh'].map(
        (label) =>
          new TableCell({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: label, bold: true, size: 22 })]
              })
            ]
          })
      )
    });

    const dataRows = itemsToExport.map(
      (entry, idx) =>
        new TableRow({
          children: [
            String(idx + 1),
            entry.pos ? `${entry.word} (${entry.pos})` : entry.word,
            entry.ipa || '',
            entry.meaning || '',
            entry.contextSentence || ''
          ].map(
            (cellText) =>
              new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: String(cellText), size: 20 })] })]
              })
          )
        })
    );

    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({
                  text: `SỔ TAY TỪ VỰNG CẦN ÔN (${itemsToExport.length} TỪ)`,
                  bold: true,
                  size: 28
                })
              ]
            }),
            new Paragraph({ text: '' }),
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: [headerRow, ...dataRows]
            })
          ]
        }
      ]
    });

    const blob = await Packer.toBlob(doc);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'Smart_Study_Tu_Vung_Can_On.docx';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showSrsToast(`📥 Đã xuất ${itemsToExport.length} từ chưa thuộc ra Smart_Study_Tu_Vung_Can_On.docx!`);
  } catch (error) {
    console.error('Lỗi xuất Word từ chưa thuộc:', error);
    showSrsToast(`❌ Không thể xuất Word: ${error.message}`);
  }
}

// --- SPRINT 10.2: Dictation Mode (Nghe & Gõ điền từ) ---
function normalizeDictationText(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[.,!?;:"'()\[\]{}–—\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function maskTargetWordInSentence(sentence, targetWord) {
  const cleanSentence = String(sentence || '').trim();
  const cleanWord = String(targetWord || '').trim();
  if (!cleanSentence || !cleanWord) return cleanSentence;
  const escaped = cleanWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return cleanSentence.replace(new RegExp(`\\b${escaped}[a-z]*\\b`, 'gi'), '_____');
}

function renderDictationCharDiff(userRaw, targetRaw, container) {
  if (!container) return;
  container.replaceChildren();
  const normUser = normalizeDictationText(userRaw);
  const normTarget = normalizeDictationText(targetRaw);
  const isPerfect = normUser.length > 0 && normUser === normTarget;

  const statusLine = document.createElement('p');
  statusLine.className = `dictation-diff-status ${isPerfect ? 'is-perfect' : 'is-wrong'}`;
  statusLine.textContent = isPerfect
    ? '✅ Chính xác hoàn toàn!'
    : '❌ Chưa khớp hoàn toàn — xem chi tiết từng ký tự:';
  container.appendChild(statusLine);

  const charsWrap = document.createElement('div');
  charsWrap.className = 'dictation-diff-chars';
  const maxLen = Math.max(normUser.length, normTarget.length);
  for (let i = 0; i < maxLen; i += 1) {
    const uChar = normUser[i];
    const tChar = normTarget[i];
    const span = document.createElement('span');
    if (uChar !== undefined && tChar !== undefined && uChar === tChar) {
      span.className = 'diff-char-correct';
      span.textContent = uChar === ' ' ? '␣' : uChar;
    } else if (uChar !== undefined) {
      span.className = 'diff-char-wrong';
      span.textContent = uChar === ' ' ? '␣' : uChar;
    } else {
      span.className = 'diff-char-wrong';
      span.textContent = tChar === ' ' ? '␣' : '_';
    }
    charsWrap.appendChild(span);
  }
  container.appendChild(charsWrap);

  if (!isPerfect) {
    const reveal = document.createElement('p');
    reveal.className = 'dictation-answer-reveal';
    reveal.textContent = `Đáp án chuẩn: ${targetRaw}`;
    container.appendChild(reveal);
  }
  container.hidden = false;
}

function renderDictationCard(shouldSpeak = true) {
  if (!activeQuiz.length) return;
  const item = activeQuiz[flashcardIndex];
  dictationHintStep = 0;

  const wordText = getVocabWord(item);
  const posText = getVocabPos(item);
  const options = normalizePracticeOptions(getSafeRawOptions(item));
  const correctOption = options.length > 0 ? findCorrectOption(item, options) : null;
  const meaningText = getVocabMeaning(item, options, correctOption);
  const contextSentence = String(item?.contextSentence || item?.example_en || item?.example || '').trim();
  const sourceMeta = getPrimarySourceMeta(item);

  document.getElementById('dictation-number').textContent = `Từ ${flashcardIndex + 1} / ${activeQuiz.length}`;
  document.getElementById('practice-progress').textContent = `Từ ${flashcardIndex + 1} / ${activeQuiz.length}`;

  const srcBadge = document.getElementById('dictation-source-badge');
  if (srcBadge) {
    const badgeStr = formatSourceBadgeText(item);
    srcBadge.textContent = badgeStr;
    srcBadge.hidden = !badgeStr;
  }

  document.getElementById('dictation-meaning').textContent = meaningText;
  const posEl = document.getElementById('dictation-pos');
  if (posEl) {
    posEl.textContent = posText ? `(${posText})` : '';
    posEl.hidden = !posText;
  }

  const contextEl = document.getElementById('dictation-context');
  if (contextEl) {
    const masked = maskTargetWordInSentence(contextSentence, wordText);
    contextEl.textContent = masked;
    contextEl.hidden = !masked;
  }

  const speakSentenceBtn = document.getElementById('dictation-speak-sentence-btn');
  if (speakSentenceBtn) speakSentenceBtn.hidden = !contextSentence;

  const seekBtn = document.getElementById('dictation-seek-yt-btn');
  if (seekBtn) {
    const hasYt = Boolean(sourceMeta?.type === 'youtube' && sourceMeta?.videoId && Number.isFinite(Number(sourceMeta?.timestampSec)));
    seekBtn.hidden = !hasYt;
    if (hasYt) {
      seekBtn.textContent = `🎬 Xem đoạn gốc [${sourceMeta.timestampLabel || `${Math.floor(sourceMeta.timestampSec / 60)}:${String(sourceMeta.timestampSec % 60).padStart(2, '0')}`}]`;
    }
  }

  const inputEl = document.getElementById('dictation-input');
  if (inputEl) {
    inputEl.value = '';
    inputEl.focus();
  }
  const hintEl = document.getElementById('dictation-hint-text');
  if (hintEl) {
    hintEl.textContent = '';
    hintEl.hidden = true;
  }
  const diffEl = document.getElementById('dictation-diff-result');
  if (diffEl) {
    diffEl.replaceChildren();
    diffEl.hidden = true;
  }

  document.getElementById('dictation-prev-btn').disabled = flashcardIndex === 0;
  document.getElementById('dictation-next-btn').disabled = flashcardIndex === activeQuiz.length - 1;

  if (shouldSpeak && wordText) {
    speakText(wordText, 'en-US', 0.9);
  }
}

function checkDictationInput() {
  const item = activeQuiz[flashcardIndex];
  const inputEl = document.getElementById('dictation-input');
  const diffEl = document.getElementById('dictation-diff-result');
  if (!item || !inputEl || !diffEl) return;
  renderDictationCharDiff(inputEl.value, getVocabWord(item), diffEl);
}

function showDictationHint() {
  const item = activeQuiz[flashcardIndex];
  const hintEl = document.getElementById('dictation-hint-text');
  if (!item || !hintEl) return;
  const word = getVocabWord(item);
  if (!word) return;
  dictationHintStep += 1;
  const revealCount = Math.min(word.length, dictationHintStep);
  const masked = word
    .split('')
    .map((ch, idx) => (ch === ' ' || idx < revealCount || (dictationHintStep >= 2 && idx === word.length - 1) ? ch : '_'))
    .join(' ');
  hintEl.textContent = `💡 Gợi ý: ${masked}`;
  hintEl.hidden = false;
}

// --- SPRINT 10.2: Chế độ AI Sửa đặt câu ---
function renderSentenceCard() {
  if (!activeQuiz.length) return;
  const item = activeQuiz[flashcardIndex];
  const wordText = getVocabWord(item);
  const posText = getVocabPos(item);
  const ipaText = String(item?.ipa || '').trim();
  const options = normalizePracticeOptions(getSafeRawOptions(item));
  const correctOption = options.length > 0 ? findCorrectOption(item, options) : null;
  const meaningText = getVocabMeaning(item, options, correctOption);
  const contextSentence = String(item?.contextSentence || item?.example_en || item?.example || '').trim();

  document.getElementById('sentence-number').textContent = `Từ ${flashcardIndex + 1} / ${activeQuiz.length}`;
  document.getElementById('practice-progress').textContent = `Từ ${flashcardIndex + 1} / ${activeQuiz.length}`;
  const srcBadge = document.getElementById('sentence-source-badge');
  if (srcBadge) {
    const badgeStr = formatSourceBadgeText(item);
    srcBadge.textContent = badgeStr;
    srcBadge.hidden = !badgeStr;
  }
  document.getElementById('sentence-target-word').textContent = wordText;
  const posEl = document.getElementById('sentence-target-pos');
  if (posEl) {
    posEl.textContent = posText ? `(${posText})` : '';
    posEl.hidden = !posText;
  }
  document.getElementById('sentence-target-ipa').textContent = ipaText;
  document.getElementById('sentence-target-meaning').textContent = meaningText;
  const refEl = document.getElementById('sentence-ref-context');
  if (refEl) {
    refEl.textContent = contextSentence ? `Ví dụ tham khảo: ${contextSentence}` : '';
    refEl.hidden = !contextSentence;
  }
  const textarea = document.getElementById('sentence-input');
  if (textarea) textarea.value = '';
  const feedbackEl = document.getElementById('sentence-feedback');
  if (feedbackEl) {
    feedbackEl.textContent = '';
    feedbackEl.hidden = true;
  }
  document.getElementById('sentence-prev-btn').disabled = flashcardIndex === 0;
  document.getElementById('sentence-next-btn').disabled = flashcardIndex === activeQuiz.length - 1;
}

async function callClientGeminiJsonWithFallback(prompt, apiKey) {
  let lastError = null;
  for (const modelName of CLIENT_GEMINI_MODELS) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
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
        const errMsg = data?.error?.message || `HTTP ${response.status}`;
        lastError = new Error(errMsg);
        if ([400, 404, 429, 503].includes(response.status) || response.status >= 500) {
          continue;
        }
        throw lastError;
      }
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (!rawText.trim()) {
        lastError = new Error(`Model ${modelName} trả về nội dung rỗng.`);
        continue;
      }
      const cleaned = rawText
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
      return JSON.parse(cleaned);
    } catch (error) {
      lastError = error.name === 'AbortError' ? new Error(`Model ${modelName} quá thời gian chờ.`) : error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
  throw lastError || new Error('Không có model Gemini nào phản hồi thành công.');
}

function formatGradeSentenceFeedback(data) {
  if (!data) return 'Không nhận được phản hồi từ AI.';
  if (typeof data === 'string') return data.trim();
  if (typeof data.feedback === 'string' && data.feedback.trim() && !data.corrected_sentence && !data.explanation) {
    return data.feedback.trim();
  }
  const lines = [];
  if (data.score !== undefined && data.score !== null) {
    lines.push(`📊 Điểm đánh giá: ${data.score}/10`);
  }
  if (typeof data.is_correct === 'boolean') {
    lines.push(data.is_correct ? '✅ Đánh giá: Dùng từ đúng từ loại & ngữ cảnh!' : '⚠️ Đánh giá: Cần điều chỉnh lại câu cho tự nhiên/chính xác hơn.');
  }
  if (data.corrected_sentence || data.improved_sentence) {
    lines.push(`✍️ Câu gợi ý chuẩn hơn: ${data.corrected_sentence || data.improved_sentence}`);
  }
  if (data.explanation || data.feedback) {
    lines.push(`💡 Giải thích: ${data.explanation || data.feedback}`);
  }
  return lines.length > 0 ? lines.join('\n\n') : JSON.stringify(data, null, 2);
}

async function evaluateUserSentence() {
  const item = activeQuiz[flashcardIndex];
  const textarea = document.getElementById('sentence-input');
  const feedbackEl = document.getElementById('sentence-feedback');
  const checkBtn = document.getElementById('sentence-check-btn');
  if (!item || !textarea || !feedbackEl) return;

  const userSentence = textarea.value.trim();
  if (!userSentence) {
    feedbackEl.textContent = '⚠️ Vui lòng nhập một câu tiếng Anh có chứa từ vựng mục tiêu trước khi chấm.';
    feedbackEl.hidden = false;
    return;
  }

  const { geminiApiKey } = await chrome.storage.local.get('geminiApiKey').catch(() => ({}));
  const cleanKey = String(geminiApiKey || '').trim();

  const wordText = getVocabWord(item);
  const posText = getVocabPos(item);
  const options = normalizePracticeOptions(getSafeRawOptions(item));
  const correctOption = options.length > 0 ? findCorrectOption(item, options) : null;
  const meaningText = getVocabMeaning(item, options, correctOption);

  if (checkBtn) checkBtn.disabled = true;
  feedbackEl.textContent = '⏳ AI đang chấm và sửa câu của bạn...';
  feedbackEl.hidden = false;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // Ưu tiên gọi Backend POST ${API_BASE_URL}/api/grade-sentence (tự fallback sang GEMINI_API_KEY env trên server nếu người dùng chưa nhập key)
    const response = await fetch(BACKEND_GRADE_SENTENCE_URL, {
      method: 'POST',
      headers: buildApiHeaders(cleanKey),
      signal: controller.signal,
      body: JSON.stringify({
        word: wordText,
        pos: posText,
        meaning: meaningText,
        sentence: userSentence,
        api_key: cleanKey
      })
    });

    if (response.ok) {
      const data = await response.json().catch(() => null);
      feedbackEl.textContent = formatGradeSentenceFeedback(data);
      return;
    }

    const errData = await response.json().catch(() => null);
    if (response.status === 429 || isQuotaOrRateLimitError(errData?.detail)) {
      feedbackEl.textContent = QUOTA_FALLBACK_GUIDANCE;
      return;
    }

    // Nếu Backend chưa hỗ trợ route /api/grade-sentence (404) hoặc lỗi 5xx, fallback sang danh sách model sống ở client nếu có key cá nhân
    if (![404, 502, 503, 504].includes(response.status)) {
      throw new Error(errData?.detail || `HTTP ${response.status}`);
    }
  } catch (backendError) {
    console.warn('Chuyển sang chấm câu trực tiếp qua danh sách model sống ở client:', backendError.message);
  } finally {
    clearTimeout(timeoutId);
  }

  if (!cleanKey) {
    feedbackEl.textContent =
      '⚠️ Không thể chấm câu qua máy chủ lúc này. Vui lòng vào Side Panel → Cài đặt API Key để nhập Gemini API Key cá nhân.';
    if (checkBtn) checkBtn.disabled = false;
    return;
  }

  try {
    const prompt = `Bạn là giáo viên tiếng Anh chấm câu cho người Việt.
Từ mục tiêu: "${wordText}" (${posText || 'từ vựng'}) — Nghĩa: "${meaningText}".
Câu của học viên: "${userSentence}"
Chỉ trả về JSON hợp lệ theo schema:
{"is_correct": true, "score": 9, "corrected_sentence": "Câu tiếng Anh chuẩn và tự nhiên nhất", "explanation": "Giải thích ngắn gọn bằng tiếng Việt về cách dùng từ, ngữ pháp và điểm cần sửa."}`;
    const parsed = await callClientGeminiJsonWithFallback(prompt, cleanKey);
    feedbackEl.textContent = formatGradeSentenceFeedback(parsed);
  } catch (error) {
    feedbackEl.textContent = `❌ Không thể chấm câu lúc này: ${error.message}`;
  } finally {
    if (checkBtn) checkBtn.disabled = false;
  }
}

function parseTimestampToSeconds(timestamp) {
  const parts = String(timestamp || '').replace(/^\[|\]$/g, '').trim().split(':').map(Number);
  if ((parts.length !== 2 && parts.length !== 3) || parts.some((p) => !Number.isInteger(p) || p < 0)) {
    return null;
  }
  return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
}

async function extractMoreVocabFromVideo() {
  const transcript = String(window.practiceSession?.transcript || '').trim();
  const extractBtn = document.getElementById('extract-more-video-vocab-btn');
  if (!transcript) {
    setEnrichStatus('Phiên hiện tại không có phụ đề video để khai thác thêm từ.', true);
    return;
  }

  const { geminiApiKey } = await chrome.storage.local.get('geminiApiKey').catch(() => ({}));
  const cleanKey = String(geminiApiKey || '').trim();
  if (!cleanKey) {
    setEnrichStatus('Vui lòng cài đặt Gemini API Key để khai thác thêm từ mới.', true);
    return;
  }

  const existingWords = activeQuiz.map((card) => getVocabWord(card)).filter(Boolean);
  const existingSet = new Set(existingWords.map((w) => w.toLowerCase()));

  if (extractBtn) extractBtn.disabled = true;
  setEnrichStatus('🔍 Đang khai thác thêm 10–12 từ & cụm từ học thuật mới từ phụ đề video...', true);

  try {
    const prompt = `Bạn là giáo viên tiếng Anh chuyên rút trích từ vựng học thuật từ phụ đề video YouTube cho người Việt.
Hãy đọc toàn bộ phụ đề dưới đây và rút trích THÊM 10–12 từ vựng chuyên ngành hoặc cụm từ / collocations học thuật mới (TUYỆT ĐỐI KHÔNG TRÙNG với danh sách đã có).
Danh sách từ đã có (bỏ qua): ${JSON.stringify(existingWords)}
Chỉ trả về JSON hợp lệ theo đúng cấu trúc:
{"keywords":[{"term":"English term or collocation","ipa":"/IPA/","pos":"n","meaning":"nghĩa tiếng Việt ngắn gọn","context":"English sentence from transcript containing the term","timestamp":"MM:SS"}]}

PHỤ ĐỀ VIDEO:
${transcript}`;

    const parsed = await callClientGeminiJsonWithFallback(prompt, cleanKey);
    const rawKeywords = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.keywords) ? parsed.keywords : [];
    const videoId = window.practiceSession?.videoId || '';
    const videoTitle = window.practiceSession?.videoTitle || quizTitle;
    const videoUrl = window.practiceSession?.videoUrl || '';

    const addedCards = [];
    rawKeywords.forEach((kw) => {
      const term = String(kw?.term || '').trim();
      const meaning = String(kw?.meaning || '').trim();
      if (!term || !meaning || existingSet.has(term.toLowerCase())) return;
      existingSet.add(term.toLowerCase());

      const posClean = String(kw?.pos || '').replace(/[()]/g, '').trim();
      const contextSentence = String(kw?.context || '').trim();
      const timestampLabel = String(kw?.timestamp || '').replace(/^\[|\]$/g, '').trim();
      const timestampSec = parseTimestampToSeconds(timestampLabel);
      const sourceEntry = {
        type: 'youtube',
        title: videoTitle,
        videoId,
        videoUrl,
        ...(timestampSec !== null ? { timestampSec } : {}),
        ...(timestampLabel ? { timestampLabel } : {}),
        addedAt: Date.now()
      };

      addedCards.push({
        word: term,
        pos: posClean,
        question: posClean ? `${term} (${posClean})` : term,
        front: term,
        answer: meaning,
        back: meaning,
        meaning_vi: meaning,
        correct_answer: meaning,
        options: [],
        ipa: String(kw?.ipa || '').trim(),
        contextSentence,
        example_en: contextSentence,
        example_vi: '',
        svg_sketch: '',
        timestampLabel,
        timestampSec,
        videoId,
        videoUrl,
        videoTitle,
        sources: [sourceEntry],
        explanation: posClean ? `(${posClean})` : ''
      });
    });

    if (!addedCards.length) {
      setEnrichStatus('Không tìm thấy thêm từ vựng mới nào chưa có trong bộ thẻ.', true);
      return;
    }

    activeQuiz.push(...addedCards);
    allVocabCards = activeQuiz;
    originalQuiz = activeQuiz;
    if (window.practiceSession) {
      window.practiceSession.quiz = allVocabCards;
      await chrome.storage.local.set({ activePracticeSession: window.practiceSession }).catch(() => null);
    }

    renderTopicPills();
    renderCardJumpOptions();
    renderFlashcard(false);
    setEnrichStatus(`✅ Đã nối thêm ${addedCards.length} từ/cụm từ mới (tổng ${activeQuiz.length} thẻ)!`, true);
    void enrichVocabInBatches(false);
  } catch (error) {
    console.error('Lỗi khai thác thêm từ từ video:', error);
    setEnrichStatus(`⚠️ Không thể khai thác thêm từ: ${error.message}`, true);
  } finally {
    if (extractBtn) extractBtn.disabled = false;
  }
}

function speakFlashcard() {
  const item = activeQuiz[flashcardIndex];
  const wordOnly = getVocabWord(item);
  if (!wordOnly) return;
  speakText(wordOnly, 'en-US');
}

function speakFlashcardExample() {
  const item = activeQuiz[flashcardIndex];
  const exampleEn = String(item?.example_en || item?.example || '').trim();
  if (!exampleEn) return;
  speakText(exampleEn, 'en-US');
}

function renderCardJumpOptions() {
  const jumpSelect = document.getElementById('practice-card-jump');
  if (!jumpSelect) return;
  jumpSelect.replaceChildren();
  activeQuiz.forEach((item, index) => {
    const opt = document.createElement('option');
    opt.value = String(index);
    const labelWord = quizType === 'vocab' ? getVocabWord(item) : String(item?.question || '').trim();
    const shortLabel = labelWord.length > 26 ? `${labelWord.slice(0, 26)}…` : labelWord;
    opt.textContent = `Thẻ ${index + 1}/${activeQuiz.length}${shortLabel ? ` • ${shortLabel}` : ''}`;
    jumpSelect.appendChild(opt);
  });
  jumpSelect.value = String(flashcardIndex);
}

function setEnrichStatus(message, isVisible = true) {
  const statusEl = document.getElementById('flashcard-enrich-status');
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.hidden = !isVisible || !message;
}

function renderTopicPills() {
  const topicBar = document.getElementById('practice-topic-bar');
  const pillsWrap = document.getElementById('practice-topic-pills');
  if (!topicBar || !pillsWrap) return;

  if (quizType !== 'vocab' || activeMode !== 'flashcard' || !allVocabCards.length) {
    topicBar.hidden = true;
    return;
  }

  const topicMap = new Map();
  allVocabCards.forEach((card) => {
    const label = cleanTopicLabel(card?.topic);
    const cat = inferVisualCategoryFromCard(card);
    const prev = topicMap.get(label);
    topicMap.set(label, {
      count: (prev?.count || 0) + 1,
      emoji: prev?.emoji || TOPIC_EMOJI_MAP[cat] || '🏷️'
    });
  });

  if (selectedTopicFilter !== 'ALL' && !topicMap.has(selectedTopicFilter)) {
    selectedTopicFilter = 'ALL';
  }

  pillsWrap.replaceChildren();

  const createPill = (topicKey, text) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `topic-filter-pill ${selectedTopicFilter === topicKey ? 'active' : ''}`;
    btn.textContent = text;
    btn.addEventListener('click', () => {
      if (selectedTopicFilter === topicKey) return;
      selectedTopicFilter = topicKey;
      activeQuiz =
        selectedTopicFilter === 'ALL'
          ? [...allVocabCards]
          : allVocabCards.filter((c) => cleanTopicLabel(c?.topic) === selectedTopicFilter);
      flashcardIndex = 0;
      renderTopicPills();
      renderCardJumpOptions();
      if (activeMode === 'dictation') {
        renderDictationCard(true);
      } else if (activeMode === 'sentence') {
        renderSentenceCard();
      } else if (activeMode === 'story') {
        void generateAndRenderStory(true);
      } else {
        renderFlashcard(false);
      }
    });
    return btn;
  };

  pillsWrap.appendChild(createPill('ALL', `Tất cả (${allVocabCards.length})`));
  topicMap.forEach((info, label) => {
    pillsWrap.appendChild(createPill(label, `${info.emoji} ${label} (${info.count})`));
  });

  topicBar.hidden = false;
}

async function syncEnrichedCardsToStorage() {
  if (window.practiceSession) {
    window.practiceSession.quiz = allVocabCards;
    await chrome.storage.local.set({ activePracticeSession: window.practiceSession }).catch(() => null);
  }
  try {
    const bankList = await vocabStorageManager.getAll();
    if (!bankList.length) return;
    const bankMap = new Map(bankList.map((entry, idx) => [entry?.id, idx]));
    let bankUpdated = false;

    allVocabCards.forEach((card) => {
      const key = VocabStorageManager.makeKey(getVocabWord(card), getVocabPos(card));
      const idx = bankMap.get(key);
      if (idx === undefined) return;
      const existing = { ...bankList[idx] };
      if (card.ipa) existing.ipa = card.ipa;
      if (card.meaning_vi) existing.meaning = card.meaning_vi;
      if (card.example_en) {
        existing.contextSentence = card.example_en;
        existing.example_en = card.example_en;
      }
      if (card.example_vi) {
        existing.exampleVi = card.example_vi;
        existing.example_vi = card.example_vi;
      }
      if (card.topic) existing.topic = card.topic;
      if (card.visual_category) existing.visual_category = card.visual_category;
      if (card.icon_emoji) existing.icon_emoji = card.icon_emoji;
      if (card.visual_label) existing.visual_label = card.visual_label;
      if (card.memory_hook) existing.memory_hook = card.memory_hook;
      bankList[idx] = existing;
      bankUpdated = true;
    });

    if (bankUpdated) {
      await vocabStorageManager.saveAll(bankList);
    }
  } catch (err) {
    console.warn('Không thể đồng bộ thẻ làm giàu vào vocabBank:', err);
  }
}

async function enrichVocabInBatches(forceAll = false) {
  if (isEnrichingVocab || quizType !== 'vocab' || !allVocabCards.length) return;

  const { geminiApiKey } = await chrome.storage.local.get('geminiApiKey').catch(() => ({}));
  const cleanKey = String(geminiApiKey || '').trim();

  const pendingIndices = [];
  allVocabCards.forEach((item, index) => {
    const hasExample = Boolean(String(item?.example_en || item?.example || '').trim());
    const hasAuthenticImage = Array.isArray(item?.images) && item.images.some((img) => typeof img === 'string' && img.startsWith('data:image/'));
    // Tự động nâng cấp thẻ cũ chưa có icon_emoji / visual_label / memory_hook (hoặc đang chứa svg_sketch cũ)
    const hasModernVisual = Boolean(
      hasAuthenticImage ||
      (String(item?.icon_emoji || item?.iconEmoji || '').trim() &&
        String(item?.visual_label || item?.visualLabel || '').trim() &&
        String(item?.memory_hook || item?.memoryHook || '').trim())
    );
    if (forceAll || !hasExample || !hasModernVisual) {
      pendingIndices.push(index);
    }
  });

  if (!pendingIndices.length) {
    if (forceAll) setEnrichStatus('Tất cả thẻ đã có ví dụ & minh họa ngữ nghĩa!', true);
    return;
  }

  isEnrichingVocab = true;
  setPracticeLogoProcessing(true);
  const enrichBtn = document.getElementById('flashcard-enrich-btn');
  if (enrichBtn) enrichBtn.disabled = true;

  let completedCount = 0;
  let failedIndices = [];
  let quotaStopped = false;
  let lastFailureKind = '';
  let lastHttpStatus = 0;
  let lastFailureDetail = '';

  const processBatchList = async (indicesList, isRetryPass = false) => {
    const batchFailures = [];
    for (let offset = 0; offset < indicesList.length; offset += ENRICH_BATCH_SIZE) {
      // Nhường băng thông API nếu người dùng đang tạo Hội thoại thực chiến để tránh xung đột 429/timeout
      while (isGeneratingStory) {
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
      const batchIndices = indicesList.slice(offset, offset + ENRICH_BATCH_SIZE);
      const progressLabel = isRetryPass
        ? `🔄 Đang tự thử lại ${batchIndices.length} thẻ bị thiếu minh họa...`
        : `✨ Đang tạo minh họa ngữ nghĩa & mẹo nhớ (${Math.min(offset + batchIndices.length, indicesList.length)}/${indicesList.length})...`;
      setEnrichStatus(progressLabel, true);

      const batchPayload = batchIndices.map((idx) => {
        const card = allVocabCards[idx];
        const options = normalizePracticeOptions(getSafeRawOptions(card));
        const correctOption = options.length > 0 ? findCorrectOption(card, options) : null;
        return {
          index: idx,
          word: getVocabWord(card),
          pos: getVocabPos(card),
          meaning: getVocabMeaning(card, options, correctOption),
          topic: String(card?.topic || '').trim(),
          contextSentence: String(card?.contextSentence || card?.example_en || card?.example || '').trim()
        };
      });

      const controller = new AbortController();
      const enrichTimeoutSeconds = Math.round(ENRICH_TIMEOUT_MS / 1000);
      const timeoutId = setTimeout(
        () => controller.abort(new Error(`Quá thời gian chờ ${enrichTimeoutSeconds} giây cho lô từ vựng này`)),
        ENRICH_TIMEOUT_MS
      );

      let quotaReached = false;
      try {
        const response = await fetch(BACKEND_ENRICH_URL, {
          method: 'POST',
          headers: buildApiHeaders(cleanKey),
          signal: controller.signal,
          body: JSON.stringify({
            items: batchPayload,
            api_key: cleanKey
          })
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => null);
          if (response.status === 429 || isQuotaOrRateLimitError(errData?.detail)) {
            quotaReached = true;
            throw new Error(QUOTA_FALLBACK_GUIDANCE);
          }
          lastHttpStatus = response.status;
          lastFailureDetail = String(errData?.detail || '').trim();
          lastFailureKind = response.status >= 500 ? 'server' : 'client';
          const httpErr = new Error(lastFailureDetail || `HTTP ${response.status}`);
          httpErr.isHttpError = true;
          throw httpErr;
        }

        const data = await response.json().catch(() => null);
        const enrichedList = Array.isArray(data?.items) ? data.items : [];
        let currentCardUpdated = false;
        const returnedIdxSet = new Set();

        enrichedList.forEach((enriched) => {
          const targetIdx = Number(enriched?.index);
          if (!Number.isInteger(targetIdx) || !allVocabCards[targetIdx]) return;
          returnedIdxSet.add(targetIdx);
          const target = allVocabCards[targetIdx];
          if (enriched.ipa) target.ipa = String(enriched.ipa).trim();
          if (enriched.meaning) {
            target.meaning_vi = String(enriched.meaning).trim();
            target.back = String(enriched.meaning).trim();
            target.answer = String(enriched.meaning).trim();
            if (!Array.isArray(target.options) || target.options.length === 0) {
              target.correct_answer = String(enriched.meaning).trim();
            }
          }
          if (enriched.example_en) {
            target.example_en = String(enriched.example_en).trim();
            target.contextSentence = String(enriched.example_en).trim();
          }
          if (enriched.example_vi) target.example_vi = String(enriched.example_vi).trim();
          if (enriched.topic) target.topic = String(enriched.topic).trim();
          if (enriched.visual_category) target.visual_category = String(enriched.visual_category).trim();
          if (enriched.icon_emoji) target.icon_emoji = String(enriched.icon_emoji).trim();
          if (enriched.visual_label) target.visual_label = String(enriched.visual_label).trim();
          if (enriched.memory_hook) target.memory_hook = String(enriched.memory_hook).trim();
          target.svg_sketch = '';
          if (activeQuiz[flashcardIndex] === target) currentCardUpdated = true;
        });

        completedCount += returnedIdxSet.size;
        // Ghi nhận các thẻ trong lô không được AI trả về để tự retry
        batchIndices.forEach((idx) => {
          if (!returnedIdxSet.has(idx)) {
            batchFailures.push(idx);
          }
        });

        await syncEnrichedCardsToStorage();
        renderTopicPills();

        if (currentCardUpdated && activeMode === 'flashcard') {
          renderFlashcard(false);
        }
      } catch (batchError) {
        if (quotaReached || isQuotaOrRateLimitError(batchError?.message)) {
          quotaStopped = true;
          setEnrichStatus(QUOTA_FALLBACK_GUIDANCE, true);
          return batchFailures;
        }
        if (!batchError?.isHttpError) {
          const rawMsg = String(batchError?.message || '');
          if (batchError?.name === 'AbortError' || /quá thời gian chờ|timeout/i.test(rawMsg)) {
            lastFailureKind = 'timeout';
          } else if (batchError instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(rawMsg)) {
            lastFailureKind = 'connection';
          } else if (!lastFailureKind) {
            lastFailureKind = 'unknown';
            lastFailureDetail = rawMsg;
          }
        }
        console.warn(`Lô từ vựng (${batchIndices.join(', ')}) gặp lỗi, sẽ tự thử lại:`, batchError);
        batchFailures.push(...batchIndices);
      } finally {
        clearTimeout(timeoutId);
      }
    }
    return batchFailures;
  };

  try {
    failedIndices = await processBatchList(pendingIndices, false);

    // Tự động thử lại 1 lượt cho các thẻ bị lỗi/thiếu ở lượt 1 (tránh sót 5/15 thẻ như trước)
    if (!quotaStopped && failedIndices.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      failedIndices = await processBatchList(failedIndices, true);
    }

    if (quotaStopped) return;

    const totalTarget = pendingIndices.length;
    if (completedCount >= totalTarget && totalTarget > 0) {
      setEnrichStatus(`✅ Đã hoàn tất minh họa ngữ nghĩa & mẹo nhớ cho đủ ${completedCount}/${totalTarget} thẻ!`, true);
    } else if (completedCount > 0) {
      const missingCount = Math.max(0, totalTarget - completedCount);
      setEnrichStatus(
        `⚠️ Đã tạo minh họa ${completedCount}/${totalTarget} thẻ (còn ${missingCount} thẻ — bấm "Tạo ví dụ & Ảnh phác thảo" để bổ sung nốt).`,
        true
      );
    } else if (lastFailureKind === 'connection') {
      setEnrichStatus(
        '⚠️ Không thể kết nối tới máy chủ xử lý. Vui lòng kiểm tra kết nối mạng hoặc đảm bảo dịch vụ Backend đang hoạt động rồi thử lại.',
        true
      );
    } else if (lastFailureKind === 'timeout') {
      setEnrichStatus(
        `⚠️ Quá thời gian chờ phản hồi (${Math.round(ENRICH_TIMEOUT_MS / 1000)} giây). Máy chủ có thể đang khởi động lại hoặc xử lý chậm, vui lòng thử lại.`,
        true
      );
    } else if (lastFailureKind === 'client' && lastFailureDetail) {
      setEnrichStatus(`⚠️ ${lastFailureDetail}`, true);
    } else {
      const statusHint = lastHttpStatus >= 500 ? ` (HTTP ${lastHttpStatus})` : '';
      setEnrichStatus(`⚠️ Máy chủ xử lý gặp sự cố tạm thời${statusHint}, bạn có thể bấm thử lại sau ít giây.`, true);
    }
  } catch (error) {
    console.warn('Lỗi khi làm giàu từ vựng theo lô:', error);
    setEnrichStatus(`⚠️ Tạm dừng làm giàu: ${error.message}`, true);
  } finally {
    isEnrichingVocab = false;
    if (!isGeneratingStory) {
      setPracticeLogoProcessing(false);
    }
    if (enrichBtn) enrichBtn.disabled = false;
  }
}

function renderFlashcard(shouldSpeak = true) {
  if (!activeQuiz.length) return;
  const item = activeQuiz[flashcardIndex];
  flashcardFlipped = false;
  document.getElementById('flashcard').classList.remove('is-flipped');
  document.getElementById('flashcard-number').textContent = `Thẻ ${flashcardIndex + 1} / ${activeQuiz.length}`;
  document.getElementById('practice-progress').textContent = `Thẻ ${flashcardIndex + 1} / ${activeQuiz.length}`;

  const jumpSelect = document.getElementById('practice-card-jump');
  if (jumpSelect && jumpSelect.value !== String(flashcardIndex)) {
    jumpSelect.value = String(flashcardIndex);
  }

  const isVocabCard = quizType === 'vocab';
  const wordText = isVocabCard
    ? getVocabWord(item)
    : String(item.question || item.front || '').trim();
  const posText = isVocabCard ? getVocabPos(item) : '';
  const ipaText = String(item.ipa || '').trim();
  const topicText = String(item.topic || '').trim();
  const options = normalizePracticeOptions(getSafeRawOptions(item));
  const correctOption = options.length > 0 ? findCorrectOption(item, options) : null;
  const meaningText = getVocabMeaning(item, options, correctOption);

  // Huy hiệu chủ đề & huy hiệu nguồn gốc
  const topicBadge = document.getElementById('flashcard-topic');
  if (topicBadge) {
    topicBadge.textContent = topicText;
    topicBadge.hidden = !topicText;
  }
  const sourceBadge = document.getElementById('flashcard-source-badge');
  if (sourceBadge) {
    const badgeStr = formatSourceBadgeText(item);
    sourceBadge.textContent = badgeStr;
    sourceBadge.hidden = !badgeStr;
  }
  const seekYtBtn = document.getElementById('flashcard-seek-yt-btn');
  if (seekYtBtn) {
    const srcMeta = getPrimarySourceMeta(item);
    const hasYtSegment = Boolean(
      srcMeta?.type === 'youtube' && srcMeta?.videoId && Number.isFinite(Number(srcMeta?.timestampSec))
    );
    seekYtBtn.hidden = !hasYtSegment;
    if (hasYtSegment) {
      const lbl =
        srcMeta.timestampLabel ||
        `${Math.floor(srcMeta.timestampSec / 60)}:${String(Math.floor(srcMeta.timestampSec % 60)).padStart(2, '0')}`;
      seekYtBtn.textContent = `🎬 Xem đoạn gốc [${lbl}]`;
    }
  }

  const questionElement = document.getElementById('flashcard-question');
  const posBadge = document.getElementById('flashcard-pos');
  const ipaElement = document.getElementById('flashcard-ipa');
  const speakBtn = document.getElementById('flashcard-speak-btn');
  const backLabel = document.querySelector('.flashcard-back-label');
  const answerElement = document.getElementById('flashcard-answer');

  if (isVocabCard && isReversedMode) {
    // Chế độ Việt → Anh
    questionElement.textContent = meaningText;
    if (posBadge) {
      posBadge.textContent = posText ? `(${posText})` : '';
      posBadge.hidden = !posText;
    }
    if (ipaElement) ipaElement.textContent = '';
    if (speakBtn) speakBtn.hidden = true;
    if (backLabel) backLabel.textContent = 'TỪ VỰNG TIẾNG ANH';
    answerElement.textContent = [wordText, posText ? `(${posText})` : '', ipaText].filter(Boolean).join(' ');
  } else {
    // Chế độ mặc định Anh → Việt
    questionElement.textContent = wordText;
    if (posBadge) {
      posBadge.textContent = posText ? `(${posText})` : '';
      posBadge.hidden = !posText;
    }
    if (ipaElement) ipaElement.textContent = ipaText;
    if (speakBtn) speakBtn.hidden = !isVocabCard;
    if (backLabel) backLabel.textContent = 'ĐÁP ÁN / NGHĨA';
    answerElement.textContent = meaningText;
  }

  // Khung minh họa 3 Tầng ở mặt trước: ưu tiên ảnh gốc item.images[0], tiếp theo là Composite Visual Mnemonic Card
  const visualContainer = document.getElementById('flashcard-visual');
  if (visualContainer) {
    visualContainer.replaceChildren();
    const mnemonicNode = buildVisualMnemonicHtml(item);
    if (mnemonicNode) {
      visualContainer.appendChild(mnemonicNode);
      visualContainer.hidden = false;
    } else {
      visualContainer.hidden = true;
    }
  }

  // Khung Câu ứng dụng thực tế ở mặt sau
  const exampleBox = document.getElementById('flashcard-example-box');
  const exampleEnEl = document.getElementById('flashcard-example-en');
  const exampleViEl = document.getElementById('flashcard-example-vi');
  const exampleEn = String(item.example_en || item.example || '').trim();
  const exampleVi = String(item.example_vi || '').trim();
  if (exampleBox && exampleEnEl && exampleViEl) {
    if (exampleEn) {
      renderHighlightedSentence(exampleEnEl, exampleEn, wordText);
      exampleViEl.textContent = exampleVi;
      exampleViEl.hidden = !exampleVi;
      exampleBox.hidden = false;
    } else {
      exampleBox.hidden = true;
    }
  }

  const explanationText = String(item.explanation || '').trim();
  const explanationIsPosOnly = /^\([^()]{1,20}\)$/.test(explanationText);
  const details = [
    item.synonyms ? `Đồng nghĩa: ${item.synonyms}` : '',
    item.antonyms ? `Trái nghĩa: ${item.antonyms}` : '',
    explanationText && !explanationIsPosOnly ? `Giải thích: ${explanationText}` : ''
  ].filter(Boolean);
  document.getElementById('flashcard-details').textContent = details.join('\n');
  document.getElementById('flashcard-prev-btn').disabled = flashcardIndex === 0;
  document.getElementById('flashcard-next-btn').disabled = flashcardIndex === activeQuiz.length - 1;
  if (shouldSpeak && isVocabCard && !isReversedMode) speakFlashcard();
}

function flipFlashcard() {
  flashcardFlipped = !flashcardFlipped;
  document.getElementById('flashcard').classList.toggle('is-flipped', flashcardFlipped);
}

// --- SPRINT 12: Chế độ 🎭 Hội thoại thực chiến (Micro-Story & Roleplay) & Speaker Voices ---
function setStoryStatus(message, isVisible = true) {
  const statusEl = document.getElementById('story-status-msg');
  if (statusEl) {
    statusEl.textContent = message;
    statusEl.hidden = !isVisible || !message;
  }
  const skeletonEl = document.getElementById('story-loading-skeleton');
  if (skeletonEl) {
    skeletonEl.hidden = !(isVisible && isGeneratingStory);
  }
}

function renderStoryLineWithClozeOrHighlight(container, sentence, targetWords) {
  container.replaceChildren();
  const cleanSentence = String(sentence || '').trim();
  if (!cleanSentence) return;

  const words = (Array.isArray(targetWords) ? targetWords : [])
    .map((w) => String(w || '').trim())
    .filter(Boolean);
  if (!words.length) {
    container.textContent = cleanSentence;
    return;
  }

  const escapedList = words
    .sort((a, b) => b.length - a.length)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp(`(${escapedList.join('|')})`, 'gi');
  const parts = cleanSentence.split(regex);

  parts.forEach((part) => {
    if (!part) return;
    const isTarget = words.some((w) => w.toLowerCase() === part.toLowerCase());
    if (isTarget) {
      if (isStoryClozeMode) {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'story-cloze-input';
        input.dataset.answer = part;
        input.placeholder = `${part[0]}... (${part.length})`;
        input.autocomplete = 'off';
        input.spellcheck = false;
        container.appendChild(input);
      } else {
        const strong = document.createElement('strong');
        strong.textContent = part;
        container.appendChild(strong);
      }
    } else {
      container.appendChild(document.createTextNode(part));
    }
  });
}

function renderStoryView() {
  const titleEl = document.getElementById('story-scenario-title');
  const wordsBar = document.getElementById('story-target-words-bar');
  const dialogueList = document.getElementById('story-dialogue-list');
  const clozeActions = document.getElementById('story-cloze-actions');
  const clozeScore = document.getElementById('story-cloze-score');
  const roleplayBox = document.getElementById('story-roleplay-box');
  const promptEnEl = document.getElementById('story-roleplay-prompt-en');
  const promptViEl = document.getElementById('story-roleplay-prompt-vi');
  const toggleViBtn = document.getElementById('story-toggle-vi-btn');
  const toggleClozeBtn = document.getElementById('story-toggle-cloze-btn');

  if (!dialogueList || !currentStoryData) return;

  if (titleEl) {
    titleEl.textContent = currentStoryData.scenario_title || 'Hội thoại Thực chiến Đa Ngữ cảnh';
  }
  if (toggleViBtn) {
    const viSpan = toggleViBtn.querySelector('span');
    const viText = isStoryShowVi ? 'Ẩn nghĩa Việt' : 'Hiện nghĩa Việt';
    if (viSpan) viSpan.textContent = viText;
    else toggleViBtn.textContent = viText;
  }
  if (toggleClozeBtn) {
    const clozeSpan = toggleClozeBtn.querySelector('span');
    const clozeText = isStoryClozeMode ? 'Tắt Cloze' : 'Đục lỗ (Cloze)';
    if (clozeSpan) clozeSpan.textContent = clozeText;
    else toggleClozeBtn.textContent = clozeText;
  }

  if (wordsBar) {
    wordsBar.replaceChildren();
    const picked = Array.isArray(currentStoryData.pickedWords) ? currentStoryData.pickedWords : [];
    picked.forEach((w) => {
      const chip = document.createElement('span');
      chip.className = 'story-word-chip';
      chip.textContent = `${w.emoji ? `${w.emoji} ` : ''}${w.word}${w.pos ? ` (${w.pos})` : ''}: ${w.meaning}`;
      wordsBar.appendChild(chip);
    });
  }

  dialogueList.replaceChildren();
  clearSpeakerVoiceAssignments();
  const turns = Array.isArray(currentStoryData.dialogue) ? currentStoryData.dialogue : [];
  const defaultTargets = (currentStoryData.pickedWords || []).map((w) => w.word);

  turns.forEach((turn) => {
    const turnItem = document.createElement('div');
    turnItem.className = 'story-turn-item';

    const body = document.createElement('div');
    body.className = 'story-turn-body';

    const speaker = document.createElement('span');
    speaker.className = 'story-speaker-badge';
    speaker.textContent = turn.speaker || 'Speaker';

    const enP = document.createElement('p');
    enP.className = 'story-turn-en';
    const turnTargets = Array.isArray(turn.target_words) && turn.target_words.length
      ? turn.target_words
      : defaultTargets;
    renderStoryLineWithClozeOrHighlight(enP, turn.en, turnTargets);

    body.append(speaker, enP);

    if (turn.vi) {
      const viP = document.createElement('p');
      viP.className = 'story-turn-vi';
      viP.textContent = turn.vi;
      viP.hidden = !isStoryShowVi;
      body.appendChild(viP);
    }

    const speakTurnBtn = document.createElement('button');
    speakTurnBtn.type = 'button';
    speakTurnBtn.className = 'speaker-btn-pill is-compact';
    speakTurnBtn.textContent = '🔊';
    speakTurnBtn.title = `Nghe câu của ${turn.speaker || 'Speaker'} (${getStorySpeechRate()}x)`;
    speakTurnBtn.addEventListener('click', () => {
      stopSpeechSequence();
      turnItem.classList.add('is-speaking-turn');
      speakSingleUtterance(turn.en, turn.speaker, getStorySpeechRate(), () => {
        turnItem.classList.remove('is-speaking-turn');
      });
    });

    turnItem.append(body, speakTurnBtn);
    dialogueList.appendChild(turnItem);
  });

  if (clozeActions) {
    clozeActions.hidden = !isStoryClozeMode;
    if (clozeScore) clozeScore.textContent = '';
  }

  if (roleplayBox && promptEnEl && promptViEl) {
    promptEnEl.textContent = currentStoryData.roleplay_prompt_en || '';
    promptViEl.textContent = currentStoryData.roleplay_prompt_vi || '';
    roleplayBox.hidden = !currentStoryData.roleplay_prompt_en;
  }
}

function buildFallbackDialogueFromCards(pickedCards, pickedWords, topicName) {
  const speakers = ['Alex', 'Sam'];
  const resolvedTopic = topicName && topicName !== 'ALL' ? topicName : 'General English';
  const dialogue = [];

  pickedCards.slice(0, 6).forEach((card, idx) => {
    const info = pickedWords[idx] || {};
    const word = info.word || getVocabWord(card);
    if (!word) return;
    const meaning = info.meaning || 'nghĩa quan trọng';
    const existingEn = String(card?.example_en || card?.contextSentence || card?.example || '').trim();
    const existingVi = String(card?.example_vi || card?.exampleVi || '').trim();
    const speaker = speakers[idx % 2];

    let enLine = existingEn;
    let viLine = existingVi;

    if (!enLine || !enLine.toLowerCase().includes(word.toLowerCase())) {
      if (idx === 0) {
        enLine = `Hey Sam! When we talk about ${resolvedTopic}, I always think of "${word}".`;
        viLine = `Này Sam! Khi bàn về ${resolvedTopic}, mình luôn nghĩ ngay tới từ "${word}" (${meaning}).`;
      } else if (idx % 2 === 1) {
        enLine = `Me too! Knowing how to use "${word}" makes everyday conversations much more natural.`;
        viLine = `Mình cũng vậy! Biết cách dùng "${word}" (${meaning}) giúp giao tiếp hàng ngày tự nhiên hơn nhiều.`;
      } else {
        enLine = `Exactly, and in this situation, "${word}" is the most accurate expression we can choose.`;
        viLine = `Chính xác, và trong tình huống này thì "${word}" (${meaning}) là cách diễn đạt chuẩn nhất.`;
      }
    } else if (!viLine) {
      viLine = `(${word}: ${meaning})`;
    }

    dialogue.push({
      speaker,
      en: enLine,
      vi: viLine,
      target_words: [word]
    });
  });

  const sampleTargets = pickedWords.slice(0, 4).map((w) => w.word);
  return {
    scenario_title: `Practical Roleplay: ${resolvedTopic} (Hội thoại thực hành)`,
    topic: resolvedTopic,
    dialogue,
    roleplay_prompt_en: `Your turn! Write 1-2 sentences sharing your own thoughts on "${resolvedTopic}" using at least one word from: ${sampleTargets.join(', ')}.`,
    roleplay_prompt_vi: `Đến lượt bạn! Hãy viết 1–2 câu tiếng Anh phản hồi tình huống trên, sử dụng ít nhất 1 từ trong nhóm (${sampleTargets.join(', ')}).`,
    pickedWords,
    topicKey: selectedTopicFilter
  };
}

const STORY_BATCH_SIZE = 6;
let currentStoryBatchIndex = 0;
let lastStoryTopicForBatch = '';
const storyBatchCache = new Map();
const MAX_STORY_BATCH_CACHE = 20;

function getPrioritizedStoryCards() {
  if (!Array.isArray(activeQuiz) || !activeQuiz.length) return [];
  // Ưu tiên đẩy các từ chưa thuộc (Box 0–1) lên các cụm đầu để học đúng từ yếu trước
  return activeQuiz
    .map((card, originalIndex) => {
      const boxVal = Number(card?.leitnerBox ?? card?.srsBox ?? card?.box);
      const priority = Number.isFinite(boxVal) ? boxVal : 0;
      return { card, originalIndex, priority };
    })
    .sort((a, b) => (a.priority !== b.priority ? a.priority - b.priority : a.originalIndex - b.originalIndex))
    .map((item) => item.card);
}

function syncStoryBatchSelector(totalWords) {
  const batchSelect = document.getElementById('story-batch-select');
  const totalBatches = Math.max(1, Math.ceil(totalWords / STORY_BATCH_SIZE));
  if (currentStoryBatchIndex >= totalBatches) {
    currentStoryBatchIndex = 0;
  }
  if (!batchSelect) return totalBatches;

  if (totalBatches <= 1) {
    batchSelect.hidden = true;
    batchSelect.replaceChildren();
    return totalBatches;
  }

  batchSelect.hidden = false;
  batchSelect.replaceChildren();
  for (let i = 0; i < totalBatches; i += 1) {
    const startNum = i * STORY_BATCH_SIZE + 1;
    const endNum = Math.min(totalWords, (i + 1) * STORY_BATCH_SIZE);
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = `Cụm ${i + 1}/${totalBatches} (Từ ${startNum}–${endNum})`;
    batchSelect.appendChild(opt);
  }
  batchSelect.value = String(currentStoryBatchIndex);
  return totalBatches;
}

async function generateAndRenderStory(forceRegenerate = false) {
  if (isGeneratingStory || !activeQuiz.length) return;

  if (lastStoryTopicForBatch !== selectedTopicFilter) {
    currentStoryBatchIndex = 0;
    lastStoryTopicForBatch = selectedTopicFilter;
  }

  const prioritizedCards = getPrioritizedStoryCards();
  const totalBatches = syncStoryBatchSelector(prioritizedCards.length);
  const requestTopicFilter = selectedTopicFilter;
  const requestBatchIndex = currentStoryBatchIndex;
  const startIdx = requestBatchIndex * STORY_BATCH_SIZE;
  const pickedCards = prioritizedCards.slice(startIdx, startIdx + STORY_BATCH_SIZE);

  const pickedWords = pickedCards
    .map((card) => {
      const options = normalizePracticeOptions(getSafeRawOptions(card));
      const correctOption = options.length > 0 ? findCorrectOption(card, options) : null;
      return {
        word: getVocabWord(card),
        pos: getVocabPos(card),
        meaning: getVocabMeaning(card, options, correctOption),
        emoji: String(card?.icon_emoji || '').trim()
      };
    })
    .filter((w) => w.word);

  if (!pickedWords.length) return;

  const batchKey = `${requestTopicFilter}::${requestBatchIndex}::${pickedWords.map((w) => w.word.toLowerCase()).join('|')}`;
  if (!forceRegenerate && storyBatchCache.has(batchKey)) {
    currentStoryData = storyBatchCache.get(batchKey);
    setStoryStatus('', false);
    renderStoryView();
    return;
  }

  if (currentStoryData && !forceRegenerate && currentStoryData.batchKey === batchKey) {
    setStoryStatus('', false);
    renderStoryView();
    return;
  }

  const topicName =
    requestTopicFilter !== 'ALL'
      ? requestTopicFilter
      : cleanTopicLabel(pickedCards[0]?.topic || quizTitle || 'General English');

  const batchSelectEl = document.getElementById('story-batch-select');
  const wasBatchSelectDisabled = Boolean(batchSelectEl?.disabled);
  const regenBtn = document.getElementById('story-regenerate-btn');
  const wasRegenBtnDisabled = Boolean(regenBtn?.disabled);

  isGeneratingStory = true;
  currentStoryData = null;
  setPracticeLogoProcessing(true);
  if (regenBtn) regenBtn.disabled = true;
  if (batchSelectEl) batchSelectEl.disabled = true;

  // Xóa nội dung hội thoại của cụm/chủ đề cũ ngay khi bắt đầu tạo mới để không hiển thị nhầm kết quả cũ
  const titleEl = document.getElementById('story-scenario-title');
  if (titleEl) titleEl.textContent = 'Hội thoại Thực chiến Đa Ngữ cảnh';
  const wordsBar = document.getElementById('story-target-words-bar');
  if (wordsBar) wordsBar.replaceChildren();
  const dialogueList = document.getElementById('story-dialogue-list');
  if (dialogueList) dialogueList.replaceChildren();
  const clozeActions = document.getElementById('story-cloze-actions');
  if (clozeActions) clozeActions.hidden = true;
  const clozeScore = document.getElementById('story-cloze-score');
  if (clozeScore) clozeScore.textContent = '';
  const roleplayBox = document.getElementById('story-roleplay-box');
  if (roleplayBox) roleplayBox.hidden = true;
  const pendingFeedbackEl = document.getElementById('story-roleplay-feedback');
  if (pendingFeedbackEl) pendingFeedbackEl.hidden = true;

  const batchPrefix = totalBatches > 1 ? `Cụm ${requestBatchIndex + 1}/${totalBatches} (` : '';
  const batchSuffix = totalBatches > 1 ? ')' : '';
  setStoryStatus(
    `⏳ AI đang ghép ${batchPrefix}${pickedWords.length} từ vựng${batchSuffix} chủ đề "${topicName}" thành kịch bản hội thoại thực chiến...`,
    true
  );

  let timeoutId = null;

  try {
    const { geminiApiKey } = await chrome.storage.local.get('geminiApiKey').catch(() => ({}));
    const cleanKey = String(geminiApiKey || '').trim();

    const controller = new AbortController();
    const storyTimeoutSeconds = Math.round(ENRICH_TIMEOUT_MS / 1000);
    timeoutId = setTimeout(
      () => controller.abort(new Error(`Quá thời gian chờ ${storyTimeoutSeconds} giây khi tạo hội thoại`)),
      ENRICH_TIMEOUT_MS
    );

    const response = await fetch(BACKEND_SYNTHESIZE_STORY_URL, {
      method: 'POST',
      headers: buildApiHeaders(cleanKey),
      signal: controller.signal,
      body: JSON.stringify({
        words: pickedWords.map(({ word, pos, meaning }) => ({ word, pos, meaning })),
        topic: topicName || 'General English',
        api_key: cleanKey
      })
    });

    const data = await response.json().catch(() => null);
    if (response.status === 429 || isQuotaOrRateLimitError(data?.detail)) {
      throw new Error(QUOTA_FALLBACK_GUIDANCE);
    }
    if (!response.ok || !Array.isArray(data?.dialogue) || !data.dialogue.length) {
      throw new Error(data?.detail || `HTTP ${response.status}`);
    }

    currentStoryData = {
      ...data,
      pickedWords,
      topicKey: requestTopicFilter,
      batchKey
    };
    if (storyBatchCache.has(batchKey)) storyBatchCache.delete(batchKey);
    storyBatchCache.set(batchKey, currentStoryData);
    while (storyBatchCache.size > MAX_STORY_BATCH_CACHE) {
      const oldestKey = storyBatchCache.keys().next().value;
      storyBatchCache.delete(oldestKey);
    }
    isGeneratingStory = false;
    if (selectedTopicFilter === requestTopicFilter) {
      currentStoryBatchIndex = requestBatchIndex;
      if (batchSelectEl && !batchSelectEl.hidden) batchSelectEl.value = String(requestBatchIndex);
    }
    setStoryStatus('', false);
    const feedbackEl = document.getElementById('story-roleplay-feedback');
    if (feedbackEl) feedbackEl.hidden = true;
    const roleplayInput = document.getElementById('story-roleplay-input');
    if (roleplayInput) roleplayInput.value = '';
    renderStoryView();
  } catch (error) {
    console.warn('Chuyển sang kịch bản hội thoại mẫu tương tác (buildFallbackDialogueFromCards):', error);
    isGeneratingStory = false;
    currentStoryData = {
      ...buildFallbackDialogueFromCards(pickedCards, pickedWords, topicName),
      topicKey: requestTopicFilter,
      batchKey
    };
    if (selectedTopicFilter === requestTopicFilter) {
      currentStoryBatchIndex = requestBatchIndex;
      if (batchSelectEl && !batchSelectEl.hidden) batchSelectEl.value = String(requestBatchIndex);
    }
    setStoryStatus(
      isQuotaOrRateLimitError(error?.message)
        ? QUOTA_FALLBACK_GUIDANCE
        : '💡 Đã tự động dựng kịch bản hội thoại tương tác từ bộ thẻ hiện tại để bạn luyện nghe, Cloze Mode & Roleplay ngay!',
      true
    );
    const feedbackEl = document.getElementById('story-roleplay-feedback');
    if (feedbackEl) feedbackEl.hidden = true;
    const roleplayInput = document.getElementById('story-roleplay-input');
    if (roleplayInput) roleplayInput.value = '';
    renderStoryView();
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
    isGeneratingStory = false;
    const skeletonEl = document.getElementById('story-loading-skeleton');
    if (skeletonEl) skeletonEl.hidden = true;
    if (!isEnrichingVocab) {
      setPracticeLogoProcessing(false);
    }
    if (regenBtn) regenBtn.disabled = wasRegenBtnDisabled;
    if (batchSelectEl) batchSelectEl.disabled = wasBatchSelectDisabled;
  }
}

function checkStoryClozeAnswers() {
  const inputs = Array.from(document.querySelectorAll('#story-dialogue-list .story-cloze-input'));
  const scoreEl = document.getElementById('story-cloze-score');
  if (!inputs.length || !scoreEl) return;

  let correct = 0;
  inputs.forEach((input) => {
    const userVal = normalizeDictationText(input.value);
    const targetVal = normalizeDictationText(input.dataset.answer || '');
    const isOk = Boolean(userVal && userVal === targetVal);
    input.classList.toggle('is-correct', isOk);
    input.classList.toggle('is-wrong', !isOk);
    if (isOk) correct += 1;
  });

  scoreEl.textContent =
    correct === inputs.length
      ? `🎉 Tuyệt vời! Bạn đã điền đúng toàn bộ ${correct}/${inputs.length} ô trống!`
      : `📊 Kết quả: Đúng ${correct}/${inputs.length} ô trống. Hãy sửa các ô màu đỏ nhé!`;
}

async function evaluateStoryRoleplayResponse() {
  const inputEl = document.getElementById('story-roleplay-input');
  const feedbackEl = document.getElementById('story-roleplay-feedback');
  const checkBtn = document.getElementById('story-roleplay-check-btn');
  if (!inputEl || !feedbackEl || !currentStoryData) return;

  const userSentence = inputEl.value.trim();
  if (!userSentence) {
    feedbackEl.textContent = '⚠️ Vui lòng nhập câu phản hồi tiếng Anh của bạn trước khi chấm điểm.';
    feedbackEl.hidden = false;
    return;
  }

  const { geminiApiKey } = await chrome.storage.local.get('geminiApiKey').catch(() => ({}));
  const cleanKey = String(geminiApiKey || '').trim();

  const targetWordsList = (currentStoryData.pickedWords || []).map((w) => w.word).join(', ');
  const meaningsList = (currentStoryData.pickedWords || [])
    .map((w) => `${w.word} (${w.meaning})`)
    .join('; ');

  if (checkBtn) checkBtn.disabled = true;
  feedbackEl.textContent = '⏳ AI đang chấm phản xạ tình huống của bạn...';
  feedbackEl.hidden = false;

  const controller = new AbortController();
  const roleplayTimeoutSeconds = Math.round(FETCH_TIMEOUT_MS / 1000);
  const timeoutId = setTimeout(
    () => controller.abort(new Error(`Quá thời gian chờ ${roleplayTimeoutSeconds} giây khi chấm phản xạ.`)),
    FETCH_TIMEOUT_MS
  );

  try {
    const response = await fetch(BACKEND_GRADE_SENTENCE_URL, {
      method: 'POST',
      headers: buildApiHeaders(cleanKey),
      signal: controller.signal,
      body: JSON.stringify({
        word: targetWordsList,
        pos: 'roleplay',
        meaning: meaningsList,
        user_sentence: userSentence,
        roleplay_prompt: currentStoryData.roleplay_prompt_en || '',
        api_key: cleanKey
      })
    });
    const data = await response.json().catch(() => null);
    if (response.status === 429 || isQuotaOrRateLimitError(data?.detail)) {
      feedbackEl.textContent = QUOTA_FALLBACK_GUIDANCE;
      return;
    }
    if (!response.ok) {
      throw new Error(data?.detail || `HTTP ${response.status}`);
    }
    feedbackEl.textContent = formatGradeSentenceFeedback(data);
  } catch (error) {
    const rawMsg = String(error?.message || '');
    if (isQuotaOrRateLimitError(rawMsg)) {
      feedbackEl.textContent = QUOTA_FALLBACK_GUIDANCE;
    } else if (error?.name === 'AbortError' || /quá thời gian chờ/i.test(rawMsg)) {
      feedbackEl.textContent = `⚠️ Quá thời gian chờ (${roleplayTimeoutSeconds} giây) khi chấm phản xạ. Vui lòng thử lại.`;
    } else if (error instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(rawMsg)) {
      feedbackEl.textContent = '⚠️ Không thể kết nối tới máy chủ xử lý. Vui lòng kiểm tra kết nối mạng hoặc dịch vụ Backend rồi thử lại.';
    } else {
      feedbackEl.textContent = `❌ Không thể chấm phản xạ lúc này: ${rawMsg}`;
    }
  } finally {
    clearTimeout(timeoutId);
    if (checkBtn) checkBtn.disabled = false;
  }
}

async function setPracticeMode(mode, persist = true) {
  stopSpeechSequence();
  // Tách biệt chế độ: bảng từ vựng cho phép 4 chế độ (flashcard | dictation | sentence | story), đề trắc nghiệm chỉ quiz
  const vocabModes = ['flashcard', 'dictation', 'sentence', 'story'];
  if (quizType === 'vocab') {
    activeMode = vocabModes.includes(mode) ? mode : 'flashcard';
  } else {
    activeMode = 'quiz';
  }
  updateModeButtons();
  syncWeakRetestButtonVisibility();
  syncVocabOverviewVisibility();
  document.getElementById('practice-result-panel').hidden = true;
  document.getElementById('quiz-mode-panel').hidden = activeMode !== 'quiz';
  document.getElementById('flashcard-mode-panel').hidden = activeMode !== 'flashcard';
  const dictationPanel = document.getElementById('dictation-mode-panel');
  if (dictationPanel) dictationPanel.hidden = activeMode !== 'dictation';
  const sentencePanel = document.getElementById('sentence-mode-panel');
  if (sentencePanel) sentencePanel.hidden = activeMode !== 'sentence';
  const storyPanel = document.getElementById('story-mode-panel');
  if (storyPanel) storyPanel.hidden = activeMode !== 'story';
  setProgress(activeMode === 'quiz' ? questionIndex + 1 : flashcardIndex + 1, activeQuiz.length);

  if (persist && window.practiceSession) {
    try {
      await chrome.storage.local.set({ activePracticeSession: { ...window.practiceSession, mode: activeMode } });
      window.practiceSession.mode = activeMode;
    } catch (error) {
      console.error('Không thể lưu chế độ luyện tập:', error);
    }
  }

  if (activeMode === 'quiz') {
    if (!activeQuiz.length) return;
    restartQuiz(originalQuiz);
  } else if (activeMode === 'dictation') {
    renderDictationCard(true);
  } else if (activeMode === 'sentence') {
    renderSentenceCard();
  } else if (activeMode === 'story') {
    void generateAndRenderStory(false);
  } else {
    renderFlashcard(quizType === 'vocab');
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  void initThemeManager(['practice-theme-selector']);
  document.getElementById('practice-exit-btn').addEventListener('click', () => window.close());
  document.getElementById('close-practice-btn').addEventListener('click', () => window.close());
  document.getElementById('countdown-skip-btn').addEventListener('click', skipCountdown);

  document.querySelectorAll('.mode-switch-btn').forEach((button) => {
    button.addEventListener('click', () => setPracticeMode(button.dataset.mode));
  });

  document.getElementById('practice-options').addEventListener('click', (event) => {
    const button = event.target.closest('.practice-option-btn');
    if (!button) return;
    const selected = normalizePracticeOptions(getSafeRawOptions(activeQuiz[questionIndex]))
      .find((option) => option.letter === button.dataset.letter);
    if (selected) selectAnswer(selected);
  });
  document.getElementById('practice-next-btn').addEventListener('click', () => {
    if (!answered) return;
    questionIndex += 1;
    if (questionIndex >= activeQuiz.length) {
      finishQuiz();
    } else {
      renderQuestion();
    }
  });
  document.getElementById('flashcard').addEventListener('click', (event) => {
    if (event.target.closest('#flashcard-speak-btn, #flashcard-speak-example-btn, #flashcard-seek-yt-btn')) return;
    flipFlashcard();
  });
  document.getElementById('flashcard').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      flipFlashcard();
    }
  });
  document.getElementById('flashcard-flip-btn').addEventListener('click', flipFlashcard);
  document.getElementById('flashcard-speak-btn').addEventListener('click', (event) => {
    event.stopPropagation();
    speakFlashcard();
  });
  const speakExampleBtn = document.getElementById('flashcard-speak-example-btn');
  if (speakExampleBtn) {
    speakExampleBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      speakFlashcardExample();
    });
  }
  const jumpSelect = document.getElementById('practice-card-jump');
  if (jumpSelect) {
    jumpSelect.addEventListener('change', () => {
      const targetIndex = Number(jumpSelect.value);
      if (Number.isInteger(targetIndex) && targetIndex >= 0 && targetIndex < activeQuiz.length) {
        flashcardIndex = targetIndex;
        renderFlashcard();
      }
    });
  }
  const reverseBtn = document.getElementById('flashcard-reverse-btn');
  if (reverseBtn) {
    reverseBtn.addEventListener('click', () => {
      isReversedMode = !isReversedMode;
      reverseBtn.textContent = isReversedMode ? '⇄ Đảo mặt (Anh → Việt)' : '⇄ Đảo mặt (Việt → Anh)';
      renderFlashcard(false);
    });
  }
  const enrichBtn = document.getElementById('flashcard-enrich-btn');
  if (enrichBtn) {
    enrichBtn.addEventListener('click', () => {
      // Nếu còn thẻ chưa có minh họa thì ưu tiên bổ sung đúng các thẻ còn thiếu trước (tránh gọi lại thừa các thẻ đã xong)
      const hasMissing = allVocabCards.some(
        (card) => !(String(card?.example_en || card?.contextSentence || '').trim() && String(card?.memory_hook || '').trim())
      );
      void enrichVocabInBatches(!hasMissing);
    });
  }
  const extractMoreBtn = document.getElementById('extract-more-video-vocab-btn');
  if (extractMoreBtn) {
    extractMoreBtn.addEventListener('click', () => {
      void extractMoreVocabFromVideo();
    });
  }
  const exportUnmasteredBtn = document.getElementById('export-unmastered-docx-btn');
  if (exportUnmasteredBtn) {
    exportUnmasteredBtn.addEventListener('click', () => {
      void exportUnmasteredVocabToDocx();
    });
  }
  const srsUnknownBtn = document.getElementById('srs-unknown-btn');
  if (srsUnknownBtn) {
    srsUnknownBtn.addEventListener('click', () => {
      void handleSrsMark(false);
    });
  }
  const srsKnownBtn = document.getElementById('srs-known-btn');
  if (srsKnownBtn) {
    srsKnownBtn.addEventListener('click', () => {
      void handleSrsMark(true);
    });
  }
  const flashcardSeekYtBtn = document.getElementById('flashcard-seek-yt-btn');
  if (flashcardSeekYtBtn) {
    flashcardSeekYtBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      const item = activeQuiz[flashcardIndex];
      if (item) void seekYoutubeOriginalSegment(getPrimarySourceMeta(item));
    });
  }

  // Sự kiện chế độ Nghe & Gõ điền từ (Dictation)
  const dictationSpeakWordBtn = document.getElementById('dictation-speak-word-btn');
  if (dictationSpeakWordBtn) {
    dictationSpeakWordBtn.addEventListener('click', () => {
      const item = activeQuiz[flashcardIndex];
      if (item) speakText(getVocabWord(item), 'en-US', 0.9);
    });
  }
  const dictationSpeakSentenceBtn = document.getElementById('dictation-speak-sentence-btn');
  if (dictationSpeakSentenceBtn) {
    dictationSpeakSentenceBtn.addEventListener('click', () => {
      const item = activeQuiz[flashcardIndex];
      const sentence = String(item?.contextSentence || item?.example_en || item?.example || '').trim();
      if (sentence) speakText(sentence, 'en-US', 0.9);
    });
  }
  const dictationSeekYtBtn = document.getElementById('dictation-seek-yt-btn');
  if (dictationSeekYtBtn) {
    dictationSeekYtBtn.addEventListener('click', () => {
      const item = activeQuiz[flashcardIndex];
      if (item) void seekYoutubeOriginalSegment(getPrimarySourceMeta(item));
    });
  }
  const dictationCheckBtn = document.getElementById('dictation-check-btn');
  if (dictationCheckBtn) dictationCheckBtn.addEventListener('click', checkDictationInput);
  const dictationHintBtn = document.getElementById('dictation-hint-btn');
  if (dictationHintBtn) dictationHintBtn.addEventListener('click', showDictationHint);
  const dictationInput = document.getElementById('dictation-input');
  if (dictationInput) {
    dictationInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        checkDictationInput();
      }
    });
  }
  const dictationPrevBtn = document.getElementById('dictation-prev-btn');
  if (dictationPrevBtn) {
    dictationPrevBtn.addEventListener('click', () => {
      if (flashcardIndex > 0) {
        flashcardIndex -= 1;
        renderDictationCard(true);
      }
    });
  }
  const dictationNextBtn = document.getElementById('dictation-next-btn');
  if (dictationNextBtn) {
    dictationNextBtn.addEventListener('click', () => {
      if (flashcardIndex < activeQuiz.length - 1) {
        flashcardIndex += 1;
        renderDictationCard(true);
      }
    });
  }

  // Sự kiện chế độ AI Sửa đặt câu
  const sentenceCheckBtn = document.getElementById('sentence-check-btn');
  if (sentenceCheckBtn) {
    sentenceCheckBtn.addEventListener('click', () => {
      void evaluateUserSentence();
    });
  }
  const sentencePrevBtn = document.getElementById('sentence-prev-btn');
  if (sentencePrevBtn) {
    sentencePrevBtn.addEventListener('click', () => {
      if (flashcardIndex > 0) {
        flashcardIndex -= 1;
        renderSentenceCard();
      }
    });
  }
  const sentenceNextBtn = document.getElementById('sentence-next-btn');
  if (sentenceNextBtn) {
    sentenceNextBtn.addEventListener('click', () => {
      if (flashcardIndex < activeQuiz.length - 1) {
        flashcardIndex += 1;
        renderSentenceCard();
      }
    });
  }

  // Sự kiện chế độ 🎭 Hội thoại thực chiến (Micro-Story & Roleplay)
  const storyBatchSelect = document.getElementById('story-batch-select');
  if (storyBatchSelect) {
    storyBatchSelect.addEventListener('change', () => {
      if (isGeneratingStory || storyBatchSelect.disabled) {
        storyBatchSelect.value = String(currentStoryBatchIndex);
        return;
      }
      const nextIdx = Number(storyBatchSelect.value);
      if (!Number.isInteger(nextIdx) || nextIdx < 0) return;
      currentStoryBatchIndex = nextIdx;
      stopSpeechSequence();
      void generateAndRenderStory(false);
    });
  }
  const storyRegenerateBtn = document.getElementById('story-regenerate-btn');
  if (storyRegenerateBtn) {
    storyRegenerateBtn.addEventListener('click', () => {
      stopSpeechSequence();
      void generateAndRenderStory(true);
    });
  }
  const storySpeakAllBtn = document.getElementById('story-speak-all-btn');
  if (storySpeakAllBtn) {
    storySpeakAllBtn.addEventListener('click', () => {
      const turns = Array.isArray(currentStoryData?.dialogue) ? currentStoryData.dialogue : [];
      if (!turns.length) return;
      playDialogueSequence(turns, getStorySpeechRate());
    });
  }
  const stopDialogueBtn = document.getElementById('stop-dialogue-btn');
  if (stopDialogueBtn) {
    stopDialogueBtn.addEventListener('click', () => {
      stopSpeechSequence();
    });
  }
  document.querySelectorAll('#story-speed-group .story-speed-btn').forEach((speedBtn) => {
    speedBtn.addEventListener('click', () => {
      const parsedRate = Number(speedBtn.dataset.rate);
      if (![0.5, 1, 2].includes(parsedRate)) return;
      setStorySpeechRate(parsedRate);
      document.querySelectorAll('#story-speed-group .story-speed-btn').forEach((btn) => {
        btn.classList.toggle('active', btn === speedBtn);
      });
      if (getIsPlayingDialogue()) {
        const turns = Array.isArray(currentStoryData?.dialogue) ? currentStoryData.dialogue : [];
        playDialogueSequence(turns, getStorySpeechRate());
      }
    });
  });
  const storyToggleViBtn = document.getElementById('story-toggle-vi-btn');
  if (storyToggleViBtn) {
    storyToggleViBtn.addEventListener('click', () => {
      isStoryShowVi = !isStoryShowVi;
      renderStoryView();
    });
  }
  const storyToggleClozeBtn = document.getElementById('story-toggle-cloze-btn');
  if (storyToggleClozeBtn) {
    storyToggleClozeBtn.addEventListener('click', () => {
      isStoryClozeMode = !isStoryClozeMode;
      renderStoryView();
    });
  }
  const storyCheckClozeBtn = document.getElementById('story-check-cloze-btn');
  if (storyCheckClozeBtn) {
    storyCheckClozeBtn.addEventListener('click', checkStoryClozeAnswers);
  }
  const storySpeakPromptBtn = document.getElementById('story-speak-prompt-btn');
  if (storySpeakPromptBtn) {
    storySpeakPromptBtn.addEventListener('click', () => {
      if (currentStoryData?.roleplay_prompt_en) {
        stopSpeechSequence();
        speakSingleUtterance(currentStoryData.roleplay_prompt_en, 'Narrator', getStorySpeechRate());
      }
    });
  }
  const storyRoleplayCheckBtn = document.getElementById('story-roleplay-check-btn');
  if (storyRoleplayCheckBtn) {
    storyRoleplayCheckBtn.addEventListener('click', () => {
      void evaluateStoryRoleplayResponse();
    });
  }
  window.addEventListener('beforeunload', () => {
    stopSpeechSequence();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && getIsPlayingDialogue()) {
      stopSpeechSequence();
    }
  });

  // Đồng bộ thời gian thực vocabBank / geminiApiKey giữa các tab
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes.geminiApiKey && quizType === 'vocab' && !isEnrichingVocab) {
      void enrichVocabInBatches(false);
    }
  });
  document.getElementById('flashcard-prev-btn').addEventListener('click', () => {
    if (flashcardIndex > 0) {
      flashcardIndex -= 1;
      renderFlashcard();
    }
  });
  document.getElementById('flashcard-next-btn').addEventListener('click', () => {
    if (flashcardIndex < activeQuiz.length - 1) {
      flashcardIndex += 1;
      renderFlashcard();
    }
  });
  document.getElementById('retry-all-btn').addEventListener('click', () => restartQuiz(originalQuiz));
  document.getElementById('retry-wrong-btn').addEventListener('click', () => {
    const wrongQuestions = results.filter((result) => result && !result.isCorrect).map((result) => result.item);
    if (wrongQuestions.length) restartQuiz(wrongQuestions);
  });

  document.addEventListener('keydown', (event) => {
    const countdownOverlay = document.getElementById('practice-countdown-overlay');
    if ((countdownOverlay && !countdownOverlay.hidden) || event.altKey || event.ctrlKey || event.metaKey) return;
    const activeTag = document.activeElement?.tagName;
    if (activeTag === 'SELECT' || activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;

    if (activeMode === 'quiz') {
      if (event.key === 'Enter' || event.key === 'ArrowRight') {
        if (answered) document.getElementById('practice-next-btn').click();
        return;
      }
      if (answered) return;
      const key = event.key.toUpperCase();
      const options = normalizePracticeOptions(getSafeRawOptions(activeQuiz[questionIndex]));
      const option = /^[1-6]$/.test(event.key)
        ? options[Number(event.key) - 1]
        : options.find((entry) => entry.letter === key);
      if (option) selectAnswer(option);
    } else if (activeMode === 'flashcard') {
      if (event.key === ' ') {
        event.preventDefault();
        flipFlashcard();
      } else if (event.key === 'r' || event.key === 'R') {
        event.preventDefault();
        speakFlashcard();
      } else if (event.key === 'ArrowLeft' && flashcardIndex > 0) {
        flashcardIndex -= 1;
        renderFlashcard();
      } else if (event.key === 'ArrowRight' && flashcardIndex < activeQuiz.length - 1) {
        flashcardIndex += 1;
        renderFlashcard();
      }
    }
  });

  const weakRetestBtn = document.getElementById('practice-weak-retest-btn');
  if (weakRetestBtn) {
    weakRetestBtn.addEventListener('click', () => {
      void startWeakSpotRetest();
    });
  }

  const weakFilterInput = document.getElementById('weak-filter-input');
  if (weakFilterInput) {
    weakFilterInput.addEventListener('input', () => {
      applyWeakRetestFilter();
    });
  }
  const weakSeveritySelect = document.getElementById('weak-severity-select');
  if (weakSeveritySelect) {
    weakSeveritySelect.addEventListener('change', () => {
      applyWeakRetestFilter();
    });
  }
  const weakResetAllBtn = document.getElementById('weak-reset-all-btn');
  if (weakResetAllBtn) {
    weakResetAllBtn.addEventListener('click', () => {
      void handleResetAllWeakQuestions();
    });
  }

  const aiExplainBtn = document.getElementById('practice-ai-explain-btn');
  if (aiExplainBtn) {
    aiExplainBtn.addEventListener('click', () => {
      void generateOnDemandQuizExplanation();
    });
  }

  const cram5MinBtn = document.getElementById('cram-5min-btn');
  if (cram5MinBtn) {
    cram5MinBtn.addEventListener('click', () => {
      startCram5MinMode();
    });
  }
  const cramClusterBtn = document.getElementById('cram-cluster-btn');
  if (cramClusterBtn) {
    cramClusterBtn.addEventListener('click', () => {
      startCramClusterMode();
    });
  }
  const cramClusterSelect = document.getElementById('cram-cluster-select');
  if (cramClusterSelect) {
    cramClusterSelect.addEventListener('change', () => {
      const idx = Number(cramClusterSelect.value);
      if (Number.isInteger(idx) && cramClusters[idx]) {
        activeQuiz = [...cramClusters[idx].cards];
        refreshActiveVocabView();
        showSrsToast(`🧩 Đang ôn ${cramClusters[idx].label}`);
      }
    });
  }
  const cramExitBtn = document.getElementById('cram-exit-btn');
  if (cramExitBtn) {
    cramExitBtn.addEventListener('click', () => {
      exitCramMode();
    });
  }

  const exportRoadmapBtn = document.getElementById('export-roadmap-docx-btn');
  if (exportRoadmapBtn) {
    exportRoadmapBtn.addEventListener('click', () => {
      void exportStudyRoadmapDocx();
    });
  }

  const toggleAnalyticsBtn = document.getElementById('toggle-analytics-btn');
  const analyticsDetails = document.getElementById('analytics-dashboard-details');
  if (toggleAnalyticsBtn && analyticsDetails) {
    const syncAnalyticsToggleUi = (isVisible) => {
      analyticsDetails.hidden = !isVisible;
      analyticsDetails.open = isVisible;
      toggleAnalyticsBtn.classList.toggle('active', isVisible);
      toggleAnalyticsBtn.setAttribute('aria-expanded', String(isVisible));
    };

    toggleAnalyticsBtn.addEventListener('click', () => {
      const nextVisible = analyticsDetails.hidden;
      syncAnalyticsToggleUi(nextVisible);
      if (nextVisible) {
        void renderAnalyticsDashboard();
      }
    });

    analyticsDetails.addEventListener('toggle', () => {
      if (!analyticsDetails.open && !analyticsDetails.hidden) {
        syncAnalyticsToggleUi(false);
      }
    });
  }

  if (chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      if (changes.vocabBank || changes.studyStreak || changes.quizScoreHistory || changes.quizWeakStats) {
        void renderAnalyticsDashboard();
      }
    });
  }
  void renderAnalyticsDashboard();

  try {
    const { activePracticeSession } = await chrome.storage.local.get('activePracticeSession');
    if (!activePracticeSession || !Array.isArray(activePracticeSession.quiz) || !activePracticeSession.quiz.length) {
      throw new Error('Không tìm thấy bộ đề cần luyện tập. Hãy quay lại Side Panel và tạo bộ đề mới.');
    }
    window.practiceSession = activePracticeSession;
    quizTitle = String(activePracticeSession.title || quizTitle);
    quizType = String(activePracticeSession.quiz_type || 'standard');
    originalQuiz = activePracticeSession.quiz;
    allVocabCards = [...originalQuiz];
    selectedTopicFilter = 'ALL';
    activeQuiz = originalQuiz;
    document.getElementById('practice-title').textContent = quizTitle;
    document.title = `${quizTitle} | Smart Study`;
    questionIndex = 0;
    flashcardIndex = 0;

    // Ép chế độ theo loại bộ đề: vocab hiển thị 4 chế độ học Tiếng Anh (ẩn quiz); quiz chỉ hiển thị quiz
    const isVocabSession = quizType === 'vocab';
    document.querySelectorAll('.mode-switch-btn').forEach((btn) => {
      const btnMode = btn.dataset.mode;
      const shouldShow = isVocabSession
        ? btnMode === 'flashcard' || btnMode === 'dictation' || btnMode === 'sentence' || btnMode === 'story'
        : btnMode === 'quiz';
      btn.hidden = !shouldShow;
      btn.style.display = shouldShow ? '' : 'none';
    });
    window.practiceSession.mode = isVocabSession ? 'flashcard' : 'quiz';

    if (isVocabSession) {
      activeMode = 'flashcard';
      updateModeButtons();
      syncWeakRetestButtonVisibility();
      document.getElementById('quiz-mode-panel').hidden = true;
      document.getElementById('flashcard-mode-panel').hidden = false;
      const dPanel = document.getElementById('dictation-mode-panel');
      if (dPanel) dPanel.hidden = true;
      const sPanel = document.getElementById('sentence-mode-panel');
      if (sPanel) sPanel.hidden = true;
      const stPanel = document.getElementById('story-mode-panel');
      if (stPanel) stPanel.hidden = true;
      const extractMoreBtnEl = document.getElementById('extract-more-video-vocab-btn');
      if (extractMoreBtnEl) {
        extractMoreBtnEl.hidden = !String(activePracticeSession.transcript || '').trim();
      }
      void renderAnalyticsDashboard();
      renderTopicPills();
      renderCardJumpOptions();
      syncVocabOverviewVisibility();
      // Hiển thị sẵn thẻ đầu tiên trong 0ms, chạy nền làm giàu 15 thẻ/lượt và chạy đếm ngược đồng bộ
      renderFlashcard(false);
      void enrichVocabInBatches(false);
      void startUnifiedCountdown('flashcard');
    } else {
      activeMode = 'quiz';
      syncWeakRetestButtonVisibility();
      const masteryCard = document.getElementById('vocab-mastery-progress-card');
      if (masteryCard) masteryCard.hidden = true;
      renderQuestion();
      document.getElementById('flashcard-mode-panel').hidden = true;
      updateModeButtons();
      void startUnifiedCountdown('quiz');
    }
  } catch (error) {
    const errorPanel = document.getElementById('practice-load-error');
    errorPanel.textContent = error.message;
    errorPanel.hidden = false;
    document.getElementById('quiz-mode-panel').hidden = true;
    document.getElementById('flashcard-mode-panel').hidden = true;
  }
});
