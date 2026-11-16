# Casos de prueba propuestos — US-A-003

## 1. Nota de estado

Estos son escenarios propuestos para la verificación futura del paquete corregido,
no pruebas ejecutadas hoy. Se obtuvieron de la propuesta de casos de prueba en
`handoff-20261116.md`.

## 2. Configuración de aislamiento

Academias ficticias para demo:
- Demo Academy A
- Demo Academy B

Docentes:
- Ana Ruiz — demo teacher, asignada a Demo Academy A
- Alex Kim — demo teacher, asignado a Demo Academy A
- Bruno Vega — demo teacher, asignado a Demo Academy B

Aislamiento objetivo: ninguna operación de un docente cruza al otro docente ni a la otra academia sin autorización real.

Alex pertenece al mismo seed y a la misma academia que Ana, pero es un docente distinto:
su ámbito es `(academy_id = Demo Academy A, teacher_id = Alex)`. Los casos siguientes
suponen que Ana y Alex tienen sesiones resueltas distintas.

## 3. Positivos

### P-01 Crear borrador con solo título y cero actividades

- Entrada: título no vacío; sin actividades; sesión resuelta para una academia y
  un docente.
- Esperado: lección creada en `draft`, `revision = 1`, sin actividades, sin campos
  inválidos.
- Comprobar que los campos opcionales están ausentes o nulos según modelo.

### P-02 Persistir campos parciales

- Entrada: crear/editado con algunos campos opcionales presentes y otros ausentes.
- Esperado: se guardan solo los campos proporcionados, sin inventar valores.

### P-03 Duración NULL, 0.5 minutos y recuperación

- Entrada: actividad con `duration_minutes = NULL`, actividad con `duration_minutes = 0.5`.
- Esperado:
  - NULL permitido.
  - 0.5 persistido y recuperado igual.
  - 0, negativo, NaN, Infinity rechazados en runtime y por CHECK cuando aplica.

### P-04 Guardar y reordenar dos actividades

- Entrada: dos actividades con `order_index` distintos; guardar; después reordenar.
- Esperado: orden conservado tras reapertura; unicidad de orden dentro del ámbito.

### P-05 Guardar revisión `n` devuelve `n+1` y preview devuelve esa revisión

- Entrada: guardar borrador con `expectedRevision = n`.
- Esperado:
  - primera mutación exitosa -> `revision = n+1`.
  - preview devuelve exactamente esa versión sin incrementarla.

## 4. Negativos con dos academias ficticias y dos docentes por academia

### N-01 Lectura/edición/preview cruzada

- Entrada: A/Ana intenta leer, editar o previsualizar lección de B/Bruno aunque conozca
  el UUID.
- Esperado: `UNAUTHORIZED` / `NOT_FOUND` según operación concreta; no se permite.

### N-01b Lectura/edición/preview entre docentes del mismo seed

- Entrada: A/Alex intenta leer, editar o previsualizar lección creada por/session Ana
  en Demo Academy A.
- Esperado: no se permite; ambas pertenecen a la misma academia pero a teachers
  distintos, y el ámbito de la lección es `(academy_id, teacher_id)`.
- Esperado: isoación entre Ana y Alex en el mismo seed; presentar la lección a Alex
  requiere autorización real, no solo compartir academia.

### N-02 Lección con teacher de otra academia

- Entrada: intento de crear o mutar con `lesson` cuya FK compuesta a
  `(academy_id, teacher_id)` no existe.
- Esperado: restricción o error de autorización; no se crea inconsistente.

### N-03 Actividad con academy B y lesson A

- Entrada: actividad con `academy_id = B` y `lesson_id` de `A`.
- Esperado: FK compuesta rechaza o se resuelve como conflicto de ámbito.

### N-04 Cambiar `academy_id` en payload

- Entrada: payload con `academy_id` distinto del contexto de sesión.
- Esperado: servidor deriva ámbito desde sesión; no se usa el `academy_id` del body
  como fuente de verdad.

### N-05 Título inválido

- Entrada: título vacío o solo espacio.
- Esperado: `VALIDATION_ERROR`.

### N-06 Duración inválida

- Entrada: `duration_minutes = 0, negativo, NaN, Infinity`.
- Esperado: rechazo en runtime y CHECK.

### N-07 Conflictos simultáneos

- Entrada: dos guardados simultáneos con `expectedRevision = 1`.
- Esperado: queda exactamente una en `revision = 2`, el otro en `CONFLICT`.

### N-08 Fallo de persistencia revertido

- Entrada: guardado que falla al insertar/reemplazar actividades.
- Esperado: la transacción revierte; no queda ni revisión ni actividades inconsistentes.

### N-09 Dedup: misma clave e hash

- Entrada: Crear con mismo `idempotency_key` y mismo `request_hash`.
- Esperado: devolver el mismo resultado ya creado, no duplicar.

### N-10 Dedup: misma clave, hash distinto

- Entrada: Crear con mismo `idempotency_key` pero `request_hash` distinto.
- Esperado: rechazo.

## 5. RLS — nota de estado

- El contrato corregido no propone RLS como presente y no hay política desplegada
  inspeccionable en él.
- No se dictamina RLS como implementada.
- Si se añade: revisar política en todas las tablas, contexto fijado con `SET LOCAL`
  en transacción, contexto ausente y pool reutilizado, `FORCE ROW LEVEL SECURITY`,
  `owner`, `superuser` y `BYPASSRLS`.
- Mantener autorización en backend y FKs compuestas; RLS no sustituye integridad.

## 6. Criterios de verificación mínimos

- Borrador mínimo guardable y recuperable.
- Campos parciales persistidos sin invención.
- Duración NULL y fraccionaria persistida y recuperada; valores inválidos rechazados.
- Orden conservado al reabrir.
- Revisión aumentada y preview coherente.
- Aislamiento entre docentes/academias.
- Conflicto detectable sin pérdida/duplicación.
- Fallo revertido sin estado corrupto.