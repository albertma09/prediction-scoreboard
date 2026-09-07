import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { switchMap, of } from 'rxjs';
import { DataService } from '../data.service';
import type { ConsultationView, InstrumentResponse, PriceBar } from '../api.types';

@Component({
  selector: 'app-instrument',
  standalone: true,
  imports: [RouterLink],
  template: `
    @if (error()) {
      <h1>Activo no encontrado</h1>
      <div class="notice notice-strong">{{ error() }}</div>
      <p><a routerLink="/">Volver al buscador</a></p>
    } @else {
      @if (data(); as payload) {
        <h1>
          <span class="mono">{{ payload.instrument.symbol }}</span> ·
          {{ payload.instrument.name }}
        </h1>
        <p class="muted">
          {{ payload.instrument.assetClass }} ·
          {{ payload.instrument.exchange ?? 'sin mercado declarado' }} ·
          {{ payload.instrument.currency }} · datos de {{ payload.instrument.provider }}
        </p>

        <h2 style="margin-top: 1.5rem;">Qué estima el sistema</h2>

        @if (!payload.consultation.available) {
          <div class="empty">
            Sin datos suficientes para estimar nada sobre este activo.
          </div>
        } @else {
          <div class="card">
            @for (view of magnitudeViews(); track view.eventKey + view.horizon) {
              <div class="estimate">
                <div class="estimate-text">
                  <strong>{{ horizonLabel(view.horizon) }}</strong>
                  se mueva más de
                  <strong class="mono">{{ thresholdPct(view) }}</strong>
                  (arriba o abajo)
                </div>
                <div class="estimate-value">
                  <span class="prob">{{ (view.probability * 100).toFixed(0) }}%</span>
                  @if (view.climatologyProbability !== null) {
                    <span class="dim">
                      histórico {{ (view.climatologyProbability * 100).toFixed(0) }}%
                    </span>
                  }
                </div>
              </div>
            }

            @for (view of volatilityViews(); track view.eventKey + view.horizon) {
              <div class="estimate">
                <div class="estimate-text">
                  <strong>{{ horizonLabel(view.horizon) }}</strong>
                  haya más movimiento que en el periodo anterior
                </div>
                <div class="estimate-value">
                  <span class="prob">{{ (view.probability * 100).toFixed(0) }}%</span>
                  @if (view.climatologyProbability !== null) {
                    <span class="dim">
                      histórico {{ (view.climatologyProbability * 100).toFixed(0) }}%
                    </span>
                  }
                </div>
              </div>
            }

            <div class="estimate estimate-off">
              <div class="estimate-text">
                <strong>Dirección: ¿subirá o bajará?</strong>
              </div>
              <div class="estimate-value">
                <span class="dim">el sistema no lo predice</span>
              </div>
            </div>

            @if (consultationStamp(); as stamp) {
              <p class="dim" style="margin: 0.9rem 0 0; font-size: 0.8rem;">
                Calculado el {{ stamp.computedAt }} con cierres hasta el
                {{ stamp.baseBarDate }}. «Histórico» es la frecuencia con la que ese evento ha
                ocurrido de verdad en el pasado: el listón mínimo.
              </p>
            }
          </div>

          @if (!payload.instrument.isTracked) {
            <div class="notice">
              <strong>Consulta sin historial.</strong> Este activo no está en el universo
              puntuable: las cifras de arriba se calculan con el mismo código, pero
              <strong>nunca se han registrado ni comprobado para este activo</strong>, así que
              nadie sabe —tú tampoco— si el sistema acierta aquí. Para que empiece a acumular
              historial hay que meterlo al universo puntuable.
            </div>
          } @else if (payload.ledger.scoredCount === 0) {
            <div class="notice">
              <strong>Trackeado, sin historial puntuado todavía.</strong> Se emiten predicciones
              registradas sobre este activo, pero aún no hay ninguna resuelta.
            </div>
          }
        }

        <h2 style="margin-top: 1.75rem;">Precio ajustado</h2>
        @if (prices().length < 2) {
          <div class="empty">Sin serie de precios cargada.</div>
        } @else {
          <div class="card">
            <div class="scroll-x">
              <svg
                viewBox="0 0 900 260"
                width="900"
                height="260"
                role="img"
                [attr.aria-label]="priceSummary()"
              >
                <rect x="50" y="10" width="830" height="200" fill="#0e1116" stroke="#2d3542" />
                <polyline
                  [attr.points]="pricePolyline()"
                  fill="none"
                  stroke="#4a9eff"
                  stroke-width="1.75"
                />
                <text x="46" y="18" fill="#9aa7b4" font-size="11" text-anchor="end">
                  {{ maxPrice().toFixed(2) }}
                </text>
                <text x="46" y="212" fill="#9aa7b4" font-size="11" text-anchor="end">
                  {{ minPrice().toFixed(2) }}
                </text>
                <text x="50" y="232" fill="#9aa7b4" font-size="11">{{ firstDate() }}</text>
                <text x="880" y="232" fill="#9aa7b4" font-size="11" text-anchor="end">
                  {{ lastDate() }}
                </text>
                <text x="465" y="252" fill="#6e7d8c" font-size="11" text-anchor="middle">
                  {{ prices().length }} cierres diarios ajustados
                </text>
              </svg>
            </div>
            <p class="muted" style="margin: 0; font-size: 0.85rem;">
              Último cierre ajustado:
              <span class="mono">{{ lastClose().toFixed(4) }}</span> ({{ lastDate() }})
            </p>
          </div>
        }

        <h2 style="margin-top: 1.75rem;">Predicciones registradas</h2>
        @if (payload.ledger.predictions.length === 0) {
          <div class="empty">Ninguna predicción en el registro inmutable para este activo.</div>
        } @else {
          <p class="muted">
            {{ payload.ledger.scoredCount }} puntuadas de
            {{ payload.ledger.predictions.length }} mostradas, las más recientes primero.
            <strong>Los fallos están a la vista.</strong>
          </p>
          <div class="card scroll-x">
            <table>
              <thead>
                <tr>
                  <th scope="col">Emitida</th>
                  <th scope="col">Evento</th>
                  <th scope="col">Horiz.</th>
                  <th scope="col">Modelo</th>
                  <th scope="col" class="num">P</th>
                  <th scope="col">Cierra</th>
                  <th scope="col">Resultado</th>
                  <th scope="col">Hash</th>
                </tr>
              </thead>
              <tbody>
                @for (row of payload.ledger.predictions; track row.id) {
                  <tr>
                    <td class="mono muted">{{ row.t0Utc.slice(0, 10) }}</td>
                    <td class="mono">{{ row.eventKey }}</td>
                    <td class="mono">{{ row.horizon }}</td>
                    <td>{{ row.model }}</td>
                    <td class="num mono">{{ row.probability.toFixed(3) }}</td>
                    <td class="mono muted">{{ row.windowEndUtc.slice(0, 10) }}</td>
                    <td>
                      @if (row.voidReason) {
                        <span class="badge badge-none">nula · {{ row.voidReason }}</span>
                      } @else if (row.outcome === null) {
                        <span class="badge badge-empty">pendiente</span>
                      } @else if (row.outcome === 1) {
                        <span class="badge badge-tracked">ocurrió</span>
                      } @else {
                        <span class="badge">no ocurrió</span>
                      }
                    </td>
                    <td class="mono dim">{{ row.chainHash.slice(0, 10) }}…</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }

        @if (payload.backtest; as backtest) {
          @if (backtest.rows.length > 0) {
            <h2 style="margin-top: 1.75rem;">
              Backtest de este activo
              <span class="badge badge-backtest">no es historial</span>
            </h2>
            <div class="card scroll-x">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Horiz.</th>
                    <th scope="col">Evento</th>
                    <th scope="col">Modelo</th>
                    <th scope="col" class="num">N</th>
                    <th scope="col" class="num">Tasa base</th>
                    <th scope="col" class="num">Brier medio</th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of backtest.rows; track row.horizon + row.eventKey + row.modelKey) {
                    <tr>
                      <td class="mono">{{ row.horizon }}</td>
                      <td class="mono">{{ row.eventKey }}</td>
                      <td>{{ row.modelKey }}</td>
                      <td class="num">{{ row.count }}</td>
                      <td class="num muted">{{ (row.baseRate * 100).toFixed(2) }}%</td>
                      <td class="num mono">{{ row.meanBrier.toFixed(4) }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        }
      } @else {
        <p class="muted">Cargando…</p>
      }
    }
  `,
  styles: [
    `
      .estimate {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem 1rem;
        align-items: baseline;
        justify-content: space-between;
        padding: 0.7rem 0;
        border-bottom: 1px solid var(--border);
      }

      .estimate:last-of-type {
        border-bottom: none;
      }

      .estimate-text {
        flex: 1 1 16rem;
        font-size: 0.95rem;
      }

      .estimate-value {
        display: flex;
        align-items: baseline;
        gap: 0.6rem;
      }

      .prob {
        font-size: 1.45rem;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        color: var(--accent);
      }

      .estimate-off .estimate-text strong {
        color: var(--muted);
        font-weight: 600;
      }

      .dim {
        font-size: 0.82rem;
      }
    `,
  ],
})
export class InstrumentComponent {
  private readonly api = inject(DataService);
  private readonly route = inject(ActivatedRoute);

