import { defineSetupPluginEntry } from "openclaw/plugin-sdk/core";
import { genericPlugin } from "./src/generic/channel.js";

export default defineSetupPluginEntry(genericPlugin);
