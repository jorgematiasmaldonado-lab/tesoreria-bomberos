/* =====================================================================
   configuracion.js · Datos del cuartel, saldos iniciales, listas
   editables, personal, móviles, usuarios, respaldo y auditoría
   ===================================================================== */
'use strict';

const SUBSECCIONES_CONFIG = [
  { id: 'cuartel', titulo: 'Cuartel' },
  { id: 'saldos', titulo: 'Saldos iniciales' },
  { id: 'listas', titulo: 'Listas' },
  { id: 'personal', titulo: 'Personal' },
  { id: 'moviles', titulo: 'Móviles' },
  { id: 'usuarios', titulo: 'Usuarios' },
  { id: 'respaldo', titulo: 'Respaldo' },
  { id: 'auditoria', titulo: 'Auditoría' }
];

Vistas.configuracion = {
  async render(cont) {
    const st = (App.estado.configuracion ||= { sub: 'cuartel', lista: 'categorias_ingreso' });
    cont.innerHTML = `
      <h1 class="text-2xl font-bold mb-3">Configuración</h1>
      <div class="flex gap-2 overflow-x-auto scroll-suave mb-4 pb-1">${SUBSECCIONES_CONFIG.map((s) =>
        `<button class="subpestana ${st.sub === s.id ? 'activa' : ''}" data-sub="${s.id}">${esc(s.titulo)}</button>`).join('')}</div>
      <div data-zona>${cargandoHtml()}</div>`;
    on(cont, 'click', '[data-sub]', (ev, b) => { st.sub = b.dataset.sub; renderVista(); });
    const zona = $('[data-zona]', cont);
    await this[st.sub](zona, st);
  },

  // ----------------------------------------------------------- Cuartel
  async cuartel(zona) {
    const c = await q(App.sb.from('config').select('*').eq('id', 1).maybeSingle()) || {};
    zona.innerHTML = `<form class="tarjeta space-y-3 max-w-2xl" novalidate>
      <p class="text-sm text-gray-600">Estos datos salen en los comprobantes e informes impresos.</p>
      <div><label class="etiqueta">Nombre de la asociación *</label><input name="nombre" value="${esc(c.nombre || '')}" class="campo"></div>
      <div class="grid sm:grid-cols-2 gap-3">
        <div><label class="etiqueta">Dirección</label><input name="direccion" value="${esc(c.direccion || '')}" class="campo"></div>
        <div><label class="etiqueta">Localidad</label><input name="localidad" value="${esc(c.localidad || '')}" class="campo"></div>
        <div><label class="etiqueta">Teléfono</label><input name="telefono" value="${esc(c.telefono || '')}" class="campo" inputmode="tel"></div>
        <div><label class="etiqueta">CUIT</label><input name="cuit" value="${esc(c.cuit || '')}" class="campo"></div>
        <div class="sm:col-span-2"><label class="etiqueta">Email</label><input name="email" type="email" value="${esc(c.email || '')}" class="campo"></div>
      </div>
      <button type="button" class="btn btn-primario" data-ok>Guardar</button>
    </form>`;
    const form = $('form', zona);
    $('[data-ok]', zona).addEventListener('click', (ev) => conBoton(ev.currentTarget, async () => {
      const d = leerForm(form);
      if (!d.nombre) return errorCampo(form, 'nombre', 'El nombre es obligatorio.');
      if (d.email && !/^\S+@\S+\.\S+$/.test(d.email)) return errorCampo(form, 'email', 'El email no es válido.');
      try { await q(App.sb.from('config').upsert({ id: 1, ...d })); App.config = { ...App.config, ...d }; toast('Datos del cuartel guardados.'); } catch (e) { toastError(e); }
    }));
  },

  // ----------------------------------------------------------- Saldos
  async saldos(zona) {
    const filas = await q(App.sb.from('saldos_iniciales').select('*'));
    const s = Object.fromEntries(filas.map((f) => [f.cuenta, f]));
    const bloque = (cuenta) => `
      <div class="border rounded-xl p-3 space-y-2"><div class="font-bold">${NOMBRE_CUENTA[cuenta]}</div>
        <div class="grid grid-cols-2 gap-2">
          <div><label class="etiqueta">Saldo inicial</label><input name="${cuenta}_monto" inputmode="decimal" value="${esc(montoInput(s[cuenta]?.monto ?? 0))}" class="campo"></div>
          <div><label class="etiqueta">Al día</label><input type="date" name="${cuenta}_fecha" value="${esc(s[cuenta]?.fecha || hoy().slice(0, 4) + '-01-01')}" class="campo"></div>
        </div></div>`;
    zona.innerHTML = `<form class="tarjeta space-y-3 max-w-2xl" novalidate>
      <p class="text-sm text-gray-600">El saldo de cada cuenta se calcula como el saldo inicial más los movimientos <b>desde esa fecha</b> en adelante.</p>
      <div class="grid sm:grid-cols-2 gap-3">${bloque('caja')}${bloque('banco')}</div>
      <button type="button" class="btn btn-primario" data-ok>Guardar</button></form>`;
    const form = $('form', zona);
    $('[data-ok]', zona).addEventListener('click', (ev) => conBoton(ev.currentTarget, async () => {
      const d = leerForm(form);
      const filasNuevas = [];
      for (const c of ['caja', 'banco']) {
        const monto = parseMonto(d[`${c}_monto`] || '0');
        if (!Number.isFinite(monto)) return errorCampo(form, `${c}_monto`, 'Monto inválido.');
        if (!esFechaValida(d[`${c}_fecha`])) return errorCampo(form, `${c}_fecha`, 'Fecha inválida.');
        filasNuevas.push({ cuenta: c, monto, fecha: d[`${c}_fecha`] });
      }
      try { await q(App.sb.from('saldos_iniciales').upsert(filasNuevas)); toast('Saldos iniciales guardados.'); } catch (e) { toastError(e); }
    }));
  },

  // ----------------------------------------------------------- Listas
  LISTAS: {
    categorias_ingreso: { titulo: 'Categorías de ingreso', tabla: 'categorias', filtro: { tipo: 'ingreso' }, activo: 'activa' },
    categorias_egreso: { titulo: 'Categorías de egreso', tabla: 'categorias', filtro: { tipo: 'egreso' }, activo: 'activa' },
    tipos_extintor: { titulo: 'Tipos de extintor', tabla: 'tipos_extintor' },
    tipos_emergencia: { titulo: 'Tipos de emergencia', tabla: 'tipos_emergencia' },
    tipos_nota: { titulo: 'Tipos de nota', tabla: 'tipos_nota' },
    niveles: { titulo: 'Niveles de combustible', tabla: 'niveles', extra: { campo: 'alerta', etiqueta: 'Alerta (rojo)' } }
  },
  async listas(zona, st) {
    zona.innerHTML = `
      <div class="flex gap-2 overflow-x-auto scroll-suave mb-3">${Object.entries(this.LISTAS).map(([id, l]) =>
        `<button class="subpestana ${st.lista === id ? 'activa' : ''}" data-lista="${id}">${esc(l.titulo)}</button>`).join('')}</div>
      <div data-editor></div>`;
    on(zona, 'click', '[data-lista]', (ev, b) => { st.lista = b.dataset.lista; renderVista(); });
    const l = this.LISTAS[st.lista];
    await ListaEditable.render($('[data-editor]', zona), {
      titulo: l.titulo, tabla: l.tabla, filtro: l.filtro || {}, campoActivo: l.activo || 'activo',
      campos: [{ campo: 'nombre', etiqueta: 'Nombre', requerido: true }],
      extra: l.extra,
      protegido: (f) => (f.sistema ? 'Categoría usada por el sistema (no se puede borrar).' : '')
    });
  },

  // ----------------------------------------------------------- Personal
  async personal(zona) {
    await ListaEditable.render(zona, {
      titulo: 'Personal (para el informe semanal)', tabla: 'personal', campoActivo: 'activo',
      campos: [{ campo: 'jerarquia', etiqueta: 'Jerarquía', ancho: 'sm:w-40', placeholder: 'Cabo' },
        { campo: 'nombre', etiqueta: 'Apellido y nombre', requerido: true, placeholder: 'Aguilera Cristian' }]
    });
  },

  // ----------------------------------------------------------- Móviles
  async moviles(zona) {
    const moviles = await q(App.sb.from('moviles_plantilla').select('*, moviles_items(*)').order('orden'));
    zona.innerHTML = `
      <p class="text-sm text-gray-600 mb-3">Plantilla de móviles, lugares e ítems que el encargado de semana completa con su nivel. Los cambios se guardan al salir de cada campo.</p>
      <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">${moviles.map((mv) => `
        <div class="tarjeta space-y-2" data-movil="${mv.id}">
          <div class="flex gap-2">
            <input class="campo campo-chico font-bold flex-1" data-campo="nombre" value="${esc(mv.nombre)}">
            <input class="campo campo-chico w-16" type="number" data-campo="orden" value="${mv.orden}" title="Orden">
          </div>
          <input class="campo campo-chico" data-campo="observacion" value="${esc(mv.observacion || '')}" placeholder="Observación sugerida (ej. nuevo)">
          <div class="flex items-center justify-between">
            <label class="flex items-center gap-2 text-sm"><input type="checkbox" data-campo="activo" ${mv.activo ? 'checked' : ''} class="w-5 h-5"> Activo</label>
            <button class="btn btn-peligro btn-chico" data-borrar-movil>Borrar</button>
          </div>
          <div class="border-t pt-2 space-y-1">${(mv.moviles_items || []).sort((a, b) => a.orden - b.orden).map((it) => `
            <div class="flex gap-1 items-center" data-item="${it.id}">
              <input class="campo campo-chico flex-1" data-campo-item="nombre" value="${esc(it.nombre)}">
              <input class="campo campo-chico w-14" type="number" data-campo-item="orden" value="${it.orden}">
              <input type="checkbox" data-campo-item="activo" ${it.activo ? 'checked' : ''} class="w-5 h-5" title="Activo">
              <button class="btn btn-peligro btn-icono" data-borrar-item title="Borrar">✕</button>
            </div>`).join('')}
            <div class="flex gap-1"><input class="campo campo-chico flex-1" data-nuevo-item placeholder="Nuevo ítem (ej. Tanque)">
              <button class="btn btn-secundario btn-chico" data-agregar-item>＋</button></div>
          </div>
        </div>`).join('')}
        <div class="tarjeta space-y-2">
          <div class="font-bold">Agregar móvil o lugar</div>
          <input class="campo" data-nuevo-movil placeholder="Ej.: Móvil 07 o Depósito">
          <button class="btn btn-primario w-full" data-agregar-movil>＋ Agregar</button>
        </div>
      </div>`;
    const guardar = async (tabla, id, cambios) => {
      try { await q(App.sb.from(tabla).update(cambios).eq('id', id)); toast('Guardado.', 'ok', 1500); cargarCatalogos().catch(() => {}); } catch (e) { toastError(e); }
    };
    zona.addEventListener('change', (ev) => {
      const t = ev.target;
      if (t.dataset.campo) {
        const v = t.type === 'checkbox' ? t.checked : t.type === 'number' ? Number(t.value) || 0 : t.value.trim();
        if (t.dataset.campo === 'nombre' && !v) return toast('El nombre no puede quedar vacío.', 'error');
        guardar('moviles_plantilla', t.closest('[data-movil]').dataset.movil, { [t.dataset.campo]: v });
      } else if (t.dataset.campoItem) {
        const v = t.type === 'checkbox' ? t.checked : t.type === 'number' ? Number(t.value) || 0 : t.value.trim();
        if (t.dataset.campoItem === 'nombre' && !v) return toast('El nombre no puede quedar vacío.', 'error');
        guardar('moviles_items', t.closest('[data-item]').dataset.item, { [t.dataset.campoItem]: v });
      }
    });
    on(zona, 'click', '[data-agregar-item]', async (ev, b) => {
      const card = b.closest('[data-movil]');
      const inp = $('[data-nuevo-item]', card);
      if (!inp.value.trim()) return toast('Escribí el nombre del ítem.', 'error');
      const orden = $$('[data-item]', card).length + 1;
      try { await q(App.sb.from('moviles_items').insert({ movil_id: card.dataset.movil, nombre: inp.value.trim(), orden })); toast('Ítem agregado.'); refrescarVista(); } catch (e) { toastError(e); }
    });
    on(zona, 'click', '[data-borrar-item]', async (ev, b) => {
      const fila = b.closest('[data-item]');
      if (!(await confirmar(`¿Borrar el ítem "${$('input', fila).value}"? Se borran también sus niveles cargados en informes anteriores. Si solo ya no se usa, conviene desactivarlo.`))) return;
      try { await q(App.sb.from('moviles_items').delete().eq('id', fila.dataset.item)); toast('Ítem borrado.'); refrescarVista(); } catch (e) { toastError(e); }
    });
    on(zona, 'click', '[data-borrar-movil]', async (ev, b) => {
      const card = b.closest('[data-movil]');
      if (!(await confirmar(`¿Borrar "${$('[data-campo="nombre"]', card).value}" y todos sus ítems?`))) return;
      try { await q(App.sb.from('moviles_plantilla').delete().eq('id', card.dataset.movil)); toast('Móvil borrado.'); refrescarVista(); } catch (e) { toastError(e); }
    });
    on(zona, 'click', '[data-agregar-movil]', async () => {
      const inp = $('[data-nuevo-movil]', zona);
      if (!inp.value.trim()) return toast('Escribí el nombre del móvil.', 'error');
      try { await q(App.sb.from('moviles_plantilla').insert({ nombre: inp.value.trim(), orden: moviles.length + 1 })); toast('Móvil agregado.'); refrescarVista(); } catch (e) { toastError(e); }
    });
  },

  // ----------------------------------------------------------- Usuarios
  async usuarios(zona) {
    const perfiles = await q(App.sb.from('perfiles').select('*').order('activo', { ascending: false }).order('nombre'));
    const rolesOpc = Object.entries(ROLES).map(([id, nombre]) => ({ id, nombre }));
    zona.innerHTML = `
      <div class="grid lg:grid-cols-3 gap-4">
        <form class="tarjeta space-y-3" novalidate data-alta>
          <h2 class="font-bold text-lg">Nuevo usuario</h2>
          <div><label class="etiqueta">Nombre y apellido *</label><input name="nombre" class="campo"></div>
          <div><label class="etiqueta">Email *</label><input name="email" type="email" class="campo" autocomplete="off"></div>
          <div><label class="etiqueta">Contraseña inicial * (mín. 6)</label><input name="password" type="text" class="campo" autocomplete="off"></div>
          <div><label class="etiqueta">Rol *</label><select name="rol" class="campo">${opcionesHtml(rolesOpc, 'encargado')}</select></div>
          <button type="button" class="btn btn-primario w-full" data-crear>Crear usuario</button>
          <p class="text-xs text-gray-500">La persona ingresa con ese email y contraseña, y después puede cambiarla desde "🔑 Contraseña".</p>
        </form>
        <div class="tarjeta lg:col-span-2">
          <h2 class="font-bold text-lg mb-2">Usuarios</h2>
          <div class="divide-y">${perfiles.map((p) => {
            const yo = p.id === App.usuario.id;
            return `<div class="py-3 grid sm:grid-cols-12 gap-2 items-center" data-perfil="${p.id}">
              <div class="sm:col-span-4 min-w-0">
                <input class="campo campo-chico font-semibold" data-campo="nombre" value="${esc(p.nombre)}">
                <div class="text-xs text-gray-500 truncate mt-1">${esc(p.email || '')}${yo ? ' · (vos)' : ''}</div>
              </div>
              <div class="sm:col-span-3"><select class="campo campo-chico" data-campo="rol" ${yo ? 'disabled' : ''}>${opcionesHtml(rolesOpc, p.rol, { vacio: '— Sin rol —' })}</select></div>
              <label class="sm:col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" data-campo="activo" ${p.activo ? 'checked' : ''} ${yo ? 'disabled' : ''} class="w-5 h-5"> Activo</label>
              <div class="sm:col-span-3 text-right"><button class="btn btn-secundario btn-chico" data-reset="${esc(p.email || '')}">✉ Recuperar contraseña</button></div>
              ${!p.rol ? '<div class="sm:col-span-12 text-xs text-amber-700">Usuario sin rol: no puede ver nada hasta que le asignes un rol y lo actives.</div>' : ''}
            </div>`;
          }).join('')}</div>
        </div>
      </div>`;

    zona.addEventListener('change', async (ev) => {
      const t = ev.target;
      const fila = t.closest('[data-perfil]');
      if (!fila || !t.dataset.campo) return;
      const v = t.type === 'checkbox' ? t.checked : t.value.trim();
      const cambios = { [t.dataset.campo]: t.dataset.campo === 'rol' ? (v || null) : v };
      // Al asignar un rol a un usuario nuevo se lo activa automáticamente
      if (t.dataset.campo === 'rol' && v && !$('[data-campo="activo"]', fila).checked) { cambios.activo = true; $('[data-campo="activo"]', fila).checked = true; }
      try { await q(App.sb.from('perfiles').update(cambios).eq('id', fila.dataset.perfil)); toast('Usuario actualizado.', 'ok', 1800); } catch (e) { toastError(e); refrescarVista(); }
    });
    on(zona, 'click', '[data-reset]', async (ev, b) => {
      const email = b.dataset.reset;
      if (!email) return toast('Este usuario no tiene email registrado.', 'error');
      if (!(await confirmar(`¿Enviar a ${email} un email para crear una nueva contraseña?`, { textoOk: 'Enviar', peligro: false }))) return;
      const { error } = await App.sb.auth.resetPasswordForEmail(email, { redirectTo: urlApp() });
      if (error) return toastError(error);
      toast('Email de recuperación enviado.');
    });

    const form = $('[data-alta]', zona);
    $('[data-crear]', form).addEventListener('click', (ev) => conBoton(ev.currentTarget, async () => {
      const d = leerForm(form);
      if (!d.nombre) return errorCampo(form, 'nombre', 'El nombre es obligatorio.');
      if (!/^\S+@\S+\.\S+$/.test(d.email)) return errorCampo(form, 'email', 'El email no es válido.');
      if (d.password.length < 6) return errorCampo(form, 'password', 'La contraseña debe tener al menos 6 caracteres.');
      try {
        // Cliente secundario SIN sesión persistente: así no se cierra la sesión de Tesorería
        const secundario = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'bv-alta-usuarios' }
        });
        const { data, error } = await secundario.auth.signUp({ email: d.email, password: d.password, options: { data: { nombre: d.nombre } } });
        if (error) throw error;
        if (!data.user || (Array.isArray(data.user.identities) && !data.user.identities.length)) throw new Error('Ya existe un usuario con ese email.');
        await secundario.auth.signOut().catch(() => {});
        // Tesorería asigna el rol y activa el perfil (lo creó inactivo el trigger de la base)
        await q(App.sb.from('perfiles').update({ nombre: d.nombre, rol: d.rol, activo: true }).eq('id', data.user.id));
        toast(`Usuario ${d.email} creado como ${ROLES[d.rol]}.`, 'ok', 5000);
        if (!data.session) toast('Atención: la confirmación de email está activada en Supabase; el usuario deberá confirmar su email (ver GUIA).', 'info', 8000);
        refrescarVista();
      } catch (e) { toastError(e); }
    }, 'Creando…'));
  },

  // ----------------------------------------------------------- Respaldo
  TABLAS_RESPALDO: ['config', 'saldos_iniciales', 'categorias', 'movimientos', 'adjuntos', 'subsidios', 'gastos_encargado',
    'ext_ordenes', 'ext_items', 'socios', 'cuotas_pagadas', 'presupuesto', 'personal', 'moviles_plantilla', 'moviles_items',
    'informes_semanales', 'inf_emergencias', 'inf_novedades', 'inf_pendientes', 'inf_niveles', 'tipos_emergencia',
    'tipos_extintor', 'tipos_nota', 'niveles', 'notas', 'perfiles', 'auditoria'],
  async respaldo(zona) {
    zona.innerHTML = `<div class="tarjeta space-y-4 max-w-2xl">
      <p class="text-sm text-gray-600">Descargá una copia de seguridad de todos los datos. Conviene hacerlo una vez por mes y guardarla en un lugar seguro.
        Los archivos adjuntos (fotos y PDF) quedan en Supabase Storage y no se incluyen.</p>
      <button class="btn btn-primario w-full sm:w-auto" data-json>⬇ Respaldo completo (JSON)</button>
      <div class="border-t pt-4">
        <label class="etiqueta">Exportar una tabla a Excel (CSV)</label>
        <div class="flex gap-2"><select class="campo" data-tabla>${opcionesHtml(this.TABLAS_RESPALDO, 'movimientos')}</select>
          <button class="btn btn-secundario" data-csv>⬇ CSV</button></div>
        <button class="btn btn-secundario mt-3" data-csv-todas>⬇ Todas las tablas en CSV (varios archivos)</button>
      </div>
      <div data-progreso class="text-sm text-gray-600"></div>
    </div>`;
    const prog = $('[data-progreso]', zona);
    const traer = (t) => qTodo(() => App.sb.from(t).select('*').order(t === 'auditoria' ? 'id' : (t === 'saldos_iniciales' ? 'cuenta' : 'creado_en')));
    $('[data-json]', zona).addEventListener('click', (ev) => conBoton(ev.currentTarget, async () => {
      try {
        const datos = { sistema: 'Tesorería BV Villa Río Icho Cruz', exportado: new Date().toISOString(), tablas: {} };
        for (const t of this.TABLAS_RESPALDO) { prog.textContent = `Leyendo ${t}…`; datos.tablas[t] = await traer(t); }
        descargar(JSON.stringify(datos, null, 2), `respaldo_bv_${hoy()}.json`, 'application/json');
        prog.textContent = '✅ Respaldo descargado.';
      } catch (e) { prog.textContent = ''; toastError(e); }
    }, 'Preparando…'));
    $('[data-csv]', zona).addEventListener('click', (ev) => conBoton(ev.currentTarget, async () => {
      const t = $('[data-tabla]', zona).value;
      try { exportarCSVCrudo(`${t}_${hoy()}.csv`, await traer(t)); } catch (e) { toastError(e); }
    }, 'Exportando…'));
    $('[data-csv-todas]', zona).addEventListener('click', (ev) => conBoton(ev.currentTarget, async () => {
      try {
        for (const t of this.TABLAS_RESPALDO) {
          prog.textContent = `Exportando ${t}…`;
          exportarCSVCrudo(`${t}_${hoy()}.csv`, await traer(t));
          await new Promise((r) => setTimeout(r, 400));
        }
        prog.textContent = '✅ Listo. Si el navegador lo pregunta, permití las descargas múltiples.';
      } catch (e) { prog.textContent = ''; toastError(e); }
    }, 'Exportando…'));
  },

  // ----------------------------------------------------------- Auditoría
  async auditoria(zona) { await Auditoria.render(zona); }
};

