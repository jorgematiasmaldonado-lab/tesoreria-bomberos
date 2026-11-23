-- =====================================================================
--  Sistema de Tesorería y Gestión
--  Asociación de Bomberos Voluntarios de Villa Río Icho Cruz
--  Desarrollado por Maldonado Jorge Matias · JMM Gestiones & Tecnología
--  Licencia de uso otorgada a BV Villa Río Icho Cruz
-- ---------------------------------------------------------------------
--  Cómo usarlo: copiar TODO este archivo, pegarlo en Supabase →
--  SQL Editor → New query, y presionar "Run".
--  El script se puede volver a ejecutar: no borra datos existentes.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Utilidades generales
-- ---------------------------------------------------------------------

-- Sellos de auditoría: quién y cuándo creó / modificó cada registro.
create or replace function public.tg_sellos()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.creado_por := coalesce(auth.uid(), new.creado_por);
    new.creado_en  := now();
    new.modificado_por := null;
    new.modificado_en  := null;
  else
    new.creado_por := old.creado_por;
    new.creado_en  := old.creado_en;
    new.modificado_por := auth.uid();
    new.modificado_en  := now();
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 1. Usuarios y roles
-- ---------------------------------------------------------------------
create table if not exists public.perfiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre text not null default '',
  email text,
  rol text check (rol in ('tesoreria','comision','extintores','encargado')),
  activo boolean not null default false,
  creado_por uuid, creado_en timestamptz default now(),
  modificado_por uuid, modificado_en timestamptz
);

-- Rol del usuario conectado (null si no tiene perfil o está inactivo).
-- SECURITY DEFINER: lee perfiles sin pasar por RLS (evita recursión).
create or replace function public.rol_actual()
returns text language sql stable security definer set search_path = public as $$
  select rol from public.perfiles where id = auth.uid() and activo
$$;

-- Al registrarse un usuario en Auth se crea su perfil INACTIVO y SIN ROL.
-- Tesorería lo activa y le asigna el rol desde la app. Así nadie puede
-- auto-asignarse permisos registrándose por su cuenta.
create or replace function public.crear_perfil()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfiles (id, nombre, email, rol, activo)
  values (new.id, coalesce(new.raw_user_meta_data->>'nombre', ''), new.email, null, false)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.crear_perfil();

-- Impide quedarse sin ningún usuario de Tesorería activo.
create or replace function public.tg_perfiles_proteger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.perfiles where rol = 'tesoreria' and activo) then
    raise exception 'Debe quedar al menos un usuario de Tesorería activo.';
  end if;
  return null;
end $$;
drop trigger if exists perfiles_proteger on public.perfiles;
create trigger perfiles_proteger after update on public.perfiles
  for each row when (old.rol = 'tesoreria' and old.activo)
  execute function public.tg_perfiles_proteger();

-- ---------------------------------------------------------------------
-- 2. Configuración y catálogos
-- ---------------------------------------------------------------------
create table if not exists public.config (
  id int primary key default 1 check (id = 1),
  nombre text not null default 'Asociación de Bomberos Voluntarios de Villa Río Icho Cruz',
  direccion text default '',
  localidad text default 'Villa Río Icho Cruz, Córdoba',
  telefono text default '',
  cuit text default '',
  email text default '',
  creado_por uuid, creado_en timestamptz default now(),
  modificado_por uuid, modificado_en timestamptz
);

-- Saldos iniciales (separados de config para que solo los vea la contaduría)
create table if not exists public.saldos_iniciales (
  cuenta text primary key check (cuenta in ('caja','banco')),
  monto numeric(14,2) not null default 0,
  fecha date not null default date_trunc('year', current_date)::date,
  creado_por uuid, creado_en timestamptz default now(),
  modificado_por uuid, modificado_en timestamptz
);

create table if not exists public.categorias (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('ingreso','egreso')),
  nombre text not null,
  orden int not null default 0,
  activa boolean not null default true,
  sistema text unique,          -- código interno: 'extintores', 'cuotas', 'subsidios'
  creado_por uuid, creado_en timestamptz default now(),
  modificado_por uuid, modificado_en timestamptz,
  unique (tipo, nombre)
);

create table if not exists public.personal (
  id uuid primary key default gen_random_uuid(),
  jerarquia text default '',
  nombre text not null,
  orden int not null default 0,
  activo boolean not null default true,
  creado_por uuid, creado_en timestamptz default now(),
  modificado_por uuid, modificado_en timestamptz
);

create table if not exists public.tipos_emergencia (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  orden int not null default 0,
  activo boolean not null default true,
  creado_por uuid, creado_en timestamptz default now(),
  modificado_por uuid, modificado_en timestamptz
);

create table if not exists public.tipos_extintor (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  orden int not null default 0,
  activo boolean not null default true,
  creado_por uuid, creado_en timestamptz default now(),
  modificado_por uuid, modificado_en timestamptz
);

create table if not exists public.tipos_nota (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  orden int not null default 0,
  activo boolean not null default true,
  creado_por uuid, creado_en timestamptz default now(),
  modificado_por uuid, modificado_en timestamptz
);

create table if not exists public.niveles (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  orden int not null default 0,
  alerta boolean not null default false,   -- true = se muestra en rojo (Vacío / Mínimo)
  activo boolean not null default true,
  creado_por uuid, creado_en timestamptz default now(),
  modificado_por uuid, modificado_en timestamptz
);

create table if not exists public.moviles_plantilla (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  observacion text default '',            -- observación sugerida (ej. "nuevo", "viejo")
  orden int not null default 0,
  activo boolean not null default true,
  creado_por uuid, creado_en timestamptz default now(),
  modificado_por uuid, modificado_en timestamptz
);

create table if not exists public.moviles_items (
  id uuid primary key default gen_random_uuid(),
  movil_id uuid not null references public.moviles_plantilla(id) on delete cascade,
  nombre text not null,
  orden int not null default 0,
  activo boolean not null default true,
  creado_por uuid, creado_en timestamptz default now(),
  modificado_por uuid, modificado_en timestamptz
);
create index if not exists moviles_items_movil_idx on public.moviles_items(movil_id);

-- ---------------------------------------------------------------------
-- 3. Contaduría
-- ---------------------------------------------------------------------
create table if not exists public.subsidios (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  organismo text not null default 'Provincial' check (organismo in ('Nacional','Provincial','Municipal','Otro')),
  monto_otorgado numeric(14,2) not null default 0 check (monto_otorgado >= 0),
  fecha_otorgamiento date,
  fecha_limite date,
  observaciones text default '',
  creado_por uuid, creado_en timestamptz default now(),
  modificado_por uuid, modificado_en timestamptz
);

create table if not exists public.movimientos (
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  tipo text not null check (tipo in ('ingreso','egreso')),
  categoria_id uuid not null references public.categorias(id) on delete restrict,
  monto numeric(14,2) not null check (monto > 0),
  cuenta text not null check (cuenta in ('caja','banco')),
  descripcion text default '',
  comprobante text default '',
  subsidio_id uuid references public.subsidios(id) on delete set null,
  origen text not null default 'manual' check (origen in ('manual','extintores','socios','gasto')),
  origen_id uuid,
  creado_por uuid, creado_en timestamptz default now(),
  modificado_por uuid, modificado_en timestamptz
);
create index if not exists movimientos_fecha_idx on public.movimientos(fecha);
create index if not exists movimientos_categoria_idx on public.movimientos(categoria_id);
create index if not exists movimientos_tipo_idx on public.movimientos(tipo);
create index if not exists movimientos_subsidio_idx on public.movimientos(subsidio_id);
create index if not exists movimientos_origen_idx on public.movimientos(origen, origen_id);

