import { Modules } from "@medusajs/framework/utils"
import { createSalesChannelsWorkflow,createRegionsWorkflow,updateStoresWorkflow,createStockLocationsWorkflow,createShippingProfilesWorkflow,createShippingOptionsWorkflow,linkSalesChannelsToStockLocationWorkflow,createApiKeysWorkflow,linkSalesChannelsToApiKeyWorkflow } from "@medusajs/medusa/core-flows"
import { migrate, db } from "../lib/hash/db"
import { createAccount } from "../lib/hash/marketplace"
export default async function setup({container}:any) {
 await migrate()
 const storeService=container.resolve(Modules.STORE),fulfillment=container.resolve(Modules.FULFILLMENT),link=container.resolve("link")
 let [channel]=await container.resolve(Modules.SALES_CHANNEL).listSalesChannels({name:"Hash Marketplace"})
 if(!channel){const {result}=await createSalesChannelsWorkflow(container).run({input:{salesChannelsData:[{name:"Hash Marketplace"}]}});channel=result[0]}
 const [store]=await storeService.listStores()
 await updateStoresWorkflow(container).run({input:{selector:{id:store.id},update:{name:"Hash Marketplace",supported_currencies:[{currency_code:"inr",is_default:true}],default_sales_channel_id:channel.id}}})
 let [region]=await container.resolve(Modules.REGION).listRegions({currency_code:"inr"})
 if(!region){const {result}=await createRegionsWorkflow(container).run({input:{regions:[{name:"India",currency_code:"inr",countries:["in"],payment_providers:["pp_system_default"]}]}});region=result[0]}
 let [profile]=await fulfillment.listShippingProfiles({type:"default"})
 if(!profile){const {result}=await createShippingProfilesWorkflow(container).run({input:{data:[{name:"Hash Standard",type:"default"}]}});profile=result[0]}
 let [location]=await container.resolve(Modules.STOCK_LOCATION).listStockLocations({name:"Hash Fulfilment"})
 if(!location){const {result}=await createStockLocationsWorkflow(container).run({input:{locations:[{name:"Hash Fulfilment",address:{country_code:"in",city:"Bengaluru",address_1:""}}]}});location=result[0]}
 await linkSalesChannelsToStockLocationWorkflow(container).run({input:{id:location.id,add:[channel.id]}})
 let [set]=await fulfillment.listFulfillmentSets({name:"Hash Delivery"},{relations:["service_zones"]})
 if(!set){set=await fulfillment.createFulfillmentSets({name:"Hash Delivery",type:"shipping",service_zones:[{name:"India",geo_zones:[{country_code:"in",type:"country"}]}]});await link.create({[Modules.STOCK_LOCATION]:{stock_location_id:location.id},[Modules.FULFILLMENT]:{fulfillment_set_id:set.id}});await link.create({[Modules.STOCK_LOCATION]:{stock_location_id:location.id},[Modules.FULFILLMENT]:{fulfillment_provider_id:"manual_manual"}})}
 const options=await fulfillment.listShippingOptions({name:"Hash Standard Delivery"})
 if(!options.length) await createShippingOptionsWorkflow(container).run({input:[{name:"Hash Standard Delivery",price_type:"flat",provider_id:"manual_manual",service_zone_id:set.service_zones[0].id,shipping_profile_id:profile.id,type:{label:"Standard",description:"Vendor delivery or service fulfilment",code:"hash-standard"},prices:[{currency_code:"inr",amount:0}],rules:[{attribute:"enabled_in_store",value:"true",operator:"eq"},{attribute:"is_return",value:"false",operator:"eq"}]}]})
 let [key]=await container.resolve(Modules.API_KEY).listApiKeys({title:"HFG Frontend"})
 if(!key){const {result}=await createApiKeysWorkflow(container).run({input:{api_keys:[{title:"HFG Frontend",type:"publishable",created_by:""}]}});key=result[0];await linkSalesChannelsToApiKeyWorkflow(container).run({input:{id:key.id,add:[channel.id]}})}
 if(process.env.HASH_ADMIN_EMAIL && process.env.HASH_ADMIN_PASSWORD){
  const existing=await container.resolve(Modules.USER).listUsers({email:process.env.HASH_ADMIN_EMAIL})
  if(!existing.length) await createAccount(container,process.env.HASH_ADMIN_EMAIL,process.env.HASH_ADMIN_PASSWORD,{is_super_admin:true})
  else console.log("Admin email already exists; no permissions or password changed.")
 }
 console.log(JSON.stringify({region_id:region.id,sales_channel_id:channel.id,publishable_key:key.token,portal:"http://localhost:9000/hash-portal"},null,2))
 await db().end()
}
