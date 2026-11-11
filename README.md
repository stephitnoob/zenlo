# Zenlo

Trình quản lí hội thoại cho **Zalo PC** (Windows), dùng AI (Gemini, Claude hoặc ChatGPT qua Codex) để đọc giúp bạn.

## Tính năng

Mọi thứ nằm trong **khung Zenlo** gắn ở cạnh phải cửa sổ Zalo (khung chat tự co lại, không bị che). Mở bằng nút Zenlo ở thanh trái hoặc nút trên thanh tiêu đề hội thoại; đóng bằng ×, bấm lại nút đó, hoặc Esc.

- **Tóm tắt** (tab). Tóm tắt hội thoại đang mở; chưa mở hội thoại nào thì chọn ở danh sách bên trái. Chọn khoảng thời gian (30 phút … 24 giờ, "Từ tin chưa đọc", "Từ lần trước" hoặc tự nhập `dd/mm/yyyy hh:mm`) và độ dài (Ngắn / Vừa / Dài, mặc định Vừa; Ngắn vẫn giữ đủ việc của bạn, Dài kể cả diễn biến, ai nói gì); dòng ước lượng cho biết số tin, số token và số lần gọi AI trước khi gửi. Phần liên quan tới bạn được đưa lên đầu, hạn đã qua được ghi "(đã qua)"; ngay sau mỗi câu có số nguồn nhỏ `[1]` trỏ tới tin gốc: rê chuột để xem tin, bấm để nhảy tới đúng tin đó.
- **Bản tin** (tab). Liệt kê các hội thoại Zalo đang tính là chưa đọc (hội thoại có người nhắc bạn hoặc @All có nhãn "@ nhắc bạn" và được lùi tới 30 ngày), tick chọn hội thoại cần tóm tắt, kéo ⋮⋮ để sắp xếp ưu tiên (được nhớ lâu dài). Bản tin viết ngắn, chỉ những gì bạn sẽ lỡ nếu không đọc (việc cần làm, câu cần trả lời, lịch, hạn, tiền...), mỗi ý có số nguồn trỏ tới tin gốc; hội thoại không có gì như vậy chỉ ghi "Không có gì liên quan tới bạn." kèm một câu nói nhóm đang bàn gì; nhiều hội thoại được gộp vào một lần gọi AI để đỡ tốn lượt. Tạo bản tin không gửi trạng thái "Đã xem"; chỉ nút "Đã đọc" / "Đã đọc hết" mới đánh dấu đã đọc trong Zalo.
- **Ghi chú cho AI** (nút cạnh nút Tóm tắt trên thanh tiêu đề hội thoại): mỗi hội thoại một ghi chú, tối đa 300 ký tự, ví dụ "Hoa là sếp mình" hay "chỉ cần hạn chót". AI đọc ghi chú mỗi lần tóm tắt hội thoại đó, cả trong Bản tin, và ưu tiên ghi chú hơn cách viết mặc định.
- **Thả cảm xúc**: nút **+** ở cuối thanh cảm xúc mở hơn 80 cảm xúc (cái dùng gần đây lên đầu); "Sửa thanh nhanh" chọn 6 cảm xúc hiện sẵn trên thanh. Danh sách, hình và việc gửi đều do chính Zalo làm.
- **Sao chép** bản tóm tắt hoặc bản tin (không kèm số nguồn), hoặc **Sao chép kèm nguồn** ở mũi tên ▾ cạnh nút: giữ số `[n]` và thêm danh sách "Nguồn:" (giờ, người gửi, nội dung tin, cắt khoảng 80 ký tự). Văn bản sao chép có thêm một dòng ghi nguồn Zenlo ở cuối.
- **Cài đặt** (bánh răng trên hàng tab): chọn AI (Gemini, Claude hoặc Codex), model, effort, độ dài mặc định, số ngày tìm tin chưa đọc, xoá bản tóm tắt đã lưu, kiểm tra kết nối, xem phiên bản và kiểm tra bản mới.

## Cách hoạt động

