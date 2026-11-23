# Treoo — Plan del MVP (rama `claude/mvp`)

> Propuesta ejecutada sobre la documentación canónica de Notion (01 Visión, 06 MVP, 08 Decisiones técnicas, 15 Encargo).
> Datos ficticios únicamente. La interfaz va **en inglés** por decisión del propietario.
> Una aplicación que funciona no equivale a aceptación del producto: los gates (QG-03, revisión docente o revisión de Datos) siguen en manos del PO.

## 1. Objetivo

Demostrar el **ciclo completo del primer ciclo** (06 §1) con un producto web responsive en contenedores:

> La academia organiza grupos y alumnos → el profesor convierte una foto o un texto en una lección editable (con IA o a mano) → la imparte con proyección, temporizador y pizarra → registra asistencia y publica → el alumno practica y recupera lo trabajado por fecha o tema → profesor y dirección consultan asistencia y resultados básicos.

## 2. Alcance (Must de 06, recortado a lo demostrable)

| # | Módulo | Incluye | Requisitos |
|---|---|---|---|
| M1 | Organización y acceso | Academias, membresías con rol (`admin`, `teacher`, `student`), login usuario/contraseña con Argon2id, sesión de servidor en cookie HttpOnly, selector de academia, aislamiento por academia derivado de la sesión (TD-02/TD-04) | REQ-001–004/072 |
| M2 | Operación escolar | Grupos con nivel, matrícula de alumnos, sesiones de clase con fecha y asistencia (present/absent/late/excused) | REQ-013–018 |
| M3 | Preparación docente (Corte A) | Subir foto o pegar texto, conservar el original, extracción con IA (o manual) revisable, borrador de lección generado por IA o creado a mano, editor de actividades con duración opcional fraccionaria (DEC-A-002), revisión optimista con conflicto 409, idempotencia de guardado, vista previa del contenido guardado (DEC-A-001). Guardar **no** publica | REQ-019–027/061 |
| M4 | Aula digital (Corte B) | Modo presentación a pantalla completa, temporizador por actividad, pizarra de anotación sobre lienzo y registro de la clase impartida | REQ-028–033 |
| M5 | Diario y trazabilidad | La misma sesión publicada se encuentra por **fecha** y por **tema** | REQ-035–039/050 |
| M6 | Práctica y evaluación | Ejercicios `single_choice`, `true_false` y `short_answer`, asignación a un grupo con fecha límite, intentos conservados, autocorrección de opción y feedback y nota del docente | REQ-041–044/047 |
| M7 | Portal del alumno | Clases publicadas, tareas pendientes, historial de intentos y asistencia propia | REQ-049/050 |
| M8 | Seguimiento básico | Asistencia y resultados por grupo y por tema para docente y admin, sin rankings | REQ-065–067 |
| M9 | Operación | Dockerfile multi-arch (`linux/arm64` y `linux/amd64`), docker compose (app, PostgreSQL y Ollama opcional), healthcheck, `.env.example`, migraciones y seed reproducible | REQ-080 |

**Fuera de este corte (se mantienen en el catálogo):** facturación y conteo (EP-12), kardex entre academias (REQ-079), pizarra colaborativa multiusuario, recomendaciones predictivas, calendario con festivos, vocabulario con IPA y audio, eventos y portal de tutores (DEC-03).

## 3. Decisiones técnicas (según TD-03)

- **Stack:** TypeScript estricto · Node 22/24 · Fastify 5 · Drizzle ORM + `pg` · PostgreSQL 16 · React 18 + Vite · Zod para contratos en ejecución.
- **Monorepo:** `apps/api` y `apps/web`. En producción un solo contenedor sirve la API y el frontend compilado. Así hay menos piezas en la VM de 12 GB.
- **Multiacademia:** cada tabla de dominio lleva `academy_id`. El `academy_id` y el actor salen **siempre** de la sesión del servidor y nunca del body. Los accesos cruzados devuelven 404 para no filtrar si el recurso existe.
- **Guardado de lección:** `PUT /lessons/:id` exige `expectedRevision`. Si no coincide, devuelve 409 con la versión del servidor. La cabecera `Idempotency-Key` y el hash SHA-256 del body evitan duplicar en reintentos, con un ledger `mutation_dedup` inspirado en la propuesta de Datos (Freebuff/AGT-DATA-001).
- **IA:** adaptador en backend con tres modos (08 §4): `manual` (sin IA), `mock` (respuestas marcadas como simuladas) y `ollama` (`qwen3-vl:4b-instruct` para extraer de foto y `qwen3:8b` para redactar la lección, con salida JSON Schema). Si la IA falla, la ruta manual sigue funcionando.
- **Archivos:** los originales se guardan en un volumen (`/data/uploads`) fuera de la imagen, con el nombre por UUID y el tipo MIME validado. Solo se sirven a miembros de la misma academia.

## 4. Desviaciones respecto a la propuesta de Freebuff

- Claves primarias UUID simples con `academy_id` indexado en lugar de PK compuestas `(academy_id, id)`. El aislamiento se aplica en la capa de repositorio y en los tests. Es una desviación deliberada para simplificar y debe revisarla Datos.
- `lesson.status` admite `draft | ready`. Publicar es una acción aparte que vive en `class_session.published_at` y no en la lección.

## 5. Criterios de aceptación de la demo

1. Ana (teacher, Academy A) entra, crea una lección a mano con 3 actividades (una sin duración y otra de 7,5 min), guarda, sale, la busca, la reabre, la edita y ve la vista previa guardada.
2. Ana sube una foto o pega un texto, revisa la extracción, genera un borrador con IA (o mock), lo edita y guarda.
3. Si dos pestañas editan a la vez, la segunda recibe un conflicto y no se sobrescribe nada en silencio.
4. Bruno (Academy B) no puede ver ni modificar nada de Academy A: los tests de API lo comprueban.
5. Ana programa una clase para un grupo, la imparte en modo presentación con temporizador y pizarra, toma asistencia y publica.
6. Sam (student) ve la clase por fecha y por tema, responde un ejercicio, recibe la nota automática y luego el feedback docente.
7. La admin ve la asistencia y los resultados por grupo y por tema.
8. `docker compose up` levanta todo con migración y seed.

## 6. Orden de ejecución

1. Base (M1 + M9 esqueleto) → 2. M2 → 3. M3 → 4. M4–M8 → 5. Tests, Docker y recorrido E2E en navegador.
