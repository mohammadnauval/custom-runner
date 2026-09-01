/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // API routes live in this app now (src/app/api/**), so no proxy rewrite to a
  // separate backend is needed.
  eslint: {
    // Lint is run explicitly via `npm run lint`; don't fail Vercel builds on it
    ignoreDuringBuilds: true,
  },
};

module.exports = nextConfig;
