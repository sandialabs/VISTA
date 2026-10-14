import { useCallback, useEffect, useMemo, useState } from 'react';
import { fallbackOnHttpError } from '../../api/client';
import {
  fetchAnalyzeInputSource,
  fetchAnalyzeToolbox,
  runAnalyzeWorkflowResponse,
  startAnalyzeWorkflowResponse,
} from '../../api/analyses';
import { fetchProjectMetadata, updateProjectMetadata } from '../../api/projects';
import { workflowHasRemoteFastapi } from './runDiagnostics';
import useAnalyzeRunPolling from './useAnalyzeRunPolling';
import { makeDefaultNodes } from './workflowGraph';
import { parseWorkflowResponse, shortResponseExcerpt, workflowRequestError } from './workflowResponse';
import {
  ANALYZE_WORKFLOW_METADATA_KEY,
  buildWorkflow,
  imageIdFor,
  restoreSavedWorkflow,
  workflowMetadataValue,
} from './workflowSerialization';
import { imageIdsForPart, sanitizeAnalyzeInputSource } from './inputSelectionHelpers';

function useProcessImageSelection(inputSource, setExampleImageId) {
  const [processImageIds, setProcessImageIds] = useState([]);

  const moveImagesToProcess = useCallback((imageIds) => {
    const ids = imageIds.filter(Boolean).map(String);
    if (ids.length === 0) return;
    setProcessImageIds((prevIds) => [...new Set([...prevIds.map(String), ...ids])]);
    setExampleImageId((prevExample) => prevExample || ids[0] || '');
  }, [setExampleImageId]);

  const removeImagesFromProcess = useCallback((imageIds) => {
    const removeSet = new Set(imageIds.filter(Boolean).map(String));
    setProcessImageIds((prevIds) => {
      const nextIds = prevIds.filter((id) => !removeSet.has(String(id)));
      setExampleImageId((prevExample) => (
        prevExample && !removeSet.has(String(prevExample)) ? prevExample : nextIds[0] || ''
      ));
      return nextIds;
    });
  }, [setExampleImageId]);

  const movePartToProcess = useCallback((partId) => {
    moveImagesToProcess(imageIdsForPart(inputSource, partId));
  }, [inputSource, moveImagesToProcess]);

  const removePartFromProcess = useCallback((partId) => {
    removeImagesFromProcess(imageIdsForPart(inputSource, partId));
  }, [inputSource, removeImagesFromProcess]);

  return {
    processImageIds,
    setProcessImageIds,
    moveImagesToProcess,
    removeImagesFromProcess,
    movePartToProcess,
    removePartFromProcess,
  };
}

