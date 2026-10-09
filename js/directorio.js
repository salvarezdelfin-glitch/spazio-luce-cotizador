// Directorio: toda la gente del negocio, en grupos: Clientes, Trabajadores (oficios),
// Proveedores, Aliados (quienes nos recomiendan trabajo: arquitectos, constructoras…),
// Servicios (contador, abogado, fletes…) y Otros. El grupo se deduce del `tipo`.
//
// - Los clientes siguen viviendo en la tabla `clientes` (la misma que llena el
//   Cotizador); aquí solo se les agregan colonia y referencias.
// - Todo lo demás vive en la tabla `directorio` (campo `tipo` libre, con sugerencias).
// - "Comparar precios" pone lado a lado las tarifas (monto + unidad) de la gente del
//   mismo oficio, incluyendo prospectos (js/prospectos.js).
// Usa las funciones de app.js (sbSelect, sbInsert, sbUpdate, sbDelete, escapeHtml,
// showToast, waPhone, runWithButtonLock, refreshAll).

const DIR_GRUPOS = [
  { nombre: 'Clientes', tipos: ['Cliente'] },
  { nombre: 'Trabajadores', tipos: ['Albañil', 'Electricista', 'Plomero', 'Instalador de persianas y cortinas',
    'Instalador de pisos y muros', 'Pintor', 'Carpintero', 'Herrero', 'Tablaroquero', 'Vidriero', 'Ayudante general'] },
  { nombre: 'Proveedores', tipos: ['Proveedor de iluminación', 'Proveedor de persianas y cortinas', 'Proveedor de pisos y muros',
    'Proveedor de materiales', 'Proveedor de herramienta', 'Proveedor'] },
  { nombre: 'Aliados', tipos: ['Arquitecto / Diseñador', 'Decorador', 'Constructora / Contratista', 'Inmobiliaria / Administrador'] },
  { nombre: 'Servicios', tipos: ['Contador', 'Abogado', 'Transporte y fletes', 'Gestor y trámites', 'Seguros'] },
  { nombre: 'Otros', tipos: ['Otro'] },
];
const DIR_TIPOS = DIR_GRUPOS.filter(g => g.nombre !== 'Clientes').flatMap(g => g.tipos);
const DIR_CONTRATACION = ['Por obra', 'Nómina', 'Honorarios', 'Eventual'];

// Grupo de un tipo; lo que no está en la lista se acomoda por su nombre (y si no, "Otros").
function dirGrupoDe(tipo) {
  const g = DIR_GRUPOS.find(x => x.tipos.includes(tipo));
  if (g) return g.nombre;
  if (/^proveedor/i.test(tipo)) return 'Proveedores';
  if (/instalador|alba[ñn]il|electricista|plomero|pintor|carpintero|herrero|ayudante/i.test(tipo)) return 'Trabajadores';
  return 'Otros';
}
// Unidades en las que se cotiza el trabajo; solo se comparan tarifas de la MISMA unidad.
const DIR_UNIDADES = ['día', 'hora', 'm²', 'metro lineal', 'pieza', 'punto', 'obra', 'mes'];
const dirUnidadesHtml = '<option value="">Unidad</option>' + DIR_UNIDADES.map(u => `<option value="${u}">por ${u}</option>`).join('');

let dirFiltroGrupo = '';     // '' = todos
let dirFiltroTipo = '';      // '' = todos los tipos del grupo
let dirBusqueda = '';
let dirVista = 'contactos';  // 'contactos' | 'precios' | 'prospectos'
let dirModalOrigen = 'directorio';   // 'directorio' | 'clientes'
let dirModalId = null;

function dirNorm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Lista unificada: cada elemento lleva `tabla` e `id` de su tabla real.
function dirTodos() {
  const clientes = (window.__clientesCache || []).map(c => Object.assign({}, c, { tabla: 'clientes', tipo: 'Cliente' }));
  const otros = (window.__directorioCache || []).map(d => Object.assign({}, d, { tabla: 'directorio' }));
  return clientes.concat(otros).sort((a, b) => String(a.name).localeCompare(String(b.name), 'es'));
}

