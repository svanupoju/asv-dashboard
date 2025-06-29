import { Component, NgZone, AfterViewInit } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss']
})
export class LoginComponent implements AfterViewInit {
  username = '';
  password = '';
  googleClientId = '';
  showLogoutMsg = false;

  constructor(private router: Router, private route: ActivatedRoute, private ngZone: NgZone) {
    this.route.queryParams.subscribe(params => {
      if (params['logout']) {
        this.showLogoutMsg = true;
      }
    });
  }

  handleCredentialResponse(response: any) {
    // Store the original Google credential as the token
    localStorage.setItem('token', response.credential);
    // Decode the JWT to get the email
    try {
      const payload = JSON.parse(atob(response.credential.split('.')[1]));
      if (payload && payload.email) {
        localStorage.setItem('email', payload.email);
      }
    } catch (e) {
      localStorage.removeItem('email');
    }
    this.ngZone.run(() => {
      this.router.navigate(['/dashboard']);
    });
  }

  onSubmit(event: Event) {
    event.preventDefault();
    // Store the entered username as email and as a dummy token
    localStorage.setItem('token', this.username);
    localStorage.setItem('email', this.username);
    this.router.navigate(['/dashboard']);
  }

  ngAfterViewInit() {
    fetch('assets/google-client-id.txt')
      .then(res => res.text())
      .then(clientId => {
        this.googleClientId = clientId.trim();
        this.renderGoogleSignInButton();
      });
  }

  renderGoogleSignInButton() {
    if ((window as any).google && this.googleClientId) {
      (window as any).google.accounts.id.initialize({
        client_id: this.googleClientId,
        callback: (response: any) => this.handleCredentialResponse(response)
      });
      (window as any).google.accounts.id.renderButton(
        document.getElementById('google-signin-btn'),
        { theme: 'outline', size: 'large', width: 320 }
      );
    }
  }
}
