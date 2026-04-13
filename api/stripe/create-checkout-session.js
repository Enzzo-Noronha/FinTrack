"use strict";

const {
  allow,
  getBillingRecord,
  getBaseUrl,
  json,
  readJson,
  statusError,
  stripeRequest,
  verifyFirebaseSession,
} = require("./_shared");

module.exports = async (req, res) => {
  if (req.method !== "POST") return allow(res, "POST");

  try {
    const { interval = "monthly" } = await readJson(req);
    if (!["monthly", "annual"].includes(interval)) {
      throw statusError(400, "Intervalo de assinatura invalido.");
    }

    const user = await verifyFirebaseSession(req);
    const priceId =
      interval === "annual" ? process.env.STRIPE_PRICE_ID_ANNUAL : process.env.STRIPE_PRICE_ID_MONTHLY;

    if (!priceId) {
      throw statusError(500, "Os price IDs da Stripe ainda nao foram configurados.");
    }

    let customerId = "";
    try {
      const billing = await getBillingRecord(user.uid);
      customerId = billing?.stripeCustomerId || "";
    } catch {
      customerId = "";
    }

    const baseUrl = getBaseUrl(req);
    const session = await stripeRequest("/checkout/sessions", {
      method: "POST",
      form: {
        mode: "subscription",
        allow_promotion_codes: "true",
        client_reference_id: user.uid,
        success_url: `${baseUrl}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/?checkout=cancelled`,
        "line_items[0][price]": priceId,
        "line_items[0][quantity]": 1,
        "metadata[firebaseUid]": user.uid,
        "metadata[userEmail]": user.email,
        "subscription_data[metadata][firebaseUid]": user.uid,
        "subscription_data[metadata][userEmail]": user.email,
        ...(customerId ? { customer: customerId } : user.email ? { customer_email: user.email } : {}),
      },
    });

    return json(res, 200, { id: session.id, url: session.url });
  } catch (error) {
    return json(res, error.status || 500, {
      error: error.message || "Nao foi possivel criar a sessao de checkout.",
    });
  }
};
