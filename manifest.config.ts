import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "./package.json" with { type: "json" };

export default defineManifest({
  manifest_version: 3,
  name: "Sincerity Tools",
  version: pkg.version,
  description: "Selection-driven developer tools (base64 decoder, ...).",
  // No host permissions needed for the v0.1 surface — purely content-script DOM work.
  permissions: [],
  action: {
    default_title: "Sincerity Tools"
  },
  content_scripts: [
    {
      // <all_urls> covers http, https, and file://; the latter needs the user to enable
      // "Allow access to file URLs" on the extension's details page.
      matches: ["<all_urls>"],
      js: ["src/content/index.ts"],
      run_at: "document_idle",
      all_frames: false
    }
  ],
  icons: {
    "16": "src/assets/icon-16.png",
    "32": "src/assets/icon-32.png",
    "48": "src/assets/icon-48.png",
    "128": "src/assets/icon-128.png"
  }
});
