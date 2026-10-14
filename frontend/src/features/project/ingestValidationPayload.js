// Builds the synthetic ingest payload used by the Project Data validation
// panel: the first batch and up to three of its existing parts.
export function buildIngestValidationPayload(batchData, partData) {
  const batches = Array.isArray(batchData) ? batchData : [];
  const parts = Array.isArray(partData) ? partData : [];
  return {
    batches: batches.slice(0, 1).map((batch) => ({
      name: batch.name,
      description: `Validation run for ${batch.name}`,
      parts: parts
        .filter((part) => part.batch_id === batch.id)
        .slice(0, 3)
        .map((part) => ({
          serial_number: part.serial_number,
          display_name: part.display_name,
          review_state: part.review_state || 'unreviewed',
          metadata: {
            source: 'project-data-ingest-validation',
            existing_part_id: part.id,
          },
        })),
    })),
  };
}
