"use strict";

const crypto = require("node:crypto");

const DEFAULT_FIREBASE_PROJECT_ID = "fintrack-c8670";
const DEFAULT_FIREBASE_WEB_API_KEY = "AIzaSyD2HrJAszgctnujD5AyTz4qjlFWOJUMKPA";
const STRIPE_API_BASE = "https://api.stripe.com/v1";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

const tokenCache = {
  value: "",
  expiresAt: 0,
};

function env(name, fallback = "") {
  return String(process.env[name] || fallback || "").trim();
}

function statusError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function allow(res, method) {
  res.setHeader("Allow", method);
  return json(res, 405, { error: "Metodo nao permitido." });
}

async function readRawBody(req) {
  if (typeof req.rawBody === "string") return req.rawBody;
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  req.rawBody = Buffer.concat(chunks).toString("utf8");
  return req.rawBody;
}

async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const raw = await readRawBody(req);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw statusError(400, "Corpo JSON invalido.");
  }
}

function getBaseUrl(req) {
  const configured = env("APP_BASE_URL");
  if (configured) return configured.replace(/\/$/, "");
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  return `${proto}://${host}`.replace(/\/$/, "");
}

function formBody(data) {
  const params = new URLSearchParams();
  Object.entries(data || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    params.append(key, String(value));
  });
  return params.toString();
}

async function stripeRequest(path, options = {}) {
  const secret = env("STRIPE_SECRET_KEY");
  if (!secret) throw statusError(500, "STRIPE_SECRET_KEY nao configurada.");
  const method = options.method || "GET";
  const response = await fetch(`${STRIPE_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secret}`,
      ...(method === "GET" ? {} : { "Content-Type": "application/x-www-form-urlencoded" }),
    },
    body: method === "GET" ? undefined : formBody(options.form),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw statusError(response.status, data?.error?.message || `Falha Stripe em ${path}.`);
  }
  return data;
}

async function verifyFirebaseSession(req) {
  const auth = String(req.headers.authorization || "");
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) throw statusError(401, "Faca login para continuar.");
  const apiKey = env("FIREBASE_WEB_API_KEY", DEFAULT_FIREBASE_WEB_API_KEY);
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: match[1] }),
    }
  );
  const data = await response.json().catch(() => ({}));
  const user = data?.users?.[0];
  if (!response.ok || !user?.localId) {
    throw statusError(401, "Sessao invalida. Entre novamente.");
  }
  return {
    uid: user.localId,
    email: user.email || "",
    name: user.displayName || "",
  };
}

function toBase64Url(value) {
  return Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");
}

function normalizedPrivateKey() {
  return env("FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY").replace(/\\n/g, "\n");
}

async function getGoogleAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache.value && tokenCache.expiresAt > now + 60) return tokenCache.value;

  const clientEmail = env("FIREBASE_SERVICE_ACCOUNT_EMAIL");
  const privateKey = normalizedPrivateKey();
  if (!clientEmail || !privateKey) {
    throw statusError(500, "Credenciais do Firebase Admin nao configuradas.");
  }

  const header = toBase64Url({ alg: "RS256", typ: "JWT" });
  const claimSet = toBase64Url({
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: GOOGLE_TOKEN_URL,
    exp: now + 3600,
    iat: now,
  });
  const unsigned = `${header}.${claimSet}`;
  const signature = crypto.createSign("RSA-SHA256").update(unsigned).end().sign(privateKey, "base64url");
  const assertion = `${unsigned}.${signature}`;

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw statusError(500, "Nao foi possivel autenticar no Firestore.");
  }

  tokenCache.value = data.access_token;
  tokenCache.expiresAt = now + Number(data.expires_in || 3600);
  return tokenCache.value;
}

function firestoreProjectId() {
  return env("FIREBASE_PROJECT_ID", DEFAULT_FIREBASE_PROJECT_ID);
}

function firestoreUrl(pathname) {
  return `https://firestore.googleapis.com/v1/projects/${firestoreProjectId()}/databases/(default)/documents/${pathname}`;
}

function encodeFirestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map((item) => encodeFirestoreValue(item)),
      },
    };
  }
  switch (typeof value) {
    case "string":
      return { stringValue: value };
    case "boolean":
      return { booleanValue: value };
    case "number":
      return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
    case "object":
      return {
        mapValue: {
          fields: Object.fromEntries(
            Object.entries(value).map(([key, entry]) => [key, encodeFirestoreValue(entry)])
          ),
        },
      };
    default:
      return { stringValue: String(value) };
  }
}

function decodeFirestoreValue(node) {
  if (!node || typeof node !== "object") return null;
  if ("stringValue" in node) return node.stringValue;
  if ("booleanValue" in node) return node.booleanValue;
  if ("integerValue" in node) return Number(node.integerValue);
  if ("doubleValue" in node) return Number(node.doubleValue);
  if ("nullValue" in node) return null;
  if ("timestampValue" in node) return node.timestampValue;
  if ("arrayValue" in node) {
    return Array.isArray(node.arrayValue.values)
      ? node.arrayValue.values.map((entry) => decodeFirestoreValue(entry))
      : [];
  }
  if ("mapValue" in node) {
    return Object.fromEntries(
      Object.entries(node.mapValue.fields || {}).map(([key, value]) => [key, decodeFirestoreValue(value)])
    );
  }
  return null;
}

async function firestoreRequest(url, options = {}) {
  const token = await getGoogleAccessToken();
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  if (response.status === 404) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw statusError(response.status, data?.error?.message || "Falha ao acessar o Firestore.");
  }
  return data;
}

async function getBillingRecord(uid) {
  const data = await firestoreRequest(firestoreUrl(`users/${encodeURIComponent(uid)}/fintrack/appData`), {
    method: "GET",
  });
  if (!data?.fields?.billing) return null;
  return decodeFirestoreValue(data.fields.billing);
}

async function saveBillingRecord(uid, billing) {
  const url = new URL(firestoreUrl(`users/${encodeURIComponent(uid)}/fintrack/appData`));
  url.searchParams.append("updateMask.fieldPaths", "billing");
  url.searchParams.append("updateMask.fieldPaths", "updatedAt");

  return firestoreRequest(url.toString(), {
    method: "PATCH",
    body: JSON.stringify({
      fields: {
        billing: encodeFirestoreValue(billing),
        updatedAt: encodeFirestoreValue(Date.now()),
      },
    }),
  });
}

function mapSubscription(subscription) {
  const recurring = subscription?.items?.data?.[0]?.price?.recurring || {};
  const status = subscription?.status || "free";
  const active = ["active", "trialing", "past_due"].includes(status);
  const toIso = (value) => (value ? new Date(value * 1000).toISOString() : null);

  return {
    plan: active ? "pro" : "free",
    status,
    interval: recurring.interval === "year" ? "annual" : "monthly",
    renewsAt: active ? toIso(subscription.current_period_end) : null,
    expiresAt: status === "canceled" ? toIso(subscription.current_period_end || subscription.ended_at) : null,
    trialEndsAt: toIso(subscription.trial_end),
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    stripeCustomerId:
      typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id || "",
    stripeSubscriptionId: subscription.id || "",
    priceId: subscription?.items?.data?.[0]?.price?.id || "",
    updatedAt: Date.now(),
  };
}

function verifyStripeSignature(rawBody, header, secret) {
  if (!rawBody || !header || !secret) return false;
  let timestamp = "";
  let signature = "";
  header.split(",").forEach((piece) => {
    const [key, value] = piece.split("=");
    if (key === "t") timestamp = value;
    if (key === "v1" && !signature) signature = value;
  });
  if (!timestamp || !signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
  try {
    return (
      expected.length === signature.length &&
      crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
    );
  } catch {
    return false;
  }
}

module.exports = {
  allow,
  env,
  getBaseUrl,
  getBillingRecord,
  json,
  mapSubscription,
  readJson,
  readRawBody,
  saveBillingRecord,
  statusError,
  stripeRequest,
  verifyFirebaseSession,
  verifyStripeSignature,
};
