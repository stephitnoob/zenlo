# Zenlo

Trình quản lí hội thoại cho **Zalo PC** (Windows), dùng Claude để đọc giúp bạn.

## Tính năng

- **Tóm tắt hội thoại.** Nút Zenlo trên thanh tiêu đề mỗi cuộc trò chuyện. Chọn khoảng thời gian (30 phút … 24 giờ, "Từ tin chưa đọc", "Từ lần trước" hoặc tự nhập `dd/mm/yyyy hh:mm`), chọn model và effort. Kết quả gồm Tổng quan, Ý chính, Quyết định, Việc cần làm, Câu hỏi còn bỏ ngỏ.
- **Bản tin.** Tab ở cột trái. Liệt kê mọi hội thoại có tin chưa đọc, tick chọn hội thoại cần tóm tắt, kéo ⋮⋮ để sắp xếp ưu tiên (được nhớ lâu dài), rồi tóm tắt tất cả trong một lần. Đọc qua Bản tin không gửi trạng thái "Đã xem".
- **Gợi ý trả lời.** Nút trên thanh công cụ soạn tin. Đưa ra 3 câu trả lời theo giọng của bạn, có thể theo ý chính bạn gõ trước. Chỉ điền vào ô soạn tin, không bao giờ tự gửi.

## Cách hoạt động

- **Đọc tin nhắn** từ dữ liệu Zalo đã lưu trên máy, không cuộn khung chat, không gửi gì lên máy chủ Zalo.
- **Mốc đã đọc riêng của Zenlo** cho từng hội thoại. Zalo coi một hội thoại là đã đọc ngay khi mở ra, còn Zenlo chỉ coi là đã đọc khi bạn đã xem tóm tắt hoặc đã trả lời trong hội thoại đó.
- **Gọi Claude** bằng [Claude Code](https://claude.com/claude-code) ở chế độ headless (`claude -p`), dùng tài khoản Claude của bạn. Không dùng API key, không nạp `CLAUDE.md` hay memory cá nhân vào ngữ cảnh.
- **Cài vào Zalo** bằng cách giải nén `app.asar`, thêm Zenlo, giữ bản gốc ở `app.asar.bak`.

## Yêu cầu

- Zalo PC trên Windows
- Node.js 18 trở lên
- Claude Code đã cài và đăng nhập (lệnh `claude` chạy được)

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
| `src/pc/assets/js/zenlo-core.js` | Phần dùng chung: dữ liệu Zalo, mốc đã đọc, bản chép hội thoại, gọi Claude |
| `src/pc/assets/js/zenlo.js` | Panel tóm tắt hội thoại |
| `src/pc/assets/js/zenlo-digest.js` | Bản tin |
| `src/pc/assets/js/zenlo-reply.js` | Gợi ý trả lời |
| `src/pc/assets/js/zenlo-styles.js` | Gắn lại CSS khi Zalo xoá |
| `src/pc/assets/js/zenlo-main.js` | Tiến trình chính: chạy `claude -p`, phím tải lại ở chế độ phát triển |
| `src/pc/assets/js/zenlo-preload.js` | Cầu nối `window.$zenlo` giữa giao diện và tiến trình chính |
| `src/pc/assets/scss/zenlo.scss` | Giao diện |
| `src/pc/zalo-patch.js`, `src/pc/index.js` | Bộ cài / gỡ vào Zalo PC |

## Bản quyền

Copyright (c) 2026 stephit. All rights reserved. Xem [LICENSE](LICENSE).

Zenlo được stephit phát triển cùng Claude (Anthropic). Đây là dự án cá nhân, không liên kết với Zalo hay VNG.
