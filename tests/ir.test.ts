import { describe, expect, it } from 'vitest';
import { buildNordixIr } from '../src/core/ir/builder.js';
import { parseNordixConfig } from '../src/core/schema/parser.js';

describe('Nordix-IR Builder', () => {
  it('should normalize entities, inject PK and audit fields, and sort topologically', () => {
    const yaml = `
name: store-api
entities:
  OrderItem:
    fields:
      quantity:
        type: number
    relations:
      order:
        type: many-to-one
        target: Order
  Order:
    fields:
      total:
        type: number
    relations:
      customer:
        type: many-to-one
        target: Customer
  Customer:
    fields:
      name:
        type: string
`;
    const parseRes = parseNordixConfig(yaml);
    expect(parseRes.success).toBe(true);

    const ir = buildNordixIr(parseRes.data!);
    expect(ir.projectName).toBe('store-api');

    // Verify Customer fields
    const customer = ir.entities.Customer;
    expect(customer).toBeDefined();
    expect(customer?.primaryKey.name).toBe('id');
    expect(customer?.fields.createdAt).toBeDefined();
    expect(customer?.fields.updatedAt).toBeDefined();
    expect(customer?.fields.deletedAt).toBeDefined(); // softDelete: true by default

    // Verify OrderItem -> Order -> Customer topological order
    // Customer must be before Order, and Order must be before OrderItem
    const customerIndex = ir.sortedEntityNames.indexOf('Customer');
    const orderIndex = ir.sortedEntityNames.indexOf('Order');
    const orderItemIndex = ir.sortedEntityNames.indexOf('OrderItem');

    expect(customerIndex).toBeLessThan(orderIndex);
    expect(orderIndex).toBeLessThan(orderItemIndex);

    // Verify Foreign Key injected in Order
    const order = ir.entities.Order;
    expect(order?.fields.customerId).toBeDefined();
    expect(order?.fields.customerId?.columnName).toBe('customer_id');

    // Verify CRUD use cases generated
    expect(ir.useCases.some((uc) => uc.name === 'CreateCustomer')).toBe(true);
    expect(ir.useCases.some((uc) => uc.name === 'ListOrders')).toBe(true);
    expect(ir.useCases.some((uc) => uc.name === 'DeleteOrderItem')).toBe(true);

    // Verify Endpoints generated
    expect(ir.endpoints.some((ep) => ep.path === '/customers' && ep.method === 'GET')).toBe(true);
    expect(ir.endpoints.some((ep) => ep.path === '/orders/:id' && ep.method === 'DELETE')).toBe(
      true,
    );
  });
});
