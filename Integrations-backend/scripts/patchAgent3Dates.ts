import * as fs from 'fs';
import * as path from 'path';

const filePath = path.resolve(__dirname, '../src/services/enhancedDetectionService.ts');
let content = fs.readFileSync(filePath, 'utf-8');

// Insert dynamic window variables right after job logging
content = content.replace(
    /logger\.info\('🧠 \[AGENT3\] Detection pipeline triggered - LIVE MODE', \{[\s\S]*?\}\);/,
    `logger.info('🧠 [AGENT3] Detection pipeline triggered - LIVE MODE', {
      userId,
      syncId,
      triggerType,
      jobId
    });

    const csvMode = triggerType === 'csv_upload';
    const w60 = csvMode ? 730 : 60;
    const w90 = csvMode ? 730 : 90;
    const w120 = csvMode ? 730 : 120;
    const w180 = csvMode ? 730 : 180;`
);

// Replace Date.now() lookbacks
content = content.replace(/90 \* 24 \* 60 \* 60 \* 1000/g, 'w90 * 24 * 60 * 60 * 1000');
content = content.replace(/120 \* 24 \* 60 \* 60 \* 1000/g, 'w120 * 24 * 60 * 60 * 1000');

// Replace { lookbackDays: X } patterns
content = content.replace(/\{ lookbackDays: 60 \}/g, '{ lookbackDays: w60 }');
content = content.replace(/\{ lookbackDays: 90 \}/g, '{ lookbackDays: w90 }');
content = content.replace(/\{ lookbackDays: 180 \}/g, '{ lookbackDays: w180 }');

fs.writeFileSync(filePath, content, 'utf-8');
console.log("Global replacements applied successfully!");
