# ChatGPT Sidebar

Tiện ích Chrome / Brave mở ChatGPT trong thanh bên, đọc trang đang xem và chuẩn bị lệnh tóm tắt, dịch hoặc giải thích. Không cần API key.

## Cài hoặc cập nhật

1. Mở `chrome://extensions` (Brave: `brave://extensions`).
2. Bật **Chế độ nhà phát triển**.
3. Chọn **Tải tiện ích đã giải nén** và chọn thư mục này. Nếu đã cài, bấm **Tải lại** trên thẻ tiện ích, sau đó đóng và mở lại sidebar.
4. Bấm biểu tượng tiện ích hoặc **Cmd+Shift+Y** / **Ctrl+Shift+Y**.

Yêu cầu Chrome 116 trở lên hoặc Brave có hỗ trợ Side Panel API. Nếu phím tắt trùng với tiện ích khác, đổi tại `chrome://extensions/shortcuts`.

Bản 1.6.4 đăng ký quy tắc nhúng bằng dynamic rules, tránh tạo cache `_metadata` trong thư mục extension. Nếu cập nhật từ bản cũ có thư mục `_metadata`, chuyển thư mục đó ra ngoài extension rồi bấm **Thử lại** khi tải tiện ích.

## Dùng nhanh

- Mở trang web, bấm **Đưa vào ô chat**. Tiện ích đọc văn bản hiển thị (tối đa 12.000 ký tự) và đoạn đang chọn, rồi điền lệnh vào ChatGPT. Bạn tự kiểm tra và bấm gửi.
- Bấm biểu tượng tia sét để chọn **Tóm tắt trang** hoặc mẫu lệnh dịch, sửa văn bản, giải thích, soạn email.
- Bôi đen văn bản → chuột phải → chọn tác vụ ChatGPT. Lệnh được giữ trong bộ nhớ đến khi điền thành công, kể cả khi sidebar chưa mở.
- Đăng nhập ChatGPT trên tab thông thường, rồi tải lại sidebar.

## Khi ChatGPT không tải trong sidebar

Khung nhúng phụ thuộc vào xác thực và chính sách cookie của ChatGPT / trình duyệt. Sau 15 giây chưa tìm được ô chat, tiện ích hiện phần hướng dẫn và nội dung đã chuẩn bị.

Bấm **Mở tab ChatGPT / Đưa nội dung** để mở hoặc dùng lại tab ChatGPT và điền nội dung. Nếu chưa đăng nhập, đăng nhập rồi bấm lại; bạn cũng có thể **Sao chép nội dung** và dán bằng Cmd+V / Ctrl+V. Các công cụ đọc trang chỉ chuẩn bị nội dung; tính năng điền form gửi yêu cầu phân tích khi bạn bấm nút phân tích.

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

## Điền form bằng AI trong sidebar (1.6.3)

Tính năng dùng cho biểu mẫu tổng quát: đăng ký, liên hệ, khảo sát, hồ sơ, nội dung sản phẩm và các form văn bản khác. AI hiểu mục đích từng ô theo nhãn và thông tin bạn nhập.

1. Mở trang chứa form cần điền, mở sidebar và bấm biểu tượng **▤ Điền form bằng AI**.
2. Bấm **Quét ô nhập trên trang**. Extension nhận diện các ô văn bản, textarea, số, ngày và vùng soạn thảo đang hiển thị, gồm iframe có quyền truy cập và Shadow DOM mở. Không đọc/điền password, hidden, disabled, readonly, checkbox, radio hay select. Tối đa 300 ô mỗi lần quét.
3. Chọn chế độ rồi nhập **Nội dung** và hướng dẫn thêm nếu cần:
   - **Điền đúng dữ liệu nguồn**: chỉ trích dữ kiện bạn cung cấp; thiếu hoặc mơ hồ thì để trống. Đây là chế độ mặc định.
   - **AI tự hoàn thiện**: chỉ cần vài thông tin chính. AI chủ động viết thêm, suy luận hoặc tạo nội dung mẫu cho các phần còn thiếu. Dữ liệu gốc được ưu tiên; phần bổ sung được phân loại và ghi rõ căn cứ/giả định trong kết quả. Nội dung bổ sung được điền thẳng vào form, gồm cả số, ngày và dữ liệu liên hệ; không thêm tiền tố, nhãn cảnh báo cạnh ô hoặc bước xác nhận. Căn cứ/giả định chỉ hiển thị trong kết quả của sidebar. Khi cần thông tin công khai, prompt yêu cầu ChatGPT tìm kiếm web nếu có công cụ và trả nguồn. Các liên kết do AI cung cấp được hiển thị để kiểm tra; extension không tự xác minh nội dung nguồn hoặc bảo đảm ChatGPT đã tìm kiếm. Không có nguồn thì AI phải ghi là suy luận/mẫu, hoặc để trống.
