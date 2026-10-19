import {
  createApiKeysWorkflow,
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createShippingOptionsWorkflow,
  createShippingProfilesWorkflow,
  createStockLocationsWorkflow,
  createTaxRegionsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
  updateStoresWorkflow,
} from "@medusajs/medusa/core-flows";
import { ExecArgs } from "@medusajs/framework/types";
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils";

export default async function seedIndiaCore({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const link = container.resolve(ContainerRegistrationKeys.LINK);
  const fulfillmentModuleService = container.resolve(Modules.FULFILLMENT);
  const salesChannelModuleService = container.resolve(Modules.SALES_CHANNEL);
  const storeModuleService = container.resolve(Modules.STORE);

  // India only
  const countries = ["in"]; // ISO 3166-1 alpha-2 (lowercase) [23]

  logger.info("Seeding store data (India)...");
  const [store] = await storeModuleService.listStores();

  let defaultSalesChannel = await salesChannelModuleService.listSalesChannels({
    name: "Default Sales Channel",
  });

  if (!defaultSalesChannel.length) {
    const { result: salesChannelResult } =
      await createSalesChannelsWorkflow(container).run({
        input: {
          salesChannelsData: [{ name: "Default Sales Channel" }],
        },
      });
    defaultSalesChannel = salesChannelResult;
  }

  // Make INR default; keep USD/EUR optional
  await updateStoresWorkflow(container).run({
    input: {
      selector: { id: store.id },
      update: {
        supported_currencies: [
          { currency_code: "inr", is_default: true },
          { currency_code: "usd" },
          { currency_code: "eur" },
        ],
        default_sales_channel_id: defaultSalesChannel[0].id,
      },
    },
  });

  logger.info("Seeding region (India)...");
  const { result: regionResult } = await createRegionsWorkflow(container).run({
    input: {
      regions: [
        {
          name: "India",
          currency_code: "inr",
          countries,
          // Use the configured payment provider id(s). If manual is configured, you can use "pp_system_default" or your manual ID.
          payment_providers: ["pp_system_default"], // adjust to your setup [22]
        },
      ],
    },
  });
  const region = regionResult[0];

  logger.info("Seeding tax regions (India)...");
  await createTaxRegionsWorkflow(container).run({
    input: countries.map((country_code) => ({ country_code })),
  });

  logger.info("Seeding stock location (India)...");
  const { result: stockLocationResult } = await createStockLocationsWorkflow(
    container
  ).run({
    input: {
      locations: [
        {
          name: "India Warehouse",
          address: {
            city: "Bengaluru",
            country_code: "IN", // uppercase in address contexts [23]
            address_1: "",
          },
        },
      ],
    },
  });
  const stockLocation = stockLocationResult[0];

  // Link stock location to fulfillment provider (manual id may vary per project)
  await link.create({
    [Modules.STOCK_LOCATION]: { stock_location_id: stockLocation.id },
    [Modules.FULFILLMENT]: { fulfillment_provider_id: "manual_manual" },
  });

  logger.info("Ensuring default shipping profile...");
  const shippingProfiles = await fulfillmentModuleService.listShippingProfiles({
    type: "default",
  });
  let shippingProfile = shippingProfiles.length ? shippingProfiles[0] : null;

  if (!shippingProfile) {
    const { result: shippingProfileResult } =
      await createShippingProfilesWorkflow(container).run({
        input: {
          data: [{ name: "Default Shipping Profile", type: "default" }],
        },
      });
    shippingProfile = shippingProfileResult[0];
  }

  logger.info("Creating fulfillment set and service zone for India...");
  const fulfillmentSet = await fulfillmentModuleService.createFulfillmentSets({
    name: "India Warehouse delivery",
    type: "shipping",
    service_zones: [
      {
        name: "India",
        geo_zones: [{ country_code: "in", type: "country" }],
      },
    ],
  });

  await link.create({
    [Modules.STOCK_LOCATION]: { stock_location_id: stockLocation.id },
    [Modules.FULFILLMENT]: { fulfillment_set_id: fulfillmentSet.id },
  });

  logger.info("Creating shipping options (INR, optional USD/EUR)...");
  await createShippingOptionsWorkflow(container).run({
    input: [
      {
        name: "Standard Shipping",
        price_type: "flat",
        provider_id: "manual_manual",
        service_zone_id: fulfillmentSet.service_zones[0].id,
        shipping_profile_id: shippingProfile.id,
        type: {
          label: "Standard",
          description: "Ships in 2-5 days within India.",
          code: "standard",
        },
        prices: [
          { currency_code: "inr", amount: 199 },
          { currency_code: "usd", amount: 5 },
          { currency_code: "eur", amount: 5 },
          { region_id: region.id, amount: 199 },
        ],
        rules: [
          { attribute: "enabled_in_store", value: "true", operator: "eq" },
          { attribute: "is_return", value: "false", operator: "eq" },
        ],
      },
      {
        name: "Express Shipping",
        price_type: "flat",
        provider_id: "manual_manual",
        service_zone_id: fulfillmentSet.service_zones[0].id,
        shipping_profile_id: shippingProfile.id,
        type: {
          label: "Express",
          description: "Ships in 1-2 days within India.",
          code: "express",
        },
        prices: [
          { currency_code: "inr", amount: 399 },
          { currency_code: "usd", amount: 10 },
          { currency_code: "eur", amount: 10 },
          { region_id: region.id, amount: 399 },
        ],
        rules: [
          { attribute: "enabled_in_store", value: "true", operator: "eq" },
          { attribute: "is_return", value: "false", operator: "eq" },
        ],
      },
    ],
  });

  logger.info("Linking stock location to sales channel...");
  await linkSalesChannelsToStockLocationWorkflow(container).run({
    input: {
      id: stockLocation.id,
      add: [defaultSalesChannel[0].id],
    },
  });

  logger.info("Creating publishable API key and linking to channel...");
  const { result: publishableApiKeyResult } = await createApiKeysWorkflow(
    container
  ).run({
    input: {
      api_keys: [{ title: "Webshop", type: "publishable", created_by: "" }],
    },
  });
  const publishableApiKey = publishableApiKeyResult[0];

  await linkSalesChannelsToApiKeyWorkflow(container).run({
    input: {
      id: publishableApiKey.id,
      add: [defaultSalesChannel[0].id],
    },
  });

  logger.info("India base seed completed (no demo products).");
}
