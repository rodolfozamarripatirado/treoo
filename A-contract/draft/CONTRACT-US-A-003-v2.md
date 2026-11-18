# Contrato mínimo — US-A-003 (corregido y completo para revisión)

## 1. Alcance mínimo aceptado por T-A-002
- Crear borrador de lección.
- Editar borrador: texto, título, actividades, duración por actividad.
- Guardar borrador como lección.
- Salir y reabrir lección guardada.
- Editar lección guardada.
- Previsualizar lección sin publicar a alumnos.
- Ruta manual funcional sin IA para demo A.

No incluye publicación a alumnos, ni generación de imagen/IA para esta tarea.

## 2. Sesión y contexto autorizado
- Sesión docente = identificador de contexto docente autorizado, asociado al docente en sesión.
- Cada operación de lección se valida contra la sesión activa del docente.
- Contexto por borrador: docente_id + lección_id + versión borrador.
- No se comparte ni reutiliza contexto entre docentes.
- La previsualización usa el mismo contexto de edición, no publica.

## 3. DTO mínimos propuestos (revisar con arquitectura)
### 3.1 CreateLessonDraftRequest
- teacherId: string
- title: string
- text: string
- activities: Array<{
    kind: string
    text: string
    durationMinutes: number
  }>

### 3.2 UpdateLessonDraftRequest
- lessonId: string
- title?: string
- text?: string
- activities?: Array<{
    id?: string
    kind: string
    text: string
    durationMinutes: number
  }>

### 3.3 SaveLessonRequest
- lessonId: string
- term?: string

### 3.4 ReopenLessonRequest
- lessonId: string

### 3.5 PreviewLessonRequest
- lessonId: string

### 3.6 Responses mínimos
- LessonDraft: { lessonId, teacherId, title, text, activities, status, updatedAt }
- Lesson: { lessonId, teacherId, title, text, activities, status, updatedAt }
- Error: { code, message }

## 4. Campos mínimos de lección y actividad
### 4.1 Lesson
- lesson_id: uuid PK
- teacher_id: uuid NOT NULL
- title: text NOT NULL
- text: text NOT NULL
- status: text NOT NULL
- updated_at: timestamptz NOT NULL
- created_at: timestamptz NOT NULL

### 4.2 Activity
- activity_id: uuid PK
- lesson_id: uuid FK NOT NULL
- kind: text NOT NULL
- text: text NOT NULL
- duration_minutes: integer NOT NULL
- order_index: integer NOT NULL
- created_at: timestamptz NOT NULL

### 4.3 Duración
- duration_minutes por actividad, numérico, editable.
- Decisión ya existe en DEC-A-001/002; no se reabre aquí.

## 5. Estados mínimos de lección
- draft
- saved
- reopened
- preview

Solo para demo A.

## 6. Validaciones mínimas
- teacherId presente y sesión válida.
- title no vacío.
- text no vacío.
- activities array no vacío.
- cada actividad con kind, text no vacío y duration_minutes entero positivo.
- Solo el propietario del docente puede operar su lección.

## 7. Errores mínimos
- UNAUTHORIZED: sesión inválida o docente no reconocido.
- NOT_FOUND: lección no existe o no pertenece al docente.
- VALIDATION_ERROR: campos inválidos.
- CONFLICT: cambio concurrente detectado.
- INTERNAL_ERROR: fallo interno sin revelar detalles.

## 8. Transacción de guardado
- SaveLesson:
  1. Comprobar sesión docente.
  2. Comprobar existencia y propiedad de la lección.
  3. Validar payload.
  4. En transacción:
     - actualizar lesson
     - insertar/reemplazar activities con orden
  5. Commit.
  6. Recuperar versión guardada para respuesta.
- Reabrir y editar nachan reglas equivalentes de propiedad y validación.

## 9. Estrategia de conflicto mínima
- Detectar conflicto mediante versión/updated_at o mecanismo equivalente.
- Si conflicto:
  - devolver CONFLICT con dato de revisión.
  - pedir rebase manual del docente o reintentar con versión actualizada.
- No se aplica merge automático de contenido en esta tarea.

## 10. Idempotencia y reintentos
- Create una sola vez por solicitud efectiva; reintentos deben ser seguros por lessonId.
- Guardar, reabrir y editar idempotentes en la medida de la validación y propiedad.
- Preview idempotente y sin efecto en estado publicado.
- Reintentos gov by client con backoff simple; no retry infinito.

## 11. Autorización mínima
- Docente en sesión = propietario del contexto autorizado.
- Nada de acceso entre docentes.
- No se implementa publicación ni roles adicionales en esta tarea.

## 12. Almacenamiento
- Lección y actividades en PostgreSQL.
- Material original Narwhals si aplica; no bloquea manual S-01.
- Imagen/IA quedan fuera de esta tarea.

## 13. Pre condiciones
- Demo A manual persistente funciona sin IA.
- DB con schema definido y migrado antes de implementar historias.
- Contrato revisado por arquitectura/Datos/Cian antes de codificar.

## 14. Estado actual
- Propuesta lista para revisión.
- No implementado.
- No registrado como hecho.
