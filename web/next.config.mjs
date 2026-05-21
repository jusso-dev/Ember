const CONTROL_PLANE = process.env.CONTROL_PLANE_URL || 'http://127.0.0.1:8080';

/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${CONTROL_PLANE}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
