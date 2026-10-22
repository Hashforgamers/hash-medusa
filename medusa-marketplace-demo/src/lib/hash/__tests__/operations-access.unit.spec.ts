import { GET,POST } from '../../../api/admin/hash/settings/route'
import { POST as bank } from '../../../api/admin/hash/bank/route'
import { actor } from '../access'
import { transaction } from '../db'
jest.mock('../access',()=>({...jest.requireActual('../access'),actor:jest.fn()}))
jest.mock('../db',()=>({transaction:jest.fn(),audit:jest.fn()}))
describe('operations permissions',()=>{
 test.each([GET,POST,bank])('denies vendors before reading settings or bank information',async handler=>{
  ;(actor as jest.Mock).mockResolvedValue({superAdmin:false,role:'owner'})
  const resolve=jest.fn();await expect(handler({scope:{resolve}},{})).rejects.toThrow('Only Hash administrators')
  expect(resolve).not.toHaveBeenCalled();expect(transaction).not.toHaveBeenCalled()
 })
 test.each([POST,bank])('requires temporary password change before writes or bank access',async handler=>{
  ;(actor as jest.Mock).mockResolvedValue({superAdmin:true,id:'admin'})
  await expect(handler({scope:{resolve:()=>({retrieveUser:async()=>({metadata:{hash_password_change_required:true}})})}},{})).rejects.toThrow('Change your temporary password')
 })
})
