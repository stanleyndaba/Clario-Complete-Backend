import { describe, expect, test } from '@jest/globals';
import { detectCSVType } from '../../src/services/csvIngestionService';

describe('manual-audit Amazon report-family detection', () => {
  test.each([
    ['SettlementId,TransactionType,Amount', 'settlements'],
    ['settlement-id,total-amount,currency', 'settlements'],
    ['settlement-id,transaction-type,amount', 'settlements'],
    ['amazon-order-id,posted-date,transaction-type,amount', 'financial_events'],
    ['event-type,posted-date,amount,description', 'financial_events'],
    ['AdjustmentDate,FNSKU,ASIN,MSKU', 'inventory'],
  ])('recognizes %s as %s', (headerLine, expected) => {
    expect(detectCSVType(headerLine.split(','), 'amazon-report.csv')).toBe(expected);
  });

  test('does not use a filename to classify an unknown schema', () => {
    expect(detectCSVType(['foo', 'bar'], 'settlements.csv')).toBe('unknown');
  });

  test('fails closed when a schema matches multiple families', () => {
    expect(() => detectCSVType(
      ['EventType', 'PostedDate', 'Amount', 'Description', 'FeeType', 'FeeAmount'],
      'ambiguous.csv',
    )).toThrow(/Ambiguous CSV type/);
  });
});

