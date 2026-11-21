# 🎓 Smart Study

**Smart Study** là trợ lý học tập và xử lý tài liệu trên trình duyệt, giúp tổng hợp nội dung, tạo câu hỏi ôn tập, hỗ trợ học từ vựng và xuất tài liệu gọn gàng ngay trong quá trình đọc tài liệu hoặc xem video.

---

## 🌟 1. Sản phẩm này làm được gì?

- **Tóm tắt & khai thác nội dung nhanh:** Hỗ trợ tóm tắt nội dung trang web hoặc video theo nhiều mức độ, rút trích ý chính và từ khóa quan trọng để học nhanh hơn.
- **Tạo đề & luyện tập ôn tập:** Tạo câu hỏi trắc nghiệm từ tài liệu/nội dung học tập, kèm giải thích đáp án và hỗ trợ ôn lại các câu dễ nhầm lẫn.
- **Học từ vựng & ghi nhớ chủ động:** Lưu từ vựng theo từng chủ đề/ngữ cảnh, ôn tập lặp lại theo từng cấp độ và luyện phản xạ/đặt câu.
- **Xuất tài liệu:** Hỗ trợ xuất nội dung học tập và biểu mẫu tài liệu ra định dạng phổ biến để lưu trữ hoặc chỉnh sửa thêm.
- **Linh hoạt API Key:** Có thể sử dụng key cấu hình sẵn trên hệ thống (nếu được bật) hoặc tự nhập API Key cá nhân tại phần Cài đặt khi cần chủ động hạn mức sử dụng.

---

## 🛠️ 2. Quá trình mình xây dựng & hoàn thiện

Dự án được mình phát triển theo hướng thực tế, ưu tiên trải nghiệm gọn nhẹ và dễ dùng cho người học:

1. **Từ ý tưởng đến chia tách cấu trúc:** Ban đầu mình muốn có một công cụ hỗ trợ đọc tài liệu, tóm tắt và ôn tập ngay bên cạnh trình duyệt. Sau đó mình tách riêng phần giao diện tiện ích trên trình duyệt và phần xử lý phía sau để dễ bảo trì và mở rộng.
2. **Tinh chỉnh luồng sử dụng thực tế:** Trong quá trình làm, mình tập trung xử lý các tình huống người dùng hay gặp như tài liệu dài, nội dung lộn xộn, cần ôn tập lại chỗ hay sai và cần cơ chế dự phòng khi chạm giới hạn lượt dùng API.
3. **Đưa lên môi trường triển khai:** Sau khi hoàn thiện các luồng chính và kiểm tra ổn định, mình đưa phần xử lý phía sau lên cloud và đóng gói tiện ích để người dùng chỉ cần cài trên trình duyệt là có thể trải nghiệm.

*(Một số chi tiết kỹ thuật, quy trình kiểm thử và cấu hình nội bộ mình giữ riêng để phục vụ việc phát triển và bảo trì sản phẩm.)*

---

## 📥 3. Hướng dẫn cài đặt & dùng thử Extension

1. **Tải tiện ích về máy:** Tải mã nguồn hoặc file `.zip` của phần Extension và giải nén vào một thư mục trên máy tính.
2. **Nạp vào trình duyệt Chrome / Edge:**
   - Mở trình duyệt và truy cập `chrome://extensions/` (hoặc `edge://extensions/`).
   - Bật chế độ **Developer mode** (Chế độ dành cho nhà phát triển).
   - Bấm **Load unpacked** (Tải tiện ích đã giải nén) và chọn thư mục Extension vừa giải nén.
3. **Bắt đầu sử dụng:**
   - Mở **Smart Study** trên thanh bên của trình duyệt.
   - Vào phần **Cài đặt** để kiểm tra hoặc nhập **API Key** cá nhân nếu cần (hoặc khi hệ thống thông báo hết lượt dùng/quota).
   - Chọn tính năng bạn muốn dùng và trải nghiệm trực tiếp trên tài liệu hoặc trang web đang mở.

---

## 📌 4. Ghi chú bản quyền

Dự án **Smart Study** do **Đoàn Văn Thiên Hoàng** phát triển. Vui lòng không sao chép nguyên bản mã nguồn, giao diện hoặc tài liệu của dự án cho mục đích thương mại hay đăng lại như sản phẩm của cá nhân/tổ chức khác khi chưa có sự đồng ý.
