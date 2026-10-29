# Module communication

Modules call each other through typed application contracts in the same backend process. No HTTP loopback or event bus is involved.

## Export and import an operation

This backend fragment assumes `getCustomer` is a declared endpoint operation owned by Customers:

```yaml
modules:
  customers:
    architecture: clean
    entities: [Customer]
    exports: [getCustomer]
  billing:
    architecture: hexagonal
    entities: [Invoice]
    imports:
      customers: [getCustomer]
```

The composition root supplies Billing with only the declared Customer operations. Write the business call explicitly in Billing's application logic; an import does not automatically check customers or create an invoicing workflow.

Imports are backend-local and must form an acyclic graph. They cannot reference unknown, private or differently owned operations. YAML exports currently refer to endpoint-backed operations; an internal-only exported YAML operation cannot be declared independently. Ordinary private application functions remain editable code.

## Public contracts

Inputs are flat application values, with a separate `OperationContext` argument. Outputs use application DTOs, including `Date` values. Do not expose Hono requests, HTTP responses, Drizzle tables or private repositories through a module API.

Operations return `ApplicationResult<T>`:

| Failure | Meaning | HTTP mapping |
| --- | --- | --- |
| `validation` | Invalid input or business constraint | 400 |
| `unauthorized` | Missing/invalid verified identity | 401 |
| `forbidden` | Insufficient permission | 403 |
| `not_found` | Authored logic requires a missing resource | 404 |
| `conflict` | Known uniqueness/state conflict | 409 |
| `unexpected` | Contained internal failure | 500 |

A normal query without matches returns successful `[]`. Handle a callee's failure explicitly; do not silently turn it into success. Keep deliberate failure messages safe for users.

## Authorization and consistency

Pass the request's issued trusted context unchanged. The callee checks its own permissions even if the caller already passed its guard. Arbitrary JSON principals, changed roles and expired/unissued contexts cannot establish authority. Never retain a context after its request ends.

Calls do not create a shared transaction. If one operation writes before a later call fails, that write stays committed. Design recovery or explicit transaction handling in your application when required; there is no automatic rollback, outbox or distributed transaction.

A [TypeScript communication example](../configuration/module-communication.ts) shows dependency injection and result handling without framework coupling.
