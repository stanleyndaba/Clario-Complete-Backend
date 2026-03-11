/**
 * Script to patch all detection algorithm store functions to include tenant_id.
 * 
 * This script:
 * 1. Finds all algorithm files with store*Results functions
 * 2. Adds the resolveTenantId import if missing
 * 3. Adds tenant_id resolution and injection into the store function
 * 
 * Run with: npx ts-node scripts/patch-tenant-id.ts
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ALGORITHMS_DIR = join(__dirname, '..', 'src', 'services', 'detection', 'algorithms');

// The import line to add
const IMPORT_LINE = `import { resolveTenantId } from './shared/tenantUtils';`;

// Find all algorithm files
const files = readdirSync(ALGORITHMS_DIR).filter(f => f.endsWith('.ts') && f !== 'index.ts');

let patchedCount = 0;
let skippedCount = 0;

for (const file of files) {
    const filePath = join(ALGORITHMS_DIR, file);
    let content = readFileSync(filePath, 'utf-8');

    // Skip if already has tenant_id handling
    if (content.includes('resolveTenantId')) {
        console.log(`  ⏭ ${file} - already patched`);
        skippedCount++;
        continue;
    }

    // Skip files without store functions
    if (!content.includes("from('detection_results')")) {
        console.log(`  ⏭ ${file} - no detection_results insert found`);
        skippedCount++;
        continue;
    }

    let modified = false;

    // 1. Add the import
    if (!content.includes('resolveTenantId')) {
        // Find the last import line and add after it
        const importRegex = /^import .+;?\s*$/gm;
        let lastImportMatch: RegExpExecArray | null = null;
        let match: RegExpExecArray | null;
        while ((match = importRegex.exec(content)) !== null) {
            lastImportMatch = match;
        }

        if (lastImportMatch) {
            const insertPos = lastImportMatch.index + lastImportMatch[0].length;
            content = content.substring(0, insertPos) + '\n' + IMPORT_LINE + content.substring(insertPos);
            modified = true;
        }
    }

    // 2. Find the store function and add tenant_id resolution
    // Pattern: "export async function store...(results: ...): Promise<void> {"
    // We need to add tenant_id resolution at the start and include it in records
    
    // Find the body of the store function - look for the pattern where records are mapped
    // and add tenant_id to the mapped object
    
    // Strategy: Find `status: 'open',` in the records mapping and add `tenant_id: tenantId,` before it
    const statusOpenRegex = /(\s+)status: 'open',/g;
    if (statusOpenRegex.test(content)) {
        content = content.replace(
            /(\s+)status: 'open',/g,
            '$1tenant_id: tenantId,\n$1status: \'open\','
        );
        modified = true;
    }

    // 3. Add the tenant_id resolution call after "if (results.length === 0) return;"
    const earlyReturnRegex = /if \(results\.length === 0\) return;\s*\n\s*try \{/g;
    if (earlyReturnRegex.test(content)) {
        content = content.replace(
            /if \(results\.length === 0\) return;\s*\n(\s*)try \{/g,
            `if (results.length === 0) return;\n\n$1// Resolve tenant_id for multi-tenancy\n$1const tenantId = await resolveTenantId(results[0].seller_id);\n\n$1try {`
        );
        modified = true;
    }

    if (modified) {
        writeFileSync(filePath, content, 'utf-8');
        console.log(`  ✅ ${file} - patched`);
        patchedCount++;
    } else {
        console.log(`  ⚠️ ${file} - could not patch (manual review needed)`);
    }
}

console.log(`\n✅ Done! Patched ${patchedCount} files, skipped ${skippedCount} files.`);
