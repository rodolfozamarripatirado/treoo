# Preparación de commit — US-A-003 corregido

## 1. Qué se va a commitar

Contenido actualmente stageado sobre `91799ad` en la rama
`Treoo/freebuff/T-A-002-contract`:

- `A-contract/US-A-003/contract.md`
- `A-contract/US-A-003/dto-validators.md`
- `A-contract/US-A-003/migration-seed.sql`
- `A-contract/US-A-003/r3-resolution-matrix.md`
- `A-contract/US-A-003/test-scenarios-report.md`
- `A-contract/US-A-003/draft-sequelize-integration.md`
- `A-contract/US-A-003/draft-stack-position.md`

Cifras del stage actual:
- 7 archivos nuevos
- 1084 líneas añadidas, 0 eliminadas

El árbol de `HEAD` permanece en `91799ad`; este commit no modifica ese SHA.

## 2. Qué NO está en el commit

- No hay cambios en `README.md`, ni en la ruta anterior
  `A-contract/draft/CONTRACT-US-A-003-v2.md`, ni en
  `treoo/local/A-contract/...`.
- No hay código de aplicación, migración ejecutada ni seed corrido.
- No se leyieron ni imprimieron valores secretos de los ficheros de configuración.

## 3. Estado previo al commit

- Conflicto a resolver antes de continuar si el branch remoto ha avanzado desde
  el último fetch del agente.
- Si Arquitectura desea añadir más artefactos, esos irían en el mismo tema o en
  commit siguiente, no en este histórico existente.

## 4. Mensaje de commit sugerido

```
Corrigir paquete US-A-003 según R3 y propuesta AGT-DATA-001

- Contrato corregido: ámbito academia, borrador mínimo DEC-A-002, duración
  opcional/fraccionaria, estado/preview separados, revisión atómica,
  dedup y eliminación de residuos.
- DTO y validadores corregidos con reglas opcionales explícitas y regla
  numérica de duración compatible FE/BE.
- DDL propuesto, migración y seed propuestos como artefactos físicos
  separados (NO EJECUTADOS, NO APROBADOS).
- Matriz de resolución R3 y casos de prueba propuestos.
- Notas de puente técnico sin decidir stack.

Base: 91799ad. No ejecutar SQL todavía. Pendiente revisión
Arquitectura/Datos/Cian y decisión sobre sesión/API/retry.
```

## 5. Verificación post-commit sugerida

- `git log --oneline -n 2` mostrar nuevo commit sobre `91799ad`.
- `git status --short` dejar `A-contract/US-A-003/` limpio o stageado
  según correcciones.
- Confirmar que no se subió secretos.

## 6. Pendiente

- Merge/Solicitar revisión en la rama contratada, no en main sin revisión.
- Esperar borradores/posturas de Arquitectura/Datos/Cian antes de migración.