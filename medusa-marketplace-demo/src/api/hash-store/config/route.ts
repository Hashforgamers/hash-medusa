import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

// Outside /store: bootstrapping must work without a publishable key.
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Cache-Control", "no-store")
  const [{ data: keys }, regions, stores] = await Promise.all([
    req.scope.resolve("query").graph({
      entity: "api_key",
      fields: ["type", "title", "token", "revoked_at", "sales_channels.id", "sales_channels.name", "sales_channels.is_disabled"],
      filters: { type: "publishable", title: "HFG Frontend" },
    }),
    req.scope.resolve(Modules.REGION).listRegions({}, { relations: ["countries"], take: 500 }),
    req.scope.resolve(Modules.STORE).listStores(),
  ])
  const candidates = keys.filter(k => k.type === "publishable" && k.title === "HFG Frontend" && !k.revoked_at && k.token?.startsWith("pk_") && k.sales_channels?.some(c => c.name === "Hash Marketplace" && !c.is_disabled))
  const india = regions.filter(r => r.currency_code === "inr" && r.countries?.some(c => c.iso_2 === "in"))
  if (candidates.length !== 1 || india.length !== 1) {
    return res.status(503).json({ code: "store_configuration_unavailable", message: "Store configuration is unavailable. Please try again later." })
  }
  const channels = candidates[0].sales_channels.filter(c => c.name === "Hash Marketplace" && !c.is_disabled)
  if (channels.length !== 1) return res.status(503).json({ code: "store_configuration_unavailable", message: "Store configuration is unavailable. Please try again later." })
  const details=stores[0]?.metadata?.hash_public_details||{}
  return res.json({
    version: 1,
    store: {name:stores[0]?.name||'Hash Marketplace',support_email:details.support_email||'',support_phone:details.support_phone||'',returns_policy:details.returns_policy||'',shipping_policy:details.shipping_policy||''},
    publishable_api_key: candidates[0].token,
    region_id: india[0].id,
    sales_channel_id: channels[0].id,
    currency_code: "inr",
    country_code: "in",
    markets: regions.map(r => ({ region_id:r.id,name:r.name,currency_code:r.currency_code,countries:(r.countries||[]).map(c=>c.iso_2) })),
  })
}
