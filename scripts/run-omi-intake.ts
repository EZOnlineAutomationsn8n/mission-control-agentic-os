import { importOmiToObsidianIntake } from "../src/lib/connectors/live/omi-bridge";

const receipt = await importOmiToObsidianIntake();

console.log(JSON.stringify({
  result: "OMI_CANDIDATE_INTAKE_COMPLETE",
  pullMode: "official-mcp-streamable-http-readonly",
  outboundOmiWrites: false,
  canonicalVaultMutation: receipt.canonicalVaultMutation,
  counts: receipt.counts,
  receiptPath: receipt.receiptPath,
}, null, 2));
