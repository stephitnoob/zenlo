# Bảo mật

Zenlo đọc tin nhắn riêng tư, nên mọi lỗ hổng đều được xử lý ưu tiên.

## Báo lỗ hổng

Gửi email tới **stephit.zenlo@outlook.com** với tiêu đề bắt đầu bằng `[Bảo mật]`. Đừng đăng lỗ hổng công khai (issue, mạng xã hội) trước khi có bản sửa.

Nên kèm:

- phiên bản Zenlo và Zalo PC;
- các bước tái hiện;
- tác động bạn thấy được (ví dụ: lộ tin nhắn, lộ API key, chạy mã).

Bạn sẽ nhận được phản hồi trong vòng 7 ngày. Khi có bản sửa, bạn được ghi công trong ghi chú phát hành nếu muốn.

## Phạm vi

Trong phạm vi:

- mã nguồn trong kho này và các bản phát hành chính thức;
- bộ cài (cách Zenlo sửa và khôi phục Zalo);
- cách Zenlo đọc, hiển thị và gửi tin nhắn tới dịch vụ AI;
- cách Zenlo lưu API key và dữ liệu trên máy.

Ngoài phạm vi: lỗ hổng của chính Zalo, Claude Code, Codex, Gemini API; máy đã nhiễm mã độc; các bản Zenlo không tải từ nguồn chính thức.

## Thiết kế an toàn hiện có

- **Không có máy chủ Zenlo.** Tin nhắn chỉ đi tới dịch vụ AI do người dùng chọn, qua HTTPS.
- **Gemini:** chỉ gửi tới `generativelanguage.googleapis.com`; luôn kiểm tra chứng chỉ (TLS 1.2 trở lên) dù biến môi trường nói gì; API key nằm trong header, không nằm trên URL.
- **Claude Code:** chạy không có công cụ nào (`--tools ""`), không nạp cài đặt, plugin hay MCP của người dùng; các biến môi trường có thể chuyển hướng dữ liệu, đổi nhà cung cấp, hạ TLS hay chèn mã (`ANTHROPIC_BASE_URL`, `NODE_OPTIONS`, `NODE_TLS_REJECT_UNAUTHORIZED`…) bị loại bỏ.
- **Codex:** chạy `codex exec` chỉ đọc (`-s read-only`) trong một thư mục tạm rỗng, tắt công cụ chạy lệnh, tìm web, plugin và app, không nạp `config.toml` hay AGENTS.md của dự án; bỏ `CODEX_API_KEY`, `OPENAI_API_KEY`, `OPENAI_BASE_URL` và các biến tương tự khỏi môi trường, và không chạy khi Codex đăng nhập bằng API key.
- **Chống chèn lệnh qua tin nhắn:** tin nhắn chỉ là dữ liệu trong lời gọi AI; AI không có công cụ nào để hành động, chỉ trả về văn bản.
- **Hiển thị:** mọi nội dung từ tin nhắn và từ AI được escape trước khi đưa lên giao diện.
- **IPC:** tiến trình chính chỉ nhận yêu cầu từ trang nội bộ của Zalo (`file://`).
- **API key:** mã hoá bằng Windows DPAPI (`safeStorage`), lưu ngoài thư mục của Zalo.
- **Không tự cập nhật ngầm.** Bản phát hành được build tự động trên GitHub Actions, kèm SHA-256 và chứng thực nguồn gốc (build provenance) để ai cũng kiểm chứng được.

## Kiểm chứng một bản tải về

So SHA-256 của file với giá trị trong ghi chú phát hành:

```powershell
Get-FileHash .\Zenlo-Setup.exe -Algorithm SHA256
```

Kiểm tra file được build từ đúng kho mã này (cần GitHub CLI):

```powershell
gh attestation verify .\Zenlo-Setup.exe --repo stephitnoob/zenlo
```
