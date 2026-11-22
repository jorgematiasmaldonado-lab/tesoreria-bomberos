/* =====================================================================
   app.js · Núcleo de la aplicación: sesión, roles, menú, tiempo real
   Sistema de Tesorería y Gestión · BV Villa Río Icho Cruz
   Desarrollado por Maldonado Jorge Matias · JMM Gestiones & Tecnología
   ===================================================================== */
'use strict';

/** Estado global de la aplicación */
const App = {
  sb: null,            // cliente de Supabase
  usuario: null,       // usuario de Auth
  perfil: null,        // fila de la tabla perfiles
  rol: null,
  config: {},          // datos del cuartel
  cat: {},             // catálogos (categorías, personal, tipos, etc.)
  vista: null,         // sección actual
  estado: {},          // filtros de cada sección (se conservan al refrescar)
  modales: 0,          // cantidad de modales abiertos
  refrescoPendiente: false,
  ocupada: false,      // true si la vista tiene cambios sin guardar
  canal: null
};

const ROLES = {
  tesoreria: 'Tesorería',
  comision: 'Comisión directiva',
  extintores: 'Extintores',
  encargado: 'Encargado de semana'
};

/** Secciones del menú y roles que pueden verlas */
const SECCIONES = [
  { id: 'resumen', titulo: 'Resumen', roles: ['tesoreria', 'comision'] },
  { id: 'movimientos', titulo: 'Movimientos', roles: ['tesoreria', 'comision'] },
  { id: 'gastos', titulo: 'Gastos a aprobar', roles: ['tesoreria', 'comision'] },
  { id: 'subsidios', titulo: 'Subsidios', roles: ['tesoreria', 'comision'] },
  { id: 'extintores', titulo: 'Extintores', roles: ['tesoreria', 'comision', 'extintores'] },
  { id: 'socios', titulo: 'Socios', roles: ['tesoreria', 'comision'] },
  { id: 'presupuesto', titulo: 'Presupuesto', roles: ['tesoreria', 'comision'] },
  { id: 'informes', titulo: 'Informes', roles: ['tesoreria', 'comision'] },
  { id: 'encargado', titulo: 'Encargado de semana', roles: ['tesoreria', 'comision', 'encargado'] },
  { id: 'notas', titulo: 'Notas', roles: ['tesoreria', 'comision', 'encargado'] },
  { id: 'auditoria', titulo: 'Auditoría', roles: ['comision'] },
  { id: 'configuracion', titulo: 'Configuración', roles: ['tesoreria'] }
];

/** Cada módulo registra aquí su vista: Vistas.movimientos = { render(cont) } */
const Vistas = {};

const esTesoreria = () => App.rol === 'tesoreria';
const puedeVer = (seccion) => SECCIONES.find((s) => s.id === seccion)?.roles.includes(App.rol);

// ---------------------------------------------------------------------
// Inicio
// ---------------------------------------------------------------------
function mostrarPantalla(id) {
  for (const p of ['pantalla-carga', 'pantalla-sin-config', 'pantalla-login', 'app']) {
    document.getElementById(p).classList.toggle('hidden', p !== id);
  }
}

async function iniciar() {
  registrarServiceWorker();
  vigilarConexion();

  const cfg = window.CONFIG || {};
  if (!cfg.SUPABASE_URL || /TU-PROYECTO/.test(cfg.SUPABASE_URL) || !cfg.SUPABASE_ANON_KEY || /PEGAR/.test(cfg.SUPABASE_ANON_KEY)) {
    mostrarPantalla('pantalla-sin-config');
    return;
  }
  if (!window.supabase?.createClient) {
    mostrarPantalla('pantalla-sin-config');
    $('#pantalla-sin-config p').textContent = 'No se pudo cargar la librería de Supabase. Revisá la conexión a internet y recargá la página.';
    return;
  }

  // La sesión queda guardada en el dispositivo (persistSession)
  App.sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  App.sb.auth.onAuthStateChange((evento, sesion) => {
    // No llamar a Supabase dentro del callback (se difiere con setTimeout)
    if (evento === 'PASSWORD_RECOVERY') setTimeout(() => modalNuevaContrasena(true), 0);
    if (evento === 'SIGNED_OUT') setTimeout(() => salirLocal(), 0);
    if (evento === 'SIGNED_IN' && sesion && !App.usuario) setTimeout(() => entrar(sesion.user), 0);
  });

  conectarLogin();
  const { data } = await App.sb.auth.getSession();
  if (data.session) await entrar(data.session.user);
  else mostrarPantalla('pantalla-login');
}

