// @ts-nocheck
import { describe, expect, it } from '@jest/globals';
import { performHealthCheck } from '../../src/utils/monitoring';

describe('detailed health memory telemetry', () => {
  it('reports process and constrained-memory facts without treating V8 heap allocation as the memory limit', async () => {
    const result = await performHealthCheck();
    const memory = result.checks.memory;

    expect(memory).toBeDefined();
    expect(memory.message).toMatch(/memory/i);
    expect(memory.details).toMatchObject({
      source: expect.stringMatching(/^(cgroup|process_rss)$/),
      usedBytes: expect.any(Number),
      rssBytes: expect.any(Number),
      heapUsedBytes: expect.any(Number),
      heapTotalBytes: expect.any(Number),
      externalBytes: expect.any(Number),
    });
    expect(memory.details.usedBytes).toBeGreaterThanOrEqual(0);
    expect(memory.details.rssBytes).toBeGreaterThan(0);

    if (memory.details.limitBytes !== null) {
      expect(memory.details.limitBytes).toBeGreaterThan(0);
      expect(memory.details.utilizationPercent).toEqual(expect.any(Number));
    } else {
      expect(memory.details.utilizationPercent).toBeNull();
      expect(memory.status).toBe('warn');
    }
  });
});
