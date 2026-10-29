import { addressCountries, addressStates } from '../../../lib/hash/geography'
export async function GET(req:any,res:any){
 res.setHeader('Cache-Control','public, max-age=86400')
 const country=req.query.country_code
 if(country===undefined)return res.json({countries:addressCountries()})
 if(typeof country!=='string'||!/^[a-z]{2}$/i.test(country))return res.status(400).json({message:'Provide a two-letter country_code'})
 const states=addressStates(country)
 if(states===null)return res.status(400).json({message:'Unknown country_code'})
 res.json({country_code:country.toLowerCase(),states,state_required:states.length>0,address_value:'name'})
}
