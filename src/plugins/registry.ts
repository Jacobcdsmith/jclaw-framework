import type { JclawPluginEntry } from "./types.js";

export interface JclawPluginRegistry {
  register(entry: JclawPluginEntry): void;
  list(): JclawPluginEntry[];
}

export function initPluginRegistry(): JclawPluginRegistry {
  const entries: JclawPluginEntry[] = [];

  return {
    register(entry) {
      entries.push(entry);
    },
    list() {
      return [...entries];
    }
  };
}
