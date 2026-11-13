# Chính sách quyền riêng tư của Zenlo

Cập nhật: 13/11/2026

Zenlo là một tiện ích cho Zalo, chạy trên máy tính của bạn: trong Zalo PC trên Windows, hoặc trong Zalo web dưới dạng tiện ích trình duyệt (những điểm khác của bản này ở [mục riêng](#zenlo-cho-zalo-web)). Trang này nói rõ Zenlo đọc gì, gửi gì, gửi đi đâu và lưu ở đâu.

## Tóm tắt

- **Zenlo không có máy chủ.** Tác giả Zenlo không nhận, không lưu và không thấy được tin nhắn, tài khoản hay bất kỳ dữ liệu nào của bạn.
- **Không cần tài khoản Zenlo, không quảng cáo, không theo dõi.** Ứng dụng Zenlo không gửi số liệu sử dụng (telemetry) đi đâu cả. Trang web của Zenlo chỉ đếm lượt xem ẩn danh, không dùng cookie (xem [Trang web](#trang-web)).
- **Zenlo chỉ gửi tin nhắn tới dịch vụ AI do chính bạn chọn**, và chỉ khi bạn bấm Tóm tắt hoặc Tạo bản tin.
- **Dữ liệu của Zenlo tách theo tài khoản Zalo.** Trong Zenlo, người khác đăng nhập Zalo trên cùng máy không thấy bản tóm tắt, ghi chú của bạn và không dùng được API key của bạn (xem [Nhiều tài khoản Zalo trên một máy](#nhiều-tài-khoản-zalo-trên-một-máy)).

## Zenlo đọc gì

Khi bạn mở khung Zenlo (để đếm tin và ước lượng trước khi gửi) và khi bấm **Tóm tắt** hoặc **Tạo bản tin**, Zenlo đọc từ dữ liệu Zalo đã lưu trên máy bạn. Zenlo đọc ngay trên máy; chỉ khi bạn bấm nút, Zenlo mới gửi tin nhắn đi (mục dưới).

- nội dung các tin nhắn trong khoảng thời gian bạn chọn (hoặc các tin chưa đọc), tên hiển thị của người gửi, thời gian gửi;
- với tin trả lời một tin khác: tên người viết tin đó và tối đa 80 ký tự đầu của nó, kể cả khi tin đó cũ hơn khoảng bạn chọn;
- tên hội thoại, và đó là nhóm hay trò chuyện riêng;
- số người thả từng loại cảm xúc cho mỗi tin (ví dụ 3 ❤️, 2 😡; không có tên người thả), và tin nào nhắc tới bạn;
- tên Zalo của bạn, để AI biết tin nào đang nói với bạn;
- ghi chú bạn tự viết cho hội thoại đó (Thêm ghi chú trong tab Tóm tắt), nếu có;
- số tin chưa đọc mà Zalo ghi nhận.

Zenlo không đọc ảnh, video, tệp đính kèm hay tin nhắn thoại; chỉ đọc tên tệp và chú thích ảnh nếu có. Việc đọc này không làm Zalo gửi trạng thái "Đã xem" cho ai.

Ngoài ra, từ lúc Zalo mở xong, Zenlo đọc mã tài khoản Zalo đang đăng nhập để biết dữ liệu Zenlo nào là của tài khoản đó. Mã này chỉ dùng trên máy, không gửi tới dịch vụ AI hay nơi nào khác.

Cảm xúc bạn chọn bằng nút **+** được gửi qua Zalo, như khi bạn bấm trên thanh cảm xúc.

## Zenlo gửi gì, gửi đi đâu

Zenlo chỉ gửi đi những gì AI cần để tóm tắt, tới **một** trong ba dịch vụ AI mà bạn chọn trong Cài đặt:

- các tin nhắn cần tóm tắt, với những gì ở mục trên: người gửi, giờ gửi, đoạn đầu của tin được trả lời, tin nào nhắc tới bạn, số người thả từng loại cảm xúc;
- tên hội thoại, tên Zalo của bạn và giờ hiện tại, để AI hiểu "mai", "thứ 6", ai đang nói với bạn;
- lời yêu cầu tóm tắt của Zenlo, và ghi chú của bạn cho hội thoại đó (nếu có).

Zenlo không gửi ảnh, video, tệp hay tin nhắn thoại; chỉ gửi tên tệp và chú thích (như mục trên).

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
| Khi đã lưu key Gemini: lúc mở Cài đặt, lúc lưu key hoặc lúc tóm tắt bằng Gemini; thường tối đa mỗi giờ một lần, lỗi mạng thì hỏi lại sau 1 phút | `generativelanguage.googleapis.com`, bằng key của bạn | Chỉ hỏi danh sách model key của bạn dùng được; không có tin nhắn |
| Khi bạn bấm **Kiểm tra kết nối** | Dịch vụ AI bạn chọn | Một câu thử ngắn, không có tin nhắn. Với Codex, Zenlo hỏi thêm danh sách model của tài khoản (lệnh `codex debug models`). Với Claude, danh sách model đọc từ dữ liệu Claude Code đã lưu trên máy, không gửi gì thêm |
| Khi bạn bấm **Kiểm tra bản mới**, hoặc mỗi ngày một lần nếu bạn chọn **Có, báo cho tôi** khi Zenlo hỏi "Báo cho bạn khi có Zenlo bản mới?" | `api.github.com` | Chỉ hỏi số phiên bản mới nhất; không có tin nhắn, ghi chú hay thông tin về bạn. Tắt bằng cách bỏ chọn "Tự kiểm tra bản mới mỗi ngày" |
| Khi bạn bấm một link (trong bản tóm tắt, trong Cài đặt) | Trang web của link đó, mở trong trình duyệt của bạn | Như khi bạn tự mở link |

Claude Code và Codex là chương trình của Anthropic và OpenAI cài trên máy bạn; chúng tự kết nối tới máy chủ của hãng theo chính sách của hãng. Khi Zenlo gọi chúng, Zenlo tắt thống kê và các kết nối không cần thiết mà chúng cho phép tắt.

## Zenlo lưu gì, ở đâu

Mọi thứ chỉ nằm trên máy bạn:

| Dữ liệu | Nơi lưu |
|---|---|
| Cài đặt, ghi chú cho AI, bản tóm tắt gần nhất của từng hội thoại (300 hội thoại gần nhất), kết quả Bản tin, thứ tự và ô tick trong Bản tin, cảm xúc dùng gần đây và thanh cảm xúc nhanh | Bộ nhớ của Zalo trên máy (`%APPDATA%\ZaloData`) |
| Bản sao lưu của mục trên | `%APPDATA%\Zenlo\storage-backup-<mã tài khoản Zalo>.json`, mỗi tài khoản Zalo một file |
| API key Gemini | `%APPDATA%\Zenlo\secrets.json`, **được mã hoá bằng Windows** (chỉ tài khoản Windows của bạn giải mã được), riêng cho từng tài khoản Zalo |
| Ghi nhận model nào hết lượt trong ngày | `%APPDATA%\Zenlo\gemini-quota.json` |

Bộ nhớ của Zalo chỉ giữ dữ liệu Zenlo của tài khoản Zalo đang đăng nhập; dữ liệu của các tài khoản khác nằm trong bản sao lưu của từng tài khoản.

## Nhiều tài khoản Zalo trên một máy

Ở cả bản Windows lẫn bản Zalo web, dữ liệu của Zenlo thuộc về tài khoản Zalo đang đăng nhập:

- Bản tóm tắt, Bản tin, ghi chú, cài đặt, cảm xúc dùng gần đây, thanh cảm xúc nhanh và API key Gemini là của từng tài khoản Zalo. Khi một tài khoản khác đăng nhập Zalo trên cùng máy (hoặc cùng trình duyệt), Zenlo xoá dữ liệu của tài khoản trước khỏi bộ nhớ của Zalo, chỉ giữ lại trong bản sao lưu của tài khoản đó, rồi nạp dữ liệu của tài khoản sau.
- Độ rộng khung Zenlo, lựa chọn và kết quả kiểm tra bản mới, danh sách model tìm được khi bấm **Kiểm tra kết nối** là của máy, các tài khoản dùng chung.
- API key và dữ liệu lưu từ các bản Zenlo cũ (chưa tách theo tài khoản) thuộc về tài khoản Zalo đầu tiên mở Zenlo sau khi cập nhật.
- Khi Zalo chưa cho biết tài khoản nào đang đăng nhập, Zenlo không lưu key, không gọi Gemini và không sao lưu.

Việc tách này giúp những người dùng chung máy không thấy dữ liệu Zenlo của nhau khi dùng Zalo bình thường. Nó không thay được tài khoản Windows hay hồ sơ trình duyệt riêng: ai dùng được tài khoản Windows hoặc hồ sơ trình duyệt của bạn vẫn có thể lấy bản sao lưu và API key bằng công cụ. Nếu cần giữ kín hẳn, hãy dùng tài khoản Windows hoặc hồ sơ trình duyệt riêng.

## Xoá dữ liệu

- Trong Zenlo: **Cài đặt → Xoá bản tóm tắt đã lưu**, và xoá từng API key bằng nút ×. Các nút này chỉ xoá dữ liệu của tài khoản Zalo đang đăng nhập.
- Gỡ Zenlo bằng bộ cài (chọn **Gỡ Zenlo**), rồi xoá thư mục `%APPDATA%\Zenlo` (bản sao lưu và API key của mọi tài khoản Zalo, ghi nhận hết lượt). Gỡ bằng lối tắt **Zenlo - Cài đặt** thì xoá thêm file `%LOCALAPPDATA%\Zenlo\Zenlo-Setup.exe` mà bộ cài báo còn lại.
- Sau khi gỡ, bộ nhớ của Zalo trên máy vẫn còn cài đặt, ghi chú, thứ tự và ô tick trong Bản tin, cảm xúc dùng gần đây, thanh cảm xúc nhanh của tài khoản Zalo dùng Zenlo gần nhất (các mục có tên bắt đầu bằng `@Zenlo:`). Zalo không dùng tới và không gửi chúng đi. Nếu trước khi gỡ, bạn bấm **Xoá bản tóm tắt đã lưu** và **Đặt lại mặc định** trong Cài đặt và xoá ghi chú trong từng hội thoại thì chỉ còn ô tick, thứ tự Bản tin, cảm xúc dùng gần đây, thanh cảm xúc nhanh, độ rộng khung Zenlo, lựa chọn và kết quả kiểm tra bản mới, danh sách model tìm được khi bấm **Kiểm tra kết nối**, mã của tài khoản Zalo đó và một mốc thời gian đánh dấu bộ nhớ; các mục này không chứa nội dung tin nhắn.

## Zenlo cho Zalo web

Bản cho Zalo web là một tiện ích trình duyệt (tệp `Zenlo-ZaloWeb.zip`, mã ở `src/extension/`), chỉ chạy trong trang `chat.zalo.me`. Các mục trên vẫn đúng với bản này, trừ những điểm sau.

- **Đọc từ đâu:** từ dữ liệu Zalo web lưu trong trình duyệt. Khi khoảng bạn chọn cũ hơn những tin trình duyệt đang có, Zenlo nhờ Zalo web tải thêm tin cũ của hội thoại đó từ máy chủ Zalo (máy chủ chỉ trả thêm tin cho nhóm), như khi bạn cuộn lên đọc tin cũ. Yêu cầu này đi từ Zalo web tới máy chủ Zalo bằng tài khoản Zalo của bạn.
- **Gửi tới đâu:** chỉ Gemini (`generativelanguage.googleapis.com`), bằng API key của bạn; bản này không dùng Claude hay ChatGPT. Kiểm tra bản mới hỏi `api.github.com` như ở bản Windows. Ngoài hai địa chỉ này và máy chủ Zalo ở trên, tiện ích không kết nối tới đâu khác.
- **Quyền xin trình duyệt:** chạy trên `chat.zalo.me` và có bộ nhớ riêng của tiện ích (`storage`, `unlimitedStorage`). Tiện ích không có quyền đọc các trang khác, các tab khác hay lịch sử duyệt web.
- **Máy dùng chung:** dữ liệu tách theo tài khoản Zalo như ở bản Windows (mục [Nhiều tài khoản Zalo trên một máy](#nhiều-tài-khoản-zalo-trên-một-máy)). Người khác đăng nhập Zalo web trên cùng trình duyệt không thấy bản tóm tắt, Bản tin, ghi chú của bạn và không dùng được API key của bạn trong Zenlo. Ai dùng được hồ sơ trình duyệt của bạn vẫn có thể lấy bản sao lưu và API key bằng công cụ, nên nếu cần giữ kín hẳn, hãy dùng một hồ sơ trình duyệt riêng.

| Dữ liệu | Nơi lưu (chỉ trong trình duyệt trên máy bạn) |
|---|---|
| Cài đặt, ghi chú cho AI, bản tóm tắt, Bản tin và các mục khác như ở bản Windows | Bộ nhớ của trang `chat.zalo.me` trong trình duyệt |
| Bản sao lưu của mục trên | Bộ nhớ riêng của tiện ích, mỗi tài khoản Zalo một mục (`storageBackup:<mã tài khoản Zalo>`) |
| API key Gemini | Bộ nhớ riêng của tiện ích, mỗi tài khoản Zalo một mục (`geminiKeys:<mã tài khoản Zalo>`). Trang Zalo web không đọc được; key **không** được Windows mã hoá như ở bản Windows |
| Ghi nhận model nào hết lượt trong ngày | Bộ nhớ riêng của tiện ích |

Xoá tiện ích khỏi trình duyệt (nút **Loại bỏ** hoặc **Xóa** trên thẻ Zenlo ở trang tiện ích) thì trình duyệt xoá luôn bộ nhớ riêng của tiện ích: API key và bản sao lưu của mọi tài khoản Zalo, ghi nhận hết lượt. Các mục `@Zenlo:` trong bộ nhớ của trang `chat.zalo.me` vẫn còn, như ở bản Windows; trước khi gỡ, bấm **Xoá bản tóm tắt đã lưu** và **Đặt lại mặc định** trong Cài đặt, và xoá ghi chú trong từng hội thoại.

## Trang web

Trang web của Zenlo (zenlo.io.vn) đếm lượt xem bằng [GoatCounter](https://www.goatcounter.com/), một dịch vụ thống kê mã nguồn mở, để tác giả biết có bao nhiêu người ghé xem và bao nhiêu người bấm Tải về.

- **Được gửi đi:** địa chỉ trang đang xem, tiêu đề trang, trang web dẫn bạn tới đây (nếu có), và việc bạn bấm nút Tải về.
- **GoatCounter lưu** từng lượt xem ở dạng ẩn danh: thời gian, trang được xem, trang dẫn tới, loại trình duyệt, hệ điều hành và quốc gia. Địa chỉ IP không được lưu. Để không đếm trùng khi một người tải lại trang, GoatCounter dùng một mã phiên ẩn danh chỉ tồn tại tối đa 8 giờ.
- **Không có:** cookie, mã định danh lâu dài hay quảng cáo. Trình duyệt chỉ nhớ một thứ: giao diện sáng hay tối, khi bạn bấm nút đổi giao diện (lưu ngay trên trình duyệt, không gửi đi).

Để hiện số phiên bản, dung lượng và nút tải đúng file, trang web hỏi `api.github.com` về bản phát hành mới nhất. Như với mọi trang web, GitHub thấy địa chỉ IP và loại trình duyệt của bạn; yêu cầu không mang gì khác.

Việc đếm này chỉ có trên trang web, không có trong ứng dụng Zenlo. Toàn bộ mã đếm nằm trong [`site/stats.js`](site/stats.js).

## Liên hệ

Câu hỏi về quyền riêng tư: stephit.zenlo@outlook.com.
