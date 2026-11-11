// Matches backend API requests only: URLs whose path starts with /api/. A glob such as
// '**/api/**' also matches the Vite dev server's source modules under /src/api/, which
// would replace the app's own API client code with mocked JSON.
const API_REQUEST = /^https?:\/\/[^/]+\/api\//;

module.exports = { API_REQUEST };
