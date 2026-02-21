/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    externalDir: true,
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:4000/api/:path*",
      },
      {
        source: "/static/:path*",
        destination: "http://localhost:4000/static/:path*",
      },
    ];
  },
};

module.exports = nextConfig;
