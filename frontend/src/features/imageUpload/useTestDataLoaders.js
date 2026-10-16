// Project test-data loaders (standard fixture plus the optional NIST CoCr
// volume). Owns the loading/result state together with the submit handlers
// that drive it.
import { useCallback, useState } from 'react';
import { loadProjectTestData } from '../../api/projects';
import { rethrowPlainApiErrorDetail } from './errorFormatting';

export function useTestDataLoaders({
  projectId,
  projectType,
  onUploadComplete,
  setError,
  acquireDataOperation,
  ownsDataOperation,
  isDataOperationCurrent,
  releaseDataOperation,
}) {
  const [loadingTestData, setLoadingTestData] = useState(false);
  const [loadingNistTestData, setLoadingNistTestData] = useState(false);
  const [testDataResult, setTestDataResult] = useState(null);
  const [nistTestDataResult, setNistTestDataResult] = useState(null);

  const resetTestDataState = useCallback(() => {
    setLoadingTestData(false);
    setLoadingNistTestData(false);
    setTestDataResult(null);
    setNistTestDataResult(null);
  }, []);

  const handleLoadTestData = useCallback(async () => {
    const operation = acquireDataOperation('test_data');
    if (!operation) return;
    setLoadingTestData(true);
    setTestDataResult(null);
    try {
      const payload = await loadProjectTestData(projectId, {}, {
        signal: operation.controller.signal,
      }).catch(rethrowPlainApiErrorDetail);
      if (!isDataOperationCurrent(operation)) return;
      setTestDataResult(payload);
      setError(null);
      if (onUploadComplete) {
        await onUploadComplete(payload, {
          source: 'test_data',
          total: Number(payload?.images_created) || 0,
          confirmedSucceeded: Number(payload?.images_created) || 0,
          confirmedFailed: 0,
          completionUnknown: 0,
          notStarted: 0,
          cancelled: false,
          partsMayHaveChanged: true,
          requiresAuthoritativeReconciliation: false,
          payload,
        });
        if (!isDataOperationCurrent(operation)) return;
      }
    } catch (err) {
      if (!isDataOperationCurrent(operation) || err?.name === 'AbortError') return;
      const detail = err?.message ? ` ${err.message}` : '';
      setError(`Failed to load ${projectType || 'project'} test data.${detail}`);
    } finally {
      if (ownsDataOperation(operation)) setLoadingTestData(false);
      releaseDataOperation(operation);
    }
  }, [
    acquireDataOperation,
    isDataOperationCurrent,
    onUploadComplete,
    ownsDataOperation,
    projectId,
    projectType,
    releaseDataOperation,
    setError,
  ]);

  const handleLoadNistTestData = useCallback(async () => {
    const operation = acquireDataOperation('nist_test_data');
    if (!operation) return;
    setLoadingNistTestData(true);
    setNistTestDataResult(null);
    try {
      const payload = await loadProjectTestData(projectId, { fixture: 'nist-cocr' }, {
        signal: operation.controller.signal,
      }).catch(rethrowPlainApiErrorDetail);
      if (!isDataOperationCurrent(operation)) return;
      setNistTestDataResult(payload);
      setError(null);
      if (onUploadComplete) {
        await onUploadComplete(payload, {
          source: 'test_data',
          fixture: 'nist-cocr',
          total: Number(payload?.images_created) || 0,
          confirmedSucceeded: Number(payload?.images_created) || 0,
          confirmedFailed: 0,
          completionUnknown: 0,
          notStarted: 0,
          cancelled: false,
          partsMayHaveChanged: true,
          requiresAuthoritativeReconciliation: true,
          payload,
        });
        if (!isDataOperationCurrent(operation)) return;
      }
    } catch (err) {
      if (!isDataOperationCurrent(operation) || err?.name === 'AbortError') return;
      const detail = err?.message ? ` ${err.message}` : '';
      setError(`Failed to load NIST CoCr volume.${detail}`);
    } finally {
      if (ownsDataOperation(operation)) setLoadingNistTestData(false);
      releaseDataOperation(operation);
    }
  }, [
    acquireDataOperation,
    isDataOperationCurrent,
    onUploadComplete,
    ownsDataOperation,
    projectId,
    releaseDataOperation,
    setError,
  ]);

  return {
    loadingTestData,
    loadingNistTestData,
    testDataResult,
    nistTestDataResult,
    resetTestDataState,
    handleLoadTestData,
    handleLoadNistTestData,
  };
}
