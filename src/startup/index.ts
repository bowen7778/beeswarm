import "reflect-metadata";
import { container } from "../common/di/container.js";
import { SYMBOLS } from "../common/di/symbols.js";
import { LifecycleManager } from "../features/runtime/LifecycleManager.js";

/**
 * Refactored single-process entry point (side-effect free)
 */
export async function startServer() {
  const lifecycle = container.get<LifecycleManager>(SYMBOLS.LifecycleManager);
  await lifecycle.boot();
  return lifecycle;
}

