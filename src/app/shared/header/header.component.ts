import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-header',
  templateUrl: './header.component.html',
  styleUrls: ['./header.component.scss']
})
export class HeaderComponent implements OnInit {
  @Input() sidebarCollapsed = false;
  @Output() toggleSidebar = new EventEmitter<void>();
  dropdownOpen = false;
  userName: string | null = null;

  constructor(public router: Router) {}

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

  logout() {
    sessionStorage.removeItem('token');
    this.closeDropdown();
    this.router.navigate(['/login'], { queryParams: { logout: '1' } });
  }

  capitalizeName(name: string): string {
    return name.replace(/\b\w/g, c => c.toUpperCase());
  }
}
