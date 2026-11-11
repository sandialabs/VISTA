'use strict';

const path = require('path');

// Non-JS asset imports (images, fonts, data files) resolve to their file name,
// matching the react-scripts Jest setup.
module.exports = {
  process(src, filename) {
    return { code: `module.exports = ${JSON.stringify(path.basename(filename))};` };
  },
};
