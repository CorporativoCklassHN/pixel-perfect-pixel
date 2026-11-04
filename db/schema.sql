-- =====================================================================================
-- Portal de Viáticos CKL — Esquema completo para MySQL 8.4
-- Tablas, vistas, procedimientos almacenados (SP), triggers y datos de demostración.
--
-- Ejecución (desde la raíz del proyecto):
--     npm run db:setup
-- o, a mano:
--     mysql -u root -p --default-character-set=utf8mb4 < db/schema.sql
--
-- ¡ATENCIÓN! El script es re-ejecutable pero DESTRUCTIVO: borra y recrea todas las tablas
-- de la base `portal_viaticos` y vuelve a cargar los datos de demostración.
-- Las contraseñas de los usuarios demo están en claro SOLO por ser datos de ejemplo.
--
-- Estructura derivada de los tipos de src/lib/store.ts; los datos demo son los mismos que
-- siembra initSeed() en localStorage.
-- =====================================================================================

SET NAMES utf8mb4;
CREATE DATABASE IF NOT EXISTS portal_viaticos CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE portal_viaticos;

SET @old_fk = @@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS = 0;
SET @old_sql_mode = @@SQL_MODE;
SET SQL_MODE = 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION,ERROR_FOR_DIVISION_BY_ZERO';

-- ───────────────────────────── 1. Limpieza ─────────────────────────────
DROP VIEW IF EXISTS v_renglones_gasto;
DROP PROCEDURE IF EXISTS sp_siguiente_folio;
DROP PROCEDURE IF EXISTS sp_registrar_log;
DROP PROCEDURE IF EXISTS sp_autorizar_solicitud;
DROP PROCEDURE IF EXISTS sp_revertir_autorizaciones;
DROP PROCEDURE IF EXISTS sp_recalcular_comprobacion;
DROP PROCEDURE IF EXISTS sp_folios_sin_comprobar;
DROP PROCEDURE IF EXISTS sp_sincronizar_catalogo_convenios;
DROP PROCEDURE IF EXISTS sp_dar_baja_convenio;
DROP PROCEDURE IF EXISTS sp_reactivar_convenio;
DROP PROCEDURE IF EXISTS sp_gasto_por_concepto;

DROP TABLE IF EXISTS logs, correos, revisiones_monto, convenios, factura_archivos, facturas,
  comprobantes_gasto, notas, autorizaciones, destino_vales, destino_transportes, destino_hoteles,
  solicitud_destinos, solicitudes, sesiones, reset_codes, prealtas, usuarios, folio_contador,
  configuracion, estados_mx, origenes, hoteles, sociedades, roles;

-- ───────────────────────────── 2. Tablas ─────────────────────────────
-- Catálogos ---------------------------------------------------------------
CREATE TABLE roles (
  id        INT          NOT NULL AUTO_INCREMENT,
  nombre    VARCHAR(60)  NOT NULL,
  permisos  JSON         NOT NULL COMMENT 'Mapa plano { permiso: true|false }',
  PRIMARY KEY (id),
  UNIQUE KEY uq_roles_nombre (nombre)
) ENGINE=InnoDB;

CREATE TABLE sociedades (
  id            INT          NOT NULL AUTO_INCREMENT,
  nombre        VARCHAR(120) NOT NULL,
  rfc           VARCHAR(20)  NOT NULL,
  regimen       VARCHAR(200) NOT NULL DEFAULT '',
  cp            VARCHAR(5)   NOT NULL DEFAULT '',
  uso_cfdi      VARCHAR(100) NOT NULL DEFAULT 'G03',
  sociedad_sap  VARCHAR(20)  NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  UNIQUE KEY uq_sociedades_nombre (nombre)
) ENGINE=InnoDB;

CREATE TABLE hoteles (
  id              INT           NOT NULL AUTO_INCREMENT,
  nombre          VARCHAR(150)  NOT NULL,
  ciudad          VARCHAR(100)  NOT NULL,
  estado          VARCHAR(60)   NOT NULL DEFAULT '',
  tarifa_base     DECIMAL(12,2) NOT NULL COMMENT 'Tarifa por noche, habitación sencilla',
  tarifa_doble    DECIMAL(12,2) NULL     COMMENT 'Tarifa por noche, habitación doble',
  activo          TINYINT(1)    NOT NULL DEFAULT 1,
  convenio_clave  VARCHAR(255)  NULL     COMMENT 'Presente cuando lo mantiene un convenio',
  PRIMARY KEY (id),
  KEY ix_hoteles_estado (estado, activo),
  KEY ix_hoteles_nombre_ciudad (nombre, ciudad)
) ENGINE=InnoDB;

CREATE TABLE origenes (
  id      INT          NOT NULL AUTO_INCREMENT,
  nombre  VARCHAR(100) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_origenes_nombre (nombre)
) ENGINE=InnoDB;

CREATE TABLE estados_mx (
  nombre VARCHAR(60) NOT NULL,
  PRIMARY KEY (nombre)
) ENGINE=InnoDB;

CREATE TABLE configuracion (
  clave  VARCHAR(64) NOT NULL,
  valor  JSON        NOT NULL,
  PRIMARY KEY (clave)
) ENGINE=InnoDB COMMENT='Parámetros de Configuración (umbral_finanzas, monto_comida_diario, SMTP…)';

CREATE TABLE folio_contador (
  id      TINYINT NOT NULL,
  ultimo  INT     NOT NULL COMMENT 'Último folio emitido (sin "#")',
  PRIMARY KEY (id),
  CONSTRAINT ck_folio_contador_id CHECK (id = 1)
) ENGINE=InnoDB;

