const FEMALE_SPEAKER_NAMES = new Set([
  'emma', 'clara', 'sophia', 'mia', 'chloe', 'sarah', 'anna', 'hannah', 'olivia', 'lucy', 'emily'
]);
const MALE_SPEAKER_NAMES = new Set([
  'alex', 'liam', 'noah', 'ethan', 'lucas', 'david', 'mark', 'james', 'ben', 'sam', 'ryan'
]);

const FEMALE_VOICE_HINTS =
  /(female|zira|aria|jenny|samantha|victoria|karen|moira|tessa|hazel|susan|sara|sonia|libby|natasha|linda|catherine|heather)/i;
const MALE_VOICE_HINTS =
  /(?:^|\b)(male|david|mark|guy|daniel|ryan|george|james|alex|fred|christopher|eric|steffan|liam|connor|richard)(?:\b|$)/i;

let cachedSpeechVoices = [];
let activeSpeechUtterance = null;
let isPlayingDialogue = false;
let storySpeechRate = 1;
const speakerVoiceAssignmentMap = new Map();

export function getIsPlayingDialogue() {
  return isPlayingDialogue;
}

export function getStorySpeechRate() {
  return storySpeechRate;
}

export function setStorySpeechRate(rate) {
  const parsed = Number(rate);
  if ([0.5, 1, 2].includes(parsed)) {
    storySpeechRate = parsed;
  }
  return storySpeechRate;
}

export function clearSpeakerVoiceAssignments() {
  speakerVoiceAssignmentMap.clear();
}

export function speakText(text, lang = 'en-US', rate = 1.0) {
  if (!('speechSynthesis' in window)) return;
  const cleanText = String(text || '').trim();
  if (!cleanText) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(cleanText);
  utterance.lang = lang;
  utterance.rate = rate;
  window.speechSynthesis.speak(utterance);
}

export function refreshVoices() {
  try {
    if (!('speechSynthesis' in window) || typeof window.speechSynthesis.getVoices !== 'function') {
      return [];
    }
    const allVoices = window.speechSynthesis.getVoices() || [];
    if (!allVoices.length) return cachedSpeechVoices;

    const enVoices = allVoices.filter((v) => /^en(-|_|$)/i.test(String(v?.lang || '')));
    enVoices.sort((a, b) => {
      const aScore = /^en[-_]US/i.test(a.lang) ? 0 : /^en[-_]GB/i.test(a.lang) ? 1 : 2;
      const bScore = /^en[-_]US/i.test(b.lang) ? 0 : /^en[-_]GB/i.test(b.lang) ? 1 : 2;
      return aScore - bScore;
    });

    cachedSpeechVoices = enVoices.length ? enVoices : [allVoices[0]].filter(Boolean);
    return cachedSpeechVoices;
  } catch (err) {
    console.warn('Không thể tải danh sách giọng đọc:', err);
    return cachedSpeechVoices;
  }
}

if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  refreshVoices();
  if ('onvoiceschanged' in window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = () => {
      refreshVoices();
    };
  }
}

export function resolveSpeakerVoice(speakerName) {
  try {
    const voices = cachedSpeechVoices.length ? cachedSpeechVoices : refreshVoices();
    if (!voices || !voices.length) return null;

    const rawName = String(speakerName || 'speaker').trim().toLowerCase();
    const firstToken = rawName.split(/[\s|/:,-]+/)[0] || rawName;

    if (speakerVoiceAssignmentMap.has(firstToken)) {
      const assigned = speakerVoiceAssignmentMap.get(firstToken);
      if (assigned && voices.includes(assigned)) {
        return assigned;
      }
    }

    const femaleVoices = voices.filter((v) => FEMALE_VOICE_HINTS.test(v.name));
    const maleVoices = voices.filter((v) => MALE_VOICE_HINTS.test(v.name) && !/female/i.test(v.name));
    const usedVoices = new Set(speakerVoiceAssignmentMap.values());

    const pickUnusedOrFirst = (pool) => {
      if (!pool.length) return null;
      return pool.find((v) => !usedVoices.has(v)) || pool[0];
    };

    let chosenVoice = null;
    if (FEMALE_SPEAKER_NAMES.has(firstToken)) {
      chosenVoice = pickUnusedOrFirst(femaleVoices) || pickUnusedOrFirst(voices);
    } else if (MALE_SPEAKER_NAMES.has(firstToken)) {
      chosenVoice = pickUnusedOrFirst(maleVoices) || pickUnusedOrFirst(voices);
    } else {
      const alternatePools =
        speakerVoiceAssignmentMap.size % 2 === 0
          ? [...femaleVoices, ...maleVoices, ...voices]
          : [...maleVoices, ...femaleVoices, ...voices];
      chosenVoice = pickUnusedOrFirst(alternatePools) || voices[speakerVoiceAssignmentMap.size % voices.length];
    }

    const finalVoice = chosenVoice || voices[0] || null;
    if (finalVoice) {
      speakerVoiceAssignmentMap.set(firstToken, finalVoice);
    }
    return finalVoice;
  } catch (err) {
    console.warn('Lỗi khi chọn giọng theo nhân vật:', err);
    return cachedSpeechVoices[0] || null;
  }
}

