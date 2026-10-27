# Chính sách quyền riêng tư của Zenlo

Cập nhật: 27/10/2026

Zenlo là một tiện ích cho Zalo PC, chạy hoàn toàn trên máy tính của bạn. Trang này nói rõ Zenlo đọc gì, gửi gì, gửi đi đâu và lưu ở đâu.

## Tóm tắt

- **Zenlo không có máy chủ.** Tác giả Zenlo không nhận, không lưu và không thấy được tin nhắn, tài khoản hay bất kỳ dữ liệu nào của bạn.
- **Không tài khoản, không quảng cáo, không theo dõi.** Ứng dụng Zenlo không gửi số liệu sử dụng (telemetry) đi đâu cả. Trang web của Zenlo chỉ đếm lượt xem ẩn danh, không dùng cookie (xem [Trang web](#trang-web)).
- **Tin nhắn chỉ được gửi tới dịch vụ AI do chính bạn chọn**, và chỉ khi bạn bấm Tóm tắt hoặc Tạo bản tin.

## Zenlo đọc gì

Khi bạn bấm **Tóm tắt** hoặc **Tạo bản tin**, Zenlo đọc từ dữ liệu Zalo đã lưu trên máy bạn:

- nội dung các tin nhắn trong khoảng thời gian bạn chọn (hoặc các tin chưa đọc), tên hiển thị của người gửi, thời gian gửi;
- số người thả cảm xúc cho từng tin, và tin nào nhắc tới bạn;
- tên Zalo của bạn, để AI biết tin nào đang nói với bạn;
- ghi chú bạn tự viết cho hội thoại đó (nút Ghi chú), nếu có;
- số tin chưa đọc mà Zalo ghi nhận.

Zenlo không đọc ảnh, video, tệp đính kèm hay tin nhắn thoại; chỉ đọc tên tệp và chú thích ảnh nếu có. Việc đọc này không làm Zalo gửi trạng thái "Đã xem" cho ai.

## Zenlo gửi gì, gửi đi đâu

Zenlo chỉ gửi đi phần tin nhắn cần tóm tắt, kèm lời yêu cầu tóm tắt và ghi chú của bạn cho hội thoại đó (nếu có), tới **một** trong ba dịch vụ AI mà bạn chọn trong Cài đặt:

| Dịch vụ | Cách Zenlo gửi | Dữ liệu được dùng thế nào |
|---|---|---|
| **ChatGPT** (OpenAI) | Qua Codex đã cài và đăng nhập trên máy bạn, dùng gói ChatGPT của bạn | Theo chính sách của OpenAI cho tài khoản ChatGPT của bạn. Với gói cá nhân, OpenAI có thể dùng nội dung để cải thiện model trừ khi bạn tắt mục cải thiện mô hình trong Kiểm soát dữ liệu của ChatGPT |
| **Claude** (Anthropic) | Qua Claude Code đã cài và đăng nhập trên máy bạn, dùng gói Claude Pro/Max của bạn | Theo chính sách của Anthropic cho tài khoản Claude của bạn |
| **Gemini** (Google) | Gửi thẳng tới `generativelanguage.googleapis.com` bằng API key của bạn | **Với key miễn phí, Google có thể dùng nội dung gửi lên để huấn luyện và cải thiện sản phẩm**, gồm cả tin nhắn của những người khác trong hội thoại. Với key trả phí thì không |

Kết nối luôn được mã hoá (HTTPS). Zenlo không gửi dữ liệu tới bất kỳ địa chỉ nào khác, trừ một trường hợp: khi bạn bấm **Kiểm tra bản mới** trong Cài đặt, hoặc đồng ý cho Zenlo tự kiểm tra mỗi ngày (Zenlo hỏi một lần khi mở lần đầu), Zenlo hỏi GitHub (`api.github.com`) bản mới nhất là bản nào. Yêu cầu này không chứa tin nhắn, ghi chú hay thông tin nào về bạn.

Vì tin nhắn trong nhóm có cả nội dung của người khác, hãy cân nhắc trước khi gửi những hội thoại nhạy cảm tới dịch vụ AI.

## Mọi kết nối mạng của Zenlo

Ngoài các trường hợp dưới đây, ứng dụng Zenlo không kết nối tới đâu cả. Bộ cài `Zenlo-Setup.exe` không kết nối mạng.

| Khi nào | Tới đâu | Gửi gì |
|---|---|---|
| Khi bạn bấm **Tóm tắt** hoặc **Tạo bản tin** | Dịch vụ AI bạn chọn (Google, Anthropic hoặc OpenAI) | Tin nhắn cần tóm tắt, lời yêu cầu, ghi chú của bạn (bảng ở trên) |
| Khi đã lưu key Gemini: lúc mở Cài đặt hoặc lúc tóm tắt bằng Gemini, tối đa mỗi giờ một lần | `generativelanguage.googleapis.com`, bằng key của bạn | Chỉ hỏi danh sách model key của bạn dùng được; không có tin nhắn |
| Khi bạn bấm **Kiểm tra kết nối** | Dịch vụ AI bạn chọn | Một câu thử ngắn, không có tin nhắn. Với Codex, Zenlo hỏi thêm danh sách model của tài khoản (lệnh `codex debug models`). Với Claude, Zenlo chỉ đọc danh sách model Claude Code đã lưu trên máy, không gửi gì |
| Khi bạn bấm **Kiểm tra bản mới**, hoặc mỗi ngày một lần nếu bạn chọn **Có** khi Zenlo hỏi "Báo cho bạn khi có Zenlo bản mới?" | `api.github.com` | Chỉ hỏi số phiên bản mới nhất; không có tin nhắn, ghi chú hay thông tin về bạn. Tắt bằng cách bỏ chọn "Tự kiểm tra bản mới mỗi ngày" |
| Khi bạn bấm một link (trong bản tóm tắt, trong Cài đặt) | Trang web của link đó, mở trong trình duyệt của bạn | Như khi bạn tự mở link |

Claude Code và Codex là chương trình của Anthropic và OpenAI cài trên máy bạn; chúng tự kết nối tới máy chủ của hãng theo chính sách của hãng. Khi Zenlo gọi chúng, Zenlo tắt thống kê và các kết nối không cần thiết mà chúng cho phép tắt.

## Zenlo lưu gì, ở đâu

Mọi thứ chỉ nằm trên máy bạn:

| Dữ liệu | Nơi lưu |
|---|---|
| Cài đặt, ghi chú cho AI, bản tóm tắt gần nhất của từng hội thoại, kết quả Bản tin, thứ tự và ô tick trong Bản tin | Bộ nhớ của Zalo trên máy (`%APPDATA%\ZaloData`) |
| Bản sao lưu của mục trên | `%APPDATA%\Zenlo\storage-backup.json` |
| API key Gemini | `%APPDATA%\Zenlo\secrets.json`, **được mã hoá bằng Windows** (chỉ tài khoản Windows của bạn giải mã được) |
| Ghi nhận model nào hết lượt trong ngày | `%APPDATA%\Zenlo\gemini-quota.json` |

## Xoá dữ liệu

- Trong Zenlo: **Cài đặt → Xoá bản tóm tắt đã lưu**, và xoá từng API key bằng nút ✕.
- Gỡ Zenlo bằng bộ cài (chọn **Gỡ Zenlo**), rồi xoá thư mục `%APPDATA%\Zenlo` nếu muốn xoá sạch.

## Trang web

Trang web của Zenlo (stephitnoob.github.io/zenlo) đếm lượt xem bằng [GoatCounter](https://www.goatcounter.com/), một dịch vụ thống kê mã nguồn mở, để tác giả biết có bao nhiêu người ghé xem và bao nhiêu người bấm Tải về.

- **Được gửi đi:** địa chỉ trang đang xem, tiêu đề trang, trang web dẫn bạn tới đây (nếu có), và việc bạn bấm nút Tải về.
- **GoatCounter lưu** từng lượt xem ở dạng ẩn danh: thời gian, trang được xem, trang dẫn tới, loại trình duyệt, hệ điều hành và quốc gia. Địa chỉ IP không được lưu. Để không đếm trùng khi một người tải lại trang, GoatCounter dùng một mã phiên ẩn danh chỉ tồn tại tối đa 8 giờ.
- **Không có:** cookie, mã định danh lâu dài, quảng cáo, hay dữ liệu nào được lưu trong trình duyệt của bạn.

Việc đếm này chỉ có trên trang web, không có trong ứng dụng Zenlo. Toàn bộ mã đếm nằm trong [`site/stats.js`](site/stats.js).

## Liên hệ

Câu hỏi về quyền riêng tư: stephit.zenlo@outlook.com.
