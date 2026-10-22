import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectActiveTariff, tariffLabel } from '../../src/lib/station/domain.ts';

const history = [
  { id: 'old', effective_from: '2026-01-01', effective_to: '2026-03-01' },
  { id: 'current', effective_from: '2026-03-01', effective_to: null },
];

test('tariff periods include their start and exclude their end date', () => {
  assert.equal(selectActiveTariff(history, '2026-02-28')?.id, 'old');
  assert.equal(selectActiveTariff(history, '2026-03-01')?.id, 'current');
});

test('tariff selection returns no row when no period covers the date', () => {
  assert.equal(selectActiveTariff(history, '2025-12-31'), null);
});

test('official label requires both a source reference and an approver', () => {
  assert.equal(
    tariffLabel({ effective_from: '2026-01-01', effective_to: null, source_reference: 'DOC-1', approved_by: 'admin-1' }),
    'Official tariff',
  );
  assert.equal(
    tariffLabel({ effective_from: '2026-01-01', effective_to: null, source_reference: 'DOC-1' }),
    'Tariff pending approval',
  );
});