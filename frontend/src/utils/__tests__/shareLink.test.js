import { copyCurrentShareUrl, getCurrentShareUrl } from '../shareLink';

describe('shareLink', () => {
  const originalClipboard = navigator.clipboard;
  const originalExecCommand = document.execCommand;

  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: originalClipboard,
    });
    document.execCommand = originalExecCommand;
    jest.restoreAllMocks();
  });

  test('returns the exact synchronized browser URL from window.location.href', () => {
    window.history.pushState({}, '', '/project/proj-1?tab=inspection&image=img-1');

    expect(getCurrentShareUrl()).toBe(window.location.href);
  });

  test('copies the current URL with navigator.clipboard when available', async () => {
    window.history.pushState({}, '', '/project/proj-1?tab=analyze');
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    await expect(copyCurrentShareUrl()).resolves.toBe(window.location.href);
    expect(writeText).toHaveBeenCalledWith(window.location.href);
  });

  test('falls back to textarea copy when clipboard API is unavailable', async () => {
    window.history.pushState({}, '', '/images/img-1?project=proj-1');
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
    document.execCommand = jest.fn().mockReturnValue(true);

    await expect(copyCurrentShareUrl()).resolves.toBe(window.location.href);
    expect(document.execCommand).toHaveBeenCalledWith('copy');
  });
});
