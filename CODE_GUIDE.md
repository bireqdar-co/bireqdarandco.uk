# Code guide

This is a small Node.js storefront. The browser renders the pages and catalogue; `server.js` owns customer data, validation, prices, sessions, orders and payment-provider communication.

## Where to make changes

| Area | Files | Responsibility |
| --- | --- | --- |
| Home and shared shell | `index.html`, `styles.css`, `script.js` | Homepage, shared navigation, responsive styles and bag count |
| Catalogue | `shop.html`, `shop.js`, `commerce.css` | Search, collection filters, sorting and product cards |
| Piece details | `product.html`, `product.js` | Loads one published piece by its URL slug |
| Customer journeys | `account.html`, `account.js`, `cart.html`, `cart.js`, `checkout.html`, `checkout.js`, `order.html`, `order.js` | Account access, bag, checkout and order status |
| Enquiries | `contact.html`, `contact.js`, `bespoke.html`, `bespoke.js`, `watch.html` | Contact, bespoke commission and watch enquiries |
| Owner tools | `admin.html`, `admin.js`, `admin.css` | Protected catalogue, order, enquiry and analytics management |
| Server and storage | `server.js`, `postgres-store.js`, `db/schema.sql` | API routes, validation, sessions, database reads/writes and payment checks |
| Deployment | `render.yaml`, `.env.example`, `README.md` | Render settings, local configuration and launch steps |

## Request flow

1. A page loads a focused browser script and shared navigation script.
2. The browser calls `/api/catalog`, `/api/account` or another API route as needed.
3. `server.js` validates the request and performs authorization before reading or changing data.
4. `postgres-store.js` persists production data in PostgreSQL. Local development can use `data/store.json`.
5. Checkout totals are rebuilt by the server from current catalogue prices. The browser bag is only a list of product IDs, quantities and options.

## Safe editing notes

- Keep product text, images and records in the owner catalogue/data store. Do not duplicate product data in page scripts.
- Treat every browser value as untrusted. Validate and authorize changes on the server.
- Never put secrets in browser JavaScript or commit `.env` files.
- Preserve sample records until the owner is ready to replace them; live checkout remains subject to the launch checks in `README.md`.
- Keep shared header/footer markup and labels consistent when changing pages.

## Local checks

Run `npm start`, then review the homepage, catalogue filters, piece detail, account tabs, bespoke form, bag, checkout availability, order lookup and owner sign-in. For JavaScript syntax checks, use `node --check` on the changed `.js` files. Do not submit real customer or payment data while checking the flow.
