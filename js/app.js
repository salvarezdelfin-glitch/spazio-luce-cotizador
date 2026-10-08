  if (window['pdfjsLib']) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }
let currentUser = null;
let productRowCount = 0;
// Cuando no es null, "Generar" actualiza esta cotización existente (misma fila
// en Supabase) en vez de crear una nueva — ver editQuote()/cancelEditQuote().
let editingQuoteId = null;
const reciboLogoUri = "assets/logo.jpg";

// Conexión a Supabase: cotizaciones y clientes se guardan aquí, compartidos
// entre todos los que usan el sistema (tú y tu papá ven lo mismo). El acceso
// real está protegido por Supabase Auth + una lista blanca de correos
// (tabla app_users) — el anon key por sí solo ya no puede leer ni escribir
// nada en clientes/cotizaciones/crm_leads desde que se activó esa RLS.
const SUPABASE_URL = 'https://smjktuithhvfmexysvkf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNtamt0dWl0aGh2Zm1leHlzdmtmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUyNTkwODksImV4cCI6MjEwMDgzNTA4OX0.ysy5L4zkOuRBqTwoeCYcvqd7PJ-n1FF-FAyq9vPp2q8';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
let currentAccessToken = null;

// PostgREST parametriza todo y la app no arma SQL a mano, así que no hay
// inyección SQL. Lo que sí se arma con texto es la URL (tabla, id, orden): un id
// como "1&id=gt.0" colaría un filtro extra y podría tocar más filas de las
// previstas. Aquí se valida contra listas y patrones estrictos antes de pedir nada.
const SB_TABLES = new Set(['clientes', 'cotizaciones', 'gastos', 'crm_leads', 'producto_fotos']);
function sbTable(name) {
  if (!SB_TABLES.has(name)) throw new Error('Tabla no permitida: ' + name);
  return name;
}
function sbId(id) {
  const n = Number(id);
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error('id inválido: ' + id);
  return n;
}
function sbOrder(order) {
  if (!order) return '';
  if (!/^[a-z_]+\.(asc|desc)$/.test(order)) throw new Error('orden inválido: ' + order);
  return '&order=' + order;
}

function sbHeaders(extra) {
  return Object.assign({
    apikey: SUPABASE_ANON_KEY,
    Authorization: 'Bearer ' + (currentAccessToken || SUPABASE_ANON_KEY),
  }, extra || {});
}

// null = falló la conexión; [] = la tabla de verdad está vacía. Quien necesita
// distinguirlos (el folio, el caché del Dashboard) usa sbSelectRaw.
async function sbSelectRaw(table, order) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${sbTable(table)}?select=*${sbOrder(order)}`, {
      headers: sbHeaders(),
    });
    if (!res.ok) throw new Error('select failed');
    return await res.json();
  } catch (e) {
    console.error('Supabase select error', e);
    return null;
  }
}

async function sbSelect(table, order) {
  return (await sbSelectRaw(table, order)) || [];
}

async function sbInsert(table, row) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${sbTable(table)}`, {
      method: 'POST',
      headers: sbHeaders({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
      body: JSON.stringify(row),
    });
    if (!res.ok) throw new Error('insert failed');
    return await res.json();
  } catch (e) {
    console.error('Supabase insert error', e);
    return null;
  }
}

async function sbDelete(table, id) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${sbTable(table)}?id=eq.${sbId(id)}`, {
      method: 'DELETE',
      headers: sbHeaders(),
    });
    if (!res.ok) throw new Error('delete failed');
    return true;
  } catch (e) {
    console.error('Supabase delete error', e);
    return false;
  }
}

async function sbUpdate(table, id, patch) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${sbTable(table)}?id=eq.${sbId(id)}`, {
      method: 'PATCH',
      headers: sbHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error('update failed');
    return true;
  } catch (e) {
    console.error('Supabase update error', e);
    return false;
  }
}

// ===== Fotos de producto: una imagen por nombre de producto del catálogo,
// reusada en cualquier cotización que lo incluya (tabla producto_fotos +
// bucket público "producto-fotos"). =====
let productoFotos = {};

async function cargarProductoFotos() {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/producto_fotos?select=producto_nombre,foto_url`, { headers: sbHeaders() });
    if (!res.ok) throw new Error('no se pudo leer producto_fotos');
    const rows = await res.json();
    productoFotos = {};
    rows.forEach(r => { productoFotos[r.producto_nombre] = r.foto_url; });
  } catch (e) {
    console.error('Error cargando fotos de producto', e);
  }
}

function sanitizeFotoPath(name) {
  return String(name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'producto';
}

async function uploadProductoFoto(productName, file) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = 'productos/' + sanitizeFotoPath(productName) + '.' + ext;
  try {
    const uploadRes = await fetch(`${SUPABASE_URL}/storage/v1/object/producto-fotos/${path}`, {
      method: 'POST',
      headers: sbHeaders({ 'Content-Type': file.type || 'image/jpeg', 'x-upsert': 'true' }),
      body: file,
    });
    if (!uploadRes.ok) throw new Error('upload: ' + await uploadRes.text());
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/producto-fotos/${path}?t=${Date.now()}`;
    const rowRes = await fetch(`${SUPABASE_URL}/rest/v1/producto_fotos`, {
      method: 'POST',
      headers: sbHeaders({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' }),
      body: JSON.stringify({ producto_nombre: productName, foto_url: publicUrl, updated_por: currentUser ? currentUser.email : null }),
    });
    if (!rowRes.ok) throw new Error('fila: ' + await rowRes.text());
    productoFotos[productName] = publicUrl;
    return publicUrl;
  } catch (e) {
    console.error('Error subiendo foto de producto', e);
    showToast('No se pudo subir la foto');
    return null;
  }
}

// Un solo botón cubre las dos formas de poner la foto: si ya copiaste una
// imagen (ej. una captura de pantalla con Win+Shift+S, o "Copiar imagen" desde
// el navegador), la pega directo del portapapeles sin abrir nada. Si no hay
// nada copiado, o el navegador no deja leer el portapapeles, cae solo al
// explorador de archivos normal (para subir un PNG/JPG ya descargado).
async function pickProductoFoto(productName) {
  try {
    if (navigator.clipboard && navigator.clipboard.read) {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imgType = item.types.find(t => t.startsWith('image/'));
        if (imgType) {
          const blob = await item.getType(imgType);
          const file = new File([blob], 'pegado.' + imgType.split('/')[1], { type: imgType });
          await saveProductoFotoFile(productName, file);
          return;
        }
      }
    }
  } catch (e) {
    // Sin permiso de portapapeles o nada copiado — se sigue al selector de
    // archivo normal, sin molestar con un error.
  }
  const input = document.getElementById('productoFotoInput');
  input.dataset.target = productName;
  input.value = '';
  input.click();
}

async function onProductoFotoSelected(event) {
  const file = event.target.files[0];
  const productName = event.target.dataset.target;
  if (!file || !productName) return;
  await saveProductoFotoFile(productName, file);
}

async function saveProductoFotoFile(productName, file) {
  showToast('Subiendo foto…');
  const url = await uploadProductoFoto(productName, file);
  if (url) {
    showToast('Foto guardada para "' + productName + '"');
    renderCatalogItems();
    document.querySelectorAll('.product-row, .product-row-coverage, .product-row-area').forEach(refreshRowPhoto);
  }
}

// Muestra/actualiza la foto debajo de un renglón ya agregado a la cotización,
// si el producto de esa fila tiene una foto guardada.
function refreshRowPhoto(rowEl) {
  const nameInput = rowEl.querySelector ? rowEl.querySelector('.p-name') : null;
  const name = nameInput ? nameInput.value.trim() : '';
  let photoBox = rowEl.querySelector(':scope > .item-photo-box');
  const url = productoFotos[name];
  if (!url) { if (photoBox) photoBox.remove(); return; }
  if (!photoBox) {
    photoBox = document.createElement('div');
    photoBox.className = 'item-photo-box';
    rowEl.appendChild(photoBox);
  }
  photoBox.innerHTML = `<img src="${url}" alt="${escapeHtml(name)}" />`;
}

// Deshabilita el botón mientras `fn` corre (para que un doble clic mientras se
// guarda en Supabase, común con mala señal en el celular, no genere una
// cotización/gasto/cliente duplicado) y lo vuelve a habilitar al terminar,
// pase lo que pase adentro. Solo toca `disabled` — nunca el texto
// del botón, porque varias de estas funciones ya cambian su propio texto
// según el modo (ej. "Generar" vs "Guardar cambios" al editar).
async function runWithButtonLock(btnId, fn) {
  const btn = document.getElementById(btnId);
  if (btn) {
    if (btn.disabled) return; // ya hay un guardado en curso, ignora el clic extra
    btn.disabled = true;
  }
  try {
    await fn();
  } finally {
    if (btn) btn.disabled = false;
  }
}

// Todo texto que viene de fuera (nombres importados de un PDF/Excel, clientes,
// notas) pasa por aquí antes de ir a innerHTML: sin esto una comilla rompe el
// campo y un archivo malicioso podría inyectar código en la página.
function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 2500);
}

function showApp() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('currentUserLabel').textContent = currentUser.email;
}

// Tope de intentos de contraseña: tras 5 fallidos se bloquea el formulario 5
// minutos. Esto es solo del lado del navegador (frena a quien prueba a mano, no
// a un script que llame directo a Supabase). El límite que de verdad vale lo
// pone Supabase Auth en el servidor (ver README, sección Seguridad).
const LOGIN_MAX_FALLOS = 5;
const LOGIN_BLOQUEO_MS = 5 * 60 * 1000;
const LOGIN_LLAVE = 'sl_login_fallos';

function loginEstado() {
  try {
    const s = JSON.parse(localStorage.getItem(LOGIN_LLAVE) || 'null');
    if (s && s.hasta && s.hasta <= Date.now()) { localStorage.removeItem(LOGIN_LLAVE); return { n: 0, hasta: 0 }; }
    return s || { n: 0, hasta: 0 };
  } catch (e) { return { n: 0, hasta: 0 }; }
}
function loginRegistrarFallo() {
  const n = loginEstado().n + 1;
  try { localStorage.setItem(LOGIN_LLAVE, JSON.stringify({ n, hasta: n >= LOGIN_MAX_FALLOS ? Date.now() + LOGIN_BLOQUEO_MS : 0 })); } catch (e) {}
}
function loginMinutosRestantes() {
  const s = loginEstado();
  return s.hasta > Date.now() ? Math.ceil((s.hasta - Date.now()) / 60000) : 0;
}

async function handleLogin() {
  await runWithButtonLock('authSubmitBtn', handleLoginImpl);
}

async function handleLoginImpl() {
  const email = document.getElementById('loginUser').value.trim();
  const pass = document.getElementById('loginPass').value;
  const errBox = document.getElementById('loginError');
  errBox.classList.add('hidden');
  const mostrar = msg => { errBox.textContent = msg; errBox.classList.remove('hidden'); };

  const espera = loginMinutosRestantes();
  if (espera > 0) { mostrar('Demasiados intentos. Espera ' + espera + ' min e inténtalo de nuevo.'); return; }

  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password: pass });
  if (error || !data.session) {
    if (error && (error.status === 429 || /rate limit/i.test(error.message || ''))) {
      mostrar('Demasiados intentos. Espera unos minutos e inténtalo de nuevo.');
      return;
    }
    loginRegistrarFallo();
    const bloqueo = loginMinutosRestantes();
    mostrar(bloqueo > 0 ? 'Demasiados intentos. Espera ' + bloqueo + ' min e inténtalo de nuevo.' : 'Correo o contraseña incorrectos.');
    return;
  }
  try { localStorage.removeItem(LOGIN_LLAVE); } catch (e) {}
  currentAccessToken = data.session.access_token;
  currentUser = { email: data.user.email };
  showApp();
  await refreshAll();
}

async function handleLogout() {
  await supabaseClient.auth.signOut();
  currentAccessToken = null;
  currentUser = null;
  document.getElementById('app').classList.add('hidden');
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('loginUser').value = '';
  document.getElementById('loginPass').value = '';
}

