

import { NgModule, importProvidersFrom } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { AuthGuard } from './auth.guard';
import { SidebarComponent } from './shared/sidebar/sidebar.component';
import { HeaderComponent } from './shared/header/header.component';
import { MainLayoutComponent } from './layouts/main-layout.component';
import { DashboardComponent } from './pages/dashboard/dashboard.component';
import { TechnicalSupportComponent } from './pages/technical-support/technical-support.component';
import { SalaryIncomeComponent } from './pages/salary-income/salary-income.component';
import { PlacementAssistanceComponent } from './pages/placement-assistance/placement-assistance.component';
import { InstructorsComponent } from './pages/instructors/instructors.component';
import { SettingsComponent } from './pages/settings/settings.component';
import { CustomizationComponent } from './pages/customization/customization.component';
import { LoginComponent } from './pages/login/login.component';
import { BikeTrackingComponent } from './pages/bike-tracking/bike-tracking.component';
import { CarTrackingComponent } from './pages/car-tracking/car-tracking.component';
import { provideFirebaseApp, initializeApp } from '@angular/fire/app';
import { provideFirestore, getFirestore } from '@angular/fire/firestore';
import { environment } from '../environments/environment';


@NgModule({
  declarations: [
    AppComponent,
    SidebarComponent,
    HeaderComponent,
    MainLayoutComponent,
    DashboardComponent,
    TechnicalSupportComponent,
    SalaryIncomeComponent,
    PlacementAssistanceComponent,
    LoginComponent,
    InstructorsComponent,
    SettingsComponent,
    CustomizationComponent,
    BikeTrackingComponent,
    CarTrackingComponent
  ],
  imports: [
    BrowserModule,
    FormsModule,
    AppRoutingModule,
  ],
  providers: [
    AuthGuard,
    provideFirebaseApp(() => initializeApp(environment.firebase)),
    provideFirestore(() => getFirestore()),
  ],
  bootstrap: [AppComponent]
})
export class AppModule {}
