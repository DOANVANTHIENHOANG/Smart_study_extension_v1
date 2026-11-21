// Tập trung hóa URL Backend: đổi sang https://<ten-service>.onrender.com khi deploy lên Render
export const API_BASE_URL = 'http://127.0.0.1:8000';
export const BACKEND_FETCH_TIMEOUT_MS = 65000;
export const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

export function normalizePracticeOptions(rawOptions) {
  if (Array.isArray(rawOptions)) {
    return rawOptions
      .slice(0, 6)
      .map((value, index) => {
        const raw = String(value ?? '').trim();
        return {
          letter: OPTION_LETTERS[index],
          text: raw.replace(/^[A-F][.):\-]\s*/i, '').trim() || raw
        };
      })
      .filter((option) => option.text);
  }
  if (rawOptions && typeof rawOptions === 'object') {
    return OPTION_LETTERS
      .filter((letter) => rawOptions[letter] !== undefined || rawOptions[letter.toLowerCase()] !== undefined)
      .map((letter) => {
        const raw = String(rawOptions[letter] ?? rawOptions[letter.toLowerCase()] ?? '').trim();
        return {
          letter,
          text: raw.replace(new RegExp(`^${letter}[.):\\-]\\s*`, 'i'), '').trim() || raw
        };
      })
      .filter((option) => option.text);
  }
  return [];
}

export function getSafeRawOptions(item) {
  if (!item || item.options === null || item.options === undefined) return [];
  if (Array.isArray(item.options)) return item.options;
  if (typeof item.options === 'object') return item.options;
  return [];
}

export function findCorrectOption(item, options) {
  const safeOptions = Array.isArray(options) ? options : [];
  if (!safeOptions.length) return null;
  const answer = String(item?.correct_answer ?? item?.answer ?? '').trim();
  if (!answer) return null;
  const answerUpper = answer.toUpperCase();
  const byLetter = safeOptions.find(
    (option) =>
      answerUpper === option.letter ||
      answerUpper.startsWith(`${option.letter}.`) ||
      answerUpper.startsWith(`${option.letter})`) ||
      answerUpper.startsWith(`${option.letter}:`) ||
      new RegExp(`^(?:ĐÁP ÁN|ANSWER)\\s*${option.letter}\\b`, 'i').test(answer)
  );
  if (byLetter) return byLetter;
  const cleanAnswer = answer.replace(/^[A-F][.):\-]\s*/i, '').trim().toLowerCase();
  return safeOptions.find((option) => option.text.toLowerCase() === cleanAnswer) || null;
}

export function splitVocabQuestion(item) {
  const rawQuestion = String(item?.question || item?.front || '').trim();
  const match = rawQuestion.match(/^(.*?)\s*\(([^()]{1,20})\)\s*$/);
  return match
    ? { word: match[1].trim(), pos: match[2].trim() }
    : { word: rawQuestion, pos: '' };
}

export function getVocabWord(item) {
  const raw = String(item?.word || splitVocabQuestion(item).word || '').trim();
  return raw.replace(/\s*\([^()]{1,20}\)\s*$/, '').trim();
}

export function getVocabPos(item) {
  if (typeof item?.pos === 'string' && item.pos.trim()) {
    return item.pos.trim().replace(/^\((.*)\)$/, '$1').trim();
  }
  const fromQuestion = splitVocabQuestion(item).pos;
  if (fromQuestion) return fromQuestion;
  const explanationMatch = String(item?.explanation || '').trim().match(/^\(([^()]{1,20})\)$/);
  return explanationMatch ? explanationMatch[1].trim() : '';
}

export function getVocabMeaning(item, options, correctOption) {
  const direct = String(item?.meaning_vi || item?.meaning || item?.back || '').trim();
  if (direct) return direct;
  const answer = String(item?.correct_answer ?? item?.answer ?? '').trim();
  if (answer && !/^[A-F]$/i.test(answer)) return answer;
  return String(correctOption?.text || answer || '').trim();
}

export class VocabStorageManager {
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

  async getUnmasteredList() {
    const list = await this.getAll();
    return list.filter((entry) => entry && Number(entry.masteryLevel || 0) < 4);
  }

  async getMasteryBreakdown() {
    const list = await this.getAll();
    let box0 = 0;
    let box1To3 = 0;
    let mastered = 0;
    list.forEach((entry) => {
      if (!entry) return;
      const lvl = Math.max(0, Math.min(4, Number(entry.masteryLevel || 0)));
      if (lvl === 0) {
        box0 += 1;
      } else if (lvl >= 4) {
        mastered += 1;
      } else {
        box1To3 += 1;
      }
    });
    const total = box0 + box1To3 + mastered;
    return {
      total,
      box0,
      box1: box1To3,
      mastered,
      pctBox0: total ? Math.round((box0 / total) * 100) : 0,
      pctBox1: total ? Math.round((box1To3 / total) * 100) : 0,
      pctMastered: total ? Math.round((mastered / total) * 100) : 0
    };
  }

