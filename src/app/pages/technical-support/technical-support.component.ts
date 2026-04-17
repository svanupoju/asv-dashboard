import { Component, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { getApps, initializeApp } from 'firebase/app';
import { addDoc, collection, deleteDoc, doc, getFirestore, onSnapshot, orderBy, query, updateDoc, where } from 'firebase/firestore';
import { getAuth, onAuthStateChanged, User } from 'firebase/auth';
import { environment } from '../../../environments/environment';
import { GlobalPeriodFilterService } from '../../shared/services/global-period-filter.service';
import { normalizeAppEmail } from '../../shared/utils/email-alias.util';

type TechnicalSupportRow = {
  id?: string;
  name: string;
  company: string;
  charged: string;
  monthOnly: string;
  year: number | string;
  date: string;
  email: string;
};

@Component({
  selector: 'app-technical-support',
  templateUrl: './technical-support.component.html',
  styleUrls: ['./technical-support.component.scss']
})
export class TechnicalSupportComponent implements OnDestroy {
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

  editRow: TechnicalSupportRow = this.createEmptyEditRow();

  supportTable: TechnicalSupportRow[] = [];
  filteredTable: TechnicalSupportRow[] = [];

  newRow: any = {
    name: '',
    company: '',
    charged: '',
    monthOnly: '',
    year: '',
    date: ''
  };

  filters: any = {
    name: '',
    company: '',
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
        this.supportTable = [];
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

    const rowsRef = collection(this.firestore, 'technicalSupport');
    const rowsQuery = query(rowsRef, where('email', '==', this.userEmail), orderBy('date', 'desc'));

    onSnapshot(
      rowsQuery,
      (snapshot) => {
        this.supportTable = snapshot.docs.map((item) => ({ id: item.id, ...(item.data() as TechnicalSupportRow) }));
        this.setUniqueOptions();
        this.applyFilters();
      },
      (error: any) => {
        console.error('Technical support rows listener error:', error);
        this.supportTable = [];
        this.filteredTable = [];
        this.setUniqueOptions();
        this.applyFilters();

        if (error?.code === 'permission-denied') {
          this.rowAddError = 'Permission denied loading technical support rows. Sign in with Firebase Auth and update Firestore rules to allow your account.';
        } else {
          this.rowAddError = error?.message ? String(error.message) : 'Failed to load technical support rows.';
        }
      }
    );
  }

  async addRow() {
    if (!this.userEmail) return;

    this.syncNewRowDate();

    const row: TechnicalSupportRow = {
      name: String(this.newRow.name ?? '').trim(),
      company: String(this.newRow.company ?? '').trim(),
      charged: String(this.newRow.charged ?? '').trim(),
      monthOnly: String(this.newRow.monthOnly ?? '').trim(),
      year: Number(this.newRow.year),
      date: String(this.newRow.date ?? '').trim(),
      email: this.userEmail
    };

    if (!row.name || !row.company || !row.charged || !row.monthOnly || !row.year || !row.date) {
      return;
    }

    this.rowAddInProgress = true;
    this.rowAddError = null;

    try {
      await addDoc(collection(this.firestore, 'technicalSupport'), row);

      const now = new Date();
      this.newRow = {
        name: '',
        company: '',
        charged: '',
        monthOnly: this.months[now.getMonth()],
        year: now.getFullYear(),
        date: this.computeLastWorkingDayIso(now.getFullYear(), now.getMonth())
      };
    } catch (error: any) {
      console.error('Failed to add technical support row:', error);
      this.rowAddError = error?.message ? String(error.message) : 'Failed to add technical support row.';
    } finally {
      this.rowAddInProgress = false;
    }
  }

  async deleteRow(row: TechnicalSupportRow) {
    const rowId = String(row?.id ?? '');
    if (!rowId) return;

    this.deletingRowId = rowId;
    this.rowAddError = null;

    try {
      await deleteDoc(doc(this.firestore, 'technicalSupport', rowId));
    } catch (error: any) {
      console.error('Failed to delete technical support row:', error);
      this.rowAddError = error?.message ? String(error.message) : 'Failed to delete technical support row.';
    } finally {
      this.deletingRowId = null;
    }
  }

  startEditRow(row: TechnicalSupportRow) {
    const rowId = String(row?.id ?? '');
    if (!rowId) return;

    this.editingRowId = rowId;
    this.rowAddError = null;
    this.editRow = {
      id: rowId,
      name: String(row?.name ?? ''),
      company: String(row?.company ?? ''),
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
      charged: String(this.editRow.charged ?? '').trim(),
      monthOnly: String(this.editRow.monthOnly ?? '').trim(),
      year: Number(this.editRow.year),
      date: String(this.editRow.date ?? '').trim(),
      email: this.userEmail
    };

    if (!updatedRow.name || !updatedRow.company || !updatedRow.charged || !updatedRow.monthOnly || !updatedRow.year || !updatedRow.date) {
      return;
    }

    this.savingRowId = rowId;
    this.rowAddError = null;

    try {
      await updateDoc(doc(this.firestore, 'technicalSupport', rowId), updatedRow);
      this.cancelEditRow();
    } catch (error: any) {
      console.error('Failed to update technical support row:', error);
      this.rowAddError = error?.message ? String(error.message) : 'Failed to update technical support row.';
    } finally {
      this.savingRowId = null;
    }
  }

  setUniqueOptions() {
    const unique = (key: string) => Array.from(new Set(this.globallyFilteredSupportRows.map((row: any) => row?.[key])));

    this.uniqueOptions.name = unique('name').sort((a, b) => String(a).localeCompare(String(b)));
    this.uniqueOptions.company = unique('company').sort((a, b) => String(a).localeCompare(String(b)));
    this.uniqueOptions.charged = unique('charged').sort((a, b) => this.parseMoney(b) - this.parseMoney(a));
    this.uniqueOptions.monthOnly = unique('monthOnly').sort((a, b) => this.months.indexOf(String(a)) - this.months.indexOf(String(b)));
    this.uniqueOptions.year = unique('year').sort((a, b) => Number(b) - Number(a));
    this.uniqueOptions.date = unique('date').sort((a, b) => String(b).localeCompare(String(a)));
  }

  onNewRowPeriodChange() {
    this.syncNewRowDate();
  }

  onNewRowNameChange() {
    const selectedName = String(this.newRow.name ?? '').trim();
    if (!selectedName) return;

    const matchingRows = (this.supportTable ?? []).filter(
      (row) => String(row?.name ?? '').trim() === selectedName
    );

    if (!matchingRows.length) return;

    const latestRow = [...matchingRows].sort((left, right) => String(right?.date ?? '').localeCompare(String(left?.date ?? '')))[0];
    if (latestRow?.company) {
      this.newRow.company = String(latestRow.company);
    }

    const mostRepeatedCharged = this.getMostRepeatedCharged(matchingRows);
    if (mostRepeatedCharged) {
      this.newRow.charged = mostRepeatedCharged;
    }

    const now = new Date();
    this.newRow.monthOnly = this.months[now.getMonth()];
    this.newRow.year = now.getFullYear();
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

  private createEmptyEditRow(): TechnicalSupportRow {
    return {
      id: '',
      name: '',
      company: '',
      charged: '',
      monthOnly: '',
      year: '',
      date: '',
      email: ''
    };
  }

  private getMostRepeatedCharged(rows: TechnicalSupportRow[]): string {
    const counts = new Map<string, { count: number; amount: number }>();

    for (const row of rows) {
      const charged = String(row?.charged ?? '').trim();
      if (!charged) continue;

      const current = counts.get(charged);
      counts.set(charged, {
        count: (current?.count ?? 0) + 1,
        amount: this.parseMoney(charged)
      });
    }

    let bestCharged = '';
    let bestCount = -1;
    let bestAmount = -Infinity;

    for (const [charged, info] of counts.entries()) {
      if (info.count > bestCount || (info.count === bestCount && info.amount > bestAmount)) {
        bestCharged = charged;
        bestCount = info.count;
        bestAmount = info.amount;
      }
    }

    return bestCharged;
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

  private getMonthKeyForRow(row: TechnicalSupportRow): string {
    const year = Number(row?.year ?? NaN);
    const monthIndex = this.months.findIndex((month) => month === row?.monthOnly);

    if (Number.isFinite(year) && monthIndex >= 0) {
      return `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
    }

    const dateStr = String(row?.date ?? '').trim();
    return dateStr ? dateStr.slice(0, 7) : '';
  }

  private getAverageDistinctCountPerMonth(field: 'name' | 'company'): number {
    const monthlyValues = new Map<string, Set<string>>();

    for (const row of this.globallyFilteredSupportRows) {
      const monthKey = this.getMonthKeyForRow(row);
      const value = String(row?.[field] ?? '').trim();

      if (!monthKey || !value) continue;

      let values = monthlyValues.get(monthKey);
      if (!values) {
        values = new Set<string>();
        monthlyValues.set(monthKey, values);
      }

      values.add(value);
    }

    if (!monthlyValues.size) return 0;

    const totalDistinctAcrossMonths = [...monthlyValues.values()].reduce((sum, values) => sum + values.size, 0);
    return totalDistinctAcrossMonths / monthlyValues.size;
  }

  applyFilters() {
    this.filteredTable = this.globallyFilteredSupportRows.filter((row: any) => {
      return (
        (this.filters.name === '' || String(row.name ?? '') === String(this.filters.name)) &&
        (this.filters.company === '' || String(row.company ?? '') === String(this.filters.company)) &&
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

  get totalSupportEntries(): number {
    return new Set(this.globallyFilteredSupportRows.map((row) => String(row?.name ?? '').trim()).filter(Boolean)).size;
  }

  get totalCharged(): number {
    return this.globallyFilteredSupportRows.reduce((sum, row) => sum + this.parseMoney(row?.charged), 0);
  }

  get totalCompanies(): number {
    return new Set(this.globallyFilteredSupportRows.map((row) => String(row?.company ?? '').trim()).filter(Boolean)).size;
  }

  get totalMonths(): number {
    return new Set(
      this.globallyFilteredSupportRows
        .map((row) => {
          const year = Number(row?.year ?? NaN);
          const monthIndex = this.months.findIndex((month) => month === row?.monthOnly);
          if (!Number.isFinite(year) || monthIndex < 0) return '';
          return `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
        })
        .filter(Boolean)
    ).size;
  }

  get averagePersonsPerMonth(): number {
    return this.getAverageDistinctCountPerMonth('name');
  }

  get averageChargedPerMonth(): number {
    return this.totalMonths > 0 ? this.totalCharged / this.totalMonths : 0;
  }

  get averageChargedPerPerson(): number {
    return this.totalSupportEntries > 0 ? this.totalCharged / this.totalSupportEntries : 0;
  }

  get averageCompaniesPerMonth(): number {
    return this.getAverageDistinctCountPerMonth('company');
  }

  get filteredTotalMonths(): number {
    return new Set(
      (this.filteredTable ?? [])
        .map((row) => {
          const year = Number(row?.year ?? NaN);
          const monthIndex = this.months.findIndex((month) => month === row?.monthOnly);
          if (!Number.isFinite(year) || monthIndex < 0) return '';
          return `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
        })
        .filter(Boolean)
    ).size;
  }

  get filteredTotalCharged(): number {
    return (this.filteredTable ?? []).reduce((sum, row) => sum + this.parseMoney(row?.charged), 0);
  }

  get latestMonthCount(): number {
    if (!this.globallyFilteredSupportRows.length) return 0;
    const latestDate = [...this.globallyFilteredSupportRows]
      .map((row) => String(row.date ?? ''))
      .sort((a, b) => b.localeCompare(a))[0];

    return this.globallyFilteredSupportRows.filter((row) => String(row.date ?? '').slice(0, 7) === latestDate.slice(0, 7)).length;
  }

  get latestMonth(): number {
    if (!this.globallyFilteredSupportRows.length) return 0;

    const latestDate = [...this.globallyFilteredSupportRows]
      .map((row) => String(row.date ?? ''))
      .sort((a, b) => b.localeCompare(a))[0];

    return this.globallyFilteredSupportRows.reduce((sum, row) => {
      return String(row?.date ?? '').slice(0, 7) === latestDate.slice(0, 7)
        ? sum + this.parseMoney(row?.charged)
        : sum;
    }, 0);
  }

  private get globallyFilteredSupportRows(): TechnicalSupportRow[] {
    return (this.supportTable ?? []).filter((row) => this.matchesGlobalMonthKey(this.getMonthKeyForRow(row)));
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
    return this.latestMonthCount > 0 ? this.latestMonth / this.latestMonthCount : 0;
  }
}
