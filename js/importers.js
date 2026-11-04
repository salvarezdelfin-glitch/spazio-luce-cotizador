// Lectura y parseo de PDF/Excel compartido por el Cotizador y Presupuestos.
// Todo el "entender el documento" vive aquí, una sola vez: cada vista solo
// decide qué hacer con las filas que salen (addProductRow o addPresuRow).
// Antes cada vista tenía su propia copia y los arreglos se hacían en una sola.
// Una fila interpretada es { name, qty, price, unit, section }.

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


// Separa del texto que va antes del primer monto la cantidad y la unidad, en
// cualquiera de los dos órdenes reales ("PZA 3" o "15 m2"). Cada patrón exige
// que el número sea un token completo (inicio de texto o espacio antes): sin
// eso, un código de modelo como "A19" o "MS40" se leía como cantidad 19/40 y
// cortaba el nombre del producto.
function splitQtyUnit(before) {
  const isUnit = w => KNOWN_UNITS.includes(w.toLowerCase().replace(/\./g, ''));
  let m = before.match(/(?:^|\s)(\S+)\s+(\d+(?:\.\d+)?)\s*$/);
  if (m && isUnit(m[1])) return { name: before.slice(0, m.index).trim(), qty: parseFloat(m[2]), unit: m[1] };
  m = before.match(/(?:^|\s)(\d+(?:\.\d+)?)\s+(\S+)\s*$/);
  if (m && isUnit(m[2])) return { name: before.slice(0, m.index).trim(), qty: parseFloat(m[1]), unit: m[2] };
  m = before.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*$/);
  if (m) return { name: before.slice(0, m.index).trim(), qty: parseFloat(m[1]), unit: '' };
  return { name: before, qty: 1, unit: '' };
}

// Lee un PDF y lo devuelve como páginas de renglones de texto (de arriba hacia
// abajo). Los PDFs no tienen columnas reales: se reconstruye cada renglón
// agrupando los fragmentos de texto por posición Y (con tolerancia).
async function readPdfPages(file) {
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const content = await (await pdf.getPage(p)).getTextContent();
    const rowsByY = {};
    content.items
      .map(it => ({ text: it.str, x: it.transform[4], y: Math.round(it.transform[5] / 3) * 3 }))
      .filter(it => it.text.trim())
      .forEach(it => { (rowsByY[it.y] = rowsByY[it.y] || []).push(it); });
    const lines = Object.keys(rowsByY).map(Number).sort((a, b) => b - a)
      .map(y => rowsByY[y].sort((a, b) => a.x - b.x).map(r => r.text).join(' ').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    pages.push(lines);
  }
  return pages;
}

