# Recipe: replace the default `.nsipro` parser

Use this recipe when a deployment has one custom `.nsipro` format and VISTA should treat that parser as the default everywhere. Do **not** add a new parser ID for this path; keep `parser_id: "default"` and replace the default parser implementation in both frontend and backend.

## What stays the same

- Project configuration can keep the default setting:

  ```json
  {
    "metadata_parsers": {
      "nsipro": {
        "parser_id": "default"
      }
    }
  }
  ```

- Upload and ingest payloads still use these contract fields:
  - `parser`
  - `parser_id`
  - `parser_version`
  - `parser_hash`
  - `source_filename`
  - `metadata`
  - `warnings`
- The frontend still parses `.nsipro` files during associated metadata upload.
- The backend is still authoritative during ingest and normalizes stored `.nsipro` metadata before it is persisted on inspection parts.

## Step 1: replace the frontend default parser

Edit `frontend/src/metadata/nsiproParsers.js`.

Replace the body of `parseDefaultNsiproText` with your custom extraction logic. Keep the return shape produced by `buildNsiproResult`.

Example:

```js
function parseDefaultNsiproText(text, filename = '') {
  const parsed = parseGenericNsiproKeyValueText(text, filename);
  const source = parsed.metadata || {};

  return buildNsiproResult({
    parser: 'nsipro-custom-default',
    parserVersion: GENERIC_NSIPRO_PARSER_VERSION,
    parserHash: NSIPRO_PARSER_HASHES.default,
    sourceFilename: filename,
    warnings: parsed.warnings || [],
    metadata: {
      deployment: {
        deployment_id: source.Deployment?.['Deployment ID'] || '',
        line_id: source.Deployment?.['Line ID'] || '',
      },
      custom_fields: {
        operator_badge: source['Custom Fields']?.['Operator Badge'] || '',
      },
    },
  });
}
```

Guidelines:

- Keep `parser_id` as `default`; `parseNsiproText` assigns it from the registry.
- Keep `parser_version` as `GENERIC_NSIPRO_PARSER_VERSION` unless you intentionally change the contract.
- Keep the extracted `metadata` object small and stable. Do not persist raw file contents or binary payloads.
- Throw a clear error if required fields are missing and the file should not be accepted.

## Step 2: replace the backend default parser

Edit `backend/metadata/nsipro_parsers.py`.

Replace `_parse_default_nsipro_text` with backend logic equivalent to the frontend parser.

Example:

```python
def _parse_default_nsipro_text(text: str) -> tuple[str, dict[str, Any]]:
    source = parse_generic_nsipro_key_value_text(text)

    return "nsipro-custom-default", {
        "deployment": {
            "deployment_id": source.get("Deployment", {}).get("Deployment ID", ""),
            "line_id": source.get("Deployment", {}).get("Line ID", ""),
        },
        "custom_fields": {
            "operator_badge": source.get("Custom Fields", {}).get("Operator Badge", ""),
        },
    }
```

Guidelines:

- Keep the default registry entry as `id="default"`.
- Keep frontend and backend extraction behavior equivalent for the same fixture file.
- If the backend accepts raw `.nsipro` text during ingest, it reparses with this backend default parser.
- If only parsed metadata is stored, ingest uses the stored metadata after parser contract validation.

## Step 3: update the parser hash only if the contract changed

If the extracted metadata shape or parser semantics changed, bump the contract so strict mode can detect old uploads.

1. Choose the new version, for example `1.1.0`.
2. Update `GENERIC_NSIPRO_PARSER_VERSION` in both frontend and backend if the default parser version changes.
3. Generate the default hash from the backend helper:

   ```bash
   python - <<'PY'
   from backend.metadata.nsipro_parsers import stable_parser_hash
   print(stable_parser_hash('default', '1.1.0'))
   PY
   ```

4. Copy that hash into:
   - `GENERIC_NSIPRO_PARSER_HASH` in `backend/metadata/nsipro_parsers.py`
   - `NSIPRO_PARSER_HASHES.default` in `frontend/src/metadata/nsiproParsers.js`
5. Update any strict project configuration that pins `parser_version` or `parser_hash`.

If you are only refactoring code with no output change, keep the existing version and hash.

## Step 4: update tests

At minimum, update these tests:

- `frontend/src/metadata/__tests__/nsiproParsers.test.js`
  - verify the default parser returns the new normalized metadata shape
  - verify `parser_id` remains `default`
  - verify `parser_hash` matches the default hash
- `frontend/src/components/__tests__/ImageUploader.test.js`
  - verify `.nsipro` associated metadata upload still uses the default parser contract
- `backend/tests/test_inspection_workbench_router.py`
  - verify ingest dereferences associated `.nsipro` metadata and persists the new normalized metadata
  - verify strict parser validation still rejects mismatched hashes or versions

## Done checklist

- Frontend and backend produce equivalent metadata for the same `.nsipro` fixture.
- `.nsipro` associated metadata uploads still succeed with `parser_id: "default"`.
- Backend ingest persists the normalized `.nsipro` metadata on inspection parts.
- Strict mode succeeds with the new default parser contract and fails for stale hashes or versions.
- Tests pass after updating expected metadata and hashes.