async function prepareDirectorio() {
  const raw = await sbSelectRaw('directorio', 'name.asc');
  if (raw) window.__directorioCache = raw;
  else showToast('No se pudo cargar el directorio — revisa tu conexión');
  document.getElementById('dirTiposList').innerHTML = DIR_TIPOS.map(t => `<option value="${escapeHtml(t)}">`).join('');
  const pros = await sbSelectRaw('prospectos', 'id.desc');
  if (pros) window.__prospectosCache = pros;
  prosActualizarAviso();
  if (!window.__clientesCache) {
    const cl = await sbSelectRaw('clientes', 'id.desc');
    if (cl) window.__clientesCache = cl;
  }
  setDirVista(dirVista);
}

function setDirVista(v) {
  dirVista = v;
  ['contactos', 'precios', 'prospectos'].forEach(x => {
    document.getElementById('dirPanel-' + x).classList.toggle('hidden', x !== v);
    document.getElementById('dirTab-' + x).classList.toggle('active', x === v);
  });
  document.getElementById('dirBtnsContactos').classList.toggle('hidden', v !== 'contactos');
  document.getElementById('dirBtnsProspectos').classList.toggle('hidden', v !== 'prospectos');
  if (v === 'contactos') renderDirectorio();
  if (v === 'precios') renderPrecios();
  if (v === 'prospectos') renderProspectos();
}

function dirTextoBusqueda(p) {
  return dirNorm([p.name, p.tipo, dirGrupoDe(p.tipo), p.empresa, p.telefono, p.telefono2, p.email, p.direccion,
    p.colonia, p.ciudad, p.referencias, p.tarifa, p.contratacion, p.origen, p.notas].join(' '));
}

function setDirGrupo(g) {
  dirFiltroGrupo = dirFiltroGrupo === g ? '' : g;
  dirFiltroTipo = '';
  renderDirectorio();
}
function setDirTipo(tipo) {
  dirFiltroTipo = dirFiltroTipo === tipo ? '' : tipo;
  renderDirectorio();
}
function onDirBusqueda(valor) {
  dirBusqueda = valor;
  renderDirectorio(true);
}

function dirTarifaTexto(p) {
  const monto = p.tarifa_monto != null && p.tarifa_monto !== '' ? fmtMoney(p.tarifa_monto) + (p.tarifa_unidad ? ' por ' + escapeHtml(p.tarifa_unidad) : '') : '';
  const detalle = p.tarifa ? escapeHtml(p.tarifa) : '';
  return [monto ? '<b>' + monto + '</b>' : '', detalle].filter(Boolean).join(' · ');
}

function dirEstrellas(n) {
  return n ? '<span class="dir-stars" title="Calificación ' + n + ' de 5">' + '★'.repeat(n) + '<span class="dir-stars-off">' + '★'.repeat(5 - n) + '</span></span>' : '';
}

