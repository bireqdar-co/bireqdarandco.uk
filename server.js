const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const fsSync = require('node:fs');
const envFile = path.join(__dirname, '.env');
try { for (const line of fsSync.readFileSync(envFile, 'utf8').split(/\r?\n/)) { const m=line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/); if (m && process.env[m[1]]===undefined) process.env[m[1]]=m[2].replace(/^['"]|['"]$/g,''); } } catch {}
const { URL } = require('node:url');

const ROOT = __dirname;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(ROOT, 'uploads'));
const DB_FILE = path.join(DATA_DIR, 'store.json');
let postgresStore = null;
const PORT = Number(process.env.PORT || 3000);
// Render routes public traffic to 0.0.0.0; keep this as the default if HOST isn't configured.
const HOST = process.env.HOST || '0.0.0.0';
const APP_URL = process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || '';
const MAX_BODY = 7 * 1024 * 1024;
const allowedCurrencies = new Set(['GBP', 'EUR', 'USD']);
let setupKeyLogged = false;

const id = () => crypto.randomUUID();
const shortRef = () => crypto.randomBytes(5).toString('hex').toUpperCase();
const tokenHash = token => crypto.createHash('sha256').update(String(token || '')).digest('hex');
const slugify = s => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70);
const safeEqual = (a, b) => {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
};

function seed() {
  const collections = [
    { id: 'col-gold', name: 'Gold', slug: 'gold', description: 'Gold jewellery', active: true },
    { id: 'col-silver', name: 'Silver', slug: 'silver', description: 'Silver jewellery', active: true },
    { id: 'col-diamond', name: 'Diamonds', slug: 'diamonds', description: 'Natural and lab-grown diamond jewellery', active: true },
    { id: 'col-gemstones', name: 'Gemstones', slug: 'gemstones', description: 'Coloured gemstones, natural diamonds and lab-grown diamonds', active: true },
    { id: 'col-bullion', name: 'Bullion', slug: 'bullion', description: 'Precious metal bullion', active: true },
    { id: 'col-watches', name: 'Watches', slug: 'watches', description: 'Luxury timepieces', active: true },
    { id: 'col-bespoke', name: 'Bespoke', slug: 'bespoke', description: 'Made-to-order commissions', active: true }
  ];
  const products = [
    { id:'demo-gold', slug:'gold-pendant-sample', name:'Gold Pendant — Sample Listing', type:'jewellery', category:'pendants', collectionId:'col-gold', short:'Sample catalogue item. Replace with verified product details.', description:'This is demonstration content for the Version One preview. Add real materials, dimensions, imagery and verified product information in the owner area.', priceCents:65000, stock:3, currency:'GBP', image:'', published:true, isDemo:true, inquiryOnly:false, specifications:[] },
    { id:'demo-silver', slug:'silver-bracelet-sample', name:'Silver Bracelet — Sample Listing', type:'jewellery', category:'bracelets', collectionId:'col-silver', short:'Sample catalogue item. Replace with verified product details.', description:'This is demonstration content for the Version One preview. Add real materials, dimensions, imagery and verified product information in the owner area.', priceCents:18000, stock:4, currency:'GBP', image:'', published:true, isDemo:true, inquiryOnly:false, specifications:[] },
    { id:'demo-diamond', slug:'diamond-studs-sample', name:'Natural Diamond Stud Earrings — Sample Listing', type:'jewellery', gemstoneType:'natural-diamond', category:'earrings', collectionId:'col-diamond', short:'A natural diamond sample listing.', description:'This is demonstration content for the Version One preview. Add the diamond origin, grading information, materials and verified product details before selling.', priceCents:120000, stock:2, currency:'GBP', image:'', published:true, isDemo:true, inquiryOnly:false, specifications:[] },
    { id:'demo-necklace', slug:'gold-necklace-sample', name:'Gold Necklace — Sample Listing', type:'jewellery', category:'necklaces', collectionId:'col-gold', short:'A sample necklace listing for testing the shop.', description:'Demonstration content only. Replace with verified materials, dimensions, imagery and product information before launch.', priceCents:185000, stock:2, currency:'GBP', image:'', published:true, isDemo:true, inquiryOnly:false, specifications:[] },
    { id:'demo-diamond-pendant', slug:'lab-grown-diamond-pendant-sample', name:'Lab-Grown Diamond Pendant — Sample Listing', type:'jewellery', gemstoneType:'lab-grown-diamond', category:'pendants', collectionId:'col-diamond', short:'A lab-grown diamond sample listing for testing the shop.', description:'Demonstration content only. Add the diamond origin, grading, materials, dimensions and verified product information before launch.', priceCents:215000, stock:1, currency:'GBP', image:'', published:true, isDemo:true, inquiryOnly:false, specifications:[] },
    { id:'demo-gemstone', slug:'sapphire-ring-sample', name:'Sapphire Ring — Sample Listing', type:'jewellery', gemstoneType:'gemstone', category:'rings', collectionId:'col-gemstones', short:'A coloured gemstone sample listing. Replace with verified stone and setting details.', description:'Demonstration listing featuring a sapphire. Add verified stone origin, treatment, dimensions, setting and product photography before launch.', priceCents:98000, stock:1, currency:'GBP', image:'', published:true, isDemo:true, inquiryOnly:false, specifications:[] },
    { id:'demo-bespoke-ring', slug:'bespoke-ring-sample', name:'Bespoke Ring — Enquiry Sample', type:'bespoke', category:'rings', collectionId:'col-bespoke', short:'A sample bespoke ring commission.', description:'Demonstration content only. Enquire to discuss a made-to-order design, materials, timeline and quotation.', priceCents:null, stock:0, currency:'GBP', image:'', published:true, isDemo:true, inquiryOnly:true, specifications:[] },
    { id:'demo-bullion', slug:'gold-bar-enquiry-sample', name:'Gold Bar — Enquiry Sample', type:'bullion', bullionType:'gold-bar', category:'', collectionId:'col-bullion', short:'Preview listing. Ask about weight, purity, availability and pricing.', description:'Demonstration listing only. Confirm the specific bar, weight, purity, tax treatment and availability before purchase.', priceCents:null, stock:0, currency:'GBP', image:'', published:true, isDemo:true, inquiryOnly:true, specifications:[] },
    { id:'demo-gold-coin', slug:'gold-coin-enquiry-sample', name:'Gold Coin — Enquiry Sample', type:'bullion', bullionType:'gold-coin', category:'', collectionId:'col-bullion', short:'Preview listing. Ask about coin, year, condition and availability.', description:'Demonstration listing only. Confirm the coin, year, condition, tax treatment, pricing and availability before purchase.', priceCents:null, stock:0, currency:'GBP', image:'', published:true, isDemo:true, inquiryOnly:true, specifications:[] },
    { id:'demo-silver-bar', slug:'silver-bar-enquiry-sample', name:'Silver Bar — Enquiry Sample', type:'bullion', bullionType:'silver-bar', category:'', collectionId:'col-bullion', short:'Preview listing. Ask about weight, purity and availability.', description:'Demonstration listing only. Confirm weight, purity, tax treatment, pricing and availability before purchase.', priceCents:null, stock:0, currency:'GBP', image:'', published:true, isDemo:true, inquiryOnly:true, specifications:[] },
    { id:'demo-silver-coin', slug:'silver-coin-enquiry-sample', name:'Silver Coin — Enquiry Sample', type:'bullion', bullionType:'silver-coin', category:'', collectionId:'col-bullion', short:'Preview listing. Ask about coin, year, condition and availability.', description:'Demonstration listing only. Confirm the coin, year, condition, tax treatment, pricing and availability before purchase.', priceCents:null, stock:0, currency:'GBP', image:'', published:true, isDemo:true, inquiryOnly:true, specifications:[] },
    { id:'demo-limited-bullion', slug:'limited-edition-bullion-enquiry-sample', name:'Limited Edition Bullion — Enquiry Sample', type:'bullion', bullionType:'limited-edition', category:'', collectionId:'col-bullion', short:'Preview listing for a limited edition bullion piece.', description:'Demonstration listing only. Confirm edition, weight, purity, tax treatment, pricing and availability before purchase.', priceCents:null, stock:0, currency:'GBP', image:'', published:true, isDemo:true, inquiryOnly:true, specifications:[] },
    { id:'demo-watch', slug:'watch-enquiry-sample', name:'Watch — Enquiry Sample', type:'watch', brand:'', category:'', collectionId:'col-watches', short:'Ask about the current selection and verified specifications.', description:'Sample watch listing. Add the brand, reference, condition, included items, price and verified specifications before publication.', priceCents:null, stock:0, currency:'GBP', image:'', published:true, isDemo:true, inquiryOnly:true, specifications:[] }
  ];
  return { version:4, customers:[], customerSessions:{}, setupKey: process.env.ADMIN_SETUP_KEY || crypto.randomBytes(24).toString('hex'), admin:null, sessions:{}, settings:{ currency:'GBP', storeName:'BIREQDAR&CO.', shippingCents:null, automaticTaxEnabled:false, vatRegistered:false }, collections, products, orders:[], reservations:[] };
}

let db;
let writeQueue = Promise.resolve();
async function loadDb() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  let needsSave = false;
  if (process.env.DATABASE_URL) {
    const { PostgresStore } = require('./postgres-store');
    postgresStore = new PostgresStore(process.env.DATABASE_URL);
    await postgresStore.initialize();
    db = await postgresStore.load();
  }
  if (!db) {
    try { db = JSON.parse(await fs.readFile(DB_FILE, 'utf8')); }
    catch (err) { if (err.code !== 'ENOENT') throw err; db = seed(); needsSave = true; }
    if (postgresStore) needsSave = true;
  }
  if (!Array.isArray(db.products)) db.products = [];
  if (!Array.isArray(db.customers)) db.customers = [];
  if (!db.customerSessions) db.customerSessions = {};
  if (!Array.isArray(db.collections)) db.collections = [];
  if (!Array.isArray(db.orders)) db.orders = [];
  if (!Array.isArray(db.reservations)) db.reservations = [];
  if (!db.sessions) db.sessions = {};
  if (!db.settings) db.settings = { currency:'GBP', storeName:'BIREQDAR&CO.', shippingCents:null, automaticTaxEnabled:false };
  if (db.settings.shippingCents === undefined) db.settings.shippingCents = null;
  if (db.settings.automaticTaxEnabled === undefined) db.settings.automaticTaxEnabled = false;
  if (db.settings.vatRegistered === undefined) db.settings.vatRegistered = false;
  if (!Array.isArray(db.processedStripeEvents)) db.processedStripeEvents = [];
  let migrated=false;
  const watches=db.collections.find(c=>c.id==='col-watches');
  if(watches&&(watches.name==='Luxury Watches'||watches.slug==='luxury-watches')){watches.name='Watches';watches.slug='watches';watches.description='Luxury timepieces';migrated=true;}
  if(Number(db.version||0)<2){
    const inferred={ 'demo-gold':'pendants','demo-silver':'bracelets','demo-diamond':'earrings' };
    for(const p of db.products) if(!p.category&&inferred[p.id]){p.category=inferred[p.id];if(p.id==='demo-diamond')p.name='Diamond Stud Earrings — Sample Listing';migrated=true;}
    const extra=seed().products.filter(p=>!db.products.some(x=>x.id===p.id));
    if(extra.length){db.products.push(...extra);migrated=true;}
    db.version=2;migrated=true;
  }
  if(Number(db.version||0)<3){const seeded=seed().products;for(const p of seeded){const old=db.products.find(x=>x.id===p.id);if(!old)db.products.push(p);else if(p.id==='demo-bullion'){old.name=p.name;old.slug=p.slug;old.bullionType=p.bullionType;old.short=p.short;old.description=p.description;}}db.version=3;migrated=true;}
  if(Number(db.version||0)<4){
    const gemstoneCollection={id:'col-gemstones',name:'Gemstones',slug:'gemstones',description:'Coloured gemstones, natural diamonds and lab-grown diamonds',active:true};
    if(!db.collections.some(c=>c.id===gemstoneCollection.id))db.collections.push(gemstoneCollection);
    for(const seedProduct of seed().products){const old=db.products.find(p=>p.id===seedProduct.id);if(!old)db.products.push(seedProduct);else if(['demo-diamond','demo-diamond-pendant'].includes(old.id)){old.gemstoneType=seedProduct.gemstoneType;old.name=seedProduct.name;old.slug=seedProduct.slug;old.short=seedProduct.short;}}
    db.version=4;migrated=true;
  }
  for(const p of db.products){if(!Number.isFinite(Number(p.vatRate))){p.vatRate=20;migrated=true;}if(p.brand===undefined){p.brand='';migrated=true;}if(p.bullionType===undefined){p.bullionType='';migrated=true;}if(p.gemstoneType===undefined){p.gemstoneType='';migrated=true;}}
  for (const key of Object.keys(db.sessions)) {
    if (!/^[a-f0-9]{64}$/.test(key)) { db.sessions[tokenHash(key)] = db.sessions[key]; delete db.sessions[key]; migrated = true; }
  }
  for (const key of Object.keys(db.customerSessions)) {
    if (!/^[a-f0-9]{64}$/.test(key)) { db.customerSessions[tokenHash(key)] = db.customerSessions[key]; delete db.customerSessions[key]; migrated = true; }
  }
  if(migrated||needsSave)await saveDb();
  if (!db.admin && !setupKeyLogged) { console.log(`Owner setup key: ${db.setupKey || 'set ADMIN_SETUP_KEY in the environment'}`); setupKeyLogged = true; }
}
function saveDb() {
  // Capture a consistent point-in-time snapshot before waiting behind previous writes.
  const snapshot = structuredClone(db);
  const serialized = postgresStore ? null : JSON.stringify(snapshot, null, 2);
  // Recover the queue after an individual disk failure so later writes can retry.
  writeQueue = writeQueue.catch(() => {}).then(async () => {
    if (postgresStore) return postgresStore.save(snapshot);
    const tmp = `${DB_FILE}.${process.pid}.tmp`;
    await fs.writeFile(tmp, serialized, { mode: 0o600 });
    await fs.rename(tmp, DB_FILE);
  });
  return writeQueue;
}
function send(res, status, payload, extra={}) {
  res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', ...extra });
  res.end(JSON.stringify(payload));
}
function text(res, status, value, type='text/plain; charset=utf-8', extra={}) {
  res.writeHead(status, { 'Content-Type':type, 'Cache-Control':'no-store', ...extra }); res.end(value);
}
async function readRaw(req) {
  const chunks=[]; let length=0;
  for await (const chunk of req) { length += chunk.length; if (length > MAX_BODY) throw Object.assign(new Error('Request too large'), { status:413 }); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
async function readJson(req) {
  const raw=await readRaw(req);
  try { return raw.length ? JSON.parse(raw.toString('utf8')) : {}; }
  catch { throw Object.assign(new Error('Invalid JSON'), { status:400 }); }
}
function clean(s, max=5000) { return String(s ?? '').trim().slice(0,max); }
function validEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254; }
function publicProduct(p) {
  return { id:p.id, slug:p.slug, name:p.name, type:p.type, category:p.category||'', collectionId:p.collectionId, short:p.short, description:p.description, priceCents:p.priceCents, stock:p.stock, currency:p.currency || db.settings.currency, image:p.image, inquiryOnly:!!p.inquiryOnly, isDemo:!!p.isDemo, specifications:Array.isArray(p.specifications)?p.specifications:[], vatRate:Number.isFinite(Number(p.vatRate))?Number(p.vatRate):20, brand:p.brand||'', bullionType:p.bullionType||'', gemstoneType:p.gemstoneType||'' };
}
function sessionFrom(req) {
  const cookie=String(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('bireqdar_session='));
  return cookie ? tokenHash(decodeURIComponent(cookie.slice('bireqdar_session='.length))) : '';
}
function customerTokenFrom(req) {
  const cookie=String(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('bireqdar_customer_session='));
  return cookie ? tokenHash(decodeURIComponent(cookie.slice('bireqdar_customer_session='.length))) : '';
}
function customerSession(req) {
  const token=customerTokenFrom(req), session=db.customerSessions[token];
  if(!token||!session||session.expiresAt<Date.now()){if(token&&session){delete db.customerSessions[token];saveDb()}return null;}
  return {token,customer:db.customers.find(c=>c.id===session.customerId)||null};
}
function publicCustomer(customer) { return {id:customer.id,name:customer.name,email:customer.email}; }
function customerCookie(token,maxAge=2592000) { const secure=APP_URL.startsWith('https://')?' Secure;':'';return `bireqdar_customer_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge};${secure}`; }
function adminCookie(token,maxAge=43200) { const secure=APP_URL.startsWith('https://')?' Secure;':'';return `bireqdar_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge};${secure}`; }
function issueCustomerSession(customer) { const token=crypto.randomBytes(32).toString('hex');db.customerSessions[tokenHash(token)]={customerId:customer.id,expiresAt:Date.now()+30*24*60*60*1000};return token; }
function requireAdmin(req,res) {
  const token=sessionFrom(req); const expires=db.sessions[token];
  if (!token || !expires || expires < Date.now()) { if (token) { delete db.sessions[token]; saveDb(); } send(res,401,{error:'Please sign in to the owner area.'}); return false; }
  return true;
}
function productInput(input, existing=null) {
  const name=clean(input.name,120);
  const type=clean(input.type,24);
  if (name.length < 2) throw Object.assign(new Error('Add a product name.'),{status:400});
  if (!['jewellery','watch','bullion','bespoke'].includes(type)) throw Object.assign(new Error('Choose a valid product type.'),{status:400});
  const currency=String(input.currency || db.settings.currency || 'GBP').toUpperCase();
  if (!allowedCurrencies.has(currency)) throw Object.assign(new Error('Choose GBP, EUR or USD.'),{status:400});
  const rawPrice= input.priceCents === null || input.priceCents === '' ? null : Number(input.priceCents);
  if (rawPrice !== null && (!Number.isInteger(rawPrice) || rawPrice < 0 || rawPrice > 100000000)) throw Object.assign(new Error('Price must be a non-negative amount in pence/cents.'),{status:400});
  const inquiryOnly=!!input.inquiryOnly || rawPrice === null;
  const category=clean(input.category,24);
  if(category&&!['necklaces','pendants','earrings','bracelets','rings'].includes(category))throw Object.assign(new Error('Choose a valid jewellery style.'),{status:400});
  const brand=clean(input.brand,60); if(brand&&!['Rolex','Patek Philippe','Audemars Piguet','Cartier','Omega','Richard Mille','Vacheron Constantin'].includes(brand))throw Object.assign(new Error('Choose one of the supported watch brands.'),{status:400});
  const bullionType=clean(input.bullionType,40); if(bullionType&&!['gold-bar','gold-coin','silver-bar','silver-coin','limited-edition'].includes(bullionType))throw Object.assign(new Error('Choose a valid bullion collection.'),{status:400});
  const gemstoneType=clean(input.gemstoneType,40); if(gemstoneType&&!['gemstone','natural-diamond','lab-grown-diamond'].includes(gemstoneType))throw Object.assign(new Error('Choose a valid gemstone category.'),{status:400});
  const vatRate=Number(input.vatRate===undefined?(existing?.vatRate??20):input.vatRate);
  if(![0,20].includes(vatRate))throw Object.assign(new Error('Choose a VAT rate of 20% or 0% for an applicable exemption/zero rate.'),{status:400});
  const collectionId=clean(input.collectionId,100);
  if (collectionId && !db.collections.some(c=>c.id===collectionId)) throw Object.assign(new Error('Choose an existing collection.'),{status:400});
  return {
    ...(existing||{}), id:existing?.id || id(), slug:existing?.slug || `${slugify(name)}-${crypto.randomBytes(2).toString('hex')}`,
    name, type, category, collectionId, vatRate, brand:type==='watch'?brand:'', bullionType:type==='bullion'?bullionType:'', gemstoneType:type==='jewellery'?gemstoneType:'', short:clean(input.short,220), description:clean(input.description,5000),
    priceCents:inquiryOnly?null:rawPrice, stock:Math.max(0,Math.min(100000,Math.floor(Number(input.stock)||0))), currency,
    image:clean(input.image,1000), published:!!input.published, isDemo:!!input.isDemo, inquiryOnly,
    specifications:Array.isArray(input.specifications)?input.specifications.slice(0,20).map(x=>({label:clean(x.label,60),value:clean(x.value,160)})).filter(x=>x.label&&x.value):[]
  };
}
async function persistImage(input) {
  const data=clean(input,6*1024*1024);
  const match=data.match(/^data:image\/(png|jpeg|webp);base64,([a-zA-Z0-9+/=]+)$/);
  if (!match) throw Object.assign(new Error('Upload a PNG, JPEG or WebP image.'),{status:400});
  const buffer=Buffer.from(match[2],'base64');
  if (buffer.length > 4*1024*1024) throw Object.assign(new Error('Images must be under 4 MB.'),{status:413});
  const ext=match[1]==='jpeg'?'jpg':match[1]; const filename=`${crypto.randomUUID()}.${ext}`;
  await fs.writeFile(path.join(UPLOAD_DIR,filename),buffer,{flag:'wx'});
  return `/uploads/${filename}`;
}
function assertLiveCheckoutReady(items) {
  const key = process.env.STRIPE_SECRET_KEY || '';
  if (!key.startsWith('sk_live_')) return;
  if (process.env.LIVE_CHECKOUT_ENABLED !== 'true') throw Object.assign(new Error('Live payments are disabled until the store owner completes launch checks.'),{status:503});
  if (!postgresStore) throw Object.assign(new Error('Live checkout requires the connected PostgreSQL database.'),{status:503});
  if (!APP_URL.startsWith('https://') || !process.env.STRIPE_WEBHOOK_SECRET) throw Object.assign(new Error('Configure the secure store URL and Stripe payment webhook before live checkout.'),{status:503});
  if (db.settings.shippingCents === null || db.settings.shippingCents === undefined) throw Object.assign(new Error('Configure the delivery fee before live checkout.'),{status:503});
  if (db.settings.vatRegistered && !db.settings.automaticTaxEnabled) throw Object.assign(new Error('Configure Stripe automatic tax before live checkout.'),{status:503});
  if ((items || []).some(item => item.isDemo)) throw Object.assign(new Error('Sample products cannot be sold with live payments.'),{status:400});
}
async function stripeCheckout(order, req) {
  const key=process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  assertLiveCheckoutReady(order.items);
  if (order.items.some(item=>item.isDemo)) {
    if (key.startsWith('sk_live_')) throw Object.assign(new Error('Sample listings cannot be charged in live mode. Replace them with verified products first.'),{status:400});
    return null;
  }
  if (!key.startsWith('sk_test_') && !key.startsWith('sk_live_')) throw Object.assign(new Error('Stripe secret key is not valid.'),{status:503});
  const host=APP_URL || `http://${req.headers.host}`;
  const params=new URLSearchParams();
  params.set('mode','payment'); params.set('success_url',`${host}/order.html?ref=${encodeURIComponent(order.reference)}&session_id={CHECKOUT_SESSION_ID}`); params.set('cancel_url',`${host}/checkout.html?cancelled=1`);
  params.set('customer_email',order.customer.email); params.set('client_reference_id',order.reference); params.set('metadata[orderId]',order.id);
  if (db.settings.automaticTaxEnabled) params.set('automatic_tax[enabled]','true');
  order.items.forEach((it,i)=>{
    params.set(`line_items[${i}][price_data][currency]`,it.currency.toLowerCase()); params.set(`line_items[${i}][price_data][unit_amount]`,String(it.priceCents)); params.set(`line_items[${i}][price_data][tax_behavior]`,'inclusive'); params.set(`line_items[${i}][price_data][product_data][name]`,it.name); if(it.vatRate===0)params.set(`line_items[${i}][price_data][product_data][tax_code]`,'txcd_00000000'); params.set(`line_items[${i}][quantity]`,String(it.quantity));
  });
  if (Number(db.settings.shippingCents)>0) { const i=order.items.length; params.set(`line_items[${i}][price_data][currency]`,order.currency.toLowerCase()); params.set(`line_items[${i}][price_data][unit_amount]`,String(db.settings.shippingCents)); params.set(`line_items[${i}][price_data][tax_behavior]`,'inclusive'); params.set(`line_items[${i}][price_data][product_data][name]`,'Delivery'); params.set(`line_items[${i}][quantity]`,'1'); }
  const response=await fetch('https://api.stripe.com/v1/checkout/sessions',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':`checkout-${order.checkoutRequestId||order.id}`},body:params});
  const data=await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error?.message || 'Could not start secure checkout.'),{status:502});
  return data;
}
function computeOrder(lines, country='') {
  if (!Array.isArray(lines)||lines.length<1||lines.length>30) throw Object.assign(new Error('Your bag is empty or contains too many items.'),{status:400});
  const items=[]; let total=0; let tax=0; let currency=null; const requestedByProduct=new Map(); const now=Date.now(); const reservedByProduct=new Map();
  // Stripe Checkout sessions expire after 24 hours. Treat still-pending paid-flow orders as
  // temporary stock holds, so parallel checkouts cannot sell the same last item twice.
  for(const order of db.orders){if(order.status!=='payment_pending'||order.paymentMode!=='stripe'||now-Date.parse(order.createdAt)>=24*60*60*1000)continue;for(const item of order.items||[])reservedByProduct.set(item.id,(reservedByProduct.get(item.id)||0)+Number(item.quantity||0));}
  const countryText=String(country||'').trim(); const ukCountry=/(^|[^a-z])(uk|gb)(?=$|[^a-z])|united kingdom|great britain|britain|england|scotland|wales|northern ireland/i.test(countryText); const uk=db.settings.vatRegistered&&ukCountry;
  for (const line of lines) {
    const p=db.products.find(x=>x.id===line.id && x.published);
    const qty=Math.floor(Number(line.quantity));
    if (!p || p.type==='watch' || p.inquiryOnly || p.priceCents===null) throw Object.assign(new Error('One item in your bag can no longer be purchased. Please refresh your bag.'),{status:409});
    if (!Number.isInteger(qty)||qty<1||qty>10) throw Object.assign(new Error('Choose a quantity between 1 and 10.'),{status:400});
    const requested=(requestedByProduct.get(p.id)||0)+qty;const available=p.stock-(reservedByProduct.get(p.id)||0);if(available<requested)throw Object.assign(new Error(`${p.name} does not have enough stock available for all selected finishes.`),{status:409});requestedByProduct.set(p.id,requested);
    if (currency && currency!==p.currency) throw Object.assign(new Error('Your bag must use one currency. Remove items using another currency.'),{status:400});
    currency=p.currency; const finish=clean(line.finish,40); if(finish&&!['Silver','Yellow Gold Plated','Rose Gold Plated'].includes(finish))throw Object.assign(new Error('Choose a valid finish for this piece.'),{status:400}); if(finish&&p.collectionId!=='col-silver')throw Object.assign(new Error('This finish is not available for the selected piece.'),{status:400}); const vatRate=Number.isFinite(Number(p.vatRate))?Number(p.vatRate):20; const item={id:p.id,slug:p.slug,name:p.name+(finish?` — ${finish}`:''),priceCents:p.priceCents,currency:p.currency,quantity:qty,isDemo:!!p.isDemo,vatRate,finish}; items.push(item); const lineTotal=p.priceCents*qty; total+=lineTotal; if(uk&&vatRate>0)tax+=Math.round(lineTotal*vatRate/(100+vatRate));
  }
  return {items,total,tax,currency:currency||db.settings.currency};
}
async function handleApi(req,res,url) {
  const route=url.pathname;
  if (req.method==='GET' && route==='/api/catalog') {
    const liveKey=(process.env.STRIPE_SECRET_KEY||'').startsWith('sk_live_');
    const checkoutAvailable=!liveKey||(process.env.LIVE_CHECKOUT_ENABLED==='true'&&!!postgresStore&&APP_URL.startsWith('https://')&&!!process.env.STRIPE_WEBHOOK_SECRET&&db.settings.shippingCents!==null&&db.settings.shippingCents!==undefined&&(!db.settings.vatRegistered||db.settings.automaticTaxEnabled)&&!db.products.some(p=>p.published&&p.isDemo));
    return send(res,200,{products:db.products.filter(p=>p.published).map(publicProduct),collections:db.collections.filter(c=>c.active).map(({id,name,slug,description})=>({id,name,slug,description})),currency:db.settings.currency,storeName:db.settings.storeName,shippingCents:db.settings.shippingCents,paymentConfigured:!!process.env.STRIPE_SECRET_KEY,checkoutAvailable,vatRegistered:!!db.settings.vatRegistered});
  }
  if (req.method==='GET' && route==='/api/product') {
    const p=db.products.find(x=>x.slug===url.searchParams.get('slug')&&x.published); return p?send(res,200,{product:publicProduct(p),collection:db.collections.find(c=>c.id===p.collectionId)?.name||''}):send(res,404,{error:'This piece is not available.'});
  }
  if (req.method==='POST' && route==='/api/reservations') {
    const b=await readJson(req); const name=clean(b.name,100), email=clean(b.email,254), message=clean(b.message,3000), reference=clean(b.reference,160), type=clean(b.type,30);
    if (!name||!validEmail(email)||!message) return send(res,400,{error:'Add your name, a valid email and a message so we can follow up.'});
    if (clean(b.website,100)) return send(res,200,{ok:true});
    const reservation={id:id(),reference:`BQ-${shortRef()}`,name,email,phone:clean(b.phone,40),message,productReference:reference,type:type||'enquiry',createdAt:new Date().toISOString(),status:'new'};
    db.reservations.unshift(reservation); await saveDb(); return send(res,201,{ok:true,reference:reservation.reference,message:'Your enquiry has been recorded.'});
  }
  if (route.startsWith('/api/account')) {
    if(req.method==='GET'&&route==='/api/account'){
      const session=customerSession(req);if(!session?.customer)return send(res,200,{authenticated:false});
      const orders=db.orders.filter(o=>o.customerId===session.customer.id).slice(0,30).map(o=>({reference:o.reference,createdAt:o.createdAt,status:o.status,totalCents:o.totalCents,currency:o.currency,items:o.items.map(i=>({name:i.name,quantity:i.quantity}))}));
      return send(res,200,{authenticated:true,customer:publicCustomer(session.customer),orders});
    }
    if(req.method==='POST'&&route==='/api/account/register'){
      const b=await readJson(req),name=clean(b.name,100),email=clean(b.email,254).toLowerCase(),password=String(b.password||''),ip=`customer:${req.socket.remoteAddress}`,now=Date.now();
      const recent=(loginAttempts.get(ip)||[]).filter(t=>now-t<15*60*1000);if(recent.length>=8)return send(res,429,{error:'Too many attempts. Please wait 15 minutes and try again.'});
      if(name.length<2||!validEmail(email)||password.length<12||password.length>200)return send(res,400,{error:'Enter your name, a valid email and a password of at least 12 characters.'});
      if(db.customers.some(c=>c.email===email)){recent.push(now);loginAttempts.set(ip,recent);return send(res,409,{error:'An account with this email already exists. Please sign in.'});}
      const salt=crypto.randomBytes(16).toString('hex'),hash=crypto.scryptSync(password,salt,64).toString('hex');const customer={id:id(),name,email,salt,hash,createdAt:new Date().toISOString()};db.customers.push(customer);const token=issueCustomerSession(customer);await saveDb();loginAttempts.delete(ip);return send(res,201,{authenticated:true,customer:publicCustomer(customer)},{'Set-Cookie':customerCookie(token)});
    }
    if(req.method==='POST'&&route==='/api/account/login'){
      const b=await readJson(req),email=clean(b.email,254).toLowerCase(),password=String(b.password||''),ip=`customer:${req.socket.remoteAddress}`,now=Date.now();const recent=(loginAttempts.get(ip)||[]).filter(t=>now-t<15*60*1000);if(recent.length>=8)return send(res,429,{error:'Too many attempts. Please wait 15 minutes and try again.'});
      const customer=db.customers.find(c=>c.email===email);if(!customer||!safeEqual(crypto.scryptSync(password,customer.salt,64).toString('hex'),customer.hash)){recent.push(now);loginAttempts.set(ip,recent);return send(res,401,{error:'Email or password is incorrect.'});}
      loginAttempts.delete(ip);const token=issueCustomerSession(customer);await saveDb();return send(res,200,{authenticated:true,customer:publicCustomer(customer)},{'Set-Cookie':customerCookie(token)});
    }
    if(req.method==='POST'&&route==='/api/account/logout'){
      const token=customerTokenFrom(req);delete db.customerSessions[token];await saveDb();return send(res,200,{ok:true},{'Set-Cookie':customerCookie('',0)});
    }
    return send(res,404,{error:'Account route not found.'});
  }
  if (req.method==='POST' && route==='/api/checkout') {
    const b=await readJson(req); const customer={name:clean(b.name,100),email:clean(b.email,254),phone:clean(b.phone,40),address1:clean(b.address1,160),address2:clean(b.address2,160),city:clean(b.city,100),postalCode:clean(b.postalCode,30),country:clean(b.country,80)};
    if (!customer.name||!validEmail(customer.email)||!customer.address1||!customer.city||!customer.postalCode||!customer.country) return send(res,400,{error:'Complete your name, email and delivery address.'});
    if (b.acceptTerms!==true) return send(res,400,{error:'Please confirm your delivery details and privacy notice.'});
    const account=customerSession(req)?.customer||null;if(account){customer.name=account.name;customer.email=account.email;}
    const requestId= /^[a-f0-9-]{36}$/i.test(String(b.requestId||'')) ? String(b.requestId).toLowerCase() : id();
    const prior=db.orders.find(o=>o.checkoutRequestId===requestId);
    if(prior){
      if(prior.paymentMode==='stripe'){
        const session=await stripeCheckout(prior,req);
        if(session){prior.stripeSessionId=session.id;await saveDb();return send(res,200,{ok:true,redirectUrl:session.url,reference:prior.reference});}
      }
      return send(res,200,{ok:true,preview:true,reference:prior.reference,redirectUrl:`/order.html?ref=${encodeURIComponent(prior.reference)}&preview=1`});
    }
    const totals=computeOrder(b.items,customer.country); assertLiveCheckoutReady(totals.items); const shippingCents=Number.isInteger(db.settings.shippingCents)?db.settings.shippingCents:0;
    const order={id:id(),reference:`BC-${shortRef()}`,checkoutRequestId:requestId,createdAt:new Date().toISOString(),status:'payment_pending',paymentMode:process.env.STRIPE_SECRET_KEY&&!totals.items.some(item=>item.isDemo)?'stripe':'preview',customer,customerId:account?.id||null,items:totals.items,subtotalCents:totals.total,taxCents:totals.tax,shippingCents,totalCents:totals.total+shippingCents,currency:totals.currency};
    db.orders.unshift(order); await saveDb();
    try {
      const session=await stripeCheckout(order,req);
      if (session) { order.stripeSessionId=session.id; order.paymentMode='stripe'; await saveDb(); return send(res,200,{ok:true,redirectUrl:session.url,reference:order.reference}); }
    } catch(err) { order.status='checkout_error';order.checkoutErrorAt=new Date().toISOString();await saveDb(); throw err; }
    return send(res,200,{ok:true,preview:true,reference:order.reference,redirectUrl:`/order.html?ref=${encodeURIComponent(order.reference)}&preview=1`});
  }
  if (req.method==='GET' && route==='/api/order') {
    const ref=clean(url.searchParams.get('ref'),30).toUpperCase(); const order=db.orders.find(x=>x.reference===ref);
    return order?send(res,200,{reference:order.reference,status:order.status,paymentMode:order.paymentMode,items:order.items,totalCents:order.totalCents,subtotalCents:order.subtotalCents,shippingCents:order.shippingCents,taxCents:order.taxCents,currency:order.currency,createdAt:order.createdAt}):send(res,404,{error:'Order not found. Check the order reference.'});
  }
  if (req.method==='POST' && route==='/api/stripe-webhook') {
    const raw=await readRaw(req); const secret=process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) return text(res,503,'Webhook is not configured.');
    const sig=String(req.headers['stripe-signature']||''); const parts=sig.split(',').map(p=>p.trim().split('='));
    const timestampText=parts.find(([key])=>key==='t')?.[1]||''; const timestamp=Number(timestampText); const signatures=parts.filter(([key])=>key==='v1').map(([,value])=>value);
    const age=Math.abs(Date.now()/1000-timestamp);
    if (!timestampText||!Number.isFinite(timestamp)||age>300) return text(res,400,'Invalid or expired signature.');
    const expected=crypto.createHmac('sha256',secret).update(`${timestampText}.${raw.toString('utf8')}`).digest('hex');
    if (!signatures.some(signature=>safeEqual(expected,signature))) return text(res,400,'Invalid signature.');
    let event; try { event=JSON.parse(raw.toString('utf8')); } catch { return text(res,400,'Invalid event.'); }
    const eventId=clean(event.id,255);
    if (eventId && postgresStore && await postgresStore.hasWebhookEvent(eventId)) return text(res,200,'ok');
    if (eventId && !postgresStore && db.processedStripeEvents.includes(eventId)) return text(res,200,'ok');
    if (event.type==='checkout.session.completed' || event.type==='checkout.session.async_payment_succeeded') {
      const session=event.data?.object; const order=db.orders.find(o=>o.stripeSessionId===session?.id);
      if (order && session.metadata?.orderId===order.id && session.client_reference_id===order.reference && order.status!=='paid' && session.payment_status==='paid') {
        order.status='paid'; order.paidAt=new Date().toISOString(); if (Number.isInteger(session.amount_total)) order.totalCents=session.amount_total; if (Number.isInteger(session.total_details?.amount_tax)) order.taxCents=session.total_details.amount_tax;
        for (const item of order.items) { const p=db.products.find(x=>x.id===item.id); if (p) p.stock=Math.max(0,p.stock-item.quantity); }
        await saveDb();
      }
    } else if (event.type==='checkout.session.expired' || event.type==='checkout.session.async_payment_failed') {
      const session=event.data?.object; const order=db.orders.find(o=>o.stripeSessionId===session?.id);
      if (order && session.metadata?.orderId===order.id && session.client_reference_id===order.reference && order.status==='payment_pending') { order.status='cancelled'; order.cancelledAt=new Date().toISOString(); await saveDb(); }
    }
    if(eventId){if(postgresStore)await postgresStore.rememberWebhookEvent(eventId);else{db.processedStripeEvents.push(eventId);if(db.processedStripeEvents.length>10000)db.processedStripeEvents=db.processedStripeEvents.slice(-5000);await saveDb();}}
    return text(res,200,'ok');
  }
  if (route.startsWith('/api/admin/')) {
    if (req.method==='GET'&&route==='/api/admin/status') return send(res,200,{setupRequired:!db.admin,hasSetupKey:!!db.setupKey});
    if (req.method==='POST'&&route==='/api/admin/setup') {
      if (db.admin) return send(res,409,{error:'Owner access has already been set up.'});
      const b=await readJson(req); if (!db.setupKey || !safeEqual(b.setupKey,db.setupKey)) return send(res,403,{error:'Setup key does not match. Start the owner setup using the key shown by the server.'});
      const username=clean(b.username,50), password=String(b.password||'');
      if (!/^[a-zA-Z0-9._-]{3,50}$/.test(username)||password.length<12||password.length>200) return send(res,400,{error:'Use a 3–50 character username and a password of at least 12 characters.'});
      const salt=crypto.randomBytes(16).toString('hex'); const hash=crypto.scryptSync(password,salt,64).toString('hex'); db.admin={username,salt,hash,createdAt:new Date().toISOString()}; db.setupKey=null;
      const token=crypto.randomBytes(32).toString('hex'); db.sessions[tokenHash(token)]=Date.now()+1000*60*60*12; await saveDb();
      return send(res,201,{ok:true,username},{'Set-Cookie':adminCookie(token)});
    }
    if (req.method==='POST'&&route==='/api/admin/login') {
      const b=await readJson(req); const username=clean(b.username,50),password=String(b.password||''); const now=Date.now();
      const recent=(loginAttempts.get(req.socket.remoteAddress)||[]).filter(t=>now-t<15*60*1000); if (recent.length>=8) return send(res,429,{error:'Too many attempts. Wait 15 minutes and try again.'});
      if (!db.admin || username!==db.admin.username || !safeEqual(crypto.scryptSync(password,db.admin.salt,64).toString('hex'),db.admin.hash)) { recent.push(now);loginAttempts.set(req.socket.remoteAddress,recent);return send(res,401,{error:'The username or password is incorrect.'}); }
      loginAttempts.delete(req.socket.remoteAddress); const token=crypto.randomBytes(32).toString('hex');db.sessions[tokenHash(token)]=Date.now()+1000*60*60*12;await saveDb();
      return send(res,200,{ok:true,username},{'Set-Cookie':adminCookie(token)});
    }
    if (req.method==='POST'&&route==='/api/admin/logout') { const token=sessionFrom(req);delete db.sessions[token];await saveDb();return send(res,200,{ok:true},{'Set-Cookie':adminCookie('',0)}); }
    if (req.method==='GET'&&route==='/api/admin/me') { if(!requireAdmin(req,res))return;return send(res,200,{username:db.admin.username}); }
    if (!requireAdmin(req,res)) return;
    if (req.method==='GET'&&route==='/api/admin/data') return send(res,200,{products:db.products,collections:db.collections,orders:db.orders,reservations:db.reservations,settings:db.settings,username:db.admin.username});
    if (req.method==='PUT'&&route==='/api/admin/settings') { const b=await readJson(req);const cur=String(b.currency||'').toUpperCase();if(!allowedCurrencies.has(cur))return send(res,400,{error:'Choose GBP, EUR or USD.'});const ship=b.shippingCents===''||b.shippingCents===null?null:Number(b.shippingCents);if(ship!==null&&(!Number.isInteger(ship)||ship<0||ship>10000000))return send(res,400,{error:'Enter a valid delivery fee, or leave it blank until decided.'});db.settings.currency=cur;for (const p of db.products) p.currency=cur;db.settings.shippingCents=ship;db.settings.automaticTaxEnabled=!!b.automaticTaxEnabled;db.settings.vatRegistered=!!b.vatRegistered;await saveDb();return send(res,200,{ok:true}); }
    if (req.method==='POST'&&route==='/api/admin/upload') { const b=await readJson(req);const image=await persistImage(b.data);return send(res,201,{image}); }
    if (req.method==='POST'&&route==='/api/admin/products') { const b=await readJson(req);const p=productInput(b);db.products.unshift(p);await saveDb();return send(res,201,{product:p}); }
    const productRoute=route.match(/^\/api\/admin\/products\/([^/]+)$/);
    if (productRoute && req.method==='PUT') { const b=await readJson(req);const i=db.products.findIndex(p=>p.id===productRoute[1]);if(i<0)return send(res,404,{error:'Product not found.'});db.products[i]=productInput(b,db.products[i]);await saveDb();return send(res,200,{product:db.products[i]}); }
    if (productRoute && req.method==='DELETE') { const i=db.products.findIndex(p=>p.id===productRoute[1]);if(i<0)return send(res,404,{error:'Product not found.'});const [p]=db.products.splice(i,1);if(p.image.startsWith('/uploads/'))fs.unlink(path.join(UPLOAD_DIR,path.basename(p.image))).catch(()=>{});await saveDb();return send(res,200,{ok:true}); }
    if (req.method==='POST'&&route==='/api/admin/collections') { const b=await readJson(req);const name=clean(b.name,100);if(name.length<2)return send(res,400,{error:'Enter a collection name.'});const c={id:id(),name,slug:`${slugify(name)}-${crypto.randomBytes(2).toString('hex')}`,description:clean(b.description,500),active:b.active!==false};db.collections.unshift(c);await saveDb();return send(res,201,{collection:c}); }
    const collectionRoute=route.match(/^\/api\/admin\/collections\/([^/]+)$/);
    if (collectionRoute&&req.method==='PUT') { const b=await readJson(req),c=db.collections.find(x=>x.id===collectionRoute[1]);if(!c)return send(res,404,{error:'Collection not found.'});const name=clean(b.name,100);if(name.length<2)return send(res,400,{error:'Enter a collection name.'});c.name=name;c.description=clean(b.description,500);c.active=b.active!==false;await saveDb();return send(res,200,{collection:c}); }
    if (collectionRoute&&req.method==='DELETE') { const c=db.collections.find(x=>x.id===collectionRoute[1]);if(!c)return send(res,404,{error:'Collection not found.'});if(db.products.some(p=>p.collectionId===c.id))return send(res,409,{error:'Move or remove this collection’s products before deleting it.'});db.collections=db.collections.filter(x=>x.id!==c.id);await saveDb();return send(res,200,{ok:true}); }
    const orderRoute=route.match(/^\/api\/admin\/orders\/([^/]+)$/);
    if (orderRoute&&req.method==='PUT') {const b=await readJson(req),o=db.orders.find(x=>x.id===orderRoute[1]);if(!o)return send(res,404,{error:'Order not found.'});if(!['processing','fulfilled','cancelled'].includes(b.status))return send(res,400,{error:'Choose a valid order status.'});if(o.paymentMode==='stripe'&&b.status==='fulfilled'&&o.status!=='paid'&&o.status!=='processing')return send(res,409,{error:'Only paid orders can be fulfilled.'});o.status=b.status;o.updatedAt=new Date().toISOString();await saveDb();return send(res,200,{order:o});}
    const reservationRoute=route.match(/^\/api\/admin\/reservations\/([^/]+)$/);
    if(reservationRoute&&req.method==='PUT'){const b=await readJson(req),r=db.reservations.find(x=>x.id===reservationRoute[1]);if(!r)return send(res,404,{error:'Enquiry not found.'});if(!['new','contacted','closed'].includes(b.status))return send(res,400,{error:'Choose a valid enquiry status.'});r.status=b.status;await saveDb();return send(res,200,{reservation:r});}
    return send(res,404,{error:'Owner route not found.'});
  }
  return send(res,404,{error:'Not found.'});
}
const loginAttempts=new Map();
function mime(file) {
  const ext=path.extname(file).toLowerCase();return ({'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp'})[ext]||'application/octet-stream';
}
async function staticFile(req,res,url) {
  let pathname;
  try { pathname=decodeURIComponent(url.pathname); }
  catch { return text(res,400,'Bad request.'); }
  if(pathname==='/')pathname='/index.html';
  if(pathname.startsWith('/data/')||pathname==='/server.js'||pathname==='/package.json'||pathname.startsWith('/.')) return text(res,404,'Not found.');
  const isUpload=pathname.startsWith('/uploads/');
  const base=isUpload?UPLOAD_DIR:ROOT;
  const relative=isUpload?pathname.slice('/uploads/'.length):pathname.slice(1);
  const full=path.resolve(base,relative);
  if(full!==base&&!full.startsWith(base+path.sep))return text(res,403,'Forbidden.');
  let stat;
  try { stat=await fs.stat(full); }
  catch(err) {
    if(err.code!=='ENOENT'&&err.code!=='ENOTDIR')console.error(`Static file lookup failed for ${pathname}:`,err);
    return text(res,404,'Not found.');
  }
  if(!stat.isFile())return text(res,404,'Not found.');
  res.writeHead(200,{'Content-Type':mime(full),'Cache-Control':full.includes(`${path.sep}uploads${path.sep}`)?'public, max-age=31536000, immutable':'no-cache'});
  const stream=fsSync.createReadStream(full);
  stream.on('error',err=>{
    console.error(`Static file read failed for ${pathname}:`,err);
    if(!res.headersSent)text(res,404,'Not found.');
    else res.destroy(err);
  });
  stream.pipe(res);
}
async function main(req,res) {
  try {
    const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
    if(url.pathname.startsWith('/api/'))return await handleApi(req,res,url);
    if(url.pathname.startsWith('/uploads/'))return await staticFile(req,res,url);
    return await staticFile(req,res,url);
  } catch(err) { console.error(err);if(!res.headersSent)send(res,err.status||500,{error:err.message||'Something went wrong. Please try again.'});else res.end(); }
}
loadDb().then(()=>{
  const server=http.createServer(main);
  server.listen(PORT,HOST,()=>console.log(`BIREQDAR&CO. V1 listening on ${HOST}:${PORT}`));
}).catch(err=>{console.error('Could not start store:',err);process.exit(1)});
