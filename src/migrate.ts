import { migrate } from "./db.ts";

await migrate();
console.log("migrations applied");