-- ---------------------------------------------------------------------
-- 4. Informe del encargado de semana
-- ---------------------------------------------------------------------
create table if not exists public.informes_semanales (
  id uuid primary key default gen_random_uuid(),
  desde date not null,
  hasta date not null,
  encargado_id uuid references public.personal(id) on delete set null,
  proximo_id uuid references public.personal(id) on delete set null,
  encargado_nombre text default '',
  proximo_nombre text default '',
  obs_moviles jsonb not null default '{}'::jsonb,   -- { movil_id: "observación" }
  creado_por uuid, creado_en timestamptz default now(),
  modificado_por uuid, modificado_en timestamptz,
  check (hasta >= desde)
);
create index if not exists informes_desde_idx on public.informes_semanales(desde);

create table if not exists public.inf_emergencias (
  id uuid primary key default gen_random_uuid(),
  informe_id uuid not null references public.informes_semanales(id) on delete cascade,
  tipo_id uuid not null references public.tipos_emergencia(id) on delete cascade,
  cantidad int not null default 0 check (cantidad >= 0),
  creado_por uuid, creado_en timestamptz default now(),
  modificado_por uuid, modificado_en timestamptz,
  unique (informe_id, tipo_id)
);

create table if not exists public.inf_novedades (
  id uuid primary key default gen_random_uuid(),
  informe_id uuid not null references public.informes_semanales(id) on delete cascade,
  texto text not null,
  orden int not null default 0,
  creado_por uuid, creado_en timestamptz default now(),
  modificado_por uuid, modificado_en timestamptz
);
create index if not exists inf_novedades_inf_idx on public.inf_novedades(informe_id);

create table if not exists public.inf_pendientes (
  id uuid primary key default gen_random_uuid(),
  informe_id uuid not null references public.informes_semanales(id) on delete cascade,
  texto text not null,
  resuelto boolean not null default false,
  orden int not null default 0,
  creado_por uuid, creado_en timestamptz default now(),
  modificado_por uuid, modificado_en timestamptz
);
create index if not exists inf_pendientes_inf_idx on public.inf_pendientes(informe_id);

create table if not exists public.inf_niveles (
  id uuid primary key default gen_random_uuid(),
  informe_id uuid not null references public.informes_semanales(id) on delete cascade,
  item_id uuid not null references public.moviles_items(id) on delete cascade,
  nivel_id uuid references public.niveles(id) on delete set null,
  creado_por uuid, creado_en timestamptz default now(),
  modificado_por uuid, modificado_en timestamptz,
  unique (informe_id, item_id)
);

-- Gastos que carga el encargado de semana (llegan a Tesorería para aprobar)
create table if not exists public.gastos_encargado (
  id uuid primary key default gen_random_uuid(),
  informe_id uuid references public.informes_semanales(id) on delete set null,
  fecha date not null default current_date,
  concepto text not null,
  monto numeric(14,2) not null check (monto > 0),
  estado text not null default 'pendiente' check (estado in ('pendiente','aprobado','rechazado')),
  motivo_rechazo text default '',
  movimiento_id uuid references public.movimientos(id) on delete set null,
  autor_nombre text default '',
  revisado_por uuid, revisado_en timestamptz,
  creado_por uuid, creado_en timestamptz default now(),
  modificado_por uuid, modificado_en timestamptz
);
create index if not exists gastos_estado_idx on public.gastos_encargado(estado);
create index if not exists gastos_informe_idx on public.gastos_encargado(informe_id);

-- ---------------------------------------------------------------------
-- 5. Notas
-- ---------------------------------------------------------------------
create table if not exists public.notas (
  id uuid primary key default gen_random_uuid(),
  fecha date not null default current_date,
  tipo_id uuid references public.tipos_nota(id) on delete set null,
  titulo text not null,
  texto text default '',
  autor_nombre text default '',
  creado_por uuid, creado_en timestamptz default now(),
  modificado_por uuid, modificado_en timestamptz
);
create index if not exists notas_fecha_idx on public.notas(fecha);
create index if not exists notas_tipo_idx on public.notas(tipo_id);

-- ---------------------------------------------------------------------
-- 6. Comprobantes adjuntos (archivos en Storage, bucket "comprobantes")
-- ---------------------------------------------------------------------
create table if not exists public.adjuntos (
  id uuid primary key default gen_random_uuid(),
  movimiento_id uuid references public.movimientos(id) on delete set null,
  nota_id uuid references public.notas(id) on delete cascade,
  gasto_id uuid references public.gastos_encargado(id) on delete cascade,
  ruta text not null unique,
  nombre text not null,
  tipo_mime text not null,
  tamanio int not null default 0,
  creado_por uuid, creado_en timestamptz default now(),
  modificado_por uuid, modificado_en timestamptz,
  check (num_nonnulls(movimiento_id, nota_id, gasto_id) >= 1)
);
create index if not exists adjuntos_mov_idx on public.adjuntos(movimiento_id);
create index if not exists adjuntos_nota_idx on public.adjuntos(nota_id);
create index if not exists adjuntos_gasto_idx on public.adjuntos(gasto_id);

-- ---------------------------------------------------------------------
-- 7. Extintores
-- ---------------------------------------------------------------------
create sequence if not exists public.ext_orden_seq start 1;

create table if not exists public.ext_ordenes (
  id uuid primary key default gen_random_uuid(),
  numero bigint not null unique default nextval('public.ext_orden_seq'),
  cliente_nombre text not null,
  cliente_doc text default '',
  cliente_tel text default '',
  fecha_recepcion date not null default current_date,
  fecha_entrega_estimada date,
  observaciones text default '',
  total numeric(14,2) not null default 0,
  estado text not null default 'recibido' check (estado in ('recibido','listo','entregado')),
  pagado boolean not null default false,
  fecha_pago date,
  medio_pago text,
  movimiento_id uuid references public.movimientos(id) on delete set null,
  retiro_fecha date,
  retiro_nombre text,
  retiro_dni text,
  creado_por uuid, creado_en timestamptz default now(),
  modificado_por uuid, modificado_en timestamptz
);
alter sequence public.ext_orden_seq owned by public.ext_ordenes.numero;
create index if not exists ext_ordenes_estado_idx on public.ext_ordenes(estado);
create index if not exists ext_ordenes_pagado_idx on public.ext_ordenes(pagado);
create index if not exists ext_ordenes_fecha_idx on public.ext_ordenes(fecha_recepcion);

create table if not exists public.ext_items (
  id uuid primary key default gen_random_uuid(),
  orden_id uuid not null references public.ext_ordenes(id) on delete cascade,
  numero_serie text default '',
  tipo text default '',
  capacidad text default '',
  precio numeric(14,2) not null default 0 check (precio >= 0),
  orden int not null default 0,
  creado_por uuid, creado_en timestamptz default now(),
  modificado_por uuid, modificado_en timestamptz
);
create index if not exists ext_items_orden_idx on public.ext_items(orden_id);
create index if not exists ext_items_serie_idx on public.ext_items(numero_serie);

