# Chính sách quyền riêng tư của Zenlo

Cập nhật: 24/10/2026

Zenlo là một tiện ích cho Zalo PC, chạy hoàn toàn trên máy tính của bạn. Trang này nói rõ Zenlo đọc gì, gửi gì, gửi đi đâu và lưu ở đâu.

## Tóm tắt

- **Zenlo không có máy chủ.** Tác giả Zenlo không nhận, không lưu và không thấy được tin nhắn, tài khoản hay bất kỳ dữ liệu nào của bạn.
- **Không tài khoản, không quảng cáo, không theo dõi.** Zenlo không gửi số liệu sử dụng (telemetry) đi đâu cả.
- **Tin nhắn chỉ được gửi tới dịch vụ AI do chính bạn chọn**, và chỉ khi bạn bấm Tóm tắt hoặc Tạo bản tin.

## Zenlo đọc gì

Khi bạn bấm **Tóm tắt** hoặc **Tạo bản tin**, Zenlo đọc từ dữ liệu Zalo đã lưu trên máy bạn:

- nội dung các tin nhắn trong khoảng thời gian bạn chọn (hoặc các tin chưa đọc), tên hiển thị của người gửi, thời gian gửi;
- số người thả cảm xúc cho từng tin, và tin nào nhắc tới bạn;
- tên Zalo của bạn, để AI biết tin nào đang nói với bạn;
- số tin chưa đọc mà Zalo ghi nhận.

Zenlo không đọc ảnh, video, tệp đính kèm hay tin nhắn thoại; chỉ đọc tên tệp và chú thích ảnh nếu có. Việc đọc này không làm Zalo gửi trạng thái "Đã xem" cho ai.

## Zenlo gửi gì, gửi đi đâu

Zenlo chỉ gửi đi phần tin nhắn cần tóm tắt, kèm lời yêu cầu tóm tắt, tới **một** trong hai dịch vụ AI mà bạn chọn trong Cài đặt:

| Dịch vụ | Cách Zenlo gửi | Dữ liệu được dùng thế nào |
|---|---|---|
| **Claude** (Anthropic) | Qua Claude Code đã cài và đăng nhập trên máy bạn, dùng gói Claude Pro/Max của bạn | Theo chính sách của Anthropic cho tài khoản Claude của bạn |
| **Gemini** (Google) | Gửi thẳng tới `generativelanguage.googleapis.com` bằng API key của bạn | **Với key miễn phí, Google có thể dùng nội dung gửi lên để huấn luyện và cải thiện sản phẩm**, gồm cả tin nhắn của những người khác trong hội thoại. Với key trả phí thì không |

Kết nối luôn được mã hoá (HTTPS). Zenlo không gửi dữ liệu tới bất kỳ địa chỉ nào khác.

Vì tin nhắn trong nhóm có cả nội dung của người khác, hãy cân nhắc trước khi gửi những hội thoại nhạy cảm tới dịch vụ AI.

## Zenlo lưu gì, ở đâu

Mọi thứ chỉ nằm trên máy bạn:

| Dữ liệu | Nơi lưu |
|---|---|
| Cài đặt, bản tóm tắt gần nhất của từng hội thoại, kết quả Bản tin, thứ tự và ô tick trong Bản tin | Bộ nhớ của Zalo trên máy (`%APPDATA%\ZaloData`) |
| Bản sao lưu của mục trên | `%APPDATA%\Zenlo\storage-backup.json` |
| API key Gemini | `%APPDATA%\Zenlo\secrets.json`, **được mã hoá bằng Windows** (chỉ tài khoản Windows của bạn giải mã được) |
| Ghi nhận model nào hết lượt trong ngày | `%APPDATA%\Zenlo\gemini-quota.json` |

## Xoá dữ liệu

- Trong Zenlo: **Cài đặt → Xoá bản tóm tắt đã lưu**, và xoá từng API key bằng nút ✕.
- Gỡ Zenlo bằng bộ cài (chọn **Gỡ Zenlo**), rồi xoá thư mục `%APPDATA%\Zenlo` nếu muốn xoá sạch.

## Liên hệ

Câu hỏi về quyền riêng tư: <email góp ý>.
