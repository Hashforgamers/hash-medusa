import { processApprovedCancellations } from '../lib/hash/cancellation-completion'
export default async function cancellations(container:any){await processApprovedCancellations(container)}
export const config={name:'hash-cancellations',schedule:'* * * * *'}
