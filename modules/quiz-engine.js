import {
  OPTION_LETTERS,
  normalizePracticeOptions,
  getSafeRawOptions,
  findCorrectOption,
  getWeightedWeakQuestions,
  clearAllWeakQuestions
} from './storage-manager.js';

export { getWeightedWeakQuestions, clearAllWeakQuestions };

export function filterWeakQuestionsList(weakQuestions, queryText = '', severity = 'ALL') {
  const list = Array.isArray(weakQuestions) ? weakQuestions : [];
  const cleanQuery = String(queryText || '').toLowerCase().trim();
  return list.filter((item) => {
    if (!item) return false;
    const wrongCount = Math.ceil(Number(item.wrongCount || 1));
    if (severity === 'HIGH' && wrongCount < 2) return false;
    if (severity === 'SINGLE' && wrongCount !== 1) return false;
    if (!cleanQuery) return true;
    const qText = String(item.question || '').toLowerCase();
    const optsText = Array.isArray(item.options) ? item.options.join(' ').toLowerCase() : '';
    const expText = String(item.explanation || '').toLowerCase();
    return qText.includes(cleanQuery) || optsText.includes(cleanQuery) || expText.includes(cleanQuery);
  });
}

/**
 * Xáo trộn mảng theo thuật toán Fisher-Yates (O(n), không thiên lệch)
 */
export function shuffleArrayFisherYates(items) {
  const copy = Array.isArray(items) ? [...items] : [];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function shuffleQuizQuestionsAndOptions(quizList) {
  const shuffledQuestions = shuffleArrayFisherYates(quizList);
  return shuffledQuestions.map((item) => {
    if (!item || typeof item !== 'object') return item;
    const options = normalizePracticeOptions(getSafeRawOptions(item));
    const correctOption = findCorrectOption(item, options);
    if (options.length < 2 || !correctOption) return { ...item };

    const shuffledOptions = shuffleArrayFisherYates(
      options.map((opt) => ({
        text: opt.text,
        isCorrect: opt.letter === correctOption.letter
      }))
    );

    const newOptions = Object.fromEntries(
      shuffledOptions.map((opt, idx) => [OPTION_LETTERS[idx], opt.text])
    );
    const newCorrect = OPTION_LETTERS[shuffledOptions.findIndex((opt) => opt.isCorrect)];
    return {
      ...item,
      options: newOptions,
      correct_answer: newCorrect
    };
  });
}

export function computeWeakQuestionScore(entry) {
  const attempts = Math.max(1, Number(entry?.attempts || 1));
  const wrongCount = Number(entry?.wrongCount || 0);
  return wrongCount / attempts + Math.random() * 0.15;
}

export function bindSvgTooltips(container) {
  const tooltip = document.getElementById('analytics-svg-tooltip');
  if (!container || !tooltip) return;
  container.querySelectorAll('[data-tooltip]').forEach((el) => {
    el.addEventListener('mousemove', (event) => {
      tooltip.textContent = el.getAttribute('data-tooltip') || '';
      tooltip.hidden = false;
      const offsetX = 14;
      const offsetY = 14;
      const maxLeft = window.innerWidth - tooltip.offsetWidth - 12;
      const left = Math.min(maxLeft, event.clientX + offsetX);
      const top = Math.max(12, event.clientY - tooltip.offsetHeight - offsetY);
      tooltip.style.left = `${Math.max(12, left)}px`;
      tooltip.style.top = `${top}px`;
    });
    el.addEventListener('mouseleave', () => {
      tooltip.hidden = true;
    });
  });
}

export function renderLeitnerSvgChart(vocabList) {
  const wrap = document.getElementById('svg-leitner-chart');
  if (!wrap) return;
  const counts = [0, 0, 0, 0, 0];
  (Array.isArray(vocabList) ? vocabList : []).forEach((entry) => {
    const lvl = Math.max(0, Math.min(4, Number(entry?.masteryLevel || 0)));
    counts[lvl] += 1;
  });

  const labels = ['Mới', '1d', '3d', '7d', '14d'];
  const descriptions = [
    'Box 0 (Mới / Chưa thuộc)',
    'Box 1 (Nhắc sau 1 ngày)',
    'Box 2 (Nhắc sau 3 ngày)',
    'Box 3 (Nhắc sau 7 ngày)',
    'Box 4 (Thành thạo — 14 ngày)'
  ];
  const colors = ['#ef4444', '#f59e0b', '#3b82f6', '#8b5cf6', '#10b981'];
  const maxVal = Math.max(1, ...counts);
  const total = counts.reduce((acc, v) => acc + v, 0);

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 320 155');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Biểu đồ phân bổ từ vựng Leitner 4-Box');

  const chartBottom = 122;
  const maxBarH = 88;
  const barW = 38;
  const gap = 20;
  const startX = 24;

  const axisLine = document.createElementNS(svgNS, 'line');
  axisLine.setAttribute('x1', '14');
  axisLine.setAttribute('y1', String(chartBottom));
  axisLine.setAttribute('x2', '306');
  axisLine.setAttribute('y2', String(chartBottom));
  axisLine.setAttribute('stroke', '#cbd5e1');
  axisLine.setAttribute('stroke-width', '1');
  svg.appendChild(axisLine);

  counts.forEach((count, idx) => {
    const x = startX + idx * (barW + gap);
    const barH = count > 0 ? Math.max(8, Math.round((count / maxVal) * maxBarH)) : 4;
    const y = chartBottom - barH;
    const pct = total ? Math.round((count / total) * 100) : 0;

    const rect = document.createElementNS(svgNS, 'rect');
    rect.setAttribute('x', String(x));
    rect.setAttribute('y', String(y));
    rect.setAttribute('width', String(barW));
    rect.setAttribute('height', String(barH));
    rect.setAttribute('rx', '6');
    rect.setAttribute('fill', count > 0 ? colors[idx] : '#e2e8f0');
    rect.setAttribute('class', 'analytics-bar-interactive');
    rect.setAttribute('data-tooltip', `${descriptions[idx]}: ${count} từ (${pct}%)`);
    svg.appendChild(rect);

    const valText = document.createElementNS(svgNS, 'text');
    valText.setAttribute('x', String(x + barW / 2));
    valText.setAttribute('y', String(y - 6));
    valText.setAttribute('text-anchor', 'middle');
    valText.setAttribute('font-size', '11');
    valText.setAttribute('font-weight', '700');
    valText.setAttribute('fill', '#334155');
    valText.textContent = String(count);
    svg.appendChild(valText);

    const lblText = document.createElementNS(svgNS, 'text');
    lblText.setAttribute('x', String(x + barW / 2));
    lblText.setAttribute('y', String(chartBottom + 18));
    lblText.setAttribute('text-anchor', 'middle');
    lblText.setAttribute('font-size', '11');
    lblText.setAttribute('font-weight', '600');
    lblText.setAttribute('fill', '#64748b');
    lblText.textContent = labels[idx];
    svg.appendChild(lblText);
  });

  wrap.replaceChildren(svg);
  bindSvgTooltips(wrap);
}

