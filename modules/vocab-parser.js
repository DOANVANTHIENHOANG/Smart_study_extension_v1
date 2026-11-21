import { getVocabWord } from './storage-manager.js';

export const TOPIC_EMOJI_MAP = {
  food: '🍔',
  tech: '💻',
  nature: '🌿',
  business: '💼',
  health: '🩺',
  travel: '✈️',
  study: '🎓',
  abstract: '💡'
};

export function cleanTopicLabel(rawTopic) {
  const cleaned = String(rawTopic || '')
    .replace(/^(?:Chủ\s*đề|Topic)\s*\d*[:.\-–]?\s*/i, '')
    .trim();
  return cleaned || 'Chưa phân loại';
}

export function inferVisualCategoryFromCard(card) {
  const explicit = String(card?.visual_category || card?.visualCategory || '').trim().toLowerCase();
  if (TOPIC_EMOJI_MAP[explicit]) return explicit;
  const topicLower = String(card?.topic || '').toLowerCase();
  if (/(ẩm thực|đồ ăn|món ăn|thực phẩm|nấu ăn|food|drink)/i.test(topicLower)) return 'food';
  if (/(công nghệ|lập trình|máy tính|phần mềm|ai|tech)/i.test(topicLower)) return 'tech';
  if (/(thiên nhiên|môi trường|khí hậu|động vật|nature)/i.test(topicLower)) return 'nature';
  if (/(kinh doanh|tài chính|kinh tế|công việc|business)/i.test(topicLower)) return 'business';
  if (/(sức khỏe|y tế|thể thao|health)/i.test(topicLower)) return 'health';
  if (/(du lịch|văn hóa|di chuyển|travel)/i.test(topicLower)) return 'travel';
  if (/(học thuật|giáo dục|trường học|khoa học|study)/i.test(topicLower)) return 'study';
  return 'abstract';
}

/**
 * Hệ thống Minh họa 3 Tầng (Sprint 12):
 * 1. Tầng 1: Nếu có ảnh gốc đính kèm từ file Word (card.images?.length > 0), trả về node <img>.
 * 2. Tầng 2: Nếu không có ảnh gốc, dựng Composite Visual Mnemonic Card với bảng màu pastel theo visual_category,
 *    hiển thị icon_emoji cỡ lớn (42px) + visual_label sắc nét + khung "💡 Mẹo nhớ: memory_hook" ngay bên dưới.
 */
export function buildVisualMnemonicHtml(card) {
  const validImages = Array.isArray(card?.images)
    ? card.images.filter((img) => typeof img === 'string' && img.startsWith('data:image/'))
    : [];
  if (validImages.length > 0) {
    const imgEl = document.createElement('img');
    imgEl.src = validImages[0];
    imgEl.alt = `Minh họa ${getVocabWord(card)}`;
    return imgEl;
  }

  const iconEmoji = String(card?.icon_emoji || card?.iconEmoji || '').trim();
  const visualLabel = String(card?.visual_label || card?.visualLabel || '').trim();
  const memoryHook = String(card?.memory_hook || card?.memoryHook || '').trim();

  if (!iconEmoji && !visualLabel && !memoryHook) {
    return null;
  }

  const category = inferVisualCategoryFromCard(card);
  const wrapper = document.createElement('div');
  wrapper.className = 'visual-mnemonic-card';
  wrapper.dataset.category = category;

  const sceneRow = document.createElement('div');
  sceneRow.className = 'visual-mnemonic-scene';

  const emojiEl = document.createElement('span');
  emojiEl.className = 'visual-mnemonic-emoji';
  emojiEl.textContent = iconEmoji || TOPIC_EMOJI_MAP[category] || '💡✨';
  sceneRow.appendChild(emojiEl);

  if (visualLabel) {
    const labelEl = document.createElement('span');
    labelEl.className = 'visual-mnemonic-label';
    labelEl.textContent = visualLabel;
    sceneRow.appendChild(labelEl);
  }
  wrapper.appendChild(sceneRow);

  if (memoryHook) {
    const hookEl = document.createElement('div');
    hookEl.className = 'visual-mnemonic-hook';
    hookEl.textContent = `💡 Mẹo nhớ: ${memoryHook}`;
    wrapper.appendChild(hookEl);
  }

  return wrapper;
}

export function sanitizeSvgMarkup(rawSvg) {
  if (typeof rawSvg !== 'string' || !rawSvg.toLowerCase().includes('<svg')) return null;
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(rawSvg.trim(), 'image/svg+xml');
    if (doc.querySelector('parsererror')) return null;
    const svgEl = doc.querySelector('svg');
    if (!svgEl) return null;

    svgEl
      .querySelectorAll('script, iframe, object, embed, image, foreignObject')
      .forEach((node) => node.remove());

    const allNodes = [svgEl, ...svgEl.querySelectorAll('*')];
    allNodes.forEach((node) => {
      Array.from(node.attributes || []).forEach((attr) => {
        const name = attr.name.toLowerCase();
        const val = String(attr.value || '').trim().toLowerCase();
        if (name.startsWith('on') || val.includes('javascript:') || name === 'href' || name === 'xlink:href') {
          node.removeAttribute(attr.name);
        }
      });
    });

    if (!svgEl.getAttribute('viewBox')) {
      svgEl.setAttribute('viewBox', '0 0 240 120');
    }
    return document.importNode(svgEl, true);
  } catch (_) {
    return null;
  }
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

/**
 * Nhận diện cục bộ (0ms, không gọi API) danh sách từ vựng POS Tag
 * hỗ trợ cả "word (pos): meaning" và "word: meaning" / "word - meaning"
 */
export function parseLocalVocabPos(rawText, imagesByLineIndex = null) {
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

    const lineImages =
      imagesByLineIndex && Array.isArray(imagesByLineIndex.get(lineIdx))
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

/**
 * Phân tích đề trắc nghiệm có sẵn cục bộ (0ms)
 */
export function parseQuizLocally(rawText) {
  const questionStart = /^\s*(?:\*\*)?(?:Câu\s*\d+\s*[:.)-]?|Question\s*\d+\s*[:.)-]?|Q\.?\s*\d+\s*[:.)-]?|\d{1,3}\s*[.)])\s*(.*?)\s*(?:\*\*)?\s*$/i;
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

  for (const line of String(rawText || '').split(/\r?\n/)) {
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

  return quiz;
}
