import { migrate } from "./db.ts";

const [, , cmd, ...args] = process.argv;

const usage = `
audit-cc-tail — Claude behavioral variant fingerprinting

Usage:
  bun run src/index.ts <command> [options]

Commands:
  migrate              Apply DB schema migrations
  ingest               Backfill history + watch ~/.claude/projects for new responses
  cluster              Run BGMM clustering once and print results
  cluster --watch      Recalibrate every hour (keeps running)
  dashboard            Live ANSI terminal dashboard (refreshes every 5s)

Options:
  --help               Show this help
`.trim();

if (!cmd || cmd === "--help" || cmd === "-h") {
  console.log(usage);
  process.exit(0);
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

const handler = dispatch[cmd];
if (!handler) {
  console.error(`Unknown command: ${cmd}\n`);
  console.log(usage);
  process.exit(1);
}

await handler();
