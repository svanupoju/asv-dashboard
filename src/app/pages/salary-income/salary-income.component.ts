import { Component, OnDestroy } from '@angular/core';
import { addDoc } from '@angular/fire/firestore';
import { Subscription } from 'rxjs';
import { getApps, initializeApp } from 'firebase/app';
import { getFirestore, collection, query, orderBy, onSnapshot, addDoc as nativeAddDoc, where, serverTimestamp, doc, deleteDoc, getDocs } from 'firebase/firestore';
import { getAuth, onAuthStateChanged, User } from 'firebase/auth';
import { environment } from '../../../environments/environment';
import { GlobalPeriodFilterService } from '../../shared/services/global-period-filter.service';
import { normalizeAppEmail } from '../../shared/utils/email-alias.util';

type PdfItemStatus = 'pending' | 'parsing' | 'parsed' | 'uploading' | 'stored' | 'failed';

type PdfIncomeItem = {
  id: string;
  fileName: string;
  size: number;
  status: PdfItemStatus;
  netIncome: number | null;
  pf: number | null; // Provident Fund (PF)
  monthOnly?: string | null;
  year?: number | null;
  monthYear?: string | null;
  creditedDate?: string | null; // yyyy-mm-dd (last working day of extracted month/year)
  error?: string;
  storagePath?: string;
  downloadUrl?: string;
};

@Component({
  selector: 'app-salary-income',
  templateUrl: './salary-income.component.html',
  styleUrls: ['./salary-income.component.scss']
})
export class SalaryIncomeComponent implements OnDestroy {
  newRow: any = { year: '', monthOnly: '', salary: '', date: '', monthYear: '' };
  showAddRow = false;
  incomeTable: any[] = [];
  filteredTable: any[] = [];

  months: string[] = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  firestore;

  user: User | null = null;
  userEmail: string | null = null;
  authChecked = false;

  rowAddInProgress = false;
  rowAddError: string | null = null;

  deletingRowId: string | null = null;
  deletingPdfId: string | null = null;

  // In-app confirm dialog (replaces window.confirm)
  confirmDialogOpen = false;
  confirmDialogTitle = '';
  confirmDialogMessage = '';
  confirmDialogConfirmText = 'Delete';
  confirmDialogBusy = false;
  private confirmDialogAction: (() => Promise<void>) | null = null;

  // PDF upload + extraction
  savePdfsToCloud = true;
  pdfItems: PdfIncomeItem[] = [];
  cloudPdfUploads: any[] = [];
  filteredCloudPdfUploads: any[] = [];
  placementChargeRows: any[] = [];
  technicalChargeRows: any[] = [];

  // Local "preview" rows that appear in the grid after PDF parsing (even before saving to Firestore)
  private readonly pdfPreviewRowPrefix = '__pdf_preview__:';
  private pdfPreviewRows: any[] = [];

  private pdfjsLib: any | null = null;
  private pdfWorkerReady = false;
  private readonly maxPdfBytes = 15 * 1024 * 1024; // 15MB
  globalFilterSelections: Record<string, string[]> = {};
  private globalFilterSubscription?: Subscription;

