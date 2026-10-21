import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

// Outside /store: bootstrapping must work without a publishable key.
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Cache-Control", "no-store")
  const [{ data: keys }, regions] = await Promise.all([
    req.scope.resolve("query").graph({
      entity: "api_key",
      fields: ["type", "title", "token", "revoked_at", "sales_channels.id", "sales_channels.name", "sales_channels.is_disabled"],
      filters: { type: "publishable", title: "HFG Frontend" },
    }),
    req.scope.resolve(Modules.REGION).listRegions({ currency_code: "inr" }, { relations: ["countries"] }),
  ])
  const candidates = keys.filter(k => k.type === "publishable" && k.title === "HFG Frontend" && !k.revoked_at && k.token?.startsWith("pk_") && k.sales_channels?.some(c => c.name === "Hash Marketplace" && !c.is_disabled))
  const india = regions.filter(r => r.currency_code === "inr" && r.countries?.some(c => c.iso_2 === "in"))
  if (candidates.length !== 1 || india.length !== 1) {
    return res.status(503).json({ code: "store_configuration_unavailable", message: "Store configuration is unavailable. Please try again later." })
  }
  const channels = candidates[0].sales_channels.filter(c => c.name === "Hash Marketplace" && !c.is_disabled)
  if (channels.length !== 1) return res.status(503).json({ code: "store_configuration_unavailable", message: "Store configuration is unavailable. Please try again later." })
  return res.json({
    version: 1,
    publishable_api_key: candidates[0].token,
    region_id: india[0].id,
    sales_channel_id: channels[0].id,
    currency_code: "inr",
    country_code: "in",
  })
}
