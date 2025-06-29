import { Component, Input, OnInit } from '@angular/core';

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
  userName: string | null = null;
  menus: SidebarMenu[] = [];

  ngOnInit() {
    const token = localStorage.getItem('token');
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

    // Load menu selection from localStorage or use defaults
    const savedMenus = localStorage.getItem('customMenus');
    let customMenus: SidebarMenu[] = [];
    if (savedMenus) {
      customMenus = JSON.parse(savedMenus);
    } else {
      customMenus = [
        { name: 'Salary Income', key: 'salary-income', icon: 'fas fa-money-bill-wave', route: '/salary-income' },
        { name: 'Technical Support', key: 'technical-support', icon: 'fas fa-headset', route: '/technical-support' },
        { name: 'Interview Assistance', key: 'interview-assistance', icon: 'fas fa-user-tie', route: '/interview-assistance' },
        { name: 'Instructors', key: 'instructors', icon: 'fas fa-chalkboard-teacher', route: '/instructors' },
        { name: 'Settings', key: 'settings', icon: 'fas fa-cog', route: '/settings' }
      ];
    }
    // Always include Dashboard at the start and Customization at the end
    this.menus = [
      { name: 'Dashboard', key: 'dashboard', icon: 'fas fa-home', route: '/dashboard' },
      ...customMenus.filter(m => m.key !== 'dashboard' && m.key !== 'customization'),
      { name: 'Customization', key: 'customization', icon: 'fas fa-sliders-h', route: '/customization' }
    ];
  }

  capitalizeName(name: string): string {
    return name.replace(/\b\w/g, c => c.toUpperCase());
  }
}
