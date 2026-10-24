# Zenlo

Trình quản lí hội thoại cho **Zalo PC** (Windows), dùng AI (Claude hoặc Gemini) để đọc giúp bạn.

## Tính năng

Mọi thứ nằm trong **khung Zenlo** gắn ở cạnh phải cửa sổ Zalo (khung chat tự co lại, không bị che). Mở bằng nút Zenlo ở thanh trái hoặc nút trên thanh tiêu đề hội thoại; đóng bằng ×, bấm lại nút đó, hoặc Esc.

- **Tóm tắt** (tab). Tóm tắt hội thoại đang mở; chưa mở hội thoại nào thì chọn ở danh sách bên trái. Chọn khoảng thời gian (30 phút … 24 giờ, "Từ tin chưa đọc", "Từ lần trước" hoặc tự nhập `dd/mm/yyyy hh:mm`) và độ dài (Ngắn / Vừa / Dài). Phần liên quan tới bạn được đưa lên đầu; mỗi ý có mốc giờ, bấm vào là nhảy tới tin gốc.
- **Bản tin** (tab). Liệt kê các hội thoại Zalo đang tính là chưa đọc, tick chọn hội thoại cần tóm tắt, kéo ⋮⋮ để sắp xếp ưu tiên (được nhớ lâu dài). Mỗi hội thoại được tóm tắt riêng bằng cùng prompt với Tóm tắt, vài hội thoại chạy song song. Tạo bản tin không gửi trạng thái "Đã xem"; chỉ nút "Đã đọc" / "Đã đọc hết" mới đánh dấu đã đọc trong Zalo.
- **Cài đặt** (bánh răng trên hàng tab): chọn AI (Claude hoặc Gemini), model, effort, độ dài mặc định, số ngày tìm tin chưa đọc, xoá bản tóm tắt đã lưu, kiểm tra kết nối.

## Cách hoạt động

- **Đọc tin nhắn** từ dữ liệu Zalo đã lưu trên máy, không cuộn khung chat, không gửi gì lên máy chủ Zalo.
- **Trạng thái chưa đọc lấy từ Zalo.** Zalo xoá số tin chưa đọc ngay khi mở hội thoại, nên Zenlo ghi lại con số đó trước khi bạn mở, để "Từ tin chưa đọc" vẫn đúng.
- **Gọi Claude** bằng [Claude Code](https://claude.com/claude-code) ở chế độ headless (`claude -p`), dùng gói Claude Pro/Max của bạn. Không dùng API key, không nạp `CLAUDE.md` hay memory cá nhân vào ngữ cảnh.
- **Gọi Gemini** bằng API key của bạn (tối đa 5 key), lưu mã hoá bằng Windows (`safeStorage`) trên máy. Với key miễn phí, Google có thể dùng nội dung gửi lên để huấn luyện.
- **Dữ liệu của Zenlo** (cài đặt, bản tóm tắt đã lưu, thứ tự và ô tick trong Bản tin) nằm trong bộ nhớ của Zalo và còn nguyên qua các lần Zalo cập nhật. Zenlo giữ thêm một bản sao lưu cùng key và hạn mức trong `%APPDATA%Zenlo`, và tự khôi phục nếu Zalo xoá bộ nhớ.
- **Cài vào Zalo** bằng cách giải nén `app.asar`, thêm Zenlo, giữ bản gốc ở `app.asar.bak`.

## Yêu cầu

- Zalo PC trên Windows
- Node.js 18 trở lên
- Một trong hai: Claude Code đã cài và đăng nhập bằng gói Claude Pro/Max, hoặc API key Gemini

## Sử dụng

```bash
npm install
npm run zalo:install
```

| Lệnh | Việc |
|---|---|
| `npm run build` | Build Zenlo vào `dist/` |
| `npm run zalo:install` | Build rồi cài Zenlo vào Zalo (chép file) |
| `npm run zalo:dev` | Build rồi cài ở chế độ phát triển: Zalo dùng thẳng thư mục `dist/`, sửa xong chỉ cần build rồi bấm **Ctrl+Shift+R** trong Zalo |
| `npm run dev` | Tự build lại mỗi khi sửa code |
| `npm run zalo:status` | Xem Zenlo đang được cài thế nào |
| `npm run zalo:uninstall` | Gỡ Zenlo, đưa Zalo về bản gốc |

Mỗi lần Zalo tự cập nhật, Zenlo sẽ mất. Khi đó chạy lại lệnh cài.

## Cấu trúc

| Đường dẫn | Vai trò |
|---|---|
| `src/renderer/` | Chạy trong trang Zalo, gom thành `dist/zenlo.js`: `core.js` (dữ liệu và trạng thái chưa đọc của Zalo, bản chép hội thoại, prompt, gọi AI), `drawer.js` (khung Zenlo, nút ở thanh trái), `summary.js` (Tóm tắt), `digest.js` (Bản tin), `settings.js` (Cài đặt), `styles.js` (gắn lại CSS khi Zalo xoá) |
| `src/main/` | Tiến trình chính của Zalo: `main.js` chạy `claude -p` hoặc gọi Gemini, lưu key mã hoá; `preload.js` là cầu nối `window.$zenlo` |
| `src/styles/` | Giao diện (SCSS) |
| `scripts/build.mjs` | Build bằng esbuild và sass |
| `installer/` | Cài / gỡ vào Zalo PC |

## Bản quyền

Copyright (c) 2026 stephit. All rights reserved. Xem [LICENSE](LICENSE).

Zenlo được stephit phát triển cùng Claude (Anthropic). Đây là dự án cá nhân, không liên kết với Zalo hay VNG.