// Convierte los renglones de un PDF en filas. Es "mejor esfuerzo": siempre puede
// haber errores, por eso las filas quedan editables antes de generar.
// fullText se devuelve para que quien lo quiera lea folio/cliente/fecha.
function parsePdfPages(pages) {
  if (esPdfDeProveedor(pages)) return parsePdfProveedor(pages);
  const rows = [];
  const allLines = [];
  let section = '';
  let pending = '';

  pages.forEach(lines => {
    pending = '';
    lines.forEach(lineText => {
      allLines.push(lineText);

      if (looksLikeSectionHeader(lineText)) { section = lineText; pending = ''; return; }

      // Total del propio documento: la app ya recalcula el total sola, importarlo
      // como renglón duplicaría el importe real.
      if (/^\s*(SUMA|SUB\s*-?\s*TOTAL|GRAN\s*TOTAL|TOTAL)\b/i.test(lineText)) { pending = ''; return; }

      const money = [...lineText.matchAll(/\$\s*([\d,]+\.\d{2})/g)];
      if (money.length === 0) {
        // Número de fila suelto (" 2", " 3"...): no aporta nada.
        if (/^\d+$/.test(lineText)) return;
        // Encabezado de la tabla o datos del documento: no son parte de un concepto.
        if (/\b(CONCEPTO|DESCRIPCI[OÓ]N)\b.*\b(CANT|P\.?\s?U|IMPORTE|PRECIO)/i.test(lineText)) { pending = ''; return; }
        if (/^(CLIENTE|FOLIO|FECHA|OBRA|PROYECTO|DIRECCI[OÓ]N|NOTA)\b\s*[:\/]/i.test(lineText)) return;
        // Un concepto largo envuelve en 2-3 líneas y solo la última trae
        // UN/CANT/PRECIO: esta línea es el inicio real del nombre, se pega a la
        // siguiente línea que sí traiga precio.
        pending = (pending + ' ' + lineText).trim().slice(-300);
        return;
      }

      const amounts = money.map(m => parseFloat(m[1].replace(/,/g, '')));
      const before = lineText.slice(0, lineText.indexOf(money[0][0])).trim();
      const { name: rest, qty, unit } = splitQtyUnit(before);
      const name = (pending + ' ' + rest).trim().replace(/^\d+\s+/, '').trim();   // sin el número de renglón del documento
      pending = '';
      if (!name || name.length < 3) return;

      // Con dos montos es la tabla real P.U. / Importe: el primero es el precio
      // unitario exacto. Con uno solo, ese monto YA es el importe de la partida
      // (ej. "PISO BASE 15 m² $10,200.00"); tratarlo como P.U. y multiplicarlo
      // por la cantidad lo inflaba (15 x $10,200 en vez de $10,200).
      const price = amounts.length >= 2 ? amounts[0] : (qty > 0 ? round2(amounts[0] / qty) : amounts[0]);
      rows.push({ name, qty, price, unit, section });
    });
  });

  // Sin "$" ni encabezado de proveedor (p. ej. una foto de una tabla con medidas): lector genérico.
  if (!rows.length) {
    const genericas = parseLineasGenericas(allLines);
    if (genericas.length) return { rows: genericas, fullText: allLines.join('\n') };
  }
  return { rows, fullText: allLines.join('\n') };
}

// ---------------------------------------------------------------------------
// Cotización de PROVEEDOR (sin signo "$"): tabla  ARTICULO | UNIDADES | P. U. | % DST. | IMPORTE
// (p. ej. las de cortinas y persianas: secciones "CORTINA OPC. 2", "ARTICULOS EXTRAS",
// "PERSIANAS OPC. 2"). Cada renglón trae al final  P.U.  %Dst  Importe; antes o después
// vienen detalles sueltos (Ancho/Alto, Hojas, Color…) que se pegan al concepto.
// Los códigos internos del proveedor (ZZTR, ZZCA, ZZPM) se quitan del nombre.
// ---------------------------------------------------------------------------
const RE_ENCABEZADO_PROVEEDOR = /\bARTICULO\b.*\b(IMPORTE|P\.?\s?U\.?)\b/i;
function esPdfDeProveedor(pages) {
  return pages.some(lines => lines.some(t => RE_ENCABEZADO_PROVEEDOR.test(t)));
}

const num2 = s => parseFloat(String(s).replace(/,/g, ''));

// Saca del principio de la línea los detalles que el PDF imprime a la izquierda del artículo.
function extraerDetallesIzquierda(texto) {
  const detalles = [];
  let t = texto;
  let m;
  for (let guard = 0; guard < 6; guard++) {
    if ((m = t.match(/^Ancho:\s*([\d.]+)\s+Alto:\s*([\d.]+)\s+/i))) { detalles.push('ancho ' + m[1] + ' × alto ' + m[2] + ' m'); }
    else if ((m = t.match(/^Hojas:\s*(\d+)\s+Apertura:\s*(\S+)\s+/i))) { detalles.push(m[1] + ' hojas, apertura ' + m[2].toLowerCase()); }
    else if ((m = t.match(/^Confecci[oó]n:\s*(\S+)\s+/i))) { detalles.push('confección ' + m[1].toLowerCase()); }
    else if ((m = t.match(/^Instalaci[oó]n:\s*(.+?)\s+(?=ZZ[A-Z]{2}\b)/i)) || (m = t.match(/^Instalaci[oó]n:\s*(\S+(?:\s+\S+)?)\s+/i))) { detalles.push('instalación ' + m[1].toLowerCase()); }
    else break;
    t = t.slice(m[0].length);
  }
  return { detalles, resto: t.trim() };
}

