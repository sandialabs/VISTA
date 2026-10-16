import { buildIngestValidationPayload } from '../ingestValidationPayload';
import { resolveProjectCollectionReadiness } from '../projectDataUtils';

describe('buildIngestValidationPayload', () => {
  test('uses the first batch and at most three of its parts', () => {
    const parts = [1, 2, 3, 4].map((n) => ({ id: `p${n}`, batch_id: 'b1', serial_number: `S${n}`, display_name: `P${n}` }));
    parts.push({ id: 'other', batch_id: 'b2', serial_number: 'X', review_state: 'pass' });
    const payload = buildIngestValidationPayload([{ id: 'b1', name: 'B1' }, { id: 'b2', name: 'B2' }], parts);
    expect(payload.batches).toHaveLength(1);
    expect(payload.batches[0].description).toBe('Validation run for B1');
    expect(payload.batches[0].parts.map((part) => part.serial_number)).toEqual(['S1', 'S2', 'S3']);
    expect(payload.batches[0].parts[0]).toEqual({
      serial_number: 'S1',
      display_name: 'P1',
      review_state: 'unreviewed',
      metadata: { source: 'project-data-ingest-validation', existing_part_id: 'p1' },
    });
  });

  test('tolerates non-array responses', () => {
    expect(buildIngestValidationPayload(null, undefined)).toEqual({ batches: [] });
  });
});

describe('resolveProjectCollectionReadiness', () => {
  const ready = { loaded: true, loading: false, stale: false, error: null };

  test('requires loaded, settled, fresh collections to be ready', () => {
    expect(resolveProjectCollectionReadiness(ready, ready)).toMatchObject({
      projectPartsReady: true,
      projectImagesReady: true,
      completeProjectCollectionsReady: true,
      completeProjectCollectionsAvailable: true,
      completeProjectCollectionsError: null,
    });
  });

  test('keeps loaded collections available while a refresh is stale or failed', () => {
    const refreshing = { ...ready, stale: true, loading: true };
    const result = resolveProjectCollectionReadiness(refreshing, { ...ready, error: 'boom' });
    expect(result.projectPartsReady).toBe(false);
    expect(result.projectPartsAvailable).toBe(true);
    expect(result.completeProjectCollectionsReady).toBe(false);
    expect(result.completeProjectCollectionsAvailable).toBe(false);
    expect(result.completeProjectCollectionsError).toBe('boom');
  });
});