-- Usuarios y seguridad ----------------------------------------------------
CREATE TABLE usuarios (
  id        VARCHAR(40)  NOT NULL,
  nombre    VARCHAR(120) NOT NULL,
  correo    VARCHAR(150) NOT NULL,
  password  VARCHAR(255) NOT NULL COMMENT 'DEMO: en claro. En producción guardar un hash.',
  rfc       VARCHAR(20)  NOT NULL,
  rol_id    INT          NOT NULL,
  empresa   VARCHAR(120) NOT NULL,
  jefe_id   VARCHAR(40)  NULL,
  activo    TINYINT(1)   NOT NULL DEFAULT 1,
  initials  VARCHAR(4)   NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  UNIQUE KEY uq_usuarios_correo (correo),
  UNIQUE KEY uq_usuarios_rfc (rfc),
  KEY ix_usuarios_jefe (jefe_id),
  CONSTRAINT fk_usuarios_rol  FOREIGN KEY (rol_id)  REFERENCES roles (id)    ON DELETE RESTRICT,
  CONSTRAINT fk_usuarios_jefe FOREIGN KEY (jefe_id) REFERENCES usuarios (id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE prealtas (
  id          VARCHAR(40)  NOT NULL,
  nombre      VARCHAR(120) NOT NULL,
  correo      VARCHAR(150) NOT NULL,
  rfc         VARCHAR(20)  NULL,
  banco       VARCHAR(80)  NULL,
  cuenta      VARCHAR(30)  NULL,
  clabe       VARCHAR(18)  NULL,
  sociedad    VARCHAR(120) NULL,
  password    VARCHAR(255) NOT NULL COMMENT 'DEMO: en claro',
  status      VARCHAR(20)  NOT NULL DEFAULT 'pendiente',
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_prealtas_status (status)
) ENGINE=InnoDB;

CREATE TABLE reset_codes (
  id          VARCHAR(40) NOT NULL,
  user_id     VARCHAR(40) NOT NULL,
  code        VARCHAR(10) NOT NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  used        TINYINT(1)  NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY ix_reset_user (user_id, used),
  CONSTRAINT fk_reset_usuario FOREIGN KEY (user_id) REFERENCES usuarios (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE sesiones (
  user_id     VARCHAR(40) NOT NULL,
  token       VARCHAR(80) NOT NULL COMMENT 'Sesión única: iniciar en otro lado reemplaza el token',
  updated_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id),
  CONSTRAINT fk_sesiones_usuario FOREIGN KEY (user_id) REFERENCES usuarios (id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Solicitudes -------------------------------------------------------------
CREATE TABLE solicitudes (
  id                 VARCHAR(40)   NOT NULL,
  folio              VARCHAR(10)   NOT NULL,
  user_id            VARCHAR(40)   NOT NULL,
  fecha              DATE          NOT NULL,
  empresa            VARCHAR(120)  NOT NULL COMMENT 'Nombre de la sociedad',
  origen             VARCHAR(100)  NOT NULL DEFAULT '',
  destino_resumen    VARCHAR(255)  NOT NULL DEFAULT '',
  tipo_viaje         VARCHAR(60)   NOT NULL DEFAULT '',
  motivo             TEXT          NOT NULL,
  personas_count     INT           NOT NULL DEFAULT 1,
  personas_nombres   VARCHAR(500)  NOT NULL DEFAULT '',
  monto_total        DECIMAL(12,2) NOT NULL DEFAULT 0,
  jefe_status        ENUM('Pendiente','Autorizado','Rechazado')        NOT NULL DEFAULT 'Pendiente',
  finanzas_status    ENUM('Pendiente','Autorizado','Rechazado','N/A')  NOT NULL DEFAULT 'N/A',
  estatus            ENUM('Abierto','Cerrado','Rechazado')             NOT NULL DEFAULT 'Abierto'
                     COMMENT 'Cerrado = autorizada y lista para comprobar',
  comprobante_viaje  VARCHAR(255)  NULL,
  nota_rechazo       TEXT          NULL,
  created_at         DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_solicitudes_folio (folio),
  KEY ix_solicitudes_user (user_id, created_at),
  KEY ix_solicitudes_estatus (estatus),
  CONSTRAINT fk_solicitudes_usuario FOREIGN KEY (user_id) REFERENCES usuarios (id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE solicitud_destinos (
  id            VARCHAR(40)   NOT NULL,
  solicitud_id  VARCHAR(40)   NOT NULL,
  estado        VARCHAR(60)   NOT NULL,
  fecha_inicio  DATE          NOT NULL,
  fecha_fin     DATE          NOT NULL,
  gasolina      DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'Pago directo de la empresa; no se comprueba',
  caseta        DECIMAL(12,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY ix_destinos_solicitud (solicitud_id),
  CONSTRAINT fk_destinos_solicitud FOREIGN KEY (solicitud_id) REFERENCES solicitudes (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE destino_hoteles (
  id               VARCHAR(40)   NOT NULL,
  destino_id       VARCHAR(40)   NOT NULL,
  hotel_id         INT           NULL COMMENT 'NULL = sin hotel de catálogo',
  fecha_inicio     DATE          NOT NULL,
  fecha_fin        DATE          NOT NULL,
  monto            DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'Tarifa por noche',
  manual           TINYINT(1)    NOT NULL DEFAULT 0,
  tipo_habitacion  ENUM('sencilla','doble') NOT NULL DEFAULT 'sencilla',
  motivo_cambio    VARCHAR(500)  NULL,
  PRIMARY KEY (id),
  KEY ix_dhoteles_destino (destino_id),
  CONSTRAINT fk_dhoteles_destino FOREIGN KEY (destino_id) REFERENCES solicitud_destinos (id) ON DELETE CASCADE,
  CONSTRAINT fk_dhoteles_hotel   FOREIGN KEY (hotel_id)   REFERENCES hoteles (id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE destino_transportes (
  id          VARCHAR(40)   NOT NULL,
  destino_id  VARCHAR(40)   NOT NULL,
  ambito      ENUM('foraneo','local') NOT NULL,
  tipo        VARCHAR(40)   NOT NULL COMMENT 'Avión, Autobús, Tren, Uber, Taxi, Metro, Combi, Otro',
  monto       DECIMAL(12,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY ix_dtransp_destino (destino_id),
  CONSTRAINT fk_dtransp_destino FOREIGN KEY (destino_id) REFERENCES solicitud_destinos (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE destino_vales (
  id          VARCHAR(40)   NOT NULL,
  destino_id  VARCHAR(40)   NOT NULL,
  concepto    VARCHAR(120)  NOT NULL,
  monto       DECIMAL(12,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY ix_dvales_destino (destino_id),
  CONSTRAINT fk_dvales_destino FOREIGN KEY (destino_id) REFERENCES solicitud_destinos (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE autorizaciones (
  id               VARCHAR(40) NOT NULL,
  solicitud_id     VARCHAR(40) NOT NULL,
  rol_autorizador  VARCHAR(60) NOT NULL COMMENT 'jefe_inmediato | finanzas',
  user_id          VARCHAR(40) NOT NULL,
  status           ENUM('autorizado','rechazado') NOT NULL,
  fecha            DATE        NOT NULL,
  nota             TEXT        NULL,
  PRIMARY KEY (id),
  KEY ix_aut_solicitud (solicitud_id),
  CONSTRAINT fk_aut_solicitud FOREIGN KEY (solicitud_id) REFERENCES solicitudes (id) ON DELETE CASCADE,
  CONSTRAINT fk_aut_usuario   FOREIGN KEY (user_id)      REFERENCES usuarios (id)   ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE notas (
  id            VARCHAR(40) NOT NULL,
  solicitud_id  VARCHAR(40) NOT NULL,
  user_id       VARCHAR(40) NULL,
  nota          TEXT        NOT NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_notas_solicitud (solicitud_id),
  CONSTRAINT fk_notas_solicitud FOREIGN KEY (solicitud_id) REFERENCES solicitudes (id) ON DELETE CASCADE,
  CONSTRAINT fk_notas_usuario   FOREIGN KEY (user_id)      REFERENCES usuarios (id)   ON DELETE SET NULL
) ENGINE=InnoDB COMMENT='Reservada (ckl_notas)';

-- Comprobación ------------------------------------------------------------
CREATE TABLE comprobantes_gasto (
  id                VARCHAR(40)   NOT NULL,
  seq               BIGINT        NOT NULL AUTO_INCREMENT COMMENT 'Orden de captura de los renglones',
  solicitud_id      VARCHAR(40)   NOT NULL,
  concepto          VARCHAR(60)   NOT NULL COMMENT 'Hotel, Avión, Uber, Comida, Vales, Caseta…',
  monto_solicitado  DECIMAL(12,2) NOT NULL DEFAULT 0,
  monto_comprobado  DECIMAL(12,2) NOT NULL DEFAULT 0,
  status_renglon    ENUM('comprobado','parcialmente_comprobado','pendiente','no_aplica') NOT NULL DEFAULT 'pendiente',
  validado          TINYINT(1)    NOT NULL DEFAULT 0 COMMENT 'Validación de Compras Corporativas',
  validado_por      VARCHAR(40)   NULL,
  validado_fecha    DATE          NULL,
  nota_validacion   TEXT          NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cg_seq (seq),
  KEY ix_cg_solicitud (solicitud_id),
  CONSTRAINT fk_cg_solicitud FOREIGN KEY (solicitud_id) REFERENCES solicitudes (id) ON DELETE CASCADE,
  CONSTRAINT fk_cg_validador FOREIGN KEY (validado_por) REFERENCES usuarios (id)    ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE facturas (
  id              VARCHAR(40)   NOT NULL,
  solicitud_id    VARCHAR(40)   NOT NULL,
  tipo            ENUM('XML','PDF','FOTO') NOT NULL,
  fecha           DATE          NOT NULL,
  uuid            VARCHAR(60)   NOT NULL DEFAULT '',
  archivo         VARCHAR(255)  NOT NULL,
  total           DECIMAL(12,2) NOT NULL DEFAULT 0,
  status          ENUM('Verificado','Error','Incompleto') NOT NULL DEFAULT 'Verificado',
  concepto_id     VARCHAR(40)   NULL COMMENT 'Renglón de comprobación al que se aplicó el monto',
  monto_aplicado  DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'Solo el XML aplica monto; permite revertir exacto',
  par_id          VARCHAR(80)   NULL COMMENT 'Comparten par_id el XML y el PDF de un mismo comprobante',
  ruta            VARCHAR(500)  NULL COMMENT 'Ruta en disco (opcional); el contenido también va en factura_archivos',
  created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_facturas_solicitud (solicitud_id, par_id),
  KEY ix_facturas_concepto (concepto_id),
  CONSTRAINT fk_facturas_solicitud FOREIGN KEY (solicitud_id) REFERENCES solicitudes (id)        ON DELETE CASCADE,
  CONSTRAINT fk_facturas_concepto  FOREIGN KEY (concepto_id)  REFERENCES comprobantes_gasto (id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE factura_archivos (
  factura_id  VARCHAR(40) NOT NULL,
  mime        VARCHAR(100) NOT NULL,
  contenido   LONGBLOB     NOT NULL,
  PRIMARY KEY (factura_id),
  CONSTRAINT fk_farch_factura FOREIGN KEY (factura_id) REFERENCES facturas (id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='Archivos aparte para no cargar blobs en los listados';

-- Compras Corporativas: convenios y revisiones ---------------------------
CREATE TABLE convenios (
  id               VARCHAR(40)   NOT NULL,
  anio             SMALLINT      NOT NULL,
  tipo_sucursal    VARCHAR(40)   NOT NULL DEFAULT '',
  no_sucursal      VARCHAR(40)   NOT NULL DEFAULT '',
  destino          VARCHAR(100)  NOT NULL COMMENT 'Ciudad',
  estado           VARCHAR(60)   NOT NULL DEFAULT '',
  nombre_comercial VARCHAR(150)  NOT NULL,
  costo_sencilla   DECIMAL(12,2) NOT NULL,
  costo_doble      DECIMAL(12,2) NULL,
  no_proveedor     VARCHAR(40)   NOT NULL DEFAULT '',
  razon_social     VARCHAR(200)  NOT NULL DEFAULT '',
  telefono         VARCHAR(60)   NOT NULL DEFAULT '',
  contacto         VARCHAR(150)  NOT NULL DEFAULT '',
  banco            VARCHAR(80)   NOT NULL DEFAULT '',
  correo           VARCHAR(150)  NOT NULL DEFAULT '',
  notas            TEXT          NULL,
  activo           TINYINT(1)    NOT NULL DEFAULT 1 COMMENT 'Baja lógica',
  baja_motivo      VARCHAR(500)  NULL,
  baja_fecha       DATETIME(3)   NULL,
  creado_at        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  actualizado_at   DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_convenio_hotel_anio (nombre_comercial, destino, anio),
  KEY ix_convenios_anio (anio, activo)
) ENGINE=InnoDB;

CREATE TABLE revisiones_monto (
  id               VARCHAR(40)   NOT NULL,
  solicitud_id     VARCHAR(40)   NOT NULL,
  folio            VARCHAR(10)   NOT NULL,
  user_id          VARCHAR(40)   NOT NULL COMMENT 'Quien solicitó',
  destino_estado   VARCHAR(60)   NOT NULL DEFAULT '',
  hotel_stay_id    VARCHAR(40)   NOT NULL,
  hotel_id         INT           NULL,
  hotel_nombre     VARCHAR(150)  NOT NULL,
  tipo_habitacion  ENUM('sencilla','doble') NOT NULL DEFAULT 'sencilla',
  tarifa_default   DECIMAL(12,2) NOT NULL DEFAULT 0,
  monto_manual     DECIMAL(12,2) NOT NULL,
  motivo           VARCHAR(500)  NULL,
  noches           INT           NOT NULL,
  fecha_inicio     DATE          NOT NULL,
  fecha_fin        DATE          NOT NULL,
  creada_at        DATETIME(3)   NOT NULL,
  estado           ENUM('pendiente','aceptado','rechazado') NOT NULL DEFAULT 'pendiente',
  vigente          TINYINT(1)    NOT NULL DEFAULT 1 COMMENT '0 = una edición de la solicitud la dejó sin efecto',
  decidido_por     VARCHAR(40)   NULL,
  decidido_at      DATETIME(3)   NULL,
  comentario       TEXT          NULL,
  PRIMARY KEY (id),
  KEY ix_rev_solicitud (solicitud_id, vigente),
  KEY ix_rev_estado (estado),
  CONSTRAINT fk_rev_solicitud FOREIGN KEY (solicitud_id) REFERENCES solicitudes (id) ON DELETE CASCADE,
  CONSTRAINT fk_rev_hotel     FOREIGN KEY (hotel_id)     REFERENCES hoteles (id)     ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE correos (
  id          VARCHAR(40)  NOT NULL,
  fecha       DATETIME(3)  NOT NULL,
  para        VARCHAR(150) NOT NULL,
  usuario_id  VARCHAR(40)  NOT NULL,
  asunto      VARCHAR(255) NOT NULL,
  cuerpo      TEXT         NOT NULL,
  referencia  VARCHAR(40)  NOT NULL DEFAULT '' COMMENT 'id de la revisión',
  estado      ENUM('simulado','omitido') NOT NULL DEFAULT 'simulado',
  PRIMARY KEY (id),
  KEY ix_correos_referencia (referencia)
) ENGINE=InnoDB COMMENT='Sin servidor SMTP todavía: cada correo queda registrado aquí';

CREATE TABLE logs (
  id          VARCHAR(40)  NOT NULL,
  fecha       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  tipo        VARCHAR(80)  NOT NULL,
  entidad     VARCHAR(60)  NOT NULL,
  entidad_id  VARCHAR(80)  NOT NULL,
  usuario_id  VARCHAR(40)  NULL,
  detalle     JSON         NOT NULL,
  PRIMARY KEY (id),
  KEY ix_logs_entidad (entidad, entidad_id),
  KEY ix_logs_fecha (fecha),
  KEY ix_logs_tipo (tipo)
) ENGINE=InnoDB COMMENT='Bitácora de eventos (sin FK para conservarla aunque se borren usuarios)';

-- ───────────────────────────── 3. Datos de demostración ─────────────────────────────
-- Se cargan ANTES de crear los triggers para no duplicar bitácora ni re-aplicar montos.
-- roles
INSERT INTO roles (id, nombre, permisos) VALUES
  (1, 'usuario', '{"solicitar":true,"ver_propio":true,"comprobar":true,"ver_equipo":false,"ver_todo":false,"autorizar_lte5000":false,"autorizar_gt5000":false,"rechazar":false,"subir_comprobantes_viaje":false,"ver_reportes":false,"exportar_reportes":false,"gestionar_usuarios":false,"configurar_permisos":false,"configurar_montos":false}'),
  (2, 'jefe_inmediato', '{"solicitar":true,"ver_propio":true,"comprobar":false,"ver_equipo":true,"ver_todo":false,"autorizar_lte5000":true,"autorizar_gt5000":false,"rechazar":true,"subir_comprobantes_viaje":false,"ver_reportes":true,"exportar_reportes":false,"gestionar_usuarios":false,"configurar_permisos":false,"configurar_montos":false}'),
  (3, 'gestor_vuelos', '{"solicitar":false,"ver_propio":false,"comprobar":true,"ver_equipo":false,"ver_todo":true,"autorizar_lte5000":false,"autorizar_gt5000":false,"rechazar":false,"subir_comprobantes_viaje":true,"ver_reportes":false,"exportar_reportes":false,"gestionar_usuarios":false,"configurar_permisos":false,"configurar_montos":false}'),
  (4, 'finanzas', '{"solicitar":true,"ver_propio":true,"comprobar":false,"ver_equipo":false,"ver_todo":true,"autorizar_lte5000":false,"autorizar_gt5000":true,"rechazar":true,"subir_comprobantes_viaje":false,"ver_reportes":true,"exportar_reportes":true,"gestionar_usuarios":false,"configurar_permisos":false,"configurar_montos":false,"ver_gasto_por_concepto":true}'),
  (5, 'administrador', '{"solicitar":true,"ver_propio":true,"comprobar":true,"ver_equipo":true,"ver_todo":true,"autorizar_lte5000":true,"autorizar_gt5000":true,"rechazar":true,"subir_comprobantes_viaje":true,"ver_reportes":true,"exportar_reportes":true,"gestionar_usuarios":true,"configurar_permisos":true,"configurar_montos":true,"ver_gasto_por_concepto":true}'),
  (6, 'compras_corporativas', '{"validar_comprobacion":true,"revisar_monto_manual":true,"gestionar_convenios":true,"solicitar":true,"ver_propio":true,"comprobar":false,"ver_equipo":false,"ver_todo":true,"autorizar_lte5000":false,"autorizar_gt5000":true,"rechazar":true,"subir_comprobantes_viaje":false,"ver_reportes":true,"exportar_reportes":true,"gestionar_usuarios":false,"configurar_permisos":false,"configurar_montos":false,"ver_gasto_por_concepto":true}');

-- sociedades
INSERT INTO sociedades (id, nombre, rfc, regimen, cp, uso_cfdi, sociedad_sap) VALUES
  (1, 'WATA GROUP', 'WGR920403GN2', '601 - Gral. Personas Morales', '83000', 'Gastos en General', '2000'),
  (2, 'INTERMEDIARIA INTERMEX', 'CCO010101AB3', '601 - Gral. Personas Morales', '44100', 'Gastos en General', '3000'),
  (3, 'TRANSPORTES DE PERSONAL Y MERCANCIA', 'DCK150601XY1', '601 - Gral. Personas Morales', '44600', 'Gastos en General', '5000');

-- hoteles (catálogo; los de convenio llevan convenio_clave)
INSERT INTO hoteles (id, nombre, ciudad, estado, tarifa_base, tarifa_doble, activo, convenio_clave) VALUES
  (1, 'Hotel Hilton GDL', 'Guadalajara', 'Jalisco', 1250, NULL, 1, NULL),
  (2, 'Camino Real Guadalajara', 'Guadalajara', 'Jalisco', 980, NULL, 1, NULL),
  (3, 'Holiday Inn Express GDL', 'Guadalajara', 'Jalisco', 720, NULL, 1, NULL),
  (4, 'Hotel Krystal Urban GDL', 'Guadalajara', 'Jalisco', 850, NULL, 1, NULL),
  (5, 'City Express Guadalajara', 'Guadalajara', 'Jalisco', 590, NULL, 1, NULL),
  (6, 'JW Marriott CDMX', 'Ciudad de México', 'CDMX', 2100, NULL, 1, NULL),
  (7, 'Presidente Intercontinental', 'Ciudad de México', 'CDMX', 1850, NULL, 1, NULL),
  (8, 'Four Seasons México', 'Ciudad de México', 'CDMX', 3200, NULL, 1, NULL),
  (9, 'Hotel Geneve CDMX', 'Ciudad de México', 'CDMX', 1100, NULL, 1, NULL),
  (10, 'City Express Sur CDMX', 'Ciudad de México', 'CDMX', 680, NULL, 1, NULL),
  (11, 'Hotel Hilton León', 'León', 'Guanajuato', 1050, NULL, 1, NULL),
  (12, 'Hotel One León Norte', 'León', 'Guanajuato', 620, NULL, 1, NULL),
  (13, 'Holiday Inn León', 'León', 'Guanajuato', 880, NULL, 1, NULL),
  (14, 'Fiesta Inn León', 'León', 'Guanajuato', 790, NULL, 1, NULL),
  (15, 'Fiesta Inn Monterrey', 'Monterrey', 'Nuevo León', 950, NULL, 1, NULL),
  (16, 'NH Monterrey Centro', 'Monterrey', 'Nuevo León', 1150, NULL, 1, NULL),
  (17, 'Camino Real Monterrey', 'Monterrey', 'Nuevo León', 1380, NULL, 1, NULL),
  (18, 'City Express Monterrey', 'Monterrey', 'Nuevo León', 640, NULL, 1, NULL),
  (19, 'Radisson Querétaro', 'Querétaro', 'Querétaro', 870, NULL, 1, NULL),
  (20, 'Fiesta Inn QRO Centro', 'Querétaro', 'Querétaro', 760, NULL, 1, NULL),
  (21, 'Exe Querétaro', 'Querétaro', 'Querétaro', 580, NULL, 1, NULL),
  (22, 'Holiday Inn Querétaro', 'Querétaro', 'Querétaro', 920, NULL, 1, NULL),
  (23, 'Hotel Ceballos Colima', 'Colima', 'Colima', 550, NULL, 1, NULL),
  (24, 'Flamingos Plaza Colima', 'Colima', 'Colima', 480, NULL, 1, NULL),
  (25, 'Quinta Real Zacatecas', 'Zacatecas', 'Zacatecas', 1600, NULL, 1, NULL),
  (26, 'Emporio Zacatecas', 'Zacatecas', 'Zacatecas', 890, NULL, 1, NULL),
  (27, 'City Express Zacatecas', 'Zacatecas', 'Zacatecas', 560, NULL, 1, NULL),
  (28, 'Sheraton Buganvilias PVR', 'Puerto Vallarta', 'Jalisco', 1750, NULL, 1, NULL),
  (29, 'Marriott Puerto Vallarta', 'Puerto Vallarta', 'Jalisco', 2050, NULL, 1, NULL),
  (30, 'Fiesta Americana PVR', 'Puerto Vallarta', 'Jalisco', 1420, NULL, 1, NULL),
  (31, 'Hotel Gran Centenario', 'Mérida', 'Yucatán', 650, NULL, 1, 'hotel gran centenario|merida'),
  (32, 'Hotel Casa Palomino', 'Mérida', 'Yucatán', 720, 920, 1, 'hotel casa palomino|merida'),
  (33, 'Hotel Tapachula', 'Tapachula', 'Chiapas', 737.5, NULL, 1, 'hotel tapachula|tapachula'),
  (34, 'Hotel One Tapachula', 'Tapachula', 'Chiapas', 1350, 1350, 1, 'hotel one tapachula|tapachula'),
  (35, 'Hotel City Express by Marriott', 'Tapachula', 'Chiapas', 708, NULL, 1, 'hotel city express by marriott|tapachula'),
  (36, 'Hotel SAFI', 'Monterrey', 'Nuevo León', 1480, 1650, 1, 'hotel safi|monterrey'),
  (37, 'Hotel iSTAY Centro', 'Monterrey', 'Nuevo León', 1184.05, NULL, 1, 'hotel istay centro|monterrey'),
  (38, 'Hotel Atenas Plaza', 'Mex Iztapalapa', 'CDMX', 650, 850, 1, 'hotel atenas plaza|mex iztapalapa'),
  (39, 'Hotel City Express Jr By Marriott', 'Villahermosa', 'Tabasco', 770, NULL, 1, 'hotel city express jr by marriott|villahermosa'),
  (40, 'Hotel Maya Tabasco', 'Villahermosa', 'Tabasco', 770, NULL, 1, 'hotel maya tabasco|villahermosa'),
  (41, 'Hotel Nuve', 'Torreón', 'Coahuila', 850, 850, 1, 'hotel nuve|torreon'),
  (42, 'Savoy Express', 'Torreón', 'Coahuila', 815, 995, 1, 'savoy express|torreon');

-- orígenes
INSERT INTO origenes (nombre) VALUES
  ('Guadalajara'),
  ('Ciudad de México'),
  ('Monterrey'),
  ('León'),
  ('Querétaro');

-- estados de la República
INSERT INTO estados_mx (nombre) VALUES
  ('Aguascalientes'),
  ('Baja California'),
  ('Baja California Sur'),
  ('Campeche'),
  ('Chiapas'),
  ('Chihuahua'),
  ('CDMX'),
  ('Coahuila'),
  ('Colima'),
  ('Durango'),
  ('Estado de México'),
  ('Guanajuato'),
  ('Guerrero'),
  ('Hidalgo'),
  ('Jalisco'),
  ('Michoacán'),
  ('Morelos'),
  ('Nayarit'),
  ('Nuevo León'),
  ('Oaxaca'),
  ('Puebla'),
  ('Querétaro'),
  ('Quintana Roo'),
  ('San Luis Potosí'),
  ('Sinaloa'),
  ('Sonora'),
  ('Tabasco'),
  ('Tamaulipas'),
  ('Tlaxcala'),
  ('Veracruz'),
  ('Yucatán'),
  ('Zacatecas');

-- configuración
INSERT INTO configuracion (clave, valor) VALUES
  ('monto_comida_diario', '450'),
  ('umbral_finanzas', '5000'),
  ('dia_deposito', '"Viernes"'),
  ('email_compras', '"compras@cklass.com"'),
  ('dias_comprobacion_atrasada', '7'),
  ('dias_autorizacion_pendiente', '3'),
  ('dias_recordatorio_viaje', '2'),
  ('notif_email_activo', 'true'),
  ('notif_email_destinatarios', '""'),
  ('smtp_servidor', '""'),
  ('smtp_puerto', '587'),
  ('smtp_usuario', '""'),
  ('smtp_password', '""'),
  ('smtp_cifrado', '"TLS"'),
  ('notif_plataforma_activo', 'true'),
  ('revision_automatica_activo', 'true'),
  ('bloquear_folio_monto_hotel', 'false');

-- contador de folios (último folio emitido)
INSERT INTO folio_contador (id, ultimo) VALUES (1, 70);

-- usuarios demo (contraseñas en claro SOLO por ser datos de demostración)
INSERT INTO usuarios (id, nombre, correo, password, rfc, rol_id, empresa, jefe_id, activo, initials) VALUES
  ('u1', 'Alonso Pérez', 'admin@cklass.com', 'Admin123!', 'PEAL800101AB1', 5, 'WATA GROUP', NULL, 1, 'AP'),
  ('u2', 'Juan Alvarado', 'jefe@cklass.com', 'Jefe123!', 'ALAJ750505CD2', 2, 'INTERMEDIARIA INTERMEX', 'u1', 1, 'JA'),
  ('u3', 'María Torres', 'usuario@cklass.com', 'User123!', 'TOMM900312EF3', 1, 'WATA GROUP', 'u2', 1, 'MT'),
  ('u4', 'Luis Vega', 'finanzas@cklass.com', 'Fin123!', 'VEGAL850620GH4', 4, 'WATA GROUP', 'u1', 1, 'LV'),
  ('u5', 'Patricia Luna', 'gestor@cklass.com', 'Gest123!', 'LUMP920718IJ5', 3, 'INTERMEDIARIA INTERMEX', 'u1', 1, 'PL'),
  ('u6', 'Diego Ramírez', 'compras@cklass.com', 'Compras123!', 'RADI870415KL7', 6, 'WATA GROUP', 'u1', 1, 'DR'),
  ('u7', 'Carlos Mendoza', 'usuario2@cklass.com', 'User223!', 'MECA880215MN8', 1, 'INTERMEDIARIA INTERMEX', 'u2', 1, 'CM'),
  ('u8', 'Sofía Ramírez', 'usuario3@cklass.com', 'User323!', 'RASO910822PQ4', 1, 'TRANSPORTES DE PERSONAL Y MERCANCIA', 'u2', 1, 'SR');

-- solicitudes
INSERT INTO solicitudes (id, folio, user_id, fecha, empresa, origen, destino_resumen, tipo_viaje, motivo, personas_count, personas_nombres, monto_total, jefe_status, finanzas_status, estatus, comprobante_viaje, nota_rechazo, created_at) VALUES
  ('s22', '#0066', 'u7', '2026-10-26', 'INTERMEDIARIA INTERMEX', 'Guadalajara', 'GDL - Monterrey', 'Comercial', 'Reunión con distribuidores zona norte', 1, 'Carlos Mendoza', 9200, 'Pendiente', 'Pendiente', 'Abierto', NULL, NULL, '2026-10-26 00:00:00'),
  ('s23', '#0067', 'u8', '2026-10-26', 'TRANSPORTES DE PERSONAL Y MERCANCIA', 'Guadalajara', 'GDL - Zacatecas', 'Visita a proveedores', 'Revisión de patio y proveedores locales', 1, 'Sofía Ramírez', 6340, 'Pendiente', 'Pendiente', 'Abierto', NULL, NULL, '2026-10-26 00:00:00'),
  ('s26', '#0068', 'u2', '2026-10-24', 'INTERMEDIARIA INTERMEX', 'Guadalajara', 'GDL - Querétaro', 'Capacitación', 'Capacitación del equipo regional', 1, 'Juan Alvarado', 4500, 'Pendiente', 'N/A', 'Abierto', NULL, NULL, '2026-10-24 00:00:00'),
  ('s24', '#0069', 'u3', '2026-10-25', 'WATA GROUP', 'Guadalajara', 'GDL - CDMX', 'Expos', 'Participación en expo de proveedores', 1, 'María Torres', 8470, 'Pendiente', 'Pendiente', 'Abierto', NULL, NULL, '2026-10-25 00:00:00'),
  ('s25', '#0070', 'u7', '2026-10-23', 'INTERMEDIARIA INTERMEX', 'Guadalajara', 'GDL - León', 'Visita a tiendas', 'Supervisión de tiendas zona León', 1, 'Carlos Mendoza', 7250, 'Pendiente', 'Pendiente', 'Abierto', NULL, NULL, '2026-10-23 00:00:00'),
  ('s19', '#0063', 'u3', '2026-09-24', 'WATA GROUP', 'Guadalajara', 'GDL - Guanajuato', 'Visita a tiendas', 'Supervisión de tiendas del Bajío', 1, 'María Torres', 4030, 'Autorizado', 'N/A', 'Cerrado', '30/09/2026', NULL, '2026-09-24 00:00:00'),
  ('s20', '#0064', 'u7', '2026-10-02', 'INTERMEDIARIA INTERMEX', 'Guadalajara', 'GDL - Monterrey', 'Comercial', 'Reunión de cierre con clientes de la zona norte', 1, 'Carlos Mendoza', 5550, 'Autorizado', 'Autorizado', 'Cerrado', '07/10/2026', NULL, '2026-10-02 00:00:00'),
  ('s21', '#0065', 'u8', '2026-10-08', 'TRANSPORTES DE PERSONAL Y MERCANCIA', 'Guadalajara', 'GDL - Zacatecas', 'Visita a proveedores', 'Auditoría de flotilla en patio Zacatecas', 1, 'Sofía Ramírez', 4760, 'Autorizado', 'N/A', 'Cerrado', '14/10/2026', NULL, '2026-10-08 00:00:00'),
  ('s1', '#0041', 'u3', '2026-05-20', 'WATA GROUP', 'Guadalajara', 'GDL - León - QRO', 'Comercial', 'Visita a distribuidores zona Bajío', 2, 'M. Torres, J. Ruiz', 8050, 'Pendiente', 'Pendiente', 'Abierto', NULL, NULL, '2026-05-20 00:00:00'),
  ('s2', '#0040', 'u3', '2026-05-14', 'WATA GROUP', 'Guadalajara', 'GDL - CDMX', 'Auditoría', 'Revisión de estados financieros Q1', 1, 'M. Torres', 5200, 'Autorizado', 'Autorizado', 'Cerrado', '18/05/2026', NULL, '2026-05-14 00:00:00'),
  ('s3', '#0039', 'u3', '2026-05-02', 'WATA GROUP', 'Guadalajara', 'GDL - Colima', 'Visita a tiendas', 'Supervisión apertura nueva tienda Colima', 1, 'M. Torres', 2500, 'Autorizado', 'Rechazado', 'Rechazado', NULL, 'Monto de hotel no corresponde a tarifa acordada.', '2026-05-02 00:00:00'),
  ('s4', '#0038', 'u2', '2026-04-25', 'INTERMEDIARIA INTERMEX', 'Guadalajara', 'GDL - Zacatecas', 'Capacitación', 'Capacitación equipo de ventas regional', 3, 'J. Alvarado, P. Salas, R. Mora', 10000, 'Autorizado', 'Autorizado', 'Cerrado', '29/04/2026', NULL, '2026-04-25 00:00:00'),
  ('s5', '#0037', 'u3', '2026-04-10', 'WATA GROUP', 'Guadalajara', 'GDL - Monterrey', 'Comercial', 'Reunión con clientes clave zona norte', 2, 'M. Torres, C. Ibarra', 4800, 'Pendiente', 'N/A', 'Abierto', NULL, NULL, '2026-04-10 00:00:00'),
  ('s6', '#0036', 'u4', '2026-04-01', 'WATA GROUP', 'Guadalajara', 'GDL - Querétaro', 'Auditoría', 'Cierre de auditoría fiscal anual', 1, 'L. Vega', 3100, 'Autorizado', 'N/A', 'Cerrado', '05/04/2026', NULL, '2026-04-01 00:00:00'),
  ('s7', '#0042', 'u3', '2026-08-20', 'WATA GROUP', 'Guadalajara', 'GDL - Monterrey', 'Comercial', 'Reunión con distribuidores zona norte', 1, 'M. Torres', 7200, 'Pendiente', 'Pendiente', 'Abierto', NULL, NULL, '2026-08-20 00:00:00'),
  ('s8', '#0043', 'u2', '2026-08-25', 'INTERMEDIARIA INTERMEX', 'Guadalajara', 'GDL - Colima', 'Visita a tiendas', 'Supervisión de apertura de tienda nueva', 1, 'J. Alvarado', 3200, 'Pendiente', 'N/A', 'Abierto', NULL, NULL, '2026-08-25 00:00:00'),
  ('s9', '#0044', 'u6', '2026-08-28', 'WATA GROUP', 'Guadalajara', 'GDL - CDMX', 'Visita a proveedores', 'Negociación con proveedor nuevo', 1, 'D. Ramírez', 6100, 'Pendiente', 'Pendiente', 'Abierto', NULL, NULL, '2026-08-28 00:00:00'),
  ('s10', '#0045', 'u3', '2026-09-01', 'WATA GROUP', 'Guadalajara', 'GDL - Querétaro', 'Capacitación', 'Capacitación de equipo comercial', 1, 'M. Torres', 4500, 'Autorizado', 'N/A', 'Cerrado', NULL, NULL, '2026-09-01 00:00:00'),
  ('s11', '#0046', 'u3', '2026-09-03', 'WATA GROUP', 'Guadalajara', 'GDL - Colima', 'Comercial', 'Visita a cliente potencial', 1, 'M. Torres', 2100, 'Rechazado', 'N/A', 'Rechazado', NULL, 'Motivo de viaje insuficientemente justificado.', '2026-09-03 00:00:00'),
  ('s12', '#0047', 'u7', '2026-09-10', 'INTERMEDIARIA INTERMEX', 'Guadalajara', 'GDL - Zacatecas', 'Visita a proveedores', 'Revisión de flotilla en punto de distribución Zacatecas', 1, 'C. Mendoza', 6400, 'Pendiente', 'Pendiente', 'Abierto', NULL, NULL, '2026-09-10 00:00:00'),
  ('s13', '#0048', 'u7', '2026-09-05', 'INTERMEDIARIA INTERMEX', 'Guadalajara', 'GDL - CDMX', 'Auditoría', 'Revisión de cumplimiento normativo trimestral', 1, 'C. Mendoza', 4200, 'Autorizado', 'N/A', 'Cerrado', '18/09/2026', NULL, '2026-09-05 00:00:00'),
  ('s14', '#0049', 'u8', '2026-09-12', 'TRANSPORTES DE PERSONAL Y MERCANCIA', 'Guadalajara', 'GDL - Monterrey', 'Comercial', 'Negociación de contrato con cliente transportista', 1, 'S. Ramírez', 5800, 'Pendiente', 'Pendiente', 'Abierto', NULL, NULL, '2026-09-12 00:00:00'),
  ('s15', '#0050', 'u8', '2026-09-14', 'TRANSPORTES DE PERSONAL Y MERCANCIA', 'Guadalajara', 'GDL - Querétaro', 'Visita a tiendas', 'Supervisión de operación logística en centro de distribución', 1, 'S. Ramírez', 3100, 'Autorizado', 'N/A', 'Cerrado', '21/09/2026', NULL, '2026-09-14 00:00:00'),
  ('s16', '#0060', 'u3', '2026-09-16', 'WATA GROUP', 'Guadalajara', 'GDL - Zacatecas', 'Visita a tiendas', 'Supervisión de inventario en tienda Zacatecas', 1, 'M. Torres', 4600, 'Autorizado', 'N/A', 'Cerrado', '23/09/2026', NULL, '2026-09-16 00:00:00'),
  ('s17', '#0061', 'u7', '2026-09-17', 'INTERMEDIARIA INTERMEX', 'Guadalajara', 'GDL - Monterrey', 'Comercial', 'Cierre de contrato con cliente en Monterrey', 1, 'C. Mendoza', 6800, 'Autorizado', 'Autorizado', 'Cerrado', '24/09/2026', NULL, '2026-09-17 00:00:00'),
  ('s18', '#0062', 'u8', '2026-09-18', 'TRANSPORTES DE PERSONAL Y MERCANCIA', 'Guadalajara', 'GDL - CDMX', 'Comercial', 'Reunión con cliente de logística en CDMX', 1, 'S. Ramírez', 3900, 'Autorizado', 'N/A', 'Cerrado', '25/09/2026', NULL, '2026-09-18 00:00:00');

-- destinos
INSERT INTO solicitud_destinos (id, solicitud_id, estado, fecha_inicio, fecha_fin, gasolina, caseta) VALUES
  ('dd_s1', 's1', 'Guanajuato', '2026-05-23', '2026-05-28', 0, 0),
  ('dd_s2', 's2', 'CDMX', '2026-05-17', '2026-05-19', 0, 0),
  ('dd_s3', 's3', 'Colima', '2026-05-05', '2026-05-07', 0, 0),
  ('dd_s4', 's4', 'Zacatecas', '2026-04-28', '2026-05-02', 0, 0),
  ('dd_s5', 's5', 'Nuevo León', '2026-04-13', '2026-04-15', 0, 0),
  ('dd_s6', 's6', 'Querétaro', '2026-04-04', '2026-04-05', 0, 0),
  ('dd_s7', 's7', 'Nuevo León', '2026-08-23', '2026-08-26', 0, 0),
  ('dd_s8', 's8', 'Colima', '2026-08-28', '2026-08-30', 0, 0),
  ('dd_s9', 's9', 'CDMX', '2026-08-31', '2026-09-02', 0, 0),
  ('dd_s10', 's10', 'Querétaro', '2026-09-04', '2026-09-06', 0, 0),
  ('dd_s11', 's11', 'Colima', '2026-09-06', '2026-09-07', 0, 0),
  ('dd_s12', 's12', 'Zacatecas', '2026-09-13', '2026-09-16', 0, 0),
  ('dd_s13', 's13', 'CDMX', '2026-09-08', '2026-09-09', 0, 0),
  ('dd_s14', 's14', 'Nuevo León', '2026-09-15', '2026-09-17', 0, 0),
  ('dd_s15', 's15', 'Querétaro', '2026-09-17', '2026-09-18', 0, 0),
  ('dd_s16', 's16', 'Zacatecas', '2026-09-19', '2026-09-21', 0, 0),
  ('dd_s17', 's17', 'Nuevo León', '2026-09-20', '2026-09-22', 0, 0),
  ('dd_s18', 's18', 'CDMX', '2026-09-21', '2026-09-23', 0, 0),
  ('dd_s19', 's19', 'Guanajuato', '2026-09-28', '2026-09-30', 0, 0),
  ('dd_s20', 's20', 'Nuevo León', '2026-10-05', '2026-10-07', 0, 0),
  ('dd_s21', 's21', 'Zacatecas', '2026-10-12', '2026-10-14', 0, 0),
  ('dd_s22', 's22', 'Nuevo León', '2026-11-09', '2026-11-12', 0, 0),
  ('dd_s23', 's23', 'Zacatecas', '2026-11-16', '2026-11-19', 0, 0),
  ('dd_s26', 's26', 'Querétaro', '2026-11-04', '2026-11-06', 0, 0),
  ('dd_s24', 's24', 'CDMX', '2026-11-02', '2026-11-04', 0, 0),
  ('dd_s25', 's25', 'Guanajuato', '2026-11-23', '2026-11-26', 0, 0);

-- hoteles por destino
INSERT INTO destino_hoteles (id, destino_id, hotel_id, fecha_inicio, fecha_fin, monto, manual, tipo_habitacion, motivo_cambio) VALUES
  ('hh_s1', 'dd_s1', NULL, '2026-05-23', '2026-05-28', 620, 0, 'sencilla', NULL),
  ('hh_s2', 'dd_s2', NULL, '2026-05-17', '2026-05-19', 1600, 1, 'sencilla', NULL),
  ('hh_s3', 'dd_s3', NULL, '2026-05-05', '2026-05-07', 600, 1, 'sencilla', NULL),
  ('hh_s4', 'dd_s4', NULL, '2026-04-28', '2026-05-02', 890, 0, 'sencilla', NULL),
  ('hh_s5', 'dd_s5', NULL, '2026-04-13', '2026-04-15', 950, 0, 'sencilla', NULL),
  ('hh_s6', 'dd_s6', NULL, '2026-04-04', '2026-04-05', 760, 0, 'sencilla', NULL),
  ('hh_s7', 'dd_s7', NULL, '2026-08-23', '2026-08-26', 950, 0, 'sencilla', NULL),
  ('hh_s8', 'dd_s8', NULL, '2026-08-28', '2026-08-30', 550, 0, 'sencilla', NULL),
  ('hh_s9', 'dd_s9', NULL, '2026-08-31', '2026-09-02', 1100, 0, 'sencilla', NULL),
  ('hh_s10', 'dd_s10', NULL, '2026-09-04', '2026-09-06', 800, 1, 'sencilla', NULL),
  ('hh_s11', 'dd_s11', NULL, '2026-09-06', '2026-09-07', 550, 0, 'sencilla', NULL),
  ('hh_s12', 'dd_s12', NULL, '2026-09-13', '2026-09-16', 890, 0, 'sencilla', NULL),
  ('hh_s13', 'dd_s13', NULL, '2026-09-08', '2026-09-09', 1100, 0, 'sencilla', NULL),
  ('hh_s14', 'dd_s14', NULL, '2026-09-15', '2026-09-17', 950, 0, 'sencilla', NULL),
  ('hh_s15', 'dd_s15', NULL, '2026-09-17', '2026-09-18', 870, 0, 'sencilla', NULL),
  ('hh_s16', 'dd_s16', NULL, '2026-09-19', '2026-09-21', 890, 0, 'sencilla', NULL),
  ('hh_s17', 'dd_s17', NULL, '2026-09-20', '2026-09-22', 1150, 0, 'sencilla', NULL),
  ('hh_s18', 'dd_s18', NULL, '2026-09-21', '2026-09-23', 680, 0, 'sencilla', NULL),
  ('hh_s19', 'dd_s19', 14, '2026-09-28', '2026-09-30', 790, 0, 'sencilla', NULL),
  ('hh_s20', 'dd_s20', 15, '2026-10-05', '2026-10-07', 950, 0, 'sencilla', NULL),
  ('hh_s21', 'dd_s21', 26, '2026-10-12', '2026-10-14', 890, 0, 'sencilla', NULL),
  ('hh_s22_1', 'dd_s22', 17, '2026-11-09', '2026-11-12', 1700, 1, 'sencilla', NULL),
  ('hh_s23_1', 'dd_s23', 26, '2026-11-16', '2026-11-18', 1250, 1, 'sencilla', NULL),
  ('hh_s23_2', 'dd_s23', 27, '2026-11-18', '2026-11-19', 560, 0, 'sencilla', NULL),
  ('hh_s26_1', 'dd_s26', 19, '2026-11-04', '2026-11-06', 1100, 1, 'sencilla', NULL),
  ('hh_s24_1', 'dd_s24', 7, '2026-11-02', '2026-11-04', 2400, 1, 'sencilla', NULL),
  ('hh_s25_1', 'dd_s25', 13, '2026-11-23', '2026-11-26', 1500, 1, 'sencilla', NULL);

-- transportes por destino
INSERT INTO destino_transportes (id, destino_id, ambito, tipo, monto) VALUES
  ('rf_s1', 'dd_s1', 'foraneo', 'Autobús', 2254),
  ('rl_s1', 'dd_s1', 'local', 'Uber', 773),
  ('rf_s2', 'dd_s2', 'foraneo', 'Avión', 1800),
  ('rl_s2', 'dd_s2', 'local', 'Uber', 400),
  ('rf_s3', 'dd_s3', 'foraneo', 'Autobús', 500),
  ('rl_s3', 'dd_s3', 'local', 'Uber', 200),
  ('rf_s4', 'dd_s4', 'foraneo', 'Autobús', 2800),
  ('rl_s4', 'dd_s4', 'local', 'Uber', 960),
  ('rf_s5', 'dd_s5', 'foraneo', 'Avión', 1344),
  ('rl_s5', 'dd_s5', 'local', 'Uber', 461),
  ('rf_s6', 'dd_s6', 'foraneo', 'Autobús', 868),
  ('rl_s6', 'dd_s6', 'local', 'Uber', 298),
  ('rf_s7', 'dd_s7', 'foraneo', 'Avión', 2016),
  ('rl_s7', 'dd_s7', 'local', 'Uber', 691),
  ('rf_s8', 'dd_s8', 'foraneo', 'Autobús', 896),
  ('rl_s8', 'dd_s8', 'local', 'Uber', 307),
  ('rf_s9', 'dd_s9', 'foraneo', 'Avión', 1708),
  ('rl_s9', 'dd_s9', 'local', 'Uber', 586),
  ('rf_s10', 'dd_s10', 'foraneo', 'Autobús', 1400),
  ('rl_s10', 'dd_s10', 'local', 'Uber', 300),
  ('rf_s11', 'dd_s11', 'foraneo', 'Autobús', 588),
  ('rl_s11', 'dd_s11', 'local', 'Uber', 202),
  ('rf_s12', 'dd_s12', 'foraneo', 'Autobús', 1792),
  ('rl_s12', 'dd_s12', 'local', 'Uber', 614),
  ('rf_s13', 'dd_s13', 'foraneo', 'Avión', 1176),
  ('rl_s13', 'dd_s13', 'local', 'Uber', 403),
  ('rf_s14', 'dd_s14', 'foraneo', 'Avión', 1624),
  ('rl_s14', 'dd_s14', 'local', 'Uber', 557),
  ('rf_s15', 'dd_s15', 'foraneo', 'Autobús', 868),
  ('rl_s15', 'dd_s15', 'local', 'Uber', 298),
  ('rf_s16', 'dd_s16', 'foraneo', 'Autobús', 1288),
  ('rl_s16', 'dd_s16', 'local', 'Uber', 442),
  ('rf_s17', 'dd_s17', 'foraneo', 'Avión', 1904),
  ('rl_s17', 'dd_s17', 'local', 'Uber', 653),
  ('rf_s18', 'dd_s18', 'foraneo', 'Avión', 1092),
  ('rl_s18', 'dd_s18', 'local', 'Uber', 374),
  ('rf_s19', 'dd_s19', 'foraneo', 'Autobús', 600),
  ('rl_s19', 'dd_s19', 'local', 'Uber', 300),
  ('rf_s20', 'dd_s20', 'foraneo', 'Avión', 1600),
  ('rl_s20', 'dd_s20', 'local', 'Uber', 450),
  ('rf_s21', 'dd_s21', 'foraneo', 'Autobús', 1100),
  ('rl_s21', 'dd_s21', 'local', 'Uber', 380),
  ('rf_s22', 'dd_s22', 'foraneo', 'Avión', 1800),
  ('rl_s22', 'dd_s22', 'local', 'Uber', 500),
  ('rf_s23', 'dd_s23', 'foraneo', 'Autobús', 1100),
  ('rl_s23', 'dd_s23', 'local', 'Uber', 380),
  ('rf_s26', 'dd_s26', 'foraneo', 'Autobús', 700),
  ('rl_s26', 'dd_s26', 'local', 'Uber', 250),
  ('rf_s24', 'dd_s24', 'foraneo', 'Avión', 1900),
  ('rl_s24', 'dd_s24', 'local', 'Uber', 420),
  ('rf_s25', 'dd_s25', 'foraneo', 'Autobús', 650),
  ('rl_s25', 'dd_s25', 'local', 'Uber', 300);

-- vales / otros gastos por destino
INSERT INTO destino_vales (id, destino_id, concepto, monto) VALUES
  ('ro_s1', 'dd_s1', 'Imprevistos', 313),
  ('ro_s2', 'dd_s2', 'Regalos para cliente', 500),
  ('ro_s3', 'dd_s3', 'Imprevistos', 100),
  ('ro_s4', 'dd_s4', 'Material de capacitación', 680),
  ('ro_s5', 'dd_s5', 'Imprevistos', 135),
  ('ro_s6', 'dd_s6', 'Papelería', 554),
  ('ro_s7', 'dd_s7', 'Imprevistos', 203),
  ('ro_s8', 'dd_s8', 'Imprevistos', 257),
  ('ro_s9', 'dd_s9', 'Muestras de producto', 386),
  ('ro_s10', 'dd_s10', 'Material de capacitación', 300),
  ('ro_s11', 'dd_s11', 'Imprevistos', 340),
  ('ro_s12', 'dd_s12', 'Imprevistos', 44),
  ('ro_s13', 'dd_s13', 'Papelería', 681),
  ('ro_s14', 'dd_s14', 'Imprevistos', 559),
  ('ro_s15', 'dd_s15', 'Imprevistos', 444),
  ('ro_s16', 'dd_s16', 'Imprevistos', 170),
  ('ro_s17', 'dd_s17', 'Regalos para cliente', 583),
  ('ro_s18', 'dd_s18', 'Imprevistos', 294),
  ('ro_s19', 'dd_s19', 'Papelería', 200),
  ('ro_s20', 'dd_s20', 'Material de capacitación', 250),
  ('ro_s21', 'dd_s21', 'Imprevistos', 150);

-- autorizaciones
INSERT INTO autorizaciones (id, solicitud_id, rol_autorizador, user_id, status, fecha, nota) VALUES
  ('a1', 's2', 'jefe_inmediato', 'u2', 'autorizado', '2026-05-15', ''),
  ('a2', 's2', 'finanzas', 'u4', 'autorizado', '2026-05-16', ''),
  ('a3', 's3', 'jefe_inmediato', 'u2', 'autorizado', '2026-05-03', ''),
  ('a4', 's3', 'finanzas', 'u4', 'rechazado', '2026-05-04', 'Monto de hotel no corresponde a tarifa acordada.'),
  ('a5', 's4', 'jefe_inmediato', 'u2', 'autorizado', '2026-04-26', ''),
  ('a6', 's4', 'finanzas', 'u4', 'autorizado', '2026-04-27', ''),
  ('a7', 's6', 'jefe_inmediato', 'u2', 'autorizado', '2026-04-02', ''),
  ('a8', 's10', 'jefe_inmediato', 'u2', 'autorizado', '2026-09-02', ''),
  ('a9', 's11', 'jefe_inmediato', 'u2', 'rechazado', '2026-09-04', 'Motivo de viaje insuficientemente justificado.'),
  ('a10', 's13', 'jefe_inmediato', 'u2', 'autorizado', '2026-09-06', ''),
  ('a11', 's15', 'jefe_inmediato', 'u2', 'autorizado', '2026-09-15', ''),
  ('a12', 's16', 'jefe_inmediato', 'u2', 'autorizado', '2026-09-17', ''),
  ('a13', 's17', 'jefe_inmediato', 'u2', 'autorizado', '2026-09-18', ''),
  ('a14', 's17', 'finanzas', 'u4', 'autorizado', '2026-09-18', ''),
  ('a15', 's18', 'jefe_inmediato', 'u2', 'autorizado', '2026-09-19', ''),
  ('av_s19_j', 's19', 'jefe_inmediato', 'u2', 'autorizado', '2026-09-24', ''),
  ('av_s20_j', 's20', 'jefe_inmediato', 'u2', 'autorizado', '2026-10-02', ''),
  ('av_s20_f', 's20', 'finanzas', 'u4', 'autorizado', '2026-10-02', ''),
  ('av_s21_j', 's21', 'jefe_inmediato', 'u2', 'autorizado', '2026-10-08', '');

-- renglones de comprobación
INSERT INTO comprobantes_gasto (id, solicitud_id, concepto, monto_solicitado, monto_comprobado, status_renglon, validado, validado_por, validado_fecha, nota_validacion) VALUES
  ('cg1', 's2', 'Hotel', 1600, 1600, 'comprobado', 0, NULL, NULL, NULL),
  ('cg_6ppn5efa', 's2', 'Avión', 1800, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cg_d6vgtkv2', 's2', 'Uber', 400, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cg4', 's2', 'Comida', 900, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cg5', 's2', 'Vales', 500, 500, 'comprobado', 0, NULL, NULL, NULL),
  ('cg6', 's10', 'Hotel', 1600, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cg_mtkmmihc', 's10', 'Autobús', 1400, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cg_hwgmrvli', 's10', 'Uber', 300, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cg9', 's10', 'Comida', 900, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cg10', 's10', 'Vales', 300, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgd_s1_1', 's1', 'Hotel', 3100, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cg_kzphalks', 's1', 'Autobús', 2254, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cg_r8gw43kq', 's1', 'Uber', 773, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgd_s1_4', 's1', 'Comida', 1610, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgd_s1_5', 's1', 'Vales', 313, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgd_s3_1', 's3', 'Hotel', 1200, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cg_ec91vlf8', 's3', 'Autobús', 500, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cg_r0c4pq6e', 's3', 'Uber', 200, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgd_s3_4', 's3', 'Comida', 500, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgd_s3_5', 's3', 'Vales', 100, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgd_s4_1', 's4', 'Hotel', 3560, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cg_smczpvw8', 's4', 'Autobús', 2800, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cg_xdv9xf66', 's4', 'Uber', 960, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgd_s4_4', 's4', 'Comida', 2000, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgd_s4_5', 's4', 'Vales', 680, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgd_s5_1', 's5', 'Hotel', 1900, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cg_fiqbklhh', 's5', 'Avión', 1344, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cg_6jxstc8p', 's5', 'Uber', 461, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgd_s5_4', 's5', 'Comida', 960, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgd_s5_5', 's5', 'Vales', 135, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgd_s6_1', 's6', 'Hotel', 760, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cg_zxkw7p02', 's6', 'Autobús', 868, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cg_b1jae60b', 's6', 'Uber', 298, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgd_s6_4', 's6', 'Comida', 620, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgd_s6_5', 's6', 'Vales', 554, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgd_s7_1', 's7', 'Hotel', 2850, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cg_zkuksnqs', 's7', 'Avión', 2016, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cg_1tbn7lyz', 's7', 'Uber', 691, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgd_s7_4', 's7', 'Comida', 1440, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgd_s7_5', 's7', 'Vales', 203, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgd_s8_1', 's8', 'Hotel', 1100, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cg_1jnud1s6', 's8', 'Autobús', 896, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cg_asaojo1z', 's8', 'Uber', 307, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgd_s8_4', 's8', 'Comida', 640, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgd_s8_5', 's8', 'Vales', 257, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgd_s9_1', 's9', 'Hotel', 2200, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cg_d0kdsghv', 's9', 'Avión', 1708, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cg_a9ri1ue4', 's9', 'Uber', 586, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgd_s9_4', 's9', 'Comida', 1220, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgd_s9_5', 's9', 'Vales', 386, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgd_s11_1', 's11', 'Hotel', 550, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cg_3gv220cx', 's11', 'Autobús', 588, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cg_bzwlgldk', 's11', 'Uber', 202, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgd_s11_4', 's11', 'Comida', 420, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgd_s11_5', 's11', 'Vales', 340, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgd_s12_1', 's12', 'Hotel', 2670, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cg_gbqxw155', 's12', 'Autobús', 1792, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cg_i78uxlko', 's12', 'Uber', 614, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgd_s12_4', 's12', 'Comida', 1280, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgd_s12_5', 's12', 'Vales', 44, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgd_s13_1', 's13', 'Hotel', 1100, 1100, 'comprobado', 0, NULL, NULL, NULL),
  ('cg_q7vby10p', 's13', 'Avión', 1176, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cg_hnieebz4', 's13', 'Uber', 403, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgd_s13_4', 's13', 'Comida', 840, 840, 'comprobado', 0, NULL, NULL, NULL),
  ('cgd_s13_5', 's13', 'Vales', 681, 681, 'comprobado', 0, NULL, NULL, NULL),
  ('cgd_s14_1', 's14', 'Hotel', 1900, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cg_7yilbifg', 's14', 'Avión', 1624, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cg_2mclrbr2', 's14', 'Uber', 557, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgd_s14_4', 's14', 'Comida', 1160, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgd_s14_5', 's14', 'Vales', 559, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgd_s15_1', 's15', 'Hotel', 870, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cg_5ha0j1b0', 's15', 'Autobús', 868, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cg_kox3rteh', 's15', 'Uber', 298, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgd_s15_4', 's15', 'Comida', 620, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgd_s15_5', 's15', 'Vales', 444, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgd_s16_1', 's16', 'Hotel', 1780, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cg_u8x61iz5', 's16', 'Autobús', 1288, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cg_odjoz6cv', 's16', 'Uber', 442, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgd_s16_4', 's16', 'Comida', 920, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgd_s16_5', 's16', 'Vales', 170, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgd_s17_1', 's17', 'Hotel', 2300, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cg_xhhlpbvi', 's17', 'Avión', 1904, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cg_8d54yu16', 's17', 'Uber', 653, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgd_s17_4', 's17', 'Comida', 1360, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgd_s17_5', 's17', 'Vales', 583, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgd_s18_1', 's18', 'Hotel', 1360, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cg_aslj0vo5', 's18', 'Avión', 1092, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cg_h7jv8yl8', 's18', 'Uber', 374, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgd_s18_4', 's18', 'Comida', 780, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgd_s18_5', 's18', 'Vales', 294, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgv_s19_1', 's19', 'Hotel', 1580, 1580, 'comprobado', 0, NULL, NULL, NULL),
  ('cgv_s19_2', 's19', 'Autobús', 600, 600, 'comprobado', 0, NULL, NULL, NULL),
  ('cgv_s19_3', 's19', 'Uber', 300, 300, 'comprobado', 0, NULL, NULL, NULL),
  ('cgv_s19_4', 's19', 'Comida', 1350, 1350, 'comprobado', 0, NULL, NULL, NULL),
  ('cgv_s19_5', 's19', 'Vales', 200, 200, 'comprobado', 0, NULL, NULL, NULL),
  ('cgv_s20_1', 's20', 'Hotel', 1900, 1900, 'comprobado', 1, 'u6', '2026-10-20', NULL),
  ('cgv_s20_2', 's20', 'Avión', 1600, 1600, 'comprobado', 1, 'u6', '2026-10-20', NULL),
  ('cgv_s20_3', 's20', 'Uber', 450, 450, 'comprobado', 1, 'u6', '2026-10-20', NULL),
  ('cgv_s20_4', 's20', 'Comida', 1350, 1350, 'comprobado', 1, 'u6', '2026-10-20', NULL),
  ('cgv_s20_5', 's20', 'Vales', 250, 250, 'comprobado', 1, 'u6', '2026-10-20', NULL),
  ('cgv_s21_1', 's21', 'Hotel', 1780, 1780, 'comprobado', 1, 'u6', '2026-10-20', NULL),
  ('cgv_s21_2', 's21', 'Autobús', 1100, 1100, 'comprobado', 1, 'u6', '2026-10-20', NULL),
  ('cgv_s21_3', 's21', 'Uber', 380, 380, 'comprobado', 1, 'u6', '2026-10-20', NULL),
  ('cgv_s21_4', 's21', 'Comida', 1350, 1350, 'comprobado', 0, NULL, NULL, 'El RFC del receptor de esta factura no coincide con la sociedad; solicitar factura corregida.'),
  ('cgv_s21_5', 's21', 'Vales', 150, 150, 'comprobado', 0, NULL, NULL, NULL),
  ('cgm_s22_1', 's22', 'Hotel', 5100, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgm_s22_2', 's22', 'Avión', 1800, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgm_s22_3', 's22', 'Uber', 500, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgm_s22_4', 's22', 'Comida', 1800, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgm_s22_5', 's22', 'Vales', 0, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgm_s23_1', 's23', 'Hotel', 3060, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgm_s23_2', 's23', 'Autobús', 1100, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgm_s23_3', 's23', 'Uber', 380, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgm_s23_4', 's23', 'Comida', 1800, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgm_s23_5', 's23', 'Vales', 0, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgm_s26_1', 's26', 'Hotel', 2200, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgm_s26_2', 's26', 'Autobús', 700, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgm_s26_3', 's26', 'Uber', 250, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgm_s26_4', 's26', 'Comida', 1350, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgm_s26_5', 's26', 'Vales', 0, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgm_s24_1', 's24', 'Hotel', 4800, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgm_s24_2', 's24', 'Avión', 1900, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgm_s24_3', 's24', 'Uber', 420, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgm_s24_4', 's24', 'Comida', 1350, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgm_s24_5', 's24', 'Vales', 0, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgm_s25_1', 's25', 'Hotel', 4500, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgm_s25_2', 's25', 'Autobús', 650, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgm_s25_3', 's25', 'Uber', 300, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgm_s25_4', 's25', 'Comida', 1800, 0, 'pendiente', 0, NULL, NULL, NULL),
  ('cgm_s25_5', 's25', 'Vales', 0, 0, 'pendiente', 0, NULL, NULL, NULL);

-- facturas (metadatos)
INSERT INTO facturas (id, solicitud_id, tipo, fecha, uuid, archivo, total, status, concepto_id, monto_aplicado, par_id) VALUES
  ('fv_s19_1', 's19', 'XML', '2026-09-30', 'S191A7C1-4B2E-4F1A-9D3C-100000ABCDEF', 's19_hotel_factura.xml', 1580, 'Verificado', 'cgv_s19_1', 1580, 'par_fv_s19_1'),
  ('fv_s19_1p', 's19', 'PDF', '2026-09-30', 'S191A7C1-4B2E-4F1A-9D3C-100000ABCDEF', 's19_hotel_factura.pdf', 1580, 'Verificado', 'cgv_s19_1', 0, 'par_fv_s19_1'),
  ('fv_s19_2', 's19', 'XML', '2026-09-30', 'S192A7C1-4B2E-4F1A-9D3C-100037ABCDEF', 's19_autobús_factura.xml', 600, 'Verificado', 'cgv_s19_2', 600, 'par_fv_s19_2'),
  ('fv_s19_2p', 's19', 'PDF', '2026-09-30', 'S192A7C1-4B2E-4F1A-9D3C-100037ABCDEF', 's19_autobús_factura.pdf', 600, 'Verificado', 'cgv_s19_2', 0, 'par_fv_s19_2'),
  ('fv_s19_3', 's19', 'XML', '2026-09-30', 'S193A7C1-4B2E-4F1A-9D3C-100074ABCDEF', 's19_uber_factura.xml', 300, 'Verificado', 'cgv_s19_3', 300, 'par_fv_s19_3'),
  ('fv_s19_3p', 's19', 'PDF', '2026-09-30', 'S193A7C1-4B2E-4F1A-9D3C-100074ABCDEF', 's19_uber_factura.pdf', 300, 'Verificado', 'cgv_s19_3', 0, 'par_fv_s19_3'),
  ('fv_s19_4', 's19', 'XML', '2026-09-30', 'S194A7C1-4B2E-4F1A-9D3C-100111ABCDEF', 's19_comida_factura.xml', 1350, 'Verificado', 'cgv_s19_4', 1350, 'par_fv_s19_4'),
  ('fv_s19_4p', 's19', 'PDF', '2026-09-30', 'S194A7C1-4B2E-4F1A-9D3C-100111ABCDEF', 's19_comida_factura.pdf', 1350, 'Verificado', 'cgv_s19_4', 0, 'par_fv_s19_4'),
  ('fv_s19_5', 's19', 'PDF', '2026-09-30', 'S195A7C1-4B2E-4F1A-9D3C-100148ABCDEF', 's19_vales_comprobante.pdf', 200, 'Verificado', 'cgv_s19_5', 200, NULL),
  ('fv_s20_1', 's20', 'XML', '2026-10-07', 'S201A7C1-4B2E-4F1A-9D3C-100000ABCDEF', 's20_hotel_factura.xml', 1900, 'Verificado', 'cgv_s20_1', 1900, 'par_fv_s20_1'),
  ('fv_s20_1p', 's20', 'PDF', '2026-10-07', 'S201A7C1-4B2E-4F1A-9D3C-100000ABCDEF', 's20_hotel_factura.pdf', 1900, 'Verificado', 'cgv_s20_1', 0, 'par_fv_s20_1'),
  ('fv_s20_2', 's20', 'XML', '2026-10-07', 'S202A7C1-4B2E-4F1A-9D3C-100037ABCDEF', 's20_avión_factura.xml', 1600, 'Verificado', 'cgv_s20_2', 1600, 'par_fv_s20_2'),
  ('fv_s20_2p', 's20', 'PDF', '2026-10-07', 'S202A7C1-4B2E-4F1A-9D3C-100037ABCDEF', 's20_avión_factura.pdf', 1600, 'Verificado', 'cgv_s20_2', 0, 'par_fv_s20_2'),
  ('fv_s20_3', 's20', 'XML', '2026-10-07', 'S203A7C1-4B2E-4F1A-9D3C-100074ABCDEF', 's20_uber_factura.xml', 450, 'Verificado', 'cgv_s20_3', 450, 'par_fv_s20_3'),
  ('fv_s20_3p', 's20', 'PDF', '2026-10-07', 'S203A7C1-4B2E-4F1A-9D3C-100074ABCDEF', 's20_uber_factura.pdf', 450, 'Verificado', 'cgv_s20_3', 0, 'par_fv_s20_3'),
  ('fv_s20_4', 's20', 'XML', '2026-10-07', 'S204A7C1-4B2E-4F1A-9D3C-100111ABCDEF', 's20_comida_factura.xml', 1350, 'Verificado', 'cgv_s20_4', 1350, 'par_fv_s20_4'),
  ('fv_s20_4p', 's20', 'PDF', '2026-10-07', 'S204A7C1-4B2E-4F1A-9D3C-100111ABCDEF', 's20_comida_factura.pdf', 1350, 'Verificado', 'cgv_s20_4', 0, 'par_fv_s20_4'),
  ('fv_s20_5', 's20', 'PDF', '2026-10-07', 'S205A7C1-4B2E-4F1A-9D3C-100148ABCDEF', 's20_vales_comprobante.pdf', 250, 'Verificado', 'cgv_s20_5', 250, NULL),
  ('fv_s21_1', 's21', 'XML', '2026-10-14', 'S211A7C1-4B2E-4F1A-9D3C-100000ABCDEF', 's21_hotel_factura.xml', 1780, 'Verificado', 'cgv_s21_1', 1780, 'par_fv_s21_1'),
  ('fv_s21_1p', 's21', 'PDF', '2026-10-14', 'S211A7C1-4B2E-4F1A-9D3C-100000ABCDEF', 's21_hotel_factura.pdf', 1780, 'Verificado', 'cgv_s21_1', 0, 'par_fv_s21_1'),
  ('fv_s21_2', 's21', 'XML', '2026-10-14', 'S212A7C1-4B2E-4F1A-9D3C-100037ABCDEF', 's21_autobús_factura.xml', 1100, 'Verificado', 'cgv_s21_2', 1100, 'par_fv_s21_2'),
  ('fv_s21_2p', 's21', 'PDF', '2026-10-14', 'S212A7C1-4B2E-4F1A-9D3C-100037ABCDEF', 's21_autobús_factura.pdf', 1100, 'Verificado', 'cgv_s21_2', 0, 'par_fv_s21_2'),
  ('fv_s21_3', 's21', 'XML', '2026-10-14', 'S213A7C1-4B2E-4F1A-9D3C-100074ABCDEF', 's21_uber_factura.xml', 380, 'Verificado', 'cgv_s21_3', 380, 'par_fv_s21_3'),
  ('fv_s21_3p', 's21', 'PDF', '2026-10-14', 'S213A7C1-4B2E-4F1A-9D3C-100074ABCDEF', 's21_uber_factura.pdf', 380, 'Verificado', 'cgv_s21_3', 0, 'par_fv_s21_3'),
  ('fv_s21_4', 's21', 'XML', '2026-10-14', 'S214A7C1-4B2E-4F1A-9D3C-100111ABCDEF', 's21_comida_factura.xml', 1350, 'Verificado', 'cgv_s21_4', 1350, 'par_fv_s21_4'),
  ('fv_s21_4p', 's21', 'PDF', '2026-10-14', 'S214A7C1-4B2E-4F1A-9D3C-100111ABCDEF', 's21_comida_factura.pdf', 1350, 'Verificado', 'cgv_s21_4', 0, 'par_fv_s21_4'),
  ('fv_s21_5', 's21', 'PDF', '2026-10-14', 'S215A7C1-4B2E-4F1A-9D3C-100148ABCDEF', 's21_vales_comprobante.pdf', 150, 'Verificado', 'cgv_s21_5', 150, NULL);

-- contenido de las facturas (LONGBLOB)
INSERT INTO factura_archivos (factura_id, mime, contenido) VALUES
  ('fv_s19_1', 'text/xml', FROM_BASE64('PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPGNmZGk6Q29tcHJvYmFudGUgeG1sbnM6Y2ZkaT0iaHR0cDovL3d3dy5zYXQuZ29iLm14L2NmZC80IiB4bWxuczp0ZmQ9Imh0dHA6Ly93d3cuc2F0LmdvYi5teC9UaW1icmVGaXNjYWxEaWdpdGFsIiBWZXJzaW9uPSI0LjAiIFNlcmllPSJBIiBGb2xpbz0iUzE5MUE3IiBGZWNoYT0iMjAyNi0wOS0zMFQxMDozMDowMCIgTW9uZWRhPSJNWE4iIFN1YlRvdGFsPSIxMzYyLjA3IiBUb3RhbD0iMTU4MC4wMCIgVGlwb0RlQ29tcHJvYmFudGU9IkkiPgogIDxjZmRpOkVtaXNvciBSZmM9IkZJTDAxMDEwMUFCMSIgTm9tYnJlPSJGaWVzdGEgSW5uIExlw7NuIi8+CiAgPGNmZGk6UmVjZXB0b3IgUmZjPSJXR1I5MjA0MDNHTjIiIE5vbWJyZT0iV0FUQSBHUk9VUCIgVXNvQ0ZEST0iRzAzIi8+CiAgPGNmZGk6Q29uY2VwdG9zPgogICAgPGNmZGk6Q29uY2VwdG8gRGVzY3JpcGNpb249IkhvdGVsIiBDYW50aWRhZD0iMSIgVmFsb3JVbml0YXJpbz0iMTM2Mi4wNyIvPgogIDwvY2ZkaTpDb25jZXB0b3M+CiAgPGNmZGk6Q29tcGxlbWVudG8+CiAgICA8dGZkOlRpbWJyZUZpc2NhbERpZ2l0YWwgVmVyc2lvbj0iMS4xIiBVVUlEPSJTMTkxQTdDMS00QjJFLTRGMUEtOUQzQy0xMDAwMDBBQkNERUYiLz4KICA8L2NmZGk6Q29tcGxlbWVudG8+CjwvY2ZkaTpDb21wcm9iYW50ZT4=')),
  ('fv_s19_1p', 'application/pdf', FROM_BASE64('JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNSAwIFIgPj4gPj4gPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCAyMjEgPj4Kc3RyZWFtCkJUIC9GMSAxMiBUZiA2MCA3NDAgVGQgKENvbXByb2JhbnRlIGRlIEhvdGVsKSBUaiBFVApCVCAvRjEgMTIgVGYgNjAgNzIwIFRkIChFbWlzb3I6IEZpZXN0YSBJbm4gTGVuKSBUaiBFVApCVCAvRjEgMTIgVGYgNjAgNzAwIFRkIChGb2xpbzogIzAwNjMgIEltcG9ydGU6ICQxNTgwLjAwIE1YTikgVGogRVQKQlQgL0YxIDEyIFRmIDYwIDY4MCBUZCAoRmVjaGE6IDMwLzA5LzIwMjYpIFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKNSAwIG9iago8PCAvVHlwZSAvRm9udCAvU3VidHlwZSAvVHlwZTEgL0Jhc2VGb250IC9IZWx2ZXRpY2EgPj4KZW5kb2JqCnhyZWYKMCA2CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU4IDAwMDAwIG4gCjAwMDAwMDAxMTUgMDAwMDAgbiAKMDAwMDAwMDI0MSAwMDAwMCBuIAowMDAwMDAwNTEzIDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgNiAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKNTgzCiUlRU9G')),
  ('fv_s19_2', 'text/xml', FROM_BASE64('PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPGNmZGk6Q29tcHJvYmFudGUgeG1sbnM6Y2ZkaT0iaHR0cDovL3d3dy5zYXQuZ29iLm14L2NmZC80IiB4bWxuczp0ZmQ9Imh0dHA6Ly93d3cuc2F0LmdvYi5teC9UaW1icmVGaXNjYWxEaWdpdGFsIiBWZXJzaW9uPSI0LjAiIFNlcmllPSJBIiBGb2xpbz0iUzE5MkE3IiBGZWNoYT0iMjAyNi0wOS0zMFQxMDozMDowMCIgTW9uZWRhPSJNWE4iIFN1YlRvdGFsPSI1MTcuMjQiIFRvdGFsPSI2MDAuMDAiIFRpcG9EZUNvbXByb2JhbnRlPSJJIj4KICA8Y2ZkaTpFbWlzb3IgUmZjPSJBQkEwMTAxMDFDRDIiIE5vbWJyZT0iQXV0b2J1c2VzIGRlbCBCYWrDrW8iLz4KICA8Y2ZkaTpSZWNlcHRvciBSZmM9IldHUjkyMDQwM0dOMiIgTm9tYnJlPSJXQVRBIEdST1VQIiBVc29DRkRJPSJHMDMiLz4KICA8Y2ZkaTpDb25jZXB0b3M+CiAgICA8Y2ZkaTpDb25jZXB0byBEZXNjcmlwY2lvbj0iQXV0b2LDunMiIENhbnRpZGFkPSIxIiBWYWxvclVuaXRhcmlvPSI1MTcuMjQiLz4KICA8L2NmZGk6Q29uY2VwdG9zPgogIDxjZmRpOkNvbXBsZW1lbnRvPgogICAgPHRmZDpUaW1icmVGaXNjYWxEaWdpdGFsIFZlcnNpb249IjEuMSIgVVVJRD0iUzE5MkE3QzEtNEIyRS00RjFBLTlEM0MtMTAwMDM3QUJDREVGIi8+CiAgPC9jZmRpOkNvbXBsZW1lbnRvPgo8L2NmZGk6Q29tcHJvYmFudGU+')),
  ('fv_s19_2p', 'application/pdf', FROM_BASE64('JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNSAwIFIgPj4gPj4gPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCAyMjUgPj4Kc3RyZWFtCkJUIC9GMSAxMiBUZiA2MCA3NDAgVGQgKENvbXByb2JhbnRlIGRlIEF1dG9icykgVGogRVQKQlQgL0YxIDEyIFRmIDYwIDcyMCBUZCAoRW1pc29yOiBBdXRvYnVzZXMgZGVsIEJham8pIFRqIEVUCkJUIC9GMSAxMiBUZiA2MCA3MDAgVGQgKEZvbGlvOiAjMDA2MyAgSW1wb3J0ZTogJDYwMC4wMCBNWE4pIFRqIEVUCkJUIC9GMSAxMiBUZiA2MCA2ODAgVGQgKEZlY2hhOiAzMC8wOS8yMDI2KSBUaiBFVAplbmRzdHJlYW0KZW5kb2JqCjUgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+CmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCjAwMDAwMDAyNDEgMDAwMDAgbiAKMDAwMDAwMDUxNyAwMDAwMCBuIAp0cmFpbGVyCjw8IC9TaXplIDYgL1Jvb3QgMSAwIFIgPj4Kc3RhcnR4cmVmCjU4NwolJUVPRg==')),
  ('fv_s19_3', 'text/xml', FROM_BASE64('PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPGNmZGk6Q29tcHJvYmFudGUgeG1sbnM6Y2ZkaT0iaHR0cDovL3d3dy5zYXQuZ29iLm14L2NmZC80IiB4bWxuczp0ZmQ9Imh0dHA6Ly93d3cuc2F0LmdvYi5teC9UaW1icmVGaXNjYWxEaWdpdGFsIiBWZXJzaW9uPSI0LjAiIFNlcmllPSJBIiBGb2xpbz0iUzE5M0E3IiBGZWNoYT0iMjAyNi0wOS0zMFQxMDozMDowMCIgTW9uZWRhPSJNWE4iIFN1YlRvdGFsPSIyNTguNjIiIFRvdGFsPSIzMDAuMDAiIFRpcG9EZUNvbXByb2JhbnRlPSJJIj4KICA8Y2ZkaTpFbWlzb3IgUmZjPSJYQVhYMDEwMTAxMDAwIiBOb21icmU9IlViZXIgTcOpeGljbyIvPgogIDxjZmRpOlJlY2VwdG9yIFJmYz0iV0dSOTIwNDAzR04yIiBOb21icmU9IldBVEEgR1JPVVAiIFVzb0NGREk9IkcwMyIvPgogIDxjZmRpOkNvbmNlcHRvcz4KICAgIDxjZmRpOkNvbmNlcHRvIERlc2NyaXBjaW9uPSJVYmVyIiBDYW50aWRhZD0iMSIgVmFsb3JVbml0YXJpbz0iMjU4LjYyIi8+CiAgPC9jZmRpOkNvbmNlcHRvcz4KICA8Y2ZkaTpDb21wbGVtZW50bz4KICAgIDx0ZmQ6VGltYnJlRmlzY2FsRGlnaXRhbCBWZXJzaW9uPSIxLjEiIFVVSUQ9IlMxOTNBN0MxLTRCMkUtNEYxQS05RDNDLTEwMDA3NEFCQ0RFRiIvPgogIDwvY2ZkaTpDb21wbGVtZW50bz4KPC9jZmRpOkNvbXByb2JhbnRlPg==')),
  ('fv_s19_3p', 'application/pdf', FROM_BASE64('JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNSAwIFIgPj4gPj4gPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCAyMTUgPj4Kc3RyZWFtCkJUIC9GMSAxMiBUZiA2MCA3NDAgVGQgKENvbXByb2JhbnRlIGRlIFViZXIpIFRqIEVUCkJUIC9GMSAxMiBUZiA2MCA3MjAgVGQgKEVtaXNvcjogVWJlciBNeGljbykgVGogRVQKQlQgL0YxIDEyIFRmIDYwIDcwMCBUZCAoRm9saW86ICMwMDYzICBJbXBvcnRlOiAkMzAwLjAwIE1YTikgVGogRVQKQlQgL0YxIDEyIFRmIDYwIDY4MCBUZCAoRmVjaGE6IDMwLzA5LzIwMjYpIFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKNSAwIG9iago8PCAvVHlwZSAvRm9udCAvU3VidHlwZSAvVHlwZTEgL0Jhc2VGb250IC9IZWx2ZXRpY2EgPj4KZW5kb2JqCnhyZWYKMCA2CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU4IDAwMDAwIG4gCjAwMDAwMDAxMTUgMDAwMDAgbiAKMDAwMDAwMDI0MSAwMDAwMCBuIAowMDAwMDAwNTA3IDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgNiAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKNTc3CiUlRU9G')),
  ('fv_s19_4', 'text/xml', FROM_BASE64('PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPGNmZGk6Q29tcHJvYmFudGUgeG1sbnM6Y2ZkaT0iaHR0cDovL3d3dy5zYXQuZ29iLm14L2NmZC80IiB4bWxuczp0ZmQ9Imh0dHA6Ly93d3cuc2F0LmdvYi5teC9UaW1icmVGaXNjYWxEaWdpdGFsIiBWZXJzaW9uPSI0LjAiIFNlcmllPSJBIiBGb2xpbz0iUzE5NEE3IiBGZWNoYT0iMjAyNi0wOS0zMFQxMDozMDowMCIgTW9uZWRhPSJNWE4iIFN1YlRvdGFsPSIxMTYzLjc5IiBUb3RhbD0iMTM1MC4wMCIgVGlwb0RlQ29tcHJvYmFudGU9IkkiPgogIDxjZmRpOkVtaXNvciBSZmM9IlJDRTAxMDEwMU1ONyIgTm9tYnJlPSJSZXN0YXVyYW50ZXMgZGVsIENlbnRybyIvPgogIDxjZmRpOlJlY2VwdG9yIFJmYz0iV0dSOTIwNDAzR04yIiBOb21icmU9IldBVEEgR1JPVVAiIFVzb0NGREk9IkcwMyIvPgogIDxjZmRpOkNvbmNlcHRvcz4KICAgIDxjZmRpOkNvbmNlcHRvIERlc2NyaXBjaW9uPSJDb21pZGEiIENhbnRpZGFkPSIxIiBWYWxvclVuaXRhcmlvPSIxMTYzLjc5Ii8+CiAgPC9jZmRpOkNvbmNlcHRvcz4KICA8Y2ZkaTpDb21wbGVtZW50bz4KICAgIDx0ZmQ6VGltYnJlRmlzY2FsRGlnaXRhbCBWZXJzaW9uPSIxLjEiIFVVSUQ9IlMxOTRBN0MxLTRCMkUtNEYxQS05RDNDLTEwMDExMUFCQ0RFRiIvPgogIDwvY2ZkaTpDb21wbGVtZW50bz4KPC9jZmRpOkNvbXByb2JhbnRlPg==')),
  ('fv_s19_4p', 'application/pdf', FROM_BASE64('JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNSAwIFIgPj4gPj4gPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCAyMzEgPj4Kc3RyZWFtCkJUIC9GMSAxMiBUZiA2MCA3NDAgVGQgKENvbXByb2JhbnRlIGRlIENvbWlkYSkgVGogRVQKQlQgL0YxIDEyIFRmIDYwIDcyMCBUZCAoRW1pc29yOiBSZXN0YXVyYW50ZXMgZGVsIENlbnRybykgVGogRVQKQlQgL0YxIDEyIFRmIDYwIDcwMCBUZCAoRm9saW86ICMwMDYzICBJbXBvcnRlOiAkMTM1MC4wMCBNWE4pIFRqIEVUCkJUIC9GMSAxMiBUZiA2MCA2ODAgVGQgKEZlY2hhOiAzMC8wOS8yMDI2KSBUaiBFVAplbmRzdHJlYW0KZW5kb2JqCjUgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+CmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCjAwMDAwMDAyNDEgMDAwMDAgbiAKMDAwMDAwMDUyMyAwMDAwMCBuIAp0cmFpbGVyCjw8IC9TaXplIDYgL1Jvb3QgMSAwIFIgPj4Kc3RhcnR4cmVmCjU5MwolJUVPRg==')),
  ('fv_s19_5', 'application/pdf', FROM_BASE64('JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNSAwIFIgPj4gPj4gPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCAyMTQgPj4Kc3RyZWFtCkJUIC9GMSAxMiBUZiA2MCA3NDAgVGQgKENvbXByb2JhbnRlIGRlIFZhbGVzKSBUaiBFVApCVCAvRjEgMTIgVGYgNjAgNzIwIFRkIChFbWlzb3I6IFBhcGVsZXJhKSBUaiBFVApCVCAvRjEgMTIgVGYgNjAgNzAwIFRkIChGb2xpbzogIzAwNjMgIEltcG9ydGU6ICQyMDAuMDAgTVhOKSBUaiBFVApCVCAvRjEgMTIgVGYgNjAgNjgwIFRkIChGZWNoYTogMzAvMDkvMjAyNikgVGogRVQKZW5kc3RyZWFtCmVuZG9iago1IDAgb2JqCjw8IC9UeXBlIC9Gb250IC9TdWJ0eXBlIC9UeXBlMSAvQmFzZUZvbnQgL0hlbHZldGljYSA+PgplbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAowMDAwMDAwMjQxIDAwMDAwIG4gCjAwMDAwMDA1MDYgMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSA2IC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgo1NzYKJSVFT0Y=')),
  ('fv_s20_1', 'text/xml', FROM_BASE64('PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPGNmZGk6Q29tcHJvYmFudGUgeG1sbnM6Y2ZkaT0iaHR0cDovL3d3dy5zYXQuZ29iLm14L2NmZC80IiB4bWxuczp0ZmQ9Imh0dHA6Ly93d3cuc2F0LmdvYi5teC9UaW1icmVGaXNjYWxEaWdpdGFsIiBWZXJzaW9uPSI0LjAiIFNlcmllPSJBIiBGb2xpbz0iUzIwMUE3IiBGZWNoYT0iMjAyNi0xMC0wN1QxMDozMDowMCIgTW9uZWRhPSJNWE4iIFN1YlRvdGFsPSIxNjM3LjkzIiBUb3RhbD0iMTkwMC4wMCIgVGlwb0RlQ29tcHJvYmFudGU9IkkiPgogIDxjZmRpOkVtaXNvciBSZmM9IkZJTTAxMDEwMUVGMyIgTm9tYnJlPSJGaWVzdGEgSW5uIE1vbnRlcnJleSIvPgogIDxjZmRpOlJlY2VwdG9yIFJmYz0iQ0NPMDEwMTAxQUIzIiBOb21icmU9IklOVEVSTUVESUFSSUEgSU5URVJNRVgiIFVzb0NGREk9IkcwMyIvPgogIDxjZmRpOkNvbmNlcHRvcz4KICAgIDxjZmRpOkNvbmNlcHRvIERlc2NyaXBjaW9uPSJIb3RlbCIgQ2FudGlkYWQ9IjEiIFZhbG9yVW5pdGFyaW89IjE2MzcuOTMiLz4KICA8L2NmZGk6Q29uY2VwdG9zPgogIDxjZmRpOkNvbXBsZW1lbnRvPgogICAgPHRmZDpUaW1icmVGaXNjYWxEaWdpdGFsIFZlcnNpb249IjEuMSIgVVVJRD0iUzIwMUE3QzEtNEIyRS00RjFBLTlEM0MtMTAwMDAwQUJDREVGIi8+CiAgPC9jZmRpOkNvbXBsZW1lbnRvPgo8L2NmZGk6Q29tcHJvYmFudGU+')),
  ('fv_s20_1p', 'application/pdf', FROM_BASE64('JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNSAwIFIgPj4gPj4gPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCAyMjcgPj4Kc3RyZWFtCkJUIC9GMSAxMiBUZiA2MCA3NDAgVGQgKENvbXByb2JhbnRlIGRlIEhvdGVsKSBUaiBFVApCVCAvRjEgMTIgVGYgNjAgNzIwIFRkIChFbWlzb3I6IEZpZXN0YSBJbm4gTW9udGVycmV5KSBUaiBFVApCVCAvRjEgMTIgVGYgNjAgNzAwIFRkIChGb2xpbzogIzAwNjQgIEltcG9ydGU6ICQxOTAwLjAwIE1YTikgVGogRVQKQlQgL0YxIDEyIFRmIDYwIDY4MCBUZCAoRmVjaGE6IDA3LzEwLzIwMjYpIFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKNSAwIG9iago8PCAvVHlwZSAvRm9udCAvU3VidHlwZSAvVHlwZTEgL0Jhc2VGb250IC9IZWx2ZXRpY2EgPj4KZW5kb2JqCnhyZWYKMCA2CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU4IDAwMDAwIG4gCjAwMDAwMDAxMTUgMDAwMDAgbiAKMDAwMDAwMDI0MSAwMDAwMCBuIAowMDAwMDAwNTE5IDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgNiAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKNTg5CiUlRU9G')),
  ('fv_s20_2', 'text/xml', FROM_BASE64('PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPGNmZGk6Q29tcHJvYmFudGUgeG1sbnM6Y2ZkaT0iaHR0cDovL3d3dy5zYXQuZ29iLm14L2NmZC80IiB4bWxuczp0ZmQ9Imh0dHA6Ly93d3cuc2F0LmdvYi5teC9UaW1icmVGaXNjYWxEaWdpdGFsIiBWZXJzaW9uPSI0LjAiIFNlcmllPSJBIiBGb2xpbz0iUzIwMkE3IiBGZWNoYT0iMjAyNi0xMC0wN1QxMDozMDowMCIgTW9uZWRhPSJNWE4iIFN1YlRvdGFsPSIxMzc5LjMxIiBUb3RhbD0iMTYwMC4wMCIgVGlwb0RlQ29tcHJvYmFudGU9IkkiPgogIDxjZmRpOkVtaXNvciBSZmM9IkFOQTAxMDEwMUdINCIgTm9tYnJlPSJBZXJvbMOtbmVhIE5hY2lvbmFsIi8+CiAgPGNmZGk6UmVjZXB0b3IgUmZjPSJDQ08wMTAxMDFBQjMiIE5vbWJyZT0iSU5URVJNRURJQVJJQSBJTlRFUk1FWCIgVXNvQ0ZEST0iRzAzIi8+CiAgPGNmZGk6Q29uY2VwdG9zPgogICAgPGNmZGk6Q29uY2VwdG8gRGVzY3JpcGNpb249IkF2acOzbiIgQ2FudGlkYWQ9IjEiIFZhbG9yVW5pdGFyaW89IjEzNzkuMzEiLz4KICA8L2NmZGk6Q29uY2VwdG9zPgogIDxjZmRpOkNvbXBsZW1lbnRvPgogICAgPHRmZDpUaW1icmVGaXNjYWxEaWdpdGFsIFZlcnNpb249IjEuMSIgVVVJRD0iUzIwMkE3QzEtNEIyRS00RjFBLTlEM0MtMTAwMDM3QUJDREVGIi8+CiAgPC9jZmRpOkNvbXBsZW1lbnRvPgo8L2NmZGk6Q29tcHJvYmFudGU+')),
  ('fv_s20_2p', 'application/pdf', FROM_BASE64('JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNSAwIFIgPj4gPj4gPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCAyMjMgPj4Kc3RyZWFtCkJUIC9GMSAxMiBUZiA2MCA3NDAgVGQgKENvbXByb2JhbnRlIGRlIEF2aW4pIFRqIEVUCkJUIC9GMSAxMiBUZiA2MCA3MjAgVGQgKEVtaXNvcjogQWVyb2xuZWEgTmFjaW9uYWwpIFRqIEVUCkJUIC9GMSAxMiBUZiA2MCA3MDAgVGQgKEZvbGlvOiAjMDA2NCAgSW1wb3J0ZTogJDE2MDAuMDAgTVhOKSBUaiBFVApCVCAvRjEgMTIgVGYgNjAgNjgwIFRkIChGZWNoYTogMDcvMTAvMjAyNikgVGogRVQKZW5kc3RyZWFtCmVuZG9iago1IDAgb2JqCjw8IC9UeXBlIC9Gb250IC9TdWJ0eXBlIC9UeXBlMSAvQmFzZUZvbnQgL0hlbHZldGljYSA+PgplbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAowMDAwMDAwMjQxIDAwMDAwIG4gCjAwMDAwMDA1MTUgMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSA2IC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgo1ODUKJSVFT0Y=')),
  ('fv_s20_3', 'text/xml', FROM_BASE64('PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPGNmZGk6Q29tcHJvYmFudGUgeG1sbnM6Y2ZkaT0iaHR0cDovL3d3dy5zYXQuZ29iLm14L2NmZC80IiB4bWxuczp0ZmQ9Imh0dHA6Ly93d3cuc2F0LmdvYi5teC9UaW1icmVGaXNjYWxEaWdpdGFsIiBWZXJzaW9uPSI0LjAiIFNlcmllPSJBIiBGb2xpbz0iUzIwM0E3IiBGZWNoYT0iMjAyNi0xMC0wN1QxMDozMDowMCIgTW9uZWRhPSJNWE4iIFN1YlRvdGFsPSIzODcuOTMiIFRvdGFsPSI0NTAuMDAiIFRpcG9EZUNvbXByb2JhbnRlPSJJIj4KICA8Y2ZkaTpFbWlzb3IgUmZjPSJYQVhYMDEwMTAxMDAwIiBOb21icmU9IlViZXIgTcOpeGljbyIvPgogIDxjZmRpOlJlY2VwdG9yIFJmYz0iQ0NPMDEwMTAxQUIzIiBOb21icmU9IklOVEVSTUVESUFSSUEgSU5URVJNRVgiIFVzb0NGREk9IkcwMyIvPgogIDxjZmRpOkNvbmNlcHRvcz4KICAgIDxjZmRpOkNvbmNlcHRvIERlc2NyaXBjaW9uPSJVYmVyIiBDYW50aWRhZD0iMSIgVmFsb3JVbml0YXJpbz0iMzg3LjkzIi8+CiAgPC9jZmRpOkNvbmNlcHRvcz4KICA8Y2ZkaTpDb21wbGVtZW50bz4KICAgIDx0ZmQ6VGltYnJlRmlzY2FsRGlnaXRhbCBWZXJzaW9uPSIxLjEiIFVVSUQ9IlMyMDNBN0MxLTRCMkUtNEYxQS05RDNDLTEwMDA3NEFCQ0RFRiIvPgogIDwvY2ZkaTpDb21wbGVtZW50bz4KPC9jZmRpOkNvbXByb2JhbnRlPg==')),
  ('fv_s20_3p', 'application/pdf', FROM_BASE64('JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNSAwIFIgPj4gPj4gPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCAyMTUgPj4Kc3RyZWFtCkJUIC9GMSAxMiBUZiA2MCA3NDAgVGQgKENvbXByb2JhbnRlIGRlIFViZXIpIFRqIEVUCkJUIC9GMSAxMiBUZiA2MCA3MjAgVGQgKEVtaXNvcjogVWJlciBNeGljbykgVGogRVQKQlQgL0YxIDEyIFRmIDYwIDcwMCBUZCAoRm9saW86ICMwMDY0ICBJbXBvcnRlOiAkNDUwLjAwIE1YTikgVGogRVQKQlQgL0YxIDEyIFRmIDYwIDY4MCBUZCAoRmVjaGE6IDA3LzEwLzIwMjYpIFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKNSAwIG9iago8PCAvVHlwZSAvRm9udCAvU3VidHlwZSAvVHlwZTEgL0Jhc2VGb250IC9IZWx2ZXRpY2EgPj4KZW5kb2JqCnhyZWYKMCA2CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU4IDAwMDAwIG4gCjAwMDAwMDAxMTUgMDAwMDAgbiAKMDAwMDAwMDI0MSAwMDAwMCBuIAowMDAwMDAwNTA3IDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgNiAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKNTc3CiUlRU9G')),
  ('fv_s20_4', 'text/xml', FROM_BASE64('PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPGNmZGk6Q29tcHJvYmFudGUgeG1sbnM6Y2ZkaT0iaHR0cDovL3d3dy5zYXQuZ29iLm14L2NmZC80IiB4bWxuczp0ZmQ9Imh0dHA6Ly93d3cuc2F0LmdvYi5teC9UaW1icmVGaXNjYWxEaWdpdGFsIiBWZXJzaW9uPSI0LjAiIFNlcmllPSJBIiBGb2xpbz0iUzIwNEE3IiBGZWNoYT0iMjAyNi0xMC0wN1QxMDozMDowMCIgTW9uZWRhPSJNWE4iIFN1YlRvdGFsPSIxMTYzLjc5IiBUb3RhbD0iMTM1MC4wMCIgVGlwb0RlQ29tcHJvYmFudGU9IkkiPgogIDxjZmRpOkVtaXNvciBSZmM9IlJDRTAxMDEwMU1ONyIgTm9tYnJlPSJSZXN0YXVyYW50ZXMgZGVsIENlbnRybyIvPgogIDxjZmRpOlJlY2VwdG9yIFJmYz0iQ0NPMDEwMTAxQUIzIiBOb21icmU9IklOVEVSTUVESUFSSUEgSU5URVJNRVgiIFVzb0NGREk9IkcwMyIvPgogIDxjZmRpOkNvbmNlcHRvcz4KICAgIDxjZmRpOkNvbmNlcHRvIERlc2NyaXBjaW9uPSJDb21pZGEiIENhbnRpZGFkPSIxIiBWYWxvclVuaXRhcmlvPSIxMTYzLjc5Ii8+CiAgPC9jZmRpOkNvbmNlcHRvcz4KICA8Y2ZkaTpDb21wbGVtZW50bz4KICAgIDx0ZmQ6VGltYnJlRmlzY2FsRGlnaXRhbCBWZXJzaW9uPSIxLjEiIFVVSUQ9IlMyMDRBN0MxLTRCMkUtNEYxQS05RDNDLTEwMDExMUFCQ0RFRiIvPgogIDwvY2ZkaTpDb21wbGVtZW50bz4KPC9jZmRpOkNvbXByb2JhbnRlPg==')),
  ('fv_s20_4p', 'application/pdf', FROM_BASE64('JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNSAwIFIgPj4gPj4gPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCAyMzEgPj4Kc3RyZWFtCkJUIC9GMSAxMiBUZiA2MCA3NDAgVGQgKENvbXByb2JhbnRlIGRlIENvbWlkYSkgVGogRVQKQlQgL0YxIDEyIFRmIDYwIDcyMCBUZCAoRW1pc29yOiBSZXN0YXVyYW50ZXMgZGVsIENlbnRybykgVGogRVQKQlQgL0YxIDEyIFRmIDYwIDcwMCBUZCAoRm9saW86ICMwMDY0ICBJbXBvcnRlOiAkMTM1MC4wMCBNWE4pIFRqIEVUCkJUIC9GMSAxMiBUZiA2MCA2ODAgVGQgKEZlY2hhOiAwNy8xMC8yMDI2KSBUaiBFVAplbmRzdHJlYW0KZW5kb2JqCjUgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+CmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCjAwMDAwMDAyNDEgMDAwMDAgbiAKMDAwMDAwMDUyMyAwMDAwMCBuIAp0cmFpbGVyCjw8IC9TaXplIDYgL1Jvb3QgMSAwIFIgPj4Kc3RhcnR4cmVmCjU5MwolJUVPRg==')),
  ('fv_s20_5', 'application/pdf', FROM_BASE64('JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNSAwIFIgPj4gPj4gPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCAyMjkgPj4Kc3RyZWFtCkJUIC9GMSAxMiBUZiA2MCA3NDAgVGQgKENvbXByb2JhbnRlIGRlIFZhbGVzKSBUaiBFVApCVCAvRjEgMTIgVGYgNjAgNzIwIFRkIChFbWlzb3I6IE1hdGVyaWFsIGRlIGNhcGFjaXRhY2luKSBUaiBFVApCVCAvRjEgMTIgVGYgNjAgNzAwIFRkIChGb2xpbzogIzAwNjQgIEltcG9ydGU6ICQyNTAuMDAgTVhOKSBUaiBFVApCVCAvRjEgMTIgVGYgNjAgNjgwIFRkIChGZWNoYTogMDcvMTAvMjAyNikgVGogRVQKZW5kc3RyZWFtCmVuZG9iago1IDAgb2JqCjw8IC9UeXBlIC9Gb250IC9TdWJ0eXBlIC9UeXBlMSAvQmFzZUZvbnQgL0hlbHZldGljYSA+PgplbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAowMDAwMDAwMjQxIDAwMDAwIG4gCjAwMDAwMDA1MjEgMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSA2IC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgo1OTEKJSVFT0Y=')),
  ('fv_s21_1', 'text/xml', FROM_BASE64('PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPGNmZGk6Q29tcHJvYmFudGUgeG1sbnM6Y2ZkaT0iaHR0cDovL3d3dy5zYXQuZ29iLm14L2NmZC80IiB4bWxuczp0ZmQ9Imh0dHA6Ly93d3cuc2F0LmdvYi5teC9UaW1icmVGaXNjYWxEaWdpdGFsIiBWZXJzaW9uPSI0LjAiIFNlcmllPSJBIiBGb2xpbz0iUzIxMUE3IiBGZWNoYT0iMjAyNi0xMC0xNFQxMDozMDowMCIgTW9uZWRhPSJNWE4iIFN1YlRvdGFsPSIxNTM0LjQ4IiBUb3RhbD0iMTc4MC4wMCIgVGlwb0RlQ29tcHJvYmFudGU9IkkiPgogIDxjZmRpOkVtaXNvciBSZmM9IkVaQTAxMDEwMUlKNSIgTm9tYnJlPSJFbXBvcmlvIFphY2F0ZWNhcyIvPgogIDxjZmRpOlJlY2VwdG9yIFJmYz0iRENLMTUwNjAxWFkxIiBOb21icmU9IlRSQU5TUE9SVEVTIERFIFBFUlNPTkFMIFkgTUVSQ0FOQ0lBIiBVc29DRkRJPSJHMDMiLz4KICA8Y2ZkaTpDb25jZXB0b3M+CiAgICA8Y2ZkaTpDb25jZXB0byBEZXNjcmlwY2lvbj0iSG90ZWwiIENhbnRpZGFkPSIxIiBWYWxvclVuaXRhcmlvPSIxNTM0LjQ4Ii8+CiAgPC9jZmRpOkNvbmNlcHRvcz4KICA8Y2ZkaTpDb21wbGVtZW50bz4KICAgIDx0ZmQ6VGltYnJlRmlzY2FsRGlnaXRhbCBWZXJzaW9uPSIxLjEiIFVVSUQ9IlMyMTFBN0MxLTRCMkUtNEYxQS05RDNDLTEwMDAwMEFCQ0RFRiIvPgogIDwvY2ZkaTpDb21wbGVtZW50bz4KPC9jZmRpOkNvbXByb2JhbnRlPg==')),
  ('fv_s21_1p', 'application/pdf', FROM_BASE64('JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNSAwIFIgPj4gPj4gPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCAyMjQgPj4Kc3RyZWFtCkJUIC9GMSAxMiBUZiA2MCA3NDAgVGQgKENvbXByb2JhbnRlIGRlIEhvdGVsKSBUaiBFVApCVCAvRjEgMTIgVGYgNjAgNzIwIFRkIChFbWlzb3I6IEVtcG9yaW8gWmFjYXRlY2FzKSBUaiBFVApCVCAvRjEgMTIgVGYgNjAgNzAwIFRkIChGb2xpbzogIzAwNjUgIEltcG9ydGU6ICQxNzgwLjAwIE1YTikgVGogRVQKQlQgL0YxIDEyIFRmIDYwIDY4MCBUZCAoRmVjaGE6IDE0LzEwLzIwMjYpIFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKNSAwIG9iago8PCAvVHlwZSAvRm9udCAvU3VidHlwZSAvVHlwZTEgL0Jhc2VGb250IC9IZWx2ZXRpY2EgPj4KZW5kb2JqCnhyZWYKMCA2CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU4IDAwMDAwIG4gCjAwMDAwMDAxMTUgMDAwMDAgbiAKMDAwMDAwMDI0MSAwMDAwMCBuIAowMDAwMDAwNTE2IDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgNiAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKNTg2CiUlRU9G')),
  ('fv_s21_2', 'text/xml', FROM_BASE64('PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPGNmZGk6Q29tcHJvYmFudGUgeG1sbnM6Y2ZkaT0iaHR0cDovL3d3dy5zYXQuZ29iLm14L2NmZC80IiB4bWxuczp0ZmQ9Imh0dHA6Ly93d3cuc2F0LmdvYi5teC9UaW1icmVGaXNjYWxEaWdpdGFsIiBWZXJzaW9uPSI0LjAiIFNlcmllPSJBIiBGb2xpbz0iUzIxMkE3IiBGZWNoYT0iMjAyNi0xMC0xNFQxMDozMDowMCIgTW9uZWRhPSJNWE4iIFN1YlRvdGFsPSI5NDguMjgiIFRvdGFsPSIxMTAwLjAwIiBUaXBvRGVDb21wcm9iYW50ZT0iSSI+CiAgPGNmZGk6RW1pc29yIFJmYz0iQVpBMDEwMTAxS0w2IiBOb21icmU9IkF1dG9idXNlcyBaYWNhdGVjYW5vcyIvPgogIDxjZmRpOlJlY2VwdG9yIFJmYz0iRENLMTUwNjAxWFkxIiBOb21icmU9IlRSQU5TUE9SVEVTIERFIFBFUlNPTkFMIFkgTUVSQ0FOQ0lBIiBVc29DRkRJPSJHMDMiLz4KICA8Y2ZkaTpDb25jZXB0b3M+CiAgICA8Y2ZkaTpDb25jZXB0byBEZXNjcmlwY2lvbj0iQXV0b2LDunMiIENhbnRpZGFkPSIxIiBWYWxvclVuaXRhcmlvPSI5NDguMjgiLz4KICA8L2NmZGk6Q29uY2VwdG9zPgogIDxjZmRpOkNvbXBsZW1lbnRvPgogICAgPHRmZDpUaW1icmVGaXNjYWxEaWdpdGFsIFZlcnNpb249IjEuMSIgVVVJRD0iUzIxMkE3QzEtNEIyRS00RjFBLTlEM0MtMTAwMDM3QUJDREVGIi8+CiAgPC9jZmRpOkNvbXBsZW1lbnRvPgo8L2NmZGk6Q29tcHJvYmFudGU+')),
  ('fv_s21_2p', 'application/pdf', FROM_BASE64('JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNSAwIFIgPj4gPj4gPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCAyMjkgPj4Kc3RyZWFtCkJUIC9GMSAxMiBUZiA2MCA3NDAgVGQgKENvbXByb2JhbnRlIGRlIEF1dG9icykgVGogRVQKQlQgL0YxIDEyIFRmIDYwIDcyMCBUZCAoRW1pc29yOiBBdXRvYnVzZXMgWmFjYXRlY2Fub3MpIFRqIEVUCkJUIC9GMSAxMiBUZiA2MCA3MDAgVGQgKEZvbGlvOiAjMDA2NSAgSW1wb3J0ZTogJDExMDAuMDAgTVhOKSBUaiBFVApCVCAvRjEgMTIgVGYgNjAgNjgwIFRkIChGZWNoYTogMTQvMTAvMjAyNikgVGogRVQKZW5kc3RyZWFtCmVuZG9iago1IDAgb2JqCjw8IC9UeXBlIC9Gb250IC9TdWJ0eXBlIC9UeXBlMSAvQmFzZUZvbnQgL0hlbHZldGljYSA+PgplbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAowMDAwMDAwMjQxIDAwMDAwIG4gCjAwMDAwMDA1MjEgMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSA2IC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgo1OTEKJSVFT0Y=')),
  ('fv_s21_3', 'text/xml', FROM_BASE64('PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPGNmZGk6Q29tcHJvYmFudGUgeG1sbnM6Y2ZkaT0iaHR0cDovL3d3dy5zYXQuZ29iLm14L2NmZC80IiB4bWxuczp0ZmQ9Imh0dHA6Ly93d3cuc2F0LmdvYi5teC9UaW1icmVGaXNjYWxEaWdpdGFsIiBWZXJzaW9uPSI0LjAiIFNlcmllPSJBIiBGb2xpbz0iUzIxM0E3IiBGZWNoYT0iMjAyNi0xMC0xNFQxMDozMDowMCIgTW9uZWRhPSJNWE4iIFN1YlRvdGFsPSIzMjcuNTkiIFRvdGFsPSIzODAuMDAiIFRpcG9EZUNvbXByb2JhbnRlPSJJIj4KICA8Y2ZkaTpFbWlzb3IgUmZjPSJYQVhYMDEwMTAxMDAwIiBOb21icmU9IlViZXIgTcOpeGljbyIvPgogIDxjZmRpOlJlY2VwdG9yIFJmYz0iRENLMTUwNjAxWFkxIiBOb21icmU9IlRSQU5TUE9SVEVTIERFIFBFUlNPTkFMIFkgTUVSQ0FOQ0lBIiBVc29DRkRJPSJHMDMiLz4KICA8Y2ZkaTpDb25jZXB0b3M+CiAgICA8Y2ZkaTpDb25jZXB0byBEZXNjcmlwY2lvbj0iVWJlciIgQ2FudGlkYWQ9IjEiIFZhbG9yVW5pdGFyaW89IjMyNy41OSIvPgogIDwvY2ZkaTpDb25jZXB0b3M+CiAgPGNmZGk6Q29tcGxlbWVudG8+CiAgICA8dGZkOlRpbWJyZUZpc2NhbERpZ2l0YWwgVmVyc2lvbj0iMS4xIiBVVUlEPSJTMjEzQTdDMS00QjJFLTRGMUEtOUQzQy0xMDAwNzRBQkNERUYiLz4KICA8L2NmZGk6Q29tcGxlbWVudG8+CjwvY2ZkaTpDb21wcm9iYW50ZT4=')),
  ('fv_s21_3p', 'application/pdf', FROM_BASE64('JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNSAwIFIgPj4gPj4gPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCAyMTUgPj4Kc3RyZWFtCkJUIC9GMSAxMiBUZiA2MCA3NDAgVGQgKENvbXByb2JhbnRlIGRlIFViZXIpIFRqIEVUCkJUIC9GMSAxMiBUZiA2MCA3MjAgVGQgKEVtaXNvcjogVWJlciBNeGljbykgVGogRVQKQlQgL0YxIDEyIFRmIDYwIDcwMCBUZCAoRm9saW86ICMwMDY1ICBJbXBvcnRlOiAkMzgwLjAwIE1YTikgVGogRVQKQlQgL0YxIDEyIFRmIDYwIDY4MCBUZCAoRmVjaGE6IDE0LzEwLzIwMjYpIFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKNSAwIG9iago8PCAvVHlwZSAvRm9udCAvU3VidHlwZSAvVHlwZTEgL0Jhc2VGb250IC9IZWx2ZXRpY2EgPj4KZW5kb2JqCnhyZWYKMCA2CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU4IDAwMDAwIG4gCjAwMDAwMDAxMTUgMDAwMDAgbiAKMDAwMDAwMDI0MSAwMDAwMCBuIAowMDAwMDAwNTA3IDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgNiAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKNTc3CiUlRU9G')),
  ('fv_s21_4', 'text/xml', FROM_BASE64('PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPGNmZGk6Q29tcHJvYmFudGUgeG1sbnM6Y2ZkaT0iaHR0cDovL3d3dy5zYXQuZ29iLm14L2NmZC80IiB4bWxuczp0ZmQ9Imh0dHA6Ly93d3cuc2F0LmdvYi5teC9UaW1icmVGaXNjYWxEaWdpdGFsIiBWZXJzaW9uPSI0LjAiIFNlcmllPSJBIiBGb2xpbz0iUzIxNEE3IiBGZWNoYT0iMjAyNi0xMC0xNFQxMDozMDowMCIgTW9uZWRhPSJNWE4iIFN1YlRvdGFsPSIxMTYzLjc5IiBUb3RhbD0iMTM1MC4wMCIgVGlwb0RlQ29tcHJvYmFudGU9IkkiPgogIDxjZmRpOkVtaXNvciBSZmM9IlJDRTAxMDEwMU1ONyIgTm9tYnJlPSJSZXN0YXVyYW50ZXMgZGVsIENlbnRybyIvPgogIDxjZmRpOlJlY2VwdG9yIFJmYz0iRENLMTUwNjAxWFkxIiBOb21icmU9IlRSQU5TUE9SVEVTIERFIFBFUlNPTkFMIFkgTUVSQ0FOQ0lBIiBVc29DRkRJPSJHMDMiLz4KICA8Y2ZkaTpDb25jZXB0b3M+CiAgICA8Y2ZkaTpDb25jZXB0byBEZXNjcmlwY2lvbj0iQ29taWRhIiBDYW50aWRhZD0iMSIgVmFsb3JVbml0YXJpbz0iMTE2My43OSIvPgogIDwvY2ZkaTpDb25jZXB0b3M+CiAgPGNmZGk6Q29tcGxlbWVudG8+CiAgICA8dGZkOlRpbWJyZUZpc2NhbERpZ2l0YWwgVmVyc2lvbj0iMS4xIiBVVUlEPSJTMjE0QTdDMS00QjJFLTRGMUEtOUQzQy0xMDAxMTFBQkNERUYiLz4KICA8L2NmZGk6Q29tcGxlbWVudG8+CjwvY2ZkaTpDb21wcm9iYW50ZT4=')),
  ('fv_s21_4p', 'application/pdf', FROM_BASE64('JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNSAwIFIgPj4gPj4gPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCAyMzEgPj4Kc3RyZWFtCkJUIC9GMSAxMiBUZiA2MCA3NDAgVGQgKENvbXByb2JhbnRlIGRlIENvbWlkYSkgVGogRVQKQlQgL0YxIDEyIFRmIDYwIDcyMCBUZCAoRW1pc29yOiBSZXN0YXVyYW50ZXMgZGVsIENlbnRybykgVGogRVQKQlQgL0YxIDEyIFRmIDYwIDcwMCBUZCAoRm9saW86ICMwMDY1ICBJbXBvcnRlOiAkMTM1MC4wMCBNWE4pIFRqIEVUCkJUIC9GMSAxMiBUZiA2MCA2ODAgVGQgKEZlY2hhOiAxNC8xMC8yMDI2KSBUaiBFVAplbmRzdHJlYW0KZW5kb2JqCjUgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+CmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCjAwMDAwMDAyNDEgMDAwMDAgbiAKMDAwMDAwMDUyMyAwMDAwMCBuIAp0cmFpbGVyCjw8IC9TaXplIDYgL1Jvb3QgMSAwIFIgPj4Kc3RhcnR4cmVmCjU5MwolJUVPRg==')),
  ('fv_s21_5', 'application/pdf', FROM_BASE64('JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNSAwIFIgPj4gPj4gPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCAyMTcgPj4Kc3RyZWFtCkJUIC9GMSAxMiBUZiA2MCA3NDAgVGQgKENvbXByb2JhbnRlIGRlIFZhbGVzKSBUaiBFVApCVCAvRjEgMTIgVGYgNjAgNzIwIFRkIChFbWlzb3I6IEltcHJldmlzdG9zKSBUaiBFVApCVCAvRjEgMTIgVGYgNjAgNzAwIFRkIChGb2xpbzogIzAwNjUgIEltcG9ydGU6ICQxNTAuMDAgTVhOKSBUaiBFVApCVCAvRjEgMTIgVGYgNjAgNjgwIFRkIChGZWNoYTogMTQvMTAvMjAyNikgVGogRVQKZW5kc3RyZWFtCmVuZG9iago1IDAgb2JqCjw8IC9UeXBlIC9Gb250IC9TdWJ0eXBlIC9UeXBlMSAvQmFzZUZvbnQgL0hlbHZldGljYSA+PgplbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAowMDAwMDAwMjQxIDAwMDAwIG4gCjAwMDAwMDA1MDkgMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSA2IC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgo1NzkKJSVFT0Y='));

-- convenios con hoteles
INSERT INTO convenios (id, anio, tipo_sucursal, no_sucursal, destino, estado, nombre_comercial, costo_sencilla, costo_doble, no_proveedor, razon_social, telefono, contacto, banco, correo, notas, activo, baja_motivo, baja_fecha, creado_at, actualizado_at) VALUES
  ('cv1', 2025, 'Center', 'Suc031', 'Mérida', 'Yucatán', 'Hotel Gran Centenario', 650, NULL, '402884', 'Grupo Cosumaver S.A. de C.V.', '9999235478', 'Itzel Rodriguez', '', '', '', 1, NULL, NULL, '2025-01-15 10:00:00.000', '2025-01-15 10:00:00.000'),
  ('cv2', 2025, 'Center', 'Suc031', 'Mérida', 'Yucatán', 'Hotel Casa Palomino', 695, 895, '403124', 'Leonardo Palomino Perez', '999 920 0781', 'Leonardo Perez / Gabriela', 'Santander', '', '', 1, NULL, NULL, '2025-01-15 10:00:00.000', '2025-01-15 10:00:00.000'),
  ('cv3', 2025, 'Center', 'Suc032', 'Tapachula', 'Chiapas', 'Hotel Tapachula', 737.5, NULL, '402904', 'Administradora Turistica Cecares, S.A. de C.V.', '962 62 66060 al 64', 'Angeles Castillo', '', '', '855.5 con desayuno incluido', 1, NULL, NULL, '2025-01-15 10:00:00.000', '2025-01-15 10:00:00.000'),
  ('cv4', 2025, 'Center', 'Suc032', 'Tapachula', 'Chiapas', 'Hotel One Tapachula', 1350, 1350, '403957', 'Corporacion Hotelera Izapa, SA de CV', '', '', '', '', 'Convenio CUS070880', 1, NULL, NULL, '2025-01-15 10:00:00.000', '2025-01-15 10:00:00.000'),
  ('cv5', 2025, 'Center', 'Suc032', 'Tapachula', 'Chiapas', 'Hotel City Express by Marriott', 708, NULL, '402999', 'Servicios Centrales de Cobranza Hotelera S.A. de C.V.', '9621175260', 'Mayra Salgado / Melisa Vargas', '', '', 'Referencia: DCETAP5', 1, NULL, NULL, '2025-01-15 10:00:00.000', '2025-01-15 10:00:00.000'),
  ('cv6', 2025, 'Center', 'Suc033', 'Monterrey', 'Nuevo León', 'Hotel SAFI', 1428, 1606.5, '402985', 'Desarrollo Optima, S.A. de C.V.', '81 8399 7000', 'Beatriz Pizarro', '', '', 'De lunes a viernes 1200 + impuestos y fin de semana 1150 más impuestos', 1, NULL, NULL, '2025-01-15 10:00:00.000', '2025-01-15 10:00:00.000'),
  ('cv7', 2025, 'Center', 'Suc033', 'Monterrey', 'Nuevo León', 'Hotel iSTAY Centro', 1184.05, NULL, '403501', 'Operadora de Hoteles Istay Monterrey Centro S. de R.L. de C.V.', '81 8228 6000', 'Jesica Castillo / Angel / Daniela Gamboa', '', '', '', 1, NULL, NULL, '2025-01-15 10:00:00.000', '2025-01-15 10:00:00.000'),
  ('cv8', 2025, 'Center', 'Suc034', 'Mex Iztapalapa', 'CDMX', 'Hotel Atenas Plaza', 650, 850, '400017', 'Hotel Atenas Plaza, S.A. de C.V.', '55 56 70 18 05', 'Recepción Jorge / Erika', '', '', 'Hablar directo al hotel para que sea válida la tarifa convenio 2025', 1, NULL, NULL, '2025-01-15 10:00:00.000', '2025-01-15 10:00:00.000'),
  ('cv9', 2025, 'Center', 'Suc035', 'Villahermosa', 'Tabasco', 'Hotel City Express Jr By Marriott', 743.4, NULL, '402999', 'Servicios Centrales de Cobranza Hotelera S.A. de C.V.', '993 310 4351', 'Erika Valenzuela', '', '', 'Convenio CIE: Referencia DCJVSA8', 1, NULL, NULL, '2025-01-15 10:00:00.000', '2025-01-15 10:00:00.000'),
  ('cv10', 2025, 'Center', 'Suc035', 'Villahermosa', 'Tabasco', 'Hotel Maya Tabasco', 770, NULL, '403226', 'Concesionaria Turistica Villatab S. A. de C.V.', '993 358 1111', 'Jaqueline Zacarias', '', '', '', 1, NULL, NULL, '2025-01-15 10:00:00.000', '2025-01-15 10:00:00.000'),
  ('cv11', 2025, 'Center', 'Suc035', 'Villahermosa', 'Tabasco', 'Tabasco Inn', 735, NULL, '402938', 'Tabasco Inn S.A. de C.V.', '312 26 80', 'Julio Prado', '', '', '', 0, 'Hotel cerrado temporalmente por remodelación.', '2025-09-30 12:00:00.000', '2025-01-15 10:00:00.000', '2025-09-30 12:00:00.000'),
  ('cv12', 2025, 'Center', 'Suc036', 'Torreón', 'Coahuila', 'Hotel Nuve', 850, 850, '402919', 'Grupo Nuve Hoteles, S.A. de C.V.', '871 717 4595', 'Abraham / Pamela / Mariana', '', 'nuvehoteltorreon@gmail.com', '', 1, NULL, NULL, '2025-01-15 10:00:00.000', '2025-01-15 10:00:00.000'),
  ('cv13', 2025, 'Center', 'Suc036', 'Torreón', 'Coahuila', 'Savoy Express', 815, 995, '403079', 'Savoy Express S.A. de C.V.', '871 711 3030', 'Gabriela Rios / Hector Hernandez', 'Banamex', '', '', 1, NULL, NULL, '2025-01-15 10:00:00.000', '2025-01-15 10:00:00.000'),
  ('cv14', 2025, 'Center', 'Suc037', 'Saltillo', 'Coahuila', 'Hotel Colonial San Miguel', 950, NULL, '402970', 'Carmen Del Rosario Herrera Ruiz', '844 410 3044', 'Gerardo / Elisa / Griselda / Claudia', '', '', 'Mejoraron tarifa en el mes de enero: 760 por noche', 1, NULL, NULL, '2025-01-15 10:00:00.000', '2025-01-15 10:00:00.000'),
  ('cv101', 2026, 'Center', 'Suc031', 'Mérida', 'Yucatán', 'Hotel Gran Centenario', 650, NULL, '402884', 'Grupo Cosumaver S.A. de C.V.', '9999235478', 'Itzel Rodriguez', '', '', '', 1, NULL, NULL, '2026-01-12 10:00:00.000', '2026-01-12 10:00:00.000'),
  ('cv102', 2026, 'Center', 'Suc031', 'Mérida', 'Yucatán', 'Hotel Casa Palomino', 720, 920, '403124', 'Leonardo Palomino Perez', '999 920 0781', 'Leonardo Perez / Gabriela', 'Santander', '', '', 1, NULL, NULL, '2026-01-12 10:00:00.000', '2026-01-12 10:00:00.000'),
  ('cv103', 2026, 'Center', 'Suc032', 'Tapachula', 'Chiapas', 'Hotel Tapachula', 737.5, NULL, '402904', 'Administradora Turistica Cecares, S.A. de C.V.', '962 62 66060 al 64', 'Angeles Castillo', '', '', '855.5 con desayuno incluido', 1, NULL, NULL, '2026-01-12 10:00:00.000', '2026-01-12 10:00:00.000'),
  ('cv104', 2026, 'Center', 'Suc032', 'Tapachula', 'Chiapas', 'Hotel One Tapachula', 1350, 1350, '403957', 'Corporacion Hotelera Izapa, SA de CV', '', '', '', '', 'Convenio CUS070880', 1, NULL, NULL, '2026-01-12 10:00:00.000', '2026-01-12 10:00:00.000'),
  ('cv105', 2026, 'Center', 'Suc032', 'Tapachula', 'Chiapas', 'Hotel City Express by Marriott', 708, NULL, '402999', 'Servicios Centrales de Cobranza Hotelera S.A. de C.V.', '9621175260', 'Mayra Salgado / Melisa Vargas', '', '', 'Referencia: DCETAP5', 1, NULL, NULL, '2026-01-12 10:00:00.000', '2026-01-12 10:00:00.000'),
  ('cv106', 2026, 'Center', 'Suc033', 'Monterrey', 'Nuevo León', 'Hotel SAFI', 1480, 1650, '402985', 'Desarrollo Optima, S.A. de C.V.', '81 8399 7000', 'Beatriz Pizarro', '', '', 'De lunes a viernes 1200 + impuestos y fin de semana 1150 más impuestos', 1, NULL, NULL, '2026-01-12 10:00:00.000', '2026-01-12 10:00:00.000'),
  ('cv107', 2026, 'Center', 'Suc033', 'Monterrey', 'Nuevo León', 'Hotel iSTAY Centro', 1184.05, NULL, '403501', 'Operadora de Hoteles Istay Monterrey Centro S. de R.L. de C.V.', '81 8228 6000', 'Jesica Castillo / Angel / Daniela Gamboa', '', '', '', 1, NULL, NULL, '2026-01-12 10:00:00.000', '2026-01-12 10:00:00.000'),
  ('cv108', 2026, 'Center', 'Suc034', 'Mex Iztapalapa', 'CDMX', 'Hotel Atenas Plaza', 650, 850, '400017', 'Hotel Atenas Plaza, S.A. de C.V.', '55 56 70 18 05', 'Recepción Jorge / Erika', '', '', 'Hablar directo al hotel para que sea válida la tarifa convenio 2025', 1, NULL, NULL, '2026-01-12 10:00:00.000', '2026-01-12 10:00:00.000'),
  ('cv109', 2026, 'Center', 'Suc035', 'Villahermosa', 'Tabasco', 'Hotel City Express Jr By Marriott', 770, NULL, '402999', 'Servicios Centrales de Cobranza Hotelera S.A. de C.V.', '993 310 4351', 'Erika Valenzuela', '', '', 'Convenio CIE: Referencia DCJVSA8', 1, NULL, NULL, '2026-01-12 10:00:00.000', '2026-01-12 10:00:00.000'),
  ('cv110', 2026, 'Center', 'Suc035', 'Villahermosa', 'Tabasco', 'Hotel Maya Tabasco', 770, NULL, '403226', 'Concesionaria Turistica Villatab S. A. de C.V.', '993 358 1111', 'Jaqueline Zacarias', '', '', '', 1, NULL, NULL, '2026-01-12 10:00:00.000', '2026-01-12 10:00:00.000'),
  ('cv112', 2026, 'Center', 'Suc036', 'Torreón', 'Coahuila', 'Hotel Nuve', 850, 850, '402919', 'Grupo Nuve Hoteles, S.A. de C.V.', '871 717 4595', 'Abraham / Pamela / Mariana', '', 'nuvehoteltorreon@gmail.com', '', 1, NULL, NULL, '2026-01-12 10:00:00.000', '2026-01-12 10:00:00.000'),
  ('cv113', 2026, 'Center', 'Suc036', 'Torreón', 'Coahuila', 'Savoy Express', 815, 995, '403079', 'Savoy Express S.A. de C.V.', '871 711 3030', 'Gabriela Rios / Hector Hernandez', 'Banamex', '', '', 1, NULL, NULL, '2026-01-12 10:00:00.000', '2026-01-12 10:00:00.000');

-- revisiones de montos manuales de hotel
INSERT INTO revisiones_monto (id, solicitud_id, folio, user_id, destino_estado, hotel_stay_id, hotel_id, hotel_nombre, tipo_habitacion, tarifa_default, monto_manual, motivo, noches, fecha_inicio, fecha_fin, creada_at, estado, vigente, decidido_por, decidido_at, comentario) VALUES
  ('rev_e3cb8kl2', 's25', '#0070', 'u7', 'Guanajuato', 'hh_s25_1', 13, 'Holiday Inn León', 'sencilla', 880, 1500, NULL, 3, '2026-11-23', '2026-11-26', '2026-11-04 21:09:15.196', 'rechazado', 1, 'u6', '2026-11-03 21:09:15.196', 'Excede la tarifa convenida; reservar en Fiesta Inn León ($790) o Hotel One León Norte ($620).'),
  ('rev_o7d2owr8', 's24', '#0069', 'u3', 'CDMX', 'hh_s24_1', 7, 'Presidente Intercontinental', 'sencilla', 1850, 2400, NULL, 2, '2026-11-02', '2026-11-04', '2026-11-04 21:09:15.196', 'aceptado', 1, 'u6', '2026-11-04 21:09:15.196', 'Evento de la cámara en la ciudad; no hay tarifa corporativa disponible esas fechas.'),
  ('rev_7thbrbzm', 's26', '#0068', 'u2', 'Querétaro', 'hh_s26_1', 19, 'Radisson Querétaro', 'sencilla', 870, 1100, NULL, 2, '2026-11-04', '2026-11-06', '2026-11-04 21:09:15.195', 'pendiente', 1, NULL, NULL, NULL),
  ('rev_3nm72l9i', 's23', '#0067', 'u8', 'Zacatecas', 'hh_s23_1', 26, 'Emporio Zacatecas', 'sencilla', 890, 1250, NULL, 2, '2026-11-16', '2026-11-18', '2026-11-04 21:09:15.195', 'pendiente', 1, NULL, NULL, NULL),
  ('rev_1smfebct', 's22', '#0066', 'u7', 'Nuevo León', 'hh_s22_1', 17, 'Camino Real Monterrey', 'sencilla', 1380, 1700, NULL, 3, '2026-11-09', '2026-11-12', '2026-11-04 21:09:15.176', 'pendiente', 1, NULL, NULL, NULL);

-- correos simulados
INSERT INTO correos (id, fecha, para, usuario_id, asunto, cuerpo, referencia, estado) VALUES
  ('mail_e0t1jstq', '2026-11-04 21:09:15.196', 'compras@cklass.com', 'u6', 'Monto manual de hotel — #0070 (Carlos Mendoza)', 'Carlos Mendoza guardó la solicitud #0070 con un hotel a un monto distinto al predeterminado.

Hotel: Holiday Inn León (Guanajuato) · Habitación sencilla
Fechas: 2026-11-23 al 2026-11-26 (3 noche(s))
Monto predeterminado por noche: $880
Monto manual por noche: $1,500

Diferencia por noche: +$620

Este correo es solo informativo. La revisión (aceptar o rechazar con comentario) se hace en el portal, en la campanita de notificaciones.', 'rev_e3cb8kl2', 'simulado'),
  ('mail_66gwvag1', '2026-11-04 21:09:15.196', 'compras@cklass.com', 'u6', 'Monto manual de hotel — #0069 (María Torres)', 'María Torres guardó la solicitud #0069 con un hotel a un monto distinto al predeterminado.

Hotel: Presidente Intercontinental (CDMX) · Habitación sencilla
Fechas: 2026-11-02 al 2026-11-04 (2 noche(s))
Monto predeterminado por noche: $1,850
Monto manual por noche: $2,400

Diferencia por noche: +$550

Este correo es solo informativo. La revisión (aceptar o rechazar con comentario) se hace en el portal, en la campanita de notificaciones.', 'rev_o7d2owr8', 'simulado'),
  ('mail_0l9z0t4b', '2026-11-04 21:09:15.195', 'compras@cklass.com', 'u6', 'Monto manual de hotel — #0068 (Juan Alvarado)', 'Juan Alvarado guardó la solicitud #0068 con un hotel a un monto distinto al predeterminado.

Hotel: Radisson Querétaro (Querétaro) · Habitación sencilla
Fechas: 2026-11-04 al 2026-11-06 (2 noche(s))
Monto predeterminado por noche: $870
Monto manual por noche: $1,100

Diferencia por noche: +$230

Este correo es solo informativo. La revisión (aceptar o rechazar con comentario) se hace en el portal, en la campanita de notificaciones.', 'rev_7thbrbzm', 'simulado'),
  ('mail_0k2goulj', '2026-11-04 21:09:15.195', 'compras@cklass.com', 'u6', 'Monto manual de hotel — #0067 (Sofía Ramírez)', 'Sofía Ramírez guardó la solicitud #0067 con un hotel a un monto distinto al predeterminado.

Hotel: Emporio Zacatecas (Zacatecas) · Habitación sencilla
Fechas: 2026-11-16 al 2026-11-18 (2 noche(s))
Monto predeterminado por noche: $890
Monto manual por noche: $1,250

Diferencia por noche: +$360

Este correo es solo informativo. La revisión (aceptar o rechazar con comentario) se hace en el portal, en la campanita de notificaciones.', 'rev_3nm72l9i', 'simulado'),
  ('mail_9d9ujrn4', '2026-11-04 21:09:15.176', 'compras@cklass.com', 'u6', 'Monto manual de hotel — #0066 (Carlos Mendoza)', 'Carlos Mendoza guardó la solicitud #0066 con un hotel a un monto distinto al predeterminado.

Hotel: Camino Real Monterrey (Nuevo León) · Habitación sencilla
Fechas: 2026-11-09 al 2026-11-12 (3 noche(s))
Monto predeterminado por noche: $1,380
Monto manual por noche: $1,700

Diferencia por noche: +$320

Este correo es solo informativo. La revisión (aceptar o rechazar con comentario) se hace en el portal, en la campanita de notificaciones.', 'rev_1smfebct', 'simulado');

-- bitácora
INSERT INTO logs (id, fecha, tipo, entidad, entidad_id, usuario_id, detalle) VALUES
  ('log_2ol1xd2k', '2026-11-04 21:09:15.176', 'monto_manual_detectado', 'revision_monto', 'rev_1smfebct', 'u7', '{"folio":"#0066","hotel":"Camino Real Monterrey","tarifa_default":1380,"monto_manual":1700,"noches":3,"destinatarios":["compras@cklass.com"]}'),
  ('log_5oxurpel', '2026-11-04 21:09:15.176', 'correo_enviado_simulado', 'revision_monto', 'rev_1smfebct', 'u7', '{"para":"compras@cklass.com"}'),
  ('log_yp2ctksy', '2026-11-04 21:09:15.195', 'monto_manual_detectado', 'revision_monto', 'rev_3nm72l9i', 'u8', '{"folio":"#0067","hotel":"Emporio Zacatecas","tarifa_default":890,"monto_manual":1250,"noches":2,"destinatarios":["compras@cklass.com"]}'),
  ('log_ufwj68ua', '2026-11-04 21:09:15.195', 'correo_enviado_simulado', 'revision_monto', 'rev_3nm72l9i', 'u8', '{"para":"compras@cklass.com"}'),
  ('log_w79wfiod', '2026-11-04 21:09:15.195', 'monto_manual_detectado', 'revision_monto', 'rev_7thbrbzm', 'u2', '{"folio":"#0068","hotel":"Radisson Querétaro","tarifa_default":870,"monto_manual":1100,"noches":2,"destinatarios":["compras@cklass.com"]}'),
  ('log_poz1hbsa', '2026-11-04 21:09:15.195', 'correo_enviado_simulado', 'revision_monto', 'rev_7thbrbzm', 'u2', '{"para":"compras@cklass.com"}'),
  ('log_g7zyy6xy', '2026-11-04 21:09:15.196', 'monto_manual_detectado', 'revision_monto', 'rev_o7d2owr8', 'u3', '{"folio":"#0069","hotel":"Presidente Intercontinental","tarifa_default":1850,"monto_manual":2400,"noches":2,"destinatarios":["compras@cklass.com"]}'),
  ('log_pf4nv8gf', '2026-11-04 21:09:15.196', 'correo_enviado_simulado', 'revision_monto', 'rev_o7d2owr8', 'u3', '{"para":"compras@cklass.com"}'),
  ('log_9h1npa25', '2026-11-04 21:09:15.196', 'revision_aceptada', 'revision_monto', 'rev_o7d2owr8', 'u6', '{"folio":"#0069","hotel":"Presidente Intercontinental","monto_manual":2400,"comentario":"Evento de la cámara en la ciudad; no hay tarifa corporativa disponible esas fechas."}'),
  ('log_zcasn55y', '2026-11-04 21:09:15.196', 'monto_manual_detectado', 'revision_monto', 'rev_e3cb8kl2', 'u7', '{"folio":"#0070","hotel":"Holiday Inn León","tarifa_default":880,"monto_manual":1500,"noches":3,"destinatarios":["compras@cklass.com"]}'),
  ('log_6e29u9gh', '2026-11-04 21:09:15.196', 'correo_enviado_simulado', 'revision_monto', 'rev_e3cb8kl2', 'u7', '{"para":"compras@cklass.com"}'),
  ('log_iru9xxon', '2026-11-03 21:09:15.196', 'revision_rechazada', 'revision_monto', 'rev_e3cb8kl2', 'u6', '{"folio":"#0070","hotel":"Holiday Inn León","monto_manual":1500,"comentario":"Excede la tarifa convenida; reservar en Fiesta Inn León ($790) o Hotel One León Norte ($620)."}'),
  ('log_bz0mm09v', '2026-11-04 21:09:15.199', 'catalogo_hoteles_sincronizado', 'catalogo', 'hoteles', NULL, '{"creados":12,"actualizados":0,"desactivados":0}');


-- ───────────────────────────── 4. Vistas ─────────────────────────────
-- Renglones de gasto por concepto (Dashboard / Reportes). Las solicitudes rechazadas no cuentan;
-- la gasolina no se comprueba, así que cuenta igual como solicitada y comprobada.
CREATE VIEW v_renglones_gasto AS
  SELECT s.id AS solicitud_id, s.folio, s.user_id, s.empresa, DATE(s.created_at) AS created_at,
         CASE
           WHEN c.concepto = 'Hotel' THEN 'Hotel'
           WHEN c.concepto IN ('Avión','Autobús','Tren','Otro (foráneo)','Transporte foráneo') THEN 'Transporte foráneo'
           WHEN c.concepto IN ('Uber','Taxi','Metro','Combi','Otro (transporte local)','Transporte local') THEN 'Transporte local'
           WHEN c.concepto = 'Comida' THEN 'Comida'
           WHEN c.concepto = 'Caseta' THEN 'Automóvil'
           WHEN c.concepto IN ('Vales','Otros') THEN 'Vales'
         END AS categoria,
         CASE WHEN c.concepto = 'Otros' THEN 'Vales' ELSE c.concepto END AS subconcepto,
         c.monto_solicitado AS solicitado,
         c.monto_comprobado AS comprobado
    FROM solicitudes s
    JOIN comprobantes_gasto c ON c.solicitud_id = s.id
   WHERE s.estatus <> 'Rechazado'
     AND c.monto_solicitado > 0
     AND c.concepto IN ('Hotel','Avión','Autobús','Tren','Otro (foráneo)','Transporte foráneo',
                        'Uber','Taxi','Metro','Combi','Otro (transporte local)','Transporte local',
                        'Comida','Caseta','Vales','Otros')
  UNION ALL
  SELECT s.id, s.folio, s.user_id, s.empresa, DATE(s.created_at),
         'Automóvil', 'Gasolina', SUM(d.gasolina), SUM(d.gasolina)
    FROM solicitudes s
    JOIN solicitud_destinos d ON d.solicitud_id = s.id
   WHERE s.estatus <> 'Rechazado'
   GROUP BY s.id, s.folio, s.user_id, s.empresa, DATE(s.created_at)
  HAVING SUM(d.gasolina) > 0;

-- ───────────────────────────── 5. Procedimientos almacenados ─────────────────────────────
DELIMITER $$

-- Equivale a nextFolio(): folio consecutivo seguro ante concurrencia.
CREATE PROCEDURE sp_siguiente_folio(OUT p_folio VARCHAR(10))
BEGIN
  UPDATE folio_contador SET ultimo = LAST_INSERT_ID(ultimo + 1) WHERE id = 1;
  SET p_folio = CONCAT('#', LPAD(LAST_INSERT_ID(), 4, '0'));
END$$

-- Equivale a registrarLog().
CREATE PROCEDURE sp_registrar_log(
  IN p_tipo VARCHAR(80), IN p_entidad VARCHAR(60), IN p_entidad_id VARCHAR(80),
  IN p_usuario_id VARCHAR(40), IN p_detalle JSON)
BEGIN
  INSERT INTO logs (id, fecha, tipo, entidad, entidad_id, usuario_id, detalle)
  VALUES (CONCAT('log_', SUBSTRING(REPLACE(UUID(), '-', ''), 1, 12)), NOW(3), p_tipo, p_entidad,
          p_entidad_id, p_usuario_id, COALESCE(p_detalle, JSON_OBJECT()));
END$$

-- Autoriza o rechaza el paso que le corresponda al usuario (jefe o finanzas).
-- p_decision: 'autorizado' | 'rechazado'. Reglas de estatus.tsx:
--   · nadie autoriza ni rechaza su propia solicitud;
--   · paso jefe: permiso autorizar_lte5000 y jefe_status = Pendiente (sin importar el monto);
--   · paso finanzas: permiso autorizar_gt5000, monto > umbral_finanzas, jefe ya autorizó;
--   · la solicitud pasa a Cerrado al completar los pasos requeridos; el rechazo exige nota.
CREATE PROCEDURE sp_autorizar_solicitud(
  IN p_solicitud_id VARCHAR(40), IN p_user_id VARCHAR(40),
  IN p_decision VARCHAR(12), IN p_nota TEXT)
BEGIN
  DECLARE v_existe INT DEFAULT 0;
  DECLARE v_owner VARCHAR(40);
  DECLARE v_estatus VARCHAR(12);
  DECLARE v_jefe VARCHAR(12);
  DECLARE v_fin VARCHAR(12);
  DECLARE v_monto DECIMAL(12,2);
  DECLARE v_folio VARCHAR(10);
  DECLARE v_lte TINYINT(1) DEFAULT 0;
  DECLARE v_gt TINYINT(1) DEFAULT 0;
  DECLARE v_umbral DECIMAL(12,2) DEFAULT 5000;
  DECLARE v_bloquear TINYINT(1) DEFAULT 0;
  DECLARE v_paso VARCHAR(20) DEFAULT NULL;

  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  IF p_decision NOT IN ('autorizado', 'rechazado') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La decisión debe ser "autorizado" o "rechazado".';
  END IF;

  START TRANSACTION;

  SELECT COUNT(*) INTO v_existe FROM solicitudes WHERE id = p_solicitud_id;
  IF v_existe = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La solicitud no existe.';
  END IF;

  SELECT user_id, estatus, jefe_status, finanzas_status, monto_total, folio
    INTO v_owner, v_estatus, v_jefe, v_fin, v_monto, v_folio
    FROM solicitudes WHERE id = p_solicitud_id FOR UPDATE;

  SELECT COALESCE(JSON_UNQUOTE(JSON_EXTRACT(r.permisos, '$.autorizar_lte5000')) = 'true', 0),
         COALESCE(JSON_UNQUOTE(JSON_EXTRACT(r.permisos, '$.autorizar_gt5000')) = 'true', 0)
    INTO v_lte, v_gt
    FROM usuarios u JOIN roles r ON r.id = u.rol_id
   WHERE u.id = p_user_id AND u.activo = 1;

  SELECT COALESCE(CAST(JSON_UNQUOTE(valor) AS DECIMAL(12,2)), 5000) INTO v_umbral
    FROM configuracion WHERE clave = 'umbral_finanzas';

  IF v_estatus <> 'Abierto' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La solicitud ya no está abierta.';
  END IF;
  IF v_owner = p_user_id THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Nadie puede autorizar ni rechazar su propia solicitud.';
  END IF;

  IF v_lte = 1 AND v_jefe = 'Pendiente' THEN
    SET v_paso = 'jefe';
  ELSEIF v_gt = 1 AND v_monto > v_umbral AND v_jefe = 'Autorizado' AND v_fin = 'Pendiente' THEN
    SET v_paso = 'finanzas';
  END IF;
  IF v_paso IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'No tienes un paso de autorización pendiente en esta solicitud.';
  END IF;

  IF p_decision = 'rechazado' AND (p_nota IS NULL OR TRIM(p_nota) = '') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Captura el motivo del rechazo.';
  END IF;

  -- Bloqueo por monto manual de hotel (parámetro bloquear_folio_monto_hotel).
  IF p_decision = 'autorizado' THEN
    SELECT COALESCE(JSON_UNQUOTE(valor) = 'true', 0) INTO v_bloquear
      FROM configuracion WHERE clave = 'bloquear_folio_monto_hotel';
    IF v_bloquear = 1 AND EXISTS (SELECT 1 FROM revisiones_monto
                                   WHERE solicitud_id = p_solicitud_id AND vigente = 1
                                     AND estado IN ('pendiente', 'rechazado')) THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Bloqueado: el monto manual de hotel está pendiente o rechazado por Compras.';
    END IF;
  END IF;

  INSERT INTO autorizaciones (id, solicitud_id, rol_autorizador, user_id, status, fecha, nota)
  VALUES (CONCAT('a_', SUBSTRING(REPLACE(UUID(), '-', ''), 1, 10)), p_solicitud_id,
          IF(v_paso = 'jefe', 'jefe_inmediato', 'finanzas'), p_user_id, p_decision, CURDATE(),
          COALESCE(IF(p_decision = 'rechazado', p_nota, ''), ''));

  IF p_decision = 'rechazado' THEN
    UPDATE solicitudes
       SET estatus = 'Rechazado', nota_rechazo = p_nota,
           jefe_status = IF(v_paso = 'jefe', 'Rechazado', jefe_status),
           finanzas_status = IF(v_paso = 'finanzas', 'Rechazado', finanzas_status)
     WHERE id = p_solicitud_id;
  ELSEIF v_paso = 'jefe' THEN
    UPDATE solicitudes
       SET jefe_status = 'Autorizado',
           estatus = IF(finanzas_status = 'N/A', 'Cerrado', estatus)
     WHERE id = p_solicitud_id;
  ELSE
    UPDATE solicitudes SET finanzas_status = 'Autorizado', estatus = 'Cerrado' WHERE id = p_solicitud_id;
  END IF;

  COMMIT;
  SELECT * FROM solicitudes WHERE id = p_solicitud_id;
END$$

-- Herramienta de corrección del administrador: borra autorizaciones y regresa a Abierto/Pendiente.
CREATE PROCEDURE sp_revertir_autorizaciones(IN p_solicitud_id VARCHAR(40), IN p_admin_id VARCHAR(40))
BEGIN
  DECLARE v_es_admin INT DEFAULT 0;
  DECLARE v_folio VARCHAR(10);

  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  SELECT COUNT(*) INTO v_es_admin
    FROM usuarios u JOIN roles r ON r.id = u.rol_id
   WHERE u.id = p_admin_id AND u.activo = 1 AND r.nombre = 'administrador';
  IF v_es_admin = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Solo un administrador puede revertir autorizaciones.';
  END IF;

  SELECT folio INTO v_folio FROM solicitudes WHERE id = p_solicitud_id;
  IF v_folio IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La solicitud no existe.';
  END IF;

  START TRANSACTION;
  DELETE FROM autorizaciones WHERE solicitud_id = p_solicitud_id;
  UPDATE solicitudes
     SET estatus = 'Abierto', jefe_status = 'Pendiente',
         finanzas_status = IF(finanzas_status = 'N/A', 'N/A', 'Pendiente'), nota_rechazo = NULL
   WHERE id = p_solicitud_id;
  CALL sp_registrar_log('autorizaciones_revertidas', 'solicitud', p_solicitud_id, p_admin_id,
                        JSON_OBJECT('folio', v_folio));
  COMMIT;
END$$

-- Equivale a avanceComprobacion(): p_solo_avion = 1 limita el cálculo al concepto "Avión" (gestor de vuelos).
CREATE PROCEDURE sp_recalcular_comprobacion(IN p_solicitud_id VARCHAR(40), IN p_solo_avion TINYINT(1))
BEGIN
  SELECT p_solicitud_id AS solicitud_id,
         COALESCE(SUM(monto_solicitado), 0) AS solicitado,
         COALESCE(SUM(monto_comprobado), 0) AS comprobado,
         (COALESCE(SUM(monto_solicitado), 0) > 0
            AND COALESCE(SUM(monto_comprobado), 0) = COALESCE(SUM(monto_solicitado), 0)) AS completo,
         CASE WHEN COALESCE(SUM(monto_solicitado), 0) > 0
              THEN LEAST(100, ROUND(SUM(monto_comprobado) / SUM(monto_solicitado) * 100))
              ELSE 0 END AS pct
    FROM comprobantes_gasto
   WHERE solicitud_id = p_solicitud_id
     AND (p_solo_avion = 0 OR concepto = 'Avión');
END$$

-- Folios Cerrado del usuario sin comprobar por completo. Si hay 2 o más (MAX_FOLIOS_SIN_COMPROBAR)
-- no puede generar una nueva solicitud: bloquea_nueva_solicitud = 1.
CREATE PROCEDURE sp_folios_sin_comprobar(IN p_user_id VARCHAR(40))
BEGIN
  SELECT t.id, t.folio, t.monto_total, t.solicitado, t.comprobado,
         (COUNT(*) OVER () >= 2) AS bloquea_nueva_solicitud
    FROM (
      SELECT s.id, s.folio, s.monto_total,
             COALESCE(SUM(c.monto_solicitado), 0) AS solicitado,
             COALESCE(SUM(c.monto_comprobado), 0) AS comprobado
        FROM solicitudes s
        LEFT JOIN comprobantes_gasto c ON c.solicitud_id = s.id
       WHERE s.user_id = p_user_id AND s.estatus = 'Cerrado'
       GROUP BY s.id, s.folio, s.monto_total
    ) t
   WHERE NOT (t.solicitado > 0 AND t.comprobado = t.solicitado)
   ORDER BY t.folio;
END$$

-- Equivale a sincronizarCatalogoConvenios(): el convenio ACTIVO del año p_anio (por omisión el actual)
-- fija nombre, ciudad, estado y tarifas del hotel; si un hotel con convenio ya no tiene convenio activo
-- vigente, se desactiva (deja de ofrecerse en Solicitar). Los hoteles sin convenio no se tocan.
CREATE PROCEDURE sp_sincronizar_catalogo_convenios(IN p_usuario_id VARCHAR(40), IN p_anio SMALLINT)
BEGIN
  DECLARE v_anio SMALLINT DEFAULT COALESCE(p_anio, YEAR(CURDATE()));
  DECLARE v_creados INT DEFAULT 0;
  DECLARE v_actualizados INT DEFAULT 0;
  DECLARE v_desactivados INT DEFAULT 0;

  DROP TEMPORARY TABLE IF EXISTS tmp_convenio_vigente;
  CREATE TEMPORARY TABLE tmp_convenio_vigente AS
    SELECT x.* FROM (
      SELECT c.*, ROW_NUMBER() OVER (PARTITION BY c.nombre_comercial, c.destino
                                     ORDER BY c.actualizado_at DESC, c.id DESC) AS rn
        FROM convenios c
       WHERE c.activo = 1 AND c.anio = v_anio AND c.estado <> ''
    ) x WHERE x.rn = 1;

  UPDATE hoteles h
    JOIN tmp_convenio_vigente v ON h.nombre = v.nombre_comercial AND h.ciudad = v.destino
     SET h.nombre = v.nombre_comercial, h.ciudad = v.destino, h.estado = v.estado,
         h.tarifa_base = v.costo_sencilla,
         h.tarifa_doble = IF(v.costo_doble IS NOT NULL AND v.costo_doble > 0, v.costo_doble, NULL),
         h.activo = 1,
         h.convenio_clave = CONCAT(LOWER(TRIM(v.nombre_comercial)), '|', LOWER(TRIM(v.destino)));
  SET v_actualizados = ROW_COUNT();

  INSERT INTO hoteles (nombre, ciudad, estado, tarifa_base, tarifa_doble, activo, convenio_clave)
  SELECT v.nombre_comercial, v.destino, v.estado, v.costo_sencilla,
         IF(v.costo_doble IS NOT NULL AND v.costo_doble > 0, v.costo_doble, NULL), 1,
         CONCAT(LOWER(TRIM(v.nombre_comercial)), '|', LOWER(TRIM(v.destino)))
    FROM tmp_convenio_vigente v
   WHERE NOT EXISTS (SELECT 1 FROM hoteles h WHERE h.nombre = v.nombre_comercial AND h.ciudad = v.destino);
  SET v_creados = ROW_COUNT();

  UPDATE hoteles h
     SET h.activo = 0
   WHERE h.activo = 1
     AND EXISTS (SELECT 1 FROM convenios c
                  WHERE c.estado <> '' AND c.nombre_comercial = h.nombre AND c.destino = h.ciudad)
     AND NOT EXISTS (SELECT 1 FROM tmp_convenio_vigente v
                      WHERE v.nombre_comercial = h.nombre AND v.destino = h.ciudad);
  SET v_desactivados = ROW_COUNT();

  DROP TEMPORARY TABLE IF EXISTS tmp_convenio_vigente;

  IF v_creados + v_actualizados + v_desactivados > 0 THEN
    CALL sp_registrar_log('catalogo_hoteles_sincronizado', 'catalogo', 'hoteles', p_usuario_id,
      JSON_OBJECT('creados', v_creados, 'actualizados', v_actualizados, 'desactivados', v_desactivados));
  END IF;
  SELECT v_creados AS creados, v_actualizados AS actualizados, v_desactivados AS desactivados;
END$$

-- Baja lógica de un convenio (con motivo) y sincronización del catálogo.
CREATE PROCEDURE sp_dar_baja_convenio(
  IN p_convenio_id VARCHAR(40), IN p_motivo VARCHAR(500), IN p_usuario_id VARCHAR(40))
BEGIN
  IF p_motivo IS NULL OR TRIM(p_motivo) = '' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Captura el motivo de la baja.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM convenios WHERE id = p_convenio_id AND activo = 1) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El convenio no existe o ya está dado de baja.';
  END IF;
  SET @ckl_usuario_id = p_usuario_id;
  UPDATE convenios SET activo = 0, baja_motivo = TRIM(p_motivo), baja_fecha = NOW(3)
   WHERE id = p_convenio_id;
  SET @ckl_usuario_id = NULL;
  CALL sp_sincronizar_catalogo_convenios(p_usuario_id, NULL);
END$$

-- Reactiva un convenio dado de baja y sincroniza el catálogo.
CREATE PROCEDURE sp_reactivar_convenio(IN p_convenio_id VARCHAR(40), IN p_usuario_id VARCHAR(40))
BEGIN
  IF NOT EXISTS (SELECT 1 FROM convenios WHERE id = p_convenio_id AND activo = 0) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El convenio no existe o ya está activo.';
  END IF;
  SET @ckl_usuario_id = p_usuario_id;
  UPDATE convenios SET activo = 1, baja_motivo = NULL, baja_fecha = NULL WHERE id = p_convenio_id;
  SET @ckl_usuario_id = NULL;
  CALL sp_sincronizar_catalogo_convenios(p_usuario_id, NULL);
END$$

-- Reporte "Gasto por concepto". p_base = 'solicitado' | 'comprobado'. Filtros opcionales (NULL = todos).
CREATE PROCEDURE sp_gasto_por_concepto(
  IN p_desde DATE, IN p_hasta DATE, IN p_empresa VARCHAR(120),
  IN p_user_id VARCHAR(40), IN p_base VARCHAR(12))
BEGIN
  SELECT categoria, subconcepto,
         SUM(solicitado) AS solicitado,
         SUM(comprobado) AS comprobado,
         SUM(IF(p_base = 'comprobado', comprobado, solicitado)) AS monto
    FROM v_renglones_gasto
   WHERE categoria IS NOT NULL
     AND (p_desde IS NULL OR created_at >= p_desde)
     AND (p_hasta IS NULL OR created_at <= p_hasta)
     AND (p_empresa IS NULL OR empresa = p_empresa)
     AND (p_user_id IS NULL OR user_id = p_user_id)
   GROUP BY categoria, subconcepto
   ORDER BY monto DESC, categoria, subconcepto;
END$$

-- ───────────────────────────── 6. Triggers ─────────────────────────────

-- Usuarios: nadie es su propio jefe.
CREATE TRIGGER trg_usuarios_bi BEFORE INSERT ON usuarios FOR EACH ROW
BEGIN
  IF NEW.jefe_id IS NOT NULL AND NEW.jefe_id = NEW.id THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Un usuario no puede ser su propio jefe.';
  END IF;
END$$

CREATE TRIGGER trg_usuarios_bu BEFORE UPDATE ON usuarios FOR EACH ROW
BEGIN
  IF NEW.jefe_id IS NOT NULL AND NEW.jefe_id = NEW.id THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Un usuario no puede ser su propio jefe.';
  END IF;
END$$

-- Solicitudes: bitácora y reglas de edición/borrado.
CREATE TRIGGER trg_solicitudes_ai AFTER INSERT ON solicitudes FOR EACH ROW
BEGIN
  CALL sp_registrar_log('solicitud_creada', 'solicitud', NEW.id, NEW.user_id,
    JSON_OBJECT('folio', NEW.folio, 'monto_total', NEW.monto_total, 'estatus', NEW.estatus));
END$$

CREATE TRIGGER trg_solicitudes_bu BEFORE UPDATE ON solicitudes FOR EACH ROW
BEGIN
  -- Con autorizaciones registradas ya no se puede cambiar el monto (edición solo si no hay ninguna).
  IF NEW.monto_total <> OLD.monto_total
     AND EXISTS (SELECT 1 FROM autorizaciones WHERE solicitud_id = OLD.id) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'No se puede modificar el monto: la solicitud ya tiene autorizaciones.';
  END IF;
END$$

CREATE TRIGGER trg_solicitudes_au AFTER UPDATE ON solicitudes FOR EACH ROW
BEGIN
  IF NOT (NEW.estatus <=> OLD.estatus AND NEW.jefe_status <=> OLD.jefe_status
          AND NEW.finanzas_status <=> OLD.finanzas_status) THEN
    CALL sp_registrar_log('solicitud_estatus', 'solicitud', NEW.id, @ckl_usuario_id,
      JSON_OBJECT('folio', NEW.folio,
                  'estatus_anterior', OLD.estatus, 'estatus_nuevo', NEW.estatus,
                  'jefe_status', NEW.jefe_status, 'finanzas_status', NEW.finanzas_status));
  END IF;
END$$

CREATE TRIGGER trg_solicitudes_bd BEFORE DELETE ON solicitudes FOR EACH ROW
BEGIN
  IF EXISTS (SELECT 1 FROM autorizaciones WHERE solicitud_id = OLD.id) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'No se puede eliminar: la solicitud ya tiene autorizaciones.';
  END IF;
END$$

-- Renglones de comprobación: el estatus se deriva de los montos; si deja de estar comprobado
-- se reinicia la validación de Compras.
CREATE TRIGGER trg_comprobantes_gasto_bi BEFORE INSERT ON comprobantes_gasto FOR EACH ROW
BEGIN
  IF NEW.status_renglon <> 'no_aplica' THEN
    SET NEW.status_renglon = CASE
      WHEN NEW.monto_comprobado <= 0 THEN 'pendiente'
      WHEN NEW.monto_comprobado >= NEW.monto_solicitado THEN 'comprobado'
      ELSE 'parcialmente_comprobado' END;
  END IF;
  IF NEW.status_renglon <> 'comprobado' OR NEW.monto_solicitado <= 0 THEN
    SET NEW.validado = 0, NEW.validado_por = NULL, NEW.validado_fecha = NULL;
  END IF;
END$$

CREATE TRIGGER trg_comprobantes_gasto_bu BEFORE UPDATE ON comprobantes_gasto FOR EACH ROW
BEGIN
  IF NEW.monto_comprobado < 0 THEN
    SET NEW.monto_comprobado = 0;
  END IF;
  IF NEW.status_renglon <> 'no_aplica' THEN
    SET NEW.status_renglon = CASE
      WHEN NEW.monto_comprobado <= 0 THEN 'pendiente'
      WHEN NEW.monto_comprobado >= NEW.monto_solicitado THEN 'comprobado'
      ELSE 'parcialmente_comprobado' END;
  END IF;
  IF NEW.status_renglon <> 'comprobado' OR NEW.monto_solicitado <= 0 THEN
    SET NEW.validado = 0, NEW.validado_por = NULL, NEW.validado_fecha = NULL;
  END IF;
END$$

-- Facturas: aplicar / revertir exactamente monto_aplicado en el renglón de comprobación.
CREATE TRIGGER trg_facturas_ai AFTER INSERT ON facturas FOR EACH ROW
BEGIN
  IF NEW.concepto_id IS NOT NULL AND NEW.monto_aplicado <> 0 THEN
    UPDATE comprobantes_gasto
       SET monto_comprobado = monto_comprobado + NEW.monto_aplicado
     WHERE id = NEW.concepto_id;
  END IF;
END$$

CREATE TRIGGER trg_facturas_ad AFTER DELETE ON facturas FOR EACH ROW
BEGIN
  IF OLD.concepto_id IS NOT NULL AND OLD.monto_aplicado <> 0 THEN
    UPDATE comprobantes_gasto
       SET monto_comprobado = GREATEST(0, monto_comprobado - OLD.monto_aplicado)
     WHERE id = OLD.concepto_id;
  END IF;
END$$

-- Convenios: validaciones, sello de actualización y bitácora.
CREATE TRIGGER trg_convenios_bi BEFORE INSERT ON convenios FOR EACH ROW
BEGIN
  IF TRIM(NEW.nombre_comercial) = '' OR TRIM(NEW.destino) = '' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El convenio requiere nombre comercial y destino.';
  END IF;
  IF NEW.costo_sencilla IS NULL OR NEW.costo_sencilla <= 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El costo de habitación sencilla debe ser mayor a 0.';
  END IF;
  SET NEW.creado_at = COALESCE(NEW.creado_at, NOW(3)), NEW.actualizado_at = NOW(3);
END$$

CREATE TRIGGER trg_convenios_bu BEFORE UPDATE ON convenios FOR EACH ROW
BEGIN
  IF TRIM(NEW.nombre_comercial) = '' OR TRIM(NEW.destino) = '' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El convenio requiere nombre comercial y destino.';
  END IF;
  IF NEW.costo_sencilla IS NULL OR NEW.costo_sencilla <= 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El costo de habitación sencilla debe ser mayor a 0.';
  END IF;
  IF OLD.activo = 1 AND NEW.activo = 0 THEN
    IF NEW.baja_motivo IS NULL OR TRIM(NEW.baja_motivo) = '' THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Captura el motivo de la baja.';
    END IF;
    SET NEW.baja_fecha = COALESCE(NEW.baja_fecha, NOW(3));
  END IF;
  IF OLD.activo = 0 AND NEW.activo = 1 THEN
    SET NEW.baja_motivo = NULL, NEW.baja_fecha = NULL;
  END IF;
  SET NEW.actualizado_at = NOW(3);
END$$

CREATE TRIGGER trg_convenios_ai AFTER INSERT ON convenios FOR EACH ROW
BEGIN
  CALL sp_registrar_log('convenio_alta', 'convenio', NEW.id, @ckl_usuario_id,
    JSON_OBJECT('hotel', NEW.nombre_comercial, 'destino', NEW.destino, 'anio', NEW.anio,
                'costo_sencilla', NEW.costo_sencilla, 'costo_doble', NEW.costo_doble));
END$$

CREATE TRIGGER trg_convenios_au AFTER UPDATE ON convenios FOR EACH ROW
BEGIN
  DECLARE v_cambios JSON DEFAULT JSON_OBJECT();
  IF OLD.activo = 1 AND NEW.activo = 0 THEN
    CALL sp_registrar_log('convenio_baja', 'convenio', NEW.id, @ckl_usuario_id,
      JSON_OBJECT('hotel', NEW.nombre_comercial, 'motivo', NEW.baja_motivo));
  ELSEIF OLD.activo = 0 AND NEW.activo = 1 THEN
    CALL sp_registrar_log('convenio_reactivacion', 'convenio', NEW.id, @ckl_usuario_id,
      JSON_OBJECT('hotel', NEW.nombre_comercial));
  ELSE
    IF NOT (OLD.anio <=> NEW.anio) THEN
      SET v_cambios = JSON_MERGE_PATCH(v_cambios, JSON_OBJECT('anio', JSON_OBJECT('antes', OLD.anio, 'despues', NEW.anio)));
    END IF;
    IF NOT (OLD.tipo_sucursal <=> NEW.tipo_sucursal) THEN
      SET v_cambios = JSON_MERGE_PATCH(v_cambios, JSON_OBJECT('tipo_sucursal', JSON_OBJECT('antes', OLD.tipo_sucursal, 'despues', NEW.tipo_sucursal)));
    END IF;
    IF NOT (OLD.no_sucursal <=> NEW.no_sucursal) THEN
      SET v_cambios = JSON_MERGE_PATCH(v_cambios, JSON_OBJECT('no_sucursal', JSON_OBJECT('antes', OLD.no_sucursal, 'despues', NEW.no_sucursal)));
    END IF;
    IF NOT (OLD.destino <=> NEW.destino) THEN
      SET v_cambios = JSON_MERGE_PATCH(v_cambios, JSON_OBJECT('destino', JSON_OBJECT('antes', OLD.destino, 'despues', NEW.destino)));
    END IF;
    IF NOT (OLD.estado <=> NEW.estado) THEN
      SET v_cambios = JSON_MERGE_PATCH(v_cambios, JSON_OBJECT('estado', JSON_OBJECT('antes', OLD.estado, 'despues', NEW.estado)));
    END IF;
    IF NOT (OLD.nombre_comercial <=> NEW.nombre_comercial) THEN
      SET v_cambios = JSON_MERGE_PATCH(v_cambios, JSON_OBJECT('nombre_comercial', JSON_OBJECT('antes', OLD.nombre_comercial, 'despues', NEW.nombre_comercial)));
    END IF;
    IF NOT (OLD.costo_sencilla <=> NEW.costo_sencilla) THEN
      SET v_cambios = JSON_MERGE_PATCH(v_cambios, JSON_OBJECT('costo_sencilla', JSON_OBJECT('antes', OLD.costo_sencilla, 'despues', NEW.costo_sencilla)));
    END IF;
    IF NOT (OLD.costo_doble <=> NEW.costo_doble) THEN
      SET v_cambios = JSON_MERGE_PATCH(v_cambios, JSON_OBJECT('costo_doble', JSON_OBJECT('antes', OLD.costo_doble, 'despues', NEW.costo_doble)));
    END IF;
    IF NOT (OLD.no_proveedor <=> NEW.no_proveedor) THEN
      SET v_cambios = JSON_MERGE_PATCH(v_cambios, JSON_OBJECT('no_proveedor', JSON_OBJECT('antes', OLD.no_proveedor, 'despues', NEW.no_proveedor)));
    END IF;
    IF NOT (OLD.razon_social <=> NEW.razon_social) THEN
      SET v_cambios = JSON_MERGE_PATCH(v_cambios, JSON_OBJECT('razon_social', JSON_OBJECT('antes', OLD.razon_social, 'despues', NEW.razon_social)));
    END IF;
    IF NOT (OLD.telefono <=> NEW.telefono) THEN
      SET v_cambios = JSON_MERGE_PATCH(v_cambios, JSON_OBJECT('telefono', JSON_OBJECT('antes', OLD.telefono, 'despues', NEW.telefono)));
    END IF;
    IF NOT (OLD.contacto <=> NEW.contacto) THEN
      SET v_cambios = JSON_MERGE_PATCH(v_cambios, JSON_OBJECT('contacto', JSON_OBJECT('antes', OLD.contacto, 'despues', NEW.contacto)));
    END IF;
    IF NOT (OLD.banco <=> NEW.banco) THEN
      SET v_cambios = JSON_MERGE_PATCH(v_cambios, JSON_OBJECT('banco', JSON_OBJECT('antes', OLD.banco, 'despues', NEW.banco)));
    END IF;
    IF NOT (OLD.correo <=> NEW.correo) THEN
      SET v_cambios = JSON_MERGE_PATCH(v_cambios, JSON_OBJECT('correo', JSON_OBJECT('antes', OLD.correo, 'despues', NEW.correo)));
    END IF;
    IF NOT (OLD.notas <=> NEW.notas) THEN
      SET v_cambios = JSON_MERGE_PATCH(v_cambios, JSON_OBJECT('notas', JSON_OBJECT('antes', OLD.notas, 'despues', NEW.notas)));
    END IF;
    IF JSON_LENGTH(v_cambios) > 0 THEN
      CALL sp_registrar_log('convenio_modificacion', 'convenio', NEW.id, @ckl_usuario_id,
        JSON_OBJECT('hotel', NEW.nombre_comercial, 'cambios', v_cambios));
    END IF;
  END IF;
END$$

-- Revisiones de monto manual: al decidir se sella quién/cuándo; el rechazo exige comentario.
CREATE TRIGGER trg_revisiones_monto_bu BEFORE UPDATE ON revisiones_monto FOR EACH ROW
BEGIN
  IF OLD.estado = 'pendiente' AND NEW.estado <> 'pendiente' THEN
    IF NEW.estado = 'rechazado' AND (NEW.comentario IS NULL OR TRIM(NEW.comentario) = '') THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Captura el comentario del rechazo.';
    END IF;
    SET NEW.decidido_at = COALESCE(NEW.decidido_at, NOW(3));
  END IF;
END$$

CREATE TRIGGER trg_revisiones_monto_au AFTER UPDATE ON revisiones_monto FOR EACH ROW
BEGIN
  IF OLD.estado = 'pendiente' AND NEW.estado <> 'pendiente' THEN
    CALL sp_registrar_log(IF(NEW.estado = 'aceptado', 'revision_aceptada', 'revision_rechazada'),
      'revision_monto', NEW.id, NEW.decidido_por,
      JSON_OBJECT('folio', NEW.folio, 'hotel', NEW.hotel_nombre, 'monto_manual', NEW.monto_manual,
                  'comentario', NEW.comentario));
  END IF;
END$$

DELIMITER ;

-- ───────────────────────────── 7. Cierre ─────────────────────────────
SET SQL_MODE = @old_sql_mode;
SET FOREIGN_KEY_CHECKS = @old_fk;

SELECT 'portal_viaticos listo' AS resultado,
       (SELECT COUNT(*) FROM information_schema.TABLES   WHERE TABLE_SCHEMA = 'portal_viaticos' AND TABLE_TYPE = 'BASE TABLE') AS tablas,
       (SELECT COUNT(*) FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = 'portal_viaticos') AS procedimientos,
       (SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = 'portal_viaticos') AS triggers,
       (SELECT COUNT(*) FROM usuarios) AS usuarios, (SELECT COUNT(*) FROM solicitudes) AS solicitudes;
