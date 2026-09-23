  if (window['pdfjsLib']) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }
let currentUser = null;
let productRowCount = 0;
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

function sbHeaders(extra) {
  return Object.assign({
    apikey: SUPABASE_ANON_KEY,
    Authorization: 'Bearer ' + (currentAccessToken || SUPABASE_ANON_KEY),
  }, extra || {});
}

async function sbSelect(table, order) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*${order ? '&order=' + order : ''}`, {
      headers: sbHeaders(),
    });
    if (!res.ok) throw new Error('select failed');
    return await res.json();
  } catch (e) {
    console.error('Supabase select error', e);
    return [];
  }
}

async function sbInsert(table, row) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
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
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
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
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
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

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 2500);
}

let signupMode = false;
function toggleSignupMode() {
  signupMode = !signupMode;
  document.getElementById('authTitle').textContent = signupMode ? 'Crear cuenta' : 'Iniciar sesión';
  document.getElementById('authSub').textContent = signupMode
    ? 'Solo para los correos autorizados de Spazio Luce'
    : 'Acceso al sistema de gestión · Spazio Luce';
  document.getElementById('authSubmitBtn').textContent = signupMode ? 'Crear cuenta' : 'Entrar';
  document.getElementById('toggleSignupBtn').textContent = signupMode
    ? '¿Ya tienes cuenta? Inicia sesión'
    : '¿Primera vez? Crear tu cuenta';
  document.getElementById('loginError').classList.add('hidden');
  document.getElementById('loginError').style.color = '';
}
async function handleAuthSubmit() {
  if (signupMode) await handleSignup();
  else await handleLogin();
}

function showApp() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('currentUserLabel').textContent = currentUser.email;
}

async function handleLogin() {
  const email = document.getElementById('loginUser').value.trim();
  const pass = document.getElementById('loginPass').value;
  const errBox = document.getElementById('loginError');
  errBox.classList.add('hidden');
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password: pass });
  if (error || !data.session) {
    errBox.textContent = 'Correo o contraseña incorrectos.';
    errBox.classList.remove('hidden');
    return;
  }
  currentAccessToken = data.session.access_token;
  currentUser = { email: data.user.email };
  showApp();
  await refreshAll();
}

async function handleSignup() {
  const email = document.getElementById('loginUser').value.trim();
  const pass = document.getElementById('loginPass').value;
  const errBox = document.getElementById('loginError');
  errBox.classList.add('hidden');
  if (!email || pass.length < 6) {
    errBox.textContent = 'Escribe tu correo y una contraseña de al menos 6 caracteres.';
    errBox.classList.remove('hidden');
    return;
  }
  const { data, error } = await supabaseClient.auth.signUp({ email, password: pass });
  if (error) {
    errBox.textContent = error.message;
    errBox.classList.remove('hidden');
    return;
  }
  if (data.session) {
    currentAccessToken = data.session.access_token;
    currentUser = { email: data.user.email };
    showApp();
    await refreshAll();
  } else {
    errBox.classList.remove('hidden');
    errBox.style.color = 'var(--green)';
    errBox.textContent = 'Cuenta creada. Revisa tu correo para confirmarla y luego inicia sesión.';
  }
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

// Catálogo real de Spazio Luce, cargado 2026-09-14 de 3 listas de precios reales:
// "Catálogo Tekno-Step" (deck/muros/pisos/madera, precios YA con IVA), "Lista de
// Precios Candiles y Armazones" (precio final por pieza), y "Lista de Precios
// Iluminación LED x150" (precios SIN IVA 16% — así vienen en la fuente; si se
// quiere que hablen el mismo idioma que los demás, hay que sumarles el 16%).
// Cortinas y Persianas queda igual — el usuario va a mandar esa lista actualizada
// después.
const CATALOG = {
  "Iluminación · Paneles LED": [
    { name: "Panel Slim de 3W Redondo", price: 35.33, lab: 21.76 },
    { name: "Panel Slim de 6W Redondo", price: 41.97, lab: 25.84 },
    { name: "Panel Slim de 9W Redondo", price: 59.64, lab: 36.72 },
    { name: "Panel Slim de 12W Redondo", price: 68.46, lab: 42.16 },
    { name: "Panel Slim de 18W Redondo", price: 90.55, lab: 55.76 },
    { name: "Panel Slim de 24W Redondo", price: 161.23, lab: 99.28 },
    { name: "Panel Slim de 6W Cuadrado", price: 53.01, lab: 32.64 },
    { name: "Panel Slim de 9W Cuadrado", price: 68.46, lab: 42.16 },
    { name: "Panel Slim de 12W Cuadrado", price: 75.10, lab: 46.24 },
    { name: "Panel Slim de 18W Cuadrado", price: 101.59, lab: 62.56 },
    { name: "Panel Slim de 24W Cuadrado", price: 174.49, lab: 107.44 },
    { name: "Panel Slim Satinado 4W Redondo 6500K", price: 64.06, lab: 39.44 },
    { name: "Panel Slim Satinado 6W Redondo 6500K", price: 72.88, lab: 44.88 },
    { name: "Panel Slim Satinado 9W Redondo 6500K", price: 90.55, lab: 55.76 },
    { name: "Panel Slim Satinado 12W Redondo 6500K", price: 101.59, lab: 62.56 },
    { name: "Panel Slim Satinado 15W Redondo 6500K", price: 114.85, lab: 70.72 },
    { name: "Panel Slim Satinado 4W Cuadrado 6500K", price: 68.46, lab: 42.16 },
    { name: "Panel Slim Satinado 6W Cuadrado 6500K", price: 83.93, lab: 51.68 },
    { name: "Panel Slim Satinado 9W Cuadrado 6500K", price: 97.18, lab: 59.84 },
    { name: "Panel Slim Satinado 12W Cuadrado 6500K", price: 110.43, lab: 68.00 },
    { name: "Panel Slim Satinado 15W Cuadrado 6500K", price: 123.68, lab: 76.16 },
    { name: "Panel Slim Dorado 4W Redondo 6500K", price: 64.06, lab: 39.44 },
    { name: "Panel Slim Dorado 6W Redondo 6500K", price: 75.10, lab: 46.24 },
    { name: "Panel Slim Dorado 9W Redondo 6500K", price: 88.35, lab: 54.40 },
    { name: "Panel Slim Dorado 12W Redondo 6500K", price: 101.59, lab: 62.56 },
    { name: "Panel Slim Dorado 15W Redondo 6500K", price: 114.85, lab: 70.72 },
    { name: "Panel Slim Dorado 4W Cuadrado 6500K", price: 68.46, lab: 42.16 },
    { name: "Panel Slim Dorado 6W Cuadrado 6500K", price: 77.30, lab: 47.60 },
    { name: "Panel Slim Dorado 9W Cuadrado 6500K", price: 94.97, lab: 58.48 },
    { name: "Panel Slim Dorado 12W Cuadrado 6500K", price: 106.01, lab: 65.28 },
    { name: "Panel Slim Dorado 15W Cuadrado 6500K", price: 121.48, lab: 74.80 },
    { name: "Panel Sobreponer FAT 6W Redondo", price: 53.01, lab: 32.64 },
    { name: "Panel Sobreponer FAT 12W Redondo", price: 75.10, lab: 46.24 },
    { name: "Panel Sobreponer FAT 18W Redondo", price: 97.18, lab: 59.84 },
    { name: "Panel Sobreponer FAT 24W Redondo", price: 156.81, lab: 96.56 },
    { name: "Panel Sobreponer FAT 6W Cuadrado", price: 57.42, lab: 35.36 },
    { name: "Panel Sobreponer FAT 12W Cuadrado", price: 86.14, lab: 53.04 },
    { name: "Panel Sobreponer FAT 18W Cuadrado", price: 110.43, lab: 68.00 },
    { name: "Panel Sobreponer FAT 24W Cuadrado", price: 172.27, lab: 106.08 },
    { name: "Panel Sobreponer 6W Redondo Tres Colores", price: 86.14, lab: 53.04 },
    { name: "Panel Sobreponer 12W Redondo Tres Colores", price: 136.94, lab: 84.32 },
    { name: "Panel Sobreponer 18W Redondo Tres Colores", price: 183.31, lab: 112.88 },
    { name: "Panel Sobreponer 24W Redondo Tres Colores", price: 265.04, lab: 163.20 },
    { name: "Panel Sobreponer 6W Cuadrado Tres Colores", price: 81.72, lab: 50.32 },
    { name: "Panel Sobreponer 12W Cuadrado Tres Colores", price: 121.48, lab: 74.80 },
    { name: "Panel Sobreponer 18W Cuadrado Tres Colores", price: 161.23, lab: 99.28 },
    { name: "Panel Sobreponer 24W Cuadrado Tres Colores", price: 240.75, lab: 148.24 },
    { name: "Panel NT-P600600 48W", price: 430.68, lab: 265.20 },
    { name: "Panel NT-P3001200 48W", price: 499.15, lab: 307.36 },
    { name: "Panel NT-P6001200 96W", price: 1269.97, lab: 782.00 },
    { name: "Panel 600600 Tres Colores 48W", price: 633.88, lab: 390.32 },
    { name: "Panel Slim 600600 48W", price: 731.06, lab: 450.16 },
    { name: "Aspirina Sobreponer 18W 6500K/3000K", price: 70.68, lab: 43.52 },
    { name: "Aspirina Sobreponer 24W 6500K/3000K", price: 108.23, lab: 66.64 },
    { name: "Aspirina Sobreponer 32W 6500K/3000K", price: 145.77, lab: 89.76 },
    { name: "Aspirina Ajustable 18W 6500K/3000K", price: 64.06, lab: 39.44 },
    { name: "Aspirina Ajustable 24W 6500K/3000K", price: 92.77, lab: 57.12 },
    { name: "Aspirina Ajustable 32W 6500K/3000K", price: 141.36, lab: 87.04 },
    { name: "Ajustable Redondo 12W 6500K/3000K", price: 64.06, lab: 39.44 },
    { name: "Ajustable Redondo 18W 6500K/3000K", price: 92.77, lab: 57.12 },
    { name: "Ajustable Redondo 24W 6500K/3000K", price: 128.10, lab: 78.88 },
  ],
  "Iluminación · Tiras, Neón y COB": [
    { name: "Neón Eco 12V 5M (8 colores)", price: 103.81, lab: 63.92 },
    { name: "Neón Pro 12V 5M (8 colores)", price: 203.20, lab: 125.12 },
    { name: "Neón 5M RGB 12V", price: 406.39, lab: 250.24 },
    { name: "COB 12V 5M (7 colores)", price: 249.57, lab: 153.68 },
    { name: "COB 24V 10M (8 colores)", price: 329.09, lab: 202.64 },
    { name: "Manguera 4040 127V 50M (6 colores)", price: 1523.96, lab: 938.40 },
    { name: "Pixel 5050 10MTS 24V", price: 1433.41, lab: 882.64 },
    { name: "Neón 360 Pixel 10MT 24V", price: 2009.86, lab: 1237.60 },
    { name: "Manguera Neón Pixel 24V 10MTS", price: 1473.17, lab: 907.12 },
    { name: "COB Eco 50M 127V (Blanco/Cálido)", price: 2665.83, lab: 1641.52 },
    { name: "COB Pro 50M 127V (Blanco/Cálido)", price: 3301.92, lab: 2033.20 },
    { name: "LED Strip 2835 50M 127V", price: 1943.60, lab: 1196.80 },
    { name: "LED Strip Conexión Directa 2835 127V 120D 8mm 50M", price: 1981.15, lab: 1219.92 },
    { name: "LED Strip Neón 2835 127V 50M", price: 2513.43, lab: 1547.68 },
    { name: "Manguera Doble Línea 127V 2835 50M", price: 3288.67, lab: 2025.04 },
    { name: "Neón 50MTS RGB 3535 127V", price: 3149.52, lab: 1939.36 },
    { name: "5050 127V RGB 50M", price: 4600.59, lab: 2832.88 },
    { name: "Manguera Cuadrada 127V 12x12 Blanco Cálido", price: 4306.85, lab: 2652.00 },
    { name: "Víbora Flexible Rollo 100mts", price: 3489.65, lab: 2148.80 },
    { name: "Manguera 10mts 24V 2835 Interior", price: 187.73, lab: 115.60 },
  ],
  "Iluminación · Fuentes y Reflectores": [
    { name: "Fuente Slim Interior 12V 100W", price: 258.41, lab: 159.12 },
    { name: "Fuente Slim Interior 12V 300W", price: 481.48, lab: 296.48 },
    { name: "Fuente Slim Interior 12V 400W", price: 583.09, lab: 359.04 },
    { name: "Fuente Slim Interior 24V 100W", price: 258.41, lab: 159.12 },
    { name: "Fuente Slim Interior 24V 300W", price: 384.31, lab: 236.64 },
    { name: "Fuente Universal 12-24V 60W", price: 216.44, lab: 133.28 },
    { name: "Fuente Universal 12-24V 100W", price: 267.24, lab: 164.56 },
    { name: "Fuente Universal 12-24V 200W", price: 315.83, lab: 194.48 },
    { name: "Fuente Universal 12-24V 300W", price: 368.85, lab: 227.12 },
    { name: "Fuente Universal 12-24V 400W", price: 419.64, lab: 258.40 },
    { name: "Reflector Cobra 100W", price: 801.73, lab: 493.68 },
    { name: "Reflector Cobra 150W", price: 1051.31, lab: 647.36 },
    { name: "Reflector Cobra 200W", price: 1378.20, lab: 848.64 },
    { name: "Reflector Cobra 250W", price: 1727.16, lab: 1063.52 },
    { name: "Reflector Cobra 300W", price: 2102.63, lab: 1294.72 },
    { name: "Reflector NT-TG128 10W", price: 79.51, lab: 48.96 },
    { name: "Reflector NT-TG128 20W", price: 114.85, lab: 70.72 },
    { name: "Reflector NT-TG128 30W", price: 159.02, lab: 97.92 },
    { name: "Reflector NT-TG128 50W", price: 231.91, lab: 142.80 },
    { name: "Reflector NT-TG128 100W", price: 435.10, lab: 267.92 },
    { name: "Reflector NT-TG128 150W", price: 600.75, lab: 369.92 },
    { name: "Reflector NT-TG128 200W", price: 852.53, lab: 524.96 },
    { name: "Reflector NT-TG128 300W", price: 1177.20, lab: 724.88 },
    { name: "Reflector NT-TG128 400W", price: 1409.11, lab: 867.68 },
    { name: "Reflector RGB 50W", price: 468.23, lab: 288.32 },
    { name: "Reflector RGB 100W", price: 722.23, lab: 444.72 },
    { name: "UFO .7 100W", price: 437.31, lab: 269.28 },
    { name: "UFO .7 150W", price: 574.25, lab: 353.60 },
    { name: "UFO .7 200W", price: 777.44, lab: 478.72 },
    { name: "UFO .7 300W", price: 1190.46, lab: 733.04 },
    { name: "UFO .9 100W", price: 523.45, lab: 322.32 },
    { name: "UFO .9 150W", price: 706.76, lab: 435.20 },
    { name: "UFO .9 200W", price: 943.09, lab: 580.72 },
    { name: "Reflector Alta Potencia 50W", price: 1075.61, lab: 662.32 },
    { name: "Reflector Alta Potencia 100W", price: 1943.60, lab: 1196.80 },
    { name: "Reflector Alta Potencia 150W", price: 2539.94, lab: 1564.00 },
    { name: "Reflector Alta Potencia 200W", price: 3257.74, lab: 2006.00 },
    { name: "Reflector Alta Potencia 250W", price: 4136.78, lab: 2547.28 },
    { name: "Reflector Alta Potencia 300W", price: 4980.48, lab: 3066.80 },
    { name: "Reflector Alta Potencia 400W", price: 6500.03, lab: 4002.48 },
    { name: "Reflector Alta Potencia 500W", price: 8070.38, lab: 4969.44 },
    { name: "Reflector Alta Potencia 600W", price: 9499.36, lab: 5849.36 },
  ],
  "Iluminación · Solares": [
    { name: "Suburbana Solar Doble Cara 50W", price: 448.35, lab: 276.08 },
    { name: "Suburbana Solar Doble Cara 100W", price: 784.07, lab: 482.80 },
    { name: "Suburbana Solar Doble Cara 200W", price: 1002.73, lab: 617.44 },
    { name: "Reflector Solar Doble Cara 200W", price: 1269.97, lab: 782.00 },
    { name: "Reflector Solar Doble Cara 300W", price: 1440.04, lab: 886.72 },
    { name: "Reflector Solar 6 Módulos 100W", price: 1426.78, lab: 878.56 },
    { name: "Reflector Solar 6 Módulos 200W", price: 2001.02, lab: 1232.16 },
    { name: "Reflector Solar 6 Módulos 300W", price: 2502.39, lab: 1540.88 },
    { name: "Suburbana Solar Panel Independiente 100W", price: 2252.81, lab: 1387.20 },
    { name: "Suburbana Solar Panel Independiente 200W", price: 2628.28, lab: 1618.40 },
    { name: "Suburbana Solar Panel Independiente 300W", price: 4130.16, lab: 2543.20 },
    { name: "Suburbana Solar Panel Integrado 200W", price: 1552.67, lab: 956.08 },
    { name: "Suburbana Solar Panel Integrado 300W", price: 2054.04, lab: 1264.80 },
  ],
  "Iluminación · Focos y Accesorios": [
    { name: "Foco Bala 10W", price: 17.67, lab: 10.88 },
    { name: "Foco Bala 20W", price: 40.19, lab: 24.75 },
    { name: "Foco Bala 30W", price: 58.53, lab: 36.04 },
    { name: "Foco Bala 40W", price: 85.03, lab: 52.36 },
    { name: "Foco Bala 50W", price: 106.01, lab: 65.28 },
    { name: "Foco Xaomi 10W", price: 28.71, lab: 17.68 },
    { name: "Foco Xaomi 20W", price: 44.17, lab: 27.20 },
    { name: "Tubo LED T8 18W Cristal (Transparente/Opalino)", price: 50.80, lab: 31.28 },
    { name: "Barra Flat Cristalina 36W 1.20", price: 139.14, lab: 85.68 },
    { name: "Barra Flat Cristalina 54W 1.20", price: 187.73, lab: 115.60 },
    { name: "Barra Flat Cristalina 72W 1.20", price: 238.53, lab: 146.88 },
    { name: "Regletra Tubo Plástico T8 1.2M", price: 99.39, lab: 61.20 },
    { name: "Control Manguera Pixel 5050-360°", price: 192.15, lab: 118.32 },
    { name: "Conector 8mm Forma I", price: 8.61, lab: 5.30 },
    { name: "Conector 8mm Forma L", price: 17.01, lab: 10.47 },
    { name: "Conector 8mm Forma C", price: 19.44, lab: 11.97 },
    { name: "Conector 8mm Forma T", price: 37.55, lab: 23.12 },
    { name: "Eliminador 12V 3A", price: 97.18, lab: 59.84 },
    { name: "Plug 6mm/7mm", price: 48.59, lab: 29.92 },
    { name: "Plug COB (incluye accesorios)", price: 70.68, lab: 43.52 },
    { name: "Pin H para tira de 6mm", price: 11.04, lab: 6.80 },
    { name: "Pin H para tira de 7mm", price: 11.04, lab: 6.80 },
    { name: "Pin H para tira de 9mm", price: 11.04, lab: 6.80 },
    { name: "Pin H para tira RGB", price: 19.88, lab: 12.24 },
    { name: "Conector Hembra", price: 19.88, lab: 12.24 },
    { name: "Conector Hembra Cable", price: 15.46, lab: 9.52 },
  ],
  "Candiles · Níquel": [
    { name: "Candil Romano (Níquel, 12 luces, Ø70cm)", price: 23901.00 },
    { name: "Candil Versalles Níquel 6 Luces (Ø60cm)", price: 12729.00 },
    { name: "Candil Versalles Níquel 8 Luces (Ø60cm)", price: 16705.00 },
    { name: "Candil Tubular Níquel (5 luces, Ø70cm)", price: 7320.00 },
    { name: "Lámpara Auris Especial Níquel (5 luces, Ø55cm)", price: 9116.00 },
    { name: "Plafón Circular 2 Luces Níquel (Ø20cm)", price: 4178.00 },
    { name: "Plafón 3 Cuadros Níquel (Ø25cm)", price: 8270.00 },
    { name: "Plafón 3 Círculos Níquel (Ø33cm)", price: 8967.00 },
    { name: "Plafón Cascada Níquel (3+2+1 luces, Ø30cm)", price: 19138.00 },
    { name: "Plafón Cuadro Níquel Strass (1 luz)", price: 2756.00 },
    { name: "Plafón Oval Níquel (3 luces)", price: 4292.00 },
    { name: "Plafón Brazo con Cuadro Níquel (3 luces)", price: 4209.00 },
    { name: "Lámpara de Mesa Cuadro Níquel (Swarovski Spectra, 30cm)", price: 2756.00 },
    { name: "Lámpara de Mesa Cuadro Níquel (Swarovski Strass, 30cm)", price: 3104.00 },
    { name: "Lámpara de Mesa Rectangular (Strass, 2 luces, 25x18cm)", price: 4972.00 },
    { name: "Candil B.2 (Níquel, 5 luces, económico)", price: 19439.00 },
  ],
  "Candiles · Swarovski": [
    { name: "Candil B.2 (Oro 24k, Swarovski Strass, 5 luces)", price: 48598.00 },
    { name: "Candil Europa (Oro 24k y Níquel, Strass, 6 luces, Ø80cm)", price: 19810.00 },
    { name: "Candil Imperial 9 Luces (Oro 24k, Spectra, Ø48cm)", price: 19446.00 },
    { name: "Candil Imperial 12 Luces (Oro 24k, Spectra, Ø75cm)", price: 42128.00 },
    { name: "Arbotante Imperial (Oro 24k, Spectra, 2 luces)", price: 5510.00 },
    { name: "Candil Italiano (Oro 24k, Spectra, 6 luces, Ø50cm)", price: 19588.00 },
    { name: "Arbotante Italiano (Oro 24k, Spectra, 2 luces)", price: 6321.00 },
    { name: "Candil Carrusel (Oro 24k, 4 luces, Ø35cm)", price: 17110.00 },
    { name: "Plafón Cerius 6 Luces (Oro 24k, Spectra, Ø38cm)", price: 16730.00 },
    { name: "Plafón Cerius 12 Luces (Oro 24k, 48x78cm)", price: 33225.00 },
    { name: "Plafón Perla Ø25cm (Oro 24k, Spectra, 3 luces)", price: 6780.00 },
    { name: "Plafón Perla Ø30cm (Oro 24k, Spectra, 3 luces)", price: 8661.00 },
    { name: "Plafón Corazones (Oro 24k, Spectra, 10 luces, Ø60cm)", price: 21390.00 },
    { name: "Plafón Doble Arillo Reina (Oro 24k, 6 luces, Ø62cm)", price: 24766.00 },
    { name: "Plafón Canasta (Oro 24k, Spectra, 3 luces, Ø40cm)", price: 6125.00 },
    { name: "Arbotante Canasta (Oro 24k, 2 luces, Ø35cm)", price: 4134.00 },
    { name: "Candil Flores (Oro 24k, Spectra, 4 luces, Ø40cm)", price: 10440.00 },
    { name: "Arbotante Flores (Oro 24k, Spectra, 1 luz)", price: 2320.00 },
    { name: "Plafón Hoja (Pavonado, Spectra, 3 luces, 30cm)", price: 8763.00 },
    { name: "Plafón Rectangular (Oro 24k, Spectra, 6 luces, 90x30cm)", price: 23179.00 },
    { name: "Lámpara de Mesa Corona Rombo (Oro 24k, Spectra, Ø11cm)", price: 4350.00 },
    { name: "Lámpara de Mesa Señorial (Oro 24k, Spectra, 8 luces, Ø30cm)", price: 17530.00 },
  ],
  "Candiles · Alabastro y Austriaco Scholler": [
    { name: "Candil Medal (Alabastro rústico, 6+2 luces, pieza única)", price: 35951.88 },
    { name: "Plafón Alabastro Rústico (pieza única)", price: 27245.00 },
    { name: "Plafón Güero (Alabastro clásico, pieza única)", price: 21431.58 },
    { name: "Plafón Cuadro Níquel Contemporáneo (Alabastro blanco)", price: 31636.69 },
    { name: "Arbotante Alabastro Beige (pieza única)", price: 2586.00 },
    { name: "Arbotante Alabastro Blanco Pirámide (pieza única)", price: 2086.00 },
    { name: "Arbotante Alabastro Blanco (pieza única)", price: 2585.64 },
    { name: "Plafón Níquel Alabastro Contemporáneo (2 luces)", price: 15080.58 },
    { name: "Candil Versalles Scholler (Oro 24k, 10+5 luces, Ø80cm)", price: 29014.00 },
    { name: "Arbotante Versalles Scholler 1 Luz (Ø30cm)", price: 2397.00 },
    { name: "Arbotante Versalles Scholler 2 Luces (Ø30cm)", price: 3612.00 },
    { name: "Candil Lord Scholler 6 Luces (Ø90cm)", price: 12930.00 },
    { name: "Candil Lord Scholler 6+3 Luces (Ø90cm)", price: 17908.00 },
    { name: "Candil Cuadro Scholler (Oro 24k, 6 luces, Ø60cm)", price: 14268.00 },
    { name: "Candil Corsega Scholler (Oro 24k, 6 luces, Ø60cm)", price: 12261.00 },
    { name: "Arbotante Corsega Scholler (Oro 24k, 3 luces, Ø30cm)", price: 4295.00 },
    { name: "Candil Galery Scholler (Oro 24k, 8 luces, Ø90cm)", price: 26274.00 },
    { name: "Candil B.2 (Oro 24k, Scholler, 5 luces, económico)", price: 19439.00 },
    { name: "Candil Lord Dorado Scholler (Oro 24k, 8 luces)", price: 15766.00 },
  ],
  "Candiles · Cristal Italiano": [
    { name: "Candil Ma. Teresa Hoja c/Canopé (6 luces, Ø65cm)", price: 6300.00 },
    { name: "Candil Ma. Teresa Hoja 8/L c/Canopé (Ø60cm)", price: 7860.00 },
    { name: "Candil Ma. Teresa Hoja 8/L", price: 7070.00 },
    { name: "Candil Ma. Teresa Hoja 10/L", price: 9282.00 },
    { name: "Candil Ma. Teresa Hoja 12/L (Ø75cm)", price: 10677.00 },
    { name: "Candil Ma. Teresa Hoja 10+5/L", price: 13914.00 },
    { name: "Candil Primavera 3/L (Ø40cm)", price: 3504.20 },
    { name: "Candil Primavera 4/L (Ø45cm)", price: 4153.00 },
    { name: "Candil Primavera 6/L (Ø50cm)", price: 5689.00 },
    { name: "Candil Primavera 8/L", price: 6355.00 },
    { name: "Candil Primavera 12/L", price: 9598.00 },
    { name: "Candil Primavera 12+6/L (Ø75cm)", price: 14934.00 },
    { name: "Arbotante Primavera 1/L", price: 1587.00 },
    { name: "Arbotante Primavera 2/L", price: 2007.00 },
    { name: "Candil Auris Hoja 10/L (Ø70cm)", price: 7929.00 },
    { name: "Plafón Estrella Tramo 30cm 3/L", price: 3526.00 },
    { name: "Plafón Estrella Tramo 40cm 6/L", price: 5164.00 },
    { name: "Candil Rombo 62cm 7/L (Ø70cm)", price: 6854.00 },
    { name: "Candil Marqueza 6/L (Ø60cm)", price: 8963.00 },
    { name: "Candil Marqueza 8/L (Ø70cm)", price: 12027.00 },
    { name: "Plafón Marqueza Oval 6/L (60x40cm)", price: 8963.00 },
    { name: "Plafón Marqueza Guitarra 4/L (Ø40cm)", price: 5341.00 },
    { name: "Candil Versalles 6 Luces (Ø62x45cm)", price: 11868.00 },
    { name: "Candil Versalles 16 Luces (Ø1.04m)", price: 38479.00 },
    { name: "Candil Piña de Óvalos 8 Luces (Ø60cm)", price: 6231.52 },
    { name: "Candil Princesa 36cm 6/L", price: 7446.00 },
    { name: "Plafón Doble Arillo Tramo 16'' 3/L", price: 5608.00 },
    { name: "Plafón Doble Arillo Tramo 18'' 6/L", price: 6302.00 },
    { name: "Plafón Piña Tramo 8'' 2/L", price: 1760.00 },
    { name: "Plafón Piña Tramo 12'' 3/L", price: 3320.00 },
    { name: "Plafón Piña Tramo 14'' 3/L", price: 4081.00 },
    { name: "Plafón Piña Tramo 16'' 6/L", price: 4895.00 },
    { name: "Plafón Piña Tramo 18'' 6/L", price: 5503.00 },
    { name: "Plafón Piña Tramo 23'' 8/L", price: 7196.00 },
    { name: "Plafón Palma Tramo 35cm 4/L", price: 4160.00 },
    { name: "Plafón Palma Tramo 40cm 3/L", price: 5164.00 },
    { name: "Plafón Duquesa Tramo Doble Arillo 12/L", price: 6607.00 },
    { name: "Plafón Especial Ø27cm 3 luces", price: 2527.00 },
    { name: "Plafón Especial Ø33cm 3 luces", price: 3083.00 },
    { name: "Plafón Especial Ø38cm 3 luces", price: 3820.00 },
    { name: "Plafón Especial Ø44cm 4 luces", price: 4734.00 },
    { name: "Candil Bronce 8/L (Ø70cm)", price: 15189.04 },
    { name: "Candil Bronce 12/L", price: 22593.00 },
    { name: "Candil Artiaga (5+5 luces, Ø70cm)", price: 32291.00 },
  ],
  "Deck y Muro Exterior WPC": [
    { name: "Deck Comercial WPC Teak/IPE (caja 1.276 m²)", coverage: 1.276, priceM2: 1584.06, priceBox: 1837.51, labM2: 869.00, labBox: 1108.84 },
    { name: "Deck Residencial WPC (Light Gray/Teak/Maple/Wenge, caja 1.276 m²)", coverage: 1.276, priceM2: 1330.69, priceBox: 1543.60, labM2: 730.00, labBox: 931.48 },
    { name: "Tornillo Acero Inoxidable Deck", price: 4.98, lab: 3.00 },
    { name: "Tornillo Negro Deck", price: 4.98, lab: 3.00 },
    { name: "Clip Acero Deck", price: 11.60, lab: 7.00 },
    { name: "Clip Plástico Deck", price: 4.98, lab: 3.00 },
    { name: "Clip Inicio Deck", price: 11.60, lab: 7.00 },
    { name: "WPC Lambrín Exterior (5 colores, caja 2.28 m²)", coverage: 2.28, priceM2: 2198.57, priceBox: 2550.34, labM2: 675.00, labBox: 1539.00 },
    { name: "Ángulo Muro Exterior WPC (5 colores)", price: 477.26, lab: 288.00 },
    { name: "Wall Cladding (Hickory/Tasmania Oak/Merbau Oak, caja 4.019 m²)", coverage: 4.019, priceM2: 2440.11, priceBox: 2830.53, labM2: 425.00, labBox: 1708.08 },
    { name: "Ángulo Wall Cladding", price: 59.66, lab: 36.00 },
    { name: "Perfil Plano Wall Cladding", price: 18.22, lab: 11.00 },
    { name: "Viga Exterior Teak (ml)", price: 339.72, lab: 205.00 },
    { name: "Tapa Viga Exterior Teak", price: 53.02, lab: 32.00 },
    { name: "Viga Interior 100x50 (Bahía/São Paulo/Brasilia/Rio, ml)", price: 111.02, lab: 67.00 },
    { name: "Viga Interior 50x50 (Bahía/São Paulo/Brasilia/Rio, ml)", price: 67.94, lab: 41.00 },
    { name: "Soporte Giratorio Viga (set 4 pzas)", price: 74.58, lab: 45.00 },
  ],
  "Muro Interior y Placas PVC/PU": [
    { name: "WPC Muro Interior Serie Clásica (8 colores, caja 6.496 m²)", coverage: 6.496, priceM2: 1716.80, priceBox: 1991.49, labM2: 185.00, labBox: 1201.76 },
    { name: "WPC Muro Interior Serie Nueva (6 colores, caja 6.496 m²)", coverage: 6.496, priceM2: 1809.60, priceBox: 2099.14, labM2: 195.00, labBox: 1266.72 },
    { name: "Ángulo Interior WPC (12 colores)", price: 94.46, lab: 57.00 },
    { name: "Clip-M WPC Muro Interior", price: 2.16, lab: 1.30 },
    { name: "Rocca PU Piedra (Black/Gray, 0.72 m²/pza)", price: 298.28, lab: 180.00, m2PerPza: 0.72 },
    { name: "Réplica PU Tronco Oak Virginia (1.44 m²/pza)", price: 2266.98, lab: 1368.00, m2PerPza: 1.44 },
    { name: "Réplica PU Piedra Oak Cascade (1.44 m²/pza)", price: 1479.50, lab: 892.80, m2PerPza: 1.44 },
    { name: "PVC Texturizada Madera (7 tonos, 2.977 m²/pza)", price: 2067.05, lab: 1247.36, m2PerPza: 2.977 },
    { name: "PVC Madera Digital (5 tonos, 2.977 m²/pza)", price: 2067.05, lab: 1247.36, m2PerPza: 2.977 },
    { name: "PVC Mármol Digital (6 tonos, 2.977 m²/pza)", price: 1869.72, lab: 1128.28, m2PerPza: 2.977 },
    { name: "PVC Mármol Digital 2 (5 tonos, 2.977 m²/pza)", price: 1869.72, lab: 1128.28, m2PerPza: 2.977 },
    { name: "PVC Piedra Digital (5 tonos, 2.977 m²/pza)", price: 2363.05, lab: 1425.98, m2PerPza: 2.977 },
    { name: "PVC Espejo / Metal / Espejo Dorado (2.977 m²/pza)", price: 2762.66, lab: 1667.12, m2PerPza: 2.977 },
    { name: "PVC Tapiz Acanalado (4 modelos, 1.80 m²/pza)", price: 522.00, lab: 315.00, m2PerPza: 1.80 },
    { name: "PVC Tapiz Glossy (10 modelos, 2.88 m²/pza)", price: 954.52, lab: 576.00, m2PerPza: 2.88 },
    { name: "PVC Tapiz Matte (7 modelos, 2.88 m²/pza)", price: 1193.14, lab: 720.00, m2PerPza: 2.88 },
    { name: "PVC Tapiz Espejo Agua/Metal (2.88 m²/pza)", price: 1551.08, lab: 936.00, m2PerPza: 2.88 },
    { name: "PVC Tapiz Espejo Dorado (2.88 m²/pza)", price: 1670.40, lab: 1008.00, m2PerPza: 2.88 },
    { name: "Revestimiento Flexible (6 modelos, 0.54 m²/pza)", price: 275.62, lab: 166.32, m2PerPza: 0.54 },
    { name: "Panel PVC Interior (5 modelos, 0.84 m²/pza)", price: 77.95, lab: 47.04, m2PerPza: 0.84 },
    { name: "Panel PVC Laminado Madera (3 modelos, 0.84 m²/pza)", price: 96.05, lab: 57.96, m2PerPza: 0.84 },
    { name: "Panel 3D Blanco (14 diseños, 0.25 m²/pza)", price: 51.38, lab: 31.00, m2PerPza: 0.25 },
    { name: "Panel 3D Negro (5 diseños, 0.25 m²/pza)", price: 57.18, lab: 34.50, m2PerPza: 0.25 },
    { name: "Panel 3D Gris (6 diseños, 0.25 m²/pza)", price: 59.24, lab: 35.75, m2PerPza: 0.25 },
    { name: "Panel 3D Oro (6 diseños, 0.25 m²/pza)", price: 102.32, lab: 61.75, m2PerPza: 0.25 },
    { name: "Panel 3D Tipo Madera (4 diseños, 0.25 m²/pza)", price: 70.42, lab: 42.50, m2PerPza: 0.25 },
    { name: "Panel Metálico Autoadherible (6 modelos, por caja)", price: 488.86, lab: 295.00 },
    { name: "Panel Vinílico 3D Azulejo (24 diseños, 0.093 m²/pza)", price: 25.59, lab: 15.44, m2PerPza: 0.093 },
    { name: "Panel XPC 3D (19 diseños, 0.09 m²/pza)", price: 13.57, lab: 8.19, m2PerPza: 0.09 },
    { name: "Ángulos y Perfiles Aluminio (negro/plateado)", price: 91.14, lab: 55.00 },
  ],
  "Pisos Laminados y Vinílicos": [
    { name: "Piso Laminado Magnus Res. al Agua (5 colores, caja 3.155 m²)", coverage: 3.155, priceM2: 1316.09, priceBox: 1526.66, labM2: 292.00, labBox: 921.26 },
    { name: "Piso Laminado Splash Res. al Agua (4 colores, caja 2.402 m²)", coverage: 2.402, priceM2: 758.34, priceBox: 879.67, labM2: 221.00, labBox: 530.84 },
    { name: "Piso Laminado Shades Vintage (4 colores, caja 2.669 m²)", coverage: 2.669, priceM2: 686.31, priceBox: 796.12, labM2: 180.00, labBox: 480.42 },
    { name: "Piso Laminado Aspen Vintage (4 colores, caja 1.979 m²)", coverage: 1.979, priceM2: 548.47, priceBox: 636.23, labM2: 194.00, labBox: 383.93 },
    { name: "Piso Laminado Heritage Vintage (5 colores, caja 1.759 m²)", coverage: 1.759, priceM2: 726.21, priceBox: 842.40, labM2: 289.00, labBox: 508.35 },
    { name: "Piso Laminado Evoke Select (3 colores, caja 2.362 m²)", coverage: 2.362, priceM2: 671.49, priceBox: 778.93, labM2: 199.00, labBox: 470.04 },
    { name: "Piso Laminado Teruel Select (Alcañiz/Calanda/Utrillas/Ternasco/Gudar, caja 1.929 m²)", coverage: 1.929, priceM2: 479.50, priceBox: 556.22, labM2: 174.00, labBox: 335.65 },
    { name: "Piso Laminado Mirage Select (2 colores, caja 2.246 m²)", coverage: 2.246, priceM2: 1013.91, priceBox: 1176.14, labM2: 316.00, labBox: 709.74 },
    { name: "Piso Laminado Diamond Select Clásico (3 colores, caja 2.669 m²)", coverage: 2.669, priceM2: 606.24, priceBox: 703.24, labM2: 159.00, labBox: 424.37 },
    { name: "Piso Laminado Country Limited Clásico (4 colores, caja 2.669 m²)", coverage: 2.669, priceM2: 598.61, priceBox: 694.39, labM2: 157.00, labBox: 419.03 },
    { name: "Piso Laminado Prof. Series 1 (4 colores, caja 2.669 m²)", coverage: 2.669, priceM2: 602.43, priceBox: 698.82, labM2: 158.00, labBox: 421.70 },
    { name: "Piso Laminado Prof. Series 2 (2 colores, caja 2.669 m²)", coverage: 2.669, priceM2: 587.19, priceBox: 681.14, labM2: 154.00, labBox: 411.03 },
    { name: "Piso Laminado Prof. Series 3 (7 colores, caja 2.669 m²)", coverage: 2.669, priceM2: 617.69, priceBox: 716.52, labM2: 162.00, labBox: 432.38 },
    { name: "Piso Vinílico Herringbone SPC (Caramel/Moka, caja 1.875 m²)", coverage: 1.875, priceM2: 934.83, priceBox: 1084.40, labM2: 349.00, labBox: 654.38 },
    { name: "Piso Vinílico Forest SPC (6 colores, caja 2.462 m²)", coverage: 2.462, priceM2: 1209.90, priceBox: 1403.48, labM2: 344.00, labBox: 846.93 },
    { name: "Piso Vinílico Concrete SPC (2 colores, caja 2.256 m²)", coverage: 2.256, priceM2: 1057.10, priceBox: 1226.24, labM2: 328.00, labBox: 739.97 },
    { name: "Piso Vinílico Max SPC (6 colores, caja 2.225 m²)", coverage: 2.225, priceM2: 950.39, priceBox: 1102.45, labM2: 299.00, labBox: 665.27 },
    { name: "Piso Vinílico Futura SPC (6 colores, caja 2.782 m²)", coverage: 2.782, priceM2: 989.60, priceBox: 1147.94, labM2: 249.00, labBox: 692.72 },
    { name: "Piso Vinílico Australia WPC+LVT (5 colores, caja 2.60 m²)", coverage: 2.60, priceM2: 1556.29, priceBox: 1805.30, labM2: 419.00, labBox: 1089.40 },
    { name: "Piso Vinílico Woodstock LVT (12 modelos, caja 3.32 m²)", coverage: 3.32, priceM2: 991.26, priceBox: 1149.86, labM2: 209.00, labBox: 693.88 },
    { name: "Piso Vinílico Woodstock2 LVT (6 modelos, caja 3.32 m²)", coverage: 3.32, priceM2: 991.26, priceBox: 1149.86, labM2: 209.00, labBox: 693.88 },
    { name: "Piso Vinílico Woodlane LVT (6 modelos, caja 4.89 m²)", coverage: 4.89, priceM2: 1250.44, priceBox: 1450.51, labM2: 179.00, labBox: 875.31 },
    { name: "Piso Vinílico Urbana LVT (7 modelos, caja 4.894 m²)", coverage: 4.894, priceM2: 1041.73, priceBox: 1208.41, labM2: 149.00, labBox: 729.21 },
  ],
  "Madera de Ingeniería y Zoclos": [
    { name: "Madera Ingeniería Utopía (5 colores, caja 2.888 m²)", coverage: 2.888, priceM2: 2888.00, priceBox: 3350.08, labM2: 700.00, labBox: 2021.60 },
    { name: "Madera Ingeniería True Toro American Walnut (caja 2.888 m²)", coverage: 2.888, priceM2: 4971.49, priceBox: 5766.93, labM2: 1205.00, labBox: 3480.04 },
    { name: "Madera Ingeniería True Toro Brushed (caja 2.904 m²)", coverage: 2.904, priceM2: 6256.04, priceBox: 7257.01, labM2: 1508.00, labBox: 4379.23 },
    { name: "Madera Ingeniería Les Terres European Oak (7 colores, caja 2.888 m²)", coverage: 2.888, priceM2: 3799.79, priceBox: 4407.76, labM2: 921.00, labBox: 2659.85 },
    { name: "Madera Ingeniería Vitare (4 colores, caja 3.024 m²)", coverage: 3.024, priceM2: 3507.84, priceBox: 4069.09, labM2: 812.00, labBox: 2455.49 },
    { name: "Madera Ingeniería Loft Life (6 colores, caja 2.743 m²)", coverage: 2.743, priceM2: 1857.40, priceBox: 2154.58, labM2: 474.00, labBox: 1300.18 },
    { name: "Madera Ingeniería Loft Mate (4 colores, caja 2.743 m²)", coverage: 2.743, priceM2: 1767.27, priceBox: 2050.03, labM2: 451.00, labBox: 1237.09 },
    { name: "Bambú Horizontal Oscuro (caja 2.212 m²)", coverage: 2.212, priceM2: 2240.44, priceBox: 2598.91, labM2: 709.00, labBox: 1568.31 },
    { name: "Zoclo Laminado Paloma 4.5cm", price: 31.48, lab: 19.00 },
    { name: "Zoclo Laminado Plano 6cm", price: 36.46, lab: 22.00 },
    { name: "Perfil Laminado de Expansión", price: 69.60, lab: 42.00 },
    { name: "Perfil Laminado de Adaptación", price: 69.60, lab: 42.00 },
    { name: "Nariz de Escalón Laminada 6cm", price: 92.80, lab: 56.00 },
    { name: "Cuarto Bocel PVC 16mm", price: 76.22, lab: 46.00 },
    { name: "Zoclo Plano PVC 14mm", price: 97.78, lab: 59.00 },
    { name: "Perfil de Adaptación PVC 10mm", price: 80.38, lab: 48.50 },
    { name: "Perfil de Expansión PVC 7mm", price: 80.38, lab: 48.50 },
    { name: "Nariz de Escalón PVC 18mm", price: 130.92, lab: 79.00 },
    { name: "Bajo Suelo Polietileno Laminado 1/16\" (m²)", price: 9.94, lab: 6.00 },
    { name: "Bajo Suelo Acústico Tekno-Sound Supreme 2mm (m²)", price: 31.48, lab: 19.00 },
    { name: "Sellador 100% Silicón (Botella)", price: 130.92, lab: 79.00 },
    { name: "Adhesivo de Montaje (Botella)", price: 174.00, lab: 105.00 },
    { name: "Adhesivo Base Látex para Piso PVC (3.78 lt)", price: 661.20, lab: 399.00 },
    { name: "Adhesivo Base Solvente para Piso Bamboo (20 Kg)", price: 3393.82, lab: 2048.00 },
  ],
  "Follaje Sintético y Pasto": [
    { name: "Follaje Sintético Arrayanes (6 colores, caja 3 m²)", coverage: 3, priceM2: 1791.43, priceBox: 2078.06, labM2: 418.00, labBox: 1254.00 },
    { name: "Follaje Sintético Ciudades (5 colores, caja 3 m²)", coverage: 3, priceM2: 1894.29, priceBox: 2197.38, labM2: 442.00, labBox: 1326.00 },
    { name: "Follaje Premium (varios modelos, caja 3 m²)", coverage: 3, priceM2: 2627.14, priceBox: 3047.48, labM2: 613.00, labBox: 1839.00 },
    { name: "Follaje Expandible (Medellín/Bogotá/Barranquilla, 1.07x0.37)", price: 1126.86, lab: 680.00 },
    { name: "Pasto Deportivo Mono 40mm (varios colores, rollo)", price: 260.18, lab: 157.00 },
    { name: "Pasto Deportivo Mono 12mm (varios colores, rollo)", price: 386.12, lab: 233.00 },
    { name: "Pasto Deportivo Fibrilado 20mm (rollo)", price: 235.32, lab: 142.00 },
    { name: "Pasto Deportivo Fibrilado 30mm (rollo)", price: 238.62, lab: 144.00 },
    { name: "Pasto Deportivo Fibrilado 40mm (rollo)", price: 243.60, lab: 147.00 },
    { name: "Pasto Recreativo Bali/Cancún/Bermuda (rollo)", price: 212.12, lab: 128.00 },
    { name: "Pasto Recreativo Summer/Aca/Aruba (rollo)", price: 180.62, lab: 109.00 },
    { name: "Malla Sombra (4m²/bolsa)", price: 122.62, lab: 74.00 },
    { name: "Cinchos (bolsa 100 pzas)", price: 112.68, lab: 68.00 },
  ],
  "Cortinas y Persianas": [
    { name: "Motor Elatio 60 1 Lienzo", price: 12250.99 },
    { name: "Motor Elatio 60 2 Lienzos", price: 12505.84 },
    { name: "Motor Elatio 60 Ondulado 1 Lienzo", price: 16716.18 },
    { name: "Motor Elatio 60 Ondulado 2 Lienzos", price: 16842.85 },
    { name: "Control Pure 1 Monocanal (Elatio)", price: 1530.62 },
    { name: "Control Pure 5 Multicanal (Elatio)", price: 3062.75 },
    { name: "Inteo Estación Central (Elatio)", price: 4561.7 },
    { name: "Motor Glydea 60 1 Lienzo", price: 28710.81 },
    { name: "Motor Glydea 60 2 Lienzos", price: 28965.66 },
    { name: "Motor Glydea 60 Ondulado 1 Lienzo", price: 34706.62 },
    { name: "Motor Glydea 60 Ondulado 2 Lienzos", price: 35217.83 },
    { name: "Control Pure 1 Monocanal (Glydea)", price: 1530.62 },
    { name: "Control Pure 5 Multicanal (Glydea)", price: 3062.75 },
    { name: "Inteo Estación Central (Glydea)", price: 4561.7 },
    { name: "Motor Huna 35 1 Lienzo", price: 9802.0 },
    { name: "Motor Huna 35 2 Lienzos", price: 10179.0 },
    { name: "Motor Huna 35 Ondulado 1 Lienzo", price: 15607.8 },
    { name: "Motor Huna 35 Ondulado 2 Lienzos", price: 15834.0 },
    { name: "Control Huna 1 Monocanal (cortina)", price: 754.0 },
    { name: "Control Huna 5 Multicanal (cortina)", price: 1508.0 },
    { name: "Motor LSN 40 1 Lienzo (persiana)", price: 9443.1 },
    { name: "Motor LSN 40 2 Lienzos (persiana)", price: 11228.57 },
    { name: "Motor LT50 1 Lienzo (persiana)", price: 16716.18 },
    { name: "Motor LT50 2 Lienzos (persiana)", price: 19522.57 },
    { name: "Control Pure 1 Monocanal (persiana)", price: 1530.62 },
    { name: "Control Pure 5 Multicanal (persiana)", price: 3062.75 },
    { name: "Inteo Estación Central RTL (Alexa/Google)", price: 4561.7 },
    { name: "Motor Persiana Huna 40 1 Lienzo", price: 3317.6 },
    { name: "Motor Persiana Huna 40 2 Lienzos", price: 4524.0 },
    { name: "Motor Persiana Huna 50 1 Lienzo", price: 4071.6 },
    { name: "Motor Persiana Huna 50 2 Lienzos", price: 5278.0 },
    { name: "Control Huna 1 Multicanal (persiana)", price: 754.0 },
    { name: "Control Huna 5 Multicanal (persiana)", price: 1508.0 },
    // Persiana enrollable a medida: se cotiza por m² real de la ventana
    // (ancho x alto), no a precio fijo por pieza — antes esto no servía para
    // cotizar una medida real de cliente. 4 telas/nivel (2026-09-22):
    { name: "Persiana Enrollable — Tela Duo Basic", pricePerM2: 379, areaBased: true },
    { name: "Persiana Enrollable — Tela Good Line", pricePerM2: 449, areaBased: true },
    { name: "Persiana Enrollable — Tela Celebrity", pricePerM2: 449, areaBased: true },
    { name: "Persiana Enrollable — Tela Night", pricePerM2: 539, areaBased: true },
    { name: "Cort. Sencillo 20F111 Hélice 91-183cm Negro", price: 506.69 },
    { name: "Cort. Sencillo 20F111 Hélice 120-210cm Negro", price: 556.45 },
    { name: "Cort. Sencillo 20F111 Hélice 183-336cm Negro", price: 680.11 },
    { name: "Cort. Doble 20F118 Cerrojo 91-183cm Negro", price: 755.51 },
    { name: "Cort. Doble 20F118 Cerrojo 120-210cm Negro", price: 838.45 },
    { name: "Cort. Doble 20F118 Cerrojo 183-336cm Negro", price: 1020.92 },
    { name: "Cort. Sencillo 20F157 Bola 91-183cm Plata", price: 506.69 },
    { name: "Cort. Sencillo 20F157 Bola 120-210cm Plata", price: 556.45 },
    { name: "Cort. Sencillo 20F157 Bola 183-336cm Plata", price: 680.11 },
    { name: "Cort. Doble 20F201 Clásico 91-183cm Negro", price: 755.51 },
    { name: "Cort. Doble 20F201 Clásico 120-210cm Negro", price: 838.45 },
    { name: "Cort. Doble 20F201 Clásico 183-336cm Negro", price: 1020.92 },
    { name: "Cort. Doble 20F240 Manija 91-183cm Plata", price: 755.51 },
    { name: "Cort. Doble 20F240 Manija 120-210cm Plata", price: 838.45 },
    { name: "Cort. Doble 20F240 Manija 183-336cm Plata", price: 1020.92 },
    { name: "Cort. Sencillo 20F248 Enjambre 91-183cm Plata", price: 506.69 },
    { name: "Cort. Sencillo 20F248 Enjambre 120-210cm Plata", price: 556.45 },
    { name: "Cort. Sencillo 20F248 Enjambre 183-336cm Plata", price: 680.11 },
    { name: "Cort. Sencillo 20F260 Cuadros 91-183cm Negro", price: 506.69 },
    { name: "Cort. Sencillo 20F260 Cuadros 120-210cm Negro", price: 556.45 },
    { name: "Cort. Sencillo 20F260 Cuadros 183-336cm Negro", price: 680.11 },
    { name: "Cordón para cortinero (pza)", price: 331.76 },
    { name: "Bracket Doble a Muro (bolsa 5)", price: 413.19 },
    { name: "Bracket Sencillo a Muro (bolsa 5)", price: 119.13 },
    { name: "Bracket a Techo (bolsa 5)", price: 96.51 },
    { name: "Carro 1 Hoja", price: 60.32 },
    { name: "Carro 2 Hojas (juego)", price: 108.58 },
    { name: "Correderas (bolsa 60)", price: 461.45 },
    { name: "Portapoleas (juego)", price: 111.59 },
    { name: "Riel de Aluminio (5.80m)", price: 971.15 },
    { name: "Tensor para Cortinero (juego min. 5)", price: 66.35 },
    { name: "Unión para cortinero", price: 43.73 },
    { name: "Bastón de Aluminio (1.20m)", price: 331.76 },
    { name: "Bastón de Aluminio (2.00m)", price: 696.7 },
    { name: "Esquinero Curvo (juego)", price: 46.75 },
    { name: "Tope Final (bolsa 5)", price: 46.75 },
    { name: "Carro Sistema Ondulado (juego)", price: 82.94 },
    { name: "Cinta 30mm (mts)", price: 93.5 },
    { name: "Corredera Sencilla (mts)", price: 165.88 },
    { name: "Tope Sencillo (ondulado)", price: 93.5 },
    { name: "Cortinero de Cordón Bracket Doble a Muro (ml)", price: 1020.92 },
    { name: "Cortinero de Cordón Bracket a Muro (ml)", price: 805.27 },
    { name: "Cortinero de Cordón Bracket a Techo (ml)", price: 788.68 },
    { name: "Cortinero Manual Bracket Doble a Muro (ml)", price: 921.39 },
    { name: "Cortinero Manual Bracket a Muro (ml)", price: 696.7 },
    { name: "Cortinero Manual Bracket a Techo (ml)", price: 680.11 },
    { name: "Cortinero Ondulado Bracket Doble a Muro (ml)", price: 1111.4 },
    { name: "Cortinero Ondulado Bracket a Muro (ml)", price: 895.75 },
    { name: "Cortinero Ondulado Bracket a Techo (ml)", price: 871.62 },
    { name: "Cordón (kg)", price: 331.76 },
    { name: "Ganchos Alfiler (millar)", price: 348.35 },
    { name: "Rollo con 50 metros de Tarlatana", price: 265.41 },
  ],
};
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
      priceLabel = fmtMoney(effectiveAreaPrice(p)) + '/m² · se corta a la medida exacta';
    } else {
      const eff = effectiveSimplePrice(p);
      priceLabel = eff ? fmtMoney(eff) + (p.m2PerPza ? '/pza · cubre ' + p.m2PerPza + ' m²' : '') : 'sin precio';
    }
    if (noLab) priceLabel += ' (sin LAB)';
    return `
    <div class="catalog-item">
      <div><span class="name">${p.name}</span><span class="price">${priceLabel}</span></div>
      <button onclick='addFromCatalog(${JSON.stringify(p)})'>+ Agregar</button>
    </div>
  `;
  }).join('') : '<div class="catalog-empty">Sin resultados en esta categoría.</div>';
}
function addFromCatalog(item) {
  if (item.coverage) {
    const cov = effectiveCoveragePrices(item);
    addCoverageRow(Object.assign({ dept: activeCatalogTab }, item, cov));
  } else if (item.areaBased) {
    addAreaRow(Object.assign({ dept: activeCatalogTab }, item, { pricePerM2: effectiveAreaPrice(item) }));
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
  wrap.dataset.dept = item.dept || '';
  wrap.innerHTML = `
    <div class="product-row" style="grid-template-columns: 2fr .9fr .9fr 1fr auto; margin-bottom:6px;">
      <input class="p-name" value="${item.name}" disabled />
      <input placeholder="Ancho (m)" type="number" min="0" step="0.01" class="p-ancho" oninput="recalcTotals()" />
      <input placeholder="Alto (m)" type="number" min="0" step="0.01" class="p-alto" oninput="recalcTotals()" />
      <input placeholder="$0.00" class="p-import" disabled />
      <button class="remove-row-btn" onclick="document.getElementById('${id}').remove(); recalcTotals();">✕</button>
    </div>
    <div class="coverage-info" style="font-size:11px;color:var(--text-secondary);padding-left:2px;">
      ${fmtMoney(item.pricePerM2)}/m² · da el ancho y alto exactos de la ventana
    </div>
  `;
  document.getElementById('productRows').appendChild(wrap);
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

// Agrega una fila ya interpretada (de Excel o PDF) a la cotización actual.
function addImportedRow(item) {
  addProductRow({
    name: item.name,
    qty: item.qty,
    price: item.price,
    section: item.section || '',
    unit: item.unit || '',
  });
}

// Abreviaturas de unidad reales que puede traer un PDF antes de la cantidad
// (ej. "... PZA 3 $150.50"). Antes se adivinaba por longitud de palabra (<=4
// letras), lo que se comía nombres cortos de producto ("Test", "LED") como si
// fueran unidad. Con lista fija solo se separa cuando de verdad es una unidad.
const KNOWN_UNITS = ['pza', 'pzas', 'pz', 'ml', 'm2', 'm²', 'kg', 'hr', 'hrs', 'lote', 'lte', 'jgo', 'par', 'serv', 'un', 'und', 'glb', 'caja', 'cajas', 'rollo', 'mt', 'mts', 'sal'];

// Encabezado de sección dentro de un PDF/Word: antes solo se reconocía si la línea
// estaba TODO EN MAYÚSCULAS, pero la mayoría de los presupuestos reales usan
// Título Con Mayúsculas Iniciales (ej. "Herrería", "Plomería", "Cocina Integral") y
// esas nunca se detectaban. Ahora acepta ambos estilos.
function looksLikeSectionHeader(lineText) {
  const t = lineText.trim();
  if (t.length < 3 || t.length > 40) return false;
  if (/\d/.test(t)) return false;
  if (/[.,;:$]/.test(t)) return false;
  const words = t.split(/\s+/);
  if (words.length > 5) return false;
  const isAllCaps = t === t.toUpperCase() && t !== t.toLowerCase();
  const isTitleCase = words.every(w => /^[A-ZÁÉÍÓÚÑ]/.test(w));
  return isAllCaps || isTitleCase;
}

// Busca folio, fecha y nota dentro del texto completo de un documento importado
// (PDF o Word). Es "mejor esfuerzo": si no encuentra algo, se deja vacío para que
// se escriba a mano — nunca bloquea la importación.
function extractDocMeta(fullText) {
  const meta = {};
  const folioMatch = fullText.match(/Folio:?\s*(\S+)/i);
  if (folioMatch) meta.folio = folioMatch[1];

  const fechaMatch = fullText.match(/Fecha:?\s*(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/i);
  if (fechaMatch) {
    let [, d, m, y] = fechaMatch;
    if (y.length === 2) y = '20' + y;
    meta.fecha = y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }

  const notaMatch = fullText.match(/NOTA:\s*(.+?)(?:\n|\s{2,}[A-ZÁÉÍÓÚÑ]{4,}|SUBTOTAL|$)/i);
  if (notaMatch) meta.nota = notaMatch[1].trim().slice(0, 300);

  // Para que "subir archivo -> generar" funcione con un solo clic, se detecta
  // también el cliente y el proyecto si el documento ya trae esos campos
  // etiquetados (formato típico de un presupuesto Spazio Luce: CLIENTE / OBRA /
  // DIRECCIÓN-PROYECTO / FECHA en la parte de arriba).
  const clienteMatch = fullText.match(/CLIENTE:?\s+(.+)/i);
  if (clienteMatch) meta.cliente = clienteMatch[1].trim().slice(0, 150);

  const proyectoMatch = fullText.match(/(?:DIRECCIÓN\s*\/\s*PROYECTO|PROYECTO|DIRECCION\s*\/\s*PROYECTO):?\s+(.+)/i);
  if (proyectoMatch) meta.proyecto = proyectoMatch[1].trim().slice(0, 200);

  return meta;
}

// Lee un PDF (cotización o lista de precios) e intenta reconstruir sus renglones.
// Es "mejor esfuerzo": reconstruye texto por posición (x,y) de cada página y usa
// patrones típicos de una tabla de precios (Concepto ... Cant ... $Precio ... $Importe,
// o Producto ... $Precio). Como los PDFs no tienen columnas reales, siempre puede
// haber errores — por eso las filas quedan editables antes de generar la cotización.
async function handlePdfImport(file, event) {
  if (!window.pdfjsLib) { showToast('No se pudo cargar el lector de PDF'); return; }
  try {
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    let imported = 0;
    let currentSection = '';

    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();

      // Agrupa los fragmentos de texto en renglones por posición Y (con tolerancia).
      const items = content.items.map(it => ({
        text: it.str,
        x: it.transform[4],
        y: Math.round(it.transform[5] / 3) * 3,
      })).filter(it => it.text.trim());

      const rowsByY = {};
      items.forEach(it => {
        if (!rowsByY[it.y]) rowsByY[it.y] = [];
        rowsByY[it.y].push(it);
      });

      const sortedYs = Object.keys(rowsByY).map(Number).sort((a, b) => b - a);
      sortedYs.forEach(y => {
        const rowItems = rowsByY[y].sort((a, b) => a.x - b.x);
        const lineText = rowItems.map(r => r.text).join(' ').replace(/\s+/g, ' ').trim();
        if (!lineText) return;

        // Detecta encabezados de sección (mayúsculas o Título Con Mayúsculas).
        if (looksLikeSectionHeader(lineText)) {
          currentSection = lineText;
          return;
        }

        // Busca 1 o 2 montos en dólares al final del renglón: P.U. e Importe (o solo Importe/Precio).
        const moneyMatches = [...lineText.matchAll(/\$\s*([\d,]+\.\d{2})/g)];
        if (moneyMatches.length === 0) return;

        const amounts = moneyMatches.map(m => parseFloat(m[1].replace(/,/g, '')));
        const firstMoneyIdx = lineText.indexOf(moneyMatches[0][0]);
        let before = lineText.slice(0, firstMoneyIdx).trim();

        // Intenta separar "Concepto ... UN CANT" del texto antes del precio.
        let unit = '', qty = 1;
        const unitQtyMatch = before.match(/(\S+)\s+(\d+(?:\.\d+)?)\s*$/);
        if (unitQtyMatch && KNOWN_UNITS.includes(unitQtyMatch[1].toLowerCase().replace(/\./g, ''))) {
          unit = unitQtyMatch[1];
          qty = parseFloat(unitQtyMatch[2]);
          before = before.slice(0, unitQtyMatch.index).trim();
        } else {
          const qtyOnlyMatch = before.match(/(\d+(?:\.\d+)?)\s*$/);
          if (qtyOnlyMatch) {
            qty = parseFloat(qtyOnlyMatch[1]);
            before = before.slice(0, qtyOnlyMatch.index).trim();
          }
        }

        const name = before.replace(/^\d+\s+/, '').trim();
        if (!name || name.length < 3) return;

        // Si hay 2 montos, el primero es P.U. y el segundo es el Importe total de la fila.
        const price = amounts[0];

        addImportedRow({ name, qty, price, unit, section: currentSection });
        imported++;
      });
    }

    showToast(imported > 0 ? `${imported} renglón(es) importados del PDF — revísalos antes de generar` : 'No se detectaron renglones con precio en el PDF');
  } catch (err) {
    console.error('Error al leer el PDF', err);
    showToast('No se pudo leer el PDF. Intenta con el Excel del mismo documento.');
  }
  event.target.value = '';
}

function handleExcelImport(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

      const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

      let imported = 0;
      rows.forEach(row => {
        let name = '', qty = '', price = '', section = '', unit = '';
        Object.keys(row).forEach(key => {
          const k = norm(key);
          if (k.includes('concepto') || k.includes('producto') || k.includes('nombre') || k.includes('descripcion')) name = row[key];
          else if (k.includes('cant')) qty = row[key];
          else if (k.includes('precio') || k === 'p.u.' || k.includes('p.u')) price = row[key];
          else if (k.includes('seccion') || k.includes('categoria') || k.includes('partida')) section = row[key];
          else if (k === 'un' || k.includes('unidad')) unit = row[key];
        });
        name = String(name || '').trim();
        if (!name) return;
        const qtyNum = parseFloat(qty) || 1;
        const priceNum = parseFloat(String(price).replace(/[^0-9.]/g, '')) || 0;
        addProductRow({ name, qty: qtyNum, price: priceNum, section: String(section || '').trim(), unit: String(unit || '').trim() });
        imported++;
      });

      showToast(imported > 0 ? `${imported} concepto(s) importados del Excel` : 'No se encontraron filas válidas en el archivo');
    } catch (err) {
      console.error('Error al leer el Excel', err);
      showToast('No se pudo leer el archivo. Revisa el formato.');
    }
    event.target.value = '';
  };
  reader.readAsArrayBuffer(file);
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
    <input placeholder="Nombre del producto" class="p-name" value="${prefill ? prefill.name : ''}" oninput="recalcTotals()" />
    <input placeholder="1" type="number" min="0" class="p-qty" value="${prefill ? prefill.qty : 1}" oninput="recalcTotals()" />
    <input placeholder="0.00" type="number" min="0" class="p-price" value="${prefill ? prefill.price : ''}" oninput="recalcTotals()" />
    <input placeholder="$0.00" class="p-import" disabled />
    <button class="remove-row-btn" onclick="document.getElementById('${id}').remove(); recalcTotals();">✕</button>
  `;
  document.getElementById('productRows').appendChild(wrap);
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
    <div class="product-row" style="grid-template-columns: 2fr .9fr .9fr .9fr 1fr auto; margin-bottom:6px;">
      <input class="p-name" value="${item.name}" disabled />
      <input placeholder="Largo (m)" type="number" min="0" step="0.01" class="p-largo" oninput="onLargoAnchoChange('${id}')" />
      <input placeholder="Ancho (m)" type="number" min="0" step="0.01" class="p-ancho" oninput="onLargoAnchoChange('${id}')" />
      <input placeholder="Cajas" type="number" min="0" step="1" class="p-cajas" oninput="recalcTotals()" />
      <input placeholder="$0.00" class="p-import" disabled />
      <button class="remove-row-btn" onclick="document.getElementById('${id}').remove(); recalcTotals();">✕</button>
    </div>
    <div class="coverage-info" style="font-size:11px;color:var(--text-secondary);padding-left:2px;">
      Cada caja cubre ${item.coverage} m² · ${fmtMoney(item.priceBox)}/caja · captura largo y ancho para calcular solo, o escribe las cajas directamente
    </div>
  `;
  document.getElementById('productRows').appendChild(wrap);
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
    const m2 = ancho * alto;
    const importe = round2(m2 * pricePerM2);
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
  renderCatalogItems();
  const cotizaciones = await sbSelect('cotizaciones');
  document.getElementById('quoteFolio').value = nextFolioNumber(cotizaciones);
  recalcTotals();
}

async function generateQuote() {
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
      rows.push({ name, largo, ancho, m2: Number(m2.toFixed(2)), cajas, priceBox, importe: cajas * priceBox, dept: row.dataset.dept || null });
    }
  });

  document.querySelectorAll('#productRows > .product-row').forEach(row => {
    const name = row.querySelector('.p-name').value.trim();
    const qty = parseFloat(row.querySelector('.p-qty').value) || 0;
    const price = parseFloat(row.querySelector('.p-price').value) || 0;
    if (name) rows.push({ name, qty, price, importe: qty * price, dept: row.dataset.dept || null, section: row.dataset.section || '', unit: row.dataset.unit || '' });
  });

  document.querySelectorAll('.product-row-area').forEach(row => {
    const name = row.querySelector('.p-name').value.trim();
    const ancho = parseFloat(row.querySelector('.p-ancho').value) || 0;
    const alto = parseFloat(row.querySelector('.p-alto').value) || 0;
    const pricePerM2 = parseFloat(row.dataset.pricePerM2) || 0;
    const m2 = round2(ancho * alto);
    if (name && m2 > 0) {
      rows.push({ name, ancho, alto, m2, pricePerM2, importe: round2(m2 * pricePerM2), dept: row.dataset.dept || null });
    }
  });

  if (rows.length === 0) { showToast('Agrega al menos un producto'); return; }
  const totals = recalcTotals();
  const folio = document.getElementById('quoteFolio').value;

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
    estatus: 'Enviada',
    iva_incluido: ivaOn,
    generado_por: currentUser.email,
  };
  let inserted = await sbInsert('cotizaciones', quote);
  if (!inserted && quote.note) {
    // La columna "note" puede no existir todavía en Supabase; reintenta sin ella
    // para no bloquear el guardado (la nota de todos modos sale impresa en el PDF).
    const { note, ...quoteSinNota } = quote;
    inserted = await sbInsert('cotizaciones', quoteSinNota);
  }
  if (!inserted) { showToast('No se pudo guardar la cotización, revisa tu conexión'); return; }

  await upsertClienteContacto(client, quote.phone, quote.email, quote.address);

  showToast('Cotización ' + folio + ' generada y guardada');
  await refreshAll();
  document.getElementById('quoteFolio').value = nextFolioNumber(window.__cotizaciones || []);
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
    const subLabel = isCoverage ? `${it.largo}m × ${it.ancho}m = ${it.m2} m²` : isArea ? `${it.ancho}m × ${it.alto}m` : '';
    return `<tr>
      <td>
        <span class="item-name">${it.name}</span>
        ${subLabel ? `<span class="item-sub">${subLabel}</span>` : ''}
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
          Folio: ${quote.folio}
        </div>
      </div>
    </div>
    <div class="recibo-divider"></div>

    <div class="recibo-info">
      <div>
        <div><b>Cliente:</b> ${quote.client}</div>
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
      <span>${quote.email || 'spazioluce09@gmail.com'}</span>
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
        <td>${it.name}</td>
        <td style="width:50px;">${it.unit || '—'}</td>
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
          Folio: ${quote.folio}
        </div>
      </div>
    </div>
    <div class="recibo-divider"></div>

    <div class="recibo-info">
      <div>
        <div><b>Proyecto:</b> ${quote.address || '—'}</div>
        <div><b>Cliente:</b> ${quote.client}</div>
      </div>
      <div>
        <div><b>Contacto:</b> ${contactoLine}</div>
        <div><b>Validez:</b> 15 días</div>
      </div>
    </div>

    ${sectionsHtml}

    ${quote.note ? `<div class="condiciones" style="margin-top:14px;"><b>NOTA:</b> ${quote.note}</div>` : ''}

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
    <input placeholder="Sección" class="ps-section" value="${prefill && prefill.section ? prefill.section : ''}" oninput="recalcPresuTotals()" />
    <input placeholder="Concepto" class="ps-name" value="${prefill && prefill.name ? prefill.name : ''}" oninput="recalcPresuTotals()" />
    <input placeholder="Un" class="ps-unit" value="${prefill && prefill.unit ? prefill.unit : ''}" oninput="recalcPresuTotals()" />
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
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

    // Un presupuesto real casi siempre trae 2-4 filas de titulo arriba (nombre
    // del negocio, cliente, fecha) antes de la fila real de encabezados
    // (Concepto/Un/Cantidad/P.U./Importe) -- asumir que la fila 1 SIEMPRE es
    // el encabezado (como hacia antes) dejaba esas columnas sin detectar.
    // Aqui se busca la fila que de verdad tiene cara de encabezado.
    const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: false });
    let headerRowIdx = raw.findIndex(row =>
      row.some(c => { const k = norm(c); return k.includes('concepto') || k.includes('descripcion'); }) &&
      row.some(c => { const k = norm(c); return k.includes('cant') || k.includes('precio') || k.includes('importe') || k.includes('p.u'); })
    );
    if (headerRowIdx === -1) headerRowIdx = 0; // no se encontro: mejor esfuerzo, como antes

    const headerRow = raw[headerRowIdx].map(norm);
    const col = {
      name: headerRow.findIndex(k => k.includes('concepto') || k.includes('producto') || k.includes('nombre') || k.includes('descripcion')),
      qty: headerRow.findIndex(k => k.includes('cant')),
      price: headerRow.findIndex(k => k.includes('precio') || k.includes('p.u')),
      importe: headerRow.findIndex(k => k.includes('importe') || k === 'total'),
      unit: headerRow.findIndex(k => k.replace(/\./g, '') === 'un' || k.includes('unidad')),
      section: headerRow.findIndex(k => k.includes('seccion') || k.includes('categoria') || k.includes('partida') || k.replace(/\./g, '') === 'part'),
      folio: headerRow.findIndex(k => k.includes('folio')),
    };

    let imported = 0;
    let folioFound = '';
    let currentSection = '';
    for (let i = headerRowIdx + 1; i < raw.length; i++) {
      const r = raw[i];
      const nonEmpty = r.filter(c => String(c).trim() !== '');
      if (nonEmpty.length === 0) continue;

      const nameCell = col.name >= 0 ? String(r[col.name] || '').trim() : '';

      // La fila de SUMA/TOTAL del propio documento no es un concepto.
      if (nonEmpty.some(c => /^(SUMA|SUB\s*-?\s*TOTAL|GRAN\s*TOTAL|TOTAL)$/i.test(String(c).trim()))) continue;

      // Una fila con una sola celda de texto y sin numeros es un encabezado de
      // seccion (ej. "INSTALACION"), no un concepto -- se guarda para las
      // filas que le siguen.
      const hasNumberOrPrice = nonEmpty.some(c => typeof c === 'number' || /\d/.test(String(c)));
      if (nonEmpty.length === 1 && !hasNumberOrPrice) { currentSection = String(nonEmpty[0]).trim(); continue; }

      if (!nameCell) continue;
      const qty = col.qty >= 0 ? (parseFloat(r[col.qty]) || 1) : 1;
      let price = col.price >= 0 ? (parseFloat(String(r[col.price]).replace(/[^0-9.\-]/g, '')) || 0) : 0;
      // Si no hay columna de P.U. pero si de Importe, ese monto es el total de
      // la fila, no el precio unitario -- se calcula el unitario en reversa
      // para no inflarlo al multiplicar por la cantidad (mismo caso que el PDF).
      if (col.price < 0 && col.importe >= 0) {
        const importeNum = parseFloat(String(r[col.importe]).replace(/[^0-9.\-]/g, '')) || 0;
        price = qty > 0 ? round2(importeNum / qty) : importeNum;
      }
      const unit = col.unit >= 0 ? String(r[col.unit] || '').trim() : '';
      const section = col.section >= 0 ? String(r[col.section] || '').trim() : currentSection;
      if (col.folio >= 0 && !folioFound && r[col.folio]) folioFound = String(r[col.folio]).trim();

      addPresuRow({ name: nameCell, qty, price, section, unit });
      imported++;
    }
    if (folioFound) presuSetMetaIfEmpty('presuFolio', folioFound);
    showToast(imported > 0 ? `${imported} renglón(es) importados` : 'No se encontraron filas válidas');
  } catch (err) {
    console.error(err);
    showToast('No se pudo leer el Excel.');
  }
  event.target.value = '';
}

