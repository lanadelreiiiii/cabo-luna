// Cabo Luna Day 4H — WebGL context-loss recovery state machine.
// Renderer-free and testable: the game loop consults this module, and
// node tests drive it with fake canvas/renderer doubles (no GPU).
//
// States: 'ok' -> 'lost' -> 'ok'. There is no third state: a restore
// that fails verification leaves the machine in 'lost' — the loop must
// NEVER resume into a broken renderer. The module never creates a
// renderer and never touches WebGL itself; main.js supplies the three
// callbacks (show/hide the DOM message, probe-render to verify).
//
// The canvas 'webglcontextlost' handler MUST call preventDefault, or
// the browser will not fire 'webglcontextrestored' at all — handleLost
// does that, so wiring code only has to forward the event.
export const RECOVERY_MESSAGE = 'Graphics paused — restoring…';

export function createContextRecovery(callbacks = {}) {
  const {
    showMessage = () => {},
    hideMessage = () => {},
    // verify(): boolean — probe-render the scene; true only when the
    // renderer is valid again and a frame actually painted. Defaults
    // to "trust the event" when no verifier is supplied, but main.js
    // always supplies a real probe render.
    verify = () => true,
    onRestored = () => {},
  } = callbacks;

  let state = 'ok';
  let losses = 0;
  let restores = 0;
  let failedVerifications = 0;

  return {
    get state() { return state; },
    // The loop is paused whenever we are not in 'ok': no sim steps,
    // no renders, no sim-time advance while the context is gone.
    get paused() { return state !== 'ok'; },
    get messageVisible() { return state === 'lost'; },
    get losses() { return losses; },
    get restores() { return restores; },
    get failedVerifications() { return failedVerifications; },

    // webglcontextlost handler. Returns true only on a fresh loss;
    // a second loss while already lost is a no-op (no duplicate
    // message show, no counter growth beyond the loss count).
    handleLost(event) {
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      if (state === 'lost') return false;
      state = 'lost';
      losses += 1;
      showMessage();
      return true;
    },

    // webglcontextrestored handler. Verifies BEFORE resuming: if the
    // probe render fails (or throws), we stay 'lost' — message stays
    // up, loop stays paused — and the next restored event (or a
    // retry) gets another chance. Returns { resumed }.
    handleRestored() {
      if (state !== 'lost') return { resumed: false, reason: 'not-lost' };
      let ok = false;
      try {
        ok = verify() === true;
      } catch {
        ok = false;
      }
      if (!ok) {
        failedVerifications += 1;
        return { resumed: false, reason: 'verify-failed' };
      }
      state = 'ok';
      restores += 1;
      hideMessage();
      onRestored();
      return { resumed: true };
    },
  };
}
