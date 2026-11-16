import { PT1_HIDDEN_UI_SECTION_KEYS, isPt1ProjectType } from './configurationSchema';

// For PT1 projects the editor forces some sections to `false` for display.
// Those values come from the project type, not from the user, so they are not
// saved; otherwise a project later switched away from PT1 would keep the
// sections hidden. Now that the backend persists `ui_sections`, this matters.
// For other project types the same keys are genuine user choices and are kept.
export function toPersistedConfiguration(config, projectType) {
  if (
    !isPt1ProjectType(projectType)
    || !config
    || typeof config !== 'object'
    || !config.ui_sections
    || typeof config.ui_sections !== 'object'
  ) {
    return config;
  }
  const uiSections = { ...config.ui_sections };
  PT1_HIDDEN_UI_SECTION_KEYS.forEach((key) => {
    if (uiSections[key] === false) delete uiSections[key];
  });
  return { ...config, ui_sections: uiSections };
}
