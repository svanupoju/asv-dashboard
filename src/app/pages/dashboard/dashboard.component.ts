import { Component, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { getApps, initializeApp } from 'firebase/app';
import { addDoc, collection, deleteDoc, doc, getFirestore, onSnapshot, query, updateDoc, where } from 'firebase/firestore';
import { getAuth, onAuthStateChanged, User } from 'firebase/auth';
import { environment } from '../../../environments/environment';
import { GlobalPeriodFilterService } from '../../shared/services/global-period-filter.service';

type SalaryDashboardRow = {
  id?: string;
  salary?: string | number;
  pf?: string | number;
  monthOnly?: string;
  year?: number | string;
  monthYear?: string;
  date?: string;
  email?: string;
};

type SalaryPdfUploadRow = {
  id?: string;
  netIncome?: number | string | null;
  pf?: number | string | null;
  monthOnly?: string | null;
  year?: number | string | null;
  monthYear?: string | null;
  creditedDate?: string | null;
  uploadedAt?: any;
  email?: string;
};

type PlacementDashboardRow = {
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

type TechnicalDashboardRow = {
  id?: string;
  name: string;
  company: string;
  charged: string;
  monthOnly: string;
  year: number | string;
  date: string;
  email: string;
};

type FixedInvestmentRow = {
  id?: string;
  assetName: string;
  institution: string;
  category: string;
  investedAmount: string;
  currentValue: string;
  date: string;
  notes: string;
  email: string;
};

type MonthlyDebitRow = {
  id?: string;
  category: string;
  amount: string;
  monthOnly: string;
  year: number | string;
  date: string;
  notes: string;
  email: string;
};

type LoanStatus = 'active' | 'cleared';

type LoanRow = {
  id?: string;
  lender: string;
  principal: string;
  outstanding: string;
  emi: string;
  status: LoanStatus;
  monthOnly: string;
  year: number | string;
  date: string;
  notes: string;
  email: string;
};

type MoneyMapRow = {
  id?: string;
  label: string;
  value: number;
  kind: 'manual' | 'derived';
  isSavings?: boolean;
};

type MoneyMapCategoryRow = {
  id?: string;
  label: string;
  isSavings?: boolean;
  date: string;
  email: string;
};

type MissingBreakdownRow = {
  label: string;
  value: number;
};

type EarningsChartRow = {
  label: string;
  value: number;
  pct: number;
  tone: 'salary' | 'pf' | 'placement' | 'technical';
};

type SpendingsChartRow = {
  label: string;
  value: number;
  pct: number;
  color: string;
};

type ChartHoverSlice = {
  label: string;
  value: number;
  pct: number;
  color: string;
  dasharray: string;
  dashoffset: string;
  tooltipX: number;
  tooltipY: number;
  tooltipSide: 'left' | 'right';
};

type TrendChartPoint = {
  key: string;
  label: string;
  earnings: number;
  spending: number;
  earningsHeightPct: number;
  spendingHeightPct: number;
};

type TrendChartAxisTick = {
  value: number;
  y: number;
};

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent implements OnDestroy {
  private readonly earningsChartToneColors: Record<EarningsChartRow['tone'], string> = {
    salary: '#4aa3ff',
    pf: '#1bc5bd',
    placement: '#d4a11d',
    technical: '#d44b5b'
  };

  private readonly moneyMappedBreakdownPalette = [
    '#1bc5bd',
    '#4aa3ff',
    '#ff9f43',
    '#ff5d73',
    '#9b7bff',
    '#d4a11d',
    '#5fd0a5',
    '#f67280',
    '#6c8cff',
    '#c890ff'
  ];

  hoveredEarningsSliceIndex: number | null = null;
  hoveredSpendingsSliceIndex: number | null = null;
  globalFilterSelections: Record<string, string[]> = {};

  months: string[] = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  readonly defaultMoneyMapCategories: string[] = [
    'Savings for God',
    'Land Investments',
    'Gold Purchases',
    'Vehicle Maintenance',
    'Mutual Funds',
    'Stocks',
    'Current Bank Balance',
    'Miscellaneous Spendings'
  ];

  readonly derivedMoneyMapCategories: string[] = [
    'Missing',
    'In PF',
  ];

  readonly defaultSavingsCategoryLabels = new Set([
    'savings for god',
    'land investments',
    'gold purchases',
    'mutual funds',
    'stocks',
    'current bank balance'
  ]);

  selectedInvestmentCategory = this.defaultMoneyMapCategories[0];

  firestore;
  user: User | null = null;
  userEmail: string | null = null;
  authChecked = false;

  dashboardLoadError: string | null = null;
  investmentError: string | null = null;
  categoryError: string | null = null;
  debitError: string | null = null;
  loanError: string | null = null;

  investmentAddInProgress = false;
  categoryAddInProgress = false;
  debitAddInProgress = false;
  loanAddInProgress = false;
  updatingCategorySavingsId: string | null = null;
  editingCategoryId: string | null = null;

  deletingInvestmentId: string | null = null;
  deletingCategoryId: string | null = null;
  deletingDebitId: string | null = null;
  deletingLoanId: string | null = null;

  editingInvestmentId: string | null = null;
  editingDebitId: string | null = null;
  editingLoanId: string | null = null;

  salaryRows: SalaryDashboardRow[] = [];
  salaryPdfUploads: SalaryPdfUploadRow[] = [];
  placementRows: PlacementDashboardRow[] = [];
  technicalRows: TechnicalDashboardRow[] = [];
  moneyMapCategories: MoneyMapCategoryRow[] = [];
  fixedInvestments: FixedInvestmentRow[] = [];
  monthlyDebits: MonthlyDebitRow[] = [];
  loanRows: LoanRow[] = [];

  newMoneyMapCategory = '';
  newMoneyMapCategoryIsSavings = true;
  editingMoneyMapCategoryLabel = '';
  editingMoneyMapCategoryIsSavings = true;

  investmentFilters = {
    assetName: '',
    institution: '',
    date: ''
  };

  pfFilters = {
    monthYear: '',
    date: ''
  };

  debitFilters = {
    category: '',
    monthYear: '',
    date: ''
  };

  loanFilters = {
    lender: '',
    monthYear: '',
    date: ''
  };

  newInvestment: Omit<FixedInvestmentRow, 'email'> = {
    assetName: '',
    institution: '',
    category: this.selectedInvestmentCategory,
    investedAmount: '',
    currentValue: '',
    date: '',
    notes: ''
  };

  newDebit: Omit<MonthlyDebitRow, 'email'> = {
    category: '',
    amount: '',
    monthOnly: '',
    year: '',
    date: '',
    notes: ''
  };

  newLoan: Omit<LoanRow, 'email'> = {
    lender: '',
    principal: '',
    outstanding: '',
    emi: '',
    status: 'active',
    monthOnly: '',
    year: '',
    date: '',
    notes: ''
  };

  private unsubscribers: Array<() => void> = [];
  private hasInitializedMoneyMapCategories = false;
  private vehicleMaintenanceCategoryEnsuring = false;
  private globalFilterSubscription?: Subscription;

  constructor(private readonly globalPeriodFilterService: GlobalPeriodFilterService) {
    if (!getApps().length) {
      initializeApp(environment.firebase);
    }

    this.firestore = getFirestore();
    this.resetForms();

    this.globalFilterSubscription = this.globalPeriodFilterService.filter$.subscribe((filter) => {
      this.globalFilterSelections = this.cloneGlobalFilterSelections(filter?.selections);
    });

    onAuthStateChanged(getAuth(), (user) => {
      this.user = user;
      const persistedEmail = sessionStorage.getItem('email');
      this.userEmail = user?.email ?? persistedEmail ?? null;
      this.authChecked = true;

      if (user?.email) {
        sessionStorage.setItem('email', user.email);
      }

      this.clearSubscriptions();

      if (this.userEmail) {
        this.dashboardLoadError = null;
        this.loadDashboardData();
      } else {
        this.clearDashboardData();
      }
    });
  }

  ngOnDestroy(): void {
    this.globalFilterSubscription?.unsubscribe();
    this.clearSubscriptions();
  }

  private loadDashboardData() {
    this.subscribeToCollection<SalaryDashboardRow>('salaryRows', (rows) => {
      this.salaryRows = rows;
    }, (message) => {
      this.dashboardLoadError = message;
      this.salaryRows = [];
    });

    this.subscribeToCollection<SalaryPdfUploadRow>('salaryPdfUploads', (rows) => {
      this.salaryPdfUploads = rows;
    }, (message) => {
      this.dashboardLoadError = message;
      this.salaryPdfUploads = [];
    });

    this.subscribeToCollection<PlacementDashboardRow>('placementAssisted', (rows) => {
      this.placementRows = rows;
    }, (message) => {
      this.dashboardLoadError = message;
      this.placementRows = [];
    });

    this.subscribeToCollection<TechnicalDashboardRow>('technicalSupport', (rows) => {
      this.technicalRows = rows;
    }, (message) => {
      this.dashboardLoadError = message;
      this.technicalRows = [];
    });

    this.subscribeToCollection<MoneyMapCategoryRow>('moneyMapCategories', (rows) => {
      this.moneyMapCategories = rows;
      this.categoryError = null;

      if (!this.hasInitializedMoneyMapCategories && !rows.length) {
        this.seedDefaultMoneyMapCategories();
      }

      this.hasInitializedMoneyMapCategories = true;

      this.ensureVehicleMaintenanceCategory();

      this.ensureSelectedCategory();
    }, (message) => {
      this.categoryError = message;
      this.moneyMapCategories = [];
    });

    this.subscribeToCollection<FixedInvestmentRow>('fixedInvestments', (rows) => {
      this.fixedInvestments = rows;
      this.investmentError = null;
    }, (message) => {
      this.investmentError = message;
      this.fixedInvestments = [];
    });

    this.subscribeToCollection<MonthlyDebitRow>('monthlyDebits', (rows) => {
      this.monthlyDebits = rows;
      this.debitError = null;
    }, (message) => {
      this.debitError = message;
      this.monthlyDebits = [];
    });

    this.subscribeToCollection<LoanRow>('loanEntries', (rows) => {
      this.loanRows = rows.map((row) => ({
        ...row,
        status: row.status === 'cleared' ? 'cleared' : 'active'
      }));
      this.loanError = null;
    }, (message) => {
      this.loanError = message;
      this.loanRows = [];
    });
  }

  private subscribeToCollection<T extends { id?: string; date?: string }>(
    collectionName: string,
    onRows: (rows: T[]) => void,
    onError: (message: string) => void
  ) {
    const email = this.userEmail ?? sessionStorage.getItem('email');
    if (!email) return;

    const rowsRef = collection(this.firestore, collectionName);
    const rowsQuery = query(rowsRef, where('email', '==', email));

    const unsubscribe = onSnapshot(
      rowsQuery,
      (snapshot) => {
        const rows = snapshot.docs
          .map((item) => ({ id: item.id, ...(item.data() as T) }))
          .sort((left: any, right: any) => String(right?.date ?? '').localeCompare(String(left?.date ?? '')));
        onRows(rows);
      },
      (error: any) => {
        console.error(`Dashboard listener error for ${collectionName}:`, error);
        if (error?.code === 'permission-denied') {
          onError(`Permission denied loading ${collectionName}. Update Firestore rules for your account.`);
        } else {
          onError(error?.message ? String(error.message) : `Failed to load ${collectionName}.`);
        }
      }
    );

    this.unsubscribers.push(unsubscribe);
  }

  private clearSubscriptions() {
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers = [];
  }

  private clearDashboardData() {
    this.dashboardLoadError = null;
    this.investmentError = null;
    this.categoryError = null;
    this.debitError = null;
    this.loanError = null;
    this.salaryRows = [];
    this.salaryPdfUploads = [];
    this.placementRows = [];
    this.technicalRows = [];
    this.moneyMapCategories = [];
    this.fixedInvestments = [];
    this.monthlyDebits = [];
    this.loanRows = [];
    this.hasInitializedMoneyMapCategories = false;
  }

  private resetForms() {
    const now = new Date();
    const currentMonth = this.months[now.getMonth()];
    const currentYear = now.getFullYear();

    this.newInvestment = {
      assetName: '',
      institution: '',
      category: this.selectedInvestmentCategory,
      investedAmount: '',
      currentValue: '',
      date: this.toDateInputValue(now),
      notes: ''
    };

    this.newDebit = {
      category: '',
      amount: '',
      monthOnly: currentMonth,
      year: currentYear,
      date: this.computeLastWorkingDayIso(currentYear, now.getMonth()),
      notes: ''
    };

    this.newLoan = {
      lender: '',
      principal: '',
      outstanding: '',
      emi: '',
      status: 'active',
      monthOnly: currentMonth,
      year: currentYear,
      date: this.computeLastWorkingDayIso(currentYear, now.getMonth()),
      notes: ''
    };
  }

  onDebitPeriodChange() {
    this.syncPeriodicDate(this.newDebit);
  }

  onLoanPeriodChange() {
    this.syncPeriodicDate(this.newLoan);
  }

  onLoanStatusChange() {
    if (this.newLoan.status === 'cleared' && !String(this.newLoan.outstanding ?? '').trim()) {
      this.newLoan.outstanding = '0';
    }
  }

  private syncPeriodicDate(target: { monthOnly: string; year: number | string; date: string }) {
    const year = Number(target.year);
    const monthIndex = this.months.findIndex((month) => month === target.monthOnly);
    if (!Number.isFinite(year) || monthIndex < 0) {
      target.date = '';
      return;
    }

    target.date = this.computeLastWorkingDayIso(year, monthIndex);
  }

  private computeLastWorkingDayIso(year: number, monthIndex: number): string {
    let day = new Date(year, monthIndex + 1, 0);
    const weekDay = day.getDay();
    if (weekDay === 6) day = new Date(year, monthIndex + 1, -1);
    if (weekDay === 0) day = new Date(year, monthIndex + 1, -2);

    return this.toDateInputValue(day);
  }

  private toDateInputValue(date: Date): string {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  private parseMoney(value: any): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const amount = parseFloat(String(value ?? '').replace(/[^0-9.-]/g, ''));
    return Number.isFinite(amount) ? amount : 0;
  }

  formatCurrency(amount: any): string {
    const value = this.parseMoney(amount);
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

  formatCompactCurrency(amount: any): string {
    const value = this.parseMoney(amount);
    try {
      return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        notation: 'compact',
        maximumFractionDigits: 1
      }).format(value);
    } catch {
      return this.formatCurrency(value);
    }
  }

  formatMonthYear(monthOnly: any, year: any): string {
    const month = String(monthOnly ?? '').trim();
    const yearValue = String(year ?? '').trim();
    return month && yearValue ? `${month} ${yearValue}` : '—';
  }

  private getMonthKey(record: { monthOnly?: any; year?: any; date?: any; monthYear?: any }): string {
    const monthYear = String(record?.monthYear ?? '').trim();
    if (monthYear) return monthYear;

    const year = Number(record?.year ?? NaN);
    const monthIndex = this.months.findIndex((month) => month === record?.monthOnly);
    if (Number.isFinite(year) && monthIndex >= 0) {
      return `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
    }

    const dateStr = String(record?.date ?? '').trim();
    return dateStr ? dateStr.slice(0, 7) : '';
  }

  private getDistinctMonthCount(rows: Array<{ monthOnly?: any; year?: any; date?: any; monthYear?: any }>): number {
    return new Set((rows ?? []).map((row) => this.getMonthKey(row)).filter(Boolean)).size;
  }

  get selectableMoneyMapLabels(): string[] {
    return [...this.derivedMoneyMapCategories,...this.manualMoneyMapCategories];
  }

  get manualMoneyMapCategories(): string[] {
    const labels = (this.moneyMapCategories ?? [])
      .map((row) => String(row?.label ?? '').trim())
      .filter(Boolean);

    if (labels.length) {
      return labels;
    }

    return !this.hasInitializedMoneyMapCategories || this.categoryAddInProgress
      ? this.defaultMoneyMapCategories
      : [];
  }

  private getCategoryRecord(label: string): MoneyMapCategoryRow | undefined {
    const normalizedLabel = String(label ?? '').trim();
    return (this.moneyMapCategories ?? []).find((row) => String(row?.label ?? '').trim() === normalizedLabel);
  }

  private getDefaultSavingsFlag(label: string): boolean {
    return this.defaultSavingsCategoryLabels.has(String(label ?? '').trim().toLowerCase());
  }

  isMoneyMapCategorySavings(label: string): boolean {
    const category = this.getCategoryRecord(label);
    if (typeof category?.isSavings === 'boolean') {
      return category.isSavings;
    }

    return this.getDefaultSavingsFlag(label);
  }

  isMoneyMapRowSavings(row: MoneyMapRow): boolean {
    if (row.label === 'In PF') {
      return true;
    }

    if (row.kind !== 'manual') {
      return false;
    }

    if (typeof row.isSavings === 'boolean') {
      return row.isSavings;
    }

    return this.isMoneyMapCategorySavings(row.label);
  }

  private ensureSelectedCategory() {
    const labels = this.selectableMoneyMapLabels;
    if (!labels.length) {
      this.selectedInvestmentCategory = '';
      this.newInvestment.category = '';
      return;
    }

    if (!labels.includes(this.selectedInvestmentCategory)) {
      this.selectedInvestmentCategory = labels[0];
      this.newInvestment.category = labels[0];
      return;
    }

    this.newInvestment.category = this.selectedInvestmentCategory;
  }

  private async seedDefaultMoneyMapCategories() {
    if (!this.userEmail || this.categoryAddInProgress || this.moneyMapCategories.length) {
      return;
    }

    this.categoryAddInProgress = true;
    this.categoryError = null;

    try {
      const today = this.toDateInputValue(new Date());
      this.hasInitializedMoneyMapCategories = true;
      await Promise.all(
        this.defaultMoneyMapCategories.map((label) =>
          addDoc(collection(this.firestore, 'moneyMapCategories'), {
            label,
            isSavings: this.getDefaultSavingsFlag(label),
            date: today,
            email: this.userEmail
          })
        )
      );
    } catch (error: any) {
      console.error('Failed to seed money map categories:', error);
      this.categoryError = error?.message ? String(error.message) : 'Failed to initialize money map categories.';
    } finally {
      this.categoryAddInProgress = false;
    }
  }

  private async ensureVehicleMaintenanceCategory() {
    if (!this.userEmail || this.vehicleMaintenanceCategoryEnsuring) {
      return;
    }

    const exists = (this.moneyMapCategories ?? []).some(
      (row) => String(row?.label ?? '').trim().toLowerCase() === 'vehicle maintenance'
    );

    if (exists) {
      return;
    }

    this.vehicleMaintenanceCategoryEnsuring = true;
    try {
      await addDoc(collection(this.firestore, 'moneyMapCategories'), {
        label: 'Vehicle Maintenance',
        isSavings: false,
        date: this.toDateInputValue(new Date()),
        email: this.userEmail
      });
    } catch (error) {
      console.error('Failed to ensure Vehicle Maintenance category:', error);
    } finally {
      this.vehicleMaintenanceCategoryEnsuring = false;
    }
  }

  selectInvestmentCategory(category: string) {
    const normalizedCategory = String(category ?? '').trim();
    if (!this.selectableMoneyMapLabels.includes(normalizedCategory)) {
      return;
    }

    this.selectedInvestmentCategory = normalizedCategory;
    if (this.isSelectedManualCategory) {
      this.newInvestment.category = normalizedCategory;
    }
  }

  isSelectedInvestmentCategory(category: string): boolean {
    return this.selectedInvestmentCategory === String(category ?? '').trim();
  }

  get isSelectedManualCategory(): boolean {
    return this.manualMoneyMapCategories.includes(this.selectedInvestmentCategory);
  }

  get isSelectedPfCategory(): boolean {
    return this.selectedInvestmentCategory === 'In PF';
  }

  get isSelectedDebitCategory(): boolean {
    return this.selectedInvestmentCategory === 'Active Debts';
  }

  get isSelectedLoanCategory(): boolean {
    return this.selectedInvestmentCategory === 'Active Loans Outstanding/EMIs';
  }

  get isSelectedMissingCategory(): boolean {
    return this.selectedInvestmentCategory === 'Missing';
  }

  get pfRowsWithValue(): SalaryDashboardRow[] {
    return this.globallyFilteredSalaryRows.filter((row) => this.parseMoney(row?.pf) > 0);
  }

  get missingBreakdownRows(): MissingBreakdownRow[] {
    return [
      { label: 'Manual Categories', value: this.fixedInvestmentCurrentValue },
      { label: 'Provident Fund', value: this.pfIncomeTotal },
      { label: 'Active Debts', value: this.monthlyDebitTotal },
      { label: 'Active Loans', value: this.activeLoanOutstanding },
      { label: 'Unallocated Balance', value: this.balanceAfterTracking }
    ];
  }

  private getInvestmentAmountForRow(row: FixedInvestmentRow): number {
    const currentValue = this.parseMoney(row?.currentValue);
    return currentValue > 0 ? currentValue : this.parseMoney(row?.investedAmount);
  }

  private getUniqueValues(values: any[]): string[] {
    return [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
  }

  get investmentFilterOptions() {
    return {
      assetName: this.getUniqueValues(this.filteredInvestmentsBase.map((row) => row.assetName)),
      institution: this.getUniqueValues(this.filteredInvestmentsBase.map((row) => row.institution)),
      date: this.getUniqueValues(this.filteredInvestmentsBase.map((row) => row.date))
    };
  }

  get pfFilterOptions() {
    return {
      monthYear: this.getUniqueValues(this.pfRowsWithValue.map((row) => this.formatMonthYear(row.monthOnly, row.year))),
      date: this.getUniqueValues(this.pfRowsWithValue.map((row) => row.date))
    };
  }

  get debitFilterOptions() {
    return {
      category: this.getUniqueValues(this.globallyFilteredMonthlyDebits.map((row) => row.category)),
      monthYear: this.getUniqueValues(this.globallyFilteredMonthlyDebits.map((row) => this.formatMonthYear(row.monthOnly, row.year))),
      date: this.getUniqueValues(this.globallyFilteredMonthlyDebits.map((row) => row.date))
    };
  }

  get loanFilterOptions() {
    return {
      lender: this.getUniqueValues(this.activeLoans.map((row) => row.lender)),
      monthYear: this.getUniqueValues(this.activeLoans.map((row) => this.formatMonthYear(row.monthOnly, row.year))),
      date: this.getUniqueValues(this.activeLoans.map((row) => row.date))
    };
  }

  private get filteredInvestmentsBase(): FixedInvestmentRow[] {
    const selectedCategory = String(this.selectedInvestmentCategory ?? '').trim();
    return this.globallyFilteredFixedInvestments.filter(
      (row) => !selectedCategory || String(row?.category ?? '').trim() === selectedCategory
    );
  }

  get filteredFixedInvestments(): FixedInvestmentRow[] {
    return this.filteredInvestmentsBase.filter((row) => {
      if (this.investmentFilters.assetName && String(row?.assetName ?? '').trim() !== this.investmentFilters.assetName) {
        return false;
      }

      if (this.investmentFilters.institution && String(row?.institution ?? '').trim() !== this.investmentFilters.institution) {
        return false;
      }

      if (this.investmentFilters.date && String(row?.date ?? '').trim() !== this.investmentFilters.date) {
        return false;
      }

      return true;
    });
  }

  get filteredPfRows(): SalaryDashboardRow[] {
    return this.pfRowsWithValue.filter((row) => {
      if (this.pfFilters.monthYear && this.formatMonthYear(row.monthOnly, row.year) !== this.pfFilters.monthYear) {
        return false;
      }

      if (this.pfFilters.date && String(row?.date ?? '').trim() !== this.pfFilters.date) {
        return false;
      }

      return true;
    });
  }

  get filteredMonthlyDebits(): MonthlyDebitRow[] {
    return this.globallyFilteredMonthlyDebits.filter((row) => {
      if (this.debitFilters.category && String(row?.category ?? '').trim() !== this.debitFilters.category) {
        return false;
      }

      if (this.debitFilters.monthYear && this.formatMonthYear(row.monthOnly, row.year) !== this.debitFilters.monthYear) {
        return false;
      }

      if (this.debitFilters.date && String(row?.date ?? '').trim() !== this.debitFilters.date) {
        return false;
      }

      return true;
    });
  }

  get filteredActiveLoans(): LoanRow[] {
    return this.activeLoans.filter((row) => {
      if (this.loanFilters.lender && String(row?.lender ?? '').trim() !== this.loanFilters.lender) {
        return false;
      }

      if (this.loanFilters.monthYear && this.formatMonthYear(row.monthOnly, row.year) !== this.loanFilters.monthYear) {
        return false;
      }

      if (this.loanFilters.date && String(row?.date ?? '').trim() !== this.loanFilters.date) {
        return false;
      }

      return true;
    });
  }

  get selectedInvestmentTotal(): number {
    return this.filteredFixedInvestments.reduce((sum, row) => sum + this.parseMoney(row?.investedAmount), 0);
  }

  get selectedInvestmentCurrentValue(): number {
    return this.filteredFixedInvestments.reduce((sum, row) => sum + this.getInvestmentAmountForRow(row), 0);
  }

  get selectedInvestmentCount(): number {
    return this.filteredFixedInvestments.length;
  }

  get moneyMapRows(): MoneyMapRow[] {
    const manualTotals = new Map<string, number>();
    const categorizedDebitTotals = new Map<string, number>();

    for (const row of this.globallyFilteredMonthlyDebits) {
      const category = String(row?.category ?? '').trim();
      if (!category || !this.manualMoneyMapCategories.includes(category)) {
        continue;
      }

      categorizedDebitTotals.set(category, (categorizedDebitTotals.get(category) ?? 0) + this.parseMoney(row?.amount));
    }

    for (const category of this.manualMoneyMapCategories) {
      const total = (this.fixedInvestments ?? [])
        .filter((row) => this.matchesGlobalMonthKey(String(row?.date ?? '').trim().slice(0, 7)))
        .filter((row) => String(row?.category ?? '').trim() === category)
        .reduce((sum, row) => sum + this.getInvestmentAmountForRow(row), 0);
      manualTotals.set(category, total + (categorizedDebitTotals.get(category) ?? 0));
    }

    return [
      { label: 'Missing', value: this.balanceAfterTracking, kind: 'derived' },
      { label: 'In PF', value: this.pfIncomeTotal, kind: 'derived' },
      ...this.manualMoneyMapCategories.map((label) => {
        const categoryRow = (this.moneyMapCategories ?? []).find((row) => String(row?.label ?? '').trim() === label);
        return {
          id: categoryRow?.id,
          label,
          value: manualTotals.get(label) ?? 0,
          kind: 'manual' as const,
          isSavings: this.isMoneyMapCategorySavings(label)
        };
      }),
    ];
  }

  private buildSalaryPdfPreviewRows(): SalaryDashboardRow[] {
    const groups = new Map<string, SalaryDashboardRow & { salaryTotal: number; pfTotal: number; pfPresent: boolean }>();

    for (const upload of this.salaryPdfUploads ?? []) {
      const monthOnly = String(upload?.monthOnly ?? '').trim();
      const year = Number(upload?.year ?? NaN);
      const monthYear = String(upload?.monthYear ?? '').trim();
      if (!monthOnly || !Number.isFinite(year) || !monthYear) {
        continue;
      }

      const monthIndex = this.months.findIndex((month) => month === monthOnly);
      const creditedDate = String(upload?.creditedDate ?? '').trim()
        || (monthIndex >= 0 ? this.computeLastWorkingDayIso(year, monthIndex) : '');
      if (!creditedDate) {
        continue;
      }

      const netIncome = this.parseMoney(upload?.netIncome);
      const hasPf = upload?.pf !== null && upload?.pf !== undefined && String(upload.pf).trim() !== '';
      const pf = hasPf ? this.parseMoney(upload?.pf) : 0;

      const existing = groups.get(monthYear);
      if (!existing) {
        groups.set(monthYear, {
          id: `__pdf_preview__:${monthYear}`,
          salary: netIncome,
          pf: hasPf ? pf : '—',
          monthOnly,
          year,
          monthYear,
          date: creditedDate,
          email: this.userEmail ?? undefined,
          salaryTotal: netIncome,
          pfTotal: pf,
          pfPresent: hasPf
        });
        continue;
      }

      existing.salaryTotal += netIncome;
      existing.salary = existing.salaryTotal;

      if (hasPf) {
        existing.pfTotal += pf;
        existing.pfPresent = true;
        existing.pf = existing.pfTotal;
      }
    }

    return Array.from(groups.values())
      .sort((left, right) => String(right.date ?? '').localeCompare(String(left.date ?? '')))
      .map(({ salaryTotal, pfTotal, pfPresent, ...row }) => ({
        ...row,
        salary: salaryTotal,
        pf: pfPresent ? pfTotal : '—'
      }));
  }

  private get effectiveSalaryRows(): SalaryDashboardRow[] {
    const baseRows = this.salaryRows ?? [];
    const previewRows = this.buildSalaryPdfPreviewRows();
    if (!previewRows.length) {
      return baseRows;
    }

    const existingKeys = new Set(
      baseRows.map((row) => `${String(row?.monthYear ?? '')}|${String(row?.date ?? '')}`)
    );

    const missingPreviewRows = previewRows.filter(
      (row) => !existingKeys.has(`${String(row?.monthYear ?? '')}|${String(row?.date ?? '')}`)
    );

    return [...missingPreviewRows, ...baseRows];
  }

  get salaryIncomeTotal(): number {
    return this.globallyFilteredSalaryRows.reduce((sum, row) => sum + this.parseMoney(row?.salary), 0);
  }

  get pfIncomeTotal(): number {
    return this.globallyFilteredSalaryRows.reduce((sum, row) => sum + this.parseMoney(row?.pf), 0);
  }

  get placementIncomeTotal(): number {
    return this.globallyFilteredPlacementRows.reduce((sum, row) => sum + this.parseMoney(row?.charged), 0);
  }

  get technicalIncomeTotal(): number {
    return this.globallyFilteredTechnicalRows.reduce((sum, row) => sum + this.parseMoney(row?.charged), 0);
  }

  get totalEarned(): number {
    return this.salaryIncomeTotal + this.pfIncomeTotal + this.placementIncomeTotal + this.technicalIncomeTotal;
  }

  get earnedMonthsCount(): number {
    return this.getDistinctMonthCount([
      ...this.globallyFilteredSalaryRows,
      ...this.globallyFilteredPlacementRows,
      ...this.globallyFilteredTechnicalRows
    ]);
  }

  get averageEarnedPerMonth(): number {
    return this.earnedMonthsCount > 0 ? this.totalEarned / this.earnedMonthsCount : 0;
  }

  get earningsChartRows(): EarningsChartRow[] {
    const rows: EarningsChartRow[] = [
      {
        label: 'Salary Income',
        value: this.salaryIncomeTotal,
        pct: this.totalEarned > 0 ? (this.salaryIncomeTotal / this.totalEarned) * 100 : 0,
        tone: 'salary'
      },
      {
        label: 'Provident Fund',
        value: this.pfIncomeTotal,
        pct: this.totalEarned > 0 ? (this.pfIncomeTotal / this.totalEarned) * 100 : 0,
        tone: 'pf'
      },
      {
        label: 'Placement Income',
        value: this.placementIncomeTotal,
        pct: this.totalEarned > 0 ? (this.placementIncomeTotal / this.totalEarned) * 100 : 0,
        tone: 'placement'
      },
      {
        label: 'Technical Support',
        value: this.technicalIncomeTotal,
        pct: this.totalEarned > 0 ? (this.technicalIncomeTotal / this.totalEarned) * 100 : 0,
        tone: 'technical'
      }
    ];

    return rows.filter((row) => row.value > 0 || this.totalEarned === 0);
  }

  get earningsChartDonutBackground(): string {
    if (this.totalEarned <= 0) {
      return 'conic-gradient(#32405f 0 100%)';
    }

    let offset = 0;
    const segments = this.earningsChartRows.map((row) => {
      const start = offset;
      offset += row.pct;
      const color = this.earningsChartToneColors[row.tone];
      return `${color} ${start}% ${offset}%`;
    });

    return `conic-gradient(${segments.join(', ')})`;
  }

  get earningsChartSlices(): ChartHoverSlice[] {
    return this.buildChartSlices(this.earningsChartRows, (row) => this.earningsChartToneColors[row.tone]);
  }

  get hoveredEarningsChartSlice(): ChartHoverSlice | null {
    return this.hoveredEarningsSliceIndex === null ? null : this.earningsChartSlices[this.hoveredEarningsSliceIndex] ?? null;
  }

  get spendBucketsTotal(): number {
    return Math.max(this.moneyMapNonSavingsTotal - this.moneyMapCommitmentsTotal, 0);
  }

  get spendingsChartRows(): SpendingsChartRow[] {
    const total = this.trackedMoneyMapTotal;
    const mappedRows = this.moneyMapRows
      .filter((row) => row.label !== 'Missing' && row.value > 0)
      .map((row) => ({
        label: row.label,
        value: row.value
      }));

    const rows = [
      ...mappedRows,
      { label: 'Monthly Debits', value: this.uncategorizedMonthlyDebitTotal },
      { label: 'Active Loans', value: this.activeLoanOutstanding }
    ]
      .filter((row) => row.value > 0 || total === 0)
      .map((row, index) => ({
        ...row,
        pct: total > 0 ? (row.value / total) * 100 : 0,
        color: this.moneyMappedBreakdownPalette[index % this.moneyMappedBreakdownPalette.length]
      }));

    return rows;
  }

  get spendingsChartDonutBackground(): string {
    if (this.trackedMoneyMapTotal <= 0) {
      return 'conic-gradient(#32405f 0 100%)';
    }

    let offset = 0;
    const segments = this.spendingsChartRows.map((row) => {
      const start = offset;
      offset += row.pct;
      return `${row.color} ${start}% ${offset}%`;
    });

    return `conic-gradient(${segments.join(', ')})`;
  }

  get spendingsChartSlices(): ChartHoverSlice[] {
    return this.buildChartSlices(this.spendingsChartRows, (row) => row.color);
  }

  get hoveredSpendingsChartSlice(): ChartHoverSlice | null {
    return this.hoveredSpendingsSliceIndex === null ? null : this.spendingsChartSlices[this.hoveredSpendingsSliceIndex] ?? null;
  }

  get earningsSpendingTrendPoints(): TrendChartPoint[] {
    const monthTotals = new Map<string, { earnings: number; spending: number }>();

    const addToMonth = (key: string, field: 'earnings' | 'spending', amount: number) => {
      if (!key || !Number.isFinite(amount) || amount <= 0) {
        return;
      }

      const existing = monthTotals.get(key) ?? { earnings: 0, spending: 0 };
      existing[field] += amount;
      monthTotals.set(key, existing);
    };

    for (const row of this.globallyFilteredSalaryRows) {
      const key = this.getMonthKey(row);
      addToMonth(key, 'earnings', this.parseMoney(row?.salary) + this.parseMoney(row?.pf));
      addToMonth(key, 'spending', this.parseMoney(row?.pf));
    }

    for (const row of this.globallyFilteredPlacementRows) {
      addToMonth(this.getMonthKey(row), 'earnings', this.parseMoney(row?.charged));
    }

    for (const row of this.globallyFilteredTechnicalRows) {
      addToMonth(this.getMonthKey(row), 'earnings', this.parseMoney(row?.charged));
    }

    for (const row of this.globallyFilteredFixedInvestments) {
      addToMonth(String(row?.date ?? '').trim().slice(0, 7), 'spending', this.parseMoney(row?.investedAmount));
    }

    for (const row of this.globallyFilteredMonthlyDebits) {
      addToMonth(this.getMonthKey(row), 'spending', this.parseMoney(row?.amount));
    }

    for (const row of this.globallyFilteredLoanRows) {
      addToMonth(this.getMonthKey(row), 'spending', this.parseMoney(row?.emi));
    }

    const sortedEntries = [...monthTotals.entries()]
      .sort(([left], [right]) => left.localeCompare(right));

    if (!sortedEntries.length) {
      return [];
    }

    const maxValue = Math.max(
      ...sortedEntries.flatMap(([, totals]) => [totals.earnings, totals.spending]),
      1
    );
    const slotWidth = 100 / sortedEntries.length;

    return sortedEntries.map(([key, totals], index) => {
      const earningsHeightPct = totals.earnings > 0 ? Math.max((totals.earnings / maxValue) * 100, 2) : 0;
      const spendingHeightPct = totals.spending > 0 ? Math.max((totals.spending / maxValue) * 100, 2) : 0;

      return {
        key,
        label: this.formatTrendMonthLabel(key),
        earnings: totals.earnings,
        spending: totals.spending,
        earningsHeightPct,
        spendingHeightPct
      };
    });
  }

  get trendChartAxisTicks(): TrendChartAxisTick[] {
    const maxValue = this.trendChartMaxValue;
    const chartTop = 8;
    const chartBottom = 92;
    const plotHeight = chartBottom - chartTop;

    return [1, 0.75, 0.5, 0.25, 0].map((step) => ({
      value: maxValue * step,
      y: chartBottom - step * plotHeight
    }));
  }

  get trendChartMaxValue(): number {
    return Math.max(
      ...this.earningsSpendingTrendPoints.flatMap((point) => [point.earnings, point.spending]),
      1
    );
  }

  get selectedTrendEarningsTotal(): number {
    return this.earningsSpendingTrendPoints.reduce((sum, point) => sum + point.earnings, 0);
  }

  get selectedTrendSpendingTotal(): number {
    return this.earningsSpendingTrendPoints.reduce((sum, point) => sum + point.spending, 0);
  }

  get trendChartCanvasMinWidth(): number {
    return Math.max(this.earningsSpendingTrendPoints.length * 86, 520);
  }

  setHoveredEarningsSlice(index: number): void {
    this.hoveredEarningsSliceIndex = index;
  }

  clearHoveredEarningsSlice(): void {
    this.hoveredEarningsSliceIndex = null;
  }

  setHoveredSpendingsSlice(index: number): void {
    this.hoveredSpendingsSliceIndex = index;
  }

  clearHoveredSpendingsSlice(): void {
    this.hoveredSpendingsSliceIndex = null;
  }

  private buildChartSlices<T extends { label: string; value: number; pct: number }>(
    rows: T[],
    colorForRow: (row: T, index: number) => string
  ): ChartHoverSlice[] {
    const visibleRows = rows.filter((row) => row.value > 0 && row.pct > 0);
    let offset = 0;

    return visibleRows.map((row, index) => {
      const start = offset;
      offset += row.pct;

      const midpoint = start + row.pct / 2;
      const radians = (midpoint / 100) * Math.PI * 2 - Math.PI / 2;
      const tooltipX = this.clampChartTooltipPosition(50 + Math.cos(radians) * 46, 18, 82);
      const tooltipY = this.clampChartTooltipPosition(50 + Math.sin(radians) * 46, 18, 82);

      return {
        label: row.label,
        value: row.value,
        pct: row.pct,
        color: colorForRow(row, index),
        dasharray: `${row.pct} ${100 - row.pct}`,
        dashoffset: `${-start}`,
        tooltipX,
        tooltipY,
        tooltipSide: Math.cos(radians) < 0 ? 'right' : 'left'
      };
    });
  }

  private clampChartTooltipPosition(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }

  private formatTrendMonthLabel(key: string): string {
    const match = String(key ?? '').match(/^(\d{4})-(\d{2})$/);
    if (!match) {
      return key;
    }

    const monthIndex = Number(match[2]) - 1;
    const month = this.months[monthIndex] ?? match[2];
    return `${month.slice(0, 3)} '${match[1].slice(-2)}`;
  }

  get fixedInvestmentTotal(): number {
    return this.globallyFilteredFixedInvestments.reduce((sum, row) => sum + this.parseMoney(row?.investedAmount), 0);
  }

  get fixedInvestmentCurrentValue(): number {
    return this.globallyFilteredFixedInvestments.reduce((sum, row) => {
      return sum + this.getInvestmentAmountForRow(row);
    }, 0);
  }

  get monthlyDebitTotal(): number {
    return this.globallyFilteredMonthlyDebits.reduce((sum, row) => sum + this.parseMoney(row?.amount), 0);
  }

  get uncategorizedMonthlyDebitTotal(): number {
    return this.globallyFilteredMonthlyDebits.reduce((sum, row) => {
      const category = String(row?.category ?? '').trim();
      if (category && this.manualMoneyMapCategories.includes(category)) {
        return sum;
      }

      return sum + this.parseMoney(row?.amount);
    }, 0);
  }

  get debitMonthsCount(): number {
    return this.getDistinctMonthCount(this.globallyFilteredMonthlyDebits);
  }

  get averageDebitPerMonth(): number {
    return this.debitMonthsCount > 0 ? this.monthlyDebitTotal / this.debitMonthsCount : 0;
  }

  get activeLoans(): LoanRow[] {
    return this.globallyFilteredLoanRows.filter((row) => row.status === 'active');
  }

  get clearedLoans(): LoanRow[] {
    return this.globallyFilteredLoanRows.filter((row) => row.status === 'cleared');
  }

  get activeLoanOutstanding(): number {
    return this.activeLoans.reduce((sum, row) => sum + this.parseMoney(row?.outstanding), 0);
  }

  get activeLoanEmiTotal(): number {
    return this.activeLoans.reduce((sum, row) => sum + this.parseMoney(row?.emi), 0);
  }

  get clearedLoanPrincipal(): number {
    return this.clearedLoans.reduce((sum, row) => sum + this.parseMoney(row?.principal), 0);
  }

  get trackedMoneyMapTotal(): number {
    return this.fixedInvestmentCurrentValue + this.pfIncomeTotal + this.monthlyDebitTotal + this.activeLoanOutstanding;
  }

  private get globallyFilteredSalaryRows(): SalaryDashboardRow[] {
    return this.effectiveSalaryRows.filter((row) => this.matchesGlobalMonthKey(this.getMonthKey(row)));
  }

  private get globallyFilteredPlacementRows(): PlacementDashboardRow[] {
    return (this.placementRows ?? []).filter((row) => this.matchesGlobalMonthKey(this.getMonthKey(row)));
  }

  private get globallyFilteredTechnicalRows(): TechnicalDashboardRow[] {
    return (this.technicalRows ?? []).filter((row) => this.matchesGlobalMonthKey(this.getMonthKey(row)));
  }

  private get globallyFilteredFixedInvestments(): FixedInvestmentRow[] {
    return (this.fixedInvestments ?? []).filter((row) => this.matchesGlobalMonthKey(String(row?.date ?? '').trim().slice(0, 7)));
  }

  private get globallyFilteredMonthlyDebits(): MonthlyDebitRow[] {
    return (this.monthlyDebits ?? []).filter((row) => this.matchesGlobalMonthKey(this.getMonthKey(row)));
  }

  private get globallyFilteredLoanRows(): LoanRow[] {
    return (this.loanRows ?? []).filter((row) => this.matchesGlobalMonthKey(this.getMonthKey(row)));
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

  get balanceAfterTracking(): number {
    return this.totalEarned - this.trackedMoneyMapTotal;
  }

  get moneyMapCoveragePct(): number {
    return this.totalEarned > 0 ? (this.trackedMoneyMapTotal / this.totalEarned) * 100 : 0;
  }

  get moneyMapUnassignedPct(): number {
    return this.totalEarned > 0 ? (this.balanceAfterTracking / this.totalEarned) * 100 : 0;
  }

  get moneyMapGapPct(): number {
    return this.totalEarned > 0 ? (Math.abs(this.balanceAfterTracking) / this.totalEarned) * 100 : 0;
  }

  get moneyMapSavingsTotal(): number {
    const manualSavingsTotal = this.globallyFilteredFixedInvestments.reduce((sum, row) => {
      const category = String(row?.category ?? '').trim();
      if (!category || !this.isMoneyMapCategorySavings(category)) {
        return sum;
      }

      return sum + this.getInvestmentAmountForRow(row);
    }, 0);

    return manualSavingsTotal + this.pfIncomeTotal;
  }

  get moneyMapSavingsPct(): number {
    return this.totalEarned > 0 ? (this.moneyMapSavingsTotal / this.totalEarned) * 100 : 0;
  }

  get moneyMapNonSavingsTotal(): number {
    return Math.max(this.trackedMoneyMapTotal - this.moneyMapSavingsTotal, 0);
  }

  get moneyMapNonSavingsPct(): number {
    return this.totalEarned > 0 ? (this.moneyMapNonSavingsTotal / this.totalEarned) * 100 : 0;
  }

  get moneyMapCommitmentsTotal(): number {
    return this.monthlyDebitTotal + this.activeLoanOutstanding;
  }

  get allocationGapAmount(): number {
    return Math.abs(this.balanceAfterTracking);
  }

  get isMoneyMapOverAllocated(): boolean {
    return this.balanceAfterTracking < 0;
  }

  get moneyMapManualBucketCount(): number {
    return this.manualMoneyMapCategories.length;
  }

  getMoneyMapShareOfEarned(value: any): number {
    const amount = this.parseMoney(value);
    return this.totalEarned > 0 ? (amount / this.totalEarned) * 100 : 0;
  }

  getMoneyMapShareOfTracked(value: any): number {
    const amount = this.parseMoney(value);
    return this.trackedMoneyMapTotal > 0 ? (amount / this.trackedMoneyMapTotal) * 100 : 0;
  }

  getMoneyMapRowContext(row: MoneyMapRow): string {
    if (row.label === 'Missing') {
      return 'Still not assigned to any bucket';
    }

    if (row.label === 'In PF') {
      return 'Protected retirement-style savings allocation';
    }

    if (row.kind === 'manual') {
      return this.isMoneyMapRowSavings(row)
        ? 'Savings bucket included in Savings Side'
        : 'Non-savings bucket excluded from Savings Side';
    }

    return 'Derived financial bucket';
  }

  get investmentBuckets(): Array<{ label: string; value: number }> {
    const grouped = new Map<string, number>();

    for (const row of this.globallyFilteredFixedInvestments) {
      const label = String(row?.institution ?? '').trim() || 'Unassigned';
      const currentValue = this.parseMoney(row?.currentValue);
      const amount = currentValue > 0 ? currentValue : this.parseMoney(row?.investedAmount);
      grouped.set(label, (grouped.get(label) ?? 0) + amount);
    }

    return [...grouped.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((left, right) => right.value - left.value)
      .slice(0, 5);
  }

  async addInvestment() {
    if (!this.userEmail) return;

    this.newInvestment.category = this.selectedInvestmentCategory;

    const row: FixedInvestmentRow = {
      assetName: String(this.newInvestment.assetName ?? '').trim(),
      institution: String(this.newInvestment.institution ?? '').trim(),
      category: String(this.newInvestment.category ?? '').trim(),
      investedAmount: String(this.newInvestment.investedAmount ?? '').trim(),
      currentValue: String(this.newInvestment.currentValue ?? '').trim(),
      date: String(this.newInvestment.date ?? '').trim(),
      notes: String(this.newInvestment.notes ?? '').trim(),
      email: this.userEmail
    };

    if (!row.assetName || !row.institution || !row.category || !row.investedAmount || !row.date) return;

    this.investmentAddInProgress = true;
    this.investmentError = null;

    try {
      if (this.editingInvestmentId) {
        await updateDoc(doc(this.firestore, 'fixedInvestments', this.editingInvestmentId), row as any);
      } else {
        await addDoc(collection(this.firestore, 'fixedInvestments'), row);
      }

      const currentDate = this.newInvestment.date;
      this.newInvestment = {
        assetName: '',
        institution: '',
        category: this.selectedInvestmentCategory,
        investedAmount: '',
        currentValue: '',
        date: currentDate,
        notes: ''
      };
      this.editingInvestmentId = null;
    } catch (error: any) {
      console.error('Failed to save fixed investment:', error);
      this.investmentError = error?.message ? String(error.message) : 'Failed to save fixed investment.';
    } finally {
      this.investmentAddInProgress = false;
    }
  }

  async addMoneyMapCategory() {
    if (!this.userEmail) return;

    const label = String(this.newMoneyMapCategory ?? '').trim();
    if (!label) return;

    const exists = this.manualMoneyMapCategories.some(
      (category) => category.toLowerCase() === label.toLowerCase()
    );
    if (exists) {
      this.categoryError = 'That category already exists.';
      return;
    }

    this.categoryAddInProgress = true;
    this.categoryError = null;

    try {
      await addDoc(collection(this.firestore, 'moneyMapCategories'), {
        label,
        isSavings: this.newMoneyMapCategoryIsSavings,
        date: this.toDateInputValue(new Date()),
        email: this.userEmail
      });
      this.newMoneyMapCategory = '';
      this.newMoneyMapCategoryIsSavings = true;
      this.selectedInvestmentCategory = label;
      this.newInvestment.category = label;
    } catch (error: any) {
      console.error('Failed to add money map category:', error);
      this.categoryError = error?.message ? String(error.message) : 'Failed to add money map category.';
    } finally {
      this.categoryAddInProgress = false;
    }
  }

  startMoneyMapCategoryEdit(row: MoneyMapRow) {
    if (row.kind !== 'manual' || !row.id) {
      return;
    }

    this.editingCategoryId = String(row.id);
    this.editingMoneyMapCategoryLabel = String(row.label ?? '').trim();
    this.editingMoneyMapCategoryIsSavings = this.isMoneyMapRowSavings(row);
    this.categoryError = null;
  }

  cancelMoneyMapCategoryEdit() {
    this.editingCategoryId = null;
    this.editingMoneyMapCategoryLabel = '';
    this.editingMoneyMapCategoryIsSavings = true;
  }

  async updateMoneyMapCategory(row: MoneyMapRow) {
    const rowId = String(row?.id ?? '').trim();
    const currentLabel = String(row?.label ?? '').trim();
    const nextLabel = String(this.editingMoneyMapCategoryLabel ?? '').trim();
    if (!rowId || !currentLabel || !nextLabel) return;

    const exists = (this.moneyMapCategories ?? []).some((category) => {
      const categoryId = String(category?.id ?? '').trim();
      const categoryLabel = String(category?.label ?? '').trim();
      return categoryId !== rowId && categoryLabel.toLowerCase() === nextLabel.toLowerCase();
    });

    if (exists) {
      this.categoryError = 'That category already exists.';
      return;
    }

    this.categoryAddInProgress = true;
    this.categoryError = null;

    try {
      const relatedRows = (this.fixedInvestments ?? []).filter(
        (item) => String(item?.category ?? '').trim() === currentLabel
      );

      await Promise.all([
        updateDoc(doc(this.firestore, 'moneyMapCategories', rowId), {
          label: nextLabel,
          isSavings: this.editingMoneyMapCategoryIsSavings,
          date: this.toDateInputValue(new Date())
        }),
        ...relatedRows
          .map((item) => {
            const investmentId = String(item?.id ?? '').trim();
            return investmentId
              ? updateDoc(doc(this.firestore, 'fixedInvestments', investmentId), { category: nextLabel })
              : null;
          })
          .filter((request): request is Promise<void> => !!request)
      ]);

      if (this.selectedInvestmentCategory === currentLabel) {
        this.selectedInvestmentCategory = nextLabel;
        this.newInvestment.category = nextLabel;
      }

      this.cancelMoneyMapCategoryEdit();
    } catch (error: any) {
      console.error('Failed to update money map category:', error);
      this.categoryError = error?.message ? String(error.message) : 'Failed to update money map category.';
    } finally {
      this.categoryAddInProgress = false;
    }
  }

  async toggleMoneyMapCategorySavings(row: MoneyMapRow) {
    const rowId = String(row?.id ?? '').trim();
    if (!rowId || row.kind !== 'manual') return;

    this.updatingCategorySavingsId = rowId;
    this.categoryError = null;

    try {
      await updateDoc(doc(this.firestore, 'moneyMapCategories', rowId), {
        isSavings: !this.isMoneyMapRowSavings(row)
      });
    } catch (error: any) {
      console.error('Failed to update money map savings flag:', error);
      this.categoryError = error?.message ? String(error.message) : 'Failed to update category type.';
    } finally {
      this.updatingCategorySavingsId = null;
    }
  }

  async addDebit() {
    if (!this.userEmail) return;

    this.syncPeriodicDate(this.newDebit);

    const row: MonthlyDebitRow = {
      category: String(this.newDebit.category ?? '').trim(),
      amount: String(this.newDebit.amount ?? '').trim(),
      monthOnly: String(this.newDebit.monthOnly ?? '').trim(),
      year: Number(this.newDebit.year),
      date: String(this.newDebit.date ?? '').trim(),
      notes: String(this.newDebit.notes ?? '').trim(),
      email: this.userEmail
    };

    if (!row.category || !row.amount || !row.monthOnly || !row.year || !row.date) return;

    this.debitAddInProgress = true;
    this.debitError = null;

    try {
      if (this.editingDebitId) {
        await updateDoc(doc(this.firestore, 'monthlyDebits', this.editingDebitId), row as any);
      } else {
        await addDoc(collection(this.firestore, 'monthlyDebits'), row);
      }

      const now = new Date();
      this.newDebit = {
        category: '',
        amount: '',
        monthOnly: this.months[now.getMonth()],
        year: now.getFullYear(),
        date: this.computeLastWorkingDayIso(now.getFullYear(), now.getMonth()),
        notes: ''
      };
      this.editingDebitId = null;
    } catch (error: any) {
      console.error('Failed to save monthly debit:', error);
      this.debitError = error?.message ? String(error.message) : 'Failed to save monthly debit.';
    } finally {
      this.debitAddInProgress = false;
    }
  }

  async addLoan() {
    if (!this.userEmail) return;

    this.syncPeriodicDate(this.newLoan);

    const row: LoanRow = {
      lender: String(this.newLoan.lender ?? '').trim(),
      principal: String(this.newLoan.principal ?? '').trim(),
      outstanding: String(this.newLoan.outstanding ?? '').trim() || (this.newLoan.status === 'cleared' ? '0' : ''),
      emi: String(this.newLoan.emi ?? '').trim(),
      status: this.newLoan.status === 'cleared' ? 'cleared' : 'active',
      monthOnly: String(this.newLoan.monthOnly ?? '').trim(),
      year: Number(this.newLoan.year),
      date: String(this.newLoan.date ?? '').trim(),
      notes: String(this.newLoan.notes ?? '').trim(),
      email: this.userEmail
    };

    if (!row.lender || !row.principal || !row.emi || !row.monthOnly || !row.year || !row.date) return;
    if (row.status === 'active' && !row.outstanding) return;

    this.loanAddInProgress = true;
    this.loanError = null;

    try {
      if (this.editingLoanId) {
        await updateDoc(doc(this.firestore, 'loanEntries', this.editingLoanId), row as any);
      } else {
        await addDoc(collection(this.firestore, 'loanEntries'), row);
      }

      const now = new Date();
      this.newLoan = {
        lender: '',
        principal: '',
        outstanding: '',
        emi: '',
        status: 'active',
        monthOnly: this.months[now.getMonth()],
        year: now.getFullYear(),
        date: this.computeLastWorkingDayIso(now.getFullYear(), now.getMonth()),
        notes: ''
      };
      this.editingLoanId = null;
    } catch (error: any) {
      console.error('Failed to save loan entry:', error);
      this.loanError = error?.message ? String(error.message) : 'Failed to save loan entry.';
    } finally {
      this.loanAddInProgress = false;
    }
  }

  editInvestment(row: FixedInvestmentRow) {
    this.editingInvestmentId = String(row?.id ?? '') || null;
    this.selectedInvestmentCategory = String(row?.category ?? '').trim();
    this.newInvestment = {
      assetName: String(row?.assetName ?? ''),
      institution: String(row?.institution ?? ''),
      category: String(row?.category ?? ''),
      investedAmount: String(row?.investedAmount ?? ''),
      currentValue: String(row?.currentValue ?? ''),
      date: String(row?.date ?? ''),
      notes: String(row?.notes ?? '')
    };
  }

  cancelInvestmentEdit() {
    this.editingInvestmentId = null;
    const currentDate = this.newInvestment.date || this.toDateInputValue(new Date());
    this.newInvestment = {
      assetName: '',
      institution: '',
      category: this.selectedInvestmentCategory,
      investedAmount: '',
      currentValue: '',
      date: currentDate,
      notes: ''
    };
  }

  editDebit(row: MonthlyDebitRow) {
    this.editingDebitId = String(row?.id ?? '') || null;
    this.newDebit = {
      category: String(row?.category ?? ''),
      amount: String(row?.amount ?? ''),
      monthOnly: String(row?.monthOnly ?? ''),
      year: row?.year ?? '',
      date: String(row?.date ?? ''),
      notes: String(row?.notes ?? '')
    };
  }

  cancelDebitEdit() {
    this.editingDebitId = null;
    const now = new Date();
    this.newDebit = {
      category: '',
      amount: '',
      monthOnly: this.months[now.getMonth()],
      year: now.getFullYear(),
      date: this.computeLastWorkingDayIso(now.getFullYear(), now.getMonth()),
      notes: ''
    };
  }

  editLoan(row: LoanRow) {
    this.editingLoanId = String(row?.id ?? '') || null;
    this.newLoan = {
      lender: String(row?.lender ?? ''),
      principal: String(row?.principal ?? ''),
      outstanding: String(row?.outstanding ?? ''),
      emi: String(row?.emi ?? ''),
      status: row?.status === 'cleared' ? 'cleared' : 'active',
      monthOnly: String(row?.monthOnly ?? ''),
      year: row?.year ?? '',
      date: String(row?.date ?? ''),
      notes: String(row?.notes ?? '')
    };
  }

  cancelLoanEdit() {
    this.editingLoanId = null;
    const now = new Date();
    this.newLoan = {
      lender: '',
      principal: '',
      outstanding: '',
      emi: '',
      status: 'active',
      monthOnly: this.months[now.getMonth()],
      year: now.getFullYear(),
      date: this.computeLastWorkingDayIso(now.getFullYear(), now.getMonth()),
      notes: ''
    };
  }

  async deleteInvestment(row: FixedInvestmentRow) {
    const rowId = String(row?.id ?? '');
    if (!rowId) return;

    this.deletingInvestmentId = rowId;
    this.investmentError = null;
    try {
      await deleteDoc(doc(this.firestore, 'fixedInvestments', rowId));
    } catch (error: any) {
      console.error('Failed to delete fixed investment:', error);
      this.investmentError = error?.message ? String(error.message) : 'Failed to delete fixed investment.';
    } finally {
      this.deletingInvestmentId = null;
    }
  }

  async deleteMoneyMapCategory(row: MoneyMapRow) {
    const label = String(row?.label ?? '').trim();
    const rowId = String(row?.id ?? '').trim();
    if (!label || !rowId) return;

    this.deletingCategoryId = rowId;
    this.categoryError = null;

    try {
      const relatedRows = (this.fixedInvestments ?? []).filter(
        (item) => String(item?.category ?? '').trim() === label
      );

      await Promise.all([
        deleteDoc(doc(this.firestore, 'moneyMapCategories', rowId)),
        ...relatedRows
          .map((item) => String(item?.id ?? '').trim())
          .filter(Boolean)
          .map((id) => deleteDoc(doc(this.firestore, 'fixedInvestments', id)))
      ]);

      if (this.selectedInvestmentCategory === label) {
        const remainingCategories = this.selectableMoneyMapLabels.filter((category) => category !== label);
        this.selectedInvestmentCategory = remainingCategories[0] ?? '';
        if (this.isSelectedManualCategory) {
          this.newInvestment.category = this.selectedInvestmentCategory;
        }
      }
    } catch (error: any) {
      console.error('Failed to delete money map category:', error);
      this.categoryError = error?.message ? String(error.message) : 'Failed to delete money map category.';
    } finally {
      this.deletingCategoryId = null;
    }
  }

  async deleteDebit(row: MonthlyDebitRow) {
    const rowId = String(row?.id ?? '');
    if (!rowId) return;

    this.deletingDebitId = rowId;
    this.debitError = null;
    try {
      await deleteDoc(doc(this.firestore, 'monthlyDebits', rowId));
    } catch (error: any) {
      console.error('Failed to delete monthly debit:', error);
      this.debitError = error?.message ? String(error.message) : 'Failed to delete monthly debit.';
    } finally {
      this.deletingDebitId = null;
    }
  }

  async deleteLoan(row: LoanRow) {
    const rowId = String(row?.id ?? '');
    if (!rowId) return;

    this.deletingLoanId = rowId;
    this.loanError = null;
    try {
      await deleteDoc(doc(this.firestore, 'loanEntries', rowId));
    } catch (error: any) {
      console.error('Failed to delete loan entry:', error);
      this.loanError = error?.message ? String(error.message) : 'Failed to delete loan entry.';
    } finally {
      this.deletingLoanId = null;
    }
  }
}
