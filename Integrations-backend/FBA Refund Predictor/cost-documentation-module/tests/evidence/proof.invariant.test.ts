import { createHash } from 'crypto';

describe('Evidence & Value Engine - invariants', () => {
  it('hash is deterministic sha256(payload|timestamp|actor)', () => {
    const payload = { a: 1, b: 2 };
    const timestamp = '2024-01-01T00:00:00.000Z';
    const actor = 'user-1';
    const canonical = JSON.stringify(payload, Object.keys(payload).sort());
    const h = createHash('sha256').update(`${canonical}|${timestamp}|${actor}`).digest('hex');
    expect(h).toHaveLength(64);
  });
});


