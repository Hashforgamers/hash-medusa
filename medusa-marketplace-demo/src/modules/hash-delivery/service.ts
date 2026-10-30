import { AbstractFulfillmentProviderService } from '@medusajs/framework/utils'
import { checkoutShippingQuote } from '../../lib/hash/checkout-shipping'
export default class HashDeliveryProvider extends AbstractFulfillmentProviderService {
 static identifier='hash_delivery'
 async getFulfillmentOptions(){return [{id:'hash-delivery'}]}
 async canCalculate(){return true}
 async validateOption(){return true}
 async calculatePrice(_option:any,_data:any,context:any){const q=await checkoutShippingQuote(context);return {calculated_amount:(Number(q.amount_paise)+Number(q.platform_fee_paise||0))/100,is_calculated_price_tax_inclusive:true}}
 async validateFulfillmentData(_option:any,_data:any,context:any){const q=await checkoutShippingQuote(context);return {hash_shipping_quote_id:q.id,hash_shipping_payer:q.payer,hash_vendor_id:q.vendor_id,hash_customer_shipping_paise:Number(q.amount_paise),hash_platform_fee_paise:Number(q.platform_fee_paise||0)}}
 async createFulfillment():Promise<never>{throw Error('Book the shipment through Hash Shipping')}
 async cancelFulfillment(){throw Error('Cancel the shipment in Delhivery One and reconcile its final charge')}
 async createReturnFulfillment():Promise<never>{throw Error('Arrange the return through Delhivery One')}
}
