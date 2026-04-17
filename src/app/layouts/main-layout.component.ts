import { AfterViewInit, Component, ElementRef, HostListener, OnInit, ViewChild } from '@angular/core';

@Component({
  selector: 'app-main-layout',
  templateUrl: './main-layout.component.html',
  styleUrls: ['./main-layout.component.scss']
})
export class MainLayoutComponent implements OnInit, AfterViewInit {
  @ViewChild('layoutHeader', { read: ElementRef }) layoutHeader?: ElementRef<HTMLElement>;
  sidebarCollapsed = false;
  private wasMobileViewport = false;
  headerOffset = 64;

  ngOnInit(): void {
    this.syncSidebarForViewport();
  }

  ngAfterViewInit(): void {
    this.updateHeaderOffset();
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.syncSidebarForViewport();
    this.updateHeaderOffset();
  }

  toggleSidebar() {
    this.sidebarCollapsed = !this.sidebarCollapsed;
    this.updateHeaderOffset();
  }

  onSidebarMenuSelected(): void {
    if (window.innerWidth <= 767.98) {
      this.sidebarCollapsed = true;
      this.updateHeaderOffset();
    }
  }

  private syncSidebarForViewport(): void {
    const isMobileViewport = window.innerWidth <= 767.98;

    if (isMobileViewport && !this.wasMobileViewport) {
      this.sidebarCollapsed = true;
    }

    this.wasMobileViewport = isMobileViewport;
  }

  private updateHeaderOffset(): void {
    setTimeout(() => {
      const measuredHeight = this.layoutHeader?.nativeElement.getBoundingClientRect().height ?? 64;
      this.headerOffset = Math.max(64, Math.round(measuredHeight));
    });
  }
}
