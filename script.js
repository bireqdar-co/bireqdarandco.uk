const toggle=document.querySelector('.menu-toggle');const nav=document.querySelector('.site-header nav');
if(nav&&!nav.id)nav.id='primary-navigation';
toggle?.setAttribute('aria-controls',nav?.id||'primary-navigation');
const setMenuOpen=open=>{nav?.classList.toggle('open',open);toggle?.setAttribute('aria-expanded',String(open));toggle?.setAttribute('aria-label',open?'Close menu':'Open menu');document.body.classList.toggle('menu-open',open)};
toggle?.addEventListener('click',()=>setMenuOpen(toggle.getAttribute('aria-expanded')!=='true'));
nav?.querySelectorAll('a').forEach(link=>link.addEventListener('click',()=>setMenuOpen(false)));
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&toggle?.getAttribute('aria-expanded')==='true'){setMenuOpen(false);toggle.focus()}});
document.addEventListener('click',event=>{if(toggle?.getAttribute('aria-expanded')==='true'&&!event.target.closest('.site-header'))setMenuOpen(false)});
window.matchMedia('(min-width: 981px)').addEventListener('change',event=>{if(event.matches)setMenuOpen(false)});

window.updateBagCount=()=>{const n=document.querySelector("#cart-count");if(n){let bag=[];try{bag=JSON.parse(localStorage.getItem("bireqdar-bag")||"[]")}catch{}const count=bag.reduce((t,x)=>t+(Number(x.quantity)||0),0);n.textContent=count;const link=n.closest('.bag-link');link?.setAttribute('aria-label',`Shopping bag, ${count} ${count===1?'item':'items'}`)}};window.updateBagCount();
