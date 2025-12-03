# Test Failure Analysis and Fix Plan

## Executive Summary

10 backend tests are failing with 500 "Internal authentication error" when testing HMAC authentication for ML pipeline endpoints. Root cause is a parameter name mismatch in the HMAC verification function call, combined with incorrect monkeypatch targets in tests.

## Test Failure Summary

**Failing Tests**: 10 out of 145 backend tests
**Error Pattern**: All failures return 500 status code with "Internal authentication error"
**Affected Files**:
- `backend/tests/test_ml_hmac_security.py` (7 tests)
- `backend/tests/test_multi_prefix_auth.py` (3 tests)

## Root Causes

### 1. Parameter Name Mismatch (PRIMARY ISSUE)

**Location**: `backend/utils/dependencies.py:458`

**Problem**: The function call uses `max_skew_seconds=` but the function signature expects `skew_seconds=`

**Current Code** (lines 454-459):
```python
if not verify_hmac_signature_flexible(
    settings.ML_CALLBACK_HMAC_SECRET,
    body_bytes,
    timestamp,
    signature,
    max_skew_seconds=settings.ML_HMAC_TIMESTAMP_SKEW_SECONDS,  # WRONG
):
```

**Function Signature** (line 270):
```python
def verify_hmac_signature_flexible(
    secret: str,
    body: bytes,
    timestamp: str,
    signature_header: str,
    skew_seconds: int = 300  # Expects 'skew_seconds', not 'max_skew_seconds'
) -> bool:
```

**Result**:
- `TypeError` is thrown due to unexpected keyword argument
- Exception is caught by middleware's broad exception handler at `middleware/auth.py:154-158`
- Returns 500 "Internal authentication error" to client

### 2. Incorrect Monkeypatch Target (SECONDARY ISSUE)

**Location**: Multiple test files

**Problem**: Tests patch `routers.ml_analyses.settings.ML_CALLBACK_HMAC_SECRET` but `require_hmac_auth` in `utils/dependencies.py` imports from `core.config.settings`

**Current Test Pattern**:
```python
monkeypatch.setattr('routers.ml_analyses.settings.ML_CALLBACK_HMAC_SECRET', secret)
```

**Actual Import in dependencies.py**:
```python
from core.config import settings
```

**Result**:
- Even if parameter issue is fixed, HMAC verification uses wrong secret
- Tests use 'test_secret_123' but verification sees 'test-hmac-secret-12345' from conftest.py
- Signatures don't match, causing authentication failures

## Detailed Fix Plan

### Fix 1: Parameter Name in dependencies.py

**File**: `backend/utils/dependencies.py`
**Line**: 458

**Change**:
```diff
  if not verify_hmac_signature_flexible(
      settings.ML_CALLBACK_HMAC_SECRET,
      body_bytes,
      timestamp,
      signature,
-     max_skew_seconds=settings.ML_HMAC_TIMESTAMP_SKEW_SECONDS,
+     skew_seconds=settings.ML_HMAC_TIMESTAMP_SKEW_SECONDS,
  ):
```

**Rationale**: Match the parameter name in the function signature at line 270.

### Fix 2: Update Monkeypatch Targets in Tests

**Files to Update**:
- `backend/tests/test_ml_hmac_security.py`
- `backend/tests/test_multi_prefix_auth.py`

**Pattern to Replace**:
```diff
- monkeypatch.setattr('routers.ml_analyses.settings.ML_CALLBACK_HMAC_SECRET', secret)
+ monkeypatch.setattr('utils.dependencies.settings.ML_CALLBACK_HMAC_SECRET', secret)

- monkeypatch.setattr('routers.ml_analyses.settings.ML_PIPELINE_REQUIRE_HMAC', True)
+ monkeypatch.setattr('utils.dependencies.settings.ML_PIPELINE_REQUIRE_HMAC', True)
```

**Rationale**: Patch the settings object where it's actually used (in `utils/dependencies.py`), not in a different module.

**Affected Test Functions**:

In `test_ml_hmac_security.py`:
1. `test_dual_auth_valid_api_key_and_hmac_accepted`
2. `test_invalid_hmac_signature_rejected`
3. `test_missing_hmac_headers_rejected`
4. `test_timestamp_replay_protection_old_timestamp`
5. `test_timestamp_skew_tolerance`
6. `test_hmac_on_presign_endpoint`
7. `test_hmac_on_finalize_endpoint`
8. `test_hmac_disabled_allows_requests`
9. `test_dual_auth_requires_both_api_key_and_hmac`

In `test_multi_prefix_auth.py`:
1. `test_api_ml_prefix_requires_both_api_key_and_hmac`
2. `test_api_ml_prefix_accepts_valid_api_key_and_hmac`
3. `test_api_ml_rejects_expired_timestamp`
4. `test_api_ml_rejects_invalid_hmac_signature`

## Expected Outcomes

### Before Fixes
- **Status**: 10 failed, 135 passed
- **Error**: All failures return 500 "Internal authentication error"

### After Fixes
- **Status**: 0 failed, 145 passed
- **Behavior**:
  - HMAC validation works correctly
  - Tests return expected status codes (200 for valid auth, 401 for invalid)
  - No internal server errors

## Implementation Order

1. **First**: Fix parameter name in `utils/dependencies.py:458` (critical blocker)
2. **Second**: Update monkeypatch targets in `test_ml_hmac_security.py`
3. **Third**: Update monkeypatch targets in `test_multi_prefix_auth.py`
4. **Fourth**: Run tests to verify all pass

## Verification Steps

After implementing fixes:

```bash
./test/run_tests.sh --backend
```

Expected output:
```
======================= 145 passed in ~15s =======================
PASSED
```

Individual test verification:
```bash
source .venv/bin/activate
pytest tests/test_ml_hmac_security.py -v
pytest tests/test_multi_prefix_auth.py -v
```

## Additional Context

### Why This Happened

Recent refactoring in the `more-auth` branch:
- Added `ML_HMAC_TIMESTAMP_SKEW_SECONDS` configuration parameter
- Updated `require_hmac_auth` to use configurable skew window
- Parameter name typo introduced during update
- Tests were written against old endpoint paths (`/api/analyses/...`) and updated to new paths (`/api-ml/analyses/...`) but monkeypatch targets weren't updated

### Related Files Modified

From git status:
```
modified:   core/config.py              (added ML_HMAC_TIMESTAMP_SKEW_SECONDS)
modified:   main.py                     (router refactoring)
modified:   utils/dependencies.py       (require_hmac_auth updates)
modified:   tests/test_ml_hmac_security.py (endpoint path updates)
modified:   tests/test_multi_prefix_auth.py (endpoint path updates)
```

### Security Implications

None. This is a test/implementation bug, not a security vulnerability:
- HMAC authentication logic is sound
- Only affecting test execution, not production behavior
- Once fixed, dual authentication (API key + HMAC) will work as designed

## Frontend Test Status

Frontend tests are **all passing** (59 tests across 5 test suites). The "Overall: FAILED" result from the test runner is solely due to the backend test failures, not any frontend issues.

However, there is a minor issue with the test script that violates code style guidelines:

**Location**: `test/run_tests.sh:8`
**Issue**: `VERBOSE_MODE=true` defaults to verbose output
**Expected**: Should default to `false` for minimal output

According to CLAUDE.md style guidelines:
> test scripts and utilities: minimal output by default, verbose mode optional

This doesn't affect test results but produces excessive console output.
