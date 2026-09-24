import type { IrEntity, IrField } from '../../../core/ir/types.js';

export function generateEntityRouterCode(entity: IrEntity): string {
  const entityName = entity.name;
  const tableName = entity.tableName;

  return `import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, isNull, desc } from 'drizzle-orm';
import { ${tableName} } from '../../db/schema.js';
import type { DatabaseInstance } from '../../db/index.js';
import { NotFoundError } from '../../common/errors.js';

${generateZodValidationSchemas(entity)}

export function create${entityName}Router(db: DatabaseInstance) {
  const router = new Hono();

  // List all
  router.get('/', async (c) => {
    const page = Number(c.req.query('page') || '1');
    const limit = Math.min(Number(c.req.query('limit') || '20'), 100);
    const offset = (page - 1) * limit;

    const items = await db
      .select()
      .from(${tableName})
      ${entity.softDelete ? `.where(isNull(${tableName}.deletedAt))` : ''}
      .limit(limit)
      .offset(offset);

    return c.json({
      data: items,
      page,
      limit,
    });
  });

  // Get by ID
  router.get('/:id', async (c) => {
    const id = c.req.param('id');
    const [record] = await db
      .select()
      .from(${tableName})
      .where(eq(${tableName}.id, id))
      .limit(1);

    if (!record ${entity.softDelete ? '|| record.deletedAt !== null' : ''}) {
      throw new NotFoundError('${entityName}', id);
    }

    return c.json({ data: record });
  });

  // Create
  router.post('/', zValidator('json', Create${entityName}Schema), async (c) => {
    const payload = c.req.valid('json');
    const [newRecord] = await db
      .insert(${tableName})
      .values(payload as any)
      .returning();

    return c.json({ data: newRecord }, 201);
  });

  // Update
  router.put('/:id', zValidator('json', Update${entityName}Schema), async (c) => {
    const id = c.req.param('id');
    const payload = c.req.valid('json');

    const [existing] = await db
      .select()
      .from(${tableName})
      .where(eq(${tableName}.id, id))
      .limit(1);

    if (!existing ${entity.softDelete ? '|| existing.deletedAt !== null' : ''}) {
      throw new NotFoundError('${entityName}', id);
    }

    const [updatedRecord] = await db
      .update(${tableName})
      .set({ ...payload, updatedAt: new Date() } as any)
      .where(eq(${tableName}.id, id))
      .returning();

    return c.json({ data: updatedRecord });
  });

  // Delete
  router.delete('/:id', async (c) => {
    const id = c.req.param('id');
    const [existing] = await db
      .select()
      .from(${tableName})
      .where(eq(${tableName}.id, id))
      .limit(1);

    if (!existing ${entity.softDelete ? '|| existing.deletedAt !== null' : ''}) {
      throw new NotFoundError('${entityName}', id);
    }

    ${
      entity.softDelete
        ? `await db.update(${tableName}).set({ deletedAt: new Date() } as any).where(eq(${tableName}.id, id));`
        : `await db.delete(${tableName}).where(eq(${tableName}.id, id));`
    }

    return c.json({ success: true, message: '${entityName} deleted successfully' });
  });

  return router;
}
`;
}

function generateZodValidationSchemas(entity: IrEntity): string {
  const fields = Object.values(entity.fields).filter((f) => !f.isPrimaryKey && !f.isSystemAudit);

  const createProps = fields.map((f) => `  ${f.name}: ${mapFieldToZod(f)},`).join('\n');
  const updateProps = fields.map((f) => `  ${f.name}: ${mapFieldToZod(f)}.optional(),`).join('\n');

  return `export const Create${entity.name}Schema = z.object({
${createProps}
});

export const Update${entity.name}Schema = z.object({
${updateProps}
});`;
}

function mapFieldToZod(field: IrField): string {
  let schema = 'z.string()';
  switch (field.type) {
    case 'string':
      schema = 'z.string()';
      break;
    case 'number':
      schema = 'z.number()';
      break;
    case 'boolean':
      schema = 'z.boolean()';
      break;
    case 'date':
      schema = 'z.coerce.date()';
      break;
    case 'uuid':
      schema = 'z.string().uuid()';
      break;
    case 'json':
      schema = 'z.record(z.unknown())';
      break;
    case 'enum':
      schema = 'z.string()';
      break;
    default:
      schema = 'z.string()';
  }

  if (!field.required) {
    schema += '.optional().nullable()';
  }
  return schema;
}
