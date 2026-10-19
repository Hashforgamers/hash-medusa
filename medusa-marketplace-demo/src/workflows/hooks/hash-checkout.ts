import { addToCartWorkflow, createCartWorkflow, completeCartWorkflow } from "@medusajs/medusa/core-flows"
import { validateItems } from "../../lib/hash/marketplace"
addToCartWorkflow.hooks.validate(async ({input,cart}: any,{container}) => {
  const {data:[current]} = await container.resolve("query").graph({entity:"cart",fields:["id","currency_code","items.variant_id"],filters:{id:cart.id}})
  await validateItems(container,[...(current.items || []),...(input.items || [])],current.currency_code)
})
createCartWorkflow.hooks.validate(async ({cart}: any,{container}) => {
  await validateItems(container,cart.items || [],cart.currency_code)
})
completeCartWorkflow.hooks.validate(async ({cart}: any,{container}) => {
  if (!cart.customer_id) throw new Error("Sign in before checkout so completion OTP can be securely delivered")
  await validateItems(container,cart.items || [],cart.currency_code)
})
