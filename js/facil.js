// Ayudas de uso: tamaño de letra, barra fija con total y botón de generar, ayuda en
// pasos, aviso de "falta este dato" y resaltado de lo recién agregado. Nada de esto
// cambia datos ni precios: solo hace la app más fácil de ver y de seguir.

// ---------- Tamaño de letra ----------
// Se aplica como zoom a la interfaz (no a la hoja de la cotización, para que el PDF salga igual).
const TAMANOS_LETRA = [1, 1.2, 1.4];
function setTamLetra(z) {
  if (!TAMANOS_LETRA.includes(z)) z = 1.2;
  document.documentElement.style.setProperty('--ui-zoom', z);
  try { localStorage.setItem('sl_tam_letra', String(z)); } catch (e) { /* sin almacenamiento: queda solo esta sesión */ }
  document.querySelectorAll('.tam-letra button').forEach(b => b.classList.toggle('active', Number(b.dataset.z) === z));
}
(function iniciarTamLetra() {
  let z = 1.2; // letra grande por defecto: se lee mejor y se puede bajar desde el menú
  try { const g = parseFloat(localStorage.getItem('sl_tam_letra')); if (TAMANOS_LETRA.includes(g)) z = g; } catch (e) { /* ignorar */ }
  setTamLetra(z);
})();

// ---------- Barra fija: cuántos productos, total y Generar ----------
function actualizarBarraCotizacion(total) {
  const n = document.querySelectorAll('#productRows > *').length;
  const c = document.getElementById('quoteCount');
  const t = document.getElementById('quoteTotalBar');
  if (c) c.textContent = n === 0 ? 'Aún no hay productos' : n + (n === 1 ? ' producto' : ' productos');
  if (t) t.textContent = fmtMoney(total);
}
function actualizarBarraPresupuesto(total) {
  const n = document.querySelectorAll('.presu-row').length;
  const c = document.getElementById('presuCount');
  const t = document.getElementById('presuTotalBar');
  if (c) c.textContent = n === 0 ? 'Aún no hay renglones' : n + (n === 1 ? ' renglón' : ' renglones');
  if (t) t.textContent = fmtMoney(total);
}
function verListaCotizacion() {
  const el = document.getElementById('productRows');
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function verListaPresupuesto() {
  const el = document.getElementById('presupuestoRows');
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Lo que se acaba de agregar a la lista parpadea un momento para que se note que entró.
(function resaltarNuevos() {
  const vigilar = id => {
    const cont = document.getElementById(id);
    if (!cont) return;
    new MutationObserver(muts => muts.forEach(m => m.addedNodes.forEach(n => {
      if (n.nodeType === 1) n.classList.add('row-nueva');
    }))).observe(cont, { childList: true });
  };
  vigilar('productRows');
  vigilar('presupuestoRows');
})();

// ---------- "Falta este dato": avisa, lleva al campo y lo marca ----------
function faltaCampo(id, mensaje) {
  showToast(mensaje);
  const el = document.getElementById(id);
  if (!el) return;
  const caja = el.closest('.input-wrap') || el;
  caja.classList.add('campo-falta');
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.focus({ preventScroll: true });
  el.addEventListener('input', () => caja.classList.remove('campo-falta'), { once: true });
}

// ---------- Ayuda ----------
// abrirAyuda('ayuda-cotizar') abre la ayuda y baja directo a esa parte.
function abrirAyuda(seccion) {
  const modal = document.getElementById('ayudaModal');
  modal.classList.remove('hidden');
  modal.querySelectorAll('.ayuda-bloque').forEach(b => b.classList.remove('ayuda-destacada'));
  const bloque = typeof seccion === 'string' ? document.getElementById(seccion) : null;
  if (bloque) { bloque.classList.add('ayuda-destacada'); bloque.scrollIntoView({ block: 'start' }); }
  else modal.querySelector('.card').scrollTop = 0;
}
function cerrarAyuda() { document.getElementById('ayudaModal').classList.add('hidden'); }

// ---------- Ver / imprimir el PDF ----------
// Se abre el mismo PDF que se guarda en la carpeta y se manda por WhatsApp (con número de página,
// márgenes y sin cortes), en vez de imprimir la pantalla, que podía salir con hojas en blanco.
async function verPdfCotizacion() {
  if (!window.spazioPdf) { window.print(); return; }
  const ventana = window.open('', '_blank');   // se abre ya, dentro del clic, para que no lo bloquee el navegador
  try {
    showToast('Preparando el PDF…');
    const archivo = await window.spazioPdf.obtener();
    const url = URL.createObjectURL(archivo);
    if (ventana) ventana.location.href = url; else window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  } catch (err) {
    console.error(err);
    if (ventana) ventana.close();
    window.print();
  }
}

// ---------- Hoja blanca o negra ----------
// Cambia cómo se ve la cotización y cómo sale el PDF. La elección se recuerda en este equipo.
function temaRecibo() {
  try { return localStorage.getItem('sl_tema_recibo') === 'oscuro' ? 'oscuro' : 'claro'; } catch (e) { return 'claro'; }
}
function aplicarTemaRecibo() {
  const t = temaRecibo();
  const card = document.getElementById('reciboCard');
  if (card) card.classList.toggle('recibo-oscuro', t === 'oscuro');
  document.querySelectorAll('.tema-recibo button').forEach(b => b.classList.toggle('active', b.dataset.t === t));
}
function setTemaRecibo(t) {
  try { localStorage.setItem('sl_tema_recibo', t === 'oscuro' ? 'oscuro' : 'claro'); } catch (e) { /* sin almacenamiento: vale solo esta vez */ }
  aplicarTemaRecibo();
  if (window.spazioPdf && window.spazioPdf.invalidar) window.spazioPdf.invalidar();   // el PDF ya preparado era del otro color
}
aplicarTemaRecibo();

// ---------- Aviso de versión nueva / actualizar la app ----------
// Si en este equipo quedó guardada una versión vieja (pasa al usar la app en otra computadora), se
// avisa y un clic la actualiza. El aviso no recarga solo para no perder lo que se está capturando.
async function revisarVersionNueva() {
  try {
    const r = await fetch('js/app.js?v=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return;
    const m = (await r.text()).match(/APP_VERSION = '([^']*)'/);
    if (m && typeof APP_VERSION !== 'undefined' && m[1] !== APP_VERSION) mostrarAvisoVersion(m[1]);
  } catch (e) { /* sin conexión: se revisa otra vez después */ }
}
function mostrarAvisoVersion(nueva) {
  if (document.getElementById('avisoVersion')) return;
  const a = document.createElement('div');
  a.id = 'avisoVersion'; a.className = 'aviso-version';
  a.innerHTML = '<span>🔄 Hay una versión nueva de la app' + (nueva ? ' (' + nueva.replace(/</g, '') + ')' : '') + '. Guarda lo que estés haciendo y actualiza.</span>' +
    '<button class="btn-accent-sm" onclick="forzarActualizacion()">Actualizar ahora</button>' +
    '<button class="link-btn" onclick="this.parentNode.remove()">Después</button>';
  document.body.appendChild(a);
}
// Borra lo guardado por el navegador (caché y service worker) y vuelve a cargar la app desde internet.
async function forzarActualizacion() {
  try {
    if (window.caches) { const claves = await caches.keys(); await Promise.all(claves.map(k => caches.delete(k))); }
    if (navigator.serviceWorker) { const regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map(r => r.unregister())); }
  } catch (e) { /* aun así se recarga */ }
  location.reload();
}
setTimeout(revisarVersionNueva, 4000);
setInterval(revisarVersionNueva, 20 * 60 * 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) revisarVersionNueva(); });