function conectarLogin() {
  const form = $('#form-login');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const { email, password } = leerForm(form);
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) return errorCampo(form, 'email', 'Ingresá un email válido.');
    if (!password) return errorCampo(form, 'password', 'Ingresá la contraseña.');
    await conBoton($('button[type=submit]', form), async () => {
      const { data, error } = await App.sb.auth.signInWithPassword({ email, password });
      if (error) return toastError(error);
      form.reset();
      await entrar(data.user);
    }, 'Ingresando…');
  });
  $('#btn-olvide').addEventListener('click', async () => {
    const email = $('#login-email').value.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) return errorCampo(form, 'email', 'Escribí tu email y volvé a tocar “¿Olvidaste tu contraseña?”.');
    const { error } = await App.sb.auth.resetPasswordForEmail(email, { redirectTo: urlApp() });
    if (error) return toastError(error);
    toast('Te enviamos un email para crear una nueva contraseña.', 'ok', 6000);
  });
  $('#btn-salir').addEventListener('click', salir);
  $('#btn-cuenta').addEventListener('click', () => modalNuevaContrasena(false));
}

function urlApp() { return location.origin + location.pathname; }

/** Carga el perfil del usuario y arma la aplicación según su rol */
async function entrar(usuario) {
  if (App.usuario && App.usuario.id === usuario.id && App.perfil) return;
  App.usuario = usuario;
  mostrarPantalla('pantalla-carga');
  try {
    const perfil = await q(App.sb.from('perfiles').select('*').eq('id', usuario.id).maybeSingle());
    if (!perfil || !perfil.activo || !perfil.rol) {
      mostrarPantalla('pantalla-login');
      toast(perfil && !perfil.activo && perfil.rol
        ? 'Tu usuario está desactivado. Consultá con Tesorería.'
        : 'Tu usuario todavía no tiene un rol asignado. Pedile a Tesorería que lo active.', 'error', 7000);
      App.usuario = null;
      await App.sb.auth.signOut();
      return;
    }
    App.perfil = perfil;
    App.rol = perfil.rol;
    $('#usuario-nombre').textContent = perfil.nombre || usuario.email;
    $('#usuario-rol').textContent = ROLES[perfil.rol];
    await cargarCatalogos();
    armarMenu();
    conectarTiempoReal();
    mostrarPantalla('app');
    window.addEventListener('hashchange', irASeccionDelHash);
    irASeccionDelHash();
  } catch (e) {
    App.usuario = null;
    mostrarPantalla('pantalla-login');
    toastError(e);
  }
}

async function salir() {
  if (!(await confirmar('¿Cerrar la sesión en este dispositivo?', { titulo: 'Salir', textoOk: 'Salir' }))) return;
  await App.sb.auth.signOut();
  salirLocal();
}
function salirLocal() {
  if (App.canal) { App.sb.removeChannel(App.canal); App.canal = null; }
  App.usuario = App.perfil = App.rol = null;
  App.estado = {};
  App.ocupada = false;
  window.removeEventListener('hashchange', irASeccionDelHash);
  $('#vista').innerHTML = '';
  $('#menu').innerHTML = '';
  mostrarPantalla('pantalla-login');
}

/** Cambiar contraseña (desde el menú o desde el email de recuperación) */
function modalNuevaContrasena(desdeRecuperacion) {
  const m = abrirModal({
    titulo: desdeRecuperacion ? 'Crear nueva contraseña' : 'Cambiar mi contraseña',
    cuerpo: `<form class="space-y-3" novalidate>
      <div><label class="etiqueta">Nueva contraseña (mínimo 6 caracteres)</label><input name="p1" type="password" class="campo" autocomplete="new-password"></div>
      <div><label class="etiqueta">Repetir contraseña</label><input name="p2" type="password" class="campo" autocomplete="new-password"></div>
    </form>`,
    pie: `<button class="btn btn-secundario" data-cerrar>Cancelar</button><button class="btn btn-primario" data-ok>Guardar</button>`
  });
  const form = $('form', m.el);
  $('[data-ok]', m.el).addEventListener('click', (ev) => conBoton(ev.currentTarget, async () => {
    const { p1, p2 } = leerForm(form);
    if (p1.length < 6) return errorCampo(form, 'p1', 'La contraseña debe tener al menos 6 caracteres.');
    if (p1 !== p2) return errorCampo(form, 'p2', 'Las contraseñas no coinciden.');
    const { error } = await App.sb.auth.updateUser({ password: p1 });
    if (error) return toastError(error);
    toast('Contraseña actualizada.');
    m.cerrar();
    if (desdeRecuperacion) history.replaceState(null, '', urlApp());
  }));
}