function limpiarNombreProveedor(nombre) {
  return nombre.replace(/^ZZ[A-Z]{2}\s+/, '').replace(/\s{2,}/g, ' ').trim();
}

function parsePdfProveedor(pages) {
  const rows = [];
  const allLines = [];
  const notas = [];
  let section = '';
  let ultima = null; // última fila: a ella se pegan los renglones de detalle que siguen

  pages.forEach(lines => {
    ultima = null; // una página nueva (términos y condiciones, etc.) no continúa la tabla
    lines.forEach((linea, idx) => {
      allLines.push(linea);
      const t = linea.trim();

      // Encabezado de tabla: "CORTINA OPC. 2 * ARTICULO UNIDADES P. U. % DST. IMPORTE" → la sección es lo que va antes.
      if (RE_ENCABEZADO_PROVEEDOR.test(t)) {
        const titulo = t.split(/\bARTICULO\b/i)[0].replace(/[*\s]+$/, '').trim();
        if (titulo) section = titulo;
        ultima = null;
        return;
      }
      // Totales del propio documento (la app recalcula): no son renglones.
      if (/^(TOTAL|SUBTOTAL|SUB\s*-?\s*TOTAL|I\.?V\.?A\.?)\b/i.test(t)) { ultima = null; return; }
      // Notas del proveedor ("* 2 CORT. A TECHO…") → se juntan para el campo Nota.
      if (/^\*\s*\S/.test(t)) {
        notas.push(t.replace(/^\*\s*/, ''));
        const sig = (lines[idx + 1] || '').trim();
        if (/^[A-ZÁÉÍÓÚÑ ,.]{4,60}$/.test(sig) && !/^TOTAL/i.test(sig)) notas.push(sig);
        ultima = null;
        return;
      }

      // Renglón con montos: termina en  P.U.  %Dst  Importe.
      const fin = t.match(/^(.*?)\s+([\d,]+\.\d{2})\s+(\d{1,3}(?:\.\d{1,2})?)\s+([\d,]+\.\d{2})$/);
      if (fin) {
        const pu = num2(fin[2]);
        const importe = num2(fin[4]);
        const { detalles, resto } = extraerDetallesIzquierda(fin[1]);
        let nombre, qty, area = null, extra = '';

        // Persianas: "NOMBRE  UDS  ÁREA  TECHO IZQUIERDO SI"
        const pers = resto.match(/^(.*?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+([A-ZÁÉÍÓÚÑ]+(?:\s+[A-ZÁÉÍÓÚÑ]+)*)$/);
        if (pers) {
          nombre = pers[1]; qty = parseFloat(pers[2]); area = pers[3]; extra = pers[4];
        } else {
          const sp = splitQtyUnit(resto);
          nombre = sp.name; qty = sp.qty;
        }
        nombre = limpiarNombreProveedor(nombre);
        if (!nombre || nombre.length < 3) return;
        if (!(qty > 0)) qty = 1;
        if (area) detalles.push('área ' + area + ' m²');
        if (extra) {
          // "TECHO IZQUIERDO SI" = instalación, lado del mando y si lleva soporte
          const e = extra.toLowerCase().match(/^(\S+)\s+(\S+)\s+(si|sí|no)$/);
          if (e) detalles.push('instalación ' + e[1], 'mando ' + e[2], (e[3] === 'no' ? 'sin' : 'con') + ' soporte');
          else detalles.push(extra.toLowerCase());
        }

        // Si cantidad × P.U. coincide con el importe, ese es el precio; si no (persianas, donde el
        // importe sale de área × precio), se saca el unitario del importe para que el total quede igual.
        const coincide = Math.abs(qty * pu - importe) <= Math.max(0.05, importe * 0.002);
        const price = coincide ? pu : round2(importe / qty);

        ultima = { name: nombre, qty, price, unit: '', section, detalles };
        rows.push(ultima);
        return;
      }

      // Renglón de detalle sin montos: pertenece al renglón de arriba.
      if (ultima && t.length <= 80) {
        let m;
        if ((m = t.match(/^Color:\s*(.+)$/i))) { ultima.detalles.push('color ' + m[1].toLowerCase()); return; }
        if (/^[A-Za-zÁÉÍÓÚÑáéíóúñ]+:\s*\S/.test(t)) { ultima.detalles.push(t.replace(/:\s*/, ' ').toLowerCase()); return; }
        const texto = t.replace(/\.$/, '');
        ultima.name += (/^DE\s/i.test(texto) ? ' ' : ' — ') + texto;
        return;
      }

      // Título de sección suelto ("CORTINAS", "ARTICULOS EXTRAS", "PERSIANAS").
      if (looksLikeSectionHeader(t)) { section = t; ultima = null; }
    });
  });

  // Los detalles se escriben entre paréntesis al final del concepto.
  rows.forEach(r => {
    if (r.detalles.length) r.name += ' (' + r.detalles.join(', ') + ')';
    delete r.detalles;
  });
  return { rows, fullText: allLines.join('\n'), esProveedor: true, nota: notas.join(' ').slice(0, 300) };
}

async function readSheetRows(file) {
  const workbook = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: false });
}

