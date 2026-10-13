import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(__dirname, '../node_modules/workers-ai-provider');

const filesToPatch = [
  path.join(pkgDir, 'dist/index.mjs'),
  path.join(pkgDir, 'src/streaming.ts'),
];

for (const filePath of filesToPatch) {
  if (!fs.existsSync(filePath)) {
    continue;
  }
  let content = fs.readFileSync(filePath, 'utf-8');

  // Check if already patched
  if (content.includes('!Array.isArray(chunk.tool_calls)')) {
    console.log(`[patch-workers-ai] ${path.basename(filePath)} is already patched.`);
    continue;
  }

  // Replace double-invocation bug of emitToolCallDeltas
  const target = 'if (Array.isArray(deltaToolCalls)) {';
  const replacement = 'if (Array.isArray(deltaToolCalls) && !Array.isArray(chunk.tool_calls)) {';

  if (content.includes(target)) {
    content = content.replace(target, replacement);
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`[patch-workers-ai] Successfully patched ${path.basename(filePath)}.`);
  } else {
    console.warn(`[patch-workers-ai] Target pattern not found in ${path.basename(filePath)}.`);
  }
}