  constructor(private readonly globalPeriodFilterService: GlobalPeriodFilterService) {
    // Only initialize Firebase if it hasn't been initialized yet
    if (!getApps().length) {
      initializeApp(environment.firebase);
    }
    this.firestore = getFirestore();

    // Set default month, year, date, and monthYear to current
    const now = new Date();
    this.newRow.monthOnly = this.months[now.getMonth()];
    this.newRow.year = now.getFullYear();
    this.newRow.date = this.computeLastWorkingDayIso(now.getFullYear(), now.getMonth());
    this.newRow.monthYear = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}`; // yyyy-mm

    this.globalFilterSubscription = this.globalPeriodFilterService.filter$.subscribe((filter) => {
      this.globalFilterSelections = this.cloneGlobalFilterSelections(filter?.selections);
      this.setUniqueOptions();
      this.applyFilters();
      this.setPayslipUniqueOptions();
      this.applyPayslipFilters();
    });

    // Listen for Firebase Auth state changes; only load Firestore/Storage data when authenticated.
    onAuthStateChanged(getAuth(), (user) => {
      this.user = user;
      this.authChecked = true;
      this.userEmail = normalizeAppEmail(user?.email);

      if (this.userEmail) {
        sessionStorage.setItem('email', this.userEmail);
        this.loadRows();
        this.loadPdfUploads();
        void this.loadPlacementCharges();
        void this.loadTechnicalCharges();
      } else {
        this.cloudPdfUploads = [];
        this.filteredCloudPdfUploads = [];
        this.placementChargeRows = [];
        this.technicalChargeRows = [];
        this.incomeTable = [];
        this.filteredTable = [];
        this.setUniqueOptions();
        this.applyFilters();
        this.setPayslipUniqueOptions();
        this.applyPayslipFilters();

        // Rebuild preview rows from any locally parsed PDFs (cloud is unavailable when signed out)
        this.upsertPdfPreviewRows();
      }
    });
  }

  ngOnDestroy(): void {
    this.globalFilterSubscription?.unsubscribe();
  }

  async addRow() {
    // Recompute monthYear from year + month selection (so it stays correct if the user changes them)
    this.newRow.monthYear = this.computeMonthYear(this.newRow.year, this.newRow.monthOnly);
    this.syncManualRowDate();

    if (!this.newRow.year || !this.newRow.monthOnly || !this.newRow.salary || !this.newRow.date || !this.newRow.monthYear) return;
    const month = this.newRow.monthOnly + ' ' + this.newRow.year;
    if (!this.userEmail) return; // Optionally, handle not signed in

    const row = {
      year: this.newRow.year,
      monthOnly: this.newRow.monthOnly,
      month,
      salary: this.newRow.salary,
      date: this.newRow.date,
      monthYear: this.newRow.monthYear,
      email: this.userEmail
    };

    this.rowAddInProgress = true;
    this.rowAddError = null;

    try {
      const docRef = await nativeAddDoc(collection(this.firestore, 'salaryRows'), row);

      // Remove preview rows for this monthYear after successful save (prevents duplicates)
      this.pdfPreviewRows = this.pdfPreviewRows.filter(r => r?.monthYear !== row.monthYear);

      // Optimistic update: show immediately in the grid (onSnapshot will reconcile)
      const optimistic = { id: docRef.id, ...row };
      const base = this.removePdfPreviewRows(this.incomeTable);
      this.incomeTable = [optimistic, ...this.mergePdfPreviewRows(base)];
      this.setUniqueOptions();
      this.applyFilters();

      const now = new Date();
      this.newRow = {
        year: now.getFullYear(),
        monthOnly: this.months[now.getMonth()],
        salary: '',
        date: this.computeLastWorkingDayIso(now.getFullYear(), now.getMonth()),
        monthYear: `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}`
      };
    } catch (e: any) {
      if (e?.code === 'permission-denied') {
        this.rowAddError = 'Permission denied adding row. You are either not signed into Firebase Auth, or your Firestore rules do not allow writes to salaryRows.';
      } else {
        this.rowAddError = e?.message ? String(e.message) : 'Failed to add row.';
      }
      console.error('Failed to add salary row:', e);
    } finally {
      this.rowAddInProgress = false;
    }
  }

  private async deletePayslipsForMonthYear(monthYear: string) {
    const key = typeof monthYear === 'string' ? monthYear : '';
    if (!key) return;

    // Delete cloud-stored PDFs for this month (Drive file + Firestore metadata)
    const uploads = (this.cloudPdfUploads ?? []).filter(u => String(u?.monthYear ?? '') === key);
    for (const u of uploads) {
      await this.deleteStoredPdf(u, true);
    }

    // Remove any local-only parsed PDFs for this month
    this.pdfItems = (this.pdfItems ?? []).filter(p => String(p?.monthYear ?? '') !== key);

    // Recompute preview rows
    this.upsertPdfPreviewRows();
  }

  openConfirmDialog(title: string, message: string, action: () => Promise<void>, confirmText = 'Delete') {
    this.confirmDialogTitle = title;
    this.confirmDialogMessage = message;
    this.confirmDialogConfirmText = confirmText;
    this.confirmDialogAction = action;
    this.confirmDialogOpen = true;
    this.confirmDialogBusy = false;
  }

  closeConfirmDialog() {
    if (this.confirmDialogBusy) return;
    this.confirmDialogOpen = false;
    this.confirmDialogAction = null;
  }

  async confirmDialogConfirm() {
    if (!this.confirmDialogAction) {
      this.confirmDialogOpen = false;
      return;
    }

    this.confirmDialogBusy = true;
    try {
      await this.confirmDialogAction();
    } finally {
      this.confirmDialogBusy = false;
      this.confirmDialogOpen = false;
      this.confirmDialogAction = null;
    }
  }

  async deleteRow(row: any) {
    const id = String(row?.id ?? '');
    if (!id) return;

    const isPreview = id.startsWith(this.pdfPreviewRowPrefix);

    const monthYearFromRow = typeof row?.monthYear === 'string' ? row.monthYear : '';
    const monthYearFromId = isPreview ? id.slice(this.pdfPreviewRowPrefix.length) : '';
    const monthYear = monthYearFromRow || monthYearFromId;

    if (isPreview && !monthYear) return;

    const prettyMonth = row?.monthOnly && row?.year ? `${row.monthOnly} ${row.year}` : '';

    const title = isPreview ? 'Delete generated row?' : 'Delete row?';
    const message = isPreview
      ? `This row is generated from payslip PDFs${prettyMonth ? ` for ${prettyMonth}` : ''}. This will permanently delete all payslip PDFs for this month and remove the row.`
      : 'Delete this row?';

    this.openConfirmDialog(title, message, async () => {
      await this.performDeleteRow(id, isPreview, monthYear);
    });
  }

  private async performDeleteRow(id: string, isPreview: boolean, monthYear: string) {
    if (isPreview) {
      if (!monthYear) return;

      this.deletingRowId = id;
      this.rowAddError = null;
      try {
        await this.deletePayslipsForMonthYear(monthYear);
      } catch (e: any) {
        console.error('Failed to delete payslips for month:', e);
        this.rowAddError = e?.message ? String(e.message) : 'Failed to delete payslips.';
        this.loadPdfUploads();
      } finally {
        this.deletingRowId = null;
      }
      return;
    }

    if (!this.userEmail) return;

    this.deletingRowId = id;
    this.rowAddError = null;

    try {
      // Optimistic removal (onSnapshot will reconcile)
      const base = this.removePdfPreviewRows(this.incomeTable).filter(r => String(r?.id ?? '') !== id);
      this.incomeTable = this.mergePdfPreviewRows(base);
      this.setUniqueOptions();
      this.applyFilters();

      await deleteDoc(doc(this.firestore, 'salaryRows', id));
    } catch (e: any) {
      console.error('Failed to delete row:', e);
      this.rowAddError = e?.message ? String(e.message) : 'Failed to delete row.';
      // reload from server
      this.loadRows();
    } finally {
      this.deletingRowId = null;
    }
  }

  loadRows() {
    if (!this.userEmail) return;
    const rowsRef = collection(this.firestore, 'salaryRows');
    const q = query(rowsRef, where('email', '==', this.userEmail), orderBy('date', 'desc'));
    onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        this.incomeTable = this.mergePdfPreviewRows(data);
        this.setUniqueOptions();
        this.applyFilters();
      },
      (error: any) => {
        // Prevent “Uncaught Error in snapshot listener” noise and show a clearer message.
        console.error('Salary rows listener error:', error);
        this.incomeTable = this.mergePdfPreviewRows([]);
        this.setUniqueOptions();
        this.applyFilters();

        if (error?.code === 'permission-denied') {
          this.rowAddError = 'Permission denied loading income rows. Sign in with Firebase Auth and update Firestore rules to allow your account.';
        } else {
          this.rowAddError = error?.message ? String(error.message) : 'Failed to load income rows.';
        }
      }
    );
  }

  loadPdfUploads() {
    if (!this.userEmail) return;
    const uploadsRef = collection(this.firestore, 'salaryPdfUploads');

    // Avoid composite-index requirements by sorting client-side
    const q = query(uploadsRef, where('email', '==', this.userEmail));

    onSnapshot(
      q,
      (snapshot) => {
        const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        const toMillis = (v: any): number => {
          if (v && typeof v.toMillis === 'function') return v.toMillis();
          if (typeof v === 'number') return v;
          if (typeof v === 'string') {
            const t = Date.parse(v);
            return Number.isFinite(t) ? t : 0;
          }
          return 0;
        };

        this.cloudPdfUploads = docs.sort((a: any, b: any) => toMillis(b.uploadedAt) - toMillis(a.uploadedAt));
        this.setPayslipUniqueOptions();
        this.applyPayslipFilters();

        // Keep “Stored PDFs” coming strictly from Firestore (no mixing into the local upload list)
        this.upsertPdfPreviewRows();
      },
      (error: any) => {
        console.error('PDF uploads listener error:', error);
        this.cloudPdfUploads = [];
        this.filteredCloudPdfUploads = [];
        this.setPayslipUniqueOptions();
        this.applyPayslipFilters();
        this.upsertPdfPreviewRows();

        if (error?.code === 'permission-denied') {
          this.rowAddError = 'Permission denied loading stored PDFs. Sign in with Firebase Auth and update Firestore rules to allow your account.';
        } else {
          this.rowAddError = error?.message ? String(error.message) : 'Failed to load stored PDFs.';
        }
      }
    );
  }

  async loadPlacementCharges() {
    if (!this.userEmail) return;

    try {
      const rowsRef = collection(this.firestore, 'placementAssisted');
      const placementQuery = query(rowsRef, where('email', '==', this.userEmail));
      const snapshot = await getDocs(placementQuery);
      this.placementChargeRows = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    } catch (error) {
      console.error('Placement charged fetch error:', error);
      this.placementChargeRows = [];
    }
  }

  async loadTechnicalCharges() {
    if (!this.userEmail) return;

    try {
      const rowsRef = collection(this.firestore, 'technicalSupport');
      const technicalQuery = query(rowsRef, where('email', '==', this.userEmail));
      const snapshot = await getDocs(technicalQuery);
      this.technicalChargeRows = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    } catch (error) {
      console.error('Technical support charged fetch error:', error);
      this.technicalChargeRows = [];
    }
  }

  filters: any = { year: '', monthOnly: '', salary: '', pf: '', date: '' };
  sortColumn: string = 'date';
  sortDirection: 'asc' | 'desc' = 'desc';
  uniqueOptions: any = { year: [], monthOnly: [], salary: [], pf: [], date: [] };
  payslipFilters: any = { fileName: '' };
  payslipSortColumn: string = 'fileName';
  payslipSortDirection: 'asc' | 'desc' = 'desc';
  payslipUniqueOptions: any = { fileName: [] };

  setUniqueOptions() {
    const scopedRows = this.globallyFilteredIncomeRows;
    const getUnique = (arr: any[], key: string) => Array.from(new Set(arr.map(item => item[key])));
    this.uniqueOptions.year = getUnique(scopedRows, 'year');
    this.uniqueOptions.monthOnly = getUnique(scopedRows, 'monthOnly');
    this.uniqueOptions.salary = getUnique(scopedRows, 'salary');
    this.uniqueOptions.pf = getUnique(scopedRows, 'pf');
    this.uniqueOptions.date = getUnique(scopedRows, 'date');
  }

  applyFilters() {
    this.filteredTable = this.globallyFilteredIncomeRows.filter(row => {
      return (
        (this.filters.year === '' || row.year.toString() === this.filters.year.toString()) &&
        (this.filters.monthOnly === '' || row.monthOnly === this.filters.monthOnly) &&
        (this.filters.salary === '' || row.salary === this.filters.salary) &&
        (this.filters.pf === '' || String(row.pf ?? '') === String(this.filters.pf)) &&
        (this.filters.date === '' || row.date === this.filters.date)
      );
    });

    // Default sort = latest date first, but allow column sorting to work.
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
        // Default direction: date = desc, others = asc
        this.sortDirection = column === 'date' ? 'desc' : 'asc';
      }
    }

    this.sortColumn = column;

    this.filteredTable.sort((a, b) => {
      let aValue: any;
      let bValue: any;

      switch (column) {
        case 'year':
          aValue = Number(a?.year ?? 0);
          bValue = Number(b?.year ?? 0);
          break;
        case 'monthOnly':
          aValue = String(a?.monthOnly ?? '');
          bValue = String(b?.monthOnly ?? '');
          break;
        case 'salary':
          aValue = this.parseMoney(a?.salary);
          bValue = this.parseMoney(b?.salary);
          break;
        case 'pf':
          aValue = this.parseMoney(a?.pf);
          bValue = this.parseMoney(b?.pf);
          break;
        case 'date':
          // yyyy-mm-dd string sort works for ISO dates
          aValue = String(a?.date ?? '');
          bValue = String(b?.date ?? '');
          break;
        default:
          aValue = '';
          bValue = '';
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

  setPayslipUniqueOptions() {
    const uniqueUploads = new Map<string, any>();

    for (const upload of this.globallyFilteredCloudPdfUploadsBase) {
      const fileName = String(upload?.fileName ?? '').trim();
      if (!fileName || uniqueUploads.has(fileName)) continue;
      uniqueUploads.set(fileName, upload);
    }

    this.payslipUniqueOptions.fileName = Array.from(uniqueUploads.values())
      .sort((a, b) => {
        const aValue = this.getPayslipSortValue(a);
        const bValue = this.getPayslipSortValue(b);

        if (aValue !== bValue) return bValue - aValue;

        const aName = String(a?.fileName ?? '').toLowerCase();
        const bName = String(b?.fileName ?? '').toLowerCase();
        return aName.localeCompare(bName);
      })
      .map(upload => String(upload?.fileName ?? ''));
  }

  applyPayslipFilters() {
    this.filteredCloudPdfUploads = this.globallyFilteredCloudPdfUploadsBase.filter(upload => {
      return this.payslipFilters.fileName === '' || String(upload?.fileName ?? '') === String(this.payslipFilters.fileName);
    });

    if (!this.payslipSortColumn) {
      this.payslipSortColumn = 'fileName';
      this.payslipSortDirection = 'desc';
    }

    this.sortPayslipTable(this.payslipSortColumn, true);
  }

  sortPayslipTable(column: string, keepDirection = false) {
    if (!keepDirection) {
      if (this.payslipSortColumn === column) {
        this.payslipSortDirection = this.payslipSortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        this.payslipSortDirection = 'desc';
      }
    }

    this.payslipSortColumn = column;

    this.filteredCloudPdfUploads.sort((a, b) => {
      const aValue = this.getPayslipSortValue(a);
      const bValue = this.getPayslipSortValue(b);

      if (aValue < bValue) return this.payslipSortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return this.payslipSortDirection === 'asc' ? 1 : -1;

      const aName = String(a?.fileName ?? '').toLowerCase();
      const bName = String(b?.fileName ?? '').toLowerCase();
      if (aName < bName) return this.payslipSortDirection === 'asc' ? -1 : 1;
      if (aName > bName) return this.payslipSortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }

  private getPayslipSortValue(upload: any): number {
    const monthYear = String(upload?.monthYear ?? '').trim();
    const monthYearMatch = monthYear.match(/^(\d{4})-(\d{2})$/);
    if (monthYearMatch) {
      return Number(`${monthYearMatch[1]}${monthYearMatch[2]}`);
    }

    const fileName = String(upload?.fileName ?? '').replace(/\.pdf$/i, '').trim();
    const fileMonthYearMatch = fileName.match(/^(January|February|March|April|May|June|July|August|September|October|November|December)[_\s-]+(\d{4})$/i);
    if (fileMonthYearMatch) {
      const monthIndex = this.months.findIndex(
        month => month.toLowerCase() === fileMonthYearMatch[1].toLowerCase()
      );
      if (monthIndex >= 0) {
        return Number(`${fileMonthYearMatch[2]}${String(monthIndex + 1).padStart(2, '0')}`);
      }
    }

    const uploadedAt = upload?.uploadedAt;
    if (uploadedAt && typeof uploadedAt.toMillis === 'function') {
      return uploadedAt.toMillis();
    }

    if (typeof uploadedAt === 'number' && Number.isFinite(uploadedAt)) {
      return uploadedAt;
    }

    if (typeof uploadedAt === 'string') {
      const time = Date.parse(uploadedAt);
      if (Number.isFinite(time)) {
        return time;
      }
    }

    return 0;
  }

  getPayslipSortIcon(column: string) {
    if (this.payslipSortColumn !== column) return 'fa-sort';
    return this.payslipSortDirection === 'asc' ? 'fa-sort-up' : 'fa-sort-down';
  }

  getPayslipSortLabel(column: string) {
    if (this.payslipSortColumn !== column) return 'Sort';
    return this.payslipSortDirection === 'asc' ? 'Sort ascending' : 'Sort descending';
  }

  // ---------- PDF feature ----------

  get totalParsedNetIncome(): number {
    return this.pdfItems.reduce((sum, item) => sum + (typeof item.netIncome === 'number' ? item.netIncome : 0), 0);
  }

  get canApplyPdfTotal(): boolean {
    return this.totalParsedNetIncome > 0;
  }

  get commonExtractedPeriod(): { monthOnly: string; year: number; creditedDate: string } | null {
    const items = this.pdfItems
      .filter(p => p.status !== 'pending' && p.status !== 'parsing')
      .filter(p => !!p.monthOnly && !!p.year) as Array<PdfIncomeItem & { monthOnly: string; year: number }>;

    if (items.length === 0) return null;

    const first = items[0];
    if (!items.every(p => p.monthOnly === first.monthOnly && p.year === first.year)) return null;

    const idx = this.months.findIndex(m => m === first.monthOnly);
    if (idx < 0) return null;

    const creditedDate = first.creditedDate || this.computeLastWorkingDayIso(first.year, idx);
    return { monthOnly: first.monthOnly, year: first.year, creditedDate };
  }

  onPdfFilesSelected(event: Event) {
    const input = event.target as HTMLInputElement | null;
    const files = input?.files;
    if (!files || files.length === 0) return;

    Array.from(files).forEach(file => {
      const id = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).toString();
      const item: PdfIncomeItem = {
        id,
        fileName: file.name,
        size: file.size,
        status: 'pending',
        netIncome: null,
        pf: null
      };

      this.pdfItems = [item, ...this.pdfItems];
      void this.processPdfFile(item, file);
    });

    // allow selecting the same file again
    if (input) input.value = '';
  }

  applyPdfTotalToSalary() {
    if (!this.canApplyPdfTotal) return;
    this.syncRowMonthYearFromPdfs();
    this.showAddRow = true;
    this.newRow.salary = this.formatCurrency(this.totalParsedNetIncome);
  }

  async addRowFromPdfTotal() {
    if (!this.userEmail || !this.canApplyPdfTotal) return;
    this.syncRowMonthYearFromPdfs();
    this.applyPdfTotalToSalary();
    await this.addRow();
  }

  formatCurrency(amount: number): string {
    try {
      return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      }).format(amount);
    } catch {
      return `₹${amount.toFixed(0)}`;
    }
  }

  private parseMoney(value: any): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const n = parseFloat(String(value ?? '').replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }

  formatSalaryValue(value: any): string {
    const raw = String(value ?? '').trim();
    if (!raw) return '';

    const amount = this.parseMoney(value);
    if (!Number.isFinite(amount) || amount === 0) return raw;

    return this.formatCurrency(amount);
  }

  get highestSalaryRow(): any | null {
    const rows = this.filteredTable ?? [];
    if (!rows.length) return null;

    return rows.reduce((best, row) => {
      return this.parseMoney(row?.salary) > this.parseMoney(best?.salary) ? row : best;
    });
  }

  get lowestSalaryRow(): any | null {
    const rows = this.filteredTable ?? [];
    if (!rows.length) return null;

    return rows.reduce((best, row) => {
      return this.parseMoney(row?.salary) < this.parseMoney(best?.salary) ? row : best;
    });
  }

  get averageSalaryRow(): any | null {
    const rows = this.filteredTable ?? [];
    if (!rows.length) return null;
    const total = rows.reduce((sum, row) => sum + this.parseMoney(row?.salary), 0);
    const average = total / rows.length;
    return { salary: average };
  }


  formatMonthYearTag(row: any): string {
    const monthOnly = String(row?.monthOnly ?? '').trim();
    const year = String(row?.year ?? '').trim();
    if (monthOnly && year) return `${monthOnly}_${year}`;

    const monthYear = String(row?.monthYear ?? '').trim();
    const match = monthYear.match(/^(\d{4})-(\d{2})$/);
    if (!match) return '—';

    const monthIndex = Number(match[2]) - 1;
    if (monthIndex < 0 || monthIndex >= this.months.length) return monthYear;

    return `${this.months[monthIndex]}_${match[1]}`;
  }

  private isPreviewRow(row: any): boolean {
    return String(row?.id ?? '').startsWith(this.pdfPreviewRowPrefix) || row?.preview === true;
  }

  private getMonthYearForDate(d: Date): string {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${yyyy}-${mm}`;
  }

  private getPreviousMonthYear(monthYear: string): string {
    const m = String(monthYear).match(/^(\d{4})-(\d{2})$/);
    if (!m) return '';
    const year = Number(m[1]);
    const month = Number(m[2]);
    if (!Number.isFinite(year) || !Number.isFinite(month)) return '';

    const d = new Date(year, month - 1, 1);
    d.setMonth(d.getMonth() - 1);
    return this.getMonthYearForDate(d);
  }

  private sumSalary(rows: any[]): number {
    return (rows ?? []).reduce((sum, r) => sum + this.parseMoney(r?.salary), 0);
  }

  private getRowsForMonthYear(monthYear: string): any[] {
    const key = typeof monthYear === 'string' ? monthYear : '';
    if (!key) return [];
    return this.globallyFilteredIncomeRows.filter(r => String(r?.monthYear ?? '') === key);
  }

  private pctChange(current: number, previous: number): number | null {
    if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
    if (previous === 0) return null;
    return ((current - previous) / Math.abs(previous)) * 100;
  }

  formatPctChange(pct: number | null): string {
    if (pct == null || !Number.isFinite(pct)) return '—';
    const rounded = Math.round(pct);
    const sign = rounded > 0 ? '+' : '';
    return `${sign}${rounded}%`;
  }

  // Stat card values: ALWAYS total across all rows (as requested)
  get totalIncomeAllTime(): number {
    return this.sumSalary(this.globallyFilteredIncomeRows);
  }

  get totalIncomeMonthsCount(): number {
    return this.getDistinctMonthCount(this.globallyFilteredIncomeRows);
  }

  get totalIncomeAveragePerMonth(): number {
    return this.totalIncomeMonthsCount > 0 ? this.totalIncomeAllTime / this.totalIncomeMonthsCount : 0;
  }

  get overallIncomeMonthsCount(): number {
    return this.getDistinctMonthCount([
      ...this.globallyFilteredIncomeRows,
      ...this.getOtherIncomeRows()
    ]);
  }

  get overallIncomeAveragePerMonth(): number {
    return this.overallIncomeMonthsCount > 0 ? this.overallAllTime / this.overallIncomeMonthsCount : 0;
  }

  get overallAllTime(): number {
    return this.totalIncomeAllTime+this.pfAllTime+this.otherIncomeAllTime;
  }

  get baseSalaryAllTime(): number {
    return this.sumSalary(this.globallyFilteredIncomeRows.filter(r => !this.isPreviewRow(r)));
  }

  get pfAllTime(): number {
    const rows = this.globallyFilteredIncomeRows as any[];
    return rows.reduce((sum, r) => sum + this.parseMoney(r?.pf), 0);
  }

  get pfMonthsCount(): number {
    return this.getDistinctMonthCount(
      this.globallyFilteredIncomeRows.filter((row) => this.parseMoney(row?.pf) > 0)
    );
  }

  get pfAveragePerMonth(): number {
    return this.pfMonthsCount > 0 ? this.pfAllTime / this.pfMonthsCount : 0;
  }

  get latestPfMonthAmount(): number {
    const pfRows = this.globallyFilteredIncomeRows.filter((row) => this.parseMoney(row?.pf) > 0);
    if (!pfRows.length) return 0;

    const latestKey = pfRows.reduce((bestKey, row) => {
      const rowKey = this.getRowMonthYearKey(row);
      return rowKey > bestKey ? rowKey : bestKey;
    }, '');

    return pfRows.reduce((sum, row) => {
      return this.getRowMonthYearKey(row) === latestKey ? sum + this.parseMoney(row?.pf) : sum;
    }, 0);
  }

  get pfChangePct(): number | null {
    const currentKey = this.getStatsCurrentMonthYear();
    const prevKey = this.getPreviousMonthYear(currentKey);

    const current = (this.getRowsForMonthYear(currentKey) ?? []).reduce((sum, r) => sum + this.parseMoney(r?.pf), 0);
    const previous = (this.getRowsForMonthYear(prevKey) ?? []).reduce((sum, r) => sum + this.parseMoney(r?.pf), 0);

    return this.pctChange(current, previous);
  }

  get bonusesAllTime(): number {
    return this.sumSalary(this.globallyFilteredIncomeRows.filter(r => this.isPreviewRow(r)));
  }

  get otherIncomeAllTime(): number {
    return this.sumCharged(this.getOtherIncomeRows());
  }

  get otherIncomeMonthsCount(): number {
    return this.getDistinctMonthCount(this.getOtherIncomeRows());
  }

  get otherIncomeAveragePerMonth(): number {
    return this.otherIncomeMonthsCount > 0 ? this.otherIncomeAllTime / this.otherIncomeMonthsCount : 0;
  }

  get placementIncomeAllTime(): number {
    return this.sumCharged(this.globallyFilteredPlacementChargeRows);
  }

  get technicalIncomeAllTime(): number {
    return this.sumCharged(this.globallyFilteredTechnicalChargeRows);
  }

  private dateIsoToMillis(value: any): number {
    const s = String(value ?? '').trim();
    if (!s) return Number.NaN;
    const t = Date.parse(s.includes('T') ? s : `${s}T00:00:00`);
    return Number.isFinite(t) ? t : Number.NaN;
  }

  private getStatsCurrentMonthYear(): string {
    // Use the latest date present in the grid as the "current" month for the stat subtext.
    // This avoids showing 0% / -100% when the calendar month has no rows.
    let bestKey = '';
    let bestT = -Infinity;

    for (const r of this.globallyFilteredIncomeRows) {
      const dateStr = String(r?.date ?? '').trim();
      const t = this.dateIsoToMillis(dateStr);
      if (!Number.isFinite(t)) continue;

      const rowMonthYear = typeof r?.monthYear === 'string' ? String(r.monthYear) : '';
      const key = rowMonthYear
        ? rowMonthYear
        : dateStr
          ? this.getMonthYearForDate(new Date(dateStr.includes('T') ? dateStr : `${dateStr}T00:00:00`))
          : '';

      if (!key) continue;

      if (t > bestT) {
        bestT = t;
        bestKey = key;
      }
    }

    return bestKey || this.getMonthYearForDate(new Date());
  }

  // Stat card subtext: current vs last month percent change
  get totalIncomeChangePct(): number | null {
    const currentKey = this.getStatsCurrentMonthYear();
    const prevKey = this.getPreviousMonthYear(currentKey);
    const current = this.sumSalary(this.getRowsForMonthYear(currentKey));
    const previous = this.sumSalary(this.getRowsForMonthYear(prevKey));
    return this.pctChange(current, previous);
  }

  get baseSalaryChangePct(): number | null {
    const currentKey = this.getStatsCurrentMonthYear();
    const prevKey = this.getPreviousMonthYear(currentKey);
    const current = this.sumSalary(this.getRowsForMonthYear(currentKey).filter(r => !this.isPreviewRow(r)));
    const previous = this.sumSalary(this.getRowsForMonthYear(prevKey).filter(r => !this.isPreviewRow(r)));
    return this.pctChange(current, previous);
  }

  get bonusesChangePct(): number | null {
    const currentKey = this.getStatsCurrentMonthYear();
    const prevKey = this.getPreviousMonthYear(currentKey);
    const current = this.sumSalary(this.getRowsForMonthYear(currentKey).filter(r => this.isPreviewRow(r)));
    const previous = this.sumSalary(this.getRowsForMonthYear(prevKey).filter(r => this.isPreviewRow(r)));
    return this.pctChange(current, previous);
  }

  get otherIncomeChangePct(): number | null {
    const currentKey = this.getOtherIncomeStatsCurrentMonthYear();
    const prevKey = this.getPreviousMonthYear(currentKey);
    const current = this.sumCharged(this.getOtherIncomeRowsForMonthYear(currentKey));
    const previous = this.sumCharged(this.getOtherIncomeRowsForMonthYear(prevKey));
    return this.pctChange(current, previous);
  }

  private sumCharged(rows: any[]): number {
    return (rows ?? []).reduce((sum, row) => sum + this.parseMoney(row?.charged), 0);
  }

  private getDistinctMonthCount(rows: any[]): number {
    const monthYears = new Set(
      (rows ?? [])
        .map((row) => this.getRowMonthYearKey(row))
        .filter(Boolean)
    );

    return monthYears.size;
  }

  private getRowMonthYearKey(row: any): string {
    const rowMonthYear = typeof row?.monthYear === 'string' ? String(row.monthYear).trim() : '';
    if (rowMonthYear) return rowMonthYear;

    const year = Number(row?.year ?? NaN);
    const monthIndex = this.months.findIndex((month) => month === row?.monthOnly);
    if (Number.isFinite(year) && monthIndex >= 0) {
      return `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
    }

    const dateStr = String(row?.date ?? '').trim();
    if (!dateStr) return '';

    const date = new Date(dateStr.includes('T') ? dateStr : `${dateStr}T00:00:00`);
    return Number.isFinite(date.getTime()) ? this.getMonthYearForDate(date) : '';
  }

  private getOtherIncomeRows(): any[] {
    return [...this.globallyFilteredPlacementChargeRows, ...this.globallyFilteredTechnicalChargeRows];
  }

  private getChargedRowMonthYear(row: any): string {
    const year = Number(row?.year ?? NaN);
    const monthIndex = this.months.findIndex((month) => month === row?.monthOnly);

    if (Number.isFinite(year) && monthIndex >= 0) {
      return `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
    }

    const dateStr = String(row?.date ?? '').trim();
    if (!dateStr) return '';

    const date = new Date(dateStr.includes('T') ? dateStr : `${dateStr}T00:00:00`);
    return Number.isFinite(date.getTime()) ? this.getMonthYearForDate(date) : '';
  }

  private getOtherIncomeRowsForMonthYear(monthYear: string): any[] {
    const key = String(monthYear ?? '').trim();
    if (!key) return [];
    return this.getOtherIncomeRows().filter((row) => this.getChargedRowMonthYear(row) === key);
  }

  private getOtherIncomeStatsCurrentMonthYear(): string {
    let bestKey = '';
    let bestTime = -Infinity;

    for (const row of this.getOtherIncomeRows()) {
      const dateStr = String(row?.date ?? '').trim();
      const time = this.dateIsoToMillis(dateStr);
      const key = this.getChargedRowMonthYear(row);

      if (!key) continue;

      const comparableTime = Number.isFinite(time) ? time : -Infinity;
      if (comparableTime > bestTime) {
        bestTime = comparableTime;
        bestKey = key;
      }
    }

    return bestKey;
  }

  private get globallyFilteredIncomeRows(): any[] {
    return (this.incomeTable ?? []).filter((row) => this.matchesGlobalMonthKey(this.getRowMonthYearKey(row)));
  }

  private get globallyFilteredPlacementChargeRows(): any[] {
    return (this.placementChargeRows ?? []).filter((row) => this.matchesGlobalMonthKey(this.getChargedRowMonthYear(row)));
  }

  private get globallyFilteredTechnicalChargeRows(): any[] {
    return (this.technicalChargeRows ?? []).filter((row) => this.matchesGlobalMonthKey(this.getChargedRowMonthYear(row)));
  }

  private get globallyFilteredCloudPdfUploadsBase(): any[] {
    return (this.cloudPdfUploads ?? []).filter((upload) => {
      const monthYear = String(upload?.monthYear ?? '').trim();
      const fallbackDate = String(upload?.creditedDate ?? '').trim();
      const key = monthYear || (fallbackDate ? fallbackDate.slice(0, 7) : '');
      return this.matchesGlobalMonthKey(key);
    });
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

  getPdfUrlForMonthYear(monthYear: any): string | null {
    const key = typeof monthYear === 'string' ? monthYear : '';
    if (!key) return null;

    const cloud = (this.cloudPdfUploads ?? []).find(
      u => String(u?.monthYear ?? '') === key && typeof u?.downloadUrl === 'string' && !!u.downloadUrl
    );
    if (cloud?.downloadUrl) return String(cloud.downloadUrl);

    const local = (this.pdfItems ?? []).find(
      p => String(p?.monthYear ?? '') === key && typeof p?.downloadUrl === 'string' && !!p.downloadUrl
    );
    if (local?.downloadUrl) return String(local.downloadUrl);

    return null;
  }

  private computeMonthYear(year: any, monthOnly: any): string {
    const y = Number(year);
    if (!Number.isFinite(y)) return '';
    const monthIndex = this.months.findIndex(m => m === monthOnly);
    if (monthIndex < 0) return '';
    return `${y}-${(monthIndex + 1).toString().padStart(2, '0')}`;
  }

  onNewRowPeriodChange() {
    this.newRow.monthYear = this.computeMonthYear(this.newRow.year, this.newRow.monthOnly);
    this.syncManualRowDate();
  }

  private computeLastWorkingDayIso(year: number, monthIndex: number): string {
    // monthIndex: 0 (Jan) .. 11 (Dec)
    let d = new Date(year, monthIndex + 1, 0); // last day of month
    const day = d.getDay(); // 0=Sun, 6=Sat
    if (day === 6) d = new Date(year, monthIndex + 1, -1); // Sat -> Fri
    if (day === 0) d = new Date(year, monthIndex + 1, -2); // Sun -> Fri

    // Use local date parts (avoid UTC shift from toISOString)
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  private syncManualRowDate() {
    const year = Number(this.newRow.year);
    const monthIndex = this.months.findIndex(m => m === this.newRow.monthOnly);
    if (!Number.isFinite(year) || monthIndex < 0) {
      this.newRow.date = '';
      return;
    }

    this.newRow.date = this.computeLastWorkingDayIso(year, monthIndex);
  }

  private syncRowMonthYearFromPdfs() {
    const monthYears = this.pdfItems
      .map(p => p.monthYear)
      .filter((v): v is string => typeof v === 'string' && v.length > 0);

    if (monthYears.length === 0) return;

    const common = monthYears[0];
    if (!monthYears.every(m => m === common)) return;

    const item = this.pdfItems.find(p => p.monthYear === common);
    if (!item?.monthOnly || !item?.year) return;

    this.newRow.monthOnly = item.monthOnly;
    this.newRow.year = item.year;
    this.newRow.monthYear = common;

    // Date rule: last working day of the extracted month/year
    const idx = this.months.findIndex(m => m === item.monthOnly);
    if (idx >= 0) {
      this.newRow.date = this.computeLastWorkingDayIso(item.year, idx);
    }
  }

  private autoPrefillRowFromPdfs() {
    // User asked: do not prefill form/filters; only add preview rows to the grid after upload.
    this.upsertPdfPreviewRows();
  }

  private removePdfPreviewRows(rows: any[]): any[] {
    return (rows ?? []).filter(r => !String(r?.id ?? '').startsWith(this.pdfPreviewRowPrefix));
  }

  private mergePdfPreviewRows(rows: any[]): any[] {
    const base = this.removePdfPreviewRows(rows);

    if (!this.pdfPreviewRows.length) return base;

    const existingKeys = new Set(base.map(r => `${String(r?.monthYear ?? '')}|${String(r?.date ?? '')}`));
    const previews = this.pdfPreviewRows.filter(p => !existingKeys.has(`${p.monthYear}|${p.date}`));

    return [...previews, ...base];
  }

  private upsertPdfPreviewRows() {
    // Build preview rows grouped by monthYear so multiple uploads don't delete previous months.
    // Use BOTH local parsed PDFs (pdfItems) and cloud-stored uploads (cloudPdfUploads) so data shows after logout/login.

    const groups = new Map<
      string,
      {
        monthYear: string;
        monthOnly: string;
        year: number;
        creditedDate: string;
        total: number;
        pfTotal: number;
        pfPresent: boolean;
      }
    >();

    const cloudPaths = new Set(
      (this.cloudPdfUploads ?? [])
        .map(u => (typeof u?.storagePath === 'string' ? u.storagePath : ''))
        .filter(p => !!p)
    );

    const addToGroup = (p: {
      netIncome: number;
      pf?: number | null;
      monthOnly: string;
      year: number;
      monthYear: string;
      creditedDate?: string | null;
    }) => {
      const idx = this.months.findIndex(m => m === p.monthOnly);
      const creditedDate = p.creditedDate || (idx >= 0 ? this.computeLastWorkingDayIso(p.year, idx) : '');
      if (!creditedDate) return;

      const pf = typeof p.pf === 'number' && Number.isFinite(p.pf) ? p.pf : null;

      const existing = groups.get(p.monthYear);
      if (!existing) {
        groups.set(p.monthYear, {
          monthYear: p.monthYear,
          monthOnly: p.monthOnly,
          year: p.year,
          creditedDate,
          total: p.netIncome,
          pfTotal: pf ?? 0,
          pfPresent: pf != null
        });
      } else {
        existing.total += p.netIncome;
        if (pf != null) {
          existing.pfTotal += pf;
          existing.pfPresent = true;
        }
      }
    };

    // 1) Cloud uploads (persisted across sessions)
    for (const u of this.cloudPdfUploads ?? []) {
      const netIncome = typeof u?.netIncome === 'number' ? u.netIncome : null;
      const monthOnly = typeof u?.monthOnly === 'string' ? u.monthOnly : null;
      const year = typeof u?.year === 'number' ? u.year : null;
      const monthYear = typeof u?.monthYear === 'string' ? u.monthYear : null;
      const creditedDate = typeof u?.creditedDate === 'string' ? u.creditedDate : null;

      const pf = typeof u?.pf === 'number' ? u.pf : null;

      if (netIncome == null || !monthOnly || year == null || !monthYear) continue;
      addToGroup({ netIncome, pf, monthOnly, year, monthYear, creditedDate });
    }

    // 2) Local parsed PDFs (dedupe against cloud by storagePath if available)
    for (const p of this.pdfItems) {
      if (p.status === 'parsing' || p.status === 'pending') continue;
      if (typeof p.netIncome !== 'number') continue;
      if (!p.monthYear || !p.monthOnly || !p.year) continue;

      if (p.storagePath && cloudPaths.has(p.storagePath)) {
        // already included from cloud uploads
        continue;
      }

      addToGroup({
        netIncome: p.netIncome,
        pf: typeof p.pf === 'number' ? p.pf : null,
        monthOnly: p.monthOnly,
        year: p.year,
        monthYear: p.monthYear,
        creditedDate: p.creditedDate ?? null
      });
    }

    this.pdfPreviewRows = Array.from(groups.values())
      .sort((a, b) => (a.creditedDate < b.creditedDate ? 1 : a.creditedDate > b.creditedDate ? -1 : 0))
      .map(g => ({
        id: `${this.pdfPreviewRowPrefix}${g.monthYear}`,
        year: g.year,
        monthOnly: g.monthOnly,
        month: `${g.monthOnly} ${g.year}`,
        salary: this.formatCurrency(g.total),
        pf: g.pfPresent ? this.formatCurrency(g.pfTotal) : '—',
        date: g.creditedDate,
        monthYear: g.monthYear,
        email: this.userEmail ?? 'local',
        preview: true
      }));

    this.incomeTable = this.mergePdfPreviewRows(this.incomeTable);
    this.setUniqueOptions();
    this.applyFilters();
  }

  private extractPayslipMonthYearFromText(rawText: string): { monthOnly: string; year: number; monthYear: string; creditedDate: string } | null {
    const text = rawText.replace(/\s+/g, ' ').trim();
    if (!text) return null;

    const monthTokenRe = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
    const yearRe = '(19\\d{2}|20\\d{2})';

    // Prefer explicit payslip header if present
    const payslipRe = new RegExp(`\\bpayslip\\b\\s*[:\\-]?\\s*${monthTokenRe}\\s+${yearRe}\\b`, 'i');
    const genericRe = new RegExp(`\\b${monthTokenRe}\\b\\s+${yearRe}\\b`, 'i');

    const match = payslipRe.exec(text) ?? genericRe.exec(text);
    if (!match) return null;

    const token = String(match[1]).slice(0, 3).toLowerCase();
    const year = Number(match[2]);

    const monthIndexByToken: Record<string, number> = {
      jan: 0,
      feb: 1,
      mar: 2,
      apr: 3,
      may: 4,
      jun: 5,
      jul: 6,
      aug: 7,
      sep: 8,
      oct: 9,
      nov: 10,
      dec: 11
    };

    const idx = monthIndexByToken[token];
    if (idx == null || !Number.isFinite(year)) return null;

    const monthOnly = this.months[idx];
    const monthYear = `${year}-${String(idx + 1).padStart(2, '0')}`;
    const creditedDate = this.computeLastWorkingDayIso(year, idx);

    return { monthOnly, year, monthYear, creditedDate };
  }

  private async processPdfFile(item: PdfIncomeItem, file: File) {
    if (file.type !== 'application/pdf') {
      item.status = 'failed';
      item.error = 'Only PDF files are supported.';
      return;
    }
    if (file.size > this.maxPdfBytes) {
      item.status = 'failed';
      item.error = `PDF is too large (max ${(this.maxPdfBytes / (1024 * 1024)).toFixed(0)}MB).`;
      return;
    }

    try {
      item.status = 'parsing';
      const info = await this.extractPayslipInfoFromPdf(file);

      item.netIncome = info.netIncome;
      item.pf = info.pf;
      item.monthOnly = info.monthOnly;
      item.year = info.year;
      item.monthYear = info.monthYear;
      item.creditedDate = info.creditedDate;

      // Display name: MonthName_Year.pdf (when available)
      if (info.monthOnly && info.year) {
        item.fileName = `${info.monthOnly}_${info.year}.pdf`;
      }

      item.status = info.netIncome == null ? 'failed' : 'parsed';
      if (info.netIncome == null) {
        item.error = 'Could not find Net Pay / Net Income in this PDF.';
        this.autoPrefillRowFromPdfs();
        return;
      }

      // Only add/update the preview row in the grid after parsing
      this.autoPrefillRowFromPdfs();

      if (this.savePdfsToCloud && this.userEmail) {
        item.status = 'uploading';
        const stored = await this.storePdfToGoogleDrive(
          file,
          info.netIncome,
          info.pf,
          info.monthOnly,
          info.year,
          info.monthYear,
          info.creditedDate
        );
        item.storagePath = stored.storagePath;
        item.downloadUrl = stored.downloadUrl;
        item.status = 'stored';
      }
    } catch (e: any) {
      item.status = 'failed';
      item.error = e?.message ? String(e.message) : 'Failed to process PDF.';
    }
  }

  private async storePdfToGoogleDrive(
    file: File,
    netIncome: number,
    pf: number | null,
    monthOnly: string | null,
    year: number | null,
    monthYear: string | null,
    creditedDate: string | null
  ): Promise<{ storagePath: string; downloadUrl: string }> {
    if (!this.userEmail) throw new Error('Not signed in.');

    const accessToken = sessionStorage.getItem('googleAccessToken');
    if (!accessToken) {
      throw new Error('Google Drive access is not available. Please sign out and sign in again, then allow Drive access.');
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const id = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).toString();

    const derivedBase = monthOnly && year ? `${monthOnly}_${year}` : '';
    const derivedSafe = derivedBase ? derivedBase.replace(/[^a-zA-Z0-9._-]/g, '_') : '';
    const derivedName = derivedSafe ? `${derivedSafe}.pdf` : '';

    const driveFileName = derivedName || `${id}-${safeName}`;

    const boundary = `-------asv-${id.replace(/[^a-zA-Z0-9]/g, '')}`;
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const metadata = { name: driveFileName };
    const bytes = new Uint8Array(await file.arrayBuffer());

    const multipartBody = new Blob(
      [
        delimiter,
        'Content-Type: application/json; charset=UTF-8\r\n\r\n',
        JSON.stringify(metadata),
        delimiter,
        `Content-Type: ${file.type || 'application/pdf'}\r\n\r\n`,
        bytes,
        closeDelimiter
      ],
      { type: `multipart/related; boundary=${boundary}` }
    );

    const res = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`
        },
        body: multipartBody
      }
    );

    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = json?.error?.message ? String(json.error.message) : `Drive upload failed (${res.status}).`;
      throw new Error(msg);
    }

    const driveFileId = String(json?.id ?? '');
    const webViewLink = json?.webViewLink ? String(json.webViewLink) : `https://drive.google.com/file/d/${driveFileId}/view`;
    if (!driveFileId) throw new Error('Drive upload did not return a file id.');

    const storagePath = `gdrive:${driveFileId}`;

    await nativeAddDoc(collection(this.firestore, 'salaryPdfUploads'), {
      email: this.userEmail,
      fileName: driveFileName,
      size: file.size,
      storageProvider: 'gdrive',
      driveFileId,
      storagePath,
      downloadUrl: webViewLink,
      netIncome,
      pf: typeof pf === 'number' && Number.isFinite(pf) ? pf : null,
      monthOnly: monthOnly ?? null,
      year: year ?? null,
      monthYear: monthYear ?? null,
      creditedDate: creditedDate ?? null,
      uploadedAt: serverTimestamp()
    });

    return { storagePath, downloadUrl: webViewLink };
  }

  private getDriveFileId(value: any): string | null {
    const explicit = typeof value?.driveFileId === 'string' ? value.driveFileId : null;
    if (explicit) return explicit;

    const storagePath = typeof value?.storagePath === 'string' ? value.storagePath : '';
    if (storagePath.startsWith('gdrive:')) return storagePath.slice('gdrive:'.length);

    const url = typeof value?.downloadUrl === 'string' ? value.downloadUrl : '';
    const m = url.match(/\/d\/([^/]+)/) ?? url.match(/[?&]id=([^&]+)/);
    return m ? m[1] : null;
  }

  private async deleteDriveFile(driveFileId: string): Promise<void> {
    const accessToken = sessionStorage.getItem('googleAccessToken');
    if (!accessToken) {
      throw new Error('Google Drive access is not available. Please sign out and sign in again, then allow Drive access.');
    }

    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveFileId)}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    // 204 = deleted, 404 = already gone
    if (res.status === 204 || res.status === 404) return;

    if (res.status === 401 || res.status === 403) {
      throw new Error('Drive permission expired or not granted. Sign out and sign in again, then try delete again.');
    }

    const txt = await res.text().catch(() => '');
    throw new Error(txt || `Drive delete failed (${res.status}).`);
  }

  async deleteStoredPdf(upload: any, skipConfirm = false) {
    if (!this.userEmail) return;

    const uploadId = String(upload?.id ?? '');
    if (!uploadId) return;

    if (!skipConfirm) {
      const name = upload?.fileName ? ` (${upload.fileName})` : '';
      this.openConfirmDialog(
        'Delete payslip PDF?',
        `Delete this PDF${name}? This is permanent.`,
        async () => {
          await this.deleteStoredPdf(upload, true);
        }
      );
      return;
    }

    this.deletingPdfId = uploadId;
    this.rowAddError = null;

    try {
      const driveFileId = this.getDriveFileId(upload);
      let driveDeleteError: string | null = null;

      if (driveFileId) {
        try {
          await this.deleteDriveFile(driveFileId);
        } catch (e: any) {
          driveDeleteError = e?.message ? String(e.message) : 'Failed to delete from Google Drive.';
        }
      }

      // Optimistic UI update
      this.cloudPdfUploads = (this.cloudPdfUploads ?? []).filter(u => String(u?.id ?? '') !== uploadId);
      this.setPayslipUniqueOptions();
      this.applyPayslipFilters();
      this.pdfItems = (this.pdfItems ?? []).filter(p => p?.storagePath !== upload?.storagePath);
      this.upsertPdfPreviewRows();

      await deleteDoc(doc(this.firestore, 'salaryPdfUploads', uploadId));

      if (driveDeleteError) {
        this.rowAddError = `Deleted from app, but could not delete from Google Drive: ${driveDeleteError}`;
      }
    } catch (e: any) {
      console.error('Failed to delete stored PDF:', e);
      this.rowAddError = e?.message ? String(e.message) : 'Failed to delete PDF.';
      this.loadPdfUploads();
    } finally {
      this.deletingPdfId = null;
    }
  }

  async deletePdfItem(item: PdfIncomeItem, skipConfirm = false) {
    const id = String(item?.id ?? '');
    if (!id) return;

    if (!skipConfirm) {
      const name = item?.fileName ? ` (${item.fileName})` : '';
      this.openConfirmDialog(
        'Delete payslip PDF?',
        `Delete this PDF${name}? This is permanent.`,
        async () => {
          await this.deletePdfItem(item, true);
        }
      );
      return;
    }

    // If it is stored, delete via the stored upload doc (removes Firestore record + Drive file)
    if (item.storagePath) {
      const upload = (this.cloudPdfUploads ?? []).find(u => String(u?.storagePath ?? '') === String(item.storagePath));
      if (upload) {
        await this.deleteStoredPdf(upload, true);
        // deleteStoredPdf already updates pdfItems + previews
        return;
      }

      // Fallback: attempt Drive delete even if Firestore doc is missing
      const driveFileId = this.getDriveFileId(item);
      if (driveFileId) {
        this.deletingPdfId = id;
        try {
          await this.deleteDriveFile(driveFileId);
        } catch (e: any) {
          this.rowAddError = e?.message ? String(e.message) : 'Failed to delete PDF from Google Drive.';
        } finally {
          this.deletingPdfId = null;
        }
      }
    }

    // Local-only removal
    this.pdfItems = (this.pdfItems ?? []).filter(p => String(p?.id ?? '') !== id);
    this.upsertPdfPreviewRows();
  }

  private async extractPayslipInfoFromPdf(file: File): Promise<{
    netIncome: number | null;
    pf: number | null;
    monthOnly: string | null;
    year: number | null;
    monthYear: string | null;
    creditedDate: string | null;
  }> {
    const pdfjs = await this.getPdfJs();
    const data = await file.arrayBuffer();

    const loadingTask = pdfjs.getDocument({ data });
    const pdf = await loadingTask.promise;

    const maxPages = Math.min(pdf.numPages, 30);
    let text = '';

    for (let pageNumber = 1; pageNumber <= maxPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = (content.items || [])
        .map((it: any) => (typeof it?.str === 'string' ? it.str : ''))
        .join(' ');
      text += ` ${pageText}`;
    }

    const netIncome = this.extractNetIncomeFromText(text);
    const pf = this.extractProvidentFundFromText(text);
    const monthYearInfo = this.extractPayslipMonthYearFromText(text);

    return {
      netIncome,
      pf,
      monthOnly: monthYearInfo?.monthOnly ?? null,
      year: monthYearInfo?.year ?? null,
      monthYear: monthYearInfo?.monthYear ?? null,
      creditedDate: monthYearInfo?.creditedDate ?? null
    };
  }

  private async getPdfJs(): Promise<any> {
    if (!this.pdfjsLib) {
      this.pdfjsLib = await import('pdfjs-dist');
    }

    if (!this.pdfWorkerReady) {
      // Worker file is copied into /assets via angular.json (no external URLs)
      this.pdfjsLib.GlobalWorkerOptions.workerSrc = '/assets/pdfjs/pdf.worker.min.mjs';
      this.pdfWorkerReady = true;
    }

    return this.pdfjsLib;
  }

  private extractNetIncomeFromText(rawText: string): number | null {
    const text = rawText.replace(/\s+/g, ' ').trim();
    if (!text) return null;

    const candidates: number[] = [];

    // Support both Western and Indian comma-grouping (e.g., 1,234,567 and 1,32,346)
    // Prefer the comma-grouped alternative first so we don't match only the leading "1" in "1,32,346".
    const amount = '((?:[0-9]{1,3}(?:,[0-9]{2,3})+(?:\\.[0-9]{1,2})?)|(?:[0-9]+(?:\\.[0-9]{1,2})?))';

    // Direct patterns (supports: "Net Pay (INR) 63,320.00")
    const directPatterns = [
      new RegExp(`\\bnet\\s*pay\\b\\s*(?:\\([^)]*\\))?\\s*[:\\-]?\\s*(?:usd|inr|rs\\.?|₹|\\$)?\\s*${amount}`, 'ig'),
      new RegExp(`\\bnet\\s*(?:income|amount)\\b\\s*(?:\\([^)]*\\))?\\s*[:\\-]?\\s*(?:usd|inr|rs\\.?|₹|\\$)?\\s*${amount}`, 'ig'),
      new RegExp(`\\btake\\s*home\\b\\s*(?:\\([^)]*\\))?\\s*[:\\-]?\\s*(?:usd|inr|rs\\.?|₹|\\$)?\\s*${amount}`, 'ig')
    ];

    for (const re of directPatterns) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const raw = m[1];
        const num = Number(String(raw).replace(/,/g, ''));
        if (Number.isFinite(num)) candidates.push(num);
      }
    }

    if (candidates.length > 0) return candidates[candidates.length - 1];

    // Fallback: find any "net pay" label and grab the closest number that follows
    const labelRe = /\bnet\s*pay\b|\bnet\s*income\b|\bnet\s*amount\b|\btake\s*home\b|\bnet\s*salary\b/ig;
    const windowAmountRe = new RegExp(amount, 'g');

    let labelMatch: RegExpExecArray | null;
    while ((labelMatch = labelRe.exec(text)) !== null) {
      const windowText = text.slice(labelMatch.index, labelMatch.index + 220);

      let am: RegExpExecArray | null;
      while ((am = windowAmountRe.exec(windowText)) !== null) {
        const raw = am[1];
        const num = Number(String(raw).replace(/,/g, ''));
        if (Number.isFinite(num)) candidates.push(num);
      }
      windowAmountRe.lastIndex = 0;
    }

    return candidates.length ? candidates[candidates.length - 1] : null;
  }

  private extractProvidentFundFromText(rawText: string): number | null {
    const text = rawText.replace(/\s+/g, ' ').trim();
    if (!text) return null;

    const candidates: number[] = [];

    // Support both Western and Indian comma-grouping (e.g., 1,234 and 1,32,346)
    const amount = '(-?(?:[0-9]{1,3}(?:,[0-9]{2,3})+(?:\\.[0-9]{1,2})?)|(?:[0-9]+(?:\\.[0-9]{1,2})?))';

    const directPatterns = [
      new RegExp(`\\bprovident\\s*fund\\b\\s*(?:\\([^)]*\\))?\\s*[:\\-]?\\s*(?:inr|rs\\.?|₹)?\\s*${amount}`, 'ig'),
      new RegExp(`\\bemployee\\s*(?:provident\\s*fund|pf)\\b\\s*(?:\\([^)]*\\))?\\s*[:\\-]?\\s*(?:inr|rs\\.?|₹)?\\s*${amount}`, 'ig'),
      new RegExp(`\\b(?:epf|e\\.?p\\.?f\\.?)\\b\\s*(?:contribution)?\\s*(?:\\([^)]*\\))?\\s*[:\\-]?\\s*(?:inr|rs\\.?|₹)?\\s*${amount}`, 'ig'),
      new RegExp(`\\bpf\\b\\s*(?:contribution|deduction)?\\s*(?:\\([^)]*\\))?\\s*[:\\-]?\\s*(?:inr|rs\\.?|₹)?\\s*${amount}`, 'ig')
    ];

    for (const re of directPatterns) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const raw = m[1];
        const num = Number(String(raw).replace(/,/g, ''));
        if (Number.isFinite(num)) candidates.push(Math.abs(num));
      }
    }

    if (candidates.length > 0) return candidates[candidates.length - 1];

    const labelRe = /\bprovident\s*fund\b|\bemployee\s*pf\b|\bpf\s*contribution\b|\bepf\b/ig;
    const windowAmountRe = new RegExp(amount, 'g');

    let labelMatch: RegExpExecArray | null;
    while ((labelMatch = labelRe.exec(text)) !== null) {
      const windowText = text.slice(labelMatch.index, labelMatch.index + 220);

      let am: RegExpExecArray | null;
      while ((am = windowAmountRe.exec(windowText)) !== null) {
        const raw = am[1];
        const num = Number(String(raw).replace(/,/g, ''));
        if (Number.isFinite(num)) {
          candidates.push(Math.abs(num));
          break;
        }
      }
      windowAmountRe.lastIndex = 0;
    }

    return candidates.length ? candidates[candidates.length - 1] : null;
  }
}
