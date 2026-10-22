import { runOmiOutboundOnce } from "../src/lib/connectors/live/omi-outbound";

try {
  const result = await runOmiOutboundOnce();
  console.log(JSON.stringify(result));
  if (result.failed > 0) process.exitCode = 2;
  else if (result.uncertain > 0) process.exitCode = 3;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
