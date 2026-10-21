# Entities

An entity describes data owned by a backend module. Declare it under root `entities` and include its name in exactly one module's `entities` list.

This fragment defines a product:

```yaml
enums:
  ProductStatus: [draft, active, archived]
entities:
  Product:
    backend: api
    fields:
      name: { type: string, minLength: 1, maxLength: 200 }
      price: { type: number, format: decimal, precision: 10, scale: 2 }
      stock: { type: number, format: integer, default: 0 }
      status: { type: enum, enumName: ProductStatus, default: draft }
      publishedAt: { type: date, required: false }
      metadata: { type: json, required: false }
    timestamps: { createdAt: true, updatedAt: true }
    softDelete: timestamp
```

Entity names are unique across the project, even across different backends. Fields and relations share the entity's member namespace.

## Field types

| Type | Options and behavior |
| --- | --- |
| `string` | Optional `minLength`, `maxLength` |
| `number` | `format`: `integer`, `float` or `decimal`; decimal supports `precision` and `scale` |
| `boolean` | `true` or `false` |
| `date` | Application `Date`; UTC ISO string in HTTP responses |
| `uuid` | Valid UUID value |
| `json` | JSON-compatible value; nested null is supported |
| `enum` | Requires `enumName` referencing a root enum |

All fields accept `description`, `required`, `unique` and `default`. `required` defaults to `true`; `unique` defaults to `false`. `required: false` allows stored null. Omission and explicit null have different write semantics.

Numbers use JavaScript numbers, including decimals. Do not assume exact financial decimal arithmetic. Decimal defaults are precision 10, scale 2; an omitted numeric format is float unless precision requests decimal.

## Defaults and writes

Literal defaults must match the field's type and constraints. A date can use a fixed timezone-bearing ISO string or a trusted current-time default:

```yaml
fields:
  receivedAt: { type: date, default: { kind: now } }
```

On create, required fields without defaults must be supplied. Missing optional fields use their default or null. On update, omitted properties keep their stored values; explicit null clears only a nullable field. Creation defaults are not applied again. An empty update is rejected.

Unknown input properties are rejected. Generated identity/timestamp/deletion fields are server-owned and cannot be supplied as ordinary writable fields.

## Generated fields

Every entity gets a required unique UUID `id`. Do not redeclare it.

| Setting | Generated behavior |
| --- | --- |
| `timestamps.createdAt: true` | Set `createdAt` on creation |
| `timestamps.updatedAt: true` | Set `updatedAt` on creation and successful updates/soft deletion |
| `softDelete: false` | Delete records physically; this is the default |
| `softDelete: boolean` | Add `isDeleted`, initially false |
| `softDelete: timestamp` | Add nullable `deletedAt` |

Generated queries exclude soft-deleted rows. An entity does not automatically get HTTP routes: add [endpoints](ENDPOINTS.md) to expose operations.

Next: [Relations and indexes](RELATIONS_INDEXES.md)
