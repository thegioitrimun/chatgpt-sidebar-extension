# ChatGPT Sidebar

Tiện ích Chrome / Brave mở ChatGPT trong thanh bên, đọc trang đang xem và chuẩn bị lệnh tóm tắt, dịch hoặc giải thích. Không cần API key.

## Cài hoặc cập nhật

1. Mở `chrome://extensions` (Brave: `brave://extensions`).
2. Bật **Chế độ nhà phát triển**.
3. Chọn **Tải tiện ích đã giải nén** và chọn thư mục này. Nếu đã cài, bấm **Tải lại** trên thẻ tiện ích, sau đó đóng và mở lại sidebar.
4. Bấm biểu tượng tiện ích hoặc **Cmd+Shift+Y** / **Ctrl+Shift+Y**.

Yêu cầu Chrome 116 trở lên hoặc Brave có hỗ trợ Side Panel API. Nếu phím tắt trùng với tiện ích khác, đổi tại `chrome://extensions/shortcuts`.

## Dùng nhanh

- Mở trang web, bấm **Đưa vào ô chat**. Tiện ích đọc văn bản hiển thị (tối đa 12.000 ký tự) và đoạn đang chọn, rồi điền lệnh vào ChatGPT. Bạn tự kiểm tra và bấm gửi.
- Bấm biểu tượng tia sét để chọn **Tóm tắt trang** hoặc mẫu lệnh dịch, sửa văn bản, giải thích, soạn email.
- Bôi đen văn bản → chuột phải → chọn tác vụ ChatGPT. Lệnh được giữ trong bộ nhớ đến khi điền thành công, kể cả khi sidebar chưa mở.
- Đăng nhập ChatGPT trên tab thông thường, rồi tải lại sidebar.

## Khi ChatGPT không tải trong sidebar

Khung nhúng phụ thuộc vào xác thực và chính sách cookie của ChatGPT / trình duyệt. Sau 15 giây chưa tìm được ô chat, tiện ích hiện phần hướng dẫn và nội dung đã chuẩn bị.

Bấm **Mở tab ChatGPT / Đưa nội dung** để mở hoặc dùng lại tab ChatGPT và điền nội dung. Nếu chưa đăng nhập, đăng nhập rồi bấm lại; bạn cũng có thể **Sao chép nội dung** và dán bằng Cmd+V / Ctrl+V. Tiện ích không tự gửi tin nhắn.

Không đọc được trang hệ thống trình duyệt, Chrome Web Store hoặc trang chưa có văn bản. Hãy chuyển sang một trang web thông thường.

## Quyền truy cập

Tiện ích cần đọc trang web khi bạn bấm lấy nội dung, quản lý tab ChatGPT, sao chép lệnh, lưu lệnh chờ và tạo menu chuột phải. Chỉ khung nhúng ChatGPT được xử lý các header chặn iframe; tab đăng nhập và các tài nguyên khác giữ header của website.

## Kiểm tra mã

```sh
node --check background.js
node --check content/chatgpt-inject.js
node --check sidepanel/sidepanel.js
```

Không cần cài dependencies hay chạy build. Mã JavaScript và tài nguyên được tải trực tiếp bởi trình duyệt.
