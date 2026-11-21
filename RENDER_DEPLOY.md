    # QUY TẮC KIẾN TRÚC & KỊCH BẢN DEPLOY RENDER (SMART STUDY)

## 1. Trạng thái hiện tại: LOCAL DEVELOPMENT (Mặc định)
- **Giữ nguyên môi trường Local (`http://127.0.0.1:8000`)** cho đến khi người dùng ra lệnh chuyển sang môi trường Render.
- **Cơ chế API Key (BYOK - Bring Your Own Key):**
  - Giữ nguyên luồng người dùng tự nhập Gemini API Key tại tab Cài đặt (lưu trong `chrome.storage.local`) và gửi kèm request / HTTP Header (`X-Gemini-Api-Key`) xuống Backend.
  - Tuyệt đối không hardcode API Key cá nhân vào mã nguồn Frontend hay Backend.

## 2. Kỷ luật viết code chuẩn bị sẵn sàng cho Render
1. **Tập trung hóa cấu hình URL (`API_BASE_URL`):**
   - Không viết cứng chuỗi `http://127.0.0.1:8000` rải rác trong `sidebar.js` hay các module khác.
   - Mọi lệnh `fetch()` xuống Backend đều phải gọi qua một hằng số cấu hình tập trung duy nhất ở đầu `sidebar.js` (ví dụ `const API_BASE_URL = 'http://127.0.0.1:8000';`) để sau này chỉ cần đổi 1 dòng duy nhất.
2. **Xử lý tệp hoàn toàn trên RAM (Stateless Storage):**
   - Mọi thao tác đọc file tải lên (`.pdf`, `.docx`) và xuất file trả về (`python-docx`, `docxtpl`) bắt buộc xử lý qua `io.BytesIO` hoặc `tempfile` tự hủy.
   - Tuyệt đối không lưu file tạm xuống thư mục dự án trên ổ đĩa (vì hệ thống tệp của Render sẽ bị xóa trắng mỗi lần restart/deploy).
3. **Kiểm soát giới hạn 512MB RAM của Render Free:**
   - Ưu tiên dùng `httpx` / `requests` + `BeautifulSoup` để đọc nội dung trang web trước; chỉ khởi chạy trình duyệt ảo Playwright khi trang yêu cầu render JavaScript.
   - Khi dùng Playwright, bắt buộc truyền cờ tiết kiệm bộ nhớ (`args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]`), giới hạn tối đa 1 phiên chạy đồng thời (`asyncio.Semaphore(1)`), và luôn đóng `browser.close()` trong khối `finally`.
4. **Chống ngắt kết nối khi server ngủ đông (Cold Start):**
   - Các lệnh `fetch()` gọi xuống Backend phải dùng `AbortController` với timeout tối thiểu `65000ms` (65 giây) để chịu được thời gian đánh thức server miễn phí của Render.

## 3. Checklist chuyển đổi khi có lệnh "Deploy lên Render"
*(Chỉ thực hiện khi người dùng yêu cầu chuyển sang Production/Render)*

- **Bước 1 — Backend (`Smart_Study_Backend/`):**
  - Cập nhật `requirements.txt` đầy đủ phiên bản thư viện (`fastapi`, `uvicorn`, `python-multipart`, `pypdf`, `python-docx`, `docxtpl`, `httpx`, `beautifulsoup4`, `playwright`)[cite: 1].
  - Tạo `Dockerfile` (dùng image chính thức `mcr.microsoft.com/playwright/python` hoặc cài `playwright install chromium --with-deps`) để chạy ổn định trên Render mà không thiếu thư viện hệ thống của Chromium.
  - Cấu hình CORS trong `main.py` cho phép origin `chrome-extension://*` và đọc cổng động `PORT = int(os.environ.get("PORT", 8000))`.
- **Bước 2 — Extension (`Smart_Study_Extension/`):**
  - Thay giá trị `API_BASE_URL` trong `sidebar.js` sang URL HTTPS của Render (ví dụ `https://smart-study-api.onrender.com`).
  - Bổ sung `"https://*.onrender.com/*"` vào mảng `"host_permissions"` trong `manifest.json`.
  - Cập nhật thông báo chờ khi gọi API lần đầu để người dùng biết server đang khởi động nếu gặp Cold Start.