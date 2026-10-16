// Serializes the project data operations (local upload, S3 list/import,
// metadata load, test data load) so only one can run per project at a time,
// and lets in-flight operations detect project changes or being superseded.
import { useCallback, useRef, useState } from 'react';

export function useDataOperationGuard(projectId) {
  const [activeDataOperation, setActiveDataOperation] = useState(null);
  const dataOperationRef = useRef(null);
  const activeProjectIdRef = useRef(projectId);
  activeProjectIdRef.current = projectId;
  const uploadAbortControllerRef = useRef(null);
  const s3AbortControllerRef = useRef(null);

  const acquireDataOperation = useCallback((kind, { s3 = false } = {}) => {
    if (dataOperationRef.current) return null;
    const token = {
      kind,
      projectId,
      controller: new AbortController(),
    };
    dataOperationRef.current = token;
    if (s3) s3AbortControllerRef.current = token.controller;
    setActiveDataOperation(kind);
    return token;
  }, [projectId]);

  const ownsDataOperation = useCallback((token) => (
    Boolean(token)
    && dataOperationRef.current === token
    && activeProjectIdRef.current === token.projectId
  ), []);

  const isDataOperationCurrent = useCallback((token) => (
    ownsDataOperation(token) && !token.controller.signal.aborted
  ), [ownsDataOperation]);

  const releaseDataOperation = useCallback((token) => {
    if (dataOperationRef.current !== token) return;
    dataOperationRef.current = null;
    if (uploadAbortControllerRef.current === token.controller) uploadAbortControllerRef.current = null;
    if (s3AbortControllerRef.current === token.controller) s3AbortControllerRef.current = null;
    setActiveDataOperation(null);
  }, []);

  const resetDataOperation = useCallback(() => {
    setActiveDataOperation(null);
    uploadAbortControllerRef.current = null;
    s3AbortControllerRef.current = null;
  }, []);

  const abortCurrentDataOperation = useCallback(() => {
    const operation = dataOperationRef.current;
    if (operation?.projectId === projectId) {
      operation.controller.abort();
      dataOperationRef.current = null;
    }
    uploadAbortControllerRef.current?.abort();
    s3AbortControllerRef.current?.abort();
  }, [projectId]);

  return {
    activeDataOperation,
    acquireDataOperation,
    ownsDataOperation,
    isDataOperationCurrent,
    releaseDataOperation,
    resetDataOperation,
    abortCurrentDataOperation,
    uploadAbortControllerRef,
  };
}
