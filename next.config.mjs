import { fileURLToPath } from 'url';
import { dirname } from 'path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the tracing root to this project so an unrelated lockfile elsewhere on
  // the machine doesn't get picked as the workspace root.
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),
  // sql.js ships a .wasm file that shouldn't be run through the bundler.
  serverExternalPackages: ['sql.js'],
  // Make sure the wasm binary is traced into the serverless function bundle on Vercel.
  outputFileTracingIncludes: {
    '/api/ask': ['./node_modules/sql.js/dist/sql-wasm.wasm'],
  },
};

export default nextConfig;
