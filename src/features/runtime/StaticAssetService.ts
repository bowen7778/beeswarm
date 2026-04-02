import { injectable, inject } from "inversify";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PathResolverService } from "./PathResolverService.js";
import { LoggerService } from "./LoggerService.js";
import { SYMBOLS } from "../../common/di/symbols.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

@injectable()
export class StaticAssetService {
  private _staticDir: string = "";

  constructor(
    @inject(SYMBOLS.PathResolverService) private readonly pathResolver: PathResolverService,
    @inject(SYMBOLS.LoggerService) private readonly logger: LoggerService
  ) {
    this._staticDir = this.resolveStaticDir();
  }

  private resolveStaticDir(): string {
    // Priority: search build artifacts (build/ui) before source directories.
    // This ensures that if build is executed, the latest compiled code is loaded.
    const roots = [
      path.join(process.cwd(), "build", "ui"),
      path.join(this.pathResolver.programRoot, "ui"),
      path.join(path.dirname(this.pathResolver.programRoot), "ui"),
      path.join(process.cwd(), "ui")
    ];

    for (const p of roots) {
      const indexFile = path.join(p, "index.html");
      if (fsSync.existsSync(indexFile)) {
        this.logger.info("SYSTEM", `Static assets found at: ${p}`);
        return p;
      }
    }

    // Final fallback: try relative to current file
    // __dirname is in build/dist, .. is build, so build/ui is the target
    const fallback = path.join(__dirname, "..", "ui");
    if (fsSync.existsSync(path.join(fallback, "index.html"))) {
      return fallback;
    }

    this.logger.error("SYSTEM", `Static assets NOT FOUND in searched paths: ${roots.join(", ")}`);
    throw new Error(`UI_ASSETS_MISSING: Cannot find index.html in any candidate path.`);
  }

  get staticDir(): string {
    return this._staticDir;
  }
}

