// Cabo Luna — three art-direction configurations (Day 4C).
// Pure data: sun / hemisphere / sky / fog / exposure / lamp glow.
// render.js applies the chosen grade; main.js selects it with
// ?grade=<name>. The default ('sunset') is the comparison winner —
// picked by evidence from the three rendered play/chase shots, not
// by preference. All three stay available for re-comparison.
export const VISUAL_GRADES = {
  sunset: {
    label: 'Coastal Sunset',
    sun: { color: 0xffe7b8, intensity: 2.8, position: [180, 220, 90] },
    hemi: { sky: 0xcfe5ff, ground: 0x9a7f56, intensity: 1.5 },
    sky: { top: 0x3f7fd0, mid: 0x9cc8e8, low: 0xffd9a0 },
    fog: { color: 0xa8c8e0, near: 220, far: 700 },
    exposure: 1.05,
    lampGlow: 0.5,
  },
  golden: {
    label: 'Golden-Hour',
    sun: { color: 0xffc98a, intensity: 3.2, position: [260, 140, 60] },
    hemi: { sky: 0xe8c9a0, ground: 0x8a6f4a, intensity: 1.3 },
    sky: { top: 0x4a6fb0, mid: 0xe8b878, low: 0xffb060 },
    fog: { color: 0xd8b890, near: 180, far: 600 },
    exposure: 1.1,
    lampGlow: 0.7,
  },
  haze: {
    label: 'Fog-Haze',
    sun: { color: 0xffe0b8, intensity: 2.2, position: [180, 260, 90] },
    hemi: { sky: 0xd8e8f0, ground: 0x9a8a70, intensity: 1.6 },
    sky: { top: 0x5a8ac0, mid: 0xb8d0e0, low: 0xe8d0a8 },
    fog: { color: 0xc8d8e0, near: 120, far: 450 },
    exposure: 1.0,
    lampGlow: 0.4,
  },
};

export const GRADE_NAMES = Object.keys(VISUAL_GRADES);
// The game's look: the comparison winner. Set by Day 4C evidence;
// change only after re-rendering all three grades and re-scoring.
export const DEFAULT_GRADE = 'sunset';

export function gradeFor(name) {
  return VISUAL_GRADES[name] ?? VISUAL_GRADES[DEFAULT_GRADE];
}
