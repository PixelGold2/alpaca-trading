#!/usr/bin/env node
// Starts/stops/status-checks the standalone, user-owned dev Postgres instance
// (see PGDATA_TERMINAL / PG_BIN_TERMINAL in .env). Windows dev convenience only —
// production runs Postgres as its own managed service/container.
import "dotenv/config";
import { spawnSync } from "node:child_process";
import path from "node:path";

const action = process.argv[2];
const pgData = process.env.PGDATA_TERMINAL;
const pgBin = process.env.PG_BIN_TERMINAL;

if (!pgData || !pgBin) {
  console.error("Set PGDATA_TERMINAL and PG_BIN_TERMINAL in .env first.");
  process.exit(1);
}

const pgCtl = path.join(pgBin, "pg_ctl.exe");
const logFile = path.join(path.dirname(pgData), "server.log");

function run(args) {
  const result = spawnSync(pgCtl, args, { stdio: "inherit" });
  process.exit(result.status ?? 1);
}

switch (action) {
  case "start":
    run(["-D", pgData, "-l", logFile, "start"]);
    break;
  case "stop":
    run(["-D", pgData, "stop", "-m", "fast"]);
    break;
  case "status":
    run(["-D", pgData, "status"]);
    break;
  default:
    console.error("Usage: node scripts/db-control.mjs <start|stop|status>");
    process.exit(1);
}
