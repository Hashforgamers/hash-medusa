import { reconcileOrder } from "../lib/hash/settlements"
export default async function handler({ event, container }: any) { await reconcileOrder(container,event.data.id) }
export const config = { event: ["order.placed", "order.canceled"] }
