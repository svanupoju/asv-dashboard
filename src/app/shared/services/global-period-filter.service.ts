import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export type GlobalPeriodFilter = {
  selections: Record<string, string[]>;
};

@Injectable({
  providedIn: 'root'
})
export class GlobalPeriodFilterService {
  private readonly storageKey = 'globalPeriodFilter';
  private readonly filterSubject = new BehaviorSubject<GlobalPeriodFilter>(this.readInitialFilter());

  readonly filter$ = this.filterSubject.asObservable();

  get currentFilter(): GlobalPeriodFilter {
    return this.filterSubject.value;
  }

  setFilter(filter: GlobalPeriodFilter): void {
    const normalized = {
      selections: this.normalizeSelectionsMap(filter?.selections)
    };

    this.filterSubject.next(normalized);
    sessionStorage.setItem(this.storageKey, JSON.stringify(normalized));
  }

  private readInitialFilter(): GlobalPeriodFilter {
    const raw = sessionStorage.getItem(this.storageKey);
    if (!raw) {
      return { selections: {} };
    }

    try {
      const parsed = JSON.parse(raw);
      const normalizedSelections = this.normalizeSelectionsMap(parsed?.selections);

      if (Object.keys(normalizedSelections).length) {
        return { selections: normalizedSelections };
      }

      const years = this.normalizeSelection(parsed?.years ?? parsed?.year);
      const months = this.normalizeSelection(parsed?.months ?? parsed?.monthOnly);
      const fallbackYear = String(new Date().getFullYear());
      const migratedSelections = (years.length ? years : (months.length ? [fallbackYear] : []))
        .reduce<Record<string, string[]>>((accumulator, year) => {
          accumulator[year] = [...months];
          return accumulator;
        }, {});

      return {
        selections: migratedSelections
      };
    } catch {
      return { selections: {} };
    }
  }

  private normalizeSelection(value: unknown): string[] {
    const items = Array.isArray(value) ? value : [value];
    return [...new Set(items
      .map((item) => String(item ?? '').trim())
      .filter((item) => !!item))];
  }

  private normalizeSelectionsMap(value: unknown): Record<string, string[]> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return Object.entries(value as Record<string, unknown>).reduce<Record<string, string[]>>((accumulator, [year, months]) => {
      const normalizedYear = String(year ?? '').trim();
      if (!normalizedYear) {
        return accumulator;
      }

      accumulator[normalizedYear] = this.normalizeSelection(months);
      return accumulator;
    }, {});
  }
}