// Convierte las filas de una hoja de Excel en filas de concepto. Un documento
// real casi siempre trae 2-4 filas de título arriba (negocio, cliente, fecha)
// antes de la fila real de encabezados, así que se busca la fila que de verdad
// tiene cara de encabezado en vez de asumir que es la primera.
function parseSheetRows(raw) {
  if (!raw.length) return { rows: [], folio: '' };
  const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

  let headerIdx = raw.findIndex(r =>
    r.some(c => /concepto|producto|nombre|descripcion|articulo/.test(norm(c))) &&
    r.some(c => /cant|unidades|uds|precio|importe|p\.?\s?u\b/.test(norm(c)))
  );
  if (headerIdx === -1) headerIdx = 0;

  const header = raw[headerIdx].map(norm);
  const find = test => header.findIndex(test);
  const col = {
    name: find(k => /concepto|producto|nombre|descripcion|articulo/.test(k)),
    qty: find(k => k.includes('cant') || k === 'unidades' || k === 'uds'),
    price: find(k => k.includes('precio') || k.includes('unitario') || /^p\.?\s?u\.?$/.test(k)),
    importe: find(k => k.includes('importe') || k === 'total'),
    unit: find(k => k.replace(/\./g, '') === 'un' || k.includes('unidad')),
    section: find(k => /seccion|categoria|partida/.test(k) || k.replace(/\./g, '') === 'part'),
    folio: find(k => k.includes('folio')),
  };
  const num = v => parseFloat(String(v).replace(/[^0-9.\-]/g, '')) || 0;

  const rows = [];
  let folio = '';
  let currentSection = '';
  for (let i = headerIdx + 1; i < raw.length; i++) {
    const r = raw[i];
    const filled = r.filter(c => String(c).trim() !== '');
    if (filled.length === 0) continue;

    // Fila de SUMA/TOTAL del propio documento: no es un concepto.
    if (filled.some(c => /^(SUMA|SUB\s*-?\s*TOTAL|GRAN\s*TOTAL|TOTAL)$/i.test(String(c).trim()))) continue;
    // "TOTAL DE CORTINA OPC. 2", "SUBTOTAL: …", "I.V.A." en la primera celda: totales del proveedor, no conceptos.
    if (/^(TOTAL|SUB\s*-?\s*TOTAL|I\.?V\.?A\.?)\b/i.test(String(filled[0]).trim())) continue;

    // Una sola celda de texto (sin precio ni cantidad) = encabezado de sección, o un detalle del
    // renglón de arriba ("Color: IVORY", "CORTINA CON FALSOS.") que se pega a ese concepto.
    if (filled.length === 1 && typeof filled[0] === 'string' && !/^[\d.,$\s-]+$/.test(filled[0])) {
      const texto = String(filled[0]).trim();
      if (rows.length && /:/.test(texto) && texto.length <= 80) {
        rows[rows.length - 1].name += ' (' + texto.replace(/:\s*/, ' ').toLowerCase() + ')';
      } else if (rows.length && /\.$/.test(texto) && texto.length <= 80) {
        rows[rows.length - 1].name += ' — ' + texto.replace(/\.$/, '');
      } else {
        currentSection = texto;
      }
      continue;
    }

    const name = col.name >= 0 ? String(r[col.name] || '').trim() : '';
    if (!name) continue;
    const qty = col.qty >= 0 ? (parseFloat(r[col.qty]) || 1) : 1;
    let price = col.price >= 0 ? num(r[col.price]) : 0;
    // Sin columna de P.U. pero con Importe: ese monto es el total de la fila,
    // el unitario se calcula en reversa para no inflarlo al multiplicar.
    if (col.price < 0 && col.importe >= 0) {
      const importe = num(r[col.importe]);
      price = qty > 0 ? round2(importe / qty) : importe;
    } else if (col.price >= 0 && col.importe >= 0) {
      const importe = num(r[col.importe]);
      if (importe > 0 && qty > 0 && Math.abs(qty * price - importe) > Math.max(0.05, importe * 0.002)) price = round2(importe / qty);
    }
    if (col.folio >= 0 && !folio && r[col.folio]) folio = String(r[col.folio]).trim();
    rows.push({
      name: name.replace(/^ZZ[A-Z]{2}\s+/, ''), qty, price,
      unit: col.unit >= 0 ? String(r[col.unit] || '').trim() : '',
      section: col.section >= 0 ? String(r[col.section] || '').trim() : currentSection,
    });
  }
  return { rows, folio };
}

