import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const routeRegistryPath = path.join(projectRoot, "src", "api", "routes", "RouteRegistry.ts");

function resolveContractPath() {
  const fromEnv = String(process.env.BEEMCP_API_CONTRACT_FILE || "").trim();
  const candidates = [
    fromEnv,
    path.join(projectRoot, ".trae", "rules", "api_contract_template.md"),
    path.join(projectRoot, "..", ".trae", "rules", "api_contract_template.md")
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fsSync.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(`API_CONTRACT_FILE_NOT_FOUND: ${candidates.join(" | ")}`);
}

async function main() {
  try {
    const contractPath = resolveContractPath();
    const contractContent = await fs.readFile(contractPath, "utf-8");
    const routeContent = await fs.readFile(routeRegistryPath, "utf-8");

    // 1. 提取契约中的所有接口路径
    const contractPaths = [];
    const contractRegex = /^## \[[A-Z]+\] (\/api\/[^\s\n]+)/gm;
    let match;
    while ((match = contractRegex.exec(contractContent)) !== null) {
      contractPaths.push(match[1]);
    }

    // 2. 提取 RouteRegistry 中的所有注册路径
    const registeredPaths = [];
    const routeRegex = /app\.(get|post|put|delete|patch)\(["']([^"']+)["']/g;
    while ((match = routeRegex.exec(routeContent)) !== null) {
      registeredPaths.push(match[2]);
    }

    // 3. 校验：所有已注册路径必须在契约中存在
    const missingInContract = registeredPaths.filter(p => !contractPaths.includes(p));
    
    if (missingInContract.length > 0) {
      process.stderr.write("API Contract Check Failed: The following routes are registered but missing in api_contract_template.md\n");
      for (const p of missingInContract) {
        process.stderr.write(`- ${p}\n`);
      }
      process.stderr.write("\nPlease update .trae/rules/api_contract_template.md before proceeding.\n");
      process.exit(1);
    }

    process.stdout.write(`API Contract Check Passed: ${registeredPaths.length} routes verified against contract.\n`);
  } catch (err) {
    process.stderr.write(`API Contract Check Crashed: ${err.message}\n`);
    process.exit(1);
  }
}

main();