function dirTarjetaHtml(p) {
  const tel = String(p.telefono || '').replace(/\D/g, '');
  const tel2 = String(p.telefono2 || '').replace(/\D/g, '');
  const direccion = [p.direccion, p.colonia, p.ciudad].filter(Boolean).map(escapeHtml).join(', ');
  const linea = (etq, v) => v ? `<div class="dir-line"><span>${etq}</span>${v}</div>` : '';
  return `
    <div class="dir-card">
      <div class="dir-head">
        <div>
          <div class="dir-name">${escapeHtml(p.name)} ${dirEstrellas(p.calificacion)}</div>
          <div class="dir-sub"><span class="dir-tipo">${escapeHtml(p.tipo)}</span>${p.empresa ? ' · ' + escapeHtml(p.empresa) : ''}</div>
        </div>
        <button class="btn-ghost-sm" onclick="openDirModal('${p.tabla}', ${Number(p.id)})">Editar</button>
      </div>
      ${tel ? `<div class="dir-line"><span>Tel.</span><a href="tel:${tel}">${escapeHtml(p.telefono)}</a> · <a href="https://wa.me/${waPhone(tel)}" target="_blank" rel="noopener">WhatsApp</a></div>` : ''}
      ${tel2 ? `<div class="dir-line"><span>Tel. 2</span><a href="tel:${tel2}">${escapeHtml(p.telefono2)}</a></div>` : ''}
      ${p.email ? `<div class="dir-line"><span>Correo</span><a href="mailto:${escapeHtml(p.email)}">${escapeHtml(p.email)}</a></div>` : ''}
      ${linea('Dónde', direccion)}
      ${linea('Referencias', p.referencias ? escapeHtml(p.referencias) : '')}
      ${linea('Tarifa', dirTarifaTexto(p))}
      ${linea('Contratación', p.contratacion ? escapeHtml(p.contratacion) : '')}
      ${linea('Emergencia', p.emergencia ? escapeHtml(p.emergencia) : '')}
      ${linea('Nos conoció', p.origen ? escapeHtml(p.origen) : '')}
      ${linea('Notas', p.notas ? escapeHtml(p.notas) : '')}
    </div>`;
}

function renderDirectorio(soloLista) {
  const todos = dirTodos();
  const q = dirNorm(dirBusqueda).trim();
  const palabras = q ? q.split(/\s+/) : [];

  if (!soloLista) {
    const porGrupo = {}, porTipo = {};
    todos.forEach(p => {
      const g = dirGrupoDe(p.tipo);
      porGrupo[g] = (porGrupo[g] || 0) + 1;
      if (!dirFiltroGrupo || g === dirFiltroGrupo) porTipo[p.tipo] = (porTipo[p.tipo] || 0) + 1;
    });
    document.getElementById('dirGrupos').innerHTML = DIR_GRUPOS.map(g =>
      `<button class="catalog-group${dirFiltroGrupo === g.nombre ? ' active' : ''}" onclick="setDirGrupo('${g.nombre}')">${g.nombre} <span class="count">${porGrupo[g.nombre] || 0}</span></button>`
    ).join('');
    const tipos = Object.keys(porTipo).sort((a, b) => a.localeCompare(b, 'es'));
    document.getElementById('dirChips').innerHTML = dirFiltroGrupo && tipos.length > 1 ? tipos.map(t =>
      `<button class="catalog-tab${dirFiltroTipo === t ? ' active' : ''}" data-tipo="${escapeHtml(t)}" onclick="setDirTipo(this.dataset.tipo)">${escapeHtml(t)} <span class="count">${porTipo[t]}</span></button>`
    ).join('') : '';
  }

  const visibles = todos.filter(p =>
    (!dirFiltroGrupo || dirGrupoDe(p.tipo) === dirFiltroGrupo) &&
    (!dirFiltroTipo || p.tipo === dirFiltroTipo) &&
    palabras.every(w => dirTextoBusqueda(p).includes(w)));

  document.getElementById('dirCount').textContent = visibles.length === todos.length
    ? todos.length + ' en total'
    : visibles.length + ' de ' + todos.length;
  document.getElementById('dirList').innerHTML = visibles.length
    ? visibles.map(dirTarjetaHtml).join('')
    : `<div class="empty-state">${todos.length ? 'Nada coincide con esa búsqueda.' : 'Aún no hay nadie en el directorio. Agrega al primero con los botones de arriba.'}</div>`;
}

// ---------- Alta / edición ----------
const DIR_CAMPOS = [
  ['dirNombre', 'name'], ['dirTipo', 'tipo'], ['dirEmpresa', 'empresa'], ['dirTelefono', 'telefono'],
  ['dirTelefono2', 'telefono2'], ['dirEmail', 'email'], ['dirDireccion', 'direccion'], ['dirColonia', 'colonia'],
  ['dirCiudad', 'ciudad'], ['dirReferencias', 'referencias'], ['dirTarifaMonto', 'tarifa_monto'],
  ['dirTarifaUnidad', 'tarifa_unidad'], ['dirTarifa', 'tarifa'], ['dirCalificacion', 'calificacion'], ['dirNotas', 'notas'],
  ['dirOrigen', 'origen'], ['dirContratacion', 'contratacion'], ['dirEmergencia', 'emergencia'],
];

