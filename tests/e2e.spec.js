// @ts-check
const path = require('path');
const fs = require('fs');
const os = require('os');
const { test: base, chromium, expect } = require('@playwright/test');

const EXTENSION_PATH = path.resolve(__dirname, '..');

/**
 * Custom Playwright fixture launching Chromium persistent context with Smart_Study_Extension loaded unpacked.
 */
const test = base.extend({
  context: async ({}, use) => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-study-pw-'));
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-sandbox',
        '--mute-audio'
      ]
    });
    await use(context);
    await context.close();
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch (_) {
      // Ignore cleanup errors on Windows file locks
    }
  },
  extensionId: async ({ context }, use) => {
    let [serviceWorker] = context.serviceWorkers();
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent('serviceworker', { timeout: 15000 });
    }
    const extensionId = serviceWorker.url().split('/')[2];
    await use(extensionId);
  }
});

test.describe('Smart Study Extension — Black-Box E2E Suite (20 Test Cases: TC-01 -> TC-20)', () => {
  // ===========================================================================
  // NHÓM A — NỀN TẢNG & TỪ VỰNG / TRẮC NGHIỆM CỐT LÕI (TC-01 -> TC-05)
  // ===========================================================================

  test('TC-01: Nạp Extension & mở practice.html sạch lỗi console/pageerror', async ({ context, extensionId }) => {
    const page = await context.newPage();
    const pageErrors = [];
    const severeConsoleErrors = [];

    page.on('pageerror', (err) => {
      pageErrors.push(err.message);
    });
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        // Bỏ qua lỗi kết nối backend cục bộ 127.0.0.1:8000 khi chạy test offline
        if (text.includes('127.0.0.1:8000') || text.includes('ERR_CONNECTION_REFUSED')) {
          return;
        }
        // Chỉ coi là lỗi fail nếu là lỗi code/module/DOM thực sự của extension
        const isCodeOrModuleError =
          /(SyntaxError|ReferenceError|TypeError|Failed to load module script|Cannot read propert)/i.test(text);
        if (isCodeOrModuleError) {
          severeConsoleErrors.push(text);
        }
      }
    });

    await page.goto(`chrome-extension://${extensionId}/practice.html`);
    await page.evaluate(async () => {
      await chrome.storage.local.set({
        activePracticeSession: {
          title: 'Đề kiểm thử E2E TC-01',
          quiz_type: 'standard',
          mode: 'quiz',
          quiz: [
            {
              question: 'Thuật toán xáo trộn đề thi nào đảm bảo phân phối đều O(n)?',
              options: {
                A: 'Bubble Sort',
                B: 'Fisher-Yates Shuffle',
                C: 'Linear Scan',
                D: 'Binary Search'
              },
              correct_answer: 'B',
              explanation: 'Fisher-Yates Shuffle có độ phức tạp O(n) và không thiên lệch.'
            }
          ]
        }
      });
    });

    await page.reload();
    await page.locator('#practice-title').waitFor({ state: 'visible' });
    await expect(page.locator('#practice-title')).toHaveText('Đề kiểm thử E2E TC-01');
    await expect(page.locator('#practice-question')).toContainText('Thuật toán xáo trộn đề thi');
    await expect(page.locator('#practice-options')).toContainText('Fisher-Yates Shuffle');
    expect(pageErrors).toEqual([]);
    expect(severeConsoleErrors).toEqual([]);
  });

  test('TC-02: Nhận diện từ vựng POS Tag 0ms & hiển thị chế độ Lật thẻ Từ vựng', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/practice.html`);

    const parsedCount = await page.evaluate(async () => {
      const { parseLocalVocabPos } = await import('./modules/vocab-parser.js');
      const rawInput = [
        'implement (v): triển khai',
        'resilient (adj): kiên cường',
        'architecture (n): kiến trúc hệ thống',
        'seamlessly (adv): một cách mượt mà'
      ].join('\n');
      const parsedResult = parseLocalVocabPos(rawInput);
      const cards = Array.isArray(parsedResult?.quiz)
        ? parsedResult.quiz
        : Array.isArray(parsedResult)
          ? parsedResult
          : [];

      await chrome.storage.local.set({
        activePracticeSession: {
          title: 'Từ vựng Tiếng Anh POS Tag (0ms)',
          quiz_type: 'vocab',
          mode: 'flashcard',
          quiz: cards
        }
      });
      return cards.length;
    });

    expect(parsedCount).toBe(4);
    await page.reload();

    const skipBtn = page.locator('#countdown-skip-btn');
    if (await skipBtn.isVisible()) {
      await skipBtn.click();
    }

    await page.locator('#flashcard-mode-panel').waitFor({ state: 'visible' });
    await expect(page.locator('#flashcard-mode-panel')).toBeVisible();
    await expect(page.locator('#flashcard-question')).toHaveText('implement');
    await expect(page.locator('#flashcard-pos')).toHaveText('(v)');
    await expect(page.locator('#flashcard-answer')).toHaveText('triển khai');
    await expect(page.locator('#practice-weak-retest-btn')).toBeHidden();
  });

  test('TC-03: Upsert vocabBank khóa ghép word_pos, Leitner 4-Box & Thanh tiến độ Mastery', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/practice.html`);

    await page.evaluate(async () => {
      await chrome.storage.local.set({
        vocabBank: [],
        activePracticeSession: {
          title: 'Kiểm thử Leitner SRS',
          quiz_type: 'vocab',
          mode: 'flashcard',
          quiz: [
            {
              word: 'implement',
              pos: 'v',
              question: 'implement (v)',
              answer: 'triển khai',
              meaning_vi: 'triển khai',
              correct_answer: 'triển khai',
              options: []
            },
            {
              word: 'resilient',
              pos: 'adj',
              question: 'resilient (adj)',
              answer: 'kiên cường',
              meaning_vi: 'kiên cường',
              correct_answer: 'kiên cường',
              options: []
            }
          ]
        }
      });
    });

    await page.reload();
    const skipBtn = page.locator('#countdown-skip-btn');
    if (await skipBtn.isVisible()) {
      await skipBtn.click();
    }

    await expect(page.locator('#vocab-mastery-progress-card')).toBeVisible();
    await expect(page.locator('#flashcard-question')).toHaveText('implement');

    await page.locator('#srs-unknown-btn').click();
    await expect(page.locator('#flashcard-question')).toHaveText('resilient');

    await page.locator('#srs-known-btn').click();

    const bankState = await page.evaluate(async () => {
      const { vocabBank = [] } = await chrome.storage.local.get('vocabBank');
      return vocabBank;
    });

    const implementEntry = bankState.find((e) => e.id === 'implement_v');
    const resilientEntry = bankState.find((e) => e.id === 'resilient_adj');

    expect(implementEntry).toBeTruthy();
    expect(implementEntry.masteryLevel).toBe(0);
    expect(resilientEntry).toBeTruthy();
    expect(resilientEntry.masteryLevel).toBe(1);

    await expect(page.locator('#mastery-chip-box0')).toContainText('1');
    await expect(page.locator('#mastery-chip-box1')).toContainText('1');
  });

  test('TC-04: Weak-Spot Retest giữ đủ 4 đáp án A, B, C, D, có bộ lọc/Reset và giảm wrongCount khi làm đúng', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/practice.html`);

    await page.evaluate(async () => {
      await chrome.storage.local.set({
        quizWeakStats: {
          'giao thức nào hoạt động ở tầng giao vận (transport layer)?': {
            question: 'Giao thức nào hoạt động ở tầng Giao vận (Transport Layer)?',
            options: ['A. HTTP', 'B. TCP', 'C. IP', 'D. ARP'],
            correct_answer: 'B',
            explanation: 'TCP và UDP là hai giao thức chính ở tầng Transport.',
            wrongCount: 1,
            attempts: 2,
            lastAttemptAt: Date.now()
          }
        },
        activePracticeSession: {
          title: 'Đề Mạng máy tính',
          quiz_type: 'standard',
          mode: 'quiz',
          quiz: [
            {
              question: 'Giao thức nào hoạt động ở tầng Giao vận (Transport Layer)?',
              options: ['A. HTTP', 'B. TCP', 'C. IP', 'D. ARP'],
              correct_answer: 'B',
              explanation: 'TCP và UDP là hai giao thức chính ở tầng Transport.'
            }
          ]
        }
      });
    });

    await page.reload();
    const skipBtn = page.locator('#countdown-skip-btn');
    if (await skipBtn.isVisible()) {
      await skipBtn.click();
    }

    const weakBtn = page.locator('#practice-weak-retest-btn');
    await expect(weakBtn).toBeVisible();
    await expect(weakBtn).toContainText('🎯 Ôn câu hay sai (1)');

    await weakBtn.click();
    if (await skipBtn.isVisible()) {
      await skipBtn.click();
    }

    await expect(page.locator('#weak-retest-controls')).toBeVisible();
    await expect(page.locator('#weak-filter-input')).toBeVisible();
    await expect(page.locator('#weak-reset-all-btn')).toBeVisible();

    const optionButtons = page.locator('#practice-options .practice-option-btn');
    await expect(optionButtons).toHaveCount(4);
    await expect(optionButtons.nth(0)).toContainText('HTTP');
    await expect(optionButtons.nth(1)).toContainText('TCP');
    await expect(optionButtons.nth(2)).toContainText('IP');
    await expect(optionButtons.nth(3)).toContainText('ARP');

    await optionButtons.nth(1).click();
    await expect(page.locator('#practice-feedback')).toContainText('Chính xác');
    await expect(weakBtn).toContainText('🎯 Ôn câu hay sai (0)');
  });

  test('TC-05: Dashboard SVG Analytics & Chuyển đổi 4 chế độ luyện từ vựng', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/practice.html`);

    await page.evaluate(async () => {
      await chrome.storage.local.set({
        vocabBank: [
          { id: 'savoury_adj', word: 'savoury', pos: 'adj', meaning: 'đậm đà vị mặn', masteryLevel: 2 },
          { id: 'takeaway_n', word: 'takeaway', pos: 'n', meaning: 'đồ ăn mang về', masteryLevel: 4 }
        ],
        quizScoreHistory: [
          { date: '2026-11-21', title: 'Quiz 1', scorePercent: 85, correctCount: 17, totalCount: 20 }
        ],
        activePracticeSession: {
          title: 'Bộ thẻ Ẩm thực',
          quiz_type: 'vocab',
          mode: 'flashcard',
          quiz: [
            {
              word: 'savoury',
              pos: 'adj',
              question: 'savoury (adj)',
              answer: 'đậm đà vị mặn',
              meaning_vi: 'đậm đà vị mặn',
              correct_answer: 'đậm đà vị mặn',
              topic: 'Food & Dining',
              options: []
            },
            {
              word: 'takeaway',
              pos: 'n',
              question: 'takeaway (n)',
              answer: 'đồ ăn mang về',
              meaning_vi: 'đồ ăn mang về',
              correct_answer: 'đồ ăn mang về',
              topic: 'Food & Dining',
              options: []
            }
          ]
        }
      });
    });

    await page.reload();
    const skipBtn = page.locator('#countdown-skip-btn');
    if (await skipBtn.isVisible()) {
      await skipBtn.click();
    }

    const dashboardSummary = page.locator('#analytics-dashboard-details > summary');
    await dashboardSummary.click();
    await expect(page.locator('#svg-leitner-chart svg')).toBeVisible();
    await expect(page.locator('#svg-quiz-history-chart svg')).toBeVisible();

    const btnFlashcard = page.locator('.mode-switch-btn[data-mode="flashcard"]');
    const btnDictation = page.locator('.mode-switch-btn[data-mode="dictation"]');
    const btnSentence = page.locator('.mode-switch-btn[data-mode="sentence"]');
    const btnStory = page.locator('.mode-switch-btn[data-mode="story"]');

    await expect(btnFlashcard).toBeVisible();
    await expect(btnDictation).toBeVisible();
    await expect(btnSentence).toBeVisible();
    await expect(btnStory).toBeVisible();

    await btnDictation.click();
    await expect(page.locator('#dictation-mode-panel')).toBeVisible();

    await btnSentence.click();
    await expect(page.locator('#sentence-mode-panel')).toBeVisible();

    await btnStory.click();
    await expect(page.locator('#story-mode-panel')).toBeVisible();
    await expect(page.locator('#story-dialogue-list .story-turn-item').first()).toBeVisible();
  });

  // ===========================================================================
  // NHÓM B — ĐIỀU HƯỚNG SIDE PANEL & LƯU TRỮ CẤU HÌNH (TC-06 -> TC-09)
  // ===========================================================================

  test('TC-06: Mở sidebar.html sạch lỗi pageerror & điều hướng qua toàn bộ 6 view chức năng', async ({ context, extensionId }) => {
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto(`chrome-extension://${extensionId}/sidebar.html`);
    await page.locator('#current-view-title').waitFor({ state: 'visible' });
    await expect(page.locator('#current-view-title')).toHaveText('Tạo Quiz bằng AI');

    const viewsToTest = [
      { viewId: 'view-youtube', expectedTitle: 'Tóm tắt YouTube' },
      { viewId: 'view-word-form', expectedTitle: 'Chỉnh sửa form Word' },
      { viewId: 'view-history', expectedTitle: 'Lịch sử Bộ đề' },
      { viewId: 'view-export', expectedTitle: 'Xuất Word & In PDF' },
      { viewId: 'view-settings', expectedTitle: 'Cài đặt API Key' },
      { viewId: 'view-quiz', expectedTitle: 'Tạo Quiz bằng AI' }
    ];

    for (const item of viewsToTest) {
      await page.locator('#menu-toggle-btn').click();
      const navItem = page.locator(`.nav-item[data-view="${item.viewId}"]`);
      await navItem.waitFor({ state: 'visible' });
      await navItem.click();
      await expect(page.locator(`#${item.viewId}`)).toBeVisible();
      await expect(page.locator('#current-view-title')).toHaveText(item.expectedTitle);
    }

    expect(pageErrors).toEqual([]);
  });

  test('TC-07: Lưu giá trị biên Gemini API Key trong view Cài đặt API Key & kiểm chứng chrome.storage.local', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidebar.html`);

    await page.locator('#menu-toggle-btn').click();
    await page.locator('.nav-item[data-view="view-settings"]').click();
    await expect(page.locator('#view-settings')).toBeVisible();

    const sampleKey = '   AIzaSyBoundaryTestKey_SmartStudy_2026   ';
    await page.locator('#gemini-api-key').fill(sampleKey);
    await page.locator('#save-key-btn').click();

    await expect(page.locator('#save-status')).toBeVisible();
    await expect(page.locator('#save-status')).toHaveText('Đã lưu thành công!');

    const savedKey = await page.evaluate(async () => {
      const { geminiApiKey } = await chrome.storage.local.get('geminiApiKey');
      return geminiApiKey;
    });
    expect(savedKey).toBe('AIzaSyBoundaryTestKey_SmartStudy_2026');
  });

  test('TC-08: Quản lý Lịch sử Bộ đề (studyHistory) — hiển thị dropdown và xóa bộ đề an toàn', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidebar.html`);

    await page.evaluate(async () => {
      await chrome.storage.local.set({
        studyHistory: [
          {
            id: 'hist-e2e-1',
            title: 'Đề Kiểm thử Phần mềm CMU-SE 303',
            createdAt: '10:30 22/11',
            quiz_type: 'standard',
            summary: 'Tóm tắt kiểm thử hộp đen.',
            quiz: [
              {
                question: 'Phân hoạch tương đương là kỹ thuật kiểm thử nào?',
                options: { A: 'Hộp trắng', B: 'Hộp đen', C: 'Hộp xám', D: 'Hồi quy' },
                correct_answer: 'B',
                explanation: 'Black-box testing.'
              }
            ]
          }
        ]
      });
    });

    await page.reload();
    await page.locator('#menu-toggle-btn').click();
    await page.locator('.nav-item[data-view="view-history"]').click();
    await expect(page.locator('#view-history')).toBeVisible();

    const historySelect = page.locator('#study-history-select');
    await expect(historySelect).toContainText('Đề Kiểm thử Phần mềm CMU-SE 303');

    // Chọn bộ đề và bấm nút xóa
    await historySelect.selectOption('hist-e2e-1');
    // Khi chọn, view tự chuyển sang view-quiz để hiển thị đề; mở lại view-history để xóa
    await page.locator('#menu-toggle-btn').click();
    await page.locator('.nav-item[data-view="view-history"]').click();
    await page.locator('#delete-history-btn').click();

    const remaining = await page.evaluate(async () => {
      const { studyHistory = [] } = await chrome.storage.local.get('studyHistory');
      return studyHistory.length;
    });
    expect(remaining).toBe(0);
  });

  test('TC-09: Đồng bộ badge số lượng trên nút Sổ tay Từ vựng Cần Ôn & Ôn câu hay sai ở sidebar.html', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidebar.html`);

    await page.evaluate(async () => {
      await chrome.storage.local.set({
        vocabBank: [
          { id: ' Boundary_n', word: 'boundary', pos: 'n', meaning: 'giá trị biên', masteryLevel: 0, nextReviewAt: 0 },
          { id: 'equivalence_n', word: 'equivalence', pos: 'n', meaning: 'tương đương', masteryLevel: 0, nextReviewAt: 0 },
          { id: 'mastered_adj', word: 'mastered', pos: 'adj', meaning: 'đã thuộc', masteryLevel: 4, nextReviewAt: Date.now() + 9999999 }
        ],
        quizWeakStats: {
          'cau-sai-1': {
            question: 'Câu hỏi hay sai 1?',
            options: ['A. Đáp án 1', 'B. Đáp án 2', 'C. Đáp án 3', 'D. Đáp án 4'],
            correct_answer: 'A',
            wrongCount: 2,
            attempts: 3
          }
        }
      });
    });

    await expect(page.locator('#open-vocab-bank-btn')).toContainText('📚 Sổ tay Từ vựng Cần Ôn (2)');
    await expect(page.locator('#open-weak-retest-btn')).toContainText('🎯 Ôn câu hay sai (1)');
  });

  // ===========================================================================
  // NHÓM C — TẠO QUIZ & PHÂN TÍCH CỤC BỘ 0MS (TC-10 -> TC-13)
  // ===========================================================================

  test('TC-10: Chuyển đổi 3 tab nguồn nhập liệu (Từ File, Trang Web, Dán Chữ) & kiểm tra dropdown độ khó', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidebar.html`);

    const tabFile = page.locator('.source-tab-btn[data-source="file"]');
    const tabUrl = page.locator('.source-tab-btn[data-source="url"]');
    const tabText = page.locator('.source-tab-btn[data-source="text"]');

    await expect(page.locator('#source-file')).toBeVisible();

    await tabUrl.click();
    await expect(page.locator('#source-web')).toBeVisible();
    await expect(page.locator('#source-file')).toBeHidden();

    await tabText.click();
    await expect(page.locator('#source-text')).toBeVisible();
    await expect(page.locator('#source-web')).toBeHidden();

    await tabFile.click();
    await expect(page.locator('#source-file')).toBeVisible();

    // Kiểm tra 3 tùy chọn trong dropdown #quiz-difficulty
    const diffOptions = page.locator('#quiz-difficulty option');
    await expect(diffOptions).toHaveCount(3);
    await expect(diffOptions.nth(0)).toContainText('Độ bình thường');
    await expect(diffOptions.nth(1)).toContainText('Độ khó: Lộn xộn');
    await expect(diffOptions.nth(2)).toContainText('Từ vựng tiếng Anh');
  });

  test('TC-11: Phân tích đề trắc nghiệm chuẩn cục bộ 0ms & hiển thị khu vực xem trước + nút Thi Trắc nghiệm', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidebar.html`);

    const rawExamText = [
      'Câu 1: Kỹ thuật kiểm thử nào dựa trên đặc tả yêu cầu mà không cần xem cấu trúc mã nguồn?',
      'A. Kiểm thử hộp trắng (White-Box)',
      '*B. Kiểm thử hộp đen (Black-Box)',
      'C. Kiểm thử đơn vị (Unit Test)',
      'D. Kiểm thử tĩnh (Static Analysis)',
      'Câu 2: Công cụ nào hỗ trợ kiểm thử tự động E2E cho Chromium Extension?',
      '*A. Playwright',
      'B. Notepad',
      'C. Paint',
      'D. Calculator'
    ].join('\n');

    // Gọi bộ bóc tách cục bộ 0ms và hiển thị lên vùng xem trước #quiz-result
    await page.evaluate((text) => {
      const scanned = parseScanExamText(text);
      renderInteractiveQuiz(scanned, '', 'Đề Kiểm thử Hộp đen 0ms', false, { autoOpen: false });
    }, rawExamText);

    await expect(page.locator('#quiz-result')).toBeVisible();
    await expect(page.locator('#quiz-result .quiz-validation-badge')).toContainText('Đề có sẵn đã được bóc tách');
    await expect(page.locator('#open-practice-quiz-btn')).toBeVisible();
    await expect(page.locator('#open-practice-quiz-btn')).toContainText('🚀 Thi Trắc nghiệm');
  });

  test('TC-12: Dán bảng từ vựng POS Tag ở tab Dán Chữ -> nhận diện 0ms & hiển thị nút Lật thẻ', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidebar.html`);

    await page.locator('.source-tab-btn[data-source="text"]').click();
    const vocabText = [
      'equivalence (n): phân hoạch tương đương',
      'boundary (n): giá trị biên',
      'regression (n): kiểm thử hồi quy'
    ].join('\n');

    await page.locator('#quiz-input').fill(vocabText);
    await expect(page.locator('#quiz-char-count')).toContainText('ký tự');
    await expect(page.locator('#quiz-difficulty')).toHaveValue('vocab');

    await page.locator('#generate-quiz-btn').click();
    await expect(page.locator('#quiz-result')).toBeVisible();
    await expect(page.locator('#open-practice-flashcard-btn')).toBeVisible();
    await expect(page.locator('#open-practice-flashcard-btn')).toContainText('🗂️ Lật thẻ');
  });

  test('TC-13: Giá trị biên / Dữ liệu rỗng — bấm Tạo Quiz khi ô dán chữ trống báo nhắc thân thiện trên Mascot', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidebar.html`);

    await page.locator('.source-tab-btn[data-source="text"]').click();
    await page.locator('#quiz-input').fill('   ');
    await page.locator('#generate-quiz-btn').click();

    await expect(page.locator('#pdf-status-text')).toContainText('Vui lòng dán văn bản bài học trước khi tạo Quiz.');
    await expect(page.locator('#pdf-status-widget')).toHaveClass(/is-error/);
  });

  // ===========================================================================
  // NHÓM D — TÓM TẮT YOUTUBE, CHỈNH SỬA FORM WORD & XUẤT PDF (TC-14 -> TC-17)
  // ===========================================================================

  test('TC-14: View Tóm tắt YouTube có đủ 4 chế độ tóm tắt (Ý chính, Siêu ngắn, Chi tiết, Dễ hiểu)', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidebar.html`);

    await page.locator('#menu-toggle-btn').click();
    await page.locator('.nav-item[data-view="view-youtube"]').click();
    await expect(page.locator('#view-youtube')).toBeVisible();

    const ytOptions = page.locator('#yt-summary-level option');
    await expect(ytOptions).toHaveCount(4);
    await expect(ytOptions.nth(0)).toContainText('Ý chính');
    await expect(ytOptions.nth(1)).toContainText('Siêu ngắn');
    await expect(ytOptions.nth(2)).toContainText('Chi tiết');
    await expect(ytOptions.nth(3)).toContainText('Dễ hiểu');
    await expect(page.locator('#summarize-yt-btn')).toBeVisible();
  });

  test('TC-15: View Chỉnh sửa form Word — chuyển đổi đủ 3 tab (Trắc nghiệm, Tiểu luận, Báo cáo CMU)', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidebar.html`);

    await page.locator('#menu-toggle-btn').click();
    await page.locator('.nav-item[data-view="view-word-form"]').click();
    await expect(page.locator('#view-word-form')).toBeVisible();

    const tabQuiz = page.locator('.wf-mode-tab[data-wf-mode="quiz"]');
    const tabEssay = page.locator('.wf-mode-tab[data-wf-mode="essay"]');
    const tabCmu = page.locator('.wf-mode-tab[data-wf-mode="cmu"]');

    await expect(page.locator('#wf-quiz-panel')).toBeVisible();
    await expect(page.locator('#wf-quiz-title')).toBeVisible();

    await tabEssay.click();
    await expect(page.locator('#wf-essay-panel')).toBeVisible();
    await expect(page.locator('#wf-essay-faculty')).toBeVisible();
    await expect(page.locator('#wf-essay-topic')).toBeVisible();

    await tabCmu.click();
    await expect(page.locator('#wf-cmu-panel')).toBeVisible();
    await expect(page.locator('#wf-cmu-course-code')).toBeVisible();
    await expect(page.locator('#wf-cmu-mentor')).toBeVisible();

    await tabQuiz.click();
    await expect(page.locator('#wf-quiz-panel')).toBeVisible();
  });

  test('TC-16: Tab Trắc nghiệm trong Chỉnh sửa form Word có đủ 3 kiểu đánh dấu đáp án đúng', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidebar.html`);

    await page.locator('#menu-toggle-btn').click();
    await page.locator('.nav-item[data-view="view-word-form"]').click();

    const styleOptions = page.locator('#wf-answer-style option');
    await expect(styleOptions).toHaveCount(3);
    await expect(styleOptions.nth(0)).toContainText('In đậm đáp án đúng');
    await expect(styleOptions.nth(1)).toContainText('Thêm dấu *');
    await expect(styleOptions.nth(2)).toContainText('Cả hai');
  });

  test('TC-17: View Xuất Word & In PDF hiển thị đầy đủ nút xuất Word, thanh trượt Tốc độ cuộn, nút Xóa cookie & nút In PDF', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidebar.html`);

    await page.locator('#menu-toggle-btn').click();
    await page.locator('.nav-item[data-view="view-export"]').click();
    await expect(page.locator('#view-export')).toBeVisible();

    await expect(page.locator('#export-web-docx-btn')).toBeVisible();
    await expect(page.locator('#scroll-speed-slider')).toBeVisible();
    await expect(page.locator('#scroll-speed-badge')).toHaveText('Vừa');
    await expect(page.locator('#clear-cookies-reload-btn')).toBeVisible();
    await expect(page.locator('#export-web-pdf-btn')).toBeVisible();

    // Thay đổi giá trị biên thanh trượt tốc độ cuộn sang mức 5 (Rất nhanh)
    await page.locator('#scroll-speed-slider').fill('5');
    await page.locator('#scroll-speed-slider').dispatchEvent('input');
    await expect(page.locator('#scroll-speed-badge')).toHaveText('Rất nhanh');
  });

  // ===========================================================================
  // NHÓM E — TƯƠNG TÁC NÂNG CAO TRÊN PHÒNG LUYỆN TẬP PRACTICE.HTML (TC-18 -> TC-20)
  // ===========================================================================

  test('TC-18: Phòng luyện tập Từ vựng — Thanh tiến độ Mastery, Cramming Mode & Bộ lọc Chủ đề (Topic Pills)', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/practice.html`);

    await page.evaluate(async () => {
      const sampleCards = Array.from({ length: 12 }, (_, idx) => ({
        word: `term${idx + 1}`,
        pos: idx % 2 === 0 ? 'n' : 'v',
        question: `term${idx + 1} (${idx % 2 === 0 ? 'n' : 'v'})`,
        answer: `nghĩa thứ ${idx + 1}`,
        meaning_vi: `nghĩa thứ ${idx + 1}`,
        correct_answer: `nghĩa thứ ${idx + 1}`,
        topic: idx < 6 ? 'Software Engineering' : 'Food & Dining',
        masteryLevel: idx < 4 ? 0 : idx < 9 ? 2 : 4,
        options: []
      }));

      await chrome.storage.local.set({
        vocabBank: sampleCards.map((c) => ({
          id: `${c.word}_${c.pos}`,
          word: c.word,
          pos: c.pos,
          meaning: c.meaning_vi,
          topic: c.topic,
          masteryLevel: c.masteryLevel
        })),
        activePracticeSession: {
          title: 'Bộ từ Đa chủ đề & Cramming',
          quiz_type: 'vocab',
          mode: 'flashcard',
          quiz: sampleCards
        }
      });
    });

    await page.reload();
    const skipBtn = page.locator('#countdown-skip-btn');
    if (await skipBtn.isVisible()) {
      await skipBtn.click();
    }

    // Kiểm tra thanh tiến độ Box 0 -> Box 1-3 -> Mastered
    await expect(page.locator('#vocab-mastery-progress-card')).toBeVisible();
    await expect(page.locator('#mastery-chip-box0')).toContainText('4');
    await expect(page.locator('#mastery-chip-box1')).toContainText('5');
    await expect(page.locator('#mastery-chip-mastered')).toContainText('3');

    // Kiểm tra bộ lọc Chủ đề (Topic Pills)
    const topicPills = page.locator('#practice-topic-pills .topic-filter-pill');
    await expect(topicPills).toHaveCount(3); // Tất cả (12), Software Engineering (6), Food & Dining (6)
    await topicPills.nth(1).click();
    await expect(page.locator('#flashcard-number')).toContainText('Thẻ 1 / 6');

    // Kiểm tra Cramming Mode "Ôn nhanh 5 phút (~8-10 thẻ)"
    await page.locator('#cram-5min-btn').click();
    await expect(page.locator('#cram-exit-btn')).toBeVisible();
    await expect(page.locator('#flashcard-number')).toContainText('Thẻ 1 / 9'); // 9 thẻ chưa đạt Box 4 (tối đa 10)

    // Kiểm tra Cramming Mode "Review theo cụm"
    await page.locator('#cram-cluster-btn').click();
    await expect(page.locator('#cram-cluster-select')).toBeVisible();

    // Thoát Cramming Mode
    await page.locator('#cram-exit-btn').click();
    await expect(page.locator('#cram-exit-btn')).toBeHidden();
  });

  test('TC-19: Chế độ Nghe & Gõ điền từ (Dictation Mode) — chấm điểm chuẩn hóa chuỗi & gợi ý từng ký tự', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/practice.html`);

    await page.evaluate(async () => {
      await chrome.storage.local.set({
        activePracticeSession: {
          title: 'Kiểm thử Dictation Mode',
          quiz_type: 'vocab',
          mode: 'flashcard',
          quiz: [
            {
              word: 'Resilient',
              pos: 'adj',
              question: 'Resilient (adj)',
              answer: 'kiên cường, bền bỉ',
              meaning_vi: 'kiên cường, bền bỉ',
              correct_answer: 'kiên cường, bền bỉ',
              example_en: 'She is a resilient software engineer.',
              options: []
            }
          ]
        }
      });
    });

    await page.reload();
    const skipBtn = page.locator('#countdown-skip-btn');
    if (await skipBtn.isVisible()) {
      await skipBtn.click();
    }

    await page.locator('.mode-switch-btn[data-mode="dictation"]').click();
    await expect(page.locator('#dictation-mode-panel')).toBeVisible();
    await expect(page.locator('#dictation-meaning')).toHaveText('kiên cường, bền bỉ');

    // Bấm Gợi ý
    await page.locator('#dictation-hint-btn').click();
    await expect(page.locator('#dictation-hint-text')).toBeVisible();
    await expect(page.locator('#dictation-hint-text')).toContainText('R');

    // Nhập đáp án sai -> báo lỗi từng ký tự
    await page.locator('#dictation-input').fill('resilant');
    await page.locator('#dictation-check-btn').click();
    await expect(page.locator('#dictation-diff-result')).toContainText('Chưa khớp hoàn toàn');

    // Nhập đáp án đúng (khác hoa/thường & khoảng trắng dư) -> báo Chính xác hoàn toàn
    await page.locator('#dictation-input').fill('  resilient! ');
    await page.locator('#dictation-check-btn').click();
    await expect(page.locator('#dictation-diff-result')).toContainText('Chính xác hoàn toàn');
  });

  test('TC-20: Chế độ Ôn câu hay sai — Lọc theo từ khóa/mức độ sai & Reset danh sách câu sai về 0', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/practice.html`);

    await page.evaluate(async () => {
      await chrome.storage.local.set({
        quizWeakStats: {
          'cau-sql-injection': {
            question: 'Kỹ thuật nào ngăn chặn lỗ hổng SQL Injection hiệu quả nhất?',
            options: ['A. Prepared Statements', 'B. Eval String', 'C. Inline Concatenation', 'D. Plain Text'],
            correct_answer: 'A',
            explanation: 'Prepared Statements tách biệt truy vấn và dữ liệu.',
            wrongCount: 3,
            attempts: 4
          },
          'cau-xss-security': {
            question: 'Lỗ hổng XSS (Cross-Site Scripting) thường tấn công vào đâu?',
            options: ['A. Phần cứng CPU', 'B. Trình duyệt của người dùng', 'C. Cáp quang biển', 'D. Nguồn điện'],
            correct_answer: 'B',
            explanation: 'XSS thực thi mã độc trên trình duyệt client.',
            wrongCount: 1,
            attempts: 2
          }
        },
        activePracticeSession: {
          title: 'Đề Bảo mật Web',
          quiz_type: 'standard',
          mode: 'quiz',
          quiz: [
            {
              question: 'Kỹ thuật nào ngăn chặn lỗ hổng SQL Injection hiệu quả nhất?',
              options: ['A. Prepared Statements', 'B. Eval String', 'C. Inline Concatenation', 'D. Plain Text'],
              correct_answer: 'A',
              explanation: ''
            }
          ]
        }
      });
    });

    await page.reload();
    const skipBtn = page.locator('#countdown-skip-btn');
    if (await skipBtn.isVisible()) {
      await skipBtn.click();
    }

    // Kiểm tra nút "💡 Giải thích vì sao đúng/sai" hiện ra khi câu hỏi chưa có explanation
    await page.locator('#practice-options .practice-option-btn').first().click();
    await expect(page.locator('#practice-ai-explain-wrap')).toBeVisible();
    await expect(page.locator('#practice-ai-explain-btn')).toContainText('💡 Giải thích vì sao đúng/sai');

    // Mở chế độ Ôn câu hay sai (2 câu)
    const weakBtn = page.locator('#practice-weak-retest-btn');
    await expect(weakBtn).toContainText('🎯 Ôn câu hay sai (2)');
    await weakBtn.click();
    if (await skipBtn.isVisible()) {
      await skipBtn.click();
    }

    // Lọc nhanh theo từ khóa "XSS"
    await page.locator('#weak-filter-input').fill('XSS');
    await expect(page.locator('#practice-question')).toContainText('XSS');
    await expect(page.locator('#practice-title')).toContainText('1 câu');

    // Bấm Reset danh sách câu sai và tự động chấp nhận hộp thoại confirm
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#weak-reset-all-btn').click();

    await expect(weakBtn).toContainText('🎯 Ôn câu hay sai (0)');
  });
});
