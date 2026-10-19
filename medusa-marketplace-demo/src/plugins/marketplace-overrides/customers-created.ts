// src/plugins/marketplace-overrides/customers-created.ts
import { createCustomersWorkflow } from "@medusajs/medusa/core-flows"
import type { CustomerDTO } from "@medusajs/framework/types"

createCustomersWorkflow.hooks.customersCreated(
  // The handler receives the hook input and utilities
  async ({ customers }: { customers: CustomerDTO[] }, { container }) => {
    const logger = container.resolve("logger")
    const query = container.resolve("query")

    // Example: log and read customers using the query interface
    logger.info(`customersCreated override invoked for ${customers.length} customer(s)`) // [2]

    // Do safe work without loggedInUser; e.g., tag or sync using only payload
    for (const c of customers) {
      // Example read/write using the query API (adjust to real needs)
      // const { data } = await query.graph({
      //   entity: "customer",
      //   fields: ["id", "email", "metadata"],
      //   filters: { id: c.id },
      // })
      // Optionally perform actions with c.id, c.email, etc.
    }
  }
)
