import type { NextConfig } from "next";
import withPWA from "@ducanh2912/next-pwa";

const nextConfig: NextConfig = {
  output: "standalone",
  turbopack: {},
};

export default withPWA({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
  scope: "/",
  sw: "sw.js",
  workboxOptions: {
    runtimeCaching: [
      {
        urlPattern: /^\/api\/tiles\//,
        handler: "CacheFirst",
        options: {
          cacheName: "map-tiles",
          expiration: { maxAgeSeconds: 2592000, maxEntries: 2000 },
        },
      },
      { urlPattern: /^\/api\//, handler: "NetworkOnly" },
      {
        urlPattern: /\/_next\/static\/.*/,
        handler: "CacheFirst",
        options: {
          cacheName: "next-static",
          expiration: { maxAgeSeconds: 31536000 },
        },
      },
      {
        urlPattern: /\.(png|svg|ico|webp)$/,
        handler: "CacheFirst",
        options: {
          cacheName: "static-images",
          expiration: { maxAgeSeconds: 2592000 },
        },
      },
    ],
  },
})(nextConfig);
