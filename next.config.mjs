/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emits .next/standalone so the Docker image ships only what it needs.
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    // Native and SDK packages stay outside the server-component bundle.
    serverComponentsExternalPackages: [
      '@prisma/client',
      '@prisma/adapter-better-sqlite3',
      'better-sqlite3',
      '@google/genai',
      '@anthropic-ai/sdk',
    ],
    // Enables src/instrumentation.ts, which starts the in-process scheduler.
    instrumentationHook: true,
  },
  webpack: (config, { isServer, nextRuntime }) => {
    if (isServer && nextRuntime === 'edge') {
      // instrumentation.ts is compiled for the Edge runtime as well, where the
      // scheduler can never run (it returns early). Its imports pull in the
      // SQLite driver, which needs `fs`, so they resolve to nothing there.
      config.resolve.alias = {
        ...config.resolve.alias,
        'better-sqlite3': false,
        '@prisma/adapter-better-sqlite3': false,
        bindings: false,
      };
    }
    if (isServer && nextRuntime === 'nodejs') {
      // The native module is required at runtime, never bundled.
      config.externals = [...(config.externals ?? []), 'better-sqlite3', '@prisma/adapter-better-sqlite3'];
    }
    return config;
  },
};

export default nextConfig;
