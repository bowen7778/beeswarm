import "reflect-metadata";
import process from "node:process";
import { startServer } from "./index.js";

async function main() {
  try {
    const lifecycle = await startServer();
    const ignoreStdinClose = String(process.env.BEESWARM_IGNORE_STDIN_CLOSE || "").trim() === "1";
    
    process.on("exit", () => {
      process.stderr.write("[SYSTEM] Process exiting...\n");
    });

    const handleShutdown = async () => {
      await lifecycle.shutdown();
      process.exit(0);
    };

    process.on("SIGINT", handleShutdown);
    process.on("SIGTERM", handleShutdown);

    // Monitor stdio close event to prevent zombie processes on Windows caused by parent process crash
    // Ignore this logic in development mode as tsup/npm might not correctly pipe stdin
    const isDev = String(process.env.BEESWARM_IS_DEV || "").trim() === "1";
    if (!ignoreStdinClose && !isDev) {
      process.stdin.on("close", () => {
        process.stderr.write("[SYSTEM] Stdin closed. Exiting to prevent zombie process...\n");
        handleShutdown();
      });
    }
  } catch (err: any) {
    const message = String(err?.message || err);
    if (message.startsWith("HOST_ALREADY_RUNNING_EXIT_MODE:")) {
      process.stderr.write("[SYSTEM] BeeSwarm host instance already exists. Exit current process.\n");
      process.exit(0);
    }
    process.stderr.write(`[BOOT_FAILED] ${message}\n`);
    process.exit(1);
  }
}

// Core Entry Point
main().catch((err) => {
  process.stderr.write(`[CRITICAL_BOOT_ERROR] ${String(err.message || err)}\n`);
  process.exit(1);
});

