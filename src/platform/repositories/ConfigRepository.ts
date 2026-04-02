import { injectable } from "inversify";
import fs from "node:fs/promises";
import path from "node:path";

@injectable()
export class ConfigRepository {
  async readJson<T = any>(filePath: string, fallback: T): Promise<T> {
    try {
      return JSON.parse(await fs.readFile(filePath, "utf-8")) as T;
    } catch {
      return fallback;
    }
  }

  async writeJson(filePath: string, data: any): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
  }
}

