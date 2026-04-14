import { spawn } from "child_process";
import { migrate } from "./db.ts";

const [, , cmd, ...args] = process.argv;
const self = import.meta.dir + "/index.ts";

const usage = `
audit-cc-tail — Claude behavioral variant fingerprinting

Usage:
  bun run src/index.ts [command]

Commands:
  (none)               Migrate + start ingest, cluster:watch, and dashboard
  migrate              Apply DB schema migrations only
  ingest               Backfill + watch for new responses
  cluster [--watch]    Run BGMM clustering once (or hourly with --watch)
  dashboard            Live terminal dashboard

Options:
  --help               Show this help
`.trim();

function spawnWorker(workerCmd: string, workerArgs: string[] = []) {
  const proc = spawn("bun", ["run", self, workerCmd, ...workerArgs], {
    stdio: "inherit",
    env: process.env,
  });
  proc.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[${workerCmd}] exited with code ${code}, restarting in 3s…`);
      setTimeout(() => spawnWorker(workerCmd, workerArgs), 3000);
    }
  });
  return proc;
}

const dispatch: Record<string, () => Promise<void>> = {
  migrate: async () => {
    await migrate();
    console.log("migrations applied");
  },
  ingest: async () => {
    await import("./ingest.ts");
  },
  cluster: async () => {
    process.argv = [...process.argv.slice(0, 2), ...args];
    await import("./cluster.ts");
  },
  dashboard: async () => {
    await import("./dashboard.ts");
  },
};

if (!cmd || cmd === "--help" || cmd === "-h") {
  if (cmd === "--help" || cmd === "-h") { console.log(usage); process.exit(0); }

  await migrate();
  console.log("migrations applied — starting workers…");

  const workers = [
    spawnWorker("ingest"),
    spawnWorker("cluster", ["--watch"]),
    spawnWorker("dashboard"),
  ];

  process.on("SIGINT", () => {
    workers.forEach((w) => w.kill());
    process.exit(0);
  });
} else {
  const handler = dispatch[cmd];
  if (!handler) {
    console.error(`Unknown command: ${cmd}\n`);
    console.log(usage);
    process.exit(1);
  }
  await handler();
}
