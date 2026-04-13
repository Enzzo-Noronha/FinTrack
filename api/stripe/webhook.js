"use strict";

const {
  allow,
  env,
  json,
  mapSubscription,
  readRawBody,
  saveBillingRecord,
  statusError,
  stripeRequest,
  verifyStripeSignature,
} = require("./_shared");

async function syncFromCheckoutSession(session) {
  if (session?.mode !== "subscription" || !session?.subscription) return;
  const uid = session.client_reference_id || session.metadata?.firebaseUid || "";
  if (!uid) return;
  const subscription = await stripeRequest(`/subscriptions/${session.subscription}`, { method: "GET" });
  await saveBillingRecord(uid, mapSubscription(subscription));
}

async function syncFromSubscription(subscription) {
  const uid = subscription?.metadata?.firebaseUid || "";
  if (!uid) return;
  await saveBillingRecord(uid, mapSubscription(subscription));
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return allow(res, "POST");

  try {
    const rawBody = await readRawBody(req);
    const secret = env("STRIPE_WEBHOOK_SECRET");
    if (!verifyStripeSignature(rawBody, req.headers["stripe-signature"], secret)) {
      throw statusError(400, "Assinatura do webhook invalida.");
    }

    const event = JSON.parse(rawBody || "{}");
    switch (event.type) {
      case "checkout.session.completed":
        await syncFromCheckoutSession(event.data.object);
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await syncFromSubscription(event.data.object);
        break;
      default:
        break;
    }

    return json(res, 200, { received: true });
  } catch (error) {
    return json(res, error.status || 500, {
      error: error.message || "Falha ao processar o webhook da Stripe.",
    });
  }
};
