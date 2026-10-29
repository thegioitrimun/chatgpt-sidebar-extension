# ChatGPT Sidebar

Tiện ích Chrome / Brave mở ChatGPT trong thanh bên, đọc trang đang xem và chuẩn bị lệnh tóm tắt, dịch hoặc giải thích. Không cần API key.

## Cài hoặc cập nhật

1. Mở `chrome://extensions` (Brave: `brave://extensions`).
2. Bật **Chế độ nhà phát triển**.
3. Chọn **Tải tiện ích đã giải nén** và chọn thư mục này. Nếu đã cài, bấm **Tải lại** trên thẻ tiện ích, tải lại tab Vinmec và tab ChatGPT nền nếu đang mở, sau đó đóng và mở lại sidebar.
4. Bấm biểu tượng tiện ích hoặc **Cmd+Shift+Y** / **Ctrl+Shift+Y**.

Yêu cầu Chrome 116 trở lên hoặc Brave có hỗ trợ Side Panel API. Nếu phím tắt trùng với tiện ích khác, đổi tại `chrome://extensions/shortcuts`.

## Đáp án tự động trên Vinmec (1.7.1)

Bản này phát triển từ nền 1.7.0, giữ giao diện sáng và chức năng sidebar. Phần đáp án chạy độc lập với sidebar.

1. Mở đề thử trên `https://elearning.vinmec.com/`, nhấn **Shift + Option + Q** trên Mac (**Alt + Shift + Q** trên Windows/Linux), hoặc bật **Cài đặt → Đáp án tự động · Vinmec**. Phím tắt không mở sidebar. Nếu chưa được gán, mở `brave://extensions/shortcuts` và gán cho **Bật/tắt đáp án tự động trên Vinmec**.
2. Extension đọc câu hỏi và lựa chọn đã hiển thị trên trang, gán A/B/C theo thứ tự, rồi mở **một tab ChatGPT riêng ở nền**, sử dụng đăng nhập hiện tại. Mỗi đợt tối đa 5 câu, mục tiêu dưới 16.000 ký tự; câu riêng dài hơn ngưỡng được gửi riêng, không cắt nội dung. Chờ đợt trước xong rồi mới gửi đợt tiếp theo.
3. Đáp án cập nhật dần trong popup nền bán trong suốt **ở giữa cạnh dưới trang**, ví dụ `1A, 2B, 3B-D-E`. Câu thiếu dữ kiện hoặc có hình/âm thanh chưa đọc được hiện `4?`. Extension chỉ đọc văn bản và lựa chọn, không chọn hay nộp đáp án. Thứ tự và số câu được giữ nguyên; kết quả AI vẫn cần được đối chiếu.
4. Bấm **Ẩn** để thu popup thành nút **Đáp án**, bấm lại để mở. Bấm **✕ Đóng sidebar** hoặc nút X của trình duyệt để đóng hẳn sidebar; tab nền và popup vẫn hoạt động. Nút đóng riêng dùng Side Panel API từ Chrome 141; trình duyệt cũ dùng X sẵn có. Mở lại sidebar bằng biểu tượng tiện ích hoặc Cmd+Shift+Y.
5. Nhấn lại phím tắt hoặc bấm **Dừng** để ngừng các lượt tiếp theo và ẩn popup. Bật lại sẽ đọc lại lượt đã gửi đang chờ trước khi gửi tiếp. Tab ChatGPT được giữ lại để bạn xem cuộc chat.

Chế độ gắn với tab Vinmec lúc bật và theo dõi các câu mới khi đổi trang trong tab đó. Câu đã xử lý được ghi nhớ theo số câu, nội dung và thứ tự lựa chọn; đếm ngược, chọn đáp án và tải lại trang không gây gửi lặp. Khi chế độ này bật, phân tích trang thông thường tạm dừng trên tab nguồn.

