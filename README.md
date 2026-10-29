# ChatGPT Sidebar

Tiện ích Chrome / Brave mở ChatGPT trong thanh bên, đọc trang đang xem và chuẩn bị lệnh tóm tắt, dịch hoặc giải thích. Không cần API key.

## Cài hoặc cập nhật

1. Mở `chrome://extensions` (Brave: `brave://extensions`).
2. Bật **Chế độ nhà phát triển**.
3. Chọn **Tải tiện ích đã giải nén** và chọn thư mục này. Nếu đã cài, bấm **Tải lại** trên thẻ tiện ích, sau đó đóng và mở lại sidebar. Phím tắt sẽ gắn mã mới vào tab web được hỗ trợ, không cần tải lại trang nguồn. Tab ChatGPT do extension quản lý tự cập nhật bộ đọc khi cần.
4. Bấm biểu tượng tiện ích hoặc **Cmd+Shift+Y** / **Ctrl+Shift+Y**.

Yêu cầu Chrome 116 trở lên hoặc Brave có hỗ trợ Side Panel API. Nếu phím tắt trùng với tiện ích khác, đổi tại `chrome://extensions/shortcuts`.

## Thư viện tài liệu (1.8.0)

Mục **Tài liệu** trong sidebar dùng cho nhiều chủ đề, không giới hạn ở bộ ôn thi Da liễu. Không cần API key; extension gửi tệp và câu hỏi tới tài khoản ChatGPT đang đăng nhập trên Brave / Chrome.

1. Mở **Tài liệu**, nhập tên rồi bấm **Tạo bộ**. Mỗi bộ có danh sách tệp và lịch sử hỏi đáp riêng; có thể đổi tên hoặc xóa bộ.
2. Bấm **Thêm tài liệu** hoặc kéo thả nhiều tệp **PDF, DOCX, PPTX, TXT**. Mỗi tệp tối đa **50 MiB**, mỗi bộ tối đa **20 tệp**. Tệp trùng nội dung trong cùng bộ không được thêm lần nữa. Danh sách hiển thị dung lượng và trạng thái đang chuẩn bị, đang tải lên ChatGPT, sẵn sàng hoặc lỗi.
3. Extension lưu bản sao tệp trong IndexedDB của hồ sơ trình duyệt, rồi tải từng tệp lên cuộc chat dành cho phiên bản bộ đó. Chờ trạng thái **Sẵn sàng** để biết các lượt chứa tệp đã được gửi và ChatGPT xác nhận đọc được tài liệu. Giới hạn tải tệp của tài khoản ChatGPT vẫn có thể áp dụng dù tệp nằm trong giới hạn của extension.
4. Nhập câu hỏi trong **Hỏi tài liệu** rồi bấm **Gửi câu hỏi**. Kết quả nằm trong lịch sử của bộ. Prompt yêu cầu phân biệt **Theo tài liệu** và **ChatGPT bổ sung**, nêu tên tệp, trang hoặc mục khi xác định được; extension không tự kiểm chứng việc trích nguồn hay độ chính xác của AI.
5. Bấm **Dùng bộ này** để chọn nguồn cho **Phân tích ngay**, **Tự động phân tích** và **Shift + Option + Q**. Phân tích trang xuất hiện trong lịch sử tài liệu; đáp án tự động tiếp tục dùng popup trên trang nguồn. **Ngừng dùng** trở về phân tích không có bộ tài liệu được chọn.

Cửa sổ ChatGPT xử lý được mở riêng rồi thu nhỏ trước khi tải trang ChatGPT. Các thao tác tự tải tệp, điền nội dung, gửi và đọc phản hồi không yêu cầu chuyển tiêu điểm. Hàng đợi chạy ở background nên đóng sidebar vẫn tiếp tục; mỗi cuộc chat xử lý một lượt tại một thời điểm, câu hỏi trực tiếp được ưu tiên giữa các đợt phân tích. Chỉ nút **Mở ChatGPT** mới chủ động khôi phục cửa sổ để bạn xử lý đăng nhập, giới hạn tài khoản hoặc bản nháp.

Khi thêm hoặc bỏ tệp, extension tạo **phiên bản tài liệu mới và cuộc chat mới**; các tệp còn lại được đồng bộ vào cuộc chat đó. Lượt đáp án đang chạy giữ nguyên phiên bản nguồn đến khi dừng; lần bật sau dùng bộ đang chọn và phiên bản mới. Lịch sử hỏi đáp vẫn giữ các lượt cũ và ghi rõ nếu thuộc phiên bản trước. Xóa cả bộ sẽ dừng những lượt liên quan.