// Selector de tipo con los tipos agrupados; "Otro (escribir)" deja poner uno propio.
function dirTipoSelHtml() {
  return '<option value="">Elige el tipo…</option>' + DIR_GRUPOS.filter(g => g.nombre !== 'Clientes').map(g =>
    `<optgroup label="${g.nombre}">${g.tipos.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('')}</optgroup>`
  ).join('') + '<option value="__otro">Otro tipo (escribir)…</option>';
}
function dirTipoActual() {
  const sel = document.getElementById('dirTipoSel').value;
  return sel === '__otro' ? document.getElementById('dirTipo').value.trim() : sel;
}
function onDirTipoSel() {
  const otro = document.getElementById('dirTipoSel').value === '__otro';
  document.getElementById('dirTipo').classList.toggle('hidden', !otro);
  document.getElementById('dirTipoOtroWrap').classList.toggle('hidden', !otro);
  const trabajador = dirModalOrigen === 'directorio' && dirGrupoDe(dirTipoActual()) === 'Trabajadores';
  document.querySelectorAll('#dirModal .solo-trabajador').forEach(e => e.classList.toggle('hidden', !trabajador));
}

function openDirModal(origen, id, grupo) {
  dirModalOrigen = origen;
  dirModalId = id || null;
  const lista = origen === 'clientes' ? (window.__clientesCache || []) : (window.__directorioCache || []);
  const p = id ? lista.find(x => x.id === id) : null;
  document.getElementById('dirTarifaUnidad').innerHTML = dirUnidadesHtml;
  document.getElementById('dirContratacion').innerHTML = '<option value="">Sin definir</option>' + DIR_CONTRATACION.map(c => `<option>${c}</option>`).join('');
  document.getElementById('dirTipoSel').innerHTML = dirTipoSelHtml();
  DIR_CAMPOS.forEach(([el, campo]) => {
    document.getElementById(el).value = p && p[campo] != null ? p[campo] : '';
  });
  const esCliente = origen === 'clientes';
  if (!esCliente) {
    // Edición: su tipo (o "otro" si es uno propio). Alta: el primer tipo del grupo que se pidió.
    const tipo = p ? p.tipo : (DIR_GRUPOS.find(g => g.nombre === grupo) || {}).tipos?.[0] || '';
    document.getElementById('dirTipoSel').value = DIR_TIPOS.includes(tipo) ? tipo : (tipo ? '__otro' : '');
    document.getElementById('dirTipo').value = tipo;
  }
  document.querySelectorAll('#dirModal .solo-oficio').forEach(e => e.classList.toggle('hidden', esCliente));
  onDirTipoSel();
  document.getElementById('dirModalTitle').textContent = esCliente
    ? (p ? 'Editar cliente' : 'Nuevo cliente')
    : (p ? 'Editar contacto' : 'Nuevo ' + ({ Trabajadores: 'trabajador', Proveedores: 'proveedor', Aliados: 'aliado' }[grupo] || 'contacto'));
  document.getElementById('dirBorrarBtn').classList.toggle('hidden', esCliente || !p);
  document.getElementById('dirModal').classList.remove('hidden');
  document.getElementById('dirNombre').focus();
}

function closeDirModal() {
  document.getElementById('dirModal').classList.add('hidden');
  dirModalId = null;
}

async function saveDirContacto() {
  await runWithButtonLock('dirGuardarBtn', saveDirContactoImpl);
}