// ---------------------------------------------------------------------
// Editor genérico de listas (nombre, orden, activo + campos extra)
// Guarda cada cambio al salir del campo.
// ---------------------------------------------------------------------
const ListaEditable = {
  async render(zona, op) {
    let consulta = App.sb.from(op.tabla).select('*');
    for (const [k, v] of Object.entries(op.filtro || {})) consulta = consulta.eq(k, v);
    const filas = await q(consulta.order('orden').order('nombre'));
    const act = op.campoActivo || 'activo';
    const inputs = (f = {}) => op.campos.map((c) => `
      <input class="campo campo-chico ${c.ancho || 'flex-1'} min-w-0" data-campo="${c.campo}" value="${esc(f[c.campo] || '')}" placeholder="${esc(c.placeholder || c.etiqueta)}" ${c.requerido ? 'data-req' : ''}>`).join('');
    zona.innerHTML = `<div class="tarjeta max-w-3xl">
      <h2 class="font-bold text-lg mb-1">${esc(op.titulo)}</h2>
      <p class="text-xs text-gray-500 mb-3">Los cambios se guardan al salir de cada campo. Si un elemento ya no se usa, desactivalo en vez de borrarlo.</p>
      <div class="space-y-2">${filas.map((f) => `
        <div class="flex flex-wrap sm:flex-nowrap gap-2 items-center border-b pb-2" data-fila="${f.id}">
          ${inputs(f)}
          <input type="number" class="campo campo-chico w-16" data-campo="orden" value="${f.orden}" title="Orden">
          ${op.extra ? `<label class="flex items-center gap-1 text-sm whitespace-nowrap"><input type="checkbox" data-campo="${op.extra.campo}" ${f[op.extra.campo] ? 'checked' : ''} class="w-5 h-5"> ${esc(op.extra.etiqueta)}</label>` : ''}
          <label class="flex items-center gap-1 text-sm"><input type="checkbox" data-campo="${act}" ${f[act] ? 'checked' : ''} class="w-5 h-5"> Activo</label>
          ${op.protegido?.(f) ? `<span class="text-xs text-gray-400" title="${esc(op.protegido(f))}">🔒</span>`
            : '<button class="btn btn-peligro btn-icono" data-borrar title="Borrar">✕</button>'}
        </div>`).join('') || vacioHtml('No hay elementos.')}</div>
      <div class="flex flex-wrap sm:flex-nowrap gap-2 mt-4 pt-3 border-t" data-nueva>${inputs()}
        <button class="btn btn-primario btn-chico" data-agregar>＋ Agregar</button></div>
    </div>`;

    zona.addEventListener('change', async (ev) => {
      const t = ev.target;
      const fila = t.closest('[data-fila]');
      if (!fila || !t.dataset.campo) return;
      const v = t.type === 'checkbox' ? t.checked : t.type === 'number' ? Number(t.value) || 0 : t.value.trim();
      if (t.hasAttribute('data-req') && !v) { t.classList.add('error'); return toast('Este campo es obligatorio.', 'error'); }
      try { await q(App.sb.from(op.tabla).update({ [t.dataset.campo]: v }).eq('id', fila.dataset.fila)); toast('Guardado.', 'ok', 1500); cargarCatalogos().catch(() => {}); }
      catch (e) { toastError(e); }
    });
    on(zona, 'click', '[data-borrar]', async (ev, b) => {
      const fila = b.closest('[data-fila]');
      if (!(await confirmar(`¿Borrar "${$('[data-campo]', fila).value}"?`))) return;
      try { await q(App.sb.from(op.tabla).delete().eq('id', fila.dataset.fila)); toast('Borrado.'); refrescarVista(); } catch (e) { toastError(e); }
    });
    on(zona, 'click', '[data-agregar]', async (ev, b) => {
      const cont = $('[data-nueva]', zona);
      const fila = { ...(op.filtro || {}), orden: filas.length + 1 };
      for (const inp of $$('[data-campo]', cont)) {
        if (inp.hasAttribute('data-req') && !inp.value.trim()) { inp.classList.add('error'); inp.focus(); return toast('Completá el nombre.', 'error'); }
        fila[inp.dataset.campo] = inp.value.trim();
      }
      await conBoton(b, async () => {
        try { await q(App.sb.from(op.tabla).insert(fila)); toast('Agregado.'); await cargarCatalogos(); refrescarVista(); } catch (e) { toastError(e); }
      });
    });
  }
};