  async upsertUnknown(item, sourceMeta = null) {
    const list = await this.getAll();
    const word = getVocabWord(item);
    const pos = getVocabPos(item);
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
    const options = normalizePracticeOptions(getSafeRawOptions(item));
    const correctOption = options.length > 0 ? findCorrectOption(item, options) : null;
    const meaning = getVocabMeaning(item, options, correctOption);
    const contextSentence = String(item?.contextSentence || item?.example_en || item?.example || '').trim();
    const exampleVi = String(item?.example_vi || item?.exampleVi || '').trim();
    const ipa = String(item?.ipa || '').trim();
    const topic = String(item?.topic || '').trim();
    const visualCategory = String(item?.visual_category || item?.visualCategory || '').trim();
    const iconEmoji = String(item?.icon_emoji || item?.iconEmoji || '').trim();
    const visualLabel = String(item?.visual_label || item?.visualLabel || '').trim();
    const memoryHook = String(item?.memory_hook || item?.memoryHook || '').trim();
    const svgSketch = String(item?.svg_sketch || item?.svgSketch || '').trim();

    if (existingIdx >= 0) {
      const existing = { ...list[existingIdx] };
      if (ipa) existing.ipa = ipa;
      if (meaning) existing.meaning = meaning;
      if (contextSentence) {
        existing.contextSentence = contextSentence;
        existing.example_en = contextSentence;
      }
      if (exampleVi) {
        existing.exampleVi = exampleVi;
        existing.example_vi = exampleVi;
      }
      if (topic) existing.topic = topic;
      if (visualCategory) existing.visual_category = visualCategory;
      if (iconEmoji) existing.icon_emoji = iconEmoji;
      if (visualLabel) existing.visual_label = visualLabel;
      if (memoryHook) existing.memory_hook = memoryHook;
      if (!existing.svgSketch && svgSketch) existing.svgSketch = svgSketch;

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
      ipa,
      meaning,
      contextSentence,
      example_en: contextSentence,
      exampleVi,
      example_vi: exampleVi,
      topic,
      visual_category: visualCategory,
      icon_emoji: iconEmoji,
      visual_label: visualLabel,
      memory_hook: memoryHook,
      svgSketch,
      masteryLevel: 0,
      nextReviewAt: now,
      sources: incomingSource ? [incomingSource] : []
    };
    list.unshift(newRecord);
    await this.saveAll(list);
    return newRecord;
  }

  async markKnown(item, sourceMeta = null) {
    const list = await this.getAll();
    const word = getVocabWord(item);
    const pos = getVocabPos(item);
    if (!word) return null;

    const id = VocabStorageManager.makeKey(word, pos);
    const now = Date.now();
    const existingIdx = list.findIndex((entry) => entry?.id === id);

    if (existingIdx >= 0) {
      const existing = { ...list[existingIdx] };
      const currentLevel = Math.max(0, Math.min(4, Number(existing.masteryLevel || 0)));
      const nextLevel = Math.min(4, currentLevel + 1);
      const intervalDays = VocabStorageManager.LEITNER_INTERVALS_DAYS[nextLevel] || 14;
      if (item?.topic) existing.topic = String(item.topic).trim();
      if (item?.visual_category) existing.visual_category = String(item.visual_category).trim();
      if (item?.icon_emoji) existing.icon_emoji = String(item.icon_emoji).trim();
      if (item?.visual_label) existing.visual_label = String(item.visual_label).trim();
      if (item?.memory_hook) existing.memory_hook = String(item.memory_hook).trim();
      existing.masteryLevel = nextLevel;
      existing.nextReviewAt = now + intervalDays * VocabStorageManager.DAY_MS;
      list[existingIdx] = existing;
      await this.saveAll(list);
      return existing;
    }

    const options = normalizePracticeOptions(getSafeRawOptions(item));
    const correctOption = options.length > 0 ? findCorrectOption(item, options) : null;
    const contextSentence = String(item?.contextSentence || item?.example_en || item?.example || '').trim();
    const exampleVi = String(item?.example_vi || item?.exampleVi || '').trim();
    const newRecord = {
      id,
      word,
      pos,
      ipa: String(item?.ipa || '').trim(),
      meaning: getVocabMeaning(item, options, correctOption),
      contextSentence,
      example_en: contextSentence,
      exampleVi,
      example_vi: exampleVi,
      topic: String(item?.topic || '').trim(),
      visual_category: String(item?.visual_category || '').trim(),
      icon_emoji: String(item?.icon_emoji || '').trim(),
      visual_label: String(item?.visual_label || '').trim(),
      memory_hook: String(item?.memory_hook || '').trim(),
      svgSketch: String(item?.svg_sketch || item?.svgSketch || '').trim(),
      masteryLevel: 1,
      nextReviewAt: now + VocabStorageManager.LEITNER_INTERVALS_DAYS[1] * VocabStorageManager.DAY_MS,
      sources: sourceMeta ? [{ ...sourceMeta, addedAt: sourceMeta.addedAt || now }] : []
    };
    list.unshift(newRecord);
    await this.saveAll(list);
    return newRecord;
  }
}

