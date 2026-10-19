import { issueOtp } from "../../../../../../lib/hash/settlements"
export async function POST(req:any,res:any) {
 res.setHeader("Cache-Control","no-store")
 res.json(await issueOtp(req.scope,req.params.id,req.auth_context.actor_id))
}
