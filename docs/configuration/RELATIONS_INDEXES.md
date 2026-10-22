# Relations and indexes

Relations create database links between entities in the same backend module. Indexes help PostgreSQL find rows for your actual query patterns.

## To-one and inverse relations

This fragment belongs under root `entities`. Both entities must be assigned to the same module:

```yaml
Customer:
  backend: api
  fields:
    name: { type: string }
  relations:
    orders:
      type: one-to-many
      target: Order
      foreignKey: customerId
Order:
  backend: api
  fields:
    reference: { type: string, unique: true }
  relations:
    customer:
      type: many-to-one
      target: Customer
      foreignKey: customerId
      required: true
      onDelete: restrict
```

`Order.customer` owns the UUID foreign key. `Customer.orders` is its inverse and must match exactly one compatible owning relation. Configure nullability and deletion on the owning side, not the inverse.

| Relation | Behavior |
| --- | --- |
| `many-to-one` | Local foreign key references the target ID |
| `one-to-one` | Local foreign key is also unique |
| `one-to-many` | Inverse of a target-side to-one relation |
| `many-to-many` | Recognized by configuration, but generation is unsupported |

For an association with additional fields, declare an explicit entity with two to-one relations. Stored foreign-key cycles, including self-cycles, are rejected.

If `foreignKey` is omitted, the default to-one name is the lowercased target name plus `_id`. An explicitly declared FK field must match the relation's type, nullability and uniqueness.

## Deletion behavior

`onDelete` accepts `no-action` (default), `restrict`, `cascade` or `set-null`. Required relations cannot use `set-null`. Choose cascades deliberately: deleting a parent may delete related data.

## Cross-module references

Relations and SQL joins cannot cross module ownership. Store a scalar UUID when you need to refer conceptually to another module's record, then use its [public operations](../guides/MODULE_COMMUNICATION.md) for business checks.

A scalar UUID alone creates no foreign key, existence check or automatic module call.

## Indexes

Add indexes to an entity using exact field names:

```yaml
indexes:
  - fields: [status]
  - fields: [customerId, createdAt]
```

Each index is a nonunique B-tree with 1–32 distinct scalar columns in the declared order. You can reference enabled generated fields and owning foreign keys. Drizzle migrations include the indexes.

Duplicate ordered lists are rejected, as are single-column indexes already provided by `id` or `unique`. Reversing a compound index's columns creates a different index. Relations and business fields do not receive inferred indexes.

Custom names, compound unique declarations, partial/expression indexes and specialized methods are not YAML options. Add those directly to the generated schema when needed. Measure query performance; indexes add write/storage cost and large-table migrations need planning.

Next: [Endpoints and joins](ENDPOINTS.md)
