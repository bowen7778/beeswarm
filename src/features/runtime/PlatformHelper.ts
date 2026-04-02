import { spawn } from "node:child_process";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import process from "node:process";

export class PlatformHelper {
  private static spawnDetached(command: string, args: string[] = []): void {
    try {
      const child = spawn(command, args, {
        detached: true,
        stdio: "ignore",
        windowsHide: true
      });
      child.on("error", (err: any) => {
        process.stderr.write(`[PlatformHelper] child process error: ${String(err?.message || err)}\n`);
      });
      child.unref();
    } catch (err: any) {
      process.stderr.write(`[PlatformHelper] spawnDetached failed: ${String(err?.message || err)}\n`);
    }
  }

  static isWindows(): boolean {
    return os.platform() === "win32";
  }

  static isMacOS(): boolean {
    return os.platform() === "darwin";
  }

  static openBrowser(url: string, appMode: boolean = true): void {
    const validatedUrl = this.validateUrl(url);
    if (!validatedUrl) return;

    // Attempt to find and launch compiled Tauri desktop application (Production Mode)
    if (this.tryLaunchDesktopBinary()) {
      return;
    }

    if (this.isWindows()) {
      if (appMode) {
        this.launchNativeWebView2(validatedUrl);
      } else {
        this.spawnDetached("cmd.exe", ["/c", "start", validatedUrl]);
      }
    } else if (this.isMacOS()) {
      if (appMode) {
        const commands = [
          `open -n -a "Microsoft Edge" --args --app=${validatedUrl}`,
          `open -n -a "Google Chrome" --args --app=${validatedUrl}`,
          `open "${validatedUrl}"`
        ];
        for (const cmd of commands) {
          try {
            const { execSync } = require("node:child_process");
            execSync(cmd, { stdio: "ignore" });
            break;
          } catch (err: any) {
            process.stderr.write(`[PlatformHelper] open app mode failed: ${String(err?.message || err)}\n`);
          }
        }
      } else {
        this.spawnDetached("open", [validatedUrl]);
      }
    } else {
      this.spawnDetached("xdg-open", [validatedUrl]);
    }
  }

  private static tryLaunchDesktopBinary(): boolean {
    const entry = String(process.argv[1] || "").trim();
    if (!entry) return false;

    const entryDir = path.dirname(path.resolve(entry));
    // Search path rules:
    // 1. beemcp.exe in the same directory
    // 2. ../build/src-tauri/target/release/beemcp.exe (Development build artifact)
    const binName = this.isWindows() ? "beemcp.exe" : "beemcp";
    const searchPaths = [
      path.join(entryDir, binName),
      path.join(entryDir, "..", "src-tauri", "target", "release", binName),
      path.join(entryDir, "..", "build", "src-tauri", "target", "release", binName)
    ];

    for (const p of searchPaths) {
      if (fsSync.existsSync(p)) {
        process.stderr.write(`[PlatformHelper] Found desktop binary at ${p}, launching...\n`);
        this.spawnDetached(p);
        return true;
      }
    }
    return false;
  }

  private static validateUrl(url: string): string | null {
    try {
      const u = new URL(url);
      if (u.protocol !== "http:" && u.protocol !== "https:") return null;
      return u.toString();
    } catch {
      return null;
    }
  }

  private static launchNativeWebView2(url: string): void {
    const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = New-Object Windows.Forms.Form
$form.Text = "BeeMCP - Desktop Console"
$form.Width = 1280
$form.Height = 850
$form.StartPosition = "CenterScreen"
$form.Icon = [System.Drawing.Icon]::ExtractAssociatedIcon([System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName)

$webView = New-Object Microsoft.Web.WebView2.WinForms.WebView2
$webView.Dock = "Fill"
$form.Controls.Add($webView)

$form.Add_Load({
    async {
        try {
            await $webView.EnsureCoreWebView2Async()
            $webView.Source = "${url}"
        } catch {
            Write-Error "WebView2 Initialization Failed"
        }
    }.Invoke()
})

[Windows.Forms.Application]::Run($form)
`;
    const tempScriptPath = path.join(os.tmpdir(), `beemcp_launcher_${Date.now()}.ps1`);
    try {
      fsSync.writeFileSync(tempScriptPath, script, "utf8");
      // Use -WindowStyle Hidden to hide the background PowerShell black window
      this.spawnDetached("powershell.exe", [
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-WindowStyle", "Hidden",
        "-File", tempScriptPath
      ]);
      // Delay delete script
      setTimeout(() => fsSync.unlinkSync(tempScriptPath), 10000);
    } catch (err: any) {
      process.stderr.write(`[PlatformHelper] launchNativeWebView2 failed: ${err.message}\n`);
      // Final fallback: Browser App mode
      this.spawnDetached("cmd.exe", ["/c", `start msedge --app="${url}"`]);
    }
  }
}