Nguồn PDF từ bản 1.7.3 được chuyển thành **bộ đã liên kết** với cuộc chat cũ. Bộ này tiếp tục dùng được nhưng không có bản sao PDF trong kho cục bộ. Muốn quản lý tệp tại đây, chọn lại đầy đủ tài liệu để tạo phiên bản mới; extension không giả lập danh sách hai PDF cũ.

Khi xảy ra lỗi, dùng **Thử lại** hoặc **Đọc lại ChatGPT**. Nếu chưa rõ một lượt đã gửi hay chưa, extension đọc lại hội thoại trước; **Gửi lại lượt chưa có kết quả** chỉ xuất hiện sau lần đọc lại. Không tự gửi lặp một lượt đang chưa rõ trạng thái. Dữ liệu hàng đợi dùng `chrome.storage.session` để phục hồi khi service worker khởi động lại; trình duyệt và cửa sổ ChatGPT cần tiếp tục chạy.

Tệp, lịch sử và thông tin bộ được lưu trong hồ sơ trình duyệt; bộ đang chọn nằm trong `chrome.storage.local`. Nội dung đã gửi còn nằm trong tài khoản ChatGPT. **Bỏ tệp hoặc xóa bộ trong extension không xóa cuộc chat hay tệp trên ChatGPT**; quản lý các bản đã gửi tại ChatGPT. Nội dung bên trong tài liệu được coi là dữ liệu tham khảo, không phải lệnh điều khiển extension.

## Đáp án tự động trên trang web

**Shift + Option + Q** trên Mac (**Alt + Shift + Q** trên Windows/Linux) bật/tắt đáp án trên tab web đang mở, không giới hạn ở Vinmec và không tự mở sidebar. Nếu phím tắt chưa được gán hoặc bị trùng, đổi tại `brave://extensions/shortcuts` / `chrome://extensions/shortcuts`.

- Extension tìm câu hỏi văn bản cùng các lựa chọn trên trang và trong iframe có quyền truy cập. Gán A/B/C theo thứ tự hiển thị, giữ số câu gốc và nhận biết câu nhiều lựa chọn khi cấu trúc trang cho phép. Trang dùng cấu trúc chưa nhận diện được sẽ báo không tìm thấy câu hỏi; không bảo đảm nhận diện mọi website. Trang hệ thống trình duyệt và các trang bị trình duyệt chặn quyền truy cập không được hỗ trợ.
- Chế độ theo dõi câu mới khi thay đổi trang trong cùng tab. Mỗi đợt tối đa **5 câu**, mục tiêu dưới **16.000 ký tự**; câu riêng quá ngưỡng được gửi riêng, giữ đầy đủ nội dung. Câu đã xử lý được ghi nhớ theo số câu, nội dung, thứ tự lựa chọn và phiên bản tài liệu để tránh gửi lại do đồng hồ, chọn đáp án hoặc tải lại trang.
- Đáp án cập nhật ở **giữa cạnh dưới trang**. Popup chỉ chứa chuỗi đáp án, nền hoàn toàn trong suốt, dùng font và cỡ chữ của câu hỏi đang hiển thị; chưa có đáp án thì không hiện. Ví dụ **`3D?, 4F, 5C?, 6B-D?, 7?`**: dấu `?` sau chữ cái là phần ChatGPT bổ sung khi thiếu căn cứ trong bộ tài liệu; `7?` là chưa xác định được đáp án. Dữ kiện ảnh hoặc âm thanh chưa đọc được cũng được đánh dấu `?`.
- Nhấn lại phím tắt hoặc tắt công tắc **Đáp án tự động** trong Cài đặt để ngừng các lượt tiếp theo và ẩn hoàn toàn đáp án. Không có nút **Đáp án** nổi khi tắt. Bật lại sẽ đọc lại lượt đã gửi đang chờ trước khi gửi tiếp. Tiến độ, lỗi và nút xử lý nằm trong Cài đặt hoặc mục Tài liệu nếu đang dùng bộ tài liệu.
- Extension chỉ đọc nội dung; việc chọn và nộp đáp án do người dùng thực hiện. Khi đáp án tự động bật, phân tích trang thông thường tạm ngưng trên tab nguồn để tránh gửi trùng. Bấm **✕ Đóng sidebar** hoặc nút X của trình duyệt để đóng hẳn sidebar; hàng đợi và popup vẫn hoạt động. Nút đóng riêng dùng Side Panel API từ Chrome 141, trình duyệt cũ dùng X sẵn có.

Nếu ChatGPT cần đăng nhập, hết hạn mức, có bản nháp khác, trả sai định dạng hoặc cửa sổ nền bị đóng, xem trạng thái rồi dùng **Mở ChatGPT**, **Đọc lại ChatGPT** hoặc nút thử lại tương ứng. Chế độ không tự bật lại sau khi khởi động lại trình duyệt. Kết quả AI cần được đối chiếu với tài liệu.

