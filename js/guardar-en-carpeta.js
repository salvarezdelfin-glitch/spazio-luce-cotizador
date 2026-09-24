// Guardar cotizaciones directo en una carpeta de la computadora.
//
// La primera vez se elige la carpeta (p. ej. Documentos\Spazio Luce\02 Clientes y
// Cotizaciones); el navegador la recuerda. Cada cotizacion se guarda como PDF en
// una subcarpeta con el nombre del cliente / salon:
//   <carpeta>\<Cliente>\Cotizacion <FOLIO> - <Cliente>.pdf
//
// - Al generar o abrir una cotizacion se guarda sola si la carpeta ya tiene
//   permiso y el archivo todavia no existe (no duplica).
// - El boton "Guardar en carpeta" la guarda/reemplaza a mano.
// - Solo funciona en Chrome/Edge de computadora (File System Access API); en
//   otros navegadores el boton no aparece y todo sigue igual que antes.
//
// Configuracion desde el <script>: data-app (clave unica), data-negocio (texto
// del archivo), data-cliente (campo del objeto quote con el nombre del cliente).
(function () {
  const script = document.currentScript;
  const APP = script.dataset.app || 'spazio';
  const CAMPO_CLIENTE = script.dataset.cliente || 'client';
  const CARPETA_SUGERIDA = script.dataset.carpetaSugerida || 'la carpeta de cotizaciones';
  const SOPORTADO = 'showDirectoryPicker' in window;
  const HTML2PDF_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';

  let ultimaCotizacion = null;

  // ---------- IndexedDB: recordar la carpeta elegida ----------
  function db() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('guardar-en-carpeta', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('handles');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function leerCarpeta() {
    try {
      const d = await db();
      return await new Promise((res) => {
        const r = d.transaction('handles').objectStore('handles').get(APP);
        r.onsuccess = () => res(r.result || null);
        r.onerror = () => res(null);
      });
    } catch (e) { return null; }
  }
  async function guardarCarpeta(handle) {
    const d = await db();
    await new Promise((res, rej) => {
      const tx = d.transaction('handles', 'readwrite');
      tx.objectStore('handles').put(handle, APP);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
  }

  async function permiso(handle, pedir) {
    const opts = { mode: 'readwrite' };
    if ((await handle.queryPermission(opts)) === 'granted') return true;
    if (!pedir) return false;
    return (await handle.requestPermission(opts)) === 'granted';
  }

  async function elegirCarpeta() {
    const handle = await window.showDirectoryPicker({ id: APP + '-cotizaciones', mode: 'readwrite', startIn: 'documents' });
    await guardarCarpeta(handle);
    pintarEstado();
    return handle;
  }

  // ---------- PDF ----------
  let cargandoLib = null;
  function cargarHtml2pdf() {
    if (window.html2pdf) return Promise.resolve();
    if (!cargandoLib) {
      cargandoLib = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = HTML2PDF_SRC;
        s.onload = resolve;
        s.onerror = () => { cargandoLib = null; reject(new Error('No se pudo cargar el generador de PDF')); };
        document.head.appendChild(s);
      });
    }
    return cargandoLib;
  }

  function limpiar(txt) {
    return String(txt || '').replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 80);
  }
  function nombres(q) {
    const cliente = limpiar(q[CAMPO_CLIENTE]) || 'Sin cliente';
    const folio = limpiar(q.folio) || 'sin folio';
    return { subcarpeta: cliente, archivo: `Cotizacion ${folio} - ${cliente}.pdf` };
  }

  async function generarPdf() {
    await cargarHtml2pdf();
    const el = document.getElementById('reciboCard');
    return window.html2pdf().set({
      margin: [8, 8, 8, 8],
      image: { type: 'jpeg', quality: 0.96 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: null },
      jsPDF: { unit: 'mm', format: 'letter', orientation: 'portrait' },
      pagebreak: { mode: ['css', 'legacy'], avoid: ['tr', '.recibo-header', '.recibo-totals'] },
    }).from(el).outputPdf('blob');
  }

  async function existe(dir, nombre) {
    try { await dir.getFileHandle(nombre); return true; } catch (e) { return false; }
  }

  // manual=true: viene de un clic (puede pedir permiso / elegir carpeta y reemplaza).
  async function guardar(manual) {
    if (!SOPORTADO || !ultimaCotizacion) return;
    let raiz = await leerCarpeta();
    if (!raiz) {
      if (!manual) return;
      raiz = await elegirCarpeta();
    }
    if (!(await permiso(raiz, manual))) { pintarEstado(); return; }

    const q = ultimaCotizacion;
    const { subcarpeta, archivo } = nombres(q);
    const dir = await raiz.getDirectoryHandle(subcarpeta, { create: true });
    if (!manual && (await existe(dir, archivo))) { pintarEstado(`Ya estaba guardada en ${raiz.name}\\${subcarpeta}`); return; }

    pintarEstado('Guardando PDF...');
    const blob = await generarPdf();
    if (q !== ultimaCotizacion) return; // cambio de cotizacion mientras se generaba
    const fh = await dir.getFileHandle(archivo, { create: true });
    const w = await fh.createWritable();
    await w.write(blob);
    await w.close();
    const msg = `Guardada en ${raiz.name}\\${subcarpeta}\\${archivo}`;
    pintarEstado(msg);
    if (typeof window.showToast === 'function') window.showToast('PDF guardado en la carpeta de ' + subcarpeta);
  }

  // ---------- UI ----------
  let estadoEl, btnGuardar, btnCarpeta;
  async function pintarEstado(msg) {
    if (!estadoEl) return;
    if (msg) { estadoEl.textContent = msg; return; }
    const raiz = await leerCarpeta();
    if (!raiz) { estadoEl.textContent = `Aun no hay carpeta conectada. Con el primer clic eliges ${CARPETA_SUGERIDA}.`; return; }
    const ok = await permiso(raiz, false);
    estadoEl.textContent = ok ? `Carpeta conectada: ${raiz.name}` : `Carpeta: ${raiz.name} (da clic en "Guardar en carpeta" para darle permiso)`;
  }

  function montarUi() {
    const acciones = document.querySelector('#view-recibo .recibo-actions');
    if (!acciones || !SOPORTADO || document.getElementById('btnGuardarCarpeta')) return;
    btnGuardar = document.createElement('button');
    btnGuardar.id = 'btnGuardarCarpeta';
    btnGuardar.className = 'btn-accent-sm';
    btnGuardar.style.marginRight = '10px';
    btnGuardar.textContent = 'Guardar en carpeta';
    btnGuardar.onclick = () => guardar(true).catch(err => { console.error(err); if (err && err.name === 'AbortError') { pintarEstado(); return; } pintarEstado('No se pudo guardar: ' + (err && err.message || err)); });

    btnCarpeta = document.createElement('button');
    btnCarpeta.className = 'link-btn';
    btnCarpeta.textContent = 'Cambiar carpeta';
    btnCarpeta.onclick = () => elegirCarpeta().then(() => guardar(true)).catch(err => { if (!err || err.name !== 'AbortError') console.error(err); });

    estadoEl = document.createElement('p');
    estadoEl.style.cssText = 'font-size:12px;color:var(--text-secondary);margin-top:10px;';

    const primero = acciones.querySelector('button');
    acciones.insertBefore(btnGuardar, primero ? primero.nextSibling : null);
    const p = acciones.querySelector('p');
    acciones.insertBefore(estadoEl, p);
    estadoEl.after(btnCarpeta);
    pintarEstado();
  }

  // Envuelve renderRecibo (se usa al generar y al reabrir con "Ver") para
  // quedarse con la cotizacion y guardarla sola si ya hay permiso.
  const original = window.renderRecibo;
  if (typeof original === 'function') {
    window.renderRecibo = function (quote) {
      const r = original.apply(this, arguments);
      ultimaCotizacion = quote;
      montarUi();
      pintarEstado();
      setTimeout(() => guardar(false).catch(err => console.warn('Guardado automatico:', err)), 400);
      return r;
    };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montarUi); else montarUi();
})();
