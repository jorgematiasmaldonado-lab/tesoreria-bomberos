/* =====================================================================
   presupuesto.js · Presupuesto anual por categoría comparado con lo real
   ===================================================================== */
'use strict';

Vistas.presupuesto = {
  async render(cont) {
    const st = (App.estado.presupuesto ||= { anio: new Date().getFullYear() });
    const tes = esTesoreria();
    cont.innerHTML = `
      <div class="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h1 class="text-2xl font-bold">Presupuesto ${st.anio}</h1>
        <div class="flex items-center gap-1">
          <button class="btn btn-secundario btn-icono" data-anio="-1">‹</button>
          <input type="number" value="${st.anio}" min="2000" max="2100" class="campo campo-chico w-24 text-center" data-anio-input>
          <button class="btn btn-secundario btn-icono" data-anio="1">›</button>
        </div>
      </div>
      <div data-contenido>${cargandoHtml()}</div>`;
    on(cont, 'click', '[data-anio]', (ev, b) => { st.anio += Number(b.dataset.anio); App.ocupada = false; renderVista(); });
    $('[data-anio-input]', cont).addEventListener('change', (ev) => { const a = Number(ev.target.value); if (a > 1999 && a < 2101) { st.anio = a; App.ocupada = false; renderVista(); } });

    const { desde, hasta } = rangoAnio(st.anio);
    const [pres, reales] = await Promise.all([
      q(App.sb.from('presupuesto').select('*').eq('anio', st.anio)),
      q(App.sb.rpc('totales_por_categoria', { p_desde: desde, p_hasta: hasta }))
    ]);
    if (App.vista !== 'presupuesto') return;
    const presMap = Object.fromEntries(pres.map((p) => [p.categoria_id, Number(p.monto)]));
    const realMap = {};
    reales.forEach((r) => { realMap[r.categoria_id] = (realMap[r.categoria_id] || 0) + Number(r.total); });

    // Egresos: verde hasta 80 %, amarillo más de 80 %, rojo más de 100 % (gastar de más es malo).
    // Ingresos: azul mientras se va cobrando y verde al alcanzar la meta (cobrar de más es bueno).
    const color = (tipo, pct) => (tipo === 'egreso'
      ? (pct > 100 ? '#c62828' : pct > 80 ? '#f9a825' : '#2e7d32')
      : (pct >= 100 ? '#2e7d32' : '#1976d2'));
    const avance = (tipo, p, r) => {
      if (p <= 0) {
        return r > 0 ? '<span class="chip chip-gris" title="Hay movimientos pero no se cargó un monto presupuestado">Sin presupuestar</span>'
                     : '<span class="text-xs text-gray-400">—</span>';
      }
      const pct = (r / p) * 100;
      return `<div class="flex items-center gap-2"><div class="barra-fondo flex-1"><div class="barra" style="width:${Math.min(100, pct).toFixed(0)}%;background:${color(tipo, pct)}"></div></div>
        <span class="text-xs num w-12" style="color:${color(tipo, pct)}">${pct.toFixed(0)}%</span></div>`;
    };
    const bloque = (tipo, titulo) => {
      const cats = (App.cat.categorias || []).filter((c) => c.tipo === tipo && (c.activa || presMap[c.id] || realMap[c.id]));
      let tP = 0, tR = 0, tRP = 0;   // tRP: real solo de las categorías que tienen presupuesto
      // Diferencia: en egresos, lo que queda disponible; en ingresos, cuánto se cobró de más (+) o falta cobrar (−)
      const dif = (p, r) => (tipo === 'egreso' ? p - r : r - p);
      const filas = cats.map((c) => {
        const p = presMap[c.id] || 0, r = realMap[c.id] || 0;
        tP += p; tR += r; if (p > 0) tRP += r;
        return `<tr>
          <td>${esc(c.nombre)}</td>
          <td class="num">${tes ? `<input class="campo campo-chico text-right ml-auto" style="max-width:10rem" inputmode="decimal" data-cat="${c.id}" value="${esc(p ? montoInput(p) : '')}" placeholder="0,00">` : pesos(p)}</td>
          <td class="num">${pesos(r)}</td>
          <td class="num ${p > 0 && dif(p, r) < 0 ? 'text-red-700' : ''}">${p > 0 ? pesos(dif(p, r)) : '—'}</td>
          <td class="w-44">${avance(tipo, p, r)}</td>
        </tr>`;
      }).join('');
      return `<div class="tarjeta p-0 overflow-x-auto mb-4">
        <h2 class="font-bold px-4 pt-3 pb-2">${titulo}</h2>
        <table class="tabla min-w-[40rem]">
          <thead><tr><th>Categoría</th><th class="num">Presupuestado</th><th class="num">${tipo === 'egreso' ? 'Gastado' : 'Cobrado'}</th>
            <th class="num">${tipo === 'egreso' ? 'Disponible' : 'Diferencia'}</th><th>${tipo === 'egreso' ? '% usado' : '% cobrado'}</th></tr></thead>
          <tbody>${filas}</tbody>
          <tfoot><tr class="font-bold"><td class="p-2">Total</td><td class="num p-2">${pesos(tP)}</td><td class="num p-2">${pesos(tR)}</td>
            <td class="num p-2" title="Solo categorías con presupuesto">${tP > 0 ? pesos(dif(tP, tRP)) : '—'}</td>
            <td class="p-2" title="Solo categorías con presupuesto">${avance(tipo, tP, tRP)}</td></tr></tfoot>
        </table></div>`;
    };

    $('[data-contenido]', cont).innerHTML = `
      ${bloque('ingreso', 'Ingresos')}
      ${bloque('egreso', 'Egresos')}
      <p class="text-xs text-gray-500 mb-3">Egresos: verde hasta 80 %, amarillo más de 80 % y rojo si se pasó de lo presupuestado.
        Ingresos: azul mientras se va cobrando y verde al alcanzar la meta. "Sin presupuestar": hay movimientos pero todavía no se cargó un monto para esa categoría. En la fila Total, la diferencia y el porcentaje consideran solo las categorías que tienen presupuesto.</p>
      ${tes ? '<div class="sticky bottom-3 flex justify-end"><button class="btn btn-primario shadow-lg" data-guardar>💾 Guardar presupuesto</button></div>' : ''}`;

    if (!tes) return;
    cont.addEventListener('input', (ev) => { if (ev.target.matches('[data-cat]')) App.ocupada = true; });
    $('[data-guardar]', cont).addEventListener('click', (ev) => conBoton(ev.currentTarget, async () => {
      const upserts = [];
      const borrar = [];
      for (const inp of $$('[data-cat]', cont)) {
        const v = inp.value.trim() ? parseMonto(inp.value) : 0;
        if (!Number.isFinite(v) || v < 0) { inp.classList.add('error'); inp.focus(); return toast('Revisá los montos: deben ser números positivos.', 'error'); }
        const antes = presMap[inp.dataset.cat] || 0;
        if (v === antes) continue;
        if (v === 0) borrar.push(inp.dataset.cat);
        else upserts.push({ anio: st.anio, categoria_id: inp.dataset.cat, monto: v });
      }
      try {
        if (upserts.length) await q(App.sb.from('presupuesto').upsert(upserts, { onConflict: 'anio,categoria_id' }));
        if (borrar.length) await q(App.sb.from('presupuesto').delete().eq('anio', st.anio).in('categoria_id', borrar));
        App.ocupada = false;
        toast(upserts.length + borrar.length ? 'Presupuesto guardado.' : 'No había cambios.');
        renderVista();
      } catch (e) { toastError(e); }
    }));
  }
};
