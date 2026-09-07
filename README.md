# Prediction Scoreboard

Sistema que emite predicciones probabilísticas sobre mercados financieros y **mide honestamente si acierta**, contra baselines explícitos.

No opera. No mueve dinero. No da consejos de inversión. Es un instrumento de medida.

Contexto y principios de diseño: [CLAUDE.md](CLAUDE.md).
Reglas de emisión y resolución, congeladas: [docs/RESOLUTION-POLICY.md](docs/RESOLUTION-POLICY.md).

## Requisitos

- Node.js 20 o superior
- Docker (para PostgreSQL) o un PostgreSQL 14+ propio

## Arranque

```bash
npm install
cp .env.example .env
docker compose up -d
npm run migrate
npm run seed:instruments
npm run ingest -- --backfill
npm run register-models
```

Panel visual en http://127.0.0.1:3311

```bash
npm run panel:install
npm run panel:build
npm run api
```

Para desarrollar el panel con recarga en caliente, arranca la API en un terminal
(`npm run api`) y el servidor de Angular en otro (`npm run panel:dev`, en el puerto 4200);
el proxy de `panel/proxy.conf.json` redirige `/api` a la API.

Verificar que la base de datos quedó bien:

```bash
docker exec -i scoreboard-db psql -U scoreboard -d prediction_scoreboard -c "\dt"
```

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run migrate` | Aplica las migraciones pendientes |
| `npm run seed:instruments` | Siembra el catálogo de instrumentos |
| `npm run ingest -- --backfill` | Backfill de 3 años de los activos trackeados |
| `npm run ingest` | Ingesta incremental de los activos trackeados |
| `npm run ingest -- SPY NVDA` | Ingesta de instrumentos concretos |
| `npm run promote -- NVDA` | Mete un activo en el universo puntuable y hace su backfill |
| `npm run promote -- NVDA --demote` | Lo saca del universo puntuable |
| `npm run register-models` | Registra los modelos y comprueba la deriva de código |
| `npm run backtest` | Corre el pipeline sobre el histórico y publica BSS y calibración |
| `npm run api` | Arranca la API y sirve el panel compilado |
| `npx tsx src/cli/probe-models.ts` | Muestra qué probabilidad emite cada modelo hoy |
| `npm run verify-ledger` | Verifica la cadena de hashes completa |
| `npm run verify-ledger -- --anchor` | Verifica y escribe el anclaje del día |
| `npm run typecheck` | Comprueba tipos sin emitir |
| `npm test` | Tests unitarios |
| `npx tsx src/cli/probe-providers.ts` | Sonda en vivo los proveedores de precio |
| `npx tsx src/cli/probe-search.ts` | Sonda el buscador de instrumentos |

## Estado

| Módulo | Estado |
|---|---|
| Andamiaje TypeScript | hecho |
| Esquema de BD + inmutabilidad | hecho, verificado |
| Runner de migraciones | hecho, verificado |
| Proveedores de precio (Binance, Yahoo) | hecho, verificado en vivo |
| Catálogo de instrumentos y búsqueda | hecho, verificado |
| Ingesta OHLCV | hecho, verificado |
| Formato canónico de predicción | hecho, verificado |
| Registrador inmutable (cadena de hashes) | hecho, verificado |
| Política de resolución (congelada) | hecho |
| Modelos y baselines (coinflip, climatology, ewmaVol) | hecho, verificado |
| Resolvedor + estado nulo | hecho, verificado |
| Evaluador (Brier, BSS, calibración, bootstrap por bloques) | hecho, verificado |
| Arnés de backtest | hecho, 98.032 observaciones |
| API HTTP | hecho, verificado |
| Panel Angular | hecho, verificado |
| Planificador de emisión con salto de fin de semana | hecho, verificado |
| Consultas precalculadas del catálogo | hecho, verificado |
| Exportador de snapshot JSON | hecho, verificado |
| Panel sin servidor (lee el snapshot) | hecho, verificado |
| Workflows de GitHub Actions | hecho |
| Modelo GARCH(1,1) | pendiente |
| Anclaje externo del hash de cabecera | pendiente (fase 2) |

## Despliegue: GitHub Actions + Neon + Pages

No hace falta ningún servidor. El reparto es:

```
00:05 UTC  GitHub Actions
             ├─ baja precios                 -> PostgreSQL (Neon)
             ├─ emite predicciones           -> ledger sellado con hash
             ├─ resuelve las que vencen      -> resolutions
             ├─ recalcula consultas          -> consultation
             ├─ exporta todo a .json         -> panel/public/data
             └─ compila el panel y publica   -> GitHub Pages
