import type { BackendPaths, CleanLayout } from "../contracts.js";
export function resolveCleanArchitectureLayout(framework: BackendPaths): CleanLayout {
  return {
    codeRoot: framework.codeRoot,
    directories: {
      domainEntity: "domain/entities",
      useCase: "application/use-cases",
      inboundPort: "application/ports/inbound",
      outboundPort: "application/ports/outbound",
      adapter: "infrastructure/adapters",
      controller: "presentation/controllers",
      infrastructure: "infrastructure",
    },
  };
}
