// Manual metadata JSON textarea. Owns the raw text state together with the
// parse routine shared by the local upload and S3 import submit handlers.
import { useCallback, useState } from 'react';

export function useManualMetadataInput({ setError }) {
  const [uploadMetadata, setUploadMetadata] = useState('');

  const parseManualMetadata = useCallback(() => {
    if (!uploadMetadata.trim()) return null;
    try {
      return JSON.parse(uploadMetadata);
    } catch (err) {
      setError('Invalid JSON format for metadata.');
      return undefined;
    }
  }, [setError, uploadMetadata]);

  return {
    uploadMetadata,
    setUploadMetadata,
    parseManualMetadata,
  };
}
