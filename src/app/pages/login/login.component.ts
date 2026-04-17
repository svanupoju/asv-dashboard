import { Component, NgZone } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { getApps, initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  getAuth,
  GoogleAuthProvider,
  setPersistence,
  signInWithPopup
} from 'firebase/auth';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss']
})
export class LoginComponent {
  showLogoutMsg = false;

  googleSigningIn = false;
  loginError: string | null = null;

  constructor(private router: Router, private route: ActivatedRoute, private ngZone: NgZone) {
    this.route.queryParams.subscribe(params => {
      if (params['logout']) {
        this.showLogoutMsg = true;
      }
    });
  }

  async signInWithGoogle() {
    this.loginError = null;
    this.googleSigningIn = true;

    try {
      if (!getApps().length) initializeApp(environment.firebase);

      const auth = getAuth();
      await setPersistence(auth, browserLocalPersistence);

      const provider = new GoogleAuthProvider();
      // Needed for uploading PDFs to the user's Google Drive (no Firebase Storage billing).
      provider.addScope('https://www.googleapis.com/auth/drive.file');

      const result = await signInWithPopup(auth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      const googleAccessToken = credential?.accessToken;
      if (googleAccessToken) {
        sessionStorage.setItem('googleAccessToken', googleAccessToken);
      } else {
        sessionStorage.removeItem('googleAccessToken');
      }

      const user = auth.currentUser;
      const email = user?.email;
      if (!user || !email) throw new Error('Firebase Auth did not return a user/email.');

      const idToken = await user.getIdToken();
      sessionStorage.setItem('token', idToken);
      sessionStorage.setItem('email', email);

      this.ngZone.run(() => {
        this.router.navigate(['/dashboard']);
      });
    } catch (e: any) {
      console.error('Firebase Auth sign-in failed:', e);

      const code = String(e?.code ?? '');

      if (code === 'auth/operation-not-allowed') {
        this.loginError =
          'Google sign-in is disabled in Firebase Authentication. Enable Google provider in Firebase Console → Authentication → Sign-in method.';
      } else if (code === 'auth/popup-blocked') {
        this.loginError = 'Popup was blocked by the browser. Allow popups for this site and try again.';
      } else if (code === 'auth/popup-closed-by-user') {
        this.loginError = 'Sign-in popup was closed before completing. Please try again.';
      } else {
        this.loginError = e?.message ? String(e.message) : 'Google sign-in failed for Firebase.';
      }
    } finally {
      this.googleSigningIn = false;
    }
  }
}
