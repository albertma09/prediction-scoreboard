import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DataService } from '../data.service';
import type { CatalogEntry, MetaResponse, SearchHit } from '../api.types';

@Component({
  selector: 'app-search',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <h1>Buscar un activo</h1>
    <p class="muted">
      Acciones, ETF, índices y criptomonedas. Busca por nombre o por símbolo; tolera erratas.
    </p>

    <div class="card">
      <label for="q">Nombre o símbolo</label>
      <input
        id="q"
        type="search"
        autocomplete="off"
        placeholder="bitcoin, nvidia, sp 500, oro, ibex, inditex…"
        [ngModel]="term()"
        (ngModelChange)="onTerm($event)"
      />
      @if (meta(); as info) {
        <p class="dim" style="margin: 0.5rem 0 0; font-size: 0.82rem;">
          {{ info.instruments }} activos en el catálogo · {{ info.trackedInstruments }} con
          predicciones registradas · datos del {{ info.generatedAt.slice(0, 10) }}
        </p>
      }
    </div>

    <div aria-live="polite" aria-atomic="true">
      @if (term().trim().length > 0 && results().length === 0) {
        <div class="empty">Sin resultados para «{{ term() }}».</div>
      }

      @if (results().length > 0) {
        <div class="card scroll-x">
          <table>
            <caption class="dim" style="text-align: left; padding-bottom: 0.5rem;">
              {{ results().length }} resultados
            </caption>
            <thead>
              <tr>
                <th scope="col">Símbolo</th>
                <th scope="col">Nombre</th>
                <th scope="col">Clase</th>
                <th scope="col">Mercado</th>
                <th scope="col">Estado</th>
              </tr>
            </thead>
            <tbody>
              @for (item of results(); track item.slug) {
                <tr>
                  <td>
                    <a class="mono" [routerLink]="['/activo', item.symbol]">{{ item.symbol }}</a>
                  </td>
                  <td>{{ item.name }}</td>
                  <td class="muted">{{ item.assetClass }}</td>
                  <td class="muted">{{ item.exchange ?? '—' }}</td>
                  <td>
                    <span class="badge" [class]="badgeClass(item)">{{ stateLabel(item) }}</span>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>

    <h2 style="margin-top: 2rem;">Universo puntuable</h2>
    <p class="muted">
      Los únicos activos sobre los que se emiten predicciones registradas cada día. De aquí, y
      solo de aquí, sale el track record.
    </p>

    @if (tracked().length > 0) {
      <div class="card scroll-x">
        <table>
          <thead>
            <tr>
              <th scope="col">Símbolo</th>
              <th scope="col">Nombre</th>
              <th scope="col">Clase</th>
              <th scope="col" class="num">Predicciones puntuadas</th>
            </tr>
          </thead>
          <tbody>
            @for (item of tracked(); track item.slug) {
              <tr>
                <td>
                  <a class="mono" [routerLink]="['/activo', item.symbol]">{{ item.symbol }}</a>
                </td>
                <td>{{ item.name }}</td>
                <td class="muted">{{ item.assetClass }}</td>
                <td class="num" [class.warn]="item.scoredCount === 0">
                  {{ item.scoredCount }}
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }

    <div class="notice" style="margin-top: 1.5rem;">
      <strong>Lo que este sistema no hace:</strong> no predice si un activo subirá o bajará. Con
      más de 4.000 observaciones medidas, acertar la dirección no se le da mejor que a una moneda
      al aire, y eso está publicado en el
      <a routerLink="/scoreboard">scoreboard</a>. Lo que sí estima es la
      <strong>magnitud</strong> del movimiento: si va a haber sacudida o calma.
    </div>
  `,
})
export class SearchComponent {
  private readonly data = inject(DataService);

  readonly term = signal('');
  readonly results = signal<SearchHit[]>([]);
  readonly tracked = signal<CatalogEntry[]>([]);
  readonly meta = signal<MetaResponse | null>(null);

  constructor() {
    this.data.tracked().subscribe({
      next: (entries) => this.tracked.set(entries),
      error: () => this.tracked.set([]),
    });

    this.data.meta().subscribe({
      next: (info) => this.meta.set(info),
      error: () => this.meta.set(null),
    });
  }

  onTerm(value: string): void {
    this.term.set(value);
    if (value.trim().length === 0) {
      this.results.set([]);
      return;
    }
    this.data.search(value, 12).subscribe({
      next: (hits) => this.results.set(hits),
      error: () => this.results.set([]),
    });
  }

  badgeClass(item: CatalogEntry): string {
    if (item.isTracked && item.scoredCount > 0) {
      return 'badge-tracked';
    }
    if (item.isTracked) {
      return 'badge-empty';
    }
    return 'badge-none';
  }

  stateLabel(item: CatalogEntry): string {
    if (item.isTracked && item.scoredCount > 0) {
      return `${item.scoredCount} puntuadas`;
    }
    if (item.isTracked) {
      return 'trackeado · sin historial';
    }
    if (item.hasConsultation) {
      return 'consulta · sin historial';
    }
    return 'sin datos';
  }
}
