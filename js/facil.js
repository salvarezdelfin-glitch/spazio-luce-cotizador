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
function abrirAyuda() { document.getElementById('ayudaModal').classList.remove('hidden'); }
function cerrarAyuda() { document.getElementById('ayudaModal').classList.add('hidden'); }
