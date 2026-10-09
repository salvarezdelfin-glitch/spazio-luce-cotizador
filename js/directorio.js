// Directorio: clientes (con dirección y referencias) y toda la gente que necesita el
// negocio: albañiles, electricistas, instaladores, proveedores, etc.
//
// - Los clientes siguen viviendo en la tabla `clientes` (la misma que llena el
//   Cotizador); aquí solo se les agregan colonia, referencias y enlace de mapa.
// - Todo lo demás vive en la tabla `directorio` (campo `tipo` libre, con sugerencias).
// Usa las funciones de app.js (sbSelect, sbInsert, sbUpdate, sbDelete, escapeHtml,
// showToast, waPhone, runWithButtonLock, refreshAll).

const DIR_TIPOS = ['Albañil', 'Electricista', 'Plomero', 'Instalador', 'Pintor', 'Carpintero',
  'Herrero', 'Tablaroquero', 'Vidriero', 'Arquitecto / Diseñador', 'Proveedor', 'Otro'];

let dirFiltroTipo = '';      // '' = todos
let dirBusqueda = '';
let dirModalOrigen = 'directorio';   // 'directorio' | 'clientes'
let dirModalId = null;

function dirNorm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Lista unificada: cada elemento lleva `origen` e `id` de su tabla real.
function dirTodos() {
  const clientes = (window.__clientesCache || []).map(c => Object.assign({}, c, { origen: 'clientes', tipo: 'Cliente' }));
  const otros = (window.__directorioCache || []).map(d => Object.assign({}, d, { origen: 'directorio' }));
  return clientes.concat(otros).sort((a, b) => String(a.name).localeCompare(String(b.name), 'es'));
}

async function prepareDirectorio() {
  const raw = await sbSelectRaw('directorio', 'name.asc');
  if (raw) window.__directorioCache = raw;
  else showToast('No se pudo cargar el directorio — revisa tu conexión');
  if (!window.__clientesCache) {
    const cl = await sbSelectRaw('clientes', 'id.desc');
    if (cl) window.__clientesCache = cl;
  }
  renderDirectorio();
}

function dirTextoBusqueda(p) {
  return dirNorm([p.name, p.tipo, p.empresa, p.telefono, p.telefono2, p.email, p.direccion,
    p.colonia, p.ciudad, p.referencias, p.tarifa, p.notas].join(' '));
}

function setDirTipo(tipo) {
  dirFiltroTipo = dirFiltroTipo === tipo ? '' : tipo;
  renderDirectorio();
}
function onDirBusqueda(valor) {
  dirBusqueda = valor;
  renderDirectorio(true);
}

