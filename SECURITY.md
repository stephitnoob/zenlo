# Bảo mật

Zenlo đọc tin nhắn riêng tư, nên tác giả ưu tiên sửa lỗ hổng bảo mật trước mọi việc khác.

## Báo lỗ hổng

Gửi email tới **stephit.zenlo@outlook.com** với tiêu đề bắt đầu bằng `[Bảo mật]`. Đừng đăng lỗ hổng công khai (issue, mạng xã hội) trước khi có bản sửa.

Nên kèm:

- phiên bản Zenlo và Zalo PC (bản Zalo web: tên và phiên bản trình duyệt);
- các bước tái hiện;
- tác động bạn thấy được (ví dụ: lộ tin nhắn, lộ API key, chạy mã).

Tác giả sẽ trả lời trong vòng 7 ngày. Khi có bản sửa, nếu bạn muốn, ghi chú phát hành sẽ ghi tên bạn.

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
- **Codex:** chạy `codex app-server` để chữ hiện dần. Vì app-server luôn đọc `config.toml`, Zenlo tắt từng MCP server (tên lấy từ `config/read`), plugin, app, bộ nhớ, `notify`, lịch sử, và trước khi gửi tin nhắn kiểm tra: đăng nhập bằng ChatGPT, không MCP server nào chạy, không có hook; không phải ChatGPT thì dừng, không gửi gì; MCP server hay hook còn chạy thì dừng app-server và dùng `codex exec --ignore-user-config`, chỉ khi `codex login status` đã xác nhận đăng nhập bằng ChatGPT. Cả hai cách đều chạy chỉ đọc (`-s read-only`) trong một thư mục tạm rỗng, tắt công cụ chạy lệnh, tìm web, plugin và app, không nạp `config.toml` hay AGENTS.md của dự án; bỏ `CODEX_API_KEY`, `OPENAI_API_KEY`, `OPENAI_BASE_URL` và các biến tương tự khỏi môi trường, và không chạy khi Codex đăng nhập bằng API key hay cách khác ChatGPT (Bedrock, access token, workload identity).
- **Chống chèn lệnh qua tin nhắn:** tin nhắn chỉ là dữ liệu trong lời gọi AI; AI không có công cụ nào để hành động, chỉ trả về văn bản.
- **Hiển thị:** mọi nội dung từ tin nhắn và từ AI được escape trước khi đưa lên giao diện. Link trong bản tóm tắt chỉ bấm được khi địa chỉ có đúng trong tin nhắn gốc của hội thoại đó, để một tin nhắn không thể dụ AI tạo link mang nội dung hội thoại ra ngoài; mỗi thẻ Bản tin chỉ nhận phần trả lời đầu tiên mang số của nó.
- **IPC:** tiến trình chính chỉ nhận yêu cầu từ trang nội bộ của Zalo (`file://`).
- **API key:** mã hoá bằng Windows DPAPI (`safeStorage`), lưu ngoài thư mục của Zalo.
- **Tách theo tài khoản Zalo:** key Gemini, bản sao lưu, bản tóm tắt, ghi chú và cài đặt thuộc về tài khoản Zalo đang đăng nhập. Tài khoản khác đăng nhập trên cùng máy hay cùng trình duyệt thì Zenlo xoá dữ liệu của tài khoản trước khỏi bộ nhớ của Zalo (dữ liệu đó vẫn còn trong bản sao lưu của tài khoản trước) và nạp dữ liệu của tài khoản sau. Khi chưa biết tài khoản nào đang đăng nhập, Zenlo không lưu key, không gọi Gemini, không sao lưu. Zenlo chỉ nhận mã tài khoản gồm chữ cái không dấu, chữ số, `_` hoặc `-` (tối đa 64 ký tự), nên mã này không thể thành một đường dẫn file. Việc tách này là để người dùng chung máy không thấy dữ liệu của nhau khi dùng Zalo bình thường, không phải ranh giới bảo mật: ai dùng được tài khoản Windows hay hồ sơ trình duyệt vẫn lấy được dữ liệu bằng công cụ, và script trong trang Zalo vẫn dùng được `window.$zenlo` như nói ở dưới.
- **Bản Zalo web (tiện ích trình duyệt):** chỉ chạy trên `chat.zalo.me`, không xin quyền đọc tab, trang khác hay lịch sử. API key nằm trong bộ nhớ riêng của tiện ích (không được mã hoá như DPAPI) và chỉ content script riêng của tiện ích (`bridge.js`) đọc được; trang Zalo web chỉ nhận key đã che. Như ở bản PC, script của trang dùng được `window.$zenlo` để chạy Gemini hay đổi key, nhưng không đọc được key. Gemini được gọi từ content script, không từ trang.
- **Không tự cập nhật ngầm.** Zenlo chỉ báo khi có bản mới; bạn tự tải và cài. Bản phát hành được build tự động trên GitHub Actions, kèm SHA-256 và chứng thực nguồn gốc (build provenance) để ai cũng kiểm chứng được.

## Kiểm chứng một bản tải về

Nếu tải `Zenlo-Setup.zip` thì giải nén trước; trong zip chỉ có đúng file `Zenlo-Setup.exe` của cùng bản phát hành. So SHA-256 của file `.exe` với giá trị trong ghi chú phát hành:

```powershell
Get-FileHash .\Zenlo-Setup.exe -Algorithm SHA256
```

Kiểm tra file được build từ đúng kho mã này (cần GitHub CLI):

```powershell
gh attestation verify .\Zenlo-Setup.exe --repo stephitnoob/zenlo
```

Bản Zalo web: so SHA-256 của chính file `Zenlo-ZaloWeb.zip` (dòng thứ hai trong `SHA256.txt`, cũng có trong ghi chú phát hành), và kiểm tra nguồn gốc bằng `gh attestation verify .\Zenlo-ZaloWeb.zip --repo stephitnoob/zenlo`. Mã trong zip không bị rút gọn (minify), đọc được trực tiếp.
