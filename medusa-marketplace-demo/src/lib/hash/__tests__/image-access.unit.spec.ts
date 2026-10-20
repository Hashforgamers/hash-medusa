import { POST } from "../../../api/admin/hash/images/route"
import { actor, own } from "../access"
import { db, transaction } from "../db"
import { uploadImage } from "../cloudinary"
jest.mock('../access',()=>({actor:jest.fn(),own:jest.fn(),fail:(message)=>{throw new Error(message)}}))
jest.mock('../db',()=>({db:jest.fn(),transaction:jest.fn()}))
jest.mock('../cloudinary',()=>({uploadImage:jest.fn()}))
describe('partner image access',()=>{
 const req:any={body:{vendor_id:'hv_other',data_url:'image'},scope:{resolve:()=>({retrieveUser:async()=>({metadata:{}})})}}
 beforeEach(()=>{jest.clearAllMocks();(actor as jest.Mock).mockResolvedValue({id:'user_vendor',vendor_id:'hv_mine'});(own as jest.Mock).mockImplementation(()=>{});(db as jest.Mock).mockReturnValue({query:async()=>({rows:[{id:'hv_other'}]})})})
 test('rejects another vendor before uploading or reserving quota',async()=>{
  (own as jest.Mock).mockImplementation(()=>{throw new Error('Resource not found')})
  await expect(POST(req,{} as any)).rejects.toThrow('Resource not found')
  expect(uploadImage).not.toHaveBeenCalled();expect(transaction).not.toHaveBeenCalled()
 })
 test('requires temporary password change',async()=>{
  const pending={...req,scope:{resolve:()=>({retrieveUser:async()=>({metadata:{hash_password_change_required:true}})})}}
  await expect(POST(pending,{} as any)).rejects.toThrow('Change your temporary password')
  expect(uploadImage).not.toHaveBeenCalled()
 })
 test('inactive vendor cannot upload even for Hash admin',async()=>{
  (db as jest.Mock).mockReturnValue({query:async()=>({rows:[]})})
  await expect(POST(req,{} as any)).rejects.toThrow('Vendor is not active')
  expect(uploadImage).not.toHaveBeenCalled()
 })
 test('rate limit rejects before external upload',async()=>{
  (transaction as jest.Mock).mockImplementation(async(_key,fn)=>fn({query:async()=>({rows:[{count:10}]})}))
  await expect(POST(req,{} as any)).rejects.toThrow('Upload limit reached')
  expect(uploadImage).not.toHaveBeenCalled()
 })
})