- **Đọc tin nhắn** từ dữ liệu Zalo đã lưu trên máy, không cuộn khung chat, không gửi gì lên máy chủ Zalo.
- **Trạng thái chưa đọc lấy từ Zalo.** Zalo xoá số tin chưa đọc ngay khi mở hội thoại, nên Zenlo ghi lại con số đó trước khi bạn mở, để "Từ tin chưa đọc" vẫn đúng.
- **Gọi Claude** bằng [Claude Code](https://claude.com/claude-code) ở chế độ headless (`claude -p`), dùng gói Claude Pro/Max của bạn. Không dùng API key, không nạp `CLAUDE.md` hay memory cá nhân vào ngữ cảnh.
- **Gọi ChatGPT** bằng [Codex CLI](https://github.com/openai/codex), đăng nhập bằng gói ChatGPT của bạn. Chữ hiện dần qua `codex app-server`: Zenlo tắt MCP server, plugin, bộ nhớ, `notify` và kiểm tra lại trước khi gửi tin nhắn; MCP hay hook còn chạy thì dùng `codex exec --ignore-user-config` (chữ ra một lần), chỉ khi `codex login status` đã xác nhận đăng nhập bằng ChatGPT. Cả hai đều chạy chỉ đọc trong thư mục trống, tắt công cụ, không nạp `AGENTS.md` của dự án, bỏ `CODEX_API_KEY`/`OPENAI_API_KEY` khỏi môi trường và từ chối chạy khi Codex đăng nhập bằng API key hay cách khác ChatGPT (Bedrock, access token…), để không bị tính tiền theo API.
- **Gọi Gemini** bằng API key của bạn (tối đa 5 key), lưu mã hoá bằng Windows (`safeStorage`) trên máy. Với key miễn phí, Google có thể dùng nội dung gửi lên để huấn luyện.
- **Dữ liệu của Zenlo** (cài đặt, bản tóm tắt đã lưu, thứ tự và ô tick trong Bản tin) nằm trong bộ nhớ của Zalo và còn nguyên qua các lần Zalo cập nhật. Zenlo giữ thêm một bản sao lưu cùng key và hạn mức trong `%APPDATA%\Zenlo`, và tự khôi phục nếu Zalo xoá bộ nhớ.
- **Cài vào Zalo** bằng cách giải nén `app.asar`, thêm Zenlo, giữ bản gốc ở `app.asar.bak`.
- **Báo bản mới**: lần đầu mở, Zenlo hỏi có muốn được báo khi có bản mới không. Chọn Có thì mỗi ngày Zenlo hỏi GitHub một lần và hiện thông báo của Windows khi có bản mới; không gửi gì về bạn. Đổi được trong Cài đặt.

## Tải về

Người dùng: tải `Zenlo-Setup.zip` từ trang web hoặc mục Releases của kho mã này, giải nén, mở `Zenlo-Setup.exe` và chọn "1. Cài Zenlo" (trình duyệt ít cảnh báo file zip hơn; trong zip chỉ có đúng file `.exe` đó, cũng có trên Releases). Bộ cài giữ một bản trong `%LOCALAPPDATA%\Zenlo` và tạo lối tắt **"Zenlo - Cài đặt"** trong Start: mỗi lần Zalo cập nhật (nút Zenlo biến mất), mở lối tắt đó và chọn 1 lại. Mỗi bản phát hành được build tự động trên GitHub Actions, kèm SHA-256 và chứng thực nguồn gốc; cách kiểm chứng ở [SECURITY.md](SECURITY.md).

Bộ cài sửa file `resources\app.asar` của Zalo để thêm Zenlo, sau khi nói rõ trên màn hình; bản gốc được giữ thành `app.asar.bak` và chọn "2. Gỡ Zenlo" là Zalo về đúng bản gốc.

Xem thêm: [Chính sách quyền riêng tư](PRIVACY.md) · [Bảo mật](SECURITY.md) · [Code signing policy](https://zenlo.io.vn/ky-so.html) · [Các phiên bản](https://zenlo.io.vn/phien-ban.html)

## Yêu cầu (để phát triển)

- Zalo PC trên Windows
- Node.js 22 trở lên
- Để build bộ cài `Zenlo-Setup.exe`: .NET Framework 4.x có sẵn trong Windows 10/11 (dùng trình biên dịch C# `csc.exe` đi kèm)
- Một trong ba: API key Gemini; Claude Code đã đăng nhập bằng gói Claude Pro/Max; hoặc Codex đã đăng nhập bằng gói ChatGPT

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
| `npm run build:setup` | Build `build/setup/Zenlo-Setup.exe` (bộ cài C#, khoảng 200 KB, không cần Node.js) kèm SHA-256 |
| `npm run site` | Xem trang web trên máy ở http://127.0.0.1:4173 (không lưu cache, luôn thấy bản mới nhất) |
| `npm run lint` | Kiểm tra cách viết code (standard) |
| `npm test` | Build rồi chạy cả ba bộ test bên dưới (CI chạy lệnh này mỗi lần push) |
| `npm run test:unit` | Thử các hàm xử lý bản chép, mốc giờ và câu trả lời của AI, không gọi AI |
| `npm run test:gemini` | Thử chuỗi model Gemini trong tiến trình chính thật, với máy chủ Google giả (không tốn lượt) |
| `npm run test:codex` | Thử cách gọi Codex với một Codex giả (không gọi Codex thật) |

Mỗi lần Zalo tự cập nhật, Zenlo sẽ mất. Khi đó chạy lại lệnh cài.

## Cấu trúc

| Đường dẫn | Vai trò |
|---|---|
| `src/renderer/` | Chạy trong trang Zalo, gom thành `dist/zenlo.js`: `core.js` (dữ liệu và trạng thái chưa đọc của Zalo, bản chép hội thoại, prompt, gọi AI), `drawer.js` (khung Zenlo, nút ở thanh trái), `summary.js` (Tóm tắt), `digest.js` (Bản tin), `settings.js` (Cài đặt), `reactions.js` (nút + và thanh cảm xúc nhanh), `styles.js` (gắn lại CSS khi Zalo xoá) |
| `src/main/` | Tiến trình chính của Zalo: `main.js` chạy `claude -p`, `codex app-server` / `codex exec` hoặc gọi Gemini, lưu key mã hoá; `preload.js` là cầu nối `window.$zenlo` |
| `src/styles/` | Giao diện (SCSS) |
| `scripts/build.mjs` | Build bằng esbuild và sass |
| `installer/` | Cài / gỡ vào Zalo PC: `zalo.js` cho các lệnh npm khi phát triển (có chế độ dev); `setup/Setup.cs` là bộ cài `Zenlo-Setup.exe` cho người dùng |
| `scripts/build-setup.mjs` | Biên dịch bộ cài C# thành một file `.exe`, nhúng sẵn các file Zenlo đã build |
| `test/` | `unit/`: thử các hàm của `core.js`; `gemini/`, `codex/`: thử cách gọi AI với dịch vụ giả; `summary-eval/`: các hội thoại giả có cài bẫy để so prompt trên Claude, Codex và Gemini thật (tốn lượt, chạy tay) |
| `site/` | Trang web giới thiệu và tải về (GitHub Pages) |
| `.github/workflows/` | Build và phát hành tự động, đưa trang web lên |

## Code signing policy

Zenlo đang xin chứng chỉ ký số miễn phí của SignPath Foundation; các bản tới nay **chưa được ký số**. Khi được chấp thuận: Free code signing provided by [SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org).

- Chỉ ký `Zenlo-Setup.exe`, do GitHub Actions build từ tag phiên bản ([release.yml](.github/workflows/release.yml)); mỗi yêu cầu ký được duyệt thủ công.
- Team roles: Authors, Reviewers, Approvers: [stephit](https://github.com/stephitnoob).
- Quyền riêng tư: [PRIVACY.md](PRIVACY.md), mục "Mọi kết nối mạng của Zenlo".
- Chi tiết: [Code signing policy](https://zenlo.io.vn/ky-so.html).

## Bản quyền

Copyright (C) 2026 stephit.

Zenlo là phần mềm tự do, phát hành theo [Giấy phép Công cộng GNU phiên bản 3](LICENSE) (GPL-3.0-only). Bạn được dùng, nghiên cứu, sửa đổi và phát hành lại Zenlo, kể cả bản đã sửa, miễn là giữ cùng giấy phép và công khai mã nguồn của bản đó. Zenlo được cung cấp không kèm bảo hành nào; chi tiết trong file [LICENSE](LICENSE).

Zenlo phi lợi nhuận và không có bản trả phí. Nếu phát hành bản sửa đổi, mong bạn đặt tên khác để người dùng không nhầm với bản chính thức. Góp ý, báo lỗi và pull request đều được chào đón.

Zenlo được stephit phát triển cùng Claude (Anthropic). Đây là dự án cá nhân, không liên kết với Zalo hay VNG.