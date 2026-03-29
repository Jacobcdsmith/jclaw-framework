import { Command } from "commander";
import { startJclawGate } from "../gate/server.js";

export function buildJclawCli() {
  const program = new Command();
  program.name("jclaw").description("JCLaw parallel agent framework CLI");

  program
    .command("gate")
    .description("Start the JCLaw Gate server")
    .option("-p, --port <port>", "Port to listen on", "18789")
    .action(async (opts) => {
      const port = Number(opts.port ?? 18789);
      await startJclawGate({ port });
    });

  return program;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildJclawCli().parse(process.argv);
}