// ---------------------------------------------------------------------------
// Formato de Excel de Spazio Luce (assets/Formato-Spazio-Luce.xlsx): arriba los datos del
// cliente (CLIENTE, PROYECTO, TELÉFONO O CORREO, FOLIO, FECHA, NOTA), luego la tabla
// SECCIÓN | CONCEPTO | UN | CANT. | P. UNITARIO | IMPORTE y, en la hoja "Condiciones",
// una condición por renglón. También sirve cualquier Excel con encabezados parecidos.
// ---------------------------------------------------------------------------
function fechaDeCelda(v) {
  if (!v) return '';
  const dos = n => String(n).padStart(2, '0');
  if (v instanceof Date && !isNaN(v)) return v.getFullYear() + '-' + dos(v.getMonth() + 1) + '-' + dos(v.getDate());
  if (typeof v === 'number' && window.XLSX && XLSX.SSF) {
    const d = XLSX.SSF.parse_date_code(v);
    return d ? d.y + '-' + dos(d.m) + '-' + dos(d.d) : '';
  }
  const m = String(v).trim().match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) return (m[3].length === 2 ? '20' + m[3] : m[3]) + '-' + dos(m[2]) + '-' + dos(m[1]);
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v).trim()) ? String(v).trim() : '';
}

// Datos sueltos de arriba de la tabla ("CLIENTE | Fulana"), hasta la fila de encabezados.
function parseExcelMeta(raw) {
  const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const meta = {};
  for (const r of raw) {
    const celdas = r.map(norm);
    if (celdas.some(c => /concepto|articulo|producto/.test(c)) && celdas.some(c => /cant|unidades|uds/.test(c))) break;
    const idx = r.findIndex(c => String(c).trim() !== '');
    if (idx === -1) continue;
    const etiqueta = norm(r[idx]);
    const valor = r.slice(idx + 1).find(c => String(c).trim() !== '' || c instanceof Date);
    if (valor === undefined) continue;
    if (/^cliente/.test(etiqueta)) meta.cliente = String(valor).trim();
    else if (/^(proyecto|direccion|obra)/.test(etiqueta)) meta.proyecto = String(valor).trim();
    else if (/^(telefono|correo|contacto)/.test(etiqueta)) meta.contacto = String(valor).trim();
    else if (/^folio/.test(etiqueta)) meta.folio = String(valor).trim();
    else if (/^fecha/.test(etiqueta)) meta.fecha = fechaDeCelda(valor);
    else if (/^nota/.test(etiqueta)) meta.nota = String(valor).trim();
  }
  return meta;
}

