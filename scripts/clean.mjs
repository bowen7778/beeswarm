import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const roots = [process.cwd()];
const rel = ['../build', './build', './dist'];

try {
  execSync('taskkill /F /IM app.exe /T', { stdio: 'ignore' });
} catch (e) {}

try {
  // Use powershell to clean processes if needed
  execSync('powershell "Get-Process | Where-Object { $_.CommandLine -like \'*cli.cjs*\' } | Stop-Process -Force"', { stdio: 'ignore' });
} catch (e) {}

for (const r of roots) {
  for (const p of rel) {
    try {
      const target = path.resolve(r, p);
      if (fs.existsSync(target)) {
        fs.rmSync(target, { recursive: true, force: true });
        console.log(`Cleaned: ${target}`);
      }
    } catch (e) {}
  }
}