async function presuImportPdf(file, event) {
  if (!window.pdfjsLib) { showToast('No se pudo cargar el lector de PDF'); return; }
  try {
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    let imported = 0;
    let currentSection = '';
    let pendingText = '';
    const fullTextLines = [];

    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const items = content.items.map(it => ({
        text: it.str, x: it.transform[4], y: Math.round(it.transform[5] / 3) * 3,
      })).filter(it => it.text.trim());

      pendingText = '';
      const rowsByY = {};
      items.forEach(it => { (rowsByY[it.y] = rowsByY[it.y] || []).push(it); });
      const sortedYs = Object.keys(rowsByY).map(Number).sort((a, b) => b - a);

      sortedYs.forEach(y => {
        const rowItems = rowsByY[y].sort((a, b) => a.x - b.x);
        const lineText = rowItems.map(r => r.text).join(' ').replace(/\s+/g, ' ').trim();
        if (!lineText) return;
        fullTextLines.push(lineText);

        if (looksLikeSectionHeader(lineText)) {
          currentSection = lineText;
          pendingText = '';
          return;
        }

        // La fila de SUMA/TOTAL del propio documento no es un concepto — es el
        // total que ya vamos a recalcular solos. Si se importa como renglón,
        // duplica el importe real.
        if (/^\s*(SUMA|SUB\s*-?\s*TOTAL|GRAN\s*TOTAL|TOTAL)\b/i.test(lineText)) {
          pendingText = '';
          return;
        }

        const moneyMatches = [...lineText.matchAll(/\$\s*([\d,]+\.\d{2})/g)];
        if (moneyMatches.length === 0) {
          // El número de fila (" 2", " 3"...) a veces cae en su propio renglón,
          // separado del texto — si se acumula tal cual, queda embarrado a la
          // mitad del nombre. No aporta nada, se ignora.
          if (/^\d+$/.test(lineText)) return;
          // Sin precio: en un Excel exportado a PDF, un concepto largo suele
          // envolver en 2-3 líneas y solo la última trae UN/CANT/P.U./IMPORTE —
          // esta línea probablemente es el inicio real del concepto, se guarda
          // para pegarla a la siguiente línea que sí traiga precio.
          pendingText = (pendingText + ' ' + lineText).trim().slice(-300);
          return;
        }
        const amounts = moneyMatches.map(m => parseFloat(m[1].replace(/,/g, '')));
        const firstMoneyIdx = lineText.indexOf(moneyMatches[0][0]);
        let before = lineText.slice(0, firstMoneyIdx).trim();

        let unit = '', qty = 1;
        const unitQtyMatch = before.match(/(\S+)\s+(\d+(?:\.\d+)?)\s*$/);
        if (unitQtyMatch && KNOWN_UNITS.includes(unitQtyMatch[1].toLowerCase().replace(/\./g, ''))) {
          unit = unitQtyMatch[1];
          qty = parseFloat(unitQtyMatch[2]);
          before = before.slice(0, unitQtyMatch.index).trim();
        } else {
          const qtyOnlyMatch = before.match(/(\d+(?:\.\d+)?)\s*$/);
          if (qtyOnlyMatch) { qty = parseFloat(qtyOnlyMatch[1]); before = before.slice(0, qtyOnlyMatch.index).trim(); }
        }
        const name = (pendingText + ' ' + before).replace(/^\d+\s+/, '').trim();
        pendingText = '';
        if (!name || name.length < 3) return;
        // Si el renglón trae un solo monto (lo normal en presupuestos de obra:
        // "PISO BASE ... 15 m² ... $10,200.00"), ese monto YA es el importe total
        // de la partida, no un precio unitario — si lo tratamos como P.U. y luego
        // se multiplica por la cantidad, se infla (15 x $10,200 en vez de $10,200).
        // Con dos montos sí es la tabla real P.U./Importe de un catálogo.
        const importeParsed = amounts.length >= 2 ? amounts[1] : amounts[0];
        const price = qty > 0 ? round2(importeParsed / qty) : importeParsed;

        addPresuRow({ name, qty, price, unit, section: currentSection });
        imported++;
      });
    }

    const meta = extractDocMeta(fullTextLines.join('\n'));
    if (meta.cliente) presuSetMetaIfEmpty('presuClient', meta.cliente);
    if (meta.proyecto) presuSetMetaIfEmpty('presuProject', meta.proyecto);
    if (meta.folio) presuSetMetaIfEmpty('presuFolio', meta.folio);
    if (meta.fecha) presuSetFechaIfAuto(meta.fecha);
    if (meta.nota) presuSetMetaIfEmpty('presuNote', meta.nota);

    showToast(imported > 0 ? `${imported} renglón(es) importados — revisa antes de generar` : 'No se detectaron renglones con precio');
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
    estatus: 'Enviada',
    iva_incluido: document.getElementById('presuIvaToggle').checked,
    generado_por: currentUser.email,
  };

  let inserted = await sbInsert('cotizaciones', quote);
  if (!inserted && quote.note) {
    const { note, ...quoteSinNota } = quote;
    inserted = await sbInsert('cotizaciones', quoteSinNota);
  }
  if (!inserted) { showToast('No se pudo guardar, pero se genera igual el PDF'); }

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
    return `<span class="pill pill-aprobada" title="${q.metodo_pago || 'Pago'} · ${fmtFechaCorta(q.fecha_pago)}">✓ Pagado</span>`;
  }
  return `<button class="btn-ghost-sm" title="Registrar el pago de esta cotización" onclick="openPagoModal(${q.id})">💰 Marcar pagado</button>`;
}