// ---------- Guías con pasos grandes (guardar y mandar el PDF) ----------
// mostrarGuia({ titulo, intro, pasos: ['html', ...], nota, botones: [{ texto, clase, alHacerClic(boton) }] })
function cerrarGuia() { const m = document.getElementById('guiaModal'); if (m) m.remove(); }
function mostrarGuia(o) {
  cerrarGuia();
  const m = document.createElement('div');
  m.id = 'guiaModal'; m.className = 'guia-fondo';
  m.innerHTML = '<div class="guia-card">' +
    '<h1>' + o.titulo + '</h1>' +
    (o.intro ? '<p class="guia-intro">' + o.intro + '</p>' : '') +
    '<ol class="guia-pasos">' + (o.pasos || []).map(p => '<li>' + p + '</li>').join('') + '</ol>' +
    (o.nota ? '<div class="guia-nota">' + o.nota + '</div>' : '') +
    '<div class="guia-botones"></div></div>';
  const cont = m.querySelector('.guia-botones');
  (o.botones || [{ texto: 'Entendido' }]).forEach(b => {
    const x = document.createElement('button');
    x.className = b.clase || 'btn-accent-sm guia-grande';
    x.textContent = b.texto;
    x.onclick = () => (b.alHacerClic ? b.alHacerClic(x) : cerrarGuia());
    cont.appendChild(x);
  });
  document.body.appendChild(m);
}
function guiaOculta() { try { return localStorage.getItem('sl_sin_guia') === '1'; } catch (e) { return false; } }
function ocultarGuiaParaSiempre() { try { localStorage.setItem('sl_sin_guia', '1'); } catch (e) { /* ignorar */ } cerrarGuia(); showToast('Listo: ya no se mostrará esta explicación'); }
