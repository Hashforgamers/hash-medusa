import { createHmac, randomInt, randomBytes, timingSafeEqual } from "crypto"
export function currencyDigits(currency: string): number {
  return new Intl.NumberFormat('en', {style:'currency',currency:currency.toUpperCase()}).resolvedOptions().maximumFractionDigits
}
export function minorUnits(value: any, currency="inr"): number {
  const n = Number(value?.value ?? value), scale = 10 ** currencyDigits(currency)
  if (!Number.isFinite(n) || n < 0 || !Number.isSafeInteger(Math.round(n * scale))) throw new Error("Invalid currency amount")
  return Math.round(n * scale)
}
export function paise(value: any): number {
  const n = Number(value?.value ?? value)
  if (!Number.isFinite(n) || n < 0 || !Number.isSafeInteger(Math.round(n * 100))) throw new Error("Invalid INR amount")
  return Math.round(n * 100)
}
export function split(total: number, bps: number) {
  if (!Number.isSafeInteger(total) || total < 0 || !Number.isInteger(bps) || bps < 0 || bps > 10000) throw new Error("Invalid settlement amount or commission")
  const net = total - Number(BigInt(total) * BigInt(bps) / 10000n)
  return { net, payment: Math.floor(net / 2), completion: net - Math.floor(net / 2) }
}
// Due at midnight Asia/Kolkata on the next business day. Explicit holidays augment weekends.
export function nextBusinessDay(value: Date, holidays = (process.env.HASH_SETTLEMENT_HOLIDAYS || "").split(",")): Date {
  const local = new Date(value.getTime() + 330 * 60000)
  local.setUTCHours(0,0,0,0)
  do { local.setUTCDate(local.getUTCDate() + 1) }
  while ([0,6].includes(local.getUTCDay()) || holidays.includes(local.toISOString().slice(0,10)))
  return new Date(local.getTime() - 330 * 60000)
}
export function otpDigest(orderId: string, nonce: string, code: string) {
  const secret = process.env.HASH_OTP_SECRET || process.env.JWT_SECRET
  if (!secret) throw new Error("HASH_OTP_SECRET must be configured")
  return createHmac("sha256", secret).update(`${orderId}:${nonce}:${code}`).digest("hex")
}
export function newOtp(orderId: string) {
  const code = randomInt(0, 1000000).toString().padStart(6,"0")
  const nonce = randomBytes(16).toString("hex")
  return { code, nonce, digest: otpDigest(orderId, nonce, code) }
}
export function matchesOtp(orderId: string, nonce: string, code: string, digest: string) {
  if (!/^\d{6}$/.test(code) || !digest) return false
  const a = Buffer.from(otpDigest(orderId, nonce, code), "hex"), b = Buffer.from(digest,"hex")
  return a.length === b.length && timingSafeEqual(a,b)
}
