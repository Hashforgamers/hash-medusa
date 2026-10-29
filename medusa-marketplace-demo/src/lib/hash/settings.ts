import { normalizeState } from './geography'
import { Modules } from "@medusajs/framework/utils"
import { createRegionsWorkflow, updateRegionsWorkflow, updateStoresWorkflow, createStockLocationsWorkflow, updateStockLocationsWorkflow, linkSalesChannelsToStockLocationWorkflow, createShippingOptionsWorkflow, updateShippingOptionsWorkflow } from "@medusajs/medusa/core-flows"
import { z } from "zod"
import { db, audit, transaction } from "./db"
import { fail, requireHash } from "./access"
import { currencyDigits } from "./policy"
const id=z.string().min(1).max(200), name=z.string().trim().min(2).max(150), code=z.string().regex(/^[a-z]{3}$/)
export const settingsCommand=z.discriminatedUnion('action',[
 z.object({action:z.literal('store'),name,support_email:z.union([z.string().email(),z.literal('')]),support_phone:z.string().max(40),returns_policy:z.string().max(5000),shipping_policy:z.string().max(5000)}),
 z.object({action:z.literal('add_currency'),currency_code:code}),
 z.object({action:z.literal('region'),id:id.optional(),name,currency_code:code,countries:z.array(z.string().regex(/^[a-z]{2}$/)).min(1).max(250),payment_providers:z.array(id).min(1).max(20),automatic_taxes:z.boolean().default(true)}),
 z.object({action:z.literal('location'),id:id.optional(),name,address:z.object({address_1:z.string().trim().min(2).max(200),address_2:z.string().max(200).default(''),city:z.string().trim().min(1).max(100),province:z.string().max(100).default(''),postal_code:z.string().max(30).default(''),country_code:z.string().regex(/^[a-z]{2}$/),phone:z.string().max(40).default('')})}),
 z.object({action:z.literal('shipping'),region_id:id,name,amount:z.number().min(0).max(10000000)}),
])
export async function readSettings(container:any){
 const [stores,regions,currencies,countries,providers,locations,shipping]=await Promise.all([
  container.resolve(Modules.STORE).listStores({}, {relations:['supported_currencies']}),
  container.resolve('query').graph({entity:'region',fields:['id','name','currency_code','automatic_taxes','countries.*','payment_providers.id'],pagination:{take:500}}).then(r=>r.data),
  container.resolve(Modules.CURRENCY).listCurrencies({}, {take:500}),
  container.resolve(Modules.REGION).listCountries({}, {take:500}),
  container.resolve(Modules.PAYMENT).listPaymentProviders({}, {take:100}),
  container.resolve(Modules.STOCK_LOCATION).listStockLocations({}, {relations:['address'],take:500}),
  container.resolve('query').graph({entity:'shipping_option',fields:['id','name','service_zone_id','prices.*'],filters:{}}),
 ])
 const store=stores[0]
 return {store:{id:store.id,name:store.name,supported_currencies:store.supported_currencies,details:store.metadata?.hash_public_details||{}},regions,currencies:currencies.map(c=>({code:c.code,name:c.name})),countries:countries.map(c=>({iso_2:c.iso_2,display_name:c.display_name,region_id:c.region_id})),payment_providers:providers.filter(p=>p.is_enabled),locations,shipping_options:shipping.data}
}
export async function changeSettings(container:any,a:any,b:z.infer<typeof settingsCommand>){
 requireHash(a)
 return transaction('hash:settings',async c=>{
  const [store]=await container.resolve(Modules.STORE).listStores({}, {relations:['supported_currencies']})
  const regionService=container.resolve(Modules.REGION)
  switch(b.action){
   case 'store':await updateStoresWorkflow(container).run({input:{selector:{id:store.id},update:{name:b.name,metadata:{...store.metadata,hash_public_details:{support_email:b.support_email,support_phone:b.support_phone,returns_policy:b.returns_policy,shipping_policy:b.shipping_policy}}}}});break
   case 'add_currency':{
    const [currency]=await container.resolve(Modules.CURRENCY).listCurrencies({code:b.currency_code})
    if(!currency)fail('Choose a supported currency')
    if(!store.supported_currencies.some(x=>x.currency_code===b.currency_code))await updateStoresWorkflow(container).run({input:{selector:{id:store.id},update:{supported_currencies:[...store.supported_currencies.map(x=>({currency_code:x.currency_code,is_default:x.is_default})),{currency_code:b.currency_code,is_default:false}]}}})
    break
   }
   case 'region':{
    if(!store.supported_currencies.some(x=>x.currency_code===b.currency_code))fail('Enable this currency first')
    const countries=await regionService.listCountries({iso_2:b.countries},{take:500})
    if(countries.length!==new Set(b.countries).size||countries.some(x=>x.region_id&&x.region_id!==b.id))fail('Countries must be valid and cannot belong to another region')
    const providers=await container.resolve(Modules.PAYMENT).listPaymentProviders({id:b.payment_providers},{take:100})
    if(providers.length!==new Set(b.payment_providers).size||providers.some(x=>!x.is_enabled))fail('Choose installed, enabled payment providers')
    if(b.id){
     const old=await regionService.retrieveRegion(b.id,{relations:['countries']})
     if(old.currency_code!==b.currency_code)fail('Create a new region to change currency; existing carts must retain their currency')
     if(old.countries.some(x=>x.iso_2==='in')&&!b.countries.includes('in'))fail('Keep India in the default region')
     // Country reassignment requires corresponding shipping zone changes; keep updates additive.
     if(old.countries.some(x=>!b.countries.includes(x.iso_2)))fail('Existing countries cannot be removed through this form')
    }
    const values={name:b.name,currency_code:b.currency_code,countries:[...new Set(b.countries)],payment_providers:[...new Set(b.payment_providers)],automatic_taxes:b.automatic_taxes}
    if(b.id)await updateRegionsWorkflow(container).run({input:{selector:{id:b.id},update:values}})
    else await createRegionsWorkflow(container).run({input:{regions:[values]}})
    break
   }
   case 'location':{
    try{b.address.province=normalizeState(b.address.country_code,b.address.province)}catch(e){fail(e.message)}
    const countries=await regionService.listCountries({iso_2:[b.address.country_code]})
    if(!countries.length)fail('Choose a valid country')
    const existingNames=await container.resolve(Modules.STOCK_LOCATION).listStockLocations({name:b.name})
    if(existingNames.some(l=>l.id!==b.id))fail('A location with this name already exists')
    let locationId=b.id
    if(b.id){const old=await container.resolve(Modules.STOCK_LOCATION).retrieveStockLocation(b.id);if(old.name==='Hash Fulfilment'&&b.name!==old.name)fail('Keep the primary Hash Fulfilment location name');await updateStockLocationsWorkflow(container).run({input:{selector:{id:b.id},update:{name:b.name,address:{...b.address,address_1:b.address.address_1!,country_code:b.address.country_code!}}}})}
    else {const {result}=await createStockLocationsWorkflow(container).run({input:{locations:[{name:b.name,address:{...b.address,address_1:b.address.address_1!,country_code:b.address.country_code!}}]}});locationId=result[0].id}
    await linkSalesChannelsToStockLocationWorkflow(container).run({input:{id:locationId!,add:[store.default_sales_channel_id]}})
    break
   }
   case 'shipping':{
    const region=await regionService.retrieveRegion(b.region_id,{relations:['countries']})
    const scale=10**currencyDigits(region.currency_code)
    if(Math.abs(b.amount*scale-Math.round(b.amount*scale))>0.000001)fail('Delivery fee has too many decimals')
    const fulfillment=container.resolve(Modules.FULFILLMENT)
    const [location]=await container.resolve(Modules.STOCK_LOCATION).listStockLocations({name:'Hash Fulfilment'})
    const [profile]=await fulfillment.listShippingProfiles({type:'default'})
    if(!location||!profile)fail('Primary fulfillment location is missing')
    const setName=region.countries.some(x=>x.iso_2==='in')?'Hash Delivery':`Hash region ${region.id}`
    let [set]=await fulfillment.listFulfillmentSets({name:setName},{relations:['service_zones','service_zones.geo_zones']})
    if(!set){set=await fulfillment.createFulfillmentSets({name:setName,type:'shipping',service_zones:[{name:region.name,geo_zones:region.countries.map(x=>({country_code:x.iso_2,type:'country'}))}]})}
    // Link creation is idempotent in Medusa.
    await container.resolve('link').create({[Modules.STOCK_LOCATION]:{stock_location_id:location.id},[Modules.FULFILLMENT]:{fulfillment_set_id:set.id}})
    const zone=set.service_zones[0]
    // Keep country coverage aligned when administrators add countries to the region.
    const existingCountries=zone.geo_zones?.map(x=>x.country_code)||[]
    for(const country of region.countries)if(!existingCountries.includes(country.iso_2))await fulfillment.createGeoZones({service_zone_id:zone.id,country_code:country.iso_2,type:'country'})
    const [option]=await fulfillment.listShippingOptions({service_zone_id:zone.id})
    const values={name:b.name,prices:[{currency_code:region.currency_code,amount:b.amount}]}
    if(option)await updateShippingOptionsWorkflow(container).run({input:[{id:option.id,...values}]})
    else await createShippingOptionsWorkflow(container).run({input:[{...values,price_type:'flat',provider_id:'manual_manual',service_zone_id:zone.id,shipping_profile_id:profile.id,type:{label:'Standard',description:'Partner delivery or service fulfillment',code:'hash-standard'},rules:[{attribute:'enabled_in_store',value:'true',operator:'eq'},{attribute:'is_return',value:'false',operator:'eq'}]}]})
    break
   }
  }
  await audit(c,a.id,'operations_settings_updated',b.action,{action:b.action})
  return {ok:true}
 })
}
