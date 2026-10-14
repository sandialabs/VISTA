import { createMeasurementMutationQueue } from '../measurementMutationQueue';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createMeasurementMutationQueue', () => {
  test('runs writes for one resource in order and rebases each onto the confirmed base', async () => {
    const queue = createMeasurementMutationQueue();
    const firstWrite = deferred();
    const seenBases = [];

    const first = queue.enqueue('image-a', {
      initialConfirmedMeasurements: ['initial'],
      persist: (base) => {
        seenBases.push(base);
        return firstWrite.promise;
      },
    });
    const second = queue.enqueue('image-a', {
      initialConfirmedMeasurements: ['ignored'],
      persist: async (base) => {
        seenBases.push(base);
        return [...base, 'second'];
      },
    });

    await flush();
    expect(seenBases).toEqual([['initial']]);

    firstWrite.resolve(['acknowledged first']);
    await expect(first).resolves.toEqual(['acknowledged first']);
    await expect(second).resolves.toEqual(['acknowledged first', 'second']);
    expect(seenBases).toEqual([['initial'], ['acknowledged first']]);
    expect(queue.getConfirmedMeasurements('image-a')).toEqual(['acknowledged first', 'second']);
  });

  test('does not serialize writes across different resources', async () => {
    const queue = createMeasurementMutationQueue();
    const blocked = deferred();
    const persistB = jest.fn(async (base) => base);

    queue.enqueue('image-a', { initialConfirmedMeasurements: [], persist: () => blocked.promise });
    const writeB = queue.enqueue('image-b', { initialConfirmedMeasurements: ['b'], persist: persistB });

    await expect(writeB).resolves.toEqual(['b']);
    expect(persistB).toHaveBeenCalledWith(['b']);
    blocked.resolve([]);
  });

  test('a failed write rejects, keeps the confirmed base, and does not block later writes', async () => {
    const queue = createMeasurementMutationQueue();
    const onConfirmed = jest.fn();

    const failed = queue.enqueue('image-a', {
      initialConfirmedMeasurements: ['confirmed'],
      persist: async () => {
        throw new Error('write failed');
      },
      onConfirmed,
    });
    const next = queue.enqueue('image-a', {
      persist: async (base) => [...base, 'next'],
    });

    await expect(failed).rejects.toThrow('write failed');
    expect(onConfirmed).not.toHaveBeenCalled();
    await expect(next).resolves.toEqual(['confirmed', 'next']);
  });

  test('calls onConfirmed with the acknowledgement after updating the confirmed base', async () => {
    const queue = createMeasurementMutationQueue();
    const onConfirmed = jest.fn(() => {
      expect(queue.getConfirmedMeasurements('image-a')).toEqual(['ack']);
    });

    await queue.enqueue('image-a', {
      initialConfirmedMeasurements: [],
      persist: async () => ['ack'],
      onConfirmed,
    });

    expect(onConfirmed).toHaveBeenCalledWith(['ack']);
  });

  test('tracks pendingCount and revision on enqueue and on settlement', async () => {
    const queue = createMeasurementMutationQueue();
    expect(queue.getRevision('image-a')).toBe(0);
    expect(queue.getPendingCount('image-a')).toBe(0);

    const firstWrite = deferred();
    const secondWrite = deferred();
    const first = queue.enqueue('image-a', {
      initialConfirmedMeasurements: [],
      persist: () => firstWrite.promise,
    });
    const second = queue.enqueue('image-a', { persist: () => secondWrite.promise });
    expect(queue.getPendingCount('image-a')).toBe(2);
    expect(queue.getRevision('image-a')).toBe(2);

    firstWrite.resolve(['one']);
    await first;
    expect(queue.getPendingCount('image-a')).toBe(1);
    expect(queue.getRevision('image-a')).toBe(3);

    secondWrite.reject(new Error('second failed'));
    await expect(second).rejects.toThrow('second failed');
    expect(queue.getPendingCount('image-a')).toBe(0);
    expect(queue.getRevision('image-a')).toBe(4);
  });

  test('replaceConfirmedIfSettled only adopts a load when idle and at the same revision', async () => {
    const queue = createMeasurementMutationQueue();
    queue.replaceConfirmedIfSettled('image-a', 0, ['no entry']);
    expect(queue.getConfirmedMeasurements('image-a')).toBeUndefined();

    const write = deferred();
    const pending = queue.enqueue('image-a', {
      initialConfirmedMeasurements: ['base'],
      persist: () => write.promise,
    });
    queue.replaceConfirmedIfSettled('image-a', queue.getRevision('image-a'), ['while pending']);
    expect(queue.getConfirmedMeasurements('image-a')).toEqual(['base']);

    const revisionBeforeSettle = queue.getRevision('image-a');
    write.resolve(['ack']);
    await pending;
    queue.replaceConfirmedIfSettled('image-a', revisionBeforeSettle, ['stale load']);
    expect(queue.getConfirmedMeasurements('image-a')).toEqual(['ack']);

    queue.replaceConfirmedIfSettled('image-a', queue.getRevision('image-a'), ['fresh load']);
    expect(queue.getConfirmedMeasurements('image-a')).toEqual(['fresh load']);
  });
});
