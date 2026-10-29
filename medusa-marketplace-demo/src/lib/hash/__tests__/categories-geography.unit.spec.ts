import { categories, validateCategoryIds, filterCatalogCategory, saveCategory } from '../categories'
import { addressStates, normalizeState } from '../geography'
import { dispatchAddress } from '../shipping-address'
const rows=[{id:'active',is_active:true,is_internal:false},{id:'hidden',is_active:false,is_internal:false},{id:'internal',is_active:true,is_internal:true}]
const service={listProductCategories:jest.fn(async filters=>rows.filter(c=>Object.entries(filters).every(([k,v])=>c[k]===v)))}
const scope={resolve:()=>service}
test('vendors can only assign active public categories, with deduplication',async()=>{
 expect((await categories(scope)).map(c=>c.id)).toEqual(['active'])
 expect(await validateCategoryIds(scope,['active','active'])).toEqual(['active'])
 for(const id of ['hidden','internal','missing'])await expect(validateCategoryIds(scope,[id])).rejects.toThrow()
})
test('vendors cannot manage the global category vocabulary',async()=>{await expect(saveCategory(scope,{superAdmin:false},{name:'Test',handle:'test',description:'',rank:0,is_active:true})).rejects.toThrow()})
test('category filtering excludes unassigned listings; All retains them',()=>{
 const products=[{id:'a',categories:[{id:'one'}]},{id:'b',categories:[]}]
 expect(filterCatalogCategory(products,'one').map(p=>p.id)).toEqual(['a'])
 expect(filterCatalogCategory(products,'unknown')).toEqual([])
 expect(filterCatalogCategory(products)).toEqual(products)
})
test('India includes 28 states and 8 union territories, including Ladakh and merged territory',()=>{
 const states=addressStates('IN')!;expect(states).toHaveLength(36)
 expect(states.some(s=>s.name==='Ladakh')).toBe(true)
 expect(states.some(s=>s.name==='Dadra and Nagar Haveli and Daman and Diu')).toBe(true)
})
test('state codes normalize to courier-compatible names and cross-country values fail',()=>{
 expect(normalizeState('in','IN-MH')).toBe('Maharashtra')
 expect(normalizeState('us','CA')).toBe('California')
 expect(()=>normalizeState('in','California')).toThrow()
 expect(()=>normalizeState('xx','Maharashtra')).toThrow()
 expect(addressStates('xx')).toBeNull()
})
test('dispatch rejects foreign states before a courier request',()=>{
 const a={first_name:'Test',address_1:'123 Test Road',city:'Mumbai',province:'CA',postal_code:'400001',phone:'9876543210',country_code:'in'}
 expect(dispatchAddress.safeParse(a).success).toBe(false)
 expect(dispatchAddress.parse({...a,province:'MH'}).province).toBe('Maharashtra')
})
