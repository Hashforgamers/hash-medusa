import { z } from 'zod'

export const promotionDefinition = z.object({
 code:z.string().trim().transform(s=>s.toUpperCase().replace(/\s+/g,'-')).pipe(z.string().regex(/^[A-Z0-9][A-Z0-9_-]{2,49}$/, 'Use 3–50 letters, numbers, underscores or hyphens')),
 discount_type:z.enum(['percentage','fixed']),
 value:z.number().positive().max(1000000),
 currency_code:z.string().regex(/^[a-z]{3}$/),
 automatic:z.boolean().default(false),
 product_ids:z.array(z.string().min(1).max(200)).max(500).default([]),
 starts_at:z.string().datetime().nullable().default(null),
 ends_at:z.string().datetime().nullable().default(null),
 usage_limit:z.number().int().positive().max(10000000).nullable().default(null),
}).strict().superRefine((b,ctx)=>{
 if(b.discount_type==='percentage'&&b.value>100)ctx.addIssue({code:'custom',path:['value'],message:'Percentage cannot exceed 100'})
 if(b.discount_type==='fixed'&&Math.abs(b.value*100-Math.round(b.value*100))>0.000001)ctx.addIssue({code:'custom',path:['value'],message:'Use at most two decimal places'})
 if(b.starts_at&&b.ends_at&&Date.parse(b.ends_at)<=Date.parse(b.starts_at))ctx.addIssue({code:'custom',path:['ends_at'],message:'End must be after start'})
})

// Native Medusa amounts are major currency units, never Razorpay paise.
export function promotionInput(b:z.infer<typeof promotionDefinition>):any {
 return {code:b.code,type:'standard',status:'draft',is_automatic:b.automatic,
  rules:[{attribute:'currency_code',operator:'eq',values:[b.currency_code]}],
  application_method:{type:b.discount_type,value:b.value,currency_code:b.currency_code,target_type:'items',allocation:'across',
   target_rules:b.product_ids.length?[{attribute:'product_id',operator:'in',values:[...new Set(b.product_ids)]}]:[]},
  campaign:{name:b.code,campaign_identifier:'hash-'+b.code,starts_at:b.starts_at?new Date(b.starts_at):null,ends_at:b.ends_at?new Date(b.ends_at):null,
   ...(b.usage_limit?{budget:{type:'usage',limit:b.usage_limit}}:{})}}
}
