import { db } from "./db"

const DEFAULT_URL = "https://www.hashforgamers.com/api/seo/indexnow"
type Logger = { warn: (message: string) => void }
// Resolving the logger must never fail a request whose work has already committed.
export function loggerFrom(container: any): Logger { try { return container?.resolve("logger") || console } catch { return console } }

// Asks the website to resubmit product pages to IndexNow so search engines recrawl them.
// Fire-and-forget: callers must not await this in a request path. The returned promise never rejects.
export function pingProducts(ids: string[], logger: Logger = console): Promise<void> {
  try {
    const secret = process.env.SEO_PING_SECRET
    const productIds = [...new Set((ids || []).filter(id => typeof id === "string" && id))]
    // The endpoint treats an empty list as "resubmit everything", so never send one.
    if (!secret || !productIds.length) return Promise.resolve()
    const url = process.env.SEO_PING_URL || DEFAULT_URL
    return fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ productIds }),
      signal: AbortSignal.timeout(5000),
    }).then(
      r => { if (!r.ok) logger.warn(`SEO ping for ${productIds.length} product(s) returned HTTP ${r.status}`) },
      e => logger.warn(`SEO ping for ${productIds.length} product(s) failed: ${e?.name || "Error"} ${e?.message || ""}`.trim())
    ).catch(() => {})
  } catch (e: any) {
    try { logger.warn(`SEO ping skipped: ${e?.message || e}`) } catch {}
    return Promise.resolve()
  }
}

// Products buyers can see: approved listing, active vendor, published and not deleted.
export async function listedProductIds(ids: string[]): Promise<string[]> {
  if (!ids.length) return []
  const { rows } = await db().query(`SELECT l.product_id FROM hash_listing l JOIN hash_vendor v ON v.id=l.vendor_id JOIN product p ON p.id=l.product_id
    WHERE l.product_id=ANY($1::text[]) AND l.approval='approved' AND v.status='active' AND p.status='published' AND p.deleted_at IS NULL`, [ids])
  return rows.map(r => r.product_id)
}

// Background helper for lifecycle hooks: ping only the given products that are currently listed.
export function pingListedProducts(ids: string[], logger: Logger = console): void {
  listedProductIds(ids).then(listed => pingProducts(listed, logger), e => logger.warn(`SEO ping lookup failed: ${e?.message || e}`)).catch(() => {})
}
