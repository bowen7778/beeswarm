import { injectable } from "inversify";

@injectable()
export class HarnessFailureClassifierService {
  classify(errorCode: string): string {
    const code = String(errorCode || "").trim().toUpperCase();
    if (!code) return "E_UNKNOWN";
    if (code.includes("ROUTE")) return "E_ROUTE";
    if (code.includes("MEMORY")) return "E_MEMORY_CONFLICT";
    if (code.includes("TIMEOUT")) return "E_TIMEOUT";
    if (code.includes("SAFETY")) return "E_SAFETY";
    if (code.includes("CHANNEL") || code.includes("TOOL")) return "E_TOOL";
    if (code.includes("MODE") || code.includes("POLICY")) return "E_POLICY";
    if (code.includes("PROJECT_NOT_FOUND") || code.includes("PROJECT_CONTEXT_REQUIRED")) return "E_ROUTE";
    return "E_UNKNOWN";
  }
}

