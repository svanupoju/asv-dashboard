import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AuthGuard } from './auth.guard';
import { MainLayoutComponent } from './layouts/main-layout.component';
import { DashboardComponent } from './pages/dashboard/dashboard.component';
import { LoginComponent } from './pages/login/login.component';
import { TechnicalSupportComponent } from './pages/technical-support/technical-support.component';
import { SalaryIncomeComponent } from './pages/salary-income/salary-income.component';
import { PlacementAssistanceComponent } from './pages/placement-assistance/placement-assistance.component';
import { InstructorsComponent } from './pages/instructors/instructors.component';
import { SettingsComponent } from './pages/settings/settings.component';
import { CustomizationComponent } from './pages/customization/customization.component';
import { BikeTrackingComponent } from './pages/bike-tracking/bike-tracking.component';
import { CarTrackingComponent } from './pages/car-tracking/car-tracking.component';


const routes: Routes = [
  { path: 'login', component: LoginComponent },
  {
    path: '',
    component: MainLayoutComponent,
    canActivate: [AuthGuard],
    children: [
      { path: 'dashboard', component: DashboardComponent },
      { path: 'salary-income', component: SalaryIncomeComponent },
      { path: 'technical-support', component: TechnicalSupportComponent },
      { path: 'placement-assistance', component: PlacementAssistanceComponent },
      { path: 'bike-tracking', component: BikeTrackingComponent },
      { path: 'car-tracking', component: CarTrackingComponent },
      { path: '**', redirectTo: 'dashboard' }
    ]
  },
  { path: '**', redirectTo: '' }
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule {}
