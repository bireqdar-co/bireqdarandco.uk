# BIREQDAR&CO. database tables

The PostgreSQL definitions live in [`schema.sql`](schema.sql). The current app stores structured columns for searching and relationships, with a `data JSONB` snapshot for fields that change as the storefront grows.

| Table | What it stores | Main relationships / notes |
| --- | --- | --- |
| `app_state` | Store migration version and owner setup key | Single row (`id = 1`) |
| `store_settings` | Currency, shipping, VAT and store settings | Single JSONB row |
| `owner_credentials` | Owner username and password hash data | Single row; password is hashed by the app |
| `collections` | Gold, Silver, Gemstones, Bullion, Watches and other catalogue groups | Unique slug; active/hidden flag |
| `products` | Jewellery, watch, bullion and bespoke product records | Collection foreign key; price in minor currency units; `is_demo` blocks live sale |
| `customers` | Customer accounts and profile data | Unique email |
| `customer_sessions` | Hashed client login session tokens and expiry | References `customers` |
| `orders` | Order status, customer and payment snapshots, totals and tax | Optional customer relation; Stripe session/reference IDs |
| `order_items` | Snapshot of each ordered product, quantity and unit price | References `orders`; cascades on order deletion |
| `reservations` | Product enquiries, watch requests and bespoke briefs | Request details and attached reference images are in JSONB `data` |
| `owner_sessions` | Hashed owner login session tokens and expiry | No raw session token is stored |
| `stripe_webhook_events` | Stripe event IDs already handled | Prevents processing a webhook event twice |

Amounts such as `price_cents`, `subtotal_cents`, `tax_cents` and `total_cents` are stored as integer pence for GBP (or the smallest unit for the currency). A `data` JSONB snapshot preserves application fields; the indexed columns support lookups and constraints.

To inspect a live database in Render, open the PostgreSQL resource, use its Connect/PSQL command or connect with a database client using the internal URL from the web service's private network. Never publish the URL or credentials. Useful read-only inspection:

```sql
\dt
\d+ products
\d+ orders
SELECT id, name, slug, type, category, price_cents, stock, published, is_demo FROM products ORDER BY type, name;
SELECT id, name, slug, active FROM collections ORDER BY name;
```

The bespoke form stores the enquiry in `reservations.data->'details'`, including style, metal, gold purity, stone carat weight, size, approximate weight, optional description and an optional image data URI. Uploaded enquiry images are kept in PostgreSQL with the request, so they do not depend on an ephemeral Render filesystem.
