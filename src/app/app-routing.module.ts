import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AuthGuard } from './auth.guard';
import { MainLayoutComponent } from './layouts/main-layout.component';
import { DashboardComponent } from './pages/dashboard/dashboard.component';
import { LoginComponent } from './pages/login/login.component';
import { TechnicalSupportComponent } from './pages/technical-support/technical-support.component';
import { SalaryIncomeComponent } from './pages/salary-income/salary-income.component';
import { InterviewAssistanceComponent } from './pages/interview-assistance/interview-assistance.component';
import { InstructorsComponent } from './pages/instructors/instructors.component';
import { SettingsComponent } from './pages/settings/settings.component';
import { CustomizationComponent } from './pages/customization/customization.component';

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
      { path: 'interview-assistance', component: InterviewAssistanceComponent },
      { path: 'instructors', component: InstructorsComponent },
      { path: 'settings', component: SettingsComponent },
      { path: 'customization', component: CustomizationComponent },
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
