import type { AccessGuard } from "../../../platform/application/access.js";
import type {
  ApplicationResult,
  OperationContext,
} from "../../../platform/application/contracts.js";
import type { GetCustomerInput } from "../../customers/index.js";
import type { ModuleDependencies } from "./ports/module-dependencies.js";

/** Authored acceptance workflow, copied into billing/application after generation.
 * YAML imports generate contracts and wiring, not this lookup/not-found business decision. */
export class PreviewCustomer {
  constructor(
    private readonly dependencies: ModuleDependencies,
    private readonly authorize: AccessGuard,
  ) {}
  async execute(
    input: GetCustomerInput,
    context: OperationContext,
  ): Promise<ApplicationResult<{ customer: string }>> {
    const denied = this.authorize(context, {
      authenticated: true,
      roles: [],
      permissions: ["invoices:read"],
    });
    if (denied) return { ok: false, error: denied };
    const result = await this.dependencies.customers.getCustomer(input, context);
    if (!result.ok) return result;
    const customer = result.value[0];
    if (!customer)
      return { ok: false, error: { code: "not_found", message: "Customer is unavailable." } };
    return { ok: true, value: { customer: customer.entity.name } };
  }
}
