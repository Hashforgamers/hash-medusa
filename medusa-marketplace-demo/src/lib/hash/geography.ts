import countries from './data/country-regions.json'
export function addressCountries(){return countries.map(c=>({code:c.countryShortCode.toLowerCase(),name:c.countryName}))}
export function addressStates(countryCode:string){
 const c=countries.find(c=>c.countryShortCode.toLowerCase()===countryCode.toLowerCase())
 if(!c)return null
 return c.regions.map(r=>({code:r.shortCode||r.name,name:r.name})).sort((a,b)=>a.name.localeCompare(b.name))
}
export function normalizeState(country:string,value:string){
 const states=addressStates(country)
 if(states===null)throw Error('Choose a valid country')
 if(!states.length){if(value.trim())throw Error('This country has no listed state / province');return ''}
 const text=value.trim().toLowerCase().replace(new RegExp('^'+country.toLowerCase()+'-'),'')
 const match=states.find(s=>s.name.toLowerCase()===text||s.code.toLowerCase()===text)
 if(!match)throw Error('Choose a state / province belonging to the selected country')
 return match.name
}
