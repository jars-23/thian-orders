# Plan: <título>

## Contexto
Qué se pide y por qué, con las cifras de partida y su fuente («medido: …» o «no verificado»).

## 1 · Secuencia
Diagrama mermaid `sequenceDiagram` SOLO si el flujo cruza más de 2 componentes
(p. ej. SPA → RPC → trigger).

## 2 · Pasos
1. …
2. …

## 3 · Qué se toca
| Fichero | Componente / función / objeto SQL | Lectura o escritura | Riesgo |
|---|---|---|---|
| | | | |

**No se toca:** (decirlo expresamente: RLS, firmas de RPC, esquema, etc.)

## 4 · Prueba manual
- **Antes (falla):** pasos para reproducir el problema.
- **Después (pasa):** pasos para comprobar el arreglo.
- **Regresión:** zonas vecinas que revisar.
- **Datos:** usuarios por rol, pedidos y productos de prueba.

## 5 · Marcha atrás
- Código: `git restore <fichero>` o `git revert <commit>`.
- SQL: script de reversión incluido en la migración (lo ejecuta el usuario).

## Terminado
- [ ] Compila (`npm run build`)
- [ ] Diff revisado
- [ ] Guía manual entregada
- [ ] Bitácora escrita en [[bitacora/]]
- [ ] Sin librerías nuevas, o escaneadas con `npm audit`

Ver también: [[trampas]] · [[arquitectura]]
