# Contrato mínimo — US-A-003 (Borrador de lección editable)

Estado: propuesta local para revisión con arquitectura/DBA/Cian.
No es API pública ni contrato versionado en GitHub aún.
Fuente de lectura usada para preparar este borrador: 15 — Encargo al desarrollador: Freebuff.
Criterios de aceptación usados como hoja de ruta: AC-A-01 ... AC-A-12.
Orden de ejecución solicitado: recorrido manual persistente primero, luego imagen/IA.

## 1. Alcance mínimo de A que este contrato cubre

Este contrato aborda el recorrido manual persistente de A antes de conectar IA real:

- Login de docente con cuenta de demo.
- Crear lección desde cero o desde actividad/base.
- Editar título, tema, nivel/contexto, objetivo, metodología.
- Crear/ordenar/editar actividades y sus instrucciones.
- Editar duraciones editables de actividades y lección.
- Guardar borrador, cerrar, reabrir, editar de nuevo, previsualizar.
- Vista previa solo lectura con “Volver a editar”.

No cubre en este corte:
- Carga de fotografía,
- Extracción,
- Generación con IA,
- Publicación a alumnos,
- Pizarra, proyección operativa y cronómetro.

## 2. Actor, sesión y ámbito

- Actor principal para A: profesor con cuenta de demo autorizada.
- Sesión docente: identidad autenticada + ámbito de academia.
- Aislamiento: dos academias ficticias; una no lee ni escribe lecciones/archivos de la otra mediante vías directas del backend.
- Regla del frontend: cualquier acción privada debe comportarse como rechazada si no hay sesión válida, incluso si alguien reconstruye la petición.
- Regla del backend: ningún endpoint de edición/publicación acepta peticiones sin autorización válida.

Movimiento obligatorio antes de implementar la historia:
- Confirmar con arquitectura cómo se representa la sesión docente en el backend, si es JWT, cookies, sesión servidor o combo.
- Confirmar con datos cómo queda el vínculo lección -> academia y el vínculo lección -> professor/actor.
- Confirmar con Cian la vista previa y el botón “Volver a editar”.

## 3. Contratos de operación mínimos

### 3.1 `createDraftLesson`

Objetivo: iniciar un borrador nuevo para una academia y un actor determinados.

Entrada propuesta mínima:
- `academiaId`: identificador de academia del actor.
- `professorId` o `actorId` según se defina en sesión.
- `title`: string no vacío, longitud acotada.
- `theme`: string opcional.
- `levelContext`: string opcional, ej. B1, contexto ficticio de demo.
- `objective`: string no vacío.
- `methodology`: string opcional.
- `initialActivities`: array opcional de actividades con contenido e instrucciones.

Salida propuesta mínima:
- `lessonId`: identificador del borrador creado.
- `status`: borrador.
- `createdAt`:fecha de creación.
- `editorId`: actor que lo creó.
- `academiaId`: academia dueña del borrador.

Reglas:
- El borrador queda asociado a la academia del actor.
- No existe publicación automática.
- No existen campos derivados obligatorios que impidan guardar un borrador vacío en la capa de datos, pero la UI/capa de dominio puede exigir mínimos diferentes si se acuerda.

### 3.2 `saveDraftLesson`

Objetivo: persistir cambios del borrador.

Entrada mínima:
- `lessonId`.
- `payload`: campos editables actualizados.
- Opcionalmente `expectedVersion` si se decide estrategia optimista.

Salida mínima:
- `lessonId`.
- `status`: borrador o el estado resultante.
- `updatedAt`.
- `conflict` si la estrategia lo requiere.

Reglas:
- Guardar no publica.
- Guardar no invoca IA en esta historia.
- Si hay conflicto, no se sobrescribe en silencio; se devuelve conflicto y se decide política: versión más reciente, fusión manual o rechazo.
- No se marca como guardado si falló la persistencia.

### 3.3 `reopenDraftLesson`

Objetivo: cargar un borrador cerrado para edición.

Entrada mínima:
- `lessonId`.
- `actor` autorizado dentro de la academia dueña.

Salida mínima:
- borrador completo con actividades, orden, instrucciones, duraciones y estado.

Reglas:
- Reabrir debe devolver lo que se guardó, no reconstruirlo desde caché del navegador por defecto.
- Reabrir no invoca IA.
- Reabrir no altera la versión anterior a menos que se guarde de nuevo.

### 3.4 `editDraftLesson`

Objetivo: modificar un borrador abierto.

Entrada mínima:
- `lessonId`.
- campos editables + orden de actividades + duraciones.

Salida mínima:
- borrador actualizado o lista de cambios aplicados.
- advertencia si hay cambios sin guardar si se aplica en UI.

Reglas:
- Editar es local hasta guardar.
- Editar no publica.
- Editar no fuerza recálculo IA.

### 3.5 `previewDraftLesson`

Objetivo: lectura de la lección como la vería el profesor.

Salida mínima:
- render legible de título, tema, nivel/contexto, objetivo, metodología, actividades, orden, instrucciones, duraciones.

Reglas:
- Previsualizar es solo lectura.
- Previsualizar debe ofrecer “Volver a editar”.
- “Volver a editar” vuelve al mismo borrador; no clona ni invoca IA.
- Previsualizar no publica a alumnos.

### 3.6 `closeDraftLesson`

Objetivo: cerrar el borrador sin publicarlo.