export const vocabStorageManager = new VocabStorageManager();

export function getLocalDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function normalizeQuestionKey(questionText) {
  return String(questionText || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export async function recordStudyStreak() {
  const today = getLocalDateKey();
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = getLocalDateKey(yesterdayDate);

  const { studyStreak = { count: 0, lastStudyDate: '' } } = await chrome.storage.local
    .get('studyStreak')
    .catch(() => ({}));

  if (studyStreak?.lastStudyDate === today) {
    return studyStreak;
  }
  const nextCount = studyStreak?.lastStudyDate === yesterday ? Number(studyStreak.count || 0) + 1 : 1;
  const updated = { count: nextCount, lastStudyDate: today };
  await chrome.storage.local.set({ studyStreak: updated }).catch(() => {});
  return updated;
}

export async function recordQuizAttempt({ title, scorePercent, correctCount, totalCount }) {
  const { quizScoreHistory = [] } = await chrome.storage.local
    .get('quizScoreHistory')
    .catch(() => ({}));
  const list = Array.isArray(quizScoreHistory) ? [...quizScoreHistory] : [];
  list.push({
    date: getLocalDateKey(),
    timestamp: Date.now(),
    title: String(title || 'Bài Quiz').slice(0, 80),
    scorePercent: Math.max(0, Math.min(100, Number(scorePercent) || 0)),
    correctCount: Number(correctCount) || 0,
    totalCount: Number(totalCount) || 0
  });
  const trimmed = list.slice(-20);
  await chrome.storage.local.set({ quizScoreHistory: trimmed }).catch(() => {});
  return trimmed;
}

export function normalizeWeakQuestionOptions(rawOptions) {
  const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
  if (Array.isArray(rawOptions)) {
    return rawOptions
      .slice(0, 6)
      .map((item, idx) => {
        const raw =
          typeof item === 'object' && item !== null
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

export async function recordQuestionOutcome(item, isCorrect) {
  const qText = String(item?.question || '').trim();
  const key = normalizeQuestionKey(qText);
  if (!key) return;

  const { quizWeakStats = {} } = await chrome.storage.local
    .get('quizWeakStats')
    .catch(() => ({}));
  const stats = quizWeakStats && typeof quizWeakStats === 'object' ? { ...quizWeakStats } : {};
  const prev = stats[key];

  const currentOptions = normalizeWeakQuestionOptions(getSafeRawOptions(item));
  const fallbackPrevOptions = normalizeWeakQuestionOptions(prev?.options);
  const optionsToSave = currentOptions.length >= 2 ? currentOptions : fallbackPrevOptions;
  const imagesToSave = Array.isArray(item?.images)
    ? item.images
    : Array.isArray(prev?.images)
      ? prev.images
      : [];
  const correctAnswerToSave = String(item?.correct_answer ?? item?.answer ?? prev?.correct_answer ?? '').trim();
  const explanationToSave = String(item?.explanation ?? prev?.explanation ?? '').trim();

  if (!isCorrect) {
    stats[key] = {
      question: qText,
      options: optionsToSave,
      correct_answer: correctAnswerToSave,
      explanation: explanationToSave,
      images: imagesToSave,
      wrongCount: Math.ceil(Number(prev?.wrongCount || 0)) + 1,
      attempts: Number(prev?.attempts || 0) + 1,
      lastAttemptAt: Date.now()
    };
    await chrome.storage.local.set({ quizWeakStats: stats }).catch(() => {});
  } else if (prev) {
    const nextWrong = Math.floor(Number(prev.wrongCount || 0) - 1);
    if (nextWrong <= 0) {
      delete stats[key];
    } else {
      stats[key] = {
        ...prev,
        question: qText || String(prev.question || '').trim(),
        options: optionsToSave,
        correct_answer: correctAnswerToSave,
        explanation: explanationToSave,
        images: imagesToSave,
        wrongCount: nextWrong,
        attempts: Number(prev.attempts || 0) + 1,
        lastAttemptAt: Date.now()
      };
    }
    await chrome.storage.local.set({ quizWeakStats: stats }).catch(() => {});
  }
}

export async function clearAllWeakQuestions() {
  await chrome.storage.local.set({ quizWeakStats: {} }).catch(() => {});
}

export async function getWeightedWeakQuestions() {
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
      const qKey = normalizeQuestionKey(q?.question);
      if (!qKey || sourceMap.has(qKey)) return;
      const opts = normalizeWeakQuestionOptions(q?.options);
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

    let normalizedOptions = normalizeWeakQuestionOptions(entry.options);
    let updatedEntry = entry;

    if (normalizedOptions.length < 2) {
      const matched = sourceMap.get(normalizeQuestionKey(qText)) || sourceMap.get(key);
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
      const score = wrongCount / attempts + Math.random() * 0.15;
      return { entry, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((item) => item.entry);
}
