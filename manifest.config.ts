import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "./package.json" with { type: "json" };

export default defineManifest({
  manifest_version: 3,
  name: "Sincerity Tools",
  version: pkg.version,
  description: "Selection-driven developer tools (base64 encode/decode, ...).",
  permissions: ["contextMenus"],
  action: {
    default_title: "Sincerity Tools",
    default_popup: "src/popup/index.html"
  },
  background: {
    service_worker: "src/background/index.ts",
    type: "module"
  },
  content_scripts: [
    {
      matches: ["<all_urls>"],
      js: ["src/content/index.ts"],
      run_at: "document_idle",
      // Many sites (community boards, embedded editors, Notion-style content)
      // render the body inside iframes. With all_frames:false we'd never see
      // mouseup/selection events in those frames. Inject into every frame so
      // the toolbar shows up wherever the user selects text.
      all_frames: true
    }
  ],
  icons: {
    "16": "src/assets/icon-16.png",
    "32": "src/assets/icon-32.png",
    "48": "src/assets/icon-48.png",
    "128": "src/assets/icon-128.png"
  }
});
