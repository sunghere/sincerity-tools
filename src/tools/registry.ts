import type { Tool } from "../types";
import { base64DecoderTool } from "./base64-decoder";

/**
 * Order here = order in the toolbar. Keep the most likely-to-apply tools first
 * so the first icon is usually the one the user wants.
 */
export const tools: Tool[] = [base64DecoderTool];

export function findApplicableTools(selection: string): Tool[] {
  const trimmed = selection.trim();
  if (!trimmed) return [];
  return tools.filter((t) => {
    try {
      return t.canHandle(trimmed);
    } catch {
      return false;
    }
  });
}
