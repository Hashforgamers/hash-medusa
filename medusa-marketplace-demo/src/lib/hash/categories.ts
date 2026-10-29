import { Modules } from '@medusajs/framework/utils'
import { z } from 'zod'
import { fail, requireHash } from './access'
import { audit, transaction } from './db'
export const categoryCommand=z.object({id:z.string().min(1).optional(),name:z.string().trim().min(2).max(100),handle:z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100),description:z.string().trim().max(1000).default(''),is_active:z.boolean().default(true),rank:z.number().int().min(0).max(10000).default(0)})
export async function categories(container:any,all=false){
 const rows=await container.resolve(Modules.PRODUCT).listProductCategories(all?{}:{is_active:true,is_internal:false},{select:['id','name','handle','description','is_active','is_internal','rank','parent_category_id'],take:1000,order:{rank:'ASC',name:'ASC'}})
 return rows.map(c=>({id:c.id,name:c.name,handle:c.handle,description:c.description,is_active:c.is_active,is_internal:c.is_internal,rank:c.rank,parent_category_id:c.parent_category_id})).sort((a,b)=>a.rank-b.rank||a.name.localeCompare(b.name))
}
export async function validateCategoryIds(container:any,ids:string[]){
 const unique=[...new Set(ids)]
 const available=await categories(container)
 if(unique.some(id=>!available.some(c=>c.id===id)))fail('Choose active public product categories')
 return unique
}
export async function saveCategory(container:any,a:any,b:z.infer<typeof categoryCommand>){
 requireHash(a)
 return transaction('hash:categories',async c=>{
  const service=container.resolve(Modules.PRODUCT)
  const existing=await service.listProductCategories({handle:b.handle})
  if(existing.some(x=>x.id!==b.id))fail('This category handle is already in use')
  const {id,...values}=b
  const category=id?await service.updateProductCategories(id,{...values,is_internal:false}):await service.createProductCategories({...values,is_internal:false})
  await audit(c,a.id,'category_saved',category.id,{name:b.name,is_active:b.is_active})
  return {category}
 })
}
export function filterCatalogCategory(products:any[],categoryId?:string){return categoryId?products.filter(p=>p.categories?.some(c=>c.id===categoryId)):products}
