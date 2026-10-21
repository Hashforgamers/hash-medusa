import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { actor, requireHash } from "../../../../lib/hash/access"

/** Only explicit public storefront configuration leaves this endpoint. */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  requireHash(await actor(req))
  const [{ data: keys }, regions] = await Promise.all([
    req.scope.resolve("query").graph({
      entity: "api_key",
      fields: ["id", "title", "type", "token", "revoked_at", "sales_channels.id", "sales_channels.name"],
      filters: { type: "publishable", title: "HFG Frontend" },
    }),
    req.scope.resolve(Modules.REGION).listRegions({ currency_code: "inr" }, { relations: ["countries"] }),
  ])
  res.setHeader("Cache-Control", "no-store")
  res.json({
    publishable_keys: keys.filter(k => k.type === "publishable" && !k.revoked_at).map(k => ({
      id: k.id, title: k.title, token: k.token,
      sales_channels: (k.sales_channels || []).map(c => ({ id: c.id, name: c.name })),
    })),
    regions: regions.filter(r => r.countries?.some(c => c.iso_2 === "in")).map(r => ({ id: r.id, name: r.name, currency_code: r.currency_code })),
  })
}