async function refreshAll() {
  const cotizaciones = await sbSelect('cotizaciones', 'id.desc');
  const clientes = await sbSelect('clientes', 'id.desc');
  window.__cotizaciones = cotizaciones;
  window.__clientesCache = clientes;

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
        <div class="quote-client">${q.client}</div>
        <div class="quote-meta">${q.folio} · ${q.items.length} producto(s) · ${fmtMoney(q.total)}</div>
      </div>
      <div class="quote-row-actions">
        ${estatusSelectHtml(q)}
        ${pagoBadgeHtml(q)}
        <button class="btn-ghost-sm" title="Ver / volver a descargar" onclick="reprintQuote(${q.id})">Ver</button>
        <button class="remove-row-btn" title="Eliminar cotización" onclick="deleteQuote(${q.id})">✕</button>
      </div>
    </div>
  `).join('') : '<div class="empty-state">Aún no hay cotizaciones. Genera la primera desde el Cotizador.</div>';

  document.getElementById('dashClientsList').innerHTML = clientes.length ? clientes.slice(0, 6).map(c => `
    <div class="quote-row"><div class="quote-client">${c.name}</div></div>
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
      return `<tr class="clickable-row" onclick="openClienteModal(${c.id})"><td>${c.name}</td><td>${c.telefono || '—'}</td><td>${own.length}</td><td>${last}</td><td>${fmtMoney(total)}</td></tr>`;
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
              <div class="quote-client">${q.folio}</div>
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
        <div class="quote-client">${c.client}</div>
        <div class="quote-meta">${c.folio} · ${fmtFechaCorta(c.fecha_pago)} · ${c.metodo_pago || '—'}</div>
      </div>
      <div class="quote-row-actions">
        <strong>${fmtMoney(c.monto_pagado != null ? c.monto_pagado : c.total)}</strong>
      </div>
    </div>
  `).join('') : '<div class="empty-state">Sin cotizaciones pagadas este mes.</div>';

  document.getElementById('gastosList').innerHTML = gastosMes.length ? gastosMes.map(g => `
    <div class="quote-row">
      <div>
        <div class="quote-client">${g.concepto}</div>
        <div class="quote-meta">${fmtFechaCorta(g.fecha)} · ${g.categoria || '—'}${g.proveedor ? ' · ' + g.proveedor : ''}</div>
      </div>
      <div class="quote-row-actions">
        <strong>${fmtMoney(g.monto)}</strong>
        <button class="remove-row-btn" title="Eliminar gasto" onclick="deleteGasto(${g.id})">✕</button>
      </div>
    </div>
  `).join('') : '<div class="empty-state">Sin gastos registrados este mes.</div>';
}

async function addGasto() {
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
