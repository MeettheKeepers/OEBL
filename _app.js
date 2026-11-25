/* ================= CONFIG ================= */
const SUPABASE_URL = 'https://rseogecrycwmiayvazzn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_g_Ax6fnYl8Mq6SDdFwzLew_0qE-18Uc';
const FUNCTIONS_URL = SUPABASE_URL + '/functions/v1';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
// >>> Set this to the Interac e-Transfer email customers should send payment to <<<
const ETRANSFER_EMAIL = 'SET-ETRANSFER-EMAIL@example.com';

function slugName(n){ return (n||'').toLowerCase().trim().replace(/[^a-z0-9]/g,''); }
function nameToEmail(n){ return slugName(n) + '@oebl.local'; }
async function callAdmin(action, extra){
  const headers = { 'Content-Type':'application/json', 'apikey': SUPABASE_KEY };
  if(session) headers['Authorization'] = 'Bearer ' + session.access_token;
  const res = await fetch(FUNCTIONS_URL + '/oebl-admin', { method:'POST', headers, body: JSON.stringify({ action, ...extra }) });
  return res.json();
}
function esc(t){ return String(t==null?'':t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function money(c){ return '$'+(c/100).toFixed(2); }
function stamp(ts){ return ts ? `<div class="hint" style="margin:2px 0 0;font-size:11px;white-space:nowrap;">${new Date(ts).toLocaleString('en-CA',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'})}</div>` : ''; }
function showToast(m){ const t=document.getElementById('toast'); t.textContent=m; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2600); }
function openModal(src){ document.getElementById('modalImg').src=src; document.getElementById('modal').classList.add('open'); }
function closeModal(){ document.getElementById('modal').classList.remove('open'); }
function setMsg(m,err){ const el=document.getElementById('authMsg'); el.textContent=m||''; el.style.color=err?'#e05a5a':'#4fd18a'; }

/* ================= CATALOG ================= */
__STICKCONST__
const JERSEY_SIZES = ['S','M','L','XL','2XL','Goalie','YS','YM','YL','YXL','Y Goalie'];
const GLOVE_BRANDS = ['CCM','Bauer','Other'];
const GLOVE_SIZES = ['11"','12"','13"','14"','15"'];
const GLOVE_LEVELS = ['Junior','Intermediate','Senior'];
const SIZE_CHART_URL = 'jersey-size-chart.png';

/* ================= STATE ================= */
let session=null, me=null, authMode='signin';
let tab='shop', shopCat='Sticks';
let cart = [];
let myItems = [];
let adminItems = [], customers = {}, stickInventory = [];
let filterText='', filterStatus='all', lastOrder=null;
let draft = {};
const isAdmin = () => !!(me && (me.is_commissioner || me.is_developer));

function loadCart(){ try{ cart = JSON.parse(localStorage.getItem('obl_cart_'+(me&&me.id)) || '[]'); }catch(e){ cart=[]; } }
function saveCart(){ try{ localStorage.setItem('obl_cart_'+me.id, JSON.stringify(cart)); }catch(e){} }

/* ================= AUTH ================= */
function toggleAuthMode(){
  authMode = authMode==='signin' ? 'signup' : 'signin';
  const b=document.getElementById('authBtn');
  b.textContent = authMode==='signup' ? 'Create Account' : 'Sign In';
  b.setAttribute('onclick', authMode==='signup' ? 'doSignUp()' : 'doSignIn()');
  document.getElementById('authToggleRow').innerHTML = authMode==='signup' ? `Already registered? <a onclick="toggleAuthMode()">Sign in</a>` : `New here? <a onclick="toggleAuthMode()">Create account</a>`;
  setMsg('');
}
async function doSignUp(){
  const name=document.getElementById('loginName').value.trim(), password=document.getElementById('loginPass').value;
  if(!name||!password){ setMsg('Enter a name and password.',true); return; }
  setMsg('Creating account…');
  const r = await callAdmin('signup',{ name, password });
  if(r.error){ setMsg(r.error,true); return; }
  const { data, error } = await sb.auth.signInWithPassword({ email:nameToEmail(name), password });
  if(error){ setMsg(error.message,true); return; }
  await enterApp(data.session);
}
async function doSignIn(){
  const name=document.getElementById('loginName').value.trim(), password=document.getElementById('loginPass').value;
  if(!name||!password){ setMsg('Enter your name and password.',true); return; }
  setMsg('Signing in…');
  const { data, error } = await sb.auth.signInWithPassword({ email:nameToEmail(name), password });
  if(error){ setMsg('Name or password is incorrect.',true); return; }
  await enterApp(data.session);
}
async function enterApp(sess){
  session = sess;
  const { data: profile, error } = await sb.from('profiles').select('*').eq('id', session.user.id).single();
  if(error || !profile){ setMsg('Signed in, but no profile found yet — try again in a moment.',true); return; }
  me = profile;
  me.contact_phone = me.contact_phone||''; me.contact_email = me.contact_email||'';
  loadCart();
  document.getElementById('signin').style.display='none';
  document.getElementById('app').style.display='block';
  document.getElementById('userName').textContent = me.name || '';
  tab = 'shop';
  await refreshData();
  render();
}
async function signOut(){
  await sb.auth.signOut(); session=null; me=null; cart=[];
  document.getElementById('app').style.display='none';
  document.getElementById('signin').style.display='flex';
  setMsg('');
}
function needsContact(){ return !(me.contact_phone||'').trim() || !(me.contact_email||'').trim(); }
async function saveContact(){
  const phone=document.getElementById('cPhone').value.trim(), email=document.getElementById('cEmail').value.trim();
  if(phone.replace(/\D/g,'').length<10){ showToast('Enter a valid phone number'); return; }
  if(!/^\S+@\S+\.\S+$/.test(email)){ showToast('Enter a valid email'); return; }
  const { error } = await sb.from('profiles').update({ contact_phone:phone, contact_email:email }).eq('id', me.id);
  if(error){ showToast('Save failed: '+error.message); return; }
  me.contact_phone=phone; me.contact_email=email; showToast('Saved ✓'); render();
}

/* ================= DATA ================= */
async function refreshData(){
  const { data } = await sb.from('shop_order_items').select('*').eq('customer_id', me.id).order('created_at',{ascending:false});
  myItems = data || [];
  if(isAdmin()) await refreshAdmin();
}
async function refreshAdmin(){
  const [it, inv] = await Promise.all([
    sb.from('shop_order_items').select('*').order('created_at',{ascending:false}),
    sb.from('stick_inventory').select('*').order('brand').order('model')
  ]);
  adminItems = it.data || []; stickInventory = inv.data || [];
  const ids = [...new Set(adminItems.map(i=>i.customer_id))];
  customers = {};
  if(ids.length){
    const { data } = await sb.from('profiles').select('id,name,contact_phone,contact_email').in('id', ids);
    (data||[]).forEach(p=>customers[p.id]=p);
  }
}
function itemStatus(i){
  if(i.delivered) return 'Delivered';
  if(i.ordered) return 'Ordered from supplier';
  if(i.in_stock && i.paid) return 'Paid — in stock, ready';
  if(i.paid) return 'Payment received';
  return 'Awaiting e-Transfer';
}
function stepsHTML(i){
  const st=[['Placed',true],['Paid',i.paid],[i.in_stock?'In stock':'Ordered',i.in_stock||i.ordered],['Delivered',i.delivered]];
  return `<div class="steps">${st.map(s=>`<span class="step ${s[1]?'done':''}">${s[1]?'✓ ':''}${s[0]}</span>`).join('')}</div>`;
}

/* ================= RENDER ================= */
function tabsList(){
  const t=[['shop','Shop'],['cart','Cart'],['orders','My Orders']];
  if(isAdmin()) t.push(['aorders','All Orders'],['toorder','To Order'],['inventory','Inventory'],['customers','Customers']);
  return t;
}
function renderTabs(){
  document.getElementById('tabs').innerHTML = tabsList().map(([id,l])=>`<button class="${tab===id?'active':''}" onclick="goTab('${id}')">${l}${id==='cart'&&cart.length?`<span class="badge">${cart.length}</span>`:''}</button>`).join('');
}
function goTab(id){
  tab=id;
  if(['aorders','toorder','inventory','customers'].includes(id)) refreshAdmin().then(render);
  else if(id==='orders') refreshData().then(render);
  else render();
  window.scrollTo(0,0);
}
function render(){
  renderTabs();
  const m=document.getElementById('main');
  if(needsContact()){ m.innerHTML = renderContactGate(); return; }
  m.innerHTML = ({shop:renderShop,cart:renderCart,orders:renderMyOrders,aorders:renderAdminOrders,toorder:renderToOrder,inventory:renderInventory,customers:renderCustomers}[tab]||renderShop)();
}
function renderContactGate(){
  return `<div class="panel" style="max-width:460px;margin:20px auto;">
    <h2 class="section-title">Contact info</h2>
    <p class="section-sub">We need your phone and email so we can update you on your order.</p>
    <div class="field"><label>Phone *</label><input id="cPhone" type="tel" value="${esc(me.contact_phone)}" placeholder="613-555-1234"></div>
    <div class="field"><label>Email *</label><input id="cEmail" type="email" value="${esc(me.contact_email)}" placeholder="you@email.com"></div>
    <button class="btn" onclick="saveContact()">Continue</button></div>`;
}

/* ---------- SHOP ---------- */
function opts(arr,cur,ph){ return `<option value="">${ph}</option>`+arr.map(v=>`<option value="${esc(v)}" ${cur===v?'selected':''}>${esc(v)}</option>`).join(''); }
function setCat(c){ shopCat=c; draft={}; render(); }
function dsync(){ document.querySelectorAll('[data-d]').forEach(el=>{ draft[el.dataset.d]=el.value; }); }
function dchange(field){
  dsync();
  const reset = { brand:['model','hand','curve','flex'], model:['hand','curve','flex'], hand:['curve','flex'], curve:['flex'] }[field];
  if(shopCat==='Sticks' && reset) reset.forEach(k=>draft[k]='');
  render();
}
function renderShop(){
  const cats=['Sticks','Jerseys','Gloves'];
  return `<h2 class="section-title">Place an Order</h2>
  <p class="section-sub">Build your item, add it to the cart, then check out. You'll pay by Interac e-Transfer after placing your order.</p>
  <div class="cat-tabs">${cats.map(c=>`<button class="${shopCat===c?'on':''}" onclick="setCat('${c}')">${c}</button>`).join('')}</div>
  <div class="panel">${shopCat==='Sticks'?stickBuilder():shopCat==='Jerseys'?jerseyBuilder():gloveBuilder()}</div>`;
}
function dsel(key,label,optionsArr,ph,disabled){
  return `<div class="field"><label>${label}</label><select data-d="${key}" onchange="dchange('${key}')" ${disabled?'disabled':''}>${opts(optionsArr,draft[key],ph)}</select></div>`;
}
function qtyField(){ return `<div class="field"><label>Quantity</label><input data-d="qty" type="number" min="1" step="1" value="${esc(draft.qty||1)}" onchange="dsync()"></div>`; }
function notesField(){ return `<div class="field"><label>Notes (optional)</label><input data-d="notes" value="${esc(draft.notes||'')}" onchange="dsync()" placeholder="Anything we should know"></div>`; }
function stickBuilder(){
  const d=draft, m=STICK_CATALOG[d.model];
  const curves = m && d.hand ? Object.keys(m[d.hand]) : [];
  const flexes = m && d.hand && d.curve ? m[d.hand][d.curve] : [];
  return `<h3 style="margin-top:0;">Hockey Stick</h3><div class="grid cols-3">
    ${dsel('brand','Brand',STICK_BRANDS,'Select brand')}
    ${dsel('model','Stick',Object.keys(STICK_CATALOG).filter(k=>STICK_BRAND_OF[k]===d.brand),'Select stick',!d.brand)}
    ${dsel('hand','Hand',m?['LH','RH']:[],'Select hand',!m)}
    ${dsel('curve','Curve',curves,'Select curve',!curves.length)}
    ${dsel('flex','Flex',flexes,'Select flex',!flexes.length)}
    ${qtyField()}</div>${notesField()}
    <button class="btn" onclick="addToCart()">Add to Cart</button>`;
}
function jerseyBuilder(){
  return `<h3 style="margin-top:0;">Jersey</h3><div class="grid cols-3">
    ${dsel('size','Size',JERSEY_SIZES,'Select size')}
    <div class="field"><label>Custom number</label><input data-d="number" inputmode="numeric" maxlength="3" value="${esc(draft.number||'')}" onchange="dsync()" placeholder="e.g. 17"></div>
    <div class="field"><label>Custom name</label><input data-d="name" maxlength="20" value="${esc(draft.name||'')}" onchange="dsync()" placeholder="Name on back"></div>
    ${qtyField()}</div>
    <div style="margin-bottom:12px;"><a href="#" onclick="openModal('${SIZE_CHART_URL}');return false;" style="font-weight:700;">View sizing chart</a></div>
    ${notesField()}<button class="btn" onclick="addToCart()">Add to Cart</button>`;
}
function gloveBuilder(){
  return `<h3 style="margin-top:0;">Gloves</h3><div class="grid cols-3">
    ${dsel('brand','Brand',GLOVE_BRANDS,'Select brand')}
    <div class="field"><label>Model</label><input data-d="model" value="${esc(draft.model||'')}" onchange="dsync()" placeholder="e.g. Jetspeed FT6 Pro"></div>
    ${dsel('level','Level',GLOVE_LEVELS,'Select level')}
    ${dsel('size','Size',GLOVE_SIZES,'Select size')}
    <div class="field"><label>Colour</label><input data-d="color" value="${esc(draft.color||'')}" onchange="dsync()" placeholder="e.g. Black/White"></div>
    ${qtyField()}</div>${notesField()}
    <button class="btn" onclick="addToCart()">Add to Cart</button>`;
}
function addToCart(){
  dsync(); const d=draft; const qty=Math.max(1,parseInt(d.qty,10)||1); let item;
  if(shopCat==='Sticks'){
    if(!d.brand||!d.model||!d.hand||!d.curve||!d.flex){ showToast('Choose brand, stick, hand, curve and flex'); return; }
    item={ category:'Sticks', description:`${d.brand} ${d.model} — ${d.hand} ${d.curve} ${d.flex} flex`, details:{brand:d.brand,model:d.model,hand:d.hand,curve:d.curve,flex:d.flex} };
  } else if(shopCat==='Jerseys'){
    if(!d.size){ showToast('Choose a size'); return; }
    const num=(d.number||'').trim(), nm=(d.name||'').trim();
    item={ category:'Jerseys', description:`Jersey — size ${d.size}${num?` · #${num}`:''}${nm?` · ${nm}`:''}`, details:{size:d.size,number:num,name:nm} };
  } else {
    if(!d.brand||!(d.model||'').trim()||!d.level||!d.size){ showToast('Choose brand, model, level and size'); return; }
    const col=(d.color||'').trim();
    item={ category:'Gloves', description:`${d.brand} ${d.model.trim()} gloves — ${d.level} ${d.size}${col?` · ${col}`:''}`, details:{brand:d.brand,model:d.model.trim(),level:d.level,size:d.size,color:col} };
  }
  item.quantity=qty; item.note=(d.notes||'').trim();
  cart.push(item); saveCart(); draft={}; showToast('Added to cart ✓'); render();
}
function removeFromCart(i){ cart.splice(i,1); saveCart(); render(); }

/* ---------- CART / CHECKOUT ---------- */
function renderCart(){
  if(lastOrder){
    const o=lastOrder;
    return `<div class="panel"><h2 class="section-title">Order placed ✓</h2>
    <p class="section-sub">Thanks ${esc(me.name)} — ${o} item${o===1?'':'s'} submitted.</p>
    <p>To start your order, send an <strong>Interac e-Transfer</strong> to:</p>
    <div class="etransfer"><div class="hint" style="color:#b3b3b3;margin:0 0 4px;">E-TRANSFER TO</div><div class="em">${esc(ETRANSFER_EMAIL)}</div></div>
    <p class="hint">Put your name in the message. We'll confirm the total by text/email once pricing is set, and mark your order paid when your transfer arrives.</p>
    <button class="btn small" onclick="lastOrder=null;goTab('orders')">View My Orders</button></div>`;
  }
  if(!cart.length) return `<h2 class="section-title">Cart</h2><div class="panel"><div class="empty">Your cart is empty.</div><button class="btn small" onclick="goTab('shop')">Start shopping</button></div>`;
  const units=cart.reduce((a,c)=>a+c.quantity,0);
  return `<h2 class="section-title">Cart</h2><p class="section-sub">${units} item${units===1?'':'s'} in your cart.</p>
  <div class="panel"><div class="table-scroll"><table style="min-width:0"><thead><tr><th>Item</th><th>Qty</th><th></th></tr></thead><tbody>
  ${cart.map((c,i)=>`<tr><td><span class="tag dark">${c.category}</span> ${esc(c.description)}${c.note?`<div class="hint">Note: ${esc(c.note)}</div>`:''}</td><td>${c.quantity}</td><td><a href="#" style="color:#c0392b" onclick="removeFromCart(${i});return false;">remove</a></td></tr>`).join('')}
  </tbody></table></div>
  <div class="etransfer"><strong>How you pay:</strong> after you place the order, you'll get an e-Transfer email address to send payment to. Prices are confirmed by us once your order is in.</div>
  <div class="field"><label>Note for the order (optional)</label><textarea id="orderNote" rows="2"></textarea></div>
  <button class="btn" id="placeBtn" onclick="placeOrder()">Place Order</button></div>`;
}
async function placeOrder(){
  if(!cart.length) return;
  const btn=document.getElementById('placeBtn'); btn.disabled=true;
  const note=(document.getElementById('orderNote')||{}).value||null;
  const { data:order, error } = await sb.from('shop_orders').insert({ customer_id:me.id, customer_note:note }).select().single();
  if(error){ showToast('Order failed: '+error.message); btn.disabled=false; return; }
  const rows = cart.map(c=>({ order_id:order.id, customer_id:me.id, category:c.category, description:c.description, details:{...c.details, note:c.note||undefined}, quantity:c.quantity }));
  const { error:e2 } = await sb.from('shop_order_items').insert(rows);
  if(e2){ showToast('Order failed: '+e2.message); btn.disabled=false; return; }
  lastOrder = cart.length; cart=[]; saveCart();
  await refreshData(); render();
}

/* ---------- MY ORDERS ---------- */
function renderMyOrders(){
  if(!myItems.length) return `<h2 class="section-title">My Orders</h2><div class="panel"><div class="empty">No orders yet.</div></div>`;
  const total=myItems.reduce((a,i)=>a+(i.price_cents||0),0), unpriced=myItems.some(i=>i.price_cents==null);
  return `<h2 class="section-title">My Orders</h2>
  <p class="section-sub">Total: ${money(total)}${unpriced?' + items still being priced':''} · e-Transfer payments go to <strong>${esc(ETRANSFER_EMAIL)}</strong></p>
  ${myItems.map(i=>`<div class="panel" style="padding:16px;">
    <div class="row-flex"><div><span class="tag dark">${i.category}</span> <strong>${esc(i.description)}</strong> <span class="hint">× ${i.quantity}</span>
      ${i.details&&i.details.note?`<div class="hint">Note: ${esc(i.details.note)}</div>`:''}</div>
      <div style="text-align:right;"><div><strong>${i.price_cents==null?'Price pending':money(i.price_cents)}</strong></div><div class="hint" style="margin:0;">${itemStatus(i)}</div></div></div>
    ${stepsHTML(i)}</div>`).join('')}`;
}

/* ---------- ADMIN: ALL ORDERS ---------- */
function stickInvFor(i){
  if(i.category!=='Sticks'||!i.details) return null;
  const d=i.details;
  return stickInventory.find(v=>v.brand===d.brand&&v.model===d.model&&v.hand===d.hand&&v.curve===d.curve&&v.flex===d.flex)||null;
}
async function patchItem(id, patch){
  const { error } = await sb.from('shop_order_items').update(patch).eq('id', id);
  if(error){ showToast('Failed: '+error.message); return false; }
  const it=adminItems.find(x=>x.id===id); if(it) Object.assign(it,patch); return true;
}
async function toggleFlag(id, field){
  const it=adminItems.find(x=>x.id===id); const val=!it[field];
  const patch={ [field]:val }; patch[field+'_at']=val?new Date().toISOString():null;
  if(await patchItem(id,patch)) render();
}
async function setPrice(id, val){
  const v = val.trim()===''? null : Math.round(Number(val)*100);
  if(v!==null && (isNaN(v)||v<0)){ showToast('Enter a valid price'); return; }
  if(await patchItem(id,{ price_cents:v })) { showToast('Price saved'); render(); }
}
async function useStock(id){
  const it=adminItems.find(x=>x.id===id), inv=stickInvFor(it);
  if(!inv||inv.quantity<it.quantity){ showToast('Not enough in stock'); return; }
  const { error } = await sb.from('stick_inventory').update({ quantity:inv.quantity-it.quantity, updated_at:new Date().toISOString() }).eq('id',inv.id);
  if(error){ showToast('Failed: '+error.message); return; }
  inv.quantity-=it.quantity; await patchItem(id,{ in_stock:true }); showToast('Taken from inventory ✓'); render();
}
async function releaseStock(id){
  if(!confirm('Put this stick back into inventory and mark it not in stock?')) return;
  const it=adminItems.find(x=>x.id===id), inv=stickInvFor(it);
  if(inv){ await sb.from('stick_inventory').update({ quantity:inv.quantity+it.quantity, updated_at:new Date().toISOString() }).eq('id',inv.id); inv.quantity+=it.quantity; }
  await patchItem(id,{ in_stock:false }); render();
}
async function deleteItem(id){
  if(!confirm('Delete this order item?')) return;
  const { error } = await sb.from('shop_order_items').delete().eq('id',id);
  if(error){ showToast('Failed: '+error.message); return; }
  adminItems=adminItems.filter(x=>x.id!==id); render();
}
function setFilter(){ filterText=document.getElementById('fText').value; filterStatus=document.getElementById('fStatus').value; render(); }
function filteredItems(){
  const q=filterText.trim().toLowerCase();
  return adminItems.filter(i=>{
    const c=customers[i.customer_id]||{};
    if(q && !((c.name||'').toLowerCase().includes(q) || i.description.toLowerCase().includes(q))) return false;
    if(filterStatus==='unpaid' && i.paid) return false;
    if(filterStatus==='notordered' && (i.ordered||i.in_stock)) return false;
    if(filterStatus==='undelivered' && i.delivered) return false;
    if(filterStatus==='open' && i.delivered) return false;
    return true;
  });
}
function renderAdminOrders(){
  const list=filteredItems();
  return `<h2 class="section-title">All Orders</h2>
  <p class="section-sub">${adminItems.length} item${adminItems.length===1?'':'s'} · ${adminItems.filter(i=>!i.paid).length} unpaid · ${adminItems.filter(i=>!i.delivered).length} not delivered</p>
  <div class="row-flex" style="margin-bottom:14px;justify-content:flex-start;">
    <input id="fText" value="${esc(filterText)}" placeholder="Search name or item" style="padding:9px 12px;border:1px solid var(--line);border-radius:8px;min-width:220px;" onchange="setFilter()">
    <select id="fStatus" style="padding:9px 12px;border:1px solid var(--line);border-radius:8px;" onchange="setFilter()">
      ${[['all','All'],['open','Not delivered'],['unpaid','Unpaid'],['notordered','Not ordered / not in stock'],['undelivered','Undelivered']].map(([v,l])=>`<option value="${v}" ${filterStatus===v?'selected':''}>${l}</option>`).join('')}
    </select></div>
  <div class="panel"><div class="table-scroll"><table><thead><tr><th>Customer</th><th>Item</th><th>Qty</th><th>Price ($)</th><th>Stock</th><th>Paid</th><th>Ordered</th><th>Delivered</th><th></th></tr></thead><tbody>
  ${list.map(i=>{ const c=customers[i.customer_id]||{}; const inv=stickInvFor(i);
    const stockCell = i.in_stock ? `<a href="#" title="In stock — click to release" style="color:#1f9d55;font-size:20px;font-weight:700;text-decoration:none;" onclick="releaseStock('${i.id}');return false;">&#10003;</a>`
      : (inv && inv.quantity>=i.quantity ? `<button class="btn ghost small" onclick="useStock('${i.id}')">Use stock (${inv.quantity})</button>` : '');
    return `<tr><td><strong>${esc(c.name||'?')}</strong></td>
      <td><span class="tag dark">${i.category}</span> ${esc(i.description)}${i.details&&i.details.note?`<div class="hint">Note: ${esc(i.details.note)}</div>`:''}${stamp(i.created_at)}</td>
      <td>${i.quantity}</td>
      <td><input type="number" step="0.01" min="0" style="width:90px;padding:6px;border:1px solid var(--line);border-radius:6px;" value="${i.price_cents==null?'':(i.price_cents/100).toFixed(2)}" onchange="setPrice('${i.id}',this.value)"></td>
      <td style="text-align:center;">${stockCell}</td>
      <td><input type="checkbox" ${i.paid?'checked':''} onchange="toggleFlag('${i.id}','paid')">${stamp(i.paid_at)}</td>
      <td><input type="checkbox" ${i.ordered?'checked':''} ${i.in_stock?'disabled':''} onchange="toggleFlag('${i.id}','ordered')">${stamp(i.ordered_at)}</td>
      <td><input type="checkbox" ${i.delivered?'checked':''} onchange="toggleFlag('${i.id}','delivered')">${stamp(i.delivered_at)}</td>
      <td><button class="btn ghost small" onclick="deleteItem('${i.id}')">Delete</button></td></tr>`; }).join('') || '<tr><td colspan="9" class="hint">No items.</td></tr>'}
  </tbody></table></div></div>`;
}

/* ---------- ADMIN: TO ORDER (Excel) ---------- */
function needsOrdering(){ return adminItems.filter(i=>!i.in_stock && !i.ordered); }
function renderToOrder(){
  const list=needsOrdering(), units=list.reduce((a,i)=>a+i.quantity,0);
  const groups=groupForSupplier(list);
  return `<h2 class="section-title">To Order</h2>
  <p class="section-sub">${units} item${units===1?'':'s'} not in stock and not yet ordered. Items marked ordered or in stock never appear here.</p>
  <button class="btn small" style="margin-bottom:14px;" onclick="downloadOrderList()" ${list.length?'':'disabled'}>Download supplier list (Excel)</button>
  <div class="panel"><div class="table-scroll"><table style="min-width:0"><thead><tr><th>Category</th><th>Item</th><th>Qty</th><th>For</th></tr></thead><tbody>
  ${groups.map(g=>`<tr><td>${g.category}</td><td>${esc(g.description)}</td><td>${g.qty}</td><td>${esc(g.names.join(', '))}</td></tr>`).join('') || '<tr><td colspan="4" class="hint">Nothing to order.</td></tr>'}
  </tbody></table></div></div>`;
}
function groupForSupplier(list){
  const g={};
  list.forEach(i=>{ const k=i.category+'|'+i.description; const nm=(customers[i.customer_id]||{}).name||'?'; (g[k]=g[k]||{category:i.category,description:i.description,qty:0,names:[]}); g[k].qty+=i.quantity; g[k].names.push(i.quantity>1?`${nm} (x${i.quantity})`:nm); });
  return Object.values(g).sort((a,b)=>(a.category+a.description).localeCompare(b.category+b.description));
}
async function downloadOrderList(){
  const list=needsOrdering(); if(!list.length){ showToast('Nothing to order'); return; }
  try{
    if(!window.XLSX){ await new Promise((res,rej)=>{ const s=document.createElement('script'); s.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; s.onload=res; s.onerror=()=>rej(new Error('Could not load Excel library')); document.head.appendChild(s); }); }
    const data=[['Category','Item','Qty','For']];
    groupForSupplier(list).forEach(g=>data.push([g.category,g.description,g.qty,g.names.join(', ')]));
    data.push([]); data.push(['','Total',list.reduce((a,i)=>a+i.quantity,0),'']);
    const ws=XLSX.utils.aoa_to_sheet(data); ws['!cols']=[{wch:10},{wch:60},{wch:6},{wch:50}];
    const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'To Order');
    XLSX.writeFile(wb,'OBL-supplier-order-'+new Date().toISOString().slice(0,10)+'.xlsx');
  }catch(e){ showToast('Export failed: '+e.message); return; }
  if(confirm(`Mark these ${list.length} line(s) as ORDERED so they don't appear on the next list?\n\nOK = mark as ordered, Cancel = leave them on the list.`)){
    const now=new Date().toISOString(); const ids=list.map(i=>i.id);
    const { error } = await sb.from('shop_order_items').update({ ordered:true, ordered_at:now }).in('id',ids);
    if(error){ showToast('Failed: '+error.message); return; }
    list.forEach(i=>{ i.ordered=true; i.ordered_at=now; }); showToast('Marked as ordered ✓'); render();
  }
}

