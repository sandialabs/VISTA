// Vite build and dev server for the VISTA UI (replaces Create React App).
//
// Compatibility with the previous react-scripts setup:
// - Output goes to build/ with assets under build/static/, the paths the backend serves
//   (FRONTEND_BUILD_PATH, the /static mount in backend/main.py).
// - JSX lives in .js files. Vite only compiles JSX in .jsx/.tsx, so jsxInJs() compiles
//   src/**/*.js with oxc in JSX mode (with React Fast Refresh registration in dev).
// - process.env.NODE_ENV and REACT_APP_* variables (from the environment or .env files)
//   are inlined as process.env.*, the way react-scripts did.
// - The dev server keeps CRA's HOST/PORT variables and proxies /api to
//   REACT_APP_BACKEND_URL (default http://localhost:8000), replacing src/setupProxy.js.
import { defineConfig, loadEnv, transformWithOxc } from 'vite';
import react from '@vitejs/plugin-react';

const SRC_JS = /[\\/]src[\\/](?!.*[\\/]node_modules[\\/]).*\.js$/;

function jsxInJs() {
  let serving = false;
  return {
    name: 'vista:jsx-in-js',
    enforce: 'pre',
    configResolved(config) {
      serving = config.command === 'serve' && !config.isProduction;
    },
    async transform(code, id) {
      const file = id.split('?')[0];
      if (!SRC_JS.test(file)) return null;
      const result = await transformWithOxc(code, file, {
        lang: 'jsx',
        jsx: { runtime: 'automatic', development: serving, refresh: serving },
      });
      return { code: result.code, map: result.map };
    },
  };
}

function truthy(value) {
  return value === 'true' || value === '1';
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), 'REACT_APP_');
  const processEnv = {
    ...env,
    NODE_ENV: command === 'build' ? 'production' : 'development',
  };
  const usePolling = truthy(process.env.CHOKIDAR_USEPOLLING) || truthy(process.env.WATCHPACK_POLLING);

  return {
    plugins: [jsxInJs(), react()],
    define: {
      'process.env': JSON.stringify(processEnv),
    },
    optimizeDeps: {
      rolldownOptions: { moduleTypes: { '.js': 'jsx' } },
    },
    server: {
      host: process.env.HOST || 'localhost',
      port: Number(process.env.PORT) || 3000,
      strictPort: true,
      watch: usePolling ? { usePolling: true, interval: 300 } : undefined,
      proxy: {
        '/api': {
          target: process.env.REACT_APP_BACKEND_URL || env.REACT_APP_BACKEND_URL || 'http://localhost:8000',
          changeOrigin: true,
        },
      },
    },
    preview: {
      host: process.env.HOST || 'localhost',
      port: Number(process.env.PORT) || 3000,
      strictPort: true,
    },
    build: {
      outDir: 'build',
      assetsDir: 'static',
      emptyOutDir: true,
      sourcemap: process.env.GENERATE_SOURCEMAP !== 'false',
      chunkSizeWarningLimit: 4096,
    },
  };
});