function showForgotPassword() {
  document.getElementById('loginFormCard').classList.add('hidden');
  document.getElementById('forgotEmail').value = document.getElementById('loginUser').value.trim();
  document.getElementById('forgotMsg').classList.add('hidden');
  document.getElementById('forgotBox').classList.remove('hidden');
}

function hideForgotPassword() {
  document.getElementById('forgotBox').classList.add('hidden');
  document.getElementById('loginFormCard').classList.remove('hidden');
}

async function sendPasswordReset() {
  const email = document.getElementById('forgotEmail').value.trim();
  const msg = document.getElementById('forgotMsg');
  msg.classList.remove('hidden');
  msg.style.color = '';
  if (!email) { msg.textContent = 'Escribe tu correo.'; return; }
  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + window.location.pathname,
  });
  if (error) {
    msg.textContent = error.message;
    return;
  }
  msg.style.color = 'var(--green)';
  msg.textContent = 'Si ese correo tiene una cuenta, te llegará un enlace para poner una contraseña nueva.';
}

async function confirmNewPassword() {
  const pass = document.getElementById('newPassword').value;
  const confirm = document.getElementById('newPasswordConfirm').value;
  const msg = document.getElementById('resetPasswordMsg');
  msg.classList.remove('hidden');
  msg.style.color = '';
  if (pass.length < 6) { msg.textContent = 'La contraseña debe tener al menos 6 caracteres.'; return; }
  if (pass !== confirm) { msg.textContent = 'Las contraseñas no coinciden.'; return; }
  const { error } = await supabaseClient.auth.updateUser({ password: pass });
  if (error) {
    msg.textContent = error.message;
    return;
  }
  msg.style.color = 'var(--green)';
  msg.textContent = 'Contraseña actualizada. Ya puedes usarla para iniciar sesión.';
  await supabaseClient.auth.signOut();
  setTimeout(() => {
    window.location.href = window.location.origin + window.location.pathname;
  }, 2000);
}

function showView(view) {
  ['dashboard','clientes','cotizador','presupuestos','contabilidad','reportes','recibo'].forEach(v => {
    document.getElementById('view-' + v).classList.toggle('hidden', v !== view);
  });
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.view === view);
  });
  if (view === 'cotizador') prepareNewQuote();
  if (view === 'presupuestos') preparePresupuestos();
  if (view === 'contabilidad') prepareContabilidad();
  if (view === 'reportes') refreshReportes();
}

let activeCatalogTab = Object.keys(CATALOG)[0];

// Precio LAB (costo, antes de margen e IVA): un botón opcional en el Cotizador
// para cuando se necesita cotizar o revisar al costo en vez del precio de cliente.
// No todos los productos traen LAB en la fuente (Candiles y Cortinas no) — en
// esos casos se usa el precio normal y se avisa "(sin LAB)".
let useLabPrice = false;
// El catálogo ya trae el precio de cliente CON el 16% de IVA incluido (así se
// cobra siempre) — este botón es solo por si algún día se necesita cotizar sin
// IVA. Nunca afecta al precio LAB (ese es el costo puro, sin margen ni IVA).
let ivaOn = true;

function round2(n) { return Math.round(n * 100) / 100; }
// $1,234.56 en vez de $1234.56 en todo lo que se le muestra al cliente o al
// usuario (recibos, PDF, listas) — inputs numéricos reales y el CSV se quedan
// sin comas aparte, para no romper su valor numérico.
function fmtMoney(n) { return '$' + (Number(n) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

function toggleLabPrice() {
  useLabPrice = !useLabPrice;
  const btn = document.getElementById('labToggleBtn');
  btn.textContent = useLabPrice ? '👤 Ver precio cliente' : '💰 Ver precio LAB';
  btn.classList.toggle('lab-active', useLabPrice);
  renderCatalogItems();
}

function toggleIva() {
  ivaOn = !ivaOn;
  const btn = document.getElementById('ivaToggleBtn');
  btn.textContent = ivaOn ? '🧾 IVA incluido (16%)' : '🧾 Sin IVA';
  btn.classList.toggle('lab-active', !ivaOn);
  renderCatalogItems();
}

function effectiveSimplePrice(item) {
  if (useLabPrice && item.lab != null) return item.lab;
  if (item.price == null) return item.price;
  return ivaOn ? item.price : round2(item.price / 1.16);
}
function effectiveCoveragePrices(item) {
  if (useLabPrice && item.labBox != null) return { priceM2: item.labM2, priceBox: item.labBox };
  if (ivaOn) return { priceM2: item.priceM2, priceBox: item.priceBox };
  return { priceM2: round2(item.priceM2 / 1.16), priceBox: round2(item.priceBox / 1.16) };
}
function effectiveAreaPrice(item) {
  return ivaOn ? item.pricePerM2 : round2(item.pricePerM2 / 1.16);
}
function effectiveInstallFee(item) {
  if (!item.installFee) return 0;
  return ivaOn ? item.installFee : round2(item.installFee / 1.16);
}

function renderCatalogTabs() {
  const tabsEl = document.getElementById('catalogTabs');
  tabsEl.innerHTML = Object.keys(CATALOG).map(cat => `
    <button class="catalog-tab ${cat === activeCatalogTab ? 'active' : ''}" onclick="setCatalogTab('${cat.replace(/'/g,"\\'")}')">${cat}</button>
  `).join('');
}
function setCatalogTab(cat) {
  activeCatalogTab = cat;
  renderCatalogTabs();
  renderCatalogItems();
}
function renderCatalogItems() {
  const search = (document.getElementById('catalogSearch').value || '').toLowerCase();
  const items = (CATALOG[activeCatalogTab] || []).filter(p => p.name.toLowerCase().includes(search));
  const el = document.getElementById('catalogItems');
  el.innerHTML = items.length ? items.map((p, i) => {
    const noLab = useLabPrice && (p.coverage ? p.labBox == null : p.lab == null);
    let priceLabel;
    if (p.coverage) {
      const cov = effectiveCoveragePrices(p);
      priceLabel = fmtMoney(cov.priceM2) + '/m² · caja cubre ' + p.coverage + ' m²';
    } else if (p.areaBased) {
      priceLabel = fmtMoney(effectiveAreaPrice(p)) + '/m²' + (p.installFee ? ' + ' + fmtMoney(effectiveInstallFee(p)) + ' instalación' : '') + ' · se corta a la medida exacta';
    } else {
      const eff = effectiveSimplePrice(p);
      priceLabel = eff ? fmtMoney(eff) + (p.m2PerPza ? '/pza · cubre ' + p.m2PerPza + ' m²' : '') : 'sin precio';
    }
    if (noLab) priceLabel += ' (sin LAB)';
    const fotoUrl = productoFotos[p.name];
    const fotoBtn = fotoUrl
      ? `<button class="catalog-photo-thumb" title="Cambiar foto: pega una imagen copiada o elige un archivo" onclick="pickProductoFoto('${p.name.replace(/'/g, "\\'")}')"><img src="${fotoUrl}" alt="" /></button>`
      : `<button class="catalog-photo-btn" title="Agregar foto: pega una imagen copiada o elige un archivo" onclick="pickProductoFoto('${p.name.replace(/'/g, "\\'")}')">📷</button>`;
    return `
    <div class="catalog-item">
      ${fotoBtn}
      <div><span class="name">${p.name}</span><span class="price">${priceLabel}</span></div>
      <button onclick='addFromCatalog(${JSON.stringify(p).replace(/'/g, "&#39;")})'>+ Agregar</button>
    </div>
  `;
  }).join('') : '<div class="catalog-empty">Sin resultados en esta categoría.</div>';
}
function addFromCatalog(item) {
  if (item.coverage) {
    const cov = effectiveCoveragePrices(item);
    addCoverageRow(Object.assign({ dept: activeCatalogTab }, item, cov));
  } else if (item.areaBased) {
    addAreaRow(Object.assign({ dept: activeCatalogTab }, item, { pricePerM2: effectiveAreaPrice(item), installFee: effectiveInstallFee(item) }));
  } else {
    addProductRow({ name: item.name, qty: 1, price: effectiveSimplePrice(item) || '', dept: activeCatalogTab });
  }
}

// Productos a medida real (persianas): se cotiza por m² exacto (ancho x alto),
// sin cajas ni piezas — el cliente da la medida de su ventana y ya.
function addAreaRow(item) {
  productRowCount++;
  const id = 'row_' + productRowCount;
  const wrap = document.createElement('div');
  wrap.className = 'product-row-area';
  wrap.id = id;
  wrap.dataset.pricePerM2 = item.pricePerM2;
  wrap.dataset.installFee = item.installFee || 0;
  wrap.dataset.dept = item.dept || '';
  const installTxt = item.installFee ? ' + ' + fmtMoney(item.installFee) + ' de instalación' : '';
  wrap.innerHTML = `
    <div class="product-row" style="grid-template-columns: 2fr .9fr .9fr 1fr auto auto; margin-bottom:6px;">
      <input class="p-name" value="${escapeHtml(item.name)}" disabled />
      <input placeholder="Ancho (m)" type="number" min="0" step="0.01" class="p-ancho" oninput="recalcTotals()" />
      <input placeholder="Alto (m)" type="number" min="0" step="0.01" class="p-alto" oninput="recalcTotals()" />
      <input placeholder="$0.00" class="p-import" disabled />
      <button class="row-photo-btn" title="Pegar o subir foto de este producto" onclick="pickProductoFoto('${item.name.replace(/'/g, "\\'")}')">📷</button>
      <button class="remove-row-btn" onclick="document.getElementById('${id}').remove(); recalcTotals();">✕</button>
    </div>
    <div class="coverage-info" style="font-size:11px;color:var(--text-secondary);padding-left:2px;">
      ${fmtMoney(item.pricePerM2)}/m²${installTxt} · da el ancho y alto exactos de la ventana
    </div>
  `;
  document.getElementById('productRows').appendChild(wrap);
  refreshRowPhoto(wrap);
  recalcTotals();
}

// ======================= AGREGADO RÁPIDO (texto libre → catálogo) =======================
// Permite escribir algo como "15 m2 de tapiz acanalado" o "3 paneles led 12w" y que el
// sistema busque el producto en TODO el catálogo (no solo la pestaña activa), calcule
// cajas si es un producto por m² (como el tapiz), o la cantidad si es por pieza.
const QUICKADD_UNIT_ALIASES = {
  m2: 'm2', 'm²': 'm2', mts2: 'm2', metros2: 'm2', metros: 'm2', mt2: 'm2',
  caja: 'caja', cajas: 'caja', cja: 'caja',
  pz: 'pz', pza: 'pz', pzas: 'pz', pieza: 'pz', piezas: 'pz', unidad: 'pz', unidades: 'pz', u: 'pz',
};
const QUICKADD_STOPWORDS = ['de', 'del', 'la', 'el', 'los', 'las', 'para', 'con', 'en', 'y', 'un', 'una', 'unos', 'unas'];

function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/²/g, '2')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseQuickAdd(raw) {
  // OJO: los números (con su punto decimal) se leen ANTES de normalizar —
  // normalizeText quita cualquier caracter que no sea letra/dígito, así que un
  // "2.5" normalizado se rompía en "2 5" y arruinaba la medida.
  let text = String(raw || '').toLowerCase().trim();
  let qty = 1, unit = null;

  // "Ancho x alto" (ej. "3x2 de tapiz" o "3 x 2.5 m de piso laminado") — a veces
  // se mide el hueco real en vez de ya traer los m² calculados.
  const dimMatch = text.match(/^(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*/);
  if (dimMatch) {
    qty = round2(parseFloat(dimMatch[1]) * parseFloat(dimMatch[2]));
    unit = 'm2';
    text = text.slice(dimMatch[0].length);
    // si sigue diciendo "m", "m2" o "metros" después de la medida, se lo come
    const mMatch = text.match(/^(m2|m²|m|metros?|mts?2?)\s*/);
    if (mMatch) text = text.slice(mMatch[0].length);
  } else {
    const numMatch = text.match(/^(\d+(?:\.\d+)?)\s*/);
    if (numMatch) {
      qty = parseFloat(numMatch[1]) || 1;
      text = text.slice(numMatch[0].length);
      // Solo se consume la siguiente palabra si de verdad es una unidad conocida
      // (m2, caja, pza…) — antes se comía la primera palabra SIEMPRE, así que
      // algo como "2 cortinas shades..." perdía "cortinas" sin darse cuenta.
      const unitMatch = text.match(/^([a-z0-9²]+)\s*/);
      if (unitMatch && QUICKADD_UNIT_ALIASES[normalizeText(unitMatch[1])]) {
        unit = QUICKADD_UNIT_ALIASES[normalizeText(unitMatch[1])];
        text = text.slice(unitMatch[0].length);
      }
    }
  }

  // El resto (nombre del producto) sí se normaliza completo: acentos, símbolos, etc.
  text = normalizeText(text);
  let words = text.split(' ').filter(w => w && !QUICKADD_STOPWORDS.includes(w));
  if (!unit && words.length && QUICKADD_UNIT_ALIASES[words[0]]) { unit = QUICKADD_UNIT_ALIASES[words[0]]; words = words.slice(1); }
  return { qty, unit, query: words.join(' ') };
}

function searchCatalogAll(query) {
  const qWords = normalizeText(query).split(' ').filter(Boolean);
  if (!qWords.length) return [];
  const results = [];
  Object.keys(CATALOG).forEach(dept => {
    CATALOG[dept].forEach(item => {
      const nameNorm = normalizeText(item.name);
      const nameWords = nameNorm.split(' ');
      // Compara también por prefijo (>=4 letras) para que "paneles" encuentre "panel",
      // "cortinas" encuentre "cortina", etc. — plural/singular no debería importar.
      const score = qWords.filter(w => nameNorm.includes(w) || nameWords.some(nw =>
        nw.length >= 4 && w.length >= 4 && (nw.startsWith(w) || w.startsWith(nw))
      )).length;
      if (score > 0) results.push({ item, dept, score, full: score === qWords.length });
    });
  });
  results.sort((a, b) => b.score - a.score || a.item.name.length - b.item.name.length);
  return results;
}

function addQuickMatch(item, dept, parsed) {
  if (item.coverage) {
    const cajas = parsed.unit === 'caja' ? Math.ceil(parsed.qty) : Math.ceil(parsed.qty / item.coverage);
    const cov = effectiveCoveragePrices(item);
    addCoverageRow(Object.assign({ dept }, item, cov));
    const rows = document.querySelectorAll('.product-row-coverage');
    rows[rows.length - 1].querySelector('.p-cajas').value = cajas;
    recalcTotals();
    showToast(`Agregado: ${cajas} caja(s) de ${item.name} (cubre ${(cajas * item.coverage).toFixed(1)} m²)`);
  } else if (item.m2PerPza && parsed.unit === 'm2') {
    // Productos que se venden por pieza pero se piden por m² (ej. Tapiz Acanalado,
    // cada pieza cubre X m²) — convierte los m² pedidos a piezas necesarias.
    const qty = Math.ceil(parsed.qty / item.m2PerPza);
    addProductRow({ name: item.name, qty, price: effectiveSimplePrice(item), dept });
    showToast(`Agregado: ${qty} pieza(s) de ${item.name} (cubre ${(qty * item.m2PerPza).toFixed(1)} m²)`);
  } else {
    addProductRow({ name: item.name, qty: parsed.qty, price: effectiveSimplePrice(item), dept });
    showToast(`Agregado: ${parsed.qty} × ${item.name}`);
  }
}

function addQuickMatchFromSuggestion(i) {
  const r = window.__quickAddResults[i];
  addQuickMatch(r.item, r.dept, window.__quickAddParsed);
  document.getElementById('quickAdd').value = '';
  document.getElementById('quickAddSuggestions').innerHTML = '';
}

function handleQuickAdd() {
  const input = document.getElementById('quickAdd');
  const raw = input.value.trim();
  if (!raw) return;
  const parsed = parseQuickAdd(raw);
  const sugBox = document.getElementById('quickAddSuggestions');
  if (!parsed.query) { showToast('Escribe qué producto buscas, ej. "15 m2 de tapiz acanalado"'); return; }

  const results = searchCatalogAll(parsed.query);
  if (!results.length) {
    sugBox.innerHTML = '<div class="catalog-empty">No encontré ese producto en el catálogo. Intenta con otras palabras o agrégalo manual con "+ Agregar producto manual".</div>';
    return;
  }

  const isConfident = results[0].full && (results.length === 1 || results[0].score > results[1].score);
  if (isConfident) {
    addQuickMatch(results[0].item, results[0].dept, parsed);
    input.value = '';
    sugBox.innerHTML = '';
    return;
  }

  const top = results.slice(0, 5);
  window.__quickAddResults = top;
  window.__quickAddParsed = parsed;
  sugBox.innerHTML = '<div class="quickadd-hint">¿Cuál de estos?</div>' + top.map((r, i) => {
    const priceLabel = r.item.coverage
      ? fmtMoney(r.item.priceM2) + '/m² · caja cubre ' + r.item.coverage + ' m²'
      : (r.item.price ? fmtMoney(r.item.price) : 'sin precio');
    return `<div class="catalog-item">
      <div><span class="name">${r.item.name}</span><span class="price">${priceLabel} · ${r.dept}</span></div>
      <button onclick='addQuickMatchFromSuggestion(${i})'>+ Agregar</button>
    </div>`;
  }).join('');
}

// Importa productos que NO están en el catálogo desde un Excel/CSV. Esto SOLO llena la
// cotización actual — nunca modifica el catálogo/listas de precios guardadas del sistema.
// Columnas reconocidas (insensible a mayúsculas/acentos): Producto/Concepto, Cantidad,
// Precio Unitario, y opcionalmente Sección/Categoría y Unidad (para presupuestos por partidas,
// como los de remodelación con Herrería / Albañilería / Cancelería, etc.).
// Router: decide si el archivo es Excel/CSV o PDF y llama al lector correspondiente.
function handleFileImport(event) {
  const file = event.target.files[0];
  if (!file) return;
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'pdf') {
    handlePdfImport(file, event);
  } else {
    handleExcelImport(event);
  }
}

// Lee un PDF (cotización o lista de precios) y agrega sus renglones a la
// cotización. Las filas quedan editables antes de generar.
async function handlePdfImport(file, event) {
  if (!window.pdfjsLib) { showToast('No se pudo cargar el lector de PDF'); return; }
  try {
    const { rows } = parsePdfPages(await readPdfPages(file));
    rows.forEach(addProductRow);
    showToast(rows.length > 0 ? `${rows.length} renglón(es) importados del PDF — revísalos antes de generar` : 'No se detectaron renglones con precio en el PDF');
  } catch (err) {
    console.error('Error al leer el PDF', err);
    showToast('No se pudo leer el PDF. Intenta con el Excel del mismo documento.');
  }
  event.target.value = '';
}

async function handleExcelImport(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const { rows } = parseSheetRows(await readSheetRows(file));
    rows.forEach(addProductRow);
    showToast(rows.length > 0 ? `${rows.length} concepto(s) importados del Excel` : 'No se encontraron filas válidas en el archivo');
  } catch (err) {
    console.error('Error al leer el Excel', err);
    showToast('No se pudo leer el archivo. Revisa el formato.');
  }
  event.target.value = '';
}