-- ---------------------------------------------------------------------
-- 8. Socios y cuotas
-- ---------------------------------------------------------------------
create table if not exists public.socios (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  dni text default '',
  telefono text default '',
  direccion text default '',
  cuota numeric(14,2) not null default 0 check (cuota >= 0),
  fecha_alta date not null default current_date,
  activo boolean not null default true,
  observaciones text default '',
  creado_por uuid, creado_en timestamptz default now(),
  modificado_por uuid, modificado_en timestamptz
);

create table if not exists public.cuotas_pagadas (
  id uuid primary key default gen_random_uuid(),
  socio_id uuid not null references public.socios(id) on delete cascade,
  mes date not null check (extract(day from mes) = 1),   -- primer día del mes
  monto numeric(14,2) not null default 0,
  movimiento_id uuid references public.movimientos(id) on delete cascade,
  creado_por uuid, creado_en timestamptz default now(),
  modificado_por uuid, modificado_en timestamptz,
  unique (socio_id, mes)
);
create index if not exists cuotas_mes_idx on public.cuotas_pagadas(mes);

-- ---------------------------------------------------------------------
-- 9. Presupuesto anual
-- ---------------------------------------------------------------------
create table if not exists public.presupuesto (
  id uuid primary key default gen_random_uuid(),
  anio int not null,
  categoria_id uuid not null references public.categorias(id) on delete cascade,
  monto numeric(14,2) not null default 0 check (monto >= 0),
  creado_por uuid, creado_en timestamptz default now(),
  modificado_por uuid, modificado_en timestamptz,
  unique (anio, categoria_id)
);

-- ---------------------------------------------------------------------
-- 10. Auditoría (historial de cambios y borrados)
-- ---------------------------------------------------------------------
create table if not exists public.auditoria (
  id bigserial primary key,
  fecha timestamptz not null default now(),
  usuario_id uuid,
  usuario_nombre text,
  tabla text not null,
  operacion text not null,
  registro_id text,
  datos_anteriores jsonb,
  datos_nuevos jsonb
);
create index if not exists auditoria_fecha_idx on public.auditoria(fecha desc);
create index if not exists auditoria_tabla_idx on public.auditoria(tabla);

create or replace function public.tg_auditoria()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_nombre text;
  v_id text;
begin
  select nombre into v_nombre from public.perfiles where id = auth.uid();
  v_id := coalesce(to_jsonb(old)->>'id', to_jsonb(old)->>'cuenta');
  -- No registrar updates que no cambian nada
  if tg_op = 'UPDATE' and (to_jsonb(old) - 'modificado_por' - 'modificado_en')
                        = (to_jsonb(new) - 'modificado_por' - 'modificado_en') then
    return null;
  end if;
  insert into public.auditoria (usuario_id, usuario_nombre, tabla, operacion, registro_id, datos_anteriores, datos_nuevos)
  values (auth.uid(), v_nombre, tg_table_name, tg_op, v_id, to_jsonb(old),
          case when tg_op = 'UPDATE' then to_jsonb(new) else null end);
  return null;
end $$;

-- Guarda el nombre del autor en notas y gastos (para mostrarlo sin leer perfiles)
create or replace function public.tg_autor_nombre()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    select nombre into new.autor_nombre from public.perfiles where id = auth.uid();
    new.autor_nombre := coalesce(new.autor_nombre, '');
  else
    new.autor_nombre := old.autor_nombre;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 11. Reglas de negocio (triggers)
-- ---------------------------------------------------------------------

-- Movimientos: la categoría debe coincidir con el tipo; los automáticos no
-- cambian monto ni tipo (se editan desde su módulo de origen).
create or replace function public.tg_movimientos_validar()
returns trigger language plpgsql as $$
declare v_tipo text;
begin
  if coalesce(public.rol_actual(), '') <> 'tesoreria' and coalesce(current_setting('app.rpc', true), '') <> '1' then
    raise exception 'No tenés permiso: solo Tesorería registra movimientos.' using errcode = '42501';
  end if;
  select tipo into v_tipo from public.categorias where id = new.categoria_id;
  if v_tipo is distinct from new.tipo then
    raise exception 'La categoría elegida no corresponde a un %.', new.tipo;
  end if;
  if tg_op = 'INSERT' and new.origen <> 'manual' and coalesce(current_setting('app.rpc', true), '') <> '1' then
    raise exception 'Los movimientos automáticos solo se generan desde su módulo.';
  end if;
  if tg_op = 'UPDATE' and old.origen <> 'manual' and coalesce(current_setting('app.rpc', true), '') <> '1'
     and (new.monto <> old.monto or new.tipo <> old.tipo or new.origen <> old.origen
          or new.origen_id is distinct from old.origen_id) then
    raise exception 'Este movimiento se generó desde %; modificalo desde ese módulo.', old.origen;
  end if;
  return new;
end $$;

-- Al borrar un movimiento: limpia adjuntos y deja coherente el módulo de origen.
create or replace function public.tg_movimientos_borrar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- adjuntos propios del movimiento (los tickets de gastos se conservan en el gasto)
  delete from public.adjuntos where movimiento_id = old.id and gasto_id is null;
  -- gasto aprobado → vuelve a pendiente
  update public.gastos_encargado set estado = 'pendiente', movimiento_id = null,
         revisado_por = null, revisado_en = null
   where movimiento_id = old.id;
  -- orden de extintores cobrada → vuelve a impaga
  perform set_config('app.rpc', '1', true);
  update public.ext_ordenes set pagado = false, fecha_pago = null, medio_pago = null, movimiento_id = null
   where movimiento_id = old.id;
  perform set_config('app.rpc', '', true);
  return old;
end $$;

drop trigger if exists movimientos_validar on public.movimientos;
create trigger movimientos_validar before insert or update on public.movimientos
  for each row execute function public.tg_movimientos_validar();
drop trigger if exists movimientos_borrar on public.movimientos;
create trigger movimientos_borrar before delete on public.movimientos
  for each row execute function public.tg_movimientos_borrar();

-- Extintores: total automático y bloqueo de órdenes cobradas.
create or replace function public.tg_ext_items()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_orden uuid := coalesce(new.orden_id, old.orden_id);
begin
  if tg_op = 'UPDATE' and new.orden_id <> old.orden_id then
    raise exception 'No se puede mover un extintor a otra orden.';
  end if;
  if exists (select 1 from public.ext_ordenes where id = v_orden and pagado) then
    raise exception 'La orden ya está cobrada: no se pueden modificar sus extintores.';
  end if;
  return coalesce(new, old);
end $$;

create or replace function public.tg_ext_items_total()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_orden uuid := coalesce(new.orden_id, old.orden_id);
begin
  perform set_config('app.rpc_total', '1', true);
  update public.ext_ordenes
     set total = coalesce((select sum(precio) from public.ext_items where orden_id = v_orden), 0)
   where id = v_orden;
  perform set_config('app.rpc_total', '', true);
  return null;
