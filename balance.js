/* ═══════════════════════════════════════════════════════════════════
   SHARED BALANCE CONFIG

   Values that must stay identical across more than one channel live
   here so they cannot drift apart. Everything channel-specific stays in
   that channel's own CONFIG block.
   ═══════════════════════════════════════════════════════════════════ */

// Base seconds between spawns. Signal Pop and Whack-a-Mole are required to
// use the exact same figure, so it is defined once.
export const BASE_SPAWN_INTERVAL = 0.7;