async function saveDirContactoImpl() {
  const v = id => document.getElementById(id).value.trim();
  const name = v('dirNombre');
  if (!name) { showToast('Escribe el nombre'); return; }
  const base = {
    name,
    telefono: v('dirTelefono') || null,
    email: v('dirEmail') || null,
    direccion: v('dirDireccion') || null,
    colonia: v('dirColonia') || null,
    ciudad: v('dirCiudad') || null,
    referencias: v('dirReferencias') || null,
    origen: v('dirOrigen') || null,
    notas: v('dirNotas') || null,
  };

  let ok;
  if (dirModalOrigen === 'clientes') {
    ok = dirModalId ? await sbUpdate('clientes', dirModalId, base) : await sbInsert('clientes', base);
  } else {
    const tipo = dirTipoActual();
    if (!tipo) { showToast('Elige el tipo de contacto'); return; }
    const fila = Object.assign(base, {
      tipo,
      contratacion: dirGrupoDe(tipo) === 'Trabajadores' ? (v('dirContratacion') || null) : null,
      emergencia: dirGrupoDe(tipo) === 'Trabajadores' ? (v('dirEmergencia') || null) : null,
      empresa: v('dirEmpresa') || null,
      telefono2: v('dirTelefono2') || null,
      tarifa: v('dirTarifa') || null,
      tarifa_monto: v('dirTarifaMonto') === '' ? null : Math.max(0, parseFloat(v('dirTarifaMonto')) || 0),
      tarifa_unidad: v('dirTarifaUnidad') || null,
      calificacion: parseInt(document.getElementById('dirCalificacion').value, 10) || null,
    });
    if (fila.tipo.toLowerCase() === 'cliente') { showToast('Los clientes se agregan con "+ Cliente"'); return; }
    ok = dirModalId ? await sbUpdate('directorio', dirModalId, fila) : await sbInsert('directorio', fila);
  }
  if (!ok) { showToast('No se pudo guardar, revisa tu conexión'); return; }
  showToast('Guardado');
  closeDirModal();
  if (dirModalOrigen === 'clientes') await refreshAll();
  await prepareDirectorio();
}

async function borrarDirContacto() {
  if (dirModalOrigen !== 'directorio' || !dirModalId) return;
  const p = (window.__directorioCache || []).find(x => x.id === dirModalId);
  if (!confirm('¿Eliminar a ' + (p ? p.name : 'este contacto') + ' del directorio? No se puede deshacer.')) return;
  const ok = await sbDelete('directorio', dirModalId);
  if (!ok) { showToast('No se pudo eliminar, revisa tu conexión'); return; }
  showToast('Contacto eliminado');
  closeDirModal();
  await prepareDirectorio();
}

