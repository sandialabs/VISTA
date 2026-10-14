import { useCallback, useEffect, useRef, useState } from 'react';

import {
  applyGalleryFilters,
  hasGalleryQueryParams,
  loadGalleryState,
  loadGalleryStateFromUrl,
  preserveGalleryQueryParams,
  sortImages,
} from '../../utils/galleryState';
import {
  fetchProjectImageReviewStatuses,
  fetchProjectImages,
} from '../../api/images';

const EMPTY_LIST = Object.freeze([]);

function isAbortError(error) {
  return error?.name === 'AbortError';
}

export default function useImageNavigation({
  activeRouteInstanceKeyRef,
  image,
  imageId,
  navigate,
  projectId,
  routeInstanceKey,
  searchParams,
  setError,
  skipDeletedImages,
}) {
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [navigationState, setNavigationState] = useState({
    currentImageIndex: -1,
    images: [],
    routeInstanceKey: null,
  });
  const navigationLoadRef = useRef({ generation: 0, controller: null });
  const navigationTimerRef = useRef(null);

  const projectImages = navigationState.routeInstanceKey === routeInstanceKey
    ? navigationState.images
    : EMPTY_LIST;
  const currentImageIndex = navigationState.routeInstanceKey === routeInstanceKey
    ? navigationState.currentImageIndex
    : -1;

  useEffect(() => {
    navigationLoadRef.current.controller?.abort();
    const pendingNavigation = navigationTimerRef.current;
    if (pendingNavigation) {
      window.clearTimeout(pendingNavigation.timeoutId);
      navigationTimerRef.current = null;
    }
    setNavigationState({
      currentImageIndex: -1,
      images: [],
      routeInstanceKey,
    });

    return () => {
      navigationLoadRef.current.controller?.abort();
      const routeNavigation = navigationTimerRef.current;
      if (routeNavigation?.routeInstanceKey === routeInstanceKey) {
        window.clearTimeout(routeNavigation.timeoutId);
        navigationTimerRef.current = null;
      }
    };
  }, [routeInstanceKey]);

  const loadProjectImages = useCallback(async (groupId) => {
    const expectedRouteInstanceKey = routeInstanceKey;
    const generation = navigationLoadRef.current.generation + 1;
    navigationLoadRef.current.controller?.abort();
    const controller = new AbortController();
    navigationLoadRef.current = { generation, controller };
    try {
      const params = new URLSearchParams({ include_deleted: 'true' });
      const urlGalleryKey = searchParams.get('galleryKey');
      const urlGroupId = searchParams.get('groupId');
      const isUngroupedGallery = searchParams.get('ungrouped') === 'true'
        || (urlGalleryKey && urlGalleryKey.endsWith('_ungrouped'));

      if (isUngroupedGallery) {
        params.set('ungrouped', 'true');
      } else if (urlGroupId) {
        params.set('group_id', urlGroupId);
      } else if (groupId) {
        params.set('group_id', groupId);
      }
      const images = await fetchProjectImages(
        projectId,
        Object.fromEntries(params.entries()),
        { signal: controller.signal },
      );

      if (!Array.isArray(images)) {
        console.error('Server response is not an array:', images);
        throw new Error('Invalid server response: expected an array of images');
      }

      let galleryStateKey;
      if (urlGalleryKey) {
        galleryStateKey = urlGalleryKey;
      } else if (groupId) {
        galleryStateKey = `${projectId}_group_${groupId}`;
      } else {
        galleryStateKey = projectId;
      }

      let navImages;
      try {
        const galleryState = hasGalleryQueryParams(searchParams)
          ? { ...loadGalleryState(galleryStateKey), ...loadGalleryStateFromUrl(searchParams) }
          : loadGalleryState(galleryStateKey);

        let reviewStatuses = null;
        if (galleryState.reviewFilter && galleryState.reviewFilter !== 'all') {
          try {
            reviewStatuses = await fetchProjectImageReviewStatuses(projectId, {
              signal: controller.signal,
            });
          } catch (error) {
            if (isAbortError(error) || controller.signal.aborted) throw error;
            console.warn('Failed to load review statuses for navigation filter:', error);
          }
        }

        const effectiveGalleryState = reviewStatuses != null
          ? { ...galleryState, reviewStatuses }
          : { ...galleryState, reviewFilter: 'all', reviewStatuses: null };

        navImages = applyGalleryFilters(images, effectiveGalleryState);
      } catch (_error) {
        navImages = sortImages(images, 'date');
      }

      if (
        controller.signal.aborted
        || navigationLoadRef.current.generation !== generation
        || activeRouteInstanceKeyRef.current !== expectedRouteInstanceKey
      ) {
        return;
      }

      const index = navImages.findIndex((candidate) => candidate.id === imageId);
      setNavigationState({
        currentImageIndex: index,
        images: navImages,
        routeInstanceKey: expectedRouteInstanceKey,
      });
    } catch (error) {
      if (
        isAbortError(error)
        || controller.signal.aborted
        || navigationLoadRef.current.generation !== generation
        || activeRouteInstanceKeyRef.current !== expectedRouteInstanceKey
      ) {
        return;
      }
      console.error('Error loading project images:', error);
      setError('Failed to load project images for navigation. Please try again later.');
    }
  }, [
    activeRouteInstanceKeyRef,
    imageId,
    projectId,
    routeInstanceKey,
    searchParams,
    setError,
  ]);

  useEffect(() => {
    if (image && projectId) {
      loadProjectImages(image.group_id || null);
    }
  }, [image?.id, image?.group_id, projectId, loadProjectImages]); // eslint-disable-line react-hooks/exhaustive-deps

  const buildNavQuery = useCallback(() => {
    const params = preserveGalleryQueryParams(searchParams, { project: projectId });
    return params.toString();
  }, [projectId, searchParams]);

  const scheduleImageNavigation = useCallback((targetImage) => {
    if (!targetImage?.id) return;
    const pendingNavigation = navigationTimerRef.current;
    if (pendingNavigation) window.clearTimeout(pendingNavigation.timeoutId);

    const expectedRouteInstanceKey = routeInstanceKey;
    const targetImageId = targetImage.id;
    const navigationQuery = buildNavQuery();
    setIsTransitioning(true);
    const timeoutId = window.setTimeout(() => {
      if (navigationTimerRef.current?.timeoutId === timeoutId) {
        navigationTimerRef.current = null;
      }
      if (activeRouteInstanceKeyRef.current !== expectedRouteInstanceKey) return;
      navigate(`/view/${targetImageId}?${navigationQuery}`);
    }, 300);
    navigationTimerRef.current = {
      routeInstanceKey: expectedRouteInstanceKey,
      timeoutId,
    };
  }, [activeRouteInstanceKeyRef, buildNavQuery, navigate, routeInstanceKey]);

  const navigateToPreviousImage = useCallback(() => {
    let targetIndex = currentImageIndex - 1;

    if (skipDeletedImages) {
      while (targetIndex >= 0 && projectImages[targetIndex]?.deleted_at) {
        targetIndex -= 1;
      }
    }

    if (targetIndex >= 0) {
      scheduleImageNavigation(projectImages[targetIndex]);
    }
  }, [currentImageIndex, projectImages, scheduleImageNavigation, skipDeletedImages]);

  const navigateToNextImage = useCallback(() => {
    let targetIndex = currentImageIndex + 1;

    if (skipDeletedImages) {
      while (targetIndex < projectImages.length && projectImages[targetIndex]?.deleted_at) {
        targetIndex += 1;
      }
    }

    if (targetIndex < projectImages.length) {
      scheduleImageNavigation(projectImages[targetIndex]);
    }
  }, [currentImageIndex, projectImages, scheduleImageNavigation, skipDeletedImages]);

  useEffect(() => {
    setIsTransitioning(false);
  }, [routeInstanceKey]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'ArrowLeft') {
        navigateToPreviousImage();
      } else if (event.key === 'ArrowRight') {
        navigateToNextImage();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [currentImageIndex, projectImages.length, navigateToNextImage, navigateToPreviousImage]);

  return {
    currentImageIndex,
    isTransitioning,
    loadProjectImages,
    navigateToNextImage,
    navigateToPreviousImage,
    projectImages,
  };
}