end $$;

create or replace function public.tg_ext_ordenes()
returns trigger language plpgsql as $$
declare v_rpc boolean := coalesce(current_setting('app.rpc', true), '') = '1';
begin
  if tg_op = 'INSERT' then
    new.total := 0; new.pagado := false; new.fecha_pago := null;
    new.medio_pago := null; new.movimiento_id := null;
    return new;
  end if;
  -- El total solo lo calcula la base a partir de los extintores
  if new.total <> old.total and coalesce(current_setting('app.rpc_total', true), '') <> '1' then
    new.total := old.total;
  end if;
  -- Los datos de cobro solo cambian mediante las funciones de cobro
  if not v_rpc and (new.pagado <> old.pagado or new.movimiento_id is distinct from old.movimiento_id
                    or new.fecha_pago is distinct from old.fecha_pago
                    or new.medio_pago is distinct from old.medio_pago) then
    raise exception 'El cobro de la orden se registra con el botón "Cobrar".';
  end if;
  -- Una orden cobrada no se edita (solo estado y datos de retiro)
  if old.pagado and new.pagado and not v_rpc and (
       new.cliente_nombre <> old.cliente_nombre or new.cliente_doc is distinct from old.cliente_doc
    or new.cliente_tel is distinct from old.cliente_tel or new.fecha_recepcion <> old.fecha_recepcion
    or new.numero <> old.numero) then
    raise exception 'La orden ya está cobrada y no se puede editar.';
  end if;
  return new;
end $$;

-- Al borrar una orden cobrada (solo Tesorería) se borra también su ingreso.
create or replace function public.tg_ext_ordenes_borrar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.movimiento_id is not null then
    delete from public.movimientos where id = old.movimiento_id;
  end if;
  return null;
end $$;

drop trigger if exists ext_items_validar on public.ext_items;
create trigger ext_items_validar before insert or update or delete on public.ext_items
  for each row execute function public.tg_ext_items();
drop trigger if exists ext_items_total on public.ext_items;
create trigger ext_items_total after insert or update or delete on public.ext_items
  for each row execute function public.tg_ext_items_total();
drop trigger if exists ext_ordenes_validar on public.ext_ordenes;
create trigger ext_ordenes_validar before insert or update on public.ext_ordenes
  for each row execute function public.tg_ext_ordenes();
drop trigger if exists ext_ordenes_borrar on public.ext_ordenes;
create trigger ext_ordenes_borrar after delete on public.ext_ordenes
  for each row execute function public.tg_ext_ordenes_borrar();

-- Gastos: el encargado no puede cambiar estado ni vincular movimientos.
create or replace function public.tg_gastos_validar()
returns trigger language plpgsql as $$
begin
  if coalesce(public.rol_actual(), '') <> 'tesoreria' and coalesce(current_setting('app.rpc', true), '') <> '1' then
    if tg_op = 'INSERT' then
      new.estado := 'pendiente'; new.movimiento_id := null; new.motivo_rechazo := '';
      new.revisado_por := null; new.revisado_en := null;
    else
      new.estado := old.estado; new.movimiento_id := old.movimiento_id;
      new.motivo_rechazo := old.motivo_rechazo;
      new.revisado_por := old.revisado_por; new.revisado_en := old.revisado_en;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists gastos_validar on public.gastos_encargado;
create trigger gastos_validar before insert or update on public.gastos_encargado
  for each row execute function public.tg_gastos_validar();

drop trigger if exists notas_autor on public.notas;
create trigger notas_autor before insert or update on public.notas
  for each row execute function public.tg_autor_nombre();
drop trigger if exists gastos_autor on public.gastos_encargado;
create trigger gastos_autor before insert or update on public.gastos_encargado
  for each row execute function public.tg_autor_nombre();

