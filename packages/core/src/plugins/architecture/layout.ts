import type { ResolvedModule } from "../../project/types.js";
import type { ArchitectureLayout } from "../contracts.js";
import { resolveCleanArchitectureLayout } from "./clean.js";

/** Finite built-in architecture contracts; all families share the same composition. */
export function resolveArchitectureLayout(
  architecture: ResolvedModule["architecture"],
): ArchitectureLayout {
  switch (architecture) {
    case "clean":
      return resolveCleanArchitectureLayout();
    case "hexagonal":
      return {
        domainRoot: "core/domain",
        applicationRoot: "core/application",
        inboundPort: "core/application/ports/inbound",
        schema: "adapters/outbound/database/schema",
        databaseClient: "adapters/outbound/database/client.ts",
        directories: {
          domainEntity: "core/domain/entities",
          useCase: "core/application/operations",
          outboundPort: "core/application/ports/outbound",
          adapter: "adapters/outbound",
          controller: "adapters/inbound/http",
          infrastructure: "adapters",
        },
      };
    case "onion":
      return {
        domainRoot: "domain",
        applicationRoot: "application",
        inboundPort: "application/contracts",
        schema: "infrastructure/database/schema",
        databaseClient: "infrastructure/database/client.ts",
        directories: {
          domainEntity: "domain/entities",
          useCase: "application/services",
          outboundPort: "application/ports",
          adapter: "infrastructure/adapters",
          controller: "infrastructure/http/controllers",
          infrastructure: "infrastructure",
        },
      };
  }
}
