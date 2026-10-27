import { syncDelhivery } from '../lib/hash/delhivery'
export default async function shipping(){await syncDelhivery()}
export const config={name:'hash-shipping',schedule:'*/15 * * * *'}
