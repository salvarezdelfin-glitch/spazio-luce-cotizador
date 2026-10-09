// Prospectos: gente nueva a la que queremos contratar (albañiles, electricistas,
// instaladores, proveedores…). Seguimiento por etapas; al contratarlos pasan al
// Directorio con su tarifa. Los prospectos vivos también aparecen en "Comparar
// precios" (js/directorio.js). Tabla `prospectos`.

const PROS_ESTATUS = ['Por contactar', 'Contactado', 'Entrevista', 'Prueba', 'Contratado', 'Descartado'];
const PROS_FUENTES = ['Portal del Empleo', 'Secretaría del Trabajo', 'Facebook', 'Computrabajo / OCC', 'Referido',
  'Proveedor', 'Ferretería', 'Cliente', 'Cronoshare', 'Otro'];
let prosFiltro = '';
let prosModalId = null;

function prosVivo(p) { return p.estatus !== 'Contratado' && p.estatus !== 'Descartado'; }
function prosVencido(p) {
  return prosVivo(p) && p.seguimiento && p.seguimiento <= todayForDateInput();
}

// Pestaña con aviso de cuántos seguimientos ya tocan.
function prosActualizarAviso() {
  const n = (window.__prospectosCache || []).filter(prosVencido).length;
  const tab = document.getElementById('dirTab-prospectos');
  if (tab) tab.innerHTML = 'Prospectos' + (n ? ` <span class="count dir-aviso">${n} por atender</span>` : '');
}

function setProsFiltro(e) {
  prosFiltro = prosFiltro === e ? '' : e;
  renderProspectos();
}

function prosOrden(a, b) {
  // Vivos primero (los de seguimiento más próximo arriba), luego contratados y descartados.
  const rango = p => prosVivo(p) ? 0 : p.estatus === 'Contratado' ? 1 : 2;
  if (rango(a) !== rango(b)) return rango(a) - rango(b);
  const fa = a.seguimiento || '9999', fb = b.seguimiento || '9999';
  return fa.localeCompare(fb) || String(a.name).localeCompare(String(b.name), 'es');
}

function prosTarjetaHtml(p) {
  const tel = String(p.telefono || '').replace(/\D/g, '');
  const linea = (etq, v) => v ? `<div class="dir-line"><span>${etq}</span>${v}</div>` : '';
  const tarifa = p.tarifa_monto != null && p.tarifa_monto !== ''
    ? `<b>${fmtMoney(p.tarifa_monto)}${p.tarifa_unidad ? ' por ' + escapeHtml(p.tarifa_unidad) : ''}</b>` : '';
  const seg = p.seguimiento
    ? `${fmtFechaCorta(p.seguimiento)}${prosVencido(p) ? ' <span class="pill-seguir">· ya toca</span>' : ''}` : '';
  return `
    <div class="dir-card">
      <div class="dir-head">
        <div>
          <div class="dir-name">${escapeHtml(p.name)}</div>
          <div class="dir-sub"><span class="dir-tipo">${escapeHtml(p.oficio)}</span></div>
        </div>
        <button class="btn-ghost-sm" onclick="openProsModal(${Number(p.id)})">Editar</button>
      </div>
      <div class="dir-line"><span>Etapa</span>
        <select class="estatus-select pros-estatus" onchange="cambiarProsEstatus(${Number(p.id)}, this.value)">
          ${PROS_ESTATUS.map(e => `<option${e === p.estatus ? ' selected' : ''}>${e}</option>`).join('')}
        </select></div>
      ${tel ? `<div class="dir-line"><span>Tel.</span><a href="tel:${tel}">${escapeHtml(p.telefono)}</a> · <a href="https://wa.me/${waPhone(tel)}" target="_blank" rel="noopener">WhatsApp</a></div>` : ''}
      ${linea('Zona', p.zona ? escapeHtml(p.zona) : '')}
      ${linea('Lo encontré en', p.fuente ? escapeHtml(p.fuente) : '')}
      ${linea('Seguimiento', seg)}
      ${linea('Pide', tarifa)}
      ${linea('Notas', p.notas ? escapeHtml(p.notas) : '')}
      ${prosVivo(p) ? `<button class="btn-accent-sm" style="width:auto;margin-top:10px;" onclick="contratarProspecto(${Number(p.id)})">✓ Contratar y pasar al Directorio</button>` : ''}
    </div>`;
}

function renderProspectos() {
  const todos = (window.__prospectosCache || []).slice().sort(prosOrden);
  prosActualizarAviso();
  const conteo = {};
  todos.forEach(p => { conteo[p.estatus] = (conteo[p.estatus] || 0) + 1; });
  document.getElementById('prosChips').innerHTML = PROS_ESTATUS.map(e =>
    `<button class="catalog-group${prosFiltro === e ? ' active' : ''}" onclick="setProsFiltro('${e}')">${e} <span class="count">${conteo[e] || 0}</span></button>`
  ).join('');
  const visibles = todos.filter(p => !prosFiltro || p.estatus === prosFiltro);
  document.getElementById('prosList').innerHTML = visibles.length
    ? visibles.map(prosTarjetaHtml).join('')
    : `<div class="empty-state">${todos.length ? 'No hay prospectos en esa etapa.' : 'Aún no hay prospectos. Agrega a la primera persona que quieras contratar con "+ Nuevo prospecto".'}</div>`;
}

