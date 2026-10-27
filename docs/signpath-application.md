# Hồ sơ xin ký số miễn phí (SignPath Foundation)

Soạn sẵn để điền vào form tại https://signpath.org/apply. Form được nhúng từ dịch vụ khác và có reCAPTCHA, nên các câu hỏi dưới đây là các mục SignPath thường hỏi, không chép được nguyên văn. Câu trả lời viết bằng tiếng Anh, chép thẳng vào form.

## Trước khi nộp

- Kho mã đã có giấy phép GPL-3.0 trên GitHub (đã push).
- Đã có một bản phát hành **build bằng GitHub Actions dưới giấy phép GPL-3.0**: SignPath yêu cầu dự án "đã phát hành đúng dạng sẽ ký". Bản v0.1.0 hiện có còn dùng giấy phép cũ, nên cần phát hành bản mới (ví dụ v0.1.1) sau khi đổi giấy phép.
- Trang [Code signing policy](https://stephitnoob.github.io/zenlo/ky-so.html) đã lên mạng.
- GitHub đã bật xác thực hai lớp.

## Câu trả lời

**Project name:** Zenlo

**Repository URL:** https://github.com/stephitnoob/zenlo

**Project website / home page:** https://stephitnoob.github.io/zenlo/

**Download page:** https://stephitnoob.github.io/zenlo/#cai-dat (also https://github.com/stephitnoob/zenlo/releases)

**Code signing policy:** https://stephitnoob.github.io/zenlo/ky-so.html

**Privacy policy:** https://stephitnoob.github.io/zenlo/privacy.html

**License:** GPL-3.0-only (OSI approved). No commercial or dual licensing; the project is non-profit and has no paid tier.

**Short description:**
Zenlo is a free, open-source add-on for the Zalo desktop messenger on Windows (Zalo is the most used messenger in Vietnam). It summarizes long group chats with an AI service the user chooses and controls: Google Gemini with the user's own API key, or the user's own Claude Code / OpenAI Codex installation. Zenlo has no server; chats are sent only to the AI service the user picks, and only when the user asks for a summary.

**What will be signed:** One file per release, `Zenlo-Setup.exe`: a small console installer written in C# (.NET Framework 4.x, about 170 KB). It embeds Zenlo's own JavaScript files, built from the same repository. No third-party code is bundled besides Windows system libraries (.NET Framework). Product name "Zenlo", product version taken from package.json for every build.

**Build system:** GitHub Actions on a GitHub-hosted Windows runner, triggered by a version tag. Workflow: https://github.com/stephitnoob/zenlo/blob/main/.github/workflows/release.yml. The workflow builds from source, checks the embedded files, uploads the unsigned file as a workflow artifact for SignPath, waits for the signed file, recomputes the SHA-256, attests build provenance and publishes the GitHub release.

**What the installer does (system changes):** With the user's choice in its menu, after showing what it will change, the installer adds Zenlo to the user's Zalo installation by modifying Zalo's `resources\app.asar` (the original is kept as `app.asar.bak`), creates a Start menu shortcut "Zenlo - Cài đặt", and keeps a copy of itself in `%LOCALAPPDATA%\Zenlo` for reinstalling after Zalo updates. Option 2 in the same installer uninstalls Zenlo and restores Zalo's original file. It needs no administrator rights and makes no network connections. It does not bypass any security feature; it only changes the user's own Zalo installation, at the user's request, reversibly.

**Network behavior of the app:** Chats go only to the AI service the user selected, when the user presses Summarize or Create digest. Optional update check (GitHub API) runs only when the user presses "Check for updates" or turns on the daily check (off by default). Full list: https://stephitnoob.github.io/zenlo/privacy.html#ket-noi

**Team / maintainers:** stephit (GitHub: https://github.com/stephitnoob), sole maintainer. Roles: Author, Reviewer and Approver. MFA is enabled for GitHub and will be for SignPath.

**Project age / activity:** First public release v0.1.0 on 2026-10-24; actively developed (see commit history and releases).

**Contact e-mail:** stephit.zenlo@outlook.com

## Sau khi được chấp thuận

1. Trong SignPath: tạo project (slug, ví dụ `zenlo`), signing policy (ví dụ `release-signing`, bật manual approval, approver là stephit), và artifact configuration cho một file `Zenlo-Setup.exe` (product name "Zenlo", product version khớp phiên bản).
2. Tạo API token cho một CI user trong SignPath.
3. Trên GitHub, Settings → Secrets and variables → Actions:
   - Secret `SIGNPATH_API_TOKEN`.
   - Variables `SIGNPATH_ORGANIZATION_ID`, `SIGNPATH_PROJECT_SLUG`, `SIGNPATH_SIGNING_POLICY_SLUG`, `SIGNPATH_ARTIFACT_CONFIGURATION_SLUG`.
4. Kết nối GitHub với SignPath theo hướng dẫn: https://docs.signpath.io/trusted-build-systems/github
5. Từ bản sau, mỗi lần đẩy tag phiên bản, workflow dừng chờ duyệt; vào SignPath bấm Approve.
6. Sửa trang Code signing policy và README: bỏ dòng "đang xin, chưa ký".
