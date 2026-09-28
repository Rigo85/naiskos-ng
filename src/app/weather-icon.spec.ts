import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { iconForWeatherCode, WEATHER_ICON_PATHS, WeatherIconKind } from './core/weather-icons';
import { WeatherIcon } from './weather-icon';

describe('iconos meteorológicos locales', () => {
  it.each([
    [0, 'sun'], [1, 'partly-cloudy'], [2, 'partly-cloudy'],
    [3, 'cloud'], [45, 'cloud'], [48, 'cloud'],
    [51, 'rain'], [53, 'rain'], [55, 'rain'], [56, 'rain'], [57, 'rain'],
    [61, 'rain'], [63, 'rain'], [65, 'rain'], [66, 'rain'], [67, 'rain'],
    [80, 'rain'], [81, 'rain'], [82, 'rain'],
    [71, 'snow'], [73, 'snow'], [75, 'snow'], [77, 'snow'], [85, 'snow'], [86, 'snow'],
    [95, 'storm'], [96, 'storm'], [99, 'storm'],
  ] as const)('representa el código %s con %s', (code, expected) => {
    expect(iconForWeatherCode(code, true)).toBe(expected);
  });

  it('conserva variantes nocturnas y usa un vector seguro para códigos desconocidos', () => {
    expect(iconForWeatherCode(0, false)).toBe('moon');
    expect(iconForWeatherCode(1, false)).toBe('cloud');
    expect(iconForWeatherCode(2, false)).toBe('cloud');
    expect(iconForWeatherCode(63, false)).toBe('rain');
    for (const code of [-1, NaN, Infinity, 0.5, 1000, 4]) {
      expect(iconForWeatherCode(code, true)).toBe('pending');
    }
  });

  it('dibuja todos los estados sin texto, fuentes, imágenes externas ni animaciones', () => {
    const fixture = TestBed.createComponent(WeatherIcon);
    for (const kind of Object.keys(WEATHER_ICON_PATHS) as WeatherIconKind[]) {
      fixture.componentRef.setInput('kind', kind);
      fixture.detectChanges();
      const svg: SVGElement = fixture.nativeElement.querySelector('svg');
      expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
      expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      expect(svg.getAttribute('focusable')).toBe('false');
      expect([...svg.querySelectorAll('path')].map((p) => p.getAttribute('d'))).toEqual(WEATHER_ICON_PATHS[kind]);
      expect(svg.querySelector('text, image, use, animate, foreignObject')).toBeNull();
      expect(svg.textContent?.trim()).toBe('');
    }
    fixture.destroy();
  });
});