export function renderQuizHistorySvgChart(scoreHistory) {
  const wrap = document.getElementById('svg-quiz-history-chart');
  if (!wrap) return;
  const recent = (Array.isArray(scoreHistory) ? scoreHistory : []).slice(-7);

  if (!recent.length) {
    wrap.innerHTML =
      '<div style="font-size:0.82rem;color:#64748b;text-align:center;padding:24px 8px;">Hoàn thành ít nhất 1 bài Quiz để xem biểu đồ điểm số.</div>';
    return;
  }

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 320 155');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Biểu đồ điểm 7 bài Quiz gần nhất');

  const chartBottom = 122;
  const maxBarH = 88;
  const barW = 28;
  const gap = 14;
  const startX = 20;

  const axisLine = document.createElementNS(svgNS, 'line');
  axisLine.setAttribute('x1', '14');
  axisLine.setAttribute('y1', String(chartBottom));
  axisLine.setAttribute('x2', '306');
  axisLine.setAttribute('y2', String(chartBottom));
  axisLine.setAttribute('stroke', '#cbd5e1');
  axisLine.setAttribute('stroke-width', '1');
  svg.appendChild(axisLine);

  recent.forEach((attempt, idx) => {
    const pct = Math.max(0, Math.min(100, Number(attempt?.scorePercent || 0)));
    const x = startX + idx * (barW + gap);
    const barH = Math.max(6, Math.round((pct / 100) * maxBarH));
    const y = chartBottom - barH;
    const fill = pct >= 80 ? '#10b981' : pct >= 50 ? '#3b82f6' : '#f59e0b';

    const rect = document.createElementNS(svgNS, 'rect');
    rect.setAttribute('x', String(x));
    rect.setAttribute('y', String(y));
    rect.setAttribute('width', String(barW));
    rect.setAttribute('height', String(barH));
    rect.setAttribute('rx', '5');
    rect.setAttribute('fill', fill);
    rect.setAttribute('class', 'analytics-bar-interactive');
    rect.setAttribute(
      'data-tooltip',
      `${attempt.title || 'Quiz'} (${attempt.date || ''}): ${pct}% (${attempt.correctCount || 0}/${attempt.totalCount || 0})`
    );
    svg.appendChild(rect);

    const valText = document.createElementNS(svgNS, 'text');
    valText.setAttribute('x', String(x + barW / 2));
    valText.setAttribute('y', String(y - 6));
    valText.setAttribute('text-anchor', 'middle');
    valText.setAttribute('font-size', '10');
    valText.setAttribute('font-weight', '700');
    valText.setAttribute('fill', '#334155');
    valText.textContent = `${pct}%`;
    svg.appendChild(valText);

    const lblText = document.createElementNS(svgNS, 'text');
    lblText.setAttribute('x', String(x + barW / 2));
    lblText.setAttribute('y', String(chartBottom + 18));
    lblText.setAttribute('text-anchor', 'middle');
    lblText.setAttribute('font-size', '10');
    lblText.setAttribute('font-weight', '600');
    lblText.setAttribute('fill', '#64748b');
    lblText.textContent = `#${idx + 1}`;
    svg.appendChild(lblText);
  });

  wrap.replaceChildren(svg);
  bindSvgTooltips(wrap);
}
