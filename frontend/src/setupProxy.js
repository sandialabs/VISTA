const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  // Use environment variable for backend URL, fallback to localhost for local dev
  const backendUrl = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000';
  console.log(`Configuring proxy to backend at ${backendUrl}`);

  app.use(
    '/api',
    createProxyMiddleware({
      target: backendUrl,
      changeOrigin: true,
      logLevel: 'debug',
    })
  );
};
