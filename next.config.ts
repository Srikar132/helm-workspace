import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [{ protocol: "https", hostname: "res.cloudinary.com" }],
  },
  // Galleries used to be "albums"; links and bookmarks to the old URL keep working.
  async redirects() {
    return [
      {
        source: "/workspace/:slug/albums/:id",
        destination: "/workspace/:slug/gallery/:id",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
