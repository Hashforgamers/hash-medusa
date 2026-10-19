import { defineRouteConfig } from "@medusajs/admin-sdk"
export default function HashPage() { return <iframe title="Hash Marketplace" src="/hash-portal" style={{width:"100%",height:"calc(100vh - 100px)",border:0,borderRadius:12}} /> }
export const config = defineRouteConfig({label:"Hash Marketplace"})