/* ---------- ADMIN: STICK INVENTORY ---------- */
let invDraft={brand:'',model:'',hand:'',curve:'',flex:'',qty:'1'};
function isync(){ document.querySelectorAll('[data-i]').forEach(el=>invDraft[el.dataset.i]=el.value); }
function ichange(f){ isync(); const r={brand:['model','hand','curve','flex'],model:['hand','curve','flex'],hand:['curve','flex'],curve:['flex']}[f]; if(r) r.forEach(k=>invDraft[k]=''); render(); }
async function addInventory(){
  isync(); const d=invDraft, q=Math.max(1,parseInt(d.qty,10)||1);
  if(!d.brand||!d.model||!d.hand||!d.curve||!d.flex){ showToast('Pick brand, stick, hand, curve and flex'); return; }
  const ex=stickInventory.find(v=>v.brand===d.brand&&v.model===d.model&&v.hand===d.hand&&v.curve===d.curve&&v.flex===d.flex);
  const r = ex ? await sb.from('stick_inventory').update({ quantity:ex.quantity+q, updated_at:new Date().toISOString() }).eq('id',ex.id)
               : await sb.from('stick_inventory').insert({ brand:d.brand, model:d.model, hand:d.hand, curve:d.curve, flex:d.flex, quantity:q });
  if(r.error){ showToast('Failed: '+r.error.message); return; }
  invDraft={brand:d.brand,model:d.model,hand:d.hand,curve:'',flex:'',qty:'1'}; showToast('Added ✓'); await refreshAdmin(); render();
}
async function setInvQty(id,v){ const q=Math.max(0,parseInt(v,10)||0); const { error }=await sb.from('stick_inventory').update({ quantity:q, updated_at:new Date().toISOString() }).eq('id',id); if(error){ showToast('Failed: '+error.message); return; } const i=stickInventory.find(x=>x.id===id); if(i) i.quantity=q; render(); }
async function delInv(id){ if(!confirm('Remove from inventory?')) return; const { error }=await sb.from('stick_inventory').delete().eq('id',id); if(error){ showToast('Failed: '+error.message); return; } stickInventory=stickInventory.filter(x=>x.id!==id); render(); }
function renderInventory(){
  const v=invDraft, m=STICK_CATALOG[v.model], vc=m&&v.hand?Object.keys(m[v.hand]):[], vf=m&&v.hand&&v.curve?m[v.hand][v.curve]:[];
  const isel=(k,l,arr,ph,dis)=>`<div class="field"><label>${l}</label><select data-i="${k}" onchange="ichange('${k}')" ${dis?'disabled':''}>${opts(arr,v[k],ph)}</select></div>`;
  return `<h2 class="section-title">Stick Inventory</h2>
  <p class="section-sub">Sticks you have on hand. On All Orders, matching orders show "Use stock" — it takes the stick out of this count and keeps it off the supplier list.</p>
  <div class="panel"><div class="grid cols-3">
    ${isel('brand','Brand',STICK_BRANDS,'Select brand')}
    ${isel('model','Stick',Object.keys(STICK_CATALOG).filter(k=>STICK_BRAND_OF[k]===v.brand),'Select stick',!v.brand)}
    ${isel('hand','Hand',m?['LH','RH']:[],'Select hand',!m)}
    ${isel('curve','Curve',vc,'Select curve',!vc.length)}
    ${isel('flex','Flex',vf,'Select flex',!vf.length)}
    <div class="field"><label>Quantity</label><input data-i="qty" type="number" min="1" value="${esc(v.qty)}" onchange="isync()"></div></div>
    <button class="btn small" onclick="addInventory()">Add to Inventory</button></div>
  <div class="panel"><div class="table-scroll"><table style="min-width:0"><thead><tr><th>Brand</th><th>Stick</th><th>Hand</th><th>Curve</th><th>Flex</th><th>On Hand</th><th></th></tr></thead><tbody>
  ${stickInventory.map(i=>`<tr><td>${i.brand}</td><td>${i.model}</td><td>${i.hand}</td><td>${i.curve}</td><td>${i.flex}</td><td><input type="number" min="0" style="width:70px;padding:6px;border:1px solid var(--line);border-radius:6px;" value="${i.quantity}" onchange="setInvQty('${i.id}',this.value)"></td><td><button class="btn ghost small" onclick="delInv('${i.id}')">Remove</button></td></tr>`).join('')||'<tr><td colspan="7" class="hint">No sticks in inventory yet.</td></tr>'}
  </tbody></table></div></div>`;
}

