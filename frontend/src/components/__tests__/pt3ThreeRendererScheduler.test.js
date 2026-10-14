import { loadVolumeTextureImages } from '../pt3ThreeRenderer';
import { resetMprServerSliceSchedulerForTests } from '../mprServerSliceScheduler';

describe('PT3 volume texture slice scheduling', () => {
  const OriginalImage = global.Image;

  afterEach(() => {
    global.Image = OriginalImage;
    resetMprServerSliceSchedulerForTests();
  });

  test('shares the four-request MPR concurrency bound for 3D preview images', async () => {
    let active = 0;
    let maxActive = 0;

    class ControlledImage {
      set src(_url) {
        active += 1;
        maxActive = Math.max(maxActive, active);
        setTimeout(() => {
          this.width = 4;
          this.height = 3;
          this.naturalWidth = 4;
          this.naturalHeight = 3;
          active -= 1;
          this.onload?.();
        }, 5);
      }
    }
    global.Image = ControlledImage;
    const sources = Array.from({ length: 12 }, (_unused, sliceIndex) => ({
      id: `slice-${sliceIndex}`,
      sliceIndex,
      url: `/api/images/volume/volume-slice?axis=axial&index=${sliceIndex}`,
    }));

    const { images, ordered } = await loadVolumeTextureImages(sources);

    expect(images).toHaveLength(12);
    expect(ordered.map((source) => source.sliceIndex)).toEqual(sources.map((source) => source.sliceIndex));
    expect(maxActive).toBeLessThanOrEqual(4);
  });

  test('validates first-slice dimensions before requesting the remaining stack', async () => {
    let requestedImages = 0;

    class ControlledImage {
      set src(_url) {
        requestedImages += 1;
        this.width = 4096;
        this.height = 2048;
        this.naturalWidth = 4096;
        this.naturalHeight = 2048;
        setTimeout(() => this.onload?.(), 0);
      }
    }
    global.Image = ControlledImage;
    const sources = Array.from({ length: 32 }, (_unused, sliceIndex) => ({
      id: `oversized-slice-${sliceIndex}`,
      sliceIndex,
      url: `/api/images/oversized-${sliceIndex}/content`,
    }));
    const validateDimensions = jest.fn(() => {
      throw new Error('GPU texture budget exceeded');
    });

    await expect(loadVolumeTextureImages(sources, { validateDimensions }))
      .rejects.toThrow('GPU texture budget exceeded');

    expect(validateDimensions).toHaveBeenCalledWith([4096, 2048, 32]);
    expect(requestedImages).toBe(1);
  });

  test('rejects a mismatched later slice and cancels queued decodes', async () => {
    let requestedImages = 0;

    class ControlledImage {
      set src(url) {
        if (!url) return;
        requestedImages += 1;
        const mismatched = url.includes('slice-2');
        this.width = mismatched ? 8192 : 64;
        this.height = mismatched ? 4096 : 48;
        this.naturalWidth = this.width;
        this.naturalHeight = this.height;
        setTimeout(() => this.onload?.(), mismatched ? 0 : 5);
      }
    }
    global.Image = ControlledImage;
    const sources = Array.from({ length: 24 }, (_unused, sliceIndex) => ({
      id: `slice-${sliceIndex}`,
      sliceIndex,
      url: `/slice-${sliceIndex}`,
    }));

    await expect(loadVolumeTextureImages(sources)).rejects.toThrow(
      'Volume slice slice-2 dimensions 8192×4096 do not match the built-in consistent-stack requirement of 64×48',
    );

    expect(requestedImages).toBeLessThanOrEqual(5);
  });

  test('rejects mismatched declared dimensions before decoding that slice', async () => {
    let requestedImages = 0;

    class ControlledImage {
      set src(url) {
        if (!url) return;
        requestedImages += 1;
        this.width = 64;
        this.height = 48;
        this.naturalWidth = 64;
        this.naturalHeight = 48;
        setTimeout(() => this.onload?.(), 0);
      }
    }
    global.Image = ControlledImage;
    const sources = Array.from({ length: 12 }, (_unused, sliceIndex) => ({
      id: `declared-${sliceIndex}`,
      sliceIndex,
      url: `/declared-${sliceIndex}`,
      ...(sliceIndex === 4 ? { width: 8192, height: 4096 } : {}),
    }));

    await expect(loadVolumeTextureImages(sources)).rejects.toThrow(
      'Volume slice declared-4 declared dimensions 8192×4096 do not match the built-in consistent-stack requirement of 64×48',
    );

    expect(requestedImages).toBe(1);
  });
});