function addProductRow(prefill) {
  productRowCount++;
  const id = 'row_' + productRowCount;
  const wrap = document.createElement('div');
  wrap.className = 'product-row';
  wrap.id = id;
  wrap.dataset.dept = prefill && prefill.dept ? prefill.dept : '';
  wrap.dataset.section = prefill && prefill.section ? prefill.section : '';
  wrap.dataset.unit = prefill && prefill.unit ? prefill.unit : '';
  wrap.innerHTML = `
    <input placeholder="Nombre del producto" class="p-name" value="${prefill ? escapeHtml(prefill.name) : ''}" oninput="recalcTotals()" />
    <input placeholder="1" type="number" min="0" class="p-qty" value="${prefill ? prefill.qty : 1}" oninput="recalcTotals()" />
    <input placeholder="0.00" type="number" min="0" class="p-price" value="${prefill ? prefill.price : ''}" oninput="recalcTotals()" />
    <input placeholder="$0.00" class="p-import" disabled />
    <button class="row-photo-btn" title="Pegar o subir foto de este producto" onclick="pickProductoFoto(document.getElementById('${id}').querySelector('.p-name').value.trim())">📷</button>
    <button class="remove-row-btn" onclick="document.getElementById('${id}').remove(); recalcTotals();">✕</button>
  `;
  document.getElementById('productRows').appendChild(wrap);
  refreshRowPhoto(wrap);
  recalcTotals();
}

// Fila especial para productos que se venden por caja (Tekno-Step): el usuario
// da largo x ancho en metros, y el sistema calcula solo los m² y cuántas cajas se necesitan.
function addCoverageRow(item) {
  productRowCount++;
  const id = 'row_' + productRowCount;
  const wrap = document.createElement('div');
  wrap.className = 'product-row-coverage';
  wrap.id = id;
  wrap.dataset.coverage = item.coverage;
  wrap.dataset.priceBox = item.priceBox;
  wrap.dataset.priceM2 = item.priceM2;
  wrap.dataset.dept = item.dept || '';
  wrap.innerHTML = `
    <div class="product-row" style="grid-template-columns: 2fr .9fr .9fr .9fr 1fr auto auto; margin-bottom:6px;">
      <input class="p-name" value="${escapeHtml(item.name)}" disabled />
      <input placeholder="Largo (m)" type="number" min="0" step="0.01" class="p-largo" oninput="onLargoAnchoChange('${id}')" />
      <input placeholder="Ancho (m)" type="number" min="0" step="0.01" class="p-ancho" oninput="onLargoAnchoChange('${id}')" />
      <input placeholder="Cajas" type="number" min="0" step="1" class="p-cajas" oninput="recalcTotals()" />
      <input placeholder="$0.00" class="p-import" disabled />
      <button class="row-photo-btn" title="Pegar o subir foto de este producto" onclick="pickProductoFoto('${item.name.replace(/'/g, "\\'")}')">📷</button>
      <button class="remove-row-btn" onclick="document.getElementById('${id}').remove(); recalcTotals();">✕</button>
    </div>
    <div class="coverage-info" style="font-size:11px;color:var(--text-secondary);padding-left:2px;">
      Cada caja cubre ${item.coverage} m² · ${fmtMoney(item.priceBox)}/caja · captura largo y ancho para calcular solo, o escribe las cajas directamente
    </div>
  `;
  document.getElementById('productRows').appendChild(wrap);
  refreshRowPhoto(wrap);
  recalcTotals();
}

// Cuando cambian largo/ancho, sugerimos el número de cajas (redondeando hacia arriba).
// El campo de cajas queda editable después: si el usuario lo cambia a mano, se respeta
// hasta que vuelva a tocar largo o ancho.
function onLargoAnchoChange(id) {
  const row = document.getElementById(id);
  const largo = parseFloat(row.querySelector('.p-largo').value) || 0;
  const ancho = parseFloat(row.querySelector('.p-ancho').value) || 0;
  const coverage = parseFloat(row.dataset.coverage) || 1;
  const m2 = largo * ancho;
  if (m2 > 0) {
    row.querySelector('.p-cajas').value = Math.ceil(m2 / coverage);
  }
  recalcTotals();
}

