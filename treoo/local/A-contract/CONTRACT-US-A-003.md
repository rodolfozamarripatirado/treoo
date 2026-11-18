#

## 11. Esquema minimo y validaciones propuestas

Esta seccion es propuesta para discusion con arquitectura/DBA antes de codificar; no es DDL definitivo.

### 11.1 Tabla de academias ficticias para demo

- academias
  - id UUID o bigserial
  - slug acotado, unico para demo
  - name opcional
  - created_at

Regla: dos academias ficticias aisladas para demo; ninguna leccion cruza vinculos directos entre academias sin autorizacion.

### 11.2 Sesion docente y vinculo con academia

Pendiente definir con arquitectura, pero minimo requerido para T-A-002:

- El backend recibe y valida una sesion docente por peticion.
- La sesion resuelve actorId y academiaId.
- Ningun endpoint de borrador acepta academiaId o professorId confiando solo en el body; los resuelve desde la sesion autorizada.

### 11.3 Tabla de borradores de leccion

- draft_lessons
  - id
  - academia_id FK a academias
  - actor_id docente dueño
  - title no vacio y acotado
  - theme opcional
  - level_context opcional
  - objective no vacio
  - methodology opcional
  - status enum: draft, closed, published(futuro)
  - version entero monotono para control de version
  - source_type enum: manual, image, future
  - source_ref nullable para cuando llegue imagen
  - created_at
  - updated_at

Validaciones minimas propuestas:
- title y objective no vacios en crear/guardar.
- Longitudes acotadas en backend, no solo en UI.
- status no puede pasar a published desde este corte manual.

### 11.4 Tabla de actividades del borrador

- draft_lesson_activities
  - id
  - draft_lesson_id
  - title
  - instruction
  - order entero
  - duration_minutes entero >= 0
  - type opcional segun se defina pedagogo/UX

Regla de duracion editable propuesta:
- La duracion de la leccion se calcula o se deriva de las actividades o de un campo explicito a definir con pedagogo/UX; en cualquier caso debe ser editable y persistir en postgres, no en cache del navegador.

### 11.5 Validaciones cross-fields minimas

- No guardar un borrador con lista de actividades vacia si el dominio lo exige; si no, permitir borrador minimo y dejar la regla a UX/pedagogo.
- Orden unico dentro del borrador: (draft_lesson_id, order).
- Si se permite eliminar actividad, queda consistente el orden restante.

## 12. Control de version propuesto

- Cada saveDraftLesson exitoso incrementa version en 1.
- reopenDraftLesson devuelve la version actual junto con el borrador.
- El frontend puede enviar expectedVersion en guardado para detectar editado concurrente.
- Si no hay expectedVersion, el backend puede aceptar guardado simple o rechazar por politica; esto se decide con arquitectura.
- No se usa hash de contenido como unica version; se prefiere version explicita + updated_at.

## 13. Conflictos y reintentos propuestos

### 13.1 Deteccion
- Si expectedVersion != version actual, saveDraftLesson responde conflict con currentVersion y currentUpdatedAt.
- El frontend decide: cargar ultima, fusionar manual o rechazar.

### 13.2 Politica por defecto
- Para demo manual, empezar con politica conservative: rechazar guardado concurrente y pedir resload del ultimo.
- No auto-fusing de campos criticos como titulo/objetivo sin intervencion del profesor.

### 13.3 Idempotencia y reintentos
- Guardado idempotente en la medida en que reenviar el mismo payload sin cambios no avanza version ni corrompa el estado.
- En errores transitorios de red/persistencia, el frontend puede reintentar con la misma version, no con una ya incrementada.
- No implementar reintentos infinitos; limite razonable y backoff breve para demo.
- Si persistencia falla, no marcar borrador como guardado; dejarlo en estado anterior o explicito no guardado.

## 14. Regla de preview DEC-A-001

DEC-A-001: preview es solo lectura y vuelve al mismo borrador.

Se aplican estas reglas al implementar preview:

1. Preview renderiza el borrador actual sin modificar estado, version ni contenido.
2. Preview no invoca IA, extraccion ni generacion en este corte.
3. Preview no publica a alumnos y no guarda nada nuevo.
4. Preview expone boton 'Volver a editar' que vuelve al editor del mismo lessonId, misma academia, mismo actor, mismo borrador.
5. 'Volver a editar' no clona el borrador, no crea nuevo, no reinicia version; continua sobre el mismo draft_lesson.
6. Si el borrador se cerro, preview puede ser solo lectura con aviso de cerrado; volver a editar requiere reabrir si la politica lo exige.
7. Preview debe ser coherente con lo guardado, no con cache del navegador; si hay version desactualizada, preview lee la version actual o informa que hay cambios no recibidos.
8. Revertir de preview a editor es instantaneo y conserva lo no guardado en cliente si la UI ya lo tenia localmente; pero no confiar en eso como unica fuente de verdad.

Criterios minimos de verificacion de DEC-A-001:
- Abrir preview y confirmar que no cambia version/updated_at.
- Volver a editar y confirmar que sigue siendo el mismo borrador y mismo orden de actividades.
- Confirmar que preview no publica y no dispara IA/extraction/generation.
- Confirmar que cerrar y reabrir preserva lo guardado y preview lee lo guardado.

## 15. Pendientes por confirmar con arquitectura, datos y Cian

- Representacion exacta de sesion docente y como se resuelven academia + actor.
- DDL final de draft_lessons y draft_lesson_activities, indices y FKs.
- Estabilidad de claves y tipos UUID vs bigint vs serial.
- Que campos VA Cian y frontend como minimo para aceptar el recorrido manual.
- Comportamiento de preview cuando el borrador esta cerrado.
- Politica final de conflicto: conservative vs optimistic lock vs version-only.
- Almacenamiento del material original para cuando llegue imagen.
- Ubicacion definitiva de la duracion editable: leccion, actividades, o ambos.

