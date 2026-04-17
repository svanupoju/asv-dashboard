import { Component, ElementRef, EventEmitter, HostListener, Input, OnInit, Output, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
import { getApps, initializeApp } from 'firebase/app';
import { getAuth, signOut } from 'firebase/auth';
import { environment } from '../../../environments/environment';
import { GlobalPeriodFilterService } from '../services/global-period-filter.service';

@Component({
  selector: 'app-header',
  templateUrl: './header.component.html',
  styleUrls: ['./header.component.scss']
})
export class HeaderComponent implements OnInit {
  @Input() sidebarCollapsed = false;
  @Output() toggleSidebar = new EventEmitter<void>();
  @ViewChild('periodFilterRoot') periodFilterRoot?: ElementRef<HTMLElement>;
  dropdownOpen = false;
  userName: string | null = null;
  readonly months: string[] = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  readonly years: string[] = this.buildYearOptions();
  selectedPeriodsByYear: Record<string, string[]> = {};
  activeYear = '';
  periodMenuOpen = false;

  constructor(
    public router: Router,
    private readonly globalPeriodFilterService: GlobalPeriodFilterService,
    private readonly elementRef: ElementRef<HTMLElement>
  ) {}

  ngOnInit() {
    const token = sessionStorage.getItem('token');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        this.userName = payload && payload.name ? payload.name : null;
      } catch (e) {
        this.userName = null;
      }
    }

    const filter = this.globalPeriodFilterService.currentFilter;
    this.selectedPeriodsByYear = this.cloneSelections(filter.selections);
    this.activeYear = this.selectedYears[0] ?? '';
  }

  onToggleSidebar() {
    this.toggleSidebar.emit();
  }

  toggleDropdown() {
    this.dropdownOpen = !this.dropdownOpen;
  }

  closeDropdown() {
    this.dropdownOpen = false;
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as Node | null;
    const isInsidePeriodFilter = !!target && !!this.periodFilterRoot?.nativeElement.contains(target);

    if (!isInsidePeriodFilter) {
      this.periodMenuOpen = false;
    }

    if (!this.elementRef.nativeElement.contains(event.target as Node)) {
      this.closeDropdown();
    }
  }

  async logout() {
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('email');
    sessionStorage.removeItem('googleAccessToken');

    try {
      if (!getApps().length) initializeApp(environment.firebase);
      await signOut(getAuth());
    } catch (e) {
      console.warn('Firebase signOut failed:', e);
    }

    this.closeDropdown();
    this.router.navigate(['/login'], { queryParams: { logout: '1' } });
  }

  capitalizeName(name: string): string {
    return name.replace(/\b\w/g, c => c.toUpperCase());
  }

  onGlobalPeriodChange(): void {
    this.globalPeriodFilterService.setFilter({
      selections: this.selectedPeriodsByYear
    });
  }

  togglePeriodMenu(event?: Event): void {
    event?.stopPropagation();
    this.periodMenuOpen = !this.periodMenuOpen;
    if (this.periodMenuOpen && !this.activeYear) {
      this.activeYear = this.selectedYears[0] ?? this.years[0] ?? '';
    }
  }

  selectOrFocusYear(year: string, event?: Event): void {
    event?.stopPropagation();
    const isSelected = this.isYearSelected(year);

    if (!isSelected) {
      this.selectedPeriodsByYear = {
        ...this.selectedPeriodsByYear,
        [year]: []
      };
      this.onGlobalPeriodChange();
    }

    this.activeYear = year;
  }

  removeYearSelection(year: string, event?: Event): void {
    event?.stopPropagation();
    const { [year]: removed, ...remaining } = this.selectedPeriodsByYear;
    void removed;
    this.selectedPeriodsByYear = remaining;

    if (this.activeYear === year) {
      this.activeYear = this.selectedYears[0] ?? '';
    }

    this.onGlobalPeriodChange();
  }

  toggleMonthSelection(month: string, event?: Event): void {
    event?.stopPropagation();
    const targetYear = this.activeYear || this.selectedYears[0] || String(new Date().getFullYear());
    const existingMonths = [...(this.selectedPeriodsByYear[targetYear] ?? [])];
    const nextMonths = existingMonths.includes(month)
      ? existingMonths.filter((item) => item !== month)
      : this.months.filter((item) => item === month || existingMonths.includes(item));

    this.selectedPeriodsByYear = {
      ...this.selectedPeriodsByYear,
      [targetYear]: nextMonths
    };
    this.activeYear = targetYear;
    this.onGlobalPeriodChange();
  }

  clearAllSelections(event?: Event): void {
    event?.stopPropagation();
    this.selectedPeriodsByYear = {};
    this.activeYear = '';
    this.onGlobalPeriodChange();
    this.periodMenuOpen = false;
  }

  clearMonthsForActiveYear(event?: Event): void {
    event?.stopPropagation();
    if (!this.activeYear || !this.isYearSelected(this.activeYear)) {
      return;
    }

    this.selectedPeriodsByYear = {
      ...this.selectedPeriodsByYear,
      [this.activeYear]: []
    };
    this.onGlobalPeriodChange();
  }

  isYearSelected(year: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.selectedPeriodsByYear, year);
  }

  isYearActive(year: string): boolean {
    return this.activeYear === year;
  }

  isMonthSelectedForActiveYear(month: string): boolean {
    return this.activeYear ? (this.selectedPeriodsByYear[this.activeYear] ?? []).includes(month) : false;
  }

  get selectedYears(): string[] {
    return Object.keys(this.selectedPeriodsByYear).sort((left, right) => Number(right) - Number(left));
  }

  get selectedPeriodsLabel(): string {
    const years = this.selectedYears;
    if (!years.length) {
      return 'All Years';
    }

    const summaries = years.map((year) => {
      const months = this.selectedPeriodsByYear[year] ?? [];
      return months.length ? `${year} (${this.buildSelectionLabel(months, 'All Months')})` : `${year} (All Months)`;
    });

    return this.buildSelectionLabel(summaries, 'All Years');
  }

  get activeYearMonthsLabel(): string {
    if (!this.activeYear || !this.isYearSelected(this.activeYear)) {
      return 'Select a year';
    }

    return this.buildSelectionLabel(this.selectedPeriodsByYear[this.activeYear] ?? [], 'All Months');
  }

  private buildYearOptions(): string[] {
    const currentYear = new Date().getFullYear();
    return Array.from({ length: 16 }, (_, index) => String(currentYear - index));
  }

  private cloneSelections(selections: Record<string, string[]> | null | undefined): Record<string, string[]> {
    return Object.entries(selections ?? {}).reduce<Record<string, string[]>>((accumulator, [year, months]) => {
      accumulator[String(year ?? '').trim()] = Array.isArray(months) ? [...months] : [];
      return accumulator;
    }, {});
  }

  private buildSelectionLabel(values: string[], fallback: string): string {
    if (!values.length) {
      return fallback;
    }

    if (values.length <= 2) {
      return values.join(', ');
    }

    return `${values[0]}, ${values[1]} +${values.length - 2}`;
  }
}
