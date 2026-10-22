# Forms and API clients

Connected backend endpoints generate typed clients, TanStack Query hooks, API Explorer entries and supported entity screen actions.

## Which actions appear?

| Declared operation | Generated UI behavior |
| --- | --- |
| Unambiguous list | Entity list with loading, empty and error states |
| Create use case | Form with writable fields and creation defaults |
| Update use case with known identifier binding | Edit action and partial-update form |
| Delete with known identifier binding | Delete action |
| Filters and pagination | Controls matching the endpoint contract |

Required extra context or several candidate operations can make an automatic action ambiguous. In that case it is omitted with a warning; the operation remains available through the typed client and API Explorer. Author the specific screen flow you need rather than relying on guessed bindings.

## Validation and values

Forms use operation input definitions. They validate string constraints, integers/decimals, UUIDs, enums, JSON and dates before sending a request. Nullable inputs have an explicit null control; omission is not the same as null.

Date controls use browser-local time and send UTC ISO strings. JSON is parsed as JSON, preserving scalar strings; a nonnullable JSON field rejects top-level null. Editing includes only writable fields. Generated IDs and clock defaults remain server-owned.

Filters apply after validation and reset pagination when changed. Cancellation signals reach fetch. JSON query values are encoded JSON text; array values use repeated parameters.

## Permissions and cache behavior

Protected reads wait for verified identity and sufficient effective grants. Controls use current IAM presentation data, while the backend remains authoritative. Access changes can therefore deny a request even if an old control is still visible.

Query keys include backend, module, operation, input and identity scope. Mutations invalidate related declared reads on the same backend. Switching account, role or grants cancels/clears the previous QueryClient, preventing old data or late responses from entering the next account's cache.

Use TanStack Query for remote state. Zustand holds UI state, not remote records or a second session store.

Next: [Endpoints](../configuration/ENDPOINTS.md) · [Frontend](FRONTEND.md)