async function cambiarProsEstatus(id, estatus) {
  if (!PROS_ESTATUS.includes(estatus)) return;
  if (!(await sbUpdate('prospectos', id, { estatus }))) { showToast('No se pudo actualizar, revisa tu conexión'); return; }
  const p = (window.__prospectosCache || []).find(x => x.id === id);
  if (p) p.estatus = estatus;
  renderProspectos();
}

// ---------- Alta / edición ----------
const PROS_CAMPOS = [
  ['prosNombre', 'name'], ['prosOficio', 'oficio'], ['prosTelefono', 'telefono'], ['prosZona', 'zona'],
  ['prosFuente', 'fuente'], ['prosEstatus', 'estatus'], ['prosSeguimiento', 'seguimiento'],
  ['prosTarifaMonto', 'tarifa_monto'], ['prosTarifaUnidad', 'tarifa_unidad'], ['prosNotas', 'notas'],
];

function openProsModal(id) {
  prosModalId = id || null;
  const p = id ? (window.__prospectosCache || []).find(x => x.id === id) : null;
  document.getElementById('prosEstatus').innerHTML = PROS_ESTATUS.map(e => `<option>${e}</option>`).join('');
  document.getElementById('prosFuentesList').innerHTML = PROS_FUENTES.map(f => `<option value="${f}">`).join('');
  document.getElementById('prosTarifaUnidad').innerHTML = dirUnidadesHtml;
  PROS_CAMPOS.forEach(([el, campo]) => {
    document.getElementById(el).value = p && p[campo] != null ? p[campo] : '';
  });
  if (!p) document.getElementById('prosEstatus').value = 'Por contactar';
  document.getElementById('prosModalTitle').textContent = p ? 'Editar prospecto' : 'Nuevo prospecto';
  document.getElementById('prosBorrarBtn').classList.toggle('hidden', !p);
  document.getElementById('prosModal').classList.remove('hidden');
  document.getElementById('prosNombre').focus();
}

function closeProsModal() {
  document.getElementById('prosModal').classList.add('hidden');
  prosModalId = null;
}

async function saveProspecto() {
  await runWithButtonLock('prosGuardarBtn', saveProspectoImpl);
}

async function saveProspectoImpl() {
  const v = id => document.getElementById(id).value.trim();
  const name = v('prosNombre');
  if (!name) { showToast('Escribe el nombre'); return; }
  const monto = v('prosTarifaMonto') === '' ? null : Math.max(0, parseFloat(v('prosTarifaMonto')) || 0);
  const unidad = v('prosTarifaUnidad') || null;
  if (monto != null && !unidad) { showToast('Elige la unidad del precio (por día, por m²…)'); return; }
  const fila = {
    name,
    oficio: v('prosOficio') || 'Otro',
    telefono: v('prosTelefono') || null,
    zona: v('prosZona') || null,
    fuente: v('prosFuente') || null,
    estatus: PROS_ESTATUS.includes(v('prosEstatus')) ? v('prosEstatus') : 'Por contactar',
    seguimiento: v('prosSeguimiento') || null,
    tarifa_monto: monto,
    tarifa_unidad: monto != null ? unidad : null,
    notas: v('prosNotas') || null,
  };
  const ok = prosModalId ? await sbUpdate('prospectos', prosModalId, fila) : await sbInsert('prospectos', fila);
  if (!ok) { showToast('No se pudo guardar, revisa tu conexión'); return; }
  showToast('Prospecto guardado');
  closeProsModal();
  await prepareDirectorio();
}

async function borrarProspecto() {
  if (!prosModalId) return;
  const p = (window.__prospectosCache || []).find(x => x.id === prosModalId);
  if (!confirm('¿Eliminar a ' + (p ? p.name : 'este prospecto') + '? No se puede deshacer. Si solo no te sirvió, mejor ponlo en "Descartado".')) return;
  if (!(await sbDelete('prospectos', prosModalId))) { showToast('No se pudo eliminar, revisa tu conexión'); return; }
  showToast('Prospecto eliminado');
  closeProsModal();
  await prepareDirectorio();
}

// Contratar: crea la ficha en el Directorio (con su tarifa) y marca al prospecto como contratado.
async function contratarProspecto(id) {
  const p = (window.__prospectosCache || []).find(x => x.id === id);
  if (!p || !prosVivo(p)) return;
  if (!confirm('¿Contratar a ' + p.name + ' y pasarlo al Directorio?')) return;
  const notas = ['Contratado desde prospectos.' + (p.fuente ? ' Fuente: ' + p.fuente + '.' : ''), p.notas].filter(Boolean).join(' ');
  const creado = await sbInsert('directorio', {
    name: p.name,
    tipo: p.oficio,
    telefono: p.telefono || null,
    colonia: p.zona || null,
    tarifa_monto: p.tarifa_monto != null ? p.tarifa_monto : null,
    tarifa_unidad: p.tarifa_unidad || null,
    notas,
  });
  if (!creado) { showToast('No se pudo pasar al Directorio, revisa tu conexión'); return; }
  if (!(await sbUpdate('prospectos', id, { estatus: 'Contratado' }))) {
    showToast('Quedó en el Directorio, pero revisa su etapa en Prospectos');
  } else {
    showToast(p.name + ' ya está en el Directorio');
  }
  await prepareDirectorio();
}