export function updateStoryPlaybackButtons() {
  const speakAllBtn = document.getElementById('story-speak-all-btn');
  const stopBtn = document.getElementById('stop-dialogue-btn');
  if (speakAllBtn) {
    const labelSpan = speakAllBtn.querySelector('span');
    if (labelSpan) {
      labelSpan.textContent = 'Nghe cả đoạn';
    } else {
      speakAllBtn.textContent = '🔊 Nghe cả đoạn';
    }
    speakAllBtn.classList.remove('is-playing-stop');
  }
  if (stopBtn) {
    stopBtn.hidden = !isPlayingDialogue;
  }
}

export function clearDialogueTurnHighlights() {
  document.querySelectorAll('#story-dialogue-list .story-turn-item.is-speaking-turn').forEach((el) => {
    el.classList.remove('is-speaking-turn');
  });
}

export function stopSpeechSequence() {
  isPlayingDialogue = false;
  activeSpeechUtterance = null;
  clearDialogueTurnHighlights();
  updateStoryPlaybackButtons();
  try {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  } catch (_) {}
}

export function speakSingleUtterance(text, speakerName, rate = storySpeechRate, onDone = null) {
  const safeDone = (() => {
    let called = false;
    return () => {
      if (called) return;
      called = true;
      if (typeof onDone === 'function') onDone();
    };
  })();

  try {
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance !== 'function') {
      safeDone();
      return;
    }
    const cleanText = String(text || '').trim();
    if (!cleanText) {
      safeDone();
      return;
    }

    const numericRate = [0.5, 1, 2].includes(Number(rate)) ? Number(rate) : 1;
    const utterance = new SpeechSynthesisUtterance(cleanText);
    const matchedVoice = resolveSpeakerVoice(speakerName);
    if (matchedVoice) {
      utterance.voice = matchedVoice;
      utterance.lang = matchedVoice.lang || 'en-US';
    } else {
      utterance.lang = 'en-US';
    }
    utterance.rate = numericRate;

    const rawName = String(speakerName || '').trim().toLowerCase().split(/[\s|/:,-]+/)[0] || '';
    if (FEMALE_SPEAKER_NAMES.has(rawName)) {
      utterance.pitch = 1.08;
    } else if (MALE_SPEAKER_NAMES.has(rawName)) {
      utterance.pitch = 0.94;
    }

    activeSpeechUtterance = utterance;
    utterance.onend = () => {
      if (activeSpeechUtterance === utterance) activeSpeechUtterance = null;
      safeDone();
    };
    utterance.onerror = () => {
      if (activeSpeechUtterance === utterance) activeSpeechUtterance = null;
      safeDone();
    };

    window.speechSynthesis.speak(utterance);
  } catch (err) {
    console.warn('Lỗi khi phát âm câu hội thoại:', err);
    safeDone();
  }
}

export function playDialogueSequence(lines, rate = storySpeechRate) {
  const validLines = Array.isArray(lines)
    ? lines.filter((item) => item && String(item.en || '').trim())
    : [];
  if (!validLines.length) return;

  try {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  } catch (_) {}

  clearDialogueTurnHighlights();
  isPlayingDialogue = true;
  updateStoryPlaybackButtons();

  const numericRate = [0.5, 1, 2].includes(Number(rate)) ? Number(rate) : storySpeechRate;
  const turnElements = Array.from(document.querySelectorAll('#story-dialogue-list .story-turn-item'));
  let currentIndex = 0;

  const playNextLine = () => {
    if (!isPlayingDialogue || currentIndex >= validLines.length) {
      isPlayingDialogue = false;
      activeSpeechUtterance = null;
      clearDialogueTurnHighlights();
      updateStoryPlaybackButtons();
      return;
    }

    const lineItem = validLines[currentIndex];
    const rowEl = turnElements[currentIndex];
    clearDialogueTurnHighlights();
    if (rowEl) {
      rowEl.classList.add('is-speaking-turn');
    }

    currentIndex += 1;
    speakSingleUtterance(lineItem.en, lineItem.speaker, numericRate, () => {
      if (!isPlayingDialogue) return;
      playNextLine();
    });
  };

  playNextLine();
}