Nếu ChatGPT cần đăng nhập, đang có bản nháp/đang trả lời, trả sai định dạng hoặc tab nền bị đóng, popup báo trạng thái. **Mở ChatGPT** để xử lý, rồi bấm **Đọc lại ChatGPT**; thao tác đọc lại không gửi prompt. Sau khi đã đọc lại mà chưa nhận được kết quả, **Thử lại câu thiếu** cho phép gửi lại theo yêu cầu của bạn. Không tự gửi lại lượt chưa rõ đã gửi hay chưa.

Trạng thái, câu hỏi, hàng đợi và đáp án dùng `chrome.storage.session` để tiếp tục sau khi worker ngủ hoặc sidebar đóng; phiên không tự bật lại sau khi khởi động lại trình duyệt. Nội dung gửi vẫn nằm trong tài khoản ChatGPT. Quyền `alarms` kiểm tra phục hồi kết nối mỗi phút; trình duyệt và tab ChatGPT cần tiếp tục chạy.

Bản **1.7.2** sửa bộ đọc cho giao diện ChatGPT mới dùng DIL (`data-user-message-bubble` / `data-markdown-text-style`), bên cạnh giao diện cũ. Khắc phục trường hợp AI đã trả lời nhưng popup báo không tìm thấy lượt chat. Chế độ tự chờ khi ChatGPT bận, tự tiếp tục khi sẵn sàng và tự đọc lại lượt đã gửi sau khi kết nối lại; không cần bấm gửi từng đợt. Tab ChatGPT do extension quản lý được tự tải lại một lần khi nâng cấp bộ đọc.

### Dùng PDF làm nguồn đáp án (1.7.3)

1. Tạo một cuộc chat ChatGPT riêng, đính kèm các PDF cần dùng và gửi tin nhắn giới thiệu tài liệu. Giữ cuộc chat trong tài khoản đã đăng nhập trên Brave.
2. Mở **Cài đặt → Tài liệu tham khảo**, bật công tắc, đặt tên bộ tài liệu và dán địa chỉ cuộc chat dạng `https://chatgpt.com/c/…`, rồi bấm **Lưu nguồn**. Extension lưu địa chỉ riêng trên máy trong `chrome.storage.local`; không lưu hoặc đưa PDF vào mã nguồn.
3. Tắt rồi bật đáp án bằng **Shift + Option + Q** để áp dụng. Tab ChatGPT nền mở đúng cuộc chat chứa PDF, tất cả các đợt gửi tiếp vào cuộc chat đó. Prompt yêu cầu tra PDF, đối chiếu nội dung từng lựa chọn và gán lại A/B/C theo đề hiện tại; thiếu căn cứ, không đọc được tài liệu hoặc nguồn mâu thuẫn thì trả `?`.
4. Lưu nguồn mới chỉ áp dụng ở lần bật tiếp theo; lượt đang chạy giữ nguồn cũ đến khi dừng. Mỗi lần **Lưu nguồn** bỏ bộ nhớ đáp án cũ ở lần bật sau, kể cả khi thêm/thay PDF trong cùng cuộc chat. Tắt nguồn PDF và lưu để trở về phân tích thông thường.

Tab xử lý không tự chuyển sang cuộc chat khác nếu cuộc chat tài liệu lỗi hoặc bị đổi địa chỉ. Popup báo để bạn kiểm tra ChatGPT. Việc đọc PDF do ChatGPT thực hiện; extension không kiểm chứng độc lập nội dung đã được truy xuất và không bảo đảm mọi câu trả lời đều đúng. Câu có hình trên trang đề vẫn được đánh dấu `?` vì extension chưa gửi hình.

Bản 1.6.4 đăng ký quy tắc nhúng bằng dynamic rules, tránh tạo cache `_metadata` trong thư mục extension. Nếu cập nhật từ bản cũ có thư mục `_metadata`, chuyển thư mục đó ra ngoài extension rồi bấm **Thử lại** khi tải tiện ích.

## Dùng nhanh

