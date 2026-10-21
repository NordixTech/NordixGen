import type { ArchitectureLayout } from "../contracts.js";
export function resolveCleanArchitectureLayout(): ArchitectureLayout {
  return {
    domainRoot: "domain",
    applicationRoot: "application",
    inboundPort: "application/ports/inbound",
    schema: "infrastructure/database/schema",
    databaseClient: "infrastructure/database/client.ts",
    directories: {
      domainEntity: "domain/entities",
      useCase: "application/use-cases",
      outboundPort: "application/ports/outbound",
      adapter: "infrastructure/adapters",
      controller: "presentation/controllers",
      infrastructure: "infrastructure",
    },
  };
}
