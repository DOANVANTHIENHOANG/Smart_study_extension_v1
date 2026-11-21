[CRITICAL RULE: READ-ONLY FILE. DO NOT MODIFY.]
1. Act as Senior Chrome Extension Dev (Manifest V3 only).
2. Tech Stack: HTML5, CSS3, Vanilla JS. No React/Vue.
3. Architecture: Use Chrome Side Panel API instead of Popup.
4. Rule: Only write code for the specific task requested. Do not hallucinate future features.
5. Backend Stack (`Smart_Study_Backend/`): Python FastAPI running at `http://127.0.0.1:8000` (deployed on Render). Keep core endpoints (e.g., `/api/export-docx`) intact unless explicitly asked to modify.
6. Security & API Keys: Never hardcode API keys in source files. Load secrets exclusively from `.env` (Backend) or user-provided `chrome.storage.local` settings (Extension).
7. Gemini API Resilience: Always route LLM calls through `get_available_flash_models` and `call_gemini_with_fallback` in `main.py` to handle `403`/`503`/`504` errors automatically.