Salida mínima:
- estado cerrado o equivalente.
- conservar contenido, actividades, tiempos y vínculos.

Reglas:
- Cerrar no publica.
- Cerrar no borra borrador.
- El borrador puede reabrirse después.

## 4. Campos mínimos del borrador

Campos propuestos para el borrador de lección:

- `id`
- `academiaId`
- `professorId` o `actorId`
- `title`
- `theme`
- `levelContext`
- `objective`
- `methodology`
- `status`: draft, closed, published(future)
- `version`
- `createdAt`
- `updatedAt`
- `sourceType`: manual, image, future
- `sourceRef`: referencia opcional a material original/derivado una vez se concreta la imagen;
  en este corte mínimo puede ser null o campo reservado.

Actividad mínima:
- `id`
- `lessonId`
- `title`
- `instruction`
- `order`
- `durationMinutes`
- `type` opcional segun se defina pedagogo/UX

Regla de duración editable:
- La duración de la lección es función de las actividades o un campo explícito editable,
  según se decida con pedagogo/UX; lo importante es que sea editable y persista.

## 5. Estados y errores mínimos

Estados del borrador:
- `draft`
- `closed`
- `published` solo como concepto futuro; no en este corte.
- En breve podrían añadirse estados de `processing` cuando llegue IA, pero eso es historia posterior.

Errores que el contrato debe diferenciar:

- `unauthorized`: sesión o permiso insuficiente.
- `notFound`: lección no existe o no pertenece a la academia/actor.
- `validationError`: campos inválidos o faltantes según contrato.
- `conflict`: versión desactualizada si se usa estrategia optimista.
- `saveFailed`: persistencia fallida; no se marca guardado.
- `imageUploadFailed` reservado para cuando llegue imagen.
- `extractionFailed` reservado para cuando llegue IA.
- `generationFailed` reservado para cuando llegue IA.

Importante: el tipo TS no basta; estos códigos deben ser runtime y diferenciables por el frontend.

## 6. Estrategia de conflictos y idempotencia

Propuesta mínima por defecto:
- Si no hay concurrencia real demostrada, empezar con guardado simple y versión opcional `updatedAt`-basada.
- Si hay edición concurrente real, habilitar versión explícita u optimistic lock para `saveDraftLesson`.
- `saveDraftLesson` debe ser idempotente en la medida en que volver a enviar el mismo payload guardado no corrompa el estado.
- Los reintentos de red pueden repetir `saveDraftLesson` con cuidado; si hay side effect por diseño, se documenta y se controla con idempotency key o con versión.

Política de datos:
- Ningún borrador, lección ni material queda publicado a alumnos por guardar/revisar/preview.
- Persistencia principal en PostgreSQL; no usar almacenamiento del navegador como única fuente de verdad.
- Original vs extracción vs borrador: separar fonfo original de lo que el profesor edita; una extracción no debe sobreescribir lo editado sin intervención del profesor.

## 7. Autorización y límites

- Backend valida academy + actor antes de cualquier lectura/escritura del borrador.
- Frontend no confía en que el usuario puede tocar lecciones ajenas ocultando UI.
- Dos academias ficticias: verificar que no hay filtrado por id sin relación y que no hay alteración de identificadores.
- Camino manual debe existir y funcionar sin IA.

## 8. Lo que debo confirmar antes de llamar a esto “contrato listo”

Pendiente de revisión real con arquitectura/DBA/Cian:
- representación exacta de sesión docente,
- esquema de lección/actividad/resultado en PostgreSQL y relación con académica,
- estrategia de conflicto elegida,
- cómo se almacena el material original una vez llegue imagen,
- si la duración editable queda en lección, en actividades o en ambos,
- qué campos VA Cian y el frontend como mínimo para aceptar el recorrido manual.

## 9. Criterios mínimos de verificación para esta historia

Se preparan, no se afirman ejecutados:

- Crear lección manual sin IA.
- Editar título, objetivo, actividades, orden y duraciones.
- Guardar, salir, reabrir y ver lo guardado.
- Modificar duración, guardar, reabrir, confirmar nuevo valor sin IA.
- Ver previsualización y volver al editor sin clonar.
- No publicar en alumnos con guardar/revisar/preview.
- Rechazar acceso sin sesión y aislar dos academias ficticias.

## 10. Nota de ruta

El contrato de carga/extracción/generación con IA queda para cuando se habilite la pasarela real y el modelo elegido. Este documento prepara mínimo ejecutable de la ruta manual; el PO decide si eso calza con el objetivo del 5 de noviembre una vez se confirme entorno y acceso.

EOF
echo "escrito"; echo "--- resumen de archivos creados ---"; find treoo/local -type f -print && echo "--- fixture de hoja ficticia de referencia (para repetir prueba) ---" && cat > treoo/local/A-contract/demo-worksheet-ref.txt <<'EOF'
TREOO — DEMO WORKSHEET
PRESENT PERFECT

Complete each sentence with the present perfect form of the verb.

1. I ___ already ___ (finish) my homework.
2. She ___ never ___ (visit) Cork.
3. ___ you ever ___ (try) Irish soda bread?
4. We ___ (not see) that film yet.
5. They ___ (live) here since 2024.

Pair work:
Ask your partner two questions about experiences using "Have you ever...?"

Clave docente de referencia:
1. have / finished
2. has / visited
3. Have / tried
4. have not seen (haven't seen)
5. have lived
EOF
echo "ok"