# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
## 5. Project Context (Smart Study Extension)
- **Architecture:** Multi-root Workspace consisting of Chrome Extension Manifest V3 (`Smart_Study_Extension`) + FastAPI Python Backend (`Smart_Study_Backend` running on `http://127.0.0.1:8000` locally via `D:\Smart_Study_Backend\.venv\Scripts\python.exe`, configured via single `API_BASE_URL` constant ready for Render Cloud deployment per `RENDER_DEPLOY.md`).
- **Core Features (Sprints 1–12 — Do not break):**
  1. **Local-First Hybrid Quiz & Semantic Visual Mnemonics (`sidebar.js`, `practice.js` & `main.py`):** Instant 0ms client-side regex parsing for structured `.docx`/pasted exams and POS-tagged vocabulary lists (with WebP `<canvas>` image compression), falling back to Gemini AI (`gemini-3.5-flash-lite` -> `gemini-3.8-flash` -> `gemini-flash-latest` with `thinkingBudget: 0` fast mode) + background `/api/enrich-vocab` enrichment (context-accurate meaning, IPA, example sentences, `topic`, `visual_category`, `icon_emoji`, `visual_label`, and `memory_hook` rendered via 3-Tier Composite Visual Mnemonic Cards instead of raw LLM SVG coordinates).
  2. **Interactive Practice Room, Active English Production & Micro-Story Roleplay (`practice.html`, `practice.css`, `practice.js`, `student.js`):** Exam testing room, 3D flip flashcards, Dictation mode, AI sentence grading (`POST /api/grade-sentence`), Dynamic Topic Filter Pills (`#practice-topic-pills`), and the 4th mode **`🎭 Hội thoại thực chiến`** (`POST /api/synthesize-story` with local fallback `buildFallbackDialogueFromCards`) featuring multi-word dialogue synthesis, character-aware Male/Female TTS voice assignment (`resolveSpeakerVoice`, `onvoiceschanged`, sequential `onend` playback with `0.5x / 1x / 2x` speed selector and `⏹ Dừng`), interactive Cloze Mode, and situational Roleplay grading.
  3. **YouTube 4-Mode Summarizer & Timestamp Synchronization (`content.js`, `sidebar.js`):** Scrapes live transcript segments, generates timestamped summaries + 10–25 academic keywords across video slices, supports click-to-seek (`SEEK_YOUTUBE_VIDEO`) and APA timestamp citations.
  4. **Leitner 4-Box Spaced Repetition (`vocabBank`) & Weak-Spot Retest (`quizWeakStats`):** Automated SRS scheduling (`VocabStorageManager` with composite key `word_pos` and multi-topic metadata `topic`, `visual_category`, `icon_emoji`, `visual_label`, `memory_hook`), SVG Analytics Dashboard (Donut/Bar charts), and weighted Weak-Spot Retest (`🎯 Ôn câu hay sai`).
  5. **Context-Aware Selection Copilot (Sprint 12 — Completed):** Shadow DOM floating toolbar (`#smart-study-copilot-host` in `content.js`) + Chrome Context Menus (`background.js`) + Side Panel Copilot Card (`#selection-copilot-box` in `sidebar.html`/`sidebar.js`) powered by `POST /api/selection-copilot` for 1-click explanation (`explain`), context-aware vocabulary extraction & auto-upsert into `vocabBank` (`vocab`), and instant mini-quiz generation (`quiz`).
  6. **Document Tools (Export Word `.docx` & Native Print PDF):** Standardized Word Form/Essay/CMU template exporter (`docx.umd.js` & `POST /api/export-template`), clean web article exporter (`POST /api/export-web-docx`), and native browser `@media print` isolation (`#page-container-wrapper`, hiding blurred/locked placeholder pages at direct child level `#page-container > div` and restoring DOM on `afterprint`).
- **Current Milestone & Release Status (`v1.0` Release Ready — Sprints 1–14 Completed):**
  - **Sprint 12 Completed:** Selection Copilot Shadow DOM + Context Menus, 3-Tier Semantic Visual Mnemonics + `memory_hook`, Multi-Topic Filtering (`Topic Pills`), Micro-Story/Roleplay (`POST /api/synthesize-story`), and Speaker-aware TTS Voice Sequencing (`0.5x / 1x / 2x`).
  - **Sprint 13 (Step 13.1 — ES Modules Architecture & UX Enhancements under `Smart_Study_Extension/modules/`):**
    - `modules/storage-manager.js`: Centralized `API_BASE_URL` (`http://127.0.0.1:8000`), `VocabStorageManager` (`vocabBank` composite key `word_pos`, Leitner 4-Box `0 -> 4`, `getDueList()`, `getMasteryBreakdown()`), `quizWeakStats` (decrements `wrongCount - 1` on correct answer and removes at `<= 0`, plus `clearAllWeakQuestions()`), and `studyStreak`.
    - `modules/vocab-parser.js`: 0ms local POS-tag vocabulary regex parser (`parseLocalVocabPos`), local exam parser (`parseQuizLocally`), and 3-Tier Composite Visual Mnemonic renderer (`buildVisualMnemonicHtml`).
    - `modules/quiz-engine.js`: Fisher-Yates shuffle (`shuffleArrayFisherYates`, `shuffleQuizQuestionsAndOptions`), Weak-Spot Retest weighting/ranking & filtering (`filterWeakQuestionsList`), and pure-SVG chart rendering + tooltips (`renderLeitnerSvgChart`, `renderQuizHistorySvgChart`).
    - `modules/speech-service.js`: Web Speech API voice discovery (`onvoiceschanged`), character-name gender voice assignment (`resolveSpeakerVoice`), `0.5x / 1x / 2x` speed control, and sequential `onend` dialogue playback (`playDialogueSequence`, `stopSpeechSequence`).
    - `practice.html`, `practice.css` & `practice.js`: Connected via `<script type="module" src="practice.js"></script>`, featuring smooth sequential SRS card advancement, Box 0 -> Box 1–3 -> Mastered progress bar, Cramming Mode (`Ôn nhanh 5 phút` & `Review theo cụm`), Weak-Spot Retest filter/reset toolbar, and on-demand AI quiz explanation with Memory Cue (`💡 Giải thích vì sao đúng/sai`).
  - **Sprint 13 (Step 13.2 — Black-Box Playwright E2E Suite Completed — `20/20 Passed`):**
    - `package.json`, `playwright.config.js`, and `tests/e2e.spec.js`: Automated Chromium persistent-context E2E test suite covering **20 comprehensive test cases (`TC-01` through `TC-20`, `20/20 passed`)** across both `practice.html` and `sidebar.html` using Equivalence Partitioning, Boundary Value Analysis, and Negative Testing.
  - **Sprint 14 (GitHub Portfolio Documentation & `v1.0` Milestone Completed):**
    - `README.md`, `RENDER_DEPLOY.md`, and `CLAUDE.md` finalized with system architecture Mermaid diagram, feature catalog, Playwright E2E test matrix (`20/20 passed`), and local/Render deployment guide. Ready to tag **`v1.0`** release on GitHub.
