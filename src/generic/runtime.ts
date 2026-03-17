import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtime: PluginRuntime | null = null;

export function setGenericRuntime(next: PluginRuntime) {
  runtime = next;
}

export function getGenericRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("Generic channel runtime not initialized");
  }
  return runtime;
}
