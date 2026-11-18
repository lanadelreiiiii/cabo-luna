// Cabo Luna — keyboard + mouse input. Tracks held keys and the orbit
// drag; the sim reads a plain snapshot each step, never the DOM directly.
export const ACTION_CONFIRM = 'confirm';
export const ACTION_PAUSE = 'pause';
export const ACTION_JUMP = 'jump';
export const ACTION_SPRINT = 'sprint';

const KEY_ACTIONS = {
  Enter: ACTION_CONFIRM,
  Space: ACTION_JUMP,
  Escape: ACTION_PAUSE,
  KeyP: ACTION_PAUSE,
};

export function createInput(canvas) {
  const keys = new Set();
  const pressed = new Set();
  let yawDelta = 0;
  let pitchDelta = 0;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  function onKeyDown(event) {
    if (event.repeat) return;
    keys.add(event.code);
    const action = KEY_ACTIONS[event.code];
    if (action) pressed.add(action);
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) {
      event.preventDefault();
    }
  }
  function onKeyUp(event) { keys.delete(event.code); }

  function onPointerDown(event) {
    dragging = true; lastX = event.clientX; lastY = event.clientY;
    canvas.setPointerCapture?.(event.pointerId);
  }
  function onPointerMove(event) {
    if (!dragging) return;
    yawDelta += event.clientX - lastX;
    pitchDelta += event.clientY - lastY;
    lastX = event.clientX; lastY = event.clientY;
  }
  function onPointerUp() { dragging = false; }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);

  return {
    // Movement axes in camera space: -1..1.
    move() {
      let x = 0, z = 0;
      if (keys.has('KeyW') || keys.has('ArrowUp')) z -= 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) z += 1;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
      if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
      const len = Math.hypot(x, z) || 1;
      return { x: x / len, z: z / len };
    },
    sprinting() { return keys.has('ShiftLeft') || keys.has('ShiftRight'); },
    // Pixel drag since last read; consumed on read.
    orbit() {
      const out = { yaw: yawDelta, pitch: pitchDelta };
      yawDelta = 0; pitchDelta = 0;
      return out;
    },
    // True once per physical press; consumed on read.
    consume(action) {
      if (!pressed.has(action)) return false;
      pressed.delete(action);
      return true;
    },
  };
}
