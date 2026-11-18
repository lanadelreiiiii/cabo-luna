// mission-03-harbor-silence.ink — Yara sends the player to retrieve a
// package from a restricted harbor warehouse in Puerto Luna.
// Objectives: infiltrate_harbor (reach, on foot) -> defeat_guards
// (defeat 2 — Day 3B combat seam, see missions.js) -> reach_stash
// (reach) -> retrieve_package (wait 3s) -> escape_safehouse (reach) ->
// wanted_clear. Reward $400. Fail: timeout 360s.
VAR payout = 0
VAR fail_reason = ""

-> start

=== start ===
Yara: "The ledger says the harbor warehouse keeps a package — proof the operation can't afford to lose. I need it, and I need it quiet." # speaker:yara
Yara: "Puerto Luna, west docks. Get inside on foot — no car through the gate, they'll hear you a block away." # speaker:yara # objective:infiltrate_harbor # objective_text:Infiltrate the Puerto Luna warehouse on foot
-> END

=== infiltrate_harbor_done ===
Tomas: "You're in the yard. Two guards on the floor — El Faro's eyes say they don't take breaks. Deal with them." # speaker:tomas # objective:defeat_guards # objective_text:Defeat the warehouse guards (0/2)
-> END

=== defeat_guards_done ===
Tomas: "Floor's clear. The stash is in the back cage — grab the package." # speaker:tomas # checkpoint # objective:reach_stash # objective_text:Reach the stash cage
-> END

=== reach_stash_done ===
Tomas: "That's the package. Hold still while I talk you through the seal — three seconds." # speaker:tomas # objective:retrieve_package # objective_text:Retrieve the package — hold still
-> END

=== retrieve_package_done ===
Yara: "Package in hand. Now vanish — the harbor crew will notice the quiet. Get to the Colina Verde safehouse and wait out the heat." # speaker:yara # checkpoint # objective:escape_safehouse # objective_text:Reach the Colina Verde safehouse
-> END

=== escape_safehouse_done ===
Yara: "Inside. Sit tight until the harbor stops looking." # speaker:yara # checkpoint # objective:wanted_clear # objective_text:Wait until the heat clears
-> END

=== wanted_clear_done ===
Yara: "Harbor silence. You walked into their warehouse and walked out with their proof." # speaker:yara
-> complete

=== complete ===
~ payout = 400
Yara: "$400. The operation is blind now — and it's because of you." # speaker:yara # mission_complete # reward:400
-> END

=== failed ===
{ fail_reason == "timeout":
    Yara: "Too slow — the harbor crew swept the warehouse. The package is gone." # speaker:yara
- else:
    Tomas: "They got you in the yard. El Faro will come for the car — you just lay low." # speaker:tomas
}
-> END
