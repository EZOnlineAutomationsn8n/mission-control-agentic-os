import { readFile } from "node:fs/promises";
import path from "node:path";
import { databasePool } from "../src/lib/persistence/database";
import { upsertBrainSource, type BrainSource } from "../src/lib/shared-brain";

const inventoryPath = path.join(process.cwd(), "reports", "shared-brain-source-inventory.json");
const sources = JSON.parse(await readFile(inventoryPath, "utf8")) as Array<Omit<BrainSource, "scannedAt">>;

for (const source of sources) await upsertBrainSource(source);
console.log(`imported ${sources.length} Shared Brain source records`);
await databasePool().end();