// Owns Analyze workflow editor state: loading and persisting the saved workflow,
// the process/example image selection, and submitting workflow runs.
export default function useAnalyzeWorkflowEditor({ projectId, setError, nodes, restoreGraph }) {
  const [methods, setMethods] = useState([]);
  const [inputSource, setInputSource] = useState(null);
  const [workflowStateLoaded, setWorkflowStateLoaded] = useState(false);
  const [status, setStatus] = useState({ loading: true, message: 'Loading analyze workspace...', result: null });
  const [dragPayload, setDragPayload] = useState(null);
  const [exampleImageId, setExampleImageId] = useState('');
  const {
    processImageIds,
    setProcessImageIds,
    moveImagesToProcess,
    removeImagesFromProcess,
    movePartToProcess,
    removePartFromProcess,
  } = useProcessImageSelection(inputSource, setExampleImageId);
  const { activeRunRef, pollAnalyzeRun, stopWorkflow } = useAnalyzeRunPolling(projectId, setStatus);

  const methodById = useMemo(() => new Map(methods.map((method) => [method.id, method])), [methods]);
  const loadedImages = useMemo(() => inputSource?.images || [], [inputSource]);
  const processImageSet = useMemo(() => new Set(processImageIds.map(String)), [processImageIds]);
  const stagedImages = useMemo(
    () => loadedImages.filter((image) => processImageSet.has(String(imageIdFor(image)))),
    [loadedImages, processImageSet]
  );
  const availableImages = useMemo(
    () => loadedImages.filter((image) => !processImageSet.has(String(imageIdFor(image)))),
    [loadedImages, processImageSet]
  );

  useEffect(() => {
    let cancelled = false;
    async function loadAnalyzeWorkspace() {
      try {
        setStatus({ loading: true, message: 'Loading analyze workspace...', result: null });
        setWorkflowStateLoaded(false);
        const [toolboxPayload, inputPayload, savedWorkflowPayload] = await Promise.all([
          fetchAnalyzeToolbox({ errorLabel: 'Failed to load toolbox' }),
          fetchAnalyzeInputSource(projectId, { errorLabel: 'Failed to load analyze inputs' }),
          fallbackOnHttpError(fetchProjectMetadata(projectId, ANALYZE_WORKFLOW_METADATA_KEY), null),
        ]);
        if (cancelled) return;
        const loadedMethods = Array.isArray(toolboxPayload.methods) ? toolboxPayload.methods : [];
        const safeInputPayload = sanitizeAnalyzeInputSource(inputPayload);
        const defaultNodes = makeDefaultNodes(loadedMethods);
        const restored = restoreSavedWorkflow(savedWorkflowPayload?.value, loadedMethods, defaultNodes, safeInputPayload);
        setMethods(loadedMethods);
        setInputSource(safeInputPayload);
        restoreGraph(restored.nodes);
        setProcessImageIds(restored.processImageIds);
        setExampleImageId(restored.exampleImageId);
        setWorkflowStateLoaded(true);
        setStatus({
          loading: false,
          message: `${loadedMethods.length} methods ready for ${safeInputPayload?.source?.image_count || 0} images`,
          result: null,
        });
      } catch (err) {
        const message = err.message || 'Failed to load analyze workspace';
        if (!cancelled) {
          setStatus({ loading: false, message, result: null });
          setWorkflowStateLoaded(true);
          if (setError) setError(message);
        }
      }
    }
    loadAnalyzeWorkspace();
    return () => {
      cancelled = true;
    };
  }, [projectId, restoreGraph, setError, setExampleImageId, setProcessImageIds]);

  useEffect(() => {
    if (!workflowStateLoaded || status.loading || nodes.length === 0) return undefined;
    const saveHandle = setTimeout(async () => {
      try {
        await updateProjectMetadata(
          projectId,
          ANALYZE_WORKFLOW_METADATA_KEY,
          workflowMetadataValue({ nodes, processImageIds, exampleImageId }),
        );
      } catch (_err) {
        // Analyze workflow persistence is best-effort; users can keep editing if the save fails.
      }
    }, 350);
    return () => clearTimeout(saveHandle);
  }, [exampleImageId, nodes, processImageIds, projectId, status.loading, workflowStateLoaded]);

  const handleDragStart = useCallback((payload) => {
    setDragPayload(payload);
  }, []);

  const handleDrop = useCallback((target) => {
    if (!dragPayload) return;
    const ids = dragPayload.type === 'part'
      ? imageIdsForPart(inputSource, dragPayload.id)
      : [dragPayload.id];
    if (target === 'process') {
      moveImagesToProcess(ids);
    } else {
      removeImagesFromProcess(ids);
    }
    setDragPayload(null);
  }, [dragPayload, inputSource, moveImagesToProcess, removeImagesFromProcess]);

  const clearStatus = useCallback(() => {
    setStatus({ loading: false, message: '', result: null });
  }, []);

  const submitWorkflow = useCallback(async (mode, runScope = 'all') => {
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const controller = new AbortController();
    activeRunRef.current = { runId, controller };
    try {
      const selectedIds = processImageIds.length > 0 ? processImageIds : loadedImages.map(imageIdFor).filter(Boolean);
      const runLabel = runScope === 'example' ? 'example image' : `${selectedIds.length || 0} configured images`;
      setStatus({ loading: true, message: mode === 'execute' ? `Running ${runLabel}...` : 'Validating workflow...', result: null });
      const workflow = buildWorkflow({
        nodes,
        inputSource,
        selectedImageIds: selectedIds,
        exampleImageId,
        runScope,
        methodById,
      });
      const useBackgroundRun = mode === 'execute' && workflowHasRemoteFastapi(workflow.nodes);
      const resp = useBackgroundRun
        ? await startAnalyzeWorkflowResponse(projectId, workflow, runId, { signal: controller.signal })
        : await runAnalyzeWorkflowResponse(projectId, mode, workflow, runId, { signal: controller.signal });
      const { payload, text } = await parseWorkflowResponse(resp);
      if (!resp.ok) throw new Error(workflowRequestError(mode, resp, payload, text));
      if (!payload) throw new Error(`Workflow ${mode} returned invalid JSON: ${shortResponseExcerpt(text) || 'empty response'}`);
      if (useBackgroundRun) {
        setStatus({ loading: true, message: `VISTA received ${runLabel}. Remote processing...`, result: null });
        await pollAnalyzeRun(payload.run_id, controller);
        return;
      }
      setStatus({
        loading: false,
        message: mode === 'execute'
          ? `Workflow execution ${payload.status || 'completed'} for ${runScope === 'example' ? 'the example image' : 'the configured image set'}.`
          : 'Workflow contract validated',
        result: payload,
      });
    } catch (err) {
      if (err?.name === 'AbortError') {
        setStatus((previous) => (previous.message === 'Stopping Analyze run...'
          ? previous
          : { loading: false, message: 'Analyze run stopped.', result: null }));
        return;
      }
      const message = err.message || 'Workflow request failed';
      setStatus({ loading: false, message, result: null });
      if (setError) setError(message);
    } finally {
      if (activeRunRef.current?.runId === runId) activeRunRef.current = null;
    }
  }, [activeRunRef, exampleImageId, inputSource, loadedImages, methodById, nodes, pollAnalyzeRun, processImageIds, projectId, setError]);

  return {
    methods,
    methodById,
    inputSource,
    workflowStateLoaded,
    status,
    setStatus,
    clearStatus,
    processImageIds,
    exampleImageId,
    setExampleImageId,
    loadedImages,
    processImageSet,
    stagedImages,
    availableImages,
    dragPayload,
    handleDragStart,
    handleDrop,
    moveImagesToProcess,
    removeImagesFromProcess,
    movePartToProcess,
    removePartFromProcess,
    submitWorkflow,
    stopWorkflow,
  };
}
