import { z } from 'zod'
import { fail } from './access'

const key=z.string().regex(/^[a-z][a-z0-9_]{0,39}$/)
const label=z.string().trim().min(1).max(100)
export const definition=z.object({
 key,label,type:z.enum(['text','number','boolean','select','multi']),
 choices:z.array(label).max(100).default([]),unit:z.string().trim().max(30).default(''),
 required:z.boolean().default(false),filterable:z.boolean().default(false),variant:z.boolean().default(false)
})
export const definitions=z.array(definition).max(60).superRefine((items,ctx)=>{
 const seen=new Set<string>()
 for(const d of items){
  if(seen.has(d.key)||new Set(d.choices).size!==d.choices.length||(['multi','select'].includes(d.type)&&!d.choices.length)||(d.variant&&!['select','multi'].includes(d.type)))ctx.addIssue({code:'custom',message:'Use unique keys and choices. SKU options require a choice field: '+d.label})
  seen.add(d.key)
 }
})
type Spec=z.infer<typeof definition>
const rows=[
 ['Brand','text','Logitech|Razer|Redragon|Cosmic Byte'],['Model','text',''],['Keyboard Type','select','Mechanical|Membrane|Optical|Magnetic'],
 ['Connectivity','multi','Wired|Bluetooth|2.4GHz Wireless'],['Keyboard Layout','select','Full Size (100%)|TKL (80%)|75%|65%|60%'],
 ['Switch Type','select','Red|Blue|Brown|Black|Optical|Magnetic'],['Switch Brand','text','Cherry MX|Gateron|Outemu|Kailh'],
 ['Backlighting','select','RGB|Single Color|No Backlight'],['Keycap Material','select','ABS|PBT'],['Hot-Swappable','boolean',''],
 ['Anti-Ghosting','boolean',''],['N-Key Rollover','boolean',''],['Polling Rate','select','125Hz|500Hz|1000Hz|8000Hz'],
 ['Compatibility','multi','Windows|macOS|Linux|Android'],['Interface','select','USB-A|USB-C|Bluetooth|2.4GHz'],
 ['Battery Capacity','number','','mAh'],['Cable Length','number','','m'],['Warranty','select','6 Months|1 Year|2 Years|3 Years'],
 ['Weight','number','','g'],['Color','multi','Black|White|Grey|Pink|Other']
]
const palette = 'Black|Matte Black|Gloss Black|Graphite|Charcoal|Gunmetal|Space Grey|Grey|Slate Grey|Ash Grey|Silver|Chrome|White|Pearl White|Off White|Ivory|Cream|Beige|Sand|Champagne|Gold|Rose Gold|Bronze|Copper|Brown|Tan|Mocha|Chocolate|Burgundy|Maroon|Red|Crimson|Scarlet|Cherry Red|Coral|Salmon|Peach|Orange|Burnt Orange|Amber|Yellow|Lemon|Mustard|Lime|Neon Green|Green|Forest Green|Olive|Sage|Mint|Emerald|Jade|Teal|Turquoise|Aqua|Cyan|Sky Blue|Ice Blue|Blue|Cobalt Blue|Royal Blue|Navy Blue|Midnight Blue|Indigo|Violet|Purple|Lavender|Lilac|Plum|Magenta|Fuchsia|Pink|Blush Pink|Hot Pink|Pastel Pink|Clear|Frosted|Smoke|Rainbow|Multicolor|Black / White|Red / Black'.split('|')
const customizableColor=(d:Spec)=>d.key==='color'&&['multi','select'].includes(d.type)
function colorSuggestions(d:Spec){
 return customizableColor(d)?{...d,allow_custom:true,suggestions:[...new Set([...d.choices,...palette])]}:d
}
function validChoice(d:Spec,value:unknown){
 return d.choices.includes(value as string)||(customizableColor(d)&&typeof value==='string'&&value.trim().length>0&&value.length<=100)
}
export function categorySpecs(c:any):Spec[]{
 if(Array.isArray(c.metadata?.hash_specs))return c.metadata.hash_specs.map(colorSuggestions)
 const keyboard=['keyboard','keyboards'].includes(c.handle)
 const template=keyboard?rows:['mouse','mice'].includes(c.handle)?rows.filter(r=>['Brand','Model','Color','Connectivity'].includes(r[0])):[]
 return template.map(([name,type,values,unit])=>definition.parse({key:name.toLowerCase().replace(/[^a-z0-9]+/g,'_'),label:name,type,choices:values?values.split('|'):[],unit:unit||'',required:name==='Brand',filterable:['Brand','Keyboard Type','Connectivity','Keyboard Layout','Switch Type','Backlighting','Color'].includes(name),variant:['Color','Switch Type','Keyboard Layout','Connectivity'].includes(name)})).map(colorSuggestions)
}
export const specValues=z.record(z.string(),z.union([label,z.number().finite(),z.boolean(),z.array(label).min(1).max(100)]))
export const skuRows=z.array(z.object({id:z.string().optional(),sku:label,options:z.record(key,label),price_inr:z.number().positive().max(10000000).multipleOf(.01),stock:z.number().int().min(0).max(10000000)})).max(100)
export function validateSpecs(categories:any[],values:any,variants:z.infer<typeof skuRows>){
 const fields=new Map<string,Spec>()
 for(const c of categories)for(const d of c.specifications){
  const existing=fields.get(d.key)
  if(existing&&(existing.type!==d.type||existing.unit!==d.unit||(!customizableColor(d)&&JSON.stringify(existing.choices)!==JSON.stringify(d.choices))))fail('Selected categories have conflicting definitions for '+d.label)
  fields.set(d.key,{...d,required:d.required||!!existing?.required})
 }
 const axes=Object.keys(variants[0]?.options||{}).sort()
 const combos=new Set(),skus=new Set()
 for(const row of variants){
  if(!axes.length||JSON.stringify(Object.keys(row.options).sort())!==JSON.stringify(axes))fail('Use the same options for every SKU')
  for(const k of axes){const d=fields.get(k);if(!d?.variant||!validChoice(d,row.options[k]))fail('Invalid SKU option: '+k)}
  const combo=JSON.stringify(axes.map(k=>row.options[k]))
  if(combos.has(combo)||skus.has(row.sku))fail('Each SKU and option combination must be unique')
  combos.add(combo);skus.add(row.sku)
 }
 for(const k of Object.keys(values))if(!fields.has(k)||axes.includes(k))fail('Unexpected product specification: '+k)
 for(const [k,d] of fields){
  const v=values[k]
  if(v==null){if(d.required&&!axes.includes(k))fail('Enter '+d.label);continue}
  const valid=d.type==='multi'?Array.isArray(v)&&v.every(x=>validChoice(d,x)):d.type==='select'?validChoice(d,v):typeof v===({text:'string',boolean:'boolean',number:'number'}[d.type])
  if(!valid)fail('Invalid value for '+d.label)
 }
}
