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

  // If already patched with hasChoicesDelta, skip
  if (content.includes('hasChoicesDelta')) {
    console.log(`[patch-workers-ai] ${path.basename(filePath)} is already patched with dual-format deduplication.`);
    continue;
  }

  // 1. Guard native response text against dual-format duplication
  content = content.replace(
    'const nativeResponse = chunk.response;\n\t\t\tif (nativeResponse != null',
    'const hasChoicesDelta = choices?.[0]?.delta != null;\n\t\t\tconst nativeResponse = chunk.response;\n\t\t\tif (!hasChoicesDelta && nativeResponse != null'
  );
  content = content.replace(
    'const nativeResponse = chunk.response;\n\t\t\t\tif (nativeResponse != null',
    'const hasChoicesDelta = choices?.[0]?.delta != null;\n\t\t\t\tconst nativeResponse = chunk.response;\n\t\t\t\tif (!hasChoicesDelta && nativeResponse != null'
  );

  // 2. Guard native tool_calls against dual-format duplication
  content = content.replace(
    'if (Array.isArray(chunk.tool_calls)) {',
    'if (!hasChoicesDelta && Array.isArray(chunk.tool_calls)) {'
  );

  fs.writeFileSync(filePath, content, 'utf-8');
  console.log(`[patch-workers-ai] Successfully patched ${path.basename(filePath)}.`);
}
