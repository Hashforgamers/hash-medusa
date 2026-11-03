import { categorySpecs, validateSpecs } from '../specifications'

const category={specifications:categorySpecs({handle:'mouse'})}
const shade='Arctic Blue / Pearl'
const sku={sku:'mouse-blue',options:{color:shade},price_inr:100,stock:1}

test('custom shades work for shared specifications and purchased SKUs',()=>{
 expect(category.specifications.find(d=>d.key==='color')).toMatchObject({allow_custom:true,suggestions:expect.arrayContaining(['Graphite','Rose Gold'])})
 expect(()=>validateSpecs([category],{brand:'Hash',color:[shade]},[])).not.toThrow()
 expect(()=>validateSpecs([category],{brand:'Hash'},[sku])).not.toThrow()
 expect(()=>validateSpecs([category],{brand:'Hash'},[{...sku,options:{connectivity:'Unknown'}}])).toThrow()
})