```

El panel es estático: lee ficheros `.json` en lugar de llamar a una API. El mismo código
funciona en local (servido por `npm run api`) y en Pages.

### Secreto necesario

Un único secret de repositorio: `DATABASE_URL`, con la cadena de conexión de Neon. La conexión
eleva automáticamente `sslmode=require` a `verify-full`, así que el certificado se valida sin
depender del valor por defecto del driver.

### Workflows

| Workflow | Cuándo | Qué hace |
|---|---|---|
| `setup.yml` | A mano (workflow_dispatch) | Migraciones, catálogo, modelos, backfill, consultas y backtest. Una sola vez. |
| `daily.yml` | Cron 00:05 UTC · push a main · a mano | El ciclo completo y la publicación del panel. |

La emisión de predicciones (`npm run predict`) se ejecuta **solo en el evento `schedule`**. Un
push a media tarde no debe emitir: el guard lo rechazaría por tardío y además ensuciaría el
histórico de emisiones con un día marcado como saltado que en realidad no lo estaba.

### Limitaciones conocidas de este montaje

**El cron de Actions no es puntual.** Se retrasa cuando GitHub está cargado y a veces se salta
la ejecución. Con la tolerancia de 30 minutos, un retraso mayor produce un día sin emitir. Es la
decisión correcta: un hueco cuesta un día de observaciones, relajar el guard cuesta la
credibilidad del registro. El porcentaje de días saltados se publica en `emissions.json` y en el
panel.

**GitHub desactiva los cron de repos inactivos a los 60 días.** Manda un aviso por correo y se
reactiva con un clic.

**Pages requiere repo público** con cuenta gratuita.

## Garantías de inmutabilidad

La tabla `prediction` y la tabla `resolution` son append-only a nivel de base de datos: triggers `BEFORE UPDATE OR DELETE` rechazan cualquier mutación, incluso ejecutada por el rol propietario.

En `ohlcv_bar` los campos OHLC en crudo son inmutables y el `DELETE` está prohibido; solo `adj_close` puede refrescarse, porque los splits y dividendos cambian el precio ajustado a posteriori. Cada refresco marca `adj_close_updated_at`.

Verificar las garantías contra una base de datos **desechable**:

```bash
docker exec -i scoreboard-db psql -U scoreboard -d prediction_scoreboard -q < db/smoke-immutability.sql
```

Este script inserta filas de prueba en tablas append-only. **No ejecutarlo contra una base de datos con predicciones reales**: las filas de prueba no se pueden borrar. Para limpiar hace falta `docker compose down -v`.

Endurecimiento adicional con un rol de aplicación sin privilegios de propietario:

```bash
docker exec -i scoreboard-db psql -U scoreboard -d prediction_scoreboard -v app_role=scoreboard_app -f - < db/hardening.sql
```

### Cadena de hashes

Cada predicción almacena `content_hash = sha256(payload_canonico)` y `chain_hash = sha256(prev_hash || content_hash)`. La cadena arranca en un hash génesis de 64 ceros y `ledger_head` guarda la cabecera actual bajo un `SELECT ... FOR UPDATE`, de forma que dos emisiones concurrentes no pueden ramificar la cadena.

`npm run verify-ledger` recalcula la cadena completa y detecta:

| Manipulación | Cómo se detecta |
|---|---|
| Payload alterado | `content_hash_mismatch` |
| Payload y su hash recalculados | `chain_hash_mismatch` |
| Fila entera recalculada | `prev_hash_mismatch` en la siguiente |
| Fila eliminada o reordenada | `prev_hash_mismatch` |
| Fila borrada del final | `head_mismatch` / `count_mismatch` |
| **Columna reescrita sin tocar el payload** | `column_mismatch` |

La última fila de esa tabla es importante: el hash cubre el payload, pero el evaluador y el panel leen las **columnas**. Sin el cruce columna-payload, alguien con privilegios podría cambiar lo que el scoreboard reporta y la cadena seguiría verificando como intacta.

Demostración completa del ataque, contra una base de datos desechable:

```bash
docker exec -i scoreboard-db psql -U scoreboard -d postgres -c "create database scoreboard_demo owner scoreboard"
DATABASE_URL="postgres://scoreboard:scoreboard_dev@localhost:5433/scoreboard_demo" npx tsx src/cli/demo-ledger.ts
docker exec -i scoreboard-db psql -U scoreboard -d postgres -c "drop database scoreboard_demo"
```

### Guardas de emisión

`append()` rechaza:

- Una ventana que ya está cerrada — nada se registra sobre un periodo pasado.
- Un `t0` que no sea medianoche UTC exacta (slot canónico).
- Un `t0` en el futuro.
- Una emisión más de 30 minutos después de abrirse el slot, porque emitir con retraso permitiría ver parte del movimiento a predecir. La tolerancia es un parámetro de la llamada, no una variable de entorno, para que ninguna configuración pueda relajarla por accidente.

A nivel de base de datos, `prediction_unique_emission` impide una segunda predicción del mismo modelo sobre el mismo evento y la misma ventana: una predicción emitida no se puede "corregir".

Límite conocido: los triggers y los `REVOKE` detienen a la aplicación, no a un superusuario de PostgreSQL. Lo que la cadena garantiza frente a un superusuario es la **detección**, no la prevención. La demostrabilidad ante terceros requiere anclaje externo del hash de cabecera (fase 2).

## Catálogo de instrumentos

El universo se divide en dos capas:

- **Universo puntuable** (`is_tracked = true`): activos sobre los que el cron emite predicciones pre-registradas. De aquí, y solo de aquí, sale el Brier Skill Score.
- **Catálogo buscable**: todo lo demás. Se puede buscar, pero no lleva predicciones asociadas y la interfaz debe mostrarlo como *sin historial puntuado*.

Promover un activo de la segunda capa a la primera es `npm run promote -- <SIMBOLO>`, que activa el flag y lanza el backfill.

La semilla trae 89 instrumentos con 316 alias. Una búsqueda sin resultados locales cae al buscador del proveedor y persiste los hallazgos en el catálogo, así que crece con el uso.

## Proveedores de precio

| Clase de activo | Proveedor | Notas |
|---|---|---|
| crypto | Binance klines públicas | Sin clave. Cierre de vela diaria 00:00 UTC. |
| equity, etf, index | Yahoo Finance `chart` | Sin clave, cobertura amplia. **Endpoint no oficial**: sin SLA ni licencia clara. |
| fx | Yahoo Finance `chart` | **No usable para puntuar** — ver abajo. |

### Por qué FX está excluido del universo puntuable

En las series `=X` de Yahoo, el 73% de las barras diarias tienen `open == close`. El "cierre" no es un cierre real, es el mismo snapshot que la apertura. Cualquier predicción de magnitud o dirección calculada sobre esa serie mediría un artefacto del proveedor, no el mercado.

La clase de activo `fx` existe en el esquema, pero no entra al universo puntuable hasta tener una fuente con cierres reales.

## Licenciamiento de datos

El endpoint de Yahoo es gratuito y no requiere clave, pero **no es una API oficial**. Puede cambiar o dejar de responder sin aviso, y su uso comercial no está licenciado.

Toda la lectura de precios pasa por la interfaz `PriceProvider` ([src/providers/PriceProvider.ts](src/providers/PriceProvider.ts)) precisamente para poder sustituir el proveedor sin tocar el motor. Si el proyecto llega a producto de pago, hay que licenciar datos (Twelve Data u similar).
