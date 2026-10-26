/*
  Zenlo – trình quản lí hội thoại Zalo

  Zenlo-Setup.exe: the installer for everyone. Plain C# 5 for the .NET Framework that comes with
  Windows 10 and 11, so nothing else is needed and the program stays small. Zenlo's built files
  (dist/) travel inside it as resources. Built by scripts/build-setup.mjs.

  What it does, the same way as installer/zalo.js (the developer's installer):
  - Zalo ships its app as resources/app.asar. Installing unpacks it into a folder, adds Zenlo's
    files and two hooks, and puts the folder back under the name "app.asar" (Electron loads a
    folder with that name just like the archive). The untouched archive is kept as app.asar.bak,
    so removing Zenlo is a rename back.
  - It keeps a copy of itself and a Start Menu shortcut "Zenlo - Cài đặt", for reinstalling after
    a Zalo update without downloading again.
  - Zenlo's own data (%APPDATA%\Zenlo) is never touched.
*/

using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace Zenlo
{
    internal static class Setup
    {
        static readonly string[] Assets = { "zenlo.js", "zenlo.css", "zenlo-main.js", "zenlo-preload.js" };
        const string ZenloFolder = "zenlo";      // inside Zalo's pc-dist
        const string DevMarker = "zenlo-dev";    // left by the developer's installer in dev mode
        const string ShortcutName = "Zenlo - Cài đặt.lnk";

        static readonly string LocalAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        static readonly string RoamingAppData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        static readonly string ZaloRoot = Path.Combine(LocalAppData, "Programs", "Zalo");
        static readonly string KeepDir = Path.Combine(LocalAppData, "Zenlo");
        static readonly string KeptExe = Path.Combine(KeepDir, "Zenlo-Setup.exe");
        static readonly string StartMenu = Path.Combine(RoamingAppData, "Microsoft", "Windows", "Start Menu", "Programs");

        static int Main(string[] args)
        {
            try
            {
                Console.OutputEncoding = Encoding.UTF8;
            }
            catch (IOException)
            {
                // No console window (output redirected): keep the default
            }

            // "Zenlo-Setup.exe --check": lists the embedded files (used by the release build)
            if (Array.IndexOf(args, "--check") >= 0)
            {
                foreach (string name in Assets) Console.WriteLine(name + " " + ReadAsset(name).Length);
                return 0;
            }

            while (true)
            {
                Header();
                Console.WriteLine("  1. Cài Zenlo (hoặc cài lại sau khi Zalo cập nhật)");
                Console.WriteLine("  2. Gỡ Zenlo, đưa Zalo về bản gốc");
                Console.WriteLine("  3. Thoát");
                Console.WriteLine();
                string choice = Ask("Chọn 1, 2 hoặc 3 rồi bấm Enter: ");
                if (choice == null || choice == "3" || choice == "") return 0;
                if (choice != "1" && choice != "2") continue;

                Console.WriteLine();
                try
                {
                    if (choice == "1") RunInstall();
                    else RunUninstall();
                }
                catch (Exception error)
                {
                    Console.WriteLine("Lỗi: " + error.Message);
                }
                Console.WriteLine();
                if (Ask("Bấm Enter để quay lại.") == null) return 0;
            }
        }

        // ---------- Menu ----------

        static string Ask(string question)
        {
            Console.Write(question);
            string line = Console.ReadLine();
            return line == null ? null : line.Trim();
        }

        static void Header()
        {
            try
            {
                Console.Clear();
            }
            catch (IOException)
            {
                // Output redirected
            }
            Console.WriteLine("==============================================");
            Console.WriteLine("  Zenlo " + BuildInfo.Version + " – trình quản lí hội thoại Zalo");
            Console.WriteLine("==============================================");
            try
            {
                string resources = FindResourcesDir();
                Console.WriteLine("  Zalo:  " + Path.GetFileName(Path.GetDirectoryName(resources)).Replace("Zalo-", ""));
                Console.WriteLine("  Zenlo: " + (File.Exists(Path.Combine(resources, "app.asar.bak")) ? "đã cài" : "chưa cài"));
            }
            catch (Exception error)
            {
                Console.WriteLine("  " + error.Message);
            }
            Console.WriteLine();
        }

        // Asks before closing a running Zalo; returns false when the user says no
        static bool ConfirmCloseZalo()
        {
            if (!IsZaloRunning()) return true;
            string answer = Ask("Zalo đang mở và sẽ được tắt trong lúc cài đặt, xong sẽ tự mở lại. Tiếp tục? (c/k): ");
            return answer != null && answer.ToLowerInvariant() == "c";
        }

        static void RunInstall()
        {
            if (!ConfirmCloseZalo()) return;
            bool wasRunning = IsZaloRunning();
            Install();
            bool kept = KeepForReinstall();
            Console.WriteLine();
            Console.WriteLine("Xong. Cài đặt, bản tóm tắt và Bản tin của bạn vẫn được giữ nguyên.");
            if (wasRunning && StartZalo())
            {
                Console.WriteLine("Zalo đang được mở lại. Bấm nút Zenlo màu tím ở thanh bên trái để bắt đầu.");
            }
            else
            {
                Console.WriteLine("Mở Zalo, rồi bấm nút Zenlo màu tím ở thanh bên trái để bắt đầu.");
            }
            if (kept)
            {
                Console.WriteLine();
                Console.WriteLine("Mỗi khi Zalo cập nhật, nút Zenlo sẽ biến mất. Khi đó: mở Start, gõ \"Zenlo\",");
                Console.WriteLine("chọn \"Zenlo - Cài đặt\" rồi chọn 1. Không cần tải lại.");
            }
        }

        static void RunUninstall()
        {
            if (!ConfirmCloseZalo()) return;
            bool wasRunning = IsZaloRunning();
            Uninstall();
            string left = RemoveReinstallCopy();
            Console.WriteLine();
            Console.WriteLine("Đã gỡ Zenlo, Zalo đã về bản gốc.");
            Console.WriteLine("Dữ liệu của Zenlo vẫn còn trong %APPDATA%\\Zenlo; xoá thư mục đó nếu muốn xoá sạch.");
            if (left != null) Console.WriteLine("Có thể xoá file cài đặt còn lại: " + left);
            if (wasRunning) StartZalo();
        }

        // ---------- Zalo ----------

        // Zalo keeps each version in its own "Zalo-x.y.z" folder; the newest one is the one that runs
        static string FindResourcesDir()
        {
            if (!Directory.Exists(ZaloRoot)) throw new Exception("Không thấy Zalo ở " + ZaloRoot + ".");
            string best = null;
            int[] bestVersion = null;
            foreach (string dir in Directory.GetDirectories(ZaloRoot, "Zalo-*"))
            {
                int[] version = ParseVersion(Path.GetFileName(dir).Substring("Zalo-".Length));
                if (version == null || !Directory.Exists(Path.Combine(dir, "resources"))) continue;
                if (best == null || CompareVersions(version, bestVersion) > 0)
                {
                    best = dir;
                    bestVersion = version;
                }
            }
            if (best == null) throw new Exception("Không tìm thấy thư mục phiên bản Zalo nào.");
            return Path.Combine(best, "resources");
        }

        static int[] ParseVersion(string text)
        {
            string[] parts = text.Split('.');
            int[] numbers = new int[parts.Length];
            for (int i = 0; i < parts.Length; i++)
            {
                if (!int.TryParse(parts[i], out numbers[i])) return null;
            }
            return numbers;
        }

        static int CompareVersions(int[] a, int[] b)
        {
            for (int i = 0; i < Math.Max(a.Length, b.Length); i++)
            {
                int x = i < a.Length ? a[i] : 0;
                int y = i < b.Length ? b[i] : 0;
                if (x != y) return x - y;
            }
            return 0;
        }

        static bool IsZaloRunning()
        {
            return Process.GetProcessesByName("Zalo").Length > 0;
        }

        static void StopZalo()
        {
            foreach (Process process in Process.GetProcessesByName("Zalo"))
            {
                try
                {
                    process.Kill();
                }
                catch (Exception)
                {
                    // Already gone
                }
            }
            // Wait for every Zalo process to end, then a moment for Windows to release the files
            for (int i = 0; i < 50 && IsZaloRunning(); i++) Thread.Sleep(100);
            Thread.Sleep(1000);
        }

        // Starts Zalo the way its own shortcut does; false when it could not
        static bool StartZalo()
        {
            string exe = Path.Combine(ZaloRoot, "Zalo.exe");
            if (!File.Exists(exe)) return false;
            try
            {
                ProcessStartInfo info = new ProcessStartInfo(exe);
                info.WorkingDirectory = ZaloRoot;
                info.UseShellExecute = true;
                Process.Start(info);
                return true;
            }
            catch (Exception)
            {
                return false;
            }
        }

        // Brings back Zalo's untouched app.asar (undoes a previous install)
        static bool RestoreOriginal(string resources)
        {
            string app = Path.Combine(resources, "app.asar");
            string backup = Path.Combine(resources, "app.asar.bak");
            if (!File.Exists(backup)) return false;
            if (Directory.Exists(app)) DeleteDirectory(app);
            else if (File.Exists(app)) File.Delete(app);
            File.Move(backup, app);
            return true;
        }

        static void Install()
        {
            string resources = FindResourcesDir();
            string app = Path.Combine(resources, "app.asar");
            string backup = Path.Combine(resources, "app.asar.bak");
            // A fresh folder with a random name, so nothing prepared in the temp folder can be slipped in
            string work = Path.Combine(Path.GetTempPath(), "zenlo-install-" + Guid.NewGuid().ToString("N"));
            string appDir = Path.Combine(work, "app");

            Console.WriteLine("Zalo: " + resources);
            Console.WriteLine("Đang tắt Zalo…");
            StopZalo();

            RestoreOriginal(resources);
            if (!File.Exists(app)) throw new Exception("Không tìm thấy app.asar gốc của Zalo.");

            try
            {
                Console.WriteLine("Đang giải nén Zalo…");
                Asar.ExtractAll(app, appDir);

                Console.WriteLine("Đang chép Zenlo…");
                string target = Path.Combine(appDir, "pc-dist", ZenloFolder);
                Directory.CreateDirectory(target);
                foreach (string name in Assets) File.WriteAllBytes(Path.Combine(target, name), ReadAsset(name));
                PatchPage(appDir);
                PatchBootstrap(appDir);

                File.Move(app, backup);
                try
                {
                    MoveDirectory(appDir, app);
                }
                catch (Exception error)
                {
                    // Never leave Zalo without its app: put the original back
                    RestoreOriginal(resources);
                    throw new Exception("Không chép được Zenlo vào Zalo (" + error.Message + "). Zalo đã được đưa về bản gốc.");
                }
            }
            finally
            {
                if (Directory.Exists(work)) DeleteDirectory(work);
            }

            string marker = Path.Combine(resources, DevMarker);
            if (File.Exists(marker)) File.Delete(marker);
            Console.WriteLine("Đã cài Zenlo.");
        }

        static void Uninstall()
        {
            string resources = FindResourcesDir();
            Console.WriteLine("Đang tắt Zalo…");
            StopZalo();
            if (!RestoreOriginal(resources)) throw new Exception("Không có bản sao lưu app.asar.bak, có vẻ Zenlo chưa được cài.");
            string marker = Path.Combine(resources, DevMarker);
            if (File.Exists(marker)) File.Delete(marker);
        }

        static string InsertBefore(string text, string marker, string addition, string file)
        {
            int at = text.LastIndexOf(marker, StringComparison.Ordinal);
            if (at < 0) throw new Exception("Không tìm thấy \"" + marker + "\" trong " + file + ". Có thể Zalo đã đổi cấu trúc.");
            return text.Substring(0, at) + addition + text.Substring(at);
        }

        // Adds Zenlo's stylesheet and script to Zalo's main page
        static void PatchPage(string appDir)
        {
            string file = Path.Combine(appDir, "pc-dist", "index.html");
            string html = File.ReadAllText(file, Encoding.UTF8);
            html = InsertBefore(html, "</head>", "<link rel=\"stylesheet\" href=\"" + ZenloFolder + "/zenlo.css\">", "index.html");
            html = InsertBefore(html, "</body>", "<script src=\"" + ZenloFolder + "/zenlo.js\"></script>", "index.html");
            File.WriteAllText(file, html, new UTF8Encoding(false));
        }

        // Loads Zenlo's main-process module right after Zalo's own. If Zenlo's files are missing,
        // Zalo still starts normally.
        static void PatchBootstrap(string appDir)
        {
            string file = Path.Combine(appDir, "bootstrap.js");
            const string anchor = "require('./main-dist/main');";
            string source = File.ReadAllText(file, Encoding.UTF8);
            int at = source.IndexOf(anchor, StringComparison.Ordinal);
            if (at < 0) throw new Exception("Không tìm thấy điểm nạp trong bootstrap.js. Có thể Zalo đã đổi cấu trúc.");
            string hook = "\n    try { require('./pc-dist/" + ZenloFolder + "/zenlo-main'); } catch (error) { console.error('[zenlo]', error); }";
            int end = at + anchor.Length;
            File.WriteAllText(file, source.Substring(0, end) + hook + source.Substring(end), new UTF8Encoding(false));
        }

        // ---------- Reinstalling after a Zalo update ----------

        static string SelfPath()
        {
            return Process.GetCurrentProcess().MainModule.FileName;
        }

        static bool IsKeptCopy()
        {
            return string.Equals(Path.GetFullPath(SelfPath()), Path.GetFullPath(KeptExe), StringComparison.OrdinalIgnoreCase);
        }

        // A copy of this program and a Start Menu shortcut "Zenlo - Cài đặt". Returns true when both are in place.
        static bool KeepForReinstall()
        {
            try
            {
                Directory.CreateDirectory(KeepDir);
                if (!IsKeptCopy()) File.Copy(SelfPath(), KeptExe, true);

                // Windows' own shortcut object cannot save a file name with "đ", so the shortcut is
                // made under a plain name and renamed
                string plain = Path.Combine(StartMenu, "Zenlo-Setup.lnk");
                string final = Path.Combine(StartMenu, ShortcutName);
                Type type = Type.GetTypeFromProgID("WScript.Shell");
                object shell = Activator.CreateInstance(type);
                object link = type.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { plain });
                Type linkType = link.GetType();
                linkType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, link, new object[] { KeptExe });
                linkType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, link, new object[] { KeepDir });
                linkType.InvokeMember("Save", BindingFlags.InvokeMethod, null, link, null);
                if (File.Exists(final)) File.Delete(final);
                File.Move(plain, final);
                return File.Exists(final);
            }
            catch (Exception)
            {
                return false;
            }
        }

        // Takes the shortcut and the kept copy away. Returns the copy's path when it is the program
        // running right now (it cannot delete itself).
        static string RemoveReinstallCopy()
        {
            foreach (string name in new[] { ShortcutName, "Zenlo-Setup.lnk" })
            {
                string path = Path.Combine(StartMenu, name);
                if (File.Exists(path)) File.Delete(path);
            }
            if (IsKeptCopy()) return KeptExe;
            if (Directory.Exists(KeepDir)) DeleteDirectory(KeepDir);
            return null;
        }

        // ---------- Files ----------

        static byte[] ReadAsset(string name)
        {
            using (Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(name))
            {
                if (stream == null) throw new Exception("Thiếu tệp " + name + " trong bộ cài.");
                using (MemoryStream memory = new MemoryStream())
                {
                    stream.CopyTo(memory);
                    return memory.ToArray();
                }
            }
        }

        // Deletes a folder, also when some files in it are read-only
        static void DeleteDirectory(string dir)
        {
            foreach (string file in Directory.GetFiles(dir, "*", SearchOption.AllDirectories))
            {
                File.SetAttributes(file, FileAttributes.Normal);
            }
            Directory.Delete(dir, true);
        }

        // Moves a folder; across drives, copies it and deletes the original
        static void MoveDirectory(string from, string to)
        {
            try
            {
                Directory.Move(from, to);
            }
            catch (IOException)
            {
                CopyDirectory(from, to);
                DeleteDirectory(from);
            }
        }

        static void CopyDirectory(string from, string to)
        {
            Directory.CreateDirectory(to);
            foreach (string file in Directory.GetFiles(from)) File.Copy(file, Path.Combine(to, Path.GetFileName(file)));
            foreach (string dir in Directory.GetDirectories(from)) CopyDirectory(dir, Path.Combine(to, Path.GetFileName(dir)));
        }
    }

    // Reads Electron's .asar archives: an 8-byte size header, a JSON index of every file, then the
    // files' bytes one after another. Files marked "unpacked" live next to the archive, in
    // "<archive>.unpacked".
    internal static class Asar
    {
        public static void ExtractAll(string archive, string dest)
        {
            using (FileStream stream = new FileStream(archive, FileMode.Open, FileAccess.Read, FileShare.Read))
            using (BinaryReader reader = new BinaryReader(stream))
            {
                // Pickle with the header's size, then the pickled header: payload size, string length, JSON
                reader.ReadUInt32();
                uint headerSize = reader.ReadUInt32();
                reader.ReadUInt32();
                int jsonLength = reader.ReadInt32();
                string json = Encoding.UTF8.GetString(reader.ReadBytes(jsonLength));
                long baseOffset = 8 + headerSize;

                JavaScriptSerializer serializer = new JavaScriptSerializer();
                serializer.MaxJsonLength = int.MaxValue;
                serializer.RecursionLimit = 1000;
                IDictionary<string, object> root = (IDictionary<string, object>)serializer.DeserializeObject(json);

                Directory.CreateDirectory(dest);
                Extract(stream, baseOffset, (IDictionary<string, object>)root["files"], dest, archive + ".unpacked", "");
            }
        }

        static void Extract(FileStream stream, long baseOffset, IDictionary<string, object> files, string dest, string unpackedRoot, string relative)
        {
            foreach (KeyValuePair<string, object> entry in files)
            {
                string name = entry.Key;
                // An archive is not allowed to write outside the folder
                if (name == "." || name == ".." || name.IndexOfAny(new[] { '/', '\\', ':' }) >= 0)
                {
                    throw new Exception("Tên tệp không hợp lệ trong app.asar: " + name);
                }
                IDictionary<string, object> node = (IDictionary<string, object>)entry.Value;
                string path = Path.Combine(dest, name);
                string rel = relative.Length == 0 ? name : relative + Path.DirectorySeparatorChar + name;

                if (node.ContainsKey("files"))
                {
                    Directory.CreateDirectory(path);
                    Extract(stream, baseOffset, (IDictionary<string, object>)node["files"], path, unpackedRoot, rel);
                }
                else if (node.ContainsKey("link"))
                {
                    throw new Exception("app.asar có liên kết (" + rel + "), bộ cài chưa hỗ trợ.");
                }
                else if (node.ContainsKey("unpacked") && Convert.ToBoolean(node["unpacked"]))
                {
                    File.Copy(Path.Combine(unpackedRoot, rel), path, true);
                }
                else
                {
                    long size = Convert.ToInt64(node["size"]);
                    long offset = Convert.ToInt64(node["offset"]);
                    CopyBytes(stream, baseOffset + offset, size, path);
                }
            }
        }

        static void CopyBytes(FileStream stream, long start, long size, string path)
        {
            stream.Seek(start, SeekOrigin.Begin);
            byte[] buffer = new byte[81920];
            using (FileStream output = new FileStream(path, FileMode.Create, FileAccess.Write))
            {
                long left = size;
                while (left > 0)
                {
                    int read = stream.Read(buffer, 0, (int)Math.Min(buffer.Length, left));
                    if (read <= 0) throw new Exception("app.asar bị thiếu dữ liệu.");
                    output.Write(buffer, 0, read);
                    left -= read;
                }
            }
        }
    }
}