/* ---------- ADMIN: CUSTOMERS / UPDATES ---------- */
function digits(p){ return (p||'').replace(/[^\d+]/g,''); }
function renderCustomers(){
  const rows=Object.values(customers).sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  const emails=rows.map(c=>c.contact_email).filter(Boolean);
  return `<h2 class="section-title">Customers</h2>
  <p class="section-sub">${rows.length} customer${rows.length===1?'':'s'} with orders. Tap a phone number to call, or text to send an update.</p>
  <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;">
    <a class="btn small" style="text-decoration:none;" href="mailto:?bcc=${encodeURIComponent(emails.join(','))}&subject=${encodeURIComponent('OBL order update')}">Email everyone</a>
    <button class="btn ghost small" onclick="copyList('phone')">Copy all phone numbers</button>
    <button class="btn ghost small" onclick="copyList('email')">Copy all emails</button></div>
  <div class="panel"><div class="table-scroll"><table style="min-width:0"><thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Order status</th><th>Send update</th></tr></thead><tbody>
  ${rows.map(c=>{ const its=adminItems.filter(i=>i.customer_id===c.id); const open=its.filter(i=>!i.delivered).length;
    const msg=`Hi ${(c.name||'').split(' ')[0]}, this is OBL with an update on your order: `;
    return `<tr><td><strong>${esc(c.name)}</strong></td>
      <td>${c.contact_phone?`<a href="tel:${digits(c.contact_phone)}">${esc(c.contact_phone)}</a>`:'—'}</td>
      <td>${c.contact_email?`<a href="mailto:${esc(c.contact_email)}">${esc(c.contact_email)}</a>`:'—'}</td>
      <td>${its.length} item${its.length===1?'':'s'} · ${open} not delivered</td>
      <td>${c.contact_phone?`<a class="btn ghost small" style="text-decoration:none;" href="sms:${digits(c.contact_phone)}?&body=${encodeURIComponent(msg)}">Text</a> `:''}${c.contact_email?`<a class="btn ghost small" style="text-decoration:none;" href="mailto:${esc(c.contact_email)}?subject=${encodeURIComponent('OBL order update')}&body=${encodeURIComponent(msg)}">Email</a>`:''}</td></tr>`; }).join('')||'<tr><td colspan="5" class="hint">No customers yet.</td></tr>'}
  </tbody></table></div></div>`;
}
function copyList(kind){
  const v=Object.values(customers).map(c=>kind==='phone'?c.contact_phone:c.contact_email).filter(Boolean).join(kind==='phone'?'\n':', ');
  navigator.clipboard.writeText(v).then(()=>showToast('Copied ✓'),()=>showToast('Copy failed'));
}

/* ================= INIT ================= */
(async function init(){
  const { data } = await sb.auth.getSession();
  if(data.session){ await enterApp(data.session); }
})();
