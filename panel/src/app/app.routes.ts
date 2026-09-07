import type { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/search.component').then((m) => m.SearchComponent),
  },
  {
    path: 'catalogo',
    loadComponent: () => import('./pages/catalog.component').then((m) => m.CatalogComponent),
  },
  {
    path: 'scoreboard',
    loadComponent: () =>
      import('./pages/scoreboard.component').then((m) => m.ScoreboardComponent),
  },
  {
    path: 'ledger',
    loadComponent: () => import('./pages/ledger.component').then((m) => m.LedgerComponent),
  },
  {
    path: 'activo/:symbol',
    loadComponent: () =>
      import('./pages/instrument.component').then((m) => m.InstrumentComponent),
  },
  { path: '**', redirectTo: '' },
];
