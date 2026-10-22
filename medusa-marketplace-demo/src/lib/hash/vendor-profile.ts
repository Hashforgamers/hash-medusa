import { z } from "zod"
const text = (max=200) => z.string().trim().max(max).default("")
export const businessSchema = z.object({
 legal_name:text(),contact_name:text(),phone:text(40),support_email:z.union([z.string().email(),z.literal("")]).default(""),
 tax_id:text(80),registration_id:text(80),address_line1:text(),address_line2:text(),city:text(100),state:text(100),postal_code:text(30),country_code:z.string().regex(/^[a-z]{2}$/).default("in"),
})
export const bankSchema = z.object({
 account_holder:z.string().trim().min(2).max(150),bank_name:z.string().trim().min(2).max(150),branch:text(150),
 account_number:z.string().trim().regex(/^[A-Za-z0-9]{4,34}$/),account_number_confirmation:z.string(),
 account_type:z.enum(["current","savings","business"]),country_code:z.string().regex(/^[a-z]{2}$/),
 currency_code:z.string().regex(/^[a-z]{3}$/),ifsc:text(11),swift:text(11),iban:text(34),routing_number:text(30),
 beneficiary_address:text(500),payout_email:z.union([z.string().email(),z.literal("")]).default(""),
}).superRefine((b,ctx)=>{
 if(b.account_number!==b.account_number_confirmation)ctx.addIssue({code:"custom",path:["account_number_confirmation"],message:"Account numbers must match"})
 if(b.country_code==='in'&&!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(b.ifsc))ctx.addIssue({code:"custom",path:["ifsc"],message:"Enter a valid 11-character IFSC"})
 if(b.country_code!=='in'&&!b.swift&&!b.iban&&!b.routing_number)ctx.addIssue({code:"custom",path:["swift"],message:"Provide SWIFT, IBAN or routing number for international payouts"})
 if(b.swift&&!/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(b.swift))ctx.addIssue({code:"custom",path:["swift"],message:"Invalid SWIFT/BIC"})
 if(b.iban&&!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(b.iban))ctx.addIssue({code:"custom",path:["iban"],message:"Invalid IBAN format"})
})
export function storedBank(bank:any){const {account_number_confirmation,...stored}=bank;return stored}
export function publicVendor(v:any,a:any){
 const {bank_details,business_details,payout_details,...rest}=v
 if(!a.superAdmin&&a.role!=='owner')return rest
 const bank=bank_details||{}
 return {...rest,business_details:business_details||{},payout_details:payout_details||'',bank_summary:bank.account_number?{
 account_holder:bank.account_holder,bank_name:bank.bank_name,account_last4:bank.account_number.slice(-4),currency_code:bank.currency_code,country_code:bank.country_code,
 }:null}
}
