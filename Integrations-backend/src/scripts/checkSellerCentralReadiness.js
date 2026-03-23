"use strict";

const { getSellerCentralReadiness } = require("./sellerCentralConfig");

const readiness = getSellerCentralReadiness(process.env);

const summary = {
  session_source_present: readiness.sessionSourcePresent ? "YES" : "NO",
  case_url_present: readiness.caseUrlPresent ? "YES" : "NO",
  selector_config_present: readiness.selectorConfigPresent ? "YES" : "NO",
  dry_run_enabled: readiness.dryRunEnabled ? "YES" : "NO",
  overall_readiness: readiness.ready ? "READY" : "BLOCKED",
};

process.stdout.write(
  JSON.stringify(
    {
      summary,
      ready: readiness.ready,
      missing: readiness.missing,
      warnings: readiness.warnings,
      session_source_type: readiness.sessionSourceType,
      selector_map: readiness.selectorMap,
    },
    null,
    2,
  ),
);

process.stdout.write("\n");
process.exitCode = readiness.ready ? 0 : 1;
