/* =====================================================================
   resumen.js · Panel principal: saldos, resultado del mes, gráfico y alertas
   ===================================================================== */
'use strict';

Vistas.resumen = {
  async render(cont) {
    const st = (App.estado.resumen ||= { mes: mesActual() });
    const { desde, hasta } = rangoMes(st.mes);
    cont.innerHTML = cargandoHtml();

    const [saldos, movMes, ultimos, gastosPend, extImpagas, extListas, socios, cuotasMes, subsidios, subsRes, ultInforme] =
      await Promise.all([
        q(App.sb.rpc('saldos_al', { p_fecha: hoy() })),
        qTodo(() => App.sb.from('movimientos').select('id, tipo, categoria_id, monto, adjuntos(count)').gte('fecha', desde).lte('fecha', hasta)),
        q(App.sb.from('movimientos').select('*, adjuntos(count)').order('fecha', { ascending: false }).order('creado_en', { ascending: false }).limit(10)),
        q(App.sb.from('gastos_encargado').select('id, monto').eq('estado', 'pendiente')),
        q(App.sb.from('ext_ordenes').select('id, total').eq('pagado', false)),
        q(App.sb.from('ext_ordenes').select('id').eq('estado', 'listo')),
        qTodo(() => App.sb.from('socios').select('id, cuota, fecha_alta').eq('activo', true)),
        qTodo(() => App.sb.from('cuotas_pagadas').select('socio_id').eq('mes', desde)),
        q(App.sb.from('subsidios').select('*')),
        q(App.sb.rpc('subsidios_resumen')),
        q(App.sb.from('informes_semanales').select('id, desde, hasta, obs_moviles, inf_niveles(item_id, nivel_id)').order('desde', { ascending: false }).limit(1))
      ]);
    if (App.vista !== 'resumen') return;

    // ----- Saldos y resultado del mes
    const saldo = { caja: 0, banco: 0 };
    saldos.forEach((s) => { saldo[s.cuenta] = Number(s.saldo); });
    let ingresos = 0, egresos = 0, sinComp = 0;
    const porCat = {};
    for (const m of movMes) {
      const monto = Number(m.monto);
      if (m.tipo === 'ingreso') ingresos += monto; else egresos += monto;
      porCat[m.categoria_id] = (porCat[m.categoria_id] || 0) + monto;
      if (!m.adjuntos?.[0]?.count) sinComp++;
    }
    const barras = (tipo, color) => Object.entries(porCat)
      .filter(([id]) => Cat.categoria(id)?.tipo === tipo)
      .map(([id, v]) => ({ etiqueta: Cat.nombreCategoria(id), valor: v, color }))
      .sort((a, b) => b.valor - a.valor);

    // ----- Alertas
    const alertas = [];
    if (gastosPend.length) alertas.push({ ir: 'gastos', icono: '🧾', texto: `${gastosPend.length} gasto(s) del encargado pendiente(s) de aprobar · ${pesos(gastosPend.reduce((s, g) => s + Number(g.monto), 0))}` });
    if (extImpagas.length) alertas.push({ ir: 'extintores', icono: '🧯', texto: `${extImpagas.length} orden(es) de extintores pendiente(s) de cobro · ${pesos(extImpagas.reduce((s, o) => s + Number(o.total), 0))}` });
    if (extListas.length) alertas.push({ ir: 'extintores', icono: '📦', texto: `${extListas.length} orden(es) de extintores lista(s) para retirar` });
    const pagaron = new Set(cuotasMes.map((c) => c.socio_id));
    const deudores = socios.filter((s) => s.fecha_alta <= hasta && !pagaron.has(s.id) && Number(s.cuota) > 0);
    if (deudores.length) alertas.push({ ir: 'socios', icono: '👥', texto: `${deudores.length} socio(s) deben la cuota de ${nombreMes(st.mes)} · ${pesos(deudores.reduce((s, x) => s + Number(x.cuota), 0))}` });
    const resMap = Object.fromEntries(subsRes.map((r) => [r.subsidio_id, r]));
    const limite = sumarDias(hoy(), 30);
    for (const s of subsidios) {
      const r = resMap[s.id] || { recibido: 0, gastado: 0 };
      const porRendir = Number(r.recibido) - Number(r.gastado);
      if (porRendir > 0.009 && s.fecha_limite && s.fecha_limite <= limite) {
        const vencido = s.fecha_limite < hoy();
        alertas.push({ ir: 'subsidios', icono: vencido ? '⛔' : '⏰', texto: `Subsidio "${s.nombre}": ${pesos(porRendir)} por rendir · ${vencido ? 'venció' : 'vence'} el ${fecha(s.fecha_limite)}` });
      }
    }
    if (sinComp) alertas.push({ ir: 'movimientos', icono: '📎', texto: `${sinComp} movimiento(s) de ${nombreMes(st.mes)} sin comprobante adjunto`, filtroSinComp: true });
    const inf = ultInforme[0];
    if (inf) {
      const criticos = [];
      for (const n of inf.inf_niveles || []) {
        const nivel = Cat.nivel(n.nivel_id);
        if (!nivel?.alerta) continue;
        const movil = (App.cat.moviles || []).find((mv) => (mv.moviles_items || []).some((it) => it.id === n.item_id));
        const item = movil?.moviles_items.find((it) => it.id === n.item_id);
        if (movil && item) criticos.push(`${movil.nombre}${movil.observacion ? ' (' + movil.observacion + ')' : ''} · ${item.nombre}: ${nivel.nombre}`);
      }
      if (criticos.length) alertas.push({ ir: 'encargado', icono: '⛽', texto: `Según el informe semanal del ${fecha(inf.desde)}: ${criticos.join(' · ')}` });
    }

    const tarjeta = (titulo, valor, clase = '') =>
      `<div class="tarjeta"><div class="text-xs uppercase text-gray-500 font-semibold">${esc(titulo)}</div><div class="text-xl sm:text-2xl font-bold tabular-nums ${clase}">${esc(pesos(valor))}</div></div>`;

    cont.innerHTML = `
      <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 class="text-2xl font-bold">Resumen</h1>
        ${selectorMesHtml(st.mes)}
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
        ${tarjeta('Saldo en Caja', saldo.caja)}
        ${tarjeta('Saldo en Banco', saldo.banco)}
        <div class="tarjeta bg-bombero text-white" style="background:#D32F2F"><div class="text-xs uppercase font-semibold opacity-90">Saldo total</div><div class="text-2xl font-bold">${esc(pesos(saldo.caja + saldo.banco))}</div></div>
      </div>
      <div class="grid grid-cols-3 gap-3 mb-4">
        ${tarjeta('Ingresos del mes', ingresos, 'monto-ingreso')}
        ${tarjeta('Egresos del mes', egresos, 'monto-egreso')}
        ${tarjeta('Resultado', ingresos - egresos, ingresos - egresos >= 0 ? 'monto-ingreso' : 'monto-egreso')}
      </div>

      <div class="tarjeta mb-4">
        <h2 class="font-bold mb-3">Alertas</h2>
        ${alertas.length ? `<ul class="space-y-2">${alertas.map((a, i) => `
          <li><button class="w-full text-left flex gap-3 items-start p-3 rounded-lg bg-bombero-claro hover:bg-red-100" style="background:#FFEBEE" data-alerta="${i}">
            <span class="text-xl">${a.icono}</span><span class="flex-1">${esc(a.texto)}</span><span class="text-gray-400">›</span></button></li>`).join('')}</ul>`
          : '<p class="text-gray-500">✅ No hay alertas. Todo en orden.</p>'}
      </div>

      <div class="grid md:grid-cols-2 gap-4 mb-4">
        <div class="tarjeta"><h2 class="font-bold mb-3">Ingresos por categoría · ${esc(nombreMes(st.mes))}</h2>${barrasHtml(barras('ingreso', '#2e7d32'), { vacio: 'Sin ingresos en el mes.' })}</div>
        <div class="tarjeta"><h2 class="font-bold mb-3">Egresos por categoría · ${esc(nombreMes(st.mes))}</h2>${barrasHtml(barras('egreso', '#D32F2F'), { vacio: 'Sin egresos en el mes.' })}</div>
      </div>

      <div class="tarjeta">
        <div class="flex items-center justify-between mb-2"><h2 class="font-bold">Últimos 10 movimientos</h2><a href="#movimientos" class="text-bombero text-sm font-semibold" style="color:#D32F2F">Ver todos ›</a></div>
        ${ultimos.length ? `<ul class="divide-y">${ultimos.map((m) => `
          <li class="py-2 flex items-center gap-3">
            <div class="w-20 text-sm text-gray-500 shrink-0">${fecha(m.fecha)}</div>
            <div class="flex-1 min-w-0"><div class="font-medium truncate">${esc(Cat.nombreCategoria(m.categoria_id))}</div>
              <div class="text-xs text-gray-500 truncate">${esc(m.descripcion || '')} · ${NOMBRE_CUENTA[m.cuenta]}</div></div>
            <div class="${m.tipo === 'ingreso' ? 'monto-ingreso' : 'monto-egreso'} num">${m.tipo === 'egreso' ? '−' : '+'}${esc(pesos(m.monto))}</div>
          </li>`).join('')}</ul>` : vacioHtml('Todavía no hay movimientos.')}
      </div>`;

    conectarSelectorMes(cont, (mes) => { st.mes = mes; renderVista(); });
    on(cont, 'click', '[data-alerta]', (ev, b) => {
      const a = alertas[Number(b.dataset.alerta)];
      if (a.filtroSinComp) {
        App.estado.movimientos = { ...(App.estado.movimientos || {}), modo: 'mes', mes: st.mes, sinComp: true };
      }
      location.hash = a.ir;
    });
  }
};
