# Contexto del proyecto — Portal de Viáticos CKL

Documento de contexto para Claude. Complementa a `CLAUDE.md` (arquitectura técnica y comandos); aquí está el **dominio, las reglas de negocio y las decisiones ya tomadas**. Léelo antes de preguntar al usuario: la mayoría de las dudas comunes están respondidas abajo.

## 1. Qué es

Portal web (en español de México) para que empleados de Grupo Cklass **soliciten viáticos**, un jefe/Finanzas los **autoricen**, y el empleado los **compruebe** con facturas (XML CFDI / PDF). Es un **prototipo frontend sin backend**: todo vive en `localStorage` con datos demo sembrados. Proyecto originado en Lovable; se itera en local con Claude Code.

- Stack: TanStack Start + Router (rutas por archivo), React 19, Tailwind v4, shadcn/ui, Bun. Destino de despliegue: Cloudflare Workers (nitro).
- **Todo texto visible al usuario va en español (MX)**: labels, toasts, errores, placeholders. Fechas `dd/mm/yyyy`, montos con `fmtMoney` (`$1,234`, sin decimales).
- Fuente: Jost. Color de marca primario `#E30613` (rojo CKL). Clases propias `ckl-btn-primary`, `ckl-btn-outline`, `ckl-btn-ghost`, `ckl-input`, `ckl-label`, `ckl-card`, `ckl-badge`: reutilízalas.
- No hay tests ni backend. Validación = `bun run lint`, `bun run build` y probar en navegador (`bun run dev`).

## 2. Mapa de archivos relevantes

| Archivo | Qué contiene |
|---|---|
| `src/lib/store.ts` | **Fuente de verdad**: tipos (`User`, `Role`, `Solicitud`, `Autorizacion`, `ComprobanteGasto`, `Sociedad`, `Hotel`…), `KEYS` de localStorage, datos semilla, `lsGet/lsSet`, `nextFolio`, `fmtMoney`, reset de contraseña, filtros de visibilidad por rol/fecha |
| `src/lib/auth.tsx` | `AuthProvider`, `useAuth()` (`user`, `role`, `cargando`, `login`, `logout`, `hasPerm`), `useLocalStorage<T>` |
| `src/components/portal/Layout.tsx` | Sidebar/topbar y filtrado del menú por permisos; botón “Nueva solicitud” (fondo blanco, borde/texto rojo) con la validación de folios pendientes |
| `src/components/portal/UserMenu.tsx` | Menú de usuario del encabezado (nombre + rol → Cerrar sesión / Cambiar contraseña) y el diálogo “Configuración de seguridad” |
| `src/components/ErrorDialog.tsx` | `showErrorDialog(msg)`: diálogo centrado bloqueante para **errores y validaciones** (se reemplazó el toast de error). Los éxitos siguen usando `toast.success` (sonner) |
| `src/routes/login.tsx` | Login (por correo **o RFC**), Pre-Registro, recuperación de contraseña |
| `src/routes/_portal.dashboard.tsx` | Dashboard (gráfica mensual, atajo a comprobaciones atrasadas) |
| `src/routes/_portal.solicitar.tsx` | Alta/edición de solicitud (destinos, hoteles, transportes, otros) |
| `src/routes/_portal.estatus.tsx` | Lista de solicitudes, autorizar/rechazar, detalle, revertir (admin) |
| `src/routes/_portal.comprobacion.tsx` | Carga de XML/PDF por concepto, validación, no deducibles, depósito sobrante |
| `src/routes/_portal.reportes.tsx` | Reportes/exportación |
| `src/routes/_portal.usuarios.tsx` | CRUD de usuarios (solo admin) y Pre-Registros |
| `src/routes/_portal.permisos.tsx` | Matriz de permisos por rol |
| `src/routes/_portal.configuracion.tsx` | Montos, umbrales, sociedades, hoteles, roles, automatizaciones (SMTP/email) |
| `src/routeTree.gen.ts` | Autogenerado: **no editar** |
| `src/components/ui/*` | shadcn vendorizado: no reescribir |

Archivos sin trackear en git que **no son parte del proyecto** (ignorar, no commitear): `package-lock.json` (se usa Bun, `bun.lock`), `src/_NO_imagen-inicio.png`.

## 3. Datos y persistencia

Claves en `localStorage` (`KEYS` en `store.ts`): `ckl_user`, `ckl_users`, `ckl_roles`, `ckl_solicitudes`, `ckl_destinos`, `ckl_autorizaciones`, `ckl_comprobantes_gasto`, `ckl_facturas_xml`, `ckl_sociedades`, `ckl_hoteles`, `ckl_origenes`, `ckl_config`, `ckl_prealtas`, `ckl_reset_codes`, `ckl_session`, `ckl_revisiones_monto`, `ckl_convenios`, `ckl_correos`, `ckl_logs` (+ `ckl_gastos`, `ckl_notas`, `ckl_comprobantes_viaje` reservadas).

