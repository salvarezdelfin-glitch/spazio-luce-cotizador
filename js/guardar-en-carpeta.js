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

  // ---------------------------------------------------------------------------
  // PDF con paginación propia. Antes se dejaba que html2pdf cortara la hoja donde cayera y a veces
  // partía una firma o una fila entre dos páginas, o dejaba una hoja en blanco. Ahora se mide cada
  // bloque de la cotización (encabezado, cada renglón, total, cada condición, firmas) y los cortes
  // solo caen ENTRE bloques: nada se parte. Cada página se fotografía por separado y se arma el PDF
  // con pie fijo (barra negra + "Página X de N") y, desde la 2.ª hoja, una cabecera corta.
  // ---------------------------------------------------------------------------
  const HOJA = { ancho: 215.9, alto: 279.4, arriba: 10, abajo: 16, lado: 8 };   // carta, en mm
  const ESCENARIO_PX = 760;                                                      // ancho de la hoja en pantalla
  const FOTO_PX = 794;                                                           // ancho del "marco" que se fotografía (el de html2pdf)

  // Bloques que no se parten; cada uno es una lista de elementos que viajan juntos.
  function unidadesDeHoja(copia) {
    const unidades = [];
    const nueva = (els, opts) => {
      const lista = els.filter(Boolean);
      if (lista.length) unidades.push(Object.assign({ els: lista }, opts || {}));
    };
    let barra = null;
    Array.from(copia.children).forEach(h => {
      const cl = h.classList;
      if (cl.contains('recibo-divider') || cl.contains('recibo-total-bar') || cl.contains('recibo-footer')) return; // viajan con otro bloque o se dibujan aparte
      if (cl.contains('recibo-header')) {
        nueva([h, h.nextElementSibling && h.nextElementSibling.classList.contains('recibo-divider') ? h.nextElementSibling : null]);
      } else if (cl.contains('presupuesto-section-bar')) {
        barra = h;                                  // la barra de sección va siempre con su tabla
      } else if (h.tagName === 'TABLE') {
        const encabezado = h.querySelector('thead');
        const filas = Array.from(h.querySelectorAll('tbody tr'));
        filas.forEach((tr, i) => nueva(i === 0 ? [barra, encabezado, tr] : [tr], i === 0 ? {} : { fila: tr }));
        if (!filas.length) nueva([barra, h]);
        barra = null;
      } else if (cl.contains('recibo-totals')) {
        nueva([h, h.nextElementSibling], { juntoAlAnterior: true });   // subtotal + total, pegados al último renglón
      } else if (cl.contains('recibo-cierre')) {
        Array.from(h.children).forEach(c => {
          if (c.classList.contains('condiciones-bloque')) {
            const partes = Array.from(c.children);
            const primero = Math.max(0, partes.findIndex(p => p.classList.contains('cond-texto')));
            nueva(partes.slice(0, primero + 1));                        // título (+ subtítulo) con la primera condición
            partes.slice(primero + 1).forEach(p => nueva([p]));       // el resto, una por una
          } else if (c.classList.contains('firma-row')) {
            nueva([c], { juntoAlAnterior: true });                      // las firmas nunca quedan solas
          } else {
            nueva([c]);
          }
        });
      } else {
        nueva([h]);
      }
    });
    return unidades;
  }

  // Reparte los bloques en páginas de altura H (px). Cada elemento queda marcado con data-u = número de
  // su grupo; devuelve [{ g0, g1 }]: de qué grupo a qué grupo va cada página.
  function paginarUnidades(unidades, escenario, H) {
    const base = escenario.getBoundingClientRect().top;
    const grupos = [];
    unidades.forEach(u => {
      const rects = u.els.map(e => e.getBoundingClientRect());
      const top = Math.min(...rects.map(r => r.top)) - base;
      const bottom = Math.max(...rects.map(r => r.bottom)) - base;
      if (u.juntoAlAnterior && grupos.length) grupos[grupos.length - 1].bottom = Math.max(grupos[grupos.length - 1].bottom, bottom);
      else grupos.push({ top, bottom, fila: u.fila || null });
      u.els.forEach(e => { e.dataset.u = String(grupos.length - 1); });
    });
    const paginas = [];
    // Si una página arranca a media tabla se le repite el encabezado de la tabla: su altura cuenta.
    const altoEncabezado = g => {
      const th = g.fila ? g.fila.closest('table').querySelector('thead') : null;
      return th ? th.getBoundingClientRect().height : 0;
    };
    let g0 = 0, inicio = grupos[0].top, extra = 0;
    for (let i = 1; i < grupos.length; i++) {
      if (grupos[i].bottom - inicio + extra > H) {
        paginas.push({ g0, g1: i - 1 });
        g0 = i; inicio = grupos[i].top; extra = altoEncabezado(grupos[i]);
      }
    }
    paginas.push({ g0, g1: grupos.length - 1 });
    return paginas;
  }

  // Copia de la hoja con solo los bloques de una página (sin desplazamientos: se dibuja desde arriba).
  // En las hojas de continuación se repite el encabezado de cada tabla.
  function hojaDePagina(copia, pag) {
    const hoja = copia.cloneNode(true);
    hoja.querySelectorAll('[data-u]').forEach(e => {
      const g = Number(e.dataset.u);
      if (g < pag.g0 || g > pag.g1) e.style.display = 'none';
    });
    hoja.querySelectorAll('table').forEach(t => {
      const visibles = Array.from(t.querySelectorAll('tbody tr')).some(tr => tr.style.display !== 'none');
      const th = t.querySelector('thead');
      if (th) th.style.display = visibles ? '' : 'none';
      if (!visibles) t.style.display = 'none';
    });
    // Contenedores que se quedaron sin nada visible no deben dejar su margen.
    hoja.querySelectorAll('.condiciones-bloque, .recibo-cierre').forEach(c => {
      if (!Array.from(c.querySelectorAll('[data-u]')).some(e => e.style.display !== 'none')) c.style.display = 'none';
    });
    return hoja;
  }

  async function imagenesListas(raiz) {
    await Promise.all(Array.from(raiz.querySelectorAll('img')).map(img =>
      img.complete && img.naturalWidth ? null : new Promise(res => { img.onload = img.onerror = res; })));
  }

  async function generarPdfNuevo(q) {
    await cargarHtml2pdf();
    const el = document.getElementById('reciboCard');
    // La barra negra del pie (SPAZIO LUCE · correo · ciudad) se dibuja fija al fondo de cada hoja.
    const pie = el.querySelector('.recibo-footer');
    const piePartes = pie ? Array.from(pie.children).map(c => c.textContent.trim()).filter(Boolean) : [];
    const oscuro = el.classList.contains('recibo-oscuro');   // hoja negra o blanca
    const rotulo = 'Cotización' + (q && q.folio ? ' ' + q.folio : '') + (q && q.client ? ' · ' + q.client : '');

    // 1) Escenario: copia de la hoja a ancho fijo, fuera de pantalla (la hoja visible no se toca).
    const escenario = document.createElement('div');
    escenario.style.cssText = `position:absolute;left:-10000px;top:0;width:${ESCENARIO_PX}px;background:#fff;`;
    const copia = el.cloneNode(true);
    copia.removeAttribute('id');
    copia.classList.add('pdf-hoja');
    copia.style.cssText += `;width:${ESCENARIO_PX}px;max-width:none;margin:0;border-radius:0;box-shadow:none;position:static;`;
    const pieCopia = copia.querySelector('.recibo-footer');
    if (pieCopia) pieCopia.remove();
    escenario.appendChild(copia);
    document.body.appendChild(escenario);

    const canvases = [];
    try {
      await imagenesListas(copia);
      const anchoUtilMm = HOJA.ancho - 2 * HOJA.lado;
      const altoUtilMm = HOJA.alto - HOJA.arriba - HOJA.abajo;
      const pxPorMm = FOTO_PX / anchoUtilMm;
      const H = altoUtilMm * pxPorMm - 6;   // pequeño colchón: la hoja se vuelve a acomodar al armar cada página
      const paginas = paginarUnidades(unidadesDeHoja(copia), escenario, H);

      // Comprobación con medidas reales: cada página se arma y se mide; si alguna se pasa de la hoja
      // (por el encabezado repetido, márgenes…), su último bloque pasa a la página siguiente.
      const medir = pag => {
        const hoja = hojaDePagina(copia, pag);
        escenario.appendChild(hoja);
        const alto = hoja.getBoundingClientRect().height;
        hoja.remove();
        return alto;
      };
      for (let k = 0; k < paginas.length; k++) {
        while (paginas[k].g1 > paginas[k].g0 && medir(paginas[k]) > H) {
          const mover = paginas[k].g1;
          paginas[k].g1 -= 1;
          if (k + 1 < paginas.length) paginas[k + 1].g0 = mover;
          else paginas.push({ g0: mover, g1: mover });
        }
      }

      // 2) Cada página: la hoja con solo sus bloques, fotografiada aparte.
      for (const pag of paginas) {
        // La hoja de la página va en un marco del ancho de html2pdf y del color de la hoja, con la hoja
        // centrada: así no queda ninguna franja blanca ni la hoja sale corrida, sea cual sea la ventana.
        const hoja = hojaDePagina(copia, pag);
        hoja.style.margin = '0 auto';
        const marco = document.createElement('div');
        marco.style.cssText = `width:${FOTO_PX}px;background:${oscuro ? '#0B0B09' : '#ffffff'};`;
        marco.appendChild(hoja);
        escenario.appendChild(marco);
        try {
          const canvas = await window.html2pdf().set({
            // scrollX/scrollY en 0: con la ventana desplazada html2canvas dibuja la hoja corrida.
            html2canvas: { scale: 2, useCORS: true, backgroundColor: oscuro ? '#0B0B09' : '#ffffff', scrollX: 0, scrollY: 0 },
          }).from(marco).toCanvas().get('canvas');
          canvases.push(canvas);
        } finally {
          marco.remove();
        }
      }
    } finally {
      escenario.remove();
    }

    // 3) Armar el PDF: una imagen por página + pie fijo + cabecera corta desde la 2.ª hoja.
    const pdf = await window.html2pdf().set({ jsPDF: { unit: 'mm', format: 'letter', orientation: 'portrait' } })
      .from(document.createElement('canvas'), 'canvas').toPdf().get('pdf');
    canvases.forEach(c => {
      pdf.addPage();
      if (oscuro) {   // en la hoja negra toda la página va en negro, también los márgenes
        pdf.setFillColor(11, 11, 9);
        pdf.rect(0, 0, HOJA.ancho, HOJA.alto, 'F');
      }
      const alto = (c.height / c.width) * (HOJA.ancho - 2 * HOJA.lado);
      pdf.addImage(c.toDataURL('image/jpeg', 0.95), 'JPEG', HOJA.lado, HOJA.arriba, HOJA.ancho - 2 * HOJA.lado, alto);
    });
    pdf.deletePage(1);   // la página en blanco con la que arrancó el documento

    const n = pdf.internal.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      pdf.setPage(i);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8);
      if (i > 1) {   // cabecera corta en las hojas de continuación
        pdf.setTextColor(184, 145, 46);
        pdf.setFont('helvetica', 'bold');
        pdf.text('SPAZIO LUCE', HOJA.lado, 6.5);
        pdf.setFont('helvetica', 'normal');
        if (oscuro) pdf.setTextColor(170, 170, 160); else pdf.setTextColor(120, 120, 120);
        pdf.text(rotulo + ' · continuación', HOJA.ancho - HOJA.lado, 6.5, { align: 'right' });
        pdf.setDrawColor(201, 162, 39);
        pdf.setLineWidth(0.4);
        pdf.line(HOJA.lado, 8, HOJA.ancho - HOJA.lado, 8);
      }
      if (oscuro) pdf.setTextColor(170, 170, 160); else pdf.setTextColor(130, 130, 130);
      pdf.text(rotulo, HOJA.lado, HOJA.alto - 14);
      pdf.text('Página ' + i + ' de ' + n, HOJA.ancho - HOJA.lado, HOJA.alto - 14, { align: 'right' });
      if (piePartes.length) {
        if (oscuro) pdf.setFillColor(201, 162, 39); else pdf.setFillColor(17, 17, 17);
        pdf.rect(HOJA.lado, HOJA.alto - 11, HOJA.ancho - 2 * HOJA.lado, 7, 'F');
        if (oscuro) pdf.setTextColor(11, 11, 9); else pdf.setTextColor(201, 162, 39);
        pdf.setFont('helvetica', 'bold');
        pdf.text(piePartes[0], HOJA.lado + 4, HOJA.alto - 6.4);
        pdf.setFont('helvetica', 'normal');
        if (piePartes[1]) pdf.text(piePartes[1], HOJA.ancho / 2, HOJA.alto - 6.4, { align: 'center' });
        if (piePartes[2]) pdf.text(piePartes[2], HOJA.ancho - HOJA.lado - 4, HOJA.alto - 6.4, { align: 'right' });
      }
    }
    return pdf.output('blob');
  }

  // Un solo PDF por cotizacion: lo comparten "Guardar en carpeta" y el envio por
  // WhatsApp. `listo` guarda el resultado para poder usarlo sin esperar (compartir
  // exige que el toque del usuario siga "fresco").
  let pdfCache = null; // { quote, promesa, listo }
  function pdfDe(q) {
    if (!pdfCache || pdfCache.quote !== q) {
      const entrada = { quote: q, listo: null };
      entrada.promesa = generarPdfNuevo(q).then(blob => {
        entrada.listo = blob;
        return blob;
      }).catch(err => {
        if (pdfCache === entrada) pdfCache = null; // permitir reintentar
        throw err;
      });
      pdfCache = entrada;
    }
    return pdfCache;
  }
  function generarPdf() { return pdfDe(ultimaCotizacion).promesa; }

  // API para el resto de la app (envio por WhatsApp / correo).
  window.spazioPdf = {
    // Tira el PDF ya preparado (p. ej. al cambiar la hoja de blanca a negra) y adelanta el nuevo.
    invalidar() {
      pdfCache = null;
      const q = ultimaCotizacion;
      if (q) setTimeout(() => { if (q === ultimaCotizacion) pdfDe(q).promesa.catch(err => console.warn('PDF previo:', err)); }, 300);
    },
    // File ya generado de la cotizacion en pantalla, o null si aun se prepara.
    listo() {
      if (!ultimaCotizacion || !pdfCache || pdfCache.quote !== ultimaCotizacion || !pdfCache.listo) return null;
      return new File([pdfCache.listo], nombres(ultimaCotizacion).archivo, { type: 'application/pdf' });
    },
    // Promesa del File (lo genera si hace falta).
    async obtener() {
      if (!ultimaCotizacion) throw new Error('No hay cotizacion abierta');
      const q = ultimaCotizacion;
      const blob = await pdfDe(q).promesa;
      return new File([blob], nombres(q).archivo, { type: 'application/pdf' });
    },
  };

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

    const primero = acciones.querySelector(':scope > button');   // solo botones directos (el selector de hoja blanca/negra lleva los suyos)
    acciones.insertBefore(btnGuardar, primero ? primero.nextSibling : null);
    const p = acciones.querySelector(':scope > p');
    acciones.insertBefore(estadoEl, p);
    estadoEl.after(btnCarpeta);
    pintarEstado();
  }

  // Se llama cada vez que se muestra un recibo (generar, "Ver", editar, presupuesto):
  // se queda con la cotizacion, la guarda sola si ya hay permiso y adelanta el PDF
  // para que "Enviar por WhatsApp" lo tenga listo. Lo invoca wireReciboButtons (app.js),
  // el unico punto por el que pasan TODAS las rutas; antes solo se enganchaba
  // renderRecibo y los presupuestos recien generados lo saltaban: "Guardar en carpeta"
  // no hacia nada.
  let ultimoAviso = { quote: null, t: 0 };
  function alMostrarRecibo(quote) {
    if (!quote) return;
    if (ultimoAviso.quote === quote && Date.now() - ultimoAviso.t < 1500) return; // ya avisado por la otra via
    ultimoAviso = { quote, t: Date.now() };
    ultimaCotizacion = quote;
    montarUi();
    pintarEstado();
    setTimeout(() => guardar(false).catch(err => console.warn('Guardado automatico:', err)), 400);
    setTimeout(() => { if (quote === ultimaCotizacion) pdfDe(quote).promesa.catch(err => console.warn('PDF previo:', err)); }, 700);
  }
  window.alMostrarRecibo = alMostrarRecibo;

  // Respaldo: renderRecibo tambien avisa (por si wireReciboButtons no se llamara).
  const original = window.renderRecibo;
  if (typeof original === 'function') {
    window.renderRecibo = function (quote) {
      const r = original.apply(this, arguments);
      alMostrarRecibo(quote);
      return r;
    };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montarUi); else montarUi();
})();
