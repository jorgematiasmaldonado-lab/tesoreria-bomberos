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

    const color = (pct) => (pct > 100 ? '#c62828' : pct > 80 ? '#f9a825' : '#2e7d32');
    const bloque = (tipo, titulo) => {
      const cats = (App.cat.categorias || []).filter((c) => c.tipo === tipo && (c.activa || presMap[c.id] || realMap[c.id]));
      let tP = 0, tR = 0;
      const filas = cats.map((c) => {
        const p = presMap[c.id] || 0, r = realMap[c.id] || 0;
        tP += p; tR += r;
        const pct = p > 0 ? (r / p) * 100 : (r > 0 ? 999 : 0);
        return `<tr>
          <td>${esc(c.nombre)}</td>
          <td class="num">${tes ? `<input class="campo campo-chico text-right w-32 ml-auto" inputmode="decimal" data-cat="${c.id}" value="${esc(p ? montoInput(p) : '')}" placeholder="0,00">` : pesos(p)}</td>
          <td class="num">${pesos(r)}</td>
          <td class="num ${p - r < 0 ? 'text-red-700' : ''}">${pesos(p - r)}</td>
          <td class="w-40"><div class="flex items-center gap-2"><div class="barra-fondo flex-1"><div class="barra" style="width:${Math.min(100, pct).toFixed(0)}%;background:${color(pct)}"></div></div>
            <span class="text-xs num w-12">${p > 0 ? pct.toFixed(0) + '%' : '—'}</span></div></td>
        </tr>`;
      }).join('');
      const pctT = tP > 0 ? (tR / tP) * 100 : 0;
      return `<div class="tarjeta p-0 overflow-x-auto mb-4">
        <h2 class="font-bold px-4 pt-3 pb-2">${titulo}</h2>
        <table class="tabla min-w-[40rem]">
          <thead><tr><th>Categoría</th><th class="num">Presupuestado</th><th class="num">Real</th><th class="num">Diferencia</th><th>% usado</th></tr></thead>
          <tbody>${filas}</tbody>
          <tfoot><tr class="font-bold"><td class="p-2">Total</td><td class="num p-2">${pesos(tP)}</td><td class="num p-2">${pesos(tR)}</td><td class="num p-2">${pesos(tP - tR)}</td>
            <td class="p-2"><span class="chip" style="background:${color(pctT)}22;color:${color(pctT)}">${tP > 0 ? pctT.toFixed(0) + '%' : '—'}</span></td></tr></tfoot>
        </table></div>`;
    };

    $('[data-contenido]', cont).innerHTML = `
      ${bloque('ingreso', 'Ingresos')}
      ${bloque('egreso', 'Egresos')}
      <p class="text-xs text-gray-500 mb-3">Barra: verde hasta 80 %, amarillo más de 80 %, rojo más de 100 % de lo presupuestado.</p>
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
