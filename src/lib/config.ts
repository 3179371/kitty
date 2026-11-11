// Runtime configuration. Everything secret stays server-side.

export const config = {
  paypalClientId: process.env.PAYPAL_CLIENT_ID || "",
  paypalClientSecret: process.env.PAYPAL_CLIENT_SECRET || "",
  paypalApiBase: process.env.PAYPAL_API_BASE || "https://api-m.sandbox.paypal.com",
  giftShopEmail: process.env.GIFT_SHOP_EMAIL || "",
  giftShopName: process.env.GIFT_SHOP_NAME || "Kitty Demo Gift Shop",
  invoiceRecipientEmail: process.env.SANDBOX_BUYER_EMAIL || "",
  anthropicKey: process.env.ANTHROPIC_API_KEY || "",
  anthropicModel: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
  channel3Key: process.env.CHANNEL3_API_KEY || "",
  dataFile: process.env.KITTY_DATA_FILE || "/tmp/kitty-data.json",
  publicUrl: process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || "http://localhost:3000",
};

export const paypalMode = (): "sandbox" | "mock" =>
  config.paypalClientId && config.paypalClientSecret ? "sandbox" : "mock";

export const aiMode = (): "claude" | "offline" => (config.anthropicKey ? "claude" : "offline");

export const giftSource = (): "channel3" | "demo_catalog" =>
  config.channel3Key ? "channel3" : "demo_catalog";
