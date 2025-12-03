// Enhanced config-overrides.js for performance optimization
const path = require('path');

module.exports = function override(config, env) {
    // Development optimizations
    if (env === 'development') {
        // Enable webpack caching for faster rebuilds
        config.cache = {
            type: 'filesystem',
            cacheDirectory: path.resolve(__dirname, '.webpack-cache'),
            buildDependencies: {
                config: [__filename]
            }
        };

        // Optimize source maps for faster dev builds
        config.devtool = 'eval-cheap-module-source-map';

        // Enable Fast Refresh
        if (process.env.FAST_REFRESH !== 'false') {
            config.resolve.alias = {
                ...config.resolve.alias,
                'react-refresh/runtime': require.resolve('react-refresh/runtime')
            };
        }
    }

    // Production optimizations
    if (env === 'production') {
        // Enable webpack caching for faster builds
        config.cache = {
            type: 'filesystem',
            cacheDirectory: path.resolve(__dirname, '.webpack-cache-prod')
        };

        // Optimize bundle splitting
        config.optimization = {
            ...config.optimization,
            splitChunks: {
                chunks: 'all',
                cacheGroups: {
                    vendor: {
                        test: /[\\/]node_modules[\\/]/,
                        name: 'vendors',
                        chunks: 'all',
                    },
                    react: {
                        test: /[\\/]node_modules[\\/](react|react-dom)[\\/]/,
                        name: 'react-vendor',
                        chunks: 'all',
                    }
                }
            }
        };
    }

    // Common optimizations
    // Resolve extensions order optimization
    config.resolve.extensions = ['.js', '.jsx', '.ts', '.tsx', '.json'];
    
    // Add module resolve optimizations
    config.resolve.modules = [
        path.resolve(__dirname, 'src'),
        'node_modules'
    ];

    return config;
};