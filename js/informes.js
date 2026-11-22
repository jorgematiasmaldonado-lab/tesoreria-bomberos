/* =====================================================================
   informes.js · Informe de Tesorería para la comisión directiva
   (mensual o anual, con vista previa e impresión en A4)
   ===================================================================== */
'use strict';

Vistas.informes = {
  async render(cont) {
    const st = (App.estado.informes ||= { periodo: 'mensual', mes: mesActual(), anio: new Date().getFullYear() });
    cont.innerHTML = `
      <div class="flex flex-wrap items-center justify-between gap-3 mb-3 no-print">
        <h1 class="text-2xl font-bold">Informes</h1>
        <div class="flex flex-wrap gap-2 items-center">
          <select data-periodo class="campo campo-chico w-auto">
            <option value="mensual" ${st.periodo === 'mensual' ? 'selected' : ''}>Mensual</option>
            <option value="anual" ${st.periodo === 'anual' ? 'selected' : ''}>Anual</option>
          </select>
          ${st.periodo === 'mensual' ? selectorMesHtml(st.mes)
            : `<input type="number" data-anio value="${st.anio}" min="2000" max="2100" class="campo campo-chico w-24">`}
          <button class="btn btn-primario" data-imprimir disabled>🖨 Imprimir / PDF</button>
        </div>
      </div>
      <div data-hoja class="overflow-x-auto">${cargandoHtml('Armando el informe…')}</div>`;
    $('[data-periodo]', cont).addEventListener('change', (ev) => { st.periodo = ev.target.value; renderVista(); });
    if (st.periodo === 'mensual') conectarSelectorMes(cont, (mes) => { st.mes = mes; renderVista(); });
    else $('[data-anio]', cont).addEventListener('change', (ev) => { const a = Number(ev.target.value); if (a > 1999 && a < 2101) { st.anio = a; renderVista(); } });

    const { desde, hasta } = st.periodo === 'mensual' ? rangoMes(st.mes) : rangoAnio(st.anio);
    const titulo = `Informe de Tesorería – ${st.periodo === 'mensual' ? nombreMes(st.mes) : 'Año ' + st.anio}`;
    const html = await this.armar(desde, hasta, titulo);
    if (App.vista !== 'informes') return;
    $('[data-hoja]', cont).innerHTML = `<div class="hoja doc">${html}</div>`;
    const btn = $('[data-imprimir]', cont);
    btn.disabled = false;
    btn.addEventListener('click', () => imprimir(html, titulo));
  },

  async armar(desde, hasta, titulo) {
    const [saldoIni, saldoFin, totales, subs, subsRes, ordenes, movs] = await Promise.all([
      q(App.sb.rpc('saldos_al', { p_fecha: sumarDias(desde, -1) })),
      q(App.sb.rpc('saldos_al', { p_fecha: hasta })),
      q(App.sb.rpc('totales_por_categoria', { p_desde: desde, p_hasta: hasta })),
      q(App.sb.from('subsidios').select('*').order('fecha_otorgamiento')),
      q(App.sb.rpc('subsidios_resumen')),
      qTodo(() => App.sb.from('ext_ordenes').select('id, numero, estado, pagado, total, fecha_recepcion, ext_items(count)').gte('fecha_recepcion', desde).lte('fecha_recepcion', hasta)),
      qTodo(() => App.sb.from('movimientos').select('*, cuotas_pagadas(count)').gte('fecha', desde).lte('fecha', hasta).order('fecha').order('creado_en'))
    ]);
    const s = (lista) => Object.fromEntries(lista.map((x) => [x.cuenta, Number(x.saldo)]));
    const ini = { caja: 0, banco: 0, ...s(saldoIni) }, fin = { caja: 0, banco: 0, ...s(saldoFin) };
    const porTipo = (tipo) => totales.filter((t) => t.tipo === tipo)
      .map((t) => ({ nombre: Cat.nombreCategoria(t.categoria_id), total: Number(t.total), cantidad: Number(t.cantidad) }))
      .sort((a, b) => b.total - a.total);
    const ingresos = porTipo('ingreso'), egresos = porTipo('egreso');
    const tIng = ingresos.reduce((a, x) => a + x.total, 0), tEgr = egresos.reduce((a, x) => a + x.total, 0);
    const resMap = Object.fromEntries(subsRes.map((r) => [r.subsidio_id, r]));
    const subsActivos = subs.filter((x) => {
      const e = estadoSubsidio(x, resMap[x.id]);
      return e.texto !== 'Rendido' || (x.fecha_otorgamiento && x.fecha_otorgamiento >= desde && x.fecha_otorgamiento <= hasta);
    });
    const movExt = movs.filter((m) => m.origen === 'extintores');
    const movSoc = movs.filter((m) => m.origen === 'socios');
    const cuotasCant = movSoc.reduce((a, m) => a + (m.cuotas_pagadas?.[0]?.count || 0), 0);
    const tablaCat = (lista, total) => `<table><thead><tr><th>Categoría</th><th class="num">Cant.</th><th class="num">Importe</th></tr></thead>
      <tbody>${lista.map((x) => `<tr><td>${esc(x.nombre)}</td><td class="num">${x.cantidad}</td><td class="num">${pesos(x.total)}</td></tr>`).join('') || '<tr><td colspan="3">Sin movimientos.</td></tr>'}</tbody>
      <tfoot><tr class="total"><td colspan="2">Total</td><td class="num">${pesos(total)}</td></tr></tfoot></table>`;

    return `
      ${encabezadoDoc(titulo, `Período: ${fecha(desde)} al ${fecha(hasta)}`)}
      <h2>1. Saldos</h2>
      <table>
        <thead><tr><th></th><th class="num">Caja</th><th class="num">Banco</th><th class="num">Total</th></tr></thead>
        <tbody>
          <tr><td>Saldo inicial (${fecha(sumarDias(desde, -1))})</td><td class="num">${pesos(ini.caja)}</td><td class="num">${pesos(ini.banco)}</td><td class="num">${pesos(ini.caja + ini.banco)}</td></tr>
          <tr><td>Ingresos del período</td><td colspan="2"></td><td class="num">${pesos(tIng)}</td></tr>
          <tr><td>Egresos del período</td><td colspan="2"></td><td class="num">${pesos(-tEgr)}</td></tr>
          <tr class="total"><td>Resultado del período</td><td colspan="2"></td><td class="num ${tIng - tEgr < 0 ? 'rojo' : ''}">${pesos(tIng - tEgr)}</td></tr>
          <tr class="total"><td>Saldo final (${fecha(hasta)})</td><td class="num">${pesos(fin.caja)}</td><td class="num">${pesos(fin.banco)}</td><td class="num">${pesos(fin.caja + fin.banco)}</td></tr>
        </tbody>
      </table>
      <h2>2. Ingresos por categoría</h2>${tablaCat(ingresos, tIng)}
      <h2>3. Egresos por categoría</h2>${tablaCat(egresos, tEgr)}
      <h2>4. Estado de los subsidios</h2>
      <table><thead><tr><th>Subsidio</th><th>Organismo</th><th class="num">Otorgado</th><th class="num">Recibido</th><th class="num">Gastado</th><th class="num">Por rendir</th><th>Límite</th><th>Estado</th></tr></thead>
        <tbody>${subsActivos.map((x) => { const e = estadoSubsidio(x, resMap[x.id]); return `<tr><td>${esc(x.nombre)}</td><td>${esc(x.organismo)}</td>
          <td class="num">${pesos(x.monto_otorgado)}</td><td class="num">${pesos(e.recibido)}</td><td class="num">${pesos(e.gastado)}</td>
          <td class="num">${pesos(e.porRendir)}</td><td>${fecha(x.fecha_limite)}</td><td>${e.texto}</td></tr>`; }).join('') || '<tr><td colspan="8">Sin subsidios vigentes.</td></tr>'}</tbody></table>
      <h2>5. Extintores</h2>
      <table><tbody>
        <tr><td>Órdenes recibidas en el período</td><td class="num">${ordenes.length}</td></tr>
        <tr><td>Extintores recibidos</td><td class="num">${ordenes.reduce((a, o) => a + (o.ext_items?.[0]?.count || 0), 0)}</td></tr>
        <tr><td>Órdenes entregadas</td><td class="num">${ordenes.filter((o) => o.estado === 'entregado').length}</td></tr>
        <tr><td>Órdenes del período pendientes de cobro</td><td class="num">${ordenes.filter((o) => !o.pagado).length} · ${pesos(ordenes.filter((o) => !o.pagado).reduce((a, o) => a + Number(o.total), 0))}</td></tr>
        <tr class="total"><td>Recaudación por extintores (cobros del período)</td><td class="num">${pesos(movExt.reduce((a, m) => a + Number(m.monto), 0))}</td></tr>
      </tbody></table>
      <h2>6. Cuotas sociales</h2>
      <table><tbody>
        <tr><td>Cobros registrados</td><td class="num">${movSoc.length}</td></tr>
        <tr><td>Cuotas mensuales cobradas</td><td class="num">${cuotasCant}</td></tr>
        <tr class="total"><td>Total cobrado</td><td class="num">${pesos(movSoc.reduce((a, m) => a + Number(m.monto), 0))}</td></tr>
      </tbody></table>
      <h2>7. Detalle de movimientos</h2>
      <table><thead><tr><th>Fecha</th><th>Categoría</th><th>Descripción</th><th>Comprob.</th><th>Cuenta</th><th class="num">Ingreso</th><th class="num">Egreso</th></tr></thead>
        <tbody>${movs.map((m) => `<tr><td>${fecha(m.fecha)}</td><td>${esc(Cat.nombreCategoria(m.categoria_id))}</td><td>${esc(m.descripcion)}</td><td>${esc(m.comprobante)}</td><td>${NOMBRE_CUENTA[m.cuenta]}</td>
          <td class="num">${m.tipo === 'ingreso' ? pesos(m.monto) : ''}</td><td class="num">${m.tipo === 'egreso' ? pesos(m.monto) : ''}</td></tr>`).join('') || '<tr><td colspan="7">Sin movimientos.</td></tr>'}</tbody>
        <tfoot><tr class="total"><td colspan="5">Totales</td><td class="num">${pesos(tIng)}</td><td class="num">${pesos(tEgr)}</td></tr></tfoot></table>
      ${firmasDoc(['Tesorero', 'Presidente', 'Revisor de cuentas'])}
      ${pieDoc()}`;
  }
};