// ---------------------------------------------------------------------
// Catálogos (listas que usan varias pantallas)
// ---------------------------------------------------------------------
async function cargarCatalogos() {
  const r = App.rol;
  const tareas = {
    config: () => App.sb.from('config').select('*').eq('id', 1).maybeSingle()
  };
  if (['tesoreria', 'comision'].includes(r)) {
    tareas.categorias = () => App.sb.from('categorias').select('*').order('tipo').order('orden').order('nombre');
    tareas.subsidios = () => App.sb.from('subsidios').select('id, nombre, organismo').order('fecha_otorgamiento', { ascending: false });
  }
  if (['tesoreria', 'comision', 'encargado'].includes(r)) {
    tareas.personal = () => App.sb.from('personal').select('*').order('orden').order('nombre');
    tareas.tiposEmergencia = () => App.sb.from('tipos_emergencia').select('*').order('orden').order('nombre');
    tareas.niveles = () => App.sb.from('niveles').select('*').order('orden');
    tareas.moviles = () => App.sb.from('moviles_plantilla').select('*, moviles_items(*)').order('orden');
    tareas.tiposNota = () => App.sb.from('tipos_nota').select('*').order('orden').order('nombre');
  }
  if (['tesoreria', 'comision', 'extintores'].includes(r)) {
    tareas.tiposExtintor = () => App.sb.from('tipos_extintor').select('*').order('orden').order('nombre');
  }
  const claves = Object.keys(tareas);
  const resultados = await Promise.all(claves.map((k) => q(tareas[k]())));
  claves.forEach((k, i) => {
    if (k === 'config') App.config = resultados[i] || {};
    else App.cat[k] = resultados[i] || [];
  });
  (App.cat.moviles || []).forEach((mv) => (mv.moviles_items || []).sort((a, b) => a.orden - b.orden));
}

const Cat = {
  categoria: (id) => (App.cat.categorias || []).find((c) => c.id === id),
  nombreCategoria: (id) => Cat.categoria(id)?.nombre || '—',
  categorias: (tipo, soloActivas = true) => (App.cat.categorias || []).filter((c) => c.tipo === tipo && (!soloActivas || c.activa)),
  persona: (id) => (App.cat.personal || []).find((p) => p.id === id),
  nombrePersona: (p) => (p ? `${p.jerarquia ? p.jerarquia + ' ' : ''}${p.nombre}` : ''),
  nivel: (id) => (App.cat.niveles || []).find((n) => n.id === id)
};

// ---------------------------------------------------------------------
// Menú y navegación
// ---------------------------------------------------------------------
function armarMenu() {
  const permitidas = SECCIONES.filter((s) => s.roles.includes(App.rol));
  $('#menu').innerHTML = `<div class="max-w-7xl mx-auto px-1">${permitidas
    .map((s) => `<a href="#${s.id}" class="pestana" data-seccion="${s.id}">${esc(s.titulo)}</a>`).join('')}</div>`;
}

function irASeccionDelHash() {
  const permitidas = SECCIONES.filter((s) => s.roles.includes(App.rol));
  let id = location.hash.replace('#', '').split('/')[0];
  if (!permitidas.some((s) => s.id === id)) {
    id = permitidas[0].id;
    history.replaceState(null, '', '#' + id);
  }
  if (App.ocupada && App.vista && App.vista !== id) {
    if (!window.confirm('Hay cambios sin guardar. ¿Salir de esta pantalla igual?')) {
      history.replaceState(null, '', '#' + App.vista);
      return;
    }
  }
  App.ocupada = false;
  App.vista = id;
  $$('#menu .pestana').forEach((a) => {
    a.classList.toggle('activa', a.dataset.seccion === id);
    if (a.dataset.seccion === id) a.scrollIntoView({ block: 'nearest', inline: 'center' });
  });
  window.scrollTo(0, 0);
  renderVista();
}

