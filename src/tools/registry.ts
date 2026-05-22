import type { Tool } from "../types";
import { base64DecoderTool } from "./base64-decoder";
import { base64EncoderTool } from "./base64-encoder";

/**
 * Order here = order in the toolbar (after the content-script's
 * applicable-first sort). Keep the most likely-to-apply tools first.
 */
export const tools: Tool[] = [base64DecoderTool, base64EncoderTool];
