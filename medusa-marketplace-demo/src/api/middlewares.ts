import { defineMiddlewares, authenticate } from "@medusajs/framework/http"
import { actor, fail } from "../lib/hash/access"
import { db } from "../lib/hash/db"
export default defineMiddlewares({routes:[
 {matcher:"/admin/*",middlewares:[authenticate("user",["session","bearer"]),async(req:any,res,next)=>{
  try { const a=await actor(req)
   const path=req.originalUrl.split("?")[0].replace(/\/$/,"")
   if(!a.superAdmin && path!=="/admin/hash" && !(path==="/admin/users/me" && req.method==="GET")) fail("Use the Hash vendor portal for your business")
   next()
  }catch(e){next(e)}
 }]},
 {matcher:"/auth/user/emailpass/register",method:"POST",middlewares:[(_req,res)=>res.status(403).json({message:"Hash provisions vendor accounts"})]},
 {matcher:"/store/hash/orders/:id",method:"GET",middlewares:[authenticate("customer",["session","bearer"])]},
 {matcher:"/store/hash/orders/:id/otp",method:"POST",middlewares:[authenticate("customer",["session","bearer"])]},
 {matcher:"/store/products*",method:"GET",middlewares:[async(req:any,res,next)=>{
  try {
   const {rows}=await db().query("SELECT l.product_id FROM hash_listing l JOIN hash_vendor v ON v.id=l.vendor_id WHERE l.approval='approved' AND v.status='active'")
   const allowed=rows.map(r=>r.product_id), path=req.originalUrl.split("?")[0].split("/").filter(Boolean)
   if(path.length>2 && !allowed.includes(path[2]))return res.status(404).json({message:"Product not found"})
   next()
  }catch(e){next(e)}
 }]}
]})