/** Dibuja la vista actual en un contenedor nuevo (así no se duplican eventos) */
async function renderVista() {
  const id = App.vista;
  const main = $('#vista');
  const cont = document.createElement('div');
  main.replaceChildren(cont);
  if (!Vistas[id]) { cont.innerHTML = vacioHtml('Sección no disponible.'); return; }
  try {
    await Vistas[id].render(cont);
  } catch (e) {
    console.error(e);
    if (App.vista !== id) return;
    cont.innerHTML = `<div class="tarjeta text-center space-y-3">
      <p class="text-red-700 font-semibold">${esc(mensajeError(e))}</p>
      <button class="btn btn-primario" data-reintentar>Reintentar</button></div>`;
    $('[data-reintentar]', cont).addEventListener('click', renderVista);
  }
}

/** Vuelve a dibujar la vista conservando la posición de la pantalla */
async function refrescarVista() {
  if (!App.vista) return;
  if (App.modales) { App.refrescoPendiente = true; return; }
  if (App.ocupada) { avisoCambiosExternos(); return; }
  const y = window.scrollY;
  await renderVista();
  window.scrollTo(0, y);
}

function avisoCambiosExternos() {
  if ($('#aviso-externo')) return;
  const el = document.createElement('div');
  el.id = 'aviso-externo';
  el.className = 'no-print fixed top-28 inset-x-0 z-40 flex justify-center px-4';
  el.innerHTML = `<div class="bg-gray-900 text-white rounded-xl shadow-lg px-4 py-2 flex items-center gap-3 text-sm">
    Otro usuario modificó datos.
    <button class="underline font-semibold" data-recargar>Recargar</button>
    <button class="opacity-70" data-cerrar-aviso>✕</button></div>`;
  document.body.appendChild(el);
  el.addEventListener('click', async (ev) => {
    if (ev.target.closest('[data-recargar]')) {
      if (App.ocupada && !window.confirm('Se perderán los cambios sin guardar. ¿Recargar?')) return;
      App.ocupada = false; el.remove(); refrescarVista();
    }
    if (ev.target.closest('[data-cerrar-aviso]')) el.remove();
  });
}

// ---------------------------------------------------------------------
// Tiempo real: cualquier cambio en la base refresca la pantalla abierta
// ---------------------------------------------------------------------
const TABLAS_CATALOGO = ['config', 'categorias', 'subsidios', 'personal', 'tipos_emergencia', 'niveles',
  'moviles_plantilla', 'moviles_items', 'tipos_nota', 'tipos_extintor'];

function conectarTiempoReal() {
  if (App.canal) App.sb.removeChannel(App.canal);
  let recargarCatalogos = false;
  const aplicar = debounce(async () => {
    try {
      if (recargarCatalogos) { recargarCatalogos = false; await cargarCatalogos(); }
    } catch (e) { console.warn(e); }
    refrescarVista();
  }, 700);

  App.canal = App.sb.channel('bv-cambios')
    .on('postgres_changes', { event: '*', schema: 'public' }, (cambio) => {
      if (cambio.table === 'perfiles' && cambio.new?.id === App.usuario?.id) {
        // Si Tesorería cambió mi rol o me desactivó, se vuelve a cargar todo
        if (!cambio.new.activo || cambio.new.rol !== App.rol) { location.reload(); return; }
      }
      if (TABLAS_CATALOGO.includes(cambio.table)) recargarCatalogos = true;
      aplicar();
    })
    .subscribe();
}

// ---------------------------------------------------------------------
// Conexión y PWA
// ---------------------------------------------------------------------
function vigilarConexion() {
  const aviso = $('#aviso-offline');
  const actualizar = () => aviso.classList.toggle('hidden', navigator.onLine);
  window.addEventListener('online', () => { actualizar(); toast('Conexión restablecida.'); refrescarVista(); });
  window.addEventListener('offline', actualizar);
  actualizar();
}

function registrarServiceWorker() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker:', e));
  }
}

document.addEventListener('DOMContentLoaded', iniciar);
