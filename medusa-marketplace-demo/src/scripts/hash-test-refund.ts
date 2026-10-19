import { readFileSync } from "fs"
import { Modules } from "@medusajs/framework/utils"
export default async function testRefund({container}:any) {
 const host=new URL(process.env.DATABASE_URL!).hostname
 if(!["localhost","127.0.0.1"].includes(host))throw new Error("Local fixture database only")
 const fixture=JSON.parse(readFileSync(".local/hash-order-test.json","utf8"))
 // Simulates the provider's confirmed partial refund at the payment-module boundary.
 await container.resolve(Modules.PAYMENT).refundPayment({payment_id:fixture.payment_id,amount:800,note:"QA fixture refund — no real funds"})
}