function recalcTotals() {
  let subtotal = 0;

  document.querySelectorAll('.product-row-coverage').forEach(row => {
    const largo = parseFloat(row.querySelector('.p-largo').value) || 0;
    const ancho = parseFloat(row.querySelector('.p-ancho').value) || 0;
    const coverage = parseFloat(row.dataset.coverage) || 1;
    const priceBox = parseFloat(row.dataset.priceBox) || 0;
    const cajas = parseFloat(row.querySelector('.p-cajas').value) || 0;
    const m2 = largo * ancho;
    const importe = cajas * priceBox;
    row.querySelector('.p-import').value = importe ? fmtMoney(importe) : '';
    const infoEl = row.querySelector('.coverage-info');
    infoEl.textContent = m2 > 0
      ? `${m2.toFixed(2)} m² · ${cajas} caja(s) (cada caja cubre ${coverage} m²) · ${fmtMoney(priceBox)}/caja`
      : `Cada caja cubre ${coverage} m² · ${fmtMoney(priceBox)}/caja · captura largo y ancho o escribe las cajas directamente`;
    subtotal += importe;
  });

  document.querySelectorAll('#productRows > .product-row').forEach(row => {
    const qty = parseFloat(row.querySelector('.p-qty').value) || 0;
    const price = parseFloat(row.querySelector('.p-price').value) || 0;
    const importe = qty * price;
    row.querySelector('.p-import').value = importe ? fmtMoney(importe) : '';
    subtotal += importe;
  });

  document.querySelectorAll('.product-row-area').forEach(row => {
    const ancho = parseFloat(row.querySelector('.p-ancho').value) || 0;
    const alto = parseFloat(row.querySelector('.p-alto').value) || 0;
    const pricePerM2 = parseFloat(row.dataset.pricePerM2) || 0;
    const installFee = parseFloat(row.dataset.installFee) || 0;
    const m2 = ancho * alto;
    // La instalación es un cargo fijo por persiana, no por m² — solo se cobra
    // una vez que de verdad hay una medida capturada, no en una fila vacía.
    const importe = m2 > 0 ? round2(m2 * pricePerM2 + installFee) : 0;
    row.querySelector('.p-import').value = importe ? fmtMoney(importe) : '';
    subtotal += importe;
  });

  // Los precios del catálogo ya incluyen el IVA — el total nunca desglosa un
  // 16% aparte para que el cliente no lo vea como un cargo extra.
  const iva = 0;
  const total = subtotal;
  document.getElementById('totalVal').textContent = fmtMoney(total);
  return { subtotal, iva, total };
}

