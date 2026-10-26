/*
  Zenlo – a stand-in for OpenAI's codex.exe, for testing Zenlo's Codex support without a ChatGPT
  plan. It answers the commands Zenlo uses, the way the real CLI does (codex-rs, commit 970111f6;
  codex-cli 0.160 for the catalog and the app server): "codex login status", "codex debug models
  [--bundled]", "codex app-server" and "codex exec --json ... -".

  FAKE_CODEX_LOGIN    chatgpt (default) | none | apikey
  FAKE_CODEX_SCENARIO success (default) | usage | usage-plus | upgrade | badmodel | unauthorized |
                      network | crash | tooLong
  FAKE_CODEX_LOG      a file to write the arguments and the prompt read from stdin to
  FAKE_CODEX_CATALOG  ok (default) | fail: "debug models" without --bundled cannot refresh
  FAKE_CODEX_APPSERVER ok (default) | missing (no such command) | mcp (an MCP server still starts) |
                      hook (a hook is set)
*/

using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;

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

        if (args.Length >= 1 && args[0] == "app-server") return AppServer(args, stdout, stderr, login, scenario, log);

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

    // ---------- codex app-server (JSON-RPC lines on stdin/stdout, codex-cli 0.160) ----------

    static string AppFailure(string scenario)
    {
        switch (scenario)
        {
            case "usage": return "You’ve hit your usage limit. Visit https://chatgpt.com/settings/usage to purchase more credits or try again at 3:05 PM.";
            case "usage-plus": return "You’ve hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/settings/usage to purchase more credits or try again at Oct 26th, 2026 3:05 PM.";
            case "upgrade": return "To use Codex with your ChatGPT plan, upgrade to Plus: https://chatgpt.com/explore/plus.";
            case "badmodel": return "unexpected status 400 Bad Request: {\"detail\":\"The 'gpt-x' model is not supported when using Codex with a ChatGPT account.\"}";
            case "unauthorized": return "unexpected status 401 Unauthorized: Missing bearer or basic authentication in header";
            case "network": return "exceeded retry limit, last status: 503 Service Unavailable";
        }
        return null;
    }

    static int AppServer(string[] args, StreamWriter stdout, StreamWriter stderr, string login, string scenario, string log)
    {
        string mode = Environment.GetEnvironmentVariable("FAKE_CODEX_APPSERVER") ?? "ok";
        if (mode == "missing") { stderr.WriteLine("error: unrecognized subcommand 'app-server'"); return 2; }
        var json = new JavaScriptSerializer();
        var input = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
        var record = new StringBuilder("ARGS\n" + string.Join("\n", args));
        string cwd = "";
        bool mcpOff = false;
        string line;
        while ((line = input.ReadLine()) != null)
        {
            if (line.Trim().Length == 0) continue;
            var msg = (Dictionary<string, object>)json.DeserializeObject(line);
            if (!msg.ContainsKey("id") || !msg.ContainsKey("method")) continue;
            object id = msg["id"];
            string method = (string)msg["method"];
            var p = msg.ContainsKey("params") && msg["params"] is Dictionary<string, object> ? (Dictionary<string, object>)msg["params"] : new Dictionary<string, object>();
            Func<object, string> reply = result => json.Serialize(new Dictionary<string, object> { { "id", id }, { "result", result } });
            Func<string, object, string> note = (name, value) => json.Serialize(new Dictionary<string, object> { { "method", name }, { "params", value } });

            if (method == "initialize")
            {
                stdout.WriteLine(reply(new Dictionary<string, object> { { "userAgent", "fake" } }));
                stdout.WriteLine(note("account/updated", new Dictionary<string, object> { { "authMode", login == "apikey" ? "apikey" : "chatgpt" }, { "planType", "plus" } }));
            }
            else if (method == "config/read")
            {
                var servers = new Dictionary<string, object> { { "node_repl", new Dictionary<string, object> { { "command", "node_repl.exe" } } } };
                stdout.WriteLine(reply(new Dictionary<string, object> { { "config", new Dictionary<string, object> { { "mcp_servers", servers } } } }));
            }
            else if (method == "thread/start")
            {
                cwd = p.ContainsKey("cwd") ? (string)p["cwd"] : "";
                var config = p.ContainsKey("config") ? p["config"] as Dictionary<string, object> : null;
                var servers = config != null && config.ContainsKey("mcp_servers") ? config["mcp_servers"] as Dictionary<string, object> : null;
                var repl = servers != null && servers.ContainsKey("node_repl") ? servers["node_repl"] as Dictionary<string, object> : null;
                mcpOff = repl != null && repl.ContainsKey("enabled") && false.Equals(repl["enabled"]);
                foreach (var key in new[] { "sandbox", "approvalPolicy", "ephemeral", "model", "baseInstructions" })
                    record.Append("\nthread." + key + "=" + (p.ContainsKey(key) && p[key] != null ? Convert.ToString(p[key]).ToLowerInvariant() == "true" ? "true" : Convert.ToString(p[key]) : "null"));
                record.Append("\nthread.mcp.node_repl.off=" + (mcpOff ? "true" : "false"));
                stdout.WriteLine(reply(new Dictionary<string, object> { { "thread", new Dictionary<string, object> { { "id", "thread-1" } } } }));
            }
            else if (method == "mcpServerStatus/list")
            {
                string status = mode == "mcp" || !mcpOff ? "starting" : "disabled";
                stdout.WriteLine(reply(new Dictionary<string, object> { { "data", new object[] { new Dictionary<string, object> { { "name", "node_repl" }, { "runtimeStatus", status } } } } }));
            }
            else if (method == "hooks/list")
            {
                object[] hooks = mode == "hook" ? new object[] { new Dictionary<string, object> { { "event", "Stop" } } } : new object[0];
                stdout.WriteLine(reply(new Dictionary<string, object> { { "data", new object[] { new Dictionary<string, object> { { "cwd", cwd }, { "hooks", hooks } } } } }));
            }
            else if (method == "turn/start")
            {
                string prompt = "";
                var items = p.ContainsKey("input") ? p["input"] as object[] : null;
                if (items != null && items.Length > 0) prompt = (string)((Dictionary<string, object>)items[0])["text"];
                record.Append("\nturn.effort=" + (p.ContainsKey("effort") ? Convert.ToString(p["effort"]) : "null"));
                record.Append("\nturn.model=" + (p.ContainsKey("model") && p["model"] != null ? Convert.ToString(p["model"]) : "null"));
                if (log != null)
                {
                    File.WriteAllText(log, record + "\nCWD\n" + cwd +
                        "\nENV CODEX_API_KEY=" + (Environment.GetEnvironmentVariable("CODEX_API_KEY") ?? "") +
                        "\nENV OPENAI_API_KEY=" + (Environment.GetEnvironmentVariable("OPENAI_API_KEY") ?? "") +
                        "\nPROMPT\n" + prompt, new UTF8Encoding(false));
                }
                if (scenario == "tooLong")
                {
                    stdout.WriteLine(json.Serialize(new Dictionary<string, object> { { "id", id }, { "error", new Dictionary<string, object> { { "code", -32600 }, { "message", "Input exceeds the maximum length of 1048576 characters." } } } }));
                    continue;
                }
                stdout.WriteLine(reply(new Dictionary<string, object> { { "turn", new Dictionary<string, object> { { "id", "turn-1" } } } }));
                if (scenario == "crash")
                {
                    stderr.WriteLine("thread 'main' panicked at codex-rs/app-server/src/lib.rs:1:1:");
                    return 101;
                }
                string failure = AppFailure(scenario);
                if (failure != null)
                {
                    var error = new Dictionary<string, object> { { "message", failure } };
                    stdout.WriteLine(note("error", new Dictionary<string, object> { { "error", error }, { "willRetry", false } }));
                    stdout.WriteLine(note("turn/completed", new Dictionary<string, object> { { "turn", new Dictionary<string, object> { { "status", "failed" }, { "error", error } } } }));
                    continue;
                }
                string[] parts = { "Liên quan tới bạn\n", "- Gửi chị Hoa slide ", "trước 9h mai. [19/10 08:30]" };
                foreach (string part in parts)
                {
                    stdout.WriteLine(note("item/agentMessage/delta", new Dictionary<string, object> { { "delta", part } }));
                    System.Threading.Thread.Sleep(150);
                }
                stdout.WriteLine(note("item/completed", new Dictionary<string, object> { { "item", new Dictionary<string, object> { { "type", "agentMessage" }, { "text", string.Join("", parts) } } } }));
                stdout.WriteLine(note("turn/completed", new Dictionary<string, object> { { "turn", new Dictionary<string, object> { { "status", "completed" } } } }));
            }
            else
            {
                stdout.WriteLine(reply(new Dictionary<string, object>()));
            }
        }
        return 0;
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
