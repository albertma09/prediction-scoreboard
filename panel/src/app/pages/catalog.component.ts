import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DataService } from '../data.service';
import type { CatalogEntry, InstrumentCategory } from '../api.types';

interface CategoryDef {
  key: InstrumentCategory;
  label: string;
  short: string;
  blurb: string;
}

interface CategoryGroup extends CategoryDef {
  items: CatalogEntry[];
}

const CATEGORIES: CategoryDef[] = [
  {
    key: 'crypto',
    label: 'Criptomonedas',
    short: 'Criptos',
    blurb: 'Cotizan sin parar, los siete días. Una ventana de 7 días son 7 barras completas.',
  },
  {
    key: 'commodity',
    label: 'Materias primas',
    short: 'Materias primas',
    blurb:
      'Oro, plata y petróleo a través de fondos cotizados que replican su precio. ' +
      'Internamente son ETF, y por eso siguen el calendario de bolsa.',
  },
  {
    key: 'equity',
    label: 'Acciones',
    short: 'Acciones',
    blurb: 'Empresas concretas. Solo cotizan en días de sesión, así que un 7 días son ~5 barras.',
  },
  {
    key: 'etf',
    label: 'ETF y fondos',
    short: 'ETF',
    blurb: 'Cestas de activos: índices, sectores, bonos. Menos bruscos que una acción suelta.',
  },
  {
    key: 'index',
    label: 'Índices',
    short: 'Índices',
    blurb:
      'Referencias de mercado, no productos: no se compran. Para tener exposición se usa un ETF ' +
      'que los replique.',
  },
];

