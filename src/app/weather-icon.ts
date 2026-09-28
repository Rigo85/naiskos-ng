import { Component, computed, input } from '@angular/core';
import { WEATHER_ICON_PATHS, WeatherIconKind } from './core/weather-icons';

@Component({
  selector: 'app-weather-icon',
  template: `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
      @for (path of paths(); track $index) { <path [attr.d]="path" /> }
    </svg>
  `,
  styles: `
    :host { display: inline-block; width: 1em; height: 1em; flex: 0 0 1em; }
    svg { display: block; width: 100%; height: 100%; filter: drop-shadow(0 2px 2px rgb(0 0 0 / 90%)); }
  `,
})
export class WeatherIcon {
  readonly kind = input<WeatherIconKind>('pending');
  protected readonly paths = computed(() => WEATHER_ICON_PATHS[this.kind()]);
}