- `initSeed()` siembra **solo claves vacías**. Si cambias la semilla en `store.ts`, un navegador que ya tenga datos **no la verá** hasta limpiar localStorage (DevTools → Application → Clear, o borrar las claves `ckl_*`). Recuérdalo al depurar “no aparece mi dato nuevo”.
- Escribe siempre con `lsSet` (dispara el evento `ckl:storage` que re-sincroniza hooks). Evita `localStorage.setItem` directo.
- Si cambias la forma de un dato guardado, **tolera el esquema viejo** (ver `normalizeDestino` en `solicitar`) porque el usuario tiene datos persistidos.
- Las facturas guardan el archivo como data URL base64 en localStorage (límite ~5 MB del navegador). Para abrirlas se convierte a Blob URL (Chrome bloquea `window.open` a `data:`).
- Sin backend real: no hay correo real (el código de recuperación se muestra en pantalla como “correo simulado”), ni validación SAT real (el total de la factura se simula con un número aleatorio 200–999; el XML solo se revisa por nodo `Emisor` y RFC del `Receptor`).

### Modelo principal
- `Solicitud`: `folio` (`#0041`…, lo asigna `nextFolio()` **al guardar**, no al abrir el formulario), `jefe_status` (`Pendiente|Autorizado|Rechazado`), `finanzas_status` (`Pendiente|Autorizado|Rechazado|N/A`), `estatus` (`Abierto|Cerrado|Rechazado`), `monto_total`, `empresa` (nombre de sociedad), `created_at` ISO.
- Destinos (`ckl_destinos`, ligados por `solicitud_id`): `estado`, fechas, `hoteles[]` (estancias con `monto` = **tarifa por noche**, `manual`, `hotel_id`), `foraneo[]`, `local[]`, `otros[]`.
- `ComprobanteGasto`: un renglón por concepto de cada solicitud (`monto_solicitado`, `monto_comprobado`, `status_renglon`).
- `Factura` (tipo local en `comprobacion.tsx`): archivo cargado, ligado a un `concepto_id` y `monto_aplicado` (permite revertir exacto al eliminar).

## 4. Roles, permisos y usuarios demo

Seis roles base (más los que el admin cree en Configuración; `Role.nombre` es `string`). Permisos como mapa plano `permisos: Record<string, boolean>`; usa `hasPerm("clave")` o `role.permisos.clave`, **no inventes otro esquema de autorización**.

| Rol | Rasgos clave |
|---|---|
| `usuario` | Solicita y comprueba lo propio |
| `jefe_inmediato` | Autoriza paso “jefe” (`autorizar_lte5000`), ve a su equipo (`jefe_id`), rechaza, ve reportes |
| `gestor_vuelos` | `ver_todo`; en Comprobación **solo ve/comprueba el concepto “Avión”**; sube comprobantes de viaje |
| `finanzas` | Autoriza montos > umbral (`autorizar_gt5000`), `ver_todo`, reportes y exportación |
| `compras_corporativas` | Mismos permisos que finanzas **+ `validar_comprobacion`, `revisar_monto_manual` y `gestionar_convenios`**: valida las facturas de folios comprobados y acepta/rechaza montos manuales de hotel (ver “Validación de Compras”, “Montos manuales de hotel” y “Convenios”) |
| `administrador` | Todo; **no solicita ni comprueba** sus propios viáticos (oculto en menú); puede revertir autorizaciones |

Reglas de UI ya decididas:
- **Usuarios** solo visible con `gestionar_usuarios` (admin). Permisos → `configurar_permisos`; Configuración → `configurar_montos`.
- Alcance de datos (`filterSolicitudesByOwnership`): `ver_todo` ve todo; `ver_equipo` ve a los usuarios con `jefe_id === user.id` **más sus propios folios**; el resto, solo lo propio.
- Ventana de visibilidad (`filterSolicitudesByDateCutoff`): admin/finanzas/compras/jefe ven **4 meses** atrás; los demás **2 meses**.
- **Estatus aplica ese alcance** (y el contador del menú lateral también): el `usuario` ve solo sus folios; el `jefe_inmediato` ve los de quienes lo tienen como jefe **y los suyos** (los suyos los autoriza su propio jefe, no él); `ver_todo` (admin, finanzas, compras, gestor) ve todo. Orden: más reciente primero (`created_at` desc, empate por folio desc). Filtros: Buscar, **Usuario** (solo aparece si el alcance incluye a más de una persona; lista a quienes tienen folios visibles) y Estatus.
- **Sesión única por usuario**: iniciar sesión en otra pestaña/dispositivo cierra la anterior (token en `ckl_session`).
- **Recarga (F5) / URL directa**: la sesión se lee en un `useEffect` (no en el inicializador de `useState`: leerla síncronamente rompe la hidratación SSR). `AuthProvider` expone `cargando` (true hasta leerla) y `PortalLayout` no redirige a `/login` mientras `cargando`. No cambies esto a inicialización lazy.

Usuarios demo (todos `@cklass.com`; contraseña visible en la pantalla de login):

