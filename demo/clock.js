// Virtual time: once started, performance.now, Date.now, requestAnimationFrame and CSS/Web
// animations advance only when the capture script steps the clock, so every frame is exact.
module.exports = `(() => {
  const realNow = performance.now.bind(performance), realDate = Date.now, realRAF = window.requestAnimationFrame.bind(window);
  let on = false, t = 0, t0 = 0, d0 = 0, id = 1; let queue = [];
  performance.now = () => (on ? t : realNow());
  Date.now = () => (on ? d0 + (t - t0) : realDate());
  window.requestAnimationFrame = (cb) => { if (!on) return realRAF(cb); const k = id++; queue.push([k, cb]); return k; };
  const realCAF = window.cancelAnimationFrame.bind(window);
  window.cancelAnimationFrame = (k) => { queue = queue.filter((q) => q[0] !== k); realCAF(k); };
  window.__clock = {
    start() { on = true; t = t0 = realNow(); d0 = realDate(); },
    step(ms) {
      t += ms;
      for (const a of document.getAnimations()) { try { if (a.playState === 'running') a.pause(); a.currentTime = (a.currentTime || 0) + ms; } catch (e) {} }
      const q = queue; queue = [];
      for (const [, cb] of q) { try { cb(t); } catch (e) { console.error(e); } }
    },
    pending: () => queue.length,
  };
})();`;
