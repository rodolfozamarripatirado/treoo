-- US-A-003 — DDL propuesto, secuencia de migración y seed (propuesta AGT-DATA-001)
-- Estado: propuesto, NO EJECUTADO, NO APROBADO.
-- Esquema objetivo: treoo.
-- Supuestos: base y roles ya existen; el UUID lo provee aplicación/fixture; sin
-- bootstrap, grants, extensiones ni conexión en este artefacto.
-- Fuente revisada: DBA / handoff `data-review-20261116.md` y PO.
-- Autoría/ámbito: servidor resuelve actor y academia desde sesión; FKs refuerzan
-- integridad relacional, no sustituyen autorización.
-- Duración: opcional, finita y > 0 cuando existe. NaN/Infinity deben rechazarse
-- también en runtime con Number.isFinite(x) && x > 0 (o equivalente).
-- Estado del SQL: propuesto y sin ejecutar.

BEGIN;

CREATE TABLE IF NOT EXISTS treoo.academy (
  academy_id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS treoo.teacher (
  teacher_id uuid PRIMARY KEY,
  display_name text NOT NULL CHECK (length(btrim(display_name)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS treoo.academy_teacher (
  academy_id uuid NOT NULL REFERENCES treoo.academy(academy_id) ON DELETE RESTRICT,
  teacher_id uuid NOT NULL REFERENCES treoo.teacher(teacher_id) ON DELETE RESTRICT,
  PRIMARY KEY (academy_id, teacher_id)
);

CREATE TABLE IF NOT EXISTS treoo.lesson (
  academy_id uuid NOT NULL,
  lesson_id uuid NOT NULL,
  teacher_id uuid NOT NULL,
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  theme text,
  level_context text,
  objective text,
  methodology text,
  lesson_text text,
  status text NOT NULL DEFAULT 'draft' CHECK (status = 'draft'),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (academy_id, lesson_id),
  FOREIGN KEY (academy_id, teacher_id)
    REFERENCES treoo.academy_teacher(academy_id, teacher_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS lesson_owner_recent_idx
  ON treoo.lesson (academy_id, teacher_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS treoo.activity (
  academy_id uuid NOT NULL,
  activity_id uuid NOT NULL,
  lesson_id uuid NOT NULL,
  order_index integer NOT NULL CHECK (order_index >= 0),
  kind text,
  title text,
  instruction text,
  duration_minutes double precision,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (academy_id, activity_id),
  FOREIGN KEY (academy_id, lesson_id)
    REFERENCES treoo.lesson(academy_id, lesson_id) ON DELETE CASCADE,
  CONSTRAINT activity_order_unique UNIQUE (academy_id, lesson_id, order_index)
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT activity_duration_finite_positive CHECK (
    duration_minutes IS NULL OR
    (duration_minutes > 0 AND duration_minutes < 'Infinity'::float8)
  )
);

CREATE INDEX IF NOT EXISTS activity_lesson_order_idx
  ON treoo.activity (academy_id, lesson_id, order_index);

COMMIT;

-- Grafico de diseño (resumen, no DL ejecutado)
--
-- Migración separada propuesta:
--   V001__create_academy_tables.sql   (academy, teacher, academy_teacher)
--   V002__create_lesson_tables.sql    (lesson, activity, índices, constraints)
--   V003__create_mutation_dedup.sql    (futuro, ejecutable)
--   V004__repeatable_demo_seed.sql     (futuro, ejecutable)
-- El artefacto real de migración debe vivir en el repositorio como
-- archivo separado y ser revisado por Datos/Arquitectura antes de
-- ejecutarse.

-- =========================================================
-- Seed sintético REPETIBLE
-- Requisito del PO: 2 teachers en 1 academia + 2ª academia,
-- nombres visibles en inglés, seed idempotente con preflight
-- ejecutable y tabla de deduplicación ejecutable.
-- Tenencia del ledger de deduplicación: retenido durante la vida
-- útil de la demo. Sin TTL automático ni purga automática para la
-- demo. Política de producción queda fuera de este corte.
-- =========================================================

-- Preflight ejecutable: abortar la transacción antes de cualquier write
-- si algún identificador del fixture ya existe aquí con valores distintos.
-- El preflight usa los mismos UUID reservados que la inserción normalizada,
-- por lo que el mismo bloque sirve para la semilla diferenciada del FYI-001.
-- Filas idénticas se ignoran; los nombres en distintos UUID no son duplicados
-- porque el nombre no es la identidad.

BEGIN;

DO $preflight$
BEGIN
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('10000000-0000-4000-8000-000000000001'::uuid, 'Academy A — demo'::text),
      ('10000000-0000-4000-8000-000000000002'::uuid, 'Academy B — demo'::text)
    ) AS expected(id, name)
    JOIN treoo.academy actual USING (academy_id)
    WHERE actual.name IS DISTINCT FROM expected.name
  ) THEN RAISE EXCEPTION 'Seed collision: academy id has different exact values'; END IF;

  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('20000000-0000-4000-8000-000000000001'::uuid, 'Ana — demo teacher'::text),
      ('20000000-0000-4000-8000-000000000002'::uuid, 'Alex — demo teacher'::text),
      ('20000000-0000-4000-8000-000000000003'::uuid, 'Bruno — demo teacher'::text)
    ) AS expected(id, display_name)
    JOIN treoo.teacher actual USING (teacher_id)
    WHERE actual.display_name IS DISTINCT FROM expected.display_name
  ) THEN RAISE EXCEPTION 'Seed collision: teacher id has different exact values'; END IF;

  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('10000000-0000-4000-8000-000000000001'::uuid, '20000000-0000-4000-8000-000000000001'::uuid),
      ('10000000-0000-4000-8000-000000000001'::uuid, '20000000-0000-4000-8000-000000000002'::uuid),
      ('10000000-0000-4000-8000-000000000002'::uuid, '20000000-0000-4000-8000-000000000003'::uuid)
    ) AS expected(academy_id, teacher_id)
    JOIN treoo.academy_teacher actual USING (academy_id, teacher_id)
    WHERE actual.academy_id IS DISTINCT FROM expected.academy_id
       OR actual.teacher_id IS DISTINCT FROM expected.teacher_id
  ) THEN RAISE EXCEPTION 'Seed collision: membership differs'; END IF;

  IF EXISTS (
    SELECT 1 FROM treoo.academy_teacher actual
    WHERE actual.teacher_id IN (
      '20000000-0000-4000-8000-000000000001'::uuid,
      '20000000-0000-4000-8000-000000000002'::uuid,
      '20000000-0000-4000-8000-000000000003'::uuid
    ) AND (actual.academy_id, actual.teacher_id) NOT IN (
      ('10000000-0000-4000-8000-000000000001'::uuid, '20000000-0000-4000-8000-000000000001'::uuid),
      ('10000000-0000-4000-8000-000000000001'::uuid, '20000000-0000-4000-8000-000000000002'::uuid),
      ('10000000-0000-4000-8000-000000000002'::uuid, '20000000-0000-4000-8000-000000000003'::uuid)
    )
  ) THEN RAISE EXCEPTION 'Seed collision: fixture teacher has unexpected academy membership'; END IF;
END
$preflight$;

INSERT INTO treoo.academy (academy_id, name)
SELECT v.academy_id, v.name
FROM (VALUES
  ('10000000-0000-4000-8000-000000000001'::uuid, 'Academy A — demo'::text),
  ('10000000-0000-4000-8000-000000000002'::uuid, 'Academy B — demo'::text)
) AS v(academy_id, name)
WHERE NOT EXISTS (SELECT 1 FROM treoo.academy a WHERE a.academy_id = v.academy_id);

INSERT INTO treoo.teacher (teacher_id, display_name)
SELECT v.teacher_id, v.display_name
FROM (VALUES
  ('20000000-0000-4000-8000-000000000001'::uuid, 'Ana — demo teacher'::text),
  ('20000000-0000-4000-8000-000000000002'::uuid, 'Alex — demo teacher'::text),
  ('20000000-0000-4000-8000-000000000003'::uuid, 'Bruno — demo teacher'::text)
) AS v(teacher_id, display_name)
WHERE NOT EXISTS (SELECT 1 FROM treoo.teacher t WHERE t.teacher_id = v.teacher_id);

INSERT INTO treoo.academy_teacher (academy_id, teacher_id)
SELECT v.academy_id, v.teacher_id
FROM (VALUES
  ('10000000-0000-4000-8000-000000000001'::uuid, '20000000-0000-4000-8000-000000000001'::uuid),
  ('10000000-0000-4000-8000-000000000001'::uuid, '20000000-0000-4000-8000-000000000002'::uuid),
  ('10000000-0000-4000-8000-000000000002'::uuid, '20000000-0000-4000-8000-000000000003'::uuid)
) AS v(academy_id, teacher_id)
WHERE NOT EXISTS (
  SELECT 1 FROM treoo.academy_teacher m
  WHERE m.academy_id = v.academy_id AND m.teacher_id = v.teacher_id
);

COMMIT;

-- Idempotency ledger for create and save (executable)
--
-- Proposed executable table for the operation-key pattern. Hash canonical request
-- bytes after normalization (including operation kind and expected revision); use
-- SHA-256 bytes, 32 octets. Store the response needed for replay with a size cap
-- in the service. Scope the key by academy and authenticated teacher. This table
-- does not authorize access.
--
-- Revisión: DBA reemplaza la versión anterior basada en `idempotency_key`/`request_hash`
-- textuales por este esquema que incluye `operation_kind`, `committed_revision`,
-- relaciones FK y respuesta reutilizable dentro del mismo rango.
--
-- Retención de demo: retener cada fila del ledger durante la vida útil de la demo.
-- Sin TTL, purga automática ni reutilización silenciosa de las claves. Retiro
-- manual requiere procedimiento explícito; no se ejecuta aquí. Producción y
-- retención real requieren política separada.

CREATE TABLE treoo.mutation_dedup (
  academy_id uuid NOT NULL,
  teacher_id uuid NOT NULL,
  operation_key text NOT NULL CHECK (length(operation_key) BETWEEN 1 AND 200),
  operation_kind text NOT NULL CHECK (operation_kind IN ('create_lesson', 'save_lesson')),
  request_hash bytea NOT NULL CHECK (octet_length(request_hash) = 32),
  lesson_id uuid NOT NULL,
  committed_revision bigint NOT NULL CHECK (committed_revision > 0),
  response_json jsonb NOT NULL CHECK (pg_column_size(response_json) <= 65536),
  completed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (academy_id, teacher_id, operation_key),
  FOREIGN KEY (academy_id, teacher_id)
    REFERENCES treoo.academy_teacher (academy_id, teacher_id) ON DELETE RESTRICT,
  FOREIGN KEY (academy_id, lesson_id)
    REFERENCES treoo.lesson (academy_id, lesson_id) ON DELETE RESTRICT
);

-- Dominio y semántica del ledger (protocolo ejecutable propuesto, no ejecutado aquí)
--
-- Scope de la clave: (academy_id, teacher_id, operation_key).
-- El operation_key identifica semánticamente la operación del cliente; el mismo
-- key puede usarse por create_lesson y save_lesson si se desea, pero el dao de
-- la clave compuesto por scope + key puede tener duplicados que se diferencian
-- por operation_kind y request_hash.
--
-- Hash canónico: bytes SHA-256 de 32 octetos de la representación canónica de la
-- petición normalizada, incluyendo obligatoriamente:
--   - operation_kind
--   - expectedRevision
--   - normalized payload / activity set used for the mutation
-- La normalización canónica de payload se decide en servicio; lo no negociable es
-- que el mismo key y el mismo request_hash devuelven exactamente la misma respuesta.
--
-- Protocolo de transacción (create_lesson o save_lesson):
--
-- 1. Autenticar y derivar academy_id/teacher_id desde sesión del servidor.
-- 2. Validar payload con los validadores del paquete (dto-validators.ts).
-- 2b. Calcular request_hash canónico por encima del payload validado con la misma
--     normalización de encriptación usada para guardar la respuesta.
-- 3. Buscar la clave en ese alcance:
--     SELECT operation_kind, request_hash, lesson_id, committed_revision, response_json,
--            completed_at
--     FROM treoo.mutation_dedup
--     WHERE academy_id = $academy_id
--       AND teacher_id = $teacher_id
--       AND operation_key = $operation_key
--     FOR UPDATE;
--     Si la fila existe:
--       - mismo operation_kind Y mismo request_hash → devolver
--         response_json textualmente (IDEMPOTENT_REPLAY). No toca lesson, no
--         toca activities, no toca revision.
--       - operation_kind distinto O request_hash distinto →
--         IDEMPOTENCY_KEY_REUSED. No muta nada; la respuesta de error puede
--         incluir los valores existentes para diagnóstico, pero no revela
--         contenido no autorizado.
-- 4. Si no existe la clave:
--     a. Create:
--        - INSERT lesson (academy_id, lesson_id, teacher_id, title, ...) con
--          revision = 1, status = 'draft'.
--        - Si payload tiene actividades, INSERT/REEMPLAZAR el conjunto completo
--          de activities para ese (academy_id, lesson_id) en la misma transacción.
--        - INSERT mutation_dedup (academy_id, teacher_id, operation_key,
--          operation_kind = 'create_lesson', request_hash, lesson_id,
--          committed_revision = 1, response_json = response guardada).
--     b. Save:
--        - UPDATE lesson SET revision = revision + 1, ... , updated_at = now()
--          WHERE academy_id = $academy_id AND lesson_id = $lesson_id
--            AND teacher_id = $teacher_id
--            AND revision = $expectedRevision
--          RETURNING revision, ...;
--        - Si la actualización retorna fila:
--            - DELETE FROM treoo.activity WHERE academy_id = $academy_id
--                AND lesson_id = $lesson_id;
--            - INSERT conjunto completo de actividades validadas para ese
--                (academy_id, lesson_id). Si no hay actividades, la operación
--                queda con el conjunto vacío.
--            - INSERT mutation_dedup (..., operation_kind = 'save_lesson',
--                request_hash, lesson_id, committed_revision = nueva revisión,
--                response_json = response guardada).
--        - Si la actualización NO retorna fila: abandonar transacción sin tocar
--          activities; responder CONFLICT / recurso no visible.
-- 5. COMMIT.
-- 6. Responder. Nunca responder éxito antes del commit.
--
-- Manejo de carrera por clave única:
--   - Si dos cypress compiten por la misma clave, la perdedora falla con violación
--     de clave única en mutation_dedup, revierte, vuelve a leer la fila ganadora
--     y aplica el paso 3. Tras la reversión no queda ninguna fila del ledger, y el
--     cliente puede repetir la misma clave.
--   - La FK hacia lesson se satisface en el caso de creación porque la fila del
--     ledger se inserta después de crear la lección dentro de la misma transacción.
--
-- Retención de respuesta: el response_json debe ser el contenido mínimo necesario
-- para reproducir la respuesta original de forma segura y auditable. Decisiones de
-- qué incluir (p. ej. lesson_id + committed_revision + status, o cuerpo limitado)
-- requieren Arquitectura/PO; este SQL no los define. Respuestas que contengan
-- contenido sensible no deben ser reutilizadas sin revisar privacidad.
--
-- Estado del contracto de respuesta: este SQL establece la tabla, las llaves
-- foráneas, los checks y el protocolo de transacción, pero no ejecuta el servidor
-- ni define el formato exacto de response_json. Se revisará antes de la integración.

-- Nota operativa de revisión DBA / PO:
--   Este bloque SQL es ejecutable en una base vacía/seedada que ya contiene las
--   tablas academy, teacher, academy_teacher, lesson y activity. No ejecutar aquí.
--   El seed exacto preflight fue revisado línea por línea contra
--   `/home/node/.cache/treoo-po/data-review-20261116.md`.
--   A continuación se documentan los casos de verificación que deben cubrir la
--   revisión y, eventualmente, los tests de integración; no se ejecutan aquí.

-- Casos de verificación adicionales (no ejecutados)
--
-- - Ejecutar la semilla dos veces: la segunda no hace nada y queda con exactamente
--   dos academias, tres teachers y tres vínculos.
-- - Preinsertar un UUID de academia/teacher del fixture con nombre alterado: el
--   preflight aborta y deja todas las filas intactas.
-- - Preinsertar un vínculo de fixture en una academia inesperada: el preflight
--   aborta; sin inserts parciales.

-- Identificadores fijos del seed (revisable solo junto con el SQL anterior)
--
-- ### academias
--
-- | label | uuid |
-- |-------|------|
-- | Demo Academy A | 10000000-0000-4000-8000-000000000001 |
-- | Demo Academy B | 10000000-0000-4000-8000-000000000002 |
--
-- ### teachers
--
-- | label | uuid |
-- |-------|------|
-- | Ana Ruiz | 20000000-0000-4000-8000-000000000001 |
-- | Alex Kim | 20000000-0000-4000-8000-000000000002 |
-- | Bruno Vega | 20000000-0000-4000-8000-000000000003 |
--
-- ### academy_teacher membership
--
-- | academy uuid | teacher uuid | note |
-- |------|-----------|------|
-- | Demo Academy A | Ana Ruiz | same academy, distinct teacher from Alex |
-- | Demo Academy A | Alex Kim | second teacher in Academy A |
-- | Demo Academy B | Bruno Vega | isolated teacher in Academy B |
--
-- ### preinserted lesson guard
--
-- | lesson uuid | note |
-- |-----------|------|
-- | 30000000-0000-4000-8000-000000000001 | FK preinsert only, body discarded |
--
-- ### fixed-id verification notes (do not execute)
--
-- - Ana and Alex must both belong to Academy A and remain distinct teachers in the
--   same seed. The membership rows above make that explicit.
-- - If the seed is applied twice, the final state should be exactly two academias,
--   three teachers and three memberships, with no duplicates.
-- - If Alex appears under a different name before the seed runs, the preflight must
--   abort without inserting anything and leave the existing state intact.
-- - If Alex is preinserted into a different academy, the preflight must abort due to
--   the membership conflict, not proceed to insert.
-- - Los dos teachers Ana y Alex en Academy A solo acceden a lecciones de A bajo su
--   propia autorización; Bruno en B no las accede.
-- - Crear/guardar repetidamente con la misma clave en el mismo alcance y hash
--   canónico idéntico: mismo lesson_id/revisión/response, sin segunda lección ni
--   revisión duplicada.
-- - Reutilizar la clave con payload distinto, operation_kind distinto o
--   expectedRevision distinto: IDEMPOTENCY_KEY_REUSED; sin mutación.
-- - Llamadas concurrentes con la misma clave: una hace commit; la otra revierte,
--   lee al ganador y devuelve el resultado del ganador.
-- - Fallo de transacción antes del insert del ledger o antes del commit: la mutación
--   de la lección y la fila del dedup se revierten juntas; la misma clave puede
--   volver a intentarse.

-- Protocolo canónico de hash y respuesta para revisión de implementación (no ejecutado)
--
-- 1. request_hash se calcula sobre bytes canonizados de:
--       {
--         "operation_kind": "create_lesson" | "save_lesson",
--         "academy_id": "<uuid>",
--         "teacher_id": "<uuid>",
--         "lesson_id": "<uuid, solo para save>",
--         "expectedRevision": <integer>,
--         "payload": <representación canonizada usada por la operación>
--       }
--    Se recomienda canonizar:
--      - orden de claves fijo,
--      - números como cadenas decimales sin notación científica,
--      - fechas como ISO-8601 con zona fija,
--      - textos recortados y normalizados igual que en la capa de validación,
--      - conjunto de activities ordenado por order_index ascendente antes de
--        calcular el hash.
-- 2. El response_json guardado se calcula UNA SOLA VEZ al confirmar la operación
--    y se reutiliza textualmente para IDEMPOTENT_REPLAY. No se recomputa, no se
--    revalida, no se reencUENTRA de la lección en cada replay.
-- 3. IDEMPOTENT_REPLAY devuelve exactamente el mismo cuerpo HTTP/JSON que la
--    operación original, incluyendo código de respuesta y headers reproducibles
--    si el servicio lo define, pero sin mutar ni recomputar nada.
-- 4. IDEMPOTENCY_KEY_REUSED es un error (p. ej. 409 o 422 según diseño) con
--    código explícito IDEMPOTENCY_KEY_REUSED y, opcionalmente, los campos
--    existentes necesarios para diagnóstico (operation_kind, lesson_id,
--    committed_revision existente), sin incluir payload ni response del otro
--    cliente si no se desea exponerlo.
-- 5. La clave se puede reintentar indefinidamente si la transacción falla antes
--    del commit; el fallo no deja estado parcialmente guardado porque
--    mutation_dedup y lesson/activities comparten la misma transacción.
