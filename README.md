# BIREQDAR & CO. Storefront V1

A Node.js storefront and owner studio for jewellery, gemstones (including natural and lab-grown diamonds), bullion, bespoke commissions and watches. Product listings, customer accounts, checkout orders, line-item snapshots, reservations, collections, settings and owner/customer sessions can be stored in PostgreSQL. Product image files remain on the host's persistent disk.

## Local development

Use Node.js 20 or newer. Install dependencies and start the app:

```sh
npm install
npm start
```

Without `DATABASE_URL`, local development uses `data/store.json`. For a local PostgreSQL database, copy `.env.example` to `.env`, set `DATABASE_URL`, and start the app. On first connection, if PostgreSQL has no store state, the app migrates the existing local JSON store into PostgreSQL; if neither exists it creates sample collections and products. PostgreSQL becomes the primary store after initialization. The uploads folder still needs durable disk storage.

The first run prints an owner setup key. Use it at `/admin.html` to create the owner login. Do not commit `.env`, database credentials, Stripe keys, customer information or order exports.

## Product data model

- **Jewellery:** Gold and Silver, with necklace, pendant, earring, bracelet and ring styles.
- **Gemstones:** coloured gemstones, natural diamonds and lab-grown diamonds.
- **Bespoke:** made-to-order commission/enquiry listings.
- **Bullion / Investment:** gold bars and coins, silver bars and coins, and limited-edition bullion.
- **Watches:** brand, condition and verified specification details.

The current sample products are explicitly flagged as demonstration listings. Replace them with verified live products, prices, stock, photography and specifications before taking payment. The owner studio can add/edit products and collections and manage orders and enquiries.

## PostgreSQL and Render setup

The included `db/schema.sql` creates relational tables for products, collections, customers, orders, order items, reservations, sessions and Stripe webhook event IDs. Some app-specific fields are also kept as JSONB so the current owner tools can evolve without losing data. The initial migration imports existing `data/store.json` when PostgreSQL is empty.

The version 6 catalogue migration adds AI-created, unbranded concept images from `assets/catalogue/`, refreshed sample descriptions and additional concept listings to the seeded catalogue. Bespoke commissions are submitted through the request form rather than listed as sample products. These are preview assets only, not photographs or verified stock. Sample listings stay marked as demonstrations and cannot be charged with a live Stripe key. `GET /api/store` reports whether the app is using PostgreSQL or local JSON and returns the product/collection counts; `GET /api/catalog` contains the public catalogue.

1. Create a **paid Render PostgreSQL** database for production. Render's free PostgreSQL database expires after 30 days, so it is not suitable for durable customer orders. Review Render's current database price and backup/retention options in your account.
2. Keep the web service and database in the same Render region, then set the web service's `DATABASE_URL` to the database's **internal** connection URL.
3. Keep the current persistent disk mounted at `/var/data` for product uploads. PostgreSQL stores catalogue and order records; the persistent disk stores uploaded image files.
4. Deploy and check the Render logs for successful startup. Confirm `/api/store` responds and that the owner studio shows the catalogue. On the first migration, check product counts before deleting or archiving any old disk data.
5. Configure and test PostgreSQL backups before launch. The app currently runs one Node web-service instance and saves a transactional snapshot of its V1 state. Do not add multiple app instances or scale horizontally until writes have been changed to targeted database transactions and concurrency-tested.

The Render blueprint asks for `DATABASE_URL` when creating/updating the service. `LIVE_CHECKOUT_ENABLED` is deliberately set to `false` in the blueprint.

## Checkout and order safety

- Checkout recalculates price, currency, availability and stock on the server; browser cart prices are not trusted.
- Orders retain item-name, price and customer-detail snapshots even if a product is later edited.
- A request identifier prevents a repeat checkout submission from creating a second order/session.
- Card details are entered on Stripe-hosted Checkout; this app does not receive or store card numbers.
- Stripe webhooks use signature validation, match the checkout session to its order, record event IDs for replay protection, and mark orders paid only after Stripe reports payment as paid. Do not treat the success redirect as proof of payment.
- In the absence of Stripe, checkout creates a clearly labeled preview order and collects no payment.
- A Stripe live key cannot take payment unless `LIVE_CHECKOUT_ENABLED=true`, PostgreSQL is connected, the app URL is HTTPS, the webhook secret is configured, delivery pricing is set, VAT configuration is consistent, and all published products are non-sample listings. The checkout page is disabled while those checks fail.

The V1 persistence layer currently writes the app's state snapshot transactionally for a single app instance. It is a transition from JSON storage, not a multi-instance/higher-volume architecture. Before substantial order volume, migrate mutations to targeted SQL transactions (including atomic inventory holds/decrements), add operational monitoring, and verify restore procedures.

## Stripe and tax launch work

Configure Stripe test mode and verify checkout, cancellation, failed payment, completed payment, duplicate webhook delivery and order status before live mode. Configure the Stripe webhook endpoint at `https://YOUR_DOMAIN/api/stripe-webhook` for Checkout session completion, asynchronous payment success/failure and expiration events. Keep the signing secret in Render environment variables.

UK VAT depends on the business's VAT registration, goods classification and customer/delivery details. The current VAT display is a simple inclusive-price estimate; it is not the tax ledger. Confirm product tax codes and VAT treatment with a qualified adviser and configure Stripe Tax if appropriate. Do not assume bullion is exempt; confirm investment-gold eligibility and treatment for each product. Delivery methods, return/refund processes, privacy notice, customer support contact and legal business details also need owner review.

## Pre-launch checklist

- Create a paid production PostgreSQL database, connect it privately, and verify backups/restores.
- Replace and verify all sample listings, stock, images, prices, specifications, diamond grading/origin and watch authenticity/condition details.
- Configure a custom HTTPS domain, `APP_URL`, Stripe live credentials and webhook signing secret.
- Test payment, cancellation, webhook retries, stock changes, tax, delivery, refunds and owner order management in Stripe test mode.
- Review privacy, consumer terms, returns, delivery, tax classification and customer support information for the business.
- Only after all launch checks, set `LIVE_CHECKOUT_ENABLED=true` in Render and complete a controlled live transaction/refund.

## Deployment references

- [Render PostgreSQL: create and connect](https://render.com/docs/postgresql-creating-connecting)
- [Render free services and database limits](https://render.com/docs/free)
- [Stripe Checkout fulfillment and webhooks](https://docs.stripe.com/payments/checkout/fulfill-orders)

## Owner setup key and database reference

The Owner Studio setup key is **not** a permanent API key. On first startup, if no owner account exists, the server prints `Owner setup key: …` in the Render web service logs. Open the service's **Logs**, find the most recent startup entry, and use that key at `/admin.html` to create your owner username and password. Keep the key private. After creating the owner account, sign in with those credentials; the setup key is no longer your login. If the generated key is no longer available, set a new private `ADMIN_SETUP_KEY` value in the Render service environment and redeploy while owner setup is still pending; the app updates the stored setup key from that value. Do not change this after creating the owner account.

For the table-by-table structure and safe read-only SQL examples, see [`db/SCHEMA.md`](db/SCHEMA.md). The version 6 migration adds more preview catalogue items and removes the sample bespoke product; bespoke is now request-led. New bespoke enquiries save the customer's style, metal, optional gold purity and stone carat, size, approximate weight, optional description, contact details and optional image in the reservations JSONB record. A signed-in customer uses their saved name/email; guests enter their contact details. Attached reference images are limited to 2 MB and remain in PostgreSQL with the request.
