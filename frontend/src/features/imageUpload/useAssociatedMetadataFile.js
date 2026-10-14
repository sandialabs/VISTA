// Associated-metadata-file picker, parsing, and project-wide save. Owns the
// file/parse/save state together with the file-change handler, the parse
// routine shared with drag-and-drop file selection, the bundle save used by
// both the local upload and S3 import handlers, and the standalone
// "Load Metadata" submit handler.
import { useCallback, useRef, useState } from 'react';
import {
  buildAssociatedMetadataBundle,
  buildAssociatedMetadataImageReference,
  isAssociatedMetadataFile,
  parseAssociatedMetadataText,
  readAssociatedMetadataFileText,
} from '../../utils/associatedMetadataFile';
import { setProjectMetadata } from '../../api/projects';
import { rethrowPlainApiErrorDetail } from './errorFormatting';

export function useAssociatedMetadataFile({
  projectId,
  nsiproParserId,
  projectConfiguration,
  onProjectMetadataLoaded,
  acquireDataOperation,
  isDataOperationCurrent,
  releaseDataOperation,
  setError,
}) {
  const [associatedMetadataFile, setAssociatedMetadataFile] = useState(null);
  const [associatedMetadataBundle, setAssociatedMetadataBundle] = useState(null);
  const [associatedMetadataParsing, setAssociatedMetadataParsing] = useState(false);
  const [associatedMetadataSaving, setAssociatedMetadataSaving] = useState(false);
  const [associatedMetadataSaved, setAssociatedMetadataSaved] = useState(null);
  const [associatedMetadataError, setAssociatedMetadataError] = useState(null);
  const associatedMetadataParseGenerationRef = useRef(0);

  const resetAssociatedMetadataState = useCallback(() => {
    setAssociatedMetadataSaving(false);
    setAssociatedMetadataParsing(false);
    setAssociatedMetadataFile(null);
    setAssociatedMetadataBundle(null);
    setAssociatedMetadataSaved(null);
    setAssociatedMetadataError(null);
    associatedMetadataParseGenerationRef.current += 1;
  }, []);

  const applyAssociatedMetadataFile = useCallback(async (file) => {
    const requestProjectId = projectId;
    const parseGeneration = associatedMetadataParseGenerationRef.current + 1;
    associatedMetadataParseGenerationRef.current = parseGeneration;
    const isCurrentParse = () => (
      projectId === requestProjectId
      && associatedMetadataParseGenerationRef.current === parseGeneration
    );
    setAssociatedMetadataFile(file || null);
    setAssociatedMetadataBundle(null);
    setAssociatedMetadataError(null);
    setAssociatedMetadataSaved(null);
    if (!file) return;

    if (!isAssociatedMetadataFile(file)) {
      setAssociatedMetadataError('Unsupported metadata file type. Choose a .json or .nsipro file.');
      return;
    }

    setAssociatedMetadataParsing(true);
    try {
      const text = await readAssociatedMetadataFileText(file);
      if (!isCurrentParse()) return;
      const parsedResult = parseAssociatedMetadataText(text, file.name, {
        parserId: nsiproParserId,
        projectConfiguration,
        failClosed: true,
      });
      setAssociatedMetadataBundle(buildAssociatedMetadataBundle(file, text, parsedResult));
    } catch (err) {
      if (!isCurrentParse()) return;
      setAssociatedMetadataError(err?.message || 'Unable to parse associated metadata file.');
    } finally {
      if (isCurrentParse()) setAssociatedMetadataParsing(false);
    }
  }, [nsiproParserId, projectConfiguration, projectId]);

  const handleAssociatedMetadataFileChange = useCallback(async (e) => {
    await applyAssociatedMetadataFile(e.target.files && e.target.files[0]);
  }, [applyAssociatedMetadataFile]);

  const saveAssociatedMetadataBundle = useCallback(async (signal = undefined) => {
    if (!associatedMetadataFile) return null;
    if (associatedMetadataParsing) {
      throw new Error('Associated metadata file is still being parsed.');
    }
    if (associatedMetadataError || !associatedMetadataBundle) {
      throw new Error(associatedMetadataError || 'Associated metadata file could not be parsed.');
    }

    await setProjectMetadata(projectId, associatedMetadataBundle.key, associatedMetadataBundle.value, {
      signal,
    }).catch(rethrowPlainApiErrorDetail);
    return buildAssociatedMetadataImageReference(associatedMetadataBundle);
  }, [associatedMetadataBundle, associatedMetadataError, associatedMetadataFile, associatedMetadataParsing, projectId]);

  const handleLoadAssociatedMetadata = useCallback(async () => {
    if (!associatedMetadataFile) {
      setAssociatedMetadataError('Choose a metadata file before loading metadata.');
      return;
    }
    const operation = acquireDataOperation('metadata');
    if (!operation) return;
    setAssociatedMetadataSaving(true);
    setAssociatedMetadataSaved(null);
    try {
      const reference = await saveAssociatedMetadataBundle(operation.controller.signal);
      if (!isDataOperationCurrent(operation)) return;
      setAssociatedMetadataSaved(reference);
      setError(null);
      if (onProjectMetadataLoaded) {
        await onProjectMetadataLoaded(reference);
        if (!isDataOperationCurrent(operation)) return;
      }
    } catch (err) {
      if (!isDataOperationCurrent(operation)) return;
      const detail = err?.message ? ` ${err.message}` : '';
      setError(`Unable to load metadata file.${detail}`);
    } finally {
      if (isDataOperationCurrent(operation)) setAssociatedMetadataSaving(false);
      releaseDataOperation(operation);
    }
  }, [
    acquireDataOperation,
    associatedMetadataFile,
    isDataOperationCurrent,
    onProjectMetadataLoaded,
    releaseDataOperation,
    saveAssociatedMetadataBundle,
    setError,
  ]);

  return {
    associatedMetadataFile,
    associatedMetadataBundle,
    associatedMetadataParsing,
    associatedMetadataSaving,
    associatedMetadataSaved,
    associatedMetadataError,
    applyAssociatedMetadataFile,
    handleAssociatedMetadataFileChange,
    saveAssociatedMetadataBundle,
    handleLoadAssociatedMetadata,
    resetAssociatedMetadataState,
  };
}