| Correo | Rol | Sociedad | Contraseña |
|---|---|---|---|
| admin@ | administrador | WATA GROUP | Admin123! |
| jefe@ | jefe_inmediato | INTERMEDIARIA INTERMEX | Jefe123! |
| usuario@ | usuario (María Torres) | WATA GROUP | User123! |
| finanzas@ | finanzas | WATA GROUP | Fin123! |
| gestor@ | gestor_vuelos | INTERMEDIARIA INTERMEX | Gest123! |
| compras@ | compras_corporativas | WATA GROUP | Compras123! |
| usuario2@ | usuario (Carlos Mendoza) | INTERMEDIARIA INTERMEX | User223! |
| usuario3@ | usuario (Sofía Ramírez) | TRANSPORTES DE PERSONAL Y MERCANCIA | User323! |

El login también acepta el **RFC** del usuario. Jefe de usuario/usuario2/usuario3 = `jefe@` (u2), salvo que se cambie.

Sociedades: WATA GROUP, INTERMEDIARIA INTERMEX, TRANSPORTES DE PERSONAL Y MERCANCIA (cada una con RFC, régimen, CP, UsoCFDI —por defecto con prefijo `G03`— y `sociedad_sap`).

## 5. Reglas de negocio (ya implementadas; no re-preguntar)

### Solicitar viáticos
- Una solicitud tiene origen, tipo de viaje (Comercial, Auditoría, Visita a tiendas, Capacitación, Expos, Visita a proveedores, Otros), motivo, nº de personas (un input de nombre por viajero) y **uno o más destinos** (estados: Jalisco, CDMX, Guanajuato, Nuevo León, Querétaro, Colima, Zacatecas).
- **Total** = comida + hotel + transporte foráneo + local + vales + automóvil (gasolina + caseta).
  - Comida = `días totales × monto_comida_diario × personas` (config, default $450).
  - Hotel = tarifa por noche × noches de cada estancia. Noches = días del rango − 1. Tarifa viene del catálogo de hoteles o es **manual por noche**.
  - Foráneo: Avión, Autobús (antes “Camión”), Tren, Otro. Local: Uber, Taxi, Metro, Combi, Otro.