function dirMapaUrl(p) {
  if (p.maps_link && /^https?:\/\//i.test(p.maps_link)) return p.maps_link;
  const dir = [p.direccion, p.colonia, p.ciudad].filter(Boolean).join(', ');
  return dir ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(dir) : '';
}

function dirEstrellas(n) {
  return n ? '<span class="dir-stars" title="Calificación ' + n + ' de 5">' + '★'.repeat(n) + '<span class="dir-stars-off">' + '★'.repeat(5 - n) + '</span></span>' : '';
}

function dirTarjetaHtml(p) {
  const tel = String(p.telefono || '').replace(/\D/g, '');
  const tel2 = String(p.telefono2 || '').replace(/\D/g, '');
  const mapa = dirMapaUrl(p);
  const direccion = [p.direccion, p.colonia, p.ciudad].filter(Boolean).map(escapeHtml).join(', ');
  const linea = (etq, v) => v ? `<div class="dir-line"><span>${etq}</span>${v}</div>` : '';
  return `
    <div class="dir-card">
      <div class="dir-head">
        <div>
          <div class="dir-name">${escapeHtml(p.name)} ${dirEstrellas(p.calificacion)}</div>
          <div class="dir-sub"><span class="dir-tipo">${escapeHtml(p.tipo)}</span>${p.empresa ? ' · ' + escapeHtml(p.empresa) : ''}</div>
        </div>
        <button class="btn-ghost-sm" onclick="openDirModal('${p.origen}', ${Number(p.id)})">Editar</button>
      </div>
      ${tel ? `<div class="dir-line"><span>Tel.</span><a href="tel:${tel}">${escapeHtml(p.telefono)}</a> · <a href="https://wa.me/${waPhone(tel)}" target="_blank" rel="noopener">WhatsApp</a></div>` : ''}
      ${tel2 ? `<div class="dir-line"><span>Tel. 2</span><a href="tel:${tel2}">${escapeHtml(p.telefono2)}</a></div>` : ''}
      ${p.email ? `<div class="dir-line"><span>Correo</span><a href="mailto:${escapeHtml(p.email)}">${escapeHtml(p.email)}</a></div>` : ''}
      ${linea('Dónde', direccion)}
      ${linea('Referencias', p.referencias ? escapeHtml(p.referencias) : '')}
      ${mapa ? `<div class="dir-line"><span></span><a href="${escapeHtml(mapa)}" target="_blank" rel="noopener">📍 Ver en el mapa</a></div>` : ''}
      ${linea('Tarifa', p.tarifa ? escapeHtml(p.tarifa) : '')}
      ${linea('Notas', p.notas ? escapeHtml(p.notas) : '')}
    </div>`;
}

function renderDirectorio(soloLista) {
  const todos = dirTodos();
  const q = dirNorm(dirBusqueda).trim();
  const palabras = q ? q.split(/\s+/) : [];

  if (!soloLista) {
    const conteo = {};
    todos.forEach(p => { conteo[p.tipo] = (conteo[p.tipo] || 0) + 1; });
    const tipos = Object.keys(conteo).sort((a, b) => a === 'Cliente' ? -1 : b === 'Cliente' ? 1 : a.localeCompare(b, 'es'));
    document.getElementById('dirChips').innerHTML = tipos.map(t =>
      `<button class="catalog-group${dirFiltroTipo === t ? ' active' : ''}" data-tipo="${escapeHtml(t)}" onclick="setDirTipo(this.dataset.tipo)">${escapeHtml(t)} <span class="count">${conteo[t]}</span></button>`
    ).join('');
    document.getElementById('dirTiposList').innerHTML = DIR_TIPOS.map(t => `<option value="${escapeHtml(t)}">`).join('');
  }

  const visibles = todos.filter(p =>
    (!dirFiltroTipo || p.tipo === dirFiltroTipo) &&
    palabras.every(w => dirTextoBusqueda(p).includes(w)));

  document.getElementById('dirCount').textContent = visibles.length === todos.length
    ? todos.length + ' en total'
    : visibles.length + ' de ' + todos.length;
  document.getElementById('dirList').innerHTML = visibles.length
    ? visibles.map(dirTarjetaHtml).join('')
    : `<div class="empty-state">${todos.length ? 'Nada coincide con esa búsqueda.' : 'Aún no hay nadie en el directorio. Agrega al primero con "+ Nuevo contacto".'}</div>`;
}

// ---------- Alta / edición ----------
const DIR_CAMPOS = [
  ['dirNombre', 'name'], ['dirTipo', 'tipo'], ['dirEmpresa', 'empresa'], ['dirTelefono', 'telefono'],
  ['dirTelefono2', 'telefono2'], ['dirEmail', 'email'], ['dirDireccion', 'direccion'], ['dirColonia', 'colonia'],
  ['dirCiudad', 'ciudad'], ['dirReferencias', 'referencias'], ['dirMaps', 'maps_link'], ['dirTarifa', 'tarifa'],
  ['dirCalificacion', 'calificacion'], ['dirNotas', 'notas'],
];

function openDirModal(origen, id) {
  dirModalOrigen = origen;
  dirModalId = id || null;
  const lista = origen === 'clientes' ? (window.__clientesCache || []) : (window.__directorioCache || []);
  const p = id ? lista.find(x => x.id === id) : null;
  DIR_CAMPOS.forEach(([el, campo]) => {
    document.getElementById(el).value = p && p[campo] != null ? p[campo] : '';
  });
  if (!p && origen === 'directorio') document.getElementById('dirTipo').value = dirFiltroTipo && dirFiltroTipo !== 'Cliente' ? dirFiltroTipo : '';
  const esCliente = origen === 'clientes';
  document.querySelectorAll('#dirModal .solo-oficio').forEach(e => e.classList.toggle('hidden', esCliente));
  document.getElementById('dirModalTitle').textContent = esCliente
    ? (p ? 'Editar cliente' : 'Nuevo cliente')
    : (p ? 'Editar contacto' : 'Nuevo contacto');
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
    maps_link: v('dirMaps') || null,
    notas: v('dirNotas') || null,
  };
  if (base.maps_link && !/^https?:\/\//i.test(base.maps_link)) { showToast('El enlace del mapa debe empezar con http:// o https://'); return; }

  let ok;
  if (dirModalOrigen === 'clientes') {
    ok = dirModalId ? await sbUpdate('clientes', dirModalId, base) : await sbInsert('clientes', base);
  } else {
    const fila = Object.assign(base, {
      tipo: v('dirTipo') || 'Otro',
      empresa: v('dirEmpresa') || null,
      telefono2: v('dirTelefono2') || null,
      tarifa: v('dirTarifa') || null,
      calificacion: parseInt(document.getElementById('dirCalificacion').value, 10) || null,
    });
    if (fila.tipo.toLowerCase() === 'cliente') { showToast('Los clientes se agregan con "+ Nuevo cliente"'); return; }
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
  const cols = [['Tipo', 'tipo'], ['Nombre', 'name'], ['Empresa', 'empresa'], ['Teléfono', 'telefono'], ['Teléfono 2', 'telefono2'],
    ['Correo', 'email'], ['Calle y número', 'direccion'], ['Colonia', 'colonia'], ['Ciudad', 'ciudad'], ['Referencias', 'referencias'],
    ['Mapa', 'maps_link'], ['Tarifa', 'tarifa'], ['Calificación', 'calificacion'], ['Notas', 'notas']];
  const esc = x => '"' + String(x == null ? '' : x).replace(/"/g, '""') + '"';
  // Evita que una celda que empiece como fórmula (=, @, o +/- seguido de letra) se ejecute en Excel;
  // un teléfono como +52 55… no se toca.
  const seguro = x => /^[=@]|^[+\-]\s*[^\d\s]/.test(String(x == null ? '' : x)) ? "'" + x : x;
  const filas = [cols.map(c => esc(c[0])).join(',')].concat(
    dirTodos().map(p => cols.map(c => esc(seguro(p[c[1]]))).join(',')));
  const blob = new Blob(['﻿' + filas.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'directorio-spazio-luce.csv';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
