"use strict";

const {
  allow,
  json,
  mapSubscription,
  readJson,
  saveBillingRecord,
  statusError,
  stripeRequest,
  verifyFirebaseSession,
} = require("./_shared");

module.exports = async (req, res) => {
  if (req.method !== "POST") return allow(res, "POST");

  try {
    const user = await verifyFirebaseSession(req);
    const { sessionId = "" } = await readJson(req);
    if (!sessionId) throw statusError(400, "Sessao do checkout nao informada.");

    const session = await stripeRequest(`/checkout/sessions/${sessionId}`, { method: "GET" });
    const ownerUid = session.client_reference_id || session.metadata?.firebaseUid || "";
    if (!ownerUid || ownerUid !== user.uid) {
      throw statusError(403, "Esta sessao nao pertence a conta atual.");
    }
    if (!session.subscription) {
      throw statusError(409, "A assinatura ainda nao esta pronta para sincronizacao.");
    }

    const subscription = await stripeRequest(`/subscriptions/${session.subscription}`, { method: "GET" });
    const billing = mapSubscription(subscription);
    await saveBillingRecord(user.uid, billing);

    return json(res, 200, { billing });
  } catch (error) {
    return json(res, error.status || 500, {
      error: error.message || "Nao foi possivel sincronizar a assinatura agora.",
    });
  }
};
