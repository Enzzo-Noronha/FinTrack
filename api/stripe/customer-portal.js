"use strict";

const {
  allow,
  getBaseUrl,
  getBillingRecord,
  json,
  statusError,
  stripeRequest,
  verifyFirebaseSession,
} = require("./_shared");

module.exports = async (req, res) => {
  if (req.method !== "POST") return allow(res, "POST");

  try {
    const user = await verifyFirebaseSession(req);
    const billing = await getBillingRecord(user.uid);
    const customerId = billing?.stripeCustomerId || "";

    if (!customerId) {
      throw statusError(409, "Ainda nao encontramos uma assinatura vinculada a esta conta.");
    }

    const session = await stripeRequest("/billing_portal/sessions", {
      method: "POST",
      form: {
        customer: customerId,
        return_url: `${getBaseUrl(req)}/?portal=return`,
      },
    });

    return json(res, 200, { url: session.url });
  } catch (error) {
    return json(res, error.status || 500, {
      error: error.message || "Nao foi possivel abrir o portal do cliente.",
    });
  }
};
