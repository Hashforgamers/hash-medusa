# Hash Shop category filters and selectable SKUs

Use the same publishable key and backend origin as the existing Hash catalog. No change to customer login.

1. Fetch `GET /store/hash/categories`. Each category has a `specifications` array. Render by stable `key` and display `label` and optional `unit`. Types are `text`, `number`, `boolean`, `select` and `multi`. Choice fields return `choices`. Text choices are suggestions. Use only definitions marked `filterable` for storefront filters. `variant` means the seller may use the attribute as a SKU option.
2. Fetch `GET /store/hash/products?category_id=<id>&currency_code=inr`. For filters, add a URL-encoded JSON object in the `filters` parameter, e.g. `{"brand":["Logitech"],"color":["Black","White"]}`. Values within a key are alternatives. Different keys must match the same product/SKU combination. Send native boolean or numeric values for those field types. Filtering happens before pagination. For free text, values match exactly.
3. Render shared `product.specifications` using category labels. Missing optional or legacy fields can be omitted. A product can belong to multiple categories.
4. Render combinations from `product.variants[]`. Each has `id`, `sku`, `options` (key to selected value), `prices`, `pricing`, `offers`, and `available`. Build selectors only for keys present in these actual SKUs. Disable impossible combinations and disable purchase when the matched SKU has no availability or price in the selected currency. A standard listing has one SKU and empty options.
5. Show the selected SKU's calculated price and offers. Product-level price, available quantity and variant ID refer to the default SKU for compatibility. For a price range, calculate it from priced variants. Send the selected **variants[].id** as **variant_id** to the existing cart line item endpoint. Checkout recalculates price, offers and availability.

Example listing excerpt (IDs illustrative):
```json
{
  "specifications": {"brand":"Logitech","model":"G203"},
  "variants":[
    {"id":"variant_black","sku":"G203-BLK","options":{"color":"Black"},"available":8,"prices":[{"currency_code":"inr","amount":1499}]},
    {"id":"variant_white","sku":"G203-WHT","options":{"color":"White"},"available":2,"prices":[{"currency_code":"inr","amount":1599}]}
  ]
}
```


The live catalog now includes 22 categories with editable specifications. Fetch the category list dynamically, including the category IDs and definitions. Existing handles such as `mouse` and `controller` are retained. New categories cover headsets, mousepads, microphones, webcams and capture cards, speakers, desks, PC components, laptops and desktops.

Hash Operations can edit field definitions, required fields, filter selection and allowed variant choices in Product categories. These are category definitions. Actual specifications must be entered by the vendor for each product.
