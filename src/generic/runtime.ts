import type { PluginRuntime } from "openclaw/plugin-sdk/core";
import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";

const runtimeStore = createPluginRuntimeStore("clawline");

export function setGenericRuntime(next: PluginRuntime) {
  runtimeStore.setRuntime(next);
}

export function getGenericRuntime(): PluginRuntime {
  return runtimeStore.getRuntime() as PluginRuntime;
}
