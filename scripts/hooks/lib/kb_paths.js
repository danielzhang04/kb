"use strict";

const path = require("path");

/** Resolve DASHBOARD_STATE_ROOT/family/... or the artifact family's unchanged desktop fallback. */
function resolveStatePath(family, fallback, env, ...parts) {
  const e = env || process.env;
  const configured = typeof e.DASHBOARD_STATE_ROOT === "string"
    ? e.DASHBOARD_STATE_ROOT.trim()
    : "";
  if (configured) {
    return path.join(configured, family, ...parts);
  }
  return fallback;
}

module.exports = { resolveStatePath };
