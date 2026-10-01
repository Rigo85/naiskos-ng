import { describe, it, expect } from 'vitest';
import { SceneLease } from './scene-lease';

describe('presupuesto independiente por presentación', () => {
  it('video individual o mosaico vence por tiempo aunque no llegue ningún evento', () => {
    const lease = new SceneLease('one', 63.914, true, 0);
    expect(lease.due(83913)).toBe(false);
    expect(lease.due(83914)).toBe(true);
  });
  it('ningún progreso devuelve el intento único de recuperación', () => {
    const lease = new SceneLease('one', 64, true, 0);
    expect(lease.takeRecovery()).toBe(true);
    lease.progress(1); lease.progress(1.6);
    expect(lease.takeRecovery()).toBe(false);
  });
  it('reposo y menú conservan consumo y recuperación sin contar el tiempo suspendido', () => {
    const lease = new SceneLease('one', 60, true, 0);
    lease.takeRecovery(); lease.update(20000, true);
    expect(lease.due(3600000)).toBe(false);
    lease.update(3600000, false);
    expect(lease.takeRecovery()).toBe(false);
    expect(lease.due(3659999)).toBe(false);
    expect(lease.due(3660000)).toBe(true);
  });
  it('pausa manual tiene su límite sin renovarlo por eventos repetidos', () => {
    const lease = new SceneLease('one', 60, true, 0);
    lease.pause(10000,30); lease.pause(25000,30);
    expect(lease.due(39999)).toBe(false);
    expect(lease.due(40000)).toBe(true);
  });
  it('play descarta la cuenta de pausa pero no devuelve presupuesto gastado', () => {
    const lease = new SceneLease('one',60,true,0);
    lease.pause(20000,30); lease.play(40000);
    expect(lease.due(99999)).toBe(false);
    expect(lease.due(100000)).toBe(true);
  });
  it('seek explícito ajusta sólo tiempo de media y no repone margen', () => {
    const lease = new SceneLease('one',60,true,0);
    lease.progress(20); lease.seek(25000,10); // 5s already consumed by waiting
    expect(lease.snapshot(25000).budgetMs).toBe(90000);
    lease.seek(25000,40);
    expect(lease.snapshot(25000).budgetMs).toBe(60000);
    expect(lease.due(60000)).toBe(true);
  });
  it('vencida no admite recuperación ni renovación técnica', () => {
    const lease = new SceneLease('one',1,true,0);
    lease.expired = true;
    expect(lease.takeRecovery()).toBe(false);
    lease.play(100); expect(lease.due(100)).toBe(true);
  });
  it('fotos usan duración de configuración; una interacción sí puede renovar', () => {
    const lease = new SceneLease('one',30,false,0);
    lease.restartPhoto(20000,30);
    expect(lease.due(31000)).toBe(false);
    expect(lease.due(51000)).toBe(true);
  });
});
