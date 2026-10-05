import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FinanceVault",
    short_name: "FinanceVault",
    start_url: "/",
    display: "standalone",
    background_color: "#000000",
    theme_color: "#000000",
    icons: [{ src: "/apple-icon", sizes: "180x180", type: "image/png" }],
  };
}
