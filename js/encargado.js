/* =====================================================================
   encargado.js · Informe del encargado de semana: gastos, emergencias,
   novedades, pendientes, niveles de combustible, WhatsApp y estadísticas
   ===================================================================== */
'use strict';

Vistas.encargado = {
  puedeEditar: () => ['tesoreria', 'encargado'].includes(App.rol),

  async render(cont) {
    const st = (App.estado.encargado ||= { editando: null, texto: '', pestana: 'historial', anio: new Date().getFullYear() });
    if (st.editando) return this.editor(cont, st);
    cont.innerHTML = `
      <div class="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h1 class="text-2xl font-bold">Encargado de semana</h1>
        ${this.puedeEditar() ? '<button class="btn btn-primario text-lg" data-nuevo>＋ Nuevo informe</button>' : ''}
      </div>
      <div class="flex gap-2 mb-3">
        <button class="subpestana ${st.pestana === 'historial' ? 'activa' : ''}" data-pestana="historial">Historial</button>
        <button class="subpestana ${st.pestana === 'estadisticas' ? 'activa' : ''}" data-pestana="estadisticas">Estadísticas</button>
      </div>
      <div data-contenido>${cargandoHtml()}</div>`;
    on(cont, 'click', '[data-pestana]', (ev, b) => { st.pestana = b.dataset.pestana; renderVista(); });
    on(cont, 'click', '[data-nuevo]', () => this.nuevo(st));
    const zona = $('[data-contenido]', cont);
    if (st.pestana === 'estadisticas') return this.estadisticas(zona, st);

    const informes = await qTodo(() => App.sb.from('informes_semanales')
      .select('*, gastos_encargado(monto, estado), inf_emergencias(cantidad), inf_pendientes(resuelto)')
      .order('desde', { ascending: false }));
    if (App.vista !== 'encargado') return;
    this._ultimo = informes[0] || null;
    zona.innerHTML = `
      <div class="tarjeta mb-3"><input type="search" data-buscar value="${esc(st.texto)}" placeholder="Buscar por encargado o fecha (ej. 12/10)" class="campo campo-chico"></div>
      <div data-filas></div>`;
    const pintar = () => {
      const t = st.texto.trim().toLowerCase();
      const lista = informes.filter((i) => !t || [i.encargado_nombre, i.proximo_nombre, fecha(i.desde), fecha(i.hasta)]
        .some((x) => String(x || '').toLowerCase().includes(t)));
      $('[data-filas]', zona).innerHTML = !lista.length ? `<div class="tarjeta">${vacioHtml('No hay informes.')}</div>` : `
        <div class="grid gap-3 md:grid-cols-2">${lista.map((i) => {
          const emerg = i.inf_emergencias.reduce((s, e) => s + e.cantidad, 0);
          const gastos = i.gastos_encargado.filter((g) => g.estado !== 'rechazado');
          const pend = i.inf_pendientes.filter((p) => !p.resuelto).length;
          return `<button class="tarjeta text-left hover:ring-2 ring-red-200" data-abrir="${i.id}">
            <div class="font-bold text-lg">Semana del ${fechaCorta(i.desde)} al ${fechaCorta(i.hasta)} <span class="text-sm text-gray-500 font-normal">${i.desde.slice(0, 4)}</span></div>
            <div class="text-sm text-gray-600">Encargado: ${esc(i.encargado_nombre || '—')} · Próximo: ${esc(i.proximo_nombre || '—')}</div>
            <div class="flex flex-wrap gap-2 mt-2">
              <span class="chip chip-rojo">🚨 ${emerg} emergencia(s)</span>
              <span class="chip chip-gris">🧾 ${gastos.length} gasto(s) · ${pesos(gastos.reduce((s, g) => s + Number(g.monto), 0))}</span>
              ${pend ? `<span class="chip chip-amarillo">📌 ${pend} pendiente(s)</span>` : ''}
            </div></button>`;
        }).join('')}</div>`;
    };
    pintar();
    $('[data-buscar]', zona).addEventListener('input', debounce((ev) => { st.texto = ev.target.value; pintar(); }, 250));
    on(zona, 'click', '[data-abrir]', (ev, b) => { st.editando = b.dataset.abrir; renderVista(); });
  },

  /** Nuevo informe: semana y encargados. Arrastra pendientes y niveles del anterior. */
  nuevo(st) {
    const ult = this._ultimo;
    let desde;
    if (ult) desde = sumarDias(ult.hasta, 1);
    else { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); desde = isoLocal(d); }   // lunes de esta semana
    const personal = (App.cat.personal || []).filter((p) => p.activo);
    const m = abrirModal({
      titulo: 'Nuevo informe semanal',
      cuerpo: `<form class="space-y-3" novalidate>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="etiqueta">Semana desde *</label><input type="date" name="desde" value="${desde}" class="campo"></div>
          <div><label class="etiqueta">Hasta *</label><input type="date" name="hasta" value="${sumarDias(desde, 6)}" class="campo"></div>
        </div>
        <div><label class="etiqueta">Encargado actual</label><select name="encargado" class="campo">${opcionesHtml(personal, ult?.proximo_id, { vacio: '— Elegir —', texto: Cat.nombrePersona })}</select></div>
        <div><label class="etiqueta">Próximo encargado</label><select name="proximo" class="campo">${opcionesHtml(personal, '', { vacio: '— Elegir —', texto: Cat.nombrePersona })}</select></div>
        ${!personal.length ? '<p class="text-sm text-amber-700">Todavía no hay personal cargado. Tesorería lo carga en Configuración → Personal.</p>' : ''}
        <p class="text-xs text-gray-500">Los pendientes sin resolver y los niveles de combustible del informe anterior se copian automáticamente.</p>
      </form>`,
      pie: `<button class="btn btn-secundario" data-cerrar>Cancelar</button><button class="btn btn-primario" data-ok>Crear informe</button>`
    });
    const form = $('form', m.el);
    $('[name="desde"]', form).addEventListener('change', (ev) => { if (esFechaValida(ev.target.value)) $('[name="hasta"]', form).value = sumarDias(ev.target.value, 6); });
    $('[data-ok]', m.el).addEventListener('click', (ev) => conBoton(ev.currentTarget, async () => {
      const d = leerForm(form);
      if (!esFechaValida(d.desde)) return errorCampo(form, 'desde', 'Ingresá la fecha de inicio.');
      if (!esFechaValida(d.hasta) || d.hasta < d.desde) return errorCampo(form, 'hasta', 'La fecha final debe ser posterior a la inicial.');
      try {
        const id = await q(App.sb.rpc('crear_informe_semanal', { p_desde: d.desde, p_hasta: d.hasta, p_encargado: d.encargado || null, p_proximo: d.proximo || null }));
        toast('Informe creado.');
        st.editando = id;
        m.cerrar();
        renderVista();
      } catch (e) { toastError(e); }
    }, 'Creando…'));
  },

  // -------------------------------------------------------------------
  // Editor del informe
  // -------------------------------------------------------------------
  async editor(cont, st) {
    cont.innerHTML = cargandoHtml();
    const id = st.editando;
    const inf = await q(App.sb.from('informes_semanales')
      .select('*, inf_emergencias(*), inf_novedades(*), inf_pendientes(*), inf_niveles(*)').eq('id', id).maybeSingle());
    if (App.vista !== 'encargado') return;
    if (!inf) { st.editando = null; toast('El informe ya no existe.', 'error'); return renderVista(); }
    const edita = this.puedeEditar();
    const dis = edita ? '' : 'disabled';
    const personal = (App.cat.personal || []).filter((p) => p.activo || p.id === inf.encargado_id || p.id === inf.proximo_id);
    const cant = Object.fromEntries(inf.inf_emergencias.map((e) => [e.tipo_id, e.cantidad]));
    const tipos = (App.cat.tiposEmergencia || []).filter((t) => t.activo || cant[t.id]);
    const niveles = (App.cat.niveles || []).filter((n) => n.activo);
    const nivelDe = Object.fromEntries(inf.inf_niveles.map((n) => [n.item_id, n.nivel_id]));
    const moviles = (App.cat.moviles || []).filter((mv) => mv.activo);
    const obs = inf.obs_moviles || {};
    inf.inf_novedades.sort((a, b) => a.orden - b.orden);
    inf.inf_pendientes.sort((a, b) => a.orden - b.orden);
    const puedeBorrar = esTesoreria() || (App.rol === 'encargado' && inf.creado_por === App.usuario.id);

    const filaNovedad = (t = '') => `<div class="flex gap-2" data-fila-nov><input class="campo campo-chico flex-1" data-nov value="${esc(t)}" ${dis} placeholder="Novedad">
      ${edita ? '<button type="button" class="btn btn-peligro btn-icono" data-quitar-fila>✕</button>' : ''}</div>`;
    const filaPendiente = (p = {}) => `<div class="flex gap-2 items-center" data-fila-pend>
      <input type="checkbox" class="w-6 h-6 shrink-0" data-pend-res ${p.resuelto ? 'checked' : ''} ${dis} title="Resuelto">
      <input class="campo campo-chico flex-1 ${p.resuelto ? 'line-through text-gray-400' : ''}" data-pend-txt value="${esc(p.texto || '')}" ${dis} placeholder="Pendiente">
      ${edita ? '<button type="button" class="btn btn-peligro btn-icono" data-quitar-fila>✕</button>' : ''}</div>`;

    cont.innerHTML = `
      <div class="flex flex-wrap items-center gap-2 mb-3 lg:sticky lg:top-[7.2rem] z-20 bg-gray-100 py-2">
        <button class="btn btn-secundario" data-volver>← Volver</button>
        <h1 class="text-xl font-bold flex-1 min-w-[10rem]">Semana del ${fechaCorta(inf.desde)} al ${fechaCorta(inf.hasta)}</h1>
        ${edita ? '<button class="btn btn-primario" data-guardar>💾 Guardar</button>' : ''}
        <button class="btn btn-secundario" data-copiar>📋 Copiar para WhatsApp</button>
        <button class="btn btn-verde" data-enviar>💬 Enviar</button>
        <button class="btn btn-secundario" data-imprimir>🖨</button>
        ${puedeBorrar ? '<button class="btn btn-peligro btn-icono" data-borrar-inf title="Borrar informe">🗑</button>' : ''}
      </div>
      <div class="grid gap-4 lg:grid-cols-2" data-editor>
        <section class="tarjeta space-y-3">
          <h2 class="font-bold text-lg">Datos generales</h2>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="etiqueta">Desde *</label><input type="date" name="desde" value="${esc(inf.desde)}" class="campo" ${dis}></div>
            <div><label class="etiqueta">Hasta *</label><input type="date" name="hasta" value="${esc(inf.hasta)}" class="campo" ${dis}></div>
          </div>
          <div><label class="etiqueta">Encargado actual</label><select name="encargado_id" class="campo" ${dis}>${opcionesHtml(personal, inf.encargado_id, { vacio: '— Elegir —', texto: Cat.nombrePersona })}</select></div>
          <div><label class="etiqueta">Próximo encargado</label><select name="proximo_id" class="campo" ${dis}>${opcionesHtml(personal, inf.proximo_id, { vacio: '— Elegir —', texto: Cat.nombrePersona })}</select></div>
        </section>

        <section class="tarjeta">
          <h2 class="font-bold text-lg mb-2">Gastos de la semana</h2>
          <div data-gastos>${cargandoHtml()}</div>
        </section>

        <section class="tarjeta">
          <h2 class="font-bold text-lg mb-2">Emergencias</h2>
          <div class="divide-y">${tipos.map((t) => `
            <div class="flex items-center gap-2 py-2">
              <span class="flex-1">${esc(t.nombre)}</span>
              ${edita ? `<button type="button" class="btn btn-secundario btn-icono text-xl" data-menos="${t.id}" aria-label="Restar">−</button>` : ''}
              <span class="w-10 text-center text-xl font-bold" data-cant="${t.id}">${cant[t.id] || 0}</span>
              ${edita ? `<button type="button" class="btn btn-primario btn-icono text-xl" data-mas="${t.id}" aria-label="Sumar">+</button>` : ''}
            </div>`).join('') || vacioHtml('No hay tipos de emergencia configurados.')}</div>
          <div class="text-right font-semibold mt-2">Total: <span data-total-emerg></span></div>
        </section>

        <section class="tarjeta space-y-4">
          <div>
            <h2 class="font-bold text-lg mb-2">Novedades</h2>
            <div class="space-y-2" data-novedades>${inf.inf_novedades.map((n) => filaNovedad(n.texto)).join('')}</div>
            ${edita ? '<button type="button" class="btn btn-secundario btn-chico mt-2" data-agregar-nov>＋ Agregar novedad</button>' : ''}
          </div>
          <div>
            <h2 class="font-bold text-lg mb-2">Pendientes</h2>
            <div class="space-y-2" data-pendientes>${inf.inf_pendientes.map(filaPendiente).join('')}</div>
            ${edita ? '<button type="button" class="btn btn-secundario btn-chico mt-2" data-agregar-pend>＋ Agregar pendiente</button>' : ''}
            <p class="text-xs text-gray-500 mt-1">Los pendientes sin tildar pasan al informe de la semana siguiente.</p>
          </div>
        </section>

        <section class="tarjeta lg:col-span-2">
          <h2 class="font-bold text-lg mb-2">Combustibles y niveles</h2>
          ${!moviles.length ? vacioHtml('No hay móviles configurados (Configuración → Móviles).') : `
          <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">${moviles.map((mv) => `
            <div class="border rounded-xl p-3">
              <div class="font-bold">${esc(mv.nombre)}</div>
              <input class="campo campo-chico mb-2 mt-1" data-obs="${mv.id}" value="${esc(obs[mv.id] ?? mv.observacion ?? '')}" placeholder="Observación (ej. nuevo)" ${dis}>
              <div class="space-y-2">${(mv.moviles_items || []).filter((it) => it.activo).map((it) => {
                const nv = Cat.nivel(nivelDe[it.id]);
                return `<div><label class="text-sm">${esc(it.nombre)}</label>
                  <select class="campo campo-chico ${nv?.alerta ? 'nivel-alerta' : ''}" data-nivel="${it.id}" ${dis}>${opcionesHtml(niveles, nivelDe[it.id], { vacio: '—' })}</select></div>`;
              }).join('')}</div>
            </div>`).join('')}</div>`}
        </section>
      </div>`;

    const ed = $('[data-editor]', cont);
    const totalEmerg = () => { $('[data-total-emerg]', cont).textContent = Object.values(cant).reduce((s, n) => s + (n || 0), 0); };
    totalEmerg();
    const marcar = () => { if (edita) App.ocupada = true; };
    ed.addEventListener('input', (ev) => { if (!ev.target.closest('[data-form-gasto]')) marcar(); });
    ed.addEventListener('change', (ev) => {
      if (ev.target.closest('[data-form-gasto]')) return;
      marcar();
      if (ev.target.matches('[data-nivel]')) ev.target.classList.toggle('nivel-alerta', !!Cat.nivel(ev.target.value)?.alerta);
      if (ev.target.matches('[data-pend-res]')) $('[data-pend-txt]', ev.target.parentElement).classList.toggle('line-through', ev.target.checked);
    });
    on(ed, 'click', '[data-mas],[data-menos]', (ev, b) => {
      const tid = b.dataset.mas || b.dataset.menos;
      cant[tid] = Math.max(0, (cant[tid] || 0) + (b.dataset.mas ? 1 : -1));
      $(`[data-cant="${tid}"]`, ed).textContent = cant[tid];
      totalEmerg(); marcar();
    });
    on(ed, 'click', '[data-agregar-nov]', () => { $('[data-novedades]', ed).insertAdjacentHTML('beforeend', filaNovedad()); $('[data-novedades] [data-fila-nov]:last-child input', ed).focus(); marcar(); });
    on(ed, 'click', '[data-agregar-pend]', () => { $('[data-pendientes]', ed).insertAdjacentHTML('beforeend', filaPendiente()); $('[data-pendientes] [data-fila-pend]:last-child [data-pend-txt]', ed).focus(); marcar(); });
    on(ed, 'click', '[data-quitar-fila]', (ev, b) => { b.parentElement.remove(); marcar(); });

    /** Lee el estado actual del editor (aunque no esté guardado) */
    const leer = () => {
      const g = (n) => $(`[name="${n}"]`, ed).value;
      return {
        desde: g('desde'), hasta: g('hasta'), encargado_id: g('encargado_id') || null, proximo_id: g('proximo_id') || null,
        cant: { ...cant },
        novedades: $$('[data-nov]', ed).map((i) => i.value.trim()).filter(Boolean),
        pendientes: $$('[data-fila-pend]', ed).map((f) => ({ texto: $('[data-pend-txt]', f).value.trim(), resuelto: $('[data-pend-res]', f).checked })).filter((p) => p.texto),
        niveles: Object.fromEntries($$('[data-nivel]', ed).map((s) => [s.dataset.nivel, s.value || null])),
        obs: Object.fromEntries($$('[data-obs]', ed).map((i) => [i.dataset.obs, i.value.trim()]))
      };
    };

    // ----- Gastos (se guardan al instante, cada uno llega a Tesorería como "a aprobar")
    let gastos = [];
    const pintarGastos = async () => {
      const zona = $('[data-gastos]', cont);
      try {
        gastos = await q(App.sb.from('gastos_encargado').select('*, adjuntos(*)').eq('informe_id', id).order('creado_en'));
      } catch (e) { zona.innerHTML = `<p class="text-red-700">${esc(mensajeError(e))}</p>`; return; }
      const propio = (g) => esTesoreria() || (App.rol === 'encargado' && g.creado_por === App.usuario.id && g.estado === 'pendiente');
      zona.innerHTML = `
        ${gastos.length ? `<ul class="divide-y mb-3">${gastos.map((g) => `
          <li class="py-2 flex items-center gap-2">
            <div class="flex-1 min-w-0"><div class="font-medium">${esc(g.concepto)} <span class="chip ${ESTADOS_GASTO[g.estado].chip}">${ESTADOS_GASTO[g.estado].texto}</span></div>
              <div class="text-xs text-gray-500">${fecha(g.fecha)} · ${esc(g.autor_nombre || '')}${g.estado === 'rechazado' && g.motivo_rechazo ? ' · Motivo: ' + esc(g.motivo_rechazo) : ''}</div></div>
            <span class="num font-semibold">${pesos(g.monto)}</span>
            <button type="button" class="btn btn-secundario btn-icono" data-ticket="${g.id}" title="Ticket">📎${g.adjuntos.length ? `<span class="text-xs">${g.adjuntos.length}</span>` : ''}</button>
            ${propio(g) && App.rol === 'encargado' ? `<button type="button" class="btn btn-peligro btn-icono" data-borrar-gasto="${g.id}">🗑</button>` : ''}
          </li>`).join('')}</ul>
          <div class="text-right font-semibold mb-3">Total: ${pesos(gastos.filter((g) => g.estado !== 'rechazado').reduce((s, g) => s + Number(g.monto), 0))}</div>`
          : '<p class="text-gray-500 mb-3">Sin gastos cargados.</p>'}
        ${edita ? `<div class="border-t pt-3 space-y-2" data-form-gasto>
          <div class="font-semibold">Agregar gasto</div>
          <div class="grid grid-cols-2 gap-2">
            <div class="col-span-2"><input name="g_concepto" class="campo" placeholder="Concepto (ej. Super)" maxlength="200"></div>
            <div><input name="g_monto" class="campo" inputmode="decimal" placeholder="Monto"></div>
            <div><input name="g_fecha" type="date" class="campo" value="${esc(hoy() >= inf.desde && hoy() <= inf.hasta ? hoy() : inf.hasta)}"></div>
          </div>
          ${Adjuntos.selectorHtml()}
          <button type="button" class="btn btn-primario w-full" data-agregar-gasto>＋ Agregar gasto</button>
        </div>` : ''}`;
      if (!edita) return;
      const fg = $('[data-form-gasto]', zona);
      const archivos = Adjuntos.conectarSelector(fg);
      $('[data-agregar-gasto]', fg).addEventListener('click', (ev) => conBoton(ev.currentTarget, async () => {
        const concepto = $('[name="g_concepto"]', fg).value.trim();
        const monto = parseMonto($('[name="g_monto"]', fg).value);
        const f = $('[name="g_fecha"]', fg).value;
        if (!concepto) return errorCampo(fg, 'g_concepto', 'Indicá el concepto del gasto.');
        if (!(monto > 0)) return errorCampo(fg, 'g_monto', 'El monto debe ser mayor a 0.');
        if (!esFechaValida(f)) return errorCampo(fg, 'g_fecha', 'Ingresá una fecha válida.');
        try {
          const nuevo = await q(App.sb.from('gastos_encargado').insert({ informe_id: id, concepto, monto, fecha: f }).select('id').single());
          const lista = archivos();
          if (lista.length) {
            try { await Adjuntos.subir(lista, { carpeta: 'gastos', id: nuevo.id, campo: 'gasto_id' }); }
            catch (e) { toast('El gasto se guardó, pero falló la subida del ticket: ' + mensajeError(e), 'error', 7000); }
          }
          toast('Gasto agregado. Quedó pendiente de aprobación por Tesorería.');
          await pintarGastos();
        } catch (e) { toastError(e); }
      }));
    };
    on(cont, 'click', '[data-ticket]', (ev, b) => {
      const g = gastos.find((x) => x.id === b.dataset.ticket);
      const propio = esTesoreria() || (App.rol === 'encargado' && g.creado_por === App.usuario.id && g.estado === 'pendiente');
      Adjuntos.gestor({ titulo: `Ticket · ${g.concepto}`, campo: 'gasto_id', id: g.id, carpeta: 'gastos',
        puedeSubir: App.rol === 'encargado' && propio, puedeBorrar: App.rol === 'encargado' && propio, alCambiar: pintarGastos });
    });
    on(cont, 'click', '[data-borrar-gasto]', async (ev, b) => {
      const g = gastos.find((x) => x.id === b.dataset.borrarGasto);
      if (!(await confirmar(`¿Borrar el gasto "${g.concepto}" de ${pesos(g.monto)}?`))) return;
      try {
        await Adjuntos.borrarArchivos('gasto_id', g.id);
        await q(App.sb.from('gastos_encargado').delete().eq('id', g.id));
        toast('Gasto borrado.');
        await pintarGastos();
      } catch (e) { toastError(e); }
    });
    pintarGastos();

    // ----- Acciones de la barra
    const guardar = async () => {
      const d = leer();
      if (!esFechaValida(d.desde)) { $('[name="desde"]', ed).classList.add('error'); toast('La fecha "desde" no es válida.', 'error'); return false; }
      if (!esFechaValida(d.hasta) || d.hasta < d.desde) { $('[name="hasta"]', ed).classList.add('error'); toast('La fecha "hasta" debe ser posterior a "desde".', 'error'); return false; }
      const nombre = (pid) => Cat.nombrePersona(Cat.persona(pid));
      await q(App.sb.from('informes_semanales').update({
        desde: d.desde, hasta: d.hasta, encargado_id: d.encargado_id, proximo_id: d.proximo_id,
        encargado_nombre: nombre(d.encargado_id), proximo_nombre: nombre(d.proximo_id), obs_moviles: d.obs
      }).eq('id', id));
      const emerg = Object.entries(d.cant).map(([tipo_id, cantidad]) => ({ informe_id: id, tipo_id, cantidad: cantidad || 0 }));
      if (emerg.length) await q(App.sb.from('inf_emergencias').upsert(emerg, { onConflict: 'informe_id,tipo_id' }));
      await q(App.sb.from('inf_novedades').delete().eq('informe_id', id));
      if (d.novedades.length) await q(App.sb.from('inf_novedades').insert(d.novedades.map((texto, i) => ({ informe_id: id, texto, orden: i + 1 }))));
      await q(App.sb.from('inf_pendientes').delete().eq('informe_id', id));
      if (d.pendientes.length) await q(App.sb.from('inf_pendientes').insert(d.pendientes.map((p, i) => ({ informe_id: id, ...p, orden: i + 1 }))));
      const conNivel = Object.entries(d.niveles).filter(([, v]) => v).map(([item_id, nivel_id]) => ({ informe_id: id, item_id, nivel_id }));
      const sinNivel = Object.entries(d.niveles).filter(([, v]) => !v).map(([k]) => k);
      if (conNivel.length) await q(App.sb.from('inf_niveles').upsert(conNivel, { onConflict: 'informe_id,item_id' }));
      if (sinNivel.length) await q(App.sb.from('inf_niveles').delete().eq('informe_id', id).in('item_id', sinNivel));
      App.ocupada = false;
      return true;
    };
    const texto = () => this.textoWhatsApp(leer(), gastos, tipos, moviles, niveles);

    $('[data-volver]', cont).addEventListener('click', () => {
      if (App.ocupada && !window.confirm('Hay cambios sin guardar. ¿Volver igual?')) return;
      App.ocupada = false; st.editando = null; renderVista();
    });
    $('[data-guardar]', cont)?.addEventListener('click', (ev) => conBoton(ev.currentTarget, async () => {
      try { if (await guardar()) toast('Informe guardado.'); } catch (e) { toastError(e); }
    }));
    $('[data-copiar]', cont).addEventListener('click', async () => {
      try { if (edita && App.ocupada && !(await guardar())) return; } catch (e) { return toastError(e); }
      copiarTexto(texto());
    });
    $('[data-enviar]', cont).addEventListener('click', async () => {
      const t = texto();
      const ventana = window.open('about:blank', '_blank');   // se abre antes para que no la bloquee el navegador
      try { if (edita && App.ocupada && !(await guardar())) { ventana?.close(); return; } } catch (e) { ventana?.close(); return toastError(e); }
      const url = `https://wa.me/?text=${encodeURIComponent(t)}`;
      if (ventana) ventana.location.href = url; else location.href = url;
    });
    $('[data-imprimir]', cont).addEventListener('click', () => this.imprimir(leer(), gastos, tipos, moviles, niveles));
    $('[data-borrar-inf]', cont)?.addEventListener('click', async () => {
      if (!(await confirmar('¿Borrar este informe semanal? Los gastos cargados se conservan en "Gastos a aprobar".'))) return;
      try { await q(App.sb.from('informes_semanales').delete().eq('id', id)); App.ocupada = false; st.editando = null; toast('Informe borrado.'); renderVista(); } catch (e) { toastError(e); }
    });
  },

  /** Texto para WhatsApp con el formato acordado (negritas con *) */
  textoWhatsApp(d, gastos, tipos, moviles, niveles) {
    const L = [`*SEMANA DEL ${fechaCorta(d.desde)} al ${fechaCorta(d.hasta)}*`, '', '*GASTOS*'];
    const gs = gastos.filter((g) => g.estado !== 'rechazado');
    if (gs.length) gs.forEach((g) => L.push(`* ${g.concepto}: ${pesosCorto(g.monto)}`)); else L.push('- Sin gastos');
    L.push('', '*EMERGENCIAS* :');
    const em = tipos.filter((t) => d.cant[t.id] > 0);
    if (em.length) em.forEach((t) => L.push(`${d.cant[t.id]}. ${t.nombre}`)); else L.push('- Sin emergencias');
    L.push('', '*NOVEDADES*');
    if (d.novedades.length) d.novedades.forEach((n) => L.push(`- ${n}`)); else L.push('- Sin novedades');
    L.push('', '*PENDIENTES*');
    const pe = d.pendientes.filter((p) => !p.resuelto);
    if (pe.length) pe.forEach((p) => L.push(`- ${p.texto}`)); else L.push('- Sin pendientes');
    L.push('', '*COMBUSTIBLES*');
    const nombreNivel = (nid) => niveles.find((n) => n.id === nid)?.nombre || '';
    for (const mv of moviles) {
      const items = (mv.moviles_items || []).filter((it) => it.activo && d.niveles[it.id]);
      if (!items.length) continue;
      const o = d.obs[mv.id];
      L.push('', `*${mv.nombre}${o ? ` (${o})` : ''}:*`);
      items.forEach((it) => L.push(`${it.nombre}: ${nombreNivel(d.niveles[it.id])}`));
    }
    const prox = Cat.nombrePersona(Cat.persona(d.proximo_id));
    if (prox) L.push('', `*Próximo encargado de semana ${prox}*.`);
    return L.join('\n');
  },

  imprimir(d, gastos, tipos, moviles, niveles) {
    const gs = gastos.filter((g) => g.estado !== 'rechazado');
    const nivel = (nid) => niveles.find((n) => n.id === nid);
    const enc = Cat.nombrePersona(Cat.persona(d.encargado_id)), prox = Cat.nombrePersona(Cat.persona(d.proximo_id));
    const html = `
      ${encabezadoDoc('Informe del encargado de semana', `Semana del ${fecha(d.desde)} al ${fecha(d.hasta)}`)}
      <table><tr><th style="width:30%">Encargado de semana</th><td>${esc(enc || '—')}</td></tr><tr><th>Próximo encargado</th><td>${esc(prox || '—')}</td></tr></table>
      <h2>Gastos</h2>
      <table><thead><tr><th>Fecha</th><th>Concepto</th><th>Estado</th><th class="num">Monto</th></tr></thead>
        <tbody>${gs.map((g) => `<tr><td>${fecha(g.fecha)}</td><td>${esc(g.concepto)}</td><td>${ESTADOS_GASTO[g.estado].texto}</td><td class="num">${pesos(g.monto)}</td></tr>`).join('') || '<tr><td colspan="4">Sin gastos.</td></tr>'}</tbody>
        <tfoot><tr class="total"><td colspan="3">Total</td><td class="num">${pesos(gs.reduce((s, g) => s + Number(g.monto), 0))}</td></tr></tfoot></table>
      <h2>Emergencias</h2>
      <table><tbody>${tipos.filter((t) => d.cant[t.id] > 0).map((t) => `<tr><td>${esc(t.nombre)}</td><td class="num" style="width:20%">${d.cant[t.id]}</td></tr>`).join('') || '<tr><td>Sin emergencias.</td></tr>'}</tbody></table>
      <h2>Novedades</h2>${d.novedades.length ? `<ul>${d.novedades.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : '<p>Sin novedades.</p>'}
      <h2>Pendientes</h2>${d.pendientes.length ? `<ul>${d.pendientes.map((p) => `<li>${p.resuelto ? '☑' : '☐'} ${esc(p.texto)}</li>`).join('')}</ul>` : '<p>Sin pendientes.</p>'}
      <h2>Combustibles y niveles</h2>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">${moviles.map((mv) => {
        const items = (mv.moviles_items || []).filter((it) => it.activo);
        if (!items.length) return '';
        return `<table><thead><tr><th colspan="2">${esc(mv.nombre)}${d.obs[mv.id] ? ' (' + esc(d.obs[mv.id]) + ')' : ''}</th></tr></thead><tbody>
          ${items.map((it) => { const n = nivel(d.niveles[it.id]); return `<tr><td>${esc(it.nombre)}</td><td class="${n?.alerta ? 'rojo' : ''}" style="width:40%">${esc(n?.nombre || '—')}</td></tr>`; }).join('')}
        </tbody></table>`;
      }).join('')}</div>
      ${firmasDoc(['Encargado de semana', 'Próximo encargado'])}
      ${pieDoc()}`;
    imprimir(html, `Informe semanal ${fecha(d.desde)}`);
  },

  // -------------------------------------------------------------------
  // Estadísticas de emergencias
  // -------------------------------------------------------------------
  async estadisticas(zona, st) {
    zona.innerHTML = cargandoHtml();
    const { desde, hasta } = rangoAnio(st.anio);
    const [delAnio, todo] = await Promise.all([
      q(App.sb.rpc('estadisticas_emergencias', { p_desde: desde, p_hasta: hasta })),
      q(App.sb.rpc('estadisticas_emergencias', { p_desde: '2000-01-01', p_hasta: '2100-12-31' }))
    ]);
    if (App.vista !== 'encargado') return;
    const tipos = App.cat.tiposEmergencia || [];
    const nombreTipo = (id) => tipos.find((t) => t.id === id)?.nombre || '—';
    const porTipo = {};
    const porMes = Array(12).fill(0);
    const matriz = {};
    delAnio.forEach((r) => {
      const n = Number(r.cantidad), mes = Number(r.mes.slice(5, 7)) - 1;
      porTipo[r.tipo_id] = (porTipo[r.tipo_id] || 0) + n;
      porMes[mes] += n;
      (matriz[r.tipo_id] ||= Array(12).fill(0))[mes] += n;
    });
    const porAnio = {};
    todo.forEach((r) => { porAnio[r.mes.slice(0, 4)] = (porAnio[r.mes.slice(0, 4)] || 0) + Number(r.cantidad); });
    const total = Object.values(porTipo).reduce((a, b) => a + b, 0);
    const fmt = (n) => String(n);
    zona.innerHTML = `
      <div class="flex items-center gap-2 mb-3">
        <button class="btn btn-secundario btn-icono" data-anio="-1">‹</button>
        <span class="font-bold text-lg">${st.anio}</span>
        <button class="btn btn-secundario btn-icono" data-anio="1">›</button>
        <span class="chip chip-rojo ml-2">${total} emergencia(s) en el año</span>
      </div>
      <div class="grid md:grid-cols-2 gap-4 mb-4">
        <div class="tarjeta"><h2 class="font-bold mb-3">Por tipo · ${st.anio}</h2>
          ${barrasHtml(Object.entries(porTipo).map(([id, v]) => ({ etiqueta: nombreTipo(id), valor: v })).sort((a, b) => b.valor - a.valor), { formato: fmt, vacio: 'Sin emergencias registradas.' })}</div>
        <div class="tarjeta"><h2 class="font-bold mb-3">Por mes · ${st.anio}</h2>
          ${barrasHtml(porMes.map((v, i) => ({ etiqueta: MESES[i], valor: v, color: '#ef6c00' })).filter((x) => x.valor), { formato: fmt, vacio: 'Sin emergencias registradas.' })}</div>
      </div>
      <div class="tarjeta mb-4"><h2 class="font-bold mb-3">Por año</h2>
        ${barrasHtml(Object.entries(porAnio).sort().map(([a, v]) => ({ etiqueta: a, valor: v, color: '#6d4c41' })), { formato: fmt, vacio: 'Sin datos.' })}</div>
      ${Object.keys(matriz).length ? `<div class="tarjeta p-0 overflow-x-auto"><table class="tabla min-w-[48rem]">
        <thead><tr><th>Tipo</th>${MESES.map((m) => `<th class="num">${m.slice(0, 3)}</th>`).join('')}<th class="num">Total</th></tr></thead>
        <tbody>${Object.entries(matriz).map(([id, fila]) => `<tr><td>${esc(nombreTipo(id))}</td>${fila.map((v) => `<td class="num">${v || ''}</td>`).join('')}<td class="num font-bold">${porTipo[id]}</td></tr>`).join('')}</tbody>
      </table></div>` : ''}`;
    $$('[data-anio]', zona).forEach((b) => b.addEventListener('click', () => { st.anio += Number(b.dataset.anio); renderVista(); }));
  }
};
