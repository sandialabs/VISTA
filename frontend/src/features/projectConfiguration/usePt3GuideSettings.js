import { useCallback } from 'react';
import {
  DEFAULT_PT3_3D_GUIDE_SETTINGS,
  normalizePt3GuideSettings,
} from '../../utils/pt3GuideSettings';
import { normalizeConfigurationSection } from './configurationSchema';

// Owns the PT3 3D-view guide settings derived state together with the
// handlers that mutate them: reading the normalized guide settings and
// default-comparison flag off of config, updating a single field, and
// resetting all fields to defaults.
export function usePt3GuideSettings(config, setConfig) {
  const pt3GuideSettings = normalizePt3GuideSettings(
    config.display_settings?.pt3_3d_guides,
  );
  const pt3GuideSettingsAreDefault = Object.entries(DEFAULT_PT3_3D_GUIDE_SETTINGS)
    .every(([field, value]) => pt3GuideSettings[field] === value);

  const updatePt3GuideSetting = useCallback((field, value) => {
    setConfig((previous) => {
      const displaySettings = normalizeConfigurationSection('display_settings', previous);
      return {
        ...previous,
        display_settings: {
          ...displaySettings,
          pt3_3d_guides: normalizePt3GuideSettings({
            ...displaySettings.pt3_3d_guides,
            [field]: value,
          }),
        },
      };
    });
  }, [setConfig]);

  const resetPt3GuideSettings = useCallback(() => {
    setConfig((previous) => ({
      ...previous,
      display_settings: {
        ...normalizeConfigurationSection('display_settings', previous),
        pt3_3d_guides: {
          ...DEFAULT_PT3_3D_GUIDE_SETTINGS,
        },
      },
    }));
  }, [setConfig]);

  return {
    pt3GuideSettings,
    pt3GuideSettingsAreDefault,
    updatePt3GuideSetting,
    resetPt3GuideSettings,
  };
}
