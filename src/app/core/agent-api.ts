import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import {
  FrameManifest,
  FrameSettings,
  MediaItem,
  MediaPatch,
  MediaRotation,
  ProvisioningStatus,
  WeatherSnapshot,
  FrameNotification,
} from './models';

export type SystemAction = 'exit' | 'poweroff';

@Injectable({ providedIn: 'root' })
export class AgentApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = '/api/v1';

  getManifest(): Observable<FrameManifest> {
    return this.http.get<FrameManifest>(`${this.baseUrl}/manifest`);
  }

  getWeather(): Observable<WeatherSnapshot> {
    return this.http.get<WeatherSnapshot>(`${this.baseUrl}/weather`);
  }

  getProvisioningStatus(): Observable<ProvisioningStatus> {
    return this.http.get<ProvisioningStatus>(`${this.baseUrl}/provisioning`);
  }

  getNotifications(): Observable<{ notifications: FrameNotification[] }> {
    return this.http.get<{ notifications: FrameNotification[] }>(
      `${this.baseUrl}/notifications`,
    );
  }

  markAllNotificationsRead(): Observable<{ updated: number }> {
    return this.http.post<{ updated: number }>(
      `${this.baseUrl}/notifications/read-all`,
      {},
    );
  }

  dismissNotification(id: string): Observable<void> {
    return this.http.delete<void>(
      `${this.baseUrl}/notifications/${encodeURIComponent(id)}`,
    );
  }

  resetProvisioning(): Observable<ProvisioningStatus> {
    return this.http.post<ProvisioningStatus>(
      `${this.baseUrl}/provisioning/reset`,
      {},
      { headers: { 'X-Naiskos-Request': 'viewer' } },
    );
  }

  rotatePairingCode(): Observable<ProvisioningStatus> {
    return this.http.post<ProvisioningStatus>(
      `${this.baseUrl}/pairing/rotate`,
      {},
      { headers: { 'X-Naiskos-Request': 'viewer' } },
    );
  }

  updateSettings(patch: Partial<FrameSettings>): Observable<FrameSettings> {
    return this.http.patch<FrameSettings>(`${this.baseUrl}/settings`, patch);
  }

  resetSettings(): Observable<FrameSettings> {
    return this.http.post<FrameSettings>(`${this.baseUrl}/settings/reset`, {});
  }

  updateMedia(id: string, patch: MediaPatch): Observable<MediaItem> {
    return this.http.patch<MediaItem>(`${this.baseUrl}/media/${encodeURIComponent(id)}`, patch);
  }

  rotateMedia(
    id: string,
    rotationDegrees: MediaRotation,
  ): Observable<{ accepted: boolean; rotationDegrees: MediaRotation }> {
    return this.http.post<{ accepted: boolean; rotationDegrees: MediaRotation }>(
      `${this.baseUrl}/media/${encodeURIComponent(id)}/rotation`,
      { rotationDegrees },
    );
  }

  deleteMedia(id: string): Observable<{ accepted: boolean }> {
    return this.http.delete<{ accepted: boolean }>(
      `${this.baseUrl}/media/${encodeURIComponent(id)}`,
    );
  }

  requestSystemAction(action: SystemAction): Observable<{ accepted: boolean }> {
    return this.http.post<{ accepted: boolean }>(
      `${this.baseUrl}/system/actions`,
      { action },
      { headers: { 'X-Naiskos-Request': 'viewer' } },
    );
  }
}
