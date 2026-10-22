import { listPublicBillingPlans } from '../../../../lib/hash/razorpay-billing'
export async function GET(req:any,res:any){
 const currency=typeof req.query.currency_code==='string'?req.query.currency_code.toLowerCase():null
 if(currency&&!/^[a-z]{3}$/.test(currency))return res.status(400).json({message:'Invalid currency code'})
 const plans=(await listPublicBillingPlans()).filter(p=>!currency||p.currencies.includes(currency))
 res.setHeader('Cache-Control','no-store')
 res.json({plans,instruction:'One-time plans use full-payment cart checkout. Fixed-price recurring plans use the subscriptions API and do not pay for or fulfill a Medusa cart.'})
}
