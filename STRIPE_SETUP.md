# Stripe e Firebase

## Variaveis da Vercel

- `APP_BASE_URL`
- `STRIPE_SECRET_KEY`
- `STRIPE_PRICE_ID_MONTHLY`
- `STRIPE_PRICE_ID_ANNUAL`
- `STRIPE_WEBHOOK_SECRET`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_SERVICE_ACCOUNT_EMAIL`
- `FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY`
- `FIREBASE_WEB_API_KEY`

## Webhook

Cadastre um endpoint na Stripe apontando para:

- `/api/stripe/webhook`

Eventos recomendados:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

## Price IDs

No dashboard da Stripe, copie o ID do preco mensal e anual criados para o FinTrack Pro.

## Suporte e links publicos

Atualize no `index.html`:

- `supportEmail`

Os links de privacidade e termos ja apontam para:

- `/privacy.html`
- `/terms.html`