// ---------- Exportar ----------
function exportDirectorioCsv() {
  const cols = [['Grupo', 'grupo'], ['Tipo', 'tipo'], ['Nombre', 'name'], ['Empresa', 'empresa'], ['Teléfono', 'telefono'], ['Teléfono 2', 'telefono2'],
    ['Correo', 'email'], ['Calle y número', 'direccion'], ['Colonia', 'colonia'], ['Ciudad', 'ciudad'], ['Referencias', 'referencias'],
    ['Tarifa (monto)', 'tarifa_monto'], ['Tarifa (unidad)', 'tarifa_unidad'], ['Tarifa (detalle)', 'tarifa'], ['Calificación', 'calificacion'], ['Contratación', 'contratacion'], ['Emergencia', 'emergencia'], ['Nos conoció', 'origen'], ['Notas', 'notas']];
  const esc = x => '"' + String(x == null ? '' : x).replace(/"/g, '""') + '"';
  // Evita que una celda que empiece como fórmula (=, @, o +/- seguido de letra) se ejecute en Excel;
  // un teléfono como +52 55… no se toca.
  const seguro = x => /^[=@]|^[+\-]\s*[^\d\s]/.test(String(x == null ? '' : x)) ? "'" + x : x;
  const filas = [cols.map(c => esc(c[0])).join(',')].concat(
    dirTodos().map(p => Object.assign({}, p, { grupo: dirGrupoDe(p.tipo) })).map(p => cols.map(c => esc(seguro(p[c[1]]))).join(',')));
  const blob = new Blob(['﻿' + filas.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'directorio-spazio-luce.csv';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// ---------- Comparar precios ----------
// Agrupa por oficio y, dentro, por unidad (no se mezcla "por día" con "por m²").
// Incluye prospectos vivos (ni contratados ni descartados) para saber si conviene
// más contratar a alguien nuevo que a quien ya está.
function precioPersonas() {
  const gente = (window.__directorioCache || []).map(d => ({
    id: d.id, nombre: d.name, oficio: d.tipo, monto: Number(d.tarifa_monto), unidad: d.tarifa_unidad,
    calificacion: d.calificacion, prospecto: false, telefono: d.telefono, detalle: d.tarifa,
  }));
  const pros = (window.__prospectosCache || [])
    .filter(p => p.estatus !== 'Contratado' && p.estatus !== 'Descartado')
    .map(p => ({
      id: p.id, nombre: p.name, oficio: p.oficio, monto: Number(p.tarifa_monto), unidad: p.tarifa_unidad,
      calificacion: null, prospecto: true, telefono: p.telefono, detalle: p.estatus,
    }));
  return gente.concat(pros).filter(x => x.monto > 0 && x.unidad);
}

function renderPrecios() {
  const gente = precioPersonas();
  const filtro = document.getElementById('preciosOficio').value;
  const oficios = [...new Set(gente.map(g => g.oficio))].sort((a, b) => a.localeCompare(b, 'es'));
  const sel = document.getElementById('preciosOficio');
  sel.innerHTML = '<option value="">Todos los oficios</option>' + oficios.map(o => `<option value="${escapeHtml(o)}"${o === filtro ? ' selected' : ''}>${escapeHtml(o)}</option>`).join('');

  const grupos = {};
  gente.filter(g => !filtro || g.oficio === filtro).forEach(g => {
    const k = g.oficio + '||' + g.unidad;
    (grupos[k] = grupos[k] || { oficio: g.oficio, unidad: g.unidad, lista: [] }).lista.push(g);
  });
  const claves = Object.keys(grupos).sort((a, b) => a.localeCompare(b, 'es'));
  document.getElementById('preciosList').innerHTML = claves.length ? claves.map(k => {
    const gr = grupos[k];
    const lista = gr.lista.slice().sort((a, b) => a.monto - b.monto);
    const min = lista[0].monto;
    const prom = lista.reduce((s, x) => s + x.monto, 0) / lista.length;
    const mejorCal = Math.max(0, ...lista.map(x => x.calificacion || 0));
    return `
      <div class="panel" style="margin-bottom:14px;">
        <h3>${escapeHtml(gr.oficio)} · precio por ${escapeHtml(gr.unidad)}</h3>
        <div class="dir-sub" style="margin:-6px 0 10px;">${lista.length} ${lista.length === 1 ? 'opción' : 'opciones'} · promedio ${fmtMoney(prom)}</div>
        ${lista.map((x, i) => {
          const dif = i === 0 ? '' : '+' + Math.round((x.monto / min - 1) * 100) + '% vs. el más barato';
          const etiquetas = [
            i === 0 && lista.length > 1 ? '<span class="dir-tag dir-tag-verde">Más barato</span>' : '',
            mejorCal > 0 && x.calificacion === mejorCal && lista.length > 1 ? '<span class="dir-tag dir-tag-oro">Mejor calificado</span>' : '',
            x.prospecto ? '<span class="dir-tag">Prospecto · ' + escapeHtml(x.detalle) + '</span>' : '',
          ].join('');
          return `
            <div class="quote-row">
              <div>
                <div class="quote-client">${escapeHtml(x.nombre)} ${dirEstrellas(x.calificacion)} ${etiquetas}</div>
                <div class="quote-meta">${dif}${!x.prospecto && x.detalle ? (dif ? ' · ' : '') + escapeHtml(x.detalle) : ''}</div>
              </div>
              <div class="quote-row-actions"><strong>${fmtMoney(x.monto)}</strong></div>
            </div>`;
        }).join('')}
      </div>`;
  }).join('') : '<div class="empty-state">Para comparar, captura la tarifa (monto y unidad) en cada contacto o prospecto. Solo se comparan precios de la misma unidad.</div>';
}
