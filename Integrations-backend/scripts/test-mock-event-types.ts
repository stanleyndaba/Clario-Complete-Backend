/**
 * Test mock data generator produces ALL 64 Amazon event types
 */

// Import the mock data generator
import { createMockDataGenerator } from '../src/services/mockDataGenerator';

// Create generator with enough records for 64+ adjustments (recordCount * 0.4 for with_issues)
// Need 64 / 0.4 = 160 records minimum
const generator = createMockDataGenerator('with_issues', 200);

console.log('🧪 Testing Mock Data Generator - ALL 64 Types\n');
console.log('='.repeat(60));

// Generate financial events
const events = generator.generateFinancialEvents();
const adjustments = events.payload.FinancialEvents.AdjustmentEventList;

// Count by adjustment type
const typeCounts: Record<string, number> = {};
for (const adj of adjustments) {
    const type = adj.AdjustmentType;
    typeCounts[type] = (typeCounts[type] || 0) + 1;
}

// Sort by count
const sorted = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);

console.log(`\n📊 Generated ${adjustments.length} adjustment events:\n`);
for (const [type, count] of sorted) {
    console.log(`   ${count > 1 ? '✅' : '✓ '} ${type}: ${count}`);
}

// Check unique types
const uniqueTypes = Object.keys(typeCounts);
console.log(`\n🔢 Unique event types generated: ${uniqueTypes.length}`);

// All 64 expected types
const allExpectedTypes = generator.getAllAdjustmentTypes();
console.log(`📋 Expected types: ${allExpectedTypes.length}`);

// Find missing types
const missingTypes = allExpectedTypes.filter(t => !typeCounts[t]);
if (missingTypes.length > 0) {
    console.log(`\n⚠️ Missing types (${missingTypes.length}):`);
    for (const t of missingTypes) {
        console.log(`   ❌ ${t}`);
    }
} else {
    console.log(`\n🎉 ALL ${allExpectedTypes.length} TYPES GENERATED! Full coverage achieved!`);
}

// Summary
const coverage = ((uniqueTypes.length / allExpectedTypes.length) * 100).toFixed(1);
console.log(`\n📈 Coverage: ${coverage}% (${uniqueTypes.length}/${allExpectedTypes.length})`);
