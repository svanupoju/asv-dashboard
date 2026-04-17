import { Component, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { getApps, initializeApp } from 'firebase/app';
import { getFirestore, collection, query, orderBy, onSnapshot, addDoc, where, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { getAuth, onAuthStateChanged, User } from 'firebase/auth';
import { environment } from '../../../environments/environment';
import { GlobalPeriodFilterService } from '../../shared/services/global-period-filter.service';
import { normalizeAppEmail } from '../../shared/utils/email-alias.util';

type PlacementRow = {
  id?: string;
  name: string;
  company: string;
  package: string;
  charged: string;
  monthOnly: string;
  year: number | string;
  date: string;
  email: string;
};

@Component({
  selector: 'app-placement-assistance',
  templateUrl: './placement-assistance.component.html',
  styleUrls: ['./placement-assistance.component.scss']
})
export class PlacementAssistanceComponent implements OnDestroy {
  months: string[] = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  firestore;
  user: User | null = null;
  userEmail: string | null = null;
  authChecked = false;

  showAddRow = false;
  rowAddInProgress = false;
  rowAddError: string | null = null;
  deletingRowId: string | null = null;
  editingRowId: string | null = null;
  savingRowId: string | null = null;

  editRow: PlacementRow = this.createEmptyEditRow();

  placementTable: PlacementRow[] = [];
  filteredTable: PlacementRow[] = [];

  newRow: any = {
    name: '',
    company: '',
    package: '',
    charged: '',
    monthOnly: '',
    year: '',
    date: ''
  };

  filters: any = {
    name: '',
    company: '',
    package: '',
    charged: '',
    monthOnly: '',
    year: '',
    date: ''
  };

  sortColumn = 'date';
  sortDirection: 'asc' | 'desc' = 'desc';

  uniqueOptions: any = {
    name: [],
    company: [],
    package: [],
    charged: [],
    monthOnly: [],
    year: [],
    date: []
  };
  globalFilterSelections: Record<string, string[]> = {};
  private globalFilterSubscription?: Subscription;

  constructor(private readonly globalPeriodFilterService: GlobalPeriodFilterService) {
    if (!getApps().length) {
      initializeApp(environment.firebase);
    }

    this.firestore = getFirestore();

    const now = new Date();
    this.newRow.monthOnly = this.months[now.getMonth()];
    this.newRow.year = now.getFullYear();
    this.newRow.date = this.computeLastWorkingDayIso(now.getFullYear(), now.getMonth());

    this.globalFilterSubscription = this.globalPeriodFilterService.filter$.subscribe((filter) => {
      this.globalFilterSelections = this.cloneGlobalFilterSelections(filter?.selections);
      this.setUniqueOptions();
      this.applyFilters();
    });

    onAuthStateChanged(getAuth(), (user) => {
      this.user = user;
      this.authChecked = true;
      this.userEmail = normalizeAppEmail(user?.email);

      if (this.userEmail) {
        this.loadRows();
      } else {
        this.placementTable = [];
        this.filteredTable = [];
        this.setUniqueOptions();
        this.applyFilters();
      }
    });
  }

  ngOnDestroy(): void {
    this.globalFilterSubscription?.unsubscribe();
  }

  loadRows() {
    if (!this.userEmail) return;

    const rowsRef = collection(this.firestore, 'placementAssisted');
    const rowsQuery = query(rowsRef, where('email', '==', this.userEmail), orderBy('date', 'desc'));

    onSnapshot(
      rowsQuery,
      (snapshot) => {
        this.placementTable = snapshot.docs.map((item) => ({ id: item.id, ...(item.data() as PlacementRow) }));
        this.setUniqueOptions();
        this.applyFilters();
      },
      (error: any) => {
        console.error('Placement rows listener error:', error);
        this.placementTable = [];
        this.filteredTable = [];
        this.setUniqueOptions();
        this.applyFilters();

        if (error?.code === 'permission-denied') {
          this.rowAddError = 'Permission denied loading placement rows. Sign in with Firebase Auth and update Firestore rules to allow your account.';
        } else {
          this.rowAddError = error?.message ? String(error.message) : 'Failed to load placement rows.';
        }
      }
    );
  }

  async addRow() {
    if (!this.userEmail) return;

    this.syncNewRowDate();

    const row: PlacementRow = {
      name: String(this.newRow.name ?? '').trim(),
      company: String(this.newRow.company ?? '').trim(),
      package: String(this.newRow.package ?? '').trim(),
      charged: String(this.newRow.charged ?? '').trim(),
      monthOnly: String(this.newRow.monthOnly ?? '').trim(),
      year: Number(this.newRow.year),
      date: String(this.newRow.date ?? '').trim(),
      email: this.userEmail
    };

    if (!row.name || !row.company || !row.package || !row.charged || !row.monthOnly || !row.year || !row.date) {
      return;
    }

    this.rowAddInProgress = true;
    this.rowAddError = null;

    try {
      await addDoc(collection(this.firestore, 'placementAssisted'), row);

      const now = new Date();
      this.newRow = {
        name: '',
        company: '',
        package: '',
        charged: '',
        monthOnly: this.months[now.getMonth()],
        year: now.getFullYear(),
        date: this.computeLastWorkingDayIso(now.getFullYear(), now.getMonth())
      };
    } catch (error: any) {
      console.error('Failed to add placement row:', error);
      this.rowAddError = error?.message ? String(error.message) : 'Failed to add placement row.';
    } finally {
      this.rowAddInProgress = false;
    }
  }

  async deleteRow(row: PlacementRow) {
    const rowId = String(row?.id ?? '');
    if (!rowId) return;

    this.deletingRowId = rowId;
    this.rowAddError = null;

    try {
      await deleteDoc(doc(this.firestore, 'placementAssisted', rowId));
    } catch (error: any) {
      console.error('Failed to delete placement row:', error);
      this.rowAddError = error?.message ? String(error.message) : 'Failed to delete placement row.';
    } finally {
      this.deletingRowId = null;
    }
  }

  startEditRow(row: PlacementRow) {
    const rowId = String(row?.id ?? '');
    if (!rowId) return;

    this.editingRowId = rowId;
    this.rowAddError = null;
    this.editRow = {
      id: rowId,
      name: String(row?.name ?? ''),
      company: String(row?.company ?? ''),
      package: String(row?.package ?? ''),
      charged: String(row?.charged ?? ''),
      monthOnly: String(row?.monthOnly ?? ''),
      year: Number(row?.year ?? ''),
      date: String(row?.date ?? ''),
      email: String(row?.email ?? this.userEmail ?? '')
    };

    this.syncEditRowDate();
  }

  cancelEditRow() {
    this.editingRowId = null;
    this.savingRowId = null;
    this.editRow = this.createEmptyEditRow();
    this.rowAddError = null;
  }

  onEditRowPeriodChange() {
    this.syncEditRowDate();
  }

  async saveEditRow() {
    const rowId = String(this.editingRowId ?? '');
    if (!rowId || !this.userEmail) return;

    this.syncEditRowDate();

    const updatedRow = {
      name: String(this.editRow.name ?? '').trim(),
      company: String(this.editRow.company ?? '').trim(),
      package: String(this.editRow.package ?? '').trim(),
      charged: String(this.editRow.charged ?? '').trim(),
      monthOnly: String(this.editRow.monthOnly ?? '').trim(),
      year: Number(this.editRow.year),
      date: String(this.editRow.date ?? '').trim(),
      email: this.userEmail
    };

    if (!updatedRow.name || !updatedRow.company || !updatedRow.package || !updatedRow.charged || !updatedRow.monthOnly || !updatedRow.year || !updatedRow.date) {
      return;
    }

    this.savingRowId = rowId;
    this.rowAddError = null;

    try {
      await updateDoc(doc(this.firestore, 'placementAssisted', rowId), updatedRow);
      this.cancelEditRow();
    } catch (error: any) {
      console.error('Failed to update placement row:', error);
      this.rowAddError = error?.message ? String(error.message) : 'Failed to update placement row.';
    } finally {
      this.savingRowId = null;
    }
  }

  setUniqueOptions() {
    const unique = (key: string) => Array.from(new Set(this.globallyFilteredPlacementRows.map((row: any) => row?.[key])));

    this.uniqueOptions.name = unique('name').sort((a, b) => String(a).localeCompare(String(b)));
    this.uniqueOptions.company = unique('company').sort((a, b) => String(a).localeCompare(String(b)));
    this.uniqueOptions.package = unique('package').sort((a, b) => this.parseMoney(b) - this.parseMoney(a));
    this.uniqueOptions.charged = unique('charged').sort((a, b) => this.parseMoney(b) - this.parseMoney(a));
    this.uniqueOptions.monthOnly = unique('monthOnly').sort((a, b) => this.months.indexOf(String(a)) - this.months.indexOf(String(b)));
    this.uniqueOptions.year = unique('year').sort((a, b) => Number(b) - Number(a));
    this.uniqueOptions.date = unique('date').sort((a, b) => String(b).localeCompare(String(a)));
  }

  onNewRowPeriodChange() {
    this.syncNewRowDate();
  }

  private syncNewRowDate() {
    const year = Number(this.newRow.year);
    const monthIndex = this.months.findIndex((month) => month === this.newRow.monthOnly);

    if (!Number.isFinite(year) || monthIndex < 0) {
      this.newRow.date = '';
      return;
    }

    this.newRow.date = this.computeLastWorkingDayIso(year, monthIndex);
  }

  private syncEditRowDate() {
    const year = Number(this.editRow.year);
    const monthIndex = this.months.findIndex((month) => month === this.editRow.monthOnly);

    if (!Number.isFinite(year) || monthIndex < 0) {
      this.editRow.date = '';
      return;
    }

    this.editRow.date = this.computeLastWorkingDayIso(year, monthIndex);
  }

  private createEmptyEditRow(): PlacementRow {
    return {
      id: '',
      name: '',
      company: '',
      package: '',
      charged: '',
      monthOnly: '',
      year: '',
      date: '',
      email: ''
    };
  }

  private computeLastWorkingDayIso(year: number, monthIndex: number): string {
    let day = new Date(year, monthIndex + 1, 0);
    const weekDay = day.getDay();

    if (weekDay === 6) day = new Date(year, monthIndex + 1, -1);
    if (weekDay === 0) day = new Date(year, monthIndex + 1, -2);

    const yyyy = day.getFullYear();
    const mm = String(day.getMonth() + 1).padStart(2, '0');
    const dd = String(day.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  applyFilters() {
    this.filteredTable = this.globallyFilteredPlacementRows.filter((row: any) => {
      return (
        (this.filters.name === '' || String(row.name ?? '') === String(this.filters.name)) &&
        (this.filters.company === '' || String(row.company ?? '') === String(this.filters.company)) &&
        (this.filters.package === '' || String(row.package ?? '') === String(this.filters.package)) &&
        (this.filters.charged === '' || String(row.charged ?? '') === String(this.filters.charged)) &&
        (this.filters.monthOnly === '' || String(row.monthOnly ?? '') === String(this.filters.monthOnly)) &&
        (this.filters.year === '' || String(row.year ?? '') === String(this.filters.year)) &&
        (this.filters.date === '' || String(row.date ?? '') === String(this.filters.date))
      );
    });

    if (!this.sortColumn) {
      this.sortColumn = 'date';
      this.sortDirection = 'desc';
    }

    this.sortTable(this.sortColumn, true);
  }

  sortTable(column: string, keepDirection = false) {
    if (!keepDirection) {
      if (this.sortColumn === column) {
        this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        this.sortDirection = column === 'date' ? 'desc' : 'asc';
      }
    }

    this.sortColumn = column;

    this.filteredTable.sort((a: any, b: any) => {
      let aValue: any = '';
      let bValue: any = '';

      switch (column) {
        case 'name':
        case 'company':
          aValue = String(a?.[column] ?? '').toLowerCase();
          bValue = String(b?.[column] ?? '').toLowerCase();
          break;
        case 'package':
        case 'charged':
          aValue = this.parseMoney(a?.[column]);
          bValue = this.parseMoney(b?.[column]);
          break;
        case 'monthOnly':
          aValue = this.months.indexOf(String(a?.monthOnly ?? ''));
          bValue = this.months.indexOf(String(b?.monthOnly ?? ''));
          break;
        case 'year':
          aValue = Number(a?.year ?? 0);
          bValue = Number(b?.year ?? 0);
          break;
        case 'date':
          aValue = String(a?.date ?? '');
          bValue = String(b?.date ?? '');
          break;
        default:
          aValue = String(a?.[column] ?? '').toLowerCase();
          bValue = String(b?.[column] ?? '').toLowerCase();
      }

      if (aValue < bValue) return this.sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return this.sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }

  getSortIcon(column: string) {
    if (this.sortColumn !== column) return 'fa-sort';
    return this.sortDirection === 'asc' ? 'fa-sort-up' : 'fa-sort-down';
  }

  getSortLabel(column: string) {
    if (this.sortColumn !== column) return 'Sort';
    return this.sortDirection === 'asc' ? 'Sort ascending' : 'Sort descending';
  }

  private parseMoney(value: any): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const amount = parseFloat(String(value ?? '').replace(/[^0-9.-]/g, ''));
    return Number.isFinite(amount) ? amount : 0;
  }

  formatCurrency(amount: any): string {
    const value = this.parseMoney(amount);
    if (!Number.isFinite(value) || value === 0) return String(amount ?? '');

    try {
      return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      }).format(value);
    } catch {
      return `₹${value.toFixed(0)}`;
    }
  }

  get totalCandidates(): number {
    return this.globallyFilteredPlacementRows.length;
  }

  get totalCompanies(): number {
    return new Set(this.globallyFilteredPlacementRows.map((row) => String(row?.company ?? '').trim()).filter(Boolean)).size;
  }

  get totalMonths(): number {
    return new Set(
      this.globallyFilteredPlacementRows
        .map((row) => {
          const year = Number(row?.year ?? NaN);
          const monthIndex = this.months.findIndex((month) => month === row?.monthOnly);
          if (!Number.isFinite(year) || monthIndex < 0) return '';
          return `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
        })
        .filter(Boolean)
    ).size;
  }

  get averagePlacementsPerMonth(): number {
    return this.totalMonths > 0 ? this.totalCandidates / this.totalMonths : 0;
  }

  get totalCharged(): number {
    return this.globallyFilteredPlacementRows.reduce((sum, row) => sum + this.parseMoney(row?.charged), 0);
  }

  get averageChargedPerMonth(): number {
    return this.totalMonths > 0 ? this.totalCharged / this.totalMonths : 0;
  }

  get averageChargedPerPlacement(): number {
    return this.totalCandidates > 0 ? this.totalCharged / this.totalCandidates : 0;
  }

  get highestPackage(): number {
    return this.globallyFilteredPlacementRows.reduce((max, row) => Math.max(max, this.parseMoney(row?.package)), 0);
  }

  get averagePackage(): number {
    return this.totalCandidates > 0
      ? this.globallyFilteredPlacementRows.reduce((sum, row) => sum + this.parseMoney(row?.package), 0) / this.totalCandidates
      : 0;
  }

  get latestMonthCount(): number {
    if (!this.globallyFilteredPlacementRows.length) return 0;
    const latestDate = [...this.globallyFilteredPlacementRows]
      .map((row) => String(row.date ?? ''))
      .sort((a, b) => b.localeCompare(a))[0];

    return this.globallyFilteredPlacementRows.filter((row) => String(row.date ?? '').slice(0, 7) === latestDate.slice(0, 7)).length;
  }

  get latestMonthCharged(): number {
    if (!this.globallyFilteredPlacementRows.length) return 0;

    const latestDate = [...this.globallyFilteredPlacementRows]
      .map((row) => String(row.date ?? ''))
      .sort((a, b) => b.localeCompare(a))[0];

    return this.globallyFilteredPlacementRows.reduce((sum, row) => {
      return String(row?.date ?? '').slice(0, 7) === latestDate.slice(0, 7)
        ? sum + this.parseMoney(row?.charged)
        : sum;
    }, 0);
  }

  private get globallyFilteredPlacementRows(): PlacementRow[] {
    return (this.placementTable ?? []).filter((row) => this.matchesGlobalMonthKey(this.getMonthKeyForRow(row)));
  }

  private getMonthKeyForRow(row: PlacementRow): string {
    const year = Number(row?.year ?? NaN);
    const monthIndex = this.months.findIndex((month) => month === row?.monthOnly);

    if (Number.isFinite(year) && monthIndex >= 0) {
      return `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
    }

    const dateStr = String(row?.date ?? '').trim();
    return dateStr ? dateStr.slice(0, 7) : '';
  }

  private matchesGlobalMonthKey(key: string): boolean {
    const normalizedKey = String(key ?? '').trim();
    if (!Object.keys(this.globalFilterSelections).length) {
      return true;
    }

    const match = normalizedKey.match(/^(\d{4})-(\d{2})$/);
    if (!match) {
      return false;
    }

    const selectedMonths = this.globalFilterSelections[match[1]];
    if (!selectedMonths) {
      return false;
    }

    if (selectedMonths.length) {
      const monthNumbers = new Set(
        selectedMonths
          .map((month) => this.months.findIndex((item) => item === month))
          .filter((monthIndex) => monthIndex >= 0)
          .map((monthIndex) => String(monthIndex + 1).padStart(2, '0'))
      );

      if (!monthNumbers.size || !monthNumbers.has(match[2])) {
        return false;
      }
    }

    return true;
  }

  private cloneGlobalFilterSelections(selections: Record<string, string[]> | null | undefined): Record<string, string[]> {
    return Object.entries(selections ?? {}).reduce<Record<string, string[]>>((accumulator, [year, months]) => {
      const normalizedYear = String(year ?? '').trim();
      if (!normalizedYear) {
        return accumulator;
      }

      accumulator[normalizedYear] = Array.isArray(months)
        ? months.map((month) => String(month ?? '').trim()).filter((month) => !!month)
        : [];
      return accumulator;
    }, {});
  }

  get latestMonthAverageCharged(): number {
    return this.latestMonthCount > 0 ? this.latestMonthCharged / this.latestMonthCount : 0;
  }
}
