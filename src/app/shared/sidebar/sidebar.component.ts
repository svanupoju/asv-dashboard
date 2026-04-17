import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';

interface SidebarMenu {
  name: string;
  key: string;
  icon: string;
  route: string;
}

@Component({
  selector: 'app-sidebar',
  templateUrl: './sidebar.component.html',
  styleUrls: ['./sidebar.component.scss']
})
export class SidebarComponent implements OnInit {
  @Input() collapsed = false;
  @Output() menuSelected = new EventEmitter<void>();
  userName: string | null = null;
  menus: SidebarMenu[] = [];

  private readonly defaultMenus: SidebarMenu[] = [
    { name: 'Salary Income', key: 'salary-income', icon: 'fas fa-money-bill-wave', route: '/salary-income' },
    { name: 'Technical Support', key: 'technical-support', icon: 'fas fa-headset', route: '/technical-support' },
    { name: 'Placement Assistance', key: 'placement-assistance', icon: 'fas fa-user-tie', route: '/placement-assistance' },
    { name: 'Bike Tracking', key: 'bike-tracking', icon: 'fas fa-motorcycle', route: '/bike-tracking' },
    { name: 'Car Tracking', key: 'car-tracking', icon: 'fas fa-car-side', route: '/car-tracking' },
  ];

  ngOnInit() {
    const token = sessionStorage.getItem('token');
    if (token && token.includes('.')) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        this.userName = payload && payload.name ? payload.name : null;
      } catch (e) {
        this.userName = null;
      }
    } else if (token) {
      this.userName = token;
    }

    // Load menu selection from sessionStorage or use defaults
    const savedMenus = sessionStorage.getItem('customMenus');
    let customMenus: SidebarMenu[] = [];
    if (savedMenus) {
      const parsedMenus = JSON.parse(savedMenus) as SidebarMenu[];
      const missingDefaultMenus = this.defaultMenus.filter(
        defaultMenu => !parsedMenus.some(menu => menu.key === defaultMenu.key)
      );
      customMenus = [...parsedMenus, ...missingDefaultMenus];
    } else {
      customMenus = this.defaultMenus;
    }
    // Always include Dashboard at the start and Customization at the end
    this.menus = [
      { name: 'Dashboard', key: 'dashboard', icon: 'fas fa-home', route: '/dashboard' },
      ...customMenus.filter(m => m.key !== 'dashboard' && m.key !== 'customization'),
    ];
  }

  capitalizeName(name: string): string {
    return name.replace(/\b\w/g, c => c.toUpperCase());
  }

  onMenuSelect(): void {
    this.menuSelected.emit();
  }
}