  readonly payloadSignal = signal<InstrumentResponse | null>(null);
  readonly error = signal<string | null>(null);

  data(): InstrumentResponse | null {
    return this.payloadSignal();
  }

  readonly prices = computed<PriceBar[]>(() => this.payloadSignal()?.prices ?? []);

  readonly maxPrice = computed(() => {
    const values = this.prices().map((bar) => bar.adjClose);
    return values.length === 0 ? 0 : Math.max(...values);
  });

  readonly minPrice = computed(() => {
    const values = this.prices().map((bar) => bar.adjClose);
    return values.length === 0 ? 0 : Math.min(...values);
  });

  readonly pricePolyline = computed(() => {
    const bars = this.prices();
    if (bars.length < 2) {
      return '';
    }
    const min = this.minPrice();
    const span = this.maxPrice() - min || 1;
    return bars
      .map((bar, index) => {
        const x = 50 + (index / (bars.length - 1)) * 830;
        const y = 210 - ((bar.adjClose - min) / span) * 200;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  });

  readonly firstDate = computed(() => this.prices()[0]?.barDate ?? '');
  readonly lastDate = computed(() => this.prices()[this.prices().length - 1]?.barDate ?? '');
  readonly lastClose = computed(() => this.prices()[this.prices().length - 1]?.adjClose ?? 0);

  readonly priceSummary = computed(() => {
    const bars = this.prices();
    if (bars.length < 2) {
      return 'Sin serie de precios';
    }
    return (
      `Serie de ${bars.length} cierres ajustados entre ${this.firstDate()} y ${this.lastDate()}. ` +
      `Mínimo ${this.minPrice().toFixed(2)}, máximo ${this.maxPrice().toFixed(2)}, ` +
      `último ${this.lastClose().toFixed(2)}.`
    );
  });

  readonly consultationStamp = computed(() => {
    const first = this.payloadSignal()?.consultation.views[0];
    if (first === undefined) {
      return null;
    }
    return {
      computedAt: first.computedAt.slice(0, 10),
      baseBarDate: first.baseBarDate,
    };
  });

  readonly magnitudeViews = computed(() =>
    (this.payloadSignal()?.consultation.views ?? [])
      .filter((view) => view.eventType === 'MAG')
      .sort((a, b) => a.horizon.localeCompare(b.horizon) || a.eventKey.localeCompare(b.eventKey)),
  );

  readonly volatilityViews = computed(() =>
    (this.payloadSignal()?.consultation.views ?? [])
      .filter((view) => view.eventType === 'VOL')
      .sort((a, b) => a.horizon.localeCompare(b.horizon)),
  );

  constructor() {
    this.route.paramMap
      .pipe(
        switchMap((params) => {
          this.error.set(null);
          this.payloadSignal.set(null);
          const symbol = params.get('symbol') ?? '';
          return this.api.slugFor(symbol).pipe(
            switchMap((slug) => {
              if (slug === null) {
                this.error.set(`«${symbol}» no está en el catálogo de activos.`);
                return of(null);
              }
              return this.api.instrument(slug);
            }),
          );
        }),
      )
      .subscribe({
        next: (payload) => {
          if (payload !== null) {
            this.payloadSignal.set(payload);
          }
        },
        error: () => this.error.set('No se pudieron cargar los datos de este activo.'),
      });
  }

  horizonLabel(horizon: string): string {
    return horizon === '1d' ? 'Que mañana' : 'Que esta semana';
  }

  thresholdPct(view: ConsultationView): string {
    const threshold = view.eventParams['thresholdAbs'];
    const value = typeof threshold === 'number' ? threshold : Number(threshold);
    return Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : '—';
  }
}