## Dùng nhanh

- Mở trang web, bấm **Đưa vào ô chat**. Tiện ích đọc văn bản hiển thị (tối đa 12.000 ký tự) và đoạn đang chọn, rồi điền lệnh vào ChatGPT. Bạn tự kiểm tra và bấm gửi.
- Bấm **Phân tích ngay** để lấy nội dung trang (hoặc đoạn đang chọn) và tự gửi cho ChatGPT. Nếu đã chọn bộ tài liệu, kết quả nằm trong lịch sử của bộ; nếu chưa chọn bộ, phân tích dùng ChatGPT trong sidebar. Nếu ChatGPT đang trả lời hoặc ô chat có bản nháp khác, tiện ích báo để bạn xử lý rồi bấm lại. Thao tác này không tự gửi lại khi tải lại sidebar.
- Giao diện tiện ích và ChatGPT nhúng dùng **light mode**. Bấm biểu tượng bánh răng **Cài đặt** → bật **Tự động phân tích** để tự lấy nội dung và gửi phân tích khi chuyển tab, đổi địa chỉ (kể cả trang không tải lại toàn bộ) hoặc tải lại trang. Cài đặt được lưu, mặc định tắt. Khi bật sẽ phân tích luôn trang hiện tại; chỉ hoạt động khi sidebar đang mở. Tiện ích chờ trang tải xong và ô chat trống, chờ lượt trả lời/phân tích form kết thúc, rồi chỉ xử lý trang mới nhất. Không tự phân tích tab ChatGPT, trang hệ thống hay Chrome Web Store. Có thể tắt công tắc để hủy yêu cầu đang chờ; nội dung đã gửi vẫn ở trong cuộc chat.
- Bấm biểu tượng tia sét để chọn **Tóm tắt trang** hoặc mẫu lệnh dịch, sửa văn bản, giải thích, soạn email.
- Bôi đen văn bản → chuột phải → chọn tác vụ ChatGPT. Lệnh được giữ trong bộ nhớ đến khi điền thành công, kể cả khi sidebar chưa mở.
- Đăng nhập ChatGPT trên tab thông thường, rồi tải lại sidebar.

## Khi ChatGPT không tải trong sidebar

Khung nhúng phụ thuộc vào xác thực và chính sách cookie của ChatGPT / trình duyệt. Sau 15 giây chưa tìm được ô chat, tiện ích hiện phần hướng dẫn và nội dung đã chuẩn bị.

Bấm **Mở tab ChatGPT / Đưa nội dung** để mở hoặc dùng lại tab ChatGPT và điền nội dung. Nếu chưa đăng nhập, đăng nhập rồi bấm lại; bạn cũng có thể **Sao chép nội dung** và dán bằng Cmd+V / Ctrl+V. Nút **Phân tích ngay** gửi yêu cầu trong sidebar khi ChatGPT sẵn sàng; nếu chưa sẵn sàng, kiểm tra chat rồi bấm lại. Tính năng điền form gửi yêu cầu phân tích khi bạn bấm nút phân tích.

Không đọc được trang hệ thống trình duyệt, Chrome Web Store hoặc trang chưa có văn bản. Hãy chuyển sang một trang web thông thường.

## Quyền truy cập

Tiện ích cần đọc trang web khi bạn bấm lấy nội dung hoặc bật chế độ tự động, quản lý cửa sổ/tab ChatGPT, sao chép lệnh, lưu tệp và lệnh chờ, tạo menu chuột phải. Chế độ tự động lưu dấu trang đã xử lý trong bộ nhớ phiên để tránh gửi lặp khi mở lại sidebar; không tự sao chép đè clipboard. Chỉ khung nhúng ChatGPT được xử lý các header chặn iframe; tab đăng nhập và các tài nguyên khác giữ header của website.

## Kiểm tra mã

```sh
node --check background.js
node --check content/chatgpt-inject.js
node --check sidepanel/sidepanel.js
node --test tests/quiz.test.cjs tests/chatgpt-background.test.cjs tests/documents.test.cjs
```

Không cần cài dependencies hay chạy build. Mã JavaScript và tài nguyên được tải trực tiếp bởi trình duyệt.

Các bộ kiểm tra DOM dùng Playwright và một hồ sơ trình duyệt thử nghiệm riêng. Có thể đặt `PLAYWRIGHT_MODULE` thành đường dẫn module và `BROWSER_EXECUTABLE_PATH` thành đường dẫn Chromium/Brave, rồi chạy `node --test tests/*.test.cjs`. Nếu không tìm thấy Playwright thì các ca cần trình duyệt được bỏ qua; các ca hàng đợi và phục hồi vẫn chạy bằng Node.

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