// Hoja "Condiciones": una condición por celda de texto (se saltan el título y las instrucciones).
function parseCondicionesHoja(wb) {
  const nombre = wb.SheetNames.find(n => /condicion/i.test(n));
  if (!nombre) return null;
  const raw = XLSX.utils.sheet_to_json(wb.Sheets[nombre], { header: 1, defval: '', blankrows: false });
  const lineas = [];
  raw.forEach(r => r.forEach(c => {
    const t = typeof c === 'string' ? c.trim() : '';
    if (t.length > 3 && !/^CONDICIONES QUE SALDR/i.test(t) && !/^Ya vienen? (la|las) de siempre/i.test(t)) lineas.push(t);
  }));
  return lineas;
}

// Lee el Excel completo: renglones + datos del cliente + condiciones.
async function leerExcelCompleto(file) {
  const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array', cellDates: true });
  const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', blankrows: false });
  const { rows, folio } = parseSheetRows(raw);
  return { rows, folio, meta: parseExcelMeta(raw), condiciones: parseCondicionesHoja(wb) };
}

// ---------------------------------------------------------------------------
// Lector genérico de renglones: sirve para texto sacado de una FOTO o captura (OCR) y para tablas
// sin "$". Cada renglón termina con números: [cantidad] [medidas…] [P. unitario] [Importe].
//   "1 ENROLLABLE BO LUXURY BEIGE 1 2.958 1.690 4.999 4.999 399.00 1,994.61"
//   → concepto "ENROLLABLE BO LUXURY BEIGE (ancho 2.958 × alto 1.690 m)", cantidad 1, precio 1,994.61
// Cuando cantidad × P.U. no cuadra con el importe (se cobra por m²), se respeta el importe.
// ---------------------------------------------------------------------------
function parseLineasGenericas(lineas) {
  const rows = [];
  const esNumero = tk => /^-?[\d,]*\.?\d+$/.test(tk) && /\d/.test(tk);
  const dosDecimales = tk => /^\d{1,3}(,\d{3})*\.\d{2}$|^\d+\.\d{2}$/.test(tk);
  const num = x => parseFloat(String(x).replace(/,/g, ''));
  lineas.forEach(crudo => {
    const t = String(crudo).replace(/[$|]/g, ' ').replace(/\b(\d{1,3})\.(\d{3})\.(\d{2})\b/g, '$1,$2.$3').replace(/\s+/g, ' ').trim();
    // Totales del documento (se aceptan errores de lectura como "SUBTITAL"): la app recalcula sola.
    if (!t || /^(SUMA|SUB\s*-?\s*T\w{1,4}L|GRAN\s*TOTAL|T[O0]TAL|DESCUENTO|I\.?V\.?A\.?)\b/i.test(t)) return;
    // el OCR a veces lee el punto decimal como guion ("4-099"): se corrige antes de buscar los números
    const tk = t.split(' ').map(x => x.replace(/^(\d+)[-–—](\d{2,3})$/, '$1.$2'));
    let ini = tk.length;                                                  // cola de números al final
    while (ini > 0 && (esNumero(tk[ini - 1]) || tk[ini - 1] === '-')) ini--;
    const cola = tk.slice(ini).filter(x => x !== '-');
    if (!cola.length || !dosDecimales(cola[cola.length - 1])) return;     // debe terminar en un importe con centavos
    let nombreTk = tk.slice(0, ini);
    if (nombreTk.length && /^\d{1,3}$/.test(nombreTk[0])) nombreTk = nombreTk.slice(1);   // número de renglón
    const nombre = nombreTk.join(' ').replace(/[^\p{L}\p{N}\s.,()\/&\-+"'º°²·]/gu, ' ').replace(/\s{2,}/g, ' ').trim();
    if (nombre.length < 3 || !/\p{L}{2}/u.test(nombre)) return;

    const importe = num(cola[cola.length - 1]);
    let pu = null, previos = cola.slice(0, -1);
    if (previos.length && dosDecimales(previos[previos.length - 1])) { pu = num(previos[previos.length - 1]); previos = previos.slice(0, -1); }
    let qty = 1;
    if (previos.length && /^\d+(\.\d{1,2})?$/.test(previos[0])) { qty = num(previos[0]); previos = previos.slice(1); }
    if (!(qty > 0)) qty = 1;
    const medidas = previos.filter(x => /^\d+\.\d{3}$/.test(x)).map(num);   // 3 decimales = medidas en metros
    const detalles = [];
    if (medidas.length >= 3 && medidas[0] < 20 && medidas[1] < 20 && Math.abs(medidas[0] * medidas[1] - medidas[2]) < 0.01) {
      detalles.push('ancho ' + medidas[0].toFixed(3) + ' × alto ' + medidas[1].toFixed(3) + ' m');   // ancho, alto y m² cuadran
    } else if (medidas.length === 2 && Math.abs(medidas[0] * qty - medidas[1]) < 0.01) {
      detalles.push('medida ' + medidas[0].toFixed(3) + ' m c/u');                                    // la segunda es el total (cantidad × medida)
    } else if (medidas.length === 2 && medidas[0] < 20 && medidas[1] < 20) {
      detalles.push('ancho ' + medidas[0].toFixed(3) + ' × alto ' + medidas[1].toFixed(3) + ' m');
    } else if (medidas.length) {
      detalles.push('medida ' + medidas.map(m => m.toFixed(3)).join(' / ') + ' m');
    }
    const coincide = pu != null && Math.abs(qty * pu - importe) <= Math.max(0.05, importe * 0.005);
    const price = coincide ? pu : round2(importe / qty);
    let unidad = '', nombreFinal = nombre;
    const ult = nombre.split(' ').pop();
    if (nombre.includes(' ') && KNOWN_UNITS.includes(ult.toLowerCase().replace(/\./g, ''))) { unidad = ult; nombreFinal = nombre.slice(0, nombre.length - ult.length).trim(); }
    rows.push({ name: nombreFinal + (detalles.length ? ' (' + detalles.join(', ') + ')' : ''), qty, price, unit: unidad, section: '' });
  });
  // Un renglón corto cuyo importe es la suma de los anteriores es un total mal leído, no un concepto.
  while (rows.length > 2) {
    const ultimo = rows[rows.length - 1];
    const sumaPrevios = rows.slice(0, -1).reduce((s, r) => s + r.qty * r.price, 0);
    if (ultimo.name.length < 14 && Math.abs(ultimo.qty * ultimo.price - sumaPrevios) < 1) rows.pop(); else break;
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Fotos y capturas (PNG, JPG): se lee el texto en el propio navegador (OCR con Tesseract.js, sin subir
// la imagen a ningún servidor; solo se descarga el lector la primera vez) y se pasa por los mismos lectores.
// ---------------------------------------------------------------------------
const TESSERACT_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.0/tesseract.min.js';
let cargandoTesseract = null;
function cargarTesseract() {
  if (window.Tesseract) return Promise.resolve();
  if (!cargandoTesseract) {
    cargandoTesseract = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = TESSERACT_SRC;
      s.onload = resolve;
      s.onerror = () => { cargandoTesseract = null; reject(new Error('No se pudo cargar el lector de imágenes')); };
      document.head.appendChild(s);
    });
  }
  return cargandoTesseract;
}

function esArchivoImagen(file) {
  return /^image\//.test(file.type) || /\.(png|jpe?g|webp|bmp)$/i.test(file.name);
}

// Prepara la imagen para el OCR: la agranda, la pasa a blanco y negro y borra las líneas de la tabla
// (bordes y cuadrícula), que son lo que más confunde al lector en las cotizaciones con celdas.
async function prepararImagenOcr(file) {
  const bmp = await createImageBitmap(file);
  const escala = Math.max(1, Math.min(3, 2400 / bmp.width));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * escala); c.height = Math.round(bmp.height * escala);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  const w = c.width, h = c.height;
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  const gris = new Uint8Array(w * h);
  const hist = new Array(256).fill(0);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) { const g = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]); gris[p] = g; hist[g]++; }
  // umbral de Otsu: separa el texto del fondo aunque la foto tenga más o menos luz
  let suma = 0; for (let t = 0; t < 256; t++) suma += t * hist[t];
  let sumB = 0, wB = 0, mejor = 0, umbral = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = w * h - wB; if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (suma - sumB) / wF;
    const varianza = wB * wF * (mB - mF) * (mB - mF);
    if (varianza > mejor) { mejor = varianza; umbral = t; }
  }
  umbral = Math.min(200, Math.max(90, umbral));
  const oscuro = p => gris[p] < umbral;
  // filas y columnas casi todas oscuras = líneas de la tabla
  const filas = new Uint8Array(h), cols = new Uint8Array(w);
  for (let y = 0; y < h; y++) { let n = 0; for (let x = 0; x < w; x++) if (oscuro(y * w + x)) n++; if (n > w * 0.4) filas[y] = 1; }
  for (let x = 0; x < w; x++) { let n = 0; for (let y = 0; y < h; y++) if (oscuro(y * w + x)) n++; if (n > h * 0.3) cols[x] = 1; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x;
    const linea = filas[y] || cols[x] || (y > 0 && filas[y - 1]) || (y < h - 1 && filas[y + 1]) || (x > 0 && cols[x - 1]) || (x < w - 1 && cols[x + 1]);
    const v = oscuro(p) && !linea ? 0 : 255;
    d[p * 4] = d[p * 4 + 1] = d[p * 4 + 2] = v; d[p * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// Elige el lector según lo que traiga el texto de una imagen: cotización de proveedor, tabla con números
// al final de cada renglón (la mayoría), o el lector de PDF con "$".
function parseLineasImagen(lineas) {
  if (esPdfDeProveedor([lineas])) return parsePdfProveedor([lineas]);
  const genericas = parseLineasGenericas(lineas);
  if (genericas.length) return { rows: genericas, fullText: lineas.join('\n') };
  return parsePdfPages([lineas]);
}

// Lee la imagen y devuelve los renglones de texto. Prueba varios modos de lectura (por renglones, por
// columnas, disperso) y se queda con el primero que encuentre renglones con precio.
async function leerImagenLineas(file, progreso) {
  await cargarTesseract();
  const lienzo = await prepararImagenOcr(file);
  const worker = await Tesseract.createWorker('spa', 1, {
    logger: m => { if (progreso && m.status === 'recognizing text') progreso(Math.round(m.progress * 100)); },
  });
  const aLineas = texto => String(texto || '').split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
    .map(l => l.replace(/\bS(?=\s?\d[\d,]*\.\d{2}\b)/g, '$'));   // el OCR suele leer "$" como "S"
  try {
    let mejor = [];
    for (const modo of ['6', '4', '11']) {
      await worker.setParameters({ tessedit_pageseg_mode: modo, preserve_interword_spaces: '1' });
      const { data } = await worker.recognize(lienzo);
      const lineas = aLineas(data.text);
      if (parseLineasImagen(lineas).rows.length) return lineas;
      if (lineas.length > mejor.length) mejor = lineas;
    }
    return mejor;
  } finally {
    await worker.terminate();
  }
}
