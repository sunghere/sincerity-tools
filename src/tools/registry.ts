import type { Tool } from "../types";
import { base64DecoderTool } from "./base64-decoder";
import { base64EncoderTool } from "./base64-encoder";
import { urlInspectorTool } from "./url-inspector";
import { urlQrTool } from "./url-qr";

/**
 * Order here is the *default* order in the toolbar/context menu.
 * The content-script reorders by applicable-first so the most likely pick
 * sits closest to the user's cursor.
 */
export const tools: Tool[] = [
  urlInspectorTool,
  urlQrTool,
  base64DecoderTool,
  base64EncoderTool,
];
