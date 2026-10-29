# Modules

A module owns a business area inside one backend: its entities, application operations and persistence adapters. Choose modules around business responsibilities, such as catalog, billing or fulfillment.

## Declare modules

```yaml
modules:
  catalog:
    architecture: clean
    entities: [Product, Category]
  billing:
    architecture: hexagonal
    entities: [Invoice]
```

This fragment belongs on a backend. Each listed entity must declare that backend and occur in exactly one module. Modules cannot be empty. You may mix `clean`, `hexagonal` and `onion` in the same application.

## Shared platform, private business data

The backend owns one identity service, database scope, HTTP application and composition root. Business tables/adapters stay inside their owning modules. Platform migration tooling can aggregate their schemas without making them public to other modules.

Use a module's public operations for business collaboration. Do not import another module's private table, repository or use case. Relations and joins remain module-local.

## Check dependencies

In the generated backend:

```bash
pnpm check:boundaries
```

The source checker rejects inward framework dependencies, private cross-module imports, undeclared dependencies and private re-exports. It includes type-only and literal dynamic imports. Replace computed imports with explicit dependencies.

This check enforces source structure; it is not a security sandbox for arbitrary code. Continue enforcing access in application operations.

Next: [Module communication](MODULE_COMMUNICATION.md) · [Architecture layouts](BACKEND.md#architecture-contracts)
