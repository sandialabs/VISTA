import { useMemo } from 'react';
import {
  getPt3GuideAppearance,
  normalizePt3GuideSettings,
} from '../../utils/pt3GuideSettings';

// Derives the normalized PT3 3D guide settings and their rendered appearance
// from the project configuration display settings.
export default function usePt3GuideSettings(projectConfiguration) {
  const pt3GuideSettings = useMemo(
    () => normalizePt3GuideSettings(
      projectConfiguration?.display_settings?.pt3_3d_guides,
    ),
    [projectConfiguration],
  );
  const pt3GuideAppearance = useMemo(
    () => getPt3GuideAppearance(pt3GuideSettings),
    [pt3GuideSettings],
  );
  return { pt3GuideAppearance, pt3GuideSettings };
}