@Component({
  selector: 'app-catalog',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <h1>Catálogo de activos</h1>
    <p class="muted">
      Los {{ all().length }} activos que el sistema tiene cargados, por tipo. Todos son
      consultables; los marcados como puntuados son los únicos que se juegan predicciones cada
      día.
    </p>

    <div class="card">
      <div class="filters" role="group" aria-label="Filtrar por categoría">
        <button
          type="button"
          class="chip"
          [class.chip-on]="active() === null"
          [attr.aria-pressed]="active() === null"
          (click)="setActive(null)"
        >
          Todas <span class="chip-n">{{ all().length }}</span>
        </button>
        @for (cat of categories; track cat.key) {
          <button
            type="button"
            class="chip"
            [class.chip-on]="active() === cat.key"
            [attr.aria-pressed]="active() === cat.key"
            (click)="setActive(cat.key)"
          >
            {{ cat.short }} <span class="chip-n">{{ countOf(cat.key) }}</span>
          </button>
        }
      </div>

      <label for="filter">Filtrar por nombre o símbolo</label>
      <input
        id="filter"
        type="search"
        autocomplete="off"
        placeholder="apple, oro, ibex, sol…"
        [ngModel]="term()"
        (ngModelChange)="term.set($event)"
      />

      <p class="dim" style="margin: 0.5rem 0 0; font-size: 0.82rem;" aria-live="polite">
        {{ shownCount() }} de {{ all().length }} activos ·
        {{ trackedCount() }} con predicciones registradas
      </p>
    </div>

    @if (all().length === 0) {
      <div class="empty">El catálogo aún no se ha publicado.</div>
    }

    @if (all().length > 0 && shownCount() === 0) {
      <div class="empty">Nada coincide con «{{ term() }}».</div>
    }

    @for (group of groups(); track group.key) {
      <section>
        <h2 style="margin-top: 1.75rem;">
          {{ group.label }}
          <span class="dim" style="font-weight: 400; font-size: 0.9rem;"
            >· {{ group.items.length }}</span
          >
        </h2>
        <p class="muted" style="font-size: 0.88rem;">{{ group.blurb }}</p>

        <div class="card scroll-x">
          <table>
            <caption class="dim" style="text-align: left; padding-bottom: 0.5rem;">
              {{ group.label }}: {{ group.items.length }} activos
            </caption>
            <thead>
              <tr>
                <th scope="col">Símbolo</th>
                <th scope="col">Nombre</th>
                <th scope="col">Mercado</th>
                <th scope="col">Moneda</th>
                <th scope="col">Estado</th>
              </tr>
            </thead>
            <tbody>
              @for (item of group.items; track item.slug) {
                <tr>
                  <td>
                    <a class="mono" [routerLink]="['/activo', item.symbol]">{{ item.symbol }}</a>
                  </td>
                  <td>{{ item.name }}</td>
                  <td class="muted">{{ item.exchange ?? '—' }}</td>
                  <td class="muted mono">{{ item.currency }}</td>
                  <td>
                    <span class="badge" [class]="badgeClass(item)">{{ stateLabel(item) }}</span>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    }

    <div class="notice" style="margin-top: 2rem;">
      <strong>Consultable no es lo mismo que medido.</strong> De estos
      {{ all().length }} activos, solo {{ trackedTotal() }} emiten predicciones que quedan
      registradas y luego se puntúan. Para el resto verás una estimación, pero nadie está
      comprobando si acierta: no tienen historial y no aparecen en el
      <a routerLink="/scoreboard">scoreboard</a>.
    </div>
  `,
  styles: [
    `
      .filters {
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
        margin-bottom: 1rem;
      }

      .chip {
        font: inherit;
        font-size: 0.85rem;
        color: var(--muted);
        background: var(--panel-2);
        border: 1px solid var(--border);
        border-radius: 999px;
        padding: 0.35rem 0.75rem;
        cursor: pointer;
      }

      .chip:hover {
        color: var(--text);
        border-color: var(--accent);
      }

      .chip-on {
        color: var(--bg);
        background: var(--accent);
        border-color: var(--accent);
        font-weight: 600;
      }

      .chip-n {
        opacity: 0.75;
        font-variant-numeric: tabular-nums;
      }

      section:first-of-type h2 {
        margin-top: 1rem;
      }
    `,
  ],
})
export class CatalogComponent {
  private readonly api = inject(DataService);

  readonly categories = CATEGORIES;
  readonly all = signal<CatalogEntry[]>([]);
  readonly term = signal('');
  readonly active = signal<InstrumentCategory | null>(null);

  readonly groups = computed<CategoryGroup[]>(() => {
    const needle = this.term().trim().toLowerCase();
    const activeKey = this.active();

    return CATEGORIES.filter((cat) => activeKey === null || cat.key === activeKey)
      .map((cat) => ({
        ...cat,
        items: this.all()
          .filter((item) => item.category === cat.key)
          .filter((item) => needle.length === 0 || this.matches(item, needle))
          .sort(compareEntries),
      }))
      .filter((group) => group.items.length > 0);
  });

  readonly shownCount = computed(() =>
    this.groups().reduce((total, group) => total + group.items.length, 0),
  );

  readonly trackedCount = computed(
    () =>
      this.groups().reduce(
        (total, group) => total + group.items.filter((item) => item.isTracked).length,
        0,
      ),
  );

  readonly trackedTotal = computed(() => this.all().filter((item) => item.isTracked).length);

  constructor() {
    this.api.catalog().subscribe({
      next: (entries) => this.all.set(entries),
      error: () => this.all.set([]),
    });
  }

  setActive(key: InstrumentCategory | null): void {
    this.active.set(key);
  }

  countOf(key: InstrumentCategory): number {
    return this.all().filter((item) => item.category === key).length;
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
      return 'puntuado · sin historial';
    }
    if (item.hasConsultation) {
      return 'consultable';
    }
    return 'sin datos';
  }

  private matches(item: CatalogEntry, needle: string): boolean {
    if (item.symbol.toLowerCase().includes(needle)) {
      return true;
    }
    if (item.name.toLowerCase().includes(needle)) {
      return true;
    }
    return item.aliases.some((alias) => alias.includes(needle));
  }
}

function compareEntries(a: CatalogEntry, b: CatalogEntry): number {
  if (a.isTracked !== b.isTracked) {
    return a.isTracked ? -1 : 1;
  }
  return a.symbol.localeCompare(b.symbol);
}