- **Automóvil / Vales** (Solicitar, por destino): sección **Automóvil** con **Gasolina** y **Caseta** (`destino.automovil`); la barra de totales muestra el tile **AUTOMÓVIL** (= Gasolina + Caseta). **Gasolina entra a “Pago directo empresa”; la Caseta se queda en “Total a depositar”**. Genera renglones de comprobación `Gasolina` y `Caseta` (solo si > 0). La etiqueta **“Otros” pasó a “Vales”** (totales, sección de gastos libres del destino, renglón de comprobación, detalle en Estatus); el concepto guardado se renombró (`backfillValesConcepto`) y la clave interna del destino sigue siendo `otros`. El **tipo de viaje “Otros” no cambió**.
- **Pago directo por la empresa**: Hotel, Avión y Gasolina se pagan con la tarjeta corporativa y **no se depositan** al viajero. La barra de totales muestra “Pago directo empresa” (Hotel + todos los renglones de transporte foráneo tipo Avión + Gasolina) en verde forest (`#228B22`) antes de “Total a depositar” = total − pago directo. **Solo es de presentación**: `Solicitud.monto_total`, el umbral de Finanzas y los renglones de comprobación siguen usando el total completo (Hotel y Avión se siguen comprobando).
- **Bloqueo de solicitudes nuevas**: si el usuario tiene **2 o más** folios propios `Cerrado` (autorizados) sin comprobar por completo (`foliosSinComprobar` / `bloqueoNuevaSolicitud` en `store.ts`, tope `MAX_FOLIOS_SIN_COMPROBAR = 2`), “Nueva solicitud” muestra un diálogo con los folios pendientes y no navega. También se valida al entrar a `/solicitar` (menú lateral o URL; redirige a Comprobación) y al guardar. La edición de una solicitud existente (`editId`) está exenta. Al comprobar por completo uno de los folios (quedan <2) vuelve a permitirse. Los usuarios demo `usuario@` (#0040, #0045, #0060) quedan bloqueados de inicio.
- Validaciones (todas con `showErrorDialog`): motivo obligatorio; fechas de cada destino obligatorias, no anteriores a hoy, fin ≥ inicio, sin empalme con el destino previo; si el destino tiene ≥1 noche **debe haber hotel** y las estancias deben cubrir **exactamente** el rango del destino sin huecos ni empalmes, cada fila con hotel seleccionado.
- Edición: solo el dueño, solo si está `Abierto` y **sin autorizaciones/rechazos** registrados.
- Al guardar se generan renglones de comprobación: `Hotel`, **uno por cada tipo de transporte realmente usado** (Avión, Autobús, Uber…; “Otro” se distingue como `Otro (foráneo)` / `Otro (transporte local)`), `Comida`, `Gasolina` y `Caseta` (si > 0), `Vales`. Los montos de transporte iguales se suman por tipo (evitar filas duplicadas).
- Selector de fechas propio `dd/mm/yyyy` que se cierra al elegir; los días del viaje se muestran como día+número.

### Autorización (Estatus)
- Flujo: solicitud nace `Abierto` con `jefe_status: Pendiente`. Si `monto_total > umbral_finanzas` (default **$5,000**) → `finanzas_status: Pendiente`, si no `N/A`.
- **Nadie autoriza ni rechaza su propia solicitud** (`canAuth` excluye `s.user_id === user.id`): el jefe ve sus folios pero los autoriza su propio jefe (admin).
- Paso **jefe**: lo da quien tenga `autorizar_lte5000` y `jefe_status === Pendiente`, **sin importar el monto** (el umbral solo decide si hace falta además Finanzas; antes de corregirlo había un deadlock).
- Paso **finanzas**: `autorizar_gt5000`, monto > umbral, jefe ya autorizó, finanzas pendiente.
- La solicitud pasa a `Cerrado` cuando queda autorizada por todos los pasos requeridos. “Cerrado” significa **autorizada y lista para comprobar** (no “terminada”).
- **Etiqueta visible vs. valor guardado**: `Solicitud.estatus` en localStorage sigue siendo `Abierto|Cerrado|Rechazado` (retrocompatibilidad); la UI muestra `Pendiente` (Abierto), `Rechazado`, `Autorizado` (Cerrado sin comprobar por completo, badge azul) o `Comprobado` (Cerrado y comprobado, verde). Se deriva con `estatusVisible()` + `avanceComprobacion()` de `store.ts` y el componente `StatusBadge` (`comprobado` prop). El filtro de Estatus y el Excel de Reportes usan las etiquetas visibles. **Nunca escribas la etiqueta visible en localStorage.**
- El modal de detalle trae el botón **Comprobar gastos** (folio Cerrado, rol con `comprobar`, no admin) que navega a `/comprobacion?solicitudId=<id>`.
- Rechazo: exige nota; marca el paso correspondiente y `estatus: Rechazado`.
- Admin puede **revertir** autorizaciones (borra `ckl_autorizaciones` de ese folio y regresa a Abierto/Pendiente).
- Eliminar solo si no tiene autorizaciones. El modal de detalle muestra el desglose completo (hoteles, transportes, otros) para quien autoriza.

### Comprobación
- **Comprobante = par XML + PDF**: presionar **Adjuntar** en un concepto abre un único diálogo (`SubirComprobanteDialog`) donde se eligen o arrastran el XML y el PDF a la vez; **solo con los dos archivos** se habilita “Subir comprobante” y solo entonces suma al comprobado. El monto sale del atributo `Total` del XML (si no lo trae se simula); se valida Emisor y RFC del receptor y nombres repetidos; si algo falla **no se guarda nada**. Los dos archivos comparten `par_id` (el XML aplica `monto_aplicado`, el PDF 0); en “Facturas cargadas” el par es **un solo renglón** y eliminar quita ambos y revierte el monto. Un archivo suelto heredado queda `Incompleto` (`backfillParesComprobante`: revierte lo que había sumado; los de ejemplo `fv_…` se completan con el archivo faltante). **Vales**: un solo archivo (foto o PDF), sin XML. **La gasolina no se comprueba** (no genera renglón; `backfillSinGasolina` retira los heredados); la caseta sí.
- Solo aparecen solicitudes `Cerrado` **dentro del alcance del rol** (`filterSolicitudesByOwnership`: el rol `usuario` ve solo las suyas; un folio ajeno en la URL no se muestra). Selector = panel maestro-detalle con buscador y tarjetas con barra de avance y marca `[Pendiente]`/`[Comprobado]`; en móvil se colapsa con “Cambiar folio”. La ruta acepta `?solicitudId=` y sincroniza la URL al elegir. Cada renglón (concepto) tiene sus propios botones de adjuntar XML/PDF; el archivo se aplica **explícitamente a ese concepto**, hasta `monto_solicitado − monto_comprobado`.
- XML: debe contener `Emisor`; el `Rfc` del `Receptor` debe coincidir con el RFC de la **sociedad de la solicitud** (no el RFC personal del empleado). Archivos con el mismo nombre en la misma solicitud se rechazan como duplicados. PDF/JPG/PNG se aceptan sin validar contenido.
- Eliminar una factura revierte exactamente `monto_aplicado`.
- “Comprobado” = total comprobado === total solicitado (>0). Mismo criterio en Comprobación, Estatus y Dashboard.
- **Comprobación atrasada**: solicitud `Cerrado`, no comprobada por completo y con más de `dias_comprobacion_atrasada` (default 7) días desde `created_at`. El Dashboard cuenta con el alcance del rol del usuario y enlaza a Estatus con filtro `?atrasados`; la lista debe coincidir con el número (ya hubo un bug por eso).
- **Validación de Compras Corporativas** (permiso `validar_comprobacion`, rol sin `comprobar`): Compras revisa que las facturas de cada concepto sean reales. En Comprobación la tabla de conceptos tiene las columnas **Validado** (casilla) y **Nota** (observación opcional, se guarda al salir del campo o con Enter) entre Estatus y Adjuntar. Datos en `ComprobanteGasto`: `validado`, `validado_por`, `validado_fecha`, `nota_validacion` (opcionales). Reglas: solo se puede validar un renglón ya comprobado y con monto > 0; quitar una factura que deja el renglón incompleto reinicia su validación; Compras **no** sube ni elimina facturas, no ve Adjuntar ni No deducibles/Depósito sobrante, y su lista de folios solo trae los **comprobados al 100%** (con dueño visible). En Estatus, doble clic (o toque/ojo en móvil) en un folio Comprobado lo lleva directo a validar; los folios con todos sus conceptos validados muestran ✓ junto al estatus y la insignia “Validado por Compras”. El dueño del folio ve el ✓ y la Nota en solo lectura. `avanceValidacion()` en `store.ts`. Roles guardados antes de este permiso lo reciben por `backfillValidarComprobacion`: aplica a `compras_corporativas` **y a cualquier rol cuyo nombre empiece con “compras”** (p. ej. `compras_corp` creado a mano en Configuración) que aún no tenga la clave; si el admin ya la definió (true/false) no se sobrescribe. Para cualquier otro rol se activa en Permisos → “Validar comprobaciones”.
- **Escenarios de ejemplo de validación** (`backfillEscenariosValidacion`, ids `s19`–`s21`, folio = siguiente libre al insertarse, con facturas XML/PDF reales en base64): María Torres #por validar, Carlos Mendoza (>$5,000, pasó por Finanzas) ya validado al 100%, Sofía Ramírez parcial con una Nota de observación.
- **Vales**: se comprueban **solo con foto o PDF** (JPG/PNG/PDF, ícono de cámara; el XML no se pide ni se acepta; el archivo se tipifica `FOTO` o `PDF`). Gasolina y Caseta se comprueban como cualquier concepto (XML/PDF).
- Secciones adicionales: No deducibles y Depósito sobrante (reintegro con comprobante bancario obligatorio). El gestor de vuelos no las ve.

### Configuración (admin)
`monto_comida_diario`, `umbral_finanzas`, `dia_deposito`, `email_compras`, `dias_comprobacion_atrasada` (7), `dias_autorizacion_pendiente` (3), `dias_recordatorio_viaje` (2), notificaciones por email/plataforma, SMTP (servidor/puerto/usuario/password/cifrado), revisión automática. CRUD de sociedades, hoteles, orígenes y roles (se pueden crear roles y borrar los que no se usan). **Las automatizaciones/SMTP son solo configuración guardada: no envían nada realmente.**

### Convenios con hoteles (Compras)
Pantalla `/convenios` (permiso `gestionar_convenios`: `compras_corporativas` y roles cuyo nombre empiece con “compras”, por backfill; el admin no lo tiene por omisión y lo asigna en Permisos). **Altas, bajas y modificaciones** de convenios (`Convenio` en `store.ts`, `ckl_convenios`), campos tomados de la hoja de convenios: año, tipo y no. de sucursal, destino (ciudad), estado, nombre comercial, costo hab. sencilla y doble (por noche), no. de proveedor, razón social, teléfono, contacto, banco, correo y notas. Filtros: búsqueda, destino, año y estatus (Todos / Vigentes = activos del año en curso / Históricos = activos de años anteriores / Baja); cada convenio muestra su etiqueta Vigente, Histórico o Baja. La **baja es lógica** (`activo:false` + `baja_motivo` + `baja_fecha`, reactivable). Valida nombre, destino, año, costo sencilla > 0, correo y que no haya otro convenio del mismo hotel+destino+año. Cada movimiento va a la bitácora (`convenio_alta`, `convenio_modificacion` con antes/después, `convenio_baja`, `convenio_reactivacion`) y el formulario muestra el historial. Tabla en escritorio / tarjetas en móvil. 26 convenios de ejemplo: 14 de 2025 (histórico, uno en baja) y 12 de 2026 (vigentes, con tarifas nuevas en Casa Palomino 720/920 y SAFI 1,480/1,650; Hotel Colonial San Miguel solo tiene 2025, por eso no se ofrece). `backfillConveniosFaltantes` agrega los de ejemplo que falten en navegadores existentes. **Los convenios alimentan el catálogo de hoteles** (`ckl_hoteles`, el que usa Solicitar): `sincronizarCatalogoConvenios()` (en cada alta/modificación/baja/reactivación y al cargar) crea o actualiza, por hotel (nombre + destino), el hotel con nombre, ciudad, **estado**, tarifa predeterminada por noche = **costo hab. sencilla** del convenio **activo del año en curso** y `convenio_clave`. **Solo cuentan los convenios del año en curso**: los de años anteriores se conservan como **histórico (solo estadísticas y comparativas) y nunca se ofrecen en Solicitar**; si un hotel no tiene convenio activo del año en curso (solo histórico o en baja) pasa a `activo:false` (ya no se ofrece en nuevas solicitudes, las existentes lo siguen mostrando). Por eso el convenio lleva **Estado** (obligatorio, catálogo `ESTADOS_MX`; Solicitar suma al selector de destinos los estados de los hoteles activos). Los 30 hoteles sembrados sin convenio no se tocan (uno con el mismo nombre y ciudad se adopta). Cada sincronización queda en logs (`catalogo_hoteles_sincronizado`). La **tarifa doble** del convenio (`costo_doble`) pasa al catálogo como `Hotel.tarifa_doble`; `tarifaHotel(hotel, tipo)` da la tarifa predeterminada por tipo de habitación.

### Gasto por concepto (pastel en Dashboard + reporte)
Permiso **`ver_gasto_por_concepto`** (Administrador, Finanzas y Compras —`compras_corporativas` y roles que empiezan con “compras”—, por backfill; configurable en Permisos). **Dashboard**: tarjeta “Gasto por concepto” (`PanelGastoDashboard`, `GastoPorConcepto.tsx`) con **gráfica de pastel (dona) de 6 conceptos en orden/color fijo**: Hotel, Transporte foráneo, Transporte local, Comida, Automóvil (gasolina + caseta) y Vales; leyenda-tabla con monto y %, resaltado al pasar el cursor/enfocar, selector de periodo (Año en curso por omisión, 3 meses, mes, todo) y enlace “Ver reporte”. **Reportes** → pestaña **“Gasto por concepto”** (`/reportes?vista=gasto`, `ReporteGasto`): filtros por fechas, sociedad, **usuario**, concepto y base (**Solicitado** / **Comprobado**), **agrupar por** Concepto, Concepto y subconcepto (Avión, Autobús, Uber…), Usuario, Usuario y concepto, Sociedad o Mes; tiles “Quién gasta más” y “En qué se gasta más”, dona, tabla ordenada de mayor a menor gasto con ranking y barra de %, y **Exportar Excel**. Datos: `renglonesGasto()` (store.ts) arma los renglones desde los renglones de comprobación (concepto + monto solicitado/comprobado) y la gasolina del destino (la gasolina no se comprueba: cuenta igual como solicitada y comprobada); **las solicitudes rechazadas no cuentan**. Paleta categórica validada con el validador de dataviz (los tonos claros llevan etiqueta visible y vista de tabla).

### Montos manuales de hotel → revisión de Compras (campanita + correo + logs)
- **Motivo del cambio**: en Solicitar, si “Monto manual por noche” está activo y el monto es **distinto al predeterminado**, aparece a la derecha una línea “Motivo del cambio de monto” (**obligatoria**; se guarda en la estancia como `motivo_cambio` y viaja a la revisión como `motivo`, al correo, al diálogo de la campanita y al detalle en Estatus). Si el monto vuelve al predeterminado el motivo se descarta.
- **Habitación sencilla/doble** (Solicitar): en el selector de hoteles, si el hotel tiene tarifa doble se listan **dos opciones con su leyenda** (“Hotel X — Sencilla $695” / “Hotel X — Doble $895”); si no, una sola línea. La estancia guarda `tipo_habitacion` (ausente = sencilla) y la **tarifa predeterminada para el monto manual es la del tipo elegido** (lo mismo en la revisión de Compras, el correo, el diálogo y el detalle en Estatus, que muestran “Habitación doble”). Las tarifas con centavos se muestran con centavos (`fmtTarifa`).
- **Disparo**: al **guardar** (alta o edición) una solicitud, cada estancia de hotel con “Monto manual por noche” **distinto al predeterminado del catálogo** (`Hotel.tarifa_base`; sin hotel de catálogo cuenta como distinto) abre una `RevisionMontoManual` (`crearRevisionesMontoManual`, `store.ts`). Se dispara al guardar y no al marcar la casilla porque antes no existe folio ni solicitud. Manual con el mismo monto que el predeterminado **no** avisa. Al editar: se conservan las pendientes sin cambios (no repiten correo), se reemplazan las que cambiaron de monto y las ya resueltas no se repiten si el monto es el mismo.
- **Quién revisa**: roles con permiso `revisar_monto_manual` = `compras_corporativas` y cualquier rol cuyo nombre empiece con “compras” (p. ej. `compras_corp`) que aún no tenga la clave (`backfillRevisarMontoManual`; si el admin la fijó en true/false no se toca; Permisos → “Revisar montos manuales de hotel”). Nadie revisa su propia solicitud (no la ve ni puede decidir).
- **Campanita** (`NotificationBell.tsx`, encabezado): badge = pendientes; lista las revisiones **pendientes y las resueltas hoy**; las resueltas **desaparecen al día siguiente** (día natural local: `revisionVisible`/`hoyLocal`). Clic → diálogo con usuario, hotel, estancia, monto predeterminado vs. monto del usuario (por noche, diferencia y total de la estancia) y **Aceptar / Rechazar con comentario** (comentario obligatorio solo al rechazar). Una decisión la toma una sola persona de Compras y vale para todos. Por omisión **no bloquea** la autorización (es informativa/registro). **Parámetro del administrador** en Configuración → “Montos y reglas”: interruptor **“Bloquear folio por cambio de monto en hotel”** (`config.bloquear_folio_monto_hotel`, apagado por omisión; se guarda con el botón Guardar de esa tarjeta y el cambio queda en logs como `config_bloqueo_monto_hotel`). Con él **activo**, `bloqueoMontoHotel()` impide autorizar (botón Autorizar deshabilitado + motivo; Rechazar sigue disponible; candado 🔒 junto al estatus en Estatus) un folio `Abierto` con revisión **vigente** `pendiente` o `rechazada`; aceptada = libre. Tras un rechazo el solicitante edita la solicitud: la revisión rechazada pasa a `vigente: false` (ya no bloquea ni se muestra en la campanita) y, si el hotel/monto sigue siendo distinto, se abre una nueva pendiente. La decisión y el comentario se muestran en el detalle del folio (Estatus) bajo el hotel.
- **Correo informativo**: a cada revisor activo (excepto el solicitante) se le “envía” un correo con el detalle. **Sin servidor de correo aún**: queda en `ckl_correos` con estado `simulado` (o `omitido` si “Envío de correos” está apagado en Configuración → Automatizaciones). Se consulta en Configuración → “Bitácora de notificaciones” (clic en un correo para ver el cuerpo). El switch “Notificaciones de plataforma” no se aplica a estas alertas (son parte del flujo de revisión).
- **Logs**: `registrarLog(tipo, entidad, entidad_id, usuario_id, detalle)` → `ckl_logs`. Tipos hoy: `monto_manual_detectado`, `correo_enviado_simulado`/`correo_omitido`, `revision_aceptada`, `revision_rechazada`. **Cuando exista la base de datos, `ckl_logs` pasa a una tabla `logs`** (id, fecha, tipo, entidad, entidad_id, usuario_id, detalle JSON) y `ckl_correos`/`ckl_revisiones_monto` a sus propias tablas; usar `registrarLog` para cualquier evento nuevo.
- **Estancia de hotel**: el monto de la estancia es **siempre por noche** (catálogo o manual); el detalle en Estatus muestra “N noche(s) × monto = subtotal”.
- **Escenarios de ejemplo** (`backfillEscenariosMontoManual`, ids `s22`–`s26`, folios siguientes libres): 3 pendientes (Carlos Mendoza/Camino Real Monterrey $1,380→$1,700; Sofía Ramírez/Emporio Zacatecas $890→$1,250 con una segunda estancia de catálogo sin aviso; Juan Alvarado/Radisson Querétaro $870→$1,100), 1 **aceptada hoy** (María Torres/Presidente Intercontinental $1,850→$2,400, sigue en la campanita hoy) y 1 **rechazada ayer** (Carlos/Holiday Inn León $880→$1,500, ya no aparece en la campanita; sí en el detalle del folio).

### Menú de usuario y cambio de contraseña
El encabezado muestra avatar + nombre + rol (`UserMenu`); al hacer clic: Cerrar sesión y Cambiar contraseña (el botón suelto de “Cerrar sesión” ya no existe). “Cambiar contraseña” pide actual, nueva y confirmación; reglas: ≥ 6 caracteres, no común/comprometida (lista corta, parte del correo, secuencias o caracteres repetidos), coincidir con la confirmación y distinta de la actual. `cambiarContrasena()` actualiza `ckl_users` y la copia en `ckl_user`. La longitud mínima es `PASSWORD_MIN_LENGTH` (6) en `store.ts`; la regla solo aplica a contraseñas nuevas.

### Dashboard
El banner de comprobaciones atrasadas abre con saludo por hora (“Buenos días / Buenas tardes / Buenas noches {nombre}, tienes N comprobaciones atrasadas…”). Solo aparece si hay atrasadas.

### Pre-Registro y contraseñas
Desde el login, un empleado envía un Pre-Registro (`ckl_prealtas`) que el admin procesa en Usuarios. (Se llamaba “Pre-Alta”; la etiqueta correcta de UI es **Pre-Registro**.) Recuperación: código de 6 dígitos válido 10 min, mostrado en pantalla.

## 5b. Meta: base de datos MySQL y la hoja de pagos actual

El prototipo guarda todo en localStorage. La meta es conectar **MySQL** (hay MySQL Server 8.0.46 en el equipo de desarrollo) y **recuperar de ahí la información que hoy se lleva a mano en una hoja de Excel de pagos a hoteles**, con riesgo de errores humanos. Cada fila de esa hoja es un **pago a un hotel por una estancia**. Mapeo columna → modelo actual:

| Columna de la hoja | Dónde está hoy | Estado |
|---|---|---|
| Año / Mes / Sem. | derivable de la fecha de pago | falta guardar la **fecha de pago** (hoy solo existe `config.dia_deposito`) |
| Fecha de pago | — | **falta** (campo por pago) |
| Soc (2000/3000/5000) | `Sociedad.sociedad_sap` vía `Solicitud.empresa` | ok |
| Nombre | `Solicitud.personas_nombres` / usuario | ok |
| Depto o sucursal (Comercial, Auditoría, Calidad, Apoyo, Movilidad…) | — (hay `tipo_viaje`, no el depto del empleado) | **falta** `usuarios.depto` |
| No. proveedor / Nombre comercial / Razón social | `Convenio` (y `Hotel.convenio_clave`) | falta ligar la **estancia** al convenio (`convenio_id`) |
| Cantidad | noches × monto por noche de la estancia (+ total del XML) | ok (derivable) |
| Destino | destino/estado y `Convenio.destino` | ok |
| Folio (p. ej. 13689) | — (nuestro `folio` es `#00xx`) | **falta** folio de pago/SAP |
| Noches / Fechas | `estancia.fecha_inicio/fin` | ok |
| Noche con ($) | `estancia.monto` (tarifa aplicada, catálogo o manual) | ok |
| Habitación (sencilla/doble) | `estancia.tipo_habitacion` (`sencilla`/`doble`; Solicitar la elige en el selector de hoteles) | **ok** |
| Doc / No. factura / Fecha de entrega | UUID y Serie-Folio del XML; sin “doc” ni fecha de entrega | **faltan** `doc`, `fecha_entrega` (y extraer Serie/Folio del CFDI) |
| Comentario | `motivo_cambio`, notas | ok parcial |

Tablas previstas: `sociedades`, `usuarios` (+depto), `roles`/`permisos`, `solicitudes`, `destinos`, `estancias_hotel` (+tipo_habitacion, convenio_id, fecha_pago, folio_pago, doc, fecha_entrega), `convenios`, `hoteles`, `comprobantes` (renglones), `facturas_archivos` (XML/PDF con `par_id`), `revisiones_monto`, `correos`, `logs`. Una vista `v_pagos_hotel` debe reproducir las columnas de la hoja. Mientras tanto: ids estables, `registrarLog` para todo evento nuevo y avisar cuando un cambio deje un hueco frente a esta tabla.

## 6. Convenciones de trabajo

- Prettier: 100 columnas, comillas dobles, comas finales, `;`. Alias `@/*` → `src/*`. Estilo del código existente: comentarios en español explicando el **porqué**.
- Errores/validaciones → `showErrorDialog`; confirmaciones de éxito → `toast.success`.
- No añadas dependencias sin avisar (`bunfig.toml` impone `minimumReleaseAge` de 24 h). Gestor de paquetes: Bun, no npm.
- No toques `routeTree.gen.ts`, `src/components/ui/*`, ni las capas de error SSR (`start.ts`, `server.ts`, `error-capture.ts`).
- Para nuevas pantallas: archivo `src/routes/_portal.<nombre>.tsx`, `createFileRoute("/_portal/<nombre>")`, título `"<Nombre> — CKL"`, agregar al arreglo `items` de `Layout.tsx` con su permiso.
- Diseño responsive: tablas con más de 6 columnas se muestran como **tarjetas apiladas por debajo de 768 px** (patrón: `<ul className="md:hidden">` con tarjetas + `<div className="hidden md:block overflow-x-auto">` con la tabla); ya aplicado en Estatus, Reportes, Usuarios y Facturas cargadas. En Estatus móvil cada tarjeta tiene botón de ojo “Ver” (el doble toque dispara zoom nativo, por eso no se usa en móvil). Verifica ancho ~400 px al tocar layouts.
- Validación: no hay tests. `tsc`/eslint (sin reglas de formato: el repo ya trae cientos de errores de Prettier) y pruebas con Playwright contra `bun run dev` (puerto 8080). **No ejecutar ni mencionar `bun run build`** salvo que la usuaria lo pida (falla en este equipo con “Could not resolve entry module index.html”, también en el commit original; ya se investigó).
- Git: rama `main`; commits en inglés, descriptivos y en imperativo (ver `git log`). No hagas commit/push salvo que se pida.

## 7. Historial reciente (para entender el estado actual)

Últimas iteraciones: comprobación por concepto de transporte y alcance del gestor de vuelos; filas de transporte duplicadas corregidas; conteo/lista de “atrasadas” alineados; hotel manual por noche y folio diferido; detalle de autorización con desglose; Usuarios solo para admin; usuarios demo multi-sociedad; Automatizaciones (SMTP) en Configuración; sesión única por usuario; rediseño del Dashboard (gráfica mensual); fuente Jost; validación de cobertura de hoteles; diálogo bloqueante en lugar de toasts de error; etiquetas visibles Pendiente/Autorizado/Comprobado/Rechazado; vistas de tarjetas en móvil; Comprobación maestro-detalle con alcance por rol; arreglo de recarga con `cargando`; favicon vacío (evita 404); comprobante por par XML+PDF con diálogo único; gasolina sin comprobación; convenios que alimentan el catálogo de hoteles; menú de usuario con cambio de contraseña; revisión de Compras de montos manuales de hotel (campanita, correo simulado, logs); “Pago directo empresa” (Hotel + Avión) fuera del total a depositar; bloqueo de nuevas solicitudes con 2+ folios sin comprobar; saludo en el Dashboard.

## 8. Cómo pedirme cosas (preferencias para esta colaboración)

- Si una tarea es ambigua **en el dominio**, primero revisa este documento y el código (`store.ts` y la ruta relevante) antes de preguntar.
- Antes de modificar reglas de negocio de la sección 5, confirma con el usuario; son decisiones tomadas a propósito.
- Al cambiar semilla o forma de datos, indica si hay que limpiar `localStorage` para verlo.
- Reporta con honestidad qué probaste: no hay tests, así que di si solo corriste lint/build o si verificaste en el navegador.
