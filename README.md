# Zenlo

Trình quản lí hội thoại cho **Zalo PC** (Windows), dùng AI (Claude hoặc Gemini) để đọc giúp bạn.

## Tính năng

- **Tóm tắt hội thoại.** Nút Zenlo trên thanh tiêu đề mỗi cuộc trò chuyện. Chọn khoảng thời gian (30 phút … 24 giờ, "Từ tin chưa đọc", "Từ lần trước" hoặc tự nhập `dd/mm/yyyy hh:mm`) và độ dài (Ngắn / Vừa / Dài). Phần liên quan tới bạn được đưa lên đầu; mỗi ý có mốc giờ, bấm vào là nhảy tới tin gốc.
- **Bản tin.** Tab ở cột trái. Liệt kê các hội thoại Zalo đang tính là chưa đọc, tick chọn hội thoại cần tóm tắt, kéo ⋮⋮ để sắp xếp ưu tiên (được nhớ lâu dài). Mỗi hội thoại được tóm tắt riêng bằng cùng prompt với Tóm tắt, vài hội thoại chạy song song. Tạo bản tin không gửi trạng thái "Đã xem"; chỉ nút "Đã đọc" / "Đã đọc hết" mới đánh dấu đã đọc trong Zalo.
- **Cài đặt Zenlo.** Tab ở cột trái: chọn AI (Claude hoặc Gemini), model, effort, độ dài mặc định, số ngày tìm tin chưa đọc, xoá bản tóm tắt đã lưu, kiểm tra kết nối.

## Cách hoạt động

- **Đọc tin nhắn** từ dữ liệu Zalo đã lưu trên máy, không cuộn khung chat, không gửi gì lên máy chủ Zalo.
- **Trạng thái chưa đọc lấy từ Zalo.** Zalo xoá số tin chưa đọc ngay khi mở hội thoại, nên Zenlo ghi lại con số đó trước khi bạn mở, để "Từ tin chưa đọc" vẫn đúng.
- **Gọi Claude** bằng [Claude Code](https://claude.com/claude-code) ở chế độ headless (`claude -p`), dùng gói Claude Pro/Max của bạn. Không dùng API key, không nạp `CLAUDE.md` hay memory cá nhân vào ngữ cảnh.
- **Gọi Gemini** bằng API key của bạn, lưu mã hoá bằng Windows (`safeStorage`) trên máy. Với key miễn phí, Google có thể dùng nội dung gửi lên để huấn luyện.
- **Cài vào Zalo** bằng cách giải nén `app.asar`, thêm Zenlo, giữ bản gốc ở `app.asar.bak`.

## Yêu cầu

- Zalo PC trên Windows
- Node.js 18 trở lên
- Một trong hai: Claude Code đã cài và đăng nhập bằng gói Claude Pro/Max, hoặc API key Gemini

## Sử dụng

```bash
npm install
npm run build
npm run zalo:install
```

| Lệnh | Việc |
|---|---|
| `npm run zalo:install` | Cài Zenlo (chép file vào Zalo) |
| `npm run zalo:dev` | Cài ở chế độ phát triển: Zalo dùng thẳng thư mục `build`, sửa xong chỉ cần build rồi bấm **Ctrl+Shift+R** trong Zalo |
| `npm run dev` | Tự build lại mỗi khi sửa code |
| `npm run zalo:status` | Xem Zenlo đang được cài thế nào |
| `npm run zalo:uninstall` | Gỡ Zenlo, đưa Zalo về bản gốc |

Mỗi lần Zalo tự cập nhật, Zenlo sẽ mất. Khi đó chạy lại lệnh cài.

## Cấu trúc

| Đường dẫn | Vai trò |
|---|---|
| `src/pc/assets/js/zenlo-core.js` | Phần dùng chung: dữ liệu và trạng thái chưa đọc của Zalo, bản chép hội thoại, prompt tóm tắt, gọi AI |
| `src/pc/assets/js/zenlo.js` | Panel tóm tắt hội thoại |
| `src/pc/assets/js/zenlo-digest.js` | Bản tin |
| `src/pc/assets/js/zenlo-settings.js` | Cài đặt Zenlo |
| `src/pc/assets/js/zenlo-styles.js` | Gắn lại CSS khi Zalo xoá |
| `src/pc/assets/js/zenlo-main.js` | Tiến trình chính: chạy `claude -p` hoặc gọi Gemini, lưu key mã hoá, phím tải lại ở chế độ phát triển |
| `src/pc/assets/js/zenlo-preload.js` | Cầu nối `window.$zenlo` giữa giao diện và tiến trình chính |
| `src/pc/assets/scss/zenlo.scss` | Giao diện |
| `src/pc/zalo-patch.js`, `src/pc/index.js` | Bộ cài / gỡ vào Zalo PC |

## Bản quyền

Copyright (c) 2026 stephit. All rights reserved. Xem [LICENSE](LICENSE).

Zenlo được stephit phát triển cùng Claude (Anthropic). Đây là dự án cá nhân, không liên kết với Zalo hay VNG.
