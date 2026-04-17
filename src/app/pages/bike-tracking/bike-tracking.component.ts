import { Component, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { getApps, initializeApp } from 'firebase/app';
import { addDoc, collection, deleteDoc, doc, getFirestore, onSnapshot, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { getAuth, onAuthStateChanged, User } from 'firebase/auth';
import { environment } from '../../../environments/environment';
import { GlobalPeriodFilterService } from '../../shared/services/global-period-filter.service';
import { normalizeAppEmail } from '../../shared/utils/email-alias.util';

type VehicleDocumentType = 'insurance' | 'pollution' | 'drivingLicense' | 'rc';

interface VehicleDocumentOption {
  key: VehicleDocumentType;
  label: string;
  numberPlaceholder: string;
}

interface BikeFuelEntry {
  id?: string;
  date: string;
  monthOnly: string;
  year: number;
  odometer: number;
  fuelLiters: number;
  amount: number;
  mileage: number;
  fuelRate: number;
  distance: number;
  category: string;
  vehicleType: 'bike';
  vehicleId?: string;
  vehicleName?: string;
  notes: string;
  email: string;
}

interface VehicleServiceSchedule {
  lastServiced: string;
  lastServiceOdometer: number | null;
}

interface VehicleDocumentForm {
  id: string | null;
  documentNumber: string;
  expiryDate: string;
}

interface VehicleProfile {
  id?: string;
  name: string;
  vehicleType: 'bike';
  email: string;
  isDefault?: boolean;
  isPreferred?: boolean;
}

interface VehicleDocumentUpload {
  id?: string;
  vehicleType: 'bike';
  vehicleId: string;
  vehicleName: string;
  documentType: string;
  documentNumber?: string | null;
  expiryDate?: string | null;
  fileName: string;
  size: number;
  storageProvider: 'gdrive';
  driveFileId: string;
  storagePath: string;
  downloadUrl: string;
  email: string;
  uploadedAtMs: number;
}

@Component({
  selector: 'app-bike-tracking',
  templateUrl: './bike-tracking.component.html',
  styleUrls: ['./bike-tracking.component.scss']
})
export class BikeTrackingComponent implements OnDestroy {
  private readonly vehicleType = 'bike';
  private readonly serviceIntervalKm = 4000;
  private readonly serviceIntervalMonths = 4;
  readonly documentTypeOptions: VehicleDocumentOption[] = [
    { key: 'insurance', label: 'Insurance', numberPlaceholder: 'Policy number' },
    { key: 'pollution', label: 'Pollution', numberPlaceholder: 'Certificate number' },
    { key: 'drivingLicense', label: 'Driving License', numberPlaceholder: 'License number' },
    { key: 'rc', label: 'RC', numberPlaceholder: 'Registration certificate number' }
  ];

  months: string[] = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  firestore;
  user: User | null = null;
  userEmail: string | null = null;
  authChecked = false;
  globalFilterSelections: Record<string, string[]> = {};
  saveInProgress = false;
  deletingEntryId: string | null = null;
  trackerError: string | null = null;
  serviceScheduleId: string | null = null;
  savingServiceSchedule = false;
  savingDocumentType: VehicleDocumentType | null = null;
  addingVehicle = false;
  updatingVehicle = false;
  deletingVehicle = false;
  uploadingDocument = false;
  deletingUploadId: string | null = null;

  currentFuelRate = 106;
  selectedVehicleId = '';
  newVehicleName = '';
  selectedVehicleNameDraft = '';
  documentUploadType: VehicleDocumentType = 'insurance';

  entryForm = {
    date: new Date().toISOString().split('T')[0],
    odometer: null as number | null,
    amount: null as number | null
  };

  serviceSchedule: VehicleServiceSchedule = {
    lastServiced: '',
    lastServiceOdometer: null
  };

  documentForms: Record<VehicleDocumentType, VehicleDocumentForm> = {
    insurance: this.createEmptyDocumentForm(),
    pollution: this.createEmptyDocumentForm(),
    drivingLicense: this.createEmptyDocumentForm(),
    rc: this.createEmptyDocumentForm()
  };

  vehicles: VehicleProfile[] = [];
  entries: BikeFuelEntry[] = [];
  private serviceScheduleRows: any[] = [];
  private vehicleDocumentRows: any[] = [];
  private documentUploads: VehicleDocumentUpload[] = [];
  private ensuringDefaultVehicle = false;

  private globalFilterSubscription?: Subscription;
  private vehiclesUnsubscribe?: () => void;
  private entriesUnsubscribe?: () => void;
  private serviceScheduleUnsubscribe?: () => void;
  private documentsUnsubscribe?: () => void;
  private uploadsUnsubscribe?: () => void;

  constructor(private readonly globalPeriodFilterService: GlobalPeriodFilterService) {
    if (!getApps().length) {
      initializeApp(environment.firebase);
    }

    this.firestore = getFirestore();

    this.globalFilterSubscription = this.globalPeriodFilterService.filter$.subscribe((filter) => {
      this.globalFilterSelections = this.cloneGlobalFilterSelections(filter?.selections);
    });

    onAuthStateChanged(getAuth(), (user) => {
      this.user = user;
      this.authChecked = true;
      this.userEmail = normalizeAppEmail(user?.email) ?? normalizeAppEmail(sessionStorage.getItem('email')) ?? null;

      this.vehiclesUnsubscribe?.();
      this.entriesUnsubscribe?.();
      this.serviceScheduleUnsubscribe?.();
      this.documentsUnsubscribe?.();
      this.uploadsUnsubscribe?.();

      this.vehicles = [];
      this.entries = [];
      this.serviceScheduleRows = [];
      this.vehicleDocumentRows = [];
      this.documentUploads = [];
      this.selectedVehicleId = '';
      this.resetSelectedVehicleState();

      if (this.userEmail) {
        sessionStorage.setItem('email', this.userEmail);
        this.subscribeToVehicles();
        this.subscribeToEntries();
        this.subscribeToServiceSchedule();
        this.subscribeToDocuments();
        this.subscribeToDocumentUploads();
      }
    });
  }

  ngOnDestroy(): void {
    this.globalFilterSubscription?.unsubscribe();
    this.vehiclesUnsubscribe?.();
    this.entriesUnsubscribe?.();
    this.serviceScheduleUnsubscribe?.();
    this.documentsUnsubscribe?.();
    this.uploadsUnsubscribe?.();
  }

  get selectedVehicle(): VehicleProfile | null {
    return this.vehicles.find((vehicle) => vehicle.id === this.selectedVehicleId) ?? null;
  }

  get hasVehicles(): boolean {
    return this.vehicles.length > 0;
  }

  get selectedVehicleName(): string {
    return this.selectedVehicle?.name ?? 'Bike';
  }

  get filteredEntries(): BikeFuelEntry[] {
    return this.selectedVehicleEntries.filter((entry) => this.matchesGlobalMonthKey(this.getMonthKey(entry)));
  }

  get hasActiveGlobalFilter(): boolean {
    return Object.keys(this.globalFilterSelections).length > 0;
  }

  get selectedVehicleUploads(): VehicleDocumentUpload[] {
    return this.documentUploads.filter((upload) => this.matchesSelectedVehicle(upload.vehicleId));
  }

  private get selectedVehicleEntries(): BikeFuelEntry[] {
    return this.entries.filter((entry) => this.entryBelongsToSelectedVehicle(entry.vehicleId));
  }

  private get positiveAmountEntries(): BikeFuelEntry[] {
    return this.filteredEntries.filter((entry) => entry.amount > 0);
  }

  private get latestPositiveEntry(): BikeFuelEntry | null {
    return this.selectedVehicleEntries.find((entry) => entry.amount > 0) ?? null;
  }

  get totalFuelLiters(): number {
    return this.positiveAmountEntries.reduce((sum, entry) => sum + entry.fuelLiters, 0);
  }

  get totalFuelSpend(): number {
    return this.positiveAmountEntries.reduce((sum, entry) => sum + entry.amount, 0);
  }

  get averageMileage(): number {
    const mileageEntries = this.positiveAmountEntries.filter((entry) => entry.mileage > 0);
    if (!mileageEntries.length) {
      return 0;
    }

    return mileageEntries.reduce((sum, entry) => sum + entry.mileage, 0) / mileageEntries.length;
  }

  get latestOdometer(): number {
    return this.filteredEntries.length ? this.filteredEntries[0].odometer : 0;
  }

  get previousOdometer(): number {
    return this.latestPositiveEntry?.odometer ?? 0;
  }

  get nextServiceDate(): string {
    if (!this.serviceSchedule.lastServiced) {
      return '';
    }

    return this.addMonthsToIso(this.serviceSchedule.lastServiced, this.serviceIntervalMonths);
  }

  get nextServiceOdometer(): number {
    const lastServiceOdometer = this.serviceSchedule.lastServiceOdometer ?? 0;
    return lastServiceOdometer > 0 ? lastServiceOdometer + this.serviceIntervalKm : 0;
  }

  get serviceKmRemaining(): number {
    if (!this.nextServiceOdometer || !this.latestPositiveEntry) {
      return 0;
    }

    return Math.max(this.nextServiceOdometer - this.latestPositiveEntry.odometer, 0);
  }

  get currentFuelLitersPreview(): number {
    if (!this.entryForm.amount || this.entryForm.amount <= 0 || this.currentFuelRate <= 0) {
      return 0;
    }

    return this.entryForm.amount / this.currentFuelRate;
  }

  get currentDistancePreview(): number {
    if (this.entryForm.odometer === null || !this.latestPositiveEntry) {
      return 0;
    }

    return Math.max(0, this.entryForm.odometer - this.latestPositiveEntry.odometer);
  }

  get currentMileagePreview(): number {
    const liters = this.currentFuelLitersPreview;
    const distance = this.currentDistancePreview;

    if (!liters || !distance) {
      return 0;
    }

    return distance / liters;
  }

  get canCalculateMileage(): boolean {
    return !!this.latestPositiveEntry && this.currentFuelLitersPreview > 0 && this.currentDistancePreview > 0;
  }

  onVehicleSelectionChange(): void {
    this.refreshSelectedVehicleState();
    void this.setPreferredVehicle(this.selectedVehicleId);
  }

  async updateSelectedVehicle(): Promise<void> {
    const vehicle = this.selectedVehicle;
    const vehicleId = String(vehicle?.id ?? '').trim();
    const nextName = String(this.selectedVehicleNameDraft ?? '').trim();

    if (!this.userEmail || !vehicleId || !nextName) {
      return;
    }

    const currentName = String(vehicle?.name ?? '').trim();
    if (!currentName || currentName === nextName) {
      this.selectedVehicleNameDraft = currentName;
      return;
    }

    const exists = this.vehicles.some(
      (item) => item.id !== vehicleId && item.name.trim().toLowerCase() === nextName.toLowerCase()
    );
    if (exists) {
      this.trackerError = 'A bike with that name already exists.';
      return;
    }

    this.updatingVehicle = true;
    this.trackerError = null;

    try {
      await updateDoc(doc(this.firestore, 'vehicleProfiles', vehicleId), {
        name: nextName,
        email: this.userEmail
      });

      const relatedEntryUpdates = this.entries
        .filter((entry) => this.entryBelongsToVehicle(entry.vehicleId, vehicleId))
        .filter((entry) => String(entry.id ?? '').trim())
        .map((entry) =>
          updateDoc(doc(this.firestore, 'monthlyDebits', String(entry.id)), {
            vehicleName: nextName,
            notes: `Bike Tracking - ${nextName}`,
            email: this.userEmail
          })
        );

      const relatedScheduleUpdates = this.serviceScheduleRows
        .filter((row) => this.rowBelongsToVehicle(row, vehicleId))
        .filter((row) => String(row?.id ?? '').trim())
        .map((row) =>
          updateDoc(doc(this.firestore, 'vehicleServiceSchedules', String(row.id)), {
            vehicleName: nextName,
            email: this.userEmail
          })
        );

      const relatedDocumentUpdates = this.vehicleDocumentRows
        .filter((row) => this.rowBelongsToVehicle(row, vehicleId))
        .filter((row) => String(row?.id ?? '').trim())
        .map((row) =>
          updateDoc(doc(this.firestore, 'vehicleDocuments', String(row.id)), {
            vehicleName: nextName,
            email: this.userEmail
          })
        );

      const relatedUploadUpdates = this.documentUploads
        .filter((upload) => this.entryBelongsToVehicle(upload.vehicleId, vehicleId))
        .filter((upload) => String(upload?.id ?? '').trim())
        .map((upload) =>
          updateDoc(doc(this.firestore, 'vehicleDocumentUploads', String(upload.id)), {
            vehicleName: nextName,
            email: this.userEmail
          })
        );

      await Promise.all([
        ...relatedEntryUpdates,
        ...relatedScheduleUpdates,
        ...relatedDocumentUpdates,
        ...relatedUploadUpdates
      ]);
    } catch (error: any) {
      console.error('Failed to update bike profile:', error);
      this.trackerError = error?.message ? String(error.message) : 'Failed to update bike.';
    } finally {
      this.updatingVehicle = false;
    }
  }

  async deleteSelectedVehicle(): Promise<void> {
    const vehicle = this.selectedVehicle;
    const vehicleId = String(vehicle?.id ?? '').trim();
    const vehicleName = String(vehicle?.name ?? '').trim();

    if (!this.userEmail || !vehicleId) {
      return;
    }

    const confirmed = window.confirm(
      `Delete ${vehicleName || 'this bike'} and all its fuel entries, service records, documents, and uploaded files?`
    );
    if (!confirmed) {
      return;
    }

    this.deletingVehicle = true;
    this.trackerError = null;

    try {
      const relatedUploads = this.documentUploads.filter((upload) => this.entryBelongsToVehicle(upload.vehicleId, vehicleId));
      const driveDeletionErrors: string[] = [];

      await Promise.all(
        relatedUploads.map(async (upload) => {
          const driveFileId = this.getDriveFileId(upload);
          if (!driveFileId) {
            return;
          }

          try {
            await this.deleteDriveFile(driveFileId);
          } catch (error: any) {
            driveDeletionErrors.push(error?.message ? String(error.message) : `Failed to delete ${upload.fileName} from Google Drive.`);
          }
        })
      );

      const entryDeletes = this.entries
        .filter((entry) => this.entryBelongsToVehicle(entry.vehicleId, vehicleId))
        .filter((entry) => String(entry.id ?? '').trim())
        .map((entry) => deleteDoc(doc(this.firestore, 'monthlyDebits', String(entry.id))));

      const scheduleDeletes = this.serviceScheduleRows
        .filter((row) => this.rowBelongsToVehicle(row, vehicleId))
        .filter((row) => String(row?.id ?? '').trim())
        .map((row) => deleteDoc(doc(this.firestore, 'vehicleServiceSchedules', String(row.id))));

      const documentDeletes = this.vehicleDocumentRows
        .filter((row) => this.rowBelongsToVehicle(row, vehicleId))
        .filter((row) => String(row?.id ?? '').trim())
        .map((row) => deleteDoc(doc(this.firestore, 'vehicleDocuments', String(row.id))));

      const uploadDeletes = relatedUploads
        .filter((upload) => String(upload?.id ?? '').trim())
        .map((upload) => deleteDoc(doc(this.firestore, 'vehicleDocumentUploads', String(upload.id))));

      await Promise.all([
        ...entryDeletes,
        ...scheduleDeletes,
        ...documentDeletes,
        ...uploadDeletes,
        deleteDoc(doc(this.firestore, 'vehicleProfiles', vehicleId))
      ]);

      this.selectedVehicleId = '';
      this.selectedVehicleNameDraft = '';

      if (driveDeletionErrors.length) {
        this.trackerError = `Bike deleted from app, but some Google Drive files could not be removed: ${driveDeletionErrors.join(' ')}`;
      }
    } catch (error: any) {
      console.error('Failed to delete bike profile:', error);
      this.trackerError = error?.message ? String(error.message) : 'Failed to delete bike.';
    } finally {
      this.deletingVehicle = false;
    }
  }

  async addVehicle(): Promise<void> {
    const name = String(this.newVehicleName ?? '').trim();
    if (!this.userEmail || !name) {
      return;
    }

    const exists = this.vehicles.some((vehicle) => vehicle.name.trim().toLowerCase() === name.toLowerCase());
    if (exists) {
      this.trackerError = 'A bike with that name already exists.';
      return;
    }

    this.addingVehicle = true;
    this.trackerError = null;
    try {
      await addDoc(collection(this.firestore, 'vehicleProfiles'), {
        name,
        vehicleType: this.vehicleType,
        email: this.userEmail,
        isDefault: false,
        isPreferred: false,
        createdAt: serverTimestamp()
      });
      this.newVehicleName = '';
    } catch (error: any) {
      console.error('Failed to add bike profile:', error);
      this.trackerError = error?.message ? String(error.message) : 'Failed to add bike.';
    } finally {
      this.addingVehicle = false;
    }
  }

  async addEntry(): Promise<void> {
    if (!this.userEmail || !this.selectedVehicleId || !this.entryForm.date || this.entryForm.odometer === null || this.entryForm.amount === null || Number(this.entryForm.amount) <= 0 || this.currentFuelRate <= 0) {
      return;
    }

    const odometer = Number(this.entryForm.odometer);
    const amount = Number(this.entryForm.amount);
    const fuelLiters = amount / this.currentFuelRate;
    const distance = this.latestPositiveEntry ? Math.max(0, odometer - this.latestPositiveEntry.odometer) : 0;
    const mileage = distance > 0 && fuelLiters > 0 ? distance / fuelLiters : 0;
    const date = new Date(this.entryForm.date);
    const year = date.getFullYear();
    const monthOnly = this.months[date.getMonth()] ?? '';

    if (!year || !monthOnly) {
      return;
    }

    this.saveInProgress = true;
    this.trackerError = null;

    try {
      await addDoc(collection(this.firestore, 'monthlyDebits'), {
        category: 'Vehicle Maintenance',
        amount: String(amount),
        monthOnly,
        year,
        date: this.entryForm.date,
        notes: `Bike Tracking - ${this.selectedVehicleName}`,
        email: this.userEmail,
        vehicleType: 'bike',
        vehicleId: this.selectedVehicleId,
        vehicleName: this.selectedVehicleName,
        odometer,
        fuelRate: this.currentFuelRate,
        fuelLiters,
        distance,
        mileage
      });

      this.entryForm = {
        date: new Date().toISOString().split('T')[0],
        odometer: null,
        amount: null
      };
    } catch (error: any) {
      console.error('Failed to save bike entry:', error);
      this.trackerError = error?.message ? String(error.message) : 'Failed to save bike entry.';
    } finally {
      this.saveInProgress = false;
    }
  }

  async saveServiceSchedule(): Promise<void> {
    if (!this.userEmail || !this.selectedVehicleId || !this.serviceSchedule.lastServiced || !this.serviceSchedule.lastServiceOdometer || this.serviceSchedule.lastServiceOdometer <= 0) {
      return;
    }

    this.savingServiceSchedule = true;
    this.trackerError = null;

    const payload = {
      vehicleType: this.vehicleType,
      vehicleId: this.selectedVehicleId,
      vehicleName: this.selectedVehicleName,
      lastServiced: this.serviceSchedule.lastServiced,
      lastServiceOdometer: this.serviceSchedule.lastServiceOdometer,
      nextService: this.nextServiceDate,
      nextServiceOdometer: this.nextServiceOdometer,
      email: this.userEmail
    };

    try {
      if (this.serviceScheduleId) {
        await updateDoc(doc(this.firestore, 'vehicleServiceSchedules', this.serviceScheduleId), payload);
      } else {
        await addDoc(collection(this.firestore, 'vehicleServiceSchedules'), payload);
      }
    } catch (error: any) {
      console.error('Failed to save bike service schedule:', error);
      this.trackerError = error?.message ? String(error.message) : 'Failed to save bike service schedule.';
    } finally {
      this.savingServiceSchedule = false;
    }
  }

  async saveVehicleDocument(documentType: VehicleDocumentType): Promise<void> {
    const form = this.documentForms[documentType];
    if (!this.userEmail || !this.selectedVehicleId || !form.expiryDate) {
      return;
    }

    this.savingDocumentType = documentType;
    this.trackerError = null;

    const payload = {
      vehicleType: this.vehicleType,
      vehicleId: this.selectedVehicleId,
      vehicleName: this.selectedVehicleName,
      documentType: this.getDocumentTypeLabel(documentType),
      documentNumber: String(form.documentNumber ?? '').trim(),
      expiryDate: form.expiryDate,
      email: this.userEmail
    };

    try {
      if (form.id) {
        await updateDoc(doc(this.firestore, 'vehicleDocuments', form.id), payload);
      } else {
        await addDoc(collection(this.firestore, 'vehicleDocuments'), payload);
      }
    } catch (error: any) {
      console.error('Failed to save bike document:', error);
      this.trackerError = error?.message ? String(error.message) : 'Failed to save bike document.';
    } finally {
      this.savingDocumentType = null;
    }
  }

  async onDocumentFilesSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file || !this.userEmail || !this.selectedVehicleId) {
      if (input) {
        input.value = '';
      }
      return;
    }

    this.uploadingDocument = true;
    this.trackerError = null;

    try {
      const stored = await this.storeDocumentToGoogleDrive(file, this.documentUploadType);
      const form = this.documentForms[this.documentUploadType];

      await addDoc(collection(this.firestore, 'vehicleDocumentUploads'), {
        email: this.userEmail,
        vehicleType: this.vehicleType,
        vehicleId: this.selectedVehicleId,
        vehicleName: this.selectedVehicleName,
        documentType: this.getDocumentTypeLabel(this.documentUploadType),
        documentNumber: String(form.documentNumber ?? '').trim() || null,
        expiryDate: form.expiryDate || null,
        fileName: stored.fileName,
        size: file.size,
        storageProvider: 'gdrive',
        driveFileId: stored.driveFileId,
        storagePath: stored.storagePath,
        downloadUrl: stored.downloadUrl,
        uploadedAt: serverTimestamp()
      });
    } catch (error: any) {
      console.error('Failed to upload bike document:', error);
      this.trackerError = error?.message ? String(error.message) : 'Failed to upload bike document.';
    } finally {
      this.uploadingDocument = false;
      if (input) {
        input.value = '';
      }
    }
  }

  async deleteDocumentUpload(upload: VehicleDocumentUpload): Promise<void> {
    const uploadId = String(upload?.id ?? '').trim();
    if (!uploadId) {
      return;
    }

    this.deletingUploadId = uploadId;
    this.trackerError = null;

    try {
      const driveFileId = this.getDriveFileId(upload);
      let driveDeleteError: string | null = null;

      if (driveFileId) {
        try {
          await this.deleteDriveFile(driveFileId);
        } catch (error: any) {
          driveDeleteError = error?.message ? String(error.message) : 'Failed to delete from Google Drive.';
        }
      }

      await deleteDoc(doc(this.firestore, 'vehicleDocumentUploads', uploadId));

      if (driveDeleteError) {
        this.trackerError = `Deleted from app, but could not delete from Google Drive: ${driveDeleteError}`;
      }
    } catch (error: any) {
      console.error('Failed to delete bike document upload:', error);
      this.trackerError = error?.message ? String(error.message) : 'Failed to delete bike document.';
    } finally {
      this.deletingUploadId = null;
    }
  }

  getDocumentStatus(expiryDate: string): string {
    if (!expiryDate) {
      return 'Expiry not set';
    }

    const today = new Date();
    const expiry = new Date(expiryDate);
    today.setHours(0, 0, 0, 0);
    expiry.setHours(0, 0, 0, 0);
    const diffDays = Math.ceil((expiry.getTime() - today.getTime()) / 86400000);

    if (diffDays < 0) {
      return 'Expired';
    }

    if (diffDays === 0) {
      return 'Expires today';
    }

    return `Due in ${diffDays} days`;
  }

  async deleteEntry(entry: BikeFuelEntry): Promise<void> {
    const entryId = String(entry?.id ?? '').trim();
    if (!entryId) {
      return;
    }

    this.deletingEntryId = entryId;
    this.trackerError = null;

    try {
      await deleteDoc(doc(this.firestore, 'monthlyDebits', entryId));
    } catch (error: any) {
      console.error('Failed to delete bike entry:', error);
      this.trackerError = error?.message ? String(error.message) : 'Failed to delete bike entry.';
    } finally {
      this.deletingEntryId = null;
    }
  }

  private subscribeToVehicles(): void {
    if (!this.userEmail) {
      return;
    }

    const vehiclesRef = query(collection(this.firestore, 'vehicleProfiles'), where('email', '==', this.userEmail));
    this.vehiclesUnsubscribe = onSnapshot(vehiclesRef, (snapshot) => {
      const rows = snapshot.docs
        .map((document) => ({ id: document.id, ...(document.data() as any) }))
        .filter((item) => String(item?.vehicleType ?? '').trim() === this.vehicleType)
        .map((item) => ({
          id: String(item.id ?? ''),
          name: String(item.name ?? '').trim(),
          vehicleType: this.vehicleType,
          email: String(item.email ?? '').trim(),
          isDefault: !!item.isDefault,
          isPreferred: !!item.isPreferred
        } as VehicleProfile))
        .sort((left, right) => {
          if (!!left.isPreferred !== !!right.isPreferred) {
            return left.isPreferred ? -1 : 1;
          }
          if (!!left.isDefault !== !!right.isDefault) {
            return left.isDefault ? -1 : 1;
          }
          return left.name.localeCompare(right.name);
        });

      this.vehicles = rows;

      if (!rows.length) {
        this.selectedVehicleId = '';
        this.selectedVehicleNameDraft = '';
        this.resetSelectedVehicleState();
        void this.ensureDefaultVehicle();
        return;
      }

      const currentExists = rows.some((vehicle) => vehicle.id === this.selectedVehicleId);
      const preferredVehicle = rows.find((vehicle) => vehicle.isPreferred) ?? rows[0];
      this.selectedVehicleId = currentExists ? this.selectedVehicleId : String(preferredVehicle?.id ?? '');
      this.refreshSelectedVehicleState();
    }, (error) => {
      console.error('Failed to load bike profiles:', error);
      this.trackerError = error?.message ? String(error.message) : 'Failed to load bikes.';
      this.vehicles = [];
      this.selectedVehicleId = '';
      this.selectedVehicleNameDraft = '';
      this.resetSelectedVehicleState();
    });
  }

  private subscribeToEntries(): void {
    if (!this.userEmail) {
      return;
    }

    const rowsRef = query(collection(this.firestore, 'monthlyDebits'), where('email', '==', this.userEmail));
    this.entriesUnsubscribe = onSnapshot(rowsRef, (snapshot) => {
      this.entries = snapshot.docs
        .map((document) => {
          const data = document.data() as any;
          return {
            id: document.id,
            date: String(data?.date ?? '').trim(),
            monthOnly: String(data?.monthOnly ?? '').trim(),
            year: Number(data?.year ?? 0),
            odometer: this.parseNumber(data?.odometer),
            fuelLiters: this.parseNumber(data?.fuelLiters),
            amount: this.parseNumber(data?.amount),
            mileage: this.parseNumber(data?.mileage),
            fuelRate: this.parseNumber(data?.fuelRate),
            distance: this.parseNumber(data?.distance),
            category: String(data?.category ?? '').trim(),
            vehicleType: 'bike',
            vehicleId: String(data?.vehicleId ?? '').trim(),
            vehicleName: String(data?.vehicleName ?? '').trim(),
            notes: String(data?.notes ?? '').trim(),
            email: String(data?.email ?? '').trim()
          } as BikeFuelEntry;
        })
        .filter((row) => String(row.vehicleType ?? '').trim() === this.vehicleType)
        .sort((left, right) => String(right.date).localeCompare(String(left.date)));
    }, (error) => {
      console.error('Failed to load bike entries:', error);
      this.trackerError = error?.message ? String(error.message) : 'Failed to load bike entries.';
      this.entries = [];
    });
  }

  private subscribeToServiceSchedule(): void {
    if (!this.userEmail) {
      return;
    }

    const scheduleRef = query(collection(this.firestore, 'vehicleServiceSchedules'), where('email', '==', this.userEmail));
    this.serviceScheduleUnsubscribe = onSnapshot(scheduleRef, (snapshot) => {
      this.serviceScheduleRows = snapshot.docs
        .map((document) => ({ id: document.id, ...(document.data() as any) }))
        .filter((item) => String(item?.vehicleType ?? '').trim() === this.vehicleType);
      this.refreshSelectedVehicleState();
    }, (error) => {
      console.error('Failed to load bike service schedule:', error);
      this.trackerError = error?.message ? String(error.message) : 'Failed to load bike service schedule.';
    });
  }

  private subscribeToDocuments(): void {
    if (!this.userEmail) {
      return;
    }

    const documentsRef = query(collection(this.firestore, 'vehicleDocuments'), where('email', '==', this.userEmail));
    this.documentsUnsubscribe = onSnapshot(documentsRef, (snapshot) => {
      this.vehicleDocumentRows = snapshot.docs
        .map((document) => ({ id: document.id, ...(document.data() as any) }))
        .filter((item) => String(item?.vehicleType ?? '').trim() === this.vehicleType);
      this.refreshSelectedVehicleState();
    }, (error) => {
      console.error('Failed to load bike documents:', error);
      this.trackerError = error?.message ? String(error.message) : 'Failed to load bike documents.';
    });
  }

  private subscribeToDocumentUploads(): void {
    if (!this.userEmail) {
      return;
    }

    const uploadsRef = query(collection(this.firestore, 'vehicleDocumentUploads'), where('email', '==', this.userEmail));
    this.uploadsUnsubscribe = onSnapshot(uploadsRef, (snapshot) => {
      this.documentUploads = snapshot.docs
        .map((document) => {
          const data = document.data() as any;
          return {
            id: document.id,
            vehicleType: this.vehicleType,
            vehicleId: String(data?.vehicleId ?? '').trim(),
            vehicleName: String(data?.vehicleName ?? '').trim(),
            documentType: String(data?.documentType ?? '').trim(),
            documentNumber: typeof data?.documentNumber === 'string' ? data.documentNumber : null,
            expiryDate: typeof data?.expiryDate === 'string' ? data.expiryDate : null,
            fileName: String(data?.fileName ?? '').trim(),
            size: this.parseNumber(data?.size),
            storageProvider: 'gdrive',
            driveFileId: String(data?.driveFileId ?? '').trim(),
            storagePath: String(data?.storagePath ?? '').trim(),
            downloadUrl: String(data?.downloadUrl ?? '').trim(),
            email: String(data?.email ?? '').trim(),
            uploadedAtMs: this.toMillis(data?.uploadedAt)
          } as VehicleDocumentUpload;
        })
        .filter((upload) => upload.vehicleType === this.vehicleType)
        .sort((left, right) => right.uploadedAtMs - left.uploadedAtMs);
    }, (error) => {
      console.error('Failed to load bike document uploads:', error);
      this.trackerError = error?.message ? String(error.message) : 'Failed to load bike document uploads.';
      this.documentUploads = [];
    });
  }

  private refreshSelectedVehicleState(): void {
    if (!this.selectedVehicleId) {
      this.selectedVehicleNameDraft = '';
      this.resetSelectedVehicleState();
      return;
    }

    const selectedVehicle = this.selectedVehicle;
    this.selectedVehicleNameDraft = String(selectedVehicle?.name ?? '');
    const allowLegacy = !!selectedVehicle?.isDefault;

    const scheduleRow = this.serviceScheduleRows.find((item) => {
      const rowVehicleId = String(item?.vehicleId ?? '').trim();
      if (rowVehicleId) {
        return rowVehicleId === this.selectedVehicleId;
      }
      return allowLegacy;
    });

    this.serviceScheduleId = scheduleRow?.id ? String(scheduleRow.id) : null;
    this.serviceSchedule = {
      lastServiced: String(scheduleRow?.lastServiced ?? ''),
      lastServiceOdometer: this.parseNullableNumber(scheduleRow?.lastServiceOdometer)
    };

    for (const option of this.documentTypeOptions) {
      const row = this.vehicleDocumentRows.find(
        (item) => this.matchesVehicleRow(item, allowLegacy) && this.normalizeDocumentType(item?.documentType) === option.key
      );
      this.documentForms[option.key] = this.buildDocumentForm(row);
    }
  }

  private resetSelectedVehicleState(): void {
    this.serviceScheduleId = null;
    this.serviceSchedule = {
      lastServiced: '',
      lastServiceOdometer: null
    };
    for (const option of this.documentTypeOptions) {
      this.documentForms[option.key] = this.createEmptyDocumentForm();
    }
  }

  private buildDocumentForm(row: any): VehicleDocumentForm {
    return {
      id: row?.id ? String(row.id) : null,
      documentNumber: String(row?.documentNumber ?? ''),
      expiryDate: String(row?.expiryDate ?? '')
    };
  }

  private createEmptyDocumentForm(): VehicleDocumentForm {
    return {
      id: null,
      documentNumber: '',
      expiryDate: ''
    };
  }

  private entryBelongsToSelectedVehicle(vehicleId: string | undefined): boolean {
    return this.entryBelongsToVehicle(vehicleId, this.selectedVehicleId, !!this.selectedVehicle?.isDefault);
  }

  private matchesSelectedVehicle(vehicleId: string): boolean {
    return this.entryBelongsToSelectedVehicle(vehicleId);
  }

  private entryBelongsToVehicle(vehicleId: string | undefined, selectedVehicleId: string, allowLegacy = false): boolean {
    const normalizedVehicleId = String(vehicleId ?? '').trim();
    if (!selectedVehicleId) {
      return false;
    }
    if (normalizedVehicleId) {
      return normalizedVehicleId === selectedVehicleId;
    }
    return allowLegacy;
  }

  private matchesVehicleRow(row: any, allowLegacy: boolean): boolean {
    const rowVehicleId = String(row?.vehicleId ?? '').trim();
    if (rowVehicleId) {
      return rowVehicleId === this.selectedVehicleId;
    }
    return allowLegacy;
  }

  private rowBelongsToVehicle(row: any, selectedVehicleId: string, allowLegacy = false): boolean {
    const rowVehicleId = String(row?.vehicleId ?? '').trim();
    if (rowVehicleId) {
      return rowVehicleId === selectedVehicleId;
    }
    return allowLegacy;
  }

  private async ensureDefaultVehicle(): Promise<void> {
    if (!this.userEmail || this.ensuringDefaultVehicle || this.vehicles.length) {
      return;
    }

    this.ensuringDefaultVehicle = true;
    try {
      await addDoc(collection(this.firestore, 'vehicleProfiles'), {
        name: 'My Bike',
        vehicleType: this.vehicleType,
        email: this.userEmail,
        isDefault: true,
        isPreferred: true,
        createdAt: serverTimestamp()
      });
    } catch (error) {
      console.error('Failed to create default bike profile:', error);
    } finally {
      this.ensuringDefaultVehicle = false;
    }
  }

  private parseNumber(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    const parsed = parseFloat(String(value ?? '').replace(/[^0-9.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private parseNullableNumber(value: unknown): number | null {
    const parsed = this.parseNumber(value);
    return parsed > 0 ? parsed : null;
  }

  private toMillis(value: any): number {
    if (value && typeof value.toMillis === 'function') {
      return value.toMillis();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  }

  private addMonthsToIso(isoDate: string, monthsToAdd: number): string {
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) {
      return '';
    }

    const next = new Date(date.getFullYear(), date.getMonth() + monthsToAdd, date.getDate());
    return this.toDateInputValue(next);
  }

  private toDateInputValue(date: Date): string {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  private getMonthKey(record: { monthOnly?: string; year?: number | string; date?: string }): string {
    const year = Number(record?.year ?? NaN);
    const monthIndex = this.months.findIndex((month) => month === record?.monthOnly);
    if (Number.isFinite(year) && monthIndex >= 0) {
      return `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
    }

    return String(record?.date ?? '').trim().slice(0, 7);
  }

  private matchesGlobalMonthKey(key: string): boolean {
    const normalizedKey = String(key ?? '').trim();
    if (!Object.keys(this.globalFilterSelections).length) {
      return true;
    }

    const match = normalizedKey.match(/^(\d{4})-(\d{2})$/);
    if (!match) {
      return false;
    }

    const selectedMonths = this.globalFilterSelections[match[1]];
    if (!selectedMonths) {
      return false;
    }

    if (selectedMonths.length) {
      const monthNumbers = new Set(
        selectedMonths
          .map((month) => this.months.findIndex((item) => item === month))
          .filter((monthIndex) => monthIndex >= 0)
          .map((monthIndex) => String(monthIndex + 1).padStart(2, '0'))
      );

      if (!monthNumbers.size || !monthNumbers.has(match[2])) {
        return false;
      }
    }

    return true;
  }

  private cloneGlobalFilterSelections(selections: Record<string, string[]> | null | undefined): Record<string, string[]> {
    return Object.entries(selections ?? {}).reduce<Record<string, string[]>>((accumulator, [year, months]) => {
      const normalizedYear = String(year ?? '').trim();
      if (!normalizedYear) {
        return accumulator;
      }

      accumulator[normalizedYear] = Array.isArray(months)
        ? months.map((month) => String(month ?? '').trim()).filter((month) => !!month)
        : [];
      return accumulator;
    }, {});
  }

  private async storeDocumentToGoogleDrive(file: File, documentType: VehicleDocumentType): Promise<{ driveFileId: string; fileName: string; storagePath: string; downloadUrl: string }> {
    const accessToken = sessionStorage.getItem('googleAccessToken');
    if (!accessToken) {
      throw new Error('Google Drive access is not available. Please sign out and sign in again, then allow Drive access.');
    }

    const id = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).toString();
    const safeVehicleName = this.selectedVehicleName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const safeType = this.getDocumentTypeStorageKey(documentType);
    const extensionMatch = String(file.name ?? '').match(/\.([a-zA-Z0-9]+)$/);
    const extension = extensionMatch ? extensionMatch[1].toLowerCase() : (file.type === 'application/pdf' ? 'pdf' : 'bin');
    const driveFileName = `${this.vehicleType}_${safeVehicleName}_${safeType}_${id}.${extension}`;

    const boundary = `-------asv-${id.replace(/[^a-zA-Z0-9]/g, '')}`;
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const metadata = { name: driveFileName };
    const bytes = new Uint8Array(await file.arrayBuffer());

    const multipartBody = new Blob(
      [
        delimiter,
        'Content-Type: application/json; charset=UTF-8\r\n\r\n',
        JSON.stringify(metadata),
        delimiter,
        `Content-Type: ${file.type || 'application/octet-stream'}\r\n\r\n`,
        bytes,
        closeDelimiter
      ],
      { type: `multipart/related; boundary=${boundary}` }
    );

    const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`
      },
      body: multipartBody
    });

    const json = await response.json().catch(() => null);
    if (!response.ok) {
      const message = json?.error?.message ? String(json.error.message) : `Drive upload failed (${response.status}).`;
      throw new Error(message);
    }

    const driveFileId = String(json?.id ?? '');
    const downloadUrl = json?.webViewLink ? String(json.webViewLink) : `https://drive.google.com/file/d/${driveFileId}/view`;
    if (!driveFileId) {
      throw new Error('Drive upload did not return a file id.');
    }

    return {
      driveFileId,
      fileName: driveFileName,
      storagePath: `gdrive:${driveFileId}`,
      downloadUrl
    };
  }

  private getDocumentTypeLabel(documentType: VehicleDocumentType): string {
    return this.documentTypeOptions.find((option) => option.key === documentType)?.label ?? 'Document';
  }

  private async setPreferredVehicle(vehicleId: string): Promise<void> {
    const normalizedVehicleId = String(vehicleId ?? '').trim();
    if (!this.userEmail || !normalizedVehicleId) {
      return;
    }

    const selectedVehicle = this.vehicles.find((vehicle) => vehicle.id === normalizedVehicleId);
    if (selectedVehicle?.isPreferred) {
      return;
    }

    const updates = this.vehicles
      .filter((vehicle) => String(vehicle.id ?? '').trim())
      .filter((vehicle) => !!vehicle.isPreferred !== (String(vehicle.id) === normalizedVehicleId))
      .map((vehicle) =>
        updateDoc(doc(this.firestore, 'vehicleProfiles', String(vehicle.id)), {
          isPreferred: String(vehicle.id) === normalizedVehicleId,
          email: this.userEmail
        })
      );

    if (!updates.length) {
      return;
    }

    try {
      await Promise.all(updates);
    } catch (error) {
      console.error('Failed to persist preferred bike selection:', error);
    }
  }

  private getDocumentTypeStorageKey(documentType: VehicleDocumentType): string {
    return documentType === 'drivingLicense' ? 'driving_license' : documentType;
  }

  private normalizeDocumentType(documentType: unknown): VehicleDocumentType | null {
    const normalized = String(documentType ?? '').trim().toLowerCase().replace(/[^a-z]/g, '');
    if (normalized === 'insurance') {
      return 'insurance';
    }
    if (normalized === 'pollution') {
      return 'pollution';
    }
    if (normalized === 'drivinglicense') {
      return 'drivingLicense';
    }
    if (normalized === 'rc') {
      return 'rc';
    }
    return null;
  }

  private getDriveFileId(value: any): string | null {
    const explicit = typeof value?.driveFileId === 'string' ? value.driveFileId : null;
    if (explicit) {
      return explicit;
    }

    const storagePath = typeof value?.storagePath === 'string' ? value.storagePath : '';
    if (storagePath.startsWith('gdrive:')) {
      return storagePath.slice('gdrive:'.length);
    }

    const url = typeof value?.downloadUrl === 'string' ? value.downloadUrl : '';
    const match = url.match(/\/d\/([^/]+)/) ?? url.match(/[?&]id=([^&]+)/);
    return match ? match[1] : null;
  }

  private async deleteDriveFile(driveFileId: string): Promise<void> {
    const accessToken = sessionStorage.getItem('googleAccessToken');
    if (!accessToken) {
      throw new Error('Google Drive access is not available. Please sign out and sign in again, then allow Drive access.');
    }

    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveFileId)}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (response.status === 204 || response.status === 404) {
      return;
    }

    if (response.status === 401 || response.status === 403) {
      throw new Error('Drive permission expired or not granted. Sign out and sign in again, then try delete again.');
    }

    const text = await response.text().catch(() => '');
    throw new Error(text || `Drive delete failed (${response.status}).`);
  }
}