'use strict';

// Stylesheet imports have no meaning in Jest; replace them with an empty module
// (the behavior react-scripts provided).
module.exports = {
  process() {
    return { code: 'module.exports = {};' };
  },
  getCacheKey() {
    return 'cssTransform';
  },
};
