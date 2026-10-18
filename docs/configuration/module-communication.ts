/**
 * Executable design sketch, not generated output or a production dependency.
 * Customers represents a Clean module; Billing is an authored Hexagonal core.
 * Names/layout are illustrative. See YAML_V2.md for the normative boundaries.
 */
export interface Principal {
  readonly id: string;
  readonly role: string;
}

export interface OperationContext {
  readonly principal: Principal | null;
}

export interface ApplicationError {
  readonly code: "validation" | "unauthorized" | "forbidden" | "not_found" | "unexpected";
  readonly message: string;
}

export type ApplicationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ApplicationError };

export interface CustomerLookupInput {
  readonly customerId: string;
}

// Public value DTO, not a repository/domain class or a Drizzle row type.
export interface CustomerValue {
  readonly id: string;
  readonly name: string;
}

export type CustomerRows = readonly {
  readonly entity: CustomerValue;
  readonly joins: Readonly<Record<string, never>>;
}[];

export interface CustomersPublic {
  getCustomer(
    input: CustomerLookupInput,
    context: OperationContext,
  ): Promise<ApplicationResult<CustomerRows>>;
}

// The consumer gets only the named public dependency declared by its import.
interface BillingDependencies {
  readonly customers: Pick<CustomersPublic, "getCustomer">;
}

type Guard = (context: OperationContext, permission: string) => ApplicationError | undefined;

interface CustomerRepository {
  findById(id: string): Promise<CustomerValue | undefined>;
}

function failure(error: ApplicationError): ApplicationResult<never> {
  return { ok: false, error };
}

function createCustomersModule(repository: CustomerRepository, guard: Guard): CustomersPublic {
  return {
    async getCustomer(input, context) {
      const denied = guard(context, "customers:read");
      if (denied) return failure(denied);
      if (
        !input ||
        typeof input.customerId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          input.customerId,
        ) ||
        Object.keys(input).some((key) => key !== "customerId")
      ) {
        return failure({ code: "validation", message: "Supply one valid customerId UUID." });
      }
      try {
        const value = await repository.findById(input.customerId);
        return {
          ok: true,
          value: value ? [{ entity: { id: value.id, name: value.name }, joins: {} }] : [],
        };
      } catch {
        return failure({ code: "unexpected", message: "Customer lookup failed." });
      }
    },
  };
}

function createBillingModule(dependencies: BillingDependencies, guard: Guard) {
  return {
    // Authored application logic. YAML imports do not generate this workflow.
    async previewForCustomer(
      input: CustomerLookupInput,
      context: OperationContext,
    ): Promise<ApplicationResult<{ readonly customer: CustomerValue }>> {
      const denied = guard(context, "invoices:read");
      if (denied) return failure(denied);
      const result = await dependencies.customers.getCustomer(input, context);
      if (!result.ok) return result;
      const first = result.value[0];
      if (!first) return failure({ code: "not_found", message: "Customer is unavailable." });
      return { ok: true, value: { customer: first.entity } };
    },
  };
}

/**
 * Trusted composition boundary. Only this server-owned closure may issue context.
 * In production verifySession invokes Better Auth; never accept Principal from JSON.
 * The injected repository stays private to Customers and may use its own adapter.
 */
export function composeExampleBackend(
  verifySession: (cookieHeader: string | null) => Promise<Principal | null>,
  repository: CustomerRepository,
) {
  const issuedContexts = new WeakSet<OperationContext>();
  const grants: Readonly<Record<string, readonly string[]>> = {
    admin: ["*"],
    viewer: ["customers:read"],
    accountant: ["invoices:read"],
  };
  const guard: Guard = (context, permission) => {
    if (!issuedContexts.has(context) || !context.principal) {
      return { code: "unauthorized", message: "A verified session is required." };
    }
    const allowed = grants[context.principal.role] ?? [];
    if (!allowed.includes(permission) && !allowed.includes("*")) {
      return { code: "forbidden", message: "Required permission is missing." };
    }
    return undefined;
  };

  const customers = createCustomersModule(repository, guard);
  const billing = createBillingModule({ customers: { getCustomer: customers.getCustomer } }, guard);

  return {
    customers,
    billing,
    async previewFromSession(input: CustomerLookupInput, cookieHeader: string | null) {
      try {
        const session = await verifySession(cookieHeader);
        const context: OperationContext = Object.freeze({
          principal: session ? Object.freeze({ id: session.id, role: session.role }) : null,
        });
        issuedContexts.add(context);
        return await billing.previewForCustomer(input, context);
      } catch {
        return failure({ code: "unexpected", message: "Session or application is unavailable." });
      }
    },
  };
}
