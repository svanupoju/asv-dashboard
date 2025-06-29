import { Component } from '@angular/core';
import { addDoc } from '@angular/fire/firestore';
import { getApps, initializeApp } from 'firebase/app';
import { getFirestore, collection, query, orderBy, onSnapshot, addDoc as nativeAddDoc, where } from 'firebase/firestore';
import { getAuth, onAuthStateChanged, User } from 'firebase/auth';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-salary-income',
  templateUrl: './salary-income.component.html',
  styleUrls: ['./salary-income.component.scss']
})
export class SalaryIncomeComponent {
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
  authChecked = false;

  constructor() {
    // Only initialize Firebase if it hasn't been initialized yet
    if (!getApps().length) {
      initializeApp(environment.firebase);
    }
    this.firestore = getFirestore();
    // Set default month, year, date, and monthYear to current
    const now = new Date();
    this.newRow.monthOnly = this.months[now.getMonth()];
    this.newRow.year = now.getFullYear();
    this.newRow.date = now.toISOString().slice(0, 10); // yyyy-mm-dd
    this.newRow.monthYear = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}`; // yyyy-mm

    // Listen for auth state changes and load rows when user is available
    onAuthStateChanged(getAuth(), (user) => {
      this.user = user;
      this.authChecked = true;
      if (user) {
        this.loadRows();
      }
    });
  }

  async addRow() {
    if (!this.newRow.year || !this.newRow.monthOnly || !this.newRow.salary || !this.newRow.date || !this.newRow.monthYear) return;
    const month = this.newRow.monthOnly + ' ' + this.newRow.year;
    if (!this.user) return; // Optionally, handle not signed in
    const row = {
      year: this.newRow.year,
      monthOnly: this.newRow.monthOnly,
      month,
      salary: this.newRow.salary,
      date: this.newRow.date,
      monthYear: this.newRow.monthYear,
      email: this.user.email
    };
    await nativeAddDoc(collection(this.firestore, 'salaryRows'), row);
    const now = new Date();
    this.newRow = {
      year: now.getFullYear(),
      monthOnly: this.months[now.getMonth()],
      salary: '',
      date: now.toISOString().slice(0, 10),
      monthYear: `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}`
    };
    // Firestore subscription will update the table
  }

  loadRows() {
    if (!this.user) return;
    const rowsRef = collection(this.firestore, 'salaryRows');
    const q = query(rowsRef, where('email', '==', this.user.email), orderBy('date', 'desc'));
    onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      this.incomeTable = data;
      this.filteredTable = data;
      this.setUniqueOptions();
    });
  }
  filters: any = { year: '', monthOnly: '', salary: '', date: '' };
  sortColumn: string = '';
  sortDirection: 'asc' | 'desc' = 'asc';
  uniqueOptions: any = { year: [], monthOnly: [], salary: [], date: [] };

  // Removed duplicate constructor

  setUniqueOptions() {
    const getUnique = (arr: any[], key: string) => Array.from(new Set(arr.map(item => item[key])));
    this.uniqueOptions.year = getUnique(this.incomeTable, 'year');
    this.uniqueOptions.monthOnly = getUnique(this.incomeTable, 'monthOnly');
    this.uniqueOptions.salary = getUnique(this.incomeTable, 'salary');
    this.uniqueOptions.date = getUnique(this.incomeTable, 'date');
  }

  applyFilters() {
    this.filteredTable = this.incomeTable.filter(row => {
      return (
        (this.filters.year === '' || row.year.toString() === this.filters.year.toString()) &&
        (this.filters.monthOnly === '' || row.monthOnly === this.filters.monthOnly) &&
        (this.filters.salary === '' || row.salary === this.filters.salary) &&
        (this.filters.date === '' || row.date === this.filters.date)
      );
    });
    if (this.sortColumn) {
      this.sortTable(this.sortColumn, true);
    }
  }

  sortTable(column: string, keepDirection = false) {
    if (!keepDirection) {
      if (this.sortColumn === column) {
        this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        this.sortDirection = 'asc';
      }
    }
    this.sortColumn = column;
    this.filteredTable.sort((a, b) => {
      let aValue: any;
      let bValue: any;
      switch (column) {
        case 'year':
          aValue = a.year;
          bValue = b.year;
          break;
        case 'monthOnly':
          aValue = a.monthOnly;
          bValue = b.monthOnly;
          break;
        case 'salary':
          aValue = parseFloat(a.salary.replace(/[$,]/g, ''));
          bValue = parseFloat(b.salary.replace(/[$,]/g, ''));
          break;
        case 'date':
          aValue = a.date;
          bValue = b.date;
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
}
