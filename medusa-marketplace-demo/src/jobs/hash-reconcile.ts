import { reconcileAll } from "../lib/hash/settlements"
export default async function reconcile(container: any) { await reconcileAll(container) }
export const config = { name: "hash-reconcile", schedule: "* * * * *" }
