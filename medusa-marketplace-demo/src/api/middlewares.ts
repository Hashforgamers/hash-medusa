import { guardCheckoutPayment } from '../lib/hash/checkout-payment-guard'
import { defineMiddlewares, authenticate } from "@medusajs/framework/http"
import { actor, fail } from "../lib/hash/access"
import { db } from "../lib/hash/db"
export default defineMiddlewares({routes:[
 {matcher:"/store/payment-collections",method:"POST",middlewares:[authenticate("customer",["session","bearer"]),guardCheckoutPayment]},
 {matcher:"/store/payment-collections/:id/payment-sessions",method:"POST",middlewares:[authenticate("customer",["session","bearer"]),guardCheckoutPayment]},
 {matcher:"/store/hash/reviews*",middlewares:[authenticate("customer",["session","bearer"])]},
 {matcher:"/store/hash/reviews",method:"POST",bodyParser:{sizeLimit:"16kb"}},
 {matcher:"/store/hash/carts/:id/delivery",method:"GET",middlewares:[authenticate("customer",["session","bearer"])]},
 {matcher:"/hash-webhooks/razorpay/:mode",method:"POST",bodyParser:{preserveRawBody:true,sizeLimit:"256kb"}},
 {matcher:"/store/hash/subscriptions*",middlewares:[authenticate("customer",["session","bearer"])]},
 {matcher:"/admin/hash/images",method:"POST",bodyParser:{sizeLimit:"8mb"}},
 {matcher:"/auth/user/hfg*",middlewares:[(_req,res)=>res.status(403).json({message:"HFG login is for store customers only"})]},
 {matcher:"/admin/*",middlewares:[authenticate("user",["session","bearer"]),async(req:any,res,next)=>{
  try { const a=await actor(req)
   const path=req.originalUrl.split("?")[0].replace(/\/$/,"")
   if(!a.superAdmin && path!=="/admin/hash" && !(["/admin/hash/commercial","/admin/hash/accounts"].includes(path) && req.method==="GET") && !(path==="/admin/hash/categories" && req.method==="GET") && path!=="/admin/hash/images" && path!=="/admin/hash/shipping" && !(path==="/admin/hash/promotions" && ["GET","POST"].includes(req.method)) && !(path==="/admin/hash/reviews" && req.method==="GET") && !(path==="/admin/users/me" && req.method==="GET")) fail("Use the Hash vendor portal for your business")
   next()
  }catch(e){next(e)}
 }]},
 {matcher:"/auth/user/emailpass/register",method:"POST",middlewares:[(_req,res)=>res.status(403).json({message:"Hash provisions vendor accounts"})]},
 {matcher:"/store/hash/orders/:id",method:"GET",middlewares:[authenticate("customer",["session","bearer"])]},
 {matcher:"/store/hash/orders/:id/cancellation",method:"POST",middlewares:[authenticate("customer",["session","bearer"])]},
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
