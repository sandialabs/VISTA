import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchImage, fetchProjectImages } from '../../api/images';
import useRouteRequestOwnership, { isAbortError } from '../../utils/useRouteRequestOwnership';

const EMPTY_IMAGE_STATE = { routeInstanceKey: null, value: null };

// Owns the image record, loading, error, and calibration state for the
// current route instance. The image fetch is a route-owned request, so it
// uses useRouteRequestOwnership keyed by the route instance to guarantee a
// stale response from a previous image/project cannot update state.
export default function useImageRecordLoader({
  activeRouteInstanceKeyRef,
  imageId,
  measurementsGlue,
  projectId,
  routeInstanceKey,
}) {
  const [imageState, setImageState] = useState(EMPTY_IMAGE_STATE);
  const image = imageState.routeInstanceKey === routeInstanceKey
    ? imageState.value
    : null;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [calibrationState, setCalibrationState] = useState({
    routeInstanceKey: null,
    value: null,
  });
  const calibration = calibrationState.routeInstanceKey === routeInstanceKey
    ? calibrationState.value
    : null;

  const {
    beginRequest,
    isCurrent,
  } = useRouteRequestOwnership(routeInstanceKey);

  const setRouteLoading = useCallback((nextLoading) => {
    if (activeRouteInstanceKeyRef.current !== routeInstanceKey) return;
    setLoading(nextLoading);
  }, [activeRouteInstanceKeyRef, routeInstanceKey]);

  const setRouteError = useCallback((nextError) => {
    if (activeRouteInstanceKeyRef.current !== routeInstanceKey) return;
    setError(nextError);
  }, [activeRouteInstanceKeyRef, routeInstanceKey]);

  const setRouteCalibration = useCallback((nextCalibrationOrUpdater) => {
    if (activeRouteInstanceKeyRef.current !== routeInstanceKey) return;
    setCalibrationState((previousState) => {
      if (activeRouteInstanceKeyRef.current !== routeInstanceKey) return previousState;
      const previousCalibration = previousState.routeInstanceKey === routeInstanceKey
        ? previousState.value
        : null;
      return {
        routeInstanceKey,
        value: typeof nextCalibrationOrUpdater === 'function'
          ? nextCalibrationOrUpdater(previousCalibration)
          : nextCalibrationOrUpdater,
      };
    });
  }, [activeRouteInstanceKeyRef, routeInstanceKey]);

  const updateCurrentImage = useCallback((nextImageOrUpdater) => {
    const expectedRouteInstanceKey = routeInstanceKey;
    if (activeRouteInstanceKeyRef.current !== expectedRouteInstanceKey) return;

    setImageState((previousState) => {
      if (activeRouteInstanceKeyRef.current !== expectedRouteInstanceKey) return previousState;
      const previousImage = previousState.routeInstanceKey === expectedRouteInstanceKey
        ? previousState.value
        : null;
      const nextImage = typeof nextImageOrUpdater === 'function'
        ? nextImageOrUpdater(previousImage)
        : nextImageOrUpdater;
      if (
        nextImage
        && nextImage.id !== null
        && nextImage.id !== undefined
        && String(nextImage.id) !== String(imageId)
      ) {
        return previousState;
      }
      return {
        routeInstanceKey: expectedRouteInstanceKey,
        value: nextImage,
      };
    });
  }, [activeRouteInstanceKeyRef, imageId, routeInstanceKey]);

  const measurementsGlueRef = useRef(measurementsGlue);
  measurementsGlueRef.current = measurementsGlue;

  // The route owns image, loading, error, and title state. Image reads are
  // aborted on navigation via useRouteRequestOwnership.
  useEffect(() => {
    const expectedRouteInstanceKey = routeInstanceKey;
    setCalibrationState({ routeInstanceKey: expectedRouteInstanceKey, value: null });

    if (!imageId || !projectId) {
      setError('Image ID or Project ID is missing.');
      setLoading(false);
      return undefined;
    }

    const request = beginRequest();
    const {
      imageMutationKey,
      measurementMutationRevisionAtLoad,
    } = measurementsGlueRef.current.prepareForNewImageLoad(
      projectId,
      imageId,
      expectedRouteInstanceKey,
    );

    setImageState({ routeInstanceKey: expectedRouteInstanceKey, value: null });
    setError(null);
    setLoading(true);

    const loadCurrentImage = async () => {
      try {
        let imageData;

        try {
          imageData = await fetchImage(imageId, { signal: request.controller.signal });
        } catch {
          const projectImageData = await fetchProjectImages(
            projectId,
            { include_deleted: true },
            { signal: request.controller.signal },
          );
          if (!Array.isArray(projectImageData)) {
            throw new Error('Invalid project image response');
          }
          imageData = projectImageData.find((candidate) => String(candidate.id) === String(imageId));
          if (!imageData) throw new Error('Image not found in project');
        }
        if (!imageData || String(imageData.id) !== String(imageId)) {
          throw new Error('Image response did not match the current route');
        }

        if (isCurrent(request)) {
          measurementsGlueRef.current.commitLoadedMeasurements(
            imageData,
            expectedRouteInstanceKey,
            imageMutationKey,
            measurementMutationRevisionAtLoad,
          );
          setImageState({
            routeInstanceKey: expectedRouteInstanceKey,
            value: imageData,
          });
          document.title = `${imageData.filename || 'Image'} - Image Manager`;
        }
      } catch (loadError) {
        if (isAbortError(loadError, request) || !isCurrent(request)) return;
        console.error('Error loading image data:', loadError);
        setError('Failed to load image. Please try again later.');
      } finally {
        if (isCurrent(request)) {
          setLoading(false);
        }
      }
    };

    loadCurrentImage();
    return () => {
      request.controller.abort();
      measurementsGlueRef.current.discardRouteMeasurements(expectedRouteInstanceKey);
    };
  }, [beginRequest, imageId, isCurrent, projectId, routeInstanceKey]);

  return {
    calibration,
    error,
    image,
    loading,
    setError,
    setRouteCalibration,
    setRouteError,
    setRouteLoading,
    updateCurrentImage,
  };
}
