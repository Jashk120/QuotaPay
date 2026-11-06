/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  /**
   * The DAO operator is the main product at `/`. Sponsorship moved under
   * `/sponsorship`. These keep old links, bookmarks and scripts working.
   */
  async redirects() {
    return [
      { source: "/dao", destination: "/", permanent: false },
      { source: "/dao/new", destination: "/new", permanent: false },
      { source: "/dao/join/:code", destination: "/join/:code", permanent: false },
      {
        source: "/company/new",
        destination: "/sponsorship/company/new",
        permanent: false,
      },
      { source: "/admin", destination: "/sponsorship/admin", permanent: false },
      { source: "/pay", destination: "/sponsorship/pay", permanent: false },
      { source: "/blind", destination: "/sponsorship/blind", permanent: false },
      {
        source: "/register",
        destination: "/sponsorship/register",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