- Mở trang web, bấm **Đưa vào ô chat**. Tiện ích đọc văn bản hiển thị (tối đa 12.000 ký tự) và đoạn đang chọn, rồi điền lệnh vào ChatGPT. Bạn tự kiểm tra và bấm gửi.
- Bấm **Phân tích ngay** để lấy nội dung trang (hoặc đoạn đang chọn), đưa vào ô chat và tự gửi cho ChatGPT phân tích trong sidebar. Nếu ChatGPT đang trả lời hoặc ô chat có bản nháp khác, tiện ích báo để bạn xử lý rồi bấm lại. Thao tác này không tự gửi lại khi tải lại sidebar.
- Giao diện tiện ích và ChatGPT nhúng dùng **light mode**. Bấm biểu tượng bánh răng **Cài đặt** → bật **Tự động phân tích** để tự lấy nội dung và gửi phân tích khi chuyển tab, đổi địa chỉ (kể cả trang không tải lại toàn bộ) hoặc tải lại trang. Cài đặt được lưu, mặc định tắt. Khi bật sẽ phân tích luôn trang hiện tại; chỉ hoạt động khi sidebar đang mở. Tiện ích chờ trang tải xong và ô chat trống, chờ lượt trả lời/phân tích form kết thúc, rồi chỉ xử lý trang mới nhất. Không tự phân tích tab ChatGPT, trang hệ thống hay Chrome Web Store. Có thể tắt công tắc để hủy yêu cầu đang chờ; nội dung đã gửi vẫn ở trong cuộc chat.
- Bấm biểu tượng tia sét để chọn **Tóm tắt trang** hoặc mẫu lệnh dịch, sửa văn bản, giải thích, soạn email.
- Bôi đen văn bản → chuột phải → chọn tác vụ ChatGPT. Lệnh được giữ trong bộ nhớ đến khi điền thành công, kể cả khi sidebar chưa mở.
- Đăng nhập ChatGPT trên tab thông thường, rồi tải lại sidebar.

## Khi ChatGPT không tải trong sidebar

Khung nhúng phụ thuộc vào xác thực và chính sách cookie của ChatGPT / trình duyệt. Sau 15 giây chưa tìm được ô chat, tiện ích hiện phần hướng dẫn và nội dung đã chuẩn bị.

Bấm **Mở tab ChatGPT / Đưa nội dung** để mở hoặc dùng lại tab ChatGPT và điền nội dung. Nếu chưa đăng nhập, đăng nhập rồi bấm lại; bạn cũng có thể **Sao chép nội dung** và dán bằng Cmd+V / Ctrl+V. Nút **Phân tích ngay** gửi yêu cầu trong sidebar khi ChatGPT sẵn sàng; nếu chưa sẵn sàng, kiểm tra chat rồi bấm lại. Tính năng điền form gửi yêu cầu phân tích khi bạn bấm nút phân tích.

Không đọc được trang hệ thống trình duyệt, Chrome Web Store hoặc trang chưa có văn bản. Hãy chuyển sang một trang web thông thường.

## Quyền truy cập

Tiện ích cần đọc trang web khi bạn bấm lấy nội dung hoặc bật tự động phân tích, quản lý tab ChatGPT, sao chép lệnh, lưu lệnh chờ và tạo menu chuột phải. Chế độ tự động lưu dấu trang đã xử lý trong bộ nhớ phiên để tránh gửi lặp khi mở lại sidebar; không tự sao chép đè clipboard. Chỉ khung nhúng ChatGPT được xử lý các header chặn iframe; tab đăng nhập và các tài nguyên khác giữ header của website.

## Kiểm tra mã

```sh
node --check background.js
node --check content/chatgpt-inject.js
node --check sidepanel/sidepanel.js
node --test tests/quiz.test.cjs
```

Không cần cài dependencies hay chạy build. Mã JavaScript và tài nguyên được tải trực tiếp bởi trình duyệt.

Mở `tests/quiz-chat-dom.html` trong trình duyệt để kiểm tra 8 tình huống bộ đọc trên cả hai kiểu giao diện ChatGPT. Kết quả mong đợi là `8 passed`; fixture chỉ chứa dữ liệu mẫu, không gửi tới AI.

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