-- Sellos (creado_por / modificado_por) en todas las tablas
do $$
declare t text;
begin
  foreach t in array array['perfiles','config','saldos_iniciales','categorias','personal','tipos_emergencia',
    'tipos_extintor','tipos_nota','niveles','moviles_plantilla','moviles_items','subsidios','movimientos',
    'informes_semanales','inf_emergencias','inf_novedades','inf_pendientes','inf_niveles','gastos_encargado',
    'notas','adjuntos','ext_ordenes','ext_items','socios','cuotas_pagadas','presupuesto']
  loop
    execute format('drop trigger if exists a_sellos on public.%I', t);
    execute format('create trigger a_sellos before insert or update on public.%I for each row execute function public.tg_sellos()', t);
  end loop;

  -- Historial de cambios y borrados (los renglones internos del informe semanal no se registran)
  foreach t in array array['perfiles','config','saldos_iniciales','categorias','personal','tipos_emergencia',
    'tipos_extintor','tipos_nota','niveles','moviles_plantilla','moviles_items','subsidios','movimientos',
    'informes_semanales','gastos_encargado','notas','adjuntos','ext_ordenes','ext_items','socios',
    'cuotas_pagadas','presupuesto']
  loop
    execute format('drop trigger if exists z_auditoria on public.%I', t);
    execute format('create trigger z_auditoria after update or delete on public.%I for each row execute function public.tg_auditoria()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 12. Funciones (RPC) que usa la app
-- ---------------------------------------------------------------------

-- Cobrar una orden de extintores: crea el ingreso aunque el operador no vea la contaduría.
create or replace function public.ext_cobrar(p_orden uuid, p_medio text, p_fecha date default current_date)
returns public.ext_ordenes language plpgsql security definer set search_path = public as $$
declare
  v_ord public.ext_ordenes;
  v_cat uuid;
  v_mov uuid;
  v_items text;
begin
  if coalesce(public.rol_actual(), '') not in ('tesoreria','extintores') then
    raise exception 'No tenés permiso para cobrar órdenes.';
  end if;
  if coalesce(trim(p_medio), '') = '' then raise exception 'Indicá el medio de pago.'; end if;
  select * into v_ord from public.ext_ordenes where id = p_orden for update;
  if not found then raise exception 'La orden no existe.'; end if;
  if v_ord.pagado then raise exception 'La orden N° % ya está cobrada.', v_ord.numero; end if;
  if v_ord.total <= 0 then raise exception 'La orden no tiene importe para cobrar.'; end if;
  select id into v_cat from public.categorias where sistema = 'extintores';
  if v_cat is null then raise exception 'Falta la categoría de ingreso "Extintores".'; end if;
  select string_agg(nullif(numero_serie, ''), ', ' order by orden) into v_items
    from public.ext_items where orden_id = p_orden;

  perform set_config('app.rpc', '1', true);
  insert into public.movimientos (fecha, tipo, categoria_id, monto, cuenta, descripcion, comprobante, origen, origen_id)
  values (coalesce(p_fecha, current_date), 'ingreso', v_cat, v_ord.total,
          case when lower(p_medio) = 'efectivo' then 'caja' else 'banco' end,
          'Carga de extintores · Orden N° ' || v_ord.numero || ' · ' || v_ord.cliente_nombre
            || coalesce(' (' || v_items || ')', '') || ' · ' || p_medio,
          'Orden N° ' || v_ord.numero, 'extintores', p_orden)
  returning id into v_mov;

  update public.ext_ordenes set pagado = true, fecha_pago = coalesce(p_fecha, current_date),
         medio_pago = p_medio, movimiento_id = v_mov
   where id = p_orden returning * into v_ord;
  perform set_config('app.rpc', '', true);
  return v_ord;
end $$;

-- Anular el cobro de una orden (solo Tesorería): borra el ingreso.
create or replace function public.ext_anular_cobro(p_orden uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_mov uuid;
begin
  if coalesce(public.rol_actual(), '') <> 'tesoreria' then
    raise exception 'Solo Tesorería puede anular un cobro.';
  end if;
  select movimiento_id into v_mov from public.ext_ordenes where id = p_orden;
  if v_mov is null then raise exception 'La orden no está cobrada.'; end if;
  delete from public.movimientos where id = v_mov;   -- el trigger deja la orden impaga
end $$;

-- Aprobar un gasto del encargado: genera el egreso con sus adjuntos.
create or replace function public.aprobar_gasto(p_gasto uuid, p_categoria uuid, p_cuenta text, p_fecha date default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_g public.gastos_encargado;
  v_mov uuid;
begin
  if coalesce(public.rol_actual(), '') <> 'tesoreria' then
    raise exception 'Solo Tesorería puede aprobar gastos.';
  end if;
  select * into v_g from public.gastos_encargado where id = p_gasto for update;
  if not found then raise exception 'El gasto no existe.'; end if;
  if v_g.estado = 'aprobado' then raise exception 'El gasto ya fue aprobado.'; end if;
  if p_cuenta not in ('caja','banco') then raise exception 'Cuenta inválida.'; end if;

  perform set_config('app.rpc', '1', true);
  insert into public.movimientos (fecha, tipo, categoria_id, monto, cuenta, descripcion, comprobante, origen, origen_id)
  values (coalesce(p_fecha, v_g.fecha), 'egreso', p_categoria, v_g.monto, p_cuenta,
          v_g.concepto || coalesce(' · Encargado: ' || nullif(v_g.autor_nombre, ''), ''),
          '', 'gasto', p_gasto)
  returning id into v_mov;
  update public.gastos_encargado set estado = 'aprobado', movimiento_id = v_mov, motivo_rechazo = '',
         revisado_por = auth.uid(), revisado_en = now()
   where id = p_gasto;
  update public.adjuntos set movimiento_id = v_mov where gasto_id = p_gasto;
  perform set_config('app.rpc', '', true);
  return v_mov;
end $$;

-- Rechazar un gasto (solo Tesorería)
create or replace function public.rechazar_gasto(p_gasto uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare v_mov uuid;
begin
  if coalesce(public.rol_actual(), '') <> 'tesoreria' then
    raise exception 'Solo Tesorería puede rechazar gastos.';
  end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Indicá el motivo del rechazo.'; end if;
  select movimiento_id into v_mov from public.gastos_encargado where id = p_gasto;
  if v_mov is not null then delete from public.movimientos where id = v_mov; end if;
  update public.gastos_encargado set estado = 'rechazado', motivo_rechazo = p_motivo,
         revisado_por = auth.uid(), revisado_en = now()
   where id = p_gasto;
end $$;

-- Volver un gasto a "pendiente" (borra el egreso si estaba aprobado)
create or replace function public.revertir_gasto(p_gasto uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_mov uuid;
begin
  if coalesce(public.rol_actual(), '') <> 'tesoreria' then
    raise exception 'Solo Tesorería puede revertir gastos.';
  end if;
  select movimiento_id into v_mov from public.gastos_encargado where id = p_gasto;
  if v_mov is not null then delete from public.movimientos where id = v_mov; end if;
  update public.gastos_encargado set estado = 'pendiente', motivo_rechazo = '', revisado_por = null, revisado_en = null
   where id = p_gasto;
end $$;

-- Cobrar cuotas sociales de uno o varios meses en un solo ingreso.
create or replace function public.cobrar_cuotas(p_socio uuid, p_meses date[], p_medio text, p_fecha date default current_date)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_s public.socios;
  v_cat uuid;
  v_mov uuid;
  v_mes date;
  v_txt text;
begin
  if coalesce(public.rol_actual(), '') <> 'tesoreria' then
    raise exception 'Solo Tesorería puede cobrar cuotas.';
  end if;
  if p_meses is null or array_length(p_meses, 1) is null then raise exception 'Elegí al menos un mes.'; end if;
  select * into v_s from public.socios where id = p_socio;
  if not found then raise exception 'El socio no existe.'; end if;
  if v_s.cuota <= 0 then raise exception 'El socio no tiene cuota mensual cargada.'; end if;
  if exists (select 1 from public.cuotas_pagadas where socio_id = p_socio
             and mes = any (select date_trunc('month', m)::date from unnest(p_meses) m)) then
    raise exception 'Alguno de los meses elegidos ya está pago.';
  end if;
  select id into v_cat from public.categorias where sistema = 'cuotas';
  if v_cat is null then raise exception 'Falta la categoría de ingreso "Cuotas sociales".'; end if;
  select string_agg(to_char(m, 'MM/YYYY'), ', ' order by m) into v_txt
    from (select distinct date_trunc('month', x)::date m from unnest(p_meses) x) s;

  perform set_config('app.rpc', '1', true);
  insert into public.movimientos (fecha, tipo, categoria_id, monto, cuenta, descripcion, comprobante, origen, origen_id)
  values (coalesce(p_fecha, current_date), 'ingreso', v_cat,
          v_s.cuota * (select count(distinct date_trunc('month', x)) from unnest(p_meses) x),
          case when lower(p_medio) = 'efectivo' then 'caja' else 'banco' end,
          'Cuota social · ' || v_s.nombre || ' · ' || v_txt || ' · ' || coalesce(p_medio, ''),
          '', 'socios', p_socio)
  returning id into v_mov;
  for v_mes in select distinct date_trunc('month', x)::date from unnest(p_meses) x loop
    insert into public.cuotas_pagadas (socio_id, mes, monto, movimiento_id) values (p_socio, v_mes, v_s.cuota, v_mov);
  end loop;
  perform set_config('app.rpc', '', true);
  return v_mov;
end $$;

-- Anular un cobro de cuotas (borra el ingreso y los meses asociados)
create or replace function public.anular_cuotas(p_movimiento uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(public.rol_actual(), '') <> 'tesoreria' then
    raise exception 'Solo Tesorería puede anular cobros.';
  end if;
  delete from public.movimientos where id = p_movimiento and origen = 'socios';
end $$;

-- Saldos de Caja y Banco a una fecha (respeta RLS: solo contaduría)
create or replace function public.saldos_al(p_fecha date)
returns table (cuenta text, saldo numeric) language sql stable security invoker set search_path = public as $$
  select s.cuenta,
         s.monto + coalesce((select sum(case when m.tipo = 'ingreso' then m.monto else -m.monto end)
                               from public.movimientos m
                              where m.cuenta = s.cuenta and m.fecha >= s.fecha and m.fecha <= p_fecha), 0)
    from public.saldos_iniciales s
$$;

-- Totales por categoría en un período (respeta RLS)
create or replace function public.totales_por_categoria(p_desde date, p_hasta date)
returns table (categoria_id uuid, tipo text, total numeric, cantidad bigint)
language sql stable security invoker set search_path = public as $$
  select m.categoria_id, m.tipo, sum(m.monto), count(*)
    from public.movimientos m
   where m.fecha between p_desde and p_hasta
   group by m.categoria_id, m.tipo
$$;

-- Recibido / gastado por subsidio (respeta RLS)
create or replace function public.subsidios_resumen()
returns table (subsidio_id uuid, recibido numeric, gastado numeric, sin_adjunto bigint)
language sql stable security invoker set search_path = public as $$
  select s.id,
         coalesce(sum(m.monto) filter (where m.tipo = 'ingreso'), 0),
         coalesce(sum(m.monto) filter (where m.tipo = 'egreso'), 0),
         count(m.id) filter (where m.tipo = 'egreso'
                              and not exists (select 1 from public.adjuntos a where a.movimiento_id = m.id))
    from public.subsidios s
    left join public.movimientos m on m.subsidio_id = s.id
   group by s.id
$$;

-- Emergencias por tipo y mes (respeta RLS)
create or replace function public.estadisticas_emergencias(p_desde date, p_hasta date)
returns table (tipo_id uuid, mes date, cantidad bigint)
language sql stable security invoker set search_path = public as $$
  select e.tipo_id, date_trunc('month', i.desde)::date, sum(e.cantidad)
    from public.inf_emergencias e
    join public.informes_semanales i on i.id = e.informe_id
   where i.desde between p_desde and p_hasta and e.cantidad > 0
   group by e.tipo_id, date_trunc('month', i.desde)
$$;

-- Crear un informe semanal: arrastra los pendientes no resueltos y los
-- niveles de combustible del informe anterior.
create or replace function public.crear_informe_semanal(p_desde date, p_hasta date, p_encargado uuid, p_proximo uuid)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid;
  v_prev public.informes_semanales;
begin
  if coalesce(public.rol_actual(), '') not in ('tesoreria','encargado') then
    raise exception 'No tenés permiso para crear informes.';
  end if;
  select * into v_prev from public.informes_semanales
   where desde < p_desde order by desde desc, creado_en desc limit 1;
  if v_prev.id is null then
    select * into v_prev from public.informes_semanales order by desde desc, creado_en desc limit 1;
  end if;

  insert into public.informes_semanales (desde, hasta, encargado_id, proximo_id, encargado_nombre, proximo_nombre, obs_moviles)
  values (p_desde, p_hasta, p_encargado, p_proximo,
          coalesce((select trim(jerarquia || ' ' || nombre) from public.personal where id = p_encargado), ''),
          coalesce((select trim(jerarquia || ' ' || nombre) from public.personal where id = p_proximo), ''),
          coalesce(v_prev.obs_moviles, (select coalesce(jsonb_object_agg(id::text, observacion), '{}'::jsonb)
                                          from public.moviles_plantilla where activo and observacion <> '')))
  returning id into v_id;

  if v_prev.id is not null then
    insert into public.inf_pendientes (informe_id, texto, resuelto, orden)
      select v_id, texto, false, orden from public.inf_pendientes where informe_id = v_prev.id and not resuelto;
    insert into public.inf_niveles (informe_id, item_id, nivel_id)
      select v_id, item_id, nivel_id from public.inf_niveles where informe_id = v_prev.id;
  end if;
  return v_id;
end $$;

-- Permisos de ejecución: solo usuarios autenticados
do $$
declare f text;
begin
  foreach f in array array[
    'ext_cobrar(uuid,text,date)', 'ext_anular_cobro(uuid)', 'aprobar_gasto(uuid,uuid,text,date)',
    'rechazar_gasto(uuid,text)', 'revertir_gasto(uuid)', 'cobrar_cuotas(uuid,date[],text,date)',
    'anular_cuotas(uuid)', 'saldos_al(date)', 'totales_por_categoria(date,date)', 'subsidios_resumen()',
    'estadisticas_emergencias(date,date)', 'crear_informe_semanal(date,date,uuid,uuid)', 'rol_actual()']
  loop
    begin
      execute format('revoke execute on function public.%s from public, anon', f);
      execute format('grant execute on function public.%s to authenticated', f);
    exception when undefined_function then null;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 13. Row Level Security
-- ---------------------------------------------------------------------
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
revoke all on all tables in schema public from anon;

-- Ayudante: aplica el patrón estándar (lectura para unos roles, escritura para otros)
create or replace function public._rls_simple(p_tabla text, p_lectura text[], p_escritura text[])
returns void language plpgsql as $$
declare c text;
begin
  execute format('alter table public.%I enable row level security', p_tabla);
  foreach c in array array['select','insert','update','delete'] loop
    execute format('drop policy if exists %I on public.%I', p_tabla || '_' || c, p_tabla);
  end loop;
  execute format('create policy %I on public.%I for select to authenticated using ((select public.rol_actual()) = any (%L::text[]))',
                 p_tabla || '_select', p_tabla, p_lectura);
  execute format('create policy %I on public.%I for insert to authenticated with check ((select public.rol_actual()) = any (%L::text[]))',
                 p_tabla || '_insert', p_tabla, p_escritura);
  execute format('create policy %I on public.%I for update to authenticated using ((select public.rol_actual()) = any (%L::text[])) with check ((select public.rol_actual()) = any (%L::text[]))',
                 p_tabla || '_update', p_tabla, p_escritura, p_escritura);
  execute format('create policy %I on public.%I for delete to authenticated using ((select public.rol_actual()) = any (%L::text[]))',
                 p_tabla || '_delete', p_tabla, p_escritura);
end $$;
revoke execute on function public._rls_simple(text,text[],text[]) from public, anon, authenticated;

-- Contaduría: Tesorería escribe, Comisión lee
select public._rls_simple('saldos_iniciales', '{tesoreria,comision}', '{tesoreria}');
select public._rls_simple('categorias',       '{tesoreria,comision}', '{tesoreria}');
select public._rls_simple('movimientos',      '{tesoreria,comision}', '{tesoreria}');
select public._rls_simple('subsidios',        '{tesoreria,comision}', '{tesoreria}');
select public._rls_simple('socios',           '{tesoreria,comision}', '{tesoreria}');
select public._rls_simple('cuotas_pagadas',   '{tesoreria,comision}', '{tesoreria}');
select public._rls_simple('presupuesto',      '{tesoreria,comision}', '{tesoreria}');
-- Datos del cuartel: todos los leen (salen en los comprobantes)
select public._rls_simple('config',           '{tesoreria,comision,extintores,encargado}', '{tesoreria}');
-- Catálogos del informe semanal
select public._rls_simple('personal',          '{tesoreria,comision,encargado}', '{tesoreria}');
select public._rls_simple('tipos_emergencia',  '{tesoreria,comision,encargado}', '{tesoreria}');
select public._rls_simple('niveles',           '{tesoreria,comision,encargado}', '{tesoreria}');
select public._rls_simple('moviles_plantilla', '{tesoreria,comision,encargado}', '{tesoreria}');
select public._rls_simple('moviles_items',     '{tesoreria,comision,encargado}', '{tesoreria}');
select public._rls_simple('tipos_nota',        '{tesoreria,comision,encargado}', '{tesoreria}');
select public._rls_simple('tipos_extintor',    '{tesoreria,comision,extintores}', '{tesoreria}');
-- Extintores
select public._rls_simple('ext_ordenes', '{tesoreria,comision,extintores}', '{tesoreria,extintores}');
select public._rls_simple('ext_items',   '{tesoreria,comision,extintores}', '{tesoreria,extintores}');
-- Informe semanal
select public._rls_simple('informes_semanales', '{tesoreria,comision,encargado}', '{tesoreria,encargado}');
select public._rls_simple('inf_emergencias',    '{tesoreria,comision,encargado}', '{tesoreria,encargado}');
select public._rls_simple('inf_novedades',      '{tesoreria,comision,encargado}', '{tesoreria,encargado}');
select public._rls_simple('inf_pendientes',     '{tesoreria,comision,encargado}', '{tesoreria,encargado}');
select public._rls_simple('inf_niveles',        '{tesoreria,comision,encargado}', '{tesoreria,encargado}');

-- Extintores: una orden cobrada solo la puede borrar Tesorería
drop policy if exists ext_ordenes_delete on public.ext_ordenes;
create policy ext_ordenes_delete on public.ext_ordenes for delete to authenticated
  using ((select public.rol_actual()) = 'tesoreria'
         or ((select public.rol_actual()) = 'extintores' and not pagado));

-- Informes semanales: el encargado solo borra los que creó
drop policy if exists informes_semanales_delete on public.informes_semanales;
create policy informes_semanales_delete on public.informes_semanales for delete to authenticated
  using ((select public.rol_actual()) = 'tesoreria'
         or ((select public.rol_actual()) = 'encargado' and creado_por = (select auth.uid())));

-- Perfiles
alter table public.perfiles enable row level security;
drop policy if exists perfiles_select on public.perfiles;
drop policy if exists perfiles_update on public.perfiles;
create policy perfiles_select on public.perfiles for select to authenticated
  using (id = (select auth.uid()) or (select public.rol_actual()) in ('tesoreria','comision'));
create policy perfiles_update on public.perfiles for update to authenticated
  using ((select public.rol_actual()) = 'tesoreria') with check ((select public.rol_actual()) = 'tesoreria');
-- (sin políticas de insert/delete: los perfiles los crea el trigger de Auth)

-- Auditoría: solo lectura para Tesorería y Comisión
alter table public.auditoria enable row level security;
drop policy if exists auditoria_select on public.auditoria;
create policy auditoria_select on public.auditoria for select to authenticated
  using ((select public.rol_actual()) in ('tesoreria','comision'));
revoke insert, update, delete on public.auditoria from authenticated;

-- Gastos del encargado
alter table public.gastos_encargado enable row level security;
drop policy if exists gastos_select on public.gastos_encargado;
drop policy if exists gastos_insert on public.gastos_encargado;
drop policy if exists gastos_update on public.gastos_encargado;
drop policy if exists gastos_delete on public.gastos_encargado;
create policy gastos_select on public.gastos_encargado for select to authenticated
  using ((select public.rol_actual()) in ('tesoreria','comision','encargado'));
create policy gastos_insert on public.gastos_encargado for insert to authenticated
  with check ((select public.rol_actual()) = 'tesoreria'
     or ((select public.rol_actual()) = 'encargado' and creado_por = (select auth.uid()) and estado = 'pendiente'));
create policy gastos_update on public.gastos_encargado for update to authenticated
  using ((select public.rol_actual()) = 'tesoreria'
     or ((select public.rol_actual()) = 'encargado' and creado_por = (select auth.uid()) and estado = 'pendiente'))
  with check ((select public.rol_actual()) = 'tesoreria'
     or ((select public.rol_actual()) = 'encargado' and creado_por = (select auth.uid()) and estado = 'pendiente'));
create policy gastos_delete on public.gastos_encargado for delete to authenticated
  using ((select public.rol_actual()) = 'tesoreria'
     or ((select public.rol_actual()) = 'encargado' and creado_por = (select auth.uid()) and estado = 'pendiente'));

-- Notas: Tesorería y Encargado escriben (el encargado solo edita las suyas); Comisión lee
alter table public.notas enable row level security;
drop policy if exists notas_select on public.notas;
drop policy if exists notas_insert on public.notas;
drop policy if exists notas_update on public.notas;
drop policy if exists notas_delete on public.notas;
create policy notas_select on public.notas for select to authenticated
  using ((select public.rol_actual()) in ('tesoreria','comision','encargado'));
create policy notas_insert on public.notas for insert to authenticated
  with check ((select public.rol_actual()) in ('tesoreria','encargado'));
create policy notas_update on public.notas for update to authenticated
  using ((select public.rol_actual()) = 'tesoreria'
     or ((select public.rol_actual()) = 'encargado' and creado_por = (select auth.uid())))
  with check ((select public.rol_actual()) in ('tesoreria','encargado'));
create policy notas_delete on public.notas for delete to authenticated
  using ((select public.rol_actual()) = 'tesoreria'
     or ((select public.rol_actual()) = 'encargado' and creado_por = (select auth.uid())));

-- Adjuntos (registro de los archivos)
alter table public.adjuntos enable row level security;
drop policy if exists adjuntos_select on public.adjuntos;
drop policy if exists adjuntos_insert on public.adjuntos;
drop policy if exists adjuntos_update on public.adjuntos;
drop policy if exists adjuntos_delete on public.adjuntos;
create policy adjuntos_select on public.adjuntos for select to authenticated
  using ((select public.rol_actual()) in ('tesoreria','comision')
     or ((select public.rol_actual()) = 'encargado' and (nota_id is not null or gasto_id is not null)));
create policy adjuntos_insert on public.adjuntos for insert to authenticated
  with check ((select public.rol_actual()) = 'tesoreria'
     or ((select public.rol_actual()) = 'encargado' and movimiento_id is null and (
           (gasto_id is not null and nota_id is null and exists (select 1 from public.gastos_encargado g
               where g.id = gasto_id and g.creado_por = (select auth.uid()) and g.estado = 'pendiente'))
        or (nota_id is not null and gasto_id is null and exists (select 1 from public.notas n
               where n.id = nota_id and n.creado_por = (select auth.uid()))))));
create policy adjuntos_update on public.adjuntos for update to authenticated
  using ((select public.rol_actual()) = 'tesoreria') with check ((select public.rol_actual()) = 'tesoreria');
create policy adjuntos_delete on public.adjuntos for delete to authenticated
  using ((select public.rol_actual()) = 'tesoreria'
     or ((select public.rol_actual()) = 'encargado' and movimiento_id is null and (
           (gasto_id is not null and exists (select 1 from public.gastos_encargado g
               where g.id = gasto_id and g.creado_por = (select auth.uid()) and g.estado = 'pendiente'))
        or (nota_id is not null and exists (select 1 from public.notas n
               where n.id = nota_id and n.creado_por = (select auth.uid()))))));

-- ---------------------------------------------------------------------
-- 14. Storage: bucket privado "comprobantes"
--     Rutas: movimientos/{id}/archivo · gastos/{id}/archivo · notas/{id}/archivo
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('comprobantes', 'comprobantes', false, 5242880, array['image/jpeg','image/png','application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg','image/png','application/pdf'];

-- ¿El archivo pertenece a un gasto pendiente del usuario o a una nota suya?
create or replace function public.storage_es_propio(p_nombre text)
returns boolean language sql stable security definer set search_path = public as $$
  select case (storage.foldername(p_nombre))[1]
    when 'gastos' then exists (select 1 from public.gastos_encargado g
                                where g.id::text = (storage.foldername(p_nombre))[2]
                                  and g.creado_por = auth.uid() and g.estado = 'pendiente')
    when 'notas'  then exists (select 1 from public.notas n
                                where n.id::text = (storage.foldername(p_nombre))[2]
                                  and n.creado_por = auth.uid())
    else false end
$$;
revoke execute on function public.storage_es_propio(text) from public, anon;
grant execute on function public.storage_es_propio(text) to authenticated;

drop policy if exists comprobantes_select on storage.objects;
drop policy if exists comprobantes_insert on storage.objects;
drop policy if exists comprobantes_update on storage.objects;
drop policy if exists comprobantes_delete on storage.objects;
create policy comprobantes_select on storage.objects for select to authenticated
  using (bucket_id = 'comprobantes' and (
    (select public.rol_actual()) in ('tesoreria','comision')
    or ((select public.rol_actual()) = 'encargado' and (storage.foldername(name))[1] in ('gastos','notas'))));
create policy comprobantes_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'comprobantes' and (
    (select public.rol_actual()) = 'tesoreria'
    or ((select public.rol_actual()) = 'encargado' and public.storage_es_propio(name))));
create policy comprobantes_update on storage.objects for update to authenticated
  using (bucket_id = 'comprobantes' and (select public.rol_actual()) = 'tesoreria');
create policy comprobantes_delete on storage.objects for delete to authenticated
  using (bucket_id = 'comprobantes' and (
    (select public.rol_actual()) = 'tesoreria'
    or ((select public.rol_actual()) = 'encargado' and public.storage_es_propio(name))));

-- ---------------------------------------------------------------------
-- 15. Tiempo real (Supabase Realtime)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['config','saldos_iniciales','categorias','personal','tipos_emergencia','tipos_extintor',
    'tipos_nota','niveles','moviles_plantilla','moviles_items','subsidios','movimientos','informes_semanales',
    'inf_emergencias','inf_novedades','inf_pendientes','inf_niveles','gastos_encargado','notas','adjuntos',
    'ext_ordenes','ext_items','socios','cuotas_pagadas','presupuesto','perfiles']
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
              when undefined_object then null;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 16. Datos iniciales
-- ---------------------------------------------------------------------
insert into public.config (id) values (1) on conflict (id) do nothing;
insert into public.saldos_iniciales (cuenta, monto) values ('caja', 0), ('banco', 0) on conflict (cuenta) do nothing;

insert into public.categorias (tipo, nombre, orden, sistema) values
  ('ingreso', 'Subsidios', 1, 'subsidios'),
  ('ingreso', 'Municipio', 2, null),
  ('ingreso', 'Eventos', 3, null),
  ('ingreso', 'Extintores', 4, 'extintores'),
  ('ingreso', 'Cuotas sociales', 5, 'cuotas'),
  ('ingreso', 'Donaciones', 6, null),
  ('ingreso', 'Otros ingresos', 7, null),
  ('egreso', 'Combustible', 1, null),
  ('egreso', 'Seguros', 2, null),
  ('egreso', 'Eventos', 3, null),
  ('egreso', 'Equipamiento', 4, null),
  ('egreso', 'Herramientas', 5, null),
  ('egreso', 'Supermercado', 6, null),
  ('egreso', 'Mantenimiento de móviles', 7, null),
  ('egreso', 'Servicios', 8, null),
  ('egreso', 'Otros egresos', 9, null)
on conflict do nothing;

insert into public.tipos_emergencia (nombre, orden) values
  ('Prevención y control de creciente', 1),
  ('2020 negativo', 2),
  ('Caída de moto', 3),
  ('Incendio de palmera', 4),
  ('Asistencia médica', 5),
  ('Incendio estructural', 6),
  ('Accidente vehicular', 7),
  ('Incendio forestal', 8)
on conflict (nombre) do nothing;

insert into public.tipos_extintor (nombre, orden) values
  ('Polvo ABC', 1), ('CO2', 2), ('Agua', 3), ('Espuma AFFF', 4), ('Clase K', 5)
on conflict (nombre) do nothing;

insert into public.tipos_nota (nombre, orden) values
  ('Eventos', 1), ('Informes técnicos', 2), ('Informes de actuación', 3),
  ('Ingresos', 4), ('Egresos', 5), ('General', 6)
on conflict (nombre) do nothing;

insert into public.niveles (nombre, orden, alerta) values
  ('Vacío', 1, true), ('Mínimo', 2, true), ('1/4', 3, false), ('1/3', 4, false),
  ('Medio', 5, false), ('3/4', 6, false), ('Más de 3/4', 7, false), ('Full', 8, false)
on conflict (nombre) do nothing;

-- Plantilla de móviles (solo si todavía no hay ninguno cargado)
do $$
declare
  v_id uuid;
  r record;
  i int;
begin
  if exists (select 1 from public.moviles_plantilla) then return; end if;
  for r in select * from (values
      (1, 'Móvil 01', 'nuevo', array['Gasoil','Bomba','Caudalera','Bidón 8L']),
      (2, 'Móvil 02', '',      array['Tanque','Bidón V-Power','Holmatro']),
      (3, 'Móvil 03', '',      array['Tanque']),
      (4, 'Móvil 04', '',      array['Tanque','Holmatro','Bidón 8L','Generador Honda']),
      (5, 'Móvil 05', '',      array['Tanque','Combate 500','Motobomba chica','Motosierra','Bidón 8L']),
      (6, 'Móvil 01', 'viejo', array['Tanque','Bidón 5L','Motobomba caudalera','Bomba']),
      (7, 'Móvil 06', '',      array['Generador','Bomba']),
      (8, 'Depósito', '',      array['Bidón 20L nafta','Bidón 40L gasoil (solo camiones 1 y 2)',
                                     'Bidón 40L gasoil V-Power (solo camionetas 1 y 2)','Bidón 40L sin descripción'])
    ) as t(orden, nombre, obs, items)
  loop
    insert into public.moviles_plantilla (nombre, observacion, orden) values (r.nombre, r.obs, r.orden) returning id into v_id;
    for i in 1 .. array_length(r.items, 1) loop
      insert into public.moviles_items (movil_id, nombre, orden) values (v_id, r.items[i], i);
    end loop;
  end loop;
end $$;

-- =====================================================================
-- PASO FINAL (hacerlo UNA sola vez, después de crear tu usuario en
-- Authentication → Users): activar el primer usuario de Tesorería.
-- Reemplazá el email y ejecutá solo estas líneas:
--
--   insert into public.perfiles (id, email, nombre, rol, activo)
--   select id, email, 'Tu nombre', 'tesoreria', true from auth.users
--    where lower(email) = lower('tesoreria@ejemplo.com')
--   on conflict (id) do update set rol = 'tesoreria', activo = true, nombre = excluded.nombre;
-- =====================================================================