// El folio ya no se basa en "cuántas cotizaciones hay" (eso repetía folio si
// generabas dos cotizaciones seguidas sin salir del Cotizador, o si alguna se
// había borrado) — ahora toma el número más alto que exista y le suma 1.
function nextFolioNumber(cotizaciones) {
  let max = 0;
  (cotizaciones || []).forEach(c => {
    const m = /^SL-(\d+)$/.exec(c.folio || '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return 'SL-' + String(max + 1).padStart(4, '0');
}

async function prepareNewQuote() {
  document.getElementById('productRows').innerHTML = '';
  productRowCount = 0;
  document.getElementById('quoteClient').value = '';
  document.getElementById('quotePhone').value = '';
  document.getElementById('quoteEmail').value = '';
  document.getElementById('quoteAddress').value = '';
  document.getElementById('quoteNote').value = '';
  document.getElementById('catalogSearch').value = '';
  document.getElementById('quickAdd').value = '';
  document.getElementById('quickAddSuggestions').innerHTML = '';
  useLabPrice = false;
  const labBtn = document.getElementById('labToggleBtn');
  labBtn.textContent = '💰 Ver precio LAB';
  labBtn.classList.remove('lab-active');
  ivaOn = true;
  const ivaBtn = document.getElementById('ivaToggleBtn');
  ivaBtn.textContent = '🧾 IVA incluido (16%)';
  ivaBtn.classList.add('lab-active');
  activeCatalogTab = Object.keys(CATALOG)[0];
  renderCatalogTabs();
  await cargarProductoFotos();
  renderCatalogItems();
  // Sin conexión y sin caché no se inventa un folio: nextFolioNumber([]) daría
  // SL-0001 y pisaría uno que ya existe. Se deja vacío y Generar lo exige.
  const cotizaciones = (await sbSelectRaw('cotizaciones')) || window.__cotizaciones;
  if (cotizaciones) {
    document.getElementById('quoteFolio').value = nextFolioNumber(cotizaciones);
  } else {
    document.getElementById('quoteFolio').value = '';
    showToast('No se pudo conectar para calcular el folio — revisa tu conexión y vuelve a abrir el Cotizador');
  }
  recalcTotals();
}

async function generateQuote() {
  await runWithButtonLock('quoteGenerateBtn', generateQuoteImpl);
}

async function generateQuoteImpl() {
  const client = document.getElementById('quoteClient').value.trim();
  if (!client) { showToast('Escribe el nombre del cliente'); return; }
  const rows = [];

  document.querySelectorAll('.product-row-coverage').forEach(row => {
    const name = row.querySelector('.p-name').value.trim();
    const largo = parseFloat(row.querySelector('.p-largo').value) || 0;
    const ancho = parseFloat(row.querySelector('.p-ancho').value) || 0;
    const cajas = parseFloat(row.querySelector('.p-cajas').value) || 0;
    const priceBox = parseFloat(row.dataset.priceBox) || 0;
    const m2 = largo * ancho;
    if (name && cajas > 0) {
      rows.push({ name, largo, ancho, m2: Number(m2.toFixed(2)), cajas, priceBox, importe: cajas * priceBox, dept: row.dataset.dept || null, foto: productoFotos[name] || null });
    }
  });

  document.querySelectorAll('#productRows > .product-row').forEach(row => {
    const name = row.querySelector('.p-name').value.trim();
    const qty = parseFloat(row.querySelector('.p-qty').value) || 0;
    const price = parseFloat(row.querySelector('.p-price').value) || 0;
    if (name) rows.push({ name, qty, price, importe: qty * price, dept: row.dataset.dept || null, section: row.dataset.section || '', unit: row.dataset.unit || '', foto: productoFotos[name] || null });
  });

  document.querySelectorAll('.product-row-area').forEach(row => {
    const name = row.querySelector('.p-name').value.trim();
    const ancho = parseFloat(row.querySelector('.p-ancho').value) || 0;
    const alto = parseFloat(row.querySelector('.p-alto').value) || 0;
    const pricePerM2 = parseFloat(row.dataset.pricePerM2) || 0;
    const installFee = parseFloat(row.dataset.installFee) || 0;
    const m2 = round2(ancho * alto);
    if (name && m2 > 0) {
      rows.push({ name, ancho, alto, m2, pricePerM2, installFee, importe: round2(m2 * pricePerM2 + installFee), dept: row.dataset.dept || null, foto: productoFotos[name] || null });
    }
  });

  if (rows.length === 0) { showToast('Agrega al menos un producto'); return; }
  const totals = recalcTotals();
  const folio = document.getElementById('quoteFolio').value;
  if (!folio) { showToast('Falta el folio — revisa tu conexión y vuelve a abrir el Cotizador'); return; }

  const quote = {
    folio,
    client,
    phone: document.getElementById('quotePhone').value.trim(),
    email: document.getElementById('quoteEmail').value.trim(),
    address: document.getElementById('quoteAddress').value.trim(),
    note: document.getElementById('quoteNote').value.trim(),
    items: rows,
    subtotal: totals.subtotal,
    iva: totals.iva,
    total: totals.total,
    iva_incluido: ivaOn,
  };

  if (editingQuoteId) {
    // Al editar NO se toca estatus/pagado/generado_por — si ya estaba Aprobada
    // y pagada, corregir un producto no debe regresarla a "Enviada" ni borrar
    // quién la hizo originalmente.
    const ok = await sbUpdate('cotizaciones', editingQuoteId, quote);
    if (!ok) { showToast('No se pudo guardar el cambio, revisa tu conexión'); return; }
    await upsertClienteContacto(client, quote.phone, quote.email, quote.address);
    showToast('Cotización ' + folio + ' actualizada');
    const editedId = editingQuoteId;
    editingQuoteId = null;
    document.getElementById('quoteGenerateBtn').textContent = '📄 Generar Cotización';
    document.getElementById('quoteCancelEditBtn').classList.add('hidden');
    await refreshAll();
    const saved = (window.__cotizaciones || []).find(c => c.id === editedId);
    renderRecibo(quote, saved ? saved.fecha : new Date().toISOString());
    showView('recibo');
    return;
  }

  const insertPayload = Object.assign({ estatus: 'Enviada', generado_por: currentUser.email }, quote);
  let inserted = await sbInsert('cotizaciones', insertPayload);
  if (!inserted && insertPayload.note) {
    // La columna "note" puede no existir todavía en Supabase; reintenta sin ella
    // para no bloquear el guardado (la nota de todos modos sale impresa en el PDF).
    const { note, ...quoteSinNota } = insertPayload;
    inserted = await sbInsert('cotizaciones', quoteSinNota);
  }
  if (!inserted) { showToast('No se pudo guardar la cotización, revisa tu conexión'); return; }

  await upsertClienteContacto(client, quote.phone, quote.email, quote.address);

  showToast('Cotización ' + folio + ' generada y guardada');
  await refreshAll();
  document.getElementById('quoteFolio').value = nextFolioNumber((window.__cotizaciones || []).concat([{ folio }]));
  const fecha = (inserted[0] && inserted[0].fecha) ? inserted[0].fecha : new Date().toISOString();
  renderRecibo(quote, fecha);
  showView('recibo');
}

function renderRecibo(quote, fecha) {
  const fechaObj = new Date(fecha);
  const fmt = d => d.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const contactoLine = [quote.phone, quote.email].filter(Boolean).join(' · ') || '—';

  const hasSections = quote.items.some(it => it.section);

  if (hasSections) {
    renderRecibopresupuesto(quote, fechaObj, fmt, contactoLine);
  } else {
    renderReciboProductos(quote, fechaObj, fmt, contactoLine);
  }
}

// Formato "Nota de Cobro" normal, para cotizaciones armadas desde el catálogo de productos.
function renderReciboProductos(quote, fechaObj, fmt, contactoLine) {
  const deptTags = [...new Set(quote.items.map(it => it.dept).filter(Boolean))];
  const tagline = deptTags.length ? deptTags.join(' · ') : 'SPAZIO LUCE';

  const rowsHtml = quote.items.map(it => {
    const isCoverage = it.cajas != null;
    const isArea = !isCoverage && it.m2 != null;
    const cantLabel = isCoverage ? `${it.cajas} caja(s)` : isArea ? `${it.m2} m²` : it.qty;
    const priceLabel = isCoverage ? it.priceBox : isArea ? it.pricePerM2 : it.price;
    const subLabel = isCoverage ? `${it.largo}m × ${it.ancho}m = ${it.m2} m²` : isArea ? `${it.ancho}m × ${it.alto}m${it.installFee ? ' + ' + fmtMoney(it.installFee) + ' instalación' : ''}` : '';
    return `<tr>
      <td>
        <span class="item-name">${escapeHtml(it.name)}</span>
        ${subLabel ? `<span class="item-sub">${subLabel}</span>` : ''}
        ${it.foto ? `<div class="item-photo-box"><img src="${escapeHtml(it.foto)}" alt="${escapeHtml(it.name)}" /></div>` : ''}
      </td>
      <td>${cantLabel}</td>
      <td>${fmtMoney(priceLabel)}</td>
      <td><strong>${fmtMoney(it.importe)}</strong></td>
    </tr>`;
  }).join('');

  document.getElementById('reciboCard').innerHTML = `
    <div class="recibo-header">
      <div>
        <div class="logo-block"><img src="${reciboLogoUri}" alt="Spazio Luce" /></div>
        <div class="logo-tagline">${tagline}</div>
      </div>
      <div class="recibo-title">
        <h2>COTIZACIÓN</h2>
        <div class="meta">
          Fecha: ${fmt(fechaObj)}<br/>
          Folio: ${escapeHtml(quote.folio)}
        </div>
      </div>
    </div>
    <div class="recibo-divider"></div>

    <div class="recibo-info">
      <div>
        <div><b>Cliente:</b> ${escapeHtml(quote.client)}</div>
        <div><b>Contacto:</b> ${contactoLine}</div>
      </div>
      <div>
        <div><b>Validez:</b> 15 días</div>
        <div><b>Entrega:</b> A convenir</div>
      </div>
    </div>

    <table>
      <thead><tr><th>Descripción</th><th>Cant.</th><th>P. Unit.</th><th>Importe</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>

    <div class="recibo-totals">
      <div>Subtotal: ${fmtMoney(quote.subtotal)}</div>
      ${quote.iva ? `<div>IVA: ${fmtMoney(quote.iva)}</div>` : ''}
    </div>
    <div class="recibo-total-bar">
      <div>TOTAL:</div>
      <div class="grand-amount">${fmtMoney(quote.total)}</div>
    </div>

    ${quote.note ? `<div class="condiciones" style="margin-top:14px;"><b>NOTA:</b> ${escapeHtml(quote.note)}</div>` : ''}

    <div class="condiciones">
      * Precios preferenciales de Spazio Luce sobre catálogo general.<br/>
      * Precios sujetos a cambio sin previo aviso. Cotización válida por 15 días naturales.<br/>
      * No incluye instalación ni envío, salvo que se indique lo contrario.<br/>
      * Se solicita 50% de anticipo para apartar mercancía o iniciar pedido especial; el resto se liquida contra entrega.
    </div>

    <div class="firma-row">
      <div>Autoriza (Spazio Luce)</div>
      <div>Acepta (Cliente)</div>
    </div>

    <div class="recibo-footer">
      <div class="brand">SPAZIO LUCE</div>
      <span>spazioluce.netlify.app</span>
      <span>${escapeHtml(quote.email || 'spazioluce09@gmail.com')}</span>
    </div>
  `;

  wireReciboButtons(quote);
}

// Formato "Presupuesto por partidas" (Herrería, Albañilería, Cancelería...) para
// cotizaciones de remodelación importadas desde Excel — mismo estilo que ya usan en PDF.
function renderRecibopresupuesto(quote, fechaObj, fmt, contactoLine) {
  const sections = [];
  const order = [];
  quote.items.forEach(it => {
    const sec = it.section || 'GENERAL';
    if (!order.includes(sec)) order.push(sec);
  });
  order.forEach(sec => {
    sections.push({ name: sec, items: quote.items.filter(it => (it.section || 'GENERAL') === sec) });
  });

  const sectionsHtml = sections.map(sec => {
    const rows = sec.items.map((it, i) => `
      <tr>
        <td style="width:26px;color:#999;">${i + 1}</td>
        <td>${escapeHtml(it.name)}</td>
        <td style="width:50px;">${escapeHtml(it.unit || '—')}</td>
        <td style="width:50px;">${it.qty}</td>
        <td style="width:90px;">${fmtMoney(it.price)}</td>
        <td style="width:100px;"><strong>${fmtMoney(it.importe)}</strong></td>
      </tr>
    `).join('');
    return `
      <div class="presupuesto-section-bar">${sec.name.toUpperCase()}</div>
      <table>
        <thead><tr><th>#</th><th>Concepto</th><th>Un</th><th>Cant</th><th>P.U.</th><th>Importe</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }).join('');

  document.getElementById('reciboCard').innerHTML = `
    <div class="recibo-header">
      <div>
        <div class="logo-block"><img src="${reciboLogoUri}" alt="Spazio Luce" /></div>
        <div class="logo-tagline">REMODELACIÓN · ILUMINACIÓN · ACABADOS</div>
      </div>
      <div class="recibo-title">
        <h2>COTIZACIÓN</h2>
        <div class="meta">
          Fecha: ${fmt(fechaObj)}<br/>
          Folio: ${escapeHtml(quote.folio)}
        </div>
      </div>
    </div>
    <div class="recibo-divider"></div>

    <div class="recibo-info">
      <div>
        <div><b>Proyecto:</b> ${escapeHtml(quote.address || '—')}</div>
        <div><b>Cliente:</b> ${escapeHtml(quote.client)}</div>
      </div>
      <div>
        <div><b>Contacto:</b> ${contactoLine}</div>
        <div><b>Validez:</b> 15 días</div>
      </div>
    </div>

    ${sectionsHtml}

    ${quote.note ? `<div class="condiciones" style="margin-top:14px;"><b>NOTA:</b> ${escapeHtml(quote.note)}</div>` : ''}

    <div class="recibo-totals">
      <div>Subtotal: ${fmtMoney(quote.subtotal)}</div>
    </div>
    <div class="recibo-total-bar">
      <div>TOTAL:</div>
      <div class="grand-amount">${fmtMoney(quote.total)}</div>
    </div>

    <div class="condiciones">
      * Cotización válida por 15 días naturales a partir de la fecha de emisión.
    </div>

    <div class="firma-row">
      <div>Autoriza (Spazio Luce)</div>
      <div>Acepta (Cliente)</div>
    </div>

    <div class="recibo-footer">
      <div class="brand">SPAZIO LUCE</div>
      <span>spazioluce09@gmail.com</span>
      <span>Naucalpan, Edo. Méx.</span>
    </div>
  `;

  wireReciboButtons(quote);
}

function wireReciboButtons(quote) {
  const waMsg = encodeURIComponent(
    `Hola ${quote.client}, te comparto tu cotización ${quote.folio} de Spazio Luce por un total de ${fmtMoney(quote.total)}. En un momento te mando el PDF. ¡Gracias!`
  );
  const phoneDigits = (quote.phone || '').replace(/\D/g, '');
  document.getElementById('reciboWhatsBtn').onclick = () => {
    window.open(`https://wa.me/${phoneDigits}?text=${waMsg}`, '_blank');
  };
  document.getElementById('reciboMailBtn').onclick = () => {
    const subject = encodeURIComponent('Cotización ' + quote.folio + ' · Spazio Luce');
    window.open(`mailto:${quote.email || ''}?subject=${subject}&body=${waMsg}`, '_blank');
  };
}

// Borrar del historial requiere la contraseña de administrador, sin importar
// quién tenga la sesión abierta en ese momento (Juan no puede borrar solo).
async function deleteQuote(id) {
  if (!confirm('¿Eliminar esta cotización? Esta acción no se puede deshacer.')) return;
  const ok = await sbDelete('cotizaciones', id);
  if (ok) {
    showToast('Cotización eliminada');
    await refreshAll();
  } else {
    showToast('No se pudo eliminar, revisa tu conexión');
  }
}

// ======================= PRESUPUESTOS (independiente del Cotizador) =======================
// Esta sección NUNCA toca el catálogo de productos ni las filas del Cotizador.
// Sirve para convertir un presupuesto ya armado (Excel/PDF/Word) al formato Spazio Luce.
let presuRowCount = 0;

function todayForDateInput() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function preparePresupuestos() {
  document.getElementById('presupuestoRows').innerHTML = '';
  presuRowCount = 0;
  document.getElementById('presuClient').value = '';
  document.getElementById('presuProject').value = '';
  document.getElementById('presuFolio').value = '';
  const fechaEl = document.getElementById('presuFecha');
  fechaEl.value = todayForDateInput();
  fechaEl.dataset.auto = '1';
  document.getElementById('presuContact').value = '';
  document.getElementById('presuNote').value = '';
  document.getElementById('presuIvaToggle').checked = false;
  recalcPresuTotals();
}

// La fecha se precarga con hoy, pero si el documento importado trae su propia fecha,
// esa debe ganarle — a menos que el usuario ya la haya tocado a mano.
function presuSetFechaIfAuto(value) {
  const el = document.getElementById('presuFecha');
  if (el && (el.dataset.auto === '1' || !el.value) && value) {
    el.value = value;
    el.dataset.auto = '1';
  }
}

function addPresuRow(prefill) {
  presuRowCount++;
  const id = 'presu_' + presuRowCount;
  const wrap = document.createElement('div');
  wrap.className = 'presu-row';
  wrap.id = id;
  wrap.style.cssText = 'display:grid;grid-template-columns:1.6fr 2fr .7fr .6fr .8fr .9fr auto;gap:8px;align-items:center;';
  wrap.innerHTML = `
    <input placeholder="Sección" class="ps-section" value="${prefill && prefill.section ? escapeHtml(prefill.section) : ''}" oninput="recalcPresuTotals()" />
    <input placeholder="Concepto" class="ps-name" value="${prefill && prefill.name ? escapeHtml(prefill.name) : ''}" oninput="recalcPresuTotals()" />
    <input placeholder="Un" class="ps-unit" value="${prefill && prefill.unit ? escapeHtml(prefill.unit) : ''}" oninput="recalcPresuTotals()" />
    <input placeholder="1" type="number" min="0" class="ps-qty" value="${prefill && prefill.qty ? prefill.qty : 1}" oninput="recalcPresuTotals()" />
    <input placeholder="0.00" type="number" min="0" class="ps-price" value="${prefill && prefill.price ? prefill.price : ''}" oninput="recalcPresuTotals()" />
    <input placeholder="$0.00" class="ps-import" disabled />
    <button class="remove-row-btn" onclick="document.getElementById('${id}').remove(); recalcPresuTotals();">✕</button>
  `;
  document.getElementById('presupuestoRows').appendChild(wrap);
  recalcPresuTotals();
}

function recalcPresuTotals() {
  let subtotal = 0;
  document.querySelectorAll('.presu-row').forEach(row => {
    const qty = parseFloat(row.querySelector('.ps-qty').value) || 0;
    const price = parseFloat(row.querySelector('.ps-price').value) || 0;
    const importe = qty * price;
    row.querySelector('.ps-import').value = importe ? fmtMoney(importe) : '';
    subtotal += importe;
  });
  const ivaOn = document.getElementById('presuIvaToggle').checked;
  const iva = ivaOn ? subtotal * 0.16 : 0;
  const total = subtotal + iva;
  document.getElementById('presuSubtotalVal').textContent = fmtMoney(subtotal);
  document.getElementById('presuIvaVal').textContent = ivaOn ? fmtMoney(iva) : 'No incluido';
  document.getElementById('presuTotalVal').textContent = fmtMoney(total);
  return { subtotal, iva, total };
}

// Router de importación para la sección de Presupuestos (separado del Cotizador)
function handlePresuFileImport(event) {
  const file = event.target.files[0];
  if (!file) return;
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'pdf') presuImportPdf(file, event);
  else if (ext === 'docx') presuImportDocx(file, event);
  else presuImportExcel(file, event);
}

function presuSetMetaIfEmpty(id, value) {
  const el = document.getElementById(id);
  if (el && !el.value && value) el.value = value;
}

async function presuImportExcel(file, event) {
  try {
    const { rows, folio } = parseSheetRows(await readSheetRows(file));
    rows.forEach(addPresuRow);
    if (folio) presuSetMetaIfEmpty('presuFolio', folio);
    showToast(rows.length > 0 ? `${rows.length} renglón(es) importados` : 'No se encontraron filas válidas');
  } catch (err) {
    console.error(err);
    showToast('No se pudo leer el Excel.');
  }
  event.target.value = '';
}

async function presuImportPdf(file, event) {
  if (!window.pdfjsLib) { showToast('No se pudo cargar el lector de PDF'); return; }
  try {
    const { rows, fullText } = parsePdfPages(await readPdfPages(file));
    rows.forEach(addPresuRow);

    const meta = extractDocMeta(fullText);
    if (meta.cliente) presuSetMetaIfEmpty('presuClient', meta.cliente);
    if (meta.proyecto) presuSetMetaIfEmpty('presuProject', meta.proyecto);
    if (meta.folio) presuSetMetaIfEmpty('presuFolio', meta.folio);
    if (meta.fecha) presuSetFechaIfAuto(meta.fecha);
    if (meta.nota) presuSetMetaIfEmpty('presuNote', meta.nota);

    showToast(rows.length > 0 ? `${rows.length} renglón(es) importados — revisa antes de generar` : 'No se detectaron renglones con precio');
  } catch (err) {
    console.error(err);
    showToast('No se pudo leer el PDF.');
  }
  event.target.value = '';
}

async function presuImportDocx(file, event) {
  if (!window.mammoth) { showToast('No se pudo cargar el lector de Word'); return; }
  try {
    const buffer = await file.arrayBuffer();
    const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
    const doc = new DOMParser().parseFromString(result.value, 'text/html');
    const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
    let currentSection = '';
    let imported = 0;

    Array.from(doc.body.children).forEach(el => {
      const text = el.textContent.trim();
      if (!text) return;

      if (el.tagName === 'TABLE') {
        const trs = Array.from(el.querySelectorAll('tr'));
        if (!trs.length) return;

        // Si la primera fila trae encabezados reconocibles (Concepto, Cantidad, Precio…),
        // úsalos para saber qué columna es qué — mucho más confiable que adivinar por
        // posición, que fallaba si la tabla no tenía exactamente 3 columnas numéricas.
        const headerCells = Array.from(trs[0].querySelectorAll('td,th')).map(c => norm(c.textContent));
        const findCol = (...keys) => headerCells.findIndex(h => keys.some(k => h.includes(k)));
        const nameCol = findCol('concepto', 'producto', 'nombre', 'descripcion');
        const qtyCol = findCol('cant');
        const priceCol = findCol('precio', 'p.u');
        const sectionCol = findCol('seccion', 'categoria', 'partida');
        const hasHeader = nameCol !== -1 && (qtyCol !== -1 || priceCol !== -1);
        const dataRows = hasHeader ? trs.slice(1) : trs;

        dataRows.forEach(tr => {
          const cells = Array.from(tr.querySelectorAll('td,th')).map(td => td.textContent.trim());
          if (cells.length < 2) return;
          let name, qty, price, section;

          if (hasHeader) {
            name = nameCol !== -1 ? cells[nameCol] : cells[0];
            qty = qtyCol !== -1 ? parseFloat(String(cells[qtyCol]).replace(/[^0-9.]/g, '')) : NaN;
            price = priceCol !== -1 ? parseFloat(String(cells[priceCol]).replace(/[^0-9.]/g, '')) : NaN;
            section = sectionCol !== -1 ? cells[sectionCol] : currentSection;
          } else {
            const moneyCells = cells.filter(c => /\$?\s*[\d,]+\.\d{2}/.test(c));
            if (moneyCells.length === 0) return;
            name = cells[0];
            const nums = cells.map(c => parseFloat(String(c).replace(/[^0-9.]/g, ''))).filter(n => !isNaN(n));
            qty = nums.length >= 3 ? nums[nums.length - 3] : 1;
            price = nums.length >= 2 ? nums[nums.length - 2] : (nums[0] || 0);
            section = currentSection;
          }

          if (!name || /^concepto$|^#$/i.test(name)) return;
          addPresuRow({ name, qty: isNaN(qty) ? 1 : qty, price: isNaN(price) ? 0 : price, section });
          imported++;
        });
      } else if (/^(H1|H2|H3|STRONG|B)$/.test(el.tagName) || looksLikeSectionHeader(text)) {
        currentSection = text;
      }
    });

    const meta = extractDocMeta(doc.body.textContent || '');
    if (meta.cliente) presuSetMetaIfEmpty('presuClient', meta.cliente);
    if (meta.proyecto) presuSetMetaIfEmpty('presuProject', meta.proyecto);
    if (meta.folio) presuSetMetaIfEmpty('presuFolio', meta.folio);
    if (meta.fecha) presuSetFechaIfAuto(meta.fecha);
    if (meta.nota) presuSetMetaIfEmpty('presuNote', meta.nota);

    showToast(imported > 0 ? `${imported} renglón(es) importados — revisa antes de generar` : 'No se encontraron tablas con precios en el Word');
  } catch (err) {
    console.error(err);
    showToast('No se pudo leer el Word.');
  }
  event.target.value = '';
}

async function generatePresupuesto() {
  await runWithButtonLock('presuGenerateBtn', generatePresupuestoImpl);
}

async function generatePresupuestoImpl() {
  const client = document.getElementById('presuClient').value.trim();
  if (!client) { showToast('Escribe el nombre del cliente'); return; }

  const rows = [];
  document.querySelectorAll('.presu-row').forEach(row => {
    const name = row.querySelector('.ps-name').value.trim();
    const unit = row.querySelector('.ps-unit').value.trim();
    const section = row.querySelector('.ps-section').value.trim();
    const qty = parseFloat(row.querySelector('.ps-qty').value) || 0;
    const price = parseFloat(row.querySelector('.ps-price').value) || 0;
    if (name) rows.push({ name, unit, section, qty, price, importe: qty * price });
  });
  if (rows.length === 0) { showToast('Agrega al menos un renglón'); return; }

  const totals = recalcPresuTotals();
  let folio = document.getElementById('presuFolio').value.trim();
  if (!folio) folio = 'SL-' + Date.now().toString().slice(-6);

  const contact = document.getElementById('presuContact').value.trim();
  const isEmail = contact.includes('@');

  const quote = {
    folio,
    client,
    phone: isEmail ? '' : contact,
    email: isEmail ? contact : '',
    address: document.getElementById('presuProject').value.trim(),
    note: document.getElementById('presuNote').value.trim(),
    items: rows,
    subtotal: totals.subtotal,
    iva: totals.iva,
    total: totals.total,
    iva_incluido: document.getElementById('presuIvaToggle').checked,
  };

  if (editingQuoteId) {
    // Igual que en el Cotizador: editar no debe tocar estatus/pagado/quién lo
    // generó originalmente.
    const ok = await sbUpdate('cotizaciones', editingQuoteId, quote);
    if (!ok) showToast('No se pudo guardar el cambio, revisa tu conexión');
    else showToast('Presupuesto ' + folio + ' actualizado');
    editingQuoteId = null;
    document.getElementById('presuGenerateBtn').textContent = '📄 Generar Presupuesto Spazio Luce';
    document.getElementById('presuCancelEditBtn').classList.add('hidden');
  } else {
    const insertPayload = Object.assign({ estatus: 'Enviada', generado_por: currentUser.email }, quote);
    let inserted = await sbInsert('cotizaciones', insertPayload);
    if (!inserted && insertPayload.note) {
      const { note, ...quoteSinNota } = insertPayload;
      inserted = await sbInsert('cotizaciones', quoteSinNota);
    }
    if (!inserted) showToast('No se pudo guardar, pero se genera igual el PDF');
  }

  await upsertClienteContacto(client, quote.phone, quote.email, quote.address);

  await refreshAll();
  // La fecha IMPRESA en el PDF es la del documento original (capturada a mano o
  // detectada al importar) — puede ser distinta de "hoy" si se está digitalizando
  // un presupuesto viejo. La fecha guardada en Supabase (inserted[0].fecha) sigue
  // siendo cuándo se generó realmente, para las estadísticas del sistema.
  const presuFechaVal = document.getElementById('presuFecha').value;
  let fechaImpresa;
  if (presuFechaVal) {
    const [y, m, d] = presuFechaVal.split('-').map(Number);
    fechaImpresa = new Date(y, m - 1, d);
  } else {
    fechaImpresa = new Date();
  }
  const fmt = d => d.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const contactoLine = [quote.phone, quote.email].filter(Boolean).join(' · ') || '—';
  renderRecibopresupuesto(quote, fechaImpresa, fmt, contactoLine);
  showView('recibo');
}

function reprintQuote(id) {
  const q = (window.__cotizaciones || []).find(c => c.id === id);
  if (!q) { showToast('No se encontró esa cotización'); return; }
  renderRecibo(q, q.fecha);
  showView('recibo');
}

// Abre una cotización ya guardada para modificarla. Detecta sola si es del
// Cotizador (por catálogo) o de Presupuestos (por partidas/secciones) y la
// manda a la pantalla correcta ya con todo lleno — "Generar" va a actualizar
// esta misma fila en vez de crear una cotización nueva.
async function editQuote(id) {
  const q = (window.__cotizaciones || []).find(c => c.id === id);
  if (!q) { showToast('No se encontró esa cotización'); return; }
  editingQuoteId = id;
  const hasSections = (q.items || []).some(it => it.section);

  if (hasSections) {
    showView('presupuestos');
    document.getElementById('presuClient').value = q.client || '';
    document.getElementById('presuProject').value = q.address || '';
    document.getElementById('presuFolio').value = q.folio || '';
    document.getElementById('presuContact').value = q.phone || q.email || '';
    document.getElementById('presuNote').value = q.note || '';
    document.getElementById('presuIvaToggle').checked = !!q.iva_incluido;
    const fechaEl = document.getElementById('presuFecha');
    fechaEl.value = q.fecha ? String(q.fecha).slice(0, 10) : todayForDateInput();
    fechaEl.dataset.auto = '0';
    document.getElementById('presupuestoRows').innerHTML = '';
    presuRowCount = 0;
    q.items.forEach(it => addPresuRow(it));
    recalcPresuTotals();
    document.getElementById('presuGenerateBtn').textContent = '💾 Guardar cambios';
    document.getElementById('presuCancelEditBtn').classList.remove('hidden');
  } else {
    showView('cotizador');
    // showView ya disparó prepareNewQuote() (limpia todo y calcula un folio
    // nuevo) pero es async — hay que esperarlo antes de rellenar con los
    // datos reales, si no la carrera deja el folio nuevo pisando el real.
    await prepareNewQuote();
    document.getElementById('quoteClient').value = q.client || '';
    document.getElementById('quotePhone').value = q.phone || '';
    document.getElementById('quoteEmail').value = q.email || '';
    document.getElementById('quoteAddress').value = q.address || '';
    document.getElementById('quoteNote').value = q.note || '';
    document.getElementById('quoteFolio').value = q.folio || '';
    // Los renglones se reconstruyen como productos simples (nombre/cantidad/
    // precio editables) sin importar si originalmente eran por caja o por m² —
    // el importe guardado no se pierde, solo se deja de recalcular solo por
    // medida durante la edición.
    (q.items || []).forEach(it => {
      const qty = it.qty != null ? it.qty : (it.cajas != null ? it.cajas : 1);
      const price = it.price != null ? it.price : (it.priceBox != null ? it.priceBox : round2((Number(it.importe) || 0) / (qty || 1)));
      addProductRow({ name: it.name, qty, price, dept: it.dept || '' });
    });
    recalcTotals();
    document.getElementById('quoteGenerateBtn').textContent = '💾 Guardar cambios';
    document.getElementById('quoteCancelEditBtn').classList.remove('hidden');
  }
  showToast('Editando ' + (q.folio || 'cotización') + ' — los cambios sobrescriben la original');
}

function cancelEditQuote() {
  editingQuoteId = null;
  document.getElementById('quoteGenerateBtn').textContent = '📄 Generar Cotización';
  document.getElementById('quoteCancelEditBtn').classList.add('hidden');
  document.getElementById('presuGenerateBtn').textContent = '📄 Generar Presupuesto Spazio Luce';
  document.getElementById('presuCancelEditBtn').classList.add('hidden');
  prepareNewQuote();
  preparePresupuestos();
}

const ESTATUS_OPTIONS = ['Enviada', 'En revisión', 'Aprobada', 'Rechazada'];
const ESTATUS_PILL_CLASS = { 'Enviada': 'pill-enviada', 'En revisión': 'pill-revision', 'Aprobada': 'pill-aprobada', 'Rechazada': 'pill-rechazada' };

function pillFor(estatus) {
  return '<span class="pill ' + (ESTATUS_PILL_CLASS[estatus] || 'pill-enviada') + '">' + estatus + '</span>';
}

// Antes no había NINGUNA forma de cambiar el estatus de una cotización una vez
// creada — siempre se quedaba en "Enviada" para siempre, así que "Ingresos del mes
// (aprobadas)" nunca sumaba nada y el CRM nunca detectaba una aprobación real.
function estatusSelectHtml(q) {
  const opts = ESTATUS_OPTIONS.map(e => `<option value="${e}" ${e === q.estatus ? 'selected' : ''}>${e}</option>`).join('');
  return `<select class="estatus-select ${ESTATUS_PILL_CLASS[q.estatus] || 'pill-enviada'}" onchange="updateQuoteEstatus(${q.id}, this.value)">${opts}</select>`;
}

async function updateQuoteEstatus(id, estatus) {
  const ok = await sbUpdate('cotizaciones', id, { estatus });
  if (ok) { showToast('Estatus actualizado a "' + estatus + '"'); await refreshAll(); }
  else { showToast('No se pudo actualizar el estatus, revisa tu conexión'); }
}

function pagoBadgeHtml(q) {
  if (q.pagado) {
    return `<span class="pill pill-aprobada" title="${escapeHtml(q.metodo_pago || 'Pago')} · ${fmtFechaCorta(q.fecha_pago)}">✓ Pagado</span>`;
  }
  return `<button class="btn-ghost-sm" title="Registrar el pago de esta cotización" onclick="openPagoModal(${q.id})">💰 Marcar pagado</button>`;
}

async function refreshAll() {
  const cotizacionesRaw = await sbSelectRaw('cotizaciones', 'id.desc');
  const clientesRaw = await sbSelectRaw('clientes', 'id.desc');
  // Si falló la conexión no se pisa el último caché bueno con una lista vacía:
  // el Dashboard se veía "en ceros" y el folio se reiniciaba aunque sí hubiera
  // cotizaciones.
  if (!cotizacionesRaw || !clientesRaw) {
    showToast('No se pudo conectar con el servidor — mostrando los últimos datos guardados');
  }
  if (cotizacionesRaw) window.__cotizaciones = cotizacionesRaw;
  if (clientesRaw) window.__clientesCache = clientesRaw;
  const cotizaciones = window.__cotizaciones || [];
  const clientes = window.__clientesCache || [];

  document.getElementById('dashboardDate').textContent =
    new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' }) + ' · resumen general del negocio';

  const now = new Date();
  const thisMonth = cotizaciones.filter(c => {
    const d = new Date(c.fecha);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const ingresosMes = thisMonth.filter(c => c.estatus === 'Aprobada').reduce((s,c) => s + Number(c.total), 0);
  const pendientes = cotizaciones.filter(c => c.estatus !== 'Aprobada' && c.estatus !== 'Rechazada').length;

  const stats = [
    { label: 'Ingresos del mes (aprobadas)', value: '$' + ingresosMes.toLocaleString('es-MX', {minimumFractionDigits:2}) },
    { label: 'Cotizaciones totales', value: cotizaciones.length },
    { label: 'Cotizaciones pendientes', value: pendientes },
    { label: 'Clientes registrados', value: clientes.length },
  ];
  document.getElementById('statsGrid').innerHTML = stats.map(s => `
    <div class="stat-card">
      <div class="label">${s.label}</div>
      <div class="value">${s.value}</div>
    </div>
  `).join('');

  document.getElementById('dashQuotesList').innerHTML = cotizaciones.length ? cotizaciones.map(q => `
    <div class="quote-row">
      <div>
        <div class="quote-client">${escapeHtml(q.client)}</div>
        <div class="quote-meta">${escapeHtml(q.folio)} · ${q.items.length} producto(s) · ${fmtMoney(q.total)}</div>
      </div>
      <div class="quote-row-actions">
        ${estatusSelectHtml(q)}
        ${pagoBadgeHtml(q)}
        <button class="btn-ghost-sm" title="Ver / volver a descargar" onclick="reprintQuote(${q.id})">Ver</button>
        <button class="btn-ghost-sm" title="Modificar" onclick="editQuote(${q.id})">✏️ Editar</button>
        <button class="remove-row-btn" title="Eliminar cotización" onclick="deleteQuote(${q.id})">✕</button>
      </div>
    </div>
  `).join('') : '<div class="empty-state">Aún no hay cotizaciones. Genera la primera desde el Cotizador.</div>';

  document.getElementById('dashClientsList').innerHTML = clientes.length ? clientes.slice(0, 6).map(c => `
    <div class="quote-row"><div class="quote-client">${escapeHtml(c.name)}</div></div>
  `).join('') : '<div class="empty-state">Sin clientes todavía.</div>';

  const tbody = document.getElementById('clientsTableBody');
  if (clientes.length === 0) {
    tbody.innerHTML = '';
    document.getElementById('clientsEmpty').classList.remove('hidden');
  } else {
    document.getElementById('clientsEmpty').classList.add('hidden');
    tbody.innerHTML = clientes.map(c => {
      const own = cotizaciones.filter(q => q.client.toLowerCase() === c.name.toLowerCase());
      const total = own.reduce((s,q) => s + Number(q.total), 0);
      const last = own.length ? new Date(own[0].fecha).toLocaleDateString('es-MX') : '—';
      return `<tr class="clickable-row" onclick="openClienteModal(${c.id})"><td>${escapeHtml(c.name)}</td><td>${escapeHtml(c.telefono || '—')}</td><td>${own.length}</td><td>${last}</td><td>${fmtMoney(total)}</td></tr>`;
    }).join('');
  }
}

// ======================= FICHA DE CLIENTE =======================
// Cada vez que se genera una cotización, si el cliente ya existe se completan
// los datos de contacto que falten (nunca se sobreescribe lo que ya tenía
// capturado a mano en su ficha); si no existe, se crea con lo que haya.
async function upsertClienteContacto(name, phone, email, direccion) {
  const clientes = await sbSelect('clientes');
  const existing = clientes.find(c => c.name.toLowerCase() === name.toLowerCase());
  if (!existing) {
    await sbInsert('clientes', {
      name,
      telefono: phone || null,
      email: email || null,
      direccion: direccion || null,
    });
    return;
  }
  const patch = {};
  if (!existing.telefono && phone) patch.telefono = phone;
  if (!existing.email && email) patch.email = email;
  if (!existing.direccion && direccion) patch.direccion = direccion;
  if (Object.keys(patch).length) await sbUpdate('clientes', existing.id, patch);
}

let clienteModalId = null;

function openClienteModal(id) {
  clienteModalId = id;
  const clientes = window.__clientesCache || [];
  const c = id ? clientes.find(x => x.id === id) : null;
  document.getElementById('clienteModalTitle').textContent = c ? 'Editar cliente' : 'Nuevo cliente';
  document.getElementById('clienteNombre').value = c ? c.name : '';
  document.getElementById('clienteTelefono').value = c ? (c.telefono || '') : '';
  document.getElementById('clienteEmail').value = c ? (c.email || '') : '';
  document.getElementById('clienteDireccion').value = c ? (c.direccion || '') : '';
  document.getElementById('clienteNotas').value = c ? (c.notas || '') : '';

  const cotizaciones = window.__cotizaciones || [];
  const historialEl = document.getElementById('clienteHistorial');
  if (c) {
    const own = cotizaciones.filter(q => q.client.toLowerCase() === c.name.toLowerCase());
    historialEl.innerHTML = own.length ? `
      <h3 style="font-size:13px; margin-bottom:10px;">Historial de cotizaciones (${own.length})</h3>
      <div style="max-height:220px; overflow-y:auto;">
        ${own.map(q => `
          <div class="quote-row">
            <div>
              <div class="quote-client">${escapeHtml(q.folio)}</div>
              <div class="quote-meta">${new Date(q.fecha).toLocaleDateString('es-MX')} · ${fmtMoney(q.total)} · ${q.estatus}${q.pagado ? ' · ✓ Pagado' : ''}</div>
            </div>
            <div class="quote-row-actions">
              <button class="btn-ghost-sm" onclick="reprintQuote(${q.id})">Ver</button>
            </div>
          </div>
        `).join('')}
      </div>
    ` : '<div class="empty-state">Sin cotizaciones todavía.</div>';
  } else {
    historialEl.innerHTML = '';
  }

  document.getElementById('clienteModal').classList.remove('hidden');
}

function closeClienteModal() {
  clienteModalId = null;
  document.getElementById('clienteModal').classList.add('hidden');
}

async function saveCliente() {
  await runWithButtonLock('clienteSaveBtn', saveClienteImpl);
}

async function saveClienteImpl() {
  const name = document.getElementById('clienteNombre').value.trim();
  if (!name) { showToast('Escribe el nombre del cliente'); return; }
  const patch = {
    name,
    telefono: document.getElementById('clienteTelefono').value.trim() || null,
    email: document.getElementById('clienteEmail').value.trim() || null,
    direccion: document.getElementById('clienteDireccion').value.trim() || null,
    notas: document.getElementById('clienteNotas').value.trim() || null,
  };
  let ok;
  if (clienteModalId) {
    ok = await sbUpdate('clientes', clienteModalId, patch);
  } else {
    ok = await sbInsert('clientes', patch);
  }
  if (!ok) { showToast('No se pudo guardar, revisa tu conexión'); return; }
  showToast('Cliente guardado');
  closeClienteModal();
  await refreshAll();
}

// ======================= PAGOS =======================
let pagoTargetId = null;

function openPagoModal(id) {
  const q = (window.__cotizaciones || []).find(c => c.id === id);
  if (!q) { showToast('No se encontró esa cotización'); return; }
  pagoTargetId = id;
  document.getElementById('pagoModalSub').textContent = `${q.folio} · ${q.client} · Total ${fmtMoney(q.total)}`;
  document.getElementById('pagoFecha').value = todayForDateInput();
  document.getElementById('pagoMetodo').value = '';
  document.getElementById('pagoMonto').value = Number(q.total).toFixed(2);
  document.getElementById('pagoModal').classList.remove('hidden');
}

function closePagoModal() {
  pagoTargetId = null;
  document.getElementById('pagoModal').classList.add('hidden');
}

async function confirmPago() {
  await runWithButtonLock('confirmPagoBtn', confirmPagoImpl);
}

async function confirmPagoImpl() {
  if (!pagoTargetId) return;
  const fecha_pago = document.getElementById('pagoFecha').value;
  const metodo_pago = document.getElementById('pagoMetodo').value.trim();
  const monto_pagado = parseFloat(document.getElementById('pagoMonto').value) || 0;
  if (!fecha_pago) { showToast('Elige la fecha de pago'); return; }
  const ok = await sbUpdate('cotizaciones', pagoTargetId, { pagado: true, fecha_pago, metodo_pago, monto_pagado });
  if (ok) {
    showToast('Pago registrado');
    closePagoModal();
    await refreshAll();
  } else {
    showToast('No se pudo guardar el pago, revisa tu conexión');
  }
}

// ======================= CONTABILIDAD =======================
// Ingresos = cotizaciones marcadas como pagadas (fecha_pago dentro del mes elegido).
// Egresos = tabla "gastos", capturados a mano. El IVA se calcula a partir del flag
// iva_incluido de cada registro (16%), nunca se le cobra aparte al cliente.
function fmtFechaCorta(fechaStr) {
  if (!fechaStr) return '—';
  const d = new Date(fechaStr.length <= 10 ? fechaStr + 'T00:00:00' : fechaStr);
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function enMes(fechaStr, y, m) {
  if (!fechaStr) return false;
  const d = new Date(fechaStr.length <= 10 ? fechaStr + 'T00:00:00' : fechaStr);
  return d.getFullYear() === y && d.getMonth() === (m - 1);
}

function prepareContabilidad() {
  const mesEl = document.getElementById('contaMes');
  if (!mesEl.value) {
    const now = new Date();
    mesEl.value = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  }
  document.getElementById('gastoFecha').value = todayForDateInput();
  document.getElementById('gastoConcepto').value = '';
  document.getElementById('gastoCategoria').value = '';
  document.getElementById('gastoProveedor').value = '';
  document.getElementById('gastoMonto').value = '';
  document.getElementById('gastoMetodo').value = '';
  document.getElementById('gastoIvaToggle').checked = true;
  refreshContabilidad();
}

async function refreshContabilidad() {
  const mesVal = document.getElementById('contaMes').value;
  if (!mesVal) return;
  const [y, m] = mesVal.split('-').map(Number);

  const cotizaciones = (window.__cotizaciones && window.__cotizaciones.length) ? window.__cotizaciones : await sbSelect('cotizaciones', 'id.desc');
  window.__cotizaciones = cotizaciones;
  const gastos = await sbSelect('gastos', 'fecha.desc');
  window.__gastos = gastos;

  const pagadas = cotizaciones.filter(c => c.pagado && enMes(c.fecha_pago, y, m));
  const gastosMes = gastos.filter(g => enMes(g.fecha, y, m));

  let ingresos = 0, ivaIngresos = 0;
  pagadas.forEach(c => {
    const monto = Number(c.monto_pagado != null ? c.monto_pagado : c.total) || 0;
    ingresos += monto;
    if (c.iva_incluido) ivaIngresos += monto - round2(monto / 1.16);
  });
  ingresos = round2(ingresos);
  ivaIngresos = round2(ivaIngresos);

  let egresos = 0, ivaEgresos = 0;
  gastosMes.forEach(g => {
    const monto = Number(g.monto) || 0;
    egresos += monto;
    if (g.iva_incluido) ivaEgresos += monto - round2(monto / 1.16);
  });
  egresos = round2(egresos);
  ivaEgresos = round2(ivaEgresos);

  const utilidad = round2(ingresos - egresos);
  const ivaNeto = round2(ivaIngresos - ivaEgresos);

  const stats = [
    { label: 'Ingresos del mes (pagado)', value: '$' + ingresos.toLocaleString('es-MX', { minimumFractionDigits: 2 }) },
    { label: 'Egresos del mes', value: '$' + egresos.toLocaleString('es-MX', { minimumFractionDigits: 2 }) },
    { label: 'Utilidad del mes', value: '$' + utilidad.toLocaleString('es-MX', { minimumFractionDigits: 2 }) },
    { label: 'IVA trasladado (neto)', value: '$' + ivaNeto.toLocaleString('es-MX', { minimumFractionDigits: 2 }) },
  ];
  document.getElementById('contaStatsGrid').innerHTML = stats.map(s => `
    <div class="stat-card">
      <div class="label">${s.label}</div>
      <div class="value">${s.value}</div>
    </div>
  `).join('');

  document.getElementById('contaIngresosList').innerHTML = pagadas.length ? pagadas.map(c => `
    <div class="quote-row">
      <div>
        <div class="quote-client">${escapeHtml(c.client)}</div>
        <div class="quote-meta">${escapeHtml(c.folio)} · ${fmtFechaCorta(c.fecha_pago)} · ${escapeHtml(c.metodo_pago || '—')}</div>
      </div>
      <div class="quote-row-actions">
        <strong>${fmtMoney(c.monto_pagado != null ? c.monto_pagado : c.total)}</strong>
      </div>
    </div>
  `).join('') : '<div class="empty-state">Sin cotizaciones pagadas este mes.</div>';

  document.getElementById('gastosList').innerHTML = gastosMes.length ? gastosMes.map(g => `
    <div class="quote-row">
      <div>
        <div class="quote-client">${escapeHtml(g.concepto)}</div>
        <div class="quote-meta">${fmtFechaCorta(g.fecha)} · ${escapeHtml(g.categoria || '—')}${g.proveedor ? ' · ' + g.proveedor : ''}</div>
      </div>
      <div class="quote-row-actions">
        <strong>${fmtMoney(g.monto)}</strong>
        <button class="remove-row-btn" title="Eliminar gasto" onclick="deleteGasto(${g.id})">✕</button>
      </div>
    </div>
  `).join('') : '<div class="empty-state">Sin gastos registrados este mes.</div>';
}

async function addGasto() {
  await runWithButtonLock('addGastoBtn', addGastoImpl);
}

async function addGastoImpl() {
  const fecha = document.getElementById('gastoFecha').value || todayForDateInput();
  const concepto = document.getElementById('gastoConcepto').value.trim();
  const monto = parseFloat(document.getElementById('gastoMonto').value) || 0;
  if (!concepto) { showToast('Escribe el concepto del gasto'); return; }
  if (monto <= 0) { showToast('Escribe un monto válido'); return; }
  const gasto = {
    fecha,
    concepto,
    categoria: document.getElementById('gastoCategoria').value.trim() || null,
    proveedor: document.getElementById('gastoProveedor').value.trim() || null,
    monto,
    iva_incluido: document.getElementById('gastoIvaToggle').checked,
    metodo_pago: document.getElementById('gastoMetodo').value.trim() || null,
    generado_por: currentUser.email,
  };
  const inserted = await sbInsert('gastos', gasto);
  if (!inserted) { showToast('No se pudo guardar el gasto, revisa tu conexión'); return; }
  showToast('Gasto agregado');
  document.getElementById('gastoConcepto').value = '';
  document.getElementById('gastoCategoria').value = '';
  document.getElementById('gastoProveedor').value = '';
  document.getElementById('gastoMonto').value = '';
  document.getElementById('gastoMetodo').value = '';
  document.getElementById('gastoFecha').value = todayForDateInput();
  await refreshContabilidad();
}

async function deleteGasto(id) {
  if (!confirm('¿Eliminar este gasto? Esta acción no se puede deshacer.')) return;
  const ok = await sbDelete('gastos', id);
  if (ok) { showToast('Gasto eliminado'); await refreshContabilidad(); }
  else { showToast('No se pudo eliminar, revisa tu conexión'); }
}

function exportContabilidadCsv() {
  const mesVal = document.getElementById('contaMes').value;
  if (!mesVal) { showToast('Elige un mes'); return; }
  const [y, m] = mesVal.split('-').map(Number);
  const cotizaciones = window.__cotizaciones || [];
  const gastos = window.__gastos || [];
  const pagadas = cotizaciones.filter(c => c.pagado && enMes(c.fecha_pago, y, m));
  const gastosMes = gastos.filter(g => enMes(g.fecha, y, m));

  const csvEscape = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const rows = [['Tipo', 'Fecha', 'Concepto/Cliente', 'Categoría/Método', 'Monto']];
  pagadas.forEach(c => rows.push(['Ingreso', c.fecha_pago, c.client + ' (' + c.folio + ')', c.metodo_pago || '', Number(c.monto_pagado != null ? c.monto_pagado : c.total).toFixed(2)]));
  gastosMes.forEach(g => rows.push(['Egreso', g.fecha, g.concepto, g.categoria || '', Number(g.monto).toFixed(2)]));

  const csv = rows.map(r => r.map(csvEscape).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'contabilidad-' + mesVal + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Reportes: qué se cotiza más, ingresos por mes y gastos por categoría.
// Reusa las mismas listas ya cacheadas por Contabilidad (window.__cotizaciones /
// window.__gastos) cuando existen, para no duplicar llamadas a Supabase.
async function refreshReportes() {
  const meses = parseInt(document.getElementById('reportesRango').value, 10) || 6;
  const cotizaciones = (window.__cotizaciones && window.__cotizaciones.length) ? window.__cotizaciones : await sbSelect('cotizaciones', 'id.desc');
  window.__cotizaciones = cotizaciones;
  const gastos = (window.__gastos && window.__gastos.length) ? window.__gastos : await sbSelect('gastos', 'fecha.desc');
  window.__gastos = gastos;

  const hoy = new Date();
  const mesesRango = [];
  for (let i = meses - 1; i >= 0; i--) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    mesesRango.push({ y: d.getFullYear(), m: d.getMonth() + 1, label: d.toLocaleDateString('es-MX', { month: 'short', year: '2-digit' }) });
  }

  // --- Ingresos por mes (cobrado) ---
  const ingresosPorMes = mesesRango.map(({ y, m, label }) => {
    const total = cotizaciones
      .filter(c => c.pagado && enMes(c.fecha_pago, y, m))
      .reduce((s, c) => s + Number(c.monto_pagado != null ? c.monto_pagado : c.total || 0), 0);
    return { label, total: round2(total) };
  });
  const maxIngreso = Math.max(1, ...ingresosPorMes.map(x => x.total));
  document.getElementById('reportesIngresosChart').innerHTML = ingresosPorMes.map(x => `
    <div class="bar-row">
      <div class="bar-row-top"><span class="bar-label">${x.label}</span><span class="bar-value">$${x.total.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${(x.total / maxIngreso * 100).toFixed(1)}%"></div></div>
    </div>
  `).join('') || '<div class="empty-state">Sin datos todavía.</div>';

  // --- Gastos por categoría (dentro del rango de meses elegido) ---
  const inicioRango = new Date(mesesRango[0].y, mesesRango[0].m - 1, 1);
  const gastosRango = gastos.filter(g => new Date(g.fecha) >= inicioRango);
  const porCategoria = {};
  gastosRango.forEach(g => {
    const cat = g.categoria && g.categoria.trim() ? g.categoria.trim() : 'Sin categoría';
    porCategoria[cat] = (porCategoria[cat] || 0) + (Number(g.monto) || 0);
  });
  const categorias = Object.entries(porCategoria).map(([cat, total]) => ({ cat, total: round2(total) })).sort((a, b) => b.total - a.total);
  const maxGasto = Math.max(1, ...categorias.map(x => x.total));
  document.getElementById('reportesGastosChart').innerHTML = categorias.length ? categorias.map(x => `
    <div class="bar-row">
      <div class="bar-row-top"><span class="bar-label">${x.cat}</span><span class="bar-value">$${x.total.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${(x.total / maxGasto * 100).toFixed(1)}%"></div></div>
    </div>
  `).join('') : '<div class="empty-state">Sin gastos registrados en este rango.</div>';

  // --- Productos más cotizados (todas las cotizaciones no rechazadas, del rango elegido) ---
  const cotsRango = cotizaciones.filter(c => c.estatus !== 'Rechazada' && new Date(c.fecha) >= inicioRango);
  const porProducto = {};
  cotsRango.forEach(c => {
    (Array.isArray(c.items) ? c.items : []).forEach(it => {
      const nombre = it.name || 'Sin nombre';
      const importe = Number(it.importe) || 0;
      const cantidad = it.cajas != null ? Number(it.cajas) : Number(it.qty) || 0;
      if (!porProducto[nombre]) porProducto[nombre] = { cantidad: 0, importe: 0 };
      porProducto[nombre].cantidad += cantidad;
      porProducto[nombre].importe += importe;
    });
  });
  const topProductos = Object.entries(porProducto)
    .map(([name, v]) => ({ name, cantidad: v.cantidad, importe: round2(v.importe) }))
    .sort((a, b) => b.importe - a.importe)
    .slice(0, 15);
  const maxImporte = Math.max(1, ...topProductos.map(x => x.importe));
  document.getElementById('reportesTopProductos').innerHTML = topProductos.length ? topProductos.map(x => `
    <div class="bar-row">
      <div class="bar-row-top"><span class="bar-label">${x.name} <span style="color:var(--text-secondary);">(${x.cantidad})</span></span><span class="bar-value">$${x.importe.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${(x.importe / maxImporte * 100).toFixed(1)}%"></div></div>
    </div>
  `).join('') : '<div class="empty-state">Todavía no hay cotizaciones en este rango.</div>';
}

function showResetPasswordBox() {
  document.getElementById('app').classList.add('hidden');
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('loginFormCard').classList.add('hidden');
  document.getElementById('forgotBox').classList.add('hidden');
  document.getElementById('resetPasswordBox').classList.remove('hidden');
}

(async function init() {
  // Cuando alguien llega desde el enlace de "restablecer contraseña" del correo,
  // Supabase mete un token de recuperación en el hash de la URL y crea una sesión
  // temporal solo para eso — nunca debe entrar directo a la app con ese token.
  const isRecovery = window.location.hash.includes('type=recovery');
  const { data } = await supabaseClient.auth.getSession();
  if (isRecovery) {
    showResetPasswordBox();
  } else if (data.session) {
    currentAccessToken = data.session.access_token;
    currentUser = { email: data.session.user.email };
    showApp();
    await refreshAll();
  }
  supabaseClient.auth.onAuthStateChange((event, session) => {
    currentAccessToken = session ? session.access_token : null;
    if (event === 'PASSWORD_RECOVERY') showResetPasswordBox();
  });
})();
