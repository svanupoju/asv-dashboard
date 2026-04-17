import { Component } from '@angular/core';

interface CustomizationMenu {
  name: string;
  key: string;
  submenus: string[];
  selected: boolean;
  selectedSubmenus: string[];
}

@Component({
  selector: 'app-customization',
  templateUrl: './customization.component.html',
  styleUrls: ['./customization.component.scss']
})
export class CustomizationComponent {
  // Helper to check if a menu is a default menu (cannot be deleted)
  isDefaultMenu(key: string): boolean {
    return (
      key === 'salary-income' ||
      key === 'technical-support' ||
      key === 'placement-assistance' ||
      key === 'bike-tracking' ||
      key === 'car-tracking'
    );
  }

  // Delete a menu by index
  deleteMenu(index: number) {
    if (!this.isDefaultMenu(this.menus[index].key)) {
      this.menus.splice(index, 1);
    }
  }
  // Add a new menu to the list
  addMenu() {
    const name = this.newMenuName.trim();
    if (!name) {
      this.addMenuError = 'Menu name cannot be empty.';
      return;
    }
    if (this.menus.some((m: CustomizationMenu) => m.name.toLowerCase() === name.toLowerCase())) {
      this.addMenuError = 'Menu already exists.';
      return;
    }
    const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    this.menus.push({
      name,
      key,
      submenus: [],
      selected: true,
      selectedSubmenus: []
    });
    this.newMenuName = '';
    this.addMenuError = '';
  }
  menus: CustomizationMenu[] = [];
  newMenuName = '';
  addMenuError = '';

  constructor() {
    // Load menu selection from sessionStorage if available
    const savedMenus = sessionStorage.getItem('customMenus');
    const defaultMenus: CustomizationMenu[] = [
      {
        name: 'Salary Income',
        key: 'salary-income',
        submenus: ['Monthly', 'Yearly', 'Bonuses'],
        selected: true,
        selectedSubmenus: ['Monthly', 'Yearly', 'Bonuses']
      },
      {
        name: 'Technical Support',
        key: 'technical-support',
        submenus: ['Tickets', 'Live Chat', 'FAQ'],
        selected: true,
        selectedSubmenus: ['Tickets', 'Live Chat', 'FAQ']
      },
      {
        name: 'Placement Assistance',
        key: 'placement-assistance',
        submenus: ['Opportunities', 'Company Outreach', 'Offer Tracking'],
        selected: true,
        selectedSubmenus: ['Opportunities', 'Company Outreach', 'Offer Tracking']
      },
      {
        name: 'Bike Tracking',
        key: 'bike-tracking',
        submenus: ['Fuel Tracking', 'Mileage'],
        selected: true,
        selectedSubmenus: ['Fuel Tracking', 'Mileage']
      },
      {
        name: 'Car Tracking',
        key: 'car-tracking',
        submenus: ['Fuel Tracking', 'Mileage', 'Last Serviced', 'Next Service'],
        selected: true,
        selectedSubmenus: ['Fuel Tracking', 'Mileage', 'Last Serviced', 'Next Service']
      }
    ];
    if (savedMenus) {
      const parsed = JSON.parse(savedMenus);
      this.menus = defaultMenus.map(menu => {
        const found = parsed.find((m: any) => m.key === menu.key);
        return {
          ...menu,
          selected: found ? !!found : true
        };
      });
      // Add any custom menus from storage
      parsed.forEach((m: any) => {
        if (!defaultMenus.some(dm => dm.key === m.key)) {
          this.menus.push({
            name: m.name,
            key: m.key,
            submenus: [],
            selected: true,
            selectedSubmenus: []
          });
        }
      });
    } else {
      this.menus = defaultMenus;
    }
  }

  onMenuToggle(menu: CustomizationMenu) {
    if (!menu.selected) {
      menu.selectedSubmenus = [];
    } else {
      menu.selectedSubmenus = [...menu.submenus];
    }
  }

  // (removed duplicate and misplaced code)

  saveMenus() {
    // Save both sidebar menu and submenu selections
    const sidebarMenus = this.menus
      .filter(m => m.selected)
      .map(m => ({
        name: m.name,
        key: m.key,
        icon: this.getIcon(m.key),
        route: '/' + m.key,
        submenus: m.selectedSubmenus
      }));
    sessionStorage.setItem('customMenus', JSON.stringify(sidebarMenus));
    sessionStorage.setItem('customSubmenus', JSON.stringify(
      this.menus.reduce((acc, m) => {
        acc[m.key] = m.selectedSubmenus;
        return acc;
      }, {} as Record<string, string[]>)
    ));
    // Refresh the app to show updated menu
    window.location.reload();
  }

  getIcon(key: string): string {
    switch (key) {
      case 'dashboard': return 'fas fa-home';
      case 'salary-income': return 'fas fa-money-bill-wave';
      case 'technical-support': return 'fas fa-headset';
      case 'placement-assistance': return 'fas fa-user-tie';
      case 'bike-tracking': return 'fas fa-motorcycle';
      case 'car-tracking': return 'fas fa-car-side';
      default: return 'fas fa-cog';
    }
  }
}
