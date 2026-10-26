/*
  Zenlo – a stand-in for OpenAI's codex.exe, for testing Zenlo's Codex support without a ChatGPT
  plan. It answers the commands Zenlo uses, the way the real CLI does (codex-rs, commit 970111f6;
  codex-cli 0.160 for the catalog): "codex login status", "codex debug models [--bundled]" and
  "codex exec --json ... -".

  FAKE_CODEX_LOGIN    chatgpt (default) | none | apikey
  FAKE_CODEX_SCENARIO success (default) | usage | usage-plus | upgrade | badmodel | unauthorized |
                      network | crash | tooLong
  FAKE_CODEX_LOG      a file to write the arguments and the prompt read from stdin to
  FAKE_CODEX_CATALOG  ok (default) | fail: "debug models" without --bundled cannot refresh
*/

using System;
using System.IO;
using System.Text;

internal static class FakeCodex
{
    static int Main(string[] args)
    {
        var stdout = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true };
        var stderr = new StreamWriter(Console.OpenStandardError(), new UTF8Encoding(false)) { AutoFlush = true };
        string login = Environment.GetEnvironmentVariable("FAKE_CODEX_LOGIN") ?? "chatgpt";
        string scenario = Environment.GetEnvironmentVariable("FAKE_CODEX_SCENARIO") ?? "success";
        string log = Environment.GetEnvironmentVariable("FAKE_CODEX_LOG");

        if (args.Length >= 2 && args[0] == "login" && args[1] == "status")
        {
            if (login == "none") { stderr.WriteLine("Not logged in"); return 1; }
            if (login == "apikey") { stderr.WriteLine("API key configured - sk-proj-***ABCD"); return 0; }
            stderr.WriteLine("Logged in using ChatGPT");
            return 0;
        }

        if (args.Length >= 2 && args[0] == "debug" && args[1] == "models")
        {
            bool bundled = Array.IndexOf(args, "--bundled") != -1;
            if (!bundled && Environment.GetEnvironmentVariable("FAKE_CODEX_CATALOG") == "fail")
            {
                stderr.WriteLine("Error: failed to refresh available models");
                return 1;
            }
            // The refreshed list holds what the plan can use; the bundled one, every model this Codex knows
            stdout.WriteLine("{\"models\":[" +
                Model("gpt-reserve", "GPT-Reserve", "hide", 4, "\"low\",\"medium\"") + "," +
                (bundled ? Model("gpt-6-sol", "GPT-6-Sol", "list", 3, "\"low\",\"medium\",\"high\",\"xhigh\",\"max\",\"ultra\"") + "," : "") +
                Model("gpt-6-luna", "GPT-6-Luna", "list", 5, "\"low\",\"medium\",\"high\",\"xhigh\",\"max\"") + "," +
                Model("gpt-5.6-luna", "GPT-5.6-Luna", "list", 9, "\"low\",\"medium\",\"high\"") + "]}");
            return 0;
        }

        if (args.Length == 0 || args[0] != "exec") { stderr.WriteLine("error: unexpected arguments"); return 2; }

        // The real CLI reads the whole prompt when it is "-"
        string prompt = "";
        if (args[args.Length - 1] == "-")
        {
            using (var reader = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false))) prompt = reader.ReadToEnd();
        }
        if (log != null)
        {
            File.WriteAllText(log, "ARGS\n" + string.Join("\n", args) + "\nCWD\n" + Environment.CurrentDirectory +
                "\nENV CODEX_API_KEY=" + (Environment.GetEnvironmentVariable("CODEX_API_KEY") ?? "") +
                "\nENV OPENAI_API_KEY=" + (Environment.GetEnvironmentVariable("OPENAI_API_KEY") ?? "") +
                "\nPROMPT\n" + prompt, new UTF8Encoding(false));
        }
        if (prompt.Trim().Length == 0) { stderr.WriteLine("No prompt provided via stdin."); return 1; }

        if (scenario == "tooLong")
        {
            stderr.WriteLine("Error: turn/start: Input exceeds the maximum length of 1048576 characters.");
            return 1;
        }

        stdout.WriteLine("{\"type\":\"thread.started\",\"thread_id\":\"0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b\"}");
        stdout.WriteLine("{\"type\":\"turn.started\"}");

        string failure = null;
        switch (scenario)
        {
            case "success":
                stdout.WriteLine("{\"type\":\"item.completed\",\"item\":{\"id\":\"item_0\",\"type\":\"agent_message\",\"text\":\"Liên quan tới bạn\\n- Gửi chị Hoa slide trước 9h mai. [19/10 08:30]\"}}");
                stdout.WriteLine("{\"type\":\"turn.completed\",\"usage\":{\"input_tokens\":5120,\"cached_input_tokens\":0,\"cache_write_input_tokens\":0,\"output_tokens\":210,\"reasoning_output_tokens\":64}}");
                return 0;
            case "usage":
                failure = "You’ve hit your usage limit. Visit https://chatgpt.com/settings/usage to purchase more credits or try again at 3:05 PM.";
                break;
            case "usage-plus":
                failure = "You’ve hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/settings/usage to purchase more credits or try again at Oct 26th, 2026 3:05 PM.";
                break;
            case "upgrade":
                failure = "To use Codex with your ChatGPT plan, upgrade to Plus: https://chatgpt.com/explore/plus.";
                break;
            case "badmodel":
                stdout.WriteLine("{\"type\":\"item.completed\",\"item\":{\"id\":\"item_0\",\"type\":\"error\",\"message\":\"Model metadata for `gpt-x` not found. Defaulting to fallback metadata; this can degrade performance and cause issues.\"}}");
                failure = "unexpected status 400 Bad Request: {\"detail\":\"The 'gpt-x' model is not supported when using Codex with a ChatGPT account.\"}";
                break;
            case "unauthorized":
                failure = "unexpected status 401 Unauthorized: Missing bearer or basic authentication in header";
                break;
            case "network":
                failure = "exceeded retry limit, last status: 503 Service Unavailable";
                break;
            case "crash":
                stderr.WriteLine("thread 'main' panicked at codex-rs/exec/src/lib.rs:1:1:");
                stderr.WriteLine("something went wrong");
                return 101;
        }

        string json = failure.Replace("\\", "\\\\").Replace("\"", "\\\"");
        stdout.WriteLine("{\"type\":\"error\",\"message\":\"" + json + "\"}");
        stdout.WriteLine("{\"type\":\"turn.failed\",\"error\":{\"message\":\"" + json + "\"}}");
        return 1;
    }

    static string Model(string slug, string name, string visibility, int priority, string efforts)
    {
        var levels = new StringBuilder();
        foreach (string effort in efforts.Split(','))
        {
            if (levels.Length > 0) levels.Append(",");
            levels.Append("{\"effort\":" + effort + ",\"description\":\"\"}");
        }
        return "{\"slug\":\"" + slug + "\",\"display_name\":\"" + name + "\",\"visibility\":\"" + visibility +
            "\",\"priority\":" + priority + ",\"default_reasoning_level\":\"medium\",\"supported_reasoning_levels\":[" + levels + "]}";
    }
}
