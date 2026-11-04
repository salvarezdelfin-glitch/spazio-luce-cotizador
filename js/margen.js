// Presupuestos: sumar nuestra ganancia (por defecto 30 %) a precios que el proveedor da
// "originales", para no calcularlos uno por uno. Se aplica a los precios unitarios que
// ya estén en los renglones (escritos a mano o importados de Excel/PDF/Word).
//
// Dos formas de calcularlo; la predeterminada es la misma del catálogo (costo ÷ 0.70):
// - "venta" (predeterminada): precio ÷ 0.70 (la ganancia es 30 % de lo que cobras)
// - "sumar":  precio × 1.30   (la ganancia es 30 % del costo ≈ 23 % de la venta)
// El botón no se puede aplicar dos veces sin querer: pide confirmar, y "Deshacer"
// devuelve los precios de antes.

let margenAplicado = null; // [{ row, antes, despues }] de la última aplicación

function margenFactor() {
  const pct = parseFloat(document.getElementById('margenPct').value);
  const modo = document.getElementById('margenModo').value;
  if (!(pct > 0)) return null;
  if (modo === 'venta') return pct < 100 ? 1 / (1 - pct / 100) : null;
  return 1 + pct / 100;
}

function resetMargenPresupuesto() {
  margenAplicado = null;
  const b = document.getElementById('margenDeshacerBtn');
  if (b) b.classList.add('hidden');
}

function aplicarMargenPresupuesto() {
  const factor = margenFactor();
  if (!factor) { showToast('Escribe un porcentaje válido'); return; }
  
  if (margenAplicado && !confirm('Ya aplicaste el ajuste a estos precios. ¿Aplicarlo otra vez sobre los precios actuales? (Si fue sin querer, usa "Deshacer")')) return;

  const hechos = [];
  document.querySelectorAll('.presu-row').forEach(row => {
    const campo = row.querySelector('.ps-price');
    const v = parseFloat(campo.value);
    if (!(v > 0)) return;
    const nuevo = round2(v * factor);
    hechos.push({ row, antes: campo.value, despues: String(nuevo) });
    campo.value = nuevo;
  });
  if (!hechos.length) { showToast('No hay precios en los renglones todavía'); return; }
  margenAplicado = hechos;
  document.getElementById('margenDeshacerBtn').classList.remove('hidden');
  recalcPresuTotals();
  showToast('Ajuste aplicado a ' + hechos.length + ' precio(s)');
}

function deshacerMargenPresupuesto() {
  if (!margenAplicado) return;
  let n = 0;
  margenAplicado.forEach(({ row, antes, despues }) => {
    const campo = row.isConnected ? row.querySelector('.ps-price') : null;
    // Solo se devuelve si el precio sigue siendo el que puso el botón (no se tocó a mano después).
    if (campo && campo.value === despues) { campo.value = antes; n++; }
  });
  resetMargenPresupuesto();
  recalcPresuTotals();
  showToast('Ajuste deshecho (' + n + ')');
}
