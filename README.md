# BIREQDAR & CO. Storefront V1

A Node.js storefront and owner studio for jewellery, gemstones (including natural and lab-grown diamonds), bullion, bespoke commissions and watches. Product listings, customer accounts, checkout orders, line-item snapshots, reservations, collections, settings and owner/customer sessions can be stored in PostgreSQL. Product image files remain on the host's persistent disk.

For a quick map of the pages, scripts and request flow, see [`CODE_GUIDE.md`](CODE_GUIDE.md).

## Local development

Use Node.js 22 or newer. Install dependencies and start the app:

```sh
npm install
npm start
```

Without `DATABASE_URL`, local development uses `data/store.json`. For a local PostgreSQL database, copy `.env.example` to `.env`, set `DATABASE_URL`, and start the app. On first connection, if PostgreSQL has no store state, the app migrates the existing local JSON store into PostgreSQL; if neither exists it creates sample collections and products. PostgreSQL becomes the primary store after initialization. The uploads folder still needs durable disk storage.

The first local run prints an owner setup key. In production, retrieve `ADMIN_SETUP_KEY` from the Render environment settings; production logs do not reveal it. Use the one-time key at the staff studio (`/<ADMIN_PATH>`, or `/admin.html` in local development) to create the owner login. Do not commit `.env`, database credentials, email or Stripe keys, customer information or order exports.

Customer passwords are stored as Argon2id hashes. Existing scrypt password records are verified on the next successful sign-in and upgraded to Argon2id without requiring a password reset. Customers can request a single-use password-reset link that expires after 30 minutes. Email delivery uses Resend when `RESEND_API_KEY` and `RESEND_FROM_EMAIL` are configured. Verify your sending domain with Resend, then add both values to the Render environment (and `.env` locally). The reset endpoint returns a generic response to avoid revealing which email addresses have accounts.

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

The Owner Studio setup key is **not** a permanent API key. In production, copy `ADMIN_SETUP_KEY` from the Render web service's **Environment** settings and use it once at the staff studio (`/<ADMIN_PATH>`) to create your owner username and password. Keep the key private. After creating the owner account, sign in with those credentials; the setup key is no longer your login. If setup is still pending and the key must be replaced, update the Render environment value and redeploy. Do not change it after creating the owner account.

For the table-by-table structure and safe read-only SQL examples, see [`db/SCHEMA.md`](db/SCHEMA.md). The version 6 migration adds more preview catalogue items and removes the sample bespoke product; bespoke is now request-led. New bespoke enquiries save the customer's style, metal, optional gold purity and stone carat, size, approximate weight, optional description, contact details and optional image in the reservations JSONB record. A signed-in customer uses their saved name/email; guests enter their contact details. Attached reference images are limited to 2 MB and remain in PostgreSQL with the request.


The version 7 data migration inserts fictional preview orders and enquiries so the Owner Studio can be explored before real customers arrive. These records use `example.invalid` contact addresses, carry `isDemo: true`, and preview orders never count as paid revenue. The Analytics view offers a protected action to remove only these seeded examples; it does not delete real orders or enquiries.

## Staff studio: private address, two-factor sign-in and roles

The owner studio is now a staff studio with two roles and mandatory two-factor sign-in.

**Private address.** Set `ADMIN_PATH` to a long private slug (at least 16 letters, digits, `-` or `_`), for example `atelier-q7Hd2LmX9pVr4kTz`. The studio is then served only at `https://<your-domain>/<ADMIN_PATH>`; `/admin.html` returns "Not found", and the page is sent with `noindex` and `no-store` headers. In production the studio is unavailable until `ADMIN_PATH` is set. Treat the address as private, but remember it is not the security boundary — the password and authenticator code are.

**Two-factor sign-in (TOTP).** Every staff account signs in with a password and then a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Apple Passwords, Authy…). The first sign-in after this update shows a setup key to add to the app, then issues 8 one-time recovery codes. Codes cannot be reused, wrong codes are rate-limited, and staff sessions last 8 hours. Sessions created before this update are signed out. Set `STAFF_MFA_KEY` (any long random string) to encrypt authenticator secrets at rest; do not change it once set — if it is lost, sign in with a recovery code and use **Security → Move to a new phone**.

**Roles.**
- **Owner** — everything: products, collections, analytics, orders, customers, enquiries, settings, and the **Team** tab.
- **Catalogue team** — products only: add, edit and remove pieces, upload images and adjust stock. Orders, customer details, enquiries, analytics and settings are refused by the server (HTTP 403), not just hidden.

The owner adds catalogue accounts in **Team** with a temporary password, and can set a new temporary password, reset a member's two-factor, or remove them (which signs them out immediately). Every staff member can create new recovery codes or move their authenticator to a new phone under **Security**.

Staff accounts and two-factor settings are stored inside the existing owner record (`owner_credentials` JSONB in PostgreSQL, or `data/store.json` locally), so no database migration is needed. Security-relevant events (`staff_login_failed`, `staff_mfa_failed`, `staff_forbidden`, `staff_created`, …) are written to the server log.

## 3D product viewer (watches)

Watch pages can show an interactive 3D model next to the photographs: drag to turn (with momentum), pinch or Ctrl/⌘ + scroll to zoom, double-click to reset, arrow keys / + / − / 0 for keyboard users. It is a plain-JavaScript port of React Bits' `<ModelViewer />` (`model-viewer.js`) running on three.js, with studio lighting generated locally so nothing is fetched from other sites. It respects reduced-motion settings and pauses while off-screen.

1. **three.js** — run `npm install three` once. The `postinstall` step (`scripts/vendor-three.js`) copies the few files the viewer needs into `vendor/three/`; Render runs the same step on every deploy.
2. **A model** — add a licensed `.glb` file under `assets/3d/` (or upload it) and enter its path in the Studio product form under **3D model**, e.g. `assets/3d/rolex-gmt-master-ii-batgirl.glb`. Keep models web-sized (ideally under 10 MB, textures ≤ 2048 px).
3. The product page shows **View in 3D** only once that file exists; pieces without photographs open straight into the 3D view.

**Rolex section.** `shop.html?type=watch&brand=rolex` lists Rolex watches with its own header and a "Rolex" quick link. The GMT-Master II "Batgirl" (ref. 126710BLNR) is included as a sample listing (`isDemo`), so production hides it until its condition, year, box and papers, price and stock are verified and "Sample preview listing" is unticked in the Studio.
