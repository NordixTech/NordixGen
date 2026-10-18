import type { CleanLayout } from "../contracts.js";
export function resolveCleanArchitectureLayout(): CleanLayout {
  return {
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
