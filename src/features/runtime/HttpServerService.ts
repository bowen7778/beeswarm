import { injectable, inject } from "inversify";
import express from "express";
import { SYMBOLS } from "../../common/di/symbols.js";
import { LoggerService } from "./LoggerService.js";

@injectable()
export class HttpServerService {
  private server: any = null;
  public readonly app: express.Express;

  constructor(
    @inject(SYMBOLS.LoggerService) private readonly logger: LoggerService
  ) {
    this.app = express();
  }

  isListening(): boolean {
    return !!(this.server && typeof this.server.listening === "boolean" && this.server.listening);
  }

  async start(port: number, host: string, onListen?: () => Promise<void> | void): Promise<void> {
    if (this.isListening()) return;
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finishOk = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const finishErr = (err: Error) => {
        if (settled) return;
        settled = true;
        reject(err);
      };
      const server = this.app.listen(port, host, async () => {
        try {
          this.server = server;
          if (onListen) {
            await onListen();
          }
          const addr = server.address();
          const actualHost = typeof addr === "string" ? addr : addr?.address;
          const actualPort = typeof addr === "string" ? null : addr?.port;
          this.logger.info(`[HttpServerService] UI Server listening on ${actualHost}:${actualPort || port} (Target: ${host}:${port})`);
          finishOk();
        } catch (err: any) {
          this.server = null;
          try {
            server.close();
          } catch (closeErr: any) {
            this.logger.error("[HttpServerService] close after listen failure failed", closeErr);
          }
          finishErr(new Error(String(err?.message || err)));
        }
      });
      server.once("error", (e: any) => {
        this.server = null;
        if (e.code === "EADDRINUSE") {
          finishErr(new Error(`UI_PORT_IN_USE:${port}`));
        } else {
          finishErr(new Error(`UI_SERVER_ERROR:${e.message}`));
        }
      });
    });
  }

  async stop(onClose?: () => Promise<void> | void): Promise<void> {
    if (!this.server) {
      if (onClose) {
        await onClose();
      }
      return;
    }
    const server = this.server;
    return new Promise<void>((resolve) => {
      server.close(async () => {
        this.server = null;
        if (onClose) {
          await onClose();
        }
        resolve();
      });
    });
  }
}

