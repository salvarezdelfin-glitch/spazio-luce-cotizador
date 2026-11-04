// Condiciones editables del final de la cotización/presupuesto.
//
// - Las de siempre (condiciones base) viven en la tabla `ajustes` (clave condiciones_base),
//   compartidas entre los dos correos. Si no hay ninguna guardada se usa el ALCANCE de siempre.
// - Cada cotización/presupuesto trae su propio cuadro de texto (una condición por renglón),
//   ya llenado con las de siempre: se pueden quitar, cambiar o agregar sin afectar a las demás.
// - En la cotización se guarda `condiciones`: null = las de siempre (se imprime el ALCANCE como
//   antes), una lista = esas condiciones, lista vacía = sin condiciones.

const COND_CLAVE = 'condiciones_base';
let condicionesBase = null;      // lista (cache)
let condicionesFila = null;      // fila de `ajustes`, si ya existe

function condicionesPorDefecto() { return [ALCANCE_TEXTO]; }

async function cargarCondicionesBase() {
  if (condicionesBase) return condicionesBase;
  const filas = await sbSelectRaw('ajustes');
  condicionesFila = (filas || []).find(f => f.clave === COND_CLAVE) || null;
  const v = condicionesFila && Array.isArray(condicionesFila.valor) ? condicionesFila.valor.filter(x => typeof x === 'string' && x.trim()) : [];
  // Si falló la conexión no se guarda en cache: se reintenta la próxima vez.
  if (filas === null) return condicionesPorDefecto();
  condicionesBase = v.length ? v : condicionesPorDefecto();
  return condicionesBase;
}

function condicionesLineas(id) {
  return document.getElementById(id).value.split('\n').map(s => s.trim()).filter(Boolean);
}

// Llena el cuadro con las condiciones de siempre (al abrir una cotización o presupuesto nuevo).
function iniciarCondiciones(id) {
  const el = document.getElementById(id);
  if (!el) return;
  if (condicionesBase) { el.value = condicionesBase.join('\n'); return; }
  el.value = condicionesPorDefecto().join('\n');
  cargarCondicionesBase().then(base => { if (el.dataset.tocado !== '1') el.value = base.join('\n'); });
}

function cargarCondicionesDeCotizacion(id, condiciones) {
  const el = document.getElementById(id);
  el.dataset.tocado = '1';
  el.value = Array.isArray(condiciones) ? condiciones.join('\n') : (condicionesBase || condicionesPorDefecto()).join('\n');
}

// Lo que se guarda en la cotización: null si son exactamente las de siempre del sistema.
function leerCondiciones(id) {
  const lineas = condicionesLineas(id);
  const porDefecto = condicionesPorDefecto();
  if (lineas.length === porDefecto.length && lineas.every((l, i) => l === porDefecto[i])) return null;
  return lineas;
}

function restablecerCondiciones(id) {
  const el = document.getElementById(id);
  el.dataset.tocado = '1';
  el.value = (condicionesBase || condicionesPorDefecto()).join('\n');
  showToast('Condiciones de siempre puestas');
}

async function guardarCondicionesBase(id) {
  const lineas = condicionesLineas(id);
  if (!lineas.length) { showToast('Escribe al menos una condición para guardarla como las de siempre'); return; }
  await cargarCondicionesBase();
  const ok = condicionesFila
    ? await sbUpdate('ajustes', condicionesFila.id, { valor: lineas, updated_at: new Date().toISOString() })
    : await sbInsert('ajustes', { clave: COND_CLAVE, valor: lineas });
  if (!ok) { showToast('No se pudo guardar, revisa tu conexión'); return; }
  condicionesBase = null; condicionesFila = null;       // se vuelve a leer con la fila nueva
  await cargarCondicionesBase();
  showToast('Guardadas como las condiciones de siempre para todas las cotizaciones nuevas');
}

// HTML del cierre del documento (lo usa reciboCierreHtml en app.js).
function condicionesHtml(quote) {
  const lista = quote.condiciones;
  if (lista == null) {   // las de siempre: formato de antes
    return `
      <div class="condiciones-bloque">
        <div class="cond-titulo">CONDICIONES</div>
        <div class="cond-sub">ALCANCE</div>
        <div class="cond-texto">${ALCANCE_TEXTO}</div>
      </div>`;
  }
  const limpias = Array.isArray(lista) ? lista.filter(x => typeof x === 'string' && x.trim()) : [];
  if (!limpias.length) return '';
  return `
    <div class="condiciones-bloque">
      <div class="cond-titulo">CONDICIONES</div>
      ${limpias.map((c, i) => `<div class="cond-texto cond-item"><span class="cond-n">${i + 1}.</span><span>${escapeHtml(c)}</span></div>`).join('')}
    </div>`;
}
