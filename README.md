# Treoo

Plataforma SaaS para academias de inglés presencial: preparación de clases con IA y control docente, aula digital, historial por fecha y por tema, y portal del alumno.

> Documentación canónica de producto: Notion → *Treoo — Desarrollo del sistema*. Alcance de esta versión: [`docs/MVP-PLAN.md`](docs/MVP-PLAN.md).
> La interfaz está completamente en inglés por decisión del propietario. Solo se usan **datos ficticios**.

## Qué incluye el MVP

| Área | Qué se puede hacer |
|---|---|
| Acceso | Login con usuario y contraseña (Argon2id y sesión de servidor en cookie HttpOnly), roles `admin` / `teacher` / `student` y una persona con varias academias. El aislamiento entre academias se deriva siempre de la sesión. |
| Preparación (corte A) | Subir foto o pegar texto, conservar el original, extraer con IA y revisar, pedir una propuesta de lección con IA o crearla a mano, editar actividades con tiempos opcionales y fraccionarios, guardar, reabrir y previsualizar lo guardado. Cuando hay conflicto entre pestañas responde 409 y no sobrescribe en silencio. Los reintentos son idempotentes. |
| Aula (corte B) | Modo clase a pantalla completa con temporizador por actividad, +1 min y pizarra para dibujar. Al cerrar se registran notas compartidas y privadas. |
| Operación | Grupos, matrículas, clases programadas y asistencia. |
| Práctica | Ejercicios de opción única, verdadero/falso y respuesta corta. Se asignan a un grupo, con autocorrección en las preguntas cerradas, hasta 3 intentos, y nota y feedback del docente. |
| Alumno | *My classes* por fecha o por tema (solo lo publicado), tareas e historial, y *My progress*. |
| Seguimiento | Asistencia y resultados por grupo, por alumno y por tema. |
| **v2: Today** | Pantalla de inicio del profesor: clases de hoy y de la semana, respuestas por corregir, alumnos con faltas o notas bajas, clases impartidas sin publicar y borradores. |
| **v2: herramientas de aula** | En el modo clase: elegir un alumno al azar (sin repetir hasta que hayan salido todos), hacer parejas o grupos de 3 o 4 con los presentes y pasar lista en la proyección. |
| **v2: vocabulario** | Vocabulario clave por lección, con sugerencias de la IA que elige el profesor. *Vocabulary Lab* para el alumno con tarjetas y repaso espaciado (Leitner). |
| **v2: ficha del alumno** | Asistencia, resultados por tema, respuestas recientes y notas privadas del profesor, que el alumno nunca ve. |
| **v2: reutilizar e imprimir** | Duplicar una lección completa como borrador nuevo e imprimir una hoja de trabajo con la clave de respuestas en una página aparte. |

Publicar es una acción separada de guardar: preparar o guardar una lección nunca la hace visible a los alumnos.

## Arranque rápido (Docker, VM OCI ARM64)

```bash
cp .env.example .env                       # define POSTGRES_PASSWORD
docker compose up -d --build               # app + PostgreSQL (IA simulada)
docker compose exec app node apps/api/dist/db/seed.js   # datos de demo
# abrir http://<host>:3000
```

Con IA real (Ollama en la misma VM):

```bash
# en .env: AI_MODE=ollama
docker compose --profile ai up -d --build
docker compose exec ollama ollama pull qwen3:8b
docker compose exec ollama ollama pull qwen3-vl:4b-instruct
```

**Publicar con una URL pública de Cloudflare** (sin dominio ni token): `./deploy/publish.sh` construye, migra, carga la demo, abre un Quick Tunnel e imprime la URL `https://….trycloudflare.com`. La URL cambia si se recrea el túnel.

Si Ollama ya corre fuera de compose, apunta `OLLAMA_URL` a él y no actives el perfil `ai`. Para publicarla con Cloudflare Quick Tunnel: `cloudflared tunnel --url http://localhost:3000`. Con HTTPS, la cookie se marca como `Secure` automáticamente.

**Cuentas de demo** (contraseña `Treoo-demo-2026`):

| Cuenta | Rol |
|---|---|
| `ana@northbridge.demo` | Profesora en las dos academias |
| `alex@northbridge.demo` | Profesor (otro grupo) |
| `olivia@northbridge.demo` | Admin de Northbridge |
| `sam@northbridge.demo` y `lucia@`, `tomas@`, `mei@` | Alumnos |
| `bruno@westport.demo`, `noah@westport.demo` | Segunda academia (prueba de aislamiento) |

## Modos de IA (`AI_MODE`)

- `manual`: IA desactivada. Todo el recorrido funciona a mano.
- `mock`: respuestas **simuladas** y etiquetadas en la interfaz. Sirven para demostrar el flujo, no para medir calidad.
- `openrouter`: inferencia real vía [OpenRouter](https://openrouter.ai). El modelo por defecto es `qwen/qwen3-vl-30b-a3b-instruct` para la foto y la lección, y se cambia con `OPENROUTER_TEXT_MODEL` / `OPENROUTER_VISION_MODEL`. Pide salidas con JSON Schema estricto: si el modelo no lo admite, reintenta pidiendo solo JSON y siempre valida la respuesta. Envía `data_collection: deny` para que los proveedores no guarden ni entrenen con los prompts. La clave vive solo en el servidor (`OPENROUTER_API_KEY` en `.env`).
- `ollama`: inferencia real con `qwen3-vl:4b-instruct` (extracción desde foto) y `qwen3:8b` (propuesta de lección con JSON Schema). Si falla, la app avisa y sigue en modo manual.

### Probar OpenRouter

```bash
# en .env: AI_MODE=openrouter y OPENROUTER_API_KEY=sk-or-...
npm run ai:check -w apps/api          # comprueba la clave y el crédito; mide un borrador de lección y el vocabulario
docker compose up -d                  # o reinicia la app para usarlo en la interfaz
```

## Desarrollo local

```bash
npm install
# PostgreSQL 16 local con una base "treoo" (usuario y contraseña treoo/treoo)
npm run db:migrate && npm run db:seed
npm run dev -w apps/api      # API en :3000 (migra al arrancar)
npm run dev -w apps/web      # Vite en :5173, con proxy a /api
npm test                     # 36 tests de integración contra PostgreSQL real (base treoo_test)
```

## Arquitectura

```
apps/api   Fastify 5 + Drizzle ORM + pg + Zod, TypeScript estricto
  src/routes     auth, people, groups, materials, lessons, ai, sessions, exercises, portal, progress
  src/ai         adaptador manual / mock / ollama (el frontend nunca habla con el proveedor)
  drizzle/       migraciones SQL (esquema "treoo"; CREATE SCHEMA IF NOT EXISTS)
apps/web   React 18 + Vite, sin librería de UI; fuentes autoalojadas (funciona sin internet)
```

En producción un solo contenedor sirve la API y el frontend. PostgreSQL y Ollama van en servicios aparte, y los archivos se guardan en el volumen `/data`.

## Estado y límites

- Rama `claude/mvp`: implementación funcional del plan con tests de API y recorrido E2E en navegador. Requiere la revisión del PO, Datos y Arquitectura antes de declararla aceptada.
- No se probó la calidad de Ollama con hojas reales: el adaptador está verificado contra un servidor simulado, falta medir sobre la VM.
- La imagen Docker no se construyó en este entorno (Docker Hub bloqueado). Sí se verificó el mismo build de producción ejecutado desde `dist`.
- Fuera del MVP: facturación por alumno activo, portabilidad de kardex, Vocabulary Lab, Review Centre, calendario con festivos y tutores.
