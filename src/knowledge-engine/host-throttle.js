'use strict';

const { sleep } = require('./retry');

/**
 * Semaforo asincrono per-host: limita quante richieste sono in volo per un
 * dato host contemporaneamente e impone un ritardo minimo tra l'avvio di
 * richieste sullo stesso host (politeness), indipendente dalla concorrenza
 * globale del crawler.
 *
 * Ported from Staging/src/knowledge-engine/lib/host-throttle.js senza
 * modifiche.
 */
class HostThrottle {
  constructor({ maxPerHost = 2, minDelayMs = 300 } = {}) {
    this.maxPerHost = maxPerHost;
    this.minDelayMs = minDelayMs;
    this.active = new Map();
    this.lastStart = new Map();
    this.waiters = new Map();
  }

  async acquire(host) {
    const key = host || '__unknown__';
    for (;;) {
      const active = this.active.get(key) || 0;
      if (active < this.maxPerHost) {
        this.active.set(key, active + 1);
        const last = this.lastStart.get(key) || 0;
        const wait = this.minDelayMs - (Date.now() - last);
        if (wait > 0) await sleep(wait);
        this.lastStart.set(key, Date.now());
        return;
      }
      await new Promise((resolve) => {
        const list = this.waiters.get(key) || [];
        list.push(resolve);
        this.waiters.set(key, list);
      });
    }
  }

  release(host) {
    const key = host || '__unknown__';
    const active = (this.active.get(key) || 1) - 1;
    this.active.set(key, Math.max(0, active));
    const list = this.waiters.get(key);
    if (list && list.length) list.shift()();
  }
}

module.exports = { HostThrottle };