4. Bấm **Phân tích trong sidebar**. Nội dung nguồn và nhãn các ô được gửi vào chính ChatGPT đang mở trong sidebar, bằng tài khoản bạn đang đăng nhập. Extension hiện phần chat để bạn theo dõi, không mở tab AI mới. Khi có kết quả, phần điền form tự hiện lại. Bấm **Xem điền form** để quay lại phần điều khiển bất cứ lúc nào. Nếu ChatGPT chưa sẵn sàng, bấm **Xem AI trong sidebar**, xử lý đăng nhập/xác thực rồi **Thử lại AI**.
5. Mặc định bật **Tự điền form khi AI trả kết quả**: extension đọc kết quả hợp lệ và tự điền vào các ô trống có dữ kiện nguồn; chế độ tự hoàn thiện còn điền nội dung AI bổ sung, gồm cả số/ngày/liên hệ, không cần xác nhận thêm. Kiểm tra các giả định trước khi gửi form. Các ô thiếu căn cứ hoặc lời giải thích, sai định dạng, bị thay thế hoặc đã được bạn sửa sẽ được bỏ qua. Kết quả hiện số ô đã điền và lý do bỏ qua. Bạn có thể tắt tự điền trước khi phân tích để xem đề xuất trước. **Cho phép ghi đè** cần được bật trước khi phân tích nếu muốn tự thay nội dung đã có; nếu chỉnh giá trị sau đó, bấm **Điền lại các ô đã chọn**.
6. **Hoàn tác** khôi phục các ô của lần điền gần nhất; các ô bạn sửa tiếp sau đó được giữ nguyên.

Form được gắn với đúng tab và tài liệu đã quét, trong suốt quá trình ChatGPT trả lời trong sidebar. Nếu tải lại, đổi trang hoặc ô bị thay thế, hãy quét lại. Tiện ích không bấm nút gửi biểu mẫu; website vẫn có thể tự lưu khi ô nhập thay đổi.

Chế độ dữ liệu nguồn không tự bổ sung thông tin còn thiếu. Chế độ tự hoàn thiện cho phép suy luận và tạo nội dung mẫu phù hợp từng biểu mẫu; căn cứ và giả định được ghi trong kết quả sidebar. Việc đối chiếu đoạn trích không bảo đảm diễn giải chính xác; không chế độ nào bảo đảm chính xác hoàn toàn.

Dữ liệu nguồn của tính năng này không ghi vào `storage.local`. Phiên quét và phân tích dùng `storage.session` của trình duyệt; nội dung nguồn và prompt được xóa khỏi phiên sau khi nhận kết quả hợp lệ hoặc hủy. Chat đã gửi vẫn nằm trong tài khoản ChatGPT và có thể được quản lý tại ChatGPT. Giới hạn nội dung nguồn 50.000 ký tự, hướng dẫn thêm 4.000 ký tự.

Extension tự tìm JSON của đúng phiên trong các kiểu khung trả lời/mã của ChatGPT, kể cả khi có chữ giải thích quanh JSON hoặc phần yêu cầu đã bị thu gọn. Kết quả được gửi lại đến khi sidebar nhận thành công rồi tự điền theo thiết lập. Không cần sao chép/dán JSON. Nếu muốn đọc lại câu trả lời đã có, bấm **Đọc lại kết quả AI**; thao tác này không gửi thêm yêu cầu phân tích.

Phân tích form có thể tiếp tục trong cuộc chat đang mở; câu trả lời được lấy từ đúng lượt phân tích mới. Nếu ô ChatGPT có bản nháp khác hoặc đang trả lời, extension giữ nguyên và yêu cầu bạn xử lý trước. Khi mở lại sidebar, extension tiếp tục đọc kết quả của phiên đang chờ. Nếu đã ghi nhận địa chỉ cuộc chat, sidebar mở lại đúng cuộc chat đó. Nếu ChatGPT chưa tạo địa chỉ cuộc chat hoặc cuộc chat không tải được, dùng **Thử lại AI** để phân tích lại.
