import { act, renderHook } from '@testing-library/react';

import { usePt3GuideSettings } from '../usePt3GuideSettings';
import { DEFAULT_PT3_3D_GUIDE_SETTINGS } from '../../../utils/pt3GuideSettings';

function renderWithConfig(initialConfig) {
  let config = initialConfig;
  const setConfig = jest.fn((updater) => {
    config = typeof updater === 'function' ? updater(config) : updater;
  });
  const hookResult = renderHook(() => usePt3GuideSettings(config, setConfig));
  return { hookResult, setConfig, getConfig: () => config };
}

describe('usePt3GuideSettings', () => {
  test('normalizes missing guide settings to defaults', () => {
    const { hookResult } = renderWithConfig({});

    expect(hookResult.result.current.pt3GuideSettings).toEqual(DEFAULT_PT3_3D_GUIDE_SETTINGS);
    expect(hookResult.result.current.pt3GuideSettingsAreDefault).toBe(true);
  });

  test('updatePt3GuideSetting merges a single field into display_settings.pt3_3d_guides', () => {
    const field = Object.keys(DEFAULT_PT3_3D_GUIDE_SETTINGS)[0];
    const { hookResult, setConfig, getConfig } = renderWithConfig({ display_settings: {} });

    act(() => {
      hookResult.result.current.updatePt3GuideSetting(field, 90);
    });

    expect(setConfig).toHaveBeenCalled();
    expect(getConfig().display_settings.pt3_3d_guides[field]).toBe(90);
  });

  test('resetPt3GuideSettings restores defaults', () => {
    const field = Object.keys(DEFAULT_PT3_3D_GUIDE_SETTINGS)[0];
    const { hookResult, getConfig } = renderWithConfig({
      display_settings: {
        pt3_3d_guides: { [field]: 0.1 },
      },
    });

    act(() => {
      hookResult.result.current.resetPt3GuideSettings();
    });

    expect(getConfig().display_settings.pt3_3d_guides).toEqual(DEFAULT_PT3_3D_GUIDE_SETTINGS);
  });
});