// ---------------------------------------------------------------------
// Auditoría: historial de cambios y borrados (Tesorería y Comisión)
// ---------------------------------------------------------------------
const Auditoria = {
  async render(zona) {
    const st = (App.estado.auditoria ||= { tabla: '', operacion: '', desde: sumarDias(hoy(), -30), hasta: hoy(), limite: 100 });
    zona.innerHTML = `
      <div class="tarjeta mb-3 grid grid-cols-2 md:grid-cols-5 gap-2 items-end" data-filtros>
        <div><label class="etiqueta">Tabla</label><select name="tabla" class="campo campo-chico">${opcionesHtml(Vistas.configuracion.TABLAS_RESPALDO.filter((t) => t !== 'auditoria'), st.tabla, { vacio: 'Todas' })}</select></div>
        <div><label class="etiqueta">Operación</label><select name="operacion" class="campo campo-chico">${opcionesHtml([{ id: 'UPDATE', nombre: 'Cambios' }, { id: 'DELETE', nombre: 'Borrados' }], st.operacion, { vacio: 'Todas' })}</select></div>
        <div><label class="etiqueta">Desde</label><input type="date" name="desde" value="${esc(st.desde)}" class="campo campo-chico"></div>
        <div><label class="etiqueta">Hasta</label><input type="date" name="hasta" value="${esc(st.hasta)}" class="campo campo-chico"></div>
      </div>
      <div data-lista>${cargandoHtml()}</div>`;
    $('[data-filtros]', zona).addEventListener('change', () => { Object.assign(st, leerForm($('[data-filtros]', zona)), { limite: 100 }); this.render(zona); });

    let c = App.sb.from('auditoria').select('*').order('id', { ascending: false }).limit(st.limite);
    if (st.tabla) c = c.eq('tabla', st.tabla);
    if (st.operacion) c = c.eq('operacion', st.operacion);
    if (esFechaValida(st.desde)) c = c.gte('fecha', st.desde + 'T00:00:00');
    if (esFechaValida(st.hasta)) c = c.lte('fecha', st.hasta + 'T23:59:59.999');
    const filas = await q(c);
    const ignorar = new Set(['modificado_por', 'modificado_en', 'creado_por', 'creado_en']);
    const diferencias = (a) => {
      if (a.operacion !== 'UPDATE' || !a.datos_nuevos) return '';
      const cambios = Object.keys(a.datos_nuevos).filter((k) => !ignorar.has(k)
        && JSON.stringify(a.datos_anteriores?.[k]) !== JSON.stringify(a.datos_nuevos[k]));
      return cambios.map((k) => `<div><b>${esc(k)}</b>: <span class="line-through text-red-700">${esc(JSON.stringify(a.datos_anteriores?.[k]))}</span> → <span class="text-green-800">${esc(JSON.stringify(a.datos_nuevos[k]))}</span></div>`).join('');
    };
    $('[data-lista]', zona).innerHTML = !filas.length ? `<div class="tarjeta">${vacioHtml('No hay registros en la auditoría para estos filtros.')}</div>` : `
      <div class="space-y-2">${filas.map((a, i) => `
        <div class="tarjeta p-3 text-sm">
          <div class="flex flex-wrap gap-2 items-center">
            <span class="chip ${a.operacion === 'DELETE' ? 'chip-rojo' : 'chip-amarillo'}">${a.operacion === 'DELETE' ? 'Borrado' : 'Cambio'}</span>
            <b>${esc(a.tabla)}</b><span class="text-gray-500">${fechaHora(a.fecha)} · ${esc(a.usuario_nombre || 'Sistema')}</span>
            <button class="ml-auto text-xs underline" data-ver="${i}">Ver datos anteriores</button>
          </div>
          <div class="mt-1 text-xs break-all">${diferencias(a)}</div>
          <pre class="hidden mt-2 text-xs bg-gray-50 p-2 rounded overflow-x-auto" data-json="${i}">${esc(JSON.stringify(a.datos_anteriores, null, 2))}</pre>
        </div>`).join('')}</div>
      ${filas.length >= st.limite ? '<div class="text-center mt-3"><button class="btn btn-secundario" data-mas>Cargar más</button></div>' : ''}`;
    on($('[data-lista]', zona), 'click', '[data-ver]', (ev, b) => $(`[data-json="${b.dataset.ver}"]`, zona).classList.toggle('hidden'));
    $('[data-mas]', zona)?.addEventListener('click', () => { st.limite += 100; this.render(zona); });
  }
};

/** Vista de auditoría para la Comisión directiva (solo lectura) */
Vistas.auditoria = {
  async render(cont) {
    cont.innerHTML = '<h1 class="text-2xl font-bold mb-3">Auditoría</h1><div data-zona></div>';
    await Auditoria.render($('[data-zona]', cont));
  }
};
